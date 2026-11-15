/* laolao-metre-board-data —— 把 Metre 总控台的九块接上真数据（批 5，BOARD-HANDOFF.md）。
 *
 * 骨架（laolao-metre-board.js）只管页面；这里只管请求和渲染：
 *   - 数据：`pinkie.metre.board {sessionKey}` 一次拿齐八块；项目记忆读 `pinkie.metre.memory`。
 *   - 刷新：总控台开着时，`pinkie:gateway-event` 来了就刷，每秒最多一次。关着时不拉整份数据，
 *     只在「有人提问 / 一轮结束 / 会话变了」这几种事件后（最多 5 秒一次）读一次待处理数，给侧栏入口出数字。
 *   - 看门狗（11-15 用户：「不要后端挂了前端还在转」）：有东西在跑时，20 秒没刷过就主动读一次——
 *     读不到就是断线；读到了也会把「在跑但 90 秒没动静」的子会话 / Metre 标出来（上游重试、卡住）。什么都没在跑时不发请求。
 *   - 慢：读一次等过 8 秒顶上说「回得慢（已等 N 秒），下面是 M 秒前的数据」；等满 45 秒算「没回话」，按断线处理。
 *   - 断线：连接一断（laolao-sidebar 的 pinkie:sidebar-gateway-lost）或读失败，顶上换成「连接断了，正在重连」，
 *     各块保留上一次的数据并变灰，「在跑」改成「断线前在跑」，不显示成还在跑、也不显示成做完；连上后再读一次。
 *   - 按钮：暂停派发 ↔ 继续派发（pinkie.metre.pause）；全部停下（pinkie.metre.stopAll）→ 停完变成「接着做」（pinkie.metre.resume）。 */
