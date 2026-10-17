import AppKit
import Darwin
import Foundation
import WebKit

enum BrowserControlPolicy {
    static let writes: Set<String> = ["open", "click", "type", "press", "scroll", "back", "forward", "reload", "eval", "show_file", "close"]

    static func timeout(for action: String, requestedMilliseconds: Double?) -> TimeInterval {
        let maximum: TimeInterval = ["open", "back", "forward", "reload", "show_file"].contains(action) ? 30 : 15
        guard let requestedMilliseconds, requestedMilliseconds.isFinite else { return maximum }
        return min(maximum, max(0.1, requestedMilliseconds / 1000))
    }

    static func validatedURL(_ text: String, access: MaterialPreviewFileAccess) throws -> URL {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let local = clean.hasPrefix("localhost:") || clean.hasPrefix("127.0.0.1:") || clean == "localhost" || clean == "127.0.0.1"
        guard let url = URL(string: local ? "http://" + clean : clean),
              let scheme = url.scheme?.lowercased(), ["http", "https", "file"].contains(scheme) else {
            throw error("请输入 http、https 或家目录中的文件网址。")
        }
        if url.isFileURL { return try access.validatedFile(path: url.path) }
        guard url.host != nil, url.user == nil, url.password == nil else { throw error("网页地址无效。") }
        return url
    }

    static func allowsEvaluation(on url: URL?, access: MaterialPreviewFileAccess) -> Bool {
        guard let url else { return false }
        if url.isFileURL { return (try? access.validatedFile(path: url.path)) != nil }
        return ["http", "https"].contains(url.scheme?.lowercased() ?? "")
            && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(url.host?.lowercased() ?? "")
    }

    static func isChatGPT(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else { return false }
        return host == "chatgpt.com" || host.hasSuffix(".chatgpt.com")
    }

