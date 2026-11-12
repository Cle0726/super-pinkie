// 碧琪上岸记：游戏后端（钱包、奖励账本、awards 队列、学习事件钩子、形态、商店、扭蛋、心愿单、委托）。
// 规矩（PLAN §12）：北京时间；奖励全部由确定性代码在后端发，同一事件只发一次（eventId），同一请求只执行一次（requestId）；
// 只写 store.root/game/；游戏层出任何错都不能影响学习功能（钩子调用方都包 try/catch）。
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dayInZone} from './learning-pact.mjs';
import * as E from './learning-game-economy.mjs';
import {GameMonsters} from './learning-game-monsters.mjs';
import {GameWorld} from './learning-game-world.mjs';
import {GameExam} from './learning-game-exam.mjs';
import {GameContent} from './learning-game-content.mjs';
import {GamePractice} from './learning-game-bank.mjs';

const TZ = 'Asia/Shanghai';
const DAY = 86400000;
export const GAME_EXAM = 'pretco-b';
export const EXAM_DATES = {'pretco-b': '2026-12-13', cet4: '2027-06-12', zsb: '2028-04-22'};
// 第一季节气窗口（北京日期，含首尾）。第二季起改由 learning-almanac 算。
export const SEASON_TERMS = [
  {term: 'lidong', name: '立冬', from: '2026-11-07', to: '2026-11-21'},
  {term: 'xiaoxue', name: '小雪', from: '2026-11-22', to: '2026-12-06'},
  {term: 'daxue', name: '大雪', from: '2026-12-07', to: '2026-12-20'},
  {term: 'dongzhi', name: '冬至', from: '2026-12-21', to: '2027-01-04'},
];

export const beijingDate = now => dayInZone(now, TZ);
export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}
export function mondayOf(date) {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}
export function seasonOn(date) {
  return SEASON_TERMS.find(t => date >= t.from && date <= t.to) || null;
}
export function isQuiet(date, exam = GAME_EXAM, economy = E.loadEconomy()) {
  const examDate = EXAM_DATES[exam];
  const left = daysBetween(date, examDate);
  return left >= 0 && left <= economy.quiet.daysBefore;
}

const clean = (v, n = 200) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
function fail(message) { throw new Error(message); }

function emptyState() {
  return {
    v: 1,
    wallet: {stars: 0, seals: 0, shards: {any: 0}},
    lifetime: {stars: 0, seals: 0, shards: 0},
    ledger: {},
    pending: [],
    requests: {},
    forms: {equipped: 'daily', owned: ['daily'], xp: {}, awakened: []},
    items: {owned: [], equipped: {}},
    gacha: {star: {sr: 0, ssr: 0, tens: 0, pulls: 0, ssrHits: 0}, seal: {sr: 0, ssr: 0, tens: 0, pulls: 0, ssrHits: 0}},
    wishlist: null,
    stats: {setsDone: 0, perfectSets: 0, writePerfectSets: 0, maxCombo: 0, combo20Sets: 0, ults: 0, crits: 0,
      huntWins: 0, captures: 0, capturesEvolved2: 0, questsDone: 0, dailyQuests: 0, lessons: 0, notesDrilled: 0,
      guardPerfect: 0, examBest: 0, examsSafe: 0, nodesLit: 0, regionsLit: 0, gold: 0, streak: 0, realPass: 0, allGold: 0, realCorrect: 0},
    days: {},
    cardDays: {},
    drill: {},
    quests: {},
    examSeals: {},
    monsters: {list: {}, captured: 0},
    lines: {},
  };
}

export class LearningGame {
  constructor(store, {now = () => Date.now(), requestModel = null, economy = E.loadEconomy(), catalog = E.loadForms(), autoReal = true} = {}) {
    this.autoReal = autoReal;
    this.store = store;
    this.now = now;
    this.requestModel = requestModel;
    this.economy = economy;
    this.catalog = catalog;
    this.root = path.join(store.root, 'game');
    this.file = path.join(this.root, 'game.json');
    this.backup = path.join(this.root, 'game.bak.json');
    this.modules = {};
    new GameMonsters(this);
    new GameWorld(this);
    new GameExam(this);
    new GameContent(this);
    new GamePractice(this);
  }

