// 碧琪上岸记：错题怪。出生（背一背 / 刷题 / 守关 / 考试答错）→ 潜伏（1/3/7 天）→ 讨伐（模型出新变体）→
// 隔 ≥3 天两次打赢 = 收服。讨伐失败 = 进化一级（收服时奖励更多）。同一考点再错 = 升级，不重复刷怪。
import {randomUUID} from 'node:crypto';
import * as E from './learning-game-economy.mjs';
import {MONSTER_NAME_RULES, VARIANT_RULES, blindCheck, fold, hashOf, modelJson, validChoice, validMonsterName, withTimeout} from './learning-game-content.mjs';

const DAY = 86400000;
export const HUNT_BUDGET_MS = 40000; // 讨伐开始时现场出变体的总预算；超过就先用原题（标 local）
export const SPECIES = {
  listening: [['echo-bat', '回声蝙蝠'], ['shell-crab', '海螺小蟹']],
  vocab: [['block-golem', '字母积木魔像'], ['sticky-ghost', '便利贴幽灵'], ['quiz-shroom', '题目蘑菇']],
  grammar: [['ink-slime', '迷糊史莱姆'], ['tangle-yarn', '时态毛线团'], ['clock-beetle', '时钟甲虫']],
  reading: [['bookworm', '书虫'], ['paper-fox', '纸狐']],
  translation: [['lost-crane', '迷路纸鹤'], ['bridge-troll', '小桥怪']],
  writing: [['inkpot-imp', '墨水瓶小鬼'], ['eraser-gnome', '橡皮小精灵'], ['shaving-hog', '卷笔刀刺猬']],
  other: [['fog-puff', '迷雾团']],
};
// 这本游戏是英语 B 级。专升本 C 语言、其它科目的错题不能进讨伐。
const NOT_ENGLISH = /c语言|循环结构|do-while|printf|#include|\bscanf\b|\bint\s+\w|\bfor\s*\(|\bwhile\s*\(|\bmain\s*\(/i;
const OTHER_BANK = /(?:^|:)(?:zsb-)?c\d+-\d+/i;
export function examMonster(input = {}) {
  const blob = `${input.subject || ''} ${input.topic || ''} ${input.key || ''} ${input.question || input.seed?.question || ''}`;
  if (NOT_ENGLISH.test(blob) || OTHER_BANK.test(String(input.key || input.bankId || input.id || ''))) return false;
  const subject = String(input.subject || '').trim();
  if (subject && !/英语|english|pretco|cet|b级/i.test(subject)) return false;
  return true;
}
export function regionOf(text = '') {
  const t = String(text).toLowerCase();
  if (/听力|listen/.test(t)) return 'listening';
  if (/翻译|translat|英译汉|汉译英/.test(t)) return 'translation';
  if (/写作|作文|writing|书信|应用文/.test(t)) return 'writing';
  if (/阅读|reading|passage|短文/.test(t)) return 'reading';
  if (/语法|时态|[现过将完]在?时|进行时|grammar|tense|从句|语态|非谓语|主谓|介词|冠词|结构|比较级|虚拟/.test(t)) return 'grammar';
  if (/词汇|单词|vocab|word|生词|词组|搭配|英语|english|pretco|cet/.test(t)) return 'vocab';
  return 'other';
}
export function speciesFor(key, region) {
  const list = SPECIES[region] || SPECIES.other;
  const pick = list[parseInt(hashOf(key).slice(0, 6), 16) % list.length];
  return {species: pick[0], speciesName: pick[1]};
}
const clean = (v, n = 400) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);

export class GameMonsters {
  constructor(game) {
    this.game = game;
    this.naming = null;
    this.preparing = null;
    game.modules.monsters = this;
  }
  get economy() { return this.game.economy; }
  now() { return this.game.now(); }

  ensure(state) {
    state.monsters ||= {list: {}, captured: 0};
    return state.monsters;
  }

