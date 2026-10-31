/* laolao-perf:v4
 * 2026.10 already virtualizes chat rows in the Lit renderer (overscan: 6).
 * Leave those rows and their scroll/resize anchors entirely under native control.
 * Old bundles get a measured content-visibility fallback; it skips layout/paint,
 * but deliberately does not detach Lit-owned nodes or claim to bound DOM count.
 */
(function () {
  'use strict';
  if (window.__pinkieChatViewport) {
    window.__pinkieChatViewport.install();
    return;
  }

  var ATTR = 'data-pinkie-offscreen';
  var BUFFER = 1200;
  var controllers = new Map();
  var interval = 0, style = null, installed = false;
  var frame = window.requestAnimationFrame.bind(window);
  var cancelFrame = window.cancelAnimationFrame.bind(window);
  var canPark = 'IntersectionObserver' in window && window.CSS && CSS.supports('content-visibility', 'hidden');

  function groups(inner) {
    return Array.prototype.filter.call(inner.children, function (el) { return el.classList.contains('chat-group'); });
  }
  function paneFor(inner) { return inner.closest('openclaw-chat-pane') || inner.closest('openclaw-app') || inner; }
  function stateFor(c) { return c.pane && c.pane.state; }
  function sessionFor(c) { var state = stateFor(c); return state ? (state.sessionKey || '') + '\u0000' + (state.currentSessionId || '') : ''; }
  function nativeInner(inner) { return inner.classList.contains('chat-thread-inner--virtual'); }
  function valid(c) { return installed && c.inner.isConnected && c.thread.isConnected && controllers.get(c.inner) === c; }
  function keyFor(el) {
    var own = el.getAttribute('data-message-id') || el.getAttribute('data-pinkie-process') || el.id;
    if (own) return own;
    var message = el.querySelector('[data-message-id], [data-pinkie-message], .chat-bubble[id]');
    var key = message && (message.getAttribute('data-message-id') || message.getAttribute('data-pinkie-message') || message.id) || '';
    // Legacy bubble IDs end in the position within the projected page. That
    // suffix changes as tool rows enter the page; the message timestamp does not.
    return key.replace(/^(msg:(?:user|assistant|system|tool):\d+):\d+$/, '$1');
  }
  function resolve(pane) {
    if (!pane) return null;
    if (controllers.has(pane)) {
      var known = controllers.get(pane);
      if (known.native === nativeInner(pane)) return known;
      teardown(known);
      attach(pane);
      return controllers.get(pane) || null;
    }
    var inner = pane.matches && pane.matches('.chat-thread-inner') ? pane : pane.querySelector && pane.querySelector('.chat-thread-inner');
    if (!inner) return null;
    var current = controllers.get(inner);
    if (current && current.native !== nativeInner(inner)) teardown(current);
    if (!controllers.has(inner)) attach(inner);
    return controllers.get(inner) || null;
  }
  function captureController(c) {
    if (!c || !valid(c)) return null;
    // The native virtualizer captures prepend / row / end anchors before its own
    // commit. A second scrollTop correction here would fight that controller.
    if (c.native) return {native: true};
    var view = c.thread.getBoundingClientRect();
    var anchors = [], kids = groups(c.inner);
    var lo = 0, hi = kids.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (kids[mid].getBoundingClientRect().bottom <= view.top) lo = mid + 1; else hi = mid;
    }
    for (var i = lo; i < kids.length; i++) {
      var rect = kids[i].getBoundingClientRect();
      if (rect.bottom <= view.top || rect.top >= view.bottom) continue;
      anchors.push({node: kids[i], key: keyFor(kids[i]), offset: rect.top - view.top});
      if (anchors.length === 3) break;
    }
    var state = stateFor(c);
    var atBottom = c.followRequested || c.thread.scrollHeight - c.thread.clientHeight - c.thread.scrollTop <= 2;
    // Explicit follow state is stronger than a stale geometric near-bottom guess.
    if (state) atBottom = atBottom && state.chatUserNearBottom === true && !state.chatFollowLocked;
    else atBottom = atBottom && !c.readerLocked;
    return {controller: c, state: stateFor(c), session: sessionFor(c), intent: c.intent, anchors: anchors,
      atBottom: atBottom, top: c.thread.scrollTop, height: c.thread.scrollHeight};
  }
  // Lit can remove the leading page or collapse a completed tool row. The
  // resulting upward clamp is layout work, not a reader asking to scroll up.
  // Match the native handler's baseline before its scroll listener sees it.
  function programmaticPosition(c, top) {
    var state = stateFor(c);
    if (!state) return;
    var target = Math.max(0, Math.min(top, c.thread.scrollHeight - c.thread.clientHeight));
    state.chatLastScrollTop = target;
    state.chatLastScrollHeight = c.thread.scrollHeight;
    state.chatProgrammaticScrollTarget = target + c.thread.clientHeight;
    state.chatIsProgrammaticScroll = true;
    var token = ++c.programmaticEpoch, session = sessionFor(c), intent = c.intent;
    if (c.programmaticFrame) cancelFrame(c.programmaticFrame);
    c.programmaticFrame = frame(function () {
      c.programmaticFrame = 0;
      if (token !== c.programmaticEpoch || stateFor(c) !== state || sessionFor(c) !== session || c.intent !== intent) return;
      if (state.chatProgrammaticScrollTarget === target + c.thread.clientHeight) state.chatIsProgrammaticScroll = false;
    });
  }
  function restoreNow(snapshot) {
    if (!snapshot || snapshot.native) return false;
    var c = snapshot.controller;
    if (!valid(c) || c.native || stateFor(c) !== snapshot.state
        || c.intent !== snapshot.intent || sessionFor(c) !== snapshot.session) return false;
    var next = null;
    if (snapshot.atBottom) {
      var state = stateFor(c);
      if (state && (state.chatUserNearBottom !== true || state.chatFollowLocked)) return false;
      next = c.thread.scrollHeight - c.thread.clientHeight;
    } else {
      var kids = groups(c.inner), anchor = null, node = null;
      for (var i = 0; i < snapshot.anchors.length; i++) {
        anchor = snapshot.anchors[i];
        node = anchor.node.parentElement === c.inner && (!anchor.key || keyFor(anchor.node) === anchor.key) ? anchor.node : null;
        if (!node && anchor.key) node = kids.find(function (el) { return keyFor(el) === anchor.key; });
        if (node) break;
      }
      // Do not guess by total height if all visible messages were removed; that
      // can jump to a different turn. A surviving neighbouring anchor is exact.
      if (node) next = c.thread.scrollTop + node.getBoundingClientRect().top - c.thread.getBoundingClientRect().top - anchor.offset;
    }
    if (next === null) return false;
    programmaticPosition(c, next);
    c.thread.scrollTop = Math.max(0, next);
    c.lastTop = c.thread.scrollTop;
    if (snapshot.atBottom) c.followRequested = false;
    return true;
  }
  function finishRestore(c) {
    c.pendingSnapshot = null;
    c.thread.style.setProperty('overflow-anchor', c.oldOverflowAnchor || '');
    c.lastSnapshot = captureController(c);
  }
  function queueRestore(snapshot, result) {
    if (!snapshot || snapshot.native) return;
    var c = snapshot.controller, epoch = ++c.restoreEpoch;
    if (c.restoreFrame) { cancelFrame(c.restoreFrame); c.restoreFrame = 0; }
    c.pendingSnapshot = snapshot;
    if (c.oldOverflowAnchor === null) c.oldOverflowAnchor = c.thread.style.getPropertyValue('overflow-anchor');
    c.thread.style.setProperty('overflow-anchor', 'none');
    // Lit commits asynchronously. Wait for both the caller's optional work and
    // updateComplete, then restore before the next paint. Return values stay intact.
    Promise.resolve(result).then(function () { return c.pane.updateComplete; }).then(function () {
      if (!valid(c) || epoch !== c.restoreEpoch) return;
      c.restoreFrame = frame(function () {
        c.restoreFrame = 0;
        if (epoch !== c.restoreEpoch) return;
        restoreNow(snapshot);
        finishRestore(c);
        schedule(c);
      });
    }, function () {
      if (valid(c) && epoch === c.restoreEpoch) finishRestore(c);
    });
  }
  function follow(pane) {
    var c = resolve(pane);
    if (!c || c.native) return;
    c.intent++;
    c.restoreEpoch++;
    if (c.restoreFrame) { cancelFrame(c.restoreFrame); c.restoreFrame = 0; }
    c.readerLocked = false;
    c.followRequested = true;
    if (c.pendingSnapshot) finishRestore(c);
  }
  function capture(pane) { return captureController(resolve(pane)); }
  function restore(snapshot) { queueRestore(snapshot); }
  function preserve(pane, fn) {
    var c = resolve(pane), pending = c && c.pendingSnapshot;
    var snapshot = pending && pending.intent === c.intent && pending.session === sessionFor(c) ? pending : captureController(c), result;
    try { result = fn(); } catch (error) { queueRestore(snapshot); throw error; }
    queueRestore(snapshot, result);
    return result;
  }

  function wake(el) {
    if (!el.hasAttribute(ATTR)) return;
    el.removeAttribute(ATTR);
    el.style.removeProperty('contain-intrinsic-block-size');
  }
  function park(el) {
    if (el.hasAttribute(ATTR) || el.querySelector('.streaming, .pinkie-process[data-live="1"]')) return;
    var h = el.getBoundingClientRect().height;
    if (!h) return;
    var css = getComputedStyle(el);
    var content = h - (parseFloat(css.paddingTop) || 0) - (parseFloat(css.paddingBottom) || 0)
      - (parseFloat(css.borderTopWidth) || 0) - (parseFloat(css.borderBottomWidth) || 0);
    el.style.setProperty('contain-intrinsic-block-size', Math.max(0, content) + 'px');
    el.setAttribute(ATTR, '');
  }
  function wakeNearby(c) {
    var view = c.thread.getBoundingClientRect(), kids = c.rows;
    // Binary search avoids walking the whole history on each scroll event.
    var lo = 0, hi = kids.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (kids[mid].getBoundingClientRect().bottom < view.top - BUFFER) lo = mid + 1; else hi = mid;
    }
    for (var i = lo; i < kids.length; i++) {
      if (kids[i].getBoundingClientRect().top > view.bottom + BUFFER) break;
      wake(kids[i]);
    }
  }
  function sync(c) {
    c.syncFrame = 0;
    if (!valid(c) || c.native) return;
    var kids = groups(c.inner), current = new Set(kids);
    c.rows = kids;
    c.observed.forEach(function (el) {
      if (current.has(el)) return;
      c.io && c.io.unobserve(el);
      wake(el);
      c.observed.delete(el);
    });
    kids.forEach(function (el) {
      if (c.observed.has(el)) return;
      c.observed.add(el);
      c.io && c.io.observe(el);
    });
    wakeNearby(c);
    if (!c.pendingSnapshot) c.lastSnapshot = captureController(c);
  }
  function schedule(c) { if (!c.syncFrame && valid(c) && !c.native) c.syncFrame = frame(function () { sync(c); }); }
  function resize(c) {
    if (!valid(c) || c.native) return;
    var width = Math.round(c.thread.getBoundingClientRect().width);
    if (!width || width === c.width) return;
    c.width = width;
    var snapshot = c.pendingSnapshot || c.lastSnapshot || captureController(c);
    // Sidebar/split changes resize the container without a window resize event.
    // Drop all cached heights at once and remeasure under the new wrapping width.
    c.observed.forEach(function (el) {
      wake(el);
      if (c.io) { c.io.unobserve(el); c.io.observe(el); }
    });
    queueRestore(snapshot);
    schedule(c);
  }
  function attach(inner) {
    if (controllers.has(inner)) return;
    var thread = inner.closest('.chat-thread');
    if (!thread) return;
    var c = {inner: inner, thread: thread, pane: paneFor(inner), native: nativeInner(inner),
      intent: 0, restoreEpoch: 0, restoreFrame: 0, syncFrame: 0, programmaticEpoch: 0, programmaticFrame: 0, observed: new Set(), rows: groups(inner),
      width: Math.round(thread.getBoundingClientRect().width), lastTop: thread.scrollTop,
      lastSnapshot: null, pendingSnapshot: null, oldOverflowAnchor: null, readerLocked: false, listeners: []};
    controllers.set(inner, c);
    if (c.native) return;
    function listen(type, fn, capture) { thread.addEventListener(type, fn, {passive: true, capture: !!capture}); c.listeners.push([type, fn, !!capture]); }
    function readerIntent(event) {
      if (event.type === 'keydown' && !/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(event.key)) return;
      c.intent++;
      c.programmaticEpoch++;
      var state = stateFor(c);
      if (state) state.chatIsProgrammaticScroll = false;
      c.readerLocked = true;
      c.followRequested = false;
      if (c.pendingSnapshot) { c.restoreEpoch++; finishRestore(c); }
    }
    listen('wheel', readerIntent);
    listen('touchstart', readerIntent);
    listen('pointerdown', readerIntent);
    listen('keydown', readerIntent);
    listen('scroll', function () {
      if (!valid(c)) return;
      var snapshot = c.pendingSnapshot, state = stateFor(c);
      var pending = snapshot && snapshot.state === state && snapshot.session === sessionFor(c) && snapshot.intent === c.intent;
      var nativeTarget = state && state.chatIsProgrammaticScroll
        && Math.abs(thread.scrollTop - Math.max(0, state.chatProgrammaticScrollTarget - thread.clientHeight)) <= 2;
      if (pending || nativeTarget) {
        programmaticPosition(c, thread.scrollTop);
        c.lastTop = thread.scrollTop;
      }
    }, true);
    listen('scroll', function () {
      if (!valid(c)) return;
      if (thread.scrollTop < c.lastTop && !c.pendingSnapshot) c.readerLocked = true;
      c.lastTop = thread.scrollTop;
      wakeNearby(c);
      if (!c.pendingSnapshot) c.lastSnapshot = captureController(c);
    });
    if (canPark) c.io = new IntersectionObserver(function (entries) {
      if (!valid(c)) return;
      var snapshot = captureController(c);
      entries.forEach(function (entry) {
        if (entry.target.parentElement !== inner) return;
        if (entry.isIntersecting) wake(entry.target); else park(entry.target);
      });
      restoreNow(snapshot);
      if (!c.pendingSnapshot) c.lastSnapshot = captureController(c);
    }, {root: thread, rootMargin: BUFFER + 'px 0px'});
    c.mo = new MutationObserver(function () { schedule(c); });
    c.mo.observe(inner, {childList: true});
    if ('ResizeObserver' in window) {
      c.ro = new ResizeObserver(function () { resize(c); });
      c.ro.observe(thread);
      c.ro.observe(inner);
    }
    c.lastSnapshot = captureController(c);
    schedule(c);
  }
  function teardown(c) {
    c.restoreEpoch++;
    if (c.syncFrame) cancelFrame(c.syncFrame);
    if (c.restoreFrame) cancelFrame(c.restoreFrame);
    if (c.programmaticFrame) cancelFrame(c.programmaticFrame);
    if (c.io) c.io.disconnect();
    if (c.mo) c.mo.disconnect();
    if (c.ro) c.ro.disconnect();
    c.listeners.forEach(function (pair) { c.thread.removeEventListener(pair[0], pair[1], pair[2]); });
    c.observed.forEach(wake);
    c.observed.clear();
    c.rows = [];
    c.lastSnapshot = c.pendingSnapshot = null;
    if (c.oldOverflowAnchor !== null) c.thread.style.setProperty('overflow-anchor', c.oldOverflowAnchor);
    controllers.delete(c.inner);
  }
  function refresh() {
    if (!installed) return;
    var inners = Array.prototype.slice.call(document.querySelectorAll('.chat-thread-inner'));
    controllers.forEach(function (c, inner) {
      if (!inner.isConnected || inners.indexOf(inner) < 0 || nativeInner(inner) !== c.native) teardown(c);
    });
    inners.forEach(attach);
  }
  function onWindowResize() { controllers.forEach(resize); }
  function install() {
    if (installed) { refresh(); return; }
    installed = true;
    window.__laolaoPerf = true;
    style = document.createElement('style');
    style.textContent = '.chat-thread-inner:not(.chat-thread-inner--virtual) > .chat-group[' + ATTR + ']{content-visibility:hidden}';
    (document.head || document.documentElement).appendChild(style);
    window.addEventListener('resize', onWindowResize, {passive: true});
    interval = window.setInterval(refresh, 1000);
    refresh();
  }
  function dispose() {
    installed = false;
    window.clearInterval(interval);
    interval = 0;
    window.removeEventListener('resize', onWindowResize);
    controllers.forEach(teardown);
    if (style) style.remove();
    style = null;
    window.__laolaoPerf = false;
  }
  window.__pinkieChatViewport = {install: install, dispose: dispose, follow: follow, capture: capture, restore: restore, preserve: preserve,
    inspect: function () { return Array.from(controllers.values(), function (c) {
      return {native: c.native, observed: c.observed.size,
        mountedRows: c.native ? c.inner.querySelectorAll('.chat-virtual-row').length : groups(c.inner).length};
    }); }};
  install();
})();
