import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LearningNotesOrganizer, requestLearningModel, registerLearningGateway} from '../services/mode-architecture/learning.mjs';
import {LearningPact} from '../services/mode-architecture/learning-pact.mjs';
import {LearningDesk, generateItemMapping, matchDeskTopic, validateDeskInsight} from '../services/mode-architecture/learning-desk.mjs';

const SESSION = 'agent:learning:desk-test';
const AT = Date.parse('2026-10-19T01:00:00Z');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-desk-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = AT;
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace')});
  const pact = new LearningPact(store, {now: () => clock}); store.pact = pact;
  const desk = new LearningDesk(store, {now: () => clock, ...options});
  const seed = (overrides = {}) => store.writeAttempt({id: `a-${Math.random()}`, sessionKey: SESSION, itemId: 'zsb-c5-75',
    question: {id: 'zsb-c5-75', topic: 'C语言 · 循环结构'}, submission: {confidence: 70, hintUsed: false},
    result: {correct: true}, createdAt: clock, ...overrides});
  return {store, pact, desk, seed, setClock: at => { clock = at; }};
}
const item = (desk, k = 'c5', i = 1) => desk.items().find(item => item.k === k && item.i === i);

test('legacy exams migrate without losing dates; single-exam patches preserve the other exam', t => {
  const {pact} = fixture(t);
  fs.mkdirSync(pact.root, {recursive: true});
  fs.writeFileSync(pact.pactFile, JSON.stringify({exam: {name: 'PRETCO-B', date: '2026-12-20'}, createdAt: AT - 86400000}));
  assert.deepEqual(pact.get().exams, [{id: 'pretco-b', name: '英语 B 级', date: '2026-12-20'}, {id: 'zsb', name: '专升本', date: null}]);
  assert.ok(JSON.parse(fs.readFileSync(pact.pactFile)).exams);
  pact.set({exams: [{id: 'zsb', date: '2027-04-24'}]});
  assert.equal(pact.get().exams[0].date, '2026-12-20');
  assert.equal(pact.get().exams[1].date, '2027-04-24');
  pact.set({exams: {id: 'pretco-b', date: null}});
  assert.equal(pact.get().exam.date, null);
  for (const date of ['2027-02-30', '2027-2-1', '2027-04-xx', '2027-04-24oops']) assert.throws(() => pact.set({exams: [{id: 'zsb', date}]}), /日期/);
});

test('all 390 bank items have reproducible chapter mappings, >=80% have verified item indices', () => {
  const mapping = generateItemMapping();
  const checked = JSON.parse(fs.readFileSync(new URL('../services/mode-architecture/learning-zsb-items.json', import.meta.url)));
  assert.deepEqual(mapping, checked);
  const entries = Object.values(mapping.questions);
  assert.equal(entries.length, 390);
  assert.ok(entries.filter(item => item.i !== null).length / entries.length >= .8);
  assert.equal(mapping.questions['c7-116'].i, null, 'a broad application does not claim a guessed item');
  assert.deepEqual(matchDeskTopic('C语言 · c5 · break 与 continue'), {k: 'c5', i: 3});
  assert.equal(matchDeskTopic('随便聊聊'), null);
  assert.equal(matchDeskTopic('循环结构').i, null);
});

test('mastery needs independent success and a later-day retest; unresolved errors stay weak', t => {
  const {desk, seed, setClock} = fixture(t);
  assert.equal(item(desk).state, 'none');
  seed({submission: {confidence: 95, hintUsed: true}}); assert.equal(item(desk).state, 'none');
  seed({submission: {confidence: null, hintUsed: false}}); assert.equal(item(desk).state, 'none');
  seed(); assert.equal(item(desk).state, 'lit');
  seed({question: {id: 'zsb-c5-75', deskMode: 'retest'}}); assert.equal(item(desk).state, 'lit');
  setClock(AT + 86400000);
  seed({question: {id: 'zsb-c5-75', deskMode: 'retest'}}); assert.equal(item(desk).state, 'mastered');
  setClock(AT + 86400000 + 10);
  seed({result: {correct: false}}); assert.equal(item(desk).state, 'weak');
  seed(); assert.equal(item(desk).state, 'weak', 'same-day practice does not clear failed evidence');
  setClock(AT + 2 * 86400000);
  seed({question: {id: 'zsb-c5-75', deskMode: 'retest'}}); assert.equal(item(desk).state, 'mastered');
});

