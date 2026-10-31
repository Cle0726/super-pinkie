// 学习台的日历引擎：今天是什么日子。一律按北京时间（先生 2026-10-28 定：人在美国，跟国内的节奏过日子）。
// 纯计算、零网络：节气按太阳视黄经算，农历用 Intl 中国历，只有法定假日和调休读每年更新的 learning-holidays-cn.json。
import fs from 'node:fs';

const HOLIDAYS = JSON.parse(fs.readFileSync(new URL('./learning-holidays-cn.json', import.meta.url), 'utf8'));
const DAY = 86_400_000;
const BEIJING = 8 * 3_600_000; // 1991 年起不用夏令时
const DELTA_T = 69.2 / 86_400; // 地球时 − 世界时，2026 年前后约 69 秒，换成天

export const beijingDay = instant => new Date(Number(instant) + BEIJING).toISOString().slice(0, 10);
export const beijingHour = instant => { const d = new Date(Number(instant) + BEIJING); return d.getUTCHours() + d.getUTCMinutes() / 60; };
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay();
const rad = deg => deg * Math.PI / 180;

// ---------- 二十四节气 ----------
// Meeus《天文算法》第 25 章低精度太阳位置，误差约 0.01°（约 15 分钟）。
// 节气时刻离北京午夜不到 30 分钟的，日期可能差一天：TERM_FIX 里放核对过的例外（测试会列出这些边缘时刻）。
export const TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
const TERM_FIX = {};
function sunLongitude(jde) {
  const t = (jde - 2451545) / 36525;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const m = rad(357.52911 + 35999.05029 * t - 0.0001537 * t * t);
  const c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(m) + (0.019993 - 0.000101 * t) * Math.sin(2 * m) + 0.000289 * Math.sin(3 * m);
  const omega = rad(125.04 - 1934.136 * t);
  return ((l0 + c - 0.00569 - 0.00478 * Math.sin(omega)) % 360 + 360) % 360;
}
const termCache = new Map();
export function solarTerms(year) {
  if (termCache.has(year)) return termCache.get(year);
  const terms = TERM_NAMES.map((name, index) => {
    const target = (285 + 15 * index) % 360;
    let jde = Date.UTC(year, 0, 6) / DAY + 2440587.5 + index * 15.218;
    for (let i = 0; i < 30; i++) {
      const diff = ((target - sunLongitude(jde)) % 360 + 540) % 360 - 180;
      jde += diff * 365.2422 / 360;
      if (Math.abs(diff) < 1e-8) break;
    }
    const at = Math.round((jde - DELTA_T - 2440587.5) * DAY);
    const key = `${year}-${name}`;
    return {name, index, at, date: TERM_FIX[key] || beijingDay(at)};
  });
  termCache.set(year, terms);
  return terms;
}
export const termOn = date => solarTerms(Number(date.slice(0, 4))).find(term => term.date === date) || null;
export function nextTerm(date) {
  const year = Number(date.slice(0, 4));
  return [...solarTerms(year), ...solarTerms(year + 1)].find(term => term.date > date);
}
function lastTerm(date) {
  const year = Number(date.slice(0, 4));
  return [...solarTerms(year - 1), ...solarTerms(year)].filter(term => term.date <= date).at(-1);
}

