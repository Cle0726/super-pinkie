import Foundation

// Compiled together with desktop/macos/pinkie/Sources/AppWindow.swift by tests/desktop-app-entry.test.mjs.
// `driver install|uninstall <id>` prints the native reply as JSON. With no arguments it behaves like the copied
// Launcher inside a work's .app: it records which work it was started for, then exits instead of opening a window.
@main
enum DesktopAppEntryDriver {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args.count == 2, ["install", "uninstall"].contains(args[0]) {
            let reply = PinkieAppWindow.handle(args[0] == "install" ? "installApp" : "uninstallApp", ["appId": args[1]])
            let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data()
            print(String(data: data, encoding: .utf8) ?? "{}")
            return
        }
        guard let id = PinkieAppWindow.requestedAppId(CommandLine.arguments) else { exit(3) }
        let marker = PinkieAppWindow.stateRoot.appendingPathComponent("launched-\(id).txt")
        try? (Bundle.main.bundlePath + "\n").write(to: marker, atomically: true, encoding: .utf8)
    }
}
