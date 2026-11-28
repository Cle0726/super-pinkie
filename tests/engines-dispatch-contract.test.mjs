// L127：services/mode-architecture/engines-dispatch.mjs 的边界契约单测。
// 覆盖四块：非法会话令牌拒绝、并发上限门禁（listen() 并发竞态）、子任务超时取消（停子会话时的看门狗/abort 顺序）、异常退出清理。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EngineDispatch, readToken, signToken, TOKEN_TTL_MS} from '../services/mode-architecture/engines-dispatch.mjs';

const NONCE = '0123456789abcdef0123456789abcdef';

function freshDispatch(overrides = {}) {
  return new EngineDispatch({bridge: {}, lineage: {}, isEnabled: () => true, ...overrides});
}

// ---- 非法会话令牌拒绝 ----

test('readToken: expiry is boundary-exclusive — exp === now is already expired, exp === now-1 is still good', () => {
  const seed = Buffer.alloc(32, 3);
  const token = signToken(seed, NONCE, 10_000);
  assert.match(readToken(seed, token, 10_000).error, /过期/);
  assert.equal(readToken(seed, token, 9_999).ok, true);
});

test('readToken: a forged signature of the same length is still rejected byte-for-byte, not just by length', () => {
  const seed = Buffer.alloc(32, 4);
  const token = signToken(seed, NONCE, 20_000);
  const [id, exp, mac] = token.split('.');
  const flipped = (mac[0] === 'a' ? 'b' : 'a') + mac.slice(1);
  assert.equal(flipped.length, mac.length, 'the forged mac keeps the exact same length as the real one');
  assert.equal(readToken(seed, `${id}.${exp}.${flipped}`, 1000).ok, false);
});

test('HTTP auth header: wrong scheme, wrong case, or a missing separator are all treated as "no token" (401)', async t => {
  const dispatch = freshDispatch({bridge: {sessions: {all: () => ({})}}, lineage: {lineage: () => ({})}});
  t.after(() => dispatch.close());
  const port = await dispatch.listen();
  const token = signToken(dispatch.seed, NONCE, Date.now() + TOKEN_TTL_MS);
  const send = async headers => (await fetch(`http://127.0.0.1:${port}/dispatch`, {
    method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: '{"action":"list"}',
  })).status;
  assert.equal(await send({authorization: `Token ${token}`}), 401, 'wrong scheme');
  assert.equal(await send({authorization: `bearer ${token}`}), 401, 'lowercase scheme is not accepted (case-sensitive by design)');
  assert.equal(await send({authorization: `Bearer${token}`}), 401, 'missing the separating space');
  assert.equal(await send({}), 401, 'no header at all');
});

// ---- 并发上限门禁（listen() 并发竞态；两次并发 listen() 会各自起一个 HTTP 服务，后起的那个覆盖 this.server，先起的那个永远没人 close） ----

test('listen(): concurrent calls share one in-flight bind instead of racing two HTTP servers', async t => {
  const dispatch = freshDispatch();
  t.after(() => dispatch.close());
  let created = 0;
  const original = http.createServer;
  http.createServer = (...args) => { created += 1; return original(...args); };
  try {
    const [a, b] = await Promise.all([dispatch.listen(), dispatch.listen()]);
    assert.equal(a, b, 'both concurrent calls resolve to the same port');
    assert.equal(dispatch.port, a);
    assert.equal(created, 1, 'exactly one HTTP server is created even when listen() is called concurrently');
  } finally {
    http.createServer = original;
  }
});

test('listen(): three-way concurrency still yields exactly one server and one port', async t => {
  const dispatch = freshDispatch();
  t.after(() => dispatch.close());
  let created = 0;
  const original = http.createServer;
  http.createServer = (...args) => { created += 1; return original(...args); };
  try {
    const ports = await Promise.all([dispatch.listen(), dispatch.listen(), dispatch.listen()]);
    assert.equal(new Set(ports).size, 1, 'all callers agree on the same port');
    assert.equal(created, 1);
  } finally {
    http.createServer = original;
  }
});

test('listen(): a synchronous refusal (engine switch off) does not leave the gate stuck for the next attempt', async t => {
  let enabled = false;
  const dispatch = freshDispatch({isEnabled: () => enabled});
  t.after(() => dispatch.close());
  await assert.rejects(dispatch.listen(), /没有打开/);
  enabled = true;
  const port = await dispatch.listen();
  assert.ok(port > 0);
});

// ---- 子任务超时取消（stopChild：先取消看门狗再 abort，看门狗失败不挡住 abort；abort 没停下要报错；外部子活要补一次 kick） ----

