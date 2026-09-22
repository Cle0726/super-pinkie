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

  const chatPanes = () => {
    const panes = document.querySelectorAll?.("openclaw-chat-pane");
    return panes?.length ? Array.from(panes) : [document.querySelector("openclaw-chat-pane")].filter(Boolean);
  };
  const activePane = () => chatPanes().find((pane) => pane.active === true) || chatPanes()[0] || null;
  const routedSessionKey = () => new URLSearchParams(window.location.search).get("session")?.trim() || "";
  const paneSessionKey = (pane) => pane?.state?.sessionKey?.trim() || "";
  // URL is the selected session. The pane can still hold the previous session
  // for a render tick (or indefinitely after a failed router update).
  const currentSessionKey = () => {
    const routed = routedSessionKey();
    if (routed) return routed;
    const paneKey = paneSessionKey(activePane());
    if (paneKey) return paneKey;
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
  const UI_CACHE_REVISION = "history-render-18";
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
      // The installer revisions both the entry module and the lazy chat URL,
      // so this document is already using the repaired assets. Reloading here
      // made every fresh launch replay the entrance/rehydration sequence once.
      // Clear only the disposable cache and let the current view stay put.
      window.localStorage.setItem(UI_CACHE_REFRESHED, "1");
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

  // 会话记录始终完整保存在网关/SQLite；浏览器只持有最后五条可见消息。
  // 这不是删除历史，而是一个 live window（实时窗口）：避免一次断线恢复
  // 把数百条旧记录重新塞进 Lit 和 WebKit，导致输入框抢滚动、闪跳和内存飙升。
  const LIVE_MESSAGE_WINDOW = 5;
  const HISTORY_PAGE_SIZE = LIVE_MESSAGE_WINDOW;
  // Internal watchdog turns are persisted for crash/restart recovery, but are
  // not visible chat records. Scan a few tiny pages until five renderable
  // records are found; only those five are ever assigned to Lit/the DOM.
  const HISTORY_MAX_SCAN_PAGES = 12;
  const HISTORY_MAX_CHARS = 240000;
  const historyStatusBySession = new Map();

  const messageText = (message) => {
    if (!message || typeof message !== "object") return "";
    if (typeof message.text === "string") return message.text;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) return "";
    return message.content
      .filter((part) => part && typeof part === "object"
        && ["text", "input_text", "output_text"].includes(part.type)
        && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  };

  const hasVisibleNonTextContent = (message) => {
    if (!Array.isArray(message?.content)) return false;
    return message.content.some((part) => {
      if (!part || typeof part !== "object") return true;
      return !["text", "input_text", "output_text", "thinking", "reasoning"].includes(part.type);
    });
  };

  const hasUserMedia = (message) => {
    const paths = Array.isArray(message?.MediaPaths)
      ? message.MediaPaths
      : (typeof message?.MediaPath === "string" ? [message.MediaPath] : []);
    return paths.some((item) => typeof item === "string" && item.trim());
  };

  const invisibleControlText = (value) => String(value || "")
    .replace(/[\u200B-\u200D\u2060\u2063\uFEFF]/gu, "")
    .trim();

  const isRenderableHistoryMessage = (message) => {
    if (!message || typeof message !== "object") return false;
    const role = String(message.role || "").toLowerCase();
    const visibleText = invisibleControlText(messageText(message));
    if (role === "user") {
      if (hasUserMedia(message) || hasVisibleNonTextContent(message)) return true;
      if (!visibleText) return false;
      if (/^\[pinkie-(?:watchdog|tier)[^\]]*\]\s*$/iu.test(visibleText)) return false;
      return true;
    }
    if (role === "assistant") {
      if (hasVisibleNonTextContent(message)) return true;
      if (!visibleText || /^NO_REPLY[。.!！\s]*$/iu.test(visibleText)) return false;
      if (/^HEARTBEAT_OK\W{0,4}$/iu.test(visibleText)) return false;
      return true;
    }
    if (role === "toolresult") {
      return visibleText !== "[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.";
    }
    return Boolean(visibleText || hasVisibleNonTextContent(message));
  };

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

  // 恢复发生时页面已确认 idle，说明正在发送的 optimistic 消息早应落盘。
  // 因此 server tail 是唯一权威来源，绝不能再把旧 Lit state 拼到最后：
  // 页面若恰好保留的是旧页，拼接后 slice(-5) 会反过来把刚拉到的最新五条
  // 挤掉，视觉上就像聊天记录丢失。流式期间由 isBusy() 直接跳过恢复。
  const mergeRecentHistory = (history) => uniqueMessages(
    Array.isArray(history) ? history : []
  ).filter(isRenderableHistoryMessage).slice(-LIVE_MESSAGE_WINDOW);

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
      maxChars: HISTORY_MAX_CHARS,
      ...(parsedAgent?.[1] ? {agentId: parsedAgent[1]} : {}),
    };
  };

  // chat.history 的 offset=0 是最新一页。不要再分页回填整个 transcript：
  // 完整记录留在持久层，需要时由会话检查点/搜索读取；聊天页只同步 live window。
  const fetchRecentHistory = async (pane, sessionKey, expectedClient) => {
    const client = expectedClient || gatewayClient();
    if (!client || !gatewayConnected() || !sessionKey) return null;
    // 会话切换或 websocket 换代后，旧请求的结果绝不能写进新聊天。
    if (gatewayClient() !== client || paneSessionKey(pane) !== sessionKey) return null;
    let offset = 0;
    let pageCount = 0;
    let hasMore = true;
    let newestPage = null;
    let renderable = [];
    while (hasMore && pageCount < HISTORY_MAX_SCAN_PAGES
        && renderable.length < LIVE_MESSAGE_WINDOW) {
      const page = await withTimeout(
        client.request("chat.history", historyParams(sessionKey, offset)),
        20000,
      );
      if (gatewayClient() !== client || paneSessionKey(pane) !== sessionKey) return null;
      if (!newestPage) newestPage = page;
      const rawMessages = Array.isArray(page?.messages) ? page.messages : [];
      const visiblePage = uniqueMessages(rawMessages).filter(isRenderableHistoryMessage);
      renderable = uniqueMessages([...visiblePage, ...renderable]);
      pageCount += 1;
      hasMore = page?.hasMore === true && rawMessages.length > 0;
      offset += rawMessages.length;
    }

    return {
      messages: renderable.slice(-LIVE_MESSAGE_WINDOW),
      sessionId: String(newestPage?.sessionInfo?.sessionId || newestPage?.sessionId || ""),
      totalMessages: Number.isFinite(newestPage?.totalMessages) ? newestPage.totalMessages : undefined,
      pageCount,
      hasMore,
    };
  };

  // 正在生成中的判定: 发送按钮禁用 / 停止按钮可见 / 流式进行中
  const isBusy = (pane = activePane()) => {
    const state = pane?.state;
    if (state?.chatRunId || state?.chatSending || state?.chatStream) return true;
    const root = pane?.querySelector ? pane : document;
    if (root.querySelector?.('[data-laolao-streaming="true"]')) return true;
    const stopBtn = root.querySelector?.(STOP_SELECTOR);
    if (stopBtn && stopBtn.offsetParent !== null) return true;
    // Disabled Send also means an empty composer, session loading or missing
    // permissions. It is not evidence of a live model turn.
    return false;
  };

  // The router can advance before the lazy chat page receives its new loader
  // data. Repair only the selected pane via native reactive properties; never
  // reuse a previous pane's messages for the newly selected session.
  const reconcileSelectedSession = () => {
    const key = routedSessionKey();
    const page = document.querySelector("openclaw-chat-page");
    const pane = activePane();
    if (!key || !page || !pane) return true;
    if (page.data?.sessionKey !== key) {
      page.data = {...(page.data || {}), sessionKey: key};
      page.requestUpdate?.();
      return false;
    }
    if (pane.sessionKey !== key) {
      pane.sessionKey = key;
      pane.requestUpdate?.();
      return false;
    }
    if (paneSessionKey(pane) !== key) {
      pane.requestUpdate?.("sessionKey", paneSessionKey(pane));
      return false;
    }
    return true;
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

  const recoveryByPane = new WeakMap();
  let recoveryTimer = null;
  const lastRecoveryAt = new WeakMap();
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
  // 不调用原生 refreshCurrentChat：它会先把默认的一整页历史写入 reactive
  // state，再由本脚本裁掉，正是聊天框反复跳动的来源。这里直接读取最新五条。
  const recoverPaneChat = async (pane, reason, options) => {
    const sessionKey = paneSessionKey(pane);
    const state = pane?.state;
    if (!sessionKey || !state || !gatewayConnected()) return false;
    if (pane === activePane() && routedSessionKey() && routedSessionKey() !== sessionKey) return false;
    if (pane.sessionKey && pane.sessionKey !== sessionKey) return false;
    const now = Date.now();
    const prior = recoveryByPane.get(pane);
    if (prior?.sessionKey === sessionKey) return prior.promise;
    // `force` means the caller has higher priority than the normal interval;
    // it must not bypass the global throttle. A failure/reconnect can produce
    // multiple browser events in the same second, so these must coalesce.
    const last = lastRecoveryAt.get(pane);
    if (!options.manual && last?.sessionKey === sessionKey
        && now - last.at < RECOVERY_THROTTLE_MS) return false;
    // Never replace a live stream with a persisted snapshot. The native pane
    // owns the active tail; a later idle/recovered event performs the sync.
    if (isBusy(pane)) return false;
    lastRecoveryAt.set(pane, {sessionKey, at: now});
    const recovery = {sessionKey, promise: null};
    recovery.promise = (async () => {
      try {
        const client = gatewayClient();
        const recent = await fetchRecentHistory(pane, sessionKey, client);
        if (!recent || recoveryByPane.get(pane) !== recovery
            || pane.state !== state || paneSessionKey(pane) !== sessionKey
            || (pane === activePane() && routedSessionKey() && routedSessionKey() !== sessionKey)
            || gatewayClient() !== client || isBusy(pane)) return false;
        const localMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
        const mergedMessages = mergeRecentHistory(recent.messages);
        const messagesChanged = !sameMessageSequence(localMessages, mergedMessages);
        if (messagesChanged) state.chatMessages = mergedMessages;
        // 新版原生页认识此字段；旧版会忽略它。明确关闭向前分页，避免它把
        // 已持久化的旧记录重新挂回 live DOM。
        if ("chatHistoryPagination" in state) {
          state.chatHistoryPagination = {
            hasMore: false,
            ...(Number.isFinite(recent.totalMessages)
              ? {totalMessages: recent.totalMessages}
              : {}),
          };
        }
        historyStatusBySession.set(sessionKey, {
          loadedCount: mergedMessages.length,
          visibleCount: recent.messages.length,
          totalMessages: recent.totalMessages,
          pageCount: recent.pageCount,
          sessionId: recent.sessionId,
          lastMessageIdentity: messageIdentity(recent.messages[recent.messages.length - 1]),
          syncedAt: Date.now(),
          windowed: true,
        });
        historyRebuildRetryAttempt = 0;
        // Avoid a full Lit render when history is byte-for-byte unchanged;
        // this is common during reconnect polling and was another source of
        // the composer visibly jumping up and down.
        if (messagesChanged) state.requestUpdate?.();
        // 只有确实有新消息、且用户明确停在底部，才跟随到末尾。未知状态一律
        // 不抢滚动，避免断线恢复把用户正在看的位置弹走。
        if (messagesChanged && !isBusy(pane) && state.chatUserNearBottom === true) {
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
        if (recoveryByPane.get(pane) === recovery) recoveryByPane.delete(pane);
      }
    })();
    recoveryByPane.set(pane, recovery);
    return recovery.promise;
  };

  const recoverCurrentChat = async (reason = "unknown", options = {}) => {
    if (document.hidden || !location.pathname.startsWith("/chat")) return false;
    reconcileSelectedSession();
    const panes = chatPanes();
    if (!panes.length) return false;
    const results = await Promise.all(panes.map((pane) => recoverPaneChat(pane, reason, options)));
    return results.some(Boolean);
  };

  window.__laolaoRecoverCurrentChat = recoverCurrentChat;
  window.__laolaoHistoryStatus = () => {
    const key = currentSessionKey();
    return key ? {...(historyStatusBySession.get(key) || {}), sessionKey: key} : null;
  };
  // 只暴露纯函数给离线回归测试，不包含 gateway/token 等运行数据。
  window.__laolaoHistoryTestHooks = {
    messageIdentity,
    uniqueMessages,
    isRenderableHistoryMessage,
    mergeRecentHistory,
    keepLatestMessages: (messages) => uniqueMessages(Array.isArray(messages) ? messages : [])
      .filter(isRenderableHistoryMessage).slice(-LIVE_MESSAGE_WINDOW),
  };
  window.__laolaoGatewayTestHooks = {gatewayConnected, nativeGatewayConnected};

  // 档位控制器的续跑由本机网关发起，结束事件有时不经过当前 WKWebView
  // 的 websocket。直接触发原生聊天页自己的“刷新”动作，既不重载页面，
  // 也不会重播开屏或丢失输入框草稿。
  const refreshVisibleChat = async () => {
    await recoverCurrentChat("manual-refresh", {force: true, manual: true});
    await refreshSession();
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
      await syncSelectedSession(currentSessionKey());
      await refreshSession();
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
    if (!recoveryTimer) scheduleRecovery("history-rebuilding", 250);
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

  // ── 假「生成中」自检（stale-busy reconcile）─────────────────────────
  // 背景（2026-09-16 实机确认）：recoverCurrentChat() 开头就是
  //   if (isBusy()) return false;
  // 而真正需要它的恰恰是「界面卡在生成中、后端早已收尾」这种假状态——恢复
  // 路径被它要清的那个标记挡住了，这个脚本天生治不了自己。更糟的是这把锁
  // 是页面级的而不是会话级的，所以切会话必然无效、输入框一直被禁用。
  // 这一层反过来判定：界面连续 busy，而后端权威状态明确说这个会话没有活动
  // run ⇒ 假状态，强制复位。backend 说 true 或查不到时一律不动手，真轮次
  // 永远不会被误清。
  const STALE_BUSY_AFTER_MS = 25_000;      // 连续 busy 超过这么久才开始怀疑
  const STALE_BUSY_VERIFY_MS = 20_000;     // 两次向后端核对的最短间隔
  const STALE_BUSY_SOFT_WAIT_MS = 5_000;   // 软复位后等多久看它是否生效
  const STALE_BUSY_RELOAD_COOLDOWN_MS = 10 * 60_000;
  const STALE_BUSY_OFF_KEY = "laolao:stale-busy-reconcile";
  const STALE_BUSY_RELOAD_KEY = "laolao:stale-busy-reload-at";
  const staleStateByPane = new WeakMap();
  const staleState = (pane) => {
    let state = staleStateByPane.get(pane);
    if (!state) {
      state = {sessionKey: paneSessionKey(pane), busySince: 0, verifyAt: 0,
        softResetAt: 0, inFlight: false};
      staleStateByPane.set(pane, state);
    }
    if (state.sessionKey !== paneSessionKey(pane)) {
      Object.assign(state, {sessionKey: paneSessionKey(pane), busySince: 0,
        verifyAt: 0, softResetAt: 0, inFlight: false});
    }
    return state;
  };

  const staleBusyEnabled = () => {
    try { return window.localStorage?.getItem(STALE_BUSY_OFF_KEY) !== "off"; } catch { return true; }
  };
  const lastForcedReloadAt = () => {
    try { return Number(window.sessionStorage?.getItem(STALE_BUSY_RELOAD_KEY)) || 0; } catch { return 0; }
  };
  const markForcedReload = () => {
    try { window.sessionStorage?.setItem(STALE_BUSY_RELOAD_KEY, String(Date.now())); } catch {}
  };

  // 原生壳把「生成中」放在这几个 reactive 字段上。真正的判据在 chat-page
  // bundle 里（2026-09-16 实读）：
  //   function ac(e){ return e.chatRunId ? true
  //     : !!(e.sessionsResult?.sessions.some(t => t.key === e.sessionKey && Je(t))); }
  // 即 canAbort/停止按钮 = `chatRunId` 非空，或 sessionsResult 里当前会话的
  // hasActiveRun 为真。`chatSending` 只影响发送按钮，不是「生成中」的源——
  // 所以复位必须清 chatRunId，并纠正那份可能过期的 sessionsResult 快照。
  // 不硬编码元素名：逐个候选对象探测谁持有这些字段，谁有就复位谁。
  const runningStateTargets = (pane = activePane()) => {
    const out = [];
    for (const el of [pane]) {
      if (!el) continue;
      const state = el.state && typeof el.state === "object" ? el.state : null;
      if (state && ("chatRunId" in state || "chatSending" in state || "chatRunStatus" in state)) {
        out.push({state, owner: el});
      } else if ("chatRunId" in el || "chatSending" in el || "chatRunStatus" in el) {
        out.push({state: el, owner: el});
      }
    }
    return out;
  };

  const forceIdleComposerState = (pane = activePane()) => {
    let touched = false;
    const sessionKey = paneSessionKey(pane);
    for (const {state, owner} of runningStateTargets(pane)) {
      if (!state || typeof state !== "object") continue;
      try {
        if (state.chatRunStatusClearTimer) {
          globalThis.clearTimeout(state.chatRunStatusClearTimer);
          state.chatRunStatusClearTimer = null;
        }
        // 关键：canAbort 的第一判据就是这个 runId，不清它会一直显示生成中
        if ("chatRunId" in state) state.chatRunId = null;
        if ("chatSending" in state) state.chatSending = false;
        if ("chatRunStatus" in state) state.chatRunStatus = null;
        if ("chatStream" in state) state.chatStream = null;
        if ("chatStreamSegments" in state) state.chatStreamSegments = [];
        if ("chatStreamStartedAt" in state) state.chatStreamStartedAt = null;
        if ("chatLoading" in state) state.chatLoading = false;
        // canAbort 的第二判据。后端这一秒刚刚权威地回答了「没有活动 run」，
        // 所以这里纠正的是过期快照，不是伪造状态。
        const sessions = state.sessionsResult?.sessions;
        if (Array.isArray(sessions) && sessionKey) {
          for (const entry of sessions) {
            if (entry && entry.key === sessionKey && entry.hasActiveRun === true) {
              entry.hasActiveRun = false;
              if (entry.status !== "done" && entry.status !== "failed") entry.status = "done";
            }
          }
        }
        state.requestUpdate?.();
        owner?.requestUpdate?.();
        touched = true;
      } catch {}
    }
    // 我们这层自己的标记
    if (!chatPanes().some((other) => other !== pane && isBusy(other))) {
      document.documentElement.removeAttribute("data-laolao-streaming");
      document.dispatchEvent(new CustomEvent("laolao:streaming", {detail: {active: false}}));
    }
    return touched;
  };

  // 后端权威判定。返回 false = 确认没有活动 run；true = 有；null = 没查成
  // （网关不在、超时、返回结构不认识）——null 时绝不复位，宁可不动手。
  const backendHasActiveRun = async (sessionKey = currentSessionKey()) => {
    const client = gatewayClient();
    if (!client || !gatewayConnected()) return null;
    let payload;
    try {
      payload = await withTimeout(client.request("sessions.list", {limit: 1000}), 6000);
    } catch {
      return null;
    }
    const sessions = payload?.sessions;
    if (!Array.isArray(sessions)) return null;
    const mine = sessionKey ? sessions.find((s) => s && s.key === sessionKey) : null;
    if (mine) return mine.hasActiveRun === true;
    // A missing row is not proof of inactivity. Never reset another pane.
    return null;
  };

  const reconcileStaleBusy = async (pane = activePane()) => {
    if (!pane) return;
    const key = paneSessionKey(pane);
    const stale = staleState(pane);
    const now = Date.now();
    if (stale.inFlight || !staleBusyEnabled()) return;
    if (document.hidden || !location.pathname.startsWith("/chat")) return;
    // The ribbon can remain "retrying" after the socket has recovered. Its
    // label is not an authoritative connection state; using it here made a
    // completed backend turn permanently look busy in a single pane too.
    if (!gatewayConnected()) return;

    if (!isBusy(pane)) {
      stale.busySince = 0;
      stale.softResetAt = 0;
      return;
    }
    if (!stale.busySince) {
      stale.busySince = now;
      return;
    }
    if (now - stale.busySince < STALE_BUSY_AFTER_MS) return;

    // 软复位试过了还在忙 ⇒ 硬复位：保草稿后重载（本 App 没有刷新菜单，
    // 重载是唯一可靠的兜底；草稿由 preserve/restoreComposerDraft 负责）。
    if (stale.softResetAt && now - stale.softResetAt > STALE_BUSY_SOFT_WAIT_MS) {
      if (now - lastForcedReloadAt() < STALE_BUSY_RELOAD_COOLDOWN_MS) return;
      stale.inFlight = true;
      try {
        // A real new run may have started after the soft reset. Recheck the
        // exact session before the last-resort reload.
        if (await backendHasActiveRun(key) !== false || paneSessionKey(pane) !== key) return;
      } finally {
        stale.inFlight = false;
      }
      markForcedReload();
      preserveComposerDraft();
      window.dispatchEvent(new CustomEvent("pinkie:stale-busy-reload", {
        detail: {sessionKey: key},
      }));
      location.reload();
      return;
    }

    if (now - stale.verifyAt < STALE_BUSY_VERIFY_MS) return;
    stale.verifyAt = now;
    stale.inFlight = true;
    try {
      const active = await backendHasActiveRun(key);
      if (active !== false || paneSessionKey(pane) !== key) return;
      // 防误伤：核对期间万一同一个会话真的新起了一轮，runStatus 会带新的
      // occurredAt。这种情况下宁可这一轮不动手，等它跑到 idle 再说。
      const freshRunAt = Number(
        pane.state?.chatRunStatus?.occurredAt
      ) || 0;
      if (freshRunAt && Date.now() - freshRunAt < 10_000) return;
      preserveComposerDraft();
      const touched = forceIdleComposerState(pane);
      stale.softResetAt = Date.now();
      setWatchdogStatus("recovered", "连接正常，已复位卡住的生成状态");
      window.dispatchEvent(new CustomEvent("pinkie:stale-busy-reset", {
        detail: {touched, sessionKey: key},
      }));
      // 光把 busy 标记清掉还不够：卡住期间落盘的尾段要重新拉回来。
      // 此时 isBusy() 已经是 false，recoverCurrentChat 的门禁不会再挡住它。
      scheduleRecovery("stale-busy-reset", 400);
    } finally {
      stale.inFlight = false;
    }
  };

  // 调试/自测句柄（与 __laolaoSidebar / __laolaoUsage 同惯例）。
  // 手动验：__laolaoStaleBusy.reconcile() 会立刻走一次判定；
  // __laolaoStaleBusy.forceIdle() 可单独验软复位是否认得当前状态对象。
  window.__laolaoStaleBusy = {
    reconcile: () => reconcileStaleBusy(),
    forceIdle: () => forceIdleComposerState(),
    backendHasActiveRun,
    isBusy,
    state: () => ({
      ...(activePane() ? staleState(activePane()) : {}),
      enabled: staleBusyEnabled(),
      lastForcedReloadAt: lastForcedReloadAt(),
    }),
    candidates: () => runningStateTargets(activePane()).map(({state, owner}) => ({
      owner: owner?.tagName || null,
      hasRunId: "chatRunId" in state,
      hasSending: "chatSending" in state,
      hasRunStatus: "chatRunStatus" in state,
      hasStream: "chatStream" in state,
      hasSessionsResult: Array.isArray(state?.sessionsResult?.sessions),
    })),
  };

  // A sidebar click is an explicit request to show one exact transcript. The
  // URL may advance before Lit finishes switching the pane, or a lost terminal
  // event can leave the old pane falsely busy. Verify the selected session
  // against the backend immediately instead of waiting for the idle poll.
  let selectedSessionRevision = 0;
  const syncSelectedSession = async (sessionKey) => {
    const key = String(sessionKey || "").trim();
    if (!key) return false;
    const revision = ++selectedSessionRevision;
    let sawExpectedRoute = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (revision !== selectedSessionRevision) return false;
      if (routedSessionKey() !== key) {
        if (sawExpectedRoute) return false;
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        continue;
      }
      sawExpectedRoute = true;
      const aligned = reconcileSelectedSession();
      const pane = activePane();
      if (aligned && pane && paneSessionKey(pane) === key) {
        if (isBusy(pane)) {
          const active = await backendHasActiveRun(key);
          if (revision !== selectedSessionRevision || routedSessionKey() !== key) return false;
          if (active !== false) return false; // Unknown or genuine run: never clear it.
          forceIdleComposerState(pane);
        }
        if (!isBusy(pane) && await recoverPaneChat(pane, "session-selected", {manual: true})) {
          return true;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    return false;
  };
  window.__laolaoSyncSelectedSession = syncSelectedSession;
  window.addEventListener("pinkie:session-selected", (event) => {
    void syncSelectedSession(event.detail?.sessionKey);
  });

  // 不造一个假的输入框；只要聊天路由的真实 composer 意外掉线，就低频
  // 请求原生界面重新同步。这样发送、录音、附件和模型选择仍是原功能。
  let observedSessionKey = "";
  const observedPaneKeys = new WeakMap();
  window.setTimeout(() => {
    restoreComposerDraft();
    observedSessionKey = currentSessionKey();
    for (const pane of chatPanes()) observedPaneKeys.set(pane, paneSessionKey(pane));
    void syncSelectedSession(observedSessionKey);
    window.setInterval(() => {
      if (document.hidden || !location.pathname.startsWith("/chat")) return;
      reconcileSelectedSession();
      const sessionKey = currentSessionKey();
      if (sessionKey && sessionKey !== observedSessionKey) {
        observedSessionKey = sessionKey;
        void syncSelectedSession(sessionKey);
      }
      // A stale retry ribbon must not stop the idle tail poll or stale-busy
      // reconciliation. Only the actual gateway connection can block them.
      const waitingForGateway = !gatewayConnected();
      for (const pane of chatPanes()) {
        const key = paneSessionKey(pane);
        const state = pane.state;
        if (!key || !state || (pane.sessionKey && pane.sessionKey !== key)) continue;
        if (observedPaneKeys.get(pane) !== key) {
          observedPaneKeys.set(pane, key);
          scheduleRecovery("pane-session-changed", 250);
        }
        // Native history can briefly remount a larger page. Keep each pane's
        // five-message window independent; one busy pane must not block another.
        if (Array.isArray(state.chatMessages) && state.chatMessages.length > LIVE_MESSAGE_WINDOW
            && !isBusy(pane)) {
          state.chatMessages = uniqueMessages(state.chatMessages)
            .filter(isRenderableHistoryMessage).slice(-LIVE_MESSAGE_WINDOW);
          state.requestUpdate?.();
          scheduleRecovery("native-history-remounted", 250);
          continue;
        }
        const expected = historyStatusBySession.get(key)?.visibleCount;
        if (Number.isFinite(expected) && Array.isArray(state.chatMessages)
            && state.chatMessages.length < expected && !isBusy(pane) && !waitingForGateway) {
          scheduleRecovery("visible-window-regressed", 250);
        } else if (!historyStatusBySession.has(key) && !isBusy(pane) && !waitingForGateway) {
          scheduleRecovery("history-not-yet-synced", 300);
        } else if (!isBusy(pane) && !waitingForGateway
            && Date.now() - (historyStatusBySession.get(key)?.syncedAt || 0) > 5_000) {
          // A terminal event lost during tool execution does not change the
          // visible message count. Poll the tiny server tail while idle.
          scheduleRecovery("idle-tail-check", 250);
        }
        void reconcileStaleBusy(pane);
      }
      if (!document.querySelector(".agent-chat__composer-combobox textarea")) scheduleRecovery("composer-missing", 300);
    }, 1000);
  }, 400);

  // The new injection itself is network-first, so it can evict an older
  // cache-first native chat bundle without replaying the current screen.
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
        void syncSelectedSession(currentSessionKey());
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
