import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BUSY, GONE, TurnCheckpoints} from '../services/mode-architecture/turn-checkpoints.mjs';

const KEY = 'agent:main:a';
const sha = data => createHash('sha256').update(data).digest('hex');
const readLines = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

function sessionManagerClass(opts) {
  return class FakeSessionManager {
    static open(file) { return new FakeSessionManager(file); }
    constructor(file) { this.file = file; this.entries = readLines(file); }
    getHeader() { return this.entries.find(entry => entry.type === 'session'); }
    getEntry(id) { return this.entries.find(entry => entry.id === id && entry.type !== 'session'); }
    getBranch(from = this.entries.filter(entry => entry.type !== 'session').at(-1)?.id) {
      const out = [];
      for (let id = from; id;) {
        const entry = this.getEntry(id);
        if (!entry) break;
        out.unshift(entry);
        id = entry.parentId;
      }
      return out;
    }
    createBranchedSession(id) {
      const entries = this.getBranch(id);
      const file = `${this.file}.branch-${++opts.branches}.jsonl`;
      opts.onBranch?.(this.file);
      // 真实实现在路径里没有助手消息时延后写盘；defer 模拟「分支文件没写出来」。
      if (!opts.defer && entries.some(entry => entry.message?.role === 'assistant')) {
        fs.writeFileSync(file, `${[{type: 'session', id: 's-branch'}, ...entries].map(e => JSON.stringify(e)).join('\n')}\n`);
      }
      return file;
    }
    rewriteFile() {}
  };
}

function setup({projectRoot, workspace = '', limits, defer = false} = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'turn-cp-')));
  const project = path.join(base, 'proj');
  fs.mkdirSync(project);
  const transcript = path.join(base, 's.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({type: 'session', id: 's', cwd: project})}\n`);
  const opts = {branches: 0, defer, onBranch: null};
  const state = {busy: false, clock: 1_000_000};
  const SessionManager = sessionManagerClass(opts);
  const access = {entry: async key => (key.startsWith('agent:main:') ? {key, sessionId: 's', transcript} : null)};
  const sdk = async name => (name === 'agent-sessions' ? {SessionManager}
    : name === 'agent-harness-runtime' ? {acquireSessionWriteLock: async () => ({release: async () => {}})} : null);
  const cp = new TurnCheckpoints({
    access, sdk, limits, isBusy: () => state.busy, stateRoot: path.join(base, 'state'),
    projectRoot: () => (projectRoot === undefined ? project : projectRoot),
    workspaceFor: () => (workspace === 'project' ? project : workspace), now: () => (state.clock += 1000),
  });
  let last = null;
  let n = 0;
  const append = entry => { fs.appendFileSync(transcript, `${JSON.stringify(entry)}\n`); last = entry.id; };
  async function turn(actions = [], {hooks = true, key = KEY} = {}) {
    n += 1;
    const userId = `u${n}`;
    const assistantId = `a${n}`;
    append({type: 'message', id: userId, parentId: last, message: {role: 'user', content: `第 ${n} 句`}});
    const ctx = {sessionKey: key, sessionId: 's', runId: `r${n}`};
    for (const [i, {tool, params = {}, effect}] of actions.entries()) {
      const event = {toolName: tool, params, runId: `r${n}`, toolCallId: `c${n}-${i}`};
      if (hooks) cp.beforeTool(event, ctx);
      effect?.();
      if (hooks) await cp.afterTool(event, ctx);
    }
    append({type: 'message', id: assistantId, parentId: last, message: {role: 'assistant', content: [{type: 'text', text: '好'}]}});
    if (hooks) await cp.agentEnd({runId: `r${n}`}, ctx);
    return {userId, assistantId};
  }
  const file = (rel, data) => {
    const target = path.join(project, rel);
    if (data !== undefined) {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, data);
    }
    return target;
  };
  const write = (target, data) => ({tool: 'write', params: {path: target}, effect: () => fs.writeFileSync(target, data)});
  const dir = path.join(base, 'state', 'checkpoints', 's');
  const index = () => JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const blobs = () => { try { return fs.readdirSync(path.join(dir, 'blobs')); } catch { return []; } };
  const params = (assistantEntryId, extra = {}) => ({sessionKey: KEY, assistantEntryId, ...extra});
  const ids = () => readLines(transcript).map(entry => entry.id);
  return {base, project, transcript, opts, state, cp, turn, file, write, dir, index, blobs, params, ids,
    cleanup: () => fs.rmSync(base, {recursive: true, force: true})};
}

