// 新功能第 5 项「PR 一条龙」后端契约测试（m5，11-25）。设计：build/quick-run/设计-PR一条龙.md。
// 用假的 run（记下每一次 gh / git 调用，按表回答）代替真命令，假的 ask / fix 代替引擎。
// 前提：只在 Metre 会话、只在绑了的文件夹；正例：审查、跟进、合并按规矩走；
// 反例：审查 / 跟进里任何一步都没调 gh pr merge；头变了、草稿、CI 没绿都不合；令牌串被抹掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import {PrFlow, parseFindings, redact, registerPrFlow, reviewPrompt} from '../services/mode-architecture/pr-flow.mjs';

const KEY = 'agent:metre:w';
const HEAD = 'abc1234def5678';
const PR = {number: 7, title: '加一个按钮', url: 'https://example.test/pr/7', state: 'OPEN', isDraft: false,
  headRefName: 'feat/button', headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE', reviewDecision: '',
  statusCheckRollup: [{name: 'ci', conclusion: 'SUCCESS'}]};
const plain = (v) => JSON.parse(JSON.stringify(v));

function harness({bound = true, repo = true, auth = 0, pr = PR, mergeConflict = false, branch = 'feat/button', answer = '[]'} = {}) {
  const calls = [], asked = [], fixed = [];
  const ok = (stdout = '') => ({code: 0, stdout, stderr: ''});
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const a = args.join(' ');
    if (cmd === 'git') {
      if (a === 'rev-parse --is-inside-work-tree') return repo ? ok('true\n') : {code: 128, stdout: '', stderr: 'not a git repository'};
      if (a === 'rev-parse --abbrev-ref HEAD') return ok(branch + '\n');
      if (a.startsWith('merge --no-edit')) return mergeConflict ? {code: 1, stdout: '', stderr: 'CONFLICT'} : ok('');
      if (a === 'diff --name-only --diff-filter=U') return ok('a.js\nb.css\n');
      return ok('');
    }
    if (a === 'auth status') return auth === 0 ? ok('') : {code: auth, stdout: '', stderr: auth === 127 ? 'ENOENT' : 'You are not logged into any GitHub hosts. token ghp_abcdefghijklmnopqrstuvwxyz0123'};
    if (a.startsWith('pr view')) return ok(JSON.stringify(pr));
    if (a.startsWith('pr list')) return ok(JSON.stringify([{number: 7, title: pr.title, headRefName: pr.headRefName, isDraft: pr.isDraft}]));
    if (a.startsWith('pr diff')) return ok('diff --git a/x.js b/x.js\n+const y = 1;\n');
    if (a.startsWith('pr checks')) return ok(JSON.stringify([{name: 'ci', state: 'SUCCESS', bucket: 'pass', link: ''}]));
    if (a.startsWith('pr comment')) return ok('https://example.test/pr/7#c1\n');
    return ok('');
  };
  const flow = new PrFlow({scope: () => ({root: '/repo', bound}), run,
    ask: async (key, prompt, opts) => { asked.push({key, prompt, opts}); return answer; },
    fix: async (key, job) => { fixed.push({key, job}); return {threadId: 't1'}; }});
  const ghCalls = () => calls.filter((c) => c[0] === 'gh').map((c) => c.slice(1).join(' '));
  return {flow, calls, asked, fixed, ghCalls};
}

test('前提：只在 Metre 会话；没绑文件夹 / 不是仓库 / 没装 gh / gh 没登录 → ready:false + 一句话（令牌被抹掉）', async () => {
  const {flow} = harness();
  await assert.rejects(flow.status({sessionKey: 'agent:project:w'}), /只在 Metre/);
  assert.match((await harness({bound: false}).flow.status({sessionKey: KEY})).why, /绑一个项目文件夹/);
  assert.match((await harness({repo: false}).flow.status({sessionKey: KEY})).why, /不是 git 仓库/);
  assert.match((await harness({auth: 127}).flow.status({sessionKey: KEY})).why, /没装 gh/);
  const notIn = await harness({auth: 1}).flow.status({sessionKey: KEY});
  assert.equal(notIn.ready, false); assert.match(notIn.why, /gh auth login/);
  assert.doesNotMatch(JSON.stringify(notIn), /ghp_/);
  const ready = await flow.status({sessionKey: KEY});
  assert.equal(ready.ready, true); assert.equal(ready.current.number, 7); assert.equal(ready.recent.length, 1);
});

