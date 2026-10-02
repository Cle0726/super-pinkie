import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, calculateReviewSchedule, createLearningActivityTool, detectSimilarNotes, learningPrompt, registerLearningGateway, validateOrganizationOperations} from '../services/mode-architecture/learning.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-learning-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace-learning')});
}

test('interactive cards are session-scoped and never expose the private answer', t => {
  const store = fixture(t);
  const first = 'agent:learning:one';
  const second = 'agent:learning:two';
  store.setEnabled(first, true);
  const shown = store.present(first, {
    kind: 'single_choice', topic: '英语', question: 'Choose one',
    options: [{id: 'A', label: 'alpha'}, {id: 'B', label: 'beta'}], correct_answer: 'B', hint: '想想第二个',
  });
  assert.equal(shown.enabled, true);
  assert.equal(shown.current.phase, 'asking');
  assert.equal('correctAnswer' in shown.current, false);
  assert.equal(store.status(second).current, null);
  assert.equal(store.status(second).enabled, false);
});

test('submissions are idempotent and reject stale activity ids', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:answer';
  store.setEnabled(sessionKey, true);
  const shown = store.present(sessionKey, {kind: 'single_choice', question: '2+2?', options: ['3', '4'], correct_answer: '2'});
  const submitted = store.submit(sessionKey, {activityId: shown.current.id, answer: '2', submissionId: 'same', confidence: 90});
  assert.equal(submitted.current.submission.correctness, true);
  const replayed = store.submit(sessionKey, {activityId: shown.current.id, answer: '1', submissionId: 'same'});
  assert.equal(replayed.revision, submitted.revision);
  assert.equal(replayed.current.submission.answer, '2');
  assert.throws(() => store.submit(sessionKey, {activityId: 'old-card', answer: '2'}), /题卡已经更新/);
});

test('resolved key points and selected text persist outside chat history', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:notes';
  store.setEnabled(sessionKey, true);
  const shown = store.present(sessionKey, {kind: 'short_answer', question: '为什么?', rubric: '说明原因'});
  store.submit(sessionKey, {activityId: shown.current.id, answer: '因为边界条件', submissionId: 'one'});
  const resolved = store.resolve(sessionKey, {activity_id: shown.current.id, correct: true, feedback: '对', explanation: '边界条件决定行为', key_point: '先确认边界条件'});
  assert.equal(resolved.current.result.keyPoint, '先确认边界条件');
  const saved = store.saveNote(sessionKey, {title: '边界', content: resolved.current.result.keyPoint, sourceLabel: '互动题卡'});
  assert.equal(store.listNotes({sessionKey}).notes[0].id, saved.note.id);
  assert.match(fs.readFileSync(saved.markdownPath, 'utf8'), /先确认边界条件/);
  store.deleteNote(sessionKey, saved.note.id);
  assert.equal(store.listNotes().notes.length, 0);
});

test('tool binds the active learning session and updates the native card', async t => {
  const store = fixture(t);
  store.setEnabled('agent:learning:tool', true);
  const tool = createLearningActivityTool(store, {});
  const params = tool.prepareBeforeToolCallParams(
    {action: 'present', kind: 'fill_blank', question: 'CSS 全称?', correct_answer: 'Cascading Style Sheets'},
    {hookContext: {sessionKey: 'agent:learning:tool'}},
  );
  const result = await tool.execute('call-1', params);
  assert.equal(result.isError, false);
  assert.equal(result.details.current.kind, 'fill_blank');
  assert.equal('correctAnswer' in result.details.current, false);
});

test('stopping interaction clears the card and fences a delayed present call', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:hard-stop';
  store.setEnabled(sessionKey, true);
  const shown = store.present(sessionKey, {kind: 'single_choice', question: 'stop?', options: ['A', 'B'], correct_answer: 'A'});
  const stopped = store.setEnabled(sessionKey, false);
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.current, null);
  const persisted = store.read(sessionKey);
  assert.equal(persisted.history.at(-1).id, shown.current.id);
  assert.equal(persisted.history.at(-1).dismissedReason, 'interaction_disabled');
  assert.throws(() => store.present(sessionKey, {kind: 'single_choice', question: 'late?', options: ['A', 'B'], correct_answer: 'A'}), /互动学习已关闭/);
  assert.equal(store.status(sessionKey).enabled, false);
  assert.equal(store.status(sessionKey).current, null);
});

