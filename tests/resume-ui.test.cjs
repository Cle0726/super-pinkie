const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

function loadResumeHarness(historyPages){
  const vm=require('node:vm');
  const source=read('ui/injections/laolao-resume.js');
  const sessionKey='agent:unrestricted:dashboard:long-history';
  const requestedOffsets=[];
  const client={
    async request(method,params){
      if(method==='sessions.list')return {sessions:[]};
      assert.equal(method,'chat.history');
      requestedOffsets.push(params.offset);
      assert.equal(params.sessionKey,sessionKey);
      assert.equal(params.agentId,'unrestricted');
      assert.equal(params.limit,128);
      return historyPages.get(params.offset);
    },
  };
  const state={
    sessionKey,
    chatMessages:[],
    chatHistoryPagination:{hasMore:true,nextOffset:2},
    chatUserNearBottom:false,
    async refreshCurrentChat(){ this.chatMessages=[historyPages.get(0).messages.at(-1)]; },
    requestUpdate(){ this.updateCount=(this.updateCount||0)+1; },
    scrollToBottom(){ this.scrolled=true; },
  };
  const gateway={snapshot:{connected:true,client},subscribe(){return ()=>{};}};
  const pane={state};
  const shell={context:{gateway}};
  const document={
    hidden:false,
    visibilityState:'visible',
    documentElement:{setAttribute(){},removeAttribute(){}},
    querySelector(selector){
      if(selector==='openclaw-chat-pane')return pane;
      if(selector==='openclaw-app-shell')return shell;
      if(selector==='.agent-chat__composer-combobox textarea')return {};
      return null;
    },
    addEventListener(){},
  };
  const location={pathname:'/chat',search:`?session=${encodeURIComponent(sessionKey)}`};
  const window={
    location,
    setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},
    addEventListener(){},dispatchEvent(){},
  };
  class MutationObserver{observe(){} disconnect(){}}
  class CustomEvent{constructor(type,options){this.type=type;this.detail=options?.detail;}}
  class Element{}
  const context={window,document,location,MutationObserver,CustomEvent,Element,URLSearchParams,URL,Map,Set,Number,Array,JSON,Promise,Error,Date,console};
  vm.runInNewContext(source,context,{filename:'laolao-resume.js'});
  return {window,state,requestedOffsets,client,pane,shell,gateway};
}

function loadTwoPaneHarness(request,options={}){
  const vm=require('node:vm');
  const listeners=new Map();
  let nowAt=options.now ?? Date.now();
  const TestDate=options.clock ? class extends Date {static now(){return nowAt;}} : Date;
  const leftKey='agent:project:dashboard:left';
  const rightKey='agent:learning:dashboard:right';
  const makePane=(key,active)=>({
    active,sessionKey:key,tagName:'OPENCLAW-CHAT-PANE',
    state:{sessionKey:key,chatMessages:[],chatHistoryPagination:{},requestUpdate(){},
      scrollToBottom(){this.scrollCount=(this.scrollCount||0)+1;}},
    querySelector(){return null;},requestUpdate(){},
  });
  const left=makePane(leftKey,true),right=makePane(rightKey,false);
  const panes=[left,right];
  const page={data:{sessionKey:leftKey},requestUpdate(){}};
  const client={request};
  const gateway={snapshot:{connected:true,client},subscribe(){return ()=>{};}};
  const shell={context:{gateway}};
  const document={
    hidden:false,visibilityState:'visible',
    documentElement:{setAttribute(){},removeAttribute(){},getAttribute(){return options.watchdogState ?? null;},
      hasAttribute(name){return options.splitVisible === true && name==='data-laolao-workspace-split';}},
    querySelector(selector){
      if(selector==='openclaw-chat-pane')return panes[0];
      if(selector==='openclaw-chat-page')return page;
      if(selector==='openclaw-app-shell')return shell;
      if(selector==='.agent-chat__composer-combobox textarea')return {};
      return null;
    },
    querySelectorAll(selector){return selector==='openclaw-chat-pane'?panes:[];},
    addEventListener(name,handler){
      const handlers=listeners.get(name)||[];
      handlers.push(handler);
      listeners.set(name,handlers);
    },dispatchEvent(){},
  };
  const location={pathname:'/chat',search:`?session=${encodeURIComponent(leftKey)}`};
  const window={location,setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},
    addEventListener(){},dispatchEvent(){}};
  class MutationObserver{observe(){} disconnect(){}}
  class CustomEvent{constructor(type,options){this.type=type;this.detail=options?.detail;}}
  class Element{}
  vm.runInNewContext(read('ui/injections/laolao-resume.js'),
    {window,document,location,MutationObserver,CustomEvent,Element,URLSearchParams,URL,
      Map,WeakMap,Set,Number,Array,JSON,Promise,Error,Date:TestDate,console},
    {filename:'laolao-resume.js'});
  return {window,document,location,page,left,right,leftKey,rightKey,panes,gateway,
    dispatch(name,event){for(const handler of listeners.get(name)||[])handler(event);},
    setTime(value){nowAt=value;}};
}

const sendButton=()=>({
  disabled:false,classList:{contains(){return false;}},
  hasAttribute(){return false;},getAttribute(name){return name==='aria-label'?'发送消息':null;},
  closest(selector){return selector==='.chat-send-btn'?this:null;},
});

