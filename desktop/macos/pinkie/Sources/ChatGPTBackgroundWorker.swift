import AppKit
import Foundation
import WebKit

/// Lets 碧琪 / Metre use the ChatGPT account the user signed in to in the
/// built-in browser: ask it a question, or have it generate images, in the
/// background.
///
/// It owns one hidden WKWebView that shares the default website data store,
/// so the login is the same one the user sees, but it never touches the
/// visible browser panel or a collaboration chat. It keeps working while that
/// panel is closed and while the App is behind other full-screen apps.
/// Exactly one job runs at a time (the web UI handles one turn at a time).
/// The gateway starts a job, polls its status, and moves finished images into
/// the user's folder; this class only writes into its own private temp folder.
@MainActor
final class ChatGPTBackgroundWorker: NSObject, WKNavigationDelegate {
    final class Job {
        let id: String
        let kind: String
        let prompt: String
        let refs: [URL]
        let conversation: URL?
        let outputDirectory: URL
        let startedAt = Date()
        var phase = "queued"
        var detail = ""
        var error: String?
        var reply = ""
        var files: [String] = []
        var conversationUrl = ""
        var cancelled = false
        var finished: Bool { phase == "done" || phase == "failed" }

        init(id: String, kind: String, prompt: String, refs: [URL], conversation: URL?, outputDirectory: URL) {
            self.id = id; self.kind = kind; self.prompt = prompt; self.refs = refs
            self.conversation = conversation; self.outputDirectory = outputDirectory
        }

        var snapshot: [String: Any] {
            var value: [String: Any] = [
                "job": id, "kind": kind, "phase": phase, "detail": detail, "files": files,
                "elapsedMs": Int(Date().timeIntervalSince(startedAt) * 1000),
                "conversationUrl": conversationUrl,
            ]
            if finished { value["reply"] = reply }
            if let error { value["error"] = error }
            return value
        }
    }

