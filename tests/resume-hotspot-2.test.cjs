// ui/injections/laolao-resume.js 热点复发锁（第二批，接 tests/resume-hotspot.test.cjs）。
// 只锁那些「只回退这一处修复，现有测试仍然全绿」的修复：
//
// 23a2fa6e 把 unrestricted 加进 queueReservedButUnsent。tests/queue-unconfirmed.test.mjs
//   测的是 patch/apply-queue-unconfirmed.mjs，tests/queue-steer.test.cjs 测的是
//   laolao-queue-steer.js，tests/resume-ui.test.cjs 只用 project / learning 会话。
// abc4acd1 打开页面时问一次核心插件；没加载就用 "*" 让提示一直挂着，失败事件、
//   恢复事件和历史同步都不能把它冲掉。tests/windows-resume-status.test.cjs 只走
//   失败卡 → 看门狗那条路，不装 Pinkie.domWatch，也不做历史同步。
// f8c0234d 看门狗说「不会重试」后，同一会话的历史同步不能把提示改成「连接已恢复」。
//   tests/resume-ui.test.cjs 只对源码做字符串匹配。
// 86d04f2e 运行中刷新时补回整个有界窗口，而不只是当前这一轮。resume-ui 里那条
//   用例的当前用户轮正好是历史第 0 条，新旧写法结果一样。
//
// 隔离：脚本在 vm 里跑，假 document / 假网关，不起浏览器、不联网、不用上游模型。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-resume.js'), 'utf8');
const NO_PLUGIN = /核心插件没有加载/;

function loadResume(sessionKey, request, options = {}) {
  const windowListeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const nowAt = options.now ?? Date.now();
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
  const attrs = new Map();
  const polls = [];
  const document = {
    hidden: false,
    visibilityState: 'visible',
    // 提示条写在根元素的 data 属性上，这里用 Map 记下来供断言。
    documentElement: {
      setAttribute(key, value) { attrs.set(key, value); },
      removeAttribute(key) { attrs.delete(key); },
      getAttribute(key) { return attrs.get(key) ?? null; },
      hasAttribute() { return false; },
    },
    querySelector(selector) {
      if (selector === 'openclaw-chat-pane') return pane;
      if (selector === 'openclaw-chat-page') return page;
      if (selector === 'openclaw-app-shell') return shell;
      if (selector === '.agent-chat__composer-combobox textarea') return {};
      return null;
    },
    querySelectorAll(selector) { return selector === 'openclaw-chat-pane' ? [pane] : []; },
    addEventListener() {},
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
    addEventListener(name, handler) {
      const handlers = windowListeners.get(name) || [];
      handlers.push(handler);
      windowListeners.set(name, handlers);
    },
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
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    window, pane, attrs, polls, flush,
    emit(name, detail) { for (const handler of windowListeners.get(name) || []) handler({type: name, detail}); },
    timerCount(ms) { return [...timers.values()].filter((timer) => timer.ms === ms).length; },
    async tick(ms) {
      const pending = [...timers].filter(([, timer]) => timer.ms === ms);
      assert.ok(pending.length, `no ${ms}ms timer`);
      for (const [id, timer] of pending) {
        timers.delete(id);
        timer.fn();
      }
      await flush();
    },
    // 打开页面后 1 秒一次的巡检（红条 + 核心插件检查）。
    async poll() {
      const entry = polls.find((item) => item.ms === 1000);
      assert.ok(entry, 'resume registers the 1s chat poll');
      entry.fn();
      await flush();
    },
    // 一次手动的权威历史同步，等同于用户点刷新或断线后补同步。
    sync() { return window.__laolaoRecoverCurrentChat('test-sync', {force: true, manual: true}); },
  };
}

