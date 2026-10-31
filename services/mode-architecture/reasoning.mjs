import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {agentWorkspace, findAgent, openclawStateDir} from './openclaw-paths.mjs';

// 输入框思考等级滑块的 9 档属于碧琪，不属于任何模型的原生等级表。每一档先按当前模型真正支持的
// 原生等级就近发送；原生够不到的部分，用流程补：
//   往下缺（模型最低档仍比所选档高）：只能让回答更快——直接给结论，不铺垫。
//   往上缺（模型最高档够不到所选档）：
//     Medium / High：回答前先拆清要求和约束（只加一段提示）。
//     XHigh：并行一份独立解答 + 批评，打回 1 轮。
//   Max：2 份独立解答（各用一种做法）+ 批评 + 交付验收，最多打回 2 轮。
//   Ultra：3 份独立解答（直接解、换方法、列清单自查）+ 批评兼仲裁 + 交付验收，最多打回 3 轮。
// 独立解答和批评都用用户当前选的模型（用户 2026-10-25 明确要求），不偷偷换成别的模型；
// 只有插件配置 reasoning.criticModels 明确写了，批评才换模型。
//   Adaptive（原生不支持时）：按这条消息的难度，难题按 XHigh 做，简单题按 Low 做。
// 2026-10 的 Gemini 实测说明：同一个模型自己多推演几轮几乎没有用；有用的是换做法的独立解答对照、
// 有证据的打回，以及核对交付（没验证就说完成、漏掉要求、文件不存在却给结果）。
// 独立解答都在主回答进行的同时并行跑，不增加等待；批评在主回答结束后进行。
const SESSION_KEY = /^agent:(main|project|thinking|learning|unrestricted):[^\s]+$/;
export const LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']);
const RANK = new Map(LEVELS.map((name, index) => [name, index]));
const LABELS = {off: '关闭', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', adaptive: 'Adaptive', max: 'Max', ultra: 'Ultra'};
// 思考强度档位（极致思考按钮）也带同一套交付验收：档位决定做事流程，验收在整个档位任务结束后才做。
const WORK_TIERS = Object.freeze({
  boost: {solvers: 0, rounds: 1, critic: false},
  full: {solvers: 1, rounds: 2, critic: true},
  marathon: {solvers: 0, rounds: 2, critic: false},
});
const CONTROL_PROMPT = /^\s*\[pinkie-(?:watchdog|tier-control|tier)\]/;
const MAX_MESSAGE = 12_000;
const MAX_HISTORY = 10_000;
const PASS_TIMEOUT_MS = 300_000;
const INDEPENDENT_WAIT_MS = 240_000;
const INTENT_TTL_MS = 60 * 60_000;
const FIX_PREFIX = '[pinkie-tier] 交付验收';
// 网关方法（发送前登记、状态查询）和 Agent 运行时的钩子（注入、回合结束后核对）是插件的两个实例，
// 内存不共享——旧版 Max/Ultra 的审阅笔记就是因此从来没能交给主模型。待核对的状态必须落盘。
const FIELDS = ['requestId', 'tier', 'level', 'recipe', 'message', 'sessionKey', 'history', 'phase', 'round', 'maxRounds', 'crossCheck', 'issues', 'jobs', 'createdAt', 'updatedAt'];

export class ReviewStore {
  constructor(root = path.join(openclawStateDir(), 'pinkie-deep-think', 'reviews')) {
    this.root = root;
  }

  file(sessionKey) {
    return path.join(this.root, `${createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 32)}.json`);
  }

  get(sessionKey) {
    try {
      const value = JSON.parse(fsSync.readFileSync(this.file(sessionKey), 'utf8'));
      return value?.sessionKey === sessionKey ? value : null;
    } catch {
      return null;
    }
  }

  set(intent) {
    const value = Object.fromEntries(FIELDS.map((key) => [key, intent[key]]));
    value.updatedAt = Date.now();
    fsSync.mkdirSync(this.root, {recursive: true});
    const target = this.file(intent.sessionKey);
    const temp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    fsSync.writeFileSync(temp, JSON.stringify(value));
    fsSync.renameSync(temp, target);
    return value;
  }

  delete(sessionKey) {
    try { fsSync.unlinkSync(this.file(sessionKey)); } catch {}
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
export function messageDifficulty(text) {
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
  return score >= 3 ? 'hard' : 'easy';
}

const NO_LAYERS = {brevity: false, think: false, solvers: 0, critic: false, rounds: 0, audit: false};
const UP_LAYERS = {
  medium: {...NO_LAYERS, think: true},
  high: {...NO_LAYERS, think: true},
  xhigh: {...NO_LAYERS, think: true, solvers: 1, critic: true, rounds: 1, audit: true},
};
const ENHANCED_LAYERS = {
  max: {...NO_LAYERS, solvers: 2, critic: true, rounds: 2, audit: true},
  ultra: {...NO_LAYERS, solvers: 3, critic: true, rounds: 3, audit: true},
};

// 一个档位在当前模型上的实际做法。kind: native 原生 / down 往下补 / up 往上补 / enhanced Max·Ultra / adaptive 自适应模拟。
export function recipeFor(level, record, {message = ''} = {}) {
  const natives = nativeLevels(record);
  if (!RANK.has(level)) level = 'medium';
  if (level === 'adaptive' && !natives.includes('adaptive')) {
    const difficulty = messageDifficulty(message);
    const inner = recipeFor(difficulty === 'hard' ? 'xhigh' : 'low', record);
    return {...inner, level, kind: 'adaptive', difficulty, as: difficulty === 'hard' ? 'xhigh' : 'low'};
  }
  if (ENHANCED_LAYERS[level]) {
    const native = natives.includes(level) ? level : topNative(natives);
    return {level, native, kind: 'enhanced', ...ENHANCED_LAYERS[level]};
  }
  const native = nearestNative(level, natives);
  if (native === level || level === 'adaptive') return {level, native, kind: 'native', ...NO_LAYERS};
  if (RANK.get(native) > RANK.get(level)) return {level, native, kind: 'down', ...NO_LAYERS, brevity: true};
  return {level, native, kind: 'up', ...(UP_LAYERS[level] || NO_LAYERS)};
}

const hasLayers = (recipe) => Boolean(recipe && (recipe.brevity || recipe.think || recipe.solvers || recipe.critic || recipe.audit));

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

export function solverPrompt({message, history, index = 0}) {
  return [
    '你是独立解题助手，只根据下面的对话独立完成用户这一轮的问题。',
    `做法：${SOLVER_ANGLES[index % SOLVER_ANGLES.length]}`,
    '不调用工具，不假装执行过任何操作。先给出明确结论，再给出能让别人复核的关键依据或推导（数字要算出来，不要只说思路）；需要实际运行或查证才能确定的地方，写明「需要核实」。1500 字以内。',
    `最近对话（只用来理解上下文）：\n${history || '无'}`,
    `用户这一轮：\n${message}`,
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

export function auditPrompt({message, history, reply, evidence, independent, quality = false}) {
  const answers = Array.isArray(independent) ? independent.filter(Boolean) : independent ? [independent] : [];
  const answerText = answers.map((text, index) => (answers.length > 1 ? `〔独立解答 ${index + 1}〕\n${text}` : text)).join('\n\n');
  return [
    quality
      ? '你是严格的审稿人兼交付验收员。你的工作是找出这份回复里真实存在的错误和缺漏，不重写回答。'
      : '你是交付验收员，只做核对，不重写回答，也不给新建议。',
    `【最近对话（只用来理解上下文）】\n${history || '无'}`,
    `【用户这一轮的原话】\n${message}`,
    `【助手的最终回复】\n${reply}`,
    `【回复的机械统计（程序算出，准确；涉及字数、行数、句数的要求以这里为准，不要自己数）】\n${replyFacts(reply)}`,
    `【本轮实际发生的工具调用和结果（节选，只有这里的内容算执行证据）】\n${evidence}`,
    answerText ? `【其他助手不看回复、独立做出的解答（只作对照，不一定对）】\n${answerText}` : '',
    [
      '逐项核对：',
      '1. 用户明确提出的每一个要求（数量、格式、字数、范围、文件位置、必须有和不能有的内容）是否都满足了；有数字的要真的数。',
      '2. 回复里每个「已完成 / 已修复 / 测试通过 / 已生成 / 已写入 / 已发送」这类说法，在工具记录里有没有对应的真实结果；没有记录或记录显示失败，就是问题。',
      '3. 回复里的数字、事实、计算和文件内容，是否与工具结果矛盾；文件不存在、命令失败时是否编造了结果。',
      answerText ? '4. 回复的关键结论与独立解答是否冲突；冲突时，用工具结果或你自己可复核的推导判断哪边有错，判断不了也算问题，要求重新核实。' : '',
      quality ? '5. 正确性：自己把关键计算、推理和结论重新做一遍；发现算错、推错、概念用错、引用了不存在的事实，就是问题。' : '',
      quality ? '6. 完整性：漏掉了会改变结论的情况、边界条件或反例；该给理由却只给结论；回答了别的问题。' : '',
      '用户要的是成品，却只给了计划或建议，也算问题。',
      '只报告有具体依据的问题（引用原文、工具记录，或写出你能复核的推导）。语气、风格、可有可无的改进、你自己拿不准的猜测，都不算问题。',
    ].filter(Boolean).join('\n'),
    '只输出一个 JSON 对象，不要 Markdown：全部通过时输出 {"pass": true}；否则输出 {"pass": false, "issues": [{"what": "哪里不对（引用回复原文）", "evidence": "依据（引用用户原话、工具记录或你的推导）", "fix": "应该怎么改"}]}，最多 5 条。',
  ].filter(Boolean).join('\n\n');
}

export function fixMessage(issues = []) {
  const list = issues.map((item, index) => `${index + 1}. ${item.what}（依据：${item.evidence}${item.fix ? `；应改为：${item.fix}` : ''}）`).join('\n');
  return `${FIX_PREFIX}：上一条回复还有下面几处具体问题。逐条核实——依据可能有错，先用工具或重新推导确认；确认是问题的就改正，确认不是的保持原样。需要就重新运行、读取或查证，拿到真实结果；没法解决的照实说明卡在哪里。改完直接给出修正后的完整最终回复，不要提到验收、检查或这条消息。\n${list}`;
}

function briefContext(recipe) {
  const level = LABELS[recipe.level] || recipe.level;
  const native = LABELS[recipe.native] || recipe.native;
  if (recipe.brevity) {
    return `这一条用户选了更快的「${level}」，但当前模型最低只能用「${native}」思考。请尽量快：直接给结论，不铺垫、不复述问题、不展开推导（用户要求时除外）；需要工具时照常使用，但只做必要的一两步。`;
  }
  if (recipe.think) {
    return `这一条用户选了「${level}」，当前模型的原生思考最高只到「${native}」。回答前先把问题拆清楚：列出用户的每条要求和关键约束、找出最容易出错的地方、想好至少一种验证方法；需要计算的真的算出来。正文只写结论和必要依据，不要把这段拆解过程写出来。`;
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

export class ReasoningEnhancer {
  constructor(api, {runProcess = null, cliEntry = '', isBusy = () => false, readyForReview = () => true, store = new ReviewStore(), critics = null} = {}) {
    this.api = api;
    this.runProcess = runProcess;
    this.cliEntry = cliEntry;
    this.isBusy = isBusy;
    this.readyForReview = readyForReview;
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
      const requested = level === 'adaptive' ? messageDifficulty(message) === 'hard' ? 'high' : 'low' : level;
      const native = nearestNative(requested, levels);
      const candidate = available.find(item => fixedEndpointLevel(item) === native);
      if (candidate) { target = candidate.id; record = candidate; }
    }
    const recipe = recipeFor(level, record, {message});
    return {recipe, thinkingLevel: fixedEndpointLevel(record) ? 'off' : recipe.native,
      ...(target !== model ? {model: `${provider}/${target}`} : {})};
  }

  // 发送前调用：只登记「这一条要怎么做」，立即返回，不挡住发送。
  // level 是滑块上的 9 档之一；旧的 tier=max/ultra 照旧可用。
  async prepare(params = {}) {
    const sessionKey = String(params.sessionKey || '');
    const level = String(params.level || params.tier || '');
    const requestId = String(params.requestId || '');
    const message = String(params.message || '').trim();
    if (!SESSION_KEY.test(sessionKey) || !RANK.has(level) || !/^[\w-]{8,100}$/.test(requestId)) {
      throw new Error('增强档位请求无效');
    }
    if (!message || message.length > MAX_MESSAGE) throw new Error('本条文字过长或为空，无法安全执行增强审阅');
    const done = this.completed.get(requestId);
    if (done) {
      if (done.sessionKey !== sessionKey || done.level !== level || done.message !== message) throw new Error('增强档位请求编号重复，已拒绝复用旧审阅');
      return done.result;
    }
    const {recipe, thinkingLevel, ...route} = this.routePlan(sessionKey, level, message);
    const summary = {level, kind: recipe.kind, native: recipe.native, solvers: recipe.solvers, critic: recipe.critic, rounds: recipe.rounds,
      brevity: recipe.brevity, think: recipe.think, ...(recipe.as ? {as: recipe.as, difficulty: recipe.difficulty} : {})};
    let result;
    if (!hasLayers(recipe)) {
      result = {prepared: false, recipe: summary, thinkingLevel, ...route};
    } else {
      const previous = this.store.get(sessionKey);
      if (previous && previous.requestId !== requestId) this.controllers.get(previous.requestId)?.abort();
      this.store.set({
        requestId, tier: level, level, recipe, message, sessionKey, history: historyText(params.history),
        phase: 'armed', round: 0, maxRounds: recipe.rounds, crossCheck: recipe.solvers > 0, issues: [], jobs: [], createdAt: Date.now(),
      });
      result = {prepared: true, tier: level, mode: recipe.audit ? 'delivery-review' : 'prompt', passes: 0, rounds: recipe.rounds, crossCheck: recipe.solvers > 0,
        recipe: summary, thinkingLevel, ...route};
    }
    this.completed.set(requestId, {sessionKey, level, message, result});
    if (this.completed.size > 200) this.completed.delete(this.completed.keys().next().value);
    return result;
  }

  // 后台工作的一行：落盘，供小面板读。
  updateJob(sessionKey, requestId, job, patch = {}) {
    const intent = this.store.get(sessionKey);
    if (!intent || intent.requestId !== requestId) return;
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
    const count = Math.max(1, Number(intent.recipe?.solvers) || 1);
    let main = null;
    try { main = this.mainRef(intent.sessionKey); } catch {}
    const jobs = [];
    for (let index = 0; index < count; index += 1) {
      // 几份都用当前模型，各用一种做法（SOLVER_ANGLES），避免犯同一个错。
      const label = `独立解答 ${['①', '②', '③'][index] || index + 1} · ${['直接解', '换方法', '列清单自查'][index % 3]}`;
      const job = newJob('solver', label, main);
      const ref = main;
      const prompt = solverPrompt({message: intent.message, history: intent.history, index});
      jobs.push(this.runJob(intent, job, ref, prompt).catch(() => ''));
    }
    const all = Promise.all(jobs).then((answers) => answers.filter(Boolean));
    this.independent.set(intent.requestId, all);
    if (this.independent.size > 20) this.independent.delete(this.independent.keys().next().value);
  }

  // 思考强度档位：选档后下一条真实用户消息开启验收（消息内容到发送时才知道）。
  armTier(sessionKey, tier) {
    if (!SESSION_KEY.test(sessionKey) || !WORK_TIERS[tier]) {
      this.cancel({sessionKey});
      return {armed: false};
    }
    const previous = this.store.get(sessionKey);
    if (previous) this.controllers.get(previous.requestId)?.abort();
    const recipe = {level: tier, kind: 'work', native: '', ...NO_LAYERS, ...WORK_TIERS[tier], audit: true};
    const value = this.store.set({
      requestId: `tier-${tier}-${randomUUID().slice(0, 8)}`, tier, level: tier, recipe, message: '', sessionKey, history: '',
      phase: 'armed', round: 0, maxRounds: recipe.rounds, crossCheck: recipe.solvers > 0, issues: [], jobs: [], createdAt: Date.now(),
    });
    return {armed: true, requestId: value.requestId};
  }

  cancel(params = {}) {
    const sessionKey = String(params.sessionKey || '');
    const requestId = String(params.requestId || '');
    const intent = this.store.get(sessionKey);
    if (!intent || (requestId && intent.requestId !== requestId)) return {cancelled: false};
    this.controllers.get(intent.requestId)?.abort();
    this.store.delete(sessionKey);
    return {cancelled: true};
  }

  status(params = {}) {
    const intent = this.store.get(String(params.sessionKey || ''));
    if (!intent) return {phase: 'idle'};
    const recipe = intent.recipe || {};
    return {
      phase: intent.phase, tier: intent.tier, level: intent.level || intent.tier, round: intent.round, maxRounds: intent.maxRounds,
      issues: (intent.issues || []).length, requestId: intent.requestId, updatedAt: intent.updatedAt,
      recipe: {kind: recipe.kind, native: recipe.native, solvers: recipe.solvers, critic: recipe.critic, rounds: recipe.rounds, as: recipe.as},
      jobs: (intent.jobs || []).map(({output, ...job}) => ({...job, hasOutput: Boolean(output)})),
    };
  }

  job(params = {}) {
    const intent = this.store.get(String(params.sessionKey || ''));
    const job = (intent?.jobs || []).find((item) => item.id === String(params.jobId || ''));
    if (!job) return {found: false};
    return {found: true, ...job};
  }

  beforePromptBuild(event = {}, ctx = {}) {
    const sessionKey = String(ctx.sessionKey || '');
    const intent = this.store.get(sessionKey);
    if (!intent) return;
    if (Date.now() - intent.createdAt > INTENT_TTL_MS) { this.store.delete(sessionKey); return; }
    const prompt = String(event.prompt || '').trim();
    const matches = intent.message ? prompt === intent.message || prompt.endsWith(intent.message) : Boolean(prompt) && !CONTROL_PROMPT.test(prompt);
    const recipe = intent.recipe || {...NO_LAYERS, audit: true, solvers: intent.crossCheck ? 1 : 0, rounds: intent.maxRounds};
    if (intent.phase === 'armed' && matches) {
      if (!intent.message) intent.message = prompt.slice(0, MAX_MESSAGE);
      if (!intent.history) intent.history = historyFromMessages(event.messages);
      const parts = [];
      const brief = briefContext(recipe);
      if (brief) parts.push(`[pinkie:effort level=${recipe.level}]\n${brief}`);
      if (recipe.audit) {
        intent.phase = 'answering';
        intent.jobs = [newJob('main', '碧琪主回答', null)];
        this.store.set(intent);
        if (recipe.solvers > 0) this.startIndependent(intent);
        parts.push(`${REVIEW_MARK} tier=${intent.tier}]\n这一条开启了交付验收：最终回复会被独立核对——用户的每条要求是否满足、每个「完成 / 通过 / 已生成」的说法是否有本轮真实的工具结果${recipe.critic ? '、结论和推导是否正确' : ''}。回复前先自己逐条对一遍。不要在回复里提到验收。`);
      } else {
        // 只加一段提示的档位：用完即弃。
        this.store.delete(sessionKey);
      }
      return parts.length ? {appendContext: parts.join('\n\n')} : undefined;
    }
    if (intent.phase === 'fixing' && prompt.startsWith(FIX_PREFIX)) {
      intent.phase = 'answering';
      this.store.set(intent);
      this.updateJob(sessionKey, intent.requestId, newJob('fix', `按批评修改 · 第 ${intent.round} 轮`, null));
    }
  }

  async pass(sessionKey, prompt, signal, {ref = null, thinkLevel} = {}) {
    const api = this.api;
    const agentId = sessionKey.split(':')[1];
    const main = this.mainRef(sessionKey);
    const target = ref || main;
    const sameAsMain = target.provider === main.provider && target.model === main.model;
    const workspaceDir = (api.config ? agentWorkspace(api.config, agentId) : '') || process.cwd();
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
        modelRun: true,
        disableTools: true,
        disableMessageTool: true,
        // 走子代理通道：全局 main 通道只有 4 个位置，Ultra 的 3 份独立解答 + 批评挤在里面，
        // 会把用户其他对话（以及并发的档位任务）排队到几分钟后。
        lane: 'subagent',
        abortSignal: signal,
      });
      if (signal?.aborted) throw new Error('增强审阅已取消');
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
        const output = await this.pass(intent.sessionKey, prompt, signal, {ref});
        const verdict = parseVerdict(output);
        if (!verdict) { lastError = new Error('批评结果格式不对'); continue; }
        const summary = verdict.pass ? '通过' : `发现 ${verdict.issues.length} 处问题：${summaryOf(verdict.issues[0]?.what)}`;
        this.updateJob(intent.sessionKey, intent.requestId, job, {state: 'done', endedAt: Date.now(), model: ref ? `${ref.provider}/${ref.model}` : job.model, summary, output});
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
    const intent = this.store.get(sessionKey);
    if (!intent || intent.phase !== 'answering') return {reviewed: false};
    // 档位任务还在续跑（子任务、检查点续跑）时不验收，等整个任务交付后再核对。
    if (!this.readyForReview(sessionKey)) return {reviewed: false, waiting: true};
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const reply = finalReply(messages);
    for (const job of intent.jobs || []) {
      if ((job.role === 'main' || job.role === 'fix') && job.state === 'running') {
        this.updateJob(sessionKey, intent.requestId, job, {state: event.success === false ? 'failed' : 'done', endedAt: Date.now(), summary: summaryOf(reply), output: reply.slice(0, 6000)});
      }
    }
    if (event.success === false || !reply) { const current = this.store.get(sessionKey); if (current) { current.phase = 'skipped'; this.store.set(current); } return {reviewed: false}; }
    const fresh = this.store.get(sessionKey);
    fresh.phase = 'reviewing';
    this.store.set(fresh);
    const signal = this.controller(fresh.requestId).signal;
    try {
      const job = this.independent.get(fresh.requestId);
      let timer = null;
      const independent = job ? await Promise.race([job, new Promise((resolve) => { timer = setTimeout(() => resolve([]), INDEPENDENT_WAIT_MS); })]) : [];
      clearTimeout(timer);
      const recipe = fresh.recipe || {};
      const verdict = await this.critique(fresh, auditPrompt({
        message: fresh.message, history: fresh.history, reply: reply.slice(0, 8000), evidence: toolEvidence(messages), independent, quality: Boolean(recipe.critic),
      }), signal);
      const current = this.store.get(sessionKey);
      if (!current || current.requestId !== fresh.requestId) return {reviewed: false, cancelled: true};
      if (!verdict) { current.phase = 'unchecked'; this.store.set(current); return {reviewed: false}; }
      current.issues = verdict.issues;
      if (verdict.pass) { current.phase = current.round ? 'fixed' : 'passed'; this.store.set(current); return {reviewed: true, pass: true}; }
      if (current.round >= current.maxRounds) { current.phase = 'unresolved'; this.store.set(current); return {reviewed: true, pass: false}; }
      current.round += 1;
      current.phase = 'fixing';
      this.store.set(current);
      const sent = await this.sendFix(sessionKey, verdict.issues);
      if (!sent) { const latest = this.store.get(sessionKey); if (latest) { latest.phase = 'unresolved'; this.store.set(latest); } }
      return {reviewed: true, pass: false, fixScheduled: sent};
    } catch {
      const current = this.store.get(sessionKey);
      if (current?.requestId === fresh.requestId && current.phase === 'reviewing') { current.phase = 'unchecked'; this.store.set(current); }
      return {reviewed: false};
    }
  }

  async sendFix(sessionKey, issues) {
    if (!this.runProcess || !this.cliEntry) return false;
    const agentId = sessionKey.split(':')[1];
    for (let wait = 0; wait < 40 && this.isBusy(sessionKey); wait += 1) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const {stdout = ''} = await this.runProcess(process.execPath, [
        this.cliEntry, 'gateway', 'call', 'chat.send',
        '--params', JSON.stringify({sessionKey, agentId, message: fixMessage(issues), deliver: false, idempotencyKey: `pinkie-review-${randomUUID()}`}),
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
