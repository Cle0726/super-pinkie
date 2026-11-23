// Metre「Baton（派发）」不再只是提示里的一行字（11-17，用户：「这两个设定如同虚设，Metre 根本不执行」）。
// 实测：选着 Baton，Metre 一轮里自己写了 5 个文件、改了 6 处、发了 6 次画图，一个子会话都没开。
// 现在的规则：Baton 下一轮里亲手「动手」的工具调用（写文件、改代码、画图……）到了上限，而这一轮还没派出去过，
// 再动手就被拦下，并告诉它怎么派。派发失败过（模式没装、名额满了等）就不再拦，它可以自己做完。
// 读、搜和单条验证命令不算动手。Virtuoso 仍在执行时拒绝其他派发入口。

export const BATON_HANDS_ON = Object.freeze(new Set([
  'write', 'file_write', 'edit', 'code_edit', 'apply_patch', 'image_generate', 'imagegen', 'canvas', 'computer', 'computer_flow',
]));
// 「几步就能做完的小事自己做」（主 MD 第四节）：这么多次以内不拦。
export const BATON_FREE_STEPS = 4;
const BATON_INTEGRATION_STEPS = 2;
const SOLO_BLOCK = '【Virtuoso · 独做】本轮由 Metre 自己完成，不能派发、另开会话执行或给子会话加活。';
const VISIBLE_DISPATCH_BLOCK = '【Baton · 派发】请用 pinkie_session_start 派活，子会话才会出现在用户的侧栏。';
const DELEGATION_TOOLS = new Set(['sessions_spawn', 'sessions_send', 'pinkie_session_start', 'pinkie_engine_task', 'pinkie_mode_ask', 'pinkie_session_message']);
// 真的派出去了（开起了子会话）就多给几步收尾；pinkie_engine_task 是派给外部引擎（engines-task.mjs）。
const DISPATCH_TOOLS = new Set(['pinkie_session_start', 'pinkie_engine_task']);
const SHELL_TOOLS = new Set(['exec', 'bash', 'shell', 'terminal', 'run_command']);
const READ_ONLY_CHECK = /^(?:(?:pwd|ls|rg|grep|cat|head|tail|wc|stat|Get-Location|Get-Item|Get-ChildItem|Get-Content|Get-FileHash|Select-String|Test-Path)(?: |$)|git (?:status|diff|log|show|rev-parse)(?: |$)|node --(?:test|check)(?: |$)|(?:pnpm|npm|yarn) (?:test|lint)(?: |$)|(?:python3?|py) -m (?:unittest|pytest)(?: |$)|pytest(?: |$))/iu;
const SHELL_OPERATORS = /[;&|<>$\x60\r\n]/u;
function handsOn(name, params) {
  if (BATON_HANDS_ON.has(name)) return true;
  if (name === 'app_browser') return /^(?:evaluate|type|fill|click|press|drag|upload|submit|act)$/i.test(String(params.action || ''));
  if (name === 'run_tests' && !params.command) return SHELL_OPERATORS.test(String(params.filter || ''));
  if (!SHELL_TOOLS.has(name) && name !== 'run_tests') return false;
  const command = String(params.command || '').trim();
  // Unknown shell commands count toward the budget. A known check with a
  // pipeline, substitution or redirect is no longer a single verification.
  return Boolean(params.background || !READ_ONLY_CHECK.test(command) || /(?:^|\s)--output(?:[=\s]|$)/u.test(command) || SHELL_OPERATORS.test(command));
}
export const BATON_BLOCK = `【Baton · 派发】这一轮是派发：动手的活你已经亲手做了 ${BATON_FREE_STEPS} 步，请把剩余的独立工作派出去。`
  + '用 pinkie_models 选一个比你轻的模型，把剩下要动手的部分写成简报（目标、文件路径、做到什么样算完、怎么验证），'
  + '用 pinkie_session_start（initiation: in_scope，写 mode 和 model）派出去；你继续读、判断、验收、汇报。'
  + '派发失败了（模式没装、名额满等）才自己接着做。用户想让你亲手做，会把输入框下面切到 Virtuoso。';

// 11-17 用户：「不要让它用我的浏览器，她自己不是有悬浮浏览器吗」。browser 工具会在桌面上另开一个 Chrome 窗口；
// Metre 和它派出去的子会话一律用 App 里的悬浮浏览器 app_browser（确认框现在也能答了）。
export const METRE_BROWSER_BLOCK = '【浏览器】Metre 和它的子会话不用 browser（它会在用户桌面上另开一个 Chrome 窗口）。'
  + '改用 app_browser：App 里的悬浮浏览器，用户看得见；open 打开网址、snapshot/read 看页面、click/type/fill 操作，'
  + '页面弹出的确认框会自动按 dialog 参数答（默认确定）。本地项目预览用 app_browser 的 serve。操控别的桌面应用用 computer。';

