// 预览面板（只在预览页有，不是产品界面）：一键重放整页动画的几个时刻，模拟后台状态带的几种状态。
(() => {
  const q = new URLSearchParams(location.search);
  const go = (k, v) => { q.set(k, v); location.search = q.toString(); };
  const box = document.createElement('div');
  box.setAttribute('data-preview-panel', '');
  Object.assign(box.style, {position: 'fixed', right: '12px', top: '112px', zIndex: 2147483600, display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: 'calc(100vh - 60px)', overflow: 'auto',
    padding: '10px', borderRadius: '10px', background: 'rgba(20,20,20,.82)', color: '#fff', font: '12px/1.3 system-ui, sans-serif', boxShadow: '0 4px 18px rgba(0,0,0,.25)'});
  const fold = document.createElement('button'); fold.type = 'button'; fold.textContent = '预览面板（不是产品界面）· 点这里收起 / 展开';
  Object.assign(fold.style, {all: 'unset', cursor: 'pointer', opacity: '.75'}); box.append(fold);
  const body = document.createElement('div'); Object.assign(body.style, {display: 'flex', flexDirection: 'column', gap: '5px'}); box.append(body);
  fold.onclick = () => { body.hidden = !body.hidden; };
  const head = (t) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'margin-top:6px;opacity:.6'; body.append(d); };
  const btn = (label, fn, id) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (id) b.dataset.pv = id;
    Object.assign(b.style, {all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: '6px', background: 'rgba(255,255,255,.12)'});
    b.onmouseenter = () => b.style.background = 'rgba(255,255,255,.22)'; b.onmouseleave = () => b.style.background = 'rgba(255,255,255,.12)';
    b.onclick = fn; body.append(b); };
  const pane = () => document.querySelector('openclaw-chat-pane');
  const paint = () => { const p = pane(); p?.state?.requestUpdate?.(); p?.requestUpdate?.(); window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})); };

  head('整页动画');
  btn('▶ 只放 Metre 进场那一段（合上 → 五线 → 四拍音符跳上谱 → 翻开）', async () => {
    const t = window.PinkieMetreTransition?.play?.(); if (!t) { alert('现在是「减少动态效果」，转场不放。'); return; }
    await t.ready; await t.covered; t.finish();
  }, 'metre');
  btn('▶ 换会话（翻谱）', () => window.dispatchEvent(new CustomEvent('pinkie:session-selected', {detail: {}})), 'switch');
  btn('▶ 重放首页进场（亮灯 + 引导语按音高落回）', () => window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: 420}})), 'home');
  btn('▭ 首页画带矮于 180px（把窗口高度压到约 520px 再点）', () => { if (window.innerHeight > 560) alert('把浏览器窗口高度拖到 520px 左右，画带会自己变成只有一行五线谱；或者用 &h=520 的录帧脚本看。'); }, 'low');

  // Metre ⇄ 碧琪：预览的假网关只有一个会话，路由换不过去，所以这里按切换器里一模一样的顺序调同样的两个模块，
  // 「换路由」那一步换成换页面的模式皮（data-laolao-mode）。切换器本身的先后顺序由 tests/metre-leave.test.cjs 管。
  const PINK = {chat: '唠嗑模式', project: '项目模式', thinking: '想法模式', learning: '学习模式', unrestricted: '无限制模式'};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const skin = (id) => document.documentElement.setAttribute('data-laolao-mode', id);
  const modeObj = (id) => ({id, label: PINK[id], phrases: ['正在切换到' + PINK[id], PINK[id] + '马上就好'], readyPhrase: PINK[id] + '到了'});
  let pink = 'chat';
  const toPinkie = async (id = pink) => {   // 切换器里 Metre → 碧琪：Metre 离场 → covered → 碧琪转场 → covered → 拿掉谱纸 → 换路由 → 新页面好了 finish
    window.dispatchEvent(new CustomEvent('laolao:mode-transition-start', {detail: {mode: id}}));   // 切换器也发这一声：Metre 皮肤据此放出碧琪转场的样式表
    const exit = window.PinkieMetreTransition?.leave?.(); if (exit) await exit.covered;
    const fx = window.PinkieModeTransitionFx?.play?.(modeObj(id), {}) || null; if (fx) { await fx.ready; await fx.covered; }
    exit?.release(); skin(id); await sleep(300); if (fx) await fx.finish();
    window.dispatchEvent(new CustomEvent('laolao:mode-transition-finished', {detail: {mode: id}}));
  };
  const toMetre = async () => {             // 碧琪 → Metre：Metre 进场 → covered → 换路由 → finish（翻开）
    const t = window.PinkieMetreTransition?.play?.(); if (!t) { skin('metre'); return; }
    await t.ready; await t.covered; skin('metre'); await sleep(200); await t.finish();
  };
  head('Metre ⇄ 碧琪（下面选碧琪那一边是哪个模式）');
  const sel = document.createElement('select'); sel.dataset.pv = 'pink'; Object.entries(PINK).forEach(([id, label]) => sel.append(new Option(label, id)));
  sel.onchange = () => { pink = sel.value; }; Object.assign(sel.style, {padding: '4px', borderRadius: '6px'}); body.append(sel);
  btn('▶ 碧琪 → Metre（进场：音符跳动）', async () => { if (document.documentElement.getAttribute('data-laolao-mode') === 'metre') { skin(pink); await sleep(600); } await toMetre(); }, 'to-metre');
  btn('▶ Metre → 碧琪（Metre 离场 + 碧琪转场）', async () => { if (document.documentElement.getAttribute('data-laolao-mode') !== 'metre') { skin('metre'); await sleep(600); } await toPinkie(); }, 'to-pinkie');
  btn('▶ 来回连切（切进 Metre，2 秒后切回碧琪）', async () => { skin(pink); await sleep(600); await toMetre(); await sleep(2000); await toPinkie(); }, 'round-trip');
  btn('▶ 只放 Metre 离场那一段', async () => { const e = window.PinkieMetreTransition?.leave?.(); if (!e) { alert('现在是「减少动态效果」，离场不放。'); return; } await e.covered; await sleep(500); e.release(); }, 'leave-only');

  // 后台带：都是改「后台带读的那几份数据」，后台带自己的代码不动
  const rs = () => window.__pinkieRunStatus;
  let connOverride = null;
  const hookConn = () => {
    const o = rs(); if (!o || o.__pvHooked) return; o.__pvHooked = true;
    const desc = Object.getOwnPropertyDescriptor(o, 'state'); const get = desc?.get;
    if (get) Object.defineProperty(o, 'state', {configurable: true, get() { const s = get.call(o); return connOverride ? {...s, conn: {...s.conn, ...connOverride}} : s; }});
  };
  let engineOn = null, voices = null, runActive = null;
  const hookGw = () => {
    const sb = window.__laolaoSidebar; if (!sb || sb.__pvHooked) return; sb.__pvHooked = true;
    const real = sb.gwRequest.bind(sb);
    sb.gwRequest = (m, p, t) => (m === 'pinkie.engines.status' && engineOn != null ? Promise.resolve({enabled: engineOn, running: engineOn})
      : m === 'pinkie.run.status' && runActive != null ? Promise.resolve({active: runActive, runId: runActive ? 'preview-run' : ''}) : real(m, p, t));
    const bd = window.__pinkieMetreBoardData;
    if (bd) { const d = Object.getOwnPropertyDescriptor(bd, 'data'); Object.defineProperty(bd, 'data', {configurable: true, get() { const v = d.get.call(bd); return voices ? {...(v || {}), sessions: [...((v && v.sessions) || []), ...voices]} : v; }}); }
  };
  head('后台状态带（对话页顶上那一条）');
  const reset = () => { clearInterval(window.__pvHold); hookConn(); hookGw(); connOverride = null; engineOn = false; runActive = false; voices = null; const p = pane(); if (p?.state) { p.state.chatStream = null; p.state.chatRunId = null; p.state.chatSending = false; p.state.chatQueue = []; } };
  btn('● 正常（连着、两边一致、没排队、引擎关）', () => { reset(); void window.__pinkieRunStatus?.refresh?.(); paint(); }, 'bs-ok');
  btn('● 在跑（后台在跑、页面在等回复）', () => { reset(); runActive = true; const set = () => { const p = pane(); if (p?.state) p.state.chatRunId = 'preview-run'; };
    set(); window.__pvHold = setInterval(set, 100); void window.__pinkieRunStatus?.refresh?.(); paint(); }, 'bs-run');   // 预览里原生面板会自己清掉 chatRunId，这里按住（只在预览页）
  btn('● 网关重连中（第 2 次）', () => { hookConn(); connOverride = {online: false, attempt: 2}; paint(); }, 'bs-reconnect');
  btn('● 网关断了（总谱也跟着显示断线）', () => { hookConn(); hookGw(); connOverride = {online: false, attempt: 0}; window.dispatchEvent(new Event('pinkie:sidebar-gateway-lost')); paint(); }, 'bs-down');
  btn('● 断线后恢复（总谱的断线条和「此刻」一起恢复）', () => { hookConn(); connOverride = null; window.dispatchEvent(new Event('pinkie:sidebar-gateway-ready')); paint(); }, 'bs-recover');
  btn('● 不同步（后台说这一轮还在跑、页面已经停了；3 秒后出现「同步」键，点了就对齐）', () => { reset(); runActive = true;
    void window.__pinkieRunStatus?.refresh?.(); paint();
    document.addEventListener('click', (e) => { if (e.target.closest?.('.pk-bs__sync')) runActive = false; }, {capture: true}); }, 'bs-unsync');
  btn('● 排队 2 条', () => { const p = pane(); if (p?.state) p.state.chatQueue = [{id: 'pv1', text: '排队一', sessionKey: p.state.sessionKey}, {id: 'pv2', text: '排队二', sessionKey: p.state.sessionKey}]; paint(); }, 'bs-queue');
  btn('● 引擎开 + 四个引擎声部（在跑 / 等你 / 交回 / 失败；点「引擎」那一格看明细）', () => { hookGw(); engineOn = true;
    voices = [['Codex', 'run', 'running'], ['Claude', 'wait', 'waiting'], ['Kiro', 'done', 'done'], ['Gemini', 'fail', 'error']].map(([n, state, status], i) => ({key: 'agent:metre:eng:' + i, external: true, title: n, state, status}));
    window.dispatchEvent(new CustomEvent('pinkie:metre-board-data')); setTimeout(paint, 300); }, 'bs-engines');

  head('按键（悬停、按住、Tab 键看焦点；输入框空着时发送键是禁用）');
  btn('● 模拟一轮在跑（原生发送键变停止键，下沿拍子线一拍亮一次）', () => { const p = pane(); if (p?.state) { p.state.chatRunId = 'preview-run'; p.state.chatSending = false; } paint(); }, 'keys-run');
  btn('● 打开总谱（暂停分谱 / 全体收住 / 声部上的发消息、停、看）', () => document.querySelector('.pk-metre-nav--board')?.click(), 'keys-board');

  head('切换');
  btn(q.get('empty') === '1' ? '→ 换到对话页' : '→ 换到首页', () => go('empty', q.get('empty') === '1' ? '0' : '1'));
  btn(q.get('night') === '1' ? '☀ 换成日间' : '☾ 换成夜间', () => go('night', q.get('night') === '1' ? '0' : '1'));
  btn(document.documentElement.hasAttribute('data-pinkie-reduce-motion') ? '↺ 恢复动效' : '◌ 模拟「减少动态效果」', () => { const r = document.documentElement; if (r.hasAttribute('data-pinkie-reduce-motion')) r.removeAttribute('data-pinkie-reduce-motion'); else r.setAttribute('data-pinkie-reduce-motion', ''); });
  const mount = () => document.body ? document.body.append(box) : setTimeout(mount, 50); mount();
  window.__pv = {pane, paint, hookConn, hookGw, toPinkie, toMetre, skin, PINK};
})();
