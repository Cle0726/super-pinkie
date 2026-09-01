import AppKit
import AVFoundation
import Foundation
import Speech
import WebKit

private enum RuntimeConfig {
    private static let values: [String: String] = {
        let configURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/super-pinkie/config.json")
        guard let data = try? Data(contentsOf: configURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return object.reduce(into: [:]) { result, item in
            if let value = item.value as? String { result[item.key] = value }
        }
    }()

    private static func string(_ environmentKey: String, _ configKey: String, fallback: String) -> String {
        ProcessInfo.processInfo.environment[environmentKey] ?? values[configKey] ?? fallback
    }

    static let gatewayURL = URL(string: string(
        "PINKIE_GATEWAY_URL", "gatewayURL", fallback: "http://127.0.0.1:18789/"
    ))!
    static let speechURL = URL(string: string(
        "PINKIE_SPEECH_URL", "speechURL", fallback: "http://127.0.0.1:18888/v1/audio/speech"
    ))!
}

private final class LauncherWindow: NSWindow {
    // Borderless NSWindow instances are not key windows by default. The
    // dashboard contains text inputs, so it must be able to receive focus.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/* A borderless window has no native titlebar to drag. This is deliberately
   invisible: it keeps a slim clear strip at the top edge solely for moving
   the window, without adding a handle or changing the interface. */
private final class WindowDragArea: NSView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

/* WebKit on macOS does not provide a dependable Web Speech recognition path.
   Use the system recognizer directly instead, while leaving sending entirely
   under the user's control. */
private final class NativeDictationController {
    weak var webView: WKWebView?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var isRecording = false

    func start(baseDraft: String) {
        guard !isRecording else { return }
        requestPermissions { [weak self] granted, message in
            guard let self else { return }
            guard granted else {
                self.send(state: "error", message: message)
                return
            }
            self.beginRecording()
        }
    }

    func stop() {
        guard isRecording else { return }
        isRecording = false
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.finish()
        request = nil
        task = nil
        send(state: "idle")
    }

    private func requestPermissions(completion: @escaping (Bool, String?) -> Void) {
        let continueWithMicrophone: () -> Void = {
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized:
                completion(true, nil)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .audio) { allowed in
                    DispatchQueue.main.async {
                        completion(allowed, allowed ? nil : "碧琪还没有麦克风权限。")
                    }
                }
            default:
                completion(false, "请在“系统设置 → 隐私与安全性”里允许超級碧琪使用麦克风。")
            }
        }

        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            continueWithMicrophone()
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    guard status == .authorized else {
                        completion(false, "请在“系统设置 → 隐私与安全性”里允许超級碧琪使用语音识别。")
                        return
                    }
                    continueWithMicrophone()
                }
            }
        default:
            completion(false, "请在“系统设置 → 隐私与安全性”里允许超級碧琪使用语音识别。")
        }
    }

    private func beginRecording() {
        guard let recognizer, recognizer.isAvailable else {
            send(state: "error", message: "语音识别暂时不可用，碧琪晚点再试试。")
            return
        }

        task?.cancel()
        task = nil
        request = SFSpeechAudioBufferRecognitionRequest()
        guard let request else {
            send(state: "error", message: "碧琪没能准备好听写小本本。")
            return
        }
        request.shouldReportPartialResults = true
        request.taskHint = .dictation

        let inputNode = audioEngine.inputNode
        inputNode.removeTap(onBus: 0)
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1_024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
            send(state: "recording")
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let text = result?.bestTranscription.formattedString, !text.isEmpty {
                        // SFSpeech may deliver one final transcript after the
                        // user stops. Keep that text, but never relight the
                        // microphone after stop() has already set idle.
                        self.send(state: self.isRecording ? "recording" : "idle", transcript: text)
                    }
                    if error != nil && self.isRecording {
                        self.stop()
                        self.send(state: "error", message: "听写刚刚断开啦，先生再点一次试试。")
                    }
                }
            }
        } catch {
            inputNode.removeTap(onBus: 0)
            send(state: "error", message: "麦克风启动失败，碧琪没能听清。")
        }
    }

    private func send(state: String, transcript: String? = nil, message: String? = nil) {
        guard let webView else { return }
        var payload: [String: String] = ["state": state]
        if let transcript { payload["transcript"] = transcript }
        if let message { payload["message"] = message }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__laolaoNativeDictationUpdate?.(\(json));")
    }
}

/* Playback belongs to the native app rather than WebKit. That avoids browser
   autoplay rules while the page continues to decide which reply sentences are
   ready to be spoken. */
