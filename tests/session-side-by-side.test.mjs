import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {BUSY, variantsOf} from '../services/mode-architecture/session-branch.mjs';
import {REVIEW_TOOLS} from '../services/mode-architecture/reasoning.mjs';
import {COMPARING, LOST, READ_ONLY, SAME_MODEL, TOOLS_UNAVAILABLE, SideBySide, isSideKey, kernelToolsAllow,
  registerSessionSideBySide, sideToolGuard, usageOf, validateModels}
  from '../services/mode-architecture/session-side-by-side.mjs';

const PARENT = 'agent:main:dashboard:p1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const msg = (id, parentId, role, text) => ({type: 'message', id, parentId, message: {role, content: [{type: 'text', text}]}});
const textOf = entry => (entry.message.content || []).map(part => part.text || '').join('');

// OpenClaw SessionManager 的替身：jsonl 第一行是会话头，叶指针存在旁边的 .leaf 文件里。
class FakeSessionManager {
  static open(file) { return new FakeSessionManager(file); }
  constructor(file) {
    this.file = file;
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    this.header = rows[0]?.type === 'session' ? rows.shift() : null;
    this.entries = rows;
    const leafFile = file + '.leaf';
    this.leaf = fs.existsSync(leafFile) ? JSON.parse(fs.readFileSync(leafFile, 'utf8')) : this.entries.at(-1)?.id ?? null;
  }
  getHeader() { return this.header; }
  getEntries() { return this.entries; }
  getEntry(id) { return this.entries.find(entry => entry.id === id); }
  getLeafId() { return this.leaf; }
  getBranch(from = this.leaf) {
    const out = [];
    for (let id = from; id;) { const entry = this.getEntry(id); out.unshift(entry); id = entry.parentId; }
    return out;
  }
  branch(id) { if (!this.getEntry(id)) throw new Error('missing'); this.leaf = id; }
  resetLeaf() { this.leaf = null; }
  appendMessage(message) {
    const id = 'e' + randomUUID().slice(0, 8);
    this.entries.push({type: 'message', id, parentId: this.leaf, message});
    this.leaf = id;
    return id;
  }
  rewriteFile() {
    fs.writeFileSync(this.file, [this.header, ...this.entries].filter(Boolean).map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.writeFileSync(this.file + '.leaf', JSON.stringify(this.leaf));
  }
  createBranchedSession(leafId) {
    const target = this.file + '.branch-' + randomUUID();
    fs.writeFileSync(target, [{type: 'session', id: 'copy'}, ...this.getBranch(leafId)].map(row => JSON.stringify(row)).join('\n') + '\n');
    return target;
  }
}

const parentTree = [
  {type: 'session', id: 'p'},
  msg('u1', null, 'user', '第一问'), msg('a1', 'u1', 'assistant', '第一答'),
  msg('u2', 'a1', 'user', '第二问'), msg('a2', 'u2', 'assistant', '第二答'),
];

// 假网关：sessions.create 建会话文件；chat.send 立刻在临时会话里写下用户题和「模型名 答：题」；
// agent.wait 按 waits 表决定每一边的结局。不起真网关，不调上游模型。
function fixture(t, {busy = false, toolsAllow = true, waits = {}, usage = {}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-sbs-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const sessionsDir = path.join(dir, 'sessions');
  fs.mkdirSync(sessionsDir);
  const parentFile = path.join(sessionsDir, 'p.jsonl');
  fs.writeFileSync(parentFile, parentTree.map(row => JSON.stringify(row)).join('\n') + '\n');
  const entries = new Map([[PARENT, {key: PARENT, sessionId: 'p', transcript: parentFile}]]);
  const calls = [], runs = new Map(), aborted = new Set();
  const access = {
    entry: async key => entries.get(key) || null,
    sdk: async name => name === 'agent-sessions' ? {SessionManager: FakeSessionManager}
      : {acquireSessionWriteLock: async () => ({release: async () => {}})},
    rpc: async (method, params) => {
      calls.push([method, params]);
      if (method === 'sessions.list') {
        return {sessions: [{key: PARENT, hasActiveRun: busy, inputTokens: 90000, outputTokens: 9000, totalTokens: 99000},
          ...[...entries.keys()].filter(isSideKey).map(key => ({key, ...(usage[key.endsWith('-left') ? 'left' : 'right'] || {})}))]};
      }
      if (method === 'sessions.create') {
        const sessionId = 's-' + randomUUID().slice(0, 8);
        const transcript = path.join(sessionsDir, sessionId + '.jsonl');
        fs.writeFileSync(transcript, JSON.stringify({type: 'session', id: sessionId}) + '\n');
        entries.set(params.key, {key: params.key, sessionId, transcript, model: params.model});
        return {key: params.key, sessionId};
      }
      if (method === 'chat.send') {
        const entry = entries.get(params.sessionKey);
        const session = FakeSessionManager.open(entry.transcript);
        session.appendMessage({role: 'user', content: [{type: 'text', text: params.message}]});
        session.appendMessage({role: 'assistant', content: [{type: 'text', text: `${entry.model} 答：${params.message}`}]});
        session.rewriteFile();
        const runId = 'run-' + (params.sessionKey.endsWith('-left') ? 'left' : 'right');
        runs.set(runId, params.sessionKey);
        return {runId};
      }
      if (method === 'agent.wait') {
        const side = params.runId.endsWith('left') ? 'left' : 'right';
        if (aborted.has(runs.get(params.runId))) return {status: 'aborted'};
        const outcome = waits[side] || {status: 'ok'};
        if (outcome.status === 'timeout') await sleep(5);
        return outcome;
      }
      if (method === 'chat.abort') { aborted.add(params.sessionKey); return {ok: true}; }
      if (method === 'sessions.delete') { entries.delete(params.key); return {ok: true}; }
      if (method === 'sessions.patch') return {ok: true};
      throw new Error('unexpected ' + method);
    },
  };
  const make = (options = {}) => new SideBySide({}, {access, root: dir, toolsAllowSupported: () => toolsAllow, pollMs: 5, ...options});
  const parent = () => FakeSessionManager.open(parentFile);
  const sideKeys = () => [...entries.keys()].filter(isSideKey);
  return {dir, access, calls, entries, make, parent, sideKeys, sessionsDir};
}

const sent = calls => calls.filter(([method]) => method === 'chat.send').map(([, params]) => params);

test('two models must be different and well-formed', () => {
  assert.throws(() => validateModels(['relay/a', 'relay/a']), new RegExp(SAME_MODEL));
  assert.throws(() => validateModels(['relay/a']), /两个模型/);
  assert.throws(() => validateModels(['relay/a', 'bad model']), /模型名称不对/);
  assert.deepEqual(validateModels([' relay/a ', 'other/b']), ['relay/a', 'other/b']);
});

test('the same model on both sides is refused before any session is created', async t => {
  const f = fixture(t);
  await assert.rejects(f.make().start({key: PARENT, models: ['relay/a', 'relay/a'], text: '新问题'}), new RegExp(SAME_MODEL));
  assert.equal(f.calls.filter(([method]) => method === 'sessions.create').length, 0);
});

test('a running parent session is refused', async t => {
  const f = fixture(t, {busy: true});
  await assert.rejects(f.make().start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'}), new RegExp(BUSY));
  assert.equal(f.sideKeys().length, 0);
});

test('without kernel toolsAllow the comparison does not start (tools are never opened up)', async t => {
  const f = fixture(t, {toolsAllow: false});
  await assert.rejects(f.make().start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'}), new RegExp(TOOLS_UNAVAILABLE));
  assert.equal(f.calls.filter(([method]) => ['sessions.create', 'chat.send'].includes(method)).length, 0);
  assert.equal(kernelToolsAllow({}), false);
  assert.equal(kernelToolsAllow({runtime: {features: ['chat.send.toolsAllow']}}), true);
  assert.equal(kernelToolsAllow({runtime: {features: {'chat.send.toolsAllow': true}}}), true);
});

test('both sides send the same prompt in parallel, each with its own model and only the read-only tools', async t => {
  const f = fixture(t);
  const sides = f.make();
  const view = await sides.start({key: PARENT, models: ['relay/a', 'other/b'], entryId: 'u2'});
  assert.equal(view.phase, 'running');
  const sends = sent(f.calls);
  assert.equal(sends.length, 2);
  assert.deepEqual(sends.map(params => params.message), ['第二问', '第二问']);
  for (const params of sends) assert.deepEqual(params.toolsAllow, [...REVIEW_TOOLS]);
  assert.notEqual(sends[0].idempotencyKey, sends[1].idempotencyKey);
  const creates = f.calls.filter(([method]) => method === 'sessions.create').map(([, params]) => params.model);
  assert.deepEqual(creates, ['relay/a', 'other/b']);
  // 临时会话继承到这道题之前为止的历史，不带原来的第二问 / 第二答。
  const left = FakeSessionManager.open(f.entries.get(view.sides.left.key).transcript).getBranch().map(textOf);
  assert.deepEqual(left, ['第一问', '第一答', '第二问', 'relay/a 答：第二问']);
  // 父会话在比较中不能再开一轮，也不能再发起一次比较。
  assert.equal(sides.runGate({}, {sessionKey: PARENT})?.message, COMPARING);
  await assert.rejects(sides.start({key: PARENT, models: ['relay/a', 'other/b'], text: '再来'}), new RegExp(COMPARING));
  await sides.settled();
  assert.equal((await sides.status({key: PARENT})).phase, 'choosing');
});

test('adopting a side writes both versions under the question and stops on the chosen one', async t => {
  const f = fixture(t);
  const sides = f.make();
  await sides.start({key: PARENT, models: ['relay/a', 'other/b'], entryId: 'u2'});
  await sides.settled();
  const result = await sides.adopt({key: PARENT, side: 'right'});
  assert.equal(result.ok, true);
  const parent = f.parent();
  const branch = parent.getBranch();
  assert.deepEqual(branch.map(textOf), ['第一问', '第一答', '第二问', 'other/b 答：第二问']);
  assert.equal(parent.getLeafId(), result.leaf);
  // 原来的回复、落选的一边、选中的一边都是同一道题下的版本。
  const [variant] = variantsOf(parent.getEntries(), branch);
  assert.equal(variant.total, 3);
  const answers = variant.siblings.map(id => textOf(parent.getEntries().find(entry => entry.parentId === id)));
  assert.deepEqual(answers, ['第二答', 'relay/a 答：第二问', 'other/b 答：第二问']);
  assert.equal(variant.index, 3);
  // 父会话的模型改成选中那边的；两个临时会话都删掉，比较轮结束。
  assert.deepEqual(f.calls.filter(([method]) => method === 'sessions.patch').map(([, params]) => [params.key, params.model]), [[PARENT, 'other/b']]);
  assert.equal(f.sideKeys().length, 0);
  assert.deepEqual(fs.readdirSync(f.sessionsDir).filter(name => name.startsWith('s-')), []);
  assert.equal(sides.runGate({}, {sessionKey: PARENT}), undefined);
  assert.equal((await sides.status({key: PARENT})).phase, 'none');
});

test('a composer question is written as real messages, so the next run sees the chosen reply', async t => {
  const f = fixture(t);
  const sides = f.make();
  await sides.start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'});
  await sides.settled();
  await sides.adopt({key: PARENT, side: 'left'});
  const parent = f.parent();
  const context = parent.getBranch();
  assert.deepEqual(context.slice(-2).map(entry => [entry.message.role, textOf(entry)]),
    [['user', '新问题'], ['assistant', 'relay/a 答：新问题']]);
  assert.deepEqual(context.slice(0, 4).map(entry => entry.id), ['u1', 'a1', 'u2', 'a2']);
  const [variant] = variantsOf(parent.getEntries(), context);
  assert.equal(variant.total, 2);
  assert.equal(f.calls.some(([method]) => method === 'chat.inject'), false);
});

test('discarding both keeps the parent history exactly as before', async t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.sessionsDir, 'p.jsonl'), 'utf8');
  const sides = f.make();
  await sides.start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'});
  await sides.settled();
  assert.deepEqual(await sides.discard({key: PARENT}), {ok: true});
  assert.equal(fs.readFileSync(path.join(f.sessionsDir, 'p.jsonl'), 'utf8'), before);
  assert.equal(f.parent().getLeafId(), 'a2');
  assert.equal(f.sideKeys().length, 0);
  assert.equal(f.calls.some(([method]) => method === 'sessions.patch'), false);
});

test('one side failing (quota) leaves the finished side selectable', async t => {
  const f = fixture(t, {waits: {right: {status: 'error', error: '额度用完了'}}});
  const sides = f.make();
  await sides.start({key: PARENT, models: ['relay/a', 'other/b'], entryId: 'u2'});
  await sides.settled();
  const status = await sides.status({key: PARENT});
  assert.equal(status.phase, 'choosing');
  assert.deepEqual([status.sides.left.status, status.sides.right.status], ['final', 'error']);
  assert.match(status.sides.right.error, /额度用完了/);
  await assert.rejects(sides.adopt({key: PARENT, side: 'right'}), /没有答完/);
  await sides.adopt({key: PARENT, side: 'left'});
  const parent = f.parent();
  const [variant] = variantsOf(parent.getEntries(), parent.getBranch());
  // 失败的一边不写进父会话：只有原来的回复和选中的一版。
  assert.equal(variant.total, 2);
  assert.equal(textOf(parent.getBranch().at(-1)), 'relay/a 答：第二问');
});

test('a side that runs past the limit is aborted and the other can still be chosen', async t => {
  const f = fixture(t, {waits: {left: {status: 'timeout'}}});
  const sides = f.make({timeoutMs: 40});
  await sides.start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'});
  await sides.settled();
  const status = await sides.status({key: PARENT});
  assert.deepEqual([status.sides.left.status, status.sides.right.status], ['aborted', 'final']);
  assert.ok(f.calls.some(([method, params]) => method === 'chat.abort' && params.sessionKey === status.sides.left.key));
  await sides.adopt({key: PARENT, side: 'right'});
  assert.equal(textOf(f.parent().getBranch().at(-1)), 'other/b 答：新问题');
});

test('choosing one side while the other still streams stops the other', async t => {
  const f = fixture(t, {waits: {left: {status: 'timeout'}}});
  const sides = f.make({timeoutMs: 60_000});
  await sides.start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'});
  while ((await sides.status({key: PARENT})).sides.right.status === 'running') await sleep(5);
  await sides.adopt({key: PARENT, side: 'right'});
  await sides.settled();
  assert.ok(f.calls.some(([method, params]) => method === 'chat.abort' && params.sessionKey.endsWith('-left')));
  assert.equal(f.sideKeys().length, 0);
});

test('after a restart the comparison comes back waiting for a choice; with both sides gone it is reported lost', async t => {
  const f = fixture(t);
  const first = f.make();
  await first.start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'});
  await first.settled();
  const restarted = f.make();
  await restarted.recover();
  await restarted.settled();
  assert.equal((await restarted.status({key: PARENT})).phase, 'choosing');
  assert.equal(restarted.runGate({}, {sessionKey: PARENT})?.message, COMPARING);
  for (const key of f.sideKeys()) f.entries.delete(key);
  const again = f.make();
  await again.recover();
  const lost = await again.status({key: PARENT});
  assert.deepEqual([lost.active, lost.phase, lost.message], [false, 'lost', LOST]);
  assert.equal(again.runGate({}, {sessionKey: PARENT}), undefined);
});

test('usage totals add the two side sessions only, never the parent history', async t => {
  const f = fixture(t, {usage: {left: {inputTokens: 100, outputTokens: 20, totalTokens: 120}, right: {inputTokens: 300, outputTokens: 40, totalTokens: 340}}});
  const sides = f.make();
  await sides.start({key: PARENT, models: ['relay/a', 'other/b'], text: '新问题'});
  await sides.settled();
  const {usage} = await sides.status({key: PARENT});
  assert.deepEqual(usage.total, {inputTokens: 400, outputTokens: 60, totalTokens: 460});
  assert.deepEqual(usage.sides.left, {inputTokens: 100, outputTokens: 20, totalTokens: 120});
  assert.deepEqual(usageOf([], {sides: {left: {key: 'x'}, right: {key: 'y'}}}).total, {inputTokens: 0, outputTokens: 0, totalTokens: 0});
});

test('inside a side session only the read-only tools run; other sessions are untouched', () => {
  const side = 'agent:main:internal-session-effects:pinkie-side-0f8fad5b-d9cb-469f-a165-70867728950e-left';
  assert.equal(isSideKey(side), true);
  for (const tool of REVIEW_TOOLS) assert.equal(sideToolGuard({toolName: tool}, {sessionKey: side}), undefined);
  for (const tool of ['exec', 'write', 'edit', 'browser']) assert.deepEqual(sideToolGuard({toolName: tool}, {sessionKey: side}), {block: true, blockReason: READ_ONLY});
  assert.equal(sideToolGuard({toolName: 'exec'}, {sessionKey: PARENT}), undefined);
  assert.equal(isSideKey('agent:main:dashboard:temp-0f8fad5b-d9cb-469f-a165-70867728950e'), false);
});

test('register exposes the gateway methods and the hooks', async t => {
  const f = fixture(t);
  const methods = new Map(), hooks = [];
  const api = {registerGatewayMethod: (name, fn) => methods.set(name, fn), on: (name, fn, options) => hooks.push([name, options?.priority])};
  registerSessionSideBySide(api, {titles: {access: f.access}, root: f.dir, toolsAllowSupported: () => true});
  assert.deepEqual([...methods.keys()].sort(), ['pinkie.chat.sideBySide', 'pinkie.chat.sideBySide.abort', 'pinkie.chat.sideBySide.adopt',
    'pinkie.chat.sideBySide.discard', 'pinkie.chat.sideBySide.status']);
  assert.deepEqual(hooks.map(([name]) => name).sort(), ['before_agent_run', 'before_tool_call', 'gateway_start']);
  let answer;
  await methods.get('pinkie.chat.sideBySide')({params: {key: PARENT, models: ['relay/a', 'relay/a'], text: 'x'}, respond: (...args) => { answer = args; }});
  assert.deepEqual(answer, [true, {ok: false, error: SAME_MODEL}]);
});
