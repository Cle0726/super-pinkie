/* laolao-metre-board —— Metre 总控台的页面骨架（PLAN 2.12、6.2 第 9 区；批 5 的前半）
 *
 * 这份文件只做「页面长什么样」；数据由 laolao-metre-board-data.js（批 5）接，接上后示例整块换掉。
 * 没接上之前每个区块里是一份版式示例，右上角标着「示例 · 待接入」，页面顶上有一条说明；不是真数据。
 * 摆放（11-15 用户：「不喜欢全屏，看不到 Metre 的流式输出」）：停在窗口右边，对话区让出这块宽度；
 * 左边沿可拖宽度（记在本机），内容区放不下「对话 520 + 面板 400」时退成浮层。
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

  // ---------- 示例内容（版式示例，不是真数据；颜色全走样式表里的变量） ----------
  // 每个区块在后端接上之前先放一份「示例」：真实的字、真实的图形，让人看得出接好以后长什么样。
  // 页面顶上有一条说明，每张卡片右上角标着「示例 · 待接入」。接好后 fill() 会把它整块换掉。
  const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
  const svg = (w, h, body, cls = '') => `<svg class="pk-mb-svg ${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="示意图，数据待接入" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
  const STATE_TEXT = {done: '已交回', run: '在跑', fail: '打回', wait: '排队'};
  const SAMPLE = {
    // 计划：一列步骤，做完的打勾，正在做的一格黄铜色，后面的空心。
    plan: () => `<ol class="pk-mb-steps">${[
      ['done', '读懂需求，拆成三块', '2 分'], ['done', '搭页面骨架', '6 分'], ['run', '整理资料摘要', '进行中'],
      ['wait', '定命名方案', ''], ['wait', '合并、验收、汇报', ''],
    ].map(([state, text, meta]) => `<li data-state="${state}"><i aria-hidden="true"></i><span>${text}</span><em>${meta}</em></li>`).join('')}</ol>`,
    // 子会话画成一页总谱：一行一个声部（子会话），横向是时间，竖线是小节线，黄铜色竖线是「现在」。
    sessions: () => {
      const rows = [
        ['页面骨架', '项目模式', 'done', '6:10', [[2, 30, 'done'], [35, 12, 'done']]],
        ['资料摘要', '学习模式', 'run', '5:02', [[8, 20, 'done'], [32, 36, 'run']]],
        ['命名方案', '想法模式', 'fail', '4:40', [[14, 17, 'done'], [34, 9, 'fail'], [47, 21, 'run']]],
        ['合并验收', 'Metre', 'wait', '—', [[74, 18, 'wait']]],
      ];
      const ticks = ['0:00', '2:00', '4:00', '6:00', '8:00'];
      return `<div class="pk-mb-score">
        <div class="pk-mb-score__ruler"><span></span><div>${ticks.map((t) => `<b>${t}</b>`).join('')}</div><span></span></div>
        ${rows.map(([name, mode, state, time, blocks]) => `<div class="pk-mb-score__row" data-state="${state}">
          <div class="pk-mb-score__part"><strong>${name}</strong><small>${mode}</small></div>
          <div class="pk-mb-score__track">${blocks.map(([x, w, s]) => `<i data-state="${s}" style="left:${x}%;width:${w}%"></i>`).join('')}</div>
          <div class="pk-mb-score__meta"><span class="pk-mb-chip" data-state="${state}">${STATE_TEXT[state]}</span><time>${time}</time></div>
        </div>`).join('')}
        <div class="pk-mb-score__now" aria-hidden="true"><i style="left:68%"></i></div>
      </div>
      <div class="pk-mb-legend">${Object.entries(STATE_TEXT).map(([s, t]) => `<span><i data-state="${s}"></i>${t === '打回' ? '出错 / 打回' : t}</span>`).join('')}<span class="pk-mb-legend__now"><i></i>现在</span></div>`;
    },
    pending: () => `<div class="pk-mb-cues">
      <div class="pk-mb-cue"><small>命名方案 · 等你回答</small><p>界面上的 Baton 要不要配一个中文名？</p><div class="pk-mb-cue__opts"><span>保留英文</span><span>加中文</span><span>你定</span></div></div>
      <div class="pk-mb-cue"><small>页面骨架 · 等你确认</small><p>骨架搭好了，要先看一眼再往下做吗？</p><div class="pk-mb-cue__opts"><span data-primary>打开看看</span><span>直接继续</span></div></div>
    </div>`,
    timeline: () => `<ol class="pk-mb-events">${[
      ['14:32', 'run', '派发', '「资料摘要」交给学习模式'], ['14:30', 'fail', '打回', '「命名方案」少了第三项'],
      ['14:27', 'done', '汇报', '「页面骨架」已交回，等验收'], ['14:21', 'run', '派发', '三块同时开始'], ['14:20', 'wait', '读懂', '目标一项、要求四项'],
    ].map(([time, state, kind, text]) => `<li data-state="${state}"><time>${time}</time><i aria-hidden="true"></i><b>${kind}</b><span>${text}</span></li>`).join('')}</ol>`,
    changes: () => {
      const file = (name, add, del) => { const total = Math.max(add + del, 1), on = Math.round((add / total) * 5); return `<li><span>${esc(name)}</span><em class="add">+${add}</em><em class="del">−${del}</em><u aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < on ? 'add' : 'del'}"></i>`).join('')}</u></li>`; };
      return `<div class="pk-mb-files">
        <h4>页面骨架<small>2 个文件</small></h4><ul>${file('src/pages/home.tsx', 84, 12)}${file('src/styles/home.css', 41, 3)}</ul>
        <h4>资料摘要<small>1 个文件</small></h4><ul>${file('notes/summary.md', 126, 0)}</ul>
      </div>`;
    },
    runtime: () => {
      const C = 2 * Math.PI * 34;
      const pts = [22, 30, 18, 26, 14, 20, 34, 16, 12, 22, 10, 18, 14];
      const line = pts.map((y, i) => `${i ? 'L' : 'M'}${(i * (200 / (pts.length - 1))).toFixed(1)} ${y + 6}`).join(' ');
      return `<div class="pk-mb-tempo">
        <div class="pk-mb-gauge">${svg(92, 92, `<circle class="ring" cx="46" cy="46" r="34"/><circle class="ring-a" cx="46" cy="46" r="34" stroke-dasharray="${(C * 0.38).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 46 46)"/>`)}<div><strong>38%</strong><small>上下文</small></div></div>
        <div class="pk-mb-spark"><div><small>网关延迟</small><strong>412 ms</strong></div>${svg(200, 52, `<path class="grid" d="M0 12h200M0 30h200M0 48h200"/><path class="area" d="${line} L200 52 L0 52 Z"/><path class="spark" d="${line}"/><circle class="dot" cx="200" cy="${pts[pts.length - 1] + 6}" r="3"/>`, 'pk-mb-svg--fill')}</div>
      </div>
      <ul class="pk-mb-health"><li data-state="done"><i></i><span>网关</span><em>已连接</em></li><li data-state="done"><i></i><span>主模型</span><em>正常</em></li><li data-state="fail"><i></i><span>执行模型</span><em>刚才超时 1 次</em></li></ul>`;
    },
    memory: () => {
      const cats = [['约定', 12, 'v1'], ['结构', 9, 'v2'], ['决定', 7, 'v3'], ['待办', 4, 'v4'], ['偏好', 3, 'v5']];
      const max = cats[0][1];
      return `<div class="pk-mb-memory">
        <div class="pk-mb-memory__cats"><div class="pk-mb-memory__folder"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5h5l1.5 2H17v8.5H3z"/></svg>示例项目<small>35 条</small></div>
          ${cats.map(([name, n, v]) => `<div class="pk-mb-bar"><span>${name}</span><u><i data-v="${v}" style="width:${Math.round((n / max) * 100)}%"></i></u><em>${n}</em></div>`).join('')}</div>
        <ul class="pk-mb-memory__list">${[
          ['约定', 'v1', '提交前先跑一遍测试，红了不提交', true], ['结构', 'v2', '页面在 src/pages，样式和页面同名', false],
          ['决定', 'v3', '首页先不做登录，放到下一期', false], ['待办', 'v4', '命名方案还差第三项', false],
        ].map(([cat, v, text, pin]) => `<li><b data-v="${v}">${cat}</b><span>${text}</span>${pin ? '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="已钉住"><path d="M10 12.5V17M6.5 12.5h7l-1-6h-5z"/><path d="M7 3.5h6"/></svg>' : ''}</li>`).join('')}</ul>
      </div>`;
    },
    raw: () => `<pre class="pk-mb-log">${[
      ['14:32:07', 'dispatch', 'part=资料摘要 mode=learning'], ['14:30:41', 'reject', 'part=命名方案 missing=3'],
      ['14:27:19', 'report', 'part=页面骨架 files=2'], ['14:21:02', 'dispatch', 'parts=3'], ['14:20:15', 'read', 'goals=1 asks=4'],
    ].map(([t, k, v]) => `<span><time>${t}</time> <b>${k}</b> ${esc(v)}</span>`).join('\n')}</pre>`,
  };
  // 首页三张卡片上的小图：抽象的图形，没有字和数字。
  const MINI = {
    sessions: () => {
      const lanes = [[[0, 70, 'v2'], [78, 34, 'v2']], [[18, 46, 'v2'], [72, 86, 'v1']], [[34, 40, 'v2'], [80, 22, 'v4'], [108, 50, 'v1']], [[150, 44, 'q']]];
      let out = '';
      for (let x = 40; x <= 220; x += 45) out += `<path class="grid" d="M${x} 4v72"/>`;
      lanes.forEach((blocks, i) => { for (const [x, w, c] of blocks) out += `<rect class="${c}" x="${16 + x}" y="${10 + i * 17}" width="${w}" height="9" rx="3"/>`; });
      return svg(240, 80, out + `<path class="now" d="M178 2v76"/>`);
    },
    memory: () => svg(240, 80, [[150, 'v1'], [112, 'v2'], [86, 'v3'], [50, 'v4']].map(([w, c], i) => `<rect class="track" x="52" y="${12 + i * 16}" width="172" height="8" rx="4"/><rect class="${c}" x="52" y="${12 + i * 16}" width="${w}" height="8" rx="4"/><rect class="q" x="16" y="${12 + i * 16}" width="26" height="8" rx="4"/>`).join('')),
    runtime: () => {
      const C = 2 * Math.PI * 24;
      return svg(240, 80, `<circle class="ring" cx="48" cy="40" r="24"/><circle class="ring-a" cx="48" cy="40" r="24" stroke-dasharray="${(C * 0.38).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 48 40)"/>`
        + `<path class="grid" d="M100 20h124M100 40h124M100 60h124"/><path class="spark" d="M100 50l12-8 12 6 12-20 12 12 12-16 12 8 12-18 12 12 12-6 4 2"/><circle class="dot" cx="224" cy="32" r="3"/>`);
    },
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
    {id: 'state', label: '当前状态', hint: '派发中 · 等你 · 已停'},
    {id: 'elapsed', label: '已用时间', hint: '从第一次派发算起'},
    {id: 'running', label: '在跑 / 上限', hint: '同时在跑的子会话'},
    {id: 'returned', label: '已交回 · 失败', hint: '验收过的和出错的'},
  ];

  const h = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };
  let page = null;
  let lastFocus = null;

  function placeholder(slot) {
    const body = h('div', 'pk-metre-board__body is-placeholder');
    const sample = h('div', 'pk-metre-board__sample', SAMPLE[slot.id]());
    sample.setAttribute('aria-label', '版式示例，不是真实数据');
    body.append(sample, h('p', 'pk-metre-board__note', slot.note));
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
    // 标题前是 Metre 的标志（laolao-metre-brand.js，先于本文件加载）；没有就退回拍号记号。
    const logo = window.__pinkieMetreBrand?.mark({title: ''}) || `<svg class="pk-metre-board__beat" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 3.5v13M8.5 8v8.5M12.5 8v8.5M16.5 8v8.5"/></svg>`;
    const title = h('div', 'pk-metre-board__title', `<h2><span class="pk-metre-board__beat">${logo}</span>总控台</h2><p>一次派发的全貌：计划、每个子会话、等你处理的事、改动和运行环境。</p>`);
    const actions = h('div', 'pk-metre-board__actions');
    for (const [id, text] of [['pause', '暂停派发'], ['stop', '全部停下']]) {
      const btn = h('button', `pk-metre-board__btn pk-metre-board__btn--${id}`, text);
      btn.type = 'button'; btn.disabled = true; btn.dataset.metreAction = id; btn.title = '待接入：接上派发接口后可用';
      actions.append(btn);
    }
    const close = h('button', 'pk-metre-board__close', `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`);
    close.type = 'button'; close.title = '收起总控台'; close.setAttribute('aria-label', '关闭总控台');
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
      const tile = h('div', 'pk-metre-board__stat', `<span class="pk-metre-board__stat-label">${stat.label}</span>${value}<span class="pk-metre-board__stat-hint">${stat.hint}</span>`);
      stats.append(tile);
    }

    const grid = h('div', 'pk-metre-board__grid');
    for (const slot of SLOTS) {
      const card = h('article', 'pk-metre-board__card' + (slot.wide ? ' pk-metre-board__card--wide' : ''));
      card.dataset.metreSlot = slot.id;
      card.dataset.metreState = 'placeholder';
      card.id = 'pk-metre-board-' + slot.id;
      card.append(h('header', 'pk-metre-board__card-head', `${icon(slot.id)}<h3>${slot.title}</h3><span class="pk-metre-board__en" aria-hidden="true">${slot.en}</span><span class="pk-metre-board__tag" title="数据来源：${slot.source}">示例 · 待接入</span>`));
      card.append(placeholder(slot));
      grid.append(card);
    }
    const notice = h('p', 'pk-metre-board__notice', '<b>示例</b>数据还没接：下面每一块是接好以后的样子，里面的字和数字是示例，不是这次运行的真实情况。');
    notice.setAttribute('role', 'note');
    const scroll = h('div', 'pk-metre-board__scroll');
    scroll.append(notice, stats, grid);
    // 左边沿的拖条：拖动改宽度，双击回到默认宽度；宽度记在本机。
    const grip = h('div', 'pk-metre-board__grip');
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('aria-label', '拖动调整总控台宽度');
    grip.title = '拖动调整宽度，双击恢复默认';
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !page.classList.contains('is-docked')) return;
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      page.classList.add('is-resizing');
      const move = (ev) => { savedWidth = Math.round(window.innerWidth - ev.clientX); place(); };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        page.classList.remove('is-resizing');
        try { localStorage.setItem(WIDTH_KEY, String(savedWidth)); } catch { /* 存不了就只管这一次 */ }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, {once: true});
      grip.addEventListener('pointercancel', up, {once: true});
    });
    grip.addEventListener('dblclick', () => { savedWidth = 0; try { localStorage.removeItem(WIDTH_KEY); } catch {} place(); });
    page.append(grip, head, scroll);
    document.body.append(page);
  }
  // 停在右边：对话区让出这块宽度，Metre 的流式输出照常看得见；左边沿可以拖宽拖窄。
  // 内容区太窄（放不下「对话至少 CHAT_MIN + 面板至少 PANEL_MIN」）时退成盖住内容区的浮层。
  const WIDTH_KEY = 'pk.metre.board.width';
  const PANEL_MIN = 400;
  const CHAT_MIN = 520;
  let savedWidth = 0;
  try { savedWidth = Number(localStorage.getItem(WIDTH_KEY)) || 0; } catch { /* 读不到就用默认宽度 */ }
  // 值没变就不写：总控台数据层监听这个属性，写一次就重读一次。
  const setMode = (value) => { if (root.getAttribute('data-metre-board') !== value) root.setAttribute('data-metre-board', value); };
  function place() {
    if (!page || page.hidden) return;
    const nav = document.querySelector('.shell-nav');
    const rect = nav?.getBoundingClientRect();
    const left = rect && rect.width > 40 && rect.right < window.innerWidth * 0.6 ? Math.round(rect.right) : 0;
    const room = window.innerWidth - left;
    if (room < PANEL_MIN + CHAT_MIN) {
      page.classList.remove('is-docked');
      page.classList.add('is-overlay');
      page.style.left = left + 'px';
      page.style.width = '';
      // 浮层停在输入框上面，不挡输入（A5-8）。
      const input = document.querySelector('.agent-chat__input');
      const box = input && input.getClientRects().length ? input.getBoundingClientRect() : null;
      page.style.bottom = box && box.top > window.innerHeight * 0.4 ? Math.round(window.innerHeight - box.top + 8) + 'px' : '';
      setMode('overlay');
      root.style.removeProperty('--metre-board-w');
      return;
    }
    const preferred = savedWidth || Math.round(room * 0.42);
    const width = Math.max(PANEL_MIN, Math.min(preferred, room - CHAT_MIN, 900));
    page.classList.remove('is-overlay');
    page.classList.add('is-docked');
    page.style.left = 'auto';
    page.style.bottom = '';
    page.style.width = width + 'px';
    setMode('dock');
    root.style.setProperty('--metre-board-w', width + 'px');
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
      place();
      const target = section && card(section);
      const scroll = page.querySelector('.pk-metre-board__scroll');
      if (target) { scroll.scrollTop = Math.max(0, target.offsetTop - scroll.offsetTop - 12); target.classList.add('is-target'); setTimeout(() => target.classList.remove('is-target'), 1600); }
      else scroll.scrollTop = 0;
      // 停靠时不抢输入框的焦点：用户可能正在打字或看流式输出。浮层时才把焦点给面板。
      if (page.classList.contains('is-overlay')) page.focus({preventScroll: true});
      return true;
    },
    close() {
      if (!page || page.hidden) return;
      const hadFocus = page.contains(document.activeElement);
      page.hidden = true;
      root.removeAttribute('data-metre-board');
      root.style.removeProperty('--metre-board-w');
      if (hadFocus) lastFocus?.focus?.({preventScroll: true});
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
      const label = h('h3', 'pk-metre-quick__label', '<span>看板</span>');
      const all = h('button', 'pk-metre-quick__all', '打开总控台');
      all.type = 'button';
      all.addEventListener('click', () => api.open());
      label.append(all);
      row.append(label);
      const list = h('div', 'pk-metre-quick__list');
      for (const item of HOME_CARDS) {
        const btn = h('button', 'pk-metre-quick__card', `<span class="pk-metre-quick__art">${MINI[item.art]()}</span><span class="pk-metre-quick__title">${item.title}</span><span class="pk-metre-quick__text">${item.text}</span>`);
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
    // Esc 只在焦点在面板里、或面板是浮层时关：停靠时 Esc 留给对话（比如停止生成）。
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !api.isOpen) return;
      if (!page.classList.contains('is-overlay') && !page.contains(document.activeElement)) return;
      event.stopPropagation(); api.close();
    }, true);
    // 浮层时点了侧栏里别的东西（开会话、新会话）就回到对话；停靠时面板留着，跟着切过去的会话走。
    document.addEventListener('click', (event) => {
      if (!api.isOpen || !page.classList.contains('is-overlay')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('aside.sidebar') && !target.closest('.pk-metre-nav--board, .laolao-mode-switcher, .laolao-mode-menu')) api.close();
    }, true);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();

  window.__pinkieMetreBoard = api;
})();
