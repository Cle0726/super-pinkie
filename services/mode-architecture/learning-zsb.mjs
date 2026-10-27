// 广西专升本（电子与信息大类，2027 考纲）题库：学习模式从这里抽题和组卷，
// 不靠模型临场现编。题库与生成器由 06_互动学习台/build.py --repo 导出；
// 参考答案只写进题卡的私有字段，作答后才进入模型上下文。
import fs from 'node:fs';
import {loadGenerators} from './learning-zsb-gen.mjs';

const DATA = JSON.parse(fs.readFileSync(new URL('./learning-zsb-data.json', import.meta.url), 'utf8'));
const GENS = loadGenerators(DATA.vocab);
GENS.forEach((g, i) => { g.i = i; });
const KP = {};
for (const [s, points] of Object.entries(DATA.syllabus)) for (const p of points) KP[p.k] = {...p, s};
const SUBJECT_NAME = Object.fromEntries(DATA.subjects.map(s => [s.id, s.name]));
const BY_ID = new Map(DATA.bank.map(q => [q.id, q]));

export const ZSB_SUBJECTS = ['ee', 'c', 'net', 'math', 'en'];
export const ZSB_TYPES = ['single', 'judge', 'fill', 'app', 'write'];
export const ZSB_PAPERS = ['pro', 'math', 'en', 'ee', 'c', 'net'];
export const ZSB_SOURCES = ['any', 'imported', 'generated', 'original'];
const PREFIX = 'zsb-';
const assert = (value, message) => { if (!value) throw new Error(message); };
const subOf = k => KP[k]?.s || '';

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (list, r) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 生成题里带少量 HTML（<pre>、<b>、&lt;），题卡按纯文本显示。
export function plainText(html) {
  return String(html ?? '').replace(/<br\s*\/?>/g, '\n').replace(/<\/?(pre|div)[^>]*>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

// The id comes from the same random stream, so a seeded draw (a retried tool call) rebuilds identical cards.
function generated(g, r) {
  const q = g.make(r);
  return {...q, q: plainText(q.q), x: plainText(q.x), id: `g${g.i}-${Math.floor(r() * 36 ** 8).toString(36)}`, k: g.k, src: '生成题'};
}

export function normalizeBankSpec(raw = {}) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'bank 需要是对象');
  const spec = {};
  if (raw.paper !== undefined) { assert(ZSB_PAPERS.includes(raw.paper), 'bank.paper 只能是 pro/math/en/ee/c/net'); spec.paper = raw.paper; }
  if (raw.subject !== undefined) { assert(ZSB_SUBJECTS.includes(raw.subject), 'bank.subject 只能是 ee/c/net/math/en'); spec.subject = raw.subject; }
  if (raw.points !== undefined) {
    assert(Array.isArray(raw.points) && raw.points.length <= 20 && raw.points.every(k => KP[k]), 'bank.points 需要考纲考点编号，如 net4、c5、m2');
    spec.points = [...new Set(raw.points)];
  }
  if (raw.types !== undefined) {
    assert(Array.isArray(raw.types) && raw.types.length && raw.types.every(t => ZSB_TYPES.includes(t)), 'bank.types 取 single/judge/fill/app/write');
    spec.types = [...new Set(raw.types)];
  }
  spec.count = raw.count === undefined ? 1 : Number(raw.count);
  assert(Number.isInteger(spec.count) && spec.count >= 1 && spec.count <= 60, 'bank.count 为 1–60');
  spec.source = raw.source === undefined ? 'any' : raw.source;
  assert(ZSB_SOURCES.includes(spec.source), 'bank.source 取 any/imported/generated/original');
  if (raw.seed !== undefined) { assert(Number.isInteger(raw.seed), 'bank.seed 需要整数'); spec.seed = raw.seed; }
  return spec;
}

function inScope(k, spec) {
  if (spec.points) return spec.points.includes(k);
  if (spec.subject) return subOf(k) === spec.subject;
  return true;
}
const sourceOk = (q, source) => source === 'any' ? true : source === 'imported' ? q.id.startsWith('im-') || q.src === '考纲' : source === 'original' ? !q.id.startsWith('im-') : false;

