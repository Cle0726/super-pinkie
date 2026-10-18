import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Le Pacte：学习模式的约定、每日账本、连续天数、专注计时与提醒上下文。
// 所有日期都按 pact 的时区（默认 Asia/Shanghai）切天，UTC 的 16:30 属于第二天。

const PACT_VERSION = 1;
const MAX_PATCH_DEPTH = 4;
const INTENSITIES = ['gentle', 'firm', 'relentless'];
const CHANNEL_KINDS = ['none', 'feishu', 'weixin', 'qq'];
export const NUDGE_KINDS = ['morning', 'evening', 'lastcall'];
export const NUDGE_MARKER = /\[\[CLEKK_PACT_NUDGE:(morning|evening|lastcall)\]\]/g;
export const PACT_NO_REPLY = 'NO_REPLY';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function pactDefaults(now = Date.now()) {
  return {
    version: PACT_VERSION,
    exam: {name: 'PRETCO-B', date: null},
    daily: {minutes: 30, questions: 20, reviews: 'due'},
    intensity: 'firm',
    timezone: 'Asia/Shanghai',
    reminders: {morning: '08:30', evening: '21:00', lastCall: '22:30'},
    channel: {kind: 'none', to: null},
    createdAt: now,
    updatedAt: now,
  };
}

