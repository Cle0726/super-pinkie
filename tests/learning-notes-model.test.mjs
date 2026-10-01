import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {LearningInteractionStore, LearningNotesOrganizer, registerLearningGateway} from '../services/mode-architecture/learning.mjs';

const sessionKey = 'agent:learning:independent-notes';
const lightResult = {structured: {term: 'put off', meaning: '推迟', example: '', note: ''}, tags: ['词组', '固定搭配']};
const response = value => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(value)}, finish_reason: 'stop'}]}));

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-notes-model-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new LearningInteractionStore({root: path.join(root, 'notes'), workspace: path.join(root, 'workspace')});
  const config = {models: {providers: {local: {api: 'openai-completions', baseUrl: 'http://127.0.0.1:1467/v1', apiKey: 'server-only-secret', models: [
    {id: 'notes-small', name: 'Notes Small'}, {id: 'notes-large', name: 'Notes Large'},
  ]}}}, agents: {defaults: {model: {primary: 'local/notes-small'}}}};
  const api = {config, runtime: {config: {current: () => config}, agent: new Proxy({}, {get() { throw new Error('Notes must not use a chat agent'); }})}};
  const organizer = new LearningNotesOrganizer(api, store, options);
  return {root, store, config, api, organizer};
}

test('save RPC only stores a note even when an organizer model is available', async t => {
  let modelCalls = 0;
  const {store, api, organizer} = fixture(t, {fetchImpl: async () => { modelCalls++; return response(lightResult); }});
  const methods = new Map();
  registerLearningGateway({...api, registerGatewayMethod(name, handler) { methods.set(name, handler); }}, store, {organizer});
  let result;
  await methods.get('pinkie.learning.notes.save')({params: {sessionKey, content: 'just record this'}, respond(ok, value) { result = {ok, value}; }});
  assert.equal(result.ok, true);
  assert.equal(modelCalls, 0);
  assert.equal(result.value.note.content, 'just record this');
  assert.equal(result.value.note.original, 'just record this');
  assert.deepEqual(result.value.note.tags, []);
  assert.equal(result.value.note.lightOrganizedAt, undefined);
});

test('selection and question-card save actions do not organize until the user explicitly asks', async t => {
  let modelCalls = 0;
  const {store, api, organizer} = fixture(t, {fetchImpl: async () => { modelCalls++; return response(lightResult); }});
  const methods = new Map(); const requests = [];
  registerLearningGateway({...api, registerGatewayMethod(name, handler) { methods.set(name, handler); }}, store, {organizer});
  let toast;
  const chatGroups = ['[[CLEKK_NOTE_LIGHT_V1]] old request', '[[CLEKK_NOTE_DEEP_V1]] old request', '普通学习问题'].map(textContent => {
    const node = {textContent};
    node.classList = {toggle(_name, hidden) { node.hiddenControl = hidden; }};
    return node;
  });
  const element = () => ({
    className: '', dataset: {}, setAttribute() {}, remove() {},
    classList: {add() {}, remove() {}, toggle() {}},
  });
  const document = {
    readyState: 'loading', addEventListener() {},
    querySelector(selector) { return selector === '.laolao-learning-toast' ? toast : null; },
    querySelectorAll(selector) { return selector === '.chat-group.user' ? chatGroups : []; },
    createElement: element, body: {append(node) { toast = node; }},
  };
  const window = {addEventListener() {}, __laolaoSidebar: {gwRequest(method, params) {
    requests.push(method);
    assert.ok(methods.has(method), `Unexpected chat or model request: ${method}`);
    return new Promise((resolve, reject) => methods.get(method)({params, respond(ok, value, error) {
      if (ok) resolve(value); else reject(new Error(error.message));
    }}));
  }}};
  const source = fs.readFileSync(new URL('../ui/injections/laolao-learning-stage.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'window.__notesTest = {state, saveSelection, saveCurrentKeyPoint, organizeSingleNote, hideControlMessages};})();');
  vm.runInNewContext(source, {
    window, document, location: {href: `http://localhost/chat?session=${sessionKey}`}, URL,
    crypto: {randomUUID}, setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
  });
  const hooks = window.__notesTest;
  hooks.hideControlMessages();
  assert.deepEqual(chatGroups.map(node => node.hiddenControl), [true, true, false]);
  assert.equal(chatGroups[0].textContent, '[[CLEKK_NOTE_LIGHT_V1]] old request');
  hooks.state.selectionText = 'put off = 推迟'; hooks.state.selectionLabel = '碧琪回答';
  await hooks.saveSelection();
  hooks.state.remote = {current: {topic: '知识点', result: {keyPoint: 'take off = 起飞'}}};
  await hooks.saveCurrentKeyPoint(element());
  assert.deepEqual(requests, ['pinkie.learning.notes.save', 'pinkie.learning.notes.save']);
  assert.equal(modelCalls, 0);
  const notes = store.listNotes({sessionKey}).notes;
  assert.equal(notes.length, 2);
  assert.equal(notes.every(note => !note.lightOrganizedAt), true);
  assert.deepEqual(store.findOwnedNote(sessionKey, notes[1].id).tags, []);
  await hooks.organizeSingleNote(notes[1]);
  assert.equal(modelCalls, 1);
  assert.equal(requests.at(-1), 'pinkie.learning.notes.organize.light');
  assert.ok(store.findOwnedNote(sessionKey, notes[1].id).lightOrganizedAt);
  assert.equal(requests.includes('chat.send'), false);
});

