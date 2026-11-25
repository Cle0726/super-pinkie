/* laolao-metre-backstage —— Metre 的「后台」状态带（11-24 第二版：协调者验收打回后重做位置、宽度、对比度）。
 * 用户反复遇到「页面和后台不同步」：这条窄带让人一眼看出后台真实在干什么。
 *
 *   [后台] [■ 网关 连着] [■ 本轮 后台空闲 · 页面停着] [■ 排队 0] [■ 引擎 4 · 1 在跑 · 1 等你 ▴]
 *
 * 位置：对话页输入框（连下面 Metre / 模型那一排）正下方的那一条，离窗口下沿 8px——输入框那一栏往上让出这一条，对话滚不到，所以它不压任何东西；
 *   宽度永远等于输入框的宽度，每一格的宽度按这一格所有可能的字里最长的那个定死，状态怎么变，带子和每一格都不动。
 *   首页（还没开始对话）不出现；窄窗口的总谱浮层打开时输入框和带子都让给浮层，浮层铺到窗口底。
 * 两档：输入框够宽时说全（「本轮 后台在跑 · 页面停着」「引擎 4 · 1 在跑 · 1 等你」）；不够宽收成短的（「本轮 在跑」「引擎 4」），
 *   完整的话在每一格的悬停提示里。永远一行、不截断、不换行。引擎声部多了只给总数和要紧的两项，点「引擎」那一格才弹出明细。
 * 数据一律来自后台已有的事件和接口，页面不自己猜：
 *   网关   laolao-run-status 读原生网关仓库得到的连接状态（state.conn）——总谱（laolao-metre-board-data）也读同一份，两边说法一致
 *   本轮   后台：pinkie.run.status（run-status 问的那份）；页面：原生聊天面板的 chatRunId / chatSending / chatStream。
 *          两个方向（后台在跑页面停着 / 页面在等后台空闲）不一致超过 3 秒都显示「不同步」和「同步」键：重新问后台；后台已经停了就清掉页面残留的「在跑」；
 *          再重拉 chat.history 对齐。对上以后（点了同步、或者页面自己被清掉）说 2 秒「已和后台对齐」再回常态
 *   排队   原生面板的 chatQueue 条数
 *   引擎   pinkie.engines.status（开 / 关）+ 总谱数据里外部引擎的声部（在跑 / 等你 / 交回 / 失败）
 * 刷新挂在已有的事件上：run-status 画状态条时发的 pinkie:run-view、总谱数据回来的 pinkie:metre-board-data、换会话、换模式、窗口大小；
 *   两边对不上、或者正在说「已对齐」时，半秒后再看一次（一次性的 setTimeout，对上了、说完了就停）。不加循环定时器、不加观察器。只在 Metre 出现。 */
