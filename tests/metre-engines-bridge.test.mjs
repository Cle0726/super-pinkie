import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {T3Rpc, causeMessage} from '../services/mode-architecture/engines-rpc.mjs';
import {EngineBridge, LEVELS, SessionEngines, openLoginTerminal, summarizeProjection, summarizeProviders, toItem} from '../services/mode-architecture/engines-bridge.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-bridge-'));

// A WebSocket stand-in that answers like T3's Effect-RPC endpoint.
function fakeSocketClass(handler, seen = []) {
  return class FakeSocket {
    constructor(url, init) {
      this.url = url; this.init = init; this.readyState = 0;
      seen.push(this);
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    send(text) {
      const message = JSON.parse(text);
      (this.sent ||= []).push(message);
      const reply = handler(message, this);
      for (const out of [].concat(reply || [])) setTimeout(() => this.onmessage?.({data: JSON.stringify(out)}), 0);
    }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.({code: 1000}), 0); }
  };
}

test('the RPC client sends Effect-RPC requests with a bearer header and resolves Exit values', async () => {
  const seen = [];
  const Socket = fakeSocketClass(message => message._tag === 'Request'
    ? {_tag: 'Exit', requestId: message.id, exit: {_tag: 'Success', value: {echo: message.tag, payload: message.payload}}} : null, seen);
  const rpc = new T3Rpc({url: 'http://127.0.0.1:3790', token: async () => 'tok-123', WebSocketImpl: Socket});
  const value = await rpc.request('server.getConfig', {a: 1});
  assert.deepEqual(value, {echo: 'server.getConfig', payload: {a: 1}});
  assert.equal(seen[0].url, 'ws://127.0.0.1:3790/ws?orchestrationProtocol=2');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok-123');
  assert.deepEqual(seen[0].sent[0], {_tag: 'Request', id: '1', tag: 'server.getConfig', payload: {a: 1}, headers: []});
  rpc.close();
});

test('failures carry the server sentence, streams are acked, and a dropped socket rejects pending calls', async () => {
  const Socket = fakeSocketClass(message => {
    if (message._tag !== 'Request') return null;
    if (message.tag === 'bad') return {_tag: 'Exit', requestId: message.id, exit: {_tag: 'Failure', cause: {_tag: 'Fail', error: {_tag: 'X', message: 'Thread not found'}}}};
    if (message.tag === 'shell') return [{_tag: 'Chunk', requestId: message.id, values: [{kind: 'snapshot', n: 1}, {kind: 'upsert', n: 2}]}];
    return null;
  });
  const rpc = new T3Rpc({url: 'http://127.0.0.1:1', token: 't', WebSocketImpl: Socket});
  await assert.rejects(rpc.request('bad'), /Thread not found/);
  assert.deepEqual(await rpc.first('shell', {}), {kind: 'snapshot', n: 1});
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(rpc.socket.sent.some(m => m._tag === 'Ack'), 'chunks are acknowledged');
  assert.ok(rpc.socket.sent.some(m => m._tag === 'Interrupt'), 'first() stops the stream');
  const hanging = rpc.request('never');
  await new Promise(resolve => setTimeout(resolve, 5));
  rpc.socket.onclose({code: 1006});
  await assert.rejects(hanging, /连接断了/);
  assert.equal(causeMessage({_tag: 'Sequential', left: {_tag: 'Empty'}, right: {_tag: 'Die', defect: {message: 'boom'}}}), 'boom');
});