test('a split-pane send follows its own persisted final even when native state already rendered it offscreen',async()=>{
  const oldLeft={role:'assistant',content:'left old',__openclaw:{id:'left-old'}};
  const oldRight={role:'assistant',content:'right old',__openclaw:{id:'right-old'}};
  const finalRight={role:'assistant',content:'RIGHT_FINAL',stopReason:'stop',
    __openclaw:{id:'right-final'}};
  const h=loadTwoPaneHarness(async(method,params)=>{
    assert.equal(method,'chat.history');
    return {messages:[params.sessionKey===h.rightKey?finalRight:oldLeft],hasMore:false};
  });
  h.left.state.chatMessages=[oldLeft];
  h.right.state.chatMessages=[oldRight];
  h.left.state.chatUserNearBottom=false;
  h.right.state.chatUserNearBottom=false;
  const button=sendButton();
  h.dispatch('pointerdown',{target:button,composedPath:()=>[button,h.right]});
  assert.equal(h.left.state.chatUserNearBottom,false);
  assert.equal(h.right.state.chatUserNearBottom,true);
  // The native renderer can append the final without scrolling and reset its
  // near-bottom flag before our idle history sync sees the same message.
  h.right.state.chatMessages=[finalRight];
  h.right.state.chatUserNearBottom=false;
  assert.equal(await h.window.__laolaoRecoverCurrentChat('dual-final',{manual:true}),true);
  assert.equal(h.right.state.scrollCount,1);
  assert.equal(h.left.state.scrollCount||0,0);
});

test('manual scrolling after a split-pane send cancels forced reply follow',async()=>{
  const previous={role:'assistant',content:'previous',__openclaw:{id:'previous'}};
  const final={role:'assistant',content:'FINAL',stopReason:'stop',__openclaw:{id:'final'}};
  const h=loadTwoPaneHarness(async(method)=>{
    assert.equal(method,'chat.history');
    return {messages:[final],hasMore:false};
  });
  h.right.state.chatMessages=[previous];
  const button=sendButton();
  const event={target:button,composedPath:()=>[button,h.right]};
  h.dispatch('pointerdown',event);
  h.dispatch('wheel',event);
  assert.equal(h.right.state.chatUserNearBottom,false);
  await h.window.__laolaoRecoverCurrentChat('user-scrolled',{manual:true});
  assert.equal(h.right.state.scrollCount||0,0);
});

test('send-follow survives replacement of the native chat pane during tool rendering',async()=>{
  const previous={role:'assistant',content:'previous',__openclaw:{id:'previous'}};
  const final={role:'assistant',content:'FINAL_AFTER_REBUILD',stopReason:'stop',
    __openclaw:{id:'rebuilt-final'}};
  const h=loadTwoPaneHarness(async(method,params)=>{
    assert.equal(method,'chat.history');
    return {messages:[params.sessionKey===h.rightKey?final:previous],hasMore:false};
  });
  h.right.state.chatMessages=[previous];
  const button=sendButton();
  h.dispatch('pointerdown',{target:button,composedPath:()=>[button,h.right]});
  const replacement={...h.right,state:{...h.right.state,chatMessages:[final],
    chatUserNearBottom:false,scrollToBottom(){this.scrollCount=(this.scrollCount||0)+1;}}};
  h.panes[1]=replacement;
  assert.equal(await h.window.__laolaoRecoverCurrentChat('pane-remount',{manual:true}),true);
  assert.equal(replacement.state.scrollCount,1);
  assert.equal(h.left.state.scrollCount||0,0);
});

test('recovery reads the final through the independent sidebar socket when native RPC fails',async()=>{
  const final={role:'assistant',content:'FINAL_VIA_FALLBACK',stopReason:'stop',
    __openclaw:{id:'fallback-final'}};
  const calls=[];
  const h=loadTwoPaneHarness(async()=>{throw new Error('native socket poisoned');});
  h.panes.pop();
  h.window.__laolaoSidebar={gwRequest:async(method,params)=>{
    calls.push(method);
    assert.equal(method,'chat.history');
    assert.equal(params.sessionKey,h.leftKey);
    return {messages:[final],hasMore:false};
  }};
  assert.equal(await h.window.__laolaoRecoverCurrentChat('native-rpc-failed',{manual:true}),true);
  assert.equal(h.left.state.chatMessages[0].content,'FINAL_VIA_FALLBACK');
  assert.deepEqual(calls,['chat.history']);
});

test('recovery works with only the sidebar socket during a native client handoff',async()=>{
  const final={role:'assistant',content:'FINAL_DURING_HANDOFF',stopReason:'stop',
    __openclaw:{id:'handoff-final'}};
  const h=loadTwoPaneHarness(async()=>{throw new Error('native should not be called');});
  h.panes.pop();
  h.gateway.snapshot.client=null;
  h.window.__laolaoSidebar={gwRequest:async()=>({messages:[final],hasMore:false})};
  assert.equal(await h.window.__laolaoRecoverCurrentChat('client-handoff',{manual:true}),true);
  assert.equal(h.left.state.chatMessages[0].content,'FINAL_DURING_HANDOFF');
});

test('each split pane recovers its own history while the other pane is busy',async()=>{
  const calls=[];
  const h=loadTwoPaneHarness(async(method,params)=>{
    if(method==='sessions.list')return {sessions:[]};
    assert.equal(method,'chat.history');
    calls.push(params.sessionKey);
    return {messages:[{role:'assistant',content:params.sessionKey,
      __openclaw:{id:params.sessionKey}}],totalMessages:1};
  });
  h.right.state.chatRunId='real-running-turn';
  assert.equal(await h.window.__laolaoRecoverCurrentChat('split',{manual:true}),true);
  assert.deepEqual(calls,[h.leftKey]);
  assert.equal(h.left.state.chatMessages[0].content,h.leftKey);
  assert.equal(h.right.state.chatMessages.length,0);
  h.right.state.chatRunId=null;
  assert.equal(await h.window.__laolaoRecoverCurrentChat('split-idle',{manual:true}),true);
  assert.deepEqual(calls,[h.leftKey,h.leftKey,h.rightKey]);
  assert.equal(h.right.state.chatMessages[0].content,h.rightKey);
});

