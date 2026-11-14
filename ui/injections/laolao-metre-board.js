/* laolao-metre-board —— Metre 总控台的页面骨架（PLAN 2.12、6.2 第 9 区；批 5 的前半）
 *
 * 这份文件现在只做「页面长什么样」：九个区块的位置、标题、说明和示意图都在，数据一格都没接。
 * 每个区块标着「待接入」，示意图是占位 SVG，不是真数据，不许当成真数据看。
 *
 * 给做批 5 后端的人：
 *   - 接口按 PLAN 2.12：只读的 `pinkie.metre.board`，一次返回九个区块的数据；项目记忆区读已有的 `pinkie.metre.memory`。
 *   - 每个区块是 `[data-metre-slot="<名字>"]`，名字见下面 SLOTS 的 id。
 *   - 接好一个区块就调 `window.__pinkieMetreBoard.fill('<名字>', 节点)`：占位图和「待接入」标签会拿掉，换成你的节点。
 *     `window.__pinkieMetreBoard.reset('<名字>')` 退回占位。
 *   - 总览条四个数字：`setStat('state' | 'elapsed' | 'running' | 'returned', '文字')`；running 传 `'3/24'`，会排成拍号那样上下两个数。
 *   - 「全部停下」「暂停派发」现在是禁用的，接上批 1 的接口后调 `enableActions({stop, pause})`。
 *   - 刷新节奏按 2.12：靠 `pinkie:gateway-event` 触发，每秒最多一次，没有事件不轮询。这里没有任何定时器和请求。
 *
 * 入口：侧栏「总控台」、首页输入框下面的三张卡片、`window.__pinkieMetreBoard.open(区块名)`。只在 Metre 模式出现。 */
