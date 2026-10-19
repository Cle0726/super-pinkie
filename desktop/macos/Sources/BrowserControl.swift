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

/// The C.le. palette used by the native browser chrome.
///
/// These are the *current* values of `services/cle-studio/src/styles/tokens.css`
/// and `themes/cle.json` (light and dark). They are duplicated here only because
/// AppKit cannot read CSS variables; keeping one table is what stops the native
/// chrome from drifting into a third, hand-mixed palette again.
///
/// light: paper #F4EFE4  ink #15161A  ink-2 #5C5A57  ink-3 #9A958B
///        surface #FBF8F1  line rgba(20,18,15,.10)  gaze #2A63E8  gold #A9842F
/// dark:  paper #0A0D16  ink #EFE8DA  ink-2 #A39D90  ink-3 #686457
///        surface #111522  line rgba(255,255,255,.08)  gaze #5AA8FF  gold #C9A24A
enum CleBrowserPalette {
    static let paper = NSColor(srgbRed: 0.957, green: 0.937, blue: 0.894, alpha: 1)
    static let surface = NSColor(srgbRed: 0.984, green: 0.973, blue: 0.945, alpha: 1)
    static let ink = NSColor(srgbRed: 0.082, green: 0.086, blue: 0.102, alpha: 1)
    static let ink2 = NSColor(srgbRed: 0.361, green: 0.353, blue: 0.341, alpha: 1)
    static let ink3 = NSColor(srgbRed: 0.604, green: 0.584, blue: 0.545, alpha: 1)
    static let line = NSColor(srgbRed: 0.078, green: 0.071, blue: 0.059, alpha: 0.10)
    static let gaze = NSColor(srgbRed: 0.165, green: 0.388, blue: 0.910, alpha: 1)
    static let gold = NSColor(srgbRed: 0.663, green: 0.518, blue: 0.184, alpha: 1)

    static let nightPaper = NSColor(srgbRed: 0.039, green: 0.051, blue: 0.086, alpha: 1)
    static let nightSurface = NSColor(srgbRed: 0.067, green: 0.082, blue: 0.133, alpha: 1)
    static let nightInk = NSColor(srgbRed: 0.937, green: 0.910, blue: 0.855, alpha: 1)
    static let nightInk2 = NSColor(srgbRed: 0.639, green: 0.616, blue: 0.565, alpha: 1)
    static let nightInk3 = NSColor(srgbRed: 0.408, green: 0.392, blue: 0.341, alpha: 1)
    static let nightLine = NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.08)
    static let nightGaze = NSColor(srgbRed: 0.353, green: 0.659, blue: 1.0, alpha: 1)
    static let nightGold = NSColor(srgbRed: 0.788, green: 0.635, blue: 0.290, alpha: 1)

    static func paper(_ dark: Bool) -> NSColor { dark ? nightPaper : paper }
    static func surface(_ dark: Bool) -> NSColor { dark ? nightSurface : surface }
    static func ink(_ dark: Bool) -> NSColor { dark ? nightInk : ink }
    static func ink2(_ dark: Bool) -> NSColor { dark ? nightInk2 : ink2 }
    static func ink3(_ dark: Bool) -> NSColor { dark ? nightInk3 : ink3 }
    static func line(_ dark: Bool) -> NSColor { dark ? nightLine : line }
    static func gaze(_ dark: Bool) -> NSColor { dark ? nightGaze : gaze }
    static func gold(_ dark: Bool) -> NSColor { dark ? nightGold : gold }

    /// CSS custom properties for the native `loadHTMLString` pages (start page,
    /// error page). One string so a page never invents its own colours again.
    static var cssVariables: String {
        """
        :root{--paper:#F4EFE4;--surface:#FBF8F1;--ink:#15161A;--ink2:#5C5A57;--ink3:#9A958B;--line:rgba(20,18,15,.10);--line-strong:rgba(20,18,15,.18);--gaze:#2A63E8;--gold:#A9842F}
        @media(prefers-color-scheme:dark){:root{--paper:#0A0D16;--surface:#111522;--ink:#EFE8DA;--ink2:#A39D90;--ink3:#686457;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.14);--gaze:#5AA8FF;--gold:#C9A24A}}
        """
    }
}

