import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LearningPact, PACT_NO_REPLY, composeNudgeContext, dayInZone, learningPactPrompt, nudgeContextFor, nudgeKindFromPrompt,
  registerLearningPactGateway,
} from '../services/mode-architecture/learning-pact.mjs';
import {LearningInteractionStore, calculateReviewSchedule} from '../services/mode-architecture/learning.mjs';

const SHANGHAI = 'Asia/Shanghai';
// 2026-10-19 09:00 上海时间。
const MORNING = Date.parse('2026-10-19T01:00:00Z');
const SESSION = 'agent:learning:pact-test';

function fixture(t, {at = MORNING, pact = true} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-pact-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = at;
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace-learning')});
  const instance = new LearningPact(store, {now: () => clock});
  if (pact) store.pact = instance;
  const setClock = value => { clock = value; };
  const days = date => JSON.parse(fs.readFileSync(path.join(store.root, 'pact', 'days', `${date}.json`), 'utf8'));
  return {root, store, pact: instance, setClock, days};
}
function seedDay(fixtureRef, date, {minutes = 30, answered = 20, completed = true, partialOnly = false} = {}) {
  const day = {
    date, minutes, focus: [], questions: {answered, correct: Math.floor(answered / 2)},
    reviews: {done: 0}, notes: {added: 0},
    firstActivityAt: Date.parse(`${date}T02:00:00Z`),
    completedAt: null,
  };
  if (completed && !partialOnly) day.completedAt = Date.parse(`${date}T03:00:00Z`);
  const file = path.join(fixtureRef.store.root, 'pact', 'days', `${date}.json`);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(day));
}