function text(value, limit = 200) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value, min, max, fallback) {
  const number = Math.round(finite(value, fallback));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function validTimezone(value) {
  const name = text(value, 80);
  if (!name || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(name)) return null;
  try { new Intl.DateTimeFormat('en-US', {timeZone: name}); return name; } catch { return null; }
}

function validDate(value) {
  const match = DATE_PATTERN.exec(text(value, 10));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function validTime(value) {
  const name = text(value, 5);
  return TIME_PATTERN.test(name) ? name : null;
}

function fail(message) { throw new Error(message); }

function sanitizePact(raw, now = 0) {
  const base = pactDefaults(now);
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const tz = validTimezone(value.timezone) || base.timezone;
  const exam = value.exam && typeof value.exam === 'object' && !Array.isArray(value.exam) ? value.exam : {};
  const daily = value.daily && typeof value.daily === 'object' && !Array.isArray(value.daily) ? value.daily : {};
  const reminders = value.reminders && typeof value.reminders === 'object' && !Array.isArray(value.reminders) ? value.reminders : {};
  const channel = value.channel && typeof value.channel === 'object' && !Array.isArray(value.channel) ? value.channel : {};
  const kind = CHANNEL_KINDS.includes(channel.kind) ? channel.kind : base.channel.kind;
  const to = text(channel.to, 200);
  return {
    version: PACT_VERSION,
    exam: {name: text(exam.name, 80) || base.exam.name, date: validDate(exam.date) || null},
    daily: {
      minutes: clampInteger(daily.minutes, 5, 600, base.daily.minutes),
      questions: clampInteger(daily.questions, 0, 500, base.daily.questions),
      reviews: daily.reviews === 'skip' ? 'skip' : 'due',
    },
    intensity: INTENSITIES.includes(value.intensity) ? value.intensity : base.intensity,
    timezone: tz,
    reminders: {
      morning: validTime(reminders.morning) || base.reminders.morning,
      evening: validTime(reminders.evening) || base.reminders.evening,
      lastCall: validTime(reminders.lastCall ?? reminders.lastcall) || base.reminders.lastCall,
    },
    channel: {kind, to: kind === 'none' ? null : to || null},
    createdAt: Number(value.createdAt) || now,
    updatedAt: Number(value.updatedAt) || now,
  };
}

function mergePatch(target, patch, depth = 0) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return target;
  if (depth > MAX_PATCH_DEPTH) return target;
  const next = {...target};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      next[key] = mergePatch(target[key], value, depth + 1);
    } else {
      next[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return next;
}

function validatePatch(patch) {
  if (patch == null) return {};
  if (typeof patch !== 'object' || Array.isArray(patch)) fail('pact 补丁必须是对象');
  const raw = patch;
  const out = {};
  const has = key => Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;
  if (has('exam')) {
    if (!raw.exam || typeof raw.exam !== 'object' || Array.isArray(raw.exam)) fail('exam 必须是对象');
    if (raw.exam.date !== undefined) {
      if (raw.exam.date !== null && validDate(raw.exam.date) === null) fail('考试日期必须是 YYYY-MM-DD 或 null');
      out.exam = {date: raw.exam.date === null ? null : validDate(raw.exam.date)};
      if (raw.exam.name !== undefined) {
        const name = text(raw.exam.name, 80);
        if (!name) fail('考试名称不能为空');
        out.exam.name = name;
      }
    } else if (has('exam') && raw.exam.name !== undefined) {
      const name = text(raw.exam.name, 80);
      if (!name) fail('考试名称不能为空');
      out.exam = {name};
    }
  }
  if (has('daily')) {
    if (!raw.daily || typeof raw.daily !== 'object' || Array.isArray(raw.daily)) fail('daily 必须是对象');
    out.daily = {};
    if (raw.daily.minutes !== undefined) {
      const minutes = Number(raw.daily.minutes);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) fail('每日分钟数必须是 5–600 的整数');
      out.daily.minutes = minutes;
    }
    if (raw.daily.questions !== undefined) {
      const questions = Number(raw.daily.questions);
      if (!Number.isInteger(questions) || questions < 0 || questions > 500) fail('每日题量必须是 0–500 的整数');
      out.daily.questions = questions;
    }
    if (raw.daily.reviews !== undefined) {
      if (raw.daily.reviews !== 'due' && raw.daily.reviews !== 'skip') fail('复习目标只能是 due 或 skip');
      out.daily.reviews = raw.daily.reviews;
    }
  }
  if (has('intensity')) {
    if (!INTENSITIES.includes(raw.intensity)) fail('强度只能是 gentle、firm 或 relentless');
    out.intensity = raw.intensity;
  }
  if (has('timezone')) {
    const tz = validTimezone(raw.timezone);
    if (!tz) fail('时区必须是有效的 IANA 名称，例如 Asia/Shanghai');
    out.timezone = tz;
  }
  if (has('reminders')) {
    if (!raw.reminders || typeof raw.reminders !== 'object' || Array.isArray(raw.reminders)) fail('reminders 必须是对象');
    out.reminders = {};
    for (const key of ['morning', 'evening', 'lastCall', 'lastcall']) {
      if (raw.reminders[key] === undefined) continue;
      const time = validTime(raw.reminders[key]);
      if (!time) fail(`${key} 必须是 HH:MM`);
      out.reminders[key === 'lastcall' ? 'lastCall' : key] = time;
    }
  }
  if (has('channel')) {
    if (!raw.channel || typeof raw.channel !== 'object' || Array.isArray(raw.channel)) fail('channel 必须是对象');
    if (raw.channel.kind !== undefined && !CHANNEL_KINDS.includes(raw.channel.kind)) fail('推送渠道只能是 none、feishu、weixin 或 qq');
    out.channel = {};
    if (raw.channel.kind !== undefined) out.channel.kind = raw.channel.kind;
    if (raw.channel.to !== undefined) {
      if (raw.channel.to !== null && typeof raw.channel.to !== 'string') fail('接收人必须是字符串或 null');
      out.channel.to = raw.channel.to === null ? null : text(raw.channel.to, 200) || null;
    }
  }
  return out;
}

function backupCorrupt(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const target = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, target);
    return target;
  } catch { return ''; }
}

