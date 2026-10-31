(() => {
  "use strict";
  // laolao-deep-think: 极致思考按钮 (四档强度, 全模式可用)
  //
  // 挂载在聊天输入框末端的工具位。点击弹出紧凑四档预设:
  //   （与后端 deliberationRequirements / buildDeliberationPlan 实际做的事一致）
  //   基础 = 按任务类型走对应流程（简单问题直接答；改代码先复现再改再测；难题独立解法验算）
  //   加强 = 基础 + 说「完成」必须有本轮真实测试、运行或来源证据，拿不到就照实报未完成
  //   全开 = 加强 + 有标准答案或要取舍的问题，多做几版独立解法，批评必须带证据
  //   长跑 = 加强 + 每个阶段写检查点，中断自动续跑，直到完成或明确卡点
  //
  // 先选档位，之后每条消息发送前都通过网关挂载运行单；不会改写输入文字。
  //
  // 只读 DOM + Lit 原生事件, 全部幂等, 重渲染后自愈。

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const MENU_ID = "laolao-deep-think-menu";
  const BTN_CLASS = "laolao-deep-think-btn";
  const STATUS_ID = "laolao-deep-think-status";
  const STORAGE_KEY = (sk) => `laolao:deep-think-tier:${sk || "default"}`;
  let menu = null;
  let bypassSend = false;
  let arming = null;
  let disarming = null;
  let statusRequest = null;
  let statusExpanded = false;
  let statusFailures = 0;
  let latestStatus = { active: false };
  let latestStatusSessionKey = "";
  const refreshedCompletions = new Map();

  const PHASE_LABELS = Object.freeze({
    planning: "正在规划",
    dispatching: "正在分配",
    working: "协作处理中",
    coordinating: "正在整理结果",
    waiting: "等待下一批",
    summarizing: "全部完成，正在汇总",
    done: "本轮协作已完成",
    stopped: "本轮协作已停止",
  });

  // 四档预设 (文案与架构文档五、六节对齐)
  const TIERS = [
    {
      id: "base",
      label: "基础档",
      numeral: "Ⅰ",
      art: "/laolao-deep-think-base.png?v=tierart3",
      motion: "/laolao-deep-think-base.webm?v=tiermotion2",
      short: "按任务类型走流程",
      desc: "简单问题直接答；改代码先复现再修再测；难题用独立解法验算",
    },
    {
      id: "boost",
      label: "加强档",
      numeral: "Ⅱ",
      art: "/laolao-deep-think-boost.png?v=tierart3",
      motion: "/laolao-deep-think-boost.webm?v=tiermotion2",
      short: "完成必须有真实证据",
      desc: "基础流程 + 说完成前要有本轮的测试、运行或来源证据；拿不到就照实说没完成",
    },
    {
      id: "full",
      label: "全开档",
      numeral: "Ⅲ",
      art: "/laolao-deep-think-full.png?v=tierart3",
      motion: "/laolao-deep-think-full.webm?v=tiermotion2",
      short: "多版独立解法互相核对",
      desc: "加强档 + 有标准答案或要取舍的问题多做几版独立解法；批评必须附反例或失败的测试",
    },
    {
      id: "marathon",
      label: "长跑档",
      numeral: "Ⅳ",
      art: "/laolao-deep-think-marathon.png?v=tierart3",
      motion: "/laolao-deep-think-marathon.webm?v=tiermotion2",
      short: "存档续跑直到做完",
      desc: "加强档 + 每个阶段写检查点，中断自动续跑，直到完成或报告明确卡点；适合长任务",
    },
  ];

  const readTier = () => {
    try {
      const sk = typeof currentSessionKey === "function" ? currentSessionKey() : "";
      const key = typeof STORAGE_KEY === "function" ? STORAGE_KEY(sk) : STORAGE_KEY;
      const value = localStorage.getItem(key) || "";
      return TIERS.some((tier) => tier.id === value) ? value : "";
    } catch { return ""; }
  };
  let selectedTier = readTier();

  const writeTier = (value) => {
    selectedTier = value;
    try {
      const sk = typeof currentSessionKey === "function" ? currentSessionKey() : "";
      const key = typeof STORAGE_KEY === "function" ? STORAGE_KEY(sk) : STORAGE_KEY;
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
    syncSelectionUi();
  };

  // 当前模式 (优先读 mode-switcher 写在 <html> 上的 data-laolao-mode)
  const currentMode = () => {
    const attr = document.documentElement.getAttribute("data-laolao-mode");
    if (attr && ["chat", "project", "thinking", "learning", "unrestricted"].includes(attr)) {
      return attr;
    }
    const routed = new URLSearchParams(window.location.search).get("session") || "";
    if (routed.startsWith("agent:project:")) return "project";
    if (routed.startsWith("agent:thinking:")) return "thinking";
    if (routed.startsWith("agent:learning:")) return "learning";
    if (routed.startsWith("agent:unrestricted:")) return "unrestricted";
    if (routed.startsWith("agent:main:")) return "chat";
    const el = document.querySelector(
      ".sidebar-recent-session--active[data-session-key]"
    );
    const key = el?.dataset.sessionKey || "";
    if (key.startsWith("agent:project:")) return "project";
    if (key.startsWith("agent:thinking:")) return "thinking";
    if (key.startsWith("agent:learning:")) return "learning";
    if (key.startsWith("agent:unrestricted:")) return "unrestricted";
    return "chat";
  };

  const currentSessionKey = () => {
    const routed = new URLSearchParams(window.location.search).get("session") || "";
    if (/^agent:(main|project|thinking|learning|unrestricted):/.test(routed)) return routed;
    const active = document.querySelector("[data-session-key].sidebar-recent-session--active");
    const key = active?.dataset?.sessionKey || "";
    return /^agent:(main|project|thinking|learning|unrestricted):/.test(key) ? key : "";
  };

  const toast = (msg) => {
    const shared = window.__laolaoToast;
    if (typeof shared === "function") shared(msg);
    else window.dispatchEvent(new CustomEvent("laolao:toast", {detail: {message: msg}}));
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
          void refreshStatus();
          return true;
        })
        .finally(() => { arming = null; });
    }
    return arming;
  };

  const disarmCurrent = async (preferredSessionKey = "") => {
    const sessionKey = preferredSessionKey || currentSessionKey();
    if (!sessionKey) { return false; }
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!sessionKey || typeof rpc !== "function") {
      console.warn("[deep-think] disarmCurrent ignored: no valid sessionKey for current view");
      return false;
    }
    if (!disarming) {
      disarming = (async () => {
        // 先撤掉档位与续跑器，再终止宿主仍在执行的父轮次/子任务。
        // 否则按钮虽然熄灭，OpenClaw 仍会把输入框保持在运行锁中。
        await rpc("pinkie.deepThink.disarm", { sessionKey }, 12_000);
        try {
          await rpc("chat.abort", { sessionKey, preserveSideRuns: false }, 12_000);
        } catch (error) {
          const nativeStop = $(".chat-send-btn--stop");
          if (nativeStop && !nativeStop.disabled) nativeStop.click();
          else throw error;
        }
        if (latestStatusSessionKey === sessionKey) {
          latestStatus = { active: false };
          hideStatus();
        }
        window.dispatchEvent(new Event("laolao:sessions-changed"));
        return true;
      })().finally(() => { disarming = null; });
    }
    return disarming;
  };

  const statusElement = () => document.getElementById(STATUS_ID);

  const hideStatus = () => {
    const panel = statusElement();
    if (panel) panel.hidden = true;
  };

  const ensureStatus = () => {
    let panel = statusElement();
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = STATUS_ID;
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML =
      "<button class='laolao-deep-think-status__summary' type='button' aria-expanded='false'>" +
      "<span class='laolao-deep-think-status__pulse' aria-hidden='true'></span>" +
      "<span class='laolao-deep-think-status__phase'></span>" +
      "<span class='laolao-deep-think-status__count'></span>" +
      "<span class='laolao-deep-think-status__chevron' aria-hidden='true'>⌄</span></button>" +
      "<div class='laolao-deep-think-status__track' aria-hidden='true'><span></span></div>" +
      "<div class='laolao-deep-think-status__details' hidden></div>";
    panel.querySelector(".laolao-deep-think-status__summary").addEventListener("click", () => {
      if (panel.dataset.sessionKey !== workSessionKey()) return;
      statusExpanded = !statusExpanded;
      panel.classList.toggle("is-expanded", statusExpanded);
      panel.querySelector(".laolao-deep-think-status__summary").setAttribute("aria-expanded", String(statusExpanded));
      panel.querySelector(".laolao-deep-think-status__details").hidden = !statusExpanded;
      requestAnimationFrame(positionStatus);
    });
    document.body.appendChild(panel);
    return panel;
  };

  const positionStatus = () => {
    const panel = statusElement();
    const actions = $(".agent-chat__composer-actions");
    if (!panel || panel.hidden || !actions?.isConnected) return;
    if (panel.dataset.sessionKey !== workSessionKey()) { hideStatus(); return; }
    const rect = actions.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    panel.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    panel.style.top = `${Math.max(12, rect.top - height - 9)}px`;
  };

  const setText = (node, value) => {
    if (node && node.textContent !== value) node.textContent = value;
  };

  const renderRoleDetails = (details, roles, failedChildren, workflow = null) => {
    const existing = new Map(
      Array.from(details.querySelectorAll(".laolao-deep-think-status__role"))
        .map((row) => [row.dataset.role || "", row])
    );
    const seen = new Set();
    const ensureRow = (key) => {
      let row = existing.get(key);
      if (!row) {
        row = document.createElement("div");
        row.className = "laolao-deep-think-status__role";
        row.dataset.role = key;
        row.append(document.createElement("span"), document.createElement("span"));
        details.append(row);
      }
      seen.add(key);
      return row;
    };
    if (workflow?.label) {
      const route = ensureRow("workflow-route");
      setText(route.children[0], "本次流程");
      setText(route.children[1], workflow.label);
      const stages = Array.isArray(workflow.stages) ? workflow.stages : [];
      const used = stages.filter((stage) => stage?.used).map((stage) => stage.label);
      const pending = stages.filter((stage) => !stage?.used).map((stage) => stage.label);
      const steps = ensureRow("workflow-stages");
      setText(steps.children[0], "已用 / 待用");
      setText(steps.children[1], (used.join("、") || "无") + " / " + (pending.join("、") || "无"));
    }
    for (const role of roles) {
      const key = String(role.role || role.label || "协作");
      seen.add(key);
      let row = existing.get(key);
      if (!row) {
        row = document.createElement("div");
        row.className = "laolao-deep-think-status__role";
        row.dataset.role = key;
        row.append(document.createElement("span"), document.createElement("span"));
        details.append(row);
      }
      setText(row.children[0], role.label || role.role || "协作");
      setText(row.children[1], `${Math.min(Number(role.completed) || 0, Number(role.required) || 0)}/${Number(role.required) || 0}${role.pending ? ` · ${role.pending} 进行中` : ""}`);
    }
    for (const [key, row] of existing) if (!seen.has(key)) row.remove();
    let retry = details.querySelector(".laolao-deep-think-status__retry");
    if (failedChildren) {
      if (!retry) {
        retry = document.createElement("div");
        retry.className = "laolao-deep-think-status__retry";
        details.append(retry);
      }
      setText(retry, `${failedChildren} 项已自动补位重试`);
    } else {
      retry?.remove();
    }
  };

  const renderStatus = (status = {}) => {
    latestStatus = status;
    if (status.active && !selectedTier && status.tier) {
      selectedTier = status.tier;
      writeTier(status.tier);
      render();
    }
    const endedRecently = status.complete && status.endedAt && Date.now() - status.endedAt < 12_000;
    const sessionKey = currentSessionKey();
    const endedAt = Number(status.endedAt) || 0;
    if (!status.active && status.complete && endedAt && refreshedCompletions.get(sessionKey) !== endedAt) {
      refreshedCompletions.set(sessionKey, endedAt);
      window.dispatchEvent(new CustomEvent("pinkie:tier-complete", {detail: {sessionKey, endedAt}}));
    }
    if (!status.active && !endedRecently) { hideStatus(); return; }
    const panel = ensureStatus();
    panel.dataset.sessionKey = sessionKey;
    const required = Math.max(0, Number(status.required) || 0);
    const completed = Math.min(required || Infinity, Math.max(0, Number(status.completed) || 0));
    const underway = Math.max(0, (Number(status.pending) || 0) + (Number(status.reserved) || 0));
    panel.hidden = false;
    panel.dataset.phase = status.phase || "working";
    panel.dataset.tier = status.tier || "";
    panel.classList.toggle("is-active", Boolean(status.active && !status.complete));
    setText(panel.querySelector(".laolao-deep-think-status__phase"), PHASE_LABELS[status.phase] || "协作处理中");
    setText(panel.querySelector(".laolao-deep-think-status__count"), required
      ? `${completed}/${required}${underway ? ` · ${underway} 项进行中` : ""}`
      : `${Number(status.spawned) || 0} 项协作`);
    const progress = required ? Math.round(completed / required * 1000) / 1000 : 0;
    const fill = panel.querySelector(".laolao-deep-think-status__track span");
    if (fill.dataset.progress !== String(progress)) {
      fill.dataset.progress = String(progress);
      fill.style.transform = `scaleX(${progress})`;
    }
    const details = panel.querySelector(".laolao-deep-think-status__details");
    const workflow = status.workflow || null;
    renderRoleDetails(details, Array.isArray(status.roles) ? status.roles : [], Number(status.failedChildren) || 0, workflow);
    if (workflow?.label) {
      const countLabel = required
        ? workflow.label + " · " + completed + "/" + required + (underway ? " · " + underway + " 项进行中" : "")
        : workflow.label;
      setText(panel.querySelector(".laolao-deep-think-status__count"), countLabel);
    }
    details.hidden = !statusExpanded;
    requestAnimationFrame(positionStatus);
  };

  const refreshStatus = async () => {
    const sessionKey = workSessionKey();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!sessionKey || sessionKey.includes(":subagent:") || typeof rpc !== "function" || statusRequest) return;
    const requestedSession = sessionKey;
    const request = {sessionKey, promise: rpc("pinkie.deepThink.status", {sessionKey}, 8_000)};
    statusRequest = request;
    try {
      const status = await request.promise;
      if (statusRequest !== request || requestedSession !== workSessionKey()) return;
      statusFailures = 0;
      latestStatusSessionKey = requestedSession;
      renderStatus(status);
    } catch {
      if (statusRequest !== request || requestedSession !== workSessionKey()) return;
      statusFailures += 1;
      if (statusFailures >= 3) hideStatus();
    } finally {
      if (statusRequest === request) statusRequest = null;
    }
  };

  const afterArm = async (send, isCurrent = () => true, draft = null) => {
    const ownerKey = currentSessionKey();
    let armedHere = false;
    try {
      if (!isCurrent()) return {status: 'cancelled'};
      if (latestStatus?.active) throw new Error("上一轮还在执行，完成后会自动显示终稿");
      await armSelected();
      armedHere = true;
      if (!isCurrent()) { await disarmCurrent(ownerKey); armedHere = false; return {status: 'cancelled'}; }
      if (typeof window.__laolaoWebGptPrepareNextTurn === "function") {
        const webResult = await window.__laolaoWebGptPrepareNextTurn(draft?.text || "", isCurrent);
        if (webResult === "cancelled") { await disarmCurrent(ownerKey); armedHere = false; return {status: 'cancelled'}; }
        if (webResult === "blocked") throw new Error("网页聊天未就绪；消息仍在输入框，未调用本地模型");
        if (webResult === "web-direct") {
          await disarmCurrent(ownerKey);
          armedHere = false;
          if (!isCurrent()) return {status: 'cancelled'};
          const input = draft?.input || $(".agent-chat__composer-combobox textarea");
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            if (setter) setter.call(input, ""); else input.value = "";
            input.dispatchEvent(new Event("input", {bubbles: true}));
          }
          await window.__laolaoRefreshCurrentChat?.();
          return {status: 'web-direct'};
        }
        window.__laolaoWebGptAllowNextSend?.();
      }
      if (!isCurrent()) { await disarmCurrent(ownerKey); armedHere = false; return {status: 'cancelled'}; }
      bypassSend = true;
      const resumed = send();
      if (resumed === false) { await disarmCurrent(ownerKey); armedHere = false; return {status: 'cancelled'}; }
      return {status: 'native'};
    } catch (error) {
      if (armedHere) await disarmCurrent(ownerKey);
      const reason = error?.message || "思考服务暂时不可用";
      toast(`${reason}，本条没有发送`);
      return {status: 'blocked', reason, notified: true};
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
      item.addEventListener("click", async () => {
        const disabling = selectedTier === tier.id;
        item.disabled = true;
        try {
          if (disabling) {
            const currentSk = currentSessionKey();
            if (currentSk) {
              await disarmCurrent(currentSk);
              writeTier("");
            }
          } else {
            writeTier(tier.id);
            for (const trigger of $$("." + BTN_CLASS)) {
              trigger.classList.remove("is-tier-enter");
              requestAnimationFrame(() => trigger.classList.add("is-tier-enter"));
              window.setTimeout(() => trigger.classList.remove("is-tier-enter"), 760);
            }
          }
          toast(disabling ? "当前档位已停止，恢复普通发送" : `${tier.label}已固定，之后发送都会使用`);
          closeMenu();
        } catch (error) {
          toast(`档位取消失败：${error?.message || "网关暂时不可用"}`);
          item.disabled = false;
        }
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
    if (actions.querySelector("." + BTN_CLASS)) { syncSelectionUi(); positionStatus(); return; }
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
    positionStatus();
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
#laolao-deep-think-status{position:fixed;z-index:2147482800;width:min(360px,calc(100vw - 24px));overflow:hidden;contain:layout paint style;border:1px solid rgba(255,255,255,.72);border-radius:16px;background:linear-gradient(145deg,rgba(255,252,253,.9),rgba(249,226,239,.84));color:#633a50;box-shadow:0 12px 32px rgba(97,48,73,.14),inset 0 1px rgba(255,255,255,.78);animation:laolao-status-in .22s cubic-bezier(.2,.78,.28,1) both}#laolao-deep-think-status[hidden]{display:none!important}.laolao-deep-think-status__summary{display:grid;grid-template-columns:10px 1fr auto 12px;align-items:center;gap:7px;width:100%;padding:9px 11px 7px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.laolao-deep-think-status__pulse{width:7px;height:7px;border-radius:50%;background:#d85b91;box-shadow:0 0 0 0 rgba(216,91,145,.28);animation:laolao-status-pulse 1.55s ease-out infinite}#laolao-deep-think-status[data-phase="done"] .laolao-deep-think-status__pulse,#laolao-deep-think-status[data-phase="summarizing"] .laolao-deep-think-status__pulse{background:#62b493}#laolao-deep-think-status[data-phase="done"] .laolao-deep-think-status__pulse{animation:none}.laolao-deep-think-status__phase{min-width:0;overflow:hidden;font-size:11.5px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.laolao-deep-think-status__count{font-size:10px;color:rgba(99,58,80,.62);white-space:nowrap}.laolao-deep-think-status__chevron{font-size:10px;transition:transform .2s cubic-bezier(.2,.78,.28,1)}.is-expanded .laolao-deep-think-status__chevron{transform:rotate(180deg)}.laolao-deep-think-status__track{position:relative;height:3px;margin:0 11px 8px;overflow:hidden;border-radius:999px;background:rgba(165,91,125,.13)}.laolao-deep-think-status__track span{display:block;width:100%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#dc6ca0 0%,#d85b91 48%,#9f74c6 100%);transform:scaleX(0);transform-origin:left center;transition:transform .72s cubic-bezier(.18,.82,.24,1);will-change:transform}.laolao-deep-think-status__track::after{content:"";position:absolute;inset:0 auto 0 -45%;width:42%;border-radius:inherit;background:linear-gradient(90deg,transparent,rgba(255,255,255,.76),transparent);opacity:0;transform:translate3d(0,0,0)}#laolao-deep-think-status.is-active .laolao-deep-think-status__track::after{opacity:.85;animation:laolao-status-flow 1.65s ease-in-out infinite}.laolao-deep-think-status__details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 10px;padding:0 11px 10px;border-top:1px solid rgba(159,82,119,.09)}.laolao-deep-think-status__details[hidden]{display:none}.laolao-deep-think-status__role{display:flex;justify-content:space-between;gap:8px;padding-top:7px;font-size:9.5px;color:rgba(88,52,70,.7)}.laolao-deep-think-status__role span:last-child{color:rgba(88,52,70,.48);white-space:nowrap}.laolao-deep-think-status__retry{grid-column:1/-1;padding-top:6px;color:#b36b4f;font-size:9px}
html[data-theme-mode="dark"] .laolao-deep-think-menu{color:#57364a;background:linear-gradient(145deg,rgba(255,249,252,.84),rgba(245,218,234,.72));border-color:rgba(255,255,255,.62);box-shadow:0 18px 44px rgba(84,42,65,.18),inset 0 1px rgba(255,255,255,.66)}
@keyframes laolao-think-menu-in{from{opacity:0;transform:translateY(6px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes laolao-tier-item-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes laolao-tier-trigger{0%{transform:scale(.9)}42%{box-shadow:0 0 0 8px color-mix(in srgb,var(--tier-accent) 13%,transparent),0 4px 16px color-mix(in srgb,var(--tier-accent) 22%,transparent)}100%{transform:scale(1)}}
@keyframes laolao-tier-breathe{50%{box-shadow:inset 0 1px rgba(255,255,255,.72),0 0 0 4px color-mix(in srgb,var(--tier-accent) 10%,transparent)}}
@keyframes laolao-tier-twinkle{50%{opacity:1;transform:rotate(45deg) scale(.82)}}
@keyframes laolao-tier-orbit{to{transform:rotate(360deg)}}
@keyframes laolao-status-in{from{opacity:0;transform:translateY(5px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes laolao-status-pulse{70%{box-shadow:0 0 0 6px rgba(216,91,145,0)}100%{box-shadow:0 0 0 0 rgba(216,91,145,0)}}
@keyframes laolao-status-flow{0%{transform:translate3d(0,0,0)}65%,100%{transform:translate3d(345%,0,0)}}
@media(max-width:600px){.laolao-deep-think-menu{width:min(310px,calc(100vw - 16px))}.laolao-deep-think-menu__item{grid-template-columns:28px 1fr;padding:5px 6px}.laolao-deep-think-menu__icon{width:27px;height:27px}}
@media (prefers-reduced-motion: reduce){.laolao-deep-think-btn,.laolao-deep-think-menu,.laolao-deep-think-menu__item,.laolao-deep-think-menu__icon,.laolao-deep-think-menu__orbit,#laolao-deep-think-toast,#laolao-deep-think-status,.laolao-deep-think-status__pulse,.laolao-deep-think-status__track span,.laolao-deep-think-status__track::after{animation:none!important;transition:none!important}.laolao-deep-think-menu__art,.laolao-deep-think-btn__art{display:none!important}}
`;
    document.head.appendChild(style);
  };

  /* ---------- 后台工作小面板 ----------
     子代理、独立解答与批评、后台命令都在这里：收起是输入框右上方的一颗小胶囊，点开是一张小卡片，
     点某一行就在卡片里看它的完整结果。不进左侧聊天列表，也不往聊天正文里插消息。
     数据来自 pinkie.work.status（mode-architecture/index.mjs）。旧的档位胶囊和 Max/Ultra 进度条由它取代。 */
  const WORK_ID = "pinkie-work-panel";
  const WORK_PHASES = {
    armed: "正在准备推演",
    answering: "碧琪在回答", reviewing: "正在批评与核对", fixing: "按批评修改中", passed: "核对通过",
    fixed: "已按批评修正", unresolved: "仍有问题，回复里已说明", unchecked: "这次没核对成", skipped: "这次没核对",
  };
  const WORK_LEVELS = {medium: "Medium", high: "High", xhigh: "XHigh", adaptive: "Adaptive", max: "Max", ultra: "Ultra", boost: "加强档", full: "全开档", marathon: "长跑档"};
  const ACTIVE_REVIEW = new Set(["armed", "answering", "reviewing", "fixing"]);
  let workExpanded = false;
  let workDetail = "";
  let workRequest = null;
  let workLastActive = 0;
  let workSession = "";
  let workNextPoll = 0;
  let workGeneration = 0;

  const workSessionKey = () => {
    const key = currentSessionKey();
    const agent = /^agent:([^:]+):/.exec(key)?.[1];
    const modeAgent = {chat: "main", project: "project", thinking: "thinking", learning: "learning", unrestricted: "unrestricted"}[currentMode()];
    return agent && agent === modeAgent ? key : "";
  };

  function resetWorkSession(sessionKey = workSessionKey()) {
    workGeneration++;
    workSession = sessionKey;
    workRequest = null;
    workNextPoll = 0;
    workExpanded = false;
    workDetail = "";
    workLastActive = 0;
    workAnchorResize.disconnect(); workAnchorChanges.disconnect(); workAnchor = null;
    window.__pinkieWorkLatest = null;
    const panel = document.getElementById(WORK_ID);
    if (panel) { panel.hidden = true; delete panel.dataset.sessionKey; }
    document.documentElement.removeAttribute("data-pinkie-work");
    // The legacy four-tier capsule shares this session boundary as well.
    statusRequest = null;
    latestStatusSessionKey = "";
    latestStatus = {active: false};
    selectedTier = sessionKey ? readTier() : "";
    syncSelectionUi();
    statusExpanded = false;
    statusFailures = 0;
    hideStatus();
  }

  function syncWorkSession() {
    const key = workSessionKey();
    if (key !== workSession) resetWorkSession(key);
    return key;
  }

  const ownsWorkPanel = panel => panel?.dataset.sessionKey === workSessionKey() && workSession === workSessionKey();

  const shortModel = (ref) => {
    const id = String(ref || "").split("/").pop().replace(/-(?:tiered|thinking|preview)$/i, "");
    return id.split("-").map((part) => (/^(?:gpt|glm)$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))).join(" ");
  };
  const clock = (ms) => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  // 状态图标用内联 SVG：进行中是转动的弧线，完成时画出一个勾，失败是感叹号。
  const STATE_ICONS = {
    running: "<svg viewBox='0 0 16 16' aria-hidden='true'><circle class='pinkie-work__track' cx='8' cy='8' r='6'/><path class='pinkie-work__arc' d='M8 2a6 6 0 0 1 6 6'/></svg>",
    done: "<svg viewBox='0 0 16 16' aria-hidden='true'><circle class='pinkie-work__ring' cx='8' cy='8' r='6'/><path class='pinkie-work__tick' d='M5.2 8.4l1.9 1.9 3.8-4.1'/></svg>",
    failed: "<svg viewBox='0 0 16 16' aria-hidden='true'><circle class='pinkie-work__ring' cx='8' cy='8' r='6'/><path d='M8 4.9v3.6'/><path d='M8 11.1v.01'/></svg>",
  };
  const setIcon = (node, state) => {
    const key = STATE_ICONS[state] ? state : "done";
    if (node.dataset.icon === key) return;
    node.dataset.icon = key;
    node.innerHTML = STATE_ICONS[key];
  };

  function workRows(status) {
    const rows = [];
    for (const job of status?.reasoning?.jobs || []) {
      rows.push({key: `job:${job.id}`, kind: "job", id: job.id, state: job.state, title: job.label || "协作", model: job.model,
        summary: job.summary, startedAt: job.startedAt, endedAt: job.endedAt, hasOutput: job.hasOutput});
    }
    for (const child of status?.tier?.children || []) {
      rows.push({key: `child:${child.id}`, kind: "child", id: child.id, state: child.state, title: child.roleLabel || "协作", model: child.model,
        summary: child.summary || (child.state === "running" ? "进行中…" : ""), startedAt: child.startedAt, endedAt: child.endedAt, hasOutput: child.hasOutput});
    }
    for (const bg of status?.background || []) {
      rows.push({key: `bg:${bg.id}`, kind: "bg", id: bg.id, state: bg.state === "running" ? "running" : "done", title: "后台命令", model: "",
        summary: bg.state === "running" ? bg.command : `${bg.command}${bg.woke ? " · 已叫醒碧琪" : ""}`, startedAt: bg.startedAt, endedAt: bg.endedAt, hasOutput: false});
    }
    return rows;
  }

  function workHeadline(status, rows) {
    const review = status?.reasoning || {};
    const level = WORK_LEVELS[review.level] || review.level || "";
    if (review.phase && WORK_PHASES[review.phase]) {
      const round = review.phase === "fixing" && review.round ? ` · 第 ${review.round} 轮` : "";
      return `${level ? level + " · " : ""}${WORK_PHASES[review.phase]}${round}`;
    }
    if (status?.tier?.active) return PHASE_LABELS[status.tier.phase] || "协作处理中";
    const running = rows.filter((row) => row.kind === "bg" && row.state === "running").length;
    if (running) return `后台命令 · ${running} 个在跑`;
    return "后台工作已完成";
  }

  const ensureWorkPanel = () => {
    let panel = document.getElementById(WORK_ID);
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = WORK_ID;
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML =
      "<button class='pinkie-work__pill' type='button' aria-expanded='false'>" +
      "<span class='pinkie-work__dot pinkie-work__icon' aria-hidden='true'></span><span class='pinkie-work__title'></span>" +
      "<span class='pinkie-work__count'></span><span class='pinkie-work__time'></span><span class='pinkie-work__chevron' aria-hidden='true'>⌃</span></button>" +
      "<div class='pinkie-work__card' hidden><div class='pinkie-work__head'><span>后台工作</span>" +
      "<button class='pinkie-work__stop' type='button' hidden>停止核对</button></div>" +
      "<div class='pinkie-work__rows' role='list'></div><div class='pinkie-work__detail' hidden></div></div>";
    panel.querySelector(".pinkie-work__pill").addEventListener("click", () => {
      if (!ownsWorkPanel(panel)) return;
      workExpanded = !workExpanded;
      if (!workExpanded) workDetail = "";
      renderWork(window.__pinkieWorkLatest);
    });
    panel.querySelector(".pinkie-work__stop").addEventListener("click", () => {
      if (!ownsWorkPanel(panel)) return;
      const sessionKey = workSessionKey();
      const requestId = window.__pinkieWorkLatest?.reasoning?.requestId || "";
      document.dispatchEvent(new CustomEvent("pinkie:reasoning-cancel", {detail: {sessionKey, requestId}}));
      void window.__laolaoSidebar?.gwRequest?.("pinkie.reasoning.cancel", {sessionKey, requestId}, 10_000).catch(() => {});
    });
    panel.querySelector(".pinkie-work__rows").addEventListener("click", (event) => {
      if (!ownsWorkPanel(panel)) return;
      const row = event.target.closest?.(".pinkie-work__row[data-has-output='1']");
      if (!row) return;
      workDetail = workDetail === row.dataset.key ? "" : row.dataset.key;
      renderWork(window.__pinkieWorkLatest);
      if (workDetail) void loadWorkDetail(row.dataset.kind, row.dataset.id, row.dataset.key);
    });
    document.body.appendChild(panel);
    return panel;
  };

  async function loadWorkDetail(kind, id, key) {
    const sessionKey = workSessionKey();
    const generation = workGeneration;
    const panel = ensureWorkPanel();
    if (!sessionKey || !ownsWorkPanel(panel)) return;
    const box = panel.querySelector(".pinkie-work__detail");
    box.textContent = "读取中…";
    try {
      const result = await window.__laolaoSidebar?.gwRequest?.("pinkie.work.detail", {sessionKey, kind, id}, 10_000);
      if (generation !== workGeneration || sessionKey !== workSessionKey() || workDetail !== key) return;
      if (result?.sessionKey !== sessionKey) throw new Error("详情会话不匹配");
      box.textContent = result?.found ? (result.output || "（没有内容）") : "这一项的结果已经清理掉了";
    } catch {
      if (generation === workGeneration && sessionKey === workSessionKey() && workDetail === key) box.textContent = "暂时读不到结果";
    }
    requestAnimationFrame(positionWork);
  }

  let workAnchor = null;
  const workAnchorResize = new ResizeObserver(() => requestAnimationFrame(positionWork));
  const workAnchorChanges = new MutationObserver(() => requestAnimationFrame(positionWork));
  // Keep the result above the composer, and reserve a separate row when the
  // native New messages control occupies the same area in a narrow pane.
  const positionWork = () => {
    const panel = document.getElementById(WORK_ID);
    const actions = $(".agent-chat__composer-actions");
    const shell = $(".agent-chat__input") || $(".agent-chat__composer-shell") || actions;
    if (!panel || panel.hidden || !shell?.isConnected) return;
    if (!ownsWorkPanel(panel)) { resetWorkSession(); return; }
    if (workAnchor !== shell) {
      workAnchor = shell;
      workAnchorResize.disconnect(); workAnchorResize.observe(shell);
      workAnchorChanges.disconnect(); workAnchorChanges.observe(shell, {childList: true});
    }
    const rect = shell.getBoundingClientRect();
    const right = rect.right;
    panel.style.maxWidth = `${Math.max(120, Math.min(340, rect.width - 16, window.innerWidth - 24))}px`;
    const card = panel.querySelector(".pinkie-work__card");
    const width = panel.offsetWidth;
    const left = Math.max(12, Math.min(right - width, window.innerWidth - width - 12));
    panel.style.left = `${left}px`;
    const pill = panel.querySelector(".pinkie-work__pill").getBoundingClientRect();
    const hit = card && !card.hidden ? panel.getBoundingClientRect() : pill;
    let ceiling = rect.top - 8;
    const pane = shell.closest(".chat-pane, .agent-chat") || shell.parentElement;
    for (const button of pane.querySelectorAll(".chat-new-messages")) {
      if (button.hidden || getComputedStyle(button).visibility === "hidden") continue;
      const b = button.getBoundingClientRect();
      if (b.width && b.height && hit.left < b.right + 8 && hit.right > b.left - 8) ceiling = Math.min(ceiling, b.top - 10);
    }
    if (card && !card.hidden) card.style.maxHeight = `${Math.max(40, ceiling - pill.height - 24)}px`;
    panel.style.top = `${Math.max(12, ceiling - panel.offsetHeight)}px`;
  };

  function renderWork(status) {
    const sessionKey = syncWorkSession();
    if (!sessionKey || status?.sessionKey !== sessionKey) return;
    const rows = workRows(status);
    const review = status?.reasoning || {};
    const running = rows.some((row) => row.state === "running");
    const active = running || ACTIVE_REVIEW.has(review.phase) || Boolean(status?.tier?.active && !status.tier.complete);
    const now = Date.now();
    if (active) workLastActive = now;
    // 做完后留 20 秒给人看一眼结果；点开着的卡片不自动收走。
    const endedAt = Math.max(0, Number(review.updatedAt) || 0, Number(status?.tier?.endedAt) || 0, ...rows.map(row => Number(row.endedAt) || 0));
    const recent = now - Math.max(workLastActive, endedAt) < 20_000;
    const visible = (rows.length > 0 || active) && (active || recent || workExpanded);
    const panel = visible ? ensureWorkPanel() : document.getElementById(WORK_ID);
    if (!panel) return;
    panel.hidden = !visible;
    panel.dataset.sessionKey = sessionKey;
    document.documentElement.toggleAttribute("data-pinkie-work", visible);
    if (!visible) { workExpanded = false; workDetail = ""; return; }
    if (workDetail && !rows.some((row) => row.key === workDetail)) workDetail = "";
    panel.classList.toggle("is-active", active);
    setIcon(panel.querySelector(".pinkie-work__dot"), active ? "running" : rows.some((row) => row.state === "failed") && !rows.some((row) => row.state === "done") ? "failed" : "done");
    panel.classList.toggle("is-expanded", workExpanded);
    const done = rows.filter((row) => row.state !== "running").length;
    const started = rows.filter((row) => row.state === "running").map((row) => row.startedAt).filter(Boolean);
    setText(panel.querySelector(".pinkie-work__title"), workHeadline(status, rows));
    setText(panel.querySelector(".pinkie-work__count"), rows.length ? `${done}/${rows.length}` : "");
    setText(panel.querySelector(".pinkie-work__time"), started.length ? clock(now - Math.min(...started)) : "");
    panel.querySelector(".pinkie-work__pill").setAttribute("aria-expanded", String(workExpanded));
    const card = panel.querySelector(".pinkie-work__card");
    card.hidden = !workExpanded;
    panel.querySelector(".pinkie-work__stop").hidden = !ACTIVE_REVIEW.has(review.phase);
    if (workExpanded) {
      const list = panel.querySelector(".pinkie-work__rows");
      const existing = new Map(Array.from(list.children).map((node) => [node.dataset.key, node]));
      const seen = new Set();
      for (const row of rows) {
        let node = existing.get(row.key);
        if (!node) {
          node = document.createElement("div");
          node.className = "pinkie-work__row";
          node.setAttribute("role", "listitem");
          node.innerHTML = "<span class='pinkie-work__state pinkie-work__icon' aria-hidden='true'></span><span class='pinkie-work__main'><span class='pinkie-work__name'></span><span class='pinkie-work__sum'></span></span><span class='pinkie-work__clock'></span>";
          node.dataset.key = row.key;
          list.append(node);
        }
        seen.add(row.key);
        node.dataset.kind = row.kind;
        node.dataset.id = row.id;
        node.dataset.state = row.state;
        node.dataset.hasOutput = row.hasOutput ? "1" : "0";
        node.classList.toggle("is-open", workDetail === row.key);
        setIcon(node.querySelector(".pinkie-work__state"), row.state);
        setText(node.querySelector(".pinkie-work__name"), row.model ? `${row.title} · ${shortModel(row.model)}` : row.title);
        setText(node.querySelector(".pinkie-work__sum"), row.summary || (row.state === "running" ? "进行中…" : ""));
        setText(node.querySelector(".pinkie-work__clock"), row.startedAt ? clock((row.endedAt || now) - row.startedAt) : "");
      }
      for (const [key, node] of existing) if (!seen.has(key)) node.remove();
      const detail = panel.querySelector(".pinkie-work__detail");
      detail.hidden = !workDetail;
    }
    requestAnimationFrame(positionWork);
  }

  async function refreshWork() {
    const sessionKey = syncWorkSession();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!sessionKey || sessionKey.includes(":subagent:") || typeof rpc !== "function" || workRequest) return;
    if (Date.now() < workNextPoll) return;
    const generation = workGeneration;
    const request = {sessionKey, promise: rpc("pinkie.work.status", {sessionKey}, 8_000)};
    workRequest = request;
    try {
      const status = await request.promise;
      if (workRequest !== request || generation !== workGeneration || sessionKey !== workSessionKey()) return;
      if (status?.sessionKey !== sessionKey) throw new Error("任务状态会话不匹配");
      window.__pinkieWorkLatest = status;
      renderWork(status);
      const idle = !document.documentElement.hasAttribute("data-pinkie-work");
      workNextPoll = Date.now() + (idle ? 2_500 : 900);
    } catch {
      if (workRequest === request && generation === workGeneration && sessionKey === workSessionKey()) workNextPoll = Date.now() + 5_000;
    } finally {
      if (workRequest === request) workRequest = null;
    }
  }

  const ensureWorkStyle = () => {
    if (document.getElementById("pinkie-work-style")) return;
    const style = document.createElement("style");
    style.id = "pinkie-work-style";
    style.textContent = `
#${WORK_ID}{position:fixed;z-index:2147482810;width:min(340px,calc(100vw - 24px));color:#5d3550;font-size:12px;contain:layout style}
#${WORK_ID}[hidden]{display:none!important}
html[data-pinkie-work] #laolao-deep-think-status,html[data-pinkie-work] #pinkie-reasoning-progress{display:none!important}
.pinkie-work__pill{display:flex;align-items:center;gap:7px;margin-left:auto;max-width:100%;padding:6px 12px;border:1px solid rgba(255,255,255,.7);border-radius:999px;background:linear-gradient(145deg,rgba(255,252,253,.9),rgba(249,226,239,.84));color:inherit;box-shadow:0 8px 22px rgba(97,48,73,.13),inset 0 1px rgba(255,255,255,.78);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);cursor:pointer;font:inherit}
.pinkie-work__icon{display:grid;flex:none;place-items:center;width:14px;height:14px;color:#62b493}
.pinkie-work__icon svg{width:14px;height:14px;overflow:visible;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.pinkie-work__icon[data-icon="running"]{color:#d85b91}.pinkie-work__icon[data-icon="failed"]{color:#c9774b}
.pinkie-work__track{opacity:.22}.pinkie-work__ring{opacity:.28}
.pinkie-work__icon[data-icon="running"] svg{animation:pinkie-work-spin .9s linear infinite;transform-origin:50% 50%}
.pinkie-work__tick{stroke-dasharray:10;stroke-dashoffset:10;animation:pinkie-work-draw .42s cubic-bezier(.2,.8,.3,1) .05s forwards}
.pinkie-work__title{min-width:0;overflow:hidden;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
.pinkie-work__count,.pinkie-work__time{flex:none;color:rgba(93,53,80,.6);font-size:11px;font-variant-numeric:tabular-nums}
.pinkie-work__chevron{flex:none;font-size:10px;transition:transform .2s ease}
#${WORK_ID}.is-expanded .pinkie-work__chevron{transform:rotate(180deg)}
.pinkie-work__card{margin-top:6px;padding:9px 10px 10px;overflow:auto;overscroll-behavior:contain;border:1px solid rgba(255,255,255,.72);border-radius:14px;background:linear-gradient(145deg,rgba(255,252,253,.94),rgba(249,229,240,.9));box-shadow:0 14px 34px rgba(97,48,73,.16),inset 0 1px rgba(255,255,255,.78);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px)}
.pinkie-work__card[hidden]{display:none}
.pinkie-work__head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:650}
.pinkie-work__stop{padding:2px 9px;border:1px solid rgba(176,80,124,.28);border-radius:999px;background:transparent;color:#a3426c;font:inherit;font-size:11px;cursor:pointer}
.pinkie-work__stop[hidden]{display:none}
.pinkie-work__rows{display:flex;flex-direction:column;gap:2px;max-height:min(36vh,280px);overflow:auto;overscroll-behavior:contain}
.pinkie-work__row{display:grid;grid-template-columns:12px minmax(0,1fr) auto;align-items:start;gap:7px;padding:5px 6px;border-radius:9px}
.pinkie-work__row[data-has-output="1"]{cursor:pointer}
.pinkie-work__row[data-has-output="1"]:hover,.pinkie-work__row.is-open{background:rgba(214,96,154,.09)}
.pinkie-work__state{margin-top:2px}
.pinkie-work__main{display:flex;min-width:0;flex-direction:column;gap:1px}
.pinkie-work__name{overflow:hidden;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.pinkie-work__sum{overflow:hidden;color:rgba(93,53,80,.62);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.pinkie-work__clock{color:rgba(93,53,80,.55);font-size:11px;font-variant-numeric:tabular-nums}
.pinkie-work__detail{max-height:min(42vh,360px);margin-top:7px;padding:8px 9px;overflow:auto;border-radius:10px;background:rgba(255,255,255,.62);white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.55}
.pinkie-work__detail[hidden]{display:none}
html[data-theme-mode="dark"] #${WORK_ID},html[data-pinkie-night] #${WORK_ID}{color:#ecdff0}
html[data-theme-mode="dark"] .pinkie-work__pill,html[data-pinkie-night] .pinkie-work__pill,html[data-theme-mode="dark"] .pinkie-work__card,html[data-pinkie-night] .pinkie-work__card{border-color:rgba(255,255,255,.12);background:linear-gradient(145deg,rgba(38,26,48,.9),rgba(28,20,40,.88));box-shadow:0 12px 30px rgba(0,0,0,.35),inset 0 1px rgba(255,255,255,.06)}
html[data-theme-mode="dark"] .pinkie-work__count,html[data-theme-mode="dark"] .pinkie-work__time,html[data-theme-mode="dark"] .pinkie-work__sum,html[data-theme-mode="dark"] .pinkie-work__clock,html[data-pinkie-night] .pinkie-work__count,html[data-pinkie-night] .pinkie-work__time,html[data-pinkie-night] .pinkie-work__sum,html[data-pinkie-night] .pinkie-work__clock{color:rgba(236,223,240,.6)}
html[data-theme-mode="dark"] .pinkie-work__detail,html[data-pinkie-night] .pinkie-work__detail{background:rgba(255,255,255,.06)}
html[data-theme-mode="dark"] .pinkie-work__stop,html[data-pinkie-night] .pinkie-work__stop{color:#f2a6c8;border-color:rgba(242,166,200,.3)}
@keyframes pinkie-work-spin{to{transform:rotate(360deg)}}
@keyframes pinkie-work-draw{to{stroke-dashoffset:0}}
html[data-theme-mode="dark"] .pinkie-work__icon[data-icon="running"],html[data-pinkie-night] .pinkie-work__icon[data-icon="running"]{color:#f08cba}
html[data-theme-mode="dark"] .pinkie-work__icon,html[data-pinkie-night] .pinkie-work__icon{color:#7fd0ad}
html[data-theme-mode="dark"] .pinkie-work__icon[data-icon="failed"],html[data-pinkie-night] .pinkie-work__icon[data-icon="failed"]{color:#e39a6f}
@media (prefers-reduced-motion: reduce){.pinkie-work__icon svg,.pinkie-work__chevron{animation:none!important;transition:none!important}.pinkie-work__tick{stroke-dashoffset:0}}
`;
    document.head.appendChild(style);
  };
  ensureWorkStyle();

  // 重渲染自愈
  let scheduled = false;
  const scheduleRender = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  };
  // 输入区由 Lit 重建；低频轮询足够且不会在流式输出时制造 MutationObserver 风暴。
  window.setInterval(scheduleRender, 700);
  window.setInterval(() => { if (!document.hidden) void refreshStatus(); }, 900);
  window.setInterval(() => { syncWorkSession(); if (!document.hidden) void refreshWork(); }, 450);
  window.addEventListener("resize", positionStatus, {passive: true});
  window.addEventListener("resize", positionWork, {passive: true});
  const workSessionChanged = () => { syncWorkSession(); workNextPoll = 0; void refreshStatus(); void refreshWork(); };
  window.addEventListener("popstate", workSessionChanged);
  window.addEventListener("pinkie:session-selected", workSessionChanged);
  new MutationObserver(() => {
    const previous = workSession;
    syncWorkSession();
    if (previous !== workSession) void refreshWork();
  }).observe(document.documentElement, {attributes: true, attributeFilter: ["data-laolao-mode"]});
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
    if (!window.__laolaoStartupHome?.delegateNativeSend?.(button, afterArm)) void afterArm(() => button.click());
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
