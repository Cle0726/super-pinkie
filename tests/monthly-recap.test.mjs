// 月度回顾（任务书 任务-官方新功能五项-1125.md 第 2 项）：服务端只读计数。
// 前提：学习账本按 pact 时区切天；正例：上个月的分钟 / 作答 / 错题 / 复习 / 词汇 / 连续天数；
// 反例：跨月边界、时区边界、别的月份的数不算进来；空数据全 0；读完不写任何文件；网关方法 operator.read。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningPact, registerLearningPactGateway} from '../services/mode-architecture/learning-pact.mjs';
import {LearningInteractionStore} from '../services/mode-architecture/learning.mjs';
import {dayIn, daysOfMonth, monthlyRecap, previousMonth} from '../services/mode-architecture/monthly-recap.mjs';

// 2026-12-02 10:00 上海时间：上个月是 2026-11。
const DEC2 = Date.parse('2026-12-02T02:00:00Z');

function fixture(t, at = DEC2) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-recap-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace-learning')});
  const pact = new LearningPact(store, {now: () => at});
  store.pact = pact;
  const seed = (date, day) => {
    const file = path.join(store.root, 'pact', 'days', `${date}.json`);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({date, focus: [], notes: {added: 0}, reviews: {done: 0}, ...day}));
  };
  const snapshot = () => {
    const out = {};
    const walk = (dir) => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else out[p] = fs.readFileSync(p, 'utf8'); } };
    walk(root);
    return out;
  };
  return {store, pact, seed, snapshot};
}

test('前提：日期工具按时区切天、上个月跨年、每月天数对', () => {
  assert.equal(dayIn(Date.parse('2026-11-30T16:30:00Z'), 'Asia/Shanghai'), '2026-12-01', '上海 UTC 16:30 已是第二天');
  assert.equal(dayIn(Date.parse('2026-11-30T16:30:00Z'), 'UTC'), '2026-11-30');
  assert.equal(previousMonth('2026-12-02'), '2026-11');
  assert.equal(previousMonth('2027-01-03'), '2026-12');
  assert.equal(daysOfMonth('2026-11').length, 30);
  assert.equal(daysOfMonth('2028-02').length, 29);
});

test('正例：上个月的学习数加总，错题 = 作答 − 答对；别的月份不算；读完不写文件', (t) => {
  const f = fixture(t);
  f.seed('2026-11-03', {minutes: 40, questions: {answered: 20, correct: 15}, reviews: {done: 6}, lessons: 1});
  f.seed('2026-11-30', {minutes: 25, questions: {answered: 10, correct: 10}, notes: {added: 2}});
  f.seed('2026-10-31', {minutes: 99, questions: {answered: 99, correct: 0}});
  f.seed('2026-12-01', {minutes: 77, questions: {answered: 50, correct: 1}});
  f.seed('2026-11-15', {minutes: 0, questions: {answered: 0, correct: 0}});
  f.store.vocab = {read: () => ({words: [
    {word: 'a', createdAt: Date.parse('2026-11-10T04:00:00Z'), lastReviewedAt: Date.parse('2026-11-20T04:00:00Z')},
    {word: 'b', createdAt: Date.parse('2026-11-30T16:30:00Z'), lastReviewedAt: 0}, // 上海已是 12-01
    {word: 'c', createdAt: Date.parse('2026-10-31T15:59:00Z'), lastReviewedAt: Date.parse('2026-11-01T00:00:00Z')}, // 上海 10-31 23:59 / 11-01 08:00
  ]})};
  const before = f.snapshot();
  const r = monthlyRecap(f.pact);
  assert.equal(r.month, '2026-11');
  assert.equal(r.timeZone, 'Asia/Shanghai');
  assert.deepEqual(r.study, {activeDays: 2, minutes: 65, answered: 30, correct: 25, wrong: 5, reviews: 6, notes: 2, lessons: 1});
  assert.deepEqual(r.vocab, {added: 1, reviewed: 2});
  assert.ok(Number.isInteger(r.streak.current) && Number.isInteger(r.streak.best));
  assert.deepEqual(f.snapshot(), before, '只读：一个文件都不多、不改');
});

test('正例：指定这个月只数到今天；反例：格式不对、将来的月份报错', (t) => {
  const f = fixture(t);
  f.seed('2026-12-01', {minutes: 30, questions: {answered: 4, correct: 1}});
  f.seed('2026-12-03', {minutes: 50, questions: {answered: 9, correct: 9}}); // 还没到
  const r = monthlyRecap(f.pact, {month: '2026-12'});
  assert.equal(r.study.minutes, 30);
  assert.equal(r.study.wrong, 3);
  assert.throws(() => monthlyRecap(f.pact, {month: '2026-13'}), /YYYY-MM/);
  assert.throws(() => monthlyRecap(f.pact, {month: '12/2026'}), /YYYY-MM/);
  assert.throws(() => monthlyRecap(f.pact, {month: '2027-01'}), /还没到/);
});

test('反例：空数据全 0，不编数；答对比作答多时按作答封顶，错题不为负', (t) => {
  const f = fixture(t);
  const empty = monthlyRecap(f.pact);
  assert.deepEqual(empty.study, {activeDays: 0, minutes: 0, answered: 0, correct: 0, wrong: 0, reviews: 0, notes: 0, lessons: 0});
  assert.deepEqual(empty.vocab, {added: 0, reviewed: 0});
  f.seed('2026-11-05', {minutes: 5, questions: {answered: 3, correct: 7}});
  assert.equal(monthlyRecap(f.pact).study.wrong, 0);
});

test('网关：pinkie.recap.month 是 operator.read，默认上个月，出错走 respond(false)', async (t) => {
  const f = fixture(t);
  f.seed('2026-11-08', {minutes: 12, questions: {answered: 2, correct: 1}});
  const methods = new Map();
  registerLearningPactGateway({registerGatewayMethod: (name, handler, opts) => methods.set(name, {handler, opts})}, f.pact);
  const m = methods.get('pinkie.recap.month');
  assert.ok(m, '方法已登记');
  assert.equal(m.opts.scope, 'operator.read');
  const call = (params) => new Promise((resolve) => m.handler({params, respond: (ok, value, error) => resolve({ok, value, error})}));
  const ok = await call({});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.month, '2026-11');
  assert.equal(ok.value.study.minutes, 12);
  const bad = await call({month: 'nope'});
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, /YYYY-MM/);
});
