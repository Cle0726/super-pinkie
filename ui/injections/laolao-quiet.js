/* laolao-quiet —— Metre 模式下的资源关停（briefs/metre-mode-1113 PLAN 2.13，批 6）。
 *
 * 目标：Metre 里装饰性的开销只剩那只像素猫。做法是一个小调度器：
 *   各个重模块在加载时登记一对 suspend / resume：
 *     window.__pinkieQuiet?.register('名字', {suspend() {…}, resume() {…}});
 *   当前模式变成 metre 时，调度器挨个调 suspend；离开 metre 时挨个调 resume，不用刷新页面。
 *   登记时已经在 Metre 里，当场就 suspend。
 *   只有一个轮询定时器的模块用 interval(名字, fn, 毫秒)，等于一对现成的 suspend / resume。
 *   suspend 必须真的停：清掉定时器、取消动画帧、断开观察器、释放 WebGL 上下文；不许只是藏起来。
 * 根元素上有 data-pinkie-quiet 属性，事件 pinkie:quiet-change {quiet}。
 * 这个文件要同步加载、排在所有重模块前面（见 laolao-head.fragment.html）。 */
(() => {
  'use strict';
  if (window.__pinkieQuiet) return;
  const root = document.documentElement;
  const modules = new Map();
  let quiet = false;
  const want = () => root.getAttribute('data-laolao-mode') === 'metre';
  const call = (name, fn) => {
    try { fn?.(); } catch (error) { console.warn('[pinkie-quiet]', name, error); }
  };
  function apply() {
    const next = want();
    if (next === quiet) return;
    quiet = next;
    root.toggleAttribute('data-pinkie-quiet', quiet);
    for (const [name, rec] of modules) {
      if (quiet && !rec.suspended) { rec.suspended = true; call(name, rec.suspend); }
      else if (!quiet && rec.suspended) { rec.suspended = false; call(name, rec.resume); }
    }
    try { window.dispatchEvent(new CustomEvent('pinkie:quiet-change', {detail: {quiet}})); } catch {}
  }
  let legacyLoaded;
  const stopLegacyMotion = () => {
    window.gsap?.ticker?.sleep();
    window.__pinkieDeskVendors?.gsap?.ticker?.sleep();
  };
  const legacySelector = 'script[type="application/x-pinkie-legacy"][src]';
  let signatureLoaded;
  function activateScript(entry) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.async = false;
      script.src = entry.src;
      script.onload = resolve;
      script.onerror = resolve;
      entry.replaceWith(script);
    });
  }
  function loadSignature() {
    const entry = document.querySelector(legacySelector + '[data-pinkie-signature]');
    if (entry) signatureLoaded = activateScript(entry);
    return signatureLoaded;
  }
  function loadLegacy() {
    if (want() || (!root.hasAttribute('data-laolao-mode') && root.hasAttribute('data-laolao-splash-metre'))) return;
    if (legacyLoaded) return legacyLoaded;
    const scripts = [...document.querySelectorAll(legacySelector + ':not([data-pinkie-signature])')];
    // Dynamic classic scripts with async=false execute in insertion order.
    // The study vendors snapshot and restore window.gsap around their own copy.
    legacyLoaded = Promise.all([loadSignature(), ...scripts.map(activateScript)])
      .then(() => { if (want()) stopLegacyMotion(); });
    return legacyLoaded;
  }
  window.__pinkieQuiet = Object.freeze({
    get quiet() { return quiet; },
    register(name, hooks = {}) {
      const rec = {suspend: hooks.suspend, resume: hooks.resume, suspended: false};
      modules.set(String(name), rec);
      if (quiet) { rec.suspended = true; call(name, rec.suspend); }
      return rec;
    },
    // 只是一个轮询定时器的模块：if (!window.__pinkieQuiet?.interval('名字', fn, 毫秒)) setInterval(fn, 毫秒);
    // Metre 里清掉，离开时重开。返回 true 表示调度器接手了（没有固定的定时器编号可以给）。
    interval(name, fn, ms) {
      let id = 0;
      const rec = {suspend: () => { clearInterval(id); id = 0; }, resume: () => { if (!id) id = setInterval(fn, ms); }, suspended: false};
      modules.set(String(name), rec);
      if (quiet) rec.suspended = true; else id = setInterval(fn, ms);
      return true;
    },
    loadSignature,
    list: () => [...modules].map(([name, rec]) => ({name, suspended: rec.suspended})),
  });
  // 后端那一半（services/mode-architecture/quiet-mode.mjs）：告诉网关现在是不是 Metre。网关那边 30 分钟不续就当不是，
  // 所以在 Metre 里每 10 分钟续一次（只有这一个定时器，离开 Metre 就清掉）。
  let renew = 0;
  const tell = () => {
    const request = window.__laolaoSidebar?.gwRequest;
    if (typeof request === 'function') request('pinkie.quiet.set', {quiet}, 8000).catch(() => {});
  };
  window.addEventListener('pinkie:quiet-change', () => {
    if (quiet) stopLegacyMotion(); else loadLegacy();
    tell();
    clearInterval(renew); renew = quiet ? setInterval(tell, 10 * 60_000) : 0;
  });
  window.addEventListener('pinkie:sidebar-gateway-ready', tell);
  new MutationObserver(apply).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode']});
  apply();
  document.addEventListener('DOMContentLoaded', loadLegacy, {once: true});
  if (quiet && !renew) renew = setInterval(tell, 10 * 60_000);
})();
