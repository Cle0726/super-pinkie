// 碧琪上岸记：上岸之书（考点地图）+ 节点状态 + 守关战。
// 地图由内置模型按 PRETCO_B_FORMAT + 用户的真实资料生成并缓存；节点状态全部从真实数据算：
// 迷雾 → 已探索（上过这一课）→ 点亮（这个节点的一组练习 ≥80% 或守关通过）→ 金章（隔 ≥3 天复测仍 ≥80%）。
import {randomUUID} from 'node:crypto';
import * as E from './learning-game-economy.mjs';
import {PRETCO_B_FORMAT, fold, modelJson, validChoice, blindCheck, explainInput} from './learning-game-content.mjs';
import {explainRulesFor, compactExplainRules, markCompactExplain, useCompactExplain, explainRules, validVoicedExplain, explainFailure, EXPLAIN_VERSION} from './learning-explain-voice.mjs';
import {GAME_EXAM} from './learning-game.mjs';
import {examMonster} from './learning-game-monsters.mjs';

const DAY = 86400000;
export const REGIONS = [
  {id: 'listening', name: '听力港', section: 'listening', lesson: {k: 'e1', i: 0}},
  {id: 'vocab', name: '词汇森林', section: 'vocab', lesson: {k: 'e1', i: 0}},
  {id: 'grammar', name: '语法工坊', section: 'vocab', lesson: {k: 'e1', i: 1}},
  {id: 'reading', name: '阅读图书馆', section: 'reading', lesson: {k: 'e2', i: 0}},
  {id: 'translation', name: '翻译桥', section: 'translation', lesson: {k: 'e3', i: 0}},
  {id: 'writing', name: '写作塔', section: 'writing', lesson: {k: 'e5', i: 0}},
];
const LESSON_POINTS = {e1: 2, e2: 5, e3: 2, e4: 3, e5: 1}; // learning-zsb-data 英语每章的考点数
const clean = (v, n = 200) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);

export const WORLD_RULES = `你是碧琪上岸记的关卡设计师兼英语 B 级老师。输入 {"format":B 级官方题型,"regions":[{id,name}],"lessonPoints":可用的课程考点,"learner":{生词样本,笔记标题,错题考点}}。
为每个区域规划一条考点路线（每区 4–6 个节点，按学习顺序，最后一个是守关战），节点要贴合 B 级真题会考的内容，并尽量和 learner 里真实的生词 / 笔记 / 错题挂钩。
只输出 JSON：{"regions":[{"id":"区域 id（必须用输入里的）","nodes":[{"id":"英文短 id，区内唯一","name":"节点名 ≤10 字","summary":"要学什么 ≤40 字","deps":["本区前面节点的 id"],"kind":"lesson|guard","lesson":{"k":"e1-e5","i":考点下标}}]}]}
规则：每区最后一个节点 kind=guard、name 以「守关」开头；其余 kind=lesson；lesson.k/i 只能用 lessonPoints 里有的；不要编造考试分值。`;

export function validWorld(v) {
  const regions = Array.isArray(v?.regions) ? v.regions : [];
  const out = [];
  for (const def of REGIONS) {
    const r = regions.find(x => x?.id === def.id);
    const nodes = Array.isArray(r?.nodes) ? r.nodes : [];
    if (nodes.length < 3 || nodes.length > 8) return null;
    const ids = new Set();
    const list = [];
    nodes.forEach((n, i) => {
      const id = clean(n?.id, 30).replace(/[^\w-]/g, '').toLowerCase();
      if (!id || ids.has(id)) return;
      ids.add(id);
      const k = clean(n?.lesson?.k, 4);
      const li = Number(n?.lesson?.i);
      const lesson = LESSON_POINTS[k] != null && Number.isInteger(li) && li >= 0 && li < LESSON_POINTS[k] ? {k, i: li} : def.lesson;
      list.push({id: `${def.id}:${id}`, name: clean(n?.name, 14), summary: clean(n?.summary, 60), region: def.id, order: i,
        deps: (Array.isArray(n?.deps) ? n.deps : []).map(d => `${def.id}:${clean(d, 30).toLowerCase()}`).filter(d => list.some(x => x.id === d)),
        kind: i === nodes.length - 1 ? 'guard' : 'lesson', refs: {lessonTopic: clean(n?.name, 14), chapterId: lesson.k, i: lesson.i}});
    });
    if (list.length < 3 || list.some(n => !n.name)) return null;
    out.push({id: def.id, name: def.name, order: out.length, art: `world/pretco-b/${def.id}`, nodes: list});
  }
  return {regions: out};
}

