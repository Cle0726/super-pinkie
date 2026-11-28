// T3 #22（L34）：Metre 引擎台「改动」面板的提交 / 开 PR 后端（services/mode-architecture/pr-flow.mjs 末尾的 EngineShip）契约测试。
// 用假的 run（记下每一次 git / gh 调用，按表回答）和假的引擎桥代替真命令、真引擎服务。
// 正例：status 给出能不能点、为什么、确认用的 token；确认后提交 / 推送 + 开草稿 PR。
// 反例：没带确认或 token 过期（改动 / 分支 / 头变了）一律拒绝且一条写命令都不跑；引擎还在做、在 main 上、有没提交的改动时不开 PR；
// 任何一步都不调 gh pr merge、不 force push；不在 Metre 会话里不能用。
import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineShip, parsePorcelain, registerEngineShip} from '../services/mode-architecture/pr-flow.mjs';

const KEY = 'agent:metre:ship';
const HEAD = 'abc1234def5678abc1234def5678abc1234def56';

function harness({repo = true, branch = 'feat/x', head = HEAD, porcelain = ' M src/a.js\n?? notes.md\n', remote = true, auth = 0, pr = null,
  status = 'done', threadId = 't1', worktree = null, commitFail = '', pushFail = false, threadError = undefined} = {}) {
  const calls = [];
  const state = {head, porcelain};
  const ok = (stdout = '') => ({code: 0, stdout, stderr: ''});
  const run = async (cmd, args, opts) => {
    calls.push({cmd, args: [...args], cwd: opts?.cwd});
    const a = args.join(' ');
    if (cmd === 'git') {
      if (a === 'rev-parse --is-inside-work-tree') return repo ? ok('true\n') : {code: 128, stdout: '', stderr: 'not a git repository'};
      if (a === 'rev-parse --abbrev-ref HEAD') return ok(branch + '\n');
      if (a === 'rev-parse HEAD') return state.head ? ok(state.head + '\n') : {code: 128, stdout: '', stderr: 'unknown revision'};
      if (a.startsWith('status --porcelain')) return ok(state.porcelain);
      if (a === 'remote get-url origin') return remote ? ok('git@example.test:me/repo.git\n') : {code: 2, stdout: '', stderr: 'No such remote'};
      if (a === 'add -A') return ok('');
      if (args[0] === 'commit') {
        if (commitFail) return {code: 1, stdout: '', stderr: commitFail};
        state.head = 'f00dfeed'.repeat(5); state.porcelain = '';
        return ok('[feat/x f00dfee] ' + args[2] + '\n 2 files changed\n');
      }
      if (args[0] === 'push') return pushFail ? {code: 1, stdout: '', stderr: 'rejected, token ghp_abcdefghijklmnopqrstuvwxyz0123'} : ok('');
      return ok('');
    }
    if (a === 'auth status') return auth === 0 ? ok('') : {code: auth, stdout: '', stderr: auth === 127 ? 'ENOENT' : 'not logged in'};
    if (a.startsWith('pr view')) return pr ? ok(JSON.stringify(pr)) : {code: 1, stdout: '', stderr: 'no pull requests found'};
    if (a.startsWith('pr create')) return ok('https://example.test/me/repo/pull/9\n');
    return ok('');
  };
  const bridge = {
    sessions: {get: (key) => (key === KEY ? {engine: 'claudeAgent', model: 'haiku', threadId, folder: '/proj'} : null)},
    thread: async () => { if (threadError) throw threadError; return threadError === null ? null : {status, thread: {worktree}}; },
    folderFor: () => '/scratch',
  };
  const ship = new EngineShip({bridge: () => bridge, run});
  const writes = () => calls.filter((c) => (c.cmd === 'git' && ['add', 'commit', 'push'].includes(c.args[0])) || (c.cmd === 'gh' && c.args[0] === 'pr' && ['create', 'merge'].includes(c.args[1])));
  return {ship, calls, writes, state};
}

