// Metre 引擎台的后端：把 T3 Code 的对话投影翻成 Metre 自己画的一份清单，并把引擎台上的按钮翻成 T3 的命令。
// 计划：briefs/metre-engines-1122/PLAN.md 3.3、3.5。界面在 ui/injections/laolao-metre-engine.js。
//
// 只用 T3 自己网页用的那几条命令（orchestration.launchThread / dispatchCommand / getThreadProjection / getFullThreadDiff，
// server.getConfig / refreshProviders），不碰它的数据库。账号邮箱一律不出这个文件。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {T3Rpc} from './engines-rpc.mjs';
import {readProviderFiles} from './engines.mjs';
import {PINKIE_FOLDER, PINKIE_INSTANCE, PINKIE_LABEL, PinkieRelay, linkPinkieHistory, pinkieInstance, pinkieModels, writePinkieSettings} from './engines-upstream.mjs';
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
// 「更多引擎」（E6，engines-registry.mjs）：从公开的 ACP 注册表加进来的引擎，driver 都是 acpRegistry，各自带模型和登录。
// 不进上面十家的表（菜单不会把它当成一行「还没打开」列出来），只在认实例时用：登录走引擎服务托管（provider.auth.*）。
export const REGISTRY_DRIVER = 'acpRegistry';
const REGISTRY_INFO = {id: REGISTRY_DRIVER, name: '更多引擎', managed: {signin: true}, registry: true};
const engineInfo = id => ENGINES.find(engine => engine.id === id) || (id === REGISTRY_DRIVER ? REGISTRY_INFO : null);
// 多账号（PLAN 3.7，用户 11-23）：引擎服务一个账号一个实例，实例 id 是「<家>-<n>」。
// 只有登录能分开放的几家支持：Claude 每个账号一个配置文件夹（CLAUDE_CONFIG_DIR），Codex 每个账号一个影子文件夹（共用 ~/.codex 的对话），
// Antigravity、Cursor 由引擎服务按实例各自托管登录。其余几家用这台电脑上同一份登录，开多个也是同一个账号。
export const ACCOUNTS = {
  claudeAgent: {folder: '.claude-metre-', config: dir => ({homePath: dir}), env: dir => ({CLAUDE_CONFIG_DIR: dir}), dirOf: config => config?.homePath},
  codex: {folder: '.codex-metre-', config: dir => ({shadowHomePath: dir}), env: dir => ({CODEX_HOME: dir}), dirOf: config => config?.shadowHomePath},
  antigravity: {},
  cursor: {},
};
const INSTANCE_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
// 实例 id → 哪一家。默认实例 id 就是那一家；加出来的是「<家>-<n>」；注册表里加的是「acpRegistry_<名字>」。
// 「碧琪模型」那个固定实例（engines-upstream.mjs）也算 Claude 一家。
export const driverOf = id => engineInfo(id) ? String(id) : id === PINKIE_INSTANCE ? 'claudeAgent' : /^acpRegistry_\w+$/.test(String(id || '')) ? REGISTRY_DRIVER : (/^([a-zA-Z]+)-\d+$/.exec(String(id || ''))?.[1] || '');
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
export const engineName = id => {
  if (ENGINE_NAME[id]) return ENGINE_NAME[id];
  const match = /^([a-zA-Z]+)-(\d+)$/.exec(String(id || ''));
  return match && ENGINE_NAME[match[1]] ? `${ENGINE_NAME[match[1]]} · 账号 ${match[2]}` : String(id || '');
};

// 额度（11-23 真机）：Codex、Claude 的额度条管整个账号（「Session」「Weekly」）；Antigravity 按模型分条
// （「Gemini 4 Argon · Weekly」「Claude & GPT (shared) · Weekly」）。只有某个模型那条满了，就只是那几个模型用不了，不是整家用完。
const scopeOf = label => (String(label || '').includes(' · ') ? String(label).split(' · ')[0].replace(/\(shared\)/i, '').trim() : '');
const covers = (scope, model) => scope.split(/\s*&\s*/).some(part => part && String(model.name || model.slug || '').toLowerCase().startsWith(part.toLowerCase()));
export function quota(usageLimits, models = []) {
  const limits = usageLimits && typeof usageLimits === 'object' ? usageLimits : null;
  const windows = (Array.isArray(limits?.windows) ? limits.windows : Array.isArray(limits?.limits) ? limits.limits : [])
    .map(item => ({used: Number(item?.usedPercent ?? item?.percentUsed), resetAt: item?.resetsAt || item?.resetAt || null, scope: scopeOf(item?.label)}))
    .filter(item => Number.isFinite(item.used));
  const latest = list => list.map(item => item.resetAt).filter(Boolean).sort().at(-1) || null;
  const full = windows.filter(item => item.used >= 100);
  const whole = full.filter(item => !item.scope);
  if (whole.length) return {state: 'out', resetAt: latest(whole), text: '额度用完了', outModels: []};
  const scoped = full.filter(item => item.scope);
  const outModels = models.filter(model => scoped.some(item => covers(item.scope, model))).map(model => String(model.slug));
  if (scoped.length && models.length && outModels.length === models.length) return {state: 'out', resetAt: latest(scoped), text: '额度用完了', outModels};
  const top = windows.filter(item => item.used < 100).map(item => item.used).sort((a, b) => b - a)[0];
  const parts = [Number.isFinite(top) ? `已用 ${Math.round(top)}%` : '', scoped.length ? `${[...new Set(scoped.map(item => item.scope))].join('、')} 用完了` : ''].filter(Boolean);
  return {state: windows.length ? 'ok' : 'unknown', resetAt: scoped.length ? latest(scoped) : null, text: parts.join(' · '), outModels};
}

