// M3-2: Single shared subtree MutationObserver and visibility-aware scheduler
// for the entire Control UI. Exposes window.Pinkie.domWatch without adding
// any window.__* globals.
(() => {
  'use strict';

  const rootNs = (window.Pinkie = window.Pinkie || {});
  if (rootNs.domWatch) return;

  const subscribers = new Set();
  const watchers = new Set();
  const timers = new Set();
  let rafScheduled = false;
  let pendingRecords = [];
  let rootObserver = null;
  let timerTickId = 0;

  function matchesTarget(sub, rec) {
    const t = sub.target;
    if (!t || t === document || t === document.documentElement) return true;
    const rt = rec.target;
    if (!rt) return false;
    if (rt === t) return true;
    if (sub.subtree && typeof t.contains === 'function' && t.contains(rt)) return true;
    return false;
  }

  function matchesType(sub, rec) {
    if (rec.type === 'childList') return sub.childList;
    if (rec.type === 'attributes') {
      if (!sub.attributes) return false;
      if (sub.attributeFilter && sub.attributeFilter.size > 0) {
        return sub.attributeFilter.has(rec.attributeName);
      }
      return true;
    }
    if (rec.type === 'characterData') return sub.characterData;
    return false;
  }

  function flushWatchers() {
    rafScheduled = false;
    const batch = pendingRecords;
    pendingRecords = [];
    if (watchers.size === 0) return;
    for (const w of [...watchers]) {
      if (!w.active) continue;
      try {
        const nodes = typeof w.selector === 'string' && w.selector
          ? document.querySelectorAll(w.selector)
          : null;
        if (!nodes || nodes.length > 0 || w.always) {
          w.handler(nodes ? Array.from(nodes) : [], batch);
        }
      } catch {
        // Isolate subscriber errors so one module never breaks the shared observer.
      }
    }
  }

  function scheduleWatchers() {
    if (rafScheduled || watchers.size === 0) return;
    rafScheduled = true;
    if (typeof requestAnimationFrame === 'function' && !document.hidden) {
      requestAnimationFrame(flushWatchers);
    } else {
      Promise.resolve().then(flushWatchers);
    }
  }

  function dispatchMutations(records) {
    if (!records || records.length === 0) return;
    for (const sub of [...subscribers]) {
      if (!sub.active) continue;
      const matched = [];
      for (let i = 0; i < records.length; i += 1) {
        const rec = records[i];
        if (matchesType(sub, rec) && matchesTarget(sub, rec)) {
          matched.push(rec);
        }
      }
      if (matched.length > 0) {
        try {
          sub.callback(matched, sub.handle);
        } catch {
          // Isolate subscriber errors.
        }
      }
    }
    if (watchers.size > 0) {
      for (let i = 0; i < records.length; i += 1) pendingRecords.push(records[i]);
      scheduleWatchers();
    }
  }

  function ensureRootObserver() {
    if (rootObserver || typeof MutationObserver !== 'function') return;
    const start = () => {
      if (rootObserver || !document.documentElement) return;
      rootObserver = new MutationObserver(dispatchMutations);
      rootObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    };
    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, {once: true});
    }
  }

  function createObserver(callback) {
    const sub = {
      active: false,
      target: null,
      childList: false,
      attributes: false,
      characterData: false,
      subtree: false,
      attributeFilter: null,
      callback,
      handle: null,
    };
    const handle = {
      observe(target, options = {}) {
        ensureRootObserver();
        sub.target = target || document.documentElement;
        sub.childList = Boolean(options.childList);
        sub.attributes = Boolean(options.attributes || (options.attributeFilter && options.attributeFilter.length));
        sub.characterData = Boolean(options.characterData);
        sub.subtree = Boolean(options.subtree);
        sub.attributeFilter = Array.isArray(options.attributeFilter) ? new Set(options.attributeFilter) : null;
        if (!sub.childList && !sub.attributes && !sub.characterData) {
          sub.childList = true;
        }
        sub.active = true;
        subscribers.add(sub);
      },
      watch(target, options = {}) {
        handle.observe(target, {...options, subtree: true});
      },
      disconnect() {
        sub.active = false;
        subscribers.delete(sub);
      },
      takeRecords() {
        return [];
      },
    };
    sub.handle = handle;
    return handle;
  }

  function observe(target, callback, options = {}) {
    const handle = createObserver(callback);
    handle.observe(target, options);
    return handle;
  }

  function watchTree(target, callback, options = {}) {
    const handle = createObserver(callback);
    if (target) {
      handle.observe(target, {...options, subtree: true});
    }
    return {
      disconnect: () => handle.disconnect(),
      reconnect: (nextTarget, nextOptions) => handle.observe(nextTarget, {...(nextOptions || options), subtree: true}),
      takeRecords: () => handle.takeRecords(),
    };
  }

  function watch(selector, handler, options = {}) {
    ensureRootObserver();
    const entry = {
      selector: selector || '',
      handler,
      always: Boolean(options.always),
      active: true,
    };
    watchers.add(entry);
    if (options.immediate) {
      scheduleWatchers();
    }
    return {
      disconnect() {
        entry.active = false;
        watchers.delete(entry);
      },
    };
  }

  function runTimers() {
    timerTickId = 0;
    if (timers.size === 0) return;
    const now = Date.now();
    let nextWait = 60000;
    for (const t of [...timers]) {
      if (!t.active) continue;
      if (t.pauseWhenHidden && document.hidden) {
        nextWait = Math.min(nextWait, Math.max(250, t.ms));
        continue;
      }
      if (now >= t.nextAt) {
        t.nextAt = now + t.ms;
        try {
          t.handler();
        } catch {
          // Isolate timer callback errors.
        }
      }
      nextWait = Math.min(nextWait, Math.max(50, t.nextAt - now));
    }
    if (timers.size > 0) {
      timerTickId = setTimeout(runTimers, nextWait);
    }
  }

  function scheduleTimerTick() {
    if (timerTickId || timers.size === 0) return;
    let nextWait = 60000;
    const now = Date.now();
    for (const t of timers) {
      if (!t.active) continue;
      nextWait = Math.min(nextWait, Math.max(50, t.nextAt - now));
    }
    timerTickId = setTimeout(runTimers, nextWait);
  }

  function every(ms, handler, options = {}) {
    const intervalMs = Math.max(50, Number(ms) || 1000);
    const entry = {
      ms: intervalMs,
      handler,
      pauseWhenHidden: options.pauseWhenHidden !== false,
      nextAt: Date.now() + intervalMs,
      active: true,
    };
    timers.add(entry);
    scheduleTimerTick();
    return {
      stop() {
        entry.active = false;
        timers.delete(entry);
      },
    };
  }

  ensureRootObserver();

  rootNs.domWatch = {
    createObserver,
    observe,
    watchTree,
    watch,
    every,
    stats() {
      return {
        observerCount: rootObserver ? 1 : 0,
        subscriberCount: subscribers.size,
        watcherCount: watchers.size,
        timerCount: timers.size,
      };
    },
  };
})();
