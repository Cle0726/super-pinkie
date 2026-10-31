import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LEARNING_NOTEBOOK_SESSION, calculateReviewSchedule, createLearningActivityTool} from '../services/mode-architecture/learning.mjs';
import {LearningPact} from '../services/mode-architecture/learning-pact.mjs';

const KEY = 'agent:learning:evidence';
const DAY = 86_400_000;
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-learning-evidence-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const store = new LearningInteractionStore({root: path.join(directory, 'state'), workspace: path.join(directory, 'workspace')});
  store.setEnabled(KEY, true);
  return store;
}
function answer(store, payload = {}, submission = {}, result = {}) {
  const shown = store.present(KEY, {kind: 'fill_blank', question: '2+2?', correct_answer: '4', ...payload});
  const submitted = store.submit(KEY, {activityId: shown.current.id, answer: '4', confidence: 90, ...submission});
  const resolved = store.resolve(KEY, {activity_id: shown.current.id, correct: true, explanation: '解释', ...result});
  return {shown, submitted, resolved, attemptId: submitted.current.submission.attemptId};
}

test('batch answers grade and schedule only their own approved notes, never apply a group boolean', t => {
  const store = fixture(t);
  const first = store.saveNote(KEY, {content: 'a = A'}).note;
  const second = store.saveNote(KEY, {content: 'b = B'}).note;
  const shown = store.present(KEY, {items: [
    {id: 'a', kind: 'fill_blank', question: 'a?', correct_answer: 'A', note_ids: [first.id]},
    {id: 'b', kind: 'fill_blank', question: 'b?', correct_answer: 'B', note_ids: [second.id]},
  ]});
  assert.equal(shown.current.kind, 'batch');
  assert.equal('correctAnswer' in shown.current.items[0], false);
  store.submit(KEY, {activityId: shown.current.id, itemId: 'a', answer: 'A', confidence: 90});
  assert.throws(() => store.resolve(KEY, {correct: true}), /逐题/);
  store.resolve(KEY, {item_id: 'a', correct: false});
  assert.equal(store.findOwnedNote(KEY, first.id).reviewCount, 1);
  assert.equal(store.findOwnedNote(KEY, second.id).reviewCount, 0);
  assert.equal(store.status(KEY).current.phase, 'asking');
  store.submit(KEY, {activityId: shown.current.id, itemId: 'b', answer: 'wrong', confidence: 90});
  const resolved = store.resolve(KEY, {item_results: [{item_id: 'b', correct: true, error_type: '概念混淆'}]});
  assert.equal(resolved.current.result.correct, false);
  assert.equal(resolved.current.items[0].result.correct, true);
  assert.equal(resolved.current.items[1].result.correct, false);
  assert.equal(store.findOwnedNote(KEY, first.id).lapses, 0);
  assert.equal(store.findOwnedNote(KEY, second.id).lapses, 1);
  assert.equal(store.listAttempts(KEY).total, 2);
});

test('objective grades survive contradictory model output and fill blanks accept explicit alternatives', t => {
  const store = fixture(t);
  const {resolved} = answer(store, {correct_answer: 'colour', accepted_answers: ['color']}, {answer: ' COLOR '}, {correct: false});
  assert.equal(resolved.current.result.correct, true);
  assert.equal(resolved.current.result.gradingConflict, true);
  assert.equal(resolved.current.result.gradeSource, 'deterministic');
  assert.equal('acceptedAnswers' in resolved.current, false);
});

