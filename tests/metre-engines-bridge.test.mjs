import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {T3Rpc, causeMessage} from '../services/mode-architecture/engines-rpc.mjs';
import {ENGINES, EngineBridge, LEVELS, SessionEngines, authView, browserLauncher, driverOf, engineName, installView, openBrowser, openLoginTerminal, openTerminal, privateBrowser, quota, diffFiles, summarizeProjection, summarizeProviders, toItem} from '../services/mode-architecture/engines-bridge.mjs';

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
  const codex = rows.find(row => row.id === 'codex');
  assert.equal(codex.name, 'Codex');
  assert.equal(codex.plan, '');
  assert.equal(codex.signedIn, true);
  assert.equal(codex.state, 'ready');
  assert.equal(/[\w.+-]+@[\w-]+\./.test(JSON.stringify(rows)), false, 'no email');
  assert.deepEqual(codex.quota, {state: 'out', resetAt: '2026-11-27T01:44:00.000Z', text: '额度用完了', outModels: []});
  assert.deepEqual(codex.models, [{slug: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', isDefault: true}]);
});

test('every engine the engine service supports is in the menu, in a fixed order, with a plain state and its own setup steps', () => {
  const rows = summarizeProviders([
    {instanceId: 'cursor', driver: 'cursor', enabled: false, installed: false, status: 'disabled', auth: {status: 'unknown'}, setup: {canAuthenticate: true}, message: 'Cursor is disabled in T3 Code settings.'},
    {instanceId: 'kiro', driver: 'kiro', enabled: true, installed: false, status: 'error', auth: {status: 'unknown'}, message: 'Kiro CLI (`kiro-cli`) is not installed or not on PATH.'},
    {instanceId: 'claudeAgent', driver: 'claudeAgent', enabled: true, installed: true, status: 'error', auth: {status: 'unauthenticated'}, message: 'Claude Code is not authenticated. Run `claude auth login` and try again.'},
    {instanceId: 'pi', driver: 'pi', enabled: true, installed: true, status: 'ready', auth: {status: 'unknown'}},
    // 真机 11-23：刚打开时引擎服务说「装好了，账号还没查」，status 是 ready，但没登录、没有模型。
    {instanceId: 'antigravity', driver: 'antigravity', enabled: true, installed: true, status: 'ready', auth: {status: 'unknown'}, setup: {canInstall: true, canAuthenticate: true},
      message: 'Antigravity is installed. Google account access is not checked yet.', models: []},
  ], {platform: 'win32'});
  assert.deepEqual(rows.map(row => row.id), ENGINES.map(engine => engine.id));
  assert.deepEqual(ENGINES.map(engine => engine.name), ['Claude Code', 'Codex', 'Antigravity', 'Cursor', 'OpenCode', 'Grok Build', 'Kiro', 'Pi', 'fx', 'Muse Code']);
  const by = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.equal(by.cursor.state, 'off');
  assert.equal(by.cursor.setup.canAuthenticate, true);
  assert.equal(by.kiro.state, 'missing');
  assert.equal(by.claudeAgent.state, 'signin');
  assert.equal(by.pi.state, 'ready');
  assert.equal(by.antigravity.state, 'signin', 'installed but the Google account is not checked yet: not usable');
  assert.equal(by.antigravity.setup.canInstall, true);
  assert.equal(summarizeProviders([]).find(row => row.id === 'muse').state, 'off', 'never reported yet still shows up');
  assert.equal(by.cursor.guide.install, "irm 'https://cursor.com/install?win32=true' | iex");
  assert.equal(by.kiro.guide.login, 'kiro-cli login');
  assert.equal(by.grok.guide.install, '', 'no official Windows command: only the link');
  assert.match(by.grok.guide.link, /^https:\/\//);
  assert.equal(summarizeProviders([], {platform: 'darwin'}).find(row => row.id === 'grok').guide.install, 'curl -fsSL https://x.ai/cli/install.sh | bash');
  assert.equal(/T3/i.test(JSON.stringify(rows)), false, 'no engine-service brand anywhere');
});

test('an Antigravity file change (file-URL path, no line counts) shows a clean path and no fake +0 −0 (real data 11-23)', () => {
  const summary = summarizeProjection({thread: {id: 't'}, runs: [{id: 'r', ordinal: 1, status: 'completed'}], visibleTurnItems: [
    {position: 1, item: {id: 'e1', type: 'file_change', status: 'completed', title: 'Changed files', fileName: '/F:/work/scratch/hello.md'}},
    {position: 2, item: {id: 'e2', type: 'file_change', status: 'completed', fileName: 'C:\\w\\a.css', additions: 3, deletions: 1, diffStr: '@@'}},
  ]});
  assert.equal(summary.items[0].file, 'F:/work/scratch/hello.md');
  assert.equal(summary.items[0].additions, null);
  assert.deepEqual(summary.changes.map(change => [change.file, change.counted]), [['F:/work/scratch/hello.md', false], ['C:\\w\\a.css', true]]);
});

test('the file list and line counts come from the engine diff when edits were made by commands (real diff 11-23)', () => {
  const diff = 'diff --git a/hello.md b/hello.md\nindex 6527716..cee145b 100644\n--- a/hello.md\n+++ b/hello.md\n@@ -1,2 +1,3 @@\n Metre 引擎台测试\n Claude 也来过。\n+第三行\n\\ No newline at end of file\n'
    + 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n';
  assert.deepEqual(diffFiles(diff), [
    {file: 'hello.md', additions: 1, deletions: 0, edits: 1, counted: true},
    {file: 'src/a.js', additions: 1, deletions: 1, edits: 1, counted: true},
  ]);
  assert.deepEqual(diffFiles(''), []);
});

test('Metre\'s own scratch folder becomes a git repository once, so the engine service can work out diffs', () => {
  const calls = [];
  const {bridge, root} = bridgeWith(calls);
  const runs = [];
  bridge.runSync = (file, args, options) => { runs.push([file, args.filter(arg => !arg.startsWith('user.') && arg !== '-c'), options.cwd]); if (args.includes('init')) fs.mkdirSync(path.join(options.cwd, '.git')); return {status: 0}; };
  const folder = bridge.folderFor('agent:metre:nobound');
  assert.equal(folder, path.join(root, 'scratch'));
  assert.deepEqual(runs.map(run => run[1][0]), ['init', 'commit']);
  bridge.folderFor('agent:metre:nobound');
  assert.equal(runs.length, 2, 'only the first time');
});

test('quota: a whole-account bar that is full means used up; a full per-model bar only marks those models (real data 11-23)', () => {
  const codex = quota({windows: [{label: 'Session', usedPercent: 0}, {label: 'Weekly', usedPercent: 100, resetsAt: '2026-11-27T01:43:42.000Z'}]}, [{slug: 'gpt-6'}]);
  assert.deepEqual([codex.state, codex.resetAt, codex.text], ['out', '2026-11-27T01:43:42.000Z', '额度用完了']);
  const models = [{slug: 'gemini-4-argon', name: 'Gemini 4 Argon'}, {slug: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash'}, {slug: 'claude-opus-5-5', name: 'Claude Opus 5.5'}, {slug: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)'}];
  const windows = [
    {label: 'Claude & GPT (shared) · 5-hour', usedPercent: 0}, {label: 'Gemini · 5-hour', usedPercent: 0.08},
    {label: 'Claude & GPT (shared) · Weekly', usedPercent: 50.12}, {label: 'Gemini 4 Argon · Weekly', usedPercent: 100, resetsAt: '2026-11-28T11:22:29.000Z'},
    {label: 'Gemini · Weekly', usedPercent: 73.27},
  ];
  const anti = quota({windows}, models);
  assert.equal(anti.state, 'ok', 'one model group out is not the whole engine out');
  assert.deepEqual(anti.outModels, ['gemini-4-argon']);
  assert.equal(anti.text, '已用 73% · Gemini 4 Argon 用完了');
  const row = summarizeProviders([{instanceId: 'antigravity', driver: 'antigravity', enabled: true, installed: true, status: 'ready', auth: {status: 'authenticated'}, setup: {canAuthenticate: true}, usageLimits: {windows}, models}])
    .find(item => item.id === 'antigravity');
  assert.deepEqual(row.models.filter(model => model.out).map(model => model.slug), ['gemini-4-argon']);
  const allGemini = quota({windows: [{label: 'Gemini · Weekly', usedPercent: 100}, {label: 'Claude & GPT (shared) · Weekly', usedPercent: 100}]}, models);
  assert.equal(allGemini.state, 'out', 'every model group out is the whole engine out');
});

test('sign-in state keeps only web links and never asks for keys inside Metre', () => {
  const view = authView({instanceId: 'antigravity', phase: 'waiting', flowId: 'f1', authorizationUrl: 'javascript:alert(1)', expiresAt: null, message: null,
    methods: [{id: 'google', name: 'Google account', type: 'agent', accountEmail: 'a@b.co'}],
    interaction: {type: 'browser', id: 'i1', url: 'https://accounts.example/sign', requiresConsent: true, acceptsCallback: true}});
  assert.equal(view.url, '');
  assert.deepEqual(view.step, {type: 'browser', id: 'i1', url: 'https://accounts.example/sign', consent: true, paste: true});
  assert.equal(JSON.stringify(view).includes('@'), false);
  assert.deepEqual(authView({phase: 'waiting', flowId: 'f2', interaction: {type: 'credentials', id: 'c', fields: [{name: 'key', label: 'API key', secret: true}]}}).step, {type: 'credentials'});
  // 真机 11-23：Antigravity 在这台电脑上是「贴代码」登录，那个框是一次性代码。
  assert.deepEqual(authView({phase: 'waiting', flowId: 'f3', authorizationUrl: 'https://accounts.example/o', interaction: {type: 'credentials', id: 'f3', fields: [{name: 'code', label: 'Code from the Antigravity page', secret: false}]}}).step,
    {type: 'code', id: 'f3', field: 'code', paste: true});
  assert.deepEqual(installView({phase: 'downloading', downloadedBytes: 50, totalBytes: 200, version: '1.5.14', installedVersion: null, message: null}),
    {phase: 'downloading', downloaded: 50, total: 200, version: '1.5.14', installedVersion: null, message: ''});
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
  assert.deepEqual(view.changes, [{file: 'src/a.js', additions: 5, deletions: 1, edits: 2, counted: true}]);
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
    stream(tag, payload, onValue) { calls.push([tag, payload]); streams.push({tag, onValue}); return Promise.resolve({close() {}}); }
    close() {}
  }
  const streams = [];
  const bridge = new EngineBridge({service, RpcImpl: Rpc});
  bridge.streams = streams;
  return {root, bridge};
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

test('the terminal helper only runs the install and sign-in commands in the table, in a window the user sees', () => {
  const spawned = [];
  const spawnImpl = (file, args, options) => { spawned.push({file, args, options}); return {unref() {}}; };
  openLoginTerminal('claude auth login', {platform: 'win32', spawnImpl});
  openLoginTerminal('codex login', {platform: 'darwin', spawnImpl});
  openTerminal("irm 'https://cli.kiro.dev/install.ps1' | iex", {platform: 'win32', spawnImpl});
  assert.equal(spawned[0].file, 'cmd.exe');
  assert.ok(spawned[0].args.includes('cmd.exe /k claude auth login'));
  assert.equal(spawned[0].options.windowsHide, false);
  assert.equal(spawned[1].file, 'osascript');
  assert.ok(spawned[2].args.includes(`powershell.exe -NoExit -ExecutionPolicy Bypass -Command "irm 'https://cli.kiro.dev/install.ps1' | iex"`), 'PowerShell one-liners run in PowerShell');
  assert.throws(() => openLoginTerminal('claude auth login && del x', {platform: 'win32', spawnImpl}), /不认识/);
  assert.throws(() => openBrowser('file:///C:/x', {platform: 'win32', spawnImpl}), /不是网页地址/);
  openBrowser('https://accounts.example/sign?a=1&b=2', {platform: 'win32', spawnImpl, browser: null});
  assert.deepEqual(spawned.at(-1).args, ['url.dll,FileProtocolHandler', 'https://accounts.example/sign?a=1&b=2']);
  // 用户 11-23：登录开无痕窗口，不用平时的浏览器。
  const edge = privateBrowser({platform: 'win32', env: {'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\L'}, exists: file => /msedge/.test(file)});
  assert.equal(edge.flag, '--inprivate');
  assert.equal(privateBrowser({platform: 'win32', env: {LOCALAPPDATA: 'C:\\L'}, exists: file => /chrome/.test(file)}).flag, '--incognito');
  assert.equal(privateBrowser({platform: 'win32', env: {}, exists: () => false}), null);
  openBrowser('https://accounts.example/x', {platform: 'win32', spawnImpl, browser: edge});
  assert.deepEqual([spawned.at(-1).file, spawned.at(-1).args], [edge.file, ['--inprivate', 'https://accounts.example/x']]);
  const launcher = browserLauncher(tmp(), {platform: 'win32', browser: edge});
  assert.match(fs.readFileSync(launcher, 'utf8'), /start "" ".*msedge\.exe" --inprivate %1/);
  openTerminal('claude auth login', {platform: 'win32', spawnImpl, env: {BROWSER: launcher, CLAUDE_CONFIG_DIR: 'C:\\Users\\a\\.claude-metre-2'}});
  assert.equal(spawned.at(-1).options.env.BROWSER, launcher);
  assert.equal(spawned.at(-1).options.env.CLAUDE_CONFIG_DIR, 'C:\\Users\\a\\.claude-metre-2');
  assert.throws(() => openTerminal('claude auth login', {platform: 'win32', spawnImpl, env: {BROWSER: 'C:\\evil.cmd'}}), /启动器/);
  assert.throws(() => openTerminal('claude auth login', {platform: 'win32', spawnImpl, env: {PATH: 'C:\\x'}}), /不认识/);
  openTerminal('claude auth login', {platform: 'darwin', spawnImpl, env: {CLAUDE_CONFIG_DIR: '/Users/a/.claude-metre-2'}});
  assert.match(spawned.at(-1).args[1], /CLAUDE_CONFIG_DIR='\/Users\/a\/\.claude-metre-2' claude auth login/, 'Terminal.app does not inherit env');
  // 路径是不是绝对路径按目标平台判断，不按跑测试 / 跑网关的这台机器（CI 的 Linux 上 C:\ 也要认，Mac 上 C:\ 不认）。
  assert.throws(() => openTerminal('claude auth login', {platform: 'darwin', spawnImpl, env: {CLAUDE_CONFIG_DIR: 'C:\\Users\\a\\.claude-metre-2'}}), /不认识/);
});

test('several accounts per engine: each one is its own instance with its own login', async () => {
  const rows = summarizeProviders([
    {instanceId: 'antigravity-2', driver: 'antigravity', displayName: 'Antigravity · 工作号', enabled: true, installed: true, status: 'ready', auth: {status: 'authenticated', label: 'Google account'}, setup: {canAuthenticate: true}, models: [{slug: 'g'}]},
    {instanceId: 'antigravity', driver: 'antigravity', enabled: true, installed: true, status: 'ready', auth: {status: 'authenticated', label: 'Google account'}, setup: {canAuthenticate: true}, models: [{slug: 'g'}]},
    {instanceId: 'claudeAgent-3', driver: 'claudeAgent', displayName: 'Claude Code · me@x.com', enabled: true, installed: true, status: 'error', auth: {status: 'unauthenticated'}},
  ]);
  const ids = rows.map(row => row.id);
  assert.ok(ids.indexOf('antigravity') < ids.indexOf('antigravity-2'), 'the default account first, then the added ones');
  const work = rows.find(row => row.id === 'antigravity-2');
  assert.deepEqual([work.name, work.account, work.multi, work.state], ['Antigravity · 工作号', true, true, 'ready']);
  assert.equal(rows.find(row => row.id === 'claudeAgent-3').name.includes('@'), false, 'an email typed as a name never shows');
  assert.equal(rows.find(row => row.id === 'kiro').multi, false, 'engines that share one machine login cannot add accounts');
  assert.equal(engineName('claudeAgent-2'), 'Claude Code · 账号 2');
  assert.deepEqual([driverOf('antigravity'), driverOf('antigravity-12'), driverOf('rm -rf')], ['antigravity', 'antigravity', '']);

  const calls = [];
  const home = tmp();
  const spawned = [];
  let instances = {claudeAgent: {driver: 'claudeAgent'}};
  const {bridge} = bridgeWith(calls, {
    'server.getConfig': () => ({providers: [], settings: {providerInstances: instances}}),
    'server.updateSettings': payload => { const m = payload.providerInstanceMutation; if (m.operation === 'remove') delete instances[m.instanceId]; else instances = {...instances, [m.instanceId]: m.instance}; return {}; },
    'server.refreshProviders': {}, 'provider.auth.logout': {},
  });
  bridge.homeDir = home;
  bridge.spawnImpl = (file, args, options) => { spawned.push({file, args, options}); return {unref() {}}; };
  const added = await bridge.addAccount({driver: 'claudeAgent', name: '  个人号 '});
  assert.equal(added.engine, 'claudeAgent-2');
  const create = calls.find(call => call[0] === 'server.updateSettings')[1].providerInstanceMutation;
  assert.deepEqual(create, {operation: 'create', instanceId: 'claudeAgent-2', instance: {driver: 'claudeAgent', displayName: 'Claude Code · 个人号', enabled: true, config: {homePath: path.join(home, '.claude-metre-2')}}});
  assert.ok(fs.existsSync(path.join(home, '.claude-metre-2')), 'the account gets its own login folder');
  const third = await bridge.addAccount({driver: 'claudeAgent'});
  assert.equal(third.engine, 'claudeAgent-3');

  const login = await bridge.signin({engine: 'claudeAgent-2', open: true});
  assert.equal(login.how, 'terminal');
  assert.match(login.command, /CLAUDE_CONFIG_DIR.*claude-metre-2.*claude auth login/);
  assert.equal(spawned.at(-1).options.env.CLAUDE_CONFIG_DIR, path.join(home, '.claude-metre-2'), 'logs in to its own folder only');

  await bridge.renameAccount({engine: 'claudeAgent-2', name: '主力'});
  assert.equal(instances['claudeAgent-2'].displayName, 'Claude Code · 主力');
  await assert.rejects(bridge.removeAccount({engine: 'claudeAgent'}), /默认账号不能删/);
  await bridge.removeAccount({engine: 'claudeAgent-3'});
  assert.equal(instances['claudeAgent-3'], undefined);
  assert.ok(fs.existsSync(path.join(home, '.claude-metre-3')), 'the login folder stays on disk');
  await assert.rejects(bridge.addAccount({driver: 'kiro'}), /同一份登录/);
  await assert.rejects(bridge.signin({engine: 'claudeAgent-9', open: true}), /删掉/);
});

test('turning an engine on keeps its saved settings, and managed sign-in follows the engine service step by step', async () => {
  const calls = [];
  const spawned = [];
  const {bridge} = bridgeWith(calls, {
    'server.getConfig': {providers: [], settings: {providerInstances: {cursor: {driver: 'cursor', displayName: 'Work', config: {binaryPath: 'x'}}}}},
    'server.updateSettings': {},
    'server.refreshProviders': {},
    'provider.auth.start': {instanceId: 'cursor', phase: 'waiting', flowId: 'f1', authorizationUrl: null, expiresAt: null, message: null,
      interaction: {type: 'browser', id: 'i1', url: 'https://cursor.example/login', requiresConsent: true}},
    'provider.auth.respond': {phase: 'waiting', flowId: 'f1'},
    'provider.auth.complete': {phase: 'verifying', flowId: 'f1'},
  });
  bridge.spawnImpl = (file, args) => { spawned.push({file, args}); return {unref() {}}; };
  await bridge.turnOn({engine: 'cursor'});
  const update = calls.find(call => call[0] === 'server.updateSettings')[1];
  assert.deepEqual(update.providerInstanceMutation, {operation: 'upsert', instanceId: 'cursor', instance: {driver: 'cursor', displayName: 'Work', config: {binaryPath: 'x'}, enabled: true}});
  assert.deepEqual(calls.find(call => call[0] === 'server.refreshProviders')[1], {instanceId: 'cursor'});
  await assert.rejects(bridge.turnOn({engine: 'rm'}), /不认识/);

  const started = await bridge.signin({engine: 'cursor', open: true});
  assert.equal(started.how, 'managed');
  assert.ok(calls.some(call => call[0] === 'provider.auth.subscribe'), 'the sign-in is watched');
  bridge.streams.at(-1).onValue({instanceId: 'cursor', phase: 'waiting', flowId: 'f1', interaction: {type: 'browser', id: 'i1', url: 'https://cursor.example/login', requiresConsent: true}});
  await bridge.signinStep({engine: 'cursor', action: 'open'});
  assert.deepEqual(calls.find(call => call[0] === 'provider.auth.respond')[1], {instanceId: 'cursor', flowId: 'f1', interactionId: 'i1', response: {type: 'browser', action: 'accept'}});
  assert.equal(spawned.at(-1).args.at(-1), 'https://cursor.example/login');
  await bridge.signinStep({engine: 'cursor', action: 'paste', code: '  4/abc  '});
  assert.deepEqual(calls.find(call => call[0] === 'provider.auth.complete')[1], {instanceId: 'cursor', flowId: 'f1', callbackUrl: '4/abc'});
  bridge.streams.at(-1).onValue({instanceId: 'cursor', phase: 'succeeded', flowId: 'f1'});
  assert.equal(bridge.setupState({engine: 'cursor'}).auth.phase, 'succeeded');
  assert.equal(calls.filter(call => call[0] === 'server.refreshProviders').length, 2, 'a finished sign-in makes the engine service check again');

  // Antigravity 的贴代码登录：代码填进引擎服务给的 code 框（respond），不是 complete。
  calls.length = 0;
  bridge.watches.set('auth:antigravity', {open: false, state: {phase: 'waiting', flowId: 'f9', authorizationUrl: 'https://accounts.example/o',
    interaction: {type: 'credentials', id: 'f9', fields: [{name: 'code', label: 'Code', secret: false}]}}});
  await bridge.signinStep({engine: 'antigravity', action: 'paste', code: ' 4/xyz '});
  assert.deepEqual(calls.find(call => call[0] === 'provider.auth.respond')[1],
    {instanceId: 'antigravity', flowId: 'f9', interactionId: 'f9', response: {type: 'credentials', values: {code: '4/xyz'}}});
  assert.equal(calls.some(call => call[0] === 'provider.auth.complete'), false);

  const terminal = await bridge.signin({engine: 'kiro', open: true});
  assert.deepEqual([terminal.how, terminal.command], ['terminal', 'kiro-cli login']);
  const install = await bridge.install({engine: 'pi'});
  assert.deepEqual([install.how, install.opened], ['terminal', false], 'nothing runs until the user clicks');
});
