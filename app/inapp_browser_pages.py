"""HTML for 碧琪的浏览器's own surfaces on Windows.

CHROME_HTML is the toolbar (and the node sheet) drawn in a small WebView2
above the pages; START_HTML is the empty-tab page.  Both follow the Mac
browser panel (Launcher.swift makeBrowserPanel / applyNightAppearance /
loadBrowserStartPage): the same pink paper palette and its night colours,
one compact toolbar row with a drag grip, SF-Symbols-style line icons,
a rounded address pill, the 「碧琪正在使用浏览器」 activity pill and a
float / dock / fill presentation menu.  Tabs only take a row when there is
more than one.

The chrome talks to the host only through chrome.webview.postMessage and
never sees node secrets (the manager sends display fields only).
"""

CHROME_HTML = r"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>碧琪的浏览器</title>
<style>
:root{
  --panel:#fff9fc;--bar:#ffedf7;--field:#fffbfd;--field-line:#ecd3e1;--text:#634a59;--muted:#9a7187;--icon:#638c96;
  --hover:#f7dcea;--accent:#d15491;--accent-soft:#d1549120;--ok:#3f9a6b;--warn:#c4573a;--line:#f0d9e5;--card:#fffdfe;--shadow:0 18px 50px #9f4c7426;--on-accent:#fff;
}
@media (prefers-color-scheme: dark){:root{
  --panel:#1a131d;--bar:#241b29;--field:#ffffff12;--field-line:#ffffff1c;--text:#f0e6eb;--muted:#b8a6b0;--icon:#cfbdc9;
  --hover:#ffffff14;--accent:#ff9cc4;--accent-soft:#ff9cc424;--ok:#6fd39c;--warn:#ff9a7a;--line:#ffffff17;--card:#2a2030;--shadow:0 18px 50px #0008;--on-accent:#2a1020;
}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bar);color:var(--text);font:13px/1.35 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;overflow:hidden;user-select:none;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:default}
svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;display:block}
.ib{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--icon);flex:none;transition:background .12s,color .12s}
.ib:hover:not(:disabled){background:var(--hover)}.ib:active:not(:disabled){transform:scale(.96)}
.ib:disabled{opacity:.32}.ib.on{color:var(--accent)}
#bar{display:flex;align-items:center;gap:2px;height:44px;padding:0 6px 0 4px;background:var(--bar)}
#grip{width:22px;height:30px;display:grid;place-items:center;color:var(--muted);font-size:16px;letter-spacing:-1px;flex:none}
#addrwrap{flex:1;min-width:120px;position:relative;margin:0 4px}
#addr{width:100%;height:30px;border:1px solid transparent;border-radius:15px;background:var(--field);color:var(--text);padding:0 34px 0 30px;font:inherit;outline:none;user-select:text;transition:border-color .12s,box-shadow .12s}
#addr::placeholder{color:var(--muted)}
#addr:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#lock{position:absolute;left:10px;top:8px;width:14px;height:14px;color:var(--muted)}
#lock svg{width:14px;height:14px}
#spin{position:absolute;right:10px;top:8px;width:14px;height:14px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--accent);animation:r .8s linear infinite;display:none}
body.loading #spin{display:block}@keyframes r{to{transform:rotate(360deg)}}
#agent{display:none;align-items:center;gap:6px;height:24px;padding:0 10px;margin-right:2px;border-radius:12px;background:var(--accent-soft);color:var(--accent);font-size:11.5px;font-weight:600;white-space:nowrap;flex:none}
body.agent #agent{display:flex}#agent i{width:6px;height:6px;border-radius:3px;background:var(--accent);animation:p 1s ease-in-out infinite alternate}
@keyframes p{from{opacity:.35}to{opacity:1}}
#node{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px 0 8px;border-radius:13px;color:var(--icon);flex:none;max-width:190px;font-size:12px}
#node:hover{background:var(--hover)}#node .d{width:7px;height:7px;border-radius:50%;background:var(--muted);opacity:.55;flex:none}
#node.on{color:var(--text)}#node.on .d{background:var(--ok);opacity:1;box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
#node.bad .d{background:var(--warn);opacity:1}#node span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#menu{position:fixed;top:40px;right:40px;min-width:200px;padding:6px;border-radius:12px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);display:none;z-index:5}
#menu.open{display:block}
.mi{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;border-radius:8px;color:var(--text);text-align:left}
.mi:hover{background:var(--hover)}.mi svg{color:var(--icon)}.mi.on svg,.mi.on{color:var(--accent)}
.sep{height:1px;margin:5px 4px;background:var(--line)}
#tabs{display:none;align-items:center;gap:4px;height:34px;padding:0 8px 6px;background:var(--bar);overflow:hidden}
body.multi #tabs{display:flex}
.tab{display:flex;align-items:center;gap:6px;min-width:70px;max-width:220px;flex:1 1 180px;height:28px;padding:0 4px 0 11px;border-radius:9px;color:var(--muted);transition:background .12s}
.tab:hover{background:var(--hover)}.tab.on{background:var(--panel);color:var(--text);box-shadow:0 1px 0 var(--line)}
.tab .t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tab .x{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;opacity:0}.tab:hover .x,.tab.on .x{opacity:.7}.tab .x:hover{background:var(--hover);opacity:1}
.tab .x svg{width:11px;height:11px;stroke-width:2}
.tab .s{width:9px;height:9px;border-radius:50%;border:1.6px solid var(--line);border-top-color:var(--accent);animation:r .8s linear infinite;flex:none}
#sheet{display:none;position:fixed;inset:44px 0 0 0;overflow:auto;background:var(--panel)}
body.multi #sheet{top:78px}body.sheet #sheet{display:block}
.wrap{max-width:860px;margin:0 auto;padding:22px 26px 40px}
.head{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.mark{width:46px;height:46px;border-radius:16px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);background:var(--card);color:var(--accent);box-shadow:var(--shadow);flex:none}
.mark svg{width:22px;height:22px}
h1{font-size:17px;margin:0;font-weight:650}.sub{color:var(--muted);font-size:12.5px;margin-top:2px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:14px}
.row{display:flex;align-items:center;gap:8px}
.inp{flex:1;min-width:0;height:34px;border:1px solid var(--field-line);border-radius:10px;background:var(--field);color:var(--text);padding:0 12px;font:inherit;outline:none;user-select:text}
.inp:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.btn{height:32px;padding:0 14px;border-radius:9px;border:1px solid var(--field-line);background:var(--field);color:var(--text);white-space:nowrap}
.btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}.btn:disabled{opacity:.45}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.btn.primary:hover:not(:disabled){filter:brightness(1.06);color:var(--on-accent)}
#backdrop{position:fixed;left:0;right:0;bottom:0;top:44px;display:none;background:var(--panel) center top/100% auto no-repeat}
body.multi #backdrop{top:78px}body.menu #backdrop{display:block}
.btn.ghost{border-color:transparent;background:none;color:var(--muted)}
#msg{min-height:18px;margin-top:8px;font-size:12px;color:var(--muted)}#msg.err{color:var(--warn)}#msg.ok{color:var(--ok)}
.sw{display:flex;align-items:center;gap:12px}.sw .k{flex:1}.sw b{font-weight:600}.sw small{display:block;color:var(--muted);margin-top:2px}
.tog{position:relative;width:42px;height:24px;border-radius:12px;background:var(--field-line);flex:none;transition:background .15s}
.tog::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0003;transition:left .15s}
.tog.on{background:var(--ok)}.tog.on::after{left:21px}.tog:disabled{opacity:.4}
h2{font-size:12px;font-weight:650;color:var(--muted);margin:20px 2px 8px;letter-spacing:.02em}
.sub-item{display:flex;align-items:center;gap:10px;padding:10px 4px;border-top:1px solid var(--line)}.sub-item:first-child{border-top:0}
.sub-item .n{flex:1;min-width:0}.sub-item b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub-item small{color:var(--muted)}.sub-item .e{color:var(--warn);font-size:12px;margin-top:2px}
#nodes{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.nd{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--card);border:1px solid var(--line);text-align:left;width:100%;transition:border-color .12s,box-shadow .12s}
.nd:hover{border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.nd.sel{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.nd .nm{flex:1;min-width:0}.nd .nm div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nd small{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em}
.lat{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;padding:2px 8px;border-radius:10px;background:var(--field)}
.lat.g{color:var(--ok)}.lat.m{color:#c8902c}.lat.b,.lat.x{color:var(--warn)}.lat.u{color:var(--muted)}
.empty{color:var(--muted);text-align:center;padding:22px;border:1px dashed var(--field-line);border-radius:12px}
.tools{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:20px 2px 8px}.tools h2{margin:0}
.tools .inp{flex:none;width:170px;height:30px}
.note{color:var(--muted);font-size:12px;line-height:1.6;margin-top:16px}
</style></head><body>
<svg width="0" height="0" style="position:absolute"><defs>
<symbol id="i-back" viewBox="0 0 24 24"><path d="M14.5 5.5 8 12l6.5 6.5"/></symbol>
<symbol id="i-fwd" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></symbol>
<symbol id="i-reload" viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5v4.2h-4.2"/></symbol>
<symbol id="i-stop" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>
<symbol id="i-more" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M14.5 5v14"/></symbol>
<symbol id="i-float" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3"/><rect x="11.5" y="11" width="6.5" height="5" rx="1.2"/></symbol>
<symbol id="i-dock" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M14.5 5v14"/></symbol>
<symbol id="i-full" viewBox="0 0 24 24"><path d="M9.5 4.5h-5v5M14.5 19.5h5v-5M4.5 4.5l6 6M19.5 19.5l-6-6"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M9 4.5h6l-1 5 3.5 3.5h-11L10 9.5z"/><path d="M12 13v6.5"/></symbol>
<symbol id="i-ext" viewBox="0 0 24 24"><rect x="4.5" y="6.5" width="13" height="13" rx="2.5"/><path d="M13 4.5h6.5V11M19.5 4.5 11 13"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>
<symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M3.8 12h16.4M12 3.6c2.3 2.3 3.5 5.1 3.5 8.4s-1.2 6.1-3.5 8.4M12 3.6C9.7 5.9 8.5 8.7 8.5 12s1.2 6.1 3.5 8.4"/></symbol>
<symbol id="i-node" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M12 7v5l3 2"/></symbol>
</defs></svg>
<div id="bar">
  <div id="grip" title="拖动移动窗口，双击铺满">⠿</div>
  <button class="ib" id="back" title="后退"><svg><use href="#i-back"/></svg></button>
  <button class="ib" id="fwd" title="前进"><svg><use href="#i-fwd"/></svg></button>
  <button class="ib" id="reload" title="重新加载"><svg><use href="#i-reload"/></svg></button>
  <div id="addrwrap"><span id="lock"><svg><use href="#i-globe"/></svg></span><input id="addr" spellcheck="false" placeholder="输入网址或搜索内容" autocomplete="off"><span id="spin"></span></div>
  <div id="agent" title="碧琪正在操作这个浏览器"><i></i>碧琪正在使用浏览器</div>
  <button id="node" title="浏览器节点：只影响这个浏览器"><span class="d"></span><span id="nodeText">直连</span></button>
  <button class="ib" id="newtab" title="新标签页"><svg><use href="#i-plus"/></svg></button>
  <button class="ib" id="present" title="停靠、悬浮、铺满或在默认浏览器打开"><svg><use href="#i-more"/></svg></button>
  <button class="ib" id="close" title="关闭浏览器"><svg><use href="#i-x"/></svg></button>
</div>
<div id="tabs"></div>
<div id="backdrop"></div>
<div id="menu">
  <button class="mi" data-mode="float"><svg><use href="#i-float"/></svg>悬浮面板</button>
  <button class="mi" data-mode="dock"><svg><use href="#i-dock"/></svg>停靠到右侧</button>
  <button class="mi" data-mode="full"><svg><use href="#i-full"/></svg>铺满屏幕</button>
  <div class="sep"></div>
  <button class="mi" id="pin"><svg><use href="#i-pin"/></svg>窗口置顶</button>
  <button class="mi" id="external"><svg><use href="#i-ext"/></svg>在默认浏览器打开</button>
</div>
<div id="sheet"><div class="wrap">
  <div class="head"><div class="mark"><svg><use href="#i-globe"/></svg></div>
    <div style="flex:1"><h1>浏览器节点</h1><div class="sub">只用于碧琪的这个浏览器。电脑的系统代理和碧琪自己的模型连接都不变。</div></div>
    <button class="btn ghost" id="sheetDone">完成</button></div>
  <div class="card sw"><div class="k"><b>浏览器走节点</b><small id="swHint">开启后浏览器会重新打开一次，当前网页会保留。</small></div><button class="tog" id="toggle" aria-label="浏览器走节点"></button></div>
  <div class="card"><div class="row"><input class="inp" id="sub" placeholder="粘贴订阅链接（Clash / Mihomo / v2ray），或 vmess:// vless:// trojan:// ss:// hysteria2:// 链接" spellcheck="false"><button class="btn primary" id="addSub">添加订阅</button></div><div id="msg"></div></div>
  <h2>订阅</h2><div class="card" id="subs" style="padding:4px 14px"></div>
  <div class="tools"><h2>节点</h2><div class="row"><input class="inp" id="filter" placeholder="筛选节点" spellcheck="false"><button class="btn" id="test">测速</button><button class="btn" id="ipcheck">检查出口 IP</button></div></div>
  <div id="nodes"></div>
  <p class="note">延迟是经过节点访问 gstatic.com 的往返时间。红色「超时」的节点当前连不上，选它网页会打不开。</p>
</div></div>
<script>
const $=id=>document.getElementById(id),post=m=>chrome.webview.postMessage(m),body=document.body;
let state={tabs:[],active:''},vpn={},rid=0,pending={},editing=false;
const call=(op,extra={})=>new Promise(res=>{const id=++rid;pending[id]=res;post({type:'vpn',op,rid:id,...extra});});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=n=>'<svg><use href="#i-'+n+'"/></svg>';
function height(){const h=44+(body.classList.contains('multi')?34:0);post({type:'height',px:Math.round(h*devicePixelRatio)});}
let lastRatio=devicePixelRatio;addEventListener('resize',()=>{if(devicePixelRatio!==lastRatio){lastRatio=devicePixelRatio;height();}});
function renderTabs(){const multi=state.tabs.length>1;if(body.classList.contains('multi')!==multi){body.classList.toggle('multi',multi);height();}
  $('tabs').innerHTML=state.tabs.map(t=>'<div class="tab'+(t.id===state.active?' on':'')+'" data-id="'+esc(t.id)+'" title="'+esc(t.url||t.title)+'">'+(t.loading?'<span class="s"></span>':'')+'<span class="t">'+esc(t.title||'新标签页')+'</span><button class="x" data-close="'+esc(t.id)+'" title="关闭标签页">'+icon('x')+'</button></div>').join('');}
function renderBar(){const t=state.tabs.find(x=>x.id===state.active);if(!editing)$('addr').value=t?.url||'';
  const secure=/^https:/i.test(t?.url||'');$('lock').innerHTML=icon(secure?'lock':'globe');
  $('back').disabled=!state.canGoBack;$('fwd').disabled=!state.canGoForward;$('fwd').style.display=state.canGoForward?'':'none';
  body.classList.toggle('loading',!!t?.loading);body.classList.toggle('agent',!!state.agent);
  $('reload').innerHTML=icon(t?.loading?'stop':'reload');$('reload').title=t?.loading?'停止':'重新加载';
  $('pin').classList.toggle('on',!!state.pinned);
  for(const b of document.querySelectorAll('.mi[data-mode]'))b.classList.toggle('on',b.dataset.mode===(state.mode||'float'));}
function lat(n){if(n.delay)return '<span class="lat '+(n.delay<300?'g':n.delay<800?'m':'b')+'">'+n.delay+' ms</span>';return n.tested?'<span class="lat x">超时</span>':'<span class="lat u">未测</span>';}
function renderNode(){const b=$('node');b.classList.toggle('on',!!vpn.applied);b.classList.toggle('bad',!!vpn.enabled&&!vpn.applied);
  $('nodeText').textContent=vpn.applied?(vpn.selected||'节点'):(vpn.enabled?'节点未生效':'直连');}
function renderSheet(){renderNode();const t=$('toggle');t.classList.toggle('on',!!vpn.enabled);t.disabled=vpn.coreAvailable===false;
  $('swHint').textContent=vpn.coreAvailable===false?'这个安装包缺少节点核心，无法开启。':vpn.enabled?('已开启'+(vpn.selected?'：'+vpn.selected:'')+'。只影响这个浏览器。'):'开启后浏览器会重新打开一次，当前网页会保留。';
  const subs=vpn.subscriptions||[];$('subs').innerHTML=subs.length?subs.map(s=>'<div class="sub-item"><div class="n"><b>'+esc(s.title)+'</b><small>'+esc(s.host||'')+' · '+(s.count||0)+' 个节点'+(s.updatedAt?' · '+new Date(s.updatedAt*1000).toLocaleString():'')+(s.usage?' · '+esc(s.usage):'')+'</small>'+(s.error?'<div class="e">'+esc(s.error)+'</div>':'')+'</div>'+(s.refreshable?'<button class="btn" data-r="'+esc(s.id)+'">刷新</button>':'')+'<button class="btn ghost" data-d="'+esc(s.id)+'">删除</button></div>').join(''):'<div class="empty" style="border:0">还没有订阅。把机场给的订阅链接粘贴到上面。</div>';
  const f=$('filter').value.trim().toLowerCase(),all=vpn.nodes||[],nodes=all.filter(n=>!f||String(n.name).toLowerCase().includes(f));
  $('nodes').innerHTML=nodes.length?nodes.map(n=>'<button class="nd'+(n.name===vpn.selected?' sel':'')+'" data-n="'+esc(n.name)+'"><span class="nm"><div title="'+esc(n.name)+'">'+esc(n.name)+'</div><small>'+esc(n.type)+'</small></span>'+lat(n)+'</button>').join(''):'<div class="empty">'+(all.length?'没有匹配的节点':'添加订阅后这里会列出节点')+'</div>';
  $('test').disabled=!!vpn.testing||!all.length;$('test').textContent=vpn.testing?'测速中…':'测速';
  if(vpn.message)msg(vpn.message,vpn.messageKind||'');}
function msg(text,kind){const m=$('msg');m.textContent=text||'';m.className=kind||'';}
async function act(op,extra,busy){if(busy)msg(busy,'');const r=await call(op,extra);if(r&&r.message)msg(r.message,r.ok===false?'err':'ok');return r;}
chrome.webview.addEventListener('message',e=>{const m=e.data;if(m.type==='state'){state=m;renderTabs();renderBar();}
  else if(m.type==='vpn'){vpn=m.state||{};renderSheet();}
  else if(m.type==='vpnReply'){const r=pending[m.rid];delete pending[m.rid];if(r)r(m.reply||{});}
  else if(m.type==='focusAddress'){$('addr').focus();}
  else if(m.type==='backdrop'&&body.classList.contains('menu')){$('backdrop').style.backgroundImage='url('+m.src+')';}});
function sheet(on){body.classList.toggle('sheet',on);post({type:'panel',open:on});menu(false);if(on)act('status');}
function menu(on){$('menu').classList.toggle('open',on);body.classList.toggle('menu',on);if(on)post({type:'panel',open:true,menu:true});else{$('backdrop').style.backgroundImage='';if(!body.classList.contains('sheet'))post({type:'panel',open:false});}}
$('back').onclick=()=>post({type:'back'});$('fwd').onclick=()=>post({type:'forward'});
$('reload').onclick=()=>{const t=state.tabs.find(x=>x.id===state.active);post({type:t?.loading?'stop':'reload'});};
$('newtab').onclick=()=>post({type:'newTab'});$('close').onclick=()=>post({type:'close'});
$('present').onclick=e=>{e.stopPropagation();menu(!$('menu').classList.contains('open'));};
for(const b of document.querySelectorAll('.mi[data-mode]'))b.onclick=()=>{post({type:'present',mode:b.dataset.mode});menu(false);};
$('pin').onclick=()=>{post({type:'pin'});menu(false);};$('external').onclick=()=>{post({type:'external'});menu(false);};
document.addEventListener('mousedown',e=>{if(!e.target.closest('#menu,#present')&&$('menu').classList.contains('open'))menu(false);});
const grip=e=>{if(e.button!==0)return;if(e.target.closest('button,input,#agent'))return;if(e.detail===2){post({type:'present',mode:state.mode==='full'?'float':'full'});return;}post({type:'drag'});};
$('bar').addEventListener('mousedown',grip);$('tabs').addEventListener('mousedown',e=>{if(e.target===$('tabs'))grip(e);});
$('tabs').addEventListener('click',e=>{const c=e.target.closest('[data-close]');if(c){post({type:'closeTab',id:c.dataset.close});return;}const t=e.target.closest('.tab');if(t)post({type:'activate',id:t.dataset.id});});
$('tabs').addEventListener('auxclick',e=>{const t=e.target.closest('.tab');if(e.button===1&&t)post({type:'closeTab',id:t.dataset.id});});
const addr=$('addr');addr.onfocus=()=>{editing=true;setTimeout(()=>addr.select(),0);};addr.onblur=()=>{editing=false;renderBar();};
addr.onkeydown=e=>{if(e.key==='Enter'){post({type:'navigate',text:addr.value});addr.blur();}else if(e.key==='Escape')addr.blur();};
$('node').onclick=()=>sheet(!body.classList.contains('sheet'));$('sheetDone').onclick=()=>sheet(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('menu').classList.contains('open'))menu(false);else if(body.classList.contains('sheet'))sheet(false);}
  if(e.ctrlKey&&e.key.toLowerCase()==='l'){e.preventDefault();addr.focus();}if(e.ctrlKey&&e.key.toLowerCase()==='t'){e.preventDefault();post({type:'newTab'});}
  if(e.ctrlKey&&e.key.toLowerCase()==='w'){e.preventDefault();post({type:'closeTab',id:state.active});}});
