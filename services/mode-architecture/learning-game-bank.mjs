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
import {explainRulesFor, compactExplainRules, markCompactExplain, useCompactExplain, explainRules, validVoicedExplain, explainFailure, EXPLAIN_VERSION} from './learning-explain-voice.mjs';
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
// rec = 做题记录 {itemId: {n, ok, at, okAt}}；规则：没做过优先 → 做错过（最近一次错）→ 做对过但超过 7 天；7 天内做对的不出。
export function rankItems(items, rec, {now = Date.now(), seed = 1} = {}) {
  const rng = E.mulberry32(seed >>> 0);
  const scored = items.map(it => {
    const r = rec[it.id];
    let tier;
    if (!r || !r.n) tier = 0;
    else if (r.ok === false) tier = 1;
    else if (now - (r.okAt || r.at || 0) >= FRESH_DAYS * DAY) tier = 2;
    else tier = 9;
    return {it, tier, k: rng()};
  }).filter(x => x.tier < 9);
  scored.sort((a, b) => a.tier - b.tier || a.k - b.k);
  return scored.map(x => x.it);
}

// mode: random | kind | point | wrong | listening
// kind（按题型）：vc / vf / rd / r3 / r4 / r5 / translation / writing
export function pick(bank, {mode = 'random', kind = '', point = '', count = 10, seed = 1, rec = {}, unlocked = {}, now = Date.now(), audioOk = () => true} = {}) {
  const {items} = bank.load();
  const reserved = new Set(bank.reservedPapers().filter(id => !unlocked[id]));
  const open = items.filter(it => !reserved.has(it.paperId));
  const n = Math.max(1, Math.min(20, Number(count) || 10));
  const rank = list => rankItems(list, rec, {now, seed});
  if (mode === 'random') return {items: rank(open.filter(it => SINGLE.has(it.qkind))).slice(0, n)};
  if (mode === 'wrong') {
    const wrong = items.filter(it => rec[it.id]?.ok === false && !LISTEN(it.qkind));
    wrong.sort((a, b) => (rec[b.id].at || 0) - (rec[a.id].at || 0));
    return {items: wrong.slice(0, n)};
  }
  if (mode === 'point') {
    const [group, ...rest] = String(point).split('/');
    const name = rest.join('/');
    const list = open.filter(it => it.group === group && (name === UNCLASSIFIED ? it.point === UNCLASSIFIED : it.point === name) && !LISTEN(it.qkind));
    // 写作 / 翻译段落一组一篇
    const big = list.filter(it => SUBJECTIVE.has(it.qkind));
    if (big.length && big.length === list.length) return {items: rank(big).slice(0, 1)};
    return {items: rank(list.filter(it => !SUBJECTIVE.has(it.qkind))).slice(0, n)};
  }
  if (mode === 'listening') {
    // 随机一套的 Part I（要有原录音）；没做过的套优先
    const papers = [...new Set(open.filter(it => LISTEN(it.qkind)).map(it => it.paperId))].filter(id => audioOk(id));
    const ranked = rankPapers(papers, open, rec, seed, it => LISTEN(it.qkind));
    const pid = ranked[0];
    return {items: pid ? open.filter(it => it.paperId === pid && LISTEN(it.qkind)) : [], paperId: pid || null};
  }
  if (mode === 'kind') {
    if (['vc', 'vf'].includes(kind)) return {items: rank(open.filter(it => it.group === kind)).slice(0, n)};
    if (['rd', 'r3', 'r4', 'r5'].includes(kind)) {
      // 阅读一篇一组：按「卷 + 小节」成组，挑没做过的篇
      const groups = new Map();
      for (const it of open.filter(x => x.group === kind || (kind === 'rd' && x.group === 'rd'))) { const k = `${it.paperId}|${it.part}`; (groups.get(k) || groups.set(k, []).get(k)).push(it); }
      const keys = [...groups.keys()];
      const rng = E.mulberry32(seed >>> 0);
      const score = k => { const l = groups.get(k); const done = l.filter(it => rec[it.id]?.n).length; return done / l.length + rng() * 0.01; };
      keys.sort((a, b) => score(a) - score(b));
      return {items: keys.length ? groups.get(keys[0]) : []};
    }
    if (kind === 'translation') {
      const choices = rank(open.filter(it => it.qkind === 'translate-choice')).slice(0, 4);
      const passage = rank(open.filter(it => it.qkind === 'translate-passage')).slice(0, 1);
      return {items: [...choices, ...passage]};
    }
    if (kind === 'writing') return {items: rank(open.filter(it => it.qkind === 'writing')).slice(0, 1)};
  }
  return {items: []};
}
function rankPapers(ids, items, rec, seed, filter) {
  const rng = E.mulberry32(seed >>> 0);
  const done = id => { const l = items.filter(it => it.paperId === id && filter(it)); return l.length ? l.filter(it => rec[it.id]?.n).length / l.length : 1; };
  return ids.map(id => ({id, s: done(id) + rng() * 0.01})).sort((a, b) => a.s - b.s).map(x => x.id);
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
    return {...ov, tagging: {...this.bank.status, untagged: this.bank.untagged().length}};
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
    return weak ? {point: weak.id, name: weak.name, groupName: weak.groupName || '', reason: 'weak', nodeId: '', acc: weak.acc} : null;
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

  start({mode = 'random', kind = '', point = '', count = 10, nodeId = '', requestId} = {}) {
    if (!requestId) throw new Error('缺少 requestId');
    const done = this.game.read().requests[`practice.start:${clean(requestId, 120)}`];
    if (done) return this.decorate(done.result);
    const state = this.game.read();
    const p = this.ensure(state);
    const exam = this.game.modules.exam;
    const audioOk = id => Boolean(exam?.audioPresent?.(id));
    const r = pick(this.bank, {mode, kind, point, count, rec: p.rec, unlocked: this.unlockedOf(state), now: this.now(), seed: E.seedFrom('practice', requestId), audioOk});
    if (!r.items.length) {
      const why = mode === 'wrong' ? '刷题里还没有做错的真题。' : mode === 'random' ? '真题单题都在 7 天内做对过了，换个考点或题型。' : mode === 'listening' ? '本机还没有原录音（插一次 U 盘，碧琪会拷过来）。' : '这一类题现在没有可做的（7 天内做对的不重复出）。';
      return {setId: null, empty: true, why};
    }
    const title = titleFor({mode, kind, point, items: r.items});
    const res = this.game.once('practice.start', requestId, st => {
      const pr = this.ensure(st);
      const setId = `pr-${randomUUID().slice(0, 12)}`;
      pr.sets[setId] = {setId, mode, kind, point, title, at: this.now(), items: r.items.map(i => i.id), answers: {}, combo: 0, maxCombo: 0, shield: false, nodeId: clean(nodeId, 80) || null, paperId: r.paperId || null, finished: null, ...battleStart(this.game.form(st), {mode, count: r.items.length})};
      const keys = Object.keys(pr.sets);
      if (keys.length > 80) for (const k of keys.sort((a, b) => pr.sets[a].at - pr.sets[b].at).slice(0, keys.length - 60)) delete pr.sets[k];
      return {setId};
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
    if (set.mode === 'listening' && set.paperId) audio = this.game.modules.exam?.audioFor?.(this.game.modules.exam.readFull(set.paperId)) || null;
    return {setId: set.setId, mode: set.mode, kind: set.kind, point: set.point, title: set.title, items: items.map(it => publicItem(it)), materials: mats, audio,
      answered: Object.fromEntries(Object.entries(set.answers).map(([k, v]) => [k, publicResult(v)])), finished: set.finished, battle: publicBattle(set)};
  }

  // 交一题。客观题马上判；翻译段落 / 写作要模型阅卷（异步，最多 60 秒）。
  async answer({setId, itemId, answer} = {}) {
    const sid = clean(setId, 40), iid = clean(itemId, 80);
    const snap = this.ensure(this.game.read()).sets[sid];
    if (!snap) throw new Error('这组题不在了');
    if (!snap.items.includes(iid)) throw new Error('这道题不在这组里');
    if (snap.answers[iid]) return publicResult(snap.answers[iid]);
    if (snap.hp?.failed) throw new Error('这一组已经打输了，先结算');
    if (snap.hp?.down) throw new Error('碧琪倒下了，先让她站起来');
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
      if (set.answers[iid]) return publicResult(set.answers[iid]);
      const form = this.game.form(state);
      const date = this.game.today();
      const d = this.game.day(state, date);
      const rec = pr.rec[iid] || {n: 0};
      // 星星：7 天内做对过的题不给（防刷）；本组第一次交这题
      const fresh = !(rec.ok && this.now() - (rec.okAt || 0) < FRESH_DAYS * DAY);
      const awards = [];
      const fight = {}; // 这一下在战斗上发生了什么（界面照着演）
      if (set.hp?.failed || set.hp?.down) throw new Error('碧琪倒下了，先让她站起来');
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
        // 「加倍」技能：这一题的星星翻倍（只翻这一题的）
        if (set.double) { set.double = false; fight.doubled = true; for (const a of awards) if (a.kind === 'stars') a.amount *= 2; }
        if (set.skill) set.charge = Math.min(set.skill.cost, (set.charge || 0) + 1);
        // 连对 5 题：缓过一口气，回 1 颗心
        if (set.hp && set.combo % HEAL_COMBO === 0 && set.hp.left < set.hp.max) { set.hp.left += 1; fight.healed = 1; }
      } else if (set.guard) {
        set.guard = false; fight.guarded = true; // 「护盾」技能：这一下不掉心、不断连击
      } else {
        if (form?.bonus?.kind === 'comboShield' && !set.shield && set.combo > 0) set.shield = true; // 幻形灵：一组里第一次答错不断连击
        else set.combo = 0;
        if (set.double) set.double = false;
        if (set.hp) {
          set.hp.left = Math.max(0, set.hp.left - 1); fight.hurt = 1;
          if (!set.hp.left) { if (set.hp.revived) { set.hp.failed = true; fight.failed = true; } else { set.hp.down = true; fight.down = true; } }
        }
      }
      pr.rec[iid] = {n: (rec.n || 0) + 1, ok: Boolean(correct), at: this.now(), ...(correct ? {okAt: this.now()} : {okAt: rec.okAt || 0})};
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
      const res = {itemId: iid, correct: Boolean(correct), key: keyText(it), why: it.why || '', script: it.script || '', grade, combo: set.combo, awards: out, monster, given: typeof answer === 'number' ? answer : clean(answer, 600), ...(set.hp || set.skill ? {battle: {...publicBattle(set), ...fight}} : {})};
      if (it.options) res.answer = it.answer;
      set.answers[iid] = res;
      this.game.questTick(state);
      return publicResult(res);
    });
  }
  // 倒地后站起来：一组一次，回 1 颗心。界面要求先把这组的错题和官方答案看一遍。
  revive({setId} = {}) {
    const sid = clean(setId, 40);
    return this.game.mutate(state => {
      const set = this.ensure(state).sets[sid];
      if (!set) throw new Error('这组题不在了');
      if (set.hp?.failed) throw new Error('这一组已经打输了');
      if (!set.hp?.down) return publicBattle(set);
      if (set.hp.revived) throw new Error('这一组已经站起来过一次了');
      set.hp.down = false; set.hp.revived = true; set.hp.left = 1;
      return publicBattle(set);
    });
  }
  // 放形态技能：攒满才能放。排除 = 当前这题去掉两个错项；回心 = +1 颗心；护盾 = 下一次答错不掉心不断连击；加倍 = 下一题答对星星翻倍。
  skill({setId, itemId} = {}) {
    const sid = clean(setId, 40), iid = clean(itemId, 80);
    return this.game.mutate(state => {
      const set = this.ensure(state).sets[sid];
      if (!set) throw new Error('这组题不在了');
      const sk = set.skill;
      if (!sk) throw new Error('这个形态在这一组里没有技能');
      if (set.hp?.down || set.hp?.failed) throw new Error('碧琪倒下了');
      if ((set.charge || 0) < sk.cost) throw new Error('技能还没攒满');
      const used = {kind: sk.kind};
      if (sk.kind === 'eliminate') {
        const it = set.items.includes(iid) && !set.answers[iid] ? this.bank.item(iid) : null;
        if (!it?.options || it.options.length < 3) throw new Error('这道题没有可以排除的选项，留到选择题再用');
        const wrong = it.options.map((_, k) => k).filter(k => k !== it.answer);
        let seed = E.seedFrom('eliminate', sid, iid) >>> 0;
        while (wrong.length > Math.min(2, it.options.length - 2)) { seed = (seed * 1664525 + 1013904223) >>> 0; wrong.splice(seed % wrong.length, 1); }
        used.remove = wrong; (set.removed ||= {})[iid] = wrong;
      } else if (sk.kind === 'heal') {
        if (!set.hp) throw new Error('这一组不计心');
        if (set.hp.left >= set.hp.max) throw new Error('心是满的，留着');
        set.hp.left += 1; used.healed = 1;
      } else if (sk.kind === 'shield') {
        if (set.guard) throw new Error('护盾还在');
        set.guard = true;
      } else if (sk.kind === 'double') {
        if (set.double) throw new Error('加倍还没用掉');
        set.double = true;
      } else throw new Error('技能无效');
      set.charge = 0; set.skillUsed = (set.skillUsed || 0) + 1;
      return {...publicBattle(set), used};
    });
  }
  async gradeSubjective(it, text) {
    const max = it.qkind === 'writing' ? 15 : 12;
    if (!clean(text) || fold(text) === fold(it.stem)) return {score: 0, max, reason: '没有作答（或只抄了题目）。', source: 'local', reference: it.reference || ''};
    const r = await modelJson(this.game.requestModel, GRADE_RULES, {kind: it.qkind, task: it.stem, reference: it.reference, rubric: it.rubric, max, answer: text}, {
      validate: v => (Number.isInteger(Number(v?.score)) && Number(v.score) >= 0 && Number(v.score) <= max ? {score: Number(v.score), reason: clean(v.reason, 300)} : null), timeoutMs: 60000, maxTokens: 800,
    });
    if (r) return {...r.value, max, source: 'model', reference: it.reference || ''};
    if (!this.game.requestModel) return {score: 0, max, reason: '碧琪现在没法阅卷（内置模型不在线），先对照参考答案自己看。', source: 'none', reference: it.reference || ''};
    return {score: Math.min(Math.floor(max * 0.4), Math.floor(clean(text).split(/\s+/).length / 20)), max, reason: '碧琪这会儿没法细看，先按字数给了保守分。', source: 'local', reference: it.reference || ''};
  }
  // 「讲给我听」：标准答案是官方的，模型只顺着它讲
  explain(params = {}) {
    const key = JSON.stringify([clean(params.setId, 40), clean(params.itemId, 80)]);
    if (this.explaining.has(key)) return this.explaining.get(key);
    const job = this.explainOne(params).finally(() => this.explaining.delete(key));
    this.explaining.set(key, job);
    return job;
  }
  async explainOne({setId, itemId} = {}) {
    const sid = clean(setId, 40), iid = clean(itemId, 80);
    const set = this.ensure(this.game.read()).sets[sid];
    const rec = set?.answers?.[iid];
    if (!rec) throw new Error('先做完这题');
    if (rec.lecture && rec.lectureV === EXPLAIN_VERSION) return {text: rec.lecture, source: 'model'};
    const it = this.bank.item(iid);
    if (!it) throw new Error('题库里没有这道题了');
    const mat = it.material ? clean(this.bank.load().materials[it.material], 1200) : '';
    const yours = it.options && Number.isInteger(Number(rec.given)) ? clean(it.options[Number(rec.given)], 300) : clean(rec.given, 300);
    if (!this.game.requestModel) return {text: '', source: 'offline', error: explainFailure('模型暂时不可用')};
    let failure;
    const r = await modelJson(this.game.requestModel, explainRulesFor(), explainInput({question: `${mat ? mat + '\n\n' : ''}${it.stem}`, options: it.options, standard: keyText(it), note: it.why || it.script, yours, correct: rec.correct}), {validate: validVoicedExplain, retries: 1, timeoutMs: 120000, maxTokens: useCompactExplain() ? 5200 : 1500, directPayload: true, stopOnQuota: true, ...(useCompactExplain() ? {} : {fallbackMaxTokens: 5200, fallbackRules: compactExplainRules(), onFallback: markCompactExplain}), onFailure: error => { failure = error; }});
    if (!r) return {text: '', source: 'none', error: explainFailure(failure)};
    this.game.mutate(state => { const row = this.ensure(state).sets[sid]?.answers?.[iid]; if (row) { row.lecture = r.value.text; row.lectureV = EXPLAIN_VERSION; } });
    return {text: r.value.text, source: 'model'};
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
      const failed = Boolean(set.hp?.failed);
      const counted = !failed && (scored >= this.economy.earn.setFinishMinScored || (scored >= 1 && set.items.length <= 2 && scored === set.items.length));
      if (failed) state.stats.setsLost = (state.stats.setsLost || 0) + 1;
      if (counted) {
        d.sets += 1; d.realSets = (d.realSets || 0) + 1; state.stats.setsDone += 1;
        if (correct === scored) { state.stats.perfectSets += 1; d.perfectSets = (d.perfectSets || 0) + 1; }
      }
      const granted = this.game.grant(state, `realset:${sid}`, {type: 'real', id: sid}, counted ? awards : []);
      // 从地图节点 / 营地「练」进来的：≥80% 点亮那个节点
      if (set.nodeId && scored >= 5 && !failed) granted.push(...(this.game.modules.world?.nodePass?.(state, set.nodeId, correct / scored, `real:${sid}`) || []));
      set.finished = {scored, correct, total: set.items.length, maxCombo: set.maxCombo, awards: granted, counted, ...(set.hp ? {failed, hearts: set.hp.left, heartsMax: set.hp.max, revived: Boolean(set.hp.revived)} : {})};
      this.game.questTick(state);
      return set.finished;
    });
    if (out.counted && !out.again) { try { this.game.store?.pact?.recordDrill?.({finished: true}); } catch { /* 手账不影响刷题 */ } }
    return out;
  }
}