test('stopChild cancels the watchdog before chat.abort, and a watchdog failure does not block the abort', async () => {
  const calls = [];
  const lineage = {
    lineage: () => ({'child-1': {parentKey: 'brain-1'}}),
    access: {rpc: async (name, params, opts) => {
      calls.push({name, params, opts});
      if (name === 'pinkie.watchdog.cancel') throw new Error('watchdog 已经不在了');
      return {ok: true};
    }},
  };
  const dispatch = freshDispatch({lineage});
  const result = await dispatch.stopChild('brain-1', 'child-1');
  assert.deepEqual(result, {target: 'child-1', message: '已经叫它停下'});
  assert.deepEqual(calls.map(call => call.name), ['pinkie.watchdog.cancel', 'chat.abort'], 'watchdog is cancelled first, then abort runs regardless');
  assert.deepEqual(calls[0].params, {sessionKey: 'child-1'});
  assert.deepEqual(calls[1].params, {sessionKey: 'child-1', agentId: 'metre', preserveSideRuns: false});
  assert.deepEqual(calls[1].opts, {admin: true});
});

test('stopChild surfaces a retry message when chat.abort reports it did not stop', async () => {
  const lineage = {
    lineage: () => ({'child-1': {parentKey: 'brain-1'}}),
    access: {rpc: async name => (name === 'chat.abort' ? {ok: false} : {ok: true})},
  };
  const dispatch = freshDispatch({lineage});
  await assert.rejects(dispatch.stopChild('brain-1', 'child-1'), /没停下，请再试一次/);
});

test("stopChild tells an external child's engine thread to stop and schedules a follow-up kick", async () => {
  const bridgeCalls = [];
  const kicks = [];
  const lineage = {lineage: () => ({'ext-1': {parentKey: 'brain-1', kind: 'external', threadId: 'thread-ext'}})};
  const bridge = {stop: async params => { bridgeCalls.push(params); return {status: 'stopped'}; }};
  const tasks = {kick: ms => kicks.push(ms)};
  const dispatch = freshDispatch({bridge, lineage, tasks});
  const result = await dispatch.stopChild('brain-1', 'ext-1');
  assert.deepEqual(result, {target: 'ext-1', message: '已经叫它停下'});
  assert.deepEqual(bridgeCalls, [{threadId: 'thread-ext'}]);
  assert.deepEqual(kicks, [1000]);
});

// ---- 异常退出清理（close() 要能反复调用；stopFamily 按子会话构成决定要不要真走 Metre 的 stopAll） ----

test('close() is idempotent and safe even if the server was never started', () => {
  const dispatch = freshDispatch();
  assert.doesNotThrow(() => dispatch.close());
  assert.equal(dispatch.server, null);
  assert.equal(dispatch.port, 0);
});

test('close() after listen() tears the server down, and a second close() stays a harmless no-op', async () => {
  const dispatch = freshDispatch();
  await dispatch.listen();
  assert.ok(dispatch.server);
  dispatch.close();
  assert.equal(dispatch.server, null);
  assert.equal(dispatch.port, 0);
  assert.doesNotThrow(() => dispatch.close());
  assert.equal(dispatch.server, null);
});

test("stopFamily with no children is a cheap no-op that never calls Metre's own stopAll", async () => {
  const stopAllCalls = [];
  const lineage = {lineage: () => ({}), stopAll: async key => { stopAllCalls.push(key); return {ok: true}; }};
  const dispatch = freshDispatch({lineage});
  const result = await dispatch.stopFamily('brain-1');
  assert.deepEqual(result, {ok: true, stopped: 0});
  assert.deepEqual(stopAllCalls, []);
});

test("stopFamily with only external children stops their threads and clears busyKeys, but still skips Metre's stopAll", async () => {
  const stopAllCalls = [];
  const bridgeCalls = [];
  const busyKeys = new Set(['ext-1', 'ext-2']);
  const lineage = {
    lineage: () => ({
      'ext-1': {parentKey: 'brain-1', kind: 'external', threadId: 'thread-1'},
      'ext-2': {parentKey: 'brain-1', kind: 'external', threadId: 'thread-2'},
      'other-brain-child': {parentKey: 'brain-2', kind: 'external', threadId: 'thread-x'},
    }),
    stopAll: async key => { stopAllCalls.push(key); return {ok: true}; },
  };
  const bridge = {stop: async params => { bridgeCalls.push(params); return {status: 'stopped'}; }};
  const tasks = {busyKeys};
  const dispatch = freshDispatch({bridge, lineage, tasks});
  const result = await dispatch.stopFamily('brain-1');
  assert.deepEqual(result, {ok: true, stopped: 2});
  assert.deepEqual(bridgeCalls.map(call => call.threadId).sort(), ['thread-1', 'thread-2']);
  assert.deepEqual([...busyKeys], []);
  assert.deepEqual(stopAllCalls, []);
});