function seedNotes(fixtureRef, notes = []) {
  const file = path.join(fixtureRef.store.root, 'notes.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({v: 1, notes}));
}

function seedNote(id, {title = id, tags = [], lapses = 0, reviewCount = 0, nextReviewAt = 0} = {}) {
  return {id, title, content: `${title} = 释义`, term: title, tags, status: 'active',
    sourceSessionKey: SESSION, nextReviewAt, lapses, reviewCount, reviewLevel: 0};
}

test('pact defaults are created on demand with an empty exam date and no channel', t => {
  const {pact} = fixture(t);
  const value = pact.get();
  assert.equal(value.version, 1);
  assert.deepEqual(value.exam, {name: 'PRETCO-B', date: null});
  assert.deepEqual(value.daily, {minutes: 30, questions: 20, lessons: 2, reviews: 'due'});
  assert.equal(value.intensity, 'firm');
  assert.equal(value.timezone, SHANGHAI);
  assert.deepEqual(value.reminders, {morning: '08:30', evening: '21:00', lastCall: '22:30'});
  assert.deepEqual(value.channel, {kind: 'none', to: null});
  // 纯读取不落盘；写一次才生成 pact.json。
  assert.equal(fs.existsSync(path.join(fixture(t).pact.root, 'pact.json')), false);
  pact.set({intensity: 'gentle'});
  assert.equal(JSON.parse(fs.readFileSync(pact.pactFile, 'utf8')).intensity, 'gentle');
});

test('pact.set merges patches and rejects invalid values', t => {
  const {pact} = fixture(t);
  const {pact: updated} = pact.set({exam: {date: '2026-12-20'}, daily: {minutes: 45}, intensity: 'relentless', channel: {kind: 'feishu', to: 'ou_abc'}});
  assert.equal(updated.exam.date, '2026-12-20');
  assert.equal(updated.exam.name, 'PRETCO-B');
  assert.equal(updated.daily.minutes, 45);
  assert.equal(updated.daily.questions, 20);
  assert.equal(updated.intensity, 'relentless');
  assert.deepEqual(updated.channel, {kind: 'feishu', to: 'ou_abc'});
  assert.equal(updated.createdAt > 0, true);
  assert.throws(() => pact.set({reminders: {morning: '25:00'}}), /HH:MM/);
  assert.throws(() => pact.set({reminders: {evening: '8:00'}}), /HH:MM/);
  assert.throws(() => pact.set({intensity: 'brutal'}), /强度/);
  assert.throws(() => pact.set({daily: {minutes: 4}}), /5–600/);
  assert.throws(() => pact.set({daily: {minutes: 601}}), /5–600/);
  assert.throws(() => pact.set({daily: {questions: -1}}), /0–500/);
  assert.throws(() => pact.set({daily: {questions: 501}}), /0–500/);
  assert.throws(() => pact.set({exam: {date: '2026-02-30'}}), /YYYY-MM-DD/);
  assert.throws(() => pact.set({exam: {date: '20-12-2026'}}), /YYYY-MM-DD/);
  assert.throws(() => pact.set({timezone: 'Mars/Olympus'}), /IANA/);
  assert.throws(() => pact.set({channel: {kind: 'sms'}}), /推送渠道/);
  // 校验失败不得写坏已有约定。
  assert.equal(pact.get().intensity, 'relentless');
  assert.equal(pact.get().daily.minutes, 45);
  const cleared = pact.set({exam: {date: null}}).pact;
  assert.equal(cleared.exam.date, null);
});

test('ledger counts answered questions, reviews and new notes on the pact day', t => {
  const {store, pact, days} = fixture(t);
  seedNotes({store});
  store.setEnabled(SESSION, true);
  const shown = store.present(SESSION, {kind: 'single_choice', question: 'choose', options: ['a', 'b'], correct_answer: 'b'});
  store.submit(SESSION, {activityId: shown.current.id, answer: '2', submissionId: 's1'});
  // 同一 submissionId 重放不再计数。
  store.submit(SESSION, {activityId: shown.current.id, answer: '2', submissionId: 's1'});
  // 两个页面重发同一道题时，即使请求 ID 不同也只能算一道题。
  store.submit(SESSION, {activityId: shown.current.id, answer: '2', submissionId: 'second-page'});
  const second = store.present(SESSION, {kind: 'fill_blank', question: 'fill', correct_answer: 'x'});
  store.submit(SESSION, {activityId: second.current.id, answer: 'y', submissionId: 's2'});
  const note = store.saveNote(SESSION, {title: 'put off', content: 'put off = 推迟'}).note;
  store.saveNote(SESSION, {id: note.id, title: 'put off', content: 'put off = 延后'});
  store.reviewNote(SESSION, note.id, 'remembered');
  const day = days('2026-10-19');
  assert.equal(day.questions.answered, 2);
  assert.equal(day.questions.correct, 1);
  assert.equal(day.notes.added, 1);
  assert.equal(day.reviews.done, 1);
  assert.ok(day.firstActivityAt);
  const today = pact.today();
  assert.equal(today.date, '2026-10-19');
  assert.deepEqual(today.progress, {minutes: 0, questions: 2, correct: 1, reviewsDone: 1, dueReviews: 0, notesAdded: 1});
  assert.deepEqual(today.goals, {minutes: 30, questions: 20});
  assert.equal(today.complete, false);
});

test('a later model grade updates the original day without double counting', t => {
  const {store, pact, setClock, days} = fixture(t);
  store.setEnabled(SESSION, true);
  const shown = store.present(SESSION, {kind: 'short_answer', question: 'Explain'});
  const submitted = store.submit(SESSION, {activityId: shown.current.id, answer: 'An explanation'});
  assert.equal('pactQuestion' in submitted.current, false);
  assert.equal(pact.today().progress.questions, 1);
  setClock(MORNING + 24 * 60 * 60_000);
  store.resolve(SESSION, {activityId: shown.current.id, correct: true});
  store.resolve(SESSION, {activityId: shown.current.id, correct: true});
  assert.deepEqual(days('2026-10-19').questions, {answered: 1, correct: 1});
  assert.equal(pact.today().progress.questions, 0);
  store.resolve(SESSION, {activityId: shown.current.id, correct: false});
  assert.deepEqual(days('2026-10-19').questions, {answered: 1, correct: 1}, 'a delayed model replay cannot rewrite the settled score');
  store.correctAttempt(SESSION, submitted.current.submission.attemptId, {correct: false, reason: '用户核对后更正'});
  assert.deepEqual(days('2026-10-19').questions, {answered: 1, correct: 0});
});

test('a day is complete only when minutes, questions and due reviews are all satisfied', t => {
  const {pact, setClock, days} = fixture(t);
  pact.set({daily: {minutes: 10, questions: 2}});
  const first = pact.focusStart({minutes: 10});
  setClock(MORNING + 10 * 60_000);
  const stopped = pact.focusStop({id: first.focus.id});
  assert.equal(stopped.minutes, 10);
  assert.equal(stopped.today.complete, false);
  pact.recordQuestion({correct: true});
  pact.recordQuestion({correct: false});
  const done = pact.today();
  assert.equal(done.complete, true);
  assert.ok(days('2026-10-19').completedAt, 'completedAt is stored the first time the day completes');
  const stamp = days('2026-10-19').completedAt;
  pact.recordQuestion({correct: true});
  assert.equal(days('2026-10-19').completedAt, stamp, 'completedAt is never rewritten');
});

test('history reports complete, partial, missed and future days', t => {
  const ref = fixture(t);
  seedDay(ref, '2026-10-16');
  seedDay(ref, '2026-10-17', {minutes: 5, answered: 1, completed: false, partialOnly: true});
  const window = ref.pact.history({days: 6});
  assert.deepEqual(window.map(item => item.date), ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
  assert.deepEqual(window.map(item => item.state), ['missed', 'missed', 'complete', 'partial', 'missed', 'missed']);
  const duplicate = ref.pact.history({days: 1});
  assert.deepEqual(duplicate.map(item => item.date), ['2026-10-19']);
});

test('future days appear when the pact timezone is behind the event date', t => {
  // 上海已经是 10-19 07:00，洛杉矶仍是 10-18：洛杉矶自己的历史里只有到 10-18 为止的天数。
  const ref = fixture(t, {at: Date.parse('2026-10-18T23:00:00Z')});
  ref.pact.set({timezone: 'America/Los_Angeles'});
  seedNotes(ref);
  seedDay(ref, '2026-10-17');
  seedDay(ref, '2026-10-18');
  assert.equal(dayInZone(Date.parse('2026-10-18T23:00:00Z'), 'America/Los_Angeles'), '2026-10-18');
  const history = ref.pact.history({days: 2});
  assert.deepEqual(history.map(item => item.state), ['complete', 'complete']);
  assert.equal(ref.pact.today().date, '2026-10-18');
  assert.equal(ref.pact.streak().current, 2);
});

test('streak stops at a missed day and keeps the best run', t => {
  const ref = fixture(t);
  // 10-15、10-16 完成；10-17 缺席；10-18 完成；今天 10-19 还没做。
  seedDay(ref, '2026-10-15');
  seedDay(ref, '2026-10-16');
  seedDay(ref, '2026-10-18');
  assert.deepEqual(ref.pact.streak(), {current: 1, best: 2});
  seedDay(ref, '2026-10-19');
  assert.deepEqual(ref.pact.streak(), {current: 2, best: 2});
  assert.deepEqual(ref.pact.today().streak, {current: 2, best: 2});
});

test('day boundaries follow the pact timezone, not UTC', t => {
  const {pact, setClock, days} = fixture(t, {at: Date.parse('2026-10-18T15:00:00Z')});
  assert.equal(dayInZone(Date.parse('2026-10-18T16:30:00Z'), 'Asia/Shanghai'), '2026-10-19');
  assert.equal(dayInZone(Date.parse('2026-10-18T16:30:00Z'), 'UTC'), '2026-10-18');
  assert.equal(pact.today().date, '2026-10-18');
  // UTC 15:30 仍是上海 10-18 晚 23:30。
  setClock(Date.parse('2026-10-18T15:30:00Z'));
  pact.recordQuestion({correct: true});
  assert.equal(days('2026-10-18').questions.answered, 1);
  assert.equal(fs.existsSync(path.join(pact.daysRoot, '2026-10-19.json')), false);
  // UTC 16:30 已经是上海 10-19 00:30。
  setClock(Date.parse('2026-10-18T16:30:00Z'));
  pact.recordQuestion({correct: true});
  assert.equal(days('2026-10-19').questions.answered, 1);
  assert.equal(days('2026-10-18').questions.answered, 1);
  assert.equal(pact.today().date, '2026-10-19');
});

test('focus sessions are single-flight, credited in whole minutes and capped', t => {
  const {pact, setClock, days} = fixture(t);
  const first = pact.focusStart({minutes: 25});
  assert.match(first.focus.id, /^focus-/);
  assert.equal(first.focus.plannedMinutes, 25);
  const again = pact.focusStart({minutes: 50});
  assert.equal(again.focus.id, first.focus.id, 'starting again returns the active session');
  assert.equal(pact.focusStatus().active.plannedMinutes, 25);
  setClock(MORNING + 12 * 60_000 + 40_000);
  assert.equal(pact.focusStatus().active.elapsedMinutes, 12);
  const stopped = pact.focusStop({id: first.focus.id});
  assert.equal(stopped.minutes, 12);
  assert.equal(stopped.today.progress.minutes, 12);
  assert.equal(pact.focusStatus().active, null);
  assert.deepEqual(days('2026-10-19').focus.map(item => item.minutes), [12]);
  // 忘了点停止：只记到 计划 + 10 分钟。
  const overrun = pact.focusStart({minutes: 5});
  setClock(MORNING + 20 * 60_000 + (5 + 10) * 60_000 + 30_000);
  const capped = pact.focusStop({id: overrun.focus.id});
  assert.equal(capped.minutes, 15);
  assert.equal(capped.today.progress.minutes, 27);
  // 没有进行中的会话时停止是空操作。
  assert.equal(pact.focusStop({}).minutes, 0);
});

test('stopping before a full minute does not create study credit or an active day', t => {
  const {pact, setClock} = fixture(t);
  const started = pact.focusStart({minutes: 25});
  setClock(MORNING + 59_999);
  const stopped = pact.focusStop({id: started.focus.id});
  assert.equal(stopped.minutes, 0);
  assert.equal(stopped.today.progress.minutes, 0);
  assert.deepEqual(pact.focusStatus(), {active: null});
  assert.equal(pact.history({days: 1})[0].state, 'missed');
});

test('unreviewed days cannot extend a streak when time and question goals are met', t => {
  const ref = fixture(t);
  seedNotes(ref, [seedNote('overdue')]);
  seedDay(ref, '2026-10-18', {completed: false});
  seedDay(ref, '2026-10-19', {completed: false});
  assert.equal(ref.pact.today().complete, false);
  assert.deepEqual(ref.pact.history({days: 2}).map(day => day.state), ['partial', 'partial']);
  assert.deepEqual(ref.pact.streak(), {current: 0, best: 0});
});

test('corrupt pact and day files are backed up and replaced, never silently overwritten', t => {
  const {pact, days} = fixture(t);
  fs.mkdirSync(path.dirname(pact.pactFile), {recursive: true});
  fs.mkdirSync(pact.daysRoot, {recursive: true});
  fs.writeFileSync(pact.pactFile, '{not json');
  fs.writeFileSync(path.join(pact.daysRoot, '2026-10-19.json'), 'null');
  const value = pact.get();
  assert.equal(value.intensity, 'firm');
  const backups = fs.readdirSync(pact.root).filter(name => /^pact\.json\.corrupt-\d+$/.test(name));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(pact.root, backups[0]), 'utf8'), '{not json');
  assert.equal(JSON.parse(fs.readFileSync(pact.pactFile, 'utf8')).version, 1);
  pact.recordQuestion({correct: true});
  assert.equal(days('2026-10-19').questions.answered, 1);
  assert.equal(fs.readdirSync(pact.daysRoot).filter(name => /^2026-10-19\.json\.corrupt-\d+$/.test(name)).length, 1);
});

