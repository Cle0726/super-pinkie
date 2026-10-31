import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningVocab, parseVocabInput, VOCAB_MODEL_RULES} from '../services/mode-architecture/learning-vocab.mjs';

function fixture(t, requestModel) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-vocab-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return new LearningVocab({root}, {requestModel});
}
const entry = (id, word) => ({id, word, phonetic: '/ˈæmbjələns/', pos: 'n.', meaning: '救护车', homophone: '俺不能死', memory: '救护车来了，俺不能死',
  collocations: [{en: 'call an ambulance', zh: '叫救护车'}], example: {en: 'Please call an ambulance.', zh: '请叫救护车。'}, examTip: '常考 call an ~', level: 'B级常见'});

test('parses one word per line with optional Chinese hints and phrases', () => {
  assert.deepEqual(parseVocabInput('ambulance\nlook forward to 期待\n- pest：害虫\n3. apply for — 申请\n中文行\n'), [
    {word: 'ambulance', hint: ''}, {word: 'look forward to', hint: '期待'}, {word: 'pest', hint: '害虫'}, {word: 'apply for', hint: '申请'}]);
});

test('add saves first, organizes in the background, dedupes and reviews', async t => {
  const calls = [];
  const vocab = fixture(t, async (rules, payload, options) => {
    calls.push({rules, payload, options});
    return {value: {entries: payload.words.map(word => entry(word.id, word.word))}, model: {name: 'Fixture'}};
  });
  const first = vocab.add({text: 'ambulance\nAmbulance\npest 害虫'});
  assert.equal(first.added.length, 2); assert.deepEqual(first.duplicates, ['ambulance']);
  assert.equal(vocab.list().counts.total, 2);
  await vocab.running;
  assert.equal(calls.length, 1); assert.equal(calls[0].rules, VOCAB_MODEL_RULES);
  assert.equal(JSON.parse(calls[0].options.userText).words[1].hint, '害虫');
  const listed = vocab.list();
  assert.ok(listed.words.every(word => word.status === 'ready' && word.homophone === '俺不能死' && word.collocations.length === 1));
  assert.equal(listed.model, 'Fixture'); assert.equal(listed.counts.due, 2);
  assert.deepEqual(vocab.add({text: 'pest'}).duplicates, ['pest']);
  const queue = vocab.reviewQueue();
  assert.equal(queue.total, 2);
  const reviewed = vocab.review(queue.words[0].id, 'remembered');
  assert.equal(reviewed.word.due, false); assert.equal(vocab.list({filter: 'due'}).words.length, 1);
  assert.equal(vocab.list({query: '俺不能'}).words.length, 2);
});

test('model failure keeps the word and allows retry; edits during organizing are not overwritten', async t => {
  let fail = true, release;
  const vocab = fixture(t, async (rules, payload) => {
    if (fail) throw new Error('模型连接失败');
    await new Promise(resolve => { release = resolve; });
    return {value: {entries: payload.words.map(word => entry(word.id, word.word))}};
  });
  const {added: [word]} = vocab.add({text: 'ambulence'});
  await vocab.running;
  let saved = vocab.list().words[0];
  assert.equal(saved.status, 'failed'); assert.match(saved.error, /连接失败/); assert.equal(saved.word, 'ambulence');
  fail = false; vocab.reorganize([word.id]);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  vocab.update(word.id, {word: 'ambulance'});
  release(); release = null;
  while (!release && vocab.running) { await new Promise(resolve => setTimeout(resolve, 5)); if (release) release(); }
  await vocab.running;
  saved = vocab.list().words[0];
  assert.equal(saved.word, 'ambulance'); assert.equal(saved.status, 'ready');
});

test('unavailable model marks failed without spinning; delete and restore round-trip', async t => {
  let calls = 0;
  const vocab = fixture(t, async () => { calls++; return {unavailable: true}; });
  vocab.add({text: 'pest\napply for'});
  await vocab.running;
  assert.equal(calls, 1); assert.ok(vocab.list().words.every(word => word.status === 'failed'));
  const target = vocab.list().words[0];
  const removed = vocab.remove(target.id);
  assert.equal(vocab.list().counts.total, 1);
  assert.equal(vocab.restore(removed.word).restored, true); assert.equal(vocab.list().counts.total, 2);
  assert.throws(() => vocab.add({text: '只有中文'}), /没有认出英文/);
});
