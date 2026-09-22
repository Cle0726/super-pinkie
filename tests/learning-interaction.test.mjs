import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, createLearningActivityTool, learningPrompt, registerLearningGateway} from '../services/mode-architecture/learning.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-learning-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace-learning')});
}

test('interactive cards are session-scoped and never expose the private answer', t => {
  const store = fixture(t);
  const first = 'agent:learning:one';
  const second = 'agent:learning:two';
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
  const shown = store.present(sessionKey, {kind: 'short_answer', question: '为什么?', rubric: '说明原因'});
  store.submit(sessionKey, {activityId: shown.current.id, answer: '因为边界条件', submissionId: 'one'});
  const resolved = store.resolve(sessionKey, {activity_id: shown.current.id, correct: true, feedback: '对', explanation: '边界条件决定行为', key_point: '先确认边界条件'});
  assert.equal(resolved.current.result.keyPoint, '先确认边界条件');
  const saved = store.saveNote(sessionKey, {title: '边界', content: resolved.current.result.keyPoint, sourceLabel: '互动题卡'});
  assert.equal(store.listNotes().notes[0].id, saved.note.id);
  assert.match(fs.readFileSync(store.notesMarkdown, 'utf8'), /先确认边界条件/);
  store.deleteNote(sessionKey, saved.note.id);
  assert.equal(store.listNotes().notes.length, 0);
});

test('tool binds the active learning session and updates the native card', async t => {
  const store = fixture(t);
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

test('gateway methods are admin-scoped and ordinary learning chat stays normal until enabled', async t => {
  const store = fixture(t);
  const methods = new Map();
  registerLearningGateway({registerGatewayMethod(name, fn, opts) { methods.set(name, {fn, opts}); }}, store);
  assert.deepEqual([...methods.keys()].sort(), [
    'pinkie.learning.current', 'pinkie.learning.notes.delete', 'pinkie.learning.notes.list', 'pinkie.learning.notes.save',
    'pinkie.learning.set', 'pinkie.learning.status', 'pinkie.learning.submit',
  ]);
  for (const item of methods.values()) assert.equal(item.opts.scope, 'operator.admin');
  assert.equal(learningPrompt(store, 'agent:learning:prompt'), '');
  store.setEnabled('agent:learning:prompt', true);
  assert.match(learningPrompt(store, 'agent:learning:prompt'), /普通学习聊天仍照常回答/);
  assert.equal(learningPrompt(store, 'agent:project:prompt'), '');
});

test('frontend keeps one native card, restores by revision, and avoids subtree observers', () => {
  const source = fs.readFileSync(new URL('../ui/injections/laolao-learning-stage.js', import.meta.url), 'utf8');
  assert.match(source, /pinkie\.learning\.current/);
  assert.match(source, /state\.sessionKey !== sessionKey \|\| state\.revision/);
  assert.match(source, /stage\.replaceChildren\(\)/);
  assert.match(source, /chat\.send/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /\.chat-group\.assistant/);
  assert.doesNotMatch(source, /new MutationObserver/);
});
