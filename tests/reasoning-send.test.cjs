const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-sidebar.js'), 'utf8');
const prefix = source.slice(0, source.indexOf('  /* ---------- 1. 状态与模式隔离')) + '})();';

function harness(tier = 'max', {storage = null, prepared = {prepared: true, passes: 2}, patchError = ''} = {}) {
  const calls = [];
  const events = new Map();
  const progress = [];
  let releasePrepare = null;
  let nextId = 0;
  class FakeSocket {
    constructor() { this.readyState = 1; this.listeners = new Map(); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    dispatchEvent(event) { this.listeners.get(event.type)?.(event); }
    send(data) {
      const request = JSON.parse(data);
      calls.push(request);
      if (request.method === 'chat.history') this.reply(request.id, {messages: []});
      if (request.method === 'sessions.patch') {
        if (patchError) queueMicrotask(() => this.dispatchEvent({type:'message',data:JSON.stringify({type:'res',id:request.id,ok:false,error:{message:patchError}})}));
        else this.reply(request.id, {ok: true});
      }
      if (request.method === 'pinkie.reasoning.cancel') this.reply(request.id, {cancelled: true});
      if (request.method === 'pinkie.reasoning.prepare') {
        releasePrepare = () => this.reply(request.id, prepared);
      }
    }
    reply(id, payload) { queueMicrotask(() => this.dispatchEvent({type: 'message', data: JSON.stringify({type: 'res', id, ok: true, payload})})); }
  }
  const document = {
    addEventListener(name, fn) { events.set(name, fn); },
    dispatchEvent(event) { progress.push(event); },
  };
  const window = {WebSocket: FakeSocket, crypto: {randomUUID: () => `gateway-${++nextId}`}, addEventListener(name, fn) { events.set(name, fn); }};
  const context = {
    window, document, localStorage: {getItem: (key) => storage ? storage.get(key) ?? null : key.endsWith(':one') ? tier : '', setItem: (key, value) => storage?.set(key, value)},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    MessageEvent: class { constructor(type, options) { this.type = type; this.data = options.data; } },
    crypto: window.crypto, setTimeout, clearTimeout,
    ensureProjectScope: async () => {}, messageText: (value) => String(value || ''), toast: () => {},
  };
  vm.runInNewContext(prefix, context);
  const socket = new window.WebSocket('ws://127.0.0.1:18789');
  return {socket, calls, events, progress, release: () => releasePrepare?.()};
}

test('enhanced chat prepares before one native send; another session is not blocked', async () => {
  const h = harness();
  h.socket.send(JSON.stringify({type: 'req', id: 'request-12345678', method: 'chat.send', params: {sessionKey: 'agent:learning:one', message: '题目'}}));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(h.calls.map((call) => call.method), ['pinkie.reasoning.prepare'], 'history is read by the backend, not awaited before sending');
  assert.equal(h.calls[0].params.level, 'max');
  assert.equal(h.calls[0].params.tier, 'max', 'an older running gateway still receives its tier field during an update');
  h.socket.send(JSON.stringify({type: 'req', id: 'request-other', method: 'chat.send', params: {sessionKey: 'agent:learning:two', message: '另一题'}}));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(h.calls.some((call) => call.id === 'request-other' && call.method === 'chat.send'), 'other pane can send while first prepares');
  h.release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.calls.filter((call) => call.id === 'request-12345678' && call.method === 'chat.send').length, 1);
  assert.equal(h.progress.some((event) => event.detail?.active === true), true);
  assert.equal(h.progress.at(-1).detail.active, false);
});

test('cancelled enhanced turn never forwards its original chat.send', async () => {
  const h = harness();
  h.socket.send(JSON.stringify({type: 'req', id: 'request-12345678', method: 'chat.send', params: {sessionKey: 'agent:learning:one', message: '题目'}}));
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.events.get('pinkie:reasoning-cancel')({detail: {sessionKey: 'agent:learning:one', requestId: 'request-12345678'}});
  h.release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.calls.filter((call) => call.method === 'chat.send').length, 0);
  assert.ok(h.calls.some((call) => call.method === 'pinkie.reasoning.cancel'));
});

