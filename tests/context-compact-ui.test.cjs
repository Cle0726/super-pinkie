const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('manual context control uses native compaction without posting a chat command',()=>{
  const source=read('ui/injections/laolao-context-compact.js');
  assert.match(source,/rpc\("sessions\.compact", \{key, agentId\}, 600_000\)/);
  assert.match(source,/手动整理上下文/);
  assert.match(source,/最近对话和工作检查点继续保留/);
  assert.match(source,/chat-send-btn--stop/);
  assert.doesNotMatch(source,/chat\.send|\/compact/);
});

test('manual context control ships in both UI installers',()=>{
  const head = require('./fixtures/shared-ui.cjs').sharedUi({'entries': ['laolao-context-compact.js'], 'assets': []});

});

test('context capacity uses real session usage, never a guessed percentage',()=>{
  const source=read('ui/injections/laolao-context-compact.js');
  assert.match(source,/rpc\("sessions\.list", \{agentId, limit: 1000\}/);
  const window={addEventListener(){}};
  const document={
    addEventListener(){}, getElementById(){return null;},
    querySelector(){return null;}, querySelectorAll(){return [];},
    createElement(){return {id:'',style:{},textContent:''};},
    head:{append(){}},
  };
  vm.runInNewContext(source,{window,document,location:{search:''},URLSearchParams,setInterval(){}});
  const calculate=window.__laolaoContextCompact.contextCapacity;
  assert.equal(calculate({totalTokens:198045,contextTokens:1000000},{}).percent,20);
  assert.equal(calculate({totalTokens:0},{contextTokens:1000000}).percent,0);
  assert.equal(calculate({contextTokens:1000000},{contextTokens:1000000}),null);
  assert.equal(calculate({totalTokens:null,contextTokens:1000000},{}),null);
});

test('stream cursor does not create its own animation-frame mutation loop',()=>{
  const script=read('ui/injections/laolao-stream-fx.js');
  const css=read('ui/injections/laolao-theme.css');
  assert.match(script,/bubble\.lastChild !== existing/);
  assert.doesNotMatch(css,/@keyframes pinkieStreamIn/);
  assert.match(css,/data-pinkie-streaming="true"[\s\S]*animation: none !important/);
});

// 11-11 用户：模型干活的过程中上下文占用不动，要等整轮结束才刷新。
// 每次模型调用结束时 session.message 带着那次调用的 usage，用它实时更新。
test('context meter follows each model call while a run is still going',()=>{
  const source=read('ui/injections/laolao-context-compact.js');
  const listeners={};
  const window={addEventListener(name,fn){(listeners[name]??=[]).push(fn);},dispatchEvent(){}};
  const document={
    addEventListener(){}, getElementById(){return null;},
    querySelector(){return null;}, querySelectorAll(){return [];},
    createElement(){return {id:'',style:{},textContent:''};},
    head:{append(){}},
  };
  const location={search:'?session=agent%3Aproject%3Alive',hash:'',pathname:'/chat'};
  vm.runInNewContext(source,{window,document,location,URLSearchParams,setInterval(){},setTimeout(){},clearTimeout(){},localStorage:{getItem(){return null;},setItem(){},removeItem(){}}});
  const api=window.__laolaoContextCompact;
  const key='agent:project:live';
  api.seedUsage(key,{totalTokens:20000,contextTokens:200000,hasActiveRun:true},{});
  assert.equal(api.currentUsage().used,20000);
  const send=(payload)=>listeners['pinkie:gateway-event'].forEach(fn=>fn({detail:{event:'session.message',payload}}));
  // A user message carries no usage and changes nothing.
  send({sessionKey:key,message:{role:'user',content:'hi'}});
  assert.equal(api.currentUsage().used,20000);
  // Each finished model call: prompt = input + cacheRead + cacheWrite (OpenClaw's own rule).
  send({sessionKey:key,message:{role:'assistant',usage:{input:1000,cacheRead:60000,cacheWrite:2000,output:500}}});
  assert.equal(api.currentUsage().used,63000);
  assert.equal(api.currentUsage().percent,32);
  // Another session's events never move this meter.
  send({sessionKey:'agent:project:other',message:{role:'assistant',usage:{input:190000}}});
  assert.equal(api.currentUsage().used,63000);
  // A stale persisted total read mid-run does not pull the meter back.
  api.seedUsage(key,{totalTokens:20000,contextTokens:200000,hasActiveRun:true},{});
  assert.equal(api.currentUsage().used,63000);
  // Once the run is over the persisted total is the truth again.
  api.seedUsage(key,{totalTokens:64000,contextTokens:200000,hasActiveRun:false},{});
  assert.equal(api.currentUsage().used,64000);
});
