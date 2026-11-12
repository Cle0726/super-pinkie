// 学习台「背一背」：组卷、判题、结算。记忆曲线算法仍在 learning.mjs，这里只决定传哪个 rating。
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {dayInZone} from './learning-pact.mjs';
import {vocabDrillFields} from './learning-vocab.mjs';
import {explainInput} from './learning-game-content.mjs';
import {explainRulesFor, compactExplainRules, markCompactExplain, useCompactExplain, explainRules, validVoicedExplain, explainFailure, EXPLAIN_VERSION} from './learning-explain-voice.mjs';

const LIBRARY = 'agent:learning:notes-library';
const SIZES = [5, 10, 15, 20];
const GOALS = [15, 30, 50];
const STOP_RE = /请求失败（(?:401|403|429|5\d\d)）|fetch failed|timed?\s*out|超时/i;
const FALLBACK_COMMENT = '碧琪没来得及细看，按关键词判的';

export const DRILL_RULES = `你是碧琪的「背一背」出题助手。先生在备考广西专升本（计算机类：高数、C语言、计算机网络、电工电子、英语）和英语 B 级 / 四级。
输入是若干张回忆卡，每张有 id、question（问题）、answer（标准答案）、quote（原笔记依据）、subject（科目，可能为空）。
为每张卡出一套练习题，帮助先生把答案背下来。只输出 JSON：
{"cards":[{"id":"卡片id",
  "keys":["答案里最关键的 1–4 个词或短语，必须是 answer 的连续子串"],
  "choice":{"stem":"题干","options":["正确项","干扰1","干扰2","干扰3"],"answer":0,"why":"一句话说为什么"},
  "truefalse":{"statement":"一个陈述","isTrue":true,"why":"一句话说为什么"},
  "cloze":{"text":"把 answer 改写成一句，挖掉关键词处写成 {{1}}、{{2}}","blanks":["第1空答案","第2空答案"],"distractors":["干扰词1","干扰词2","干扰词3"]},
  "order":{"steps":["第一步","第二步","第三步"]} 或 null
}]}

规则：
1. 只根据 question、answer、quote 出题，不补写原文没有的事实。答案必须和 answer 一致。
2. choice：题干可以复用 question，也可以换个问法，但不能把答案写进题干。干扰项要像真的——用同一知识点的常见误解、相近概念、易混的数值或写法，长度和正确项差不多；不要出明显荒谬的选项，也不要出「以上都对 / 都不对」。answer 是正确项在 options 里的下标，options 不用打乱，程序会打乱。
3. truefalse：一半概率出对的陈述、一半出错的。错的陈述只改一个关键点（数值、方向、概念对调），why 里点出改了哪里。
4. cloze：blanks 必须是 keys 里的词；1–3 个空；distractors 与空的词性、长度相近，不能也是正确答案。
5. order：只有答案本身是步骤、流程、顺序（例如 TCP 三次握手、编译过程、解题步骤）时才出，steps 2–6 步，按正确顺序给；否则写 null。
6. 英语类卡片（答案是英文表达、搭配、语法规则）：choice 和 cloze 用英文出，why 用中文解释。
7. 数学 / 电路公式保持原样书写（可用 LaTeX，如 $U=IR$），不要把公式拆成词块挖空的一半。
8. 每个输入 id 恰好一条。所有文字用简体中文（英语题除外），不要 Markdown，不要多余字段。`;

export const DRILL_JUDGE_RULES = `你是碧琪，在帮先生检查默写。输入 {"question","answer","keys","text"}：text 是先生凭记忆写的答案。
判断先生是否记住了 answer 的要点，只输出 JSON：{"verdict":"correct|partial|wrong","missing":["漏掉或写错的要点"],"comment":"一句话"}。
- correct：意思对、关键点都在。错别字、换种说法、顺序不同、中英文混写都算对。
- partial：记住一部分关键点，或者大方向对但有一处关键错误。
- wrong：基本没写出来，或主要内容错误。空白一律 wrong。
- missing 最多 3 条，用答案里的原词。
- comment 用碧琪的口吻，像旁边坐着的朋友：对就简短夸一句，部分对就点出差哪一点，错就告诉他先记哪个词。不超过 30 字，不说「加油哦」这种空话，不用感叹号以外的表情符号。`;

export const DRILL_CHEER_RULES = `你是碧琪，先生的学习搭子，正坐在他旁边看他背书。他刚背完一组，输入是这组的情况：
{"book":"notes|vocab|mixed","subjects":[...],"stars":n,"accuracy":0.9,"minutes":4,"maxCombo":6,"wrongTopics":[...],"streak":n,"firstFinishToday":true,"jarFull":false,"beijingHour":21,"examCountdown":{"name":"英语B级","days":37},"quiet":false}
写一句话给他，只输出 JSON：{"line":"..."}。
- 15–35 个字，像朋友随口说的，有具体内容：提到他刚背的科目、错得最多的点、连对、或时间（深夜就让他早点睡）。
- 正确率低也不批评，告诉他下一组先看哪个。正确率高就夸得具体一点。
- quiet 为 true（考前 7 天）：语气安静，不用感叹号，提醒休息和稳住。
- 不要用「加油」「继续努力」「你真棒」这种套话。不要用 emoji。称呼他「先生」，最多一次。`;

// 选择 / 判断 12s，挖空 / 配对 25s，默写 / 拼写 / 听写 60s。
export const DRILL_LIMIT_MS = {
  choice: 12_000, truefalse: 12_000, word2meaning: 12_000, meaning2word: 12_000, listen: 12_000, flip: 12_000,
  cloze: 25_000, pairs: 25_000, homophonePairs: 25_000, collocation: 25_000, order: 25_000,
  write: 60_000, spell: 60_000, dictate: 60_000,
};