// 抽题：先用没做过的题库题，再补生成题（无限出新数字）；同一批里同一道题不重复。
export function drawBankItems(rawSpec, {exclude = new Set(), random} = {}) {
  const spec = normalizeBankSpec(rawSpec);
  const r = random || (spec.seed !== undefined ? rng(spec.seed) : Math.random);
  const types = spec.types || ['single', 'judge', 'fill', 'app'];
  const bank = shuffle(DATA.bank.filter(q => inScope(q.k, spec) && types.includes(q.t) && sourceOk(q, spec.source)), r);
  const fresh = bank.filter(q => !exclude.has(PREFIX + q.id)), seen = bank.filter(q => exclude.has(PREFIX + q.id));
  const gens = spec.source === 'any' || spec.source === 'generated' ? GENS.filter(g => inScope(g.k, spec)) : [];
  const wantGen = spec.source === 'generated' ? spec.count : gens.length ? Math.round(spec.count * (fresh.length >= spec.count ? 0.3 : 0.6)) : 0;
  const out = fresh.slice(0, spec.count - wantGen);
  for (let i = 0; out.length < spec.count && i < spec.count * 30 && gens.length; i++) {
    const q = generated(gens[Math.floor(r() * gens.length)], r);
    if (types.includes(q.t)) out.push(q);
  }
  for (const q of [...fresh.slice(out.length), ...seen]) { if (out.length >= spec.count) break; if (!out.includes(q)) out.push(q); }
  assert(out.length, '这个范围里没有符合题型的题；换个考点或题型');
  return shuffle(out, r).map(q => ({...q, id: PREFIX + q.id}));
}

const topicOf = q => `${SUBJECT_NAME[subOf(q.k)] || ''} · ${KP[q.k]?.t || ''}`;
const withPassage = q => (q.p && DATA.passages[q.p] ? `【阅读材料】\n${DATA.passages[q.p].text}\n\n${q.q}` : q.q);
// 选项用 A–D 编号，和纸面试卷、参考答案、讲解里说的字母一致。
const lettered = q => q.o.map((label, i) => ({id: 'ABCD'[i], label}));
const reference = (q, answer) => [`参考答案：${answer}`, q.x ? `解析：${q.x}` : '', q.src ? `出处：${q.src}` : ''].filter(Boolean).join('\n');

// 转成互动题卡（learning_activity 的 quiz 格式）。应用题拆成逐空小题。
export function toQuizItems(q) {
  const base = {topic: topicOf(q)};
  if (q.t === 'single') {
    return [{...base, id: q.id, kind: 'single_choice', question: withPassage(q), options: lettered(q), correct_answer: q.a, rubric: reference(q, `${q.a}. ${q.o['ABCD'.indexOf(q.a)]}`)}];
  }
  if (q.t === 'judge') return [{...base, id: q.id, kind: 'single_choice', question: `判断：${q.q}`, options: ['正确', '错误'], correct_answer: q.a ? '1' : '2', rubric: reference(q, q.a ? '正确' : '错误')}];
  if (q.t === 'fill') return [{...base, id: q.id, kind: 'fill_blank', question: q.q, correct_answer: q.a[0], accepted_answers: q.a, rubric: reference(q, q.a.join(' / '))}];
  if (q.t === 'app') return q.blanks.map((b, j) => ({...base, id: `${q.id}-b${j + 1}`, kind: 'fill_blank', question: `${q.q}\n\n${b.p}`, correct_answer: b.a[0], accepted_answers: b.a, rubric: reference(q, b.a.join(' / '))}));
  return [{...base, id: q.id, kind: 'short_answer', question: q.q, rubric: `${reference(q, q.ref)}\n满分 ${q.pts} 分，按参考答案要点给分。`,
    scoring_points: [{id: 'ref', label: `与参考答案要点一致（满分 ${q.pts}）`}]}];
}

// 转成模拟卷题目（learning-practice 的 mock_exam 格式）。
export function toExamQuestions(q, points) {
  const subject = SUBJECT_NAME[subOf(q.k)] || '';
  if (q.t === 'single') return [{id: q.id, subject, kind: 'single_choice', question: withPassage(q), options: lettered(q), correct_answer: q.a, explanation: q.x || '', points}];
  if (q.t === 'judge') return [{id: q.id, subject, kind: 'judgement', question: q.q, correct_answer: q.a ? 'true' : 'false', explanation: q.x || '', points}];
  if (q.t === 'fill') return [{id: q.id, subject, kind: 'fill_blank', question: q.q, correct_answer: q.a[0], accepted_answers: q.a.slice(1), explanation: q.x || '', points}];
  if (q.t === 'app') {
    // The last blank takes the rounding remainder so each 应用题 sums to its exact value.
    const n = q.blanks.length, each = Math.floor((points / n) * 100) / 100, last = Math.round((points - each * (n - 1)) * 100) / 100;
    return q.blanks.map((b, j) => ({id: `${q.id}-b${j + 1}`, subject, kind: 'fill_blank', question: `${j === 0 ? q.q : '（同上题）'}\n\n${b.p}`, correct_answer: b.a[0], accepted_answers: b.a.slice(1), explanation: j === n - 1 ? q.x || '' : '', points: j === n - 1 ? last : each}));
  }
  return [{id: q.id, subject, kind: 'short_answer', question: q.q, correct_answer: q.ref, explanation: q.x || '', points: q.pts || points}];
}

