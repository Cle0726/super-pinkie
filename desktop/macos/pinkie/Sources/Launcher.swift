// macOS 启动器主入口（LauncherMain）与 AppDelegate 核心状态、菜单/全屏生命周期、自更新触发及网关监控。
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

@main
struct LauncherMain {
    static func main() {
        let arguments = CommandLine.arguments
        if let flag = arguments.firstIndex(of: "--update-progress"), flag + 1 < arguments.count {
            let app = NSApplication.shared
            let controller = UpdateProgressController(file: URL(fileURLWithPath: arguments[flag + 1]))
            // NSApp.delegate is weak. Without this, the card is freed before it appears.
            UpdateProgressHold.controller = controller
            app.setActivationPolicy(.regular)
            app.delegate = controller
            app.run()
            return
        }
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
        let workspaceItem = appMenu.addItem(
            withTitle: "打开分屏工作区…",
            action: #selector(AppDelegate.openWorkspaceDockPicker(_:)),
            keyEquivalent: "n"
        )
        workspaceItem.keyEquivalentModifierMask = [.command, .shift]
        workspaceItem.target = delegate
        let browserItem = appMenu.addItem(
            withTitle: "打开浏览器工作区",
            action: #selector(AppDelegate.openBrowserWorkspaceFromMenu(_:)),
            keyEquivalent: "b"
        )
        browserItem.keyEquivalentModifierMask = [.command, .shift]
        browserItem.target = delegate
        let fullScreenItem = appMenu.addItem(
            withTitle: "切换全屏",
            action: #selector(AppDelegate.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        fullScreenItem.keyEquivalentModifierMask = [.command, .control]
        fullScreenItem.target = delegate
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

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate, UNUserNotificationCenterDelegate {
    var window: NSWindow?
    var webView: WKWebView?
    var windowDragArea: WindowDragArea?
    lazy var pinkieNative: PinkieNativeBridge = {
        let bridge = PinkieNativeBridge()
        bridge.mainWebView = { [weak self] in self?.webView }
        bridge.mainWindow = { [weak self] in self?.window }
        return bridge
    }()
    // The companion is deliberately another WKWebView inside the *same*
    // native window. It keeps a second mode/session truly independent while
    // the two chats stay visible as a real left/right split instead of a
    // floating mini window over the primary work.
    var companionPanel: NSView?
    var companionWebView: WKWebView?
    var companionModeID: String?
    // One browser workspace is shared by every chat mode. It lives beside the
    // primary WebView, so switching sessions cannot remount or erase the page.
    var browserPanel: NSView?
    var browserWebView: WKWebView?
    var browserWidthConstraint: NSLayoutConstraint?
    var browserWidthFraction: CGFloat = 0.44
    var browserPresentation: BrowserPresentation = .floating
    var browserFloatingFrame: NSRect?
    var browserDockEdge: BrowserDockEdge?
    var browserEdgeRevealed = false
    var browserEdgeTab: BrowserEdgeTab?
    var browserEdgeHoveringPanel = false
    var browserEdgeHoveringTab = false
    var browserEdgeHoverGeneration = 0
    var browserDragging = false
    var browserDragUnclampedFrame: NSRect?
    var workspacePresentationState: String?
    var browserFitEnabled = (UserDefaults.standard.object(forKey: "pinkie.browser.fitWindow") as? Bool) ?? true
    /// 内置浏览器的网页层强制深色：深色外观下，把仍然画白底的站点翻成深色。
    var browserForceDark = (UserDefaults.standard.object(forKey: "pinkie.browser.forceDark") as? Bool) ?? true
    var browserForceDarkItem: NSMenuItem?
    var browserFitWidth: CGFloat?
    var browserFitWork: DispatchWorkItem?
    var browserFitItem: NSMenuItem?
    var browserToolbarHovered = false
    var browserDragDelta = NSPoint.zero
    var browserDragDetached = false
    var browserFrameConstraints: [NSLayoutConstraint] = []
    var browserTitlebar: BrowserPanelDragHandle?
    var browserCorner: BrowserPanelResizeHandle?
    var browserFloatingResizeHandles: [BrowserPanelResizeHandle] = []
    var browserContentEdgeConstraints: [NSLayoutConstraint] = []
    var browserPresentationButtons: [BrowserPresentation: NSButton] = [:]
    var browserPresentationMenu: NSPopUpButton?
    var browserPresentationMenuItems: [BrowserPresentation: NSMenuItem] = [:]
    var browserStatusStack: NSStackView?
    private var fullScreenTransitionInProgress = false
    var browserAddressField: BrowserAddressField?
    var browserBackButton: NSButton?
    var browserForwardButton: NSButton?
    var browserReloadButton: NSButton?
    var browserCloseButton: NSButton?
    var browserExternalButton: NSButton?
    var browserLoadingIndicator: NSProgressIndicator?
    var browserStatusLabel: NSTextField?
    var browserActivityIndicator: BrowserActivityIndicator?
    var browserAgentActive = false
    var browserToolbarView: NSView?
    var browserResizeView: NSView?
    /// 网页的「配色」变成深色时由 laolaoWindowControl 告诉原生层，原生画的浏览器栏和分屏底色跟着换。
    var nightAppearance = false
    var lastBrowserURL: URL?
    var browserAnimationGeneration = 0
    var primaryFullSizeConstraints: [NSLayoutConstraint] = []
    // These lifetimes are independent: closing a browser must never remove
    // the companion chat's constraints, or vice versa.
    var chatLayoutConstraints: [NSLayoutConstraint] = []
    var companionContentConstraints: [NSLayoutConstraint] = []
    var browserLayoutConstraints: [NSLayoutConstraint] = []
    let primaryMinimumSize = NSSize(width: 860, height: 580)
    let splitMinimumSize = NSSize(width: 1180, height: 650)
    var retries = 0
    var companionRetries = 0
    var startupVideoStartedAt: Date?
    var dashboardLoadPending = false
    var releaseDashboardProbeGeneration = 0
    var releaseDashboardProbeStatus = ""
    let releaseDashboardProbeEnabled = ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true"
        && ProcessInfo.processInfo.environment["PINKIE_RELEASE_SMOKE"] == "1"
    private var gatewayMonitor: Timer?
    private var gatewayProbeFailures = 0
    private var gatewayProbeInFlight = false
    private var guardMonitor: Timer?
    private var guardAlertInFlight = false
    private var guardCounterVerified = false
    private var guardSeenAlertIDs: Set<String> = []
    let dictation = NativeDictationController()
    let dictationHandlerName = "laolaoNativeDictation"
    let liveSpeech = NativeLiveSpeechController()
    let liveSpeechHandlerName = "laolaoLiveVoice"
    let companionDictation = NativeDictationController()
    let companionLiveSpeech = NativeLiveSpeechController()
    let projectFolderHandlerName = "laolaoProjectFolder"
    let updateHandlerName = "laolaoUpdate"
    let workspaceDockHandlerName = "laolaoWorkspaceDock"
    let browserWorkspaceHandlerName = "laolaoBrowserWorkspace"
    let windowControlHandlerName = "laolaoWindowControl"
    let materialPreviewHandlerName = "laolaoMaterialPreview"
    /// 计划书 B 第三节：页面看不到时，碧琪做完 / 出错 / 等确认的系统通知（laolao-run-notify.js）。
    let runNotifyHandlerName = "pinkieNotify"
    private var updateLaunchInProgress = false
    private var updateStageTask: Process?
    private let party = PartyService()
    private let roundtable = RoundtableService()
    private let tts = TTSService()
    private let desktopControl = DesktopControlService()
    let browserControl = BrowserControlController()
    var browserControlForDialogs: BrowserControlController { browserControl }
    var browserWebViewForDialogs: WKWebView? { browserWebView }
    let browserEndpoint = BrowserControlEndpoint()
    var gptWebWorker: ChatGPTBackgroundWorker?
    var browserUserEventMonitor: Any?
    var chatGPTControlUntil = Date.distantPast
    let materialPreview = MaterialPreviewSchemeHandler()
    let materialPreviewAccess = MaterialPreviewFileAccess()
    let materialDownloadLock = NSLock()
    var materialDownloadContexts: [ObjectIdentifier: MaterialDownloadContext] = [:]
    var reservedDownloadPaths: Set<String> = []

    let workspaceSessions: [String: String] = [
        "chat": "agent:main:main",
        "project": "agent:project:main",
        "thinking": "agent:thinking:main",
        "learning": "agent:learning:main",
        "unrestricted": "agent:unrestricted:main",
        "metre": "agent:metre:main",
    ]

    private let workspaceLabels: [String: String] = [
        "chat": "唠嗑模式",
        "project": "项目模式",
        "thinking": "想法模式",
        "learning": "学习模式",
        "unrestricted": "无限制模式",
        "metre": "Metre",
    ]

    @objc func openParty(_ sender: Any?) {
        openParty(in: webView)
    }

    func openParty(in targetWebView: WKWebView?) {
        party.ready { [weak self] ready in
            if ready {
                self?.stopNativeInput(for: targetWebView)
                targetWebView?.load(URLRequest(url: PartyService.url))
            } else {
                let alert = NSAlert()
                alert.messageText = "派对服务还没准备好"
                alert.informativeText = "App 内置服务没有启动成功，请确认端口 18889 没有被其他程序占用。原来的四模式聊天不受影响。"
                alert.runModal()
            }
        }
    }

    @objc func openRoundtable(_ sender: Any?) {
        openRoundtable(in: webView)
    }

    func openRoundtable(in targetWebView: WKWebView?) {
        roundtable.ready { [weak self] ready in
            if ready {
                self?.stopNativeInput(for: targetWebView)
                targetWebView?.load(URLRequest(url: RoundtableService.url))
            } else {
                let alert = NSAlert()
                alert.messageText = "灵感圆桌还没准备好"
                alert.informativeText = "App 内置服务没有启动成功，请确认端口 18891 没有被其他程序占用。其他聊天不会受影响。"
                alert.runModal()
            }
        }
    }

    @objc func openWorkspaceDockPicker(_ sender: Any?) {
        let primaryMode = modeID(for: webView?.url) ?? "chat"
        let candidates = workspaceSessions.keys
            .filter { $0 != primaryMode }
            .sorted { (workspaceLabels[$0] ?? $0) < (workspaceLabels[$1] ?? $1) }
        guard !candidates.isEmpty else { return }

        let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 260, height: 28), pullsDown: false)
        for mode in candidates {
            picker.addItem(withTitle: workspaceLabels[mode] ?? mode)
            picker.lastItem?.representedObject = mode
        }
        if let learningIndex = candidates.firstIndex(of: "learning") {
            picker.selectItem(at: learningIndex)
        }

        let alert = NSAlert()
        alert.messageText = "分屏工作区"
        alert.informativeText = "在当前窗口右侧打开另一个独立模式。两边各自保留会话和记忆，互不打断。"
        alert.accessoryView = picker
        alert.addButton(withTitle: "打开")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn,
              let mode = picker.selectedItem?.representedObject as? String else { return }
        openWorkspaceDock(modeID: mode, requestedSessionKey: workspaceSessions[mode])
    }

    @objc func openBrowserWorkspaceFromMenu(_ sender: Any?) {
        openBrowserWorkspace(url: nil)
    }

    @objc func toggleFullScreen(_ sender: Any?) {
        window?.toggleFullScreen(sender)
    }

    func applicationWillTerminate(_ notification: Notification) {
        gatewayMonitor?.invalidate()
        gatewayMonitor = nil
        guardMonitor?.invalidate()
        guardMonitor = nil
        tts.stop()
        party.stop()
        roundtable.stop()
        desktopControl.stop()
        browserEndpoint.stop()
        materialPreview.clearThumbnailCache()
        if let browserUserEventMonitor { NSEvent.removeMonitor(browserUserEventMonitor) }
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

    private func setFullScreenChrome(_ active: Bool) {
        guard let contentView = window?.contentView else { return }
        contentView.layer?.cornerRadius = active ? 0 : 22
        contentView.layer?.borderWidth = active ? 0 : 1
    }

    private func notifyFullScreenState(_ active: Bool) {
        let script = "window.dispatchEvent(new CustomEvent('pinkie:window-fullscreen',{detail:{active:\(active ? "true" : "false")}}));"
        [webView, companionWebView].compactMap { $0 }.forEach { target in
            target.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    func windowWillEnterFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = true
        setFullScreenChrome(true)
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = false
        updateBrowserWorkspaceWidth()
        notifyFullScreenState(true)
    }

    func windowWillExitFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = true
        notifyFullScreenState(false)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        fullScreenTransitionInProgress = false
        setFullScreenChrome(false)
        updateBrowserWorkspaceWidth()
        clampWindowToVisibleScreen()
    }

    func windowDidResize(_ notification: Notification) {
        windowDragArea?.invalidateRegions()
        updateBrowserWorkspaceWidth()
    }

    private func updateBrowserWorkspaceWidth() {
        guard let panel = browserPanel, panel.superview != nil, let bounds = window?.contentView?.bounds else { return }
        if browserPresentation == .side, let width = browserWidthConstraint {
            width.constant = browserDockedWidth(totalWidth: bounds.width, fraction: browserWidthFraction)
            updateBrowserToolbarLayout(width: width.constant)
        } else if browserPresentation == .floating {
            setBrowserFloatingFrame(BrowserWorkspaceGeometry.floatingFrame(in: bounds, proposed: browserFloatingFrame ?? panel.frame))
        }
        updateBrowserToolbarLayout(width: panel.bounds.width)
        scheduleBrowserFit()
    }

    private func clampWindowToVisibleScreen() {
        guard let window, let visible = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return }
        // A native full-screen window belongs to its Space. Constraining it to
        // visibleFrame (which excludes menu/Dock) shrinks it on activation.
        guard !fullScreenTransitionInProgress, !window.styleMask.contains(.fullScreen) else { return }
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
            guard let self else { return }
            [self.webView, self.companionWebView].compactMap { $0 }.forEach { target in
                target.evaluateJavaScript(script) { _, error in
                    if let error = error {
                        NSLog("[laolao] \(event) notify failed: %@", error.localizedDescription)
                    }
                }
            }
        }
    }