// 离线兜底：只用官方题型数据拼出每区的节点（标 local），模型可用后会被替换。
export function localWorld() {
  const regions = REGIONS.map((def, order) => {
    const sec = PRETCO_B_FORMAT.sections.find(s => s.id === def.section);
    const parts = def.id === 'grammar' ? [{id: 'tense', note: '时态和语态'}, {id: 'clause', note: '从句和非谓语'}, {id: 'form', note: '词形变化'}] : sec.parts;
    const nodes = parts.slice(0, 4).map((p, i) => ({id: `${def.id}:${String(p.id).toLowerCase()}`, name: clean(p.note.split('，')[0], 10), summary: clean(p.note, 40), region: def.id, order: i,
      deps: i ? [`${def.id}:${String(parts[i - 1].id).toLowerCase()}`] : [], kind: 'lesson', refs: {lessonTopic: clean(p.note, 14), chapterId: def.lesson.k, i: def.lesson.i}}));
    nodes.push({id: `${def.id}:guard`, name: `守关 · ${def.name}`, summary: `${def.name}的小模考`, region: def.id, order: nodes.length, deps: nodes.map(n => n.id), kind: 'guard', refs: {chapterId: def.lesson.k, i: def.lesson.i}});
    return {id: def.id, name: def.name, order, art: `world/pretco-b/${def.id}`, nodes};
  });
  return {regions};
}

export const GUARD_RULES = `你是英语 B 级出题老师。输入 {"region","format":该区对应的 B 级题型,"nodes":本区考点,"weak":先生的错题考点}。
出一套守关小卷：12 道四选一题，覆盖本区考点、难度对标 B 级真题（词汇 2500 以内、句子简单），每题答案唯一、干扰项是常见错误。听力区：题干写成「[听力原文] … 问题：…」的文字版。
只输出 JSON：{"items":[{"stem":"","options":["","","",""],"answer":0-3,"why":"一句中文解析","point":"考点 ≤12 字"}]}`;

export class GameWorld {
  constructor(game) {
    this.game = game;
    this.generating = new Map();
    this.explaining = new Map();
    game.modules.world = this;
  }
  get economy() { return this.game.economy; }
  now() { return this.game.now(); }

  ensure(state) {
    state.world ||= {};
    state.nodes ||= {};
    state.guards ||= {};
    state.nodeSessions ||= {};
    return state;
  }

