// 碧琪上岸记 · 历年真题进考场。
// U 盘「英语B级」下每套卷 = 试卷 PDF + 答案解析 PDF + 听力 mp3。插着盘（App 开着）时后台：
//   1) 听力 mp3 拷进本机 learning-materials/pretco-b-audio/（目录结构和 U 盘一样，拔盘也能放原录音）；
//   2) 两份 PDF 认字（macOS 自带 Vision 识别，按栏排好；没有就用 tesseract），存本机文字缓存；
//   3) 内置模型按部分把试卷 + 官方答案拆成考场整卷（和仿真卷同一结构），程序校验后写进 papers/real-*.json。
// 答案 / 解析只在服务端卷子文件里；前端只拿公开版（publicPaper）。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {modelJson, pool, fold} from './learning-game-content.mjs';

const clean = (v, n = 2000) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const sha = v => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
const exists = async p => { try { await fsp.access(p); return true; } catch { return false; } };
export const REAL_VERSION = 5; // 拆卷规则或校验变了就 +1，已备好的卷会重拆

// ---------- 套卷识别 ----------
const PDF = /\.pdf$/i;
const AUDIO = /\.(mp3|m4a|wav)$/i;
const ANSWER = name => /答案|解析/.test(name) && !/试题与解析/.test(name); // 「…试题与解析.pdf」其实是试卷
// 文件夹名「2014年06月试题+解析+听力」/「2023年3月…」；模拟卷按文件名里的序号配对
export function setInfo(folder, name = '') {
  const m = /(20\d\d)\s*年\s*(\d{1,2})\s*月/.exec(folder) || /(20\d\d)[.\-_ ](\d{1,2})/.exec(name);
  if (m && !/模拟/.test(folder + name)) {
    const year = Number(m[1]), month = Number(m[2]);
    return {id: `real-${year}-${String(month).padStart(2, '0')}`, kind: 'real', year, month, title: `${year} 年 ${month} 月真题`};
  }
  const n = /模拟卷\s*(\d+)/.exec(name);
  if (n) return {id: `mock-${n[1]}`, kind: 'mock', year: 0, month: 0, title: `官方模拟卷 ${n[1]}`};
  return null;
}

// 在 base（U 盘「英语B级」目录）下找套卷：同一文件夹里试卷 / 答案 / 音频按年份或模拟卷序号配对。zip 不碰。
export async function findSets(base, {maxDepth = 3} = {}) {
  const sets = new Map();
  const walk = async (dir, depth) => {
    let entries = [];
    try { entries = await fsp.readdir(dir, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < maxDepth) await walk(full, depth + 1); continue; }
      if (!e.isFile() || !(PDF.test(e.name) || AUDIO.test(e.name))) continue;
      const info = setInfo(path.basename(dir), e.name);
      if (!info) continue;
      // 同一年份可能在别的文件夹里还有散卷（如 1/ 下只有试卷）：按文件夹分开收，最后挑配齐的那份
      const key = `${info.id}|${path.relative(base, dir)}`;
      const s = sets.get(key) || {...info, folder: path.relative(base, dir), paper: null, answer: null, audio: null};
      const rel = path.relative(base, full);
      if (AUDIO.test(e.name)) s.audio ||= rel;
      else if (ANSWER(e.name)) s.answer ||= rel;
      else s.paper ||= rel;
      sets.set(key, s);
    }
  };
  await walk(base, 0);
  const best = new Map();
  for (const s of sets.values()) if (s.paper && s.answer && (!best.has(s.id) || (!best.get(s.id).audio && s.audio))) best.set(s.id, s);
  return [...best.values()].sort((a, b) => (a.kind === b.kind ? (b.year * 100 + b.month) - (a.year * 100 + a.month) || a.id.localeCompare(b.id) : a.kind === 'real' ? -1 : 1));
}

// ---------- 认字 ----------
function run(command, args, {timeoutMs = 300000, signal} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    const out = [];
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, {once: true});
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => { err = (err + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`${command} 退出码 ${code}：${err.slice(-300)}`)); });
  });
}

const VISION_SWIFT = `import Vision
import AppKit
import Foundation
for arg in CommandLine.arguments.dropFirst() {
  var out: [[Any]] = []
  if let img = NSImage(contentsOf: URL(fileURLWithPath: arg)), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    req.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: cg).perform([req])
    for o in (req.results ?? []) { if let t = o.topCandidates(1).first { let b = o.boundingBox; out.append([b.minX, 1 - b.maxY, b.maxX, t.string]) } }
  }
  let data = try! JSONSerialization.data(withJSONObject: ["file": arg, "lines": out])
  print(String(data: data, encoding: .utf8)!)
  fflush(stdout)
}
`;

