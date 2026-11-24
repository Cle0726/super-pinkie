/* laolao-metre-find —— T3#3 在本会话里查找（11-24 T3 第一批）。只在 Metre 里起作用。
 * 原生 2026.7.1-2 已有会话内查找：Ctrl/⌘+F 切换每个面板的 searchOpen，输入的字会把不含它的消息先藏起来（只过滤，不高亮）。
 * 但原生查找条 .agent-chat__search-bar 没有任何样式：里面的放大镜 svg 没写尺寸，被撑成整张卡片那么宽（1440 宽时 1160×1160），
 * 对话区和输入框被挤出窗口；Esc 关不掉；打开后输入框也不拿焦点。样子在 laolao-metre-find.css 修，这里补行为：
 *   Ctrl/⌘+F：没开就打开（焦点不在对话卡片里时也能开），开着就选中查找框，不再切换关掉；
 *   Esc：关掉（走原生关闭键），焦点回到输入框；Enter / Shift+Enter、↓ / ↑：下一个 / 上一个；
 *   命中处用 CSS 自定义高亮（CSS.highlights，不改动消息的 DOM），旁边「3 / 5」计数；默认停在最新的那一处。
 * 重算时机：查找框输入、点查找条、pinkie:run-view、换会话、换模式。不加循环定时器和观察器。 */
(() => {
  'use strict';
  if (window.PinkieMetreFind) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const canMark = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
  const bar = () => document.querySelector('.chat-main .agent-chat__search-bar') || document.querySelector('.agent-chat__search-bar');
  const composer = () => document.querySelector('.chat-main .agent-chat__composer-combobox textarea') || document.querySelector('.agent-chat__composer-combobox textarea');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ranges = [], cur = -1, lastQ = '', synth = false;

  function collect(q) {
    const out = [];
    if (!q) return out;
    for (const host of document.querySelectorAll('.chat-thread .chat-group .chat-text')) {
      const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const raw = n.nodeValue || '', low = raw.toLowerCase(), same = low.length === raw.length;
        const hay = same ? low : raw, needle = same ? q.toLowerCase() : q;
        for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
          const r = new Range(); r.setStart(n, i); r.setEnd(n, i + needle.length); out.push(r);
          if (out.length >= 500) return out;
        }
      }
    }
    return out;
  }
  function mark() {
    if (!canMark) return;
    if (ranges.length) CSS.highlights.set('pk-find', new Highlight(...ranges)); else CSS.highlights.delete('pk-find');
    if (cur >= 0 && ranges[cur]) CSS.highlights.set('pk-find-cur', new Highlight(ranges[cur])); else CSS.highlights.delete('pk-find-cur');
  }
  function clear() { ranges = []; cur = -1; lastQ = ''; if (canMark) { CSS.highlights.delete('pk-find'); CSS.highlights.delete('pk-find-cur'); } }
  function reveal() {
    const node = ranges[cur]?.startContainer?.parentElement;
    node?.scrollIntoView({block: 'center', behavior: reduced() ? 'auto' : 'smooth'});
  }

  function button(label, act, glyph) {
    const b = el('button', 'pk-find__btn pk-find__btn--' + act, glyph); b.type = 'button'; b.dataset.act = act;
    b.setAttribute('aria-label', label); b.dataset.pinkieTooltip = label; return b;
  }
  function ui(b) {
    let box = b.querySelector(':scope > .pk-find');
    if (!box) {
      box = el('span', 'pk-find');
      const count = el('span', 'pk-find__count'); count.setAttribute('aria-live', 'polite');
      box.append(count, button('上一个（Shift+Enter）', 'prev', '↑'), button('下一个（Enter）', 'next', '↓'));
      const tip = b.querySelector(':scope > openclaw-tooltip'); if (tip) tip.before(box); else b.append(box);
    }
    return box;
  }
  function label(box, q) {
    box.querySelector('.pk-find__count').textContent = !q ? '' : ranges.length ? `${cur + 1} / ${ranges.length}` : '没有找到';
    for (const x of box.querySelectorAll('.pk-find__btn')) x.disabled = ranges.length === 0;
  }
  function refresh(keep = false) {
    const b = bar();
    if (!isMetre() || !b) { clear(); return; }
    b.dataset.metreFind = '1';
    const input = b.querySelector('input');
    if (input && !input.dataset.metreFind) { input.dataset.metreFind = '1'; input.setAttribute('aria-label', '在本会话里查找'); }
    const q = (input?.value || '').trim(), changed = q !== lastQ;
    lastQ = q;
    const box = ui(b);
    ranges = collect(q);
    cur = !ranges.length ? -1 : (keep && !changed && cur >= 0) ? Math.min(cur, ranges.length - 1) : ranges.length - 1;
    mark(); label(box, q);
    if (changed && ranges.length) reveal();
  }
  function go(step) {
    if (!ranges.length) return;
    cur = (cur + step + ranges.length) % ranges.length;
    mark(); reveal();
    const b = bar(); if (b) label(ui(b), lastQ);
  }
  const later = (keep) => { for (const ms of [0, 120]) setTimeout(() => refresh(keep), ms); };
  function focusInput() { const i = bar()?.querySelector('input'); if (i) { i.focus(); i.select(); } return !!i; }
  function close() {
    const b = bar(); if (!b) return;
    b.querySelector(':scope > openclaw-tooltip button, :scope > button')?.click();
    clear();
    requestAnimationFrame(() => composer()?.focus());
    later(false);
  }

  document.addEventListener('keydown', (event) => {
    if (!isMetre() || synth) return;
    const inBar = !!event.target?.closest?.('.agent-chat__search-bar');
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault(); event.stopPropagation();
      if (bar()) { focusInput(); return; }
      const ta = composer(); if (!ta) return;
      // 原生的 Ctrl+F 只挂在对话卡片里：从输入框发一次，焦点在侧栏或别处时也能打开
      synth = true;
      try { ta.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, composed: true, cancelable: true})); } finally { synth = false; }
      for (const ms of [0, 60, 200]) setTimeout(() => { if (focusInput()) refresh(); }, ms);
      return;
    }
    if (!inBar) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); go(event.shiftKey ? -1 : 1); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); go(event.key === 'ArrowDown' ? 1 : -1); }
  }, true);
  document.addEventListener('input', (event) => { if (isMetre() && event.target?.closest?.('.agent-chat__search-bar')) later(false); }, true);
  document.addEventListener('click', (event) => {
    if (!isMetre()) return;
    const b = event.target.closest?.('.pk-find__btn');
    if (b) { event.preventDefault(); event.stopPropagation(); go(b.dataset.act === 'prev' ? -1 : 1); return; }
    if (event.target.closest?.('.agent-chat__search-bar')) later(true);
  }, true);
  window.addEventListener('pinkie:run-view', () => refresh(true));
  window.addEventListener('pinkie:session-selected', () => later(false));
  window.addEventListener('laolao:modechange', () => refresh(false));
  refresh();
  window.PinkieMetreFind = Object.freeze({refresh, go, close});
})();
