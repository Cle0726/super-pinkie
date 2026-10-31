import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LearningNotesOrganizer, LEARNING_NOTEBOOK_SESSION as ALL, detectSimilarNotes} from '../services/mode-architecture/learning.mjs';
import {LEARNING_EXAMS} from '../services/mode-architecture/learning-exams.mjs';
import {LearningVocab} from '../services/mode-architecture/learning-vocab.mjs';

const KEY = 'agent:learning:notebook-v2-test';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-notes-v2-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new LearningInteractionStore({root: path.join(root, 'learning'), workspace: path.join(root, 'workspace')});
  return {root, store};
}
function setNotes(store, notes) { store.writeNotes(notes); }

test('registry and legacy defaults are read without changing source records or triaging old tags', t => {
  const {store} = fixture(t);
  assert.deepEqual(LEARNING_EXAMS.map(exam => exam.id), ['pretco-b', 'zsb-en', 'cet4', 'cet6']);
  assert.equal(LEARNING_EXAMS[1].approxSize, null);
  const old = {id: 'legacy', content: 'be used to 后接动名词', sourceSessionKey: KEY, tags: ['语法'], topic: '非谓语', lightOrganizedAt: 1};
  setNotes(store, [old]);
  const before = fs.readFileSync(store.notesFile, 'utf8');
  const note = store.listNotes({sessionKey: ALL}).notes[0];
  assert.equal(note.noteType, ''); assert.equal(note.triagedAt, 0); assert.deepEqual(note.movedToVocabIds, []);
  assert.equal(store.notesToc(ALL).inbox, 1);
  assert.equal(fs.readFileSync(store.notesFile, 'utf8'), before);
});

test('moved records stay out of active queries, reviews, quiz, similarity, exports and note capacity', t => {
  const {store} = fixture(t);
  const base = {id: 'moved', content: 'moved-only-token', title: 'same', term: 'same', sourceSessionKey: KEY, status: 'moved'};
  setNotes(store, [base, {id: 'active', title: 'same', term: 'same', content: '规则', sourceSessionKey: KEY}]);
  assert.deepEqual(store.listNotes({sessionKey: ALL, includeMerged: true}).notes.map(note => note.id), ['active']);
  assert.deepEqual(store.listNotes({sessionKey: ALL, view: 'moved'}).notes.map(note => note.id), ['moved']);
  assert.equal(store.notesToc(ALL).moved, 1);
  assert.deepEqual(store.reviewQueue(ALL).notes.map(note => note.id), ['active']);
  assert.throws(() => store.reviewNote(ALL, 'moved', 'remembered'), /没有找到/);
  assert.throws(() => store.prepareNotebookQuiz(KEY, ['moved']), /没有找到可出题/);
  assert.throws(() => store.present(KEY, {kind: 'short_answer', question: 'test', note_ids: ['moved']}), /不能出题/);
  assert.deepEqual(detectSimilarNotes(store.readNotesState().notes), []);
  assert.doesNotMatch(fs.readFileSync(store.notesMarkdown, 'utf8'), /moved-only-token/);
  setNotes(store, Array.from({length: 500}, (_, index) => ({...base, id: `moved-${index}`})));
  assert.equal(store.saveNote(KEY, {content: '新规则'}).note.status, 'active');
});

test('toc and all new list filters use accepted fields and support pact exams', t => {
  const {store} = fixture(t);
  store.pact = {get: () => ({exams: [{id: 'zsb', name: '专升本'}]})};
  const a = store.saveNote(KEY, {content: '指针存地址', exam: 'zsb', subject: 'C 语言', topic: '指针', noteType: '概念', cue: '指针存什么？'}).note;
  setNotes(store, [{...a, triagedAt: 100}, {...a, id: 'mistake', noteType: '易错', subject: '计算机网络', topic: 'TCP'},
    {...a, id: 'lapsed', lapses: 1, triagedAt: 100}]);
  const toc = store.notesToc(ALL);
  assert.equal(toc.exams.find(exam => exam.id === 'zsb').count, 2);
  assert.equal(toc.inbox, 1); assert.equal(toc.mistakes, 2);
  const selected = store.listNotes({sessionKey: ALL, exam: 'zsb', subject: 'C 语言', topic: '指针', noteType: '概念'});
  assert.equal(selected.notes.length, 2);
  assert.equal(store.listNotes({sessionKey: ALL, inbox: true}).notes.length, 1);
  assert.equal(store.listNotes({sessionKey: ALL, view: 'mistakes'}).notes.length, 2);
});