const clean = (value, limit = 4000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
// 折叠只去掉空白和中英文标点。运算符、正负号、比较符和度数要留着：−10 和 10、a > b 和 a < b 不是一回事。
const DRILL_KEEP = new Set(['+', '-', '*', '/', '=', '<', '>', '^', '%', '≤', '≥', '≠', '×', '÷', '±']);
export const foldDrillText = value => clean(value, 8000).normalize('NFKC').toLowerCase()
  .replace(/[\u2212\u2012\u2013\uFE63]/g, '-')
  .replace(/°/g, '度')
  .replace(/[\s\p{P}\p{S}]/gu, ch => (DRILL_KEEP.has(ch) ? ch : ''));
// 只差运算符或正负号（写了 10、答案是 -10）不算「答了一部分」。
const onlySymbols = value => [...value].every(ch => DRILL_KEEP.has(ch));

export function drillCardHash(card = {}) {
  return createHash('sha256').update([card.question, card.answer, card.quote].map(value => String(value ?? '')).join('\n')).digest('hex').slice(0, 24);
}

// 没复习过是 0。reviewLevel 0 → 1，之后每升一级加 1，封顶 5。失误多的往下收一档，但不退回新卡。
export function drillStrength(card = {}) {
  const count = Math.max(0, Math.round(Number(card.reviewCount) || 0));
  const level = Number(card.reviewLevel);
  const lapses = Math.max(0, Math.round(Number(card.lapses) || 0));
  if (count <= 0 || !Number.isFinite(level) || level < 0) return 0;
  let strength = Math.min(5, level + 1);
  if (lapses >= 2) strength -= 1;
  if (lapses >= 4) strength -= 1;
  return Math.max(1, Math.min(5, strength));
}

export function mapDrillRating(mode, {correct = false, firstTry = true, hinted = false, ms = 0, verdict} = {}) {
  if (mode === 'look' || mode === 'meet' || firstTry === false) return null;
  if (verdict === 'wrong' || correct !== true) return 'forgot';
  const slow = Number(ms) > (DRILL_LIMIT_MS[mode] ?? 12_000);
  if (hinted || verdict === 'partial' || slow) return 'fuzzy';
  return 'remembered';
}

// 罐子记的是今天背完几组，每天 2 组就算完成。星星只进钱包，不再拿来灌罐子。
export const JAR_SETS = 2;

export function drillStars({answerStars = 0, scored = 0, correct = 0, finished = false} = {}) {
  const perfect = finished && scored > 0 && correct === scored;
  return Math.max(0, answerStars) + (finished ? 5 : 0) + (perfect ? 5 : 0);
}

export function localJudge({answer = '', keys = [], text = ''} = {}) {
  const written = foldDrillText(text);
  const list = (Array.isArray(keys) ? keys : []).map(key => String(key)).filter(key => foldDrillText(key));
  if (!written) return {verdict: 'wrong', missing: (list.length ? list : [answer]).filter(Boolean).slice(0, 3), comment: FALLBACK_COMMENT};
  if (!list.length) {
    const folded = foldDrillText(answer);
    if (folded && written === folded) return {verdict: 'correct', missing: [], comment: FALLBACK_COMMENT};
    const rest = folded && written.includes(folded) ? written.replace(folded, '') : folded && folded.includes(written) ? folded.replace(written, '') : null;
    if (rest !== null && !onlySymbols(rest)) return {verdict: 'partial', missing: [], comment: FALLBACK_COMMENT};
    return {verdict: 'wrong', missing: [String(answer)].filter(Boolean).slice(0, 3), comment: FALLBACK_COMMENT};
  }
  const missing = list.filter(key => !written.includes(foldDrillText(key)));
  const ratio = (list.length - missing.length) / list.length;
  let verdict = ratio >= 0.8 ? 'correct' : ratio >= 0.4 ? 'partial' : 'wrong';
  // 关键词都在、顺序却和答案相反（「MAC 解析为 IP」），多半是方向写反了，本地最多给部分对。
  if (verdict === 'correct' && !missing.length && list.length >= 2 && swappedKeys(foldDrillText(answer), written, list)) verdict = 'partial';
  return {verdict, missing: missing.slice(0, 3), comment: FALLBACK_COMMENT};
}

// 结算页标题固定是「这一页背完啦」（安静版「这一页背完了」），这里的本地台词不能和标题重字。
function swappedKeys(answer, written, keys) {
  const tokens = keys.map(foldDrillText);
  const at = text => tokens.map(token => text.indexOf(token));
  const want = at(answer);
  const got = at(written);
  if (want.some(index => index < 0)) return false;
  const order = list => list.map((index, key) => [index, key]).sort((a, b) => a[0] - b[0]).map(pair => pair[1]).join();
  return order(want) !== order(got);
}

export function localCheer({accuracy = 0, jarFull = false, quiet = false, scored = 0} = {}) {
  if (quiet) return '稳住节奏，今晚早点睡';
  if (jarFull) return '今天的星星罐装满了';
  if (scored > 0 && accuracy === 1) return '一道没错，记得很牢';
  if (scored > 0 && accuracy >= 0.8) return '大部分都记住了，错的下组先看';
  return '错的那几道，下一组先看它们';
}

export function mixDrillCards(notes = [], words = []) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < notes.length || j < words.length) {
    if (i < notes.length) out.push(notes[i++]);
    if (j < words.length) out.push(words[j++]);
  }
  return out;
}

function normalizeSize(size) {
  return SIZES.includes(size) ? size : 10;
}

function shuffle(list, rng = Math.random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const saved = copy[index];
    copy[index] = copy[swap];
    copy[swap] = saved;
  }
  return copy;
}

function tooLong(value) {
  if (typeof value === 'string') return value.length > 600;
  if (Array.isArray(value)) return value.some(tooLong);
  if (value && typeof value === 'object') return Object.values(value).some(tooLong);
  return false;
}

function usableGenerated(generated) {
  if (!generated || typeof generated !== 'object') return null;
  if (generated.choice || generated.truefalse || generated.cloze || generated.order || (generated.keys || []).length) return generated;
  return null;
}

function modeOptions(card, {flipOnly = false, vocabPool = []} = {}) {
  if (flipOnly) return ['flip'];
  const strength = Math.max(0, Math.min(5, Number(card.strength) || 0));
  const choicePool = vocabPool.filter(item => item.word && item.meaning);
  const choiceOk = choicePool.length >= 4;
  if (card.book === 'vocab') {
    if (strength <= 0) return ['meet', choiceOk ? 'word2meaning' : 'flip'];
    if (strength <= 2) {
      const modes = [];
      if (choiceOk) modes.push('meaning2word', 'listen', 'word2meaning');
      if ((card.collocations || []).some(item => item?.en)) modes.push('collocation');
      return modes.length ? modes : ['flip'];
    }
    return ['spell', 'dictate'];
  }
  const generated = usableGenerated(card.generated);
  if (strength <= 0) return ['look', generated?.choice ? 'choice' : 'flip'];
  if (!generated) return ['flip'];
  if (strength <= 2) {
    const modes = [];
    if (generated.choice) modes.push('choice');
    if (generated.truefalse) modes.push('truefalse');
    if (generated.cloze) modes.push('cloze');
    return modes.length ? modes : ['flip'];
  }
  const modes = [];
  if (generated.order) modes.push('order');
  modes.push('write');
  return modes;
}

function followMode(card, context) {
  return modeOptions(card, context).find(mode => mode !== 'look' && mode !== 'meet') || 'flip';
}

function planItem(mode, cards, role, context) {
  return {mode, cards, role, alts: modeOptions(cards[0], context)};
}

function canPlace(item, placed) {
  if (item.role !== 'follow') return true;
  return placed.some(prev => prev.role === 'intro' && prev.cards[0].key === item.cards[0].key);
}

// 同一题型不连着出现第三次；看一看必须排在它的后续题前面。
function arrange(items) {
  const pending = [...items];
  const placed = [];
  while (pending.length) {
    const last = placed.at(-1)?.mode;
    const prev = placed.at(-2)?.mode;
    const blocked = last && last === prev ? last : null;
    let index = pending.findIndex(item => canPlace(item, placed) && item.mode !== blocked);
    if (index < 0) index = pending.findIndex(item => canPlace(item, placed));
    if (index < 0) index = 0;
    placed.push(pending.splice(index, 1)[0]);
  }
  return placed;
}

function diversify(items) {
  if (items.length < 3) return items;
  const have = () => new Set(items.map(item => item.mode));
  if (have().size >= 3) return items;
  for (const item of items) {
    if (have().size >= 3) break;
    if (item.role === 'intro' || item.role === 'pairs') continue;
    const alt = (item.alts || []).find(mode => !have().has(mode));
    if (alt) item.mode = alt;
  }
  return items;
}

function sharesExam(left, right) {
  const ids = new Set(left.exams || []);
  return (right.exams || []).some(id => ids.has(id));
}

function distractors(card, pool, field, correct) {
  const others = pool.filter(item => item.key !== card.key);
  const ordered = [...others.filter(item => sharesExam(item, card)), ...others.filter(item => !sharesExam(item, card))];
  const texts = [];
  for (const item of ordered) {
    const text = clean(item[field], 200);
    if (!text || text === correct || texts.includes(text)) continue;
    texts.push(text);
    if (texts.length >= 3) break;
  }
  return texts;
}