  // ---------- 地图 ----------
  world({exam = GAME_EXAM} = {}) {
    const state = this.ensure(this.game.read());
    const map = state.world[exam];
    if (!map) {
      this.kickGenerate(exam);
      const local = localWorld();
      return this.decorate(state, {exam, title: '第一卷 · 英语 B 级', ...local, generatedAt: null, source: 'local', status: this.game.requestModel ? 'generating' : 'ready'});
    }
    return this.decorate(state, {...map, exam, status: this.generating.has(exam) ? 'generating' : 'ready'});
  }
  regenerate({exam = GAME_EXAM, requestId} = {}) {
    if (!requestId) throw new Error('缺少 requestId');
    this.kickGenerate(exam, true);
    return {exam, status: 'generating'};
  }
  learnerDigest() {
    const out = {words: [], notes: [], weak: []};
    try { out.words = (this.game.store.vocab?.drillWords?.(this.now()) || []).slice(0, 60).map(w => w.word).filter(Boolean); } catch {}
    try { out.notes = (this.game.store.readNotesState?.().notes || []).filter(n => /英语|english|pretco|cet/i.test(`${n.subject} ${n.exam} ${n.title}`)).slice(0, 40).map(n => clean(n.title, 40)); } catch {}
    try { out.weak = Object.values(this.game.read().monsters?.list || {}).filter(m => m.state !== 'captured').slice(0, 30).map(m => clean(m.topic || m.subject, 30)); } catch {}
    return out;
  }
  kickGenerate(exam, force = false) {
    if (!this.game.requestModel || this.generating.has(exam)) return;
    if (!force && this.game.read().world?.[exam]) return;
    const job = (async () => {
      const payload = {format: PRETCO_B_FORMAT, regions: REGIONS.map(r => ({id: r.id, name: r.name})), lessonPoints: LESSON_POINTS, learner: this.learnerDigest()};
      const r = await modelJson(this.game.requestModel, WORLD_RULES, payload, {validate: validWorld, timeoutMs: 90000, maxTokens: 6000});
      if (!r) return;
      this.game.mutate(state => {
        this.ensure(state);
        state.world[exam] = {title: '第一卷 · 英语 B 级', regions: r.value.regions, generatedAt: this.now(), source: 'model', model: r.model};
      });
    })().catch(() => {}).finally(() => this.generating.delete(exam));
    this.generating.set(exam, job);
  }

  // 节点状态从真实数据算
  decorate(state, map) {
    const fade = this.fadeByRegion();
    const monsters = Object.values(state.monsters?.list || {}).filter(m => m.state !== 'captured' && examMonster(m));
    const regions = map.regions.map(r => ({...r, nodes: r.nodes.map(n => {
      const rec = state.nodes[n.id] || {};
      const st = rec.gold ? 'gold' : rec.lit ? 'lit' : rec.explored ? 'explored' : 'fog';
      const here = monsters.filter(m => m.node === n.id || (!m.node && m.region === r.id && n.kind !== 'guard' && parseInt(m.id.slice(2, 6), 16) % Math.max(1, r.nodes.length - 1) === n.order));
      return {...n, state: st, fade: st === 'fog' ? 0 : Math.round((fade[r.id]?.ratio || 0) * 100) / 100, due: fade[r.id]?.due || 0, monsters: here.length};
    })}));
    return {exam: map.exam, title: map.title, regions, generatedAt: map.generatedAt, source: map.source, status: map.status};
  }
  fadeByRegion() {
    const out = {};
    const drill = this.game.store.drill;
    const now = this.now();
    const ratio = (cards) => {
      const total = cards.length;
      const due = cards.filter(c => c.due).length;
      return {due, ratio: total ? due / total : 0};
    };
    try {
      const words = drill?.wordCards?.({kind: 'all'}, now) || [];
      out.vocab = ratio(words);
    } catch {}
    try {
      const notes = (drill?.noteCards?.('agent:learning:notes-library', {kind: 'all'}, now) || []).filter(c => /英语|english|pretco/i.test(`${c.subject} ${c.exam}`));
      const r = ratio(notes);
      for (const id of ['listening', 'grammar', 'reading', 'translation', 'writing']) out[id] = r;
    } catch {}
    return out;
  }
  findNode(state, nodeId, exam = GAME_EXAM) {
    // 先找模型地图，再找本地兜底地图（前端可能还拿着生成前的本地节点 id）
    for (const map of [state.world?.[exam], localWorld()]) {
      if (!map) continue;
      for (const r of map.regions) for (const n of r.nodes) if (n.id === nodeId) return n;
    }
    return null;
  }

  // ---------- 进节点 ----------
  async nodeStart({nodeId, mode = 'learn', requestId, sessionKey = ''} = {}) {
    if (!requestId) throw new Error('缺少 requestId');
    const state = this.ensure(this.game.read());
    const node = this.findNode(state, clean(nodeId, 80));
    if (!node) throw new Error('这个考点不在地图上');
    if (mode === 'learn') {
      this.game.mutate(s => { this.ensure(s).nodes[node.id] ||= {}; s.nodes[node.id].learnStartedAt = this.now(); });
      return {flow: 'lesson', payload: {k: node.refs.chapterId, i: node.refs.i, topic: node.name, nodeId: node.id}};
    }
    if (mode === 'drill') {
      const source = node.region === 'vocab' ? 'vocab' : 'mixed';
      return {flow: 'drill', payload: {source, scope: {kind: 'due', nodeId: node.id}, nodeId: node.id}};
    }
    if (mode === 'guard') return this.guardStart({node, requestId, sessionKey});
    throw new Error('不认识的模式');
  }

