#!/usr/bin/env node
// Read actual package files on an isolated random port. No live gateway/model
// requests, user state, or installed App writes are involved.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => word.startsWith('--') ? [...pairs,[word.slice(2),all[i+1]?.startsWith('--') ? true : all[i+1] ?? true]] : pairs, []));
const root = path.resolve(args['control-ui'] || '');
if (!fs.existsSync(path.join(root,'index.html'))) throw Error('--control-ui must point to actual packaged Control UI');
const out = path.resolve(args.out || 'parity-shots'); fs.mkdirSync(out,{recursive:true});
const label = args.label || process.platform;
const captureMode = args.mode || 'project';
if (!['chat','project','thinking','learning','unrestricted'].includes(captureMode)) throw Error('--mode is not a Pinkie mode');
const captureAgent = captureMode === 'chat' ? 'main' : captureMode;
const require = createRequire(process.env.PINKIE_UI_DEPS ? path.join(process.env.PINKIE_UI_DEPS,'package.json') : import.meta.url);
let playwright, ws;
try { playwright=require('playwright'); ws=require('ws'); }
catch {
  const local='/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
  playwright=require(path.join(local,'playwright'));
  const bundle=require(path.join(local,'playwright-core/lib/utilsBundle.js'));
  ws={WebSocketServer:bundle.wsServer};
}
const models=[{id:'gemini-3-pro-preview',provider:'google',name:'Gemini 3 Pro',reasoning:true,input:['text','image'],contextWindow:1048576},
  {id:'gpt-5.2',provider:'openai',name:'GPT-5.2',reasoning:true,input:['text','image'],contextWindow:400000}];
const modes=['main','project','thinking','learning','unrestricted'];
const now=Date.now();
const example=[{role:'user',content:[{type:'text',text:'碧琪，帮我整理一下今天的计划。'}],timestamp:now-20000},
  {role:'assistant',content:[{type:'text',text:'先把最要紧的事定下来，再留一点时间给自己。\n\n1. 上午完成手头的重点工作。\n2. 下午学习一个新知识，顺手记下心得。\n3. 晚上一起回顾今天，再安排明天。'}],timestamp:now-10000}];
