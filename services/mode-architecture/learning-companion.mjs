// 碧琪手账 v2 · 陪伴层（briefs/study-desk-v2/PLAN.md §4）：学习节奏、碧琪每天现写一句、剪报、月历、个人纪念日。
// 一律按北京时间。生成只在「当天第一次打开」时触发一次并缓存一天；空闲时没有定时器。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {almanac, beijingDay, beijingHour, addDays, dayDiff, lunar, festivals, holiday, termOn} from './learning-almanac.mjs';
import {deskJustified} from './learning-desk.mjs';

const DAY = 86_400_000;
const clean = (value, limit = 500) => String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const night = h => (h < 5 ? h + 24 : h); // 凌晨算前一天的夜里
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const pickBy = (list, seed) => list[parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) % list.length];
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; return fallback; } }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temp, file);
}

// ---------- 每天一句：模板兜底（每类 6–10 句，按日期轮换）。不数落，不提漏了几天。 ----------
export const TEMPLATES = {
  ordinary: ['先生，今天也只做一件事就好，做完我们再看下一件。', '一小组就够了，先生，做完我给你盖章。', '先生，慢慢来，我在旁边陪着。',
    '今天的那一件，我已经替你挑好了，先生。', '先生，先做，做完再想难不难。', '不用一口气学完，先生，一颗星一颗星地点。', '我们今天把一个考点弄懂就很好了，先生。'],
  comeback: ['欢迎回来，先生。我们从一件小事开始。', '先生回来啦，今天先热热身。', '回来就好，先生，手账一直给你留着。',
    '先生，先做一小组找找手感，别着急。', '欢迎回来，今天轻一点也没关系，先生。', '我把今天那一件挑得简单一点，先生。'],
  term: ['先生，换节气了，今天也照常做一件。', '节气一换，日子就往前走一格，先生也往前走一格。', '先生，今天的手账我贴了新胶带。',
    '先生，天气变了，记得照顾好自己，再做今天那一件。', '换季的日子，我们也换一页新的，先生。', '先生，今天是个新节气，开个好头。'],
  festival: ['先生，节日快乐。想学就做一小组，不想学就好好过节。', '今天过节，先生，开开心心的最重要。', '先生节日快乐，手账今天也贴了节日胶带。',
    '先生，过节也能学一点点，学多少都算数。', '节日快乐，先生。我在手账里给你留了位置。', '先生，今天好好过节，明天我们接着来。'],
  'exam-final': ['先生，最后几天，只做最要紧的那一件。', '先生，稳住节奏，按平时那样来就好。', '先生，这几天早点睡，比多做一题更重要。',
    '最后这几天，先生只要把会的做对。', '先生，翻翻错题就好，不用开新的。', '先生，你已经准备了很久了，我陪你到考场门口。'],
  'exam-eve': ['先生，明天就考了，今晚早点睡。', '明天加油，先生，今晚别熬夜。', '先生，准考证、笔、水都放好了吗？早点睡。',
    '先生，今晚只翻翻错题，然后睡觉。', '明天放轻松，先生，会的都会在。', '先生，我明天在这儿等你回来。'],
  'exam-day': ['先生，考试加油，我等你回来。', '今天放轻松，先生，按平时那样做。', '先生，加油，考完我们一起看。',
    '先生，深呼吸，会的先做。', '今天先生是主角，加油。', '先生，考完记得回来跟我说说。'],
  'exam-milestone': ['先生，又近了一格，按我们的节奏来。', '先生，这一段路走得很稳。', '先生，倒数又翻了一页，今天照常做一件。',
    '先生，离考试近了，我们不慌，一件一件来。', '先生，今天也往考场近了一步。', '先生，我们的节奏没有乱，继续。'],
  'study-milestone': ['先生，我们一起学了好多天了。', '先生，这本手账越来越厚了。', '先生，回头看看，已经走了好远。',
    '先生，今天是个小纪念日，也照常做一件。', '先生，谢谢你每天都来。', '先生，坚持到今天，真的很了不起。'],
  birthday: ['生日快乐，先生！今天想学就学，不想学就好好过生日。', '先生生日快乐，今天手账给你贴满星星。', '生日快乐，先生，新的一岁也一起加油。',
    '先生，生日快乐！今天最重要的是开心。', '生日快乐，先生，我给你留了一个大印章。', '先生，生日快乐，愿望里有考试顺利吗？'],
  anniversary: ['先生，今天是我们一起学习的纪念日。', '先生，谢谢你这一年都在。', '先生，纪念日快乐，手账又翻过了一大本。',
    '先生，一起学了这么久，我很开心。', '先生，今天值得盖一个大章。', '纪念日快乐，先生，我们接着往前走。'],
  late: ['这么晚了，先生，剩下的明天再做，早点睡。', '先生，很晚了，今天到这儿就好。', '先生，睡觉也是备考的一部分，去睡吧。',
    '先生，明天我还在这儿，先去睡。', '已经很晚了，先生，手账我替你合上。', '先生，熬夜记不住的，明天再来。'],
};
const SCOLD = /漏了|偷懒|又没|怎么不|没坚持|落下了|浪费|拖延|懒/;
const DAILY_RULES = `你是碧琪，在先生的备考手账页边写今天的一句话。
输入是今天的日历事实、学习节奏和最近 14 天写过的句子。只输出 JSON：{"line":"…"}。
要求：
- 一句话，口语、温柔、具体，称呼「先生」，不超过 40 个字；不用 emoji。
- 围绕「今天的主角」（protagonist）写：节日就说节日，隔了几天回来就说「回来就好」，考前 7 天要安静、稳，深夜就劝早点睡。
- 绝不数落、绝不提漏了几天、不制造焦虑；节日当天没学习也不提。
- 句子里出现的数字必须来自输入；没把握就不写数字。
- 不要和 recentLines 里的句子重复或太像。`;

