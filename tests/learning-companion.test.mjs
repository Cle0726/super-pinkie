import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore} from '../services/mode-architecture/learning.mjs';
import {LearningPact} from '../services/mode-architecture/learning-pact.mjs';
import {LearningDesk} from '../services/mode-architecture/learning-desk.mjs';
import {LearningVocab} from '../services/mode-architecture/learning-vocab.mjs';
import {LearningCompanion, TEMPLATES, registerLearningCompanion} from '../services/mode-architecture/learning-companion.mjs';

const SESSION = 'agent:learning:companion-test';
const HOUR = 3_600_000, DAY = 24 * HOUR;
const bj = (date, hour = 20) => Date.parse(`${date}T00:00:00Z`) - 8 * HOUR + hour * HOUR; // 北京时间 → instant
const AT = bj('2026-10-29', 20);
function fixture(t, {model = null, agent = null, fetchUrl = async () => true, exams = [{id: 'pretco-b', date: '2026-12-13'}, {id: 'zsb', date: '2028-04-22'}]} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-companion-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = AT;
  const now = () => clock;
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace')});
  store.pact = new LearningPact(store, {now});
  store.desk = new LearningDesk(store, {now});
  store.vocab = new LearningVocab(store, {});
  store.pact.set({exams});
  const companion = new LearningCompanion(store, {now, requestModel: model, runAgent: agent, fetchUrl});
  const attempt = (at, correct = true) => store.writeAttempt({id: `a-${Math.random().toString(36).slice(2)}`, sessionKey: SESSION, itemId: 'zsb-c5-75',
    question: {id: 'zsb-c5-75', topic: 'C语言 · 循环结构'}, submission: {confidence: 80, hintUsed: false}, result: {correct}, createdAt: at});
  return {store, companion, attempt, setClock: at => { clock = at; }};
}

test('rhythm learns usual hours from 14 days in Beijing time; after-midnight study counts as the night before', t => {
  const {companion, attempt} = fixture(t);
  assert.equal(companion.rhythm().lateAfter, 24.5, 'not enough data → default 0:30');
  for (const [date, start, end] of [['2026-10-25', 20, 23], ['2026-10-26', 21, 24.5], ['2026-10-27', 20.5, 23.5], ['2026-10-28', 21, 24]]) {
    attempt(bj(date, start)); attempt(bj(date, end));
  }
  const r = companion.rhythm();
  assert.equal(r.activeDays, 4);
  assert.equal(r.usualStart, 20.75);
  assert.equal(r.usualEnd, 23.75, 'a 0:30 stamp is read as 24.5 on the previous study day');
  assert.equal(r.lateAfter, 24.75);
  assert.equal(r.gapDays, 1);
  assert.equal(r.comeback, false);
  assert.equal(r.studiedToday, false);
  assert.deepEqual(r.yesterdayWin, {kind: 'answered', count: 2});
});

test('comeback after three quiet days; the yesterday win is a real event from the ledger', t => {
  const {companion, attempt, setClock} = fixture(t);
  for (let i = 0; i < 4; i++) attempt(bj('2026-10-24', 21) + i * 60_000);
  for (let i = 0; i < 4; i++) attempt(bj('2026-10-25', 21) + i * 60_000);
  assert.equal(companion.rhythm().gapDays, 4);
  assert.equal(companion.rhythm().comeback, true);
  assert.equal(companion.facts().alm.protagonist.id, 'comeback');
  setClock(bj('2026-10-25', 20));
  assert.deepEqual(companion.rhythm().yesterdayWin, {kind: 'lit', count: 1, text: 'while / do-while / for', ref: 'point:c5.1'}, 'lighting a point beats everything');
  setClock(bj('2026-10-26', 20));
  assert.deepEqual(companion.rhythm().yesterdayWin, {kind: 'run', count: 4}, 'otherwise a run of correct answers');
});