    func isCompanion(_ target: WKWebView?) -> Bool {
        guard let target, let companionWebView else { return false }
        return target === companionWebView
    }

    private func stopNativeInput(for target: WKWebView?) {
        if isCompanion(target) {
            companionDictation.stop()
            companionLiveSpeech.stop()
        } else {
            dictation.stop()
            liveSpeech.stop()
        }
    }

    func sessionKey(for url: URL?) -> String? {
        guard let url else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "session" })?.value
    }

    func modeID(for url: URL?) -> String? {
        guard let session = sessionKey(for: url) else { return nil }
        if session.hasPrefix("agent:main:") { return "chat" }
        return workspaceSessions.first(where: { session.hasPrefix($0.value.replacingOccurrences(of: ":main", with: ":")) })?.key
    }

    func isWorkspaceSession(_ sessionKey: String, for modeID: String) -> Bool {
        guard let rootSession = workspaceSessions[modeID] else { return false }
        let prefix = "\(String(rootSession.dropLast(5))):"
        return sessionKey.hasPrefix(prefix)
            && sessionKey.count > prefix.count
            && !sessionKey.contains(":subagent:")
    }

    func chatURL(sessionKey: String, docked: Bool = false) -> URL {
        var components = URLComponents(url: Gateway.defaultChatURL, resolvingAgainstBaseURL: false)
        var queryItems = [URLQueryItem(name: "session", value: sessionKey)]
        if docked {
            // The companion joins an already-running App. It must never replay
            // the first-entry movie or the web splash over the work area.
            queryItems.append(URLQueryItem(name: "laolao-dock", value: "1"))
        }
        components?.queryItems = queryItems
        return components?.url ?? Gateway.defaultChatURL
    }

    func trustedFrame(_ frame: WKFrameInfo) -> Bool {
        guard frame.isMainFrame, let url = frame.request.url else { return false }
        return [Gateway.url, PartyService.url, RoundtableService.url].contains { allowed in
            url.scheme == allowed.scheme && url.host == allowed.host && url.port == allowed.port
        }
    }

    @objc func checkForUpdates(_ sender: Any?) {
        guard !updateLaunchInProgress else { return }
        guard let webView else { legacyCheckForUpdates(); return }
        webView.evaluateJavaScript("Boolean(window.__pinkieUpdateDialog?.open())") { [weak self] value, _ in
            if (value as? Bool) != true { self?.legacyCheckForUpdates() }
        }
    }

    private func legacyCheckForUpdates() {
        guard !updateLaunchInProgress else { return }
        let confirmation = NSAlert()
        confirmation.messageText = "现在更新碧琪？"
        confirmation.informativeText = "确认后旧 App 会退出。独立更新程序会继续拉取、安装并重新打开；期间网关重启或页面断开都不会中止更新。人格、会话、项目、图片和视频不会参与替换。"
        confirmation.alertStyle = .informational
        confirmation.addButton(withTitle: "拉取并更新")
        confirmation.addButton(withTitle: "取消")
        guard confirmation.runModal() == .alertFirstButtonReturn else { return }
        _ = launchDetachedUpdate(prepared: false)
    }

    private func updateStateRoot() -> URL {
        if let configured = ProcessInfo.processInfo.environment["PINKIE_STATE_ROOT"], !configured.isEmpty {
            return URL(fileURLWithPath: configured, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SuperPinkie", isDirectory: true)
    }

    /// A copy of this executable, re-signed, so replacing the App bundle does not take the card with it.
    private func spawnUpdateProgress(executable: URL?, file: URL, folder: URL) {
        guard let executable else { return }
        let staged = folder.appendingPathComponent("PinkieUpdateProgress")
        do {
            if FileManager.default.fileExists(atPath: staged.path) { try FileManager.default.removeItem(at: staged) }
            try FileManager.default.copyItem(at: executable, to: staged)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: staged.path)
        } catch {
            NSLog("[laolao] update progress copy failed: %@", error.localizedDescription)
            return
        }
        let sign = Process()
        sign.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        sign.arguments = ["--force", "--sign", "-", staged.path]
        sign.standardInput = FileHandle.nullDevice
        sign.standardOutput = FileHandle.nullDevice
        sign.standardError = FileHandle.nullDevice
        if (try? sign.run()) != nil { sign.waitUntilExit() }
        let progress = Process()
        progress.executableURL = staged
        progress.arguments = ["--update-progress", file.path]
        progress.standardInput = FileHandle.nullDevice
        progress.standardOutput = FileHandle.nullDevice
        progress.standardError = FileHandle.nullDevice
        do { try progress.run() }
        catch { NSLog("[laolao] update progress did not start: %@", error.localizedDescription) }
    }

    @discardableResult private func launchDetachedUpdate(prepared: Bool) -> Bool {
        guard !updateLaunchInProgress, let root = BundledRuntime.resourceRoot else { return false }
        let bundledScript = root.appendingPathComponent("installer/macos/detached-update.sh")
        let stageScript = root.appendingPathComponent("installer/macos/stage-git-update.py")
        let updateRoot = updateStateRoot().appendingPathComponent("updates", isDirectory: true)
        if prepared && (!FileManager.default.fileExists(atPath: stageScript.path)
            || !FileManager.default.fileExists(atPath: updateRoot.appendingPathComponent("prepared-git.json").path)) { return false }
        let helper = updateRoot.appendingPathComponent("manual-update.sh")
        let task = Process()
        do {
            try FileManager.default.createDirectory(at: updateRoot, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: helper.path) { try FileManager.default.removeItem(at: helper) }
            try FileManager.default.copyItem(at: bundledScript, to: helper)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
            let progressFile = updateRoot.appendingPathComponent("progress.json")
            let initial = #"{"step":1,"total":5,"text":"正在退出旧版本","state":"running"}"#
            try initial.write(to: progressFile, atomically: true, encoding: .utf8)
            spawnUpdateProgress(executable: Bundle.main.executableURL, file: progressFile, folder: updateRoot)
            task.executableURL = URL(fileURLWithPath: "/bin/zsh")
            task.arguments = [helper.path, String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundleURL.path]
                + (prepared ? ["--prepared", stageScript.path] : [])
            var environment = BundledRuntime.environment()
            environment["PINKIE_UPDATE_PROGRESS_FILE"] = progressFile.path
            task.environment = environment
            task.standardInput = FileHandle.nullDevice
            task.standardOutput = FileHandle.nullDevice
            task.standardError = FileHandle.nullDevice
            try task.run()
            updateLaunchInProgress = true
            notifyWebView("pinkie:update-detached")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { NSApp.terminate(nil) }
            return true
        } catch {
            if !prepared { NSAlert(error: error).runModal() }
            return false
        }
    }

    private func sendUpdateResult(_ request: Int, _ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__pinkieUpdateResult?.(\(request),\(json))", completionHandler: nil)
    }

    private func sendUpdateProgress(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__pinkieUpdateProgress?.(\(json))", completionHandler: nil)
    }

    func handleUpdateRequest(_ body: [String: Any]) {
        guard let action = body["action"] as? String, let request = body["request"] as? Int,
              request > 0, request < 1_000_000_000 else { return }
        if action == "apply" {
            guard updateStageTask == nil else { sendUpdateResult(request, ["started": false, "message": "更新仍在准备，请稍等。"]); return }
            let started = launchDetachedUpdate(prepared: true)
            sendUpdateResult(request, ["started": started, "message": started ? "" : "无法启动安装，请重新准备更新。"])
            return
        }
        guard ["check", "prepare"].contains(action), updateStageTask == nil,
              let root = BundledRuntime.resourceRoot, let python = BundledRuntime.pythonExecutable() else {
            sendUpdateResult(request, ["temporaryError": true, "message": "更新服务暂时不可用，请稍后重试。"]); return
        }
        let script = root.appendingPathComponent("installer/macos/stage-git-update.py")
        guard FileManager.default.fileExists(atPath: script.path) else {
            sendUpdateResult(request, ["temporaryError": true, "message": "更新组件缺失，请手动下载安装。"]); return
        }
        let task = Process(), pipe = Pipe()
        task.executableURL = python
        task.arguments = [script.path, action]
        var environment = BundledRuntime.environment()
        // 国内线路：更新弹窗里选了「国内线路」时，Git 走加速代理（见 stage-git-update.py）。
        if body["route"] as? String == "mirror" { environment["PINKIE_UPDATE_ROUTE"] = "mirror" }
        else { environment.removeValue(forKey: "PINKIE_UPDATE_ROUTE") }
        task.environment = environment
        task.standardInput = FileHandle.nullDevice
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do { try task.run(); updateStageTask = task }
        catch { sendUpdateResult(request, ["temporaryError": true, "message": "更新服务没有启动，请稍后重试。"]); return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var buffered = Data(), receivedResult = false
            while true {
                let part = pipe.fileHandleForReading.readData(ofLength: 4096)
                if part.isEmpty { break }
                buffered.append(part)
                if buffered.count > 1_048_576 { task.terminate(); break }
                while let newline = buffered.firstIndex(of: 10) {
                    let line = Data(buffered[..<newline]); buffered.removeSubrange(...newline)
                    guard let packet = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
                          let kind = packet["type"] as? String else { continue }
                    if kind == "progress", let event = packet["event"] as? [String: Any] {
                        DispatchQueue.main.async { self?.sendUpdateProgress(event) }
                    } else if kind == "result", let value = packet["value"] as? [String: Any] {
                        receivedResult = true
                        DispatchQueue.main.async { self?.sendUpdateResult(request, value) }
                    }
                }
            }
            task.waitUntilExit()
            let failedWithoutResult = !receivedResult
            DispatchQueue.main.async {
                self?.updateStageTask = nil
                if failedWithoutResult { self?.sendUpdateResult(request, ["temporaryError": true, "message": "更新服务中断，请稍后重试。"]) }
            }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 深色是出厂默认：没有存过偏好的设备（全新安装 / 首次启动）直接进深色。
        UserDefaults.standard.register(defaults: ["pinkie.appearanceMode": "dark"])
        UNUserNotificationCenter.current().delegate = self
        let appearanceMode = UserDefaults.standard.string(forKey: "pinkie.appearanceMode") ?? "system"
        nightAppearance = appearanceMode == "dark" || (appearanceMode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua)
        applyNightAppearance()
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
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self
        window.minSize = primaryMinimumSize
        window.setFrame(window.constrainFrameRect(rect, to: NSScreen.main), display: false)
        window.center()

        let webView = makeChatWebView()

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
        primaryFullSizeConstraints = [
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: contentView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ]
        NSLayoutConstraint.activate(primaryFullSizeConstraints)

        installWindowDragArea(in: contentView, primary: webView)

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
        _ = pinkieNative // menu bar icon + global hotkey come up with the window
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            BundledSetup.apply()
            DispatchQueue.main.async {
                guard let self else { return }
                if self.checkSettingsGuard(startup: true) {
                    NSApp.terminate(nil)
                    return
                }
                self.startSettingsGuardMonitor()
                self.startBundledServices()
            }
        }
    }

    @discardableResult
    private func checkSettingsGuard(startup: Bool) -> Bool {
        guard !guardAlertInFlight, SettingsGuardNative.isReleaseBuild() else { return false }
        let stateRoot = SettingsGuardNative.stateRoot()
        if SettingsGuardNative.isUpdateInProgress(stateRoot: stateRoot) { return false }
        guardAlertInFlight = true
        defer { guardAlertInFlight = false }

        let guardDir = stateRoot.appendingPathComponent("guard", isDirectory: true)
        let alertURL = guardDir.appendingPathComponent("pending-alert.json")
        var pendingPayload: [String: Any]?
        if let data = try? Data(contentsOf: alertURL),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            try? FileManager.default.removeItem(at: alertURL)
            let id = (obj["id"] as? String) ?? ""
            if id.isEmpty || !guardSeenAlertIDs.contains(id) || (obj["limitReached"] as? Bool == true) {
                if !id.isEmpty { guardSeenAlertIDs.insert(id) }
                pendingPayload = obj
            }
        }

        if let identity = SettingsGuardNative.bundleIdentity() {
            let counterValid = SettingsGuardNative.verifyCounter(stateRoot: stateRoot, identity: identity)
            if counterValid {
                guardCounterVerified = true
            } else if guardCounterVerified || (startup && SettingsGuardNative.hasReceipt(stateRoot: stateRoot, identity: identity)) {
                SettingsGuardNative.lockTamperedCounter(stateRoot: stateRoot)
                if pendingPayload == nil {
                    pendingPayload = ["counterTampered": true, "limitReached": true]
                } else {
                    pendingPayload?["counterTampered"] = true
                    pendingPayload?["limitReached"] = true
                }
            }
        }

        guard let payload = pendingPayload else { return false }
        return SettingsGuardNative.presentAlert(from: payload)
    }

    private func startSettingsGuardMonitor() {
        guard guardMonitor == nil, SettingsGuardNative.isReleaseBuild() else { return }
        guardMonitor = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            guard let self else { return }
            if self.checkSettingsGuard(startup: false) {
                self.guardMonitor?.invalidate()
                self.guardMonitor = nil
                NSApp.terminate(nil)
            }
        }
    }

    // The production window and hidden integration checks use the same layer.
    private func installWindowDragArea(in content: NSView, primary: WKWebView) {
        windowDragArea?.removeFromSuperview()
        let dragArea = WindowDragArea(frame: .zero)
        dragArea.sourceWebView = primary
        dragArea.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(dragArea)
        NSLayoutConstraint.activate([
            dragArea.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            dragArea.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            dragArea.topAnchor.constraint(equalTo: content.topAnchor),
            dragArea.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        windowDragArea = dragArea
    }

    func makeChatWebView(docked: Bool = false) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(materialPreview, forURLScheme: "clekk-material")
        let controller = configuration.userContentController
        controller.add(self, name: dictationHandlerName)
        controller.add(self, name: liveSpeechHandlerName)
        controller.add(self, name: projectFolderHandlerName)
        controller.add(self, name: updateHandlerName)
        controller.add(self, name: workspaceDockHandlerName)
        controller.add(self, name: browserWorkspaceHandlerName)
        controller.add(self, name: windowControlHandlerName)
        controller.add(self, name: materialPreviewHandlerName)
        controller.add(self, name: runNotifyHandlerName)
        controller.add(self, name: "laolaoParty")
        controller.add(self, name: "laolaoRoundtable")
        controller.add(self, name: "pinkieMotion")
        controller.add(self, name: PinkieNativeBridge.handlerName)
        controller.addUserScript(WKUserScript(
            source: nativeDictationBridge,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
        if !docked {
            controller.addUserScript(WKUserScript(source: nativeWindowDragBridge,
                injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // Mark only the native shell. The web UI uses this to avoid whole-page
        // opacity animation while keeping its decorative motion intact.
        controller.addUserScript(WKUserScript(
            source: "window.__pinkieMacUpdaterV2 = \(docked ? "false" : "true"); window.__pinkieBootNight = \(nightAppearance ? "true" : "false"); document.documentElement.setAttribute('data-pinkie-native-glass', '1')",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        if !docked {
            // The primary view survives normal in-app navigation.  Keep its
            // compact split presentation across that navigation while a
            // companion is visible, without leaking the state into a future
            // app launch (sessionStorage is WebView-session only).
            controller.addUserScript(WKUserScript(
                source: "try { if (sessionStorage.getItem('laolao-primary-workspace-split') === '1') document.documentElement.setAttribute('data-laolao-workspace-split', '1'); } catch (_) {}",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }
        controller.addUserScript(WKUserScript(
            source: "try { if (sessionStorage.getItem('laolao-primary-browser-workspace') === '1') document.documentElement.setAttribute('data-laolao-browser-workspace', '1'); } catch (_) {}",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        if docked {
            controller.addUserScript(WKUserScript(
                source: "document.documentElement.setAttribute('data-laolao-workspace-dock', '1')",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }

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
        return webView
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
        configureBrowserControl()
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
