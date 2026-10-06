import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {LEARNING_NOTEBOOK_SESSION, LearningInteractionStore} from '../services/mode-architecture/learning.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-notebook-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, store: new LearningInteractionStore({root: path.join(root, 'learning'), workspace: path.join(root, 'workspace')})};
}

test('legacy notebook remains searchable, editable, reviewable and exportable after its source chats are removed', t => {
  const {root, store} = fixture(t);
  const oldKey = 'agent:learning:deleted-chat';
  const otherKey = 'agent:learning:other-deleted-chat';
  fs.mkdirSync(store.root, {recursive: true});
  fs.writeFileSync(store.notesFile, JSON.stringify({v: 1, notes: [
    {id: 'old', title: 'put off', content: 'put off = 推迟', sourceSessionKey: oldKey, tags: ['词组']},
    {id: 'other', title: 'grammar', content: 'grammar = 语法', sourceSessionKey: otherKey},
  ]}));
  const chatRoot = path.join(root, 'chat-transcripts');
  fs.mkdirSync(chatRoot); fs.writeFileSync(path.join(chatRoot, 'old.jsonl'), 'test chat');
  fs.rmSync(chatRoot, {recursive: true});
  const reopened = new LearningInteractionStore({root: store.root, workspace: store.workspace});
  const notes = reopened.listNotes({sessionKey: LEARNING_NOTEBOOK_SESSION});
  assert.equal(notes.notes.length, 2);
  assert.equal(notes.dueCount, 2);
  assert.equal(reopened.listNotes({sessionKey: LEARNING_NOTEBOOK_SESSION, query: '推迟', tags: ['词组']}).notes[0].id, 'old');
  reopened.updateNote(LEARNING_NOTEBOOK_SESSION, 'old', {content: 'put off = 推迟到以后'});
  const reviewed = reopened.reviewNote(LEARNING_NOTEBOOK_SESSION, 'old', 'remembered').note;
  assert.equal(reviewed.reviewCount, 1);
  assert.equal(reviewed.sourceSessionKey, oldKey);
  assert.equal(reviewed.original, 'put off = 推迟');
  const markdown = fs.readFileSync(notes.markdownPath, 'utf8');
  assert.match(markdown, /推迟到以后/); assert.match(markdown, /语法/); assert.match(markdown, /deleted-chat/);
  assert.equal(reopened.listNotes({sessionKey: 'agent:learning:new-chat'}).notes.length, 0);
  assert.equal(reopened.listNotes({sessionKey: LEARNING_NOTEBOOK_SESSION}).notes.length, 2);
});

test('notebook delete and undo work across source sessions and keep both exports in sync', t => {
  const {store} = fixture(t);
  const source = 'agent:learning:old';
  const note = store.saveNote(source, {content: 'durable = 持久的'}).note;
  store.deleteNote(LEARNING_NOTEBOOK_SESSION, note.id);
  assert.equal(store.listNotes({sessionKey: LEARNING_NOTEBOOK_SESSION}).notes.length, 0);
  assert.doesNotMatch(fs.readFileSync(store.markdownPathForSession(source), 'utf8'), /durable/);
  store.restoreNote(LEARNING_NOTEBOOK_SESSION, note);
  assert.equal(store.listNotes({sessionKey: LEARNING_NOTEBOOK_SESSION}).notes[0].sourceSessionKey, source);
  assert.match(fs.readFileSync(store.notesMarkdown, 'utf8'), /durable/);
});

test('notebook organization can use old source notes and undo preserves notes saved afterwards', t => {
  const {store} = fixture(t);
  const first = store.saveNote('agent:learning:first', {content: 'same as = 一样'}).note;
  const second = store.saveNote('agent:learning:second', {content: 'similar to = 相似'}).note;
  const plan = store.stageOrganizationPlan(LEARNING_NOTEBOOK_SESSION, 'all-notes', [
    {type: 'compare', ids: [first.id, second.id], reason: '放在一起辨析'},
    {type: 'group', ids: [first.id, second.id], topic: '比较表达', reason: '方便查找'},
  ]);
  assert.equal(plan.operations.length, 2);
  const applied = store.applyOrganizationPlan(LEARNING_NOTEBOOK_SESSION, plan.id, plan.operations.map(item => item.id));
  assert.equal(store.listNotes({sessionKey: LEARNING_NOTEBOOK_SESSION}).notes.length, 3);
  const later = store.saveNote('agent:learning:third', {content: 'new = 新的'}).note;
  store.undoOrganization(LEARNING_NOTEBOOK_SESSION, applied.backupId);
  const notes = store.listNotes({sessionKey: LEARNING_NOTEBOOK_SESSION}).notes;
  assert.equal(notes.length, 3);
  assert.ok(notes.some(note => note.id === later.id));
  assert.equal(notes.find(note => note.id === first.id).topic, undefined);
  assert.equal(notes.some(note => note.kind === 'compare'), false);
});

test('a quiz in a new chat records review results only for old notes selected by the user', t => {
  const {store} = fixture(t);
  const selected = store.saveNote('agent:learning:deleted', {content: 'put off = 推迟'}).note;
  const unselected = store.saveNote('agent:learning:other', {content: 'take off = 起飞'}).note;
  const active = 'agent:learning:new';
  store.setEnabled(active, true);
  store.prepareNotebookQuiz(active, [selected.id]);
  const card = store.present(active, {kind: 'short_answer', question: '解释这个词', note_ids: [selected.id, unselected.id]});
  store.resolve(active, {activity_id: card.current.id, correct: true});
  assert.equal(store.findOwnedNote(LEARNING_NOTEBOOK_SESSION, selected.id).reviewCount, 1);
  assert.equal(store.findOwnedNote(LEARNING_NOTEBOOK_SESSION, unselected.id).reviewCount, 0);
  store.setEnabled(active, false);
  assert.deepEqual(store.read(active).notebookQuizIds, []);
});

test('drawer loads the notebook collection from a new chat instead of filtering by that chat', async () => {
  const requests = [];
  const source = fs.readFileSync(new URL('../ui/injections/laolao-learning-stage.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'window.__notesTest = {state, loadNotes};})();');
  const status = {textContent: ''};
  const document = {readyState: 'loading', addEventListener() {}, querySelector() { return null; }};
  const window = {addEventListener() {}, __laolaoSidebar: {async gwRequest(method, params) {
    requests.push({method, params});
    if (method === 'sessions.list') return {sessions: []};
    return {notes: [], availableTags: [], similar: []};
  }}};
  vm.runInNewContext(source, {window, document, location: {href: 'http://localhost/chat?session=agent:learning:new-chat'}, URL,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }});
  window.__notesTest.state.drawer = {querySelector(selector) { return selector.endsWith('__status') ? status : null; }, classList: {contains() { return false; }}};
  await window.__notesTest.loadNotes();
  const request = requests.find(item => item.method === 'pinkie.learning.notes.list');
  assert.equal(request.params.sessionKey, LEARNING_NOTEBOOK_SESSION);
  assert.match(status.textContent, /删除聊天不影响笔记/);
});
