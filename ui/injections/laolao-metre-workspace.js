/* laolao-metre-workspace —— 第六批「把原生工作区露出来」（11-24，m5 线），只在 Metre 生效。
 *
 * S1 会话筛选：侧栏顶上加一颗「筛选」，按 laolao-session-list.js 已经画好的状态记号
 *    （运行中 / 等你回复 / 上一轮出错 / 未读）只显示对应的会话。不另取数据、不改列表：
 *    只在 <html> 上挂 data-pk-mw-filter，由 laolao-metre-workspace.css 用 :has() 藏掉其余行，列表重画也照样生效。
 *    按键带 pk-metre-nav 类，会话列表重画时和「总谱」一样被留住。
 * K2 Esc：这一轮在跑时按 Esc = 点原生停止键（.chat-send-btn--stop，原生自己发 chat.abort）；
 *    没在跑、输入框里有字时，0.5 秒内连按两下 Esc 清空输入框。
 *    原生已经用 Esc 的地方（引用回复、旁问结果、斜杠菜单、查找条、各种弹层）先处理，这里只接没人要的 Esc。
 * K3 快捷键：⌘/Ctrl+1…9 打开侧栏第 N 个会话；Ctrl+Tab / Ctrl+Shift+Tab 打开下一个 / 上一个。
 *    跳过被筛选藏掉的行；点的是会话行自己的链接（laolao-session-list.js 里的 navigateSession）。
 *    新会话 ⌘/Ctrl+N 已由 laolao-sidebar.js 提供，这里不重复。
 * K1 命令面板（⌘/Ctrl+K，原生 openclaw-command-palette）补动作：新会话、换模型、总谱、工作台（含终端）、分屏、
 *    导出、筛选、旁问 /btw、目标 /goal；输入关键词时排在最前，用过的标「最近用过」排前面。
 * 其他五个模式一个字不动。不自己开定时器、不自己开 DOM 观察器、不加新的全局名：刷新只挂在 Pinkie.domWatch 和会话列表的事件上。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreWorkspace) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const isMac = /Mac|iPhone|iPad/i.test((window.navigator && window.navigator.platform) || '');
  const FILTERS = Object.freeze([
    {id: '', label: '全部会话'},
    {id: 'running', label: '在跑'},
    {id: 'waiting', label: '等你回复'},
    {id: 'unread', label: '未读'},
    {id: 'error', label: '上一轮出错'},
  ]);
  const MARK = Object.freeze({
    running: '.pinkie-session-status--running',
    waiting: '.pinkie-session-status--waiting',
    error: '.pinkie-session-status--error',
    unread: '.pinkie-session-unread',
  });
  const ROW = '#laolao-session-manager .session-row-host';
  const LINK = 'a.sidebar-recent-session__link';
  // 这些东西开着时 Esc 归它们：斜杠菜单、弹层、引用回复、旁问结果、查找条、工作台的快速打开、本文件的筛选菜单。
  const LAYERS = '.slash-menu, [aria-modal="true"], [role="dialog"], .chat-reply-pill, .chat-side-result, .agent-chat__search-bar, .pk-wb-quick, .pk-mw-filter-menu, details[open] > .chat-controls__inline-select-menu';
  const EDITOR = '.monaco-editor, .monaco-diff-editor, .cm-editor, .pk-wb, .pk-wb-host, [data-workbench-editor]';
  const DOUBLE_ESC_MS = 500;

  let filter = '';
  let lastEsc = 0;
  let menu = null;

  const shown = node => Boolean(node?.getClientRects?.().length) && (typeof node.checkVisibility === 'function' ? node.checkVisibility() : !node.closest?.('details:not([open]) > :not(summary)')); // 关着的 <details> 里的弹层（上下文查看器 role=dialog）有 rect 但看不见，不算（mac1 11-25）
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const labelOf = id => (FILTERS.find(f => f.id === id) || FILTERS[0]).label;

  // ---------- S1 筛选 ----------
  function allRows() {
    return [...document.querySelectorAll(ROW)].filter(node => !node.classList.contains('pinkie-session-part') && node.querySelector(LINK));
  }
  function counts() {
    const rows = allRows();
    const out = {'': rows.length};
    for (const [id, sel] of Object.entries(MARK)) out[id] = rows.filter(node => node.querySelector(sel)).length;
    return out;
  }
  function setFilter(id) {
    const next = Object.prototype.hasOwnProperty.call(MARK, id) ? id : '';
    filter = isMetre() ? next : '';
    if (filter) root.setAttribute('data-pk-mw-filter', filter); else root.removeAttribute('data-pk-mw-filter');
    paintButton();
    ensureEmpty();
    return filter;
  }
  function paintButton() {
    const btn = document.querySelector('aside.sidebar .pk-metre-nav--filter');
    if (!btn) return;
    const label = btn.querySelector('span') || btn;
    label.textContent = filter ? '筛选 · ' + labelOf(filter) : '筛选';
    btn.setAttribute('aria-pressed', String(Boolean(filter)));
    btn.setAttribute('aria-label', filter ? '会话筛选：只看' + labelOf(filter) + '，点开换一种' : '会话筛选：全部会话');
  }
  // 筛到 0 条时的空态（界面审查 11-24 23:55 第 3 条）：一行提示 +「显示全部」。节点常驻在
  // #laolao-session-manager 顶上（会话列表重画只换 .laolao-managed-groups，不清 host），
  // 显不显示交给 laolao-metre-workspace.css 的 :has()——列表怎么重画都跟着对。
  const EMPTY_TEXT = Object.freeze({running: '没有在跑的会话', waiting: '没有等你回复的会话', unread: '没有未读的会话', error: '没有上一轮出错的会话'});
  function ensureEmpty() {
    const host = document.querySelector('aside.sidebar #laolao-session-manager');
    if (!host) return null;
    let box = host.querySelector('.pk-mw-filter-empty');
    if (!box) {
      box = el('div', 'pk-mw-filter-empty');
      box.setAttribute('role', 'status');
      const show = el('button', 'pk-mw-filter-empty__all', '显示全部');
      show.type = 'button';
      show.addEventListener('click', () => { setFilter(''); document.querySelector('aside.sidebar .pk-metre-nav--filter')?.focus(); });
      box.append(el('span', 'pk-mw-filter-empty__text', ''), show);
      if (typeof host.prepend === 'function') host.prepend(box); else host.append(box);
    }
    const text = box.querySelector('.pk-mw-filter-empty__text');
    if (text) text.textContent = EMPTY_TEXT[filter] || '';
    return box;
  }
  function closeMenu(focusButton) {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('pointerdown', outside, true);
    const btn = document.querySelector('aside.sidebar .pk-metre-nav--filter');
    if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusButton) btn.focus(); }
  }
  function outside(event) {
    if (!menu) return;
    const target = event.target;
    if (menu.contains(target) || target?.closest?.('.pk-metre-nav--filter')) return;
    closeMenu(false);
  }
  function openMenu(btn) {
    if (menu) { closeMenu(true); return; }
    const n = counts();
    menu = el('div', 'pk-mw-filter-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '会话筛选');
    for (const f of FILTERS) {
      const item = el('button', 'pk-mw-filter-menu__item');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(f.id === filter));
      item.dataset.filter = f.id;
      item.append(el('span', 'pk-mw-filter-menu__label', f.label), el('span', 'pk-mw-filter-menu__count', String(n[f.id] ?? 0)));
      item.addEventListener('click', () => { setFilter(f.id); closeMenu(true); });
      menu.append(item);
    }
    menu.addEventListener('keydown', event => {
      const items = [...menu.querySelectorAll('.pk-mw-filter-menu__item')];
      const at = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
    // 挂进侧栏，不挂 body：1024 / 820 宽侧栏是抽屉，laolao-sidebar.js 在 document 捕获阶段见到 .shell-nav 外的
    // pointerdown 就收抽屉，菜单挂在 body 上时用鼠标点任何一项都算「点在抽屉外」（界面审查 11-24 23:55 第 1 条）。
    // aside 带 container（metre-skin），是 fixed 的参照块：先挂上去，再按它的实际原点换算到按钮正下方。
    menu.style.left = '0px';
    menu.style.top = '0px';
    (document.querySelector('aside.sidebar') || document.body).append(menu);
    const r = btn.getBoundingClientRect();
    const o = menu.getBoundingClientRect();
    menu.style.left = Math.round(r.left - (o.left || 0)) + 'px'; menu.style.width = Math.round(r.width) + 'px'; // 和按键（= 侧栏列表那一栏）等宽：窄了右边会露出被切掉半截的会话行
    menu.style.top = Math.round(r.bottom + 4 - (o.top || 0)) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.pk-mw-filter-menu__item'))?.focus();
  }
  function ensure() {
    if (!isMetre()) {
      if (filter || root.hasAttribute('data-pk-mw-filter')) setFilter('');
      closeMenu(false);
      return;
    }
    ensureEmpty();
    const controls = document.querySelector('aside.sidebar .laolao-session-controls');
    if (!controls || controls.querySelector('.pk-metre-nav--filter')) return;
    const btn = el('button', 'pinkie-sidebar-entry pk-metre-nav pk-metre-nav--filter');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.append(el('span', '', '筛选'));
    btn.addEventListener('click', () => openMenu(btn));
    controls.append(btn);
    paintButton();
  }

  // ---------- K3 会话快捷键 ----------
  function navRows() {
    const rows = allRows().filter(node => !filter || node.querySelector(MARK[filter]));
    const visible = rows.filter(shown);
    return visible.length ? visible : rows; // 侧栏收起时也照样能切
  }
  function openRow(node) {
    const link = node?.querySelector(LINK);
    if (!link) return false;
    link.click();
    return true;
  }
  function shortcut(event) {
    if (event.altKey || event.target?.closest?.(EDITOR)) return null;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && !event.shiftKey && /^Digit[1-9]$/.test(event.code || '')) return {index: Number(event.code.slice(5)) - 1};
    if (event.ctrlKey && !event.metaKey && event.key === 'Tab') return {step: event.shiftKey ? -1 : 1};
    return null;
  }
  function jump(cmd) {
    const rows = navRows();
    if (!rows.length) return false;
    if (cmd.index != null) return cmd.index < rows.length ? openRow(rows[cmd.index]) : false;
    const at = rows.findIndex(node => node.classList.contains('sidebar-recent-session--active'));
    const next = at < 0 ? (cmd.step > 0 ? 0 : rows.length - 1) : (at + cmd.step + rows.length) % rows.length;
    return next === at ? false : openRow(rows[next]);
  }

  // ---------- K2 Esc ----------
  function layerOpen() {
    return [...document.querySelectorAll(LAYERS)].some(shown);
  }
  function escape(event) {
    if (layerOpen()) return false;
    const stop = document.querySelector('.agent-chat__input .chat-send-btn--stop');
    if (stop && !stop.disabled && shown(stop)) {
      event.preventDefault();
      lastEsc = 0;
      stop.click();
      return 'stop';
    }
    const box = document.querySelector('.agent-chat__input textarea');
    if (!box || event.target !== box || !box.value) { lastEsc = 0; return false; }
    const now = event.timeStamp > 0 ? event.timeStamp : Date.now(); // 按键事件自己的时间戳：单调，不受页面冻结 / 改动 Date 影响
    if (lastEsc && now - lastEsc >= 0 && now - lastEsc <= DOUBLE_ESC_MS) {
      event.preventDefault();
      lastEsc = 0;
      box.value = '';
      box.dispatchEvent(new Event('input', {bubbles: true}));
      return 'clear';
    }
    lastEsc = now;
    return false;
  }

  function handleKey(event) {
    if (!isMetre() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return escape(event);
    const cmd = shortcut(event);
    if (!cmd) return false;
    event.preventDefault();
    return jump(cmd) ? 'jump' : false;
  }

  // ---------- K1 命令面板补动作 ----------
  // 原生 openclaw-command-palette 只有导航项；有字时它调 searchSessions(query)，把 sessionItems 排在最前，
  // 选中 nav:<x> 的项交给 onNavigate(x)。laolao-sidebar.js 已经包过这两个；这里在它外面再包一层：
  // Metre 下加上本文件的动作（每项都点页面上已有的按键，或者把原生斜杠命令放进输入框），用过的排在前面。
  // 某项的按键此刻不在页面上，就不列出来（没接上后端的按键不出现）。
  const RECENT_KEY = 'pinkie.metre.palette.recent.v1';
  const NAV = 'pinkie-mw:';
  const putDraft = text => {
    const box = document.querySelector('.agent-chat__input textarea');
    if (!box) return false;
    box.value = text;
    box.dispatchEvent(new Event('input', {bubbles: true}));
    box.focus();
    return true;
  };
  const clickFirst = sel => { const node = [...document.querySelectorAll(sel)].find(n => !n.disabled); if (!node) return false; node.click(); return true; };
  const MODEL = 'details.chat-controls__model > summary, details.chat-controls__model-picker > summary';
  const SPLIT = '[aria-label="分屏工作区：在右侧打开另一个模式"]';
  const NEW = '.sidebar-new-session:not(.sidebar-new-session--worktree)';
  const BOX = '.agent-chat__input textarea';
  const ACTIONS = Object.freeze([
    {id: 'new-session', label: '新会话', icon: 'plus', target: NEW, run: () => clickFirst(NEW)},
    {id: 'model', label: '换模型', icon: 'brain', target: MODEL, run: () => clickFirst(MODEL)},
    {id: 'board', label: '打开总谱', icon: 'barChart', target: '.pk-metre-nav--board', run: () => clickFirst('.pk-metre-nav--board')},
    {id: 'workbench', label: '打开工作台（文件、终端）', icon: 'folder', target: '.pk-wb-reopen', run: () => clickFirst('.pk-wb-reopen')},
    {id: 'split', label: '分屏：在右侧打开另一个模式', icon: 'panelRightOpen', target: SPLIT, run: () => clickFirst(SPLIT)},
    {id: 'export', label: '导出这段会话…', icon: 'download', available: () => typeof window.PinkieSessionTools?.openExport === 'function', run: () => { window.PinkieSessionTools.openExport(); return true; }},
    {id: 'filter', label: '会话筛选', icon: 'search', target: '.pk-metre-nav--filter', run: () => clickFirst('.pk-metre-nav--filter')},
    {id: 'btw', label: '旁问一句（/btw，不进主线）', icon: 'messageSquare', target: BOX, run: () => putDraft('/btw ')},
    {id: 'goal', label: '设一个目标（/goal）', icon: 'target', target: BOX, run: () => putDraft('/goal ')},
  ]);
  function recent() {
    try {
      const list = JSON.parse(window.localStorage?.getItem(RECENT_KEY) || '[]');
      return Array.isArray(list) ? list.filter(id => ACTIONS.some(a => a.id === id)).slice(0, 5) : [];
    } catch { return []; }
  }
  function remember(id) {
    try { window.localStorage?.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, 5))); } catch {}
  }
  function available(action) {
    if (action.available) return Boolean(action.available());
    return [...document.querySelectorAll(action.target)].some(n => !n.disabled);
  }
  function paletteItems(query) {
    if (!isMetre()) return [];
    const q = String(query || '').trim().toLowerCase();
    const used = recent();
    const rank = a => { const i = used.indexOf(a.id); return i < 0 ? used.length : i; };
    return ACTIONS
      .filter(a => available(a) && (!q || a.label.toLowerCase().includes(q) || a.id.includes(q)))
      .sort((a, b) => rank(a) - rank(b))
      .map(a => ({id: 'pinkie-mw-' + a.id, label: a.label, icon: a.icon, category: 'navigation', action: 'nav:' + NAV + a.id,
        description: used.includes(a.id) ? '最近用过' : 'Metre'}));
  }
  function runAction(id) {
    const action = ACTIONS.find(a => a.id === id);
    if (!action || !isMetre() || !available(action)) return false;
    remember(id);
    return Boolean(action.run());
  }
  function ensurePalette() {
    const palette = document.querySelector('openclaw-command-palette');
    if (!palette) return;
    const search = palette.searchSessions;
    if (typeof search === 'function' && !search.pkMetreWorkspace) {
      const wrapped = async function (query) {
        const result = await search.call(this, query);
        const mine = paletteItems(query);
        if (mine.length && this.open) {
          const rest = (this.sessionItems || []).filter(item => !String(item?.action || '').startsWith('nav:' + NAV));
          this.sessionItems = [...mine, ...rest];
          this.activeIndex = 0;
        }
        return result;
      };
      wrapped.pkMetreWorkspace = true;
      palette.searchSessions = wrapped;
    }
    const navigate = palette.onNavigate;
    if (typeof navigate === 'function' && !navigate.pkMetreWorkspace) {
      const wrapped = route => (String(route).startsWith(NAV) ? void runAction(String(route).slice(NAV.length)) : navigate(route));
      wrapped.pkMetreWorkspace = true;
      palette.onNavigate = wrapped;
    }
  }

  // 筛选菜单开着时 Esc 只关菜单：挂在 window 的捕获阶段，先于 laolao-sidebar.js 在 document 捕获阶段
  // 「Esc 就收起侧栏抽屉」那一条（1024 / 820 宽侧栏是抽屉，菜单在抽屉里，不能一起收掉）。
  function menuEscape(event) {
    if (!menu || event.key !== 'Escape' || event.isComposing) return false;
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
    return true;
  }

  function refresh() { ensure(); ensurePalette(); }
  window.addEventListener('keydown', menuEscape, true);
  document.addEventListener('keydown', handleKey, false);
  window.addEventListener('laolao:sessions-changed', () => setTimeout(refresh, 0));
  window.Pinkie?.domWatch?.poll?.(refresh, 1500);
  refresh();

  ns.metreWorkspace = Object.freeze({
    FILTERS,
    ACTIONS,
    get filter() { return filter; },
    setFilter,
    counts,
    handleKey,
    menuEscape,
    ensure,
    ensurePalette,
    paletteItems,
    runAction,
  });
})();