  // ---------- 存储：严格读，坏了用上一份好的，绝不静默清零 ----------
  readRaw(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return error?.code === 'ENOENT' ? null : undefined; }
  }
  read() {
    const main = this.readRaw(this.file);
    if (main && typeof main === 'object' && main.v === 1 && main.wallet) return this.normalize(main);
    if (main === undefined || (main && !main.wallet)) {
      try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch {}
    }
    const bak = this.readRaw(this.backup);
    if (bak && typeof bak === 'object' && bak.v === 1 && bak.wallet) return this.normalize(bak);
    return emptyState();
  }
  normalize(state) {
    const base = emptyState();
    for (const key of Object.keys(base)) if (state[key] == null || typeof state[key] !== typeof base[key]) state[key] = base[key];
    state.stats = {...base.stats, ...state.stats};
    state.wallet.shards ||= {any: 0};
    for (const k of ['stars', 'seals']) state.wallet[k] = Math.max(0, Math.floor(Number(state.wallet[k]) || 0));
    if (!state.forms.owned.includes('daily')) state.forms.owned.unshift('daily');
    this.migrateFormsV2(state);
    this.migrateFormsV3(state);
    return state;
  }
  // 形态 v2（11-09）：旧的换装 / 贴纸形态退场。已拥有的换成最接近的新形态（亲密度带过去）；没有对应的按原价退星星 / 金印。
  // 只在还拥有退场形态时动；换完写进 forms.v2note，营地提示一次。成就专属（毕业、金章）不动。
  migrateFormsV2(state) {
    const byId = new Map(this.catalog.forms.map(f => [f.id, f]));
    const MAP = {thinking: 'crystal', princess: 'alicorn', queen: 'alicorn', detective: 'serious', zhuangyuan: 'kirin', 'dragon-rider': 'kirin', astrologer: 'batpony'};
    const KEEP = new Set(['graduate', 'gold-master']);
    const old = state.forms.owned.filter(id => byId.get(id)?.retired && !KEEP.has(id));
    if (!old.length) return;
    const note = state.forms.v2note && !state.forms.v2note.seen ? state.forms.v2note : {converted: [], refund: {stars: 0, seals: 0}};
    for (const id of old) {
      const to = MAP[id];
      state.forms.owned = state.forms.owned.filter(x => x !== id);
      if (to && !state.forms.owned.includes(to)) {
        state.forms.owned.push(to);
        state.forms.xp[to] = Math.max(state.forms.xp[to] || 0, state.forms.xp[id] || 0);
        note.converted.push([id, to]);
      } else {
        const price = E.formPrice(byId.get(id), this.economy) || {};
        state.wallet.stars += price.stars || 0; state.wallet.seals += price.seals || 0;
        note.refund.stars += price.stars || 0; note.refund.seals += price.seals || 0;
      }
      if (state.forms.equipped === id) state.forms.equipped = to && state.forms.owned.includes(to) ? to : 'daily';
    }
    if (byId.get(state.forms.equipped)?.retired && !KEEP.has(state.forms.equipped)) state.forms.equipped = 'daily';
    state.forms.v2note = {...note, at: note.at || new Date().toISOString(), seen: false};
  }
  // 形态 v3（REDO-1109）：立冬、名侦探按新画风回归。v2 时被「名侦探 → 较真」换掉的，较真留着、名侦探还回来；买过立冬的也还回来（v2 退的星星不收回）。
  // 只做一次（forms.v3done），还了东西就写 forms.v3note，营地提示一次。
  migrateFormsV3(state) {
    if (state.forms.v3done) return;
    const had = new Set();
    for (const [from] of state.forms.v2note?.converted || []) if (from === 'detective') had.add('detective');
    for (const id of ['detective', 'lidong']) if (state.forms.xp?.[id] != null) had.add(id);
    for (const r of Object.values(state.requests || {})) for (const a of r?.result?.awards || []) if (a?.kind === 'form' && ['detective', 'lidong'].includes(a.itemId)) had.add(a.itemId);
    const returned = [...had].filter(id => !state.forms.owned.includes(id) && this.catalog.forms.some(f => f.id === id && !f.retired));
    for (const id of returned) state.forms.owned.push(id);
    state.forms.v3done = true;
    if (returned.length) state.forms.v3note = {returned, at: new Date().toISOString(), seen: false};
  }
  write(state) {
    fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
    if (fs.existsSync(this.file)) {
      try { fs.copyFileSync(this.file, this.backup); } catch {}
    }
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, {encoding: 'utf8', mode: 0o600});
    fs.renameSync(tmp, this.file);
  }
  // 同步的读-改-写：同一进程里不会被别的请求插进来（双击购买、两个窗口同时扭蛋都是串行的）。
  mutate(fn) {
    const state = this.read();
    const result = fn(state);
    this.prune(state);
    this.write(state);
    return result;
  }
  prune(state) {
    const keys = Object.keys(state.requests);
    if (keys.length > 2000) for (const k of keys.sort((a, b) => state.requests[a].at - state.requests[b].at).slice(0, keys.length - 1500)) delete state.requests[k];
    const sids = Object.keys(state.drill);
    if (sids.length > 300) for (const k of sids.sort((a, b) => (state.drill[a].at || 0) - (state.drill[b].at || 0)).slice(0, sids.length - 200)) delete state.drill[k];
    const cut = addDays(this.today(), -60);
    for (const k of Object.keys(state.cardDays)) if (state.cardDays[k] < cut) delete state.cardDays[k];
  }
  // requestId 幂等：同一 requestId 返回第一次的结果（失败不记，可以重试）。
  once(method, requestId, fn) {
    const id = clean(requestId, 120);
    if (!id) fail('缺少 requestId');
    const key = `${method}:${id}`;
    const seen = this.read().requests[key];
    if (seen) return seen.result;
    return this.mutate(state => {
      if (state.requests[key]) return state.requests[key].result;
      const result = fn(state);
      state.requests[key] = {at: this.now(), result};
      return result;
    });
  }

  today() { return beijingDate(this.now()); }
  form(state, id = state.forms.equipped) { return E.formById(id, this.catalog); }
  day(state, date = this.today()) {
    state.days[date] ||= {sets: 0, answers: 0, correct: 0, huntWins: 0, captures: 0, lessons: 0, newCards: 0, dueCards: 0, notes: 0, words: 0, chests: 0};
    const keys = Object.keys(state.days);
    if (keys.length > 60) for (const k of keys.sort().slice(0, keys.length - 45)) delete state.days[k];
    return state.days[date];
  }

  // ---------- 发奖：唯一入口 ----------
  // awards: [{kind, amount?, itemId?, reason, fx?}]；eventId 已发过就什么都不做，返回 []。
  grant(state, eventId, source, awards) {
    if (!eventId) fail('奖励缺少 eventId');
    if (state.ledger[eventId]) return [];
    const out = [];
    const ups = [];
    const at = this.now();
    for (const a of awards) {
      if (!a) continue;
      const amount = a.amount == null ? undefined : Math.max(0, Math.floor(a.amount));
      if (amount === 0 && ['stars', 'seals', 'shards'].includes(a.kind)) continue;
      const award = {id: `aw-${randomUUID()}`, at, kind: a.kind, ...(amount != null ? {amount} : {}), ...(a.itemId ? {itemId: a.itemId} : {}),
        reason: clean(a.reason, 80), source: {type: source.type, id: clean(source.id, 120)}, fx: a.fx || fxFor(a)};
      if (a.kind === 'stars') { state.wallet.stars += amount; state.lifetime.stars += amount; this.addXp(state, amount, ups, at, source); }
      if (a.kind === 'seals') { state.wallet.seals += amount; state.lifetime.seals += amount; }
      if (a.kind === 'shards') {
        const to = a.itemId || 'any';
        state.wallet.shards[to] = (state.wallet.shards[to] || 0) + amount;
        state.lifetime.shards += amount;
      }
      if (a.kind === 'form' && a.itemId && !state.forms.owned.includes(a.itemId)) state.forms.owned.push(a.itemId);
      if (a.kind === 'item' && a.itemId && !state.items.owned.includes(a.itemId)) state.items.owned.push(a.itemId);
      out.push(award);
    }
    out.push(...ups);
    state.ledger[eventId] = {at, ids: out.map(a => a.id)};
    state.pending.push(...out);
    if (state.pending.length > 300) state.pending = state.pending.slice(-300);
    return out;
  }
  addXp(state, stars, out, at, source) {
    const id = state.forms.equipped;
    const before = E.affinityLevel(state.forms.xp[id] || 0, this.economy).lv;
    state.forms.xp[id] = (state.forms.xp[id] || 0) + stars;
    const after = E.affinityLevel(state.forms.xp[id], this.economy).lv;
    if (after > before) {
      const form = this.form(state, id);
      out.push({id: `aw-${randomUUID()}`, at, kind: 'levelup', itemId: id, amount: after, reason: `${form?.name || '碧琪'}亲密度 Lv${after}`, source: {type: source.type, id: source.id}, fx: after >= 5 ? 'big' : 'medium'});
    }
  }

  // ---------- 学习事件钩子（被 learning-drill / learning-pact 调用；调用方包 try/catch） ----------
  onDrillSession(session, pool = []) {
    if (!session?.sessionId) return;
    const now = this.now();
    this.mutate(state => {
      const eligible = {};
      for (const card of pool) if (card?.key) eligible[card.key] = E.cardEligible(card, now);
      state.drill[session.sessionId] = {at: now, source: session.source, eligible, combo: 0, maxCombo: 0, seen: [], ults: 0, writeAll: true};
      const nodeId = session.scope?.nodeId;
      if (nodeId) { state.nodeSessions ||= {}; state.nodeSessions[session.sessionId] = {nodeId: String(nodeId).slice(0, 80), at: now}; }
    });
  }

  onDrillAnswer({session, item, correct = false, firstTry = true, verdict = null, fresh = false, refs = []} = {}) {
    if (!session?.sessionId || !item?.itemId) return [];
    const sid = session.sessionId;
    const answerIndex = (session.answers || []).length;
    return this.mutate(state => {
      const run = state.drill[sid] ||= {at: this.now(), source: session.source, eligible: {}, combo: 0, maxCombo: 0, seen: [], ults: 0, writeAll: true};
      const form = this.form(state);
      const date = this.today();
      const ok = correct === true && verdict !== 'wrong' && verdict !== 'partial';
      const awards = [];
      const mode = item.mode;
      const write = E.isWriteMode(mode);
      if (!ok && write) run.writeAll = false;
      if (mode === 'look' || mode === 'meet') return [];
      // 单题星：本组第一次作答、首次就对、卡片有资格（到期 / 新 / 弱 / 变体）、这张卡今天没给过
      const keys = refs.map(r => r.key);
      const isHunt = item.cardRef?.book === 'hunt';
      const allowed = fresh && firstTry !== false && keys.length > 0 && keys.every(k => isHunt || run.eligible[k] !== false) && keys.every(k => state.cardDays[k] !== date);
      if (ok && allowed) {
        const s = E.answerStars({eligible: true, correct: true, firstTry: true, write, book: item.cardRef?.book || 'notes', form, economy: this.economy});
        if (s.value) awards.push({kind: 'stars', amount: s.value, reason: isHunt ? '讨伐命中' : '答对了', fx: 'small'});
        for (const k of keys) state.cardDays[k] = date;
        const d = this.day(state, date);
        d.correct += 1;
        if (item.cardRef?.book === 'notes') { d.notes += 1; state.stats.notesDrilled += 1; }
        if (item.cardRef?.book === 'vocab') d.words += 1;
      }
      if (fresh) this.day(state, date).answers += 1;
      // 连击：同一题在本组只算一次（重放同一 RPC 不涨连击）
      if (ok) {
        if (!run.seen.includes(item.itemId)) {
          run.seen.push(item.itemId);
          run.combo += 1;
          run.maxCombo = Math.max(run.maxCombo, run.combo);
          state.stats.maxCombo = Math.max(state.stats.maxCombo, run.combo);
          const c = E.comboStars(run.combo, {form, economy: this.economy});
          if (c.stars) awards.push({kind: 'stars', amount: c.stars, reason: c.ult ? `连击 ${run.combo} · 碧琪大招` : `连击 ${run.combo}`, fx: c.ult ? 'cinematic' : 'medium'});
          if (c.ult) { run.ults += 1; state.stats.ults += 1; const dd = this.day(state); dd.ults = (dd.ults || 0) + 1; }
        }
      } else {
        run.combo = 0;
      }
      const result = this.grant(state, `drill:${sid}:${item.itemId}:${answerIndex}`, {type: isHunt ? 'hunt' : 'drill', id: sid}, awards);
      if (isHunt) result.push(...(this.modules.monsters?.onHuntAnswer?.(state, {session, item, ok, firstTry}) || []));
      else if (!ok && fresh) this.modules.monsters?.spawnFromDrill?.(state, {session, item, refs});
      this.questTick(state);
      return result;
    });
  }

  onDrillFinish({session, result} = {}) {
    if (!session?.sessionId || !result) return [];
    const sid = session.sessionId;
    return this.mutate(state => {
      const run = state.drill[sid] || {combo: 0, maxCombo: 0, seen: [], ults: 0, writeAll: false};
      const stats = session.stats || {};
      const form = this.form(state);
      const date = this.today();
      const d = this.day(state, date);
      const firstSetToday = d.sets === 0;
      const scored = stats.scored || 0;
      const correct = stats.correct || 0;
      const awards = E.setStars({scored, correct, firstSetToday, form, book: session.source === 'vocab' ? 'vocab' : '', economy: this.economy}).map(p => ({kind: 'stars', amount: p.value, reason: p.reason, fx: 'medium'}));
      if (scored >= this.economy.earn.setFinishMinScored) {
        d.sets += 1;
        state.stats.setsDone += 1;
        if (correct === scored) {
          state.stats.perfectSets += 1;
          d.perfectSets = (d.perfectSets || 0) + 1;
          if (run.writeAll && (session.items || []).some(i => E.isWriteMode(i.mode))) state.stats.writePerfectSets += 1;
        }
        if (run.maxCombo >= 20) state.stats.combo20Sets += 1;
      }
      const out = this.grant(state, `drillset:${sid}`, {type: 'drill', id: sid}, awards);
      out.push(...(this.modules.world?.onSetResult?.(state, {sessionId: sid, scored, correct}) || []));
      if (result.jar?.filledNow) out.push(...this.grant(state, `jar:${date}`, {type: 'jar', id: date}, [{kind: 'stars', amount: this.economy.earn.jarFull, reason: '星星罐装满了', fx: 'big'}]));
      if (result.streak?.stampedToday) out.push(...this.streakAwards(state, result.streak.current || 0));
      const rng = E.mulberry32(E.seedFrom('gift', sid));
      const gift = E.giftRoll(rng, this.economy);
      if (gift) out.push(...this.grant(state, `gift:${sid}`, {type: 'gift', id: sid}, [gift.kind === 'stars'
        ? {kind: 'stars', amount: gift.amount, reason: '碧琪的小礼物', fx: 'big'}
        : {kind: 'item', itemId: this.giftSticker(state, rng), reason: '碧琪的小礼物：一张贴纸', fx: 'big'}]));
      this.questTick(state);
      return out;
    });
  }

  streakAwards(state, days) {
    state.stats.streak = Math.max(state.stats.streak, days);
    const r = E.streakReward({days, form: this.form(state), economy: this.economy});
    if (!r) return [];
    return this.grant(state, `streak:${days}:${this.today()}`, {type: 'streak', id: String(days)}, [
      {kind: 'stars', amount: r.stars, reason: `连续盖章 ${days} 天`, fx: 'big'}, {kind: 'seals', amount: r.seals, reason: `连续盖章 ${days} 天`, fx: 'big'}]);
  }

  giftSticker(state, rng) {
    const packs = this.catalog.items.filter(i => i.kind === 'stickers' && !state.items.owned.includes(i.id));
    return (packs[Math.floor(rng() * packs.length)] || this.catalog.items.find(i => i.kind === 'stickers')).id;
  }

  // 刷题 / 学习台题卡（learning-pact.recordQuestion 调用）。重复 receipt 由 pact 判断后不调用。
  onQuestion({correct = null, receiptId = '', date = this.today(), seq = 0} = {}) {
    if (correct !== true) return [];
    return this.mutate(state => {
      const form = this.form(state);
      const s = E.answerStars({eligible: true, correct: true, form, economy: this.economy}).value;
      const d = this.day(state, date);
      d.answers += 1; d.correct += 1;
      const out = this.grant(state, `q:${receiptId || `${date}#${seq}`}`, {type: 'question', id: receiptId || `${date}#${seq}`}, [{kind: 'stars', amount: s, reason: '刷题答对', fx: 'small'}]);
      this.questTick(state);
      return out;
    });
  }

  // 课程完成（learning-pact.recordLesson 调用）。
  onLesson({lessonId, subject = '', chapter = ''} = {}) {
    if (!lessonId) return [];
    return this.mutate(state => {
      if (state.ledger[`lesson:${lessonId}`]) return [];
      const form = this.form(state);
      state.stats.lessons += 1;
      this.day(state).lessons += 1;
      const v = E.boosted(this.economy.earn.lessonPass, {event: 'lesson', form, economy: this.economy}).value;
      const out = this.grant(state, `lesson:${lessonId}`, {type: 'lesson', id: lessonId}, [{kind: 'stars', amount: v, reason: '这节课学完了', fx: 'medium'}]);
      this.modules.world?.onLesson?.(state, {lessonId, subject, chapter});
      this.questTick(state);
      return out;
    });
  }

  // ---------- 读状态 ----------
  state() {
    const state = this.read();
    const date = this.today();
    const quests = this.questsFor(state, date);
    const season = seasonOn(date);
    const owned = new Set(state.forms.owned);
    const levels = {};
    for (const id of state.forms.owned) levels[id] = E.affinityLevel(state.forms.xp[id] || 0, this.economy);
    const pactDay = this.safe(() => this.store.pact?.readDay?.(date), null);
    const streak = this.safe(() => this.store.pact?.drillStreak?.({now: this.now()}), null);
    const monsters = this.modules.monsters?.summary?.(state) || {active: 0, due: 0, captured: state.stats.captures};
    const boss = this.modules.exam?.bossState?.(state, GAME_EXAM) || this.bossFallback(state);
    return {
      wallet: {stars: state.wallet.stars, seals: state.wallet.seals, shards: {...state.wallet.shards}},
      rank: E.rankFor({gold: state.stats.gold, predicted: boss.bestPredicted || 0}, this.economy),
      form: {equipped: state.forms.equipped, owned: [...owned], levels, awakened: [...state.forms.awakened], v2note: state.forms.v2note && !state.forms.v2note.seen ? state.forms.v2note : null, v3note: state.forms.v3note && !state.forms.v3note.seen ? state.forms.v3note : null},
      items: {owned: [...(state.items.owned || [])], equipped: {...(state.items.equipped || {})}, names: Object.fromEntries((state.items.owned || []).map(id => [id, this.itemName(id)]))},
      today: {date, jar: {sets: pactDay?.drillFinished || 0, goal: 2, unit: 'sets'}, streak: streak?.current || 0, quests: quests.list, chestReady: quests.chest.ready && !quests.chest.opened, loop: this.loopToday(state, date, monsters)},
      boss, monsters,
      season: {term: season?.term || null, name: season?.name || '', until: season?.to || null, limitedSkus: this.shelves(state).limited.map(s => s.sku)},
      wishlist: this.wishlistView(state),
      quiet: isQuiet(date),
    };
  }
  // 今日闭环（REDO-1109 §5）：学 → 练（真题）→ 背生词 → 笔记回顾 → 讨伐 →（周末）整套模考。每一行做没做完都从当天真实数据算。
  loopToday(state, date, monsters) {
    const d = state.days[date] || {};
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const monday = mondayOf(date);
    const examWeek = (state.exam?.scores || []).some(x => beijingDate(x.at) >= monday);
    return {lessons: d.lessons || 0, realSets: d.realSets || 0, realCorrect: d.realCorrect || 0, words: d.words || 0, notes: d.notes || 0,
      huntWins: d.huntWins || 0, huntDue: monsters?.due || 0, weekend: dow === 0 || dow === 6, examWeek,
      suggest: this.safe(() => this.modules.practice?.suggest?.(state) || null, null)};
  }
  safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
  bossFallback() {
    const date = this.today();
    return {id: 'babel', name: '巴别兽', exam: GAME_EXAM, examDate: EXAM_DATES[GAME_EXAM], daysLeft: Math.max(0, daysBetween(date, EXAM_DATES[GAME_EXAM])),
      hpPercent: 100, bestPredicted: 0, passLine: this.economy.boss.passLine, safeLine: this.economy.boss.safeLine, phase: 'normal'};
  }

  pendingAwards() { return {awards: this.read().pending.slice()}; }
  ack(ids = []) {
    const set = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!set.size) return {ok: true};
    this.mutate(state => { state.pending = state.pending.filter(a => !set.has(a.id)); });
    return {ok: true};
  }

  // ---------- 商店 ----------
  skuFor(state, entry, extra = {}) {
    const owned = entry.kind === 'form' ? state.forms.owned.includes(entry.itemId) : state.items.owned.includes(entry.itemId);
    return {sku: entry.sku, kind: entry.kind, itemId: entry.itemId, name: entry.name, desc: entry.desc || '', price: entry.price, owned, ...extra};
  }
  shelves(state, date = this.today()) {
    const forms = this.catalog.forms;
    const season = seasonOn(date);
    const formEntry = (f, price = E.formPrice(f, this.economy)) => ({sku: `form:${f.id}`, kind: 'form', itemId: f.id, name: f.name, desc: f.bonus.text, price});
    const permanent = forms.filter(f => f.source.includes('shop')).map(f => formEntry(f));
    const seal = forms.filter(f => f.source.includes('seal-shop')).map(f => formEntry(f));
    const limited = [];
    const quiet = isQuiet(date); // 考前 7 天：不上限时货架、不打限时折扣
    if (season && !quiet) for (const f of forms.filter(x => x.season === season.term && !x.retired)) limited.push({...formEntry(f), until: season.to});
    // 过季限定：30 万能碎片复刻
    for (const f of forms.filter(x => x.season && !x.retired && SEASON_TERMS.some(t => t.term === x.season && t.to < date))) {
      seal.push({sku: `replica:${f.id}`, kind: 'form', itemId: f.id, name: `${f.name}（复刻）`, desc: f.bonus.text, price: {shards: this.economy.prices.limitedReplicaShards}});
    }
    const items = this.catalog.items.filter(i => !i.notForSale && (!i.season || i.season === season?.term));
    for (const i of items.filter(x => x.kind === 'ult' || x.kind === 'particles')) permanent.push({sku: `item:${i.id}`, kind: i.kind === 'ult' ? 'ult' : 'fx', itemId: i.id, name: i.name, price: E.itemPrice(i, this.economy)});
    // 每日货架：北京日期做种子，从没拥有的小商品里挑；1 格打折
    const rng = E.mulberry32(E.seedFrom('daily-shelf', date));
    const slots = this.economy.shop.dailySlots + (this.form(state)?.bonus?.kind === 'dailyShelfExtra' ? this.form(state).bonus.add : 0);
    const pool = items.filter(i => ['hit', 'result', 'cover', 'stickers', 'title'].includes(i.kind));
    const daily = [];
    const used = new Set();
    for (let k = 0; k < slots && used.size < pool.length; k += 1) {
      let i;
      do { i = pool[Math.floor(rng() * pool.length)]; } while (used.has(i.id));
      used.add(i.id);
      const base = E.itemPrice(i, this.economy);
      const discount = !quiet && k < this.economy.shop.dailyDiscountSlots ? this.economy.shop.dailyDiscount : null;
      const kind = {hit: 'fx', result: 'result', cover: 'cover', stickers: 'stickers', title: 'title'}[i.kind];
      daily.push({sku: `daily:${date}:${i.id}`, kind, itemId: i.id, name: i.name, price: discount ? {stars: Math.round(base.stars * discount)} : base, ...(discount ? {discount} : {})});
    }
    return {permanent, daily, limited, seal};
  }
  catalogView() {
    const state = this.read();
    const date = this.today();
    const shelves = this.shelves(state, date);
    const view = {};
    for (const [k, list] of Object.entries(shelves)) view[k] = list.map(e => this.skuFor(state, e, {...(e.until ? {until: e.until} : {}), ...(e.discount ? {discount: e.discount} : {})}));
    return {shelves: view, refreshAt: `${addDays(date, 1)}T00:00:00+08:00`};
  }
  findSku(state, sku) {
    for (const list of Object.values(this.shelves(state))) {
      const hit = list.find(e => e.sku === sku);
      if (hit) return hit;
    }
    return null;
  }
  buy({sku, requestId} = {}) {
    return this.once('shop.buy', requestId, state => {
      const entry = this.findSku(state, clean(sku, 160));
      if (!entry) fail('这件商品现在不在货架上');
      const owned = entry.kind === 'form' ? state.forms.owned.includes(entry.itemId) : state.items.owned.includes(entry.itemId);
      if (owned) fail('这个已经有啦');
      const price = entry.price || {};
      const lack = [];
      if ((price.stars || 0) > state.wallet.stars) lack.push(`${price.stars - state.wallet.stars} 星星`);
      if ((price.seals || 0) > state.wallet.seals) lack.push(`${price.seals - state.wallet.seals} 金印`);
      if ((price.shards || 0) > (state.wallet.shards.any || 0)) lack.push(`${price.shards - (state.wallet.shards.any || 0)} 万能碎片`);
      if (lack.length) fail(`还差 ${lack.join('、')}，再学一会儿就够啦`);
      state.wallet.stars -= price.stars || 0;
      state.wallet.seals -= price.seals || 0;
      state.wallet.shards.any = (state.wallet.shards.any || 0) - (price.shards || 0);
      const awards = this.grant(state, `buy:${requestId}`, {type: 'shop', id: entry.sku}, [
        entry.kind === 'form' ? {kind: 'form', itemId: entry.itemId, reason: `${entry.name}加入衣橱`, fx: 'cinematic'} : {kind: 'item', itemId: entry.itemId, reason: `买到了 ${entry.name}`, fx: 'medium'}]);
      if (state.wishlist?.sku === entry.sku || state.wishlist?.itemId === entry.itemId) state.wishlist = null;
      awards.push(...this.setRewards(state));
      return {ok: true, wallet: walletView(state), awards};
    });
  }
  setRewards(state) {
    const out = [];
    for (const set of this.catalog.sets || []) {
      if (!set.forms.every(id => state.forms.owned.includes(id))) continue;
      out.push(...this.grant(state, `set:${set.id}`, {type: 'set', id: set.id}, set.rewards.map(itemId => ({kind: 'item', itemId, reason: `集齐${set.name}`, fx: 'big'}))));
    }
    return out;
  }

  // ---------- 扭蛋 ----------
  banners() {
    const state = this.read();
    return Object.entries(this.economy.gacha).map(([id, b]) => {
      const g = state.gacha[id];
      const cost = {single: b.cost.single, ...(b.cost.ten ? {ten: g.tens === 0 && b.cost.firstTen ? b.cost.firstTen : b.cost.ten} : {}), ...(g.tens === 0 && b.cost.firstTen ? {firstTen: b.cost.firstTen} : {})};
      return {id, name: b.name, cost, rates: b.rates, effectiveSSR: E.effectiveSSR(id, this.economy), pity: {sr: b.pity.sr || null, ssr: b.pity.ssr, softStart: b.pity.softStart || null, count: {sr: g.sr, ssr: g.ssr}}, pools: E.gachaPools(id, this.catalog)};
    });
  }
  itemName(id) {
    return this.catalog.items.find(i => i.id === id)?.name || this.catalog.forms.find(f => f.id === id)?.name || id;
  }
  pull({banner, count = 1, requestId} = {}) {
    return this.once('gacha.pull', requestId, state => {
      const id = banner === 'seal' ? 'seal' : banner === 'star' ? 'star' : fail('没有这个扭蛋机');
      const n = Number(count) === 10 ? 10 : Number(count) === 1 ? 1 : fail('只能单抽或十连');
      const g = state.gacha[id];
      const cost = E.bannerCost(id, n, this.economy, {tensDone: g.tens});
      if (!cost) fail('这个扭蛋机不能十连');
      if ((cost.stars || 0) > state.wallet.stars) fail(`还差 ${cost.stars - state.wallet.stars} 星星`);
      if ((cost.seals || 0) > state.wallet.seals) fail(`还差 ${cost.seals - state.wallet.seals} 金印`);
      state.wallet.stars -= cost.stars || 0;
      state.wallet.seals -= cost.seals || 0;
      const owned = new Set([...state.forms.owned, ...state.items.owned]);
      const rng = E.mulberry32(E.seedFrom('gacha', id, requestId, g.pulls));
      const out = E.gachaPull(id, {pity: {sr: g.sr, ssr: g.ssr}, owned, count: n, rng, economy: this.economy, catalog: this.catalog});
      g.sr = out.pity.sr; g.ssr = out.pity.ssr; g.pulls += n;
      if (n === 10) g.tens += 1;
      const grants = [];
      for (const r of out.results) {
        if (r.rarity === 'SSR') g.ssrHits += 1;
        if (r.dup) grants.push({kind: 'shards', amount: r.shards, itemId: r.shardTo === 'any' ? 'any' : r.itemId, reason: '重复的变成了碎片', fx: 'small'});
        else grants.push({kind: r.kind === 'form' ? 'form' : 'item', itemId: r.itemId, reason: '扭到了', fx: r.rarity === 'SSR' ? 'cinematic' : r.rarity === 'SR' ? 'big' : 'medium'});
      }
      // 扭蛋的结果自己有开蛋动画，awards 里照样记一份（前端可以按 source.type==='gacha' 跳过重复播放）
      const awards = this.grant(state, `gacha:${requestId}`, {type: 'gacha', id}, grants);
      awards.push(...this.setRewards(state));
      return {results: out.results.map(r => ({itemId: r.itemId, kind: r.kind, name: r.name || this.itemName(r.itemId), rarity: r.rarity, dup: r.dup, shards: r.shards})),
        pity: {sr: g.sr, ssr: g.ssr, count: g.pulls}, wallet: walletView(state), awards};
    });
  }

  // ---------- 形态 ----------
  formsList() {
    const state = this.read();
    return {forms: this.catalog.forms.map(f => {
      const owned = state.forms.owned.includes(f.id);
      const xp = state.forms.xp[f.id] || 0;
      const progress = this.awakenProgress(state, f);
      return {...f, owned, equipped: state.forms.equipped === f.id, level: E.affinityLevel(xp, this.economy), awakened: state.forms.awakened.includes(f.id),
        awaken: {...f.awaken, progress, shards: this.economy.awakenShards, ready: owned && E.affinityLevel(xp, this.economy).lv >= 10 && progress >= f.awaken.count},
        price: E.formPrice(f, this.economy), howToGet: howToGet(f)};
    })};
  }
  awakenProgress(state, form) {
    const s = state.stats;
    const map = {streak: s.streak, nodesLit: s.nodesLit, questsDone: s.questsDone, writePerfectSets: s.writePerfectSets, maxCombo: s.maxCombo,
      captures: s.captures, regionsLit: s.regionsLit, examBest: s.examBest, guardPerfect: s.guardPerfect, huntWins: s.huntWins, setsDone: s.setsDone,
      ults: s.ults, combo20Sets: s.combo20Sets, examsSafe: s.examsSafe, dailyQuests: s.dailyQuests, notesDrilled: s.notesDrilled, perfectSets: s.perfectSets,
      realPass: s.realPass, allGold: s.allGold, realCorrect: s.realCorrect};
    return Math.min(form.awaken.count, map[form.awaken.stat] || 0);
  }
  equip({formId} = {}) {
    return this.mutate(state => {
      const id = clean(formId, 40);
      if (!state.forms.owned.includes(id)) fail('还没有这个形态');
      state.forms.equipped = id;
      return {ok: true, equipped: id};
    });
  }
  awaken({formId, requestId} = {}) {
    return this.once('forms.awaken', requestId, state => {
      const form = this.form(state, clean(formId, 40));
      if (!form || !state.forms.owned.includes(form.id)) fail('还没有这个形态');
      if (state.forms.awakened.includes(form.id)) fail('已经觉醒过了');
      if (E.affinityLevel(state.forms.xp[form.id] || 0, this.economy).lv < 10) fail('亲密度到 Lv10 才能觉醒');
      if (this.awakenProgress(state, form) < form.awaken.count) fail(`觉醒挑战还没完成：${form.awaken.text}`);
      const need = this.economy.awakenShards;
      const own = state.wallet.shards[form.id] || 0;
      const any = state.wallet.shards.any || 0;
      if (own + any < need) fail(`还差 ${need - own - any} 个碎片`);
      const useOwn = Math.min(own, need);
      state.wallet.shards[form.id] = own - useOwn;
      state.wallet.shards.any = any - (need - useOwn);
      state.forms.awakened.push(form.id);
      return {ok: true, awards: this.grant(state, `awaken:${form.id}`, {type: 'awaken', id: form.id}, [{kind: 'awaken', itemId: form.id, reason: `${form.name}觉醒了`, fx: 'cinematic'}])};
    });
  }
  setWishlist({sku = null} = {}) {
    return this.mutate(state => {
      if (sku == null || sku === '') { state.wishlist = null; return {wishlist: null}; }
      const entry = this.findSku(state, clean(sku, 160));
      if (!entry) fail('这件商品现在不在货架上');
      state.wishlist = {sku: entry.sku, itemId: entry.itemId};
      return {wishlist: this.wishlistView(state)};
    });
  }
  wishlistView(state) {
    if (!state.wishlist) return null;
    const entry = this.findSku(state, state.wishlist.sku) || (() => {
      const form = this.form(state, state.wishlist.itemId);
      return form ? {sku: `form:${form.id}`, price: E.formPrice(form, this.economy), itemId: form.id, name: form.name} : null;
    })();
    if (!entry) return null;
    const p = entry.price || {};
    const missing = {stars: Math.max(0, (p.stars || 0) - state.wallet.stars), seals: Math.max(0, (p.seals || 0) - state.wallet.seals), shards: Math.max(0, (p.shards || 0) - (state.wallet.shards.any || 0))};
    return {sku: entry.sku, name: entry.name, price: p, missing};
  }
  equipItem({slot, itemId} = {}) {
    return this.mutate(state => {
      const slots = {hit: 'hit', particles: 'particles', ult: 'ult', result: 'result', cover: 'cover', title: 'title'};
      const s = slots[slot] || fail('没有这个装备栏');
      if (itemId == null || itemId === '') { delete state.items.equipped[s]; return {ok: true, equipped: state.items.equipped}; }
      const id = clean(itemId, 80);
      if (!state.items.owned.includes(id)) fail('还没有这件');
      if (!id.startsWith(`${s}:`)) fail('这件不能装在这里');
      state.items.equipped[s] = id;
      return {ok: true, equipped: {...state.items.equipped}};
    });
  }

  // ---------- 委托 ----------
  // 目标由代码从真实数据算（到期量、活跃怪、今天的课程）；文案先用本地，模型文案由 content 模块异步补（source 标出来）。
  questsFor(state, date) {
    const q = state.quests[date] || this.planQuests(state, date);
    const d = state.days[date] || {};
    const list = q.list.map(item => {
      const progress = Math.min(item.target.count, questProgress(item.target, d));
      return {...item, progress, done: progress >= item.target.count, claimed: Boolean(q.claimed[item.id])};
    });
    const allClaimed = list.length > 0 && list.every(i => i.claimed);
    return {list: list.map(i => ({...i, source: q.text === 'model' ? 'model' : 'local'})), weekly: this.weeklyQuest(state, date), chest: {ready: allClaimed, opened: Boolean(q.chest)}, text: q.text || 'local'};
  }
  planQuests(state, date) {
    const dueCards = this.safe(() => (this.store.pact?.dueReviews?.(this.now()) || 0), 0);
    const activeDue = this.modules.monsters?.summary?.(state)?.due || 0;
    const list = [];
    list.push({id: `${date}-a`, title: '今天的到期卡', text: dueCards > 0 ? `先把到期的 ${Math.min(dueCards, 30)} 张浇浇水` : '背 20 道题，让手账亮起来', target: {kind: 'answers', count: dueCards > 0 ? Math.min(Math.max(dueCards, 10), 30) : 20}, reward: {stars: this.economy.earn.quests[0]}});
    if (activeDue > 0) list.push({id: `${date}-b`, title: '讨伐错题怪', text: `去打 ${Math.min(activeDue, 3)} 只到期的错题怪`, target: {kind: 'huntWins', count: Math.min(activeDue, 3)}, reward: {stars: this.economy.earn.quests[1]}});
    else {
      // 没有到期的怪时，第二个委托按日子轮换，一半的日子是「真题答对 n 道」（REDO-1109：今日闭环要有「练」），不要天天同一件事。
      const turn = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) % 6;
      const real = {title: '真题答对 10 道', text: '去刷题，真题答对 10 道', target: {kind: 'realCorrect', count: 10}};
      const b = [
        real,
        {title: '背完两组', text: '背一背做完两组', target: {kind: 'sets', count: 2}},
        real,
        {title: '打出一次大招', text: `一组里连对 ${this.economy.earn.ultCombo} 题，看碧琪放大招`, target: {kind: 'ults', count: 1}},
        real,
        {title: '一组全对', text: '背一背里有一组一题不错', target: {kind: 'perfectSets', count: 1}},
      ][turn];
      list.push({id: `${date}-b`, ...b, reward: {stars: this.economy.earn.quests[1]}});
    }
    list.push({id: `${date}-c`, title: '学一个新考点', text: '上一节课，或者背 5 张新卡', target: {kind: 'learn', count: 1}, reward: {stars: this.economy.earn.quests[2]}});
    return {list, claimed: {}, chest: null, text: 'local'};
  }
  weeklyQuest(state, date) {
    const monday = mondayOf(date);
    let sets = 0;
    for (let i = 0; i < 7; i += 1) sets += state.days[addDays(monday, i)]?.sets || 0;
    const key = `weekly:${monday}`;
    return {id: key, title: '本周委托', text: '这一周背完 15 组', target: {kind: 'weekSets', count: 15}, progress: Math.min(15, sets), reward: {stars: this.economy.earn.weekly, seals: this.economy.earn.weeklySeals}, done: sets >= 15, claimed: Boolean(state.ledger[key])};
  }
  questTick(state) {
    const date = this.today();
    if (!state.quests[date]) state.quests[date] = this.planQuests(state, date);
    const keys = Object.keys(state.quests);
    if (keys.length > 21) for (const k of keys.sort().slice(0, keys.length - 14)) delete state.quests[k];
  }
  questsToday() {
    const date = this.today();
    if (!this.read().quests[date]) this.mutate(s => this.questTick(s));
    this.modules.content?.kickQuestText?.(date);
    const state = this.read();
    const q = this.questsFor(state, date);
    return {quests: q.list, weekly: q.weekly, chest: q.chest};
  }
  claim({questId, requestId} = {}) {
    return this.once('quests.claim', requestId, state => {
      const date = this.today();
      this.questTick(state);
      const id = clean(questId, 80);
      const form = this.form(state);
      if (id.startsWith('weekly:')) {
        const w = this.weeklyQuest(state, date);
        if (w.id !== id) fail('这个委托已经过期了');
        if (!w.done) fail('还没完成哦');
        // 换 requestId 重领：钱有 ledger 挡着，但计数（questsDone 驱动觉醒挑战）以前会一直涨。
        if (state.ledger[id]) fail('已经领过了');
        state.stats.questsDone += 1;
        return {awards: this.grant(state, id, {type: 'quest', id}, [
          {kind: 'stars', amount: E.boosted(w.reward.stars, {event: 'quest', form, economy: this.economy}).value, reason: '本周委托完成', fx: 'big'},
          {kind: 'seals', amount: w.reward.seals, reason: '本周委托完成', fx: 'big'}])};
      }
      const view = this.questsFor(state, date);
      const item = view.list.find(i => i.id === id) || fail('这个委托已经过期了');
      if (item.claimed) fail('已经领过了');
      if (!item.done) fail('还没完成哦');
      state.quests[date].claimed[id] = true;
      state.stats.questsDone += 1;
      state.stats.dailyQuests += 1;
      return {awards: this.grant(state, `quest:${id}`, {type: 'quest', id}, [{kind: 'stars', amount: E.boosted(item.reward.stars, {event: 'quest', form, economy: this.economy}).value, reason: `委托完成：${item.title}`, fx: 'medium'}])};
    });
  }
  openChest({requestId} = {}) {
    return this.once('chest.open', requestId, state => {
      const date = this.today();
      this.questTick(state);
      const view = this.questsFor(state, date);
      const extra = this.form(state)?.bonus?.kind === 'chestExtra' ? this.form(state).bonus.add : 0;
      const q = state.quests[date];
      const opened = q.chestOpens || 0;
      if (!view.chest.ready) fail('三个委托都领完才能开宝箱');
      if (opened >= 1 + extra) fail('今天的宝箱已经开过了');
      q.chestOpens = opened + 1;
      q.chest = true;
      const rng = E.mulberry32(E.seedFrom('chest', date, opened));
      const c = E.chestRoll(rng, this.economy);
      const award = c.kind === 'stars' ? {kind: 'stars', amount: c.amount, reason: '委托宝箱', fx: 'big'}
        : c.kind === 'shards' ? {kind: 'shards', amount: 1, itemId: 'any', reason: '委托宝箱：万能碎片', fx: 'big'}
          : {kind: 'item', itemId: this.giftSticker(state, rng), reason: '委托宝箱：贴纸', fx: 'big'};
      this.day(state, date).chests += 1;
      return {awards: this.grant(state, `chest:${date}:${opened}`, {type: 'chest', id: date}, [award])};
    });
  }
}