test('daily line: templates without a model; the model is called once per day and its line is validated', async t => {
  assert.ok(Object.values(TEMPLATES).every(list => list.length >= 6 && list.every(line => line.includes('先生') && !/漏了|偷懒|又没/.test(line))));
  const plain = fixture(t);
  const offline = await plain.companion.daily();
  assert.equal(offline.line.source, 'template');
  assert.ok(TEMPLATES.ordinary.includes(offline.line.text));

  const calls = [];
  let reply = '先生，今天把循环结构弄懂就好。';
  const {companion, setClock} = fixture(t, {model: async (rules, input) => { calls.push(input); return {value: {line: reply}, model: {name: 'fake'}}; }});
  const first = await companion.daily();
  assert.equal(first.line.pending, true, 'first open answers at once with the template');
  const [a, b] = await Promise.all([companion.daily({wait: true}), companion.daily({wait: true})]);
  assert.equal(calls.length, 1, 'one model call per Beijing day');
  assert.deepEqual([a.line.source, a.line.text, b.line.text], ['model', reply, reply]);
  assert.equal((await companion.daily()).line.text, reply, 'cached for the rest of the day');
  assert.ok(!JSON.stringify(calls[0]).includes('answer'), 'input carries facts only');

  for (const [bad, why] of [['先生，你又没学，偷懒了。', 'scolding'], ['今天也加油。', 'no 先生'], ['先生，你已经答对 37 题了！', 'made-up number']]) {
    setClock(Date.parse('2026-11-0' + (calls.length + 1) + 'T12:00:00Z'));
    reply = bad;
    const line = (await companion.daily({wait: true})).line;
    assert.equal(line.source, 'template', why);
  }
  setClock(bj('2026-11-10', 20)); reply = '先生，B 级还有 33 天，我们一件一件来。';
  assert.equal((await companion.daily({wait: true})).line.source, 'model', 'numbers from the facts pass');
  setClock(bj('2026-11-11', 20)); reply = '先生，B 级还有 33 天，我们一件一件来。';
  assert.equal((await companion.daily({wait: true})).line.source, 'template', 'a stale number fails the next day');
});

test('late night: a fixed go-to-sleep line, no model call, no clippings', async t => {
  let calls = 0, agents = 0;
  const {companion, setClock} = fixture(t, {model: async () => { calls++; return {value: {line: '先生，再来一组吧'}}; }, agent: async () => { agents++; return '{"clippings":[]}'; }});
  setClock(bj('2026-10-29', 25)); // 北京时间 01:00
  const daily = await companion.daily({wait: true});
  assert.deepEqual([daily.line.kind, daily.line.source, daily.protagonist.late], ['late', 'template', true]);
  assert.ok(TEMPLATES.late.includes(daily.line.text));
  const clip = await companion.clippings({wait: true});
  assert.deepEqual([clip.hidden, clip.reason], [true, 'late']);
  assert.deepEqual([calls, agents], [0, 0]);
});

test('clippings: verified, recent, ad-free, short quotes, cached a day; quiet before exams', async t => {
  const prompts = [], fetched = [];
  const output = '这是结果：\n```json\n' + JSON.stringify({clippings: [
    {title: '62 岁退休工人考上大学', source: '某报', url: 'https://example.com/a', publishedAt: '2026-10-25', summary: '他自学三年考上了。', quote: '这一句原文其实超过了十五个字的限制', note: '他也是从零开始的哦，先生'},
    {title: 'Old story', source: 'X', url: 'https://example.com/old', publishedAt: '2026-09-01', summary: '太旧了'},
    {title: '专升本速成班报名', source: 'Y', url: 'https://example.com/ad', publishedAt: '2026-10-27', summary: '广告'},
    {title: 'Dead link', source: 'Z', url: 'https://example.com/404', publishedAt: '2026-10-27', summary: '打不开'},
    {title: 'Nurse passes exam at 50', source: 'BBC', url: 'https://example.com/b', publishedAt: '2026-10-28', summary: '五十岁的护士重新考证。', quote: '从不嫌晚', note: '加油'},
  ]}) + '\n```';
  const {companion, setClock} = fixture(t, {agent: async prompt => { prompts.push(prompt); return output; }, fetchUrl: async url => { fetched.push(url); return !url.endsWith('404'); }});
  assert.equal((await companion.clippings()).status, 'running');
  const result = await companion.clippings({wait: true});
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /2026-10-15 到 2026-10-29/);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.clippings.map(clip => clip.url), ['https://example.com/a', 'https://example.com/b']);
  assert.equal(result.clippings[0].quote, '', 'quotes over 15 characters are dropped');
  assert.equal(result.clippings[1].note, '', 'margin notes must address 先生');
  assert.ok(!fetched.includes('https://example.com/old') && !fetched.includes('https://example.com/ad'), 'filter before fetching');
  assert.equal((await companion.clippings()).clippings.length, 2);
  assert.equal(prompts.length, 1, 'cached for the day');

  companion.save({clip: result.clippings[0]});
  companion.save({clip: result.clippings[0]});
  assert.equal(companion.saved().length, 1);
  assert.throws(() => companion.save({clip: {title: 'x'}}), /原文链接/);
  assert.equal(companion.unsave({url: 'https://example.com/a'}).clips.length, 0);

  setClock(bj('2026-12-08', 20)); // B 级前 5 天
  assert.deepEqual(await companion.clippings({wait: true}), {date: '2026-12-08', hidden: true, reason: 'quiet', clippings: []});
  assert.equal(prompts.length, 1);
});

