// AppDelegate 内置浏览器面板组装、工具栏、深色网页适配与 ChatGPT 网页端协作自动化。
import AppKit
import AVFoundation
import CommonCrypto
import Darwin
import Foundation
import Speech
import UserNotifications
import WebKit

extension AppDelegate {
    private func browserToolbarButton(symbol: String, label: String, action: Selector) -> NSButton {
        let button = NSButton(frame: .zero)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.isBordered = false
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.imagePosition = .imageOnly
        button.contentTintColor = NSColor(
            srgbRed: 0.39,
            green: 0.55,
            blue: 0.59,
            alpha: 1.0
        )
        button.appearance = NSAppearance(named: .aqua)
        button.toolTip = label
        button.target = self
        button.action = action
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 30),
            button.heightAnchor.constraint(equalToConstant: 30),
        ])
        return button
    }

    func configureBrowserControl() {
        browserControl.clicked = { browser, x, y in
            BrowserClickFeedback.show(in: browser, x: x * Double(browser.pageZoom), y: y * Double(browser.pageZoom))
        }
        browserControl.webView = { [weak self] in self?.browserWebView }
        browserControl.isOpen = { [weak self] in self?.browserPanel?.superview != nil }
        browserControl.openWorkspace = { [weak self] focus in
            self?.ensureBrowserWorkspace(url: nil, focus: focus, showStartPage: false)
            return self?.browserWebView
        }
        browserControl.closeWorkspace = { [weak self] in self?.detachBrowserWorkspace() }
        browserControl.registerFilePreview = { [weak self] path in
            guard let self else { return ["ok": false, "message": "文件预览暂时不可用。"] }
            let enhanced = MaterialPreviewModePolicy.allowsEnhancedMarkdown(
                primary: self.modeID(for: self.webView?.url),
                companion: self.companionModeID,
                companionVisible: self.companionPanel?.superview != nil
            )
            return self.materialPreview.registerWorkspacePreview(path: path, enhancedMarkdown: enhanced)
        }
        browserControl.activityChanged = { [weak self] active in
            guard let self else { return }
            self.browserAgentActive = active
            self.browserActivityIndicator?.isHidden = !active
            self.browserStatusLabel?.isHidden = active || self.browserStatusLabel?.stringValue.isEmpty == true
        }
        browserControl.collaborationActive = { [weak self] done in
            guard let self else { done(false); return }
            // The existing collaboration button is its stable enabled state.
            // A recent native control lease protects a turn while modes change
            // and that button is briefly remounted by the chat page.
            if self.chatGPTControlUntil > Date() { done(true); return }
            let pages = [self.webView, self.companionWebView].compactMap { $0 }
            guard !pages.isEmpty else { done(false); return }
            var pending = pages.count
            var active = false
            for page in pages {
                page.evaluateJavaScript("Boolean(document.querySelector('.laolao-web-gpt-collab.is-active'))") { value, _ in
                    active = active || value as? Bool == true
                    pending -= 1
                    if pending == 0 { done(active) }
                }
            }
        }
        if browserUserEventMonitor == nil {
            browserUserEventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown, .scrollWheel]) { [weak self] event in
                guard let self, let panel = self.browserPanel, panel.superview != nil, event.window === self.window else { return event }
                let interacted: Bool
                if event.type == .keyDown {
                    let responder = self.window?.firstResponder as? NSView
                    interacted = responder?.isDescendant(of: panel) == true || self.window?.firstResponder === self.browserAddressField?.currentEditor()
                } else { interacted = panel.bounds.contains(panel.convert(event.locationInWindow, from: nil)) }
                if interacted { self.browserControl.userDidInteract() }
                return event
            }
        }
        do {
            try browserEndpoint.start { [weak self] request, done in
                guard let self else { done(["id": request["id"] ?? "", "ok": false, "reason": "App 浏览器已关闭。"]); return }
                // Background web-GPT work (questions, images) runs in its own hidden page and
                // never touches the visible browser or a collaboration chat.
                if (request["action"] as? String)?.hasPrefix("gpt_web_") == true {
                    Task { @MainActor in
                        let worker = self.gptWebWorker ?? ChatGPTBackgroundWorker()
                        self.gptWebWorker = worker
                        worker.handle(request, completion: done)
                    }
                    return
                }
                self.browserControl.handle(request, completion: done)
            }
        } catch { NSLog("[碧琪浏览器] %@", error.localizedDescription) }
    }

    func showBrowserFile(_ path: String, sourceWebView: WKWebView?) {
        browserControl.handle(["action": "show_file", "path": path], userInitiated: true) { [weak sourceWebView] result in
            let detail: [String: Any] = ["path": path, "ok": result["ok"] as? Bool ?? false, "reason": result["reason"] as? String ?? ""]
            guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
            sourceWebView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('laolao:browser-show-file', {detail:\(json)}));")
        }
    }

    private func makeBrowserWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "pinkieBrowserLayout")
        configuration.userContentController.addUserScript(WKUserScript(source: #"""
        (()=>{
          let timer;
          const report=()=>{clearTimeout(timer);timer=setTimeout(()=>{
            const width=Math.max(document.documentElement?.scrollWidth||0,document.body?.scrollWidth||0);
            window.webkit.messageHandlers.pinkieBrowserLayout.postMessage({width,viewport:innerWidth});
          },60)};
          const start=()=>{const observer=new ResizeObserver(report);observer.observe(document.documentElement);if(document.body)observer.observe(document.body);report()};
          document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
          addEventListener('resize',report);addEventListener('load',report);
        })();
        """#, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        configuration.setURLSchemeHandler(materialPreview, forURLScheme: "clekk-material")
        // The default store deliberately persists site logins/cookies across
        // mode switches and app launches, like a normal embedded browser.
        configuration.websiteDataStore = .default()
        let browser = WKWebView(frame: .zero, configuration: configuration)
        browser.translatesAutoresizingMaskIntoConstraints = false
        browser.navigationDelegate = self
        browser.uiDelegate = self
        browser.allowsBackForwardNavigationGestures = true
        // 内置浏览器跟随应用全局外观：深色时 WebKit 原生的滚动条、表单控件、
        // 系统配色（prefers-color-scheme）以及默认底色都是深色。
        browser.appearance = NSAppearance(named: nightAppearance ? .darkAqua : .aqua)
        browser.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            browser.underPageBackgroundColor = NSColor(
                srgbRed: nightAppearance ? 0.10 : 1.0,
                green: nightAppearance ? 0.075 : 0.985,
                blue: nightAppearance ? 0.115 : 0.993,
                alpha: 0.97
            )
        }
        return browser
    }

    func setBrowserStatus(_ message: String, loading: Bool = false) {
        browserStatusLabel?.stringValue = message
        browserStatusLabel?.isHidden = message.isEmpty || browserAgentActive
        if loading {
            browserLoadingIndicator?.startAnimation(nil)
            browserLoadingIndicator?.isHidden = false
        } else {
            browserLoadingIndicator?.stopAnimation(nil)
            browserLoadingIndicator?.isHidden = true
        }
        updateBrowserToolbarLayout(width: browserPanel?.bounds.width ?? 600)
    }

    func scheduleBrowserFit() {
        browserFitWork?.cancel()
        guard !browserDragging else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self, let browser = self.browserWebView, browser.bounds.width > 0 else { return }
            let zoom = self.browserFitEnabled ? BrowserWorkspaceGeometry.fitZoom(width: browser.bounds.width, contentWidth: self.browserFitWidth) : 1
            if abs(browser.pageZoom - zoom) > 0.005 { browser.pageZoom = zoom }
        }
        browserFitWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06, execute: work)
    }

    @objc private func browserToggleFit(_ sender: Any?) {
        browserFitEnabled.toggle()
        UserDefaults.standard.set(browserFitEnabled, forKey: "pinkie.browser.fitWindow")
        browserFitItem?.state = browserFitEnabled ? .on : .off
        scheduleBrowserFit()
    }

    @objc private func browserActualSize(_ sender: Any?) {
        browserFitEnabled = false
        UserDefaults.standard.set(false, forKey: "pinkie.browser.fitWindow")
        browserFitItem?.state = .off
        scheduleBrowserFit()
    }

    @objc private func browserToggleForceDark(_ sender: Any?) {
        browserForceDark.toggle()
        UserDefaults.standard.set(browserForceDark, forKey: "pinkie.browser.forceDark")
        browserForceDarkItem?.state = browserForceDark ? .on : .off
        applyBrowserForceDark()
    }

    /// 深色外观下给仍然画白底的站点套一层反色；图片、视频再反回来保持原色。
    /// 只处理 http/https/file，PDF 和 clekk-material 预览不动。
    func applyBrowserForceDark() {
        guard let browser = browserWebView,
              let scheme = browser.url?.scheme?.lowercased(),
              ["http", "https", "file"].contains(scheme),
              browser.url?.absoluteString.hasSuffix(".pdf") != true else { return }
        if browserForceDark && nightAppearance {
            browser.evaluateJavaScript(Self.browserForceDarkScript, completionHandler: nil)
        } else {
            browser.evaluateJavaScript(
                "document.getElementById('pinkie-force-dark')?.remove();",
                completionHandler: nil
            )
        }
    }

    private static let browserForceDarkScript = #"""
    (() => {
      const ID = 'pinkie-force-dark';
      const level = (value) => {
        const match = value && value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(',').map((item) => parseFloat(item));
        const alpha = parts.length > 3 ? parts[3] : 1;
        if (alpha < 0.4) return 'clear';
        const luma = 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2];
        return luma > 140 ? 'light' : 'dark';
      };
      const shouldInvert = () => {
        const root = level(getComputedStyle(document.documentElement).backgroundColor);
        const body = document.body ? level(getComputedStyle(document.body).backgroundColor) : 'clear';
        if (root === 'light' || body === 'light') return true;
        if (root === 'dark' || body === 'dark') return false;
        // html/body 都透明：底色画在内层容器上，或者就是浏览器默认白画布。
        const blocks = Array.from(document.querySelectorAll('body > div, body > main, main, [role="main"]')).slice(0, 8);
        let sawLight = false;
        for (const block of blocks) {
          const state = level(getComputedStyle(block).backgroundColor);
          if (state === 'dark') return false;
          if (state === 'light') sawLight = true;
        }
        return sawLight || blocks.length === 0;
      };
      const paint = () => {
        if (document.getElementById(ID)) return;
        if (!shouldInvert()) return;
        const style = document.createElement('style');
        style.id = ID;
        style.textContent = [
          // 不要在这里再给 html 设深色背景：filter 会把背景一起反掉，
          // 白白一片。白底本身反色后就是深色，正合适。
          'html{filter:invert(1) hue-rotate(180deg) !important;background:#f2f2f2 !important;}',
          'html,body{color-scheme:dark;}',
          'img,video,canvas,picture,iframe,[style*="background-image"]{',
          'filter:invert(1) hue-rotate(180deg) !important;}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
      };
      paint();
      setTimeout(paint, 500);
      setTimeout(paint, 1600);
    })();
    """#

    private func updateBrowserToolbarVisibility() {
        // Keep geometry and keyboard/accessibility targets stable; only fade decoration.
        let active = browserToolbarHovered || browserAddressField?.currentEditor() != nil
        let duration = PinkieMotion.reduce ? 0.0 : 0.12
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            for view in [browserBackButton, browserForwardButton, browserReloadButton, browserPresentationMenu].compactMap({ $0 }) {
                view.animator().alphaValue = active ? 1 : 0.32
            }
        }
    }

    func browserErrorPage(_ error: Error) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        let detail = nsError.localizedDescription
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = #"""
        <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
        <style>
          *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#fffafd,#f9edf5);font:14px -apple-system;color:#70425b}
          main{width:min(420px,calc(100vw - 42px));padding:28px;border:1px solid #d8679b38;border-radius:20px;background:#fff9;box-shadow:0 16px 45px #9f4c741c;text-align:center}
          .mark{width:48px;height:48px;margin:0 auto 16px;display:grid;place-items:center;border-radius:16px;background:#f8dfea;color:#ad4a76;font-size:22px}
          h1{margin:0 0 9px;font-size:17px}p{margin:0;color:#997487;line-height:1.65}.detail{margin-top:12px;font-size:11px;color:#ad8799}
          @media(prefers-color-scheme:dark){body{background:linear-gradient(145deg,#1a131e,#251b2b);color:#efe5ea}main{background:#2a2030;border-color:#ffffff18;box-shadow:0 16px 45px #0006}.mark{background:#ff7fb322;color:#ff9cc6}p,.detail{color:#b3a1ab}}
        </style><main><div class="mark">!</div><h1>页面没有加载成功</h1><p>点上方的重新加载再试；如果登录页仍被网络验证拦住，可点右上角“在默认浏览器打开”。</p><p class="detail">\#(detail)</p></main>
        """#
        browserWebView?.loadHTMLString(html, baseURL: nil)
        if let url = lastBrowserURL { browserAddressField?.show(url) }
        setBrowserStatus("加载失败", loading: false)
    }

    private func makeBrowserPanel() -> NSView {
        let panel = BrowserPanelContainer(frame: .zero)
        panel.onHover = { [weak self] hovering in
            guard let self, self.browserDockEdge != nil else { return }
            self.browserEdgeHoveringPanel = hovering
            self.updateBrowserEdgeHover()
        }
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.wantsLayer = true
        panel.layer?.backgroundColor = NSColor(
            srgbRed: 1.0,
            green: 0.975,
            blue: 0.988,
            alpha: 0.97
        ).cgColor
        panel.layer?.masksToBounds = true
        panel.appearance = NSAppearance(named: .aqua)

        let header = BrowserToolbarHandle(frame: .zero)
        header.onHover = { [weak self] hovering in
            self?.browserToolbarHovered = hovering
            self?.updateBrowserToolbarVisibility()
        }
        header.translatesAutoresizingMaskIntoConstraints = false
        let grip = BrowserPanelTitle(labelWithString: "⠿")
        grip.translatesAutoresizingMaskIntoConstraints = false
        grip.font = .systemFont(ofSize: 16, weight: .medium)
        grip.textColor = .secondaryLabelColor
        grip.setAccessibilityElement(false)
        let dock = browserToolbarButton(symbol: "sidebar.right", label: "停靠到侧边", action: #selector(browserDocked(_:)))
        let floating = browserToolbarButton(symbol: "pip", label: "悬浮面板（拖动标题栏移动）", action: #selector(browserFloating(_:)))
        let full = browserToolbarButton(symbol: "arrow.up.left.and.arrow.down.right", label: "浏览器铺满工作区", action: #selector(browserFull(_:)))
        header.onDrag = { [weak self] delta in self?.moveBrowserFloating(by: delta) }
        header.onDragBegan = { [weak self] in self?.beginBrowserFloatingDrag() }
        header.onDragEnded = { [weak self] in self?.endBrowserFloatingDrag() }

        // 一行工具栏；空白与左侧手柄仍可拖动悬浮面板。
        let toolbar = header
        toolbar.appearance = NSAppearance(named: .aqua)
        toolbar.wantsLayer = true
        toolbar.layer?.backgroundColor = NSColor(
            srgbRed: 1.0,
            green: 0.93,
            blue: 0.97,
            alpha: 0.96
        ).cgColor

        let back = browserToolbarButton(symbol: "chevron.left", label: "后退", action: #selector(browserGoBack(_:)))
        let forward = browserToolbarButton(symbol: "chevron.right", label: "前进", action: #selector(browserGoForward(_:)))
        let reload = browserToolbarButton(symbol: "arrow.clockwise", label: "重新加载", action: #selector(browserReload(_:)))
        let external = browserToolbarButton(symbol: "arrow.up.right.square", label: "在默认浏览器打开", action: #selector(browserOpenExternally(_:)))
        let close = browserToolbarButton(symbol: "xmark", label: "关闭浏览器工作区", action: #selector(closeBrowserWorkspace(_:)))
        let loading = NSProgressIndicator(frame: .zero)
        loading.translatesAutoresizingMaskIntoConstraints = false
        loading.style = .spinning
        loading.controlSize = .small
        loading.isDisplayedWhenStopped = false
        loading.isHidden = true
        let status = NSTextField(labelWithString: "")
        status.translatesAutoresizingMaskIntoConstraints = false
        status.isHidden = true
        status.lineBreakMode = .byTruncatingTail
        status.textColor = NSColor(srgbRed: 0.58, green: 0.42, blue: 0.50, alpha: 1)
        status.font = NSFont.systemFont(ofSize: 10.5, weight: .medium)
        let activity = BrowserActivityIndicator()
        let statusStack = NSStackView(views: [loading])
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        statusStack.orientation = .horizontal
        statusStack.alignment = .centerY
        statusStack.spacing = 4
        statusStack.detachesHiddenViews = true
        let address = BrowserAddressField(frame: .zero)
        address.translatesAutoresizingMaskIntoConstraints = false
        address.placeholderString = "输入网址或搜索"
        address.sendsSearchStringImmediately = false
        address.target = self
        address.action = #selector(browserAddressSubmitted(_:))
        address.focusRingType = .none
        (address.cell as? NSSearchFieldCell)?.cancelButtonCell = nil
        address.appearance = NSAppearance(named: .aqua)
        address.backgroundColor = NSColor(
            srgbRed: 1.0,
            green: 0.985,
            blue: 0.993,
            alpha: 0.92
        )
        address.textColor = NSColor(
            srgbRed: 0.39,
            green: 0.29,
            blue: 0.35,
            alpha: 1.0
        )

        let browser = makeBrowserWebView()
        let resize = BrowserResizeHandle(frame: .zero)
        resize.translatesAutoresizingMaskIntoConstraints = false
        resize.wantsLayer = true
        resize.layer?.backgroundColor = NSColor(
            srgbRed: 0.83,
            green: 0.33,
            blue: 0.57,
            alpha: 0.18
        ).cgColor
        resize.onDrag = { [weak self] delta in
            guard let self,
                  let window = self.window,
                  let width = self.browserWidthConstraint else { return }
            let totalWidth = window.contentView?.bounds.width ?? window.contentLayoutRect.width
            guard totalWidth > 0 else { return }
            width.constant = self.browserDockedWidth(totalWidth: totalWidth, fraction: (width.constant + delta) / totalWidth)
            self.browserWidthFraction = width.constant / totalWidth
            self.updateBrowserToolbarLayout(width: width.constant)
        }

        let presentationMenu = NSPopUpButton(frame: .zero, pullsDown: true)
        presentationMenu.translatesAutoresizingMaskIntoConstraints = false
        presentationMenu.isBordered = false
        presentationMenu.addItem(withTitle: "")
        presentationMenu.item(at: 0)?.image = NSImage(systemSymbolName: "ellipsis", accessibilityDescription: nil)
        presentationMenu.setAccessibilityLabel("浏览器显示方式与更多操作")
        presentationMenu.toolTip = "停靠、悬浮、铺满或在默认浏览器打开"
        for (mode, label, action) in [
            (BrowserPresentation.side, "停靠到侧边", #selector(browserDocked(_:))),
            (.floating, "悬浮面板", #selector(browserFloating(_:))),
            (.full, "铺满工作区", #selector(browserFull(_:)))
        ] {
            let item = NSMenuItem(title: label, action: action, keyEquivalent: "")
            item.target = self
            presentationMenu.menu?.addItem(item)
            browserPresentationMenuItems[mode] = item
        }
        presentationMenu.menu?.addItem(.separator())
        let fitItem = NSMenuItem(title: "适应窗口", action: #selector(browserToggleFit(_:)), keyEquivalent: "")
        fitItem.target = self; fitItem.state = browserFitEnabled ? .on : .off
        presentationMenu.menu?.addItem(fitItem); browserFitItem = fitItem
        let actualSize = NSMenuItem(title: "恢复 100% 大小", action: #selector(browserActualSize(_:)), keyEquivalent: "")
        actualSize.target = self; presentationMenu.menu?.addItem(actualSize)
        let forceDark = NSMenuItem(title: "网页强制深色", action: #selector(browserToggleForceDark(_:)), keyEquivalent: "")
        forceDark.target = self
        forceDark.state = browserForceDark ? .on : .off
        presentationMenu.menu?.addItem(forceDark)
        browserForceDarkItem = forceDark
        presentationMenu.menu?.addItem(.separator())
        let externalItem = NSMenuItem(title: "在默认浏览器打开", action: #selector(browserOpenExternally(_:)), keyEquivalent: "")
        externalItem.target = self
        presentationMenu.menu?.addItem(externalItem)
        let navigation = NSStackView(views: [back, forward, reload])
        let actions = NSStackView(views: [dock, floating, full, external, presentationMenu, close])
        for stack in [navigation, actions] {
            stack.translatesAutoresizingMaskIntoConstraints = false
            stack.orientation = .horizontal
            stack.alignment = .centerY
            stack.spacing = 2
            stack.detachesHiddenViews = true
        }
        let row = NSStackView(views: [navigation, address, statusStack, actions])
        row.translatesAutoresizingMaskIntoConstraints = false
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 6
        row.detachesHiddenViews = true
        header.addSubview(grip)
        header.addSubview(row)
        panel.addSubview(header)
        panel.addSubview(browser)
        panel.addSubview(resize)
        browserFloatingResizeHandles = BrowserResizeEdges.allHandles.map { edges in
            let handle = BrowserPanelResizeHandle(edges: edges)
            handle.translatesAutoresizingMaskIntoConstraints = false
            handle.onDrag = { [weak self] delta in self?.resizeBrowserFloating(by: delta, edges: edges) }
            panel.addSubview(handle)
            let constraints: [NSLayoutConstraint]
            if edges.isCorner {
                constraints = [handle.widthAnchor.constraint(equalToConstant: 18), handle.heightAnchor.constraint(equalToConstant: 18),
                    edges.contains(.left) ? handle.leadingAnchor.constraint(equalTo: panel.leadingAnchor) : handle.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
                    edges.contains(.top) ? handle.topAnchor.constraint(equalTo: panel.topAnchor) : handle.bottomAnchor.constraint(equalTo: panel.bottomAnchor)]
            } else if edges.contains(.left) || edges.contains(.right) {
                constraints = [handle.widthAnchor.constraint(equalToConstant: 8), handle.topAnchor.constraint(equalTo: panel.topAnchor, constant: 18), handle.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -18),
                    edges.contains(.left) ? handle.leadingAnchor.constraint(equalTo: panel.leadingAnchor) : handle.trailingAnchor.constraint(equalTo: panel.trailingAnchor)]
            } else {
                constraints = [handle.heightAnchor.constraint(equalToConstant: 8), handle.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18), handle.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18),
                    edges.contains(.top) ? handle.topAnchor.constraint(equalTo: panel.topAnchor) : handle.bottomAnchor.constraint(equalTo: panel.bottomAnchor)]
            }
            NSLayoutConstraint.activate(constraints)
            return handle
        }
        browserContentEdgeConstraints = [browser.leadingAnchor.constraint(equalTo: panel.leadingAnchor), browser.trailingAnchor.constraint(equalTo: panel.trailingAnchor), browser.bottomAnchor.constraint(equalTo: panel.bottomAnchor)]

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            header.topAnchor.constraint(equalTo: panel.topAnchor),
            header.heightAnchor.constraint(equalToConstant: 48),
            grip.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 18),
            grip.widthAnchor.constraint(equalToConstant: 12),
            grip.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            row.leadingAnchor.constraint(equalTo: grip.trailingAnchor, constant: 4),
            row.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -22),
            row.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            loading.widthAnchor.constraint(equalToConstant: 14),
            loading.heightAnchor.constraint(equalToConstant: 14),
            status.widthAnchor.constraint(lessThanOrEqualToConstant: 96),
            activity.widthAnchor.constraint(lessThanOrEqualToConstant: 120),
            statusStack.widthAnchor.constraint(lessThanOrEqualToConstant: 140),
            address.widthAnchor.constraint(greaterThanOrEqualToConstant: 110),
            presentationMenu.widthAnchor.constraint(equalToConstant: 30),
            presentationMenu.heightAnchor.constraint(equalToConstant: 30),

            browser.topAnchor.constraint(equalTo: header.bottomAnchor),
            resize.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            resize.topAnchor.constraint(equalTo: panel.topAnchor),
            resize.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
            resize.widthAnchor.constraint(equalToConstant: 6),
        ])
        NSLayoutConstraint.activate(browserContentEdgeConstraints)

        browserPanel = panel
        browserWebView = browser
        browserAddressField = address
        browserBackButton = back
        browserForwardButton = forward
        browserReloadButton = reload
        browserCloseButton = close
        browserExternalButton = external
        browserLoadingIndicator = loading
        browserStatusLabel = status
        browserActivityIndicator = activity
        activity.isHidden = !browserAgentActive
        browserToolbarView = toolbar
        browserTitlebar = header
        browserCorner = browserFloatingResizeHandles.last
        browserPresentationButtons = [.side: dock, .floating: floating, .full: full]
        browserPresentationMenu = presentationMenu
        browserStatusStack = statusStack
        browserResizeView = resize
        updateBrowserToolbarLayout(width: 600)
        updateBrowserControls()
        applyNightAppearance()
        return panel
    }

    func updateBrowserToolbarLayout(width: CGFloat) {
        browserForwardButton?.isHidden = width < 500 || browserWebView?.canGoForward != true
        browserExternalButton?.isHidden = true
        browserPresentationMenu?.isHidden = false
        for button in browserPresentationButtons.values { button.isHidden = true }
        browserStatusStack?.isHidden = browserLoadingIndicator?.isHidden != false
        browserPresentationMenu?.toolTip = browserAgentActive ? "碧琪正在操作浏览器；点开切换显示方式" : "停靠、悬浮、铺满或在默认浏览器打开"
        updateBrowserToolbarVisibility()
    }

    /// 黑夜模式：浏览器工作区和分屏面板这些原生画的底色也换成深色，与网页一致。
    func applyNightAppearance() {
        let dark = nightAppearance
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat) -> NSColor { NSColor(srgbRed: r, green: g, blue: b, alpha: a) }
        let followSystem = (UserDefaults.standard.string(forKey: "pinkie.appearanceMode") ?? "system") == "system"
        NSApp.appearance = followSystem ? nil : appearance
        window?.appearance = followSystem ? nil : appearance
        for button in [browserBackButton, browserForwardButton, browserReloadButton, browserCloseButton, browserExternalButton] {
            button?.appearance = appearance
            button?.contentTintColor = dark ? rgb(0.81, 0.74, 0.79, 1) : rgb(0.39, 0.55, 0.59, 1)
        }
        browserTitlebar?.appearance = appearance
        browserPresentationMenu?.appearance = appearance
        for button in browserPresentationButtons.values {
            button.appearance = appearance
            button.contentTintColor = button.state == .on ? .systemPink : (dark ? rgb(0.81, 0.74, 0.79, 1) : rgb(0.39, 0.55, 0.59, 1))
        }
        browserLoadingIndicator?.appearance = appearance
        // WebView 自身也要跟着换外观，否则深色下页面里的原生控件和
        // prefers-color-scheme 仍按浅色渲染。
        browserWebView?.appearance = appearance
        if #available(macOS 12.0, *) {
            browserWebView?.underPageBackgroundColor = dark ? rgb(0.10, 0.075, 0.115, 0.97) : rgb(1.0, 0.985, 0.993, 0.97)
        }
        if let panel = browserPanel {
            panel.appearance = appearance
            panel.layer?.backgroundColor = (dark ? rgb(0.10, 0.075, 0.115, 0.97) : rgb(1.0, 0.975, 0.988, 0.97)).cgColor
        }
        if let toolbar = browserToolbarView {
            toolbar.appearance = appearance
            toolbar.layer?.backgroundColor = (dark ? rgb(0.14, 0.105, 0.16, 0.96) : rgb(1.0, 0.93, 0.97, 0.96)).cgColor
        }
        if let address = browserAddressField {
            address.appearance = appearance
            address.backgroundColor = dark ? rgb(1, 1, 1, 0.07) : rgb(1.0, 0.985, 0.993, 0.92)
            address.textColor = dark ? rgb(0.94, 0.90, 0.92, 1) : rgb(0.39, 0.29, 0.35, 1)
        }
        browserStatusLabel?.textColor = dark ? rgb(0.72, 0.62, 0.68, 1) : rgb(0.58, 0.42, 0.50, 1)
        browserActivityIndicator?.setNight(dark)
        applyBrowserForceDark()
        browserResizeView?.layer?.backgroundColor = (dark ? rgb(1.0, 0.5, 0.7, 0.16) : rgb(0.83, 0.33, 0.57, 0.18)).cgColor
        if let panel = companionPanel {
            panel.appearance = appearance
            panel.layer?.backgroundColor = (dark ? rgb(0.10, 0.075, 0.115, 0.6) : rgb(1.0, 0.93, 0.97, 0.52)).cgColor
        }
    }

    func browserURL(from value: String) -> URL? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if let direct = URL(string: text), ["http", "https", "file"].contains(direct.scheme?.lowercased() ?? "") {
            return direct
        }
        if !text.contains(where: { $0.isWhitespace }), text.contains(".") || text.contains(":") {
            return URL(string: "https://\(text)")
        }
        var search = URLComponents(string: "https://www.google.com/search")
        search?.queryItems = [URLQueryItem(name: "q", value: text)]
        return search?.url
    }

    // Keep account switching narrowly scoped to the embedded OpenAI sites.
    // CLE Kk localhost auth, other websites, project data and permissions stay
    // untouched; the user signs in to the replacement account themselves.
    func resetChatGPTBrowserSession() {
        let dataStore = WKWebsiteDataStore.default()
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        dataStore.fetchDataRecords(ofTypes: dataTypes) { [weak self] records in
            let openAIRecords = records.filter { record in
                let name = record.displayName.lowercased()
                return name == "chatgpt.com" || name.hasSuffix(".chatgpt.com")
                    || name == "openai.com" || name.hasSuffix(".openai.com")
            }
            dataStore.removeData(ofTypes: dataTypes, for: openAIRecords) { [weak self] in
                DispatchQueue.main.async {
                    guard let self,
                          let loginURL = URL(string: "https://chatgpt.com/") else { return }
                    self.openBrowserWorkspace(url: loginURL)
                }
            }
        }
    }

    func loadBrowserURL(_ url: URL) {
        let safe: URL
        do { safe = try BrowserControlPolicy.validatedURL(url.absoluteString, access: materialPreviewAccess) }
        catch { setBrowserStatus(error.localizedDescription); return }
        lastBrowserURL = safe
        browserAddressField?.stringValue = safe.absoluteString
        if safe.isFileURL {
            browserWebView?.loadFileURL(safe, allowingReadAccessTo: safe)
        } else {
            browserWebView?.load(URLRequest(url: safe))
        }
    }

    private func isChatGPTURL(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else { return false }
        return host == "chatgpt.com" || host.hasSuffix(".chatgpt.com")
    }

    private func sendBrowserControlResult(
        requestId: String,
        ok: Bool,
        result: [String: Any] = [:],
        error: String = "",
        to targetWebView: WKWebView?
    ) {
        var payload: [String: Any] = ["requestId": requestId, "ok": ok]
        if !result.isEmpty { payload["result"] = result }
        if !error.isEmpty { payload["error"] = error }
        guard let targetWebView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        targetWebView.evaluateJavaScript("window.__laolaoBrowserControlResult?.(\(json));")
    }

    private func chatGPTSnapshot(requestId: String, sourceWebView: WKWebView?) {
        guard let browser = browserWebView, isChatGPTURL(browser.url) else {
            sendBrowserControlResult(
                requestId: requestId,
                ok: false,
                error: "右侧还没有打开 ChatGPT",
                to: sourceWebView
            )
            return
        }
        let script = #"""
        (() => {
          const visible = (node) => !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
          const composer = Array.from(document.querySelectorAll('#prompt-textarea,textarea,[contenteditable="true"]'))
            .find((node) => visible(node) && (node.id === 'prompt-textarea' || node.tagName === 'TEXTAREA' || node.getAttribute('contenteditable') === 'true'));
          // ChatGPT can put the turn marker on a display:contents wrapper.
          // Such a wrapper has no rect even while its reply is on screen, so
          // filtering turn markers through visible() silently loses replies.
          const roleAssistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
          const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], article[data-turn-id]'));
          const turnAssistants = turns.filter((turn) => !turn.querySelector('[data-message-author-role="user"]')
            && (/(?:ChatGPT 说|ChatGPT said)/i.test(turn.querySelector('h4,h5')?.textContent || '')
              || !!turn.querySelector('.markdown, [data-message-author-role="assistant"]')));
          const assistants = turnAssistants.length >= roleAssistants.length ? turnAssistants : roleAssistants;
          const roleUsers = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
          const turnUsers = turns.filter((turn) => !!turn.querySelector('[data-message-author-role="user"]')
            || /(?:你说|You said)/i.test(turn.querySelector('h4,h5')?.textContent || ''));
          const users = turnUsers.length >= roleUsers.length ? turnUsers : roleUsers;
          const turnId = (node) => {
            const turn = node?.closest('[data-turn-id], [data-testid^="conversation-turn-"]') || node;
            return turn?.getAttribute('data-turn-id') || node?.getAttribute('data-message-id')
              || turn?.getAttribute('data-testid') || '';
          };
          const lastAssistant = assistants[assistants.length - 1];
          const replyBody = lastAssistant?.querySelector('[data-testid="conversation-turn-content"], .markdown, .prose') || lastAssistant;
          const latest = (replyBody?.innerText || replyBody?.textContent || '').trim();
          const stop = Array.from(document.querySelectorAll('button'))
            .find((button) => visible(button) && /stop|停止生成|停止回应|停止/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`));
          const pluginButton = Array.from(document.querySelectorAll('button'))
            .find((button) => visible(button) && /Codex with ChatGPT/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`));
          const pluginLabel = pluginButton ? `${pluginButton.getAttribute('aria-label') || ''} ${pluginButton.textContent || ''}`.trim() : '';
          const modes = Array.from(document.querySelectorAll('[role="radio"],input[type="radio"],label,button,[role="tab"]'));
          const modeName = node => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('value') || ''} ${node.getAttribute('data-value') || ''} ${node.textContent || ''} ${Array.from(node.labels || []).map(label => label.textContent || '').join(' ')}`.trim();
          const selected = node => node.checked === true || node.getAttribute('aria-checked') === 'true'
            || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('data-state') === 'checked'
            || !!node.querySelector?.('input:checked,[aria-checked="true"]');
          const checkedMode = node => selected(node) || node.getAttribute('aria-selected') === 'true'
            || node.getAttribute('data-selected') === 'true' || /(?:^|\s)(?:active|selected|checked)(?:\s|$)/i.test(node.className || '');
          const chatMode = modes.some(node => /(?:^|\s)(?:聊天|Chat)(?:\s|$)/i.test(modeName(node)) && checkedMode(node))
            ? 'chat' : modes.some(node => /(?:^|\s)(?:工作|Work)(?:\s|$)/i.test(modeName(node)) && checkedMode(node))
              ? 'work' : 'unknown';
          const path = location.pathname || '';
          return {
            ready: !!composer,
            chatMode,
            generating: !!stop,
            assistantCount: assistants.length,
            assistantId: turnId(lastAssistant),
            userCount: users.length,
            userId: turnId(users[users.length - 1]),
            assistantCountRole: roleAssistants.length,
            assistantCountTurns: turnAssistants.length,
            turnCount: turns.length,
            latestAssistant: latest.slice(0, 20000),
            pluginLabel: pluginLabel.slice(0, 300),
            pluginNeedsRetry: /点击以重试|click to retry|retry/i.test(pluginLabel),
            url: location.href,
            conversationUrl: /(?:^|\/)c\/[^/?#]+/.test(path) ? location.href.split('#')[0] : '',
            title: document.title || ''
          };
        })()
        """#
        browser.evaluateJavaScript(script) { [weak self, weak sourceWebView] value, evalError in
            guard let self else { return }
            if let evalError {
                self.sendBrowserControlResult(requestId: requestId, ok: false, error: evalError.localizedDescription, to: sourceWebView)
                return
            }
            let result = value as? [String: Any] ?? [:]
            self.sendBrowserControlResult(requestId: requestId, ok: true, result: result, to: sourceWebView)
        }
    }

    private func selectChatGPTChatMode(requestId: String, sourceWebView: WKWebView?) {
        guard let browser = browserWebView, isChatGPTURL(browser.url) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "请先打开 ChatGPT", to: sourceWebView)
            return
        }
        let script = #"""
        (() => {
          const visible = node => !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
          const options = Array.from(document.querySelectorAll('[role="radio"],input[type="radio"],label,button,[role="tab"]'));
          const name = node => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('value') || ''} ${node.getAttribute('data-value') || ''} ${node.textContent || ''} ${Array.from(node.labels || []).map(label => label.textContent || '').join(' ')}`.trim();
          const exact = node => /^(?:聊天|Chat)$/i.test((node.textContent || '').trim());
          const leaf = Array.from(document.querySelectorAll('*')).find(node => exact(node) && !Array.from(node.children).some(exact));
          const chat = options.find(node => /(?:^|\s)(?:聊天|Chat)(?:\s|$)/i.test(name(node)))
            || leaf?.closest('button,label,[role="radio"],[role="tab"]') || leaf?.parentElement;
          if (!chat) return {selected:false,reason:'找不到 ChatGPT 聊天模式'};
          (chat.tagName === 'INPUT' && chat.labels?.length ? chat.labels[0] : chat).click();
          return {selected:true};
        })()
        """#
        browser.evaluateJavaScript(script) { [weak self, weak sourceWebView] value, evalError in
            guard let self else { return }
            if let evalError {
                self.sendBrowserControlResult(requestId: requestId, ok: false, error: evalError.localizedDescription, to: sourceWebView)
                return
            }
            self.sendBrowserControlResult(requestId: requestId, ok: true, result: value as? [String: Any] ?? [:], to: sourceWebView)
        }
    }

    private func findChatGPTPlugin(_ name: String, requestId: String, sourceWebView: WKWebView?) {
        guard let browser = browserWebView, isChatGPTURL(browser.url),
              browser.url?.path == "/plugins", !name.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: ["name": name]),
              let json = String(data: data, encoding: .utf8) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "请先打开 ChatGPT 插件列表", to: sourceWebView)
            return
        }
        let script = #"""
        ((payload) => {
          const links = Array.from(document.querySelectorAll('a[href*="/plugins/plugin_"]'));
          // Plugin cards also contain a description, so their full text is
          // longer than the exact project connector name.
          const link = links.find(node => (node.textContent || '').trim().startsWith(payload.name));
          if (!link) return {found:false};
          const url = new URL(link.getAttribute('href') || '', location.href);
          if (url.hostname !== 'chatgpt.com' || !/^\/plugins\/plugin_[^/]+$/.test(url.pathname)) return {found:false};
          return {found:true,url:url.href};
        })(\#(json))
        """#
        browser.evaluateJavaScript(script) { [weak self, weak sourceWebView] value, evalError in
            guard let self else { return }
            if let evalError {
                self.sendBrowserControlResult(requestId: requestId, ok: false, error: evalError.localizedDescription, to: sourceWebView)
                return
            }
            self.sendBrowserControlResult(requestId: requestId, ok: true, result: value as? [String: Any] ?? [:], to: sourceWebView)
        }
    }

    private func activateChatGPTPlugin(_ name: String, requestId: String, sourceWebView: WKWebView?) {
        guard let browser = browserWebView, isChatGPTURL(browser.url),
              browser.url?.path.hasPrefix("/plugins/plugin_") == true, !name.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: ["name": name]),
              let json = String(data: data, encoding: .utf8) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "请先打开当前项目的 ChatGPT 插件", to: sourceWebView)
            return
        }
        let script = #"""
        ((payload) => {
          const visible = node => !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
          const heading = Array.from(document.querySelectorAll('h1')).find(node => visible(node));
          if ((heading?.textContent || '').trim() !== payload.name) return {activated:false,reason:'插件名称与当前项目不匹配'};
          const button = Array.from(document.querySelectorAll('button'))
            .find(node => visible(node) && /^(在聊天中试用|Try in chat)$/i.test((node.textContent || '').trim()));
          if (!button || button.disabled) return {activated:false,reason:'插件试用按钮不可用'};
          button.click();
          return {activated:true};
        })(\#(json))
        """#
        browser.evaluateJavaScript(script) { [weak self, weak sourceWebView] value, evalError in
            guard let self else { return }
            if let evalError {
                self.sendBrowserControlResult(requestId: requestId, ok: false, error: evalError.localizedDescription, to: sourceWebView)
                return
            }
            self.sendBrowserControlResult(requestId: requestId, ok: true, result: value as? [String: Any] ?? [:], to: sourceWebView)
        }
    }

    private func verifyChatGPTSubmission(
        requestId: String,
        sourceWebView: WKWebView?,
        baselineAssistantCount: Int,
        baselineAssistantId: String,
        baselineUserCount: Int,
        baselineUserId: String,
        attempt: Int = 0
    ) {
        guard let browser = browserWebView, isChatGPTURL(browser.url) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "ChatGPT 页面已经离开", to: sourceWebView)
            return
        }
        let script = #"""
        (() => {
          const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], article[data-turn-id]'));
          const roleUsers = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
          const turnUsers = turns.filter((turn) => !!turn.querySelector('[data-message-author-role="user"]')
            || /(?:你说|You said)/i.test(turn.querySelector('h4,h5')?.textContent || ''));
          const users = turnUsers.length >= roleUsers.length ? turnUsers : roleUsers;
          const node = users[users.length - 1];
          const turn = node?.closest('[data-turn-id], [data-testid^="conversation-turn-"]') || node;
          return {userCount: users.length, userId: turn?.getAttribute('data-turn-id')
            || node?.getAttribute('data-message-id') || turn?.getAttribute('data-testid') || ''};
        })()
        """#
        browser.evaluateJavaScript(script) { [weak self, weak sourceWebView] value, evalError in
            guard let self else { return }
            if let evalError {
                self.sendBrowserControlResult(requestId: requestId, ok: false, error: evalError.localizedDescription, to: sourceWebView)
                return
            }
            let result = value as? [String: Any] ?? [:]
            let userCount = result["userCount"] as? Int ?? 0
            let userId = result["userId"] as? String ?? ""
            if userCount > baselineUserCount || (!userId.isEmpty && userId != baselineUserId) {
                self.sendBrowserControlResult(requestId: requestId, ok: true, result: [
                    "sent": true,
                    "assistantCount": baselineAssistantCount,
                    "assistantId": baselineAssistantId,
                    "url": browser.url?.absoluteString ?? "",
                ], to: sourceWebView)
                return
            }
            if attempt < 24 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self, weak sourceWebView] in
                    self?.verifyChatGPTSubmission(
                        requestId: requestId, sourceWebView: sourceWebView,
                        baselineAssistantCount: baselineAssistantCount,
                        baselineAssistantId: baselineAssistantId,
                        baselineUserCount: baselineUserCount,
                        baselineUserId: baselineUserId,
                        attempt: attempt + 1
                    )
                }
                return
            }
            self.sendBrowserControlResult(
                requestId: requestId, ok: false,
                error: "网页发送键已触发，但 ChatGPT 没有新增用户消息；已停止等待，不会重复发送",
                to: sourceWebView
            )
        }
    }

    private func submitPreparedChatGPTMessage(
        message: String,
        requestId: String,
        sourceWebView: WKWebView?,
        baselineAssistantCount: Int,
        baselineAssistantId: String,
        baselineUserCount: Int,
        baselineUserId: String,
        attempt: Int = 0
    ) {
        guard let browser = browserWebView, isChatGPTURL(browser.url) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "ChatGPT 页面已经离开", to: sourceWebView)
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["message": message]),
              let json = String(data: data, encoding: .utf8) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "控制消息编码失败", to: sourceWebView)
            return
        }
        let script = #"""
        ((payload) => {
          const visible = (node) => !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
          const composer = Array.from(document.querySelectorAll('#prompt-textarea,textarea,[contenteditable="true"]'))
            .find((node) => visible(node) && (node.id === 'prompt-textarea' || node.tagName === 'TEXTAREA' || node.getAttribute('contenteditable') === 'true'));
          if (!composer) return {sent:false,reason:'ChatGPT 输入框暂时不可用'};
          const content = () => (composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText || composer.textContent || '').trim();
          const busy = Array.from(document.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="停止回答"],button[aria-label*="Stop generating"]'))
            .some((node) => visible(node) && !node.disabled);
          if (busy) return {sent:false,reason:'ChatGPT 仍在生成上一条回复'};
          if (!content()) {
            composer.focus();
            if (composer.tagName === 'TEXTAREA') {
              const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (setter) setter.call(composer, payload.message); else composer.value = payload.message;
              composer.dispatchEvent(new Event('input', {bubbles:true}));
            } else {
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(composer);
              selection.removeAllRanges();
              selection.addRange(range);
              let inserted = false;
              try { inserted = document.execCommand('insertText', false, payload.message); } catch (_) {}
              if (!inserted || !content()) composer.textContent = payload.message;
              try { composer.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:payload.message})); }
              catch (_) { composer.dispatchEvent(new Event('input', {bubbles:true})); }
            }
            return {sent:false,reason:'ChatGPT 输入框重载，已恢复待发文字'};
          }
          const selectors = [
            'button[data-testid="send-button"]',
            'button[data-testid="composer-submit-button"]',
            'button[aria-label="Send prompt"]',
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]'
          ];
          const button = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
            .find((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
          if (!button) return {sent:false,reason:'发送键尚未就绪',composerLength:content().length};
          button.click();
          return {sent:true,url:location.href};
        })(\#(json))
        """#
        browser.evaluateJavaScript(script) { [weak self, weak sourceWebView] value, evalError in
            guard let self else { return }
            let sent = (value as? [String: Any])?["sent"] as? Bool ?? false
            if sent {
                self.verifyChatGPTSubmission(
                    requestId: requestId, sourceWebView: sourceWebView,
                    baselineAssistantCount: baselineAssistantCount,
                    baselineAssistantId: baselineAssistantId,
                    baselineUserCount: baselineUserCount,
                    baselineUserId: baselineUserId
                )
                return
            }
            if attempt < 80, evalError == nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self, weak sourceWebView] in
                    self?.submitPreparedChatGPTMessage(
                        message: message,
                        requestId: requestId,
                        sourceWebView: sourceWebView,
                        baselineAssistantCount: baselineAssistantCount,
                        baselineAssistantId: baselineAssistantId,
                        baselineUserCount: baselineUserCount,
                        baselineUserId: baselineUserId,
                        attempt: attempt + 1
                    )
                }
                return
            }
            self.sendBrowserControlResult(
                requestId: requestId,
                ok: false,
                error: evalError?.localizedDescription ?? ((value as? [String: Any])?["reason"] as? String ?? "ChatGPT 发送键没有就绪"),
                to: sourceWebView
            )
        }
    }

    private func sendChatGPTMessage(_ text: String, requestId: String, sourceWebView: WKWebView?) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, message.utf8.count <= 12_000 else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "发往 ChatGPT 的控制消息为空或过长", to: sourceWebView)
            return
        }
        guard let browser = browserWebView, isChatGPTURL(browser.url) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "右侧不是 ChatGPT 页面", to: sourceWebView)
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["message": message]),
              let json = String(data: data, encoding: .utf8) else {
            sendBrowserControlResult(requestId: requestId, ok: false, error: "控制消息编码失败", to: sourceWebView)
            return
        }
        let script = #"""
        ((payload) => {
          const visible = (node) => !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
          const composer = Array.from(document.querySelectorAll('#prompt-textarea,textarea,[contenteditable="true"]'))
            .find((node) => visible(node) && (node.id === 'prompt-textarea' || node.tagName === 'TEXTAREA' || node.getAttribute('contenteditable') === 'true'));
          if (!composer) return {prepared:false,reason:'没有找到 ChatGPT 输入框'};
          const roleAssistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
          const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], article[data-turn-id]'));
          const turnAssistants = turns.filter((turn) => !turn.querySelector('[data-message-author-role="user"]')
            && (/(?:ChatGPT 说|ChatGPT said)/i.test(turn.querySelector('h4,h5')?.textContent || '')
              || !!turn.querySelector('.markdown, [data-message-author-role="assistant"]')));
          const assistants = turnAssistants.length >= roleAssistants.length ? turnAssistants : roleAssistants;
          const roleUsers = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
          const turnUsers = turns.filter((turn) => !!turn.querySelector('[data-message-author-role="user"]')
            || /(?:你说|You said)/i.test(turn.querySelector('h4,h5')?.textContent || ''));
          const users = turnUsers.length >= roleUsers.length ? turnUsers : roleUsers;
          const turnId = (node) => {
            const turn = node?.closest('[data-turn-id], [data-testid^="conversation-turn-"]') || node;
            return turn?.getAttribute('data-turn-id') || node?.getAttribute('data-message-id')
              || turn?.getAttribute('data-testid') || '';
          };
          composer.focus();
          if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
            const proto = composer.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(composer, payload.message); else composer.value = payload.message;
            composer.dispatchEvent(new Event('input', {bubbles:true}));
            composer.dispatchEvent(new Event('change', {bubbles:true}));
          } else {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(composer);
            selection.removeAllRanges();
            selection.addRange(range);
            let inserted = false;
            try { inserted = document.execCommand('insertText', false, payload.message); } catch (_) {}
            if (!inserted || !(composer.innerText || '').trim()) composer.textContent = payload.message;
            try {
              composer.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:payload.message}));
            } catch (_) {
              composer.dispatchEvent(new Event('input', {bubbles:true}));
            }
          }
          return {prepared:true,assistantCount:assistants.length,
            assistantId:turnId(assistants[assistants.length - 1]),
            userCount:users.length,userId:turnId(users[users.length - 1])};
        })(\#(json))
        """#
        browser.evaluateJavaScript(script) { [weak self, weak sourceWebView] value, evalError in
            guard let self else { return }
            let result = value as? [String: Any] ?? [:]
            guard evalError == nil, result["prepared"] as? Bool == true else {
                self.sendBrowserControlResult(
                    requestId: requestId,
                    ok: false,
                    error: evalError?.localizedDescription ?? (result["reason"] as? String ?? "ChatGPT 输入框没有就绪"),
                    to: sourceWebView
                )
                return
            }
            let baselineAssistantCount = result["assistantCount"] as? Int ?? 0
            let baselineAssistantId = result["assistantId"] as? String ?? ""
            let baselineUserCount = result["userCount"] as? Int ?? 0
            let baselineUserId = result["userId"] as? String ?? ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) { [weak self, weak sourceWebView] in
                self?.submitPreparedChatGPTMessage(
                    message: message,
                    requestId: requestId,
                    sourceWebView: sourceWebView,
                    baselineAssistantCount: baselineAssistantCount,
                    baselineAssistantId: baselineAssistantId,
                    baselineUserCount: baselineUserCount,
                    baselineUserId: baselineUserId
                )
            }
        }
    }

    func handleChatGPTControl(_ body: [String: Any], sourceWebView: WKWebView?) {
        chatGPTControlUntil = Date().addingTimeInterval(body["operation"] as? String == "send" ? 300 : 30)
        let requestId = body["requestId"] as? String ?? UUID().uuidString
        switch body["operation"] as? String {
        case "snapshot":
            chatGPTSnapshot(requestId: requestId, sourceWebView: sourceWebView)
        case "selectChat":
            selectChatGPTChatMode(requestId: requestId, sourceWebView: sourceWebView)
        case "findPlugin":
            findChatGPTPlugin(body["name"] as? String ?? "", requestId: requestId, sourceWebView: sourceWebView)
        case "activatePlugin":
            activateChatGPTPlugin(body["name"] as? String ?? "", requestId: requestId, sourceWebView: sourceWebView)
        case "send":
            sendChatGPTMessage(body["text"] as? String ?? "", requestId: requestId, sourceWebView: sourceWebView)
        default:
            sendBrowserControlResult(requestId: requestId, ok: false, error: "不支持的 ChatGPT 控制操作", to: sourceWebView)
        }
    }

    private func loadBrowserStartPage() {
        // 起始页用 color-scheme + 媒体查询跟着全局深色走，不再写死浅色。
        let html = #"""
        <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
        <style>
          *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#fffafd,#f9edf5);font:14px -apple-system;color:#70425b}
          main{text-align:center;padding:36px}.mark{width:58px;height:58px;margin:0 auto 18px;display:grid;place-items:center;border:1px solid #d8679b45;border-radius:20px;background:#fff9;box-shadow:0 14px 38px #9f4c7420;font-size:25px}
          p{margin:0;color:#9a7187}
          @media(prefers-color-scheme:dark){body{background:linear-gradient(145deg,#151016,#211825);color:#f2e7ec}main{background:#0000}.mark{background:#ffffff0f;border-color:#ff7fb340;box-shadow:0 14px 38px #0006}p{color:#b09aa3}}
        </style><main><div class="mark">◎</div><p>在上方输入网址或搜索内容</p></main>
        """#
        browserWebView?.loadHTMLString(html, baseURL: nil)
        browserAddressField?.stringValue = ""
    }

    func updateBrowserControls() {
        browserBackButton?.isEnabled = browserWebView?.canGoBack == true
        browserForwardButton?.isEnabled = browserWebView?.canGoForward == true
        if let url = browserWebView?.url,
           ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") {
            lastBrowserURL = url
            browserAddressField?.show(url)
        } else if let url = browserWebView?.url, url.scheme == "clekk-material" {
            let name = url.lastPathComponent
            browserAddressField?.stringValue = url.host == "workspace" && name.hasSuffix(".html") ? String(name.dropLast(5)) : name
        } else if browserWebView?.url == nil, browserWebView?.isLoading != true {
            // 起始页是 loadHTMLString 生成的，地址栏没有 URL 可显示；
            // 不清空的话，关掉再开浏览器会留着上一次的网址。
            browserAddressField?.stringValue = ""
        }
        updateBrowserToolbarLayout(width: browserFloatingFrame?.width ?? browserPanel?.bounds.width ?? 600)
    }

    func openBrowserWorkspace(url: URL?) {
        ensureBrowserWorkspace(url: url, focus: true)
    }

    private func ensureBrowserWorkspace(url: URL?, focus: Bool, showStartPage: Bool = true) {
        guard let window,
              let contentView = window.contentView,
              let primaryWebView = webView else { return }

        browserAnimationGeneration += 1
        let panel = browserPanel ?? makeBrowserPanel()
        panel.layer?.removeAllAnimations()
        panel.alphaValue = 1
        if panel.superview == nil {
            clearBrowserEdgeDock()
            browserPresentation = .floating
            contentView.addSubview(panel)
            applyBrowserPresentation(in: contentView, primary: primaryWebView)
            contentView.layoutSubtreeIfNeeded()

            // The panel eases in from the existing right rail. This is a
            // presentation-only transition: the live page and its scroll
            // position are never remounted for the animation.
            let slide = CABasicAnimation(keyPath: "transform.translation.x")
            slide.fromValue = 54
            slide.toValue = 0
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 0.78
            fade.toValue = 1.0
            let group = CAAnimationGroup()
            group.animations = [slide, fade]
            group.duration = 0.26
            group.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.layer?.add(group, forKey: "laolao-browser-enter")
        }

        if let url {
            loadBrowserURL(url)
        } else if showStartPage && browserWebView?.url == nil {
            if let lastBrowserURL { loadBrowserURL(lastBrowserURL) }
            else { loadBrowserStartPage() }
        }
        if focus {
            if browserDockEdge != nil {
                clearBrowserEdgeDock()
                if let frame = browserFloatingFrame { setBrowserFloatingFrame(frame) }
            }
            window.makeFirstResponder(browserWebView?.url == nil ? browserAddressField : browserWebView)
        }
    }
}
