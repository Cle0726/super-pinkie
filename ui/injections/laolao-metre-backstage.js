/* laolao-metre-backstage —— Metre 的「后台」状态带（11-24）。用户反复遇到「页面和后台不同步」：这条窄带让人一眼看出后台真实在干什么。
 *
 *   后台 ｜■ 网关 连着 ｜■ 本轮 后台在跑 · 页面在出字 ｜■ 排队 2 ｜■ 引擎 开 ｜■ Codex 在跑  ■ Claude 等你
 *
 * 每一格是一小节（左边一条小节线），前面一个方形音符头标颜色：做完 / 正常 = 偏绿的灰、在跑 = 钴蓝、等你 = 暗金、出错 / 断了 = 砖红、关 = 浅灰。
 * 数据一律来自后台已有的事件和接口，页面不自己猜：
 *   网关      laolao-run-status 读原生网关仓库得到的连接状态（state.conn：online / attempt）——连着 / 重连中（第 N 次）/ 断了
 *   本轮      后台：pinkie.run.status（run-status 每 3 秒问一次的那份，state.status.active）；页面：原生聊天面板自己的
 *             chatRunId / chatSending / chatStream（是不是在出字）。两边不一致超过 3 秒显示「不同步」和「同步」键：
 *             先让 run-status 重新问一次 pinkie.run.status，后台已经停了就把页面上残留的「在跑」清掉，再重拉 chat.history 把页面对齐。
 *   排队      原生面板的 chatQueue 条数（和 laolao-queue-steer 读的同一份）
 *   引擎      pinkie.engines.status（开 / 关、服务在不在跑），最多 15 秒问一次；
 *             派出去的引擎任务 = 总谱数据（pinkie.metre.board，laolao-metre-board-data）里外部引擎的声部：在跑 / 等你 / 交回 / 失败。
 * 刷新挂在已有的节拍上：run-status 每次画状态条都发 pinkie:run-view（一轮在跑时每秒一次；断线 / 重连、后台回话时也画），这里跟着重画；
 *   总谱刷新（pinkie:metre-board-data）、换会话、换模式时也重画。两边刚对不上时排一次 3 秒后的复查（一次性的 setTimeout）。
 *   不加 setInterval、不加观察器、不另起轮询。
 * 只在 Metre 出现（其他五个模式不加载样式规则以外的任何东西，带子也不建）。减少动态效果时「在跑」的拍子线不闪。 */
