/* Manual context compaction for every chat mode. Uses OpenClaw's native
   sessions.compact RPC directly, so no slash-command message appears in chat. */
(() => {
  "use strict";

  const BUTTON_CLASS = "laolao-context-compact-btn";
  const POPOVER_ID = "laolao-context-compact-popover";
  let busy = false;
  let popover = null;
  let usage = null;
  let usageKey = "";
  let usageFetchedAt = 0;
  let usageRequest = null;

  const currentSessionKey = () => {
    const routed = new URLSearchParams(location.search).get("session") || "";
    if (/^agent:(main|project|thinking|learning|unrestricted):/.test(routed)) return routed;
    const active = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    return active?.dataset?.sessionKey || "";
  };

  const toast = (message) => {
    const shared = window.__laolaoToast;
    if (typeof shared === "function") shared(message);
    else window.dispatchEvent(new CustomEvent("laolao:toast", {detail: {message}}));
  };

  const closePopover = () => {
    popover?.remove();
    popover = null;
    document.querySelector(`.${BUTTON_CLASS}`)?.setAttribute("aria-expanded", "false");
  };

  const formatTokens = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number).toLocaleString() : "";
  };

  const contextCapacity = (session, defaults) => {
    if (session?.totalTokens == null) return null;
    const used = Number(session?.totalTokens);
    const limit = Number(session?.contextTokens || defaults?.contextTokens);
    if (!Number.isFinite(used) || used < 0 || !Number.isFinite(limit) || limit <= 0) return null;
    const percent = Math.min(100, Math.round(used / limit * 100));
    return {used, limit, percent, approximate: session?.totalTokensFresh === false};
  };

  const fetchContextCapacity = () => {
    const key = currentSessionKey();
    if (key !== usageKey) {
      usageKey = key;
      usage = null;
      usageFetchedAt = 0;
    }
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!key || typeof rpc !== "function" || usageRequest || Date.now() - usageFetchedAt < 15000) return;
    usageFetchedAt = Date.now();
    const agentId = key.split(":")[1];
    usageRequest = Promise.resolve(rpc("sessions.list", {agentId, limit: 1000}, 15000))
      .then((result) => {
        if (usageKey !== key) return;
        const session = result?.sessions?.find?.((item) => item.key === key);
        usage = contextCapacity(session, result?.defaults);
        renderContextViewer();
      })
      .catch(() => {})
      .finally(() => { usageRequest = null; });
  };

  const renderContextViewer = () => {
    const metas = document.querySelectorAll(".agent-chat__composer-meta");
    document.querySelectorAll(".laolao-context-viewer").forEach((node) => {
      if (!node.closest(".agent-chat__composer-meta") || metas.length !== 1) node.remove();
    });
    // The upstream meter takes precedence. Only repair its missing-data case.
    if (metas.length !== 1 || !usageKey) return;
    const meta = metas[0];
    if (meta.querySelector(".context-usage")) {
      meta.querySelector(".laolao-context-viewer")?.remove();
      return;
    }
    let viewer = meta.querySelector(".laolao-context-viewer");
    if (!viewer) {
      viewer = document.createElement("details");
      viewer.className = "laolao-context-viewer";
      viewer.innerHTML = `<summary><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" class="laolao-context-viewer__track"/><circle cx="8" cy="8" r="6.5" class="laolao-context-viewer__fill"/></svg><span class="laolao-context-viewer__percent"></span></summary><section class="laolao-context-viewer__popover"><strong>上下文容量</strong><div class="laolao-context-viewer__amount"></div><div class="laolao-context-viewer__bar"><span></span></div><small class="laolao-context-viewer__note"></small></section>`;
      meta.append(viewer);
    }
    const ratio = usageKey === currentSessionKey() ? usage : null;
    const label = ratio ? `${ratio.approximate ? "约 " : ""}${ratio.percent}%` : "—";
    const setText = (selector, value) => {
      const node = viewer.querySelector(selector);
      if (node.textContent !== value) node.textContent = value;
    };
    setText(".laolao-context-viewer__percent", label);
    setText(".laolao-context-viewer__amount", ratio
      ? `${formatTokens(ratio.used)} / ${formatTokens(ratio.limit)} token` : "等待会话用量数据");
    setText(".laolao-context-viewer__note", ratio
      ? `${ratio.approximate ? "估算 · " : ""}剩余约 ${formatTokens(Math.max(0, ratio.limit - ratio.used))} token` : "有用量数据后会自动更新，不显示虚构百分比");
    const offset = String(40.84 * (1 - (ratio?.percent || 0) / 100));
    const fill = viewer.querySelector(".laolao-context-viewer__fill");
    if (fill.style.strokeDashoffset !== offset) fill.style.strokeDashoffset = offset;
    const width = `${ratio?.percent || 0}%`;
    const bar = viewer.querySelector(".laolao-context-viewer__bar span");
    if (bar.style.width !== width) bar.style.width = width;
    const summary = viewer.querySelector("summary");
    const aria = ratio ? `上下文容量：已用${label}，${formatTokens(ratio.used)} / ${formatTokens(ratio.limit)} token` : "上下文容量：等待用量数据";
    if (summary.getAttribute("aria-label") !== aria) summary.setAttribute("aria-label", aria);
  };

  const compact = async (button) => {
    if (busy) return;
    if (document.querySelector(".chat-send-btn--stop")) {
      toast("当前回复完成后再整理上下文");
      return;
    }
    const key = currentSessionKey();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!key || key.includes(":subagent:") || typeof rpc !== "function") {
      toast("当前会话还没连接好");
      return;
    }
    busy = true;
    closePopover();
    button.classList.add("is-running");
    button.disabled = true;
    button.setAttribute("aria-label", "正在整理上下文");
    toast("正在整理较早内容，最近对话会原样保留");
    try {
      const agentId = key.split(":")[1] || undefined;
      const result = await rpc("sessions.compact", {key, agentId}, 600_000);
      if (!result?.ok) throw new Error(result?.reason || "整理没有完成");
      const before = formatTokens(result.result?.tokensBefore);
      const after = formatTokens(result.result?.tokensAfter);
      const detail = before && after ? `（${before} → ${after}）` : "";
      toast(result.compacted ? `上下文已整理${detail}` : (result.reason || "当前内容暂时不需要整理"));
      window.dispatchEvent(new Event("laolao:sessions-changed"));
    } catch (error) {
      toast(`整理失败：${error?.message || error}`);
    } finally {
      busy = false;
      button.classList.remove("is-running");
      button.disabled = false;
      button.setAttribute("aria-label", "手动整理上下文");
    }
  };

  const openPopover = (button) => {
    if (popover) { closePopover(); return; }
    popover = document.createElement("section");
    popover.id = POPOVER_ID;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "手动整理上下文");
    const copy = document.createElement("div");
    copy.className = "laolao-context-compact__copy";
    const title = document.createElement("strong");
    title.textContent = "整理上下文";
    const desc = document.createElement("span");
    desc.textContent = "浓缩较早内容，最近对话和工作检查点继续保留。";
    copy.append(title, desc);
    const actions = document.createElement("div");
    actions.className = "laolao-context-compact__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", closePopover);
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "is-primary";
    confirm.textContent = "开始整理";
    confirm.addEventListener("click", () => void compact(button));
    actions.append(cancel, confirm);
    popover.append(copy, actions);
    document.body.append(popover);
    const buttonRect = button.getBoundingClientRect();
    const rect = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(10, Math.min(buttonRect.right - rect.width, innerWidth - rect.width - 10))}px`;
    popover.style.top = `${Math.max(10, buttonRect.top - rect.height - 8)}px`;
    button.setAttribute("aria-expanded", "true");
  };

  const makeButton = () => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute("aria-label", "手动整理上下文");
    button.setAttribute("aria-expanded", "false");
    button.title = "手动整理上下文";
    button.innerHTML = "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M5 8h5V3M19 16h-5v5M10 8 4 2M14 16l6 6'/><path d='M14 8h5V3M10 16H5v5'/></svg>";
    button.addEventListener("click", () => openPopover(button));
    return button;
  };

  const render = () => {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((node) => {
      if (!node.closest(".agent-chat__composer-actions")) node.remove();
    });
    const actions = document.querySelector(".agent-chat__composer-actions");
    if (actions && !actions.querySelector(`.${BUTTON_CLASS}`)) {
      const deepThink = actions.querySelector(".laolao-deep-think-btn");
      const button = makeButton();
      if (deepThink) actions.insertBefore(button, deepThink);
      else actions.append(button);
    }
    fetchContextCapacity();
    renderContextViewer();
  };

  const ensureStyle = () => {
    if (document.getElementById("laolao-context-compact-style")) return;
    const style = document.createElement("style");
    style.id = "laolao-context-compact-style";
    style.textContent = `
