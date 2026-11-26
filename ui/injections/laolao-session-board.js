/* laolao-session-board —— S6 多会话并行看板的两种皮（briefs/program-1120/设计-S6.md 第二、三、五节；第 2、3 步，engines）
 *
 * 只画界面。数据全部来自 window.Pinkie.sessionBoard（linux2 的 laolao-session-board-data.js，第 1 步）：
 * 这里不发请求、不听网关事件、不开定时器、不新增观察器（侧栏重画用 window.Pinkie.domWatch.watch）。
 * 数据层没加载时什么都不出现（胶囊不画，总控台「全部会话」一栏留着示例）。
 *
 * 用到的数据层接口（和 linux2 对齐，写在 #203 评论里）：
 *   view()          → {rows, more, recent, offline, running}：已排好序（等你 → 在跑 / 排队 → 出错）、已截到 12 行；
 *                     more = 折掉的行数；recent = 刚做完（10 分钟内，最多 5 行）；offline = 断线；running = 在跑总数
 *   subscribe(fn)   → 取消函数；view 变了调 fn(view)
 *   start() / stop()→ 看板打开 / 关上（关着不读列表，设计第一节）
 *   open(key)       → 跳过去（同模式切会话、跨模式重新载入、Metre 上锁先解锁）
 *   usage(key)      → Promise<{cost}>，只在展开一行时调（设计第二节：sessions.usage 太慢，不每行调）
 * 一行：{key, mode, modeLabel, title, state: 'ask'|'run'|'queued'|'error'|'done', doing, since, sinceEstimated,
 *        tokens, contextTokens, over, model, tools, children, childMore} */