test('同一轮第一次碰才存原样，回退后逐字节一致；第 1 轮回退只剩文件头', async t => {
  const h = setup();
  t.after(h.cleanup);
  const original = Buffer.from([0, 1, 2, 255, 254, 10, 13, 0]);
  const a = h.file('a.bin', original);
  const {assistantId} = await h.turn([h.write(a, 'X'), {tool: 'edit', params: {path: a}, effect: () => fs.writeFileSync(a, 'Y')}]);
  const rec = h.index().turns[0];
  assert.equal(rec.files.length, 1);
  assert.equal(rec.files[0].preHash, sha(original));
  assert.equal(rec.files[0].postHash, sha('Y'));
  assert.deepEqual(h.blobs(), [sha(original)], '第二次写入不能再存一份');
  // Windows 没有 POSIX 权限位，stat 读出来总是 0o666。
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(h.dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(h.dir, 'index.json')).mode & 0o777, 0o600);
  }

  const preview = await h.cp.preview(h.params(assistantId));
  assert.equal(preview.turn, 1);
  assert.equal(preview.text, '第 1 句');
  assert.deepEqual(preview.restore, [{path: a, action: 'modify'}]);
  assert.deepEqual(preview.conflicts, []);

  const result = await h.cp.restore(h.params(assistantId));
  assert.equal(result.ok, true);
  assert.equal(result.restored, 1);
  assert.ok(fs.readFileSync(a).equals(original));
  assert.deepEqual(readLines(h.transcript), [{type: 'session', id: 's', cwd: h.project}]);
});

test('本轮新建的文件回退后被删，本轮删掉的文件回退后放回', async t => {
  const h = setup();
  t.after(h.cleanup);
  const fresh = h.file('fresh.txt');
  const old = h.file('old.txt', 'old body');
  const {assistantId} = await h.turn([
    h.write(fresh, 'new'),
    {tool: 'edit', params: {path: old}, effect: () => fs.rmSync(old)},
  ]);
  const preview = await h.cp.preview(h.params(assistantId));
  assert.deepEqual(preview.restore, [{path: fresh, action: 'delete'}, {path: old, action: 'recreate'}]);
  await h.cp.restore(h.params(assistantId));
  assert.equal(fs.existsSync(fresh), false);
  assert.equal(fs.readFileSync(old, 'utf8'), 'old body');
});

test('跨三轮回到第 2 轮之前：第 2、3 轮的改动没了，第 1 轮的还在，对话截在第 1 轮回答', async t => {
  const h = setup();
  t.after(h.cleanup);
  const f1 = h.file('f1.txt', 'f1-0');
  const f2 = h.file('f2.txt', 'f2-0');
  const f3 = h.file('f3.txt');
  await h.turn([h.write(f1, 'f1-1')]);
  const second = await h.turn([h.write(f2, 'f2-2')]);
  await h.turn([h.write(f1, 'f1-3'), h.write(f3, 'f3-3')]);

  const listed = await h.cp.list({sessionKey: KEY});
  assert.deepEqual(listed.turns.map(row => row.turn), [1, 2, 3]);
  assert.equal(listed.running, false);

  const result = await h.cp.restore(h.params(second.assistantId));
  assert.equal(result.turn, 2);
  assert.equal(result.restored, 3);
  assert.equal(fs.readFileSync(f1, 'utf8'), 'f1-1');
  assert.equal(fs.readFileSync(f2, 'utf8'), 'f2-0');
  assert.equal(fs.existsSync(f3), false);

  const lines = readLines(h.transcript);
  assert.deepEqual(lines[0], {type: 'session', id: 's', cwd: h.project}, '换头时要保留原 header');
  assert.deepEqual(lines.slice(1).map(entry => entry.id), ['u1', 'a1'], '传 parentId，第 2 轮那句话不能留下');
  assert.deepEqual(h.index().turns.map(rec => rec.userEntryId), ['u1']);
  assert.deepEqual(fs.readdirSync(h.base).filter(name => name.includes('.branch-')), [], '分支文件要清掉');
});