function attachNativeQueueApi(pane, queue) {
  const calls = {retry: []};
  pane.state.chatQueue = queue.map((item) => ({...item}));
  pane.state.removeQueuedMessage = function(id) {
    this.chatQueue = this.chatQueue.filter((item) => item.id !== id);
  };
  pane.state.retryQueuedChatMessage = async function(id) {
    const item = this.chatQueue.find((entry) => entry.id === id);
    calls.retry.push(item ? {...item} : {id, missing: true});
    this.chatQueue = this.chatQueue.filter((entry) => entry.id !== id);
  };
  return calls;
}

// 核心插件整个没加载：每个方法都回 unknown method；历史同步照常返回空历史。
const missingPlugin = (calls) => async (method) => {
  calls.push(method);
  if (method === 'chat.history') return {messages: [], hasMore: false};
  if (method === 'sessions.list') return {sessions: []};
  throw new Error(`unknown method: ${method}`);
};

// ── 23a2fa6e ─────────────────────────────────────────────────────────
test('an unrestricted card that only reserved a run id is resent after the turn ends', async () => {
  const now = 1_700_000_000_000;
  const sessionKey = 'agent:unrestricted:dashboard:queued';
  const h = loadResume(sessionKey, async (method) => method === 'sessions.list'
    ? {sessions: [{key: sessionKey, hasActiveRun: false}]}
    : {messages: [], hasMore: false}, {clock: true, now});
  const calls = attachNativeQueueApi(h.pane, [{
    id: 'reserved',
    text: '无限模式里排队的第二句',
    createdAt: now - 1,
    sessionKey,
    sendAttempts: 0,
    sendRunId: 'reserved-run',
    sendSubmittedAtMs: 123,
  }]);
  assert.equal(await h.window.__laolaoQueueRecovery.recover('unrestricted-turn-ended'), true);
  assert.equal(calls.retry.length, 1);
  assert.equal(calls.retry[0].id, 'reserved');
  assert.equal(calls.retry[0].sendRunId, 'reserved-run');
  assert.equal(calls.retry[0].sendState, 'waiting-reconnect');
  assert.equal(calls.retry[0].__pinkieReservedUnsent, true);
});

// ── abc4acd1 ─────────────────────────────────────────────────────────
test('opening the chat without the core plugin shows the notice once, and an older plugin is not flagged', async () => {
  const calls = [];
  const h = loadResume('agent:main:no-plugin', missingPlugin(calls));
  await h.poll();
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'offline');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), NO_PLUGIN);
  await h.poll();
  assert.equal(calls.filter((method) => method === 'pinkie.usage.get').length, 1, 'checked only once per page');

  // 旧版插件没有 watchdog.status，但 usage.get 在：不能误报「没加载」。
  const older = loadResume('agent:main:old-plugin', async (method) => {
    if (method === 'pinkie.usage.get') return {};
    throw new Error(`unexpected ${method}`);
  });
  await older.poll();
  assert.equal(older.attrs.get('data-laolao-watchdog-state'), undefined);
});

test('the missing-plugin notice survives an authoritative history sync', async () => {
  const calls = [];
  const h = loadResume('agent:main:no-plugin-sync', missingPlugin(calls));
  await h.poll();
  assert.match(h.attrs.get('data-laolao-watchdog-message'), NO_PLUGIN);
  assert.equal(await h.sync(), true);
  assert.ok(calls.includes('chat.history'), 'the sync really read history');
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'offline');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), NO_PLUGIN);
});

test('a failed run does not reset the missing-plugin notice or start a watchdog poll', async () => {
  const calls = [];
  const h = loadResume('agent:main:no-plugin-fail', missingPlugin(calls));
  await h.poll();
  const watchdogWaits = h.timerCount(300);
  h.emit('pinkie:run-failed');
  assert.equal(h.timerCount(300), watchdogWaits, 'no watchdog.status wait was armed');
  assert.equal(await h.sync(), true);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'offline');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), NO_PLUGIN);
  assert.ok(!calls.includes('pinkie.watchdog.status'));
});