test('a route switch cannot apply an old in-flight history result',async()=>{
  let finishOld;
  const oldResult=new Promise(resolve=>{finishOld=resolve;});
  const calls=[];
  const h=loadTwoPaneHarness(async(method,params)=>{
    if(method==='sessions.list')return {sessions:[]};
    calls.push(params.sessionKey);
    if(params.sessionKey===h.leftKey)return oldResult;
    return {messages:[{role:'assistant',content:'new',__openclaw:{id:'new'}}]};
  });
  h.right.state.chatRunId='other-pane-is-busy';
  const first=h.window.__laolaoRecoverCurrentChat('old',{manual:true});
  h.location.search=`?session=${encodeURIComponent(h.rightKey)}`;
  h.left.sessionKey=h.rightKey;
  h.left.state.sessionKey=h.rightKey;
  h.page.data={sessionKey:h.rightKey};
  const second=h.window.__laolaoRecoverCurrentChat('new',{manual:true});
  finishOld({messages:[{role:'assistant',content:'old',__openclaw:{id:'old'}}]});
  await Promise.all([first,second]);
  assert.deepEqual(calls,[h.leftKey,h.rightKey]);
  assert.equal(h.left.state.chatMessages[0].content,'new');
});

test('stale route data is repaired before the old active pane can be refreshed',async()=>{
  const calls=[];
  const h=loadTwoPaneHarness(async(method,params)=>{
    if(method==='sessions.list')return {sessions:[]};
    calls.push(params.sessionKey);
    return {messages:[{role:'assistant',content:params.sessionKey,
      __openclaw:{id:params.sessionKey}}]};
  });
  h.location.search=`?session=${encodeURIComponent(h.rightKey)}`;
  await h.window.__laolaoRecoverCurrentChat('route',{manual:true});
  assert.equal(h.page.data.sessionKey,h.rightKey);
  assert.deepEqual(calls,[h.rightKey]); // non-active right only
  assert.equal(h.left.state.chatMessages.length,0);
});

test('single-pane route repair waits for the new native session before loading history',async()=>{
  const calls=[];
  const h=loadTwoPaneHarness(async(method,params)=>{
    if(method==='sessions.list')return {sessions:[]};
    calls.push(params.sessionKey);
    return {messages:[{role:'assistant',content:params.sessionKey,
      __openclaw:{id:params.sessionKey}}]};
  });
  h.panes.pop();
  const nextKey='agent:project:dashboard:another-session';
  h.location.search=`?session=${encodeURIComponent(nextKey)}`;
  await h.window.__laolaoRecoverCurrentChat('route-start',{manual:true});
  assert.equal(h.page.data.sessionKey,nextKey);
  assert.deepEqual(calls,[]);
  await h.window.__laolaoRecoverCurrentChat('route-prop',{manual:true});
  assert.equal(h.left.sessionKey,nextKey);
  assert.deepEqual(calls,[]);
  h.left.state.sessionKey=nextKey;
  assert.equal(await h.window.__laolaoRecoverCurrentChat('route-ready',{manual:true}),true);
  assert.deepEqual(calls,[nextKey]);
  assert.equal(h.left.state.chatMessages[0].content,nextKey);
});

test('clicking the already-selected session replaces a stale body from another session',async()=>{
  const calls=[];
  const h=loadTwoPaneHarness(async(method,params)=>{
    if(method==='sessions.list')return {sessions:[{key:h.leftKey,hasActiveRun:false}]};
    assert.equal(method,'chat.history');
    calls.push(params.sessionKey);
    return {messages:[{role:'assistant',content:'correct-left-transcript',
      __openclaw:{id:'left-latest'}}]};
  });
  h.panes.pop();
  h.left.state.chatMessages=[{role:'assistant',content:'stale-right-transcript',
    __openclaw:{id:'right-old'}}];
  h.left.state.chatRunId='stale-completed-run';
  assert.equal(await h.window.__laolaoSyncSelectedSession(h.leftKey),true);
  assert.deepEqual(calls,[h.leftKey]);
  assert.equal(h.left.state.chatRunId,null);
  assert.equal(h.left.state.chatMessages[0].content,'correct-left-transcript');
});

test('selected-session repair never clears a genuinely active backend turn',async()=>{
  const h=loadTwoPaneHarness(async(method)=>{
    assert.equal(method,'sessions.list');
    return {sessions:[{key:h.leftKey,hasActiveRun:true}]};
  });
  h.panes.pop();
  h.left.state.chatRunId='real-running-turn';
  assert.equal(await h.window.__laolaoSyncSelectedSession(h.leftKey),false);
  assert.equal(h.left.state.chatRunId,'real-running-turn');
});

test('stale-busy cleanup is scoped to one pane and never clears a different active turn',async()=>{
  const h=loadTwoPaneHarness(async(method)=>{
    if(method==='sessions.list')return {sessions:[
      {key:h.leftKey,hasActiveRun:false},
      {key:h.rightKey,hasActiveRun:true},
    ]};
    throw new Error(`unexpected ${method}`);
  });
  h.left.state.chatRunId='stale-left';
  h.right.state.chatRunId='real-right';
  assert.equal(await h.window.__laolaoStaleBusy.backendHasActiveRun(h.leftKey),false);
  assert.equal(await h.window.__laolaoStaleBusy.backendHasActiveRun(h.rightKey),true);
  h.window.__laolaoStaleBusy.forceIdle();
  assert.equal(h.left.state.chatRunId,null);
  assert.equal(h.right.state.chatRunId,'real-right');
});