test('focus state corruption recovers instead of wedging the timer', t => {
  const {pact} = fixture(t);
  fs.mkdirSync(pact.root, {recursive: true});
  fs.writeFileSync(path.join(pact.root, 'focus.json'), '[broken');
  assert.deepEqual(pact.focusStatus(), {active: null});
  assert.equal(fs.readdirSync(pact.root).some(name => /^focus\.json\.corrupt-\d+$/.test(name)), true);
  const started = pact.focusStart({minutes: 10});
  assert.ok(started.focus.id);
});

test('today exposes exam countdown, due reviews and weak topics', t => {
  const ref = fixture(t);
  ref.pact.set({exam: {date: '2026-12-20'}});
  seedNotes(ref, [
    seedNote('n1', {title: 'take off', tags: ['短语']}),
    seedNote('n2', {title: 'put off', tags: ['短语']}),
    seedNote('n3', {title: 'in time', tags: ['介词'], nextReviewAt: MORNING + 7 * 24 * 60 * 60 * 1000}),
    seedNote('n4', {title: 'at once', tags: ['短语']}),
  ]);
  let today = ref.pact.today();
  assert.equal(today.progress.dueReviews, 3);
  assert.equal(today.examCountdownDays, 62);
  assert.deepEqual(today.weakTopics, [], 'no lapses yet means no weak topics');
  // 复习失败会让 lapses 上涨；雷达按标签汇总错题。
  ref.store.reviewNote(SESSION, 'n1', 'forgot');
  ref.store.reviewNote(SESSION, 'n1', 'forgot');
  ref.store.reviewNote(SESSION, 'n2', 'forgot');
  ref.store.reviewNote(SESSION, 'n4', 'remembered');
  today = ref.pact.today();
  assert.deepEqual(today.weakTopics, [{tag: '短语', wrong: 3, total: 3}]);
  // 忘记再记起的卡按 1 天间隔排到下一天，今天的到期数随之归零。
  const due = ref.pact.today();
  assert.equal(due.progress.dueReviews, 0);
  assert.equal(due.examCountdownDays, 62);
  assert.deepEqual(due.weakTopics, [{tag: '短语', wrong: 3, total: 3}]);
  const unset = fixture(t).pact.today();
  assert.equal(unset.examCountdownDays, null);
  assert.deepEqual(unset.weakTopics, []);
});

