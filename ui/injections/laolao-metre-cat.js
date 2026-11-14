/* laolao-metre-cat —— Metre 的像素黑猫和项目记忆芯片（PLAN 2.11、6.2；批 4、批 M）
 *
 * 帧数据：laolao-metre-cat-frames.js，和 briefs/metre-mode-1113/ref/metre-cat.js 逐字节相同
 * （用户 11-14 看过预览点头的那一版，测试守着，不许改帧）。
 *
 * 位置：运行状态条最左边（代替碧琪表情），窄窗口的小圆点里也是它。别处不放。
 * 状态：听 laolao-run-status 的 pinkie:run-view（这一刻在干什么），换成 16 个状态之一。
 * 节奏：最高 8 帧每秒，一个计时器；页面不可见就停；「减少动效」只画每个状态的第一帧；
 * 空闲时眨一次眼后静止，隔 6～10 秒再眨；空闲超过 10 分钟睡觉。
 *
 * 记忆芯片：猫旁边 `◆ 37`（当前文件夹的条数，读 pinkie.metre.memory stats）；
 * 这一轮注入或写入时闪一下；点开是一个小浮层：文件夹名、了解程度 9 格条（看板第 9 区随批 5）。 */
(() => {
  'use strict';
  if (window.__pinkieMetreCat) return;

  const SCALE = 2;
  const SLEEP_AFTER_MS = 10 * 60_000;
  const DONE_MS = 3000;
  const ERROR_MS = 2500;
  const TICK_MS = 125;   // 8 拍每秒；各状态按自己的 fps 取帧（和预览页同一算法）
  const CATEGORY_NAMES = {overview: '项目概况', structure: '目录和关键文件', commands: '怎么跑、测、打包', conventions: '规矩',
    decisions: '定下的事', preferences: '偏好', pitfalls: '踩过的坑', people: '协作者', open: '没做完的'};

  // ---------- 纯函数：这一刻该是哪个状态 ----------
  const READ_TOOLS = /^(?:read|workbench_read|code_search|code_refs|code_check|grep|glob|ls|find|pinkie_session_list|pinkie_sessions|pinkie_models|metre_memory|learning_library|clekk_memory)$/;
  const SEARCH_TOOLS = /^(?:web_search|web_fetch|pinkie_search|browser|app_browser|web_gpt_activity)$/;
  const EXEC_TOOLS = /^(?:exec|bash|process|run_tests|computer|computer_flow)$/;
  const WRITE_TOOLS = /^(?:write|edit|apply_patch|code_edit|multi_edit)$/;
  const KIND_STATE = {create: 'create', write: 'write', delete: 'write', move: 'write', install: 'exec', build: 'exec', git: 'exec',
    download: 'search', view: 'image', shot: 'image', dispatch: 'dispatch', wait: 'waiting', review: 'review',
    manage: 'read', models: 'read', memory: 'read'};

  function stateFor(detail = {}, now = Date.now(), idleSince = now) {
    const kind = detail.kind || '';
    const live = detail.live || {};
    const ended = detail.ended || null;
    if (kind === 'offline' || kind === 'offline-idle') return 'stopped';
    if (kind === 'ask' || live.state === 'asking') return 'ask';
    if (kind === 'stopped') return ended && ended.outcome === 'error' ? 'error' : 'stopped';
    if (kind === 'done') return 'done';
    if (kind === 'wait') return 'waiting';
    if (kind === 'review' || kind === 'fix') return 'review';
    if (live.active) {
      if (live.toolError && now - live.toolError < ERROR_MS) return 'error';
      if (live.state === 'working') {
        if (KIND_STATE[live.tool]) return KIND_STATE[live.tool];
        const name = String(live.toolName || '');
        if (name === 'pinkie_session_start' || name === 'pinkie_mode_ask') return 'dispatch';
        if (name === 'image') return 'image';
        if (WRITE_TOOLS.test(name)) return 'write';
        if (SEARCH_TOOLS.test(name)) return 'search';
        if (READ_TOOLS.test(name)) return 'read';
        if (EXEC_TOOLS.test(name)) return 'exec';
        return 'exec';
      }
      if (live.state === 'writing') return 'write';
      return 'think';
    }
    if (kind === 'steps' || kind === 'bg' || kind === 'remedy' || kind === 'alt' || kind === 'recheck' || kind === 'trial') return 'exec';
    return now - idleSince >= SLEEP_AFTER_MS ? 'sleep' : 'idle';
  }

  // 第几帧：以 8 拍每秒为底按 fps 取帧（同预览页）；空闲只眨一次就停在第一帧，隔 6～10 秒再来一遍。
  function frameIndex(state, def, tick, reduced, blinkAt) {
    if (reduced || !def || def.frames.length < 2) return 0;
    if (state === 'idle') {
      if (blinkAt == null) return 0;
      const step = Math.floor((tick - blinkAt) * def.fps / 8);
      return step >= 0 && step < def.frames.length ? step : 0;
    }
    return Math.floor(tick * def.fps / 8) % def.frames.length;
  }

  const model = {stateFor, frameIndex, SLEEP_AFTER_MS};
  const cat = () => window.LaolaoMetreCat;
  const isMetre = () => document.documentElement.getAttribute('data-laolao-mode') === 'metre';
  const reduced = () => document.documentElement.hasAttribute('data-pinkie-reduce-motion')
    || Boolean(window.__pinkieMotion?.reduce) || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dark = () => document.documentElement.hasAttribute('data-pinkie-night') || document.documentElement.dataset.theme === 'dark';

  // ---------- 画面 ----------
  let canvases = [], chip = null, pop = null, timer = 0, tick = 0, state = 'idle', lastDrawn = '';
  let idleSince = Date.now(), blinkAt = null, nextBlink = 0, detail = {}, doneUntil = 0, lastDone = 0;
  let memory = {count: null, key: '', folder: '', name: '', byCategory: {}, known: 0}, memoryFor = '', memoryAt = 0;

  function makeCanvas(cls) {
    const c = document.createElement('canvas');
    c.className = cls;
    c.width = 16 * SCALE; c.height = 16 * SCALE;
    c.setAttribute('aria-hidden', 'true');
    return c;
  }
  function mount() {
    const body = document.querySelector('.pk-run__body');
    const dot = document.querySelector('.pk-run__dot');
    if (!body || !isMetre()) return false;
    if (!body.querySelector('.pk-metre-cat')) {
      const c = makeCanvas('pk-metre-cat');
      body.prepend(c);
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pk-metre-mem';
      chip.hidden = true;
      chip.addEventListener('click', (event) => { event.stopPropagation(); togglePop(); });
      c.after(chip);
    }
    if (dot && !dot.querySelector('.pk-metre-cat')) dot.prepend(makeCanvas('pk-metre-cat pk-metre-cat--dot'));
    canvases = [...document.querySelectorAll('.pk-metre-cat')];
    chip = body.querySelector('.pk-metre-mem');
    return true;
  }

  function paint(force = false) {
    const api = cat();
    if (!api || !canvases.length) return;
    const def = api.STATES[state] || api.STATES.idle;
    const index = frameIndex(state, def, tick, reduced(), blinkAt);
    const sig = `${state}:${index}:${dark() ? 1 : 0}`;
    if (!force && sig === lastDrawn) return;
    lastDrawn = sig;
    for (const c of canvases) {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      api.draw(ctx, def.frames[index], SCALE, {dark: dark()});
      c.dataset.state = state;
      c.title = def.label;
    }
  }

  function setState(next) {
    if (next === state) return;
    state = next;
    tick = 0;
    blinkAt = null;
    nextBlink = Date.now() + 6000 + Math.random() * 4000;
    paint(true);
  }

  function loop() {
    timer = 0;
    if (document.hidden || !isMetre() || !canvases.length || !canvases[0].isConnected) return;
    const now = Date.now();
    let next = stateFor(detail, now, idleSince);
    if (next === 'done') lastDone = lastDone || now;
    if (doneUntil > now && next === 'idle') next = 'done';
    setState(next);
    tick += 1;
    if (state === 'idle') {
      const def = cat()?.STATES.idle;
      if (blinkAt != null && def && tick - blinkAt >= def.frames.length * 8 / def.fps) blinkAt = null;
      if (blinkAt == null && now >= nextBlink) { blinkAt = tick; nextBlink = now + 6000 + Math.random() * 4000; }
    }
    paint();
    // 只有在动的时候才排下一拍；静止帧（空闲没眨眼、睡觉的慢帧也按它自己的 fps）不空转。
    const moving = !reduced() && (state !== 'idle' || blinkAt != null);
    timer = setTimeout(loop, moving ? TICK_MS : Math.max(250, Math.min(1000, nextBlink - now)));
  }
  function kick() { if (!timer && !document.hidden) timer = setTimeout(loop, 0); }
  function halt() { clearTimeout(timer); timer = 0; }

  // ---------- 记忆芯片 ----------
  const rpc = (method, params) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, 8000) : Promise.reject(new Error('网关还没连上'));
  async function refreshMemory(key, flash = false) {
    if (!/^agent:metre:/.test(key || '')) return;
    memoryFor = key; memoryAt = Date.now();
    try {
      const result = await rpc('pinkie.metre.memory', {sessionKey: key, action: 'stats'});
      if (!result || result.ok === false || memoryFor !== key) return;
      const switched = memory.key && result.key !== memory.key && memory.sessionKey === key;
      const before = memory.count;
      memory = {...result, sessionKey: key};
      renderChip(flash || (before != null && before !== result.count));
      if (switched) announceSwitch(result, before);
    } catch { /* 没连上：芯片先不出 */ }
  }
  function renderChip(flash) {
    if (!chip) return;
    if (memory.count == null) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = `◆ ${memory.count}`;
    chip.title = memory.folder ? `项目记忆：${memory.folder}` : '项目记忆：没绑文件夹';
    chip.setAttribute('aria-label', `项目记忆 ${memory.count} 条`);
    if (flash && !reduced()) { chip.classList.remove('is-flash'); void chip.offsetWidth; chip.classList.add('is-flash'); }
    if (pop && !pop.hidden) fillPop();
  }
  function knownBar() {
    const bar = document.createElement('span');
    bar.className = 'pk-metre-known';
    for (const [name, label] of Object.entries(CATEGORY_NAMES)) {
      const cell = document.createElement('i');
      const n = memory.byCategory?.[name] || 0;
      cell.className = n ? 'is-on' : '';
      cell.title = `${label}：${n ? `${n} 条` : '还没了解'}`;
      bar.append(cell);
    }
    return bar;
  }
  function fillPop() {
    pop.replaceChildren();
    const head = document.createElement('div');
    head.className = 'pk-metre-pop__head';
    head.textContent = memory.folder ? `现在用的是：${memory.name || memory.folder}` : '现在没绑文件夹';
    head.title = memory.folder || '';
    const count = document.createElement('div');
    count.className = 'pk-metre-pop__meta';
    count.textContent = `${memory.count} 条 · 了解了 ${memory.known || 0} / 9 类`;
    pop.append(head, count, knownBar());
  }
  function togglePop() {
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'pk-metre-pop';
      pop.hidden = true;
      document.body.append(pop);
      document.addEventListener('click', (event) => { if (pop && !pop.hidden && !pop.contains(event.target)) pop.hidden = true; });
    }
    if (!pop.hidden) { pop.hidden = true; return; }
    fillPop();
    const rect = chip.getBoundingClientRect();
    pop.style.left = `${Math.max(8, rect.left)}px`;
    pop.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
    pop.hidden = false;
  }
  function announceSwitch(now, before) {
    const note = document.createElement('div');
    note.className = 'pk-metre-switch';
    note.setAttribute('role', 'status');
    note.textContent = `已换到 ${now.name || now.folder || '没绑文件夹'}，上一个项目的 ${before || 0} 条记忆不会带进来`;
    document.querySelector('.pk-run')?.append(note);
    setTimeout(() => note.classList.add('is-out'), 3000);
    setTimeout(() => note.remove(), 3600);
  }

  // ---------- 事件 ----------
  window.addEventListener('pinkie:run-view', (event) => {
    if (!isMetre()) return;
    const d = event.detail || {};
    const wasActive = Boolean(detail.live?.active);
    detail = d;
    if (d.live?.active || d.kind !== 'idle') idleSince = Date.now();
    if (d.kind === 'done' && !doneUntil) doneUntil = Date.now() + DONE_MS;
    if (d.kind !== 'done' && d.kind !== 'idle') doneUntil = 0;
    if (mount()) kick();
    // 一轮开始（注入）和结束（可能写了）各读一次条数；换会话也读。
    const started = d.live?.active && !wasActive;
    if (d.key !== memoryFor || started || (wasActive && !d.live?.active)) void refreshMemory(d.key, started);
  });
  window.addEventListener('pinkie:gateway-event', (event) => {
    const payload = event.detail?.payload || {};
    const data = payload.data || {};
    if (payload.stream === 'tool' && data.phase === 'result' && String(data.name || data.toolName || '') === 'metre_memory') {
      void refreshMemory(memoryFor, true);
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) halt(); else { lastDrawn = ''; kick(); } });
  window.addEventListener('pinkie:motion-change', () => { lastDrawn = ''; kick(); });
  window.addEventListener('laolao:modechange', () => { if (!isMetre()) { halt(); if (pop) pop.hidden = true; } else { lastDrawn = ''; kick(); } });
  // 每分钟兜底读一次条数（别处改了记忆，例如看板）。
  setInterval(() => { if (isMetre() && memoryFor && !document.hidden && Date.now() - memoryAt > 55_000) void refreshMemory(memoryFor); }, 60_000);

  window.__pinkieMetreCat = {...model, get state() { return state; }, get memory() { return {...memory}; }, paint: () => paint(true)};
})();