test('today uses Shanghai exam boundaries, real ledgers, due retests and conservative topic matching', t => {
  const {desk, pact, seed, setClock} = fixture(t);
  pact.set({exams: [{id: 'zsb', date: '2027-04-24'}]});
  pact.recordQuestion({correct: true});
  let today = desk.today({sessionKey: SESSION});
  assert.equal(today.mastery.total, 144);
  assert.equal(today.progress.questions, 1);
  assert.equal(today.exams[0].daysLeft, null);
  assert.equal(today.focus.payload.chapter, 'ee1');
  seed({result: {correct: false}});
  today = desk.today({sessionKey: SESSION}); assert.equal(today.focus.payload.chapter, 'c5');
  setClock(Date.parse('2026-10-19T16:01:00Z'));
  today = desk.today({sessionKey: SESSION});
  assert.equal(today.date, '2026-10-20'); assert.equal(today.focus.payload.mode, 'retest');
  seed({question: {id: 'chat-generated', topic: '未知话题'}});
  assert.equal(today.mastery.lit, desk.mastery().lit);
  assert.throws(() => desk.today({sessionKey: 'agent:project:x'}), /学习|习作/);
});

test('desk is registered from the existing learning gateway without index edits', async t => {
  const {store} = fixture(t); const methods = new Map();
  registerLearningGateway({registerGatewayMethod(name, handler, opts) { methods.set(name, {handler, opts}); }}, store);
  assert.equal(methods.get('pinkie.learning.desk.today').opts.scope, 'operator.read');
  const result = await new Promise(resolve => methods.get('pinkie.learning.desk.today').handler({params: {sessionKey: SESSION}, respond: (ok, value) => resolve({ok, value})}));
  assert.equal(result.ok, true); assert.equal(result.value.exams.length, 2);
});

test('sets hide answers, grade on the server, and repeated submissions never double-count', t => {
  const {desk, pact, store} = fixture(t);
  const set = desk.set({sessionKey: SESSION, chapter: 'c5', item: 1, size: 3});
  assert.equal(new Set(set.questions.map(q => q.id)).size, set.questions.length);
  assert.doesNotMatch(JSON.stringify(set), /correct_answer|correctAnswer|explanation|rubric|accepted_answers/);
  const q = set.questions[0];
  const privateSet = JSON.parse(fs.readFileSync(desk.setFile(SESSION, set.setId)));
  const expected = privateSet.questions[0].question.correct_answer;
  const submitted = {sessionKey: SESSION, setId: set.setId, questionId: q.id, answer: expected, confidence: 70, hintUsed: false, ms: 1200};
  const result = desk.answer(submitted);
  assert.equal(result.correct, true); assert.equal(result.independent, true); assert.equal(result.item.state, 'lit');
  assert.deepEqual(desk.answer({...submitted, answer: 'changed'}), result);
  assert.equal(pact.today().progress.questions, 1); assert.equal(pact.today().progress.correct, 1);
  assert.equal(store.allAttempts().length, 1);
  // 模拟写完作答和账本后，还没保存响应就中断。
  fs.writeFileSync(desk.setFile(SESSION, set.setId), JSON.stringify(privateSet));
  assert.equal(desk.answer(submitted).correct, true);
  assert.equal(pact.today().progress.questions, 1);
  assert.throws(() => desk.answer({...submitted, sessionKey: 'agent:learning:other'}), /找到/);
  assert.throws(() => desk.answer({...submitted, setId: '../../secrets'}), /编号/);
});

test('confidence and hints affect independence; blank answers use normalized accepted alternatives', t => {
  const bank = [{id: 'fill-test', k: 'c5', t: 'fill', q: '填空', a: ['Hello World', 'hi'], x: '解释'}];
  const {desk} = fixture(t, {bank, mapping: {'fill-test': {k: 'c5', i: 1}}});
  for (const [confidence, hintUsed, independent] of [[null, false, false], [40, false, false], [70, true, false], [95, false, true]]) {
    const set = desk.set({sessionKey: SESSION, size: 1});
    const result = desk.answer({sessionKey: SESSION, setId: set.setId, questionId: set.questions[0].id, answer: '  ＨＥＬＬＯ   world ', confidence, hintUsed});
    assert.equal(result.correct, true); assert.equal(result.independent, independent);
  }
  const set = desk.set({sessionKey: SESSION, size: 1});
  assert.throws(() => desk.answer({sessionKey: SESSION, setId: set.setId, questionId: set.questions[0].id, answer: 'hi', confidence: 50}), /把握/);
});