// Pact 的 JSON 必须“要么能读，要么明确判为损坏”，不能像 UI 缓存那样静默回落，
// 否则损坏文件会被下一次写入直接覆盖，用户再也找不回原内容。
function readJsonStrict(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return {missing: true, value: null};
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {missing: false, corrupt: true, value: null};
    return {missing: false, value: parsed};
  } catch { return {missing: false, corrupt: true, value: null}; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

// en-CA 输出 YYYY-MM-DD；formatToParts 比字符串比较更稳妥，避免中文/短格式差异。
const dayFormatters = new Map();
export function dayInZone(instant, timeZone = 'Asia/Shanghai') {
  const tz = validTimezone(timeZone) || 'Asia/Shanghai';
  let formatter = dayFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'});
    dayFormatters.set(tz, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(Number(instant) || 0)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function clockInZone(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {timeZone: timeZone || 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  return formatter.format(new Date(Number(instant) || 0));
}

function addDays(date, delta) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

function emptyDay(date) {
  return {
    date,
    minutes: 0,
    focus: [],
    questions: {answered: 0, correct: 0},
    reviews: {done: 0},
    notes: {added: 0},
    firstActivityAt: null,
    completedAt: null,
  };
}

function sanitizeDay(raw, date) {
  const base = emptyDay(date);
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    date,
    minutes: Math.max(0, Math.round(finite(value.minutes))),
    focus: Array.isArray(value.focus) ? value.focus.filter(item => item && typeof item === 'object').slice(-200).map(item => ({
      start: Math.max(0, Number(item.start) || 0),
      end: Math.max(0, Number(item.end) || 0),
      minutes: Math.max(0, Math.round(finite(item.minutes))),
    })) : [],
    questions: {
      answered: Math.max(0, Math.round(finite(value.questions?.answered))),
      correct: Math.max(0, Math.round(finite(value.questions?.correct))),
    },
    reviews: {done: Math.max(0, Math.round(finite(value.reviews?.done)))},
    notes: {added: Math.max(0, Math.round(finite(value.notes?.added)))},
    firstActivityAt: Number(value.firstActivityAt) || null,
    completedAt: Number(value.completedAt) || null,
  };
}

function dueFromNotes(notes, now) {
  if (!Array.isArray(notes)) return 0;
  return notes.filter(note => note?.status !== 'merged'
    && (!Number(note.nextReviewAt) || Number(note.nextReviewAt) <= now)).length;
}

function needsDueReviews(pact) {
  return (pact?.daily?.reviews ?? 'due') === 'due';
}

// 当天完成 = 分钟与题量达标，且（复习目标为 due 时）检查那一刻没有到期卡。
// `dueAtCheck` 由调用方当场测量；历史天数一律按需要复习处理，避免用今天的
// 到期数去改写昨天的完成状态。
function meetsGoals(day, pact, dueAtCheck) {
  const daily = pact?.daily || {};
  if (!day) return false;
  if (day.minutes < (daily.minutes ?? 30)) return false;
  if (day.questions.answered < (daily.questions ?? 20)) return false;
  if (needsDueReviews(pact) && dueAtCheck !== 0) return false;
  return true;
}

function hasActivity(day) {
  return Boolean(day) && (day.minutes > 0 || day.questions.answered > 0 || day.reviews.done > 0 || day.notes.added > 0
    || (Array.isArray(day.focus) && day.focus.length > 0));
}

function dayState(day, pact, todayDate) {
  if (day.date > todayDate) return 'future';
  if (day.completedAt != null) return 'complete';
  // Without a recorded completion we cannot assume that yesterday's due reviews
  // were done. Today's due count cannot prove a historical completion either.
  if (!needsDueReviews(pact) && meetsGoals(day, pact, 0)) return 'complete';
  return hasActivity(day) ? 'partial' : 'missed';
}

function todayPayload(pact, day, {dueReviews = 0, best = 0, current = 0, weakTopics = [], now = Date.now()} = {}) {
  const complete = day.completedAt != null;
  const examDate = validDate(pact.exam?.date);
  return {
    date: day.date,
    pact,
    progress: {
      minutes: day.minutes,
      questions: day.questions.answered,
      correct: day.questions.correct,
      reviewsDone: day.reviews.done,
      dueReviews,
      notesAdded: day.notes.added,
    },
    goals: {minutes: pact.daily.minutes, questions: pact.daily.questions},
    complete,
    streak: {current, best},
    examCountdownDays: examDate ? daysBetween(dayInZone(now, pact.timezone), examDate) : null,
    weakTopics,
  };
}

function clockLabel(minutes) {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return `${value}分钟`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
}

const INTENSITY_LINES = {
  gentle: '口气要温和，先肯定已经做的，再轻轻提醒。',
  firm: '口气要直接，明确指出今天哪一项没做到、差多少，不要绕弯子。',
  relentless: '口气要硬，用连续天数和考试倒计时施压，但不许侮辱、羞辱或贬低先生。',
};

export function composeNudgeContext(kind, today = {}) {
  const nudge = NUDGE_KINDS.includes(kind) ? kind : 'evening';
  const pact = today.pact || {};
  const intensity = INTENSITIES.includes(pact.intensity) ? pact.intensity : 'firm';
  const daily = pact.daily || {minutes: 30, questions: 20, reviews: 'due'};
  const progress = today.progress || {};
  const goals = today.goals || {minutes: daily.minutes ?? 30, questions: daily.questions ?? 20};
  const minutes = Math.max(0, Math.round(finite(progress.minutes)));
  const questions = Math.max(0, Math.round(finite(progress.questions)));
  const reviewsDone = Math.max(0, Math.round(finite(progress.reviewsDone)));
  const dueReviews = Math.max(0, Math.round(finite(progress.dueReviews)));
  const notesAdded = Math.max(0, Math.round(finite(progress.notesAdded)));
  const goalMinutes = Math.max(1, Math.round(finite(goals.minutes, 30)));
  const goalQuestions = Math.max(0, Math.round(finite(goals.questions, 20)));
  const streakCurrent = Math.max(0, Math.round(finite(today.streak?.current)));
  const streakBest = Math.max(streakCurrent, Math.round(finite(today.streak?.best)));
  const countdown = Number.isFinite(today.examCountdownDays) ? Math.round(today.examCountdownDays) : null;
  const complete = today.complete === true;
  const weakTopics = (Array.isArray(today.weakTopics) ? today.weakTopics : [])
    .filter(item => item && item.tag).slice(0, 5)
    .map(item => ({tag: text(item.tag, 40), wrong: Math.max(0, Math.round(finite(item.wrong))), total: Math.max(0, Math.round(finite(item.total)))}));
  const remainMinutes = Math.max(0, goalMinutes - minutes);
  const remainQuestions = Math.max(0, goalQuestions - questions);
  const started = minutes > 0 || questions > 0 || reviewsDone > 0 || notesAdded > 0;
  if (today.complete === undefined) {
    const missing = (!(minutes >= goalMinutes)) || (!(questions >= goalQuestions)) || (daily.reviews === 'due' && dueReviews > 0);
    if (!missing) return composeNudgeContext(kind, {...today, complete: true});
  }

  const kindLabel = {morning: '早间计划', evening: '晚间收尾', lastcall: '最后通牒'}[nudge];
  const lines = [];
  lines.push(`【学习约定提醒 · ${kindLabel}】`);
  lines.push(`现在：${text(today.date, 10) || '今天'}；专注 ${minutes}/${goalMinutes} 分钟；做题 ${questions}/${goalQuestions} 道（正确 ${Math.max(0, Math.round(finite(progress.correct)))} 道）；复习完成 ${reviewsDone} 张；到期复习还剩 ${dueReviews} 张；新笔记 ${notesAdded} 条。`);
  lines.push(`连续天数：当前 ${streakCurrent} 天，历史最佳 ${streakBest} 天。`);
  lines.push(countdown == null ? '考试倒计时：还没设定考试日期。'
    : countdown >= 0 ? `考试倒计时：距离 ${text(pact.exam?.name, 40) || 'PRETCO-B'} 还有 ${countdown} 天。` : `考试倒计时：考试日期已过去 ${-countdown} 天。`);
  lines.push(weakTopics.length ? `最薄弱的部分：${weakTopics.map(item => `${item.tag}（错 ${item.wrong}/${item.total}）`).join('、')}。`
    : '最薄弱的部分：还没有足够的错题记录。');
  lines.push(`强度：${intensity}。${INTENSITY_LINES[intensity]}`);
  const remainders = [];
  if (remainMinutes > 0) remainders.push(`${remainMinutes} 分钟专注`);
  if (remainQuestions > 0) remainders.push(`${remainQuestions} 道题`);
  if (daily.reviews === 'due' && dueReviews > 0) remainders.push(`${dueReviews} 张到期复习`);
  if (nudge === 'morning') {
    const plan = [];
    if (daily.reviews === 'due' && dueReviews > 0) plan.push(`先把 ${dueReviews} 张复习卡翻完`);
    if (remainQuestions > 0) plan.push(`再做 ${Math.min(10, remainQuestions)} 道单选`);
    if (remainMinutes > 0) plan.push(`凑满 ${goalMinutes} 分钟专注`);
    lines.push('morning：只报今天的计划，不催不骂，不说昨天。');
    lines.push(plan.length ? `今天的下一步：${plan.join('，')}。` : '今天的目标已经全部达成：一句鼓励即可。');
  } else if (nudge === 'evening') {
    if (complete) {
      lines.push('evening：今天已经完成，只用一句话认可先生，不要布置新任务。');
    } else if (!started) {
      const smallest = dueReviews > 0 ? `先把 ${Math.min(dueReviews, 12)} 张复习卡翻完`
        : remainQuestions > 0 ? `先做 10 道单选`
          : `先专注 ${Math.min(remainMinutes, 10)} 分钟`;
      lines.push('evening：今天还没开始，推先生现在就开始，只给最小的第一步。');
      lines.push(`最小的第一步：${smallest}。`);
    } else {
      lines.push('evening：今天已经开始但没做完，直接说清还剩什么。');
      lines.push(`还差：${remainders.join('，') || '把今天的账补齐'}。`);
    }
  } else if (complete) {
    return PACT_NO_REPLY;
  } else {
    lines.push('lastcall：今天的最后提醒，态度坚定，把断掉的连续天数说清楚，催先生马上补完，不许挖苦。');
    if (streakCurrent > 0) {
      lines.push(`现在就差：${remainders.join('，') || '补齐今天的目标'}；今天不做完，已经攒下的 ${streakCurrent} 天连续就断在这里。`);
    } else {
      lines.push(`现在就差：${remainders.join('，') || '补齐今天的目标'}；今天不做完，这一天的约定就白写了，重新开始的代价只会更大。`);
    }
  }
  lines.push([
    '写作规则：',
    '- 一条消息，不超过 80 个汉字，称呼先生，用碧琪自己的声音。',
    '- 必须给具体的下一步和数字，例如“先把 12 张复习卡翻完，再做 10 道单选”。',
    '- 不要寒暄，不要 emoji 堆砌，不要 Markdown 标题、列表或加粗。',
    '- 不要提到本段上下文、内部字段名或规则。',
  ].join('\n'));
  return lines.join('\n');
}

export class LearningPact {
  constructor(store, {now = () => Date.now()} = {}) {
    if (!store || typeof store.readNotesState !== 'function') throw new Error('Le Pacte 需要学习笔记存储');
    this.store = store;
    this.root = path.join(store.root, 'pact');
    this.pactFile = path.join(this.root, 'pact.json');
    this.daysRoot = path.join(this.root, 'days');
    this.now = now;
  }

  dayFile(date) { return path.join(this.daysRoot, `${date}.json`); }

  todayDate(pact = this.get()) { return dayInZone(this.now(), pact.timezone); }

  readPactFile() {
    const result = readJsonStrict(this.pactFile);
    if (result.missing) return {pact: pactDefaults(this.now()), created: false};
    if (result.corrupt) {
      backupCorrupt(this.pactFile);
      const pact = pactDefaults(this.now());
      writeJsonAtomic(this.pactFile, pact);
      return {pact, created: true};
    }
    const pact = sanitizePact(result.value, this.now());
    return {pact, created: false};
  }

  get() { return this.readPactFile().pact; }

  set(patch) {
    const validated = validatePatch(patch);
    const current = this.get();
    const now = this.now();
    const merged = sanitizePact(mergePatch(current, validated), now);
    const pact = {...merged, createdAt: current.createdAt || now, updatedAt: now};
    writeJsonAtomic(this.pactFile, pact);
    return {pact};
  }

  readDay(date) {
    const result = readJsonStrict(this.dayFile(date));
    if (result.missing) return emptyDay(date);
    if (result.corrupt) {
      backupCorrupt(this.dayFile(date));
      return emptyDay(date);
    }
    return sanitizeDay(result.value, date);
  }

  writeDay(day, {pact = null} = {}) {
    const activePact = pact || this.get();
    const normalized = sanitizeDay(day, day.date);
    // 账本可以用别的入口直接写入；下次读到时补上首次完成的时间戳。
    if (!normalized.completedAt && meetsGoals(normalized, activePact, this.dueReviews(this.now()))) {
      normalized.completedAt = normalized.firstActivityAt || this.now();
    }
    writeJsonAtomic(this.dayFile(normalized.date), normalized);
    return normalized;
  }

  // 账本写入统一走这里：先读当天，改完再判断是否首次完成。
  mutateDay(date, mutate, {pact = null} = {}) {
    const activePact = pact || this.get();
    const day = this.readDay(date);
    const stamp = this.now();
    mutate(day, stamp, activePact);
    if (hasActivity(day)) day.firstActivityAt ||= stamp;
    // 复习目标按“写下这一笔的那一刻”测量到期数；已记录的 completedAt 不再改写。
    if (day.completedAt == null && meetsGoals(day, activePact, this.dueReviews(stamp))) {
      day.completedAt = stamp;
      day.firstActivityAt ||= stamp;
    }
    return this.writeDay(day, {pact: activePact});
  }

  recordQuestion({correct = null} = {}) {
    return this.mutateDay(this.todayDate(), day => {
      day.questions.answered += 1;
      if (correct === true) day.questions.correct += 1;
    });
  }

  recordReview({count = 1} = {}) {
    return this.mutateDay(this.todayDate(), day => { day.reviews.done += Math.max(1, Math.round(finite(count, 1))); });
  }

  recordNote({count = 1} = {}) {
    return this.mutateDay(this.todayDate(), day => { day.notes.added += Math.max(1, Math.round(finite(count, 1))); });
  }

  dueReviews(now = this.now()) {
    try { return dueFromNotes(this.store.readNotesState().notes, now); } catch { return 0; }
  }

  // 先按笔记自带的 topic / tags 归类；没有标签时退回到笔记的术语。
  weakTopics(limit = 5) {
    try {
      const notes = this.store.readNotesState().notes.filter(note => note?.status !== 'merged');
      const buckets = new Map();
      for (const note of notes) {
        const lapses = Math.max(0, Number(note.lapses) || 0);
        if (!lapses) continue;
        const topics = [...(Array.isArray(note.tags) ? note.tags : []), note.topic, note.term || note.title]
          .map(value => text(value, 60)).filter(Boolean);
        const tag = topics[0] || '未分类';
        const bucket = buckets.get(tag) || {tag, wrong: 0, total: 0};
        bucket.wrong += lapses;
        bucket.total += Math.max(lapses, Number(note.reviewCount) || 0);
        buckets.set(tag, bucket);
      }
      return [...buckets.values()].sort((a, b) => b.wrong - a.wrong || a.tag.localeCompare(b.tag)).slice(0, Math.max(1, limit));
    } catch { return []; }
  }

  history({days = 60, now = this.now(), pact = null} = {}) {
    const activePact = pact || this.get();
    const count = clampInteger(days, 1, 60, 60);
    const today = dayInZone(now, activePact.timezone);
    const result = [];
    for (let index = count - 1; index >= 0; index--) {
      const date = addDays(today, -index);
      result.push({date, state: dayState(this.readDay(date), activePact, today)});
    }
    return result;
  }

  streak({now = this.now(), pact = null} = {}) {
    const activePact = pact || this.get();
    const today = dayInZone(now, activePact.timezone);
    const complete = date => dayState(this.readDay(date), activePact, today) === 'complete';
    // 今天的账本还没写满时，连续天数从昨天往前数；今天补完会自然接上。
    let current = 0;
    let cursor = complete(today) ? today : addDays(today, -1);
    for (let index = 0; index < 3660; index++) {
      if (!complete(cursor)) break;
      current++;
      cursor = addDays(cursor, -1);
    }
    let best = current;
    let run = 0;
    const first = addDays(today, -365);
    for (let cursorDay = first; cursorDay <= today; cursorDay = addDays(cursorDay, 1)) {
      if (complete(cursorDay)) { run++; best = Math.max(best, run); } else run = 0;
    }
    return {current, best};
  }

  today({now = this.now()} = {}) {
    const pact = this.get();
    const date = dayInZone(now, pact.timezone);
    const day = this.readDay(date);
    const dueReviews = this.dueReviews(now);
    const streak = this.streak({now, pact});
    return todayPayload(pact, day, {dueReviews, best: streak.best, current: streak.current, weakTopics: this.weakTopics(5), now});
  }

  focusStateFile() { return path.join(this.root, 'focus.json'); }

  activeFocus(now = this.now()) {
    const result = readJsonStrict(this.focusStateFile());
    if (result.missing) return null;
    if (result.corrupt) { backupCorrupt(this.focusStateFile()); return null; }
    const active = result.value?.active;
    if (!active || typeof active !== 'object') return null;
    const start = Number(active.start) || 0;
    if (!start) return null;
    // 防止时钟回拨造成的负时长；超过一天的会话视为过期，避免永久卡住。
    if (now - start > 12 * 60 * 60 * 1000 || now < start) { this.clearFocus(); return null; }
    const planned = clampInteger(active.plannedMinutes, 1, 600, 25);
    return {id: text(active.id, 80), start, plannedMinutes: planned, date: text(active.date, 10)};
  }

  writeFocus(active) {
    writeJsonAtomic(this.focusStateFile(), {active});
  }

  clearFocus() { writeJsonAtomic(this.focusStateFile(), {active: null}); }

  focusStatus(now = this.now()) {
    const active = this.activeFocus(now);
    if (!active) return {active: null};
    return {active: {id: active.id, start: active.start, plannedMinutes: active.plannedMinutes, elapsedMinutes: Math.floor((now - active.start) / 60_000)}};
  }

  focusStart({minutes = 25, now = this.now()} = {}) {
    const existing = this.activeFocus(now);
    if (existing) return {focus: {id: existing.id, start: existing.start, plannedMinutes: existing.plannedMinutes}};
    const pact = this.get();
    const planned = clampInteger(minutes, 1, 600, 25);
    const focus = {id: `focus-${randomUUID()}`, start: now, plannedMinutes: planned};
    this.writeFocus({...focus, date: dayInZone(now, pact.timezone)});
    return {focus};
  }

  focusStop({id = ''} = {}) {
    const now = this.now();
    const active = this.activeFocus(now);
    if (active && id && text(id, 80) !== active.id) return {error: '专注计时已经变化，请刷新后再停止'};
    if (!active) {
      const today = this.today({now});
      return {minutes: 0, today};
    }
    const elapsedMinutes = Math.floor((now - active.start) / 60_000);
    // 计时最多记到计划时长 + 10 分钟，防止忘了停就记上一整天。
    const credited = Math.max(0, Math.min(elapsedMinutes, active.plannedMinutes + 10));
    this.clearFocus();
    if (credited === 0) return {minutes: 0, today: this.today({now})};
    const pact = this.get();
    const date = active.date && DATE_PATTERN.test(active.date) ? active.date : dayInZone(now, pact.timezone);
    this.mutateDay(date, day => {
      day.minutes += credited;
      day.focus.push({start: active.start, end: now, minutes: credited});
    }, {pact});
    return {minutes: credited, today: this.today({now})};
  }

  nudgeContext(kind) {
    const today = this.today();
    const state = today.complete ? 'complete' : (today.progress.minutes > 0 || today.progress.questions > 0 || today.progress.reviewsDone > 0) ? 'partial' : 'not_started';
    return {kind, state, today, context: composeNudgeContext(kind, today)};
  }
}

export function nudgeKindFromPrompt(prompt) {
  const matches = [...String(prompt || '').matchAll(NUDGE_MARKER)];
  if (!matches.length) return null;
  return NUDGE_KINDS.includes(matches.at(-1)[1]) ? matches.at(-1)[1] : null;
}

// 只有当天的提醒能触达先生，这样补跑昨天错过的定时任务也只会静默。
export function nudgeContextFor(pact, now = Date.now()) {
  if (!pact) return null;
  const today = pact.today({now});
  const state = today.complete ? 'complete' : (today.progress.minutes > 0 || today.progress.questions > 0 || today.progress.reviewsDone > 0) ? 'partial' : 'not_started';
  return {today, state};
}

export function learningPactPrompt(store) {
  let textValue = '【学习约定】每天早上、晚上和睡前各有一条学习提醒；提醒时只发一条不超过 80 个汉字的短消息，按提醒里的数字说清下一步。';
  try {
    const today = store.today();
    const current = today.streak.current;
    const best = today.streak.best;
    textValue = `【学习约定】今天是 ${today.date}（${today.pact.timezone}）：专注 ${today.progress.minutes}/${today.goals.minutes} 分钟，做题 ${today.progress.questions}/${today.goals.questions} 道，到期复习还剩 ${today.progress.dueReviews} 张；连续 ${current} 天，历史最佳 ${best} 天。`;
    if (today.examCountdownDays != null) textValue += `距离${today.pact.exam.name}还有 ${today.examCountdownDays} 天。`;
    textValue += '收到 [[CLEKK_PACT_NUDGE:...]] 时只发一条不超过 80 个汉字的短消息。';
  } catch { /* 约定暂不可读时仍给最小规则，不影响正常学习对话。 */ }
  return textValue;
}

export function registerLearningPactGateway(api, pact) {
  // 沿用 learning.mjs 里的写法：所有已有的 pinkie.learning.* 都是 operator.admin；
  // 读取类方法按任务书要求单独声明 operator.read。
  const register = (name, handler, scope) => api.registerGatewayMethod(name, async ({params, respond}) => {
    try { respond(true, await handler(params || {})); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)}); }
  }, {scope});
  register('pinkie.learning.pact.get', () => ({pact: pact.get()}), 'operator.read');
  register('pinkie.learning.pact.set', params => pact.set(params.patch), 'operator.admin');
  register('pinkie.learning.today', () => pact.today(), 'operator.read');
  register('pinkie.learning.history', params => ({days: pact.history({days: params.days})}), 'operator.read');
  register('pinkie.learning.focus.start', params => pact.focusStart({minutes: params.minutes}), 'operator.admin');
  register('pinkie.learning.focus.stop', params => {
    const result = pact.focusStop({id: String(params.id || '')});
    if (result.error) throw new Error(result.error);
    return result;
  }, 'operator.admin');
  register('pinkie.learning.focus.status', () => pact.focusStatus(), 'operator.read');
  return pact;
}

export {INTENSITIES, CHANNEL_KINDS, sanitizePact, validDate, validTime, validTimezone, clockInZone, clockLabel};