function cardRefFor(cards) {
  const book = cards[0].book === 'vocab' ? 'vocab' : 'notes';
  if (cards.length === 1) {
    return book === 'vocab'
      ? {book, wordId: cards[0].wordId}
      : {book, noteId: cards[0].noteId, recallId: cards[0].recallId};
  }
  return {
    book,
    refs: cards.map(card => book === 'vocab'
      ? {wordId: card.wordId}
      : {noteId: card.noteId, recallId: card.recallId}),
  };
}

function revealOf(card, answer, extra = '') {
  return {
    question: card.book === 'vocab' ? (card.word || card.question || '') : (card.question || ''),
    answer: answer ?? (card.book === 'vocab' ? card.meaning : card.answer) ?? '',
    ...(card.quote ? {quote: card.quote} : {}),
    ...(extra ? {extra} : {}),
  };
}

// 配对右栏：优先用出题时挑出的关键词 keys[0]（PLAN §4.3），没有才截答案前 12 个字并加「…」。
export function pairLabel(card = {}) {
  const key = clean(usableGenerated(card.generated)?.keys?.[0], 40);
  if (key) return key;
  const answer = clean(card.answer, 200);
  if (!answer) return '…';
  return answer.length > 12 ? `${answer.slice(0, 12)}…` : answer;
}

function choiceFromTexts(correct, wrongs, rng) {
  if (wrongs.length < 3) return null;
  const rows = shuffle([{text: correct, correct: true}, ...wrongs.slice(0, 3).map(text => ({text, correct: false}))], rng);
  return {options: rows.map(row => row.text), answer: rows.findIndex(row => row.correct)};
}

