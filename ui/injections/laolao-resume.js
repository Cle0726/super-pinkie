(() => {
  "use strict";
  // laolao-resume: WKWebView 后台挂起断线恢复
  //
  // 问题: App 切后台时 macOS 挂起 WKWebView 的 JS/网络, 网关 websocket
  // 悄悄断开 (code=1006)。"回复完成"等事件在断线窗口内丢失, 前端状态
  // 停在"生成中", 动画永远转。
  //
  // 方案: 监听前后台事件 + visibilitychange + pageshow + gateway 断线，
  // 回到前台时只重新拉取当前会话消息。绝不能通过点击原生停止按钮来
  // “复位”界面：工具把 App 切到后台时，模型通常仍在正常运行，合成点击
  // 会把健康请求真的变成 aborted。

  const $ = (sel) => document.querySelector(sel);
  const STOP_SELECTOR = '[aria-label*="停止"], [aria-label*="Stop"], [data-testid*="stop"], .chat-composer__stop, .chat-send-btn--stop';

  // 从原生 chat pane 优先拿当前会话 key。URL/侧边栏在 SPA 切换和网关
  // 重连期间可能暂时还是上一轮；pane.state 才是当前真正订阅的会话。
  const currentSessionKey = () => {
    const paneKey = document.querySelector("openclaw-chat-pane")?.state?.sessionKey;
    if (typeof paneKey === "string" && paneKey.trim()) return paneKey.trim();
    const routed = new URLSearchParams(window.location.search).get("session") || "";
    if (routed) return routed;
    const activeRow = document.querySelector(
      ".sidebar-recent-session--active[data-session-key]"
    );
    if (activeRow?.dataset.sessionKey) return activeRow.dataset.sessionKey;
    return (
      document.querySelector("openclaw-app-shell")?.context?.gateway?.snapshot
        ?.sessionKey || ""
    );
  };

  const gatewayStore = () => document.querySelector("openclaw-app-shell")?.context?.gateway;
  const gatewaySnapshot = () => gatewayStore()?.snapshot || null;
  const gatewayClient = () => gatewaySnapshot()?.client || gatewayStore()?.client || null;
  // The native shell is the authority for the connection badge. During a
  // gateway-client handoff its public `gatewayConnected` flag can already be
  // true while the injected context snapshot is one render behind. Treating
  // that short window as offline caused an eight-second reload loop: composer,
  // history and entrance layers repeatedly disappeared and re-mounted.
  const nativeGatewayConnected = () => {
    const shell = document.querySelector("openclaw-app-shell");
    return shell?.gatewayConnected === true || shell?.state?.gatewayConnected === true;
  };
  const gatewayConnected = () => Boolean(
    gatewayClient() && (gatewaySnapshot()?.connected === true || nativeGatewayConnected())
  );

  // The classic 7.1 client can enter a poisoned reconnect state after the
  // local gateway process is replaced: every automatic WebSocket attempt is
  // rejected with "first request must be connect", even though /readyz is
  // already healthy.  A fresh document creates a clean protocol client.  This
  // is a last-resort reload of the current /chat URL only, so it never replays
  // the native startup movie and never changes the selected session.
  const RECONNECT_RELOAD_AT = "laolao:gateway-reload-at";
  const RECONNECT_DRAFT = "laolao:gateway-reload-draft";
  // Native control-ui bundles keep their upstream hashed filename after our
  // compatibility patch. Older service workers used cache-first for that URL,
  // so a repaired renderer could remain invisible forever. Run one guarded
  // cache migration per UI revision. This removes only disposable control-ui
  // caches; transcripts, settings, prompts and media are not stored here.
  const UI_CACHE_REVISION = "history-render-14";
  const UI_CACHE_REFRESHED = `laolao:ui-cache-refreshed:${UI_CACHE_REVISION}`;
  const UI_CACHE_REFRESH_ATTEMPTED = `laolao:ui-cache-refresh-attempted:${UI_CACHE_REVISION}`;
  let gatewayOfflineSince = 0;
  let gatewayWasEverConnected = gatewayConnected();

  const composerTextarea = () => document.querySelector(
    ".agent-chat__composer-combobox textarea"
  );

  const preserveComposerDraft = () => {
    const textarea = composerTextarea();
    const draft = typeof textarea?.value === "string" ? textarea.value : "";
    if (!draft) return;
    try {
      window.sessionStorage.setItem(RECONNECT_DRAFT, JSON.stringify({
        sessionKey: currentSessionKey(), draft,
      }));
    } catch {}
  };

  const restoreComposerDraft = (attempt = 0) => {
    let saved;
    try { saved = JSON.parse(window.sessionStorage.getItem(RECONNECT_DRAFT) || "null"); } catch {}
    if (!saved?.draft || saved.sessionKey !== currentSessionKey()) return;
    const textarea = composerTextarea();
    if (!textarea && attempt < 24) {
      window.setTimeout(() => restoreComposerDraft(attempt + 1), 250);
      return;
    }
    if (!textarea) return;
    if (!textarea.value) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement?.prototype || {}, "value"
      )?.set;
      if (setter) setter.call(textarea, saved.draft);
      else textarea.value = saved.draft;
      textarea.dispatchEvent(new Event("input", {bubbles: true}));
    }
    try { window.sessionStorage.removeItem(RECONNECT_DRAFT); } catch {}
  };

  const refreshStaleControlUiCache = async () => {
    try {
      if (window.localStorage.getItem(UI_CACHE_REFRESHED) === "1") return false;
      // Guard before async work so a failed/partial reload cannot form a loop.
      if (window.sessionStorage.getItem(UI_CACHE_REFRESH_ATTEMPTED) === "1") return false;
      window.sessionStorage.setItem(UI_CACHE_REFRESH_ATTEMPTED, "1");

      const cacheStorage = window.caches;
      if (cacheStorage?.keys) {
        const keys = await cacheStorage.keys();
        await Promise.all(keys
          .filter((key) => String(key).startsWith("openclaw-control-"))
          .map((key) => cacheStorage.delete(key)));
      }
      const registration = await window.navigator?.serviceWorker?.getRegistration?.();
      await registration?.update?.();
      window.localStorage.setItem(UI_CACHE_REFRESHED, "1");
      preserveComposerDraft();
      window.location.reload();
      return true;
    } catch {
      return false;
    }
  };

  const reloadRecoveredGateway = () => {
    const now = Date.now();
    let previous = 0;
    try { previous = Number(window.sessionStorage.getItem(RECONNECT_RELOAD_AT)) || 0; } catch {}
    // One guarded reload per thirty seconds. Readiness is still probed every
    // 750ms, but a genuinely broken socket must never turn into a flashing
    // page/replayed entrance storm while the native watchdog repairs it.
    if (now - previous < 30_000) return false;
    preserveComposerDraft();
    try { window.sessionStorage.setItem(RECONNECT_RELOAD_AT, String(now)); } catch {}
    window.location.reload();
    return true;
  };

  const probeReadyForSocketRecovery = async () => {
    if (document.hidden || !location.pathname.startsWith("/chat")) return;
    // Native UI says online: do not second-guess it with a stale injected
    // snapshot and, critically, never reload a healthy visible chat.
    if (nativeGatewayConnected()) {
      gatewayWasEverConnected = true;
      gatewayOfflineSince = 0;
      return;
    }
    if (gatewayConnected()) {
      gatewayWasEverConnected = true;
      gatewayOfflineSince = 0;
      return;
    }
    if (!gatewayOfflineSince) gatewayOfflineSince = Date.now();
    // A previously connected page gets a short native reconnect window. On a
    // first load use a wider window so normal startup never reloads needlessly.
    const graceMs = gatewayWasEverConnected ? 6_000 : 12_000;
    if (Date.now() - gatewayOfflineSince < graceMs) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 700);
    try {
      const response = await fetch("/readyz", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const body = response.ok ? await response.json() : null;
      if (body?.ready === true && !gatewayConnected() && !nativeGatewayConnected()) {
        reloadRecoveredGateway();
      }
    } catch {} finally {
      window.clearTimeout(timer);
    }
  };

  const withTimeout = (promise, timeoutMs = 8000) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("gateway request timeout")), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => window.clearTimeout(timer));
  };

  const isHistoryRebuildingError = (error) => {
    const text = String(error?.message || error?.errorMessage || error || "");
    return /session history is rebuilding|transcript projection is rebuilding|projection is rebuilding|UNAVAILABLE/i.test(text);
  };

  // 7.1 原生聊天页只拉并缓存最近 100 条。这里使用网关已有的 offset
  // 分页逐页取回，直到 hasMore=false；记录再多也不会被前端的 100 条窗口
  // 静默截掉。每页 250 条能避开单次 JSON 字节预算，同时不会制造密集请求。
  const HISTORY_PAGE_SIZE = 250;
  const historyStatusBySession = new Map();

  const messageIdentity = (message) => {
    if (!message || typeof message !== "object") return "";
    const metadata = message.__openclaw;
    if (metadata && typeof metadata === "object") {
      if (typeof metadata.id === "string" && metadata.id) return `id:${metadata.id}`;
      if (Number.isSafeInteger(metadata.seq)) {
        return `seq:${metadata.seq}:${String(message.role || "").toLowerCase()}`;
      }
    }
    if (typeof message.messageId === "string" && message.messageId) {
      return `message:${message.messageId}`;
    }
    const timestamp = message.timestamp ?? message.ts ?? "";
    try {
      return `fallback:${String(message.role || "").toLowerCase()}:${timestamp}:${JSON.stringify(message.content ?? message.text ?? null)}`;
    } catch {
      return "";
    }
  };

  const uniqueMessages = (messages) => {
    const seen = new Set();
    const result = [];
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const identity = messageIdentity(message);
      if (identity && seen.has(identity)) continue;
      if (identity) seen.add(identity);
      result.push(message);
    }
    return result;
  };

  // 权威历史排在前面；只保留尚未落盘的本地 optimistic/stream 消息，避免
  // 刷新时把用户刚发出的文字或正在生成的尾段吃掉。
  const mergeCompleteHistory = (history, localMessages) => {
    const result = uniqueMessages(Array.isArray(history) ? history : []);
    const seen = new Set(result.map(messageIdentity).filter(Boolean));
    for (const message of Array.isArray(localMessages) ? localMessages : []) {
      const identity = messageIdentity(message);
      if (identity && seen.has(identity)) continue;
      if (identity) seen.add(identity);
      result.push(message);
    }
    return result;
  };

  const sameMessageSequence = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((message, index) => {
      const a = messageIdentity(message);
      const b = messageIdentity(right[index]);
      if (a || b) return a === b;
      try { return JSON.stringify(message) === JSON.stringify(right[index]); } catch { return message === right[index]; }
    });
  };

  const historyParams = (sessionKey, offset) => {
    const parsedAgent = String(sessionKey).match(/^agent:([^:]+):/);
    return {
      sessionKey,
      limit: HISTORY_PAGE_SIZE,
      offset,
      maxChars: 500000,
      ...(parsedAgent?.[1] ? {agentId: parsedAgent[1]} : {}),
    };
  };

  const fetchCompleteHistory = async (sessionKey, expectedClient) => {
    const client = expectedClient || gatewayClient();
    if (!client || !gatewayConnected() || !sessionKey) return null;
    let offset = 0;
    let sessionId = "";
    let totalMessages;
    const seenOffsets = new Set();
    const pages = [];

    for (;;) {
      // 会话切换或 websocket 换代后，旧请求的结果绝不能写进新聊天。
      if (gatewayClient() !== client || currentSessionKey() !== sessionKey) return null;
      if (seenOffsets.has(offset)) throw new Error("chat.history pagination stalled");
      seenOffsets.add(offset);
      const page = await withTimeout(
        client.request("chat.history", historyParams(sessionKey, offset)),
      20000
      );
      if (gatewayClient() !== client || currentSessionKey() !== sessionKey) return null;
      const pageSessionId = String(page?.sessionInfo?.sessionId || page?.sessionId || "");
      if (sessionId && pageSessionId && sessionId !== pageSessionId) {
        throw new Error("chat.history session changed during pagination");
      }
      if (pageSessionId) sessionId = pageSessionId;
      if (Number.isFinite(page?.totalMessages)) totalMessages = page.totalMessages;
      pages.unshift(Array.isArray(page?.messages) ? page.messages : []);
      if (page?.hasMore !== true) break;
      const nextOffset = Number(page?.nextOffset);
      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        throw new Error("chat.history pagination did not advance");
      }
      offset = nextOffset;
    }

    return {
      messages: uniqueMessages(pages.flat()),
      sessionId,
      totalMessages,
      pageCount: seenOffsets.size,
    };
  };

  // 正在生成中的判定: 发送按钮禁用 / 停止按钮可见 / 流式进行中
  const isBusy = () => {
    if (document.querySelector('[data-laolao-streaming="true"]')) return true;
    const stopBtn = document.querySelector(STOP_SELECTOR);
    if (stopBtn && stopBtn.offsetParent !== null) return true;
    const sendBtn = document.querySelector(
      '[aria-label*="发送"], [aria-label*="Send"], [data-testid*="send"]'
    );
    if (sendBtn && sendBtn.disabled) return true;
    return false;
  };

  // Keep a calm, user-facing recovery indicator visible for the whole retry
  // window.  Previously a failed upstream turn only cleared the spinner, so
  // the page looked idle even while the gateway watchdog was still retrying.
  // This is deliberately a data attribute/CSS ribbon: no fake chat message is
  // inserted and the internal watchdog control text never enters the transcript.
  let watchdogStatusTimer = null;
  const setWatchdogStatus = (state, message) => {
    if (!location.pathname.startsWith("/chat")) return;
    const root = document.documentElement;
    // Gateway stores can emit several identical snapshots while a socket is
    // reconnecting. Do not rewrite attributes or dispatch another event for
    // an unchanged status: each write can invalidate the chat pane's style
    // tree and was the source of the visible "chat box jumping" flicker.
    const sameRootStatus = root.getAttribute?.("data-laolao-watchdog-state") === state
      && root.getAttribute?.("data-laolao-watchdog-message") === message;
    const body = document.body;
    const sameBodyStatus = !body || (
      body.getAttribute?.("data-laolao-watchdog-state") === state
      && body.getAttribute?.("data-laolao-watchdog-message") === message
    );
    if (sameRootStatus && sameBodyStatus) return;
    root.setAttribute("data-laolao-watchdog-state", state);
    root.setAttribute("data-laolao-watchdog-message", message);
    if (body) {
      body.setAttribute("data-laolao-watchdog-state", state);
      body.setAttribute("data-laolao-watchdog-message", message);
    }
    window.dispatchEvent(new CustomEvent("pinkie:watchdog-status", {
      detail: {state, message},
    }));
    if (watchdogStatusTimer) window.clearTimeout(watchdogStatusTimer);
    if (state === "recovered") {
      watchdogStatusTimer = window.setTimeout(() => {
        root.removeAttribute("data-laolao-watchdog-state");
        root.removeAttribute("data-laolao-watchdog-message");
        document.body?.removeAttribute("data-laolao-watchdog-state");
        document.body?.removeAttribute("data-laolao-watchdog-message");
      }, 1800);
    }
  };

  const clearWatchdogStatus = () => {
    if (watchdogStatusTimer) window.clearTimeout(watchdogStatusTimer);
    watchdogStatusTimer = null;
    document.documentElement.removeAttribute("data-laolao-watchdog-state");
    document.documentElement.removeAttribute("data-laolao-watchdog-message");
    document.body?.removeAttribute("data-laolao-watchdog-state");
    document.body?.removeAttribute("data-laolao-watchdog-message");
  };

  // 只读刷新会话列表。正文恢复不能靠 sessions.list；正文必须走原生
  // chat pane 的 refreshCurrentChat（内部会调用 chat.history）。
  const refreshSession = async () => {
    const client = gatewayClient();
    if (!client || !gatewayConnected()) return;
    try {
      await withTimeout(client.request("sessions.list", {limit: 1000}), 5000);
    } catch {}
  };

  let recoveryInFlight = null;
  let recoveryTimer = null;
  let lastRecoveryAt = 0;
  let recoveryGeneration = 0;
  let historyRebuildRetryAttempt = 0;
  const RECOVERY_THROTTLE_MS = 1_200;

  const scheduleRecovery = (reason, delayMs = 300) => {
    if (recoveryTimer) return;
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = null;
      void recoverCurrentChat(reason, {force: true});
    }, Math.max(0, delayMs));
  };

  // 关键恢复路径：不要点击停止、不要伪造输入框、不要重载整个 App。
  // 原生 pane.state.refreshCurrentChat 会合并持久化历史与当前流式状态，
  // 并在内部调用 chat.history；这正好避开“结果已落盘但 DOM 没更新”的窗口。
  const recoverCurrentChat = async (reason = "unknown", options = {}) => {
    if (document.hidden || !location.pathname.startsWith("/chat")) return false;
    const sessionKey = currentSessionKey();
    const pane = document.querySelector("openclaw-chat-pane");
    const state = pane?.state;
    if (!sessionKey || !state || !gatewayConnected()) return false;
    const now = Date.now();
    if (recoveryInFlight) return recoveryInFlight;
    // `force` means the caller has higher priority than the normal interval;
    // it must not bypass the global throttle. A failure/reconnect can produce
    // multiple browser events in the same second, and running full
    // chat.history pagination for each one makes the composer flash.
    if (!options.manual && now - lastRecoveryAt < RECOVERY_THROTTLE_MS) return false;
    // Never replace a live stream with a freshly paginated snapshot. The
    // native pane will append the stream; the next idle tick/recovered event
    // performs the authoritative sync once the run has settled.
    if (isBusy() && !options.manual) return false;
    lastRecoveryAt = now;
    const generation = ++recoveryGeneration;
    recoveryInFlight = (async () => {
      try {
        const client = gatewayClient();
        if (typeof state.refreshCurrentChat === "function") {
          await withTimeout(state.refreshCurrentChat(), 20000);
        }
        if (generation !== recoveryGeneration) return false;
        const complete = await fetchCompleteHistory(sessionKey, client);
        if (!complete || generation !== recoveryGeneration
            || currentSessionKey() !== sessionKey || gatewayClient() !== client) return false;
        const localMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
        const mergedMessages = mergeCompleteHistory(complete.messages, localMessages);
        const messagesChanged = !sameMessageSequence(localMessages, mergedMessages);
        if (messagesChanged) state.chatMessages = mergedMessages;
        // 新版原生页认识此字段；旧版会忽略它。完整数据已经装入后明确标记
        // hasMore=false，避免另一个滚动分页器重复拉同一批记录。
        if ("chatHistoryPagination" in state) {
          state.chatHistoryPagination = {
            hasMore: false,
            ...(Number.isFinite(complete.totalMessages)
              ? {totalMessages: complete.totalMessages}
              : {}),
          };
        }
        historyStatusBySession.set(sessionKey, {
          loadedCount: mergedMessages.length,
          authorityCount: complete.messages.length,
          totalMessages: complete.totalMessages,
          pageCount: complete.pageCount,
          sessionId: complete.sessionId,
          syncedAt: Date.now(),
          complete: true,
        });
        historyRebuildRetryAttempt = 0;
        // Avoid a full Lit render when history is byte-for-byte unchanged;
        // this is common during reconnect polling and was another source of
        // the composer visibly jumping up and down.
        if (messagesChanged) state.requestUpdate?.();
        // 历史已经恢复后才滚到底部；用户正在查看旧消息时不抢滚动位置。
        if (!isBusy() && state.chatUserNearBottom !== false) {
          state.scrollToBottom?.({smooth: false});
        }
        window.dispatchEvent(new CustomEvent("pinkie:session-resynced", {
          detail: {sessionKey, reason},
        }));
        // Normal first-load/manual history sync is silent.  Only close the
        // ribbon when a real offline/retry state was previously announced.
        if (document.documentElement.getAttribute?.("data-laolao-watchdog-state")) {
          setWatchdogStatus("recovered", "连接已恢复，当前回复已同步");
        }
        return true;
      } catch (error) {
        // chat.history intentionally returns UNAVAILABLE while OpenClaw is
        // rebuilding its SQLite transcript projection. Do not swallow that
        // state: retry with bounded backoff so the just-sent user message and
        // the eventual assistant reply reappear without reloading the app.
        if (isHistoryRebuildingError(error)) {
          historyRebuildRetryAttempt = Math.min(historyRebuildRetryAttempt + 1, 12);
          const delay = Math.min(1_500,
            Math.ceil(200 * (1.5 ** Math.max(0, historyRebuildRetryAttempt - 1))));
          window.dispatchEvent(new CustomEvent("pinkie:session-history-rebuilding", {
            detail: {sessionKey, reason, retryInMs: delay, attempt: historyRebuildRetryAttempt},
          }));
          scheduleRecovery("history-rebuilding", delay);
        }
        return false;
      } finally {
        recoveryInFlight = null;
      }
    })();
    return recoveryInFlight;
  };

  window.__laolaoRecoverCurrentChat = recoverCurrentChat;
  window.__laolaoHistoryStatus = () => {
    const key = currentSessionKey();
    return key ? {...(historyStatusBySession.get(key) || {}), sessionKey: key} : null;
  };
  // 只暴露纯函数给离线回归测试，不包含 gateway/token 等运行数据。
  window.__laolaoHistoryTestHooks = {messageIdentity, uniqueMessages, mergeCompleteHistory};
  window.__laolaoGatewayTestHooks = {gatewayConnected, nativeGatewayConnected};

  // 档位控制器的续跑由本机网关发起，结束事件有时不经过当前 WKWebView
  // 的 websocket。直接触发原生聊天页自己的“刷新”动作，既不重载页面，
  // 也不会重播开屏或丢失输入框草稿。
  const refreshVisibleChat = async () => {
    await recoverCurrentChat("manual-refresh", {force: true, manual: true});
    if (!recoveryInFlight) await refreshSession();
  };
  window.__laolaoRefreshCurrentChat = refreshVisibleChat;

  // 回前台主流程
  const onForeground = () => {
    // 延迟策略: 当前 busy → 等重连窗口再刷新; 否则快速刷新。
    const delay = isBusy() ? 600 : 150;
    if (onForeground.timer) window.clearTimeout(onForeground.timer);
    // 给网关前端自己的重连逻辑一点时间。只读同步，不发送 chat.abort。
    onForeground.timer = window.setTimeout(async () => {
      onForeground.timer = null;
      await recoverCurrentChat("foreground", {force: true});
      if (!recoveryInFlight) await refreshSession();
    }, delay);
  };

  // 上游失败卡出现时只显示稳定的状态提示并排队恢复。失败续接完全交给
  // 网关看门狗，前端不清空正在进行中的流，也不模拟停止。
  const onRunFailure = () => {
    setWatchdogStatus("retrying", "上游波动，碧琪正在自动重试…");
    // A failed attempt is normally followed by a watchdog retry. Refreshing
    // the pane here briefly clears the live composer and causes a visible
    // jump, while the retry is still active. Arm one coalesced idle recovery;
    // the interval/recovered event will retry after the stream settles.
    scheduleRecovery("run-failed", 900);
  };
  window.addEventListener("pinkie:run-failed", onRunFailure);
  window.addEventListener("pinkie:run-recovered", () => {
    // This event is emitted only after the rendered transcript contains a
    // later real assistant terminal reply for every prior failure.
    clearWatchdogStatus();
    scheduleRecovery("run-recovered", 450);
  });
  // The native chat pane reports projection rebuilds as an RPC error. The
  // sidebar WebSocket shim forwards that signal here so recovery is armed even
  // when no gateway reconnect or foreground event occurred.
  window.addEventListener("pinkie:history-rebuilding", () => {
    if (!recoveryTimer && !recoveryInFlight) scheduleRecovery("history-rebuilding", 250);
  });
  window.addEventListener("pinkie:tier-complete", () => {
    scheduleRecovery("tier-complete", 450);
  });

  // 只有用户真实点击停止，才取消这一轮自动续接。
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(STOP_SELECTOR)) return;
    const sessionKey = currentSessionKey();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (sessionKey && typeof rpc === 'function') {
      void rpc('pinkie.watchdog.cancel', {sessionKey}, 5000).catch(()=>{});
    }
  }, true);

  // 不造一个假的输入框；只要聊天路由的真实 composer 意外掉线，就低频
  // 请求原生界面重新同步。这样发送、录音、附件和模型选择仍是原功能。
  let observedSessionKey = "";
  window.setTimeout(() => {
    restoreComposerDraft();
    observedSessionKey = currentSessionKey();
    scheduleRecovery("initial-history", 250);
    window.setInterval(() => {
      if (document.hidden || !location.pathname.startsWith("/chat")) return;
      const sessionKey = currentSessionKey();
      if (sessionKey && sessionKey !== observedSessionKey) {
        observedSessionKey = sessionKey;
        scheduleRecovery("session-changed", 350);
        return;
      }
      // 原生 100 条缓存有时会在切页/重连后覆盖完整数组。只在数量确实
      // 倒退时补回，正常流式追加不会触发额外请求。
      const state = document.querySelector("openclaw-chat-pane")?.state;
      const watchdogState = document.documentElement.getAttribute?.("data-laolao-watchdog-state");
      const waitingForGateway = watchdogState === "offline" || watchdogState === "retrying"
        || !gatewayConnected();
      const expected = historyStatusBySession.get(sessionKey)?.authorityCount;
      if (Number.isFinite(expected) && Array.isArray(state?.chatMessages)
          && state.chatMessages.length < expected && !isBusy() && !waitingForGateway) {
        scheduleRecovery("history-count-regressed", 250);
        return;
      }
      // 页面刚打开或网关刚恢复时，原生 pane 可能还没完成第一次历史同步。
      // 之前只有一次 initial-history 尝试，若那一刻 gateway 尚未 ready，
      // 后续就永远不会补齐。没有成功标记时持续低频重试；正在生成时让
      // 原生流式状态先跑完，避免把未落盘的尾段覆盖掉。
      if (sessionKey && !historyStatusBySession.has(sessionKey) && !isBusy() && !waitingForGateway) {
        scheduleRecovery("history-not-yet-synced", 300);
        return;
      }
      if (!document.querySelector(".agent-chat__composer-combobox textarea")) scheduleRecovery("composer-missing", 300);
    }, 1000);
  }, 400);

  // The new injection itself is network-first, so it can evict an older
  // cache-first native chat bundle and then reload into the repaired renderer.
  window.setTimeout(() => void refreshStaleControlUiCache(), 80);

  // Process recovery and WebSocket recovery are separate layers. Poll the
  // lightweight local ready endpoint frequently enough to catch a recovered
  // gateway whose old page client is still stuck in an invalid handshake.
  window.setInterval(() => void probeReadyForSocketRecovery(), 750);

  // 标记流式状态 (由其它注入或页面事件维护)
  document.addEventListener("laolao:streaming", (e) => {
    document.documentElement.setAttribute(
      "data-laolao-streaming",
      e.detail?.active ? "true" : "false"
    );
  });

  // 1) 原生壳层通知 (Launcher.swift 注入)
  window.addEventListener("pinkie:app-foreground", () => onForeground());
  window.addEventListener("pinkie:app-background", () => {});

  // 2) 页面可见性 (Safari/WKWebView 都支持)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onForeground();
  });

  // 3) 页面显示/恢复 (bfcache 或导航回退)
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) onForeground();
  });

  // 4) 监听原生 gateway store，而不是给 store 猜一个不存在的 onClose。
  // 控制台自身会重连；这里在 connected 由 false -> true 或 client 换代后
  // 重新拉当前 pane 的权威 history。
  const hookGatewayStore = () => {
    const gateway = gatewayStore();
    if (!gateway || gateway._laolaoRecoverySubscribed || typeof gateway.subscribe !== "function") return false;
    gateway._laolaoRecoverySubscribed = true;
    let wasConnected = Boolean(gateway.snapshot?.connected || nativeGatewayConnected());
    let previousClient = gateway.snapshot?.client || null;
    const unsubscribe = gateway.subscribe((snapshot) => {
      // Some 7.1 store notifications arrive before the callback argument has
      // the new client. Re-read the public snapshot and shell flag before
      // announcing an outage.
      const current = snapshot?.client || snapshot?.connected !== undefined
        ? snapshot
        : gateway.snapshot;
      const client = current?.client || gateway.snapshot?.client || gateway.client || null;
      const connected = Boolean(
        (current?.connected === true && client) || nativeGatewayConnected()
      );
      const clientChanged = Boolean(client && client !== previousClient);
      if (!connected) {
        if (!gatewayOfflineSince) gatewayOfflineSince = Date.now();
        wasConnected = false;
        previousClient = client;
        setWatchdogStatus("offline", "连接暂时中断，碧琪正在等待上游恢复…");
        return;
      }
      if (!wasConnected || clientChanged) {
        gatewayWasEverConnected = true;
        gatewayOfflineSince = 0;
        wasConnected = true;
        previousClient = client;
        window.dispatchEvent(new CustomEvent("pinkie:gateway-reconnected"));
        setWatchdogStatus("retrying", "连接已恢复，正在继续当前工作…");
        scheduleRecovery("gateway-reconnected", 250);
      }
    });
    gateway._laolaoRecoveryUnsubscribe = typeof unsubscribe === "function" ? unsubscribe : null;
    return true;
  };

  // 壳层/组件树就绪后再挂 gateway 钩子 (MutationObserver 等 shell 出现)
  // v3: 挂上后立即 disconnect——常驻的 documentElement 子树观察器是
  // mutation 记录雪崩的放大器（每条记录都要为它单独包装成 JS 对象）。
  let hooked = false;
  const readyObserver = new MutationObserver(() => {
    hookWhenReady();
  });
  const hookWhenReady = () => {
    if (hooked) return;
    const shell = document.querySelector("openclaw-app-shell");
    if (shell?.context?.gateway) {
      hooked = true;
      readyObserver.disconnect();
      hookGatewayStore();
    }
  };
  readyObserver.observe(document.documentElement, { childList: true, subtree: true });
  // 10s 兜底：无论如何不再永久监听
  window.setTimeout(() => readyObserver.disconnect(), 10000);
  // Context can be attached to an existing shell without a DOM mutation. A
  // short high-frequency probe closes that race, then removes itself so it
  // cannot become another permanent page observer.
  let hookProbeAttempts = 0;
  const hookProbeTimer = window.setInterval(() => {
    hookProbeAttempts += 1;
    hookWhenReady();
    if (hooked || hookProbeAttempts >= 20) window.clearInterval(hookProbeTimer);
  }, 500);
  hookWhenReady();
  window.addEventListener("load", () => window.setTimeout(hookWhenReady, 150), {
    once: true,
  });
})();
