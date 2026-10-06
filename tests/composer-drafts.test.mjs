import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {apply, transform} from '../patch/apply-composer-drafts.mjs';

const original=fs.readFileSync(new URL('./fixtures/openclaw-native-composer.js',import.meta.url),'utf8');
function harness() {
  const saved=new Map(), listeners=new Map(), timers=new Map();let seq=0;
  const storage={getItem:key=>saved.get(key) ?? null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  const events={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  const context=vm.createContext({...events,document:events,j:()=>storage,F:key=>({agentId:key.split(':')[1]}),L:id=>id.trim(),
    setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(transform(original)+';globalThis.native={save:Xu,load:Yu,restore:$u,Controller:ed};',context);
  const state={sessionKey:'agent:learning:dashboard:one',chatMessage:'',chatQueue:[],settings:{gatewayUrl:'ws://gateway-one'}};
  const controller=new context.native.Controller({addController(){}},()=>state);controller.start();
  return {saved,listeners,timers,state,controller,native:context.native};
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
  const h=harness();
  for(const event of ['pagehide','beforeunload','visibilitychange']){h.state.chatMessage=event+' 草稿';h.controller.schedule();h.listeners.get(event)();assert.equal(h.native.load(h.state,h.state.sessionKey).draft,h.state.chatMessage);}
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
    fs.writeFileSync(moduleFile,original.replace('persistChangedState()', 'futureChangedState()'));fs.writeFileSync(importFile,importer);fs.writeFileSync(indexFile,index);
    assert.throws(()=>apply(root,{backupRoot}),/结构已变化/);assert.equal(fs.readFileSync(importFile,'utf8'),importer);assert.equal(fs.readFileSync(indexFile,'utf8'),index);
    fs.writeFileSync(moduleFile,original);assert.equal(apply(root,{backupRoot}).changed,true);
    assert.equal(fs.readFileSync(path.join(backupRoot,'chat-page-test.js'),'utf8'),original);
    assert.match(fs.readFileSync(importFile,'utf8'),/chat-page-test\.js\?v=existing-patch&pinkie-drafts=1/);assert.match(fs.readFileSync(indexFile,'utf8'),/index-test\.js\?v=existing-root&pinkie-drafts=1/);
    assert.equal(apply(root,{backupRoot}).changed,false);assert.equal(transform(transform(original)),transform(original));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