test('a stale retry ribbon cannot deadlock single-pane terminal recovery',async()=>{
  const h=loadTwoPaneHarness(async(method)=>{
    assert.equal(method,'sessions.list');
    return {sessions:[{key:h.leftKey,hasActiveRun:false}]};
  },{clock:true,now:1_000,watchdogState:'retrying'});
  h.panes.pop();
  h.left.state.chatRunId='finished-backend-run';
  await h.window.__laolaoStaleBusy.reconcile();
  h.setTime(30_000);
  await h.window.__laolaoStaleBusy.reconcile();
  assert.equal(h.left.state.chatRunId,null);
  assert.match(read('ui/injections/laolao-resume.js'),
    /const waitingForGateway = !recoveryTransportAvailable\(\)/);
});

test('an unfocused but visible split pane clears a completed run and loads its final reply',async()=>{
  const final={role:'assistant',content:'FINAL_AFTER_TOOLS',stopReason:'stop',
    __openclaw:{id:'split-final'}};
  const h=loadTwoPaneHarness(async(method,params)=>{
    if(method==='sessions.list')return {sessions:[
      {key:h.leftKey,hasActiveRun:false},
      {key:h.rightKey,hasActiveRun:true},
    ]};
    assert.equal(method,'chat.history');
    assert.equal(params.sessionKey,h.leftKey);
    return {messages:[final],hasMore:false};
  },{clock:true,now:1_000,splitVisible:true});
  h.document.hidden=true; // WKWebView without keyboard focus, still shown on screen.
  h.left.state.chatRunId='stale-completed-run';
  h.right.state.chatRunId='real-running-turn';
  await h.window.__laolaoStaleBusy.reconcile();
  h.setTime(30_000);
  await h.window.__laolaoStaleBusy.reconcile();
  assert.equal(h.left.state.chatRunId,null);
  assert.equal(h.right.state.chatRunId,'real-running-turn');
  assert.equal(await h.window.__laolaoRecoverCurrentChat('split-final',{manual:true}),true);
  assert.equal(h.left.state.chatMessages[0].content,'FINAL_AFTER_TOOLS');
});

test('stale-run timer survives replacement of its pane after a tool error',async()=>{
  const h=loadTwoPaneHarness(async(method)=>{
    assert.equal(method,'sessions.list');
    return {sessions:[{key:h.leftKey,hasActiveRun:false}]};
  },{clock:true,now:1_000,splitVisible:true});
  h.document.hidden=true;
  h.left.state.chatRunId='stale-before-remount';
  await h.window.__laolaoStaleBusy.reconcile();
  const replacement={...h.left,state:{...h.left.state,chatRunId:'stale-after-remount'}};
  h.panes[0]=replacement;
  h.setTime(30_000);
  await h.window.__laolaoStaleBusy.reconcile();
  assert.equal(replacement.state.chatRunId,null);
});

test('a finished backend turn clears a stale tool spinner and shows its final via fallback RPC',async()=>{
  const final={role:'assistant',content:'FINAL_AFTER_FAILED_TOOL',stopReason:'stop',
    __openclaw:{id:'failed-tool-final'}};
  const h=loadTwoPaneHarness(async()=>{throw new Error('native RPC lost terminal event');},
    {clock:true,now:1_000,splitVisible:true});
  h.panes.pop();
  h.document.hidden=true;
  h.left.state.chatRunId='stale-tool-run';
  h.window.__laolaoSidebar={gwRequest:async(method)=>method==='sessions.list'
    ? {sessions:[{key:h.leftKey,hasActiveRun:false}]}
    : {messages:[final],hasMore:false}};
  await h.window.__laolaoStaleBusy.reconcile();
  h.setTime(30_000);
  await h.window.__laolaoStaleBusy.reconcile();
  assert.equal(h.left.state.chatRunId,null);
  assert.equal(await h.window.__laolaoRecoverCurrentChat('tool-final-fallback',{manual:true}),true);
  assert.equal(h.left.state.chatMessages[0].content,'FINAL_AFTER_FAILED_TOOL');
});

test('terminal sync restores a persisted final even while a stale stop button remains visible',async()=>{
  const user={role:'user',content:'Read files, run tests, and summarize.',timestamp:'2026-09-29T10:00:00Z',
    __openclaw:{id:'terminal-user'}};
  const final={role:'assistant',content:'UI_LIVE_B_4826 final with test results',stopReason:'stop',
    timestamp:'2026-09-29T10:05:25Z',__openclaw:{id:'terminal-final'}};
  const calls=[];
  const h=loadTwoPaneHarness(async(method,params)=>{
    calls.push(method);
    if(method==='sessions.list')return {sessions:[{key:h.leftKey,hasActiveRun:false}]};
    assert.equal(method,'chat.history');
    assert.equal(params.sessionKey,h.leftKey);
    return {messages:[user,final],hasMore:false};
  },{clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[user];
  h.left.state.chatRunId='stale-tool-run';
  h.left.state.chatSending=true;
  h.left.state.sessionsResult={sessions:[{key:h.leftKey,hasActiveRun:true}]};
  // The DOM stop button can outlive the reactive state reset by one render.
  h.left.querySelector=()=>({offsetParent:{}});
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),true,
    JSON.stringify({calls,status:h.window.__laolaoTerminalSync.status()}));
  assert.equal(h.left.state.chatMessages.at(-1).content,final.content);
  assert.equal(h.left.state.chatRunId,null);
  assert.equal(h.left.state.sessionsResult.sessions[0].hasActiveRun,false);
  assert.deepEqual(calls,['sessions.list','chat.history','sessions.list']);
});

