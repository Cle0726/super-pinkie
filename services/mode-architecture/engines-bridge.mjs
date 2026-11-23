// Metre 引擎台的后端：把 T3 Code 的对话投影翻成 Metre 自己画的一份清单，并把引擎台上的按钮翻成 T3 的命令。
// 计划：briefs/metre-engines-1122/PLAN.md 3.3、3.5。界面在 ui/injections/laolao-metre-engine.js。
//
// 只用 T3 自己网页用的那几条命令（orchestration.launchThread / dispatchCommand / getThreadProjection / getFullThreadDiff，
// server.getConfig / refreshProviders），不碰它的数据库。账号邮箱一律不出这个文件。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {T3Rpc} from './engines-rpc.mjs';
import {readProviders} from './engines.mjs';
import {boundProjectRoot} from './project-brief.mjs';

// OpenMausBot 的审批分级（docs/approval-levels.md）= T3 的运行模式。默认全放手，和 Metre 自己「不设确认关卡」一致。
export const LEVELS = [
  {id: 'full-access', name: '全放手', hint: '命令和改文件都直接做；真有问题或缺账号才来问你'},
  {id: 'auto', name: '自己判断', hint: '常规操作自己批，拿不准的来问你'},
  {id: 'auto-accept-edits', name: '改文件不问', hint: '改文件直接做，跑命令等别的事先问你'},
  {id: 'approval-required', name: '每步都问', hint: '跑命令、改文件之前都先等你点头'},
];
const LEVEL_IDS = new Set(LEVELS.map(level => level.id));
export const ENGINES = [
  {id: 'claudeAgent', name: 'Claude Code', signin: {how: 'terminal', command: 'claude auth login'}},
  {id: 'codex', name: 'Codex', signin: {how: 'terminal', command: 'codex login'}},
  {id: 'antigravity', name: 'Antigravity', signin: {how: 'settings', page: 'providers'}},
];
const ENGINE_NAME = Object.fromEntries(ENGINES.map(engine => [engine.id, engine.name]));
const TOKEN_SCOPES = ['orchestration:read', 'orchestration:operate', 'providers:manage', 'settings:write', 'source-control:write', 'filesystem:read', 'diagnostics:read'];
const TOKEN_TTL_MS = 12 * 3600_000;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const ACTIVE_RUN = new Set(['queued', 'preparing', 'starting', 'running', 'waiting', 'waiting_for_input', 'interrupting']);

const noEmail = text => String(text ?? '').replace(EMAIL, '…');
// 用户 11-22：界面上不要出现对方的名字和标志。引擎服务传回来的话里带的产品名、链接、工具前缀都换掉。
export const brandless = text => noEmail(text)
  .replace(/https?:\/\/(?:app\.)?t3\.codes\S*/gi, '')
  .replace(/\bmcp__t3-code(?:-direct)?__/gi, '')
  .replace(/\bt3[-_]code[-_]?/gi, '')
  .replace(/\bT3 ?Code\b/gi, '引擎服务')
  .replace(/\bt3_(?=[a-z])/g, '');
const clip = (text, n) => { const value = String(text ?? ''); return value.length > n ? value.slice(0, n) + '…' : value; };
const tail = (text, n) => { const value = String(text ?? ''); return value.length > n ? '…' + value.slice(-n) : value; };
const newId = prefix => `${prefix}:metre-${crypto.randomUUID()}`;
export const engineName = id => ENGINE_NAME[id] || String(id || '');

