// 碧琪手账 v2 · 条目（briefs/study-desk-v2/PLAN.md §2、§3）：手账和聊天之间递东西的统一格式。
// 条目地址形如 point:c5.1、note:<id>、word:<id>、attempt:<id>；收进手账的每一笔都写一张回执，能撤销。
// 安全：没作答的题不在这里出现（attempt 只有已判分的作答）；碧琪拿到的上下文同样只有已作答的内容。
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const ALL = 'agent:learning:notes-library';
const DAY = 86_400_000;
const KINDS = new Set(['point', 'attempt', 'wrong', 'note', 'word', 'page', 'mat', 'plan', 'lesson', 'set']);
const TARGETS = {note: '笔记', word: '生词本', wrong: '错题', plan: '明天计划'};
const STATE_LABEL = {none: '还没学', learned: '学过', weak: '待复测', lit: '做对过', mastered: '独立掌握'};
export const DESK_REF_MARKER = /\[\[DESK_REF_V1((?:\s+[a-z]+:[^\s\]]{1,200}){1,8})\s*\]\]/g;
const clean = (value, limit = 500) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
const beijingDay = instant => new Date(Number(instant) + 8 * 3_600_000).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const isLearning = sessionKey => /^agent:learning:/.test(String(sessionKey || ''));

export function parseRef(value) {
  const m = /^([a-z]+):([^\s\]]{1,200})$/.exec(clean(value, 220));
  return m && KINDS.has(m[1]) ? {kind: m[1], id: m[2], ref: `${m[1]}:${m[2]}`} : null;
}
// 消息里的隐藏标记 → 条目列表（最多 8 个，去重）。
export function refsInText(text) {
  const refs = new Map();
  for (const match of String(text || '').matchAll(DESK_REF_MARKER)) for (const part of match[1].trim().split(/\s+/)) {
    const ref = parseRef(part); if (ref && refs.size < 8) refs.set(ref.ref, ref);
  }
  return [...refs.values()];
}
const origin = value => value && typeof value === 'object' ? {sessionKey: isLearning(value.sessionKey) ? clean(value.sessionKey, 300) : '',
  messageId: clean(value.messageId, 200), quote: clean(value.quote, 240), at: Number(value.at) || Date.now()} : null;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('手账记录暂时读不了，请稍后再试'); }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temp, file);
}

