const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'study-desk-complete-'));
let h;
test.before(async()=>h=await import('../tools/study-desk/harness.mjs'));
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
async function run(fn,{width=1440,custom=handler()}={}){
 const server=await h.startHarness({handler:custom,legacyUI:true});
 const browser=await h.playwright().chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.waitForFunction(()=>!!window.__pinkieStudyDesk);
  await page.evaluate(()=>__pinkieStudyDesk.go('today'));await page.locator('.greet').waitFor();
  await fn(page,server);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
}
test('two exercises keep selection, pending grading and keyboard ownership independent',{timeout:45000},async()=>{
 await run(async(page,server)=>{
  await page.evaluate(async()=>{await __pinkieStudyDesk.startSet({chapter:'c5'});__pinkieStudyDesk.openOtherPage('stage');await __pinkieStudyDesk.startSet({chapter:'e2'});});
  const panes=page.locator('.desk-page');assert.equal(await panes.count(),2);
  await panes.nth(0).locator('.q-text').click();await page.keyboard.press('1');
  assert.equal(await panes.nth(0).locator('.opt.sel').count(),1);assert.equal(await panes.nth(1).locator('.opt.sel').count(),0);
  await panes.nth(0).locator('.confirm-answer').click();await panes.nth(1).locator('.q-text').click();await page.keyboard.press('2');
  await page.waitForFunction(()=>document.querySelectorAll('.desk-page')[0].querySelector('.opt.answered'));
  assert.equal(await panes.nth(1).locator('.opt.answered').count(),0);assert.equal(await panes.nth(1).locator('.opt.sel .t').innerText(),'0 1 2 3 4');
  assert.equal(server.calls.filter(c=>c.method.endsWith('desk.answer')).length,1);assert.match(server.calls.find(c=>c.method.endsWith('desk.answer')).params.questionId,/^c5-/);
  await page.evaluate(()=>__pinkieStudyDesk.go('chat'));await page.evaluate(()=>__pinkieStudyDesk.go('stage'));
  assert.equal(await panes.nth(0).locator('.opt.answered').count(),4);assert.equal(await panes.nth(1).locator('.opt.sel').count(),1);
 });
});
test('the approved spread is one bound book with question and vocabulary footers',{timeout:45000},async()=>{
 await run(async page=>{
  await page.evaluate(async()=>{await __pinkieStudyDesk.startSet({chapter:'c5'});const local=__pinkieStudyDesk.local();local.stage.index=3;local.stage.selected=['A'];__pinkieStudyDesk.refresh();__pinkieStudyDesk.setLayout('spread-chat');});
  await page.locator('.v-book-word').first().waitFor();await page.waitForTimeout(800);
  const geometry=await page.locator('.desk-page').evaluateAll(ns=>ns.map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,scroll:n.scrollWidth,body:n.querySelector('.view').getBoundingClientRect().toJSON()})));
  assert.ok(Math.abs(geometry[0].x+geometry[0].width-geometry[1].x)<1,'pages touch at the spine');
  for(const g of geometry)assert.ok(g.scroll<=g.width+1);
  assert.equal(await page.locator('.s-number').innerText(),'第 4 题');assert.equal(await page.locator('.v-spread-title').innerText(),'今天到期 5 个');
  const foot=await page.locator('.q-foot').boundingBox(),view=await page.locator('.view.stage').boundingBox();assert.ok(foot.y>view.y+view.height*.8);
  await page.screenshot({path:output+'/reference-spread-day.png'});
  await page.evaluate(()=>{document.documentElement.dataset.themeMode='dark';document.documentElement.setAttribute('data-pinkie-night','');});await page.waitForTimeout(400);
  await page.screenshot({path:output+'/reference-spread-night.png'});
  await page.setViewportSize({width:1280,height:800});
  const margin=await page.locator('.view.stage').evaluate(n=>({line:parseFloat(getComputedStyle(n).getPropertyValue('--pk-margin-x')),content:parseFloat(getComputedStyle(n).paddingLeft)}));
  assert.ok(margin.content-margin.line>=18,'the writing area stays to the right of the page margin in a narrow spread');
 });
});
test('cards are free: drag, resize and maximize persist per conversation, the chat is a card, and heavy views stay exclusive',{timeout:60000},async()=>{
 await run(async page=>{
  await page.evaluate(()=>__pinkieStudyDesk.setLayout('spread-chat'));await page.locator('.v-book-word').first().waitFor();
  assert.deepEqual(await page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.view)),['today','vocab','deskchat']);
  assert.equal(await page.locator('select[data-layout], .desk-layout-bar').count(),0);
  const second=page.locator('.desk-page').nth(1),grip=await second.locator('.desk-page-grip').boundingBox();
  await page.mouse.move(grip.x+grip.width/2,grip.y+10);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2-160,grip.y+10,{steps:6});await page.mouse.up();
  const moved=(await page.evaluate(()=>__pinkieStudyDesk.cards()))[1].rect;assert.ok(moved.x<0.3,'card moved left: '+moved.x);
  assert.equal(await page.evaluate(()=>String(getSelection())),'');assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-tiled'),'false');
  const first=page.locator('.desk-page').nth(0);await page.locator('[data-tidy]').click();await first.hover();const se=await first.locator('.desk-page-resize[data-edge="se"]').boundingBox();
  await page.mouse.move(se.x+10,se.y+10);await page.mouse.down();await page.mouse.move(se.x-100,se.y-200,{steps:6});await page.mouse.up();
  const resized=(await page.evaluate(()=>__pinkieStudyDesk.cards()))[0].rect;assert.ok(resized.w<0.35&&resized.h<0.8,'card resized: '+JSON.stringify(resized));
  const tape=await first.locator('.desk-page-grip').boundingBox();for(let i=0;i<2;i++){await page.mouse.click(tape.x+30,tape.y+8);}
  assert.deepEqual((await page.evaluate(()=>__pinkieStudyDesk.cards()))[0].rect,{x:0,y:0,w:1,h:1});
  for(let i=0;i<2;i++){await page.mouse.click(tape.x+30,tape.y+8);}assert.deepEqual((await page.evaluate(()=>__pinkieStudyDesk.cards()))[0].rect,resized);
  await page.reload();await page.waitForFunction(()=>!!window.__pinkieStudyDesk);await page.evaluate(()=>__pinkieStudyDesk.go('today'));
  assert.deepEqual((await page.evaluate(()=>__pinkieStudyDesk.cards()))[0].rect,resized);
  await page.evaluate(()=>__pinkieDeskSplit.close());assert.deepEqual(await page.evaluate(()=>__pinkieStudyDesk.cards().map(c=>c.view)).then(v=>v.includes('deskchat')),false);
  await page.evaluate(()=>__pinkieDeskSplit.open());assert.equal(await page.evaluate(()=>__pinkieStudyDesk.cards().filter(c=>c.view==='deskchat').length),1);
  await page.evaluate(()=>__pinkieDeskSplit.open());assert.equal(await page.evaluate(()=>__pinkieStudyDesk.cards().filter(c=>c.view==='deskchat').length),1,'only one chat card');
  await page.evaluate(()=>{__pinkieStudyDesk.openOtherPage('board');__pinkieStudyDesk.openOtherPage('notes');});assert.equal(await page.locator('.desk-page').count(),5,'four pages plus the chat card');
  await page.evaluate(()=>__pinkieStudyDesk.openOtherPage('board'));assert.equal(await page.locator('.desk-page').count(),5,'at most four pages; the chat card does not count');
  await page.evaluate(()=>{const ctx=__pinkieStudyDesk.contexts();ctx[0].desk.go('stage');ctx[0].desk.switchStageMode('experiment');ctx[1].desk.go('library');});
  assert.match(await page.locator('.desk-status').innerText(),/先合上/);assert.notEqual((await page.evaluate(()=>__pinkieStudyDesk.pages()))[1].view,'library');
 });
});
test('index tabs open a new card, bring an open one forward, replace the stalest when full, and Option swaps in place',{timeout:60000},async()=>{
 await run(async page=>{
  const cards=()=>page.evaluate(()=>{const c=__pinkieStudyDesk.cards(),top=Math.max(...c.map(x=>x.z));return c.map(x=>x.view+(x.z===top?'*':'')).join(' ');});
  const tab=async(id,modifiers)=>{await page.locator(`.rail [data-go="${id}"]`).click(modifiers?{modifiers}:{});return cards();};
  assert.equal(await cards(),'today*');
  assert.equal(await tab('board'),'today board*');
  assert.equal(await tab('vocab'),'today board vocab*');
  assert.equal(await tab('today'),'today* board vocab','an open page comes forward instead of opening twice');
  assert.equal(await tab('notes'),'today board vocab notes*');
  assert.equal(await tab('board'),'today board* vocab notes');
  assert.equal(await tab('stage'),'today board stage* notes','full desk: the stalest card that is not in front is replaced');
  assert.equal(await tab('deskchat'),'today board stage notes deskchat*','the chat card never counts against the four pages');
  assert.equal((await tab('vocab',['Alt'])).replace(/\*/g,''),'today board vocab notes deskchat','Option-click swaps the focused study page (stage) in place');
  assert.equal(await page.locator('.desk-page-tools button').count(),await page.locator('.desk-page').count(),'only a close button per card');
 });
});
test('the desk and its card handles never show over the ordinary chat',{timeout:45000},async()=>{
 await run(async page=>{
  await page.evaluate(()=>__pinkieStudyDesk.setLayout('spread'));await page.locator('.v-book-word').first().waitFor();
  assert.equal(await page.locator('.desk-page-grip').first().isVisible(),true);
  await page.evaluate(()=>__pinkieStudyDesk.go('chat'));await page.waitForFunction(()=>document.querySelector('#pinkie-study-desk')?.dataset.view==='chat');
  assert.equal(await page.locator('.desk-content').isVisible(),false);assert.equal(await page.locator('.desk-page-grip:visible').count(),0);
 });
});
test('recall front never falls back to the pasted answer, even for an old uncategorized note',{timeout:45000},async()=>{
 const base=handler();await run(async page=>{
  await page.evaluate(()=>__pinkieStudyDesk.go('notes',{view:'review'}));await page.locator('.n-q').waitFor();
  assert.equal(await page.locator('.n-q').innerText(),'“避免犯错”用英语怎么说？');assert.equal(await page.locator('.n-ans').count(),0);
  assert.equal(await page.locator('.n-review').innerText().then(t=>t.includes('avoid making mistakes')),false);
  await page.locator('.n-q').click();await page.keyboard.press('Space');await page.locator('.n-ans').waitFor();assert.match(await page.locator('.n-ans').innerText(),/avoid making mistakes/);
 },{custom:async(method,p)=>method.endsWith('notes.recall.queue')?{notes:[{id:'raw',title:'avoid making mistakes（避免犯错）',content:'avoid making mistakes（避免犯错）',recallId:'recall',recallQuestion:'“避免犯错”用英语怎么说？',recallAnswer:'avoid making mistakes'}],todayCount:1,backlog:0,dailyLimit:10}:base(method,p)});
});
test('paper remains visible when a background WebView suspends its first animation frame',{timeout:45000},async()=>{
 for(const engine of ['chromium','webkit']){
  const server=await h.startHarness({handler:handler(),legacyUI:true});
  const browser=await h.playwright()[engine].launch(engine==='chromium'?{headless:true,channel:'chrome'}:{headless:true});
  try{
   const p=await browser.newPage({viewport:{width:840,height:1050}});await p.goto(server.url);await p.waitForFunction(()=>!!window.__pinkieStudyConversation,{},{polling:100});
   await p.evaluate(()=>{__pinkieStudyDesk.go('deskchat');for(const a of document.querySelector('.view').getAnimations()){a.pause();a.currentTime=0;}});
   const paper=await p.locator('.view').evaluate(n=>({opacity:getComputedStyle(n).opacity,bounds:n.getBoundingClientRect().toJSON(),bookZ:getComputedStyle(n.closest('.desk-content')).zIndex}));
   assert.equal(paper.opacity,'1',engine+' must not depend on a running animation to show the paper');assert.ok(paper.bounds.width>600&&paper.bounds.height>900);assert.equal(paper.bookZ,'1');
   assert.equal(await p.getByRole('textbox',{name:'学习台聊天输入',exact:true}).isVisible(),true);
   await p.evaluate(async()=>{await __pinkieStudyDesk.startSet({chapter:'c5'});__pinkieStudyDesk.setLayout('spread-chat');});await p.locator('.v-book-word').first().waitFor();
   await p.evaluate(()=>__pinkieStudyDesk.focusPane(__pinkieStudyDesk.pages()[1].id));
   const marginContent=await p.locator('.side .ln,.side .fig img').evaluateAll(ns=>ns.map(n=>({opacity:getComputedStyle(n).opacity,animation:getComputedStyle(n).animationName})));
   assert.ok(marginContent.length>1);assert.ok(marginContent.every(x=>x.opacity==='1'&&x.animation==='none'),engine+' freezes the page-edge note and sticker in their readable state');
  }finally{await browser.close();await server.close();}
 }
});