test('composeNudgeContext carries the real numbers for all kinds and intensities', () => {
  const today = {
    date: '2026-10-19',
    pact: {intensity: 'firm', exam: {name: 'PRETCO-B', date: '2026-12-20'}, daily: {minutes: 30, questions: 20, reviews: 'due'}},
    progress: {minutes: 12, questions: 7, correct: 5, reviewsDone: 3, dueReviews: 12, notesAdded: 2},
    goals: {minutes: 30, questions: 20},
    complete: false,
    streak: {current: 6, best: 11},
    examCountdownDays: 62,
    weakTopics: [{tag: '短语', wrong: 4, total: 9}, {tag: '时态', wrong: 2, total: 6}],
  };
  for (const kind of ['morning', 'evening', 'lastcall']) {
    for (const intensity of ['gentle', 'firm', 'relentless']) {
      const context = composeNudgeContext(kind, {...today, pact: {...today.pact, intensity}});
      for (const needle of ['12/30', '7/20', '12', '6', '11', '62', '现', '短语', intensity, '80']) {
        assert.ok(context.includes(needle), `${kind}/${intensity} misses ${needle}`);
      }
      assert.match(context, /先生/);
      assert.doesNotMatch(context, new RegExp(PACT_NO_REPLY));
    }
  }
  assert.match(composeNudgeContext('morning', today), /今天的下一步/);
  assert.match(composeNudgeContext('evening', today), /还差/);
  assert.match(composeNudgeContext('evening', {...today, complete: true}), /一句话认可/);
  const notStarted = {...today, complete: false, progress: {minutes: 0, questions: 0, reviewsDone: 0, dueReviews: 12, notesAdded: 0}};
  assert.match(composeNudgeContext('evening', notStarted), /最小的第一步：先把 12 张复习卡翻完/);
  const late = composeNudgeContext('lastcall', today);
  assert.match(late, /连续/);
  assert.match(late, /18 分钟/, 'lastcall names the remaining minutes');
  // 完不成状态的 lastcall 不说 NO_REPLY。
  assert.doesNotMatch(late, new RegExp(PACT_NO_REPLY));
});

