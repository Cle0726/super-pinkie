import AppKit
import WebKit

@main final class NativeCursorAcceptance: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    static var keeper: NativeCursorAcceptance?
    let control = BrowserControlController()
    var browser: WKWebView!
    var window: NSWindow!
    var evidence: [String: Any] = ["checks": []]
    static func main() {
        let app=NSApplication.shared;let delegate=NativeCursorAcceptance();keeper=delegate
        app.delegate=delegate;app.setActivationPolicy(.accessory);app.run()
    }
    func applicationDidFinishLaunching(_ note: Notification) {
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        browser=WKWebView(frame:NSRect(x:0,y:0,width:900,height:650),configuration:config)
        browser.navigationDelegate=self
        window=NSWindow(contentRect:browser.frame,styleMask:[.titled],backing:.buffered,defer:false)
        window.title="独立浏览器控件测试（不是用户App）";window.contentView=browser;window.orderBack(nil)
        control.webView={ [weak self] in self?.browser };control.isOpen={true};control.openWorkspace={ [weak self] _ in self?.browser }
        control.clicked={_,_,_ in}
        browser.loadHTMLString(Self.html,baseURL:URL(string:"http://127.0.0.1/native-pointer-fixture"))
    }
    func webView(_ webView: WKWebView,didStartProvisionalNavigation navigation:WKNavigation!){control.didStart(navigation)}
    func webView(_ webView:WKWebView,didCommit navigation:WKNavigation!){control.didCommit(navigation)}
    var ran=false
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){control.didFinish(navigation);if !ran {ran=true;Task {@MainActor in await run()}}}
    @MainActor func ask(_ params:[String:Any]) async -> [String:Any] {
        await withCheckedContinuation { continuation in control.handle(params){continuation.resume(returning:$0)} }
    }
    @MainActor func js(_ source:String) async -> Any? { try? await browser.evaluateJavaScript(source) }
    func require(_ ok:Bool,_ name:String) throws {
        if !ok {throw NSError(domain:"NativeCursorAcceptance",code:1,userInfo:[NSLocalizedDescriptionKey:name])}
        var checks=evidence["checks"] as? [String] ?? [];checks.append(name);evidence["checks"]=checks
    }
    @MainActor func run() async {
        do {
            window.makeKeyAndOrderFront(nil);NSApplication.shared.activate(ignoringOtherApps:true)
            try? await Task.sleep(nanoseconds:300_000_000)
            let hover=await ask(["action":"hover","selector":"#menu"]);evidence["hover"]=hover
            evidence["geometry"]=["number":window.windowNumber,"visible":window.isVisible,"flipped":browser.isFlipped,"bounds":NSStringFromRect(browser.bounds),"frame":NSStringFromRect(browser.frame),"window":NSStringFromRect(window.frame),"subviews":browser.subviews.map {String(describing:type(of:$0))}]
            evidence["events"]=await js("document.body.dataset.events||''")
            try require(hover["ok"] as? Bool == true,"悬停指令完成")
            try require(await js("getComputedStyle(document.querySelector('#option')).display !== 'none'") as? Bool == true,"原生悬停真正触发CSS :hover")
            try require(await js("document.querySelector('#menu').dataset.trusted") as? String == "true","悬停事件由WebKit生成且isTrusted为true")
            let clicked=await ask(["action":"click","selector":"#option","input":"native"]);evidence["clicked"]=clicked
            let observed1 = await js("document.querySelector('#option').dataset.clicks")
            try require(clicked["ok"] as? Bool == true && (observed1 as? String)=="1","悬停展开后原生点击只提交一次")
            let drag=await ask(["action":"drag","selector":"#range","toX":320,"toY":175,"durationMs":300]);evidence["drag"]=drag
            let observed2 = await js("Number(document.querySelector('#range').value)")
            try require(drag["ok"] as? Bool == true && (observed2 as? Int ?? 0)>75,"原生拖拽改变滑块值")
            try require(await js("document.querySelector('#range').dataset.trusted") as? String == "true","滑块input事件为真实原生默认行为")
            let exact=await ask(["action":"set_slider","selector":"#range","sliderValue":73]);evidence["setSlider"]=exact
            let exactValue=await js("Number(document.querySelector('#range').value)")
            try require(exact["ok"] as? Bool == true && exactValue as? Int == 73,"专用滑杆工具准确设为73并回读")
            let select=await ask(["action":"drag","x":30,"y":254,"toX":230,"toY":254,"durationMs":250]);evidence["selection"]=select
            let observed3 = await js("getSelection().toString()")
            try require(select["ok"] as? Bool == true && !(observed3 as? String ?? "").isEmpty,"原生拖拽可以选中文字")
            let canvas=await ask(["action":"drag","selector":"canvas","toName":"画布终点","toRole":"button","durationMs":250]);evidence["canvas"]=canvas
            let observed4 = await js("Number(document.querySelector('canvas').dataset.moves||0)")
            try require(canvas["ok"] as? Bool == true && (observed4 as? Int ?? 0)>3,"Canvas收到连续原生拖拽事件")
            browser.pageZoom=1.25
            let zoom=await ask(["action":"click","selector":"#single","input":"native"]);evidence["zoom"]=zoom
            let observed5 = await js("document.querySelector('#single').dataset.clicks")
            try require(zoom["ok"] as? Bool == true && (observed5 as? String)=="1","网页缩放后指针坐标仍准确")
            browser.pageZoom=1
            for _ in 0..<40 {let x=await ask(["action":"click","selector":"#single","input":"native","observe":false]);try require(x["ok"] as? Bool == true,"重复原生点击成功")}
            evidence["repeatedClicks"]=await js("document.querySelector('#single').dataset.clicks")
            _ = await ask(["action":"snapshot"])
            try require(await js("document.querySelector('#single').dataset.clicks") as? String == "41","连续40次操作无重复提交且指针覆盖层不拦截点击")
            let blocked=await ask(["action":"click","selector":"#blocked","input":"native","targetTimeoutMs":0]);evidence["blocked"]=blocked
            let observed6 = await js("document.querySelector('#blocked').dataset.clicks||'0'")
            try require(blocked["ok"] as? Bool == false && (observed6 as? String)=="0","被遮挡控件不会误点击")
            let interrupted:[String:Any]=await withCheckedContinuation { continuation in
                control.handle(["id":"drag-cancel","action":"drag","x":470,"y":170,"toX":580,"toY":200,"durationMs":900]) { continuation.resume(returning:$0) }
                DispatchQueue.main.asyncAfter(deadline:.now()+0.18){self.control.handle(["action":"cancel","requestId":"drag-cancel"]){_ in}}
            }
            evidence["cancel"]=interrupted
            try require(interrupted["ok"] as? Bool == false && interrupted["mayHaveExecuted"] as? Bool == true,"中途取消返回部分可能生效，不自动重放")
            try require(await js("document.querySelector('canvas').dataset.down") as? String == "false","取消会释放按住的鼠标键")
            let takeover:[String:Any]=await withCheckedContinuation { continuation in
                control.handle(["id":"drag-takeover","action":"drag","x":470,"y":170,"toX":580,"toY":200,"durationMs":900]) { continuation.resume(returning:$0) }
                DispatchQueue.main.asyncAfter(deadline:.now()+0.18){self.control.userDidInteract()}
            }
            evidence["takeover"]=takeover
            let observed7 = await js("document.querySelector('canvas').dataset.down")
            try require(takeover["ok"] as? Bool == false && (observed7 as? String)=="false","用户接管中断拖拽并释放按键")
            let refused=await ask(["action":"click","selector":"#single","input":"native"])
            try require(refused["ok"] as? Bool == false,"接管期间拒绝新的自动鼠标动作")
            evidence["status"]="passed"
        } catch { evidence["status"]="failed";evidence["error"]=error.localizedDescription }
        evidence["keyboardDebug"]=await js("JSON.stringify({active:document.activeElement.id,keys:document.body.dataset.keys,value:document.querySelector('#range').value})")
        evidence["responder"]=String(describing:window.firstResponder)
        let path=ProcessInfo.processInfo.environment["PINKIE_CURSOR_RESULT"]!
        try? JSONSerialization.data(withJSONObject:evidence,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:path))
        window.close();NSApplication.shared.terminate(nil)
    }
    static let html=#"""
    <!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px system-ui}#menu{position:absolute;left:20px;top:20px;width:180px;height:80px;background:#eee}#option{display:none;margin-top:26px}#menu:hover #option{display:block}#range{position:absolute;left:20px;top:160px;width:320px}#text{margin:0;line-height:28px;position:absolute;left:25px;top:240px;user-select:text}canvas{position:absolute;left:430px;top:120px;width:220px;height:120px;border:1px solid}#single{position:absolute;left:20px;top:340px;width:180px;height:42px}#blocked{position:absolute;left:20px;top:430px}#cover{position:absolute;left:15px;top:425px;width:200px;height:60px;background:#aaa}</style>
    <div id="menu">悬停菜单<button id="option">菜单选项</button></div><input id="range" type="range" value="20"><p id="text">Browser pointer selects this passage accurately.</p><canvas width="220" height="120"></canvas><div role="button" aria-label="画布终点" style="position:absolute;left:570px;top:210px;width:12px;height:12px;background:#ddccff"></div><button id="single">点击一次</button><button id="blocked">遮挡按钮</button><div id="cover"></div><script>
    document.addEventListener('keydown',e=>document.body.dataset.keys=(document.body.dataset.keys||'')+JSON.stringify({key:e.key,trusted:e.isTrusted,active:document.activeElement.id}));document.addEventListener('pointermove',e=>document.body.dataset.events=JSON.stringify({x:e.clientX,y:e.clientY,trusted:e.isTrusted,target:e.target.id}));for(const b of document.querySelectorAll('button'))b.onclick=e=>{b.dataset.clicks=String(Number(b.dataset.clicks||0)+1);b.dataset.trusted=String(e.isTrusted)};
    menu.onpointerenter=e=>menu.dataset.trusted=String(e.isTrusted);range.oninput=e=>range.dataset.trusted=String(e.isTrusted);
    const c=document.querySelector('canvas');c.onpointerdown=e=>{c.dataset.down='true';c.setPointerCapture(e.pointerId)};c.onpointermove=e=>{if(c.dataset.down==='true')c.dataset.moves=String(Number(c.dataset.moves||0)+1)};c.onpointerup=e=>c.dataset.down='false';
    </script>
    """#
}