export class LearningRefs {
  constructor(store, {now = () => Date.now()} = {}) {
    this.store = store; this.now = now;
    this.root = path.join(store.root, 'desk');
    this.file = path.join(this.root, 'receipts.jsonl');
  }
  // ---------- 回执：只追加，撤销也记一行 ----------
  log() {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const receipts = new Map();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.type === 'receipt' && row.id) receipts.set(row.id, row);
      else if (row.type === 'undo' && receipts.has(row.id)) receipts.get(row.id).undoneAt = row.at;
    }
    return receipts;
  }
  append(row) {
    fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n', {mode: 0o600});
  }
  receipt(fields) {
    const row = {type: 'receipt', id: `r-${randomUUID()}`, at: this.now(), ...fields};
    this.append(row);
    return this.publicReceipt(row);
  }
  publicReceipt(row) {
    const undoable = !row.undoneAt && Boolean(row.undo) && (row.action !== 'regrade' || this.now() - row.at <= DAY);
    return {receiptId: row.id, at: row.at, by: row.by, action: row.action, target: row.target, targetLabel: TARGETS[row.target] || '', ref: row.ref || '',
      title: row.title || '', text: row.text || '', origin: row.origin || null, undone: Boolean(row.undoneAt), undoable,
      undoUntil: row.action === 'regrade' ? row.at + DAY : 0};
  }
  receipts({sessionKey = '', recent = false, id = ''} = {}) {
    const rows = [...this.log().values()];
    if (id) { const row = rows.find(item => item.id === id); if (!row) throw new Error('没有找到这张回执'); return {receipt: this.publicReceipt(row)}; }
    const list = recent ? rows.filter(row => this.now() - row.at <= 7 * DAY) : rows.filter(row => row.origin?.sessionKey === sessionKey || row.sessionKey === sessionKey);
    return {receipts: list.sort((a, b) => b.at - a.at).slice(0, recent ? 30 : 400).map(row => this.publicReceipt(row))};
  }
  undo({receiptId} = {}) {
    const row = this.log().get(clean(receiptId, 80));
    if (!row) throw new Error('没有找到这张回执');
    if (row.undoneAt) return {ok: true, already: true, receipt: this.publicReceipt(row)};
    if (!row.undo) throw new Error('这一笔不能撤销');
    if (row.action === 'regrade' && this.now() - row.at > DAY) throw new Error('判分更正只能在 24 小时内撤销');
    const u = row.undo;
    if (u.kind === 'note') { try { this.store.deleteNote(ALL, u.id); } catch (error) { if (!/没有找到|不存在|已经不在/.test(error.message)) throw error; } }
    else if (u.kind === 'words') { for (const id of u.ids || []) { try { this.store.vocab?.remove(id); } catch (error) { if (!/不在/.test(error.message)) throw error; } } }
    else if (u.kind === 'word') { try { this.store.vocab?.remove(u.id); } catch (error) { if (!/不在/.test(error.message)) throw error; } }
    else if (u.kind === 'memo') this.writeMemos(this.memos().filter(memo => memo.id !== u.id));
    else if (u.kind === 'regrade') this.store.correctAttempt(ALL, u.attemptId, {correct: u.previous, reason: '撤销碧琪的判分更正'});
    else if (u.kind === 'plan') this.restorePlan(u.previous);
    this.append({type: 'undo', id: row.id, at: this.now()});
    row.undoneAt = this.now();
    return {ok: true, receipt: this.publicReceipt(row)};
  }

  // ---------- 明天计划：便签（先生收的）与提议（碧琪提的，先生采纳才写进约定） ----------
  memos() { return readJson(path.join(this.root, 'memos.json'), {memos: []}).memos || []; }
  writeMemos(memos) { writeJson(path.join(this.root, 'memos.json'), {memos: memos.slice(-200)}); }
  memosFor(date) { return this.memos().filter(memo => memo.date === date); }
  proposals() { return readJson(path.join(this.root, 'proposals.json'), {plans: []}).plans || []; }
  writeProposals(plans) { writeJson(path.join(this.root, 'proposals.json'), {plans: plans.slice(-60)}); }
  validPlanItems(items) {
    const points = this.store.desk?.items?.() || [];
    const chapters = new Set(points.map(point => point.k));
    return (Array.isArray(items) ? items : []).slice(0, 8).flatMap(item => {
      if (item?.kind === 'learn' && points.some(point => point.k === item.k && point.i === item.i)) return [{kind: 'learn', k: item.k, i: item.i}];
      if (item?.kind === 'set' && chapters.has(item.chapter) && Number.isInteger(item.size) && item.size >= 1 && item.size <= 20) return [{kind: 'set', chapter: item.chapter, size: item.size}];
      return [];
    });
  }
  planLabel(item) {
    const points = this.store.desk?.items?.() || [];
    if (item.kind === 'learn') { const p = points.find(point => point.k === item.k && point.i === item.i); return `学 · ${p?.text || item.k}`; }
    const p = points.find(point => point.k === item.chapter); return `练 · ${p?.chapter || item.chapter} ${item.size} 题`;
  }
  propose({sessionKey, items, text} = {}) {
    const valid = this.validPlanItems(items);
    if (!valid.length) throw new Error('计划里没有能用的考点或练习：learn 要给 k 和 i，set 要给 chapter 和 size（1–20）');
    const plan = {id: `p-${randomUUID()}`, sessionKey: clean(sessionKey, 300), date: addDays(beijingDay(this.now()), 1), text: clean(text, 300),
      items: valid, labels: valid.map(item => this.planLabel(item)), createdAt: this.now(), adoptedAt: 0};
    this.writeProposals([...this.proposals(), plan]);
    return plan;
  }
  planGet({id} = {}) {
    const plan = this.proposals().find(item => item.id === clean(id, 80));
    if (!plan) throw new Error('这个计划已经不在了');
    const pact = this.store.pact?.get?.();
    return {plan: {...plan, adopted: pact?.tomorrowPlan?.id === plan.id}};
  }
  planAdopt({id, sessionKey} = {}) {
    const {plan} = this.planGet({id});
    if (plan.adopted) return {ok: true, already: true};
    const pact = this.store.pact; if (!pact) throw new Error('学习约定暂时不可用');
    const previous = pact.get().tomorrowPlan || null;
    pact.adoptTomorrowPlan({id: plan.id, date: plan.date, text: plan.text || plan.labels.join('；'), items: plan.items});
    this.writeProposals(this.proposals().map(item => item.id === plan.id ? {...item, adoptedAt: this.now()} : item));
    return {ok: true, receipt: this.receipt({by: 'user', action: 'adopt-plan', target: 'plan', sessionKey: clean(sessionKey, 300), ref: `plan:${plan.date}`,
      title: plan.labels.join('；').slice(0, 120), undo: {kind: 'plan', previous}})};
  }
  restorePlan(previous) {
    const pact = this.store.pact;
    if (previous) { pact.adoptTomorrowPlan(previous); return; }
    const file = pact.pactFile, raw = readJson(file, null);
    if (raw && raw.tomorrowPlan) { delete raw.tomorrowPlan; raw.updatedAt = this.now(); writeJson(file, raw); }
  }

  // ---------- 收进手账 ----------
  collect({sessionKey, target, text, ref = '', origin: from = null, title = '', by = 'user'} = {}) {
    sessionKey = clean(sessionKey, 300);
    if (!isLearning(sessionKey)) throw new Error('只能在学习模式里收进手账');
    if (!TARGETS[target]) throw new Error('只能收进笔记、生词本、错题或明天计划');
    if (String(text || '').length > 1_000_000) throw new Error('内容超过 100 万字，请分两次收进手账');
    const body = clean(text, target === 'note' || target === 'wrong' ? 1_000_000 : 4000), source = origin(from) || {sessionKey, messageId: '', quote: '', at: this.now()};
    const linked = ref ? parseRef(ref) : null;
    if (!body && !linked) throw new Error('要收的内容是空的');
    const who = by === 'biqi' ? 'biqi' : 'user';
    const base = {by: who, action: 'collect', target, sessionKey, origin: {...source, quote: source.quote || body.slice(0, 120)}};
    if (target === 'word') {
      if (!this.store.vocab) throw new Error('生词本暂时不可用');
      const result = this.store.vocab.add({text: body || linked?.id});
      const word = result.added?.[0];
      if (!word) return {ok: true, duplicate: true, receipt: this.receipt({...base, ref: '', title: (result.duplicates || [])[0] || body.slice(0, 40), text: '生词本里已经有了'})};
      return {ok: true, receipt: this.receipt({...base, ref: `word:${word.id}`, title: result.added.map(word => word.word).join('、'), undo: {kind: 'words', ids: result.added.map(word => word.id)}})};
    }
    if (target === 'plan') {
      const memo = {id: `m-${randomUUID()}`, date: addDays(beijingDay(this.now()), 1), text: body.slice(0, 300), origin: base.origin, by: who, at: this.now()};
      this.writeMemos([...this.memos(), memo]);
      return {ok: true, receipt: this.receipt({...base, ref: `plan:${memo.date}`, title: memo.text.slice(0, 60), undo: {kind: 'memo', id: memo.id}})};
    }
    // 笔记 / 错题：都落在笔记本里；错题带「错题」标签，挂上原作答。
    let content = body;
    if (linked?.kind === 'attempt' || linked?.kind === 'wrong') {
      try { const card = this.resolveOne(linked); content = [card.title, card.detail, body].filter(Boolean).join('\n\n'); } catch {}
    }
    const tags = ['收进手账', ...(target === 'wrong' ? ['错题'] : []), ...(who === 'biqi' ? ['碧琪收的'] : [])];
    const head = clean(title, 80) || content.split(/\r?\n/).find(Boolean)?.slice(0, 40) || '从对话里收的';
    const saved = this.store.saveNote(sessionKey, {title: target === 'wrong' ? `错题 · ${head}` : head, content, tags, sourceLabel: who === 'biqi' ? '碧琪从对话里收的' : '从对话里收的'});
    return {ok: true, receipt: this.receipt({...base, ref: `note:${saved.note.id}`, title: saved.note.title, undo: {kind: 'note', id: saved.note.id}})};
  }
  // 判分更正：会间接改掌握度，所以一律出回执，24 小时内能撤销。
  regrade({sessionKey, attemptId, correct, reason, by = 'biqi'} = {}) {
    const attempt = this.store.readAttempt(ALL, clean(attemptId, 120));
    if (typeof correct !== 'boolean') throw new Error('correct 要明确写 true 或 false');
    const previous = attempt.result?.correct;
    if (typeof previous !== 'boolean') throw new Error('这次作答还没判分');
    if (previous === correct) return {ok: true, unchanged: true};
    this.store.correctAttempt(ALL, attempt.id, {correct, reason: clean(reason, 600) || '碧琪更正判分'});
    try { // 记下是碧琪改的，而不是先生。
      const fresh = this.store.readAttempt(ALL, attempt.id), last = fresh.corrections?.at(-1);
      if (last) { last.actor = by === 'biqi' ? 'biqi' : 'user'; this.store.writeAttempt(fresh); }
    } catch {}
    return {ok: true, receipt: this.receipt({by, action: 'regrade', target: 'wrong', sessionKey: clean(sessionKey, 300), ref: `attempt:${attempt.id}`,
      title: `${clean(attempt.question?.question, 60)} → ${correct ? '改判为对' : '改判为错'}`, text: clean(reason, 200), undo: {kind: 'regrade', attemptId: attempt.id, previous}})};
  }

  // ---------- 解析：每个条目一张卡片数据 ----------
  latestOrigin(ref) {
    let found = null;
    for (const row of this.log().values()) if (row.ref === ref && !row.undoneAt && row.origin?.sessionKey && (!found || row.at > found.at)) found = row;
    return found?.origin || null;
  }
  resolveOne({kind, id, ref}) {
    const desk = this.store.desk;
    if (kind === 'point') {
      const [k, i] = [id.replace(/\.\d+$/, ''), Number(id.split('.').at(-1))];
      const point = desk?.items?.().find(item => item.k === k && item.i === i);
      if (!point) throw new Error('考点不存在');
      const e = point.evidence || {};
      return {ref, kind, title: point.text, subtitle: point.chapter, state: point.state,
        status: e.attempts ? `作答 ${e.attempts} 次，答对 ${e.correct} 次` : e.lessons ? `上过 ${e.lessons} 节课，还没练` : '还没学',
        detail: `考点 ${k}.${i}「${point.text}」（${point.chapter}）：${STATE_LABEL[point.state] || point.state}；作答 ${e.attempts || 0} 次，答对 ${e.correct || 0} 次，上课 ${e.lessons || 0} 次。`,
        open: {view: 'entry', params:{ref}}};
    }
    if (kind === 'attempt' || kind === 'wrong') {
      const a = this.store.readAttempt(ALL, id);
      if (typeof a.result?.correct !== 'boolean') throw new Error('这道题还没作答'); // 没作答的题不带出来，更不带答案
      const pub = this.store.publicAttempt(a);
      const q = clean(pub.question, 400);
      return {ref, kind, title: clean(q, 60), subtitle: [pub.topic, a.result.correct ? '答对' : '答错', pub.errorType].filter(Boolean).join(' · '),
        state: a.result.correct ? 'lit' : 'weak', status: a.result.correct ? '答对了' : pub.verifiedBy ? '复测已过' : '待复测',
        detail: `题目：${q}\n先生的答案：${clean(pub.answerText, 200)}（${a.result.correct ? '对' : '错'}${pub.errorType ? '，错因：' + pub.errorType : ''}）${a.result.explanation ? '\n讲解：' + clean(a.result.explanation, 600) : ''}`,
        open: {view: 'entry', params:{ref}}};
    }
    if (kind === 'note') {
      const note = this.store.readNotesState().notes.find(item => item.id === id && isLearning(item.sourceSessionKey));
      if (!note) throw new Error('这条笔记已经不在了');
      return {ref, kind, title: clean(note.title, 60), subtitle: (note.tags || []).slice(0, 3).join(' · '), status: note.nextReviewAt && note.nextReviewAt <= this.now() ? '今天该复习' : '',
        detail: `笔记「${clean(note.title, 80)}」：\n${clean(note.content, 1500)}`, open: {view: 'notes', params: {noteId: note.id}}};
    }
    if (kind === 'word') {
      const word = this.store.vocab?.read().words.find(item => item.id === id);
      if (!word) throw new Error('这个生词已经不在了');
      const meaning = word.meaning || word.hint || '';
      return {ref, kind, title: word.word, subtitle: meaning, status: word.reviewCount ? `复习过 ${word.reviewCount} 次` : '还没复习',
        detail: `生词 ${word.word}${word.phonetic ? ' ' + word.phonetic : ''}：${meaning}${word.example?.en ? '\n例句：' + word.example.en : ''}`, open: {view: 'vocab',params:{wordId:word.id,query:word.word}}};
    }
    if (kind === 'plan') {
      const plan = this.proposals().find(item => item.id === id) || (this.store.pact?.get?.().tomorrowPlan?.date === id ? this.store.pact.get().tomorrowPlan : null);
      const memos = /^\d{4}-\d{2}-\d{2}$/.test(id) ? this.memosFor(id) : [];
      if (!plan && !memos.length) throw new Error('这个计划已经不在了');
      const lines = [...(plan?.labels || (plan?.items || []).map(item => this.planLabel(item))), ...memos.map(memo => memo.text)];
      return {ref, kind, title: `${plan?.date || id} 的计划`, subtitle: lines.slice(0, 2).join('；'), detail: `计划：${lines.join('；')}`, open: {view: 'entry',params:{ref}}};
    }
    if (kind === 'lesson') {
      const lesson = this.store.lessons?.all?.().find(item => item.lessonId === id);
      if (!lesson) throw new Error('这节课已经不在了');
      return {ref, kind, title: lesson.point?.text || '一节课', subtitle: lesson.point?.subjectName || '', status: lesson.status === 'done' ? '上完了' : '还没讲完',
        detail: `一节课「${lesson.point?.text || ''}」，${lesson.status === 'done' ? '已上完' : '讲到第 ' + lesson.segment + ' 段'}。`, point:lesson.point, open: {view: 'entry',params:{ref}}};
    }
    if (kind === 'page' || kind === 'mat') {
      const [book, loc] = id.split(kind === 'page' ? '@' : '#');
      return {ref, kind, title: decodeURIComponent(book || '').slice(0, 60), subtitle: loc ? (kind === 'mat' ? loc.replace(/^p/, '第 ') + ' 页' : `位置 ${loc}`) : '',
        detail: `${kind === 'page' ? '书架' : '讲义'}里的一页：${decodeURIComponent(book || '')} ${loc || ''}`, bookId:book, location:loc, open: {view: 'entry',params:{ref}}};
    }
    if (kind === 'set') {
      if (!/^set-[a-f0-9-]{36}$/.test(id)) throw Error('练习组编号无效');
      const root=path.join(desk.root,'sets');let set=null;
      if(fs.existsSync(root)) for(const dir of fs.readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory())) { set=readJson(path.join(root,dir.name,id+'.json'),null);if(set)break; }
      if(!set || !isLearning(set.sessionKey))throw Error('这组练习已经不在了');
      return {ref,kind,title:set.title||'一组练习',subtitle:`${set.questions.length} 道题`,detail:`${set.title||'一组练习'}，共 ${set.questions.length} 道题。`,chapter:set.questions[0]?.k,open:{view:'entry',params:{ref}}};
    }
    throw new Error('不认识的条目');
  }
  resolve({refs, details = false} = {}) {
    const list = (Array.isArray(refs) ? refs : [refs]).slice(0, 40);
    return {cards: list.map(raw => {
      const ref = parseRef(raw);
      if (!ref) return {ref: clean(raw, 200), ok: false, error: '条目地址不对'};
      try { const card = this.resolveOne(ref); const {detail, ...shown} = card; return {...shown, ...(details ? {detail} : {}), ok: true, origin: this.latestOrigin(ref.ref)}; }
      catch (error) { return {ref: ref.ref, kind: ref.kind, ok: false, error: error.message}; }
    })};
  }
  // 发给模型前：消息里的条目标记换成真实上下文（数据，不是先生手抄的摘要）。
  context(prompt) {
    const refs = refsInText(prompt);
    if (!refs.length) return '';
    const lines = refs.map(ref => { try { return '- ' + this.resolveOne(ref).detail.replace(/\n/g, '\n  '); } catch (error) { return `- ${ref.ref}：${error.message}`; } });
    return `【先生从手账里带过来的条目】\n先生这条消息附了手账条目（消息里的 [[DESK_REF_V1 …]] 是界面标记，不要复述它）。下面是这些条目的真实记录，按它回答：\n${lines.join('\n')}`;
  }
}