test('daily limit keeps backlog, uses note reviews only and survives restart and day rollover', t => {
  const {store} = fixture(t);
  const now = Date.parse('2026-10-28T10:00:00Z');
  const notes = Array.from({length: 25}, (_, index) => ({id: `n${index}`, content: '规则', sourceSessionKey: KEY, nextReviewAt: index}));
  setNotes(store, notes);
  store.pact = {get: () => ({timezone: 'Asia/Shanghai'}), readDay: () => ({reviews: {done: 1000}})};
  let queue = store.reviewQueue(ALL, {now});
  assert.equal(queue.notes.length, 10); assert.equal(queue.todayCount, 10); assert.equal(queue.backlog, 15);
  assert.equal(store.reviewQueue(ALL, {now, dailyLimit: 3, limit: 2}).todayCount, 3);
  assert.equal(store.reviewQueue(ALL, {now, dailyLimit: 0}).notes.length, 0);
  for (const note of queue.notes) store.reviewNote(ALL, note.id, 'remembered', now);
  const reopened = new LearningInteractionStore({root: store.root, workspace: store.workspace});
  queue = reopened.reviewQueue(ALL, {now});
  assert.equal(queue.completedToday, 10); assert.equal(queue.todayCount, 0); assert.equal(queue.backlog, 15);
  assert.equal(reopened.reviewQueue(ALL, {now: now + 86400000}).todayCount, 10);
});

// ---- B2–B6 ----
const n = (id, content, extra = {}) => ({id, content, original: content, title: content.slice(0, 20), sourceSessionKey: KEY, status: 'active', createdAt: 1, updatedAt: 1, ...extra});
function organizerFor(store, reply) {
  const organizer = new LearningNotesOrganizer({}, store, {timeoutMs: 1000, deepTimeoutMs: 1000});
  organizer.status = () => ({available: true, model: 'fixture/model', modelName: 'Fixture'});
  organizer.calls = [];
  organizer.requestModel = async (model, rules, notes, deep, options = {}) => { organizer.calls.push({rules, notes, options}); return reply(notes, rules, options); };
  return organizer;
}

test('triage suggestions are validated, invented hints are cleared, apply and undo keep originals byte-identical', async t => {
  const {store} = fixture(t);
  setNotes(store, [n('w', 'appointment = 约好时间'), n('r', 'avoid 后面必须接 -ing'), n('bad', '指针存的是地址')]);
  const organizer = organizerFor(store, notes => ({items: [
    {id: 'w', isVocab: true, words: [{word: 'appointment', hint: '约好时间', homophone: '阿破因特门特'}], noteType: '', exam: '', subject: '', topic: '', title: '', cue: ''},
    {id: 'r', isVocab: false, words: [], noteType: '规则', exam: 'pretco-b', subject: '语法', topic: '非谓语动词', title: 'avoid 后接 doing', cue: 'avoid 后面接什么形式？'},
    {id: 'bad', isVocab: false, words: [], noteType: '乱写', exam: 'pretco-b', subject: 'C', topic: '指针', title: 't', cue: ''},
  ]}));
  const started = organizer.triageSuggest(ALL);
  assert.equal(started.queued, 3);
  await organizer.triageRunning;
  assert.equal(organizer.calls.length, 1, 'one batch of up to 20 notes');
  assert.match(organizer.calls[0].rules, /英语四级/);
  const notes = Object.fromEntries(store.listNotes({sessionKey: ALL, inbox: true}).notes.map(note => [note.id, note]));
  assert.deepEqual(notes.w.suggestion.words, [{word: 'appointment', hint: '约好时间', homophone: ''}], 'homophone not in the original is cleared');
  assert.equal(notes.r.suggestion.noteType, '规则');
  assert.equal(notes.bad.suggestion, undefined, 'invalid noteType is discarded, not written');
  assert.equal(store.readNotesState().triageStatus.state, 'idle');
  const before = store.readNotesState().notes.find(note => note.id === 'r');
  const applied = store.triageNotes(ALL, [{id: 'r', noteType: '规则', exam: 'pretco-b', subject: '语法', topic: '非谓语动词'}]);
  const after = store.readNotesState().notes.find(note => note.id === 'r');
  assert.equal(after.cue, 'avoid 后面接什么形式？'); assert.equal(after.title, 'avoid 后接 doing'); assert.ok(after.triagedAt);
  assert.equal(after.original, before.original); assert.equal(after.content, before.content);
  assert.equal(store.notesToc(ALL).exams.find(exam => exam.id === 'pretco-b').subjects[0].name, '语法');
  store.undoTriage(ALL, applied.backupId);
  const undone = store.readNotesState().notes.find(note => note.id === 'r');
  for (const key of ['original', 'content', 'title', 'triagedAt', 'noteType', 'subject']) assert.deepEqual(undone[key], before[key], key);
});

