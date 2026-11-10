import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {agentWorkspace, findAgent, openclawStateDir} from './openclaw-paths.mjs';
import {LEVELS as LADDER_LEVELS, NO_LAYERS, depthLayers, mergeLayers, messageWeight, proportion, rigorLayers} from './run-contract.mjs';
import {adaptiveHint, artifactPaths, classifyWorkKind, entriesFromMessages, independentViews, isHandsOnKind, kindLabel, solverModeFor, tierName} from './work-kinds.mjs';

// 输入框思考等级滑块的 9 档属于碧琪，不属于任何模型的原生等级表。每一档先按当前模型真正支持的
// 原生等级就近发送；原生够不到的部分，用流程补：
//   往下缺（模型最低档仍比所选档高）：只能让回答更快——直接给结论，不铺垫。
//   往上缺（模型最高档够不到所选档）：每一级包含下面各级，再多一种做法（数在 run-contract.mjs 的 DEPTH_LADDER）。
//     Medium：回答前先拆清要求和约束（只加一段提示）。
//     High：再加「交之前自己逐条核一遍」。
//     XHigh：再加并行一份独立解答 + 批评，打回 1 轮。
//   Max：2 份独立解答（各用一种做法）+ 批评 + 交付验收，最多打回 2 轮。
//   Ultra：3 份独立解答（直接解、换方法、列清单自查）+ 批评兼仲裁 + 交付验收，最多打回 3 轮。
//   力气跟着活走：纯寒暄什么都不加；只说「继续」时核对的是它接着做的那件事；打回后的复核只追旧问题。
// 独立解答和批评都用用户当前选的模型（用户 2026-10-25 明确要求），不偷偷换成别的模型；
// 只有插件配置 reasoning.criticModels 明确写了，批评才换模型。
//   Adaptive（原生不支持时）：按这条消息分三段，难题和动手的活按 XHigh，一句话聊天按 Low，其余按 Medium。
// 2026-10 的 Gemini 实测说明：同一个模型自己多推演几轮几乎没有用；有用的是换做法的独立解答对照、
// 有证据的打回，以及核对交付（没验证就说完成、漏掉要求、文件不存在却给结果）。
// 独立解答都在主回答进行的同时并行跑，不增加等待；批评在主回答结束后进行。
// 2026-11-02 档位升级：按「活儿种类」（work-kinds.mjs）变用途——答题类独立解答；动手的活（网页、PPT、视频……）
// 改成独立写验收清单；文案、点子独立写一版。审稿员带只读工具（read / image / pdf / web_fetch / web_search），
// 打开交付物本身核对，不再只看文字。九档补强和四档思考强度同时选时合并成一次验收。
const SESSION_KEY = /^agent:(main|project|thinking|learning|unrestricted):[^\s]+$/;
export const LEVELS = LADDER_LEVELS;
const RANK = new Map(LEVELS.map((name, index) => [name, index]));
const LABELS = {off: '关闭', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', adaptive: 'Adaptive', max: 'Max', ultra: 'Ultra'};
// 思考强度档位（极致思考按钮）也带同一套交付验收：档位决定做事流程，验收在整个档位任务结束后才做。
// 长跑档全部里程碑勾完后做一轮全开档式终审（审稿员打开成品挑毛病）。
// 数在 run-contract.mjs 的 RIGOR_LADDER；基础档没有验收，不在这张表里。
const WORK_TIERS = Object.freeze(Object.fromEntries(['boost', 'full', 'marathon'].map((tier) => [tier, rigorLayers(tier)])));
// 审稿员只给只读工具：能打开截图、文档、网页，不能执行、写文件、操作浏览器。
export const REVIEW_TOOLS = Object.freeze(['read', 'image', 'pdf', 'web_fetch', 'web_search']);
const MODE_BY_AGENT = Object.freeze({main: 'chat', project: 'project', thinking: 'ideas', learning: 'learning', unrestricted: 'none'});
// The unrestricted mode retains its existing review behavior and is not part
// of the four work-mode contract migration.
const LEGACY_MERGE_WINDOW_MS = 10 * 60_000;
const unrestrictedSession = sessionKey => /^agent:unrestricted:/.test(String(sessionKey || ''));
const legacyMergeable = intent => Boolean(intent && intent.phase === 'armed'
  && Date.now() - (Number(intent.createdAt) || 0) < LEGACY_MERGE_WINDOW_MS);
const CONTROL_PROMPT = /^\s*\[pinkie-(?:watchdog|tier-control|tier)\]/;
const MAX_MESSAGE = 12_000;
const MAX_HISTORY = 10_000;
const PASS_TIMEOUT_MS = 300_000;
const INDEPENDENT_WAIT_MS = 240_000;
const INTENT_TTL_MS = 60 * 60_000;
const FIX_PREFIX = '[pinkie-tier] 交付验收';
// 网关方法（发送前登记、状态查询）和 Agent 运行时的钩子（注入、回合结束后核对）是插件的两个实例，
// 内存不共享——旧版 Max/Ultra 的审阅笔记就是因此从来没能交给主模型。待核对的状态必须落盘。
const FIELDS = ['requestId', 'tier', 'level', 'recipe', 'message', 'sessionKey', 'history', 'phase', 'round', 'maxRounds', 'crossCheck', 'issues', 'jobs', 'createdAt', 'updatedAt',
  'workTier', 'workKind', 'workKinds', 'workspaceDir', 'deliveredReply', 'runId', 'preparedParams', 'preparedResult', 'weight', 'task'];

export class ReviewStore {
  constructor(root = path.join(openclawStateDir(), 'pinkie-deep-think', 'reviews')) {
    this.root = root;
  }

  file(sessionKey, requestId = '') {
    const session = createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 32);
    const request = requestId ? `-${createHash('sha256').update(String(requestId)).digest('hex').slice(0, 32)}` : '';
    return path.join(this.root, `${session}${request}.json`);
  }

  list(sessionKey) {
    const legacy = path.basename(this.file(sessionKey));
    const prefix = legacy.slice(0, -5) + '-';
    try {
      return fsSync.readdirSync(this.root).filter(name => name === legacy || (name.startsWith(prefix) && name.endsWith('.json')))
        .flatMap(name => {
          try {
            const value = JSON.parse(fsSync.readFileSync(path.join(this.root, name), 'utf8'));
            return value?.sessionKey === sessionKey ? [value] : [];
          } catch { return []; }
        }).sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    } catch {
      return [];
    }
  }

  get(sessionKey, {requestId = '', runId = ''} = {}) {
    const entries = this.list(sessionKey);
    if (requestId) return entries.find(entry => entry.requestId === requestId) || null;
    if (runId) return entries.find(entry => entry.runId === runId) || null;
    const current = entries.filter(entry => ['answering', 'reviewing', 'fixing'].includes(entry.phase));
    return (current.length ? current : entries).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0] || null;
  }

  set(intent) {
    const value = Object.fromEntries(FIELDS.map((key) => [key, intent[key]]));
    value.updatedAt = Date.now();
    fsSync.mkdirSync(this.root, {recursive: true});
    const target = this.file(intent.sessionKey, intent.requestId);
    const temp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    fsSync.writeFileSync(temp, JSON.stringify(value));
    fsSync.renameSync(temp, target);
    // One-time migration of the older one-file-per-session format. Only remove
    // the old file when it contains this exact request, never another run.
    const legacy = this.file(intent.sessionKey);
    try {
      const old = JSON.parse(fsSync.readFileSync(legacy, 'utf8'));
      if (old?.sessionKey === intent.sessionKey && old.requestId === intent.requestId) fsSync.unlinkSync(legacy);
    } catch {}
    return value;
  }

  delete(sessionKey, requestId = '') {
    for (const intent of this.list(sessionKey)) {
      if (requestId && intent.requestId !== requestId) continue;
      for (const file of [this.file(sessionKey, intent.requestId), this.file(sessionKey)]) {
        try {
          const value = JSON.parse(fsSync.readFileSync(file, 'utf8'));
          if (value?.sessionKey === sessionKey && value.requestId === intent.requestId) fsSync.unlinkSync(file);
        } catch {}
      }
    }
  }
}
const REVIEW_MARK = '[pinkie:delivery-review';

function splitRef(ref) {
  const text = String(ref || '').trim();
  const index = text.indexOf('/');
  return index > 0 ? {provider: text.slice(0, index), model: text.slice(index + 1)} : null;
}

function modelRef(config, entry, agentId) {
  const agent = findAgent(config, agentId);
  const defaultModel = agent?.model ?? config?.agents?.defaults?.model;
  const fallback = typeof defaultModel === 'string' ? defaultModel : defaultModel?.primary;
  // 会话里的 modelOverride 是不带服务商的模型 ID，本身可能含斜杠（mm 的 workbuddy/glm-5.3）；
  // 只有「服务商/模型」形式的默认模型才按第一个斜杠拆开。
  const override = String(entry?.modelOverride || '').trim();
  const selected = String(override || fallback || '').trim();
  const provider = String(entry?.providerOverride || selected.split('/')[0] || '').trim();
  const model = override && entry?.providerOverride ? override : selected.includes('/') ? selected.slice(selected.indexOf('/') + 1) : selected;
  if (!provider || !model) throw new Error('当前会话的模型还没有确认，增强档位未启动');
  return {provider, model};
}

