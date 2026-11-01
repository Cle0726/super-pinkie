const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(rpc) {
  const listeners = new Map(), timers = new Map();
  let id = 0;
  const attrs = new Map();
  const element = {
    setAttribute: (key, value) => attrs.set(key, value),
    getAttribute: key => attrs.get(key) ?? null,
    removeAttribute: key => attrs.delete(key),
    hasAttribute: key => attrs.has(key),
  };
  const sessionKey = 'agent:main:test';
  const pane = {active: true, state: {sessionKey}};
  const gateway = {snapshot: {connected: true, client: {}}, subscribe() { return () => {}; }};
  const shell = {context: {gateway}};
  const document = {
    documentElement: element, body: element, hidden: false, visibilityState: 'visible',
    querySelector(selector) {
      if (selector === 'openclaw-app-shell') return shell;
      if (selector === 'openclaw-chat-pane') return pane;
      return null;
    },
    querySelectorAll(selector) { return selector === 'openclaw-chat-pane' ? [pane] : []; },
    addEventListener() {},
  };
  const location = {pathname: '/chat', search: `?session=${encodeURIComponent(sessionKey)}`};
  const window = {
    location, __laolaoSidebar: {gwRequest: rpc},
    setTimeout(fn, ms) { const key = ++id; timers.set(key, {fn, ms}); return key; },
    clearTimeout(key) { timers.delete(key); },
    setInterval() { return ++id; }, clearInterval() {}, dispatchEvent() {},
    addEventListener(name, fn) { listeners.set(name, fn); },
  };
  class MutationObserver { observe() {} disconnect() {} }
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  class Element {}
  const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-resume.js'), 'utf8');
  vm.runInNewContext(source, {window, document, location, MutationObserver, CustomEvent, Element,
    URLSearchParams, URL, Map, WeakMap, Set, Number, Array, JSON, Promise, Error, Date, console});
  return {
    attrs,
    fail() { listeners.get('pinkie:run-failed')(); },
    async tick(ms) {
      const entry = [...timers].find(([, value]) => value.ms === ms);
      assert.ok(entry, `no ${ms}ms timer`);
      timers.delete(entry[0]);
      entry[1].fn();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('a failed run is not advertised as retrying until the watchdog confirms it', async () => {
  const h = harness(async method => {
    assert.equal(method, 'pinkie.watchdog.status');
    return {state: 'idle'};
  });
  h.fail();
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), undefined);
  for (const delay of [300, 700, 1200, 2000, 3000]) await h.tick(delay);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), undefined);
});

test('a real scheduled retry is shown after the watchdog confirms it', async () => {
  const h = harness(async () => ({state: 'retrying', attempt: 1}));
  h.fail();
  await h.tick(300);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'retrying');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), /自动重试/);
});

test('a timed out plugin check can be retried and does not pretend the plugin exists', async () => {
  let usageCalls = 0;
  const h = harness(async method => {
    if (method === 'pinkie.watchdog.status') throw new Error('unknown method');
    if (++usageCalls === 1) throw new Error('gateway request timeout');
    throw new Error('unknown method');
  });
  h.fail();
  await h.tick(300);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), undefined);
  h.fail();
  await h.tick(300);
  assert.equal(usageCalls, 2);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'offline');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), /核心插件没有加载/);
});
