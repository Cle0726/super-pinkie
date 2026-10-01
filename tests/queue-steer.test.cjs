const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadQueueSteer(options = {}) {
  const recoveryCalls = [];
  const notices = [];
  const window = {
    setTimeout(callback, delay) {
      // Fallback's draft-restoration timer is not relevant to these native
      // delegation tests; avoid leaving a half-second test timer behind.
      if (delay === 500) {
        if (options.flushFallback) callback();
        return 0;
      }
      return setTimeout(callback, delay);
    },
    clearTimeout,
    addEventListener() {}, dispatchEvent() {},
    __laolaoToast(message) { notices.push(message); },
    __laolaoQueueRecovery: {
      async recover(...args) { recoveryCalls.push(args); return true; },
    },
  };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  vm.runInNewContext(read('ui/injections/laolao-queue-steer.js'), {
    window, document, CustomEvent, Event, WeakMap, Set, Array, Object, String, Date, Promise,
    console,
  }, {filename: 'laolao-queue-steer.js'});
  return {api: window.__laolaoQueueSteer, recoveryCalls, notices};
}

function queuePane(queue, {runId = 'run-live'} = {}) {
  const pane = {
    requestUpdate() {},
    querySelector() { return null; },
    state: {
      chatRunId: runId,
      chatSending: false,
      chatQueue: queue.map((item) => ({...item})),
      connected: true,
      requestUpdate() {},
    },
  };
  return pane;
}

test('default busy steering resolves the native queue method from pane.state', async () => {
  const {api, recoveryCalls} = loadQueueSteer();
  const pane = queuePane([{id: 'q1', text: '改成用 X 方法'}]);
  const calls = [];
  pane.state.steerQueuedChatMessage = async function(id) {
    calls.push({id, owner: this});
    this.chatQueue = this.chatQueue.map((item) => item.id === id
      ? {...item, kind: 'steered', pendingRunId: this.chatRunId}
      : item);
  };

  assert.equal(typeof pane.steerQueuedChatMessage, 'undefined');
  assert.equal(typeof api.nativeQueueMethod(pane, 'steerQueuedChatMessage'), 'function');
  assert.equal((await api.steerQueued(pane, 'q1', {automatic: true})).state, 'steered');
  assert.deepEqual(calls.map(({id, owner}) => ({id, ownsState: owner === pane.state})),
    [{id: 'q1', ownsState: true}]);
  assert.equal(pane.state.chatQueue[0].kind, 'steered');
  assert.equal(pane.state.chatQueue[0].pendingRunId, 'run-live');
  assert.deepEqual(recoveryCalls, []);
});

test('a race-lost steer restores a native queue card before retrying, without losing text', async () => {
  const {api, recoveryCalls, notices} = loadQueueSteer();
  const pane = queuePane([{id: 'q2', text: '这条不能丢'}]);
  pane.state.steerQueuedChatMessage = async function() {
    // Native terminal cleanup can consume the steered card before its timeout
    // acknowledgement returns. That is the real lost-card regression.
    this.chatQueue = [];
  };

  assert.equal((await api.steerQueued(pane, 'q2', {automatic: true})).state, 'queued');
  const normalized = pane.state.chatQueue[0];
  assert.equal(pane.state.chatQueue.length, 1);
  assert.equal(normalized.id, 'q2');
  assert.equal(normalized.text, '这条不能丢');
  assert.equal(normalized.kind, 'queued');
  assert.equal(normalized.pendingRunId, undefined);
  assert.equal(normalized.sendState, undefined);
  assert.equal(normalized.sendError, undefined);
  assert.deepEqual(recoveryCalls, [[pane, 'steer-race-missing-card']]);
  assert.deepEqual(notices, ['这轮结束后发送。']);
});

test('a newly created native busy queue item is steered once, while a missing run stays queued', async () => {
  const {api, recoveryCalls, notices} = loadQueueSteer();
  const pane = queuePane([]);
  const calls = [];
  pane.state.steerQueuedChatMessage = async function(id) {
    calls.push(id);
    this.chatQueue = this.chatQueue.map((item) => item.id === id
      ? {...item, kind: 'steered', pendingRunId: this.chatRunId}
      : item);
  };
  api.scheduleDefaultSteer(pane, '刚输入的追加消息');
  setTimeout(() => { pane.state.chatQueue = [{id: 'q3', text: '刚输入的追加消息'}]; }, 0);
  await sleep(70);
  assert.deepEqual(calls, ['q3']);
  assert.equal(pane.state.chatQueue[0].kind, 'steered');

  pane.state.chatRunId = null;
  pane.state.chatQueue = [{id: 'q4', text: '没有跟踪 run 也别丢'}];
  assert.equal((await api.steerQueued(pane, 'q4', {automatic: true})).state, 'queued');
  assert.deepEqual(calls, ['q3']);
  assert.deepEqual(recoveryCalls, [[pane, 'no-tracked-run']]);
  assert.ok(notices.includes('这轮结束后发送。'));
});

test('a failed fallback restores text only into an empty composer and otherwise keeps its card', async () => {
  const {api, notices} = loadQueueSteer({flushFallback: true});
  const pane = queuePane([{id: 'q5', text: '原文不能丢'}], {runId: null});
  pane.state.connected = false;
  const input = {value: '', dispatchEvent() { this.inputEvents = (this.inputEvents || 0) + 1; }};
  pane.querySelector = (selector) => selector.includes('textarea') ? input : null;

  assert.equal((await api.steerQueued(pane, 'q5', {automatic: true})).state, 'queued');
  assert.equal(input.value, '原文不能丢');
  assert.equal(input.inputEvents, 1);
  assert.ok(notices.includes('暂时没能送出，原文已放回输入框。'));

  input.value = '先生正在写的新内容';
  pane.state.chatQueue = [{id: 'q6', text: '保留在卡片里的旧内容'}];
  assert.equal((await api.steerQueued(pane, 'q6', {automatic: true})).state, 'queued');
  assert.equal(input.value, '先生正在写的新内容');
  assert.equal(pane.state.chatQueue[0].text, '保留在卡片里的旧内容');
  assert.ok(notices.includes('暂时没能送出，原文已保留在待发送卡片里。'));
});

test('steering layer delegates only to native queue actions, never a parallel chat.send', () => {
  const source = read('ui/injections/laolao-queue-steer.js');
  assert.match(source, /nativeQueueMethod\(pane, "steerQueuedChatMessage"\)/);
  assert.match(source, /await steer\(id\)/);
  assert.doesNotMatch(source, /\.chat\.send\s*\(/);
  assert.doesNotMatch(source, /textContent\s*=/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /replaceChildren\s*\(/);
});