(() => {
  'use strict';
  if (window.__pinkieMetreBoardData) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const board = () => window.__pinkieMetreBoard;
  const rpc = (method, params, timeout = 8000) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, timeout) : Promise.reject(new Error('offline'));
  const sessionKey = () => {
    try { const key = new URL(location.href).searchParams.get('session') || ''; return /^agent:metre:/.test(key) ? key : ''; }
    catch { return ''; }
  };
  const esc = (text) => String(text ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
  const h = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };
  const clock = (at) => { if (!at) return '—'; const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const clockSec = (at) => { const d = new Date(at); return `${clock(at)}:${String(d.getSeconds()).padStart(2, '0')}`; };
  const span = (ms) => {
    if (!(ms > 0)) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
  };
  const tokens = (n) => !(n > 0) ? '0' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  const empty = (text) => h('p', 'pk-mb-empty', esc(text));
  const KIND = {dispatch: ['派发', 'run'], report: ['汇报', 'done'], end: ['跑完', 'done'], error: ['出错', 'fail'], stop: ['叫停', 'wait'], memory: ['记忆', 'done'], message: ['消息', 'wait']};
  // 柱状图左边的短名（两个字，放得下）；完整的类别名在悬停提示里。
  const MEMORY_CATS = {overview: '概况', structure: '结构', commands: '命令', conventions: '规矩', decisions: '决定',
    preferences: '偏好', pitfalls: '踩坑', people: '协作', open: '待办'};
  const MEMORY_FULL = {overview: '项目概况', structure: '目录和关键文件', commands: '怎么跑、测、打包', conventions: '规矩', decisions: '定下的事',
    preferences: '偏好', pitfalls: '踩过的坑', people: '协作者', open: '没做完的'};

  let data = null;          // 上一次成功拿到的整份数据
  let stale = false;
  let lastAt = 0;
  let pendingTimer = 0;
  let inflight = false;
  let again = false;
  let badgeAt = 0;
  let memoryQuery = '';
  let watchTimer = 0;
  let slowTimer = 0;
  let dataAt = 0;            // 上一次成功读到数据的本机时间
  const RPC_MS = 45_000;     // 读总控台最多等这么久，过了算后端没回话
  const SLOW_MS = 8_000;     // 等过这么久就提示「回得慢」
  const QUIET_MS = 90_000;   // 在跑的会话超过这么久没动静，就标「没动静」
  const WATCH_MS = 20_000;   // 有东西在跑时，最多隔这么久主动读一次

  // ---------- 各块 ----------
  function planNode(plan) {
    if (!plan?.items?.length) return empty('Metre 还没列计划（三步以上的活它会先列一张清单）。');
    const list = h('ol', 'pk-mb-steps');
    for (const item of plan.items) {
      const state = {done: 'done', active: 'run', pending: 'wait', blocked: 'fail'}[item.status] || 'wait';
      const meta = {done: '做完', active: '进行中', pending: '', blocked: '卡住', 'stale-active': '断线前在做', 'idle-active': '停在这一步'}[item.status] || '';
      list.append(h('li', '', `<i aria-hidden="true"></i><span>${esc(item.text)}</span><em>${meta}</em>`));
      list.lastChild.dataset.state = state;
    }
    const wrap = h('div', '');
    if (plan.title) wrap.append(h('p', 'pk-mb-sub', esc(plan.title)));
    wrap.append(list);
    return wrap;
  }

  function sessionsNode(sessions, now) {
    if (!sessions.length) return empty('还没有子会话。Metre 派活以后，每个子会话在这里占一行。');
    const from = Math.min(...sessions.map((s) => s.spans[0]?.from || s.startedAt || now));
    const total = Math.max(60_000, now - from);
    const pct = (t) => Math.max(0, Math.min(100, ((t - from) / total) * 100));
    const score = h('div', 'pk-mb-score');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<b>${span(total * f) === '—' ? '0' : span(total * f)}</b>`).join('');
    score.append(h('div', 'pk-mb-score__ruler', `<span></span><div>${ticks}</div><span></span>`));
    for (const s of sessions) {
      const row = h('div', 'pk-mb-score__row');
      row.dataset.state = s.state;
      const part = h('div', 'pk-mb-score__part', `<strong title="${esc(s.title)}">${esc(s.title)}</strong><small>${esc([s.modeName, s.model].filter(Boolean).join(' · '))}</small>`);
      const track = h('div', 'pk-mb-score__track');
      for (const sp of s.spans) {
        const block = h('i');
        block.dataset.state = sp.kind === 'run' ? 'run' : sp.kind;
        block.style.left = pct(sp.from) + '%';
        block.style.width = Math.max(0.8, pct(sp.to) - pct(sp.from)) + '%';
        track.append(block);
      }
      const used = s.endedAt && s.startedAt ? s.endedAt - s.startedAt : s.startedAt ? now - s.startedAt : 0;
      const quiet = s.status === 'running' && s.lastActiveAt ? now - s.lastActiveAt : 0;
      const silent = quiet > QUIET_MS;
      const meta = h('div', 'pk-mb-score__meta', `<span class="pk-mb-chip" data-state="${silent ? 'wait' : s.state}">${esc(silent ? '没动静' : s.statusText)}</span><time>${span(used)}</time>`);
      const line = h('div', 'pk-mb-score__line');
      const bits = [];
      if (silent) bits.push(`<b class="pk-mb-fail">${span(quiet)} 没有动静：可能在重试或卡住，可以打开看看或停掉</b>`);
      else if (s.doing) bits.push(`在${esc(s.doing)}`);
      if (s.usage?.input || s.usage?.output) bits.push(`用量 ${tokens(s.usage.input)} 进 / ${tokens(s.usage.output)} 出`);
      else if (s.usage?.total) bits.push(`用量 ${tokens(s.usage.total)}`);
      if (s.error) bits.push(`<b class="pk-mb-fail">失败：${esc(s.error)}</b>`);
      line.innerHTML = `<span>${bits.join(' · ') || '&nbsp;'}</span>`;
      const acts = h('div', 'pk-mb-score__acts');
      const btn = (text, fn, title) => { const b = h('button', 'pk-mb-act', text); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); acts.append(b); return b; };
      btn('打开', () => window.__laolaoSidebar?.navigateSession?.(s.key));
      if (s.status === 'running') btn('停止', async (ev) => { ev.currentTarget.disabled = true; try { await rpc('chat.abort', {sessionKey: s.key, preserveSideRuns: false}, 12_000); } catch {} refreshSoon(); });
      btn('发消息', () => messageBox(row, s));
      line.append(acts);
      row.append(part, track, meta, line);
      score.append(row);
    }
    const now$ = h('div', 'pk-mb-score__now');
    now$.setAttribute('aria-hidden', 'true');
    now$.innerHTML = `<i style="left:${pct(now)}%"></i>`;
    score.append(now$);
    const wrap = h('div', 'pk-mb-scroll-x');
    wrap.append(score);
    const legend = h('div', 'pk-mb-legend', `${[['done', '做完'], ['run', '在跑'], ['fail', '出错'], ['wait', '排队 / 停下']].map(([s, t]) => `<span><i data-state="${s}"></i>${t}</span>`).join('')}<span class="pk-mb-legend__now"><i></i>现在</span>`);
    const out = h('div', '');
    out.append(wrap, legend);
    return out;
  }

  function messageBox(row, s) {
    if (row.querySelector('.pk-mb-msg')) return;
    const form = h('form', 'pk-mb-msg', `<input type="text" maxlength="2000" placeholder="发给「${esc(s.title)}」…" aria-label="发给子会话的消息"><button type="submit">发送</button>`);
    const input = form.querySelector('input');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      form.querySelector('button').disabled = true;
      try {
        await rpc('chat.send', {sessionKey: s.key, message: text, idempotencyKey: 'pinkie-board-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)}, 12_000);
        form.remove();
        refreshSoon();
      } catch { form.querySelector('button').disabled = false; input.setCustomValidity('没发出去，再试一次'); input.reportValidity(); }
    });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); form.remove(); } });
    row.append(form);
    input.focus();
  }

  function pendingNode(pending) {
    if (!pending.length) return empty('现在没有等你回答或确认的事。');
    const wrap = h('div', 'pk-mb-cues');
    for (const item of pending) {
      const cue = h('div', 'pk-mb-cue', `<small>${esc(item.title)} · ${item.kind === 'ask_user' ? '等你回答' : '等你确认'} · ${clock(item.askedAt)}</small><p>${esc(item.text)}</p>`);
      const opts = h('div', 'pk-mb-cue__opts');
      const go = h('button', 'pk-mb-act', '去回答');
      go.type = 'button'; go.dataset.primary = '';
      go.addEventListener('click', () => window.__laolaoSidebar?.navigateSession?.(item.sessionKey));
      opts.append(go);
      cue.append(opts);
      wrap.append(cue);
    }
    return wrap;
  }

  function timelineNode(timeline) {
    if (!timeline.length) return empty('还没有事情发生。');
    const list = h('ol', 'pk-mb-events');
    for (const item of timeline) {
      const [word, state] = KIND[item.kind] || [item.kind, 'wait'];
      const li = h('li', '', `<time>${clock(item.at)}</time><i aria-hidden="true"></i><b>${word}</b><span>${esc(item.text)}</span>`);
      li.dataset.state = state;
      list.append(li);
    }
    return list;
  }

  function changesNode(changes) {
    if (!changes.length) return empty('这一家子会话还没改过文件。');
    const wrap = h('div', 'pk-mb-files');
    for (const group of changes) {
      wrap.append(h('h4', '', `${esc(group.title)}<small>${group.files.length} 个文件</small>`));
      const list = h('ul', '');
      for (const file of group.files) {
        const total = Math.max(file.added + file.removed, 1), on = Math.round((file.added / total) * 5);
        const li = h('li', '', `<button type="button" class="pk-mb-file" title="在工作台里打开：${esc(file.path)}">${esc(file.path)}</button><em class="add">+${file.added}</em><em class="del">−${file.removed}</em><u aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < on ? 'add' : 'del'}"></i>`).join('')}</u>`);
        li.querySelector('button').addEventListener('click', () => { void window.__pinkieWorkbench?.open?.(file.path, {pinned: true}); });
        list.append(li);
      }
      wrap.append(list);
    }
    return wrap;
  }

  function runtimeNode(rt, overview) {
    const C = 2 * Math.PI * 34;
    const ratio = rt.context?.max ? Math.min(1, rt.context.used / rt.context.max) : 0;
    const pts = (rt.series || []).map(([, v]) => v);
    const max = Math.max(1, ...pts);
    const line = pts.length > 1 ? pts.map((v, i) => `${i ? 'L' : 'M'}${(i * (200 / (pts.length - 1))).toFixed(1)} ${(46 - (v / max) * 40).toFixed(1)}`).join(' ') : '';
    const svg = (w, hgt, body, cls = '') => `<svg class="pk-mb-svg ${cls}" viewBox="0 0 ${w} ${hgt}" role="img" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
    const wrap = h('div', '');
    wrap.append(h('div', 'pk-mb-tempo', `
      <div class="pk-mb-gauge">${svg(92, 92, `<circle class="ring" cx="46" cy="46" r="34"/><circle class="ring-a" cx="46" cy="46" r="34" stroke-dasharray="${(C * ratio).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 46 46)"/>`)}<div><strong>${rt.context?.max ? Math.round(ratio * 100) + '%' : '—'}</strong><small>上下文</small></div></div>
      <div class="pk-mb-spark"><div><small>这件事的用量</small><strong>${tokens((rt.usage?.input || 0) + (rt.usage?.output || 0))}</strong></div>${line ? svg(200, 52, `<path class="grid" d="M0 12h200M0 30h200M0 48h200"/><path class="area" d="${line} L200 52 L0 52 Z"/><path class="spark" d="${line}"/>`, 'pk-mb-svg--fill') : '<p class="pk-mb-empty">还没有用量记录</p>'}</div>`));
    const health = h('ul', 'pk-mb-health');
    const add = (state, name, text) => { const li = h('li', '', `<i></i><span>${esc(name)}</span><em>${esc(text)}</em>`); li.dataset.state = state; health.append(li); };
    add(stale ? 'fail' : 'done', '网关', stale ? '连接断了，正在重连' : '已连接');
    for (const m of rt.models || []) add(m.health === 'fail' ? 'fail' : m.health === 'ok' ? 'done' : 'wait', m.id, m.health === 'fail' ? `出错：${m.lastError || '原因没记下'}` : m.health === 'ok' ? '正常' : '还没调用过');
    add('wait', '派发上限', `在跑 ${overview.running} / ${overview.limit} · 这一轮已开 ${overview.started} / ${overview.cap}`);
    wrap.append(health);
    if (rt.errors?.length) {
      const errs = h('ul', 'pk-mb-errors');
      for (const e of rt.errors) errs.append(h('li', '', `<time>${clock(e.at)}</time> ${esc(e.text)}`));
      wrap.append(h('h4', 'pk-mb-sub', '最近的出错'), errs);
    }
    return wrap;
  }

  function rawNode(raw) {
    const details = h('details', 'pk-mb-raw');
    details.append(h('summary', '', `展开 ${raw.length} 条事件`));
    const pre = h('pre', 'pk-mb-log');
    pre.innerHTML = raw.slice().reverse().map((item) => `<span><time>${clockSec(item.at)}</time> <b>${esc(item.event)}</b> ${esc(Object.entries(item.data || {}).map(([k, v]) => `${k}=${v}`).join(' '))}</span>`).join('\n');
    details.append(pre);
    if (!raw.length) return empty('还没有事件。');
    return details;
  }

  // ---------- 项目记忆（第 9 区）：可钉住、编辑、删除、搜索 ----------
  async function memoryNode(key) {
    const params = memoryQuery ? {sessionKey: key, action: 'search', query: memoryQuery} : {sessionKey: key, action: 'list'};
    const [stats, listed] = await Promise.all([rpc('pinkie.metre.memory', {sessionKey: key, action: 'stats'}), rpc('pinkie.metre.memory', params)]);
    if (!stats || stats.ok === false) return empty(stats?.error || '项目记忆暂时读不到。');
    const items = listed?.items || [];
    const wrap = h('div', 'pk-mb-memory');
    const cats = h('div', 'pk-mb-memory__cats');
    cats.append(h('div', 'pk-mb-memory__folder', `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5h5l1.5 2H17v8.5H3z"/></svg>${esc(stats.folder ? `现在用的是：${stats.name || stats.folder}` : '现在没绑文件夹')}<small>${stats.count} 条 · 了解 ${stats.known} / 9 类</small>`));
    const max = Math.max(1, ...Object.values(stats.byCategory || {}));
    const shades = ['v1', 'v2', 'v3', 'v4', 'v5'];
    Object.entries(MEMORY_CATS).forEach(([cat, name], i) => {
      const n = stats.byCategory?.[cat] || 0;
      cats.append(h('div', 'pk-mb-bar', `<span title="${MEMORY_FULL[cat]}">${name}</span><u><i data-v="${shades[i % 5]}" style="width:${Math.round((n / max) * 100)}%"></i></u><em>${n}</em>`));
    });
    const side = h('div', 'pk-mb-memory__side');
    const search = h('input', 'pk-mb-search');
    search.type = 'search'; search.placeholder = '搜索记忆'; search.value = memoryQuery; search.setAttribute('aria-label', '搜索项目记忆');
    search.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { memoryQuery = search.value.trim(); void fillMemory(key); } });
    side.append(search);
    const list = h('ul', 'pk-mb-memory__list');
    if (!items.length) list.append(h('li', 'pk-mb-empty', memoryQuery ? '没搜到。' : stats.folder ? '这个文件夹还没有记忆。' : '绑一个项目文件夹以后，Metre 会在这里攒下对它的了解。'));
    items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const item of items.slice(0, 60)) {
      const li = h('li', '', `<b data-v="${shades[Object.keys(MEMORY_CATS).indexOf(item.category) % 5] || 'v1'}">${esc(item.categoryName || item.category)}</b><span title="${esc(item.confidenceName || '')}">${esc(item.text)}</span>`);
      const acts = h('span', 'pk-mb-memory__acts');
      const act = (text, fn) => { const b = h('button', 'pk-mb-act', text); b.type = 'button'; b.addEventListener('click', fn); acts.append(b); };
      act(item.pinned ? '取消钉住' : '钉住', async () => { await rpc('pinkie.metre.memory', {sessionKey: key, action: 'pin', id: item.id, pinned: !item.pinned}).catch(() => {}); void fillMemory(key); });
      act('编辑', () => {
        const text = li.querySelector('span');
        const input = h('input', 'pk-mb-edit'); input.value = item.text; input.maxLength = 400;
        text.replaceWith(input); input.focus();
        input.addEventListener('keydown', async (ev) => {
          if (ev.key === 'Escape') { ev.stopPropagation(); void fillMemory(key); }
          if (ev.key === 'Enter' && input.value.trim()) { await rpc('pinkie.metre.memory', {sessionKey: key, action: 'edit', id: item.id, text: input.value.trim()}).catch(() => {}); void fillMemory(key); }
        });
      });
      act('删除', async (ev) => {
        const b = ev.currentTarget;
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '确定删除'; return; }
        await rpc('pinkie.metre.memory', {sessionKey: key, action: 'delete', id: item.id}).catch(() => {});
        void fillMemory(key);
      });
      li.append(acts);
      list.append(li);
    }
    side.append(list);
    wrap.append(cats, side);
    return wrap;
  }
  async function fillMemory(key) {
    if (!key) { board()?.fill('memory', empty('先在 Metre 里开一个会话，这里显示它所在文件夹的记忆。')); return; }
    try { board()?.fill('memory', await memoryNode(key)); } catch { /* 断线时保留上一次 */ }
  }

  // ---------- 总览、按钮、数字 ----------
  function overview(o, now) {
    const b = board();
    const parentQuiet = o.parentRunning && o.parentLastActiveAt ? now - o.parentLastActiveAt : 0;
    b.setStat('state', stale ? '连接断了' : parentQuiet > QUIET_MS && o.state === 'Metre 在做' ? `Metre ${span(parentQuiet)}没动静` : o.state);
    b.setStat('elapsed', o.startedAt ? span(now - o.startedAt) : '—');
    b.setStat('running', `${o.running}/${o.limit}`);
    b.setStat('returned', `${o.returned} · ${o.failed}`);
    const key = sessionKey();
    b.enableActions({
      pause: async (btn) => { btn.disabled = true; try { await rpc('pinkie.metre.pause', {key, paused: !data?.overview?.paused}); } catch {} refreshSoon(0); },
      stop: async (btn) => {
        btn.disabled = true;
        const resume = Boolean(data?.overview?.stopped);
        try {
          const result = resume ? await rpc('pinkie.metre.resume', {sessionKey: key}, 12_000) : await rpc('pinkie.metre.stopAll', {key}, 20_000);
          if (result?.ok === false) window.__laolaoSidebar?.toast?.(result.error || '没成功，再点一次');
        } catch { window.__laolaoSidebar?.toast?.('没成功，再点一次'); }
        refreshSoon(0);
      },
    });
    const page = document.getElementById('pk-metre-board');
    const pauseBtn = page?.querySelector('[data-metre-action="pause"]');
    const stopBtn = page?.querySelector('[data-metre-action="stop"]');
    if (pauseBtn) { pauseBtn.textContent = o.paused ? '继续派发' : '暂停派发'; pauseBtn.setAttribute('aria-pressed', String(o.paused)); }
    if (stopBtn) stopBtn.textContent = o.stopped ? '接着做' : '全部停下';
  }
  function badge(count) {
    const set = (host, cls) => {
      if (!host) return;
      let node = host.querySelector('.' + cls);
      if (!count) { node?.remove(); return; }
      if (!node) { node = h('span', cls); host.append(node); }
      node.textContent = String(count);
      node.setAttribute('aria-label', `${count} 件等你处理`);
    };
    set(document.querySelector('.pk-metre-nav--board'), 'pk-mb-badge');
    set(document.querySelector('#pk-metre-board-pending .pk-metre-board__card-head h3'), 'pk-mb-count');
  }
  // 顶上那一条说明：断线 / 没回话 / 回得慢 共用一个位置。
  function notice(html) {
    const page = document.getElementById('pk-metre-board');
    if (!page) return;
    let note = page.querySelector('.pk-metre-board__notice');
    if (!html) { note?.remove(); return; }
    if (!note) { note = h('p', 'pk-metre-board__notice'); page.querySelector('.pk-metre-board__scroll')?.prepend(note); }
    note.setAttribute('role', 'status');
    note.innerHTML = html;
  }
  // 两种「拿不到现在的情况」：连接断了（lost），或者连着但后端 RPC_MS 都没回话（timeout，卡住或太忙）。
  // 两种都按断线处理：数据变灰、「在跑」改成「断线前在跑」，不显示成还在跑，也不显示成做完。
  function setStale(on, reason = 'lost') {
    stale = on;
    const page = document.getElementById('pk-metre-board');
    if (!page) return;
    page.classList.toggle('is-stale', on);
    if (!on) { notice(''); return; }
    notice(reason === 'timeout'
      ? `<b>没回话</b>后端 ${Math.round(RPC_MS / 1000)} 秒没有回话（卡住或太忙），正在重试。下面是之前读到的数据，不代表还在跑，也不代表已经做完。`
      : '<b>断线</b>连接断了，正在重连。下面是断线前的数据，不代表已经做完。');
  }
  // 还没到 RPC_MS、但已经等了 SLOW_MS：说一声「回得慢」，并写明下面的数据是多久以前的。
  function slowNote(started) {
    if (stale || !inflight) return;
    const waited = Math.round((Date.now() - started) / 1000);
    const age = dataAt ? `下面是 ${Math.round((Date.now() - dataAt) / 1000)} 秒前读到的数据。` : '';
    notice(`<b>回得慢</b>后端还没回（已等 ${waited} 秒）。${age}`);
    slowTimer = setTimeout(() => slowNote(started), 5000);
  }

  // 断线时的样子：数字保留，但凡是「正在进行」的都改成「断线前……」，不能看起来还在跑。
  function staleView(view) {
    return {...view, overview: {...view.overview, parentRunning: false},
      plan: view.plan ? {...view.plan, items: (view.plan.items || []).map((item) => item.status === 'active' ? {...item, status: 'stale-active'} : item)} : view.plan,
      sessions: (view.sessions || []).map((s) => s.status === 'running'
        ? {...s, status: 'unknown', statusText: '断线前在跑', state: 'wait', doing: '',
          spans: (s.spans || []).map((sp) => sp.kind === 'run' ? {...sp, kind: 'wait'} : sp)} : s)};
  }
  // 有东西在跑：WATCH_MS 后主动读一次（期间来了事件、刷过了，就从那次往后算）。
  function watch(view) {
    clearTimeout(watchTimer); watchTimer = 0;
    const o = view?.overview || {};
    const busy = o.parentRunning || o.running > 0 || (view?.sessions || []).some((s) => s.status === 'running' || s.status === 'queued');
    if (busy && board()?.isOpen) watchTimer = setTimeout(() => { watchTimer = 0; refreshSoon(0); }, WATCH_MS);
  }

  function render(view) {
    const b = board();
    if (!b) return;
    if (stale) view = staleView(view);
    // 没人在做了（Metre 和子会话都不在跑），计划里那一步就不是「进行中」，是「停在这一步」。
    else if (!view.overview?.parentRunning && !(view.overview?.running > 0) && view.plan?.items)
      view = {...view, plan: {...view.plan, items: view.plan.items.map((item) => item.status === 'active' ? {...item, status: 'idle-active'} : item)}};
    const now = view.at || Date.now();
    if (stale) queueMicrotask(() => b.enableActions({}));   // 断着的时候按钮点了也没用：禁掉，免得以为点了生效
    overview(view.overview, now);
    b.fill('plan', planNode(view.plan));
    b.fill('sessions', sessionsNode(view.sessions || [], now));
    b.fill('pending', pendingNode(view.pending || []));
    b.fill('timeline', timelineNode(view.timeline || []));
    b.fill('changes', changesNode(view.changes || []));
    b.fill('runtime', runtimeNode(view.runtime || {}, view.overview));
    b.fill('raw', rawNode(view.raw || []));
    badge((view.pending || []).length);
  }
  function renderNoSession() {
    const b = board();
    if (!b) return;
    b.setStat('state', '还没开始');
    for (const id of ['plan', 'sessions', 'pending', 'timeline', 'changes', 'runtime', 'raw']) {
      b.fill(id, empty('这里显示当前 Metre 会话的情况。先在首页发一句话开始。'));
    }
    b.enableActions({});
    setStale(false);
    document.querySelector('#pk-metre-board .pk-metre-board__notice')?.remove();
  }

  async function refresh() {
    pendingTimer = 0;
    if (!isMetre() || !board()?.isOpen) return;
    if (inflight) { again = true; return; }
    const key = sessionKey();
    if (!key) { renderNoSession(); void fillMemory(''); return; }
    inflight = true; lastAt = Date.now();
    const started = Date.now();
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => slowNote(started), SLOW_MS);
    try {
      const view = await rpc('pinkie.metre.board', {sessionKey: key}, RPC_MS);
      if (!view || view.ok === false) throw new Error(view?.error || 'bad');
      data = view; dataAt = Date.now();
      setStale(false);
      document.querySelector('#pk-metre-board .pk-metre-board__notice')?.remove();
      render(view);
      watch(view);
      void fillMemory(key);
    } catch (error) {
      setStale(true, /timeout/i.test(String(error?.message || error)) ? 'timeout' : 'lost');
      if (data) render(data);
      // 断着的时候每 WATCH_MS 再试一次；连上时 pinkie:sidebar-gateway-ready 会立刻补读。
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => { watchTimer = 0; refreshSoon(0); }, WATCH_MS);
    } finally {
      inflight = false;
      clearTimeout(slowTimer); slowTimer = 0;
      if (again) { again = false; refreshSoon(); }
    }
  }
  // 每秒最多一次：事件密集时合成一次，用一个一次性的定时器补上最后那次，不是轮询。
  function refreshSoon(delay) {
    if (!board()?.isOpen || pendingTimer) return;
    const wait = delay ?? Math.max(0, 1000 - (Date.now() - lastAt));
    pendingTimer = setTimeout(refresh, wait);
  }
  async function refreshBadge() {
    const key = sessionKey();
    if (!isMetre() || !key || Date.now() - badgeAt < 5000) return;
    badgeAt = Date.now();
    try { const view = await rpc('pinkie.metre.board', {sessionKey: key}); if (view?.ok !== false) { data = view; badge((view.pending || []).length); } } catch {}
  }

  window.addEventListener('pinkie:gateway-event', (event) => {
    if (!isMetre()) return;
    const name = event.detail?.event;
    const payload = event.detail?.payload || {};
    if (board()?.isOpen) { refreshSoon(); return; }
    const d = payload.data || {};
    const asked = payload.stream === 'tool' && d.phase === 'result' && String(d.name || d.toolName || '') === 'ask_user';
    const ended = payload.stream === 'lifecycle' && /^(?:end|error)$/.test(String(d.phase || ''));
    if (asked || ended || name === 'sessions.changed') void refreshBadge();
  });
  window.addEventListener('pinkie:sidebar-gateway-ready', () => { if (stale) refreshSoon(0); });
  window.addEventListener('pinkie:sidebar-gateway-lost', () => {
    if (!isMetre()) return;
    setStale(true);
    if (data && board()?.isOpen) render(data);
    // App 可能还有别的连接、或马上重连：3 秒后读一次，读到了就清掉断线；读不到就按看门狗每 20 秒再试。
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => { watchTimer = 0; refreshSoon(0); }, 3000);
  });
  // 打开总控台时读一次（停靠是 dock，窄窗口是 overlay）；换会话时（地址栏 session 变了）开着就重读。
  // 骨架在没接数据时放的是「示例」；数据层在，就先换成「正在读取」，不让人把示例当成这次的情况。
  function renderLoading() {
    const b = board();
    if (!b) return;
    for (const id of ['plan', 'sessions', 'pending', 'timeline', 'changes', 'runtime', 'raw', 'memory']) b.fill(id, empty('正在读取…'));
    b.setStat('state', '正在读取');
    document.querySelector('#pk-metre-board .pk-metre-board__notice')?.remove();
  }
  new MutationObserver(() => {
    if (root.hasAttribute('data-metre-board')) { if (!data && !stale) renderLoading(); refreshSoon(0); }
    else { clearTimeout(watchTimer); watchTimer = 0; }
  })
    .observe(root, {attributes: true, attributeFilter: ['data-metre-board']});
  window.addEventListener('pinkie:session-selected', () => { data = null; badge(0); refreshSoon(0); });

  // 总控台比这份脚本先打开（启动页上就点了入口）：补上「正在读取」和第一次读数。
  if (root.hasAttribute('data-metre-board')) { renderLoading(); refreshSoon(0); }

  window.__pinkieMetreBoardData = {refresh: () => refreshSoon(0), get data() { return data; }, get stale() { return stale; }};
})();