test('model failure during triage writes nothing and reports a retryable state', async t => {
  const {store} = fixture(t);
  setNotes(store, [n('a', 'be used to doing 习惯于')]);
  const organizer = organizerFor(store, () => { throw new Error('整理模型没有返回有效的 JSON，笔记保持原样'); });
  organizer.triageSuggest(ALL); await organizer.triageRunning;
  assert.equal(store.readNotesState().notes[0].suggestion, undefined);
  assert.equal(store.readNotesState().triageStatus.state, 'failed');
});

test('save reports looksLikeVocab only for bare words and phrases', t => {
  const {store} = fixture(t);
  assert.equal(store.saveNote(KEY, {content: 'look forward to 期待'}).vocabKind, '短语');
  assert.equal(store.saveNote(KEY, {content: 'pest：害虫'}).vocabKind, '单词');
  assert.equal(store.saveNote(KEY, {content: 'avoid 后面必须接 -ing'}).looksLikeVocab, false);
  assert.equal(store.saveNote(KEY, {content: '指针存的是变量的地址'}).looksLikeVocab, false);
});

const vocabEntry = (id, word) => ({id, word, phonetic: '/x/', pos: 'n.', meaning: '意思', homophone: '谐音', memory: '', collocations: [{en: `use ${word}`, zh: '用'}],
  example: {en: `I ${word}.`, zh: '我。'}, examTip: '', exams: [{id: 'pretco-b', tier: '常见'}, {id: 'cet9', tier: '核心'}]});

test('moving notes to vocab merges duplicates, keeps user homophones, and undo restores both files byte for byte', async t => {
  const {store} = fixture(t);
  const calls = [];
  const vocab = new LearningVocab(store, {requestModel: async (rules, payload) => { calls.push(payload); return {value: {entries: payload.words.map(word => vocabEntry(word.id, word.word))}}; }});
  vocab.add({text: 'appointment'}); await vocab.running;
  const two = 'appointment【谐音：阿破因特门特】= 约好时间（预约） / application【谐音：阿普里尅神】= 填表要东西（申请）';
  setNotes(store, [n('two', two, {suggestion: {isVocab: true, words: [
    {word: 'appointment', hint: '约好时间（预约）', homophone: '阿破因特门特'}, {word: 'application', hint: '填表要东西（申请）', homophone: '阿普里尅神'}]}}),
    n('rule', 'avoid 后面必须接 -ing', {suggestion: {isVocab: false, words: []}})]);
  const preview = vocab.fromNotesPreview(ALL);
  assert.deepEqual(preview.items.map(item => item.noteId), ['two']);
  const notesBefore = fs.readFileSync(store.notesFile, 'utf8'), vocabBefore = fs.readFileSync(vocab.file, 'utf8');
  const result = vocab.fromNotesApply(ALL, {noteIds: ['two']});
  assert.equal(result.createdCount, 1); assert.equal(result.mergedCount, 1);
  await vocab.running;
  const words = vocab.list().words;
  assert.equal(words.find(word => word.word === 'appointment').userHomophone, '阿破因特门特');
  const created = words.find(word => word.word === 'application');
  assert.equal(created.userHomophone, '阿普里尅神'); assert.equal(created.sourceNoteId, 'two'); assert.equal(created.status, 'ready');
  assert.match(calls.at(-1).words[0].hint, /我记的谐音：阿普里尅神/);
  assert.deepEqual(created.exams, [{id: 'pretco-b', tier: '常见'}], 'unknown exam ids are dropped');
  assert.equal(store.notesToc(ALL).moved, 1);
  assert.deepEqual(store.reviewQueue(ALL).notes.map(note => note.id), ['rule']);
  vocab.fromNotesUndo(ALL, {backupId: result.backupId});
  assert.equal(fs.readFileSync(store.notesFile, 'utf8'), notesBefore);
  assert.equal(fs.readFileSync(vocab.file, 'utf8'), vocabBefore);
});

