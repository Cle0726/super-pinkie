import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, createLearningActivityTool, learningPrompt, bankSourceGuard} from '../services/mode-architecture/learning.mjs';
import {buildBankPaper, drawBankItems, expandBankPresent, normalizeBankSpec, toQuizItems, bankStats} from '../services/mode-architecture/learning-zsb.mjs';

const key = 'agent:learning:zsb-qa';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-zsb-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const opts = {root: path.join(root, 'state'), workspace: path.join(root, 'workspace-learning')};
  return {opts, store: new LearningInteractionStore(opts)};
}
const save = (store, r, state) => store.visuals.save(key, {id: r.id, revision: r.revision, state});

test('the bank covers every subject and validates its own spec', () => {
  const stats = bankStats();
  for (const s of ['ee', 'c', 'net', 'math', 'en']) assert.ok(stats.bySubject[s] > 20, s);
  assert.ok(stats.generators > 20);
  assert.throws(() => normalizeBankSpec({points: ['net99']}), /考点编号/);
  assert.throws(() => normalizeBankSpec({count: 0}), /1–60/);
  assert.throws(() => normalizeBankSpec({types: ['essay']}), /single/);
  assert.throws(() => normalizeBankSpec({paper: 'physics'}), /pro/);
});

test('every bank and generated question converts to a well-formed card with its answer kept private', () => {
  for (const subject of ['ee', 'c', 'net', 'math', 'en']) {
    for (const q of drawBankItems({subject, types: ['single', 'judge', 'fill', 'app', 'write'], count: 60, seed: 11})) {
      for (const item of toQuizItems(q)) {
        assert.ok(item.question && !/<\/?(pre|b|br)>|&lt;/.test(item.question), item.id);
        assert.match(item.rubric, /参考答案/);
        if (item.kind === 'single_choice') assert.ok(item.options.map((o, j) => o.id || String(j + 1)).includes(item.correct_answer), item.id);
        if (item.kind === 'fill_blank') assert.ok(item.accepted_answers.includes(item.correct_answer), item.id);
      }
    }
  }
});

test('bank cards present without exposing answers, grade on the server, and reveal the reference only after answering', async t => {
  const {store} = fixture(t);
  store.setEnabled(key, true);
  const tool = createLearningActivityTool(store, {sessionKey: key});
  const response = await tool.execute('call-1', {action: 'present', bank: {points: ['net4'], types: ['single'], count: 1, seed: 3}});
  assert.equal(response.isError, false, response.details?.error);
  const card = response.details.current;
  assert.match(card.id, /^zsb-/);
  assert.doesNotMatch(JSON.stringify(response.details), /参考答案|correctAnswer|rubric/);
  assert.doesNotMatch(learningPrompt(store, key), /【题库参考：/);
  assert.match(learningPrompt(store, key), /net4 网络层/);

  const raw = store.read(key).current;
  const right = raw.correctAnswer;
  const submitted = store.submit(key, {activityId: card.id, answer: right, submissionId: 's1', confidence: 90});
  assert.equal(submitted.current.submission.correctness, true);
  const prompt = learningPrompt(store, key);
  assert.match(prompt, /【题库参考：/);
  assert.match(prompt, new RegExp(card.id));
});

test('a batch draw prefers questions this session has not answered yet', t => {
  const {store} = fixture(t);
  store.setEnabled(key, true);
  const first = store.present(key, {bank: {points: ['net4'], types: ['single'], count: 3, source: 'original', seed: 1}}).current;
  assert.equal(first.kind, 'batch');
  for (const item of first.items) store.submit(key, {activityId: first.id, itemId: item.id, answer: item.options[0].id, submissionId: 'a-' + item.id});
  const answered = new Set(first.items.map(item => item.id));
  const second = store.present(key, {bank: {points: ['net4'], types: ['single'], count: 2, source: 'original', seed: 1}}).current;
  for (const item of second.items) assert.equal(answered.has(item.id), false, item.id);
});

test('app questions expand into one card per blank', () => {
  const payload = expandBankPresent({action: 'present', bank: {points: ['net4'], types: ['app'], count: 1, source: 'imported', seed: 5}});
  assert.equal(payload.kind, 'batch');
  assert.ok(payload.items.length >= 4);
  assert.ok(payload.items.every(item => item.kind === 'fill_blank' && /-b\d+$/.test(item.id)));
});