  // 背一背从节点进去的一组：结算时按正确率点亮 / 金章。由 game 在 onDrillFinish 后调用。
  bindSession(sessionId, nodeId) {
    this.game.mutate(state => { this.ensure(state).nodeSessions[sessionId] = {nodeId, at: this.now()}; });
  }
  onSetResult(state, {sessionId, scored = 0, correct = 0}) {
    this.ensure(state);
    const bind = state.nodeSessions[sessionId];
    if (!bind || scored < 5) return [];
    return this.nodePass(state, bind.nodeId, correct / scored, `set:${sessionId}`);
  }
  nodePass(state, nodeId, accuracy, why) {
    const rec = state.nodes[nodeId] ||= {};
    const now = this.now();
    const out = [];
    if (accuracy < 0.8) return out;
    if (!rec.lit) {
      rec.lit = now;
      state.stats.nodesLit += 1;
      out.push(...this.game.grant(state, `node-lit:${nodeId}`, {type: 'node', id: nodeId}, [{kind: 'node', itemId: nodeId, reason: '点亮了一个考点', fx: 'big'}, {kind: 'stars', amount: this.economy.earn.nodeLit, reason: '点亮考点', fx: 'medium'}]));
      this.checkRegion(state, nodeId, out);
    } else if (!rec.gold && now - rec.lit >= this.economy.earn.nodeGoldGapDays * DAY) {
      rec.gold = now;
      state.stats.gold += 1;
      out.push(...this.game.grant(state, `node-gold:${nodeId}`, {type: 'node', id: nodeId}, [{kind: 'node', itemId: nodeId, reason: '金章！隔了几天还记得', fx: 'cinematic'},
        {kind: 'stars', amount: this.economy.earn.nodeGold, reason: '考点金章', fx: 'big'}, {kind: 'seals', amount: this.economy.earn.nodeGoldSeals, reason: '考点金章', fx: 'big'}]));
      const map = state.world?.[GAME_EXAM];
      if (map && map.regions.every(r => r.nodes.every(n => state.nodes[n.id]?.gold))) state.stats.allGold = 1;
    }
    void why;
    return out;
  }
  checkRegion(state, nodeId, out) {
    const map = state.world?.[GAME_EXAM] || localWorld();
    const region = map.regions.find(r => r.nodes.some(n => n.id === nodeId));
    if (region && region.nodes.every(n => state.nodes[n.id]?.lit)) {
      state.stats.regionsLit += 1;
      out.push(...this.game.grant(state, `region-lit:${region.id}`, {type: 'node', id: region.id}, [{kind: 'node', itemId: region.id, reason: `${region.name}全部点亮`, fx: 'cinematic'}]));
    }
  }
  onLesson(state, {chapter = ''} = {}) {
    this.ensure(state);
    const map = state.world?.[GAME_EXAM] || localWorld();
    // 从节点进去上的课：最近一次 learnStartedAt 的节点；否则同章节的第一个迷雾节点
    let best = null;
    for (const r of map.regions) for (const n of r.nodes) {
      const rec = state.nodes[n.id];
      if (rec?.learnStartedAt && (!best || rec.learnStartedAt > state.nodes[best.id].learnStartedAt) && this.now() - rec.learnStartedAt < 6 * 3600000) best = n;
    }
    if (!best) for (const r of map.regions) for (const n of r.nodes) if (!best && n.kind === 'lesson' && n.refs.chapterId === chapter && !state.nodes[n.id]?.explored) best = n;
    if (!best) return;
    const rec = state.nodes[best.id] ||= {};
    rec.explored ||= this.now();
    delete rec.learnStartedAt;
    // 讲完课的下一站是这个考点的真题（营地「练」那一行、「出发」都看它）
    state.lastLesson = {date: this.game.today(), nodeId: best.id, name: best.name, region: best.region, at: this.now()};
  }