test('parsePorcelain：状态两位 + 路径，改名取新名，空行忽略', () => {
  assert.deepEqual(parsePorcelain(' M a.js\n?? b.md\nR  old.txt -> new.txt\n\n'), [
    {status: 'M', file: 'a.js'}, {status: '??', file: 'b.md'}, {status: 'R', file: 'new.txt'}]);
});

test('只在 Metre 会话、只在交给过外部引擎以后', async () => {
  const {ship} = harness();
  await assert.rejects(ship.status({sessionKey: 'agent:project:x'}), /只在 Metre/);
  await assert.rejects(harness({threadId: ''}).ship.status({sessionKey: KEY}), /还没交给外部引擎/);
  await assert.rejects(new EngineShip({bridge: () => null, run: async () => ({code: 0, stdout: '', stderr: ''})}).status({sessionKey: KEY}), /外部引擎还没打开/);
});

test('status：文件夹用引擎的工作树（有的话），能提交时给 token；有没提交的改动时不让开 PR 并说为什么', async () => {
  const h = harness({worktree: '/wt/feat-x'});
  const s = await h.ship.status({sessionKey: KEY});
  assert.equal(s.folder, '/wt/feat-x');
  assert.ok(h.calls.every((c) => c.cwd === '/wt/feat-x'));
  assert.equal(s.ready, true);
  assert.equal(s.canCommit, true);
  assert.match(s.commitToken, /^commit@[0-9a-f]{16}$/);
  assert.deepEqual(s.files.map((f) => f.file), ['src/a.js', 'notes.md']);
  assert.equal(s.canPr, false);
  assert.match(s.prWhy, /没提交的改动/);
  assert.equal(s.prToken, '');
  assert.equal((await harness().ship.status({sessionKey: KEY})).folder, '/proj', '没工作树就用会话记下的文件夹');
  assert.deepEqual(h.writes(), [], 'status 不写');
});

