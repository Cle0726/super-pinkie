#!/usr/bin/env node
// 碧琪上岸记数值模拟器：三种玩家 × 35 天（北京时间 2026-11-08 起，含立冬→小雪→大雪切换）。
// 奖励全部通过 learning-game-economy.mjs 算，读同一份 learning-game-economy.json。
// 用法：node economy-sim.mjs [--json]；测试：node --test tests/learning-game-economy-sim.test.mjs
import {fileURLToPath} from 'node:url';
import * as E from '../../services/mode-architecture/learning-game-economy.mjs';

const START = '2026-11-08';
export const TERMS = [
  {term: 'lidong', from: '2026-11-07', to: '2026-11-21'},
  {term: 'xiaoxue', from: '2026-11-22', to: '2026-12-06'},
  {term: 'daxue', from: '2026-12-07', to: '2026-12-20'},
];
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const termOf = date => TERMS.find(t => date >= t.from && date <= t.to)?.term || null;

export const PROFILES = {
  light: {answers: 40, sets: 2, lessons: 0, hunts: 0, quests: 1, weekly: false, acc: 0.72, nodeRate: 0.15, guardEvery: 0, exams: [], examScore: () => 0},
  normal: {answers: 120, sets: 5, lessons: 1, hunts: 3, quests: 3, weekly: true, acc: 0.78, nodeRate: 0.5, guardEvery: 5, exams: [6, 13, 20, 27, 34], examScore: d => Math.min(80, 52 + d)},
  grinder: {answers: 264, sets: 11, lessons: 2, hunts: 7, quests: 3, weekly: true, acc: 0.8, nodeRate: 1, guardEvery: 3, exams: [4, 7, 11, 14, 18, 21, 25, 28, 32, 34], examScore: d => Math.min(88, 55 + d)},
};

function catalog() {
  const {forms, items} = E.loadForms();
  const buyableForms = forms.filter(f => !f.source.every(s => s.startsWith('boss:') || s.startsWith('achievement:') || s === 'start'));
  const sellItems = items.filter(i => !i.notForSale);
  return {forms, items, buyableForms, sellItems, total: buyableForms.length + sellItems.length};
}