// 首次用时把 Vision 识别编译成小程序放在本机学习数据里（只在 macOS + 有 swiftc 时）。
export async function visionTool(dir) {
  if (process.platform !== 'darwin') return null;
  const bin = path.join(dir, `pinkie-ocr-${sha(VISION_SWIFT)}`);
  if (await exists(bin)) return bin;
  try {
    await fsp.mkdir(dir, {recursive: true});
    const src = path.join(dir, `pinkie-ocr-${randomUUID().slice(0, 8)}.swift`);
    await fsp.writeFile(src, VISION_SWIFT);
    try { await run('xcrun', ['swiftc', '-O', src, '-o', bin], {timeoutMs: 240000}); } finally { await fsp.rm(src, {force: true}); }
    return bin;
  } catch { return null; }
}

// Vision 行框 → 按栏排好的文字：左栏从上到下，再右栏；横跨两栏的行（标题）归左栏。
// 试卷（单栏）：同一高度的框（如 A) … B) … 两个选项）并成一行。
// 解析（多为两栏，中间夹着通栏标题）：按跨中线的通栏行切段，每段里先左栏后右栏。
export function orderLines(lines, {columns = false} = {}) {
  const rowsOf = list => {
    const rows = [];
    for (const l of [...list].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
      const last = rows.at(-1);
      if (last && Math.abs(last.top - l[1]) < 0.007) last.parts.push(l); else rows.push({top: l[1], parts: [l]});
    }
    return rows.map(r => r.parts.sort((a, b) => a[0] - b[0]).map(l => String(l[3])).join('    '));
  };
  if (!columns) return rowsOf(lines).join('\n');
  const out = [];
  let seg = [];
  const flush = () => {
    const left = seg.filter(l => l[0] < 0.47), right = seg.filter(l => l[0] >= 0.47);
    out.push(...(left.length >= 2 && right.length >= 2 ? [...rowsOf(left), ...rowsOf(right)] : rowsOf(seg)));
    seg = [];
  };
  for (const l of [...lines].sort((a, b) => a[1] - b[1])) {
    if (l[0] < 0.44 && l[2] > 0.56) { flush(); out.push(String(l[3])); } else seg.push(l);
  }
  flush();
  return out.join('\n');
}

// 一份 PDF 每页的文字。vision 有就用 vision；否则 tesseract（自动版面）。
export async function ocrPdf(file, {tmpRoot, vision, signal, dpi = 220, columns = false} = {}) {
  const dir = await fsp.mkdtemp(path.join(tmpRoot || os.tmpdir(), 'real-ocr-'));
  try {
    await run('pdftoppm', ['-r', String(dpi), '-gray', '-png', file, path.join(dir, 'p')], {signal, timeoutMs: 600000});
    const images = (await fsp.readdir(dir)).filter(n => n.endsWith('.png')).sort((a, b) => Number(/(\d+)\.png$/.exec(a)[1]) - Number(/(\d+)\.png$/.exec(b)[1])).map(n => path.join(dir, n));
    if (vision) {
      const out = await run(vision, images, {signal, timeoutMs: 60000 * Math.max(2, images.length)});
      const byFile = new Map(out.split('\n').filter(Boolean).map(line => { const j = JSON.parse(line); return [j.file, j.lines]; }));
      return {method: 'vision-ocr', pages: images.map(f => orderLines(byFile.get(f) || [], {columns}))};
    }
    const pages = [];
    for (const f of images) pages.push(await run('tesseract', [f, 'stdout', '-l', 'chi_sim+eng', '--psm', '1'], {signal, timeoutMs: 180000}).catch(() => ''));
    return {method: 'tesseract', pages};
  } finally { await fsp.rm(dir, {recursive: true, force: true}); }
}