const KEY_ONLY = /api[ _-]?key|_API_KEY\b/i;
const KEY_ONLY_TEXT = '只能填 API 密钥登录，Metre 里不经手密钥，用不了';
const keyLike = method => /env_var|credentials/.test(String(method?.type)) || KEY_ONLY.test(`${method?.name || ''} ${method?.description || ''}`);
// 一家引擎此刻能不能用，说成大白话：ready 能用 / off 还没打开 / missing 没装 / signin 没登录 / error 别的毛病。
export function engineState(provider = {}) {
  const message = String(provider.message || '');
  const status = String(provider.status || 'unknown');
  const auth = String(provider.auth?.status || 'unknown');
  if (provider.enabled !== true || status === 'disabled') return {state: 'off', text: '还没打开'};
  if (provider.installed !== true || /not installed|not on PATH|ENOENT/i.test(message)) return {state: 'missing', text: '这台电脑上还没装'};
  // 注册表里的引擎只给填 API 密钥的登录（11-23 真机：Qwen Code 0.28.4 只有「Use OpenAI API key」）：碧琪不经手密钥，这家在 Metre 里用不了。
  if (provider.driver === REGISTRY_DRIVER && auth !== 'authenticated' && KEY_ONLY.test(message)) return {state: 'keyonly', text: KEY_ONLY_TEXT};
  // 「碧琪模型」那个实例走碧琪上游，不用登录订阅：不按登录状态判断。
  const pinkie = String(provider.instanceId || '') === PINKIE_INSTANCE;
  if (!pinkie && (auth === 'unauthenticated' || (status !== 'ready' && /not authenticated|not (?:logged|signed) in|auth login|\blogin\b/i.test(message)))) return {state: 'signin', text: '还没登录，或者登录过期了'};
  // 能在浏览器里登录的（Antigravity、Cursor）：刚打开时引擎服务报「装好了、账号还没查」也是 ready，但其实还没登录、一个模型都没有。
  if (!pinkie && provider.setup?.canAuthenticate === true && auth !== 'authenticated') return {state: 'signin', text: '还没登录'};
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
    const driver = String(provider?.driver || '') || driverOf(id);
    const info = engineInfo(driver);
    // 「碧琪模型」那一行不是加出来的账号：不能改名、不能删，也不用登录订阅。
    const pinkie = id === PINKIE_INSTANCE;
    const extra = id !== driver && !pinkie;
    return {
      id,
      driver,
      // 加出来的账号用它自己的名字（「Claude Code · 工作号」）；默认账号用那一家的名字。
      name: pinkie ? `${engineName(driver)} · ${PINKIE_LABEL}` : (extra && brandless(provider.displayName || '').replace(EMAIL, '').trim()) || engineName(id) || brandless(provider.displayName || id),
      account: extra,
      // 用谁的模型：pinkie = 碧琪上游（不用订阅，用量记在碧琪的额度上），own = 这一家自己的账号。
      upstream: pinkie ? 'pinkie' : 'own',
      multi: Boolean(ACCOUNTS[driver]),
      registry: driver === REGISTRY_DRIVER,
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
      ...(() => {
        const models = (Array.isArray(provider.models) ? provider.models : []).map(model => ({
          slug: String(model.slug || ''), name: String(model.name || model.slug || ''), isDefault: model.isDefault === true,
        })).filter(model => model.slug);
        const limit = quota(provider.usageLimits, models);
        // 模型菜单里标出这几个模型这会儿额度用完了。
        return {quota: limit, models: models.map(model => (limit.outModels.includes(model.slug) ? {...model, out: true} : model))};
      })(),
    };
  // 引擎服务自带的那个空的注册表实例（没指定是哪一家）不列。
  }).filter(row => row.id && row.id !== REGISTRY_DRIVER);
  if (all) for (const info of ENGINES) if (!rows.some(row => row.id === info.id)) {
    rows.push({id: info.id, driver: info.id, name: info.name, account: false, multi: Boolean(ACCOUNTS[info.id]), enabled: false, installed: false, version: null, status: 'disabled', signedIn: false, plan: '',
      message: '', state: 'off', text: '还没打开', setup: {canInstall: info.managed?.install === true, canAuthenticate: info.managed?.signin === true},
      quota: {state: 'unknown', resetAt: null, text: ''}, models: []});
  }
  // 同一家的账号排在一起：默认账号在前，加出来的按编号。
  const order = id => { const index = ENGINES.findIndex(engine => engine.id === id); return index < 0 ? ENGINES.length : index; };
  const number = id => Number(/-(\d+)$/.exec(id)?.[1] || 1);
  rows.sort((x, y) => order(x.driver) - order(y.driver) || number(x.id) - number(y.id) || x.name.localeCompare(y.name));
  return rows.map(row => ({...row, guide: setupGuide(row.driver, platform)}));
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
    // Antigravity 报的是文件网址式路径（/F:/…），去掉前面那条斜杠；它也不给逐行差异和行数（11-23 真机），行数留空，不当成 0。
    case 'file_change': return {...base, kind: 'edit', file: String(item.fileName || '').replace(/^\/([A-Za-z]:[\\/])/, '$1'), additions: item.additions ?? null, deletions: item.deletions ?? null,
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
    const row = changes.get(item.file) || {file: item.file, additions: 0, deletions: 0, edits: 0, counted: false};
    row.additions += Number(item.additions) || 0;
    row.deletions += Number(item.deletions) || 0;
    // counted：引擎报过行数。一次都没报过的文件，界面上写「改了」，不写 +0 −0。
    if (item.additions != null || item.deletions != null) row.counted = true;
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
    runId: (active || latest)?.id ? String((active || latest).id) : null,
    runStartedAt: (active || latest)?.startedAt || (active || latest)?.requestedAt || null,
    runCompletedAt: active ? null : latest?.completedAt || null,
    items,
    pending: pending.map(item => ({requestId: item.requestId, kind: item.kind})),
    changes: [...changes.values()],
    turnCount,
    error: lastError && runStatus(latest, pending) === 'failed' ? {text: lastError.text, failureClass: lastError.failureClass, resetAt: lastError.resetAt} : null,
  };
}