test('rubric labels stay private until graded and incomplete scoring cannot advance a note', t => {
  const store = fixture(t);
  const note = store.saveNote(KEY, {content: 'boundary = 边界'}).note;
  const shown = store.present(KEY, {kind: 'short_answer', question: '解释边界', note_ids: [note.id], scoring_points: [{id: 'p1', label: '写出正确边界'}]});
  assert.equal('scoringPoints' in shown.current, false);
  store.submit(KEY, {activityId: shown.current.id, answer: '答案'});
  const pending = store.resolve(KEY, {correct: true, feedback: '待核对'});
  assert.equal(pending.current.result.correct, null);
  assert.equal(pending.current.phase, 'evaluating');
  assert.equal(store.findOwnedNote(KEY, note.id).reviewCount, 0);
  const graded = store.resolve(KEY, {correct: true, criteria: [{id: 'p1', met: false, feedback: '缺少条件'}]});
  assert.equal(graded.current.result.correct, false);
  assert.equal(graded.current.result.criteria[0].label, '写出正确边界');
  assert.equal(store.findOwnedNote(KEY, note.id).lapses, 1);
});

test('user corrections are audited, reconcile statistics and scheduling once, and cannot be overwritten by model replay', t => {
  const store = fixture(t);
  const pact = new LearningPact(store); store.pact = pact;
  const note = store.saveNote(KEY, {content: 'four = 四'}).note;
  const {shown, attemptId} = answer(store, {note_ids: [note.id]}, {answer: '5'});
  assert.equal(store.findOwnedNote(KEY, note.id).lapses, 1);
  const corrected = store.correctAttempt(KEY, attemptId, {correct: true, reason: '题目答案录错，已核对原文'});
  assert.equal(corrected.attempt.corrections.length, 1);
  assert.equal(corrected.state.current.result.gradeSource, 'user_correction');
  assert.equal(store.findOwnedNote(KEY, note.id).lapses, 0);
  assert.equal(store.findOwnedNote(KEY, note.id).reviewCount, 1);
  assert.equal(pact.today().progress.correct, 1);
  store.resolve(KEY, {activity_id: shown.current.id, correct: false, feedback: '旧结果'});
  assert.equal(store.status(KEY).current.result.gradeSource, 'user_correction');
  assert.equal(store.status(KEY).current.result.correctionReason, '题目答案录错，已核对原文');
  store.correctAttempt(KEY, attemptId, {correct: true, reason: '重放'});
  assert.equal(store.listAttempts(KEY).attempts[0].corrections.length, 1);
  assert.throws(() => store.correctAttempt(KEY, attemptId, {correct: false}), /更正原因/);
  assert.throws(() => store.correctAttempt('agent:learning:foreign', attemptId, {correct: false, reason: 'cross'}), /没有找到/);
});

test('durable evidence survives the 24-card UI history and process restart without leaking private answers', t => {
  const store = fixture(t);
  for (let index = 0; index < 30; index++) answer(store);
  assert.equal(store.read(KEY).history.length, 24);
  const reopened = new LearningInteractionStore({root: store.root, workspace: store.workspace});
  const first = reopened.listAttempts(KEY, {limit: 12});
  assert.equal(first.total, 30);
  assert.equal(first.nextCursor, 12);
  assert.equal(reopened.listAttempts(KEY, {cursor: first.nextCursor, limit: 30}).attempts.length, 18);
  assert.equal(reopened.listAttempts('agent:learning:foreign').total, 0);
  assert.equal(reopened.listAttempts(LEARNING_NOTEBOOK_SESSION).total, 30);
  assert.equal('correctAnswer' in first.attempts[0], false);
  assert.equal('rubric' in first.attempts[0], false);
});

test('same-day retry is practice and only an independent delayed retest clears a prior mistake', t => {
  const store = fixture(t);
  const {attemptId} = answer(store, {}, {answer: '5'});
  let retry = store.retryAttempt(KEY, attemptId);
  store.submit(KEY, {activityId: retry.current.id, answer: '4', confidence: 95});
  store.resolve(KEY, {correct: true});
  let original = store.readAttempt(KEY, attemptId);
  assert.ok(original.practicePassedBy);
  assert.equal(original.verifiedBy || '', '');
  assert.equal(store.listAttempts(KEY, {wrongOnly: true}).total, 1);
  original.submission.submittedAt -= DAY + 1000;
  store.writeAttempt(original);
  retry = store.retryAttempt(KEY, attemptId);
  store.submit(KEY, {activityId: retry.current.id, answer: '4', confidence: 95});
  store.resolve(KEY, {correct: true});
  assert.ok(store.readAttempt(KEY, attemptId).verifiedBy);
  assert.equal(store.listAttempts(KEY, {wrongOnly: true}).total, 0);
  assert.equal(store.mastery(KEY).delayedVerified, 1);
});

