// Metre 派活前看「现在有哪些模型能用」（briefs/metre-mode-1113 PLAN 2.5），以及派活时的模型规则（2.4）。
// 数据只来自本机：配置里同步好的模型目录（model-sync.mjs 写进去的）+ 本进程记下的健康状态（model-health.mjs）。
// 这里不发任何网络请求，断网时照样能答。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyModelFailure, configuredModels, UNUSABLE_KINDS} from './model-health.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TIERS = Object.freeze(['top', 'mid', 'light']);
export const MAX_LISTED = 40;
// 和 model-sync.mjs 的 MEDIA_ID 同一个意思：生图、视频、语音、向量模型不是能干活的聊天模型。
const MEDIA_ID = /(?:^|[-_/])(?:image|imagine|video|veo|audio|tts|speech|embedding|embed|rerank|transcribe)(?:[-_.]|$)/i;
const EFFORT = /-(?:extra-low|non-reasoning|reasoning|thinking|tiered|adaptive|disabled|minimal|none|xhigh|high|medium|low|max)$/i;

let tierCache = null;
export function tierTable() {
  if (tierCache) return tierCache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(path.join(HERE, 'model-tiers.json'), 'utf8')); } catch {}
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).flatMap(rule => {
    try { return TIERS.includes(rule?.tier) ? [{match: new RegExp(rule.match, 'i'), tier: rule.tier}] : []; } catch { return []; }
  });
  const light = new Set((Array.isArray(raw.light) ? raw.light : []).map(word => String(word).toLowerCase()));
  const toolsWeak = (Array.isArray(raw.toolsWeak) ? raw.toolsWeak : []).flatMap(pattern => {
    try { return [new RegExp(pattern, 'i')]; } catch { return []; }
  });
  tierCache = {rules, light, toolsWeak};
  return tierCache;
}

const lastSegment = id => String(id || '').trim().toLowerCase().split('/').filter(Boolean).at(-1) || '';

/**
 * 比较「是不是同一个模型」用的名字：去掉提供方和路由前缀（`mm/workbuddy/` 这类）、路由后缀（`:free`、`@eu`）、
 * 思考强度后缀（`-high`、`-thinking`…，可以叠几层），小写。
 */
export function normalizeModelId(id) {
  let name = lastSegment(id).replace(/[@:].*$/u, '');
  for (let previous = ''; previous !== name;) { previous = name; name = name.replace(EFFORT, ''); }
  return name;
}

export function tierOf(id) {
  const name = normalizeModelId(id), table = tierTable();
  const rule = table.rules.find(item => item.match.test(name));
  if (rule) return rule.tier;
  const words = lastSegment(id).split(/[-_.]/u);
  return words.some(word => table.light.has(word)) ? 'light' : 'mid';
}

export function toolsStable(id) {
  const raw = lastSegment(id);
  return !tierTable().toolsWeak.some(pattern => pattern.test(raw));
}

/** 配置里的聊天模型目录：`提供方/模型` → 条目。 */
export function catalog(config = {}) {
  const out = [];
  for (const [provider, entry] of Object.entries(config?.models?.providers || {})) {
    for (const model of Array.isArray(entry?.models) ? entry.models : []) {
      if (typeof model?.id !== 'string' || !model.id || MEDIA_ID.test(model.id)) continue;
      out.push({id: `${provider}/${model.id}`, provider, name: model.name || model.id,
        vision: Array.isArray(model.input) && model.input.includes('image')});
    }
  }
  return out;
}

const providerNames = config => new Set(Object.keys(config?.models?.providers || {}));

/** 模型写法转成目录里的那一项：完整的 `提供方/模型`，或省掉提供方、刚好只对上一项的写法。 */
export function findModel(list, raw, config = {}) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const exact = list.find(item => item.id.toLowerCase() === text.toLowerCase());
  if (exact) return exact;
  const first = text.split('/')[0];
  if (providerNames(config).has(first)) return null;
  const suffix = list.filter(item => item.id.toLowerCase().endsWith('/' + text.toLowerCase()));
  return suffix.length === 1 ? suffix[0] : null;
}

function healthOf(health, id) {
  const record = health?.models?.get?.(id);
  if (!record) return {healthy: true, health: 'unknown'};
  if (record.failAt && (!record.okAt || record.failAt > record.okAt)) {
    const kind = classifyModelFailure(record.reason || '');
    return {healthy: false, health: 'failing', reason: clip(record.reason || kind || '最近一次调用失败', 160),
      ...(UNUSABLE_KINDS.has(kind) ? {unusable: true} : {})};
  }
  return {healthy: true, health: 'ok', okAt: record.okAt};
}
const clip = (text, limit) => [...String(text || '')].slice(0, limit).join('');

