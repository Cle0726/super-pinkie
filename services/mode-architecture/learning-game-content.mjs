// 碧琪上岸记：内置模型生成的内容（提示词 + 结构校验 + 失败重试 + 盲答复核）。
// 模型只挑选和写文案 / 出题；奖励数值永远由 learning-game-economy.mjs 的确定性代码算。
import {createHash} from 'node:crypto';

export const PRETCO_B_FORMAT = {
  exam: 'pretco-b', name: '高等学校英语应用能力考试 B 级', total: 100, passLine: 60, safeLine: 70, minutes: 120,
  vocabulary: '认知约 2500 词（含入学 1000 词），约 1500 词能正确拼写',
  sections: [
    {id: 'listening', title: 'Part I Listening Comprehension', timeMin: 15, points: 15, parts: [
      {id: 'A', kind: 'listen-response', count: 5, each: 1, note: '听一句问话，选最佳应答（四选一）'},
      {id: 'B', kind: 'listen-dialogue', count: 5, each: 1, note: '5 段两人短对话，各 1 问（四选一）'},
      {id: 'C', kind: 'listen-dictation', count: 5, each: 1, note: '一篇约 100 词短文，5 个空，每空 1–3 词'}]},
    {id: 'vocab', title: 'Part II Vocabulary & Structure', timeMin: 15, points: 15, parts: [
      {id: 'A', kind: 'choice', count: 10, each: 0.5, note: '词汇语法四选一'},
      {id: 'B', kind: 'word-form', count: 10, each: 1, note: '括号内词的正确形式'}]},
    {id: 'reading', title: 'Part III Reading Comprehension', timeMin: 40, points: 35, parts: [
      {id: 'T1', kind: 'passage-choice', count: 5, each: 2, note: '短文四选一'},
      {id: 'T2', kind: 'passage-choice', count: 5, each: 2, note: '短文四选一'},
      {id: 'T3', kind: 'passage-short', count: 5, each: 1, note: '读短文完成句子 / 简答（≤3 词）'},
      {id: 'T4', kind: 'term-match', count: 5, each: 1, note: '术语或标识英汉配对（10 个候选里选 5 个）'},
      {id: 'T5', kind: 'practical-fill', count: 5, each: 1, note: '实用文（信函、通知、广告）填表 / 简答'}]},
    {id: 'translation', title: 'Part IV Translation (English → Chinese)', timeMin: 25, points: 20, parts: [
      {id: 'A', kind: 'translate-choice', count: 4, each: 2, note: '句子英译汉四选一'},
      {id: 'B', kind: 'translate-passage', count: 1, each: 12, note: '一段实用文字英译汉（意思准确 8 + 通顺 4）'}]},
    {id: 'writing', title: 'Part V Writing', timeMin: 25, points: 15, parts: [
      {id: 'A', kind: 'writing', count: 1, each: 15, note: '按中文提示写应用文（便条、通知、邀请、感谢、申请、简历、留言），80–100 词；五档 14–15/11–13/8–10/5–7/0–4'}]},
  ],
};

const clean = (v, n = 400) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
export const fold = v => clean(v, 2000).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export const hashOf = (...parts) => createHash('sha256').update(parts.map(String).join('\n')).digest('hex').slice(0, 20);

// requestModel(rules, payload, options) → requestLearningModel 的返回（{value|..., unavailable, model, ms}）
export async function modelJson(requestModel, rules, payload, {validate = v => v, retries = 2, timeoutMs = 30000, maxTokens = 2000} = {}) {
  if (typeof requestModel !== 'function') return null;
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await requestModel(rules, attempt ? {...payload, previousError: lastError} : payload, {timeoutMs, maxTokens});
      if (!response || response.unavailable) return null;
      const raw = response.value ?? response.json ?? response;
      const value = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()) : raw;
      const ok = validate(value);
      if (ok) return {value: ok, source: 'model', model: response.model?.ref || null, ms: response.ms || 0};
      lastError = '上一次输出没通过校验，请严格按要求的 JSON 结构输出';
    } catch (error) {
      lastError = clean(error?.message || error, 160);
      if (/请求失败（(?:401|403)）/.test(lastError)) return null;
    }
  }
  return null;
}

export async function withTimeout(promise, ms, fallback) {
  let timer;
  const t = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  try { return await Promise.race([promise, t]); } finally { clearTimeout(timer); }
}

