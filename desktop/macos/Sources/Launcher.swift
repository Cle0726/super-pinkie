import AppKit
import AVFoundation
import Darwin
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

private enum BundledRuntime {
    static let resourceRoot = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie")
    static let runtimeRoot = resourceRoot?.appendingPathComponent("runtime")
    static let binRoot = runtimeRoot?.appendingPathComponent("bin")
    static let nodeURL = binRoot?.appendingPathComponent("node")
    static let openClawURL = binRoot?.appendingPathComponent("openclaw")
    static let openClawEntryURL = runtimeRoot?.appendingPathComponent("openclaw/openclaw.mjs")
    // Desktop input must run through the notarized CuaDriver.app identity.
    // A raw helper copied into this bundle is re-signed with the launcher and
    // gets a new TCC identity on every local build, leaving an apparently-on
    // permission switch that cannot actually capture or click.
    static let cuaDriverAppURL = URL(fileURLWithPath: "/Applications/CuaDriver.app", isDirectory: true)
    static let cuaDriverURL = cuaDriverAppURL.appendingPathComponent("Contents/MacOS/cua-driver")
    static let cuaDriverArchiveURL = runtimeRoot?.appendingPathComponent("cua-driver-helper.tar.gz")
    static let cuaDriverVersion = "0.22.0"
    static let cuaDriverArchiveSHA256 = "59603bc7e5f8d9d70f165d87158e577f99227ffcbb91d5fd9f9c688f4beb3727"
    static let cuaDriverTeamID = "YCK386LBJ7"
    static let pythonURL = runtimeRoot?.appendingPathComponent("python/bin/python3")

    static func exists(_ url: URL?) -> Bool {
        guard let url else { return false }
        return FileManager.default.isExecutableFile(atPath: url.path)
    }