  // ---------- 守关战 ----------
  async guardStart({node, requestId, sessionKey}) {
    const done = this.game.read().requests[`guard.start:${requestId}`];
    if (done) return done.result;
    const region = REGIONS.find(r => r.id === node.region);
    const sec = PRETCO_B_FORMAT.sections.find(s => s.id === region.section);
    const map = this.game.read().world?.[GAME_EXAM] || localWorld();
    const nodes = map.regions.find(r => r.id === node.region)?.nodes.filter(n => n.kind !== 'guard').map(n => ({name: n.name, summary: n.summary})) || [];
    const weak = Object.values(this.game.read().monsters?.list || {}).filter(m => m.region === node.region && m.state !== 'captured').slice(0, 10).map(m => m.topic);
    // 题库里这个区域的真题单选够 5 道就用真题（官方答案，不用盲答复核）；不够才让模型出
    const real = this.game.modules.practice?.guardItems?.(node.region) || [];
    if (real.length >= 5) {
      return this.game.once('guard.start', requestId, state => {
        this.ensure(state);
        const attemptId = `guard-${randomUUID()}`;
        state.guards[attemptId] = {nodeId: node.id, region: node.region, sessionKey, at: this.now(), items: real, answers: {}, combo: 0, finished: null, real: true};
        return {flow: 'guard', payload: {attemptId, nodeId: node.id, real: true, items: real.map((x, i) => ({itemId: `g${i + 1}`, mode: 'choice', prompt: x.stem, options: x.options, point: x.point, source: x.source}))}};
      });
    }
    const r = await modelJson(this.game.requestModel, GUARD_RULES, {region: region.name, format: sec, nodes, weak}, {
      validate: v => {
        const items = (Array.isArray(v?.items) ? v.items : []).map(x => validChoice(x)).filter(Boolean);
        return items.length >= 10 ? items.slice(0, 15) : null;
      }, timeoutMs: 90000, maxTokens: 6000,
    });
    if (!r) throw new Error('碧琪这会儿出不了守关卷，稍后再来（需要内置模型在线）');
    // 抽 3 道盲答复核；对不上的题换掉（不唯一的题不能进守关卷）
    const items = r.value;
    for (const i of [0, 4, 8]) if (items[i] && (await blindCheck(this.game.requestModel, items[i])) === false) items[i] = null;
    const kept = items.filter(Boolean);
    return this.game.once('guard.start', requestId, state => {
      this.ensure(state);
      const attemptId = `guard-${randomUUID()}`;
      state.guards[attemptId] = {nodeId: node.id, region: node.region, sessionKey, at: this.now(), items: kept, answers: {}, combo: 0, finished: null};
      return {flow: 'guard', payload: {attemptId, nodeId: node.id, items: kept.map((x, i) => ({itemId: `g${i + 1}`, mode: 'choice', prompt: x.stem, options: x.options, point: x.point}))}};
    });
  }
  guardAnswer({attemptId, itemId, answer} = {}) {
    return this.game.mutate(state => {
      const g = this.ensure(state).guards[clean(attemptId, 80)];
      if (!g) throw new Error('这场守关战已经不在了');
      if (g.finished) throw new Error('这场守关战已经结束');
      const idx = Number(String(itemId).replace(/^g/, '')) - 1;
      const item = g.items[idx];
      if (!item) throw new Error('这道题不在卷子里');
      if (g.answers[itemId]) return g.answers[itemId];
      const correct = Number(answer) === item.answer;
      g.combo = correct ? g.combo + 1 : 0;
      const crit = correct && g.combo > 0 && g.combo % 5 === 0;
      const res = {correct, explain: item.why || '', answer: item.answer, damage: correct ? (crit ? 2 : 1) * Math.round(100 / g.items.length) : 0, crit, combo: g.combo};
      g.answers[itemId] = res;
      if (!correct) this.game.modules.monsters?.spawn(state, {key: `guard:${fold(item.point || item.stem).slice(0, 40)}`, subject: '英语', topic: item.point, question: item.stem, answer: item.options[item.answer], options: item.options, source: {type: 'guard', id: attemptId}, node: g.nodeId});
      return res;
    });
  }
  // 守关点过之后才讲。标准答案是选项本身，模型只顺着它讲。
  guardExplain(params = {}) {
    const key = JSON.stringify([clean(params.attemptId, 80), clean(params.itemId, 80)]);
    if (this.explaining.has(key)) return this.explaining.get(key);
    const job = this.guardExplainOne(params).finally(() => this.explaining.delete(key));
    this.explaining.set(key, job);
    return job;
  }
  async guardExplainOne({attemptId, itemId, yours = ''} = {}) {
    const id = clean(attemptId, 80);
    const g = this.ensure(this.game.read()).guards[id];
    if (!g) throw new Error('这场守关战已经不在了');
    const rec = g.answers?.[String(itemId || '')];
    if (!rec) throw new Error('先做完这题');
    if (rec.lecture && rec.lectureV === EXPLAIN_VERSION) return {text: rec.lecture, source: rec.lectureSource || 'model'};
    const idx = Number(String(itemId).replace(/^g/, '')) - 1;
    const item = g.items[idx];
    if (!item) throw new Error('这道题不在卷子里');
    const standard = clean(item.options?.[item.answer], 300);
    let text = '';
    let source = 'none';
    let failure;
    if (standard && this.game.requestModel) {
      const r = await modelJson(this.game.requestModel, explainRulesFor(), explainInput({question: item.stem, options: item.options, standard, note: item.why, yours, correct: rec.correct}), {validate: validVoicedExplain, retries: 1, timeoutMs: 120000, maxTokens: useCompactExplain() ? 5200 : 1500, directPayload: true, stopOnQuota: true, ...(useCompactExplain() ? {} : {fallbackMaxTokens: 5200, fallbackRules: compactExplainRules(), onFallback: markCompactExplain}), onFailure: error => { failure = error; }});
      if (r) { text = r.value.text; source = 'model'; }
    }
    if (text) this.game.mutate(state => { const row = this.ensure(state).guards[id]?.answers?.[String(itemId)]; if (row) { row.lecture = text; row.lectureSource = source; row.lectureV = EXPLAIN_VERSION; } });
    return {text, source, ...(!text ? {error: explainFailure(failure)} : {})};
  }
  guardFinish({attemptId} = {}) {
    return this.game.mutate(state => {
      const g = this.ensure(state).guards[clean(attemptId, 80)];
      if (!g) throw new Error('这场守关战已经不在了');
      if (g.finished) return g.finished;
      const correct = Object.values(g.answers).filter(a => a.correct).length;
      const pct = Math.round(correct / g.items.length * 100);
      const rec = state.nodes[g.nodeId] ||= {};
      const reward = E.guardReward({pct, best: rec.guardBest ?? null, form: this.game.form(state), economy: this.economy});
      const awards = [];
      if (reward.stars) awards.push({kind: 'stars', amount: reward.stars, reason: reward.perfect ? '守关满分' : reward.passed ? '守关通过' : '守关练习', fx: reward.passed ? 'big' : 'medium'});
      if (reward.seals) awards.push({kind: 'seals', amount: reward.seals, reason: reward.perfect ? '守关满分' : '首次守关通过', fx: 'big'});
      const granted = this.game.grant(state, `guard:${attemptId}`, {type: 'guard', id: g.nodeId}, awards);
      if (reward.perfect && !(rec.guardBest >= 100)) state.stats.guardPerfect += 1;
      rec.guardBest = Math.max(rec.guardBest ?? 0, pct);
      if (reward.passed) granted.push(...this.nodePass(state, g.nodeId, 1, `guard:${attemptId}`));
      g.finished = {score: pct, passed: reward.passed, perfect: reward.perfect, awards: granted};
      return g.finished;
    });
  }
}