.laolao-context-compact-btn{position:relative;display:inline-grid;place-items:center;width:30px;height:30px;margin:0 2px;padding:0;border:1px solid transparent;border-radius:999px;background:transparent;color:#a34b72;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease}.laolao-context-compact-btn:hover,.laolao-context-compact-btn[aria-expanded="true"]{border-color:rgba(205,91,141,.28);background:rgba(255,248,252,.48)}.laolao-context-compact-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:round;stroke-linejoin:round}.laolao-context-compact-btn.is-running svg{animation:laolao-context-spin 1.1s linear infinite}.laolao-context-compact-btn:disabled{cursor:wait;opacity:.72}
#laolao-context-compact-popover{position:fixed;z-index:2147483000;width:min(286px,calc(100vw - 20px));padding:12px;border:1px solid rgba(255,255,255,.74);border-radius:17px;background:linear-gradient(145deg,rgba(255,252,253,.94),rgba(249,228,240,.91));color:#61394e;box-shadow:0 18px 42px rgba(84,42,65,.16),inset 0 1px rgba(255,255,255,.78);animation:laolao-context-pop .16s cubic-bezier(.2,.78,.28,1) both}.laolao-context-compact__copy{display:flex;flex-direction:column;gap:4px}.laolao-context-compact__copy strong{font-size:12px}.laolao-context-compact__copy span{color:rgba(97,57,78,.62);font-size:10.5px;line-height:1.45}.laolao-context-compact__actions{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}.laolao-context-compact__actions button{padding:5px 10px;border:1px solid rgba(184,99,136,.18);border-radius:999px;background:rgba(255,255,255,.42);color:inherit;font-size:10.5px;cursor:pointer}.laolao-context-compact__actions button.is-primary{border-color:rgba(205,76,132,.26);background:#d85b91;color:white}
#laolao-context-compact-toast{position:fixed;left:50%;bottom:72px;z-index:2147483647;max-width:min(520px,84vw);padding:8px 14px;border:1px solid rgba(255,255,255,.74);border-radius:999px;background:rgba(252,235,244,.96);color:#6d3650;box-shadow:0 10px 28px rgba(106,48,79,.16);font-size:12px;opacity:0;pointer-events:none;transform:translate(-50%,6px);transition:opacity .18s ease,transform .18s ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#laolao-context-compact-toast.is-visible{opacity:1;transform:translate(-50%,0)}
@keyframes laolao-context-spin{to{transform:rotate(360deg)}}@keyframes laolao-context-pop{from{opacity:0;transform:translateY(4px) scale(.985)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.laolao-context-compact-btn,.laolao-context-compact-btn svg,#laolao-context-compact-popover,#laolao-context-compact-toast{animation:none!important;transition:none!important}}
.laolao-context-viewer{position:relative;color:#776b88;flex:none}.laolao-context-viewer summary{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 6px;border-radius:999px;cursor:pointer;list-style:none;font-size:11px;font-variant-numeric:tabular-nums}.laolao-context-viewer summary::-webkit-details-marker{display:none}.laolao-context-viewer summary:hover,.laolao-context-viewer[open] summary{background:rgba(206,140,181,.13)}.laolao-context-viewer svg{transform:rotate(-90deg);flex:none}.laolao-context-viewer circle{fill:none;stroke-width:2.5}.laolao-context-viewer__track{stroke:rgba(119,107,136,.22)}.laolao-context-viewer__fill{stroke:#bd73a2;stroke-linecap:round;stroke-dasharray:40.84;transition:stroke-dashoffset .35s ease}.laolao-context-viewer__popover{position:absolute;right:0;bottom:calc(100% + 9px);z-index:100;width:min(268px,calc(100vw - 24px));box-sizing:border-box;padding:14px;border:1px solid rgba(255,255,255,.78);border-radius:16px;background:linear-gradient(145deg,rgba(255,252,254,.97),rgba(248,234,244,.95));box-shadow:0 15px 38px rgba(88,54,77,.16);color:#503c56;font-size:11px}.laolao-context-viewer__popover strong{font-size:12px}.laolao-context-viewer__amount{margin-top:8px;font-variant-numeric:tabular-nums;font-weight:650}.laolao-context-viewer__bar{height:5px;margin:10px 0;border-radius:99px;background:rgba(119,107,136,.15);overflow:hidden}.laolao-context-viewer__bar span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#c888b1,#9fa5db);transition:width .35s ease}.laolao-context-viewer__note{color:#766b7e;line-height:1.4}
`;
    document.head.append(style);
  };

  document.addEventListener("pointerdown", (event) => {
    if (popover && !popover.contains(event.target) && !event.target.closest?.(`.${BUTTON_CLASS}`)) closePopover();
  }, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePopover(); });
  ensureStyle();
  render();
  setInterval(render, 900);
  window.addEventListener("laolao:sessions-changed", () => { usageFetchedAt = 0; fetchContextCapacity(); });
  window.__laolaoContextCompact = {compact, currentSessionKey, contextCapacity};
})();