test('a next-day retest changes lit to mastered and records exactly one new ledger answer', t => {
  const bank = [{id: 'retest-test', k: 'c5', t: 'single', q: 'q', o: ['a','b'], a: 'A', x: 'why'}];
  const {desk, setClock, pact} = fixture(t, {bank, mapping: {'retest-test': {k: 'c5', i: 1}}});
  function answer(mode) { const set = desk.set({sessionKey: SESSION, chapter: 'c5', mode}); return desk.answer({sessionKey: SESSION, setId: set.setId, questionId: set.questions[0].id, answer: 'A', confidence: 95}); }
  assert.equal(answer('practice').item.state, 'lit');
  setClock(AT + 86400000);
  assert.equal(answer('retest').item.state, 'mastered');
  assert.equal(pact.today().progress.questions, 1);
});

test('metrics calculate calendar-day series, deltas, independent rates and exam pace from real evidence', t => {
  const {desk, pact, seed, setClock} = fixture(t);
  pact.set({exams: [{id: 'zsb', date: '2027-04-24'}]});
  seed();
  pact.mutateDay('2026-10-19', day => { day.minutes = 20; day.reviews.done = 3; });
  pact.recordQuestion({correct: true});
  pact.mutateDay('2026-10-12', day => { day.minutes = 10; });
  let metrics = desk.metrics({sessionKey: SESSION});
  assert.equal(metrics.minutes.total, 20); assert.equal(metrics.minutes.delta, 1);
  assert.deepEqual(metrics.minutes.series, [0, 0, 0, 0, 0, 0, 20]);
  assert.equal(metrics.answered.total, 1); assert.equal(metrics.answered.independentRate, 1);
  assert.equal(metrics.reviews.done, 3); assert.equal(metrics.pace.lit, 1);
  assert.equal(metrics.pace.startDate, '2026-10-12');
  assert.equal(metrics.pace.ratePerDay, 1 / 8);
  assert.equal(metrics.pace.projectedDate, '2029-12-06');
  assert.equal(desk.metrics({sessionKey: SESSION, range: '30d'}).dates.length, 30);
  setClock(AT + 86400000); seed({result: {correct: false}});
  metrics = desk.metrics({sessionKey: SESSION, range: 'all'});
  assert.deepEqual(metrics.pace.history.slice(-2).map(point => point[1]), [1, 0]);
  pact.set({exams: [{id: 'zsb', date: null}]});
  assert.equal(desk.metrics({sessionKey: SESSION}).pace, null);
});

test('digest is deterministic, numbered and excludes private notes, questions, answers and arbitrary error text', t => {
  const {desk, store, seed} = fixture(t);
  store.writeNotes([{id: 'n1', sourceSessionKey: SESSION, content: 'PRIVATE NOTE', status: 'active'}]);
  seed({question: {id: 'zsb-c5-75', question: 'PRIVATE QUESTION', correctAnswer: 'SECRET ANSWER'}, result: {correct: false, errorType: 'PRIVATE CHAT'}});
  const digest = desk.digest({sessionKey: SESSION});
  const text = JSON.stringify(digest);
  assert.doesNotMatch(text, /PRIVATE|SECRET/);
  assert.equal(new Set(digest.rows.map(row => row.id)).size, digest.rows.length);
  assert.ok(['L','A','E','R','M','X'].every(prefix => digest.rows.some(row => row.id.startsWith(prefix))));
  assert.deepEqual(desk.digest({sessionKey: SESSION}), digest);
  assert.throws(() => desk.digest({sessionKey: SESSION, range: 'bogus'}), /范围/);
});

function modelFixture(t, {api = 'openai-completions', payload, usage, timeout = false, unavailable = false} = {}) {
  const ref = fixture(t); let calls = 0; let sent;
  const config = unavailable ? {} : {agents: {list: [{id: 'learning', model: 'test/learning-model'}]}, models: {providers: {test: {
    apiKey: 'test-only-key', baseUrl: 'https://model.example/v1/', api,
    models: [{id: 'learning-model', name: '学习模型', input: ['text']}]}}}};
  const valid = {headline: '先从<em>循环结构</em>练起', findings: [
    {text: '循环结构有作答证据', evidence: ['M15']}, {text: '继续补齐空白考点', evidence: ['M1']}, {text: '考试日期还未设置', evidence: ['X1']}],
    plan: {text: '明天做4道循环题', items: [{kind: 'set', chapter: 'c5', size: 4}]}, biqiLine: '先生，我们按自己的节奏走。'};
  const organizer = new LearningNotesOrganizer({config}, ref.store, {timeoutMs: 5, fetchImpl: async (url, options) => {
    calls++; sent = JSON.parse(options.body);
    if (timeout) return new Promise(() => {});
    const content = JSON.stringify(payload || valid);
    return new Response(JSON.stringify(api === 'anthropic-messages' ? {content: [{type: 'text', text: content}], usage: usage || {input_tokens: 42, output_tokens: 13}}
      : api === 'openai-responses' ? {output_text: content, usage: usage || {input_tokens: 42, output_tokens: 13, total_tokens: 55}}
      : {choices: [{message: {content}}], usage: usage || {prompt_tokens: 42, completion_tokens: 13, total_tokens: 55}}));
  }});
  ref.desk.requestModel = (rules, digest, options) => requestLearningModel(organizer, rules, digest, {...options, timeoutMs: 5});
  return {...ref, organizer, calls: () => calls, sent: () => sent, valid};
}

