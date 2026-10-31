// Recall questions are derived data. Never replace or split the user's source note in place.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const clean = (value, limit = 12000) => String(value ?? '').trim().slice(0, limit);
export const recallSource = note => [note.content, note.meaning, note.example, note.note].filter(Boolean).join('\n');
export const recallHash = note => hash(recallSource(note));
export function splitRecallSource(text, size = 12000) {
  const chunks = []; let rest = String(text);
  while (rest.length > size) {
    const candidate = rest.slice(0, size), boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('。'), candidate.lastIndexOf('. '));
    const end = boundary > size / 2 ? boundary + 1 : size;
    chunks.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  if (rest) chunks.push(rest);
  return chunks;
}
const comparable = text => clean(text).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const active = note => !['moved', 'merged'].includes(note.status);
export const RECALL_RULES = `你是碧琪的笔记回忆卡整理助手。先生习惯把整段对话、例句、解释连同答案全部复制进笔记。
把每条原笔记拆成若干独立知识点，并为每个知识点写真正可以回忆的问题和答案。长笔记要覆盖所有独立知识点；不要把全文当成一个标题，也不要因为长度或费用省略知识点。
只输出 JSON：{"notes":[{"id":"原笔记id","cards":[{"question":"只含问题的正面","answer":"翻面后才显示的完整答案","quote":"原笔记里逐字相同的一段依据"}]}]}。
问题必须能独立理解，明确要求回忆什么，但绝不能把所求答案写在正面。不要把答案换个排版再问“是什么意思”。
例如原文 avoid making mistakes（避免犯错），可问“‘避免犯错’用英语怎么说？”，答案才写 avoid making mistakes；或者问“avoid 后面的动词用什么形式？”，答案写动名词 -ing 并保留例句。
原文“指针变量存另一个变量的地址”，问“C 语言中指针变量保存什么？”，答案“另一个变量的地址”。
已有问题和答案一起粘贴时，问题只保留题干，移走“答案、解析、所以、应选”等给出结论的部分。选择题的正确选项、翻译题的译文、填空题的填空值必须只放答案面。
一条卡只问一个清晰的知识点；答案忠于原文，保留必要的例句、条件、易错点。不能补写原文没有的事实。quote 必须是原文的连续子串，不得改写。相近知识点可以合并，重复的不要出两次。question 不超过 500 字，answer 不超过 4000 字，quote 不超过 4000 字。`;

export function validateRecallCards(result, batch) {
  if (!Array.isArray(result?.notes)) throw Error('模型没有返回笔记问答，原文已保留');
  const input = new Map(batch.map(note => [note.id, note])), output = new Map();
  for (const item of result.notes) {
    const note = input.get(item?.id); if (!note || output.has(note.id) || !Array.isArray(item.cards)) continue;
    const text = recallSource(note), source = comparable(text), seen = new Set(), cards = [];
    for (const raw of item.cards.slice(0, 100)) {
      const question = clean(raw.question, 600), answer = clean(raw.answer, 5000), quote = clean(raw.quote, 4500);
      const q = comparable(question), a = comparable(answer);
      if (!q || !a || !quote || !text.includes(quote) || question.length > 500 || answer.length > 4000) continue;
      if (!/[?？]|怎么|什么|为何|为什么|如何|哪|请|写出|说出|翻译|补全|填入|判断/.test(question)) continue;
      // Reject copied answer fronts and the obvious answer-inside-question failure.
      if (q === a || q === source || a.length >= 4 && q.includes(a)) continue;
      if (/^(?:答案|答[:：]|解析[:：])/.test(question) || /(?:答案是|正确答案|应选|正确选项是)/.test(question)) continue;
      if (seen.has(q)) continue; seen.add(q);
      cards.push({id: hash(note.id + '/' + recallHash(note) + '/' + q).slice(0, 24), question, answer, quote});
    }
    if (cards.length) output.set(note.id, cards);
  }
  return output;
}