private final class NativeLiveSpeechController: NSObject, AVAudioPlayerDelegate {
    private struct SpeechItem {
        let id: UUID
        var audio: Data?
        var failed = false
    }

    private let endpoint = RuntimeConfig.speechURL
    private var queue: [SpeechItem] = []
    private var player: AVAudioPlayer?

    func enqueue(_ rawText: String) {
        let text = rawText.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let id = UUID()
        queue.append(SpeechItem(id: id))
        requestAudio(text, id: id)
    }

    func stop() {
        queue.removeAll()
        player?.stop()
        player = nil
    }

    private func requestAudio(_ text: String, id: UUID) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "model": "edge-tts",
            "voice": "zh-CN-XiaoyiNeural",
            "input": text,
        ])

        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self, let index = self.queue.firstIndex(where: { $0.id == id }) else { return }
                let succeeded = (response as? HTTPURLResponse)?.statusCode == 200 && !(data?.isEmpty ?? true)
                if succeeded {
                    self.queue[index].audio = data
                } else {
                    self.queue[index].failed = true
                }
                self.playNextIfReady()
            }
        }.resume()
    }

    private func playNextIfReady() {
        guard player == nil else { return }
        while let first = queue.first {
            if first.failed {
                queue.removeFirst()
                continue
            }
            guard let audio = first.audio else { return }
            queue.removeFirst()
            do {
                let nextPlayer = try AVAudioPlayer(data: audio)
                nextPlayer.delegate = self
                nextPlayer.prepareToPlay()
                player = nextPlayer
                nextPlayer.play()
                return
            } catch {
                continue
            }
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.player = nil
            self?.playNextIfReady()
        }
    }
}

private enum Gateway {
    static let url = RuntimeConfig.gatewayURL

    static func isRunning(completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.2
        URLSession.shared.dataTask(with: request) { _, response, _ in
            completion((response as? HTTPURLResponse)?.statusCode != nil)
        }.resume()
    }

    static func start() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = ["-lc", #"openclaw_bin="$(command -v openclaw 2>/dev/null || true)"; if [ -z "$openclaw_bin" ]; then for candidate in "$HOME"/.nvm/versions/node/*/bin/openclaw /opt/homebrew/bin/openclaw /usr/local/bin/openclaw; do if [ -x "$candidate" ]; then openclaw_bin="$candidate"; break; fi; done; fi; if [ -n "$openclaw_bin" ]; then nohup "$openclaw_bin" gateway run > "${TMPDIR:-/tmp}/super-pinkie-gateway.log" 2>&1 & fi"#]
        try? task.run()
    }
}

private final class PartyService {
    static let url = URL(string: "http://127.0.0.1:18889/")!
    private var process: Process?

    func start() {
        guard process?.isRunning != true,
              let root = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie") else { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        task.arguments = [root.appendingPathComponent("services/party/server.py").path]
        var environment = ProcessInfo.processInfo.environment
        environment["PINKIE_GATEWAY_URL"] = Gateway.url.absoluteString
        task.environment = environment
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do { try task.run(); process = task } catch { NSLog("派对服务无法启动：%@", error.localizedDescription) }
    }

    func stop() { if process?.isRunning == true { process?.terminate() } }

    func ready(attempt: Int = 0, completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: Self.url.appendingPathComponent("api/health"))
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let ready = object?["service"] as? String == "super-pinkie-party" && object?["protocol"] as? Int == 1
            DispatchQueue.main.async {
                if ready || attempt >= 12 { completion(ready); return }
                self?.start()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    self?.ready(attempt: attempt + 1, completion: completion)
                }
            }
        }.resume()
    }
}

private final class RoundtableService {
    static let url = URL(string: "http://127.0.0.1:18891/")!
    private var process: Process?

    func start() {
        guard process?.isRunning != true,
              let root = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie") else { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        task.arguments = [root.appendingPathComponent("services/roundtable/server.py").path]
        var environment = ProcessInfo.processInfo.environment
        environment["PINKIE_GATEWAY_URL"] = Gateway.url.absoluteString
        task.environment = environment
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do { try task.run(); process = task } catch { NSLog("灵感圆桌服务无法启动：%@", error.localizedDescription) }
    }

    func stop() { if process?.isRunning == true { process?.terminate() } }