    static func environment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let fallbackPath = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        if let binRoot {
            environment["PATH"] = binRoot.path + ":" + fallbackPath
        }
        if exists(openClawURL) {
            environment["PINKIE_OPENCLAW_BIN"] = openClawURL?.path
        }
        if let openClawRoot = runtimeRoot?.appendingPathComponent("openclaw"),
           FileManager.default.fileExists(atPath: openClawRoot.path) {
            environment["OPENCLAW_ROOT"] = openClawRoot.path
        }
        if exists(pythonURL) {
            environment["PINKIE_PYTHON_BIN"] = pythonURL?.path
        }
        environment["PINKIE_MANAGED_GATEWAY"] = "1"
        // CLE Kk is a private loopback desktop App. OpenClaw otherwise marks
        // webchat turns as non-owner and silently removes gateway/nodes/cron
        // tools from every mode. Keep the bypass scoped to this managed local
        // gateway; public or externally launched OpenClaw keeps its defaults.
        environment["CLE_KK_LOCAL_UNRESTRICTED"] = "1"
        // The pinned 2026.7 runtime must ignore four configuration fields
        // that a briefly installed 2026.9 build may have left behind.  The
        // setup helper removes only those schema-incompatible keys and keeps
        // every user model, prompt, memory and workspace setting intact.
        environment["PINKIE_RUNTIME_CONFIG_SCHEMA"] = "2026.7"
        environment["PINKIE_GATEWAY_URL"] = RuntimeConfig.gatewayURL.absoluteString
        // This App is a pinned CLE Kk release. Upstream OpenClaw/Cua update
        // notices must never replace its patched runtime behind the user's
        // back; only the explicit CLE Kk updater may advance the bundle.
        environment["OPENCLAW_NO_AUTO_UPDATE"] = "1"
        environment["CUA_DRIVER_RS_UPDATE_CHECK"] = "false"
        environment["CUA_DRIVER_RS_TELEMETRY_ENABLED"] = "false"
        if let endpoint = DesktopControlEndpoint.environmentValue() {
            environment["OPENCLAW_CUA_DRIVER_ENDPOINT"] = endpoint
        }
        return environment
    }

    static func pythonExecutable() -> URL? {
        if exists(pythonURL) { return pythonURL }
        let system = URL(fileURLWithPath: "/usr/bin/python3")
        return exists(system) ? system : nil
    }

    static func logHandle(named name: String) -> FileHandle? {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SuperPinkie/logs", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(name + ".log")
            if !FileManager.default.fileExists(atPath: file.path) {
                FileManager.default.createFile(atPath: file.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: file)
            handle.seekToEndOfFile()
            return handle
        } catch {
            return nil
        }
    }

    private static func runTool(_ executable: String, _ arguments: [String]) -> (status: Int32, data: Data) {
        let task = Process()
        let pipe = Pipe()
        task.executableURL = URL(fileURLWithPath: executable)
        task.arguments = arguments
        task.environment = environment()
        task.standardOutput = pipe
        task.standardError = pipe
        do {
            try task.run()
            let data = (try? pipe.fileHandleForReading.readToEnd()) ?? Data()
            task.waitUntilExit()
            return (task.terminationStatus, data)
        } catch {
            return (-1, Data(error.localizedDescription.utf8))
        }
    }

    private static func isValidCuaDriverApp(_ app: URL) -> Bool {
        let plist = app.appendingPathComponent("Contents/Info.plist")
        let executable = app.appendingPathComponent("Contents/MacOS/cua-driver")
        guard exists(executable),
              let plistData = try? Data(contentsOf: plist),
              let values = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
              values["CFBundleIdentifier"] as? String == "com.trycua.driver",
              values["CFBundleShortVersionString"] as? String == cuaDriverVersion,
              runTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path]).status == 0 else {
            return false
        }
        let signature = runTool("/usr/bin/codesign", ["-dvv", app.path])
        return signature.status == 0
            && String(decoding: signature.data, as: UTF8.self).contains("TeamIdentifier=\(cuaDriverTeamID)")
    }

    /// Install the pinned, notarized helper from this signed release. The
    /// archive is opaque while CLE Kk itself is signed, so the vendor's stable
    /// Developer ID signature is never rewritten by our packaging step.
    static func ensureCuaDriverApp() throws -> URL {
        if isValidCuaDriverApp(cuaDriverAppURL) { return cuaDriverAppURL }
        guard let archive = cuaDriverArchiveURL,
              FileManager.default.fileExists(atPath: archive.path) else {
            throw NSError(domain: "CLEKkDesktopControl", code: 10, userInfo: [
                NSLocalizedDescriptionKey: "定版中缺少桌面执行器安装包。",
            ])
        }
        let checksum = runTool("/usr/bin/shasum", ["-a", "256", archive.path])
        guard checksum.status == 0,
              String(decoding: checksum.data, as: UTF8.self).hasPrefix(cuaDriverArchiveSHA256) else {
            throw NSError(domain: "CLEKkDesktopControl", code: 11, userInfo: [
                NSLocalizedDescriptionKey: "桌面执行器安装包校验失败。",
            ])
        }

        let fileManager = FileManager.default
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let temporaryRoot = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("clekk-cua-install-\(suffix)", isDirectory: true)
        try fileManager.createDirectory(at: temporaryRoot, withIntermediateDirectories: false)
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: temporaryRoot.path)
        defer { try? fileManager.removeItem(at: temporaryRoot) }

        let extraction = runTool("/usr/bin/tar", ["-xzf", archive.path, "-C", temporaryRoot.path])
        guard extraction.status == 0 else {
            throw NSError(domain: "CLEKkDesktopControl", code: 12, userInfo: [
                NSLocalizedDescriptionKey: "无法展开桌面执行器安装包。",
            ])
        }
        let extracted = temporaryRoot
            .appendingPathComponent("cua-driver-rs-\(cuaDriverVersion)-darwin-universal", isDirectory: true)
            .appendingPathComponent("CuaDriver.app", isDirectory: true)
        guard isValidCuaDriverApp(extracted) else {
            throw NSError(domain: "CLEKkDesktopControl", code: 13, userInfo: [
                NSLocalizedDescriptionKey: "桌面执行器签名校验失败。",
            ])
        }

        let staged = URL(fileURLWithPath: "/Applications", isDirectory: true)
            .appendingPathComponent(".CuaDriver.clekk-\(suffix).app", isDirectory: true)
        let copy = runTool("/usr/bin/ditto", [extracted.path, staged.path])
        guard copy.status == 0, isValidCuaDriverApp(staged) else {
            try? fileManager.removeItem(at: staged)
            throw NSError(domain: "CLEKkDesktopControl", code: 14, userInfo: [
                NSLocalizedDescriptionKey: "无法把桌面执行器安装到应用程序文件夹。",
            ])
        }
        let backup = URL(fileURLWithPath: "/Applications", isDirectory: true)
            .appendingPathComponent(".CuaDriver.clekk-backup-\(suffix).app", isDirectory: true)
        do {
            if fileManager.fileExists(atPath: cuaDriverAppURL.path) {
                try fileManager.moveItem(at: cuaDriverAppURL, to: backup)
            }
            try fileManager.moveItem(at: staged, to: cuaDriverAppURL)
            try? fileManager.removeItem(at: backup)
        } catch {
            if !fileManager.fileExists(atPath: cuaDriverAppURL.path),
               fileManager.fileExists(atPath: backup.path) {
                try? fileManager.moveItem(at: backup, to: cuaDriverAppURL)
            }
            throw error
        }
        guard isValidCuaDriverApp(cuaDriverAppURL) else {
            throw NSError(domain: "CLEKkDesktopControl", code: 15, userInfo: [
                NSLocalizedDescriptionKey: "安装后的桌面执行器校验失败。",
            ])
        }
        let register = "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
        _ = runTool(register, ["-f", cuaDriverAppURL.path])
        _ = runTool(cuaDriverURL.path, ["telemetry", "disable"])
        return cuaDriverAppURL
    }
}

/// The node worker must receive the exact private endpoint started by this App.
/// Keeping it in process memory prevents a model or a stale shell from choosing
/// a different helper binary or socket.
private enum DesktopControlEndpoint {
    private static let lock = NSLock()
    private static var value: String?

    static func configure(driver: URL) throws -> URL {
        // sockaddr_un.sun_path is only 104 bytes on macOS.  Application Support
        // plus a UUID exceeds it on a typical user account, so keep the actual
        // socket in a random, owner-only short directory under /tmp.
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
        let directory = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("clekk-cua-\(suffix)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let socket = directory.appendingPathComponent("driver.sock")
        let payload: [String: Any] = [
            "v": 1,
            "socketPath": socket.path,
            "binaryPath": driver.path,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard let encoded = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "CLEKkDesktopControl", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "无法生成桌面执行器端点。",
            ])
        }
        lock.lock()
        value = encoded
        lock.unlock()
        return socket
    }

    static func environmentValue() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    static func clear(socket: URL?) {
        lock.lock()
        value = nil
        lock.unlock()
        guard let directory = socket?.deletingLastPathComponent() else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}

