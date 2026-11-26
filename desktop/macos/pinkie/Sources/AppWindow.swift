import AppKit
import CoreServices
import WebKit

// 作品装成桌面上的独立应用 -- macOS 这一半（任务-官方新功能五项-1125 第 1 项，PR①：安装、打开、卸载）。
// 网关（services/mode-architecture/desktop-apps.mjs）已经把作品拷进
// <PINKIE_STATE_ROOT 或 ~/Library/Application Support/SuperPinkie>/apps/<appId>/index.html，图标是同目录 icon.icns。
// 这里做三件事：
// * 入口：~/Applications/<名字>.app，自己的 bundle id 和图标；Contents/MacOS/run 是拷过去的碧琪 Launcher（Mach-O，
//   macOS 26 的 LaunchServices 不启动入口是 sh 脚本的 .app，报 -10669），整包重新 ad-hoc 签名。Finder / Dock 起它时
//   没有参数，靠 Info.plist 里的 PinkieAppId 认出是哪件作品。卸载只删带这个标记的 .app，删之前先撤 LaunchServices 登记；
//   建在哪记在 apps/shortcuts-mac.json，不去猜路径；重装改了名字时旧的先删。
// * 窗口：--app-window 只开一个显示这件作品的 WKWebView 窗口，不起网关、不开碧琪主界面，只读作品自己的目录。
// * 页面 → 原生：installApp / uninstallApp / openApp，由 PinkieNative.handle 转过来。
// 不联网靠网关插进页面的 CSP；联网 / 读文件的勾选和更新是 PR② 的事。

enum PinkieAppWindow {
    static let flag = "--app-window"

    struct App {
        let id: String
        let name: String
        let dir: URL
        var files = false  // PR②：安装时勾了「读你选的文件」才弹文件框
        var network: [String] = []  // PR②：安装时勾了的来源（https://host[:port]），只有这些能跳转
    }

    static func isValidId(_ id: String) -> Bool {
        id.count == 16 && id.hasPrefix("w") && id.dropFirst().allSatisfy { "0123456789abcdef".contains($0) }
    }

