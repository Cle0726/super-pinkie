/* 复用原来的展开/收起按钮和菜单；收起后不保留图标栏。 */
(() => {
  'use strict';
  if (window.__pinkieSidebarAutohide) return;
  window.__pinkieSidebarAutohide = true;
  const root = document.documentElement;
  let auto = null, peek = false, internal = false, keyboard = false, closeTimer = 0;
  // 呼出的卡片滑回去的途中保持卡片样子（cardUntil）；原生侧栏等滑完再收起，免得内容在半路重画
  let cardUntil = 0, cardTimer = 0, collapseTimer = 0;
  let sidebar, edge;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = () => innerWidth > 850 && !!document.querySelector('.shell--chat');
  const collapsed = () => sidebar?.classList.contains('sidebar--collapsed');
  const toggle = () => sidebar?.querySelector('[data-pinkie-sidebar-toggle], button[aria-label="折叠侧边栏"], button[aria-label="展开侧边栏"]');
  const nativeToggle = () => {
    const button = toggle();
    if (!button) return;
    internal = true;
    button.click();
    internal = false;
  };
  const paint = () => {
    const active = desktop() && auto;
    root.toggleAttribute('data-pinkie-sidebar-peek', !!(active && peek));
    if (active && peek) root.setAttribute('data-pinkie-sidebar-peek', '1');
    if (active) root.setAttribute('data-pinkie-sidebar-auto', '1');
    else root.removeAttribute('data-pinkie-sidebar-auto');
    if (active && (peek || performance.now() < cardUntil)) root.setAttribute('data-pinkie-sidebar-card', '1');
    else root.removeAttribute('data-pinkie-sidebar-card');
    if (sidebar) sidebar.inert = !!(active && !peek);
    const button = toggle();
    if (button) {
      button.dataset.pinkieSidebarToggle = '1';
      const label = active && peek ? '固定侧边栏' : collapsed() ? '展开侧边栏' : '折叠侧边栏';
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  };
  const reveal = () => {
    if (!desktop() || !auto || peek) return;
    clearTimeout(closeTimer);
    clearTimeout(collapseTimer);
    peek = true;
    if (sidebar) sidebar.inert = false;
    paint();
    if (collapsed()) nativeToggle();
    requestAnimationFrame(paint);
  };
  const conceal = () => {
    clearTimeout(closeTimer);
    if (!peek) return;
    peek = false;
    cardUntil = performance.now() + 460;
    paint();
    clearTimeout(cardTimer);
    cardTimer = setTimeout(paint, 480);
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      if (!peek && auto && !collapsed()) nativeToggle();
      paint();
    }, 470);
  };
  /* 固定 / 收起侧栏时正文一次排好版，再用位移从原来的位置滑到新位置（只动合成层，不逐帧重新排版）。 */
  // 量的是正文列（.chat-thread-inner）的位置，动的是外面的滚动框（.chat-thread）：滚动框只有一屏大，
  // 直接动正文列会把整段长对话（几万像素高）变成一张合成层，第一次收起要多卡一两百毫秒。
  const SHIFT = [['.shell--chat .chat-thread-inner', '.shell--chat .chat-thread'], ['.shell--chat .agent-chat__composer-shell'], ['.shell--chat .chat-queue']];
  const shiftFrom = () => SHIFT.map(([measure, move = measure]) => {
    const node = document.querySelector(measure);
    return node ? [measure, move, node.getBoundingClientRect().left] : null;
  }).filter(Boolean);
  const shiftTo = (before) => {
    if (reduced() || window.__pinkieSidebarShift === false) return;
    for (const [measure, move, left] of before) {
      const node = document.querySelector(measure), target = document.querySelector(move);
      if (!node || !target) continue;
      const dx = left - node.getBoundingClientRect().left;
      if (Math.abs(dx) < 2) continue;
      target.animate([{transform: `translateX(${dx.toFixed(1)}px)`}, {transform: 'translateX(0)'}], {duration: 360, easing: 'cubic-bezier(.22, 1, .36, 1)'});
    }
  };
  const menuOpen = () => [...document.querySelectorAll('.laolao-mode-menu, .laolao-footer-overflow, .laolao-menu')].some(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[inert]');
  });
  const laterConceal = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (sidebar?.matches(':hover') || (keyboard && sidebar?.contains(document.activeElement)) || menuOpen()) return;
      conceal();
    }, 220);
  };
  const reconcile = () => {
    const current = document.querySelector('.shell--chat .sidebar');
    if (!current) { root.removeAttribute('data-pinkie-sidebar-auto'); return; }
    if (sidebar !== current) {
      sidebar = current;
      sidebar.addEventListener('pointerenter', () => clearTimeout(closeTimer));
      sidebar.addEventListener('pointerleave', laterConceal);
      sidebar.addEventListener('focusout', laterConceal);
    }
    if (auto === null) auto = collapsed();
    if (!edge) {
      edge = document.createElement('button');
      edge.className = 'pinkie-sidebar-edge';
      edge.type = 'button';
      edge.setAttribute('aria-label', '显示侧栏');
      edge.addEventListener('pointerenter', reveal);
      edge.addEventListener('pointerleave', laterConceal);
      edge.addEventListener('click', reveal);
      document.body.append(edge);
    }
    paint();
  };
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-pinkie-sidebar-toggle], .sidebar button[aria-label="折叠侧边栏"], .sidebar button[aria-label="展开侧边栏"]');
    if (!button || internal || !desktop()) return;
    clearTimeout(closeTimer);
    clearTimeout(collapseTimer);
    const before = shiftFrom();
    if (auto && peek) {
      event.preventDefault(); event.stopImmediatePropagation();
      auto = false; peek = false; cardUntil = 0; paint();
      shiftTo(before);
      return;
    }
    if (!auto && !collapsed()) {
      // 固定 → 收起：先带着完整内容滑出去，滑完再让原生侧栏收起（原生一收起就会重画成另一个样子）
      event.preventDefault(); event.stopImmediatePropagation();
      auto = true; peek = false; cardUntil = 0;
      paint();
      shiftTo(before);
      collapseTimer = setTimeout(() => {
        if (auto && !peek && !collapsed()) nativeToggle();
        paint();
      }, 380);
      return;
    }
    auto = !collapsed(); peek = false; cardUntil = 0;
    requestAnimationFrame(() => { paint(); shiftTo(before); });
  }, true);
  document.addEventListener('keydown', event => {
    keyboard = true;
    if (event.key === 'Escape' && peek) { conceal(); edge?.focus({preventScroll: true}); }
  }, true);
  document.addEventListener('pointerdown', event => {
    keyboard = false;
    if (peek && !sidebar?.contains(event.target) && event.target !== edge) conceal();
  }, true);
  window.addEventListener('resize', () => { if (!desktop()) conceal(); paint(); });

  /* 收起时左边缘的把手：鼠标越靠近越长越亮。 */
  let nearFrame = 0, nearX = 999;
  document.addEventListener('pointermove', event => {
    if (!edge || !auto || peek) return;
    nearX = event.clientX;
    if (nearFrame) return;
    nearFrame = requestAnimationFrame(() => {
      nearFrame = 0;
      const near = Math.max(0, Math.min(1, 1 - (nearX - 10) / 110));
      edge.style.setProperty('--edge-near', near.toFixed(3));
    });
  }, {passive: true});

  /* 悬停柔光：一块会滑到鼠标所在那一行的浅色底，代替每行各自闪一下。 */
  const GLIDE_ROWS = '.sidebar-recent-session, .sidebar .nav-item, .sidebar .laolao-classic-more';
  let glide = null, glideRow = null;
  const glideTo = (row) => {
    const shell = sidebar?.querySelector('.sidebar-shell');
    if (!shell) return;
    if (!glide || glide.parentElement !== shell) {
      glide?.remove();
      glide = document.createElement('span');
      glide.className = 'sb-glide';
      shell.prepend(glide);
      root.setAttribute('data-sb-glide', '');
    }
    if (!row) { glide.classList.remove('is-on'); glideRow = null; return; }
    const base = shell.getBoundingClientRect(), rect = row.getBoundingClientRect();
    const jump = !glide.classList.contains('is-on');
    glide.classList.toggle('is-jump', jump);
    glide.style.transform = `translate(${rect.left - base.left}px, ${rect.top - base.top}px)`;
    glide.style.width = `${rect.width}px`;
    glide.style.height = `${rect.height}px`;
    if (jump) { void glide.offsetWidth; glide.classList.remove('is-jump'); }
    glide.classList.add('is-on');
    glideRow = row;
  };
  document.addEventListener('pointerover', event => {
    if (!sidebar?.contains(event.target)) return;
    const row = event.target.closest(GLIDE_ROWS);
    if (row !== glideRow) glideTo(row && !row.classList.contains('sidebar-recent-session--active') ? row : null);
  }, {passive: true});
  document.addEventListener('pointerout', event => {
    if (sidebar?.contains(event.target) && !sidebar.contains(event.relatedTarget)) glideTo(null);
  }, {passive: true});
  document.addEventListener('scroll', event => { if (glideRow && event.target.contains?.(glideRow)) glideTo(null); }, {capture: true, passive: true});
  setInterval(reconcile, 350);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reconcile, {once: true});
  else reconcile();
})();