const CLIP_RULES = `你在为一位正在备考的成年人（先生：广西专升本、英语 B 级、英语四级，跟着中国的节奏生活）找「剪报」：
全世界范围、最近两周内发布的真实新闻报道或本人分享，主题是普通人靠学习改变处境、零基础逆袭、成年人重新考试或上学、自学考证（专升本、自考、英语等级、电工、计算机等）、各国普通学习者坚持学习的故事。
不要：排名焦虑、「XX 天速成」广告、培训机构软文、名人鸡汤、惨剧、政治争议。
做法：用 web_search 搜（中文和英文都搜），挑 3–4 个候选，用 web_fetch 打开原文，确认发布日期在两周内、内容和标题一致。
最后只输出 JSON：{"clippings":[{"title":"原文标题（保留原文语言）","source":"媒体或网站名","url":"原文链接","publishedAt":"YYYY-MM-DD","summary":"用你自己的话写的中文摘要，不超过 80 字","quote":"原文里的一句话，不超过 15 个字，可以留空","note":"碧琪写在页边的一句话，温柔，称呼先生，不超过 24 字"}]}
最多 2 条。找不到合格的就输出 {"clippings":[]}，绝不编造。`;
const AD = /速成|培训班|报名|优惠|课程推荐|加微信|招生简章|包过|保过/;

export class LearningCompanion {
  constructor(store, {api = null, now = () => Date.now(), requestModel = null, runAgent = null, fetchUrl = null} = {}) {
    this.store = store; this.api = api; this.now = now; this.requestModel = requestModel;
    this.runAgent = runAgent; this.fetchUrl = fetchUrl || defaultFetch;
    this.root = path.join(store.root, 'desk');
    this.jobs = new Map();
  }
  get desk() { return this.store.desk; }
  get pact() { return this.store.pact; }