test('insight uses the built-in channel, returns real usage, caches once daily and marks changed data stale', async t => {
  const {desk, pact, calls, sent} = modelFixture(t);
  const first = await desk.insight({sessionKey: SESSION});
  assert.equal(first.status, 'ok'); assert.equal(first.model.name, '学习模型');
  assert.deepEqual(first.usage, {input: 42, output: 13, total: 55});
  assert.ok(first.ms >= 0); assert.equal(calls(), 1);
  assert.equal(sent().model, 'learning-model');
  assert.equal((await desk.insight({sessionKey: SESSION})).status, 'cached');
  pact.recordQuestion({correct: true});
  const stale = await desk.insight({sessionKey: SESSION}); assert.equal(stale.insightStale, true); assert.equal(calls(), 1);
  assert.equal(desk.today({sessionKey: SESSION}).insightStale, true);
  await desk.insight({sessionKey: SESSION, force: true}); assert.equal(calls(), 2);
  assert.equal(desk.today({sessionKey: SESSION}).insightStale, false);
});

test('insight strips HTML, drops invented evidence and mismatched digits, and never invents a fallback diagnosis', async t => {
  const base = {headline: '<img src=x onerror=evil()>先生<em onclick=x>记录</em><script>evil()</script>',
    findings: [{text: '不存在的来源', evidence: ['A999']}, {text: '学习了999分钟', evidence: ['L1']}], plan: {}, biqiLine: '先生，99天。'};
  const {desk} = modelFixture(t, {payload: base});
  const result = await desk.insight({sessionKey: SESSION});
  assert.equal(result.status, 'failed'); assert.equal(result.findings.length, 0); assert.ok(result.discarded >= 4);
  assert.doesNotMatch(result.headline, /img|onclick|script|evil/);
  assert.equal(result.plan, null); assert.equal(result.biqiLine, '');
  assert.deepEqual(result.usage, {input: 42, output: 13, total: 55});
});

test('insight handles timeout/unavailable and normalizes Anthropic and Responses usage', async t => {
  const timeout = modelFixture(t, {timeout: true});
  assert.equal((await timeout.desk.insight({sessionKey: SESSION})).status, 'failed');
  assert.equal((await timeout.desk.insight({sessionKey: SESSION})).status, 'failed'); assert.equal(timeout.calls(), 1);
  const unavailable = modelFixture(t, {unavailable: true});
  assert.equal((await unavailable.desk.insight({sessionKey: SESSION})).status, 'unavailable'); assert.equal(unavailable.calls(), 0);
  for (const api of ['anthropic-messages', 'openai-responses']) {
    const ref = modelFixture(t, {api});
    assert.deepEqual((await ref.desk.insight({sessionKey: SESSION})).usage, {input: 42, output: 13, total: 55});
  }
});

test('adopted plans persist to the next morning reminder, use the configured time, and ignore forged ids', async t => {
  const {desk, pact, setClock} = modelFixture(t);
  pact.set({reminders: {morning: '09:10'}});
  const insight = await desk.insight({sessionKey: SESSION});
  assert.deepEqual(desk.adoptPlan({sessionKey: SESSION, planId: insight.plan.id}), {ok: true, reminderAt: '09:10'});
  assert.equal(pact.get().tomorrowPlan.date, '2026-10-20');
  assert.throws(() => desk.adoptPlan({sessionKey: SESSION, planId: 'forged'}), /计划/);
  setClock(AT + 86400000);
  assert.match(pact.nudgeContext('morning').context, /先生已采纳的今日计划：明天做4道循环题/);
  assert.equal(pact.get().tomorrowPlan.items[0].chapter, 'c5');
});

