/* laolao-metre-queue —— Metre 的「待发送」排队（11-24 第 5 轮追加 A，用户：「这个排队框也太大了」）。
 * 原生面板的 .chat-queue 留在原位（对话区和输入框之间，对话区底部的留白跟着它让出来），它自己的标题和大卡片列表在 Metre 里藏掉
 * （laolao-metre-skin.css「第 5 轮追加 A」），换成这里画的一条，宽度和输入框一样、贴着输入框上沿：
 *   收起（默认）：一行 30px：「待发送 2 · 第一条的前 30 个字…」＋「展开」「全部清掉」。
 *   展开：每条一行 28px，文字和输入框里的字左对齐；每条有 上移 / 下移、编辑（放回输入框、从队列里拿掉）、
 *     「现在插话」（走已有的插话：laolao-queue-steer.js 的 steerQueued）、删除。最多露 4 条，多了在框里滚。
 * 数据只读 pane.state.chatQueue；换顺序直接改这个数组（laolao-queue-steer.js 也是这样改），删除走原生的 removeQueuedMessage，
 * 编辑走原生的 handleChatDraftChange。重画时机：pinkie:run-view（原生面板每次更新都发，后台带也靠它）、自己的按键、换会话、换模式、
 * 窗口尺寸变了、忙的时候按回车或点发送之后（补画一次）。不加循环定时器和观察器。只在 Metre 里起作用。 */
