/* laolao-metre-thumbs —— Metre 输入框图片缩略条点开放大（T3 #12，L26，11-27）。
 * 原生输入框上方的附件条（.chat-attachments-preview > .chat-attachment-thumb > img）只画缩略图，点了没反应；
 * 对话区里的图（.chat-message-image）早由 laolao-image-viewer.js 接住、点开放大。这里只补输入框这一处：
 * 在 Metre 下点缩略图（不点右上角的移除键），用同一个看图器（laolao-image-viewer 交出的 open）打开整张原图。
 * 键盘：指针或焦点第一次经过时给缩略图补 tabindex / role=button，之后按 Enter / 空格同样打开；不挂观察器。
 * 只在 data-laolao-mode="metre" 下生效，其他模式一个字不动；不加样式、定时器、观察器和 window.__ 全局名。 */
(() => {
  'use strict';
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const THUMB = '.chat-attachments-preview .chat-attachment-thumb:not(.chat-attachment-thumb--file)';
  const LABEL = '点开放大';

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

  // 让缩略图能被 Tab 到、读屏念得出来（只在 Metre、每格只补一次）。
  function arm(target) {
    const hit = thumbOf(target);
    if (!hit || hit.cell.dataset.pkMetreThumb === '1') return;
    hit.cell.dataset.pkMetreThumb = '1';
    hit.cell.setAttribute('tabindex', '0');
    hit.cell.setAttribute('role', 'button');
    hit.cell.setAttribute('aria-label', LABEL);
    hit.cell.setAttribute('title', LABEL);
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
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target?.closest?.('textarea, input, [contenteditable="true"]')) return;
    const hit = thumbOf(event.target);
    if (!hit || !open(hit)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointerover', (event) => arm(event.target), true);
  window.addEventListener('focusin', (event) => arm(event.target), true);

  const ns = (window.Pinkie = window.Pinkie || {});
  ns.metreThumbs = Object.freeze({thumbOf, THUMB});
})();
