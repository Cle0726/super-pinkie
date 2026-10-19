/* C.le. 侧边栏 · 自动收起
   原文件：ui/injections/laolao-sidebar-autohide.js
   原实现的感应区、悬停柔光与卡片都为了覆盖原生菜单；新版原生侧栏已经有折叠按钮和
   .sidebar--collapsed 状态，所以这里只保留两件事：
   - 左侧边缘的细把手（HTML[data-cle-sidebar] 时出现），点击或悬停展开原生侧栏；
   - 收起时用位移把正文滑到新位置（只动合成层，不逐帧重排）。 */
(() => {
  'use strict';
  if (window.__cleSidebarAutohide) return;
  window.__cleSidebarAutohide = true;
  const root = document.documentElement;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const splitPane = () => root.getAttribute('data-laolao-workspace-split') === '1'
    || root.getAttribute('data-laolao-workspace-dock') === '1'
    || root.getAttribute('data-laolao-browser-workspace') === '1';
  const desktop = () => innerWidth > 850 && !splitPane() && !!document.querySelector('.shell--chat');
  const sidebar = () => document.querySelector('.shell--chat .sidebar');
  const collapsed = () => document.querySelector('.shell')?.classList.contains('shell--nav-collapsed')
    || sidebar()?.classList.contains('sidebar--collapsed');
    // The native collapse button is labelled (aria-label and title) in the current locale.
  const COLLAPSE = ['折叠侧边栏', '收起侧边栏', '展开侧边栏', 'Collapse sidebar', 'Expand sidebar'];
  const toggle = () => {
    const bar = sidebar();
    if (!bar) return null;
    for (const label of COLLAPSE) {
      const found = bar.querySelector(`button[aria-label="${label}"]`);
      if (found) return found;
    }
    return bar.querySelector('[data-pinkie-sidebar-toggle], .sidebar-brand__collapse');
  };
  const toggleSidebar = () => { const button = toggle(); if (!button) return false; button.click(); return true; };

  const SHIFT = [['.shell--chat .chat-thread-inner', '.shell--chat .chat-thread'], ['.shell--chat .agent-chat__composer-shell'], ['.shell--chat .chat-queue']];
  const measure = () => SHIFT.map(([pick, move = pick]) => {
    const node = document.querySelector(pick);
    return node ? [pick, move, node.getBoundingClientRect().left] : null;
  }).filter(Boolean);
  const shift = (before) => {
    if (reduced() || window.__pinkieSidebarShift === false) return;
    for (const [pick, move, left] of before) {
      const node = document.querySelector(pick), target = document.querySelector(move);
      if (!node || !target) continue;
      const dx = left - node.getBoundingClientRect().left;
      if (Math.abs(dx) < 2) continue;
      target.animate([{transform: `translateX(${dx.toFixed(1)}px)`}, {transform: 'translateX(0)'}], {duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)'});
    }
  };

  let edge = null;
  const paint = () => {
    const active = desktop() && root.hasAttribute('data-cle-sidebar') && !root.hasAttribute('data-cle-sidebar-off');
    root.toggleAttribute('data-cle-sidebar-autohide', active);
    if (!active) { edge?.remove(); edge = null; return; }
    edge = edge?.isConnected ? edge : null;
    if (!edge) {
      edge = document.createElement('button');
      edge.className = 'cle-sidebar-edge';
      edge.type = 'button';
      edge.setAttribute('aria-label', '显示侧栏');
      edge.title = '显示侧栏';
      edge.addEventListener('click', () => { if (collapsed()) { const before = measure(); toggleSidebar(); requestAnimationFrame(() => shift(before)); } });
      edge.addEventListener('pointerenter', () => { if (collapsed()) { const before = measure(); toggleSidebar(); requestAnimationFrame(() => shift(before)); } });
      document.body.append(edge);
    }
    // The handle only exists while the native rail is collapsed.
    edge.style.display = collapsed() ? 'block' : 'none';
  };

  // Keep the content glide for the native toggle in the same behaviour as before.
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.sidebar .sidebar-brand__collapse, .sidebar [data-pinkie-sidebar-toggle]');
    if (!button) return;
    const before = measure();
    requestAnimationFrame(() => requestAnimationFrame(() => shift(before)));
  }, true);

  const reconcile = () => paint();
  setInterval(reconcile, 500);
  window.addEventListener('resize', reconcile, {passive: true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reconcile, {once: true});
  else reconcile();
})();
