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
import {readProviderFiles} from './engines.mjs';
import {boundProjectRoot} from './project-brief.mjs';

// OpenMausBot 的审批分级（docs/approval-levels.md）= T3 的运行模式。默认全放手，和 Metre 自己「不设确认关卡」一致。
export const LEVELS = [
  {id: 'full-access', name: '全放手', hint: '命令和改文件都直接做；真有问题或缺账号才来问你'},
  {id: 'auto', name: '自己判断', hint: '常规操作自己批，拿不准的来问你'},
  {id: 'auto-accept-edits', name: '改文件不问', hint: '改文件直接做，跑命令等别的事先问你'},
  {id: 'approval-required', name: '每步都问', hint: '跑命令、改文件之前都先等你点头'},
];
const LEVEL_IDS = new Set(LEVELS.map(level => level.id));
// 引擎服务支持的十家（用户 11-22：「把人家支持的都加上」）。顺序 = 菜单里的顺序。
// install：没有托管安装时给用户的官方安装命令（win / mac / any），只在用户点了「在终端里装」才开终端跑；
// 官方没给这个系统的命令就只给 link。login：官方登录命令。managed：引擎服务自己能装（install）或能在浏览器里登录（signin）。
// 来源：引擎服务的 docs/user/install.md#providers 和各家官方文档（PROGRESS 11-22 深夜）。
export const ENGINES = [
  {id: 'claudeAgent', name: 'Claude Code', login: 'claude auth login', install: {any: 'npm install -g @anthropic-ai/claude-code'}, link: 'https://claude.com/product/claude-code'},
  {id: 'codex', name: 'Codex', login: 'codex login', install: {any: 'npm install -g @openai/codex'}, link: 'https://developers.openai.com/codex/cli'},
  {id: 'antigravity', name: 'Antigravity', managed: {install: true, signin: true}, link: 'https://antigravity.google'},
  {id: 'cursor', name: 'Cursor', login: 'agent login', managed: {signin: true}, note: '要付费的 Cursor 套餐',
    install: {win: "irm 'https://cursor.com/install?win32=true' | iex", mac: 'curl https://cursor.com/install -fsS | bash'}, link: 'https://cursor.com/cli'},
  {id: 'opencode', name: 'OpenCode', login: 'opencode auth login', install: {any: 'npm install -g @opencode/cli'}, link: 'https://opencode.ai'},
  {id: 'grok', name: 'Grok Build', login: 'grok login', note: '要 SuperGrok 或 X Premium+',
    install: {mac: 'curl -fsSL https://x.ai/cli/install.sh | bash'}, link: 'https://docs.x.ai/build/overview'},
  {id: 'kiro', name: 'Kiro', login: 'kiro-cli login',
    install: {win: "irm 'https://cli.kiro.dev/install.ps1' | iex", mac: 'curl -fsSL https://cli.kiro.dev/install | bash'}, link: 'https://kiro.dev/docs/cli/'},
  {id: 'pi', name: 'Pi', login: 'pi', loginHint: '窗口里输入 /login，选你的模型服务商', note: '要 Node.js 22.19 以上',
    install: {any: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent'}, link: 'https://pi.dev'},
  {id: 'fx', name: 'fx', login: 'fx login', install: {mac: 'curl -fsSL https://fx.sh/setup.sh | bash'}, link: 'https://fx.sh'},
  {id: 'muse', name: 'Muse Code', login: 'muse login', install: {}, link: 'https://dev.meta.ai/docs/muse-code'},
];
const ENGINE_NAME = Object.fromEntries(ENGINES.map(engine => [engine.id, engine.name]));
const engineInfo = id => ENGINES.find(engine => engine.id === id) || null;
const installCommand = (info, platform = process.platform) => info?.install?.[platform === 'win32' ? 'win' : 'mac'] || info?.install?.any || '';
// 用户点了才开终端，而且只跑这张表里写死的命令。
const TERMINAL_COMMANDS = new Set(ENGINES.flatMap(engine => [engine.login, ...Object.values(engine.install || {})]).filter(Boolean));
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

// 一家引擎此刻能不能用，说成大白话：ready 能用 / off 还没打开 / missing 没装 / signin 没登录 / error 别的毛病。
export function engineState(provider = {}) {
  const message = String(provider.message || '');
  const status = String(provider.status || 'unknown');
  const auth = String(provider.auth?.status || 'unknown');
  if (provider.enabled !== true || status === 'disabled') return {state: 'off', text: '还没打开'};
  if (provider.installed !== true || /not installed|not on PATH|ENOENT/i.test(message)) return {state: 'missing', text: '这台电脑上还没装'};
  if (auth === 'unauthenticated' || (status !== 'ready' && /not authenticated|not (?:logged|signed) in|auth login|\blogin\b/i.test(message))) return {state: 'signin', text: '还没登录，或者登录过期了'};
  if (status === 'ready') return {state: 'ready', text: ''};
  if (status === 'warning') return {state: 'ready', text: brandless(message)};
  return {state: 'error', text: brandless(message) || '暂时用不了'};
}

// server.getConfig 的 providers（或缓存文件）→ 引擎菜单。只留状态、套餐名、版本、模型；邮箱去掉。
// 表里有、引擎服务还没报上来的（比如从没打开过的 Antigravity）也列出来，算「还没打开」。
export function summarizeProviders(providers = [], {platform = process.platform, all = true} = {}) {
  const rows = (Array.isArray(providers) ? providers : []).map(provider => {
    const label = String(provider?.auth?.label || '');
    const id = String(provider?.instanceId || '');
    const info = engineInfo(id);
    return {
      id,
      driver: String(provider.driver || ''),
      name: engineName(id) || brandless(provider.displayName || id),
      enabled: provider.enabled === true,
      installed: provider.installed === true,
      version: provider.version || null,
      status: String(provider.status || 'unknown'),
      signedIn: provider.auth?.status === 'authenticated',
      plan: label.includes('@') ? '' : label,
      message: brandless(provider.message || ''),
      ...engineState(provider),
      setup: {canInstall: provider.setup?.canInstall === true || info?.managed?.install === true && provider.installed !== true,
        canAuthenticate: provider.setup?.canAuthenticate === true},
      quota: quota(provider.usageLimits),
      models: (Array.isArray(provider.models) ? provider.models : []).map(model => ({
        slug: String(model.slug || ''), name: String(model.name || model.slug || ''), isDefault: model.isDefault === true,
      })).filter(model => model.slug),
    };
  }).filter(row => row.id);
  if (all) for (const info of ENGINES) if (!rows.some(row => row.id === info.id)) {
    rows.push({id: info.id, driver: info.id, name: info.name, enabled: false, installed: false, version: null, status: 'disabled', signedIn: false, plan: '',
      message: '', state: 'off', text: '还没打开', setup: {canInstall: info.managed?.install === true, canAuthenticate: info.managed?.signin === true},
      quota: {state: 'unknown', resetAt: null, text: ''}, models: []});
  }
  const order = id => { const index = ENGINES.findIndex(engine => engine.id === id); return index < 0 ? ENGINES.length : index; };
  rows.sort((x, y) => order(x.id) - order(y.id) || x.name.localeCompare(y.name));
  return rows.map(row => ({...row, guide: setupGuide(row.id, platform)}));
}

// 菜单里「怎么装 / 怎么登录」那一小块。
export function setupGuide(id, platform = process.platform) {
  const info = engineInfo(id);
  if (!info) return null;
  return {install: installCommand(info, platform), login: info.login || '', loginHint: info.loginHint || '', link: info.link || '', note: info.note || '',
    managedInstall: info.managed?.install === true, managedSignin: info.managed?.signin === true};
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

// 在终端里让用户自己装、自己登录（碧琪不经手账号）。只跑 ENGINES 表里写死的命令。
// Windows：官方给的是 PowerShell 一行（irm … | iex）就开 PowerShell，其余开命令行窗口（npm 的 .ps1 常被执行策略挡住）；Mac 开「终端」。
export function openTerminal(command, {platform = process.platform, spawnImpl = spawn} = {}) {
  if (!TERMINAL_COMMANDS.has(command)) throw new Error('不认识的命令');
  const detached = {detached: true, stdio: 'ignore', windowsHide: false};
  let child;
  if (platform === 'win32') {
    const shell = /^irm /.test(command) ? `powershell.exe -NoExit -ExecutionPolicy Bypass -Command "${command}"` : `cmd.exe /k ${command}`;
    // windowsVerbatimArguments：参数原样用空格拼起来，命令里的引号和 | 由 start 后面的程序自己解析。
    child = spawnImpl('cmd.exe', ['/c', 'start', '"Metre"', shell], {...detached, windowsVerbatimArguments: true});
  } else if (platform === 'darwin') {
    const script = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    child = spawnImpl('osascript', ['-e', `tell application "Terminal" to do script "${script}"`, '-e', 'tell application "Terminal" to activate'], detached);
  } else child = spawnImpl('x-terminal-emulator', ['-e', command], detached);
  child?.unref?.();
  return {opened: true};
}
export const openLoginTerminal = openTerminal;

// 登录页用系统浏览器打开（引擎服务给的链接，只放 https）。
export function openBrowser(url, {platform = process.platform, spawnImpl = spawn} = {}) {
  if (!/^https:\/\/[^\s"]+$/i.test(String(url || ''))) throw new Error('这个登录链接不是网页地址，没有打开');
  const detached = {detached: true, stdio: 'ignore'};
  const child = platform === 'win32' ? spawnImpl('rundll32.exe', ['url.dll,FileProtocolHandler', url], detached)
    : spawnImpl(platform === 'darwin' ? 'open' : 'xdg-open', [url], detached);
  child?.unref?.();
  return {opened: true};
}

const https = url => /^https:\/\/[^\s"]+$/i.test(String(url || '')) ? String(url) : '';
const DONE_PHASES = new Set(['succeeded', 'failed', 'cancelled']);

// 引擎服务的托管登录状态 → 界面要的那点东西。要填密钥的方式不在 Metre 里做（碧琪不经手凭据），只告诉用户换个方式。
export function authView(state) {
  if (!state || typeof state !== 'object') return null;
  const interaction = state.interaction || null;
  let step = null;
  if (interaction?.type === 'browser') step = {type: 'browser', id: String(interaction.id), url: https(interaction.url), consent: interaction.requiresConsent === true, paste: interaction.acceptsCallback === true};
  else if (interaction?.type === 'deviceCode') step = {type: 'deviceCode', id: String(interaction.id), url: https(interaction.url), code: String(interaction.userCode || '')};
  else if (interaction?.type === 'credentials') step = {type: 'credentials'};
  else if (interaction?.type === 'terminal') step = {type: 'terminal'};
  return {phase: String(state.phase || 'idle'), flowId: state.flowId ? String(state.flowId) : '', url: https(state.authorizationUrl), expiresAt: state.expiresAt || null, step,
    message: brandless(state.message || ''), methods: (Array.isArray(state.methods) ? state.methods : []).map(method => ({id: String(method.id), name: brandless(method.name), type: String(method.type)}))};
}

export function installView(state) {
  if (!state || typeof state !== 'object') return null;
  return {phase: String(state.phase || 'idle'), downloaded: Number(state.downloadedBytes) || 0, total: Number(state.totalBytes) || 0,
    version: state.version || null, installedVersion: state.installedVersion || null, message: brandless(state.message || '')};
}

export class EngineBridge {
  constructor({service, stateRoot = '', logger = null, RpcImpl = T3Rpc, now = () => Date.now(), spawnImpl = spawn} = {}) {
    Object.assign(this, {service, stateRoot, logger, RpcImpl, now, spawnImpl});
    this.sessions = new SessionEngines(path.join(service.root, 'sessions.json'));
    this.rpcClient = null;
    this.rpcPort = 0;
    this.token = {value: '', expiresAt: 0};
    this.projects = new Map();
    this.configCache = {at: 0, value: null};
    this.watches = new Map();
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
        const providers = (await this.config(refresh))?.providers;
        if (Array.isArray(providers) && providers.length) { engines = summarizeProviders(providers); source = 'live'; }
      } catch (error) { this.logger?.warn?.(`engines catalog: ${error.message}`); }
    }
    if (!engines.length) engines = summarizeProviders(readProviderFiles(this.service.home)).map(row => ({...row, quota: {state: 'unknown', resetAt: null, text: ''}}));
    return {engines, levels: LEVELS, source};
  }

  // 打开或关上一家引擎：照引擎服务自己的设置页，upsert 这一家的实例配置（保留它原有的配置），再让它重新检查这一家。
  async turnOn({engine, on = true} = {}) {
    if (!engineInfo(engine)) throw new Error('不认识这个引擎');
    const config = await this.config(true);
    const settings = config?.settings?.providerInstances ? config.settings : await this.call('server.getSettings', {});
    const current = settings?.providerInstances?.[engine] || {driver: engine};
    await this.call('server.updateSettings', {patch: {}, providerInstanceMutation: {operation: 'upsert', instanceId: engine,
      instance: {...current, driver: current.driver || engine, enabled: on !== false}}});
    await this.call('server.refreshProviders', {instanceId: engine}, {timeout: 90_000}).catch(error => this.logger?.warn?.(`engines refresh ${engine}: ${error.message}`));
    this.configCache = {at: 0, value: null};
    return this.catalog();
  }

  // 托管安装、托管登录：开一条订阅，最新状态记在内存里，界面每秒来取一次。做完（成功、失败、取消）让引擎服务重新检查这一家，再关订阅。
  watch(engine, kind, startedId = '') {
    const key = `${kind}:${engine}`;
    let entry = this.watches.get(key);
    if (entry && startedId) entry.id = startedId;
    if (entry?.open) return entry;
    entry = {state: entry?.state || null, id: startedId || entry?.id || '', open: true, handle: null};
    this.watches.set(key, entry);
    const tag = kind === 'install' ? 'provider.install.subscribe' : 'provider.auth.subscribe';
    const close = () => { entry.open = false; clearTimeout(entry.timer); try { entry.handle?.close(); } catch {} };
    entry.timer = setTimeout(close, 20 * 60_000);
    entry.timer.unref?.();
    this.rpc().stream(tag, {instanceId: engine}, value => {
      entry.state = value;
      const id = String(value?.operationId || value?.flowId || '');
      if (DONE_PHASES.has(value?.phase) && entry.id && id === entry.id) {
        this.configCache = {at: 0, value: null};
        this.call('server.refreshProviders', {instanceId: engine}, {timeout: 90_000}).catch(() => null);
        close();
      }
    }, () => { entry.open = false; }).then(handle => { entry.handle = handle; if (!entry.open) handle.close(); }, error => { entry.open = false; this.logger?.warn?.(`engines watch ${key}: ${error.message}`); });
    return entry;
  }

  setupState({engine} = {}) {
    return {engine, install: installView(this.watches.get(`install:${engine}`)?.state), auth: authView(this.watches.get(`auth:${engine}`)?.state)};
  }

  // 装：引擎服务能托管安装的（Antigravity）走它；其余给官方安装命令，用户点了「在终端里装」才开终端。
  async install({engine, open = false} = {}) {
    const info = engineInfo(engine);
    if (!info) throw new Error('不认识这个引擎');
    if (info.managed?.install) {
      const state = await this.call('provider.install.start', {instanceId: engine}, {timeout: 60_000});
      const entry = this.watch(engine, 'install', String(state?.operationId || ''));
      entry.state ||= state;
      return {engine, how: 'managed', install: installView(state)};
    }
    const command = installCommand(info);
    if (!command) return {engine, how: 'link', link: info.link || ''};
    if (open === true) openTerminal(command, {spawnImpl: this.spawnImpl});
    return {engine, how: 'terminal', command, opened: open === true, link: info.link || ''};
  }

  // 登录：引擎服务能在浏览器里登录的（Antigravity、Cursor）走它；其余开终端跑官方登录命令。
  async signin({engine, open = false, methodId = ''} = {}) {
    const info = engineInfo(engine);
    if (!info) throw new Error('不认识这个引擎');
    if (info.managed?.signin && this.service.status().running) {
      const state = await this.call('provider.auth.start', {instanceId: engine, ...(methodId ? {methodId: String(methodId)} : {})}, {timeout: 60_000});
      // 订阅的第一条可能晚到：先用开始时拿到的状态垫上，第一下点「打开登录页」就能用。
      const entry = this.watch(engine, 'auth', String(state?.flowId || ''));
      if (!entry.state || entry.state.flowId !== state?.flowId) entry.state = state;
      return {engine, name: info.name, how: 'managed', auth: authView(state)};
    }
    if (!info.login) return {engine, name: info.name, how: 'link', link: info.link || ''};
    if (open === true) openTerminal(info.login, {spawnImpl: this.spawnImpl});
    return {engine, name: info.name, how: 'terminal', command: info.login, hint: info.loginHint || '', opened: open === true};
  }

  // 登录进行中的一步：open 打开登录页（要同意的先替用户点「同意」——用户在 Metre 里点按钮就是同意）、paste 回贴登录页给的代码、cancel 取消。
  async signinStep({engine, action, code = ''} = {}) {
    const state = this.watches.get(`auth:${engine}`)?.state;
    const view = authView(state);
    if (!view?.flowId) throw new Error('没有进行中的登录，先点「登录」');
    if (action === 'open') {
      const step = view.step;
      if (step?.type === 'browser' && step.consent) {
        await this.call('provider.auth.respond', {instanceId: engine, flowId: view.flowId, interactionId: step.id, response: {type: 'browser', action: 'accept'}});
      }
      const url = step?.url || view.url;
      openBrowser(url, {spawnImpl: this.spawnImpl});
      return {...this.setupState({engine}), opened: true};
    }
    if (action === 'paste') {
      const text = String(code || '').trim();
      if (!text) throw new Error('把登录页上给的代码或者整个地址贴进来');
      const next = await this.call('provider.auth.complete', {instanceId: engine, flowId: view.flowId, callbackUrl: text.slice(0, 16_000)}, {timeout: 60_000});
      this.watches.get(`auth:${engine}`).state = next;
      return this.setupState({engine});
    }
    if (action === 'cancel') {
      const next = await this.call('provider.auth.cancel', {instanceId: engine, flowId: view.flowId});
      this.watches.get(`auth:${engine}`).state = next;
      return this.setupState({engine});
    }
    throw new Error('不认识的登录动作');
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
  // 引擎的打开、安装、登录（3.7）。托管的要引擎服务在跑；终端那条只有用户点了（open: true）才开窗口。
  register(api, 'pinkie.engines.turnOn', async ({engine, on} = {}) => { await ensureRunning(); return {...service.status(), ...await bridge.turnOn({engine, on: on !== false})}; });
  register(api, 'pinkie.engines.install', async ({engine, open} = {}) => {
    if (engineInfo(engine)?.managed?.install) await ensureRunning();
    return bridge.install({engine, open: open === true});
  });
  register(api, 'pinkie.engines.signin', async ({engine, open, methodId} = {}) => {
    if (engineInfo(engine)?.managed?.signin && open === true) await ensureRunning();
    return bridge.signin({engine, open: open === true, methodId});
  });
  register(api, 'pinkie.engines.setup', async ({engine, action, code} = {}) => {
    if (!engineInfo(engine)) throw new Error('不认识这个引擎');
    return action ? bridge.signinStep({engine, action, code}) : bridge.setupState({engine});
  });
  return bridge;
}
