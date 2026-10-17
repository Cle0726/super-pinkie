/* laolao-perf:v2
 * 长对话掉帧优化：远离可视区的消息跳过渲染，画面零改动。
 *
 * 为什么不用 content-visibility:auto：它自带 paint containment，会把气泡
 * 的大阴影裁在 .chat-group 边框内；WebKit 也不支持 overflow-clip-margin。
 * 所以只对离视口 1200px 以外的消息开 content-visibility:hidden（那里裁不裁
 * 都看不见），并用实测高度锁住尺寸，滚动条与滚动位置都不会跳。
 * 状态写在 data 属性上，避免被 Lit 的 class 绑定覆盖。
 */
(function () {
  'use strict';
  if (window.__laolaoPerf) return;
  window.__laolaoPerf = true;
  if (!('IntersectionObserver' in window) || !CSS.supports('content-visibility', 'hidden')) return;

  var ATTR = 'data-pinkie-offscreen';
  var MARGIN = '1200px 0px';
  var thread = null, inner = null, io = null, mo = null, pending = false;

  var style = document.createElement('style');
  style.textContent = '.chat-thread-inner > .chat-group[' + ATTR + ']{content-visibility:hidden}';
  (document.head || document.documentElement).appendChild(style);

  function park(el) {
    if (el.hasAttribute(ATTR)) return;
    if (el.querySelector('.streaming, .pinkie-process[data-live="1"]')) return;
    var h = el.getBoundingClientRect().height;
    if (!h) return;
    // contain-intrinsic-block-size replaces the content box, even when the
    // element uses border-box sizing. The measured rectangle includes padding
    // and borders; counting them twice made every parked user turn 26px taller.
    var css = getComputedStyle(el);
    var content = h - (parseFloat(css.paddingTop) || 0) - (parseFloat(css.paddingBottom) || 0)
      - (parseFloat(css.borderTopWidth) || 0) - (parseFloat(css.borderBottomWidth) || 0);
    el.style.setProperty('contain-intrinsic-block-size', Math.max(0, content) + 'px');
    el.setAttribute(ATTR, '');
  }

  function wake(el) {
    if (!el.hasAttribute(ATTR)) return;
    el.removeAttribute(ATTR);
    el.style.removeProperty('contain-intrinsic-block-size');
  }

  function onIntersect(entries) {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.isIntersecting) wake(e.target); else park(e.target);
    }
  }

  function observeChildren() {
    pending = false;
    if (!inner || !io) return;
    var kids = inner.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.__laolaoPerf || !k.classList.contains('chat-group')) continue;
      k.__laolaoPerf = true;
      io.observe(k);
    }
  }

  // IntersectionObserver 在绘制之后才回调；拖滚动条 / 跳到顶部这类大跨度
  // 跳转会先画出一帧空白。scroll 事件在本帧绘制前触发，在这里同步唤醒
  // 落进视口的消息（二分查找，停放的消息高度已锁定，查位置很便宜）。
  var lastTop = 0;
  function onScroll() {
    var top = thread.scrollTop;
    var jump = Math.abs(top - lastTop);
    lastTop = top;
    if (jump < 800 || !inner) return;
    var kids = inner.children, n = kids.length;
    var view = thread.getBoundingClientRect();
    var lo = 0, hi = n;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (kids[mid].getBoundingClientRect().bottom < view.top - 400) lo = mid + 1; else hi = mid;
    }
    for (var i = lo; i < n; i++) {
      var el = kids[i];
      if (el.getBoundingClientRect().top > view.bottom + 400) break;
      wake(el);
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(observeChildren);
  }

  function teardown() {
    if (io) io.disconnect();
    if (mo) mo.disconnect();
    if (thread) thread.removeEventListener('scroll', onScroll);
    if (inner) {
      var parked = inner.querySelectorAll('[' + ATTR + ']');
      for (var i = 0; i < parked.length; i++) wake(parked[i]);
    }
    io = mo = null;
  }

  function attach() {
    var nextInner = document.querySelector('.chat-thread-inner');
    if (nextInner === inner && io) return;
    teardown();
    inner = nextInner;
    thread = inner && inner.closest('.chat-thread');
    if (!inner || !thread) return;
    io = new IntersectionObserver(onIntersect, {root: thread, rootMargin: MARGIN});
    // 只看直接子节点增删，不看 subtree，不碰 characterData。
    mo = new MutationObserver(schedule);
    mo.observe(inner, {childList: true});
    lastTop = thread.scrollTop;
    thread.addEventListener('scroll', onScroll, {passive: true});
    schedule();
  }

  // 宽度变化会让锁定的高度失真：全部唤醒，让观察器按新布局重新判定。
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!inner) return;
      var parked = inner.querySelectorAll('[' + ATTR + ']');
      for (var i = 0; i < parked.length; i++) {
        wake(parked[i]);
        io.unobserve(parked[i]);
        io.observe(parked[i]);
      }
    }, 200);
  });

  // 切换会话 / 模式时 Control UI 会整块替换聊天容器，低频轮询重新挂载。
  setInterval(attach, 1000);
  attach();
})();