function quota(usageLimits, lastError = null) {
  const reset = lastError?.usageLimitResetAt || null;
  if (lastError?.lastErrorClass === 'usage_limit') return {state: 'out', resetAt: reset, text: '额度用完了'};
  const limits = usageLimits && typeof usageLimits === 'object' ? usageLimits : null;
  const windows = Array.isArray(limits?.windows) ? limits.windows : Array.isArray(limits?.limits) ? limits.limits : [];
  const out = windows.find(item => Number(item?.usedPercent ?? item?.percentUsed) >= 100);
  if (out) return {state: 'out', resetAt: out.resetsAt || out.resetAt || null, text: '额度用完了'};
  const top = windows.map(item => Number(item?.usedPercent ?? item?.percentUsed)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return Number.isFinite(top) ? {state: 'ok', resetAt: null, text: `已用 ${Math.round(top)}%`} : {state: 'unknown', resetAt: null, text: ''};
}

// server.getConfig 的 providers → 引擎菜单。只留状态、套餐名、版本、模型；邮箱去掉。
export function summarizeProviders(providers = []) {
  return (Array.isArray(providers) ? providers : []).map(provider => {
    const label = String(provider?.auth?.label || '');
    return {
      id: String(provider.instanceId || ''),
      driver: String(provider.driver || ''),
      name: engineName(provider.instanceId) || String(provider.displayName || provider.instanceId || ''),
      enabled: provider.enabled === true,
      installed: provider.installed === true,
      version: provider.version || null,
      status: String(provider.status || 'unknown'),
      signedIn: provider.auth?.status === 'authenticated',
      plan: label.includes('@') ? '' : label,
      message: brandless(provider.message || ''),
      quota: quota(provider.usageLimits),
      models: (Array.isArray(provider.models) ? provider.models : []).map(model => ({
        slug: String(model.slug || ''), name: String(model.name || model.slug || ''), isDefault: model.isDefault === true,
      })).filter(model => model.slug),
    };
  }).filter(row => row.id);
}

function failureText(failure) {
  if (!failure) return '';
  if (failure.class === 'usage_limit') return '额度用完了' + (failure.resetAt ? `，${failure.resetAt} 恢复` : '');
  if (/auth|login|credential/i.test(String(failure.code || '') + String(failure.message || ''))) return '还没登录，或者登录过期了';
  return brandless(failure.message || failure.code || '出错了');
}

const answersOf = item => item?.questionAnswer?.answers || item?.answers || null;

// 一条 T3 的对话事项 → Metre 引擎台的一行。认不出的类型不画（T3 自己的内部记号）。
export function toItem(item) {
  if (!item || typeof item !== 'object') return null;
  const base = {id: String(item.id || ''), status: String(item.status || ''), at: item.updatedAt || item.completedAt || item.startedAt || null,
    startedAt: item.startedAt || null, completedAt: item.completedAt || null};
  switch (item.type) {
    case 'user_message': return {...base, kind: 'you', text: String(item.text || '')};
    case 'assistant_message': return {...base, kind: 'reply', text: String(item.text || ''), streaming: item.streaming === true};
    case 'reasoning': return {...base, kind: 'thinking', text: String(item.text || ''), streaming: item.streaming === true};
    // T3 自己的步骤（准备工作区之类）没有对应的引擎原生事项，只当一句旁注。
    case 'command_execution': if (item.nativeItemRef == null && item.title && /^Preparing workspace$/i.test(String(item.input || ''))) return {...base, kind: 'note', text: /ready/i.test(item.title) ? '工作区准备好了' : String(item.title)};
      return {...base, kind: 'command', command: clip(item.input, 2000), output: tail(item.output, 6000),
      exitCode: Number.isInteger(item.exitCode) ? item.exitCode : null, failed: item.outputIndicatesFailure === true || (Number.isInteger(item.exitCode) && item.exitCode !== 0)};
    case 'file_change': return {...base, kind: 'edit', file: String(item.fileName || ''), additions: item.additions ?? null, deletions: item.deletions ?? null,
      diff: clip(item.diffStr || '', 40_000), operations: (item.changes || []).map(change => String(change.operation || '')).filter(Boolean)};
    case 'file_search': return {...base, kind: 'search', text: String(item.pattern || item.title || ''), count: (item.results || []).length};
    case 'web_search': return {...base, kind: 'web', text: (item.patterns || []).join(' / ') || String(item.title || ''), count: (item.results || []).length};
    case 'dynamic_tool': return {...base, kind: 'tool', name: brandless(item.toolName || item.title || '工具') || '工具', text: brandless(clip(typeof item.input === 'string' ? item.input : JSON.stringify(item.input ?? ''), 400))};
    case 'todo_list': return {...base, kind: 'todo', explanation: String(item.explanation || ''),
      steps: (item.steps || []).map(step => ({text: String(step.text || ''), status: String(step.status || 'pending')}))};
    case 'proposed_plan': return {...base, kind: 'plan', text: String(item.markdown || ''), streaming: item.streaming === true};
    case 'approval_request': return {...base, kind: 'approval', requestId: String(item.requestId || ''), requestKind: String(item.requestKind || ''),
      prompt: clip(item.prompt || item.title || '', 4000), reason: clip(item.reason || '', 1000), app: String(item.appName || ''),
      options: (item.options || []).map(option => ({decision: String(option.decision), label: String(option.label || ''), warning: String(option.warning || '')}))};
    case 'user_input_request': return {...base, kind: 'question', requestId: String(item.requestId || ''), answers: answersOf(item),
      questions: (item.questions || []).map(question => ({id: String(question.id), header: String(question.header || ''), question: String(question.question || ''),
        multiSelect: question.multiSelect === true, allowCustom: question.allowCustomAnswer !== false,
        options: (question.options || []).map(option => ({label: String(option.label || ''), description: String(option.description || ''), value: option.value ?? option.label}))}))};
    case 'error': return {...base, kind: 'error', text: failureText(item.failure), detail: brandless(item.failure?.message || ''), failureClass: String(item.failure?.class || ''), resetAt: item.failure?.resetAt || null};
    case 'compaction': return {...base, kind: 'note', text: '对话太长，引擎把前面的内容压缩成了摘要'};
    case 'run_interrupt_request': case 'run_interrupt_result': return {...base, kind: 'note', text: brandless(item.message || '已停下')};
    case 'system_notice': return {...base, kind: 'note', text: brandless(item.title || item.text || item.message || '')};
    default: return null;
  }
}

function runStatus(run, pending) {
  if (pending.length) return 'waiting';
  const status = String(run?.status || '');
  if (!status) return 'idle';
  if (ACTIVE_RUN.has(status)) return 'running';
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (/cancel|interrupt|rolled_back/.test(status)) return 'stopped';
  return status;
}

// getThreadProjection 的结果 → 引擎台的一份数据。
export function summarizeProjection(projection) {
  const thread = projection?.thread || {};
  // visibleTurnItems 是 T3 网页画的那份（含分叉前继承来的），每行 {position, item}；旧版没有时退回 turnItems。
  const visible = Array.isArray(projection?.visibleTurnItems) ? projection.visibleTurnItems.filter(row => row?.item && typeof row.item === 'object') : [];
  const ordered = visible.length
    ? [...visible].sort((a, b) => Number(a.position || 0) - Number(b.position || 0)).map(row => row.item)
    : [...(projection?.turnItems || [])].sort((a, b) => Number(a?.ordinal || 0) - Number(b?.ordinal || 0));
  const items = ordered.map(toItem).filter(Boolean);
  const openRequests = new Set((projection?.runtimeRequests || []).filter(request => request?.status === 'pending').map(request => String(request.id)));
  for (const item of items) if (item.requestId) item.open = openRequests.has(item.requestId);
  const pending = items.filter(item => item.open);
  const runs = [...(projection?.runs || [])].sort((a, b) => Number(a?.ordinal || 0) - Number(b?.ordinal || 0));
  const latest = runs.at(-1) || null;
  const active = runs.filter(run => ACTIVE_RUN.has(String(run?.status || ''))).at(-1) || null;
  const changes = new Map();
  for (const item of items) {
    if (item.kind !== 'edit' || !item.file) continue;
    const row = changes.get(item.file) || {file: item.file, additions: 0, deletions: 0, edits: 0};
    row.additions += Number(item.additions) || 0;
    row.deletions += Number(item.deletions) || 0;
    row.edits += 1;
    changes.set(item.file, row);
  }
  const lastError = [...items].reverse().find(item => item.kind === 'error') || null;
  const turnCount = Math.max(0, ...(projection?.checkpoints || []).map(checkpoint => Number(checkpoint?.ordinalWithinScope) || 0));
  return {
    thread: {
      id: String(thread.id || ''), title: brandless(thread.title || ''), engine: String(thread.modelSelection?.instanceId || thread.providerInstanceId || ''),
      engineName: engineName(thread.modelSelection?.instanceId || thread.providerInstanceId), model: String(thread.modelSelection?.model || ''),
      level: String(thread.runtimeMode || ''), plan: thread.interactionMode === 'plan', branch: thread.branch || null, worktree: thread.worktreePath || null,
      archived: Boolean(thread.archivedAt), createdAt: thread.createdAt || null, updatedAt: thread.updatedAt || projection?.updatedAt || null,
    },
    status: runStatus(active || latest, pending),
    activeRunId: active ? String(active.id) : null,
    runStartedAt: (active || latest)?.startedAt || (active || latest)?.requestedAt || null,
    runCompletedAt: active ? null : latest?.completedAt || null,
    items,
    pending: pending.map(item => ({requestId: item.requestId, kind: item.kind})),
    changes: [...changes.values()],
    turnCount,
    error: lastError && runStatus(latest, pending) === 'failed' ? {text: lastError.text, failureClass: lastError.failureClass, resetAt: lastError.resetAt} : null,
  };
}

// 按 Metre 会话记住：用哪个引擎、模型、放手程度，以及对应的 T3 对话。
export class SessionEngines {
  constructor(file) { this.file = file; }
  all() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { return {}; } }
  get(key) { return this.all()[key] || null; }
  set(key, patch) {
    const all = this.all();
    const next = {...(all[key] || {}), ...patch, updatedAt: new Date().toISOString()};
    all[key] = next;
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(all, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    return next;
  }
  byThread(threadId) {
    for (const [key, value] of Object.entries(this.all())) if (value?.threadId === threadId) return {sessionKey: key, ...value};
    return null;
  }
}

// 在终端里让用户自己登录（碧琪不经手账号）。Windows 开一个新的命令行窗口，Mac 开「终端」。
export function openLoginTerminal(command, {platform = process.platform, spawnImpl = spawn} = {}) {
  if (!/^[a-z]+ (?:auth )?login$/.test(command)) throw new Error('不认识的登录命令');
  const detached = {detached: true, stdio: 'ignore', windowsHide: false};
  const child = platform === 'win32'
    ? spawnImpl('cmd.exe', ['/c', 'start', '"Metre 登录"', 'cmd.exe', '/k', command], {...detached, windowsVerbatimArguments: true})
    : platform === 'darwin'
      ? spawnImpl('osascript', ['-e', `tell application "Terminal" to do script "${command}"`, '-e', 'tell application "Terminal" to activate'], detached)
      : spawnImpl('x-terminal-emulator', ['-e', command], detached);
  child?.unref?.();
  return {opened: true};
}

export class EngineBridge {
  constructor({service, stateRoot = '', logger = null, RpcImpl = T3Rpc, now = () => Date.now()} = {}) {
    Object.assign(this, {service, stateRoot, logger, RpcImpl, now});
    this.sessions = new SessionEngines(path.join(service.root, 'sessions.json'));
    this.rpcClient = null;
    this.rpcPort = 0;
    this.token = {value: '', expiresAt: 0};
    this.projects = new Map();
    this.configCache = {at: 0, value: null};
  }

  async issueToken() {
    if (this.token.value && this.token.expiresAt - this.now() > 10 * 60_000) return this.token.value;
    const result = await this.service.cli(['auth', 'session', 'issue', '--token-only', '--ttl', '12h', '--label', 'metre',
      ...TOKEN_SCOPES.flatMap(scope => ['--scope', scope])]);
    const value = String(result?.text || '').trim().split(/\r?\n/).pop() || '';
    if (!/^[\w.~+/=-]{20,}$/.test(value)) throw new Error('没有拿到引擎服务的令牌');
    this.token = {value, expiresAt: this.now() + TOKEN_TTL_MS};
    return value;
  }

  rpc() {
    const {running, url, port} = this.service.status();
    if (!running) throw new Error('外部引擎没有在运行，先在引擎菜单里打开它');
    if (!this.rpcClient || this.rpcPort !== port) {
      try { this.rpcClient?.close(); } catch {}
      this.rpcClient = new this.RpcImpl({url, token: () => this.issueToken(), logger: this.logger});
      this.rpcPort = port;
      this.projects.clear();
    }
    return this.rpcClient;
  }

  async call(tag, payload = {}, options) {
    try { return await this.rpc().request(tag, payload, options); }
    catch (error) {
      // 令牌失效或服务重启：换一个令牌、重连一次。
      if (!/连接|令牌|关闭|Disconnected|401|auth/i.test(String(error?.message) + String(error?.tag))) throw error;
      this.token = {value: '', expiresAt: 0};
      try { this.rpcClient?.close(); } catch {}
      this.rpcClient = null;
      return await this.rpc().request(tag, payload, options);
    }
  }

  async config(force = false) {
    if (!force && this.configCache.value && this.now() - this.configCache.at < 5000) return this.configCache.value;
    const value = await this.call('server.getConfig', {});
    this.configCache = {at: this.now(), value};
    return value;
  }

  async catalog({refresh = false} = {}) {
    const state = this.service.status();
    let engines = [];
    let source = 'cache';
    if (state.running) {
      try {
        if (refresh) await this.call('server.refreshProviders', {}).catch(() => null);
        engines = summarizeProviders((await this.config(refresh))?.providers);
        source = 'live';
      } catch (error) { this.logger?.warn?.(`engines catalog: ${error.message}`); }
    }
    if (!engines.length) engines = readProviders(this.service.home).map(row => ({...row, name: engineName(row.id) || row.name, quota: {state: 'unknown', resetAt: null, text: ''}}));
    const wanted = new Set(ENGINES.map(engine => engine.id));
    engines.sort((a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)) || ENGINES.findIndex(e => e.id === a.id) - ENGINES.findIndex(e => e.id === b.id));
    return {engines: engines.map(row => ({...row, signin: ENGINES.find(engine => engine.id === row.id)?.signin || null})), levels: LEVELS, source};
  }

  folderFor(sessionKey) {
    const bound = boundProjectRoot(sessionKey, {stateRoot: this.stateRoot});
    if (bound) return bound;
    const scratch = path.join(this.service.root, 'scratch');
    fs.mkdirSync(scratch, {recursive: true});
    return scratch;
  }

  async projectId(folder) {
    const normalized = path.resolve(folder).toLowerCase();
    if (this.projects.has(normalized)) return this.projects.get(normalized);
    await this.service.addProject(folder);
    const shell = await this.rpc().first('orchestration.subscribeShell', {});
    const projects = shell?.snapshot?.projects || [];
    const match = projects.find(project => path.resolve(String(project.workspaceRoot || '')).toLowerCase() === normalized);
    if (!match) throw new Error('引擎服务里找不到这个文件夹的项目');
    this.projects.set(normalized, String(match.id));
    return String(match.id);
  }

  async thread(threadId) {
    if (!threadId) throw new Error('需要对话编号');
    return summarizeProjection(await this.call('orchestration.getThreadProjection', {threadId}));
  }

  dispatch(command) { return this.call('orchestration.dispatchCommand', {commandId: newId('command'), ...command}); }

  async start({folder, engine, model, text, level = 'full-access', plan = false, worktree = false, title = ''} = {}) {
    if (!engine || !model) throw new Error('先选引擎和模型');
    if (!String(text || '').trim()) throw new Error('要说的话是空的');
    const projectId = await this.projectId(folder);
    const result = await this.call('orchestration.launchThread', {
      commandId: newId('command'), projectId,
      title: clip(String(title || text).split(/\r?\n/).find(line => line.trim()) || 'Metre', 80).trim() || 'Metre',
      generateTitle: !title,
      modelSelection: {instanceId: engine, model},
      runtimeMode: LEVEL_IDS.has(level) ? level : 'full-access',
      interactionMode: plan ? 'plan' : 'default',
      workspaceStrategy: worktree ? {type: 'worktree', baseRef: 'HEAD'} : {type: 'root'},
      initialMessage: {text: String(text), attachments: []},
    }, {timeout: 120_000});
    return {threadId: String(result?.threadId || ''), summary: result?.projection ? summarizeProjection(result.projection) : null};
  }

  async send({threadId, text, mode = 'queue'} = {}) {
    if (!String(text || '').trim()) throw new Error('要说的话是空的');
    const current = await this.thread(threadId);
    const dispatchMode = !current.activeRunId ? {type: 'start_immediately'}
      : mode === 'steer' ? {type: 'steer_active', targetRunId: current.activeRunId} : {type: 'queue_after_active'};
    await this.dispatch({type: 'message.dispatch', threadId, messageId: newId('message'), text: String(text), attachments: [], dispatchMode});
    return this.thread(threadId);
  }

  async respond({threadId, requestId, decision, feedback, answers} = {}) {
    if (!threadId || !requestId) throw new Error('需要对话和请求编号');
    const command = {type: 'runtime-request.respond', threadId, requestId};
    if (decision) command.decision = decision;
    if (feedback) command.feedback = String(feedback).slice(0, 2000);
    if (answers && typeof answers === 'object') command.answers = answers;
    if (!command.decision && !command.answers) throw new Error('要批准、拒绝或者给出回答');
    await this.dispatch(command);
    return this.thread(threadId);
  }

  async stop({threadId} = {}) {
    await this.dispatch({type: 'thread.stop', threadId, reason: 'Metre 里点了停止'});
    return this.thread(threadId);
  }

  async configure({threadId, engine, model, level, plan} = {}) {
    if (engine && model) await this.dispatch({type: 'thread.model-selection.set', threadId, modelSelection: {instanceId: engine, model}});
    if (level && LEVEL_IDS.has(level)) await this.dispatch({type: 'thread.runtime-mode.set', threadId, runtimeMode: level});
    if (typeof plan === 'boolean') await this.dispatch({type: 'thread.interaction-mode.set', threadId, interactionMode: plan ? 'plan' : 'default'});
    return this.thread(threadId);
  }

  async organize({threadId, action} = {}) {
    const types = {pin: 'thread.pin', unpin: 'thread.unpin', archive: 'thread.archive', unarchive: 'thread.unarchive'};
    if (!types[action]) throw new Error('不认识的整理动作');
    await this.dispatch({type: types[action], threadId});
    return {ok: true};
  }

  // 整段对话的改动：引擎有检查点就要它算好的差异；没有（比如不是 git 仓库）就把每次改文件的差异拼起来。
  async diff({threadId} = {}) {
    const summary = await this.thread(threadId);
    if (summary.turnCount > 0) {
      try {
        const result = await this.call('orchestration.getFullThreadDiff', {threadId, toTurnCount: summary.turnCount});
        if (typeof result?.diff === 'string' && result.diff.trim()) return {source: 'engine', diff: clip(result.diff, 400_000), changes: summary.changes};
      } catch (error) { this.logger?.warn?.(`engines diff: ${error.message}`); }
    }
    return {source: 'items', diff: summary.items.filter(item => item.kind === 'edit' && item.diff).map(item => item.diff).join('\n'), changes: summary.changes};
  }
}

