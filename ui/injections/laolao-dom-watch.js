// M3 rework: Thin wrapper over native MutationObserver and window.setInterval
// exposed at window.Pinkie.domWatch (no window.__* globals, no eager root observer).
//
// Behavioral equivalence with native browser APIs is strictly prioritized:
// - createObserver(cb) returns a real native MutationObserver instance with an
//   added .watch(target, options) convenience method equivalent to
//   observe(target, { ...options, subtree: true }).
// - every(ms, handler, options) / poll(handler, ms, options) delegate directly
//   to native window.setInterval / window.clearInterval (running normally when
//   document.hidden is true unless pauseWhenHidden: true is explicitly passed,
//   with uncaught errors reported normally).
(() => {
  'use strict';

  const rootNs = (window.Pinkie = window.Pinkie || {});
  if (rootNs.domWatch) return;

  const timers = new Set();
  let createdObservers = 0;

  function createObserver(callback) {
    const observer = new MutationObserver(callback);
    createdObservers += 1;
    observer.watch = function watch(target, options) {
      if (options !== undefined && options !== null && typeof options !== 'object') {
        return this.observe(target, options);
      }
      return this.observe(target, {...options, subtree: true});
    };
    return observer;
  }

  function observe(target, callback, options) {
    const observer = createObserver(callback);
    observer.observe(target, options);
    return observer;
  }

  function watchTree(target, callback, options = {}) {
    const observer = createObserver(callback);
    if (target) {
      observer.watch(target, options);
    }
    return {
      disconnect: () => observer.disconnect(),
      reconnect: (nextTarget, nextOptions) => observer.watch(nextTarget, nextOptions || options),
      takeRecords: () => observer.takeRecords(),
    };
  }

  function watch(selector, handler, options = {}) {
    let pendingRecords = [];
    let rafScheduled = false;
    let active = true;

    function flush() {
      rafScheduled = false;
      if (!active) return;
      const batch = pendingRecords;
      pendingRecords = [];
      const nodes = typeof selector === 'string' && selector
        ? document.querySelectorAll(selector)
        : null;
      if (!nodes || nodes.length > 0 || options.always) {
        handler(nodes ? Array.from(nodes) : [], batch);
      }
    }

    function schedule() {
      if (rafScheduled || !active) return;
      rafScheduled = true;
      if (typeof requestAnimationFrame === 'function' && !document.hidden) {
        requestAnimationFrame(flush);
      } else {
        Promise.resolve().then(flush);
      }
    }

    const observer = createObserver((records) => {
      for (let i = 0; i < records.length; i += 1) pendingRecords.push(records[i]);
      schedule();
    });

    function start() {
      if (!active || !document.documentElement) return;
      observer.watch(document.documentElement, {
        childList: true,
        attributes: true,
        characterData: true,
      });
    }

    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, {once: true});
    }

    if (options.immediate) {
      schedule();
    }

    return {
      disconnect() {
        active = false;
        pendingRecords = [];
        observer.disconnect();
      },
    };
  }

  function every(ms, handler, options = {}) {
    const pauseWhenHidden = Boolean(options && options.pauseWhenHidden === true);
    const fn = pauseWhenHidden
      ? () => { if (!document.hidden) handler(); }
      : handler;
    let active = true;
    const id = window.setInterval(fn, ms);
    const entry = {
      stop() {
        if (!active) return;
        active = false;
        window.clearInterval(id);
        timers.delete(entry);
      },
    };
    timers.add(entry);
    return entry;
  }

  function poll(handler, ms, options = {}) {
    return every(ms, handler, options);
  }

  rootNs.domWatch = {
    createObserver,
    observe,
    watchTree,
    watch,
    every,
    poll,
    stats() {
      return {
        createdObservers,
        timerCount: timers.size,
      };
    },
  };
})();
