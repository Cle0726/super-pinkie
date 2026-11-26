// Recurrence locks for fixes in ui/injections/laolao-resume.js that the tests
// shipped with those commits do not catch.
//
// 58c9ee6a added `metre` to queueReservedButUnsent. tests/queue-steer.test.cjs
// locks the same word in laolao-queue-steer.js, and tests/resume-ui.test.cjs
// only drives agent:project / agent:learning. Removing `|metre` from this file
// leaves both of those green.
//
// 08f06672 asks the watchdog when the native red error banner appears or
// changes. The later dom-watch move kept that check. tests/windows-resume-status.test.cjs
// only fires pinkie:run-failed and never installs Pinkie.domWatch, so deleting
// the banner read leaves that file green.
//
// Isolation: the script runs in a vm with a fake document. No upstream calls.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-resume.js'), 'utf8');

function loadResume(sessionKey, request, options = {}) {
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  let nowAt = options.now ?? Date.now();
  const TestDate = options.clock ? class extends Date { static now() { return nowAt; } } : Date;
  const pane = {
    active: true,
    sessionKey,
    tagName: 'OPENCLAW-CHAT-PANE',
    state: {
      sessionKey,
      chatMessages: [],
      chatHistoryPagination: {},
      requestUpdate() {},
      scrollToBottom() {},
    },
    querySelector() { return null; },
    requestUpdate() {},
  };
  const page = {data: {sessionKey}, requestUpdate() {}};
  const gateway = {snapshot: {connected: true, client: {request}}, subscribe() { return () => {}; }};
  const shell = {context: {gateway}};
  let banner = options.banner ?? null;
  const polls = [];
  const document = {
    hidden: false,
    visibilityState: 'visible',
    documentElement: {
      setAttribute() {},
      removeAttribute() {},
      getAttribute() { return null; },
      hasAttribute() { return false; },
    },
    querySelector(selector) {
      if (selector === 'openclaw-chat-pane') return pane;
      if (selector === 'openclaw-chat-page') return page;
      if (selector === 'openclaw-app-shell') return shell;
      if (selector === '.agent-chat__composer-combobox textarea') return {};
      if (selector === '.callout.danger.callout--dismissible') return banner;
      return null;
    },
    querySelectorAll(selector) { return selector === 'openclaw-chat-pane' ? [pane] : []; },
    addEventListener(name, handler) {
      const handlers = listeners.get(name) || [];
      handlers.push(handler);
      listeners.set(name, handlers);
    },
    dispatchEvent() {},
  };
  const location = {pathname: '/chat', search: `?session=${encodeURIComponent(sessionKey)}`};
  const window = {
    location,
    Pinkie: {
      domWatch: {
        poll(fn, ms) { polls.push({fn, ms}); },
        createObserver() { return {watch() {}, disconnect() {}}; },
      },
    },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, {fn, ms});
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return ++timerId; },
    clearInterval() {},
    __laolaoSidebar: {gwRequest: request},
    addEventListener() {},
    dispatchEvent() {},
  };
  class MutationObserver { observe() {} disconnect() {} }
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  class Element {}
  vm.runInNewContext(source, {
    window, document, location, MutationObserver, CustomEvent, Element,
    URLSearchParams, URL, Map, WeakMap, Set, Number, Array, JSON, Promise, Error,
    Date: TestDate, console,
  }, {filename: 'laolao-resume.js'});
  return {
    window, document, pane, polls,
    setBanner(next) { banner = next; },
    hasTimer(ms) { return [...timers].some(([, timer]) => timer.ms === ms); },
    async tick(ms) {
      const pending = [...timers].filter(([, timer]) => timer.ms === ms);
      assert.ok(pending.length, `no ${ms}ms timer`);
      for (const [id, timer] of pending) {
        timers.delete(id);
        timer.fn();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function attachNativeQueueApi(pane, queue) {
  const calls = {remove: [], retry: []};
  pane.state.chatQueue = queue.map((item) => ({...item}));
  pane.state.removeQueuedMessage = function(id) {
    calls.remove.push(id);
    this.chatQueue = this.chatQueue.filter((item) => item.id !== id);
  };
  pane.state.retryQueuedChatMessage = async function(id) {
    const item = this.chatQueue.find((entry) => entry.id === id);
    calls.retry.push(item ? {...item} : {id, missing: true});
    this.chatQueue = this.chatQueue.filter((entry) => entry.id !== id);
  };
  return calls;
}

test('a Metre card that only reserved a run id is resent after the turn ends', async () => {
  const now = 1_700_000_000_000;
  const sessionKey = 'agent:metre:dashboard:queued';
  const h = loadResume(sessionKey, async (method) => method === 'sessions.list'
    ? {sessions: [{key: sessionKey, hasActiveRun: false}]}
    : {messages: [], hasMore: false}, {clock: true, now});
  const calls = attachNativeQueueApi(h.pane, [{
    id: 'reserved',
    text: '第二句还在排队',
    createdAt: now - 1,
    sessionKey,
    sendAttempts: 0,
    sendRunId: 'reserved-run',
    sendSubmittedAtMs: 123,
  }]);
  assert.equal(await h.window.__laolaoQueueRecovery.recover('metre-turn-ended'), true);
  assert.equal(calls.retry.length, 1);
  assert.equal(calls.retry[0].id, 'reserved');
  assert.equal(calls.retry[0].sendRunId, 'reserved-run');
  assert.equal(calls.retry[0].sendState, 'waiting-reconnect');
  assert.equal(calls.retry[0].__pinkieReservedUnsent, true);
});

test('a mode outside that list still leaves a reserved card alone', async () => {
  const now = 1_700_000_000_000;
  const sessionKey = 'agent:ideas:dashboard:queued';
  const h = loadResume(sessionKey, async (method) => method === 'sessions.list'
    ? {sessions: [{key: sessionKey, hasActiveRun: false}]}
    : {messages: [], hasMore: false}, {clock: true, now});
  const calls = attachNativeQueueApi(h.pane, [{
    id: 'reserved',
    text: '不要重发',
    createdAt: now - 1,
    sessionKey,
    sendAttempts: 0,
    sendRunId: 'reserved-run',
    sendSubmittedAtMs: 123,
  }]);
  assert.equal(await h.window.__laolaoQueueRecovery.recover('ideas-turn-ended'), false);
  assert.deepEqual(calls.retry, []);
  assert.equal(h.pane.state.chatQueue[0].sendState, undefined);
});

test('a native red error banner asks the watchdog, and the same text does not ask again', async () => {
  const calls = [];
  const h = loadResume('agent:main:banner', async (method) => {
    calls.push(method);
    if (method === 'pinkie.usage.get') return {};
    if (method === 'pinkie.watchdog.status') return {state: 'retrying', attempt: 1};
    throw new Error(`unexpected ${method}`);
  });
  const poll = h.polls.find((item) => item.ms === 1000);
  assert.ok(poll, 'resume registers the banner poll');
  const attrs = new Map();
  h.document.documentElement.setAttribute = (key, value) => attrs.set(key, value);
  h.document.documentElement.getAttribute = (key) => attrs.get(key) ?? null;

  poll.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['pinkie.usage.get']);

  h.setBanner({textContent: ' LLM request timed out. '});
  poll.fn();
  assert.equal(h.hasTimer(300), true, 'a new red banner must ask the watchdog');
  await h.tick(300);
  assert.equal(calls.filter((method) => method === 'pinkie.watchdog.status').length, 1);
  assert.equal(attrs.get('data-laolao-watchdog-state'), 'retrying');

  const before = calls.length;
  poll.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, before, 'the same banner does not ask again');

  h.setBanner({textContent: 'Connection error.'});
  poll.fn();
  assert.equal(h.hasTimer(300), true, 'a changed red banner must ask the watchdog again');
  await h.tick(300);
  assert.equal(calls.filter((method) => method === 'pinkie.watchdog.status').length, 2);
});
