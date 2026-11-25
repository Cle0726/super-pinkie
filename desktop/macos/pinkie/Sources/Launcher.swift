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
        let arguments = CommandLine.arguments
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        if webView === browserWebView {
            scheduleBrowserFit()
            applyBrowserForceDark()
            browserControl.didFinish(navigation)
            updateBrowserControls()
            let host = webView.url?.host?.lowercased() ?? ""
            setBrowserStatus(host == "chatgpt.com" || host.hasSuffix(".chatgpt.com") ? "ChatGPT 已打开" : "", loading: false)
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.16
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                webView.animator().alphaValue = 1.0
            }
            return
        }
        if webView === self.webView || webView === companionWebView {
            syncWorkspacePresentation(force:true)
        }
        guard webView.url?.host == Gateway.url.host, webView.url?.port == Gateway.url.port else { return }
        // WebKit 导航结束后仍保持透明，避免重新加载时把系统玻璃背景盖成实心粉色。
        window?.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation?) {
        if webView === browserWebView { browserControl.didCommit(navigation) }
        else if webView === self.webView || webView === companionWebView {
            syncWorkspacePresentation(force:true)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        if webView === self.webView { windowDragArea?.invalidateRegions() }
        if webView === browserWebView {
            browserFitWork?.cancel()
            browserFitWidth = nil
            webView.pageZoom = 1
            browserControl.didStart(navigation)
            webView.alphaValue = 0.88
            setBrowserStatus("正在加载…", loading: true)
            updateBrowserControls()
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if webView === browserWebView, let url = navigationAction.request.url, url.isFileURL,
           (try? materialPreviewAccess.validatedFile(path: url.path)) == nil {
            setBrowserStatus("这个文件位置不能从浏览器打开。")
            decisionHandler(.cancel)
            return
        }
        if #available(macOS 11.3, *), MaterialDownloadPolicy.navigationActionRequiresDownload(navigationAction.shouldPerformDownload) {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if webView === browserWebView,
           let response = navigationResponse.response as? HTTPURLResponse,
           response.statusCode == 403,
           response.url?.host?.lowercased().hasSuffix("chatgpt.com") == true {
            // ChatGPT may briefly answer with a Cloudflare verification page.
            // Keep it loaded so the challenge can finish instead of replacing
            // the page with a silent white surface.
            setBrowserStatus("正在通过安全验证…", loading: true)
        }
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")
        if #available(macOS 11.3, *), MaterialDownloadPolicy.responseRequiresDownload(
            contentDisposition: disposition,
            canShowMIMEType: navigationResponse.canShowMIMEType
        ) {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        attach(download: download, to: webView)
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        attach(download: download, to: webView)
    }

    @available(macOS 11.3, *)
    private func attach(download: WKDownload, to sourceWebView: WKWebView) {
        materialDownloadContexts[ObjectIdentifier(download)] = MaterialDownloadContext(webView: sourceWebView)
        download.delegate = self
    }

    @available(macOS 11.3, *)
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
            materialDownloadLock.lock()
            let destination = MaterialPreviewFileAccess.uniqueDownloadURL(
                in: downloads,
                filename: suggestedFilename,
                reservedPaths: reservedDownloadPaths
            )
            reservedDownloadPaths.insert(destination.path)
            materialDownloadLock.unlock()
            let context = materialDownloadContexts[ObjectIdentifier(download)] ?? MaterialDownloadContext(webView: webView)
            context.destination = destination
            context.reservedPath = destination.path
            materialDownloadContexts[ObjectIdentifier(download)] = context
            completionHandler(destination)
        } catch {
            completionHandler(nil)
            showMaterialToast("无法准备下载文件夹，请检查磁盘空间和权限。", path: nil, in: webView)
        }
    }

    @available(macOS 11.3, *)
    func downloadDidFinish(_ download: WKDownload) {
        let context = materialDownloadContexts.removeValue(forKey: ObjectIdentifier(download))
        releaseDownloadReservation(context?.reservedPath)
        if let destination = context?.destination {
            showMaterialToast("已保存到「下载/\(destination.lastPathComponent)」", path: destination.path, in: context?.webView)
        }
    }

    @available(macOS 11.3, *)
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let context = materialDownloadContexts.removeValue(forKey: ObjectIdentifier(download))
        releaseDownloadReservation(context?.reservedPath)
        showMaterialToast("下载失败：\(MaterialPreviewUserMessage.text(for: error))", path: nil, in: context?.webView)
    }

    private func releaseDownloadReservation(_ path: String?) {
        guard let path else { return }
        materialDownloadLock.lock()
        reservedDownloadPaths.remove(path)
        materialDownloadLock.unlock()
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil,
              let url = navigationAction.request.url,
              ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        openBrowserWorkspace(url: url)
        return nil
    }

    @available(macOS 12.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(type == .microphone && trustedFrame(frame) ? .grant : .deny)
    }

    // MARK: 运行提醒（计划书 B 第三节）

    /// 网页 → 原生：{action:"status"} 只回报权限；{action:"request-permission"} 在碧琪问过、用户点「好呀」后才申请；
    /// 其余是一条通知 {title, body, sessionKey}，没授权就什么都不发。
    private func handleRunNotify(_ body: [String: Any]) {
        let center = UNUserNotificationCenter.current()
        switch body["action"] as? String {
        case "status":
            reportNotifyPermission()
        case "request-permission":
            center.requestAuthorization(options: [.alert, .sound]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.reportNotifyPermission() }
            }
        default:
            let title = String((body["title"] as? String ?? "超级碧琪").prefix(80))
            let text = String((body["body"] as? String ?? "").prefix(200))
            let sessionKey = String((body["sessionKey"] as? String ?? "").prefix(300))
            center.getNotificationSettings { settings in
                guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
                let content = UNMutableNotificationContent()
                content.title = title.isEmpty ? "超级碧琪" : title
                content.body = text
                content.sound = .default
                content.userInfo = ["sessionKey": sessionKey]
                // 同一个会话只留最新一条，不在通知中心堆起来。
                let id = "pinkie-run-" + (sessionKey.isEmpty ? UUID().uuidString : sessionKey)
                center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
            }
        }
    }

    private func reportNotifyPermission() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let state: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: state = "granted"
            case .denied: state = "denied"
            default: state = "default"
            }
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.__pinkieNotifyPermission?.('\(state)')", completionHandler: nil)
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // 只有页面看不到时网页才会发（例如窗口最小化但 App 仍在前台），这时也要显示出来。
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let key = response.notification.request.content.userInfo["sessionKey"] as? String ?? ""
        DispatchQueue.main.async { [weak self] in
            if let window = self?.window {
                if window.isMiniaturized { window.deminiaturize(nil) }
                window.makeKeyAndOrderFront(nil)
            }
            NSApp.activate(ignoringOtherApps: true)
            if !key.isEmpty, let data = try? JSONSerialization.data(withJSONObject: [key]),
               let json = String(data: data, encoding: .utf8) {
                self?.webView?.evaluateJavaScript("window.__laolaoSidebar?.navigateSession?.(\(json)[0])", completionHandler: nil)
            }
        }
        completionHandler()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "pinkieBrowserLayout" {
            guard message.webView === browserWebView, message.frameInfo.isMainFrame,
                  let body = message.body as? [String: Any],
                  let width = body["width"] as? Double, let viewport = body["viewport"] as? Double,
                  width.isFinite, viewport.isFinite, width > 0, viewport > 0, width < 100_000 else { return }
            // Preserve the natural fixed width after WebKit expands its CSS viewport at a smaller zoom.
            if width > viewport + 8 { browserFitWidth = CGFloat(width) }
            else if (browserWebView?.pageZoom ?? 1) >= 0.995 { browserFitWidth = nil }
            scheduleBrowserFit()
            return
        }
        guard trustedFrame(message.frameInfo) else { return }
        let sourceWebView = message.webView ?? webView
        if message.name == PinkieNativeBridge.handlerName {
            if let body = message.body as? [String: Any] { pinkieNative.handle(body, from: sourceWebView) }
            return
        }
        if message.name == "pinkieMotion" {
            // The in-app 减少动效 switch, not the OS flag, drives native motion too.
            if let body = message.body as? [String: Any], let reduce = body["reduce"] as? Bool { PinkieMotion.reduce = reduce }
            return
        }
        if message.name == windowControlHandlerName,
           message.webView === webView, message.frameInfo.isMainFrame,
           let body = message.body as? [String: Any], body["action"] as? String == "window-drag-regions" {
            guard let width = body["width"] as? Double, let height = body["height"] as? Double,
                  width.isFinite, height.isFinite, width > 0, height > 0,
                  width < 100_000, height < 100_000,
                  let reported = body["regions"] as? [[String: Double]], reported.count <= 12 else {
                windowDragArea?.invalidateRegions(); return
            }
            let regions: [NSRect] = reported.compactMap { entry in
                guard let x = entry["x"], let y = entry["y"], let w = entry["width"], let h = entry["height"],
                      [x,y,w,h].allSatisfy({ $0.isFinite }), x >= 0, y >= 0,
                      w >= 24, w <= 120, h > 0, h <= 20,
                      x+w <= width, y+h <= min(height,96) else { return nil }
                return NSRect(x:x,y:y,width:w,height:h)
            }
            windowDragArea?.update(regions: regions, viewport: NSSize(width:width,height:height))
            return
        }
        if message.name == "laolaoParty" { openParty(in: sourceWebView); return }
        if message.name == "laolaoRoundtable" { openRoundtable(in: sourceWebView); return }
        if message.name == updateHandlerName {
            if let body = message.body as? [String: Any], body["action"] as? String != "pull" {
                if message.webView === webView { handleUpdateRequest(body) }
            } else { checkForUpdates(nil) }
            return
        }
        if message.name == windowControlHandlerName,
           message.webView === webView,
           let body = message.body as? [String: Any],
           body["action"] as? String == "attention" {
            // 页面看不到时一轮结束：Dock 图标跳一下。App 在前台时 macOS 本来就不跳。
            if !NSApp.isActive { NSApp.requestUserAttention(.informationalRequest) }
            return
        }
        if message.name == runNotifyHandlerName, message.webView === webView,
           let body = message.body as? [String: Any] {
            handleRunNotify(body)
            return
        }
        if message.name == windowControlHandlerName,
           let body = message.body as? [String: Any],
           body["action"] as? String == "toggle-fullscreen" {
            toggleFullScreen(nil)
            return
        }
        if message.name == windowControlHandlerName,
           message.webView === webView,
           let body = message.body as? [String: Any],
           body["action"] as? String == "appearance",
           let dark = body["dark"] as? Bool {
            // 主聊天页决定全局外观；副屏的初始化消息不能把它改回旧配色。
            var modeChanged = false
            if let mode = body["mode"] as? String, ["light", "dark", "system"].contains(mode) {
                modeChanged = mode != UserDefaults.standard.string(forKey: "pinkie.appearanceMode")
                UserDefaults.standard.set(mode, forKey: "pinkie.appearanceMode")
            }
            if dark != nightAppearance || modeChanged {
                nightAppearance = dark
                applyNightAppearance()
            }
            return
        }
        if message.name == browserWorkspaceHandlerName,
           let body = message.body as? [String: Any] {
            if body["action"] as? String == "show-file" {
                showBrowserFile(body["path"] as? String ?? "", sourceWebView: sourceWebView)
                return
            }
            if body["action"] as? String == "open" {
                let requestedURL = (body["url"] as? String).flatMap { browserURL(from: $0) }
                openBrowserWorkspace(url: requestedURL)
                return
            }
            if body["action"] as? String == "reset-chatgpt-session" {
                resetChatGPTBrowserSession()
                return
            }
            if body["action"] as? String == "chatgpt-control" {
                handleChatGPTControl(body, sourceWebView: sourceWebView)
                return
            }
        }
        if message.name == materialPreviewHandlerName,
           let body = message.body as? [String: Any],
           let action = body["action"] as? String,
           let path = body["path"] as? String,
           !path.isEmpty {
            handleMaterialFileAction(action, path: path, requestId: body["requestId"] as? String ?? "", sourceWebView: sourceWebView)
            return
        }
        if message.name == workspaceDockHandlerName,
           let body = message.body as? [String: Any],
           let action = body["action"] as? String {
            switch action {
            case "open":
                guard let requestedModeID = body["mode"] as? String else { return }
                openWorkspaceDock(
                    modeID: requestedModeID,
                    requestedSessionKey: body["sessionKey"] as? String
                )
            case "close":
                closeWorkspaceDock(nil)
            default:
                break
            }
            return
        }
        if message.name == projectFolderHandlerName,
           let body = message.body as? [String: Any],
           let action = body["action"] as? String {
            handleProjectFolderAction(action, body: body, sourceWebView: sourceWebView)
            return
        }

        if message.name == liveSpeechHandlerName,
           let body = message.body as? [String: Any] {
            let targetSpeech = isCompanion(sourceWebView) ? companionLiveSpeech : liveSpeech
            if body["action"] as? String == "stop" {
                targetSpeech.stop()
                return
            }
            if let text = body["text"] as? String {
                targetSpeech.enqueue(text)
            }
            return
        }

        if message.name == dictationHandlerName,
           let body = message.body as? [String: Any],
           let action = body["action"] as? String {
            switch action {
            case "start":
                if isCompanion(sourceWebView) {
                    // There is one physical microphone. Move the capture to
                    // the pane the user just pressed instead of letting two
                    // independent modes compete for it.
                    dictation.stop()
                    companionDictation.start(baseDraft: body["draft"] as? String ?? "")
                } else {
                    companionDictation.stop()
                    dictation.start(baseDraft: body["draft"] as? String ?? "")
                }
            case "stop":
                if isCompanion(sourceWebView) { companionDictation.stop() }
                else { dictation.stop() }
            default:
                break
            }
        }
    }

    private func handleProjectFolderAction(_ action: String, body: [String: Any], sourceWebView: WKWebView?) {
        switch action {
        case "choose":
            let requestId = body["requestId"] as? String ?? UUID().uuidString
            let panel = NSOpenPanel()
            panel.title = "选择项目文件夹"
            switch body["context"] as? String {
            case "party":
                panel.message = "选择派对项目的位置，也可以点“新建文件夹”。不同群聊各自管理项目。"
            case "roundtable":
                panel.message = "选择圆桌要完成工作的项目文件夹。工具和文件操作只会发生在这个目录里。"
            default:
                panel.message = "选择一个文件夹，碧琪会把它放进左侧项目栏。"
            }
            panel.prompt = "选择"
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.canCreateDirectories = true
            panel.resolvesAliases = true
            if let rawPath = body["path"] as? String, !rawPath.isEmpty {
                var isDirectory: ObjCBool = false
                if FileManager.default.fileExists(atPath: rawPath, isDirectory: &isDirectory), isDirectory.boolValue {
                    panel.directoryURL = URL(fileURLWithPath: rawPath, isDirectory: true)
                }
            }

            let completion: (NSApplication.ModalResponse) -> Void = { [weak self] response in
                guard let self else { return }
                guard response == .OK, let url = panel.url else {
                    self.sendProjectFolderResult([
                        "requestId": requestId,
                        "cancelled": true,
                    ], to: sourceWebView)
                    return
                }
                self.sendProjectFolderResult([
                    "requestId": requestId,
                    "cancelled": false,
                    "path": url.path,
                    "name": url.lastPathComponent,
                ], to: sourceWebView)
            }
            if let window {
                panel.beginSheetModal(for: window, completionHandler: completion)
            } else {
                completion(panel.runModal())
            }

        case "reveal":
            guard let path = body["path"] as? String, !path.isEmpty else { return }
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else {
                return
            }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path, isDirectory: true)])

        default:
            break
        }
    }

    private func handleMaterialFileAction(_ action: String, path: String, requestId: String, sourceWebView: WKWebView?) {
        switch action {
        case "check":
            do {
                let file = try materialPreviewAccess.previewFile(path: path)
                sendMaterialPreviewResult(["ok": true, "requestId": requestId, "name": file.url.lastPathComponent, "kind": file.kind.rawValue, "size": file.size], to: sourceWebView)
            } catch {
                sendMaterialPreviewResult(["ok": false, "requestId": requestId, "message": error.localizedDescription], to: sourceWebView)
            }

        case "describe":
            materialPreview.describe(path: path) { [weak self, weak sourceWebView] result in
                var payload = result
                payload["requestId"] = requestId
                self?.sendMaterialPreviewResult(payload, to: sourceWebView)
            }

        case "open", "preview":
            var payload = materialPreview.register(path: path)
            payload["requestId"] = requestId
            sendMaterialPreviewResult(payload, to: sourceWebView)

        case "save":
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                do {
                    let source = try self.materialPreviewAccess.validatedFile(path: path)
                    let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
                        ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads", isDirectory: true)
                    try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
                    self.materialDownloadLock.lock()
                    let destination = MaterialPreviewFileAccess.uniqueDownloadURL(
                        in: downloads,
                        filename: source.lastPathComponent,
                        reservedPaths: self.reservedDownloadPaths
                    )
                    self.reservedDownloadPaths.insert(destination.path)
                    self.materialDownloadLock.unlock()
                    defer { self.releaseDownloadReservation(destination.path) }
                    try FileManager.default.copyItem(at: source, to: destination)
                    DispatchQueue.main.async {
                        self.sendMaterialPreviewResult(["ok": true, "requestId": requestId, "path": destination.path], to: sourceWebView)
                    }
                } catch {
                    DispatchQueue.main.async {
                        self.sendMaterialPreviewResult(["ok": false, "requestId": requestId, "message": MaterialPreviewUserMessage.text(for: error)], to: sourceWebView)
                    }
                }
            }

        case "reveal", "open-default":
            do {
                let file = try materialPreviewAccess.validatedFile(path: path)
                if action == "reveal" {
                    NSWorkspace.shared.activateFileViewerSelecting([file])
                    sendMaterialPreviewResult(["ok": true, "requestId": requestId], to: sourceWebView)
                } else if !MaterialPreviewFileAccess.canOpenWithDefaultApp(file) {
                    sendMaterialPreviewResult(["ok": false, "requestId": requestId, "message": "为了安全，这类文件不直接打开；可以在访达中显示后自己处理。"], to: sourceWebView)
                } else if NSWorkspace.shared.open(file) {
                    sendMaterialPreviewResult(["ok": true, "requestId": requestId], to: sourceWebView)
                } else {
                    sendMaterialPreviewResult(["ok": false, "requestId": requestId, "message": "macOS 没有找到能打开这个文件的应用。"], to: sourceWebView)
                }
            } catch {
                sendMaterialPreviewResult(["ok": false, "requestId": requestId, "message": MaterialPreviewUserMessage.text(for: error)], to: sourceWebView)
            }

        default:
            sendMaterialPreviewResult(["ok": false, "requestId": requestId, "message": "不支持这个文件操作。"], to: sourceWebView)
        }
    }

    private func showMaterialToast(_ message: String, path: String?, in targetWebView: WKWebView?) {
        guard let targetWebView,
              let data = try? JSONSerialization.data(withJSONObject: [
                "message": message,
                "path": path as Any? ?? NSNull(),
                "actionLabel": "在访达中显示",
              ]),
              let json = String(data: data, encoding: .utf8) else { return }
        targetWebView.evaluateJavaScript("window.__laolaoMaterialPreviewToast?.(\(json));")
    }

    private func sendProjectFolderResult(_ payload: [String: Any], to targetWebView: WKWebView?) {
        guard let targetWebView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        targetWebView.evaluateJavaScript("window.__laolaoProjectFolderResult?.(\(json));")
    }

    private func sendMaterialPreviewResult(_ payload: [String: Any], to targetWebView: WKWebView?) {
        guard let targetWebView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        targetWebView.evaluateJavaScript("window.__laolaoMaterialPreviewResult?.(\(json));")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        if webView === browserWebView {
            browserControl.didFinish(navigation, error: error)
            webView.alphaValue = 1.0
            updateBrowserControls()
            browserErrorPage(error)
            return
        }
        if isCompanion(webView) {
            guard companionRetries < 8 else { return }
            companionRetries += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self, weak webView] in
                guard let self,
                      let webView,
                      self.companionWebView === webView,
                      let mode = self.companionModeID,
                      let session = self.workspaceSessions[mode] else { return }
                webView.load(URLRequest(url: self.chatURL(sessionKey: session, docked: true)))
            }
            return
        }
        guard retries < 8 else { return }
        retries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
            self?.loadDashboard()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        guard webView === browserWebView else { return }
        browserControl.didFinish(navigation, error: error)
        webView.alphaValue = 1.0
        updateBrowserControls()
        browserErrorPage(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === browserWebView else { return }
        setBrowserStatus("页面恢复中…", loading: true)
        if let lastBrowserURL { loadBrowserURL(lastBrowserURL) }
        else { webView.reload() }
    }

    var nativeWindowDragBridge: String {
        #"""
        (() => {
          const bridge = window.webkit?.messageHandlers?.laolaoWindowControl;
          if (!bridge) return;
          const headers = '.topbar, .pk-workspace-header, .pk-wb-tabs';
          const interactive = 'button,a,input,textarea,select,summary,details,[role="button"],[role="tab"],[role="menuitem"],[tabindex],[contenteditable],[onclick],[draggable="true"],.pk-wb-tabs__list,.pk-workspace-header__identity';
          const observed = new Set();
          let timer = 0, previous = '';
          const visible = node => {
            const r = node.getBoundingClientRect(), s = getComputedStyle(node);
            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) !== 0;
          };
          const resize = new ResizeObserver(() => schedule());
          const report = () => {
            timer = 0;
            const regions = [], current = new Set();
            for (const header of document.querySelectorAll(headers)) {
              current.add(header);
              if (!observed.has(header)) { observed.add(header); resize.observe(header); }
              if (!visible(header)) continue;
              const r = header.getBoundingClientRect();
              if (r.top < 0 || r.top > 72 || r.height > 80) continue;
              let intervals = [[Math.max(0,r.left)+8,Math.min(innerWidth,r.right)-8]];
              // Reserve each control's entire column, including its corners.
              for (const control of header.querySelectorAll(interactive)) {
                if (!visible(control)) continue;
                const c = control.getBoundingClientRect(), left = c.left-6, right = c.right+6;
                intervals = intervals.flatMap(([a,b]) => right <= a || left >= b ? [[a,b]] : [[a,Math.min(b,left)],[Math.max(a,right),b]].filter(([x,y]) => y-x >= 24));
              }
              const height = Math.min(16,r.height-12), y = r.top+(r.height-height)/2;
              if (height <= 0 || y+height > Math.min(innerHeight,96)) continue;
              // A small positive target avoids an invisible all-width drag strip.
              for (const [a,b] of intervals.sort((a,b) => (b[1]-b[0])-(a[1]-a[0]))) {
                const width = Math.min(120,b-a);
                if (width < 24) continue;
                const x = a+(b-a-width)/2;
                const clear = [x+1,x+width/2,x+width-1].every(px => [y+1,y+height/2,y+height-1].every(py => {
                  const hit = document.elementFromPoint(px,py);
                  return hit && (hit === header || header.contains(hit)) && !hit.closest(interactive);
                }));
                if (clear) { regions.push({x,y,width,height}); break; }
              }
            }
            for (const node of observed) if (!current.has(node)) { resize.unobserve(node); observed.delete(node); }
            const payload = {action:'window-drag-regions',width:innerWidth,height:innerHeight,regions:regions.slice(0,12)};
            const signature = JSON.stringify(payload);
            if (signature !== previous) { previous = signature; bridge.postMessage(payload); }
          };
          function schedule() { if (!timer) timer = setTimeout(report,40); }
          new MutationObserver(records => {
            if (records.some(record => record.type === 'childList' || record.target === document.documentElement || record.target === document.body || record.target.closest?.(headers+', [role="menu"], [role="dialog"], .popover'))) schedule();
          }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','open','data-pinkie-wb','data-pinkie-sidebar-auto','data-pk-wb-view']});
          addEventListener('resize',() => { previous = ''; schedule(); });
          addEventListener('scroll',schedule,true);
          addEventListener('pageshow',() => { previous = ''; schedule(); });
          schedule();
        })();
        """#
    }

    var nativeDictationBridge: String {
        #"""
        (() => {
          const buttonId = "laolao-native-dictation";
          let active = false;
          let baseDraft = { value: "" };

          const textForState = () => active ? "收好啦" : "碧琪听着呢";
          const updateButton = (message) => {
            const button = document.getElementById(buttonId);
            if (!button) return;
            button.classList.toggle("is-recording", active);
            button.setAttribute("aria-label", message || textForState());
            button.title = message || textForState();
            const label = button.querySelector(".agent-chat__control-label");
            if (label) label.textContent = message || textForState();
          };

          const editor = () => document.querySelector(".agent-chat__composer-combobox textarea");
          const setDraft = (transcript) => {
            const input = editor();
            if (!input || typeof transcript !== "string") return;
            input.value = `${baseDraft.value}${transcript}`;
            input.dataset.laolaoVoiceDraft = "1";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            window.dispatchEvent(new CustomEvent("laolao:dictation-draft"));
          };

          const ensureButton = () => {
            const actions = document.querySelector(".agent-chat__composer-actions");
            if (!actions || document.getElementById(buttonId)) return;
            const button = document.createElement("button");
            button.id = buttonId;
            button.type = "button";
            button.className = "chat-send-btn chat-send-btn--laolao-dictation";
            button.innerHTML = '<svg class="laolao-dictation-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="3" width="7" height="11" rx="3.5"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"></path></svg><span class="agent-chat__control-label"></span>';
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!window.webkit?.messageHandlers?.laolaoNativeDictation) return;
              if (active) {
                window.webkit.messageHandlers.laolaoNativeDictation.postMessage({ action: "stop" });
              } else {
                baseDraft.value = editor()?.value || "";
                window.webkit.messageHandlers.laolaoNativeDictation.postMessage({ action: "start", draft: baseDraft.value });
              }
            });
            actions.prepend(button);
            updateButton();
          };

          const ensureUpdateButton = () => {
            const actions = document.querySelector(".sidebar-footer-actions");
            if (!actions || document.getElementById("pinkie-manual-update")) return;
            const button = document.createElement("button");
            button.id = "pinkie-manual-update";
            button.type = "button";
            button.className = "sidebar-brand__icon sidebar-footer-icon";
            button.setAttribute("aria-label", "主动拉取更新");
            button.title = "主动拉取更新";
            button.textContent = "↻";
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              window.webkit?.messageHandlers?.laolaoUpdate?.postMessage({ action: "pull" });
            });
            actions.prepend(button);
          };

          const updateFullScreenButton = (active) => {
            const button = document.getElementById("pinkie-window-fullscreen");
            if (!button) return;
            const label = active ? "退出全屏 (Esc)" : "进入全屏 (⌃⌘F)";
            button.setAttribute("aria-label", label);
            button.title = label;
            button.classList.toggle("is-active", active);
          };

          const ensureFullScreenButton = () => {
            const actions = document.querySelector(".sidebar-footer-bar");
            if (!actions || document.getElementById("pinkie-window-fullscreen")) return;
            const button = document.createElement("button");
            button.id = "pinkie-window-fullscreen";
            button.type = "button";
            button.className = "sidebar-brand__icon sidebar-footer-icon";
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"><path d="M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4"></path></svg>';
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              window.webkit?.messageHandlers?.laolaoWindowControl?.postMessage({ action: "toggle-fullscreen" });
            });
            actions.prepend(button);
            updateFullScreenButton(false);
          };

          window.addEventListener("pinkie:window-fullscreen", (event) => {
            updateFullScreenButton(event.detail?.active === true);
          });

          window.__laolaoNativeDictationUpdate = (payload) => {
            if (!payload || typeof payload !== "object") return;
            if (typeof payload.transcript === "string") setDraft(payload.transcript);
            if (payload.state === "recording") active = true;
            if (payload.state === "idle" || payload.state === "error") active = false;
            ensureButton();
            updateButton(payload.message || "");
          };

          ensureButton();
          ensureUpdateButton();
          ensureFullScreenButton();
          new MutationObserver(() => { ensureButton(); ensureUpdateButton(); ensureFullScreenButton(); })
            .observe(document.documentElement, { childList: true, subtree: true });
        })();
        """#
    }
}

// 内置浏览器里的 alert / confirm / prompt（11-17）。没有这几个回调时 WebKit 直接当「取消」处理，
// 页面上「确定删除吗？」之类的确认永远不会成功。碧琪 / Metre 的操作引起的由 BrowserControl 按要求自动答；
// 用户自己点出来的弹正常的系统对话框。App 自己的界面不变（保持原来的默认行为）。
extension AppDelegate {
    private func browserDialog(_ webView: WKWebView, message: String, buttons: [String], field: String? = nil, done: @escaping (Bool, String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = webView.url?.host ?? "网页"
        alert.informativeText = message
        for title in buttons { alert.addButton(withTitle: title) }
        let input = field.map { value -> NSTextField in
            let box = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24)); box.stringValue = value; return box
        }
        if let input { alert.accessoryView = input }
        let finish: (NSApplication.ModalResponse) -> Void = { response in done(response == .alertFirstButtonReturn, input?.stringValue) }
        if let window = webView.window { alert.beginSheetModal(for: window, completionHandler: finish) }
        else { finish(alert.runModal()) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard webView === browserWebViewForDialogs else { completionHandler(); return }
        if browserControlForDialogs.answerDialog(kind: "alert", message: message, defaultText: nil) != nil { completionHandler(); return }
        browserDialog(webView, message: message, buttons: ["好"]) { _, _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard webView === browserWebViewForDialogs else { completionHandler(false); return }
        if let answer = browserControlForDialogs.answerDialog(kind: "confirm", message: message, defaultText: nil) { completionHandler(answer.accept); return }
        browserDialog(webView, message: message, buttons: ["确定", "取消"]) { ok, _ in completionHandler(ok) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard webView === browserWebViewForDialogs else { completionHandler(nil); return }
        if let answer = browserControlForDialogs.answerDialog(kind: "prompt", message: prompt, defaultText: defaultText) {
            completionHandler(answer.accept ? (answer.text ?? defaultText ?? "") : nil); return
        }
        browserDialog(webView, message: prompt, buttons: ["确定", "取消"], field: defaultText ?? "") { ok, text in completionHandler(ok ? (text ?? "") : nil) }
    }
}
