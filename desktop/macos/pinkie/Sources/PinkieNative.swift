import AppKit
import Carbon.HIToolbox
import UniformTypeIdentifiers
import UserNotifications
import WebKit

// PLAN §8 native bridge: one message handler `pinkieNative` for notifications
// (N1), export (H2), file reveal/open (W3), menu bar (N2) and the global
// quick-ask hotkey (N3). The page decides *when*; this file only performs.
// Replies go to window.__pinkieNativeReply(reqId, payload); native → page
// events are window `pinkie-native` CustomEvents.
final class PinkieNativeBridge: NSObject, UNUserNotificationCenterDelegate, NSMenuDelegate, WKNavigationDelegate, NSTextFieldDelegate {
    static let handlerName = "pinkieNative"
    var mainWebView: () -> WKWebView? = { nil }
    var mainWindow: () -> NSWindow? = { nil }

    private var notified = [String]()
    private var statusItem: NSStatusItem?
    private var runningMenu = NSMenu(title: "正在运行")
    private var runningItem: NSMenuItem?
    private var running: [(key: String, title: String)] = []
    private var currentMode = "work"
    private var currentModeLabel = "工作"
    private var hotKeyRef: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?
    private var quickPanel: NSPanel?
    private var quickField: NSTextField?
    private var quickModeLabel: NSTextField?
    private var exportJobs = [ExportJob]()

    override init() {
        super.init()
        if Bundle.main.bundleIdentifier != nil { UNUserNotificationCenter.current().delegate = self }
        let menubar = UserDefaults.standard.object(forKey: "pinkie.menubar") as? Bool ?? true
        setMenubar(menubar)
        let hotkey = UserDefaults.standard.object(forKey: "pinkie.hotkey") as? String ?? "Alt+Space"
        if !hotkey.isEmpty { _ = registerHotkey(hotkey) }
    }

    // MARK: page → native

