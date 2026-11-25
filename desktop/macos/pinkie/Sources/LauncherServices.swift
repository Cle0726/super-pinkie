// macOS 本地语音听写/播报控制器、桌面操控（Cua）、派对/圆桌/TTS 子服务守护与独立更新进度面板。
import AppKit
import AVFoundation
import CommonCrypto
import Darwin
import Foundation
import Speech
import UserNotifications
import WebKit

/* WebKit on macOS does not provide a dependable Web Speech recognition path.
   Use the system recognizer directly instead, while leaving sending entirely
   under the user's control. */
final class NativeDictationController {
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
                        self.send(state: "error", message: "听写刚刚断开啦，再点一次试试。")
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
final class NativeLiveSpeechController: NSObject, AVAudioPlayerDelegate {
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

/// Owns the complete macOS computer-control chain. The notarized helper is
/// launched through LaunchServices so macOS can attach Screen Recording and
/// Accessibility to its stable identity. The OpenClaw mode extension consumes
/// this private endpoint directly as the `computer` tool; no extra node pairing
/// or second gateway transport is required.
final class DesktopControlService {
    private static let displayName = "超級碧琪桌面控制"
    private static let driverBundleIdentifier = "com.trycua.driver"
    private static let hostBundleIdentifier = "com.cle0726.super-pinkie"

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

    private static func executablePath(for pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: 4096)
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        let end = buffer.firstIndex(of: 0) ?? buffer.endIndex
        return String(decoding: buffer[..<end].map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    private static func processCommand(for pid: pid_t) -> String? {
        let task = Process()
        let output = Pipe()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-p", String(pid), "-o", "command="]
        task.standardOutput = output
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            let data = (try? output.fileHandleForReading.readToEnd()) ?? Data()
            task.waitUntilExit()
            guard task.terminationStatus == 0 else { return nil }
            return String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return nil
        }
    }

    private static func isCLEKkDriver(_ pid: pid_t, socketPath: String? = nil) -> Bool {
        guard pid > 1,
              let executable = executablePath(for: pid),
              URL(fileURLWithPath: executable).standardizedFileURL.resolvingSymlinksInPath().path
                == BundledRuntime.cuaDriverURL.standardizedFileURL.resolvingSymlinksInPath().path,
              let command = processCommand(for: pid),
              command.contains("serve --embedded"),
              command.contains("--host-bundle-id \(hostBundleIdentifier)"),
              command.contains("--socket /tmp/clekk-cua-") else {
            return false
        }
        return socketPath.map { command.contains("--socket \($0)") } ?? true
    }

    private static func cleKkDriverPIDs() -> [pid_t] {
        NSRunningApplication.runningApplications(withBundleIdentifier: driverBundleIdentifier)
            .map(\.processIdentifier)
            .filter { isCLEKkDriver($0) }
    }

