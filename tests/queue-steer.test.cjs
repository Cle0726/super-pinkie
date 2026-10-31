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
      ...(options.pruneDelivered ? {pruneDelivered: options.pruneDelivered} : {}),
    },
  };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return options.panes || []; },
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

test('a race-lost steer retains an unconfirmed card without automatically resending', async () => {
  const {api, recoveryCalls, notices} = loadQueueSteer();
  const pane = queuePane([{id: 'q2', text: '这条不能丢'}]);
  pane.state.steerQueuedChatMessage = async function() {
    // Native terminal cleanup can consume the steered card before its timeout
    // acknowledgement returns. That is the real lost-card regression.
    this.chatQueue = [];
  };

  assert.equal((await api.steerQueued(pane, 'q2', {automatic: true})).state, 'unconfirmed');
  const normalized = pane.state.chatQueue[0];
  assert.equal(pane.state.chatQueue.length, 1);
  assert.equal(normalized.id, 'q2');
  assert.equal(normalized.text, '这条不能丢');
  assert.equal(normalized.kind, 'queued');
  assert.equal(normalized.pendingRunId, undefined);
  assert.equal(normalized.sendState, 'unconfirmed');
  assert.match(normalized.sendError, /送达未确认/);
  assert.deepEqual(recoveryCalls, []);
  assert.deepEqual(notices, ['追加的送达状态还未确认，原文已保留，请勿重复发送。']);
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

test('a failed fallback keeps one recoverable card instead of duplicating text into the composer', async () => {
  const {api, notices} = loadQueueSteer({flushFallback: true});
  const pane = queuePane([{id: 'q5', text: '原文不能丢'}], {runId: null});
  pane.state.connected = false;
  const input = {value: '', dispatchEvent() { this.inputEvents = (this.inputEvents || 0) + 1; }};
  pane.querySelector = (selector) => selector.includes('textarea') ? input : null;

  assert.equal((await api.steerQueued(pane, 'q5', {automatic: true})).state, 'queued');
  assert.equal(input.value, '');
  assert.equal(input.inputEvents || 0, 0);
  assert.equal(pane.state.chatQueue[0].text, '原文不能丢');
  assert.ok(notices.includes('暂时没能确认送达，原文已保留在消息卡片里。'));

  input.value = '先生正在写的新内容';
  pane.state.chatQueue = [{id: 'q6', text: '保留在卡片里的旧内容'}];
  assert.equal((await api.steerQueued(pane, 'q6', {automatic: true})).state, 'queued');
  assert.equal(input.value, '先生正在写的新内容');
  assert.equal(pane.state.chatQueue[0].text, '保留在卡片里的旧内容');
  assert.ok(notices.includes('暂时没能确认送达，原文已保留在消息卡片里。'));
});

test('a durable steer receipt removes its card while the original run is still active', async () => {
  const pane = queuePane([{id: 'ack', text: '追加内容'}]);
  let sends = 0, prunes = 0;
  const {api, notices} = loadQueueSteer({pruneDelivered: async (owner) => {
    prunes += 1;
    assert.equal(owner.state.chatRunId, 'run-live');
    owner.state.chatQueue = [];
    return ['ack'];
  }});
  pane.state.steerQueuedChatMessage = async function(id) {
    sends += 1;
    this.chatQueue = [{...this.chatQueue[0], kind: 'steered', pendingRunId: this.chatRunId}];
  };
  assert.equal((await api.steerQueued(pane, 'ack')).state, 'delivered');
  assert.equal(pane.state.chatQueue.length, 0);
  assert.equal(sends, 1);
  assert.equal(prunes, 1);
  assert.ok(notices.includes('已追加到当前任务。'));
});

test('an accepted native result never recreates a card that native already removed', async () => {
  const {api, recoveryCalls} = loadQueueSteer();
  const pane = queuePane([{id: 'already', text: '已送达'}]);
  pane.state.steerQueuedChatMessage = async function() {
    this.chatQueue = [];
    return {status: 'accepted'};
  };
  assert.equal((await api.steerQueued(pane, 'already')).state, 'delivered');
  assert.equal(pane.state.chatQueue.length, 0);
  assert.deepEqual(recoveryCalls, []);
});

test('double invocation shares one native steer and cannot requeue an accepted item', async () => {
  const {api} = loadQueueSteer();
  const pane = queuePane([{id: 'once', text: '只追加一次'}]);
  let calls = 0, accept;
  pane.state.steerQueuedChatMessage = async function() {
    calls += 1;
    await new Promise((resolve) => { accept = resolve; });
    this.chatQueue = [{...this.chatQueue[0], kind: 'steered', pendingRunId: this.chatRunId}];
  };
  const a = api.steerQueued(pane, 'once');
  const b = api.steerQueued(pane, 'once');
  assert.equal(a, b);
  accept();
  await a;
  assert.equal(calls, 1);
  assert.equal(api.makeQueuedAgain(pane, 'once'), null);
  assert.equal(pane.state.chatQueue[0].kind, 'steered');
});

test('an uncertain receipt cannot be converted into an automatic retry', () => {
  const {api} = loadQueueSteer();
  const pane = queuePane([{id: 'unknown', text: '不要重复', sendState: 'unconfirmed'}]);
  assert.equal(api.makeQueuedAgain(pane, 'unknown'), null);
  assert.equal(pane.state.chatQueue[0].sendState, 'unconfirmed');
});

test('a late steer acknowledgement cannot recreate its card in a different session', async () => {
  const {api} = loadQueueSteer();
  const pane = queuePane([{id: 'old', text: '旧会话消息'}]);
  pane.state.sessionKey = 'old-session';
  let finish;
  pane.state.steerQueuedChatMessage = async () => new Promise((resolve) => { finish = resolve; });
  const pending = api.steerQueued(pane, 'old');
  pane.state.sessionKey = 'new-session';
  pane.state.chatQueue = [{id: 'new', text: '新会话消息'}];
  finish();
  assert.equal((await pending).state, 'superseded');
  assert.deepEqual(pane.state.chatQueue.map((item) => item.id), ['new']);
});

test('an accepted receipt with a retained card cannot requeue the instruction', async () => {
  const {api, recoveryCalls} = loadQueueSteer();
  const pane = queuePane([{id: 'accepted', text: '已接受但尚未落盘'}]);
  pane.state.steerQueuedChatMessage = async () => ({status: 'accepted'});
  assert.equal((await api.steerQueued(pane, 'accepted')).state, 'steered');
  assert.equal(pane.state.chatQueue[0].kind, 'steered');
  assert.equal(pane.state.chatQueue[0].sendState, 'unconfirmed');
  assert.deepEqual(recoveryCalls, []);
});

test('native outbox submissions retain their identity and sending state after a void return', async () => {
  const {api, recoveryCalls} = loadQueueSteer();
  const pane = queuePane([{id: 'outbox', text: '原生发件箱'}]);
  pane.state.steerQueuedChatMessage = async function() {
    this.chatQueue = [{...this.chatQueue[0], queueMode: 'steer', sendState: 'sending', sendRunId: 'native-run'}];
  };
  await api.steerQueued(pane, 'outbox');
  assert.equal(pane.state.chatQueue[0].sendState, 'sending');
  assert.equal(pane.state.chatQueue[0].sendRunId, 'native-run');
  assert.equal(api.makeQueuedAgain(pane, 'outbox'), null);
  assert.deepEqual(recoveryCalls, []);
});

test('a thrown timeout with the card still present is held without a second send', async () => {
  const {api, recoveryCalls} = loadQueueSteer();
  const pane = queuePane([{id: 'timeout', text: '超时不代表未送达'}]);
  pane.state.steerQueuedChatMessage = async () => { throw new Error('timeout'); };
  assert.equal((await api.steerQueued(pane, 'timeout')).state, 'unconfirmed');
  assert.equal(pane.state.chatQueue.length, 1);
  assert.equal(pane.state.chatQueue[0].sendState, 'unconfirmed');
  assert.deepEqual(recoveryCalls, []);
});

test('a stale queue item belonging to another session is never steered', async () => {
  const {api} = loadQueueSteer();
  const pane = queuePane([{id: 'foreign', text: '旧会话', sessionKey: 'other'}]);
  pane.state.sessionKey = 'current';
  let calls = 0;
  pane.state.steerQueuedChatMessage = async () => { calls += 1; };
  assert.equal((await api.steerQueued(pane, 'foreign')).state, 'gone');
  assert.equal(calls, 0);
});

test('a native submission already in progress is not steered a second time', async () => {
  const {api, recoveryCalls} = loadQueueSteer();
  const pane = queuePane([{id:'in-progress',text:'已提交',queueMode:'steer',sendRunId:'native-run',sendState:'submitting'}]);
  let calls = 0;
  pane.state.steerQueuedChatMessage = async () => { calls += 1; };
  assert.equal((await api.steerQueued(pane,'in-progress')).state, 'unconfirmed');
  assert.equal(calls, 0);
  assert.equal(pane.state.chatQueue[0].sendState,'submitting');
  assert.deepEqual(recoveryCalls, []);
});

test('a busy native queue item with only a reserved run id is steered once', async () => {
  const {api} = loadQueueSteer();
  const pane = queuePane([{id:'reserved',text:'新要求',sessionKey:'agent:learning:test',sendAttempts:0,sendRunId:'reserved-id',sendSubmittedAtMs:123}]);
  pane.state.sessionKey='agent:learning:test';let calls=0;
  pane.state.steerQueuedChatMessage=async function(id){calls++;this.chatQueue=this.chatQueue.map(x=>x.id===id?{...x,kind:'steered',pendingRunId:this.chatRunId}:x)};
  assert.equal((await api.steerQueued(pane,'reserved')).state,'steered');
  assert.equal(calls,1);assert.equal(pane.state.chatQueue[0].sendRunId,'reserved-id');
});

test('queue presentation follows the native stable item ID instead of a filtered array index', () => {
  const pane = queuePane([
    {id:'submitting', text:'处理中', sendState:'submitting'},
    {id:'waiting', text:'待发送'},
  ]);
  const row = {dataset:{}, getAttribute(name){return name==='data-chat-queue-item'?'waiting':null;},querySelector(){return null;}};
  pane.querySelectorAll = () => [row];
  const {api} = loadQueueSteer({panes:[pane]});
  api.syncQueueControls();
  assert.equal(row.dataset.pinkieQueueId, 'waiting');
  assert.equal(row.dataset.pinkieQueueLabel, '结束后发送');
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
