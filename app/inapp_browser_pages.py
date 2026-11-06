"""HTML for 碧琪的浏览器's own surfaces: the toolbar/tab strip/node panel
(CHROME_HTML, shown in a small WebView2 above the pages) and the new-tab
page (START_HTML).  Kept in Python so PyInstaller bundles them with the code.

The chrome talks to the host only through chrome.webview.postMessage; it
never sees node passwords (the manager sends display fields only).
"""

CHROME_HTML = r"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>碧琪的浏览器</title>
<style>
:root{--paper:#faf8f4;--card:#fff;--ink:#1f1d1a;--muted:#77716a;--line:#e6e1d8;--gold:#b8892f;--ice:#3d7fb8;--ok:#2f8a57;--warn:#b5562f;--tab:#efebe3;--hover:#ece7de}
@media (prefers-color-scheme: dark){:root{--paper:#1c1b19;--card:#262421;--ink:#eeeae2;--muted:#a39d93;--line:#3a3732;--gold:#d8ad5a;--ice:#7fb2df;--ok:#5fc08a;--warn:#e08a63;--tab:#2b2926;--hover:#34312c}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--paper);color:var(--ink);font:13px/1.4 "Segoe UI","Microsoft YaHei UI",sans-serif;overflow:hidden;user-select:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;border-radius:7px}
button:disabled{opacity:.35;cursor:default}
#tabs{display:flex;align-items:flex-end;gap:2px;height:36px;padding:6px 8px 0;background:var(--tab);overflow:hidden}
.tab{display:flex;align-items:center;gap:6px;min-width:60px;max-width:220px;flex:1 1 180px;height:30px;padding:0 6px 0 12px;border-radius:9px 9px 0 0;color:var(--muted);cursor:default}
.tab:hover{background:var(--hover)}.tab.on{background:var(--paper);color:var(--ink)}
.tab .t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tab .x{width:20px;height:20px;line-height:18px;text-align:center;font-size:14px;opacity:.6}.tab .x:hover{background:var(--line);opacity:1}
.tab .spin{width:10px;height:10px;border:2px solid var(--line);border-top-color:var(--gold);border-radius:50%;animation:s 0.8s linear infinite;flex:none}
@keyframes s{to{transform:rotate(360deg)}}
#new{width:28px;height:28px;margin-bottom:1px;font-size:17px;color:var(--muted);flex:none}#new:hover{background:var(--hover)}
#bar{display:flex;align-items:center;gap:4px;height:48px;padding:0 8px;border-bottom:1px solid var(--line)}
.nav{width:32px;height:32px;font-size:16px}.nav:hover:not(:disabled){background:var(--hover)}
#addr{flex:1;height:32px;border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--ink);padding:0 14px;font:inherit;outline:none;user-select:text}
#addr:focus{border-color:var(--ice)}
#agent{display:none;align-items:center;gap:6px;padding:0 10px;height:26px;border-radius:13px;background:color-mix(in srgb,var(--gold) 16%,transparent);color:var(--gold);font-size:12px;white-space:nowrap}
#agent.on{display:flex}#agent i{width:7px;height:7px;border-radius:50%;background:var(--gold);animation:p 1s ease-in-out infinite alternate}
@keyframes p{from{opacity:.3}to{opacity:1}}
#node{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--line);border-radius:15px;white-space:nowrap;max-width:220px}
#node:hover{background:var(--hover)}#node .d{width:8px;height:8px;border-radius:50%;background:var(--line);flex:none}
#node.on .d{background:var(--ok)}#node.bad .d{background:var(--warn)}#node span{overflow:hidden;text-overflow:ellipsis}
#pin{width:32px;height:32px}#pin.on{color:var(--gold)}#pin:hover{background:var(--hover)}
#panel{display:none;position:absolute;inset:84px 0 0 0;overflow:auto;padding:18px 22px 28px;background:var(--paper)}
body.panel #panel{display:block}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
h2{font-size:16px;margin:0 0 4px}h3{font-size:13px;margin:18px 0 8px;color:var(--muted);font-weight:600}
.hint{color:var(--muted);font-size:12px;margin:0 0 12px}
#sub{flex:1;min-width:240px;height:34px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);padding:0 10px;font:inherit;user-select:text}
.btn{height:32px;padding:0 14px;border:1px solid var(--line);background:var(--card)}.btn:hover:not(:disabled){border-color:var(--ice)}
.btn.primary{background:var(--ink);color:var(--paper);border-color:var(--ink)}
#msg{min-height:20px;margin:10px 0 0;font-size:12px}#msg.err{color:var(--warn)}#msg.ok{color:var(--ok)}
.subs{display:flex;flex-direction:column;gap:6px}
.subitem{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--card)}
.subitem .n{flex:1;min-width:0}.subitem .n b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.subitem .n small{color:var(--muted)}
.subitem .e{color:var(--warn)}
.switch{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--card);margin-top:14px}
.switch .k{flex:1}.switch small{display:block;color:var(--muted)}
.tog{position:relative;width:44px;height:24px;border-radius:12px;background:var(--line);flex:none}.tog::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
.tog.on{background:var(--ok)}.tog.on::after{left:23px}
#nodes{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px}
.nodeitem{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:var(--card);text-align:left;width:100%}
.nodeitem:hover{border-color:var(--ice)}.nodeitem.sel{border-color:var(--ok);box-shadow:0 0 0 1px var(--ok) inset}
.nodeitem .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nodeitem small{color:var(--muted);font-size:11px}
.lat{font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}.lat.g{color:var(--ok)}.lat.m{color:var(--gold)}.lat.b{color:var(--warn)}.lat.u{color:var(--muted)}
#filter{height:30px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);padding:0 10px;font:inherit;width:180px;user-select:text}
.empty{color:var(--muted);padding:18px;text-align:center;border:1px dashed var(--line);border-radius:10px}
</style></head><body>
<div id="tabs"><button id="new" title="新标签页">+</button></div>
<div id="bar">
  <button class="nav" id="back" title="后退">&#x2190;</button>
  <button class="nav" id="fwd" title="前进">&#x2192;</button>
  <button class="nav" id="reload" title="刷新">&#x21bb;</button>
  <button class="nav" id="home" title="新标签页">&#x2302;</button>
  <input id="addr" spellcheck="false" placeholder="输入网址，或直接搜索" autocomplete="off">
  <div id="agent" title="碧琪正在操作这个浏览器"><i></i>碧琪正在使用浏览器</div>
  <button id="node" title="浏览器节点（只影响这个浏览器）"><span class="d"></span><span id="nodeText">节点：直连</span></button>
  <button id="pin" title="置顶窗口">&#x1F4CC;</button>
</div>
<div id="panel">
  <div class="row" style="justify-content:space-between"><h2>浏览器节点</h2><button class="btn" id="closePanel">完成</button></div>
  <p class="hint">节点只用于碧琪的这个浏览器：电脑的系统代理、碧琪自己的模型连接都不会改变。</p>
  <div class="row"><input id="sub" placeholder="粘贴订阅链接（Clash / Mihomo / v2ray），或 vmess:// vless:// trojan:// ss:// hysteria2:// 链接" spellcheck="false"><button class="btn primary" id="addSub">添加订阅</button></div>
  <div id="msg"></div>
  <div class="switch"><div class="k"><b>浏览器走节点</b><small id="swHint">开启后浏览器会重新打开一次，当前网页会保留。</small></div><button class="tog" id="toggle" aria-label="浏览器走节点"></button></div>
  <h3>订阅</h3><div class="subs" id="subs"></div>
  <div class="row" style="justify-content:space-between;margin-top:18px"><h3 style="margin:0">节点</h3>
    <div class="row"><input id="filter" placeholder="筛选节点" spellcheck="false"><button class="btn" id="test">测速</button><button class="btn" id="ipcheck">检查出口 IP</button></div></div>
  <div style="height:8px"></div><div id="nodes"></div>
</div>
<script>
const $=id=>document.getElementById(id), post=m=>chrome.webview.postMessage(m);
let state={tabs:[],active:''}, vpn={}, rid=0, pending={}, editing=false;
const call=(op,extra={})=>new Promise(res=>{const id=++rid;pending[id]=res;post({type:'vpn',op,rid:id,...extra});});
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderTabs(){const box=$('tabs');box.querySelectorAll('.tab').forEach(n=>n.remove());const add=$('new');
  for(const t of state.tabs){const el=document.createElement('div');el.className='tab'+(t.id===state.active?' on':'');el.title=t.url||t.title;
    el.innerHTML=(t.loading?'<span class="spin"></span>':'')+'<span class="t">'+esc(t.title||'新标签页')+'</span><button class="x" title="关闭">&times;</button>';
    el.onmousedown=e=>{if(e.button===1){post({type:'closeTab',id:t.id});e.preventDefault();}};
    el.onclick=e=>{if(e.target.classList.contains('x'))post({type:'closeTab',id:t.id});else post({type:'activate',id:t.id});};
    box.insertBefore(el,add);}
}
function renderBar(){const t=state.tabs.find(x=>x.id===state.active);if(!editing)$('addr').value=t?.url||'';
  $('back').disabled=!state.canGoBack;$('fwd').disabled=!state.canGoForward;$('agent').classList.toggle('on',!!state.agent);$('pin').classList.toggle('on',!!state.pinned);
  $('reload').innerHTML=t?.loading?'&#x2715;':'&#x21bb;';$('reload').title=t?.loading?'停止':'刷新';}
function lat(n){if(n.delay===undefined||n.delay===null)return '<span class="lat u">'+(n.tested?'超时':'未测')+'</span>';const d=n.delay;return '<span class="lat '+(d<300?'g':d<800?'m':'b')+'">'+d+' ms</span>';}
function renderNode(){const b=$('node');b.classList.toggle('on',!!vpn.applied);b.classList.toggle('bad',!!vpn.enabled&&!vpn.applied);
  $('nodeText').textContent=vpn.applied?('节点：'+(vpn.selected||'已开启')):(vpn.enabled?'节点：未生效':'节点：直连');}
function renderPanel(){renderNode();$('toggle').classList.toggle('on',!!vpn.enabled);
  $('swHint').textContent=vpn.coreAvailable===false?'这个安装包缺少节点核心，无法开启。':(vpn.enabled?('已开启'+(vpn.selected?('，当前：'+vpn.selected):'')+'。只影响这个浏览器。'):'开启后浏览器会重新打开一次，当前网页会保留。');
  const subs=vpn.subscriptions||[];$('subs').innerHTML=subs.length?subs.map(s=>'<div class="subitem"><div class="n"><b>'+esc(s.title)+'</b><small>'+esc(s.host||'')+' · '+(s.count||0)+' 个节点'+(s.updatedAt?' · 更新于 '+new Date(s.updatedAt*1000).toLocaleString():'')+(s.usage?' · '+esc(s.usage):'')+'</small>'+(s.error?'<div class="e">'+esc(s.error)+'</div>':'')+'</div><button class="btn" data-r="'+esc(s.id)+'">刷新</button><button class="btn" data-d="'+esc(s.id)+'">删除</button></div>').join(''):'<div class="empty">还没有订阅。把机场给的订阅链接粘贴到上面。</div>';
  const f=$('filter').value.trim().toLowerCase();const nodes=(vpn.nodes||[]).filter(n=>!f||String(n.name).toLowerCase().includes(f));
  $('nodes').innerHTML=nodes.length?nodes.map(n=>'<button class="nodeitem'+(n.name===vpn.selected?' sel':'')+'" data-n="'+esc(n.name)+'"><span class="nm" title="'+esc(n.name)+'">'+esc(n.name)+'<br><small>'+esc(n.type)+'</small></span>'+lat(n)+'</button>').join(''):'<div class="empty">'+((vpn.nodes||[]).length?'没有匹配的节点':'添加订阅后这里会列出节点')+'</div>';
  $('test').disabled=!!vpn.testing||!(vpn.nodes||[]).length;$('test').textContent=vpn.testing?'测速中…':'测速';
  if(vpn.message)msg(vpn.message,vpn.messageKind||'');}
function msg(text,kind){const m=$('msg');m.textContent=text||'';m.className=kind||'';}
async function act(op,extra,busy){if(busy)msg(busy,'');const r=await call(op,extra);if(r&&r.message)msg(r.message,r.ok===false?'err':'ok');else if(r&&r.ok)msg('','');return r;}
window.chrome.webview.addEventListener('message',e=>{const m=e.data;if(m.type==='state'){state=m;renderTabs();renderBar();}
  else if(m.type==='vpn'){vpn=m.state||{};renderPanel();}
  else if(m.type==='vpnReply'){const r=pending[m.rid];delete pending[m.rid];if(r)r(m.reply||{});}});
$('new').onclick=()=>post({type:'newTab'});$('back').onclick=()=>post({type:'back'});$('fwd').onclick=()=>post({type:'forward'});
$('reload').onclick=()=>{const t=state.tabs.find(x=>x.id===state.active);post({type:t?.loading?'stop':'reload'});};$('home').onclick=()=>post({type:'home'});
$('pin').onclick=()=>post({type:'pin'});
const addr=$('addr');addr.onfocus=()=>{editing=true;setTimeout(()=>addr.select(),0);};addr.onblur=()=>{editing=false;renderBar();};
addr.onkeydown=e=>{if(e.key==='Enter'){post({type:'navigate',text:addr.value});addr.blur();}else if(e.key==='Escape'){addr.blur();}};
function openPanel(on){document.body.classList.toggle('panel',on);post({type:'panel',open:on});if(on)act('status');}
$('node').onclick=()=>openPanel(!document.body.classList.contains('panel'));$('closePanel').onclick=()=>openPanel(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('panel'))openPanel(false);});
$('addSub').onclick=async()=>{const url=$('sub').value.trim();if(!url){msg('先粘贴订阅链接。','err');return;}$('addSub').disabled=true;const r=await act('add',{url},'正在下载并解析订阅…');$('addSub').disabled=false;if(r.ok){$('sub').value='';}};
$('sub').onkeydown=e=>{if(e.key==='Enter')$('addSub').click();};
$('subs').onclick=e=>{const r=e.target.dataset.r,d=e.target.dataset.d;if(r)act('refresh',{id:r},'正在刷新订阅…');if(d&&confirm('删除这个订阅和它的节点？'))act('remove',{id:d});};
$('nodes').onclick=e=>{const b=e.target.closest('.nodeitem');if(b)act('select',{name:b.dataset.n});};
$('toggle').onclick=()=>act('enable',{on:!vpn.enabled},vpn.enabled?'正在关闭节点…':'正在开启节点，浏览器会重新打开…');
$('test').onclick=()=>act('test',{},'正在测速，最多需要十几秒…');$('ipcheck').onclick=()=>{act('open_ip_check');openPanel(false);};
$('filter').oninput=renderPanel;
post({type:'hello'});
</script></body></html>
"""

START_HTML = r"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>新标签页</title>
<style>
:root{--paper:#faf8f4;--ink:#1f1d1a;--muted:#77716a;--line:#e6e1d8;--card:#fff;--gold:#b8892f}
@media (prefers-color-scheme: dark){:root{--paper:#1c1b19;--ink:#eeeae2;--muted:#a39d93;--line:#3a3732;--card:#262421;--gold:#d8ad5a}}
html,body{margin:0;height:100%;background:var(--paper);color:var(--ink);font:14px/1.5 "Segoe UI","Microsoft YaHei UI",sans-serif}
main{max-width:620px;margin:0 auto;padding:16vh 20px 0;text-align:center}
h1{font-size:26px;font-weight:600;margin:0 0 6px}p{color:var(--muted);margin:0 0 26px}
form{display:flex;gap:8px}input{flex:1;height:44px;border:1px solid var(--line);border-radius:22px;background:var(--card);color:var(--ink);padding:0 18px;font:inherit;outline:none}
input:focus{border-color:var(--gold)}button{height:44px;padding:0 20px;border-radius:22px;border:0;background:var(--ink);color:var(--paper);font:inherit;cursor:pointer}
</style></head><body><main>
<h1>碧琪的浏览器</h1><p>碧琪帮你打开的网页都在这里。右上角「节点」可以只给这个浏览器挂订阅节点。</p>
<form id="f"><input id="q" placeholder="搜索或输入网址" autofocus spellcheck="false"><button>前往</button></form>
</main><script>
document.getElementById('f').onsubmit=e=>{e.preventDefault();const v=document.getElementById('q').value.trim();if(!v)return;
 const url=/^https?:\/\//i.test(v)?v:(!/\s/.test(v)&&/\./.test(v)?'https://'+v:'https://www.bing.com/search?q='+encodeURIComponent(v));location.href=url;};
</script></body></html>
"""
