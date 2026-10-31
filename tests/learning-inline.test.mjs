import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, createLearningActivityTool, learningPrompt} from '../services/mode-architecture/learning.mjs';
import {normalizeVisual} from '../services/mode-architecture/learning-visuals.mjs';
import {pinkieLearningInlineReferences, pinkieBuildTimeline} from '../patch/apply-chat-timeline.mjs';

const key = 'agent:learning:inline';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-inline-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const options = {root: path.join(root, 'state'), workspace: path.join(root, 'workspace')};
  return {store: new LearningInteractionStore(options), options};
}
const plot = () => ({kind: 'function_plot', topic: '二次函数', visual: {family: 'quadratic', domain: [-5, 5],
  parameters: [{key: 'a', min: -3, max: 3, step: .1, value: 1}]}});
const flow = () => ({kind: 'process_flow', topic: 'Hadoop', visual: {steps: [
  {id: 'map', label: 'Map', description: '生成中间键值对'},
  {id: 'shuffle', label: 'Shuffle', description: '按键分组'},
  {id: 'reduce', label: 'Reduce', description: '聚合结果'},
]}});

test('visual tool results expose a renderable reference and retries preserve the same durable widget', async t => {
  const {store, options} = fixture(t);
  const tool = createLearningActivityTool(store, {sessionKey: key});
  store.setEnabled(key, false);
  const first = (await tool.execute('call-1', {...plot(), action: 'present'})).details;
  assert.equal(first.inline.kind, 'function_plot');
  assert.equal(first.inline.sessionKey, key);
  assert.equal(store.status(key).enabled, false, 'showing a requested diagram does not reopen quiz cards the student closed');
  store.visuals.save(key, {id: first.visual.id, revision: first.visual.revision, state: {values: {a: 2}}});
  const again = (await tool.execute('call-1', {...plot(), action: 'present'})).details;
  assert.equal(again.visual.id, first.visual.id);
  assert.equal(again.visual.state.values.a, 2, 'a tool retry cannot reset the selected parameter');
  assert.equal(new LearningInteractionStore(options).inline(key, first.visual.id, 'function_plot').visual.state.values.a, 2);
});

test('visual parameter writes are atomic, versioned and scoped to the exact session', t => {
  const {store} = fixture(t);
  const visual = store.present(key, plot()).visual;
  assert.throws(() => store.visuals.get('agent:learning:other', visual.id), /不存在/);
  assert.throws(() => store.visuals.save(key, {id: visual.id, revision: 0, state: {values: {a: 2}}}), /已更新/);
  for (const values of [{a: Infinity}, {a: 4}, {a: 2, wrong: 1}]) {
    assert.throws(() => store.visuals.save(key, {id: visual.id, revision: visual.revision, state: {values}}));
    assert.equal(store.visuals.get(key, visual.id).state.values.a, 1);
  }
  const changed = store.visuals.save(key, {id: visual.id, revision: visual.revision, state: {values: {a: 1.24}}});
  assert.equal(changed.state.values.a, 1.2);
  assert.throws(() => store.visuals.save(key, {id: visual.id, revision: visual.revision, state: {values: {b: 2}}}), /已更新/);
  assert.equal(store.listAttempts(key).attempts.length, 0);
  assert.match(learningPrompt(store, key), /"a":1.2/);
  assert.match(learningPrompt(store, key), /不代表已掌握/);
});

test('process selections survive restarts without creating a false mastery record', t => {
  const {store, options} = fixture(t);
  const shown = store.present(key, flow()).visual;
  const result = store.visuals.save(key, {id: shown.id, revision: shown.revision, state: {selectedStep: 'shuffle'}});
  assert.equal(result.state.selectedStep, 'shuffle');
  assert.equal(new LearningInteractionStore(options).visuals.get(key, shown.id).state.selectedStep, 'shuffle');
  assert.match(learningPrompt(store, key), /Shuffle/);
  assert.equal(store.mastery(key).independentCorrect, 0);
  assert.throws(() => store.visuals.save(key, {id: shown.id, revision: result.revision, state: {selectedStep: 'missing'}}), /不存在/);
  assert.throws(() => store.inline(key, shown.id, 'function_plot'), /类型不匹配/);
});

test('a repeated quiz tool call cannot reset answers or reopen a replaced quiz', async t => {
  const {store} = fixture(t); store.setEnabled(key, true);
  const tool = createLearningActivityTool(store, {sessionKey: key});
  const args = {action: 'present', kind: 'single_choice', question: 'He ___ here.', options: ['is', 'are'], correct_answer: '1'};
  const first = (await tool.execute('quiz-retry', args)).details;
  store.submit(key, {activityId: first.current.id, answer: '1'});
  const retry = (await tool.execute('quiz-retry', args)).details;
  assert.equal(retry.current.id, first.current.id);
  assert.equal(retry.current.submission.answer, '1');
  assert.equal(retry.current.presentationCallId, undefined);
  const next = (await tool.execute('quiz-next', args)).details;
  const historicalRetry = (await tool.execute('quiz-retry', args)).details;
  assert.equal(historicalRetry.inline.id, first.current.id);
  assert.equal(store.status(key).current.id, next.current.id);
  assert.equal(store.inline(key, first.current.id, 'quiz').readOnly, true);
});

