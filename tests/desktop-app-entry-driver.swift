import Foundation
import WebKit

// Compiled together with desktop/macos/pinkie/Sources/AppWindow.swift by tests/desktop-app-entry.test.mjs.
// `driver install|uninstall <id>` prints the native reply as JSON. `driver decide <dir> <ticked,origins> <url>` prints
// allow / cancel from the work window's navigation policy. With no arguments it behaves like the copied
// Launcher inside a work's .app: it records which work it was started for, then exits instead of opening a window.
final class NavigationTo: WKNavigationAction {
    let target: URLRequest
    init(_ url: String) { target = URLRequest(url: URL(string: url)!); super.init() }
    override var request: URLRequest { target }
}

@main
enum DesktopAppEntryDriver {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args.count == 4, args[0] == "decide" {
            let network = args[2].split(separator: ",").map(String.init)
            let app = PinkieAppWindow.App(id: "w0123456789abcde", name: "t", dir: URL(fileURLWithPath: args[1], isDirectory: true), network: network)
            var out = "no-answer"
            PinkieAppWindowController(app: app).webView(WKWebView(), decidePolicyFor: NavigationTo(args[3])) { out = $0 == .allow ? "allow" : "cancel" }
            print(out)
            return
        }
        if args.count == 2, ["install", "uninstall"].contains(args[0]) {
            let reply = PinkieAppWindow.handle(args[0] == "install" ? "installApp" : "uninstallApp", ["appId": args[1]])
            let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data()
            print(String(data: data, encoding: .utf8) ?? "{}")
            return
        }
        // `driver version` tells two builds apart (the test compiles one with -D PINKIE_DRIVER_V2 as the "upgraded" Launcher).
        if args == ["version"] {
            #if PINKIE_DRIVER_V2
            print("v2")
            #else
            print("v1")
            #endif
            return
        }
        // `driver refresh` swaps this driver in as the Launcher of every installed work, as Super Pinkie does at start.
        if args == ["refresh"] {
            let data = (try? JSONSerialization.data(withJSONObject: PinkieAppWindow.refreshInstalled())) ?? Data()
            print(String(data: data, encoding: .utf8) ?? "{}")
            return
        }
        guard let id = PinkieAppWindow.requestedAppId(CommandLine.arguments) else { exit(3) }
        let marker = PinkieAppWindow.stateRoot.appendingPathComponent("launched-\(id).txt")
        try? (Bundle.main.bundlePath + "\n").write(to: marker, atomically: true, encoding: .utf8)
    }
}