(() => {
  'use strict';
  window.Pinkie = window.Pinkie || {};
  if (window.Pinkie.sessionBoardUi) return;

  const root = document.documentElement;
  const data = () => window.Pinkie.sessionBoard || null;
  const skinOf = () => (root.getAttribute('data-laolao-mode') === 'metre' ? 'metre' : 'pinkie');
  const esc = (text) => String(text ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

  // ---------- 文案（纯函数；两种皮同一份数据，只换字和外壳，设计第五节） ----------
  const STATE = {
    pinkie: {ask: '碧琪在等你点头…', run: '碧琪在抛气球干活…', queued: '排队中', error: '出错了', done: '完成啦！'},
    metre: {ask: '等你确认', run: '在处理', queued: '排队中', error: '出错', done: '完成'},
  };
  const STICKER = {ask: 'asking', run: 'working', queued: 'thinking', error: 'oops', done: 'done'};
  const EMPTY = {pinkie: '现在没有在跑的会话', metre: '这一声部还没开始'};
  const MAX_ROWS = 12;

  function elapsed(row, now) {
    if (!row.since || !(now >= row.since)) return '';
    const min = Math.floor((now - row.since) / 60_000);
    const text = min < 1 ? '不到 1 分' : min < 60 ? `${min} 分` : `${Math.floor(min / 60)} 时 ${min % 60} 分`;
    return row.sinceEstimated ? '≥ ' + text : text;
  }
  function usageBar(row, skin) {
    if (!(row.contextTokens > 0) || !(row.tokens >= 0)) return '';
    const pct = Math.min(100, Math.round((row.tokens / row.contextTokens) * 100));
    return `<span class="pk-sb-use${row.over ? ' is-over' : ''}" title="上下文 ${row.tokens} / ${row.contextTokens}" data-skin="${skin}"><i style="width:${pct}%"></i></span>`;
  }
  function lead(row, skin, offline) {
    if (skin === 'pinkie') return `<img class="pk-sb-sticker" src="/laolao-pinkie-status-${STICKER[row.state] || 'thinking'}.png" alt="">`;
    return `<i class="pk-sb-lamp" data-lit="${!offline && (row.state === 'run' || row.state === 'ask') ? 1 : 0}" aria-hidden="true"></i>`;
  }
  function doingText(row, skin, offline) {
    if (offline && (row.state === 'run' || row.state === 'queued' || row.state === 'ask')) return '断线前在跑';
    return row.doing || STATE[skin][row.state] || '';
  }
  /** 一行。纯函数：同样的行、皮和时刻画出同样的 HTML。 */
  function rowHtml(row, skin, now, {offline = false, child = false, cross = ''} = {}) {
    const hint = cross && row.mode && row.mode !== cross ? ` title="会切到「${esc(row.modeLabel || row.mode)}」"` : '';
    const kids = !child && row.children?.length ? `<button type="button" class="pk-sb-kids" data-sb-kids="${esc(row.key)}" aria-expanded="false">另有 ${row.children.length + (row.childMore || 0)} 个分身在跑</button>` : '';
    return `<li class="pk-sb-row${child ? ' is-child' : ''}" data-sb-key="${esc(row.key)}" data-state="${esc(row.state)}"${offline ? ' data-offline="1"' : ''} role="option" tabindex="-1"${hint}>`
      + `${lead(row, skin, offline)}<span class="pk-sb-mode">${esc(row.modeLabel || '')}</span>`
      + `<span class="pk-sb-title">${esc(row.title || '新会话')}</span>`
      + `<span class="pk-sb-doing" title="${esc(doingText(row, skin, offline))}">${esc(doingText(row, skin, offline))}</span>`
      + `<span class="pk-sb-time">${esc(elapsed(row, now))}</span>${usageBar(row, skin)}`
      + `<button type="button" class="pk-sb-more" data-sb-expand="${esc(row.key)}" aria-expanded="false" aria-label="展开">›</button>${kids}</li>`;
  }
  /** 一屏。纯函数，测试直接验。 */
  function listHtml(view, skin, now, cross = '') {
    const v = view || {};
    const rows = (v.rows || []).slice(0, MAX_ROWS);
    const more = (v.more || 0) + Math.max(0, (v.rows || []).length - MAX_ROWS);
    const recent = (v.recent || []).slice(0, 5);
    if (!rows.length && !recent.length) {
      const art = skin === 'pinkie' ? '<img class="pk-sb-empty-art" src="/laolao-pinkie-status-done.png" alt="">' : '<i class="pk-sb-lamp" data-lit="0" aria-hidden="true"></i>';
      return `<div class="pk-sb-empty" data-skin="${skin}">${art}<p>${EMPTY[skin]}</p></div>`;
    }
    const opts = {offline: Boolean(v.offline), cross};
    let html = `<ul class="pk-sb-list" role="listbox" data-skin="${skin}">${rows.map((row) => rowHtml(row, skin, now, opts)).join('')}`;
    if (more) html += `<li class="pk-sb-fold"><button type="button" data-sb-fold>还有 ${more} 个在跑</button></li>`;
    html += '</ul>';
    if (recent.length) html += `<h4 class="pk-sb-sub">刚做完</h4><ul class="pk-sb-list is-recent" role="listbox" data-skin="${skin}">${recent.map((row) => rowHtml(row, skin, now, opts)).join('')}</ul>`;
    if (v.offline) html = `<p class="pk-sb-offline" role="status">网关断了，下面是断线前的样子</p>` + html;
    return html;
  }
  function summary(view, skin) {
    const rows = view?.rows || [];
    const ask = rows.filter((r) => r.state === 'ask').length;
    const run = view?.running ?? rows.filter((r) => r.state === 'run' || r.state === 'queued').length;
    if (skin === 'metre') return ask ? `等你（${ask}）` : run ? `${run} 个声部在奏` : '休止';
    return ask ? `${ask} 个在等你点头` : run ? `${run} 个在跑` : '都歇着呢';
  }

  // ---------- 交互：点行跳转、展开、分身、键盘（设计第三节） ----------
  const find = (view, key) => {
    for (const row of [...(view?.rows || []), ...(view?.recent || [])]) {
      if (row.key === key) return row;
      const kid = row.children?.find((c) => c.key === key);
      if (kid) return kid;
    }
    return null;
  };
  function detailHtml(row) {
    const bits = [['标题', row.title], ['模型', row.model], ['开始', row.since ? new Date(row.since).toLocaleTimeString() : ''],
      ['令牌', row.tokens != null ? `${row.tokens}${row.contextTokens ? ' / ' + row.contextTokens : ''}` : ''], ['最近工具', (row.tools || []).slice(-3).join('、')]];
    return `<dl class="pk-sb-detail">${bits.filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}<dt>花费</dt><dd data-sb-cost>读取中…</dd></dl>`;
  }
  function bind(host, getView, onLeave) {
    host.addEventListener('click', (event) => {
      const t = event.target instanceof Element ? event.target : null;
      if (!t) return;
      const view = getView();
      const exp = t.closest('[data-sb-expand]');
      if (exp) { toggleDetail(exp.closest('.pk-sb-row'), find(view, exp.dataset.sbExpand)); return; }
      const kids = t.closest('[data-sb-kids]');
      if (kids) { toggleKids(kids, find(view, kids.dataset.sbKids), view); return; }
      if (t.closest('[data-sb-fold]')) { host.classList.add('is-unfolded'); return; }
      const row = t.closest('.pk-sb-row');
      if (row && !t.closest('.pk-sb-detail')) { data()?.open?.(row.dataset.sbKey); onLeave?.(); }
    });
    host.addEventListener('keydown', (event) => {
      const rows = [...host.querySelectorAll('.pk-sb-row')];
      const at = rows.indexOf(document.activeElement);
      const go = (i) => { const r = rows[Math.max(0, Math.min(rows.length - 1, i))]; r?.focus(); };
      if (event.key === 'ArrowDown') { event.preventDefault(); go(at + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); go(at - 1); }
      else if (event.key === 'Enter' && at >= 0) { event.preventDefault(); data()?.open?.(rows[at].dataset.sbKey); onLeave?.(); }
      else if (event.key === 'ArrowRight' && at >= 0) { event.preventDefault(); if (!rows[at].nextElementSibling?.classList.contains('pk-sb-detail-row')) toggleDetail(rows[at], find(getView(), rows[at].dataset.sbKey)); }
      else if (event.key === 'ArrowLeft' && at >= 0) { event.preventDefault(); if (rows[at].nextElementSibling?.classList.contains('pk-sb-detail-row')) toggleDetail(rows[at], null); }
    });
  }
  function toggleDetail(rowNode, row) {
    if (!rowNode) return;
    const btn = rowNode.querySelector('[data-sb-expand]');
    const open = rowNode.nextElementSibling?.classList.contains('pk-sb-detail-row') ? rowNode.nextElementSibling : null;
    if (open || !row) { open?.remove(); btn?.setAttribute('aria-expanded', 'false'); return; }
    const li = document.createElement('li');
    li.className = 'pk-sb-detail-row';
    li.innerHTML = detailHtml(row);
    rowNode.after(li);
    btn?.setAttribute('aria-expanded', 'true');
    const cost = li.querySelector('[data-sb-cost]');
    Promise.resolve(data()?.usage?.(row.key)).then((u) => { cost.textContent = u && u.cost != null ? `$${Number(u.cost).toFixed(3)}` : '读不到'; }, () => { cost.textContent = '读不到'; });
  }
  function toggleKids(btn, row, view) {
    const rowNode = btn.closest('.pk-sb-row');
    const shown = btn.getAttribute('aria-expanded') === 'true';
    let next = rowNode.nextElementSibling;
    while (next && (next.classList.contains('is-child') || next.classList.contains('pk-sb-detail-row') || next.classList.contains('pk-sb-kid-more'))) { const n = next.nextElementSibling; if (next.classList.contains('is-child') || next.classList.contains('pk-sb-kid-more')) next.remove(); next = n; }
    btn.setAttribute('aria-expanded', String(!shown));
    if (shown || !row?.children?.length) return;
    const skin = rowNode.closest('[data-skin]')?.dataset.skin || skinOf();
    const tpl = document.createElement('template');
    const kids = row.children.slice(0, 10);
    const extra = row.children.length - kids.length + (row.childMore || 0);
    tpl.innerHTML = kids.map((kid) => rowHtml(kid, skin, Date.now(), {offline: Boolean(view?.offline), child: true})).join('') + (extra > 0 ? `<li class="pk-sb-kid-more">还有 ${extra} 个</li>` : '');
    rowNode.after(tpl.content);
  }

  // ---------- 碧琪皮：侧栏顶部胶囊 + 从侧栏右边滑出的面板 ----------
  let panel = null, pill = null, unsub = null, view = null, lastFocus = null;
  const isOpen = () => Boolean(panel && !panel.hidden);
  function paintPill() {
    const controls = document.querySelector('aside.sidebar .laolao-session-controls');
    const n = view?.running ?? (view?.rows || []).filter((r) => r.state === 'run' || r.state === 'queued' || r.state === 'ask').length;
    if (!controls || !data()) { pill?.remove(); return; }
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pk-sb-pill';
      pill.addEventListener('click', () => (skinOf() === 'metre' ? window.__pinkieMetreBoard?.toggle?.('all') : toggle()));
    }
    // 放在快捷键那一组前面、不放进去：会话列表每次重画都会清空那一组。
    if (pill.nextElementSibling !== controls) controls.before(pill);
    pill.dataset.skin = skinOf();
    pill.hidden = !(n > 0) && !isOpen();
    const ask = (view?.rows || []).some((r) => r.state === 'ask');
    pill.dataset.ask = ask ? '1' : '0';
    pill.textContent = `在跑 ${n || 0}`;
    pill.setAttribute('aria-expanded', String(isOpen()));
    pill.title = summary(view, skinOf());
  }
  function buildPanel() {
    panel = document.createElement('section');
    panel.className = 'pk-sb-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '在跑的会话');
    panel.hidden = true;
    panel.innerHTML = '<header class="pk-sb-head"><h3>在跑的会话</h3><span class="pk-sb-sum"></span><button type="button" class="pk-sb-close" aria-label="收起">×</button></header><div class="pk-sb-body"></div>';
    panel.querySelector('.pk-sb-close').addEventListener('click', () => close());
    panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    bind(panel.querySelector('.pk-sb-body'), () => view, () => close(false));
    document.body.append(panel);
  }
  function placePanel() {
    const side = document.querySelector('aside.sidebar')?.getBoundingClientRect();
    panel.style.setProperty('--pk-sb-left', Math.round(side && side.width > 0 ? side.right : 0) + 'px');
  }
  function paintPanel() {
    if (!isOpen()) return;
    panel.querySelector('.pk-sb-sum').textContent = summary(view, 'pinkie');
    panel.querySelector('.pk-sb-body').innerHTML = listHtml(view, 'pinkie', Date.now(), root.getAttribute('data-laolao-mode') || '');
  }
  function open() {
    if (!data() || skinOf() === 'metre') return false;
    if (!panel) buildPanel();
    lastFocus = document.activeElement;
    panel.hidden = false;
    placePanel();
    data().start?.();
    view = data().view?.() || view;
    paintPanel(); paintPill();
    (panel.querySelector('.pk-sb-row') || panel.querySelector('.pk-sb-close')).focus({preventScroll: true});
    return true;
  }
  function close(restore = true) {
    if (!isOpen()) return;
    panel.hidden = true;
    if (!metreShown()) data()?.stop?.();
    paintPill();
    if (restore) lastFocus?.focus?.({preventScroll: true});
  }
  const toggle = () => (isOpen() ? (close(), false) : open());

  // ---------- Metre 皮：总控台里的「全部会话」一栏（laolao-metre-board.js 的 'all' 区块） ----------
  const metreShown = () => Boolean(window.__pinkieMetreBoard?.isOpen) && skinOf() === 'metre';
  function paintMetre() {
    const board = window.__pinkieMetreBoard;
    if (!board || !data() || !metreShown()) return;
    const node = document.createElement('div');
    node.className = 'pk-sb-metre';
    node.innerHTML = `<p class="pk-sb-sum" data-skin="metre">${esc(summary(view, 'metre'))}</p>` + listHtml(view, 'metre', Date.now(), 'metre');
    bind(node, () => view, null);
    board.keepPlace ? board.keepPlace(() => board.fill('all', node)) : board.fill('all', node);
  }

  // ---------- 接线 ----------
  function onView(next) { view = next; paintPill(); paintPanel(); paintMetre(); }
  function connect() {
    const src = data();
    if (!src || unsub) return;
    unsub = src.subscribe?.(onView) || null;
    view = src.view?.() || null;
    paintPill();
  }
  function start() {
    connect();
    window.addEventListener('pinkie:session-board-ready', connect);
    window.addEventListener('laolao:modechange', () => { if (skinOf() === 'metre') close(false); paintPill(); });
    window.addEventListener('pinkie:metre-board-open', () => { if (!data()) return; data().start?.(); view = data().view?.() || view; paintMetre(); });
    window.addEventListener('pinkie:metre-board-closed', () => { if (!isOpen()) data()?.stop?.(); });
    window.addEventListener('resize', () => { if (isOpen()) placePanel(); });
    // 侧栏会话区每次重画都可能换掉快捷键那一组：等它出现就把胶囊放回去。
    window.Pinkie.domWatch?.watch?.('aside.sidebar .laolao-session-controls', () => { connect(); paintPill(); });
    document.addEventListener('click', (event) => {
      if (!isOpen()) return;
      const t = event.target instanceof Element ? event.target : null;
      if (t && !t.closest('.pk-sb-panel, .pk-sb-pill')) close(false);
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();

  window.Pinkie.sessionBoardUi = Object.freeze({open, close, toggle, get isOpen() { return isOpen(); }, listHtml, rowHtml, summary, elapsed, MAX_ROWS});
})();
