/* Manual context compaction for every chat mode. Uses OpenClaw's native
   sessions.compact RPC directly, so no slash-command message appears in chat. */
(() => {
  "use strict";

  const BUTTON_CLASS = "laolao-context-compact-btn";
  const POPOVER_ID = "laolao-context-compact-popover";
  let busy = false;
  let popover = null;
  let toastTimer = null;

  const currentSessionKey = () => {
    const routed = new URLSearchParams(location.search).get("session") || "";
    if (/^agent:(main|project|thinking|unrestricted):/.test(routed)) return routed;
    const active = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    return active?.dataset?.sessionKey || "";
  };

  const toast = (message) => {
    let node = document.getElementById("laolao-context-compact-toast");
    if (!node) {
      node = document.createElement("div");
      node.id = "laolao-context-compact-toast";
      node.setAttribute("role", "status");
      document.body.append(node);
    }
    node.textContent = message;
    node.classList.remove("is-visible");
    requestAnimationFrame(() => node.classList.add("is-visible"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("is-visible"), 3600);
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
    if (!actions || actions.querySelector(`.${BUTTON_CLASS}`)) return;
    const deepThink = actions.querySelector(".laolao-deep-think-btn");
    const button = makeButton();
    if (deepThink) actions.insertBefore(button, deepThink);
    else actions.append(button);
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
  window.__laolaoContextCompact = {compact, currentSessionKey};
})();