  // 生出或升级一只怪。key = 考点 / 卡片的稳定键（同 key 合并）。
  spawn(state, {key, subject = '', topic = '', question = '', answer = '', options = null, source = {type: 'drill', id: ''}, node = null} = {}) {
    const box = this.ensure(state);
    if (!examMonster({subject, topic, question, key})) return null;
    const k = clean(key, 160) || `q:${hashOf(question)}`;
    const now = this.now();
    const lurk = this.economy.monsters.lurkDays;
    const existing = Object.values(box.list).find(m => m.key === k && m.state !== 'captured');
    if (existing) {
      existing.level = Math.min(this.economy.monsters.maxLevel, existing.level + 1);
      existing.dueAt = now + lurk[0] * DAY;
      existing.state = 'lurking';
      existing.sources.push({...source, at: now});
      existing.sources = existing.sources.slice(-8);
      if (question) existing.seed = {question: clean(question, 800), answer: clean(answer, 300), options: Array.isArray(options) ? options.map(o => clean(o, 200)).slice(0, 6) : null};
      return existing;
    }
    const region = regionOf(`${subject} ${topic} ${question}`);
    const sp = speciesFor(k, region);
    const id = `m-${randomUUID().slice(0, 12)}`;
    const shortTopic = clean(topic || subject || '这个考点', 10);
    const m = {
      id, key: k, species: sp.species, name: `${shortTopic} · ${sp.speciesName}`, blurb: `它藏着「${shortTopic}」的一个小坑，过几天回来找你。`, named: 'local',
      level: 1, evolved: 0, region, node, subject: clean(subject, 40), topic: clean(topic, 60), bornAt: now, dueAt: now + lurk[0] * DAY, stage: 0,
      wins: [], state: 'lurking', sources: [{...source, at: now}],
      seed: {question: clean(question, 800), answer: clean(answer, 300), options: Array.isArray(options) ? options.map(o => clean(o, 200)).slice(0, 6) : null},
    };
    box.list[id] = m;
    this.kickNaming();
    this.kickVariantsSoon();
    return m;
  }

  refresh(state) {
    const box = this.ensure(state);
    const now = this.now();
    for (const m of Object.values(box.list)) if (m.state === 'lurking' && m.dueAt <= now) m.state = 'due';
    return box;
  }

  // 刷题 / 学习台题卡答错：不在调用方挂钩子，从作答记录里懒生成（按 attempt id 幂等）。
  syncAttempts(state) {
    let attempts = [];
    try { attempts = this.game.store.allAttempts?.() || []; } catch { return; }
    const cutoff = this.now() - 45 * DAY;
    for (const a of attempts) {
      if (a?.result?.correct !== false || (a.createdAt || 0) < cutoff || a.verifiedBy) continue;
      const ev = `spawn:att:${a.id}`;
      if (state.ledger[ev]) continue;
      const q = a.question || {};
      if (!examMonster({subject: q.subject, topic: q.topic, question: q.question, key: q.bankId || q.id})) continue;
      const options = Array.isArray(q.options) ? q.options.map(o => (typeof o === 'string' ? o : o?.label || o?.text || '')) : null;
      this.spawn(state, {key: q.bankId ? `bank:${q.bankId}` : `att:${hashOf(q.question || a.id)}`, subject: q.subject || '', topic: q.topic || '',
        question: q.question || '', answer: Array.isArray(q.correctAnswer) ? q.correctAnswer.join(' / ') : (q.correctAnswer || q.answer || ''), options, source: {type: 'question', id: a.id}});
      state.ledger[ev] = {at: this.now(), ids: []};
    }
  }

  spawnFromDrill(state, {item, refs = []} = {}) {
    const ref = refs[0];
    if (!ref || ref.book === 'hunt') return null;
    const reveal = item.reveal || {};
    return this.spawn(state, {key: ref.key, subject: item.subject, topic: item.topic, question: reveal.question || item.prompt || '',
      answer: reveal.answer || '', options: Array.isArray(item.options) ? item.options : null, source: {type: 'drill', id: item.itemId}});
  }