function walletView(state) {
  return {stars: state.wallet.stars, seals: state.wallet.seals, shards: {...state.wallet.shards}};
}
function fxFor(a) {
  if (a.kind === 'form' || a.kind === 'awaken' || a.kind === 'boss') return 'cinematic';
  if (a.kind === 'seals' || a.kind === 'capture' || a.kind === 'chest' || a.kind === 'rank') return 'big';
  if ((a.amount || 0) >= 20) return 'big';
  if ((a.amount || 0) >= 5) return 'medium';
  return 'small';
}
function questProgress(target, d) {
  if (target.kind === 'answers') return d.correct || 0;
  if (target.kind === 'sets') return d.sets || 0;
  if (target.kind === 'huntWins') return d.huntWins || 0;
  if (target.kind === 'ults') return d.ults || 0;
  if (target.kind === 'perfectSets') return d.perfectSets || 0;
  if (target.kind === 'realCorrect') return d.realCorrect || 0;
  if (target.kind === 'learn') return (d.lessons || 0) + Math.floor((d.newCards || 0) / 5);
  return 0;
}
function howToGet(form) {
  const s = form.source;
  if (s.includes('start')) return '一开始就有';
  if (s.some(x => x.startsWith('limited:'))) return '节气限定：当季在商店买，过季用 30 万能碎片复刻';
  if (s.includes('boss:babel')) return '打破巴别兽的防（考试预估分达到稳过线）';
  if (s.includes('achievement:realPass')) return 'B 级真实分数 ≥ 60';
  if (s.includes('achievement:allGold')) return '第一卷全部节点金章';
  const parts = [];
  if (s.includes('shop')) parts.push('商店');
  if (s.includes('seal-shop')) parts.push('金印专柜');
  if (s.includes('gacha-star')) parts.push('星星扭蛋');
  if (s.includes('gacha-seal')) parts.push('金印扭蛋');
  return parts.join(' / ');
}