// 引擎服务算好的整段差异 → 改了哪些文件、各加减几行（11-23 真机：Claude 用命令改文件时没有「改文件」那一行，文件清单只能从差异里来）。
export function diffFiles(diff) {
  const files = new Map();
  let current = null;
  for (const line of String(diff || '').split('\n')) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) { current = files.get(head[2]) || {file: head[2], additions: 0, deletions: 0, edits: 1, counted: true}; files.set(current.file, current); continue; }
    if (!current || line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) current.additions += 1;
    else if (line.startsWith('-')) current.deletions += 1;
  }
  return [...files.values()];
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
// env：多账号时把这个账号自己的登录文件夹交给登录命令（只认 ACCOUNTS 里的两个变量名，值必须是绝对路径、不含引号）。
export function openTerminal(command, {platform = process.platform, spawnImpl = spawn, env = null} = {}) {
  if (!TERMINAL_COMMANDS.has(command)) throw new Error('不认识的命令');
  const extra = Object.entries(env || {});
  for (const [name, value] of extra) {
    if (!['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'BROWSER'].includes(name) || !(platform === 'win32' ? path.win32 : path.posix).isAbsolute(String(value)) || /["'`$%\r\n]/.test(String(value))) throw new Error('不认识的登录文件夹');
    if (name === 'BROWSER' && !/private-browser\.(?:cmd|sh)$/.test(String(value))) throw new Error('不认识的浏览器启动器');
  }
  const detached = {detached: true, stdio: 'ignore', windowsHide: false, ...(extra.length ? {env: {...process.env, ...Object.fromEntries(extra)}} : {})};
  let child;
  if (platform === 'win32') {
    const shell = /^irm /.test(command) ? `powershell.exe -NoExit -ExecutionPolicy Bypass -Command "${command}"` : `cmd.exe /k ${command}`;
    // windowsVerbatimArguments：参数原样用空格拼起来，命令里的引号和 | 由 start 后面的程序自己解析。新窗口继承上面的 env。
    child = spawnImpl('cmd.exe', ['/c', 'start', '"Metre"', shell], {...detached, windowsVerbatimArguments: true});
  } else if (platform === 'darwin') {
    // 「终端」不继承 osascript 的环境变量，账号文件夹写在命令前面。
    const line = extra.map(([name, value]) => `${name}='${value}' `).join('') + command;
    const script = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    child = spawnImpl('osascript', ['-e', `tell application "Terminal" to do script "${script}"`, '-e', 'tell application "Terminal" to activate'], detached);
  } else child = spawnImpl('x-terminal-emulator', ['-e', command], detached);
  child?.unref?.();
  return {opened: true};
}
export const openLoginTerminal = openTerminal;

// 给用户看、给复制的那一行登录命令（带这个账号自己的文件夹）。真开终端时用的是 env，不靠这一行。
export function loginLine(command, env, platform = process.platform) {
  const pairs = Object.entries(env || {});
  if (!pairs.length) return command;
  return platform === 'win32'
    ? pairs.map(([name, value]) => `set "${name}=${value}" && `).join('') + command
    : pairs.map(([name, value]) => `${name}='${value}' `).join('') + command;
}

// 登录一律开无痕窗口（用户 11-23：「开一个无痕浏览器给我登入，不要用我的浏览器」）：不碰用户平时浏览器里的登录，
// 多账号时也不会被浏览器里已经登着的那个号带错。Windows 用 Edge InPrivate（系统自带），没有再试 Chrome 无痕；Mac 用 Chrome 无痕。都没有才退回默认浏览器。
export function privateBrowser({platform = process.platform, env = process.env, exists = fs.existsSync} = {}) {
  const candidates = platform === 'win32'
    ? [[env['ProgramFiles(x86)'], 'Microsoft\\Edge\\Application\\msedge.exe', '--inprivate'], [env.ProgramFiles, 'Microsoft\\Edge\\Application\\msedge.exe', '--inprivate'],
      [env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe', '--incognito'], [env.ProgramFiles, 'Google\\Chrome\\Application\\chrome.exe', '--incognito']]
    : platform === 'darwin' ? [['/Applications', 'Google Chrome.app/Contents/MacOS/Google Chrome', '--incognito'], ['/Applications', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '--inprivate']]
      : [['/usr/bin', 'google-chrome', '--incognito'], ['/usr/bin', 'chromium', '--incognito']];
  for (const [base, rel, flag] of candidates) {
    if (!base) continue;
    const file = path.join(base, rel);
    if (exists(file)) return {file, flag};
  }
  return null;
}

// 登录页（引擎服务给的链接，只放 https）在无痕窗口里打开。
export function openBrowser(url, {platform = process.platform, spawnImpl = spawn, browser = privateBrowser({platform})} = {}) {
  if (!/^https:\/\/[^\s"]+$/i.test(String(url || ''))) throw new Error('这个登录链接不是网页地址，没有打开');
  const detached = {detached: true, stdio: 'ignore'};
  const child = browser ? spawnImpl(browser.file, [browser.flag, url], detached)
    : platform === 'win32' ? spawnImpl('rundll32.exe', ['url.dll,FileProtocolHandler', url], detached)
      : spawnImpl(platform === 'darwin' ? 'open' : 'xdg-open', [url], detached);
  child?.unref?.();
  return {opened: true, private: Boolean(browser)};
}

// 终端里的官方登录命令（claude auth login 等）会按 BROWSER 打开登录页（11-23 实测 Claude 认）。
// 给它一个小启动器：把链接交给无痕窗口。写在引擎目录里（纯英文路径）。
export function browserLauncher(dir, {platform = process.platform, browser = privateBrowser({platform})} = {}) {
  if (!browser) return '';
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, platform === 'win32' ? 'private-browser.cmd' : 'private-browser.sh');
  const body = platform === 'win32'
    ? `@echo off\r\nstart "" "${browser.file}" ${browser.flag} %1\r\n`
    : `#!/bin/sh\nexec "${browser.file}" ${browser.flag} "$1" >/dev/null 2>&1 &\n`;
  fs.writeFileSync(file, body, {mode: 0o755});
  return file;
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
  else if (interaction?.type === 'credentials') {
    // Antigravity 的「贴代码」登录（真机 11-23）：只有一个不保密的 code 框，是登录页最后给的一次性代码，不是密钥。
    const fields = Array.isArray(interaction.fields) ? interaction.fields : [];
    const only = fields.length === 1 ? fields[0] : null;
    step = only && only.secret !== true && /^code$/i.test(String(only.name)) ? {type: 'code', id: String(interaction.id), field: String(only.name), paste: true} : {type: 'credentials'};
  }
  else if (interaction?.type === 'terminal') step = {type: 'terminal'};
  return {phase: String(state.phase || 'idle'), flowId: state.flowId ? String(state.flowId) : '', url: https(state.authorizationUrl), expiresAt: state.expiresAt || null, step,
    // 没登录上、它给的登录方式又全是填密钥的：引擎原话（常常是英文的「Internal error」）换成大白话。
    message: state.phase === 'failed' && Array.isArray(state.methods) && state.methods.length && state.methods.every(keyLike) ? KEY_ONLY_TEXT : brandless(state.message || ''),
    methods: (Array.isArray(state.methods) ? state.methods : []).map(method => ({id: String(method.id), name: brandless(method.name), type: keyLike(method) ? 'credentials' : String(method.type)}))};
}

export function installView(state) {
  if (!state || typeof state !== 'object') return null;
  return {phase: String(state.phase || 'idle'), downloaded: Number(state.downloadedBytes) || 0, total: Number(state.totalBytes) || 0,
    version: state.version || null, installedVersion: state.installedVersion || null, message: brandless(state.message || '')};
}

export class EngineBridge {
  // pinkieConfig：碧琪自己的配置（模型目录和上游，钥匙在里面），「碧琪模型」那条路每次现读；health：碧琪的模型健康，能用的模型排前面。
  constructor({service, stateRoot = '', logger = null, RpcImpl = T3Rpc, now = () => Date.now(), spawnImpl = spawn, homeDir = os.homedir(), runSync = spawnSync,
    pinkieConfig = () => ({}), health = null, RelayImpl = PinkieRelay} = {}) {
    Object.assign(this, {service, stateRoot, logger, RpcImpl, now, spawnImpl, homeDir, runSync, pinkieConfig, health, RelayImpl});
    this.relay = null;
    this.pinkieTried = false;
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
      // 「碧琪模型」那一行：第一次取清单、或者用户点了刷新时，按碧琪现在的模型目录核对一遍。
      if (refresh || !this.pinkieTried) {
        this.pinkieTried = true;
        await this.ensurePinkie().catch(error => this.logger?.warn?.(`engines pinkie upstream: ${error.message}`));
      }
      try {
        if (refresh) await this.call('server.refreshProviders', {}).catch(() => null);
        const providers = (await this.config(refresh))?.providers;
        if (Array.isArray(providers) && providers.length) { engines = summarizeProviders(providers); source = 'live'; }
      } catch (error) { this.logger?.warn?.(`engines catalog: ${error.message}`); }
    }
    if (!engines.length) engines = summarizeProviders(readProviderFiles(this.service.home)).map(row => ({...row, quota: {state: 'unknown', resetAt: null, text: ''}}));
    // 加出来的 Claude / Codex 账号：登录命令要带上它自己的文件夹，菜单里给用户看、给复制的就是带文件夹的那一行。
    if (source === 'live') {
      const instances = this.configCache.value?.settings?.providerInstances || {};
      for (const row of engines) {
        const dir = row.account && ACCOUNTS[row.driver]?.dirOf?.(instances[row.id]?.config);
        if (dir && row.guide?.login) row.guide = {...row.guide, login: loginLine(row.guide.login, ACCOUNTS[row.driver].env(dir)), accountDir: dir};
      }
    }
    return {engines, levels: LEVELS, source, accountEngines: Object.keys(ACCOUNTS).map(id => ({id, name: ENGINE_NAME[id]}))};
  }

  async settings() {
    const config = await this.config(true);
    return config?.settings?.providerInstances ? config.settings : await this.call('server.getSettings', {});
  }

  // 实例 id（默认账号就是那一家的 id，加出来的是「<家>-<n>」）→ 哪一家、引擎服务里存的配置。
  async resolve(engine) {
    const id = String(engine || '');
    if (!INSTANCE_ID.test(id)) throw new Error('不认识这个引擎');
    const settings = await this.settings().catch(() => null);
    const saved = settings?.providerInstances?.[id] || null;
    const reported = (this.configCache.value?.providers || []).find(provider => provider.instanceId === id);
    const driver = String(saved?.driver || reported?.driver || driverOf(id));
    const info = engineInfo(driver);
    if (!info) throw new Error('不认识这个引擎');
    if (id !== driver && !saved && !reported) throw new Error('这个账号已经删掉了');
    return {id, driver, info, saved};
  }

  // 打开或关上一个引擎（或一个账号）：照引擎服务自己的设置页，upsert 这个实例的配置（保留它原有的配置），再让它重新检查。
  async turnOn({engine, on = true} = {}) {
    const {id, driver, saved} = await this.resolve(engine);
    const current = saved || {driver};
    await this.call('server.updateSettings', {patch: {}, providerInstanceMutation: {operation: 'upsert', instanceId: id,
      instance: {...current, driver: current.driver || driver, enabled: on !== false}}});
    await this.refreshOne(id);
    return this.catalog();
  }

  async refreshOne(id) {
    await this.call('server.refreshProviders', {instanceId: id}, {timeout: 90_000}).catch(error => this.logger?.warn?.(`engines refresh ${id}: ${error.message}`));
    this.configCache = {at: 0, value: null};
  }

  // 「碧琪模型」那条路（engines-upstream.mjs）：起本机转发口，把这个实例的 settings.json 指向它，引擎服务里没有这个实例就建一个。
  // 碧琪目录里没有能给 Claude Code 用的模型就什么都不做（菜单里就没有这一行）。settings.json 里只有转发口的会话令牌，没有上游钥匙。
  async ensurePinkie() {
    const models = pinkieModels(this.pinkieConfig() || {}, {health: this.health});
    if (!models.length) return null;
    this.relay ||= new this.RelayImpl({config: () => this.pinkieConfig() || {}, logger: this.logger});
    await this.relay.start();
    this.relay.defaultModel = models[0].slug;
    const dir = path.join(this.homeDir, PINKIE_FOLDER);
    const stamp = `${this.relay.baseUrl} ${models[0].slug}`;
    if (this.pinkieStamp !== stamp) { writePinkieSettings(dir, {baseUrl: this.relay.baseUrl, token: this.relay.token, model: models[0].slug}); this.pinkieStamp = stamp; }
    // 会话历史和默认账号共用一个 projects（junction）：同一段对话切到 / 切出「碧琪模型」后历史还在。
    // 那里已经有一个不是链接的目录就不动它，只记一句，历史这次不共用。
    if (this.pinkieHistory?.state !== 'ok' && this.pinkieHistory?.state !== 'linked') {
      try { this.pinkieHistory = linkPinkieHistory(dir, {shared: path.join(this.homeDir, '.claude', 'projects')}); }
      catch (error) { this.pinkieHistory = {state: 'error', message: error.message}; }
      if (!['ok', 'linked'].includes(this.pinkieHistory.state)) this.logger?.warn?.(`engines pinkie history not shared: ${this.pinkieHistory.state} ${this.pinkieHistory.link || this.pinkieHistory.message || ''}`);
    }
    const want = pinkieInstance(dir, models);
    const saved = (await this.settings().catch(() => null))?.providerInstances?.[PINKIE_INSTANCE] || null;
    const same = saved && saved.driver === want.driver && saved.config?.homePath === dir
      && JSON.stringify(saved.config?.customModels || []) === JSON.stringify(want.config.customModels);
    if (!same) {
      // 用户关掉过这一行就保持关着。
      const instance = {...(saved || {}), ...want, config: {...(saved?.config || {}), ...want.config}, enabled: saved ? saved.enabled !== false : true};
      await this.call('server.updateSettings', {patch: {}, providerInstanceMutation: {operation: saved ? 'upsert' : 'create', instanceId: PINKIE_INSTANCE, instance}});
      await this.refreshOne(PINKIE_INSTANCE);
    }
    return {models, dir};
  }

  // 加一个账号：一个新实例「<家>-<n>」。Claude / Codex 在用户目录下建一个这个账号自己的登录文件夹（旧的不碰）。
  async addAccount({driver, name = ''} = {}) {
    const info = engineInfo(driver);
    const recipe = ACCOUNTS[driver];
    if (!info || !recipe) throw new Error('这个引擎用这台电脑上同一份登录，开不了第二个账号');
    const settings = await this.settings();
    const taken = new Set([...Object.keys(settings?.providerInstances || {}), ...(this.configCache.value?.providers || []).map(provider => String(provider.instanceId))]);
    let n = 2;
    while (taken.has(`${driver}-${n}`)) n += 1;
    const id = `${driver}-${n}`;
    const label = String(name || '').replace(EMAIL, '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 40) || `账号 ${n}`;
    const instance = {driver, displayName: `${info.name} · ${label}`, enabled: true};
    if (recipe.folder) {
      let dir = path.join(this.homeDir, recipe.folder + n);
      // 文件夹已经有东西（以前删掉的账号留下的登录）就换一个新名字，不把旧登录混进新账号。
      try { if (fs.readdirSync(dir).length) dir = path.join(this.homeDir, `${recipe.folder}${n}-${this.now().toString(36)}`); } catch {}
      fs.mkdirSync(dir, {recursive: true});
      instance.config = recipe.config(dir);
    }
    await this.call('server.updateSettings', {patch: {}, providerInstanceMutation: {operation: 'create', instanceId: id, instance}});
    await this.refreshOne(id);
    return {engine: id, ...await this.catalog()};
  }

  async renameAccount({engine, name = ''} = {}) {
    const {id, driver, info, saved} = await this.resolve(engine);
    if (id === driver) throw new Error('默认账号不用改名');
    if (id === PINKIE_INSTANCE) throw new Error('「碧琪模型」这一行不用改名');
    const label = String(name || '').replace(EMAIL, '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 40);
    if (!label) throw new Error('名字是空的');
    await this.call('server.updateSettings', {patch: {}, providerInstanceMutation: {operation: 'upsert', instanceId: id, instance: {...(saved || {driver}), driver, displayName: `${info.name} · ${label}`}}});
    this.configCache = {at: 0, value: null};
    return this.catalog();
  }

  // 删掉一个加出来的账号：能托管登录的先在引擎服务里退出（去掉它存的登录），再删实例。Claude / Codex 的登录文件夹留在用户目录里，不删。
  async removeAccount({engine} = {}) {
    const {id, driver, info} = await this.resolve(engine);
    if (id === driver) throw new Error('默认账号不能删，可以关掉它');
    if (id === PINKIE_INSTANCE) throw new Error('「碧琪模型」这一行不能删，可以关掉它');
    // 注册表里的引擎在这台电脑上共用一份登录（引擎服务文档：ACP 不分账号），删掉这一行不替用户退出它。
    if (info.managed?.signin && !info.registry) await this.call('provider.auth.logout', {instanceId: id}, {timeout: 60_000}).catch(error => this.logger?.warn?.(`engines logout ${id}: ${error.message}`));
    await this.call('server.updateSettings', {patch: {}, providerInstanceMutation: {operation: 'remove', instanceId: id}});
    this.watches.delete(`auth:${id}`);
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
    const info = engineInfo(driverOf(engine));
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
    const driver = driverOf(engine);
    const info = engineInfo(driver);
    if (!info) throw new Error('不认识这个引擎');
    if (info.managed?.signin && this.service.status().running) {
      const state = await this.call('provider.auth.start', {instanceId: engine, ...(methodId ? {methodId: String(methodId)} : {})}, {timeout: 60_000});
      // 订阅的第一条可能晚到：先用开始时拿到的状态垫上，第一下点「打开登录页」就能用。
      const entry = this.watch(engine, 'auth', String(state?.flowId || ''));
      if (!entry.state || entry.state.flowId !== state?.flowId) entry.state = state;
      return {engine, name: info.name, how: 'managed', auth: authView(state)};
    }
    if (!info.login) return {engine, name: info.name, how: 'link', link: info.link || ''};
    // 加出来的 Claude / Codex 账号：登录命令只登进它自己的文件夹。
    let env = null;
    if (engine !== driver && ACCOUNTS[driver]?.dirOf) {
      const {saved} = await this.resolve(engine);
      const dir = ACCOUNTS[driver].dirOf(saved?.config);
      if (!dir) throw new Error('这个账号没有自己的登录文件夹，删掉重新加一个');
      env = ACCOUNTS[driver].env(dir);
    }
    if (open === true) {
      // 登录命令自己开浏览器时开到无痕窗口里（认 BROWSER 的命令行才管用，比如 Claude）。
      let launcher = '';
      try { launcher = browserLauncher(this.service.root); } catch (error) { this.logger?.warn?.(`engines browser launcher: ${error.message}`); }
      openTerminal(info.login, {spawnImpl: this.spawnImpl, env: {...(env || {}), ...(launcher ? {BROWSER: launcher} : {})}});
    }
    return {engine, name: info.name, how: 'terminal', command: env ? loginLine(info.login, env) : info.login, hint: info.loginHint || '', opened: open === true};
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
      // 一次性代码走 respond（填那个 code 框）；回调地址走 complete。都只转给引擎服务，不存、不写日志。
      const next = view.step?.type === 'code'
        ? await this.call('provider.auth.respond', {instanceId: engine, flowId: view.flowId, interactionId: view.step.id,
          response: {type: 'credentials', values: {[view.step.field]: text.slice(0, 16_000)}}}, {timeout: 60_000})
        : await this.call('provider.auth.complete', {instanceId: engine, flowId: view.flowId, callbackUrl: text.slice(0, 16_000)}, {timeout: 60_000});
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
    // 草稿文件夹做成 git 仓库：引擎服务靠 git 检查点算整段改动（11-23 真机：不是 git 时 Claude、Antigravity 都只报文件名，没有差异）。
    // 只管 Metre 自己的草稿文件夹，用户绑的项目文件夹一概不碰。
    if (!fs.existsSync(path.join(scratch, '.git'))) {
      const git = (...args) => this.runSync('git', ['-c', 'user.name=Metre', '-c', 'user.email=metre@localhost', ...args], {cwd: scratch, windowsHide: true, timeout: 20_000, stdio: 'ignore'});
      try { git('init', '-q'); git('commit', '--allow-empty', '-q', '-m', 'Metre 草稿'); } catch (error) { this.logger?.warn?.(`engines scratch git: ${error.message}`); }
    }
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
    // 「碧琪模型」：开线程前确认转发口在跑、settings.json 指向它（碧琪重启后转发口的端口和令牌都是新的）。
    if (engine === PINKIE_INSTANCE && !await this.ensurePinkie()) throw new Error('碧琪这边没有能给 Claude Code 用的模型');
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

  // 引擎服务的 message.dispatch 必带 createdBy / creationSource（缺了整条命令被拒，11-24 第四次真跑汇报丢在这）：
  async send({threadId, text, mode = 'queue', from = 'user'} = {}) {
    if (!String(text || '').trim()) throw new Error('要说的话是空的');
    const current = await this.thread(threadId);
    const dispatchMode = !current.activeRunId ? {type: 'start_immediately'}
      : mode === 'steer' ? {type: 'steer_active', targetRunId: current.activeRunId} : {type: 'queue_after_active'};
    const origin = from === 'agent' ? {createdBy: 'agent', creationSource: 'mcp'} : {createdBy: 'user', creationSource: 'web'};
    await this.dispatch({type: 'message.dispatch', threadId, messageId: newId('message'), text: String(text), attachments: [], dispatchMode, ...origin});
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
    // 中途切到「碧琪模型」：下一轮生效，先确认转发口在跑、settings.json 指向它。
    if (engine === PINKIE_INSTANCE && !await this.ensurePinkie()) throw new Error('碧琪这边没有能给 Claude Code 用的模型');
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
        if (typeof result?.diff === 'string' && result.diff.trim()) return {source: 'engine', diff: clip(result.diff, 400_000), changes: diffFiles(result.diff)};
      } catch (error) { this.logger?.warn?.(`engines diff: ${error.message}`); }
    }
    return {source: 'items', diff: summary.items.filter(item => item.kind === 'edit' && item.diff).map(item => item.diff).join('\n'), changes: summary.changes};
  }
}

// isEnabled：外部引擎总开关（存在 prefs.json，engines.mjs 管）。菜单靠它判断「外部引擎没打开」，所以每个返回引擎清单的方法都要带上
// （11-23 真界面里发现：原来只带了 service.status()，开关是开的菜单也说没打开）。
export function registerEngineBridge(api, {service, register, stateRoot = '', ensureRunning, isEnabled = () => service.status().running, pinkieConfig = () => ({}), health = null}) {
  const status = () => ({...service.status(), enabled: isEnabled() === true});
  const bridge = new EngineBridge({service, stateRoot, logger: api.logger, pinkieConfig, health});
  const needKey = sessionKey => { if (!/^agent:metre:/.test(String(sessionKey || ''))) throw new Error('引擎台只在 Metre 的会话里用'); return String(sessionKey); };
  const view = async sessionKey => {
    const pref = bridge.sessions.get(sessionKey) || {engine: 'metre'};
    let summary = null, error = '';
    if (pref.threadId && service.status().running) {
      try { summary = await bridge.thread(pref.threadId); } catch (e) { error = e.message; }
    }
    return {sessionKey, pref, summary, error, service: service.status()};
  };
  register(api, 'pinkie.engines.catalog', async ({refresh} = {}) => ({...status(), ...await bridge.catalog({refresh: refresh === true})}));
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
    if (bridge.decorate) text = await bridge.decorate(key, text); if (pref.threadId) { // 主脑也能派活：前面加派活说明（engines-dispatch.mjs）
      await bridge.send({threadId: pref.threadId, text, mode: mode === 'steer' ? 'steer' : 'queue'});
    } else {
      const folder = bridge.folderFor(key);
      const started = await bridge.start({folder, engine: pref.engine, model: pref.model, text, level: pref.level, plan: pref.plan === true, worktree: worktree === true});
      bridge.sessions.set(key, {threadId: started.threadId, folder}); await bridge.afterStart?.(key, started.threadId);
    }
    bridge.afterSay?.(key); // Metre 派给引擎的活：用户在引擎台或总谱里递了话，守望重新盯着它（engines-task.mjs）
    return view(key);
  });
  register(api, 'pinkie.engines.thread', async ({threadId}) => bridge.thread(String(threadId || '')));
  register(api, 'pinkie.engines.respond', async params => bridge.respond(params));
  register(api, 'pinkie.engines.stop', async ({threadId}) => { const result = await bridge.stop({threadId: String(threadId || '')}); await bridge.afterStop?.(String(threadId || '')); return result; }); // 主脑停下，它派出去的活一起停
  register(api, 'pinkie.engines.organize', async params => bridge.organize(params));
  register(api, 'pinkie.engines.diff', async ({threadId}) => bridge.diff({threadId: String(threadId || '')}));
  // 引擎的打开、安装、登录（3.7）。托管的要引擎服务在跑；终端那条只有用户点了（open: true）才开窗口。
  register(api, 'pinkie.engines.turnOn', async ({engine, on} = {}) => { await ensureRunning(); return {...status(), ...await bridge.turnOn({engine, on: on !== false})}; });
  register(api, 'pinkie.engines.install', async ({engine, open} = {}) => {
    if (engineInfo(driverOf(engine))?.managed?.install) await ensureRunning();
    return bridge.install({engine, open: open === true});
  });
  register(api, 'pinkie.engines.signin', async ({engine, open, methodId} = {}) => {
    // 加出来的账号要读它自己的登录文件夹，也得引擎服务在跑。
    if ((engineInfo(driverOf(engine))?.managed?.signin || engine !== driverOf(engine)) && open === true) await ensureRunning();
    return bridge.signin({engine, open: open === true, methodId});
  });
  register(api, 'pinkie.engines.setup', async ({engine, action, code} = {}) => {
    if (!engineInfo(driverOf(engine))) throw new Error('不认识这个引擎');
    return action ? bridge.signinStep({engine, action, code}) : bridge.setupState({engine});
  });
  // 多账号（3.7）：add {driver, name} / rename {engine, name} / remove {engine}。
  register(api, 'pinkie.engines.account', async ({action, driver, engine, name} = {}) => {
    await ensureRunning();
    if (action === 'add') return {...status(), ...await bridge.addAccount({driver, name})};
    if (action === 'rename') return {...status(), ...await bridge.renameAccount({engine, name})};
    if (action === 'remove') return {...status(), ...await bridge.removeAccount({engine})};
    throw new Error('不认识的账号动作');
  });
  return bridge;
}