const PRO_POINTS = {single: 4, judge: 3, fill: 2, app: 12.5};
function section(r, exclude, scope, type, count, points) {
  if (!count) return [];
  const items = drawBankItems({...scope, types: [type], count, seed: Math.floor(r() * 2 ** 31)}, {exclude});
  return items.flatMap(q => toExamQuestions(q, points(q)));
}

// 按 2027 考纲题型组卷。题库不够时用生成题补，绝不让模型现编。
export function buildBankPaper(paper, {seed = Math.floor(Math.random() * 2 ** 31), exclude = new Set()} = {}) {
  assert(ZSB_PAPERS.includes(paper), 'bank.paper 只能是 pro/math/en/ee/c/net');
  const r = rng(seed);
  const origin = '按 2027 考纲题型组卷；题目来自本机题库（含 2025 机构模拟卷导入题）与程序生成题，非官方真题';
  if (paper === 'pro' || ['ee', 'c', 'net'].includes(paper)) {
    const subs = paper === 'pro' ? ['ee', 'c', 'net'] : [paper];
    const qs = [];
    for (const [type, n] of [['single', 10], ['judge', 5], ['fill', 10], ['app', 2]])
      for (const s of subs) qs.push(...section(r, exclude, {subject: s}, type, n, () => PRO_POINTS[type]));
    return {durationMinutes: paper === 'pro' ? 150 : 50, origin, questions: qs, title: paper === 'pro' ? '专业基础综合课模拟卷（300 分）' : `${SUBJECT_NAME[paper]}单科卷（100 分）`};
  }
  if (paper === 'math') {
    const writes = shuffle(DATA.bank.filter(q => q.t === 'write' && subOf(q.k) === 'math'), r);
    const solve = writes.filter(q => q.pts === 8).slice(0, 7), apply = writes.filter(q => q.pts === 12).slice(0, 2);
    const qs = [...section(r, exclude, {subject: 'math'}, 'single', 10, () => 5), ...section(r, exclude, {subject: 'math'}, 'fill', 4, () => 5),
      ...[...solve, ...apply].flatMap(q => toExamQuestions({...q, id: PREFIX + q.id}, q.pts))];
    return {durationMinutes: 120, origin, questions: qs, title: '数学模拟卷'};
  }
  // 阅读题按篇章排在一起、篇内保持原题序，不能和别的篇章交错。
  const order = q => DATA.bank.indexOf(q), passage = q => q.p ? order(DATA.bank.find(x => x.p === q.p)) : order(q);
  const pick = (k, n) => shuffle(DATA.bank.filter(q => q.k === k), r).slice(0, n)
    .sort((a, b) => k === 'e2' ? passage(a) - passage(b) || order(a) - order(b) : 0).map(q => ({...q, id: PREFIX + q.id}));
  const qs = [...section(r, exclude, {points: ['e1']}, 'single', 20, () => 2),
    ...pick('e2', 10).flatMap(q => toExamQuestions(q, 2)), ...pick('e3', 6).flatMap(q => toExamQuestions(q, 3)),
    ...pick('e4', 1).flatMap(q => toExamQuestions(q, 8)), ...pick('e5', 1).flatMap(q => toExamQuestions(q, 18))];
  return {durationMinutes: 75, origin: `${origin}；阅读与英译汉题量按现有题库缩减`, questions: qs, title: '英语模拟卷（缩减版）'};
}

// present 时的 bank 参数 → 题卡参数。count>1 时成为一组小题。
export function expandBankPresent(payload, exclude = new Set()) {
  const spec = normalizeBankSpec(payload.bank);
  assert(!spec.paper, '整卷请用 kind=mock_exam，并把 bank 放进 visual');
  const items = drawBankItems(spec, {exclude}).flatMap(toQuizItems).slice(0, 20);
  const {bank: _bank, question: _q, options: _o, correct_answer: _a, accepted_answers: _aa, rubric: _r, scoring_points: _sp, items: _items, kind: _kind, ...rest} = payload;
  if (items.length === 1) return {...rest, ...items[0]};
  return {...rest, kind: 'batch', question: payload.question || `${items[0].topic.split(' · ')[0]}练习 ${items.length} 题`, topic: payload.topic || items[0].topic, items};
}

export const isBankItemId = id => String(id || '').startsWith(PREFIX);

// 学习模式提示里的考点表：碧琪据此选 points。
export function bankCatalog() {
  return Object.entries(DATA.syllabus).map(([s, points]) => `${SUBJECT_NAME[s]}：${points.map(p => `${p.k} ${p.t}`).join('，')}`).join('\n');
}

export function bankStats() {
  const stats = {};
  for (const q of DATA.bank) { const s = subOf(q.k); stats[s] = (stats[s] || 0) + 1; }
  return {questions: DATA.bank.length, generators: GENS.length, bySubject: stats};
}

export function bankQuestion(id) { return BY_ID.get(String(id || '').replace(PREFIX, '')) || null; }