test('subject warnings count real attempts and attributed focus, and Sunday evening has weekly material', t => {
  const {desk, seed, setClock, pact} = fixture(t);
  pact.set({daily: {minutes: 30}}); seed();
  setClock(AT + 6 * 86400000); // Sunday 10/25
  assert.equal(desk.today({sessionKey: SESSION}).subjectWarnings.find(s => s.id === 'c').daysIdle, 6);
  const focus = pact.focusStart({minutes: 5, subject: 'c', chapter: 'c5'});
  setClock(AT + 6 * 86400000 + 5 * 60000); pact.focusStop({id: focus.focus.id});
  assert.ok(!desk.subjectWarnings().some(s => s.id === 'c'));
  assert.match(pact.nudgeContext('evening').context, /偏科提醒/);
  assert.match(pact.nudgeContext('evening').context, /周日晚间周报素材/);
  assert.doesNotMatch(pact.nudgeContext('morning').context, /周日晚间周报素材/);
});

async function withBoard(t, {engine = 'chromium', vendor = true, handler, reduce = false} = {}, run) {
  const {startHarness, playwright} = await import('../tools/study-desk/harness.mjs');
  const harness = await startHarness({vendor, handler});
  const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: reduce ? 'reduce' : 'no-preference'});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(harness.url); await page.locator('#pinkie-study-desk').waitFor();
    await page.getByRole('button', {name: '看板', exact: true}).click();
    await run(page, harness);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await harness.close(); }
}
const deskHandler = desk => (method, params) => method.startsWith('pinkie.learning.desk.') ? desk[method.split('.').at(-1)](params) : {};

test('board renders real metrics, evidence, range switches, themes and plan adoption in Chrome', async t => {
  const ref = modelFixture(t); ref.pact.set({exams: [{id: 'zsb', date: '2027-04-24'}]});
  ref.seed(); ref.pact.recordQuestion({correct: true}); ref.pact.mutateDay('2026-10-19', day => { day.minutes = 12; });
  await withBoard(t, {handler: deskHandler(ref.desk)}, async (page, harness) => {
    await page.locator('.pinkie-desk-board[aria-busy=false]').waitFor();
    assert.equal(await page.locator('.b-metric').count(), 4);
    assert.match(await page.locator('.b-model-chip').innerText(), /学习模型.*55 tokens/);
    await page.locator('.b-evidence').first().hover();
    assert.equal(await page.locator('.b-evidence-tip').first().isVisible(), true);
    assert.ok(await page.locator('.b-evidence-tip').first().innerText());
    assert.equal(await page.locator('.b-chart svg').count(), 1);
    const overflow = await page.locator('.pinkie-desk-board').evaluate(node => ({x: node.scrollWidth > node.clientWidth + 1, y: node.scrollHeight > node.clientHeight + 1}));
    assert.equal(overflow.x, false);
    if (process.env.PINKIE_DESK_QA_OUTPUT) {
      fs.mkdirSync(process.env.PINKIE_DESK_QA_OUTPUT, {recursive: true});
      await page.locator('.b-evidence').first().blur(); await page.mouse.move(10, 10); await page.waitForTimeout(1000);
      const shot = await page.screenshot({path: path.join(process.env.PINKIE_DESK_QA_OUTPUT, 'board-day.png')}); assert.ok(shot.length > 1000);
    }
    await page.getByRole('button', {name: '切换日间和夜间'}).click();
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-theme'), 'night');
    if (process.env.PINKIE_DESK_QA_OUTPUT) { await page.waitForTimeout(650); const shot = await page.screenshot({path: path.join(process.env.PINKIE_DESK_QA_OUTPUT, 'board-night.png')}); assert.ok(shot.length > 1000); }
    await page.getByRole('button', {name: '30 天', exact: true}).click();
    await page.locator('.pinkie-desk-board[aria-busy=false]').waitFor();
    assert.equal(await page.getByRole('button', {name: '30 天', exact: true}).getAttribute('aria-pressed'), 'true');
    assert.ok(harness.calls.some(call => call.method.endsWith('metrics') && call.params.range === '30d'));
    await page.getByRole('button', {name: '重新分析', exact: true}).click();
    await page.locator('.pinkie-desk-board[aria-busy=false]').waitFor();
    await page.getByRole('button', {name: '采纳为明天的计划'}).click();
    await page.getByRole('button', {name: '已采纳', exact: true}).waitFor();
    assert.equal(ref.pact.get().tomorrowPlan.items[0].chapter, 'c5');
    await page.getByRole('button', {name: '对话', exact: true}).click();
    assert.equal(await page.locator('.pinkie-desk-board').count(), 0);
  });
});

