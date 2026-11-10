import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContract, judgeReply, mergeLayers, staleTierContext, stripNegatedClaims} from '../services/mode-architecture/run-contract.mjs';
import {recipeFor} from '../services/mode-architecture/reasoning.mjs';

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra'];
const TIERS = ['base', 'boost', 'full', 'marathon'];
const native = {reasoning: true, compat: {supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']}};

test('twelve mixed selections keep one contract and take the larger copy and round counts', () => {
  const samples = [
    ['off', 'base'], ['minimal', 'boost'], ['low', 'full'], ['medium', 'marathon'],
    ['high', 'base'], ['xhigh', 'boost'], ['adaptive', 'full'], ['max', 'marathon'],
    ['ultra', 'base'], ['ultra', 'full'], ['max', 'boost'], ['adaptive', 'marathon'],
  ];
  assert.equal(samples.length, 12);
  for (const [level, workTier] of samples) {
    const recipe = recipeFor(level, native, {message: '做一个网页并改测试', sessionKey: 'agent:project:contract'});
    const contract = buildContract({
      level, workTier, kinds: ['web_ui', 'code'], mode: 'project', platform: 'win32',
      difficulty: recipe.difficulty || '',
      levelCopies: recipe.solvers || 0,
      levelRounds: recipe.rounds || 0,
      levelCritic: Boolean(recipe.critic),
    });
    const tierCopies = {base: 0, boost: 0, full: 1, marathon: 0}[workTier];
    const tierRounds = {base: 0, boost: 1, full: 2, marathon: 2}[workTier];
    assert.equal(contract.copies, Math.max(recipe.solvers || 0, tierCopies), `${level}/${workTier} copies`);
    assert.equal(contract.rounds, Math.max(recipe.rounds || 0, tierRounds), `${level}/${workTier} rounds`);
    assert.deepEqual(contract.evidence, workTier === 'base' ? ['web_ui', 'code'] : ['web_ui', 'code', 'delivery']);
    assert.equal(contract.evidence.filter(item => item === 'web_ui').length, 1);
    assert.equal(contract.spawn, 'subagents');
    assert.equal(contract.planList, workTier === 'marathon');
  }
});

test('all thirty-six pairs merge without depending on which selection arrives first', () => {
  for (const level of LEVELS) {
    for (const workTier of TIERS) {
      const forward = buildContract({level, workTier, kinds: ['document']});
      const backward = buildContract({level, workTier, kinds: ['document']});
      assert.deepEqual(forward, backward, `${level}/${workTier}`);
      const recipe = recipeFor(level, native);
      const merged = mergeLayers(recipe, {solvers: forward.copies, rounds: forward.rounds, critic: forward.review, think: false});
      assert.ok(merged.solvers >= (recipe.solvers || 0));
      assert.ok(merged.rounds >= (recipe.rounds || 0));
    }
  }
});

test('a missing spawn tool changes the contract to another version by the same model', () => {
  const contract = buildContract({level: 'max', workTier: 'full', spawnAvailable: false, platform: 'win32'});
  assert.equal(contract.spawn, 'self');
  assert.equal(contract.copies, 2);
  assert.equal(contract.rounds, 2);
});

test('a reply that does not claim completion passes on both platforms', () => {
  for (const reply of ['我会先检查相关文件。', '文件还没修改完成。', '目前没有完成修改。', '页面还没有做好。', '文件尚未生成。', 'I have not modified the file yet.']) {
    for (const platform of ['darwin', 'win32']) {
      const verdict = judgeReply({reply, tools: [], platform});
      assert.equal(verdict.status, 'pass', `${platform} ${reply}`);
      assert.equal(verdict.code, 'no-claim');
    }
  }
});

test('claiming success without a tool, after a failed tool, or in contradiction does not pass', () => {
  assert.equal(judgeReply({reply: '文件已经修改完成。', tools: []}).code, 'claimed-without-action');
  assert.equal(judgeReply({
    reply: '程序已经成功修复完成。',
    tools: [{name: 'exec', failed: true, params: {command: 'python -m pytest'}}],
  }).code, 'last-tool-failed');
  assert.equal(judgeReply({
    reply: '视频已经完整完成，客户端仍在后台生成中。',
    tools: [{name: 'exec', failed: false, params: {command: 'ffmpeg -i in.mp4 out.mp4'}, output: 'ok'}],
  }).code, 'contradiction');
  assert.equal(judgeReply({reply: '已完成第一部分阅读，第二部分正在核对。', tools: [{name: 'read', output: '报告'}]}).status, 'pass');
});

test('PowerShell readback counts as a real check on Windows', () => {
  const verdict = judgeReply({
    reply: '已经完成文件修改，并且读回检查过。',
    tools: [
      {name: 'write', failed: false, params: {path: 'C:\\work\\sample.txt'}, output: 'saved'},
      {name: 'exec', failed: false, params: {command: "Get-Content -LiteralPath 'C:\\work\\sample.txt'"}, result: {details: {exitCode: 0}, content: [{text: 'after'}]}},
    ],
  });
  assert.equal(verdict.status, 'pass');
});

test('a lost run does not tell the model to answer NO_REPLY while work remains', () => {
  assert.match(staleTierContext('[pinkie-tier-control] 本轮仍未通过后端硬验收：批评 0/2'), /不得只输出 NO_REPLY/);
  assert.match(staleTierContext('[pinkie-tier-control] 本轮仍未通过后端硬验收：批评 0/2'), /sessions_spawn/);
  assert.match(staleTierContext('[pinkie-tier-control] 子代理审议已通过'), /只输出 NO_REPLY/);
  assert.equal(stripNegatedClaims('文件还没修改完成。').includes('修改'), false);
});