function catalogRecord(config, provider, model) {
  return (config?.models?.providers?.[provider]?.models || []).find((item) => item.id === model) || null;
}

// Antigravity's verified Claude endpoints encode effort in the model ID. Their
// adapter takes thinking=off; that does not mean the endpoint itself has no thought.
export function fixedEndpointLevel(record) {
  if (record?.compat?.supportedReasoningEfforts?.length) return '';
  return /^claude-(?:sonnet|opus)-5-5-(low|medium|high)$/.exec(record?.id || '')?.[1] || '';
}

// 模型真正支持的原生思考等级。没声明但标了 reasoning 的，只当它有一档 high。
export function nativeLevels(record) {
  const fixed = fixedEndpointLevel(record);
  if (fixed) return [fixed];
  if (!record || record.reasoning === false) return ['off'];
  const declared = record.compat?.supportedReasoningEfforts;
  if (Array.isArray(declared) && declared.length) {
    const levels = [...new Set(declared.map((value) => (value === 'none' ? 'off' : String(value))))].filter((value) => RANK.has(value));
    if (levels.length) return levels.sort((a, b) => RANK.get(a) - RANK.get(b));
  }
  return record.reasoning === true ? ['high'] : ['off'];
}

// 与输入框滑块同一套就近规则：距离一样时取较低的那档。
export function nearestNative(level, natives) {
  const pool = natives.filter((value) => value !== 'adaptive');
  if (!pool.length) return natives[0] || 'off';
  if (pool.includes(level)) return level;
  const target = RANK.get(level) ?? RANK.get('high');
  return [...pool].sort((a, b) => Math.abs(RANK.get(a) - target) - Math.abs(RANK.get(b) - target) || RANK.get(a) - RANK.get(b))[0];
}

const topNative = (natives) => natives.filter((value) => value !== 'adaptive').at(-1) || 'off';

// 只看这条消息本身，判断值不值得多花力气：不调用模型，不增加等待。
function messageScore(text) {
  const value = String(text || '');
  let score = 0;
  if (value.length > 280) score += 1;
  if (value.length > 900) score += 1;
  if (/```|\bdef\b|\bfunction\b|=>|class\s+\w+|\bSELECT\b|报错|Traceback|stack trace|bug|调试|排查|重构/i.test(value)) score += 3;
  if (/证明|推导|求解|计算|算出|多少种|概率|期望|方程|不等式|最优|复杂度|定理|反例|逻辑题|谜题|几何|数列/.test(value)) score += 3;
  if (/为什么|分析|比较|权衡|方案|设计|架构|评估|审查|规划|策略/.test(value)) score += 1;
  // 实测：Low 档数学题照样全对，错的全是「恰好 N 个字 / 每行 N 字」这类硬性计数写作，按难题处理。
  if (/(?:恰好|正好|刚好|整整|必须是?)\s*[0-9一二三四五六七八九十两]+\s*个?(?:汉字|字|句|行|段|词)|每(?:一)?(?:行|句|段)[^。；\n]{0,10}[0-9一二三四五六七八九十]+\s*个?(?:汉字|字)|藏头/.test(value)) score += 3;
  if ((value.match(/[0-9]+/g) || []).length >= 6) score += 1;
  if ((value.match(/[；;。\n]/g) || []).length >= 6) score += 1;
  if (/^(?:你好|在吗|谢谢|好的|嗯|ok|收到|早|晚安)[!！。.~～\s]*$/i.test(value.trim())) score = 0;
  return score;
}
export function messageDifficulty(text) {
  return messageScore(text) >= 3 ? 'hard' : 'easy';
}
// 三段：easy 一句话的事；normal 要讲理由、作比较的事；hard 要算、要证、要查错的事。
export function messageBand(text) {
  const score = messageScore(text);
  return score >= 3 ? 'hard' : score >= 1 ? 'normal' : 'easy';
}

// 这条消息是哪种活（无限制模式不分）。sessionKey 带出模式：学习模式默认按讲题辅导。
export function workKindsFor(message = '', sessionKey = '') {
  const mode = MODE_BY_AGENT[String(sessionKey).split(':')[1]] || '';
  if (mode === 'none') return [];
  return classifyWorkKind(message, {mode}).kinds;
}

// Adaptive 的三段：动手的活（网页、PPT、视频、代码、报错……）和有标准答案的难题按难题走 XHigh 路线；
// 一句话聊天按简单走 Low；文案、点子、取舍、查事实、讲题至少按普通走 Medium。种类和消息本身的分数取高的那个
// （保留「恰好 N 个字」这类硬性计数写作按难题的实测规则）。
const BAND_RANK = {easy: 0, normal: 1, hard: 2};
export function adaptiveBand(message = '', sessionKey = '') {
  const hint = adaptiveHint(workKindsFor(message, sessionKey));
  const own = messageBand(message);
  if (!hint) return own;
  if (hint === 'easy') return own === 'hard' ? 'hard' : 'easy';
  return BAND_RANK[own] > BAND_RANK[hint] ? own : hint;
}
export function adaptiveDifficulty(message = '', sessionKey = '') {
  return adaptiveBand(message, sessionKey) === 'hard' ? 'hard' : 'easy';
}
const BAND_LEVEL = {easy: 'low', normal: 'medium', hard: 'xhigh'};

const ENHANCED = new Set(['max', 'ultra']);

// 一个档位在当前模型上的实际做法。kind: native 原生 / down 往下补 / up 往上补 / enhanced Max·Ultra / adaptive 自适应模拟。
export function recipeFor(level, record, {message = '', sessionKey = ''} = {}) {
  const natives = nativeLevels(record);
  if (!RANK.has(level)) level = 'medium';
  if (level === 'adaptive' && !natives.includes('adaptive')) {
    const difficulty = adaptiveBand(message, sessionKey);
    const as = BAND_LEVEL[difficulty];
    const inner = recipeFor(as, record);
    return {...inner, level, kind: 'adaptive', difficulty, as};
  }
  if (ENHANCED.has(level)) {
    const native = natives.includes(level) ? level : topNative(natives);
    // 梯子是累加的：原生够不到这一档时，下面几级的「先弄懂、交前自查」也一起补上。
    const short = native !== level;
    return {level, native, kind: 'enhanced', ...depthLayers(level), think: short, selfCheck: short};
  }
  const native = nearestNative(level, natives);
  if (native === level || level === 'adaptive') return {level, native, kind: 'native', ...NO_LAYERS};
  if (RANK.get(native) > RANK.get(level)) return {level, native, kind: 'down', ...NO_LAYERS, brevity: true};
  return {level, native, kind: 'up', ...depthLayers(level)};
}

const hasLayers = (recipe) => Boolean(recipe && (recipe.brevity || recipe.concise || recipe.think || recipe.solvers || recipe.critic || recipe.audit));

// 消息和它的种类都知道之后，把这一条的做法定下来（只在这一处定）：
//   做事档位这种活自己会派出去的独立做法先算数，九档只在后台补还差的那几份（engineSolvers）；
//   纯寒暄什么都不加；只说「继续」又找不到它指哪件事时，不派独立做法。
function settleRecipe(recipe = {}, {workTier = '', kinds = [], weight = 'task', hasTask = true} = {}) {
  const tierViews = independentViews(kinds, workTier);
  const solvers = Math.max(0, Number(recipe.solvers) || 0);
  return proportion({...recipe, tierViews, engineSolvers: Math.max(0, Math.max(solvers, tierViews) - tierViews)}, weight, {hasTask});
}

// 只说「继续」「好的」时，它接着做的是哪件事：往回找最近一条真的在提要求的用户消息。
function lastTaskFromMessages(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messageOf(messages[index]);
    if (message?.role !== 'user') continue;
    const text = partsText(message.content).trim();
    if (!text || CONTROL_PROMPT.test(text) || messageWeight(text) !== 'task') continue;
    return text.slice(0, 4000);
  }
  return '';
}

// 给独立做法和审稿员看的「用户这一轮」：只说「继续」时带上它指的那件事。
function subjectOf(intent = {}) {
  return intent.task ? `${intent.message}\n（这一句是让接着做之前这条请求：${intent.task}）` : intent.message;
}

function bestEffort(record) {
  if (fixedEndpointLevel(record)) return 'off';
  const natives = nativeLevels(record);
  return ['max', 'xhigh', 'high', 'medium', 'low', 'minimal'].find((level) => natives.includes(level)) || 'off';
}

// 配置了批评模型时：和主模型不同、在模型目录里存在、能推理的，按顺序取第一个；都没有就用主模型。
export function criticRef(config, main, preferences = []) {
  for (const ref of preferences) {
    const parsed = splitRef(ref);
    if (!parsed || (parsed.provider === main.provider && parsed.model === main.model)) continue;
    const record = catalogRecord(config, parsed.provider, parsed.model);
    if (record && record.reasoning !== false && record.available !== false) return parsed;
  }
  return {...main};
}

function historyText(value) {
  if (!Array.isArray(value)) return '';
  return value.slice(-10).filter((item) => item && ['user', 'assistant'].includes(item.role))
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${String(item.text || '').slice(0, 1600)}`)
    .join('\n').slice(-MAX_HISTORY);
}

