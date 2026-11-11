// 碧琪上岸记：学习台里的真考场 + Boss 巴别兽。
// 整卷按 PRETCO_B_FORMAT 由内置模型分部分生成；答案和评分细则只存在服务端的卷子文件里，exam.start 返回的卷子一律不带。
// 客观题代码判；翻译段落和写作模型按细则判（给分 + 理由）；Boss 血量 = 最近 3 次加权预估分离稳过线还差多少。
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as E from './learning-game-economy.mjs';
import {PRETCO_B_FORMAT, fold, modelJson, validChoice, localLine, LINE_RULES, validLine, blindSolve, pool, EXPLAIN_RULES, validExplain, explainInput} from './learning-game-content.mjs';
import {GAME_EXAM, EXAM_DATES, beijingDate, daysBetween, mondayOf} from './learning-game.mjs';
import {RealPapers, REAL_VERSION} from './learning-game-real.mjs';

const clean = (v, n = 2000) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const PART_RULES = `你是高等学校英语应用能力考试 B 级的命题老师。输入 {"section":这一部分的官方题型,"seed":随机种子,"learner":先生的薄弱考点}。
按题型出这一部分的全部题目，难度对标 B 级真题（词汇约 2500 以内、句子简单、话题贴近日常和职场）。四选一题答案唯一、干扰项是常见错误。
只输出 JSON：{"parts":[{"id":"题型 id（和输入一致）","material":"本题组共用的材料（听力原文 / 阅读短文 / 实用文 / 术语表；没有就空字符串）","items":[ITEM]}]}
ITEM 按题型：
- listen-response / listen-dialogue：{"tts":"要朗读的英文原文（问句或两人对话，用 W:/M: 标说话人）","stem":"可选，问题","options":[4个英文选项],"answer":0-3}
- listen-dictation：material 写完整短文；每个 item {"stem":"含 ____ 的那一句","answer":["标准答案","可接受的写法"]}（每空 1–3 词）
- choice / passage-choice / translate-choice：{"stem":"","options":["","","",""],"answer":0-3}
- word-form：{"stem":"含 ____ 的句子","base":"括号里的原词","answer":["正确形式"]}
- passage-short / practical-fill：{"stem":"问题或待填的表格项","answer":["≤3 词的答案","可接受的写法"]}
- term-match：material 写 10 个英文术语（A–J，每行一个）；每个 item {"stem":"中文意思","answer":"A-J 中的一个字母"}
- translate-passage：{"stem":"要翻译的英文实用文字（60–90 词）","reference":"参考译文","rubric":"意思准确 8 分 + 通顺 4 分的评分要点"}
- writing：{"stem":"中文写作提示（应用文，写清要点）","reference":"范文（80–100 词）","rubric":"五档评分要点和必备格式"}
题量必须和输入的 count 完全一致。`;

// 盲做发现一道选择题可能不止一个对的选项：只改这一道
export const FIX_ITEM_RULES = `你是 B 级命题老师。输入一道四选一题 {"material","tts","stem","options","answer","solver"}：另一位老师盲做时选了 solver（或认为不止一个选项都对）。
改写这道题——可以改选项、题干，听力题可以改原文 tts——让只有 answer 下标对应的那个选项正确，其它三个明显不对；难度、话题和题型不变。
只输出 JSON：{"tts":"听力题才写","stem":"","options":["","","",""],"answer":0-3}`;
const choiceContext = (p, it) => (p.material && !p.kind.startsWith('listen') ? `${p.material.slice(0, 1500)}\n\n${it.stem}` : (it.tts ? `${it.tts}\n${it.stem || ''}` : it.stem));

export const GRADE_RULES = `你是 B 级阅卷老师。输入 {"kind":"translate-passage|writing","task":题目,"reference":参考答案,"rubric":评分细则,"max":满分,"answer":考生作答}。
严格按细则给分：空白或只抄题目 0 分；跑题最多给满分的三分之一；写作格式要件（称呼 / 落款 / 日期）缺失要扣分。
只输出 JSON：{"score":整数（0..max）,"reason":"一两句中文理由，指出主要得失"}`;

