/* laolao-metre-peek —— L28（T3 #16）：Metre 侧栏会话行的悬停预览卡（11-27，只在 Metre）。
 * 指针在会话行上停 DELAY 毫秒弹出一张小卡：会话名、最近一条消息摘要、模型 · 时间（在跑 / 等你 / 出错时前面加状态）。
 * 数据只用侧栏已经拿到的会话行：laolao-session-list.js 的 sessions.list 本来就带 includeLastMessage，
 * 行里有 lastMessagePreview / model / updatedAt；laolao-metre-list.js 的 decorate 每次画完列表叫 mark(groups, byKey) 交过来。
 * 本文件不发请求、不加观察器、不加循环定时器（只有一次性的弹出延时）。
 * 收起：指针离开这一行、按下、滚动、窗口改大小 / 失焦、Esc、切出 Metre；列表重画时卡片跟到同一会话的新行上（指针或焦点不在了就收起）。
 * 键盘：Tab 到会话链接（:focus-visible）同样弹出，链接挂 aria-describedby 指向卡片，读屏能读到摘要；焦点离开就收起。
 * Esc：只有焦点就在这一行时才吃掉这次按键（先收卡片，不连带收起抽屉）；指针悬停时 Esc 照常往下传（不挡「Esc 停止」）。
 * 不挡点击：卡片 pointer-events: none，放在侧栏右边（见 .css）。其他模式：每个入口先看 data-laolao-mode，一个节点都不加。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metrePeek) return;
  const DELAY = 450, MAX = 160, GAP = 8;
  const ROW = 'aside.sidebar .session-row-host[data-session-key]';
  const LINK = '.sidebar-recent-session__link';
  const STATE = {running: '在跑', waiting: '等你', error: '出错'};
  const isMetre = () => document.documentElement.getAttribute('data-laolao-mode') === 'metre';
  let rows = new Map(), card = null, anchor = null, pending = null, timer = 0;

  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const clip = (value) => { const t = String(value ?? '').replace(/\s+/g, ' ').trim(); return t.length > MAX ? t.slice(0, MAX - 1) + '…' : t; };
  const stamp = (value) => (typeof value === 'number' ? value : new Date(value).getTime()) || 0;
  const rowOf = (target) => (target && typeof target.closest === 'function' ? target.closest(ROW) : null);
  const linkOf = (row) => row?.querySelector(':scope > ' + LINK) || null;
  // 模型名去掉「厂商/」前缀，卡片里一行放得下
  const modelName = (s) => { const m = String(s?.model || '').trim(); return m.includes('/') ? m.slice(m.lastIndexOf('/') + 1) : m; };

  function info(row) {
    const s = rows.get(row.dataset.sessionKey);
    if (!s) return null;
    const name = String(row.querySelector('.sidebar-recent-session__name')?.textContent || '').trim() || s.label || s.displayName || '新会话';
    const at = stamp(s.updatedAt);
    return {
      name, at,
      preview: clip(typeof s.lastMessagePreview === 'string' ? s.lastMessagePreview : ''),
      model: modelName(s),
      when: at ? window.PinkieMetreList?.relTime?.(at) || '' : '',
      state: STATE[window.PinkieSessionList?.sessionStatus?.(s) || ''] || '',
    };
  }

  function build(data) {
    const box = el('div', 'pk-mpeek');
    box.id = 'pk-mpeek';
    // 不设 role="tooltip"（同 laolao-metre-cite.js）：Metre 皮肤给所有 [role="tooltip"] 强制铺反色，摘要字和底同色消失
    // （pr-shots run 46034579951：摘要对比度 1）。链接的 aria-describedby 照样指到这里，读屏照读。
    box.append(el('div', 'pk-mpeek__title', data.name));
    box.append(el('div', 'pk-mpeek__text' + (data.preview ? '' : ' is-empty'), data.preview || '还没有消息'));
    const meta = el('div', 'pk-mpeek__meta');
    if (data.state) meta.append(el('span', 'pk-mpeek__state', data.state));
    if (data.model) meta.append(el('span', 'pk-mpeek__model', data.model));
    if (data.when) { const t = el('time', 'pk-mpeek__time', data.when); t.dateTime = new Date(data.at).toISOString(); meta.append(t); }
    if (meta.children.length) box.append(meta);
    return box;
  }

  // 放在侧栏右边、和这一行顶对齐；右边放不下就贴窗口右边，上下都夹在窗口里。
  function place(box, row, r) {
    const side = row.closest('aside.sidebar')?.getBoundingClientRect() || r;
    const w = box.offsetWidth, h = box.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = side.right + GAP;
    if (left + w > vw - GAP) left = Math.max(GAP, vw - w - GAP);
    const top = Math.max(GAP, Math.min(r.top, vh - h - GAP));
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
  }

  function hide() {
    clearTimeout(timer); timer = 0; pending = null;
    linkOf(anchor)?.removeAttribute('aria-describedby');
    card?.remove(); card = null; anchor = null;
  }
  function show(row) {
    hide();
    if (!isMetre() || !row.isConnected) return;
    const r = row.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;   // 侧栏收起 / 抽屉没拉出来时行看不见，不弹
    const data = info(row);
    if (!data) return;
    const box = build(data);
    document.body.append(box);
    place(box, row, r);
    card = box; anchor = row;
    // 侧栏自己的提示（laolao-sidebar.js）这时若正显示这一行的会话名：卡片第一行就是它，收掉免得两份。按钮的提示（置顶 / 归档…）不动。
    const tip = document.querySelector('.pinkie-sidebar-tooltip');
    if (tip && data.name && String(tip.textContent || '').startsWith(data.name)) tip.remove();
    linkOf(row)?.setAttribute('aria-describedby', box.id);
  }
  function arm(row) {
    if (row === anchor || row === pending) return;
    hide();
    pending = row;
    timer = setTimeout(() => { timer = 0; if (pending === row) show(row); }, DELAY);
  }

  // 列表重画会把整组行换成新节点（decorate 之后紧接着 replaceWith）：等换完，找同一会话的新行。
  const live = (row) => row.matches(':hover') || row.contains(document.activeElement);
  function relocate(row) {
    const next = document.querySelector(`${ROW}[data-session-key="${CSS.escape(row.dataset.sessionKey)}"]`);
    return next && live(next) ? next : null;
  }
  function follow() {
    if (anchor && !anchor.isConnected) { const next = relocate(anchor); hide(); if (next) show(next); }
    if (pending && !pending.isConnected) { const next = relocate(pending); hide(); if (next) arm(next); }
  }
  function mark(groups, byKey) {
    if (!isMetre()) return;
    if (byKey instanceof Map) rows = byKey;
    if (anchor || pending) queueMicrotask(follow);
  }

  const close = () => { if (card || pending) hide(); };
  document.addEventListener('pointerover', (event) => {
    if (!isMetre() || event.pointerType === 'touch') return;
    const row = rowOf(event.target);
    if (row) arm(row);
  });
  document.addEventListener('pointerout', (event) => {
    const row = anchor || pending;
    if (!row || row.contains(event.relatedTarget) || rowOf(event.target) !== row) return;
    if (!row.contains(document.activeElement)) hide();   // 键盘焦点还在这一行就留着
  });
  document.addEventListener('focusin', (event) => {
    if (!isMetre()) return;
    const target = event.target, row = rowOf(target);
    if (row && target.matches?.(LINK) && target.matches(':focus-visible')) arm(row);
  });
  document.addEventListener('focusout', (event) => {
    const row = anchor || pending;
    if (row && row.contains(event.target) && !row.contains(event.relatedTarget) && !row.matches(':hover')) hide();
  });
  document.addEventListener('pointerdown', close, true);
  document.addEventListener('scroll', close, true);
  window.addEventListener('resize', close, {passive: true});
  window.addEventListener('blur', close);
  window.addEventListener('laolao:modechange', close);
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing || !(card || pending)) return;
    const own = Boolean(card) && anchor.contains(document.activeElement);
    hide();
    if (own) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  ns.metrePeek = Object.freeze({mark, hide, info, DELAY, get open() { return Boolean(card); }});
})();
