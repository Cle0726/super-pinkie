(() => {
  "use strict";
  // laolao-deep-think: 极致思考按钮 (四档强度, 全模式可用)
  //
  // 挂载在聊天输入框末端的工具位。点击弹出紧凑四档预设:
  //   基础 = 标准审议流水线 (Planner→Solver×N→Critic×N→Judge)
  //   加强 = 基础 + 该模式最推荐的两项升级 (见架构文档"模式×升级"表)
  //   全开 = 基础 + 六项升级全部叠加
  //
  // 先选档位，之后每条消息发送前都通过网关挂载运行单；不会改写输入文字。
  //
  // 只读 DOM + Lit 原生事件, 全部幂等, 重渲染后自愈。

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const MENU_ID = "laolao-deep-think-menu";
  const BTN_CLASS = "laolao-deep-think-btn";
  const STORAGE_KEY = "laolao:deep-think-tier";
  let menu = null;
  let bypassSend = false;
  let arming = null;

  // 四档预设 (文案与架构文档五、六节对齐)
  const TIERS = [
    {
      id: "base",
      label: "基础档",
      numeral: "Ⅰ",
      art: "/laolao-deep-think-base.png?v=tierart3",
      motion: "/laolao-deep-think-base.webm?v=tiermotion2",
      short: "标准审议流水线",
      desc: "第 0—4 层 · 1 规划 / 3~5 求解 / 2~3 批评 / 1 仲裁",
    },
    {
      id: "boost",
      label: "加强档",
      numeral: "Ⅱ",
      art: "/laolao-deep-think-boost.png?v=tierart3",
      motion: "/laolao-deep-think-boost.webm?v=tiermotion2",
      short: "本模式两项推荐升级",
      desc: "基础流水线 + 当前模式最值得用的两项升级",
    },
    {
      id: "full",
      label: "全开档",
      numeral: "Ⅲ",
      art: "/laolao-deep-think-full.png?v=tierart3",
      motion: "/laolao-deep-think-full.webm?v=tiermotion2",
      short: "六项升级按需全开",
      desc: "六项升级全部开启；只在适用环节执行，避免无意义空转",
    },
    {
      id: "marathon",
      label: "长跑档",
      numeral: "Ⅳ",
      art: "/laolao-deep-think-marathon.png?v=tierart3",
      motion: "/laolao-deep-think-marathon.webm?v=tiermotion2",
      short: "无人值守持续执行",
      desc: "全开流水线 + 阶段存档 + 高频失败续接，适合整夜长任务",
    },
  ];

  const readTier = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY) || "";
      return TIERS.some((tier) => tier.id === value) ? value : "";
    } catch { return ""; }
  };
  let selectedTier = readTier();

  const writeTier = (value) => {
    selectedTier = value;
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    syncSelectionUi();
  };

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
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove("is-visible");
    requestAnimationFrame(() => el.classList.add("is-visible"));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("is-visible");
    }, 2600);
  };

  const selectedDefinition = () => TIERS.find((tier) => tier.id === selectedTier);

  const armSelected = async () => {
    const tier = selectedDefinition();
    if (!tier) return false;
    const sessionKey = currentSessionKey();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!sessionKey || typeof rpc !== "function") throw new Error("思考服务还没连接好");
    if (!arming) {
      arming = rpc("pinkie.deepThink.arm", { sessionKey, tier: tier.id }, 12_000)
        .then((result) => {
          if (!result?.armed) throw new Error("思考档位没有挂载成功");
          return true;
        })
        .finally(() => { arming = null; });
    }
    return arming;
  };

  const disarmCurrent = async () => {
    const sessionKey = currentSessionKey();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!sessionKey || typeof rpc !== "function") return;
    try { await rpc("pinkie.deepThink.disarm", { sessionKey }, 12_000); } catch {}
  };

  const afterArm = async (send) => {
    try {
      await armSelected();
      bypassSend = true;
      send();
    } catch (error) {
      toast(`${error?.message || "思考服务暂时不可用"}，本条没有发送`);
    } finally {
      queueMicrotask(() => { bypassSend = false; });
    }
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
    TIERS.forEach((tier, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "laolao-deep-think-menu__item";
      item.dataset.tier = tier.id;
      item.style.setProperty("--tier-index", String(index));
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-label", `${tier.label}：${tier.desc}`);
      const icon = document.createElement("span");
      icon.className = "laolao-deep-think-menu__icon";
      icon.innerHTML =
        `<img class="laolao-deep-think-menu__poster" src="${tier.art}" alt="" aria-hidden="true">` +
        `<video class="laolao-deep-think-menu__art" src="${tier.motion}" poster="${tier.art}" muted loop autoplay playsinline preload="metadata" aria-hidden="true"></video>` +
        `<span class="laolao-deep-think-menu__orbit" aria-hidden="true"></span>` +
        `<span class="laolao-deep-think-menu__numeral">${tier.numeral}</span>`;
      const copy = document.createElement("span");
      copy.className = "laolao-deep-think-menu__copy";
      const label = document.createElement("span");
      label.className = "laolao-deep-think-menu__label";
      label.textContent = tier.label;
      const summary = document.createElement("span");
      summary.className = "laolao-deep-think-menu__summary";
      summary.textContent = tier.short;
      copy.append(label, summary);
      if (tier.id === "boost" || tier.id === "marathon") {
        const recommended = document.createElement("span");
        recommended.className = "laolao-deep-think-menu__recommended";
        recommended.textContent = tier.id === "boost" ? "推荐" : "长时";
        item.append(icon, copy, recommended);
      } else {
        item.append(icon, copy);
      }
      const explain = () => { hint.textContent = tier.short; };
      item.addEventListener("pointerenter", explain);
      item.addEventListener("focus", explain);
      item.classList.toggle("is-selected", selectedTier === tier.id);
      item.setAttribute("aria-checked", String(selectedTier === tier.id));
      item.addEventListener("click", () => {
        const disabling = selectedTier === tier.id;
        writeTier(disabling ? "" : tier.id);
        if (disabling) void disarmCurrent();
        if (!disabling) {
          for (const trigger of $$("." + BTN_CLASS)) {
            trigger.classList.remove("is-tier-enter");
            requestAnimationFrame(() => trigger.classList.add("is-tier-enter"));
            window.setTimeout(() => trigger.classList.remove("is-tier-enter"), 760);
          }
        }
        toast(disabling ? "已恢复普通发送" : `${tier.label}已固定，之后发送都会使用`);
        closeMenu();
      });
      choices.append(item);
    });
    menu.append(choices, hint);
    const footer = document.createElement("div");
    footer.className = "laolao-deep-think-menu__footer";
    footer.textContent = selectedTier ? "再次点选当前档位即可取消 · 继承当前模式与项目" : "先选档位，再正常输入和发送";
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
    if (actions.querySelector("." + BTN_CLASS)) { syncSelectionUi(); return; }
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
      "</svg><img class='laolao-deep-think-btn__poster' alt='' aria-hidden='true' hidden>" +
      "<video class='laolao-deep-think-btn__art' muted loop autoplay playsinline preload='metadata' aria-hidden='true' hidden></video>" +
      "<span class='laolao-deep-think-btn__label'>极致思考</span>";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu(btn);
    });
    actions.appendChild(btn);
    syncSelectionUi();
  };

  function syncSelectionUi() {
    const tier = selectedDefinition();
    for (const btn of $$("." + BTN_CLASS)) {
      btn.classList.toggle("is-selected", Boolean(tier));
      btn.dataset.tier = tier?.id || "";
      btn.dataset.tierSymbol = tier?.numeral || "";
      const poster = btn.querySelector(".laolao-deep-think-btn__poster");
      if (poster) {
        poster.hidden = !tier;
        if (tier && poster.getAttribute("src") !== tier.art) poster.setAttribute("src", tier.art);
      }
      const art = btn.querySelector(".laolao-deep-think-btn__art");
      if (art) {
        art.hidden = !tier;
        if (tier) {
          art.setAttribute("poster", tier.art);
          if (art.getAttribute("src") !== tier.motion) art.setAttribute("src", tier.motion);
          if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) void art.play?.().catch(()=>{});
        } else {
          art.pause?.();
          art.removeAttribute("src");
        }
      }
      btn.setAttribute("aria-pressed", String(Boolean(tier)));
      btn.setAttribute("title", tier ? `思考强度：${tier.label}（点击调整或取消）` : "选择思考强度");
      btn.setAttribute("aria-label", tier ? `思考强度已固定为${tier.label}` : "选择思考强度");
    }
  }

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
  transition: background .18s ease, border-color .18s ease, color .18s ease, transform .12s ease, box-shadow .18s ease;
}
.laolao-deep-think-btn:hover,.laolao-deep-think-btn[aria-expanded="true"],.laolao-deep-think-btn.is-selected { background: rgba(255,248,252,.56); border-color: rgba(211,91,142,.32); box-shadow: inset 0 1px rgba(255,255,255,.5),0 3px 10px rgba(196,71,128,.12); }
.laolao-deep-think-btn.is-selected::after{content:attr(data-tier-symbol);position:absolute;right:-5px;top:-6px;display:grid;place-items:center;min-width:13px;height:13px;padding:0 2px;border-radius:999px;background:var(--tier-accent,#d84f8c);color:#fff;box-shadow:0 0 0 2px rgba(255,245,250,.86),0 3px 8px color-mix(in srgb,var(--tier-accent,#d84f8c) 38%,transparent);font:700 7px/1 ui-sans-serif,system-ui}
.laolao-deep-think-btn[data-tier="base"]{--tier-accent:#d95791;color:#b64176}.laolao-deep-think-btn[data-tier="boost"]{--tier-accent:#d98a4a;color:#bb6a2d}.laolao-deep-think-btn[data-tier="full"]{--tier-accent:#9a65bd;color:#8653a8}.laolao-deep-think-btn[data-tier="marathon"]{--tier-accent:#667fc3;color:#5871b2}
.laolao-deep-think-btn.is-tier-enter{animation:laolao-tier-trigger .72s cubic-bezier(.2,.78,.28,1) both}
.laolao-deep-think-btn:active { transform: scale(.95); }
.laolao-deep-think-btn__spark { width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linejoin:round; }
.laolao-deep-think-btn__poster,.laolao-deep-think-btn__art{display:block;width:23px;height:23px;border-radius:50%;object-fit:cover;filter:drop-shadow(0 2px 4px color-mix(in srgb,var(--tier-accent,#d84f8c) 22%,transparent));pointer-events:none}.laolao-deep-think-btn__art{position:absolute;inset:3px}.laolao-deep-think-btn__poster[hidden],.laolao-deep-think-btn__art[hidden]{display:none}.laolao-deep-think-btn.is-selected .laolao-deep-think-btn__spark{display:none}
.laolao-deep-think-btn__label { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0; }
.laolao-deep-think-menu {
  z-index:2147483000;width:min(334px,calc(100vw - 20px));overflow:hidden;
  color:#57364a;background:linear-gradient(145deg,rgba(255,252,253,.82),rgba(251,228,241,.68));border:1px solid rgba(255,255,255,.76);
  -webkit-backdrop-filter:blur(28px) saturate(1.16);backdrop-filter:blur(28px) saturate(1.16);
  border-radius:20px;padding:10px;box-shadow:0 20px 48px rgba(84,42,65,.15),inset 0 1px rgba(255,255,255,.78);
  display:flex;flex-direction:column;gap:8px;animation:laolao-think-menu-in .2s cubic-bezier(.2,.78,.28,1) both;
}
.laolao-deep-think-menu::before{content:"";position:absolute;inset:0 12px auto;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.92),transparent);pointer-events:none}
.laolao-deep-think-menu__head{display:flex;align-items:center;gap:7px;padding:1px 4px;color:rgba(87,54,74,.72);font-size:11px;font-weight:680;letter-spacing:.08em}
.laolao-deep-think-menu__mark{display:grid;place-items:center;width:16px;height:16px;color:#ca4e84}.laolao-deep-think-menu__mark svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linejoin:round}
.laolao-deep-think-menu__choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.laolao-deep-think-menu__item {
  --tier-accent:#d95791;--tier-soft:rgba(226,105,159,.14);position:relative;display:grid;grid-template-columns:32px 1fr;align-items:center;gap:7px;min-width:0;
  min-height:58px;padding:6px 8px;border:1px solid rgba(255,255,255,.28);border-radius:14px;background:linear-gradient(145deg,rgba(255,255,255,.22),var(--tier-soft));
  color:inherit;cursor:pointer;text-align:left;font-size:11.5px;animation:laolao-tier-item-in .26s calc(var(--tier-index) * 34ms) cubic-bezier(.2,.78,.28,1) backwards;transition:background .18s ease,border-color .18s ease,transform .14s ease,box-shadow .18s ease;
}
.laolao-deep-think-menu__item[data-tier="boost"]{--tier-accent:#d98a4a;--tier-soft:rgba(237,185,113,.15)}.laolao-deep-think-menu__item[data-tier="full"]{--tier-accent:#9a65bd;--tier-soft:rgba(168,119,202,.15)}.laolao-deep-think-menu__item[data-tier="marathon"]{--tier-accent:#667fc3;--tier-soft:rgba(111,139,205,.16)}
.laolao-deep-think-menu__item:hover{background:linear-gradient(145deg,rgba(255,255,255,.58),color-mix(in srgb,var(--tier-accent) 17%,transparent));border-color:color-mix(in srgb,var(--tier-accent) 35%,white);box-shadow:0 7px 18px color-mix(in srgb,var(--tier-accent) 13%,transparent);transform:translateY(-1px)}
.laolao-deep-think-menu__item.is-selected{background:linear-gradient(145deg,rgba(255,255,255,.64),color-mix(in srgb,var(--tier-accent) 23%,transparent));border-color:color-mix(in srgb,var(--tier-accent) 48%,white);box-shadow:inset 0 1px rgba(255,255,255,.66),0 8px 19px color-mix(in srgb,var(--tier-accent) 16%,transparent)}
.laolao-deep-think-menu__item:focus-visible{outline:2px solid rgba(211,83,139,.3);outline-offset:1px}
.laolao-deep-think-menu__item:disabled { opacity:.58; cursor:wait; transform:none }
.laolao-deep-think-menu__icon{position:relative;display:grid;place-items:center;width:34px;height:34px;color:var(--tier-accent);font:700 8px/1 ui-sans-serif,system-ui}
.laolao-deep-think-menu__poster,.laolao-deep-think-menu__art{display:block;width:34px;height:34px;border-radius:50%;object-fit:cover;filter:drop-shadow(0 3px 5px color-mix(in srgb,var(--tier-accent) 20%,transparent));pointer-events:none}.laolao-deep-think-menu__art{position:absolute;inset:0}.laolao-deep-think-menu__numeral{position:absolute;right:-2px;bottom:-2px;z-index:2;display:grid;place-items:center;min-width:12px;height:12px;padding:0 1px;border:1px solid rgba(255,255,255,.82);border-radius:999px;background:color-mix(in srgb,var(--tier-accent) 82%,white);color:#fff;box-shadow:0 2px 5px color-mix(in srgb,var(--tier-accent) 20%,transparent)}.laolao-deep-think-menu__orbit{position:absolute;inset:2px;border:1px solid color-mix(in srgb,var(--tier-accent) 42%,transparent);border-radius:50%;opacity:.35}.laolao-deep-think-menu__orbit::after{content:"";position:absolute;left:50%;top:-2px;width:3px;height:3px;border-radius:50%;background:var(--tier-accent);box-shadow:0 0 6px color-mix(in srgb,var(--tier-accent) 70%,transparent)}
.laolao-deep-think-menu__item[data-tier="base"] .laolao-deep-think-menu__orbit{border-style:dotted}.laolao-deep-think-menu__item[data-tier="boost"] .laolao-deep-think-menu__orbit{transform:rotate(45deg);border-radius:7px}.laolao-deep-think-menu__item[data-tier="full"] .laolao-deep-think-menu__orbit{inset:3px;border-style:dashed}.laolao-deep-think-menu__item[data-tier="marathon"] .laolao-deep-think-menu__orbit{inset:2px;border-left-color:transparent;border-bottom-color:transparent}
.laolao-deep-think-menu__item.is-selected[data-tier="base"] .laolao-deep-think-menu__art{animation:laolao-tier-breathe 2.3s ease-in-out infinite}.laolao-deep-think-menu__item.is-selected[data-tier="boost"] .laolao-deep-think-menu__art{animation:laolao-tier-twinkle 1.35s ease-in-out infinite}.laolao-deep-think-menu__item.is-selected[data-tier="full"] .laolao-deep-think-menu__orbit{animation:laolao-tier-orbit 2.8s linear infinite}.laolao-deep-think-menu__item.is-selected[data-tier="marathon"] .laolao-deep-think-menu__orbit{animation:laolao-tier-orbit 1.7s linear infinite}
.laolao-deep-think-menu__copy{display:flex;min-width:0;flex-direction:column;gap:3px}.laolao-deep-think-menu__label{min-width:0;font-weight:680;white-space:nowrap}.laolao-deep-think-menu__summary{overflow:hidden;color:rgba(87,54,74,.53);font-size:8.5px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}
.laolao-deep-think-menu__recommended{position:absolute;top:4px;right:5px;padding:1px 4px;border:1px solid color-mix(in srgb,var(--tier-accent) 28%,white);border-radius:999px;background:color-mix(in srgb,var(--tier-accent) 76%,white);color:#fff;font-size:7px;line-height:1.4;box-shadow:0 2px 6px color-mix(in srgb,var(--tier-accent) 18%,transparent)}
.laolao-deep-think-menu__hint{min-height:15px;padding:0 4px;color:rgba(87,54,74,.62);font-size:10.5px;line-height:1.35;text-align:center}
.laolao-deep-think-menu__footer { padding:4px 4px 0;border-top:1px solid rgba(176,95,131,.1);text-align:center;font-size:9.5px;color:rgba(87,54,74,.43); }
#laolao-deep-think-toast{position:fixed;left:50%;bottom:72px;z-index:2147483647;max-width:80vw;padding:8px 14px;overflow:hidden;border:1px solid rgba(255,255,255,.72);border-radius:999px;background:linear-gradient(135deg,rgba(255,252,253,.88),rgba(250,224,238,.78));color:#6d3650;-webkit-backdrop-filter:blur(22px) saturate(1.14);backdrop-filter:blur(22px) saturate(1.14);box-shadow:0 10px 28px rgba(106,48,79,.16),inset 0 1px rgba(255,255,255,.8);font-size:12px;opacity:0;pointer-events:none;text-overflow:ellipsis;transform:translate(-50%,7px) scale(.98);transition:opacity .22s ease,transform .22s ease;white-space:nowrap}#laolao-deep-think-toast.is-visible{opacity:1;transform:translate(-50%,0) scale(1)}
html[data-theme-mode="dark"] .laolao-deep-think-menu{color:#57364a;background:linear-gradient(145deg,rgba(255,249,252,.84),rgba(245,218,234,.72));border-color:rgba(255,255,255,.62);box-shadow:0 18px 44px rgba(84,42,65,.18),inset 0 1px rgba(255,255,255,.66)}
@keyframes laolao-think-menu-in{from{opacity:0;transform:translateY(6px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes laolao-tier-item-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes laolao-tier-trigger{0%{transform:scale(.9)}42%{box-shadow:0 0 0 8px color-mix(in srgb,var(--tier-accent) 13%,transparent),0 4px 16px color-mix(in srgb,var(--tier-accent) 22%,transparent)}100%{transform:scale(1)}}
@keyframes laolao-tier-breathe{50%{box-shadow:inset 0 1px rgba(255,255,255,.72),0 0 0 4px color-mix(in srgb,var(--tier-accent) 10%,transparent)}}
@keyframes laolao-tier-twinkle{50%{opacity:1;transform:rotate(45deg) scale(.82)}}
@keyframes laolao-tier-orbit{to{transform:rotate(360deg)}}
@media(max-width:600px){.laolao-deep-think-menu{width:min(310px,calc(100vw - 16px))}.laolao-deep-think-menu__item{grid-template-columns:28px 1fr;padding:5px 6px}.laolao-deep-think-menu__icon{width:27px;height:27px}}
@media (prefers-reduced-motion: reduce){.laolao-deep-think-btn,.laolao-deep-think-menu,.laolao-deep-think-menu__item,.laolao-deep-think-menu__icon,.laolao-deep-think-menu__orbit,#laolao-deep-think-toast{animation:none!important;transition:none!important}.laolao-deep-think-menu__art,.laolao-deep-think-btn__art{display:none!important}}
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

  const realSendButton = (target) => {
    const button = target?.closest?.(".chat-send-btn");
    if (!button || button.disabled || button.hasAttribute("disabled")) return null;
    if (["chat-send-btn--stop", "chat-send-btn--voice", "chat-send-btn--laolao-dictation", "chat-send-btn--queue"]
      .some((name) => button.classList.contains(name))) return null;
    return /send|发送/i.test(button.getAttribute("aria-label") || "") ? button : null;
  };
  document.addEventListener("click", (event) => {
    if (bypassSend || !selectedTier) return;
    const button = realSendButton(event.target);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void afterArm(() => button.click());
  }, true);
  document.addEventListener("keydown", (event) => {
    if (bypassSend || !selectedTier || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const input = event.target?.closest?.(".agent-chat__composer-combobox textarea");
    if (!input || !input.value.trim()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void afterArm(() => input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, composed: true,
    })));
  }, true);

  ensureStyle();
  render();
})();
