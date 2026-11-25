// AppDelegate WebKit 导航/下载/弹窗代理、JS 消息桥（项目目录、素材预览、运行通知）与系统通知回调。
import AppKit
import AVFoundation
import CommonCrypto
import Darwin
import Foundation
import Speech
import UserNotifications
import WebKit

extension AppDelegate {
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
