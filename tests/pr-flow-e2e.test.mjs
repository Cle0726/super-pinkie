// 新功能第 5 项「PR 一条龙」真跑一遍（协调者 11-25 03:52：不新建 GitHub 仓库，用本机裸仓库 + 假 gh 把流程跑通）。
// PrFlow 用真的跑命令（defaultRun）和真的 git，只把 gh 换成 tests/fixtures/fake-gh.mjs（PR 状态存 JSON，头 / 差异 / 合并都在真裸仓库里做）。
// 引擎是假的：审查回一条 high；改就在工作副本里真提交一次（代替引擎动手）。
// 流程：开 PR → 审查 → 看 CI + 跟上 main → 按意见改 → 推送 → CI 没绿不让合 → 头不对不让合 → 确认合并 → main 上有改动。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PrFlow, defaultRun} from '../services/mode-architecture/pr-flow.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh.mjs');
const KEY = 'agent:metre:e2e';
const ID = {GIT_AUTHOR_NAME: 'pinkie-test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'pinkie-test', GIT_COMMITTER_EMAIL: 'test@example.test'};
Object.assign(process.env, ID);

const git = (cwd, ...a) => execFileSync('git', a, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);

// 一个裸仓库 origin.git（main 上一个文件）+ 用户的工作副本 work（在 PR 分支 feat/button 上，已推）+ 另一个人往 main 推了一次。
function world(t, {mainEdit = 'docs.md'} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-pr-e2e-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const origin = path.join(dir, 'origin.git'), work = path.join(dir, 'work'), other = path.join(dir, 'other');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '-q', origin, work);
  git(work, 'checkout', '-q', '-b', 'main');
  write(work, 'app.js', 'export const add = (a, b) => a + b;\n');
  write(work, 'docs.md', '# 说明\n');
  git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'init'); git(work, 'push', '-q', '-u', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feat/button');
  write(work, 'app.js', 'export const add = (a, b) => a + b;\nexport const div = (a, b) => a / b;\n');
  git(work, 'commit', '-q', '-am', '加 div'); git(work, 'push', '-q', '-u', 'origin', 'feat/button');
  git(dir, 'clone', '-q', origin, other);
  write(other, mainEdit, mainEdit === 'app.js' ? 'export const add = (x, y) => x + y;\nexport const div = (x, y) => y && x / y;\n' : '# 说明\n\n另一个人加的一行。\n');
  git(other, 'commit', '-q', '-am', 'main 上另一个人的改动'); git(other, 'push', '-q', 'origin', 'main');
  process.env.FAKE_GH_DIR = dir;
  const gh = (...a) => execFileSync(process.execPath, [FAKE, ...a], {cwd: work, encoding: 'utf8'}).trim();
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const setCi = (sha, conclusion) => { const s = state(); s.ci[sha] = conclusion; fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s)); };
  const calls = () => fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).args);
  const base = defaultRun();
  const run = (cmd, args, o) => (cmd === 'gh' ? base(process.execPath, [FAKE, ...args], o) : base(cmd, args, o));
  const asked = [], fixes = [];
  const flow = new PrFlow({scope: () => ({root: work, bound: true}), run,
    ask: async (key, prompt) => { asked.push(prompt); return '```json\n[{"severity":"high","file":"app.js","line":2,"title":"除以 0","detail":"b 为 0 时返回 Infinity"}]\n```'; },
    fix: async (key, job) => { fixes.push(job); write(work, 'app.js', fs.readFileSync(path.join(work, 'app.js'), 'utf8').replace('=> a / b;', '=> { if (b === 0) throw new Error("除数是 0"); return a / b; };')); git(work, 'commit', '-q', '-am', '按审查改：除以 0'); return {threadId: 't-fix'}; }});
  return {dir, origin, work, gh, state, setCi, calls, flow, asked, fixes};
}

