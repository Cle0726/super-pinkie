import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

// 输入框思考等级滑块最右边的两档。2026-10 实测（真实 Gemini 3.7/3.8，12 道难题 + 6 道多约束写作）：
// 原来「回答前先额外推演两三轮」的做法正确率与 High 一样（都全对），却多花 2.5～5 倍时间和额度。
// 这类模型真正出错的地方在交付：没验证就说完成、漏掉要求、文件不存在却给出结果。
// 所以这两档改成「答完之后核对交付」：
//   Max   = 交付验收：回答结束后，独立验收员按用户原话逐条核对回复和本轮真实工具结果；
//           只在发现有依据的具体问题时，自动让碧琪修一轮。没问题就只多一次很短的核对。
//   Ultra = 交付验收 + 独立复算：主回答进行的同时，并行做一份不带工具的独立解答（不增加等待），
//           验收时两边结论对照，冲突必须拿证据解决；最多修两轮。
const SESSION_KEY = /^agent:(main|project|thinking|learning|unrestricted):[^\s]+$/;
const TIERS = Object.freeze({max: {rounds: 1, crossCheck: false}, ultra: {rounds: 2, crossCheck: true}});
// 思考强度档位也带同一套交付验收：档位决定做事流程，验收在整个档位任务结束后才做。
const WORK_TIERS = Object.freeze({boost: {rounds: 1, crossCheck: false}, full: {rounds: 2, crossCheck: true}, marathon: {rounds: 2, crossCheck: false}});
const CONTROL_PROMPT = /^\s*\[pinkie-(?:watchdog|tier-control|tier)\]/;
const MAX_MESSAGE = 12_000;
const MAX_HISTORY = 10_000;
const PASS_TIMEOUT_MS = 120_000;
const INTENT_TTL_MS = 30 * 60_000;
const FIX_PREFIX = '[pinkie-tier] 交付验收';
// 网关方法（发送前登记、状态查询）和 Agent 运行时的钩子（注入、回合结束后核对）是插件的两个实例，
// 内存不共享——旧版 Max/Ultra 的审阅笔记就是因此从来没能交给主模型。待核对的状态必须落盘。
const FIELDS = ['requestId', 'tier', 'message', 'sessionKey', 'history', 'phase', 'round', 'maxRounds', 'crossCheck', 'issues', 'createdAt', 'updatedAt'];

