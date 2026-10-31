// Actual Control UI header + learning desk, isolated WebSocket/RPC adapter.
// Never opens or sends messages to the user's App/gateway.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {startHarness,playwright} from '../study-desk/harness.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const ui=process.env.PINKIE_DOCK_QA_UI || path.join(repo,'ui/injections');
const out=process.env.PINKIE_WORK_OUTPUT || path.join(os.tmpdir(),'pinkie-dock-exit-qa');fs.mkdirSync(out,{recursive:true});
const report={status:'pending',engines:{},scope:'Chromium installed App shell; WebKit installed topbar component in an isolated chat fixture. Full installed styles, learning desk and native close adapter.'};
const controlRoot=process.env.PINKIE_CONTROL_UI_ROOT;
const css=[...fs.readFileSync(path.join(controlRoot,'index.html'),'utf8').matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>m[1]);
let failed=false,delayed=false,releaseOld;
const today={date:'2026-10-26',exams:[{id:'zsb',name:'专升本',date:'2028-04-24',daysLeft:546},{id:'pretco-b',name:'英语 B 级',date:'2026-11-29',daysLeft:34}],goals:{minutes:35,lessons:3},progress:{lessons:1},streak:{current:4},mastery:{total:144,lit:3,subjects:[]},focus:{title:'继续阅读',payload:{size:3}}};
const handler=async(method,params)=>{
 if(method.endsWith('desk.today')){if(failed)throw Error('isolated offline');if(delayed&&params.sessionKey.endsWith('study-desk-qa')){delayed=false;await new Promise(r=>releaseOld=r);return {...today,exams:[{...today.exams[0],daysLeft:999}]};}return structuredClone(today);}
 if(method==='pinkie.work.status')return {sessionKey:params.sessionKey,background:Array.from({length:3},(_,i)=>({id:'qa-'+i,state:'done',command:'资料校验 '+(i+1),startedAt:Date.now()-20000,endedAt:Date.now()})),reasoning:{},tier:{}};
 return {};
};
try{
 for(const engine of (process.env.PINKIE_QA_ENGINES||'chromium,webkit').split(',')){
  const harness=await startHarness({realUI:true,vendor:false,handler,initialMessages:[{role:'assistant',content:[{type:'text',text:'## 学习模式对话\n\n这是模式双开中的聊天正文。两边都保留完整模式功能。'}],timestamp:Date.now()}]});
  console.log(engine,'start');
  const browser=await playwright()[engine].launch(engine==='chromium'?{headless:true,channel:'chrome',args:['--disable-features=LocalNetworkAccessChecks']}:{headless:true});
  console.log(engine,'launched');
  const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
  console.log(engine,'page created');
  page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
  try{
   for(const name of ['laolao-mode-switcher.js','laolao-theme.css','laolao-deep-think.js','laolao-learning-reminder.js','laolao-learning-reminder.css'])await page.route('**/'+name+'*',route=>route.fulfill({path:path.join(ui,name),contentType:name.endsWith('.js')?'text/javascript':'text/css'}));
   await page.route('**/chat?session=**',async route=>{
    const response=await route.fetch();let html=await response.text();
    if(engine==='webkit')html=html.replace('<openclaw-app></openclaw-app>','<div class="shell shell--chat"><aside class="sidebar sidebar--collapsed" hidden></aside><openclaw-app-topbar></openclaw-app-topbar><main class="agent-chat fixture-chat"><div class="chat-thread"><h2>学习模式对话</h2><p>模式双开保持两边完整功能。</p></div><div class="agent-chat__input"><div class="agent-chat__composer-shell"><textarea placeholder="先生，今天想学点什么？"></textarea></div><div class="agent-chat__composer-actions"></div></div></main></div>');
    const fixtureCSS=engine==='webkit'?'.fixture-chat{position:fixed!important;inset:64px 20px 0;display:block!important}.fixture-chat .agent-chat__input{position:absolute!important;left:20px;right:20px;bottom:28px;max-width:none!important;width:auto!important}.fixture-chat .agent-chat__composer-actions{min-height:32px}.fixture-chat textarea{width:100%;min-height:54px}':'';
    await route.fulfill({response,body:html+css.map(src=>`<link rel="stylesheet" href="${src}">`).join('')+'<style>.shell{padding:0!important}'+fixtureCSS+'</style><script defer src="/laolao-classic-shell.js"></script>'});
   });
   await page.addInitScript(()=>{window.__OPENCLAW_NATIVE_CONTROL_AUTH__={gatewayUrl:location.origin.replace('http','ws'),token:'qa'};window.nativeCloseCalls=[];if(!window.webkit)window.webkit={messageHandlers:{}};Object.defineProperty(window.webkit.messageHandlers,'laolaoWorkspaceDock',{configurable:true,value:{postMessage:body=>nativeCloseCalls.push(body)}});});
   console.log(engine,'navigate');await page.goto(harness.url+'#token=qa');await page.waitForLoadState('networkidle');console.log(engine,'loaded');await page.locator('.topnav-shell__actions').waitFor({state:'attached'});await page.locator('#pinkie-study-desk').waitFor({state:'attached'});
   await page.evaluate(()=>document.documentElement.dataset.laolaoWorkspaceDock='1');
   const before=await page.locator('header.topbar').boundingBox();
   await page.addScriptTag({url:'/laolao-motion.js'});
   await page.addScriptTag({url:'/laolao-mode-switcher.js'});
   console.log(engine,'header ready');
   await page.evaluate(()=>{
    const header=document.querySelector('.dashboard-header');
    const usage=document.createElement('div');usage.className='laolao-usage';usage.innerHTML='<span class="laolao-usage__chip laolao-usage__chip--runtime">链路　在线 70ms</span><span class="laolao-usage__chip laolao-usage__chip--cost">累计估算 $513.60</span>';header.append(usage);
    document.querySelector('aside.sidebar')?.classList.add('sidebar--collapsed');
   });
   const reminder=page.locator('#pinkie-learning-reminder');await reminder.waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('pinkie-learning-reminder')?.getAttribute('aria-label').includes('546 天'));
   const button=page.locator('#laolao-dock-exit');await button.waitFor({state:'visible'});
   assert.equal(await button.getAttribute('title'),null);assert.equal(await button.getAttribute('data-pinkie-placement'),'toolbar');
   assert.equal(await button.evaluate(n=>n.parentElement.classList.contains('topnav-shell__actions')),true);
   assert.ok(Math.abs((await page.locator('header.topbar').boundingBox()).height-before.height)<1);
   checks.push('Exit occupies the existing header actions; no extra row or native grey tooltip');
   const placements=[];
   for(const width of [1280,900,640,420,360]){
    await page.setViewportSize({width,height:800});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const geometry=await button.evaluate(n=>{const b=n.getBoundingClientRect(),bar=n.closest('header').getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,barTop:bar.top,barBottom:bar.bottom,position:getComputedStyle(n).position,inside:n.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};});
    assert.equal(geometry.position,'relative');assert.ok(geometry.w<=32&&geometry.h<=32);assert.ok(geometry.x>=0&&geometry.x+geometry.w<=width);assert.ok(geometry.y>=geometry.barTop&&geometry.y+geometry.h<=geometry.barBottom+1,JSON.stringify({width,...geometry}));assert.equal(geometry.inside,true);placements.push({width,...geometry});
   }
   checks.push('360–1280px: compact hit area stays inside the header and remains clickable');
   await page.setViewportSize({width:1000,height:800});
   for(const night of [false,true]){
    await page.evaluate(night=>{const shell=document.querySelector('openclaw-app-shell');shell?.applySettings?.({...shell.settings,themeMode:night?'dark':'light'});document.documentElement.toggleAttribute('data-pinkie-night',night);document.documentElement.dataset.themeMode=night?'dark':'light';},night);await page.waitForTimeout(120);
    await button.hover();assert.equal(await button.locator('[role=tooltip]').evaluate(n=>getComputedStyle(n).visibility),'visible');
    if(engine==='chromium')await page.screenshot({path:path.join(out,night?'exit-toolbar-night.png':'exit-toolbar-day.png')});
   }
   await button.focus();await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>nativeCloseCalls.filter(c=>c.action==='close').length),1);
   checks.push('Day/night palette, custom tooltip, keyboard activation and one close request');
   await page.evaluate(()=>__pinkieStudyDesk.go('today'));await page.waitForFunction(()=>document.querySelector('#laolao-dock-exit')?.dataset.pinkiePlacement==='rail');
   assert.equal(await button.evaluate(n=>n.parentElement.matches('#pinkie-study-desk .rail')),true);
   for(const size of [{width:1000,height:800},{width:640,height:620},{width:420,height:540}]){
    await page.setViewportSize(size);
    const geometry=await button.evaluate(n=>{const b=n.getBoundingClientRect(),rail=n.parentElement.getBoundingClientRect(),nav=n.parentElement.querySelector('.rail-nav').getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,railLeft:rail.left,railRight:rail.right,navTop:nav.top,inside:n.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};});
    assert.ok(geometry.x>=geometry.railLeft&&geometry.x+geometry.w<=geometry.railRight);assert.ok(geometry.y+geometry.h<=geometry.navTop+1);assert.equal(geometry.inside,true);
   }
   checks.push('Learning desk: exit joins its existing navigation rail, away from countdown/content');
   await page.setViewportSize({width:1000,height:800});await page.mouse.move(600,500);
   for(const night of [false,true]){
    await page.evaluate(night=>{const shell=document.querySelector('openclaw-app-shell');shell?.applySettings?.({...shell.settings,themeMode:night?'dark':'light'});document.documentElement.toggleAttribute('data-pinkie-night',night);document.documentElement.dataset.themeMode=night?'dark':'light';},night);await page.waitForTimeout(120);
    if(engine==='chromium')await page.screenshot({path:path.join(out,night?'exit-desk-night.png':'exit-desk-day.png')});
   }
   await page.evaluate(()=>__pinkieStudyDesk.go('chat'));await page.waitForFunction(()=>document.querySelector('#laolao-dock-exit')?.dataset.pinkiePlacement==='toolbar');
   console.log(engine,'desk ready');
   for(let i=0;i<6;i++){await page.evaluate(()=>__pinkieStudyDesk.go('today'));await page.waitForFunction(()=>document.querySelector('#laolao-dock-exit')?.dataset.pinkiePlacement==='rail');await page.evaluate(()=>__pinkieStudyDesk.go('chat'));await page.waitForFunction(()=>document.querySelector('#laolao-dock-exit')?.dataset.pinkiePlacement==='toolbar');}
   assert.equal(await button.count(),1);checks.push('Repeated chat/desk switches relocate one control without duplicating it');
   assert.match(await reminder.getAttribute('aria-label'),/每天 35 分钟.*连续 4 天.*上课 1 \/ 3 节/);
   for(const width of [1680,1100,840,640,420,360]){
    console.log(engine,'reminder width',width);
    await page.setViewportSize({width,height:800});await page.waitForTimeout(60);
    if(!await reminder.count())console.log('MISSING REMINDER',await page.evaluate(()=>({url:location.href,root:document.documentElement.outerHTML.slice(0,700),header:document.querySelector('header.topbar')?.outerHTML.slice(0,7000)})));
    const layout=await reminder.evaluate(n=>{const r=n.getBoundingClientRect(),mode=document.querySelector('.dashboard-header__breadcrumb').getBoundingClientRect(),usage=n.parentElement.querySelector('.laolao-usage')?.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,modeRight:mode.height?mode.right:0,usageLeft:usage?.height?usage.left:innerWidth,density:n.dataset.density};});
    assert.ok(layout.x>=layout.modeRight-1);assert.ok(layout.right<=layout.usageLeft+1,JSON.stringify({width,...layout}));assert.ok(layout.y>=0&&layout.y+layout.h<=60);checks.push(`Reminder width ${width}: ${layout.density}`);
   }
   await reminder.click();await page.locator('.pinkie-learning-reminder-panel').waitFor({state:'visible'});assert.match(await page.locator('.pinkie-learning-reminder-panel').innerText(),/35 分钟.*4 天.*1 \/ 3 节/);await page.keyboard.press('Escape');assert.equal(await page.locator('.pinkie-learning-reminder-panel').count(),0);
   failed=true;await page.evaluate(()=>__pinkieLearningReminder.refresh());assert.equal(await reminder.getAttribute('data-stale'),'true');failed=false;
   delayed=true;await page.evaluate(()=>{void __pinkieLearningReminder.refresh();});await new Promise(r=>{const t=setInterval(()=>{if(releaseOld){clearInterval(t);r();}},10);});
   await page.evaluate(()=>{history.replaceState({},'',location.pathname+'?session=agent:learning:other-header-qa');window.dispatchEvent(new PopStateEvent('popstate'));});await page.waitForFunction(()=>document.getElementById('pinkie-learning-reminder')?.getAttribute('aria-label').includes('546 天'));releaseOld();releaseOld=null;await page.waitForTimeout(100);assert.doesNotMatch(await reminder.getAttribute('aria-label'),/999/);
   await page.evaluate(()=>{document.documentElement.dataset.laolaoMode='project';history.replaceState({},'',location.pathname+'?session=agent:project:other-header-qa');window.dispatchEvent(new PopStateEvent('popstate'));});await reminder.waitFor({state:'detached'});
   await page.evaluate(()=>{document.documentElement.dataset.laolaoMode='learning';history.replaceState({},'',location.pathname+'?session=agent:learning:study-desk-qa');window.dispatchEvent(new PopStateEvent('popstate'));});await reminder.waitFor({state:'visible'});
   checks.push('Real desk fields, keyboard details, offline stale marker, session race and learning-only scope');
   console.log(engine,'reminder ready');
   await page.addScriptTag({url:'/laolao-deep-think.js'});const work=page.locator('#pinkie-work-panel');await work.waitFor({state:'visible'});
   const workLayouts=[];
   for(const size of [{width:1280,height:800},{width:840,height:800},{width:600,height:620},{width:420,height:620},{width:360,height:620}]){
    await page.setViewportSize(size);
    await page.evaluate(()=>{const input=document.querySelector('.agent-chat__input');if(getComputedStyle(input).position==='static')input.style.setProperty('position','relative','important');let jump=input.querySelector('.chat-new-messages');if(!jump){jump=document.createElement('button');jump.className='chat-new-messages';jump.textContent='↓ New messages';input.prepend(jump);}jump.id='qa-new-messages';for(const [name,value]of Object.entries({position:'absolute',left:'50%',right:'auto',top:'-38px',bottom:'auto',margin:'0',transform:'translateX(-50%)',height:'28px'}))jump.style.setProperty(name,value,'important');const offset=input.getBoundingClientRect().top-38-jump.getBoundingClientRect().top;jump.style.setProperty('top',(-38+offset)+'px','important');});await page.waitForTimeout(950);
    for(const expanded of [false,true]){
     if((await work.locator('.pinkie-work__pill').getAttribute('aria-expanded'))!==String(expanded))await work.locator('.pinkie-work__pill').click();await page.waitForTimeout(80);
     const g=await work.evaluate(n=>{const r=n.getBoundingClientRect(),hit=(n.querySelector('.pinkie-work__card').hidden?n.querySelector('.pinkie-work__pill'):n).getBoundingClientRect(),jump=document.querySelector('#qa-new-messages').getBoundingClientRect(),input=document.querySelector('.agent-chat__input').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,jumpTop:jump.top,jumpBottom:jump.bottom,inputTop:input.top,overlap:hit.left<jump.right&&hit.right>jump.left&&hit.top<jump.bottom&&hit.bottom>jump.top};});
     assert.ok(g.left>=0&&g.right<=size.width+1);assert.ok(g.top>=0&&!g.overlap,JSON.stringify({size,expanded,...g}));assert.ok(g.bottom<g.inputTop);workLayouts.push({...size,expanded,...g});
     assert.ok(Math.abs(g.jumpTop-(g.inputTop-38))<3,JSON.stringify({size,...g}));
    }
   }
   if(engine==='chromium')await page.screenshot({path:path.join(out,'work-and-new-messages.png')});
   checks.push('Work result and expanded card never overlap New messages or the composer, including 360px panes');
   await page.evaluate(()=>{document.documentElement.removeAttribute('data-laolao-workspace-dock');document.documentElement.dataset.laolaoWorkspaceSplit='1';});await button.waitFor({state:'detached'});
   assert.equal(await page.locator('#laolao-dock-exit').count(),0);checks.push('Primary/single window stays unchanged; exit disappears with dock flag');
   assert.deepEqual(errors,[]);report.engines[engine]={status:'passed',checks,placements,workLayouts,errors};console.log(engine,'passed');
  }catch(error){console.log(engine,'FAILED',error.stack);throw error;}finally{releaseOld?.();releaseOld=null;console.log(engine,'closing');await browser.close();console.log(engine,'closed');await harness.close();}
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
finally{fs.writeFileSync(path.join(out,'dock-exit-acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
