import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {apply, transform, pinkieComposerReadOnly, pinkieDurableComposerStore} from '../patch/apply-composer-drafts.mjs';

const original=fs.readFileSync(new URL('./fixtures/openclaw-native-composer.js',import.meta.url),'utf8');
function harness({durable=new Map(),inputSupport=false,reading=false,modeDock=false}={}) {
  const saved=new Map(), listeners=new Map(), timers=new Map();let seq=0;
  const storage={getItem:key=>saved.get(key) ?? null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  const events={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  const permanent={getItem:key=>durable.get(key)??null,setItem:(key,value)=>durable.set(key,value),removeItem:key=>durable.delete(key)};
  const doc={...events,documentElement:{getAttribute:key=>key==='data-laolao-workspace-dock'&&modeDock?'1':null},...((inputSupport||reading||modeDock)?{querySelectorAll:()=>reading?[{state:{}},{state}]:[{state}]}: {})};
  const context=vm.createContext({...events,document:doc,localStorage:permanent,j:()=>storage,F:key=>({agentId:key.split(':')[1]}),L:id=>id.trim(),
    setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(transform(original)+';globalThis.native={save:Xu,load:Yu,restore:$u,Controller:ed};',context);
  const state={sessionKey:'agent:learning:dashboard:one',chatMessage:'',chatQueue:[],settings:{gatewayUrl:'ws://gateway-one'}};
  const controller=new context.native.Controller({addController(){}},()=>state);controller.start();
  return {saved,durable,listeners,timers,state,controller,native:context.native};
}

test('typing persists immediately even when the native queue does not change',()=>{
  const h=harness();h.state.chatMessage='这个问题还没写完\n第二行';h.controller.schedule();h.controller.persistChangedState();
  assert.equal(h.timers.size,0);
  assert.equal(h.native.load(h.state,h.state.sessionKey).draft,h.state.chatMessage);
});

test('mode and session drafts restore independently without crossing gateways',()=>{
  const h=harness(), drafts=[['agent:learning:dashboard:one','翻译写到一半'],['agent:learning:dashboard:two','第二题'],['agent:project:dashboard:one','项目安排'],['agent:main:dashboard:one','聊天草稿']];
  for(const [key,text] of drafts){h.state.sessionKey=key;h.state.chatMessage=text;h.controller.persistChangedState();}
  for(const [key,text] of drafts){h.state.sessionKey=key;h.state.chatMessage='';h.state.chatQueue=[];assert.equal(h.controller.restore(),true);assert.equal(h.state.chatMessage,text);}
  h.state.settings.gatewayUrl='ws://gateway-two';assert.equal(h.native.load(h.state,drafts[0][0]),null);
});

test('more than twenty unfinished drafts survive while queue-only history remains bounded',()=>{
  const h=harness();
  for(let i=0;i<35;i++){h.state.sessionKey=`agent:learning:dashboard:draft-${i}`;h.state.chatMessage=`未完成的第 ${i} 题`;h.state.chatQueue=[];h.native.save(h.state);}
  for(let i=0;i<30;i++){h.state.sessionKey=`agent:project:dashboard:queue-${i}`;h.state.chatMessage='';h.state.chatQueue=[{id:`q-${i}`,text:'稍后发送',createdAt:i}];h.native.save(h.state);}
  for(let i=0;i<35;i++)assert.equal(h.native.load(h.state,`agent:learning:dashboard:draft-${i}`).draft,`未完成的第 ${i} 题`);
  const entries=Object.values(JSON.parse([...h.saved.values()][0]).sessions);
  assert.equal(entries.filter(entry=>entry.draft).length,35);assert.equal(entries.filter(entry=>!entry.draft).length,20);
});

test('successful send or manual clearing cannot resurrect old text after reload',()=>{
  const h=harness();h.state.chatMessage='发送前的草稿';h.controller.persistChangedState();
  h.state.chatMessage='';h.controller.persistChangedState();
  assert.equal(h.native.load(h.state,h.state.sessionKey),null);assert.equal(h.saved.size,0);
  h.state.chatMessage='发送失败恢复的内容';h.controller.persistChangedState();
  assert.equal(h.native.load(h.state,h.state.sessionKey).draft,'发送失败恢复的内容');
});

test('page lifecycle flushes pending edits and disconnect removes its listeners',()=>{
  const h=harness();const flush=h.listeners.get('visibilitychange');
  assert.equal(typeof flush,'function');
  for(const event of ['pagehide','beforeunload','visibilitychange']){h.state.chatMessage=event+' 草稿';h.controller.schedule();flush();assert.equal(h.native.load(h.state,h.state.sessionKey).draft,h.state.chatMessage);}
  h.state.chatMessage='最后一次输入';h.controller.schedule();h.controller.hostDisconnected();
  assert.equal(h.native.load(h.state,h.state.sessionKey).draft,'最后一次输入');assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});

test('bad storage is recovered and hydration preserves text already in the composer',()=>{
  const h=harness();h.saved.set('openclaw.control.chatComposer.v1:ws%3A%2F%2Fgateway-one','bad json');
  assert.equal(h.native.load(h.state,h.state.sessionKey),null);
  h.state.chatMessage='已保存';h.native.save(h.state);h.state.chatMessage='正在编辑';
  h.native.restore(h.state,{preserveCurrent:true});assert.equal(h.state.chatMessage,'正在编辑');
  h.state.chatMessage='';h.native.restore(h.state,{preserveCurrent:true});assert.equal(h.state.chatMessage,'已保存');
});

test('runtime patch is atomic on unknown structures, backed up, cache refreshed and idempotent',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-draft-test-'));
  try{
    const ui=path.join(root,'dist/control-ui'),assets=path.join(ui,'assets'),backupRoot=path.join(root,'backup');fs.mkdirSync(assets,{recursive:true});
    const moduleFile=path.join(assets,'chat-page-test.js'),importFile=path.join(assets,'index-test.js'),indexFile=path.join(ui,'index.html');
    const importer='import("./chat-page-test.js?v=existing-patch");';const index='<script type="module" src="/assets/index-test.js?v=existing-root"></script>';
    const broken=original.replace('persistChangedState()', 'futureChangedState()');
    fs.writeFileSync(moduleFile,broken);fs.writeFileSync(importFile,importer);fs.writeFileSync(indexFile,index);
    assert.throws(()=>apply(root,{backupRoot}),/结构已变化/);assert.equal(fs.readFileSync(importFile,'utf8'),importer);assert.equal(fs.readFileSync(indexFile,'utf8'),index);
    fs.writeFileSync(moduleFile,original);assert.equal(apply(root,{backupRoot}).changed,true);
    assert.equal(fs.readFileSync(path.join(backupRoot,'chat-page-test.js'),'utf8'),original);
    assert.match(fs.readFileSync(importFile,'utf8'),/chat-page-test\.js\?v=existing-patch&pinkie-drafts=4/);assert.match(fs.readFileSync(indexFile,'utf8'),/index-test\.js\?v=existing-root&pinkie-drafts=4/);
    assert.equal(apply(root,{backupRoot}).changed,false);assert.equal(transform(transform(original)),transform(original));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

// OpenClaw 2026.10 rewrote the store around `pending`, a durable IndexedDB
// mirror and revision fences. Only the page-lifecycle flush and the
// change-detection guard may change; the native pending snapshot must survive.
const current=fs.readFileSync(new URL('./fixtures/openclaw-native-composer-2026.10.js',import.meta.url),'utf8').split('\n').slice(1).join('\n');

test('2026.10 store persists every change and flushes on page hide',()=>{
  const output=transform(current);
  const start=/start\(\)\{let e=this\.getState\(\);if\(!e\)return;this\.ready=!0,this\.pending=null;([\s\S]*?)let\{revisions/u.exec(output);
  assert.ok(start,'native start() shape is kept');
  assert.match(start[1],/\.addEventListener\?\.\("visibilitychange",this\.pinkieDraftFlush,\{capture:!0\}\);$/u,
    'start() arms the flush before the native setup continues');
  const stop=/\.persistNow\(\),this\.ready=!1,this\.pending=null,this\.clearTimer\(\)([\s\S]*?)\}restore\(/u.exec(output);
  assert.ok(stop,'native stop() shape is kept');
  assert.match(stop[1],/removeEventListener\?\.\("visibilitychange",this\.pinkieDraftFlush,\{capture:!0\}\);/u);
  assert.match(output,/persistChangedState\(\)\{this\.persistNow\(\);this\.synchronizeDurablePersistence\?\.\(\);this\.persistNow\(\)\}/u);
  assert.match(output,/this\.persistSnapshot\(e,t\)\}persistChangedState/u,'native pending publish is untouched');
  assert.match(output,/synchronizeDurablePersistence\(\)\}/u,'native durable mirror call in start() is untouched');
  assert.equal(transform(output),output,'idempotent');
});

test('2026.10 store runs without a browser: pending snapshots and flush listener behave',()=>{
  const listeners=new Map(),published=[],timers=new Map();let seq=0;
  const context=vm.createContext({
    document:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}},
    setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  });
  vm.runInContext(`var dp=(e,t)=>({revisions:{committed:1,latestAttempt:1},snapshot:{draft:''}}),Op=200,E=(e,t)=>t,Kf=()=>!1,rp=e=>e,Hf=e=>e??'',Ki=e=>e+1,mp=()=>{},Gf=()=>!0;var Ap=class{${transform(current)}};globalThis.Store=Ap;`,context);
  // Only the persistence edges are stubbed; the store body under test is the
  // one this patch produces from the pinned 2026.10 excerpt.
  const state={sessionKey:'agent:main:one',chatMessage:'',chatGoalDraftMode:null,chatReplyTarget:null,chatAttachments:[],chatMentions:[]};
  const store=new context.Store({addController(){}},()=>state);
  store.readDraftRevisions=()=>({committed:1,latestAttempt:1});
  store.snapshot=(e)=>({chatMessage:e.chatMessage});
  store.synchronizeDurablePersistence=()=>{};
  store.matchesCurrentContent=(pending,e)=>pending.chatMessage===e.chatMessage;
  store.resolveDurableScope=()=>null;
  store.isUnchanged=(e)=>store.pending===null&&(store.lastPersisted?.chatMessage??null)===e.chatMessage;
  store.clearTimer=()=>{if(store.timer!=null){clearTimeout(store.timer);store.timer=null;}};
  store.persistSnapshot=(e,t)=>{published.push(t.chatMessage);store.pending=null;store.lastPersisted=t;return {status:'persisted'};};
  store.start();
  assert.equal(listeners.size,1,'starting the store flushes pending edits on page hide');
  state.chatMessage='第一行';store.start();
  assert.equal(listeners.size,1,'restarting keeps exactly one flush listener');
  state.chatMessage='第二行';store.persistChangedState();
  assert.deepEqual(published,['第二行'],'a change is published immediately, without waiting for the debounce');
  state.chatMessage='第三行';store.schedule();assert.equal(timers.size,1,'typing still debounces');
  listeners.get('visibilitychange')();
  assert.deepEqual(published,['第二行','第三行'],'page hide publishes the pending edit synchronously');
  assert.equal(store.pending,null,'the stop() that follows page hide finds nothing pending to drop');
  store.stop();
  assert.equal(listeners.size,0,'disconnect removes the flush listener');
});

test('draft text survives a fresh WebView session while queued messages do not become durable sends',()=>{
 const first=harness();first.state.chatMessage='没有写完的中文\n第二段';first.state.chatQueue=[{id:'pending-1',text:'本次会话队列',createdAt:1}];first.controller.persistChangedState();
 const restarted=harness({durable:first.durable});assert.equal(restarted.saved.size,0);assert.equal(restarted.controller.restore(),true);assert.equal(restarted.state.chatMessage,first.state.chatMessage);assert.equal(restarted.state.chatQueue.length,0);
 restarted.state.chatMessage='';restarted.controller.persistChangedState();const again=harness({durable:first.durable});assert.equal(again.controller.restore(),false,'a sent or manually cleared draft stays cleared after restart');
});

test('an actual split reading pane cannot erase the primary composer backup',()=>{
 const main=harness();main.state.chatMessage='主页面正在写的答案';main.controller.persistChangedState();
 const reading=harness({durable:main.durable,reading:true});assert.equal(reading.controller.restore(),true);reading.state.chatMessage='';reading.controller.persistChangedState();
 const restarted=harness({durable:main.durable});restarted.controller.restore();assert.equal(restarted.state.chatMessage,'主页面正在写的答案');
});

test('dual-open mode companions persist and clear their own drafts across restarts',()=>{
 const left=harness(),right=harness({durable:left.durable,modeDock:true});
 left.state.chatMessage='左侧未完成';left.controller.persistChangedState();
 right.state.sessionKey='agent:unrestricted:dashboard:two';right.state.chatMessage='右侧未完成\n第二行';right.controller.persistChangedState();
 const restartLeft=harness({durable:left.durable}),restartRight=harness({durable:left.durable,modeDock:true});
 restartRight.state.sessionKey=right.state.sessionKey;
 assert.equal(restartLeft.controller.restore(),true);assert.equal(restartRight.controller.restore(),true);
 assert.equal(restartLeft.state.chatMessage,'左侧未完成');assert.equal(restartRight.state.chatMessage,'右侧未完成\n第二行');
 restartRight.state.chatMessage='';restartRight.controller.persistChangedState();
 const again=harness({durable:left.durable,modeDock:true});again.state.sessionKey=right.state.sessionKey;
 assert.equal(again.controller.restore(),false);assert.equal(restartLeft.native.load(restartLeft.state,restartLeft.state.sessionKey).draft,'左侧未完成');
});

test('v3 upgrades only the draft read-only helper and keeps unrelated renderer bytes',()=>{
 const current=transform(original),helper=pinkieComposerReadOnly.toString();
 const oldHelper=helper.replace('  const doc = globalThis.document;','  const doc = globalThis.document;\n  if (doc?.documentElement?.getAttribute?.(\'data-laolao-workspace-dock\') === \'1\') return true;');
 const legacy=current.replace('/* pinkie-composer-drafts:v4 */','/* pinkie-composer-drafts:v3 */').replace(helper,oldHelper);
 assert.notEqual(legacy,current);assert.equal(transform(legacy+'\n/* unrelated renderer unchanged */'),current+'\n/* unrelated renderer unchanged */');
 assert.equal(transform(transform(legacy)),transform(legacy));
});

test('input capture saves Chinese composition before native debounce or a forced close',()=>{
 const first=harness({inputSupport:true});const pane={state:first.state};const textarea={value:'输入法还没结束的中文',closest:selector=>selector==='openclaw-chat-pane'?pane:textarea};
 first.listeners.get('input')({target:textarea});assert.equal(first.state.chatMessage,'','input capture must not interrupt native IME state');
 const restarted=harness({durable:first.durable});assert.equal(restarted.controller.restore(),true);assert.equal(restarted.state.chatMessage,textarea.value);
});

test('an internal secondary pane cannot write or remove the primary transient or durable draft',()=>{
 const local=new Map(),session=new Map();const storage=m=>({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});const state={sessionKey:'a'},reader={sessionKey:'a'};const document={documentElement:{getAttribute:()=>null},querySelectorAll:()=>[{state},{state:reader}]};
 const context=vm.createContext({document,localStorage:storage(local)});vm.runInContext(pinkieComposerReadOnly.toString()+';'+pinkieDurableComposerStore.toString()+';globalThis.store=pinkieDurableComposerStore',context);
 const main=context.store(storage(session),'a',state);main.setItem('gateway',JSON.stringify({version:1,sessions:{a:{draft:'保留主输入',updatedAt:1}}}));const before=[...session];const secondary=context.store(storage(session),'a',reader);secondary.removeItem('gateway');secondary.setItem('gateway',JSON.stringify({version:1,sessions:{}}));assert.deepEqual([...session],before);assert.equal(local.size,1);
});
