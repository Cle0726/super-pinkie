/* 沉浸感交互层。只在用户动起来的时候出现，停下来就安静：
   - 打字：只记录一点“能量”给背景氛围用（打字时氛围稍快），输入框本身不加特效。
   - 发送：输入的文字轻轻往上淡出；新消息从下面浮上来，碧琪的回复带一点由虚到实。
   - 完成：最新回复上扫过一道柔光。
   - 碧琪感觉到鼠标靠近会抬一下头。
   页面隐藏、减少动态效果时全部关闭。 */
(() => {
  "use strict";
  if (window.__pinkieImmersion) return;
  const root = document.documentElement;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const off = () => reduced() || root.hasAttribute("data-r2-off") || root.hasAttribute("data-laolao-plain-composer");
  const MODES = ["chat", "project", "thinking", "learning", "unrestricted"];
  const mode = () => { const m = root.getAttribute("data-laolao-mode"); return MODES.includes(m) ? m : "chat"; };
  const state = {energy: 0};
  let raf = 0;

  const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
  const frame = (now) => {
    raf = 0;
    let busy = false;
    // 打字能量回落
    if (state.energy > .002) { state.energy *= .955; busy = true; } else state.energy = 0;
    if (busy) kick();
  };

  /* 鼠标位置：只给背景氛围（粒子轻轻让开）和碧琪（抬头）用，页面上不画光圈 */
  let movePending = false, moveEvent = null;
  document.addEventListener("pointermove", (event) => {
    if (off() || event.pointerType === "touch") return;
    moveEvent = event;
    if (movePending) return;
    movePending = true;
    requestAnimationFrame(() => {
      movePending = false;
      const e = moveEvent, c = document.querySelector(".card.chat");
      if (!c) return;
      const r = c.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      window.__pinkieImmersion.pointer = inside ? {x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now()} : null;
      nearBuddy(e.clientX, e.clientY);
    });
  }, {passive: true});

  /* 碧琪感觉到鼠标靠近：抬一下头（只是轻微上移、变亮），隔一阵冒一颗小心心 */
  let lastHeart = 0;
  const nearBuddy = (x, y) => {
    const b = document.querySelector(".pinkie-buddy");
    if (!b) return;
    const r = b.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
    const near = Math.hypot(dx, dy) < 70;
    b.classList.toggle("is-near", near);
    const over = dx === 0 && dy === 0;
    if (over && performance.now() - lastHeart > 5000 && b.dataset.state !== "sleepy") {
      lastHeart = performance.now();
      floatMark(r.left + r.width * .5, r.top + r.height * .18, "heart");
    }
  };
  const floatMark = (x, y, kind) => {
    if (off()) return;
    const n = document.createElement("span");
    n.className = `r3-mark r3-mark--${kind}`;
    n.style.left = `${x}px`; n.style.top = `${y}px`;
    n.innerHTML = kind === "heart"
      ? '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8Z"/></svg>';
    document.body.append(n);
    n.animate([
      {transform: "translate(-50%, -50%) scale(.4)", opacity: 0},
      {transform: "translate(-50%, -90%) scale(1.05)", opacity: 1, offset: .3},
      {transform: "translate(-50%, -260%) scale(.9)", opacity: 0},
    ], {duration: 1400, easing: "cubic-bezier(.2,.8,.3,1)"}).finished.finally(() => n.remove());
  };

  /* ── 打字：只给背景氛围一点能量，输入框不加特效 ── */
  document.addEventListener("input", (event) => {
    if (off() || !event.target.closest?.(".agent-chat__composer-combobox textarea")) return;
    state.energy = Math.min(1, state.energy + .12);
    kick();
  }, true);

  /* ── 发送：文字轻轻往上淡出 ────────────────────────────────────────── */
  const isRunning = () => Boolean(document.querySelector(".chat-send-btn--stop"));
  const flyAway = () => {
    if (off()) return;
    const ta = document.querySelector(".agent-chat__composer-combobox textarea");
    const text = ta?.value.trim();
    if (!ta || !text) return;
    const r = ta.getBoundingClientRect(), cs = getComputedStyle(ta);
    const ghost = document.createElement("div");
    ghost.className = "r3-ghost"; ghost.textContent = text;
    Object.assign(ghost.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, font: cs.font, lineHeight: cs.lineHeight, padding: cs.padding});
    document.body.append(ghost);
    state.energy = .6; kick();
    ghost.animate([
      {transform: "translateY(0)", opacity: .55, filter: "blur(0)"},
      {transform: "translateY(-36px)", opacity: 0, filter: "blur(1.5px)"},
    ], {duration: 380, easing: "cubic-bezier(.25,.8,.3,1)"}).finished.finally(() => ghost.remove());
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.altKey || isRunning()) return;
    if (e.target.closest?.(".agent-chat__composer-combobox textarea")) flyAway();
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest?.(".agent-chat__input .chat-send-btn:not(.chat-send-btn--stop)")) flyAway();
  }, true);

  /* ── 新消息入场 + 完成时的一道柔光 ───────────────────────────────────── */
  let thread = null, threadObserver = null, settledAt = 0;
  const watchThread = () => {
    const next = document.querySelector(".chat-thread");
    if (next === thread) return;
    threadObserver?.disconnect(); thread = next; settledAt = performance.now() + 1200;
    if (!thread) return;
    threadObserver = new MutationObserver((records) => {
      if (off() || performance.now() < settledAt) return;
      const added = [];
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.classList.contains("chat-group")) added.push(n);
      if (!added.length || added.length > 2) return;   // 一次来很多条是切会话 / 载入历史，不做动画
      for (const g of added) {
        const cls = g.classList.contains("user") ? "r3-in--user" : "r3-in--assistant";
        g.classList.add("r3-in", cls);
        setTimeout(() => g.classList.remove("r3-in", cls), 900);
      }
    });
    threadObserver.observe(thread, {childList: true});
  };
  let wasRunning = false;
  const sheen = () => {
    const groups = document.querySelectorAll(".chat-thread .chat-group.assistant:not(.chat-group--timeline-step) .chat-bubble:not(.chat-bubble--tool-shell)");
    const b = groups[groups.length - 1];
    if (!b || off()) return;
    b.classList.remove("r3-sheen"); void b.offsetWidth; b.classList.add("r3-sheen");
    setTimeout(() => b.classList.remove("r3-sheen"), 1500);
  };
  /* ── 加粗补救：Markdown 规则里「**」紧挨中文标点（如 **【方法】**：）时不算加粗，
     模型又经常这样写，结果满屏星号。只处理回复正文里的纯文本，代码不碰。 */
  const BOLD = /\*\*([^\s*](?:[^*\n]{0,158}?[^\s*])?)\*\*/g;
  const fixBold = (box) => {
    if (!box.textContent.includes("**")) return;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.nodeValue.includes("**") && !n.parentElement.closest("code, pre, textarea, a") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      BOLD.lastIndex = 0;
      if (!BOLD.test(text)) continue;
      BOLD.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (const m of text.matchAll(BOLD)) {
        if (m.index > at) frag.append(text.slice(at, m.index));
        const strong = document.createElement("strong");
        strong.textContent = m[1];
        frag.append(strong);
        at = m.index + m[0].length;
      }
      if (at < text.length) frag.append(text.slice(at));
      node.replaceWith(frag);
    }
  };
  const fixRecentBold = () => {
    const boxes = document.querySelectorAll(".chat-thread .chat-group .chat-text");
    for (let i = Math.max(0, boxes.length - 8); i < boxes.length; i += 1) fixBold(boxes[i]);
  };

  setInterval(() => {
    watchThread();
    fixRecentBold();
    const run = isRunning();
    if (wasRunning && !run) setTimeout(sheen, 260);
    wasRunning = run;
  }, 300);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });

  window.__pinkieImmersion = {get energy() { return state.energy; }, pointer: null, sheen, floatMark, flyAway, fixBold};
})();