export function registerEngineBridge(api, {service, register, stateRoot = '', ensureRunning}) {
  const bridge = new EngineBridge({service, stateRoot, logger: api.logger});
  const needKey = sessionKey => { if (!/^agent:metre:/.test(String(sessionKey || ''))) throw new Error('引擎台只在 Metre 的会话里用'); return String(sessionKey); };
  const view = async sessionKey => {
    const pref = bridge.sessions.get(sessionKey) || {engine: 'metre'};
    let summary = null, error = '';
    if (pref.threadId && service.status().running) {
      try { summary = await bridge.thread(pref.threadId); } catch (e) { error = e.message; }
    }
    return {sessionKey, pref, summary, error, service: service.status()};
  };
  register(api, 'pinkie.engines.catalog', async ({refresh} = {}) => ({...service.status(), ...await bridge.catalog({refresh: refresh === true})}));
  register(api, 'pinkie.engines.session', async ({sessionKey}) => view(needKey(sessionKey)));
  register(api, 'pinkie.engines.choose', async ({sessionKey, engine, model, level, plan, newThread}) => {
    const key = needKey(sessionKey);
    const before = bridge.sessions.get(key) || {};
    // 「换一段新的对话」：旧对话留在引擎里，这个会话下一句话开新的。
    if (newThread === true) { bridge.sessions.set(key, {threadId: '', previousThreadId: before.threadId || before.previousThreadId || ''}); return view(key); }
    const patch = {};
    if (engine) patch.engine = String(engine);
    if (model !== undefined) patch.model = String(model || '');
    if (level && LEVEL_IDS.has(level)) patch.level = level;
    if (typeof plan === 'boolean') patch.plan = plan;
    const next = bridge.sessions.set(key, patch);
    if (next.threadId && next.engine !== 'metre' && service.status().running) {
      const changedModel = (patch.engine && patch.engine !== before.engine) || (patch.model && patch.model !== before.model);
      await bridge.configure({threadId: next.threadId, ...(changedModel && next.model ? {engine: next.engine, model: next.model} : {}),
        ...(patch.level && patch.level !== before.level ? {level: patch.level} : {}), ...(typeof plan === 'boolean' && plan !== before.plan ? {plan} : {})});
    }
    return view(key);
  });
  register(api, 'pinkie.engines.say', async ({sessionKey, text, mode, worktree}) => {
    const key = needKey(sessionKey);
    await ensureRunning();
    const pref = bridge.sessions.get(key) || {};
    if (!pref.engine || pref.engine === 'metre') throw new Error('这个会话用的是 Metre 自己，不走外部引擎');
    if (pref.threadId) {
      await bridge.send({threadId: pref.threadId, text, mode: mode === 'steer' ? 'steer' : 'queue'});
    } else {
      const folder = bridge.folderFor(key);
      const started = await bridge.start({folder, engine: pref.engine, model: pref.model, text, level: pref.level, plan: pref.plan === true, worktree: worktree === true});
      bridge.sessions.set(key, {threadId: started.threadId, folder});
    }
    return view(key);
  });
  register(api, 'pinkie.engines.thread', async ({threadId}) => bridge.thread(String(threadId || '')));
  register(api, 'pinkie.engines.respond', async params => bridge.respond(params));
  register(api, 'pinkie.engines.stop', async ({threadId}) => bridge.stop({threadId: String(threadId || '')}));
  register(api, 'pinkie.engines.organize', async params => bridge.organize(params));
  register(api, 'pinkie.engines.diff', async ({threadId}) => bridge.diff({threadId: String(threadId || '')}));
  register(api, 'pinkie.engines.signin', async ({engine, open} = {}) => {
    const known = ENGINES.find(item => item.id === engine);
    if (!known) throw new Error('不认识这个引擎');
    if (open === true && known.signin.how === 'terminal') openLoginTerminal(known.signin.command);
    return {engine: known.id, name: known.name, ...known.signin, opened: open === true && known.signin.how === 'terminal'};
  });
  return bridge;
}
