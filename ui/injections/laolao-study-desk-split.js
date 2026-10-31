/* 学习台独立对话是桌上的一张聊天卡片（和别的页一样能拖、能改大小）；⌘J 和左栏的按钮开合它。 */
(() => {
  'use strict';
  if (window.__pinkieDeskSplit) return;
  const desk = () => window.__pinkieStudyDesk;
  const root = () => document.getElementById('pinkie-study-desk');
  const isOpen = () => Boolean(desk()?.hasChat?.());
  function apply() {
    const b = root()?.querySelector('[data-desk-split]'), on = isOpen();
    if (b) { b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); }
  }
  function toggle(force) {
    if (!root()) return;
    desk()?.toggleChat?.(typeof force === 'boolean' ? force : !isOpen());
    apply();
    if (isOpen()) focusChat();
  }
  function focusChat() { document.querySelector('#pinkie-desk-chat textarea')?.focus(); }
  function addButton() {
    const foot = root()?.querySelector('.rail-foot');
    if (!foot || foot.querySelector('[data-desk-split]')) return;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.deskSplit = '';
    b.setAttribute('aria-label', '开合聊天卡片（⌘J）');
    const icon = desk()?.icon?.('message-square', {size: 'md'}); if (icon) b.append(icon);
    const tip = document.createElement('span'); tip.className = 'nav-tip'; tip.textContent = '聊天卡片 ⌘J'; b.append(tip);
    b.addEventListener('click', () => toggle());
    foot.prepend(b); apply();
  }
  window.addEventListener('pinkie:study-desk-mounted', addButton);
  for (const name of ['pinkie:study-desk-view', 'pinkie:desk-split-changed']) window.addEventListener(name, () => { addButton(); apply(); });
  document.addEventListener('keydown', event => {
    if (!root() || !event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || event.code !== 'KeyJ' || event.repeat) return;
    event.preventDefault(); event.stopPropagation(); toggle();
  }, {capture: true});
  window.__pinkieDeskSplit = {isOpen, toggle, open: () => toggle(true), close: () => toggle(false), focusChat};
  if (root()) addButton();
})();
