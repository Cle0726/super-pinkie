(() => {
  "use strict";
  if (window.__pinkieDesensitizeMini) return;
  window.__pinkieDesensitizeMini = true;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const BTN_CLASS = "laolao-desensitize-btn";
  const POP_ID = "laolao-desensitize-pop";
  const STYLE_ID = "laolao-desensitize-css";
  const DRAFT_SRC = "laolao:ds-src";
  const DRAFT_TGT = "laolao:ds-tgt";

  const MODELS = [
    { id: "mm/gemini-2.5-flash",          label: "Gemini 2.5 Flash · 极速推荐" },
    { id: "mm/gemini-3.5-flash-low",       label: "Gemini 3.5 Flash" },
    { id: "mm/gemini-3.7-flash-tiered",    label: "Gemini 3.7 Flash" },
    { id: "mm/gemini-3.8-flash-tiered",    label: "Gemini 3.8 Flash" },
    { id: "mm/gemini-2.5-flash-thinking",  label: "Gemini 2.5 Flash Thinking" },
    { id: "mm/gemini-3.1-pro-preview",     label: "Gemini 3.1 Pro" },
    { id: "mm/gemini-3-pro-preview",       label: "Gemini 3 Pro" },
    { id: "mm/claude-sonnet-4-6",          label: "Claude Sonnet 4.6 · 深度" },
    { id: "mm/gpt-oss-120b-medium",        label: "GPT-OSS 120B" },
  ];

  /* ── 模式检测 ─────────────────────────────────────────── */
  const isUnrestricted = () => {
    const attr = document.documentElement.getAttribute("data-cle-room");
    if (attr) return attr === "unrestricted";
    const key =
      window.__laolaoSidebar?.currentSessionKey?.() || new URLSearchParams(window.location.search).get("session") ||
      $(".sidebar-recent-session--active[data-session-key]")?.dataset.sessionKey || "";
    return key.startsWith("agent:unrestricted:");
  };

  /* ── Toast ─────────────────────────────────────────────── */
  const toast = (msg) => {
    if (typeof window.__laolaoToast === "function") window.__laolaoToast(msg);
    else window.dispatchEvent(new CustomEvent("laolao:toast", { detail: { message: msg } }));
  };

  /* ── 输入框 ────────────────────────────────────────────── */
  const getTA = () =>
    $(".chat-pane-cache__pane--active .agent-chat__composer-combobox textarea") ||
    $(".chat-pane-cache__pane--active .agent-chat__composer-shell textarea") ||
    $("textarea");

  const fillTA = (ta, v) => {
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (s) s.call(ta, v); else ta.value = v;
    ta.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    ta.focus();
  };

  /* ── 浮窗生命周期 ──────────────────────────────────────── */
  let timer = null;
  let outsideHandler = null;

  const closePop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    const p = document.getElementById(POP_ID);
    if (p) p.remove();
    $$("." + BTN_CLASS).forEach((b) => b.classList.remove("is-open"));
    if (outsideHandler) {
      document.removeEventListener("pointerdown", outsideHandler, true);
      outsideHandler = null;
    }
  };

  const openPop = (btn) => {
    if (document.getElementById(POP_ID)) { closePop(); return; }
    btn.classList.add("is-open");

    const ta = getTA();
    const live = ta?.value?.trim() || "";
    const src = live || localStorage.getItem(DRAFT_SRC) || "";
    const tgt = localStorage.getItem(DRAFT_TGT) || "";

    const pop = document.createElement("div");
    pop.id = POP_ID;

    pop.innerHTML = `
<div class="ds-head">
  <div class="ds-head__title">
    <svg viewBox="0 0 24 24"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3Z"/><path d="M11 14h2l1-4h-1.5L13.5 7h-3L9 12h2z" class="ds-bolt"/></svg>
    <span>违规词脱敏</span>
  </div>
  <select class="ds-select" id="ds-model">${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}</select>
</div>
<textarea class="ds-input" id="ds-src" rows="2" placeholder="输入敏感目标 / 违规词提问...">${src}</textarea>
<div class="ds-bar">
  <span class="ds-status" id="ds-status">就绪</span>
  <button type="button" class="ds-run" id="ds-run">
    <svg class="ds-spin" id="ds-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity=".3"/><path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor"/></svg>
    <span id="ds-run-label">⚡ 改写</span>
  </button>
</div>
<div class="ds-result" id="ds-result" style="display:${tgt ? "flex" : "none"}">
  <textarea class="ds-input ds-output" id="ds-tgt" rows="3" placeholder="改写结果...">${tgt}</textarea>
  <button type="button" class="ds-apply" id="ds-apply">✓ 填入输入框</button>
</div>`;

    document.body.appendChild(pop);

    /* 定位：贴靠按钮上方 */
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.right - 310, window.innerWidth - 318))}px`;
    pop.style.bottom = `${Math.max(8, window.innerHeight - r.top + 6)}px`;

    const srcEl = pop.querySelector("#ds-src");
    const tgtEl = pop.querySelector("#ds-tgt");
    const runBtn = pop.querySelector("#ds-run");
    const runLabel = pop.querySelector("#ds-run-label");
    const spinEl = pop.querySelector("#ds-spin");
    const statusEl = pop.querySelector("#ds-status");
    const resultEl = pop.querySelector("#ds-result");
    const applyBtn = pop.querySelector("#ds-apply");
    const selectEl = pop.querySelector("#ds-model");

    srcEl.addEventListener("input", () => localStorage.setItem(DRAFT_SRC, srcEl.value));
    tgtEl.addEventListener("input", () => localStorage.setItem(DRAFT_TGT, tgtEl.value));

    /* 改写 */
    runBtn.addEventListener("click", async () => {
      const prompt = srcEl.value.trim();
      if (!prompt) { statusEl.textContent = "请先输入"; srcEl.focus(); return; }

      runBtn.disabled = true;
      spinEl.style.display = "block";
      runLabel.textContent = "改写中";

      let ms = 0;
      statusEl.textContent = "请求中 0s";
      timer = setInterval(() => { ms += 100; statusEl.textContent = `生成中 ${(ms / 1000).toFixed(1)}s`; }, 100);

      try {
        const rpc = window.__laolaoSidebar?.gwRequest;
        if (typeof rpc !== "function") throw new Error("网关未就绪");
        const res = await rpc("pinkie.desensitize.rewrite", { prompt, model: selectEl.value }, 50000);
        if (!res?.rewritten) throw new Error(res?.message || "模型无输出");

        tgtEl.value = res.rewritten;
        localStorage.setItem(DRAFT_TGT, res.rewritten);
        resultEl.style.display = "flex";
        statusEl.textContent = `完成 ${(ms / 1000).toFixed(1)}s ✓`;
      } catch (e) {
        statusEl.textContent = `失败: ${e.message}`;
      } finally {
        if (timer) { clearInterval(timer); timer = null; }
        runBtn.disabled = false;
        spinEl.style.display = "none";
        runLabel.textContent = "⚡ 改写";
      }
    });

    /* 填入 */
    applyBtn.addEventListener("click", () => {
      const v = tgtEl.value.trim();
      if (!v) return;
      const t = getTA();
      if (t) fillTA(t, v);
      toast("✅ 已填入输入框");
      closePop();
    });

    /* 外部点击关闭 */
    outsideHandler = (e) => {
      if (!pop.contains(e.target) && !btn.contains(e.target)) closePop();
    };
    setTimeout(() => document.addEventListener("pointerdown", outsideHandler, true), 60);
  };

  /* ── 按钮渲染 ──────────────────────────────────────────── */
  const render = () => {
    if (!isUnrestricted()) {
      $$("." + BTN_CLASS).forEach((b) => b.remove());
      closePop();
      return;
    }
    $$("." + BTN_CLASS).forEach((o) => { if (!o.isConnected) o.remove(); });
    const actions = $(".agent-chat__composer-actions");
    if (!actions?.isConnected || actions.querySelector("." + BTN_CLASS)) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.title = "违规词脱敏";
    btn.innerHTML =
      "<svg class='ds-btn-icon' viewBox='0 0 24 24'>" +
        "<path class='ds-btn-shield' d='M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3Z'/>" +
        "<path class='ds-btn-bolt' d='M11 14h2l1-4h-1.5L13.5 7h-3L9 12h2z'/>" +
      "</svg>" +
      "<span class='ds-btn-text'>脱敏</span>";

    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPop(btn); });

    const dt = actions.querySelector(".laolao-deep-think-btn");
    if (dt) actions.insertBefore(btn, dt);
    else actions.appendChild(btn);
  };

  /* ── 样式（对标 deep-think 毛玻璃粉色渐变视觉规范） ───── */
  const ensureCSS = () => {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
/* ── 触发按钮 ── */
.laolao-desensitize-btn {
  display:inline-flex;align-items:center;justify-content:center;gap:3px;
  height:28px;min-width:28px;padding:0 8px;
  border:1px solid var(--cle-line-strong);border-radius:999px;
  background:var(--cle-paper);
  -webkit-backdrop-filter:none;backdrop-filter:none;
  color:var(--cle-ink-2);cursor:pointer;
  font:600 10.5px/1 ui-sans-serif,system-ui,sans-serif;
  white-space:nowrap;
  box-shadow:none;
  transition:background .16s ease,border-color .16s ease,color .16s ease;order:7;
}
.laolao-desensitize-btn:hover,.laolao-desensitize-btn.is-open {
  background:var(--cle-gaze-soft);
  border-color:var(--cle-gaze);color:var(--cle-ink);
  box-shadow:none;
}
.ds-btn-icon{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linejoin:round;stroke-linecap:round}
.ds-btn-shield{fill:currentColor;fill-opacity:.12}
.ds-btn-bolt{fill:currentColor;stroke:none}
.ds-btn-text{pointer-events:none}

/* ── 浮窗：纸面卡片 ── */
#laolao-desensitize-pop {
  position:fixed;z-index:2147483000;
  width:min(310px,calc(100vw - 20px));
  padding:10px;
  color:var(--cle-ink);
  background:var(--cle-surface);
  border:1px solid var(--cle-line-strong);
  -webkit-backdrop-filter:none;backdrop-filter:none;
  border-radius:17px;
  box-shadow:var(--cle-shadow-pop);
  display:flex;flex-direction:column;gap:7px;
  animation:ds-pop-in .2s cubic-bezier(.2,.78,.28,1) both;
}
#laolao-desensitize-pop::before{content:"";position:absolute;inset:0 12px auto;height:1px;background:var(--cle-line);pointer-events:none}

.ds-head{display:flex;align-items:center;gap:6px}
.ds-head__title{display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;color:var(--cle-ink);letter-spacing:.04em;white-space:nowrap}
.ds-head__title svg{width:14px;height:14px;stroke:var(--cle-ink-2);fill:none;stroke-width:1.4;stroke-linejoin:round}
.ds-head__title svg path:first-child{fill:var(--cle-ink-2);fill-opacity:.14}
.ds-bolt{fill:var(--cle-gaze);stroke:none!important}

.ds-select{
  flex:1;min-width:0;height:24px;padding:0 6px;
  border-radius:8px;border:1px solid var(--cle-line-strong);
  background:var(--cle-paper);
  color:var(--cle-ink);font-size:10.5px;font-weight:500;outline:none;
  transition:border-color .16s;
}
.ds-select:focus{border-color:var(--cle-gaze);box-shadow:0 0 0 3px var(--cle-gaze-soft)}

.ds-input{
  width:100%;box-sizing:border-box;
  padding:7px 9px;border-radius:10px;
  border:1px solid var(--cle-line-strong);
  background:var(--cle-paper);
  color:var(--cle-ink);font:12px/1.45 var(--cle-sans);
  resize:vertical;outline:none;
  transition:border-color .16s,background .16s;
}
.ds-input:focus{
  border-color:var(--cle-gaze);
  box-shadow:0 0 0 3px var(--cle-gaze-soft);
}
.ds-input::placeholder{color:var(--cle-ink-3)}

.ds-output{
  background:var(--cle-paper);
  border-color:var(--cle-line-strong);
  font-size:11.5px;
}

.ds-bar{display:flex;align-items:center;justify-content:space-between}

.ds-status{font-size:10px;font-weight:500;color:var(--cle-ink-2)}

.ds-run{
  display:inline-flex;align-items:center;gap:4px;
  height:26px;padding:0 10px;
  border:1px solid var(--cle-ink);border-radius:999px;
  background:var(--cle-ink);
  color:var(--cle-paper);font-size:11px;font-weight:600;cursor:pointer;
  box-shadow:none;
  transition:background .16s ease;
}
.ds-run:hover:not(:disabled){
  background:color-mix(in srgb,var(--cle-ink) 88%,var(--cle-gaze));
  box-shadow:none;
}
.ds-run:disabled{background:var(--cle-paper);border-color:var(--cle-line-strong);color:var(--cle-ink-2);cursor:wait}

.ds-spin{width:12px;height:12px;display:none;animation:ds-spin .8s linear infinite}

.ds-result{display:flex;flex-direction:column;gap:6px;animation:ds-fade-in .2s ease}

.ds-apply{
  align-self:flex-end;
  height:24px;padding:0 10px;
  border:1px solid var(--cle-line-strong);border-radius:999px;
  background:var(--cle-paper);
  color:var(--cle-ink);font-size:10.5px;font-weight:600;cursor:pointer;
  box-shadow:none;
  transition:background .14s ease,border-color .14s ease;
}
.ds-apply:hover{
  background:var(--cle-gaze-soft);
  border-color:var(--cle-gaze);
  box-shadow:none;
}


@keyframes ds-pop-in{from{opacity:0;transform:translateY(6px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes ds-spin{to{transform:rotate(360deg)}}
@keyframes ds-fade-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){#laolao-desensitize-pop,.ds-spin,.ds-result{animation:none!important;transition:none!important}}
`;
    document.head.appendChild(s);
  };

  let sched = false;
  const tick = () => { if (sched) return; sched = true; requestAnimationFrame(() => { sched = false; render(); }); };
  setInterval(tick, 700);
  window.addEventListener("popstate", tick);
  window.addEventListener("laolao:modechange", tick);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

  ensureCSS();
  render();
})();
