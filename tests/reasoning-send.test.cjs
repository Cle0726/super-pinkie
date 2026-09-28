const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-sidebar.js'), 'utf8');
const prefix = source.slice(0, source.indexOf('  /* ---------- 1. 状态与模式隔离')) + '})();';

function harness(tier = 'max') {
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
      if (request.method === 'pinkie.reasoning.cancel') this.reply(request.id, {cancelled: true});
      if (request.method === 'pinkie.reasoning.prepare') {
        releasePrepare = () => this.reply(request.id, {prepared: true, passes: 2});
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
    window, document, localStorage: {getItem: (key) => key.endsWith(':one') ? tier : ''},
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
  assert.deepEqual(h.calls.map((call) => call.method), ['chat.history', 'pinkie.reasoning.prepare']);
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