function titleFor({mode, kind, point, items}) {
  if (mode === 'random') return '随机 10 题';
  if (mode === 'wrong') return '错题重刷';
  if (mode === 'listening') return `听力 Part I · ${items[0]?.title || ''}`;
  if (mode === 'point') { const [g, ...rest] = String(point).split('/'); return `${GROUP[g]?.name || ''} · ${rest.join('/')}`; }
  const names = {vc: '词汇语法 · 选择', vf: '词汇语法 · 词形', rd: '阅读 · 短文选择', r3: '阅读 · 信息填空', r4: '阅读 · 术语配对', r5: '阅读 · 实用文', translation: '翻译', writing: '写作'};
  const one = items.length && items.every(i => i.paperId === items[0].paperId);
  return `${names[kind] || '真题'}${one ? ' · ' + items[0].title : ''}`;
}
// ---------- 战斗（v4 第二批）----------
// 碧琪有心：一组 ≥ 5 题、不是听力整套时开。答错掉 1 颗；连对 5 题回 1 颗；掉光倒地，站起来一次（回 1 颗），再掉光这一组算打输（没有整组奖励，不算今天的组数）。
// 已经答对的题的星星照发：打输只丢「这一组做完」那一份，不倒扣。
export const HEAL_COMBO = 5;
export const BASE_HEARTS = 3;
const SKILL_KINDS = new Set(['eliminate', 'heal', 'shield', 'double']);
export function battleStart(form, {mode = 'random', count = 0} = {}) {
  const out = {};
  if (mode !== 'listening' && count >= 5) { const max = BASE_HEARTS + Math.max(0, Math.min(2, Number(form?.skill?.hearts) || 0)); out.hp = {max, left: max, down: false, revived: false, failed: false}; }
  const sk = form?.skill;
  if (sk && SKILL_KINDS.has(sk.kind) && count >= 3) { out.skill = {kind: sk.kind, cost: Math.max(2, Math.min(8, Number(sk.cost) || 4)), name: clean(sk.name, 20), formId: form.id}; out.charge = 0; }
  return out;
}
export function publicBattle(set) {
  if (!set?.hp && !set?.skill) return null;
  return {hp: set.hp ? {max: set.hp.max, left: set.hp.left, down: Boolean(set.hp.down), revived: Boolean(set.hp.revived), failed: Boolean(set.hp.failed)} : null,
    skill: set.skill ? {...set.skill, charge: set.charge || 0, ready: (set.charge || 0) >= set.skill.cost} : null,
    guard: Boolean(set.guard), double: Boolean(set.double), removed: set.removed || {}};
}
function publicResult(r) {
  if (!r) return r;
  const {lecture: _l, ...rest} = r;
  return rest;
}
