// macOS 启动器主入口（LauncherMain）与 AppDelegate 核心状态、菜单/全屏生命周期、自更新触发及网关监控。
import AppKit
import AVFoundation
import CommonCrypto
import Darwin
import Foundation
import Speech
import UserNotifications
import WebKit

@main
struct LauncherMain {
    static func main() {
        let arguments = CommandLine.arguments; if PinkieAppWindow.runIfRequested(arguments) { return }  // 装到桌面的作品：只开这件作品的窗口（AppWindow.swift）
        if let flag = arguments.firstIndex(of: "--update-progress"), flag + 1 < arguments.count {
            let app = NSApplication.shared
            let controller = UpdateProgressController(file: URL(fileURLWithPath: arguments[flag + 1]))
            // NSApp.delegate is weak. Without this, the card is freed before it appears.
            UpdateProgressHold.controller = controller
            app.setActivationPolicy(.regular)
            app.delegate = controller
            app.run()
            return
        }
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.mainMenu = makeMenu(delegate)
        app.run()
    }

    private static func makeMenu(_ delegate: AppDelegate) -> NSMenu {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "超級碧琪")
        let updateItem = appMenu.addItem(
            withTitle: "检查并安装更新…",
            action: #selector(AppDelegate.checkForUpdates(_:)),
            keyEquivalent: "u"
        )
        updateItem.target = delegate
        appMenu.addItem(.separator())
        let partyItem = appMenu.addItem(withTitle: "打开派对空间", action: #selector(AppDelegate.openParty(_:)), keyEquivalent: "p")
        partyItem.target = delegate
        // Do not occupy ⌘R. Users naturally use it to reload a stuck chat;
        // binding it to Roundtable made a normal refresh look like the App
        // had started or jumped to the wrong page.
        let roundtableItem = appMenu.addItem(withTitle: "打开灵感圆桌", action: #selector(AppDelegate.openRoundtable(_:)), keyEquivalent: "")
        roundtableItem.target = delegate
        let workspaceItem = appMenu.addItem(
            withTitle: "打开分屏工作区…",
            action: #selector(AppDelegate.openWorkspaceDockPicker(_:)),
            keyEquivalent: "n"
        )
        workspaceItem.keyEquivalentModifierMask = [.command, .shift]
        workspaceItem.target = delegate
        let browserItem = appMenu.addItem(
            withTitle: "打开浏览器工作区",
            action: #selector(AppDelegate.openBrowserWorkspaceFromMenu(_:)),
            keyEquivalent: "b"
        )
        browserItem.keyEquivalentModifierMask = [.command, .shift]
        browserItem.target = delegate
        let fullScreenItem = appMenu.addItem(
            withTitle: "切换全屏",
            action: #selector(AppDelegate.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        fullScreenItem.keyEquivalentModifierMask = [.command, .control]
        fullScreenItem.target = delegate
        appMenu.addItem(withTitle: "退出 超級碧琪", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)

        // Borderless windows do not receive macOS's stock menu bar. Provide
        // standard responder-chain actions so WKWebView text can use ⌘C/⌘V
        // and the Edit menu just like a normal native app.
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        menu.addItem(editItem)
        return menu
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate, UNUserNotificationCenterDelegate {
    var window: NSWindow?
    var webView: WKWebView?
    var windowDragArea: WindowDragArea?
    lazy var pinkieNative: PinkieNativeBridge = {
        let bridge = PinkieNativeBridge()
        bridge.mainWebView = { [weak self] in self?.webView }
        bridge.mainWindow = { [weak self] in self?.window }
        return bridge
    }()
    // The companion is deliberately another WKWebView inside the *same*
    // native window. It keeps a second mode/session truly independent while
    // the two chats stay visible as a real left/right split instead of a
    // floating mini window over the primary work.
    var companionPanel: NSView?
    var companionWebView: WKWebView?
    var companionModeID: String?
    // One browser workspace is shared by every chat mode. It lives beside the
    // primary WebView, so switching sessions cannot remount or erase the page.
    var browserPanel: NSView?
    var browserWebView: WKWebView?
    var browserWidthConstraint: NSLayoutConstraint?
    var browserWidthFraction: CGFloat = 0.44
    var browserPresentation: BrowserPresentation = .floating
    var browserFloatingFrame: NSRect?
    var browserDockEdge: BrowserDockEdge?
    var browserEdgeRevealed = false
    var browserEdgeTab: BrowserEdgeTab?
    var browserEdgeHoveringPanel = false
    var browserEdgeHoveringTab = false
    var browserEdgeHoverGeneration = 0
    var browserDragging = false
    var browserDragUnclampedFrame: NSRect?
    var workspacePresentationState: String?
    var browserFitEnabled = (UserDefaults.standard.object(forKey: "pinkie.browser.fitWindow") as? Bool) ?? true
    /// 内置浏览器的网页层强制深色：深色外观下，把仍然画白底的站点翻成深色。
    var browserForceDark = (UserDefaults.standard.object(forKey: "pinkie.browser.forceDark") as? Bool) ?? true
    var browserForceDarkItem: NSMenuItem?
    var browserFitWidth: CGFloat?
    var browserFitWork: DispatchWorkItem?
    var browserFitItem: NSMenuItem?
    var browserToolbarHovered = false
    var browserDragDelta = NSPoint.zero
    var browserDragDetached = false
    var browserFrameConstraints: [NSLayoutConstraint] = []
    var browserTitlebar: BrowserPanelDragHandle?
    var browserCorner: BrowserPanelResizeHandle?
    var browserFloatingResizeHandles: [BrowserPanelResizeHandle] = []
    var browserContentEdgeConstraints: [NSLayoutConstraint] = []
    var browserPresentationButtons: [BrowserPresentation: NSButton] = [:]
    var browserPresentationMenu: NSPopUpButton?
    var browserPresentationMenuItems: [BrowserPresentation: NSMenuItem] = [:]
    var browserStatusStack: NSStackView?
    private var fullScreenTransitionInProgress = false
    var browserAddressField: BrowserAddressField?
    var browserBackButton: NSButton?
    var browserForwardButton: NSButton?
    var browserReloadButton: NSButton?
    var browserCloseButton: NSButton?
    var browserExternalButton: NSButton?
    var browserLoadingIndicator: NSProgressIndicator?
    var browserStatusLabel: NSTextField?
    var browserActivityIndicator: BrowserActivityIndicator?
    var browserAgentActive = false
    var browserToolbarView: NSView?
    var browserResizeView: NSView?
    /// 网页的「配色」变成深色时由 laolaoWindowControl 告诉原生层，原生画的浏览器栏和分屏底色跟着换。
    var nightAppearance = false
    var lastBrowserURL: URL?
    var browserAnimationGeneration = 0
    var primaryFullSizeConstraints: [NSLayoutConstraint] = []
    // These lifetimes are independent: closing a browser must never remove
    // the companion chat's constraints, or vice versa.
    var chatLayoutConstraints: [NSLayoutConstraint] = []
    var companionContentConstraints: [NSLayoutConstraint] = []
    var browserLayoutConstraints: [NSLayoutConstraint] = []
    let primaryMinimumSize = NSSize(width: 860, height: 580)
    let splitMinimumSize = NSSize(width: 1180, height: 650)
    var retries = 0
    var companionRetries = 0
    var startupVideoStartedAt: Date?
    var dashboardLoadPending = false
    var releaseDashboardProbeGeneration = 0
    var releaseDashboardProbeStatus = ""
    let releaseDashboardProbeEnabled = ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true"
        && ProcessInfo.processInfo.environment["PINKIE_RELEASE_SMOKE"] == "1"
    private var gatewayMonitor: Timer?
    private var gatewayProbeFailures = 0
    private var gatewayProbeInFlight = false
    private var guardMonitor: Timer?
    private var guardAlertInFlight = false
    private var guardCounterVerified = false
    private var guardSeenAlertIDs: Set<String> = []
    let dictation = NativeDictationController()
    let dictationHandlerName = "laolaoNativeDictation"
    let liveSpeech = NativeLiveSpeechController()
    let liveSpeechHandlerName = "laolaoLiveVoice"
    let companionDictation = NativeDictationController()
    let companionLiveSpeech = NativeLiveSpeechController()
    let projectFolderHandlerName = "laolaoProjectFolder"
    let updateHandlerName = "laolaoUpdate"
    let workspaceDockHandlerName = "laolaoWorkspaceDock"
    let browserWorkspaceHandlerName = "laolaoBrowserWorkspace"
    let windowControlHandlerName = "laolaoWindowControl"
    let materialPreviewHandlerName = "laolaoMaterialPreview"
    /// 计划书 B 第三节：页面看不到时，碧琪做完 / 出错 / 等确认的系统通知（laolao-run-notify.js）。
    let runNotifyHandlerName = "pinkieNotify"
    private var updateLaunchInProgress = false
    private var updateStageTask: Process?
    private let party = PartyService()
    private let roundtable = RoundtableService()
    private let tts = TTSService()
    private let desktopControl = DesktopControlService()
    let browserControl = BrowserControlController()
    var browserControlForDialogs: BrowserControlController { browserControl }
    var browserWebViewForDialogs: WKWebView? { browserWebView }
    let browserEndpoint = BrowserControlEndpoint()
    var gptWebWorker: ChatGPTBackgroundWorker?
    var browserUserEventMonitor: Any?
    var chatGPTControlUntil = Date.distantPast
    let materialPreview = MaterialPreviewSchemeHandler()
    let materialPreviewAccess = MaterialPreviewFileAccess()
    let materialDownloadLock = NSLock()
    var materialDownloadContexts: [ObjectIdentifier: MaterialDownloadContext] = [:]
    var reservedDownloadPaths: Set<String> = []

    let workspaceSessions: [String: String] = [
        "chat": "agent:main:main",
        "project": "agent:project:main",
        "thinking": "agent:thinking:main",
        "learning": "agent:learning:main",
        "unrestricted": "agent:unrestricted:main",
        "metre": "agent:metre:main",
    ]

    private let workspaceLabels: [String: String] = [
        "chat": "唠嗑模式",
        "project": "项目模式",
        "thinking": "想法模式",
        "learning": "学习模式",
        "unrestricted": "无限制模式",
        "metre": "Metre",
    ]

    @objc func openParty(_ sender: Any?) {
        openParty(in: webView)
    }

    func openParty(in targetWebView: WKWebView?) {
        party.ready { [weak self] ready in
            if ready {
                self?.stopNativeInput(for: targetWebView)
                targetWebView?.load(URLRequest(url: PartyService.url))
            } else {
                let alert = NSAlert()
                alert.messageText = "派对服务还没准备好"
                alert.informativeText = "App 内置服务没有启动成功，请确认端口 18889 没有被其他程序占用。原来的四模式聊天不受影响。"
                alert.runModal()
            }
        }
    }

    @objc func openRoundtable(_ sender: Any?) {
        openRoundtable(in: webView)
    }

    func openRoundtable(in targetWebView: WKWebView?) {
        roundtable.ready { [weak self] ready in
            if ready {
                self?.stopNativeInput(for: targetWebView)
                targetWebView?.load(URLRequest(url: RoundtableService.url))
            } else {
                let alert = NSAlert()
                alert.messageText = "灵感圆桌还没准备好"
                alert.informativeText = "App 内置服务没有启动成功，请确认端口 18891 没有被其他程序占用。其他聊天不会受影响。"
                alert.runModal()
            }
        }
    }

    @objc func openWorkspaceDockPicker(_ sender: Any?) {
        let primaryMode = modeID(for: webView?.url) ?? "chat"
        let candidates = workspaceSessions.keys
            .filter { $0 != primaryMode }
            .sorted { (workspaceLabels[$0] ?? $0) < (workspaceLabels[$1] ?? $1) }
        guard !candidates.isEmpty else { return }

        let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 260, height: 28), pullsDown: false)
        for mode in candidates {
            picker.addItem(withTitle: workspaceLabels[mode] ?? mode)
            picker.lastItem?.representedObject = mode
        }
        if let learningIndex = candidates.firstIndex(of: "learning") {
            picker.selectItem(at: learningIndex)
        }

        let alert = NSAlert()
        alert.messageText = "分屏工作区"
        alert.informativeText = "在当前窗口右侧打开另一个独立模式。两边各自保留会话和记忆，互不打断。"
        alert.accessoryView = picker
        alert.addButton(withTitle: "打开")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn,
              let mode = picker.selectedItem?.representedObject as? String else { return }
        openWorkspaceDock(modeID: mode, requestedSessionKey: workspaceSessions[mode])
    }

    @objc func openBrowserWorkspaceFromMenu(_ sender: Any?) {
        openBrowserWorkspace(url: nil)
    }

    @objc func toggleFullScreen(_ sender: Any?) {
        window?.toggleFullScreen(sender)
    }

    func applicationWillTerminate(_ notification: Notification) {
        gatewayMonitor?.invalidate()
        gatewayMonitor = nil
        guardMonitor?.invalidate()
        guardMonitor = nil
        tts.stop()
        party.stop()
        roundtable.stop()
        desktopControl.stop()
        browserEndpoint.stop()
        materialPreview.clearThumbnailCache()
        if let browserUserEventMonitor { NSEvent.removeMonitor(browserUserEventMonitor) }
        // CLE Kk owns this private loopback gateway. Leaving it alive preserves
        // an expired desktop-driver socket and makes the next launch appear
        // connected while tools cannot act. Gateway.stop() is now bounded and
        // reaps only this Launcher's exact child process.
        Gateway.stop()
    }

    // 前后台通知: WKWebView 切后台会被 macOS 挂起 JS/网络, 网关 websocket
    // 悄悄断开 (1006), "回复完成"事件丢失, 前端动画永久转圈。
    // 主动通知前端, 让它回前台时重拉会话并复位"生成中"状态。
    func applicationDidResignActive(_ notification: Notification) {
        notifyWebView("pinkie:app-background")
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        clampWindowToVisibleScreen()
        notifyWebView("pinkie:app-foreground")
    }

    private func setFullScreenChrome(_ active: Bool) {
        guard let contentView = window?.contentView else { return }
        contentView.layer?.cornerRadius = active ? 0 : 22
        contentView.layer?.borderWidth = active ? 0 : 1
    }

    private func notifyFullScreenState(_ active: Bool) {
        let script = "window.dispatchEvent(new CustomEvent('pinkie:window-fullscreen',{detail:{active:\(active ? "true" : "false")}}));"
        [webView, companionWebView].compactMap { $0 }.forEach { target in
            target.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    func windowWillEnterFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = true
        setFullScreenChrome(true)
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = false
        updateBrowserWorkspaceWidth()
        notifyFullScreenState(true)
    }

    func windowWillExitFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = true
        notifyFullScreenState(false)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = false
        setFullScreenChrome(false)
        updateBrowserWorkspaceWidth()
        clampWindowToVisibleScreen()
    }

    func windowDidResize(_ notification: Notification) {
        windowDragArea?.invalidateRegions()
        updateBrowserWorkspaceWidth()
    }

    private func updateBrowserWorkspaceWidth() {
        guard let panel = browserPanel, panel.superview != nil, let bounds = window?.contentView?.bounds else { return }
        if browserPresentation == .side, let width = browserWidthConstraint {
            width.constant = browserDockedWidth(totalWidth: bounds.width, fraction: browserWidthFraction)
            updateBrowserToolbarLayout(width: width.constant)
        } else if browserPresentation == .floating {
            setBrowserFloatingFrame(BrowserWorkspaceGeometry.floatingFrame(in: bounds, proposed: browserFloatingFrame ?? panel.frame))
        }
        updateBrowserToolbarLayout(width: panel.bounds.width)
        scheduleBrowserFit()
    }

    private func clampWindowToVisibleScreen() {
        guard let window, let visible = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return }
        // A native full-screen window belongs to its Space. Constraining it to
        // visibleFrame (which excludes menu/Dock) shrinks it on activation.
        guard !fullScreenTransitionInProgress, !window.styleMask.contains(.fullScreen) else { return }
        let constrained = window.constrainFrameRect(window.frame, to: window.screen ?? NSScreen.main)
        if constrained != window.frame {
            window.setFrame(constrained, display: true, animate: false)
        } else if !visible.intersects(window.frame) {
            window.setFrameOrigin(NSPoint(x: visible.midX - window.frame.width / 2, y: visible.midY - window.frame.height / 2))
        }
    }

    private func notifyWebView(_ event: String) {
        let script = "window.dispatchEvent(new CustomEvent('\(event)'));"
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            [self.webView, self.companionWebView].compactMap { $0 }.forEach { target in
                target.evaluateJavaScript(script) { _, error in
                    if let error = error {
                        NSLog("[laolao] \(event) notify failed: %@", error.localizedDescription)
                    }
                }
            }
        }
    }