    func ready(attempt: Int = 0, completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: Self.url.appendingPathComponent("api/health"))
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let ready = object?["service"] as? String == "super-pinkie-roundtable" && object?["protocol"] as? Int == 1
            DispatchQueue.main.async {
                if ready || attempt >= 12 { completion(ready); return }
                self?.start()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    self?.ready(attempt: attempt + 1, completion: completion)
                }
            }
        }.resume()
    }
}

private enum BundledSetup {
    static func apply() {
        guard let resources = Bundle.main.resourceURL else { return }
        let script = resources
            .appendingPathComponent("SuperPinkie/installer/macos/apply-bundled.sh")
        guard FileManager.default.fileExists(atPath: script.path) else { return }

        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/bash")
        task.arguments = [script.path]
        var environment = ProcessInfo.processInfo.environment
        environment["PINKIE_SKIP_APP_BUNDLES"] = "1"
        task.environment = environment
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return
        }
    }
}

@main
struct LauncherMain {
    static func main() {
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
        let roundtableItem = appMenu.addItem(withTitle: "打开灵感圆桌", action: #selector(AppDelegate.openRoundtable(_:)), keyEquivalent: "r")
        roundtableItem.target = delegate
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

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var retries = 0
    private let dictation = NativeDictationController()
    private let dictationHandlerName = "laolaoNativeDictation"
    private let liveSpeech = NativeLiveSpeechController()
    private let liveSpeechHandlerName = "laolaoLiveVoice"
    private let projectFolderHandlerName = "laolaoProjectFolder"
    private let party = PartyService()
    private let roundtable = RoundtableService()

    @objc func openParty(_ sender: Any?) {
        party.ready { [weak self] ready in
            if ready {
                self?.dictation.stop()
                self?.liveSpeech.stop()
                self?.webView?.load(URLRequest(url: PartyService.url))
            } else {
                let alert = NSAlert()
                alert.messageText = "派对服务还没准备好"
                alert.informativeText = "请确认本机安装了 Python 3，且端口 18889 没有被其他程序占用。原来的四模式聊天不受影响。"
                alert.runModal()
            }
        }
    }

    @objc func openRoundtable(_ sender: Any?) {
        roundtable.ready { [weak self] ready in
            if ready {
                self?.dictation.stop()
                self?.liveSpeech.stop()
                self?.webView?.load(URLRequest(url: RoundtableService.url))
            } else {
                let alert = NSAlert()
                alert.messageText = "灵感圆桌还没准备好"
                alert.informativeText = "请确认本机安装了 Python 3，且端口 18891 没有被其他程序占用。其他聊天不会受影响。"
                alert.runModal()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) { party.stop(); roundtable.stop() }

    // 前后台通知: WKWebView 切后台会被 macOS 挂起 JS/网络, 网关 websocket
    // 悄悄断开 (1006), "回复完成"事件丢失, 前端动画永久转圈。
    // 主动通知前端, 让它回前台时重拉会话并复位"生成中"状态。
    func applicationDidResignActive(_ notification: Notification) {
        notifyWebView("pinkie:app-background")
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        notifyWebView("pinkie:app-foreground")
    }

    private func notifyWebView(_ event: String) {
        let script = "window.dispatchEvent(new CustomEvent('\(event)'));"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script) { _, error in
                if let error = error {
                    NSLog("[laolao] \(event) notify failed: %@", error.localizedDescription)
                }
            }
        }
    }

    private func trustedFrame(_ frame: WKFrameInfo) -> Bool {
        guard frame.isMainFrame, let url = frame.request.url else { return false }
        return [Gateway.url, PartyService.url, RoundtableService.url].contains { allowed in
            url.scheme == allowed.scheme && url.host == allowed.host && url.port == allowed.port
        }
    }

    @objc func checkForUpdates(_ sender: Any?) {
        let task = Process()
        let output = Pipe()
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = ["-lc", #"config="$HOME/.config/super-pinkie/install.env"; if [ ! -f "$config" ]; then repo="$HOME/Library/Application Support/SuperPinkie/repository"; mkdir -p "$(dirname "$repo")"; if [ -d "$repo/.git" ]; then git -C "$repo" pull --ff-only origin main || exit $?; else git clone --branch main https://github.com/Cle0726/super-pinkie.git "$repo" || exit $?; fi; exec "$repo/install-full.sh"; fi; source "$config"; exec "$PINKIE_REPO/update-full.sh""#]
        task.standardOutput = output
        task.standardError = output
        task.terminationHandler = { process in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                ?? "更新程序没有返回消息。"
            DispatchQueue.main.async {
                let alert = NSAlert()
                alert.messageText = process.terminationStatus == 0 ? "碧琪更新完成啦" : "更新没有完成"
                alert.informativeText = process.terminationStatus == 0
                    ? "\(message)\n\n退出并重新打开 App 后使用新版本。"
                    : message
                alert.alertStyle = process.terminationStatus == 0 ? .informational : .warning
                alert.addButton(withTitle: "知道了")
                alert.runModal()
            }
        }
        do {
            try task.run()
        } catch {
            let alert = NSAlert(error: error)
            alert.runModal()
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        BundledSetup.apply()
        party.ready { _ in }
        roundtable.ready { _ in }
        let rect = NSRect(x: 0, y: 0, width: 1280, height: 800)
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
        window.hasShadow = true
        window.minSize = NSSize(width: 860, height: 580)
        window.setFrame(rect, display: false)
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: dictationHandlerName)
        configuration.userContentController.add(self, name: liveSpeechHandlerName)
        configuration.userContentController.add(self, name: projectFolderHandlerName)
        configuration.userContentController.add(self, name: "laolaoParty")
        configuration.userContentController.add(self, name: "laolaoRoundtable")
        configuration.userContentController.addUserScript(WKUserScript(
            source: nativeDictationBridge,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
        // Mark only the native shell. The web UI uses this to avoid whole-page
        // opacity animation while keeping its decorative motion intact.
        configuration.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.setAttribute('data-pinkie-native-glass', '1')",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
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

        guard let contentView = window.contentView else { return }
        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = 22
        contentView.layer?.cornerCurve = .continuous
        contentView.layer?.masksToBounds = true
        contentView.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: contentView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])

        let dragArea = WindowDragArea(frame: .zero)
        dragArea.translatesAutoresizingMaskIntoConstraints = false
        dragArea.wantsLayer = true
        dragArea.layer?.backgroundColor = NSColor.clear.cgColor
        contentView.addSubview(dragArea)
        NSLayoutConstraint.activate([
            dragArea.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            dragArea.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            dragArea.topAnchor.constraint(equalTo: contentView.topAnchor),
            dragArea.heightAnchor.constraint(equalToConstant: 22),
        ])

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

        Gateway.isRunning { [weak self] running in
            if !running { Gateway.start() }
            DispatchQueue.main.asyncAfter(deadline: .now() + (running ? 0.2 : 1.2)) {
                self?.loadDashboard()
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func loadDashboard() {
        webView?.load(URLRequest(url: Gateway.url))
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

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard trustedFrame(message.frameInfo) else { return }
        if message.name == "laolaoParty" { openParty(nil); return }
        if message.name == "laolaoRoundtable" { openRoundtable(nil); return }
        if message.name == projectFolderHandlerName,
           let body = message.body as? [String: Any],
           let action = body["action"] as? String {
            handleProjectFolderAction(action, body: body)
            return
        }

        if message.name == liveSpeechHandlerName,
           let body = message.body as? [String: Any] {
            if body["action"] as? String == "stop" {
                liveSpeech.stop()
                return
            }
            if let text = body["text"] as? String {
                liveSpeech.enqueue(text)
            }
            return
        }

        if message.name == dictationHandlerName,
           let body = message.body as? [String: Any],
           let action = body["action"] as? String {
            switch action {
            case "start":
                dictation.start(baseDraft: body["draft"] as? String ?? "")
            case "stop":
                dictation.stop()
            default:
                break
            }
        }
    }

    private func handleProjectFolderAction(_ action: String, body: [String: Any]) {
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
                    ])
                    return
                }
                self.sendProjectFolderResult([
                    "requestId": requestId,
                    "cancelled": false,
                    "path": url.path,
                    "name": url.lastPathComponent,
                ])
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

    private func sendProjectFolderResult(_ payload: [String: Any]) {
        guard let webView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__laolaoProjectFolderResult?.(\(json));")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        guard retries < 8 else { return }
        retries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
            self?.loadDashboard()
        }
    }

    private var nativeDictationBridge: String {
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

          window.__laolaoNativeDictationUpdate = (payload) => {
            if (!payload || typeof payload !== "object") return;
            if (typeof payload.transcript === "string") setDraft(payload.transcript);
            if (payload.state === "recording") active = true;
            if (payload.state === "idle" || payload.state === "error") active = false;
            ensureButton();
            updateButton(payload.message || "");
          };

          ensureButton();
          new MutationObserver(ensureButton).observe(document.documentElement, { childList: true, subtree: true });
        })();
        """#
    }
}