test('clippings fail closed: agent errors or junk output show nothing, never yesterday’s clips', async t => {
  let mode = 'throw';
  const {companion, setClock} = fixture(t, {agent: async () => { if (mode === 'throw') throw new Error('offline'); return 'no json here'; }});
  assert.equal((await companion.clippings({wait: true})).status, 'failed');
  setClock(bj('2026-10-30', 20)); mode = 'junk';
  assert.deepEqual((await companion.clippings({wait: true})).clippings, []);
  assert.equal(fixture(t).companion.clippings instanceof Function, true);
  assert.equal((await fixture(t).companion.clippings()).status, 'unavailable');
});

test('month calendar marks studied days, exams, solar terms, milestones and personal days', t => {
  const {companion, attempt} = fixture(t, {exams: [{id: 'pretco-b', date: '2026-12-13'}]});
  attempt(bj('2026-10-27', 21)); attempt(bj('2026-10-27', 21.5)); attempt(bj('2026-10-27', 22), false);
  attempt(bj('2026-10-28', 24.5)); // 北京 10-29 00:30，算 10-28 夜里
  companion.setPersonal({birthday: '12-13', since: '2025-12-01'});
  const oct = companion.month();
  assert.deepEqual([oct.month, oct.today, oct.prev, oct.next], ['2026-10', '2026-10-29', '2026-09', '2026-11']);
  assert.equal(oct.days.length, 31);
  const day = d => oct.days[d - 1];
  assert.deepEqual([day(27).studied, day(27).answered, day(27).stars, day(27).lit], [true, 3, 2, 1], 'first lit point that day → 2 stars');
  assert.equal(day(28).studied, true);
  assert.equal(day(29).today, true);
  assert.equal(day(30).future, true);
  assert.equal(day(23).term, '霜降');
  assert.equal(oct.studiedDays, 2);
  const dec = companion.month({month: '2026-12'});
  const d13 = dec.days[12];
  assert.deepEqual(d13.exams, ['英语 B 级']);
  assert.equal(d13.birthday, true);
  assert.equal(dec.days[0].anniversary, true);
  assert.equal(companion.month({month: 'nope'}).month, '2026-10');
});

test('personal days validate formats; gateway checks the learning session', async t => {
  const {store, companion} = fixture(t);
  assert.throws(() => companion.setPersonal({birthday: '1990-12-13'}), /MM-DD/);
  assert.throws(() => companion.setPersonal({birthday: '13-01'}), /MM-DD/);
  assert.throws(() => companion.setPersonal({since: '10-26'}), /YYYY-MM-DD/);
  assert.deepEqual(companion.setPersonal({since: '2026-10-26'}).personal.since, '2026-10-26');
  assert.equal(companion.personal().birthday, '');
  const methods = new Map();
  registerLearningCompanion({registerGatewayMethod: (name, handler, options) => methods.set(name, {handler, options})}, store, {now: () => AT});
  assert.equal(methods.size, 7);
  const call = (name, params) => new Promise(resolve => methods.get(name).handler({params, respond: (ok, value, error) => resolve({ok, value, error})}));
  assert.equal((await call('pinkie.learning.desk.month', {sessionKey: 'agent:main:x'})).ok, false);
  const ok = await call('pinkie.learning.desk.companion', {sessionKey: SESSION});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.line.source, 'template');
});