    /// `open -W` is only a LaunchServices waiter; the real driver is reparented
    /// and can survive an App crash. Stop only CuaDriver processes carrying
    /// CLE Kk's private socket prefix + host bundle id. Other apps' CuaDriver
    /// sessions are never signalled.
    private static func stopCLEKkDrivers(socketPath: String? = nil, timeout: TimeInterval = 1.5) {
        let targets = (socketPath == nil ? cleKkDriverPIDs() : cleKkDriverPIDs().filter {
            isCLEKkDriver($0, socketPath: socketPath)
        })
        for pid in targets where isCLEKkDriver(pid, socketPath: socketPath) {
            _ = Darwin.kill(pid, SIGTERM)
        }
        let deadline = Date().addingTimeInterval(timeout)
        while targets.contains(where: { isCLEKkDriver($0, socketPath: socketPath) }) && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        for pid in targets where isCLEKkDriver(pid, socketPath: socketPath) {
            _ = Darwin.kill(pid, SIGKILL)
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

        let activeSocket = socketURL
        DesktopControlEndpoint.clear(socket: activeSocket)
        socketURL = nil

        Self.stopCLEKkDrivers(socketPath: activeSocket?.path)
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
            lastError = "缺少 C.le. 桌面执行器，请重新安装当前定版。"
            NSLog("[CLE Kk computer] %@", lastError ?? "桌面执行器缺失")
            return
        }

        // A previous Launcher may have exited before LaunchServices reaped its
        // helper. Remove only CLE Kk-owned orphan drivers before creating the
        // new private endpoint, otherwise identical helpers race for macOS TCC
        // permissions and one of them keeps an obsolete socket.
        Self.stopCLEKkDrivers()

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
            "--host-bundle-id", Bundle.main.bundleIdentifier ?? Self.hostBundleIdentifier,
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

final class PartyService {
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

final class RoundtableService {
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

final class TTSService {
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

/// Stays on screen after the main App exits, while the updater replaces the bundle.
/// Launched as a copy of this executable so deleting /Applications/超級碧琪.app does not kill it.
enum UpdateProgressHold {
    static var controller: UpdateProgressController?
}

final class UpdateProgressController: NSObject, NSApplicationDelegate {
    let file: URL
    let started = Date()
    private var panel: NSPanel?
    private var line: NSTextField?
    private var clock: NSTextField?
    private var steps: [NSTextField] = []
    private var holdUntil: Date?
    private let names = ["退出", "拉取", "打包", "换上", "打开"]

    init(file: URL) { self.file = file }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 168),
            styleMask: [.titled, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.title = "超級碧琪更新"
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.center()
        let content = NSView(frame: panel.contentView?.bounds ?? .zero)
        content.autoresizingMask = [.width, .height]
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor(srgbRed: 1, green: 0.973, blue: 0.984, alpha: 1).cgColor

        let title = label("碧琪正在换上新版", size: 18, bold: true, color: NSColor(srgbRed: 0.43, green: 0.23, blue: 0.34, alpha: 1))
        title.frame = NSRect(x: 22, y: 118, width: 396, height: 28)
        let line = label("正在退出旧版本", size: 13, bold: false, color: NSColor(srgbRed: 0.54, green: 0.35, blue: 0.45, alpha: 1))
        line.frame = NSRect(x: 22, y: 90, width: 300, height: 22)
        let clock = label("已用 0 秒", size: 12, bold: false, color: NSColor(srgbRed: 0.69, green: 0.48, blue: 0.58, alpha: 1))
        clock.alignment = .right
        clock.frame = NSRect(x: 300, y: 90, width: 118, height: 22)
        content.addSubview(title)
        content.addSubview(line)
        content.addSubview(clock)
        var stepLabels: [NSTextField] = []
        for (index, name) in names.enumerated() {
            let item = label(name, size: 12, bold: index == 0, color: NSColor(srgbRed: 0.76, green: 0.36, blue: 0.54, alpha: 1))
            item.alignment = .center
            item.frame = NSRect(x: 16 + index * 82, y: 28, width: 78, height: 20)
            content.addSubview(item)
            stepLabels.append(item)
        }
        panel.contentView?.addSubview(content)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.panel = panel
        self.line = line
        self.clock = clock
        self.steps = stepLabels
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    private func label(_ text: String, size: CGFloat, bold: Bool, color: NSColor) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = bold ? .systemFont(ofSize: size, weight: .bold) : .systemFont(ofSize: size)
        field.textColor = color
        field.lineBreakMode = .byTruncatingTail
        return field
    }

    private func tick() {
        let elapsed = Int(Date().timeIntervalSince(started))
        clock?.stringValue = elapsed < 60 ? "已用 \(elapsed) 秒" : "已用 \(elapsed / 60) 分 \(String(format: "%02d", elapsed % 60)) 秒"
        guard let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let text = json["text"] as? String { line?.stringValue = text }
        let step = json["step"] as? Int ?? 1
        let state = json["state"] as? String ?? "running"
        let current = NSColor(srgbRed: 0.43, green: 0.23, blue: 0.34, alpha: 1)
        let done = NSColor(srgbRed: 0.76, green: 0.36, blue: 0.54, alpha: 1)
        let idle = NSColor(srgbRed: 0.8, green: 0.66, blue: 0.73, alpha: 1)
        for (index, item) in steps.enumerated() {
            let number = index + 1
            if number < step || (number == step && (state == "done" || state == "failed")) {
                item.stringValue = "✓ " + names[index]
                item.textColor = done
                item.font = .systemFont(ofSize: 12)
            } else if number == step {
                item.stringValue = names[index]
                item.textColor = current
                item.font = .systemFont(ofSize: 12, weight: .bold)
            } else {
                item.stringValue = names[index]
                item.textColor = idle
                item.font = .systemFont(ofSize: 12)
            }
        }
        if state == "done" || state == "failed" {
            if holdUntil == nil { holdUntil = Date().addingTimeInterval(state == "done" ? 2 : 8) }
            if let holdUntil, Date() >= holdUntil { NSApp.terminate(nil) }
        }
    }
}