test('lastcall on a completed day is exactly NO_REPLY and the nudge hook agrees', t => {
  const complete = {
    date: '2026-10-19', pact: {intensity: 'relentless', exam: {name: 'PRETCO-B', date: null}, daily: {minutes: 30, questions: 20, reviews: 'due'}},
    progress: {minutes: 31, questions: 21, reviewsDone: 4, dueReviews: 0, notesAdded: 1}, goals: {minutes: 30, questions: 20},
    complete: true, streak: {current: 3, best: 3}, examCountdownDays: null, weakTopics: [],
  };
  for (const intensity of ['gentle', 'firm', 'relentless']) {
    assert.equal(composeNudgeContext('lastcall', {...complete, pact: {...complete.pact, intensity}}), PACT_NO_REPLY);
  }
  assert.notEqual(composeNudgeContext('evening', complete), PACT_NO_REPLY);
  assert.notEqual(composeNudgeContext('morning', complete), PACT_NO_REPLY);

  const ref = fixture(t);
  ref.pact.set({daily: {minutes: 5, questions: 0}, timezone: SHANGHAI});
  ref.pact.focusStart({minutes: 5});
  ref.setClock(MORNING + 5 * 60_000);
  ref.pact.focusStop({});
  const nudge = nudgeContextFor(ref.pact, MORNING + 5 * 60_000);
  assert.equal(nudge.state, 'complete');
  assert.equal(composeNudgeContext('lastcall', nudge.today), PACT_NO_REPLY);
  assert.equal(nudgeContextFor(null), null);
  assert.match(learningPactPrompt(ref.pact), /10-19/);
});

