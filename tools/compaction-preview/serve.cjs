// Preview harness for the context-compaction divider: day/night side by side,
// with buttons that send the real gateway events the chat page listens for.
const http=require('http'),fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'../../ui/injections'),port=Number(process.env.PORT||5197);
const html=key=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>compaction preview</title>
<style>body{margin:0;font-family:-apple-system,system-ui;background:#fff8fa;color:#2c2945}html[data-pinkie-night] body{background:#16141f;color:#e9eeff}
#bar{position:sticky;top:0;display:flex;gap:6px;padding:8px;background:inherit;z-index:2}button{font:12px system-ui;padding:4px 8px}
#thread{padding:20px}.msg{max-width:520px;margin:10px 50px;padding:10px 14px;border-radius:14px;background:rgba(127,127,160,.12);font-size:13px}</style>
<div id="bar"><button onclick="emit('start')">开始</button><button onclick="emit('end',{completed:true,tokensBefore:182000,tokensAfter:24000})">完成</button><button onclick="emit('end',{completed:false})">失败</button><button onclick="document.documentElement.toggleAttribute('data-pinkie-night')">昼/夜</button></div>
<div id="thread"><div class="msg">先生，这是之前的一段对话……</div><div class="msg">还有很多历史消息</div><div data-pinkie-compaction="${key}"></div><div class="msg">新的消息继续在这里</div></div>
<script>const KEY=${JSON.stringify(key)};window.__laolaoSidebar={gwRequest:async()=>({sessions:[{key:KEY,totalTokens:200000,contextTokens:1000000,compactionCount:0}],defaults:{contextTokens:1000000}})};
function emit(phase,extra={}){window.dispatchEvent(new CustomEvent('pinkie:gateway-event',{detail:{event:'session.operation',payload:{sessionKey:KEY,operation:'compact',phase,operationId:'preview',...extra}}}));}
if(location.hash==='#night')document.documentElement.setAttribute('data-pinkie-night','');</script>
<script src="/laolao-context-compact.js"></script>`;
http.createServer((req,res)=>{const u=new URL(req.url,'http://x'),name=path.basename(u.pathname),file=path.join(dir,name);
 if(name.endsWith('.js')&&fs.existsSync(file)){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');return res.end(fs.readFileSync(file));}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html(u.searchParams.get('session')||'agent:main:preview'));
}).listen(port,'127.0.0.1',()=>console.log('compaction preview on http://127.0.0.1:'+port+'/?session=agent:main:preview'));
