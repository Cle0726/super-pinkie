// What the 2026.7 modules expected from the old skin, rebuilt on the plugin host API:
//  - window.__laolaoSidebar.gwRequest(method, params, timeoutMs)  → host.request
//  - window 'pinkie:gateway-event' {detail: {event, payload}}      ← host.onEvent relay
//  - laolao:sessions-changed when the session list changes
//
// ── 生命周期 ────────────────────────────────────────────────────────────────
// classic legacy 脚本是 document 常驻，但插件 UI activation 会退役。退役后 host 的
// getter / 方法会**同步 throw** `This plugin UI activation has ended. Use the current
// activation.`。所有 legacy 模块只通过这一层桥访问 host：
//   - 读 selectedKey 走缓存，永不触碰可能已退役的 host；
//   - 离线 RPC 立刻明确失败（发送前）；已发出的请求断线后标为"未确认"，不谎称没发生；
//   - 重连 rebind 到新 host，旧 disposer 晚到不会摘掉新桥；
//   - 退役/换代时完整回收订阅、observer 与 **pending 定时器**。
//
// ── 为什么状态挂在 window 上 ─────────────────────────────────────────────────
// 构建产物是 ESM，热更新/版本切换后同一份代码可能以**两个 module 实例**同时存在。
// 如果状态放在模块级 `const bridge`，两个实例各持一份，旧 classic 捕获的 gwRequest
// 永远指向旧 host —— 这正是"rebind 测不出热更新"的原因。所以状态、facade、订阅所有权
// 统一放在 document 上的单例 slot，重复导入共享同一份。

const SLOT = '__cleBridgeSlot_v1';
const OFFLINE_MESSAGE = '与 Li An 的连接已断开，操作未执行。等重新连上再试。';
const UNCONFIRMED_MESSAGE = '连接在请求发出后断开，这次操作的结果未确认。重连后请先确认再重试。';

const RELAYED = ['agent', 'chat', 'session.message', 'session.tool', 'sessions.changed', 'plugin.pinkie.lsp.message', 'plugin.pinkie.ext.progress', 'plugin.pinkie.ai.scan'];

// ── 单例槽 ───────────────────────────────────────────────────────────────────
// 只用 document 上这一个对象承载可变状态；模块本身不持有任何 host 引用。
function slot() {
  const doc = globalThis.document;
  let s = doc[SLOT];
  if (!s) {
    s = {
      host: null,
      online: false,
      lastSessionKey: '',
      // 当前这一轮的回收句柄（订阅 / observer / pending 定时器）
      round: null,
      // 外部（classic 脚本）通过 facade 建立的订阅：{kind, name, fn}
      externals: new Set(),
      // pending 请求：{timer, resolve, reject, method, sent}
      pending: new Set(),
      // 每一代安装递增；外部订阅 wrapper 用它判断"我是否已被换掉"
      generation: 0,
      // 上一次通知出去的 mode。放在 slot 里而不是每次安装的局部，
      // 因为重装 activation 时若 mode 已经变了，document 常驻消费者
      // 也应得到一次正确通知，而不是等下一次无关 publish。
      lastMode: null,
    };
    Object.defineProperty(doc, SLOT, {value: s, configurable: true, enumerable: false, writable: false});
  }
  return s;
}

// 安全读 selectedKey：返回 {ok, key}。ok=false 表示 getter 同步抛了（host 已退役），
// 与"读到空字符串"（ok=true, key='') 严格区分 —— 空 key 要如实记成空，不能沿用旧值。
function readSelectedKey(host) {
  try {
    const key = host?.sessions?.selectedKey;
    return {ok: true, key: typeof key === 'string' ? key : ''};
  } catch {
    return {ok: false, key: ''};
  }
}

// ── pending 请求的回收 ───────────────────────────────────────────────────────
// 退役/换代时必须：取消定时器、结算调用方、忽略旧结果、绝不重发。
// 已经发出去的请求不能声称"未执行"，只能诚实标为"未确认"。
function abortPending(state, reason) {
  for (const entry of [...state.pending]) {
    if (entry.timer !== null) { clearTimeout(entry.timer); entry.timer = null; }
    state.pending.delete(entry);
    if (entry.settled) continue;
    entry.settled = true;
    if (entry.sent) entry.reject(new Error(UNCONFIRMED_MESSAGE));
    else entry.reject(new Error(reason));
  }
}