  summary(state) {
    const box = this.refresh(state);
    const list = Object.values(box.list).filter(examMonster);
    return {active: list.filter(m => m.state !== 'captured').length, due: list.filter(m => m.state === 'due').length, captured: list.filter(m => m.state === 'captured').length};
  }

  view(m) {
    return {id: m.id, species: m.species, name: m.name, blurb: m.blurb, level: m.level, evolved: m.evolved, node: m.node, subject: m.subject, region: m.region,
      bornAt: m.bornAt, dueAt: m.dueAt, wins: m.wins.length, state: m.state};
  }

  list({filter = 'active'} = {}) {
    const out = this.game.mutate(state => {
      this.syncAttempts(state);
      const box = this.refresh(state);
      return Object.values(box.list).filter(examMonster)
        .filter(m => (filter === 'captured' ? m.state === 'captured' : filter === 'due' ? m.state === 'due' : m.state !== 'captured'))
        .sort((a, b) => a.dueAt - b.dueAt).map(m => this.view(m));
    });
    return {monsters: out};
  }

  // ---------- 讨伐 ----------
  // 变体题：这个模型出一道 + 盲答复核要 20 s 左右，所以怪一出生就在后台把「下一次讨伐」的变体备好（m.prepared，按回合 round 对号），
  // 讨伐开始时直接用；没备好才现场出（总预算 HUNT_BUDGET_MS），再不行退回原题换选项顺序（标 local）。
  round(m) { return `${m.wins.length}-${m.evolved}-${hashOf(m.seed?.question || '')}`; }
  async generateVariant(m) {
    const rm = this.game.requestModel;
    const seed = m.seed || {};
    if (!rm || !seed.question) return null;
    const used = (m.usedStems || []).map(fold);
    for (let i = 0; i < 2; i += 1) {
      const r = await modelJson(rm, VARIANT_RULES, {subject: m.subject, topic: m.topic, question: seed.question, answer: seed.answer,
        note: m.wins.length ? '先生已经打赢过一次，换一个角度' : '', avoid: (m.usedStems || []).slice(-4)}, {
        validate: v => { const c = validChoice(v, {seedQuestion: seed.question}); return c && !used.includes(fold(c.stem)) ? c : null; }, timeoutMs: 60000, maxTokens: 1200,
      });
      if (!r) break;
      const check = await blindCheck(rm, r.value);
      if (check === false) continue; // 盲答对不上：答案可能不唯一，重出
      return {...r.value, source: 'model', verified: check === true};
    }
    return null;
  }
  localVariant(m) {
    // 离线兜底：原题换选项顺序（不是新变体，标 local；前端显示「碧琪离线中，先用原题」）
    const seed = m.seed || {};
    if (seed.options?.length >= 2 && seed.answer) {
      const idx = seed.options.findIndex(o => fold(o) === fold(seed.answer));
      if (idx >= 0) {
        const rng = E.mulberry32(E.seedFrom(m.id, m.wins.length, m.level));
        const order = seed.options.map((_, i) => i).sort(() => rng() - 0.5);
        return {stem: seed.question, options: order.map(i => seed.options[i]), answer: order.indexOf(idx), why: '', point: m.topic, source: 'local', verified: false};
      }
    }
    return null;
  }
  // 备好的变体（回合对得上）→ 现场出（成功也存成 prepared）→ null
  async variantFor(m) {
    const round = this.round(m);
    if (m.prepared?.round === round) { const {round: _r, ...v} = m.prepared; return v; }
    const v = await this.generateVariant(m);
    if (v) this.game.mutate(state => { const live = this.ensure(state).list[m.id]; if (live && this.round(live) === round) live.prepared = {...v, round}; });
    return v;
  }
  kickVariantsSoon() {
    if (!this.game.requestModel) return;
    const t = setTimeout(() => this.kickVariants(), 0);
    t.unref?.();
  }
  // 后台按到期顺序给没备好的怪出变体；一次最多 6 只，失败的 10 分钟内不再试。
  kickVariants() {
    if (this.preparing || !this.game.requestModel) return this.preparing;
    this.preparing = (async () => {
      for (let n = 0; n < 6; n += 1) {
        const now = this.now();
        const list = Object.values(this.ensure(this.game.read()).list)
          .filter(m => examMonster(m) && m.state !== 'captured' && m.seed?.question && m.prepared?.round !== this.round(m) && !(m.variantTriedAt && now - m.variantTriedAt < 10 * 60000))
          .sort((a, b) => a.dueAt - b.dueAt);
        const target = list[0];
        if (!target) break;
        const round = this.round(target);
        const v = await this.generateVariant(target).catch(() => null);
        this.game.mutate(state => {
          const m = this.ensure(state).list[target.id];
          if (!m) return;
          m.variantTriedAt = this.now();
          if (v && this.round(m) === round) m.prepared = {...v, round};
        });
      }
    })().catch(() => {}).finally(() => { this.preparing = null; });
    return this.preparing;
  }

