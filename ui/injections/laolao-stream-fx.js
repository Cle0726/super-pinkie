/*
 * 来啦～老弟：流式输出视觉增强。
 *
 * 之前的版本给每个新 chunk 加了 0.34s 的 fade-in 动画——但
 * OpenClaw 流式时每个 chunk 到达都会重建 markdown，结果每个
 * 元素都重新淡入一次，看起来像 PPT 逐张切换，反而把原本连续
 * 的流式打断了，用户反馈"像 ppt，没有流畅感"。
 *
 * 修正方向：彻底拿掉 per-element 动画，新内容直接以满不透明
 * 度出现——这才是真正的"流畅"。只保留跟随最后一个文本节点
 * 的光标，光标用柔和的正弦呼吸（不是硬开关），既提示"还在写"
 * 又不会打断阅读节奏。
 *
 * 设计要点：
 *  - 仅在 .chat-bubble.streaming 期间生效；流式结束后立刻收尾。
 *  - 尊重 prefers-reduced-motion：偏好减弱动效时光标保持半透明
 *    静态显示，不闪。
 *  - 不接管渲染：只对 OpenClaw 自己产出的 DOM 节点贴一个光标
 *    span 和 data 属性，移除时干净彻底。
 *  - 不和原生 .chat-bubble.streaming 的 chatStreamPulse 边框脉冲
 *    冲突——那是气泡外框，本脚本只处理气泡内部文本。
 */
(() => {
  "use strict";

  const ROOT_SEL = ".chat-thread-inner, .chat-thread";
  const STREAM_BUBBLE_SEL = ".chat-bubble.streaming";
  const CURSOR_CLASS = "pinkie-stream-cursor";
  const STREAMING_ATTR = "data-pinkie-streaming";

  const prefersReduced = () =>
    Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Bubbles we've already wired a subtree observer onto.
  const wiredBubbles = new WeakSet();
  // Cursor span per bubble, so we can move it instead of recreating.
  const cursorByBubble = new WeakMap();

  function ensureCursor(bubble) {
    const existing = cursorByBubble.get(bubble);
    if (existing && existing.isConnected) {
      // appendChild on an already-last cursor still emits a mutation record.
      // Guard it or the observer schedules another append every frame forever.
      if (bubble.lastChild !== existing) bubble.appendChild(existing);
      return existing;
    }
    const cursor = document.createElement("span");
    cursor.className = CURSOR_CLASS;
    cursor.setAttribute("aria-hidden", "true");
    cursorByBubble.set(bubble, cursor);
    bubble.appendChild(cursor);
    return cursor;
  }

  function removeCursor(bubble) {
    const cursor = cursorByBubble.get(bubble);
    if (cursor) {
      cursor.remove();
      cursorByBubble.delete(bubble);
    }
  }

  function markStreaming(bubble) {
    if (bubble.getAttribute(STREAMING_ATTR) !== "true") {
      bubble.setAttribute(STREAMING_ATTR, "true");
    }
    // 即使偏好减弱动效也保留光标（半透明静态），让用户知道还在写
    ensureCursor(bubble);
  }

  function unmarkStreaming(bubble) {
    if (bubble.hasAttribute(STREAMING_ATTR)) {
      bubble.removeAttribute(STREAMING_ATTR);
    }
    removeCursor(bubble);
  }

  // Subtree observer:只负责把光标 re-append 到气泡末尾，让光标
  // 始终跟在最新文本后面。不碰任何内容节点的样式——这是和上一
  // 版的关键差别，上一版给每个新节点加 fade-in 反而制造了 PPT
  // 感。
  // v3：rAF 节流。流式每个 chunk 产生一批 childList record，
  // 每条都 appendChild 会造成布局颠簸；合并到每帧最多一次。
  let cursorQueued = false;
  const pendingCursorBubbles = new Set();
  const subtreeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== "childList") continue;
      const bubble = m.target.closest ? m.target.closest(STREAM_BUBBLE_SEL) : null;
      if (!bubble) continue;
      pendingCursorBubbles.add(bubble);
    }
    if (cursorQueued || pendingCursorBubbles.size === 0) return;
    cursorQueued = true;
    requestAnimationFrame(() => {
      cursorQueued = false;
      pendingCursorBubbles.forEach((bubble) => {
        if (bubble.isConnected) ensureCursor(bubble);
      });
      pendingCursorBubbles.clear();
    });
  });

  function attachToBubble(bubble) {
    if (wiredBubbles.has(bubble)) return;
    wiredBubbles.add(bubble);
    subtreeObserver.observe(bubble, { childList: true, subtree: true });
    markStreaming(bubble);
  }

  function detachFromBubble(bubble) {
    // WeakSet means we won't re-attach next time, but the subtree
    // observer kept its target reference; once the bubble is gone the
    // observer is inert. We just need to clear our visual markers.
    unmarkStreaming(bubble);
  }

  function scanForBubbles(root) {
    let streaming = root.querySelectorAll ? root.querySelectorAll(STREAM_BUBBLE_SEL) : [];
    streaming.forEach(attachToBubble);

    // Bubbles that previously had our marker but have lost .streaming:
    // streaming finished — clean up.
    let stale = root.querySelectorAll
      ? root.querySelectorAll(`.chat-bubble[${STREAMING_ATTR}="true"]:not(.streaming)`)
      : [];
    stale.forEach(detachFromBubble);
  }

  // Top-level observer on the chat thread: catches brand new bubbles
  // entering the scroll area, plus bubbles whose .streaming class was
  // just added or removed.
  // v3：回调里禁止 querySelectorAll（2026-09-01 第三次冻结实抓：
  // 观察者回调里的 NodeList 工厂是 GC 雪崩主凶）。新增节点的挂接
  // 统一交给 rAF 节流的 scanForBubbles；class 翻转用 classList
  // 直接判断（零分配），保持摘光标的及时性。
  let scanQueued = false;
  const scheduleScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      const root = document.querySelector(ROOT_SEL);
      if (root) scanForBubbles(root);
    });
  };
  const rootObserver = new MutationObserver((mutations) => {
    let needScan = false;
    for (const m of mutations) {
      if (m.type === "childList") {
        // 有元素增删就约一次帧级扫描，不在回调里逐个 qSA。
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) { needScan = true; break; }
        }
        continue;
      }
      // Attribute mutations on existing bubbles: a bubble that just
      // gained .streaming should be wired; one that just lost it should
      // be cleaned up. classList 检查零分配，可以留在回调里。
      if (m.target && m.target.classList && m.target.classList.contains("chat-bubble")) {
        if (m.target.classList.contains("streaming")) attachToBubble(m.target);
        else if (m.target.hasAttribute(STREAMING_ATTR)) detachFromBubble(m.target);
      }
    }
    if (needScan) scheduleScan();
  });

  function start() {
    const root = document.querySelector(ROOT_SEL);
    if (root) {
      rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      scanForBubbles(root);
    } else {
      // Chat thread not mounted yet — wait for it without leaking.
      const pending = new MutationObserver(() => {
        const r = document.querySelector(ROOT_SEL);
        if (r) {
          pending.disconnect();
          rootObserver.observe(r, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
          scanForBubbles(r);
        }
      });
      pending.observe(document.body, { childList: true, subtree: true });
      // Bail after 60s so we don't watch forever on non-chat pages.
      window.setTimeout(() => pending.disconnect(), 60000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