test('hints and unknown confidence cannot silently promote a guess to stable mastery', t => {
  const store = fixture(t);
  const baseline = {reviewLevel: 2, reviewCount: 3, lapses: 0};
  const assisted = calculateReviewSchedule(baseline, 'remembered', 1000, {confidence: 95, hintUsed: true});
  assert.equal(assisted.reviewLevel, 2);
  assert.equal(assisted.nextReviewAt, 1000 + DAY);
  assert.equal(calculateReviewSchedule(baseline, 'remembered', 1000, {confidence: 95}).reviewLevel, 3);
  assert.equal(calculateReviewSchedule(baseline, 'forgot', 1000, {confidence: 95}).nextReviewAt, 601000);
  const {submitted} = answer(store, {}, {confidence: null});
  assert.equal(submitted.current.submission.confidence, null);
  assert.equal(store.mastery(KEY).independentCorrect, 0);
  assert.equal(store.mastery(KEY).assistedCorrect, 0);
  assert.equal(store.mastery(KEY).uncertainCorrect, 1);
});

test('sources flow from an approved note through each question, result and durable evidence', t => {
  const store = fixture(t);
  const note = store.saveNote(KEY, {content: 'source = 来源'}).note;
  store.writeNotes([{...note, sourceAnchor: {bookId: 'book-1', title: '教材', location: 8, label: '第 8 页', quote: 'source = 来源'}}]);
  const {shown, resolved} = answer(store, {note_ids: [note.id]});
  assert.equal(shown.current.sources[0].bookId, 'book-1');
  assert.equal(resolved.current.result.sources[0].location, 8);
  assert.equal(store.listAttempts(KEY).attempts[0].sources[0].noteId, note.id);
  assert.equal(resolved.current.result.reviewedNotes[0].id, note.id);
});

test('today separates activity completion from mastery and caps automatic daily review without discarding backlog', t => {
  const store = fixture(t);
  const pact = new LearningPact(store); store.pact = pact;
  pact.set({daily: {minutes: 5, questions: 1}});
  for (let index = 0; index < 25; index++) store.saveNote(KEY, {content: `n${index} = 知识点`});
  // 笔记本 v2：笔记回顾每天最多 10 条，其余算积压，不丢。
  const queue = store.reviewQueue(LEARNING_NOTEBOOK_SESSION, {limit: 100});
  assert.equal(queue.notes.length, 10); assert.equal(queue.todayCount, 10); assert.equal(queue.backlog, 15);
  const before = pact.today({sessionKey: KEY});
  assert.equal(before.activityComplete, false);
  assert.equal(before.reviewPlan.target, 20);
  assert.equal(before.reviewPlan.backlog, 5);
  assert.equal(before.nextStep.kind, 'review');
  pact.mutateDay(pact.todayDate(), day => { day.minutes = 5; day.questions.answered = 1; });
  // 笔记的每日额度按「今天复习过的不同笔记」计，账本里别的复习（例如生词）不占这 10 条。
  for (const due of store.reviewQueue(LEARNING_NOTEBOOK_SESSION).notes) store.reviewNote(LEARNING_NOTEBOOK_SESSION, due.id, 'remembered');
  pact.recordReview({count: 10});
  const after = pact.today({sessionKey: KEY});
  assert.equal(after.activityComplete, true);
  assert.equal(after.mastery.assessed, 0);
  assert.equal(after.reviewPlan.remaining, 0);
  assert.equal(after.nextStep.kind, 'choice');
  assert.equal(store.reviewQueue(LEARNING_NOTEBOOK_SESSION).notes.length, 0);
  assert.equal(store.reviewQueue(LEARNING_NOTEBOOK_SESSION, {extra: true, limit: 5}).notes.length, 5);
});