test('historical cards reflect audited corrections made after a newer question is shown', t => {
  const {store, options} = fixture(t); store.setEnabled(key, true);
  const first = store.present(key, {kind: 'fill_blank', question: '2+2?', correct_answer: '4'}).current;
  store.submit(key, {activityId: first.id, answer: '5'});
  store.resolve(key, {activity_id: first.id, correct: false, explanation: '合成讲解'});
  const attemptId = store.status(key).current.submission.attemptId;
  store.present(key, {kind: 'short_answer', question: '下一题'});
  store.correctAttempt(key, attemptId, {correct: true, reason: '核对输入和原题后人工修正'});
  const restored = new LearningInteractionStore(options).inline(key, first.id, 'quiz');
  assert.equal(restored.activity.result.correct, true);
  assert.equal(restored.activity.result.gradeSource, 'user_correction');
  assert.equal(restored.readOnly, true);
});

test('visual definitions accept bounded data rather than executable formulas or HTML', () => {
  assert.throws(() => normalizeVisual({...plot(), visual: {family: 'eval(document.cookie)'}}), /函数图支持/);
  assert.throws(() => normalizeVisual({...plot(), visual: {domain: [5, -5]}}), /范围/);
  assert.throws(() => normalizeVisual({...flow(), visual: {steps: Array.from({length: 13}, () => ({label: 'step'}))}}), /2–12/);
  assert.throws(() => normalizeVisual({...flow(), visual: {steps: [{id: 'same', label: 'A'}, {id: 'same', label: 'B'}]}}), /不能重复/);
  const safe = normalizeVisual({...flow(), topic: '<script>alert(1)</script>'});
  assert.equal(safe.title, '<script>alert(1)</script>', 'the renderer receives text, never markup');
});

test('quiz history remains addressable after more than 24 later cards and never reveals private answers', t => {
  const {store, options} = fixture(t);
  store.setEnabled(key, true);
  const first = store.present(key, {kind: 'single_choice', question: 'He ___ here.', options: ['is', 'are'], correct_answer: '1'});
  store.submit(key, {activityId: first.current.id, answer: '1', confidence: 90});
  store.resolve(key, {activity_id: first.current.id, correct: true, explanation: '主谓一致'});
  for (let i = 0; i < 30; i++) store.present(key, {kind: 'short_answer', question: `题目 ${i}`, rubric: 'PRIVATE rubric', scoring_points: [{id: 'one', label: 'PRIVATE point'}]});
  const recovered = new LearningInteractionStore(options).inline(key, first.current.id, 'quiz');
  assert.equal(recovered.activity.result.correct, true);
  assert.equal(recovered.activity.submission.answer, '1');
  assert.equal(recovered.readOnly, true);
  assert.equal('correctAnswer' in recovered.activity, false);
  const current = store.inline(key, store.status(key).current.id, 'quiz');
  assert.doesNotMatch(JSON.stringify(current), /PRIVATE/);
  assert.throws(() => store.inline('agent:learning:other', first.current.id, 'quiz'), /不存在/);
});

test('quiz drafts restore independently of grading and reject stale or ended writes', t => {
  const {store, options} = fixture(t);
  store.setEnabled(key, true);
  const activity = store.present(key, {kind: 'fill_blank', question: '2+2?', correct_answer: '4'}).current;
  store.saveInlineDraft(key, {id: activity.id, itemId: activity.id, revision: 0, answer: '4', confidence: 90, hintUsed: true});
  const restored = new LearningInteractionStore(options).inline(key, activity.id, 'quiz');
  assert.equal(restored.drafts.items[activity.id].answer, '4');
  assert.equal(restored.activity.submission, null);
  assert.equal(store.listAttempts(key).attempts.length, 0);
  assert.throws(() => store.saveInlineDraft(key, {id: activity.id, itemId: activity.id, revision: 0, answer: '5'}), /已更新/);
  store.submit(key, {activityId: activity.id, answer: '4'});
  assert.throws(() => store.saveInlineDraft(key, {id: activity.id, itemId: activity.id, revision: 1, answer: '5'}), /已提交/);
});

test('only a successful learning tool presentation creates an inline reference', async t => {
  const {store} = fixture(t);
  const tool = createLearningActivityTool(store, {sessionKey: key});
  const result = await tool.execute('flow-1', {...flow(), action: 'present'});
  const calls = [{name: 'learning_activity', outputText: JSON.stringify(result.details)}];
  const refs = pinkieLearningInlineReferences([{messages: [{message: {}}]}], () => calls);
  assert.equal(refs.length, 1);
  for (const bad of [{...calls[0], name: 'exec'}, {...calls[0], isError: true}, {...calls[0], outputText: '<script>hi</script>'}]) {
    assert.equal(pinkieLearningInlineReferences([{messages: [{message: {}}]}], () => [bad]).length, 0);
  }
  assert.equal(pinkieLearningInlineReferences([{messages: [{message: {}}, {message: {}}]}], () => calls).length, 1);
});