// ---------- 拆卷 ----------
// 试卷 / 答案文字按 Part I–V 切开；切不出来就整份给模型。
// 认字常把罗马数字认错（Part H / Part Il / Part N / Part 皿），标题和部分名之间还会插进 ••。
// 按部分名找；同一词出现多次时，优先「后面跟着 minutes / Directions」的那处（卷首备注里的 “Part IV Translation 的第 67 题……” 不是标题）。
const SECTION_WORD = {listening: 'Listening', vocab: 'Vocabulary|Structure', reading: 'Reading', translation: 'Translation', writing: 'Writing'};
export const SECTION_IDS = ['listening', 'vocab', 'reading', 'translation', 'writing'];
function sectionIndex(text, id) {
  const word = SECTION_WORD[id];
  const re = new RegExp(`Part\\s*\\S{0,8}(?:\\s|[^A-Za-z]){0,16}(?:${word})`, 'gi');
  const score = index => {
    const after = text.slice(index, index + 180);
    let s = 0;
    if (/minutes/i.test(after)) s += 4;
    if (/Directions/i.test(after)) s += 1;
    if (/采用了不同|见本册|check your\s+writing/i.test(after)) s -= 8;
    return s;
  };
  const ranked = [...text.matchAll(re)].map(m => ({index: m.index, score: score(m.index)})).sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked.length && ranked[0].score >= 4) return ranked[0].index;
  // 解析册常把部分名印在 Part 前面：「Listening Comprehension / Part I / Section A」，后面没有 minutes。
  if (id === 'listening') {
    const lead = /Listening Comprehension[\s\S]{0,40}?Part\s+\S{1,6}[\s\S]{0,40}?Section A/i.exec(text);
    if (lead) return lead.index;
  }
  if (ranked.length && ranked[0].score >= 0) return ranked[0].index;
  // 有的卷「Vocabulary & Structure」印在 Part II 前面，中间还换行，Part 规则对不上。
  const titleWord = id === 'vocab' ? 'Vocabulary' : id === 'reading' ? 'Reading Comprehension' : word;
  const titles = [...text.matchAll(new RegExp(`(?:${titleWord})[\\s\\S]{0,90}?minutes`, 'gi'))].filter(m => score(m.index) >= 4);
  if (titles.length) return Math.min(...titles.map(m => m.index));
  return ranked.length ? ranked[0].index : -1;
}
// pad：往后多带一点（两栏页上一部分的尾巴常排在下一部分标题后面），模型按题号只取本部分。
export function splitParts(text, {pad = 0} = {}) {
  const t = String(text || '');
  const at = SECTION_IDS.map(id => sectionIndex(t, id));
  const out = {};
  SECTION_IDS.forEach((id, i) => {
    if (at[i] < 0) { out[id] = null; return; }
    const next = at.slice(i + 1).find(x => x > at[i]);
    out[id] = t.slice(Math.max(0, at[i] - (i ? pad / 3 : 0)), next == null ? t.length : next + pad);
  });
  return out;
}

export const REAL_SECTIONS = {
  listening: {title: 'Part I Listening Comprehension', timeMin: 25, points: 15},
  vocab: {title: 'Part II Vocabulary & Structure', timeMin: 10, points: 15},
  reading: {title: 'Part III Reading Comprehension', timeMin: 35, points: 35},
  translation: {title: 'Part IV Translation (English → Chinese)', timeMin: 25, points: 20},
  writing: {title: 'Part V Writing', timeMin: 25, points: 15},
};
const KINDS = {
  listening: ['listen-response', 'listen-dialogue', 'listen-conversation', 'listen-dictation'],
  vocab: ['choice', 'word-form'],
  reading: ['passage-choice', 'passage-short', 'term-match', 'practical-fill'],
  translation: ['translate-choice', 'translate-passage'],
  writing: ['writing'],
};

