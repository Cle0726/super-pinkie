// What the 2026.7 modules expected from the old skin, rebuilt on the plugin host API:
//  - window.__laolaoSidebar.gwRequest(method, params, timeoutMs)  → host.request
//  - window 'pinkie:gateway-event' {detail: {event, payload}}      ← host.onEvent relay
//  - laolao:sessions-changed when the session list changes
//
// ── 生命周期（这是本文件的重点）──────────────────────────────────────────────
// classic legacy 脚本是 document 常驻，但插件 UI activation 会退役。退役后 host 的
// getter / 方法会**同步 throw** `This plugin UI activation has ended. Use the current
// activation.`。旧实现把 host 闭包在 currentSessionKey 和 gwRequest 里，于是断线期间
// 那几个常驻模块不断出 uncaught；gwRequest 的 setTimeout 还会因为同步 throw 漏掉。
//
// 现在所有 legacy 模块只通过这一层桥访问 host：
//   - 读 selectedKey 走"最后已知值"，永不触碰可能已退役的 host；
//   - 离线时的 RPC 立刻以明确的离线错误失败（不假成功、不排队、不重放）；
//   - 重连时 rebind 到新 host，旧 disposer 晚到不会把新桥摘掉；
//   - 每次 rebind/abort 都完整回收上一轮的订阅与定时器。

const OFFLINE_MESSAGE = '与 Li An 的连接已断开，操作未执行。等重新连上再试。';

const RELAYED = ['agent', 'chat', 'session.message', 'session.tool', 'sessions.changed', 'plugin.pinkie.lsp.message', 'plugin.pinkie.ext.progress', 'plugin.pinkie.ai.scan'];

// 单个桥实例：持有"当前 host + 是否在线"这两个可变状态。
// 之所以做成对象而不是闭包变量，是为了让 rebind 能整体换掉状态而不改动任何外部引用。
const bridge = {
  host: null,
  online: false,
  lastSessionKey: '',
  round: null,      // 当前这一轮 activation 的身份（用来识别"旧 disposer 晚到"）
};

// 安全读 selectedKey：只在 online 时访问 host，且任何同步 throw 都降级为"沿用最后已知值"。
// 这里用 try 是因为 getter 的 throw 是外部契约，没别的办法探测；
// 但它是**唯一**的降级点，调用方不需要各自 try/catch。
function readSelectedKey(host) {
  try {
    const key = host?.sessions?.selectedKey;
    return typeof key === 'string' ? key : '';
  } catch {
    return null; // null 表示"这次读不到"，区别于"读到空字符串"
  }
}

function detachCurrent() {
  const current = bridge.round;
  bridge.round = null;
  if (current) {
    try { current.dispose(); } catch {}
  }
}

// 给 legacy 脚本一个"退役也安全"的 host facade。
//
// 为什么需要它：classic 脚本里直接写 window.CLE?.host?.sessions?.selectedKey 的地方有好几处，
// 都在 document 常驻，退役后 getter 会同步 throw。逐个改调用点等于在十几处堆 try/catch，
// 而且以后新加的脚本还会再犯。把 CLE.host 从 raw host 换成这层 facade 才是桥根因修复。
//
// facade 只做两件事：
//   1) 读 selectedKey 走缓存（不碰可能已退役的 host）；
//   2) 其余方法在离线时立刻返回明确的失败，在线时原样转发。
// 它不编造任何数据：读不到就是空/最后已知值，写操作就是明确失败。
export function makeHostFacade() {
  const offline = () => new Error(OFFLINE_MESSAGE);
  return {
    get sessions() {
      return {
        // 唯一允许离线读的东西：最后已知的选中会话（只读归属）
        get selectedKey() { return bridge.lastSessionKey; },
        open: (args) => {
          if (!bridge.online || !bridge.host) return Promise.reject(offline());
          return Promise.resolve(bridge.host.sessions?.open?.(args));
        },
        create: (args) => {
          if (!bridge.online || !bridge.host) return Promise.reject(offline());
          return Promise.resolve(bridge.host.sessions?.create?.(args));
        },
      };
    },
    request: (method, params) => gwRequest(method, params),
    subscribe: (fn) => {
      if (!bridge.online || !bridge.host) return () => {};
      try { return bridge.host.subscribe?.(fn); } catch { return () => {}; }
    },
    onEvent: (name, fn) => {
      if (!bridge.online || !bridge.host) return () => {};
      try { return bridge.host.onEvent?.(name, fn); } catch { return () => {}; }
    },
    get ui() {
      const ui = () => (bridge.online && bridge.host ? bridge.host.ui : null);
      return {
        registerReplacement: (...a) => {
          const u = ui();
          if (!u) return () => {};
          try { return u.registerReplacement?.(...a); } catch { return () => {}; }
        },
        selectReplacement: (...a) => {
          const u = ui();
          if (!u) return false;
          try { return u.selectReplacement?.(...a); } catch { return false; }
        },
      };
    },
    get online() { return bridge.online; },
  };
}

