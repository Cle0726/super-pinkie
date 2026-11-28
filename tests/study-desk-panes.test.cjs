const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'study-desk-complete-'));
let h,shared=null,harness=null,desk=null,currentHandler=()=>({});
test.before(async()=>h=await import('../tools/study-desk/harness.mjs'));
// 整个文件只起一个 Chrome、一个 harness：启动的 promise 只建一次，失败会被记住并在每个用例里重抛（不变成跳过）。
// harness 的 handler 转发给 currentHandler，每个用例进学习台前换成自己的 handler 并清空 server.calls。
// 前 4 个 1440×900 用例共用一个 context / 页面，每例先回同源空页、清存储和页面错误再进学习台；挂起动画帧那例照旧独立 context。
function sharedChrome(){
 shared??=h.playwright().chromium.launch({headless:true,channel:'chrome'}).then(browser=>({browser}),error=>({error}));
 return shared.then(got=>{if(got.error)throw got.error;return got.browser;});
}
function sharedHarness(){
 harness??=h.startHarness({handler:(method,p)=>currentHandler(method,p),legacyUI:true}).then(server=>({server}),error=>({error}));
 return harness.then(got=>{if(got.error)throw got.error;return got.server;});
}
test.after(async()=>{
 try{await desk?.context.close();}
 finally{
  try{if(shared){const got=await shared;if(got.browser)await got.browser.close();}}
  finally{if(harness){const got=await harness;if(got.server)await got.server.close();}}
 }
});
function useHandler(server,custom){currentHandler=custom;server.calls.length=0;}
function handler(){
 let serial=0;
 const words=[['continue','康听扭','继续；（循环里）跳过本次'],['ambulance','安比鲁冷斯','救护车'],['apply for','额普莱 佛','申请'],['pest','拍斯特','害虫；讨厌的人'],['deadline','待的赖恩','截止日期']].map(([word,homophone,meaning],i)=>({id:'w'+i,word,homophone,meaning,status:'ready',reviewCount:i,reviewLevel:i%4,exams:[{id:'pretco-b',tier:'核心'}],collocations:[{en:['continue working','call an ambulance','apply for a job','','meet the deadline'][i],zh:''}]}));
 return async(method,p)=>{
  if(method.endsWith('desk.metrics') || method.endsWith('desk.digest'))throw Error('No seeded statistics in this layout-only fixture');
  if(method.endsWith('desk.today'))return{date:'2026-10-29',focus:{kind:'set',title:'C 语言 · 循环结构',payload:{chapter:'c5',size:6}},exams:[],quiet:[],mastery:{subjects:[]},goals:{minutes:30,questions:6},progress:{questions:3,minutes:12},streak:{current:4}};
  if(method.endsWith('desk.set'))return{setId:'set-'+(++serial),title:p.chapter==='e2'?'英语 · 阅读理解':'C 语言 · 循环结构',questions:Array.from({length:6},(_,i)=>({id:p.chapter+'-'+i,k:p.chapter||'c5',i:0,kind:'single',q:'下面这段代码输出什么？\n\nfor (int i = 0; i < 5; i++) {\n  if (i == 2) continue;\n  printf("%d ", i);\n}',o:['0 1 3 4','0 1 2 3 4','0 1 2','0 1']}))};
  if(method.endsWith('desk.answer')){await new Promise(r=>setTimeout(r,50));return{correct:p.answer==='A',answer:'A',explanation:'continue 跳过本次循环。',independent:true};}
  if(method.endsWith('focus.status'))return{};
  if(method.endsWith('focus.start'))return{focus:{id:'focus-'+serial}};
  if(method.endsWith('vocab.list'))return{words,counts:{total:5,due:5,pending:0,byExam:{'pretco-b':{total:5,mastered:0,learning:5}}},settings:{exams:['pretco-b'],primary:'pretco-b'},exams:[{id:'pretco-b',name:'英语 B 级',short:'B级',approxSize:2500}],lists:[]};
  if(method.endsWith('desk.companion'))return{line:{text:'先生，先做一小组。',source:'template'}};
  if(method.endsWith('desk.clippings'))return{hidden:true};
  if(method.endsWith('ref.receipts'))return{receipts:[]};
  if(method.endsWith('notes.toc'))return{inbox:0,today:{count:0},mistakes:0,moved:0,exams:[]};
  if(method.endsWith('notes.list'))return{notes:[],total:0};
  if(method.endsWith('materials.status'))return{roots:[],jobs:[]};
  if(method.endsWith('lesson.current'))return null;
  return{};
 };
}
async function deskPage(server){
 const browser=await h.launchWithHarness(server,sharedChrome);
 if(!desk){const context=await browser.newContext({viewport:{width:1440,height:900}});await context.route('**/__blank',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>blank</title>'}));const d={context,page:await context.newPage(),errors:[]};d.page.on('pageerror',e=>d.errors.push(e.message));desk=d;}
 return desk;
}
async function run(fn,{custom=handler()}={}){
 const server=await sharedHarness();
 const {context,page,errors}=await deskPage(server);
 // 干净复位：先离开学习台到同源空页（context.route 回 200 空文档，无脚本；harness 回 404 时 Chromium 会报 ERR_HTTP_RESPONSE_CODE_FAILURE，about:blank 又读不了 localStorage），上一例的请求随之中止；清掉存储、cookie、视口和页面错误，再换 handler 进学习台。
 await page.goto(new URL('/__blank',server.url).href);
 await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await context.clearCookies();await page.setViewportSize({width:1440,height:900});
 useHandler(server,custom);errors.length=0;
 await page.goto(server.url);await page.waitForFunction(()=>!!window.__pinkieStudyDesk);
 await page.evaluate(()=>__pinkieStudyDesk.go('today'));await page.locator('.desk-page .view').first().waitFor();
 await fn(page,server);assert.deepEqual(errors,[]);
}
// 11-08：学习台改成一次一页，「两张卡各做一组题」和「对开装订」两条多卡用例随功能删除。
test('one page at a time: the chat card docks on the right, old multi-card workspaces migrate, and there are no drag handles',{timeout:60000},async()=>{
 await run(async page=>{
  await page.evaluate(()=>__pinkieStudyDesk.setLayout('spread-chat'));
  assert.deepEqual(await page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.view)),['today','deskchat'],'spread-chat is one study page plus the chat card');
  const [main,chat]=await page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.rect));
  assert.equal(main.x,0);assert.ok(main.w>0.6&&main.w<0.8,'main page fills the desk left of the chat card: '+main.w);assert.ok(Math.abs(chat.x+chat.w-1)<1e-6,'chat card docks right');
  assert.equal(await page.locator('.desk-page-grip, .desk-page-resize, [data-tidy], .v-book-layouts').count(),0,'no drag, resize, tidy or layout controls');
  assert.equal(await page.locator('.rail [draggable="true"]').count(),0,'index tabs are not dragged onto the desk any more');
  await page.evaluate(()=>{__pinkieStudyDesk.openOtherPage('board');__pinkieStudyDesk.openOtherPage('notes');});
  assert.deepEqual(await page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.view)),['notes','deskchat'],'other-page requests swap the main page');
  await page.evaluate(()=>__pinkieDeskSplit.close());assert.deepEqual(await page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.view)),['notes']);
  await page.evaluate(()=>{__pinkieDeskSplit.open();__pinkieDeskSplit.open();});assert.equal(await page.evaluate(()=>__pinkieStudyDesk.cards().filter(c=>c.view==='deskchat').length),1,'only one chat card');
  // 旧的多卡工作区：载入时只留最上面那张学习页 + 对话卡。
  await page.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('pinkie-desk-pages:'));localStorage.setItem(k,JSON.stringify({focus:2,tiled:false,panes:[{view:'today',z:1,rect:{x:0,y:0,w:.3,h:1}},{view:'vocab',z:4,rect:{x:.3,y:0,w:.3,h:1}},{view:'board',z:2},{view:'deskchat',z:3},{view:'notes',z:1}]}));});
  await page.reload();await page.waitForFunction(()=>!!window.__pinkieStudyDesk);await page.evaluate(()=>__pinkieStudyDesk.go('vocab'));
  assert.deepEqual(await page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.view)),['vocab','deskchat'],'migrated to the top study page plus the chat card');
 });
});
test('index tabs swap the one study page and the chat tab opens or closes the chat card',{timeout:60000},async()=>{
 await run(async page=>{
  const cards=()=>page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.view).join(' '));
  const tab=async id=>{await page.locator(`.rail [data-go="${id}"]`).click();return cards();};
  assert.equal(await cards(),'today');
  assert.equal(await tab('board'),'board');
  assert.equal(await tab('vocab'),'vocab');
  assert.equal(await tab('deskchat'),'vocab deskchat');
  assert.equal(await tab('stage'),'stage deskchat');
  assert.equal(await tab('deskchat'),'stage','the chat tab closes an open chat card');
  assert.equal(await page.locator('.desk-page:not([data-view="deskchat"]) .desk-page-action:visible').count(),0,'the study page has no close button');
 });
});
test('the desk never shows over the ordinary chat',{timeout:45000},async()=>{
 await run(async page=>{
  await page.evaluate(()=>__pinkieStudyDesk.setLayout('single-chat'));
  await page.evaluate(()=>__pinkieStudyDesk.go('chat'));await page.waitForFunction(()=>document.querySelector('#pinkie-study-desk')?.dataset.view==='chat');
  assert.equal(await page.locator('.desk-content').isVisible(),false);
 });
});
test('notes review opens the drill, shows the question before the answer, and finishes one card',{timeout:45000},async()=>{
 // 旧的「今天回顾」翻面舞台已经换成背一背：从笔记本「今天要背」进来，题面只有问题，翻面后才有答案，打分后出反馈条。
 const base=handler();const item={itemId:'d1',mode:'flip',strength:1,cardRef:{book:'notes',noteId:'raw',recallId:'recall'},prompt:'“避免犯错”用英语怎么说？',answer:'avoid making mistakes',reveal:{question:'“避免犯错”用英语怎么说？',answer:'avoid making mistakes'}};
 await run(async(page,server)=>{
  await page.evaluate(()=>__pinkieStudyDesk.go('notes',{view:'review'}));await page.locator('.pk-drill .pk-drill-stem').waitFor();
  assert.equal(await page.locator('.pk-drill .pk-drill-stem').innerText(),'“避免犯错”用英语怎么说？');
  assert.equal(await page.locator('.pk-drill').innerText().then(t=>t.includes('avoid making mistakes')),false);
  await page.locator('.pk-drill-stem').click();await page.keyboard.press('Space');await page.getByText('avoid making mistakes').waitFor();
  await page.getByRole('button',{name:/记得/}).click();await page.locator('.pk-sheet').waitFor();
  const answered=server.calls.filter(c=>c.method.endsWith('drill.answer'));
  assert.equal(answered.length,1);assert.equal(answered[0].params.itemId,'d1');assert.equal(answered[0].params.correct,true);
 },{custom:async(method,p)=>method.endsWith('drill.session')?{sessionId:'s1',items:[item],pending:0,dueLeft:0,settings:{soundDefault:true,size:10,jarGoal:30,flipOnly:false}}
  :method.endsWith('drill.settings.get')?{size:10,jarGoal:30,flipOnly:false}
  :method.endsWith('drill.answer')?{rating:'remembered',stars:1,requeue:false}
  :method.endsWith('notes.toc')?{inbox:0,today:{count:1},mistakes:0,moved:0,exams:[]}:base(method,p)});
});
test('paper remains visible when a background WebView suspends its first animation frame',{timeout:45000},async()=>{
 for(const engine of ['chromium','webkit']){
  const server=await sharedHarness();useHandler(server,handler());
  // Chrome 用文件内共用的那一个；WebKit 只在这一例用到，照旧单独起、用完就关。harness 共用，由文件级 after 关。
  const own=engine!=='chromium';
  const browser=await h.launchWithHarness(server,own?()=>h.playwright()[engine].launch({headless:true}):sharedChrome);
  let context;
  try{
   context=await browser.newContext({viewport:{width:840,height:1050}});
   const p=await context.newPage();await p.goto(server.url);await p.waitForFunction(()=>!!window.__pinkieStudyConversation,{},{polling:100});
   await p.evaluate(()=>{__pinkieStudyDesk.go('deskchat');for(const a of document.querySelector('.view').getAnimations()){a.pause();a.currentTime=0;}});
   const paper=await p.locator('.view').evaluate(n=>({opacity:getComputedStyle(n).opacity,bounds:n.getBoundingClientRect().toJSON(),bookZ:getComputedStyle(n.closest('.desk-content')).zIndex}));
   assert.equal(paper.opacity,'1',engine+' must not depend on a running animation to show the paper');assert.ok(paper.bounds.width>600&&paper.bounds.height>900);assert.equal(paper.bookZ,'1');
   assert.equal(await p.getByRole('textbox',{name:'学习台聊天输入',exact:true}).isVisible(),true);
   await p.evaluate(async()=>{await __pinkieStudyDesk.startSet({chapter:'c5'});__pinkieStudyDesk.setLayout('spread-chat');});
   await p.evaluate(()=>__pinkieStudyDesk.focusPane(__pinkieStudyDesk.pages().find(x=>x.view==='deskchat').id));
   const marginContent=await p.locator('.side .ln,.side .fig img').evaluateAll(ns=>ns.map(n=>({opacity:getComputedStyle(n).opacity,animation:getComputedStyle(n).animationName})));
   assert.ok(marginContent.length>1);assert.ok(marginContent.every(x=>x.opacity==='1'&&x.animation==='none'),engine+' freezes the page-edge note and sticker in their readable state');
  }finally{try{await context?.close();}finally{if(own)await browser.close();}}
 }
});