// ---------- 四选一题：通用校验 ----------
export function validChoice(v, {seedQuestion = ''} = {}) {
  if (!v || typeof v !== 'object') return null;
  const stem = clean(v.stem, 600);
  const options = Array.isArray(v.options) ? v.options.map(o => clean(o, 200)) : [];
  const answer = Number(v.answer);
  if (!stem || options.length !== 4 || options.some(o => !o)) return null;
  if (new Set(options.map(fold)).size !== 4) return null;
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null;
  if (seedQuestion && fold(stem) === fold(seedQuestion)) return null; // 讨伐必须是新变体，不能是原题
  if (/以上都|all of the above|none of the above|以上皆/i.test(options.join('|'))) return null;
  return {stem, options, answer, why: clean(v.why, 300), point: clean(v.point, 60)};
}

// 盲答复核：另起一次调用，不给答案，让模型自己做；做出来和出题答案一致才算「答案唯一」。
export const SOLVE_RULES = `你是严谨的英语老师。输入一道四选一题 {"stem","options"}。独立做题，只输出 JSON：{"answer":0-3 的整数,"unique":true/false}。如果你认为有两个或以上选项都对、或者没有正确选项，unique 写 false。`;
export async function blindCheck(requestModel, choice) {
  const r = await modelJson(requestModel, SOLVE_RULES, {stem: choice.stem, options: choice.options}, {
    retries: 1, timeoutMs: 20000, maxTokens: 300,
    validate: v => (v && Number.isInteger(Number(v.answer)) ? {answer: Number(v.answer), unique: v.unique !== false} : null),
  });
  if (!r) return null; // 复核调用失败：不确定
  return r.value.unique && r.value.answer === choice.answer;
}

// ---------- 错题怪 ----------
export const MONSTER_NAME_RULES = `你是碧琪上岸记的错题怪命名师。输入一道先生做错的题 {"subject","topic","question","answer","species"}。
给这只错题怪起名字和一句话介绍。只输出 JSON：{"name":"考点 · 怪名（≤14 字，例：一般现在时 · 迷糊史莱姆）","blurb":"一句话，≤30 字，可爱、俏皮，说清它代表的知识点，不骂人、不说『你忘了』"}`;
export function validMonsterName(v) {
  const name = clean(v?.name, 24);
  const blurb = clean(v?.blurb, 60);
  if (!name || !blurb || name.length > 20) return null;
  return {name, blurb};
}

export const VARIANT_RULES = `你是英语 B 级 / 专升本的出题老师。输入先生做错过的一道题 {"subject","topic","question","answer","note","avoid"}。
出一道**新的变体题**：考同一个知识点，但换掉句子、语境和选项（不能只是换个顺序或改一两个词），也不要和 avoid 里已经出过的题相同；难度和英语 B 级相当（词汇约 2500 词以内、句子简单）。
要求：四个选项，只有一个正确；干扰项来自这个知识点的常见错误；不出「以上都对 / 都不对」。
只输出 JSON：{"stem":"题干（英文题干可以，中文提示可以）","options":["","","",""],"answer":正确选项下标 0-3,"why":"一句中文解析","point":"考点（≤12 字）"}`;

// ---------- 委托文案 / 台词 ----------
// 委托的「意思」由代码给（kind → meaning），模型只换说法；文案里出现数字时只能是 count。
export const QUEST_MEANING = {
  answers: n => `在背一背里答对 ${n} 道题`,
  sets: n => `背一背做完 ${n} 组（一组约 10 张卡，不是卷子）`,
  learn: n => `上 ${n} 节课，或者在背一背里学 5 张新卡`,
  huntWins: n => `讨伐打赢 ${n} 只到期的错题怪`,
  weekSets: n => `这一周背一背做完 ${n} 组`,
};
export const QUEST_TEXT_RULES = `你是碧琪，先生的学习搭子。输入今天的委托 {"date","term","quiet","quests":[{"id","kind","count","meaning","draft"}]}。meaning 是这个委托实际要做的事（代码算好的），draft 是现在的本地文案。
给每个委托重写一个标题（≤8 字）和一句话（≤24 字）：
- 意思必须和 meaning 完全一致：不能把「背一背的组」说成「卷子 / 套题」，不能把「答对」说成「做完」；
- 出现数字时只能是 count，不要写别的数字；
- 口吻俏皮温暖、像手账上的小便签；可以带一点节气（term）的氛围，但不要编造先生没说过的安排（吃饭、出门、约会之类）；
- quiet=true（考前一周）时更安静、不催、不比较。
只输出 JSON：{"quests":[{"id","title","text"}]}`;
export function validQuestText(v, ids, counts = {}) {
  const list = Array.isArray(v?.quests) ? v.quests : [];
  const out = {};
  for (const q of list) {
    if (!ids.includes(q?.id)) continue;
    const title = clean(q.title, 12);
    const text = clean(q.text, 40);
    if (!title || !text) continue;
    const nums = `${title} ${text}`.normalize('NFKC').match(/\d+/g) || [];
    if (counts[q.id] != null && nums.some(n => Number(n) !== Number(counts[q.id]))) continue; // 改了数字
    if (/卷子|套题|试卷/.test(`${title}${text}`) && !/exam/.test(String(q.kind || ''))) continue;
    out[q.id] = {title, text};
  }
  return Object.keys(out).length === ids.length ? out : null;
}