export const SPLIT_RULES = `你在把一套「高等学校英语应用能力考试 B 级」历年真题录入在线考场。输入 {"section":部分 id,"kinds":这部分可用的题型,"paper":这一部分的试卷文字,"answers":这一部分的官方参考答案与解析文字}。
文字是扫描认字得来的，可能有错字、漏空格、两栏串行、页眉页脚水印广告；前后可能带着相邻部分的一点内容，按题号和小节只取本部分。你要：按试卷原样整理出这一部分的全部题目，并用官方答案填好答案。
- 只照抄原卷，不改题、不出新题、不补题；认字错误（如 Pm→I'm、0→O、断词）按上下文改正；删掉页眉页脚水印广告。
- 题号、题量、每题分值按原卷（Directions 里写的为准）。答案以官方参考答案为准；答案文字和解析里「故选 X / X 项正确」不一致时以解析为准，并在 flag 里写明。
- 原卷某个选项认字丢了、而官方解析里写出了这个选项的内容（如「B 项 take 意为…」）时，用解析补上，并写进 flags。
- 原卷题目缺失或认不出时，不要编：在 flags 里写「第 N 题缺」，该题不输出。认字小毛病（空格被认成几个空白、选项挤在下一行、断行）不算缺，照样录入。
- 每个题号都要出现：输出前按题号从小到大核对一遍，中间不能跳号。
只输出 JSON：{"parts":[PART],"flags":["需要人工看的问题，没有就空数组"]}
PART = {"id":"原卷小节名，如 A / B / C / D / Task 1","kind":kinds 之一,"each":每题分值,"note":"一句中文说明这一节怎么做（如：听一句问话选最佳应答）","material":"本节共用材料","items":[ITEM]}
各题型：
- listen-response：{"no":题号,"options":[4 个选项原文，不带 A) 前缀],"answer":0-3,"script":"答案解析里给出的录音原文（问句），没有就空字符串"}
- listen-dialogue：{"no","options","answer","script":"对话原文 + Q: 问题（解析里有就照抄）"}
- listen-conversation（长对话 / 短文，每题一个问题）：{"no","options","answer","script":"该题的问题原文"}；material 写解析里给出的整段对话原文（没有就空字符串）
- listen-dictation（听写填空）：material 写原卷带编号空格的短文（空格写成 ___(N)___）；每个 item {"no","stem":"含该空的那一句（空格写成 ____）","answer":["官方答案","可接受写法"]}
- choice / passage-choice / translate-choice：{"no","stem":"题干（填空处写 ____）","options":[原卷全部选项，不带 A) 前缀；翻译选择通常只有 A–C 三个],"answer":选项下标,"why":"官方解析要点，30 字内中文"}；passage-choice 的 material 写整篇短文
- word-form：{"no","stem":"含 ____ 的句子","base":"括号里给的词","answer":["官方答案","可接受写法"],"why":""}
- passage-short（读短文完成句子 / 回答问题）：material 写短文；{"no","stem":"问题或待完成句子","answer":["官方答案","可接受写法"]}
- term-match（术语 / 标识英汉配对）：material 写原卷全部候选项，每行「A — 英文」或「A — 中文」，保持原卷字母；每个空单独一个 item {"no","stem":"另一侧的内容","answer":"一个候选字母"}。原卷一个题号有两个空（如「53. ( ) 企业文化 ( ) 质量管理」）时拆成两个 item，题号相同。
- practical-fill（实用文填表 / 简答）：material 写实用文全文；{"no","stem":"表格项或问题","answer":["官方答案","可接受写法"]}
- translate-passage：{"no","stem":"要翻译的英文原文","reference":"官方参考译文","rubric":"评分要点：准确 / 通顺 / 关键词"}
- writing：{"no","stem":"原卷写作要求（中文提示和格式要求全文）","reference":"官方范文","rubric":"五档评分要点和必备格式要件"}
每题 answer 必须是原卷选项下标（A=0、B=1、C=2、D=3）；判断不出答案的题写进 flags 并不输出。each 写你从原卷推断的每题分值（程序会按官方各部分满分折算）。`;

