const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// scripts/chat-ui-harness replays gateway traffic into the real chat UI.
// Pin the protocol shapes it relies on, so a stale fake cannot make a broken
// chat view look healthy.

function loadFakeGateway() {
  const window = {};
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