(() => {
  'use strict';
  if (window.PinkieMetreQueue) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const pane = () => document.querySelector('openclaw-chat-pane');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const LABEL = {steered: '确认追加中', unconfirmed: '送达待确认', failed: '发送失败'};
  let open = false, sig = '';

  const items = (p) => (Array.isArray(p?.state?.chatQueue) ? p.state.chatQueue : [])
    .filter((q) => q && (!q.sessionKey || !p.state.sessionKey || q.sessionKey === p.state.sessionKey));
  const textOf = (q) => String(q.text ?? q.message ?? '').replace(/\s+/g, ' ').trim() || (q.attachments?.length ? '（附件）' : '（空）');
  const clip = (s, n) => ([...s].length > n ? [...s].slice(0, n).join('') + '…' : s);
  const tagOf = (q) => LABEL[q.kind === 'steered' ? 'steered' : q.sendState] || '';
  const method = (p, name) => { for (const o of [p?.state, p, p?.controller]) if (typeof o?.[name] === 'function') return o[name].bind(o); return null; };
  const repaint = (p) => { p?.state?.requestUpdate?.(); p?.requestUpdate?.(); };

  function remove(p, id) {
    const native = method(p, 'removeQueuedMessage');
    if (native) { native(id); return; }
    p.querySelector(`.chat-queue__item[data-pinkie-queue-id="${CSS.escape(id)}"] .chat-queue__remove`)?.click();
  }
  function act(kind, id) {
    const p = pane(); if (!p?.state) return;
    const list = items(p), i = list.findIndex((q) => q.id === id);
    if (kind === 'toggle') open = !open;
    else if (kind === 'clear') for (const q of list) remove(p, q.id);
    else if (i < 0) return;
    else if (kind === 'up' || kind === 'down') {
      const j = kind === 'up' ? i - 1 : i + 1; if (j < 0 || j >= list.length) return;
      const all = [...p.state.chatQueue], a = all.indexOf(list[i]), b = all.indexOf(list[j]);
      [all[a], all[b]] = [all[b], all[a]]; p.state.chatQueue = all;
    } else if (kind === 'edit') {
      const text = String(list[i].text ?? list[i].message ?? ''); remove(p, id);
      const set = method(p, 'handleChatDraftChange'); if (set) set(text); else p.state.chatMessage = text;
      requestAnimationFrame(() => p.querySelector('.agent-chat__composer-combobox textarea')?.focus());
    } else if (kind === 'steer') void window.__laolaoQueueSteer?.steerQueued?.(p, id, {automatic: false});
    else if (kind === 'remove') remove(p, id);
    repaint(p); sig = ''; render();
  }

  function button(label, kind, id = '', glyph = label, disabled = false) {
    const b = el('button', 'pk-mq__btn pk-mq__btn--' + kind, glyph); b.type = 'button'; b.dataset.act = kind; b.dataset.id = id;
    b.setAttribute('aria-label', label); b.dataset.pinkieTooltip = label; b.disabled = disabled; return b;
  }
  // 宽度和输入框一样；文字的起点和输入框里的字对齐；下沿贴着输入框上沿（量一次，算出要补的下边距）
  function place(host, p) {
    const comp = p.querySelector('.agent-chat__composer-combobox'), ta = comp?.querySelector('textarea');
    if (!comp || !ta) return;
    const c = comp.getBoundingClientRect(), t = ta.getBoundingClientRect();
    host.style.setProperty('--pk-mq-w', Math.round(c.width) + 'px');
    host.style.setProperty('--pk-mq-pad', Math.max(8, Math.round(t.left - c.left) - 1) + 'px');   // 减去这一条自己 1px 的边
    const gap = Math.round(c.top - host.getBoundingClientRect().bottom), mb = parseFloat(host.style.getPropertyValue('--pk-mq-mb')) || 0;
    if (gap !== 0 && Math.abs(gap) < 80) host.style.setProperty('--pk-mq-mb', (mb - gap) + 'px');
    root.style.setProperty('--pk-mq-h', Math.round(host.getBoundingClientRect().height) + 'px');   // 输入框上的小猫跟着往上挪，蹲在这一条上沿（laolao-metre-skin.css）
  }

  function render(force = false) {
    const p = pane(), host = p?.querySelector('.chat-queue');
    if (!isMetre() || !host) return;
    const list = items(p);
    let box = host.querySelector(':scope > .pk-mq');
    if (!list.length) { box?.remove(); sig = ''; return; }   // 队列空了：原生的那一块也会收掉，这一条一起拿掉
    const key = JSON.stringify([open, list.map((q) => [q.id, textOf(q), tagOf(q)])]);
    if (box && key === sig && !force) return;
    sig = key;
    if (!box) { box = el('div', 'pk-mq'); box.setAttribute('role', 'region'); box.setAttribute('aria-label', '待发送'); host.prepend(box); }
    const expanded = open && list.length > 0;
    box.dataset.open = String(expanded);
    const bar = el('div', 'pk-mq__bar');
    bar.append(el('span', 'pk-mq__count', '待发送 ' + list.length));
    if (!expanded && list[0]) bar.append(el('span', 'pk-mq__sep', '·'), el('span', 'pk-mq__peek', clip(textOf(list[0]), 30)));
    else bar.append(el('span', 'pk-mq__peek'));
    const toggle = button(expanded ? '收起' : '展开', 'toggle'); toggle.setAttribute('aria-expanded', String(expanded));
    bar.append(toggle, button('全部清掉', 'clear'));
    const parts = [bar];
    if (expanded) {
      const ol = el('ol', 'pk-mq__list');
      list.forEach((q, i) => {
        const li = el('li', 'pk-mq__row'); li.dataset.id = q.id; if (q.sendState) li.dataset.state = q.sendState;
        li.append(el('span', 'pk-mq__text', textOf(q)));
        if (tagOf(q)) li.append(el('span', 'pk-mq__tag', tagOf(q)));
        const acts = el('span', 'pk-mq__acts');
        acts.append(button('上移', 'up', q.id, '↑', i === 0), button('下移', 'down', q.id, '↓', i === list.length - 1),
          button('编辑（放回输入框）', 'edit', q.id, '编辑'), button('现在插话发出去', 'steer', q.id, '插话', q.kind === 'steered'), button('删除', 'remove', q.id, '×'));
        li.append(acts); ol.append(li);
      });
      parts.push(ol);
    }
    box.replaceChildren(...parts);
    place(host, p);
  }

  document.addEventListener('click', (event) => {
    const b = event.target.closest?.('.pk-mq__btn'); if (!b || b.disabled) return;
    event.preventDefault(); event.stopPropagation(); act(b.dataset.act, b.dataset.id);
  }, true);
  window.addEventListener('pinkie:run-view', () => render());
  // 忙的时候按回车 / 点发送，原生面板把这句排进队列：跟着补画一次（原生面板自己没有对外的「队列变了」事件）
  const soon = () => { for (const ms of [60, 300]) setTimeout(() => render(), ms); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && isMetre()) soon(); }, true);
  document.addEventListener('click', (e) => { if (isMetre() && e.composedPath?.().some((n) => n?.classList?.contains?.('chat-send-btn'))) soon(); }, true);
  window.addEventListener('pinkie:session-selected', () => { open = false; sig = ''; render(); });
  window.addEventListener('laolao:modechange', () => { sig = ''; render(); });
  window.addEventListener('resize', () => render(true));
  window.PinkieMetreQueue = Object.freeze({render, act});
})();