  async huntStart({monsterIds = null, requestId, sessionKey = ''} = {}) {
    if (!requestId) throw new Error('缺少 requestId');
    const done = this.game.read().requests[`hunt.start:${requestId}`];
    if (done) return done.result;
    const picked = this.game.mutate(state => {
      this.syncAttempts(state);
      const box = this.refresh(state);
      let list = Array.isArray(monsterIds) && monsterIds.length ? monsterIds.map(id => box.list[id]).filter(m => m && examMonster(m) && m.state !== 'captured')
        : Object.values(box.list).filter(m => examMonster(m) && m.state === 'due').sort((a, b) => b.level - a.level || a.dueAt - b.dueAt);
      return list.slice(0, 8).map(m => ({...m}));
    });
    if (!picked.length) throw new Error('现在没有到期的错题怪，过几天它们会回来');
    const variants = await Promise.all(picked.map(async m => (await withTimeout(this.variantFor(m).catch(() => null), HUNT_BUDGET_MS, null)) || this.localVariant(m)));
    return this.game.once('hunt.start', requestId, state => {
      const items = [];
      picked.forEach((m, i) => {
        const v = variants[i];
        if (!v) return;
        const live = state.monsters?.list?.[m.id];
        if (live && v.source === 'model') {
          live.usedStems = [...(live.usedStems || []), clean(v.stem, 200)].slice(-6);
          delete live.prepared;
        }
        items.push({itemId: `h${items.length + 1}`, cardRef: {book: 'hunt', monsterId: m.id}, mode: 'choice', subject: m.subject, topic: m.topic, strength: 0,
          prompt: v.stem, options: v.options, answer: v.answer, reveal: {question: v.stem, answer: v.options[v.answer], ...(v.why ? {extra: v.why} : {})}, keys: [],
          monster: this.view(m), variant: {source: v.source, verified: v.verified}});
      });
      if (!items.length) throw new Error('碧琪这会儿出不了变体题，等一下再来讨伐');
      const session = {sessionId: `hunt-${randomUUID()}`, sessionKey: String(sessionKey || 'agent:learning:notes-library'), source: 'hunt', scope: {kind: 'hunt'},
        size: items.length, createdAt: this.now(), items, graded: {}, learned: {}, answers: [], jarAtStart: 0, finished: null};
      this.game.store.drill?.save?.(session);
      state.drill[session.sessionId] = {at: this.now(), source: 'hunt', eligible: {}, combo: 0, maxCombo: 0, seen: [], ults: 0, writeAll: true};
      return {sessionId: session.sessionId, source: 'hunt', items, pending: 0, dueLeft: 0, settings: {soundDefault: true, size: items.length}};
    });
  }

