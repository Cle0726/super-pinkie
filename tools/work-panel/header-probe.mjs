import fs from 'node:fs';
import path from 'node:path';
import {startHarness,playwright} from '../study-desk/harness.mjs';
const out=process.env.PINKIE_WORK_OUTPUT;
const root=process.env.PINKIE_CONTROL_UI_ROOT;
const css=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>m[1]);
const h=await startHarness({realUI:true,vendor:false,handler:()=>({})});
const probeEngine=process.env.PINKIE_QA_ENGINES||'chromium';const b=await playwright()[probeEngine].launch(probeEngine==='chromium'?{channel:'chrome',headless:true,args:['--disable-features=LocalNetworkAccessChecks']}:{headless:true});
const p=await b.newPage({viewport:{width:1280,height:850}});p.setDefaultTimeout(10000);p.setDefaultNavigationTimeout(15000);
await p.addInitScript(()=>{window.__OPENCLAW_NATIVE_CONTROL_AUTH__={gatewayUrl:location.origin.replace('http','ws'),token:'qa'};});
p.on('pageerror',e=>console.log('PAGEERROR',e.stack));
p.on('websocket',s=>{console.log('WS',s.url());s.on('framesent',e=>console.log('SENT',String(e.payload).slice(0,180)));s.on('framereceived',e=>console.log('RECEIVED',String(e.payload).slice(0,250)));s.on('socketerror',e=>console.log('WSERR',e));});
try{
 await p.route('**/chat?session=**',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:(await res.text())+css.map(src=>`<link rel="stylesheet" href="${src}">`).join('')+'<script defer src="/laolao-classic-shell.js"></script>'});});
 await p.goto(h.url+'#token=qa');console.log('loaded');
 await p.waitForTimeout(1000);
 console.log('LOGIN',await p.locator('openclaw-login-gate').innerText().catch(()=>''));
 console.log('INPUTS',await p.locator('input').evaluateAll(ns=>ns.map(n=>({type:n.type,placeholder:n.placeholder,label:n.getAttribute('aria-label'),val:n.value}))));
 const connect=p.locator('openclaw-login-gate button').filter({hasText:/^连接$|^Connect$/});if(await connect.count())await connect.click();
 try{await p.locator('header.topbar').waitFor({state:'attached'});}catch(e){console.log('FAILED TEXT',(await p.locator('body').innerText()).slice(0,5000));console.log('RAW',await p.locator('.login-gate__failure-raw').textContent());throw e;}
 await p.evaluate(()=>{document.documentElement.dataset.laolaoWorkspaceDock='1';document.documentElement.dataset.laolaoClassicShell='1';});
 await p.addScriptTag({url:'/laolao-motion.js'});await p.addScriptTag({url:'/laolao-mode-switcher.js'});
 await p.waitForTimeout(250);
 console.log('ROOT',await p.evaluate(()=>document.documentElement.outerHTML.slice(0,1200)));
 console.log(JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('header.topbar, .topnav-shell, .topnav-shell__content, .topnav-shell__actions, .dashboard-header, .dashboard-header__breadcrumb, .dashboard-header__actions, .chat-pane__header')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {tag:n.tagName,cls:n.className,x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,visibility:s.visibility,color:s.color,bg:s.backgroundColor,overflow:s.overflow,children:[...n.children].map(c=>c.className)};})),null,2));
 await p.screenshot({path:path.join(out,'header-probe.png')});console.log('shot');
}finally{console.log('closing browser');await b.close();console.log('closing harness');await h.close();console.log('done');}