test('next step respects the current session and does not overwrite an unfinished exercise', t => {
  const store = fixture(t);
  const foreign = 'agent:learning:foreign';
  answer(store, {}, {answer: '5'});
  const original = store.listAttempts(KEY).attempts[0];
  const record = store.readAttempt(KEY, original.id); record.nextRetestAt = 1; store.writeAttempt(record);
  store.setEnabled(foreign, true);
  assert.notEqual(store.nextStep({sessionKey: foreign}).kind, 'weak');
  const shown = store.present(KEY, {kind: 'short_answer', question: '当前题'});
  assert.equal(store.nextStep({sessionKey: KEY}).activityId, shown.current.id);
  store.complete(KEY);
  assert.equal(store.nextStep({sessionKey: KEY}).kind, 'weak');
});

test('dashboard polling reuses durable-evidence reads and own writes invalidate the shared cache', t => {
  const store = fixture(t);
  const pact = new LearningPact(store); store.pact = pact;
  answer(store);
  const originalRead = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    if (String(file).startsWith(store.attemptRoot)) reads++;
    return originalRead.call(this, file, ...args);
  });
  pact.today();
  assert.ok(reads > 0);
  reads = 0;
  pact.today();
  assert.equal(reads, 0);
  const secondStore = new LearningInteractionStore({root: store.root, workspace: store.workspace});
  assert.equal(secondStore.mastery(KEY).assessed, 1);
  assert.equal(reads, 0);
  answer(store);
  assert.equal(secondStore.mastery(KEY).assessed, 2);
});

test('tool contract supports independent items and rubric results without granting correction authority', t => {
  const store = fixture(t);
  const tool = createLearningActivityTool(store, {sessionKey: KEY});
  assert.ok(tool.parameters.properties.items);
  assert.ok(tool.parameters.properties.item_results);
  assert.ok(tool.parameters.properties.scoring_points);
  assert.deepEqual(tool.parameters.properties.action.enum, ['present', 'resolve', 'complete', 'feedback']);
  assert.throws(() => store.resolve(KEY, {correct: true}), /当前没有/);
  const card = store.present(KEY, {kind: 'fill_blank', question: '未作答', correct_answer: 'a'});
  assert.throws(() => store.resolve(KEY, {activity_id: card.current.id, correct: true}), /先作答/);
});

test('recent evidence supersedes historical lapse totals and verified mistakes stop driving weak-topic advice', t => {
  const store = fixture(t);
  const pact = new LearningPact(store); store.pact = pact;
  const note = store.saveNote(KEY, {content: 'old = 旧知识', tags: ['旧主题']}).note;
  store.writeNotes([{...note, lapses: 100, reviewCount: 100}]);
  assert.equal(pact.weakTopics()[0].tag, '旧主题');
  const {attemptId} = answer(store, {topic: '新主题'}, {answer: '5'});
  assert.equal(pact.weakTopics()[0].tag, '新主题');
  assert.equal(pact.weakTopics()[0].evidence, 'recent_attempts');
  const attempt = store.readAttempt(KEY, attemptId); attempt.verifiedBy = 'retest'; store.writeAttempt(attempt);
  assert.deepEqual(pact.weakTopics(), []);
});

test('retry cannot replace unanswered work or a rubric result that is still pending', t => {
  const store = fixture(t);
  const {attemptId} = answer(store, {}, {answer: '5'});
  const shown = store.present(KEY, {kind: 'short_answer', question: '进行中', scoring_points: [{id: 'one', label: '关键理由'}]});
  assert.throws(() => store.retryAttempt(KEY, attemptId), /完成或结束当前练习/);
  store.submit(KEY, {activityId: shown.current.id, answer: '理由'});
  store.resolve(KEY, {correct: true});
  assert.throws(() => store.retryAttempt(KEY, attemptId), /完成或结束当前练习/);
});

