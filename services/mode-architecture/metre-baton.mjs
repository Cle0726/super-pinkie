// Metre「Baton（派发）」不再只是提示里的一行字（11-17，用户：「这两个设定如同虚设，Metre 根本不执行」）。
// 实测：选着 Baton，Metre 一轮里自己写了 5 个文件、改了 6 处、发了 6 次画图，一个子会话都没开。
// 现在的规则：Baton 下一轮里亲手「动手」的工具调用（写文件、改代码、画图……）到了上限，而这一轮还没派出去过，
// 再动手就被拦下，并告诉它怎么派。派发失败过（模式没装、名额满了等）就不再拦，它可以自己做完。
// 读、搜、跑命令验证、看页面这些「验收」动作不算动手，任何时候都不拦。Virtuoso 不经过这里（派发工具本来就摘掉了）。

export const BATON_HANDS_ON = Object.freeze(new Set([
  'write', 'file_write', 'edit', 'code_edit', 'apply_patch', 'image_generate', 'canvas', 'computer', 'computer_flow',
]));
// 「几步就能做完的小事自己做」（主 MD 第四节）：这么多次以内不拦。
export const BATON_FREE_STEPS = 4;
export const BATON_BLOCK = `【Baton · 派发】这一轮是派发：动手的活你已经亲手做了 ${BATON_FREE_STEPS} 步，后面的不要再自己做。`
  + '先用 pinkie_models 选一个比你轻的模型，把剩下要动手的部分写成简报（目标、文件路径、做到什么样算完、怎么验证），'
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
  before(key, toolName) {
    if (String(toolName || '') === 'browser' && this.metreFamily(key)) return {block: true, blockReason: METRE_BROWSER_BLOCK};
    if (!this.isMetre(key) || this.solo(key) || !BATON_HANDS_ON.has(String(toolName || ''))) return undefined;
    const state = this.state(key);
    if (state.dispatched || state.dispatchFailed) return undefined;
    if (state.handsOn >= BATON_FREE_STEPS) {
      state.blocked += 1;
      return {block: true, blockReason: BATON_BLOCK};
    }
    state.handsOn += 1;
    return undefined;
  }
  // outcome: 'started'（真开出了子会话）、'failed'（报错）、其他（只提了张卡片）不改状态。
  after(key, toolName, outcome) {
    if (!this.isMetre(key) || String(toolName || '') !== 'pinkie_session_start') return;
    const state = this.state(key);
    if (outcome === 'failed') state.dispatchFailed = true;
    else if (outcome === 'started') state.dispatched = true;
  }
}

const toolNameOf = event => event?.toolName || event?.name || '';
const keyOf = (event, ctx) => String(ctx?.sessionKey || event?.sessionKey || '');
export function dispatchOutcome(event) {
  if (event?.error) return 'failed';
  const result = event?.result;
  if (!result || typeof result !== 'object') return '';
  if (result.isError === true || result.ok === false) return 'failed';
  let details = result.details;
  if (!details) {
    const text = Array.isArray(result.content) ? result.content.map(part => part?.text || '').join('') : '';
    try { details = JSON.parse(text); } catch { details = null; }
  }
  if (details?.ok === false || details?.error) return 'failed';
  return typeof details?.key === 'string' && details.key.includes(':pinkie-child:') ? 'started' : '';
}

// 宿主会把插件按运行时各注册一次：钩子挂在每一个 api 上，计数用同一个 baton（传进来的）。
export function registerMetreBaton(api, {isMetre, solo, metreFamily, baton = new MetreBaton({isMetre, solo, metreFamily})}) {
  baton.apis ??= new WeakSet();
  if (api && typeof api === 'object') { if (baton.apis.has(api)) return baton; baton.apis.add(api); }
  const guard = (fn) => (event, ctx) => { try { return fn(event, ctx); } catch { return undefined; } };
  api.on?.('before_agent_run', guard((event, ctx) => { baton.begin(keyOf(event, ctx)); }));
  api.on?.('before_tool_call', guard((event, ctx) => baton.before(keyOf(event, ctx), toolNameOf(event))), {priority: -10870});
  api.on?.('after_tool_call', guard((event, ctx) => { baton.after(keyOf(event, ctx), toolNameOf(event), dispatchOutcome(event)); }));
  return baton;
}
