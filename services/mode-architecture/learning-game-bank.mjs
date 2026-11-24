// 碧琪上岸记 · 真题题库 + 刷题（REDO-1109 E1/E2）。
// 题库 = 考场里已经拆好的真题 / 官方模拟卷（papers/real-*.json、mock-*.json）摊平成一题一条；仿真卷不进。
// 考点 / 难度由内置模型按固定考点表标注（一次一个小节），程序校验考点必须在表里；模型永远拿不到改答案的机会（答案只从卷子文件读）。
// 标注结果存 game/bank/pretco-b.json（按题目内容签名缓存，新卷 / 重拆的卷只标新题）。
// 刷题一组 = 服务端存题目和答案，前端只拿公开版；判分只认官方答案，翻译段落 / 写作走考场同一套阅卷细则。
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import * as E from './learning-game-economy.mjs';
import {fold, modelJson, pool, explainInput} from './learning-game-content.mjs';
import {explainRulesFor, compactExplainRules, markCompactExplain, useCompactExplain, explainRules, validVoicedExplain, explainFailure, EXPLAIN_VERSION, explainVersionFor} from './learning-explain-voice.mjs';
import {GRADE_RULES, gradeObjective} from './learning-game-exam.mjs';

const DAY = 86400000;
const clean = (v, n = 2000) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const sha = v => createHash('sha256').update(String(v)).digest('hex').slice(0, 12);
export const BANK_VERSION = 1;
export const RESERVED_LATEST = 3; // 最新几套真题默认留给整套模考
export const FRESH_DAYS = 7; // 做对的题 7 天内不再抽、不再给星

// ---------- 考点表（PLAN §4.1）----------
// group：一组考点对应一种题（按题型 + 小节）；points 里的名字就是模型只能选的值。只有一个考点的组不调模型选考点（只标难度）。
export const POINT_GROUPS = [
  {id: 'vc', area: 'vocab', name: '词汇语法 · 选择', points: ['时态', '被动语态', '非谓语', '虚拟语气', '定语从句', '名词性从句', '状语从句与连词', '比较结构', '主谓一致', '情态动词', '倒装与强调', '介词与固定搭配', '短语动词', '词义辨析', '代词与冠词']},
  {id: 'vf', area: 'vocab', name: '词汇语法 · 词形', points: ['变名词', '变形容词', '变副词', '动词时态语态', '非谓语形式', '比较级最高级', '单复数与所有格']},
  {id: 'rd', area: 'reading', name: '阅读 · 短文选择', points: ['细节题', '主旨题', '推断题', '词义猜测']},
  {id: 'r3', area: 'reading', name: '阅读 · 信息填空', points: ['信息填空']},
  {id: 'r4', area: 'reading', name: '阅读 · 术语配对', points: ['公共标识', '职场与管理', '交通与旅行', '商务与贸易', '科技与产品', '生活与服务']},
  {id: 'r5', area: 'reading', name: '阅读 · 实用文', points: ['信函', '广告', '通知', '说明书', '表格']},
  {id: 'tc', area: 'translation', name: '翻译 · 选择', points: ['定语从句', '被动', '长句拆分', '固定表达']},
  {id: 'tp', area: 'translation', name: '翻译 · 段落', points: ['段落（实用文）']},
  {id: 'wr', area: 'writing', name: '写作', points: ['便条', '通知', '邀请信', '感谢信', '申请信', '投诉信', '简历 / 表格', '备忘录', '电子邮件']},
  {id: 'la', area: 'listening', name: '听力 · 问句应答', points: ['问候', '请求', '建议', '询问信息', '致谢道歉']},
  {id: 'lb', area: 'listening', name: '听力 · 短对话', points: ['短对话']},
  {id: 'lc', area: 'listening', name: '听力 · 对话理解', points: ['对话理解']},
  {id: 'ld', area: 'listening', name: '听力 · 短文填空', points: ['短文填空']},
];
export const AREAS = [
  {id: 'vocab', name: '词汇语法'}, {id: 'reading', name: '阅读'}, {id: 'translation', name: '翻译'}, {id: 'writing', name: '写作'}, {id: 'listening', name: '听力'},
];
// 试卷模块：跟真卷的 Part I–V 对齐。除听力需整套原录音外，词汇、阅读（按完整 Task 1–5）、翻译均跨年份优先混刷（2025–2020 优先）。
export const PAPER_MODULES = [
  {id: 'listening', name: 'Part I 听力', note: '一套 · 放原录音'},
  {id: 'vocab', name: 'Part II 词汇与结构', note: '10 选择 + 5 词形 · 跨年混刷'},
  {id: 'reading', name: 'Part III 阅读理解', note: 'Task 1–5 · 跨年混刷'},
  {id: 'translation', name: 'Part IV 翻译', note: '4 选择 + 1 段落 · 跨年混刷'},
  {id: 'writing', name: 'Part V 写作', note: '一篇应用文 · 近年优先'},
];
const GROUP = Object.fromEntries(POINT_GROUPS.map(g => [g.id, g]));
// 地图区域 → 考点组（营地「练」/ 出发）；守关只用不带文章的单选
const REGION_GROUPS = {vocab: ['vc', 'vf'], grammar: ['vc', 'vf'], reading: ['rd', 'r3', 'r4', 'r5'], translation: ['tc', 'tp'], writing: ['wr'], listening: []};
const VOCAB_POINTS = ['词义辨析', '介词与固定搭配', '短语动词', '代词与冠词'];
const GUARD_POINTS = {vocab: [['vc', VOCAB_POINTS]], grammar: [['vc', POINT_GROUPS[0].points.filter(p => !VOCAB_POINTS.includes(p))]], translation: [['tc', null]]};
const ALIAS = {'被动语态': ['被动'], '非谓语': ['不定式', '动名词', '分词'], '状语从句与连词': ['状语从句', '连词'], '介词与固定搭配': ['固定搭配', '介词'], '词义辨析': ['近义词', '辨析'], '比较结构': ['比较级'], '名词性从句': ['宾语从句', '主语从句'], '邀请信': ['邀请'], '感谢信': ['感谢'], '申请信': ['申请'], '投诉信': ['投诉'], '简历 / 表格': ['简历', '表格'], '电子邮件': ['邮件', 'email'], '长句拆分': ['长句']};
export const UNCLASSIFIED = '未分类';
export const pointId = (group, name) => `${group}/${name}`;

// 题型 + 小节 → 考点组
export function groupOf(qkind, part = '') {
  if (qkind === 'choice') return 'vc';
  if (qkind === 'word-form') return 'vf';
  if (qkind === 'passage-choice') return 'rd';
  if (qkind === 'term-match') return 'r4';
  if (qkind === 'practical-fill' || qkind === 'passage-short') return /5/.test(part) ? 'r5' : 'r3';
  if (qkind === 'translate-choice') return 'tc';
  if (qkind === 'translate-passage') return 'tp';
  if (qkind === 'writing') return 'wr';
  if (qkind === 'listen-response') return 'la';
  if (qkind === 'listen-dialogue') return 'lb';
  if (qkind === 'listen-conversation') return 'lc';
  if (qkind === 'listen-dictation') return 'ld';
  return null;
}
const SUBJECTIVE = new Set(['translate-passage', 'writing']);
const LISTEN = qkind => qkind.startsWith('listen');
// 「随机 10 题」只抽不带文章、不用录音的单题
const SINGLE = new Set(['choice', 'word-form', 'translate-choice']);