// ---------- 农历 ----------
const LUNAR = new Intl.DateTimeFormat('en-u-ca-chinese', {timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric'});
const MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五',
  '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
// ICU 的新月是近似算的：新月离北京午夜只差几分钟时，月初会错一天。用 Meeus 第 49 章精确新月逐月核对 2026–2031，
// 只有下面两处不同（2027-02-06 23:56、2030-02-03 00:07 北京时间），都是春节。表里写正确的月初，月末仍跟 ICU 的下一个初一。
const LUNAR_FIX = [{start: '2027-02-06', year: 2027, month: 1}, {start: '2030-02-03', year: 2030, month: 1}];
function icuLunar(date) {
  const parts = Object.fromEntries(LUNAR.formatToParts(new Date(date + 'T12:00:00Z')).map(part => [part.type, part.value]));
  return {year: Number(parts.relatedYear), month: parseInt(parts.month, 10), day: Number(parts.day), leap: /bis$/.test(parts.month)};
}
function fixedLunar(date) {
  for (const fix of LUNAR_FIX) {
    const offset = dayDiff(fix.start, date);
    if (offset === -1) {
      // ICU 把正确月初的前一天当成了初一：它其实是上个月的最后一天。
      const icu = icuLunar(date);
      if (icu.day === 1 && icu.month === fix.month) { const prev = icuLunar(addDays(date, -1)); return {...prev, day: prev.day + 1}; }
    }
    if (offset < 0 || offset > 30) continue;
    let end = 1;
    while (end < 31) { const icu = icuLunar(addDays(fix.start, end)); if (icu.day === 1 && icu.month !== fix.month) break; end++; }
    if (offset < end) return {year: fix.year, month: fix.month, day: offset + 1, leap: false};
  }
  return icuLunar(date);
}
export function lunar(date) {
  const {year, month, day, leap} = fixedLunar(date);
  const monthName = (leap ? '闰' : '') + MONTH_NAMES[month - 1];
  return {year, month, day, leap, monthName, dayName: DAY_NAMES[day - 1], label: day === 1 ? monthName : DAY_NAMES[day - 1]};
}

// ---------- 节日 ----------
// kind：big 大节（当天的主角）、region 广西、minor 小节（只在页眉小字里提一句）、term 节气型节日
const SOLAR_FESTIVALS = {'01-01': ['new-year', '元旦', 'big'], '05-01': ['labour', '劳动节', 'big'], '05-04': ['youth', '青年节', 'minor'],
  '10-01': ['national', '国庆节', 'big'], '12-24': ['christmas-eve', '平安夜', 'minor'], '12-25': ['christmas', '圣诞节', 'minor']};
const LUNAR_FESTIVALS = {'1-1': ['spring', '春节', 'big'], '1-15': ['lantern', '元宵节', 'big'], '2-2': ['longtaitou', '龙抬头', 'minor'],
  '3-3': ['sanyuesan', '广西三月三', 'region'], '5-5': ['dragon-boat', '端午节', 'big'], '7-7': ['qixi', '七夕', 'minor'],
  '8-15': ['mid-autumn', '中秋节', 'big'], '9-9': ['chongyang', '重阳节', 'minor'], '12-8': ['laba', '腊八', 'minor'], '12-23': ['xiaonian', '小年', 'minor']};
export function festivals(date) {
  const out = [], solar = SOLAR_FESTIVALS[date.slice(5)];
  if (solar) out.push({id: solar[0], name: solar[1], kind: solar[2]});
  const l = lunar(date);
  const lunarFestival = !l.leap && LUNAR_FESTIVALS[`${l.month}-${l.day}`];
  if (lunarFestival) out.push({id: lunarFestival[0], name: lunarFestival[1], kind: lunarFestival[2]});
  // 腊月有时只有 29 天：除夕按「明天是正月初一」认。
  const tomorrow = lunar(addDays(date, 1));
  if (tomorrow.month === 1 && tomorrow.day === 1 && !tomorrow.leap) out.push({id: 'chuxi', name: '除夕', kind: 'big'});
  const term = termOn(date);
  if (term?.name === '清明') out.push({id: 'qingming', name: '清明节', kind: 'term'});
  if (term?.name === '冬至') out.push({id: 'dongzhi', name: '冬至', kind: 'minor'});
  return out;
}

// ---------- 法定假日与调休 ----------
export function holiday(date, data = HOLIDAYS) {
  const year = date.slice(0, 4), result = {off: false, workday: false, name: '', published: false, regionOff: false, regionName: ''};
  const national = data.national?.[year], region = data.guangxi?.[year];
  result.published = Boolean(national?.published);
  const inRange = entry => entry.from <= date && date <= entry.to;
  const hit = national?.holidays?.find(inRange);
  if (hit) Object.assign(result, {off: true, name: hit.name});
  if (national?.workdays?.includes(date)) result.workday = true;
  const local = region?.holidays?.find(inRange);
  if (local) Object.assign(result, {regionOff: true, regionName: local.name});
  if (region?.workdays?.includes(date)) result.workday = true;
  return result;
}

// ---------- 季节 ----------
export function season(date) {
  const index = lastTerm(date)?.index ?? 0;
  return index >= 2 && index < 8 ? 'spring' : index >= 8 && index < 14 ? 'summer' : index >= 14 && index < 20 ? 'autumn' : 'winter';
}

// ---------- 考试时间线 ----------
export const EXAM_MILESTONES = [100, 60, 30, 14, 7, 3, 1, 0];
export function examPhase(date, exam) {
  if (!exam?.date) return {id: exam?.id, name: exam?.name, date: null, daysLeft: null, phase: 'unset', milestone: null};
  const daysLeft = dayDiff(date, exam.date);
  const phase = daysLeft > 100 ? 'far' : daysLeft > 30 ? 'build' : daysLeft > 7 ? 'sprint' : daysLeft > 1 ? 'final'
    : daysLeft === 1 ? 'eve' : daysLeft === 0 ? 'day' : daysLeft >= -7 ? 'after' : 'done';
  return {id: exam.id, name: exam.name, date: exam.date, daysLeft, phase, milestone: EXAM_MILESTONES.includes(daysLeft) ? daysLeft : daysLeft === -1 ? -1 : null};
}

// ---------- 时段 ----------
// 深夜线默认北京时间 0:30；碧琪学到先生常在几点收工后，用 rhythm.lateAfter（24 小时以后的写法，如 24.5）覆盖。
const PERIODS = [[5, 'dawn', '清晨', '早上好'], [8, 'morning', '上午', '上午好'], [11, 'noon', '中午', '中午好'], [13, 'afternoon', '下午', '下午好'],
  [17, 'dusk', '傍晚', '傍晚好'], [19, 'evening', '晚上', '晚上好']];
export function period(hour, {lateAfter = 24.5} = {}) {
  const h = hour < 5 ? hour + 24 : hour;
  if (h >= lateAfter) return {id: 'late', label: '深夜', greeting: '这么晚了'};
  const hit = [...PERIODS].reverse().find(([from]) => h >= from) || PERIODS[0];
  return {id: hit[1], label: h >= 23 ? '夜里' : hit[2], greeting: hit[3]};
}

// ---------- 今天的主角 ----------
// 日子会撞在一起（周五 + 霜降 + 考前 30 天 + 隔了三天回来），一天只挑一个主角定问候、胶带和贴纸；其余最多两条进页眉小字。
const BIG_GREETING = {spring: '新年好', chuxi: '除夕快乐', 'new-year': '新年快乐', lantern: '元宵快乐', sanyuesan: '三月三快乐',
  'dragon-boat': '端午安康', 'mid-autumn': '中秋快乐', national: '国庆快乐', labour: '劳动节快乐'};
const FESTIVAL_TAPE = {spring: 'red', chuxi: 'red', lantern: 'red', sanyuesan: 'wuse', 'mid-autumn': 'moon', national: 'red', 'new-year': 'red'};
export function protagonist(facts, {gapDays = 0, studyDay = 1, studiedToday = false} = {}, {birthday = '', since = ''} = {}) {
  const {date, period: p, exams, festivals: fest, term} = facts;
  const nearest = exams.filter(exam => Number.isFinite(exam.daysLeft) && exam.daysLeft >= -1).sort((a, b) => a.daysLeft - b.daysLeft);
  const today = nearest.find(exam => exam.daysLeft === 0), eve = nearest.find(exam => exam.daysLeft === 1);
  const final = nearest.find(exam => exam.daysLeft > 1 && exam.daysLeft <= 7);
  const big = fest.find(item => item.kind === 'big' || item.kind === 'region');
  const examMilestone = nearest.find(exam => [100, 60, 30, 14].includes(exam.daysLeft));
  const anniversary = since && since.slice(5) === date.slice(5) && since < date ? dayDiff(since, date) : 0;
  const pick = today ? {id: 'exam-day', exam: today.id, greeting: `今天${today.name}，先生`}
    : eve ? {id: 'exam-eve', exam: eve.id, greeting: '明天就考了，先生'}
    : birthday && birthday === date.slice(5) ? {id: 'birthday', greeting: '生日快乐，先生'}
    : final ? {id: 'exam-final', exam: final.id, greeting: `${p.greeting}，先生`}
    : big ? {id: 'festival', festival: big.id, greeting: `${BIG_GREETING[big.id] || p.greeting}，先生`}
    : anniversary ? {id: 'anniversary', years: Math.round(anniversary / 365), greeting: `${p.greeting}，先生`}
    : gapDays >= 3 && !studiedToday ? {id: 'comeback', gapDays, greeting: '欢迎回来，先生'}
    : examMilestone ? {id: 'exam-milestone', exam: examMilestone.id, days: examMilestone.daysLeft, greeting: `${p.greeting}，先生`}
    : [30, 100, 200, 365].includes(studyDay) ? {id: 'study-milestone', days: studyDay, greeting: `${p.greeting}，先生`}
    : term ? {id: 'term', term: term.name, greeting: `${p.greeting}，先生`}
    : {id: 'ordinary', greeting: `${p.greeting}，先生`};
  const quiet = ['exam-day', 'exam-eve', 'exam-final'].includes(pick.id);
  const late = p.id === 'late';
  // 深夜劝睡，不庆祝；考试当天和前一天的话照旧。
  if (late && !['exam-day', 'exam-eve'].includes(pick.id)) pick.greeting = '这么晚了，先生';
  const tape = quiet ? 'plain' : pick.id === 'festival' ? FESTIVAL_TAPE[pick.festival] || facts.season : facts.season;
  return {...pick, quiet: quiet || late, late, celebrate: !quiet && !late && ['festival', 'birthday', 'anniversary', 'exam-milestone', 'study-milestone'].includes(pick.id), tape};
}

// ---------- 合起来 ----------
export function almanac(instant, {exams = [], rhythm = {}, personal = {}} = {}) {
  const date = beijingDay(instant), hour = beijingHour(instant);
  const term = termOn(date), next = nextTerm(date), l = lunar(date);
  const facts = {date, weekday: weekday(date), weekend: [0, 6].includes(weekday(date)), hour: Math.round(hour * 100) / 100,
    period: period(hour, rhythm), lunar: l, term: term ? {name: term.name, at: term.at} : null,
    nextTerm: next ? {name: next.name, date: next.date, inDays: dayDiff(date, next.date)} : null,
    festivals: festivals(date), holiday: holiday(date), season: season(date), exams: exams.map(exam => examPhase(date, exam))};
  facts.protagonist = protagonist(facts, rhythm, personal);
  // 页眉小字：农历总在；再加最多一条不是主角的事实。
  const extra = facts.protagonist.id !== 'term' && term ? `今天${term.name}`
    : facts.festivals.find(item => item.id !== facts.protagonist.festival)?.name
    || (facts.holiday.workday ? '调休上班' : '')
    || (next && next.date !== date && dayDiff(date, next.date) <= 3 ? `${next.name}前${dayDiff(date, next.date)}天` : '');
  facts.notes = [l.monthName + l.dayName, extra].filter(Boolean);
  return facts;
}