    func isCompanion(_ target: WKWebView?) -> Bool {
        guard let target, let companionWebView else { return false }
        return target === companionWebView
    }

    private func stopNativeInput(for target: WKWebView?) {
        if isCompanion(target) {
            companionDictation.stop()
            companionLiveSpeech.stop()
        } else {
            dictation.stop()
            liveSpeech.stop()
        }
    }

    func sessionKey(for url: URL?) -> String? {
        guard let url else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "session" })?.value
    }

    func modeID(for url: URL?) -> String? {
        guard let session = sessionKey(for: url) else { return nil }
        if session.hasPrefix("agent:main:") { return "chat" }
        return workspaceSessions.first(where: { session.hasPrefix($0.value.replacingOccurrences(of: ":main", with: ":")) })?.key
    }

    func isWorkspaceSession(_ sessionKey: String, for modeID: String) -> Bool {
        guard let rootSession = workspaceSessions[modeID] else { return false }
        let prefix = "\(String(rootSession.dropLast(5))):"
        return sessionKey.hasPrefix(prefix)
            && sessionKey.count > prefix.count
            && !sessionKey.contains(":subagent:")
    }

    func chatURL(sessionKey: String, docked: Bool = false) -> URL {
        var components = URLComponents(url: Gateway.defaultChatURL, resolvingAgainstBaseURL: false)
        var queryItems = [URLQueryItem(name: "session", value: sessionKey)]
        if docked {
            // The companion joins an already-running App. It must never replay
            // the first-entry movie or the web splash over the work area.
            queryItems.append(URLQueryItem(name: "laolao-dock", value: "1"))
        }
        components?.queryItems = queryItems
        return components?.url ?? Gateway.defaultChatURL
    }

    func trustedFrame(_ frame: WKFrameInfo) -> Bool {
        guard frame.isMainFrame, let url = frame.request.url else { return false }
        return [Gateway.url, PartyService.url, RoundtableService.url].contains { allowed in
            url.scheme == allowed.scheme && url.host == allowed.host && url.port == allowed.port
        }
    }

    @objc func checkForUpdates(_ sender: Any?) {
        guard !updateLaunchInProgress else { return }
        guard let webView else { legacyCheckForUpdates(); return }
        webView.evaluateJavaScript("Boolean(window.__pinkieUpdateDialog?.open())") { [weak self] value, _ in
            if (value as? Bool) != true { self?.legacyCheckForUpdates() }
        }
    }

    private func legacyCheckForUpdates() {
        guard !updateLaunchInProgress else { return }
        let confirmation = NSAlert()
        confirmation.messageText = "现在更新碧琪？"
        confirmation.informativeText = "确认后旧 App 会退出。独立更新程序会继续拉取、安装并重新打开；期间网关重启或页面断开都不会中止更新。人格、会话、项目、图片和视频不会参与替换。"
        confirmation.alertStyle = .informational
        confirmation.addButton(withTitle: "拉取并更新")
        confirmation.addButton(withTitle: "取消")
        guard confirmation.runModal() == .alertFirstButtonReturn else { return }
        _ = launchDetachedUpdate(prepared: false)
    }

    private func updateStateRoot() -> URL {
        if let configured = ProcessInfo.processInfo.environment["PINKIE_STATE_ROOT"], !configured.isEmpty {
            return URL(fileURLWithPath: configured, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SuperPinkie", isDirectory: true)
    }

    /// A copy of this executable, re-signed, so replacing the App bundle does not take the card with it.
    private func spawnUpdateProgress(executable: URL?, file: URL, folder: URL) {
        guard let executable else { return }
        let staged = folder.appendingPathComponent("PinkieUpdateProgress")
        do {
            if FileManager.default.fileExists(atPath: staged.path) { try FileManager.default.removeItem(at: staged) }
            try FileManager.default.copyItem(at: executable, to: staged)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: staged.path)
        } catch {
            NSLog("[laolao] update progress copy failed: %@", error.localizedDescription)
            return
        }
        let sign = Process()
        sign.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        sign.arguments = ["--force", "--sign", "-", staged.path]
        sign.standardInput = FileHandle.nullDevice
        sign.standardOutput = FileHandle.nullDevice
        sign.standardError = FileHandle.nullDevice
        if (try? sign.run()) != nil { sign.waitUntilExit() }
        let progress = Process()
        progress.executableURL = staged
        progress.arguments = ["--update-progress", file.path]
        progress.standardInput = FileHandle.nullDevice
        progress.standardOutput = FileHandle.nullDevice
        progress.standardError = FileHandle.nullDevice
        do { try progress.run() }
        catch { NSLog("[laolao] update progress did not start: %@", error.localizedDescription) }
    }

    @discardableResult private func launchDetachedUpdate(prepared: Bool) -> Bool {
        guard !updateLaunchInProgress, let root = BundledRuntime.resourceRoot else { return false }
        let bundledScript = root.appendingPathComponent("installer/macos/detached-update.sh")
        let stageScript = root.appendingPathComponent("installer/macos/stage-git-update.py")
        let updateRoot = updateStateRoot().appendingPathComponent("updates", isDirectory: true)
        if prepared && (!FileManager.default.fileExists(atPath: stageScript.path)
            || !FileManager.default.fileExists(atPath: updateRoot.appendingPathComponent("prepared-git.json").path)) { return false }
        let helper = updateRoot.appendingPathComponent("manual-update.sh")
        let task = Process()
        do {
            try FileManager.default.createDirectory(at: updateRoot, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: helper.path) { try FileManager.default.removeItem(at: helper) }
            try FileManager.default.copyItem(at: bundledScript, to: helper)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
            let progressFile = updateRoot.appendingPathComponent("progress.json")
            let initial = #"{"step":1,"total":5,"text":"正在退出旧版本","state":"running"}"#
            try initial.write(to: progressFile, atomically: true, encoding: .utf8)
            spawnUpdateProgress(executable: Bundle.main.executableURL, file: progressFile, folder: updateRoot)
            task.executableURL = URL(fileURLWithPath: "/bin/zsh")
            task.arguments = [helper.path, String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundleURL.path]
                + (prepared ? ["--prepared", stageScript.path] : [])
            var environment = BundledRuntime.environment()
            environment["PINKIE_UPDATE_PROGRESS_FILE"] = progressFile.path
            task.environment = environment
            task.standardInput = FileHandle.nullDevice
            task.standardOutput = FileHandle.nullDevice
            task.standardError = FileHandle.nullDevice
            try task.run()
            updateLaunchInProgress = true
            notifyWebView("pinkie:update-detached")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { NSApp.terminate(nil) }
            return true
        } catch {
            if !prepared { NSAlert(error: error).runModal() }
            return false
        }
    }

    private func sendUpdateResult(_ request: Int, _ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__pinkieUpdateResult?.(\(request),\(json))", completionHandler: nil)
    }

    private func sendUpdateProgress(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__pinkieUpdateProgress?.(\(json))", completionHandler: nil)
    }

    func handleUpdateRequest(_ body: [String: Any]) {
        guard let action = body["action"] as? String, let request = body["request"] as? Int,
              request > 0, request < 1_000_000_000 else { return }
        if action == "apply" {
            guard updateStageTask == nil else { sendUpdateResult(request, ["started": false, "message": "更新仍在准备，请稍等。"]); return }
            let started = launchDetachedUpdate(prepared: true)
            sendUpdateResult(request, ["started": started, "message": started ? "" : "无法启动安装，请重新准备更新。"])
            return
        }
        guard ["check", "prepare"].contains(action), updateStageTask == nil,
              let root = BundledRuntime.resourceRoot, let python = BundledRuntime.pythonExecutable() else {
            sendUpdateResult(request, ["temporaryError": true, "message": "更新服务暂时不可用，请稍后重试。"]); return
        }
        let script = root.appendingPathComponent("installer/macos/stage-git-update.py")
        guard FileManager.default.fileExists(atPath: script.path) else {
            sendUpdateResult(request, ["temporaryError": true, "message": "更新组件缺失，请手动下载安装。"]); return
        }
        let task = Process(), pipe = Pipe()
        task.executableURL = python
        task.arguments = [script.path, action]
        var environment = BundledRuntime.environment()
        // 国内线路：更新弹窗里选了「国内线路」时，Git 走加速代理（见 stage-git-update.py）。
        if body["route"] as? String == "mirror" { environment["PINKIE_UPDATE_ROUTE"] = "mirror" }
        else { environment.removeValue(forKey: "PINKIE_UPDATE_ROUTE") }
        task.environment = environment
        task.standardInput = FileHandle.nullDevice
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do { try task.run(); updateStageTask = task }
        catch { sendUpdateResult(request, ["temporaryError": true, "message": "更新服务没有启动，请稍后重试。"]); return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var buffered = Data(), receivedResult = false
            while true {
                let part = pipe.fileHandleForReading.readData(ofLength: 4096)
                if part.isEmpty { break }
                buffered.append(part)
                if buffered.count > 1_048_576 { task.terminate(); break }
                while let newline = buffered.firstIndex(of: 10) {
                    let line = Data(buffered[..<newline]); buffered.removeSubrange(...newline)
                    guard let packet = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
                          let kind = packet["type"] as? String else { continue }
                    if kind == "progress", let event = packet["event"] as? [String: Any] {
                        DispatchQueue.main.async { self?.sendUpdateProgress(event) }
                    } else if kind == "result", let value = packet["value"] as? [String: Any] {
                        receivedResult = true
                        DispatchQueue.main.async { self?.sendUpdateResult(request, value) }
                    }
                }
            }
            task.waitUntilExit()
            let failedWithoutResult = !receivedResult
            DispatchQueue.main.async {
                self?.updateStageTask = nil
                if failedWithoutResult { self?.sendUpdateResult(request, ["temporaryError": true, "message": "更新服务中断，请稍后重试。"]) }
            }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 深色是出厂默认：没有存过偏好的设备（全新安装 / 首次启动）直接进深色。
        UserDefaults.standard.register(defaults: ["pinkie.appearanceMode": "dark"])
        UNUserNotificationCenter.current().delegate = self
        let appearanceMode = UserDefaults.standard.string(forKey: "pinkie.appearanceMode") ?? "system"
        nightAppearance = appearanceMode == "dark" || (appearanceMode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua)
        applyNightAppearance()
        let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let rect = NSRect(
            x: 0,
            y: 0,
            width: min(1280, visible.width),
            height: min(800, visible.height)
        )
        let window = LauncherWindow(
            contentRect: rect,
            styleMask: [.borderless, .resizable],
            backing: .buffered,
            defer: false
        )

        // A fully custom shell gives the entire window continuous rounded corners.
        window.isMovableByWindowBackground = false
        window.backgroundColor = .clear
        window.isOpaque = false
        // The stock black NSWindow shadow reads like a system frame against
        // the pink artwork. Keep the edge inside our own themed glass shell.
        window.hasShadow = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self
        window.minSize = primaryMinimumSize
        window.setFrame(window.constrainFrameRect(rect, to: NSScreen.main), display: false)
        window.center()

        let webView = makeChatWebView()

        guard let contentView = window.contentView else { return }
        contentView.wantsLayer = true
        // 透明窗口的原生底层必须保持透明；聊天可读性由网页里的淡玻璃气泡负责。
        // 若这里铺不透明底色，所有 CSS 透明面都会退化成整块粉色背景。
        contentView.layer?.backgroundColor = NSColor.clear.cgColor
        contentView.layer?.cornerRadius = 22
        contentView.layer?.cornerCurve = .continuous
        contentView.layer?.borderWidth = 1
        contentView.layer?.borderColor = NSColor(
            srgbRed: 217.0 / 255.0,
            green: 89.0 / 255.0,
            blue: 143.0 / 255.0,
            alpha: 0.24
        ).cgColor
        contentView.layer?.masksToBounds = true
        contentView.addSubview(webView)
        primaryFullSizeConstraints = [
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: contentView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ]
        NSLayoutConstraint.activate(primaryFullSizeConstraints)

        installWindowDragArea(in: contentView, primary: webView)

        self.window = window
        self.webView = webView
        self.dictation.webView = webView
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let commandHeld = event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command)
            if commandHeld && event.charactersIgnoringModifiers?.lowercased() == "q" {
                NSApp.terminate(nil)
                return nil
            }
            if commandHeld && event.charactersIgnoringModifiers?.lowercased() == "w" {
                self?.window?.close()
                return nil
            }
            // Escape belongs to the web page (dialogs, search), not app termination.
            return event
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        showStartupScreen()
        _ = pinkieNative // menu bar icon + global hotkey come up with the window
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            BundledSetup.apply()
            DispatchQueue.main.async {
                guard let self else { return }
                if self.checkSettingsGuard(startup: true) {
                    NSApp.terminate(nil)
                    return
                }
                self.startSettingsGuardMonitor()
                self.startBundledServices()
            }
        }
    }

    @discardableResult
    private func checkSettingsGuard(startup: Bool) -> Bool {
        guard !guardAlertInFlight, SettingsGuardNative.isReleaseBuild() else { return false }
        let stateRoot = SettingsGuardNative.stateRoot()
        if SettingsGuardNative.isUpdateInProgress(stateRoot: stateRoot) { return false }
        guardAlertInFlight = true
        defer { guardAlertInFlight = false }

        let guardDir = stateRoot.appendingPathComponent("guard", isDirectory: true)
        let alertURL = guardDir.appendingPathComponent("pending-alert.json")
        var pendingPayload: [String: Any]?
        if let data = try? Data(contentsOf: alertURL),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            try? FileManager.default.removeItem(at: alertURL)
            let id = (obj["id"] as? String) ?? ""
            if id.isEmpty || !guardSeenAlertIDs.contains(id) || (obj["limitReached"] as? Bool == true) {
                if !id.isEmpty { guardSeenAlertIDs.insert(id) }
                pendingPayload = obj
            }
        }

        if let identity = SettingsGuardNative.bundleIdentity() {
            let counterValid = SettingsGuardNative.verifyCounter(stateRoot: stateRoot, identity: identity)
            if counterValid {
                guardCounterVerified = true
            } else if guardCounterVerified || (startup && SettingsGuardNative.hasReceipt(stateRoot: stateRoot, identity: identity)) {
                SettingsGuardNative.lockTamperedCounter(stateRoot: stateRoot)
                if pendingPayload == nil {
                    pendingPayload = ["counterTampered": true, "limitReached": true]
                } else {
                    pendingPayload?["counterTampered"] = true
                    pendingPayload?["limitReached"] = true
                }
            }
        }

        guard let payload = pendingPayload else { return false }
        return SettingsGuardNative.presentAlert(from: payload)
    }

    private func startSettingsGuardMonitor() {
        guard guardMonitor == nil, SettingsGuardNative.isReleaseBuild() else { return }
        guardMonitor = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            guard let self else { return }
            if self.checkSettingsGuard(startup: false) {
                self.guardMonitor?.invalidate()
                self.guardMonitor = nil
                NSApp.terminate(nil)
            }
        }
    }

    // The production window and hidden integration checks use the same layer.
    private func installWindowDragArea(in content: NSView, primary: WKWebView) {
        windowDragArea?.removeFromSuperview()
        let dragArea = WindowDragArea(frame: .zero)
        dragArea.sourceWebView = primary
        dragArea.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(dragArea)
        NSLayoutConstraint.activate([
            dragArea.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            dragArea.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            dragArea.topAnchor.constraint(equalTo: content.topAnchor),
            dragArea.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        windowDragArea = dragArea
    }

    func makeChatWebView(docked: Bool = false) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(materialPreview, forURLScheme: "clekk-material")
        let controller = configuration.userContentController
        controller.add(self, name: dictationHandlerName)
        controller.add(self, name: liveSpeechHandlerName)
        controller.add(self, name: projectFolderHandlerName)
        controller.add(self, name: updateHandlerName)
        controller.add(self, name: workspaceDockHandlerName)
        controller.add(self, name: browserWorkspaceHandlerName)
        controller.add(self, name: windowControlHandlerName)
        controller.add(self, name: materialPreviewHandlerName)
        controller.add(self, name: runNotifyHandlerName)
        controller.add(self, name: "laolaoParty")
        controller.add(self, name: "laolaoRoundtable")
        controller.add(self, name: "pinkieMotion")
        controller.add(self, name: PinkieNativeBridge.handlerName)
        controller.addUserScript(WKUserScript(
            source: nativeDictationBridge,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
        if !docked {
            controller.addUserScript(WKUserScript(source: nativeWindowDragBridge,
                injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // Mark only the native shell. The web UI uses this to avoid whole-page
        // opacity animation while keeping its decorative motion intact.
        controller.addUserScript(WKUserScript(
            source: "window.__pinkieMacUpdaterV2 = \(docked ? "false" : "true"); window.__pinkieBootNight = \(nightAppearance ? "true" : "false"); document.documentElement.setAttribute('data-pinkie-native-glass', '1')",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        if !docked {
            // The primary view survives normal in-app navigation.  Keep its
            // compact split presentation across that navigation while a
            // companion is visible, without leaking the state into a future
            // app launch (sessionStorage is WebView-session only).
            controller.addUserScript(WKUserScript(
                source: "try { if (sessionStorage.getItem('laolao-primary-workspace-split') === '1') document.documentElement.setAttribute('data-laolao-workspace-split', '1'); } catch (_) {}",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }
        controller.addUserScript(WKUserScript(
            source: "try { if (sessionStorage.getItem('laolao-primary-browser-workspace') === '1') document.documentElement.setAttribute('data-laolao-browser-workspace', '1'); } catch (_) {}",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        if docked {
            controller.addUserScript(WKUserScript(
                source: "document.documentElement.setAttribute('data-laolao-workspace-dock', '1')",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            // Do not let WebKit derive a temporary opaque under-page colour
            // while its remote layer tree is being restored.
            webView.underPageBackgroundColor = .clear
        }
        return webView
    }

    private func showStartupScreen() {
        startupVideoStartedAt = Date()
        if let root = BundledRuntime.resourceRoot {
            let page = root.appendingPathComponent("ui/launcher-loading.html")
            if FileManager.default.fileExists(atPath: page.path) {
                webView?.loadFileURL(page, allowingReadAccessTo: root)
                return
            }
        }
        webView?.loadHTMLString("<html lang=\"zh-CN\"><body style=\"display:grid;place-items:center;height:100%;margin:0;background:#efcbd3;color:#76465f;font:14px -apple-system\">超級碧琪正在准备</body></html>", baseURL: nil)
    }

    private func startBundledServices() {
        desktopControl.start()
        configureBrowserControl()
        tts.ready { _ in }
        party.ready { _ in }
        roundtable.ready { _ in }

        Gateway.isReady { [weak self] ready in
            DispatchQueue.main.async {
                if ready {
                    self?.validateReadyGatewayAndLoad()
                    return
                }
                // A previous App instance may have left a healthy process in
                // restart drain. Wait for readyz instead of starting a second
                // process on the same port or killing the first one.
                Gateway.isReachable { [weak self] reachable in
                    DispatchQueue.main.async {
                        if !reachable { Gateway.start() }
                        self?.awaitGatewayAndLoad()
                    }
                }
            }
        }
    }

    private func activateGatewayDashboard() {
        startGatewayMonitor()
        loadDashboard()
    }

    private func validateReadyGatewayAndLoad() {
        Gateway.ensureCurrentRuntimeForReadyGateway { [weak self] result in
            switch result {
            case .acceptExisting:
                self?.activateGatewayDashboard()
            case .restarted:
                self?.awaitGatewayAndLoad()
            case .failed:
                self?.showGatewayRecoveryFailure()
            }
        }
    }

    private func awaitGatewayAndLoad() {
        Gateway.ready { [weak self] ready in
            if ready {
                self?.validateReadyGatewayAndLoad()
            } else {
                self?.showGatewayRecoveryFailure()
            }
        }
    }

    private func showGatewayRecoveryFailure() {
        let alert = NSAlert()
        alert.messageText = "超級碧琪的网关还在恢复中"
        alert.informativeText = Gateway.lastError ?? "网关正在完成上一轮工作，请稍后再试。详细信息保存在 ~/Library/Application Support/SuperPinkie/logs/gateway.log。"
        alert.alertStyle = .warning
        alert.runModal()
    }

    private func startGatewayMonitor() {
        guard gatewayMonitor == nil else { return }
        gatewayMonitor = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            guard let self, !self.gatewayProbeInFlight else { return }
            self.gatewayProbeInFlight = true
            Gateway.isReady { running in
                DispatchQueue.main.async {
                    if running {
                        self.gatewayProbeInFlight = false
                        self.gatewayProbeFailures = 0
                        return
                    }
                    // readyz can be false while the HTTP process is alive and
                    // safely draining/rebuilding. Do not kill it merely because
                    // a short probe failed; the native client will
                    // reconnect as soon as readyz turns true again.
                    Gateway.isReachable { [weak self] reachable in
                        DispatchQueue.main.async { [weak self] in
                            guard let self else { return }
                            self.gatewayProbeInFlight = false
                            if reachable || Gateway.processAlive() {
                                self.gatewayProbeFailures = 0
                                return
                            }
                            self.gatewayProbeFailures += 1
                            guard self.gatewayProbeFailures >= 2 else { return }
                            self.gatewayProbeFailures = 0
                            Gateway.repair()
                        }
                    }
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

}