// ---------- 摊平 ----------
// 卷子 → 题目条目。篇章题的文章 / 听力原文按引用存（materials[key]），同一篇只存一份。
export function flattenPaper(full) {
  const items = [];
  const materials = {};
  if (!full || !['real', 'mock'].includes(full.kind)) return {items, materials};
  const seen = new Map();
  for (const sec of full.sections || []) for (const p of sec.parts || []) {
    const mkey = p.material ? `${full.paperId}/${sec.id}/${p.id}` : null;
    if (mkey) materials[mkey] = clean(p.material, 8000);
    (p.items || []).forEach((it, i) => {
      const base = it.no ? `${full.paperId}#${it.no}` : `${full.paperId}#${sec.id}-${p.id}-${i + 1}`;
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      const id = n > 1 ? `${base}-${n}` : base;
      const item = {
        id, paperId: full.paperId, paperKind: full.kind, year: full.year || 0, month: full.month || 0, title: full.title || full.paperId,
        section: sec.id, part: p.id, qkind: p.kind, no: it.no || null, each: p.each, examId: `${sec.id}-${p.id}-${i + 1}`,
        stem: clean(it.stem, 3000), ...(it.options ? {options: it.options.map(o => clean(o, 600)), answer: it.answer} : {answer: it.answer}),
        ...(it.why ? {why: clean(it.why, 300)} : {}), ...(it.base ? {base: clean(it.base, 60)} : {}), ...(it.script ? {script: clean(it.script, 1500)} : {}),
        ...(it.reference ? {reference: clean(it.reference, 3000)} : {}), ...(it.rubric ? {rubric: clean(it.rubric, 1500)} : {}),
        ...(mkey ? {material: mkey} : {}), group: groupOf(p.kind, p.id),
      };
      item.sig = sha(`${item.qkind}|${item.stem}|${JSON.stringify(item.options || '')}|${JSON.stringify(item.answer)}`);
      if (item.group) items.push(item);
    });
  }
  return {items, materials};
}

// ---------- 标注 ----------
export const TAG_RULES = `你在给「高等学校英语应用能力考试 B 级」历年真题标考点和难度。输入 {"group":题型名称,"points":这类题只能用的考点名,"material":本节共用文章或材料（可能为空）,"items":[{"no","stem","options","answer":标准答案文字}]}。
- 每道题从 points 里选一个最贴切的考点（必须一字不差用 points 里的名字）；实在一个都不贴切就写「未分类」。
- 难度 difficulty 只能是「易」「中」「难」：按 B 级考生（大专一年级、词汇约 2500）的水平判断。
- 标准答案是官方给的，不要质疑、不要改，也不要输出答案。
只输出 JSON：{"items":[{"no":题号,"point":"考点名","difficulty":"易|中|难"}]}，每道输入的题都要有一条。`;

const DIFF = new Set(['易', '中', '难']);
export function validTags(v, items, group) {
  const g = GROUP[group];
  const rows = Array.isArray(v?.items) ? v.items : [];
  const out = {};
  for (const r of rows) {
    const key = String(r?.no ?? '');
    const it = items.find(x => String(x.tagNo) === key);
    if (!it) continue;
    let point = clean(r.point, 30);
    if (g.points.length === 1 && point !== UNCLASSIFIED) point = g.points[0];
    const diff = DIFF.has(clean(r.difficulty, 2)) ? clean(r.difficulty, 2) : null;
    if (!diff) continue;
    if (point !== UNCLASSIFIED && !g.points.includes(point)) continue;
    out[it.id] = {point, difficulty: diff};
  }
  // 一节里一半以上没标上就算这次不合格（让模型重来）
  return Object.keys(out).length >= Math.ceil(items.length / 2) ? out : null;
}

function answerText(it) {
  if (it.options) return it.options[it.answer] || '';
  if (Array.isArray(it.answer)) return it.answer[0] || '';
  return clean(it.answer, 40);
}

