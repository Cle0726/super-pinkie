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
  const timelineRunIds = window.__pinkieActiveChatRunIds instanceof Map
    ? window.__pinkieActiveChatRunIds
    : (window.__pinkieActiveChatRunIds = new Map());
  const activeTimelineBoundarySyncBySession = new Map();
  const publishTimelineRunState = (sessionKey, active) => {
    if (!sessionKey || typeof active !== "boolean") return;
    const runs = window.__pinkieActiveChatRuns instanceof Map
      ? window.__pinkieActiveChatRuns
      : (window.__pinkieActiveChatRuns = new Map());
    const wasKnown = runs.has(sessionKey);
    const previous = runs.get(sessionKey);
    const changed = !wasKnown || previous !== active;
    runs.set(sessionKey, active);
    if (!active) {
      timelineRunIds.delete(sessionKey);
      activeTimelineBoundarySyncBySession.delete(sessionKey);
    }
    if (!changed) return;
    for (const pane of chatPanes()) {
      if (paneSessionKey(pane) !== sessionKey) continue;
      const state = pane.state;
      const nativeSession = state?.sessionsResult?.sessions?.find?.((item) => item?.key === sessionKey);
      const nativeActive = Boolean(state?.chatRunId || state?.chatStream || nativeSession?.hasActiveRun === true);
      // The projector already treats an unknown session as idle. Avoid a
      // redundant Lit render for the first explicit idle result, but repaint
      // when a live card must close or the backend confirms a running turn.
      if (!(active || (wasKnown && previous !== active) || nativeActive)) continue;
      pane.state?.requestUpdate?.();
      pane.requestUpdate?.();
    }
  };
  // macOS keeps each half of the split workspace in its own WKWebView. WebKit
  // may mark the unfocused half as hidden even though it remains on screen;
  // that half still needs terminal-event and stale-run recovery.
  const isVisibleChatSurface = () => !document.hidden
    || document.documentElement?.hasAttribute?.("data-laolao-workspace-split")
    || document.documentElement?.hasAttribute?.("data-laolao-workspace-dock")
    || new URLSearchParams(location.search).get("laolao-dock") === "1";
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
  const recoveryTransportAvailable = () => gatewayConnected()
    || typeof window.__laolaoSidebar?.gwRequest === "function";

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
  const UI_CACHE_REVISION = "history-render-31";
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
    if (!isVisibleChatSurface() || !location.pathname.startsWith("/chat")) return;
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

  // The sidebar owns a second gateway socket. A native control-ui snapshot
  // can claim to be online while its request promise is already poisoned;
  // read-only recovery may safely retry through that independent connection.
  const requestRecovery = async (method, params, timeoutMs = 8000, client = gatewayClient()) => {
    const fallback = window.__laolaoSidebar?.gwRequest;
    let primaryError;
    if (client && gatewayConnected()) {
      try {
        return await withTimeout(client.request(method, params),
          typeof fallback === "function" ? Math.min(timeoutMs, 5000) : timeoutMs);
      } catch (error) { primaryError = error; }
    }
    if (typeof fallback === "function") {
      return withTimeout(fallback(method, params, timeoutMs), timeoutMs + 1000);
    }
    throw primaryError || new Error("gateway recovery transport unavailable");
  };

  const isHistoryRebuildingError = (error) => {
    const text = String(error?.message || error?.errorMessage || error || "");
    return /session history is rebuilding|transcript projection is rebuilding|projection is rebuilding|UNAVAILABLE/i.test(text);
  };

  // The native timeline renders at most 80 rows. Keep a larger bounded message
  // window so a long current turn (including tool calls and their results)
  // survives reconnects and app restarts; old turns still never load wholesale.
  const LIVE_MESSAGE_WINDOW = 512;
  const HISTORY_PAGE_SIZE = 128;
  // Internal watchdog turns are persisted for crash/restart recovery, but are
  // not visible chat records. Scan bounded pages until the live window is full.
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
      if (/^\[pinkie-(?:watchdog|tier-control|tier)[^\]]*\]/iu.test(visibleText)) return false;
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
  // 流式期间由 isBusy() 直接跳过恢复。若单轮异常长到超过窗口，仍保留
  // 最后一条真实用户消息作为时间线起点，并把其余容量留给最新步骤。
  const keepLiveMessages = (messages) => {
    const renderable = uniqueMessages(Array.isArray(messages) ? messages : [])
      .filter(isRenderableHistoryMessage);
    if (renderable.length <= LIVE_MESSAGE_WINDOW) return renderable;
    const lastUserIndex = renderable.findLastIndex((message) =>
      String(message?.role || "").toLowerCase() === "user");
    const start = renderable.length - LIVE_MESSAGE_WINDOW;
    if (lastUserIndex >= 0 && lastUserIndex < start) {
      return [renderable[lastUserIndex], ...renderable.slice(-LIVE_MESSAGE_WINDOW + 1)];
    }
    return renderable.slice(-LIVE_MESSAGE_WINDOW);
  };

  const mergeRecentHistory = (history) => keepLiveMessages(history);

  // ── 历史窗口不回缩 ──
  // 原生页每轮结束后只重新拉最新 10 条，并用它整体替换 chatMessages；它本来靠
  // 向前分页补回更早的消息，但本脚本关掉了分页（只维持有界窗口）。于是已经显示
  // 的旧消息会被挤掉，接着本脚本发现窗口回退又整窗补回：旧消息被拆掉重建、入场
  // 动画重播、滚动乱跳，看起来就像「发完消息之前的聊天又弹出来」。这里在原生赋值
  // 的那一刻把它的尾页接回已显示的窗口：同一会话里，新列表的第一条若能在当前
  // 列表里找到，就保留它前面的消息。本脚本自己写入的权威窗口不经过这里。
  let ownMessageWrite = 0;
  const writeOwnMessages = (state, messages) => {
    ownMessageWrite += 1;
    try { state.chatMessages = messages; } finally { ownMessageWrite -= 1; }
  };
  const keepEarlierMessages = (previous, next) => {
    if (!Array.isArray(previous) || !Array.isArray(next) || !previous.length || !next.length) return next;
    const first = messageIdentity(next[0]);
    if (!first) return next;
    const at = previous.findIndex((message) => messageIdentity(message) === first);
    if (at <= 0) return next;
    const merged = [...previous.slice(0, at), ...next];
    return merged.length > LIVE_MESSAGE_WINDOW ? keepLiveMessages(merged) : merged;
  };
  const guardedMessageStates = new WeakSet();
  const guardMessageWindow = (state) => {
    if (!state || typeof state !== "object" || guardedMessageStates.has(state)) return false;
    let owner = state;
    let descriptor = null;
    while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, "chatMessages"))) owner = Object.getPrototypeOf(owner);
    if (!descriptor || (owner === state && descriptor.configurable === false)) return false;
    if (!descriptor.set && descriptor.writable === false) return false;
    guardedMessageStates.add(state);
    let value = state.chatMessages;
    const read = descriptor.get ? () => descriptor.get.call(state) : () => value;
    const write = descriptor.set ? (next) => descriptor.set.call(state, next) : (next) => { value = next; };
    let listSession = state.sessionKey;
    Object.defineProperty(state, "chatMessages", {
      configurable: true,
      enumerable: true,
      get: read,
      set(next) {
        // A different session (or a reset to an empty list) always replaces.
        const sameSession = state.sessionKey === listSession;
        listSession = state.sessionKey;
        write(ownMessageWrite || !sameSession ? next : keepEarlierMessages(read(), next));
      },
    });
    return true;
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
      maxChars: HISTORY_MAX_CHARS,
      ...(parsedAgent?.[1] ? {agentId: parsedAgent[1]} : {}),
    };
  };

  // chat.history 的 offset=0 是最新一页。不要再分页回填整个 transcript：
  // 完整记录留在持久层，需要时由会话检查点/搜索读取；聊天页只同步 live window。
  const fetchRecentHistory = async (pane, sessionKey, expectedClient) => {
    const client = expectedClient || gatewayClient();
    if (!recoveryTransportAvailable() || !sessionKey) return null;
    // 会话切换或 websocket 换代后，旧请求的结果绝不能写进新聊天。
    if (gatewayClient() !== client || paneSessionKey(pane) !== sessionKey) return null;
    let offset = 0;
    let pageCount = 0;
    let hasMore = true;
    let newestPage = null;
    let renderable = [];
    while (hasMore && pageCount < HISTORY_MAX_SCAN_PAGES
        && renderable.length < LIVE_MESSAGE_WINDOW) {
      const page = await requestRecovery("chat.history", historyParams(sessionKey, offset), 20000, client);
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
      messages: keepLiveMessages(renderable),
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

  // A terminal frame can leave the native Stop button in the DOM for one
  // paint after its reactive run fields have been cleared.  Keep the fact
  // that *we just verified the backend idle* separate from the broad UI busy
  // predicate: queue recovery may ignore only that residual button, and only
  // for this short handoff.  A fresh run still wins immediately through the
  // reactive fields and the second sessions.list check below.
  const VERIFIED_QUEUE_IDLE_MS = 4_000;
  const verifiedQueueIdleByPane = new WeakMap();
  const markVerifiedQueueIdle = (pane, sessionKey = paneSessionKey(pane)) => {
    if (!pane || !sessionKey) return;
    verifiedQueueIdleByPane.set(pane, {sessionKey, until: Date.now() + VERIFIED_QUEUE_IDLE_MS});
  };
  const hasVerifiedQueueIdle = (pane, sessionKey = paneSessionKey(pane)) => {
    const marker = verifiedQueueIdleByPane.get(pane);
    return Boolean(marker && marker.sessionKey === sessionKey && marker.until > Date.now());
  };
  const hasLiveComposerState = (pane) => {
    const state = pane?.state;
    if (state?.chatRunId || state?.chatSending || state?.chatStream) return true;
    const root = pane?.querySelector ? pane : document;
    return Boolean(root.querySelector?.('[data-laolao-streaming="true"]'));
  };
  const queueRecoveryBusy = (pane = activePane()) => {
    if (!isBusy(pane)) return false;
    // Do not discount an actual stream or a newly started run.  The one case
    // we intentionally allow through is the stale Stop element described
    // above, after an authoritative hasActiveRun=false result.
    return !hasVerifiedQueueIdle(pane) || hasLiveComposerState(pane);
  };

  const terminalPainted = (pane, message) => {
    const raw = messageText(message).trim();
    if (!raw) return false;
    // The native renderer keeps the unformatted reply on each visible bubble.
    // Checking the exact bubble avoids mistaking a state-only final for a
    // painted one (and avoids matching the same text in the composer).
    const bubbles = pane?.querySelectorAll?.(".chat-bubble[data-message-text]") || [];
    for (const bubble of bubbles) {
      if (String(bubble?.getAttribute?.("data-message-text") || "").trim() === raw) return true;
    }
    // Older bundles may not expose data-message-text. Their Markdown renderer
    // splits text across DOM nodes, so textContent omits the spaces between
    // paragraphs even though accessibility displays them.
    const compact = (value) => String(value || "").replace(/[`*_#>~\s]/g, "");
    const preview = compact(raw);
    const root = pane?.renderRoot || pane?.shadowRoot || pane;
    const paintedText = compact(root?.textContent);
    const head = preview.slice(0, Math.min(32, preview.length));
    const tail = preview.slice(-Math.min(32, preview.length));
    return paintedText.includes(head)
      && (preview.length <= 96 || paintedText.includes(tail));
  };

  // Sending a new message means the user wants to see that turn's answer,
  // even when this pane was previously scrolled up. Keep this intent scoped
  // to the pane: the other half of split view must never move with it.
  // The native chat pane can be replaced while tool cards are rebuilt. Keep
  // the follow intent on the session rather than the short-lived DOM element.
  const followOwnSendBySession = new Map();
  const paneForEvent = (event) => {
    const panes = chatPanes();
    const pathPane = event.composedPath?.().find((node) =>
      node?.tagName?.toLowerCase?.() === "openclaw-chat-pane");
    if (pathPane && panes.includes(pathPane)) return pathPane;
    const closest = event.target?.closest?.("openclaw-chat-pane");
    if (closest && panes.includes(closest)) return closest;
    return panes.length === 1 ? panes[0] : null;
  };
  const followOwnSend = (pane) => {
    const state = pane?.state;
    const sessionKey = paneSessionKey(pane);
    if (!state || !sessionKey) return;
    followOwnSendBySession.set(sessionKey, {
      sessionKey,
      previousTail: messageIdentity(state.chatMessages?.at(-1)),
    });
    state.chatUserNearBottom = true;
    window.setTimeout(() => {
      if (followOwnSendBySession.has(sessionKey)) {
        const current = chatPanes().find((item) => paneSessionKey(item) === sessionKey);
        current?.state?.scrollToBottom?.({smooth: false});
      }
    }, 120);
  };
  const followTerminalReply = (pane, messages) => {
    const sessionKey = paneSessionKey(pane);
    const follow = followOwnSendBySession.get(sessionKey);
    if (!follow) return false;
    const last = messages.at(-1);
    if (messageIdentity(last) === follow.previousTail
        || String(last?.role || "").toLowerCase() !== "assistant"
        || last?.stopReason === "toolUse"
        || !messageText(last).trim()) return false;
    followOwnSendBySession.delete(sessionKey);
    const state = pane.state;
    state.chatUserNearBottom = true;
    // Lit may paint the persisted final one frame after chat.history resolves.
    state.scrollToBottom?.({smooth: false});
    window.setTimeout(() => {
      if (paneSessionKey(pane) === sessionKey && !isBusy(pane)) {
        state.scrollToBottom?.({smooth: false});
      }
    }, 120);
    return true;
  };
  const realSendButton = (target) => {
    const button = target?.closest?.(".chat-send-btn");
    if (!button || button.disabled || button.hasAttribute?.("disabled")) return null;
    if (["chat-send-btn--stop", "chat-send-btn--voice", "chat-send-btn--laolao-dictation", "chat-send-btn--queue"]
      .some((name) => button.classList?.contains(name))) return null;
    return /send|发送/i.test(button.getAttribute?.("aria-label") || "") ? button : null;
  };
  document.addEventListener("pointerdown", (event) => {
    if (realSendButton(event.target)) followOwnSend(paneForEvent(event));
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const input = event.target?.closest?.(".agent-chat__composer-combobox textarea");
    if (input?.value?.trim()) followOwnSend(paneForEvent(event));
  }, true);
  const cancelFollowOnUserScroll = (event) => {
    const pane = paneForEvent(event);
    const sessionKey = paneSessionKey(pane);
    if (!sessionKey || !followOwnSendBySession.has(sessionKey)) return;
    followOwnSendBySession.delete(sessionKey);
    if (pane.state) pane.state.chatUserNearBottom = false;
  };
  document.addEventListener("wheel", cancelFollowOnUserScroll, {capture: true, passive: true});
  document.addEventListener("touchmove", cancelFollowOnUserScroll, {capture: true, passive: true});

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

  // 只读刷新会话列表。正文恢复不能靠 sessions.list；它读取 chat.history，
  // 而不是重载聊天页或向模型再发送一轮。
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
  // state，再由本脚本裁掉，正是聊天框反复跳动的来源。这里直接读取有界时间线窗口。
  const recoverPaneChat = async (pane, reason, options = {}) => {
    const sessionKey = paneSessionKey(pane);
    const state = pane?.state;
    if (!sessionKey || !state || !recoveryTransportAvailable()) return false;
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
    if (isBusy(pane) && !options.verifiedTerminal) return false;
    lastRecoveryAt.set(pane, {sessionKey, at: now});
    const recovery = {sessionKey, promise: Promise.resolve(false)};
    // A pre-fetched page has no first await. Register before starting so the
    // synchronous identity guard sees this very recovery, not an empty map.
    recoveryByPane.set(pane, recovery);
    recovery.promise = (async () => {
      try {
        const client = gatewayClient();
        const recent = options.recent || await fetchRecentHistory(pane, sessionKey, client);
        if (!recent || recoveryByPane.get(pane) !== recovery
            || pane.state !== state || paneSessionKey(pane) !== sessionKey
            || (pane === activePane() && routedSessionKey() && routedSessionKey() !== sessionKey)
            || (!options.recent && gatewayClient() !== client)
            || (isBusy(pane) && !options.verifiedTerminal)) return false;
        const localMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
        const mergedMessages = mergeRecentHistory(recent.messages);
        const messagesChanged = !sameMessageSequence(localMessages, mergedMessages);
        const repaint = options.forcePaint === true;
        if (messagesChanged || repaint) writeOwnMessages(state, mergedMessages);
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
        if (messagesChanged || repaint) {
          state.requestUpdate?.();
          // In some OpenClaw builds `state` is a plain controller and only
          // the custom element owns Lit's render queue. Request both; the
          // extra call is limited to an actual changed/repainted transcript.
          if (state !== pane) pane.requestUpdate?.();
        }
        // 只有确实有新消息、且用户明确停在底部，才跟随到末尾。未知状态一律
        // 不抢滚动，避免断线恢复把用户正在看的位置弹走。
        const terminalIsVerified = !isBusy(pane) || options.verifiedTerminal;
        const followedReply = terminalIsVerified
          && followTerminalReply(pane, recent.messages);
        if (!followedReply && (messagesChanged || repaint) && terminalIsVerified
            && state.chatUserNearBottom === true) {
          state.scrollToBottom?.({smooth: false});
        }
        window.dispatchEvent(new CustomEvent("pinkie:session-resynced", {
          detail: {sessionKey, reason},
        }));
        // Native terminal events normally drain chatQueue themselves. A
        // dropped final (or a watchdog/tier continuation using a replacement
        // run id) misses that one-shot drain, leaving the composer-side card
        // stranded forever. Once this bounded authoritative history sync says
        // the pane is idle, let the native queue API resume it. The helper
        // re-checks backend idleness and de-duplicates against this history
        // before it ever retries an item.
        if (!isBusy(pane)) scheduleQueueRecovery(pane, `history:${reason}`, recent);
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
    return recovery.promise;
  };

  // A reload can restore an active run while the native chat pane only has
  // its ten-message tail. Read the bounded persisted history and prepend the
  // latest real user turn's missing prefix without replacing the live tail.
  const restoreActiveTimelineBoundary = async (pane, sessionKey) => {
    const state = pane?.state;
    const client = gatewayClient();
    if (!state || !sessionKey || !client || !recoveryTransportAvailable()
        || paneSessionKey(pane) !== sessionKey) return false;
    const runId = timelineRunIds.get(sessionKey) || "";
    const prior = activeTimelineBoundarySyncBySession.get(sessionKey);
    if (prior?.runId === runId && prior.done) return false;
    if (prior?.runId === runId && prior.promise) return prior.promise;
    const sync = {runId, done: false, promise: null};
    activeTimelineBoundarySyncBySession.set(sessionKey, sync);
    sync.promise = (async () => {
      const recent = await fetchRecentHistory(pane, sessionKey, client);
      if (!recent || gatewayClient() !== client || pane.state !== state
          || paneSessionKey(pane) !== sessionKey
          || (pane === activePane() && routedSessionKey() && routedSessionKey() !== sessionKey)) return false;
      // The run may have ended or changed while history was loading.
      if (await backendHasActiveRun(sessionKey) !== true) return false;
      const refreshedRunId = timelineRunIds.get(sessionKey) || "";
      if (runId && refreshedRunId && runId !== refreshedRunId) return false;

      const history = recent.messages;
      const userIndex = history.findLastIndex((message) =>
        String(message?.role || "").toLowerCase() === "user" && isRenderableHistoryMessage(message));
      if (userIndex < 0) return false;
      const turnMessages = history.slice(userIndex);
      const localMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
      const userIdentity = messageIdentity(history[userIndex]);
      if (localMessages.some((message) => messageIdentity(message) === userIdentity)) {
        sync.done = true;
        return false;
      }

      let missingPrefix = turnMessages;
      if (localMessages.length) {
        const localIds = new Set(localMessages.map(messageIdentity).filter(Boolean));
        const overlapIndex = turnMessages.findIndex((message) => {
          const identity = messageIdentity(message);
          return identity && localIds.has(identity);
        });
        // Without an identity shared by the native tail and persisted history,
        // appending could duplicate or reorder an optimistic message.
        if (overlapIndex < 0) return false;
        missingPrefix = turnMessages.slice(0, overlapIndex);
      }
      if (!missingPrefix.some((message) => messageIdentity(message) === userIdentity)) return false;
      const mergedMessages = keepLiveMessages([...missingPrefix, ...localMessages]);
      if (sameMessageSequence(localMessages, mergedMessages)) {
        sync.done = true;
        return false;
      }
      writeOwnMessages(state, mergedMessages);
      if ("chatHistoryPagination" in state) {
        state.chatHistoryPagination = {
          hasMore: false,
          ...(Number.isFinite(recent.totalMessages) ? {totalMessages: recent.totalMessages} : {}),
        };
      }
      historyStatusBySession.set(sessionKey, {
        loadedCount: mergedMessages.length,
        visibleCount: mergedMessages.length,
        totalMessages: recent.totalMessages,
        pageCount: recent.pageCount,
        sessionId: recent.sessionId,
        lastMessageIdentity: messageIdentity(mergedMessages[mergedMessages.length - 1]),
        syncedAt: Date.now(),
        windowed: true,
        activeTurnBoundary: true,
      });
      state.requestUpdate?.();
      if (state !== pane) pane.requestUpdate?.();
      sync.done = true;
      return true;
    })();
    try {
      return await sync.promise;
    } catch {
      // A transient history RPC failure must not turn session selection into
      // an unhandled rejection. The active-run state remains authoritative;
      // the timeline can still render this tail as an orphan process card.
      return false;
    } finally {
      sync.promise = null;
      if (!sync.done && activeTimelineBoundarySyncBySession.get(sessionKey) === sync) {
        activeTimelineBoundarySyncBySession.delete(sessionKey);
      }
    }
  };

  const recoverCurrentChat = async (reason = "unknown", options = {}) => {
    if (!isVisibleChatSurface() || !location.pathname.startsWith("/chat")) return false;
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
  window.__laolaoMessageWindowTestHooks = {guardMessageWindow, keepEarlierMessages, writeOwnMessages};
  window.__laolaoHistoryTestHooks = {
    messageIdentity,
    uniqueMessages,
    isRenderableHistoryMessage,
    mergeRecentHistory,
    keepLatestMessages: keepLiveMessages,
    publishTimelineRunState,
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
    // The watchdog can have completed under a run id the native pane never
    // tracked. Queue recovery independently confirms idle before using the
    // public retry API, so this is safe even if a replacement run just began.
    scheduleQueueRecovery(activePane(), "watchdog-recovered");
  });
  // The native chat pane reports projection rebuilds as an RPC error. The
  // sidebar WebSocket shim forwards that signal here so recovery is armed even
  // when no gateway reconnect or foreground event occurred.
  window.addEventListener("pinkie:history-rebuilding", () => {
    if (!recoveryTimer) scheduleRecovery("history-rebuilding", 250);
  });
  window.addEventListener("pinkie:tier-complete", () => {
    scheduleRecovery("tier-complete", 450);
    scheduleQueueRecovery(activePane(), "tier-complete");
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
  const staleStateBySession = new Map();
  const staleState = (pane) => {
    const sessionKey = paneSessionKey(pane);
    let state = staleStateBySession.get(sessionKey);
    if (!state) {
      state = {sessionKey, busySince: 0, verifyAt: 0,
        softResetAt: 0, inFlight: false};
      staleStateBySession.set(sessionKey, state);
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

  const forceIdleComposerState = (pane = activePane(), {verifiedIdle = false} = {}) => {
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
    // This is normally called after an authoritative inactive-run check.  In
    // that case retain the proof for one paint so a stale Stop element cannot
    // strand the native queue. The explicit console diagnostic deliberately
    // does not set it; recovery will then keep the conservative UI guard.
    if (verifiedIdle) markVerifiedQueueIdle(pane, sessionKey);
    // Queue recovery performs sessions.list again before sending, so this
    // narrow handoff can never race a real replacement run.
    if (!queueRecoveryBusy(pane)) scheduleQueueRecovery(pane, "force-idle");
    return touched;
  };

  // 后端权威判定。返回 false = 确认没有活动 run；true = 有；null = 没查成
  // （网关不在、超时、返回结构不认识）——null 时绝不复位，宁可不动手。
  const backendHasActiveRun = async (sessionKey = currentSessionKey()) => {
    const client = gatewayClient();
    if (!recoveryTransportAvailable()) return null;
    let payload;
    try {
      payload = await requestRecovery("sessions.list", {limit: 1000}, 6000, client);
    } catch {
      return null;
    }
    const sessions = payload?.sessions;
    if (!Array.isArray(sessions)) return null;
    const mine = sessionKey ? sessions.find((s) => s && s.key === sessionKey) : null;
    if (mine) {
      const active = mine.hasActiveRun === true;
      const runId = Array.isArray(mine.activeRunIds) ? mine.activeRunIds.at(-1)
        : (mine.activeRunId || mine.chatRunId || "");
      if (active && typeof runId === "string" && runId) timelineRunIds.set(sessionKey, runId);
      publishTimelineRunState(sessionKey, active);
      return active;
    }
    // A missing row is not proof of inactivity. Never reset another pane.
    return null;
  };

  // ── 排队消息的断线收尾兜底 ──────────────────────────────────────────
  // 原生 chat-page 会在自己收到 terminal event 时调用 lg() 继续 chatQueue。
  // 但 WKWebView 在后台、看门狗换 runId 或档位续跑时，最容易丢的正是这个
  // terminal event。这里不重写发送协议：只把已经没有所属 run 的本地项整理
  // 成原生 retryQueuedChatMessage 能处理的状态，再由原生方法实际发送。
  const QUEUE_STALE_STATE_AFTER_MS = 8_000;
  const QUEUE_RECOVERY_THROTTLE_MS = 900;
  const queueRecoveryByPane = new WeakMap();
  const queueRecoveryTimerByPane = new WeakMap();
  const queueRecoveryAtByPane = new WeakMap();
  const queueRecoveryStatusBySession = new Map();
  const hydratedNativeComposerQueues = new Set();
  // A persisted `failed` item should get one recovery attempt after a reload,
  // but a fresh permanent failure must not turn the idle poll into a retry
  // loop. The set is intentionally page-local: a real reload gets one clean
  // stale-state repair pass again.
  const recoveredFailedQueueItems = new Set();

  const queueTimestampMs = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.abs(value) < 100_000_000_000 ? value * 1_000 : value;
    }
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric;
      }
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const queueForSession = (state, sessionKey) => {
    if (!state || !sessionKey) return [];
    if (state.sessionKey === sessionKey || !state.chatQueueBySession) {
      return Array.isArray(state.chatQueue) ? state.chatQueue : [];
    }
    const saved = state.chatQueueBySession?.[sessionKey];
    return Array.isArray(saved) ? saved : [];
  };

  // Current chat-page normally restores this store while binding a session.
  // On a WebKit reload that bind can already point at the selected session,
  // so its restore hook is skipped and a persisted card becomes invisible.
  // Read only the native store as a one-page fallback, then hand its entries
  // straight back to the native retry/remove actions below. We never issue a
  // second chat.send and never overwrite a live in-memory queue.
  const nativeComposerQueueStoreKey = (state) => {
    const gatewayUrl = String(state?.settings?.gatewayUrl || "").trim() || "default";
    return `openclaw.control.chatComposer.v1:${encodeURIComponent(gatewayUrl).slice(0, 240)}`;
  };
  const nativeComposerAgentId = (state, sessionKey) => {
    // This is the same precedence as the native composer store: the session
    // key owns the agent identity. A selected/default agent can lag one render
    // behind after a reload, and must not make us hydrate another agent's
    // queue into this session.
    const fromSession = /^agent:([^:]+)/.exec(String(sessionKey || ""))?.[1];
    if (fromSession) return fromSession;
    return String(state?.assistantAgentId || state?.agentsList?.defaultId || "main").trim() || "main";
  };
  const hydrateNativeComposerQueue = (pane, sessionKey) => {
    const state = pane?.state;
    if (!state || !sessionKey || queueForSession(state, sessionKey).length) return false;
    const agentId = nativeComposerAgentId(state, sessionKey);
    const hydrationKey = `${sessionKey}\u0000agent:${agentId}`;
    if (hydratedNativeComposerQueues.has(hydrationKey)) return false;
    hydratedNativeComposerQueues.add(hydrationKey);
    let saved;
    try {
      const raw = window.localStorage?.getItem(nativeComposerQueueStoreKey(state));
      saved = raw ? JSON.parse(raw) : null;
    } catch { return false; }
    const entries = saved?.version === 1 ? saved.sessions?.[hydrationKey]?.queue : null;
    if (!Array.isArray(entries) || !entries.length) return false;
    const restored = entries.filter((entry) => entry && typeof entry.id === "string"
      && (String(entry.text || "").trim() || Array.isArray(entry.attachments))
      && (!entry.sessionKey || entry.sessionKey === sessionKey)).map((entry) => ({...entry,
        sessionKey: entry.sessionKey || sessionKey,
        agentId: entry.agentId || agentId,
      }));
    if (!restored.length) return false;
    state.chatQueue = restored;
    state.requestUpdate?.();
    if (state !== pane) pane.requestUpdate?.();
    return true;
  };

  const replaceQueueForSession = (pane, sessionKey, nextQueue) => {
    const state = pane?.state;
    if (!state || !sessionKey) return false;
    const items = Array.isArray(nextQueue) ? nextQueue : [];
    if (state.sessionKey === sessionKey || !state.chatQueueBySession) {
      state.chatQueue = items;
    } else {
      const bySession = {...(state.chatQueueBySession || {})};
      if (items.length) bySession[sessionKey] = items;
      else delete bySession[sessionKey];
      state.chatQueueBySession = bySession;
    }
    // state.requestUpdate is the native controller wrapper, which also
    // persists chatQueue. Never touch the queue card's Lit DOM directly.
    state.requestUpdate?.();
    if (state !== pane) pane.requestUpdate?.();
    return true;
  };

  const nativeQueueMethod = (pane, name) => {
    const candidates = [pane, pane?.state, pane?.controller, pane?.chatController];
    for (const owner of candidates) {
      if (typeof owner?.[name] === "function") return owner[name].bind(owner);
    }
    return null;
  };

  const queueItemText = (item) => String(item?.text || "").trim();
  const queueItemCreatedAt = (item) => queueTimestampMs(item?.createdAt);
  const queueItemAttachmentCount = (item) => Array.isArray(item?.attachments)
    ? item.attachments.filter(Boolean).length
    : 0;
  const historyMessageAt = (message) => queueTimestampMs(
    message?.timestamp ?? message?.ts ?? message?.createdAt
  );
  const historyAttachmentCount = (message) => {
    const direct = [message?.attachments, message?.media, message?.MediaPaths]
      .filter(Array.isArray)
      .reduce((largest, entries) => Math.max(largest, entries.filter(Boolean).length), 0);
    if (direct) return direct;
    if (typeof message?.MediaPath === "string" && message.MediaPath.trim()) return 1;
    if (!Array.isArray(message?.content)) return 0;
    return message.content.filter((part) => part && typeof part === "object"
      && !["text", "input_text", "output_text", "thinking", "reasoning"].includes(part.type)).length;
  };
  const historyIdempotencyKey = (message) => String(
    message?.idempotencyKey ?? message?.__openclaw?.idempotencyKey
      ?? message?.metadata?.idempotencyKey ?? message?.meta?.idempotencyKey ?? ""
  ).trim();
  const queueItemMatchesHistoryMessage = (item, message) => {
    if (String(message?.role || "").toLowerCase() !== "user") return false;
    const runId = String(item?.sendRunId || "").trim();
    // Native retry stores sendRunId and the gateway persists it as
    // `${sendRunId}:user`. This is stronger than matching text (and is the
    // only reliable confirmation for a pure attachment send).
    if (runId) return historyIdempotencyKey(message) === `${runId}:user`;

    const createdAt = queueItemCreatedAt(item);
    if (!createdAt || historyMessageAt(message) < createdAt) return false;
    const text = queueItemText(item);
    const attachmentCount = queueItemAttachmentCount(item);
    if (text && messageText(message).trim() !== text) return false;
    // A text-only historical message must never consume a queued image/file
    // with the same caption. For attachment-only steers this conservative
    // shape comparison is the best proof available after native acknowledgement.
    if (attachmentCount && historyAttachmentCount(message) < attachmentCount) return false;
    return Boolean(text || attachmentCount);
  };
  const queueItemArrivedInHistory = (item, messages) => {
    return Array.isArray(messages) && messages.some((message) =>
      queueItemMatchesHistoryMessage(item, message));
  };
  // Do not let one user history row consume several same-text queue cards.
  // Messages and cards are paired oldest-first, which mirrors their native
  // insertion order and preserves deliberately repeated user instructions.
  const deliveredQueueItemIds = (items, messages) => {
    if (!Array.isArray(items) || !Array.isArray(messages)) return new Set();
    const orderedItems = items.map((item, index) => ({item, index})).sort((left, right) =>
      (queueItemCreatedAt(left.item) - queueItemCreatedAt(right.item)) || left.index - right.index);
    const orderedMessages = messages.map((message, index) => ({message, index})).filter(({message}) =>
      String(message?.role || "").toLowerCase() === "user").sort((left, right) =>
      (historyMessageAt(left.message) - historyMessageAt(right.message)) || left.index - right.index);
    const usedMessages = new Set();
    const delivered = new Set();
    const pair = (item) => {
      if (!item?.id) return;
      const matchIndex = orderedMessages.findIndex(({message}, index) => !usedMessages.has(index)
        && queueItemMatchesHistoryMessage(item, message));
      if (matchIndex < 0) return;
      usedMessages.add(matchIndex);
      delivered.add(item.id);
    };
    // A normal native retry has a durable sendRunId. Reserve those exact
    // idempotency matches before an earlier steered card with the same text
    // gets a chance to use payload fallback.
    for (const {item} of orderedItems) {
      if (String(item?.sendRunId || "").trim()) pair(item);
    }
    for (const {item} of orderedItems) {
      if (!String(item?.sendRunId || "").trim()) pair(item);
    }
    return delivered;
  };

  const queueItemActivityAt = (item) => Math.max(
    queueTimestampMs(item?.sendRequestStartedAtMs),
    queueTimestampMs(item?.sendSubmittedAtMs),
    queueItemCreatedAt(item)
  );
  const queueItemStateIsStale = (item, now = Date.now()) => {
    const at = queueItemActivityAt(item);
    return !at || now - at >= QUEUE_STALE_STATE_AFTER_MS;
  };
  const queueRecoveryKey = (sessionKey, item) => `${sessionKey}:${String(item?.id || "")}`;
  const queueItemNeedsRecovery = (sessionKey, item, now) => {
    if (!item || item.localCommandName) return false;
    // A steer accepted/in-flight item is deliberately pending only while its
    // tracked run exists. The caller has already confirmed the session idle.
    if (item.pendingRunId || item.kind === "steered") return true;
    // This state is only assigned to a message that was queued behind a live
    // model turn; once sessions.list confirms no run it is immediately safe
    // to hand back to native retry (no arbitrary 8s wait for a lost final).
    if (item.sendState === "waiting-model") return true;
    const blocked = ["sending", "waiting-model", "failed"].includes(item.sendState);
    if (!blocked || !queueItemStateIsStale(item, now)) return false;
    return item.sendState !== "failed"
      || !recoveredFailedQueueItems.has(queueRecoveryKey(sessionKey, item));
  };
  const normalizeQueuedItem = (sessionKey, item) => {
    if (item.sendState === "failed") recoveredFailedQueueItems.add(queueRecoveryKey(sessionKey, item));
    const {pendingRunId, sendError, sendRequestStartedAtMs, kind, ...rest} = item;
    return {
      ...rest,
      // Native retry accepts waiting-reconnect, while its own send routine
      // immediately promotes it to sending when the socket is usable.
      sendState: "waiting-reconnect",
      ...(kind === "steered" ? {kind: "queued"} : kind ? {kind} : {}),
    };
  };

  const publishQueueRecoveryStatus = (sessionKey, detail) => {
    const status = {sessionKey, at: Date.now(), ...detail};
    queueRecoveryStatusBySession.set(sessionKey, status);
    window.dispatchEvent(new CustomEvent("pinkie:queue-recovered", {detail: status}));
  };

  const resumeQueuedChatMessages = async (pane = activePane(), reason = "unknown", options = {}) => {
    const state = pane?.state;
    const sessionKey = paneSessionKey(pane);
    if (!state || !sessionKey || !gatewayConnected() || !recoveryTransportAvailable()
        || queueRecoveryBusy(pane)) return false;
    if (pane === activePane() && routedSessionKey() && routedSessionKey() !== sessionKey) return false;
    if (pane.sessionKey && pane.sessionKey !== sessionKey) return false;
    let currentQueue = queueForSession(state, sessionKey);
    if (!currentQueue.length) {
      hydrateNativeComposerQueue(pane, sessionKey);
      currentQueue = queueForSession(state, sessionKey);
    }
    if (!currentQueue.length) return false;
    const inFlight = queueRecoveryByPane.get(pane);
    if (inFlight?.sessionKey === sessionKey) return inFlight.promise;
    const now = Date.now();
    const last = queueRecoveryAtByPane.get(pane);
    if (!options.force && last?.sessionKey === sessionKey
        && now - last.at < QUEUE_RECOVERY_THROTTLE_MS) return false;
    queueRecoveryAtByPane.set(pane, {sessionKey, at: now});
    const recovery = {sessionKey, promise: Promise.resolve(false)};
    queueRecoveryByPane.set(pane, recovery);
    recovery.promise = (async () => {
      let removed = 0;
      let normalized = 0;
      let retriedId = null;
      try {
        // A local empty composer is not enough: only the authoritative list
        // permits a retry. This protects a watchdog/tier continuation that
        // has just started a replacement run.
        if (await backendHasActiveRun(sessionKey) !== false || queueRecoveryBusy(pane)) return false;
        const recent = options.recent || await fetchRecentHistory(pane, sessionKey, gatewayClient());
        if (!recent || paneSessionKey(pane) !== sessionKey || queueRecoveryBusy(pane)) return false;
        // chat.history is async; refuse to send if a new run appeared while
        // it was loading, otherwise a queued note could land in the wrong turn.
        if (await backendHasActiveRun(sessionKey) !== false || queueRecoveryBusy(pane)) return false;

        let items = queueForSession(state, sessionKey);
        const remove = nativeQueueMethod(pane, "removeQueuedMessage");
        const deliveredIds = deliveredQueueItemIds(items, recent.messages);
        const delivered = items.filter((item) => deliveredIds.has(item?.id));
        // Never fall through and retry a confirmed-delivered item if an
        // upstream bundle changed the public remove method. Keeping its card
        // is preferable to manufacturing a duplicate user message.
        if (delivered.length && !remove) return false;
        if (delivered.length) {
          for (const item of delivered) {
            await Promise.resolve(remove(item.id));
            recoveredFailedQueueItems.delete(queueRecoveryKey(sessionKey, item));
            removed += 1;
          }
          items = queueForSession(state, sessionKey);
          if (items.some((item) => deliveredIds.has(item?.id))) return false;
        }

        const recoveryNow = Date.now();
        const next = items.map((item) => {
          if (!queueItemNeedsRecovery(sessionKey, item, recoveryNow)) return item;
          normalized += 1;
          return normalizeQueuedItem(sessionKey, item);
        });
        if (normalized) {
          replaceQueueForSession(pane, sessionKey, next);
          items = queueForSession(state, sessionKey);
        }

        const candidate = items.find((item) => !item?.localCommandName && !item?.pendingRunId
          && !["sending", "waiting-model", "failed"].includes(item?.sendState));
        const retry = nativeQueueMethod(pane, "retryQueuedChatMessage");
        if (candidate && retry && !queueRecoveryBusy(pane)) {
          retriedId = candidate.id;
          await Promise.resolve(retry(candidate.id));
        }
        const changed = removed > 0 || normalized > 0 || Boolean(retriedId);
        if (changed) publishQueueRecoveryStatus(sessionKey, {
          reason, removed, normalized, retriedId,
        });
        return changed;
      } catch (error) {
        publishQueueRecoveryStatus(sessionKey, {
          reason, removed, normalized, retriedId,
          error: String(error?.message || error),
        });
        return false;
      } finally {
        if (queueRecoveryByPane.get(pane) === recovery) queueRecoveryByPane.delete(pane);
      }
    })();
    return recovery.promise;
  };

  const scheduleQueueRecovery = (pane = activePane(), reason = "unknown", recent = null) => {
    if (!pane || queueRecoveryTimerByPane.has(pane)) return false;
    const timer = window.setTimeout(() => {
      queueRecoveryTimerByPane.delete(pane);
      void resumeQueuedChatMessages(pane, reason, {recent});
    }, 80);
    queueRecoveryTimerByPane.set(pane, timer);
    return true;
  };

  // A queue item behind a run is a stronger signal than an ordinary stale
  // spinner: its author is waiting for a concrete next step.  Do not make it
  // wait out the 25-second generic stale-busy grace when the gateway already
  // authoritatively says the *tracked* run is gone.  We deliberately require
  // chatRunId here (not merely chatSending), so a just-submitted new turn can
  // never be cleared in the small interval before the gateway records it.
  const queuedBusyIdleProbeByPane = new WeakMap();
  const QUEUED_BUSY_IDLE_PROBE_MS = 850;
  const reconcileQueuedBusyIdle = async (pane = activePane()) => {
    const state = pane?.state;
    const sessionKey = paneSessionKey(pane);
    const trackedRunId = String(state?.chatRunId || "").trim();
    if (!state || !sessionKey || !trackedRunId || !isBusy(pane)
        || !queueForSession(state, sessionKey).some((item) => item && !item.localCommandName)) return false;
    const prior = queuedBusyIdleProbeByPane.get(pane);
    const now = Date.now();
    if (prior?.inFlight || (prior?.at && now - prior.at < QUEUED_BUSY_IDLE_PROBE_MS)) return false;
    const probe = {at: now, inFlight: true};
    queuedBusyIdleProbeByPane.set(pane, probe);
    try {
      // A watchdog/tier replacement makes this true, so it is never mistaken
      // for the end of the old UI run. Only an explicit false may clear it.
      if (await backendHasActiveRun(sessionKey) !== false
          || paneSessionKey(pane) !== sessionKey || String(state.chatRunId || "").trim() !== trackedRunId) {
        return false;
      }
      forceIdleComposerState(pane, {verifiedIdle: true});
      // forceIdle schedules this too; the coalescer keeps the single native
      // retry pass. Calling it here documents the required queue handoff when
      // this path is reached from sessions.list rather than a terminal event.
      scheduleQueueRecovery(pane, "queued-run-ended");
      return true;
    } finally {
      if (queuedBusyIdleProbeByPane.get(pane) === probe) {
        queuedBusyIdleProbeByPane.set(pane, {at: now, inFlight: false});
      }
    }
  };

  const queueRecoveryTarget = (paneOrReason, maybeReason) => {
    const pane = paneOrReason && typeof paneOrReason === "object" && paneOrReason.state
      ? paneOrReason
      : activePane();
    const reason = typeof paneOrReason === "string"
      ? paneOrReason
      : (typeof maybeReason === "string" ? maybeReason : "manual");
    return {pane, reason};
  };
  window.__laolaoQueueRecovery = {
    // `recover(pane, reason)` is useful to the busy-send steering layer,
    // while `recover(reason)` remains convenient from the console/tests.
    recover: (paneOrReason = "manual", maybeReason) => {
      const {pane, reason} = queueRecoveryTarget(paneOrReason, maybeReason);
      return resumeQueuedChatMessages(pane, reason, {force: true});
    },
    schedule: (paneOrReason = "manual", maybeReason) => {
      const {pane, reason} = queueRecoveryTarget(paneOrReason, maybeReason);
      return scheduleQueueRecovery(pane, reason);
    },
    status: (sessionKey = currentSessionKey()) => queueRecoveryStatusBySession.get(sessionKey) || null,
    isDelivered: queueItemArrivedInHistory,
  };

  // A watchdog retry can finish under a new run id after the native pane has
  // stopped listening to the original run. In that case the composer looks
  // idle and the tool card stays behind, even though chat.history has a final.
  // Independently compare the server tail every few seconds. Only the exact
  // session's persisted terminal reply, combined with hasActiveRun=false, may
  // replace local state; this never sends another prompt or aborts a live run.
  const TERMINAL_PROBE_MS = 5_000;
  const terminalProbeAtBySession = new Map();
  const terminalProbeInFlight = new Set();
  const terminalProbeStatusBySession = new Map();
  const reconcilePersistedFinal = async (pane = activePane()) => {
    const key = paneSessionKey(pane);
    if (!key || !pane?.state || !recoveryTransportAvailable()
        || !location.pathname.startsWith("/chat")) return false;
    if (pane === activePane() && routedSessionKey() && routedSessionKey() !== key) return false;
    if (pane.sessionKey && pane.sessionKey !== key) return false;
    // A painted local assistant can be the *previous* turn. The native pane
    // sometimes renders the new user bubble/tool card outside chatMessages,
    // leaving that old assistant as the array tail. Never conclude the server
    // has no newer final from local paint alone; compare the server tail.
    const now = Date.now();
    const lastProbeAt = terminalProbeAtBySession.get(key);
    if (terminalProbeInFlight.has(key)
        || (Number.isFinite(lastProbeAt) && now - lastProbeAt < TERMINAL_PROBE_MS)) return false;
    terminalProbeAtBySession.set(key, now);
    terminalProbeInFlight.add(key);
    try {
      const backendActive = await backendHasActiveRun(key);
      if (backendActive !== false || paneSessionKey(pane) !== key) return false;
      const recent = await fetchRecentHistory(pane, key, gatewayClient());
      if (!recent) return false;
      const final = recent.messages.at(-1);
      if (String(final?.role || "").toLowerCase() !== "assistant"
          || final?.stopReason === "toolUse" || !messageText(final).trim()) return false;
      const current = pane.state?.chatMessages?.at(-1);
      const sameFinal = messageIdentity(current) === messageIdentity(final);
      if (sameFinal && !isBusy(pane) && terminalPainted(pane, final)) {
        // The renderer can already have painted the persisted final while the
        // one native terminal callback that drains chatQueue was lost. The
        // transcript needs no repaint, but the idle queue still needs its
        // authoritative dedupe-and-native-retry pass.
        scheduleQueueRecovery(pane, "persisted-terminal-already-painted", recent);
        return false;
      }
      // Do not replace an optimistic user send with an older terminal reply.
      const currentAt = Date.parse(String(current?.timestamp || current?.ts || ""))
        || Number(current?.timestamp || current?.ts) || 0;
      const finalAt = Date.parse(String(final?.timestamp || final?.ts || ""))
        || Number(final?.timestamp || final?.ts) || 0;
      if (currentAt && finalAt && finalAt < currentAt) return false;
      const freshRunAt = Number(pane.state?.chatRunStatus?.occurredAt) || 0;
      if (freshRunAt && now - freshRunAt < 10_000) return false;
      if (paneSessionKey(pane) !== key || (pane === activePane()
          && routedSessionKey() && routedSessionKey() !== key)) return false;
      // A new turn could have started while chat.history was loading. Confirm
      // that the backend is still idle before overriding a native busy flag.
      if (await backendHasActiveRun(key) !== false) return false;
      if (isBusy(pane)) forceIdleComposerState(pane, {verifiedIdle: true});
      // A completed tool turn can leave transient tool/stream records in the
      // native renderer even after chatRunId has cleared. Those records can
      // mask the newly persisted assistant final. They are not transcript
      // history, so clear them only after the backend confirms this run ended.
      const state = pane.state;
      const staleToolStream = Boolean(state?.chatToolMessages?.length
        || state?.chatStreamSegments?.length);
      if (staleToolStream) {
        state.resetToolStream?.();
        state.chatToolMessages = [];
        state.chatStreamSegments = [];
      }
      const restored = await recoverPaneChat(pane, "persisted-terminal", {
        manual: true,
        verifiedTerminal: true,
        forcePaint: sameFinal || staleToolStream,
        recent,
      });
      terminalProbeStatusBySession.set(key, {
        checkedAt: now, restored, finalIdentity: messageIdentity(final),
      });
      return restored;
    } catch (error) {
      terminalProbeStatusBySession.set(key, {
        checkedAt: now, error: String(error?.message || error),
      });
      return false;
    } finally {
      terminalProbeInFlight.delete(key);
    }
  };
  window.__laolaoTerminalSync = {
    reconcile: () => reconcilePersistedFinal(),
    status: () => terminalProbeStatusBySession.get(currentSessionKey()) || null,
  };

  const reconcileStaleBusy = async (pane = activePane()) => {
    if (!pane) return;
    const key = paneSessionKey(pane);
    const stale = staleState(pane);
    const now = Date.now();
    if (stale.inFlight || !staleBusyEnabled()) return;
    if (!isVisibleChatSurface() || !location.pathname.startsWith("/chat")) return;
    // The ribbon can remain "retrying" after the socket has recovered. Its
    // label is not an authoritative connection state; using it here made a
    // completed backend turn permanently look busy in a single pane too.
    if (!recoveryTransportAvailable()) return;

    if (!isBusy(pane)) {
      stale.busySince = 0;
      stale.softResetAt = 0;
      // An idle pane can be the aftermath of a missed terminal event. Do not
      // infer delivery from the local state: queue recovery checks the server
      // tail first and only then calls the native retry method.
      scheduleQueueRecovery(pane, "idle-observed");
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
      const touched = forceIdleComposerState(pane, {verifiedIdle: true});
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
    reconcileQueued: () => reconcileQueuedBusyIdle(),
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
        // A page reload loses the previous lifecycle events. Read the current
        // run state so a restored card is live only while the gateway says so.
        const backendActive = await backendHasActiveRun(key);
        if (revision !== selectedSessionRevision || routedSessionKey() !== key) return false;
        if (backendActive === true) {
          await restoreActiveTimelineBoundary(pane, key);
          return false;
        }
        if (isBusy(pane)) {
          if (backendActive !== false) return false; // Unknown or genuine run: never clear it.
          forceIdleComposerState(pane, {verifiedIdle: true});
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
    for (const pane of chatPanes()) {
      guardMessageWindow(pane?.state);
      observedPaneKeys.set(pane, paneSessionKey(pane));
      // Covers the selected-session reload path where native composer
      // hydration is skipped because there was no visible session transition.
      if (!isBusy(pane)) scheduleQueueRecovery(pane, "composer-hydration");
    }
    void syncSelectedSession(observedSessionKey);
    window.setInterval(() => {
      // A replaced native pane brings a new state object; guard it right away.
      for (const pane of chatPanes()) guardMessageWindow(pane?.state);
      if (!isVisibleChatSurface() || !location.pathname.startsWith("/chat")) return;
      reconcileSelectedSession();
      const sessionKey = currentSessionKey();
      if (sessionKey && sessionKey !== observedSessionKey) {
        observedSessionKey = sessionKey;
        void syncSelectedSession(sessionKey);
      }
      // A stale retry ribbon must not stop the idle tail poll or stale-busy
      // reconciliation. Only the actual gateway connection can block them.
      const waitingForGateway = !recoveryTransportAvailable();
      for (const pane of chatPanes()) {
        const key = paneSessionKey(pane);
        const state = pane.state;
        if (!key || !state || (pane.sessionKey && pane.sessionKey !== key)) continue;
        if (observedPaneKeys.get(pane) !== key) {
          observedPaneKeys.set(pane, key);
          scheduleRecovery("pane-session-changed", 250);
        }
        // Native history can briefly remount a larger page. Keep each pane's
        // bounded timeline window independent; one busy pane must not block another.
        if (Array.isArray(state.chatMessages) && state.chatMessages.length > LIVE_MESSAGE_WINDOW
            && !isBusy(pane)) {
          writeOwnMessages(state, keepLiveMessages(state.chatMessages));
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
        // A queued message behind a run gets a fast, authoritative idle
        // check; the generic stale-spinner path remains the broader fallback.
        void reconcileQueuedBusyIdle(pane);
        void reconcileStaleBusy(pane);
      }
      if (!document.querySelector(".agent-chat__composer-combobox textarea")) scheduleRecovery("composer-missing", 300);
    }, 1000);
  }, 400);

  // This timer is intentionally separate from the ordinary idle poll: WebKit
  // may report a visible chat as hidden, and a stale native busy flag can
  // suppress normal history recovery indefinitely after a watchdog retry.
  window.setInterval(() => {
    if (!location.pathname.startsWith("/chat")) return;
    const panes = chatPanes();
    for (const pane of panes) void reconcilePersistedFinal(pane);
  }, TERMINAL_PROBE_MS);

  // The new injection itself is network-first, so it can evict an older
  // cache-first native chat bundle without replaying the current screen.
  window.setTimeout(() => void refreshStaleControlUiCache(), 80);

  // Process recovery and WebSocket recovery are separate layers. Poll the
  // lightweight local ready endpoint frequently enough to catch a recovered
  // gateway whose old page client is still stuck in an invalid handshake.
  window.setInterval(() => void probeReadyForSocketRecovery(), 750);

  // ── 聊天面板渲染自愈 ────────────────────────────────────────────────
  // Lit writes each text binding after a comment marker it placed in the DOM.
  // If a script deletes those nodes (e.g. by assigning textContent to a native
  // label), the next change of that binding throws inside the chat pane's
  // render. Lit then skips every later binding and the pane's `updated` hooks:
  // the finished reply is neither committed nor scrolled into view, and every
  // further render fails the same way until the app is reopened. None of the
  // history recovery above can help, because state is already correct.
  // Rebuild only the pane's DOM from its intact state instead.
  const PANE_REBUILD_MIN_INTERVAL_MS = 5_000;
  const paneRebuildAt = new WeakMap();
  const hasDetachedLitMarkers = (pane) => {
    const root = pane?.renderRoot;
    const pending = [root?._$litPart$];
    for (let visited = 0; pending.length && visited < 20_000; visited += 1) {
      const part = pending.pop();
      if (!part || part._$AA === undefined) continue;
      if (!part._$AA.isConnected) return true;
      const value = part._$AH;
      if (value != null && typeof value !== "object" && typeof value !== "function"
          && typeof value !== "symbol" && part._$AA.nextSibling?.nodeType !== 3) return true;
      if (Array.isArray(value)) pending.push(...value);
      else if (Array.isArray(value?._$AV)) pending.push(...value._$AV);
    }
    return false;
  };
  const guardChatPaneRender = (Pane) => {
    const proto = Pane?.prototype;
    if (!proto || typeof proto.update !== "function" || proto.__laolaoRenderGuard) return;
    const update = proto.update;
    proto.update = function (changed) {
      try {
        return update.call(this, changed);
      } catch (error) {
        const root = this.renderRoot;
        const last = paneRebuildAt.get(this) || 0;
        if (!root?._$litPart$ || Date.now() - last < PANE_REBUILD_MIN_INTERVAL_MS
            || !hasDetachedLitMarkers(this)) throw error;
        paneRebuildAt.set(this, Date.now());
        const state = this.state;
        const followTail = state?.chatUserNearBottom !== false;
        const composerFocused = root.contains?.(document.activeElement)
          && document.activeElement?.matches?.(".agent-chat__composer-combobox textarea");
        console.warn("[laolao] chat pane render hit detached Lit markers; rebuilding its DOM", error);
        root._$litPart$.setConnected?.(false);
        delete root._$litPart$;
        root.replaceChildren();
        if (this.renderOptions?.renderBefore) this.renderOptions.renderBefore = null;
        const result = update.call(this, changed);
        window.requestAnimationFrame(() => {
          if (followTail) state?.scrollToBottom?.({smooth: false});
          if (composerFocused) document.querySelector(".agent-chat__composer-combobox textarea")?.focus?.();
        });
        window.dispatchEvent(new CustomEvent("pinkie:chat-pane-rebuilt", {
          detail: {sessionKey: paneSessionKey(this), error: String(error?.message || error)},
        }));
        return result;
      }
    };
    proto.__laolaoRenderGuard = true;
  };
  window.customElements?.whenDefined?.("openclaw-chat-pane")
    .then(() => guardChatPaneRender(window.customElements.get("openclaw-chat-pane")))
    .catch(() => {});
  window.__laolaoRenderGuardTestHooks = {hasDetachedLitMarkers, guardChatPaneRender};

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