test('分支文件延后没写出来时自己写出「文件头 + 路径条目」', async t => {
  const h = setup({defer: true});
  t.after(h.cleanup);
  const f = h.file('f.txt', '0');
  await h.turn([h.write(f, '1')]);
  const second = await h.turn([h.write(f, '2')]);
  await h.cp.restore(h.params(second.assistantId));
  assert.deepEqual(h.ids(), ['s', 'u1', 'a1']);
  assert.equal(fs.readFileSync(f, 'utf8'), '1');
});

test('rename 前记录被别人追加一行：放弃，文件拨回，记录不变', async t => {
  const h = setup();
  t.after(h.cleanup);
  const f = h.file('f.txt', '0');
  await h.turn([h.write(f, '1')]);
  const second = await h.turn([h.write(f, '2')]);
  h.opts.onBranch = file => fs.appendFileSync(file, `${JSON.stringify({type: 'custom', id: 'x1', parentId: 'a2'})}\n`);
  await assert.rejects(h.cp.restore(h.params(second.assistantId)), /会话记录刚被改过/);
  assert.equal(fs.readFileSync(f, 'utf8'), '2', '对话那步失败，文件也要拨回');
  assert.deepEqual(h.ids(), ['s', 'u1', 'a1', 'u2', 'a2', 'x1']);
  assert.deepEqual(h.index().turns.map(rec => rec.userEntryId), ['u1', 'u2']);
});

test('从回答往上找 user 消息：找得到、找不到、和 index 对不上', async t => {
  const h = setup();
  t.after(h.cleanup);
  const f = h.file('f.txt', '0');
  const untracked = await h.turn([], {hooks: false});
  const tracked = await h.turn([h.write(f, '1')]);
  assert.equal((await h.cp.preview(h.params(tracked.assistantId))).turn, 2);
  await assert.rejects(h.cp.preview(h.params('nope')), /找不到当前分支里的这条消息/);
  await assert.rejects(h.cp.preview(h.params(tracked.userId)), /找不到当前分支里的这条消息/, '必须是回答 id');
  await assert.rejects(h.cp.preview(h.params(untracked.assistantId)), new RegExp(GONE));
  await assert.rejects(h.cp.restore(h.params(untracked.assistantId)), new RegExp(GONE));
  assert.equal(fs.readFileSync(f, 'utf8'), '1');
  assert.equal(h.ids().length, 5);
});

test('run_tests 和没有路径键的 code_edit 走审计器，没认出的写入列进 unrecoverable', async t => {
  const h = setup();
  t.after(h.cleanup);
  const gen = h.file('gen.txt');
  const b = h.file('b.txt', 'b');
  const c = h.file('c.txt', 'c');
  const {assistantId} = await h.turn([
    {tool: 'run_tests', params: {}, effect: () => fs.writeFileSync(gen, 'generated')},
    {tool: 'code_edit', params: {instructions: 'tweak'}, effect: () => fs.writeFileSync(b, 'b changed')},
    h.write(c, 'c changed'),
  ]);
  const preview = await h.cp.preview(h.params(assistantId));
  assert.deepEqual(preview.unrecoverable, [{path: b, reason: 'exec'}, {path: gen, reason: 'exec'}]);
  assert.deepEqual(preview.restore, [{path: c, action: 'modify'}]);
  assert.deepEqual(preview.auditIncomplete, []);
});

