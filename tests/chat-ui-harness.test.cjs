const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// scripts/chat-ui-harness replays gateway traffic into the real chat UI.
// Pin the protocol shapes it relies on, so a stale fake cannot make a broken
// chat view look healthy.

function loadFakeGateway(options = {}) {
  const window = {...options};
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts/chat-ui-harness/fake-gateway.js'), 'utf8');
  vm.runInNewContext(source, {window, EventTarget, Event, MessageEvent, setTimeout, clearTimeout, Promise, console});
  return window;
}

async function connect(window) {
  const socket = new window.WebSocket('ws://127.0.0.1/harness');
  const frames = [];
  socket.addEventListener('message', (event) => frames.push(JSON.parse(event.data)));
  let nextId = 0;
  const request = async (method, params = {}) => {
    const id = `r${++nextId}`;
    socket.send(JSON.stringify({type: 'req', id, method, params}));
    for (let i = 0; i < 200; i++) {
      const response = frames.find((frame) => frame.type === 'res' && frame.id === id);
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error(`no response to ${method}`);
  };
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {socket, frames, request};
}

const events = (frames, name) => frames.filter((frame) => frame.type === 'event' && frame.event === name).map((frame) => frame.payload);
const textOf = (message) => (message?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 800) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await wait(2);
  }
  assert.fail(`timed out waiting for ${label}`);
}
function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

test('fake gateway completes the Control UI handshake and serves history pages', async () => {
  const window = loadFakeGateway();
  const {frames, request} = await connect(window);
  assert.equal(frames[0].event, 'connect.challenge');
  const hello = await request('connect', {minProtocol: 4, maxProtocol: 4});
  assert.equal(hello.ok, true);
  assert.equal(hello.payload.type, 'hello-ok');
  const page = await request('chat.history', {sessionKey: window.__fake.SK, limit: 1});
  assert.equal(page.payload.messages.length, 1);
  assert.equal(page.payload.hasMore, true);
});

test('fake gateway exposes deep-think status with task route and used stages', async () => {
  const window = loadFakeGateway();
  const {request} = await connect(window);
  await request('connect');
  const armed = await request('pinkie.deepThink.arm', {sessionKey: window.__fake.SK, tier: 'full'});
  assert.equal(armed.payload.armed, true);
  window.__fake.setTierStatus({
    active: true, tier: 'full', phase: 'working',
    required: 2, completed: 1,
    workflow: {
      type: 'implementation', label: '写代码 / 修 bug',
      stages: [
        {label: '复现', used: true},
        {label: '修改', used: true},
        {label: '测试', used: false},
      ],
    },
  });
  const status = await request('pinkie.deepThink.status', {sessionKey: window.__fake.SK});
  assert.equal(status.payload.workflow.label, '写代码 / 修 bug');
  assert.deepEqual(status.payload.workflow.stages.map((stage) => stage.used), [true, true, false]);
  const disarmed = await request('pinkie.deepThink.disarm', {sessionKey: window.__fake.SK});
  assert.equal(disarmed.payload.disarmed, true);
});

test('narrated scenario streams one accumulated run text and persists text with each tool call', async () => {
  const window = loadFakeGateway();
  const {socket, frames, request} = await connect(window);
  await request('connect');
  await request('sessions.subscribe');
  await request('sessions.messages.subscribe', {key: window.__fake.SK});
  await window.__fake.scenario('narrated', {gap: 2, uiSocket: socket});

  // The chat.send caller receives tool events as `agent`.
  assert.equal(events(frames, 'agent').filter((event) => event.stream === 'tool').length, 6);
  const final = events(frames, 'chat').find((event) => event.state === 'final');
  assert.ok(textOf(final.message).startsWith('我先看一下测试入口有哪些。接着跑一遍完整测试'));
  assert.ok(textOf(final.message).endsWith('【最终回复】'));

  const history = (await request('chat.history', {limit: 50})).payload.messages;
  const narrated = history.filter((message) => message.role === 'assistant'
    && message.content.some((part) => part.type === 'toolCall') && textOf(message));
  assert.equal(narrated.length, 3);
  assert.equal(textOf(history.at(-1)), '基线测试全部通过，没有发现冲突规则。【最终回复】');
  assert.equal(events(frames, 'session.message').length, history.length - 2);
});