    static var stateRoot: URL {
        if let configured = ProcessInfo.processInfo.environment["PINKIE_STATE_ROOT"], !configured.isEmpty {
            return URL(fileURLWithPath: (configured as NSString).expandingTildeInPath, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SuperPinkie", isDirectory: true)
    }
    static var appsRoot: URL { stateRoot.appendingPathComponent("apps", isDirectory: true) }
    static var applicationsDir: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
    }
    static var ledgerURL: URL { appsRoot.appendingPathComponent("shortcuts-mac.json") }

    // The id is checked before it touches a path, so a page cannot point us outside apps/.
    static func readApp(_ id: String) -> App? {
        guard isValidId(id),
              let data = try? Data(contentsOf: appsRoot.appendingPathComponent("index.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let apps = json["apps"] as? [String: Any],
              let app = apps[id] as? [String: Any] else { return nil }
        let dir = appsRoot.appendingPathComponent(id, isDirectory: true)
        guard FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.html").path) else { return nil }
        let name = (app["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "作品"
        let network = (app["network"] as? [String] ?? []).map { $0.lowercased() }
        return App(id: id, name: name, dir: dir, files: app["files"] as? Bool == true, network: network)
    }

    static func ledger() -> [String: String] {
        guard let data = try? Data(contentsOf: ledgerURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        var out: [String: String] = [:]
        for (key, value) in json { if isValidId(key), let path = value as? String { out[key] = path } }
        return out
    }

    static func saveLedger(_ ledger: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: ledger, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: appsRoot, withIntermediateDirectories: true)
        try? data.write(to: ledgerURL, options: .atomic)
    }

    static func isOurs(_ bundle: URL) -> Bool {
        guard bundle.pathExtension == "app",
              let info = NSDictionary(contentsOf: bundle.appendingPathComponent("Contents/Info.plist")) else { return false }
        return info["PinkieAppId"] is String
    }

    static let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

    // LSRegisterURL(url, false) only skips a forced refresh; it does not unregister. Deleting the .app alone
    // leaves a stale record pointing at a path that no longer exists.
    static func unregister(_ bundle: URL) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: lsregister)
        task.arguments = ["-u", bundle.path]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        guard (try? task.run()) != nil else { return }
        task.waitUntilExit()
    }

    // Only ever deletes a .app we made (it carries PinkieAppId); the ledger is a file on disk.
    static func removeBundle(_ bundle: URL) {
        guard isOurs(bundle) else { return }
        unregister(bundle)
        try? FileManager.default.removeItem(at: bundle)
    }

    // The .app's own Info.plist names the work, so Finder / Dock can start it without arguments.
    static func bundledAppId(_ bundle: Bundle = .main) -> String? {
        (bundle.object(forInfoDictionaryKey: "PinkieAppId") as? String).flatMap { isValidId($0) ? $0 : nil }
    }

    static func adhocSign(_ bundle: URL) -> Bool {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        task.arguments = ["--force", "--sign", "-", bundle.path]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        guard (try? task.run()) != nil else { return false }
        task.waitUntilExit()
        return task.terminationStatus == 0
    }

    static func handle(_ type: String, _ body: [String: Any]) -> [String: Any] {
        let id = body["appId"] as? String ?? ""
        switch type {
        case "installApp": return install(id)
        case "uninstallApp": return uninstall(id)
        case "openApp": return open(id)
        default: return ["ok": false, "error": "不认识的原生请求"]
        }
    }

    static func install(_ id: String) -> [String: Any] {
        guard let app = readApp(id) else { return ["ok": false, "error": "这个应用还没装好，请重新点「装到桌面」"] }
        guard let launcher = Bundle.main.executableURL?.path else { return ["ok": false, "error": "找不到碧琪自己"] }
        let fm = FileManager.default
        var book = ledger()
        if let old = book[id] { removeBundle(URL(fileURLWithPath: old, isDirectory: true)) }
        let bundle = applicationsDir.appendingPathComponent("\(app.name).app", isDirectory: true)
        if fm.fileExists(atPath: bundle.path) && !isOurs(bundle) {
            return ["ok": false, "error": "「应用程序」里已经有一个同名的应用，换个名字再装"]
        }
        removeBundle(bundle)
        do {
            let contents = bundle.appendingPathComponent("Contents", isDirectory: true)
            let macos = contents.appendingPathComponent("MacOS", isDirectory: true)
            let resources = contents.appendingPathComponent("Resources", isDirectory: true)
            try fm.createDirectory(at: macos, withIntermediateDirectories: true)
            try fm.createDirectory(at: resources, withIntermediateDirectories: true)
            let icon = app.dir.appendingPathComponent("icon.icns")
            if fm.fileExists(atPath: icon.path) {
                try fm.copyItem(at: icon, to: resources.appendingPathComponent("icon.icns"))
            } else if let own = Bundle.main.url(forResource: "PinkieAppIcon", withExtension: "icns") {
                try? fm.copyItem(at: own, to: resources.appendingPathComponent("icon.icns"))
            }
            let info: [String: Any] = [
                "CFBundleExecutable": "run",
                "CFBundleIdentifier": "com.cle0726.super-pinkie.app.\(id)",
                "CFBundleName": app.name,
                "CFBundleDisplayName": app.name,
                "CFBundlePackageType": "APPL",
                "CFBundleIconFile": "icon",
                "CFBundleShortVersionString": "1.0",
                "LSMinimumSystemVersion": "13.0",
                "PinkieAppId": id,
            ]
            let plist = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            try plist.write(to: contents.appendingPathComponent("Info.plist"))
            let run = macos.appendingPathComponent("run")
            try fm.copyItem(at: URL(fileURLWithPath: launcher), to: run)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: run.path)
            guard adhocSign(bundle) else { throw CocoaError(.fileWriteUnknown) }
        } catch {
            try? fm.removeItem(at: bundle)
            return ["ok": false, "error": "没能建好应用：\(error.localizedDescription)"]
        }
        LSRegisterURL(bundle as CFURL, true)
        book[id] = bundle.path
        saveLedger(book)
        return ["ok": true, "path": bundle.path]
    }

    static func uninstall(_ id: String) -> [String: Any] {
        guard isValidId(id) else { return ["ok": false, "error": "不认识的应用"] }
        var book = ledger()
        if let path = book.removeValue(forKey: id) {
            let bundle = URL(fileURLWithPath: path, isDirectory: true)
            removeBundle(bundle)
            if isOurs(bundle) {
                book[id] = path
                saveLedger(book)
                return ["ok": false, "error": "「应用程序」里的图标删不掉，可能正开着"]
            }
        }
        saveLedger(book)
        return ["ok": true]
    }

    static func open(_ id: String) -> [String: Any] {
        guard readApp(id) != nil, let launcher = Bundle.main.executableURL else { return ["ok": false, "error": "这个应用不在了"] }
        let task = Process()
        task.executableURL = launcher
        task.arguments = [flag, id]
        do { try task.run() } catch { return ["ok": false, "error": "打不开：\(error.localizedDescription)"] }
        return ["ok": true]
    }

    // Launcher --app-window <id>, or a copied Launcher inside a work's .app: one window with only this work in it.
    // Returns false for Super Pinkie itself (no flag, no PinkieAppId in its Info.plist).
    static func requestedAppId(_ arguments: [String], bundle: Bundle = .main) -> String? {
        if let index = arguments.firstIndex(of: flag) { return index + 1 < arguments.count ? arguments[index + 1] : "" }
        return bundledAppId(bundle)
    }

    static func runIfRequested(_ arguments: [String]) -> Bool {
        guard let id = requestedAppId(arguments) else { return false }
        let application = NSApplication.shared
        let controller = PinkieAppWindowController(app: readApp(id))
        PinkieAppWindowController.hold = controller  // NSApp.delegate is weak
        application.setActivationPolicy(.regular)
        application.delegate = controller
        application.mainMenu = controller.makeMenu()
        application.run()
        return true
    }
}

final class PinkieAppWindowController: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    static var hold: PinkieAppWindowController?
    let app: PinkieAppWindow.App?
    private var window: NSWindow?

    init(app: PinkieAppWindow.App?) {
        self.app = app
        super.init()
    }

    func makeMenu() -> NSMenu {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出 \(app?.name ?? "应用")", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        return main
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(x: 0, y: 0, width: 1100, height: 760)
        let window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = app?.name ?? "碧琪应用"
        window.minSize = NSSize(width: 360, height: 260)
        window.isReleasedWhenClosed = false
        window.delegate = self
        if let app {
            let web = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
            web.navigationDelegate = self
            web.uiDelegate = self
            web.loadFileURL(app.dir.appendingPathComponent("index.html"), allowingReadAccessTo: app.dir)
            window.contentView = web
            if let image = NSImage(contentsOf: app.dir.appendingPathComponent("icon.icns")) { NSApp.applicationIconImage = image }
        } else {
            let label = NSTextField(wrappingLabelWithString: "这个应用已经卸载了，或者文件不在了。可以在碧琪的作品库里重新「装到桌面」。")
            label.frame = NSRect(x: 32, y: 32, width: 456, height: 80)
            let holder = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 150))
            holder.addSubview(label)
            window.setContentSize(holder.frame.size)
            window.contentView = holder
        }
        window.center()
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // PR②：<input type=file> 只有安装时勾了「读你选的文件」才弹文件框；没勾就当用户取消。
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        guard app?.files == true else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.begin { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    // The work stays inside its own folder: no navigation to the network or to other files.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let dir = app?.dir.standardizedFileURL.path else { decisionHandler(.cancel); return }
        if ["about", "data", "blob"].contains(url.scheme ?? "") { decisionHandler(.allow); return }
        if let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), ["http", "https"].contains(scheme) {
            let origin = scheme + "://" + host + (url.port.map { ":\($0)" } ?? "")
            decisionHandler(app?.network.contains(origin) == true ? .allow : .cancel); return
        }
        decisionHandler(url.isFileURL && url.standardizedFileURL.path.hasPrefix(dir) ? .allow : .cancel)
    }
}