function outputText(result) {
  return (result?.payloads || []).filter((part) => !part?.isError && !part?.isReasoning && !part?.isCommentary && typeof part?.text === 'string')
    .map((part) => part.text).join('\n').trim().slice(0, 6000);
}

function messageOf(entry) {
  return entry?.message && typeof entry.message === 'object' ? entry.message : entry;
}

function partsText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part && typeof part.text === 'string' && (!part.type || part.type === 'text')).map((part) => part.text).join('\n');
}

// before_prompt_build 自带的历史消息（不含这一轮），换成验收员能读的对话节选。
function historyFromMessages(messages = []) {
  const rows = [];
  for (const entry of messages) {
    const message = messageOf(entry);
    if (!message || !['user', 'assistant'].includes(message.role)) continue;
    const text = partsText(message.content).trim();
    if (!text || CONTROL_PROMPT.test(text)) continue;
    rows.push({role: message.role, text});
  }
  return historyText(rows);
}

const SILENT_REPLY = /^\s*(?:NO_REPLY|HEARTBEAT_OK)\s*$/;

export function finalReply(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messageOf(messages[index]);
    if (message?.role !== 'assistant') continue;
    const text = partsText(message.content).trim();
    if (text) return text;
  }
  return '';
}

// 本轮真实发生过的工具调用和结果（节选）：验收员只认这些，不认回复里的自述。
export function toolEvidence(messages = [], limit = 9000) {
  const rows = [];
  for (const entry of messages) {
    const message = messageOf(entry);
    if (!message) continue;
    if (message.role === 'toolResult' || message.role === 'tool') {
      const name = message.toolName || message.name || 'tool';
      const failed = message.isError === true || message.error ? '（失败）' : '';
      rows.push(`· ${name}${failed} → ${partsText(message.content).replace(/\s+\n/g, '\n').trim().slice(0, 700)}`);
    } else if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!part || !['toolCall', 'tool_use', 'toolUse'].includes(part.type)) continue;
        const args = typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments ?? part.input ?? {});
        rows.push(`· 调用 ${part.name || 'tool'}：${String(args).slice(0, 300)}`);
      }
    }
  }
  let text = rows.join('\n');
  if (text.length > limit) text = '（较早的工具记录已省略）\n' + text.slice(-limit);
  return text || '（本轮没有调用任何工具）';
}

function parseVerdict(text = '') {
  const raw = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1));
    const issues = Array.isArray(value.issues) ? value.issues
      .filter((item) => item && typeof item === 'object' && String(item.what || '').trim() && String(item.evidence || '').trim())
      .slice(0, 5)
      .map((item) => ({what: String(item.what).slice(0, 400), evidence: String(item.evidence).slice(0, 600), fix: String(item.fix || '').slice(0, 400)})) : [];
    return {pass: value.pass === true || issues.length === 0, issues};
  } catch {
    return null;
  }
}

// 几份独立解答各用一种不同的做法，避免几份答案犯同一个错。
const SOLVER_ANGLES = [
  '按你认为最可靠的方法直接求解。',
  '刻意换一种和常规不同的方法：反向验证、换一种建模或拆解方式、用特例或极端情况检验。',
  '先逐条列出题目里的全部要求、约束和最容易出错的地方，再求解，并对照这张清单自查。',
];
// 动手的活：独立解答没法替主回答动手，改成写一张能逐条核对的验收清单，交给审稿员当核对单。
const CHECKLIST_ANGLES = [
  '站在用户的位置：拿到成品第一眼最在意什么、怎样算真的能用。',
  '站在挑剔的行家位置：这一行交付前一定会查的点，以及最容易翻车的地方。',
  '站在核对的位置：每一条该用什么工具、看什么、多少算合格。',
];
// 文案、点子：独立写一版，给审稿员作对照（不要求一致）。
const DRAFT_ANGLES = [
  '照用户说的场景，写最稳妥、最像真人的一版。',
  '换一个切入角度或结构写（先讲故事、反着说、换一个读者视角）。',
  '写一版更短、更有记忆点的。',
];
export const SOLVER_LABELS = Object.freeze({
  answer: ['直接解', '换方法', '列清单自查'],
  checklist: ['用户视角清单', '行家挑错清单', '核对方法清单'],
  draft: ['稳妥一版', '换角度一版', '短一版'],
});

export function solverPrompt({message, history, index = 0, workKind = ''}) {
  const mode = solverModeFor([workKind]);
  const context = [`最近对话（只用来理解上下文）：\n${history || '无'}`, `用户这一轮：\n${message}`];
  if (mode === 'checklist') {
    return [
      `你是验收清单助手。这是一件「${kindLabel(workKind) || '动手的活'}」，别人正在动手做；你不做成品，只独立写一张验收清单，交付前会拿它逐条核对。`,
      `做法：${CHECKLIST_ANGLES[index % CHECKLIST_ANGLES.length]}`,
      '不调用工具，不假装做过任何操作。输出：①验收清单 5–8 条，每条能核对（看什么、多少算合格，用户的每条硬要求都要在里面）；②最可能翻车的 3 处；③每条用什么办法核对（截图、抽帧、转成图片、真运行、重算、打开交付文件本身）。800 字以内，不写泛泛的建议。',
      ...context,
    ].join('\n\n');
  }
  if (mode === 'draft') {
    return [
      '你是独立起草助手，只根据下面的对话独立写一版，给审稿时作对照。',
      `做法：${DRAFT_ANGLES[index % DRAFT_ANGLES.length]}`,
      '不调用工具。用户有字数、行数、格式、必须有和不能有的要求，逐条满足并自己数清；起名、点子类给 3–5 个同方向的候选，每个一句理由。最后单独一行写这一版的取舍。1500 字以内。',
      ...context,
    ].join('\n\n');
  }
  return [
    '你是独立解题助手，只根据下面的对话独立完成用户这一轮的问题。',
    `做法：${SOLVER_ANGLES[index % SOLVER_ANGLES.length]}`,
    '不调用工具，不假装执行过任何操作。先给出明确结论，再给出能让别人复核的关键依据或推导（数字要算出来，不要只说思路）；需要实际运行或查证才能确定的地方，写明「需要核实」。1500 字以内。',
    ...context,
  ].join('\n\n');
}

// 模型数字数很不准，而「恰好 N 个字」「每行 5 个字」正是最常见的硬要求：由程序替批评员数好。
export function replyFacts(reply = '') {
  const text = String(reply).trim();
  if (!text) return '';
  const han = (value) => (value.match(/\p{Script=Han}/gu) || []).length;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sentences = text.split(/(?<=[。！？!?])/).map((part) => part.trim()).filter((part) => han(part) || /\w/.test(part));
  const rows = [
    `全文：${han(text)} 个汉字，${text.replace(/\s/g, '').length} 个非空白字符，${lines.length} 个非空行，${sentences.length} 个句子（按 。！？ 切分）`,
  ];
  if (lines.length > 1 && lines.length <= 40) rows.push(`每行汉字数：${lines.map((line, index) => `第${index + 1}行 ${han(line)}`).join('，')}`);
  if (sentences.length > 1 && sentences.length <= 20) rows.push(`每句汉字数：${sentences.map((part, index) => `第${index + 1}句 ${han(part)}`).join('，')}`);
  return rows.join('\n');
}

// 审稿员按活儿种类重点看什么（打开交付物本身核对）。
const REVIEW_FOCUS = {
  web_ui: '打开截图（有手机宽度的也看）：排版、文字是否被挡住或溢出、按钮能不能看清点到、和用户要求是否一致。',
  app_game_ai: '打开运行截图：是不是真的跑起来了、主要功能在不在、界面有没有明显错乱。',
  document: '打开交付的那个 .pptx / .docx / .pdf 本身（或它转出的页面图）：页数、每页内容、字体和排版、有没有编造的事实；只看过 HTML 替身不算。',
  video_motion: '打开抽帧拼图：画面内容、字幕清不清楚有没有乱码、时长和比例是否符合要求。',
  image_print: '打开图片：主角、文字有没有错字乱码、尺寸比例；要印刷的看尺寸和出血。',
  data_charts: '打开图表图片、读结果文件：关键数字和回复是否一致、图表标题是不是结论。',
  automation: '读工具记录和脚本：是否真跑过一次、要求自动的是否真注册成功、会不会动到用户真的文件。',
  code: '读改过的文件和测试输出：改完之后是否跑过测试且通过、是否改了不该改的地方。',
  debugging: '读失败输出和修后输出：修之前有没有复现、修完同一步骤是否通过。',
  environment: '读检测命令的输出：结论是否来自本轮真实数据，而不是旧记录。',
  publish: '打开公开地址（web_fetch）：外面是否真能打开、内容对不对。',
  writing: '逐条核对用户的硬要求（字数、行数、语气、必须有的内容），用下面的机械统计。',
  ideas: '方向是否真的不同、有没有明确推荐、是否满足用户给的限制。',
};