test('board has loading/failure/retry states and ignores late replies after unmount in WebKit without motion libraries', async t => {
  const ref = fixture(t);
  const waiting = []; let next;
  const receive = () => waiting.length ? Promise.resolve(waiting.shift()) : new Promise(resolve => { next = resolve; });
  const handler = async (method, params) => {
    if (method.endsWith('insight')) return new Promise(resolve => {
      const release = () => resolve({status: 'failed', error: '这次没分析成功'});
      if (next) { const deliver = next; next = null; deliver(release); } else waiting.push(release);
    });
    return deskHandler(ref.desk)(method, params);
  };
  await withBoard(t, {engine: 'webkit', vendor: false, reduce: true, handler}, async (page, harness) => {
    const finishFirst = await receive();
    await page.locator('.b-skeleton').first().waitFor();
    finishFirst();
    await page.locator('.pinkie-desk-board[aria-busy=false]').waitFor();
    assert.equal(await page.locator('.b-metric').count(), 4);
    assert.equal(await page.locator('.b-headline').innerText(), '这次没分析成功');
    assert.equal(await page.getByRole('button', {name: '采纳为明天的计划'}).isDisabled(), true);
    await page.getByRole('button', {name: '重试', exact: true}).click();
    const finishRetry = await receive();
    await page.locator('.b-skeleton').first().waitFor();
    await page.getByRole('button', {name: '对话', exact: true}).click();
    const response = page.waitForResponse(res => res.url().endsWith('/rpc') && res.request().postDataJSON()?.method.endsWith('insight'));
    finishRetry(); await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.pinkie-desk-board').count(), 0);
    assert.ok(harness.calls.some(call => call.method.endsWith('insight') && call.params.force === true));
  });
});

test('multiple choice requires exactly the full set, independent of ordering', t => {
  const bank = [{id: 'multi-test', k: 'c5', t: 'multi', q: '多选', o: ['一','二','三'], a: ['A','C'], x: '解析'}];
  const {desk, pact} = fixture(t, {bank, mapping: {'multi-test': {k: 'c5', i: 1}}});
  for (const [answer, expected] of [[['C','A'], true], [['A'], false], [['A','B','C'], false]]) {
    const set = desk.set({sessionKey: SESSION});
    assert.equal(set.questions[0].kind, 'multi');
    assert.equal(desk.answer({sessionKey: SESSION, setId: set.setId, questionId: set.questions[0].id, answer, confidence: 95}).correct, expected);
  }
  assert.equal(pact.today().progress.correct, 1); assert.equal(pact.today().progress.questions, 3);
});

test('cross-midnight retest clears old failed evidence using Shanghai calendar days', t => {
  const bank = [{id: 'midnight', k: 'c5', t: 'single', q: 'q', o: ['a','b'], a: 'A', x: 'why'}];
  const {desk, setClock, store} = fixture(t, {bank, mapping: {'midnight': {k: 'c5', i: 1}}});
  setClock(Date.parse('2026-10-19T15:59:00Z'));
  let set = desk.set({sessionKey: SESSION});
  desk.answer({sessionKey: SESSION, setId: set.setId, questionId: set.questions[0].id, answer: 'B', confidence: 95});
  setClock(Date.parse('2026-10-19T16:01:00Z'));
  set = desk.set({sessionKey: SESSION, mode: 'retest'});
  assert.equal(desk.answer({sessionKey: SESSION, setId: set.setId, questionId: set.questions[0].id, answer: 'A', confidence: 95}).item.state, 'lit');
  assert.ok(store.allAttempts().find(a => a.result.correct === false).verifiedBy);
});

test('automatic analysis runs once per day across ranges, with explicit force for a new range', async t => {
  const {desk, calls, setClock} = modelFixture(t);
  await desk.insight({sessionKey: SESSION});
  const month = await desk.insight({sessionKey: SESSION, range: '30d'});
  assert.equal(month.status, 'unavailable'); assert.equal(calls(), 1);
  await desk.insight({sessionKey: SESSION, range: '30d', force: true}); assert.equal(calls(), 2);
  setClock(AT + 86400000);
  await desk.insight({sessionKey: SESSION}); assert.equal(calls(), 3);
});

