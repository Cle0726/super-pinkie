/* 碧琪上岸记 · 游戏客户端 + 营地（今日页）+ HUD。
   - window.__pinkieGame：调后端（pinkie.learning.game.*，写操作自动带 requestId）、状态缓存、形态目录、素材槽位、奖励播放队列（播完 ack）。
   - 今日页换成营地：HUD、碧琪站在纸艺小舞台上、Boss 横幅、委托、「出发」、入口格；原今日页整页收在「手账」分区，功能一个不丢。
   - 游戏后端出错时自动退回原今日页（学习功能不受影响，PLAN §12-4）。
   视觉语言：briefs/study-desk-game/VFX.md（衬线展示字 + 拉丁窄体小字 + 等宽数字；发丝线；纸面 / 夜间玻璃；入场 expo-out；不用 emoji / 卡通图标）。 */
(() => {
  'use strict';
  if (window.__pinkieGame) return;
  const BASE = new URL('.', document.currentScript?.src || location.href).href;
  const ART = BASE + 'study-game/';
  const MODE_ART = {daily: 'laolao-mode-chat-hd.png', learning: 'laolao-mode-learning-hd.png', project: 'laolao-mode-project-hd.png', thinking: 'laolao-mode-thinking-hd.png', unrestricted: 'laolao-mode-unrestricted-hd.png'};
  const desk = () => window.__pinkieStudyDesk;
  const fx = () => window.__pinkieGameFx;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fmt = n => (Number(n) || 0).toLocaleString('en-US');
  const WRITE = /^(?:shop\.buy|gacha\.pull|forms\.awaken|quests\.claim|chest\.open|world\.regenerate|node\.start|hunt\.start|exam\.generate|exam\.start|exam\.submit|boss\.realScore)$/;

  // ───────────── 后端 ─────────────
  async function call(name, params = {}, timeout) {
    const d = desk(); if (!d?.request) throw new Error('学习台正在连接');
    const body = WRITE.test(name) && !params.requestId ? {...params, requestId: uuid()} : params;
    return d.request('pinkie.learning.game.' + name, body, timeout);
  }
  const cache = {state: null, forms: null, manifest: null, at: 0};
  const listeners = new Set();
  function emit() { for (const fn of listeners) { try { fn(cache.state); } catch (e) { console.warn('[game]', e); } } window.dispatchEvent(new CustomEvent('pinkie:game-state', {detail: cache.state})); }
  let stateJob = null;
  function refresh() {
    if (stateJob) return stateJob;
    stateJob = call('state').then(s => { cache.state = s; cache.at = Date.now(); emit(); return s; }).finally(() => { stateJob = null; });
    return stateJob;
  }
  async function state(maxAge = 4000) { if (cache.state && Date.now() - cache.at < maxAge) return cache.state; return refresh(); }
  async function forms(force) {
    if (cache.forms && !force) return cache.forms;
    const r = await call('forms.list'); cache.forms = r?.forms || []; return cache.forms;
  }
  function formOf(id) { return (cache.forms || []).find(f => f.id === id) || null; }
  async function manifest() {
    if (cache.manifest) return cache.manifest;
    try { const r = await fetch(ART + 'manifest.json', {cache: 'no-cache'}); cache.manifest = r.ok ? (await r.json()).slots || {} : {}; } catch { cache.manifest = {}; }
    return cache.manifest;
  }
  // 素材槽位 → URL；没到的返回 null（调用方用占位）。模式系列形态没有新立绘时用现成的模式图。
  function art(slot) {
    const m = cache.manifest || {};
    if (m[slot]?.file) return ART + m[slot].file;
    const f = /^form\/([^/]+)\/(portrait|ult|icon)$/.exec(slot);
    if (f && MODE_ART[f[1]] && f[2] !== 'ult') return BASE + MODE_ART[f[1]];
    return null;
  }
  const portrait = id => art(`form/${id}/portrait`) || BASE + MODE_ART.daily;
  const ultArt = id => art(`form/${id}/ult`) || art(`form/${id}/portrait`) || null;
  const iconArt = id => art(`form/${id}/icon`) || art(`form/${id}/portrait`) || BASE + MODE_ART.daily;
  function fxForm(form) { return form ? {id: form.id, name: form.name, palette: form.palette, particle: form.particle, hit: form.hit, ult: form.ult, sig: form.sig, sound: form.sound} : null; }
  function equippedForm() { return formOf(cache.state?.form?.equipped) || (cache.forms || [])[0] || null; }

  // ───────────── 奖励播放：立刻播、按 id 去重、播完 ack；pending 兜底 ─────────────
  const seen = new Set(); let ackIds = [], ackTimer = 0, queue = Promise.resolve();
  try { for (const id of JSON.parse(sessionStorage.getItem('pinkie.game.played') || '[]')) seen.add(id); } catch { /* 无痕窗口 */ }
  function remember() { try { sessionStorage.setItem('pinkie.game.played', JSON.stringify([...seen].slice(-300))); } catch { /* ignore */ } }
  function flushAck() { const ids = ackIds; ackIds = []; ackTimer = 0; if (ids.length) call('awards.ack', {ids}).catch(() => { ackIds.push(...ids); }); }
  function ack(id) { ackIds.push(id); clearTimeout(ackTimer); ackTimer = setTimeout(flushAck, 400); }
  const ORDER = {small: 0, medium: 1, big: 2, cinematic: 3};
  function play(awards, opts = {}) {
    const fresh = (Array.isArray(awards) ? awards : []).filter(a => a && a.id && !seen.has(a.id));
    if (!fresh.length) return queue;
    for (const a of fresh) seen.add(a.id); remember();
    // 同一批里同种货币的小奖励合成一张卡（一题「+1 命中」「+3 打赢」不要叠两张），ack 时全部 id 都确认。
    const list = [], merged = {};
    for (const a of fresh) {
      const cur = ['stars', 'seals', 'shards'].includes(a.kind) && (a.fx === 'small' || a.fx === 'medium' || !a.fx) ? a.kind + (a.itemId || '') : null;
      if (cur && merged[cur]) { const m = merged[cur]; m.amount = (m.amount || 0) + (a.amount || 0); m.ids.push(a.id); if (a.reason && !m.reason.includes(a.reason)) m.reason = m.reason ? `${m.reason} · ${a.reason}` : a.reason; if (a.fx === 'medium') m.fx = 'medium'; continue; }
      const copy = {...a, ids: [a.id], reason: a.reason || ''}; if (cur) merged[cur] = copy; list.push(copy);
    }
    // 同一批里先播小的，最后播最大的（结算时「+5 星」不要压在大招之后）。
    list.sort((a, b) => (ORDER[a.fx] || 0) - (ORDER[b.fx] || 0));
    queue = queue.then(async () => {
      if (!cache.forms) await forms().catch(() => []);
      for (const a of list) {
        const form = equippedForm(); const own = a.kind === 'form' || a.kind === 'awaken' || a.kind === 'levelup' ? formOf(a.itemId) || form : form;
        try {
          const engine = fx();
          if (engine && !document.hidden) await engine.playAward(a, {from: opts.from, form: fxForm(own), palette: own?.palette, kicker: own?.name, art: a.kind === 'form' || a.kind === 'awaken' ? (ultArt(own?.id) || portrait(own?.id)) : undefined, particle: own?.particle});
          bump(a);
        } catch (e) { console.warn('[game] award', e); }
        for (const id of a.ids || [a.id]) ack(id);
      }
      refresh().catch(() => {});
    });
    return queue;
  }
  // 货币到达 HUD 时数字先跳到新值（不等 state 往返）。
  function bump(a) {
    const s = cache.state; if (!s) return;
    if (a.kind === 'stars') s.wallet.stars += a.amount || 0;
    else if (a.kind === 'seals') s.wallet.seals += a.amount || 0;
    else if (a.kind === 'shards') s.wallet.shards.any = (s.wallet.shards.any || 0) + (a.amount || 0);
    else return;
    emit();
  }
  let pendingJob = null;
  function pending() {
    if (pendingJob) return pendingJob;
    pendingJob = call('awards.pending').then(r => play(r?.awards || [])).catch(() => {}).finally(() => { pendingJob = null; });
    return pendingJob;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && document.getElementById('pinkie-study-desk')) pending(); });

  // ───────────── 小部件 ─────────────
  const SVG = {
    stars: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.5 6.6 7 .4-5.5 4.4 1.9 6.8L12 17l-5.9 3.8 1.9-6.8L2.5 9.6l7-.4z" fill="currentColor" opacity=".18"/><path d="M12 2.6l2.5 6.6 7 .4-5.5 4.4 1.9 6.8L12 17l-5.9 3.8 1.9-6.8L2.5 9.6l7-.4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 2.6V17M2.5 9.6L12 12l9.5-2.4M6.1 20.8L12 12l5.9 8.8" fill="none" stroke="currentColor" stroke-width=".7" opacity=".55"/></svg>',
    seals: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8.7 5v10L12 22l-8.7-5V7z" fill="currentColor" opacity=".18"/><path d="M12 2l8.7 5v10L12 22l-8.7-5V7z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 9h8v6H8z" fill="none" stroke="currentColor" stroke-width="1"/><path d="M12 9v6M8 12h8" stroke="currentColor" stroke-width=".7" opacity=".6"/></svg>',
    shards: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l5 7-5 13-5-13z" fill="currentColor" opacity=".18"/><path d="M12 2l5 7-5 13-5-13zM7 9h10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 2v20" stroke="currentColor" stroke-width=".7" opacity=".55"/></svg>',
  };
  // 加成文案里的 ⭐ / 🟡 是数据里的货币记号，显示时换成 HUD 同款线稿图标（VFX.md：界面里不出 emoji）。
  function bonusText(text, cls = '') {
    const node = el('span', cls);
    for (const part of String(text || '').split(/(⭐|🟡|💎)/u)) { if (!part) continue; const kind = {'⭐': 'stars', '🟡': 'seals', '💎': 'shards'}[part]; node.append(kind ? glyph(kind) : document.createTextNode(part)); }
    return node;
  }
  function glyph(kind) { const s = el('span', 'pkg-glyph'); s.dataset.kind = kind; s.innerHTML = SVG[kind] || ''; return s; }
  function rollNum(node, to) {
    const from = Number(node.dataset.v || to); node.dataset.v = to;
    if (from === to || !node.isConnected) { node.textContent = fmt(to); return; }
    const t0 = performance.now(), ms = 520;
    const step = () => { const k = Math.min(1, (performance.now() - t0) / ms), e = 1 - (1 - k) ** 3; node.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) setTimeout(step, 33); };
    step();
  }
  // HUD 条：营地顶栏和笔记本 / 生词本的小条共用。货币格带 data-game-hud（奖励彗星的落点）。
  function hud(host, {compact = false} = {}) {
    const bar = el('div', 'pkg-hud' + (compact ? ' is-compact' : '')); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '游戏状态');
    const who = el('button', 'pkg-who'); who.type = 'button'; who.setAttribute('aria-label', '打开衣橱');
    const face = el('img', 'pkg-who__face'); face.alt = ''; face.decoding = 'async';
    const meta = el('span', 'pkg-who__meta'), name = el('b'), lv = el('small'), track = el('i', 'pkg-who__xp'), fill = el('i');
    track.append(fill); meta.append(name, lv, track); who.append(face, meta);
    who.addEventListener('click', () => openGame('wardrobe'));
    const purse = el('div', 'pkg-purse');
    const cell = (kind, label) => { const c = el('span', 'pkg-cell'); c.dataset.gameHud = kind; c.title = label; const n = el('b', 'pkg-num', '0'); c.append(glyph(kind), n, el('small', '', label)); purse.append(c); return n; };
    const nStars = cell('stars', '星星'), nSeals = cell('seals', '金印'), nShards = cell('shards', '碎片');
    const streak = el('span', 'pkg-chip pkg-streak'), jar = el('span', 'pkg-chip pkg-jar');
    const wish = el('button', 'pkg-wish'); wish.type = 'button'; wish.hidden = true; wish.addEventListener('click', () => openGame('shop'));
    bar.append(who, purse, streak, jar, wish); host.append(bar);
    const paint = (s, first) => {
      if (!s || (!first && !bar.isConnected)) return;
      const form = formOf(s.form.equipped), lvl = s.form.levels?.[s.form.equipped] || {lv: 1, xp: 0, next: 100};
      face.src = iconArt(s.form.equipped); name.textContent = form?.name || '碧琪';
      lv.textContent = `亲密度 Lv.${lvl.lv}`;
      const prev = lvl.prev ?? 0, span = Math.max(1, (lvl.next || lvl.xp || 1) - prev); fill.style.width = (lvl.next ? Math.min(100, Math.max(4, (lvl.xp - prev) / span * 100)) : 100) + '%';
      if (form?.palette) bar.style.setProperty('--pkg-form', form.palette[1]);
      rollNum(nStars, s.wallet.stars); rollNum(nSeals, s.wallet.seals);
      rollNum(nShards, Object.values(s.wallet.shards || {}).reduce((a, b) => a + (Number(b) || 0), 0));
      streak.textContent = `连续 ${s.today?.streak || 0} 天`;
      jar.replaceChildren(el('span', '', '星星罐'), el('b', 'pkg-num', `${s.today?.jar?.stars || 0}`), el('small', '', `/ ${s.today?.jar?.goal || 30}`));
      const w = s.wishlist; wish.hidden = compact || !w;
      if (w) { const have = Math.max(0, (w.price?.stars || 0) - (w.missing?.stars || 0)), pct = w.price?.stars ? Math.min(100, have / w.price.stars * 100) : 100;
        wish.replaceChildren(el('small', '', '心愿单'), el('b', '', w.name || w.sku), el('i', 'pkg-wish__bar'), el('em', '', (w.missing?.stars || 0) > 0 ? `再 ${fmt(w.missing.stars)} 星` : '可以买了'));
        wish.querySelector('.pkg-wish__bar').style.setProperty('--p', pct + '%'); }
    };
    listeners.add(paint); if (cache.state) paint(cache.state, true);
    const stop = () => listeners.delete(paint);
    // 条被移出页面后停止更新（先等它挂上去一次）。
    let seenOn = false;
    new MutationObserver((_, o) => { if (bar.isConnected) { seenOn = true; return; } if (seenOn) { stop(); o.disconnect(); } }).observe(host.ownerDocument.body, {childList: true, subtree: true});
    return {bar, paint, stop};
  }

  // 其它游戏页（商店 / 衣橱 / 地图 / 讨伐 / 考场 / 图鉴）由各自的文件注册成学习台视图；还没注册时提示。
  const PAGES = {guard: 'gameguard', map: 'gamemap', hunt: 'gamehunt', exam: 'gameexam', shop: 'gameshop', gacha: 'gamegacha', wardrobe: 'gamewardrobe', codex: 'gamecodex'};
  function openGame(id, opts) {
    const d = desk(); const view = PAGES[id] || id;
    window.dispatchEvent(new CustomEvent('pinkie:game-open', {detail: {id, view, opts}}));
    if (d?.go) d.go(view, opts);
  }

  // ───────────── 营地 ─────────────
  const ENTRIES = [
    ['map', '地图', 'ATLAS', '上岸之书'], ['hunt', '讨伐', 'HUNT', '错题怪'], ['exam', '考场', 'EXAM', '模拟考'],
    ['shop', '商店', 'SHOP', '每日刷新'], ['gacha', '扭蛋', 'GACHA', '两个池子'], ['wardrobe', '衣橱', 'FORMS', '形态与觉醒'], ['codex', '图鉴', 'CODEX', '收服与收藏'],
  ];
  function beijingHour() { return Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23'}).format(new Date())); }

  async function mountCamp(host, ctx) {
    host.classList.add('pkg-camp'); host.setAttribute('aria-busy', 'true');
    const builtin = ctx.pane?.builtin;
    // 手账分区 = 原今日页，整页保留。
    const fallback = () => { host.classList.remove('pkg-camp'); host.replaceChildren(); host.removeAttribute('aria-busy'); return builtin?.mountToday(host); };
    let s;
    try { [s] = await Promise.all([refresh(), forms(), manifest()]); }
    catch (error) { console.warn('[game] camp fallback', error); if (host.isConnected) return fallback(); return; }
    if (!host.isConnected) return;
    host.replaceChildren(); host.setAttribute('aria-busy', 'false');
    const local = ctx.local?.() || {};
    const tab = local.campTab === 'journal' ? 'journal' : 'camp';
    host.dataset.tab = tab;

    const top = el('header', 'pkg-camp__top'); hud(top);
    const seg = el('div', 'pkg-seg'); seg.setAttribute('role', 'tablist'); seg.setAttribute('aria-label', '营地分区');
    const tabBtn = (id, label) => { const b = el('button', '', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(id === tab)); b.addEventListener('click', () => { if (host.dataset.tab === id) return; local.campTab = id; ctx.go ? ctx.go('today') : desk()?.refresh(); }); seg.append(b); return b; };
    tabBtn('camp', '营地'); tabBtn('journal', '手账'); top.append(seg); host.append(top);

    const body = el('div', 'pkg-camp__body'); host.append(body);
    if (tab === 'journal') { body.classList.add('pkg-journal'); const sheet = el('div', 'pkg-journal__page'); body.append(sheet); builtin?.mountToday(sheet); return; }

    const form = equippedForm();
    if (form?.palette) host.style.cssText += `;--pkg-a:${form.palette[0]};--pkg-b:${form.palette[1]};--pkg-c:${form.palette[2]}`;
    const night = (() => { const h = beijingHour(); return h >= 18 || h < 5; })();

    // 左：舞台
    const stage = el('section', 'pkg-stage'); stage.dataset.time = night ? 'night' : 'day'; stage.setAttribute('aria-label', '营地');
    const sky = el('div', 'pkg-stage__sky'); const bgArt = art(night ? 'camp/night' : 'camp/day');
    if (bgArt) { sky.style.backgroundImage = `url("${bgArt}")`; sky.classList.add('has-art'); }
    const layers = el('div', 'pkg-stage__layers'); layers.innerHTML = paperHills(night);
    const glow = el('div', 'pkg-stage__glow');
    const figure = el('figure', 'pkg-stage__figure'); const img = el('img', 'pkg-stage__biqi'); img.alt = form?.name || '碧琪'; img.decoding = 'async'; img.src = portrait(form?.id || 'daily');
    const shadow = el('i', 'pkg-stage__shadow'); figure.append(shadow, img);
    const plinth = el('div', 'pkg-stage__plinth');
    const copy = el('div', 'pkg-stage__copy');
    const hour = beijingHour();
    const hello = s.quiet ? '考前，稳住。' : hour < 5 ? '夜深了，先生。' : hour < 12 ? '早上好，先生。' : hour < 18 ? '下午好，先生。' : '晚上好，先生。';
    const head = el('div', 'pkg-stage__head');
    head.append(el('small', 'pkg-kicker', `CAMP · ${s.season?.name ? s.season.name + '季' : '营地'}`), el('h2', 'pkg-hello', hello));
    const line = el('p', 'pkg-line', '…'); head.append(line);
    call('line', {event: 'camp', context: {hour, quiet: s.quiet}}).then(r => { if (r?.text) line.textContent = r.text; }).catch(() => { line.textContent = '先做一小组，我陪你。'; });
    const go = el('button', 'pkg-go'); go.type = 'button';
    const goText = el('span', 'pkg-go__text'); const goKick = el('small', '', 'NEXT'); const goTitle = el('b', '', '出发'); const goSub = el('em', '', '正在找路线上的下一站…');
    goText.append(goKick, goTitle, goSub); go.append(goText, el('i', 'pkg-go__rule')); copy.append(go);
    stage.append(sky, layers, glow, plinth, figure, head, copy);
    ambient(stage, form, {still: fx()?.settings?.().biqi === false || ctx.motion?.reduced});
    glow.after(stage.querySelector('.pkg-amb'));
    if (form) { const tag = el('div', 'pkg-stage__tag'); tag.append(el('small', '', form.series === 'mode' ? 'MODE FORM' : `${form.rarity} FORM`), el('b', '', form.name), bonusText(form.bonus?.text)); stage.append(tag); }
    const left = el('div', 'pkg-left'); left.append(stage); body.append(left);
    parallax(stage, [layers, figure, glow]);
    if (fx()?.settings?.().biqi === false || ctx.motion?.reduced) stage.dataset.still = '1';

    // 右：Boss / 委托 / 今日 / 入口
    const side = el('div', 'pkg-side'); body.append(side);
    side.append(bossBanner(s.boss));
    const quests = el('section', 'pkg-quests'); quests.setAttribute('aria-label', '今日委托'); side.append(quests);
    paintQuests(quests, s);
    const today = el('section', 'pkg-today'); today.setAttribute('aria-label', '今日'); side.append(today);
    const entries = el('nav', 'pkg-entries'); entries.setAttribute('aria-label', '去哪儿');
    for (const [id, zh, en, sub] of ENTRIES) {
      const b = el('button', 'pkg-entry'); b.type = 'button'; b.dataset.entry = id;
      const badge = id === 'hunt' && s.monsters?.due ? `${s.monsters.due} 只到期` : id === 'shop' && s.season?.limitedSkus?.length && !s.quiet ? `${s.season.name}限定` : '';
      b.append(el('small', '', en), el('b', '', zh), badge ? el('em', 'pkg-entry__sub is-hot', badge) : el('span', 'pkg-entry__sub', sub));
      if (badge) b.dataset.hot = '1';
      b.style.setProperty('--e', entries.children.length); b.addEventListener('click', () => openGame(id)); entries.append(b);
    }
    left.append(entries);
    // 问碧琪（原今日页的对话入口），放在舞台左下。
    copy.append(askBox(ctx));

    // 原今日页的数据：今日任务（碧琪替你挑的）+ 今晚条，填进「今日」。
    loadToday(today, ctx).catch(() => {});
    planGo(go, goSub, goTitle, ctx, s).catch(() => { goSub.textContent = '先做今天这一组'; });
    host.querySelectorAll('.pkg-rv').forEach((n, i) => n.style.setProperty('--i', i));
    pending();
    return {unmount() { /* 监听器随节点移除自动断开 */ }};
  }

  function paperHills(night) {
    // 分层剪纸：远山 / 中景 / 近景，每层一条纸边（浅色描边）+ 软阴影；颜色走 CSS 变量，白天夜间各一套。
    return `<svg class="pkg-hills" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs><filter id="pkg-cut" x="-5%" y="-20%" width="110%" height="140%"><feDropShadow dx="0" dy="-3" stdDeviation="5" flood-color="${night ? '#000' : '#5a2846'}" flood-opacity="${night ? .55 : .16}"/></filter></defs>
      <path class="h1" filter="url(#pkg-cut)" d="M0 330 C90 290 160 250 250 268 C340 286 380 230 470 222 C560 214 610 270 700 262 C800 252 860 212 1000 236 L1000 560 L0 560Z"/>
      <path class="h2" filter="url(#pkg-cut)" d="M0 392 C120 360 210 380 300 352 C390 324 470 352 560 344 C670 334 740 300 830 318 C900 332 950 350 1000 344 L1000 560 L0 560Z"/>
      <path class="h3" filter="url(#pkg-cut)" d="M0 452 C110 430 220 446 330 432 C450 416 560 438 680 428 C790 418 880 432 1000 422 L1000 560 L0 560Z"/>
      <g class="pkg-lamps">${night ? [140, 610, 880].map((x, i) => `<circle cx="${x}" cy="${[300, 286, 262][i]}" r="2.2"/>`).join('') : ''}</g>
    </svg>`;
  }
  // 待机氛围（11-08 验收 R5）：营地 / 衣橱立绘区按形态铺一层氛围（立冬炊烟灯笼、小雪稀雪、赛博扫描线、海盗海面反光……），
  // 外加通用的光斑漂移和浮尘。全部是 CSS 合成层动画（transform / opacity），不起 rAF；页面隐藏时浏览器自己停，
  // 安静档 / 碧琪动画关 / 减少动效时静止（data-still）。每颗的位置、大小、周期用形态 id 做种子，刷新不跳。
  const AMB_COUNT = {party: 10, pen: 7, blueprint: 1, lattice: 12, prism: 2, lens: 2, chart: 14, orbit: 3, dragon: 14, carpet: 14, rose: 10, aegis: 1, piping: 12, ribbon: 9, zodiac: 16,
    scroll: 4, spotlight: 2, datamosh: 6, smokeclone: 4, lantern: 7, firstsnow: 18, aurora: 3, mortarboard: 10, goldseal: 14};
  function ambient(host, form, {still = false} = {}) {
    host.querySelector(':scope > .pkg-amb')?.remove();
    const sig = window.__pinkieGameSig?.of(form) || form?.sig || 'party';
    const amb = el('div', 'pkg-amb'); amb.dataset.amb = sig; amb.setAttribute('aria-hidden', 'true');
    if (form?.palette) ['--pkg-a', '--pkg-b', '--pkg-c'].forEach((k, i) => amb.style.setProperty(k, form.palette[i]));
    let seed = [...(form?.id || sig)].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7);
    const rnd = () => (seed = seed * 1664525 + 1013904223 >>> 0) / 4294967296;
    const dot = (cls, i, n) => { const d = el('i', cls); d.style.cssText = `--x:${(rnd() * 100).toFixed(1)}%;--y:${(rnd() * 100).toFixed(1)}%;--s:${(.6 + rnd() * .8).toFixed(2)};--d:${(9 + rnd() * 10).toFixed(1)}s;--dl:${(-rnd() * 18).toFixed(1)}s;--r:${(rnd() * 360).toFixed(0)}deg;--i:${i};--n:${n};--c:var(${['--pkg-a', '--pkg-b', '--pkg-c'][i % 3]})`; return d; };
    amb.append(el('b', 'pkg-amb__sun'), el('b', 'pkg-amb__sun pkg-amb__sun--2'));
    for (let i = 0; i < 14; i++) amb.append(dot('pkg-amb__dust', i, 14));
    const n = AMB_COUNT[sig] || 8;
    for (let i = 0; i < n; i++) amb.append(dot('pkg-amb__m', i, n));
    if (still || fx()?.settings?.().biqi === false || (fx()?.settings?.().density ?? 1) <= 0 || window.__pinkieStudyDesk?.motion?.reduced) amb.dataset.still = '1';
    host.prepend(amb); return amb;
  }
  function parallax(stage, [far, mid, near]) {
    let raf = 0, nx = 0, ny = 0;
    const apply = () => { raf = 0; far.style.transform = `translate3d(${nx * -6}px,${ny * -3}px,0)`; mid.style.transform = `translate3d(${nx * 10}px,${ny * 4}px,0)`; near.style.transform = `translate3d(${nx * 16}px,${ny * 8}px,0)`; };
    stage.addEventListener('pointermove', e => { if (stage.dataset.still) return; const r = stage.getBoundingClientRect(); nx = (e.clientX - r.left) / r.width - .5; ny = (e.clientY - r.top) / r.height - .5; if (!raf) raf = requestAnimationFrame(apply); });
    stage.addEventListener('pointerleave', () => { nx = ny = 0; if (!raf) raf = requestAnimationFrame(apply); });
  }

  function bossBanner(boss) {
    const b = el('button', 'pkg-boss'); b.type = 'button'; b.dataset.phase = boss?.phase || 'normal'; b.setAttribute('aria-label', '打开考场');
    const pic = el('div', 'pkg-boss__art'); const src = art(boss?.phase === 'broken' || boss?.phase === 'done' ? 'boss/babel/broken' : boss?.phase === 'hurt' ? 'boss/babel/hurt' : 'boss/babel/full') || art('boss/babel/full');
    if (src) { const i = el('img'); i.src = src; i.alt = ''; i.decoding = 'async'; pic.append(i); }
    const copy = el('div', 'pkg-boss__copy');
    const days = Math.max(0, boss?.daysLeft ?? 0), gap = boss?.gap ?? Math.max(0, (boss?.safeLine || 70) - (boss?.bestPredicted || 0));
    copy.append(el('small', 'pkg-kicker', 'BOSS · 第一卷终章'));
    const title = el('h3', '', boss?.name || '巴别兽'); copy.append(title);
    const stat = el('p', 'pkg-boss__stat');
    const dd = el('span'); dd.append(el('b', 'pkg-num', String(days)), document.createTextNode(' 天'));
    const gg = el('span'); if (boss?.phase === 'broken' || boss?.phase === 'done' || gap <= 0) gg.textContent = '已破防，安心上考场'; else gg.append(document.createTextNode('还差 '), el('b', 'pkg-num', String(gap)), document.createTextNode(' 分到稳过线'));
    stat.append(dd, el('i', 'pkg-dot'), gg); copy.append(stat);
    const hp = el('div', 'pkg-hp'); hp.setAttribute('role', 'meter'); hp.setAttribute('aria-label', '巴别兽剩余血量'); hp.setAttribute('aria-valuemin', '0'); hp.setAttribute('aria-valuemax', '100');
    const pct = Math.max(0, Math.min(100, boss?.hpPercent ?? 100)); hp.setAttribute('aria-valuenow', String(pct)); hp.style.setProperty('--hp', pct + '%');
    hp.append(el('i', 'pkg-hp__fill'), el('i', 'pkg-hp__tick'));
    copy.append(hp, el('small', 'pkg-boss__note', boss?.bestPredicted ? `预估 ${boss.bestPredicted} 分 · 稳过 ${boss.safeLine || 70}` : `还没考过 · 及格 ${boss?.passLine || 60} · 稳过 ${boss?.safeLine || 70}`));
    b.append(pic, copy); b.addEventListener('click', () => openGame('exam'));
    return b;
  }

  function paintQuests(host, s) {
    host.replaceChildren();
    const head = el('header', 'pkg-sec'); head.append(el('small', 'pkg-kicker', 'COMMISSIONS'), el('h3', '', '碧琪的委托'));
    const list = s.today?.quests || [];
    const done = list.filter(q => q.done).length; head.append(el('span', 'pkg-sec__meta', `${done} / ${list.length || 3}`)); host.append(head);
    const rows = el('div', 'pkg-qlist');
    for (const q of list) {
      const row = el('article', 'pkg-q'); row.dataset.done = String(Boolean(q.done)); row.dataset.claimed = String(Boolean(q.claimed));
      const count = q.target?.count || 1, prog = Math.min(count, q.progress || 0);
      const txt = el('div', 'pkg-q__text'); txt.append(el('b', '', q.title || '委托'), el('span', '', q.text || ''));
      const bar = el('i', 'pkg-q__bar'); bar.style.setProperty('--p', (prog / count * 100) + '%');
      const meta = el('div', 'pkg-q__meta'); meta.append(el('span', 'pkg-num', `${prog}/${count}`), el('em', '', rewardText(q.reward)));
      row.append(txt, bar, meta);
      if (q.done && !q.claimed) {
        const claim = el('button', 'pkg-btn pkg-q__claim', '领取'); claim.type = 'button';
        claim.addEventListener('click', async () => {
          claim.disabled = true;
          try { const r = await call('quests.claim', {questId: q.id}); await play(r?.awards || [], {from: claim}); const ns = await refresh(); if (host.isConnected) paintQuests(host, ns); }
          catch (e) { claim.disabled = false; claim.textContent = e.message?.slice(0, 12) || '再试一次'; }
        });
        row.append(claim);
      } else if (q.claimed) row.append(el('span', 'pkg-q__stamp', '已领'));
      rows.append(row);
    }
    if (!list.length) rows.append(el('p', 'pkg-empty', '委托还在写，稍等一下。'));
    host.append(rows);
    if (s.today?.chestReady) {
      const chest = el('button', 'pkg-chest'); chest.type = 'button'; chest.append(el('small', 'pkg-kicker', 'CHEST'), el('b', '', '三件委托都完成了，打开宝箱'));
      chest.addEventListener('click', async () => { chest.disabled = true; try { const r = await call('chest.open'); await play(r?.awards || [], {from: chest}); const ns = await refresh(); if (host.isConnected) paintQuests(host, ns); } catch (e) { chest.disabled = false; } });
      host.append(chest);
    }
  }
  function rewardText(r) {
    if (!r) return '';
    const parts = []; if (r.stars) parts.push(`+${r.stars} 星`); if (r.seals) parts.push(`+${r.seals} 金印`); if (r.shards) parts.push(`+${r.shards} 碎片`);
    return parts.join(' ') || (typeof r === 'number' ? `+${r} 星` : '');
  }

  async function loadToday(host, ctx) {
    const d = desk();
    let data = null;
    try { data = await d.request('pinkie.learning.desk.today', {}); } catch { /* 学习后端照常时才有 */ }
    if (!host.isConnected) return;
    if (ctx.local) ctx.local().today = data || ctx.local().today;
    const head = el('header', 'pkg-sec'); head.append(el('small', 'pkg-kicker', 'TODAY'), el('h3', '', '今日'));
    host.append(head);
    const list = el('div', 'pkg-tlist'); host.append(list);
    const row = (title, meta, run, cls = '') => { const b = el('button', 'pkg-trow ' + cls); b.type = 'button'; b.append(el('b', '', title), el('em', '', meta || '')); b.addEventListener('click', run); list.append(b); return b; };
    const focus = data?.focus;
    if (focus) {
      const kind = focus.kind;
      row(focus.title || '今日练习', kind === 'learn' ? '碧琪替你挑的 · 先学' : kind === 'lesson' ? '上次没讲完' : '碧琪替你挑的', () => {
        if (focus.payload?.practiceInChat) d.askBiqi?.(`请围绕「${focus.title || '这个考点'}」出一道理解练习题，一次只出一题。`);
        else if ((kind === 'learn' || kind === 'lesson') && window.__pinkieStudyDeskLesson?.openFocus) window.__pinkieStudyDeskLesson.openFocus(focus);
        else d.startSet?.(focus.payload || {});
      }, 'is-focus');
    }
    for (const item of data?.quiet || []) {
      const open = {vocab: () => d.go('vocab', {review: true}), notes: () => d.go('notes', {view: 'review'}), review: () => d.switchStageMode?.('flashcard')}[item.kind] || (() => d.startSet?.({mode: 'retest', size: 6}));
      row(item.label, item.meta, open);
    }
    if (!focus && !(data?.quiet || []).length) list.append(el('p', 'pkg-empty', '今天的安排会出现在这里。'));
  }

  async function planGo(go, sub, title, ctx, s) {
    const d = desk();
    let world = null;
    try { world = await call('world', {exam: s.boss?.exam || 'pretco-b'}); } catch { /* 地图还没好 */ }
    const nodes = (world?.regions || []).flatMap(r => (r.nodes || []).map(n => ({...n, regionName: r.name, regionOrder: r.order})));
    const done = new Set(nodes.filter(n => n.state === 'lit' || n.state === 'gold').map(n => n.id));
    const ready = n => (n.deps || []).every(id => done.has(id) || !nodes.some(m => m.id === id));
    const sorted = nodes.slice().sort((a, b) => (a.regionOrder - b.regionOrder) || (a.order - b.order));
    const next = sorted.find(n => n.due > 0) || sorted.find(n => n.state === 'explored' && ready(n)) || sorted.find(n => n.state === 'fog' && ready(n)) || sorted.find(n => n.state !== 'gold');
    if (!go.isConnected) return;
    if (next) {
      const mode = next.kind === 'guard' ? 'guard' : next.state === 'fog' ? 'learn' : 'drill';
      title.textContent = '出发'; sub.textContent = `${next.regionName} · ${next.name}`;
      go.dataset.mode = mode;
      go.addEventListener('click', () => startNode(next, mode, go));
      return;
    }
    // 地图还在规划或没有节点：出发 = 今日任务。
    const focus = ctx.local?.()?.today?.focus;
    sub.textContent = world?.status === 'generating' ? '碧琪在规划路线 · 先做今天这一组' : (focus?.title || '先做今天这一组');
    go.addEventListener('click', () => {
      if (focus && (focus.kind === 'learn' || focus.kind === 'lesson') && window.__pinkieStudyDeskLesson?.openFocus) window.__pinkieStudyDeskLesson.openFocus(focus);
      else d.startSet?.(focus?.payload || {});
    });
  }
  // 从节点出发：lesson → 学习台的课；drill → 背一背（scope 原样传）；guard → 守关战（battle 文件注册）。
  async function startNode(node, mode, from) {
    const d = desk();
    if (from) from.disabled = true;
    try {
      const r = await call('node.start', {nodeId: node.id, mode});
      if (r?.flow === 'lesson' && window.__pinkieStudyDeskLesson?.open) window.__pinkieStudyDeskLesson.open({k: r.payload.k, i: r.payload.i});
      else if (r?.flow === 'lesson') d.go('today');
      else if (r?.flow === 'drill') window.__pinkieDrill?.start({source: r.payload.source, scope: r.payload.scope, returnTo: 'today', node: node.id});
      else if (r?.flow === 'guard') openGame('guard', {node, payload: r.payload});
      return r;
    } catch (e) { toast(e.message || '没打开'); }
    finally { if (from) from.disabled = false; }
  }
  function toast(text) { const d = document.querySelector('#pinkie-study-desk .desk-status'); if (d) { d.textContent = text; d.classList.add('show'); setTimeout(() => d.classList.remove('show'), 2600); } }

  function askBox(ctx) {
    const d = desk();
    const ask = el('form', 'pkg-ask'), input = el('input'); input.placeholder = '问碧琪，或者说「出 3 道阅读题」'; input.setAttribute('aria-label', '问碧琪');
    const send = el('button', 'pkg-ask__send'); send.type = 'submit'; send.disabled = true; send.setAttribute('aria-label', '发送'); send.append(d?.icon?.('arrow-up', {size: 'sm'}) || '↑');
    const err = el('p', 'pkg-ask__err'); err.setAttribute('role', 'alert'); err.hidden = true;
    ask.append(input, send);
    input.addEventListener('input', () => { send.disabled = !input.value.trim(); err.hidden = true; });
    ask.addEventListener('submit', async e => {
      e.preventDefault(); if (!input.value.trim() || ask.classList.contains('sending')) return;
      ask.classList.add('sending'); send.disabled = true;
      try { await d.askBiqi(window.__pinkieDeskHandbook?.withRefs?.(input.value, ask) ?? input.value); input.value = ''; }
      catch (error) { err.textContent = '没发出去：' + (error.message || '连接断了') + '。文字还在，再按一次发送。'; err.hidden = false; }
      finally { ask.classList.remove('sending'); send.disabled = !input.value.trim(); }
    });
    const wrap = el('div', 'pkg-askwrap'); wrap.append(ask, err);
    if (ctx.local?.()?.focusAsk) { ctx.local().focusAsk = false; setTimeout(() => input.focus(), 60); }
    return wrap;
  }

  // ───────────── 接线 ─────────────
  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('today', {title: '营地', mount: (host, ctx) => mountCamp(host, ctx)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 120); setTimeout(() => clearInterval(t), 20000); }
  // 学习后端改了数据（作答、复习、上课）→ 状态和 pending 补播。
  window.addEventListener('pinkie:desk-changed', () => { refresh().catch(() => {}); });

  window.__pinkieGame = {markSeen: ids => { for (const id of ids || []) seen.add(id); remember(); }, call, state, refresh, forms, formOf, equippedForm, manifest, art, portrait, ultArt, iconArt, fxForm, ambient, bonusText, play, pending, hud, glyph, open: openGame, startNode, toast, on: fn => { listeners.add(fn); return () => listeners.delete(fn); }, get cache() { return cache; }, rewardText, fmt};
  window.dispatchEvent(new CustomEvent('pinkie:game-ready'));
})();