// 台词池：模型一次写好今天每个事件 3 句（后台，约 20–40 s），game.line 从池里即时取（≤4 s 的要求靠池子满足，
// 这个模型单句也要 15–20 s，现场调用 4 s 内回不来）。池子没好之前用本地台词并标 local。
export const LINE_EVENTS = {
  default: '随便打个招呼 / 陪伴',
  setFinish: '背完一组',
  perfect: '一组全对',
  combo: '连击很高',
  levelup: '形态亲密度升级',
  capture: '收服一只错题怪',
  huntWin: '讨伐打赢一次（还没收服）',
  boss: '巴别兽掉血',
  formSwitch: '换了一身形态',
  awaken: '形态觉醒',
  gacha: '扭蛋出了好东西',
  chest: '打开委托宝箱',
  questDone: '完成一个委托',
  comeback: '隔了几天回来学习',
  examResult: '模拟考出分',
  examDay: '考试当天',
};
export const LINES_RULES = `你是碧琪（粉色小马，先生的学习搭子），用第一人称「我」或「碧琪」说话，叫用户「先生」。输入 {"date","term","quiet","form","events":{事件id:说明}}。
给每个事件写 3 句不同的台词（每句 ≤30 字）：俏皮、温暖、具体到这个事件；可以偶尔带一点节气（term）氛围；不要编造先生没做过的事；永远不骂、不说「你忘了」「你又错了」、不拿别人比较；quiet=true（考前一周）时安静温柔、不催学习、不推销。
只输出 JSON：{"lines":{"事件id":["","",""]}}`;
export function validLines(v) {
  const box = v?.lines && typeof v.lines === 'object' ? v.lines : null;
  if (!box) return null;
  const out = {};
  for (const ev of Object.keys(LINE_EVENTS)) {
    const list = Array.isArray(box[ev]) ? box[ev] : [];
    const seen = new Set();
    const ok = [];
    for (const t of list) {
      const r = validLine({text: t});
      if (!r || r.text.length > 40 || seen.has(fold(r.text))) continue;
      seen.add(fold(r.text));
      ok.push(r.text);
    }
    if (ok.length) out[ev] = ok.slice(0, 4);
  }
  const full = Object.values(out).filter(l => l.length >= 2).length;
  return full >= Math.ceil(Object.keys(LINE_EVENTS).length * 0.75) ? out : null;
}

export const LINE_RULES = `你是碧琪（粉色小马，先生的学习搭子），用第一人称「我」或「碧琪」说话，叫用户「先生」。输入一个游戏事件 {"event","context"}。
说一句话（≤36 字）：俏皮、温暖、具体到事件；永远不骂、不说「你忘了」「你又错了」；context.quiet=true（考前一周）时安静温柔、不催学习、不推销。
只输出 JSON：{"text":"..."}`;
export const LOCAL_LINES = {
  default: ['我在呢，一起加油～', '今天也一页一页来。'],
  setFinish: ['这一页盖章啦！', '又背完一组，手账亮了一点点～'],
  levelup: ['我们更熟啦！', '亲密度涨了，我好开心～'],
  capture: ['抓到啦！这只小怪以后不捣乱了。', '收服！它乖乖进图鉴了。'],
  boss: ['巴别兽晃了一下，我们离稳过线更近了。', '再打几下，它就要破防啦。'],
  formSwitch: ['换好衣服啦，出发！', '这身怎么样？'],
  comeback: ['回来啦！我们从这里接着来。'],
  quiet: ['慢慢来，先生已经准备得很好了。', '今天轻松一点，我陪着你。'],
  examDay: ['我在考场外等你，放轻松。'],
};
export function localLine(event, {quiet = false, seed = 0} = {}) {
  const list = quiet ? LOCAL_LINES.quiet : (LOCAL_LINES[event] || LOCAL_LINES.default);
  return list[Math.abs(seed) % list.length];
}
export function validLine(v) {
  const text = clean(v?.text, 60);
  if (!text || /你忘了|你又错|笨|蠢|废物|丢人/.test(text)) return null;
  return {text};
}