let currentView='home';
const calls=[];
function session(key='agent:main:parity') {
  return {key,sessionId:key.replaceAll(':','-'),kind:'direct',label:'今天的计划',displayName:'今天的计划',updatedAt:now,
    modelProvider:'google',model:'gemini-3-pro-preview',thinkingLevel:'high',inputTokens:1360,outputTokens:480,contextTokens:1048576};
}
function rpc(method,p={}) {
  calls.push({method,params:p});
  const key=p.key||p.sessionKey||'agent:main:parity';
  if(method==='connect') return {type:'hello-ok',protocol:3,server:{version:'parity-fixture',connId:'parity'},features:{methods:['models.list','sessions.list','sessions.patch','chat.history','agents.list'],events:['chat']},snapshot:{presence:[],health:{ok:true},sessionDefaults:{defaultAgentId:'main',mainSessionKey:'agent:main:parity',defaultModel:'google/gemini-3-pro-preview'}},auth:{role:'operator',scopes:['operator.admin','operator.read'],deviceToken:'isolated-parity'},policy:{tickIntervalMs:30000}};
  if(method==='agents.list') return {defaultId:'main',mainKey:'agent:main:parity',agents:modes.map(id=>({id,name:'碧琪',identity:{name:'碧琪'}}))};
  if(method==='agent.identity.get') return {agentId:p.agentId||'main',name:'碧琪',avatar:'/laolao-mode-chat-hd.png'};
  if(method==='models.list') return {models};
  if(method==='sessions.list') return {sessions:modes.filter(id=>!p.agentId||p.agentId===id).map(id=>session(`agent:${id}:parity`)),defaults:{modelProvider:'google',model:'gemini-3-pro-preview',contextTokens:1048576,thinkingLevel:'high'}};
  if(method==='sessions.resolve'||method==='sessions.patch') return {ok:true,...session(key),entry:session(key),session:session(key),resolved:{modelProvider:'google',model:'gemini-3-pro-preview'}};
  if(method==='chat.history'||method==='pinkie.chat.history') return {sessionKey:key,sessionId:session(key).sessionId,messages:currentView==='home'||currentView==='learning'?[]:example,thinkingLevel:'high',hasMore:false,totalMessages:currentView==='home'?0:2};
  if(method==='health') return {ok:true};
  if(method==='status') return {ok:true,version:'parity-fixture'};
  if(method==='config.get') return {hash:'fixture',valid:true,config:{agents:{defaults:{model:{primary:'google/gemini-3-pro-preview'}}}}};
  if(method.includes('watchdog.status')) return {loaded:true,retrying:false};
  if(method==='pinkie.learning.desk.today') return {date:'2026-11-02',overview:{due:0,newWords:0,streak:1},queue:[],exams:[],subjects:[],plan:null};
  if(method==='pinkie.learning.notes.toc') return {inbox:0,today:{count:0,backlog:0},mistakes:0,moved:0,exams:[]};
  if(method==='pinkie.learning.notes.list') return {notes:[],total:0};
  if(method.includes('exams')) return {exams:[],packs:[]};
  if(method.includes('vocab')) return {words:[],due:[],stats:{total:0,due:0,new:0},summary:{total:0,due:0},books:[]};
  if(method.includes('tier')||method.includes('reasoning')) return {enabled:false,level:'high',tier:'base'};
  return {ok:true,items:[],sessions:[],files:[],messages:[],models,notes:[],entries:[],sources:[],projects:[]};
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webm':'video/webm','.mp4':'video/mp4','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/readyz'||url.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
  if(['/laolao-stats.json','/laolao-quota.json'].includes(url.pathname)){res.setHeader('Content-Type','application/json');res.end('null');return;}
  if(['/__openclaw/control-ui-config.json','/control-ui-config.json'].includes(url.pathname)){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({basePath:'',assistantName:'碧琪',assistantAvatar:'/laolao-mode-chat-hd.png',assistantAgentId:'main'}));return;}
  if(/^\/avatar\//.test(url.pathname)&&url.searchParams.has('meta')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({avatarUrl:'/laolao-mode-chat-hd.png'}));return;}
  const relative=['/','/chat','/overview','/activity','/instances','/sessions','/usage','/cron'].includes(url.pathname)?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('missing '+relative);return;}
  const data=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
  if(range){const from=Number(range[1]),to=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;res.writeHead(206,{'Content-Range':`bytes ${from}-${to}/${data.length}`,'Accept-Ranges':'bytes','Content-Length':to-from+1});res.end(data.subarray(from,to+1));}
  else{res.setHeader('Content-Length',data.length);res.end(data);}
});
const wss=new ws.WebSocketServer({server});
wss.on('connection',socket=>{
  socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'isolated-parity',ts:now}}));
  socket.on('message',raw=>{let req;try{req=JSON.parse(String(raw));}catch{return;}
    if(req.type!=='req')return;
    try{socket.send(JSON.stringify({type:'res',id:req.id,ok:true,payload:rpc(req.method,req.params)}));}
    catch(error){socket.send(JSON.stringify({type:'res',id:req.id,ok:false,error:{code:'FIXTURE',message:error.message}}));}
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const errors=[],requests=[],states={};
let browser, activePage, failure;
try {
  const browserName=args.browser||'webkit';
  browser=args.cdp ? await playwright.chromium.connectOverCDP(args.cdp)
    : await (browserName==='webkit'?playwright.webkit:playwright.chromium).launch({headless:!args.headed,...(['chrome','msedge'].includes(browserName)?{channel:browserName}:{})});
  for(const view of String(args.views||'home,chat,cards,sidebar,learning,power').split(',')){
    console.log('capture',label,view);
    currentView=view;
    const entryAgent=view==='home'?(captureAgent==='main'?'project':'main'):(view==='learning'?'learning':captureAgent);
    const context=args.cdp ? browser.contexts()[0]
      : await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,colorScheme:'light',locale:'zh-CN',reducedMotion:'no-preference'});
    if(!context)throw Error('the packaged WebView2 has no debuggable context');
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==origin){requests.push({view,url:u.href,blockedExternal:true});return route.abort();}return route.continue();});
    await context.addInitScript(({view,origin,entryAgent,nativePlatform,mockNative})=>{
      const key=new URL(location.href).searchParams.get('session')||`agent:${entryAgent}:parity`;
      const settings={gatewayUrl:origin.replace('http','ws'),sessionKey:key,lastActiveSessionKey:key,themeMode:'light',token:'parity'};
      for(const suffix of ['',':default',':'+settings.gatewayUrl])localStorage.setItem('openclaw.control.settings.v1'+suffix,JSON.stringify(settings));
      localStorage.setItem('openclaw.i18n.locale','zh-CN');
      const Socket=window.WebSocket; window.WebSocket=class extends Socket {constructor(url,protocols){const next=new URL(url,location.href);next.host=new URL(origin).host;super(next.href,protocols);}};
      const mark=()=>{document.documentElement?.setAttribute('data-pinkie-native-glass','1');if(nativePlatform)document.documentElement?.setAttribute('data-pinkie-platform',nativePlatform);};mark();document.addEventListener('DOMContentLoaded',mark,{once:true});
      if(mockNative&&nativePlatform!=='windows'){
        // WebKit also uses this object for its automation bridge. Preserve
        // existing handlers instead of replacing the browser's own object.
        const bridge=window.webkit||(window.webkit={});
        const handlers=bridge.messageHandlers||(bridge.messageHandlers={});
        for(const name of ['laolaoNativeDictation','laolaoWindowControl','laolaoProjectFolder','laolaoWorkspaceDock']){
          if(!handlers[name])try{Object.defineProperty(handlers,name,{value:{postMessage(){}},configurable:true});}catch{}
        }
      }
    },{view,origin,entryAgent,nativePlatform:args['native-platform']||'mac',mockNative:browserName!=='webkit'});
    const page=args.cdp ? context.pages().find(p=>p.url().startsWith('http'))||context.pages()[0] : await context.newPage();
    if(!page)throw Error('the packaged WebView2 has no page');
    activePage=page;
    // A CDP target is a native window. Preserve its real viewport rather than
    // emulating a browser size over the host's differently sized surface.
    if(!args.cdp)await page.setViewportSize({width:1280,height:800});
    page.setDefaultTimeout(30000);
    page.on('pageerror',error=>errors.push({view,kind:'page',message:String(error)}));
    page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push({view,kind:message.type(),message:message.text()});});
    page.on('response',response=>{if(response.status()>=400)requests.push({view,url:response.url(),status:response.status()});});
    // Enter through an already-running shell, then open home using the real
    // mode switch UI below. This gives the fixture a normal homepage handoff
    // instead of racing the upstream initial-session restoration.
    await page.goto(`${origin}/chat?session=agent:${entryAgent}:parity&laolao-dock=1`,{waitUntil:'domcontentloaded',timeout:90000});
    console.log('loaded',view);
    await page.waitForSelector('.agent-chat__input',{timeout:90000});
    console.log('composer ready',view);
    // The splash starts at opacity zero BEFORE its intro starts. Waiting for
    // opacity alone can capture that intro over the "home" page. Its own
    // finished handler removes the node; wait for that real completion.
    await page.waitForFunction(()=>!document.getElementById('laolao-splash'),null,{timeout:35000,polling:100});
    console.log('splash cleared',view);
    await page.waitForTimeout(1500);
    await page.waitForFunction(()=>document.fonts.status==='loaded',null,{timeout:20000,polling:100});
    console.log('fonts ready',view);
    if(view==='home'){
      await page.locator('.laolao-mode-switcher').first().click();
      await page.locator(`.laolao-mode-menu__option[data-mode="${captureMode}"]`).click();
      await page.locator('.laolao-startup-home__greeting').waitFor({state:'visible'});
      await page.waitForFunction(()=>!document.querySelector('.laolao-mode-transition')&&!document.documentElement.hasAttribute('data-laolao-mode-pending'),null,{timeout:35000,polling:100});
    }
    if(view==='cards'){
      await page.locator('.laolao-deep-think-btn').first().click();
      await page.waitForSelector('.laolao-deep-think-menu',{state:'visible'});
      await page.waitForFunction(()=>{const videos=[...document.querySelectorAll('.laolao-deep-think-menu video')];return videos.length===4&&videos.every(v=>v.readyState>=2&&!v.error);});
      await page.waitForTimeout(1000);
    }
    if(view==='sidebar'){
      await page.locator('.shell-nav').hover().catch(()=>{});
      await page.waitForTimeout(600);
    }
    if(view==='power'){
      // 进阶调节, opened the way a user does: the workspace-rail button.
      await page.waitForSelector('#pinkie-power-entry',{state:'visible',timeout:20000});
      const untouched=await page.evaluate(()=>({level:window.PinkieTuning?.level,stored:localStorage.getItem('pinkie.tuning.v1'),snapshot:window.PinkieTuning?.snapshot()}));
      if(untouched.level!=='standard'||untouched.stored!==null)throw Error('进阶调节 is not at its untouched default: '+JSON.stringify(untouched));
      await page.locator('#pinkie-power-entry').click();
      await page.waitForSelector('#pinkie-power.is-open .pinkie-power__level--standard.is-on',{state:'visible'});
      await page.waitForFunction(()=>document.querySelectorAll('#pinkie-power .pinkie-power__row').length===14&&[...document.querySelectorAll('#pinkie-power img')].every(i=>i.complete&&i.naturalWidth));
      await page.waitForTimeout(600);
    }
    if(view==='learning'){
      await page.waitForFunction(()=>Boolean(window.__pinkieStudyDesk),{timeout:20000});
      await page.evaluate(()=>window.__pinkieStudyDesk.go('today'));
      await page.waitForSelector('#pinkie-study-desk',{state:'visible'});
      await page.waitForTimeout(1800);
    }
    // Mode restoration can create another intro after the first one exits.
    // Require a settled surface immediately before evidence is recorded.
    await page.waitForFunction(()=>{
      if(document.getElementById('laolao-splash')){window.__parityClearSince=0;return false;}
      if(!window.__parityClearSince)window.__parityClearSince=Date.now();
      return Date.now()-window.__parityClearSince>=1000;
    },null,{timeout:35000,polling:100});
    states[view]=await page.evaluate(()=>({title:document.title,theme:document.documentElement.getAttribute('data-theme-mode'),mode:document.documentElement.getAttribute('data-laolao-mode'),font:getComputedStyle(document.body).fontFamily,surface:window.__pinkieSurface||null,glass:CSS.supports('backdrop-filter','blur(12px)'),styleSheets:document.styleSheets.length,images:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src),videos:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,readyState:v.readyState,paused:v.paused,error:v.error?.message||null})),cards:document.querySelector('.chat-controls__model')?.outerHTML.slice(0,600),text:document.body.innerText.slice(0,2000)}));
    const expectedMode=view==='learning'?'learning':captureMode;
    if(states[view].mode!==expectedMode)throw Error(`wrong mode for ${view}: ${states[view].mode}, expected ${expectedMode}`);
    await page.screenshot({path:path.join(out,`${label}-${view}.png`),timeout:30000});
    if(args['desktop-python']){
      if(!args.cdp||!args['app-pid'])throw Error('desktop evidence requires the actual packaged App and its PID');
      const helper=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../windows-smoke/desktop_shot.py');
      const command=[helper,'--pid',String(args['app-pid']),'--prefix',path.join(out,`${label}-${view}`)];
      if(['home','chat'].includes(view))command.push('--verify');
      console.log(execFileSync(args['desktop-python'],command,{encoding:'utf8',timeout:30000}));
      if(view==='home'){
        const large=[helper,'--pid',String(args['app-pid']),'--prefix',path.join(out,`${label}-${view}-large`),'--maximize','--verify'];
        console.log(execFileSync(args['desktop-python'],large,{encoding:'utf8',timeout:30000}));
      }
    }
    if(!args.cdp)await context.close();
  }
} catch(error) {
  failure={message:String(error),view:currentView};
  if(activePage&&!activePage.isClosed()){
    failure.document=await Promise.race([activePage.evaluate(()=>({url:location.href,ready:document.readyState,splash:document.getElementById('laolao-splash')?.outerHTML,text:document.body?.innerText.slice(0,3000),scripts:[...document.scripts].map(s=>({src:s.src,defer:s.defer,type:s.type})),motion:Boolean(window.PinkieMotion),mode:document.documentElement.getAttribute('data-laolao-mode')})).catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve({unresponsive:true}),5000))]);
    await activePage.screenshot({path:path.join(out,`${label}-failure.png`),timeout:10000}).catch(()=>{});
  }
  throw error;
} finally {
  fs.writeFileSync(path.join(out,`${label}-evidence.json`),JSON.stringify({label,platform:process.platform,engine:args.browser||'webkit',control:root,errors,requests,states,calls,failure},null,2)+'\n');
  await browser?.close();for(const client of wss.clients)client.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({label,views:Object.keys(states),errors:errors.length,httpErrors:requests.filter(r=>r.status).length,out}));
if(args.strict&&(errors.some(e=>e.kind==='page'||e.kind==='error')||requests.some(r=>r.status)))process.exitCode=1;