test('nudge markers are recognised only in the learning agent prompt', () => {
  assert.equal(nudgeKindFromPrompt('[[CLEKK_PACT_NUDGE:morning]]'), 'morning');
  assert.equal(nudgeKindFromPrompt('  [[CLEKK_PACT_NUDGE:lastcall]]  '), 'lastcall');
  assert.equal(nudgeKindFromPrompt('普通消息'), null);
  assert.equal(nudgeKindFromPrompt('[[CLEKK_PACT_NUDGE:afternoon]]'), null);
});

test('gateway methods register with read and write scopes and round-trip through the ledger', async t => {
  const {store, pact} = fixture(t);
  const methods = new Map();
  registerLearningPactGateway({registerGatewayMethod(name, handler, opts) { methods.set(name, {handler, opts}); }}, pact);
  assert.equal(methods.get('pinkie.learning.pact.get').opts.scope, 'operator.read');
  assert.equal(methods.get('pinkie.learning.today').opts.scope, 'operator.read');
  assert.equal(methods.get('pinkie.learning.history').opts.scope, 'operator.read');
  assert.equal(methods.get('pinkie.learning.focus.status').opts.scope, 'operator.read');
  assert.equal(methods.get('pinkie.learning.pact.set').opts.scope, 'operator.admin');
  assert.equal(methods.get('pinkie.learning.focus.start').opts.scope, 'operator.admin');
  assert.equal(methods.get('pinkie.learning.focus.stop').opts.scope, 'operator.admin');
  const call = (name, params) => new Promise(resolve => methods.get(name).handler({params, respond: (ok, value, error) => resolve({ok, value, error})}));
  const defaulted = await call('pinkie.learning.pact.get', {});
  assert.equal(defaulted.ok, true);
  assert.equal(defaulted.value.pact.daily.minutes, 30);
  const rejected = await call('pinkie.learning.pact.set', {patch: {daily: {minutes: 2}}});
  assert.equal(rejected.ok, false);
  assert.match(rejected.error.message, /5–600/);
  const accepted = await call('pinkie.learning.pact.set', {patch: {daily: {minutes: 15}}});
  assert.equal(accepted.value.pact.daily.minutes, 15);
  const history = await call('pinkie.learning.history', {days: 3});
  assert.equal(history.value.days.length, 3);
  const started = await call('pinkie.learning.focus.start', {minutes: 15});
  assert.equal(started.value.focus.plannedMinutes, 15);
  const status = await call('pinkie.learning.focus.status', {});
  assert.equal(status.value.active.id, started.value.focus.id);
  const stopped = await call('pinkie.learning.focus.stop', {id: 'someone-else'});
  assert.equal(stopped.ok, false);
});

test('pact hooks never break the legacy learning store', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-pact-legacy-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace-learning')});
  const note = store.saveNote(SESSION, {title: 'x', content: 'x = 一'}).note;
  store.reviewNote(SESSION, note.id, 'fuzzy');
  assert.equal(store.pact, null);
  // 即使账本自身出错，作答也必须照常成功。
  store.pact = {recordQuestion() { throw new Error('ledger down'); }, recordNote() { throw new Error('ledger down'); }, recordReview() { throw new Error('ledger down'); }};
  store.setEnabled(SESSION, true);
  const shown = store.present(SESSION, {kind: 'fill_blank', question: 'q', correct_answer: 'a'});
  const submitted = store.submit(SESSION, {activityId: shown.current.id, answer: 'a', submissionId: 'boom'});
  assert.equal(submitted.current.submission.correctness, true);
  assert.equal(store.reviewNote(SESSION, note.id, 'remembered').ok, true);
});