test('provider rows keep status, plan and models but never an email', () => {
  const rows = summarizeProviders([{instanceId: 'codex', driver: 'codex', displayName: 'Codex', enabled: true, installed: true, version: '0.171.0',
    status: 'ready', auth: {status: 'authenticated', label: 'someone@example.com'}, message: 'Signed in as someone@example.com',
    usageLimits: {checkedAt: 'x', windows: [{id: 'w', kind: 'weekly', label: 'Weekly', usedPercent: 100, resetsAt: '2026-11-27T01:44:00.000Z'}]},
    models: [{slug: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', isDefault: true}]}]);
  assert.equal(rows[0].name, 'Codex');
  assert.equal(rows[0].plan, '');
  assert.equal(rows[0].signedIn, true);
  assert.equal(JSON.stringify(rows).includes('@'), false);
  assert.deepEqual(rows[0].quota, {state: 'out', resetAt: '2026-11-27T01:44:00.000Z', text: '额度用完了'});
  assert.deepEqual(rows[0].models, [{slug: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', isDefault: true}]);
});

const projection = () => ({
  thread: {id: 't1', title: 'Fix login', modelSelection: {instanceId: 'claudeAgent', model: 'claude-opus-5-5'}, runtimeMode: 'approval-required', interactionMode: 'default', branch: 'main'},
  runs: [{id: 'r1', ordinal: 1, status: 'completed'}, {id: 'r2', ordinal: 2, status: 'running'}],
  runtimeRequests: [{id: 'req1', status: 'pending'}, {id: 'req0', status: 'resolved'}],
  checkpoints: [{ordinalWithinScope: 1}, {ordinalWithinScope: 2}],
  turnItems: [
    {id: 'i3', ordinal: 3, type: 'command_execution', status: 'completed', input: 'npm test', output: 'ok', exitCode: 1},
    {id: 'i1', ordinal: 1, type: 'user_message', status: 'completed', text: 'fix it'},
    {id: 'i2', ordinal: 2, type: 'reasoning', status: 'completed', text: 'thinking', streaming: false},
    {id: 'i4', ordinal: 4, type: 'file_change', status: 'completed', fileName: 'src/a.js', additions: 3, deletions: 1, diffStr: '@@ -1 +1 @@'},
    {id: 'i5', ordinal: 5, type: 'file_change', status: 'completed', fileName: 'src/a.js', additions: 2, deletions: 0},
    {id: 'i6', ordinal: 6, type: 'approval_request', status: 'pending', requestId: 'req1', requestKind: 'command', prompt: 'rm -rf build',
      options: [{decision: 'accept', label: 'Yes'}, {decision: 'decline', label: 'No'}]},
    {id: 'i7', ordinal: 7, type: 'approval_request', status: 'completed', requestId: 'req0', requestKind: 'command', prompt: 'ls'},
    {id: 'i8', ordinal: 8, type: 'secret_request', status: 'completed'},
    {id: 'i9', ordinal: 9, type: 'todo_list', status: 'completed', planId: 'p', steps: [{id: 's', text: 'Write test', status: 'running'}]},
  ],
});

test('a projection becomes Metre rows in order, with open requests, per-file totals and the run state', () => {
  const view = summarizeProjection(projection());
  assert.deepEqual(view.items.map(item => item.kind), ['you', 'thinking', 'command', 'edit', 'edit', 'approval', 'approval', 'todo']);
  assert.equal(view.status, 'waiting', 'an open approval means it waits for you');
  assert.equal(view.activeRunId, 'r2');
  assert.deepEqual(view.pending, [{requestId: 'req1', kind: 'approval'}]);
  assert.equal(view.items.find(item => item.requestId === 'req0').open, false);
  assert.equal(view.items[2].failed, true);
  assert.deepEqual(view.changes, [{file: 'src/a.js', additions: 5, deletions: 1, edits: 2}]);
  assert.equal(view.turnCount, 2);
  assert.equal(view.thread.engineName, 'Claude Code');
  assert.equal(view.thread.level, 'approval-required');
});

test('quota and sign-in failures are said plainly, not as program errors', () => {
  const quota = toItem({id: 'e', type: 'error', status: 'completed', failure: {class: 'usage_limit', message: 'You’ve hit your usage limit', code: null, retryable: false, resetAt: '2026-11-27T01:44:00.000Z'}});
  assert.equal(quota.text, '额度用完了，2026-11-27T01:44:00.000Z 恢复');
  const auth = toItem({id: 'e', type: 'error', status: 'completed', failure: {class: 'provider_error', message: 'Claude could not authenticate. Run `claude auth login`', code: null}});
  assert.match(auth.text, /^还没登录/);
  const failed = summarizeProjection({thread: {id: 't'}, runs: [{id: 'r', ordinal: 1, status: 'failed'}], turnItems: [{id: 'e', ordinal: 1, ...{type: 'error', failure: {class: 'usage_limit', message: 'x'}}}]});
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.failureClass, 'usage_limit');
});

test('session engine choices persist per Metre session and can be found by thread', () => {
  const file = path.join(tmp(), 'sessions.json');
  const store = new SessionEngines(file);
  store.set('agent:metre:a', {engine: 'codex', model: 'gpt-5.6-luna'});
  store.set('agent:metre:a', {threadId: 't9'});
  assert.equal(new SessionEngines(file).get('agent:metre:a').engine, 'codex');
  assert.equal(store.byThread('t9').sessionKey, 'agent:metre:a');
  assert.deepEqual(LEVELS.map(level => level.id), ['full-access', 'auto', 'auto-accept-edits', 'approval-required']);
});

function bridgeWith(calls, answers = {}) {
  const root = tmp();
  const service = {root, home: path.join(root, 'home'), status: () => ({running: true, url: 'http://127.0.0.1:3790', port: 3790}),
    cli: async args => { calls.push(['cli', ...args]); return args[0] === 'auth' ? {text: 'x'.repeat(40)} : {ok: true}; },
    addProject: async folder => { calls.push(['addProject', folder]); return {ok: true}; }};
  class Rpc {
    request(tag, payload) { calls.push([tag, payload]); return Promise.resolve(typeof answers[tag] === 'function' ? answers[tag](payload) : answers[tag]); }
    first(tag) { calls.push([tag]); return Promise.resolve(answers[tag]); }
    close() {}
  }
  return {root, bridge: new EngineBridge({service, RpcImpl: Rpc})};
}

test('starting, sending, answering and stopping become the same commands the T3 page sends', async () => {
  const calls = [];
  const folder = tmp();
  let running = false;
  const {bridge} = bridgeWith(calls, {
    'orchestration.subscribeShell': {snapshot: {projects: [{id: 'p1', workspaceRoot: folder}]}},
    'orchestration.launchThread': {threadId: 't1'},
    'orchestration.getThreadProjection': () => ({thread: {id: 't1'}, runs: [{id: 'r1', ordinal: 1, status: running ? 'running' : 'completed'}], turnItems: []}),
    'orchestration.dispatchCommand': {sequence: 1},
  });
  const started = await bridge.start({folder, engine: 'claudeAgent', model: 'claude-opus-5-5', text: 'Fix the login page\nplease', level: 'auto'});
  assert.equal(started.threadId, 't1');
  const launch = calls.find(call => call[0] === 'orchestration.launchThread')[1];
  assert.equal(launch.projectId, 'p1');
  assert.equal(launch.title, 'Fix the login page');
  assert.deepEqual(launch.modelSelection, {instanceId: 'claudeAgent', model: 'claude-opus-5-5'});
  assert.equal(launch.runtimeMode, 'auto');
  assert.deepEqual(launch.workspaceStrategy, {type: 'root'});
  assert.deepEqual(launch.initialMessage, {text: 'Fix the login page\nplease', attachments: []});
  assert.match(launch.commandId, /^command:metre-/);

  await bridge.send({threadId: 't1', text: 'also the logout'});
  running = true;
  await bridge.send({threadId: 't1', text: 'wait, use the old API', mode: 'steer'});
  await bridge.send({threadId: 't1', text: 'then the docs'});
  const sends = calls.filter(call => call[0] === 'orchestration.dispatchCommand' && call[1].type === 'message.dispatch').map(call => call[1].dispatchMode);
  assert.deepEqual(sends, [{type: 'start_immediately'}, {type: 'steer_active', targetRunId: 'r1'}, {type: 'queue_after_active'}]);

  await bridge.respond({threadId: 't1', requestId: 'req1', decision: 'accept'});
  await bridge.stop({threadId: 't1'});
  await bridge.configure({threadId: 't1', level: 'full-access'});
  await assert.rejects(bridge.respond({threadId: 't1', requestId: 'req1'}), /批准、拒绝/);
  const types = calls.filter(call => call[0] === 'orchestration.dispatchCommand').map(call => call[1].type);
  assert.deepEqual(types.slice(-3), ['runtime-request.respond', 'thread.stop', 'thread.runtime-mode.set']);
  assert.ok(calls.filter(call => call[0] === 'addProject').length === 1, 'the project id is remembered');
});

test('the login helper only runs the known sign-in commands, in a terminal the user sees', () => {
  const spawned = [];
  const spawnImpl = (file, args, options) => { spawned.push({file, args, options}); return {unref() {}}; };
  openLoginTerminal('claude auth login', {platform: 'win32', spawnImpl});
  openLoginTerminal('codex login', {platform: 'darwin', spawnImpl});
  assert.equal(spawned[0].file, 'cmd.exe');
  assert.ok(spawned[0].args.includes('claude auth login'));
  assert.equal(spawned[0].options.windowsHide, false);
  assert.equal(spawned[1].file, 'osascript');
  assert.throws(() => openLoginTerminal('claude auth login && del x', {platform: 'win32', spawnImpl}), /不认识/);
});
