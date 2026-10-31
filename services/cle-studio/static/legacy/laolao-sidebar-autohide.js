/* C.le. 侧边栏 · 收起与呼出 —— 照原版（ui/injections/laolao-sidebar-autohide.js）的手感重做
   - 收起：侧栏带着完整内容整块滑出去，正文铺满，不留图标栏（原生折叠会重画成图标栏，所以不用它）；
   - 左边缘一根把手，鼠标越靠近越长越亮；碰到它，侧栏作为浮起的卡片滑出来，离开 220ms 后滑回去；
     菜单开着、输入框里有焦点时不收；Esc 或点到外面也收；
   - 卡片上那个按钮变成「固定侧边栏」，点它固定回去；
   - 固定 / 收起时正文一次排好版，再用位移从原来的位置滑到新位置（只动合成层，不逐帧重排）；
   - 悬停柔光：一块浅色底滑到鼠标所在的那一行，代替每行各自闪一下。
   收起状态记在本机（cle:sidebar-auto），下次打开还是收起。 */
(() => {
  'use strict';
  if (window.__cleSidebarAutohide) return;
  window.__cleSidebarAutohide = true;
  const root = document.documentElement;
  const KEY = 'cle:sidebar-auto';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const splitPane = () => root.getAttribute('data-laolao-workspace-split') === '1'
    || root.getAttribute('data-laolao-workspace-dock') === '1'
    || root.getAttribute('data-laolao-browser-workspace') === '1';
  // the workbench has its own file tree on the left: the rooms sidebar always rides as a card there
  const workbench = () => root.getAttribute('data-pinkie-wb') === 'on' && !!document.querySelector('.shell--chat');
  const desktop = () => innerWidth > 850 && !splitPane() && !workbench() && !!document.querySelector('.shell--chat');
  const sidebar = () => document.querySelector('.shell--chat .sidebar');
  const COLLAPSE = ['收起侧边栏', '折叠侧边栏', '展开侧边栏', '固定侧边栏', 'Collapse sidebar', 'Expand sidebar'];
  const isToggle = (el) => !!el?.closest?.('.sidebar button') && COLLAPSE.includes(el.closest('button').getAttribute('data-cle-label') || el.closest('button').getAttribute('aria-label') || '');
  const toggleButton = () => {
    const bar = sidebar();
    if (!bar) return null;
    for (const b of bar.querySelectorAll('button[aria-label]')) if (isToggle(b)) return b;
    return null;
  };
  const nativeCollapsed = () => document.querySelector('.shell')?.classList.contains('shell--nav-collapsed')
    || sidebar()?.classList.contains('sidebar--collapsed');

  let auto = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
  let peek = false, keyboard = false, closeTimer = 0, revealTimer = 0, internal = false;
  const save = () => { try { localStorage.setItem(KEY, auto ? '1' : '0'); } catch {} };
  const setAttr = (name, on) => { if (on) { if (!root.hasAttribute(name)) root.setAttribute(name, '1'); } else if (root.hasAttribute(name)) root.removeAttribute(name); };

  /* 正文滑到新位置 */
  const SHIFT = [['.shell--chat .chat-thread-inner', '.shell--chat .chat-thread'], ['.shell--chat .agent-chat__composer-shell'], ['.shell--chat .chat-queue']];
  const measure = () => SHIFT.map(([pick, move = pick]) => {
    const node = document.querySelector(pick);
    return node ? [pick, move, node.getBoundingClientRect().left] : null;
  }).filter(Boolean);
  const shift = (before) => {
    if (reduced()) return;
    for (const [pick, move, left] of before) {
      const node = document.querySelector(pick), target = document.querySelector(move);
      if (!node || !target) continue;
      const dx = left - node.getBoundingClientRect().left;
      if (Math.abs(dx) < 2) continue;
      target.animate([{transform: `translateX(${dx.toFixed(1)}px)`}, {transform: 'translateX(0)'}], {duration: 260, easing: 'cubic-bezier(.22, 1, .36, 1)'});
    }
  };

  let edge = null;
  const paint = () => {
    const active = (desktop() && auto) || workbench();
    setAttr('data-cle-sb-auto', active);
    setAttr('data-cle-sb-peek', active && peek);
    const bar = sidebar();
    if (bar && bar.inert !== !!(active && !peek)) bar.inert = !!(active && !peek);
    const button = toggleButton();
    if (button) {
      const label = active && peek ? '固定侧边栏' : '收起侧边栏';
      if (button.getAttribute('data-cle-label') !== label) { button.setAttribute('data-cle-label', label); button.title = label; }
    }
    if (active && !edge?.isConnected) {
      edge = document.createElement('button');
      edge.className = 'cle-sidebar-edge';
      edge.type = 'button';
      edge.setAttribute('aria-label', '显示侧栏');
      edge.addEventListener('pointerenter', () => { clearTimeout(revealTimer); revealTimer = setTimeout(reveal, 60); });
      edge.addEventListener('pointerleave', () => { clearTimeout(revealTimer); laterConceal(); });
      edge.addEventListener('click', reveal);
      document.body.append(edge);
    }
    if (!active && edge) { edge.remove(); edge = null; }
  };
  const reveal = () => {
    if (!((desktop() && auto) || workbench()) || peek) return;
    clearTimeout(closeTimer);
    peek = true;
    paint();
  };
  const conceal = () => {
    clearTimeout(closeTimer);
    if (!peek) return;
    peek = false;
    paint();
  };
  const floatingMenus = '.cle-room-menu:not([hidden]), .cle-utilities-layer:not([hidden]), [role="menu"], .laolao-menu';
  const menuOpen = () => [...document.querySelectorAll(floatingMenus)].some((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const laterConceal = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      const bar = sidebar(), focused = document.activeElement;
      if (bar?.matches(':hover') || edge?.matches(':hover')) return;
      if (bar?.contains(focused) && (keyboard || focused.matches('input,textarea,[contenteditable="true"]'))) return;
      if (menuOpen()) { closeTimer = setTimeout(laterConceal, 180); return; }
      conceal();
    }, 220);
  };
  const pin = (on) => {
    const before = measure();
    auto = !on; peek = false; save();
    paint();
    requestAnimationFrame(() => shift(before));
  };

  /* 原生按钮：固定时 = 收起，呼出时 = 固定 */
  document.addEventListener('click', (event) => {
    if (internal || !isToggle(event.target)) return;
    if (workbench()) { event.preventDefault(); event.stopImmediatePropagation(); if (peek) conceal(); return; }
    if (!desktop()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (auto) pin(true); else pin(false);
  }, true);
  document.addEventListener('keydown', (event) => {
    keyboard = true;
    if (event.key === 'Escape' && peek && !menuOpen()) { conceal(); edge?.focus({preventScroll: true}); }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    keyboard = false;
    if (peek && !sidebar()?.contains(event.target) && event.target !== edge && !event.target.closest?.(floatingMenus)) conceal();
  }, true);

  /* 把手：鼠标越靠近越长越亮 */
  let nearFrame = 0, nearX = 999;
  document.addEventListener('pointermove', (event) => {
    if (!edge || peek) return;
    nearX = event.clientX;
    if (nearFrame) return;
    nearFrame = requestAnimationFrame(() => {
      nearFrame = 0;
      edge?.style.setProperty('--edge-near', Math.max(0, Math.min(1, 1 - (nearX - 10) / 110)).toFixed(3));
    });
  }, {passive: true});

  /* 悬停柔光 */
  const ROWS = '.cle-sb-row, .cle-sb-nav__item, .sidebar .nav-item, .sidebar-recent-session';
  let glide = null;
  const glideTo = (row) => {
    const bar = sidebar();
    if (!bar || reduced()) return;
    if (!glide || glide.parentElement !== bar) {
      glide?.remove();
      glide = document.createElement('span');
      glide.className = 'cle-sb-glide';
      glide.setAttribute('aria-hidden', 'true');
      bar.prepend(glide);
    }
    const a = row.getBoundingClientRect(), b = bar.getBoundingClientRect();
    glide.style.transform = `translate(${(a.left - b.left).toFixed(1)}px, ${(a.top - b.top + bar.scrollTop).toFixed(1)}px)`;
    glide.style.width = `${a.width.toFixed(1)}px`;
    glide.style.height = `${a.height.toFixed(1)}px`;
    glide.classList.add('is-on');
  };
  document.addEventListener('pointerover', (event) => {
    const row = event.target.closest?.(ROWS);
    if (row && sidebar()?.contains(row)) glideTo(row);
  }, {passive: true});
  document.addEventListener('pointerout', (event) => {
    if (glide && !event.relatedTarget?.closest?.(ROWS)) glide.classList.remove('is-on');
  }, {passive: true});

  const reconcile = () => {
    const bar = sidebar();
    if (!bar) { setAttr('data-cle-sb-auto', false); setAttr('data-cle-sb-peek', false); return; }
    if (!bar.__cleWatched) {
      bar.__cleWatched = true;
      bar.addEventListener('pointerenter', () => clearTimeout(closeTimer));
      bar.addEventListener('pointerleave', laterConceal);
      bar.addEventListener('focusout', laterConceal);
    }
    // the native icon rail is never used: if the app restored itself collapsed, open it and hide it our way
    if (nativeCollapsed()) {
      const b = toggleButton();
      if (b) { auto = true; save(); internal = true; b.click(); internal = false; }
    }
    paint();
  };
  setInterval(reconcile, 500);
  window.addEventListener('resize', () => { if (!desktop()) conceal(); reconcile(); }, {passive: true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reconcile, {once: true});
  else reconcile();
})();