// ---------- 注册 ----------
export function registerLearningGame(api, store, options = {}) {
  const game = new LearningGame(store, options);
  store.game = game;
  const register = (name, handler) => api.registerGatewayMethod(`pinkie.learning.game.${name}`, async ({params, respond}) => {
    try {
      const body = params || {};
      store.assertLearningSession(String(body.sessionKey || ''));
      respond(true, await handler(body));
    } catch (error) {
      respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)});
    }
  }, {scope: 'operator.admin'});
  const mod = name => game.modules[name] || {};
  const via = (name, fn, fallback) => p => (typeof mod(name)[fn] === 'function' ? mod(name)[fn](p) : fallback(p));
  const notReady = what => () => { throw new Error(`${what}还在准备中`); };
  register('state', () => game.state());
  register('awards.pending', () => game.pendingAwards());
  register('awards.ack', p => game.ack(p.ids));
  register('shop.catalog', () => game.catalogView());
  register('shop.buy', p => game.buy(p));
  register('gacha.banners', () => game.banners());
  register('gacha.pull', p => game.pull(p));
  register('forms.list', () => game.formsList());
  register('forms.v2seen', () => game.mutate(state => { if (state.forms.v2note) state.forms.v2note.seen = true; if (state.forms.v3note) state.forms.v3note.seen = true; return {ok: true}; }));
  register('forms.equip', p => game.equip(p));
  register('forms.awaken', p => game.awaken(p));
  register('wishlist.set', p => game.setWishlist(p));
  register('items.equip', p => game.equipItem(p));
  register('quests.today', () => game.questsToday());
  register('quests.claim', p => game.claim(p));
  register('chest.open', p => game.openChest(p));
  // 世界 / 错题怪 / 考试 / 台词：由子模块挂到 game.modules（B2–B4）。没挂上时返回真实结构的空数据。
  register('world', via('world', 'world', (p => ({exam: p.exam || GAME_EXAM, title: '第一卷 · 英语 B 级', regions: [], generatedAt: null, status: 'generating'}))));
  register('world.regenerate', via('world', 'regenerate', notReady('考点地图')));
  register('node.start', via('world', 'nodeStart', notReady('考点')));
  register('guard.answer', via('world', 'guardAnswer', notReady('守关战')));
  register('guard.explain', via('world', 'guardExplain', notReady('守关战')));
  register('guard.finish', via('world', 'guardFinish', notReady('守关战')));
  register('monsters.list', via('monsters', 'list', (() => ({monsters: []}))));
  register('hunt.start', via('monsters', 'huntStart', notReady('讨伐')));
  register('exam.papers', via('exam', 'papers', (() => ({papers: [], format: null}))));
  register('exam.generate', via('exam', 'generate', notReady('考卷')));
  register('exam.start', via('exam', 'start', notReady('考场')));
  register('exam.save', via('exam', 'save', notReady('考场')));
  register('exam.submit', via('exam', 'submit', notReady('考场')));
  register('exam.result', via('exam', 'result', notReady('成绩')));
  // 插着 U 盘时手动「再扫一遍」（大厅按钮）；没插盘就只返回状态
  register('exam.realSync', () => { const ex = mod('exam'); if (!ex.real) return {state: 'idle'}; ex.real.sync({force: false}).then(() => ex.keepSpare?.()).catch(() => {}); return {...ex.real.status, mounted: Boolean(ex.real.usbBase())}; });
  // 真题原录音：/pinkie-exam-audio/<paperId>?key=<开考时发的 key>，支持 Range（拖进度条）
  try {
    api.registerHttpRoute?.({path: '/pinkie-exam-audio/', match: 'prefix', auth: 'plugin', handler(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const file = mod('exam').audioFile?.(decodeURIComponent(url.pathname.slice('/pinkie-exam-audio/'.length)), url.searchParams.get('key'));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!file || !['GET', 'HEAD'].includes(req.method)) { res.statusCode = file ? 405 : 404; res.end(); return true; }
      let size = 0;
      try { size = fs.statSync(file).size; } catch { res.statusCode = 404; res.end(); return true; }
      res.setHeader('Content-Type', /\.m4a$/i.test(file) ? 'audio/mp4' : /\.wav$/i.test(file) ? 'audio/wav' : 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers?.range || ''));
      let start = 0, end = size - 1;
      if (m) {
        start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); res.end(); return true; }
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      } else res.statusCode = 200;
      res.setHeader('Content-Length', String(end - start + 1));
      if (req.method === 'HEAD') { res.end(); return true; }
      fs.createReadStream(file, {start, end}).on('error', () => res.destroy()).pipe(res);
      return true;
    }});
  } catch (error) { api.logger?.warn?.(`exam audio route: ${error?.message || error}`); }
  register('boss.state', p => (mod('exam').bossState ? mod('exam').bossState(game.read(), p.exam || GAME_EXAM) : game.bossFallback()));
  register('boss.realScore', via('exam', 'realScore', notReady('真实分数')));
  register('practice.overview', via('practice', 'overview', (() => ({total: 0, points: [], kinds: []}))));
  register('practice.start', via('practice', 'start', notReady('刷题')));
  register('practice.answer', via('practice', 'answer', notReady('刷题')));
  register('practice.explain', via('practice', 'explain', notReady('刷题')));
  register('practice.finish', via('practice', 'finish', notReady('刷题')));
  register('practice.unlock', via('practice', 'unlock', notReady('刷题')));
  register('practice.suggest', p => mod('practice').suggest?.(game.read(), p) || null);
  register('line', via('content', 'line', (async () => ({text: '我在呢，一起加油～', source: 'local'}))));
  return game;
}
