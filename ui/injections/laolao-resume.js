(() => {
  "use strict";
  // laolao-resume: WKWebView 后台挂起断线恢复
  //
  // 问题: App 切后台时 macOS 挂起 WKWebView 的 JS/网络, 网关 websocket
  // 悄悄断开 (code=1006)。"回复完成"等事件在断线窗口内丢失, 前端状态
  // 停在"生成中" (思考动画), 输入被锁死, 什么都点不了。
  //
  // 方案 (多层兜底):
  // 1. 监听前后台事件 + visibilitychange + pageshow, 回前台时复位。
  // 2. 断线时 (gateway onClose) 立即复位, 不等回前台。
  // 3. 周期性健康检查: 每 15s 检查是否"显示忙碌但网关已断/无活动",
  //    自动清理卡死状态 (覆盖通知事件全部丢失的情况)。
  // 复位动作: chat.abort 停掉悬挂 run → 刷新会话/历史 → 派发事件。

  const $ = (sel) => document.querySelector(sel);

  const gatewayClient = () =>
    document.querySelector("openclaw-app-shell")?.context?.gateway || null;

  const currentSessionKey = () => {
    const routed = new URLSearchParams(window.location.search).get("session") || "";
    if (routed) return routed;
    const activeRow = document.querySelector(
      ".sidebar-recent-session--active[data-session-key]"
    );
    if (activeRow?.dataset.sessionKey) return activeRow.dataset.sessionKey;
    return gatewayClient()?.snapshot?.sessionKey || "";
  };

  // 是否有"正在生成"迹象 (思考动画 / 流式 / 停止按钮可见)
  const hasBusyUI = () => {
    if (document.documentElement.getAttribute("data-laolao-streaming") === "true")
      return true;
    // openclaw 的 reading-indicator (思考动画) 存在且在屏幕上
    const reading = document.querySelector(
      ".reading-indicator, [class*='reading-indicator'], .agent-chat__thinking, [class*='typing-indicator']"
    );
    if (reading && reading.offsetParent !== null) return true;
    // 停止按钮可见 = 前端认为有 run 在跑
    const stop = document.querySelector(
      '[aria-label*="停止"], [aria-label*="Stop"], [data-testid*="stop"], .chat-composer__stop'
    );
    if (stop && stop.offsetParent !== null) return true;
    // 发送按钮被禁用 = 锁定输入
    const send = document.querySelector(
      '[aria-label*="发送"], [aria-label*="Send"], [data-testid*="send"]'
    );
    if (send && send.disabled) return true;
    return false;
  };

  // 网关是否已连接
  const gatewayConnected = () => {
    const g = gatewayClient();
    if (!g) return null; // shell 未就绪, 无法判断
    if (typeof g.connected === "boolean") return g.connected;
    return true; // 未知时默认已连接, 交给 chat.abort 探测
  };

  // 直接调用网关 RPC 停掉悬挂的 run (比点击停止按钮可靠)
  const abortStuckRun = async (sessionKey) => {
    const g = gatewayClient();
    if (!g) return false;
    const key = sessionKey || currentSessionKey();
    if (!key) return false;

    // 优先: 模拟点击停止按钮 —— 走前端自己的状态机, 参数一定正确
    const stop = document.querySelector(
      '[aria-label*="停止"], [aria-label*="Stop"], [data-testid*="stop"], .chat-composer__stop'
    );
    if (stop && stop.offsetParent !== null) {
      try { stop.click(); } catch {}
      return true;
    }

    // 后备: 直接 RPC (带 runId 更稳)
    try {
      if (typeof g.request === "function") {
        const snap = g.snapshot;
        const runId =
          snap?.activeRunId || snap?.chatRunId || snap?.activeRunIds?.[0] || null;
        await g.request(
          "chat.abort",
          runId ? { sessionKey: key, runId } : { sessionKey: key }
        );
        return true;
      }
    } catch {}
    return false;
  };

  // 刷新会话与历史
  const refreshSession = async () => {
    const g = gatewayClient();
    if (!g) return;
    try {
      if (typeof g.refreshSessions === "function") {
        await g.refreshSessions();
      } else if (typeof g.snapshot?.refresh === "function") {
        await g.snapshot.refresh();
      } else {
        await g.request?.("session.list", {});
      }
    } catch {}
    try {
      const key = currentSessionKey();
      if (key && typeof g.request === "function") {
        await g.request("chat.history", { sessionKey: key, limit: 50 });
      }
    } catch {}
  };

  let lastRecoveredAt = 0;

  // 复位主流程: 停 run → 刷新 → 事件
  const recover = async (reason) => {
    const now = Date.now();
    // 防抖: 同一秒内不重复执行
    if (now - lastRecoveredAt < 1000) return;
    lastRecoveredAt = now;
    const key = currentSessionKey();
    console.log("[laolao-resume] recover:", reason, "session:", key);
    await abortStuckRun(key);
    await refreshSession();
    // 解除可能的输入锁定: 触发一次布局让前端状态机收敛
    window.dispatchEvent(new CustomEvent("pinkie:session-resynced"));
    document.documentElement.removeAttribute("data-laolao-streaming");
  };

  // 触发点 0: JS 被挂起后恢复 (时间戳跳变检测) — 不依赖任何事件
  // WKWebView 后台挂起时 setTimeout/requestAnimationFrame 停摆, 恢复瞬间
  // 时间戳会大幅跳变. 用它兜住"所有事件都丢了"的极端场景.
  let lastTick = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const gap = now - lastTick;
    lastTick = now;
    // 正常节流间隔 ~15s; 挂起恢复时 gap 会远超阈值 (例如几十秒到几分钟)
    if (gap > 45000 && hasBusyUI()) {
      recover("suspended-resume");
    }
  }, 15000);

  // 触发点 1: 原生壳层通知 (Launcher.swift)
  window.addEventListener("pinkie:app-foreground", () => recover("foreground"));
  window.addEventListener("pinkie:app-background", () => {});

  // 触发点 2: 页面可见性
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recover("visible");
  });

  // 触发点 3: 页面显示/恢复
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) recover("pageshow");
  });

  // 触发点 4: gateway 断线
  const tryHookGatewayClose = () => {
    const g = gatewayClient();
    if (!g || g._laolaoHooked) return;
    const orig = g.onClose;
    g._laolaoHooked = true;
    g.onClose = (info) => {
      // 断线立即复位 (不依赖回前台), 等重连后再刷新一次
      recover("gateway-close");
      window.setTimeout(() => recover("gateway-reconnected"), 3000);
      try { orig?.(info); } catch {}
    };
  };

  // 触发点 5: 周期性健康检查 (通知全丢时的最后兜底)
  let lastBusyAt = 0;
  window.setInterval(() => {
    tryHookGatewayClose();
    if (!hasBusyUI()) { lastBusyAt = 0; return; }
    const connected = gatewayConnected();
    // 忙碌但网关已断 → 一定卡死, 立即复位
    if (connected === false) { recover("periodic-disconnected"); return; }
    // 忙碌超过 60s 且无任何新消息迹象 → 认为悬挂 (正常长任务罕见超 60s 无输出)
    if (lastBusyAt === 0) lastBusyAt = Date.now();
    else if (Date.now() - lastBusyAt > 60000) recover("periodic-stuck");
  }, 15000);

  // shell 就绪后挂 onClose 钩子
  let ready = false;
  const hookWhenReady = () => {
    if (ready) return;
    if (gatewayClient()) { ready = true; tryHookGatewayClose(); }
  };
  new MutationObserver(hookWhenReady).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  hookWhenReady();
  window.addEventListener("load", () => window.setTimeout(hookWhenReady, 500), {
    once: true,
  });
})();
