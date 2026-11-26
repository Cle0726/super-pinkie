// macOS 启动器运行时配置、捆绑 Node/Python/Cua 环境定位、网关进程生命周期与设置守卫原生校验。
import AppKit
import AVFoundation
import CommonCrypto
import Darwin
import Foundation
import Speech
import UserNotifications
import WebKit

enum RuntimeConfig {
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

enum BundledRuntime {
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
        if let skills = resourceRoot?.appendingPathComponent("bundled-skills", isDirectory: true),
           FileManager.default.fileExists(atPath: skills.path) {
            environment["PINKIE_MANAGED_SKILLS_DIR"] = skills.path
        } else {
            environment.removeValue(forKey: "PINKIE_MANAGED_SKILLS_DIR")
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
        // Started from a shell that exported HTTP(S)_PROXY without a NO_PROXY
        // exemption (11-04), the gateway sent every call for the local model
        // relay (127.0.0.1:1467) through the proxy and each one failed with
        // "network connection error". Loopback never goes through a proxy.
        // OpenClaw reads no_proxy before NO_PROXY, so both get the entries.
        for key in ["NO_PROXY", "no_proxy"] {
            var entries = (environment[key] ?? "")
                .split(whereSeparator: { $0 == "," || $0 == " " })
                .map(String.init)
            for host in ["localhost", "127.0.0.1", "::1"]
            where !entries.contains(where: { $0.lowercased() == host }) {
                entries.append(host)
            }
            environment[key] = entries.joined(separator: ",")
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
enum DesktopControlEndpoint {
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


enum Gateway {
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
    private static let nativeAuthScriptMarker = "/* super-pinkie managed Gateway auth */"
    static func nativeControlAuthPrepared(for webView: WKWebView) -> Bool {
        webView.configuration.userContentController.userScripts.contains { $0.source.hasPrefix(nativeAuthScriptMarker) }
    }

    static func prepareNativeControlAuth(for webView: WKWebView) {
        // Share a credential only with our own bundled Gateway's loopback
        // Control UI. Never expose it to the separate browser or a remote URL.
        // Foundation's Process may return a differently represented file URL
        // for the same executable. Match the resolved paths, not URL objects.
        guard let task = process, task.isRunning,
              let executable = task.executableURL, let bundledNode = BundledRuntime.nodeURL,
              canonicalPath(executable.path) == canonicalPath(bundledNode.path),
              var origin = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = origin.scheme, scheme == "http" || scheme == "https",
              let host = origin.host?.lowercased(), ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host),
              origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil,
              origin.path.isEmpty || origin.path == "/" else { return }
        let controller = webView.configuration.userContentController
        guard !nativeControlAuthPrepared(for: webView) else { return }

        let env = task.environment ?? [:]
        let config = env["OPENCLAW_CONFIG_PATH"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
            ?? SettingsGuardNative.openclawStateDir().appendingPathComponent("openclaw.json")
        guard let data = try? Data(contentsOf: config),
              data.range(of: Data("\"$include\"".utf8)) == nil,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let gateway = root["gateway"] as? [String: Any],
              (gateway["mode"] as? String ?? "local") == "local",
              (gateway["bind"] as? String ?? "loopback") == "loopback",
              ((gateway["tailscale"] as? [String: Any])?["mode"] as? String ?? "off") == "off" else { return }
        let auth = gateway["auth"] as? [String: Any] ?? [:]
        func literal(_ name: String, environment: String) -> String? {
            guard auth[name] == nil || auth[name] is String else { return nil }  // SecretRef is resolved only by OpenClaw.
            for candidate in [auth[name] as? String, env[environment]] {
                guard let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { continue }
                return value.contains("${") ? nil : value
            }
            return nil
        }
        let token = literal("token", environment: "OPENCLAW_GATEWAY_TOKEN")
        let password = literal("password", environment: "OPENCLAW_GATEWAY_PASSWORD")
        let mode = auth["mode"] as? String ?? (password != nil ? "password" : "token")
        let credential: String?
        switch mode {
        case "token": credential = token
        case "password": credential = password
        default: return
        }
        origin.path = ""
        guard let address = origin.string, let credential,
              let payload = try? JSONSerialization.data(withJSONObject: ["origin": address, mode: credential]),
              let json = String(data: payload, encoding: .utf8) else { return }
        let source = """
        \(nativeAuthScriptMarker)
        (() => {
          const auth = \(json);
          if (window !== window.top || location.origin !== new URL(auth.origin).origin) return;
          delete auth.origin;
          auth.gatewayUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
          window.__OPENCLAW_NATIVE_CONTROL_AUTH__ = auth;
        })();
        """
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

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
            let launcherOwnsGateway = process?.isRunning == true
            let stale = listenerProcesses().filter {
                guard isCLEKkBundledNode($0.executablePath) else { return false }
                // A matching binary is not enough: after a crash, force quit,
                // or an interrupted update, the old Node can be re-parented to
                // launchd while still pointing to the same App path. The new
                // Launcher has no Process handle for it, so it cannot stop it
                // on the next quit and its driver socket is already invalid.
                // Replace that orphan just as we replace a different build.
                return !launcherOwnsGateway
                    || $0.executablePath != expectedNode
                    || $0.executableIdentity != expectedIdentity
            }
            guard !stale.isEmpty else {
                DispatchQueue.main.async { completion(.acceptExisting) }
                return
            }
            guard stale.allSatisfy({ stopStaleListener($0) }) else {
                lastError = "旧版 C.le. 网关仍占用端口，没有误杀其他进程。"
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
        gatewayEnvironment.removeValue(forKey: "PINKIE_APP_BROWSER_ENDPOINT")
        if let endpoint = BrowserControlEndpoint.environmentValue() {
            gatewayEnvironment["PINKIE_APP_BROWSER_ENDPOINT"] = endpoint
        }
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
            BrowserControlEndpoint.authorizeGateway(task.processIdentifier)
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

enum BundledSetup {
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

enum SettingsGuardNative {
    static let publicKey = "MCowBQYDK2VwAyEAcejSsqLWnO2o0lFTrm+Lh22s8Qi5XSfTGX4GnQTgnOs="
    static let strikeLimit = 3

    struct BundleIdentity {
        let channel: String
        let version: String
        let commit: String
        let manifestSha: String
    }

    static func stateRoot() -> URL {
        if let configured = ProcessInfo.processInfo.environment["PINKIE_STATE_ROOT"], !configured.isEmpty {
            return URL(fileURLWithPath: configured, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SuperPinkie", isDirectory: true)
    }

    static func isReleaseBuild() -> Bool {
        guard let root = BundledRuntime.resourceRoot,
              let data = try? Data(contentsOf: root.appendingPathComponent("build-info.json")),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return obj["guard"] as? Bool == true
    }

    static func isUpdateInProgress(stateRoot: URL) -> Bool {
        let updatesDir = stateRoot.appendingPathComponent("updates", isDirectory: true)
        let now = Date()
        for name in ["in-progress.json", "install-in-progress.json", "manual-update.lock"] {
            let candidate = updatesDir.appendingPathComponent(name)
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: candidate.path),
                  let mtime = attrs[.modificationDate] as? Date,
                  now.timeIntervalSince(mtime) <= 15 * 60 else { continue }
            if (attrs[.type] as? FileAttributeType) == .typeDirectory { return true }
            if let data = try? Data(contentsOf: candidate),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let pid = obj["pid"] as? Int32, pid > 1 {
                if Darwin.kill(pid, 0) == 0 || errno == EPERM { return true }
                continue
            }
            return true
        }
        return false
    }

    private static func sha256Data(_ data: Data) -> Data {
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { bytes in
            _ = CC_SHA256(bytes.baseAddress, CC_LONG(data.count), &digest)
        }
        return Data(digest)
    }

    private static func hexString(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private static func hmacSha256Hex(key: Data, message: Data) -> String {
        var out = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        key.withUnsafeBytes { keyBytes in
            message.withUnsafeBytes { msgBytes in
                CCHmac(
                    CCHmacAlgorithm(kCCHmacAlgSHA256),
                    keyBytes.baseAddress, key.count,
                    msgBytes.baseAddress, message.count,
                    &out
                )
            }
        }
        return out.map { String(format: "%02x", $0) }.joined()
    }

    static func bundleIdentity() -> BundleIdentity? {
        guard let root = BundledRuntime.resourceRoot else { return nil }
        let info = (try? Data(contentsOf: root.appendingPathComponent("build-info.json")))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        var manifestSha = ""
        var manifest: [String: Any] = [:]
        if let manifestBytes = try? Data(contentsOf: root.appendingPathComponent("guard-manifest.json")) {
            manifestSha = hexString(sha256Data(manifestBytes))
            manifest = (try? JSONSerialization.jsonObject(with: manifestBytes) as? [String: Any]) ?? [:]
        }
        return BundleIdentity(
            channel: (info["channel"] as? String) ?? "release",
            version: (info["version"] as? String) ?? (manifest["version"] as? String) ?? "",
            commit: (manifest["commit"] as? String) ?? (info["commit"] as? String) ?? "",
            manifestSha: manifestSha
        )
    }

    static func openclawStateDir() -> URL {
        if let configured = ProcessInfo.processInfo.environment["OPENCLAW_STATE_DIR"], !configured.isEmpty {
            return URL(fileURLWithPath: configured, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw", isDirectory: true)
    }

    private static func receiptMatches(_ record: [String: Any], identity: BundleIdentity) -> Bool {
        guard (record["version"] as? String ?? "") == identity.version else { return false }
        let recCommit = (record["commit"] as? String) ?? ""
        if !identity.commit.isEmpty && !recCommit.isEmpty && recCommit != identity.commit { return false }
        let recSha = (record["manifestSha"] as? String) ?? ""
        if !identity.manifestSha.isEmpty && !recSha.isEmpty && recSha != identity.manifestSha { return false }
        return true
    }

    static func hasReceipt(stateRoot: URL, identity: BundleIdentity) -> Bool {
        let guardDir = stateRoot.appendingPathComponent("guard", isDirectory: true)
        if let data = try? Data(contentsOf: guardDir.appendingPathComponent("status.json")),
           let status = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           (status["counterSchema"] as? Int ?? 0) >= 1,
           receiptMatches(status, identity: identity) {
            return true
        }
        let openclawDir = openclawStateDir()
        if let data = try? Data(contentsOf: openclawDir.appendingPathComponent("guard-receipt.json")),
           let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           (receipt["schema"] as? Int ?? 0) >= 1,
           receiptMatches(receipt, identity: identity) {
            return true
        }
        for plugin in ["pinkie-mode-architecture", "pinkie-project-scope", "pinkie-first-person-renderer"] {
            let mark = openclawDir.appendingPathComponent("extensions/\(plugin)/guard-build.json")
            if let data = try? Data(contentsOf: mark),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               obj["counterReady"] as? Bool == true,
               receiptMatches(obj, identity: identity) {
                return true
            }
        }
        return false
    }

    static func verifyCounter(stateRoot: URL, identity: BundleIdentity) -> Bool {
        let file = stateRoot.appendingPathComponent("guard/counter.json")
        guard let data = try? Data(contentsOf: file),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["schema"] as? Int) == 1,
              let events = obj["events"] as? [String],
              (obj["channel"] as? String ?? "") == identity.channel,
              (obj["version"] as? String ?? "") == identity.version,
              (obj["commit"] as? String ?? "") == identity.commit,
              (obj["manifestSha"] as? String ?? "") == identity.manifestSha,
              let updatedAt = obj["updatedAt"] as? String,
              let mac = obj["mac"] as? String,
              let chainMac = obj["chainMac"] as? String else {
            return false
        }
        let locked = (obj["tamperLocked"] as? Bool == true) ? "1" : "0"
        let payload = "1|\(identity.channel)|\(identity.version)|\(identity.commit)|\(identity.manifestSha)|\(events.joined(separator: ","))|\(locked)|\(updatedAt)"
        guard let payloadData = payload.data(using: .utf8),
              let bundleKeyInput = "pinkie-guard-counter-v1|\(publicKey)|\(identity.channel)|\(identity.version)|\(identity.commit)|\(identity.manifestSha)".data(using: .utf8),
              let chainKeyInput = "pinkie-guard-chain-v1|\(publicKey)|\(identity.channel)".data(using: .utf8) else {
            return false
        }
        let expectedMac = hmacSha256Hex(key: sha256Data(bundleKeyInput), message: payloadData)
        let expectedChain = hmacSha256Hex(key: sha256Data(chainKeyInput), message: payloadData)
        return mac.lowercased() == expectedMac && chainMac.lowercased() == expectedChain
    }

    static func lockTamperedCounter(stateRoot: URL) {
        guard let node = BundledRuntime.nodeURL, BundledRuntime.exists(node),
              let root = BundledRuntime.resourceRoot else { return }
        let guardScript = root.appendingPathComponent("installer/guard/guard.mjs")
        guard FileManager.default.fileExists(atPath: guardScript.path) else { return }
        let task = Process()
        task.executableURL = node
        task.arguments = [guardScript.path, "lock-tampered", "--bundle", root.path, "--app-state", stateRoot.path]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        try? task.run()
        task.waitUntilExit()
    }

    static func presentAlert(from payload: [String: Any]) -> Bool {
        let counterTampered = payload["counterTampered"] as? Bool == true
        let limitReached = payload["limitReached"] as? Bool == true
        let restoreFailed = payload["restoreFailed"] as? Bool == true
        let nonOfficial = payload["nonOfficial"] as? Bool == true
        let categories = (payload["categories"] as? [String])?.filter { !$0.isEmpty } ?? []
        let catText = categories.isEmpty ? "产品设定" : categories.joined(separator: "、")
        let backup = (payload["backup"] as? String) ?? ""
        let count = (payload["count"] as? Int) ?? strikeLimit
        let limit = (payload["limit"] as? Int) ?? strikeLimit

        let alert = NSAlert()
        alert.alertStyle = (limitReached || counterTampered) ? .critical : .warning
        if counterTampered {
            alert.messageText = "保护记录文件被删除或改动，应用即将退出"
            alert.informativeText = "正式版的设定保护记录不完整或被修改，按保护规则这次会先退出应用。\n\n下次可以正常打开，并会先检查恢复官方设定；24 小时内再改动仍会直接退出。你的记忆和设置都还在。"
            alert.addButton(withTitle: "退出应用")
        } else if restoreFailed {
            alert.messageText = "部分碧琪设定文件没能自动恢复"
            alert.informativeText = "检查时发现有设定文件需要恢复，但写入没有成功（可能是磁盘空间不足、文件夹权限不够，或者被安全软件拦住了）。\n\n这次没有计入异常次数。请检查磁盘空间或安全软件后重试，你的记忆和设置没有改动。"
            alert.addButton(withTitle: "我知道了")
        } else if nonOfficial {
            alert.messageText = "当前安装包不是官方完整版本"
            alert.informativeText = "这个安装包缺少官方校验签名，或者安装包里的文件被改动过，无法用来恢复设定。建议到官方渠道重新下载安装，你的记忆和设置都在。"
            alert.addButton(withTitle: "我知道了")
        } else if limitReached {
            alert.messageText = "24 小时内已有 \(count) 次改动碧琪的设定，应用即将退出"
            var info = "刚才发现的\(catText)改动已经换回官方版本。"
            if !backup.isEmpty { info += "\n\n原文件备份在：\n\(backup)" }
            info += "\n\n24 小时内多次改动产品设定会触发保护退出。下次可以正常打开使用；如果 24 小时内再次改动，仍会直接退出。你的记忆、偏好设置和项目文件都没有受影响。"
            alert.informativeText = info
            alert.addButton(withTitle: "退出应用")
        } else {
            alert.messageText = "碧琪发现自己的\(catText)被改动了，已经换回官方版本"
            var info = "为了保证碧琪正常说话和做事，正式版不允许修改这些设定。你的记忆、偏好设置和项目文件都没有动。"
            if !backup.isEmpty { info += "\n\n被改过的文件已备份到：\n\(backup)" }
            info += "\n\n（24 小时内第 \(count) 次恢复；达到 \(limit) 次后应用会自动退出）"
            alert.informativeText = info
            alert.addButton(withTitle: "我知道了")
        }
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        return limitReached || counterTampered
    }
}