function detachRound(state) {
  const current = state.round;
  state.round = null;
  if (current) {
    try { current.dispose(); } catch {}
  }
}

// gwRequest：同步 throw / 异步 reject / 超时 / 断线四条路径都要 clearTimeout。
export function gwRequest(method, params, timeoutMs = 15000) {
  const state = slot();
  if (!state.online || !state.host) {
    return Promise.reject(new Error(OFFLINE_MESSAGE));
  }
  const host = state.host;
  return new Promise((resolve, reject) => {
    const entry = {timer: null, settled: false, sent: false, method, reject: null};
    entry.reject = reject;
    const finish = (fn, value) => {
      if (entry.settled) return;
      entry.settled = true;
      if (entry.timer !== null) { clearTimeout(entry.timer); entry.timer = null; }
      state.pending.delete(entry);
      fn(value);
    };
    state.pending.add(entry);
    try {
      entry.timer = setTimeout(() => finish(reject, new Error('gateway timeout')), timeoutMs);
      // 标记为"已发出"，此后若断线只能报未确认，不能说没执行。
      entry.sent = true;
      const result = host.request(method, params || {});
      Promise.resolve(result).then(
        (v) => finish(resolve, v),
        (e) => finish(reject, e),
      );
    } catch (error) {
      // 同步 throw：这条其实没送出去，按"未执行"处理，但保留真实原因。
      entry.sent = false;
      finish(reject, error);
    }
  });
}

// 给 legacy 脚本一个"退役也安全"的 host facade。
//
// 只暴露 legacy 真正用到的 API（sessions.selectedKey / open / create, request,
// subscribe, onEvent）。不发明空的 UI 实现：classic 不需要的接口就不提供，
// 免得"返回 noop 假装成功"。
export function makeHostFacade() {
  const state = slot();
  const requireOnline = () => {
    if (!state.online || !state.host) throw new Error(OFFLINE_MESSAGE);
    return state.host;
  };
  // 把同步 throw 封成 rejected Promise，绝不把异常漏到调用方同步栈上。
  const asPromise = (fn) => {
    try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); }
  };
  return {
    get sessions() {
      const h = state.host;
      return {
        // 唯一允许离线读的东西：最后已知的选中会话（只读归属）
        get selectedKey() { return state.lastSessionKey; },
        open: (args) => asPromise(() => requireOnline().sessions?.open?.(args)),
        create: (args) => asPromise(() => requireOnline().sessions?.create?.(args)),
      };
    },
    request: (method, params) => gwRequest(method, params),
    online: () => state.online,
    // 外部订阅由桥持有：退役时断开 host，重连后按新 host 重绑，unsubscribe 始终有效。
    subscribe: (fn) => addExternal('subscribe', null, fn),
    onEvent: (name, fn) => addExternal('onEvent', name, fn),
  };
}

// 外部订阅登记：返回的 unsubscribe 只影响自己，且重复调用安全。
function addExternal(kind, name, fn) {
  const state = slot();
  const record = {kind, name, fn, off: null, wrapper: null};
  state.externals.add(record);
  const bind = () => {
    const host = state.online ? state.host : null;
    if (!host) { record.off = null; return; }
    // 绑到 host 的必须是 wrapper，不能是原件：off 被调用之前，
    // 旧一代已经排队的回调仍可能被 host 触发，没有 guard 就会作用到新/离线界面。
    const generation = state.generation;
    const boundTo = host;
    const wrapper = (payload) => {
      if (!state.externals.has(record)) return; // 外部已 unsubscribe
      if (state.generation !== generation) return; // 已换代 / 已退役
      if (state.host !== boundTo || !state.online) return;
      try { fn(payload); } catch {}
    };
    record.wrapper = wrapper;
    try {
      record.off = kind === 'subscribe'
        ? host.subscribe?.(wrapper)
        : host.onEvent?.(name, wrapper);
    } catch {
      record.off = null; // host 已退役：先记下，重连时再绑
    }
  };
  bind();
  record.bind = bind;
  return () => {
    state.externals.delete(record);
    const off = record.off;
    record.off = null;
    if (off) { try { off(); } catch {} }
  };
}