test('a stop the model cannot reach natively is registered too, and a failed registration never blocks the send', async () => {
  const storage = new Map([['pinkie:effort-choice:v1:agent:learning:one', JSON.stringify({tier: 'off', model: 'mm/workbuddy/glm-5.3', backend: 'high'})]]);
  const h = harness('', {storage, prepared: {prepared: true, mode: 'prompt', recipe: {kind: 'down'}, thinkingLevel: 'high'}});
  h.socket.send(JSON.stringify({type: 'req', id: 'request-12345678', method: 'chat.send', params: {sessionKey: 'agent:learning:one', message: '题目'}}));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.calls[0].method, 'pinkie.reasoning.prepare');
  assert.equal(h.calls[0].params.level, 'off');
  h.release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.calls.filter((call) => call.method === 'chat.send').length, 1);
});

test('adaptive picks a native effort for this message before sending, and the slider still remembers Adaptive', async () => {
  const key = 'pinkie:effort-choice:v1:agent:learning:one';
  const storage = new Map([[key, JSON.stringify({tier: 'adaptive', model: 'mm/gemini-3.8-flash-tiered', backend: 'medium'})]]);
  const h = harness('', {storage, prepared: {prepared: false, recipe: {kind: 'adaptive', as: 'xhigh'}, thinkingLevel: 'xhigh'}});
  h.socket.send(JSON.stringify({type: 'req', id: 'request-12345678', method: 'chat.send', params: {sessionKey: 'agent:learning:one', message: '证明这道题'}}));
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(h.calls.map((call) => call.method), ['pinkie.reasoning.prepare', 'sessions.patch', 'chat.send']);
  assert.equal(h.calls[1].params.thinkingLevel, 'xhigh');
  assert.deepEqual(JSON.parse(storage.get(key)), {tier: 'adaptive', model: 'mm/gemini-3.8-flash-tiered', backend: 'xhigh'});
});

test('fixed endpoint routing is confirmed before sending and preserves the chosen tier',async()=>{
  const key='pinkie:effort-choice:v1:agent:learning:one';
  const storage=new Map([[key,JSON.stringify({tier:'low',model:'mm/claude-sonnet-5-5-high',backend:'off'})]]);
  const h=harness('',{storage,prepared:{prepared:false,recipe:{kind:'native'},thinkingLevel:'off',model:'mm/claude-sonnet-5-5-low'}});
  h.socket.send(JSON.stringify({type:'req',id:'endpoint-request-1234',method:'chat.send',params:{sessionKey:'agent:learning:one',message:'你好'}}));
  await new Promise(resolve=>setTimeout(resolve,5));h.release();await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(h.calls.map(call=>call.method),['pinkie.reasoning.prepare','sessions.patch','chat.send']);
  assert.equal(h.calls[1].params.model,'mm/claude-sonnet-5-5-low');assert.equal(h.calls[1].params.thinkingLevel,'off');
  assert.deepEqual(JSON.parse(storage.get(key)),{tier:'low',model:'mm/claude-sonnet-5-5-low',backend:'off'});
});

test('an unconfirmed endpoint route retains the message instead of sending it to the wrong pool',async()=>{
  const storage=new Map([['pinkie:effort-choice:v1:agent:learning:one',JSON.stringify({tier:'adaptive',model:'mm/claude-sonnet-5-5-high',backend:'off'})]]);
  const h=harness('',{storage,patchError:'fixture route rejected',prepared:{prepared:true,recipe:{kind:'adaptive'},thinkingLevel:'off',model:'mm/claude-sonnet-5-5-low'}});
  h.socket.send(JSON.stringify({type:'req',id:'endpoint-request-1234',method:'chat.send',params:{sessionKey:'agent:learning:one',message:'你好'}}));
  await new Promise(resolve=>setTimeout(resolve,5));h.release();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.calls.some(call=>call.method==='chat.send'),false);assert.equal(h.calls.some(call=>call.method==='pinkie.reasoning.cancel'),true);
});

test('a stop the model runs natively sends at once without registering anything', async () => {
  const storage = new Map([['pinkie:effort-choice:v1:agent:learning:one', JSON.stringify({tier: 'high', backend: 'high'})]]);
  const h = harness('', {storage});
  h.socket.send(JSON.stringify({type: 'req', id: 'request-12345678', method: 'chat.send', params: {sessionKey: 'agent:learning:one', message: '题目'}}));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(h.calls.map((call) => call.method), ['chat.send']);
});