const INT = v => (Number.isInteger(Number(v)) ? Number(v) : null);
// 每题相对分值（原卷不印分值；各年一致），最后按官方部分满分等比折算
const KIND_WEIGHT = {'passage-choice': 2, 'translate-choice': 2, 'translate-passage': 12, writing: 15};
// 真题的选择题：翻译选择只有 A–C 三个选项，其余四个；选项不能重复，答案必须在范围里
function realChoice(it, fallbackStem) {
  const options = Array.isArray(it.options) ? it.options.map(o => clean(o, 400).replace(/^[A-D][)）.．]\s*/, '')) : [];
  const answer = Number(it.answer);
  if (options.length < 3 || options.length > 4 || options.some(o => !o)) return null;
  if (new Set(options.map(fold)).size !== options.length) return null;
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  return {stem: clean(it.stem, 1200) || fallbackStem, options, answer};
}
function validRealItem(kind, it, material) {
  if (!it || typeof it !== 'object') return null;
  const no = INT(it.no);
  const keep = x => (x ? {...x, ...(no ? {no} : {})} : null);
  if (['listen-response', 'listen-dialogue', 'listen-conversation'].includes(kind)) {
    const c = realChoice(it, '');
    return keep(c && {...c, stem: clean(it.stem, 400), script: clean(it.script, 1500)});
  }
  if (['choice', 'passage-choice', 'translate-choice'].includes(kind)) {
    const c = realChoice(it, '');
    return keep(c && {...c, why: clean(it.why, 120)});
  }
  const stem = clean(it.stem, 2500);
  if (!stem && !['listen-dictation', 'term-match'].includes(kind)) return null;
  if (['listen-dictation', 'word-form', 'passage-short', 'practical-fill'].includes(kind)) {
    const answer = (Array.isArray(it.answer) ? it.answer : [it.answer]).map(a => clean(a, 80)).filter(Boolean);
    if (!answer.length || answer[0].split(/\s+/).length > 8) return null;
    return keep({stem: stem || `第 ${no ?? ''} 空`, answer, ...(it.base ? {base: clean(it.base, 40)} : {}), ...(it.why ? {why: clean(it.why, 120)} : {})});
  }
  if (kind === 'term-match') {
    const a = clean(it.answer, 3).toUpperCase().replace(/[^A-Z]/g, '');
    if (!/^[A-Z]$/.test(a) || !new RegExp(`(^|\\n)\\s*${a}\\b`).test(material)) return null;
    return keep({stem, answer: a});
  }
  if (['translate-passage', 'writing'].includes(kind)) {
    const reference = clean(it.reference, 3000);
    const rubric = clean(it.rubric, 1500) || (kind === 'writing' ? '五档：14–15 / 11–13 / 8–10 / 5–7 / 0–4；要点齐全、格式完整、语句通顺' : '意思准确 8 分 + 通顺 4 分');
    return reference ? keep({stem, reference, rubric}) : null;
  }
  return null;
}

// 一个部分的模型输出 → 校验后的 parts。题型必须在本部分可用列表里；选择题答案必须是 0-3；分值合计对上本部分满分（±1 容错，写作 / 翻译段落按原卷）。
export function validRealSection(sectionId, v) {
  const parts = Array.isArray(v?.parts) ? v.parts : [];
  const out = [];
  const flags = (Array.isArray(v?.flags) ? v.flags : []).map(f => clean(f, 200)).filter(Boolean).slice(0, 20);
  for (const p of parts) {
    const kind = String(p?.kind || '');
    if (!KINDS[sectionId].includes(kind)) return null;
    const material = clean(p.material, 6000);
    const items = (Array.isArray(p.items) ? p.items : []).map(it => validRealItem(kind, it, material));
    const bad = items.filter(x => !x).length;
    if (bad) flags.push(`${clean(p.id, 20)} 有 ${bad} 道题没通过校验，已去掉`);
    const good = items.filter(Boolean);
    if (!good.length) continue;
    if (['term-match', 'passage-choice', 'passage-short', 'practical-fill'].includes(kind) && !material) return null;
    // 小节 id 统一成 A–D / T1–T5（前端据此显示 Section A / Task 1，题目 id 也不会撞）
    const raw = clean(p.id, 40);
    const task = /task\s*(\d)/i.exec(raw), sec = /section\s*([A-D])\b/i.exec(raw) || /^([A-D])$/i.exec(raw);
    let id = task ? `T${task[1]}` : sec ? sec[1].toUpperCase() : sectionId === 'reading' ? `T${out.length + 1}` : 'ABCD'[out.length] || String(out.length + 1);
    while (out.some(x => x.id === id)) id += '2';
    out.push({id, kind, note: clean(p.note, 160), each: KIND_WEIGHT[kind] || 1, material, items: good});
  }
  if (!out.length) return null;
  // 每题分值：原卷不印分值，模型给的只当相对权重；程序按官方各部分满分（15/15/35/20/15）等比折算，整卷合计 100。
  // 翻译固定：选择每题 2 分，段落拿剩下的；写作 15 分。
  const full = REAL_SECTIONS[sectionId].points;
  if (sectionId === 'translation') {
    const choices = out.filter(p => p.kind === 'translate-choice').reduce((n, p) => n + p.items.length, 0);
    const passages = out.filter(p => p.kind === 'translate-passage').reduce((n, p) => n + p.items.length, 0);
    for (const p of out) p.each = p.kind === 'translate-choice' ? 2 : passages ? (full - 2 * choices) / passages : p.each;
  }
  const total = out.reduce((n, p) => n + p.each * p.items.length, 0);
  if (total > 0 && Math.abs(total - full) > 0.01) for (const p of out) p.each = Math.round(p.each * full / total * 1000) / 1000;
  return {parts: out, flags};
}