test('watchdog continuation arrives from another run with an invisible user turn', async () => {
  const window = loadFakeGateway();
  const {socket, frames, request} = await connect(window);
  await request('connect');
  await request('sessions.subscribe');
  await window.__fake.scenario('watchdog', {gap: 2, watchdogDelay: 2, uiSocket: socket});

  const continuation = events(frames, 'session.tool').filter((event) => event.runId.startsWith('pinkie-watchdog-'));
  assert.equal(continuation.length, 2);
  const history = (await request('chat.history', {limit: 50})).payload.messages;
  assert.ok(history.some((message) => message.role === 'user' && textOf(message) === '⁣'));
  const finals = events(frames, 'chat').filter((event) => event.state === 'final');
  assert.match(textOf(finals.at(-1).message), /【最终回复】$/);
  assert.notEqual(finals.at(-1).runId, finals[0].runId);
});

test('queue-normal is the baseline: a later native retry reaches the gateway once after final', async () => {
  const window = loadFakeGateway();
  const {socket, request} = await connect(window);
  await request('connect');
  const observation = await window.__fake.scenario('queue-normal', {gap: 2, holdMs: 2, uiSocket: socket});
  assert.match(observation.beforeFix, /收到 final/);
  assert.equal(observation.activeAfter, false);

  // This request represents native lg()/retryQueuedChatMessage after final;
  // the fake must not manufacture a second receipt for it.
  const sent = await request('chat.send', {message: '第一轮结束后再发', idempotencyKey: 'queue-a'});
  assert.equal(sent.payload.status, 'started');
  await waitFor(() => window.__fake.state.deliveries.length === 1, 'queued retry receipt');
  assert.equal(window.__fake.state.deliveries[0].kind, 'normal');
  assert.equal(window.__fake.state.deliveries[0].message, '第一轮结束后再发');
  await waitFor(() => window.__fake.state.activeRuns.size === 0, 'follow-up terminal');
});

test('queue-missing-terminal exposes the stale-idle recovery wire conditions and accepts a retry once', async () => {
  const window = loadFakeGateway();
  const {socket, frames, request} = await connect(window);
  await request('connect');
  await request('sessions.subscribe');
  const observation = await window.__fake.scenario('queue-missing-terminal', {gap: 2, holdMs: 2, uiSocket: socket});
  assert.match(observation.beforeFix, /forceIdle/);
  assert.equal(observation.activeAfter, false);
  assert.equal(events(frames, 'chat').some((event) => event.runId === observation.runId && event.state === 'final'), false);
  const sessions = await request('sessions.list');
  assert.equal(sessions.payload.sessions[0].hasActiveRun, false);

  // The repair invokes the native queued-message retry only after this exact
  // idle proof.  A normal send here is its protocol-level observable result.
  await request('chat.send', {message: '结束事件丢了也要送达', idempotencyKey: 'queue-b'});
  await waitFor(() => window.__fake.state.deliveries.length === 1, 'stale-idle retry receipt');
  assert.equal(window.__fake.state.deliveries[0].message, '结束事件丢了也要送达');
});

test('steer-accepted persists one real user turn in the active run and reports duplicate idempotency safely', async () => {
  const window = loadFakeGateway();
  const {socket, request} = await connect(window);
  await request('connect');
  const task = window.__fake.scenario('steer-accepted', {gap: 2, holdMs: 70, uiSocket: socket});
  await waitFor(() => window.__fake.state.activeRuns.size === 1, 'active steer target');
  const first = await request('chat.send', {message: '改成用 X 方法', idempotencyKey: 'steer-c', deliver: false});
  const duplicate = await request('chat.send', {message: '改成用 X 方法', idempotencyKey: 'steer-c', deliver: false});
  assert.equal(first.payload.status, 'accepted');
  assert.equal(duplicate.payload.status, 'in_flight');
  assert.equal(window.__fake.state.deliveries.length, 1);
  assert.equal(window.__fake.state.deliveries[0].kind, 'steer');
  assert.equal(window.__fake.state.deliveries[0].runId, first.payload.runId);
  await task;
  const history = (await request('chat.history', {limit: 50})).payload.messages;
  assert.ok(history.some((message) => message.role === 'user' && textOf(message) === '改成用 X 方法'));
  assert.match(textOf(history.at(-1)), /已按追加信息调整：改成用 X 方法/);
});