/// The C.le. wordmark as text, not as a re-drawn glyph.
///
/// The app's own brand mark is a plain italic serif wordmark:
/// `.cle-brandmark { font: italic 400 22px/1 var(--cle-serif) }` in
/// `src/rooms/rooms.css`, i.e. `C.le.` set in the serif face with a slight
/// negative tracking. An earlier attempt re-assembled the pen-lettering SVG
/// geometry with a fixed stroke and it read as a heavy block, so the mark is
/// now the same wordmark the app itself renders, with no new icon invented.
enum CleWordmark {
    /// The wordmark as HTML, using the same face and tracking as `.cle-brandmark`.
    static func html(pointSize: Double, tone: String = "ink", italic: Bool = true) -> String {
        """
        <span class="cle-word" style="font:\(italic ? "italic " : "")400 \(Int(pointSize))px/1 ui-serif, 'New York', 'Songti SC', 'STSong', serif;letter-spacing:-.015em;color:var(--\(tone))">C.le.</span>
        """
    }
}

/// Shared by the App toolbar and the separate WebKit test host. It does not blink.
final class BrowserActivityIndicator: NSStackView {
    private let dot = NSView(frame: .zero)
    private let label = NSTextField(labelWithString: "Li An 正在使用浏览器")

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
        let accent = CleBrowserPalette.gaze(dark)
        dot.layer?.backgroundColor = accent.cgColor
        label.textColor = CleBrowserPalette.ink2(dark)
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
        let night = browser.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let accent = CleBrowserPalette.gaze(night)
        spot.wantsLayer = true
        spot.layer?.cornerRadius = 12
        spot.layer?.backgroundColor = accent.withAlphaComponent(0.14).cgColor
        spot.layer?.borderWidth = 1
        spot.layer?.borderColor = accent.withAlphaComponent(0.34).cgColor
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