// 题量 / 结构核对：和本套卷 Directions 写的题数比较（只报告，不阻断）
export function paperChecks(full) {
  const n = {};
  for (const sec of full.sections) n[sec.id] = sec.parts.reduce((x, p) => x + p.items.length, 0);
  const total = full.sections.reduce((x, s) => x + s.parts.reduce((y, p) => y + p.each * p.items.length, 0), 0);
  return {items: n, total: Math.round(total * 10) / 10};
}

export class RealPapers {
  // exam: GameExam；materials: LearningMaterials（拿 U 盘根目录和本机数据目录）
  constructor(exam, {materials = null, dataRoot = null, requestModel = null, now = () => Date.now(), concurrency = 3} = {}) {
    this.exam = exam;
    this.materials = materials;
    this.dataRoot = dataRoot || materials?.root || path.join(os.homedir(), 'Library/Application Support/SuperPinkie/learning-materials');
    this.requestModel = requestModel;
    this.now = now;
    this.concurrency = concurrency;
    this.status = {state: 'idle', found: 0, ready: 0, preparing: null, failed: [], at: 0, mounted: false};
    this.job = null;
  }
  model() { return this.requestModel || this.exam?.game?.requestModel || null; }
  audioRoot() { return path.join(this.dataRoot, 'pretco-b-audio'); }
  textRoot() { return path.join(this.dataRoot, 'pretco-b-text'); }
  manifestFile() { return path.join(this.dataRoot, 'pretco-b-sets.json'); }
  readManifest() { try { return JSON.parse(fs.readFileSync(this.manifestFile(), 'utf8')); } catch { return {sets: []}; } }
  writeManifest(m) { fs.mkdirSync(this.dataRoot, {recursive: true}); const tmp = `${this.manifestFile()}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(m, null, 1)); fs.renameSync(tmp, this.manifestFile()); }

  // U 盘「英语B级」目录（materials 的 pretco-b-usb 根）；没插返回 null
  usbBase() {
    try {
      const r = this.materials?.one?.("SELECT path,mounted FROM roots WHERE id='pretco-b-usb'");
      if (r?.mounted && r.path && fs.existsSync(r.path)) return r.path;
    } catch { /* 索引没开 */ }
    return process.env.PINKIE_PRETCO_USB && fs.existsSync(process.env.PINKIE_PRETCO_USB) ? process.env.PINKIE_PRETCO_USB : null;
  }

  // 本机已有的原录音（拔盘也能放）
  audioFile(set) {
    if (!set?.audio) return null;
    const rel = path.join(path.basename(path.dirname(set.audio)), path.basename(set.audio));
    const file = path.join(this.audioRoot(), rel);
    return fs.existsSync(file) ? file : null;
  }

  async copyAudio(base, set) {
    if (!set.audio) return null;
    const src = path.join(base, set.audio);
    const dest = path.join(this.audioRoot(), path.basename(path.dirname(set.audio)), path.basename(set.audio));
    try {
      const [a, b] = await Promise.all([fsp.stat(src), fsp.stat(dest).catch(() => null)]);
      if (b && b.size === a.size) return dest;
      await fsp.mkdir(path.dirname(dest), {recursive: true});
      const tmp = `${dest}.${randomUUID().slice(0, 6)}.part`;
      await fsp.copyFile(src, tmp);
      await fsp.rename(tmp, dest);
      return dest;
    } catch { return null; }
  }

  // 每份 PDF 的文字缓存（按文件大小 + 修改时间作废）
  async pdfText(base, rel, {vision, signal, columns = false} = {}) {
    const file = path.join(base, rel);
    const st = await fsp.stat(file);
    const key = sha(`${rel}:${st.size}:${Math.round(st.mtimeMs)}:${columns ? 2 : 1}`);
    const cache = path.join(this.textRoot(), `${key}.json`);
    try { return JSON.parse(await fsp.readFile(cache, 'utf8')); } catch { /* 没缓存 */ }
    const r = await ocrPdf(file, {tmpRoot: this.dataRoot, vision, signal, columns});
    const out = {rel, method: r.method, pages: r.pages, at: this.now()};
    await fsp.mkdir(this.textRoot(), {recursive: true});
    await fsp.writeFile(cache, JSON.stringify(out));
    return out;
  }

  // 一套卷：认字 → 按部分拆 → 校验 → 写卷子文件
  async prepareSet(base, set, {vision, signal} = {}) {
    const [paper, answer] = await Promise.all([this.pdfText(base, set.paper, {vision, signal}), this.pdfText(base, set.answer, {vision, signal, columns: true})]);
    const ptext = paper.pages.join('\n\n'), atext = answer.pages.join('\n\n');
    const P = splitParts(ptext, {pad: 600}), A = splitParts(atext, {pad: 1800});
    // 标题没切开时：写作 / 翻译在文末，不能拿全文的开头代替（16k 截断会把它们切掉）。
    const windowOf = (parts, id, full, limit) => {
      if (parts[id]) return clean(parts[id], limit);
      if (id === 'writing') return clean(full.slice(-8000), limit);
      if (id === 'translation') return clean(full.slice(-14000), limit);
      return clean(full, limit);
    };
    // 五个部分同时拆（互不依赖）；哪一部分拆不出来整套就不上架，下一轮再试
    const done = await Promise.all(SECTION_IDS.map(async id => {
      const payload = {section: id, kinds: KINDS[id], paper: windowOf(P, id, ptext, 16000), answers: windowOf(A, id, atext, 24000)};
      const r = await modelJson(this.model(), SPLIT_RULES, payload, {validate: v => validRealSection(id, v), timeoutMs: 300000, maxTokens: 16000, retries: 2});
      return r ? {id, ...REAL_SECTIONS[id], instructions: r.value.parts.map(p => p.note).filter(Boolean).join('；'), parts: r.value.parts, flags: r.value.flags} : {id, failed: true};
    }));
    const miss = done.filter(x => x.failed);
    if (miss.length) return {ok: false, error: `${miss.map(x => REAL_SECTIONS[x.id].title).join('、')} 没拆出来`};
    const flags = done.flatMap(x => x.flags.map(f => `${x.id}: ${f}`));
    const sections = done.map(({flags: _f, ...x}) => x);
    const audio = this.audioFile(set);
    const full = {paperId: set.id, exam: 'pretco-b', kind: set.kind, year: set.year, month: set.month, title: set.title, createdAt: this.now(), source: {paper: set.paper, answer: set.answer, audio: set.audio, ocr: paper.method}, audio: audio ? path.relative(this.audioRoot(), audio) : null, version: REAL_VERSION, sections, flags};
    full.check = paperChecks(full);
    return {ok: true, full};
  }

  // 插盘后跑一轮：找套卷 → 拷听力 → 没备好的逐套拆（并发 concurrency）
  async sync({force = false, only = null, signal} = {}) {
    if (this.job) return this.job;
    const base = this.usbBase();
    this.status.mounted = Boolean(base);
    if (!base) { this.status.state = 'idle'; return this.status; }
    this.job = (async () => {
      this.status = {...this.status, state: 'scanning', at: this.now(), failed: []};
      const sets = (await findSets(base)).filter(s => !only || only.includes(s.id));
      const manifest = this.readManifest();
      for (const s of sets) { await this.copyAudio(base, s); const old = manifest.sets.find(x => x.id === s.id); if (old) Object.assign(old, s); else manifest.sets.push(s); }
      this.writeManifest(manifest);
      this.status.found = manifest.sets.length;
      const todo = sets.filter(s => force || !this.exam.realReady(s.id));
      this.status.ready = manifest.sets.filter(s => this.exam.realReady(s.id)).length;
      if (!todo.length || !this.model()) { this.status.state = 'idle'; return this.status; }
      const vision = await visionTool(path.join(this.dataRoot, 'bin'));
      this.status.state = 'preparing';
      await pool(todo, this.concurrency, async s => {
        if (signal?.aborted) return;
        this.status.preparing = s.title;
        try {
          const r = await this.prepareSet(base, s, {vision, signal});
          if (r.ok) { this.exam.installReal(r.full); this.status.ready += 1; } else this.status.failed.push({id: s.id, error: r.error});
        } catch (e) { this.status.failed.push({id: s.id, error: clean(e?.message || e, 200)}); }
      });
      this.status.state = 'idle';
      this.status.preparing = null;
      this.status.at = this.now();
      return this.status;
    })().finally(() => { this.job = null; });
    return this.job;
  }
}