  // ---------- 个人纪念日（先生答过才有，不猜） ----------
  personalFile() { return path.join(this.store.root, 'pact', 'personal.json'); }
  personal() { const p = readJson(this.personalFile(), {}); return {birthday: /^\d{2}-\d{2}$/.test(p.birthday || '') ? p.birthday : '', since: /^\d{4}-\d{2}-\d{2}$/.test(p.since || '') ? p.since : '', askedAt: Number(p.askedAt) || 0}; }
  setPersonal({birthday, since} = {}) {
    const next = {...this.personal()};
    if (birthday !== undefined) { if (birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday)) throw new Error('生日写成 MM-DD'); next.birthday = birthday || ''; }
    if (since !== undefined) { if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('纪念日写成 YYYY-MM-DD'); next.since = since || ''; }
    next.askedAt = this.now();
    writeJson(this.personalFile(), next);
    return {personal: this.personal()};
  }

  // ---------- 第二层：学习节奏 ----------
  stamps(date) {
    const out = [];
    for (const a of this.desk?.attempts?.() || []) if (beijingDay(a.createdAt) === date) out.push(Number(a.createdAt));
    for (const l of this.store.lessons?.all?.() || []) for (const t of [l.startedAt, l.finishedAt]) if (t && beijingDay(t) === date) out.push(Number(t));
    try {
      const day = this.pact.readDay(date);
      if (day.firstActivityAt) out.push(Number(day.firstActivityAt));
      for (const f of day.focus || []) for (const t of [f.start, f.end]) if (t && beijingDay(t) === date) out.push(Number(t));
    } catch {}
    try { for (const w of this.store.vocab?.read().words || []) if (w.lastReviewedAt && beijingDay(w.lastReviewedAt) === date) out.push(Number(w.lastReviewedAt)); } catch {}
    return out.filter(Number.isFinite).sort((a, b) => a - b);
  }
  // 凌晨 5 点前的学习算前一天的夜里。
  studyDayOf(instant) { const h = beijingHour(instant); return h < 5 ? beijingDay(instant - DAY) : beijingDay(instant); }
  rhythm(now = this.now()) {
    const today = this.studyDayOf(now), starts = [], ends = [], active = [];
    for (let n = 1; n <= 14; n++) {
      const date = addDays(today, -n);
      const stamps = [...this.stamps(date), ...this.stamps(addDays(date, 1))].filter(t => this.studyDayOf(t) === date);
      if (!stamps.length) continue;
      active.push(date); starts.push(night(beijingHour(stamps[0]))); ends.push(night(beijingHour(stamps.at(-1))));
    }
    const todayStamps = [...this.stamps(today), ...this.stamps(addDays(today, 1))].filter(t => this.studyDayOf(t) === today);
    const usualStart = starts.length >= 3 ? round(median(starts)) : null, usualEnd = ends.length >= 3 ? round(median(ends)) : null;
    const lateAfter = usualEnd != null ? round(Math.min(26, Math.max(23.5, usualEnd + 1))) : 24.5;
    let lastAt = 0;
    for (const a of this.desk?.attempts?.() || []) lastAt = Math.max(lastAt, Number(a.createdAt) || 0);
    for (const l of this.store.lessons?.all?.() || []) lastAt = Math.max(lastAt, Number(l.finishedAt) || 0);
    const gapDays = lastAt ? Math.max(0, dayDiff(this.studyDayOf(lastAt), today)) : 0;
    let streak = {current: 0, best: 0};
    try { streak = this.pact.streak({now}); } catch {}
    const ledger = (() => { try { return this.pact.readDay(beijingDay(now)); } catch { return null; } })();
    const hour = night(beijingHour(now));
    return {date: today, activeDays: active.length, usualStart, usualEnd, lateAfter, gapDays, comeback: gapDays >= 3 && !todayStamps.length,
      studiedToday: todayStamps.length > 0, startedAt: todayStamps[0] || 0, lateStart: !todayStamps.length && usualStart != null && hour > usualStart + 2,
      streak, yesterdayWin: this.yesterdayWin(addDays(today, -1)),
      today: ledger ? {minutes: ledger.minutes, answered: ledger.questions.answered, correct: ledger.questions.correct, reviews: ledger.reviews.done} : null};
  }
  rhythmHint(now = this.now()) { try { const r = this.rhythm(now); return {lateAfter: r.lateAfter}; } catch { return {}; } }
  // 昨天的小胜利：从账本里挑一件真的。
  yesterdayWin(date) {
    try {
      const items = this.desk?.items?.() || [];
      const lit = items.filter(item => item.evidence?.firstLitAt && this.studyDayOf(item.evidence.firstLitAt) === date);
      if (lit.length) return {kind: 'lit', count: lit.length, text: lit[0].text, ref: `point:${lit[0].k}.${lit[0].i}`};
      const attempts = (this.desk?.attempts?.() || []).filter(a => typeof a.result?.correct === 'boolean' && this.studyDayOf(a.createdAt) === date).sort((a, b) => a.createdAt - b.createdAt);
      let run = 0, best = 0; for (const a of attempts) { run = a.result.correct ? run + 1 : 0; best = Math.max(best, run); }
      if (best >= 3) return {kind: 'run', count: best};
      const words = (this.store.vocab?.read().words || []).filter(w => w.lastReviewedAt && this.studyDayOf(w.lastReviewedAt) === date).length;
      if (words >= 3) return {kind: 'words', count: words};
      if (attempts.length) return {kind: 'answered', count: attempts.length};
    } catch {}
    return null;
  }
  facts(now = this.now()) {
    const pact = this.pact.get(), rhythm = this.rhythm(now);
    const studyDay = Math.max(1, dayDiff(beijingDay(pact.createdAt || now), beijingDay(now)) + 1);
    const alm = almanac(now, {exams: pact.exams || [], rhythm: {gapDays: rhythm.gapDays, studiedToday: rhythm.studiedToday, studyDay, lateAfter: rhythm.lateAfter}, personal: this.personal()});
    return {alm, rhythm, studyDay};
  }

  // ---------- 第三层：碧琪每天现写一句 ----------
  dailyFile(date) { return path.join(this.root, 'daily', `${date}.json`); }
  template(kind, date) { return pickBy(TEMPLATES[kind] || TEMPLATES.ordinary, `${kind}:${date}`); }
  async daily({wait = false} = {}) {
    const now = this.now(), {alm, rhythm, studyDay} = this.facts(now), date = alm.date, hero = alm.protagonist;
    const kind = hero.late ? 'late' : hero.id;
    const cached = readJson(this.dailyFile(date), null);
    // 深夜单独一句（劝睡），不覆盖白天写好的那句。
    if (hero.late) return {date, line: {text: this.template('late', date), source: 'template', kind: 'late'}, rhythm, protagonist: hero};
    if (cached?.line?.text) return {date, line: cached.line, rhythm, protagonist: hero};
    const fallback = {text: this.template(kind, date), source: 'template', kind};
    if (!this.requestModel) return {date, line: fallback, rhythm, protagonist: hero};
    if (!this.jobs.has(date)) {
      writeJson(this.dailyFile(date), {date, startedAt: now, line: null}); // 先落凭据：一天只调一次
      this.jobs.set(date, this.writeDaily(date, alm, rhythm, studyDay, kind, fallback).finally(() => this.jobs.delete(date)));
    }
    if (!wait) return {date, line: {...fallback, pending: true}, rhythm, protagonist: hero};
    return {date, line: await this.jobs.get(date), rhythm, protagonist: hero};
  }
  recentLines(date) {
    const out = [];
    for (let n = 1; n <= 14; n++) { const line = readJson(this.dailyFile(addDays(date, -n)), null)?.line?.text; if (line) out.push(line); }
    return out;
  }
  async writeDaily(date, alm, rhythm, studyDay, kind, fallback) {
    const hero = alm.protagonist;
    const exams = alm.exams.filter(exam => Number.isFinite(exam.daysLeft) && exam.daysLeft >= 0).map(exam => ({name: exam.name, daysLeft: exam.daysLeft, phase: exam.phase}));
    const input = {date, weekday: '日一二三四五六'[alm.weekday], period: alm.period.label, lunar: alm.lunar.monthName + alm.lunar.dayName,
      term: alm.term?.name || '', festivals: alm.festivals.map(f => f.name), protagonist: {id: hero.id, greeting: hero.greeting, quiet: hero.quiet},
      exams, studyDay, rhythm: {streak: rhythm.streak.current, comeback: rhythm.comeback, yesterdayWin: rhythm.yesterdayWin ? {kind: rhythm.yesterdayWin.kind, count: rhythm.yesterdayWin.count, text: rhythm.yesterdayWin.text || ''} : null,
        usualStart: rhythm.usualStart}, recentLines: this.recentLines(date)};
    let line = fallback;
    try {
      const response = await this.requestModel(DAILY_RULES, input, {timeoutMs: 25_000, maxTokens: 300, temperature: 0.7});
      const text = clean(response?.value?.line, 80);
      // 数字校验沿用看板的 justified()：句子里的数字必须来自输入。
      const values = {studyDay, streak: rhythm.streak.current, best: rhythm.streak.best, count: rhythm.yesterdayWin?.count ?? -1, lit: rhythm.yesterdayWin?.kind === 'lit' ? rhythm.yesterdayWin.count : -1};
      exams.forEach((exam, i) => { values['exam' + i] = exam.daysLeft; });
      const rows = [{id: 'F1', values}, {id: 'D1', values: {date}}];
      const recent = input.recentLines;
      if (text && text.length <= 48 && text.includes('先生') && !SCOLD.test(text) && !/[\u{1F300}-\u{1FAFF}]/u.test(text) && !recent.includes(text) && deskJustified(text, rows))
        line = {text, source: 'model', kind, model: response.model?.name || response.model?.ref || ''};
    } catch {}
    writeJson(this.dailyFile(date), {date, at: this.now(), line});
    return line;
  }

  // ---------- 剪报（§4.6）：隔离会话联网找，核实原文链接能打开、两周内发布 ----------
  clipFile(date) { return path.join(this.root, 'clippings', `${date}.json`); }
  savedFile() { return path.join(this.root, 'clippings', 'saved.json'); }
  saved() { return readJson(this.savedFile(), {clips: []}).clips || []; }
  save({clip} = {}) {
    if (!clip?.url || !/^https?:\/\//.test(clip.url)) throw new Error('剪报缺原文链接');
    const clips = this.saved().filter(item => item.url !== clip.url);
    const kept = {title: clean(clip.title, 200), source: clean(clip.source, 80), url: clean(clip.url, 600), publishedAt: clean(clip.publishedAt, 10),
      summary: clean(clip.summary, 200), quote: clean(clip.quote, 30), note: clean(clip.note, 60), savedAt: this.now()};
    writeJson(this.savedFile(), {clips: [kept, ...clips].slice(0, 300)});
    return {ok: true, clips: this.saved()};
  }
  unsave({url} = {}) { writeJson(this.savedFile(), {clips: this.saved().filter(item => item.url !== url)}); return {ok: true, clips: this.saved()}; }
  async clippings({wait = false, force = false} = {}) {
    const now = this.now(), {alm} = this.facts(now), date = alm.date, hero = alm.protagonist;
    // 考前 7 天、深夜都不贴剪报。
    if (hero.late || ['exam-day', 'exam-eve', 'exam-final'].includes(hero.id)) return {date, hidden: true, reason: hero.late ? 'late' : 'quiet', clippings: []};
    const cached = readJson(this.clipFile(date), null);
    if (cached?.status && cached.status !== 'running' && !force) return {date, status: cached.status, clippings: cached.clippings || [], small: hero.id === 'festival'};
    if (!this.runAgent) return {date, status: 'unavailable', clippings: []};
    const running = cached?.status === 'running' && now - (cached.startedAt || 0) < 10 * 60_000;
    if (!this.jobs.has('clip:' + date) && (!running || force)) {
      writeJson(this.clipFile(date), {date, status: 'running', startedAt: now, clippings: []});
      this.jobs.set('clip:' + date, this.findClippings(date).finally(() => this.jobs.delete('clip:' + date)));
    }
    const job = this.jobs.get('clip:' + date);
    if (!wait || !job) return {date, status: 'running', clippings: []};
    const result = await job;
    return {date, status: result.status, clippings: result.clippings, small: hero.id === 'festival'};
  }
  async findClippings(date) {
    let result = {date, status: 'none', clippings: [], at: this.now()};
    try {
      const output = await this.runAgent(`${CLIP_RULES}\n\n今天是北京时间 ${date}。只要 ${addDays(date, -14)} 到 ${date} 之间发布的。`);
      const parsed = parseJsonLoose(output);
      const candidates = Array.isArray(parsed?.clippings) ? parsed.clippings.slice(0, 6) : [];
      const kept = [];
      for (const raw of candidates) {
        const clip = {title: clean(raw.title, 200), source: clean(raw.source, 80), url: clean(raw.url, 600), publishedAt: clean(raw.publishedAt, 10),
          summary: clean(raw.summary, 160), quote: clean(raw.quote, 30), note: clean(raw.note, 48)};
        if (!/^https?:\/\//.test(clip.url) || !clip.title || !clip.summary || !/^\d{4}-\d{2}-\d{2}$/.test(clip.publishedAt)) continue;
        const age = dayDiff(clip.publishedAt, date);
        if (age < 0 || age > 14) continue;
        if (AD.test(clip.title + clip.summary)) continue;
        if ([...clip.quote].length > 15) clip.quote = '';
        if (!clip.note.includes('先生')) clip.note = '';
        if (!(await this.fetchUrl(clip.url))) continue; // 原文打不开就丢掉
        kept.push(clip);
        if (kept.length >= 2) break;
      }
      result = {date, status: kept.length ? 'ok' : 'none', clippings: kept, at: this.now()};
    } catch (error) { result = {date, status: 'failed', clippings: [], at: this.now(), error: clean(error.message, 200)}; }
    writeJson(this.clipFile(date), result);
    return result;
  }

  // ---------- 月历（看板「本月」） ----------
  month({month} = {}) {
    const now = this.now(), today = beijingDay(now);
    const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : today.slice(0, 7);
    const first = ym + '-01', days = [];
    const pact = this.pact.get(), personal = this.personal();
    const items = this.desk?.items?.() || [];
    const litDates = items.map(item => item.evidence?.firstLitAt).filter(Boolean).sort((a, b) => a - b).map(t => this.studyDayOf(t));
    const milestones = new Map();
    for (const n of [10, 25, 50, 100, 144]) if (litDates[n - 1]) milestones.set(litDates[n - 1], `点亮第 ${n} 个`);
    const created = beijingDay(pact.createdAt || now);
    for (const n of [30, 100, 200, 365]) milestones.set(addDays(created, n - 1), `备考第 ${n} 天`);
    const counts = new Map();
    for (const a of this.desk?.attempts?.() || []) if (typeof a.result?.correct === 'boolean') { const d = this.studyDayOf(a.createdAt); const c = counts.get(d) || {answered: 0, correct: 0}; c.answered++; if (a.result.correct) c.correct++; counts.set(d, c); }
    for (let date = first; date.startsWith(ym); date = addDays(date, 1)) {
      let ledger = null; try { ledger = this.pact.readDay(date); } catch {}
      const c = counts.get(date) || {answered: 0, correct: 0};
      const lit = litDates.filter(d => d === date).length;
      const studied = Boolean(ledger && (ledger.minutes || ledger.questions.answered || ledger.reviews.done || ledger.lessons)) || c.answered > 0;
      const l = lunar(date), term = termOn(date), fest = festivals(date), hol = holiday(date);
      days.push({date, day: Number(date.slice(8)), weekday: new Date(date + 'T00:00:00Z').getUTCDay(), today: date === today, future: date > today,
        lunar: l.label, term: term?.name || '', festivals: fest.filter(f => f.kind !== 'term' || !term).map(f => f.name), off: hol.off ? hol.name : '', workday: hol.workday,
        exams: (pact.exams || []).filter(exam => exam.date === date).map(exam => exam.name), milestone: milestones.get(date) || '',
        birthday: personal.birthday && personal.birthday === date.slice(5), anniversary: Boolean(personal.since && personal.since.slice(5) === date.slice(5) && personal.since < date),
        studied, minutes: ledger?.minutes || 0, answered: Math.max(c.answered, ledger?.questions?.answered || 0), lit,
        stars: !studied ? 0 : lit >= 2 || c.correct >= 8 ? 3 : lit >= 1 || c.correct >= 3 ? 2 : 1});
    }
    const prev = addDays(first, -1).slice(0, 7), next = addDays(first, 32).slice(0, 7);
    return {month: ym, today, prev, next, days, studiedDays: days.filter(d => d.studied).length, personal};
  }
}

function parseJsonLoose(text) {
  const raw = String(text || '');
  for (const candidate of [raw, raw.replace(/^[\s\S]*?```(?:json)?\s*([\s\S]*?)\s*```[\s\S]*$/i, '$1'), raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    try { const value = JSON.parse(candidate.trim()); if (value && typeof value === 'object') return value; } catch {}
  }
  return null;
}
async function defaultFetch(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {redirect: 'follow', signal: controller.signal, headers: {'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'}});
    try { await response.body?.cancel?.(); } catch {}
    return response.status >= 200 && response.status < 400;
  } catch { return false; } finally { clearTimeout(timer); }
}

