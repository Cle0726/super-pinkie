import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LEARNING_NOTEBOOK_SESSION, LearningInteractionStore, LearningNotesOrganizer, validateOrganizedNotebook} from '../services/mode-architecture/learning.mjs';

const scope = LEARNING_NOTEBOOK_SESSION;
const response = value => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(value)}, finish_reason: 'stop'}]}));

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-manuscript-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace')});
  const config = {models: {providers: {local: {api: 'openai-completions', baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'fixture-only', models: [{id: 'notes'}]}}}, agents: {defaults: {model: 'local/notes'}}};
  const organizer = new LearningNotesOrganizer({config}, store, options);
  return {root, store, organizer};
}

function draft(notes, text = 'put off 表示推迟，宾语为代词时放在 put 和 off 之间。') {
  return {title: '英语重点笔记', sections: [{title: '动词短语', points: [
    {text, example: 'Put it off until tomorrow.', reminder: '不能写成 put off it。', sourceIds: notes.map(note => note.id)},
  ]}]};
}

test('one-click creates a deduplicated copyable manuscript across chats and preserves every original', async t => {
  let body;
  const {store, organizer} = fixture(t, {fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    const {notes} = JSON.parse(body.messages[1].content);
    const putOff = notes.filter(note => note.content.includes('put off'));
    const takeOff = notes.find(note => note.content.includes('take off'));
    return response({notebook: {title: '英语动词短语', sections: [{title: '重点短语', points: [
      {text: 'put off 表示推迟；代词宾语放在 put 和 off 之间。', example: 'Put it off until tomorrow.', reminder: '不能写成 put off it。', sourceIds: putOff.map(note => note.id)},
      {text: 'take off 表示起飞；也可表示脱下衣物，要结合语境区分。', sourceIds: [takeOff.id]},
    ]}]}, operations: []});
  }});
  const original = [
    store.saveNote('agent:learning:first', {content: '先生，这题要记住：put off 表示推迟。加油！'}).note,
    store.saveNote('agent:learning:second', {content: 'put off = 推迟。代词放中间：put it off，不能说 put off it。'}).note,
    store.saveNote('agent:learning:deleted-chat', {content: 'take off = 起飞；脱下。'}).note,
  ];
  const plan = await organizer.preview(scope, 'all-knowledge');
  assert.equal(plan.notebook.sourceCount, 3);
  assert.equal(plan.notebook.pointCount, 2);
  assert.equal(store.listNotes({sessionKey: scope}).organizedNotebook, null);
  assert.match(body.messages[0].content, /可以直接抄进纸质笔记本/);
  assert.match(body.messages[0].content, /不能只贴标签/);
  assert.doesNotMatch(plan.notebook.text, /先生|加油|sourceIds|来源会话/);
  assert.equal(plan.notebook.text.match(/put off 表示/g).length, 1);
  const applied = store.applyOrganizationPlan(scope, plan.id, []);
  assert.equal(applied.organizedNotebook.stale, false);
  assert.equal(store.listNotes({sessionKey: scope}).unorganizedCount, 0);
  for (const note of original) {
    const saved = store.findOwnedNote(scope, note.id);
    assert.equal(saved.content, note.content);
    assert.equal(saved.original, note.original);
  }
  const reopened = new LearningInteractionStore({root: store.root, workspace: store.workspace});
  const manuscript = reopened.listNotes({sessionKey: scope}).organizedNotebook;
  assert.equal(manuscript.pointCount, 2);
  assert.equal(reopened.notesForSession(scope).length, 3);
  assert.match(fs.readFileSync(manuscript.markdownPath, 'utf8'), /## 重点短语/);
  assert.doesNotMatch(fs.readFileSync(manuscript.markdownPath, 'utf8'), /先生|加油|来源会话/);
});

test('exact duplicate output points collapse even across topics and retain all source ids', t => {
  const {store} = fixture(t);
  const notes = [store.saveNote('agent:learning:a', {content: 'put off = 推迟'}).note,
    store.saveNote('agent:learning:b', {content: 'put off 表示推迟'}).note];
  const value = {title: '短语', sections: [
    {title: '第一组', points: [{text: 'put off 表示推迟。', sourceIds: [notes[0].id]}]},
    {title: '第二组', points: [{text: 'put off 表示推迟。', example: 'Put it off.', sourceIds: [notes[1].id]}]},
  ]};
  const result = validateOrganizedNotebook(value, notes, scope);
  assert.equal(result.pointCount, 1);
  assert.equal(result.sections.length, 1);
  assert.deepEqual(new Set(result.sections[0].points[0].sourceIds), new Set(notes.map(note => note.id)));
  assert.equal(result.sections[0].points[0].example, 'Put it off.');
});