test('a legacy disabled card is cleaned before it can revive on the next launch', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:legacy-disabled';
  const legacy = store.read(sessionKey);
  legacy.enabled = false;
  legacy.current = {id: 'old-card', kind: 'short_answer', question: '旧题', phase: 'asking', createdAt: Date.now()};
  store.write(sessionKey, legacy);
  const status = store.status(sessionKey);
  assert.equal(status.enabled, false);
  assert.equal(status.current, null);
  const repaired = store.read(sessionKey);
  assert.equal(repaired.current, null);
  assert.equal(repaired.history.at(-1).id, 'old-card');
  assert.equal(repaired.history.at(-1).dismissedReason, 'interaction_disabled');
  const reopened = store.setEnabled(sessionKey, true);
  assert.equal(reopened.current, null);
});

test('gateway methods are admin-scoped and ordinary learning chat stays normal until enabled', async t => {
  const store = fixture(t);
  const methods = new Map();
  registerLearningGateway({registerGatewayMethod(name, fn, opts) { methods.set(name, {fn, opts}); }}, store);
  assert.deepEqual([...methods.keys()].sort(), [
    'pinkie.learning.current', 'pinkie.learning.notes.delete', 'pinkie.learning.notes.list', 'pinkie.learning.notes.organize.apply',
    'pinkie.learning.notes.organize.get', 'pinkie.learning.notes.organize.light', 'pinkie.learning.notes.organize.preview',
    'pinkie.learning.notes.organize.undo', 'pinkie.learning.notes.organizer.setModel', 'pinkie.learning.notes.organizer.status', 'pinkie.learning.notes.restore',
    'pinkie.learning.notes.review', 'pinkie.learning.notes.save', 'pinkie.learning.notes.update',
    'pinkie.learning.set', 'pinkie.learning.status', 'pinkie.learning.submit',
  ]);
  for (const item of methods.values()) assert.equal(item.opts.scope, 'operator.admin');
  assert.match(learningPrompt(store, 'agent:learning:prompt'), /碧琪学习笔记/);
  assert.doesNotMatch(learningPrompt(store, 'agent:learning:prompt'), /CLEKK_NOTE_|learning_notes/);
  assert.match(learningPrompt(store, 'agent:learning:prompt'), /先生作答之前，不写解题思路、考点分析或答案/);
  assert.match(learningPrompt(store, 'agent:learning:prompt'), /题目消息只放题干、选项和必要的生词注释/);
  store.setEnabled('agent:learning:prompt', true);
  assert.match(learningPrompt(store, 'agent:learning:prompt'), /普通学习聊天仍照常回答/);
  assert.match(learningPrompt(store, 'agent:learning:prompt'), /先生作答之前，不写解题思路、考点分析或答案/);
  assert.equal(learningPrompt(store, 'agent:project:prompt'), '');
});

test('frontend keeps one native card, restores by revision, and avoids subtree observers', () => {
  const source = fs.readFileSync(new URL('../ui/injections/laolao-learning-stage.js', import.meta.url), 'utf8');
  assert.match(source, /pinkie\.learning\.current/);
  assert.match(source, /pinkie\.learning\.notes\.update/);
  assert.match(source, /pinkie\.learning\.notes\.review/);
  assert.match(source, /pinkie\.learning\.notes\.organize\.apply/);
  assert.match(source, /pinkie\.learning\.notes\.organize\.light/);
  assert.match(source, /pinkie\.learning\.notes\.organize\.preview/);
  assert.doesNotMatch(source, /learning_notes/);
  assert.match(source, /CLEKK_LEARNING_BATCH_V1/);
  assert.match(source, /notes__search/);
  assert.match(source, /notes__tag-filters/);
  assert.match(source, /state\.sessionKey !== sessionKey \|\| state\.revision/);
  assert.match(source, /stage\.replaceChildren\(\)/);
  assert.match(source, /chat\.send/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /pinkie\.watchdog\.cancel/);
  assert.match(source, /chat\.abort/);
  assert.match(source, /preserveSideRuns: false/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /\.chat-group\.assistant/);
  assert.doesNotMatch(source, /new MutationObserver/);
});

