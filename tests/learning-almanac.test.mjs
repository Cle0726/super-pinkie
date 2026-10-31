import test from 'node:test';
import assert from 'node:assert/strict';
import {almanac, beijingDay, examPhase, festivals, holiday, lunar, period, protagonist, season, solarTerms, termOn} from '../services/mode-architecture/learning-almanac.mjs';

const EXAMS = [{id: 'pretco-b', name: '英语 B 级', date: '2026-12-13'}, {id: 'zsb', name: '专升本', date: '2028-04-22'}, {id: 'cet-4', name: '英语四级', date: '2027-06-12'}];
const at = iso => Date.parse(iso);

test('一律按北京时间切天：美西晚上已经是北京第二天', () => {
  assert.equal(beijingDay(at('2026-10-28T22:59:00-07:00')), '2026-10-29');
  assert.equal(almanac(at('2026-10-28T22:59:00-07:00')).period.id, 'afternoon');
});

test('节气日期对上已公布的历表（2026 年全年、2027 年秋冬）', () => {
  const y2026 = Object.fromEntries(solarTerms(2026).map(term => [term.name, term.date.slice(5)]));
  assert.deepEqual(y2026, {小寒: '01-05', 大寒: '01-20', 立春: '02-04', 雨水: '02-18', 惊蛰: '03-05', 春分: '03-20', 清明: '04-05', 谷雨: '04-20',
    立夏: '05-05', 小满: '05-21', 芒种: '06-05', 夏至: '06-21', 小暑: '07-07', 大暑: '07-23', 立秋: '08-07', 处暑: '08-23', 白露: '09-07', 秋分: '09-23',
    寒露: '10-08', 霜降: '10-23', 立冬: '11-07', 小雪: '11-22', 大雪: '12-07', 冬至: '12-22'});
  assert.equal(termOn('2027-10-23')?.name, '霜降');
  assert.equal(termOn('2027-11-07')?.name, '立冬');
});

test('农历：Intl 中国历加上两处春节校正', () => {
  assert.equal(lunar('2026-10-28').monthName + lunar('2026-10-28').dayName, '九月十九');
  assert.deepEqual(['2027-02-05', '2027-02-06', '2027-02-20', '2027-03-07', '2027-03-08'].map(d => { const l = lunar(d); return `${l.month}/${l.day}`; }),
    ['12/29', '1/1', '1/15', '1/30', '2/1']);
  assert.deepEqual(['2030-02-02', '2030-02-03'].map(d => { const l = lunar(d); return `${l.month}/${l.day}`; }), ['12/30', '1/1']);
  assert.equal(lunar('2025-07-25').monthName, '闰六月');
});

test('节日：除夕按「明天是正月初一」认，三月三按农历', () => {
  const names = date => festivals(date).map(item => item.name);
  assert.deepEqual(names('2026-02-16'), ['除夕']);
  assert.deepEqual(names('2027-02-05'), ['除夕']);
  assert.deepEqual(names('2027-02-06'), ['春节']);
  assert.deepEqual(names('2027-04-09'), ['广西三月三']);
  assert.deepEqual(names('2028-03-28'), ['广西三月三']);
  assert.deepEqual(names('2026-10-01'), ['国庆节']);
  assert.ok(names('2027-04-05').includes('清明节'));
});

test('法定假日：只认公告；没公布的年份不编', () => {
  assert.deepEqual(holiday('2026-10-05'), {off: true, workday: false, name: '国庆节', published: true, regionOff: false, regionName: ''});
  assert.equal(holiday('2026-10-10').workday, true);
  assert.equal(holiday('2026-04-17').regionOff, true);
  assert.deepEqual(holiday('2027-02-06'), {off: false, workday: false, name: '', published: false, regionOff: false, regionName: ''});
});

test('季节跟节气走', () => {
  assert.equal(season('2026-10-29'), 'autumn');
  assert.equal(season('2026-11-07'), 'winter');
  assert.equal(season('2027-02-04'), 'spring');
  assert.equal(season('2027-01-10'), 'winter');
});

test('考试时间线和里程碑', () => {
  assert.deepEqual(examPhase('2026-10-29', EXAMS[0]), {id: 'pretco-b', name: '英语 B 级', date: '2026-12-13', daysLeft: 45, phase: 'build', milestone: null});
  assert.equal(examPhase('2026-11-13', EXAMS[0]).milestone, 30);
  assert.equal(examPhase('2026-12-12', EXAMS[0]).phase, 'eve');
  assert.equal(examPhase('2026-12-14', EXAMS[0]).milestone, -1);
  assert.equal(examPhase('2026-10-29', {id: 'x', name: 'x', date: null}).phase, 'unset');
});

test('时段：深夜线默认 0:30，可以被学到的节奏覆盖', () => {
  assert.equal(period(23.9).id, 'evening');
  assert.equal(period(0.6).id, 'late');
  assert.equal(period(0.6, {lateAfter: 25.5}).id, 'evening');
  assert.equal(period(7).id, 'dawn');
});

test('一天只有一个主角，优先级照计划', () => {
  const pick = (iso, rhythm = {}, personal = {}) => almanac(at(iso), {exams: EXAMS, rhythm, personal}).protagonist;
  assert.equal(pick('2026-12-13T08:00:00+08:00').id, 'exam-day');
  assert.equal(pick('2026-12-12T20:00:00+08:00').greeting, '明天就考了，先生');
  assert.equal(pick('2026-12-08T20:00:00+08:00').quiet, true);
  assert.equal(pick('2028-03-28T20:00:00+08:00').tape, 'wuse');
  assert.equal(pick('2026-11-04T20:00:00+08:00', {gapDays: 4}).greeting, '欢迎回来，先生');
  assert.equal(pick('2026-11-04T20:00:00+08:00', {gapDays: 4, studiedToday: true}).id, 'ordinary');
  assert.equal(pick('2026-11-07T20:00:00+08:00').term, '立冬');
  assert.equal(pick('2026-11-13T20:00:00+08:00').id, 'exam-milestone');
  assert.equal(pick('2027-03-02T20:00:00+08:00', {}, {birthday: '03-02'}).id, 'birthday');
  // 生日撞上考试当天：考试优先。
  assert.equal(pick('2026-12-13T08:00:00+08:00', {}, {birthday: '12-13'}).id, 'exam-day');
});

test('深夜不庆祝；考前一天的话照旧', () => {
  const late = almanac(at('2027-02-06T01:10:00+08:00'), {exams: EXAMS}).protagonist;
  assert.equal(late.id, 'festival');
  assert.equal(late.greeting, '这么晚了，先生');
  assert.equal(late.celebrate, false);
  const eve = almanac(at('2026-12-13T01:00:00+08:00'), {exams: [{id: 'x', name: '考试', date: '2026-12-14'}]}).protagonist;
  assert.equal(eve.greeting, '明天就考了，先生');
});

test('页眉小字：农历 + 最多一条别的事实', () => {
  assert.deepEqual(almanac(at('2026-11-04T20:00:00+08:00'), {exams: EXAMS}).notes, ['九月廿六', '立冬前3天']);
  assert.deepEqual(almanac(at('2026-10-10T20:00:00+08:00'), {exams: EXAMS}).notes, ['九月初一', '调休上班']);
  assert.deepEqual(protagonist({date: '2026-10-29', period: period(20), exams: [], festivals: [], term: null, season: 'autumn'}).id, 'ordinary');
});