    static func error(_ message: String) -> NSError {
        NSError(domain: "PinkieBrowserControl", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// Shared by the App toolbar and the separate WebKit test host. It does not blink.
final class BrowserActivityIndicator: NSStackView {
    private let dot = NSView(frame: .zero)
    private let label = NSTextField(labelWithString: "碧琪正在使用浏览器")

    init() {
        super.init(frame: .zero)
        orientation = .horizontal
        alignment = .centerY
        spacing = 5
        translatesAutoresizingMaskIntoConstraints = false
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3
        label.font = NSFont.systemFont(ofSize: 10.5, weight: .medium)
        label.lineBreakMode = .byTruncatingTail
        addArrangedSubview(dot)
        addArrangedSubview(label)
        NSLayoutConstraint.activate([dot.widthAnchor.constraint(equalToConstant: 6), dot.heightAnchor.constraint(equalToConstant: 6)])
        setNight(false)
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setNight(_ dark: Bool) {
        let accent = dark ? NSColor(srgbRed: 1, green: 0.61, blue: 0.77, alpha: 1)
            : NSColor(srgbRed: 0.82, green: 0.33, blue: 0.57, alpha: 1)
        dot.layer?.backgroundColor = accent.cgColor
        label.textColor = accent
    }
}

private final class BrowserFeedbackView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

enum BrowserClickFeedback {
    static func show(in browser: WKWebView, x: Double, y: Double) {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              x.isFinite, y.isFinite else { return }
        let spot = BrowserFeedbackView(frame: NSRect(x: x - 12, y: Double(browser.bounds.height) - y - 12, width: 24, height: 24))
        spot.wantsLayer = true
        spot.layer?.cornerRadius = 12
        spot.layer?.backgroundColor = NSColor(srgbRed: 0.88, green: 0.40, blue: 0.63, alpha: 0.18).cgColor
        spot.layer?.borderWidth = 1
        spot.layer?.borderColor = NSColor(srgbRed: 0.88, green: 0.40, blue: 0.63, alpha: 0.28).cgColor
        browser.addSubview(spot)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) { spot.removeFromSuperview() }
    }
}

/// All WebKit work stays on the main thread. The caller's deadline owns every
/// continuation, so late navigation/JS callbacks cannot complete or mutate twice.
final class BrowserControlController {
    private final class Request {
        let key = UUID()
        let id: Any
        let deadline: Date
        let completion: ([String: Any]) -> Void
        var finished = false
        var navigation: ObjectIdentifier?
        var cancellation: (() -> Void)?
        var completesOnCommit = false

        init(body: [String: Any], timeout: TimeInterval, completion: @escaping ([String: Any]) -> Void) {
            id = body["id"] ?? ""
            deadline = Date().addingTimeInterval(timeout)
            self.completion = completion
        }
    }

    var webView: () -> WKWebView? = { nil }
    var isOpen: () -> Bool = { false }
    var openWorkspace: (_ focus: Bool) -> WKWebView? = { _ in nil }
    var closeWorkspace: () -> Void = {}
    var registerFilePreview: (String) -> [String: Any] = { _ in ["ok": false, "message": "文件预览暂时不可用。"] }
    var collaborationActive: (@escaping (Bool) -> Void) -> Void = { done in done(false) }
    var activityChanged: (Bool) -> Void = { _ in }
    var clicked: (WKWebView, Double, Double) -> Void = { BrowserClickFeedback.show(in: $0, x: $1, y: $2) }

    private let access: MaterialPreviewFileAccess
    private let world = WKContentWorld.world(name: "com.openclaw.super-pinkie.browser-control")
    private var requests: [UUID: Request] = [:]
    private var navigations: [ObjectIdentifier: (Request, ([String: Any]) -> Void)] = [:]
    private var userUntil = Date.distantPast
    private var activityGeneration = 0
    private var snapshotDirectory: URL?
    private var currentNavigation: ObjectIdentifier?

    init(access: MaterialPreviewFileAccess = MaterialPreviewFileAccess()) { self.access = access }

    func userDidInteract(now: Date = Date()) { userUntil = now.addingTimeInterval(10) }

    func didStart(_ navigation: WKNavigation?) { currentNavigation = navigation.map(ObjectIdentifier.init) }

    func didCommit(_ navigation: WKNavigation?) {
        guard let navigation, let (request, done) = navigations[ObjectIdentifier(navigation)], request.completesOnCommit, live(request) else { return }
        done(pageStatus())
    }

    func didFinish(_ navigation: WKNavigation?, error: Error? = nil) {
        if let navigation, currentNavigation == ObjectIdentifier(navigation) { currentNavigation = nil }
        guard let navigation, let (request, done) = navigations.removeValue(forKey: ObjectIdentifier(navigation)), live(request) else { return }
        if let error { finish(request, reason: "页面没有加载成功：" + error.localizedDescription) }
        else { done(pageStatus()) }
    }

    func handle(_ body: [String: Any], userInitiated: Bool = false, completion: @escaping ([String: Any]) -> Void) {
        precondition(Thread.isMainThread)
        let action = body["action"] as? String ?? ""
        let timeout = BrowserControlPolicy.timeout(for: action, requestedMilliseconds: (body["timeoutMs"] as? NSNumber)?.doubleValue)
        let request = Request(body: body, timeout: timeout, completion: completion)
        request.completesOnCommit = userInitiated && action == "show_file"
        requests[request.key] = request
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self, weak request] in
            guard let self, let request, !request.finished else { return }
            let waitMilliseconds = min(15_000, max(0, (body["ms"] as? NSNumber)?.doubleValue ?? 0))
            if action == "wait", body["text"] == nil, body["selector"] == nil, waitMilliseconds <= timeout * 1000 {
                self.finish(request, result: ["waitedMs": waitMilliseconds])
                return
            }
            self.finish(request, reason: "等待浏览器操作超时，请确认页面状态后再试。")
        }
        if !userInitiated, BrowserControlPolicy.writes.contains(action), userUntil > Date() {
            finish(request, reason: "用户正在操作浏览器")
            return
        }
        let perform = { [weak self, weak request] in
            guard let self, let request, self.live(request) else { return }
            // Check again after the async collaboration probe: a user may have
            // clicked during that probe, before any browser write is dispatched.
            if !userInitiated, BrowserControlPolicy.writes.contains(action), self.userUntil > Date() {
                self.finish(request, reason: "用户正在操作浏览器")
                return
            }
            if !userInitiated && action != "status" { self.markActivity() }
            self.perform(action, body: body, request: request)
        }
        if !userInitiated, BrowserControlPolicy.writes.contains(action), BrowserControlPolicy.isChatGPT(webView()?.url) {
            collaborationActive { [weak self, weak request] active in
                guard let self, let request, self.live(request) else { return }
                if active { self.finish(request, reason: "ChatGPT 协作正在使用浏览器，请等协作结束后再操作。") }
                else { perform() }
            }
        } else { perform() }
    }

    private func live(_ request: Request) -> Bool { !request.finished && requests[request.key] != nil && Date() < request.deadline }

    private func finish(_ request: Request, result: [String: Any] = [:], reason: String? = nil) {
        guard !request.finished else { return }
        request.finished = true
        requests.removeValue(forKey: request.key)
        if let navigation = request.navigation { navigations.removeValue(forKey: navigation) }
        if reason != nil { request.cancellation?() }
        request.cancellation = nil
        if let reason { request.completion(["id": request.id, "ok": false, "reason": reason]) }
        else { request.completion(["id": request.id, "ok": true, "result": result]) }
    }

    private func markActivity() {
        activityGeneration += 1
        let generation = activityGeneration
        activityChanged(true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, self.activityGeneration == generation else { return }
            if self.requests.isEmpty { self.activityChanged(false) }
            else { self.markActivity() }
        }
    }

    private func pageStatus() -> [String: Any] {
        let browser = webView()
        let url = browser?.url
        // Preview tokens are bearer secrets, and never belong in tool output.
        let visibleURL = url?.scheme == "clekk-material" ? url?.lastPathComponent ?? "" : url?.absoluteString ?? ""
        return ["open": isOpen(), "url": visibleURL, "title": browser?.title ?? "", "loading": browser?.isLoading ?? false,
                "canGoBack": browser?.canGoBack ?? false, "canGoForward": browser?.canGoForward ?? false]
    }

    private func navigation(_ navigation: WKNavigation?, browser: WKWebView, request: Request) {
        guard let navigation else { finish(request, reason: "浏览器没有开始导航，请再试一次。"); return }
        let key = ObjectIdentifier(navigation)
        currentNavigation = key
        request.navigation = key
        request.cancellation = { [weak self, weak browser] in
            if self?.currentNavigation == key { browser?.stopLoading() }
        }
        navigations[key] = (request, { [weak self, weak request] result in
            guard let self, let request else { return }
            self.finish(request, result: result)
        })
    }

    private func evaluate(_ script: String, browser: WKWebView, request: Request, done: @escaping (Any?) -> Void) {
        guard live(request) else { return }
        browser.evaluateJavaScript(script, in: nil, in: world) { [weak self, weak request] result in
            guard let self, let request, self.live(request) else { return }
            switch result {
            case .success(let value): done(value)
            case .failure: self.finish(request, reason: "网页操作没有完成，请重新获取页面快照后再试。")
            }
        }
    }

    private func perform(_ action: String, body: [String: Any], request: Request) {
        if action == "status" { finish(request, result: pageStatus()); return }
        if action == "close" { closeWorkspace(); finish(request, result: ["open": false]); return }
        if action == "open" {
            do {
                let url = try BrowserControlPolicy.validatedURL(body["url"] as? String ?? "", access: access)
                guard let browser = openWorkspace(body["focus"] as? Bool ?? false) else { finish(request, reason: "App 浏览器暂时不可用。"); return }
                if url.isFileURL { navigation(browser.loadFileURL(url, allowingReadAccessTo: url), browser: browser, request: request) }
                else { navigation(browser.load(URLRequest(url: url)), browser: browser, request: request) }
            } catch { finish(request, reason: error.localizedDescription) }
            return
        }
        if action == "show_file" {
            let result = registerFilePreview(body["path"] as? String ?? "")
            guard result["ok"] as? Bool == true, let text = result["url"] as? String, let url = URL(string: text) else {
                finish(request, reason: result["message"] as? String ?? "文件预览没有打开。"); return
            }
            guard let browser = openWorkspace(body["focus"] as? Bool ?? false) else { finish(request, reason: "App 浏览器暂时不可用。"); return }
            navigation(browser.load(URLRequest(url: url)), browser: browser, request: request)
            return
        }
        guard let browser = webView(), isOpen() else { finish(request, reason: "请先用 open 打开 App 浏览器。"); return }
        if ["back", "forward", "reload"].contains(action) {
            let target: WKNavigation?
            if action == "back" { target = browser.canGoBack ? browser.goBack() : nil }
            else if action == "forward" { target = browser.canGoForward ? browser.goForward() : nil }
            else { target = browser.reload() }
            navigation(target, browser: browser, request: request)
            return
        }
        if action == "eval" {
            guard BrowserControlPolicy.allowsEvaluation(on: browser.url, access: access) else {
                finish(request, reason: "自定义脚本只允许在本机服务或家目录的文件页面运行。"); return
            }
            guard let script = body["js"] as? String, !script.isEmpty, script.utf8.count <= 128 * 1024 else {
                finish(request, reason: "脚本为空或过长。"); return
            }
            evaluate(script, browser: browser, request: request) { [weak self, weak request] value in
                guard let self, let request else { return }
                self.finish(request, result: ["value": value ?? NSNull()])
            }
            return
        }
        if action == "screenshot" { screenshot(body, browser: browser, request: request); return }
        if action == "press", let window = browser.window {
            let key = body["key"] as? String ?? ""
            let keys: [String: (UInt16, String)] = ["Enter": (36, "\r"), "Escape": (53, "\u{1b}"), "Tab": (48, "\t"),
                "ArrowLeft": (123, "\u{f702}"), "ArrowRight": (124, "\u{f703}"), "ArrowUp": (126, "\u{f700}"), "ArrowDown": (125, "\u{f701}")]
            guard let (code, characters) = keys[key],
                  let down = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                             windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code),
                  let up = NSEvent.keyEvent(with: .keyUp, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) else {
                finish(request, reason: "只支持回车、退出、制表和方向键。"); return
            }
            let deliver = { [weak self, weak request] in
                guard let self, let request, self.live(request) else { return }
                window.makeFirstResponder(browser)
                // Direct responder delivery keeps real editing/selection defaults,
                // without passing through the human-input NSEvent monitor.
                window.firstResponder?.keyDown(with: down)
                window.firstResponder?.keyUp(with: up)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self, weak request] in
                    guard let self, let request, self.live(request) else { return }
                    if key == "Tab" {
                        // macOS can exclude buttons from native Tab traversal.
                        // Only supply the missing default if the page did not
                        // handle the key and WebKit left focus unchanged.
                        let script = #"""
                        (()=>{const s=globalThis.__pinkieTabKey;if(s && !s.prevented && (document.activeElement===s.origin || document.activeElement===document.body)){const a=Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&e.tabIndex>=0});a[(a.indexOf(s.origin)+1)%a.length]?.focus();}return true})()
                        """#
                        self.evaluate(script, browser: browser, request: request) { [weak self, weak request] _ in
                            guard let self, let request else { return }
                            self.finish(request, result: ["pressed": key])
                        }
                    } else { self.finish(request, result: ["pressed": key]) }
                }
            }
            if key == "Tab" {
                evaluate("(()=>{globalThis.__pinkieTabKey={origin:document.activeElement,prevented:false};document.addEventListener('keydown',e=>{if(e.key==='Tab')queueMicrotask(()=>{globalThis.__pinkieTabKey.prevented=e.defaultPrevented})},{once:true});return true})()", browser: browser, request: request) { _ in deliver() }
            } else { deliver() }
            return
        }
        if action == "wait" {
            let milliseconds = min(15_000, max(0, (body["ms"] as? NSNumber)?.doubleValue ?? 0))
            if body["text"] == nil && body["selector"] == nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + milliseconds / 1000) { [weak self, weak request] in
                    guard let self, let request, self.live(request) else { return }
                    self.finish(request, result: ["waitedMs": milliseconds])
                }
            } else { waitForPage(body, browser: browser, request: request) }
            return
        }
        guard ["snapshot", "click", "type", "press", "scroll"].contains(action) else {
            finish(request, reason: "不支持这个浏览器操作。"); return
        }
        var params = body
        params.removeValue(forKey: "token")
        params["action"] = action
        guard let data = try? JSONSerialization.data(withJSONObject: params), let json = String(data: data, encoding: .utf8) else {
            finish(request, reason: "浏览器参数无效。"); return
        }
        evaluate(Self.domScript + "\nreturn globalThis.__pinkieBrowserControl.run(" + json + ");\n})()", browser: browser, request: request) { [weak self, weak request] value in
            guard let self, let request else { return }
            let result = value as? [String: Any] ?? [:]
            if let reason = result["reason"] as? String { self.finish(request, reason: reason); return }
            if action == "click", let x = result["x"] as? Double, let y = result["y"] as? Double { self.clicked(browser, x, y) }
            self.finish(request, result: result)
        }
    }

    private func waitForPage(_ body: [String: Any], browser: WKWebView, request: Request) {
        guard live(request), let data = try? JSONSerialization.data(withJSONObject: ["text": body["text"] ?? "", "selector": body["selector"] ?? ""]),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "(() => {const p=" + json + ";try {return (!p.text || (document.body?.innerText || '').includes(p.text)) && (!p.selector || Boolean(document.querySelector(p.selector)));}catch(_){return false;}})()"
        evaluate(script, browser: browser, request: request) { [weak self, weak request] value in
            guard let self, let request else { return }
            if value as? Bool == true { self.finish(request, result: ["matched": true]); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self, weak request] in
                guard let self, let request, self.live(request) else { return }
                self.waitForPage(body, browser: browser, request: request)
            }
        }
    }

    private func screenshot(_ body: [String: Any], browser: WKWebView, request: Request) {
        let capture = { [weak self, weak request] (width: Double, height: Double, restore: (() -> Void)?) in
            guard let self, let request, self.live(request) else { restore?(); return }
            guard width > 0, height > 0, width <= 16384, height <= 16384, width * height <= 64_000_000 else {
                restore?()
                self.finish(request, reason: "页面太大，请使用可见区域截图。"); return
            }
            let configuration = WKSnapshotConfiguration()
            configuration.rect = NSRect(x: 0, y: 0, width: width, height: height)
            configuration.snapshotWidth = NSNumber(value: width)
            browser.takeSnapshot(with: configuration) { [weak self, weak request] image, _ in
                restore?()
                guard let self, let request, self.live(request) else { return }
                guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                      let png = bitmap.representation(using: .png, properties: [:]) else {
                    self.finish(request, reason: "浏览器截图失败，请稍后再试。"); return
                }
                do {
                    let directory: URL
                    if let existing = self.snapshotDirectory { directory = existing }
                    else {
                        directory = URL(fileURLWithPath: "/tmp", isDirectory: true).appendingPathComponent("pinkie-snapshot-" + UUID().uuidString.lowercased(), isDirectory: true)
                        guard Darwin.mkdir(directory.path, 0o700) == 0 else { throw BrowserControlPolicy.error("截图目录创建失败。") }
                        self.snapshotDirectory = directory
                    }
                    let path = directory.appendingPathComponent(UUID().uuidString.lowercased() + ".png")
                    try png.write(to: path, options: .atomic)
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
                    self.finish(request, result: ["path": path.path, "width": bitmap.pixelsWide, "height": bitmap.pixelsHigh, "message": "用 image 工具查看"])
                } catch { self.finish(request, reason: "截图文件保存失败。") }
            }
        }
        if body["fullPage"] as? Bool == true {
            evaluate("({width: Math.max(document.documentElement.scrollWidth, innerWidth), height: Math.max(document.documentElement.scrollHeight, innerHeight), x:scrollX, y:scrollY})", browser: browser, request: request) { [weak self, weak request] value in
                guard let self, let request, self.live(request) else { return }
                let size = value as? [String: Any] ?? [:]
                let width = (size["width"] as? NSNumber)?.doubleValue ?? 0
                let height = (size["height"] as? NSNumber)?.doubleValue ?? 0
                guard width > 0, height > 0, width <= 16384, height <= 16384, width * height <= 64_000_000 else {
                    self.finish(request, reason: "页面太大，请使用可见区域截图。"); return
                }
                let original = browser.frame
                let originalURL = browser.url
                let originalUserUntil = self.userUntil
                let x = (size["x"] as? NSNumber)?.doubleValue ?? 0
                let y = (size["y"] as? NSNumber)?.doubleValue ?? 0
                var restored = false
                let restore = { [weak self, weak browser] in
                    guard !restored, let browser else { return }
                    restored = true
                    browser.frame = original
                    browser.superview?.layoutSubtreeIfNeeded()
                    if let self, browser.url == originalURL, self.userUntil == originalUserUntil {
                        browser.evaluateJavaScript("window.scrollTo(\(x),\(y));", in: nil, in: self.world) { _ in }
                    }
                }
                request.cancellation = restore
                // WebKit omits unpainted content outside its current bounds.
                // Expanding the rendering viewport first makes the full-page
                // image real; every exit restores the frame and scroll point.
                browser.frame = NSRect(origin: original.origin, size: NSSize(width: width, height: height))
                browser.evaluateJavaScript("window.scrollTo(0,0);", in: nil, in: self.world) { _ in }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { capture(width, height, restore) }
            }
        } else { capture(Double(browser.bounds.width), Double(browser.bounds.height), nil) }
    }

    private static let domScript = #"""
    (() => {
      if (!globalThis.__pinkieBrowserControl) {
        const state = { refs: new Map(), sequence: 0 };
        const visible = (el) => {const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none';};
        const name = (el) => (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('title') || el.getAttribute('alt') || el.innerText || el.getAttribute('placeholder') || '').trim().slice(0, 240);
        const role = (el) => el.getAttribute('role') || ({A:'link',BUTTON:'button',TEXTAREA:'textbox',SELECT:'combobox',INPUT:({checkbox:'checkbox',radio:'radio',button:'button',submit:'button'}[el.type] || 'textbox')}[el.tagName]) || (el.isContentEditable?'textbox':'generic');
        const target = (p) => {if(p.ref)return state.refs.get(p.ref);if(p.selector)return document.querySelector(p.selector);if(Number.isFinite(p.x)&&Number.isFinite(p.y))return document.elementFromPoint(p.x,p.y);return null;};
        const fireKey = (el, key) => {
          const codes={Enter:13,Escape:27,Tab:9,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40};
          if(!(key in codes))return false;
          for(const type of ['keydown','keyup'])el.dispatchEvent(new KeyboardEvent(type,{key,code:key,keyCode:codes[key],which:codes[key],bubbles:true,cancelable:true,composed:true}));
          return true;
        };
        const submit = (el) => {const form=el.closest('form');if(form?.requestSubmit)form.requestSubmit();else if(form)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));};
        globalThis.__pinkieBrowserControl={run(p){
          try {
            if(p.action==='snapshot') {
              state.refs.clear();state.sequence++;
              const elements=[];
              for(const el of document.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"],[tabindex]')) {
                if(!visible(el)||elements.length>=300)continue;
                const ref='s'+state.sequence+'e'+(elements.length+1);state.refs.set(ref,el);
                const r=el.getBoundingClientRect();elements.push({ref,role:role(el),name:name(el),tag:el.tagName.toLowerCase(),rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
              }
              const max=Math.max(1,Math.min(30000,Number(p.maxChars)||12000));
              return {title:document.title,text:(document.body?.innerText||'').slice(0,max),elements};
            }
            if(p.action==='press') {
              const el=document.activeElement||document.body;
              if(!fireKey(el,p.key))return {reason:'只支持回车、退出、制表和方向键。'};
              if(p.key==='Enter')submit(el);
              if(p.key==='Tab') {
                const all=Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')).filter(e=>visible(e)&&!e.disabled&&e.tabIndex>=0);
                const next=all[(all.indexOf(el)+1)%all.length];next?.focus();
              }
              if(/^Arrow/.test(p.key)&&!['INPUT','TEXTAREA','SELECT'].includes(el.tagName))window.scrollBy({left:p.key==='ArrowLeft'?-40:p.key==='ArrowRight'?40:0,top:p.key==='ArrowUp'?-40:p.key==='ArrowDown'?40:0,behavior:'instant'});
              return {pressed:p.key};
            }
            if(p.action==='scroll'&&!p.ref) {if(!Number.isFinite(p.dy))return {reason:'请提供滚动距离或元素编号。'};window.scrollBy({top:p.dy,behavior:'instant'});return {x:scrollX,y:scrollY};}
            const el=target(p);
            if(!el||!el.isConnected)return {reason:'没有找到目标，请重新获取页面快照。'};
            if(!visible(el))return {reason:'目标暂时不可见，请重新获取页面快照。'};
            el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
            if(p.action==='scroll')return {scrolled:true};
            if(el.disabled)return {reason:'这个控件暂时不可用。'};
            el.focus?.();
            if(p.action==='click') {
              const r=el.getBoundingClientRect();const x=Number.isFinite(p.x)?p.x:r.x+r.width/2;const y=Number.isFinite(p.y)?p.y:r.y+r.height/2;
              for(const t of ['pointerdown','mousedown','pointerup','mouseup'])el.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0}));
              el.click();return {clicked:true,x,y};
            }
            if(p.action==='type') {
              if(typeof p.text!=='string'||p.text.length>131072)return {reason:'输入内容为空或过长。'};
              if(el.isContentEditable){el.textContent=p.text;el.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:p.text}));}
              else {
                const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='INPUT'?HTMLInputElement.prototype:null;
                if(!proto||el.type==='file')return {reason:'这个控件不支持自动输入。'};
                const set=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!set)return {reason:'输入框暂时不可用。'};
                set.call(el,p.text);el.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:p.text}));
                el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
              }
              if(p.submit){fireKey(el,'Enter');submit(el);}return {typed:true,length:p.text.length};
            }
            return {reason:'不支持这个页面操作。'};
          } catch(_) {return {reason:'网页控件已变化，请重新获取页面快照。'};}
        }};
      }
    """#
}

/// A fresh random token plus owner-only socket directory is passed only to the
/// gateway Process launched by this App. Peer PID ancestry also has to match it.
final class BrowserControlEndpoint {
    private static let stateLock = NSLock()
    private static var environment: String?
    private static var gatewayPID: pid_t?
    private var directory: URL?
    private var listener: Int32 = -1
    private var source: DispatchSourceRead?
    private var token = ""
    private let queue = DispatchQueue(label: "com.openclaw.super-pinkie.app-browser.socket", qos: .userInitiated, attributes: .concurrent)

    static func environmentValue() -> String? { stateLock.lock(); defer { stateLock.unlock() }; return environment }
    static func authorizeGateway(_ pid: pid_t) { stateLock.lock(); gatewayPID = pid; stateLock.unlock() }

    private static func allowedPeer(_ pid: pid_t) -> Bool {
        stateLock.lock(); let root = gatewayPID; stateLock.unlock()
        guard let root, root > 0 else { return false }
        var cursor = pid
        for _ in 0..<32 {
            if cursor == root { return true }
            guard cursor > 1 else { return false }
            var info = proc_bsdinfo()
            let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            guard proc_pidinfo(cursor, PROC_PIDTBSDINFO, 0, &info, size) == size else { return false }
            let parent = pid_t(info.pbi_ppid)
            guard parent != cursor else { return false }
            cursor = parent
        }
        return false
    }

    func start(handler: @escaping ([String: Any], @escaping ([String: Any]) -> Void) -> Void) throws {
        guard listener < 0 else { return }
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
        let root = URL(fileURLWithPath: "/tmp", isDirectory: true).appendingPathComponent("pinkie-browser-\(suffix)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        directory = root
        let socketURL = root.appendingPathComponent("control.sock")
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { stop(); throw BrowserControlPolicy.error("无法创建浏览器控制端点。") }
        listener = fd
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let bytes = Array(socketURL.path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { stop(); throw BrowserControlPolicy.error("浏览器端点路径过长。") }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in buffer.copyBytes(from: bytes.map { UInt8(bitPattern: $0) }) }
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard bound == 0, Darwin.listen(fd, 8) == 0 else { stop(); throw BrowserControlPolicy.error("浏览器控制端点启动失败。") }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: socketURL.path)
        _ = fcntl(fd, F_SETFL, O_NONBLOCK)
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        token = UUID().uuidString + UUID().uuidString
        let encoded = try JSONSerialization.data(withJSONObject: ["v": 1, "socketPath": socketURL.path, "token": token])
        Self.stateLock.lock(); Self.environment = String(data: encoded, encoding: .utf8); Self.stateLock.unlock()
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        self.source = source
        source.setEventHandler { [weak self] in
            guard let self else { return }
            while true {
                let client = Darwin.accept(fd, nil, nil)
                if client < 0 { break }
                // BSD accept can inherit O_NONBLOCK from the listening socket.
                // Per-client reads use a bounded receive timeout instead.
                _ = fcntl(client, F_SETFL, fcntl(client, F_GETFL) & ~O_NONBLOCK)
                _ = fcntl(client, F_SETFD, FD_CLOEXEC)
                var noSIGPIPE: Int32 = 1
                _ = setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSIGPIPE, socklen_t(MemoryLayout<Int32>.size))
                self.queue.async { [weak self] in self?.serve(client, handler: handler) }
            }
        }
        source.setCancelHandler { Darwin.close(fd) }
        source.resume()
    }

    private func serve(_ client: Int32, handler: @escaping ([String: Any], @escaping ([String: Any]) -> Void) -> Void) {
        defer { Darwin.close(client) }
        var uid: uid_t = 0, gid: gid_t = 0, peer: pid_t = 0
        var peerLength = socklen_t(MemoryLayout<pid_t>.size)
        guard getpeereid(client, &uid, &gid) == 0, uid == getuid(),
              getsockopt(client, SOL_LOCAL, LOCAL_PEERPID, &peer, &peerLength) == 0,
              Self.allowedPeer(peer) else {
            NSLog("[碧琪浏览器] 拒绝非 App 网关的连接（进程 %d）。", peer)
            return
        }
        var limit = timeval(tv_sec: 10, tv_usec: 0)
        _ = setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &limit, socklen_t(MemoryLayout<timeval>.size))
        _ = setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &limit, socklen_t(MemoryLayout<timeval>.size))
        var incoming = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while incoming.count <= 256 * 1024 {
            let count = Darwin.recv(client, &buffer, buffer.count, 0)
            if count <= 0 { return }
            incoming.append(contentsOf: buffer.prefix(count))
            if incoming.contains(10) { break }
        }
        guard incoming.count <= 256 * 1024, let newline = incoming.firstIndex(of: 10),
              let body = (try? JSONSerialization.jsonObject(with: incoming.prefix(upTo: newline))) as? [String: Any] else { return }
        guard let candidate = body["token"] as? String, candidate == token else {
            write(["id": body["id"] ?? "", "ok": false, "reason": "浏览器控制请求未获授权。"], client: client)
            return
        }
        let semaphore = DispatchSemaphore(value: 0)
        let replyLock = NSLock()
        var reply: [String: Any]?
        DispatchQueue.main.async {
            handler(body) { result in replyLock.lock(); if reply == nil { reply = result; semaphore.signal() }; replyLock.unlock() }
        }
        let timeout = BrowserControlPolicy.timeout(for: body["action"] as? String ?? "", requestedMilliseconds: (body["timeoutMs"] as? NSNumber)?.doubleValue) + 1
        _ = semaphore.wait(timeout: .now() + timeout)
        replyLock.lock(); let result = reply; replyLock.unlock()
        write(result ?? ["id": body["id"] ?? "", "ok": false, "reason": "等待浏览器操作超时，请稍后再试。"], client: client)
    }

    private func write(_ result: [String: Any], client: Int32) {
        guard var data = try? JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed]) else { return }
        data.append(10)
        data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return }
            var offset = 0
            while offset < data.count {
                let count = Darwin.send(client, base.advanced(by: offset), data.count - offset, 0)
                if count <= 0 { return }
                offset += count
            }
        }
    }

    func stop() {
        Self.stateLock.lock(); Self.environment = nil; Self.gatewayPID = nil; Self.stateLock.unlock()
        if let source { source.cancel() } else if listener >= 0 { Darwin.close(listener) }
        source = nil
        listener = -1
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
        token = ""
    }

    deinit { stop() }
}
