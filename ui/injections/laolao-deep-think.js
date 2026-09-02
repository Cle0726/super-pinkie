(() => {
  "use strict";
  // laolao-deep-think: 极致思考按钮 (三档强度, 全模式可用)
  //
  // 挂载在聊天输入框末端的工具位。点击弹出紧凑三档预设:
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
      numeral: "Ⅰ",
      short: "标准审议流水线",
      desc: "第 0—4 层 · 1 规划 / 3~5 求解 / 2~3 批评 / 1 仲裁",
      tag: "[deep-think:base]",
    },
    {
      id: "boost",
      label: "加强档",
      numeral: "Ⅱ",
      short: "本模式两项推荐升级",
      desc: "基础流水线 + 当前模式最值得用的两项升级",
      tag: "[deep-think:boost]",
    },
    {
      id: "full",
      label: "全开档",
      numeral: "Ⅲ",
      short: "六项升级按需全开",
      desc: "六项升级全部开启；只在适用环节执行，避免无意义空转",
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

  const currentSessionKey = () => {
    const routed = new URLSearchParams(window.location.search).get("session") || "";
    if (/^agent:(main|project|thinking|unrestricted):/.test(routed)) return routed;
    const active = document.querySelector("[data-session-key].sidebar-recent-session--active");
    const key = active?.dataset?.sessionKey || "";
    return /^agent:(main|project|thinking|unrestricted):/.test(key) ? key : "";
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
  const sendDeepThink = async (tier) => {
    const question = gatherQuestion();
    if (!question) {
      toast("先在输入框写问题，或先聊一句再点极致思考");
      return;
    }
    const mode = currentMode();
    const sessionKey = currentSessionKey();
    let armed = false;
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (sessionKey && typeof rpc === "function") {
      try {
        const result = await rpc("pinkie.deepThink.arm", { sessionKey, tier: tier.id }, 12_000);
        armed = Boolean(result?.armed);
      } catch (error) {
        console.warn("[deep-think] runtime arm failed, using inline fallback", error);
      }
    }
    // 正常路径只发送用户原文；运行单通过网关的一次性 context 注入，不污染聊天记录。
    // 插件未加载时保留短标记兜底，至少仍能触发 workspace skill。
    const instruction = armed ? question : `${tier.tag}\n${question}`;

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
          !b.classList.contains("chat-send-btn--laolao-dictation") &&
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
    const head = document.createElement("div");
    head.className = "laolao-deep-think-menu__head";
    head.innerHTML =
      "<span class='laolao-deep-think-menu__mark' aria-hidden='true'>" +
      "<svg viewBox='0 0 24 24'><path d='M12 2.8l2.05 6.1L20.2 11l-6.15 2.1L12 19.2l-2.05-6.1L3.8 11l6.15-2.1L12 2.8Z'/><circle cx='12' cy='11' r='2.15'/></svg></span>" +
      "<span>思考强度</span>";
    menu.append(head);
    const choices = document.createElement("div");
    choices.className = "laolao-deep-think-menu__choices";
    const hint = document.createElement("div");
    hint.className = "laolao-deep-think-menu__hint";
    hint.setAttribute("aria-live", "polite");
    hint.textContent = TIERS[1].short;
    TIERS.forEach((tier) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "laolao-deep-think-menu__item";
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-label", `${tier.label}：${tier.desc}`);
      const icon = document.createElement("span");
      icon.className = "laolao-deep-think-menu__icon";
      icon.textContent = tier.numeral;
      const label = document.createElement("span");
      label.className = "laolao-deep-think-menu__label";
      label.textContent = tier.label;
      if (tier.id === "boost") {
        const recommended = document.createElement("span");
        recommended.className = "laolao-deep-think-menu__recommended";
        recommended.textContent = "推荐";
        item.append(icon, label, recommended);
      } else {
        item.append(icon, label);
      }
      const explain = () => { hint.textContent = tier.short; };
      item.addEventListener("pointerenter", explain);
      item.addEventListener("focus", explain);
      item.addEventListener("click", () => {
        item.disabled = true;
        item.setAttribute("aria-busy", "true");
        choices.querySelectorAll("button").forEach((other) => { other.disabled = true; });
        hint.textContent = `正在启动${tier.label}…`;
        sendDeepThink(tier).finally(closeMenu);
      });
      choices.append(item);
    });
    menu.append(choices, hint);
    const footer = document.createElement("div");
    footer.className = "laolao-deep-think-menu__footer";
    footer.textContent = "仅作用于本次消息 · 继承当前模式与项目";
    menu.append(footer);
    const rect = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.visibility = "hidden";
    document.body.append(menu);
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(10, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 10))}px`;
    menu.style.top = `${Math.max(10, rect.top - menuRect.height - 8)}px`;
    menu.style.visibility = "visible";
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
    btn.innerHTML =
      "<svg class='laolao-deep-think-btn__spark' aria-hidden='true' viewBox='0 0 24 24'>" +
      "<path d='M12 2.7l2.1 6.15L20.3 11l-6.2 2.15L12 19.3l-2.1-6.15L3.7 11l6.2-2.15L12 2.7Z'/>" +
      "<path d='M18.35 3.7l.72 2.08 2.08.72-2.08.72-.72 2.08-.72-2.08-2.08-.72 2.08-.72.72-2.08Z'/>" +
      "</svg><span class='laolao-deep-think-btn__label'>极致思考</span>";
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
  position:relative; display: inline-grid; place-items:center;
  width:30px; height: 30px; padding:0; margin: 0 3px;
  border: 1px solid transparent; border-radius: 999px;
  background: transparent; color: #a3426c; cursor: pointer;
  -webkit-backdrop-filter: blur(14px) saturate(1.12); backdrop-filter: blur(14px) saturate(1.12);
  line-height: 1;
  box-shadow:none;
  transition: background .18s ease, border-color .18s ease, transform .12s ease, box-shadow .18s ease;
}
.laolao-deep-think-btn:hover,.laolao-deep-think-btn[aria-expanded="true"] { background: rgba(255,248,252,.46); border-color: rgba(211,91,142,.26); box-shadow: inset 0 1px rgba(255,255,255,.5); }
.laolao-deep-think-btn:active { transform: scale(.95); }
.laolao-deep-think-btn__spark { width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linejoin:round; }
.laolao-deep-think-btn__label { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0; }
.laolao-deep-think-menu {
  z-index: 2147483000; width: min(292px, calc(100vw - 20px));
  color:#57364a; background: rgba(255,248,251,.74); border: 1px solid rgba(255,255,255,.66);
  -webkit-backdrop-filter: blur(26px) saturate(1.14); backdrop-filter: blur(26px) saturate(1.14);
  border-radius: 16px; padding: 9px; box-shadow: 0 16px 40px rgba(84,42,65,.14), inset 0 1px rgba(255,255,255,.7);
  display: flex; flex-direction: column; gap: 7px;
}
.laolao-deep-think-menu__head{display:flex;align-items:center;gap:7px;padding:0 3px;color:rgba(87,54,74,.7);font-size:11px;font-weight:650;letter-spacing:.08em}
.laolao-deep-think-menu__mark{display:grid;place-items:center;width:16px;height:16px;color:#ca4e84}.laolao-deep-think-menu__mark svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linejoin:round}
.laolao-deep-think-menu__choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.laolao-deep-think-menu__item {
  position:relative; display:grid;grid-template-columns:20px 1fr;align-items:center;gap:4px;min-width:0;
  height:40px;padding:0 7px;border:1px solid transparent;border-radius:11px;background:rgba(255,255,255,.24);
  color:inherit;cursor:pointer;font-size:11.5px;transition:background .16s ease,border-color .16s ease,transform .12s ease;
}
.laolao-deep-think-menu__item:hover { background: rgba(255,255,255,.58); border-color:rgba(211,91,142,.2); transform:translateY(-1px) }
.laolao-deep-think-menu__item:focus-visible{outline:2px solid rgba(211,83,139,.3);outline-offset:1px}
.laolao-deep-think-menu__item:disabled { opacity:.58; cursor:wait; transform:none }
.laolao-deep-think-menu__icon { display:grid;place-items:center;width:19px;height:19px;border-radius:7px;color:#c44780;background:rgba(242,181,208,.23);font:650 9.5px/1 ui-sans-serif,system-ui; }
.laolao-deep-think-menu__label { min-width:0;font-weight:650;white-space:nowrap; }
.laolao-deep-think-menu__recommended{position:absolute;top:-5px;right:3px;padding:1px 4px;border-radius:999px;background:#d85b91;color:#fff;font-size:7.5px;line-height:1.4;box-shadow:0 2px 6px rgba(150,55,96,.15)}
.laolao-deep-think-menu__hint{min-height:15px;padding:0 4px;color:rgba(87,54,74,.62);font-size:10.5px;line-height:1.35;text-align:center}
.laolao-deep-think-menu__footer { padding:4px 4px 0;border-top:1px solid rgba(176,95,131,.1);text-align:center;font-size:9.5px;color:rgba(87,54,74,.43); }
html[data-theme-mode="dark"] .laolao-deep-think-menu{color:#57364a;background:rgba(250,235,243,.78);border-color:rgba(255,255,255,.58);box-shadow:0 16px 40px rgba(84,42,65,.16),inset 0 1px rgba(255,255,255,.64)}
html[data-theme-mode="dark"] .laolao-deep-think-menu__item{background:rgba(255,255,255,.22)}
html[data-theme-mode="dark"] .laolao-deep-think-menu__item:hover{background:rgba(255,255,255,.52)}
@media(max-width:600px){.laolao-deep-think-menu{width:min(270px,calc(100vw - 16px))}.laolao-deep-think-menu__item{padding:0 5px}}
@media (prefers-reduced-motion: reduce){.laolao-deep-think-btn,.laolao-deep-think-menu__item{transition:none}}
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
  // 输入区由 Lit 重建；低频轮询足够且不会在流式输出时制造 MutationObserver 风暴。
  window.setInterval(scheduleRender, 700);
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