export class QuestionBank {
  // dir = game 根目录（papers/ 和 bank/ 都在下面）
  constructor({root, requestModel = null, now = () => Date.now(), exam = 'pretco-b'} = {}) {
    this.root = root;
    this.requestModel = requestModel;
    this.now = now;
    this.exam = exam;
    this.cache = null;
    this.job = null;
    this.status = {state: 'idle', tagged: 0, total: 0, at: 0, failed: 0};
  }
  papersDir() { return path.join(this.root, 'papers'); }
  file() { return path.join(this.root, 'bank', `${this.exam}.json`); }
  readTags() {
    try { const j = JSON.parse(fs.readFileSync(this.file(), 'utf8')); if (j && j.version === BANK_VERSION && j.tags) return j; } catch { /* 没有或坏了：从头标 */ }
    return {version: BANK_VERSION, exam: this.exam, tags: {}, updatedAt: 0};
  }
  writeTags(j) {
    fs.mkdirSync(path.dirname(this.file()), {recursive: true, mode: 0o700});
    const tmp = `${this.file()}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({...j, version: BANK_VERSION, exam: this.exam, updatedAt: this.now()}), {mode: 0o600});
    fs.renameSync(tmp, this.file());
    this.cache = null;
  }
  // 卷子目录的指纹（文件名 + 大小 + 修改时间）没变就用缓存
  fingerprint() {
    let names = [];
    try { names = fs.readdirSync(this.papersDir()).filter(f => /^(real|mock)-[\w-]+\.json$/.test(f)).sort(); } catch { return ''; }
    const parts = names.map(f => { try { const st = fs.statSync(path.join(this.papersDir(), f)); return `${f}:${st.size}:${Math.round(st.mtimeMs)}`; } catch { return f; } });
    let tagStamp = '';
    try { tagStamp = String(Math.round(fs.statSync(this.file()).mtimeMs)); } catch { /* 没有标注文件 */ }
    return sha(parts.join('|') + '#' + tagStamp);
  }
  load() {
    const fp = this.fingerprint();
    if (this.cache && this.cache.fp === fp) return this.cache;
    const items = [];
    const materials = {};
    const papers = {};
    let names = [];
    try { names = fs.readdirSync(this.papersDir()).filter(f => /^(real|mock)-[\w-]+\.json$/.test(f)); } catch { /* 还没有卷子 */ }
    for (const f of names) {
      let full = null;
      try { full = JSON.parse(fs.readFileSync(path.join(this.papersDir(), f), 'utf8')); } catch { continue; }
      if (!full || full.exam !== this.exam) continue;
      const r = flattenPaper(full);
      items.push(...r.items);
      Object.assign(materials, r.materials);
      papers[full.paperId] = {paperId: full.paperId, kind: full.kind, year: full.year || 0, month: full.month || 0, title: full.title, audio: full.audio || null};
    }
    const tags = this.readTags().tags;
    for (const it of items) {
      const t = tags[it.id];
      if (t && t.sig === it.sig) { it.point = t.point; it.difficulty = t.difficulty; }
    }
    items.sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month) || a.paperId.localeCompare(b.paperId) || (a.no || 0) - (b.no || 0));
    this.cache = {fp, items, materials, papers, byId: new Map(items.map(i => [i.id, i]))};
    return this.cache;
  }
  item(id) { return this.load().byId.get(String(id)) || null; }
  untagged() { return this.load().items.filter(i => !i.point); }

  // 留卷：最新 RESERVED_LATEST 套真题（模拟卷不留）
  reservedPapers() {
    return Object.values(this.load().papers).filter(p => p.kind === 'real').sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month)).slice(0, RESERVED_LATEST).map(p => p.paperId);
  }

  // 一次标一节：同一卷同一小节的题一起给模型
  async tagAll({force = false, concurrency = 4, signal, onProgress} = {}) {
    if (this.job) return this.job;
    const run = async () => {
      const {items, materials} = this.load();
      const store = this.readTags();
      const todo = items.filter(i => force || !(store.tags[i.id] && store.tags[i.id].sig === i.sig));
      const batches = new Map();
      for (const it of todo) { const k = `${it.paperId}|${it.section}|${it.part}`; (batches.get(k) || batches.set(k, []).get(k)).push(it); }
      this.status = {state: 'tagging', tagged: items.length - todo.length, total: items.length, at: this.now(), failed: 0};
      if (!todo.length || typeof this.requestModel !== 'function') { this.status.state = 'idle'; return this.status; }
      let dirty = 0;
      const flush = () => { if (dirty) { this.writeTags(store); dirty = 0; } };
      await pool([...batches.values()], concurrency, async list => {
        if (signal?.aborted) return;
        const group = list[0].group;
        const g = GROUP[group];
        const rows = list.map(it => ({...it, tagNo: it.id.split("#").pop()}));
        const payload = {group: g.name, points: g.points, material: list[0].material ? clean(materials[list[0].material], 2500) : '',
          items: rows.map(it => ({no: it.tagNo, stem: clean(it.stem, it.qkind === 'writing' ? 900 : 500), ...(it.options ? {options: it.options} : {}), answer: clean(answerText(it), 200), ...(it.base ? {base: it.base} : {}), ...(it.script ? {script: clean(it.script, 300)} : {})}))};
        const r = await modelJson(this.requestModel, TAG_RULES, payload, {validate: v => validTags(v, rows, group), retries: 2, timeoutMs: 120000, maxTokens: 3000});
        for (const it of rows) {
          const t = r?.value?.[it.id];
          // 重试完还标不出来：归「未分类」（会列在概览里）；难度默认「中」
          store.tags[it.id] = t ? {...t, sig: it.sig, src: 'model'} : {point: UNCLASSIFIED, difficulty: '中', sig: it.sig, src: 'fallback'};
          if (!t) this.status.failed += 1;
        }
        this.status.tagged += rows.length; dirty += rows.length;
        if (dirty >= 40) flush();
        onProgress?.(this.status);
      });
      flush();
      this.status.state = 'idle'; this.status.at = this.now();
      return this.status;
    };
    this.job = run().finally(() => { this.job = null; });
    return this.job;
  }

  // 校验报告：每个考点多少题、未分类、答案是否在选项里
  report() {
    const {items, materials} = this.load();
    const byPoint = {};
    const problems = [];
    for (const it of items) {
      const k = it.point ? (it.point === UNCLASSIFIED ? `${it.group}/${UNCLASSIFIED}` : pointId(it.group, it.point)) : `${it.group}/（未标）`;
      byPoint[k] = (byPoint[k] || 0) + 1;
      if (it.options && !(Number.isInteger(it.answer) && it.options[it.answer])) problems.push(`${it.id} 答案不在选项里`);
      if (!it.options && it.qkind !== 'term-match' && !SUBJECTIVE.has(it.qkind) && !(Array.isArray(it.answer) && it.answer.length)) problems.push(`${it.id} 没有答案`);
      if (it.material && !materials[it.material]) problems.push(`${it.id} 文章丢了`);
    }
    return {items: items.length, tagged: items.filter(i => i.point).length, unclassified: items.filter(i => i.point === UNCLASSIFIED).map(i => i.id), byPoint, problems};
  }
}

// ---------- 抽题 ----------
// 2025–2020 近年真题优先（冲刺期更贴近最新考纲和题风）；越近的年份权重越高。
export const PRIORITY_YEAR_MIN = 2020;
export function yearWeight(item) {
  const y = Number(item?.year) || 0;
  if (y >= 2025) return 14;
  if (y === 2024) return 12;
  if (y === 2023) return 10;
  if (y === 2022) return 8;
  if (y === 2021) return 6;
  if (y === 2020) return 5;
  if (y >= 2018) return 1.2;
  if (y >= 2013) return 0.5;
  return 0.8; // 官方模拟卷或未标年份
}
const isPriorityYear = item => (Number(item?.year) || 0) >= PRIORITY_YEAR_MIN;
const drawnCount = record => Math.max(record?.draws || 0, record?.n || 0);
const drawKey = (rng, repeats, weight = 1) => (-Math.log1p(-rng()) * (1 + repeats)) / (weight > 0 ? weight : 1);

// 先抽没见过的，再抽已抽未做、错题、过了 7 天的对题。同档内 2025–2020 年优先，且出现得越多越不容易重复。
export function rankItems(items, rec, {now = Date.now(), seed = 1} = {}) {
  const rng = E.mulberry32(seed >>> 0);
  const scored = items.map(it => {
    const r = rec[it.id];
    let tier;
    if (!r?.n) tier = drawnCount(r) ? 1 : 0;
    else if (r.ok === false) tier = 2;
    else if (now - (r.okAt || r.at || 0) >= FRESH_DAYS * DAY) tier = 3;
    else tier = 9;
    return {it, tier, k: drawKey(rng, drawnCount(r) + (r?.n || 0), yearWeight(it))};
  }).filter(x => x.tier < 9);
  scored.sort((a, b) => a.tier - b.tier || a.k - b.k);
  return scored.map(x => x.it);
}

// 跨年份 / 跨试卷分散抽题：保持 2025–2020 近年优先权重的同时，尽量让同一组题横跨不同年份和不同卷子，不扎堆在同一年。
export function diversifyPick(ranked, n, {usedPapers = null, usedYears = null} = {}) {
  const limit = Math.max(0, Number(n) || 0);
  if (!limit || !ranked.length) return [];
  const chosen = [];
  const chosenIds = new Set();
  const paperCnt = new Map(usedPapers ? [...usedPapers] : []);
  const yearCnt = new Map(usedYears ? [...usedYears] : []);
  const yearKey = it => (Number(it.year) > 0 ? String(it.year) : String(it.paperId || 'other'));
  const take = it => {
    chosen.push(it);
    chosenIds.add(it.id);
    paperCnt.set(it.paperId, (paperCnt.get(it.paperId) || 0) + 1);
    const yk = yearKey(it);
    yearCnt.set(yk, (yearCnt.get(yk) || 0) + 1);
  };
  // Pass 1：优先覆盖 2025–2020 各个未出现的年份（每年先各拿 1 题）
  for (const it of ranked) {
    if (chosen.length >= limit) break;
    if (chosenIds.has(it.id) || !isPriorityYear(it)) continue;
    if ((paperCnt.get(it.paperId) || 0) === 0 && (yearCnt.get(yearKey(it)) || 0) === 0) take(it);
  }
  // Pass 2：优先选 2025–2020 中未出现过的其他套卷（同一年先不超过 2 题，再放开到同一年第 3 套如 2023-03 / 2022-06）
  for (const capY of [2, 3]) {
    for (const it of ranked) {
      if (chosen.length >= limit) break;
      if (chosenIds.has(it.id) || !isPriorityYear(it)) continue;
      if ((paperCnt.get(it.paperId) || 0) === 0 && (yearCnt.get(yearKey(it)) || 0) < capY) take(it);
    }
  }
  // Pass 3：若 2025–2020 的不同套卷不足（例如已刷完或小考点），再按 ranked 顺序补未出现过的其他年份卷子
  for (const it of ranked) {
    if (chosen.length >= limit) break;
    if (chosenIds.has(it.id)) continue;
    if ((paperCnt.get(it.paperId) || 0) === 0) take(it);
  }
  // Pass 4：若仍不足，按轮转放宽每卷上限直至凑满
  for (let cap = 2; chosen.length < limit && cap <= limit + 2; cap++) {
    let added = false;
    for (const it of ranked) {
      if (chosen.length >= limit) break;
      if (chosenIds.has(it.id)) continue;
      if ((paperCnt.get(it.paperId) || 0) < cap) { take(it); added = true; }
    }
    if (!added) break;
  }
  // 错开相邻同卷 / 同年，让刷题时每一题自然跨年切换
  const spaced = [];
  const rest = [...chosen];
  while (rest.length) {
    const prev = spaced[spaced.length - 1];
    let idx = 0;
    if (prev) {
      const diffBoth = rest.findIndex(x => x.paperId !== prev.paperId && yearKey(x) !== yearKey(prev));
      if (diffBoth >= 0) idx = diffBoth;
      else {
        const diffPaper = rest.findIndex(x => x.paperId !== prev.paperId);
        if (diffPaper >= 0) idx = diffPaper;
      }
    }
    spaced.push(rest.splice(idx, 1)[0]);
  }
  return spaced;
}

// mode: random | kind | point | wrong | listening | module
// kind（按题型）：vc / vf / rd / r3 / r4 / r5 / translation / writing
// module（按试卷模块）：listening / vocab / reading / translation / writing
export function pick(bank, {mode = 'random', kind = '', point = '', module = '', count = 10, seed = 1, rec = {}, unlocked = {}, now = Date.now(), audioOk = () => true} = {}) {
  const {items} = bank.load();
  const reserved = new Set(bank.reservedPapers().filter(id => !unlocked[id]));
  const open = items.filter(it => !reserved.has(it.paperId));
  const n = Math.max(1, Math.min(20, Number(count) || 10));
  const rank = (list, salt = 0) => rankItems(list, rec, {now, seed: seed + salt});
  if (mode === 'random') return {items: diversifyPick(rank(open.filter(it => SINGLE.has(it.qkind))), n)};
  if (mode === 'wrong') {
    const wrong = items.filter(it => rec[it.id]?.ok === false && !LISTEN(it.qkind));
    wrong.sort((a, b) => Number(isPriorityYear(b)) - Number(isPriorityYear(a)) || (rec[b.id].at || 0) - (rec[a.id].at || 0));
    return {items: diversifyPick(wrong, n)};
  }
  if (mode === 'point') {
    const [group, ...rest] = String(point).split('/');
    const name = rest.join('/');
    const list = open.filter(it => it.group === group && (name === UNCLASSIFIED ? it.point === UNCLASSIFIED : it.point === name) && !LISTEN(it.qkind));
    // 写作 / 翻译段落一组一篇
    const big = list.filter(it => SUBJECTIVE.has(it.qkind));
    if (big.length && big.length === list.length) return {items: rank(big).slice(0, 1)};
    return {items: diversifyPick(rank(list.filter(it => !SUBJECTIVE.has(it.qkind))), n)};
  }
  if (mode === 'listening') {
    const papers = groupItems(open.filter(it => LISTEN(it.qkind)), it => it.paperId);
    const items = pickGroup([...papers.values()].filter(group => audioOk(group[0].paperId)), rec, seed);
    return {items, paperId: items[0]?.paperId || null};
  }
  if (mode === 'kind') {
    if (['vc', 'vf'].includes(kind)) return {items: diversifyPick(rank(open.filter(it => it.group === kind)), n)};
    if (['rd', 'r3', 'r4', 'r5'].includes(kind)) {
      const passages = groupItems(open.filter(it => it.group === kind), it => `${it.paperId}|${it.part}`);
      return {items: pickGroup(passages.values(), rec, seed)};
    }
    if (kind === 'translation') {
      const choices = diversifyPick(rank(open.filter(it => it.qkind === 'translate-choice'), 71), 4);
      const usedP = new Set(choices.map(x => x.paperId));
      const usedY = new Set(choices.map(x => x.year || x.paperId));
      const tpRanked = rank(open.filter(it => it.qkind === 'translate-passage'), 97);
      const tp = tpRanked.find(x => !usedP.has(x.paperId) && !usedY.has(x.year || x.paperId))
        || tpRanked.find(x => !usedP.has(x.paperId))
        || tpRanked[0];
      return {items: tp ? [...choices, tp] : choices};
    }
    if (kind === 'writing') return {items: rank(open.filter(it => it.qkind === 'writing')).slice(0, 1)};
  }
  if (mode === 'module') return pickModule(open, module, rec, seed, audioOk, now);
  return {items: []};
}
function moduleList(open, id) {
  if (id === 'listening') return open.filter(it => LISTEN(it.qkind));
  return open.filter(it => it.section === id);
}
// 按 B 级模块抽题：
// - 听力：需配整套原录音，按整套抽（2025–2020 优先）
// - 词汇与结构：10 选择 + 5 词形，跨年份/跨试卷分散抽（2025–2020 优先）
// - 阅读理解：完整 Task 1–5（每个 Task 内部文章/术语表保持原卷完整），5 个 Task 分别从不同年份/试卷抽
// - 翻译：4 翻译选择 + 1 段落翻译，跨年份/跨试卷抽
// - 写作：1 篇应用文（2025–2020 优先）
function pickModule(open, id, rec, seed, audioOk, now = Date.now()) {
  if (!PAPER_MODULES.some(m => m.id === id)) return {items: [], paperId: null};
  if (id === 'vocab') {
    const vc = diversifyPick(rankItems(open.filter(it => it.qkind === 'choice'), rec, {now, seed: seed + 17}), 10);
    const vf = diversifyPick(rankItems(open.filter(it => it.qkind === 'word-form'), rec, {now, seed: seed + 53}), 5);
    if (vc.length && vf.length > 1 && vc[vc.length - 1].paperId === vf[0].paperId) {
      vf.push(vf.shift());
    }
    return {items: [...vc, ...vf], paperId: null};
  }
  if (id === 'reading') {
    const usedPapers = new Set();
    const usedYears = new Set();
    const out = [];
    const tasks = ['T1', 'T2', 'T3', 'T4', 'T5'];
    tasks.forEach((taskId, ti) => {
      const taskItems = open.filter(it => it.section === 'reading' && it.part === taskId);
      const byPaper = [...groupItems(taskItems, it => it.paperId).values()];
      if (!byPaper.length) return;
      const freshBoth = byPaper.filter(g => !usedPapers.has(g[0].paperId) && !usedYears.has(g[0].year || g[0].paperId));
      const freshPaper = byPaper.filter(g => !usedPapers.has(g[0].paperId));
      const candidates = freshBoth.length ? freshBoth : freshPaper.length ? freshPaper : byPaper;
      const picked = pickGroup(candidates, rec, seed + (ti + 1) * 131);
      if (!picked.length) return;
      picked.sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0) || String(a.id).localeCompare(String(b.id)));
      usedPapers.add(picked[0].paperId);
      usedYears.add(picked[0].year || picked[0].paperId);
      out.push(...picked);
    });
    return {items: out, paperId: null};
  }
  if (id === 'translation') {
    const tc = diversifyPick(rankItems(open.filter(it => it.qkind === 'translate-choice'), rec, {now, seed: seed + 71}), 4);
    const usedP = new Set(tc.map(x => x.paperId));
    const usedY = new Set(tc.map(x => x.year || x.paperId));
    const tpRanked = rankItems(open.filter(it => it.qkind === 'translate-passage'), rec, {now, seed: seed + 97});
    const tp = tpRanked.find(x => !usedP.has(x.paperId) && !usedY.has(x.year || x.paperId))
      || tpRanked.find(x => !usedP.has(x.paperId))
      || tpRanked[0];
    return {items: tp ? [...tc, tp] : tc, paperId: null};
  }
  if (id === 'writing') {
    const wr = rankItems(open.filter(it => it.qkind === 'writing'), rec, {now, seed: seed + 113}).slice(0, 1);
    return {items: wr, paperId: wr[0]?.paperId || null};
  }
  const papers = groupItems(moduleList(open, id), it => it.paperId);
  const groups = [...papers.values()].filter(group => id !== 'listening' || audioOk(group[0].paperId));
  const items = pickGroup(groups, rec, seed);
  items.sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0) || String(a.id).localeCompare(String(b.id)));
  return {items, paperId: items[0]?.paperId || null};
}
function groupItems(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}
function pickGroup(groups, rec, seed) {
  const rng = E.mulberry32(seed >>> 0);
  const ranked = Array.from(groups, items => {
    const repeats = items.reduce((sum, it) => sum + drawnCount(rec[it.id]) + (rec[it.id]?.n || 0), 0);
    return {items, seen: Number(repeats > 0), key: drawKey(rng, repeats / items.length, yearWeight(items[0]))};
  });
  ranked.sort((a, b) => a.seen - b.seen || a.key - b.key);
  return ranked[0]?.items || [];
}

// 老版本只留下最近的组单和作答统计。首次抽题时补记还在的历史组单，后面直接累计。
function practiceRecords(practice) {
  if (practice.drawsTracked) return practice.rec;
  const counts = new Map();
  for (const set of Object.values(practice.sets)) {
    for (const id of new Set(set?.items || [])) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const records = {...practice.rec};
  for (const [id, draws] of counts) records[id] = {...records[id], draws: Math.max(draws, drawnCount(records[id]))};
  return records;
}

// 概览：每个考点 题数 · 做过 · 正确率（弱项排前：做过 ≥3 题的按正确率升序，其余按题数）
export function overview(bank, {rec = {}, unlocked = {}} = {}) {
  const {items} = bank.load();
  const reservedAll = bank.reservedPapers();
  const reserved = new Set(reservedAll.filter(id => !unlocked[id]));
  const stat = list => {
    const done = list.filter(it => rec[it.id]?.n);
    const right = done.filter(it => rec[it.id].ok).length;
    return {total: list.length, done: done.length, right, acc: done.length ? Math.round(right / done.length * 100) : null};
  };
  const open = items.filter(it => !reserved.has(it.paperId));
  const points = [];
  for (const g of POINT_GROUPS) {
    for (const name of [...g.points, UNCLASSIFIED]) {
      const list = open.filter(it => it.group === g.id && it.point === name);
      if (!list.length) continue;
      points.push({id: pointId(g.id, name), group: g.id, groupName: g.name, area: g.area, name, ...stat(list), practicable: !g.area.startsWith('listening')});
    }
  }
  const weakKey = p => (p.done >= 3 ? p.acc : 1000 - p.total / 1000);
  const ranked = points.filter(p => p.practicable).sort((a, b) => weakKey(a) - weakKey(b));
  const kinds = [
    {id: 'vc', name: '词汇语法 · 选择', note: '10 题一组'}, {id: 'vf', name: '词汇语法 · 词形', note: '10 题一组 · 填词'},
    {id: 'rd', name: '阅读 · 短文选择', note: '一篇一组（Task 1–2）'}, {id: 'r3', name: '阅读 · 信息填空', note: '一篇一组（Task 3）'},
    {id: 'r4', name: '阅读 · 术语配对', note: '一组配对（Task 4）'}, {id: 'r5', name: '阅读 · 实用文', note: '一篇一组（Task 5）'},
    {id: 'translation', name: '翻译', note: '4 道选择 + 1 段'}, {id: 'writing', name: '写作', note: '一篇真题作文 · 五档判分'},
    {id: 'listening', name: '听力 Part I', note: '随机一套 · 原录音'},
  ].map(k => {
    const list = open.filter(it => (k.id === 'translation' ? ['tc', 'tp'].includes(it.group) : k.id === 'writing' ? it.group === 'wr' : k.id === 'listening' ? LISTEN(it.qkind) : it.group === k.id));
    return {...k, ...stat(list)};
  });
  const wrong = items.filter(it => rec[it.id]?.ok === false && !LISTEN(it.qkind)).length;
  const papers = Object.values(bank.load().papers);
  return {
    total: items.length, open: open.length, tagged: items.filter(i => i.point).length, wrong, unclassified: items.filter(i => i.point === UNCLASSIFIED).length,
    areas: AREAS, points: ranked, allPoints: points, kinds,
    modules: PAPER_MODULES.map(m => ({...m, ...stat(moduleList(open, m.id))})),
    random: stat(open.filter(it => SINGLE.has(it.qkind))),
    reserved: reservedAll.map(id => ({paperId: id, title: papers.find(p => p.paperId === id)?.title || id, locked: reserved.has(id)})),
    papers: papers.length,
  };
}

// 前端拿到的题（没有答案 / 解析 / 录音原文）
export function publicItem(it, {withMaterial = false, materials = {}} = {}) {
  return {
    itemId: it.id, qkind: it.qkind, group: it.group, no: it.no, prompt: it.stem, ...(it.options ? {options: it.options} : {}), ...(it.base ? {base: it.base} : {}),
    paper: it.title, paperId: it.paperId, part: it.part, section: it.section, point: it.point || null, difficulty: it.difficulty || null,
    ...(it.material ? {material: it.material} : {}), ...(withMaterial && it.material ? {materialText: materials[it.material] || ''} : {}),
  };
}

// 标准答案的展示文字
export function keyText(it) {
  if (it.options) return `${'ABCD'[it.answer]}. ${it.options[it.answer]}`;
  if (it.qkind === 'term-match') return clean(it.answer, 4);
  if (Array.isArray(it.answer)) return it.answer.join(' / ');
  if (it.reference) return it.reference;
  return clean(it.answer, 300);
}

// 刷题进度分桶键：每个模块 / 题型 / 考点 / 随机 / 错题独立保存进度，互不覆盖。
export function practiceBucket({mode = 'random', kind = '', point = '', module = ''} = {}) {
  const m = clean(mode, 20);
  const mod = clean(module, 40);
  const k = clean(kind, 40);
  const pt = clean(point, 120);
  if (m === 'listening' || (m === 'module' && mod === 'listening') || (m === 'kind' && k === 'listening')) return 'module:listening';
  if (m === 'module' && mod) return `module:${mod}`;
  if (m === 'kind' && k) return `kind:${k}`;
  if (m === 'point' && pt) return `point:${pt}`;
  if (m === 'wrong') return 'wrong';
  return 'random';
}
function draftCountOf(set) {
  if (!set?.drafts || typeof set.drafts !== 'object') return 0;
  const ans = set.answers || {};
  let n = 0;
  for (const [k, v] of Object.entries(set.drafts)) {
    if (ans[k]) continue;
    if (typeof v === 'number' || (typeof v === 'string' && v.trim())) n += 1;
  }
  return n;
}
function hasProgress(set) {
  if (!set || set.finished || set.abandoned || !set.items?.length) return false;
  if (Object.keys(set.answers || {}).length > 0) return true;
  if (draftCountOf(set) > 0) return true;
  if ((Number(set.audioTime) || 0) > 5) return true;
  if (set.crossed && typeof set.crossed === 'object' && Object.values(set.crossed).some(arr => Array.isArray(arr) && arr.length > 0)) return true;
  return false;
}
function openSummary(set) {
  const done = Object.keys(set.answers || {}).length;
  const total = (set.items || []).length;
  return {
    setId: set.setId,
    bucket: practiceBucket(set),
    mode: set.mode,
    kind: set.kind || '',
    point: set.point || '',
    module: set.module || '',
    title: set.title,
    done,
    total,
    draftCount: draftCountOf(set),
    audioTime: Math.max(0, Math.floor(Number(set.audioTime) || 0)),
    cursor: Number.isInteger(set.cursor) ? set.cursor : null,
    updatedAt: set.updatedAt || set.at || 0,
    at: set.at || 0,
  };
}

// ---------- 刷题一组（挂在 LearningGame 上）----------
export class GamePractice {
  constructor(game) {
    this.game = game;
    game.modules.practice = this;
    this.bank = new QuestionBank({root: game.root, requestModel: game.requestModel, now: () => game.now()});
    this.grading = new Map();
    this.explaining = new Map();
  }
  get economy() { return this.game.economy; }
  now() { return this.game.now(); }
  ensure(state) {
    state.practice ||= {rec: {}, sets: {}, unlocked: {}};
    state.practice.rec ||= {}; state.practice.sets ||= {}; state.practice.unlocked ||= {};
    return state.practice;
  }
  // 交过整卷的真题自动解锁留卷
  unlockedOf(state) {
    const p = this.ensure(state);
    const out = {...p.unlocked};
    for (const a of Object.values(state.exam?.attempts || {})) if (a.submittedAt) out[a.paperId] = true;
    return out;
  }
  // 按模块/题型/考点分桶找出每类最近一组「有真实进度且未结算」的刷题。
  openByBucket(state) {
    const sets = this.ensure(state).sets || {};
    const out = {};
    for (const set of Object.values(sets)) {
      if (!hasProgress(set)) continue;
      const b = practiceBucket(set);
      const prev = out[b];
      if (!prev || (set.updatedAt || set.at || 0) >= (prev.updatedAt || prev.at || 0)) out[b] = set;
    }
    return out;
  }
  // App 里自己补标：有没标的题、有模型、没在跑 → 后台标
  kickTags() {
    if (!this.game.requestModel || this.bank.job || this.game.autoReal === false) return;
    if (this.bank.untagged().length) this.bank.tagAll().catch(() => {});
  }

  overview() {
    const state = this.game.read();
    const p = this.ensure(state);
    this.kickTags();
    const ov = overview(this.bank, {rec: p.rec, unlocked: this.unlockedOf(state)});
    const byBucket = this.openByBucket(state);
    const pickOpen = key => (byBucket[key] ? openSummary(byBucket[key]) : null);
    const inProgress = Object.values(byBucket).map(openSummary).sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      ...ov,
      random: {...ov.random, open: pickOpen('random')},
      wrongOpen: pickOpen('wrong'),
      modules: (ov.modules || []).map(m => ({...m, open: pickOpen(`module:${m.id}`)})),
      kinds: (ov.kinds || []).map(k => ({...k, open: pickOpen(k.id === 'listening' ? 'module:listening' : `kind:${k.id}`)})),
      points: (ov.points || []).map(pt => ({...pt, open: pickOpen(`point:${pt.id}`)})),
      inProgress,
      tagging: {...this.bank.status, untagged: this.bank.untagged().length},
    };
  }
  unlock({paperId} = {}) {
    const id = clean(paperId, 60);
    if (!this.bank.reservedPapers().includes(id)) throw new Error('这套卷不是留卷');
    return this.game.mutate(state => { this.ensure(state).unlocked[id] = this.now(); return {ok: true}; });
  }
  // 某个考点 / 区域的真题够不够（营地「练」和地图守关用）
  countFor({point = '', group = ''} = {}) {
    const state = this.game.read();
    const reserved = new Set(this.bank.reservedPapers().filter(id => !this.unlockedOf(state)[id]));
    const [g, ...rest] = String(point).split('/');
    const name = rest.join('/');
    return this.bank.load().items.filter(it => !reserved.has(it.paperId) && (point ? it.group === g && it.point === name : it.group === group)).length;
  }
  // 弱项考点（做过 ≥3 题、正确率最低的；没有就题最多的没做过的）
  weakPoint(state = this.game.read(), groups = null) {
    const p = this.ensure(state);
    const ov = overview(this.bank, {rec: p.rec, unlocked: this.unlockedOf(state)});
    return ov.points.find(x => x.total >= 5 && (!groups || groups.includes(x.group))) || null;
  }
  // 地图节点 → 考点：节点名 / 简介里提到了哪个考点就用哪个；否则这个区域里最弱的考点
  pointForNode(node, state = this.game.read()) {
    if (!node) return null;
    const groups = REGION_GROUPS[node.region] || [];
    const text = `${node.name || ''} ${node.summary || ''}`;
    for (const gid of groups) for (const name of GROUP[gid].points) {
      const keys = [name, ...(ALIAS[name] || [])].map(k => k.replace(/（.*?）|\s|\//g, '')).filter(k => k.length >= 2);
      if (keys.some(k => text.includes(k))) return {id: pointId(gid, name), name, group: gid};
    }
    const weak = this.weakPoint(state, groups);
    return weak ? {id: weak.id, name: weak.name, group: weak.group} : null;
  }
  // 营地「练」那一行 / 「出发」：今天上过课 → 这节课的考点；没上课 → 弱项考点
  suggest(state = this.game.read(), {nodeId = ''} = {}) {
    const world = this.game.modules.world;
    const today = this.game.today();
    const lesson = state.lastLesson?.date === today ? state.lastLesson : null;
    const nid = clean(nodeId, 80) || lesson?.nodeId || '';
    if (nid && world?.findNode) {
      const node = world.findNode(state, nid);
      const pt = this.pointForNode(node, state);
      if (pt && this.countFor({point: pt.id}) >= 5) return {point: pt.id, name: pt.name, reason: nodeId ? 'node' : 'lesson', nodeId: nid, lesson: node?.name || lesson?.name || ''};
    }
    const weak = this.weakPoint(state);
    return weak ? {point: weak.id, name: weak.name, reason: 'weak', nodeId: '', acc: weak.acc} : null;
  }
  // 守关卷用的真题：这个区域的单选（不带文章），没做过 / 做错过的优先，最多 12 道
  guardItems(region) {
    const pts = GUARD_POINTS[region];
    if (!pts) return [];
    const state = this.game.read();
    const p = this.ensure(state);
    const reserved = new Set(this.bank.reservedPapers().filter(id => !this.unlockedOf(state)[id]));
    const list = this.bank.load().items.filter(it => it.options && !it.material && !reserved.has(it.paperId) && pts.some(([g, names]) => it.group === g && (!names || names.includes(it.point))));
    return rankItems(list, p.rec, {now: this.now(), seed: E.seedFrom('guard', region, this.game.today())}).slice(0, 12)
      .map(it => ({stem: it.stem, options: it.options, answer: it.answer, why: it.why || '', point: it.point || GROUP[it.group].name, source: `${it.title}${it.no ? ' 第 ' + it.no + ' 题' : ''}`, bankId: it.id}));
  }

  start({mode = 'random', kind = '', point = '', module = '', count = 10, nodeId = '', requestId, fresh = false, setId = ''} = {}) {
    const explicitId = clean(setId, 40);
    if (explicitId) {
      const target = this.ensure(this.game.read()).sets[explicitId];
      if (target && !target.finished && !target.abandoned && target.items?.length) {
        this.game.mutate(st => { const s = this.ensure(st).sets[explicitId]; if (s) s.updatedAt = this.now(); });
        return this.decorate({setId: explicitId, resumed: true});
      }
      throw new Error('这组进度不在了');
    }
    if (!requestId) throw new Error('缺少 requestId');
    const done = this.game.read().requests[`practice.start:${clean(requestId, 120)}`];
    if (done) return this.decorate(done.result);
    const state = this.game.read();
    const p = this.ensure(state);
    const bucket = practiceBucket({mode, kind, point, module});
    if (!fresh) {
      const open = this.openByBucket(state)[bucket];
      if (open) {
        const res = this.game.once('practice.start', requestId, st => {
          const s = this.ensure(st).sets[open.setId];
          if (s) s.updatedAt = this.now();
          return {setId: open.setId, resumed: true};
        });
        return this.decorate(res);
      }
    }
    const exam = this.game.modules.exam;
    const audioOk = id => Boolean(exam?.audioPresent?.(id));
    const rec = practiceRecords(p);
    const r = pick(this.bank, {mode, kind, point, module, count, rec, unlocked: this.unlockedOf(state), now: this.now(), seed: E.seedFrom('practice', requestId), audioOk});
    if (!r.items.length) {
      const why = mode === 'wrong' ? '刷题里还没有做错的真题。' : mode === 'random' ? '真题单题都在 7 天内做对过了，换个考点或题型。' : mode === 'listening' || (mode === 'module' && module === 'listening') ? '本机还没有原录音（插一次 U 盘，碧琪会拷过来）。' : mode === 'module' ? '这一部分现在没有可做的题。' : '这一类题现在没有可做的（7 天内做对的不重复出）。';
      return {setId: null, empty: true, why};
    }
    const title = titleFor({mode, kind, point, module, items: r.items});
    const res = this.game.once('practice.start', requestId, st => {
      const pr = this.ensure(st);
      if (!pr.drawsTracked) {
        pr.rec = rec;
        pr.drawsTracked = true;
      }
      if (fresh) {
        for (const s of Object.values(pr.sets)) {
          if (s && !s.finished && !s.abandoned && practiceBucket(s) === bucket) s.abandoned = this.now();
        }
      }
      const newSetId = `pr-${randomUUID().slice(0, 12)}`;
      const itemIds = r.items.map(item => item.id);
      for (const id of itemIds) pr.rec[id] = {...pr.rec[id], draws: drawnCount(pr.rec[id]) + 1};
      const ts = this.now();
      pr.sets[newSetId] = {setId: newSetId, mode, kind, point, module: clean(module, 40), title, at: ts, updatedAt: ts, items: itemIds, answers: {}, drafts: {}, crossed: {}, cursor: 0, audioTime: 0, combo: 0, maxCombo: 0, shield: false, nodeId: clean(nodeId, 80) || null, paperId: r.paperId || null, finished: null};
      const keys = Object.keys(pr.sets);
      if (keys.length > 100) {
        // 优先清理已结束 / 已放弃 / 无真实进度的旧组，保护所有尚有进度的模块
        const evictable = keys.filter(k => k !== newSetId && !hasProgress(pr.sets[k])).sort((a, b) => (pr.sets[a].updatedAt || pr.sets[a].at || 0) - (pr.sets[b].updatedAt || pr.sets[b].at || 0));
        for (const k of evictable.slice(0, Math.max(0, keys.length - 80))) delete pr.sets[k];
      }
      return {setId: newSetId, resumed: false};
    });
    return this.decorate(res);
  }
  // 公开版的一组（同一 requestId 重放也能拿到；录音 key 现发）
  decorate(res) {
    if (!res?.setId) return res;
    const set = this.ensure(this.game.read()).sets[res.setId];
    if (!set) throw new Error('这组题不在了');
    const {materials} = this.bank.load();
    const items = set.items.map(id => this.bank.item(id)).filter(Boolean);
    const mats = {};
    for (const it of items) if (it.material) mats[it.material] = materials[it.material] || '';
    let audio = null;
    if ((set.mode === 'listening' || (set.mode === 'module' && set.module === 'listening')) && set.paperId) audio = this.game.modules.exam?.audioFor?.(this.game.modules.exam.readFull(set.paperId)) || null;
    const itemMap = new Map(items.map(it => [it.id, it]));
    return {setId: set.setId, bucket: practiceBucket(set), mode: set.mode, kind: set.kind, point: set.point, module: set.module || '', title: set.title, items: items.map(it => publicItem(it)), materials: mats, audio,
      answered: Object.fromEntries(Object.entries(set.answers).map(([k, v]) => [k, publicResult(v, itemMap.get(k)?.qkind)])),
      drafts: set.drafts && typeof set.drafts === 'object' ? {...set.drafts} : {},
      crossed: set.crossed && typeof set.crossed === 'object' ? {...set.crossed} : {},
      cursor: Number.isInteger(set.cursor) ? set.cursor : null,
      audioTime: Number(set.audioTime) || 0,
      updatedAt: set.updatedAt || set.at || 0,
      resumed: Boolean(res.resumed),
      finished: set.finished};
  }
  // 最近一组还没结算的刷题（可按模块/桶筛选）。关掉学习台再打开，前端靠这个接回做到的那一题。
  current(params = {}) {
    const state = this.game.read();
    const hasFilter = Boolean(params?.bucket || params?.mode || params?.module || params?.kind || params?.point);
    if (hasFilter) {
      const target = clean(params.bucket, 160) || practiceBucket(params);
      const hit = this.openByBucket(state)[target];
      return hit ? this.decorate({setId: hit.setId, resumed: true}) : {setId: null};
    }
    const sets = Object.values(this.ensure(state).sets).filter(set => set && !set.finished && !set.abandoned && set.items?.length);
    const open = sets.sort((a, b) => Number(hasProgress(b)) - Number(hasProgress(a)) || (b.updatedAt || b.at || 0) - (a.updatedAt || a.at || 0))[0];
    return open ? this.decorate({setId: open.setId, resumed: true}) : {setId: null};
  }
  // 保存未提交草稿（选项、填空、作文/译文、术语配对、划掉干扰项、当前题号、听力进度），跨刷新/重开不丢。
  saveDraft({setId, drafts, crossed, cursor, audioTime, replace = false} = {}) {
    const sid = clean(setId, 40);
    if (!sid) throw new Error('缺少 setId');
    return this.game.mutate(state => {
      const set = this.ensure(state).sets[sid];
      if (!set || set.finished || set.abandoned) return {ok: false};
      const itemSet = new Set(set.items || []);
      if (drafts && typeof drafts === 'object') {
        const next = replace ? {} : {...(set.drafts || {})};
        for (const [k, v] of Object.entries(drafts).slice(0, 120)) {
          const iid = clean(k, 80);
          if (!itemSet.has(iid) || set.answers?.[iid]) { delete next[iid]; continue; }
          if (v == null || v === '') { delete next[iid]; continue; }
          if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 26) next[iid] = v;
          else if (typeof v === 'string') {
            const val = v.replace(/\u0000/g, '').slice(0, 4000);
            if (val.trim()) next[iid] = val; else delete next[iid];
          }
        }
        set.drafts = next;
      }
      if (crossed && typeof crossed === 'object') {
        const nextC = {};
        for (const [k, arr] of Object.entries(crossed).slice(0, 30)) {
          if (!Array.isArray(arr)) continue;
          const cleanArr = [...new Set(arr.map(x => clean(x, 2).toUpperCase()).filter(x => /^[A-Z]$/.test(x)))];
          if (cleanArr.length) nextC[clean(k, 120)] = cleanArr;
        }
        set.crossed = nextC;
      }
      if (Number.isInteger(cursor) && cursor >= 0 && cursor <= (set.items?.length || 0)) set.cursor = cursor;
      const atSec = Number(audioTime);
      if (Number.isFinite(atSec) && atSec >= 0) set.audioTime = Math.round(atSec * 10) / 10;
      set.updatedAt = this.now();
      return {ok: true, updatedAt: set.updatedAt, draftCount: draftCountOf(set)};
    });
  }
  // 主动放弃某组（或某桶）未完成进度，下次再进会重新抽题。
  abandon({setId = '', bucket = ''} = {}) {
    const sid = clean(setId, 40);
    const b = clean(bucket, 160);
    return this.game.mutate(state => {
      const sets = this.ensure(state).sets || {};
      let count = 0;
      if (sid && sets[sid] && !sets[sid].finished) {
        sets[sid].abandoned = this.now();
        count += 1;
      } else if (b) {
        for (const s of Object.values(sets)) {
          if (s && !s.finished && !s.abandoned && practiceBucket(s) === b) {
            s.abandoned = this.now();
            count += 1;
          }
        }
      }
      return {ok: true, abandoned: count};
    });
  }

  // 交一题。客观题马上判；翻译段落 / 写作要模型阅卷（异步，最多 60 秒）。
  async answer({setId, itemId, answer} = {}) {
    const sid = clean(setId, 40), iid = clean(itemId, 80);
    const snap = this.ensure(this.game.read()).sets[sid];
    if (!snap) throw new Error('这组题不在了');
    if (!snap.items.includes(iid)) throw new Error('这道题不在这组里');
    if (snap.answers[iid]) return publicResult(snap.answers[iid], this.bank.item(iid)?.qkind);
    const it = this.bank.item(iid);
    if (!it) throw new Error('题库里没有这道题了');
    let correct, grade = null;
    if (SUBJECTIVE.has(it.qkind)) {
      grade = await this.gradeSubjective(it, clean(answer, 4000));
      correct = grade.score >= Math.ceil(grade.max * 0.6);
    } else correct = gradeObjective(it.qkind, it, typeof answer === 'number' ? answer : clean(answer, 200));
    return this.game.mutate(state => {
      const pr = this.ensure(state);
      const set = pr.sets[sid];
      if (!set) throw new Error('这组题不在了');
      if (set.answers[iid]) return publicResult(set.answers[iid], it.qkind);
      const form = this.game.form(state);
      const date = this.game.today();
      const d = this.game.day(state, date);
      const rec = pr.rec[iid] || {n: 0};
      // 星星：7 天内做对过的题不给（防刷）；本组第一次交这题
      const fresh = !(rec.ok && this.now() - (rec.okAt || 0) < FRESH_DAYS * DAY);
      const awards = [];
      d.answers += 1; d.realAnswers = (d.realAnswers || 0) + 1;
      if (correct) {
        d.correct += 1; d.realCorrect = (d.realCorrect || 0) + 1; state.stats.realCorrect = (state.stats.realCorrect || 0) + 1;
        if (fresh) {
          const v = E.boosted(this.economy.earn.realAnswer ?? this.economy.earn.answer, {event: 'realAnswer', form, economy: this.economy}).value;
          if (v) awards.push({kind: 'stars', amount: v, reason: '真题答对', fx: 'small'});
        }
        set.combo += 1; set.maxCombo = Math.max(set.maxCombo, set.combo);
        state.stats.maxCombo = Math.max(state.stats.maxCombo, set.combo);
        const c = E.comboStars(set.combo, {form, economy: this.economy});
        if (c.stars && fresh) awards.push({kind: 'stars', amount: c.stars, reason: c.ult ? `连击 ${set.combo} · 碧琪大招` : `连击 ${set.combo}`, fx: c.ult ? 'cinematic' : 'medium'});
        if (c.ult) { state.stats.ults += 1; d.ults = (d.ults || 0) + 1; }
      } else if (form?.bonus?.kind === 'comboShield' && !set.shield && set.combo > 0) {
        set.shield = true; // 幻形灵：一组里第一次答错不断连击
      } else set.combo = 0;
      pr.rec[iid] = {...rec, n: (rec.n || 0) + 1, ok: Boolean(correct), at: this.now(), okAt: correct ? this.now() : rec.okAt || 0};
      const out = this.game.grant(state, `real:${sid}:${iid}`, {type: 'real', id: sid}, awards);
      // 做错 → 错题怪（真题当种子，讨伐时出变体）。听力、写作、翻译段落不生怪（变体题出不了）。
      let monster = null;
      if (!correct && !SUBJECTIVE.has(it.qkind) && !LISTEN(it.qkind)) {
        const mat = it.material ? clean(this.bank.load().materials[it.material], 1200) : '';
        const m = this.game.modules.monsters?.spawn(state, {key: `real:${it.id}`, subject: '英语', topic: it.point && it.point !== UNCLASSIFIED ? it.point : GROUP[it.group]?.name || '真题',
          question: mat && it.qkind !== 'term-match' ? `${mat}\n\n${it.stem}` : it.qkind === 'term-match' ? `${it.stem}（候选：${mat.slice(0, 600)}）` : it.stem,
          answer: it.options ? it.options[it.answer] : [].concat(it.answer)[0], options: it.options || null, source: {type: 'real', id: sid}});
        if (m) monster = {id: m.id, name: m.name};
      }
      const res = {itemId: iid, correct: Boolean(correct), key: keyText(it), why: it.why || '', script: it.script || '', grade, combo: set.combo, awards: out, monster, given: typeof answer === 'number' ? answer : clean(answer, 600)};
      if (it.options) res.answer = it.answer;
      set.answers[iid] = res;
      if (set.drafts) delete set.drafts[iid];
      set.updatedAt = this.now();
      this.game.questTick(state);
      return publicResult(res, it.qkind);
    });
  }
  async gradeSubjective(it, text) {
    const max = it.qkind === 'writing' ? 15 : 12;
    if (!clean(text) || fold(text) === fold(it.stem)) return {score: 0, max, reason: '没有作答（或只抄了题目）。', source: 'local', reference: it.reference || ''};
    const r = await modelJson(this.game.requestModel, GRADE_RULES, {kind: it.qkind, task: it.stem, reference: it.reference, rubric: it.rubric, max, answer: text}, {
      validate: v => (Number.isInteger(Number(v?.score)) && Number(v.score) >= 0 && Number(v.score) <= max ? {score: Number(v.score), reason: clean(v.reason, 300)} : null), timeoutMs: 60000, maxTokens: 800, reasoningEffort: 'low',
    });
    if (r) return {...r.value, max, source: 'model', reference: it.reference || ''};
    if (!this.game.requestModel) return {score: 0, max, reason: '碧琪现在没法阅卷（内置模型不在线），先对照参考答案自己看。', source: 'none', reference: it.reference || ''};
    return {score: Math.min(Math.floor(max * 0.4), Math.floor(clean(text).split(/\s+/).length / 20)), max, reason: '碧琪这会儿没法细看，先按字数给了保守分。', source: 'local', reference: it.reference || ''};
  }
  // 「讲给我听」/「带读+搭配」：标准答案是官方的，模型只顺着它讲；两种模式分开缓存，随时切换。
  explain(params = {}) {
    const mode = params.mode === 'read' ? 'read' : 'full';
    const key = JSON.stringify([clean(params.setId, 40), clean(params.itemId, 80), mode]);
    if (this.explaining.has(key)) return this.explaining.get(key);
    const job = this.explainOne({...params, mode}).finally(() => this.explaining.delete(key));
    this.explaining.set(key, job);
    return job;
  }
  async explainOne({setId, itemId, mode = 'full'} = {}) {
    const sid = clean(setId, 40), iid = clean(itemId, 80);
    const kind = mode === 'read' ? 'read' : 'full';
    const field = kind === 'read' ? 'readLecture' : 'lecture';
    const vField = kind === 'read' ? 'readLectureV' : 'lectureV';
    const set = this.ensure(this.game.read()).sets[sid];
    const rec = set?.answers?.[iid];
    if (!rec) throw new Error('先做完这题');
    const it = this.bank.item(iid);
    if (!it) throw new Error('题库里没有这道题了');
    const targetV = explainVersionFor(it.qkind);
    if (rec[field] && rec[vField] === targetV) return {text: rec[field], source: 'model', mode: kind};
    const isSubj = SUBJECTIVE.has(it.qkind);
    const mat = it.material ? clean(this.bank.load().materials[it.material], 1200) : '';
    const yours = it.options && Number.isInteger(Number(rec.given)) ? clean(it.options[Number(rec.given)], 300) : clean(rec.given, isSubj ? 1800 : 300);
    const note = isSubj
      ? [it.why, it.rubric, rec.grade?.reason ? `本次阅卷评语：${rec.grade.reason}` : ''].filter(Boolean).join('\n')
      : (it.why || it.script);
    if (!this.game.requestModel) return {text: '', source: 'offline', error: explainFailure('模型暂时不可用')};
    let failure;
    const validate = v => validVoicedExplain(v, {long: isSubj});
    const maxTokens = isSubj ? 8000 : (useCompactExplain() ? 5200 : 3600);
    const fallbackMaxTokens = isSubj ? 9500 : 5200;
    const r = await modelJson(
      this.game.requestModel,
      explainRulesFor({mode: kind, qkind: it.qkind}),
      explainInput({question: `${mat ? mat + '\n\n' : ''}${it.stem}`, options: it.options, standard: keyText(it), note, yours, correct: rec.correct, qkind: it.qkind, point: it.point, base: it.base}),
      {validate, retries: 1, timeoutMs: isSubj ? 180000 : 120000, maxTokens, directPayload: true, reasoningEffort: 'low', stopOnQuota: true, ...(useCompactExplain() ? {} : {fallbackMaxTokens, fallbackRules: compactExplainRules({mode: kind, qkind: it.qkind}), onFallback: markCompactExplain}), onFailure: error => { failure = error; }},
    );
    if (!r) {
      this.game.logger?.warn?.(`practice.explain failed (${iid}, ${it.qkind}, mode=${kind}): ${failure?.message || failure || 'empty'}`);
      return {text: '', source: 'none', error: explainFailure(failure)};
    }
    this.game.mutate(state => { const row = this.ensure(state).sets[sid]?.answers?.[iid]; if (row) { row[field] = r.value.text; row[vField] = targetV; } });
    return {text: r.value.text, source: 'model', mode: kind};
  }
  finish({setId} = {}) {
    const sid = clean(setId, 40);
    const out = this.game.mutate(state => {
      const pr = this.ensure(state);
      const set = pr.sets[sid];
      if (!set) throw new Error('这组题不在了');
      if (set.finished) return {...set.finished, again: true};
      const rows = Object.values(set.answers);
      const scored = rows.length, correct = rows.filter(r => r.correct).length;
      const form = this.game.form(state);
      const d = this.game.day(state);
      const firstSetToday = d.sets === 0;
      const awards = E.setStars({scored, correct, firstSetToday, form, economy: this.economy}).map(p => ({kind: 'stars', amount: p.value, reason: p.reason === '这一组背完了' ? '这一组真题做完了' : p.reason, fx: 'medium'}));
      const counted = scored >= this.economy.earn.setFinishMinScored || (scored >= 1 && set.items.length <= 2 && scored === set.items.length);
      if (counted) {
        d.sets += 1; d.realSets = (d.realSets || 0) + 1; state.stats.setsDone += 1;
        if (correct === scored) { state.stats.perfectSets += 1; d.perfectSets = (d.perfectSets || 0) + 1; }
      }
      const granted = this.game.grant(state, `realset:${sid}`, {type: 'real', id: sid}, counted ? awards : []);
      // 从地图节点 / 营地「练」进来的：≥80% 点亮那个节点
      if (set.nodeId && scored >= 5) granted.push(...(this.game.modules.world?.nodePass?.(state, set.nodeId, correct / scored, `real:${sid}`) || []));
      set.finished = {scored, correct, total: set.items.length, maxCombo: set.maxCombo, awards: granted, counted};
      set.drafts = {};
      set.updatedAt = this.now();
      this.game.questTick(state);
      return set.finished;
    });
    if (out.counted && !out.again) { try { this.game.store?.pact?.recordDrill?.({finished: true}); } catch { /* 手账不影响刷题 */ } }
    return out;
  }
}

function titleFor({mode, kind, point, module, items}) {
  if (mode === 'random') return '随机 10 题';
  if (mode === 'wrong') return '错题重刷';
  if (mode === 'listening') return `听力 Part I · ${items[0]?.title || ''}`;
  if (mode === 'module') {
    const modName = PAPER_MODULES.find(m => m.id === module)?.name || '试卷模块';
    const one = items.length && items.every(i => i.paperId === items[0].paperId);
    return `${modName} · ${one && items[0]?.title ? items[0].title : '跨年混刷'}`;
  }
  if (mode === 'point') { const [g, ...rest] = String(point).split('/'); return `${GROUP[g]?.name || ''} · ${rest.join('/')}`; }
  const names = {vc: '词汇语法 · 选择', vf: '词汇语法 · 词形', rd: '阅读 · 短文选择', r3: '阅读 · 信息填空', r4: '阅读 · 术语配对', r5: '阅读 · 实用文', translation: '翻译', writing: '写作'};
  const one = items.length && items.every(i => i.paperId === items[0].paperId);
  return `${names[kind] || '真题'}${one ? ' · ' + items[0].title : ''}`;
}
function publicResult(r, qkind = '') {
  if (!r) return r;
  const {lecture, lectureV, readLecture, readLectureV, ...rest} = r;
  const targetV = explainVersionFor(qkind);
  const lectures = {};
  if (lecture && lectureV === targetV) lectures.full = lecture;
  if (readLecture && readLectureV === targetV) lectures.read = readLecture;
  if (Object.keys(lectures).length) rest.lectures = lectures;
  return rest;
}