// 本轮做出来的文件（绝对路径）共同所在的文件夹；路径太散（只剩 / 或主目录）就不给。
function workFolder(files = []) {
  const dirs = files.map(String).filter(file => path.isAbsolute(file)).map(file => path.dirname(file).split(path.sep));
  if (!dirs.length) return '';
  const common = [];
  for (let i = 0; i < dirs[0].length; i += 1) {
    if (dirs.every(parts => parts[i] === dirs[0][i])) common.push(dirs[0][i]); else break;
  }
  const folder = common.join(path.sep);
  return common.length >= 4 && folder !== os.homedir() ? folder : '';
}

export function auditPrompt({message, history, reply, evidence, independent, quality = false, workKind = '', artifacts = [], tools = false, earlier = '', previous = []}) {
  const answers = Array.isArray(independent) ? independent.filter(Boolean) : independent ? [independent] : [];
  const mode = workKind ? solverModeFor([workKind]) : 'answer';
  const answerText = answers.map((text, index) => (answers.length > 1 ? `〔${mode === 'checklist' ? '验收清单' : mode === 'draft' ? '对照稿' : '独立解答'} ${index + 1}〕\n${text}` : text)).join('\n\n');
  const independentTitle = mode === 'checklist'
    ? '【其他助手独立写的验收清单（逐条拿来核对成品）】'
    : mode === 'draft' ? '【其他助手独立写的一版（只作对照，不要求一致）】'
      : '【其他助手不看回复、独立做出的解答（只作对照，不一定对）】';
  const focus = REVIEW_FOCUS[workKind] || '';
  const files = (Array.isArray(artifacts) ? artifacts : []).filter(Boolean).slice(0, 16);
  const folder = workFolder(files);
  // 打回之后的复核要收敛：先追上一轮指出的问题，新问题只报会让结果出错的。每一轮都翻出新的小毛病，
  // 用户会连着收到几条「更正」，而成品并没有变好。
  const raised = (Array.isArray(previous) ? previous : []).filter(item => item && String(item.what || '').trim()).slice(0, 5);
  return [
    quality
      ? '你是严格的审稿人兼交付验收员。你的工作是找出这份回复里真实存在的错误和缺漏，不重写回答。'
      : '你是交付验收员，只做核对，不重写回答，也不给新建议。',
    `【最近对话（只用来理解上下文）】\n${history || '无'}`,
    `【用户这一轮的原话】\n${message}`,
    earlier ? `【之前已经交给用户的回复】\n${earlier}` : '',
    raised.length ? `【上一轮你指出的问题（这一轮先逐条核对它们改了没有）】\n${raised.map((item, index) => `${index + 1}. ${item.what}${item.fix ? `（当时要求：${item.fix}）` : ''}`).join('\n')}` : '',
    `【${earlier ? '这次补充的更正' : '助手的最终回复'}】\n${reply}`,
    `【回复的机械统计（程序算出，准确；涉及字数、行数、句数的要求以这里为准，不要自己数）】\n${replyFacts(earlier ? `${earlier}\n${reply}` : reply)}`,
    `【本轮实际发生的工具调用和结果（节选，只有这里的内容算执行证据）】\n${evidence}`,
    workKind ? `【这是一件「${kindLabel(workKind)}」】${focus}` : '',
    tools && (files.length || isHandsOnKind(workKind))
      ? `【本轮做出来的文件和截图】\n${files.length ? files.map(file => `- ${file}`).join('\n') : '（工具记录里没认出路径，先在工作目录里找本轮做出来的成品）'}\n你可以用 read / pdf / image 打开它们，web_fetch 打开公开网址。动手的活必须打开交付物本身核对，不能只看工具记录；打不开（格式不支持、路径不对）时不要据此判不通过，只报告你真打开看到的问题。`
      : '',
    // 审稿员自己的当前目录是模式的工作区，不是绑定的项目文件夹（11-02 隔离实测 K-script-marathon：
    // 按工作区去读 cli.py，报「文件不存在」，打回了一个没问题的回复）。
    folder ? `【本轮做文件的文件夹】${folder}\n回复里的相对路径和「python3 cli.py」这类命令，都按这个文件夹理解，不按你自己的当前目录。` : '',
    answerText ? `${independentTitle}\n${answerText}` : '',
    [
      '逐项核对：',
      '1. 用户明确提出的每一个要求（数量、格式、字数、范围、文件位置、必须有和不能有的内容）是否都满足了；有数字的要真的数。',
      '2. 回复里每个「已完成 / 已修复 / 测试通过 / 已生成 / 已写入 / 已发送」这类说法，在工具记录里有没有对应的真实结果；没有记录或记录显示失败，就是问题。',
      '3. 回复里的数字、事实、计算和文件内容，是否与工具结果矛盾；文件不存在、命令失败时是否编造了结果。',
      answerText ? (mode === 'checklist'
        ? '4. 拿验收清单逐条核对成品：清单里和用户要求直接相关的条目没做到、而且你打开成品确认了，就是问题；清单本身多余或拿不准的条目不算。'
        : '4. 回复的关键结论与独立解答是否冲突；冲突时，用工具结果或你自己可复核的推导判断哪边有错，判断不了也算问题，要求重新核实。') : '',
      quality ? '5. 正确性：自己把关键计算、推理和结论重新做一遍；发现算错、推错、概念用错、引用了不存在的事实，就是问题。' : '',
      quality ? '6. 完整性：漏掉了会改变结论的情况、边界条件或反例；该给理由却只给结论；回答了别的问题。' : '',
      '用户要的是成品，却只给了计划或建议，也算问题。',
      '成品是文件（代码、文档、网页、图片）时，回复说清放在哪、怎么用就够了；不要求把文件内容（源码、全文）贴进回复。',
      '只报告有具体依据的问题（引用原文、工具记录、你打开文件看到的具体位置，或写出你能复核的推导）。语气、风格、可有可无的改进、你自己拿不准的猜测，都不算问题。',
      raised.length ? '这是打回之后的复核：先逐条确认上一轮的问题是否已经改正，改了的不再提。新问题只报三种——结果或结论是错的、漏了用户明确提出的硬要求、把没做的事说成做了；措辞、排版、可改可不改的地方，这一轮一律不提。' : '',
    ].filter(Boolean).join('\n'),
    '只输出一个 JSON 对象，不要 Markdown：全部通过时输出 {"pass": true}；否则输出 {"pass": false, "issues": [{"what": "哪里不对（引用回复原文）", "evidence": "依据（引用用户原话、工具记录、打开文件看到的内容或你的推导）", "fix": "应该怎么改"}]}，最多 5 条。',
  ].filter(Boolean).join('\n\n');
}

// 交付验收在回复已经交给用户之后才做：打回时只发更正，不把整段回答再发一遍（REPORT 第九节：重复回复）。
export function fixMessage(issues = [], requestId = '') {
  const list = issues.map((item, index) => `${index + 1}. ${item.what}（依据：${item.evidence}${item.fix ? `；应改为：${item.fix}` : ''}）`).join('\n');
  const identity = /^[\w-]{8,100}$/.test(requestId) ? ` [request=${requestId}]` : '';
  return `${FIX_PREFIX}${identity}：上一条回复还有下面几处具体问题。逐条核实——依据可能有错，先用工具或重新推导确认；确认是问题的就改正，确认不是的保持原样。需要就重新运行、读取或查证，拿到真实结果；没法解决的照实说明卡在哪里。上一条回复用户已经看到了，所以只发更正：先用一句话说清改了什么，再给出改正后的那部分；问题牵动全文（字数、格式、结构、整体结论）时才给出完整的新版本。核实后都不是问题，就只回一句「核对过了，上面的回复不用改」。不要提到验收、检查或这条消息。\n${list}`;
}

// 补强提示按活儿种类写：答题类拆要求、找易错、想验证；动手的活先写验收清单，做完逐条用工具核对。
function briefContext(recipe, workKind = '', workTier = '') {
  const level = LABELS[recipe.level] || recipe.level;
  const native = LABELS[recipe.native] || recipe.native;
  const hands = isHandsOnKind(workKind);
  // 选了更快的思考等级，又选了带验收的做事档位：两句话不能打架。省的是话，不是核对。
  if (recipe.concise) {
    return `这一条用户选了更快的「${level}」，同时开了「${tierName(workTier)}」。回复写短：直接给结论，不铺垫、不复述问题、不展开推导（用户要求时除外）。但这一档要的核对一步都不能省——该打开看的、该跑的、该重算的照做，省的只是话。`;
  }
  if (recipe.brevity) {
    return `这一条用户选了更快的「${level}」，但当前模型最低只能用「${native}」思考。请尽量快：直接给结论，不铺垫、不复述问题、不展开推导（用户要求时除外）；需要工具时照常使用，但只做必要的一两步。${hands ? '动手的活仍要做最必要的一次验证（打开、截图或运行一次），不能为了快说没做过的事。' : ''}`;
  }
  if (recipe.think) {
    // 交前自查（High 起）：开了交付验收时由验收那段话代说；动手的活上面已经要求逐条用工具核对。
    const selfCheck = recipe.selfCheck && !recipe.audit && !hands
      ? '写完先别交：对着用户的每条要求逐条核一遍，关键数字和结论换一种方法再验一次，对不上就改，拿不准的地方照实标出来。'
      : '';
    return hands
      ? `这一条用户选了「${level}」，当前模型的原生思考最高只到「${native}」。动手前先在心里写一张验收清单：用户的每条要求、这一行交付前会查的点、最容易翻车的地方，每条想好用什么工具核对；做完逐条用工具核对（打开、截图、转成图片、运行或重算），不合格就改。正文不写这张清单。`
      : `这一条用户选了「${level}」，当前模型的原生思考最高只到「${native}」。回答前先把问题拆清楚：列出用户的每条要求和关键约束、找出最容易出错的地方、想好至少一种验证方法；需要计算的真的算出来。${selfCheck}正文只写结论和必要依据，不要把这段拆解过程写出来。`;
  }
  return '';
}

