/* C.le. 侧边栏 · 入口与挂载
   原文件：ui/injections/laolao-sidebar.js
   原实现包住网关 WebSocket、向原生列表里插行。新版只在 .sidebar-brand 之下挂一块自己的区域：
   渲染、分组、菜单、清理与项目绑定在 laolao-session-list.js（须先加载）；这里负责入口、
   原生页面的「更多 ›」清单（读自原生 .sidebar-nav a[href]，节点本身不动）、模式切换后的状态，
   以及「清除侧栏 / 恢复侧栏」的开关。 */
(() => {
  'use strict';
  if (window.__cleSidebar) return;
  const getUI = () => window.__cleSidebarUI;
  const pages = () => getUI()?.nativePages?.() || [];

  // Old modules ask for these handles; keep the names they know.
  window.__cleSidebar = {
    get mode() { return getUI()?.mode; },
    get state() { return getUI()?.state; },
    // 必须走公共桥：window.CLE.host 是 raw host，退役后 sessions 的 getter 会同步 throw。
    // 旧实现在这里直接读 raw host，等于把安全 getter 覆盖掉，断线时就会不断出 uncaught。
    // 桥在离线时返回最后已知的选中会话（只读归属），并且不会碰任何已退役的 host。
    currentSessionKey: () => window.__cleBridge?.currentSessionKey?.()
      ?? window.__laolaoSidebar?.currentSessionKey?.()
      ?? '',
    get pages() { return pages(); },
  };
  window.__laolaoSidebar = Object.assign(window.__laolaoSidebar || {}, window.__cleSidebar);

  // ?cle-sidebar=0 opens the native sidebar for comparison; the 更多 menu toggles the same attribute.
  try {
    if (new URLSearchParams(location.search).get('cle-sidebar') === '0') document.documentElement.setAttribute('data-cle-sidebar-off', '1');
  } catch {}

  const sync = () => {
    const sidebar = document.querySelector('aside.sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('cle-has-sidebar', !!sidebar.querySelector('#cle-sidebar'));
  };  const boot = () => {
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {childList: true, subtree: true});
    const attrObserver = new MutationObserver(() => {
      sync();
      // Native nodes re-render on navigation; nothing to rebuild here — 更多 reads them lazily.
    });
    attrObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-sidebar-off']});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();