test('terminal sync never replaces an actually running stream',async()=>{
  const h=loadTwoPaneHarness(async(method)=>{
    assert.equal(method,'sessions.list');
    return {sessions:[{key:h.leftKey,hasActiveRun:true}]};
  },{clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatRunId='live-run';
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
  assert.equal(h.left.state.chatRunId,'live-run');
  assert.deepEqual(h.left.state.chatMessages,[]);
});

test('terminal sync settles a stale stop button even when native state already has the final',async()=>{
  const final={role:'assistant',content:'persisted final',stopReason:'stop',
    __openclaw:{id:'already-local'}};
  const h=loadTwoPaneHarness(async(method)=>method==='sessions.list'
    ? {sessions:[{key:h.leftKey,hasActiveRun:false}]}
    : {messages:[final],hasMore:false},
  {clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[final];
  h.left.state.chatRunId='stale';
  h.left.querySelector=()=>({offsetParent:{}});
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),true);
  assert.equal(h.left.state.chatRunId,null);
});

test('terminal sync makes no extra gateway requests for a settled final',async()=>{
  const final={role:'assistant',content:'already complete',stopReason:'stop',
    __openclaw:{id:'settled'}};
  const h=loadTwoPaneHarness(async()=>{throw new Error('unneeded request');},
    {clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[final];
  h.left.renderRoot={textContent:'already complete'};
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
});

test('terminal sync recognizes the exact final in a painted native bubble',async()=>{
  const final={role:'assistant',content:'Result **complete** after four tools.\n\nFINAL_8931',
    stopReason:'stop',__openclaw:{id:'native-bubble'}};
  const h=loadTwoPaneHarness(async()=>{throw new Error('painted reply needs no RPC');},
    {clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[final];
  h.left.querySelectorAll=()=>[{getAttribute(name){
    return name==='data-message-text'?final.content:null;
  }}];
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
});

test('terminal sync recognizes Markdown split across DOM text nodes',async()=>{
  const final={role:'assistant',content:'**Result** complete.\n\nFINAL_8932',
    stopReason:'stop',__openclaw:{id:'split-markdown'}};
  const h=loadTwoPaneHarness(async()=>{throw new Error('painted reply needs no RPC');},
    {clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[final];
  h.left.renderRoot={textContent:'Resultcomplete.FINAL_8932'};
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
});

test('a painted previous answer cannot hide a newer server final after tools',async()=>{
  const old={role:'assistant',content:'Previous answer is still painted.',stopReason:'stop',
    timestamp:'2026-09-29T09:13:42Z',__openclaw:{id:'previous-final'}};
  const user={role:'user',content:'帮我打开文件',timestamp:'2026-09-29T09:14:37Z',
    __openclaw:{id:'open-file-user'}};
  const final={role:'assistant',content:'文件已打开，完整结果在这里。',stopReason:'stop',
    timestamp:'2026-09-29T09:15:25Z',__openclaw:{id:'open-file-final'}};
  const calls=[];
  const h=loadTwoPaneHarness(async(method)=>{
    calls.push(method);
    return method==='sessions.list'
      ? {sessions:[{key:h.leftKey,hasActiveRun:false}]}
      : {messages:[old,user,final],hasMore:false};
  },{clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[old];
  h.left.renderRoot={textContent:'Previous answer is still painted. Tool progress: 2 items'};
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),true);
  assert.equal(h.left.state.chatMessages.at(-1).content,final.content);
  assert.deepEqual(calls,['sessions.list','chat.history','sessions.list']);
});

test('terminal sync repaints a final that exists in native state but not on screen',async()=>{
  const final={role:'assistant',content:'PAINTED_FINAL_8271 full answer',stopReason:'stop',
    __openclaw:{id:'unpainted-final'}};
  const h=loadTwoPaneHarness(async(method)=>method==='sessions.list'
    ? {sessions:[{key:h.leftKey,hasActiveRun:false}]}
    : {messages:[final],hasMore:false},
  {clock:true,now:1_000});
  h.panes.pop();
  const original=[final];
  h.left.state.chatMessages=original;
  h.left.renderRoot={textContent:'Only the tool progress card is visible.'};
  h.left.state.requestUpdate=function(){this.updateCount=(this.updateCount||0)+1;};
  h.left.requestUpdate=function(){this.renderCount=(this.renderCount||0)+1;};
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),true);
  assert.notEqual(h.left.state.chatMessages,original);
  assert.equal(h.left.state.chatMessages.at(-1).content,final.content);
  assert.equal(h.left.state.updateCount,1);
  assert.equal(h.left.renderCount,1);
  h.left.renderRoot.textContent=final.content;
  h.setTime(8_000);
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
  assert.equal(h.left.state.updateCount,1);
});

test('terminal sync retries repaint until the final is actually in the DOM',async()=>{
  const final={role:'assistant',content:'persisted final after tool calls',stopReason:'stop',
    __openclaw:{id:'unpainted-retry'}};
  const h=loadTwoPaneHarness(async(method)=>method==='sessions.list'
    ? {sessions:[{key:h.leftKey,hasActiveRun:false}]}
    : {messages:[final],hasMore:false},
  {clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[final];
  h.left.renderRoot={textContent:'Tool progress: 2 items'};
  h.left.state.requestUpdate=function(){this.updateCount=(this.updateCount||0)+1;};
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),true);
  h.setTime(8_000);
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),true);
  assert.equal(h.left.state.updateCount,2);
});

test('terminal sync clears stale transient tool streams only after backend completion',async()=>{
  const final={role:'assistant',content:'Final answer after real tools',stopReason:'stop',
    __openclaw:{id:'tool-stream-final'}};
  let active=true;
  const h=loadTwoPaneHarness(async(method)=>method==='sessions.list'
    ? {sessions:[{key:h.leftKey,hasActiveRun:active}]}
    : {messages:[final],hasMore:false},
  {clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[final];
  h.left.renderRoot={textContent:'Tool progress: 2 items'};
  h.left.state.chatToolMessages=[{toolCallId:'tool-1'}];
  h.left.state.chatStreamSegments=[{text:'The tool is working'}];
  h.left.state.resetToolStream=function(){
    this.resetCount=(this.resetCount||0)+1;
    this.chatToolMessages=[];
    this.chatStreamSegments=[];
  };
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
  assert.equal(h.left.state.resetCount||0,0);
  assert.equal(h.left.state.chatToolMessages.length,1);
  active=false;
  h.setTime(8_000);
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),true);
  assert.equal(h.left.state.resetCount,1);
  assert.equal(h.left.state.chatToolMessages.length,0);
  assert.equal(h.left.state.chatStreamSegments.length,0);
  assert.equal(h.left.state.chatMessages.at(-1).content,final.content);
});

test('terminal sync does not resurrect an old final over a newer optimistic send',async()=>{
  const current={role:'user',content:'new request',timestamp:'2026-09-29T10:06:00Z',
    __openclaw:{id:'new-send'}};
  const oldFinal={role:'assistant',content:'old answer',stopReason:'stop',
    timestamp:'2026-09-29T10:05:25Z',__openclaw:{id:'old-final'}};
  const h=loadTwoPaneHarness(async(method)=>method==='sessions.list'
    ? {sessions:[{key:h.leftKey,hasActiveRun:false}]}
    : {messages:[oldFinal],hasMore:false},
  {clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatMessages=[current];
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
  assert.equal(h.left.state.chatMessages.at(-1).content,'new request');
});

test('terminal sync aborts recovery when a new backend run starts during history fetch',async()=>{
  const final={role:'assistant',content:'old final',stopReason:'stop',
    __openclaw:{id:'old-final'}};
  let checks=0;
  const h=loadTwoPaneHarness(async(method)=>{
    if(method==='sessions.list')return {sessions:[{key:h.leftKey,hasActiveRun:++checks>1}]};
    return {messages:[final],hasMore:false};
  },{clock:true,now:1_000});
  h.panes.pop();
  h.left.state.chatRunId='new-live-run';
  assert.equal(await h.window.__laolaoTerminalSync.reconcile(),false);
  assert.equal(h.left.state.chatRunId,'new-live-run');
  assert.equal(h.left.state.chatMessages.length,0);
});

test('a truly backgrounded non-split chat stays untouched',async()=>{
  const h=loadTwoPaneHarness(async()=>{throw new Error('background must not request');},
    {clock:true,now:1_000});
  h.document.hidden=true;
  h.left.state.chatRunId='possibly-running';
  h.panes.pop();
  h.setTime(30_000);
  await h.window.__laolaoStaleBusy.reconcile();
  assert.equal(h.left.state.chatRunId,'possibly-running');
  assert.equal(await h.window.__laolaoRecoverCurrentChat('background',{manual:true}),false);
});

test('an upstream failure restores the real composer without fabricating an input box',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(phrases,/pinkie:run-failed/);
  assert.match(phrases,/hasTerminalReplyAfter/);
  assert.match(phrases,/notifyUnrecoveredFailure/);
  assert.match(phrases,/pinkie:run-recovered/);
  assert.match(resume,/clearWatchdogStatus/);
  assert.match(phrases,/session file changed while embedded prompt lock was released/);
  assert.match(resume,/addEventListener\("pinkie:run-failed"/);
  assert.doesNotMatch(resume,/onRunFailure[\s\S]{0,500}clearVisualBusyState\(\)/);
  assert.match(resume,/sessions\.list/);
  assert.match(resume,/agent-chat__composer-combobox textarea/);
  assert.doesNotMatch(resume,/createElement\(["'](?:textarea|input)["']\)/);
});

test('composer recovery is frequent but request-deduplicated and voice stays separate',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/setInterval[\s\S]*1000/);
  assert.match(resume,/if \(recoveryTimer\) return/);
  assert.match(resume,/recoveryByPane\.get\(pane\)/);
  assert.match(resume,/RECOVERY_THROTTLE_MS = 1_200/);
  assert.match(resume,/if \(isBusy\(\)\) return false/);
  assert.match(resume,/sameMessageSequence/);
  assert.match(resume,/onForeground\.timer/);
  assert.match(resume,/document\.hidden/);
  assert.ok(fs.existsSync(path.join(__dirname,'../ui/injections/laolao-live-voice.js')));
});

test('a recovered gateway with a poisoned 7.1 websocket gets one guarded chat-only reload',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/fetch\("\/readyz"/);
  assert.match(resume,/gatewayWasEverConnected \? 6_000 : 12_000/);
  assert.match(resume,/RECONNECT_RELOAD_AT/);
  assert.match(resume,/now - previous < 30_000/);
  assert.match(resume,/nativeGatewayConnected/);
  assert.match(resume,/!gatewayConnected\(\) && !nativeGatewayConnected\(\)/);
  assert.match(resume,/preserveComposerDraft\(\)/);
  assert.match(resume,/restoreComposerDraft\(\)/);
  assert.match(resume,/window\.location\.reload\(\)/);
  assert.doesNotMatch(resume,/location\.(?:assign|replace)\([^)]*launcher-loading/);
});

test('native online state prevents stale injected snapshots from starting a reload storm',()=>{
  const pages=new Map([[0,{sessionId:'s',totalMessages:0,hasMore:false,messages:[]}] ]);
  const {window,shell,gateway}=loadResumeHarness(pages);
  assert.equal(window.__laolaoGatewayTestHooks.nativeGatewayConnected(),false);
  gateway.snapshot.connected=false;
  shell.gatewayConnected=true;
  assert.equal(window.__laolaoGatewayTestHooks.nativeGatewayConnected(),true);
  assert.equal(window.__laolaoGatewayTestHooks.gatewayConnected(),true);
});

test('foreground recovery never clicks stop and only a real manual stop cancels watchdog retry',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/\.chat-send-btn--stop/);
  assert.match(resume,/pinkie\.watchdog\.cancel/);
  assert.match(resume,/await refreshSession\(\)/);
  assert.doesNotMatch(resume,/stopBtn\.click\(\)/);
  assert.doesNotMatch(resume,/syntheticStop/);
});

test('watchdog disconnects stay visible until the gateway has resynced',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  const theme=read('ui/injections/laolao-theme.css');
  assert.match(resume,/data-laolao-watchdog-state/);
  assert.match(resume,/上游波动，碧琪正在自动重试/);
  assert.match(resume,/连接暂时中断，碧琪正在等待上游恢复/);
  assert.match(resume,/连接已恢复，当前回复已同步/);
  assert.match(theme,/pinkieWatchdogRibbon/);
  assert.match(theme,/data-laolao-watchdog-message/);
  assert.match(theme,/状态条保持稳定/);
  assert.match(theme,/animation: none;/);
});

test('tool details stay user-controlled so a remount cannot repeatedly expand the chat',()=>{
  const tools=read('ui/injections/laolao-tool-stream.js');
  assert.doesNotMatch(tools,/summary\.click\(\)/);
  assert.match(tools,/const lastGroup = groups\.length \? groups\[groups\.length - 1\] : null/);
  assert.match(tools,/if \(!isOpen\(lastGroup\)\) return/);
  assert.doesNotMatch(tools,/for \(const group of groups\)/);
});

test('history projection rebuilds are surfaced and retried with bounded backoff',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  const sidebar=read('ui/injections/laolao-sidebar.js');
  assert.match(resume,/session history is rebuilding/);
  assert.match(resume,/historyRebuildRetryAttempt/);
  assert.match(resume,/pinkie:session-history-rebuilding/);
  assert.match(resume,/Math\.min\(1_500/);
  assert.match(resume,/pinkie:history-rebuilding/);
  assert.match(sidebar,/pinkie:history-rebuilding/);
  assert.match(sidebar,/errorCode|errorText/);
});

test('history recovery keeps a bounded current-turn window instead of repaginating the transcript',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/LIVE_MESSAGE_WINDOW = 512/);
  assert.match(resume,/HISTORY_PAGE_SIZE = 128/);
  assert.match(resume,/keepLiveMessages/);
  assert.match(resume,/findLastIndex/);
  assert.match(resume,/fetchRecentHistory/);
  assert.match(resume,/offset/);
  assert.match(resume,/hasMore/);
  assert.match(resume,/mergeRecentHistory/);
  assert.match(resume,/chatHistoryPagination/);
  assert.match(resume,/visible-window-regressed/);
  assert.match(resume,/session-changed/);
  assert.doesNotMatch(resume,/fetchCompleteHistory/);
  assert.doesNotMatch(resume,/pages\.flat/);
  assert.doesNotMatch(resume,/state\.refreshCurrentChat\(/);
});

test('history recovery fences stale websocket results to the active session and client',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/gatewayClient\(\) !== client/);
  assert.match(resume,/paneSessionKey\(pane\) !== sessionKey/);
  assert.match(resume,/__laolaoHistoryStatus/);
  assert.match(resume,/__laolaoHistoryTestHooks/);
});

