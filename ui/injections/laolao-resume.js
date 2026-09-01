(() => {
  "use strict";
  // laolao-resume: WKWebView 后台挂起断线恢复
  //
  // 问题: App 切后台时 macOS 挂起 WKWebView 的 JS/网络, 网关 websocket
  // 悄悄断开 (code=1006)。"回复完成"等事件在断线窗口内丢失, 前端状态
  // 停在"生成中", 动画永远转。
  //
  // 方案: 监听前后台事件 + visibilitychange + pageshow + gateway 断线,
  // 回到前台时重新拉取当前会话消息, 并把"生成中"状态复位为真实状态。

  const $ = (sel) => document.querySelector(sel);

  // 从 gateway 客户端拿当前会话 key (与 sidebar 一致)
  const currentSessionKey = () => {
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

  // 正在生成中的判定: 发送按钮禁用 / 停止按钮可见 / 流式进行中
  const isBusy = () => {
    if (document.querySelector('[data-laolao-streaming="true"]')) return true;
    const stopBtn = document.querySelector(
      '[aria-label*="停止"], [aria-label*="Stop"], [data-testid*="stop"], .chat-composer__stop'
    );
    if (stopBtn && stopBtn.offsetParent !== null) return true;
    const sendBtn = document.querySelector(
      '[aria-label*="发送"], [aria-label*="Send"], [data-testid*="send"]'
    );
    if (sendBtn && sendBtn.disabled) return true;
    return false;
  };

  // 复位前端"生成中"状态: 触发停止按钮点击(若有), 恢复输入框可用
  const resetBusyState = () => {
    const stopBtn = document.querySelector(
      '[aria-label*="停止"], [aria-label*="Stop"], [data-testid*="stop"], .chat-composer__stop'
    );
    if (stopBtn && stopBtn.offsetParent !== null) {
      // 点击停止按钮让前端自身状态机收敛
      stopBtn.click();
    }
    document.documentElement.removeAttribute("data-laolao-streaming");
  };

  // 重新拉取会话: 通过 shell 的刷新入口; 失败时静默 (网关侧会话记录是权威)
  const refreshSession = async () => {
    const shell = document.querySelector("openclaw-app-shell");
    const gateway = shell?.context?.gateway;
    if (!gateway) return;
    try {
      // 有快照刷新接口就用, 否则发一个轻量请求触发状态同步
      if (typeof gateway.refreshSessions === "function") {
        await gateway.refreshSessions();
      } else if (typeof gateway.snapshot?.refresh === "function") {
        await gateway.snapshot.refresh();
      } else {
        await gateway.request?.("session.list", {});
      }
    } catch {}
  };

  // 回前台主流程
  const onForeground = () => {
    // 给网关前端自己的重连逻辑一点时间 (指数退避最大 15s)
    window.setTimeout(async () => {
      // 若仍显示"生成中"但没有流式事件, 说明事件丢了 → 复位 + 重新同步
      const wasBusy = isBusy();
      if (wasBusy) {
        resetBusyState();
      }
      await refreshSession();
      window.dispatchEvent(new CustomEvent("pinkie:session-resynced"));
    }, wasBusyAfterDelay(wasBusy));
  };

  // 延迟策略: 曾经 busy → 等重连窗口再刷新; 否则快速刷新
  const wasBusyAfterDelay = (wasBusy) => (wasBusy ? 1800 : 400);

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

  // 4) gateway 客户端断线通知 (openclaw 前端自身的 onClose)
  const tryHookGatewayClose = () => {
    const shell = document.querySelector("openclaw-app-shell");
    const gateway = shell?.context?.gateway;
    if (!gateway) return;
    const orig = gateway.onClose || gateway._laolaoOrigOnClose;
    if (orig && !gateway._laolaoHooked) {
      gateway._laolaoHooked = true;
      gateway.onClose = (info) => {
        // 断线时立刻复位"生成中"动画, 避免回前台前一直空转
        resetBusyState();
        try {
          orig?.(info);
        } catch {}
      };
    }
  };

  // 壳层/组件树就绪后再挂 gateway 钩子 (MutationObserver 等 shell 出现)
  let hooked = false;
  const hookWhenReady = () => {
    if (hooked) return;
    const shell = document.querySelector("openclaw-app-shell");
    if (shell?.context?.gateway) {
      hooked = true;
      tryHookGatewayClose();
    }
  };
  new MutationObserver(() => {
    hookWhenReady();
  }).observe(document.documentElement, { childList: true, subtree: true });
  hookWhenReady();
  window.addEventListener("load", () => window.setTimeout(hookWhenReady, 500), {
    once: true,
  });
})();