export class MetreBaton {
  constructor({isMetre, solo, metreFamily = isMetre}) {
    this.isMetre = isMetre;
    this.solo = solo;
    this.metreFamily = metreFamily;
    this.runs = new Map();
  }
  state(key) {
    let state = this.runs.get(key);
    if (!state) { state = {handsOn: 0, dispatched: false, dispatchFailed: false, blocked: 0}; this.runs.set(key, state); }
    return state;
  }
  begin(key) {
    if (!this.isMetre(key)) return;
    this.runs.delete(key);
    if (this.runs.size > 500) this.runs.delete(this.runs.keys().next().value);
  }
  before(key, toolName, params = {}) {
    const name = String(toolName || '').toLowerCase();
    if (name === 'browser' && this.metreFamily(key)) return {block: true, blockReason: METRE_BROWSER_BLOCK};
    if (!this.isMetre(key)) return undefined;
    const solo = this.solo(key);
    if (solo && (DELEGATION_TOOLS.has(name)
        || name === 'subagents' && String(params.action) === 'steer'
        || name === 'pinkie_sessions' && params.action === 'create' && String(params.message || '').trim())) {
      return {block: true, blockReason: SOLO_BLOCK};
    }
    if (name === 'sessions_spawn' || name === 'sessions_send') return {block: true, blockReason: VISIBLE_DISPATCH_BLOCK};
    if (solo || !handsOn(name, params)) return undefined;
    const state = this.state(key);
    if (state.dispatchFailed) return undefined;
    if (state.handsOn >= BATON_FREE_STEPS + (state.dispatched ? BATON_INTEGRATION_STEPS : 0)) {
      state.blocked += 1;
      return {block: true, blockReason: BATON_BLOCK};
    }
    state.handsOn += 1;
    return undefined;
  }
  // Only a real dispatch grants integration steps; only unavailability permits fallback.
  after(key, toolName, outcome) {
    if (!this.isMetre(key) || !DISPATCH_TOOLS.has(String(toolName || ''))) return;
    const state = this.state(key);
    if (outcome === 'unavailable') state.dispatchFailed = true;
    else if (outcome === 'started') state.dispatched = true;
  }
}

const toolNameOf = event => event?.toolName || event?.name || '';
const keyOf = (event, ctx) => String(ctx?.sessionKey || event?.sessionKey || '');
export function dispatchOutcome(event) {
  const result = event?.result;
  const text = Array.isArray(result?.content) ? result.content.map(part => part?.text || '').join('') : '';
  let details = result?.details;
  if (!details) { try { details = JSON.parse(text); } catch {} }
  if (event?.error || result?.isError === true || result?.ok === false || details?.ok === false || details?.error) {
    const reason = [event.error, result?.error, details?.error, text].filter(Boolean).join(' ');
    return /(?:^|\s)(?:名额满了|这个父会话已有 [0-9]+ 个子会话在跑|这台电脑上还没有|模型「.+」开不起来|会话消息未送达|用户还没打开外部引擎|.{1,40}现在用不了|没交出去)/u.test(reason)
      ? 'unavailable' : 'failed';
  }
  return typeof details?.key === 'string' && details.key.includes(':pinkie-child:') ? 'started' : '';
}

// 宿主会把插件按运行时各注册一次：钩子挂在每一个 api 上，计数用同一个 baton（传进来的）。
export function registerMetreBaton(api, {isMetre, solo, metreFamily, baton = new MetreBaton({isMetre, solo, metreFamily})}) {
  baton.apis ??= new WeakSet();
  if (api && typeof api === 'object') { if (baton.apis.has(api)) return baton; baton.apis.add(api); }
  const guard = (fn) => (event, ctx) => { try { return fn(event, ctx); } catch { return undefined; } };
  api.on?.('before_agent_run', guard((event, ctx) => { baton.begin(keyOf(event, ctx)); }));
  api.on?.('before_tool_call', guard((event, ctx) => baton.before(keyOf(event, ctx), toolNameOf(event), event?.params || {})), {priority: -10870});
  api.on?.('after_tool_call', guard((event, ctx) => { baton.after(keyOf(event, ctx), toolNameOf(event), dispatchOutcome(event)); }));
  return baton;
}