private final class LauncherWindow: NSWindow {
    // Borderless NSWindow instances are not key windows by default. The
    // dashboard contains text inputs, so it must be able to receive focus.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    // A borderless window can otherwise be dragged completely off-screen;
    // AppKit then keeps rendering a valid 1280px page while the user only sees
    // its right-hand slice. Always keep a small usable portion on the target
    // display, including after a resize or monitor change.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        var rect = super.constrainFrameRect(frameRect, to: screen)
        guard let visible = (screen ?? NSScreen.screens.first)?.visibleFrame else { return rect }
        if rect.width > visible.width { rect.size.width = visible.width }
        if rect.height > visible.height { rect.size.height = visible.height }
        rect.origin.x = min(max(rect.origin.x, visible.minX), visible.maxX - rect.width)
        rect.origin.y = min(max(rect.origin.y, visible.minY), visible.maxY - rect.height)
        return rect
    }
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
    enum ReadyRuntimeResult {
        case acceptExisting
        case restarted
        case failed
    }

    private struct ListenerProcess {
        let pid: pid_t
        let executablePath: String
        let executableIdentity: ExecutableIdentity
    }

    private struct ExecutableIdentity: Equatable {
        let device: UInt64
        let inode: UInt64
    }

    static let url = RuntimeConfig.gatewayURL
    // The gateway root is the upstream control-console landing page. CLE Kk
    // should always open the classic chat surface instead, while keeping the
    // root URL for health probes and service callbacks.
    static let defaultChatURL = url.appendingPathComponent("chat")
    private static var process: Process?
    private static var logHandle: FileHandle?
    private(set) static var lastError: String?
    private static let bundledNodeSuffix = "/Contents/Resources/SuperPinkie/runtime/bin/node"

    private static func endpoint(_ path: String) -> URL {
        url.appendingPathComponent(path)
    }

    private static func probe(_ path: String, timeout: TimeInterval = 1.2, completion: @escaping (HTTPURLResponse?, Data?) -> Void) {
        var request = URLRequest(url: endpoint(path))
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { data, response, _ in
            completion(response as? HTTPURLResponse, data)
        }.resume()
    }

    /// A reachable HTTP process is not necessarily usable: during OpenClaw's
    /// restart drain the port still answers while WebSocket/RPC admissions are
    /// closed. Keep these two meanings separate so the launcher never loads a
    /// chat page into a half-dead gateway.
    static func isReachable(completion: @escaping (Bool) -> Void) {
        probe("healthz") { response, _ in
            // Any HTTP response proves that a process owns the port.  503 is
            // especially meaningful here: OpenClaw can answer it while readyz
            // is false during a controlled drain.
            completion(response != nil)
        }
    }

    static func isReady(completion: @escaping (Bool) -> Void) {
        probe("readyz") { response, data in
            guard response?.statusCode == 200,
                  let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  object["ready"] as? Bool == true else {
                completion(false)
                return
            }
            completion(true)
        }
    }

    static func processAlive() -> Bool { process?.isRunning == true }

    private static func canonicalPath(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
    }

    private static func executablePath(for pid: pid_t) -> String? {
        // PROC_PIDPATHINFO_MAXSIZE is a C macro that Swift cannot import.
        // 4096 is its documented macOS capacity (4 * MAXPATHLEN).
        var buffer = [CChar](repeating: 0, count: 4096)
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        let end = buffer.firstIndex(of: 0) ?? buffer.endIndex
        return String(decoding: buffer[..<end].map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    private static func lsofOutput(_ arguments: [String]) -> String? {
        let lsof = URL(fileURLWithPath: "/usr/sbin/lsof")
        guard FileManager.default.isExecutableFile(atPath: lsof.path) else { return nil }
        let task = Process()
        let output = Pipe()
        task.executableURL = lsof
        task.arguments = arguments
        task.standardOutput = output
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            let data = (try? output.fileHandleForReading.readToEnd()) ?? Data()
            task.waitUntilExit()
            guard task.terminationStatus == 0,
                  let text = String(data: data, encoding: .utf8) else { return nil }
            return text
        } catch {
            return nil
        }
    }

    private static func listenerPIDs(port: Int) -> [pid_t] {
        // -F p emits machine-readable records such as `p1234`. Restrict the
        // query to listening TCP sockets so an ordinary client is never used.
        guard let text = lsofOutput(["-nP", "-a", "-iTCP:\(port)", "-sTCP:LISTEN", "-Fp"]) else {
            return []
        }
        return Array(Set(text.split(separator: "\n").compactMap { line -> pid_t? in
            guard line.first == "p", let value = Int32(line.dropFirst()), value > 1 else { return nil }
            return value
        })).sorted()
    }

    private static func diskIdentity(for executablePath: String) -> ExecutableIdentity? {
        var info = Darwin.stat()
        let status = executablePath.withCString { Darwin.lstat($0, &info) }
        guard status == 0 else { return nil }
        return ExecutableIdentity(device: UInt64(info.st_dev), inode: UInt64(info.st_ino))
    }

    private static func mappedExecutableIdentity(for pid: pid_t, matching executablePath: String) -> ExecutableIdentity? {
        // A bundle can be replaced at the same pathname while its old process
        // keeps the old executable vnode mapped. proc_pidpath alone cannot see
        // that difference, so read lsof's device + inode fields for the mapped
        // text vnode and compare them with the file now on disk.
        guard let text = lsofOutput(["-nP", "-a", "-p", String(pid), "-d", "txt", "-FDin"]) else {
            return nil
        }
        var device: UInt64?
        var inode: UInt64?
        var name: String?

        func matchedRecord() -> ExecutableIdentity? {
            guard let device, let inode, let name,
                  canonicalPath(name) == executablePath else { return nil }
            return ExecutableIdentity(device: device, inode: inode)
        }

        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            switch line.first {
            case "f":
                if let identity = matchedRecord() { return identity }
                device = nil
                inode = nil
                name = nil
            case "D":
                let raw = String(line.dropFirst())
                if raw.lowercased().hasPrefix("0x") {
                    device = UInt64(raw.dropFirst(2), radix: 16)
                } else {
                    device = UInt64(raw)
                }
            case "i":
                inode = UInt64(line.dropFirst())
            case "n":
                name = String(line.dropFirst())
            default:
                continue
            }
        }
        return matchedRecord()
    }

    private static func listenerProcesses() -> [ListenerProcess] {
        let host = (url.host ?? "").lowercased()
        guard host == "127.0.0.1" || host == "localhost" || host == "::1" else { return [] }
        return listenerPIDs(port: url.port ?? 18789).compactMap { pid in
            guard let executable = executablePath(for: pid) else { return nil }
            let path = canonicalPath(executable)
            guard let identity = mappedExecutableIdentity(for: pid, matching: path) else { return nil }
            return ListenerProcess(pid: pid, executablePath: path, executableIdentity: identity)
        }
    }

    private static func isCLEKkBundledNode(_ executablePath: String) -> Bool {
        // This exact private bundle layout is the provenance marker. Never
        // classify a system Node, Homebrew Node, or another product's helper
        // as ours merely because its process title says `openclaw-gateway`.
        executablePath.contains(".app" + bundledNodeSuffix)
            && executablePath.hasSuffix(bundledNodeSuffix)
    }

    private static func stillSameProcess(_ listener: ListenerProcess) -> Bool {
        guard let current = executablePath(for: listener.pid),
              canonicalPath(current) == listener.executablePath,
              let identity = mappedExecutableIdentity(for: listener.pid, matching: listener.executablePath) else {
            return false
        }
        return identity == listener.executableIdentity
    }

    private static func stopStaleListener(_ listener: ListenerProcess) -> Bool {
        // Re-check both the socket owner and executable immediately before the
        // signal. This prevents PID reuse from ever targeting an unrelated app.
        guard listenerPIDs(port: url.port ?? 18789).contains(listener.pid),
              stillSameProcess(listener) else { return true }
        guard Darwin.kill(listener.pid, SIGTERM) == 0 else { return false }
        let gracefulDeadline = Date().addingTimeInterval(2.5)
        while Date() < gracefulDeadline && stillSameProcess(listener) {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if stillSameProcess(listener) {
            // SIGKILL is allowed only after another exact executable check.
            guard Darwin.kill(listener.pid, SIGKILL) == 0 else { return false }
        }
        let reapDeadline = Date().addingTimeInterval(1.5)
        while Date() < reapDeadline && stillSameProcess(listener) {
            Thread.sleep(forTimeInterval: 0.05)
        }
        return !stillSameProcess(listener)
    }

    /// A previous release intentionally leaves its gateway alive across App
    /// replacement. Reusing that process would keep old plugins and old retry
    /// logic even though the visible App is new. Replace only a listener whose
    /// executable proves it came from another CLE Kk App bundle; unknown
    /// listeners are never signalled.
    static func ensureCurrentRuntimeForReadyGateway(completion: @escaping (ReadyRuntimeResult) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let expectedNode = BundledRuntime.nodeURL.map({ canonicalPath($0.path) }),
                  let expectedIdentity = diskIdentity(for: expectedNode) else {
                DispatchQueue.main.async { completion(.acceptExisting) }
                return
            }
            let stale = listenerProcesses().filter {
                isCLEKkBundledNode($0.executablePath)
                    && ($0.executablePath != expectedNode || $0.executableIdentity != expectedIdentity)
            }
            guard !stale.isEmpty else {
                DispatchQueue.main.async { completion(.acceptExisting) }
                return
            }
            guard stale.allSatisfy({ stopStaleListener($0) }) else {
                lastError = "旧版 CLE Kk 网关仍占用端口，没有误杀其他进程。"
                DispatchQueue.main.async { completion(.failed) }
                return
            }
            DispatchQueue.main.async {
                NSLog("[CLE Kk] replaced stale bundled gateway from: %@",
                      stale.map(\.executablePath).joined(separator: ", "))
                start()
                completion(process?.isRunning == true ? .restarted : .failed)
            }
        }
    }

    static func start() {
        guard process?.isRunning != true else { return }
        let task = Process()
        if BundledRuntime.exists(BundledRuntime.nodeURL),
           let node = BundledRuntime.nodeURL,
           let entry = BundledRuntime.openClawEntryURL,
           FileManager.default.fileExists(atPath: entry.path) {
            task.executableURL = node
            task.arguments = [entry.path, "gateway", "run", "--port", String(url.port ?? 18789), "--allow-unconfigured"]
        } else if let external = ["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"]
            .map(URL.init(fileURLWithPath:))
            .first(where: { BundledRuntime.exists($0) }) {
            task.executableURL = external
            task.arguments = ["gateway", "run", "--port", String(url.port ?? 18789), "--allow-unconfigured"]
        } else {
            lastError = "App 包内的网关运行时不完整。"
            return
        }
        var gatewayEnvironment = BundledRuntime.environment()
        gatewayEnvironment["OPENCLAW_SERVICE_KIND"] = "gateway"
        if let entry = BundledRuntime.openClawEntryURL {
            gatewayEnvironment["PINKIE_OPENCLAW_ENTRY"] = entry.path
        }
        task.environment = gatewayEnvironment
        let output = BundledRuntime.logHandle(named: "gateway")
        task.standardOutput = output ?? FileHandle.nullDevice
        task.standardError = output ?? FileHandle.nullDevice
        task.terminationHandler = { stopped in
            if stopped.terminationStatus != 0 {
                lastError = "网关退出，状态码 \(stopped.terminationStatus)。详情保存在 SuperPinkie/logs/gateway.log。"
            }
        }
        do {
            try task.run()
            process = task
            logHandle = output
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    static func ready(attempt: Int = 0, completion: @escaping (Bool) -> Void) {
        isReady { running in
            DispatchQueue.main.async {
                if running || attempt >= 360 {
                    completion(running)
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    ready(attempt: attempt + 1, completion: completion)
                }
            }
        }
    }

    static func stop() {
        // A gateway can spend minutes in restart drain after terminate(). If
        // the Launcher exits first, that child is re-parented and the next App
        // launch reconnects to a stale gateway carrying a dead CUA socket.
        // Reap only the exact Process this App started, with a bounded grace.
        let ownedProcess = process
        process = nil
        try? logHandle?.close()
        logHandle = nil
        guard let ownedProcess else { return }
        if ownedProcess.isRunning { ownedProcess.terminate() }
        let deadline = Date().addingTimeInterval(2.0)
        while ownedProcess.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if ownedProcess.isRunning {
            Darwin.kill(ownedProcess.processIdentifier, SIGKILL)
        }
        ownedProcess.waitUntilExit()
    }

    static func repair() {
        // Never terminate a live gateway from a 2-second UI probe. A live
        // process may only be draining/rebuilding its transcript; killing it
        // here creates another drain and can hide a completed reply for five
        // minutes. If our child really exited, start it again.
        guard process?.isRunning != true else { return }
        start()
    }
}

/// Owns the complete macOS computer-control chain. The notarized helper is
/// launched through LaunchServices so macOS can attach Screen Recording and
/// Accessibility to its stable identity. The OpenClaw mode extension consumes
/// this private endpoint directly as the `computer` tool; no extra node pairing
/// or second gateway transport is required.
private final class DesktopControlService {
    private static let displayName = "超級碧琪桌面控制"
    private static let driverBundleIdentifier = "com.trycua.driver"

    private var driverProcess: Process?
    private var nodeProcess: Process?
    private var driverLog: FileHandle?
    private var nodeLog: FileHandle?
    private var socketURL: URL?
    private var generation = 0
    private var stopping = false
    private var pairingProbe: DispatchWorkItem?
    private(set) var lastError: String?

    /// Process.terminate() is only a request.  The node host has previously
    /// ignored SIGTERM while blocked in a gateway reconnect, so every shutdown
    /// is bounded and reaped before a replacement is launched.
    private static func stopAndReap(
        _ entries: [(process: Process, interruptFirst: Bool)],
        timeout: TimeInterval = 1.5
    ) {
        for entry in entries where entry.process.isRunning {
            if entry.interruptFirst {
                entry.process.interrupt()
            } else {
                entry.process.terminate()
            }
        }
        let deadline = Date().addingTimeInterval(timeout)
        while entries.contains(where: { $0.process.isRunning }) && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        for entry in entries where entry.process.isRunning {
            Darwin.kill(entry.process.processIdentifier, SIGKILL)
        }
        for entry in entries {
            entry.process.waitUntilExit()
        }
    }

    /// The `open -W` process below is only a LaunchServices waiter. Stopping
    /// that waiter does not necessarily stop the app it launched, so terminate
    /// the stable driver identity explicitly when CLE Kk closes or restarts it.
    private static func stopDriverApplications(timeout: TimeInterval = 1.5) {
        let applications = NSRunningApplication.runningApplications(
            withBundleIdentifier: driverBundleIdentifier
        )
        for application in applications where !application.isTerminated {
            _ = application.terminate()
        }
        let deadline = Date().addingTimeInterval(timeout)
        while applications.contains(where: { !$0.isTerminated }) && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        for application in applications where !application.isTerminated {
            _ = application.forceTerminate()
        }
    }

    func start() {
        stopping = false
        guard driverProcess?.isRunning != true else { return }
        startDriver()
    }

    func stop() {
        stopping = true
        generation += 1
        pairingProbe?.cancel()
        pairingProbe = nil

        let node = nodeProcess
        nodeProcess = nil
        try? nodeLog?.close()
        nodeLog = nil

        let driver = driverProcess
        driverProcess = nil
        try? driverLog?.close()
        driverLog = nil

        DesktopControlEndpoint.clear(socket: socketURL)
        socketURL = nil

        Self.stopDriverApplications()
        var entries: [(process: Process, interruptFirst: Bool)] = []
        if let node { entries.append((node, true)) }
        if let driver { entries.append((driver, false)) }
        Self.stopAndReap(entries)
    }

    private func startDriver() {
        do {
            _ = try BundledRuntime.ensureCuaDriverApp()
        } catch {
            lastError = error.localizedDescription
            NSLog("[CLE Kk computer] helper install failed: %@", error.localizedDescription)
            return
        }
        let driver = BundledRuntime.cuaDriverURL
        guard !stopping,
              FileManager.default.fileExists(atPath: BundledRuntime.cuaDriverAppURL.path),
              BundledRuntime.exists(driver) else {
            lastError = "缺少 CLE Kk 桌面执行器，请重新安装当前定版。"
            NSLog("[CLE Kk computer] %@", lastError ?? "桌面执行器缺失")
            return
        }

        generation += 1
        let currentGeneration = generation
        do {
            socketURL = try DesktopControlEndpoint.configure(driver: driver)
        } catch {
            lastError = error.localizedDescription
            NSLog("[CLE Kk computer] endpoint setup failed: %@", error.localizedDescription)
            return
        }
        guard let socketURL else { return }

        // LaunchServices is mandatory here: it attributes Accessibility and
        // Screen Recording to the stable, notarized com.trycua.driver app.
        // Spawning the same Mach-O directly makes macOS attribute it as an
        // unrelated command-line helper and silently breaks capture/input.
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        task.arguments = [
            "-W", "-n", "-g",
            "--env", "CUA_DRIVER_RS_TELEMETRY_ENABLED=false",
            "--env", "CUA_DRIVER_RS_UPDATE_CHECK=false",
            BundledRuntime.cuaDriverAppURL.path,
            "--args", "serve",
            "--embedded",
            "--socket", socketURL.path,
            "--dangerously-bypass-approvals",
            "--host-bundle-id", Bundle.main.bundleIdentifier ?? "com.cle0726.super-pinkie",
        ]
        task.environment = BundledRuntime.environment()
        let output = BundledRuntime.logHandle(named: "computer-control-driver")
        task.standardOutput = output ?? FileHandle.nullDevice
        task.standardError = output ?? FileHandle.nullDevice
        task.terminationHandler = { [weak self] stopped in
            DispatchQueue.main.async {
                self?.driverDidExit(stopped, generation: currentGeneration)
            }
        }
        do {
            try task.run()
            driverProcess = task
            driverLog = output
            lastError = nil
            waitForDriverSocket(generation: currentGeneration)
        } catch {
            try? output?.close()
            DesktopControlEndpoint.clear(socket: socketURL)
            self.socketURL = nil
            lastError = error.localizedDescription
            NSLog("[CLE Kk computer] driver launch failed: %@", error.localizedDescription)
        }
    }

    private func waitForDriverSocket(generation expectedGeneration: Int, attempt: Int = 0) {
        guard !stopping, generation == expectedGeneration else { return }
        let type = socketURL.flatMap {
            try? FileManager.default.attributesOfItem(atPath: $0.path)[.type] as? FileAttributeType
        }
        if type == .typeSocket, driverProcess?.isRunning == true {
            // OpenClaw 2026.7's node host does not publish computer.act from
            // OPENCLAW_CUA_DRIVER_ENDPOINT and repeatedly asks for capability
            // reapproval. The in-gateway computer tool uses this socket
            // directly, so starting that legacy node would only add a failing
            // reconnect loop.
            lastError = nil
            return
        }
        guard attempt < 120, driverProcess?.isRunning == true else {
            lastError = "桌面执行器没有建立私有连接。"
            if driverProcess?.isRunning == true { driverProcess?.terminate() }
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.waitForDriverSocket(generation: expectedGeneration, attempt: attempt + 1)
        }
    }

    private func startNodeIfReady() {
        guard !stopping,
              driverProcess?.isRunning == true,
              nodeProcess?.isRunning != true,
              DesktopControlEndpoint.environmentValue() != nil,
              let node = BundledRuntime.nodeURL,
              let entry = BundledRuntime.openClawEntryURL,
              BundledRuntime.exists(node),
              FileManager.default.fileExists(atPath: entry.path) else { return }

        let task = Process()
        task.executableURL = node
        var arguments = [
            entry.path,
            "node", "run",
            "--host", Gateway.url.host ?? "127.0.0.1",
            "--port", String(Gateway.url.port ?? 18789),
            "--display-name", Self.displayName,
        ]
        // OpenClaw 2026.7 exposes installed apps automatically through the
        // CUA endpoint. `--share-installed-apps` and `--no-tls` belong to a
        // newer node CLI; either one makes this pinned node exit immediately.
        if Gateway.url.scheme == "https" { arguments.append("--tls") }
        task.arguments = arguments
        var environment = BundledRuntime.environment()
        environment["OPENCLAW_SERVICE_KIND"] = "node"
        environment["PINKIE_OPENCLAW_ENTRY"] = entry.path
        task.environment = environment
        let output = BundledRuntime.logHandle(named: "computer-control-node")
        task.standardOutput = output ?? FileHandle.nullDevice
        task.standardError = output ?? FileHandle.nullDevice
        let currentGeneration = generation
        task.terminationHandler = { [weak self] stopped in
            DispatchQueue.main.async {
                self?.nodeDidExit(stopped, generation: currentGeneration)
            }
        }
        do {
            try task.run()
            nodeProcess = task
            nodeLog = output
            lastError = nil
            inspectPairing(attempt: 0, generation: currentGeneration)
        } catch {
            try? output?.close()
            lastError = error.localizedDescription
            NSLog("[CLE Kk computer] node launch failed: %@", error.localizedDescription)
        }
    }

    private func driverDidExit(_ task: Process, generation exitedGeneration: Int) {
        guard driverProcess === task else { return }
        driverProcess = nil
        try? driverLog?.close()
        driverLog = nil
        let node = nodeProcess
        nodeProcess = nil
        try? nodeLog?.close()
        nodeLog = nil
        DesktopControlEndpoint.clear(socket: socketURL)
        socketURL = nil
        guard !stopping, generation == exitedGeneration else { return }
        lastError = "桌面执行器意外退出（状态码 \(task.terminationStatus)），正在自动恢复。"
        DispatchQueue.global(qos: .utility).async { [weak self] in
            if let node { Self.stopAndReap([(node, true)]) }
            DispatchQueue.main.async {
                guard let self,
                      !self.stopping,
                      self.generation == exitedGeneration else { return }
                self.startDriver()
            }
        }
    }

    private func nodeDidExit(_ task: Process, generation exitedGeneration: Int) {
        guard nodeProcess === task else { return }
        nodeProcess = nil
        try? nodeLog?.close()
        nodeLog = nil
        guard !stopping,
              generation == exitedGeneration,
              driverProcess?.isRunning == true else { return }
        lastError = "桌面控制节点意外退出（状态码 \(task.terminationStatus)），正在自动恢复。"
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.startNodeIfReady()
        }
    }

    /// A new command surface forces one Gateway reapproval. Match the pending
    /// request to this machine's cryptographic node identity and both required
    /// computer commands; display names are mutable and are not an authority.
    /// Keep probing until the authoritative Gateway status is truly usable.
    private func inspectPairing(
        attempt: Int,
        generation expectedGeneration: Int,
        nodeID cachedNodeID: String? = nil
    ) {
        guard !stopping, generation == expectedGeneration else { return }
        pairingProbe?.cancel()
        let item = DispatchWorkItem { [weak self] in
            let nodeID = cachedNodeID ?? Self.localNodeID()
            if Self.computerReady(nodeID: nodeID) {
                DispatchQueue.main.async {
                    guard let self,
                          !self.stopping,
                          self.generation == expectedGeneration else { return }
                    self.lastError = nil
                    self.pairingProbe = nil
                }
                return
            }
            let deviceRequestID = Self.pendingDeviceRequestID(nodeID: nodeID)
            let nodeRequestID = Self.pendingNodeRequestID(nodeID: nodeID)
            let approved: Bool
            if let requestID = deviceRequestID {
                // OpenClaw 2026.7 represents a node role upgrade in the
                // device pairing queue, not in `nodes pending`.
                approved = Self.runOpenClaw([
                    "devices", "approve", requestID, "--timeout", "5000",
                ]).status == 0
            } else if let requestID = nodeRequestID {
                // Keep compatibility with runtimes that expose the older node
                // pairing queue and include command capabilities up front.
                approved = Self.runOpenClaw([
                    "nodes", "approve", requestID, "--timeout", "5000",
                ]).status == 0
            } else {
                approved = false
            }
            DispatchQueue.main.async {
                guard let self,
                      !self.stopping,
                      self.generation == expectedGeneration else { return }
                if approved {
                    self.lastError = nil
                    // The Gateway applies the expanded command surface on the
                    // next connection. SIGINT gives the node a clean restart.
                    if let node = self.nodeProcess {
                        DispatchQueue.global(qos: .utility).async {
                            Self.stopAndReap([(node, true)])
                        }
                    }
                    return
                }
                if attempt >= 10 {
                    self.lastError = "桌面控制节点尚未就绪，正在继续自动重连。"
                }
                self.inspectPairing(
                    attempt: min(attempt + 1, 10_000),
                    generation: expectedGeneration,
                    nodeID: nodeID
                )
            }
        }
        pairingProbe = item
        let delay = attempt < 10 ? 0.5 : 2.0
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay, execute: item)
    }

    private static func localNodeID() -> String? {
        let result = runOpenClaw(["node", "identity", "--json"])
        guard result.status == 0,
              let object = try? JSONSerialization.jsonObject(with: result.data) as? [String: Any],
              let deviceID = object["deviceId"] as? String,
              !deviceID.isEmpty else { return nil }
        return deviceID
    }

    private static func computerReady(nodeID: String?) -> Bool {
        let result = runOpenClaw(["nodes", "status", "--connected", "--json", "--timeout", "3000"])
        guard result.status == 0,
              let object = try? JSONSerialization.jsonObject(with: result.data) as? [String: Any],
              let rows = object["nodes"] as? [[String: Any]] else { return false }
        return rows.contains(where: { row in
            let commands = Set((row["commands"] as? [String]) ?? [])
            let sameNode = nodeID.map { row["nodeId"] as? String == $0 }
                ?? (row["displayName"] as? String == displayName)
            return sameNode
                && row["connected"] as? Bool == true
                && commands.contains("computer.act")
                && commands.contains("screen.snapshot")
        })
    }

    private static func pendingDeviceRequestID(nodeID: String?) -> String? {
        let result = runOpenClaw(["devices", "list", "--json", "--timeout", "3000"])
        guard result.status == 0,
              let object = try? JSONSerialization.jsonObject(with: result.data) as? [String: Any],
              let rows = object["pending"] as? [[String: Any]] else { return nil }
        return rows.first(where: { row in
            let platform = (row["platform"] as? String)?.lowercased() ?? ""
            let role = (row["role"] as? String)?.lowercased() ?? ""
            let sameNode = nodeID.map { row["deviceId"] as? String == $0 }
                ?? (row["displayName"] as? String == displayName
                    && row["clientId"] as? String == "node-host")
            return sameNode
                && role == "node"
                && (platform.hasPrefix("macos") || platform.hasPrefix("darwin"))
        })?["requestId"] as? String
    }

    private static func pendingNodeRequestID(nodeID: String?) -> String? {
        let result = runOpenClaw(["nodes", "pending", "--json", "--timeout", "3000"])
        guard result.status == 0,
              let rows = try? JSONSerialization.jsonObject(with: result.data) as? [[String: Any]] else { return nil }
        return rows.first(where: { row in
            let platform = (row["platform"] as? String)?.lowercased() ?? ""
            let commands = Set((row["commands"] as? [String]) ?? [])
            let sameNode = nodeID.map { row["nodeId"] as? String == $0 }
                ?? (row["displayName"] as? String == displayName)
            return sameNode
                && (platform.hasPrefix("macos") || platform.hasPrefix("darwin"))
                && commands.contains("computer.act")
                && commands.contains("screen.snapshot")
        })?["requestId"] as? String
    }

    private static func runOpenClaw(_ arguments: [String]) -> (status: Int32, data: Data) {
        guard let node = BundledRuntime.nodeURL,
              let entry = BundledRuntime.openClawEntryURL,
              BundledRuntime.exists(node),
              FileManager.default.fileExists(atPath: entry.path) else { return (-1, Data()) }
        let task = Process()
        let output = Pipe()
        task.executableURL = node
        task.arguments = [entry.path] + arguments
        task.environment = BundledRuntime.environment()
        task.standardOutput = output
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            task.waitUntilExit()
            return (task.terminationStatus, output.fileHandleForReading.readDataToEndOfFile())
        } catch {
            return (-1, Data())
        }
    }
}