function validItem(kind, it) {
  if (!it || typeof it !== 'object') return null;
  if (['listen-response', 'listen-dialogue'].includes(kind)) {
    const c = validChoice({stem: it.stem || '(听录音选答案)', options: it.options, answer: it.answer});
    const tts = clean(it.tts, 800);
    return c && tts ? {...c, tts} : null;
  }
  if (['choice', 'passage-choice', 'translate-choice'].includes(kind)) return validChoice(it);
  const stem = clean(it.stem, 1500);
  if (!stem) return null;
  if (['listen-dictation', 'word-form', 'passage-short', 'practical-fill'].includes(kind)) {
    const answer = (Array.isArray(it.answer) ? it.answer : [it.answer]).map(a => clean(a, 60)).filter(Boolean);
    if (!answer.length || answer[0].split(/\s+/).length > (kind === 'word-form' ? 3 : 4)) return null;
    return {stem, answer, ...(it.base ? {base: clean(it.base, 30)} : {})};
  }
  if (kind === 'term-match') {
    const a = clean(it.answer, 2).toUpperCase();
    return /^[A-J]$/.test(a) ? {stem, answer: a} : null;
  }
  if (['translate-passage', 'writing'].includes(kind)) {
    const reference = clean(it.reference, 2000);
    const rubric = clean(it.rubric, 1200);
    return reference && rubric ? {stem, reference, rubric} : null;
  }
  return null;
}

export function validSection(section, v) {
  const parts = Array.isArray(v?.parts) ? v.parts : [];
  const out = [];
  for (const spec of section.parts) {
    const p = parts.find(x => String(x?.id) === spec.id) || (section.parts.length === 1 ? parts[0] : null);
    if (!p) return null;
    const items = (Array.isArray(p.items) ? p.items : []).map(it => validItem(spec.kind, it));
    if (items.length < spec.count || items.slice(0, spec.count).some(x => !x)) return null;
    const material = clean(p.material, 4000);
    if (['listen-dictation', 'term-match', 'passage-choice', 'passage-short', 'practical-fill'].includes(spec.kind) && !material) return null;
    out.push({id: spec.id, kind: spec.kind, note: spec.note, each: spec.each, material, items: items.slice(0, spec.count)});
  }
  return out;
}

// 卷子 → 给前端的公开版（绝不带 answer / reference / rubric / why）
// 真题卷（kind real / mock）：听力放原录音（start 里给 audio），不带 tts；听写短文是印在卷上的，照常给 material；录音原文（script）永远不给。
export function publicPaper(full) {
  const real = ['real', 'mock'].includes(full.kind);
  const shown = p => (p.kind.startsWith('listen') ? real && p.kind === 'listen-dictation' : true);
  return {kind: real ? full.kind : 'sim', sections: full.sections.map(sec => ({id: sec.id, title: sec.title, timeMin: sec.timeMin, instructions: sec.instructions,
    parts: sec.parts.map(p => ({id: p.id, kind: p.kind, note: p.note || ''})),
    items: sec.parts.flatMap(p => p.items.map((it, i) => ({
      id: `${sec.id}-${p.id}-${i + 1}`, kind: p.kind, part: p.id, points: p.each, ...(real && it.no ? {no: it.no} : {}), ...(i === 0 && p.material ? {material: shown(p) ? p.material : ''} : {}),
      prompt: it.stem, ...(it.options ? {options: it.options} : {}), ...(it.base ? {base: it.base} : {}),
      ...(!real && it.tts ? {tts: {text: it.tts, voiceHint: 'en-US'}} : {}),
      ...(!real && p.kind === 'listen-dictation' && i === 0 ? {tts: {text: p.material, voiceHint: 'en-US', repeat: 3}} : {}),
    })))}))};
}

