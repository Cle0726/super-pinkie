(() => {
  "use strict";
  // laolao-deep-think: 极致思考按钮 (三档强度, 全模式可用)
  //
  // 挂载在聊天输入框操作区。点击弹出三档预设:
  //   基础 = 标准审议流水线 (Planner→Solver×N→Critic×N→Judge)
  //   加强 = 基础 + 该模式最推荐的两项升级 (见架构文档"模式×升级"表)
  //   全开 = 基础 + 六项升级全部叠加
  //
  // 触发方式: 把当前输入(或上一个用户问题)包装成 [deep-think:档位] 指令
  // 填入输入框并触发发送 — 与模式无关, 破甲与否由注入层按 session 门控,
  // 无限制模式下子代理自动继承破甲, 其他模式正常工作。
  //
  // 只读 DOM + Lit 原生事件, 全部幂等, 重渲染后自愈。

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const MENU_ID = "laolao-deep-think-menu";
  const BTN_CLASS = "laolao-deep-think-btn";
  let menu = null;

  // 三档预设 (文案与架构文档五、六节对齐)
  const TIERS = [
    {
      id: "base",
      label: "基础档",
      icon: "🧠",
      desc: "标准审议: 1规划 + 3~5求解 + 2~3批评 + 1仲裁, 验收清单收口",
      tag: "[deep-think:base]",
    },
    {
      id: "boost",
      label: "加强档",
      icon: "⚡",
      desc: "基础 + 本模式最推荐两项升级 (project→执行验证+递归; ideas→反批评+多流水线; none→按任务选)",
      tag: "[deep-think:boost]",
    },
    {
      id: "full",
      label: "全开档",
      icon: "🔥",
      desc: "基础 + 六项升级全叠加 (递归/多流水线/辩论/执行验证/假设审查/反批评)",
      tag: "[deep-think:full]",
    },
  ];

  // 当前模式 (优先读 mode-switcher 写在 <html> 上的 data-laolao-mode)
  const currentMode = () => {
    const attr = document.documentElement.getAttribute("data-laolao-mode");
    if (attr && ["chat", "project", "thinking", "unrestricted"].includes(attr)) {
      return attr;
    }
    const routed = new URLSearchParams(window.location.search).get("session") || "";
    if (routed.startsWith("agent:project:")) return "project";
    if (routed.startsWith("agent:thinking:")) return "thinking";
    if (routed.startsWith("agent:unrestricted:")) return "unrestricted";
    if (routed.startsWith("agent:main:")) return "chat";
    const el = document.querySelector(
      ".sidebar-recent-session--active[data-session-key]"
    );
    const key = el?.dataset.sessionKey || "";
    if (key.startsWith("agent:project:")) return "project";
    if (key.startsWith("agent:thinking:")) return "thinking";
    if (key.startsWith("agent:unrestricted:")) return "unrestricted";
    return "chat";
  };

  // 轻量 toast (不依赖可能不存在的 __laolaoToast, 避免静默失败)
  let toastTimer = null;
  const toast = (msg) => {
    let el = document.getElementById("laolao-deep-think-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "laolao-deep-think-toast";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);" +
        "background:rgba(30,27,46,.95);color:#fff;padding:8px 14px;border-radius:999px;" +
        "font-size:13px;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,.4);" +
        "max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
    }, 2600);
  };

  // 取当前输入或上一轮用户问题
  const gatherQuestion = () => {
    const ta = $(".agent-chat__composer-combobox > textarea");
    if (ta && ta.value && ta.value.trim()) return ta.value.trim();
    // 从消息列表找最后一条 user 消息 (兜底)
    const userMsgs = $$(
      '.chat-message[data-role="user"] .chat-message__content, [class*="chat-message"][class*="user"] [class*="content"], .agent-chat__message[data-role="user"]'
    );
    for (let i = userMsgs.length - 1; i >= 0; i--) {
      const text = (userMsgs[i].textContent || "").trim();
      if (text && text.length < 2000) return text;
    }
    return "";
  };

  // 把指令填入输入框并触发发送
  const sendDeepThink = (tier) => {
    const question = gatherQuestion();
    if (!question) {
      toast("先在输入框写问题，或先聊一句再点极致思考");
      return;
    }
    const mode = currentMode();
    const instruction =
      `${tier.tag}\n` +
      `请对以下内容执行极致思考 (当前模式: ${mode}):\n` +
      `<<<问题开始>>>\n${question}\n<<<问题结束>>>\n` +
      `按档位要求跑审议流水线后直接给出结论。`;

    const ta = $(".agent-chat__composer-combobox > textarea");
    if (!ta) {
      toast("没找到输入框，请稍后再试");
      return;
    }
    // Lit 组件监听 input 事件更新 draft 状态:
    // 用原型上的原生 setter 赋值, 绕过 Lit 对 .value 的劫持, 再派发 input
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (setter) setter.call(ta, instruction);
    else ta.value = instruction;
    ta.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    ta.focus();

    // 轮询等待发送按钮可用 (Lit 提交 draft 后才会启用), 最多 ~2.4s
    // 注意: .chat-send-btn 有 stop/voice 变体, 必须排除; queue 按钮语义不同也排除
    let attempts = 0;
    const findSendBtn = () => {
      const all = $$(".chat-send-btn");
      return all.find(
        (b) =>
          !b.classList.contains("chat-send-btn--stop") &&
          !b.classList.contains("chat-send-btn--voice") &&
          !b.classList.contains("chat-send-btn--queue") &&
          !b.disabled &&
          !b.hasAttribute("disabled") &&
          b.getAttribute("aria-label") &&
          /send|发送/i.test(b.getAttribute("aria-label"))
      );
    };
    const trySend = () => {
      const sendBtn = findSendBtn();
      if (sendBtn) {
        sendBtn.click();
        return;
      }
      // 按钮不可用但输入框有值 → 再等一帧 (Lit 异步更新)
      if (attempts++ < 24) {
        window.setTimeout(trySend, 100);
        return;
      }
      // 兜底: 模拟回车 (keydown Enter, 组件一般监听此键发送)
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          composed: true,
        })
      );
      // 若 1s 后仍未发送 (输入框内容还在), 提示用户手动按回车
      window.setTimeout(() => {
        if (ta.value && ta.value.trim() === instruction.trim()) {
          toast("已填入极致思考指令，请按回车发送（或点发送按钮）");
        }
      }, 1000);
    };
    window.setTimeout(trySend, 120);
  };

  const closeMenu = () => {
    menu?.remove();
    menu = null;
    const btn = $("." + BTN_CLASS);
    btn?.setAttribute("aria-expanded", "false");
  };

  const openMenu = (btn) => {
    if (menu) { closeMenu(); return; }
    menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.className = "laolao-deep-think-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "极致思考强度");
    TIERS.forEach((tier) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "laolao-deep-think-menu__item";
      item.setAttribute("role", "menuitem");
      const label = document.createElement("span");
      label.className = "laolao-deep-think-menu__label";
      label.textContent = `${tier.icon} ${tier.label}`;
      const desc = document.createElement("span");
      desc.className = "laolao-deep-think-menu__desc";
      desc.textContent = tier.desc;
      item.append(label, desc);
      item.addEventListener("click", () => {
        closeMenu();
        sendDeepThink(tier);
      });
      menu.append(item);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = `${Math.max(8, Math.min(rect.right - 260, window.innerWidth - 272))}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    document.body.append(menu);
    btn.setAttribute("aria-expanded", "true");
  };

  // 渲染按钮 (幂等: 已存在则跳过; 只挂到可见 composer)
  const render = () => {
    // Lit 重渲染会替换 composer-actions 节点: 每次先清掉脱离文档的孤儿按钮
    $$("." + BTN_CLASS).forEach((orphan) => {
      if (!orphan.isConnected) orphan.remove();
    });
    const actions = $(".agent-chat__composer-actions");
    if (!actions || !actions.isConnected) return;
    if (actions.querySelector("." + BTN_CLASS)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("title", "极致思考: 对当前问题跑多代理审议流水线");
    btn.setAttribute("aria-label", "极致思考");
    btn.innerHTML = "🧠<span class='laolao-deep-think-btn__label'>极致</span>";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu(btn);
    });
    actions.appendChild(btn);
  };

  // 菜单样式 (独立注入, 避免改用户 CSS)
  const ensureStyle = () => {
    if (document.getElementById("laolao-deep-think-style")) return;
    const style = document.createElement("style");
    style.id = "laolao-deep-think-style";
    style.textContent = `
.laolao-deep-think-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 30px; padding: 0 10px; margin: 0 4px;
  border: 1px solid rgba(255,255,255,.16); border-radius: 999px;
  background: rgba(255,255,255,.08); color: inherit; cursor: pointer;
  font-size: 13px; line-height: 1; white-space: nowrap;
  transition: background .15s ease, transform .1s ease;
}
.laolao-deep-think-btn:hover { background: rgba(255,255,255,.18); }
.laolao-deep-think-btn:active { transform: scale(.95); }
.laolao-deep-think-btn__label { font-size: 12px; opacity: .9; }
.laolao-deep-think-menu {
  z-index: 2147483000; min-width: 260px; max-width: 320px;
  background: #1e1b2e; border: 1px solid rgba(255,255,255,.14);
  border-radius: 12px; padding: 6px; box-shadow: 0 8px 32px rgba(0,0,0,.45);
  display: flex; flex-direction: column; gap: 4px;
}
.laolao-deep-think-menu__item {
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  padding: 8px 10px; border: none; border-radius: 8px; background: transparent;
  color: inherit; cursor: pointer; font-size: 13px;
}
.laolao-deep-think-menu__item:hover { background: rgba(255,255,255,.1); }
.laolao-deep-think-menu__desc { font-size: 11px; opacity: .65; line-height: 1.35; }
`;
    document.head.appendChild(style);
  };

  // 重渲染自愈
  let scheduled = false;
  const scheduleRender = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  };
  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("pointerdown", (e) => {
    if (menu && !menu.contains(e.target) && !e.target.closest?.("." + BTN_CLASS)) {
      closeMenu();
    }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  ensureStyle();
  render();
})();