  // 背一背里认 book:'hunt' 的题，答完推进怪的状态（在 game.onDrillAnswer 的同一次写入里）。
  onHuntAnswer(state, {session, item, ok, firstTry} = {}) {
    const box = this.ensure(state);
    const m = box.list[item.cardRef?.monsterId];
    if (!m || m.state === 'captured') return [];
    const ev = `hunt:${session.sessionId}:${item.itemId}`;
    if (state.ledger[ev]) return [];
    const now = this.now();
    const form = this.game.form(state);
    const awards = [];
    if (ok && firstTry !== false) {
      state.stats.huntWins += 1;
      this.game.day(state).huntWins += 1;
      awards.push({kind: 'stars', amount: E.boosted(this.economy.earn.huntWin, {event: 'huntWin', form, economy: this.economy}).value, reason: `讨伐 ${m.name}`, fx: 'medium'});
      const gap = this.economy.monsters.captureGapDays * DAY;
      const prev = m.wins[m.wins.length - 1];
      // 离线兜底用的是原题（只换了选项顺序，source = local）：背原题答案就能赢。给讨伐星、照常冷却，但不算收服进度。
      if (item.variant?.source === 'local') {
        awards[0].reason = `讨伐 ${m.name}（原题，不算收服进度）`;
        m.state = 'lurking';
        m.dueAt = now + gap;
      } else if (prev && now - prev >= gap) {
        m.state = 'captured';
        m.capturedAt = now;
        state.stats.captures += 1;
        this.game.day(state).captures += 1;
        if (m.evolved >= 2) state.stats.capturesEvolved2 += 1;
        const cr = E.captureReward({evolved: m.evolved, form, economy: this.economy});
        awards.push({kind: 'capture', itemId: m.id, reason: `收服了 ${m.name}`, fx: 'big'});
        awards.push({kind: 'stars', amount: cr.stars, reason: `收服 ${m.name}${m.evolved ? `（进化 ${m.evolved} 次）` : ''}`, fx: 'big'});
        awards.push({kind: 'shards', amount: cr.shards, itemId: 'any', reason: '收服掉落：万能碎片', fx: 'medium'});
        if (state.stats.captures % this.economy.earn.capturesPerSeal === 0) awards.push({kind: 'seals', amount: 1, reason: `累计收服 ${state.stats.captures} 只`, fx: 'big'});
      } else {
        m.wins.push(now);
        m.wins = m.wins.slice(-4);
        m.state = 'lurking';
        m.dueAt = now + gap;
      }
    } else {
      // 失败 = 进化（收服时奖励更多）；明天再来
      m.evolved += 1;
      m.level = Math.min(this.economy.monsters.maxLevel, m.level + 1);
      m.wins = [];
      m.state = 'lurking';
      m.dueAt = now + DAY;
    }
    this.kickVariantsSoon(); // 回合变了：后台备下一次的变体
    return this.game.grant(state, ev, {type: 'hunt', id: m.id}, awards);
  }

  // 后台给新怪起名（模型）；失败就保留本地名。
  kickNaming() {
    if (this.naming || !this.game.requestModel) return;
    this.naming = (async () => {
      for (let n = 0; n < 12; n += 1) {
        const target = Object.values(this.ensure(this.game.read()).list).find(m => m.named === 'local' && !m.nameTried);
        if (!target) break;
        const r = await modelJson(this.game.requestModel, MONSTER_NAME_RULES, {subject: target.subject, topic: target.topic, question: target.seed?.question || '', answer: target.seed?.answer || '', species: target.species}, {validate: validMonsterName, retries: 1, timeoutMs: 20000, maxTokens: 300}).catch(() => null);
        this.game.mutate(state => {
          const m = this.ensure(state).list[target.id];
          if (!m) return;
          m.nameTried = true;
          if (r) { m.name = r.value.name; m.blurb = r.value.blurb; m.named = 'model'; }
        });
      }
    })().finally(() => { this.naming = null; });
  }
}
