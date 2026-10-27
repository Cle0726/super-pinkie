import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Run this against staged/installed files too: a source-only test missed the
// shipped gateway still requiring tier while the UI had switched to level.
const repo = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.env.PINKIE_TEST_REASONING || path.join(repo, 'services/mode-architecture/reasoning.mjs');
const sidebarPath = process.env.PINKIE_TEST_SIDEBAR || path.join(repo, 'ui/injections/laolao-sidebar.js');
const {ReasoningEnhancer, ReviewStore, registerReasoningGateway, LEVELS} = await import(pathToFileURL(modulePath));
const source = fs.readFileSync(sidebarPath, 'utf8');
const prefix = source.slice(0, source.indexOf('  /* ---------- 1. 状态与模式隔离'))
  .replace('const sendQueues = new Map();', 'const sendQueues = new Map(); window.testContract={sendQueues};') + '})();';
const models = [
  {id: 'gemini', reasoning: true, compat: {supportedReasoningEfforts: ['minimal','low','medium','high','xhigh']}},
  {id: 'glm', reasoning: true, compat: {supportedReasoningEfforts: ['high']}},
  {id: 'plain', reasoning: false},
  {id: 'sol', reasoning: true, compat: {supportedReasoningEfforts: ['low','medium','high','xhigh','max']}},
];
const ranks = ['off','minimal','low','medium','high','xhigh','adaptive','max','ultra'];
function nearest(level, native) {
  if (level === 'adaptive') return native.includes('medium') ? 'medium' : native.find(value=>value!=='off') || native[0];
  return [...native].sort((a,b)=>Math.abs(ranks.indexOf(a)-ranks.indexOf(level))-Math.abs(ranks.indexOf(b)-ranks.indexOf(level)) || ranks.indexOf(a)-ranks.indexOf(b))[0];
}

