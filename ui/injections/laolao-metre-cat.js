/* laolao-metre-cat —— Metre 的像素黑猫和项目记忆芯片（PLAN 2.11、6.2；批 4、批 M）
 *
 * 帧数据：laolao-metre-cat-frames.js，和 briefs/metre-mode-1113/ref/metre-cat.js 逐字节相同
 * （用户 11-14 看过预览点头的那一版，测试守着，不许改帧）。
 *
 * 位置：11-16 起坐在输入框右上沿（像 Claude 桌面版输入框上的小螃蟹），脚下的阴影压在边框上；
 *       状态条里只留记忆芯片。窄窗口的小圆点里的那只照旧隐藏。
 * 空闲小动作（11-16 用户：「不像 Claude 的小螃蟹一样活跃」）：不改帧，只拿现有状态的帧组合——
 *   张望（读取帧）、抬眼甩尾（思考帧）、动耳朵（搜索帧）、开小花（完成帧）、沿输入框上沿走一段再坐下（执行帧 + 位移，往右走时水平翻转）。
 *   每 3～8 秒一个；「减少动效」时一个都不做。
 * 11-16 夜（用户：「猫的像素也同步优化一些活跃一些」）：多了几段自己的帧（帧数据里的 ACTS）——跟着 ♩=72 点头、舔爪子、甩尾巴；
 *   间隔缩到 2～5 秒；Metre 背景被点了一下（pinkie:metre-tap）时，它竖起耳朵、睁大眼睛往上看。
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
  const TICK_MS = 125, BEAT_MS = 60_000 / 72;   // 8 拍每秒；各状态按自己的 fps 取帧（和预览页同一算法）。BEAT_MS：全页共用的 ♩=72，点头按 Date.now() 落在这一拍上，和背景的摆锤、标志页的摆同一个钟（11-23）
  // 有人在用时 2～5 秒来一个空闲小动作；一分钟没碰键盘鼠标，就隔 20～40 秒才动一下（没人看，不白耗电）
  const LIVELY_MS = 60_000, ACT_GAP = [2000, 3000], ACT_GAP_UNWATCHED = [20_000, 20_000];
  const CATEGORY_NAMES = {overview: '项目概况', structure: '目录和关键文件', commands: '怎么跑、测、打包', conventions: '规矩',
    decisions: '定下的事', preferences: '偏好', pitfalls: '踩过的坑', people: '协作者', open: '没做完的'};

  // ---------- 纯函数：这一刻该是哪个状态 ----------
  const READ_TOOLS = /^(?:read|workbench_read|code_search|code_refs|code_check|grep|glob|ls|find|pinkie_session_list|pinkie_sessions|pinkie_models|metre_memory|learning_library|clekk_memory)$/;
  const SEARCH_TOOLS = /^(?:web_search|web_fetch|pinkie_search|browser|app_browser|web_gpt_activity|web_gpt)$/;
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
    if (kind === 'interrupted') return 'stopped';   // 一轮没收尾、后端也不在跑：猫停下，不装作在干活
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
  const motionPreference = !window.__pinkieMotion && window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => document.documentElement.hasAttribute('data-pinkie-reduce-motion')
    || Boolean(window.__pinkieMotion?.reduce || motionPreference?.matches);
  const dark = () => document.documentElement.hasAttribute('data-pinkie-night') || document.documentElement.dataset.theme === 'dark';

  // ---------- 画面 ----------
  let canvases = [], chip = null, pop = null, timer = 0, tick = 0, state = 'idle', lastDrawn = '';
  let idleSince = Date.now(), blinkAt = null, nextBlink = 0, detail = {}, doneUntil = 0, lastDone = 0;
  // 空闲小动作和坐的位置（perchX：相对输入框右上角的水平偏移，≤ 0）
  let perch = null, idleAct = null, nextAct = Date.now() + 2500, perchX = 0, facing = 'left';
  // lastInput：最近一次键盘鼠标；stride：下一拍隔几个 125ms 再醒（只在帧真的会变时醒）
  let lastInput = Date.now(), stride = 1;
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
    if (!body || !isMetre()) return false;
    chip = body.querySelector('.pk-metre-mem');
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pk-metre-mem';
      chip.hidden = true;
      chip.addEventListener('click', (event) => { event.stopPropagation(); togglePop(); });
      body.prepend(chip);
    }
    mountPerch();
    canvases = perch?.isConnected ? [perch.firstElementChild] : [];
    return true;
  }

  // 输入框右上沿的那只（Lit 重画输入框时可能被带走，每次挂载 / 每拍都检查）
  function mountPerch() {
    const host = document.querySelector('.agent-chat__composer-combobox');
    if (!host || !isMetre()) return;
    if (perch && perch.isConnected && perch.parentElement === host) return;
    if (!perch) {
      perch = document.createElement('span');
      perch.className = 'pk-metre-perch';
      perch.setAttribute('aria-hidden', 'true');
      perch.append(makeCanvas('pk-metre-cat pk-metre-cat--perch'));
    }
    perch.style.transition = 'none';
    perch.style.transform = perchX ? `translateX(${perchX}px)` : '';
    host.append(perch);
    lastDrawn = '';
  }

  // ---------- 空闲小动作 ----------
  // 每个动作：用哪个状态的帧、按什么 fps、放几遍；stroll 另带位移。
  const ACTS = [
    {name: 'look', from: 'read', cycles: 2, weight: 3},
    {name: 'glance', from: 'think', cycles: 1, weight: 2},
    {name: 'ears', from: 'search', cycles: 2, weight: 2},
    {name: 'stroll', from: 'exec', weight: 2},
    {name: 'flower', from: 'done', cycles: 1, weight: 1},
    {name: 'nod', own: true, cycles: 4, weight: 3},     // 一小节四拍：跟着 ♩=72 点头
    {name: 'groom', own: true, cycles: 2, weight: 2},
    {name: 'swish', own: true, cycles: 2, weight: 3},
  ];
  function pickAct() {
    const total = ACTS.reduce((sum, act) => sum + act.weight, 0);
    let roll = Math.random() * total;
    for (const act of ACTS) { roll -= act.weight; if (roll < 0) return act; }
    return ACTS[0];
  }
  // 眨眼：有人在 6～10 秒一次，一分钟没人碰就 20～30 秒一次
  const blinkGap = (now) => (now - Math.max(lastInput, idleSince) < LIVELY_MS ? 6000 + Math.random() * 4000 : 20_000 + Math.random() * 10_000);
  function startAct(now, pick) {
    const api = cat();
    const act = pick || pickAct();
    const def = act.own ? api?.ACTS?.[act.name] : api?.STATES[act.from];
    const gap = now - Math.max(lastInput, idleSince) < LIVELY_MS ? ACT_GAP : ACT_GAP_UNWATCHED;
    nextAct = now + gap[0] + Math.random() * gap[1];
    if (!def) return;
    let len = Math.ceil(def.frames.length * (act.cycles || 1) * 8 / def.fps);
    if (act.name === 'stroll') {
      const host = perch?.parentElement;
      if (!perch || !host) return;
      const room = Math.max(0, Math.min(160, host.clientWidth * 0.35));
      if (room < 24) return;
      // 走开一段，或者走回原位；离原位越远越想回去
      const target = perchX < -8 && Math.random() < 0.6 ? 0 : -Math.round(24 + Math.random() * (room - 24));
      const dist = Math.abs(target - perchX);
      if (dist < 12) return;
      const ms = Math.round(dist * 26);
      facing = target < perchX ? 'left' : 'right';
      perch.style.transition = `transform ${ms}ms linear`;
      perch.style.transform = target ? `translateX(${target}px)` : 'translateX(0)';
      perchX = target;
      len = Math.ceil(ms / TICK_MS);
    }
    idleAct = {name: act.name, def, start: tick, len};
  }
  function actFrame() {
    if (!idleAct) return null;
    const def = idleAct.def;
    const step = idleAct.name === 'nod' ? Math.floor((Date.now() % BEAT_MS) / BEAT_MS * def.frames.length) : Math.floor((tick - idleAct.start) * def.fps / 8);
    return {index: step % def.frames.length, def};
  }

  // 每一帧只画一次：缓存成小画布，之后每拍只是一次 drawImage，不再逐格 fillRect。
  const sprites = new WeakMap();
  function sprite(api, frame, isDark) {
    let entry = sprites.get(frame);
    if (!entry) sprites.set(frame, entry = {});
    const key = isDark ? 'dark' : 'light';
    if (!entry[key]) {
      const c = document.createElement('canvas');
      c.width = 16 * SCALE; c.height = 16 * SCALE;
      api.draw(c.getContext('2d'), frame, SCALE, {dark: isDark});
      entry[key] = c;
    }
    return entry[key];
  }

  function paint(force = false) {
    const api = cat();
    if (!api || !canvases.length) return;
    let def = api.STATES[state] || api.STATES.idle;
    let index = frameIndex(state, def, tick, reduced(), blinkAt);
    const act = state === 'idle' && !reduced() ? actFrame() : null;
    if (act) { def = act.def; index = act.index; }
    const flip = facing === 'right' ? 1 : 0;
    const sig = `${state}:${act ? idleAct.name : ''}:${index}:${dark() ? 1 : 0}:${flip}`;
    if (!force && sig === lastDrawn) return;
    lastDrawn = sig;
    const label = (api.STATES[state] || api.STATES.idle).label;
    const image = sprite(api, def.frames[index], dark());
    for (const c of canvases) {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(image, 0, 0);
      if (c.dataset.state !== state) c.dataset.state = state;
      const direction = flip ? 'right' : 'left';
      if (c.dataset.facing !== direction) c.dataset.facing = direction;
      if (c.title !== label) c.title = label;
    }
  }

  function setState(next) {
    if (next === state) return;
    state = next;
    tick = 0;
    blinkAt = null;
    nextBlink = Date.now() + blinkGap(Date.now());
    paint(true);
  }

  function loop() {
    timer = 0;
    if (document.hidden || !isMetre() || !canvases.length || !canvases[0].isConnected) return;
    const now = Date.now();
    let next = stateFor(detail, now, idleSince);
    if (next === 'done') lastDone = lastDone || now;
    if (doneUntil > now && next === 'idle') next = 'done';
    if (next !== 'idle') idleAct = null;
    setState(next);
    tick += stride;
    if (state === 'idle') {
      const def = cat()?.STATES.idle;
      if (blinkAt != null && def && tick - blinkAt >= def.frames.length * 8 / def.fps) blinkAt = null;
      if (idleAct && tick - idleAct.start >= idleAct.len) idleAct = null;
      if (!reduced() && !idleAct && blinkAt == null && now >= nextAct) startAct(now);
      if (!idleAct && blinkAt == null && now >= nextBlink) { blinkAt = tick; nextBlink = now + blinkGap(now); }
    }
    paint();
    // 只有在动的时候才排下一拍；静止帧（空闲没眨眼、没做小动作、睡觉的慢帧也按它自己的 fps）不空转。
    if (reduced()) return;
    const fps = cat()?.STATES[state]?.fps || 0;
    const moving = idleAct || blinkAt != null || (state !== 'idle' && fps > 0);
    const wake = Math.min(nextBlink, nextAct, idleSince + SLEEP_AFTER_MS);
    // 帧按 fps 换（8 拍里取 fps 帧），所以每隔 ⌊8/fps⌋ 拍醒一次就不会漏帧：睡觉 1fps 一秒醒一次，不是八次
    const playing = idleAct ? idleAct.def : (state === 'idle' ? cat()?.STATES.idle : cat()?.STATES[state]);
    stride = Math.max(1, Math.floor(8 / Math.min(8, playing?.fps || 8)));
    if (idleAct && idleAct.name === 'stroll') stride = 1;
    if (moving) timer = setTimeout(loop, TICK_MS * stride);
    else if (state === 'idle') { stride = 1; timer = setTimeout(loop, Math.max(250, wake - now)); }
  }
  // 背景被点了一下：竖耳朵、睁大眼往上看（在走路就不打断）
  function onTap() {
    if (state !== 'idle' || reduced() || (idleAct && idleAct.name === 'stroll')) return;
    blinkAt = null;
    startAct(Date.now(), {name: 'perk', own: true, cycles: 1});
    halt(); kick();
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
    if (mount()) {
      if (stateFor(detail, Date.now(), idleSince) !== state) halt();
      kick();
    }
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
  for (const type of ['pinkie:motion-change', 'pinkie:night']) window.addEventListener(type, () => { lastDrawn = ''; halt(); kick(); });
  window.addEventListener('pinkie:metre-tap', onTap);
  // 有人回来了：小动作恢复 2～5 秒一次（正在等长间隔的话当场改排，不用等满 20 秒）
  const noticeInput = () => {
    const now = Date.now(), away = now - lastInput >= LIVELY_MS;
    if (now - lastInput < 1000) return;
    lastInput = now;
    if (!away || idleAct || blinkAt != null || !timer) return;
    nextAct = Math.min(nextAct, now + ACT_GAP[0] + Math.random() * ACT_GAP[1]);
    nextBlink = Math.min(nextBlink, now + 6000 + Math.random() * 4000);
    halt(); kick();
  };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) window.addEventListener(type, noticeInput, {capture: true, passive: true});
  window.addEventListener('laolao:modechange', () => { if (!isMetre()) { halt(); if (pop) pop.hidden = true; } else { lastDrawn = ''; kick(); } });
  // 每分钟兜底读一次条数（别处改了记忆，例如看板）。
  setInterval(() => { if (isMetre() && memoryFor && !document.hidden && Date.now() - memoryAt > 55_000) void refreshMemory(memoryFor); }, 60_000);

  window.__pinkieMetreCat = {...model, get state() { return state; }, get memory() { return {...memory}; }, paint: () => paint(true)};
})();
