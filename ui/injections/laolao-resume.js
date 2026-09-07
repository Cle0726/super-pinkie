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
  const gatewayConnected = () => Boolean(gatewaySnapshot()?.connected && gatewayClient());

  const withTimeout = (promise, timeoutMs = 15000) => {
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

  const assistantText = (message) => {
    if (!message || String(message.role || "").toLowerCase() !== "assistant") return "";
    if (typeof message.text === "string") return message.text.trim();
    if (typeof message.content === "string") return message.content.trim();
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part) => part && (part.type === "text" || typeof part.text === "string"))
        .map((part) => String(part.text || ""))
        .join("\n")
        .trim();
    }
    return "";
  };

  const hasAssistantReply = (messages) => Array.isArray(messages)
    && messages.some((message) => assistantText(message));

  const directHistory = async (sessionKey) => {
    const client = gatewayClient();
    if (!client || !gatewayConnected() || !sessionKey) return null;
    const parsedAgent = String(sessionKey).match(/^agent:([^:]+):/);
    const params = {
      sessionKey,
      limit: 1000,
      ...(parsedAgent?.[1] ? {agentId: parsedAgent[1]} : {}),
    };
    return withTimeout(client.request("chat.history", params), 15000);
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

  // 只清除我们自己的视觉标记。原生生成状态只能靠网关快照收敛；任何
  // 自动 stop/cancel 都可能终止仍在跑的模型或工具链。
  const clearVisualBusyState = () => {
    document.documentElement.removeAttribute("data-laolao-streaming");
  };

  // 只读刷新会话列表。正文恢复不能靠 sessions.list；正文必须走原生
  // chat pane 的 refreshCurrentChat（内部会调用 chat.history）。
  const refreshSession = async () => {
    const client = gatewayClient();
    if (!client || !gatewayConnected()) return;
    try {
      await withTimeout(client.request("sessions.list", {limit: 1000}), 12000);
    } catch {}
  };

  let recoveryInFlight = null;
  let recoveryTimer = null;
  let lastRecoveryAt = 0;
  let recoveryGeneration = 0;
  let historyRebuildRetryAttempt = 0;

  const scheduleRecovery = (reason, delayMs = 1200) => {
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
    if (!options.force && now - lastRecoveryAt < 1200) return false;
    if (recoveryInFlight) return recoveryInFlight;
    lastRecoveryAt = now;
    const generation = ++recoveryGeneration;
    recoveryInFlight = (async () => {
      try {
        if (typeof state.refreshCurrentChat === "function") {
          await withTimeout(state.refreshCurrentChat(), 20000);
        } else {
          // 兼容旧版控制台：至少确认权威 history 已经可读；新版本会
          // 通过上面的原生方法把它写回 Lit 状态。
          await directHistory(sessionKey);
        }
        if (generation !== recoveryGeneration) return false;
        historyRebuildRetryAttempt = 0;
        state.requestUpdate?.();
        // 历史已经恢复后才滚到底部；用户正在查看旧消息时不抢滚动位置。
        if (!isBusy() && state.chatUserNearBottom !== false) {
          state.scrollToBottom?.({smooth: false});
        }
        window.dispatchEvent(new CustomEvent("pinkie:session-resynced", {
          detail: {sessionKey, reason},
        }));
        return true;
      } catch (error) {
        // chat.history intentionally returns UNAVAILABLE while OpenClaw is
        // rebuilding its SQLite transcript projection. Do not swallow that
        // state: retry with bounded backoff so the just-sent user message and
        // the eventual assistant reply reappear without reloading the app.
        if (isHistoryRebuildingError(error)) {
          historyRebuildRetryAttempt = Math.min(historyRebuildRetryAttempt + 1, 6);
          const delay = Math.min(8_000, 350 * (2 ** Math.max(0, historyRebuildRetryAttempt - 1)));
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

  // 档位控制器的续跑由本机网关发起，结束事件有时不经过当前 WKWebView
  // 的 websocket。直接触发原生聊天页自己的“刷新”动作，既不重载页面，
  // 也不会重播开屏或丢失输入框草稿。
  const refreshVisibleChat = async () => {
    await recoverCurrentChat("manual-refresh", {force: true});
    if (!recoveryInFlight) await refreshSession();
  };
  window.__laolaoRefreshCurrentChat = refreshVisibleChat;

  // 回前台主流程
  const onForeground = () => {
    // 延迟策略: 当前 busy → 等重连窗口再刷新; 否则快速刷新。
    const delay = isBusy() ? 1800 : 400;
    // 给网关前端自己的重连逻辑一点时间。只读同步，不发送 chat.abort。
    window.setTimeout(async () => {
      await recoverCurrentChat("foreground", {force: true});
      if (!recoveryInFlight) await refreshSession();
    }, delay);
  };

  // 上游失败卡出现时，清理自定义动画并重拉权威快照。失败续接完全交给
  // 网关看门狗，前端不再模拟停止。
  let failureRecoveryTimer = null;
  const onRunFailure = () => {
    clearTimeout(failureRecoveryTimer);
    clearVisualBusyState();
    void recoverCurrentChat("run-failed", {force: true});
    failureRecoveryTimer = window.setTimeout(async () => {
      await recoverCurrentChat("run-failed-retry", {force: true});
    }, 700);
  };
  window.addEventListener("pinkie:run-failed", onRunFailure);
  // The native chat pane reports projection rebuilds as an RPC error. The
  // sidebar WebSocket shim forwards that signal here so recovery is armed even
  // when no gateway reconnect or foreground event occurred.
  window.addEventListener("pinkie:history-rebuilding", () => {
    if (!recoveryTimer && !recoveryInFlight) scheduleRecovery("history-rebuilding", 250);
  });
  window.addEventListener("pinkie:tier-complete", () => {
    void recoverCurrentChat("tier-complete", {force: true});
    window.setTimeout(() => void recoverCurrentChat("tier-complete-retry", {force: true}), 900);
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
  window.setTimeout(() => {
    window.setInterval(() => {
      if (document.hidden || !location.pathname.startsWith("/chat")) return;
      if (!document.querySelector(".agent-chat__composer-combobox textarea")) scheduleRecovery("composer-missing", 300);
    }, 5000);
  }, 8000);

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
    let wasConnected = Boolean(gateway.snapshot?.connected);
    let previousClient = gateway.snapshot?.client || null;
    const unsubscribe = gateway.subscribe((snapshot) => {
      const connected = Boolean(snapshot?.connected && snapshot?.client);
      const clientChanged = Boolean(snapshot?.client && snapshot.client !== previousClient);
      if (!connected) {
        wasConnected = false;
        previousClient = snapshot?.client || null;
        clearVisualBusyState();
        return;
      }
      if (!wasConnected || clientChanged) {
        wasConnected = true;
        previousClient = snapshot.client;
        window.dispatchEvent(new CustomEvent("pinkie:gateway-reconnected"));
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
  // 30s 兜底：无论如何不再永久监听
  window.setTimeout(() => readyObserver.disconnect(), 30000);
  hookWhenReady();
  window.addEventListener("load", () => window.setTimeout(hookWhenReady, 500), {
    once: true,
  });
})();
