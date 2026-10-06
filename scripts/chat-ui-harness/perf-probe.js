/* 性能探针（只在测试页里用，?perf=1 时在所有脚本之前注入）。
   - 把每个定时器 / rAF / 观察者 / 事件回调按「注册它的脚本文件」归类，统计次数和耗时；
   - 记录每一帧的间隔，统计掉帧；长帧（long-animation-frame）连同脚本来源一起记下；
   - 列出一直在跑的 CSS 动画（无限循环的），以及它们动的是什么属性。
   用法：__perf.reset() → 做操作 → __perf.report() */
(() => {
  "use strict";
  const now = () => performance.now();
  const self = "__perf-probe";
  const origin = () => {
    const lines = String(new Error().stack || "").split("\n").slice(2);
    for (const line of lines) {
      const m = line.match(/\/([\w.-]+\.(?:js|mjs))(?:\?[^:)]*)?:\d+/);
      if (m && !m[1].includes(self)) return m[1].replace(/-[\w]{8}\.js$/, ".js");
    }
    return "(unknown)";
  };
  const stats = new Map();
  const bump = (key, ms) => {
    const s = stats.get(key) || {n: 0, ms: 0, max: 0};
    s.n += 1; s.ms += ms; if (ms > s.max) s.max = ms;
    stats.set(key, s);
  };
  const wrap = (kind, fn, src) => {
    if (typeof fn !== "function") return fn;
    return function (...args) {
      const t = now();
      try { return fn.apply(this, args); } finally { bump(`${src} · ${kind}`, now() - t); }
    };
  };

  const st = window.setTimeout, si = window.setInterval, raf = window.requestAnimationFrame;
  window.setTimeout = function (fn, ms, ...rest) { return st.call(window, wrap("timeout", fn, origin()), ms, ...rest); };
  window.setInterval = function (fn, ms, ...rest) { return si.call(window, wrap(`interval ${ms}ms`, fn, origin()), ms, ...rest); };
  window.requestAnimationFrame = function (fn) { return raf.call(window, wrap("raf", fn, origin())); };
  for (const name of ["MutationObserver", "ResizeObserver", "IntersectionObserver"]) {
    const Base = window[name];
    if (!Base) continue;
    window[name] = class extends Base { constructor(cb, opts) { super(wrap(name, cb, origin()), opts); } };
  }
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const wrapped = new WeakMap();
  const HOT = /^(pointermove|mousemove|scroll|wheel|input|keydown|keyup|pointerdown|pointerup|click|resize|visibilitychange|focusin|focusout|transitionend|animationend|selectionchange)$/;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (!HOT.test(type) || typeof fn !== "function") return add.call(this, type, fn, opts);
    let w = wrapped.get(fn);
    if (!w) { w = wrap(`on ${type}`, fn, origin()); wrapped.set(fn, w); }
    return add.call(this, type, w, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    return remove.call(this, type, wrapped.get(fn) || fn, opts);
  };

  // 帧间隔
  let frames = [], last = 0;
  const tick = (t) => { if (last) frames.push(t - last); last = t; raf.call(window, tick); };
  raf.call(window, tick);
  // 长帧
  let loafs = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) loafs.push({
        at: Math.round(e.startTime), ms: Math.round(e.duration), block: Math.round(e.blockingDuration || 0),
        style: e.styleAndLayoutStart ? Math.round(e.startTime + e.duration - e.styleAndLayoutStart) : 0,
        scripts: (e.scripts || []).map((s) => `${(s.sourceURL || "").split("/").pop().split("?")[0] || s.invokerType} ${s.invoker || ""} ${Math.round(s.duration)}ms`).slice(0, 4),
      });
    }).observe({type: "long-animation-frame", buffered: true});
  } catch {}

  const running = () => document.getAnimations().filter((a) => a.playState === "running").map((a) => {
    const fx = a.effect, t = fx?.target;
    const timing = fx?.getComputedTiming?.() || {};
    const kf = fx?.getKeyframes?.() || [];
    const props = [...new Set(kf.flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p))))];
    const el = t ? `${t.tagName?.toLowerCase()}${t.id ? "#" + t.id : ""}.${String(t.className?.baseVal ?? t.className ?? "").trim().split(/\s+/).slice(0, 2).join(".")}${fx.pseudoElement || ""}` : "?";
    return {name: a.animationName || a.transitionProperty || a.id || "(waapi)", el, props: props.join(","), infinite: timing.iterations === Infinity};
  });

  window.__perf = {
    reset() { stats.clear(); frames = []; loafs = []; last = 0; this.t0 = now(); },
    report({top = 18} = {}) {
      const secs = (now() - (this.t0 || 0)) / 1000;
      const sorted = [...stats].sort((a, b) => b[1].ms - a[1].ms).slice(0, top)
        .map(([k, s]) => `${(s.ms / secs).toFixed(1)}ms/s  n=${s.n}  max=${s.max.toFixed(1)}  ${k}`);
      const f = frames.slice();
      const over = (ms) => f.filter((x) => x > ms).length;
      return {
        seconds: +secs.toFixed(1),
        frames: f.length, fps: +(f.length / secs).toFixed(1),
        janky_over_20ms: over(20), over_33ms: over(33), over_50ms: over(50), worst: Math.round(Math.max(0, ...f)),
        callbacks: sorted, longFrames: loafs.slice(-12),
        infiniteAnimations: running().filter((a) => a.infinite),
        otherRunning: running().filter((a) => !a.infinite).length,
      };
    },
    running,
  };
  window.__perf.reset();
})();