test('真跑一遍：开 PR → 审查 → 看 CI + 跟上 main → 改 → 推送 → CI 没绿 / 头不对不让合 → 确认合并 → main 上有改动', async (t) => {
  const w = world(t);
  assert.match(w.gh('pr', 'create', '--base', 'main', '--head', 'feat/button', '--title', '加 div'), /\/pr\/1$/);
  const p = {sessionKey: KEY};

  const st = await w.flow.status(p);
  assert.equal(st.ready, true, st.why);
  assert.equal(st.current.number, 1); assert.equal(st.current.headRefName, 'feat/button');
  assert.deepEqual(st.recent.map((x) => x.number), [1]);

  const rev = await w.flow.review({...p, number: 1});
  assert.match(w.asked[0], /\+export const div = \(a, b\) => a \/ b;/, '审查拿到的是真差异');
  assert.deepEqual(rev.findings.map((f) => [f.severity, f.file, f.line, f.title]), [['high', 'app.js', 2, '除以 0']]);
  assert.equal(git(w.work, 'status', '--porcelain'), '', '审查不动工作副本');

  const f1 = await w.flow.followUp({...p, number: 1, steps: ['ci', 'main']});
  assert.equal(f1.ci[0].bucket, 'pending');
  assert.deepEqual(f1.main, {merged: true, conflicts: []});
  assert.match(fs.readFileSync(path.join(w.work, 'docs.md'), 'utf8'), /另一个人加的一行/, '跟上了 main');
  assert.equal(git(w.work, 'rev-list', '--merges', '--count', 'HEAD'), '1', '是 merge，不是变基');

  const f2 = await w.flow.followUp({...p, number: 1, steps: ['fix'], findings: rev.findings});
  assert.deepEqual(f2.fix, {threadId: 't-fix'});
  assert.equal(w.fixes[0].branch, 'feat/button');
  assert.notEqual(git(w.work, 'rev-parse', 'HEAD'), git(w.origin, 'rev-parse', 'refs/heads/feat/button'), '改完还没推');

  const f3 = await w.flow.followUp({...p, number: 1, steps: ['push']});
  const head = git(w.work, 'rev-parse', 'HEAD');
  assert.equal(f3.push.head, head);
  assert.equal(git(w.origin, 'rev-parse', 'refs/heads/feat/button'), head, '推到了 PR 分支');

  await assert.rejects(w.flow.merge({...p, number: 1, confirm: `1@${head}`}), /CI 还没全绿/);
  w.setCi(head, 'SUCCESS');
  await assert.rejects(w.flow.merge({...p, number: 1, confirm: '1@0000000'}), /头变了或没确认/);
  await assert.rejects(w.flow.merge({...p, number: 1}), /头变了或没确认/);
  const m = await w.flow.merge({...p, number: 1, confirm: `1@${head}`});
  assert.deepEqual(m, {number: 1, merged: true, head});
  assert.equal(w.state().prs[0].state, 'MERGED');
  assert.match(git(w.origin, 'show', 'refs/heads/main:app.js'), /除数是 0/, 'main 上有按审查改的那一笔');
  assert.equal(git(w.origin, 'merge-base', '--is-ancestor', head, 'refs/heads/main') || 'ok', 'ok');

  const merges = w.calls().filter((a) => a[0] === 'pr' && a[1] === 'merge');
  assert.equal(merges.length, 1, '整个流程只调了一次 gh pr merge');
  assert.deepEqual(merges[0], ['pr', 'merge', '1', '--merge', '--match-head-commit', head]);
});

test('真跑：跟 main 有冲突 → merge --abort、列出冲突文件、工作副本回到原样；推送被拒不强推', async (t) => {
  const w = world(t, {mainEdit: 'app.js'});
  w.gh('pr', 'create', '--base', 'main', '--head', 'feat/button', '--title', '加 div');
  const before = git(w.work, 'rev-parse', 'HEAD');
  const f = await w.flow.followUp({sessionKey: KEY, number: 1, steps: ['main']});
  assert.deepEqual(f.main, {merged: false, conflicts: ['app.js']});
  assert.equal(git(w.work, 'rev-parse', 'HEAD'), before);
  assert.equal(git(w.work, 'status', '--porcelain'), '', '撤回干净');
  assert.equal(w.flow.progress.get(KEY).phase, 'failed');

  // 别人往 PR 分支推了一笔，本地也有一笔 → 普通 push 被拒，报错，远端不动
  const other = path.join(w.dir, 'other');
  git(other, 'fetch', '-q', 'origin'); git(other, 'checkout', '-q', '-b', 'feat/button', 'origin/feat/button');
  write(other, 'docs.md', '# 别人在 PR 分支上改的\n'); git(other, 'commit', '-q', '-am', '别人的'); git(other, 'push', '-q', 'origin', 'feat/button');
  const remote = git(w.origin, 'rev-parse', 'refs/heads/feat/button');
  write(w.work, 'README.md', '本地的\n'); git(w.work, 'add', '.'); git(w.work, 'commit', '-q', '-m', '本地的');
  await assert.rejects(w.flow.followUp({sessionKey: KEY, number: 1, steps: ['push']}), /没推上去（不会强推/);
  assert.equal(git(w.origin, 'rev-parse', 'refs/heads/feat/button'), remote, '远端没被覆盖');
  assert.ok(!w.calls().some((a) => a[0] === 'pr' && a[1] === 'merge'));
});

test('真跑：不在 PR 分支上不推；gh 没登录 → ready:false 一句话', async (t) => {
  const w = world(t);
  w.gh('pr', 'create', '--base', 'main', '--head', 'feat/button', '--title', '加 div');
  git(w.work, 'checkout', '-q', 'main');
  await assert.rejects(w.flow.followUp({sessionKey: KEY, number: 1, steps: ['push']}), /当前分支是 main，不是这个 PR 的 feat\/button/);
  process.env.FAKE_GH_LOGGED_OUT = '1';
  try {
    const st = await w.flow.status({sessionKey: KEY});
    assert.deepEqual([st.ready, st.why], [false, '本机 gh 还没登录：在终端里跑 gh auth login。']);
  } finally { delete process.env.FAKE_GH_LOGGED_OUT; }
});
