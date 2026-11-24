/* laolao-metre-thumbs —— T3#12：输入框里的图片缩略图点开放大（11-24 T3 第一批）。
 * 原生 2026.7.1-2 已有缩略条 .chat-attachments-preview > .chat-attachment-thumb（60×60，带「Remove attachment」移除键），
 * 但点缩略图什么都不发生。这里只在 Metre 下：点缩略图 → 用碧琪现成的看图器（laolao-image-viewer.js 的 window.__laolaoImageViewer.open）
 * 打开原图；点移除键照旧。缩略图补 tabindex / role=button / 中文标签，键盘回车或空格也能打开。
 * 补标签的时机：粘贴、拖入、选文件之后，换会话、换模式时，以及 pinkie:run-view（原生面板每次更新都发）。不加循环定时器和观察器。 */
(() => {
  'use strict';
  if (window.PinkieMetreThumbs) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const THUMB = '.chat-attachments-preview .chat-attachment-thumb';
  const imgOf = (thumb) => thumb?.querySelector('img');

  function open(thumb) {
    const img = imgOf(thumb), src = img && (img.currentSrc || img.src);
    if (!src || typeof window.__laolaoImageViewer?.open !== 'function') return false;
    window.__laolaoImageViewer.open(src, img.alt || '要发送的图片');
    return true;
  }

  function decorate() {
    const on = isMetre();
    for (const thumb of document.querySelectorAll(THUMB)) {
      if (on && imgOf(thumb)) {
        if (thumb.dataset.metreZoom === '1') continue;
        thumb.dataset.metreZoom = '1';
        thumb.tabIndex = 0;
        thumb.setAttribute('role', 'button');
        thumb.setAttribute('aria-label', '放大查看这张图');
      } else if (thumb.dataset.metreZoom === '1') {
        delete thumb.dataset.metreZoom;
        thumb.removeAttribute('tabindex');
        thumb.removeAttribute('role');
        thumb.removeAttribute('aria-label');
      }
    }
  }

  document.addEventListener('click', (event) => {
    if (!isMetre() || event.button !== 0 || event.target.closest?.('button')) return;
    const thumb = event.target.closest?.(THUMB);
    if (thumb && imgOf(thumb) && open(thumb)) event.preventDefault();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!isMetre() || (event.key !== 'Enter' && event.key !== ' ')) return;
    const thumb = event.target?.matches?.(THUMB) ? event.target : null;
    if (thumb && open(thumb)) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  // 缩略图是原生面板读完文件后才画出来的：事件之后补几次（原生面板没有对外的「附件变了」事件）
  const soon = () => { for (const ms of [0, 200, 600]) setTimeout(decorate, ms); };
  for (const type of ['paste', 'drop', 'change']) document.addEventListener(type, () => { if (isMetre()) soon(); }, true);
  window.addEventListener('pinkie:run-view', () => decorate());
  window.addEventListener('pinkie:session-selected', soon);
  window.addEventListener('laolao:modechange', () => decorate());
  decorate();
  window.PinkieMetreThumbs = Object.freeze({decorate, open});
})();
