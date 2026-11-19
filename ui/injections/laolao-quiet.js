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
  let signatureLoaded, signatureMotion;
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
    if (entry) signatureLoaded = activateScript(entry).then(() => { signatureMotion = window.gsap; });
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
    get signatureMotion() { return signatureMotion; },
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

  // 空闲节拍：Metre 里 5 秒没有输入、也没有对话/运行事件时，页面里的短轮询（≤ 5 秒）一律放慢到 5 秒一次；
  // 一有输入或网关的 chat / agent 事件就马上恢复原节拍，被拖住的轮询当场补跑一次。
  // 几十个模块各自 300–1500ms 的轮询加起来，是 Metre 空闲 CPU 下不到 1% 的主要原因，在这里统一放慢，
  // 不用逐个模块改。只认 chat / agent 事件，不认 RPC 回包：否则轮询自己发的请求会把自己一直叫醒。
  // 一分钟都没人动、也没有对话事件，再放慢到 30 秒一次（几十个轮询每 5 秒一轮，原生 WebKit 里仍有约 1–2% 空闲 CPU）。
  const IDLE_AFTER = 5_000, IDLE_FLOOR = 5_000, SHORT = 5_000, DEEP_AFTER = 60_000, DEEP_FLOOR = 30_000;
  const nativeSetInterval = window.setInterval, nativeClearInterval = window.clearInterval;
  const nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
  const paced = new Map();
  let nextPaced = 0x40000000, lastActive = Date.now();
  const idle = () => quiet && Date.now() - lastActive > IDLE_AFTER;
  const arm = (rec, delay) => { rec.due = Date.now() + delay; rec.timer = nativeSetTimeout.call(window, () => tick(rec), delay); };
  function tick(rec) {
    if (!paced.has(rec.id)) return;
    const still = quiet ? Date.now() - lastActive : 0;
    arm(rec, still > DEEP_AFTER ? Math.max(rec.ms, DEEP_FLOOR) : still > IDLE_AFTER ? Math.max(rec.ms, IDLE_FLOOR) : rec.ms);
    rec.fn.apply(window, rec.args);
  }
  window.setInterval = function setInterval(fn, ms, ...args) {
    const delay = Math.max(0, Number(ms) || 0);
    if (typeof fn !== 'function' || delay > SHORT) return nativeSetInterval.call(window, fn, ms, ...args);
    const rec = {id: ++nextPaced, fn, ms: delay, args, timer: 0, due: 0};
    paced.set(rec.id, rec);
    arm(rec, delay);
    return rec.id;
  };
  const clearPaced = native => function (id) {
    const rec = paced.get(id);
    if (!rec) return native.call(window, id);
    paced.delete(id);
    nativeClearTimeout.call(window, rec.timer);
  };
  window.clearInterval = clearPaced(nativeClearInterval);
  window.clearTimeout = clearPaced(nativeClearTimeout);
  function wake() {
    const was = idle();
    lastActive = Date.now();
    if (!was) return;
    for (const rec of paced.values()) if (rec.due - lastActive > rec.ms) { nativeClearTimeout.call(window, rec.timer); arm(rec, 0); }
  }
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focusin', 'visibilitychange']) {
    window.addEventListener(type, wake, {capture: true, passive: true});
  }
  window.addEventListener('pinkie:quiet-change', wake);
  const NativeSocket = window.WebSocket;
  if (typeof NativeSocket === 'function' && typeof Proxy === 'function') {
    const RUN_EVENT = /"event":"(?:chat|agent)"/;
    window.WebSocket = new Proxy(NativeSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        socket.addEventListener('message', event => { if (typeof event.data === 'string' && RUN_EVENT.test(event.data.slice(0, 200))) wake(); });
        return socket;
      },
    });
  }

  new MutationObserver(apply).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode']});
  apply();
  document.addEventListener('DOMContentLoaded', loadLegacy, {once: true});
  if (quiet && !renew) renew = setInterval(tell, 10 * 60_000);
})();