(() => {
  'use strict';
  if (document.querySelector('.pk-metre-backstage')) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const rpc = (method, params, timeout = 8000) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, timeout) : Promise.reject(new Error('offline'));
  const UNSYNC_MS = 3000, ENGINE_EVERY = 15_000, MAX_VOICES = 4;
  const pane = () => document.querySelector('openclaw-chat-pane');
  const runState = () => { try { return window.__pinkieRunStatus?.state || null; } catch { return null; } };

  // ---------- 读（纯函数：同样的输入同样的一行） ----------
  const VOICE = {run: '在跑', wait: '等你', done: '交回', fail: '失败'};
  function voiceState(s) {
    const st = String(s.state || ''), status = String(s.status || '');
    if (st === 'fail' || /fail|error|abort/.test(status)) return 'fail';
    if (st === 'run' || status === 'running') return 'run';
    if (st === 'done' || /done|complete|ok|idle|ended/.test(status)) return 'done';
    return 'wait';
  }
  function describe({conn, status, page, queue, engines, voices, since, now}) {
    const segs = [];
    if (!conn) segs.push({id: 'gw', tone: 'off', text: '网关 还不知道'});
    else if (conn.online) segs.push({id: 'gw', tone: 'ok', text: '网关 连着'});
    else if (conn.attempt > 0) segs.push({id: 'gw', tone: 'wait', text: `网关 重连中（第 ${conn.attempt} 次）`});
    else segs.push({id: 'gw', tone: 'fail', text: '网关 断了'});
    const back = status == null ? null : Boolean(status.active);
    const pageText = page.writing ? '页面在出字' : page.busy ? '页面在等回复' : '页面停着';
    const backText = back == null ? '后台还没回话' : back ? '后台在跑' : '后台空闲';
    const unsynced = back != null && conn?.online !== false && back !== page.busy && since && now - since >= UNSYNC_MS;
    segs.push(unsynced
      ? {id: 'run', tone: 'fail', text: `不同步：${backText} · ${pageText}`, sync: true}
      : {id: 'run', tone: back || page.busy ? 'run' : 'ok', text: `本轮 ${backText} · ${pageText}`});
    segs.push({id: 'queue', tone: queue > 0 ? 'wait' : 'off', text: `排队 ${queue}`});
    segs.push(engines == null ? {id: 'eng', tone: 'off', text: '引擎 还不知道'}
      : !engines.enabled ? {id: 'eng', tone: 'off', text: '引擎 关'}
      : {id: 'eng', tone: engines.running === false ? 'wait' : 'ok', text: engines.running === false ? '引擎 开 · 服务没在跑' : '引擎 开'});
    const shown = voices.slice(0, MAX_VOICES).map((v) => ({id: 'v:' + v.key, tone: v.tone === 'done' ? 'ok' : v.tone, text: `${v.name} ${VOICE[v.tone]}`, voice: true}));
    if (voices.length > MAX_VOICES) shown.push({id: 'v:more', tone: 'off', text: `另 ${voices.length - MAX_VOICES} 个`, voice: true});
    return {segs: segs.concat(shown), unsynced};
  }

  // ---------- 画 ----------
  let band = null, sig = '', since = 0, lastPair = '', engines = null, enginesAt = 0, syncing = false, known = null, knownFor = '', askedAt = 0;
  function build() {
    band = document.createElement('div');
    band.className = 'pk-metre-backstage';
    band.setAttribute('role', 'status');
    band.setAttribute('aria-label', '后台状态');
    band.addEventListener('click', (event) => { if (event.target.closest('.pk-bs__sync')) void resync(event.target.closest('.pk-bs__sync')); });
    document.body.append(band);
  }
  function place() {
    const main = document.querySelector('main.content');
    const r = main?.getBoundingClientRect();
    if (!r || r.width < 320) return false;
    const head = document.querySelector('.dashboard-header')?.getBoundingClientRect();   // 放在对话页顶上那一行（会话标题和右边菜单之间的空当）；首页没有就贴内容区顶上
    const top = head && head.height && head.bottom > r.top ? Math.max(2, head.top + head.height / 2 - 13) : r.top + 10;
    band.style.top = Math.round(top) + 'px';
    band.style.left = Math.round(r.left + r.width / 2) + 'px';
    band.dataset.narrow = r.width < 760 ? '1' : '';
    return true;
  }
  let unsyncTimer = 0;
  function render() {
    if (!isMetre()) { if (band) band.hidden = true; return; }
    const rs = runState(), p = pane(), st = p?.state || {};
    const page = {busy: Boolean(st.chatRunId || st.chatSending || st.chatStream), writing: Boolean(st.chatStream)};
    const now = Date.now();
    // 后台的回话：run-status 只在一轮在跑时每 3 秒问一次，空闲时那份会过期。记住最近一次的回话；过期了、或者两边对不上，
    // 就请 run-status 用它自己的那条路（pinkie.run.status）再问一次，最多 3 秒一次——挂在同一个节拍上，不另起定时器。
    if (rs?.key !== knownFor) { knownFor = rs?.key || ''; known = null; }
    if (rs?.status) known = rs.status;
    if ((!rs?.status || Boolean(known?.active) !== page.busy) && rs?.conn?.online !== false && now - askedAt > 3000) { askedAt = now; void window.__pinkieRunStatus?.refresh?.(); }
    const status = known;
    const pair = `${status == null ? '?' : Boolean(status.active)}|${page.busy}`;
    if (pair !== lastPair) {
      lastPair = pair; since = status != null && Boolean(status.active) !== page.busy ? now : 0;
      clearTimeout(unsyncTimer); if (since) unsyncTimer = setTimeout(render, UNSYNC_MS + 60);   // 对不上了：3 秒后再看一次（一次性，不是循环）
    }
    if (now - enginesAt > ENGINE_EVERY) { enginesAt = now; rpc('pinkie.engines.status', {}, 8000).then((v) => { engines = v && typeof v === 'object' ? v : null; sig = ''; render(); }).catch(() => {}); }
    const board = window.__pinkieMetreBoardData?.data;
    const voices = (board?.sessions || []).filter((s) => s && s.external).map((s) => ({key: s.key, name: String(s.engineName || s.title || s.label || '引擎').slice(0, 18), tone: voiceState(s)}));
    const view = describe({conn: rs?.conn || null, status, page, queue: Array.isArray(st.chatQueue) ? st.chatQueue.length : 0, engines, voices, since, now});
    if (!band) build();
    band.hidden = !place();
    const next = JSON.stringify(view.segs) + syncing;
    if (next === sig) return;
    sig = next;
    band.dataset.unsynced = view.unsynced ? '1' : '';
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
    band.innerHTML = '<span class="pk-bs__label" aria-hidden="true">后台</span>' + view.segs.map((s) =>
      `<span class="pk-bs__seg${s.voice ? ' pk-bs__seg--voice' : ''}" data-seg="${esc(s.id)}" data-tone="${s.tone}">${esc(s.text)}${s.sync
        ? `<button type="button" class="pk-bs__sync"${syncing ? ' disabled aria-busy="true"' : ''}>${syncing ? '同步中' : '同步'}</button>` : ''}</span>`).join('');
  }
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
  window.addEventListener('laolao:modechange', () => { sig = ''; render(); });
  window.addEventListener('pinkie:session-selected', () => { lastPair = ''; sig = ''; enginesAt = 0; render(); });
  window.addEventListener('resize', () => { if (band && !band.hidden) place(); });
})();