test('internal watchdog, tier controller and gateway-restart turns stay in the transcript but are hidden from the chat UI',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  assert.match(phrases,/Your previous turn was interrupted by a gateway restart/);
  assert.match(phrases,/internal=raw===watchdogSentinel \|\| raw===restartRecoveryNotice/);
  assert.match(phrases,/raw\?\.startsWith\(watchdogControlPrefix\)/);
  assert.match(phrases,/raw\?\.startsWith\(tierControlPrefix\)/);
  assert.match(phrases,/bubble\.hidden=true/);
  assert.match(phrases,/bubble\.style\.setProperty\('display','none','important'\)/);
  assert.match(phrases,/hiddenCount===bubbles\.length/);
  assert.match(phrases,/hideInternalRecoveryTurns\(current\);/);
  assert.doesNotMatch(phrases,/ACTIVE_UNRESTRICTED_RULESET_LOADED/);
});

test('recovery requests a bounded newest window and never remounts archived history',async()=>{
  const message=seq=>({role:seq%2?'user':'assistant',content:[{type:'text',text:`m${seq}`}],__openclaw:{id:`m${seq}`,seq}});
  const pages=new Map([
    [0,{sessionId:'session-1',totalMessages:10,hasMore:false,nextOffset:5,messages:[message(6),message(7),message(8),message(9),message(10)]}],
  ]);
  const {window,state,requestedOffsets}=loadResumeHarness(pages);
  assert.equal(await window.__laolaoRecoverCurrentChat('test',{force:true}),true);
  assert.deepEqual(requestedOffsets,[0]);
  assert.deepEqual(Array.from(state.chatMessages,m=>m.__openclaw.seq),[6,7,8,9,10]);
  assert.equal(state.chatHistoryPagination.hasMore,false);
  assert.equal(state.chatHistoryPagination.totalMessages,10);
  assert.equal(window.__laolaoHistoryStatus().windowed,true);
  assert.equal(window.__laolaoHistoryStatus().pageCount,1);
  assert.equal(state.scrolled,undefined);
});