// 彻底丢弃外部订阅登记：用于"这次安装没有活下来"的场景（已终止 signal）。
// 与 unbindExternals 的区别：后者只撤 host 上的句柄，登记要留着给重连重绑。
function clearExternals(state) {
  for (const record of state.externals) {
    const off = record.off;
    record.off = null;
    if (off) { try { off(); } catch {} }
  }
  state.externals.clear();
}

// 只解绑，不重绑：换代时先把旧 host 上的句柄全部撤掉。
function unbindExternals(state) {
  for (const record of state.externals) {
    const off = record.off;
    record.off = null;
    if (off) { try { off(); } catch {} }
  }
}

function rebindExternals(state) {
  for (const record of state.externals) {
    const off = record.off;
    record.off = null;
    if (off) { try { off(); } catch {} }
    if (record.bind) record.bind();
  }
}

// 主动标记离线：保留最后只读 key；已发出的请求标未确认；回收 pending 与订阅。
export function goOffline() {
  const state = slot();
  state.generation++;
  state.online = false;
  state.host = null;
  abortPending(state, OFFLINE_MESSAGE);
  // 显式下线没有"稍后重连同一代"，登记一并丢弃。
  clearExternals(state);
  detachRound(state);
}

// 把所有对外句柄挂好。句柄本身不持有 host，只读单例槽，所以可以随时重挂。
function publishHandles() {
  const state = slot();
  const sidebar = window.__laolaoSidebar || {};
  // 读 key 走缓存，不碰 host：退役后不会抛，调用方不需要 try/catch。
  sidebar.currentSessionKey = () => state.lastSessionKey;
  sidebar.gwRequest = gwRequest;
  sidebar.isOnline = () => state.online;
  window.__laolaoSidebar = sidebar;
  // 不再把 raw host 挂到 __cleGateway 上：那是安全桥边界之外的东西。
  window.__cleGateway = {request: gwRequest, isOnline: () => state.online};
  window.__cleBridge = {
    gwRequest,
    rebind: (nextHost, nextSignal) => installOn(nextHost, nextSignal),
    goOffline,
    isOnline: () => state.online,
    currentSessionKey: () => state.lastSessionKey,
    hostFacade: makeHostFacade,
  };
}