test('notes model calls the provider directly and keeps chat state, original, and credentials private', async t => {
  let requested;
  const {root, store, organizer} = fixture(t, {fetchImpl: async (url, options) => {
    requested = {url: String(url), ...options}; return response(lightResult);
  }});
  const chatFile = path.join(root, 'chat.jsonl');
  fs.writeFileSync(chatFile, 'NORMAL_CHAT_SENTINEL\n');
  const saved = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  store.saveNote('agent:learning:other', {content: 'FOREIGN_NOTE_SENTINEL'});
  const result = await organizer.light(sessionKey, saved.id);
  assert.equal(requested.url, 'http://127.0.0.1:1467/v1/chat/completions');
  assert.equal(requested.headers.Authorization, 'Bearer server-only-secret');
  const body = JSON.parse(requested.body);
  assert.equal(body.stream, false);
  assert.equal(body.model, 'notes-small');
  assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
  assert.doesNotMatch(requested.body, /NORMAL_CHAT_SENTINEL|FOREIGN_NOTE_SENTINEL|sessionKey|learning_notes/);
  assert.equal(result.note.original, 'put off = 推迟');
  assert.equal(result.note.content, 'put off = 推迟');
  assert.deepEqual(result.note.tags, ['词组', '固定搭配']);
  assert.equal(fs.readFileSync(chatFile, 'utf8'), 'NORMAL_CHAT_SENTINEL\n');
  assert.doesNotMatch(JSON.stringify(organizer.status(sessionKey)), /server-only-secret|baseUrl|1467/);
});

test('organizer model selection is scoped and does not patch the chat model or global config', async t => {
  const {store, organizer, config} = fixture(t, {fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, 'notes-large'); return response(lightResult);
  }});
  const before = JSON.stringify(config);
  organizer.setModel(sessionKey, 'local/notes-large');
  assert.equal(organizer.status(sessionKey).selectedModel, 'local/notes-large');
  assert.equal(organizer.status('agent:learning:other').model, 'local/notes-small');
  assert.equal(JSON.stringify(config), before);
  assert.throws(() => organizer.setModel(sessionKey, 'unconfigured/model'), /不可用/);
  assert.throws(() => organizer.status('agent:project:other'), /学习模式/);
  const note = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  await organizer.light(sessionKey, note.id);
  assert.equal(JSON.stringify(config), before);
});