/** 一个 agent 不另外指定时用的模型（自己的主模型，没有就是全局默认）。 */
export function defaultModelFor(config, agentId) {
  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const agent = agents.find(item => item?.id === agentId) || {};
  for (const value of [agent.model, config?.agents?.defaults?.model]) {
    const primary = typeof value === 'string' ? value : value?.primary;
    if (typeof primary === 'string' && primary.includes('/')) return primary;
  }
  return configuredModels(config, agentId)[0] || '';
}

export const sameModel = (a, b) => Boolean(a && b) && normalizeModelId(a) === normalizeModelId(b);

/**
 * pinkie_models 的结果。selfModel 是 Metre 这一轮真正在用的模型。
 * 健康的按 top / mid / light 分组在前，不健康的排最后并写原因；最多 40 个，Metre 自己那一项一定在里面。
 */
export function listModels({config = {}, health = null, selfModel = '', tier = '', query = ''} = {}) {
  const all = catalog(config);
  // 恰好一项是自己：完全一样的写法优先，其次是归一化后相同的第一项（同一模型的其他思考强度不再标）。
  let selfIndex = all.findIndex(item => item.id.toLowerCase() === String(selfModel || '').trim().toLowerCase());
  if (selfIndex < 0) selfIndex = all.findIndex(item => sameModel(item.id, selfModel));
  const selfSeen = selfIndex >= 0;
  const rows = all.map((item, order) => ({id: item.id, name: item.name, tier: tierOf(item.id), ...healthOf(health, item.id),
    vision: item.vision, toolsStable: toolsStable(item.id), self: order === selfIndex, order,
    ...(order !== selfIndex && sameModel(item.id, selfModel) ? {sameAsSelf: true} : {})}));
  if (!selfSeen && selfModel) {
    rows.unshift({id: selfModel, name: lastSegment(selfModel), tier: tierOf(selfModel), ...healthOf(health, selfModel),
      vision: false, toolsStable: toolsStable(selfModel), self: true, order: -1, note: '不在同步到的目录里'});
  }
  const wanted = String(query || '').trim().toLowerCase();
  const filtered = rows.filter(row => row.self || (!tier || row.tier === tier) && (!wanted || row.id.toLowerCase().includes(wanted)));
  const rank = row => (row.healthy ? 0 : 10) + TIERS.indexOf(row.tier);
  // 同一档里：最近确实跑通过的在前，其次按目录顺序。
  filtered.sort((a, b) => rank(a) - rank(b) || (b.okAt || 0) - (a.okAt || 0) || a.order - b.order);
  // 每一档先各占三分之一的名额（不然一长串 top 会把便宜的挤出去，而派活多半要的是便宜的），剩下的名额按顺序补。
  const self = filtered.find(row => row.self);
  const picked = new Set(self ? [self] : []);
  const share = Math.ceil(MAX_LISTED / TIERS.length);
  for (const name of TIERS) for (const row of filtered.filter(item => item.healthy && item.tier === name).slice(0, share)) {
    if (picked.size < MAX_LISTED) picked.add(row);
  }
  for (const row of filtered) if (picked.size < MAX_LISTED) picked.add(row);
  const shown = filtered.filter(row => picked.has(row));
  const models = shown.map(({order: _order, okAt: _okAt, ...row}) => row);
  return {models, total: filtered.length, ...(filtered.length > shown.length
    ? {more: `还有 ${filtered.length - shown.length} 个没列出，用 tier 或 query 缩小范围再看`} : {}),
  self: self?.id || selfModel || ''};
}

/**
 * Metre 开子会话时的模型规则（后端硬性执行，PLAN 2.4）：
 * - 写了 model：必须在目录里、健康、和 Metre 自己的不同（归一化后比较）。
 * - 没写：用目标模式的默认；它恰好和 Metre 相同就拒绝，要求写 model。
 * 返回 {model, explicit}，model 是写进 sessions.create 的完整 `提供方/模型`（没写时是目标默认，只记录不传）。
 */
export function chooseChildModel({config = {}, health = null, selfModel = '', requested = '', targetAgent = ''}) {
  const text = String(requested || '').trim();
  if (text) {
    const list = catalog(config);
    const found = findModel(list, text, config);
    if (!found) throw new Error(`没有「${clip(text, 80)}」这个模型：先用 pinkie_models 看可用的，写它返回的 id`);
    if (sameModel(found.id, selfModel)) {
      throw new Error(`「${found.id}」和你自己（${selfModel}）是同一个模型，不能派给自己：选一个更轻的`);
    }
    const state = healthOf(health, found.id);
    if (!state.healthy) throw new Error(`「${found.id}」最近调用失败（${state.reason}），换一个健康的`);
    return {model: found.id, explicit: true};
  }
  const fallback = defaultModelFor(config, targetAgent);
  if (fallback && sameModel(fallback, selfModel)) {
    throw new Error(`这个模式的默认模型（${fallback}）和你自己相同，必须写 model：先用 pinkie_models 选一个更轻的`);
  }
  return {model: fallback, explicit: false};
}