// ---------- 碧琪的手账工具 ----------
function toolResult(value, isError = false) { return {content: [{type: 'text', text: JSON.stringify(value)}], details: value, isError}; }
export function createLearningDeskTool(refs, initialContext = {}) {
  let sessionKey = String(initialContext.sessionKey || '');
  return {
    name: 'learning_desk',
    label: '碧琪手账',
    description: '学习模式专用：把东西放进先生的备考手账，或在消息里贴一张手账卡片。'
      + ' open {ref}：在你的消息里放一张「翻到这页」卡片（ref 如 point:c5.1、note:<id>、word:<id>、attempt:<id>），先生自己点才会翻页。'
      + ' collect {target: note|word|wrong|plan, text, ref?}：替先生收进笔记 / 生词本 / 错题 / 明天计划，消息里会出现可撤销的回执卡；只在先生同意或明确要你记下时用。'
      + ' plan {items:[{kind:"learn",k,i}|{kind:"set",chapter,size}], text}：给明天提一个计划，先生点「采纳」才生效。'
      + ' regrade {attempt_id, correct, reason}：只在判分确实错了时更正一次作答，会出回执、24 小时内可撤销。'
      + ' 不能直接改掌握度：掌握度只来自先生自己的作答。',
    parameters: {type: 'object', additionalProperties: false, properties: {
      action: {type: 'string', enum: ['open', 'collect', 'plan', 'regrade']},
      ref: {type: 'string'}, target: {type: 'string', enum: ['note', 'word', 'wrong', 'plan']}, text: {type: 'string'}, title: {type: 'string'},
      items: {type: 'array', maxItems: 8, items: {type: 'object', properties: {kind: {type: 'string', enum: ['learn', 'set']}, k: {type: 'string'}, i: {type: 'integer'}, chapter: {type: 'string'}, size: {type: 'integer'}}, required: ['kind']}},
      attempt_id: {type: 'string'}, correct: {type: 'boolean'}, reason: {type: 'string'},
    }, required: ['action']},
    prepareBeforeToolCallParams(params, meta = {}) {
      sessionKey = String(meta.hookContext?.sessionKey || meta.sessionKey || sessionKey || '');
      return params;
    },
    async execute(_id, params = {}) {
      try {
        if (!isLearning(sessionKey)) throw new Error('手账工具只在学习模式里能用');
        const inline = (kind, id, title) => ({v: 1, kind, id, sessionKey, title: clean(title, 160), revision: 0});
        if (params.action === 'open') {
          const ref = parseRef(params.ref); if (!ref) throw new Error('ref 格式不对，例如 point:c5.1');
          const card = refs.resolveOne(ref);
          return toolResult({ok: true, inline: inline('desk_card', ref.ref, card.title), card: {title: card.title, subtitle: card.subtitle, status: card.status},
            note: '卡片已放进消息，先生点「翻到这页」才会打开。'});
        }
        if (params.action === 'collect') {
          const result = refs.collect({sessionKey, target: params.target, text: params.text, ref: params.ref, title: params.title, by: 'biqi'});
          return toolResult({ok: true, inline: inline('desk_receipt', result.receipt.receiptId, result.receipt.title), receipt: result.receipt,
            note: result.duplicate ? '生词本里已经有这个词，没有重复收。' : '已收进手账，消息里有回执卡，先生可以撤销。'});
        }
        if (params.action === 'plan') {
          const plan = refs.propose({sessionKey, items: params.items, text: params.text});
          return toolResult({ok: true, inline: inline('desk_plan', plan.id, plan.labels.join('；')), plan: {date: plan.date, items: plan.labels}, note: '计划卡已放进消息，先生点「采纳」才写进明天的约定。'});
        }
        if (params.action === 'regrade') {
          const result = refs.regrade({sessionKey, attemptId: params.attempt_id, correct: params.correct, reason: params.reason, by: 'biqi'});
          if (result.unchanged) return toolResult({ok: true, unchanged: true, note: '判分本来就是这样，没有改。'});
          return toolResult({ok: true, inline: inline('desk_receipt', result.receipt.receiptId, result.receipt.title), receipt: result.receipt, note: '已更正判分，回执卡 24 小时内可撤销。'});
        }
        throw new Error('action 只能是 open、collect、plan、regrade');
      } catch (error) { return toolResult({ok: false, error: error.message}, true); }
    },
  };
}