test('full notebooks refuse new notes and compare cards without truncating existing records', t => {
  const {store, organizer} = fixture(t);
  fs.mkdirSync(store.root, {recursive: true});
  const notes = Array.from({length: 500}, (_, index) => ({id: `note-${index}`, content: `word ${index}`, original: `word ${index}`, sourceSessionKey: sessionKey}));
  fs.writeFileSync(store.notesFile, JSON.stringify({v: 1, notes}));
  const plan = store.stageOrganizationPlan(sessionKey, 'full-notebook', [{type: 'compare', ids: ['note-0', 'note-1'], reason: '比较用法'}]);
  const bytes = fs.readFileSync(store.notesFile, 'utf8');
  assert.throws(() => store.saveNote(sessionKey, {content: 'new note'}), /500.*上限/);
  assert.throws(() => store.applyOrganizationPlan(sessionKey, plan.id, [plan.operations[0].id]), /500.*上限/);
  assert.equal(fs.readFileSync(store.notesFile, 'utf8'), bytes);
  assert.deepEqual(store.readNotesState().notes.map(note => note.id), notes.map(note => note.id));
  // Existing oversized files must also survive writing model preferences.
  notes.push({id: 'legacy-over-limit', content: 'old original', sourceSessionKey: sessionKey});
  fs.writeFileSync(store.notesFile, JSON.stringify({v: 1, notes}));
  organizer.setModel(sessionKey, 'local/notes-large');
  assert.equal(store.readNotesState().notes.length, 501);
  assert.equal(store.findOwnedNote(sessionKey, 'legacy-over-limit').content, 'old original');
});

test('missing model skips light organization and never blocks or changes a saved note', async t => {
  let fetched = false;
  const {store, config, organizer} = fixture(t, {fetchImpl: async () => { fetched = true; }});
  config.models.providers = {};
  const saved = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  const bytes = fs.readFileSync(store.notesFile, 'utf8');
  assert.equal((await organizer.light(sessionKey, saved.id)).skipped, true);
  await assert.rejects(organizer.preview(sessionKey, 'no-model'), /不可用/);
  assert.equal(fs.readFileSync(store.notesFile, 'utf8'), bytes);
  assert.equal(fetched, false);
});

test('light organization drops delayed results after editing and preserves user tags and legacy originals', async t => {
  let finish;
  const {store, organizer} = fixture(t, {fetchImpl: () => new Promise(resolve => { finish = resolve; })});
  const note = store.saveNote(sessionKey, {content: 'put off = 推迟', tags: ['自选标签']}).note;
  const pending = organizer.light(sessionKey, note.id);
  await Promise.resolve();
  store.updateNote(sessionKey, note.id, {content: 'put off = 延后', tags: ['用户改过的标签']});
  finish(response(lightResult));
  assert.equal((await pending).skipped, true);
  assert.equal(store.findOwnedNote(sessionKey, note.id).content, 'put off = 延后');
  assert.deepEqual(store.findOwnedNote(sessionKey, note.id).tags, ['用户改过的标签']);
  const legacy = store.readNotesState();
  delete legacy.notes[0].original;
  legacy.notes[0].content = '旧笔记原文';
  fs.writeFileSync(store.notesFile, JSON.stringify(legacy));
  const changed = store.updateNote(sessionKey, note.id, {content: '编辑后的正文'});
  assert.equal(changed.note.original, '旧笔记原文');
});

test('explicit user tags survive a successful model suggestion', async t => {
  const {store, organizer} = fixture(t, {fetchImpl: async () => response(lightResult)});
  const note = store.saveNote(sessionKey, {content: 'put off = 推迟', tags: ['我的标签']}).note;
  assert.deepEqual((await organizer.light(sessionKey, note.id)).note.tags, ['我的标签']);
});