function materialize(item, index, rng, vocabPool) {
  const cards = item.cards;
  const card = cards[0];
  const base = {
    itemId: `d${index + 1}`,
    cardRef: cardRefFor(cards),
    strength: Math.min(...cards.map(entry => Number(entry.strength) || 0)),
    mode: item.mode,
    subject: card.subject || '',
    topic: card.topic || '',
  };
  const generated = usableGenerated(card.generated);
  if (item.mode === 'choice' && generated?.choice) {
    const choice = generated.choice;
    const rows = shuffle(choice.options.map((text, option) => ({text, correct: option === choice.answer})), rng);
    const answer = rows.findIndex(row => row.correct);
    return {...base, prompt: choice.stem || card.question, options: rows.map(row => row.text), answer,
      reveal: {question: choice.stem || card.question, answer: rows[answer].text, ...(card.quote ? {quote: card.quote} : {}), ...(choice.why ? {extra: choice.why} : {})},
      keys: generated.keys || []};
  }
  if (item.mode === 'truefalse' && generated?.truefalse) {
    const statement = generated.truefalse;
    return {...base, prompt: statement.statement, options: ['对', '错'], answer: statement.isTrue ? 0 : 1,
      reveal: {question: statement.statement, answer: statement.isTrue ? '对' : '错', ...(card.quote ? {quote: card.quote} : {}), ...(statement.why ? {extra: statement.why} : {})},
      keys: generated.keys || []};
  }
  if (item.mode === 'cloze' && generated?.cloze) {
    const cloze = generated.cloze;
    const bank = shuffle([...cloze.blanks, ...cloze.distractors], rng);
    return {...base, prompt: cloze.text, bank, answer: [...cloze.blanks],
      reveal: {question: cloze.text, answer: cloze.blanks.join('、'), ...(card.quote ? {quote: card.quote} : {})},
      keys: generated.keys || []};
  }
  if (item.mode === 'order' && generated?.order) {
    return {...base, prompt: card.question || '按正确顺序排列', steps: [...generated.order.steps], answer: [...generated.order.steps],
      reveal: {question: card.question || '按正确顺序排列', answer: generated.order.steps.join(' → '), ...(card.quote ? {quote: card.quote} : {})},
      keys: generated.keys || []};
  }
  if (item.mode === 'write') {
    return {...base, mode: 'write', prompt: card.question, answer: card.answer, judge: 'model',
      reveal: revealOf(card, card.answer), keys: generated?.keys || []};
  }
  if (item.mode === 'pairs') {
    const labels = cards.map(pairLabel);
    const right = shuffle(labels.map((text, source) => ({text, source})), rng);
    return {...base, mode: 'pairs', prompt: '把问题和答案连起来',
      pairs: {left: cards.map(entry => entry.question), right: right.map(entry => entry.text)},
      answer: cards.map((_, left) => [left, right.findIndex(entry => entry.source === left)]),
      reveal: {question: '配对', answer: cards.map((entry, source) => `${entry.question} → ${labels[source]}`).join('；')}};
  }
  if (item.mode === 'homophonePairs') {
    const right = shuffle(cards.map((entry, source) => ({text: entry.homophone, source})), rng);
    return {...base, mode: 'homophonePairs', prompt: '把单词和它的谐音连起来',
      pairs: {left: cards.map(entry => entry.word), right: right.map(entry => entry.text)},
      answer: cards.map((_, left) => [left, right.findIndex(entry => entry.source === left)]),
      reveal: {question: '谐音配对', answer: cards.map(entry => `${entry.word} → ${entry.homophone}`).join('；')}};
  }
  if (item.mode === 'meet') {
    const extra = [card.phonetic, card.homophone].filter(Boolean).join(' · ');
    return {...base, mode: 'meet', prompt: card.word, speak: card.word, answer: card.meaning,
      reveal: revealOf(card, card.meaning, extra)};
  }
  if (item.mode === 'word2meaning' || item.mode === 'meaning2word' || item.mode === 'listen') {
    const correct = item.mode === 'word2meaning' ? card.meaning : card.word;
    const field = item.mode === 'word2meaning' ? 'meaning' : 'word';
    const picked = choiceFromTexts(correct, distractors(card, vocabPool, field, correct), rng);
    if (!picked) return materialize({...item, mode: 'flip'}, index, rng, vocabPool);
    const prompt = item.mode === 'listen' ? '听一听，选出单词' : item.mode === 'meaning2word' ? card.meaning : card.word;
    return {...base, mode: item.mode, prompt, ...(item.mode !== 'word2meaning' ? {speak: card.word} : {}), options: picked.options, answer: picked.answer,
      reveal: revealOf(card, card.meaning, card.homophone || '')};
  }
  if (item.mode === 'collocation') {
    const collocation = (card.collocations || []).find(entry => entry?.en);
    if (!collocation) return materialize({...item, mode: 'flip'}, index, rng, vocabPool);
    const pattern = new RegExp(String(card.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const text = pattern.test(collocation.en) ? collocation.en.replace(pattern, '{{blank}}') : collocation.en.replace(/\S+$/, '{{blank}}');
    const bank = shuffle([card.word, ...distractors(card, vocabPool, 'word', card.word)], rng);
    return {...base, mode: 'collocation', prompt: `${collocation.zh || '搭配'}：${text}`, bank, answer: card.word,
      reveal: revealOf(card, collocation.en, collocation.zh || '')};
  }
  if (item.mode === 'spell' || item.mode === 'dictate') {
    const prompt = item.mode === 'spell' ? (card.meaning || '看释义，拼写单词') : '听写这个单词';
    return {...base, mode: item.mode, prompt, speak: card.word, answer: card.word, judge: 'local',
      reveal: revealOf(card, card.word, card.meaning || '')};
  }
  const prompt = card.book === 'vocab' ? card.word : card.question;
  const answer = card.book === 'vocab' ? card.meaning : card.answer;
  return {...base, mode: item.mode === 'look' || item.mode === 'meet' ? item.mode : 'flip', prompt, answer,
    ...(card.book === 'vocab' ? {speak: card.word} : {}),
    reveal: revealOf(card, answer, card.book === 'vocab' ? [card.phonetic, card.homophone].filter(Boolean).join(' · ') : '')};
}

export function buildSession(cards, {size = 10, now = Date.now(), source = 'notes', flipOnly = false, rng = Math.random} = {}) {
  void now;
  const target = normalizeSize(size);
  const all = (Array.isArray(cards) ? cards : []).filter(card => card && card.key);
  const vocabPool = all.filter(card => card.book === 'vocab');
  const notePool = all.filter(card => card.book === 'notes');
  const pool = source === 'mixed' ? mixDrillCards(notePool, vocabPool) : source === 'vocab' ? vocabPool : notePool;
  const context = {flipOnly, vocabPool};
  const used = new Set();
  const intros = [];
  const follows = [];
  const singles = [];
  const bundles = [];
  let slots = 0;
  const take = card => used.add(card.key);

  if (!flipOnly) {
    for (const card of pool) {
      if ((Number(card.strength) || 0) > 0 || card.learnedAt) continue;
      if (slots + 2 > target) continue;
      take(card);
      slots += 2;
      intros.push(planItem(card.book === 'vocab' ? 'meet' : 'look', [card], 'intro', context));
      follows.push(planItem(followMode(card, context), [card], 'follow', context));
    }
  }
  if (!flipOnly && slots < target) {
    const pairable = pool.filter(card => !used.has(card.key) && card.book === 'notes' && (Number(card.strength) || 0) >= 1 && (Number(card.strength) || 0) <= 2);
    const labels = new Set(pairable.slice(0, 5).map(card => foldDrillText(pairLabel(card))));
    // 右栏标签折叠后有重复就分不清该连哪个，这组不出配对，卡片留给后面的单题。
    if (pairable.length >= 4 && labels.size === Math.min(5, pairable.length)) {
      const group = pairable.slice(0, pairable.length >= 5 ? 5 : 4);
      group.forEach(take);
      bundles.push(planItem('pairs', group, 'pairs', context));
      slots += 1;
    }
  }
  if (!flipOnly && slots < target) {
    const seen = new Set();
    const homo = [];
    for (const card of pool) {
      if (used.has(card.key) || card.book !== 'vocab') continue;
      const strength = Number(card.strength) || 0;
      const sound = clean(card.homophone, 60);
      const key = foldDrillText(sound);
      if (strength < 1 || strength > 2 || !key || seen.has(key)) continue;
      seen.add(key);
      homo.push(card);
    }
    if (homo.length >= 5) {
      const group = homo.slice(0, 5);
      group.forEach(take);
      bundles.push(planItem('homophonePairs', group, 'pairs', context));
      slots += 1;
    }
  }
  for (const card of pool) {
    if (slots >= target || used.has(card.key)) continue;
    if (!flipOnly && (Number(card.strength) || 0) <= 0 && !card.learnedAt) continue;
    take(card);
    const mode = flipOnly ? 'flip' : followMode(card, context);
    singles.push(planItem(mode, [card], 'single', context));
    slots += 1;
  }
  return arrange(diversify([...intros, ...singles, ...bundles, ...follows])).slice(0, target)
    .map((item, index) => materialize(item, index, rng, vocabPool));
}

function validateKeys(keys, answer) {
  if (!Array.isArray(keys) || tooLong(keys)) return null;
  const folded = foldDrillText(answer);
  const kept = [];
  for (const key of keys.slice(0, 4)) {
    const text = clean(key, 600);
    const token = foldDrillText(text);
    if (!text || !token || !folded.includes(token) || kept.some(item => foldDrillText(item) === token)) continue;
    kept.push(text);
  }
  return kept.length ? kept : null;
}

function validateChoice(choice, keys) {
  if (!choice || typeof choice !== 'object' || tooLong(choice)) return null;
  const options = Array.isArray(choice.options) ? choice.options.map(option => clean(option, 600)) : [];
  if (options.length !== 4 || options.some(option => !option) || new Set(options).size !== 4) return null;
  const answer = choice.answer;
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null;
  const correct = foldDrillText(options[answer]);
  if (!(keys || []).some(key => correct.includes(foldDrillText(key)))) return null;
  const stem = clean(choice.stem, 600);
  if (!stem) return null;
  return {stem, options, answer, why: clean(choice.why, 600)};
}

function validateTrueFalse(value) {
  if (!value || typeof value !== 'object' || tooLong(value) || typeof value.isTrue !== 'boolean') return null;
  const statement = clean(value.statement, 600);
  if (!statement) return null;
  return {statement, isTrue: value.isTrue, why: clean(value.why, 600)};
}

function validateCloze(cloze, keys) {
  if (!cloze || typeof cloze !== 'object' || tooLong(cloze) || !keys?.length) return null;
  const blanks = Array.isArray(cloze.blanks) ? cloze.blanks.map(blank => clean(blank, 600)).filter(Boolean) : [];
  if (blanks.length < 1 || blanks.length > 3) return null;
  const text = clean(cloze.text, 600);
  const marks = [...text.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
  const expected = blanks.map((_, index) => index + 1);
  if (marks.length !== blanks.length || marks.slice().sort((a, b) => a - b).join() !== expected.join()) return null;
  const keySet = new Set(keys.map(foldDrillText));
  if (!blanks.every(blank => keySet.has(foldDrillText(blank)))) return null;
  const distractors = Array.isArray(cloze.distractors) ? cloze.distractors.map(item => clean(item, 600)).filter(Boolean) : [];
  const blankSet = new Set(blanks.map(foldDrillText));
  if (!distractors.length || distractors.some(item => blankSet.has(foldDrillText(item))) || new Set(distractors.map(foldDrillText)).size !== distractors.length) return null;
  return {text, blanks, distractors};
}

function validateOrder(order) {
  if (order == null) return null;
  if (typeof order !== 'object' || tooLong(order)) return null;
  const steps = Array.isArray(order.steps) ? order.steps.map(step => clean(step, 600)).filter(Boolean) : [];
  if (steps.length < 2 || steps.length > 6 || new Set(steps).size !== steps.length) return null;
  return {steps};
}

export function validateDrillCards(result, batch = []) {
  const input = new Map((Array.isArray(batch) ? batch : []).map(card => [card.id, card]));
  const output = new Map();
  const seen = new Set();
  for (const raw of Array.isArray(result?.cards) ? result.cards : []) {
    const card = input.get(raw?.id);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    const items = {};
    const keys = validateKeys(raw.keys, card.answer);
    if (keys) items.keys = keys;
    const choice = keys ? validateChoice(raw.choice, keys) : null;
    if (choice) items.choice = choice;
    const truefalse = validateTrueFalse(raw.truefalse);
    if (truefalse) items.truefalse = truefalse;
    const cloze = validateCloze(raw.cloze, keys);
    if (cloze) items.cloze = cloze;
    const order = validateOrder(raw.order);
    if (order) items.order = order;
    if (Object.keys(items).length) output.set(card.id, items);
  }
  return output;
}

function emptyStore() {
  return {v: 1, cards: {}, sessions: {}, settings: {size: 10, jarGoal: 30, flipOnly: false}};
}

export function itemRefs(item = {}) {
  const ref = item.cardRef || {};
  if (Array.isArray(ref.refs)) {
    return ref.refs.map(entry => ref.book === 'vocab'
      ? {book: 'vocab', key: `vocab:${entry.wordId}`, wordId: entry.wordId}
      : {book: 'notes', key: `notes:${entry.recallId}`, noteId: entry.noteId, recallId: entry.recallId});
  }
  if (ref.book === 'vocab') return [{book: 'vocab', key: `vocab:${ref.wordId}`, wordId: ref.wordId}];
  if (ref.book === 'hunt') return [{book: 'hunt', key: `hunt:${ref.monsterId}`, monsterId: ref.monsterId}];
  return [{book: 'notes', key: `notes:${ref.recallId}`, noteId: ref.noteId, recallId: ref.recallId}];
}

function fullyCorrect(answer) {
  return answer?.correct === true && answer.verdict !== 'wrong' && answer.verdict !== 'partial';
}

export class LearningDrill {
  constructor(store, {organizer = null, schedule = null, recall = null, vocab = null, pact = null, now = () => Date.now()} = {}) {
    this.store = store;
    this.organizer = organizer;
    this.schedule = schedule;
    this.recall = recall || store.recall || null;
    this.vocab = vocab || store.vocab || null;
    this.pact = pact || store.pact || null;
    this.now = now;
    this.file = path.join(store.root, 'notes-drill.json');
    this.requested = new Set();
    this.pendingCards = new Map();
    this.explaining = new Map();
    this.running = null;
  }

  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {v: 1, cards: data.cards || {}, sessions: data.sessions || {}, settings: data.settings || {}};
    } catch {
      return emptyStore();
    }
  }

  write(data) {
    const sessions = {...(data.sessions || {})};
    const ranked = Object.values(sessions).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (b.seq || 0) - (a.seq || 0));
    for (const session of ranked.slice(20)) delete sessions[session.sessionId];
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const temp = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({v: 1, cards: data.cards || {}, sessions, settings: data.settings || {}}, null, 2), {mode: 0o600});
    fs.renameSync(temp, this.file);
  }

  settings() {
    const stored = this.read().settings || {};
    return {
      size: SIZES.includes(stored.size) ? stored.size : 10,
      jarGoal: GOALS.includes(stored.jarGoal) ? stored.jarGoal : 30,
      flipOnly: stored.flipOnly === true,
    };
  }

  setSettings({size, jarGoal, flipOnly} = {}) {
    const next = this.settings();
    if (size !== undefined) {
      if (!SIZES.includes(size)) throw new Error('一组题数只能是 5、10、15 或 20');
      next.size = size;
    }
    if (jarGoal !== undefined) {
      if (!GOALS.includes(jarGoal)) throw new Error('星星罐目标只能是 15、30 或 50');
      next.jarGoal = jarGoal;
    }
    if (flipOnly !== undefined) next.flipOnly = Boolean(flipOnly);
    const data = this.read();
    data.settings = next;
    this.write(data);
    return next;
  }

  modelStatus(sessionKey) {
    try {
      const catalog = this.organizer?.catalog?.();
      if (catalog?.defaultRef) return {available: true, model: catalog.defaultRef, modelName: catalog.defaultRef};
      const status = this.organizer?.status?.(sessionKey);
      return status?.available ? status : {available: false, model: ''};
    } catch {
      return {available: false, model: ''};
    }
  }

  noteCards(sessionKey, scope, now) {
    if (!this.recall) return [];
    const data = this.recall.read();
    const drill = this.read();
    const kind = scope?.kind || 'due';
    const ids = new Set(Array.isArray(scope?.ids) ? scope.ids.map(String) : []);
    const cards = [];
    // 笔记本是全局的：不管从哪个聊天打开背一背，笔记都按笔记本的会话键取（和笔记本页一样），
    // 否则只看得到在当前这个聊天里收的笔记。
    void sessionKey;
    for (const note of this.recall.notes(LIBRARY)) {
      if (kind === 'section') {
        if ((note.exam || 'other') !== (scope.exam || 'other')) continue;
        if ((note.subject || '未分类') !== (scope.subject || '未分类')) continue;
        if (scope.topic && (note.topic || '未分类') !== scope.topic) continue;
      }
      if (kind === 'notes' && !ids.has(note.id)) continue;
      const record = this.recall.stateFor(note, data);
      if (!record || record.status !== 'ready' || !Array.isArray(record.cards)) continue;
      for (const card of record.cards) {
        const due = !Number(card.nextReviewAt) || Number(card.nextReviewAt) <= now;
        if ((kind === 'due' || !scope) && !due) continue;
        if (kind === 'more' && due) continue;
        const view = {
          book: 'notes', key: `notes:${card.id}`, noteId: note.id, recallId: card.id,
          question: card.question, answer: card.answer, quote: card.quote || '',
          subject: note.subject || '', topic: note.topic || '', exam: note.exam || '',
          strength: drillStrength(card), learnedAt: card.learnedAt || 0,
          nextReviewAt: card.nextReviewAt || 0, due,
          reviewLevel: card.reviewLevel, reviewCount: card.reviewCount, lapses: card.lapses,
        };
        view.hash = drillCardHash(view);
        const stored = drill.cards[card.id];
        view.generated = stored && stored.hash === view.hash && stored.status === 'ready' ? stored.items : null;
        view.drillStatus = stored && stored.hash === view.hash ? stored.status : '';
        cards.push(view);
      }
    }
    if (kind === 'more') cards.sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0));
    return cards;
  }

  // 旧的「今天回顾」打开时会顺手给没有回忆卡的笔记拆卡；背一背接替了它，这件事也接过来：
  // 这一组范围内、还没有当前回忆卡的笔记排进回忆卡队列（失败过的不自动重试，最多 20 条）。返回排进去和正在拆的条数。
  prepareRecall(sessionKey, scope, now) {
    if (!this.recall?.enqueue) return 0;
    try {
      const kind = scope?.kind || 'due';
      const ids = new Set(Array.isArray(scope?.ids) ? scope.ids.map(String) : []);
      const data = this.recall.read();
      const wanted = [];
      void sessionKey;
      for (const note of this.recall.notes(LIBRARY)) {
        if (kind === 'section') {
          if ((note.exam || 'other') !== (scope.exam || 'other')) continue;
          if ((note.subject || '未分类') !== (scope.subject || '未分类')) continue;
          if (scope.topic && (note.topic || '未分类') !== scope.topic) continue;
        }
        if (kind === 'notes' && !ids.has(note.id)) continue;
        if (this.recall.stateFor(note, data)) continue;
        wanted.push(note.id);
        if (wanted.length >= 20) break;
      }
      if (wanted.length) this.recall.enqueue(LIBRARY, {ids: wanted});
      const fresh = this.recall.read();
      return Object.values(fresh.records || {}).filter(record => record?.status === 'queued' || record?.status === 'running').length;
    } catch {
      return 0;
    }
  }

  wordCards(scope, now) {
    if (!this.vocab) return [];
    const kind = scope?.kind || 'due';
    const cards = [];
    for (const word of this.vocab.drillWords?.(now) || []) {
      if (word.status && word.status !== 'ready') continue;
      const due = !Number(word.nextReviewAt) || Number(word.nextReviewAt) <= now;
      if ((kind === 'due' || kind === 'section' || !scope) && !due) continue;
      if (kind === 'more' && due) continue;
      cards.push({
        book: 'vocab', ...word, key: `vocab:${word.wordId}`,
        question: word.word, answer: word.meaning, quote: '',
        strength: drillStrength(word), learnedAt: word.learnedAt || 0, due,
        subject: '', topic: '',
      });
    }
    if (kind === 'more') cards.sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0));
    return cards;
  }

  enqueueNotes(sessionKey, noteIds) {
    const wanted = new Set((noteIds || []).map(String));
    const cards = this.noteCards(sessionKey, {kind: 'all'}, this.now()).filter(card => !wanted.size || wanted.has(card.noteId));
    return this.enqueueCards(sessionKey, cards);
  }

  enqueueCards(sessionKey, cards) {
    const available = Boolean(this.modelStatus(sessionKey).available && this.organizer?.requestModel);
    if (!available) return {queued: 0, available: false};
    const data = this.read();
    let queued = 0;
    for (const card of cards) {
      if (card.book !== 'notes') continue;
      const existing = data.cards[card.recallId];
      const same = existing?.hash === card.hash;
      if (same && (existing.status === 'ready' || (existing.status === 'running' && this.running))) continue;
      if (this.requested.has(card.recallId)) continue;
      data.cards[card.recallId] = {hash: card.hash, status: 'queued', items: same ? existing.items || {} : {}, at: this.now(), error: '', noteId: card.noteId};
      this.pendingCards.set(card.recallId, {id: card.recallId, question: card.question, answer: card.answer, quote: card.quote || '', subject: card.subject || '', hash: card.hash, noteId: card.noteId});
      this.requested.add(card.recallId);
      queued += 1;
    }
    if (queued) {
      this.write(data);
      this.start(sessionKey);
    }
    return {queued, running: Boolean(this.running), available};
  }

  start(sessionKey) {
    if (this.running) return this.running;
    this.running = Promise.resolve().then(async () => {
      let stop = false;
      while (this.requested.size && !stop) {
        const ids = [...this.requested].slice(0, 6);
        ids.forEach(id => this.requested.delete(id));
        const batch = ids.map(id => this.pendingCards.get(id)).filter(Boolean);
        if (!batch.length) continue;
        const before = this.read();
        for (const card of batch) {
          const prev = before.cards[card.id] || {};
          before.cards[card.id] = {...prev, hash: card.hash, status: 'running', items: prev.items || {}, at: this.now(), noteId: card.noteId};
        }
        this.write(before);
        try {
          const status = this.modelStatus(sessionKey);
          const input = batch.map(card => ({id: card.id, question: card.question, answer: card.answer, quote: card.quote, subject: card.subject || ''}));
          const result = await this.organizer.requestModel(status.model, DRILL_RULES, input, true, {userText: JSON.stringify(input), maxTokens: 16000, timeoutMs: 120000});
          const accepted = validateDrillCards(result, input);
          const live = this.read();
          for (const card of batch) {
            if (live.cards[card.id]?.hash !== card.hash) continue;
            const items = accepted.get(card.id) || {};
            live.cards[card.id] = {hash: card.hash, status: 'ready', items, at: this.now(), error: Object.keys(items).length ? '' : '没有通过校验的题型', noteId: card.noteId};
          }
          this.write(live);
        } catch (error) {
          const live = this.read();
          const message = clean(error?.message || error, 300);
          for (const card of batch) if (live.cards[card.id]?.hash === card.hash) live.cards[card.id] = {...live.cards[card.id], status: 'failed', error: message, items: {}};
          if (STOP_RE.test(message)) {
            stop = true;
            for (const id of this.requested) {
              const card = this.pendingCards.get(id);
              if (card && live.cards[id]) live.cards[id] = {...live.cards[id], status: 'failed', error: message};
            }
            this.requested.clear();
          }
          this.write(live);
        }
      }
    }).finally(() => { this.running = null; });
    return this.running;
  }

  session({sessionKey, source = 'notes', scope, size} = {}) {
    const key = String(sessionKey || '');
    const settings = this.settings();
    const src = ['notes', 'vocab', 'mixed'].includes(source) ? source : 'notes';
    const now = this.now();
    const noteScope = src === 'vocab' ? null : (scope || {kind: 'due'});
    const wordScope = src === 'notes' ? null : (src === 'mixed' ? {kind: 'due'} : (scope || {kind: 'due'}));
    const splitting = src === 'vocab' ? 0 : this.prepareRecall(key, src === 'mixed' && scope?.kind !== 'section' ? {kind: 'due'} : noteScope, now);
    let notes = src === 'vocab' ? [] : this.noteCards(key, noteScope, now);
    let words = src === 'notes' ? [] : this.wordCards(wordScope, now);
    if (src === 'mixed' && scope?.kind === 'section') notes = this.noteCards(key, scope, now);
    if (src === 'mixed' && scope?.kind === 'more') {
      notes = this.noteCards(key, {kind: 'more'}, now);
      words = this.wordCards({kind: 'more'}, now);
    }
    const missing = notes.filter(card => !usableGenerated(card.generated));
    this.enqueueCards(key, missing);
    const fresh = this.read();
    notes = notes.map(card => {
      const stored = fresh.cards[card.recallId];
      return {...card, generated: stored && stored.hash === card.hash && stored.status === 'ready' ? stored.items : null,
        drillStatus: stored && stored.hash === card.hash ? stored.status : card.drillStatus};
    });
    const pool = src === 'mixed' ? [...notes, ...words] : src === 'vocab' ? words : notes;
    if (!pool.length && splitting) throw new Error('碧琪正在把笔记拆成回忆卡，过一两分钟再来背');
    if (!pool.length) throw new Error('今天没有可背的卡片');
    const items = buildSession(pool, {size: size || settings.size, now, source: src, flipOnly: settings.flipOnly});
    if (!items.length) throw new Error('今天没有可背的卡片');
    const used = new Set(items.flatMap(item => itemRefs(item).map(ref => ref.key)));
    const duePool = (src === 'vocab' ? words : src === 'notes' ? notes : [...notes, ...words]).filter(card => card.due);
    const session = {
      sessionId: `drill-${randomUUID()}`, sessionKey: key, source: src, scope: scope || {kind: 'due'},
      size: normalizeSize(size || settings.size), createdAt: now, seq: this.seq = (this.seq || 0) + 1, items, graded: {}, learned: {}, answers: [],
      jarAtStart: this.pact?.jar?.({now, goal: settings.jarGoal})?.today || 0, finished: null,
    };
    const data = this.read();
    data.sessions[session.sessionId] = session;
    this.write(data);
    try { this.store?.game?.onDrillSession?.(session, pool); } catch {}
    const pending = notes.filter(card => card.drillStatus === 'queued' || card.drillStatus === 'running' || fresh.cards[card.recallId]?.status === 'queued' || fresh.cards[card.recallId]?.status === 'running').length;
    return {
      sessionId: session.sessionId, items, pending, dueLeft: duePool.filter(card => !used.has(card.key)).length,
      settings: {soundDefault: true, size: settings.size, jarGoal: settings.jarGoal, flipOnly: settings.flipOnly},
    };
  }

  load(sessionId) {
    const session = this.read().sessions[String(sessionId || '')];
    if (!session) throw new Error('这一组已经不在了');
    return session;
  }

  save(session) {
    const data = this.read();
    data.sessions[session.sessionId] = session;
    this.write(data);
  }

  answer({sessionId, itemId, correct = false, firstTry = true, hinted = false, ms = 0, verdict} = {}) {
    const session = this.load(sessionId);
    const item = (session.items || []).find(entry => entry.itemId === itemId);
    if (!item) throw new Error('这道题不在这一组里');
    const rating = mapDrillRating(item.mode, {correct, firstTry, hinted, ms, verdict});
    const refs = itemRefs(item);
    let fresh = false;
    for (const ref of refs) {
      if (session.graded[ref.key]) continue;
      fresh = true;
      session.graded[ref.key] = {rating, correct: correct === true, firstTry: firstTry !== false, at: this.now()};
      if (rating) this.grade(session, ref, rating);
    }
    const stars = fresh && firstTry !== false && correct === true && verdict !== 'wrong' && verdict !== 'partial' ? 1 : 0;
    if (stars) this.pact?.recordDrill?.({stars});
    session.answers.push({itemId, mode: item.mode, correct: correct === true, firstTry: firstTry !== false, hinted: Boolean(hinted), ms: Number(ms) || 0, verdict: verdict || null, stars, at: this.now()});
    this.save(session);
    let game = {awards: []};
    try { game = {awards: this.store?.game?.onDrillAnswer?.({session, item, correct, firstTry, verdict, fresh, refs}) || []}; } catch {}
    return {rating: fresh ? rating : null, stars, requeue: correct !== true || verdict === 'wrong', game};
  }

  grade(session, ref, rating) {
    if (ref.book === 'hunt') return; // 错题怪变体题：怪的状态由 learning-game 推进，不进回忆卡 / 生词曲线
    const now = this.now();
    if (ref.book === 'vocab') this.vocab?.review?.(ref.wordId, rating, now, {source: 'drill', sessionId: session.sessionId});
    else this.recall?.review?.(LIBRARY, {id: ref.noteId, recallId: ref.recallId, rating, now, source: 'drill', sessionId: session.sessionId});
  }

  learned({sessionId, itemId} = {}) {
    const session = this.load(sessionId);
    const item = (session.items || []).find(entry => entry.itemId === itemId);
    if (!item) throw new Error('这道题不在这一组里');
    if (item.mode !== 'look' && item.mode !== 'meet') throw new Error('这道题不用标记学过');
    const now = this.now();
    for (const ref of itemRefs(item)) {
      if (ref.book === 'vocab') this.vocab?.markLearned?.(ref.wordId, now);
      else this.recall?.markLearned?.(LIBRARY, {id: ref.noteId, recallId: ref.recallId, now});
    }
    session.learned[item.itemId] = true;
    this.save(session);
    return {ok: true};
  }

  // 标准答案已经在卷子上。这里只在做完之后，让模型顺着这份答案讲，不另给一个答案。
  explain(params = {}) {
    const key = JSON.stringify([params.sessionId, params.itemId]);
    if (this.explaining.has(key)) return this.explaining.get(key);
    const job = this.explainOne(params).finally(() => this.explaining.delete(key));
    this.explaining.set(key, job);
    return job;
  }
  async explainOne({sessionId, itemId, yours = ''} = {}) {
    const session = this.load(sessionId);
    const item = (session.items || []).find(entry => entry.itemId === itemId);
    if (!item) throw new Error('这道题不在这一组里');
    const last = [...(session.answers || [])].reverse().find(entry => entry.itemId === itemId);
    if (!last && !session.learned?.[itemId]) throw new Error('先做完这题');
    session.explained ||= {};
    if (session.explained[itemId]?.text && session.explained[itemId].v === EXPLAIN_VERSION) return session.explained[itemId];
    const standard = clean(typeof item.reveal?.answer === 'string' ? item.reveal.answer : (typeof item.answer === 'string' ? item.answer : ''), 400);
    const note = clean(item.reveal?.extra || '', 300);
    const correct = last ? fullyCorrect(last) : true;
    const attempt = correct ? '' : clean(yours, 200);
    const local = {text: note, source: note ? 'local' : 'none'};
    const keep = out => { if (out.text) { session.explained[itemId] = out; this.save(session); } return out.text ? out : local; };
    const status = this.modelStatus(session.sessionKey);
    if (!standard) return {...local, error: '这道题缺少标准答案，暂时不能讲解。'};
    if (!status.available || !this.organizer?.requestModel) return {...local, error: explainFailure('模型暂时不可用')};
    try {
      const payload = explainInput({question: item.reveal?.question || item.prompt || '', options: item.options, standard, note, yours: attempt, correct});
      const ask = (rules, maxTokens) => this.organizer.requestModel(status.model, rules, payload, true, {userText: JSON.stringify(payload), maxTokens, timeoutMs: 120000});
      const read = result => validVoicedExplain(result)?.text || validVoicedExplain(result?.value)?.text;
      let text = '', failure;
      for (const [rules, budget] of useCompactExplain() ? [[compactExplainRules(), 5200]] : [[explainRules(), 1500], [compactExplainRules(), 5200]]) {
        try { text = read(await ask(rules, budget)); failure = undefined; } catch (error) { failure = error; text = ''; }
        if (text) break;
        // 会长篇思考的模型会把 token 花光、正文为空：换精简提示词再来一次，并记住一阵子。
        if (failure && !/未完成|没有返回有效|没通过校验/.test(String(failure.message || failure))) break;
        markCompactExplain();
      }
      return text ? keep({text, source: 'model', v: EXPLAIN_VERSION}) : {...local, error: explainFailure(failure)};
    } catch (error) {
      return {...local, error: explainFailure(error)};
    }
  }

  async judge({sessionId, itemId, text = ''} = {}) {
    const session = this.load(sessionId);
    const item = (session.items || []).find(entry => entry.itemId === itemId);
    if (!item) throw new Error('这道题不在这一组里');
    const answer = typeof item.answer === 'string' ? item.answer : item.reveal?.answer || '';
    const keys = item.keys || [];
    const local = () => item.mode === 'spell' || item.mode === 'dictate' ? spellVerdict(answer, text) : localJudge({answer, keys, text});
    if (item.judge === 'local' || item.mode === 'spell' || item.mode === 'dictate' || !this.organizer?.requestModel) return local();
    try {
      const status = this.modelStatus(session.sessionKey);
      if (!status.available) return local();
      const payload = {question: item.reveal?.question || item.prompt || '', answer, keys, text: String(text ?? '')};
      const result = await this.organizer.requestModel(status.model, DRILL_JUDGE_RULES, payload, true, {userText: JSON.stringify(payload), maxTokens: 1200, timeoutMs: 25000});
      if (!['correct', 'partial', 'wrong'].includes(result?.verdict)) return local();
      const missing = Array.isArray(result.missing) ? result.missing.map(item => clean(item, 80)).filter(Boolean).slice(0, 3) : [];
      const comment = clean(result.comment, 80) || FALLBACK_COMMENT;
      return {verdict: result.verdict, missing, comment};
    } catch {
      return local();
    }
  }

  summary(session, now = this.now()) {
    const first = new Map();
    for (const answer of session.answers || []) if (!first.has(answer.itemId)) first.set(answer.itemId, answer);
    const scored = [...first.values()].filter(answer => answer.mode !== 'look' && answer.mode !== 'meet');
    const correct = scored.filter(fullyCorrect).length;
    const answerStars = (session.answers || []).reduce((sum, answer) => sum + (answer.stars || 0), 0);
    let combo = 0;
    let maxCombo = 0;
    for (const answer of session.answers || []) {
      combo = fullyCorrect(answer) ? combo + 1 : 0;
      maxCombo = Math.max(maxCombo, combo);
    }
    const accuracy = scored.length ? correct / scored.length : 0;
    return {scored: scored.length, correct, accuracy, answerStars, maxCombo, ms: Math.max(0, now - (session.createdAt || now))};
  }

  finish({sessionId} = {}) {
    const session = this.load(sessionId);
    if (session.finished) return session.finished;
    const now = this.now();
    const stats = this.summary(session, now);
    const dayKey = dayInZone(now, 'Asia/Shanghai');
    const day = this.pact?.readDay?.(dayKey);
    const beforeSets = day?.drillFinished || 0;
    const firstFinishToday = beforeSets === 0;
    const bonus = drillStars({answerStars: 0, scored: stats.scored, correct: stats.correct, finished: true});
    const stars = stats.answerStars + bonus;
    if (bonus) this.pact?.recordDrill?.({stars: bonus, finished: true});
    else this.pact?.recordDrill?.({finished: true});
    const afterSets = this.pact?.readDay?.(dayKey)?.drillFinished || beforeSets + 1;
    const filledNow = beforeSets < JAR_SETS && afterSets >= JAR_SETS;
    const streak = this.pact?.drillStreak?.({now}) || {current: 0, best: 0, stampedToday: firstFinishToday, leaveUsedYesterday: false};
    const quiet = examQuiet(this.pact, now);
    const result = {
      stars, accuracy: stats.accuracy, ms: stats.ms, maxCombo: stats.maxCombo, firstFinishToday,
      streak: {current: streak.current || 0, best: streak.best || 0, stampedToday: Boolean(streak.stampedToday), leaveUsedYesterday: Boolean(streak.leaveUsedYesterday)},
      jar: {today: afterSets, goal: JAR_SETS, unit: 'sets', filledNow},
      leaveNotes: streak.leaveNotes ?? this.pact?.leaveNotes?.({now})?.balance ?? 0,
      quiet, nextSuggestion: this.nextSuggestion(session, now),
    };
    session.stats = stats;
    session.finished = result;
    session.quiet = quiet;
    session.jarFull = filledNow;
    this.save(session);
    try { return {...result, game: {awards: this.store?.game?.onDrillFinish?.({session, result}) || []}}; } catch { return result; }
  }

  nextSuggestion(session, now) {
    const source = session.source || 'notes';
    const dueNotes = source === 'vocab' ? [] : this.noteCards(session.sessionKey, {kind: 'due'}, now);
    const dueWords = source === 'notes' ? [] : this.wordCards({kind: 'due'}, now);
    const used = new Set((session.items || []).flatMap(item => itemRefs(item).map(ref => ref.key)));
    const dueLeft = [...dueNotes, ...dueWords].filter(card => !used.has(card.key)).length;
    if (dueLeft > 0) return {source, scope: {kind: 'due'}, label: '再背一组'};
    const moreNotes = source === 'vocab' ? [] : this.noteCards(session.sessionKey, {kind: 'more'}, now);
    const moreWords = source === 'notes' ? [] : this.wordCards({kind: 'more'}, now);
    if (moreNotes.length + moreWords.length > 0) return {source, scope: {kind: 'more'}, label: '再背一组'};
    return null;
  }

  async cheer({sessionId} = {}) {
    const session = this.load(sessionId);
    const now = this.now();
    const stats = session.stats || this.summary(session, now);
    const line = localCheer({
      accuracy: session.finished?.accuracy ?? stats.accuracy ?? 0,
      jarFull: Boolean(session.jarFull || session.finished?.jar?.filledNow),
      quiet: Boolean(session.quiet || session.finished?.quiet || examQuiet(this.pact, now)),
      scored: stats.scored || 0,
    });
    if (!this.organizer?.requestModel) return {line};
    try {
      const status = this.modelStatus(session.sessionKey);
      if (!status.available) return {line};
      // stats 来自 summary()，没有今天第一组、罐子和 +5/+5 奖励；这些以结算结果为准。
      const payload = cheerPayload(session, {...stats, ...(session.finished || {})}, this.pact, now);
      const result = await this.organizer.requestModel(status.model, DRILL_CHEER_RULES, payload, true, {userText: JSON.stringify(payload), maxTokens: 400, timeoutMs: 15000});
      const modelLine = clean(result?.line, 80);
      return {line: modelLine || line};
    } catch {
      return {line};
    }
  }

  today(now = this.now()) {
    const streak = this.pact?.drillStreak?.({now}) || {current: 0, best: 0, week: Array(7).fill(false), weekKind: Array(7).fill('empty'), stampedToday: false, leaveUsedYesterday: false, leaveNotes: 0};
    const sets = this.pact?.readDay?.(dayInZone(now, 'Asia/Shanghai'))?.drillFinished || 0;
    let dueNotes = 0;
    let dueWords = 0;
    try { dueNotes = this.recall?.snapshot?.(LIBRARY, {now})?.dueCount || 0; } catch { dueNotes = 0; }
    try { dueWords = this.vocab?.today?.(now)?.due || 0; } catch { dueWords = 0; }
    return {
      jar: {today: sets, goal: JAR_SETS, unit: 'sets'},
      streak: {
        current: streak.current || 0, best: streak.best || 0, week: streak.week || Array(7).fill(false),
        weekKind: streak.weekKind || Array(7).fill('empty'), stampedToday: Boolean(streak.stampedToday),
        leaveUsedYesterday: Boolean(streak.leaveUsedYesterday),
      },
      leaveNotes: streak.leaveNotes ?? 0, dueNotes, dueWords,
    };
  }
}