test('审查：读 PR 和改动交给引擎（只读），结果按严重程度排、带文件和行；坏 JSON 兜底成一条 low', async () => {
  const answer = '好的：\n```json\n[{"severity":"low","file":"x.js","line":"3","title":"命名"},{"severity":"HIGH","file":"x.js","line":1,"title":"会崩","detail":"y 没定义"},{"severity":"weird","file":"a","line":-2,"title":"t"}]\n```';
  const h = harness({answer});
  const out = await h.flow.review({sessionKey: KEY, number: 7});
  assert.deepEqual(out.findings.map((f) => [f.severity, f.file, f.line]), [['high', 'x.js', 1], ['low', 'x.js', 3], ['low', 'a', 0]]);
  assert.equal(out.head, HEAD);
  assert.equal(h.asked[0].opts.readOnly, true);
  assert.match(h.asked[0].prompt, /只读，不要改文件、不要提交、不要合并/);
  assert.match(h.asked[0].prompt, /const y = 1/);
  assert.deepEqual(plain(parseFindings('我觉得都挺好')), [{severity: 'low', file: '', line: 0, title: '引擎的审查没按格式回，原文如下', detail: '我觉得都挺好'}]);
  assert.deepEqual(parseFindings(''), []);
  assert.deepEqual(parseFindings('[]'), []);
  assert.equal(h.flow.progress.get(KEY).phase, 'done');
});

test('跟进：看 CI；跟 main 只 merge，不变基不 force；有冲突就撤回并报文件；分支不对就停', async () => {
  const h = harness();
  const out = await h.flow.followUp({sessionKey: KEY, number: 7, steps: ['ci', 'main']});
  assert.equal(out.ci.length, 1); assert.deepEqual(out.main, {merged: true, conflicts: []});
  const git = h.calls.filter((c) => c[0] === 'git').map((c) => c.slice(1).join(' '));
  assert.ok(git.includes('merge --no-edit origin/main'));
  assert.ok(!git.some((a) => /rebase|push|--force|reset --hard/.test(a)), git.join(' | '));
  const c = harness({mergeConflict: true});
  const bad = await c.flow.followUp({sessionKey: KEY, number: 7, steps: ['main']});
  assert.deepEqual(bad.main, {merged: false, conflicts: ['a.js', 'b.css']});
  assert.ok(c.calls.some((x) => x[0] === 'git' && x[1] === 'merge' && x[2] === '--abort'));
  assert.equal(c.flow.progress.get(KEY).phase, 'failed');
  await assert.rejects(harness({branch: 'main'}).flow.followUp({sessionKey: KEY, number: 7, steps: ['main']}), /先切过去/);
});