// 隔离会话跑一轮联网检索：不进先生的聊天记录，只开 web_search / web_fetch。
export function embeddedClippingAgent(api) {
  if (typeof api?.runtime?.agent?.runEmbeddedAgent !== 'function') return null;
  return async prompt => {
    const config = api.runtime?.config?.current?.() || api.config || {};
    const agent = (config.agents?.list || []).find(item => item.id === 'learning') || {};
    const selected = agent.model ?? config.agents?.defaults?.model;
    const ref = String(typeof selected === 'string' ? selected : selected?.primary || '');
    const [provider, ...rest] = ref.split('/');
    const id = randomUUID(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-clippings-'));
    try {
      const result = await api.runtime.agent.runEmbeddedAgent({
        sessionId: `pinkie-desk-clippings-${id}`, sessionKey: `agent:learning:internal-session-effects:desk-clippings-${id}`,
        sessionFile: path.join(temp, 'clippings.json'), workspaceDir: agent.workspace || temp, config, prompt, timeoutMs: 240_000,
        runId: `pinkie-desk-clippings-${id}`, ...(provider && rest.length ? {provider, model: rest.join('/')} : {}), agentId: 'learning',
        toolsAllow: ['web_search', 'web_fetch'], disableMessageTool: true, lane: 'subagent',
      });
      return (result?.payloads || []).filter(part => !part?.isError && !part?.isReasoning && typeof part?.text === 'string').map(part => part.text).join('\n');
    } finally { fs.rmSync(temp, {recursive: true, force: true}); }
  };
}

function register(api, name, handler, scope = 'operator.admin') {
  api.registerGatewayMethod(name, async ({params, respond}) => {
    try { respond(true, await handler(params || {})); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)}); }
  }, {scope});
}
export function registerLearningCompanion(api, store, options = {}) {
  const companion = new LearningCompanion(store, {api, runAgent: embeddedClippingAgent(api), ...options});
  const guard = params => store.assertLearningSession(String(params.sessionKey || ''));
  register(api, 'pinkie.learning.desk.companion', async params => { guard(params); return companion.daily({wait: params.wait === true}); });
  register(api, 'pinkie.learning.desk.clippings', async params => { guard(params); return companion.clippings({wait: params.wait === true}); });
  register(api, 'pinkie.learning.desk.clippings.saved', params => { guard(params); return {clips: companion.saved()}; }, 'operator.read');
  register(api, 'pinkie.learning.desk.clippings.save', params => { guard(params); return companion.save(params); });
  register(api, 'pinkie.learning.desk.clippings.unsave', params => { guard(params); return companion.unsave(params); });
  register(api, 'pinkie.learning.desk.month', params => { guard(params); return companion.month(params); }, 'operator.read');
  register(api, 'pinkie.learning.desk.personal', params => { guard(params); return params.set ? companion.setPersonal(params.set) : {personal: companion.personal()}; });
  return companion;
}