test('note saves strip title decorations, preserve the body, and keep an immutable original', t => {
  const store = fixture(t);
  const content = '👉 be similar to... = 与……相似\n例句：These two ideas are similar.';
  const saved = store.saveNote('agent:learning:decorations', {title: '👉 be similar to...', content});
  assert.equal(saved.note.title, 'be similar to...');
  assert.equal(saved.note.content, content);
  assert.equal(saved.note.original, content);
  assert.equal(saved.note.term, 'be similar to...');
  assert.equal(saved.note.meaning, '与……相似');
  assert.equal(saved.note.example, 'These two ideas are similar.');
});

test('notes are scoped to their learning session, including search and tag filters', t => {
  const store = fixture(t);
  const first = store.saveNote('agent:learning:first', {title: 'word', content: 'word = 单词', tags: ['单词']}).note;
  store.saveNote('agent:learning:second', {title: 'grammar', content: 'grammar = 语法', tags: ['语法']});
  assert.deepEqual(store.listNotes({sessionKey: 'agent:learning:first'}).notes.map(note => note.id), [first.id]);
  assert.equal(store.listNotes({sessionKey: 'agent:learning:first', query: '语法'}).notes.length, 0);
  assert.equal(store.listNotes({sessionKey: 'agent:learning:first', tags: ['单词']}).notes.length, 1);
  assert.throws(() => store.updateNote('agent:learning:second', first.id, {content: 'stolen'}), /没有找到/);
  assert.throws(() => store.deleteNote('agent:learning:second', first.id), /没有找到/);
});

test('update RPC changes editable fields but never replaces the saved original', async t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:update';
  const note = store.saveNote(sessionKey, {title: 'old', content: 'take part in = 参加'}).note;
  const methods = new Map();
  registerLearningGateway({registerGatewayMethod(name, fn, opts) { methods.set(name, {fn, opts}); }}, store);
  let response;
  await methods.get('pinkie.learning.notes.update').fn({
    params: {sessionKey, id: note.id, title: '👉 new', content: 'new = 新释义', tags: ['词组', '语法']},
    respond(ok, value, error) { response = {ok, value, error}; },
  });
  assert.equal(response.ok, true);
  assert.equal(response.value.note.title, 'new');
  assert.equal(response.value.note.content, 'new = 新释义');
  assert.deepEqual(response.value.note.tags, ['词组', '语法']);
  assert.equal(response.value.note.original, 'take part in = 参加');
});

test('light organization splits fields, suggests tags, and preserves both original and content', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:light';
  const saved = store.saveNote(sessionKey, {title: '👉 put off', content: 'put off = 推迟'}).note;
  const organized = store.organizeLightNote(sessionKey, saved.id, {
    structured: {term: 'put off', meaning: '推迟', example: 'We put off the meeting.', note: '后接名词'},
    tags: ['词组', '固定搭配'],
  }).note;
  assert.equal(organized.title, 'put off');
  assert.equal(organized.term, 'put off');
  assert.equal(organized.meaning, '推迟');
  assert.equal(organized.example, 'We put off the meeting.');
  assert.equal(organized.original, 'put off = 推迟');
  assert.equal(organized.content, 'put off = 推迟');
  assert.deepEqual(organized.tags, ['词组', '固定搭配']);
  const englishOnly = store.saveNote(sessionKey, {content: 'back up'}).note;
  const supplemented = store.organizeLightNote(sessionKey, englishOnly.id, {supplementalMeaning: '备份；支持'}).note;
  assert.equal(supplemented.supplementalMeaning, '碧琪补充：备份；支持');
  assert.equal(supplemented.original, 'back up');
});