test('项目里超过 1500 个文件时 auditIncomplete 为真', async t => {
  const h = setup();
  t.after(h.cleanup);
  for (let i = 0; i <= 1500; i += 1) h.file(`many/${i}.txt`, '');
  const f = h.file('f.txt', '0');
  const {assistantId} = await h.turn([{tool: 'exec', params: {command: 'true'}, effect: () => {}}, h.write(f, '1')]);
  assert.deepEqual((await h.cp.preview(h.params(assistantId))).auditIncomplete, [1]);
  assert.equal((await h.cp.list({sessionKey: KEY})).turns[0].auditIncomplete, true);
});

test('2 MB + 1 字节记 too-large、不写 blob；正好 2 MB 照存', async t => {
  const h = setup();
  t.after(h.cleanup);
  const big = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
  const edge = Buffer.alloc(2 * 1024 * 1024, 2);
  const bigFile = h.file('big.bin', big);
  const edgeFile = h.file('edge.bin', edge);
  const {assistantId} = await h.turn([h.write(bigFile, 'x'), h.write(edgeFile, 'y')]);
  const preview = await h.cp.preview(h.params(assistantId));
  assert.deepEqual(preview.unrecoverable, [{path: bigFile, reason: 'too-large'}]);
  assert.deepEqual(preview.restore, [{path: edgeFile, action: 'modify'}]);
  assert.deepEqual(h.blobs(), [sha(edge)]);
});

test('一个会话超过 30 轮从最老的删起', async t => {
  const h = setup();
  t.after(h.cleanup);
  const f = h.file('f.txt', '0');
  const turns = [];
  for (let i = 1; i <= 31; i += 1) turns.push(await h.turn([h.write(f, String(i))]));
  const records = h.index().turns;
  assert.equal(records.length, 30);
  assert.equal(records[0].userEntryId, 'u2');
  await assert.rejects(h.cp.preview(h.params(turns[0].assistantId)), new RegExp(GONE));
  assert.equal((await h.cp.preview(h.params(turns[1].assistantId))).turn, 2);
  assert.equal(h.blobs().length, 30);
});

test('会话检查点超过大小上限时删最老的轮', async t => {
  const h = setup({limits: {session: 15}});
  t.after(h.cleanup);
  const a = h.file('a.txt', '0123456789');
  const b = h.file('b.txt', 'abcdefghij');
  await h.turn([h.write(a, 'x')]);
  await h.turn([h.write(b, 'y')]);
  assert.deepEqual(h.index().turns.map(rec => rec.userEntryId), ['u2']);
  assert.deepEqual(h.blobs(), [sha('abcdefghij')]);
});

test('之后被别处改过的文件默认不覆盖', async t => {
  const h = setup();
  t.after(h.cleanup);
  const f = h.file('c.txt', 'orig');
  const {assistantId} = await h.turn([h.write(f, 'ai')]);
  fs.writeFileSync(f, 'human');
  const preview = await h.cp.preview(h.params(assistantId));
  assert.deepEqual(preview.conflicts, [{path: f, action: 'modify'}]);
  assert.deepEqual(preview.restore, []);
  const result = await h.cp.restore(h.params(assistantId));
  assert.equal(result.restored, 0);
  assert.equal(result.skipped, 1);
  assert.equal(fs.readFileSync(f, 'utf8'), 'human');
});

test('冲突勾选后才覆盖', async t => {
  const h = setup();
  t.after(h.cleanup);
  const f = h.file('c.txt', 'orig');
  const {assistantId} = await h.turn([h.write(f, 'ai')]);
  fs.writeFileSync(f, 'human');
  const result = await h.cp.restore(h.params(assistantId, {overwrite: [f]}));
  assert.equal(result.restored, 1);
  assert.equal(fs.readFileSync(f, 'utf8'), 'orig');
});

