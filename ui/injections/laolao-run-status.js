/* laolao-run-status:v1 —— 输入框上方一条常驻的运行状态条（计划书 B 第二、四节）
 *
 *   [碧琪表情] 在做第 3 步，共 6 步：截图核对手机宽度    已用 2 分 10 秒   [停下]
 *
 * 数据：网关只读接口 pinkie.run.status（档位、审稿、补做）+ pinkie.plan.get（计划清单）
 * + laolao-sidebar 广播的 pinkie:gateway-event（思考 / 工具 / 回复 / 等确认 / 结束）。
 * 文案在 describe() 里，是纯函数：同样的输入永远同样的一行字，测试直接验它。
 * 窗口窄于 520px 收成一个带表情的小圆点，点开是同样内容的浮层。
 * 断线时显示「连接断了，正在重连（第 N 次）」；连上后重新读 pinkie.run.status，
 * 不把「断了」当成「做完了」；真结束了就发 pinkie:run-recovered，由 laolao-run-notify 补一次提醒。
 * 发送路径一律交给原生（和 queue-steer 同一原则），这里从不发消息；停下优先点原生的停止键。 */
(() => {
  'use strict';
  if (window.__pinkieRunStatus) return;

  // ---------- 文案与模型（纯函数） ----------
  const PHRASE = {
    thinking: '碧琪在动小脑瓜…', working: '碧琪在抛气球干活…', writing: '碧琪在比划着回你…',
    asking: '碧琪在等你点头…', done: '完成啦！', stopped: '这一轮停下来了',
  };
  const USUAL_KINDS = new Set(['review', 'fix', 'alt', 'recheck', 'trial', 'remedy', 'bg']);
  const SKIPPABLE = new Set(['review', 'fix', 'alt', 'recheck', 'trial', 'remedy']);
  const KEEP = 20;
  const SLOW_FACTOR = 3;
  const SHOW_DONE_MS = 4000;
  const SHOW_STOPPED_MS = 6000;
  // 档位里各种「另做一版」的角色（后端缺口文字里带角色名），换成大白话。
  const ROLE_TEXT = [
    [/独立起草|求解|起草/, 'alt', '另做一版对照', 'working'],
    [/看图审稿|批评|真实验证|审稿|仲裁/, 'review', '审稿员在打开成品核对', 'thinking'],
    [/独立复算|复算/, 'recheck', '另算一遍核对数字', 'working'],
    [/用户视角试用|试用/, 'trial', '换成你的视角试一遍', 'working'],
  ];
  // 补做哪一步：后端缺口原文很长，这里只取能看懂的短说法。
  const REMEDY = [
    [/手机宽度/, '手机宽度截图'],
    [/测试/, '改完跑一遍测试'],
    [/页面.*截图|截图.*页面/, '截图看改完的页面'],
    [/运行起来|启动或运行|真的打开或运行/, '真的运行看一眼'],
    [/抽帧/, '抽帧看成片'],
    [/时长|文件大小/, '核对成片时长'],
    [/页面图片|转成图片|交出去的文件/, '打开交付文件核对'],
    [/程序算|计算输出|验算/, '用程序验算数字'],
    [/图表|图片/, '打开图片看一眼'],
    [/再跑一次/, '修完再跑一遍'],
    [/复现/, '先把问题复现出来'],
    [/公开地址/, '从外面打开网址'],
    [/dry-run|测试文件夹/, '先试跑一次'],
    [/定时|常驻/, '确认定时任务登记上了'],
    [/尺寸和分辨率/, '核对印刷尺寸'],
    [/检测或版本/, '跑一下电脑检测'],
    [/来源/, '再找一个来源核对'],
    [/验证证据/, '亲手验证一遍'],
    [/没交代结果/, '把结果说清楚'],
  ];

  function duration(ms) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60), rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60), mins = minutes % 60;
    return mins ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
  }
  const roughly = (ms) => (ms >= 60_000 ? duration(Math.round(ms / 60_000) * 60_000) : duration(ms));

  function median(list) {
    const values = (Array.isArray(list) ? list : []).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!values.length) return 0;
    const mid = values.length >> 1;
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }
  function recordDuration(durations, kind, ms) {
    const next = {...(durations || {})};
    if (!kind || !(ms > 0)) return next;
    next[kind] = [...(Array.isArray(next[kind]) ? next[kind] : []), Math.round(ms)].slice(-KEEP);
    return next;
  }
  const layoutFor = (width) => (Number(width) < 520 ? 'dot' : 'bar');

  function roleOf(missing) {
    for (const text of missing || []) {
      for (const [pattern, kind, label, sticker] of ROLE_TEXT) if (pattern.test(String(text))) return {kind, label, sticker};
    }
    return null;
  }
  function remedyOf(missing) {
    for (const text of missing || []) {
      if (ROLE_TEXT.some(([pattern]) => pattern.test(String(text)))) continue;
      for (const [pattern, label] of REMEDY) if (pattern.test(String(text))) return label;
    }
    return (missing || []).length ? '漏掉的一步' : '';
  }
  function stepsOf(items, labelOf, doneOf) {
    if (!Array.isArray(items) || items.length < 2) return null;
    let index = items.findIndex((item) => item.status === 'in_progress');
    if (index < 0) index = items.findIndex((item) => !doneOf(item));
    if (index < 0) return null;
    const label = String(labelOf(items[index]) || '').trim();
    return {text: `在做第 ${index + 1} 步，共 ${items.length} 步${label ? '：' + label : ''}`, label};
  }

  /** One line for one moment. Pure: input → {visible, text, meta, sticker, tone, actions, kind, slow}. */
  function describe(input = {}) {
    const now = Number(input.now) || Date.now();
    const live = input.live || {};
    const status = input.status || null;
    const conn = input.conn || {online: true, attempt: 0};
    const ended = input.ended || null;
    const active = Boolean(live.active || status?.active);
    const hidden = {visible: false, text: '', meta: '', sticker: 'thinking', tone: 'run', actions: [], kind: '', slow: false};
    const elapsed = live.startedAt ? `已用 ${duration(now - live.startedAt)}` : '';

    const justEnded = ended && now - Number(ended.at || 0) <= SHOW_STOPPED_MS;
    if (conn.online === false) {
      if (!active && !justEnded) return hidden;
      return {...hidden, visible: true, kind: 'offline', tone: 'warn', sticker: 'oops',
        text: `连接断了，正在重连（第 ${Math.max(1, Number(conn.attempt) || 1)} 次）`, meta: elapsed};
    }
    if (active && (live.state === 'asking' || live.ask)) {
      return {...hidden, visible: true, kind: 'ask', tone: 'ask', sticker: 'asking',
        text: String(live.ask?.text || '').trim() || PHRASE.asking, meta: elapsed,
        actions: [{id: 'answer', label: '去确认'}]};
    }
    if (!active) {
      if (!ended) return hidden;
      const stopped = ended.outcome === 'stopped' || ended.outcome === 'error';
      if (ended.outcome !== 'done' && !stopped) return hidden;
      if (now - Number(ended.at || 0) > (stopped ? SHOW_STOPPED_MS : SHOW_DONE_MS)) return hidden;
      return {...hidden, visible: true, kind: stopped ? 'stopped' : 'done', tone: stopped ? 'stop' : 'done',
        sticker: stopped ? 'oops' : 'done', text: stopped ? PHRASE.stopped : PHRASE.done,
        meta: ended.ms ? `用了 ${duration(ended.ms)}` : ''};
    }

    let kind = 'run', text = '', sticker = 'thinking';
    const review = status?.review?.phase || '';
    const role = ['working', 'dispatching'].includes(status?.phase) ? roleOf(status?.missing) : null;
    const continued = Number(status?.continuations?.tier) > 0;
    const planSteps = stepsOf(input.plan?.items, (item) => item.text, (item) => item.status === 'completed');
    const stageSteps = stepsOf(status?.workflow?.stages, (stage) => stage.label, (stage) => stage.used);
    if (review === 'reviewing') { kind = 'review'; text = '审稿员在打开成品核对'; sticker = 'thinking'; }
    else if (review === 'fixing') { kind = 'fix'; text = '照审稿意见在修改'; sticker = 'working'; }
    else if (continued && (status?.missing || []).length && remedyOf(status.missing)) { kind = 'remedy'; text = '补做：' + remedyOf(status.missing); sticker = 'working'; }
    else if (role) { ({kind, label: text, sticker} = role); }
    else if (live.bg?.startedAt) { kind = 'bg'; text = `等后台命令（已跑 ${duration(now - live.bg.startedAt)}）`; sticker = 'working'; }
    else if (planSteps) { kind = 'steps'; text = planSteps.text; sticker = live.state === 'writing' ? 'writing' : 'working'; }
    else if (stageSteps && status?.workflow) { kind = 'steps'; text = stageSteps.text; sticker = 'working'; }
    else {
      const state = ['thinking', 'working', 'writing'].includes(live.state) ? live.state : 'thinking';
      text = PHRASE[state]; sticker = state;
    }

    const actions = [{id: 'stop', label: '停下'}];
    const usual = USUAL_KINDS.has(kind) && (input.durations?.[kind] || []).length >= 3 ? median(input.durations[kind]) : 0;
    const phaseFor = input.phaseSince && (input.phaseKind == null || input.phaseKind === kind) ? now - input.phaseSince : 0;
    const meta = [elapsed, usual ? `平时约 ${roughly(usual)}` : ''].filter(Boolean).join(' · ');
    if (usual && phaseFor > usual * SLOW_FACTOR) {
      if (SKIPPABLE.has(kind)) actions.push({id: 'skip', label: '不等审稿，先交'});
      return {visible: true, kind, slow: true, tone: 'slow', sticker, text: '比平时久，还在跑',
        meta: [text, `这一步 ${duration(phaseFor)}`].join(' · '), actions};
    }
    return {visible: true, kind, slow: false, tone: 'run', sticker, text, meta, actions};
  }

  const model = {describe, layoutFor, median, recordDuration, duration, PHRASE};

  // ---------- 运行时：没有页面（测试）时到这里为止 ----------
  if (typeof HTMLElement === 'undefined') {
    window.__pinkieRunStatus = model;
    return;
  }

  const DURATIONS_KEY = 'pinkie:run-status:durations:v1';
  const STICKER = (state) => `./laolao-pinkie-status-${state}.png`;
  const RUNNING = /Command still running \(session ([\w.-]+), pid (\d+|n\/a)\)/;
  const EXITED = /Process exited with (?:code|signal)/;
  const SESSION = /^agent:(?:main|project|thinking|learning|unrestricted):/;
  const request = (method, params, timeout = 10_000) => {
    const gw = window.__laolaoSidebar?.gwRequest;
    return typeof gw === 'function' ? gw(method, params, timeout) : Promise.reject(new Error('gateway unavailable'));
  };
  const currentSession = () => {
    try {
      const routed = new URL(location.href).searchParams.get('session') || '';
      if (routed) return routed;
    } catch {}
    return document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset.sessionKey || '';
  };
  let durations = {};
  try { durations = JSON.parse(localStorage.getItem(DURATIONS_KEY) || '{}') || {}; } catch { durations = {}; }
  const saveDurations = () => { try { localStorage.setItem(DURATIONS_KEY, JSON.stringify(durations)); } catch {} };

  const lives = new Map();   // sessionKey → {active, state, startedAt, runId, ask, bg}
  const statuses = new Map(); // sessionKey → {value, at}
  const plans = new Map();    // sessionKey → plan
  const endings = new Map();  // sessionKey → {outcome, at, ms}
  const conn = {online: true, attempt: 0, wasActive: false, runId: '', key: ''};
  const phase = {key: '', kind: '', since: 0};
  let skipped = '';
  const liveOf = (key) => {
    let live = lives.get(key);
    if (!live) { live = {active: false, state: '', startedAt: 0, runId: '', ask: null, bg: null}; lives.set(key, live); }
    return live;
  };
  const freshStatus = (key) => {
    const entry = statuses.get(key);
    return entry && Date.now() - entry.at < 15_000 ? entry.value : null;
  };

  // ---------- 读状态 ----------
  // One request per session at a time; a refresh asked for meanwhile runs right
  // after it (a state change must not wait for the next 3-second poll).
  const inflight = new Map();
  const again = new Map();
  function refresh(key, {plan = false} = {}) {
    if (!key || !SESSION.test(key)) return Promise.resolve(null);
    if (inflight.has(key)) {
      again.set(key, again.get(key) || plan);
      return inflight.get(key).then(() => (again.has(key) ? refresh(key, {plan: again.get(key)}) : statuses.get(key)?.value || null));
    }
    const job = fetchStatus(key, plan).finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }
  async function fetchStatus(key, plan) {
    again.delete(key);
    try {
      const value = await request('pinkie.run.status', {sessionKey: key}, 8000);
      statuses.set(key, {value: value || null, at: Date.now()});
      if (plan || value?.active) {
        try { const result = await request('pinkie.plan.get', {sessionKey: key}, 8000); plans.set(key, result?.plan || null); } catch {}
      }
      return value;
    } catch { return null; } // 老网关没有这个接口：只用实时事件
    finally { schedule(); }
  }

  // ---------- 实时事件 ----------
  const textOf = (value) => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value ?? ''); } catch { return ''; }
  };
  function begin(key, runId) {
    const live = liveOf(key);
    if (!live.active) Object.assign(live, {startedAt: Date.now(), ask: null});
    Object.assign(live, {active: true, runId: runId || live.runId, state: live.state === 'asking' ? 'asking' : 'thinking'});
    endings.delete(key);
    if (key === currentSession()) skipped = '';
  }
  function end(key, outcome) {
    const live = liveOf(key);
    if (!live.active && !live.startedAt) return;
    endings.set(key, {outcome, at: Date.now(), ms: live.startedAt ? Date.now() - live.startedAt : 0});
    Object.assign(live, {active: false, state: '', ask: null, startedAt: 0});
    // 档位可能接着跑下一段：马上问一次网关，还在跑就继续显示。
    setTimeout(() => void refresh(key), 600);
  }
  window.addEventListener('pinkie:gateway-event', (event) => {
    const {event: name, payload} = event.detail || {};
    if (!payload) return;
    const key = String(payload.sessionKey || currentSession() || '');
    if (!key || !SESSION.test(key) || /:subagent:/.test(key)) return;
    const data = payload.data || {};
    if (name === 'agent' || name === 'session.tool') {
      const live = liveOf(key);
      if (payload.stream === 'lifecycle') {
        if (data.phase === 'start') begin(key, payload.runId);
        else if (data.phase === 'end' || data.phase === 'error') {
          const stopped = data.phase === 'error' || data.aborted === true || /abort|error/i.test(String(data.stopReason || ''));
          end(key, stopped ? 'stopped' : 'done');
        }
      } else if (['thinking', 'assistant', 'tool'].includes(payload.stream)) {
        if (!live.active) begin(key, payload.runId);
        if (payload.stream === 'thinking' && live.state !== 'asking') live.state = 'thinking';
        else if (payload.stream === 'assistant' && live.state !== 'asking') live.state = 'writing';
        else if (payload.stream === 'tool') {
          const tool = String(data.name || data.toolName || '');
          if (data.phase === 'start') {
            if (tool === 'ask_user') { live.state = 'asking'; live.ask = {text: String(data.args?.question || data.args?.prompt || '').slice(0, 80)}; }
            else live.state = 'working';
            if (/plan_update/.test(tool)) setTimeout(() => void refresh(key, {plan: true}), 200);
          } else if (data.phase === 'result') {
            if (tool === 'ask_user') { live.ask = null; live.state = 'thinking'; }
            else if (live.state === 'working') live.state = 'thinking';
            const out = textOf(data.result ?? data.partialResult ?? data.output);
            if (RUNNING.test(out)) live.bg = {startedAt: live.bg?.startedAt || Date.now()};
            else if (live.bg && EXITED.test(out)) live.bg = null;
            if (/plan_update/.test(tool)) setTimeout(() => void refresh(key, {plan: true}), 200);
          }
        }
      }
      schedule();
      return;
    }
    if (/^(?:exec|plugin)\.approval\.requested$/.test(String(name))) {
      const live = liveOf(key);
      live.state = 'asking'; live.ask = {text: '碧琪想跑一条命令，可以吗？'};
      schedule(); return;
    }
    if (/^(?:exec|plugin)\.approval\.resolved$/.test(String(name))) {
      const live = liveOf(key);
      if (live.state === 'asking') { live.state = 'working'; live.ask = null; }
      schedule(); return;
    }
    if (name === 'chat') {
      if (payload.state === 'final') end(key, 'done');
      else if (['aborted', 'error'].includes(payload.state)) end(key, 'stopped');
      schedule();
    }
  });

  // ---------- 断线与重连（只读原生网关仓库，不碰连接本身） ----------
  const gatewayStore = () => document.querySelector('openclaw-app-shell')?.context?.gateway || null;
  function connected() {
    const shell = document.querySelector('openclaw-app-shell');
    if (!shell) return true; // 还没起来，不算断线
    const snapshot = gatewayStore()?.snapshot;
    if (shell.gatewayConnected === true || shell.state?.gatewayConnected === true) return true;
    if (!snapshot) return true;
    return snapshot.connected === true || snapshot.phase === 'connected';
  }
  // 每次重连都会新建一条网关连接：数新连接就是「第几次」。只数，不碰连接本身。
  (() => {
    const Prior = window.WebSocket;
    if (typeof Prior !== 'function' || Prior.__pinkieRunStatusCounted) return;
    const Counted = function (url, protocols) {
      const ws = protocols !== undefined ? new Prior(url, protocols) : new Prior(url);
      try {
        let gateway = /18789/.test(String(url));
        try { gateway = gateway || new URL(String(url), location.href).host === location.host; } catch {}
        if (gateway && !conn.online) { conn.attempt += 1; schedule(); }
      } catch {}
      return ws;
    };
    Counted.prototype = Prior.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Counted[k] = Prior[k];
    Counted.__pinkieRunStatusCounted = true;
    window.WebSocket = Counted;
  })();
  let subscribed = false;
  function watchStore() {
    const gateway = gatewayStore();
    if (subscribed || !gateway || typeof gateway.subscribe !== 'function') return;
    subscribed = true;
    gateway.subscribe(() => checkConnection());
  }
  function checkConnection() {
    const online = connected();
    const key = currentSession();
    if (!online) {
      if (conn.online) {
        const live = liveOf(key);
        Object.assign(conn, {online: false, attempt: 0, wasActive: Boolean(live.active || freshStatus(key)?.active), runId: live.runId, key});
        schedule();
      }
      return;
    }
    if (!conn.online) recover();
  }
  async function recover() {
    if (conn.online) return;
    const {wasActive, runId} = conn;
    const key = conn.key || currentSession();
    Object.assign(conn, {online: true, attempt: 0});
    schedule();
    if (!wasActive) return;
    const value = await refresh(key, {plan: true});
    const live = liveOf(key);
    // 第二个证据：原生会话记录自己说还有没有在跑的一轮（普通聊天不一定进档位状态）。
    let nativeActive = null;
    try {
      const agentId = key.split(':')[1];
      const list = await request('sessions.list', {agentId, limit: 200}, 8000);
      const row = (list?.sessions || []).find((item) => item?.key === key);
      if (row && typeof row.hasActiveRun === 'boolean') nativeActive = row.hasActiveRun;
    } catch {}
    if (value?.active || nativeActive === true) { if (!live.active) { live.active = true; live.state = live.state || 'thinking'; } schedule(); return; }
    if (!value && nativeActive === null) return; // 读不到：什么都不说，等下一个事件
    // 断线期间这一轮已经结束：不在条上冒充「完成啦」，只补一次提醒。
    Object.assign(live, {active: false, state: '', ask: null, bg: null});
    let text = '';
    try {
      const history = await request('chat.history', {sessionKey: key, limit: 4}, 8000);
      const last = [...(history?.messages || [])].reverse().find((m) => m?.role === 'assistant');
      const content = last?.content;
      text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('') : '';
    } catch {}
    window.dispatchEvent(new CustomEvent('pinkie:run-recovered', {detail: {sessionKey: key, runId: runId || value?.runId || '', outcome: 'done', text}}));
    schedule();
  }
  window.addEventListener('pinkie:gateway-reconnected', () => { if (!conn.online) void recover(); });

  // ---------- 画面 ----------
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let bar = null, parts = null, open = false, scheduled = false, lastSig = '';
  function build() {
    bar = el('section', 'pk-run');
    bar.setAttribute('aria-label', '碧琪的进度');
    bar.hidden = true;
    const dot = el('button', 'pk-run__dot'); dot.type = 'button';
    dot.setAttribute('aria-expanded', 'false');
    dot.setAttribute('aria-label', '看看碧琪在做什么');
    const dotFace = el('img', 'pk-run__dot-face'); dotFace.alt = ''; dotFace.decoding = 'async';
    dot.append(dotFace);
    dot.addEventListener('click', () => { open = !open; render(true); });
    const body = el('div', 'pk-run__body');
    const face = el('img', 'pk-run__face'); face.alt = ''; face.decoding = 'async';
    const text = el('span', 'pk-run__text'); text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
    const meta = el('span', 'pk-run__meta');
    const actions = el('span', 'pk-run__actions');
    body.append(face, text, meta, actions);
    bar.append(dot, body);
    document.body.append(bar);
    parts = {dot, dotFace, body, face, text, meta, actions};
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && open) { open = false; render(true); parts.dot.focus(); } });
  }
  const composer = () => document.querySelector('.agent-chat__input') || document.querySelector('.agent-chat__composer-shell');
  // Measuring forces a layout of the whole chat page, so it never runs on the
  // one-second text tick: only when the composer resizes, the window resizes,
  // the bar appears or changes layout, and as a slow fallback every 5 seconds.
  let placed = null, placeDirty = true, watched = null;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { placeDirty = true; schedule(); }) : null;
  function place() {
    const anchor = composer();
    if (!anchor || !bar) return false;
    if (anchor !== watched) { observer?.disconnect(); observer?.observe(anchor); watched = anchor; placeDirty = true; }
    if (!placeDirty && placed) return true;
    placeDirty = false;
    const rect = anchor.getBoundingClientRect();
    placed = rect.width ? rect : null;
    if (!placed) return false;
    bar.style.left = `${Math.round(rect.left)}px`;
    bar.style.width = bar.dataset.layout === 'bar' ? `${Math.round(rect.width)}px` : '';
    bar.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
    return true;
  }
  function act(id) {
    const key = currentSession();
    if (id === 'stop') {
      const stop = document.querySelector('.agent-chat__input .chat-send-btn--stop');
      if (stop) stop.click();
      else void request('chat.abort', {sessionKey: key}).catch(() => {});
    } else if (id === 'skip') {
      const status = freshStatus(key);
      skipped = key;
      if (['reviewing', 'fixing'].includes(status?.review?.phase)) {
        void request('pinkie.reasoning.cancel', {sessionKey: key, requestId: status.review.requestId || ''}).catch(() => {});
      }
      if (status?.selection?.workTier) void request('pinkie.deepThink.disarm', {sessionKey: key}).catch(() => {});
      setTimeout(() => void refresh(key), 500);
    } else if (id === 'answer') {
      const target = document.querySelector('.laolao-ask button, .laolao-ask input, [class*="approval"] button');
      target?.scrollIntoView?.({block: 'nearest'});
      target?.focus?.();
    }
  }
  function setActions(actions) {
    const sig = actions.map((a) => a.id).join(',');
    if (parts.actions.dataset.sig === sig) return;
    parts.actions.dataset.sig = sig;
    parts.actions.replaceChildren(...actions.map((a) => {
      const button = el('button', 'pk-run__btn', a.label); button.type = 'button';
      button.dataset.act = a.id;
      button.addEventListener('click', () => act(a.id));
      return button;
    }));
  }
  function render(force = false) {
    scheduled = false;
    const key = currentSession();
    if (!SESSION.test(key)) { if (bar) bar.hidden = true; return; }
    const live = liveOf(key);
    const status = freshStatus(key);
    const now = Date.now();
    const input = {now, live, status: skipped === key && status ? {...status, review: {phase: 'idle'}, missing: [], continuations: {tier: 0}} : status,
      plan: plans.get(key), conn, ended: endings.get(key), durations, phaseSince: phase.since, phaseKind: phase.kind};
    let view = describe(input);
    // 阶段换了：记下上一个阶段用了多久（只记有「平时要多久」的那几类，断线不算）。
    if (view.kind !== phase.kind && view.kind !== 'offline') {
      if (USUAL_KINDS.has(phase.kind) && phase.since && conn.online && now - phase.since > 1500) {
        durations = recordDuration(durations, phase.kind, now - phase.since); saveDurations();
      }
      Object.assign(phase, {kind: view.kind, since: now});
      view = describe({...input, phaseSince: phase.since, phaseKind: phase.kind});
    }
    if (!view.visible) {
      if (bar && !bar.hidden) { bar.classList.remove('is-shown'); bar.hidden = true; open = false; }
      document.documentElement.classList.remove('pk-run-on');
      lastSig = '';
      return;
    }
    if (!bar) build();
    const layout = layoutFor(window.innerWidth);
    if (bar.dataset.layout !== layout) { bar.dataset.layout = layout; open = false; force = true; placeDirty = true; }
    bar.dataset.tone = view.tone;
    bar.classList.toggle('is-open', layout === 'dot' && open);
    parts.dot.setAttribute('aria-expanded', String(layout === 'dot' && open));
    const sig = [view.text, view.meta, view.sticker, view.tone].join('|');
    if (force || sig !== lastSig) {
      lastSig = sig;
      if (parts.text.textContent !== view.text) parts.text.textContent = view.text;
      parts.text.title = view.text;
      if (parts.meta.textContent !== view.meta) parts.meta.textContent = view.meta;
      parts.meta.hidden = !view.meta;
      const src = STICKER(view.sticker);
      if (parts.face.getAttribute('src') !== src) { parts.face.setAttribute('src', src); parts.dotFace.setAttribute('src', src); }
      setActions(view.actions);
    }
    if (!place()) { bar.hidden = true; document.documentElement.classList.remove('pk-run-on'); return; }
    document.documentElement.classList.toggle('pk-run-on', layout === 'bar');
    if (bar.hidden) {
      placeDirty = true; place();
      bar.hidden = false;
      // 先摆好位置再淡入：只动 opacity / transform。
      requestAnimationFrame(() => bar.classList.add('is-shown'));
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(() => render()); } }

  // ---------- 节拍：一秒一次只改文字；运行中每 3 秒问一次网关 ----------
  let beat = 0, lastKey = '';
  setInterval(() => {
    beat += 1;
    watchStore();
    checkConnection();
    const key = currentSession();
    if (key !== lastKey) { lastKey = key; open = false; skipped = ''; void refresh(key, {plan: true}); }
    const live = liveOf(key);
    const active = live.active || freshStatus(key)?.active;
    if (conn.online && active && beat % 3 === 0) void refresh(key);
    if (beat % 5 === 0) placeDirty = true;
    if (active || bar && !bar.hidden) render();
  }, 1000);
  window.addEventListener('resize', () => { placeDirty = true; schedule(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { void refresh(currentSession()); schedule(); } });
  window.addEventListener('pinkie:motion-change', schedule);

  window.__pinkieRunStatus = {...model, refresh: () => refresh(currentSession(), {plan: true}), render: () => render(true),
    get state() { return {key: currentSession(), live: liveOf(currentSession()), status: freshStatus(currentSession()), conn: {...conn}, phase: {...phase}, durations}; }};
})();