test('status：不能点的都给一句话（不是仓库 / 引擎在做 / 没改动 / main 上 / 没远端 / 没装 gh / 没登录 / 已有 PR）', async () => {
  const why = async (opts) => harness(opts).ship.status({sessionKey: KEY});
  assert.match((await why({repo: false})).why, /不是 git 仓库/);
  const busy = await why({status: 'running'});
  assert.equal(busy.canCommit, false); assert.match(busy.commitWhy, /引擎还在做/); assert.match(busy.prWhy, /引擎还在做/);
  assert.match((await why({status: 'waiting', porcelain: ''})).prWhy, /引擎还在做/);
  const clean = await why({porcelain: ''});
  assert.equal(clean.canCommit, false); assert.match(clean.commitWhy, /没有要提交的改动/);
  assert.equal(clean.canPr, true); assert.equal(clean.prToken, `pr@feat/x@${HEAD}`);
  assert.match((await why({porcelain: '', branch: 'main'})).prWhy, /在 main 上/);
  assert.match((await why({porcelain: '', branch: 'HEAD'})).prWhy, /不在任何分支上/);
  assert.match((await why({porcelain: '', remote: false})).prWhy, /没有远端/);
  assert.match((await why({porcelain: '', auth: 127})).prWhy, /没装 gh/);
  assert.match((await why({porcelain: '', auth: 1})).prWhy, /gh 还没登录/);
  const has = await why({porcelain: '', pr: {number: 5, url: 'https://example.test/pull/5', state: 'OPEN', isDraft: true}});
  assert.equal(has.canPr, false); assert.match(has.prWhy, /已经有 PR #5/); assert.equal(has.pr.number, 5);
});

test('提交：没带确认 / token 不对 / 看完以后改动变了 → 拒绝（CONFLICT），一条写命令都不跑', async () => {
  const h = harness();
  const s = await h.ship.status({sessionKey: KEY});
  await assert.rejects(h.ship.commit({sessionKey: KEY, message: 'x'}), (e) => e.code === 'CONFLICT');
  await assert.rejects(h.ship.commit({sessionKey: KEY, message: 'x', confirm: true}), (e) => e.code === 'CONFLICT');
  await assert.rejects(h.ship.commit({sessionKey: KEY, message: 'x', confirm: 'commit@0000000000000000'}), (e) => e.code === 'CONFLICT');
  h.state.porcelain += ' M src/b.js\n'; // 引擎或别人又改了一个文件
  await assert.rejects(h.ship.commit({sessionKey: KEY, message: 'x', confirm: s.commitToken}), (e) => e.code === 'CONFLICT');
  await assert.rejects(h.ship.commit({sessionKey: KEY, message: '  ', confirm: s.commitToken}), /提交说明/);
  assert.deepEqual(h.writes(), []);
});

test('提交：引擎还在做时就算 token 对也不提交', async () => {
  const h = harness();
  const s = await h.ship.status({sessionKey: KEY});
  h.ship.bridge = () => ({...harness({status: 'running'}).ship.bridge()});
  await assert.rejects(h.ship.commit({sessionKey: KEY, message: 'x', confirm: s.commitToken}), /引擎还在做/);
  assert.deepEqual(h.writes(), []);
});

test('提交：确认对了才 git add -A + git commit -m，不推送、不开 PR', async () => {
  const h = harness();
  const s = await h.ship.status({sessionKey: KEY});
  const r = await h.ship.commit({sessionKey: KEY, message: '修好登录按钮', confirm: s.commitToken});
  assert.equal(r.committed, true);
  assert.equal(r.files, 2);
  assert.equal(r.head, 'f00dfeed'.repeat(5));
  assert.deepEqual(h.writes().map((c) => [c.cmd, ...c.args]), [['git', 'add', '-A'], ['git', 'commit', '-m', '修好登录按钮']]);
  const again = harness({commitFail: 'Please tell me who you are.'});
  const t = await again.ship.status({sessionKey: KEY});
  await assert.rejects(again.ship.commit({sessionKey: KEY, message: 'x', confirm: t.commitToken}), /用户名和邮箱/);
});

test('开 PR：没带确认 / 头或分支变了 → 拒绝；在 main 上、有没提交的改动时就算带 token 也拒绝；都不推送', async () => {
  const h = harness({porcelain: ''});
  const s = await h.ship.status({sessionKey: KEY});
  await assert.rejects(h.ship.openPr({sessionKey: KEY, title: 't'}), (e) => e.code === 'CONFLICT');
  await assert.rejects(h.ship.openPr({sessionKey: KEY, title: 't', confirm: `pr@feat/x@${'0'.repeat(40)}`}), (e) => e.code === 'CONFLICT');
  h.state.head = 'beef'.repeat(10); // 看完以后又有了新提交
  await assert.rejects(h.ship.openPr({sessionKey: KEY, title: 't', confirm: s.prToken}), (e) => e.code === 'CONFLICT');
  assert.deepEqual(h.writes(), []);
  const onMain = harness({porcelain: '', branch: 'main'});
  await assert.rejects(onMain.ship.openPr({sessionKey: KEY, title: 't', confirm: `pr@main@${HEAD}`}), /在 main 上/);
  const dirty = harness();
  await assert.rejects(dirty.ship.openPr({sessionKey: KEY, title: 't', confirm: `pr@feat/x@${HEAD}`}), /没提交的改动/);
  await assert.rejects(harness({porcelain: ''}).ship.openPr({sessionKey: KEY, title: ' ', confirm: s.prToken}), /PR 标题/);
  assert.deepEqual([...onMain.writes(), ...dirty.writes()], []);
});

test('开 PR：确认对了才普通 push（不 force）+ gh pr create --draft；不调 gh pr merge；推送被拒就停、令牌串抹掉', async () => {
  const h = harness({porcelain: ''});
  const s = await h.ship.status({sessionKey: KEY});
  const r = await h.ship.openPr({sessionKey: KEY, title: '登录按钮', body: '改了颜色', confirm: s.prToken});
  assert.deepEqual(r, {opened: true, url: 'https://example.test/me/repo/pull/9', branch: 'feat/x', head: HEAD, draft: true});
  const w = h.writes();
  assert.deepEqual(w[0].args, ['push', '-u', 'origin', 'HEAD:refs/heads/feat/x']);
  assert.deepEqual(w[1].args.slice(0, 6), ['pr', 'create', '--head', 'feat/x', '--title', '登录按钮']);
  assert.equal(w[1].args.at(-1), '--draft');
  assert.equal(w.length, 2);
  for (const c of h.calls) {
    assert.ok(!c.args.some((a) => /^(--force|-f|--force-with-lease)/.test(a)), '不强推：' + c.args.join(' '));
    assert.ok(!(c.cmd === 'gh' && c.args[1] === 'merge'), '不合并');
  }
  const ready = harness({porcelain: ''});
  const t = await ready.ship.status({sessionKey: KEY});
  assert.equal((await ready.ship.openPr({sessionKey: KEY, title: 'x', draft: false, confirm: t.prToken})).draft, false);
  assert.ok(!ready.writes()[1].args.includes('--draft'));
  const rejected = harness({porcelain: '', pushFail: true});
  const u = await rejected.ship.status({sessionKey: KEY});
  await assert.rejects(rejected.ship.openPr({sessionKey: KEY, title: 'x', confirm: u.prToken}), (e) => /没推上去/.test(e.message) && !/ghp_/.test(e.message));
  assert.ok(!rejected.writes().some((c) => c.cmd === 'gh'), '推送失败不开 PR');
});

// #445 linuxwatch 11:54Z：引擎服务没在跑（thread() 抛错）时，不能退回 pref.folder（对话开在新工作树里时那是项目根），
// 也不能把「看不出在不在做」当成没在做。status 不给 token、不跑任何 git / gh；commit / openPr 就算带着「对的」token 也拒绝。
test('反例：引擎服务没在跑、pref.folder 是项目根 → status 不给 token，commit / openPr 拒绝，一条命令都不跑', async () => {
  // 「对的」token：用同样的项目根状态、引擎服务在跑时算出来的那份（攻击面就是拿它去项目根提交）。
  const healthy = await harness().ship.status({sessionKey: KEY});
  const healthyClean = await harness({porcelain: ''}).ship.status({sessionKey: KEY});
  assert.ok(healthy.commitToken && healthyClean.prToken);
  for (const threadError of [new Error('引擎服务没有在运行'), null]) {
    const h = harness({threadError});
    const s = await h.ship.status({sessionKey: KEY});
    assert.equal(s.canCommit, false);
    assert.equal(s.canPr, false);
    assert.equal(s.commitToken, '');
    assert.equal(s.prToken, '');
    assert.equal(s.ready, false);
    assert.match(s.why, /引擎服务没在跑/);
    assert.match(s.commitWhy, /引擎服务没在跑/);
    assert.match(s.prWhy, /引擎服务没在跑/);
    assert.notEqual(s.folder, '/proj', '不退回 pref.folder');
    await assert.rejects(h.ship.commit({sessionKey: KEY, message: 'x', confirm: healthy.commitToken}), /引擎服务没在跑/);
    const clean = harness({threadError, porcelain: ''});
    await assert.rejects(clean.ship.openPr({sessionKey: KEY, title: 't', confirm: healthyClean.prToken}), /引擎服务没在跑/);
    assert.deepEqual([...h.calls, ...clean.calls], [], '一条 git / gh 都不跑');
  }
});

test('registerEngineShip 只注册三个方法：status / commit / openPr', () => {
  const names = [];
  registerEngineShip({}, {register: (api, name) => names.push(name), bridge: () => null});
  assert.deepEqual(names.sort(), ['pinkie.engines.ship.commit', 'pinkie.engines.ship.openPr', 'pinkie.engines.ship.status']);
});