$('addSub').onclick=async()=>{const url=$('sub').value.trim();if(!url){msg('先粘贴订阅链接。','err');return;}$('addSub').disabled=true;const r=await act('add',{url},'正在下载并解析订阅…');$('addSub').disabled=false;if(r.ok)$('sub').value='';};
$('sub').onkeydown=e=>{if(e.key==='Enter')$('addSub').click();};
$('subs').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.r)act('refresh',{id:b.dataset.r},'正在刷新订阅…');if(b.dataset.d&&confirm('删除这个订阅和它的节点？'))act('remove',{id:b.dataset.d});};
$('nodes').onclick=e=>{const b=e.target.closest('.nd');if(b)act('select',{name:b.dataset.n});};
$('toggle').onclick=()=>act('enable',{on:!vpn.enabled},vpn.enabled?'正在关闭节点…':'正在开启节点，浏览器会重新打开…');
$('test').onclick=()=>act('test',{},'正在测速，最多需要十几秒…');$('ipcheck').onclick=()=>{act('open_ip_check');sheet(false);};
$('filter').oninput=renderSheet;
height();post({type:'hello'});
</script></body></html>
"""

START_HTML = r"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>新标签页</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#fffafd,#f9edf5);font:14px "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;color:#70425b;user-select:none}
main{text-align:center;padding:36px}
.mark{width:58px;height:58px;margin:0 auto 18px;display:grid;place-items:center;border:1px solid #d8679b45;border-radius:20px;background:#fff9;box-shadow:0 14px 38px #9f4c7420;font-size:25px}
p{margin:0;color:#9a7187}
@media(prefers-color-scheme:dark){body{background:linear-gradient(145deg,#151016,#211825);color:#f2e7ec}.mark{background:#ffffff0f;border-color:#ff7fb340;box-shadow:0 14px 38px #0006}p{color:#b09aa3}}
</style></head><body><main><div class="mark">◎</div><p>在上方输入网址或搜索内容</p></main></body></html>
"""
