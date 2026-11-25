// AppDelegate 浏览器工作区停靠/悬浮/全屏布局切换、分屏伴侣工作区与仪表盘加载探针。
import AppKit
import AVFoundation
import CommonCrypto
import Darwin
import Foundation
import Speech
import UserNotifications
import WebKit

extension AppDelegate {
    @objc func browserDocked(_ sender: Any?) { changeBrowserPresentation(.side) }
    @objc func browserFloating(_ sender: Any?) { changeBrowserPresentation(.floating) }
    @objc func browserFull(_ sender: Any?) { changeBrowserPresentation(.full) }

    private func changeBrowserPresentation(_ mode: BrowserPresentation) {
        guard browserPanel?.superview != nil, let content = window?.contentView, let primary = webView else { return }
        browserAnimationGeneration += 1
        browserPanel?.layer?.removeAllAnimations()
        browserPresentation = mode
        applyBrowserPresentation(in: content, primary: primary)
        content.layoutSubtreeIfNeeded()
    }

    func browserDockedWidth(totalWidth: CGFloat, fraction: CGFloat) -> CGFloat {
        guard companionPanel?.superview != nil else {
            return BrowserWorkspaceGeometry.browserWidth(totalWidth: totalWidth, fraction: fraction)
        }
        // Keep both chats useful. On a small display the browser keeps its
        // 360pt toolbar and the two responsive chats share the remaining space.
        let minimum = min(360, max(0,totalWidth))
        let maximum = max(minimum,totalWidth-860)
        return min(maximum,max(minimum,totalWidth*fraction))
    }

    private func updateWorkspaceMinimumSize() {
        guard let window else { return }
        let requested = companionPanel?.superview != nil ? splitMinimumSize : primaryMinimumSize
        let screenSize = (window.screen ?? NSScreen.main)?.visibleFrame.size ?? requested
        window.minSize = NSSize(width:min(requested.width,screenSize.width),height:min(requested.height,screenSize.height))
    }

    private func updateWorkspaceZOrder(in content: NSView, primary: WKWebView) {
        if let companion = companionPanel, companion.superview === content {
            content.addSubview(companion, positioned:.above, relativeTo:primary)
        }
        if let drag = windowDragArea, drag.superview === content {
            content.addSubview(drag, positioned:.above, relativeTo:companionPanel?.superview === content ? companionPanel : primary)
        }
        if let browser = browserPanel, browser.superview === content {
            content.addSubview(browser, positioned:.above, relativeTo:nil)
        }
        if let tab = browserEdgeTab, tab.superview === content {
            content.addSubview(tab, positioned:.above, relativeTo:nil)
        }
    }

    func syncWorkspacePresentation(force: Bool = false) {
        let dualChat = companionPanel?.superview != nil && companionWebView != nil
        let browserSide = browserPanel?.superview != nil && browserPresentation == .side
        let state = "\(dualChat):\(browserSide)"
        guard force || workspacePresentationState != state else { return }
        workspacePresentationState = state
        func script(docked:Bool) -> String {
            """
            (()=>{const root=document.documentElement;if(!root)return;
            const set=(name,on)=>on?root.setAttribute(name,'1'):root.removeAttribute(name);
            set('data-laolao-workspace-split',\(!docked && dualChat ? "true" : "false"));
            set('data-laolao-workspace-dock',\(docked ? "true" : "false"));
            set('data-laolao-browser-workspace',\(browserSide ? "true" : "false"));
            try{const keep=(key,on)=>on?sessionStorage.setItem(key,'1'):sessionStorage.removeItem(key);
            keep('laolao-primary-workspace-split',\(!docked && dualChat ? "true" : "false"));
            keep('laolao-primary-browser-workspace',\(browserSide ? "true" : "false"));}catch(_){}
            })();
            """
        }
        webView?.evaluateJavaScript(script(docked:false),completionHandler:nil)
        if dualChat { companionWebView?.evaluateJavaScript(script(docked:true),completionHandler:nil) }
    }