test('missing, fabricated, foreign and empty manuscript sources cannot silently omit knowledge', t => {
  const {store} = fixture(t);
  const a = store.saveNote('agent:learning:a', {content: 'word one'}).note;
  const b = store.saveNote('agent:learning:a', {content: 'word two'}).note;
  const foreign = store.saveNote('agent:learning:b', {content: 'private word'}).note;
  assert.throws(() => validateOrganizedNotebook(draft([a]), [a, b], scope), /遗漏/);
  assert.throws(() => validateOrganizedNotebook(draft([{id: 'invented'}]), [a], scope), /无效来源/);
  assert.throws(() => validateOrganizedNotebook(draft([a, foreign]), [a, foreign], 'agent:learning:a'), /无效来源/);
  assert.throws(() => validateOrganizedNotebook({title: 'empty', sections: []}, [a], scope), /抄写稿/);
  assert.throws(() => validateOrganizedNotebook(draft([a], ''), [a], scope), /空知识点/);
});

test('classification-only model results fail clearly instead of reporting a successful one-click organization', async t => {
  const {store, organizer} = fixture(t, {fetchImpl: async () => response({operations: []})});
  store.saveNote('agent:learning:a', {content: 'long explanation'});
  const bytes = fs.readFileSync(store.notesFile, 'utf8');
  await assert.rejects(organizer.preview(scope, 'classification-only'), /没有生成抄写稿/);
  assert.equal(fs.readFileSync(store.notesFile, 'utf8'), bytes);
});

test('new or edited notes invalidate the preview before any backup or manuscript is applied', t => {
  const {store} = fixture(t);
  const note = store.saveNote('agent:learning:a', {content: 'put off = 推迟'}).note;
  const plan = store.stageOrganizationPlan(scope, 'stale', [], draft([note]));
  store.saveNote('agent:learning:b', {content: 'new knowledge'});
  const bytes = fs.readFileSync(store.notesFile, 'utf8');
  assert.throws(() => store.applyOrganizationPlan(scope, plan.id, []), /修改或新增/);
  assert.equal(fs.readFileSync(store.notesFile, 'utf8'), bytes);
  assert.equal(fs.existsSync(store.notesBackupRoot), false);
  assert.equal(store.organizedNotebook(scope), null);
});

test('reviewing a note keeps the manuscript current; editing or adding knowledge marks it as outdated', t => {
  const {store} = fixture(t);
  const note = store.saveNote('agent:learning:a', {content: 'put off = 推迟'}).note;
  const plan = store.stageOrganizationPlan(scope, 'current', [], draft([note]));
  store.applyOrganizationPlan(scope, plan.id, []);
  store.reviewNote(scope, note.id, 'remembered');
  assert.equal(store.organizedNotebook(scope).stale, false);
  store.updateNote(scope, note.id, {content: 'put off = 推迟或使人反感，注意语境。'});
  assert.equal(store.organizedNotebook(scope).stale, true);
});

test('saving a manuscript with selected merge suggestions remains current and undo restores originals', t => {
  const {store} = fixture(t);
  const notes = [store.saveNote('agent:learning:a', {content: 'put off = 推迟'}).note,
    store.saveNote('agent:learning:b', {content: 'put off = 延后'}).note];
  const plan = store.stageOrganizationPlan(scope, 'merge-and-write', [{type: 'merge', ids: notes.map(note => note.id), keepId: notes[0].id, reason: '重复短语'}], draft(notes));
  const saved = store.applyOrganizationPlan(scope, plan.id, plan.operations.map(item => item.id));
  assert.equal(saved.organizedNotebook.stale, false);
  assert.equal(store.notesForSession(scope).length, 1);
  const later = store.saveNote('agent:learning:c', {content: 'later = 后来'}).note;
  store.undoOrganization(scope, saved.backupId);
  assert.equal(store.organizedNotebook(scope), null);
  assert.equal(store.notesForSession(scope).length, 3);
  assert.ok(store.findOwnedNote(scope, later.id));
  for (const note of notes) assert.equal(store.findOwnedNote(scope, note.id).content, note.content);
  assert.equal(fs.existsSync(store.organizedNotebookPath(scope)), false);
});

test('undoing a later organization restores the previous manuscript and its export', t => {
  const {store} = fixture(t);
  const note = store.saveNote('agent:learning:a', {content: 'put off = 推迟'}).note;
  const first = store.stageOrganizationPlan(scope, 'first', [], draft([note], '第一版知识点'));
  store.applyOrganizationPlan(scope, first.id, []);
  const second = store.stageOrganizationPlan(scope, 'second', [], draft([note], '第二版知识点'));
  const applied = store.applyOrganizationPlan(scope, second.id, []);
  store.undoOrganization(scope, applied.backupId);
  assert.match(store.organizedNotebook(scope).text, /第一版知识点/);
  assert.doesNotMatch(store.organizedNotebook(scope).text, /第二版知识点/);
  assert.match(fs.readFileSync(store.organizedNotebookPath(scope), 'utf8'), /第一版知识点/);
});