// ---------- 挂到 game.modules.content：台词池（即时）+ 委托文案（每天一次，后台） ----------
const LINE_RETRY_MS = 10 * 60000;
export class GameContent {
  constructor(game) {
    this.game = game;
    this.questJobs = new Map();
    this.lineJob = null;
    this.lineTried = new Map();
    this.lineTurn = {};
    game.modules.content = this;
  }
  async line({event = 'default', context = {}} = {}) {
    void context;
    const date = this.game.today();
    const {isQuiet} = await import('./learning-game.mjs');
    const quiet = isQuiet(date);
    const ev = clean(event, 30) || 'default';
    const seed = Math.floor(this.game.now() / 60000);
    const key = `${date}|${quiet ? 1 : 0}`;
    const box = this.game.read().lines;
    const list = box?.key === key ? (box.pool?.[ev] || box.pool?.default) : null;
    if (list?.length) {
      this.lineTurn[ev] = (this.lineTurn[ev] || 0) + 1;
      return {text: list[(seed + this.lineTurn[ev]) % list.length], source: 'model'};
    }
    this.kickLines(date, quiet);
    return {text: localLine(ev, {quiet, seed}), source: 'local'};
  }
  // 后台写今天的台词池（一天一次；失败 10 分钟后才再试）。
  kickLines(date, quiet) {
    if (!this.game.requestModel || this.lineJob) return this.lineJob;
    const key = `${date}|${quiet ? 1 : 0}`;
    const tried = this.lineTried.get(key);
    if (tried && this.game.now() - tried < LINE_RETRY_MS) return null;
    this.lineTried.set(key, this.game.now());
    this.lineJob = (async () => {
      const {seasonOn} = await import('./learning-game.mjs');
      const state = this.game.read();
      const form = this.game.catalog?.forms?.find?.(f => f.id === state.forms?.equipped)?.name || '碧琪';
      const r = await modelJson(this.game.requestModel, LINES_RULES, {date, term: seasonOn(date)?.name || '', quiet, form, events: LINE_EVENTS}, {validate: validLines, retries: 1, timeoutMs: 90000, maxTokens: 3000});
      if (!r) return null;
      this.game.mutate(s => { s.lines = {key, pool: r.value, at: this.game.now()}; });
      return r.value;
    })().catch(() => null).finally(() => { this.lineJob = null; });
    return this.lineJob;
  }
  // 当天委托的文案由模型补写（数字和种类不变）；写好前用本地文案。
  kickQuestText(date) {
    if (!this.game.requestModel || this.questJobs.has(date)) return;
    const state = this.game.read();
    const q = state.quests?.[date];
    if (!q || q.text === 'model' || q.textTried) return;
    const job = (async () => {
      const {isQuiet, seasonOn} = await import('./learning-game.mjs');
      const ids = q.list.map(x => x.id);
      const counts = Object.fromEntries(q.list.map(x => [x.id, x.target.count]));
      const quests = q.list.map(x => ({id: x.id, kind: x.target.kind, count: x.target.count, meaning: (QUEST_MEANING[x.target.kind] || (n => `${x.text}（${n}）`))(x.target.count), draft: `${x.title}｜${x.text}`}));
      const r = await modelJson(this.game.requestModel, QUEST_TEXT_RULES, {date, term: seasonOn(date)?.name || '', quiet: isQuiet(date), quests}, {validate: v => validQuestText(v, ids, counts), timeoutMs: 60000, maxTokens: 800});
      this.game.mutate(s => {
        const day = s.quests?.[date];
        if (!day) return;
        day.textTried = true;
        if (!r) return;
        for (const item of day.list) if (r.value[item.id]) Object.assign(item, r.value[item.id]);
        day.text = 'model';
      });
    })().catch(() => {}).finally(() => this.questJobs.delete(date));
    this.questJobs.set(date, job);
  }
}