    // Compose the three independent surfaces without remounting any WebView.
    // Only their outer constraints change; companion content stays attached.
    private func rebuildWorkspaceLayout(in content: NSView, primary: WKWebView) {
        NSLayoutConstraint.deactivate(chatLayoutConstraints + browserLayoutConstraints + primaryFullSizeConstraints)
        chatLayoutConstraints.removeAll()
        browserLayoutConstraints.removeAll()
        browserFrameConstraints.removeAll()
        browserWidthConstraint = nil
        let attachedBrowser = browserPanel.flatMap { $0.superview === content ? $0 : nil }
        let browserSide = attachedBrowser != nil && browserPresentation == .side
        if let browser = attachedBrowser {
            switch browserPresentation {
            case .side:
                let width = browser.widthAnchor.constraint(equalToConstant:browserDockedWidth(totalWidth:content.bounds.width,fraction:browserWidthFraction))
                browserWidthConstraint = width
                browserLayoutConstraints = [width,browser.trailingAnchor.constraint(equalTo:content.trailingAnchor),browser.topAnchor.constraint(equalTo:content.topAnchor),browser.bottomAnchor.constraint(equalTo:content.bottomAnchor)]
            case .full:
                browserLayoutConstraints = [browser.leadingAnchor.constraint(equalTo:content.leadingAnchor),browser.trailingAnchor.constraint(equalTo:content.trailingAnchor),browser.topAnchor.constraint(equalTo:content.topAnchor),browser.bottomAnchor.constraint(equalTo:content.bottomAnchor)]
            case .floating:
                let frame = BrowserWorkspaceGeometry.floatingFrame(in:content.bounds,proposed:browserFloatingFrame)
                browserFloatingFrame = frame
                let displayed = browserDockEdge.map { BrowserWorkspaceGeometry.edgeDockedFrame(in:content.bounds,frame:frame,edge:$0,revealed:browserEdgeRevealed) } ?? frame
                browserFrameConstraints = [browser.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:displayed.minX),browser.bottomAnchor.constraint(equalTo:content.bottomAnchor,constant:-displayed.minY),browser.widthAnchor.constraint(equalToConstant:displayed.width),browser.heightAnchor.constraint(equalToConstant:displayed.height)]
                browserLayoutConstraints = browserFrameConstraints
            }
        }
        let rightAnchor = browserSide ? attachedBrowser!.leadingAnchor : content.trailingAnchor
        let seam:CGFloat = browserSide ? 1 : 0
        if let companion = companionPanel, companion.superview === content {
            chatLayoutConstraints = [primary.leadingAnchor.constraint(equalTo:content.leadingAnchor),primary.topAnchor.constraint(equalTo:content.topAnchor),primary.bottomAnchor.constraint(equalTo:content.bottomAnchor),companion.leadingAnchor.constraint(equalTo:primary.trailingAnchor,constant:-1),companion.widthAnchor.constraint(equalTo:primary.widthAnchor),companion.trailingAnchor.constraint(equalTo:rightAnchor,constant:seam),companion.topAnchor.constraint(equalTo:content.topAnchor),companion.bottomAnchor.constraint(equalTo:content.bottomAnchor)]
        } else if browserSide {
            chatLayoutConstraints = [primary.leadingAnchor.constraint(equalTo:content.leadingAnchor),primary.topAnchor.constraint(equalTo:content.topAnchor),primary.bottomAnchor.constraint(equalTo:content.bottomAnchor),primary.trailingAnchor.constraint(equalTo:rightAnchor,constant:seam)]
        } else { NSLayoutConstraint.activate(primaryFullSizeConstraints) }
        NSLayoutConstraint.activate(browserLayoutConstraints + chatLayoutConstraints)
        updateWorkspaceMinimumSize()
        updateWorkspaceZOrder(in:content,primary:primary)
        syncWorkspacePresentation()
    }

    func applyBrowserPresentation(in content: NSView, primary: WKWebView) {
        guard let panel = browserPanel else { return }
        let previousFrame = panel.frame
        browserDragging = false; browserDragUnclampedFrame = nil
        if browserPresentation != .floating { clearBrowserEdgeDock() }
        rebuildWorkspaceLayout(in:content,primary:primary)
        let split = browserPresentation == .side
        browserResizeView?.isHidden = !split
        for handle in browserFloatingResizeHandles {
            handle.isHidden = browserPresentation != .floating || browserDockEdge != nil
            handle.enabled = browserPresentation == .floating && browserDockEdge == nil
        }
        let floatingInset: CGFloat = browserPresentation == .floating ? 8 : 0
        for (index, constraint) in browserContentEdgeConstraints.enumerated() { constraint.constant = index == 1 ? -floatingInset : floatingInset }
        browserTitlebar?.enabled = browserPresentation == .floating
        updateBrowserPanelInput()
        panel.layer?.cornerRadius = browserPresentation == .floating ? 14 : 0
        panel.layer?.borderWidth = browserPresentation == .floating ? 1 : 0
        panel.layer?.borderColor = NSColor.systemPink.withAlphaComponent(0.25).cgColor
        for (mode, button) in browserPresentationButtons { button.state = mode == browserPresentation ? .on : .off }
        for (mode, item) in browserPresentationMenuItems { item.state = mode == browserPresentation ? .on : .off }
        let toolbarWidth = browserPresentation == .side ? browserWidthConstraint?.constant ?? content.bounds.width : browserPresentation == .floating ? browserFloatingFrame?.width ?? content.bounds.width : content.bounds.width
        updateBrowserToolbarLayout(width: toolbarWidth)
        updateBrowserEdgeTab()
        applyNightAppearance()
        content.layoutSubtreeIfNeeded()
        if window?.isVisible == true, previousFrame.width > 0, let layer = panel.layer,
           !PinkieMotion.reduce, previousFrame != panel.frame {
            let position = layer.position
            let slide = CABasicAnimation(keyPath: "position")
            slide.fromValue = NSValue(point:NSPoint(x:position.x+previousFrame.minX-panel.frame.minX,y:position.y+previousFrame.minY-panel.frame.minY))
            slide.toValue = NSValue(point:position); slide.duration = 0.18
            slide.timingFunction = CAMediaTimingFunction(name:.easeOut)
            layer.add(slide,forKey:"browser-presentation-position")
        }
        scheduleBrowserFit()
    }

    func setBrowserFloatingFrame(_ frame: NSRect, animated: Bool = false) {
        guard browserPresentation == .floating, browserFrameConstraints.count == 4 else { return }
        browserFloatingFrame = frame
        let displayed = browserDockEdge.flatMap { edge in window?.contentView.map { BrowserWorkspaceGeometry.edgeDockedFrame(in: $0.bounds, frame: frame, edge: edge, revealed: browserEdgeRevealed) } } ?? frame
        browserFrameConstraints[0].constant = displayed.minX
        browserFrameConstraints[1].constant = -displayed.minY
        browserFrameConstraints[2].constant = displayed.width
        browserFrameConstraints[3].constant = displayed.height
        updateBrowserPanelInput()
        updateBrowserEdgeTab()
        if browserDragging {
            // Keep constraints valid between real mouse events. Moving the outer
            // frame does not resize or reload WebKit, and needs no window layout.
            browserPanel?.setFrameOrigin(displayed.origin)
            return
        }
        updateBrowserToolbarLayout(width: frame.width)
        if animated, window?.isVisible == true {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                context.allowsImplicitAnimation = true
                window?.contentView?.layoutSubtreeIfNeeded()
            }
        } else { window?.contentView?.layoutSubtreeIfNeeded() }
        scheduleBrowserFit()
    }
    func clearBrowserEdgeDock() {
        browserDockEdge = nil; browserEdgeRevealed = false
        updateBrowserPanelInput()
        browserEdgeHoveringPanel = false; browserEdgeHoveringTab = false
        browserEdgeHoverGeneration += 1
        if browserDragging { browserEdgeTab?.alphaValue = 0 }
        else { browserEdgeTab?.removeFromSuperview() }
        for handle in browserFloatingResizeHandles {
            handle.isHidden = browserPresentation != .floating
            handle.enabled = browserPresentation == .floating
        }
    }
    private func updateBrowserPanelInput() {
        let hidden = browserPresentation == .floating && browserDockEdge != nil && !browserEdgeRevealed
        (browserPanel as? BrowserPanelContainer)?.inputSuppressed = hidden
        browserPanel?.isHidden = hidden
        if hidden { browserEdgeHoveringPanel = false }
    }
    private func updateBrowserEdgeTab() {
        guard browserPresentation == .floating, let edge = browserDockEdge,
              let content = window?.contentView, let frame = browserFloatingFrame else {
            if browserDragging && browserDragDetached { browserEdgeTab?.alphaValue = 0 }
            else { browserEdgeTab?.removeFromSuperview() }
            return
        }
        let tab: BrowserEdgeTab
        if let existing = browserEdgeTab { tab = existing }
        else {
            tab = BrowserEdgeTab(frame: .zero)
            tab.onHover = { [weak self] hovering in
                self?.browserEdgeHoveringTab = hovering
                self?.updateBrowserEdgeHover()
            }
            tab.onDragBegan = { [weak self] in self?.beginBrowserFloatingDrag() }
            tab.onDrag = { [weak self] delta in self?.moveBrowserFloating(by: delta) }
            tab.onDragEnded = { [weak self] in self?.endBrowserFloatingDrag() }
            browserEdgeTab = tab
        }
        tab.edge = edge
        tab.alphaValue = 1
        if edge == .right {
            let height = min(100, frame.height-32)
            tab.frame = NSRect(x: content.bounds.maxX-20, y: frame.midY-height/2, width: 20, height: height)
        } else {
            let width = min(100, frame.width-32)
            tab.frame = NSRect(x: frame.midX-width/2, y: edge == .top ? content.bounds.maxY-20 : content.bounds.minY, width: width, height: 20)
        }
        if tab.superview == nil { content.addSubview(tab) }
        for handle in browserFloatingResizeHandles { handle.isHidden = true; handle.enabled = false }
    }
    func updateBrowserEdgeHover() {
        guard browserDockEdge != nil, !browserDragging else { return }
        browserEdgeHoverGeneration += 1
        let generation = browserEdgeHoverGeneration
        if browserEdgeHoveringPanel || browserEdgeHoveringTab {
            browserEdgeRevealed = true
            if let frame = browserFloatingFrame { setBrowserFloatingFrame(frame, animated: true) }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now()+0.22) { [weak self] in
                guard let self, generation == self.browserEdgeHoverGeneration,
                      self.browserDockEdge != nil, !self.browserDragging else { return }
                self.browserEdgeRevealed = false
                if let frame = self.browserFloatingFrame { self.setBrowserFloatingFrame(frame, animated: true) }
            }
        }
    }
    func beginBrowserFloatingDrag() {
        browserPanel?.layer?.removeAllAnimations()
        browserDragging = true; browserDragDelta = .zero; browserDragDetached = false
        browserDragUnclampedFrame = browserFloatingFrame
        browserEdgeHoverGeneration += 1
    }
    func endBrowserFloatingDrag() {
        browserDragging = false
        let proposed = browserDragUnclampedFrame
        browserDragUnclampedFrame = nil
        if let frame = browserFloatingFrame { setBrowserFloatingFrame(frame) }
        if browserDragDetached { browserEdgeTab?.removeFromSuperview() }
        guard browserPresentation == .floating, let bounds = window?.contentView?.bounds,
              let frame = browserFloatingFrame else { return }
        if browserDockEdge != nil { updateBrowserEdgeHover(); return }
        guard !browserDragDetached else { return }
        var candidates: [(BrowserDockEdge,CGFloat)] = []
        // Dock only after an intentional outward push beyond the window.
        // Merely reaching an edge during an ordinary move must remain floating.
        let pushed = proposed ?? frame
        if pushed.maxX >= bounds.maxX+52 && browserDragDelta.x > 0 { candidates.append((.right,pushed.maxX-bounds.maxX)) }
        // At the top of a full-screen window the pointer cannot travel past
        // the display. A short, predominantly upward push still reaches it.
        if pushed.maxY >= bounds.maxY+20 && browserDragDelta.y >= 28 && browserDragDelta.y >= abs(browserDragDelta.x)*1.25 { candidates.append((.top,pushed.maxY-bounds.maxY)) }
        if pushed.minY <= bounds.minY-52 && browserDragDelta.y < 0 { candidates.append((.bottom,bounds.minY-pushed.minY)) }
        let edge = candidates.max(by:{$0.1 < $1.1})?.0
        if let edge {
            browserDockEdge = edge; browserEdgeRevealed = false
            browserEdgeHoveringPanel = false; browserEdgeHoveringTab = false
            setBrowserFloatingFrame(frame, animated: true)
        }
    }
    func moveBrowserFloating(by delta: NSPoint) {
        guard browserPresentation == .floating, let bounds = window?.contentView?.bounds, var frame = browserFloatingFrame else { return }
        browserDragDelta.x += delta.x; browserDragDelta.y += delta.y
        if let edge = browserDockEdge {
            let inward = edge == .right ? browserDragDelta.x < -10 : edge == .top ? browserDragDelta.y < -10 : browserDragDelta.y > 10
            if inward {
                browserDragDetached = true; clearBrowserEdgeDock()
                browserDragUnclampedFrame = frame
            } else {
                if edge == .right { frame.origin.y += delta.y }
                else { frame.origin.x += delta.x }
                setBrowserFloatingFrame(BrowserWorkspaceGeometry.floatingFrame(in: bounds, proposed: frame))
                return
            }
        }
        frame = browserDragUnclampedFrame ?? frame
        frame.origin.x += delta.x; frame.origin.y += delta.y
        if browserDragging { browserDragUnclampedFrame = frame }
        setBrowserFloatingFrame(BrowserWorkspaceGeometry.floatingFrame(in: bounds, proposed: frame))
    }
    func resizeBrowserFloating(by delta: NSPoint, edges: BrowserResizeEdges = [.right, .bottom]) {
        guard browserPresentation == .floating, let bounds = window?.contentView?.bounds, let frame = browserFloatingFrame else { return }
        setBrowserFloatingFrame(BrowserWorkspaceGeometry.resizedFloatingFrame(in: bounds, frame: frame, edges: edges, delta: delta))
    }

    func detachBrowserWorkspace() {
        guard browserPanel?.superview != nil else { return }
        clearBrowserEdgeDock()
        browserAnimationGeneration += 1
        NSLayoutConstraint.deactivate(browserLayoutConstraints)
        browserLayoutConstraints.removeAll()
        browserWidthConstraint = nil
        browserFrameConstraints.removeAll()
        browserPanel?.removeFromSuperview()
        if let content = window?.contentView, let primary = webView {
            rebuildWorkspaceLayout(in:content,primary:primary)
            content.layoutSubtreeIfNeeded()
        }
        window?.makeFirstResponder(webView)
    }

    @objc func closeBrowserWorkspace(_ sender: Any?) {
        guard let panel = browserPanel, panel.superview != nil else { return }
        browserAnimationGeneration += 1
        let generation = browserAnimationGeneration
        let slide = CABasicAnimation(keyPath: "transform.translation.x")
        slide.fromValue = 0
        slide.toValue = 42
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1.0
        fade.toValue = 0.72
        let group = CAAnimationGroup()
        group.animations = [slide, fade]
        group.duration = 0.18
        group.timingFunction = CAMediaTimingFunction(name: .easeIn)
        panel.layer?.add(group, forKey: "laolao-browser-exit")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self, weak panel] in
            guard let self,
                  let panel,
                  self.browserAnimationGeneration == generation,
                  panel.superview != nil else { return }
            self.detachBrowserWorkspace()
        }
    }

    @objc func browserAddressSubmitted(_ sender: NSSearchField) {
        guard let url = browserURL(from: sender.stringValue) else { return }
        loadBrowserURL(url)
        window?.makeFirstResponder(browserWebView)
    }

    @objc func browserGoBack(_ sender: Any?) {
        browserWebView?.goBack()
    }

    @objc func browserGoForward(_ sender: Any?) {
        browserWebView?.goForward()
    }

    @objc func browserReload(_ sender: Any?) {
        if browserWebView?.url != nil { browserWebView?.reload() }
        else if let lastBrowserURL { loadBrowserURL(lastBrowserURL) }
    }

    @objc func browserOpenExternally(_ sender: Any?) {
        guard let url = browserWebView?.url ?? lastBrowserURL,
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        NSWorkspace.shared.open(url)
    }

    func openWorkspaceDock(modeID requestedModeID: String, requestedSessionKey: String?) {
        guard let canonicalSession = workspaceSessions[requestedModeID],
              requestedModeID != (modeID(for: webView?.url) ?? "chat"),
              let window,
              let contentView = window.contentView,
              let primaryWebView = webView else { return }
        let targetSession = requestedSessionKey ?? canonicalSession
        guard isWorkspaceSession(targetSession, for: requestedModeID) else { return }

        if let companionWebView {
            let alreadyShowing = companionModeID == requestedModeID && self.sessionKey(for: companionWebView.url) == targetSession
            companionModeID = requestedModeID
            // Two modes are enough for the focused workflow. Reusing this
            // dock changes only the companion route; it never reloads or
            // interrupts the primary chat.
            if alreadyShowing {
                window.makeFirstResponder(companionWebView)
                return
            }
            companionRetries = 0
            companionWebView.load(URLRequest(url: chatURL(sessionKey: targetSession, docked: true)))
            window.makeFirstResponder(companionWebView)
            return
        }

        companionModeID = requestedModeID

        let panel = NSView(frame: .zero)
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.wantsLayer = true
        panel.layer?.backgroundColor = NSColor(
            srgbRed: 1.0,
            green: 0.93,
            blue: 0.97,
            alpha: 0.52
        ).cgColor
        panel.layer?.borderWidth = 0
        panel.layer?.borderColor = NSColor(
            srgbRed: 0.84,
            green: 0.40,
            blue: 0.60,
            alpha: 0.28
        ).cgColor
        // Only the outer App frame is rounded. The split's inside edge stays
        // straight and continuous with the primary workspace.
        panel.layer?.masksToBounds = true

        let companion = makeChatWebView(docked: true)
        panel.addSubview(companion)
        // Keep both chats in the layout tree. The former overlay was only
        // 46% wide and 72% high, so the second pane could not be read.
        contentView.addSubview(panel)
        companionContentConstraints = [
            companion.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            companion.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            companion.topAnchor.constraint(equalTo: panel.topAnchor),
            companion.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
        ]
        NSLayoutConstraint.activate(companionContentConstraints)
        companionPanel = panel
        companionWebView = companion
        rebuildWorkspaceLayout(in:contentView,primary:primaryWebView)
        contentView.layoutSubtreeIfNeeded()

        // A normal 1280px window becomes two useful ~640px work areas. If it
        // had been shrunk, restore just enough room without exceeding screen.
        if window.isVisible, let screen = window.screen ?? NSScreen.main,
           window.frame.width < window.minSize.width || window.frame.height < window.minSize.height {
            var frame = window.frame
            frame.size.width = min(screen.visibleFrame.width, max(frame.width, window.minSize.width))
            frame.size.height = min(screen.visibleFrame.height, max(frame.height, window.minSize.height))
            window.setFrame(window.constrainFrameRect(frame, to: screen), display: true, animate: true)
        }

        applyNightAppearance()
        companionDictation.webView = companion
        // Both halves need the same compact chat presentation.  Leaving the
        // primary's full navigation rail visible at half width is what made
        // each reply collapse into a skinny vertical strip.
        companionRetries = 0
        Gateway.prepareNativeControlAuth(for: companion)
        companion.load(URLRequest(url: chatURL(sessionKey: targetSession, docked: true)))
        window.makeFirstResponder(companion)
    }

    @objc func closeWorkspaceDock(_ sender: Any?) {
        guard companionPanel?.superview != nil else { return }
        companionDictation.stop()
        companionLiveSpeech.stop()
        companionWebView?.stopLoading()
        companionWebView?.navigationDelegate = nil
        companionWebView?.uiDelegate = nil
        NSLayoutConstraint.deactivate(companionContentConstraints + chatLayoutConstraints)
        companionContentConstraints.removeAll()
        chatLayoutConstraints.removeAll()
        companionPanel?.removeFromSuperview()
        companionPanel = nil
        companionWebView = nil
        companionModeID = nil
        companionRetries = 0
        if let content = window?.contentView, let primary = webView {
            rebuildWorkspaceLayout(in:content,primary:primary)
            content.layoutSubtreeIfNeeded()
        }
        window?.makeFirstResponder(webView)
    }

    func loadDashboard() {
        if let started = startupVideoStartedAt {
            let remaining = 6.1 - Date().timeIntervalSince(started)
            if remaining > 0 {
                guard !dashboardLoadPending else { return }
                dashboardLoadPending = true
                DispatchQueue.main.asyncAfter(deadline: .now() + remaining) { [weak self] in
                    self?.dashboardLoadPending = false
                    self?.loadDashboard()
                }
                return
            }
            startupVideoStartedAt = nil
        }
        if let webView {
            Gateway.prepareNativeControlAuth(for: webView)
            if releaseDashboardProbeEnabled {
                releaseDashboardProbeGeneration += 1
                let generation = releaseDashboardProbeGeneration
                logReleaseDashboardProbe("navigation queued (native auth: \(Gateway.nativeControlAuthPrepared(for: webView)))")
                DispatchQueue.main.async { [weak self, weak webView] in
                    if let webView { self?.probeReleaseDashboard(webView, generation: generation) }
                }
            }
        }
        webView?.load(URLRequest(url: Gateway.defaultChatURL))
    }

    private func logReleaseDashboardProbe(_ status: String) {
        guard status != releaseDashboardProbeStatus else { return }
        releaseDashboardProbeStatus = status
        FileHandle.standardError.write(Data("pinkie-release-smoke: \(status)\n".utf8))
    }

    private func probeReleaseDashboard(_ view: WKWebView, generation: Int, remaining: Int = 45) {
        // Disposable release QA exercises the actual embedded WebKit view.
        // This is a read-only check; it does not alter navigation or auth.
        guard view === webView, generation == releaseDashboardProbeGeneration else { return }
        func retry() {
            guard remaining > 0 else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self, weak view] in
                if let view { self?.probeReleaseDashboard(view, generation: generation, remaining: remaining - 1) }
            }
        }
        guard view.url?.scheme == Gateway.url.scheme, view.url?.host == Gateway.url.host,
              view.url?.port == Gateway.url.port else {
            logReleaseDashboardProbe("waiting for local dashboard navigation")
            retry()
            return
        }
        let check = """
        const sidebar = window.__laolaoSidebar;
        if (!sidebar?.gwRequest) {
          return document.body?.innerText.includes('Gateway Token')
            ? 'local dashboard asks for a token'
            : 'local dashboard sidebar not initialized';
        }
        try {
          const data = await sidebar.gwRequest('pinkie.modelSetup.list', {}, 2500);
          return Array.isArray(data?.providers) ? 'dashboard connected and model setup loaded' : 'missing model providers';
        } catch {
          return document.body?.innerText.includes('Gateway Token')
            ? 'local dashboard asks for a token'
            : 'waiting for live model setup';
        }
        """
        view.callAsyncJavaScript(check, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self, generation == self.releaseDashboardProbeGeneration else { return }
            if case .success(let value) = result, let status = value as? String {
                self.logReleaseDashboardProbe(status)
                if status == "dashboard connected and model setup loaded" { return }
            } else if case .failure(let error) = result {
                self.logReleaseDashboardProbe("WebKit callback error \((error as NSError).code)")
            }
            retry()
        }
    }
}