test('P4 move check validates substrings and only calls the model once per 30 candidates', async t => {
  const {store} = fixture(t);
  const notes = Array.from({length: 31}, (_, i) => n(`c${i}`, `word${'abcdefghijklmnopqrstuvwxyzabcde'[i]} = 意思${i}`));
  notes.push(n('long', '这是一段很长的中文笔记，讲的是 C 语言里指针和数组的区别'));
  setNotes(store, notes);
  const calls = [];
  const vocab = new LearningVocab(store, {requestModel: async (rules, payload) => {
    calls.push(payload.notes.length);
    return {value: {items: payload.notes.map(note => ({id: note.id, move: true, reason: '单词+释义',
      words: [{word: note.text.split(' ')[0], hint: note.id === 'c0' ? '模型自己补的' : note.text.split('= ')[1], homophone: '编的谐音'}]}))}};
  }});
  assert.equal(vocab.fromNotesPreview(ALL).pending, 31);
  await vocab.moving;
  assert.deepEqual(calls, [30, 1]);
  const preview = vocab.fromNotesPreview(ALL);
  assert.equal(preview.items.length, 31); assert.equal(preview.pending, 0);
  const c0 = preview.items.find(item => item.noteId === 'c0').words[0];
  assert.equal(c0.hint, ''); assert.equal(c0.homophone, '');
  assert.equal(preview.items.find(item => item.noteId === 'c1').words[0].hint, '意思1');
});

test('section build rejects out-of-section sources, saves per section, tracks new notes and undoes only the section', async t => {
  const {store} = fixture(t);
  setNotes(store, [n('a', 'avoid doing', {exam: 'pretco-b', subject: '语法', topic: '非谓语', triagedAt: 5}),
    n('b', 'enjoy doing', {exam: 'pretco-b', subject: '语法', topic: '非谓语', triagedAt: 5}),
    n('c', '指针', {exam: 'zsb', subject: 'C 语言', topic: '指针', triagedAt: 5})]);
  let reply = {notebook: {title: '语法', sections: [{title: '非谓语', type: '规则', points: [{text: 'avoid/enjoy 后接 doing', sourceIds: ['a', 'b', 'c']}]}]}};
  const organizer = organizerFor(store, () => reply);
  await assert.rejects(organizer.sectionBuild(ALL, {exam: 'pretco-b', subject: '语法', requestId: 'r1'}), /无效来源/);
  reply = {notebook: {title: '语法', sections: [{title: '非谓语', type: '乱', points: [{text: 'avoid/enjoy 后接 doing', sourceIds: ['a', 'b']}]}]}};
  assert.equal(organizer.calls[0].notes.length, 2, 'only this section is sent');
  const plan = await organizer.sectionBuild(ALL, {exam: 'pretco-b', subject: '语法', requestId: 'r2'});
  assert.equal(plan.notebook.sections[0].type, undefined, 'invalid type is cleared');
  assert.equal(store.getSection(ALL, {exam: 'pretco-b', subject: '语法'}).section, null);
  const applied = store.applyOrganizationPlan(ALL, 'r2', []);
  let got = store.getSection(ALL, {exam: 'pretco-b', subject: '语法'});
  assert.equal(got.section.pointCount, 1); assert.equal(got.newCount, 0); assert.equal(got.stale, false);
  assert.equal(store.listNotes({sessionKey: ALL, exam: 'pretco-b', subject: '语法'}).section.exists, true);
  assert.equal(store.organizedNotebook(ALL), null, 'legacy manuscript untouched');
  await new Promise(resolve => setTimeout(resolve, 3));
  store.updateNote(ALL, 'a', {content: 'avoid doing sth'});
  got = store.getSection(ALL, {exam: 'pretco-b', subject: '语法'});
  assert.equal(got.newCount, 1); assert.equal(got.stale, true);
  store.undoOrganization(ALL, applied.backupId);
  assert.equal(store.getSection(ALL, {exam: 'pretco-b', subject: '语法'}).section, null);
  assert.equal(store.readNotesState().notes.find(note => note.id === 'a').content, 'avoid doing sth', 'section undo does not roll notes back');
});