test('考纲 papers have the official structure and exact totals', () => {
  for (let seed = 0; seed < 10; seed++) {
    const pro = buildBankPaper('pro', {seed});
    assert.equal(pro.durationMinutes, 150);
    assert.ok(Math.abs(pro.questions.reduce((s, q) => s + q.points, 0) - 300) < 1e-9);
    assert.equal(pro.questions.filter(q => q.kind === 'single_choice').length, 30);
    assert.equal(pro.questions.filter(q => q.kind === 'judgement').length, 15);
    for (const s of ['ee', 'c', 'net']) assert.ok(Math.abs(buildBankPaper(s, {seed}).questions.reduce((a, q) => a + q.points, 0) - 100) < 1e-9);
  }
  assert.equal(buildBankPaper('math', {seed: 1}).questions.reduce((s, q) => s + q.points, 0), 150);
  assert.equal(buildBankPaper('math', {seed: 1}).questions.length, 23);
});

test('bank choices use A–D like the paper, and an English paper keeps each passage together', () => {
  const [card] = toQuizItems(drawBankItems({subject: 'net', types: ['single'], count: 1, seed: 4})[0]);
  assert.deepEqual(card.options.map(o => o.id), ['A', 'B', 'C', 'D']);
  assert.match(card.rubric, new RegExp(`参考答案：${card.correct_answer}\\. `));
  for (let seed = 0; seed < 5; seed++) {
    const passages = buildBankPaper('en', {seed}).questions.map(q => q.question.match(/^【阅读材料】\n(.{20})/)?.[1]).filter(Boolean);
    assert.equal(passages.filter((p, i) => i && p !== passages[i - 1]).length, new Set(passages).size - 1, 'passages interleave');
  }
});

test('a bank mock exam hides answers until submission and a retried call rebuilds the same paper', async t => {
  const {store} = fixture(t);
  const tool = createLearningActivityTool(store, {sessionKey: key});
  const first = await tool.execute('call-exam', {action: 'present', kind: 'mock_exam', visual: {bank: {paper: 'c'}}});
  assert.equal(first.isError, false, first.details?.error);
  const visual = first.details.visual;
  assert.equal(visual.title, 'C语言单科卷（100 分）');
  assert.ok(visual.definition.questions.every(q => q.answer === undefined && q.explanation === undefined));
  const again = await tool.execute('call-exam', {action: 'present', kind: 'mock_exam', visual: {bank: {paper: 'c'}}});
  assert.deepEqual(again.details.visual.definition.questions.map(q => q.id), visual.definition.questions.map(q => q.id));

  let r = save(store, visual, {start: true});
  const q = store.visuals.get(key, visual.id).definition.questions.find(x => x.kind === 'fill_blank');
  r = save(store, r, {answers: {[q.id]: q.answer}, submit: true});
  const done = store.visuals.public(r);
  assert.equal(done.state.results.find(x => x.id === q.id).correct, true);
  assert.equal(done.analysis.total, 100);
});

test('learning sessions cannot open the answer-bearing bank sources, and a session the student closed says how to reopen it', t => {
  const learning = {sessionKey: key};
  for (const params of [{command: 'grep -n c5 "/Volumes/Cle/学习/专升本/广西专升本/06_互动学习台/src/bank_pro.js"'},
    {command: 'node -e \'import("/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/services/mode-architecture/learning-zsb.mjs")\''},
    {path: '/Volumes/Cle/学习/专升本/广西专升本/06_互动学习台/学习台.html'}]) {
    assert.equal(bankSourceGuard({toolName: 'exec', params}, learning)?.block, true, JSON.stringify(params));
  }
  assert.equal(bankSourceGuard({toolName: 'exec', params: {command: 'ls /Volumes/Cle/学习/专升本/广西专升本/02_高数'}}, learning), undefined);
  assert.equal(bankSourceGuard({toolName: 'exec', params: {command: 'cat learning-zsb.mjs'}}, {sessionKey: 'agent:project:x'}), undefined);

  const {store} = fixture(t);
  store.setEnabled(key, false);
  assert.throws(() => store.present(key, {bank: {subject: 'c', count: 1}}), /互动学习已关闭/);
  assert.match(learningPrompt(store, key), /交互讲解正常可用/);
});
