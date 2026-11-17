/* Metre 批 6 的量具（PLAN 2.13、ACCEPTANCE A6-*）：在页面自己的脚本之前跑，记下谁开了什么。
 * 用法：node tools/ui-parity/capture.mjs ... --init tools/metre/resource-meter.js --probe <读数的探针>
 * 页面里读：window.__pinkieMeter.snapshot(毫秒) → 这段时间里
 *   intervals   还活着的 setInterval（按来源文件）
 *   timeouts    这段时间里排了多少次 setTimeout（按来源文件；一直自己续命的循环会很显眼）
 *   frames      这段时间里 requestAnimationFrame 被调了几次（按来源文件）
 *   busyMs      这段时间里定时器和动画帧回调一共跑了多少毫秒（只算页面脚本，拿来近似 CPU）
 *   observers   还在看的 Mutation / Resize / Intersection 观察器（按来源文件）
 *   webgl       还活着的 WebGL 上下文（画布还在页面上、没丢）
 *   scripts     加载过的脚本里属于重模块的（three、gsap、mermaid、学习台、游戏）
 * 来源文件取调用栈里第一个不是本文件的脚本名。 */
(() => {
  if (window.__pinkieMeter) return;
  const SELF = 'resource-meter';
  const source = () => {
    const stack = String(new Error().stack || '').split('\n').slice(2);
    for (const line of stack) {
      const m = line.match(/\/([^/\s?)]+\.(?:js|mjs))(?:\?[^:\s)]*)?:\d+/);
      if (m && !m[1].includes(SELF) && !line.includes('__pinkieMeter')) return m[1];
    }
    return '(inline)';
  };
  const now = () => performance.now();
  const events = [];   // [time, kind, source, ms]
  const push = (kind, src, ms = 0) => { events.push([now(), kind, src, ms]); if (events.length > 200000) events.splice(0, 50000); };
  const timed = (kind, src, fn) => function (...args) {
    const t = now();
    try { return fn.apply(this, args); } finally { push(kind + '-run', src, now() - t); }
  };

  const liveIntervals = new Map();
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  window.setInterval = function (fn, ms, ...rest) {
    const src = source();
    const id = nativeSetInterval(typeof fn === 'function' ? timed('interval', src, fn) : fn, ms, ...rest);
    liveIntervals.set(id, {src, ms});
    return id;
  };
  window.clearInterval = function (id) { liveIntervals.delete(id); return nativeClearInterval(id); };

  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms, ...rest) {
    const src = source();
    push('timeout', src);
    return nativeSetTimeout(typeof fn === 'function' ? timed('timeout', src, fn) : fn, ms, ...rest);
  };

  const nativeRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (fn) {
    const src = source();
    push('frame', src);
    return nativeRaf(timed('frame', src, fn));
  };

  const observers = new Map();   // observer → {src, kind, watching}
  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
    const Native = window[name];
    if (!Native) continue;
    const Wrapped = class extends Native {
      constructor(cb, opts) { const src = source(); super(cb, opts); observers.set(this, {src, kind: name, watching: 0}); }
      observe(...args) { const rec = observers.get(this); if (rec) rec.watching++; return super.observe(...args); }
      unobserve(...args) { const rec = observers.get(this); if (rec) rec.watching = Math.max(0, rec.watching - 1); return super.unobserve(...args); }
      disconnect() { const rec = observers.get(this); if (rec) rec.watching = 0; return super.disconnect(); }
    };
    window[name] = Wrapped;
  }

  const contexts = [];
  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = nativeGetContext.call(this, type, ...rest);
    if (ctx && /webgl/i.test(String(type)) && !contexts.some(item => item.ctx === ctx)) contexts.push({ctx, canvas: this, src: source()});
    return ctx;
  };

  const tally = (rows) => rows.reduce((acc, [, , src]) => { acc[src] = (acc[src] || 0) + 1; return acc; }, {});
  const sortObj = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
  window.__pinkieMeter = {
    snapshot(windowMs = 10000) {
      const since = now() - windowMs;
      const recent = events.filter(e => e[0] >= since);
      const busy = recent.filter(e => e[1].endsWith('-run'));
      const busyBySrc = {};
      for (const [, , src, ms] of busy) busyBySrc[src] = Math.round(((busyBySrc[src] || 0) + ms) * 10) / 10;
      const intervals = {};
      for (const {src} of liveIntervals.values()) intervals[src] = (intervals[src] || 0) + 1;
      const obs = {};
      for (const [, rec] of observers) if (rec.watching > 0) obs[`${rec.src} ${rec.kind}`] = (obs[`${rec.src} ${rec.kind}`] || 0) + 1;
      const webgl = contexts.filter(item => item.canvas.isConnected && !(item.ctx.isContextLost?.())).map(item => item.src);
      const scripts = performance.getEntriesByType('resource').map(e => e.name)
        .filter(name => /three|gsap|mermaid|study|learning|game|cle-stage|cle-space|buddy|companion|immersion|night|splash|transition/i.test(name))
        .map(name => name.split('/').pop().split('?')[0]);
      return {
        windowMs,
        intervalCount: liveIntervals.size, intervals: sortObj(intervals),
        timeoutCount: recent.filter(e => e[1] === 'timeout').length, timeouts: sortObj(tally(recent.filter(e => e[1] === 'timeout'))),
        frameCount: recent.filter(e => e[1] === 'frame').length, frames: sortObj(tally(recent.filter(e => e[1] === 'frame'))),
        busyMs: Math.round(busy.reduce((sum, e) => sum + e[3], 0)), busyBySrc: sortObj(busyBySrc),
        observerCount: Object.values(obs).reduce((a, b) => a + b, 0), observers: sortObj(obs),
        webglCount: webgl.length, webgl,
        heavyScripts: [...new Set(scripts)],
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    },
  };
})();