test('a recovered event keeps the missing-plugin marker, so the next failure still skips the watchdog', async () => {
  const calls = [];
  const h = loadResume('agent:main:no-plugin-recovered', missingPlugin(calls));
  await h.poll();
  assert.match(h.attrs.get('data-laolao-watchdog-message'), NO_PLUGIN);
  h.emit('pinkie:run-recovered');
  const watchdogWaits = h.timerCount(300);
  h.emit('pinkie:run-failed');
  assert.equal(h.timerCount(300), watchdogWaits, 'the failure after a recovery is still not sent to the watchdog');
  assert.ok(!calls.includes('pinkie.watchdog.status'));
});

// ── f8c0234d ─────────────────────────────────────────────────────────
function stoppedWatchdog(calls, state) {
  return async (method) => {
    calls.push(method);
    if (method === 'pinkie.usage.get') return {};
    if (method === 'pinkie.watchdog.status') return state();
    if (method === 'chat.history') return {messages: [], hasMore: false};
    if (method === 'sessions.list') return {sessions: []};
    throw new Error(`unexpected ${method}`);
  };
}

test('a "won\'t retry" notice stays through a history sync of the same session', async () => {
  const calls = [];
  const h = loadResume('agent:main:stopped', stoppedWatchdog(calls,
    () => ({state: 'stopped', message: '本机代理没开，这次失败不会自动重试。'})));
  h.emit('pinkie:run-failed');
  await h.tick(300);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'offline');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), /不会自动重试/);
  assert.equal(await h.sync(), true);
  assert.ok(calls.includes('chat.history'), 'the sync really read history');
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'offline');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), /本机代理没开/);
});

test('a real retry ribbon still closes on the next history sync', async () => {
  // 对照组：上面那条保护不能把所有提示都钉死。
  const calls = [];
  const h = loadResume('agent:main:retrying', stoppedWatchdog(calls, () => ({state: 'retrying', attempt: 1})));
  h.emit('pinkie:run-failed');
  await h.tick(300);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'retrying');
  assert.equal(await h.sync(), true);
  assert.equal(h.attrs.get('data-laolao-watchdog-state'), 'recovered');
  assert.match(h.attrs.get('data-laolao-watchdog-message'), /连接已恢复/);
});

// ── 86d04f2e ─────────────────────────────────────────────────────────
test('a mid-run refresh restores earlier turns too, not only the active turn', async () => {
  const sessionKey = 'agent:main:dashboard:mid-run';
  const message = (role, id, seq, text) => ({role, content: [{type: 'text', text}], __openclaw: {id, seq}});
  const earlierUser = message('user', 'earlier-user', 1, '上一轮的问题');
  const earlierReply = message('assistant', 'earlier-reply', 2, '上一轮的回答');
  const activeUser = message('user', 'active-user', 3, '这一轮要多步处理');
  const call = {role: 'assistant', content: [{type: 'tool_call', callId: 'c1', name: 'exec', arguments: {command: 'check'}}],
    __openclaw: {id: 'active-call', seq: 4}};
  const result = {role: 'toolResult', content: [{type: 'text', text: '第 1 步已完成'}], __openclaw: {id: 'active-result', seq: 5}};
  const h = loadResume(sessionKey, async (method) => {
    if (method === 'sessions.list') return {sessions: [{key: sessionKey, hasActiveRun: true, activeRunIds: ['run-active']}]};
    if (method === 'chat.history') {
      return {messages: [earlierUser, earlierReply, activeUser, call, result], totalMessages: 5, hasMore: false, sessionId: 's1'};
    }
    throw new Error(`unexpected ${method}`);
  });
  // 刷新后原生页只剩运行中的尾巴。
  h.pane.state.chatMessages = [call, result];
  h.pane.state.chatStream = {runId: 'run-active'};
  await h.window.__laolaoSyncSelectedSession(sessionKey);
  assert.deepEqual(Array.from(h.pane.state.chatMessages, (m) => m.__openclaw.id),
    ['earlier-user', 'earlier-reply', 'active-user', 'active-call', 'active-result']);
  assert.equal(h.window.__laolaoHistoryStatus().activeTurnBoundary, true);
});
