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
      assert.equal(params.limit,5);
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
  let nowAt=options.now ?? Date.now();
  const TestDate=options.clock ? class extends Date {static now(){return nowAt;}} : Date;
  const leftKey='agent:project:dashboard:left';
  const rightKey='agent:learning:dashboard:right';
  const makePane=(key,active)=>({
    active,sessionKey:key,
    state:{sessionKey:key,chatMessages:[],chatHistoryPagination:{},requestUpdate(){}},
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
    documentElement:{setAttribute(){},removeAttribute(){},getAttribute(){return options.watchdogState ?? null;}},
    querySelector(selector){
      if(selector==='openclaw-chat-pane')return panes[0];
      if(selector==='openclaw-chat-page')return page;
      if(selector==='openclaw-app-shell')return shell;
      if(selector==='.agent-chat__composer-combobox textarea')return {};
      return null;
    },
    querySelectorAll(selector){return selector==='openclaw-chat-pane'?panes:[];},
    addEventListener(){},dispatchEvent(){},
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
  return {window,location,page,left,right,leftKey,rightKey,panes,setTime(value){nowAt=value;}};
}

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
    /const waitingForGateway = !gatewayConnected\(\)/);
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

test('history recovery keeps a five-message live window instead of repaginating the transcript',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/LIVE_MESSAGE_WINDOW = 5/);
  assert.match(resume,/HISTORY_PAGE_SIZE = LIVE_MESSAGE_WINDOW/);
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

test('recovery requests only the newest five messages and never remounts archived history',async()=>{
  const message=seq=>({role:seq%2?'user':'assistant',content:[{type:'text',text:`m${seq}`}],__openclaw:{id:`m${seq}`,seq}});
  const pages=new Map([
    [0,{sessionId:'session-1',totalMessages:10,hasMore:true,nextOffset:5,messages:[message(6),message(7),message(8),message(9),message(10)]}],
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

test('persisted watchdog turns do not consume the five visible message slots',async()=>{
  const visible=(id,role='assistant')=>({role,content:[{type:'text',text:id}],__openclaw:{id}});
  const hiddenUser=(id)=>({role:'user',content:'\u2063',__openclaw:{id}});
  const hiddenAssistant=(id)=>({role:'assistant',content:[],__openclaw:{id}});
  const pages=new Map([
    [0,{sessionId:'session-watchdog',totalMessages:15,hasMore:true,messages:[
      hiddenUser('c1'),hiddenAssistant('c2'),hiddenUser('c3'),hiddenAssistant('c4'),hiddenUser('c5'),
    ]}],
    [5,{sessionId:'session-watchdog',totalMessages:15,hasMore:true,messages:[
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
  assert.equal(trimmed.length,5);
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
  assert.match(resume,/state\.chatMessages = uniqueMessages\(state\.chatMessages\)[\s\S]*?\.filter\(isRenderableHistoryMessage\)\.slice\(-LIVE_MESSAGE_WINDOW\)/);
  assert.match(resume,/HISTORY_MAX_CHARS = 240000/);
  assert.doesNotMatch(resume,/pagination did not advance/);
});

test('desktop installers enforce a five-message native render window',()=>{
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  for(const installer of [mac,windows]){
    assert.match(installer,/laolao-resume\.js\?v=resume22/);
    assert.match(installer,/Showing last \$\{c\} messages/);
    assert.match(installer,/function Zb\(e\)\{return 5\}/);
    assert.match(installer,/t\.length<5/);
    assert.match(installer,/i\+c>24e4/);
  }
});

test('patched hashed UI chunks replace stale service-worker cache exactly once',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  assert.match(resume,/UI_CACHE_REVISION = "history-render-18"/);
  assert.match(resume,/startsWith\("openclaw-control-"\)/);
  assert.match(resume,/UI_CACHE_REFRESH_ATTEMPTED/);
  assert.match(resume,/window\.localStorage\.setItem\(UI_CACHE_REFRESHED, "1"\)/);
  assert.match(resume,/registration\?\.update\?\.\(\)/);
  const cacheRefresh=resume.match(/const refreshStaleControlUiCache = async \(\) => \{[\s\S]*?\n  \};/)?.[0]||'';
  assert.match(cacheRefresh,/let the current view stay put/);
  assert.doesNotMatch(cacheRefresh,/window\.location\.reload\(\)/);
  for(const installer of [mac,windows]){
    assert.match(installer,/clekk-history-render-18/);
    assert.match(installer,/clekk-history18/);
    assert.match(installer,/Network-first for all UI files/);
    assert.match(installer,/catch\(\(\) => caches\.match\(event\.request\)\)/);
  }
});
