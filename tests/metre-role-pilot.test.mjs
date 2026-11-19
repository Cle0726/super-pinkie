import assert from 'node:assert/strict';
import {test} from 'node:test';
import {composeMetreArms, metrePilotMatrix} from '../tools/metre/roles/compose.mjs';

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