test('analysis distinguishes attempt counts from correct counts and validates Chinese numbers and percentages', () => {
  const digest = {rows: [{id: 'A1', label: '循环', values: {attempts: 6, correct: 2, independent: 2}}, {id: 'L1', label: '账本', values: {minutes: 20}}]};
  const value = {headline: '看真实记录', findings: [{text: '答对6次', evidence: ['A1']}, {text: '独立正确33%', evidence: ['A1']}, {text: '专注二十分钟', evidence: ['L1']}], plan: null, biqiLine: '先生，继续。'};
  const checked = validateDeskInsight(value, digest);
  assert.equal(checked.findings.length, 2);
  assert.ok(!checked.findings.some(finding => finding.text === '答对6次'));
  value.findings = [{text: '独立答对2次', evidence: ['A1']}];
  assert.equal(validateDeskInsight(value, digest).findings.length, 1);
  value.findings = [{text: '独立正确100%', evidence: ['A1']}];
  assert.equal(validateDeskInsight(value, digest).findings.length, 0);
  value.findings = [{text: {wrong: true}, evidence: ['A1']}];
  assert.equal(validateDeskInsight(value, digest).findings.length, 0);
});

test('missing learning model never silently falls back to a different model; missing usage stays null', async t => {
  const missing = modelFixture(t);
  missing.organizer.api.config.agents.list[0].model = 'test/unavailable';
  assert.equal((await missing.desk.insight({sessionKey: SESSION})).status, 'unavailable'); assert.equal(missing.calls(), 0);
  const noUsage = modelFixture(t, {usage: {prompt_tokens: null, completion_tokens: null, total_tokens: null}});
  assert.deepEqual((await noUsage.desk.insight({sessionKey: SESSION})).usage, {input: null, output: null, total: null});
});


test('today can choose an uncovered syllabus item to learn without pretending it is lit', t => {
  const bank = [{id: 'first-point', k: 'ee1', t: 'single', q: 'q', o: ['a','b'], a: 'A'}, {id: 'next-chapter', k: 'c5', t: 'single', q: 'q', o: ['a','b'], a: 'A'}];
  const {desk, seed} = fixture(t, {bank, mapping: {'first-point': {k: 'ee1', i: 0}, 'next-chapter': {k: 'c5', i: 1}}});
  seed({question: {id: 'first-point'}});
  const today = desk.today({sessionKey: SESSION});
  assert.equal(today.focus.kind, 'learn');
  assert.equal(today.focus.payload.k, 'c1');
  assert.equal(today.focus.payload.i, 0);
  assert.equal(desk.items().find(item => item.k === 'c1' && item.i === 0).state, 'none');
  assert.equal(desk.items().find(item => item.k === 'ee1' && item.i === 1).state, 'none');
});

test('pace history replays item states once and matches recomputing mastery for every day', t => {
  const {desk, seed, setClock} = fixture(t);
  let n = 7; const rnd = () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ids = ['c5-74', 'c5-75', 'c5-76', 'c6-78', 'ee2-7', 'm2-9'];
  for (let i = 0; i < 160; i++) {
    const id = 'zsb-' + ids[Math.floor(rnd() * ids.length)];
    setClock(AT + Math.floor(rnd() * 12 * 86400000));
    seed({id: `h-${i}`, itemId: id, question: {id, ...(rnd() < .3 ? {deskMode: 'retest'} : {})},
      submission: {confidence: [null, 40, 70, 95][Math.floor(rnd() * 4)], hintUsed: rnd() < .2}, result: {correct: rnd() < .7}});
  }
  setClock(AT + 13 * 86400000);
  const all = desk.attempts(), day = at => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
  const dates = [...new Set(all.map(a => day(a.createdAt)))].sort();
  assert.deepEqual(desk.litHistory(all, dates), dates.map(date => desk.mastery(all.filter(a => day(a.createdAt) <= date)).lit));
});

test('a retest set without a chapter only uses due items and says when nothing is due', t => {
  const {desk, seed, setClock} = fixture(t);
  assert.throws(() => desk.set({sessionKey: SESSION, mode: 'retest'}), /今天没有到期的复测/);
  seed({result: {correct: false}});
  setClock(AT + 86400000);
  const set = desk.set({sessionKey: SESSION, mode: 'retest'});
  assert.ok(set.questions.length >= 1);
  assert.ok(set.questions.every(q => q.k === 'c5' && q.i === 1));
});

