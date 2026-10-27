import AppKit
import WebKit

@main final class NativeBrowserAgentHost: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    static var keeper: NativeBrowserAgentHost?
    let control=BrowserControlController(),endpoint=BrowserControlEndpoint()
    var browser:WKWebView!,window:NSWindow!,runner:Process?,started=false
    static func main(){let app=NSApplication.shared;let delegate=NativeBrowserAgentHost();keeper=delegate;app.delegate=delegate;app.setActivationPolicy(.accessory);app.run()}
    func applicationDidFinishLaunching(_ n:Notification){
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        browser=WKWebView(frame:NSRect(x:0,y:0,width:960,height:740),configuration:config);browser.navigationDelegate=self
        window=NSWindow(contentRect:browser.frame,styleMask:[.titled,.closable],backing:.buffered,defer:false)
        window.title="碧琪浏览器能力验收（隔离端口）";window.contentView=browser;window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        control.webView={ [weak self] in self?.browser };control.isOpen={true};control.openWorkspace={ [weak self] _ in self?.browser };control.clicked={_,_,_ in}
        do{try endpoint.start{[weak self] body,done in DispatchQueue.main.async{
            guard let self else{return}
            if body["action"] as? String == "qa-oracle" {
                self.browser.evaluateJavaScript("JSON.parse(JSON.stringify(window.qa))"){value,error in done(["id":body["id"] ?? "","ok":error == nil,"result":value ?? [:]])}
            }else{self.control.handle(body,completion:done)}
        }}}catch{NSApp.terminate(nil);return}
        browser.loadHTMLString("<!doctype html><title>独立浏览器验收</title><body style='font:16px system-ui;padding:30px'>Gemini 3.8 浏览器控件验收 · 独立端口</body>",baseURL:URL(string:ProcessInfo.processInfo.environment["PINKIE_BROWSER_QA_BASE"]!))
    }
    func webView(_ w:WKWebView,didStartProvisionalNavigation n:WKNavigation!){control.didStart(n)}
    func webView(_ w:WKWebView,didCommit n:WKNavigation!){control.didCommit(n)}
    func webView(_ w:WKWebView,didFinish n:WKNavigation!){control.didFinish(n);if !started{started=true;DispatchQueue.main.asyncAfter(deadline:.now()+0.3){self.startRunner()}}}
    func webView(_ w:WKWebView,didFail n:WKNavigation!,withError e:Error){control.didFinish(n,error:e)}
    func webView(_ w:WKWebView,didFailProvisionalNavigation n:WKNavigation!,withError e:Error){control.didFinish(n,error:e)}
    func startRunner(){
        let dir=ProcessInfo.processInfo.environment["PINKIE_BROWSER_QA_DIR"]!,p=Process();runner=p
        p.executableURL=URL(fileURLWithPath:"/usr/bin/env");p.arguments=["node",dir+"/gemini-browser-acceptance.mjs"]
        var env=ProcessInfo.processInfo.environment;env["PINKIE_APP_BROWSER_ENDPOINT"]=BrowserControlEndpoint.environmentValue();p.environment=env
        let log=dir+"/gemini-browser-run.log";FileManager.default.createFile(atPath:log,contents:nil);let file=FileHandle(forWritingAtPath:log);p.standardOutput=file;p.standardError=file
        p.terminationHandler={_ in DispatchQueue.main.async{self.endpoint.stop();self.window.close();NSApp.terminate(nil)}}
        do{try p.run();BrowserControlEndpoint.authorizeGateway(p.processIdentifier)}catch{endpoint.stop();NSApp.terminate(nil)}
    }
    func applicationWillTerminate(_ n:Notification){if runner?.isRunning==true{runner?.terminate()};endpoint.stop()}
}
