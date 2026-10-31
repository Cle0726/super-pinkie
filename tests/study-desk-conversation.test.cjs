const test=require('node:test'),assert=require('node:assert/strict');
test('desk conversation is independent; ordinary learning chat has no tonight strip or collect controls',{timeout:60000},async()=>{
 const{startHarness,playwright,isolatedService}=await import('../tools/study-desk/harness.mjs');const service=await isolatedService(),histories=new Map();let serial=0;
 const handler=async(m,p)=>{
  if(m==='chat.history'){assert.match(p.sessionKey,/^agent:learning:desk-chat:/);return{messages:histories.get(p.sessionKey)||[]};}
  if(m==='chat.send'){assert.match(p.sessionKey,/^agent:learning:desk-chat:/);const list=histories.get(p.sessionKey)||[];list.push({role:'user',content:p.message,id:'u'+serial,timestamp:Date.now()},{role:'assistant',content:'do-while 先执行后判断，所以至少执行一次。',id:'a'+serial,timestamp:Date.now()+1});histories.set(p.sessionKey,list);return{runId:'run-'+(++serial)};}
  if(m==='chat.abort')return{ok:true};return service.handler(m,p);
 };
 const h=await startHarness({handler,legacyUI:true}),b=await playwright().chromium.launch({headless:true,channel:'chrome'});
 try{
  const p=await b.newPage({viewport:{width:1440,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(h.url);await p.waitForFunction(()=>!!window.__pinkieStudyConversation);
  await p.locator('.shell .chat-thread').evaluate(n=>{n.innerHTML='<article class="chat-group assistant"><div class="chat-bubble" data-message-id="outer" data-message-text="外部原聊天记录">外部原聊天记录</div></article>';});
  await p.locator('.shell .chat-bubble').hover();assert.equal(await p.locator('.pk-tonight:visible').count(),0);assert.equal(await p.locator('.pk-collect-btn:visible').count(),0);assert.equal(h.calls.filter(c=>c.method==='chat.history').length,0);
  await p.evaluate(()=>{__pinkieStudyDesk.go('today');__pinkieStudyDesk.setLayout('spread-chat');});await p.locator('#pinkie-desk-chat .pk-tonight').waitFor();
  assert.equal(await p.locator('#pinkie-desk-chat').innerText().then(x=>x.includes('外部原聊天记录')),false);
  const key=await p.evaluate(()=>__pinkieStudyConversation.sessionKey());assert.match(key,/^agent:learning:desk-chat:/);
  await p.getByRole('textbox',{name:'学习台聊天输入',exact:true}).fill('这两个循环有什么不同？');await p.getByRole('textbox',{name:'学习台聊天输入',exact:true}).press('Enter');
  await p.waitForFunction(()=>qaCalls.some(c=>c.method==='chat.send'));await p.evaluate(key=>dispatchEvent(new CustomEvent('pinkie:gateway-event',{detail:{event:'chat',payload:{sessionKey:key,runId:'run-1',state:'final',message:{role:'assistant',id:'a0',content:'do-while 先执行后判断，所以至少执行一次。',timestamp:Date.now()}}}})),key);
  const bubble=p.locator('#pinkie-desk-chat .chat-group.assistant .chat-bubble').first();await bubble.waitFor();assert.match(await bubble.innerText(),/先执行后判断/);
  assert.equal(await p.locator('.shell .chat-bubble').textContent(),'外部原聊天记录');
  await bubble.hover();await p.locator('.pk-collect-btn:visible').click();await p.getByRole('menuitem',{name:'收进笔记',exact:true}).click();await p.locator('#pinkie-desk-chat .pk-collected').waitFor();
  assert.equal(service.store.readNotesState().notes.length,1);assert.equal(service.store.readNotesState().notes[0].sourceSessionKey,key);
  await p.getByRole('button',{name:'回普通聊天',exact:true}).click();await p.waitForFunction(()=>document.documentElement.dataset.pinkieStudyDesk==='chat');
  assert.equal(await p.locator('.pk-tonight:visible').count(),0);assert.equal(await p.locator('.pk-collect-btn:visible').count(),0);assert.equal(await p.locator('.shell .chat-bubble').textContent(),'外部原聊天记录');
  await p.evaluate(()=>{__pinkieStudyDesk.go('today');__pinkieStudyDesk.setLayout('single-chat');});await bubble.waitFor();assert.equal(await p.evaluate(()=>__pinkieStudyConversation.sessionKey()),key);
  await p.evaluate(()=>{history.replaceState({},'', '/chat?session=agent:learning:another-external-chat');dispatchEvent(new CustomEvent('pinkie:session-selected',{detail:{sessionKey:'agent:learning:another-external-chat'}}));__pinkieStudyDesk.go('today');__pinkieStudyDesk.setLayout('single-chat');});
  assert.notEqual(await p.evaluate(()=>__pinkieStudyConversation.sessionKey()),key);await p.locator('.pk-chat-empty').waitFor();assert.deepEqual(errors,[]);
 }finally{await b.close();await h.close();await service.close();}
});