export class LearningRecall {
  constructor(store, {organizer, schedule, recordReview = () => {}} = {}) {
    this.store = store; this.organizer = organizer; this.schedule = schedule; this.recordReview = recordReview;
    this.file = path.join(store.root, 'notes-recall.json'); this.requested = new Set(); this.running = null;
  }
  read() { try { const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); return {...data, records: data.records || {}, days: data.days || {}}; } catch { return {v: 1, records: {}, days: {}}; } }
  write(data) {
    fs.mkdirSync(path.dirname(this.file), {recursive: true}); const temp = this.file + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({...data, v: 1}, null, 2), {mode: 0o600}); fs.renameSync(temp, this.file);
  }
  notes(sessionKey) { this.store.assertLearningSession(sessionKey); return this.store.notesForSession(sessionKey).filter(active); }
  modelStatus(sessionKey) {
    // Automatic card generation uses the same built-in learning model as vocabulary.
    const catalog = this.organizer?.catalog?.();
    return catalog?.defaultRef ? {available:true,model:catalog.defaultRef} : this.organizer?.status?.(sessionKey);
  }
  stateFor(note, data = this.read()) { const record = data.records[note.id]; return record?.hash === recallHash(note) ? record : null; }
  enqueue(sessionKey, {ids, force = false} = {}) {
    const wanted = Array.isArray(ids) ? new Set(ids) : null, data = this.read();
    const available = Boolean(this.modelStatus(sessionKey)?.available && this.organizer?.requestModel);
    let queued = 0;
    for (const note of this.notes(sessionKey)) {
      if (wanted && !wanted.has(note.id)) continue;
      const record = this.stateFor(note, data);
      if (!force && (record?.status === 'ready' || record?.status === 'failed' || record?.status === 'running' && this.running)) continue;
      if (this.requested.has(note.id)) continue;
      if (!available) continue;
      data.records[note.id] = {hash: recallHash(note), status: 'queued', cards: [], startedAt: Date.now()};
      this.requested.add(note.id); queued++;
    }
    if (queued) { this.write(data); this.start(sessionKey); }
    return {queued, running: Boolean(this.running), available};
  }
  start(sessionKey) {
    if (this.running) return;
    this.running = Promise.resolve().then(async () => {
      while (this.requested.size) {
        // Small source groups keep each complete pasted note in one model context.
        const ids = [...this.requested].slice(0, 4); ids.forEach(id => this.requested.delete(id));
        const batch = this.notes(sessionKey).filter(note => ids.includes(note.id)); if (!batch.length) continue;
        const before = this.read();
        for (const note of batch) before.records[note.id] = {...before.records[note.id], hash: recallHash(note), status: 'running', startedAt: Date.now()};
        this.write(before);
        try {
          const status = this.modelStatus(sessionKey);
          const parts = batch.flatMap(note => { const texts = splitRecallSource(recallSource(note)); return texts.map((text, i) => ({id: note.id + '__part_' + i, sourceNoteId: note.id, part: i + 1, parts: texts.length, content: text})); });
          const accepted = new Map(), invalid = new Set();
          for (let offset = 0; offset < parts.length; offset += 4) {
            const group = parts.slice(offset, offset + 4), input = group.map(part => ({id: part.id, sourceNoteId: part.sourceNoteId, part: part.part, parts: part.parts, text: part.content}));
            const result = await this.organizer.requestModel(status.model, RECALL_RULES, input, true, {userText: JSON.stringify({notes: input}), maxTokens: 16000, timeoutMs: this.organizer.deepTimeoutMs || 120000});
            const cards = validateRecallCards(result, group);
            for (const part of group) {
              if (!cards.has(part.id)) { invalid.add(part.sourceNoteId); continue; }
              const target = accepted.get(part.sourceNoteId) || [];
              for (const card of cards.get(part.id)) target.push({...card, id: hash(part.sourceNoteId + '/' + comparable(card.question) + '/' + comparable(card.answer)).slice(0, 24)});
              accepted.set(part.sourceNoteId, target);
            }
          }
          const live = new Map(this.notes(sessionKey).map(note => [note.id, note])), data = this.read();
          for (const note of batch) {
            if (!live.has(note.id) || recallHash(live.get(note.id)) !== recallHash(note)) continue;
            const cards = invalid.has(note.id) ? [] : [...new Map((accepted.get(note.id) || []).map(card => [card.id, card])).values()];
            data.records[note.id] = {hash: recallHash(note), status: cards?.length ? 'ready' : 'failed', cards: cards || [], model: status.modelName || status.model, at: Date.now(), ...(cards?.length ? {} : {error: '模型给出的提问包含答案或缺少原文依据，请点重新拆分'})};
          }
          this.write(data);
        } catch (error) {
          const data = this.read();
          for (const note of batch) if (data.records[note.id]?.hash === recallHash(note)) data.records[note.id] = {...data.records[note.id], status: 'failed', error: clean(error.message, 300), cards: []};
          this.write(data);
          if (/请求失败（(?:401|403|404|429|5\d\d)）|fetch failed|timed?\s*out/i.test(error.message || '')) {
            const pending = this.read();
            for (const id of this.requested) if (pending.records[id]?.status === 'queued') pending.records[id] = {...pending.records[id], status:'failed', error:clean(error.message,300)};
            this.requested.clear(); this.write(pending);
          }
        }
      }
    }).finally(() => { this.running = null; });
  }
  async queue(sessionKey, {limit = 10, dailyLimit = 10, now = Date.now(), generate = true, wait = false, force = false} = {}) {
    const notes = this.notes(sessionKey);
    if (generate) this.enqueue(sessionKey, {ids: notes.filter(note => !note.nextReviewAt || note.nextReviewAt <= now).slice(0, 20).map(note => note.id), force});
    if (wait && this.running) await this.running;
    return this.snapshot(sessionKey, {limit, dailyLimit, now});
  }
  snapshot(sessionKey, {limit = 10, dailyLimit = 10, now = Date.now()} = {}) {
    const data = this.read(), notes = this.notes(sessionKey), cards = [], problems = [];
    let pending = 0, missing = 0;
    for (const note of notes) {
      const record = this.stateFor(note, data);
      if (!record || record.status !== 'ready') {
        if (['queued', 'running'].includes(record?.status)) pending++; else missing++;
        if (record?.status === 'failed') problems.push({id: note.id, error: record.error});
        continue;
      }
      for (const card of record.cards) {
        if (card.nextReviewAt && card.nextReviewAt > now) continue;
        cards.push({...note, recallId: card.id, cue: card.question, recallQuestion: card.question, recallAnswer: card.answer, recallQuote: card.quote,
          nextReviewAt: card.nextReviewAt || note.nextReviewAt || 0, lapses: card.lapses || 0});
      }
    }
    cards.sort((a, b) => a.nextReviewAt - b.nextReviewAt || b.lapses - a.lapses);
    const day = this.store.noteDay(now), old = this.store.readNotesState(), done = new Set([...(old.noteReviewDays?.[day] || []), ...(data.days[day] || [])]);
    const cap = Math.max(0, Math.min(500, Number(dailyLimit) || 0)), remaining = Math.max(0, cap - done.size), count = Math.min(cards.length, remaining);
    return {notes: cards.slice(0, Math.min(Number(limit) || 10, count)), dueCount: cards.length, todayCount: count, dailyLimit: cap, completedToday: done.size, dailyRemaining: remaining,
      backlog: Math.max(0, cards.length - count), pending, missing, problems, remainingCount: Math.max(0, cards.length - count)};
  }
  review(sessionKey, {id, recallId, rating, now = Date.now()} = {}) {
    const note = this.notes(sessionKey).find(note => note.id === id); if (!note) throw Error('没有找到这条笔记');
    const data = this.read(), record = this.stateFor(note, data), card = record?.cards?.find(card => card.id === recallId);
    if (!card || record.status !== 'ready') throw Error('这张回忆卡已更新，请重新打开回顾');
    if (card.nextReviewAt > now && this.store.noteDay(card.lastReviewedAt) === this.store.noteDay(now)) return {ok: true, duplicate: true, note: {...note, recallId}};
    Object.assign(card, this.schedule(card, rating, now));
    const day = this.store.noteDay(now); data.days[day] = [...new Set([...(data.days[day] || []), card.id])];
    for (const old of Object.keys(data.days).sort().slice(0, -32)) delete data.days[old];
    this.write(data); this.recordReview();
    return {ok: true, note: {...note, ...card, recallId: card.id}};
  }
}

export function registerLearningRecall(api, store, options) {
  const recall = new LearningRecall(store, options); store.recall = recall;
  const register = (name, handler) => api.registerGatewayMethod('pinkie.learning.notes.recall.' + name, async ({params, respond}) => {
    try { const p = params || {}, key = String(p.sessionKey || ''); store.assertLearningSession(key); respond(true, await handler(key, p)); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error.message}); }
  }, {scope: 'operator.admin'});
  register('prepare', (key, p) => recall.enqueue(key, p));
  register('queue', (key, p) => recall.queue(key, p));
  register('review', (key, p) => recall.review(key, p));
  return recall;
}