export class ReviewStore {
  constructor(root = path.join(os.homedir(), '.openclaw', 'pinkie-deep-think', 'reviews')) {
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

function modelRef(config, entry, agentId) {
  const agent = config?.agents?.list?.find((item) => item.id === agentId);
  const defaultModel = agent?.model ?? config?.agents?.defaults?.model;
  const fallback = typeof defaultModel === 'string' ? defaultModel : defaultModel?.primary;
  const selected = String(entry?.modelOverride || fallback || '').trim();
  const provider = String(entry?.providerOverride || selected.split('/')[0] || '').trim();
  const model = selected.includes('/') ? selected.slice(selected.indexOf('/') + 1) : selected;
  if (!provider || !model) throw new Error('当前会话的模型还没有确认，增强档位未启动');
  return {provider, model};
}

function thinkingLevel(config, provider, model) {
  const catalog = config?.models?.providers?.[provider]?.models || [];
  const record = catalog.find((item) => item.id === model);
  const efforts = record?.compat?.supportedReasoningEfforts;
  // 实测 xhigh 与 high 的思考量和正确率没有差别，验收和复算用 high 更快。
  if (Array.isArray(efforts)) return ['high', 'xhigh', 'medium', 'low', 'minimal'].find((level) => efforts.includes(level)) || 'off';
  return record?.reasoning === false ? 'off' : 'high';
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
      .map((item) => ({what: String(item.what).slice(0, 400), evidence: String(item.evidence).slice(0, 400), fix: String(item.fix || '').slice(0, 300)})) : [];
    return {pass: value.pass === true || issues.length === 0, issues};
  } catch {
    return null;
  }
}

export function auditPrompt({message, history, reply, evidence, independent}) {
  return [
    '你是交付验收员，只做核对，不重写回答，也不给新建议。',
    `【最近对话（只用来理解上下文）】\n${history || '无'}`,
    `【用户这一轮的原话】\n${message}`,
    `【助手的最终回复】\n${reply}`,
    `【本轮实际发生的工具调用和结果（节选，只有这里的内容算证据）】\n${evidence}`,
    independent ? `【另一位助手不看回复、独立做出的解答（只作对照，不一定对）】\n${independent}` : '',
    [
      '逐项核对：',
      '1. 用户明确提出的每一个要求（数量、格式、字数、范围、文件位置、必须有和不能有的内容）是否都满足了；有数字的要真的数。',
      '2. 回复里每个「已完成 / 已修复 / 测试通过 / 已生成 / 已写入 / 已发送」这类说法，在工具记录里有没有对应的真实结果；没有记录或记录显示失败，就是问题。',
      '3. 回复里的数字、事实、计算和文件内容，是否与工具结果矛盾；文件不存在、命令失败时是否编造了结果。',
      independent ? '4. 回复的关键结论与独立解答是否冲突；冲突时，用工具结果或可复核的推导判断哪边有错，判断不了也算问题，要求重新核实。' : '',
      '用户要的是成品，却只给了计划或建议，也算问题。',
      '只报告有具体依据的问题。语气、风格、可有可无的改进、你自己拿不准的猜测，都不算问题。',
    ].filter(Boolean).join('\n'),
    '只输出一个 JSON 对象，不要 Markdown：全部通过时输出 {"pass": true}；否则输出 {"pass": false, "issues": [{"what": "哪里不对（引用回复原文）", "evidence": "依据（引用用户原话或工具记录）", "fix": "应该怎么改"}]}，最多 5 条。',
  ].filter(Boolean).join('\n\n');
}

export function fixMessage(issues = []) {
  const list = issues.map((item, index) => `${index + 1}. ${item.what}（依据：${item.evidence}${item.fix ? `；应改为：${item.fix}` : ''}）`).join('\n');
  return `${FIX_PREFIX}：上一条回复还有下面几处具体问题。逐条改正——需要就重新运行、读取或查证，拿到真实结果；没法解决的照实说明卡在哪里。改完直接给出修正后的完整最终回复，不要提到验收、检查或这条消息。\n${list}`;
}

export class ReasoningEnhancer {
  constructor(api, {runProcess = null, cliEntry = '', isBusy = () => false, readyForReview = () => true, store = new ReviewStore()} = {}) {
    this.api = api;
    this.runProcess = runProcess;
    this.cliEntry = cliEntry;
    this.isBusy = isBusy;
    this.readyForReview = readyForReview;
    this.store = store;
    this.completed = new Map();
    // 只在本实例内有效的东西：独立复算的进行中任务、可取消的请求。
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

  // 发送前调用：只登记「这一条要验收」，立即返回，不再挡住发送。
  async prepare(params = {}) {
    const sessionKey = String(params.sessionKey || '');
    const tier = String(params.tier || '');
    const requestId = String(params.requestId || '');
    const message = String(params.message || '').trim();
    if (!SESSION_KEY.test(sessionKey) || !TIERS[tier] || !/^[\w-]{8,100}$/.test(requestId)) {
      throw new Error('增强档位请求无效');
    }
    if (!message || message.length > MAX_MESSAGE) throw new Error('本条文字过长或为空，无法安全执行增强审阅');
    const done = this.completed.get(requestId);
    if (done) {
      if (done.sessionKey !== sessionKey || done.tier !== tier || done.message !== message) throw new Error('增强档位请求编号重复，已拒绝复用旧审阅');
      return done.result;
    }
    const previous = this.store.get(sessionKey);
    if (previous && previous.requestId !== requestId) this.controllers.get(previous.requestId)?.abort();
    this.store.set({
      requestId, tier, message, sessionKey, history: historyText(params.history),
      phase: 'armed', round: 0, maxRounds: TIERS[tier].rounds, crossCheck: TIERS[tier].crossCheck, issues: [], createdAt: Date.now(),
    });
    const result = {prepared: true, tier, mode: 'delivery-review', passes: 0, rounds: TIERS[tier].rounds, crossCheck: TIERS[tier].crossCheck};
    this.completed.set(requestId, {sessionKey, tier, message, result});
    if (this.completed.size > 200) this.completed.delete(this.completed.keys().next().value);
    return result;
  }

  // Ultra / 全开档：主回答进行的同时做一份不带工具的独立解答，不增加等待。
  startIndependent(intent) {
    if (this.independent.has(intent.requestId)) return;
    const job = this.pass(intent.sessionKey, `你是独立解题助手。只根据下面的对话独立完成用户这一轮的问题，不调用工具，不假装执行过任何操作。先给出明确结论，再给出能让别人复核的关键依据或推导；需要实际运行或查证才能确定的地方，写明「需要核实」。1200 字以内。\n\n最近对话（只用来理解上下文）：\n${intent.history || '无'}\n\n用户这一轮：\n${intent.message}`, this.controller(intent.requestId).signal)
      .catch(() => '');
    this.independent.set(intent.requestId, job);
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
    const value = this.store.set({
      requestId: `tier-${tier}-${randomUUID().slice(0, 8)}`, tier, message: '', sessionKey, history: '',
      phase: 'armed', round: 0, maxRounds: WORK_TIERS[tier].rounds, crossCheck: WORK_TIERS[tier].crossCheck, issues: [], createdAt: Date.now(),
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
    return {phase: intent.phase, tier: intent.tier, round: intent.round, maxRounds: intent.maxRounds, issues: (intent.issues || []).length, requestId: intent.requestId};
  }

  beforePromptBuild(event = {}, ctx = {}) {
    const sessionKey = String(ctx.sessionKey || '');
    const intent = this.store.get(sessionKey);
    if (!intent) return;
    if (Date.now() - intent.createdAt > INTENT_TTL_MS) { this.store.delete(sessionKey); return; }
    const prompt = String(event.prompt || '').trim();
    const matches = intent.message ? prompt === intent.message || prompt.endsWith(intent.message) : Boolean(prompt) && !CONTROL_PROMPT.test(prompt);
    if (intent.phase === 'armed' && matches) {
      if (!intent.message) intent.message = prompt.slice(0, MAX_MESSAGE);
      intent.phase = 'answering';
      this.store.set(intent);
      if (intent.crossCheck) this.startIndependent(intent);
      return {appendContext: `${REVIEW_MARK} tier=${intent.tier}]\n这一条开启了交付验收：最终回复会被独立核对——用户的每条要求是否满足、每个「完成 / 通过 / 已生成」的说法是否有本轮真实的工具结果。回复前先自己逐条对一遍。不要在回复里提到验收。`};
    }
    if (intent.phase === 'fixing' && prompt.startsWith(FIX_PREFIX)) {
      intent.phase = 'answering';
      this.store.set(intent);
    }
  }

  async pass(sessionKey, prompt, signal) {
    const api = this.api;
    const agentId = sessionKey.split(':')[1];
    const entry = api.runtime.agent.session.getSessionEntry({sessionKey, agentId, readConsistency: 'latest'});
    const {provider, model} = modelRef(api.config, entry, agentId);
    const workspaceDir = api.config?.agents?.list?.find((item) => item.id === agentId)?.workspace
      || api.config?.agents?.defaults?.workspace || process.cwd();
    const authProfileId = entry?.authProfileOverride || undefined;
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
        provider,
        model,
        agentId,
        authProfileId,
        authProfileIdSource: authProfileId ? 'user' : 'auto',
        thinkLevel: thinkingLevel(api.config, provider, model),
        modelRun: true,
        disableTools: true,
        disableMessageTool: true,
        abortSignal: signal,
      });
      if (signal?.aborted) throw new Error('增强审阅已取消');
      return outputText(result);
    } finally {
      await fs.rm(tempDir, {recursive: true, force: true}).catch(() => {});
    }
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
    if (event.success === false || !reply) { intent.phase = 'skipped'; this.store.set(intent); return {reviewed: false}; }
    intent.phase = 'reviewing';
    this.store.set(intent);
    const signal = this.controller(intent.requestId).signal;
    try {
      const job = this.independent.get(intent.requestId);
      const independent = job ? await Promise.race([job, new Promise((resolve) => setTimeout(() => resolve(''), 90_000))]) : '';
      const verdict = parseVerdict(await this.pass(sessionKey, auditPrompt({
        message: intent.message, history: intent.history, reply: reply.slice(0, 8000), evidence: toolEvidence(messages), independent,
      }), signal));
      const current = this.store.get(sessionKey);
      if (!current || current.requestId !== intent.requestId) return {reviewed: false, cancelled: true};
      if (!verdict) { intent.phase = 'unchecked'; this.store.set(intent); return {reviewed: false}; }
      intent.issues = verdict.issues;
      if (verdict.pass) { intent.phase = intent.round ? 'fixed' : 'passed'; this.store.set(intent); return {reviewed: true, pass: true}; }
      if (intent.round >= intent.maxRounds) { intent.phase = 'unresolved'; this.store.set(intent); return {reviewed: true, pass: false}; }
      intent.round += 1;
      intent.phase = 'fixing';
      this.store.set(intent);
      const sent = await this.sendFix(sessionKey, verdict.issues);
      if (!sent) { intent.phase = 'unresolved'; this.store.set(intent); }
      return {reviewed: true, pass: false, fixScheduled: sent};
    } catch {
      const current = this.store.get(sessionKey);
      if (current?.requestId === intent.requestId && current.phase === 'reviewing') { intent.phase = 'unchecked'; this.store.set(intent); }
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
  return enhancer;
}