function newJob(role, label, ref) {
  return {id: `${role}-${randomUUID().slice(0, 6)}`, role, label, model: ref ? `${ref.provider}/${ref.model}` : '', state: 'running', startedAt: Date.now(), endedAt: 0, summary: '', output: ''};
}

function summaryOf(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

// 一次 pass 的会话文件（JSONL）里，审稿员实际调用过的工具和打开过的文件。读不到就当没用过。
async function passToolUse(file) {
  try {
    const rows = String(await fs.readFile(file, 'utf8')).split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const entries = entriesFromMessages(rows.map((row) => row.message || row));
    const opened = entries.filter((entry) => entry.ok).flatMap((entry) => ['path', 'file_path', 'image', 'url']
      .map((key) => entry.params?.[key]).filter((value) => typeof value === 'string' && value));
    return {tools: [...new Set(entries.map((entry) => entry.name).filter(Boolean))].slice(0, 12), opened: [...new Set(opened)].slice(0, 16)};
  } catch {
    return {tools: [], opened: []};
  }
}

// 九档补强和四档思考强度同时选：份数和轮数只在 run-contract 里取大。
function mergeRecipe(first = {}, second = {}) {
  return mergeLayers(first, second);
}

export class ReasoningEnhancer {
  constructor(api, {runProcess = null, cliEntry = '', isBusy = () => false, readyForReview = () => true, tierViews = () => [], store = new ReviewStore(), critics = null} = {}) {
    this.api = api;
    this.runProcess = runProcess;
    this.cliEntry = cliEntry;
    this.isBusy = isBusy;
    this.readyForReview = readyForReview;
    // 做事档位派出去、已经交回来的独立做法（求解 / 独立起草 / 独立复算）：[{role, text}]。验收时和九档自己补的放在一起对照。
    this.tierViews = tierViews;
    this.store = store;
    this.critics = critics;
    this.completed = new Map();
    // 只在本实例内有效的东西：独立解答的进行中任务、可取消的请求。
    this.independent = new Map();
    this.controllers = new Map();
    // 兼容旧调用方式：intents.get / intents.set 读写的都是磁盘上的同一份状态。
    this.intents = {
      get: (sessionKey) => this.store.get(sessionKey),
      set: (sessionKey, intent) => this.store.set({...intent, sessionKey}),
      delete: (sessionKey) => this.store.delete(sessionKey),
    };
  }

  controller(requestId) {
    let controller = this.controllers.get(requestId);
    if (!controller) {
      controller = new AbortController();
      this.controllers.set(requestId, controller);
      if (this.controllers.size > 50) this.controllers.delete(this.controllers.keys().next().value);
    }
    return controller;
  }

  mainRef(sessionKey) {
    const agentId = sessionKey.split(':')[1];
    const entry = this.api.runtime?.agent?.session?.getSessionEntry?.({sessionKey, agentId, readConsistency: 'latest'});
    return {...modelRef(this.api.config, entry, agentId), entry};
  }

  // 默认就是当前会话选的模型。
  criticFor(main) {
    const configured = this.critics || this.api.pluginConfig?.reasoning?.criticModels;
    return Array.isArray(configured) && configured.length ? criticRef(this.api.config, main, configured) : {...main};
  }

  // 这一档在当前会话模型上的做法；网关和运行时两个实例算出来的一样。
  recipe(sessionKey, level, message = '') {
    return this.routePlan(sessionKey, level, message).recipe;
  }

  routePlan(sessionKey, level, message = '') {
    const {provider, model} = this.mainRef(sessionKey);
    let target = model, record = catalogRecord(this.api.config, provider, model);
    if (fixedEndpointLevel(record)) {
      const family = model.replace(/-(low|medium|high)$/, '');
      const available = (this.api.config?.models?.providers?.[provider]?.models || []).filter(item =>
        item.available !== false && fixedEndpointLevel(item) && item.id.replace(/-(low|medium|high)$/, '') === family);
      const levels = [...new Set(available.map(fixedEndpointLevel))].sort((a,b) => RANK.get(a)-RANK.get(b));
      const requested = level === 'adaptive' ? {hard: 'high', normal: 'medium', easy: 'low'}[adaptiveBand(message, sessionKey)] : level;
      const native = nearestNative(requested, levels);
      const candidate = available.find(item => fixedEndpointLevel(item) === native);
      if (candidate) { target = candidate.id; record = candidate; }
    }
    const recipe = recipeFor(level, record, {message, sessionKey});
    return {recipe, thinkingLevel: fixedEndpointLevel(record) ? 'off' : recipe.native,
      ...(target !== model ? {model: `${provider}/${target}`} : {})};
  }

  // 发送前调用：只登记「这一条要怎么做」，立即返回，不挡住发送。
  // level 是滑块上的 9 档之一；旧的 tier=max/ultra 照旧可用。
  async prepare(params = {}) {
    const sessionKey = String(params.sessionKey || '');
    const level = String(params.level || params.tier || '');
    const requestId = String(params.requestId || '');
    const runId = unrestrictedSession(sessionKey) ? '' : String(params.runId || '');
    const explicitTier = !unrestrictedSession(sessionKey) && Object.hasOwn(params, 'workTier');
    const requestedWorkTier = explicitTier ? String(params.workTier || '') : '';
    const message = String(params.message || '').trim();
    if (!SESSION_KEY.test(sessionKey) || !RANK.has(level) || !/^[\w-]{8,100}$/.test(requestId)) {
      throw new Error('增强档位请求无效');
    }
    if ((runId && (runId.length > 200 || /\s/.test(runId)))
        || (explicitTier && requestedWorkTier && !['base', 'boost', 'full', 'marathon'].includes(requestedWorkTier))) {
      throw new Error('运行编号或思考强度无效');
    }
    if (!message || message.length > MAX_MESSAGE) throw new Error('本条文字过长或为空，无法安全执行增强审阅');
    const done = this.completed.get(requestId);
    if (done) {
      if (done.sessionKey !== sessionKey || done.level !== level || done.message !== message
          || done.runId !== runId || done.workTier !== requestedWorkTier) throw new Error('增强档位请求编号重复，已拒绝复用旧审阅');
      return done.result;
    }
    if (!unrestrictedSession(sessionKey)) {
      const existing = this.store.get(sessionKey, {requestId});
      if (existing) {
        const original = existing.preparedParams;
        if (!original || !existing.preparedResult || existing.level !== level || existing.message !== message
            || original.runId !== runId || original.explicitTier !== explicitTier || original.workTier !== requestedWorkTier) {
          throw new Error('增强档位请求编号重复，已拒绝复用旧审阅');
        }
        return existing.preparedResult;
      }
    }
    const boundRun = runId ? this.store.get(sessionKey, {runId}) : null;
    if (boundRun && boundRun.requestId !== requestId) throw new Error('运行编号已绑定其他消息');
    const {recipe: routed, thinkingLevel, ...route} = this.routePlan(sessionKey, level, message);
    // 力气跟着活走：纯寒暄不拆题、不派独立做法、不验收（无限制模式保持原样）。
    const weight = unrestrictedSession(sessionKey) ? 'task' : messageWeight(message);
    const social = weight === 'social';
    const recipe = social ? proportion(routed, 'social') : routed;
    const summary = {level, kind: recipe.kind, native: recipe.native, solvers: recipe.solvers, critic: recipe.critic, rounds: recipe.rounds,
      brevity: recipe.brevity, think: recipe.think, ...(recipe.as ? {as: recipe.as, difficulty: recipe.difficulty} : {}), ...(weight !== 'task' ? {weight} : {})};
    let result;
    if (social) {
      // 界面对 Max / Ultra 要求「登记成功」才发送：照常回 prepared，只是这一条什么都不加、什么都不存。
      // 之前单独选好的做事档位留给发送那一刻处理（beforePromptBuild 见到寒暄会把它收掉）。
      result = hasLayers(routed)
        ? {prepared: true, tier: level, mode: 'prompt', passes: 0, rounds: 0, crossCheck: false, recipe: summary, thinkingLevel, ...route}
        : {prepared: false, recipe: summary, thinkingLevel, ...route};
      if (explicitTier) {
        for (const pending of this.store.list(sessionKey)) {
          if (pending.phase === 'armed' && pending.workTier && !pending.message) this.store.delete(sessionKey, pending.requestId);
        }
      }
    } else if (!hasLayers(recipe) && !(explicitTier && WORK_TIERS[requestedWorkTier])) {
      if (explicitTier) {
        for (const pending of this.store.list(sessionKey)) {
          if (pending.phase === 'armed' && pending.workTier && !pending.message) this.store.delete(sessionKey, pending.requestId);
        }
      }
      result = {prepared: false, recipe: summary, thinkingLevel, ...route};
    } else {
      // The work-tier arm is consumed by the next preparation; reviews that
      // already belong to another message stay untouched.
      const legacy = unrestrictedSession(sessionKey);
      const previous = legacy ? this.store.get(sessionKey) : null;
      const pending = legacy
        ? (legacyMergeable(previous) && previous.workTier && !previous.message ? previous : null)
        : this.store.list(sessionKey).find(intent => intent.phase === 'armed' && intent.workTier && !intent.message
          && (!explicitTier || intent.workTier === requestedWorkTier));
      if (legacy && previous && previous.requestId !== requestId && !pending) {
        this.controllers.get(previous.requestId)?.abort();
        this.store.delete(sessionKey);
      }
      const workTier = explicitTier ? (WORK_TIERS[requestedWorkTier] ? requestedWorkTier : '') : pending?.workTier || '';
      const work = pending?.recipe || (workTier ? {level: workTier, kind: 'work', native: '', ...NO_LAYERS, ...WORK_TIERS[workTier], audit: true} : null);
      const merged = workTier ? mergeRecipe(recipe, work) : recipe;
      const workKinds = workKindsFor(message, sessionKey);
      result = {prepared: true, tier: level, mode: merged.audit ? 'delivery-review' : 'prompt', passes: 0, rounds: merged.rounds, crossCheck: merged.solvers > 0,
        recipe: summary, thinkingLevel, ...route, ...(workTier ? {workTier, merged: true} : {})};
      this.store.set({
        requestId, tier: level, level, recipe: merged, message, sessionKey, history: historyText(params.history),
        phase: 'armed', round: 0, maxRounds: merged.rounds, crossCheck: merged.solvers > 0, issues: [], jobs: [], createdAt: Date.now(),
        workTier, workKinds, workKind: workKinds[0] || '', runId, weight,
        preparedParams: {runId, explicitTier, workTier: requestedWorkTier}, preparedResult: result,
      });
      if (explicitTier) {
        for (const old of this.store.list(sessionKey)) {
          if (old.phase === 'armed' && old.workTier && !old.message) this.store.delete(sessionKey, old.requestId);
        }
      } else if (pending) this.store.delete(sessionKey, pending.requestId);
    }
    this.completed.set(requestId, {sessionKey, level, message, runId, workTier: requestedWorkTier, result});
    if (this.completed.size > 200) this.completed.delete(this.completed.keys().next().value);
    return result;
  }

  // 后台工作的一行：落盘，供小面板读。
  updateJob(sessionKey, requestId, job, patch = {}) {
    const intent = this.store.get(sessionKey, {requestId});
    if (!intent) return;
    const jobs = Array.isArray(intent.jobs) ? intent.jobs : [];
    const index = jobs.findIndex((item) => item.id === job.id);
    const next = {...(index >= 0 ? jobs[index] : job), ...patch};
    if (index >= 0) jobs[index] = next; else jobs.push(next);
    intent.jobs = jobs.slice(-24);
    this.store.set(intent);
  }

  async runJob(intent, job, ref, prompt, {thinkLevel} = {}) {
    this.updateJob(intent.sessionKey, intent.requestId, job);
    try {
      const output = await this.pass(intent.sessionKey, prompt, this.controller(intent.requestId).signal, {ref, thinkLevel});
      this.updateJob(intent.sessionKey, intent.requestId, job, {state: output ? 'done' : 'failed', endedAt: Date.now(), summary: summaryOf(output) || '没有返回内容', output});
      return output;
    } catch (error) {
      this.updateJob(intent.sessionKey, intent.requestId, job, {state: 'failed', endedAt: Date.now(), summary: summaryOf(error?.message || '失败')});
      throw error;
    }
  }

  // 主回答进行的同时，做几份不带工具、各用一种做法的独立解答，不增加等待。
  startIndependent(intent) {
    if (this.independent.has(intent.requestId)) return;
    const recipe = intent.recipe || {};
    // 做事档位自己派出去的那几份不重复做：九档只补还差的（settleRecipe 定的 engineSolvers），做法从没用过的那种开始。
    const count = Math.max(0, Number(recipe.engineSolvers ?? recipe.solvers) || 0);
    if (!count) return;
    const all = this.launchIndependent(intent, count, Number(recipe.tierViews) || 0);
    this.independent.set(intent.requestId, all);
    if (this.independent.size > 20) this.independent.delete(this.independent.keys().next().value);
  }

  // 起 count 份独立做法，做法从第 offset 种开始；返回拿到内容的那几份。
  launchIndependent(intent, count, offset = 0) {
    let main = null;
    try { main = this.mainRef(intent.sessionKey); } catch {}
    const jobs = [];
    const workKind = intent.workKind || '';
    const mode = solverModeFor([workKind]);
    const title = mode === 'checklist' ? '验收清单' : mode === 'draft' ? '独立起草' : '独立解答';
    for (let step = 0; step < count; step += 1) {
      // 几份都用当前模型，各用一种做法，避免犯同一个错；动手的活写验收清单，文案点子写对照稿。
      const index = offset + step;
      const label = `${title} ${['①', '②', '③'][index] || index + 1} · ${SOLVER_LABELS[mode][index % 3]}`;
      const job = newJob('solver', label, main);
      const ref = main;
      const prompt = solverPrompt({message: subjectOf(intent), history: intent.history, index, workKind});
      jobs.push(this.runJob(intent, job, ref, prompt).catch(() => ''));
    }
    return Promise.all(jobs).then((answers) => answers.filter(Boolean));
  }

  // 思考强度档位：选档后下一条真实用户消息开启验收（消息内容到发送时才知道）。
  // 九档补强已经为这一条登记过（prepare 在前）：合并进同一个验收，只在整个档位任务结束后审一次。
  canBindTier(sessionKey, requestId) {
    const intent = this.store.get(sessionKey, {requestId});
    return Boolean(intent && intent.phase === 'armed' && !WORK_TIERS[intent.level]);
  }

  armTier(sessionKey, tier, {requestId = ''} = {}) {
    if (!SESSION_KEY.test(sessionKey) || !WORK_TIERS[tier]) {
      if (unrestrictedSession(sessionKey)) this.cancel({sessionKey});
      return {armed: false};
    }
    // A caller that prepares first can explicitly name the same request.
    // Without an ID, guessing from a previous message attaches a newly
    // selected tier to the wrong queued/running request.
    const legacy = unrestrictedSession(sessionKey);
    const previous = legacy ? this.store.get(sessionKey) : requestId ? this.store.get(sessionKey, {requestId}) : null;
    if (!legacy && requestId && !this.canBindTier(sessionKey, requestId)) return {armed: false};
    const work = {level: tier, kind: 'work', native: '', ...NO_LAYERS, ...WORK_TIERS[tier], audit: true};
    const canMerge = legacy ? legacyMergeable(previous) && previous.message : previous?.phase === 'armed';
    if (canMerge && !WORK_TIERS[previous.level]) {
      const recipe = mergeRecipe(previous.recipe, work);
      const value = this.store.set({...previous, workTier: tier, recipe, maxRounds: recipe.rounds, crossCheck: recipe.solvers > 0});
      return {armed: true, requestId: value.requestId, merged: true};
    }
    if (legacy && previous) {
      this.controllers.get(previous.requestId)?.abort();
      this.store.delete(sessionKey);
    }
    // Re-selecting a tier replaces only a not-yet-bound selection.
    for (const intent of this.store.list(sessionKey)) {
      if (intent.phase === 'armed' && intent.workTier && !intent.message) this.store.delete(sessionKey, intent.requestId);
    }
    const value = this.store.set({
      requestId: `tier-${tier}-${randomUUID().slice(0, 8)}`, tier, level: tier, recipe: work, message: '', sessionKey, history: '',
      phase: 'armed', round: 0, maxRounds: work.rounds, crossCheck: work.solvers > 0, issues: [], jobs: [], createdAt: Date.now(),
      workTier: tier, workKinds: [], workKind: '',
    });
    return {armed: true, requestId: value.requestId};
  }

  cancel(params = {}) {
    const sessionKey = String(params.sessionKey || '');
    const requestId = String(params.requestId || '');
    const intents = this.store.list(sessionKey).filter(intent => !requestId || intent.requestId === requestId);
    if (!intents.length) return {cancelled: false};
    for (const intent of intents) {
      this.controllers.get(intent.requestId)?.abort();
      this.store.delete(sessionKey, intent.requestId);
    }
    return {cancelled: true};
  }

  status(params = {}) {
    const intent = this.store.get(String(params.sessionKey || ''), {requestId: String(params.requestId || ''), runId: String(params.runId || '')});
    if (!intent) return {phase: 'idle'};
    const recipe = intent.recipe || {};
    return {
      phase: intent.phase, tier: intent.tier, level: intent.level || intent.tier, round: intent.round, maxRounds: intent.maxRounds,
      workTier: intent.workTier || '', workKind: intent.workKind || '', runId: intent.runId || '',
      issues: (intent.issues || []).length, requestId: intent.requestId, updatedAt: intent.updatedAt,
      recipe: {kind: recipe.kind, native: recipe.native, solvers: recipe.solvers, critic: recipe.critic, rounds: recipe.rounds, as: recipe.as,
        ...(recipe.brevity || recipe.concise ? {brief: true} : {}),
        ...(recipe.tierViews ? {tierViews: recipe.tierViews, engineSolvers: recipe.engineSolvers || 0} : {})},
      ...(intent.weight && intent.weight !== 'task' ? {weight: intent.weight} : {}),
      jobs: (intent.jobs || []).map(({output, ...job}) => ({...job, hasOutput: Boolean(output)})),
    };
  }

  job(params = {}) {
    const intents = this.store.list(String(params.sessionKey || ''));
    const job = intents.flatMap(intent => intent.jobs || []).find((item) => item.id === String(params.jobId || ''));
    if (!job) return {found: false};
    return {found: true, ...job};
  }

  beforePromptBuild(event = {}, ctx = {}) {
    const sessionKey = String(ctx.sessionKey || '');
    const prompt = String(event.prompt || '').trim();
    const runId = String(ctx.runId || event.runId || '');
    const intents = this.store.list(sessionKey);
    const matchesPrompt = intent => intent.message ? prompt === intent.message || prompt.endsWith(intent.message) : Boolean(prompt) && !CONTROL_PROMPT.test(prompt);
    const fixId = prompt.startsWith(FIX_PREFIX) ? /\[request=([\w-]{8,100})\]/.exec(prompt)?.[1] || '' : '';
    const fixing = prompt.startsWith(FIX_PREFIX) ? intents.filter(item => item.phase === 'fixing' && (!fixId || item.requestId === fixId)) : [];
    const intent = unrestrictedSession(sessionKey) ? this.store.get(sessionKey)
      : (runId && this.store.get(sessionKey, {runId}))
        || (fixing.length === 1 ? fixing[0] : null)
        || intents.find(item => item.phase === 'armed' && (!runId || !item.runId || item.runId === runId) && matchesPrompt(item));
    if (!intent) return;
    // Only an unused selection may expire in work modes. An active review
    // can legitimately need a correction after a long-running task.
    if ((unrestrictedSession(sessionKey) || intent.phase === 'armed') && Date.now() - intent.createdAt > INTENT_TTL_MS) {
      this.store.delete(sessionKey, intent.requestId); return;
    }
    const matches = matchesPrompt(intent);
    const stored = intent.recipe || {...NO_LAYERS, audit: true, solvers: intent.crossCheck ? 1 : 0, rounds: intent.maxRounds};
    if (intent.phase === 'armed' && matches) {
      const legacy = unrestrictedSession(sessionKey);
      if (runId && !legacy) intent.runId = runId;
      if (!intent.message) intent.message = prompt.slice(0, MAX_MESSAGE);
      // 力气跟着活走：单独选了做事档位、发来的却只是寒暄，这一条什么都不加。
      const weight = legacy ? 'task' : messageWeight(intent.message);
      if (weight === 'social') { this.store.delete(sessionKey, intent.requestId); return; }
      if (!intent.history) intent.history = historyFromMessages(event.messages);
      // 只说「继续」「好的」：要核对的是它接着做的那件事，种类也按那件事认。
      if (weight === 'carry' && !intent.task) intent.task = lastTaskFromMessages(event.messages);
      if (!Array.isArray(intent.workKinds) || !intent.workKinds.length || intent.task) {
        intent.workKinds = workKindsFor(intent.task || intent.message, sessionKey);
        intent.workKind = intent.workKinds[0] || '';
      }
      if (typeof ctx.workspaceDir === 'string' && path.isAbsolute(ctx.workspaceDir)) intent.workspaceDir = ctx.workspaceDir;
      const recipe = legacy ? stored : settleRecipe(stored, {workTier: intent.workTier || '', kinds: intent.workKinds, weight, hasTask: weight !== 'carry' || Boolean(intent.task)});
      intent.recipe = recipe;
      intent.weight = weight;
      const parts = [];
      const brief = briefContext(recipe, intent.workKind, intent.workTier || '');
      if (brief) parts.push(`[pinkie:effort level=${recipe.level}]\n${brief}`);
      if (recipe.audit) {
        intent.phase = 'answering';
        intent.jobs = [newJob('main', '碧琪主回答', null)];
        this.store.set(intent);
        this.startIndependent(intent);
        parts.push(`${REVIEW_MARK} tier=${intent.tier}]\n这一条开启了交付验收：最终回复会被独立核对——用户的每条要求是否满足、每个「完成 / 通过 / 已生成」的说法是否有本轮真实的工具结果${recipe.critic ? '、结论和推导是否正确' : ''}${isHandsOnKind(intent.workKind) ? '；审稿员会打开你做出来的文件和截图本身看' : ''}。回复前先自己逐条对一遍。不要在回复里提到验收。`);
      } else {
        // 只加一段提示的档位：用完即弃。
        this.store.delete(sessionKey, intent.requestId);
      }
      return parts.length ? {appendContext: parts.join('\n\n')} : undefined;
    }
    if (intent.phase === 'fixing' && prompt.startsWith(FIX_PREFIX)) {
      if (runId && !unrestrictedSession(sessionKey)) intent.runId = runId;
      intent.phase = 'answering';
      this.store.set(intent);
      this.updateJob(sessionKey, intent.requestId, newJob('fix', `按批评更正 · 第 ${intent.round} 轮`, null));
    }
  }

  async pass(sessionKey, prompt, signal, {ref = null, thinkLevel, tools = false, workspaceDir: cwd = '', onTools = null} = {}) {
    const api = this.api;
    const agentId = sessionKey.split(':')[1];
    const main = this.mainRef(sessionKey);
    const target = ref || main;
    const sameAsMain = target.provider === main.provider && target.model === main.model;
    // 审稿要能打开本轮做出来的文件：用会话真正的工作目录（项目绑定时 OpenClaw 给的就是项目那边），其次是模式工作区。
    const workspaceDir = (cwd && path.isAbsolute(cwd) ? cwd : '') || (api.config ? agentWorkspace(api.config, agentId) : '') || process.cwd();
    // 认证配置只对主模型那家有效；换模型时让运行时自己选。
    const authProfileId = sameAsMain ? main.entry?.authProfileOverride || undefined : undefined;
    const record = catalogRecord(api.config, target.provider, target.model);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pinkie-reasoning-'));
    try {
      const id = randomUUID();
      const result = await api.runtime.agent.runEmbeddedAgent({
        sessionId: `pinkie-reasoning-${id}`,
        sessionKey: `agent:${agentId}:internal-session-effects:pinkie-reasoning-${id}`,
        sessionFile: path.join(tempDir, 'pass.json'),
        workspaceDir,
        config: api.config,
        prompt,
        timeoutMs: PASS_TIMEOUT_MS,
        runId: `pinkie-reasoning-${id}`,
        provider: target.provider,
        model: target.model,
        agentId,
        authProfileId,
        authProfileIdSource: authProfileId ? 'user' : 'auto',
        // 用户要的是质量：独立解答和批评都用这个模型最高的思考档。
        thinkLevel: thinkLevel || bestEffort(record),
        // 独立解答不带工具（它不替主回答动手），走裸模型调用；审稿带只读工具，能打开截图、文档和网页，
        // 不能执行命令、写文件或操作浏览器（OpenClaw 的 toolsAllow 只留这几样）。
        // 审稿不能用 modelRun：OpenClaw 把裸模型调用的工具全部关掉（disableTools || isRawModelRun），
        // toolsAllow 就一个都匹配不上，审稿直接报错。改用普通调用 + 不注入工作区手册（lightweight）；
        // 有 toolsAllow 时 OpenClaw 自动用精简系统提示、不带技能清单。
        ...(tools
          ? {disableTools: false, toolsAllow: [...REVIEW_TOOLS], bootstrapContextMode: 'lightweight'}
          : {modelRun: true, disableTools: true}),
        disableMessageTool: true,
        // 走子代理通道：全局 main 通道只有 4 个位置，Ultra 的 3 份独立解答 + 批评挤在里面，
        // 会把用户其他对话（以及并发的档位任务）排队到几分钟后。
        lane: 'subagent',
        abortSignal: signal,
      });
      if (signal?.aborted) throw new Error('增强审阅已取消');
      // 审稿员用了哪些只读工具、打开了哪些文件：记录在这次 pass 的会话文件里，删之前读出来给面板和实测核对。
      if (tools && typeof onTools === 'function') onTools(await passToolUse(path.join(tempDir, 'pass.json')));
      return outputText(result);
    } finally {
      await fs.rm(tempDir, {recursive: true, force: true}).catch(() => {});
    }
  }

  // 批评：先用换的模型；它失败了再用主模型兜底，不让一次网络问题跳过整轮核对。
  async critique(intent, prompt, signal) {
    const recipe = intent.recipe || {};
    let main = null;
    try { main = this.mainRef(intent.sessionKey); } catch {}
    const preferred = recipe.critic && main ? this.criticFor(main) : main;
    const label = recipe.critic ? '批评 + 交付验收' : '交付验收';
    const job = newJob('critic', intent.round ? `${label} · 第 ${intent.round + 1} 次` : label, preferred);
    this.updateJob(intent.sessionKey, intent.requestId, job);
    const attempts = [preferred];
    if (main && preferred && (preferred.provider !== main.provider || preferred.model !== main.model)) attempts.push(main);
    let lastError = null;
    for (const ref of attempts) {
      try {
        let used = {tools: [], opened: []};
        const output = await this.pass(intent.sessionKey, prompt, signal, {ref, tools: true, workspaceDir: intent.workspaceDir || '', onTools: (value) => { used = value; }});
        const verdict = parseVerdict(output);
        if (!verdict) { lastError = new Error('批评结果格式不对'); continue; }
        const summary = verdict.pass ? '通过' : `发现 ${verdict.issues.length} 处问题：${summaryOf(verdict.issues[0]?.what)}`;
        this.updateJob(intent.sessionKey, intent.requestId, job, {state: 'done', endedAt: Date.now(), model: ref ? `${ref.provider}/${ref.model}` : job.model, summary, output,
          toolsUsed: used.tools, opened: used.opened});
        return verdict;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) break;
      }
    }
    this.updateJob(intent.sessionKey, intent.requestId, job, {state: 'failed', endedAt: Date.now(), summary: summaryOf(lastError?.message || '失败')});
    return null;
  }

  // 主回复结束后调用（index.mjs 在确认没有重试、没有被拦截之后才调用）。
  async agentEnded(event = {}, ctx = {}) {
    const sessionKey = String(ctx.sessionKey || '');
    const runId = String(ctx.runId || event.runId || '');
    const legacy = unrestrictedSession(sessionKey);
    let intent = legacy ? this.store.get(sessionKey) : runId ? this.store.get(sessionKey, {runId}) : null;
    if (!intent) {
      // Some older hosts omit runId at prompt-build time. Only use an
      // unbound record if it is the sole possible answering run.
      const answering = this.store.list(sessionKey).filter(item => item.phase === 'answering' && (!runId || !item.runId));
      if (answering.length === 1) intent = answering[0];
    }
    if (!intent || intent.phase !== 'answering') return {reviewed: false};
    if (runId && !intent.runId && !legacy) { intent.runId = runId; this.store.set(intent); }
    // 档位任务还在续跑（子任务、检查点续跑）时不验收，等整个任务交付后再核对。
    if (!this.readyForReview(sessionKey)) return {reviewed: false, waiting: true};
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const reply = finalReply(messages);
    // 内部轮（后台任务完成通知、运行时事件）以 NO_REPLY 静默收尾：这一轮什么也没交给用户，不拿它验收，
    // 也不结束这次验收，等真正交付的那条回复再审（11-02 隔离实测 K-poster-full：审稿员看到 NO_REPLY，
    // 判成「没交付」，逼碧琪把已经发出的整份终稿又发了一遍）。
    if (SILENT_REPLY.test(reply)) return {reviewed: false, silent: true};
    for (const job of intent.jobs || []) {
      if ((job.role === 'main' || job.role === 'fix') && job.state === 'running') {
        this.updateJob(sessionKey, intent.requestId, job, {state: event.success === false ? 'failed' : 'done', endedAt: Date.now(), summary: summaryOf(reply), output: reply.slice(0, 6000)});
      }
    }
    if (event.success === false || !reply) { const current = this.store.get(sessionKey, {requestId: intent.requestId}); if (current) { current.phase = 'skipped'; this.store.set(current); } return {reviewed: false}; }
    const fresh = this.store.get(sessionKey, {requestId: intent.requestId});
    if (!fresh) return {reviewed: false, cancelled: true};
    // 打回之后这一条是「更正」：连同之前已交给用户的那条一起审，免得把只发更正当成没回答完整。
    // 在等独立解答之前落盘：等完再写会用旧副本盖掉独立解答刚写进去的结果。
    const earlier = fresh.round > 0 ? String(fresh.deliveredReply || '').slice(0, 6000) : '';
    fresh.phase = 'reviewing';
    if (!fresh.round) fresh.deliveredReply = reply.slice(0, 8000);
    this.store.set(fresh);
    const signal = this.controller(fresh.requestId).signal;
    try {
      const waitFor = async (job) => {
        if (!job) return [];
        let timer = null;
        const answers = await Promise.race([job, new Promise((resolve) => { timer = setTimeout(() => resolve([]), INDEPENDENT_WAIT_MS); })]);
        clearTimeout(timer);
        return Array.isArray(answers) ? answers : [];
      };
      const recipe = fresh.recipe || {};
      const engine = await waitFor(this.independent.get(fresh.requestId));
      // 两套档位的独立做法放在一起对照：做事档位派出去、已经交回来的那几版 + 九档在后台补的。
      // 做事档位那几版没派出来（模型没有派子任务的工具，或者提醒过一次仍没派）时，差的份数现在补上，
      // 免得「取大」落空——这时回复已经交给用户了，补做不让用户多等。
      // 只在这一条自己带做事档位时才取：会话里上一件档位任务留下的子任务结果和这一条无关。
      let views = [];
      if (!legacy && fresh.workTier) { try { views = (this.tierViews(sessionKey) || []).map((view) => String(view?.text || '').trim().slice(0, 6000)).filter(Boolean); } catch {} }
      const owed = legacy || fresh.round > 0 ? 0 : Math.min(3, (Number(recipe.tierViews) || 0) - views.length);
      const backfill = owed > 0 ? await waitFor(this.launchIndependent(fresh, owed, views.length + engine.length)) : [];
      // 补做的那几份留着，打回后的复核接着用，不再做一遍。
      if (backfill.length) this.independent.set(fresh.requestId, Promise.resolve([...engine, ...backfill]));
      const independent = [...views, ...engine, ...backfill];
      const verdict = await this.critique(fresh, auditPrompt({
        message: subjectOf(fresh), history: fresh.history, reply: reply.slice(0, 8000), evidence: toolEvidence(messages), independent, quality: Boolean(recipe.critic),
        workKind: fresh.workKind || '', artifacts: artifactPaths(entriesFromMessages(messages)), tools: true, earlier,
        previous: fresh.round > 0 ? fresh.issues : [],
      }), signal);
      const current = this.store.get(sessionKey, {requestId: fresh.requestId});
      if (!current || current.requestId !== fresh.requestId) return {reviewed: false, cancelled: true};
      if (!verdict) { current.phase = 'unchecked'; this.store.set(current); return {reviewed: false}; }
      current.issues = verdict.issues;
      if (verdict.pass) { current.phase = current.round ? 'fixed' : 'passed'; this.store.set(current); return {reviewed: true, pass: true}; }
      if (current.round >= current.maxRounds) { current.phase = 'unresolved'; this.store.set(current); return {reviewed: true, pass: false}; }
      current.round += 1;
      current.phase = 'fixing';
      this.store.set(current);
      const sent = await this.sendFix(sessionKey, verdict.issues, legacy ? '' : current.requestId);
      if (!sent) { const latest = this.store.get(sessionKey, {requestId: fresh.requestId}); if (latest) { latest.phase = 'unresolved'; this.store.set(latest); } }
      return {reviewed: true, pass: false, fixScheduled: sent};
    } catch {
      const current = this.store.get(sessionKey, {requestId: fresh.requestId});
      if (current?.requestId === fresh.requestId && current.phase === 'reviewing') { current.phase = 'unchecked'; this.store.set(current); }
      return {reviewed: false};
    }
  }

  async sendFix(sessionKey, issues, requestId = '') {
    if (!this.runProcess || !this.cliEntry) return false;
    const agentId = sessionKey.split(':')[1];
    for (let wait = 0; wait < 40 && this.isBusy(sessionKey); wait += 1) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const {stdout = ''} = await this.runProcess(process.execPath, [
        this.cliEntry, 'gateway', 'call', 'chat.send',
        '--params', JSON.stringify({sessionKey, agentId, message: fixMessage(issues, requestId), deliver: false, idempotencyKey: `pinkie-review-${randomUUID()}`}),
        '--json', '--timeout', '30000',
      ], {timeout: 35_000, maxBuffer: 64 * 1024, windowsHide: true, env: process.env});
      let result;
      try { result = JSON.parse(String(stdout).slice(String(stdout).indexOf('{'))); } catch {}
      return result?.status !== 'error' && result?.ok !== false;
    } catch {
      return false;
    }
  }
}

export function registerReasoningGateway(api, enhancer = new ReasoningEnhancer(api)) {
  api.on('before_prompt_build', (event, ctx) => enhancer.beforePromptBuild(event, ctx), {priority: -11900});
  api.registerGatewayMethod('pinkie.reasoning.prepare', async ({params, respond}) => {
    try { respond(true, await enhancer.prepare(params)); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error.message}); }
  }, {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.reasoning.cancel', ({params, respond}) => {
    respond(true, enhancer.cancel(params));
  }, {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.reasoning.status', ({params, respond}) => {
    respond(true, enhancer.status(params));
  }, {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.reasoning.job', ({params, respond}) => {
    respond(true, enhancer.job(params));
  }, {scope: 'operator.admin'});
  return enhancer;
}