test('legacy submitted cards migrate evidence on restore and can still finish grading', t => {
  const store = fixture(t);
  const shown = store.present(KEY, {kind: 'short_answer', question: '旧版本未完成题'});
  const legacy = store.read(KEY);
  legacy.current.submission = {id: 'legacy-submit', answer: '旧答案', confidence: 80, correctness: null, submittedAt: Date.now() - 1000};
  legacy.current.phase = 'evaluating';
  store.write(KEY, legacy);
  const restored = store.status(KEY);
  assert.ok(restored.current.submission.attemptId);
  assert.equal(store.listAttempts(KEY).total, 1);
  assert.equal(store.resolve(KEY, {activity_id: shown.current.id, correct: true}).current.result.correct, true);
  assert.equal(store.listAttempts(KEY).attempts[0].answer, '旧答案');
});

test('correcting old evidence does not erase a newer manual review schedule', t => {
  const store = fixture(t);
  const note = store.saveNote(KEY, {content: 'four = 四'}).note;
  const {attemptId} = answer(store, {note_ids: [note.id]}, {answer: '5'});
  const manual = store.reviewNote(KEY, note.id, 'remembered', Date.now() + DAY).note;
  store.correctAttempt(KEY, attemptId, {correct: true, reason: '旧题评分核对'});
  const current = store.findOwnedNote(KEY, note.id);
  assert.equal(current.reviewCount, manual.reviewCount);
  assert.equal(current.nextReviewAt, manual.nextReviewAt);
});

test('attempt records show readable selected labels for single and multiple choices without exposing the correct answer', t => {
  const store = fixture(t);
  const single = answer(store, {kind: 'single_choice', question: 'Pick one', options: ['quick', 'quickly'], correct_answer: '2'}, {answer: '1'});
  const multi = answer(store, {kind: 'multiple_choice', question: 'Pick two', options: ['first', 'second', 'third'], correct_answer: ['1', '3']}, {answer: ['1', '2']});
  const attempts = store.listAttempts(KEY).attempts;
  assert.equal(attempts.find(attempt => attempt.id === single.attemptId).answerText, 'quick');
  assert.equal(attempts.find(attempt => attempt.id === multi.attemptId).answerText, 'first、second');
  assert.equal('correctAnswer' in attempts[0], false);
  assert.equal('options' in attempts[0], false);
});

test('a model cannot bypass a prepared notebook batch by omitting items or linking every note to one item', t => {
  const store = fixture(t);
  const first = store.saveNote(KEY, {content: 'first = 第一'}).note;
  const second = store.saveNote(KEY, {content: 'second = 第二'}).note;
  const previous = store.present(KEY, {kind: 'short_answer', question: '保留当前题'});
  store.prepareNotebookQuiz(KEY, [first.id, second.id]);
  assert.throws(() => store.present(KEY, {kind: 'short_answer', question: '同时解释两个词', note_ids: [first.id, second.id]}), /items/);
  assert.throws(() => store.present(KEY, {items: [{id: 'combined', kind: 'short_answer', question: '解释两个词', note_ids: [first.id, second.id]}]}), /单独关联一条/);
  assert.equal(store.status(KEY).current.id, previous.current.id);
  assert.equal(store.findOwnedNote(KEY, first.id).reviewCount, 0);
  const shown = store.present(KEY, {items: [
    {id: 'first', kind: 'fill_blank', question: 'first?', correct_answer: '第一', note_ids: [first.id]},
    {id: 'second', kind: 'fill_blank', question: 'second?', correct_answer: '第二', note_ids: [second.id]},
  ]});
  assert.equal(shown.current.items.length, 2);
  assert.equal(store.read(KEY).notebookQuizPending, false);
  // A later ordinary single question is independent of the consumed batch request.
  assert.doesNotThrow(() => store.present(KEY, {kind: 'short_answer', question: '普通单题'}));
});