test('legacy notes remain readable and missing review fields mean never reviewed and due today', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:legacy-notes';
  fs.mkdirSync(path.dirname(store.notesFile), {recursive: true});
  fs.writeFileSync(store.notesFile, JSON.stringify({v: 1, notes: [{
    id: 'old-note', title: 'arrive at', content: 'arrive at = 到达', tags: ['词组'],
    sourceSessionKey: sessionKey, createdAt: 1000, updatedAt: 1000,
  }]}));
  const result = store.listNotes({sessionKey});
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].term, 'arrive at');
  assert.equal(result.notes[0].meaning, '到达');
  assert.equal(result.notes[0].original, 'arrive at = 到达');
  assert.equal(result.notes[0].lastReviewedAt, 0);
  assert.equal(result.notes[0].nextReviewAt, 0);
  assert.equal(result.notes[0].reviewCount, 0);
  assert.equal(result.notes[0].lapses, 0);
  assert.equal(result.dueCount, 1);
  const persisted = JSON.parse(fs.readFileSync(store.notesFile, 'utf8'));
  assert.equal('lastReviewedAt' in persisted.notes[0], false);
  assert.equal('term' in persisted.notes[0], false);
  assert.equal(persisted.notes[0].content, 'arrive at = 到达');
  store.writeNotesMarkdown(persisted.notes, sessionKey);
  assert.match(fs.readFileSync(store.markdownPathForSession(sessionKey), 'utf8'), /\*\*arrive at\*\*：到达/);
});

test('review scheduling uses spaced intervals and resets after forgetting', () => {
  const day = 24 * 60 * 60 * 1000;
  let note = {reviewCount: 0, lapses: 0};
  const first = calculateReviewSchedule(note, 'remembered', 1_000);
  assert.equal(first.nextReviewAt, 1_000 + day);
  note = first;
  const second = calculateReviewSchedule(note, 'remembered', 1_000 + day);
  assert.equal(second.nextReviewAt, 1_000 + day + 3 * day);
  const fuzzy = calculateReviewSchedule(second, 'fuzzy', 50_000);
  assert.equal(fuzzy.nextReviewAt, 50_000 + 3 * day);
  const forgotten = calculateReviewSchedule(fuzzy, 'forgot', 70_000);
  assert.equal(forgotten.nextReviewAt, 70_000 + day);
  assert.equal(forgotten.reviewLevel, 0);
  assert.equal(forgotten.lapses, 1);
  assert.equal(forgotten.reviewCount, 4);
});

test('similar-note detection catches identical terms and comparison families', () => {
  const notes = [
    {id: 'a', term: 'take off'}, {id: 'b', term: 'TAKE OFF'},
    {id: 'c', term: 'be the same as...'}, {id: 'd', term: 'be similar to...'},
    {id: 'e', term: 'different from...'},
  ];
  const suggestions = detectSimilarNotes(notes);
  assert.ok(suggestions.some(item => item.type === 'merge' && item.ids.includes('a') && item.ids.includes('b')));
  assert.ok(suggestions.some(item => item.type === 'compare' && item.ids.includes('c') && item.ids.includes('d')));
  assert.ok(suggestions.some(item => item.type === 'compare' && item.ids.includes('c') && item.ids.includes('e')));
  assert.ok(suggestions.some(item => item.type === 'compare' && item.ids.includes('d') && item.ids.includes('e')));
});

test('organization operations validate type, reason, ownership, and references', t => {
  const store = fixture(t);
  const first = store.saveNote('agent:learning:validate', {content: 'same = 一样'}).note;
  store.saveNote('agent:learning:other', {content: 'private = 私有'});
  const notes = store.readNotes().notes;
  const result = validateOrganizationOperations([
    {type: 'group', ids: [first.id], topic: '比较句型', reason: '便于一起复习'},
    {type: 'merge', ids: [first.id, 'foreign-id'], keepId: first.id, reason: '疑似重复'},
    {type: 'fix', id: first.id, suggestion: 'check it'},
    {type: 'rename', ids: [first.id], reason: 'bad type'},
  ], notes, 'agent:learning:validate');
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].type, 'group');
  assert.equal(result.discarded.length, 3);
  assert.match(result.discarded[0].reason, /不存在/);
  assert.match(result.discarded[1].reason, /理由/);
  assert.match(result.discarded[2].reason, /类型/);
});