test('persisted watchdog turns do not consume the live timeline window',async()=>{
  const visible=(id,role='assistant')=>({role,content:[{type:'text',text:id}],__openclaw:{id}});
  const hiddenUser=(id)=>({role:'user',content:'\u2063',__openclaw:{id}});
  const hiddenAssistant=(id)=>({role:'assistant',content:[],__openclaw:{id}});
  const pages=new Map([
    [0,{sessionId:'session-watchdog',totalMessages:15,hasMore:true,messages:[
      hiddenUser('c1'),hiddenAssistant('c2'),hiddenUser('c3'),hiddenAssistant('c4'),hiddenUser('c5'),
    ]}],
    [5,{sessionId:'session-watchdog',totalMessages:15,hasMore:false,messages:[
      visible('m1','user'),visible('m2'),visible('m3','user'),visible('m4'),visible('m5','user'),
    ]}],
  ]);
  const {window,state,requestedOffsets}=loadResumeHarness(pages);
  assert.equal(await window.__laolaoRecoverCurrentChat('watchdog-tail',{force:true}),true);
  assert.deepEqual(requestedOffsets,[0,5]);
  assert.deepEqual(Array.from(state.chatMessages,message=>message.__openclaw.id),
    ['m1','m2','m3','m4','m5']);
  assert.equal(window.__laolaoHistoryStatus().pageCount,2);
  assert.equal(window.__laolaoHistoryTestHooks.isRenderableHistoryMessage(hiddenUser('x')),false);
  assert.equal(window.__laolaoHistoryTestHooks.isRenderableHistoryMessage(hiddenAssistant('y')),false);
});