    func handle(_ body: [String: Any], from webView: WKWebView?) {
        let type = body["type"] as? String ?? ""
        let reqId = body["reqId"] as? String
        switch type {
        case "notify": notify(body)
        case "notifyPermission":
            requestPermission { granted in self.reply(reqId, ["granted": granted], webView) }
        case "exportPDF", "exportImage":
            export(body, pdf: type == "exportPDF") { result in self.reply(reqId, result, webView) }
        case "revealFile", "openFile":
            let path = (body["path"] as? String ?? "") as NSString
            let url = URL(fileURLWithPath: path.expandingTildeInPath)
            guard path.length > 0, FileManager.default.fileExists(atPath: url.path) else {
                reply(reqId, ["ok": false, "error": "文件不在了"], webView); return
            }
            if type == "revealFile" { NSWorkspace.shared.activateFileViewerSelecting([url]) }
            else { NSWorkspace.shared.open(url) }
            reply(reqId, ["ok": true], webView)
        case "setMenubar":
            let enabled = body["enabled"] as? Bool ?? true
            UserDefaults.standard.set(enabled, forKey: "pinkie.menubar")
            setMenubar(enabled)
            reply(reqId, ["ok": true], webView)
        case "setHotkey":
            let accelerator = body["accelerator"] as? String
            reply(reqId, setHotkey(accelerator), webView)
        case "context":
            if let mode = body["mode"] as? String { currentMode = mode }
            if let label = body["modeLabel"] as? String { currentModeLabel = label }
            if let items = body["running"] as? [[String: Any]] {
                running = items.prefix(20).compactMap { item in
                    guard let key = item["key"] as? String else { return nil }
                    return (key, (item["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "未命名会话")
                }
                refreshRunningItem()
            }
            quickModeLabel?.stringValue = currentModeLabel
            reply(reqId, ["ok": true], webView)
        default:
            reply(reqId, ["ok": false, "error": "不认识的原生请求"], webView)
        }
    }

    private func reply(_ reqId: String?, _ payload: [String: Any], _ webView: WKWebView?) {
        guard let reqId, let target = webView ?? mainWebView(),
              let idData = try? JSONSerialization.data(withJSONObject: [reqId]),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let idJSON = String(data: idData, encoding: .utf8), let json = String(data: data, encoding: .utf8) else { return }
        target.evaluateJavaScript("window.__pinkieNativeReply?.(\(idJSON)[0],\(json));", completionHandler: nil)
    }

    private func emit(_ detail: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        mainWebView()?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('pinkie-native',{detail:\(json)}));", completionHandler: nil)
    }

    private func showMain() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = mainWindow() {
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        }
    }

    // MARK: N1 notifications

    private func requestPermission(_ done: @escaping (Bool) -> Void) {
        guard Bundle.main.bundleIdentifier != nil else { done(false); return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            DispatchQueue.main.async { done(granted) }
        }
    }

    private func notify(_ body: [String: Any]) {
        guard let id = body["id"] as? String, !id.isEmpty, !notified.contains(id),
              let sessionKey = body["sessionKey"] as? String else { return }
        notified.append(id)
        if notified.count > 200 { notified.removeFirst(notified.count - 200) }
        let content = UNMutableNotificationContent()
        content.title = String((body["title"] as? String ?? "碧琪").prefix(120))
        content.body = String((body["body"] as? String ?? "").prefix(200))
        content.sound = .default
        content.userInfo = ["sessionKey": sessionKey]
        content.threadIdentifier = sessionKey
        requestPermission { granted in
            guard granted else { return }
            let request = UNNotificationRequest(identifier: "pinkie-" + id, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // The page already decided this session is not the one in front.
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let key = response.notification.request.content.userInfo["sessionKey"] as? String
        DispatchQueue.main.async {
            self.showMain()
            if let key { self.emit(["type": "openSession", "sessionKey": key]) }
            completionHandler()
        }
    }

    // MARK: H2 export (PDF / long image)

    private final class ExportJob {
        let view: WKWebView
        let pdf: Bool
        let fileName: String
        let done: ([String: Any]) -> Void
        init(view: WKWebView, pdf: Bool, fileName: String, done: @escaping ([String: Any]) -> Void) {
            self.view = view; self.pdf = pdf; self.fileName = fileName; self.done = done
        }
    }

    private func safeFileName(_ raw: String, ext: String) -> String {
        var name = raw.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { name = "碧琪会话." + ext }
        if !name.lowercased().hasSuffix("." + ext) { name += "." + ext }
        return name
    }

    private func export(_ body: [String: Any], pdf: Bool, done: @escaping ([String: Any]) -> Void) {
        guard let html = body["html"] as? String, !html.isEmpty, html.utf8.count < 60_000_000 else {
            done(["ok": false, "error": "没有可导出的内容"]); return
        }
        let width = CGFloat((body["width"] as? Double) ?? 900)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: max(480, min(width, 1600)), height: 1200), configuration: configuration)
        view.setValue(false, forKey: "drawsBackground")
        view.navigationDelegate = self
        let job = ExportJob(view: view, pdf: pdf, fileName: safeFileName(body["fileName"] as? String ?? "", ext: pdf ? "pdf" : "png"), done: done)
        exportJobs.append(job)
        view.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let job = exportJobs.first(where: { $0.view === webView }) else { return }
        // Give images and KaTeX fonts a moment to lay out.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.render(job) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(webView, ["ok": false, "error": "导出页面没能加载"])
    }

    private func finish(_ view: WKWebView, _ result: [String: Any]) {
        guard let index = exportJobs.firstIndex(where: { $0.view === view }) else { return }
        let job = exportJobs.remove(at: index)
        job.done(result)
    }

    private func render(_ job: ExportJob) {
        job.view.evaluateJavaScript("Math.ceil(document.documentElement.scrollHeight)") { value, _ in
            let height = CGFloat((value as? Double) ?? 1200)
            job.view.frame.size.height = max(200, min(height, 60_000))
            if job.pdf {
                self.makePDF(job)
            } else {
                let config = WKSnapshotConfiguration()
                config.rect = NSRect(origin: .zero, size: job.view.frame.size)
                config.afterScreenUpdates = true
                job.view.takeSnapshot(with: config) { image, _ in
                    guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                          let png = rep.representation(using: .png, properties: [:]) else {
                        self.finish(job.view, ["ok": false, "error": "长图没生成出来"]); return
                    }
                    self.save(png, job)
                }
            }
        }
    }

    private func makePDF(_ job: ExportJob) {
        // Paginated A4 through the print system, written straight to a temp file.
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        let info = NSPrintInfo(dictionary: [.jobSavingURL: temp])
        info.jobDisposition = .save
        info.paperSize = NSSize(width: 595, height: 842)
        info.topMargin = 36; info.bottomMargin = 36; info.leftMargin = 36; info.rightMargin = 36
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        let operation = job.view.printOperation(with: info)
        operation.showsPrintPanel = false
        operation.showsProgressPanel = false
        operation.view?.frame = job.view.bounds
        let host = mainWindow()
        let completion: () -> Void = {
            guard let data = try? Data(contentsOf: temp), !data.isEmpty else {
                self.finish(job.view, ["ok": false, "error": "PDF 没生成出来"]); return
            }
            try? FileManager.default.removeItem(at: temp)
            self.save(data, job)
        }
        if let host {
            operation.runModal(for: host, delegate: nil, didRun: nil, contextInfo: nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.waitForFile(temp, attempts: 40, then: completion) }
        } else {
            operation.run()
            completion()
        }
    }

    private func waitForFile(_ url: URL, attempts: Int, then: @escaping () -> Void) {
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        if size > 0 || attempts <= 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: then); return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForFile(url, attempts: attempts - 1, then: then) }
    }

    private func save(_ data: Data, _ job: ExportJob) {
        if let directory = ProcessInfo.processInfo.environment["PINKIE_EXPORT_DIR"], !directory.isEmpty {
            // Test hook: the isolated QA writes without a save panel.
            let url = URL(fileURLWithPath: directory).appendingPathComponent(job.fileName)
            do { try data.write(to: url); finish(job.view, ["ok": true, "path": url.path]) }
            catch { finish(job.view, ["ok": false, "error": "保存失败"]) }
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = job.fileName
        panel.allowedContentTypes = [job.pdf ? .pdf : .png]
        let handle: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { self.finish(job.view, ["ok": false, "cancelled": true]); return }
            do { try data.write(to: url); self.finish(job.view, ["ok": true, "path": url.path]) }
            catch { self.finish(job.view, ["ok": false, "error": "保存失败：\(error.localizedDescription)"]) }
        }
        if let window = mainWindow() { panel.beginSheetModal(for: window, completionHandler: handle) }
        else { handle(panel.runModal()) }
    }

    // MARK: N2 menu bar

    private static func balloonImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.setStroke()
            let balloon = NSBezierPath(ovalIn: NSRect(x: 4, y: 6.5, width: 10, height: 10.5))
            balloon.lineWidth = 1.5
            balloon.stroke()
            let knot = NSBezierPath()
            knot.move(to: NSPoint(x: 8, y: 6.6)); knot.line(to: NSPoint(x: 9, y: 5.2)); knot.line(to: NSPoint(x: 10, y: 6.6))
            knot.lineWidth = 1.2; knot.stroke()
            let string = NSBezierPath()
            string.move(to: NSPoint(x: 9, y: 5.2))
            string.curve(to: NSPoint(x: 9, y: 1), controlPoint1: NSPoint(x: 7.4, y: 4), controlPoint2: NSPoint(x: 10.6, y: 2.4))
            string.lineWidth = 1; string.stroke()
            let shine = NSBezierPath()
            shine.appendArc(withCenter: NSPoint(x: 9, y: 11.75), radius: 3, startAngle: 120, endAngle: 170)
            shine.lineWidth = 1.1; shine.stroke()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "碧琪"
        return image
    }

    private func setMenubar(_ enabled: Bool) {
        if !enabled {
            if let item = statusItem { NSStatusBar.system.removeStatusItem(item) }
            statusItem = nil
            return
        }
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = Self.balloonImage()
        item.button?.toolTip = "碧琪"
        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(menuItem("新会话", #selector(menuNewSession)))
        menu.addItem(menuItem("快速提问…", #selector(menuQuickAsk)))
        menu.addItem(menuItem("打开碧琪", #selector(menuOpen)))
        menu.addItem(.separator())
        let runningItem = NSMenuItem(title: "正在运行 0 个", action: nil, keyEquivalent: "")
        runningItem.submenu = runningMenu
        menu.addItem(runningItem)
        self.runningItem = runningItem
        menu.addItem(.separator())
        menu.addItem(menuItem("设置", #selector(menuSettings)))
        menu.addItem(menuItem("退出碧琪", #selector(menuQuit)))
        item.menu = menu
        statusItem = item
        refreshRunningItem()
    }

    private func menuItem(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    private func refreshRunningItem() {
        runningItem?.title = "正在运行 \(running.count) 个"
        runningItem?.isEnabled = !running.isEmpty
        runningMenu.removeAllItems()
        for (index, entry) in running.enumerated() {
            let item = menuItem(entry.title, #selector(menuOpenRunning(_:)))
            item.tag = index
            runningMenu.addItem(item)
        }
    }

    func menuWillOpen(_ menu: NSMenu) { refreshRunningItem() }

    @objc private func menuNewSession() { showMain(); emit(["type": "newSession"]) }
    @objc private func menuQuickAsk() { showQuickAsk() }
    @objc private func menuOpen() { showMain() }
    @objc private func menuSettings() { showMain(); emit(["type": "openSettings"]) }
    @objc private func menuQuit() { NSApp.terminate(nil) }
    @objc private func menuOpenRunning(_ sender: NSMenuItem) {
        guard running.indices.contains(sender.tag) else { return }
        showMain()
        emit(["type": "openSession", "sessionKey": running[sender.tag].key])
    }

    // MARK: N3 global hotkey + quick ask panel

    static func parseAccelerator(_ raw: String) -> (code: UInt32, modifiers: UInt32)? {
        let parts = raw.split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        guard let keyName = parts.last, parts.count >= 2 else { return nil }
        var modifiers: UInt32 = 0
        for part in parts.dropLast() {
            switch part {
            case "cmd", "command", "⌘", "meta", "super": modifiers |= UInt32(cmdKey)
            case "alt", "option", "opt", "⌥": modifiers |= UInt32(optionKey)
            case "ctrl", "control", "⌃": modifiers |= UInt32(controlKey)
            case "shift", "⇧": modifiers |= UInt32(shiftKey)
            default: return nil
            }
        }
        let keys: [String: Int] = [
            "space": kVK_Space, "return": kVK_Return, "enter": kVK_Return,
            "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F,
            "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
            "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R,
            "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
            "y": kVK_ANSI_Y, "z": kVK_ANSI_Z, "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3,
            "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
        ]
        guard modifiers != 0, let code = keys[keyName] else { return nil }
        return (UInt32(code), modifiers)
    }

    private func unregisterHotkey() {
        if let ref = hotKeyRef { UnregisterEventHotKey(ref) }
        hotKeyRef = nil
    }

    private func registerHotkey(_ accelerator: String) -> Bool {
        guard let parsed = Self.parseAccelerator(accelerator) else { return false }
        unregisterHotkey()
        if hotKeyHandler == nil {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let selfPointer = Unmanaged.passUnretained(self).toOpaque()
            InstallEventHandler(GetApplicationEventTarget(), { _, _, data in
                guard let data else { return noErr }
                let bridge = Unmanaged<PinkieNativeBridge>.fromOpaque(data).takeUnretainedValue()
                DispatchQueue.main.async { bridge.toggleQuickAsk() }
                return noErr
            }, 1, &spec, selfPointer, &hotKeyHandler)
        }
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x504B4E51), id: 1) // 'PKNQ'
        let status = RegisterEventHotKey(parsed.code, parsed.modifiers, id, GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { return false }
        hotKeyRef = ref
        return true
    }

    private func setHotkey(_ accelerator: String?) -> [String: Any] {
        guard let accelerator, !accelerator.isEmpty else {
            unregisterHotkey()
            UserDefaults.standard.set("", forKey: "pinkie.hotkey")
            return ["ok": true, "accelerator": NSNull()]
        }
        guard Self.parseAccelerator(accelerator) != nil else { return ["ok": false, "error": "这个快捷键写法不认识"] }
        if registerHotkey(accelerator) {
            UserDefaults.standard.set(accelerator, forKey: "pinkie.hotkey")
            return ["ok": true, "accelerator": accelerator]
        }
        let fallback = "Ctrl+Alt+Space"
        if accelerator != fallback, registerHotkey(fallback) {
            UserDefaults.standard.set(fallback, forKey: "pinkie.hotkey")
            return ["ok": true, "conflict": true, "accelerator": fallback]
        }
        return ["ok": false, "conflict": true, "error": "这个快捷键被别的程序占用了"]
    }

    private func toggleQuickAsk() {
        if let panel = quickPanel, panel.isVisible { panel.orderOut(nil); return }
        showQuickAsk()
    }

    private func showQuickAsk() {
        if quickPanel == nil { buildQuickPanel() }
        guard let panel = quickPanel else { return }
        quickModeLabel?.stringValue = currentModeLabel
        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: frame.midX - panel.frame.width / 2, y: frame.maxY - frame.height * 0.28))
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(quickField)
    }

    private func buildQuickPanel() {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 60),
                            styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView], backing: .buffered, defer: false)
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.hidesOnDeactivate = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { panel.standardWindowButton(button)?.isHidden = true }
        let effect = NSVisualEffectView(frame: panel.contentLayoutRect)
        effect.material = .popover
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 14
        effect.autoresizingMask = [.width, .height]
        let label = NSTextField(labelWithString: currentModeLabel)
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.textColor = NSColor(calibratedRed: 0.86, green: 0.33, blue: 0.56, alpha: 1)
        label.frame = NSRect(x: 16, y: 20, width: 64, height: 18)
        let field = NSTextField(frame: NSRect(x: 80, y: 14, width: 460, height: 30))
        field.placeholderString = "问碧琪…"
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 18)
        field.delegate = self
        effect.addSubview(label)
        effect.addSubview(field)
        panel.contentView = effect
        quickPanel = panel
        quickField = field
        quickModeLabel = label
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.cancelOperation(_:)) { quickPanel?.orderOut(nil); quickField?.stringValue = ""; return true }
        if selector == #selector(NSResponder.insertNewline(_:)) {
            let text = quickField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty else { return true }
            quickPanel?.orderOut(nil)
            quickField?.stringValue = ""
            showMain()
            emit(["type": "quickAsk", "mode": currentMode, "text": text])
            return true
        }
        return false
    }
}