(() => {
  'use strict';
  if (document.querySelector('.pk-metre-backstage')) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const rpc = (method, params, timeout = 8000) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, timeout) : Promise.reject(new Error('offline'));
  const UNSYNC_MS = 3000, ENGINE_EVERY = 15_000;   // 两边不一致超过 3 秒才算「不同步」
  const pane = () => document.querySelector('openclaw-chat-pane');
  const runState = () => { try { return window.__pinkieRunStatus?.state || null; } catch { return null; } };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  // ---------- 读（纯函数：同样的输入同样的一行） ----------
  const VOICE = {run: '在跑', wait: '等你', done: '交回', fail: '失败'};
  function voiceState(s) {
    const st = String(s.state || ''), status = String(s.status || '');
    if (st === 'fail' || /fail|error|abort/.test(status)) return 'fail';
    if (st === 'run' || status === 'running') return 'run';
    if (st === 'done' || /done|complete|ok|idle|ended/.test(status)) return 'done';
    return 'wait';
  }
  // 每一格：{id, tone, full, short, title, sync?, pop?}
  function describe({conn, status, page, queue, engines, voices, since, now, aligned = false}) {
    const gw = !conn ? {tone: 'off', full: '网关 还不知道', short: '网关 —'}
      : conn.online ? {tone: 'ok', full: '网关 连着', short: '网关 连着'}
      : conn.attempt > 0 ? {tone: 'wait', full: `网关 重连中 · 第 ${conn.attempt} 次`, short: `网关 重连 ${conn.attempt}`}
      : {tone: 'fail', full: '网关 断了', short: '网关 断了'};
    const back = status == null ? null : Boolean(status.active);
    const pageText = page.writing ? '页面在出字' : page.busy ? '页面在等回复' : '页面停着';
    const backText = back == null ? '后台还没回话' : back ? '后台在跑' : '后台空闲';
    const unsynced = back != null && conn?.online !== false && back !== page.busy && since && now - since >= UNSYNC_MS;
    // 两个方向都认：后台在跑、页面停着；或者页面在等 / 在出字、后台空闲。对上了以后 2 秒里说一句「已和后台对齐」
    const run = unsynced ? {tone: 'fail', full: `不同步 · ${backText} · ${pageText}`, short: '不同步 · ' + backText, sync: true}
      : aligned ? {tone: 'ok', full: '本轮 已和后台对齐', short: '本轮 已对齐'}
      : {tone: back || page.busy ? 'run' : back == null ? 'off' : 'ok', full: `本轮 ${backText} · ${pageText}`,
        short: '本轮 ' + (back == null ? '—' : page.writing ? '出字' : back ? '在跑' : page.busy ? '等回复' : '空闲')};
    const q = {tone: queue > 0 ? 'wait' : 'off', full: `排队 ${queue}`, short: `排队 ${queue}`};
    let eng;
    if (voices.length) {
      const n = (k) => voices.filter((v) => v.tone === k).length;
      const bits = [['fail', '失败'], ['wait', '等你'], ['run', '在跑']].filter(([k]) => n(k)).slice(0, 2).map(([k, w]) => `${n(k)} ${w}`);
      eng = {tone: n('fail') ? 'fail' : n('wait') ? 'wait' : n('run') ? 'run' : 'ok', full: `引擎 ${voices.length} · ${bits.length ? bits.join(' · ') : '全部交回'}`, short: `引擎 ${voices.length}` + (bits.length ? ' · ' + (n('fail') && n('wait') ? bits.join(' · ') : bits[0]) : ''), pop: true};   // 窄的时候：失败、等你同时有就两个数都留（写全「1 失败 · 1 等你」，不缩成「败」「等」或符号：看不懂、读屏也念不对；格子放不下时省略号，悬停看全文），否则留最要紧的一项（失败 > 等你 > 在跑）
    } else eng = engines == null ? {tone: 'off', full: '引擎 还不知道', short: '引擎 —'}
      : !engines.enabled ? {tone: 'off', full: '引擎 关', short: '引擎 关'}
      : engines.running === false ? {tone: 'wait', full: '引擎 开 · 服务没在跑', short: '引擎 开'} : {tone: 'ok', full: '引擎 开', short: '引擎 开'};
    const cells = [{id: 'gw', ...gw}, {id: 'run', ...run}, {id: 'queue', ...q}, {id: 'eng', ...eng}];
    for (const c of cells) c.title = c.full;
    return {cells, unsynced, voices};
  }
  // 每一格可能出现的所有字（量宽度用：每一格按最长的那个定死，状态变了带子不动）
  const VARIANTS = {
    gw: {full: ['网关 还不知道', '网关 连着', '网关 重连中 · 第 99 次', '网关 断了'], short: ['网关 —', '网关 连着', '网关 重连 99', '网关 断了']},
    run: {full: [...['后台还没回话', '后台在跑', '后台空闲'].flatMap((b) => ['页面在出字', '页面在等回复', '页面停着'].map((p) => `本轮 ${b} · ${p}`)), ...['后台在跑 · 页面停着', '后台空闲 · 页面在出字', '后台空闲 · 页面在等回复'].map((x) => ['sync', `不同步 · ${x}`]), '本轮 已和后台对齐'],
      short: ['本轮 —', '本轮 出字', '本轮 在跑', '本轮 等回复', '本轮 空闲', '本轮 已对齐', ['sync', '不同步 · 后台在跑'], ['sync', '不同步 · 后台空闲']]},
    queue: {full: ['排队 99'], short: ['排队 99']},
    eng: {full: ['引擎 还不知道', '引擎 关', '引擎 开 · 服务没在跑', ['pop', '引擎 99 · 9 等你 · 9 在跑'], ['pop', '引擎 99 · 9 失败 · 9 等你'], ['pop', '引擎 99 · 全部交回']],
      short: ['引擎 —', '引擎 关', '引擎 开', ['pop', '引擎 99'], ...['失败', '等你', '在跑'].map((w) => ['pop', `引擎 99 · 9 ${w}`]), ['pop', '引擎 99 · 9 失败 · 9 等你']]},
  };

  // ---------- 画 ----------
  const chip = (c, tier, syncing) => {
    const text = tier === 'full' ? c.full : c.short;
    const tag = c.pop ? 'button' : 'span';
    return `<${tag}${c.pop ? ` type="button" aria-haspopup="true" aria-label="${esc(c.full)}"` : ''} class="pk-bs__seg${c.pop ? ' pk-bs__seg--pop' : ''}" data-seg="${c.id}" data-tone="${c.tone}" title="${esc(c.title)}"><i aria-hidden="true"></i><span>${esc(text)}</span>${c.sync
      ? `<button type="button" class="pk-bs__sync"${syncing ? ' disabled aria-busy="true"' : ''}>${syncing ? '同步中' : '同步'}</button>` : ''}${c.pop ? '<b class="pk-bs__caret" aria-hidden="true"></b>' : ''}</${tag}>`;
  };
  let band = null, sig = '', since = 0, lastPair = '', engines = null, enginesAt = 0, syncing = false, known = null, knownFor = '', askedAt = 0;
  let widths = null, view = null, pop = null, recheck = 0, observed = null, alignedUntil = 0, shownUnsync = false;
  const LABEL = '<span class="pk-bs__label" aria-hidden="true">后台</span>';
  function measure() {
    // 用同样的样式在看不见的地方摆一遍每一格的所有字，取最宽的：每一格的宽度就此定死
    const probe = document.createElement('div');
    probe.className = 'pk-metre-backstage pk-metre-backstage--probe';
    probe.setAttribute('aria-hidden', 'true');
    document.body.append(probe);
    const out = {full: {}, short: {}, label: 0};
    probe.innerHTML = LABEL; out.label = Math.ceil(probe.firstChild.getBoundingClientRect().width);
    for (const tier of ['full', 'short']) for (const [id, all] of Object.entries(VARIANTS)) {
      let max = 0;
      for (const v of all[tier]) {
        const [kind, text] = Array.isArray(v) ? v : ['', v];
        probe.innerHTML = chip({id, tone: 'ok', full: text, short: text, title: '', sync: kind === 'sync', pop: kind === 'pop'}, tier, false);
        max = Math.max(max, Math.ceil(probe.firstChild.getBoundingClientRect().width));
      }
      out[tier][id] = max;
    }
    probe.remove();
    return out;
  }
  const GAP = 6;
  const tierWidth = (tier) => Object.values(widths[tier]).reduce((a, b) => a + b, 0) + GAP * 4 + (tier === 'full' ? widths.label + GAP : 0) + 8;
  function build() {
    band = document.createElement('div');
    band.className = 'pk-metre-backstage';
    band.setAttribute('role', 'status');
    band.setAttribute('aria-label', '后台状态');
    band.addEventListener('click', (event) => {
      const sync = event.target.closest('.pk-bs__sync');
      if (sync) { event.stopPropagation(); void resync(); return; }
      if (event.target.closest('.pk-bs__seg--pop')) togglePop();
    });
    document.body.append(band);
  }
  const composer = () => [...document.querySelectorAll('.agent-chat__input')].find((n) => n.getClientRects().length);
  function onHome() {
    if (root.getAttribute('data-laolao-startup-home') === '1') return true;
    return [...document.querySelectorAll('.agent-chat__welcome')].some((n) => n.getClientRects().length);
  }
  // 输入框正下方那一条：左右和输入框对齐；那条不够 24px 高时（极矮的窗口）退到输入框上沿、对话留白的那一段里
  const BOTTOM = 8;
  function place() {
    if (!root.hasAttribute('data-metre-bs') && composer() && !onHome() && root.getAttribute('data-metre-board') !== 'overlay') root.setAttribute('data-metre-bs', '');   // 先让出位置再量
    const comp = composer(), r = comp?.getBoundingClientRect();
    // 窄窗口的总谱浮层开着时，带子让给浮层（浮层铺到最底下；总谱自己的「运行状况」里有网关那一行，读的是同一份状态）
    if (!r || r.width < 280 || onHome() || root.getAttribute('data-metre-board') === 'overlay') { root.style.setProperty('--metre-bs-room', '0px'); root.removeAttribute('data-metre-bs'); return null; }
    if (!widths) widths = measure();
    const tier = tierWidth('full') <= r.width ? 'full' : 'short';
    const top = window.innerHeight - BOTTOM - 24;   // 离窗口下沿固定 8px，各尺寸一样；输入框那一栏往上让出 24px（keys.css 的 [data-metre-bs]）
    Object.assign(band.style, {left: Math.round(r.left) + 'px', top: top + 'px', width: Math.round(r.width) + 'px'});
    root.style.setProperty('--metre-bs-room', Math.max(0, Math.round(window.innerHeight - top + 4)) + 'px');
    if (observed !== comp && typeof ResizeObserver === 'function') {
      (place.ro ||= new ResizeObserver(() => render(true))).disconnect();
      place.ro.observe(comp); observed = comp;
    }
    return tier;
  }
  function render(force) {
    if (!isMetre()) { if (band) band.hidden = true; root.removeAttribute('data-metre-bs'); closePop(); return; }
    const rs = runState(), p = pane(), st = p?.state || {};
    const page = {busy: Boolean(st.chatRunId || st.chatSending || st.chatStream), writing: Boolean(st.chatStream)};
    const now = Date.now();
    // 后台的回话：run-status 只在一轮在跑时每 3 秒问一次，空闲时那份会过期。记住最近一次的回话；过期了、或者两边对不上，
    // 就请 run-status 用它自己的那条路（pinkie.run.status）再问一次，最多 3 秒一次——不另起定时器。
    if (rs?.key !== knownFor) { knownFor = rs?.key || ''; known = null; }
    if (rs?.status) known = rs.status;
    if ((!rs?.status || Boolean(known?.active) !== page.busy) && rs?.conn?.online !== false && now - askedAt > 3000) { askedAt = now; void window.__pinkieRunStatus?.refresh?.(); }
    // 后台在不在跑：pinkie.run.status 说的，或者 run-status 从网关事件里看到这一轮开始了（事件也是后台发的）
    const status = known || rs?.live?.active ? {...(known || {}), active: Boolean(known?.active || rs?.live?.active)} : null;
    const pair = `${status == null ? '?' : status.active}|${page.busy}`;
    if (pair !== lastPair) {
      const was = since;
      lastPair = pair; since = status != null && status.active !== page.busy ? now : 0;
      if (!since && was && (shownUnsync || now - was >= 1000)) alignedUntil = now + 2000;   // 刚对上（页面自己被清掉、或者点了同步）：说一声，停 2 秒
      if (since) shownUnsync = false;
    }
    // 两边对不上、或者正在说「已对齐」时，半秒后再看一次（一次性的 setTimeout，对上了、说完了就不再排）
    clearTimeout(recheck); recheck = since || alignedUntil > now ? setTimeout(render, Math.max(20, Math.min(500, since && now - since < UNSYNC_MS ? since + UNSYNC_MS - now + 5 : 500, alignedUntil > now ? alignedUntil - now + 5 : 500))) : 0;
    if (now - enginesAt > ENGINE_EVERY) { enginesAt = now; rpc('pinkie.engines.status', {}, 8000).then((v) => { engines = v && typeof v === 'object' ? v : null; sig = ''; render(); }).catch(() => {}); }
    const board = window.__pinkieMetreBoardData?.data;
    const voices = (board?.sessions || []).filter((s) => s && s.external).map((s) => ({key: s.key, name: String(s.engineName || s.title || s.label || '引擎').slice(0, 18), tone: voiceState(s)}));
    view = describe({conn: rs?.conn || null, status, page, queue: Array.isArray(st.chatQueue) ? st.chatQueue.length : 0, engines, voices, since, now, aligned: alignedUntil > now});
    if (view.unsynced) shownUnsync = true;
    if (!band) build();
    const tier = place();
    band.hidden = !tier;
    if (!tier) { closePop(); return; }
    const next = tier + JSON.stringify(view.cells) + syncing;
    if (next !== sig || force) {
      sig = next;
      band.dataset.tier = tier;
      band.dataset.unsynced = view.unsynced ? '1' : '';
      band.innerHTML = (tier === 'full' ? LABEL : '') + view.cells.map((c) => chip(c, tier, syncing)).join('');
      band.querySelectorAll('.pk-bs__seg').forEach((n) => { n.style.width = widths[tier][n.dataset.seg] + 'px'; });
    }
    if (pop) fillPop();
  }
  // 引擎明细：点「引擎」那一格弹出，贴在带子上面；点别处、按 Esc 收起
  function togglePop() { if (pop) closePop(); else { pop = document.createElement('div'); pop.className = 'pk-bs__pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '外部引擎的声部'); document.body.append(pop); fillPop(); } }
  function closePop() { pop?.remove(); pop = null; }
  function fillPop() {
    const seg = band?.querySelector('.pk-bs__seg--pop');
    if (!seg || !view?.voices.length) { closePop(); return; }
    pop.innerHTML = '<p class="pk-bs__pop-head">外部引擎的声部</p>' + view.voices.map((v) => `<p class="pk-bs__seg" data-tone="${v.tone === 'done' ? 'ok' : v.tone}"><i aria-hidden="true"></i><span>${esc(v.name)} ${VOICE[v.tone]}</span></p>`).join('');
    const r = seg.getBoundingClientRect();
    Object.assign(pop.style, {left: Math.round(Math.min(r.left, window.innerWidth - 230)) + 'px', bottom: Math.round(window.innerHeight - r.top + 6) + 'px'});
  }
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest?.('.pk-bs__seg--pop')) closePop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) closePop(); });
  // 「同步」：重新问后台，后台停了就清掉页面上残留的「在跑」，再重拉 chat.history 对齐
  async function resync() {
    if (syncing) return;
    syncing = true; sig = ''; render();
    try {
      await window.__pinkieRunStatus?.refresh?.();
      const rs = runState(), p = pane(), key = rs?.key || p?.state?.sessionKey;
      if (p?.state && rs?.status && !rs.status.active) { p.state.chatRunId = null; p.state.chatStream = null; p.state.chatSending = false; }
      if (p && key) {
        if (typeof window.__pinkieMessageActions?.reloadHistory === 'function') await window.__pinkieMessageActions.reloadHistory(p, key);
        else { const r = await rpc('chat.history', {sessionKey: key, limit: 200}, 20_000); if (Array.isArray(r?.messages)) { p.state.chatMessages = r.messages; p.requestUpdate?.(); } }
        p.requestUpdate?.();
      }
    } catch {} finally { syncing = false; lastPair = ''; sig = ''; render(); }
  }

  window.addEventListener('pinkie:run-view', render);
  window.addEventListener('pinkie:metre-board-data', () => { if (Date.now() - enginesAt > 3000) enginesAt = 0; render(); });   // 总谱刷新了（引擎声部可能变了）：引擎开关也重新问一次，最多 3 秒一次
  for (const name of ['pinkie:sidebar-gateway-lost', 'pinkie:sidebar-gateway-ready']) window.addEventListener(name, () => render());
  window.addEventListener('laolao:modechange', () => { sig = ''; render(); });
  window.addEventListener('pinkie:session-selected', () => { lastPair = ''; sig = ''; enginesAt = 0; closePop(); render(); });
  window.addEventListener('resize', () => { if (band) render(true); });
  for (const name of ['pinkie:metre-board-open', 'pinkie:metre-board-closed']) window.addEventListener(name, () => render(true));   // 总谱开 / 关（laolao-metre-board.js 发）
  document.fonts?.ready?.then(() => { widths = null; sig = ''; if (band) render(); });
  window.PinkieMetreBackstage = Object.freeze({describe, voiceState, render: () => render(true)});
})();