    private func screenshot(_ body: [String: Any], browser: WKWebView, request: Request) {        let capture = { [weak self, weak request] (width: Double, height: Double, restore: (() -> Void)?) in
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
    /// Set only by `adoptExistingGateway`, never by the shipped app path. It
    /// records that the authorised root is the already-running test gateway
    /// rather than a child this process spawned, so the stricter reader
    /// handshake can be required in exactly that case.
    private static var adoptedGateway = false
    private var directory: URL?
    private var listener: Int32 = -1
    private var source: DispatchSourceRead?
    private var token = ""
    private let queue = DispatchQueue(label: "com.openclaw.super-pinkie.app-browser.socket", qos: .userInitiated, attributes: .concurrent)

    static func environmentValue() -> String? { stateLock.lock(); defer { stateLock.unlock() }; return environment }
    /// Shared instance used by the diagnostics below; the App keeps its own
    /// instance in AppDelegate, and both bind the same static authorization.
    static let shared = BrowserControlEndpoint()
    static func authorizeGateway(_ pid: pid_t) { stateLock.lock(); gatewayPID = pid; adoptedGateway = false; stateLock.unlock() }
    static func isAdoptedGateway() -> Bool { stateLock.lock(); defer { stateLock.unlock() }; return adoptedGateway }

    /// Attach this endpoint to a gateway that is already running (the isolated
    /// acceptance host's 19789). Nothing is spawned, signalled or replaced, and
    /// the caller must have proved the target by other means first.
    ///
    /// `allowedPeer` still requires an exact PID (or descendant) match; because
    /// an already-running gateway is not our child, the caller also has to
    /// supply the proof it used. See `verifyAdoptableGateway`.
    static func adoptExistingGateway(_ pid: pid_t) {
        stateLock.lock(); gatewayPID = pid; adoptedGateway = true; stateLock.unlock()
    }

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

    /// Narrow re-check for the adopted-root credential handshake only.
    /// `allowedPeer` already proved this peer is the authorised PID (or its
    /// descendant); this adds the fact that the PID still owns its recorded
    /// socket and still maps the executable we verified, so PID reuse or a
    /// different binary cannot collect the token.
    private static func adoptedPeerIsVerifiedGateway(_ peer: pid_t) -> Bool {
        stateLock.lock(); let root = gatewayPID; let recorded = adoptedExecutable; stateLock.unlock()
        guard let root, root > 0, let recorded else { return false }
        guard let current = Self.executablePath(for: peer),
              Self.canonical(current) == recorded else { return false }
        return Self.stillSameListener(peer, executable: recorded)
    }

    /// Recorded when the acceptance host adopts the gateway, so the handshake
    /// can prove the same binary is still behind the socket.
    private static var adoptedExecutable: String?
    static func setAdoptedExecutable(_ path: String?) {
        stateLock.lock(); adoptedExecutable = path.map { Self.canonical($0) }; stateLock.unlock()
    }

    private static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
    }

    private static func executablePath(for pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: 4096)
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        let end = buffer.firstIndex(of: 0) ?? buffer.endIndex
        return String(decoding: buffer[..<end].map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    private static func stillSameListener(_ pid: pid_t, executable: String) -> Bool {
        guard executablePath(for: pid) != nil else { return false }
        return executablePath(for: pid).map { canonical($0) == executable } ?? false
    }

    /// Remove leftover `pinkie-browser-*` directories whose endpoint is gone.
    /// Deliberately narrow: only our prefix, only same-uid, only mode 0700, and
    /// only when a real connect() proves nobody is listening (ECONNREFUSED).
    /// Anything ambiguous is left alone.
    private static func removeStaleDirectories() {
        let manager = FileManager.default
        guard let entries = try? manager.contentsOfDirectory(atPath: "/tmp") else { return }
        for entry in entries where entry.hasPrefix("pinkie-browser-") {
            let path = "/tmp/" + entry
            guard let attrs = try? manager.attributesOfItem(atPath: path),
                  attrs[.type] as? FileAttributeType == .typeDirectory,
                  let owner = attrs[.ownerAccountID] as? NSNumber, owner.uint32Value == getuid(),
                  let mode = attrs[.posixPermissions] as? NSNumber, mode.intValue == 0o700 else { continue }
            let socket = path + "/control.sock"
            guard manager.fileExists(atPath: socket) else { continue }
            let probe = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
            guard probe >= 0 else { continue }
            defer { Darwin.close(probe) }
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            let bytes = Array(socket.utf8CString)
            guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { continue }
            withUnsafeMutableBytes(of: &address.sun_path) { buffer in
                buffer.copyBytes(from: bytes.map { UInt8(bitPattern: $0) })
            }
            let connected = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.connect(probe, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard connected != 0, errno == ECONNREFUSED else { continue }
            try? manager.removeItem(atPath: path)
        }
    }

    func start(handler: @escaping ([String: Any], @escaping ([String: Any]) -> Void) -> Void) throws {
        guard listener < 0 else { return }
        // A killed host leaves its socket directory behind; sweep only provably
        // dead ones before creating a fresh endpoint.
        Self.removeStaleDirectories()
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
            // One exception, and only one: the authorised gateway asking for the
            // credential it was never handed because this host did not spawn it.
            // It still passes the same uid + LOCAL_PEERPID + allowedPeer checks
            // above; an adopted root must additionally prove its own executable
            // is the one we verified. No action is performed, nothing is logged.
            if body["op"] as? String == "handshake", Self.isAdoptedGateway(),
               Self.adoptedPeerIsVerifiedGateway(peer) {
                var payload: [String: Any] = ["ok": true, "v": 1]
                if let path = directory?.appendingPathComponent("control.sock").path { payload["socketPath"] = path }
                if !token.isEmpty { payload["token"] = token }
                write(payload, client: client)
                return
            }
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
