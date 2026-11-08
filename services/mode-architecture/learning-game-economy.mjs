// 碧琪上岸记：奖励数值的纯函数。后端（learning-game.mjs）和数值模拟器（tools/study-game/economy-sim.mjs）
// 都只通过这里算奖励，数值都来自 learning-game-economy.json —— 模拟的就是线上用的。
// 规矩：确定性；形态加成只改 ⭐ / 🟡 / 碎片，单事件叠加后 ≤ bonusCap 倍；题目和判分代码不读这里。
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ECONOMY_FILE = fileURLToPath(new URL('./learning-game-economy.json', import.meta.url));
const FORMS_FILE = fileURLToPath(new URL('./learning-game-forms.json', import.meta.url));
let cachedEconomy = null;
let cachedForms = null;

export function loadEconomy() {
  cachedEconomy ||= JSON.parse(fs.readFileSync(ECONOMY_FILE, 'utf8'));
  return cachedEconomy;
}
export function loadForms() {
  cachedForms ||= JSON.parse(fs.readFileSync(FORMS_FILE, 'utf8'));
  return cachedForms;
}
export function formById(id, catalog = loadForms()) {
  return catalog.forms.find(form => form.id === id) || null;
}

// ---------- 随机数：可复现 ----------
export function seedFrom(...parts) {
  const hex = createHash('sha256').update(parts.map(String).join('|')).digest('hex');
  return parseInt(hex.slice(0, 8), 16) >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

// ---------- 形态加成 ----------
// 事件种类 → 哪些加成作用于它。返回 {value, bonus}：value 已经封顶在 base × cap。
const STAR_EVENTS = {
  lessonStarsPct: ['lesson'],
  questStarsPct: ['quest'],
  captureStarsPct: ['capture'],
  streakStarsPct: ['streak'],
  huntStarsPct: ['huntWin'],
  examStarsPct: ['exam'],
};
export function boosted(base, {event, currency = 'stars', form = null, ctx = {}, economy = loadEconomy()} = {}) {
  const raw = Math.max(0, Math.round(Number(base) || 0));
  if (!raw || !form?.bonus) return {value: raw, bonus: 0};
  const b = form.bonus;
  let value = raw;
  if (currency === 'stars') {
    if (STAR_EVENTS[b.kind]?.includes(event)) value = raw * (1 + b.pct);
    if (b.kind === 'writeStarsMul' && event === 'answer' && ctx.write) value = raw * b.mul;
    if (b.kind === 'notesStarsPct' && event === 'answer' && ctx.book === 'notes') value = raw * (1 + b.pct);
    if (b.kind === 'comboStarsMul' && event === 'combo') value = raw * b.mul;
    if (b.kind === 'comboStepAdd' && event === 'combo') value = raw + b.add;
    if (b.kind === 'streakMilestoneMul' && event === 'streak') value = raw * b.mul;
    if (b.kind === 'setFinishAdd' && event === 'setFinish') value = raw + b.add;
    if (b.kind === 'perfectSetAdd' && event === 'setPerfect') value = raw + b.add;
  }
  if (currency === 'seals') {
    if (b.kind === 'examSealsAdd' && event === 'exam') value = raw + b.add;
    if (b.kind === 'guardExamSealsAdd' && (event === 'exam' || event === 'guard')) value = raw + b.add;
  }
  const capped = Math.min(Math.round(value), raw * economy.earn.bonusCap);
  return {value: capped, bonus: capped - raw};
}

// 形态的每日首组礼（元气 / 暖冬）：一份固定小礼物，不是乘在别的奖励上的倍率。
export function firstSetGift(form) {
  return form?.bonus?.kind === 'firstSetStars' ? Math.max(0, form.bonus.add | 0) : 0;
}
export function ultThreshold(form, economy = loadEconomy()) {
  return form?.bonus?.kind === 'ultThreshold' ? form.bonus.value : economy.earn.ultCombo;
}

// ---------- 单题 ----------
// eligible：到期 / 新卡 / 错过的 / 错题怪变体 → true；没到期且已记牢（强度 ≥ 3）→ false（0 星）。
export function cardEligible(card = {}, now = Date.now()) {
  if (card.variant || card.hunt) return true;
  const strength = Number(card.strength) || 0;
  const due = card.due === true || !Number(card.nextReviewAt) || Number(card.nextReviewAt) <= now;
  if (due || strength <= 0) return true;
  return strength < 3;
}
export function answerStars({eligible = true, correct = false, firstTry = true, verdict = null, write = false, book = 'notes', form = null, economy = loadEconomy()} = {}) {
  if (!eligible || !correct || firstTry === false || verdict === 'wrong' || verdict === 'partial') return {value: 0, bonus: 0};
  return boosted(economy.earn.answer, {event: 'answer', form, ctx: {write, book}, economy});
}
const WRITE_MODES = new Set(['write', 'cloze', 'spell', 'dictate']);
export const isWriteMode = mode => WRITE_MODES.has(mode);

// 连击：combo 是本题答完后的连击数。返回 {stars, ult}。
export function comboStars(combo, {form = null, economy = loadEconomy(), ultsSoFar = 0} = {}) {
  const e = economy.earn;
  let stars = 0;
  let ult = false;
  if (combo > 0 && combo % e.comboStep === 0) stars += boosted(e.comboStepStars, {event: 'combo', form, economy}).value;
  const threshold = ultThreshold(form, economy);
  if (combo > 0 && combo % threshold === 0) { ult = true; stars += e.ultStars; }
  void ultsSoFar;
  return {stars, ult};
}

// 一组做完。
export function setStars({scored = 0, correct = 0, firstSetToday = false, form = null, economy = loadEconomy()} = {}) {
  const e = economy.earn;
  const parts = [];
  if (scored >= e.setFinishMinScored) {
    parts.push({reason: '这一组背完了', value: boosted(e.setFinish, {event: 'setFinish', form, economy}).value});
    const perfect = correct === scored && scored > 0;
    const noPerfect = form?.bonus?.kind === 'comboStarsMul' && form.bonus.noPerfect;
    if (perfect && !noPerfect) parts.push({reason: '一组全对', value: boosted(e.setPerfect, {event: 'setPerfect', form, economy}).value});
  }
  if (firstSetToday && scored >= e.setFinishMinScored) {
    const gift = firstSetGift(form);
    if (gift) parts.push({reason: `${form.name}的今日首组礼`, value: gift});
  }
  return parts;
}

// 考试交卷：⭐ = base + 分数；🟡 = 3 + ⌊max(0, 分 − 60)/10⌋，每北京周最多 cap 次给金印。
export function examReward({score = 0, sealsUsedThisWeek = 0, form = null, economy = loadEconomy()} = {}) {
  const e = economy.earn;
  const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const stars = boosted(e.examBase + s, {event: 'exam', form, economy}).value;
  let seals = 0;
  if (sealsUsedThisWeek < e.examSealWeeklyCap) {
    seals = boosted(e.examSealsBase + Math.floor(Math.max(0, s - e.examSealsPassLine) / 10) * e.examSealsPer10, {event: 'exam', currency: 'seals', form, economy}).value;
  }
  return {stars, seals, sealCounted: seals > 0};
}

// 守关战：首次 ≥ 70% 通关、首次满分；重刷 ⭐ 50%，金印只补「刷新最好成绩」的差额。
export function guardReward({pct = 0, best = null, form = null, economy = loadEconomy()} = {}) {
  const e = economy.earn;
  const passed = pct >= e.guardPassPct;
  const perfect = pct >= 100;
  const tier = p => (p >= 100 ? 2 : p >= e.guardPassPct ? 1 : 0);
  const baseStars = s => (s >= 2 ? e.guardFirst + e.guardPerfect : s >= 1 ? e.guardFirst : 0);
  const baseSeals = s => (s >= 2 ? e.guardFirstSeals + e.guardPerfectSeals : s >= 1 ? e.guardFirstSeals : 0);
  const now = tier(pct);
  const before = best == null ? -1 : tier(best);
  let stars;
  let seals = 0;
  if (before < 0) {
    stars = baseStars(now);
    seals = baseSeals(now);
  } else {
    stars = Math.round(baseStars(now) * e.replayFactor);
    if (now > before) seals = baseSeals(now) - baseSeals(before);
  }
  return {
    passed, perfect,
    stars: boosted(stars, {event: 'guard', form, economy}).value,
    seals: seals ? boosted(seals, {event: 'guard', currency: 'seals', form, economy}).value : 0,
  };
}

export function captureReward({evolved = 0, form = null, economy = loadEconomy()} = {}) {
  const e = economy.earn;
  return {
    stars: boosted(e.capture + e.captureEvolvedBonus * Math.max(0, evolved | 0), {event: 'capture', form, economy}).value,
    shards: e.captureShards,
  };
}

export function streakReward({days = 0, form = null, economy = loadEconomy()} = {}) {
  const e = economy.earn;
  if (!days || days % e.streakEvery) return null;
  return {stars: boosted(e.streakStars, {event: 'streak', form, economy}).value, seals: e.streakSeals};
}

export function chestRoll(rng, economy = loadEconomy()) {
  const c = economy.earn.chest;
  const r = rng();
  if (r < c.shardChance) return {kind: 'shards', amount: 1};
  if (r < c.shardChance + c.stickerChance) return {kind: 'sticker'};
  return {kind: 'stars', amount: randInt(rng, c.starsMin, c.starsMax)};
}
export function giftRoll(rng, economy = loadEconomy()) {
  const g = economy.earn.gift;
  if (rng() >= g.chance) return null;
  if (rng() < g.stickerChance) return {kind: 'sticker'};
  return {kind: 'stars', amount: randInt(rng, g.starsMin, g.starsMax)};
}

// ---------- 亲密度 / 段位 ----------
export function affinityLevel(xp, economy = loadEconomy()) {
  const steps = economy.affinity;
  let lv = 1;
  for (let i = 1; i < steps.length; i += 1) if (xp >= steps[i]) lv = i + 1;
  return {lv, xp, next: lv >= steps.length ? null : steps[lv]};
}
export function rankFor({gold = 0, predicted = 0} = {}, economy = loadEconomy()) {
  let index = 0;
  economy.ranks.forEach((rank, i) => { if (gold >= rank.gold && predicted >= rank.predicted) index = i; });
  const rank = economy.ranks[index];
  const next = economy.ranks[index + 1];
  const progress = next ? Math.min(1, gold / Math.max(1, next.gold)) : 1;
  return {id: rank.id, name: rank.name, progress, next: next ? {name: next.name, gold: next.gold, predicted: next.predicted} : null};
}

// ---------- 价格 ----------
export function formPrice(form, economy = loadEconomy()) {
  const p = economy.prices.form;
  if (form.rarity === 'R') return {stars: p.R};
  if (form.rarity === 'SR') return {stars: p.SR};
  if (form.rarity === 'SSR') return {stars: p.SSR.stars, seals: p.SSR.seals};
  if (form.rarity === 'limited') return {stars: p.limited};
  return null;
}
export function itemPrice(item, economy = loadEconomy()) {
  const price = economy.prices[item.kind];
  return typeof price === 'number' ? {stars: price} : null;
}

// ---------- 扭蛋 ----------
export function gachaPools(bannerId, catalog = loadForms()) {
  const src = bannerId === 'seal' ? 'gacha-seal' : 'gacha-star';
  const pools = {N: [], R: [], SR: [], SSR: []};
  for (const form of catalog.forms) if (form.source.includes(src) && pools[form.rarity]) pools[form.rarity].push({kind: 'form', itemId: form.id});
  if (bannerId !== 'seal') for (const item of catalog.items) if (!item.notForSale && ['stickers', 'title', 'hit'].includes(item.kind)) pools.N.push({kind: item.kind, itemId: item.id});
  return pools;
}

// 一抽。pity = {sr, ssr}（距上次 SR+ / SSR 已抽多少次，不含本抽）。返回 {rarity, pity}。
export function gachaRarity(bannerId, pity, rng, economy = loadEconomy()) {
  const banner = economy.gacha[bannerId];
  const n = (pity.ssr || 0) + 1;
  const m = (pity.sr || 0) + 1;
  const rates = {...banner.rates};
  if (banner.pity.softStart && n >= banner.pity.softStart) {
    const extra = banner.pity.softStep * (n - banner.pity.softStart + 1);
    rates.SSR = Math.min(1, rates.SSR + extra);
  }
  let rarity;
  if (n >= banner.pity.ssr) rarity = 'SSR';
  else {
    const r = rng();
    if (r < rates.SSR) rarity = 'SSR';
    else {
      const rest = 1 - rates.SSR;
      const base = 1 - banner.rates.SSR;
      const scaled = (r - rates.SSR) / rest * base; // 其余档位按原比例分剩下的概率
      let acc = 0;
      rarity = 'R';
      for (const tier of ['SR', 'R', 'N']) {
        if (rates[tier] == null) continue;
        acc += rates[tier];
        if (scaled < acc) { rarity = tier; break; }
      }
    }
    if (banner.pity.sr && m >= banner.pity.sr && (rarity === 'R' || rarity === 'N')) rarity = 'SR';
  }
  const next = {
    ssr: rarity === 'SSR' ? 0 : n,
    sr: rarity === 'SSR' || rarity === 'SR' ? 0 : m,
  };
  return {rarity, pity: next};
}

export function gachaPull(bannerId, {pity = {sr: 0, ssr: 0}, owned = new Set(), count = 1, rng, economy = loadEconomy(), catalog = loadForms()} = {}) {
  const pools = gachaPools(bannerId, catalog);
  const results = [];
  let state = {sr: pity.sr || 0, ssr: pity.ssr || 0};
  const have = new Set(owned);
  for (let i = 0; i < count; i += 1) {
    const roll = gachaRarity(bannerId, state, rng, economy);
    state = roll.pity;
    let rarity = roll.rarity;
    while (!pools[rarity]?.length) rarity = {N: 'R', R: 'SR', SR: 'SSR', SSR: 'SR'}[rarity];
    const pool = pools[rarity];
    const pick = pool[Math.floor(rng() * pool.length)];
    const dup = have.has(pick.itemId);
    const shards = dup ? economy.dupShards[rarity] : 0;
    have.add(pick.itemId);
    results.push({...pick, rarity, dup, shards, shardTo: dup ? (pick.kind === 'form' ? pick.itemId : 'any') : null});
  }
  return {results, pity: state};
}

// firstTen：每个池第一次十连半价（新手礼，一生一次）。
export function bannerCost(bannerId, count, economy = loadEconomy(), {tensDone = 0} = {}) {
  const cost = economy.gacha[bannerId]?.cost;
  if (!cost) return null;
  if (count === 10) return (tensDone === 0 && cost.firstTen) || cost.ten || null;
  if (count === 1) return cost.single;
  return null;
}