function spellVerdict(answer, text) {
  const verdict = localJudge({answer, keys: [answer], text});
  if (verdict.verdict === 'correct') return {verdict: 'correct', missing: [], comment: '拼写对了。'};
  if (verdict.verdict === 'partial') return {...verdict, comment: '差一点点。'};
  return {verdict: 'wrong', missing: [answer].filter(Boolean).slice(0, 3), comment: '再看一眼这个词。'};
}

function beijingHour(now) {
  const hour = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23'}).format(new Date(now));
  return Number(hour);
}

function daysUntil(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function examQuiet(pact, now) {
  try {
    const today = dayInZone(now, 'Asia/Shanghai');
    return (pact?.get?.()?.exams || []).some(exam => exam?.date && daysUntil(today, exam.date) >= 0 && daysUntil(today, exam.date) <= 7);
  } catch {
    return false;
  }
}

function cheerPayload(session, stats, pact, now) {
  const subjects = [...new Set((session.items || []).map(item => item.subject).filter(Boolean))];
  const wrong = [];
  const first = new Map();
  for (const answer of session.answers || []) if (!first.has(answer.itemId)) first.set(answer.itemId, answer);
  for (const [itemId, answer] of first) {
    if (fullyCorrect(answer)) continue;
    const item = (session.items || []).find(entry => entry.itemId === itemId);
    const topic = item?.topic || item?.subject;
    if (topic && !wrong.includes(topic)) wrong.push(clean(topic, 40));
  }
  let countdown = null;
  try {
    const today = dayInZone(now, 'Asia/Shanghai');
    const upcoming = (pact?.get?.()?.exams || []).filter(exam => exam?.date && daysUntil(today, exam.date) >= 0)
      .sort((a, b) => daysUntil(today, a.date) - daysUntil(today, b.date))[0];
    if (upcoming) countdown = {name: upcoming.name, days: daysUntil(today, upcoming.date)};
  } catch { countdown = null; }
  const streak = stats.streak || pact?.drillStreak?.({now}) || {};
  return {
    book: session.source || 'notes', subjects, stars: stats.stars ?? stats.answerStars ?? 0,
    accuracy: stats.accuracy || 0, minutes: Math.round((stats.ms || 0) / 60_000), maxCombo: stats.maxCombo || 0,
    wrongTopics: wrong.slice(0, 3), streak: streak.current || 0, firstFinishToday: Boolean(stats.firstFinishToday),
    jarFull: Boolean(session.jarFull || stats.jar?.filledNow), beijingHour: beijingHour(now), examCountdown: countdown,
    quiet: Boolean(session.quiet || stats.quiet),
  };
}

export function registerLearningDrill(api, store, options = {}) {
  const drill = new LearningDrill(store, options);
  store.drill = drill;
  const register = (name, handler) => api.registerGatewayMethod(`pinkie.learning.drill.${name}`, async ({params, respond}) => {
    try {
      const body = params || {};
      store.assertLearningSession(String(body.sessionKey || ''));
      respond(true, await handler(body));
    } catch (error) {
      respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)});
    }
  }, {scope: 'operator.admin'});
  register('session', params => drill.session(params));
  register('judge', params => drill.judge(params));
  register('explain', params => drill.explain(params));
  register('answer', params => drill.answer(params));
  register('learned', params => drill.learned(params));
  register('finish', params => drill.finish(params));
  register('cheer', params => drill.cheer(params));
  register('settings.get', () => drill.settings());
  register('settings.set', params => drill.setSettings(params));
  return drill;
}