// gwRequest：同步 throw 与异步 reject 都要处理，且绝不遗留定时器。
export function gwRequest(method, params, timeoutMs = 15000) {
  if (!bridge.online || !bridge.host) {
    // 立即失败：不发、不排队、不重放。用真实 Error 并且给出离线原因（不是伪装 timeout）。
    return Promise.reject(new Error(OFFLINE_MESSAGE));
  }
  const host = bridge.host;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      fn(value);
    };
    try {
      timer = setTimeout(() => finish(reject, new Error('gateway timeout')), timeoutMs);
      // host.request 可能在调用点同步 throw（退役竞态）。必须同层捕获，
      // 否则这个 timer 会一直挂着，15s 后再 reject 一个已经没人管的 promise。
      const result = host.request(method, params || {});
      Promise.resolve(result).then(
        (v) => finish(resolve, v),
        (e) => finish(reject, e),
      );
    } catch (error) {
      // 同步 throw：清掉 timer 并把真实原因交回调用方。
      finish(reject, error);
    }
  });
}

// 主动标记离线：保留最后只读 key，之后的 RPC 一律明确失败。
export function goOffline() {
  const current = bridge.round;
  bridge.online = false;
  bridge.host = null;
  bridge.round = null;
  if (current) safeCall(() => current.dispose());
}

function installOn(host, signal) {
  // 先把上一轮的订阅/通知整体收掉，再装新的。旧轮次的 disposer 之后只会作用在自己身上。
  detachCurrent();
  const cached = readSelectedKey(host);
  // readSelectedKey 返回 null 表示"sessions 的 getter 同步抛了"，即这个 host 已经退役。
  // 不能因为拿到了一个对象就当它可用：否则界面会显示"已连接"，直到用户点下去才失败。
  const alive = cached !== null;
  if (typeof cached === 'string' && cached) bridge.lastSessionKey = cached;
  bridge.host = alive ? host : null;
  bridge.online = alive;

  const sidebar = window.__laolaoSidebar || {};
  // 读 key 走桥，不直接摸 host：退役后仍返回最后已知值，且不产生任何 host 访问。
  sidebar.currentSessionKey = () => bridge.lastSessionKey;
  sidebar.gwRequest = gwRequest;
  sidebar.isOnline = () => bridge.online;
  window.__laolaoSidebar = sidebar;
  window.__cleGateway = {request: gwRequest, host, isOnline: () => bridge.online};

  // 供 main.js 在重新 activate 时调用（主控只需一行接线）。
  // 注意：rebind 必须接收**新一轮 activation** 的 signal。
  // 如果这里复用旧 signal，旧 activation 的 abort 会把刚接上的新桥一起打掉
  // （实测现象：重连后一切看似正常，旧 disposer 一到就整体离线）。
  window.__cleBridge = {
    gwRequest,
    rebind: (nextHost, nextSignal) => installOn(nextHost, nextSignal),
    goOffline,
    isOnline: () => bridge.online,
    currentSessionKey: () => bridge.lastSessionKey,
  };

  const stillMine = () => bridge.round === round && bridge.host === host;

  const syncSelection = () => {
    if (!stillMine() || !bridge.online) return; // 已被新桥取代，立刻让位
    const key = readSelectedKey(host);
    if (typeof key === 'string') {
      bridge.lastSessionKey = key;
      if (key) window.dispatchEvent(new CustomEvent('pinkie:session-key', {detail: {sessionKey: key}}));
    }
    window.dispatchEvent(new CustomEvent('laolao:sessions-changed'));
  };

  const offSelection = safeCall(() => host.subscribe?.(syncSelection));
  const modeObserver = new MutationObserver(syncSelection);
  modeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});

  const offs = RELAYED.map((name) => safeCall(() => host.onEvent(name, (payload) => {
    if (!stillMine()) return; // 旧 activation 的事件不得再往新界面里灌
    window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: name, payload}}));
    if (name === 'sessions.changed') syncSelection();
  }))).filter(Boolean);

  // 这一轮自己的回收句柄。注意这里不做在线状态判断：dispose 只负责撤订阅。
  const round = {
    dispose() {
      for (const off of offs) safeCall(() => off?.());
      safeCall(() => offSelection?.());
      try { modeObserver.disconnect(); } catch {}
    },
  };
  bridge.round = round;

  // 外层 activation 结束：只有"这一轮仍是当前轮"时才把桥标记为离线。
  // 若期间已经 rebind 到新 host，旧 activation 的 abort 不得影响新桥。
  const onOuterAbort = () => {
    if (bridge.round !== round) return; // 已被新桥取代
    bridge.online = false;
    bridge.host = null;
    bridge.round = null;
    round.dispose();
  };
  if (signal) signal.addEventListener('abort', onOuterAbort, {once: true});
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
    isOnline: () => bridge.online,
    currentSessionKey: () => bridge.lastSessionKey,
    // 主控接线：window.CLE = Object.assign(window.CLE||{}, {host: bridge.hostFacade(), ...})
    hostFacade: makeHostFacade,
  };
}

export {OFFLINE_MESSAGE};