export function simulate(profileName, {days = 35, seed = 7} = {}) {
  const P = PROFILES[profileName];
  const eco = E.loadEconomy();
  const cat = catalog();
  const rng = E.mulberry32(seed + profileName.length * 1000);
  const owned = new Set(['daily']);
  const wallet = {stars: 0, seals: 0, any: 0, shards: {}};
  const pity = {star: {sr: 0, ssr: 0}, seal: {sr: 0, ssr: 0}};
  let equipped = 'daily';
  let streak = 0;
  let captures = 0;
  let pendingWins = 0;
  let litNodes = [];
  let gold = 0;
  let guardBest = null;
  let weekSeals = 0;
  const log = [];
  const firsts = {};
  const balances = [];
  const targets = [];
  const ownedAt = {};
  const weeklyBuys = {};

  const form = () => E.formById(equipped);
  const has = id => owned.has(id);
  const pay = price => {
    if ((price.stars || 0) > wallet.stars || (price.seals || 0) > wallet.seals) return false;
    wallet.stars -= price.stars || 0;
    wallet.seals -= price.seals || 0;
    return true;
  };
  const gain = (stars = 0, seals = 0) => { wallet.stars += stars; wallet.seals += seals; };
  const take = (id, day, how) => {
    if (owned.has(id)) return;
    owned.add(id);
    const f = E.formById(id);
    if (f) {
      firsts[f.rarity] ??= day;
      if (f.rarity === 'R' || f.rarity === 'SR' || f.rarity === 'SSR' || f.rarity === 'limited') log.push(`d${day + 1} ${how} ${f.name}`);
      if (f.bonus.kind !== 'none' && rankForm(f) > rankForm(E.formById(equipped))) equipped = id;
    }
  };
  // 装备偏好：会肝的人装加成最贴合自己的；这里简单按稀有度
  const rankForm = f => ({N: 0, R: 1, SR: 2, limited: 2.5, SSR: 3})[f?.rarity] ?? 0;

  const tens = {star: 0, seal: 0};
  function pull(banner, count, day) {
    const cost = E.bannerCost(banner, count, eco, {tensDone: tens[banner]});
    if (!cost || !pay(cost)) return false;
    const out = E.gachaPull(banner, {pity: pity[banner], owned, count, rng, economy: eco, guaranteeForm: count === 10 && tens[banner] === 0});
    if (count === 10) tens[banner] += 1;
    pity[banner] = out.pity;
    for (const r of out.results) {
      if (r.dup || r.kind === 'shards') { if (r.shardTo === 'any') wallet.any += r.shards; else wallet.shards[r.shardTo] = (wallet.shards[r.shardTo] || 0) + r.shards; }
      else take(r.itemId, day, `扭蛋${r.rarity}`);
    }
    return true;
  }

  function nextTarget(date) {
    // 心愿单：下一个想要的东西（和购买策略一致）
    const term = termOf(date);
    const lim = cat.forms.find(f => f.season === term);
    if (profileName !== 'light' || has('learning')) {
      if (lim && !has(lim.id)) return E.formPrice(lim, eco).stars;
    }
    const R = cat.forms.find(f => f.rarity === 'R' && f.source.includes('shop') && !has(f.id));
    if (R && (profileName === 'light' || !Object.values(firsts).length || firsts.R == null)) return E.formPrice(R, eco).stars;
    if (firsts.SR == null) return tens.star ? eco.gacha.star.cost.ten.stars : eco.gacha.star.cost.firstTen.stars;
    const SR = cat.forms.find(f => f.rarity === 'SR' && f.source.includes('shop') && !has(f.id));
    const SSR = cat.forms.find(f => f.rarity === 'SSR' && f.source.includes('seal-shop') && !has(f.id));
    if (SSR && wallet.seals >= eco.prices.form.SSR.seals) return eco.prices.form.SSR.stars;
    if (SR) return E.formPrice(SR, eco).stars;
    return eco.gacha.star.cost.ten.stars;
  }

  function spend(day, date) {
    const week = Math.floor(day / 7);
    const term = termOf(date);
    const lim = cat.forms.find(f => f.season === term && !has(f.id));
    const buyForm = f => f && pay(E.formPrice(f, eco)) && (take(f.id, day, '商店'), true);
    const cheapItem = () => cat.sellItems.find(i => !has(i.id) && E.itemPrice(i, eco).stars <= 300);
    if (profileName === 'light') {
      const R = cat.forms.find(f => f.rarity === 'R' && f.source.includes('shop') && !has(f.id));
      if (R && !firsts.R) buyForm(R);
      if (!weeklyBuys[week] && wallet.stars >= 200 + (firsts.R == null ? 0 : 0)) {
        // 每周一件小东西，但不拖慢第一只 R 形态太多：存款过 R 价一半以后才买
        if (firsts.R != null || wallet.stars >= 200) {
          const it = cheapItem();
          if (it && pay(E.itemPrice(it, eco))) { owned.add(it.id); weeklyBuys[week] = it.name; }
        }
      }
      return;
    }
    // 金印：没有 SSR 时去金印池（20 抽保底），有了以后攒着买金印专柜
    while (firsts.SSR == null && wallet.seals >= 2 && pull('seal', 1, day)) {}
    let guard = 0;
    while (guard++ < 60) {
      const R = cat.forms.find(f => f.rarity === 'R' && f.source.includes('shop') && !has(f.id));
      if (firsts.R == null) { if (buyForm(R)) continue; break; }
      if (lim) { if (buyForm(lim)) continue; if (profileName !== 'grinder') break; }
      if (firsts.SR == null) { if (pull('star', 10, day)) continue; break; }
      const SSR = cat.forms.find(f => f.rarity === 'SSR' && f.source.includes('seal-shop') && !has(f.id));
      if (SSR && wallet.seals >= eco.prices.form.SSR.seals) { if (buyForm(SSR)) continue; if (profileName !== 'grinder') break; }
      if (wallet.seals >= 2 && profileName === 'grinder' && wallet.seals > eco.prices.form.SSR.seals + 2) { if (pull('seal', 1, day)) continue; }
      const SR = cat.forms.find(f => f.rarity === 'SR' && f.source.includes('shop') && !has(f.id));
      if (SR) { if (buyForm(SR)) continue; if (profileName !== 'grinder') break; }
      if (R) { if (buyForm(R)) continue; }
      if (profileName === 'grinder') {
        const it = cat.sellItems.find(i => !has(i.id) && E.itemPrice(i, eco).stars <= wallet.stars);
        if (it && pay(E.itemPrice(it, eco))) { owned.add(it.id); continue; }
        if (pull('star', 10, day)) continue;
      } else {
        const it = cat.sellItems.find(i => !has(i.id) && E.itemPrice(i, eco).stars <= 900);
        if (it && wallet.stars > 2 * nextTarget(date) && pay(E.itemPrice(it, eco))) { owned.add(it.id); continue; }
      }
      break;
    }
  }

  for (let day = 0; day < days; day += 1) {
    const date = addDays(START, day);
    if (day % 7 === 0) weekSeals = 0;
    let dayStars = 0; // 进星星罐的（pact 的今日星星）
    const perSet = Math.round(P.answers / P.sets);
    let ults = 0;
    for (let s = 0; s < P.sets; s += 1) {
      let combo = 0;
      let correct = 0;
      for (let q = 0; q < perSet; q += 1) {
        const ok = rng() < P.acc;
        if (ok) {
          correct += 1;
          combo += 1;
          const a = E.answerStars({eligible: true, correct: true, form: form(), economy: eco}).value;
          const c = E.comboStars(combo, {form: form(), economy: eco});
          if (c.ult) ults += 1;
          gain(a + c.stars);
          dayStars += a + c.stars;
        } else combo = 0;
      }
      for (const part of E.setStars({scored: perSet, correct, firstSetToday: s === 0, form: form(), economy: eco})) { gain(part.value); dayStars += part.value; }
      const g = E.giftRoll(rng, eco);
      if (g?.kind === 'stars') gain(g.amount);
    }
    if (dayStars >= 30) gain(eco.earn.jarFull);
    for (let l = 0; l < P.lessons; l += 1) gain(E.boosted(eco.earn.lessonPass, {event: 'lesson', form: form(), economy: eco}).value);
    // 节点点亮 → 3 天后复测金章
    if (rng() < P.nodeRate) { gain(eco.earn.nodeLit); litNodes.push(day); }
    const ripe = litNodes.filter(d => day - d >= eco.earn.nodeGoldGapDays);
    litNodes = litNodes.filter(d => day - d < eco.earn.nodeGoldGapDays);
    for (const _ of ripe) if (rng() < 0.7) { gain(eco.earn.nodeGold, eco.earn.nodeGoldSeals); gold += 1; }
    // 讨伐：打赢 ⭐，两次打赢（隔 ≥3 天）收服
    const wins = Math.round(P.hunts * 0.75);
    for (let h = 0; h < wins; h += 1) gain(E.boosted(eco.earn.huntWin, {event: 'huntWin', form: form(), economy: eco}).value);
    if (day >= 3) pendingWins += wins;
    while (pendingWins >= 2) {
      pendingWins -= 2;
      captures += 1;
      const cr = E.captureReward({evolved: rng() < 0.3 ? 1 : 0, form: form(), economy: eco});
      gain(cr.stars);
      wallet.any += cr.shards;
      if (captures % eco.earn.capturesPerSeal === 0) gain(0, 1);
    }
    if (P.guardEvery && day % P.guardEvery === P.guardEvery - 1) {
      const pct = rng() < 0.25 ? 100 : 70 + Math.floor(rng() * 30);
      const gr = E.guardReward({pct, best: null, form: form(), economy: eco});
      gain(gr.stars, gr.seals);
      guardBest = pct;
    }
    if (P.exams.includes(day)) {
      const ex = E.examReward({score: P.examScore(day), sealsUsedThisWeek: weekSeals, form: form(), economy: eco});
      gain(ex.stars, ex.seals);
      if (ex.sealCounted) weekSeals += 1;
    }
    const qn = Math.min(3, P.quests);
    for (let i = 0; i < qn; i += 1) gain(E.boosted(eco.earn.quests[i], {event: 'quest', form: form(), economy: eco}).value);
    if (qn === 3) {
      const opens = form()?.bonus?.kind === 'chestExtra' ? 2 : 1;
      for (let o = 0; o < opens; o += 1) {
        const c = E.chestRoll(rng, eco);
        if (c.kind === 'stars') gain(c.amount);
        if (c.kind === 'shards') wallet.any += 1;
      }
    }
    if (P.weekly && day % 7 === 6) gain(eco.earn.weekly, eco.earn.weeklySeals);
    streak += 1;
    const sr = E.streakReward({days: streak, form: form(), economy: eco});
    if (sr) gain(sr.stars, sr.seals);
    spend(day, date);
    balances.push(wallet.stars);
    targets.push(nextTarget(date));
    if (day === 13) ownedAt[14] = ownedFraction();
    if (day === days - 1) ownedAt[days] = ownedFraction();
  }
  function ownedFraction() {
    const n = cat.buyableForms.filter(f => owned.has(f.id)).length + cat.sellItems.filter(i => owned.has(i.id)).length;
    return n / cat.total;
  }
  const avg = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  return {
    profile: profileName, firsts, log, weeklyBuys, wallet, captures, gold, owned: [...owned],
    ownedAt, avgBalance: avg(balances), avgTarget: avg(targets),
    limitedBought: TERMS.filter(t => owned.has(t.term)).map(t => t.term),
  };
}