function keyText(kind, item) {
  if (item.options) return clean(item.options[item.answer], 300);
  if (kind === 'term-match') return clean(item.answer, 8);
  if (Array.isArray(item.answer)) return clean(item.answer[0], 200);
  if (item.reference) return clean(item.reference, 400);
  return clean(item.answer, 200);
}
function givenText(kind, item, given) {
  if (given == null || given === '') return '';
  if (item.options) { const n = Number(given); return Number.isInteger(n) && item.options[n] ? clean(item.options[n], 300) : ''; }
  if (kind === 'term-match') return clean(String(given).toUpperCase(), 8);
  return clean(given, 200);
}

export function gradeObjective(kind, item, answer) {
  if (answer == null || answer === '') return false;
  if (item.options) return Number(answer) === item.answer || (Array.isArray(item.alt) && item.alt.includes(Number(answer)));
  if (kind === 'term-match') return String(answer).trim().toUpperCase() === item.answer;
  const a = fold(answer);
  return item.answer.some(x => fold(x) === a);
}

export class GameExam {
  constructor(game) {
    this.game = game;
    this.jobs = new Map();
    this.grading = new Map();
    game.modules.exam = this;
    this.audioTokens = new Map();
    this.real = new RealPapers(this, {materials: game.store?.materials || null, requestModel: game.requestModel, now: () => this.now(), dataRoot: game.store?.materials?.root || null});
    // 插着 U 盘（App 开着）就备真题：每分钟看一眼，盘挂上 / 有没备好的卷就跑一轮。测试里不开（没有模型）。
    if (game.requestModel && game.autoReal !== false) {
      this.realTimer = setInterval(() => this.realTick(), 60000);
      this.realTimer.unref?.();
      setTimeout(() => this.realTick(), 15000).unref?.();
    }
  }
  realTick() {
    try {
      const base = this.real.usbBase();
      const was = this.real.status.mounted;
      this.real.status.mounted = Boolean(base);
      if (!base || this.real.job) return;
      // 刚插上，或上一轮之后过了 30 分钟还有没备好的（失败的卷重试）
      if (!was || this.now() - (this.real.status.at || 0) > 30 * 60000) this.real.sync().then(() => this.keepSpare()).catch(() => {});
    } catch { /* 游戏层出错不影响学习 */ }
  }
  realReady(paperId) {
    const p = this.ensure(this.game.read()).papers[paperId];
    return Boolean(p && p.status === 'ready' && p.version === REAL_VERSION && this.readFull(paperId));
  }
  installReal(full) {
    this.writeFull(full);
    const items = full.sections.reduce((n, s) => n + s.parts.reduce((m, p) => m + p.items.length, 0), 0);
    this.game.mutate(state => {
      const ex = this.ensure(state);
      const old = ex.papers[full.paperId];
      ex.papers[full.paperId] = {paperId: full.paperId, exam: full.exam, kind: full.kind, year: full.year, month: full.month, title: full.title, createdAt: old?.createdAt || full.createdAt, status: 'ready', version: full.version, audio: Boolean(full.audio), items, total: full.check?.total ?? null, flags: (full.flags || []).length};
    });
  }
  // 原录音：每次开考发一个只在本进程有效的随机 key（2 小时），HTTP 路由凭 key 给文件。
  audioFor(full) {
    if (!full?.audio) return null;
    const file = path.join(this.real.audioRoot(), full.audio);
    if (!file.startsWith(this.real.audioRoot() + path.sep) || !fs.existsSync(file)) return null;
    const now = this.now();
    for (const [k, v] of this.audioTokens) if (v.exp < now) this.audioTokens.delete(k);
    const key = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    this.audioTokens.set(key, {file, exp: now + 2 * 3600000});
    return {url: `/pinkie-exam-audio/${encodeURIComponent(full.paperId)}?key=${key}`, name: path.basename(file)};
  }
  audioFile(paperId, key) {
    const t = this.audioTokens.get(String(key || ''));
    if (!t || t.exp < this.now() || !t.file.includes(path.sep)) return null;
    const full = this.readFull(String(paperId || ''));
    return full?.audio && t.file === path.join(this.real.audioRoot(), full.audio) ? t.file : null;
  }
  get economy() { return this.game.economy; }
  now() { return this.game.now(); }
  dir() { return path.join(this.game.root, 'papers'); }
  ensure(state) { state.exam ||= {papers: {}, attempts: {}, scores: [], real: {}, bossDone: {}}; return state.exam; }
  readFull(paperId) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir(), `${paperId.replace(/[^\w-]/g, '')}.json`), 'utf8')); } catch { return null; }
  }
  writeFull(paper) {
    fs.mkdirSync(this.dir(), {recursive: true, mode: 0o700});
    const file = path.join(this.dir(), `${paper.paperId}.json`);
    const tmp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(paper), {mode: 0o600});
    fs.renameSync(tmp, file);
  }

  papers({exam = GAME_EXAM} = {}) {
    const ex = this.ensure(this.game.read());
    const tries = id => Object.values(ex.attempts).filter(a => a.paperId === id);
    const best = id => { const s = tries(id).map(a => a.result?.score).filter(Number.isFinite); return s.length ? Math.max(...s) : null; };
    const isReal = p => ['real', 'mock'].includes(p.kind);
    const list = Object.values(ex.papers).filter(p => p.exam === exam && !isReal(p)).sort((a, b) => b.createdAt - a.createdAt)
      .map(p => ({paperId: p.paperId, title: p.title, createdAt: p.createdAt, status: p.status, attempts: tries(p.paperId).length, best: best(p.paperId)}));
    const real = Object.values(ex.papers).filter(p => p.exam === exam && isReal(p) && p.status === 'ready')
      .sort((a, b) => (a.kind === b.kind ? (b.year * 100 + b.month) - (a.year * 100 + a.month) || a.paperId.localeCompare(b.paperId) : a.kind === 'real' ? -1 : 1))
      .map(p => ({paperId: p.paperId, kind: p.kind, year: p.year, month: p.month, title: p.title, audio: Boolean(p.audio) && Boolean(this.audioPresent(p.paperId)), items: p.items, attempts: tries(p.paperId).length, best: best(p.paperId), open: tries(p.paperId).some(a => !a.submittedAt)}));
    this.keepSpare(exam);
    this.realTick();
    for (const [id] of this.jobs) if (!list.some(p => p.paperId === id)) list.unshift({paperId: id, title: '碧琪正在出卷…', createdAt: this.now(), status: 'generating', attempts: 0});
    const st = this.real.status;
    const found = Math.max(st.found || 0, this.real.readManifest().sets.length);
    return {papers: list, real, realStatus: {found, ready: real.length, state: st.state, preparing: st.preparing, mounted: Boolean(st.mounted), failed: (st.failed || []).length}, format: PRETCO_B_FORMAT};
  }
  audioPresent(paperId) {
    const full = this.readFull(paperId);
    return full?.audio ? fs.existsSync(path.join(this.real.audioRoot(), full.audio)) : false;
  }
  // 后端预备 3 份没做过的仿真卷（一次只出一份；考前一周安静期只留 1 份；U 盘拆真题时先让真题）
  keepSpare(exam = GAME_EXAM) {
    if (!this.game.requestModel || this.jobs.size || this.real?.job) return;
    const ex = this.ensure(this.game.read());
    const fresh = Object.values(ex.papers).filter(p => p.exam === exam && !['real', 'mock'].includes(p.kind) && p.status === 'ready' && !Object.values(ex.attempts).some(a => a.paperId === p.paperId));
    const quiet = daysBetween(beijingDate(this.now()), EXAM_DATES[exam]) <= 7;
    if (fresh.length < (quiet ? 1 : 3)) this.kick(exam);
  }
  generate({exam = GAME_EXAM, requestId} = {}) {
    if (!requestId) throw new Error('缺少 requestId');
    const done = this.game.read().requests[`exam.generate:${requestId}`];
    if (done) return done.result;
    const paperId = this.kick(exam);
    return this.game.once('exam.generate', requestId, () => ({paperId, status: 'generating'}));
  }
  kick(exam) {
    const paperId = `paper-${beijingDate(this.now())}-${randomUUID().slice(0, 6)}`;
    const weak = Object.values(this.game.read().monsters?.list || {}).filter(m => m.state !== 'captured').slice(0, 20).map(m => m.topic).filter(Boolean);
    const job = (async () => {
      const sections = await Promise.all(PRETCO_B_FORMAT.sections.map(async sec => {
        const r = await modelJson(this.game.requestModel, PART_RULES, {section: sec, seed: `${paperId}-${sec.id}`, learner: {weak}}, {validate: v => validSection(sec, v), timeoutMs: 150000, maxTokens: 9000, retries: 2});
        return r ? {id: sec.id, title: sec.title, timeMin: sec.timeMin, points: sec.points, instructions: sec.parts.map(p => p.note).join('；'), parts: r.value} : null;
      }));
      if (sections.some(s => !s)) {
        this.game.mutate(state => { this.ensure(state).papers[paperId] = {paperId, exam, title: '出卷失败', createdAt: this.now(), status: 'failed'}; });
        return;
      }
      const full = {paperId, exam, createdAt: this.now(), sections};
      full.verify = await this.verifyPaper(full).catch(() => null);
      this.writeFull(full);
      this.game.mutate(state => { this.ensure(state).papers[paperId] = {paperId, exam, title: `B 级仿真卷 · ${beijingDate(this.now()).slice(5)}`, createdAt: this.now(), status: 'ready'}; });
    })().catch(() => {}).finally(() => { this.jobs.delete(paperId); setTimeout(() => { try { this.keepSpare(exam); } catch { /* ignore */ } }, 5000).unref?.(); });
    this.jobs.set(paperId, job);
    return paperId;
  }

  // 出卷后逐题盲做所有选择题（4 路并发）：对不上的改写一次再盲做；还不行就把盲做选的那个也算对（item.alt，只在服务端）。
  async verifyPaper(full) {
    const rm = this.game.requestModel;
    const out = {checked: 0, unique: 0, fixed: 0, ambiguous: 0, unknown: 0};
    if (!rm) return out;
    const jobs = [];
    for (const sec of full.sections) for (const p of sec.parts) for (const it of p.items) if (it.options) jobs.push({p, it});
    await pool(jobs, 4, async ({p, it}) => {
      const solved = await blindSolve(rm, {stem: choiceContext(p, it), options: it.options});
      out.checked += 1;
      if (!solved) { out.unknown += 1; return; }
      if (solved.unique && solved.answer === it.answer) { out.unique += 1; return; }
      const listen = p.kind.startsWith('listen');
      const r = await modelJson(rm, FIX_ITEM_RULES, {material: listen ? '' : String(p.material || '').slice(0, 1500), tts: it.tts || '', stem: it.stem || '', options: it.options, answer: it.answer, solver: solved.answer}, {
        retries: 1, timeoutMs: 60000, maxTokens: 1200,
        validate: v => { const c = validChoice({stem: v?.stem || it.stem || '(听录音选答案)', options: v?.options, answer: v?.answer}); return c ? {...c, stem: v?.stem ? c.stem : it.stem, tts: listen && v?.tts ? String(v.tts).slice(0, 1200) : it.tts} : null; },
      });
      if (r) {
        const cand = {...it, stem: r.value.stem, options: r.value.options, answer: r.value.answer, ...(r.value.tts ? {tts: r.value.tts} : {})};
        const again = await blindSolve(rm, {stem: choiceContext(p, cand), options: cand.options});
        if (again?.unique && again.answer === cand.answer) {
          Object.assign(it, {stem: cand.stem, options: cand.options, answer: cand.answer, why: '', ...(cand.tts ? {tts: cand.tts} : {})});
          out.fixed += 1;
          return;
        }
      }
      if (solved.answer !== it.answer) it.alt = [solved.answer];
      out.ambiguous += 1;
    });
    return out;
  }

  start({paperId, requestId} = {}) {
    if (!requestId) throw new Error('缺少 requestId');
    const full = this.readFull(clean(paperId, 80));
    if (!full) throw new Error('这份卷子还没出好');
    const real = ['real', 'mock'].includes(full.kind);
    const minutes = real ? full.sections.reduce((n, s) => n + (s.timeMin || 0), 0) || PRETCO_B_FORMAT.minutes : PRETCO_B_FORMAT.minutes;
    const res = this.game.once('exam.start', requestId, state => {
      const ex = this.ensure(state);
      // 同一份卷子有没交的答卷：接着考（关掉再开能恢复答案和剩余时间）
      const open = Object.values(ex.attempts).find(a => a.paperId === full.paperId && !a.submittedAt);
      let attempt = open;
      if (!attempt) {
        const id = `att-${randomUUID()}`;
        attempt = ex.attempts[id] = {attemptId: id, paperId: full.paperId, exam: full.exam, startedAt: this.now(), endsAt: this.now() + minutes * 60000, answers: {}};
      }
      return {attemptId: attempt.attemptId, paper: publicPaper(full), endsAt: attempt.endsAt, answers: attempt.answers, resumed: Boolean(open), title: full.title || null, kind: real ? full.kind : 'sim'};
    });
    // 录音 key 每次现发（同一 requestId 重放也拿新 key），不进状态文件
    return real ? {...res, audio: this.audioFor(full)} : res;
  }
  save({attemptId, answers = {}} = {}) {
    return this.game.mutate(state => {
      const a = this.ensure(state).attempts[clean(attemptId, 80)];
      if (!a) throw new Error('这场考试不在了');
      if (a.submittedAt) throw new Error('已经交卷了');
      for (const [k, v] of Object.entries(answers || {}).slice(0, 200)) a.answers[clean(k, 40)] = typeof v === 'number' ? v : clean(v, 3000);
      a.savedAt = this.now();
      return {savedAt: a.savedAt};
    });
  }
  submit({attemptId, requestId} = {}) {
    if (!requestId) throw new Error('缺少 requestId');
    const res = this.game.once('exam.submit', requestId, state => {
      const a = this.ensure(state).attempts[clean(attemptId, 80)];
      if (!a) throw new Error('这场考试不在了');
      a.submittedAt ||= this.now();
      return {attemptId: a.attemptId, status: 'grading'};
    });
    this.kickGrade(res.attemptId);
    return res;
  }
  kickGrade(attemptId) {
    if (this.grading.has(attemptId)) return this.grading.get(attemptId);
    const job = this.grade(attemptId).catch(() => {}).finally(() => this.grading.delete(attemptId));
    this.grading.set(attemptId, job);
    return job;
  }
  async grade(attemptId) {
    const snap = this.ensure(this.game.read()).attempts[attemptId];
    if (!snap || snap.result) return;
    const full = this.readFull(snap.paperId);
    if (!full) return;
    const sections = [];
    const wrong = [];
    const subjective = [];
    for (const sec of full.sections) {
      let score = 0;
      let max = 0;
      for (const p of sec.parts) p.items.forEach((it, i) => {
        const id = `${sec.id}-${p.id}-${i + 1}`;
        max += p.each;
        const ans = snap.answers[id];
        if (['translate-passage', 'writing'].includes(p.kind)) { subjective.push({sec: sec.id, id, kind: p.kind, it, max: p.each, ans}); return; }
        if (gradeObjective(p.kind, it, ans)) score += p.each;
        else wrong.push({id, sec: sec.id, kind: p.kind, it, given: ans});
      });
      sections.push({id: sec.id, score, max});
    }
    const notes = {};
    for (const s of subjective) {
      const blank = !clean(s.ans) || fold(s.ans) === fold(s.it.stem);
      let got = {score: 0, reason: blank ? '没有作答（或只抄了题目）。' : '', source: 'local'};
      if (!blank) {
        const r = await modelJson(this.game.requestModel, GRADE_RULES, {kind: s.kind, task: s.it.stem, reference: s.it.reference, rubric: s.it.rubric, max: s.max, answer: s.ans}, {
          validate: v => (Number.isInteger(Number(v?.score)) && Number(v.score) >= 0 && Number(v.score) <= s.max ? {score: Number(v.score), reason: clean(v.reason, 300)} : null), timeoutMs: 60000, maxTokens: 800,
        });
        // 模型判不了时的兜底：按长度给一个保守分，并标明需要碧琪稍后复判
        got = r ? {...r.value, source: 'model'} : {score: Math.min(Math.floor(s.max * 0.4), Math.floor(clean(s.ans).split(/\s+/).length / 20)), reason: '碧琪这会儿没法细看，先按字数给了保守分。', source: 'local'};
      }
      notes[s.id] = {...got, standard: clean(s.it.reference, 400), yours: clean(s.ans, 300)};
      sections.find(x => x.id === s.sec).score += got.score;
    }
    // 错题：标准答案先定下来，模型只顺着它讲。最多 24 道，避免一页全错时阅卷停太久。
    const explained = [];
    await pool(wrong.slice(0, 24), 4, async w => {
      const standard = keyText(w.kind, w.it);
      if (!standard) return;
      const yours = givenText(w.kind, w.it, w.given);
      const note = clean(w.it.why, 200);
      let text = note;
      let source = note ? 'key' : 'none';
      if (this.game.requestModel) {
        const r = await modelJson(this.game.requestModel, EXPLAIN_RULES, explainInput({question: w.it.stem, options: w.it.options, standard, note, yours, correct: false}), {validate: validExplain, retries: 1, timeoutMs: 25000, maxTokens: 900});
        if (r) { text = r.value.text; source = 'model'; }
      }
      explained.push({id: w.id, section: w.sec, no: w.it.no || null, stem: clean(w.it.stem, 90), yours, standard, text, source});
    });
    explained.sort((a, b) => wrong.findIndex(w => w.id === a.id) - wrong.findIndex(w => w.id === b.id));
    // 真题卷少拆了几道题时满分不是 100：按比例折成百分制
    const maxAll = sections.reduce((n, s) => n + s.max, 0);
    const raw = sections.reduce((n, s) => n + s.score, 0);
    const score = Math.round(maxAll > 0 && Math.abs(maxAll - 100) > 0.5 ? raw / maxAll * 100 : raw);
    let review = {text: localLine(score >= 70 ? 'boss' : 'default', {seed: score}), source: 'local'};
    const line = await modelJson(this.game.requestModel, LINE_RULES, {event: 'examResult', context: {score, sections: sections.map(s => ({id: s.id, score: s.score, max: s.max})), passLine: 60, safeLine: 70}}, {validate: validLine, retries: 1, timeoutMs: 45000, maxTokens: 200});
    if (line) review = {text: line.value.text, source: 'model'};
    this.game.mutate(state => {
      const ex = this.ensure(state);
      const a = ex.attempts[attemptId];
      if (!a || a.result) return;
      const bossBefore = this.bossState(state, a.exam);
      ex.scores.push({at: this.now(), score, attemptId, exam: a.exam});
      const week = mondayOf(beijingDate(this.now()));
      const used = state.examSeals[week] || 0;
      const reward = E.examReward({score, sealsUsedThisWeek: used, form: this.game.form(state), economy: this.economy});
      if (reward.sealCounted) state.examSeals[week] = used + 1;
      state.stats.examBest = Math.max(state.stats.examBest, score);
      if (score >= this.economy.boss.safeLine) state.stats.examsSafe += 1;
      const spawned = [];
      for (const w of wrong.slice(0, 20)) {
        const m = this.game.modules.monsters?.spawn(state, {key: `exam:${fold(w.it.stem).slice(0, 50)}`, subject: '英语', topic: w.kind, question: w.it.stem,
          answer: w.it.options ? w.it.options[w.it.answer] : [].concat(w.it.answer)[0], options: w.it.options || null, source: {type: 'exam', id: attemptId}});
        if (m && !spawned.includes(m.id)) spawned.push(m.id);
      }
      const bossAfter = this.bossState(state, a.exam);
      const awards = this.game.grant(state, `exam:${attemptId}`, {type: 'exam', id: attemptId}, [
        {kind: 'stars', amount: reward.stars, reason: `交卷 ${score} 分`, fx: 'big'},
        {kind: 'seals', amount: reward.seals, reason: reward.seals ? '考试金印' : '', fx: 'big'},
        {kind: 'boss', itemId: 'babel', amount: Math.max(0, bossBefore.hpPercent - bossAfter.hpPercent), reason: '巴别兽受到攻击', fx: 'cinematic'},
      ]);
      if (bossAfter.phase === 'broken' && !ex.bossDone[a.exam]) {
        ex.bossDone[a.exam] = this.now();
        awards.push(...this.game.grant(state, `boss-break:${a.exam}`, {type: 'boss', id: 'babel'}, [{kind: 'form', itemId: 'dragon-rider', reason: '巴别兽破防！龙骑士碧琪加入', fx: 'cinematic'}]));
      }
      a.result = {status: 'done', score, passLine: this.economy.boss.passLine,
        sections: sections.map(s => ({...s, crit: s.max > 0 && s.score / s.max >= 0.9})), notes, explained, predicted: bossAfter.bestPredicted,
        bossBefore, bossAfter, monstersSpawned: spawned, review, awards};
    });
  }
  result({attemptId} = {}) {
    const a = this.ensure(this.game.read()).attempts[clean(attemptId, 80)];
    if (!a) throw new Error('这场考试不在了');
    if (!a.submittedAt) return {status: 'open'};
    if (!a.result) { this.kickGrade(a.attemptId); return {status: 'grading'}; }
    return a.result;
  }

  bossState(state, exam = GAME_EXAM) {
    const ex = this.ensure(state);
    const b = this.economy.boss;
    const recent = ex.scores.filter(s => s.exam === exam).slice(-3).reverse();
    let predicted = 0;
    if (recent.length) {
      const w = b.weights.slice(0, recent.length);
      const sum = w.reduce((x, y) => x + y, 0);
      predicted = Math.round(recent.reduce((acc, s, i) => acc + s.score * w[i], 0) / sum);
    }
    const date = beijingDate(this.now());
    const daysLeft = Math.max(0, daysBetween(date, EXAM_DATES[exam]));
    const hpPercent = predicted >= b.safeLine ? 0 : Math.round((b.safeLine - predicted) / b.safeLine * 100);
    const real = ex.real[exam];
    const phase = real ? 'done' : predicted >= b.safeLine ? 'broken' : daysLeft <= 7 ? 'final' : predicted >= b.passLine ? 'hurt' : 'normal';
    return {id: 'babel', name: '巴别兽', exam, examDate: EXAM_DATES[exam], daysLeft, hpPercent, bestPredicted: predicted, passLine: b.passLine, safeLine: b.safeLine, phase, gap: Math.max(0, b.safeLine - predicted)};
  }
  realScore({exam = GAME_EXAM, score, requestId} = {}) {
    const s = Number(score);
    if (!Number.isFinite(s) || s < 0 || s > 100) throw new Error('分数要在 0 到 100 之间');
    if (beijingDate(this.now()) < EXAM_DATES[exam]) throw new Error('考完以后再来填真实分数');
    return this.game.once('boss.realScore', requestId, state => {
      const ex = this.ensure(state);
      if (ex.real[exam]) throw new Error('真实分数已经填过了');
      ex.real[exam] = {score: Math.round(s), at: this.now()};
      const awards = [];
      if (s >= this.economy.boss.passLine) {
        state.stats.realPass = 1;
        awards.push(...this.game.grant(state, `real:${exam}`, {type: 'boss', id: exam}, [{kind: 'form', itemId: 'graduate', reason: 'B 级通过！毕业碧琪', fx: 'cinematic'}]));
      }
      return {exam, score: Math.round(s), passed: s >= this.economy.boss.passLine, boss: this.bossState(state, exam), awards};
    });
  }
}