test('v2 today priority is continuing lesson, due retest, fresh lesson practice, weak point learning/practice, then new learning',t=>{
 const bank=[{id:'fresh',k:'c5',t:'single',q:'q',o:['a','b'],a:'A'},{id:'weak',k:'ee1',t:'single',q:'q',o:['a','b'],a:'A'}];
 const {store,pact,desk,seed,setClock}=fixture(t,{bank,mapping:{fresh:{k:'c5',i:1},weak:{k:'ee1',i:0}}});let current=null;const lessons=[];store.lessons={all:()=>lessons,current:()=>current};
 assert.equal(desk.today({sessionKey:SESSION}).focus.kind,'learn');assert.equal(desk.today({sessionKey:SESSION}).focus.payload.k,'ee1');
 seed({question:{id:'weak'},result:{correct:false}});assert.equal(desk.today({sessionKey:SESSION}).focus.kind,'learn','weak point without a prior lesson is learned first');
 lessons.push({lessonId:'weak-lesson',status:'done',point:{subject:'ee',chapter:'ee1',i:0},finishedAt:AT});assert.equal(desk.today({sessionKey:SESSION}).focus.kind,'set','a previously taught weak point is practiced');
 lessons.push({lessonId:'fresh-lesson',status:'done',point:{subject:'c',chapter:'c5',i:1},finishedAt:AT});assert.equal(desk.today({sessionKey:SESSION}).focus.payload.k,'c5','fresh unpracticed lesson beats weak point');
 setClock(AT+86400000);assert.equal(desk.today({sessionKey:SESSION}).focus.payload.mode,'retest','due retest beats fresh lesson');
 current={lessonId:'current',status:'paused',point:{chapter:'c5',i:1,text:'循环'},outline:{segments:[{n:1},{n:2},{n:3}]},segment:2};const continued=desk.today({sessionKey:SESSION});assert.equal(continued.focus.kind,'lesson');assert.equal(continued.focus.payload.lessonId,'current');assert.match(continued.focus.subtitle,/第 2 段，共 3 段/);
 assert.equal(continued.goals.lessons,2);pact.set({daily:{lessons:3}});assert.equal(desk.today({sessionKey:SESSION}).goals.lessons,3);
});
test('v2 subject rotation uses the oldest learning activity; adopted learn plans take priority over rotation',t=>{
 const {store,pact,desk}=fixture(t);const lessons=[];store.lessons={all:()=>lessons,current:()=>null};assert.equal(desk.today({sessionKey:SESSION}).focus.payload.k,'ee1');
 lessons.push({status:'done',point:{subject:'ee',chapter:'ee1',i:0},finishedAt:AT-3*86400000});assert.equal(desk.today({sessionKey:SESSION}).focus.payload.k,'c1');
 lessons.push({status:'done',point:{subject:'c',chapter:'c1',i:0},finishedAt:AT-3*86400000});assert.equal(desk.today({sessionKey:SESSION}).focus.payload.k,'net1');
 pact.adoptTomorrowPlan({id:'learn-plan',date:'2026-10-19',text:'先学高数',items:[{kind:'learn',k:'m2',i:0}]});assert.equal(desk.today({sessionKey:SESSION}).focus.payload.k,'m2');
});
test('v2 check evidence never lights, weakens, or retests a point; completed lessons add learned evidence',t=>{
 const {store,desk,seed}=fixture(t);store.lessons={all:()=>[{status:'done',point:{subject:'c',chapter:'c5',i:1},finishedAt:AT}],current:()=>null};
 seed({question:{topic:'c5:1',deskMode:'lesson',lessonId:'lesson',segment:1},result:{correct:false}});let point=item(desk);assert.equal(point.state,'learned');assert.equal(point.evidence.lessons,1);assert.equal(point.evidence.practiced,0);assert.equal(point.evidence.nextRetestAt,0);
 seed();point=item(desk);assert.equal(point.state,'lit');seed({question:{topic:'c5:1',deskMode:'lesson'},result:{correct:false}});assert.equal(item(desk).state,'lit');
 seed({result:{correct:false}});seed({question:{topic:'c5:1',deskMode:'lesson'},result:{correct:true}});assert.equal(item(desk).state,'weak');
});
test('recently learned points without bank coverage practice in chat through the A-confirmed payload',t=>{
 const {store,desk}=fixture(t,{bank:[],mapping:{}});store.lessons={all:()=>[{status:'done',point:{subject:'ee',chapter:'ee1',i:0},finishedAt:AT}],current:()=>null};const focus=desk.today({sessionKey:SESSION}).focus;assert.equal(focus.kind,'set');assert.equal(focus.payload.practiceInChat,true);assert.equal(focus.payload.k,'ee1');assert.equal(focus.payload.i,0);
});
