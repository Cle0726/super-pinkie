import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LearningNotesOrganizer, registerLearningGateway, requestLearningModel} from '../services/mode-architecture/learning.mjs';

const A = 'agent:learning:first';
const B = 'agent:learning:second';
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-builtin-model-'));
  const store = new LearningInteractionStore({root: path.join(root, 'learning'), workspace: path.join(root, 'workspace')});
  const config = {models: {providers: {local: {api: 'openai-completions', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'private-secret', models: [
    {id: 'first', name: 'First', input: ['text', 'image']}, {id: 'second', name: 'Second', input: ['text']},
  ]}}}, agents: {list: [{id: 'learning', model: 'local/first'}], defaults: {model: {primary: 'local/first'}}}};
  const sent = [];
  const api = {config, registerGatewayMethod() {}};
  const organizer = new LearningNotesOrganizer(api, store, {fetchImpl: async (_url, options) => {
    sent.push(JSON.parse(options.body).model);
    return new Response(JSON.stringify({choices: [{message: {content: options.body.includes('请回复 OK') ? 'OK' : '{"ok":true}'}}]}));
  }});
  t.after(() => { clearInterval(store.game?.modules?.exam?.realTimer); fs.rmSync(root, {recursive: true, force: true}); });
  return {root, store, config, api, organizer, sent};
}

test('shared selection and reset ignore stale per-session preferences without rewriting notes or chat configuration', async t => {
  const {store, config, organizer, sent} = setup(t);
  store.writeNotes([], {organizerModels: {[A]: 'local/second'}});
  const configBefore = JSON.stringify(config);
  store.writeNotesMarkdown = () => { throw Error('settings must not rewrite notebooks'); };
  assert.equal(organizer.status(A).model, 'local/first');
  organizer.setBuiltinModel(A, 'local/second');
  assert.equal(organizer.status(B).model, 'local/second');
  assert.equal((await requestLearningModel(organizer, 'rules', {})).model.ref, 'local/second');
  assert.deepEqual(sent, ['second']);
  assert.equal(organizer.status(A).models.find(m => m.id === 'local/first').image, true);
  assert.equal(organizer.status(A).models.find(m => m.id === 'local/second').image, false);
  assert.doesNotMatch(JSON.stringify(organizer.status(A)), /private-secret|1234/);
  organizer.setBuiltinModel(B, '');
  assert.equal(organizer.status(A).model, 'local/first');
  assert.equal(organizer.status(A).selectedModel, '');
  assert.equal((await requestLearningModel(organizer, 'rules', {})).model.ref, 'local/first');
  assert.equal(JSON.stringify(config), configBefore);
  assert.equal(store.readNotesState().organizerModels[A], 'local/second');
});

test('a missing selected model reports the actual fallback and retains the preference until changed', async t => {
  const {config, organizer} = setup(t);
  organizer.setBuiltinModel(A, 'local/second');
  config.models.providers.local.models.pop();
  const status = organizer.status(B);
  assert.equal(status.selectedModel, 'local/second');
  assert.equal(status.model, 'local/first');
  assert.equal(status.usingFallback, true);
  assert.equal((await requestLearningModel(organizer, 'rules', {})).model.ref, status.model);
  organizer.setBuiltinModel(B, '');
  assert.equal(organizer.status(A).usingFallback, false);
});

test('changing models leaves an already-running notebook task intact', async t => {
  const {store, organizer} = setup(t);
  let release;
  organizer.fetchImpl = () => new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({structured: {term: 'term', meaning: '意思', example: '', note: ''}, tags: ['词汇']})}}]}))); });
  const note = store.saveNote(A, {content: 'term = 意思'}).note;
  const task = organizer.light(A, note.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  organizer.setBuiltinModel(A, 'local/second');
  release();
  const result = await task;
  assert.equal(result.skipped, undefined);
  assert.deepEqual(result.note.tags, ['词汇']);
  assert.equal(organizer.status(A).model, 'local/second');
});

test('game, real-paper parsing, practice bank, recall and drill observe the new choice immediately', async t => {
  const {root, store, api, organizer, sent} = setup(t);
  const methods = new Map();
  const materials = {root: path.join(root, 'materials'), status: () => ({roots: []})};
  registerLearningGateway({...api, registerGatewayMethod: (name, fn, opts) => methods.set(name, {fn, opts})}, store, {organizer, materials});
  assert.ok(store.game, 'game registered');
  const game = store.game;
  const callers = [game.requestModel, game.modules.world.game.requestModel, game.modules.monsters.game.requestModel,
    game.modules.content.game.requestModel, game.modules.exam.game.requestModel, game.modules.exam.real.model(), game.modules.practice.bank.requestModel];
  for (const caller of callers) assert.equal(caller, game.requestModel);
  organizer.setBuiltinModel(A, 'local/second');
  for (const caller of callers) assert.equal((await caller('rules', {})).model.ref, 'local/second');
  assert.equal(store.recall.modelStatus(B).model, 'local/second');
  assert.equal(store.drill.modelStatus(B).model, 'local/second');
  assert.equal(sent.length, callers.length);
  organizer.setBuiltinModel(B, '');
  assert.equal((await game.modules.exam.real.model()('rules', {})).model.ref, 'local/first');
  assert.equal(store.drill.modelStatus(A).model, 'local/first');
  for (const name of ['status', 'setModel', 'test']) assert.equal(methods.get(`pinkie.learning.builtinModel.${name}`).opts.scope, 'operator.admin');
});

test('connection test uses the draft model, preserves the selection and reports failure', async t => {
  const {organizer, sent} = setup(t);
  organizer.setBuiltinModel(A, 'local/second');
  const result = await organizer.testBuiltinModel(A, '');
  assert.equal(result.model, 'local/first');
  assert.deepEqual(sent, ['first']);
  assert.equal(organizer.status(A).model, 'local/second');
  await assert.rejects(organizer.testBuiltinModel('agent:project:x', 'local/first'), /学习模式/);
  await assert.rejects(organizer.testBuiltinModel(A, 'missing/model'), /不可用/);
  organizer.fetchImpl = async () => { throw Error('private networking detail'); };
  await assert.rejects(organizer.testBuiltinModel(A, 'local/first'), /连接失败/);
  organizer.fetchImpl = async () => new Response('private provider detail', {status: 404});
  await assert.rejects(organizer.testBuiltinModel(A, 'local/first'), /模型不存在，或当前模型来源无权使用/);
});

test('learning requests carry their runtime identity through the local model relay', async t => {
  const {organizer} = setup(t); let body;
  organizer.fetchImpl = async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({choices: [{message: {content: '{"ok":true}'}}]})); };
  await requestLearningModel(organizer, '学习台讲题规则', {question: 'fixture'}, {userText: '{"question":"fixture"}'});
  assert.match(body.messages[0].content, /^学习台讲题规则/);
  assert.match(body.messages[0].content, /## Runtime\nOpenClaw agent=learning/);
  assert.deepEqual(JSON.parse(body.messages[1].content), {question: 'fixture'});
});