function installOn(host, signal) {
  const state = slot();

  // 已经 aborted 的 signal：零资源装上，直接离线。不能装完 observe/subscribe 再等一个
  // 永远不会再触发的 abort 事件。
  if (signal && signal.aborted) {
    // 已终止的 signal 意味着"这次安装立刻就是死的"。
    // 它可能是 reinstall 时的替换失败：旧 host 上还有 pending 请求与外部订阅，
    // 必须一并回收，否则 timer 挂着、调用方永不 settle、外部订阅还活在新界面上。
    state.generation++;
    state.host = null;
    state.online = false;
    abortPending(state, UNCONFIRMED_MESSAGE);
    detachRound(state);
    // 这一代没装上：外部订阅彻底丢弃（不是留着等重连，因为重连是另一次安装）。
    clearExternals(state);
    // 零资源，但句柄仍要可用：调用方需要能查在线状态、拿到明确的离线错误。
    publishHandles();
    return installOn;
  }

  // 上一轮整体收掉（含 pending 定时器与旧 host 上的外部订阅）。
  // generation++ 让所有旧 wrapper 立即失效，即使它们的 off 还没被 host 执行。
  state.generation++;
  abortPending(state, UNCONFIRMED_MESSAGE);
  detachRound(state);
  unbindExternals(state);

  const previousKey = state.lastSessionKey;
  const hadBaseline = state.lastMode !== null;
  const probe = readSelectedKey(host);
  // probe.ok=false 说明这个 host 的 getter 已经同步抛了 —— 它已退役。
  // 不能因为"拿到了一个对象"就当连上了，否则界面显示已连接、用户点下去才失败。
  const alive = probe.ok;
  if (alive) state.lastSessionKey = probe.key; // 空 key 也如实记为空
  state.host = alive ? host : null;
  state.online = alive;

  // 离线期间 mode 可能变过：document 常驻消费者不该等到下一次无关 publish 才知道。
  // 首次安装（lastMode 还是 null）只建立基线，不补发——启动不该凭空造一次通知。
  const currentMode = document.documentElement.dataset.cleRoom;
  const needsModeCatchUp = alive && state.lastMode !== null && state.lastMode !== currentMode;
  const needsKeyCatchUp = alive && hadBaseline && previousKey !== state.lastSessionKey;

  publishHandles();

  // 重连后把外部订阅重绑到新 host（classic 只在 boot 订阅一次，不会自己重绑）。
  rebindExternals(state);

  const stillMine = () => state.round === round;

  // 精确变化判定：同 key 同 mode 的重复 publish 必须零通知、零重新 fetch。
  // 顺序很关键：先把这一轮的 mode/key **快照提交**，再按变化各通知一次。
  // 反过来（先 dispatch 再更新缓存）会让 modechange 的监听者在回调里通过 facade
  // 读到上一轮的旧 key —— 这正是审查指出的竞态。
  const syncSelection = () => {
    if (!stillMine() || !state.online) return;
    const mode = document.documentElement.dataset.cleRoom;
    const read = readSelectedKey(state.host);

    // 先提交快照。lastMode === null 表示还没有基线：只记录，不算变化。
    const hasBaseline = state.lastMode !== null;
    const modeChanged = hasBaseline && state.lastMode !== mode;
    if (!hasBaseline || modeChanged) state.lastMode = mode;
    const keyChanged = read.ok && read.key !== state.lastSessionKey;
    if (read.ok) state.lastSessionKey = read.key;

    // 再通知（每个变化只发一次）
    if (modeChanged) {
      window.dispatchEvent(new CustomEvent('laolao:modechange', {detail: {mode}}));
    }
    if (keyChanged) {
      window.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
      // 记忆编辑器属于打开它的那个 scope：scope 变了就关掉。
      window.__clekkMemoryUI?.close();
    }
  };

  const offSelection = safeCall(() => host.subscribe?.(syncSelection));
  const modeObserver = new MutationObserver(syncSelection);

  modeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});

  const offs = RELAYED.map((name) => safeCall(() => host.onEvent(name, (payload) => {
    if (!stillMine()) return; // 旧 activation 的事件不得再往新界面里灌
    window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: name, payload}}));
    if (name === 'sessions.changed') syncSelection();
  }))).filter(Boolean);

  const round = {
    dispose() {
      for (const off of offs) safeCall(() => off?.());
      safeCall(() => offSelection?.());
      try { modeObserver.disconnect(); } catch {}
    },
  };
  state.round = round;

  const onOuterAbort = () => {
    if (state.round !== round) return; // 已被新桥取代，旧 activation 结束不得影响新桥
    state.generation++;
    state.online = false;
    state.host = null;
    state.round = null;
    abortPending(state, UNCONFIRMED_MESSAGE);
    // 只解绑、保留登记：classic 只在 boot 订阅一次，重连时必须能按新 host 重绑。
    // 旧 wrapper 不会因此复活 —— 它的 guard 比对 generation 与 host，flush 后即失效。
    unbindExternals(state);
    round.dispose();
  };
  if (signal) signal.addEventListener('abort', onOuterAbort, {once: true});
  // Publish catch-up only after this round owns all of its callbacks. A new
  // session in the same room also changes memory scope, even without modechange.
  if (alive && state.lastMode === null) state.lastMode = currentMode;
  if (needsModeCatchUp) {
    state.lastMode = currentMode;
    window.dispatchEvent(new CustomEvent('laolao:modechange', {detail: {mode: currentMode}}));
  }
  if (needsKeyCatchUp) {
    window.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
    window.__clekkMemoryUI?.close();
  }
  return installOn;
}

function safeCall(fn) {
  try { return fn(); } catch { return null; }
}

export function installLegacyShim(host, signal) {
  installOn(host, signal);
  return {
    gwRequest,
    rebind: (nextHost, nextSignal) => installOn(nextHost, nextSignal),
    goOffline,
    isOnline: () => slot().online,
    currentSessionKey: () => slot().lastSessionKey,
    hostFacade: makeHostFacade,
  };
}

export {OFFLINE_MESSAGE, UNCONFIRMED_MESSAGE};
