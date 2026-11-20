import assert from 'node:assert/strict';
import {test} from 'node:test';
import {composeMetreArms, metrePilotMatrix, metreReleaseMatrix} from '../tools/metre/roles/compose.mjs';

test('Metre roles A/B/C share the brief and only B pastes the card in the user message', () => {
  const brief = '看 fixture 中的结果，只报告三条证据。';
  const arms = composeMetreArms('reviewer', brief, {model: 'example/same-execution-model'});
  assert.equal(arms.A.briefSha256, arms.B.briefSha256);
  assert.equal(arms.B.briefSha256, arms.C.briefSha256);
  assert.equal(arms.C.dispatch.prompt, brief);
  assert.equal(arms.C.dispatch.role, 'reviewer');
  assert.equal(arms.C.dispatch.model, arms.A.model);
  assert.doesNotMatch(arms.A.message, /## 交回/);
  assert.match(arms.B.message, /## 交回/);
  assert.match(arms.C.cardPromptPreview, /【角色卡：挑刺验收员】/);
  assert.doesNotMatch(arms.C.messagePreview, /## 交回|你最后一条回复就是交回去的汇报/);
  assert.throws(() => composeMetreArms('constructor', brief), /不在合格官方卡列表中/);
});

test('Metre roles offline pilot fixture has 8 cases, 3 arms, 2 runs per arm and no rubric leakage', () => {
  const plan = metrePilotMatrix('one-model-for-all');
  assert.equal(plan.status, 'prepared-not-run');
  assert.equal(plan.cases.length, 8);
  assert.equal(plan.runs.length, 48);
  assert.equal(new Set(plan.runs.map(r => r.id)).size, 48);
  for (const sample of plan.cases) {
    const runs = plan.runs.filter(r => r.caseId === sample.id);
    assert.deepEqual(runs.map(r => r.group + r.repeat), ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    assert.equal(new Set(runs.map(r => r.briefSha256)).size, 1);
    assert.ok(runs.every(r => r.model === plan.model));
    assert.ok(runs.every(r => !r.checks && !r.plantedIssues));
  }
  assert.throws(() => metrePilotMatrix(''), /三组共用/);
});

test('release trial has eight matched A/C runs, no paid route or same-vendor judge', () => {
  // These ids model syntax and vendor discovery, not live route availability.
  const tencent = 'mm/workbuddy/hy4flash-free', qwen = 'example/qwen-3:free';
  const result = metreReleaseMatrix(tencent, qwen);
  assert.equal(result.status, 'prepared-not-run');
  assert.equal(result.allowPaidFallback, false);
  assert.equal(result.execution.vendor, 'tencent');
  assert.equal(result.judge.vendor, 'qwen');
  assert.deepEqual(result.judgement, {independentVendor: true, separateContext: true});
  assert.equal(result.runs.length, 8);
  assert.equal(new Set(result.runs.map(run => run.id)).size, 8);
  assert.deepEqual(result.cases.filter(row => row.needsVision).map(row => row.role), ['ui-replicator']);
  for (const item of result.cases) {
    const [a, c] = result.runs.filter(run => run.caseId === item.id);
    assert.deepEqual([a.group, c.group], ['A', 'C']);
    assert.equal(a.model, tencent);
    assert.equal(c.dispatch.model, tencent);
    assert.equal(a.briefSha256, c.briefSha256);
    assert.equal(a.fixtureSha256, item.fixtureSha256);
    assert.equal(c.fixtureSha256, item.fixtureSha256);
    assert.ok(!a.checks && !c.plantedIssues);
    if (['researcher', 'backend-fix'].includes(item.role)) {
      assert.ok(item.files.some(file => file.path === 'probe/preserve.txt'));
      assert.match(c.dispatch.prompt, /probe\/internal-note\.md/);
      assert.ok(item.checks.some(check => check.startsWith('X4：')));
    }
  }
  assert.throws(() => metreReleaseMatrix(tencent, 'router/workbuddy/hy4free'), /异厂/);
  assert.throws(() => metreReleaseMatrix(tencent, 'qwen-3'), /指定免费路由/);
  assert.throws(() => metreReleaseMatrix(tencent, 'unknown/free'), /厂家无法确认/);
});

test('explicit single-model review only changes judging provenance, not the eight executions', () => {
  const free = 'mm/workbuddy/hy4flash-free', other = 'example/qwen-3:free';
  const plan = metreReleaseMatrix(free, free, {sameModelReview: true});
  assert.deepEqual(plan.judgement, {independentVendor: false, separateContext: true});
  assert.deepEqual(plan.execution, plan.judge);
  assert.deepEqual(plan.runs, metreReleaseMatrix(free, other).runs);
  assert.throws(() => metreReleaseMatrix(free, free), /异厂/);
  assert.throws(() => metreReleaseMatrix(free, other, {sameModelReview: true}), /同一条免费路由/);
  assert.throws(() => metreReleaseMatrix('hy4flash', 'hy4flash', {sameModelReview: true}), /指定免费路由/);
});
