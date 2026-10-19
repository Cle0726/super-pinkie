import {spawn} from 'node:child_process';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT=9342;
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/cle-cdp-perf','--no-first-run','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--window-size=900,900','about:blank'],{stdio:'ignore'});
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
try{
  let t=null;
  for(let i=0;i<60&&!t;i++){await wait(250);try{const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();t=l.find(x=>x.type==='page')}catch{}}
  const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const pend=new Map();
  const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}))});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}});
  await new Promise(r=>ws.addEventListener('open',r));
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:18823/perf.html'});
  let out='';
  for(let i=0;i<200;i++){await wait(300);const r=await send('Runtime.evaluate',{expression:'document.getElementById("log")?.textContent||""',returnByValue:true});out=r.result?.value||'';if(out.includes('DONE_MARKER'))break;}
  console.log(out.trim());
}finally{chrome.kill('SIGKILL')}
