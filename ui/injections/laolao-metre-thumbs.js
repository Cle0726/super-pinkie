/* laolao-metre-thumbs —— Metre 输入框图片缩略条点开放大（T3 #12，L26，11-27）。
 * 原生输入框上方的附件条（.chat-attachments-preview > .chat-attachment-thumb > img）只画缩略图，点了没反应；
 * 对话区里的图（.chat-message-image）早由 laolao-image-viewer.js 接住、点开放大。这里只补输入框这一处：
 * 在 Metre 下点缩略图（不点右上角的移除键），用同一个看图器（laolao-image-viewer 交出的 open）打开整张原图。
 * 键盘 / 读屏：焦点进到页面任何地方、按 Tab、指针经过时，把附件条里每张图片的 <img> 补成可 Tab 的按钮
 * （tabindex=0 / role=button / aria-label）。挂在 img 上而不是外层格子：格子里还有原生的移除 <button>，
 * 外层当按钮会把它变成「按钮套按钮」；img 和移除键是兄弟，Tab 顺序是「图片 → 移除」。Enter / 空格打开。
 * 只在 data-laolao-mode="metre" 下生效；离开 Metre 时把补上的属性拿掉，其他模式一个字不动。
 * 不加样式、定时器、观察器和 window.__ 全局名。 */
(() => {
  'use strict';
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const THUMB = '.chat-attachments-preview .chat-attachment-thumb:not(.chat-attachment-thumb--file)';
  const LABEL = '点开放大';
  const MARK = 'pkMetreThumb';
  const ATTRS = ['tabindex', 'role', 'aria-label', 'title'];

  // 事件落在哪张输入框缩略图上；移除键、文件附件、别处一律不算。
  function thumbOf(target) {
    if (!isMetre() || !target?.closest) return null;
    if (target.closest('.chat-attachment-remove')) return null;
    const cell = target.closest(THUMB);
    const img = cell?.querySelector?.('img');
    const source = img && (img.currentSrc || img.src || img.getAttribute?.('src'));
    return source ? {cell, img, source} : null;
  }

  function open(hit) {
    const viewer = window.__laolaoImageViewer;
    if (!viewer || typeof viewer.open !== 'function') return false;
    viewer.open(hit.source, '输入框里的图片');
    return true;
  }

  // 把附件条里所有图片缩略图的 img 补成可 Tab 的按钮（已补过的跳过）。
  function arm() {
    if (!isMetre()) return;
    for (const img of document.querySelectorAll(THUMB + ' img')) {
      if (img.dataset[MARK] === '1') continue;
      img.dataset[MARK] = '1';
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', LABEL);
      img.setAttribute('title', LABEL);
    }
  }
  // 离开 Metre：补上的属性原样拿掉。
  function disarm() {
    for (const img of document.querySelectorAll('img[data-pk-metre-thumb="1"]')) {
      for (const a of ATTRS) img.removeAttribute(a);
      delete img.dataset[MARK];
    }
  }

  // 捕获阶段、挂在 window 上：比原生和 laolao-image-viewer 在 document 上的捕获都早，点了只开看图器。
  window.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const hit = thumbOf(event.target);
    if (!hit || !open(hit)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') { arm(); return; }   // 焦点移动之前补上，刚贴进来的图也赶得上
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target?.closest?.('textarea, input, [contenteditable="true"]')) return;
    const hit = thumbOf(event.target);
    if (!hit || !open(hit)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('focusin', arm, true);
  window.addEventListener('pointerover', (event) => { if (event.target?.closest?.('.chat-attachments-preview')) arm(); }, true);
  window.addEventListener('laolao:modechange', () => { if (isMetre()) arm(); else disarm(); });

  const ns = (window.Pinkie = window.Pinkie || {});
  ns.metreThumbs = Object.freeze({thumbOf, arm, THUMB});
})();