function register(api, name, handler, scope = 'operator.admin') {
  api.registerGatewayMethod(name, async ({params, respond}) => {
    try { respond(true, await handler(params || {})); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)}); }
  }, {scope});
}

export function registerLearningRefs(api, store, options = {}) {
  const refs = new LearningRefs(store, options);
  register(api, 'pinkie.learning.ref.resolve', params => refs.resolve(params), 'operator.read');
  register(api, 'pinkie.learning.ref.collect', params => refs.collect({...params, by: 'user'}));
  register(api, 'pinkie.learning.ref.undo', params => refs.undo(params));
  register(api, 'pinkie.learning.ref.receipts', params => refs.receipts(params), 'operator.read');
  register(api, 'pinkie.learning.ref.memos', params => ({memos: refs.memosFor(/^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date : beijingDay(Date.now()))}), 'operator.read');
  register(api, 'pinkie.learning.ref.plan.get', params => refs.planGet(params), 'operator.read');
  register(api, 'pinkie.learning.ref.plan.adopt', params => refs.planAdopt(params));
  api.registerTool?.(ctx => (String(ctx?.sessionKey || '').startsWith('agent:learning:desk-chat:') ? createLearningDeskTool(refs, ctx) : null), {name: 'learning_desk'});
  // 带着条目来问：后端把条目换成真实记录，模型拿到的是数据。只在学习模式、只在消息带了标记时加。
  api.on?.('before_prompt_build', (event, ctx) => {
    if (!isLearning(ctx?.sessionKey)) return undefined;
    try {
      const fresh=String(ctx.sessionKey).startsWith('agent:learning:desk-chat:') ? '【学习台独立对话】\n这是学习台自己的对话环境，普通学习聊天的记录没有带入。不要沿用外面正在做的题目、套数或轮次；以本会话和先生主动带来的条目为准。\n' : '';
      const text = fresh + refs.context(event?.prompt || ''); return text ? {prependContext: text} : undefined;
    }
    catch { return undefined; }
  }, {priority: -11500});
  return refs;
}