async function exercise({model, level, agent, hard = false, realRun = null}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-contract-'));
  const key = `agent:${agent}:contract-${randomUUID()}`;
  const storage = new Map(), methods = new Map(), timers = new Set(), calls = [], modelCalls = [], failures = [], runs = [];
  const native = model.reasoning ? model.compat.supportedReasoningEfforts : ['off'];
  let backend = nearest(level, native);
  const entry = {providerOverride: 'qa', modelOverride: model.id, thinkingLevel: backend};
  const message = hard ? '请计算17+25，只回答结果。' : '17+25，只回答结果。';
  const choiceKey = `pinkie:effort-choice:v1:${key}`;
  storage.set(choiceKey, JSON.stringify({tier: level, model: `qa/${model.id}`, backend}));
  if (level === 'max' || level === 'ultra') storage.set(`laolao:reasoning-enhance:v1:${key}`, level);
  const api = {
    config: {agents: {entries: {[agent]: {model: `qa/${model.id}`, workspace: root}}}, models: {providers: {qa: {models: [model]}}}},
    runtime: {agent: {
      session: {getSessionEntry: () => entry},
      runEmbeddedAgent: async params => {
        modelCalls.push(params);
        return realRun ? realRun(params) : {payloads: [{text: /独立解题助手/.test(params.prompt) ? '42' : '{"pass":true,"issues":[]}'}]};
      },
    }},
    on() {}, registerGatewayMethod: (name, fn) => methods.set(name, fn),
  };
  const store = new ReviewStore(root);
  const gateway = registerReasoningGateway(api, new ReasoningEnhancer(api, {store}));
  const runtime = new ReasoningEnhancer(api, {store});
  for (const field of ['completed','independent','controllers']) runtime[field] = gateway[field];
  let injected = '', reply = '42';
  class NativeSocket {
    constructor() { this.readyState = 1; this.listeners = new Map(); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    dispatchEvent(event) {
      if (event.type === 'message') { const value = JSON.parse(event.data); if (value.ok === false) failures.push(value.error); }
      this.listeners.get(event.type)?.(event);
    }
    respond(id, ok, payload, error) { queueMicrotask(()=>this.dispatchEvent({type:'message', data:JSON.stringify({type:'res',id,ok,payload,error})})); }
    send(data) {
      const request = JSON.parse(data); calls.push(request);
      if (methods.has(request.method)) {
        void methods.get(request.method)({params: request.params, respond: (ok,payload,error)=>this.respond(request.id,ok,payload,error)});
      } else if (request.method === 'sessions.patch') {
        backend = request.params.thinkingLevel; entry.thinkingLevel = backend; this.respond(request.id,true,{});
      } else if (request.method === 'chat.send') {
        runs.push((async()=>{
          injected = runtime.beforePromptBuild({prompt:message,messages:[]}, {sessionKey:key})?.appendContext || '';
          if (realRun) {
            const result = await realRun({prompt:message, appendContext:injected, thinkLevel:backend, provider:'qa',model:model.id,main:true});
            reply = result.payloads.map(p=>p.text || '').join('');
          }
          await runtime.agentEnded({success:true,messages:[{role:'assistant',content:reply}]}, {sessionKey:key});
          this.respond(request.id,true,{status:'started'});
        })());
      } else throw Error('Unexpected RPC ' + request.method);
    }
  }
  const document = {addEventListener() {},dispatchEvent() {}};
  const window = {WebSocket:NativeSocket, crypto:{randomUUID}, addEventListener() {}};
  const localStorage = {getItem:key=>storage.get(key) ?? null, setItem:(key,value)=>storage.set(key,value)};
  const setTimer = (fn, delay) => { const timer=setTimeout(fn,delay);timer.unref();timers.add(timer);return timer; };
  vm.runInNewContext(prefix, {window, document, localStorage, crypto:window.crypto,
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    MessageEvent:class{constructor(type,options){this.type=type;this.data=options.data;}},
    ensureProjectScope:async()=>{},messageText:String,toast:()=>{},setTimeout:setTimer,clearTimeout,
  });
  try {
    const socket = new window.WebSocket('ws://127.0.0.1:18789'); // FakeSocket only; no network connection.
    socket.send(JSON.stringify({type:'req',id:`send-${randomUUID()}`,method:'chat.send',params:{sessionKey:key,message}}));
    await window.testContract.sendQueues.get(key); await Promise.all(runs);
    assert.deepEqual(failures, [], `${model.id}/${agent}/${level} must not fail before sending`);
    assert.equal(calls.filter(c=>c.method==='chat.send').length,1,'exactly one main send');
    const prepare = calls.find(c=>c.method==='pinkie.reasoning.prepare');
    if (prepare) { assert.equal(prepare.params.level,level); assert.equal(prepare.params.tier,level); }
    assert.ok(native.includes(backend), 'send only a supported native effort');
    assert.equal(JSON.parse(storage.get(choiceKey)).tier,level,'custom visual choice survives native routing');
    const solvers = modelCalls.filter(c=>/独立解题助手/.test(c.prompt));
    const expectedSolvers = level==='max'?2:level==='ultra'?3:(level==='xhigh' || (level==='adaptive' && hard)) && !native.includes('xhigh')?1:0;
    assert.equal(solvers.length,expectedSolvers,`${level} independent solves`);
    assert.equal(modelCalls.length-solvers.length,expectedSolvers>0?1:0,`${level} critic`);
    for (const call of modelCalls) { assert.equal(call.model,model.id);assert.equal(call.lane,'subagent'); }
    const status = gateway.status({sessionKey:key});
    assert.equal(status.phase,expectedSolvers>0?'passed':'idle');
    if (level==='off' && model.reasoning) assert.match(injected,/直接给结论/);
    if (model.id==='plain' && ['medium','high'].includes(level)) assert.match(injected,/要求和关键约束/);
    return {model:model.id,agent,level,hard,backend,prepare:Boolean(prepare),solvers:solvers.length,critic:modelCalls.length-solvers.length,phase:status.phase,reply};
  } finally { for(const timer of timers) clearTimeout(timer);fs.rmSync(root,{recursive:true,force:true}); }
}

for (const model of process.env.PINKIE_CONTRACT_LIBRARY ? [] : models) {
  test(`${model.id}: shipped sender and gateway agree for nine tiers in all five modes`, async () => {
    assert.deepEqual(LEVELS,ranks);
    for (const agent of ['main','project','thinking','learning','unrestricted']) {
      for (const level of LEVELS) await exercise({model,agent,level});
      await exercise({model,agent,level:'adaptive',hard:true});
    }
  });
}

export {exercise, models};