test('跟进：按意见改交给引擎；回评论要正文和界面上的确认', async () => {
  const h = harness();
  await assert.rejects(h.flow.followUp({sessionKey: KEY, number: 7, steps: ['fix'], findings: []}), /先选要改/);
  const out = await h.flow.followUp({sessionKey: KEY, number: 7, steps: ['fix'], findings: [{severity: 'high', file: 'x.js', line: 1, title: '会崩'}]});
  assert.deepEqual(out.fix, {threadId: 't1'});
  assert.equal(h.fixed[0].job.branch, 'feat/button');
  await assert.rejects(h.flow.followUp({sessionKey: KEY, number: 7, steps: ['reply'], body: '改好了'}), /点「发」/);
  await assert.rejects(h.flow.followUp({sessionKey: KEY, number: 7, steps: ['reply'], body: ' ', confirm: true}), /先写好正文/);
  const sent = await h.flow.followUp({sessionKey: KEY, number: 7, steps: ['reply'], body: '改好了', confirm: true});
  assert.match(sent.reply.url, /#c1/);
  assert.ok(h.ghCalls().some((a) => /^pr comment 7 --body-file /.test(a)));
});

test('反例：审查和跟进的每一步都没调 gh pr merge', async () => {
  const h = harness({answer: '[{"severity":"high","file":"x.js","line":1,"title":"会崩"}]'});
  await h.flow.status({sessionKey: KEY});
  await h.flow.review({sessionKey: KEY, number: 7});
  await h.flow.followUp({sessionKey: KEY, number: 7, steps: ['ci', 'main', 'fix', 'reply'], findings: [{severity: 'high', title: 'x'}], body: '好', confirm: true});
  assert.ok(!h.ghCalls().some((a) => /^pr merge/.test(a)), h.ghCalls().join(' | '));
});

test('合并：只认界面传来的「号@头」；头变了 / 草稿 / CI 没绿 / 不是打开的都拒绝；合并带 --match-head-commit', async () => {
  const sk = {sessionKey: KEY, number: 7};
  await assert.rejects(harness().flow.merge({...sk}), /头变了或没确认/);
  await assert.rejects(harness().flow.merge({...sk, confirm: '7@oldhead'}), /头变了或没确认/);
  await assert.rejects(harness({pr: {...PR, isDraft: true}}).flow.merge({...sk, confirm: `7@${HEAD}`}), /草稿/);
  await assert.rejects(harness({pr: {...PR, statusCheckRollup: [{conclusion: 'FAILURE'}]}}).flow.merge({...sk, confirm: `7@${HEAD}`}), /CI 还没全绿/);
  await assert.rejects(harness({pr: {...PR, statusCheckRollup: []}}).flow.merge({...sk, confirm: `7@${HEAD}`}), /CI 还没全绿/);
  await assert.rejects(harness({pr: {...PR, state: 'MERGED'}}).flow.merge({...sk, confirm: `7@${HEAD}`}), /不是打开的/);
  const h = harness();
  assert.deepEqual(await h.flow.merge({...sk, confirm: `7@${HEAD}`}), {number: 7, merged: true, head: HEAD});
  assert.ok(h.ghCalls().includes(`pr merge 7 --merge --match-head-commit ${HEAD}`), h.ghCalls().join(' | '));
});

test('网关方法：五个都挂上；出错时回 respond(false) 且消息里没有令牌', async () => {
  const methods = new Map();
  const api = {registerGatewayMethod: (name, fn, opts) => methods.set(name, {fn, opts})};
  const h = harness({auth: 1});
  registerPrFlow(api, {flow: h.flow});
  assert.deepEqual([...methods.keys()].sort(), ['pinkie.pr.followUp', 'pinkie.pr.merge', 'pinkie.pr.review', 'pinkie.pr.status', 'pinkie.pr.stop']);
  assert.equal(methods.get('pinkie.pr.merge').opts.scope, 'operator.admin');
  let got = null;
  await methods.get('pinkie.pr.review').fn({params: {sessionKey: KEY, number: 7}, respond: (...a) => { got = a; }});
  assert.equal(got[0], false); assert.match(got[2].message, /gh auth login/); assert.doesNotMatch(got[2].message, /ghp_/);
  assert.equal(redact('x ghp_abcdefghijklmnopqrstuvwxyz0123 y github_pat_ABCDEFGHIJKLMNOPQRSTUV_123 z'), 'x [已隐去] y [已隐去] z');
  assert.match(reviewPrompt({pr: PR, diff: 'D'}), /#7「加一个按钮」（feat\/button → main）/);
});