private final class PartyService {
    static let url = URL(string: "http://127.0.0.1:18889/")!
    private var process: Process?

    func start() {
        guard process?.isRunning != true,
              let root = BundledRuntime.resourceRoot,
              let python = BundledRuntime.pythonExecutable() else { return }
        let task = Process()
        task.executableURL = python
        task.arguments = [root.appendingPathComponent("services/party/server.py").path]
        var environment = BundledRuntime.environment()
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
              let root = BundledRuntime.resourceRoot,
              let python = BundledRuntime.pythonExecutable() else { return }
        let task = Process()
        task.executableURL = python
        task.arguments = [root.appendingPathComponent("services/roundtable/server.py").path]
        var environment = BundledRuntime.environment()
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

private final class TTSService {
    static let healthURL = URL(string: "http://127.0.0.1:18888/health")!
    private var process: Process?

    func start() {
        guard process?.isRunning != true,
              let root = BundledRuntime.resourceRoot,
              let python = BundledRuntime.pythonExecutable() else { return }
        let task = Process()
        task.executableURL = python
        task.arguments = [root.appendingPathComponent("services/tts/edge_tts_server.py").path]
        task.environment = BundledRuntime.environment()
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do { try task.run(); process = task } catch { NSLog("语音服务无法启动：%@", error.localizedDescription) }
    }

    func stop() { if process?.isRunning == true { process?.terminate() } }

    func ready(attempt: Int = 0, completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: Self.healthURL)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let ready = (response as? HTTPURLResponse)?.statusCode == 200
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
        var environment = BundledRuntime.environment()
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
        // Do not occupy ⌘R. Users naturally use it to reload a stuck chat;
        // binding it to Roundtable made a normal refresh look like the App
        // had started or jumped to the wrong page.
        let roundtableItem = appMenu.addItem(withTitle: "打开灵感圆桌", action: #selector(AppDelegate.openRoundtable(_:)), keyEquivalent: "")
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
    private var startupVideoStartedAt: Date?
    private var dashboardLoadPending = false
    private var gatewayMonitor: Timer?
    private var gatewayProbeFailures = 0
    private var gatewayProbeInFlight = false
    private let dictation = NativeDictationController()
    private let dictationHandlerName = "laolaoNativeDictation"
    private let liveSpeech = NativeLiveSpeechController()
    private let liveSpeechHandlerName = "laolaoLiveVoice"
    private let projectFolderHandlerName = "laolaoProjectFolder"
    private let updateHandlerName = "laolaoUpdate"
    private var updateLaunchInProgress = false
    private let party = PartyService()
    private let roundtable = RoundtableService()
    private let tts = TTSService()
    private let desktopControl = DesktopControlService()

    @objc func openParty(_ sender: Any?) {
        party.ready { [weak self] ready in
            if ready {
                self?.dictation.stop()
                self?.liveSpeech.stop()
                self?.webView?.load(URLRequest(url: PartyService.url))
            } else {
                let alert = NSAlert()
                alert.messageText = "派对服务还没准备好"
                alert.informativeText = "App 内置服务没有启动成功，请确认端口 18889 没有被其他程序占用。原来的四模式聊天不受影响。"
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
                alert.informativeText = "App 内置服务没有启动成功，请确认端口 18891 没有被其他程序占用。其他聊天不会受影响。"
                alert.runModal()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        gatewayMonitor?.invalidate()
        gatewayMonitor = nil
        tts.stop()
        party.stop()
        roundtable.stop()
        desktopControl.stop()
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

    private func clampWindowToVisibleScreen() {
        guard let window, let visible = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return }
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
        guard !updateLaunchInProgress else { return }
        let confirmation = NSAlert()
        confirmation.messageText = "主动拉取 CLE Kk 更新？"
        confirmation.informativeText = "确认后旧 App 会退出。独立更新程序会继续拉取、安装并重新打开；期间网关重启或页面断开都不会中止更新。人格、会话、项目、图片和视频不会参与替换。"
        confirmation.alertStyle = .informational
        confirmation.addButton(withTitle: "拉取并更新")
        confirmation.addButton(withTitle: "取消")
        guard confirmation.runModal() == .alertFirstButtonReturn else { return }

        guard let root = BundledRuntime.resourceRoot else { return }
        let bundledScript = root.appendingPathComponent("installer/macos/detached-update.sh")
        let stateRoot = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SuperPinkie", isDirectory: true)
        let updateRoot = stateRoot.appendingPathComponent("updates", isDirectory: true)
        let helper = updateRoot.appendingPathComponent("manual-update.sh")
        let task = Process()
        do {
            try FileManager.default.createDirectory(at: updateRoot, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: helper.path) {
                try FileManager.default.removeItem(at: helper)
            }
            try FileManager.default.copyItem(at: bundledScript, to: helper)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
        } catch {
            let alert = NSAlert(error: error)
            alert.runModal()
            return
        }

        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = [helper.path, String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundleURL.path]
        task.environment = BundledRuntime.environment()
        task.standardInput = FileHandle.nullDevice
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            updateLaunchInProgress = true
            notifyWebView("pinkie:update-detached")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                NSApp.terminate(nil)
            }
        } catch {
            let alert = NSAlert(error: error)
            alert.runModal()
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
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
        window.minSize = NSSize(width: 860, height: 580)
        window.setFrame(window.constrainFrameRect(rect, to: NSScreen.main), display: false)
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: dictationHandlerName)
        configuration.userContentController.add(self, name: liveSpeechHandlerName)
        configuration.userContentController.add(self, name: projectFolderHandlerName)
        configuration.userContentController.add(self, name: updateHandlerName)
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

        showStartupScreen()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            BundledSetup.apply()
            DispatchQueue.main.async {
                self?.startBundledServices()
            }
        }
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

    private func loadDashboard() {
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
        webView?.load(URLRequest(url: Gateway.defaultChatURL))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        guard webView.url?.host == Gateway.url.host, webView.url?.port == Gateway.url.port else { return }
        // WebKit 导航结束后仍保持透明，避免重新加载时把系统玻璃背景盖成实心粉色。
        window?.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
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
        if message.name == updateHandlerName { checkForUpdates(nil); return }
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
          new MutationObserver(() => { ensureButton(); ensureUpdateButton(); })
            .observe(document.documentElement, { childList: true, subtree: true });
        })();
        """#
    }
}