// 靠只读目录让 rename 失败：root 不受限，Windows 的目录 chmod 也拦不住写入。
test('第二个文件写不回去：第一个也拨回，对话不截', {skip: process.getuid?.() === 0 || process.platform === 'win32'}, async t => {
  const h = setup();
  const ro = path.join(h.project, 'ro');
  t.after(() => { try { fs.chmodSync(ro, 0o700); } catch {} h.cleanup(); });
  const a = h.file('a.txt', 'a0');
  const b = h.file('ro/b.txt', 'b0');
  await h.turn([h.write(a, 'a1')]);
  const second = await h.turn([h.write(a, 'a2'), h.write(b, 'b2')]);
  fs.chmodSync(ro, 0o500);
  await assert.rejects(h.cp.restore(h.params(second.assistantId)), /有文件写不回去，已全部拨回/);
  assert.equal(fs.readFileSync(a, 'utf8'), 'a2');
  assert.equal(fs.readFileSync(b, 'utf8'), 'b2');
  assert.deepEqual(h.ids(), ['s', 'u1', 'a1', 'u2', 'a2']);
  assert.deepEqual(h.index().turns.map(rec => rec.userEntryId), ['u1', 'u2']);
});

test('项目外、符号链接、.git 里的文件不存内容', async t => {
  const h = setup();
  t.after(h.cleanup);
  const outside = path.join(h.base, 'outside.txt');
  fs.writeFileSync(outside, 'out');
  const link = h.file('link.txt');
  fs.symlinkSync(outside, link);
  const gitFile = h.file('.git/config', 'cfg');
  const inside = h.file('in.txt', 'in');
  const {assistantId} = await h.turn([
    h.write(outside, 'out2'), {tool: 'write', params: {path: link}, effect: () => {}}, h.write(gitFile, 'cfg2'), h.write(inside, 'in2'),
  ]);
  const preview = await h.cp.preview(h.params(assistantId));
  assert.deepEqual(new Map(preview.unrecoverable.map(item => [item.path, item.reason])),
    new Map([[outside, 'outside'], [link, 'symlink'], [gitFile, 'skipped-dir']]));
  assert.deepEqual(preview.restore, [{path: inside, action: 'modify'}]);
  assert.deepEqual(h.blobs(), [sha('in')]);
});

test('没有项目目录也没有工作区时不记；只有工作区时照记', async t => {
  const none = setup({projectRoot: ''});
  t.after(none.cleanup);
  await none.turn([none.write(none.file('f.txt', '0'), '1')]);
  assert.equal(fs.existsSync(none.dir), false);
  assert.deepEqual((await none.cp.list({sessionKey: KEY})).turns, []);

  const ws = setup({projectRoot: '', workspace: 'project'});
  t.after(ws.cleanup);
  await ws.turn([ws.write(ws.file('f.txt', '0'), '1')]);
  assert.equal(ws.index().turns.length, 1);
});

test(':subagent: 会话不记', async t => {
  const h = setup();
  t.after(h.cleanup);
  await h.turn([h.write(h.file('f.txt', '0'), '1')], {key: 'agent:main:subagent:x'});
  assert.equal(fs.existsSync(h.dir), false);
});

test('还在跑时 restore 拒绝，文件和对话都不动', async t => {
  const h = setup();
  t.after(h.cleanup);
  const f = h.file('f.txt', '0');
  const {assistantId} = await h.turn([h.write(f, '1')]);
  h.state.busy = true;
  assert.equal((await h.cp.preview(h.params(assistantId))).running, true);
  await assert.rejects(h.cp.restore(h.params(assistantId)), new RegExp(BUSY));
  assert.equal(fs.readFileSync(f, 'utf8'), '1');
  assert.deepEqual(h.ids(), ['s', 'u1', 'a1']);
  assert.equal(h.index().turns.length, 1);
});

test('exec 带 cwd 时 cwd 目录本身不当成文件误报 not-file', async t => {
  const h = setup();
  t.after(h.cleanup);
  const gen = h.file('gen.txt');
  const {assistantId} = await h.turn([
    {tool: 'exec', params: {command: 'make', cwd: h.project}, effect: () => fs.writeFileSync(gen, 'generated')},
  ]);
  const preview = await h.cp.preview(h.params(assistantId));
  assert.deepEqual(preview.unrecoverable, [{path: gen, reason: 'exec'}]);
  assert.deepEqual(preview.restore, []);
});