(() => {
  'use strict';
  if (window.__pinkieMetreBoard) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';

  // ---------- 占位示意图（单色线条，颜色全走样式表里的变量） ----------
  // 类：l 细线、d 虚线、f 浅色填充、s 深一档填充、a 强调色、t 小字。
  const svg = (w, h, body) => `<svg class="pk-mb-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="示意图，数据待接入" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
  const bar = (x, y, w, h = 8, cls = 'f') => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(4, h / 2)}"/>`;
  const ART = {
    plan: () => svg(320, 150, [0, 1, 2, 3, 4].map((i) => {
      const y = 14 + i * 27;
      const mark = i < 2
        ? `<circle class="s" cx="18" cy="${y + 6}" r="7"/><path class="k" d="M14.5 ${y + 6}l2.5 2.5 4.5-5"/>`
        : i === 2 ? `<circle class="a-ring" cx="18" cy="${y + 6}" r="6.25"/><circle class="a" cx="18" cy="${y + 6}" r="2.5"/>`
          : `<circle class="l" cx="18" cy="${y + 6}" r="6.25"/>`;
      return mark + bar(36, y + 2, [168, 210, 132, 190, 150][i], 8, i === 2 ? 's' : 'f') + (i < 4 ? `<path class="d" d="M18 ${y + 15}v10"/>` : '');
    }).join('')),
    // 子会话画成一页总谱：一行一个声部（子会话），横向是时间，小块是它在干活的那几段，竖虚线是小节线，黄铜色竖线是「现在」。
    sessions: () => {
      const lanes = [[[0, 150], [170, 96], [286, 60]], [[40, 84], [150, 190]], [[96, 60], [176, 44], [250, 96]], [[210, 136]]];
      let out = '';
      for (let x = 120; x <= 600; x += 80) out += `<path class="d faint" d="M${x} 8v134"/>`;
      lanes.forEach((blocks, i) => {
        const y = 22 + i * 32;
        out += `<circle class="${i === 3 ? 'l' : i === 0 ? 'a' : 's'}" cx="12" cy="${y + 6}" r="4"/>${bar(24, y + 2, [64, 50, 70, 56][i], 8, 's')}<path class="l faint" d="M120 ${y + 6}h480"/>`;
        for (const [x, w] of blocks) out += `<rect class="${i === 0 && x === 286 ? 'a-soft' : x + w > 420 ? 'f' : 's'}" x="${120 + x}" y="${y}" width="${Math.min(w, 480 - x)}" height="12" rx="4"/>`;
      });
      return svg(620, 150, out + `<path class="now" d="M466 6v138"/><path class="a" d="M461 4h10l-5 6z"/>`);
    },
    timeline: () => svg(320, 150, `<path class="l" d="M22 10v130"/>` + [0, 1, 2, 3, 4].map((i) => {
      const y = 14 + i * 27;
      return `<circle class="${i === 0 ? 'a' : 'dot'}" cx="22" cy="${y + 5}" r="${i === 0 ? 4.5 : 3.5}"/>${bar(38, y, 34, 6)}${bar(82, y - 1, [150, 110, 176, 96, 130][i], 9, i === 0 ? 's' : 'f')}`;
    }).join('')),
    changes: () => svg(320, 150, [0, 1, 2, 3, 4].map((i) => {
      const y = 12 + i * 27;
      const indent = [0, 16, 16, 0, 16][i];
      const folder = indent === 0;
      const icon = folder
        ? `<path class="l" d="M${10} ${y + 1}h6l2 2.5h8v8.5h-16z"/>`
        : `<path class="l" d="M${12 + indent} ${y}h6l3 3v9h-9z"/>`;
      const add = [0, 34, 12, 0, 22][i], del = [0, 10, 4, 0, 16][i];
      return icon + bar(34 + indent, y + 2, [70, 96, 78, 60, 108][i], 8, folder ? 's' : 'f')
        + (folder ? '' : `<rect class="s" x="${300 - add - del}" y="${y + 3}" width="${add}" height="6" rx="2"/><rect class="d-fill" x="${302 - del}" y="${y + 3}" width="${del}" height="6" rx="2"/>`);
    }).join('')),
    pending: () => svg(320, 150, `<rect class="l" x="60" y="22" width="200" height="46" rx="10"/>${bar(76, 36, 110, 8, 's')}${bar(76, 50, 70, 6)}<rect class="a" x="206" y="35" width="40" height="20" rx="10"/>`
      + `<rect class="d" x="60" y="82" width="200" height="46" rx="10"/>${bar(76, 96, 90, 8)}${bar(76, 110, 120, 6)}`),
    runtime: () => {
      const C = 2 * Math.PI * 30;
      const spark = 'M150 96l14-10 14 6 14-22 14 12 14-18 14 8 14-20 14 14 14-8 14 4';
      return svg(320, 150, `<circle class="ring" cx="56" cy="62" r="30"/><circle class="ring-a" cx="56" cy="62" r="30" stroke-dasharray="${(C * 0.38).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 56 62)"/>${bar(40, 58, 32, 8, 's')}${bar(30, 108, 52, 6)}`
        + `<path class="l" d="M150 30h160M150 63h160M150 96h160"/><path class="spark" d="${spark}"/><circle class="a" cx="290" cy="74" r="3.5"/>`
        + [0, 1, 2].map((i) => `<circle class="${i === 2 ? 'l' : 's'}" cx="${154 + i * 56}" cy="124" r="4"/>${bar(164 + i * 56, 120, 36, 7)}`).join(''));
    },
    raw: () => svg(320, 150, `<rect class="f" x="8" y="8" width="304" height="134" rx="8"/>` + [0, 1, 2, 3, 4, 5].map((i) => {
      const y = 22 + i * 19;
      return bar(20, y, 38, 6, 's') + bar(66, y, [200, 150, 222, 120, 180, 96][i], 6, 'line-fill');
    }).join('')),
    memory: () => svg(320, 150, [0, 1, 2].map((r) => [0, 1, 2].map((c) => {
      const level = [[3, 2, 1], [2, 3, 0], [1, 0, 0]][r][c];
      return `<rect class="${['d', 'f', 's', 'a-soft'][level]}" x="${12 + c * 40}" y="${14 + r * 40}" width="34" height="34" rx="7"/>`;
    }).join('')).join('') + [0, 1, 2, 3].map((i) => {
      const y = 20 + i * 30;
      return bar(150, y, 44, 7, 's') + `<rect class="f" x="150" y="${y + 13}" width="158" height="6" rx="3"/><rect class="${i === 0 ? 'a' : 's'}" x="150" y="${y + 13}" width="${[118, 84, 56, 30][i]}" height="6" rx="3"/>`;
    }).join('')),
  };

  // ---------- 区块 ----------
  const ICON = {
    plan: 'M5 5.5h1.5M5 10h1.5M5 14.5h1.5M9 5.5h6M9 10h6M9 14.5h6',
    sessions: 'M10 3.5v4M10 7.5H5.5v3.5M10 7.5h4.5v3.5M3.5 11h4v4.5h-4zM12.5 11h4v4.5h-4z',
    timeline: 'M10 5.5v4.5l3 2M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
    changes: 'M6 3.5h5.5L15 7v9.5H6zM11 3.5V7h4M8.5 11h4M10.5 9v4',
    pending: 'M3.5 11.5l2-7h9l2 7v4h-13zM3.5 11.5h3.5l1 2h4l1-2h3.5',
    runtime: 'M3 10h3l2-5 3.5 10 2-5H17',
    raw: 'M7 6.5L3.5 10 7 13.5M13 6.5l3.5 3.5-3.5 3.5M11 5l-2 10',
    memory: 'M10 3.5l6 6.5-6 6.5L4 10z',
    board: 'M3.5 4.5h13v11h-13zM3.5 8.5h13M8.5 8.5v7',
  };
  const icon = (name) => `<svg class="pk-mb-ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
  const SLOTS = [
    {id: 'plan', en: 'Score', title: '计划', note: '这件事拆成的步骤，做到哪一步、哪一步卡住。', source: 'pinkie.metre.board → plan'},
    {id: 'sessions', en: 'Parts', title: '子会话', wide: true, note: '一行一个：标题、模型、状态、用了多久、此刻在做什么、用量；可以打开、停止、发消息。', source: 'pinkie.metre.board → sessions'},
    {id: 'pending', en: 'Cues', title: '待你处理', note: '等你回答的问题和等你点的确认。有内容时标题上出数字。', source: 'pinkie.metre.board → pending'},
    {id: 'timeline', en: 'Bars', title: '时间线', note: '派发、汇报、打回、验收、出错、叫停，新的在上。', source: 'pinkie.metre.board → timeline'},
    {id: 'changes', en: 'Revisions', title: '改动', note: '这一家子会话动过的文件，按会话分组，点开在工作台里看。', source: 'pinkie.metre.board → changes'},
    {id: 'runtime', en: 'Tempo', title: '运行环境', note: '网关连接、在用模型的健康状态、最近的上游错误、上下文和累计用量。', source: 'pinkie.metre.board → runtime'},
    {id: 'memory', en: 'Repertoire', title: '项目记忆', wide: true, note: '当前文件夹记住了什么：按类别分组，可钉住、编辑、删除、搜索。', source: 'pinkie.metre.memory（接口已有，面板没接）'},
    {id: 'raw', en: 'Log', title: '原始记录', note: '后端事件流水，排查问题用，默认收起。', source: 'pinkie.metre.board → raw'},
  ];
  const STATS = [
    {id: 'state', label: '当前状态'},
    {id: 'elapsed', label: '已用时间'},
    {id: 'running', label: '在跑 / 上限'},
    {id: 'returned', label: '已交回 · 失败'},
  ];

  const h = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };
  let page = null;
  let lastFocus = null;

  function placeholder(slot) {
    const body = h('div', 'pk-metre-board__body is-placeholder', ART[slot.id]());
    body.append(h('p', 'pk-metre-board__note', slot.note));
    return body;
  }
  function build() {
    page = h('section', 'pk-metre-board');
    page.id = 'pk-metre-board';
    page.setAttribute('role', 'region');
    page.setAttribute('aria-label', '总控台');
    page.hidden = true;
    page.tabIndex = -1;

    const head = h('header', 'pk-metre-board__head');
    const title = h('div', 'pk-metre-board__title', `<h2><svg class="pk-metre-board__beat" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 3.5v13M8.5 8v8.5M12.5 8v8.5M16.5 8v8.5"/></svg>总控台</h2><p>页面骨架，数据还没接：每个区块里是示意图，不是这次运行的真实情况。</p>`);
    const actions = h('div', 'pk-metre-board__actions');
    for (const [id, text] of [['pause', '暂停派发'], ['stop', '全部停下']]) {
      const btn = h('button', `pk-metre-board__btn pk-metre-board__btn--${id}`, text);
      btn.type = 'button'; btn.disabled = true; btn.dataset.metreAction = id; btn.title = '待接入：接上派发接口后可用';
      actions.append(btn);
    }
    const close = h('button', 'pk-metre-board__close', `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`);
    close.type = 'button'; close.title = '回到对话（Esc）'; close.setAttribute('aria-label', '关闭总控台');
    close.addEventListener('click', () => api.close());
    actions.append(close);
    head.append(title, actions);

    const stats = h('div', 'pk-metre-board__stats');
    stats.dataset.metreSlot = 'overview';
    for (const stat of STATS) {
      // 「在跑 / 上限」写成拍号的样子：上下两个数。
      const value = stat.id === 'running'
        ? `<strong class="pk-metre-board__stat-value pk-metre-board__sig" data-metre-stat="running"><b>—</b><b>—</b></strong>`
        : `<strong class="pk-metre-board__stat-value" data-metre-stat="${stat.id}">—</strong>`;
      const tile = h('div', 'pk-metre-board__stat', `<span class="pk-metre-board__stat-label">${stat.label}</span>${value}`);
      stats.append(tile);
    }

    const grid = h('div', 'pk-metre-board__grid');
    for (const slot of SLOTS) {
      const card = h('article', 'pk-metre-board__card' + (slot.wide ? ' pk-metre-board__card--wide' : ''));
      card.dataset.metreSlot = slot.id;
      card.dataset.metreState = 'placeholder';
      card.id = 'pk-metre-board-' + slot.id;
      card.append(h('header', 'pk-metre-board__card-head', `${icon(slot.id)}<h3>${slot.title}</h3><span class="pk-metre-board__en" aria-hidden="true">${slot.en}</span><span class="pk-metre-board__tag" title="数据来源：${slot.source}">待接入</span>`));
      card.append(placeholder(slot));
      grid.append(card);
    }
    const scroll = h('div', 'pk-metre-board__scroll');
    scroll.append(stats, grid);
    page.append(head, scroll);
    document.body.append(page);
  }
  // 贴着侧栏右边铺满内容区；侧栏收起或窄窗口时铺满整个窗口。
  function place() {
    if (!page || page.hidden) return;
    const nav = document.querySelector('.shell-nav');
    const rect = nav?.getBoundingClientRect();
    const left = rect && rect.width > 40 && rect.right < window.innerWidth * 0.6 ? Math.round(rect.right) : 0;
    page.style.left = left + 'px';
  }
  const card = (id) => page?.querySelector(`.pk-metre-board__card[data-metre-slot="${id}"]`);

  const api = {
    slots: SLOTS.map((slot) => slot.id),
    get isOpen() { return Boolean(page && !page.hidden); },
    open(section) {
      if (!isMetre()) return false;
      if (!page) build();
      if (page.hidden) lastFocus = document.activeElement;
      page.hidden = false;
      root.setAttribute('data-metre-board', 'open');
      place();
      const target = section && card(section);
      const scroll = page.querySelector('.pk-metre-board__scroll');
      if (target) { scroll.scrollTop = Math.max(0, target.offsetTop - scroll.offsetTop - 12); target.classList.add('is-target'); setTimeout(() => target.classList.remove('is-target'), 1600); }
      else scroll.scrollTop = 0;
      page.focus({preventScroll: true});
      return true;
    },
    close() {
      if (!page || page.hidden) return;
      page.hidden = true;
      root.removeAttribute('data-metre-board');
      lastFocus?.focus?.({preventScroll: true});
    },
    toggle(section) { return api.isOpen ? (api.close(), false) : api.open(section); },
    fill(id, node) {
      if (!page) build();
      const host = card(id);
      if (!host || !node) return false;
      const body = h('div', 'pk-metre-board__body');
      body.append(node);
      host.querySelector('.pk-metre-board__body').replaceWith(body);
      host.dataset.metreState = 'live';
      return true;
    },
    reset(id) {
      const host = card(id);
      const slot = SLOTS.find((item) => item.id === id);
      if (!host || !slot) return false;
      host.querySelector('.pk-metre-board__body').replaceWith(placeholder(slot));
      host.dataset.metreState = 'placeholder';
      return true;
    },
    setStat(id, text) {
      if (!page) build();
      const node = page.querySelector(`[data-metre-stat="${id}"]`);
      const value = text == null || text === '' ? '—' : String(text);
      if (node && id === 'running') {
        // 'n/上限'：拆成上下两个数
        const [top, bottom = '—'] = value.split('/').map((part) => part.trim());
        node.replaceChildren(...[top || '—', bottom || '—'].map((part) => { const b = document.createElement('b'); b.textContent = part; return b; }));
      } else if (node) node.textContent = value;
      return Boolean(node);
    },
    enableActions(handlers = {}) {
      if (!page) build();
      for (const btn of page.querySelectorAll('[data-metre-action]')) {
        const fn = handlers[btn.dataset.metreAction];
        btn.disabled = typeof fn !== 'function';
        btn.onclick = btn.disabled ? null : () => fn(btn);
        btn.title = btn.disabled ? '待接入：接上派发接口后可用' : '';
      }
    },
  };

  // ---------- 入口：侧栏一行、首页三张卡片 ----------
  function sidebarEntry() {
    const controls = document.querySelector('aside.sidebar .laolao-session-controls');
    if (!controls || controls.querySelector('.pk-metre-nav--board')) return;
    const btn = h('button', 'pinkie-sidebar-entry pk-metre-nav pk-metre-nav--board', '<span>总控台</span>');
    btn.type = 'button'; btn.title = '总控台：计划、子会话、时间线、改动、运行环境、项目记忆';
    btn.addEventListener('click', () => api.toggle());
    controls.append(btn);
  }
  const HOME_CARDS = [
    {slot: '', art: 'sessions', title: '总控台', text: '计划、子会话、时间线'},
    {slot: 'memory', art: 'memory', title: '项目记忆', text: '这个文件夹记住了什么'},
    {slot: 'runtime', art: 'runtime', title: '运行环境', text: '连接、模型、用量'},
  ];
  function homeCards() {
    const recent = document.querySelector('.laolao-startup-home__recent');
    const home = document.querySelector('.laolao-startup-home');
    const anchor = recent || home;
    if (!anchor || !root.hasAttribute('data-laolao-startup-home')) return;
    const parent = recent ? recent.parentElement : home;
    let row = parent.querySelector(':scope > .pk-metre-quick');
    if (!row) {
      row = h('div', 'pk-metre-quick');
      row.append(h('h3', 'pk-metre-quick__label', '看板'));
      const list = h('div', 'pk-metre-quick__list');
      for (const item of HOME_CARDS) {
        const btn = h('button', 'pk-metre-quick__card', `<span class="pk-metre-quick__art">${ART[item.art]()}</span><span class="pk-metre-quick__title">${item.title}</span><span class="pk-metre-quick__text">${item.text}</span>`);
        btn.type = 'button';
        btn.addEventListener('click', () => api.open(item.slot));
        list.append(btn);
      }
      row.append(list);
      // 首页排好以后让状态条（猫）重新量一次输入框的位置：它只在窗口或输入框变大小时才量，引导语出现把输入框往下推不算。
      setTimeout(() => window.dispatchEvent(new Event('resize')), 400);
    }
    if (recent) { if (row.nextElementSibling !== recent) parent.insertBefore(row, recent); }
    else if (row.parentElement !== parent) parent.append(row);
  }
  let queued = false;
  function sync() {
    queued = false;
    if (!isMetre()) { if (api.isOpen) api.close(); return; }
    sidebarEntry();
    homeCards();
    place();
  }
  const queue = () => { if (!queued) { queued = true; setTimeout(sync, 120); } };

  function start() {
    // 侧栏的入口区每次重画都会清空；首页是整块换掉的。只看这两处所在的外壳，不看聊天区。
    const shell = document.querySelector('.shell') || document.body;
    new MutationObserver((records) => {
      if (!isMetre()) return;
      if (records.some((r) => !(r.target instanceof Element) || !r.target.closest('.chat-thread, .pk-metre-board, .pk-metre-quick'))) queue();
    }).observe(shell, {childList: true, subtree: true});
    new MutationObserver(queue).observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-laolao-startup-home']});
    window.addEventListener('resize', queue);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && api.isOpen) { event.stopPropagation(); api.close(); } }, true);
    // 点了侧栏里别的东西（开会话、新会话）就回到对话。
    document.addEventListener('click', (event) => {
      if (!api.isOpen) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('aside.sidebar') && !target.closest('.pk-metre-nav--board, .laolao-mode-switcher, .laolao-mode-menu')) api.close();
    }, true);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();

  window.__pinkieMetreBoard = api;
})();
