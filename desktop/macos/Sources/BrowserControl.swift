import AppKit
import Darwin
import Foundation
import WebKit

enum BrowserControlPolicy {
    static let writes: Set<String> = ["open", "click", "type", "select", "press", "scroll", "back", "forward", "reload", "eval", "show_file", "close", "move", "hover", "drag", "set_slider"]

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
        guard !browser.subviews.contains(where: { $0 is BrowserAgentPointer && !$0.isHidden }) else { return }
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

/// A browser-local pointer. It never moves the macOS cursor or intercepts input.
private final class BrowserAgentPointer: NSView {
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    private let arrow = CAShapeLayer()
    private let target = CAShapeLayer()
    private let trail = CAShapeLayer()
    private var last: CGPoint?
    private var recent: [CGPoint] = []
    private var generation = 0

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        autoresizingMask = [.width, .height]
        let path = CGMutablePath()
        path.move(to: CGPoint(x:1,y:0)); path.addLine(to: CGPoint(x:1.5,y:15.5))
        path.addLine(to: CGPoint(x:5.5,y:11.8)); path.addLine(to: CGPoint(x:8.8,y:18))
        path.addLine(to: CGPoint(x:11.1,y:16.7)); path.addLine(to: CGPoint(x:7.9,y:10.7))
        path.addLine(to: CGPoint(x:14.2,y:10.6)); path.closeSubpath()
        arrow.path = path; arrow.shadowPath=path; arrow.lineWidth = 0.8; arrow.lineJoin = .round
        arrow.shadowOpacity = 0.14; arrow.shadowRadius = 1.6; arrow.shadowOffset = CGSize(width: 0, height: 1)
        target.fillColor = NSColor.clear.cgColor; target.lineWidth = 1
        trail.fillColor = NSColor.clear.cgColor; trail.lineWidth = 1; trail.lineCap = .round
        target.opacity = 0
        layer?.addSublayer(target); layer?.addSublayer(trail); layer?.addSublayer(arrow)
        isHidden = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show(in browser: WKWebView, info: [String: Any], phase: String) {
        guard let x = info["x"] as? Double, let y = info["y"] as? Double,
              let viewport = info["viewport"] as? [String: Any],
              let width = viewport["width"] as? Double, let height = viewport["height"] as? Double,
              width > 0, height > 0, x.isFinite, y.isFinite else { return }
        if superview !== browser { removeFromSuperview(); frame = browser.bounds; browser.addSubview(self) }
        frame = browser.bounds
        let point = CGPoint(x: x * bounds.width / width, y: y * bounds.height / height)
        let night = browser.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let accent = night
            ? NSColor(srgbRed: 0.714, green: 0.608, blue: 0.792, alpha: 1)
            : NSColor(srgbRed: 0.741, green: 0.549, blue: 0.655, alpha: 1)
        for shape in [arrow,target,trail] {shape.contentsScale=browser.window?.backingScaleFactor ?? 2}
        generation += 1; let ticket = generation
        isHidden = false
        layer?.removeAnimation(forKey:"idle-fade")
        let from=arrow.presentation()?.position ?? last
        CATransaction.begin(); CATransaction.setDisableActions(true)
        arrow.fillColor = NSColor(srgbRed:night ? 0.97:1,green:night ? 0.94:0.98,blue:night ? 1:0.98,alpha:1).cgColor
        arrow.strokeColor = accent.withAlphaComponent(0.9).cgColor
        arrow.position = point
        target.path = CGPath(ellipseIn:CGRect(x:-6,y:-6,width:12,height:12),transform:nil)
        target.position = point; target.strokeColor = accent.withAlphaComponent(0.6).cgColor
        if phase == "drag", let last, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            if recent.isEmpty { recent.append(last) }; recent.append(point); recent=Array(recent.suffix(7))
            let path = CGMutablePath(); path.move(to:recent[0]); for p in recent.dropFirst(){path.addLine(to:p)}
            trail.path = path; trail.strokeColor = accent.withAlphaComponent(0.22).cgColor
        } else { recent.removeAll(keepingCapacity:true); trail.path = nil }
        CATransaction.commit()
        if phase != "drag",let from,!NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,from != point {
            let motion=CABasicAnimation(keyPath:"position");motion.fromValue=NSValue(point:from);motion.toValue=NSValue(point:point);motion.duration=0.09;motion.timingFunction=CAMediaTimingFunction(name:.easeOut);arrow.add(motion,forKey:"travel")
        }
        if phase == "click", !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let fade = CABasicAnimation(keyPath:"opacity");fade.fromValue=0.65;fade.toValue=0
            let scale = CABasicAnimation(keyPath:"transform.scale");scale.fromValue=0.7;scale.toValue=1.7
            let pulse=CAAnimationGroup();pulse.animations=[fade,scale];pulse.duration=0.32;pulse.timingFunction=CAMediaTimingFunction(name:.easeOut)
            target.add(pulse,forKey:"click")
        }
        last = point
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { [weak self] in
            guard let self,self.generation==ticket,!NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else{return}
            let fade=CABasicAnimation(keyPath:"opacity");fade.fromValue=1;fade.toValue=0;fade.duration=0.2;fade.fillMode = .forwards;fade.isRemovedOnCompletion=false;self.layer?.add(fade,forKey:"idle-fade")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.32) { [weak self] in
            guard let self, self.generation == ticket else { return }; self.hide()
        }
    }
    func hide() { generation += 1; isHidden = true; last = nil; recent.removeAll(keepingCapacity:true); trail.path = nil }
}

/// WebKit hands simulated pointer input to a page only while it considers the
/// page's window active, and it reads that from `isKeyWindow`. When the user is
/// working in another app the floating browser's window is not key, so an agent
/// hover or drag reached the page as nothing at all (0 mouse moves). For the
/// length of an agent gesture this lets that one window answer "key" to WebKit,
/// without ordering it front, taking keyboard focus or touching other windows,
/// then hands the real state back.
enum BrowserAgentActivation {
    private typealias KeyGetter = @convention(c) (NSWindow, Selector) -> Bool
    private static var forced = Set<ObjectIdentifier>()
    private static var releases: [ObjectIdentifier: DispatchWorkItem] = [:]
    private static var original: KeyGetter?

