/* laolao-metre-list —— Metre 侧栏会话列表的整理（11-24 第 5 轮追加 B，用户：「聊天记录栏排版感觉很不搭很怪」）。
 * laolao-session-list.js 在 Metre 里每次重画完列表就调 PinkieMetreList.decorate(groups, rows, api)（别的模式不调）：
 *   - 只留一层分组（今天 / 昨天 / 7 天内 / 30 天内 / 更早）：「最近」那一层的标题行藏掉，它的「⋯」菜单挪到第一行日期的右边；
 *   - 每行左边、正好在上面导航图标那一列，一个状态记号：在跑（节拍点在动）/ 等你（钴蓝点）/ 出错（砖红点）；没读过的会话名加粗。
 *     数据只用后台给的会话状态（PinkieSessionList.sessionStatus 和 unread，原来右边那几个小图标用的就是它），页面不自己猜；
 *   - 右边是相对时间（刚刚 / 3 分钟前 / 17:11 / 昨天 / 周三 / 11/20），和会话名同一条基线，右对齐；
 *   - 悬停时浮出「置顶 / 重命名 / 归档」三个小键（原来的「⋯」留在最后），不悬停时不占位置。
 * 左对齐线（全部文字在导航文字那一条线上）、选中样式在 laolao-metre-skin.css 最后「第 5 轮追加 B」那一段。
 * 相对时间在列表重画、run-view（有会话在跑时）、窗口重新可见时就地刷新，不加定时器。 */
(() => {
  'use strict';
  if (window.PinkieMetreList) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const STATE = {running: '在跑', waiting: '等你', error: '出错'};
  function relTime(value, now = Date.now()) {
    const t = typeof value === 'number' ? value : new Date(value).getTime();
    if (!value || !Number.isFinite(t)) return '';
    const min = Math.floor((now - t) / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const d = new Date(t), day = (x) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
    const age = Math.round((day(new Date(now)) - day(d)) / 86400000);
    if (age <= 0) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (age === 1) return '昨天';
    if (age < 7) return '周' + '日一二三四五六'[d.getDay()];
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  const stamp = (value) => (typeof value === 'number' ? value : new Date(value).getTime()) || 0;
  function mini(label, glyph, fn) {
    const b = el('button', 'pk-ml-act', glyph); b.type = 'button'; b.setAttribute('aria-label', label); b.dataset.pinkieTooltip = label;
    b.onclick = (event) => { event.preventDefault(); event.stopPropagation(); fn(event); };
    return b;
  }
  function row(n, s, api) {
    const link = n.querySelector(':scope > .sidebar-recent-session__link'), aside = n.querySelector(':scope > .session-row-aside');
    if (!link || !aside || n.querySelector(':scope > .pk-ml-dot')) return;
    const state = window.PinkieSessionList?.sessionStatus?.(s) || '';
    const dot = el('span', 'pk-ml-dot'); dot.dataset.state = state || 'idle';
    if (state) { dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', STATE[state]); dot.dataset.pinkieTooltip = STATE[state]; } else dot.setAttribute('aria-hidden', 'true');
    n.prepend(dot);
    n.classList.toggle('pk-ml-unread', Boolean(s.unread));
    let time = aside.querySelector(':scope > .pinkie-session-time');
    if (!time) { time = el('time', 'pinkie-session-time'); aside.prepend(time); }
    time.dataset.at = String(stamp(s.updatedAt)); time.textContent = relTime(stamp(s.updatedAt));
    const actions = aside.querySelector(':scope > .laolao-row-actions');
    if (actions && !s.archived && !n.classList.contains('pinkie-session-part')) {
      const pinned = Boolean(api.state?.pins?.includes(s.key));
      actions.prepend(mini(pinned ? '取消置顶' : '置顶', pinned ? '⤓' : '⤒', () => api.togglePin?.(s.key)),
        mini('重命名', '✎', () => window.PinkieSessionList?.beginRename?.(s.key)),
        mini('归档', '⌫', () => api.archiveWithUndo?.(s.key)));
    }
  }
  function decorate(groups, rows, api) {
    const byKey = new Map((rows || []).map((s) => [s.key, s]));
    for (const n of groups.querySelectorAll('.session-row-host[data-session-key]')) { const s = byKey.get(n.dataset.sessionKey); if (s) row(n, s, api); } window.PinkieMetreWorktree?.mark(groups); window.Pinkie?.metrePeek?.mark(groups, byKey);   // S7：行里「目录 · 分支」（laolao-metre-worktree.js）；L28：悬停预览卡（laolao-metre-peek.js）
    for (const g of groups.querySelectorAll(':scope > .laolao-group')) {
      const head = g.querySelector(':scope > .laolao-group__head'), more = head?.querySelector(':scope > .pinkie-recent-menu');
      const first = g.querySelector(':scope > .laolao-group__list > .pinkie-session-date');
      if (more && first) { g.classList.add('pk-ml-flat'); first.append(more); }
    }
  }
  function refresh() {
    const now = Date.now();
    for (const t of document.querySelectorAll('aside.sidebar .pinkie-session-time[data-at]')) { const v = relTime(Number(t.dataset.at), now); if (t.textContent !== v) t.textContent = v; }
  }
  let last = 0;
  window.addEventListener('pinkie:run-view', () => { if (Date.now() - last > 20000) { last = Date.now(); refresh(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.PinkieMetreList = Object.freeze({decorate, relTime, refresh});
  if (document.documentElement.getAttribute('data-laolao-mode') === 'metre') window.PinkieSessionList?.invalidate?.();   // 列表可能在本文件加载前已经画过一遍：叫它重画一次
})();