export function gachaMonteCarlo(bannerId, pulls = 100_000, seed = 11) {
  const rng = E.mulberry32(seed);
  let pity = {sr: 0, ssr: 0};
  const count = {N: 0, R: 0, SR: 0, SSR: 0};
  let maxSinceSsr = 0;
  let maxSinceSr = 0;
  let sinceSsr = 0;
  let sinceSr = 0;
  for (let i = 0; i < pulls; i += 1) {
    const roll = E.gachaRarity(bannerId, pity, rng);
    pity = roll.pity;
    count[roll.rarity] += 1;
    sinceSsr = roll.rarity === 'SSR' ? 0 : sinceSsr + 1;
    sinceSr = roll.rarity === 'SSR' || roll.rarity === 'SR' ? 0 : sinceSr + 1;
    maxSinceSsr = Math.max(maxSinceSsr, sinceSsr);
    maxSinceSr = Math.max(maxSinceSr, sinceSr);
  }
  return {pulls, count, ssrRate: count.SSR / pulls, srPlusRate: (count.SR + count.SSR) / pulls, maxDrySsr: maxSinceSsr, maxDrySr: maxSinceSr};
}

export function goals() {
  const eco = E.loadEconomy();
  const light = simulate('light');
  const normal = simulate('normal');
  const grinder = simulate('grinder');
  const weeks = [0, 1, 2, 3, 4];
  const star = gachaMonteCarlo('star');
  const seal = gachaMonteCarlo('seal');
  const lidongDeadline = 13; // 11-21 是第 14 天（0 起算 13）
  return {
    light, normal, grinder, star, seal,
    checks: {
      '1a 轻度每周至少买一件 ≥200⭐': weeks.every(w => light.weeklyBuys[w]),
      '1b 轻度 35 天内拿到 R 形态': light.firsts.R != null,
      '2a 正常第 5 天前买得起第一个 R': normal.firsts.R != null && normal.firsts.R <= 4,
      '2b 正常第 12 天前拿到第一个 SR': normal.firsts.SR != null && normal.firsts.SR <= 11,
      '2c 正常 35 天内至少 1 个 SSR': normal.firsts.SSR != null,
      '2d 正常在立冬窗口内买下立冬限定': normal.limitedBought.includes('lidong') && normal.log.some(l => /立冬/.test(l) && Number(l.match(/^d(\d+)/)[1]) - 1 <= lidongDeadline),
      '3a 肝帝第 14 天拥有 ≤ 60%': grinder.ownedAt[14] <= 0.6,
      '3b 肝帝第 35 天拥有 ≤ 90%': grinder.ownedAt[35] <= 0.9,
      '4 正常平均余额 < 心愿目标价 ×2': normal.avgBalance < 2 * normal.avgTarget,
      '5a 星星池 SSR 率合理（1.5%~4%）且 50 抽必出': star.ssrRate > eco.gacha.star.rates.SSR && star.ssrRate < 0.04 && star.maxDrySsr < eco.gacha.star.pity.ssr,
      '5b 星星池 10 抽必出 SR+': star.maxDrySr < eco.gacha.star.pity.sr,
      '5c 金印池 20 抽必出 SSR、SSR 率 ≥ 5%': seal.maxDrySsr < eco.gacha.seal.pity.ssr && seal.ssrRate >= eco.gacha.seal.rates.SSR,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const g = goals();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(g, null, 1)); process.exit(0); }
  for (const p of ['light', 'normal', 'grinder']) {
    const r = g[p];
    console.log(`\n== ${p}  firsts(0起)=${JSON.stringify(r.firsts)} 余额=${r.wallet.stars}⭐ ${r.wallet.seals}🟡 收服=${r.captures} 金章=${r.gold} 拥有14d=${(r.ownedAt[14] * 100).toFixed(0)}% 35d=${(r.ownedAt[35] * 100).toFixed(0)}% 平均余额=${r.avgBalance.toFixed(0)} 平均目标=${r.avgTarget.toFixed(0)}`);
    console.log('  ' + r.log.join(' | '));
    if (p === 'light') console.log('  每周:', JSON.stringify(r.weeklyBuys));
  }
  console.log(`\nstar: SSR ${(g.star.ssrRate * 100).toFixed(2)}% SR+ ${(g.star.srPlusRate * 100).toFixed(2)}% 最长无SSR ${g.star.maxDrySsr} 最长无SR+ ${g.star.maxDrySr}`);
  console.log(`seal: SSR ${(g.seal.ssrRate * 100).toFixed(2)}% 最长无SSR ${g.seal.maxDrySsr}`);
  for (const [k, v] of Object.entries(g.checks)) console.log(`${v ? '过 ' : '没过'} ${k}`);
}
