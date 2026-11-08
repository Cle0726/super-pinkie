// Minimal WKWebView host driven by JSON lines on stdin. Same WebKit as 超級碧琪.app.
import AppKit
import WebKit

final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var web: WKWebView!
  var userScripts: [String] = []
  func applicationDidFinishLaunching(_ n: Notification) {
    let w = Double(ProcessInfo.processInfo.environment["WK_W"] ?? "1280")!, h = Double(ProcessInfo.processInfo.environment["WK_H"] ?? "800")!
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .nonPersistent()
    cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
    cfg.mediaTypesRequiringUserActionForPlayback = []
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: cfg)
    web.navigationDelegate = self; web.uiDelegate = self
    window = NSWindow(contentRect: NSRect(x: 40, y: 40, width: w, height: h), styleMask: [.titled], backing: .buffered, defer: false)
    window.contentView = web; window.title = "wkhost-qa"
    window.level = .floating  // 被遮住时 WebKit 把页面当成 hidden，CSS 动画和 rAF 都停
    window.orderFrontRegardless()
    NSApp.activate(ignoringOtherApps: true)
    if let appearance = ProcessInfo.processInfo.environment["WK_DARK"], appearance == "1" { window.appearance = NSAppearance(named: .darkAqua) }
    DispatchQueue.global().async { self.readLoop() }
    emit(["event": "ready"])
  }
  func emit(_ o: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s); fflush(stdout) }
  }
  func readLoop() {
    while let line = readLine() {
      guard let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
      DispatchQueue.main.async { self.handle(o) }
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
  }
  func handle(_ o: [String: Any]) {
    let id = o["id"] as? Int ?? 0, op = o["op"] as? String ?? ""
    switch op {
    case "script":
      let src = o["js"] as? String ?? ""
      web.configuration.userContentController.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
      emit(["id": id, "ok": true])
    case "load":
      web.load(URLRequest(url: URL(string: o["url"] as! String)!)); emit(["id": id, "ok": true])
    case "eval":
      let js = o["js"] as? String ?? ""
      web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
        switch r {
        case .success(let v):
          var out: Any = NSNull()
          if JSONSerialization.isValidJSONObject([v]) { out = v } else { out = "\(v)" }
          self.emit(["id": id, "ok": true, "result": out])
        case .failure(let e): self.emit(["id": id, "ok": false, "error": "\(e)"])
        }
      }
    case "shot":
      let cfg = WKSnapshotConfiguration(); cfg.afterScreenUpdates = true
      web.takeSnapshot(with: cfg) { img, err in
        guard let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { self.emit(["id": id, "ok": false, "error": "\(String(describing: err))"]); return }
        try? png.write(to: URL(fileURLWithPath: o["path"] as! String)); self.emit(["id": id, "ok": true, "w": rep.pixelsWide])
      }
    case "winid":
      emit(["id": id, "ok": true, "winid": window.windowNumber])
    case "resize":
      let w = o["w"] as! Double, h = o["h"] as! Double
      window.setContentSize(NSSize(width: w, height: h)); emit(["id": id, "ok": true])
    case "dark":
      window.appearance = NSAppearance(named: (o["on"] as? Bool ?? false) ? .darkAqua : .aqua); emit(["id": id, "ok": true])
    case "quit": NSApp.terminate(nil)
    default: emit(["id": id, "ok": false, "error": "unknown op"])
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { emit(["event": "loaded"]) }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let host = Host(); app.delegate = host
app.run()