test('organization preview applies only selected operations, backs up, and can be undone', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:organize';
  const first = store.saveNote(sessionKey, {content: 'be the same as = 和……一样'}).note;
  const second = store.saveNote(sessionKey, {content: 'be the same as = 一样'}).note;
  const third = store.saveNote(sessionKey, {content: 'be similar to = 与……相似'}).note;
  const plan = store.stageOrganizationPlan(sessionKey, 'request-1', [
    {type: 'merge', ids: [first.id, second.id], keepId: first.id, title: 'be the same as', term: 'be the same as', meaning: '和……一样', reason: '相同词条'},
    {type: 'group', ids: [third.id], topic: '比较句型', reason: '方便一起记'},
    {type: 'fix', id: third.id, field: 'meaning', suggestion: '核对中文语气', reason: '原文可能不够准确'},
    {type: 'fix', id: 'made-up-id', suggestion: 'invalid', reason: 'not a note'},
  ]);
  assert.equal(plan.state, 'preview');
  assert.equal(plan.operations.length, 3);
  assert.equal(plan.discarded.length, 1);
  const groupOperation = plan.operations.find(operation => operation.type === 'group');
  const applied = store.applyOrganizationPlan(sessionKey, plan.id, [groupOperation.id]);
  assert.equal(applied.appliedCount, 1);
  assert.ok(fs.existsSync(path.join(store.notesBackupRoot, `${applied.backupId}.json`)));
  const after = store.listNotes({sessionKey}).notes;
  assert.equal(after.find(note => note.id === third.id).topic, '比较句型');
  assert.equal(after.find(note => note.id === second.id).status, 'active');
  assert.equal(after.find(note => note.id === third.id).suggestedFix, undefined);
  store.undoOrganization(sessionKey, applied.backupId);
  const restored = store.listNotes({sessionKey, includeMerged: true}).notes;
  assert.equal(restored.find(note => note.id === third.id).topic, undefined);
  assert.equal(restored.filter(note => note.status === 'merged').length, 0);
  assert.equal(restored.length, 3);
});

test('merge keeps source notes recoverable and compare makes a linked card', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:compare';
  const first = store.saveNote(sessionKey, {content: 'be the same as = 和……一样'}).note;
  const second = store.saveNote(sessionKey, {content: 'be similar to = 与……相似'}).note;
  const plan = store.stageOrganizationPlan(sessionKey, 'request-compare', [{
    type: 'compare', ids: [first.id, second.id], title: '相同与相似',
    items: [{term: 'be the same as', meaning: '和……一样'}, {term: 'be similar to', meaning: '与……相似'}],
    differencePoints: 'same 表示相同；similar 表示相似', reason: '容易混淆',
  }]);
  store.applyOrganizationPlan(sessionKey, plan.id, [plan.operations[0].id]);
  const current = store.listNotes({sessionKey}).notes;
  const compare = current.find(note => note.kind === 'compare');
  assert.equal(compare.compareItems.length, 2);
  assert.equal(current.find(note => note.id === first.id).compareCardId, compare.id);
  assert.equal(current.find(note => note.id === second.id).compareCardId, compare.id);
  assert.equal(store.listNotes({sessionKey, includeMerged: true}).notes.length, 3);
  assert.equal(store.readNotes().notes.find(note => note.id === first.id).original, 'be the same as = 和……一样');
});

test('batch activity result writes review results back to its linked notes', t => {
  const store = fixture(t);
  const sessionKey = 'agent:learning:batch-review';
  const first = store.saveNote(sessionKey, {content: 'take off = 起飞'}).note;
  const second = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  store.setEnabled(sessionKey, true);
  const shown = store.present(sessionKey, {kind: 'short_answer', question: '解释这两个词组', note_ids: [first.id, second.id]});
  store.submit(sessionKey, {activityId: shown.current.id, answer: '...', submissionId: 'batch'});
  store.resolve(sessionKey, {activity_id: shown.current.id, correct: false, feedback: '再记一次'});
  const notes = store.listNotes({sessionKey}).notes;
  for (const id of [first.id, second.id]) {
    const note = notes.find(item => item.id === id);
    assert.equal(note.reviewCount, 1);
    assert.equal(note.lapses, 1);
    assert.ok(note.nextReviewAt > Date.now());
  }
});