test('independent deep RPC validates references and stages a preview without applying to notes', async t => {
  const {store, api} = fixture(t);
  const note = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  const foreign = store.saveNote('agent:learning:other', {content: 'other = 其他'}).note;
  const organizer = new LearningNotesOrganizer(api, store, {fetchImpl: async (_url, options) => {
    assert.doesNotMatch(options.body, new RegExp(foreign.id));
    return response({operations: [
      {type: 'group', ids: [note.id], topic: '时间表达', reason: '便于查找'},
      {type: 'group', ids: [foreign.id], topic: '串会话', reason: '无效引用'},
    ]});
  }});
  const methods = new Map();
  registerLearningGateway({...api, registerGatewayMethod(name, handler, opts) { methods.set(name, {handler, opts}); }}, store, {organizer});
  const route = methods.get('pinkie.learning.notes.organize.preview');
  assert.equal(route.opts.scope, 'operator.admin');
  let result;
  await route.handler({params: {sessionKey, requestId: 'independent-preview'}, respond(ok, value, error) { result = {ok, value, error}; }});
  assert.equal(result.ok, true);
  assert.equal(result.value.state, 'preview');
  assert.equal(result.value.operations.length, 1);
  assert.equal(result.value.discarded.length, 1);
  assert.equal(store.findOwnedNote(sessionKey, note.id).topic, undefined);
  assert.equal(store.getOrganizationPlan('agent:learning:other', 'independent-preview').state, 'pending');
});

test('model waits and outdated previews cannot overwrite notes that changed', async t => {
  let finish;
  const {store, organizer} = fixture(t, {fetchImpl: () => new Promise(resolve => { finish = resolve; })});
  const note = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  const pending = organizer.preview(sessionKey, 'stale-result');
  await Promise.resolve();
  store.updateNote(sessionKey, note.id, {content: 'put off = 延后'});
  finish(response({operations: [{type: 'group', ids: [note.id], topic: '时间', reason: '归类'}]}));
  await assert.rejects(pending, /整理期间已修改/);
  assert.equal(store.getOrganizationPlan(sessionKey, 'stale-result').state, 'pending');
  const plan = store.stageOrganizationPlan(sessionKey, 'stale-preview', [{type: 'group', ids: [note.id], topic: '时间', reason: '归类'}]);
  store.updateNote(sessionKey, note.id, {content: '最新的用户修改'});
  assert.throws(() => store.applyOrganizationPlan(sessionKey, plan.id, [plan.operations[0].id]), /预览中的笔记已修改/);
  assert.equal(store.findOwnedNote(sessionKey, note.id).content, '最新的用户修改');
});

test('timeouts, upstream failures, and malformed model output keep notes unchanged', async t => {
  let signal;
  const {store, api, organizer} = fixture(t, {timeoutMs: 10, fetchImpl: async (_url, options) => {
    signal = options.signal; return new Promise(() => {});
  }});
  const note = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  const bytes = fs.readFileSync(store.notesFile, 'utf8');
  await assert.rejects(organizer.light(sessionKey, note.id), /超时/);
  assert.equal(signal.aborted, true);
  for (const fetchImpl of [
    async () => new Response('do not expose server-only-secret', {status: 503}),
    async () => response({structured: {term: 'missing-fields'}}),
    async () => new Response('{malformed'),
  ]) {
    const bad = new LearningNotesOrganizer(api, store, {fetchImpl});
    await assert.rejects(bad.light(sessionKey, note.id), error => !error.message.includes('server-only-secret'));
  }
  assert.equal(fs.readFileSync(store.notesFile, 'utf8'), bytes);
});

test('response endpoints keep structured outputs independent and avoid provider redirects', async t => {
  const {store, config, api} = fixture(t);
  const note = store.saveNote(sessionKey, {content: 'put off = 推迟'}).note;
  for (const protocol of ['openai-responses', 'anthropic-messages']) {
    config.models.providers.local.api = protocol;
    const organizer = new LearningNotesOrganizer(api, store, {fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(options.redirect, 'error');
      assert.equal(String(url).endsWith(protocol === 'openai-responses' ? '/responses' : '/messages'), true);
      if (protocol === 'openai-responses') {
        assert.equal(body.store, false);
        return new Response(JSON.stringify({output: [{content: [{type: 'output_text', text: JSON.stringify(lightResult)}]}]}));
      }
      assert.equal(options.headers['x-api-key'], 'server-only-secret');
      return new Response(JSON.stringify({content: [{type: 'text', text: JSON.stringify(lightResult)}]}));
    }});
    assert.equal((await organizer.light(sessionKey, note.id)).ok, true);
  }
});
