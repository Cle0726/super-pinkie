/* Shared, viewport-anchored actions for a chat text selection. */
(() => {
  'use strict';
  if (window.__pinkieSelectionActions) return;
  const actions = new Map();
  let host = null, pending = 0, dragging = false, point = null, last = null, dismissed = false;
  const viewport = () => {
    const view = window.visualViewport;
    return {left: view?.offsetLeft || 0, top: view?.offsetTop || 0,
      width: view?.width || innerWidth, height: view?.height || innerHeight};
  };
  function candidate() {
    const selection = window.getSelection();
    const text = String(selection || '').trim();
    if (!text || text.length > 1_000_000 || !selection.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const element = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const anchor = element(selection.anchorNode), focus = element(selection.focusNode);
    const thread = anchor?.closest('[data-pinkie-reading], .chat-thread');
    if (!thread || focus?.closest('[data-pinkie-reading], .chat-thread') !== thread) return null;
    const reading = thread.hasAttribute('data-pinkie-reading');
    if (!reading && (!anchor.closest('.chat-text') || !focus.closest('.chat-text'))) return null;
    const view = viewport(), bounds = thread.getBoundingClientRect();
    const visible = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0
      && rect.bottom > Math.max(view.top, bounds.top) && rect.top < Math.min(view.top + view.height, bounds.bottom)
      && rect.right > Math.max(view.left, bounds.left)
      && rect.left < Math.min(view.left + view.width, bounds.right));
    if (!visible.length) return null;
    const forward = selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
    const rect = visible[forward ? visible.length - 1 : 0];
    return {text, range: range.cloneRange(), anchor, focus, thread, rect, visible,
      assistant: anchor.closest('.chat-group.assistant'),
      library: reading ? window.__pinkieLibrary?.selectionSource({text, anchor, focus, range}) : null};
  }
  function hide() {
    if (!host || host.hidden) return;
    if (host.hasAttribute('popover') && host.matches(':popover-open')) host.hidePopover();
    host.hidden = true;
  }
  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'pinkie-selection-actions';
    host.setAttribute('role', 'toolbar');
    host.setAttribute('aria-label', '选中文字的操作');
    host.hidden = true;
    if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
    host.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
    document.body.append(host);
  }
  function update() {
    pending = 0;
    const selected = candidate();
    if (!selected || dragging || dismissed) { hide(); return; }
    const available = [...actions.values()].filter(action => action.when(selected)).sort((a, b) => a.order - b.order);
    if (!available.length) { hide(); return; }
    ensureHost();
    const buttons = available.map(action => {
      if (!action.button) {
        action.button = action.create();
        action.button.type = 'button';
        action.button.addEventListener('click', event => {
          event.preventDefault();
          const current = candidate() || last;
          hide(); dismissed = true;
          if (current?.thread.isConnected) action.run(current);
        });
      }
      return action.button;
    });
    for (const child of [...host.children]) if (!buttons.includes(child)) child.remove();
    buttons.forEach((button, index) => { if (host.children[index] !== button) host.insertBefore(button, host.children[index] || null); });
    host.hidden = false;
    if (host.hasAttribute('popover') && !host.matches(':popover-open')) host.showPopover();
    const view = viewport(), gap = 8, size = host.getBoundingClientRect();
    // A multi-line selection's bounding box can span most of the page. Use
    // the focus line, or the right-click point when it is inside the selection.
    const nearPoint = point && point.text === selected.text && selected.visible.some(rect =>
      point.x >= rect.left - 8 && point.x <= rect.right + 8 && point.y >= rect.top - 8 && point.y <= rect.bottom + 8);
    const anchor = nearPoint ? {left: point.x, top: point.y, bottom: point.y}
      : {left: selected.rect.left, top: Math.min(...selected.visible.map(rect => rect.top)),
        bottom: Math.max(...selected.visible.map(rect => rect.bottom))};
    const left = Math.max(view.left + gap, Math.min(view.left + view.width - size.width - gap, anchor.left));
    let top = anchor.top - size.height - gap;
    if (top < view.top + gap) top = anchor.bottom + gap;
    top = Math.max(view.top + gap, Math.min(view.top + view.height - size.height - gap, top));
    const x = `${Math.round(left)}px`, y = `${Math.round(top)}px`;
    if (host.style.left !== x) host.style.left = x;
    if (host.style.top !== y) host.style.top = y;
    last = selected;
  }
  function schedule() {
    if (!pending) pending = requestAnimationFrame(update);
  }
  document.addEventListener('selectionchange', () => {
    const selected = candidate();
    if (dismissed && selected && last && (selected.text !== last.text
      || selected.range.startContainer !== last.range.startContainer || selected.range.startOffset !== last.range.startOffset
      || selected.range.endContainer !== last.range.endContainer || selected.range.endOffset !== last.range.endOffset)) dismissed = false;
    schedule();
  });
  document.addEventListener('pointerdown', event => {
    if (host?.contains(event.target)) return;
    dismissed = false; point = null;
    dragging = event.button === 0;
    hide();
  }, true);
  document.addEventListener('pointerup', event => {
    if (host?.contains(event.target)) return;
    dragging = false;
    const selected = candidate();
    point = selected ? {x: event.clientX, y: event.clientY, text: selected.text} : null;
    schedule();
  }, true);
  document.addEventListener('contextmenu', event => {
    const selected = candidate();
    if (!selected) return;
    point = {x: event.clientX, y: event.clientY, text: selected.text};
    dragging = false; dismissed = false; schedule();
  }, true);
  document.addEventListener('scroll', () => { point = null; schedule(); }, {capture: true, passive: true});
  window.addEventListener('resize', () => { point = null; schedule(); }, {passive: true});
  window.visualViewport?.addEventListener('resize', schedule, {passive: true});
  window.visualViewport?.addEventListener('scroll', schedule, {passive: true});
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hide(); dismissed = true; }
  });
  for (const name of ['pinkie:session-selected', 'laolao:modechange']) window.addEventListener(name, () => {
    last = null; point = null; dragging = false; dismissed = false; hide(); schedule();
  });
  window.__pinkieSelectionActions = {register(id, action) { actions.set(id, action); schedule(); }};
  window.dispatchEvent(new Event('pinkie:selection-ready'));
})();