test('steer-race-ended returns timeout without persisting text, then permits one ordinary fallback send', async () => {
  const window = loadFakeGateway();
  const {socket, request} = await connect(window);
  await request('connect');
  const task = window.__fake.scenario('steer-race-ended', {
    gap: 2, holdMs: 100, raceResponseDelay: 12, uiSocket: socket,
  });
  await waitFor(() => window.__fake.state.activeRuns.size === 1, 'race target');
  const race = await request('chat.send', {message: '碰撞后也别丢字', idempotencyKey: 'steer-d', deliver: false});
  assert.equal(race.payload.status, 'timeout');
  assert.equal(window.__fake.state.deliveries.length, 0);
  await task;
  const fallback = await request('chat.send', {message: '碰撞后也别丢字', idempotencyKey: 'queue-d'});
  assert.equal(fallback.payload.status, 'started');
  await waitFor(() => window.__fake.state.deliveries.length === 1, 'race fallback receipt');
  assert.equal(window.__fake.state.deliveries[0].kind, 'normal');
});

test('queue-refresh seeds stale persisted composer state across a page replacement', async () => {
  const localStorage = memoryStorage();
  const window = loadFakeGateway({localStorage});
  const observation = await window.__fake.scenario('queue-refresh', {message: '刷新后继续发'});
  assert.match(observation.beforeFix, /刷新恢复/);
  assert.equal(observation.entry.sendState, 'failed');
  assert.equal(observation.entry.pendingRunId, 'expired-run');
  assert.equal(observation.seeded.seeded, true);

  // A new fake page sees an idle server while the native composer storage is
  // unchanged.  The actual browser test reloads at this point.
  const refreshed = loadFakeGateway({localStorage});
  const {request} = await connect(refreshed);
  await request('connect');
  const sessions = await request('sessions.list');
  assert.equal(sessions.payload.sessions[0].hasActiveRun, false);
  await request('chat.send', {message: '刷新后继续发', idempotencyKey: 'queue-e'});
  await waitFor(() => refreshed.__fake.state.deliveries.length === 1, 'restored queue retry receipt');
  refreshed.__fake.clearComposerQueue();
  const key = observation.seeded.keys[0];
  const saved = localStorage.getItem(key);
  assert.ok(!saved || !JSON.parse(saved).sessions['agent:unrestricted:dashboard:harness0001\u0000agent:unrestricted']);
});

test('watchdog-append binds the extra message to the watchdog run and leaves the U+2063 control turn distinct', async () => {
  const window = loadFakeGateway();
  const {socket, request} = await connect(window);
  await request('connect');
  const task = window.__fake.scenario('watchdog-append', {
    gap: 2, watchdogDelay: 2, holdMs: 70, uiSocket: socket,
  });
  await waitFor(() => [...window.__fake.state.activeRuns].some((id) => id.startsWith('pinkie-watchdog-')), 'watchdog continuation');
  const steer = await request('chat.send', {message: '改成用 X 方法继续', idempotencyKey: 'steer-f', deliver: false});
  assert.equal(steer.payload.status, 'accepted');
  assert.match(steer.payload.runId, /^pinkie-watchdog-/);
  await task;
  const history = (await request('chat.history', {limit: 80})).payload.messages;
  assert.ok(history.some((message) => message.role === 'user' && textOf(message) === '⁣'));
  assert.ok(history.some((message) => message.role === 'user' && textOf(message) === '改成用 X 方法继续'));
  assert.match(textOf(history.at(-1)), /已按追加信息调整：改成用 X 方法继续/);
  assert.equal(window.__fake.state.deliveries.length, 1);
});