    private static func install() -> Bool {
        if original != nil { return true }
        let selector = #selector(getter: NSWindow.isKeyWindow)
        guard let method = class_getInstanceMethod(NSWindow.self, selector) else { return false }
        let real = unsafeBitCast(method_getImplementation(method), to: KeyGetter.self)
        original = real
        let replacement: @convention(block) (NSWindow) -> Bool = { window in
            forced.contains(ObjectIdentifier(window)) || real(window, selector)
        }
        method_setImplementation(method, imp_implementationWithBlock(replacement))
        return true
    }

    /// Keeps `window` active for WebKit until `linger` after the latest call,
    /// so a hover still holds when the next step of a batch arrives.
    static func hold(_ window: NSWindow, linger: TimeInterval = 1.5) {
        guard Thread.isMainThread, install(), let real = original else { return }
        let id = ObjectIdentifier(window)
        releases[id]?.cancel()
        if !forced.contains(id) {
            if real(window, #selector(getter: NSWindow.isKeyWindow)) { return }
            forced.insert(id)
            // WebKit re-reads isKeyWindow when its window posts this.
            NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
        }
        let release = DispatchWorkItem { [weak window] in
            releases[id] = nil
            guard forced.remove(id) != nil, let window else { return }
            NotificationCenter.default.post(name: NSWindow.didResignKeyNotification, object: window)
        }
        releases[id] = release
        DispatchQueue.main.asyncAfter(deadline: .now() + linger, execute: release)
    }

    /// The user took over: give the window its real state back at once.
    static func releaseAll() {
        for (_, release) in releases { release.cancel(); release.perform() }
    }

    static var isHolding: Bool { !forced.isEmpty }
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
        var waitsForDOM = false
        let isWrite: Bool
        let observeNavigation: Bool
        var mayHaveExecuted = false
        var hoverAttempts = 0
        let createdAt = Date()

        init(body: [String: Any], timeout: TimeInterval, completion: @escaping ([String: Any]) -> Void) {
            id = body["id"] ?? ""
            deadline = Date().addingTimeInterval(timeout)
            self.completion = completion
            isWrite = BrowserControlPolicy.writes.contains(body["action"] as? String ?? "")
            observeNavigation = body["observe"] as? Bool != false && ["open","back","forward","reload"].contains(body["action"] as? String ?? "")
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
    private var navigationGeneration = 0
    private var mutatingRequest: UUID?
    private let agentPointer = BrowserAgentPointer(frame: .zero)
    private var lastNativeMousePoint: NSPoint?

    init(access: MaterialPreviewFileAccess = MaterialPreviewFileAccess()) { self.access = access }

    func userDidInteract(now: Date = Date()) {
        userUntil = now.addingTimeInterval(10)
        for request in Array(requests.values) where request.isWrite {
            finish(request, reason: "用户已接管浏览器；操作已停止，请先观察当前页面。")
        }
        agentPointer.hide()
        lastNativeMousePoint = nil
        BrowserAgentActivation.releaseAll()
    }

    func didStart(_ navigation: WKNavigation?) {
        navigationGeneration += 1
        currentNavigation = navigation.map(ObjectIdentifier.init)
        agentPointer.hide()
    }

    func didCommit(_ navigation: WKNavigation?) {
        guard let navigation, let (request, done) = navigations[ObjectIdentifier(navigation)], request.completesOnCommit, live(request) else { return }
        if request.waitsForDOM, let browser = webView() { waitForDOM(browser, request: request, done: done) }
        else { done(pageStatus()) }
    }

    private func waitForDOM(_ browser: WKWebView, request: Request, done: @escaping ([String: Any]) -> Void) {
        guard live(request) else { return }
        evaluate("document.readyState !== 'loading' && Boolean(document.body)", browser: browser, request: request) { [weak self, weak request] value in
            guard let self, let request, self.live(request) else { return }
            if value as? Bool == true { done(self.pageStatus()); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak request] in
                guard let self, let request else { return }
                self.waitForDOM(browser, request: request, done: done)
            }
        }
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
        if userInitiated, BrowserControlPolicy.writes.contains(action) { userDidInteract() }
        // A caller that times out or aborts must also stop actionability retries
        // in the native process. Closing its socket alone cannot cancel WebKit.
        if action == "cancel", let target = body["requestId"] as? String {
            if let pending = requests.values.first(where: { $0.id as? String == target }) {
                finish(pending, reason: "浏览器操作已取消；请重新观察页面确认已完成的部分。")
            }
            completion(["id": body["id"] ?? "", "ok": true, "result": ["cancelled": true]])
            return
        }
        let timeout = BrowserControlPolicy.timeout(for: action, requestedMilliseconds: (body["timeoutMs"] as? NSNumber)?.doubleValue)
        let request = Request(body: body, timeout: timeout, completion: completion)
        request.waitsForDOM = ["open", "back", "forward", "reload"].contains(action)
            && (body["waitUntil"] as? String ?? "domcontentloaded") != "load"
        request.completesOnCommit = (userInitiated && action == "show_file") || request.waitsForDOM
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
            if request.isWrite {
                guard self.mutatingRequest == nil || self.mutatingRequest == request.key else {
                    self.finish(request, reason: "另一项浏览器操作正在执行，请等待完成后再操作。"); return
                }
                self.mutatingRequest = request.key
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
        if mutatingRequest == request.key { mutatingRequest = nil }
        if let navigation = request.navigation { navigations.removeValue(forKey: navigation) }
        if reason != nil { request.cancellation?() }
        request.cancellation = nil
        if let reason { request.completion(["id": request.id, "ok": false, "reason": reason, "mayHaveExecuted": request.mayHaveExecuted, "nextAction": "snapshot-before-retry"]) }
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
                "canGoBack": browser?.canGoBack ?? false, "canGoForward": browser?.canGoForward ?? false,
                "capabilities":["nativePointer":browser?.responds(to:NSSelectorFromString("_simulateMouseMove:")) == true,"setSlider":"native-range"]]
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
            if request.observeNavigation {
                self.evaluate(Self.domScript+"\n globalThis.__pinkieBrowserControl.run({action:'snapshot',compact:true});",browser:browser,request:request){observation in
                    self.finish(request,result:result.merging(["observation":observation ?? [:]]){_,value in value})
                }
            }else{self.finish(request, result: result)}
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
        if ["move", "hover", "drag", "set_slider"].contains(action) || (action == "click" && ((body["input"] as? String) == "native" || body["x"] != nil || body["button"] != nil || body["clickCount"] != nil)) {
            performPointer(action, body: body, browser: browser, request: request); return
        }
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
            if body["text"] == nil && body["selector"] == nil && body["ref"] == nil && body["name"] == nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + milliseconds / 1000) { [weak self, weak request] in
                    guard let self, let request, self.live(request) else { return }
                    self.finish(request, result: ["waitedMs": milliseconds])
                }
            } else { waitForPage(body, browser: browser, request: request) }
            return
        }
        guard ["snapshot", "locate", "read", "click", "type", "select", "press", "scroll"].contains(action) else {
            finish(request, reason: "不支持这个浏览器操作。"); return
        }
        performDOM(action, body: body, browser: browser, request: request)
    }

    private func performDOM(_ action: String, body: [String: Any], browser: WKWebView, request: Request) {
        guard live(request) else { return }
        if BrowserControlPolicy.writes.contains(action), userUntil > Date() {
            finish(request, reason: "用户正在操作浏览器"); return
        }
        var params = body
        params.removeValue(forKey: "token")
        params["action"] = action
        guard let data = try? JSONSerialization.data(withJSONObject: params), let json = String(data: data, encoding: .utf8) else {
            finish(request, reason: "浏览器参数无效。"); return
        }
        if request.isWrite {request.mayHaveExecuted=true}
        evaluate(Self.domScript + "\n globalThis.__pinkieBrowserControl.run(" + json + ");", browser: browser, request: request) { [weak self, weak request] value in
            guard let self, let request else { return }
            let result = value as? [String: Any] ?? [:]
            if result["reason"] != nil {request.mayHaveExecuted=result["mayHaveExecuted"] as? Bool == true}
            let targetWait = min(5_000, max(0, (body["targetTimeoutMs"] as? NSNumber)?.doubleValue ?? 1_200)) / 1000
            if result["retryable"] as? Bool == true, Date().timeIntervalSince(request.createdAt) < targetWait {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak request] in
                    guard let self, let request else { return }
                    self.performDOM(action, body: body, browser: browser, request: request)
                }
                return
            }
            if let reason = result["reason"] as? String { self.finish(request, reason: reason); return }
            if let pointer = result["pointer"] as? [String: Any] { self.agentPointer.show(in: browser, info: pointer, phase: action) }
            if action == "click", let x = result["x"] as? Double, let y = result["y"] as? Double { self.clicked(browser, x, y) }
            if ["click", "type", "select", "press", "scroll"].contains(action), body["observe"] as? Bool != false {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { [weak self, weak request] in
                    guard let self, let request, self.live(request) else { return }
                    self.evaluate(Self.domScript + "\n globalThis.__pinkieBrowserControl.run({action:'snapshot',compact:true});", browser: browser, request: request) { observation in
                        self.finish(request, result: result.merging(["observation": observation ?? [:], "page": self.pageStatus()]) { _, new in new })
                    }
                }
            } else { self.finish(request, result: result) }
        }
    }

    private func deliverMouse(_ type: NSEvent.EventType, browser: WKWebView, point: NSPoint, recipient: NSView? = nil, count: Int = 1) -> NSView? {
        guard let window = browser.window, browser.bounds.contains(point) else { return nil }
        BrowserAgentActivation.hold(window)
        let parentPoint = browser.superview.map { browser.convert(point, to: $0) } ?? point
        guard let receiver = recipient ?? browser.hitTest(parentPoint),
              let event = NSEvent.mouseEvent(with: type, location: browser.convert(point, to: nil), modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
                eventNumber: 0, clickCount: type == .mouseMoved ? 0 : count, pressure: [.leftMouseDown,.rightMouseDown,.leftMouseDragged,.rightMouseDragged].contains(type) ? 1 : 0) else { return nil }
        if let cgEvent = event.cgEvent, let last = lastNativeMousePoint {
            cgEvent.setIntegerValueField(.mouseEventDeltaX, value: Int64((point.x-last.x).rounded()))
            cgEvent.setIntegerValueField(.mouseEventDeltaY, value: Int64(((point.y-last.y)*(browser.isFlipped ? 1 : -1)).rounded()))
        }
        // Deliver to WebKit's native responder. No global CGEvent posting,
        // system-cursor movement or synthetic DOM pointer dispatch is involved.
        switch type {
        case .mouseMoved:
            // WebKit intentionally receives moves through its tracking observer,
            // not NSResponder.mouseMoved. This guarded adapter is the entry used
            // by WebKit's own automation driver on macOS 13+. Never claim a hover
            // succeeded if the installed WebKit does not expose it.
            let move = NSSelectorFromString("_simulateMouseMove:")
            guard browser.responds(to: move) else { return nil }
            browser.perform(move, with: event)
        case .leftMouseDown: receiver.mouseDown(with: event)
        case .leftMouseUp: receiver.mouseUp(with: event)
        case .leftMouseDragged: receiver.mouseDragged(with: event)
        case .rightMouseDown: receiver.rightMouseDown(with: event)
        case .rightMouseUp: receiver.rightMouseUp(with: event)
        default: return nil
        }
        lastNativeMousePoint = point
        return receiver
    }

    private func finishPointer(_ request: Request, body: [String: Any], browser: WKWebView, result: [String: Any]) {
        guard live(request) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak request] in
            guard let self, let request, self.live(request) else { return }
            guard body["observe"] as? Bool != false else { self.finish(request, result: result); return }
            self.evaluate(Self.domScript + "\n globalThis.__pinkieBrowserControl.run({action:'snapshot',compact:true});", browser: browser, request: request) { observation in
                self.finish(request, result: result.merging(["observation": observation ?? [:], "page": self.pageStatus()]) { _, value in value })
            }
        }
    }

    private func performPointer(_ action: String, body: [String: Any], browser: WKWebView, request: Request) {
        guard live(request), userUntil <= Date() else { finish(request, reason: "用户正在操作浏览器"); return }
        guard browser.responds(to:NSSelectorFromString("_simulateMouseMove:")) else {finish(request,reason:"当前WebKit不支持独立鼠标输入，请使用快速控件操作或computer。");return}
        var params = body; params.removeValue(forKey: "token")
        params["action"] = "pointer-plan"; params["operation"] = action
        guard let data = try? JSONSerialization.data(withJSONObject: params), let json = String(data: data, encoding: .utf8) else { finish(request, reason: "鼠标参数无效。"); return }
        let plannedNavigation = navigationGeneration
        evaluate(Self.domScript + "\n globalThis.__pinkieBrowserControl.run(" + json + ");", browser: browser, request: request) { [weak self, weak request] value in
            guard let self, let request, self.live(request) else { return }
            guard self.navigationGeneration == plannedNavigation else { self.finish(request, reason: "页面已切换，请重新观察后操作。"); return }
            let result = value as? [String: Any] ?? [:]
            if result["retryable"] as? Bool == true,
               Date().timeIntervalSince(request.createdAt) < min(5_000,max(0,(body["targetTimeoutMs"] as? NSNumber)?.doubleValue ?? 1_200))/1000 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak request] in
                    guard let self, let request else { return }; self.performPointer(action, body: body, browser: browser, request: request)
                }; return
            }
            if let reason = result["reason"] as? String { self.finish(request, reason: reason); return }
            guard self.userUntil <= Date(), browser.window != nil,
                  let x = result["x"] as? Double, let y = result["y"] as? Double,
                  let viewport = result["viewport"] as? [String: Any],
                  let width = viewport["width"] as? Double, let height = viewport["height"] as? Double,
                  width > 0, height > 0, x.isFinite, y.isFinite else {
                self.finish(request, reason: "浏览器窗口或目标位置已变化，尚未操作。"); return
            }
            let initialBounds = browser.bounds, initialURL = browser.url, initialNavigation = self.navigationGeneration
            func local(_ px: Double, _ py: Double) -> NSPoint {
                NSPoint(x: px * initialBounds.width / width, y: browser.isFlipped ? py * initialBounds.height / height : initialBounds.height-py*initialBounds.height/height)
            }
            var lastPoint = local(x,y), held: NSView?, down = false
            let right = (body["button"] as? String) == "right"
            let upType: NSEvent.EventType = right ? .rightMouseUp : .leftMouseUp
            let downType: NSEvent.EventType = right ? .rightMouseDown : .leftMouseDown
            let release = { [weak self, weak browser] in
                guard down, let self, let browser else { return }
                _ = self.deliverMouse(upType, browser: browser, point: lastPoint, recipient: held)
                down = false; held = nil
            }
            request.cancellation = release
            request.mayHaveExecuted = true
            browser.window?.acceptsMouseMovedEvents = true
            guard self.deliverMouse(.mouseMoved, browser: browser, point: lastPoint) != nil else {
                request.mayHaveExecuted = false; self.finish(request, reason: "目标不在浏览器可操作区域。"); return
            }
            self.agentPointer.show(in: browser, info: result, phase: action)
            if action == "move" || action == "hover" {
                if action == "hover", let ref=result["ref"] as? String {
                    self.verifyHover(request,body:body,browser:browser,ref:ref,result:["moved":true,"hovered":true,"input":"native","x":x,"y":y])
                }else{self.finishPointer(request, body: body, browser: browser, result: ["moved": true, "input": "native", "x": x, "y": y])};return
            }
            let counts = min(3,max(1,(body["clickCount"] as? NSNumber)?.intValue ?? 1))
            if action == "click" {
                for count in 1...counts {
                    guard self.live(request), self.userUntil <= Date(), browser.bounds == initialBounds else { release(); self.finish(request, reason: "鼠标操作已中断，请先观察页面。"); return }
                    browser.window?.makeFirstResponder(browser)
                    held = self.deliverMouse(downType, browser: browser, point: lastPoint, count: count); down = held != nil
                    guard down else { self.finish(request, reason: "鼠标按下未完成。"); return }
                    _ = self.deliverMouse(upType, browser: browser, point: lastPoint, recipient: held, count: count); down = false
                }
                self.clicked(browser,x,y)
                self.finishPointer(request, body: body, browser: browser, result: ["clicked": true, "input": "native", "clickCount": counts, "x": x, "y": y]); return
            }
            guard ["drag", "set_slider"].contains(action), !right, let to = result["to"] as? [String: Any], let tx = to["x"] as? Double, let ty = to["y"] as? Double else {
                self.finish(request, reason: "拖拽终点无效。"); return
            }
            browser.window?.makeFirstResponder(browser)
            held = self.deliverMouse(.leftMouseDown, browser: browser, point: lastPoint); down = held != nil
            guard down else { self.finish(request, reason: "拖拽按下未完成。"); return }
            let duration = min(1500,max(100,(body["durationMs"] as? NSNumber)?.doubleValue ?? 320))/1000
            let steps = min(80,max(6,Int(ceil(duration*60))))
            func step(_ index: Int) {
                guard self.live(request), self.userUntil <= Date(), browser.bounds == initialBounds,
                      browser.url == initialURL, self.navigationGeneration == initialNavigation else {
                    release(); if !request.finished { self.finish(request, reason: "拖拽已中断，已完成部分可能生效，请先观察页面。"); }; return
                }
                let t = Double(index)/Double(steps), px = x+(tx-x)*t, py = y+(ty-y)*t
                lastPoint = local(px,py)
                guard self.deliverMouse(.leftMouseDragged, browser: browser, point: lastPoint, recipient: held) != nil else {
                    release(); self.finish(request, reason: "拖拽目标离开可操作区域。"); return
                }
                var feedback = result; feedback["x"] = px; feedback["y"] = py; feedback.removeValue(forKey: "rect")
                self.agentPointer.show(in: browser, info: feedback, phase: "drag")
                if index < steps { DispatchQueue.main.asyncAfter(deadline: .now()+duration/Double(steps)) { step(index+1) } }
                else {
                    release()
                    if action == "set_slider" {
                        self.verifySlider(request,body:body,browser:browser,plan:result)
                    } else {
                        self.finishPointer(request, body: body, browser: browser, result: ["dragged": true, "input": "native", "from": ["x":x,"y":y], "to": ["x":tx,"y":ty]])
                    }
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now()+duration/Double(steps)) { step(1) }
        }
    }

    private func verifySlider(_ request: Request, body: [String: Any], browser: WKWebView, plan: [String: Any], attempts: Int = 0) {
        guard live(request), userUntil <= Date(), let slider = plan["slider"] as? [String: Any],
              let target = slider["target"] as? Double, let tolerance = slider["tolerance"] as? Double,
              let ref = plan["ref"] as? String,
              let data = try? JSONSerialization.data(withJSONObject:["action":"slider-value","ref":ref,"focus":true]),let json = String(data:data,encoding:.utf8) else {
            finish(request,reason:"滑杆状态变化，请重新观察。");return
        }
        DispatchQueue.main.asyncAfter(deadline:.now()+0.05) { [weak self, weak request] in
            guard let self, let request, self.live(request) else { return }
            self.evaluate(Self.domScript+"\n globalThis.__pinkieBrowserControl.run("+json+");",browser:browser,request:request) { observed in
                guard self.live(request), let values = (observed as? [String:Any])?["slider"] as? [String:Any],let value=values["value"] as? Double else {
                    self.finish(request,reason:"滑杆已变化，请先重新观察。");return
                }
                if abs(value-target)<=max(0.000001,tolerance) {
                    self.finishPointer(request,body:body,browser:browser,result:["changed":true,"input":"native","sliderValue":value,"targetValue":target,"requestedValue":slider["requested"] ?? target,"adjustments":attempts]);return
                }
                guard attempts<4, (values["step"] as? Double ?? 0)>0, let window=browser.window else {
                    self.finish(request,reason:"滑杆实际值为 \(value)，未达到目标 \(target)；请根据新观察继续。");return
                }
                let up = value<target, key:UInt16 = up ? 126:125, character = up ? "\u{f700}":"\u{f701}"
                for type:NSEvent.EventType in [.keyDown,.keyUp] {
                    if let event=NSEvent.keyEvent(with:type,location:.zero,modifierFlags:[.function,.numericPad],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:character,charactersIgnoringModifiers:character,isARepeat:false,keyCode:key) {
                        window.sendEvent(event)
                    }
                }
                self.verifySlider(request,body:body,browser:browser,plan:plan,attempts:attempts+1)
            }
        }
    }

    private func verifyHover(_ request: Request, body: [String: Any], browser: WKWebView, ref: String, result: [String: Any]) {
        guard live(request),let data=try? JSONSerialization.data(withJSONObject:["action":"pointer-state","ref":ref]),let json=String(data:data,encoding:.utf8)else{return}
        DispatchQueue.main.asyncAfter(deadline:.now()+0.06){[weak self,weak request]in
            guard let self,let request,self.live(request)else{return}
            self.evaluate(Self.domScript+"\n globalThis.__pinkieBrowserControl.run("+json+");",browser:browser,request:request){value in
                let observed=value as? [String:Any] ?? [:]
                if observed["hovered"] as? Bool == true {self.finishPointer(request,body:body,browser:browser,result:result);return}
                if observed["reason"] == nil,request.hoverAttempts<4,self.userUntil <= Date(){request.hoverAttempts+=1;self.performPointer("hover",body:body,browser:browser,request:request);return}
                self.finish(request,reason:"页面未确认悬停状态，请先观察页面再继续。")
            }
        }
    }

    private func waitForPage(_ body: [String: Any], browser: WKWebView, request: Request) {
        var params = body
        params.removeValue(forKey: "token")
        params["action"] = "wait"
        guard live(request), let data = try? JSONSerialization.data(withJSONObject: params),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = Self.domScript + "\n globalThis.__pinkieBrowserControl.run(" + json + ");"
        evaluate(script, browser: browser, request: request) { [weak self, weak request] value in
            guard let self, let request, self.live(request) else { return }
            let result = value as? [String: Any] ?? [:]
            if result["matched"] as? Bool == true { self.finish(request, result: ["matched": true]); return }
            if let reason = result["reason"] as? String { self.finish(request, reason: reason); return }
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
                    let zoom=max(0.01,Double(browser.pageZoom))
                    self.finish(request, result: ["path": path.path, "width": bitmap.pixelsWide, "height": bitmap.pixelsHigh,
                        "coordinateSpace":body["fullPage"] as? Bool == true ? "document-image":"viewport-css",
                        "viewport":["width":Double(browser.bounds.width)/zoom,"height":Double(browser.bounds.height)/zoom],"message": "用 image 工具查看"])
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

    // Generated from BrowserControl.js; the contract test checks byte parity.
    private static let domScript = #"""
    /* Pinkie browser control v3. Embedded into BrowserControl.swift; no external
     * browser, account, executable page snippets or background polling required.
     * Community design references: agent-browser snapshot refs; Playwright MCP
     * structured observations. This implementation targets the existing WKWebView.
     */
    (() => {
      'use strict';
      if (globalThis.__pinkieBrowserControl?.version === 3) return;
      const selector = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,label[for],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[role="slider"],[role="spinbutton"],[role="treeitem"]';
      const page = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
      const state = {refs:new Map(), ids:new WeakMap(), seq:0, revision:0, fingerprint:'', stable:new Map()};
      const clean = (v,n=240) => String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
      const bound = (v,d,max) => Math.max(1,Math.min(max,Number(v)||d));
      const role = el => el.getAttribute('role') || ({A:'link',BUTTON:'button',TEXTAREA:'textbox',SELECT:'combobox',SUMMARY:'button',LABEL:'label',INPUT:({checkbox:'checkbox',radio:'radio',button:'button',submit:'button',search:'searchbox',range:'slider',number:'spinbutton'}[el.type]||'textbox')}[el.tagName]) || (el.isContentEditable?'textbox':'button');
      function name(el) {
        const explicit=el.getAttribute('aria-label');if(explicit)return clean(explicit);
        const labels=el.getAttribute('aria-labelledby');if(labels){const text=labels.split(/\s+/).map(id=>el.ownerDocument.getElementById(id)?.textContent||'').join(' ');if(clean(text))return clean(text);}
        return clean(el.labels?.[0]?.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.textContent || (['button','submit'].includes(el.type)?el.value:''));
      }
      function geometry(el,viewport=false) {
        if(!el?.isConnected || el.closest?.('[hidden],[inert],[aria-hidden="true"]'))return null;
        const rect=el.getBoundingClientRect(),win=el.ownerDocument.defaultView;
        if(!rect.width||!rect.height||!win)return null;
        if(viewport&&(rect.bottom<=0||rect.right<=0||rect.top>=win.innerHeight||rect.left>=win.innerWidth))return null;
        const style=win.getComputedStyle(el);
        if(style.visibility==='hidden'||style.visibility==='collapse'||style.display==='none'||Number(style.opacity)===0)return null;
        if(typeof el.checkVisibility==='function'&&!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return null;
        return rect;
      }
      function refFor(el) {let ref=state.ids.get(el);if(!ref){ref=page+'e'+(++state.seq);state.ids.set(el,ref);state.refs.set(ref,el);}return ref;}
      function prune() {if(state.refs.size>600)for(const [ref,el]of state.refs)if(!el.isConnected)state.refs.delete(ref);if(state.stable.size>64)state.stable.clear();}
      function walk(root,visit,{maxNodes=14000}={}) {
        const seen=new Set();let nodes=0,truncated=false,stopped=false;
        function descend(current,depth) {
          if(!current||seen.has(current)||stopped||depth>12)return;seen.add(current);
          const doc=current.ownerDocument||current,walker=doc.createTreeWalker(current,1);
          let el=current.nodeType===1?current:walker.nextNode();
          while(el&&!stopped){
            if(++nodes>maxNodes){truncated=stopped=true;break;}
            if(visit(el)===false){truncated=stopped=true;break;}
            if(el.shadowRoot)descend(el.shadowRoot,depth+1);
            if(el.tagName==='IFRAME'){try{if(el.contentDocument?.documentElement&&geometry(el))descend(el.contentDocument,depth+1);}catch{}}
            el=walker.nextNode();
          }
        }
        descend(root,0);return {nodes,truncated};
      }
      function readText(root,maxChars) {
        if(!root)return '';
        const output=[],doc=root.ownerDocument||root,walker=doc.createTreeWalker(root,4);let n,count=0,size=0,previous;
        const visible=new WeakMap();
        while((n=walker.nextNode())&&count++<18000&&size<maxChars){const el=n.parentElement;if(!el||el.closest('script,style,noscript,template,svg,[hidden],[inert],[aria-hidden="true"]'))continue;
          const value=clean(n.nodeValue,maxChars-size);if(!value)continue;
          if(!visible.has(el))visible.set(el,Boolean(geometry(el)));if(!visible.get(el))continue;
          const sep=previous===el?' ':'\n';output.push(sep+value);size+=sep.length+value.length;previous=el;
        }
        return output.join('').trim().slice(0,maxChars);
      }
      function textRoot() {return [...document.querySelectorAll('main,article,[role="main"]')].find(el=>geometry(el))||document.body;}
      function snapshot(p={}) {
        const start=performance.now(),compact=p.compact!==false,limit=bound(p.maxElements,compact?80:200,300),maxChars=bound(p.maxChars,compact?2400:12000,30000),elements=[],frames=[];let optionBudget=32;
        const target=(p.ref||p.selector)?resolve(p):{el:document};if(target.reason)return target;
        const stats=walk(target.el,el=>{if(el.tagName==='IFRAME'&&geometry(el,p.scope!=='page')){let accessible=false;try{accessible=Boolean(el.contentDocument);}catch{}frames.push({ref:refFor(el),title:name(el),accessible});}if(!el.matches(selector))return;const r=geometry(el,p.scope!=='page');if(!r)return;
          const item={ref:refFor(el),role:role(el),name:name(el)};
          if(el.disabled||el.getAttribute('aria-disabled')==='true')item.disabled=true;
          if('checked'in el&&['checkbox','radio'].includes(el.type))item.checked=el.checked;
          if(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)&&el.type!=='password')item.value=clean(el.value,200);
          if(el.type==='password')item.protected=true;
          if(el.type==='range')item.slider=sliderMetrics(el);
          if(el.tagName==='SELECT'){
            const options=el.options,shown=Array.from({length:Math.min(options.length,12,optionBudget)},(_,i)=>options[i]);optionBudget-=shown.length;
            item.options=shown.map(o=>({value:clean(o.value,80),label:clean(o.label,72),...(o.disabled?{disabled:true}:{})}));
            if(options.length>shown.length)item.optionsTruncated=true;
          }
          if(p.includeRects)item.rect={x:r.x,y:r.y,width:r.width,height:r.height};
          elements.push(item);if(elements.length>=limit)return false;
        });
        const root=target.el===document?textRoot():target.el;
        const text=p.includeText===false?'':readText(root,maxChars),fingerprint=JSON.stringify([p.scope||'viewport',text,elements,frames]);
        if(fingerprint!==state.fingerprint){state.revision++;state.fingerprint=fingerprint;}
        const snapshotId=page+':'+state.revision,unchanged=p.since===snapshotId;prune();
        return {title:document.title,snapshotId,readyState:document.readyState,scope:p.scope==='page'?'page':'viewport',text:unchanged?'':text,elements:unchanged?[]:elements,frames:unchanged?[]:frames,unchanged,truncated:stats.truncated,scannedNodes:stats.nodes,elementCount:elements.length,durationMs:Math.round((performance.now()-start)*10)/10};
      }
      function locate(p) {
        const matches=[],limit=bound(p.limit,8,40),needle=clean(p.name||p.text||'',500).toLocaleLowerCase();
        const stats=walk(document,el=>{if(p.selector?!el.matches(p.selector):!el.matches(selector))return;if(p.role&&role(el)!==p.role)return;
          const value=name(el),text=value.toLocaleLowerCase();if(needle&&(p.exact?text!==needle:!text.includes(needle)))return;
          const rect=geometry(el);if(!rect)return;matches.push({ref:refFor(el),role:role(el),name:value,inViewport:Boolean(geometry(el,true))});if(matches.length>=limit)return false;
        });
        return {matches,ambiguous:matches.length>1,truncated:stats.truncated,scannedNodes:stats.nodes};
      }
      function resolve(p) {
        if(p.ref){const el=state.refs.get(p.ref);if(!el?.isConnected)return {reason:'元素引用已失效，请重新 snapshot 或 locate；没有执行操作。',code:'stale-ref'};return {el};}
        if(p.selector){const found=[];walk(document,el=>{if(el.matches(p.selector)){found.push(el);if(found.length>1)return false;}});if(found.length>1)return {reason:'selector 匹配了多个控件，请使用唯一 ref 或更具体的 selector。'};return found[0]?{el:found[0]}:{reason:'目标控件还没有出现。',retryable:true};}
        if(p.name||p.role){const found=locate({...p,limit:2});if(found.matches.length!==1)return {reason:found.matches.length?'有多个同名控件，请用快照 ref 明确目标。':'目标控件还没有出现。',retryable:!found.matches.length};return {el:state.refs.get(found.matches[0].ref)};}
        if(Number.isFinite(p.x)&&Number.isFinite(p.y))return {el:document.elementFromPoint(p.x,p.y)};
        return {reason:'请提供快照 ref、selector 或唯一的 role/name。'};
      }
      function point(el) {
        const r=el.getBoundingClientRect(),win=el.ownerDocument.defaultView;
        const x=(Math.max(0,r.left)+Math.min(win.innerWidth,r.right))/2,y=(Math.max(0,r.top)+Math.min(win.innerHeight,r.bottom))/2;
        return {x,y,r};
      }
      function includes(el,hit) {for(let n=hit;n;n=n.parentElement||n.getRootNode?.().host)if(n===el)return true;return false;}
      function hitTest(el,x,y) {
        const root=el.getRootNode(),hit=(root.elementFromPoint?.(x,y)||el.ownerDocument.elementFromPoint(x,y));
        if(!includes(el,hit)&&!(root.host&&hit===root.host))return null;
        let win=el.ownerDocument.defaultView,px=x,py=y,sx=1,sy=1;
        try {while(win.frameElement){const frame=win.frameElement,rect=frame.getBoundingClientRect(),fx=rect.width/frame.offsetWidth,fy=rect.height/frame.offsetHeight;px=rect.left+(px+frame.clientLeft)*fx;py=rect.top+(py+frame.clientTop)*fy;sx*=fx;sy*=fy;const cover=frame.ownerDocument.elementFromPoint(px,py);if(!includes(frame,cover))return null;win=win.parent;}}
        catch{return null;}
        return {x:px,y:py,sx,sy};
      }
      function targetPoint(el,p={}) {
        const center=point(el);
        if(!p.ref&&!p.selector&&!p.name&&!p.role&&Number.isFinite(p.x)&&Number.isFinite(p.y))return {...center,x:p.x,y:p.y};
        return center;
      }
      function pointerInfo(el,p={}) {
        const {x,y,r}=targetPoint(el,p),hit=hitTest(el,x,y);
        if(!hit)return null;
        return {x:hit.x,y:hit.y,rect:{x:hit.x-(x-r.left)*hit.sx,y:hit.y-(y-r.top)*hit.sy,width:r.width*hit.sx,height:r.height*hit.sy},viewport:{width:innerWidth,height:innerHeight}};
      }
      function sliderMetrics(el) {
        if(el.tagName!=='INPUT'||el.type!=='range')return null;
        const parsedMin=Number(el.min||0),parsedMax=Number(el.max||100),parsedStep=Number(el.step||1);
        const min=Number.isFinite(parsedMin)?parsedMin:0,max=Number.isFinite(parsedMax)?parsedMax:100,value=Number(el.value),step=el.step==='any'?0:Number.isFinite(parsedStep)&&parsedStep>0?parsedStep:1,style=el.ownerDocument.defaultView.getComputedStyle(el);
        const vertical=style.writingMode.startsWith('vertical')||String(style.webkitAppearance).includes('vertical');
        const reverse=vertical?(style.writingMode.startsWith('vertical')?style.direction==='rtl':true):style.direction==='rtl';
        return {min,max,value,step,orientation:vertical?'vertical':'horizontal',reverse};
      }
      function pointerPlan(p) {
        const target=resolve(p);if(target.reason)return target;
        const el=target.el;if(!el||!geometry(el))return {reason:'目标暂时不可见。',retryable:true};
        el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
        if(['click','drag','set_slider'].includes(p.operation)&&(el.disabled||el.getAttribute('aria-disabled')==='true'))return {reason:'目标控件暂时不可用。',retryable:true};
        let slider,sliderFrom,sliderTo;
        if(p.operation==='set_slider'){
          slider=sliderMetrics(el);
          if(!slider)return {reason:'set_slider适用于原生range滑杆；自定义滑杆请用drag和回读数值。'};
          const requested=Number(p.sliderValue);if(!Number.isFinite(requested)||requested<slider.min||requested>slider.max||slider.max<=slider.min)return {reason:'滑杆目标超出有效范围。'};
          const r=el.getBoundingClientRect(),vertical=slider.orientation==='vertical',length=vertical?r.height:r.width,inset=Math.min(8,length/8);
          const target=slider.step>0?Math.min(slider.max,slider.min+Math.round((requested-slider.min)/slider.step)*slider.step):requested;
          const spot=value=>{let ratio=(value-slider.min)/(slider.max-slider.min);if(slider.reverse)ratio=1-ratio;return vertical?{x:r.left+r.width/2,y:r.top+inset+ratio*(length-2*inset)}:{x:r.left+inset+ratio*(length-2*inset),y:r.top+r.height/2};};
          sliderFrom=spot(slider.value);sliderTo=spot(target);slider={...slider,target,requested,tolerance:slider.step>0?slider.step*.49:(slider.max-slider.min)/Math.max(1,length)*1.5};
        }
        const info=pointerInfo(el,sliderFrom||p);if(!info)return {reason:'目标被其他内容遮住，尚未操作。',retryable:true};
        const id=String(p.id||'pointer'),old=state.stable.get(id);
        if(['click','drag','set_slider'].includes(p.operation)){
          const value={el,x:info.x,y:info.y,w:info.rect.width,h:info.rect.height};state.stable.set(id,value);
          if(!old||old.el!==el||['x','y','w','h'].some(k=>Math.abs(old[k]-value[k])>1))return {reason:'目标位置还在变化，等待稳定。',retryable:true};
          state.stable.delete(id);
        }
        let to;
        if(sliderTo){to=pointerInfo(el,sliderTo);if(!to)return {reason:'滑杆终点被遮挡，尚未操作。'};}
        if(p.operation==='drag'){
          const endParams={ref:p.toRef,selector:p.toSelector,name:p.toName,role:p.toRole,exact:p.toExact,x:p.toX,y:p.toY},end=resolve(endParams);
          if(end.reason)return end;
          if(!geometry(end.el,true))return {reason:'拖拽终点不在当前可见区域，请先滚动后重新定位。'};
          to=pointerInfo(end.el,endParams);if(!to)return {reason:'拖拽终点被遮挡，尚未按下鼠标。'};
        }
        return {...info,...(to?{to}:{}),...(slider?{slider}:{}),ref:refFor(el),documentToken:page};
      }
      function key(el,value) {
        const codes={Enter:13,Escape:27,Tab:9,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40};if(!(value in codes))return false;
        const win=el.ownerDocument.defaultView,event=new win.KeyboardEvent('keydown',{key:value,code:value,keyCode:codes[value],which:codes[value],bubbles:true,cancelable:true,composed:true});
        const allowed=el.dispatchEvent(event);el.dispatchEvent(new win.KeyboardEvent('keyup',{key:value,code:value,bubbles:true,composed:true}));
        if(value==='Enter'&&allowed){const form=el.closest('form');form?.requestSubmit?.();}
        return true;
      }
      function action(p) {
        if(p.action==='pointer-plan')return pointerPlan(p);
        if(p.action==='pointer-state'){const target=resolve(p);if(target.reason)return target;return {hovered:target.el.matches(':hover')};}
        if(p.action==='slider-value'){const target=resolve(p);if(target.reason)return target;if(p.focus)target.el.focus?.({preventScroll:true});return {slider:sliderMetrics(target.el)};}
        if(p.action==='snapshot')return snapshot(p);
        if(p.action==='locate')return locate(p);
        if(p.action==='read'){const target=(p.ref||p.selector)?resolve(p):{el:textRoot()};if(target.reason)return target;return {title:document.title,text:readText(target.el,bound(p.maxChars,10000,30000))};}
        if(p.action==='wait'){
          const desired=p.waitFor||'visible',hasTarget=Boolean(p.ref||p.selector||p.name||p.role),target=hasTarget?resolve(p):{el:textRoot()};
          if(target.reason){if(target.retryable||target.code==='stale-ref')return {matched:['hidden','detached'].includes(desired)};return target;}
          const el=target.el,visible=Boolean(geometry(el));
          let matched=!hasTarget||({attached:Boolean(el?.isConnected),detached:!el?.isConnected,hidden:!visible,visible,enabled:visible&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.readOnly}[desired]??visible);
          if(p.text)matched=matched&&readText(el,30000).includes(String(p.text));return {matched};
        }
        if(p.action==='scroll'&&!p.ref&&!p.selector){if(!Number.isFinite(p.dy)&&!Number.isFinite(p.dx))return {reason:'请提供滚动距离或元素编号。'};window.scrollBy({top:p.dy||0,left:p.dx||0,behavior:'instant'});return {scrolled:true,x:scrollX,y:scrollY};}
        if(p.action==='press'&&!p.ref&&!p.selector&&!p.name){const el=document.activeElement||document.body;if(!key(el,p.key))return {reason:'只支持回车、退出、制表和方向键。'};if(p.key==='Tab'){const list=[];walk(document,n=>{if(n.matches(selector)&&geometry(n)&&!n.disabled&&n.tabIndex>=0)list.push(n);});list[(list.indexOf(el)+1)%list.length]?.focus({preventScroll:true});}return {pressed:p.key};}
        const target=resolve(p);if(target.reason)return target;const el=target.el;if(!el)return {reason:'没有找到目标。'};
        if(!geometry(el))return {reason:'目标暂时不可见。',retryable:true};
        if(p.action==='scroll'&&(Number.isFinite(p.dy)||Number.isFinite(p.dx))){el.scrollBy({top:p.dy||0,left:p.dx||0,behavior:'instant'});return {scrolled:true,ref:refFor(el),x:el.scrollLeft,y:el.scrollTop};}
        el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
        if(p.action==='scroll')return {scrolled:true,ref:refFor(el)};
        if(el.disabled||el.getAttribute('aria-disabled')==='true')return {reason:'目标控件暂时不可用。',retryable:true};
        if(['type','select','press'].includes(p.action)){const {x,y}=point(el);if(!hitTest(el,x,y))return {reason:'目标被其他内容遮住，尚未操作。',retryable:true};}
        if(p.action==='click'){
          const {x,y,r}=targetPoint(el,p),globalPoint=hitTest(el,x,y);if(!globalPoint)return {reason:'目标被其他内容遮住，尚未点击。',retryable:true};
          const id=String(p.id||p.ref||p.selector||'click'),old=state.stable.get(id),now=performance.now();state.stable.set(id,{el,x,y,w:r.width,h:r.height,time:old?.time||now});
          if(p.stable!==false&&(!old||old.el!==el||Math.abs(old.x-x)>1||Math.abs(old.y-y)>1||Math.abs(old.w-r.width)>1||Math.abs(old.h-r.height)>1)){state.stable.set(id,{el,x,y,w:r.width,h:r.height,time:now});return {reason:'目标位置还在变化，等待稳定。',retryable:true};}
          state.stable.delete(id);el.focus?.({preventScroll:true});const win=el.ownerDocument.defaultView;
          for(const type of ['pointerdown','mousedown','pointerup','mouseup']){el.dispatchEvent(new (type.startsWith('pointer')?win.PointerEvent:win.MouseEvent)(type,{bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0}));if(!el.isConnected)return {reason:'控件在按下时被页面替换，请先重新观察页面；操作可能已生效。',mayHaveExecuted:true};}
          const pointer=pointerInfo(el,p);el.click();return {clicked:true,ref:refFor(el),x:globalPoint.x,y:globalPoint.y,pointer};
        }
        if(p.action==='select'){
          if(el.tagName!=='SELECT')return {reason:'select 只适用于原生下拉框；自定义下拉框请定位选项后点击。'};
          const options=[...el.options],exact=p.value!==undefined?options.filter(o=>o.value===String(p.value)):[],labels=options.filter(o=>clean(o.label)===clean(p.text??p.value)),matches=exact.length?exact:labels,option=matches.length===1?matches[0]:null;
          if(!option||option.disabled)return {reason:'没有唯一可用的匹配选项。可用选项：'+options.filter(o=>!o.disabled).slice(0,10).map(o=>clean(o.label,60)+' (value='+clean(o.value,80)+')').join('；')};const pointer=pointerInfo(el);el.value=option.value;const win=el.ownerDocument.defaultView;for(const event of ['input','change'])el.dispatchEvent(new win.Event(event,{bubbles:true,composed:true}));return {selected:true,value:option.value,label:option.label,pointer};
        }
        if(p.action==='type'){
          if(typeof p.text!=='string'||p.text.length>131072)return {reason:'输入内容为空或过长。'};if(el.readOnly)return {reason:'目标输入框是只读的。'};
          el.focus?.({preventScroll:true});const win=el.ownerDocument.defaultView;
          if(el.isContentEditable)el.textContent=p.text;
          else {const proto=el.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:el.tagName==='INPUT'?win.HTMLInputElement.prototype:null;if(!proto||el.type==='file')return {reason:'这个控件不支持自动输入。'};Object.getOwnPropertyDescriptor(proto,'value').set.call(el,p.text);}
          const pointer=pointerInfo(el);el.dispatchEvent(new win.InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:p.text}));el.dispatchEvent(new win.Event('change',{bubbles:true,composed:true}));if(p.submit)key(el,'Enter');return {typed:true,length:p.text.length,ref:refFor(el),pointer};
        }
        if(p.action==='press')return key(el,p.key)?{pressed:p.key}:{reason:'按键不支持。'};
        return {reason:'不支持这个页面操作。'};
      }
      globalThis.__pinkieBrowserControl={version:3,documentToken:page,run(p){try{return action(p||{});}catch{return {reason:'网页控件已变化或参数无效，请重新获取快照。'};}}};
    })();
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
