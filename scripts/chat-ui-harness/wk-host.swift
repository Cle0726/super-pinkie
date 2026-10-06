// Tiny WKWebView host for the chat-ui harness: renders a page at full size in the
// same engine as the App (a 4x4 on-screen window keeps WebKit from throttling rAF,
// unlike a hidden browser pane), runs scripted JS at given times, and saves
// snapshots as numbered PNGs named f<frame>_<ms>.png.
//   swiftc -O wk-host.swift -o /tmp/wk
//   WK_LIGHT=1 WK_W=1920 WK_H=1080 WK_SNAPW=1920 /tmp/wk <url> <outDir> <seconds> <fps> [<ms>=<js> ...]
// WK_LIGHT=1 forces the light appearance. Snapshots lag the screen a little while
// layers animate, so time things with rAF inside the page and use frames for looks.
import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 5, let url = URL(string: args[1]) else {
  print("usage: wk <url> <outDir> <seconds> <fps> [ms=js ...]"); exit(2)
}
let outDir = args[2]
let seconds = Double(args[3]) ?? 6
let fps = Double(args[4]) ?? 12
var actions: [(Double, String)] = []
for a in args.dropFirst(5) {
  if let eq = a.firstIndex(of: "="), let ms = Double(a[a.startIndex..<eq]) { actions.append((ms, String(a[a.index(after: eq)...]))) }
}
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
if ProcessInfo.processInfo.environment["WK_LIGHT"] == "1" { app.appearance = NSAppearance(named: .aqua) }
let size = NSSize(width: Double(ProcessInfo.processInfo.environment["WK_W"] ?? "1440") ?? 1440, height: Double(ProcessInfo.processInfo.environment["WK_H"] ?? "900") ?? 900)
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 4, height: 4), styleMask: [.borderless], backing: .buffered, defer: false)
win.isReleasedWhenClosed = false
win.level = .floating
let cfg = WKWebViewConfiguration()
cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
let web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
win.contentView?.addSubview(web)
win.orderFrontRegardless()
web.load(URLRequest(url: url))

let start = Date()
var frame = 0
var pending = false
for (ms, js) in actions {
  DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000) {
    web.evaluateJavaScript(js) { result, error in
      if let error = error { print("js@\(Int(ms)) error: \(error.localizedDescription)") }
      else if let result = result { print("js@\(Int(ms)) -> \(result)") }
    }
  }
}
let timer = Timer(timeInterval: 1 / fps, repeats: true) { t in
  let elapsed = Date().timeIntervalSince(start)
  if elapsed > seconds { t.invalidate(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { exit(0) }; return }
  if pending { return }
  pending = true
  let cfg = WKSnapshotConfiguration()
  cfg.rect = NSRect(origin: .zero, size: size)
  cfg.snapshotWidth = NSNumber(value: Double(ProcessInfo.processInfo.environment["WK_SNAPW"] ?? "720") ?? 720)
  let stamp = Int(elapsed * 1000)
  web.takeSnapshot(with: cfg) { image, _ in
    pending = false
    guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { return }
    let name = String(format: "%@/f%04d_%05d.png", outDir, frame, stamp)
    frame += 1
    try? png.write(to: URL(fileURLWithPath: name))
  }
}
RunLoop.main.add(timer, forMode: .common)
app.run()
