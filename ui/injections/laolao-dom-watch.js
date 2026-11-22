// M3-2: Shared page-wide MutationObserver and native-equivalent polling helper
// for the Control UI. Exposes window.Pinkie.domWatch without adding any
// window.__* globals.
//
// Native equivalence rules:
// - Polling (every/poll): delegates directly to native window.setInterval /
//   window.clearInterval with pauseWhenHidden=false by default and uncaught
//   callback errors propagated normally.
// - Observers (createObserver/observe/watchTree):
//   * Multiple targets per observer, same-target re-observe option replacement,
//     disconnect discarding pending records, pre-observe mutation isolation,
//     takeRecords(), removed/moved-before-delivery and transient observers,
//     strict option validation, and uncaught error reporting all match native
//     MutationObserver semantics.
//   * Targets/options that cannot be emulated identically on the shared
//     documentElement observer (detached nodes, ShadowRoot or shadow
//     descendants, document/foreign-document targets, attributeOldValue,
//     characterDataOldValue, or targets detached after observation starts)
//     transparently use a native MutationObserver so behavior stays exact.
(() => {
  'use strict';

  const rootNs = (window.Pinkie = window.Pinkie || {});
  if (rootNs.domWatch) return;

  const sharedSubscribers = new Set();
  const nativeSubscribers = new Set();
  const pendingSubscribers = new Set();
  const watchers = new Set();
  const timers = new Set();

  let rootObserver = null;
  let observerSeq = 0;
  let regVersionSeq = 0;
  let transientMap = null;
  let hasDetachedCheckPending = false;
  let flushScheduled = false;
  let rafScheduled = false;
  let pendingWatcherRecords = [];

  function createNativeObserver(cb) {
    return new MutationObserver(cb);
  }

  function reportAsyncError(err) {
    if (typeof window.reportError === 'function') {
      window.reportError(err);
    } else {
      window.setTimeout(() => { throw err; }, 0);
    }
  }

  function validateTarget(target) {
    if (!target || typeof target !== 'object' || typeof target.nodeType !== 'number') {
      throw new TypeError("Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.");
    }
  }

  function normalizeOptions(options, forceSubtree) {
    if (options !== undefined && options !== null && typeof options !== 'object') {
      throw new TypeError("Failed to execute 'observe' on 'MutationObserver': parameter 2 is not of type 'MutationObserverInit'.");
    }
    const opts = options || {};
    const hasAttrOld = opts.attributeOldValue !== undefined;
    const hasAttrFilter = opts.attributeFilter !== undefined;
    const hasCharOld = opts.characterDataOldValue !== undefined;

    if (hasAttrOld && opts.attributeOldValue && opts.attributes === false) {
      throw new TypeError("Failed to execute 'observe' on 'MutationObserver': The options object may only set 'attributeOldValue' to true when 'attributes' is true or not present.");
    }
    if (hasAttrFilter && opts.attributes === false) {
      throw new TypeError("Failed to execute 'observe' on 'MutationObserver': The options object may only set 'attributeFilter' when 'attributes' is true or not present.");
    }
    if (hasCharOld && opts.characterDataOldValue && opts.characterData === false) {
      throw new TypeError("Failed to execute 'observe' on 'MutationObserver': The options object may only set 'characterDataOldValue' to true when 'characterData' is true or not present.");
    }

    const childList = Boolean(opts.childList);
    const attributes = opts.attributes !== undefined ? Boolean(opts.attributes) : (hasAttrOld || hasAttrFilter);
    const characterData = opts.characterData !== undefined ? Boolean(opts.characterData) : hasCharOld;
    const subtree = forceSubtree || Boolean(opts.subtree);
    const attributeOldValue = Boolean(opts.attributeOldValue);
    const characterDataOldValue = Boolean(opts.characterDataOldValue);

    if (!childList && !attributes && !characterData) {
      throw new TypeError("Failed to execute 'observe' on 'MutationObserver': The options object must set at least one of 'attributes', 'characterData', or 'childList' to true.");
    }

    let attributeFilter = null;
    let rawAttributeFilter;
    if (hasAttrFilter) {
      const list = Array.from(opts.attributeFilter, String);
      attributeFilter = new Set(list);
      rawAttributeFilter = list;
    }

    const nativeInit = {childList, attributes, characterData, subtree};
    if (attributeOldValue) nativeInit.attributeOldValue = true;
    if (characterDataOldValue) nativeInit.characterDataOldValue = true;
    if (rawAttributeFilter !== undefined) nativeInit.attributeFilter = rawAttributeFilter;

    return {
      childList,
      attributes,
      characterData,
      subtree,
      attributeOldValue,
      characterDataOldValue,
      attributeFilter,
      nativeInit,
      version: ++regVersionSeq,
    };
  }

  function canShareRoot(target, reg) {
    if (!rootObserver) return false;
    if (reg.attributeOldValue || reg.characterDataOldValue) return false;
    const docEl = document.documentElement;
    if (!docEl) return false;
    if (typeof Node === 'function' && !(target instanceof Node)) return false;
    if (target === docEl) return true;
    return Boolean(typeof docEl.contains === 'function' && docEl.contains(target));
  }

  function matchesRecordType(reg, rec) {
    const type = rec.type;
    if (type === 'childList') return reg.childList;
    if (type === 'attributes') {
      if (!reg.attributes) return false;
      if (reg.attributeFilter !== null) {
        return reg.attributeFilter.has(rec.attributeName);
      }
      return true;
    }
    if (type === 'characterData') return reg.characterData;
    return false;
  }

  function ensureNativeMO(sub) {
    if (sub.nativeMO) return sub.nativeMO;
    sub.nativeMO = createNativeObserver((records) => {
      let batch = records;
      if (sub.queue.length > 0) {
        batch = sub.queue.concat(records);
        sub.queue = [];
        pendingSubscribers.delete(sub);
      }
      if (batch.length === 0) return;
      sub.callback(batch, sub.handle);
    });
    nativeSubscribers.add(sub);
    return sub.nativeMO;
  }

  function promoteToNative(sub) {
    if (sub.nativeMO) return;
    const mo = ensureNativeMO(sub);
    sharedSubscribers.delete(sub);
    for (const [target, reg] of sub.targets) {
      mo.observe(target, reg.nativeInit);
    }
  }

  function promoteDetachedSharedTargets() {
    const docEl = document.documentElement;
    for (const sub of [...sharedSubscribers]) {
      let detached = false;
      for (const target of sub.targets.keys()) {
        if (!docEl || (target !== docEl && !docEl.contains(target))) {
          detached = true;
          break;
        }
      }
      if (detached) {
        promoteToNative(sub);
      }
    }
  }

  function flushWatchers() {
    rafScheduled = false;
    const batch = pendingWatcherRecords;
    pendingWatcherRecords = [];
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
      } catch (err) {
        reportAsyncError(err);
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

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flushPending);
  }

  function ingestRootRecords(records, fromRootCallback) {
    if (!records || records.length === 0) return;

    if (watchers.size > 0) {
      for (let i = 0; i < records.length; i += 1) pendingWatcherRecords.push(records[i]);
      scheduleWatchers();
    }

    if (sharedSubscribers.size === 0) return;

    const len = records.length;
    let hasChildList = false;
    let hasRemoval = false;
    for (let i = 0; i < len; i += 1) {
      if (records[i].type === 'childList') {
        hasChildList = true;
        if (records[i].removedNodes.length > 0) hasRemoval = true;
      }
    }
    if (hasRemoval) hasDetachedCheckPending = true;

    const ancestorChains = new Array(len);
    const parentOverride = hasChildList ? new Map() : null;

    for (let i = len - 1; i >= 0; i -= 1) {
      const rec = records[i];
      const chain = [];
      let cur = rec.target;
      while (cur) {
        chain.push(cur);
        cur = parentOverride && parentOverride.has(cur) ? parentOverride.get(cur) : cur.parentNode;
      }
      ancestorChains[i] = chain;

      if (parentOverride && rec.type === 'childList') {
        const added = rec.addedNodes;
        for (let j = 0; j < added.length; j += 1) {
          parentOverride.set(added[j], null);
        }
        const removed = rec.removedNodes;
        for (let j = 0; j < removed.length; j += 1) {
          parentOverride.set(removed[j], rec.target);
        }
      }
    }

    const activeSubs = [...sharedSubscribers];
    for (let i = 0; i < len; i += 1) {
      const rec = records[i];
      const chain = ancestorChains[i];

      let matchedTransient = null;
      if (transientMap && transientMap.size > 0) {
        for (let c = 0; c < chain.length; c += 1) {
          const list = transientMap.get(chain[c]);
          if (list) {
            if (!matchedTransient) matchedTransient = [];
            for (let k = 0; k < list.length; k += 1) matchedTransient.push(list[k]);
          }
        }
      }

      for (let s = 0; s < activeSubs.length; s += 1) {
        const sub = activeSubs[s];
        let matched = false;

        for (let c = 0; c < chain.length; c += 1) {
          const reg = sub.targets.get(chain[c]);
          if (!reg) continue;
          if ((c === 0 || reg.subtree) && matchesRecordType(reg, rec)) {
            matched = true;
            break;
          }
        }

        if (!matched && matchedTransient) {
          for (let k = 0; k < matchedTransient.length; k += 1) {
            const tr = matchedTransient[k];
            if (tr.sub !== sub) continue;
            const currentReg = sub.targets.get(tr.target);
            if (!currentReg || currentReg.version !== tr.version) continue;
            if (matchesRecordType(currentReg, rec)) {
              matched = true;
              break;
            }
          }
        }

        if (matched) {
          sub.queue.push(rec);
          pendingSubscribers.add(sub);
        }
      }

      if (rec.type === 'childList' && rec.removedNodes.length > 0) {
        let toAttach = null;
        for (let s = 0; s < activeSubs.length; s += 1) {
          const sub = activeSubs[s];
          for (let c = 0; c < chain.length; c += 1) {
            const targetNode = chain[c];
            const reg = sub.targets.get(targetNode);
            if (reg && reg.subtree) {
              if (!toAttach) toAttach = [];
              toAttach.push({sub, target: targetNode, version: reg.version});
            }
          }
        }
        if (matchedTransient) {
          for (let k = 0; k < matchedTransient.length; k += 1) {
            const tr = matchedTransient[k];
            const currentReg = tr.sub.targets.get(tr.target);
            if (currentReg && currentReg.version === tr.version) {
              if (!toAttach) toAttach = [];
              toAttach.push(tr);
            }
          }
        }
        if (toAttach && toAttach.length > 0) {
          if (!transientMap) transientMap = new Map();
          const removed = rec.removedNodes;
          for (let j = 0; j < removed.length; j += 1) {
            const node = removed[j];
            let list = transientMap.get(node);
            if (!list) {
              list = [];
              transientMap.set(node, list);
            }
            for (let k = 0; k < toAttach.length; k += 1) list.push(toAttach[k]);
          }
        }
      }
    }

    if (!fromRootCallback && (pendingSubscribers.size > 0 || (transientMap && transientMap.size > 0) || hasDetachedCheckPending)) {
      scheduleFlush();
    }
  }

  function drainRoot() {
    if (!rootObserver) return;
    const recs = rootObserver.takeRecords();
    if (recs.length > 0) ingestRootRecords(recs, false);
  }

  function flushPending() {
    flushScheduled = false;
    drainRoot();
    if (pendingSubscribers.size > 0) {
      const toNotify = [...pendingSubscribers].sort((a, b) => a.seq - b.seq);
      pendingSubscribers.clear();
      for (let i = 0; i < toNotify.length; i += 1) {
        const sub = toNotify[i];
        drainRoot();
        if (sub.queue.length === 0) continue;
        const batch = sub.queue;
        sub.queue = [];
        pendingSubscribers.delete(sub);
        try {
          sub.callback(batch, sub.handle);
        } catch (err) {
          reportAsyncError(err);
        }
      }
    }
    drainRoot();
    if (pendingSubscribers.size > 0) {
      transientMap = null;
      scheduleFlush();
      return;
    }
    transientMap = null;
    if (hasDetachedCheckPending) {
      hasDetachedCheckPending = false;
      promoteDetachedSharedTargets();
    }
  }

  function onRootMutations(records) {
    ingestRootRecords(records, true);
    flushPending();
  }

  function ensureRootObserver() {
    if (rootObserver || typeof MutationObserver !== 'function') return;
    const start = () => {
      if (rootObserver || !document.documentElement) return;
      rootObserver = createNativeObserver(onRootMutations);
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
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to construct 'MutationObserver': parameter 1 is not of type 'Function'.");
    }
    const sub = {
      seq: ++observerSeq,
      callback,
      targets: new Map(),
      queue: [],
      nativeMO: null,
      handle: null,
    };

    function bindTarget(target, options, forceSubtree) {
      validateTarget(target);
      const reg = normalizeOptions(options, forceSubtree);
      ensureRootObserver();
      drainRoot();

      if (sub.nativeMO) {
        sub.nativeMO.observe(target, reg.nativeInit);
        sub.targets.set(target, reg);
        return;
      }

      if (!canShareRoot(target, reg)) {
        promoteToNative(sub);
        sub.nativeMO.observe(target, reg.nativeInit);
        sub.targets.set(target, reg);
        return;
      }

      sub.targets.set(target, reg);
      sharedSubscribers.add(sub);
    }

    const handle = {
      observe(target, options) {
        bindTarget(target, options, false);
      },
      watch(target, options) {
        bindTarget(target, options, true);
      },
      disconnect() {
        drainRoot();
        if (sub.nativeMO) {
          sub.nativeMO.disconnect();
          sub.nativeMO = null;
          nativeSubscribers.delete(sub);
        }
        sharedSubscribers.delete(sub);
        pendingSubscribers.delete(sub);
        sub.targets.clear();
        sub.queue.length = 0;
      },
      takeRecords() {
        drainRoot();
        let out = sub.queue.length > 0 ? sub.queue : [];
        if (out.length > 0) {
          sub.queue = [];
          pendingSubscribers.delete(sub);
        }
        if (sub.nativeMO) {
          const nativeRecs = sub.nativeMO.takeRecords();
          if (nativeRecs.length > 0) {
            out = out.length > 0 ? out.concat(nativeRecs) : nativeRecs;
          }
        }
        return out;
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
      handle.watch(target, options);
    }
    return {
      disconnect: () => handle.disconnect(),
      reconnect: (nextTarget, nextOptions) => handle.watch(nextTarget, nextOptions || options),
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

  ensureRootObserver();

  rootNs.domWatch = {
    createObserver,
    observe,
    watchTree,
    watch,
    every,
    poll,
    stats() {
      const sharedCount = rootObserver ? 1 : 0;
      return {
        observerCount: sharedCount + nativeSubscribers.size,
        sharedObserverCount: sharedCount,
        nativeFallbackCount: nativeSubscribers.size,
        subscriberCount: sharedSubscribers.size + nativeSubscribers.size,
        watcherCount: watchers.size,
        timerCount: timers.size,
      };
    },
  };
})();
