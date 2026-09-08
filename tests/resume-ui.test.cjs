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
      assert.equal(params.limit,250);
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
  return {window,state,requestedOffsets,client,pane};
}

test('an upstream failure restores the real composer without fabricating an input box',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(phrases,/pinkie:run-failed/);
  assert.match(phrases,/session file changed while embedded prompt lock was released/);
  assert.match(resume,/addEventListener\("pinkie:run-failed"/);
  assert.match(resume,/clearVisualBusyState\(\)/);
  assert.match(resume,/sessions\.list/);
  assert.match(resume,/agent-chat__composer-combobox textarea/);
  assert.doesNotMatch(resume,/createElement\(["'](?:textarea|input)["']\)/);
});

test('composer recovery is frequent but request-deduplicated and voice stays separate',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/setInterval[\s\S]*1000/);
  assert.match(resume,/if \(recoveryTimer\) return/);
  assert.match(resume,/if \(recoveryInFlight\) return recoveryInFlight/);
  assert.match(resume,/document\.hidden/);
  assert.ok(fs.existsSync(path.join(__dirname,'../ui/injections/laolao-live-voice.js')));
});

test('a recovered gateway with a poisoned 7.1 websocket gets one guarded chat-only reload',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/fetch\("\/readyz"/);
  assert.match(resume,/gatewayWasEverConnected \? 1_500 : 8_000/);
  assert.match(resume,/RECONNECT_RELOAD_AT/);
  assert.match(resume,/now - previous < 8_000/);
  assert.match(resume,/preserveComposerDraft\(\)/);
  assert.match(resume,/restoreComposerDraft\(\)/);
  assert.match(resume,/window\.location\.reload\(\)/);
  assert.doesNotMatch(resume,/location\.(?:assign|replace)\([^)]*launcher-loading/);
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

test('history recovery paginates the legacy 100-message window and merges without duplicates',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/HISTORY_PAGE_SIZE = 250/);
  assert.match(resume,/offset/);
  assert.match(resume,/hasMore/);
  assert.match(resume,/nextOffset/);
  assert.match(resume,/chat\.history pagination did not advance/);
  assert.match(resume,/mergeCompleteHistory/);
  assert.match(resume,/chatHistoryPagination/);
  assert.match(resume,/history-count-regressed/);
  assert.match(resume,/session-changed/);
});

test('history recovery fences stale websocket results to the active session and client',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/gatewayClient\(\) !== client/);
  assert.match(resume,/currentSessionKey\(\) !== sessionKey/);
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
  assert.match(phrases,/hideInternalRecoveryTurns\(\);/);
  assert.doesNotMatch(phrases,/ACTIVE_UNRESTRICTED_RULESET_LOADED/);
});

test('old 7.1 chat UI walks every history page and restores chronological messages',async()=>{
  const message=seq=>({role:seq%2?'user':'assistant',content:[{type:'text',text:`m${seq}`}],__openclaw:{id:`m${seq}`,seq}});
  const pages=new Map([
    [0,{sessionId:'session-1',totalMessages:6,hasMore:true,nextOffset:2,messages:[message(5),message(6)]}],
    [2,{sessionId:'session-1',totalMessages:6,hasMore:true,nextOffset:4,messages:[message(3),message(4)]}],
    [4,{sessionId:'session-1',totalMessages:6,hasMore:false,messages:[message(1),message(2)]}],
  ]);
  const {window,state,requestedOffsets}=loadResumeHarness(pages);
  assert.equal(await window.__laolaoRecoverCurrentChat('test',{force:true}),true);
  assert.deepEqual(requestedOffsets,[0,2,4]);
  assert.deepEqual(Array.from(state.chatMessages,m=>m.__openclaw.seq),[1,2,3,4,5,6]);
  assert.equal(state.chatHistoryPagination.hasMore,false);
  assert.equal(state.chatHistoryPagination.totalMessages,6);
  assert.equal(window.__laolaoHistoryStatus().complete,true);
  assert.equal(window.__laolaoHistoryStatus().pageCount,3);
});

test('full-history merge deduplicates persisted messages and keeps unsaved local tail',()=>{
  const pages=new Map([[0,{sessionId:'s',totalMessages:0,hasMore:false,messages:[]}]]);
  const {window}=loadResumeHarness(pages);
  const persisted={role:'assistant',content:'done',__openclaw:{id:'persisted',seq:1}};
  const optimistic={role:'user',content:'not persisted yet',timestamp:99};
  const merged=window.__laolaoHistoryTestHooks.mergeCompleteHistory(
    [persisted],
    [persisted,optimistic]
  );
  assert.equal(merged.length,2);
  assert.equal(merged[0].__openclaw.id,'persisted');
  assert.equal(merged[1].content,'not persisted yet');
});

test('history recovery is session-scoped and guards against native 100-message regression',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/currentSessionKey\(\) !== sessionKey/);
  assert.match(resume,/gatewayClient\(\) !== client/);
  assert.match(resume,/history-count-regressed/);
  assert.match(resume,/history-not-yet-synced/);
  assert.match(resume,/!historyStatusBySession\.has\(sessionKey\)/);
  assert.match(resume,/page\?\.hasMore !== true/);
  assert.match(resume,/pagination did not advance/);
  assert.match(resume,/HISTORY_PAGE_SIZE = 250/);
  assert.doesNotMatch(resume,/HISTORY_MAX_(?:PAGES|MESSAGES)/);
});