test('a persisted final remains visible after tool output and hidden watchdog turns',async()=>{
  const message=(id,role,content)=>({role,content,__openclaw:{id}});
  const pages=new Map([[0,{sessionId:'tool-final',hasMore:false,messages:[
    message('u1','user','请读取文件'),
    message('a1','assistant',[{type:'toolCall',name:'read'}]),
    message('t1','toolResult',[{type:'text',text:'读取成功'}]),
    message('a2','assistant',[{type:'text',text:'第一行已经读到。'}]),
    message('c1','user','\u2063'),
  ]}]]);
  const {window,state}=loadResumeHarness(pages);
  assert.equal(await window.__laolaoRecoverCurrentChat('tool-final',{force:true}),true);
  assert.equal(state.chatMessages.at(-1).__openclaw.id,'a2');
  assert.equal(state.chatMessages.at(-1).content[0].text,'第一行已经读到。');
});

test('live-window recovery always prefers the authoritative newest server tail',()=>{
  const pages=new Map([[0,{sessionId:'s',totalMessages:0,hasMore:false,messages:[]}]]);
  const {window}=loadResumeHarness(pages);
  const latest=Array.from({length:5},(_,i)=>({role:'assistant',content:`latest-${i + 6}`,__openclaw:{id:`latest-${i + 6}`,seq:i + 6}}));
  const oldTail=Array.from({length:6},(_,i)=>({role:'assistant',content:`old-${i}`,__openclaw:{id:`old-${i}`,seq:i}}));
  const merged=window.__laolaoHistoryTestHooks.mergeRecentHistory(
    latest,
    oldTail
  );
  assert.equal(merged.length,5);
  assert.deepEqual(Array.from(merged,message=>message.__openclaw.id),latest.map(message=>message.__openclaw.id));
  const trimmed=window.__laolaoHistoryTestHooks.keepLatestMessages([...oldTail,...latest]);
  assert.equal(trimmed.length,11);
  assert.equal(trimmed.at(-1).content,'latest-10');
});

test('history recovery is session-scoped and prunes native remounts back to the live window',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/paneSessionKey\(pane\) !== sessionKey/);
  assert.match(resume,/gatewayClient\(\) !== client/);
  assert.match(resume,/visible-window-regressed/);
  assert.match(resume,/history-not-yet-synced/);
  assert.match(resume,/!historyStatusBySession\.has\(key\)/);
  assert.match(resume,/state\.chatMessages\.length > LIVE_MESSAGE_WINDOW/);
  assert.match(resume,/state\.chatMessages = keepLiveMessages\(state\.chatMessages\)/);
  assert.match(resume,/HISTORY_MAX_CHARS = 240000/);
  assert.doesNotMatch(resume,/pagination did not advance/);
});

test('desktop installers apply the bounded native chat timeline patch',()=>{
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  for(const installer of [mac,windows]){
    assert.match(installer,/laolao-resume\.js\?v=resume41/);
    assert.match(installer,/apply-chat-timeline\.mjs/);
    assert.match(installer,/clekk-history29/);
  }
  const patch=read('patch/apply-chat-timeline.mjs');
  assert.match(patch,/LIVE_MESSAGE_WINDOW = 512/);
  assert.match(patch,/MAX_TIMELINE_ROWS = 80/);
  assert.match(patch,/pinkie-chat-timeline:v2/);
});

test('desktop installers update an existing root-relative resume URL',()=>{
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  assert.ok(mac.includes('src="(\\./|/)laolao-resume\\.js'));
  assert.ok(mac.includes('((?:\\./|/)laolao-resume\\.js)'));
  assert.ok(windows.includes("'((?:\\./|/)' + [regex]::Escape($entry.Key)"));
  assert.ok(windows.includes("('$1?v=' + $entry.Value)"));
});

test('patched hashed UI chunks replace stale service-worker cache exactly once',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  assert.match(resume,/UI_CACHE_REVISION = "history-render-29"/);
  assert.match(resume,/startsWith\("openclaw-control-"\)/);
  assert.match(resume,/UI_CACHE_REFRESH_ATTEMPTED/);
  assert.match(resume,/window\.localStorage\.setItem\(UI_CACHE_REFRESHED, "1"\)/);
  assert.match(resume,/registration\?\.update\?\.\(\)/);
  const cacheRefresh=resume.match(/const refreshStaleControlUiCache = async \(\) => \{[\s\S]*?\n  \};/)?.[0]||'';
  assert.match(cacheRefresh,/let the current view stay put/);
  assert.doesNotMatch(cacheRefresh,/window\.location\.reload\(\)/);
  for(const installer of [mac,windows]){
    assert.match(installer,/clekk-history-render-29/);
    assert.match(installer,/clekk-history29/);
    assert.match(installer,/Network-first for all UI files/);
    assert.match(installer,/catch\(\(\) => caches\.match\(event\.request\)\)/);
  }
});