    static let maxRefs = 6
    static let maxRefBytes = 20 * 1024 * 1024
    static let jobTimeout: TimeInterval = 10 * 60
    private static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "gif", "heic"]

    private var window: NSWindow?
    private var webView: WKWebView?
    private var jobs: [String: Job] = [:]
    private var current: Job?
    private var activity: NSObjectProtocol?
    private var navigationWaiters: [CheckedContinuation<Void, Never>] = []

    private let root: URL = {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("pinkie-gpt-web", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return base
    }()

    // MARK: Socket actions

    func handle(_ body: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        let id = body["id"] ?? ""
        let reply: ([String: Any]) -> Void = { result in completion(["id": id, "ok": true, "result": result]) }
        let fail: (String) -> Void = { reason in completion(["id": id, "ok": false, "reason": reason]) }
        switch body["action"] as? String {
        case "gpt_web_start":
            do { reply(try start(body).snapshot) } catch { fail(error.localizedDescription) }
        case "gpt_web_status":
            guard let job = jobs[body["job"] as? String ?? ""] else { fail("找不到这个网页 GPT 任务（App 可能重启过）。"); return }
            reply(job.snapshot)
        case "gpt_web_cancel":
            if let job = jobs[body["job"] as? String ?? ""], !job.finished {
                job.cancelled = true
                job.phase = "failed"; job.error = "已取消"
                if current === job { finish(job) }
            }
            reply(["cancelled": true])
        case "gpt_web_account":
            if let running = current, !running.finished { reply(["loggedIn": true, "busy": running.kind]); return }
            Task { @MainActor in
                do {
                    let web = self.ensureWebView()
                    if web.url?.host?.hasSuffix("chatgpt.com") != true { try await self.load(URL(string: "https://chatgpt.com/")!, in: web) }
                    reply(try await self.account(in: web))
                } catch { fail(error.localizedDescription) }
            }
        default:
            fail("不支持的网页 GPT 操作")
        }
    }

    private func start(_ body: [String: Any]) throws -> Job {
        if let running = current, !running.finished {
            throw Self.error("网页 GPT 正在处理上一件事（\(running.kind == "image" ? "出图" : "提问")），等它结束再发。")
        }
        let kind = body["kind"] as? String == "ask" ? "ask" : "image"
        let prompt = (body["prompt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, prompt.count <= 60_000 else { throw Self.error("内容为空或太长（最多 6 万字）。") }
        let refs = try (body["refs"] as? [String] ?? []).map(Self.validatedReference)
        guard refs.count <= Self.maxRefs else { throw Self.error("附图最多 \(Self.maxRefs) 张。") }
        var conversation: URL?
        if let raw = body["conversationUrl"] as? String, !raw.isEmpty {
            guard let url = URL(string: raw), url.scheme == "https",
                  url.host == "chatgpt.com" || url.host?.hasSuffix(".chatgpt.com") == true,
                  url.path.range(of: #"(^|/)c/[^/]+"#, options: .regularExpression) != nil else {
                throw Self.error("只能接着 chatgpt.com 上已有的对话继续。")
            }
            conversation = url
        }
        let jobId = UUID().uuidString.lowercased()
        let directory = root.appendingPathComponent(jobId, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let job = Job(id: jobId, kind: kind, prompt: prompt, refs: refs, conversation: conversation, outputDirectory: directory)
        for (key, old) in jobs where old.finished && Date().timeIntervalSince(old.startedAt) > 3600 { jobs.removeValue(forKey: key) }
        jobs[jobId] = job
        current = job
        // Keep the App from being napped while the page waits on ChatGPT,
        // even when every App window is hidden behind a full-screen app.
        if activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: "网页 GPT 后台任务")
        }
        Task { @MainActor in await self.run(job) }
        return job
    }

    private func finish(_ job: Job) {
        guard current === job else { return }
        current = nil
        if job.cancelled { webView?.stopLoading() }
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        activity = nil
    }

    static func validatedReference(_ raw: String) throws -> URL {
        guard raw.hasPrefix("/"), !raw.contains("\0") else { throw error("附图路径必须是绝对路径。") }
        let url = URL(fileURLWithPath: raw).resolvingSymlinksInPath()
        let home = FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path
        let temp = URL(fileURLWithPath: NSTemporaryDirectory()).resolvingSymlinksInPath().path
        guard url.path.hasPrefix(home + "/") || url.path.hasPrefix(temp) || url.path.hasPrefix("/Volumes/") else {
            throw error("附图必须在用户目录里：\(raw)")
        }
        guard imageExtensions.contains(url.pathExtension.lowercased()) else { throw error("附图只支持 png / jpg / webp / gif / heic：\(raw)") }
        let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values?.isRegularFile == true else { throw error("附图不存在：\(raw)") }
        guard (values?.fileSize ?? 0) <= maxRefBytes else { throw error("附图超过 20 MB：\(raw)") }
        return url
    }

    // MARK: Job

    private func run(_ job: Job) async {
        do {
            let web = ensureWebView()
            job.phase = "loading"
            try await load(job.conversation ?? URL(string: "https://chatgpt.com/")!, in: web)
            try check(job)
            guard try await waitFor(job, seconds: 45, poll: 0.8, { try await self.bool("!!P.input()", in: web) }) else {
                throw Self.error("ChatGPT 页面没有加载出输入框，请在内置浏览器里打开 chatgpt.com 看看是否正常。")
            }
            job.phase = "account"
            let account = try await account(in: web)
            guard account["loggedIn"] as? Bool == true else {
                throw Self.error("内置浏览器里的 ChatGPT 还没有登录。请先在碧琪的浏览器里打开 chatgpt.com 登录账号，再试一次。")
            }
            try check(job)
            if job.conversation == nil {
                // The home page has 聊天 / 工作 modes; only 聊天 answers directly.
                let mode = (try? await string("P.selectChat()", in: web)) ?? ""
                log(job, "chat-mode", ["mode": mode])
                if mode == "clicked" { try await Task.sleep(nanoseconds: 800_000_000) }
            }
            let baselineUsers = try await int("P.users().length", in: web)
            let baselineImages = try await strings("P.generated().map(i => P.src(i))", in: web)
            let baselineAssistants = try await int("P.assistants().length", in: web)
            if !job.refs.isEmpty {
                job.phase = "uploading"
                try await upload(job.refs, in: web, job: job)
            }
            try check(job)
            job.phase = "typing"
            try await type(job.prompt, in: web)
            job.phase = "sending"
            guard try await waitFor(job, seconds: 90, poll: 1, { try await self.bool("P.send()", in: web) }) else {
                log(job, "send-unavailable", (try? await call("return P.state();", in: web)) as? [String: Any] ?? [:])
                throw Self.error("发送按钮一直不可用（附图可能还在上传，或页面改版了）。")
            }
            let landed = try await waitFor(job, seconds: 15, poll: 0.5) { try await self.int("P.users().length", in: web) > baselineUsers }
            log(job, "sent", ["landed": landed])
            if !landed {
                // Enter as a fallback, once; never send twice if it did land.
                _ = try? await call("const e = P.input(); if (e) { e.focus(); e.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true})); }", in: web)
                guard try await waitFor(job, seconds: 10, poll: 0.5, { try await self.int("P.users().length", in: web) > baselineUsers }) else {
                    log(job, "not-landed", (try? await call("return P.state();", in: web)) as? [String: Any] ?? [:])
                    try? await Task.sleep(nanoseconds: 20_000_000_000)
                    log(job, "shape", (try? await call("return P.shape(needle);", arguments: ["needle": String(job.prompt.suffix(12))], in: web)) as? [String: Any] ?? [:])
                    throw Self.error("点了发送，但 ChatGPT 没有出现这条消息（页面可能改版了）。")
                }
            }
            job.phase = "waiting"
            job.detail = job.kind == "image" ? "已发送，ChatGPT 正在出图" : "已发送，等 ChatGPT 回答"
            let (text, sources) = try await waitForReply(job, baselineImages: Set(baselineImages), baselineAssistants: baselineAssistants, in: web)
            job.reply = text
            job.conversationUrl = (try? await string("location.href.split('#')[0]", in: web)) ?? ""
            if !sources.isEmpty {
                job.phase = "downloading"
                var files: [String] = []
                for (index, source) in sources.enumerated() {
                    try check(job)
                    files.append(try await download(source, index: index + 1, into: job.outputDirectory, in: web).path)
                }
                job.files = files
            }
            job.phase = "done"
            job.detail = sources.isEmpty ? "已回答" : "出了 \(sources.count) 张"
        } catch {
            if !job.cancelled {
                job.phase = "failed"
                job.error = error.localizedDescription
            }
            log(job, "failed", ["error": job.error ?? "", "phase": job.phase])
        }
        if job.phase == "done" { log(job, "done", ["files": job.files.count]) }
        finish(job)
    }

    /// A small private log next to the job folders, for diagnosing page
    /// changes. Only phases and page shape are written, never the reply text.
    private func log(_ job: Job, _ event: String, _ data: [String: Any] = [:]) {
        var entry = data
        entry.removeValue(forKey: "text")
        entry["t"] = ISO8601DateFormatter().string(from: Date())
        entry["job"] = String(job.id.prefix(8)); entry["kind"] = job.kind; entry["event"] = event
        guard let json = try? JSONSerialization.data(withJSONObject: entry), var line = String(data: json, encoding: .utf8) else { return }
        line += "\n"
        let file = root.appendingPathComponent("worker.log")
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile(); handle.write(Data(line.utf8)); try? handle.close()
        } else { try? Data(line.utf8).write(to: file) }
    }

    private func check(_ job: Job) throws {
        if job.cancelled { throw Self.error("已取消") }
        if Date().timeIntervalSince(job.startedAt) > Self.jobTimeout {
            throw Self.error("超过 \(Int(Self.jobTimeout / 60)) 分钟还没完成，已放弃这一次。")
        }
    }

    private func waitFor(_ job: Job, seconds: TimeInterval, poll: TimeInterval, _ test: () async throws -> Bool) async throws -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            try check(job)
            if (try? await test()) == true { return true }
            try await Task.sleep(nanoseconds: UInt64(poll * 1_000_000_000))
        }
        return false
    }

    private func account(in web: WKWebView) async throws -> [String: Any] {
        // Only whether a user is signed in and the plan name leave the page;
        // the session token never does.
        let value = try await call("""
            try {
              const r = await fetch('/api/auth/session', {credentials: 'include'});
              const j = await r.json();
              const user = j && j.user;
              return {loggedIn: !!user, plan: String((j && j.account && j.account.planType) || '')};
            } catch (e) { return {loggedIn: !!document.querySelector('[data-testid="profile-button"], [data-testid="accounts-profile-button"]'), plan: ''}; }
            """, in: web)
        return value as? [String: Any] ?? ["loggedIn": false]
    }

    private func upload(_ refs: [URL], in web: WKWebView, job: Job) async throws {
        var payload: [[String: String]] = []
        var total = 0
        for url in refs {
            let data = try Data(contentsOf: url)
            total += data.count
            guard total <= 40 * 1024 * 1024 else { throw Self.error("附图合计超过 40 MB。") }
            let ext = url.pathExtension.lowercased()
            let type = ext == "jpg" ? "image/jpeg" : "image/\(ext)"
            payload.append(["name": url.lastPathComponent, "type": type, "data": data.base64EncodedString()])
        }
        let before = try await int("P.attachments()", in: web)
        let attached = try await call("""
            const files = refs.map(r => {
              const bin = atob(r.data); const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              return new File([bytes], r.name, {type: r.type});
            });
            const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
            const inputs = [...document.querySelectorAll('input[type=file]')];
            const input = inputs.find(i => /image/.test(i.accept || '')) || inputs[inputs.length - 1];
            if (input) {
              input.files = dt.files;
              input.dispatchEvent(new Event('change', {bubbles: true}));
              return 'input';
            }
            const target = P.input();
            if (!target) return '';
            target.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
            return 'drop';
            """, arguments: ["refs": payload], in: web) as? String ?? ""
        guard !attached.isEmpty else { throw Self.error("找不到上传附图的位置（页面可能改版了）。") }
        job.detail = "正在上传 \(refs.count) 张附图"
        let uploaded = try await waitFor(job, seconds: 90, poll: 1) {
            let count = try await self.int("P.attachments()", in: web)
            let busy = try await self.bool("P.uploading()", in: web)
            return count >= before + refs.count && !busy
        }
        guard uploaded else { throw Self.error("附图没有上传成功（等了 90 秒）。") }
        try await Task.sleep(nanoseconds: 1_200_000_000)
    }

    private func type(_ prompt: String, in web: WKWebView) async throws {
        let typed = try await call("""
            const e = P.input(); if (!e) return 0;
            e.focus();
            if (e.tagName === 'TEXTAREA') {
              const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
              set.call(e, text); e.dispatchEvent(new Event('input', {bubbles: true}));
              return e.value.length;
            }
            const sel = getSelection(); sel.selectAllChildren(e); document.execCommand('delete');
            document.execCommand('insertText', false, text);
            if ((e.innerText || '').trim().length < 2) {
              e.dispatchEvent(new InputEvent('beforeinput', {inputType: 'insertText', data: text, bubbles: true, cancelable: true}));
            }
            return (e.innerText || '').trim().length;
            """, arguments: ["text": prompt], in: web) as? Int ?? 0
        guard typed >= min(2, prompt.count) else { throw Self.error("内容没有填进 ChatGPT 输入框。") }
        try await Task.sleep(nanoseconds: 600_000_000)
    }

    /// Waits until ChatGPT has stopped writing and the reply (text and any
    /// generated images) is unchanged across two polls.
    private func waitForReply(_ job: Job, baselineImages: Set<String>, baselineAssistants: Int, in web: WKWebView) async throws -> (String, [String]) {
        var lastImages: [String] = []
        var lastText = ""
        var stable = 0
        var polls = 0
        while true {
            try check(job)
            try await Task.sleep(nanoseconds: 2_500_000_000)
            let state = try await call("""
                const imgs = P.generated().map(i => P.src(i)).filter(s => s && !baseline.includes(s));
                const text = document.body.innerText || '';
                return {
                  imgs: [...new Set(imgs)],
                  busy: P.busy() || /正在创建图|正在生成图|Creating image|Generating image|图像创建中/i.test(text),
                  count: P.assistants().length,
                  reply: P.lastAssistantText().slice(0, 60000),
                };
                """, arguments: ["baseline": Array(baselineImages)], in: web) as? [String: Any] ?? [:]
            let images = state["imgs"] as? [String] ?? []
            let busy = state["busy"] as? Bool ?? false
            polls += 1
            if polls % 4 == 1 { log(job, "poll", (try? await call("return P.state();", in: web)) as? [String: Any] ?? [:]) }
            let fresh = (state["count"] as? Int ?? 0) > baselineAssistants
            let text = fresh ? state["reply"] as? String ?? "" : ""
            if busy || (!fresh && images.isEmpty) {
                stable = 0; lastImages = images; lastText = text
                job.detail = job.kind == "image" ? "ChatGPT 正在出图" : "ChatGPT 正在回答"
                continue
            }
            stable = images == lastImages && text == lastText ? stable + 1 : 0
            lastImages = images; lastText = text
            // Text-only replies settle quickly; give image grids one more poll.
            if stable < (job.kind == "image" ? 2 : 1) { continue }
            if job.kind == "image" && images.isEmpty {
                // Wait a bit longer: the image card can appear after a short preface.
                if stable < 6 { continue }
                let limited = text.range(of: #"上限|限额|limit|稍后再试|try again later|too many"#, options: [.regularExpression, .caseInsensitive]) != nil
                throw Self.error((limited ? "ChatGPT 提示出图次数到了上限：" : "ChatGPT 没有出图，回复：") + text.prefix(300))
            }
            if job.kind == "ask" && text.isEmpty && images.isEmpty { continue }
            return (text, images)
        }
    }

    private func download(_ source: String, index: Int, into directory: URL, in web: WKWebView) async throws -> URL {
        let value = try await call("""
            const r = await fetch(src, {credentials: 'include'});
            if (!r.ok) return {error: 'HTTP ' + r.status};
            const type = r.headers.get('content-type') || '';
            const b = new Uint8Array(await r.arrayBuffer());
            let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
            return {type, data: btoa(s)};
            """, arguments: ["src": source], in: web) as? [String: Any] ?? [:]
        if let error = value["error"] as? String { throw Self.error("下载生成的图片失败：\(error)") }
        guard let base64 = value["data"] as? String, let data = Data(base64Encoded: base64), data.count > 1024 else {
            throw Self.error("下载生成的图片失败（内容为空）。")
        }
        let type = value["type"] as? String ?? ""
        let ext = Self.sniffExtension(data) ?? (type.contains("jpeg") ? "jpg" : type.contains("webp") ? "webp" : "png")
        let file = directory.appendingPathComponent("image-\(index).\(ext)")
        try data.write(to: file, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return file
    }

    static func sniffExtension(_ data: Data) -> String? {
        let head = [UInt8](data.prefix(12))
        if head.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "png" }
        if head.starts(with: [0xFF, 0xD8, 0xFF]) { return "jpg" }
        if head.count >= 12, Array(head[0...3]) == [0x52, 0x49, 0x46, 0x46], Array(head[8...11]) == [0x57, 0x45, 0x42, 0x50] { return "webp" }
        return nil
    }

    // MARK: WebView

    private func ensureWebView() -> WKWebView {
        if let webView { return webView }
        let configuration = WKWebViewConfiguration()
        // Same store as the built-in browser: the user's ChatGPT login.
        configuration.websiteDataStore = .default()
        // The page is never on screen. Without these WebKit treats it as a
        // hidden tab and throttles its timers and rendering.
        for key in ["hiddenPageDOMTimerThrottlingEnabled", "hiddenPageDOMTimerThrottlingAutoIncreases", "pageVisibilityBasedProcessSuppressionEnabled"] {
            let setter = NSSelectorFromString("_set" + key.prefix(1).uppercased() + key.dropFirst() + ":")
            if configuration.preferences.responds(to: setter) { configuration.preferences.setValue(false, forKey: key) }
        }
        configuration.userContentController.addUserScript(WKUserScript(source: Self.helpers, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .page))
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 900), configuration: configuration)
        web.navigationDelegate = self
        // An off-screen window gives the page a real desktop-sized layout
        // without showing anything to the user.
        let window = NSWindow(contentRect: NSRect(x: -20_000, y: -20_000, width: 1280, height: 900), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.ignoresMouseEvents = true
        window.isExcludedFromWindowsMenu = true
        window.contentView = web
        window.orderBack(nil)
        self.window = window
        self.webView = web
        return web
    }

    private func load(_ url: URL, in web: WKWebView) async throws {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            navigationWaiters.append(continuation)
            web.load(URLRequest(url: url))
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.resumeNavigation() }
        }
        try await Task.sleep(nanoseconds: 1_500_000_000)
    }

    private func resumeNavigation() {
        let waiters = navigationWaiters
        navigationWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in self.resumeNavigation() }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.resumeNavigation() }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.resumeNavigation() }
    }

    // MARK: JavaScript

    private func call(_ body: String, arguments: [String: Any] = [:], in web: WKWebView) async throws -> Any? {
        // The helpers are re-installed when missing: a client-side route
        // change or a reload can race the user script.
        let script = "if (!window.P) { \(Self.helpers) }\n\(body)"
        return try await withCheckedThrowingContinuation { continuation in
            web.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
                switch result {
                case .success(let value): continuation.resume(returning: value)
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
    }

    private func bool(_ expression: String, in web: WKWebView) async throws -> Bool { try await call("return !!(\(expression));", in: web) as? Bool ?? false }
    private func int(_ expression: String, in web: WKWebView) async throws -> Int { try await call("return Number(\(expression)) || 0;", in: web) as? Int ?? 0 }
    private func string(_ expression: String, in web: WKWebView) async throws -> String { try await call("return String(\(expression));", in: web) as? String ?? "" }
    private func strings(_ expression: String, in web: WKWebView) async throws -> [String] { try await call("return \(expression);", in: web) as? [String] ?? [] }

    static func error(_ message: String) -> NSError {
        NSError(domain: "PinkieGPTWeb", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    /// Page helpers. Kept in one place so the selectors can be updated together
    /// when ChatGPT changes its markup.
    static let helpers = #"""
    window.P = {
      visible(n) { return !!n && !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length); },
      input() {
        const c = [];
        for (const id of ['prompt-textarea', 'pending-home-input']) { const e = document.getElementById(id); if (e) c.push(e); }
        document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]').forEach(e => c.push(e));
        return c.find(e => { const b = e.getBoundingClientRect(); return b.width > 120 && b.height > 10; }) || null;
      },
      src(img) { return img.currentSrc || img.src || ''; },
      inUserTurn(n) {
        if (n.closest('[data-message-author-role="user"], [data-user-message-bubble="true"]')) return true;
        const unit = n.closest('[data-chatgpt-search-unit-key]');
        if (unit) return /:(?:u|user)$/.test(unit.getAttribute('data-chatgpt-search-unit-key') || '');
        const turn = n.closest('[data-testid^="conversation-turn-"], article[data-turn-id]');
        return !!turn && !!turn.querySelector('[data-message-author-role="user"]') && !turn.querySelector('[data-message-author-role="assistant"]');
      },
      turns() { return [...document.querySelectorAll('[data-testid^="conversation-turn-"], article[data-turn-id]')]; },
      // ChatGPT can put the role marker on a display:contents wrapper or drop
      // it entirely; count turns by their heading too (same rule as the relay).
      // 2026-11 layout: one div[data-turn-key] per exchange; message units
      // carry data-chatgpt-search-unit-key "<conversation>:<n>:u" (user) or
      // another suffix for the assistant.
      units(kind) {
        return [...document.querySelectorAll('[data-chatgpt-search-unit-key]')].filter(n => {
          const user = /:(?:u|user)$/.test(n.getAttribute('data-chatgpt-search-unit-key') || '') || !!n.querySelector('[data-user-message-bubble="true"]');
          return kind === 'user' ? user : !user;
        });
      },
      assistants() {
        const units = P.units('assistant');
        if (units.length) return units;
        const role = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
        const turns = P.turns().filter(t => !t.querySelector('[data-message-author-role="user"]')
          && (/(?:ChatGPT 说|ChatGPT said)/i.test(t.querySelector('h4,h5,h6')?.textContent || '')
            || !!t.querySelector('.markdown, [data-message-author-role="assistant"]')));
        return turns.length >= role.length ? turns : role;
      },
      users() {
        const bubbles = [...document.querySelectorAll('[data-user-message-bubble="true"]')];
        const units = P.units('user');
        if (units.length || bubbles.length) return units.length >= bubbles.length ? units : bubbles;
        const role = [...document.querySelectorAll('[data-message-author-role="user"]')];
        const turns = P.turns().filter(t => !!t.querySelector('[data-message-author-role="user"]')
          || /(?:你说|You said)/i.test(t.querySelector('h4,h5,h6')?.textContent || ''));
        return turns.length >= role.length ? turns : role;
      },
      selectChat() {
        const exact = n => /^(?:聊天|Chat)$/i.test((n.textContent || '').trim());
        const leaf = [...document.querySelectorAll('button,[role="radio"],[role="tab"],label')].find(n => P.visible(n) && exact(n));
        if (!leaf) return 'none';
        const on = leaf.getAttribute('aria-checked') === 'true' || leaf.getAttribute('aria-selected') === 'true'
          || leaf.getAttribute('data-state') === 'checked' || leaf.getAttribute('aria-pressed') === 'true';
        if (!on) leaf.click();
        return on ? 'already' : 'clicked';
      },
      // Shape of the page around a piece of text: tags, ids, test ids and
      // role attributes up the ancestor chain. Used only for diagnostics.
      shapeOf(el) {
        const out = [];
        const walk = (n, depth) => {
          if (!n || depth > 5 || out.length > 30) return;
          const attrs = [...n.attributes].filter(a => /^(id|data-[\w-]+|role)$/.test(a.name) && !/search-unit-key|message-ids/.test(a.name)).map(a => a.name + '=' + String(a.value).slice(0, 30));
          out.push('  '.repeat(depth) + n.tagName.toLowerCase() + (attrs.length ? '[' + attrs.join(' ') + ']' : '') + '.' + String(typeof n.className === 'string' ? n.className : '').split(/\s+/).slice(0, 3).join('.'));
          [...n.children].forEach(c => walk(c, depth + 1));
        };
        walk(el, 0);
        return out;
      },
      shape(needle) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let hit = null;
        while (walker.nextNode()) { if ((walker.currentNode.nodeValue || '').includes(needle)) { hit = walker.currentNode.parentElement; } }
        const chain = [];
        for (let n = hit; n && n !== document.body && chain.length < 18; n = n.parentElement) {
          const attrs = [...n.attributes].filter(a => /^(id|data-[\w-]+|role|aria-label)$/.test(a.name)).map(a => a.name + '=' + String(a.value).slice(0, 40));
          chain.push(n.tagName.toLowerCase() + (attrs.length ? '[' + attrs.join(' ') + ']' : '') + '.' + String(n.className && n.className.baseVal === undefined ? n.className : '').split(/\s+/).slice(0, 2).join('.'));
        }
        const testids = {};
        document.querySelectorAll('[data-testid]').forEach(n => { const k = n.getAttribute('data-testid').replace(/\d+/g, '#'); testids[k] = (testids[k] || 0) + 1; });
        const roles = {};
        document.querySelectorAll('[data-message-author-role],[data-turn],[data-turn-id]').forEach(n => { const k = n.tagName + ':' + (n.getAttribute('data-message-author-role') || n.getAttribute('data-turn') || 'turn-id'); roles[k] = (roles[k] || 0) + 1; });
        return {found: !!hit, chain, testids, roles};
      },
      state() {
        const a = P.assistants();
        const keys = [...document.querySelectorAll('[data-chatgpt-search-unit-key]')].map(n => (n.getAttribute('data-chatgpt-search-unit-key') || '').split(':').slice(1).join(':'));
        const states = [...document.querySelectorAll('[data-talvt-turn-state]')].map(n => n.getAttribute('data-talvt-turn-state'));
        return {url: location.href, users: P.users().length, assistants: a.length, busy: P.busy(), keys, states,
          replyImgs: a.length ? [...a[a.length - 1].querySelectorAll('img')].map(i => [i.getAttribute('alt') || '', (P.src(i) || '').slice(0, 60), i.naturalWidth, i.width].join(' | ')).slice(0, 8) : [],
          input: !!P.input(), imgs: P.generated().length, text: P.lastAssistantText().slice(0, 120)};
      },
      generated() {
        return [...document.querySelectorAll('main img, [role="main"] img, article img')].filter(img => {
          if (P.inUserTurn(img) || img.closest('form')) return false;
          const alt = img.getAttribute('alt') || '';
          const src = P.src(img);
          if (!/^https:|^blob:/.test(src)) return false;
          const big = (img.naturalWidth || img.width || 0) >= 256;
          return big && (/已生成图像|已生成的图像|生成的图片|Generated image/i.test(alt) || /oaiusercontent|estuary|backend-api\/.*(file|download)/.test(src));
        });
      },
      attachments() {
        const form = (P.input() || document.body).closest('form') || document.body;
        return form.querySelectorAll('img, [data-testid*="attachment"], [data-testid*="file-tile"]').length;
      },
      uploading() {
        const form = (P.input() || document.body).closest('form') || document.body;
        return !!form.querySelector('[role="progressbar"], circle[stroke-dasharray], [aria-busy="true"]');
      },
      busy() {
        const states = [...document.querySelectorAll('[data-talvt-turn-state]')].map(n => n.getAttribute('data-talvt-turn-state'));
        if (states.length && states[states.length - 1] !== 'complete') return true;
        return [...document.querySelectorAll('button')].some(b => P.visible(b)
          && (b.getAttribute('data-testid') === 'stop-button' || /(停止回答|停止生成|Stop generating|Stop streaming|^停止$|^Stop$)/i.test(b.getAttribute('aria-label') || '')));
      },
      lastAssistantText() {
        const a = P.assistants().pop();
        const parts = a ? [...a.querySelectorAll('[data-markdown-text-style="assistant-message"]')] : [];
        if (parts.length) return parts.map(n => (n.innerText || '').trim()).filter(Boolean).join('\n\n');
        const body = a && (a.querySelector('[data-message-author-role="assistant"] .markdown, .markdown, .prose') || a);
        return body ? (body.innerText || '').replace(/^(?:ChatGPT 说|ChatGPT said)[:：]?\s*/i, '').trim() : '';
      },
      send() {
        const bs = [...document.querySelectorAll('button')].filter(b => P.visible(b));
        const ok = x => !x.disabled && x.getAttribute('aria-disabled') !== 'true';
        const b = bs.find(x => /^(?:send-button|composer-submit-button)$/.test(x.getAttribute('data-testid') || '') && ok(x))
          || bs.find(x => /(发送|Send)/i.test(x.getAttribute('aria-label') || '') && ok(x));
        if (!b) return false;
        b.click();
        return true;
      },
    };
    """#
}