test('legacy manuscript shows read-only under 其它', t => {
  const {store} = fixture(t);
  setNotes(store, [n('a', 'x')]);
  store.writeNotes(store.readNotesState().notes, {organizedNotebooks: {[ALL]: {title: '旧稿', sections: [{title: 't', points: [{text: 'p', sourceIds: ['a']}]}], sourceCount: 1, pointCount: 1, sourceNoteIds: ['a']}}});
  const other = store.notesToc(ALL).exams.find(exam => exam.id === 'other');
  assert.deepEqual(other.subjects.map(subject => subject.name), ['旧版整理稿']);
  const got = store.getSection(ALL, {exam: 'other', subject: '旧版整理稿'});
  assert.equal(got.section.legacy, true); assert.equal(got.section.title, '旧稿');
});

test('vocab settings drive P1, retag only fills missing exams, import lists count coverage', async t => {
  const {store} = fixture(t);
  const calls = [];
  const vocab = new LearningVocab(store, {requestModel: async (rules, payload) => {
    calls.push({rules, payload});
    if (/补考试标注/.test(rules)) return {value: {entries: payload.words.map(word => ({id: word.id, exams: [{id: 'cet4', tier: '核心'}, {id: 'cet6', tier: '常见'}, {id: 'pretco-b', tier: '超纲'}]}))}};
    return {value: {entries: payload.words.map(word => vocabEntry(word.id, word.word))}};
  }});
  vocab.add({text: 'ambulance\npest'}); await vocab.running;
  assert.equal(vocab.list().words[0].level, 'B级常见');
  const before = vocab.list().words.map(word => word.meaning);
  const set = vocab.setSettings({exams: ['cet4', 'pretco-b', 'cet6'], primary: 'cet4'});
  assert.equal(set.settings.primary, 'cet4'); assert.equal(set.retagging, 2);
  await vocab.running;
  const retag = calls.filter(call => /补考试标注/.test(call.rules));
  assert.equal(retag.length, 1); assert.match(retag[0].rules, /cet4：英语四级/); assert.doesNotMatch(retag[0].rules, /pretco-b/);
  const words = vocab.list().words;
  assert.deepEqual(words[0].exams, [{id: 'pretco-b', tier: '常见'}, {id: 'cet4', tier: '核心'}, {id: 'cet6', tier: '常见'}], 'existing B 级 tag kept, model B 级 answer ignored');
  assert.deepEqual(words.map(word => word.meaning), before, 'retag never reorganizes words');
  assert.equal(vocab.list().counts.byExam.cet4.total, 2);
  vocab.add({text: 'apply for'}); await vocab.running;
  const p1 = calls.filter(call => !/补考试标注/.test(call.rules)).at(-1).rules;
  assert.match(p1, /主考试是「英语四级」/); assert.match(p1, /^- cet4：英语四级$/m);
  const imported = vocab.importList({name: '四级高频', text: 'Ambulance\npest\nabandon\n中文', exam: 'cet4'});
  assert.equal(imported.list.total, 3); assert.equal(imported.list.covered, 2);
  assert.equal(vocab.list().lists[0].covered, 2);
  assert.equal(vocab.list().counts.total, 3, 'importing a list never adds words');
});

test('today quiet list reports vocab and capped note reviews instead of the raw flashcard backlog', async t => {
  const {store} = fixture(t);
  const vocab = new LearningVocab(store, {requestModel: async (rules, payload) => ({value: {entries: payload.words.map(word => vocabEntry(word.id, word.word))}})});
  store.vocab = vocab;
  vocab.add({text: 'ambulance\npest'}); await vocab.running;
  setNotes(store, Array.from({length: 25}, (_, i) => n(`r${i}`, '规则')));
  const {LearningDesk} = await import('../services/mode-architecture/learning-desk.mjs');
  const quiet = LearningDesk.prototype.quiet.call({store}, Date.now(), 3);
  assert.deepEqual(quiet.map(item => item.kind), ['vocab', 'notes', 'retest']);
  assert.equal(quiet[0].count, 2); assert.match(quiet[0].meta, /新词 2/);
  assert.equal(quiet[1].count, 10); assert.equal(quiet[2].count, 3);
});
