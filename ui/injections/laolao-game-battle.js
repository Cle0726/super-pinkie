/* 碧琪上岸记 · 战斗层：盖在背一背（含讨伐）、守关战上。
   - 答题即出手：本地判出对错的那一刻就出命中 / 闪开（≤100 ms），后端结果回来再更新连击、血条、奖励。
   - 敌人：讨伐 = 每题对面那只错题怪；从节点进 = 区域守卫；其它 = 纸靶。血条 = 本组真实进度。
   - 连击满门槛（10，变身系形态 8）= 碧琪大招切入（fx.cinematic，可跳过）。暴击只改特效，不改判分和奖励。
   - 守关战（gameguard）和讨伐列表（gamehunt）是学习台视图。
   视觉：VFX.md（伤害数字 = 等宽数字 + 白热核心；拉丁窄体小字；发丝线；入场 expo-out，不回弹）。 */
(() => {
  'use strict';
  if (window.__pinkieGameBattle) return;
  const G = () => window.__pinkieGame;
  const fx = () => window.__pinkieGameFx;
  const desk = () => window.__pinkieStudyDesk;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ULT_TITLE = {burst: '新星', slash: '一闪', spell: '星阵', curtain: '谢幕', ink: '泼墨', warp: '跃迁', rain: '星落', stamp: '落印', beam: '天光'};
  const GUARDIAN = {listening: 'echo-bat', vocab: 'block-golem', grammar: 'ink-slime', reading: 'bookworm', translation: 'lost-crane', writing: 'inkpot-imp', other: 'fog-puff'};
  const REGION_NAME = {listening: '听力港', vocab: '词汇森林', grammar: '语法工坊', reading: '阅读图书馆', translation: '翻译桥', writing: '写作塔', other: '迷雾'};
  const LEVEL_TONE = ['', '#8FA8C8', '#C99A4A', '#C8577A', '#8E5BD8', '#E2C07A'];

  function ultThreshold(form) { return form?.bonus?.kind === 'ultThreshold' ? Number(form.bonus.value) || 10 : 10; }
  function reduced() { return Boolean(desk()?.motion?.reduced) || fx()?.settings?.().tier === 'quiet'; }

  // 纸靶：同心细线圈 + 刻度，纸面描边。不是卡通图标。
  const TARGET_SVG = '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="pkb-paper" cx="45%" cy="38%"><stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="#EFE4D8"/></radialGradient></defs><circle cx="60" cy="60" r="54" fill="url(#pkb-paper)" stroke="#3A2A35" stroke-opacity=".28" stroke-width="1"/><circle cx="60" cy="60" r="42" fill="none" stroke="#3A2A35" stroke-opacity=".22"/><circle cx="60" cy="60" r="30" fill="none" stroke="#DB1F74" stroke-opacity=".55" stroke-width="1.2"/><circle cx="60" cy="60" r="18" fill="none" stroke="#3A2A35" stroke-opacity=".22"/><circle cx="60" cy="60" r="7" fill="#DB1F74" fill-opacity=".85"/><path d="M60 2v14M60 104v14M2 60h14M104 60h14" stroke="#3A2A35" stroke-opacity=".35" stroke-width="1"/></svg>';

  // ───────────── 竞技场：碧琪 ↔ 敌人，血条、连击、伤害数字 ─────────────
  // strip = 状态条版：碧琪和怪缩成题目上方那一条的两端小头像（作答页都用这个；题目才是第一视觉）。
  function arena({form, compact = false, strip = false} = {}) {
    const root = el('div', 'pkb-arena' + (compact ? ' is-compact' : '') + (strip ? ' is-strip' : '')); root.setAttribute('aria-hidden', 'true');
    if (form?.palette) root.style.cssText = `--pkb-a:${form.palette[0]};--pkb-b:${form.palette[1]};--pkb-c:${form.palette[2]}`;
    const ground = el('i', 'pkb-ground');
    const hero = el('div', 'pkb-hero'); const heroImg = el('img'); heroImg.alt = ''; heroImg.decoding = 'async'; heroImg.src = G()?.portrait(form?.id || 'daily') || ''; hero.append(el('i', 'pkb-shadow'), heroImg);
    // 形态 v2：头像是活的（呼吸、眨眼、看鼠标），答对换成 GPT 出的欢呼姿势、答错换成一缩的姿势
    let live = null;
    const mountLive = (id) => { live?.destroy?.(); live = null; const FS = window.__pinkieFormStage; if (!FS?.has(id) || reduced()) { heroImg.hidden = false; hero.classList.remove('is-live'); return; } heroImg.hidden = true; hero.classList.add('is-live'); live = FS.mount(hero, id, {mode: 'avatar', poke: false}); };
    mountLive(form?.id || 'daily');
    const combo = el('div', 'pkb-combo'); const comboN = el('b', 'pkb-combo__n', '0'); combo.append(comboN, el('small', '', 'COMBO')); combo.dataset.on = '0';
    const meter = el('i', 'pkb-ultmeter'); const meterFill = el('i'); meter.append(meterFill); combo.append(meter);
    const foe = el('div', 'pkb-foe'); const foeBody = el('div', 'pkb-foe__body'); const foeAura = el('i', 'pkb-foe__aura'); foe.append(el('i', 'pkb-shadow'), foeAura, foeBody);
    const plate = el('div', 'pkb-plate'); const pName = el('b'); const pLv = el('small'); const hp = el('i', 'pkb-hp'); const hpFill = el('i', 'pkb-hp__fill'); const hpLag = el('i', 'pkb-hp__lag'); hp.append(hpLag, hpFill, el('i', 'pkb-hp__tick'));
    const pNote = el('em', 'pkb-plate__note'); plate.append(pLv, pName, hp, pNote);
    const pops = el('div', 'pkb-pops');
    root.append(ground, hero, combo, foe, plate);
    // 状态条里伤害数字挂在怪身上（从怪脚下升起），不挂在整条上。
    if (strip) foe.append(pops); else root.append(pops);
    let enemy = null, hpFrac = 1, threshold = ultThreshold(form);
    const api = {
      root, foe: foeBody, hero,
      setForm(f) { const changed = (f?.id || 'daily') !== (form?.id || 'daily'); form = f; threshold = ultThreshold(f); heroImg.src = G()?.portrait(f?.id || 'daily') || heroImg.src; if (changed || !live) mountLive(f?.id || 'daily'); if (f?.palette) root.style.cssText = `--pkb-a:${f.palette[0]};--pkb-b:${f.palette[1]};--pkb-c:${f.palette[2]}`; },
      setEnemy(next) {
        const key = next ? `${next.kind}:${next.id || next.species || ''}` : '';
        if (enemy && key === enemy.key) return;
        enemy = next ? {...next, key} : null;
        foeBody.replaceChildren(); foe.dataset.kind = next?.kind || 'target';
        const lv = Math.max(1, Math.min(5, next?.level || 1)); foe.dataset.level = String(lv); foe.style.setProperty('--tone', LEVEL_TONE[lv] || 'transparent');
        foe.toggleAttribute('data-evolved', Boolean(next?.evolved));
        const src = next?.species ? G()?.art(`monster/${next.species}`) : null;
        if (src) { const i = el('img'); i.alt = ''; i.decoding = 'async'; i.src = src; foeBody.append(i); }
        else if (next?.kind === 'target' || !next) foeBody.innerHTML = TARGET_SVG;
        else { const s = el('div', 'pkb-foe__ghost'); s.append(el('span', '', (next.name || '?').slice(0, 1))); foeBody.append(s); }
        pName.textContent = next?.name || '纸靶'; pLv.textContent = next?.kind === 'target' || !next ? 'TRAINING' : `${next.kind === 'guard' ? 'GUARDIAN' : 'MONSTER'} · LV.${lv}${next?.evolved ? ' · 进化' : ''}`;
        pNote.textContent = next?.note || '';
        if (!reduced()) { foe.classList.remove('is-enter'); void foe.offsetWidth; foe.classList.add('is-enter'); }
      },
      setHp(frac, {instant} = {}) {
        hpFrac = Math.max(0, Math.min(1, frac));
        hpFill.style.width = (hpFrac * 100) + '%';
        if (instant) hpLag.style.width = (hpFrac * 100) + '%'; else setTimeout(() => { hpLag.style.width = (hpFrac * 100) + '%'; }, 420);
      },
      setCombo(n) {
        const prev = Number(combo.dataset.n || 0); combo.dataset.n = String(n); combo.dataset.on = n > 1 ? '1' : '0'; comboN.textContent = String(n);
        combo.dataset.hot = n >= 5 ? '1' : '0';
        meterFill.style.width = Math.min(100, (n % threshold || (n ? threshold : 0)) / threshold * 100) + '%';
        if (n > prev && n > 1 && !reduced()) { combo.classList.remove('is-bump'); void combo.offsetWidth; combo.classList.add('is-bump'); }
      },
      // 出手：命中特效打在敌人身上；伤害数字从敌人头顶升起。
      strike({crit = false, damage = 0, partial = false} = {}) {
        const engine = fx();
        try { engine?.hit(form?.hit || 'sparkle', foeBody, {crit, palette: form?.palette, form: G()?.fxForm(form), ...(strip ? {size: 1} : {})}); } catch { /* 没有引擎就只有数字 */ }
        pop(damage, {crit, partial}); live?.state('cheer');
        if (!reduced()) { foe.classList.remove('is-hurt', 'is-crit'); void foe.offsetWidth; foe.classList.add(crit ? 'is-crit' : 'is-hurt'); hero.classList.remove('is-lunge'); void hero.offsetWidth; hero.classList.add('is-lunge'); }
      },
      dodge() {
        pop(null, {miss: true}); live?.state('hurt');
        if (!reduced()) { foe.classList.remove('is-dodge'); void foe.offsetWidth; foe.classList.add('is-dodge'); }
      },
      defeat({capture = false} = {}) {
        foe.classList.add(capture ? 'is-captured' : 'is-down');
        try { fx()?.burst(capture ? 'ink' : (form?.particle || 'sparkle'), foeBody, {palette: form?.palette, scale: 1.1}); } catch { /* ignore */ }
      },
      async ult(n) {
        const engine = fx(); const g = G();
        if (!engine || !form) return;
        try { await engine.cinematic(form.ult || 'burst', {text: ULT_TITLE[form.ult] || '大招', sub: `${n} COMBO · ${form.name}`, kicker: form.name, art: g?.ultArt(form.id) || g?.portrait(form.id), palette: form.palette, particle: form.particle, form: g?.fxForm(form)}); }
        catch { /* 过场被跳过或没有 WebGL */ }
      },
      get threshold() { return threshold; },
      get hp() { return hpFrac; },
    };
    function pop(damage, {crit, miss, partial}) {
      const p = el('div', 'pkb-pop' + (crit ? ' is-crit' : '') + (miss ? ' is-miss' : '') + (partial ? ' is-partial' : ''));
      if (miss) p.append(el('small', '', 'EVADE'), el('b', '', '闪开'));
      else { if (crit) p.append(el('small', '', 'CRITICAL')); p.append(el('b', 'pkb-pop__n', String(damage))); }
      p.style.setProperty('--dx', (Math.random() * 30 - 15).toFixed(0) + 'px');
      pops.append(p); setTimeout(() => p.remove(), 1300);
      while (pops.children.length > 5) pops.firstElementChild.remove();
    }
    return api;
  }

  async function enemyForRoute(route) {
    if (route.source === 'hunt') return null; // 每题自己的怪
    const nodeId = route.scope?.nodeId || route.node;
    if (nodeId) {
      try {
        const w = await G().call('world', {exam: 'pretco-b'});
        for (const r of w?.regions || []) for (const n of r.nodes || []) if (n.id === nodeId) {
          const region = GUARDIAN[r.id] ? r.id : 'other';
          return {kind: 'guard', id: n.id, species: GUARDIAN[region], name: `${r.name || REGION_NAME[region]} · 守卫`, level: Math.min(5, 1 + Math.floor((n.order || 0) / 3)), note: n.name};
        }
      } catch { /* 地图拿不到就用纸靶 */ }
    }
    return {kind: 'target', name: route.source === 'vocab' ? '纸靶 · 生词' : route.source === 'notes' ? '纸靶 · 笔记' : '纸靶', level: 1};
  }
  function monsterEnemy(m, variant) {
    if (!m) return null;
    return {kind: 'monster', id: m.id, species: m.species, name: m.name, level: m.level, evolved: m.evolved,
      note: variant?.source === 'local' ? '碧琪离线 · 原题换了顺序，这次不算收服' : (m.wins ? `已打赢 ${m.wins} 次 · 再赢 ${Math.max(0, 2 - m.wins)} 次收服` : '第一次讨伐')};
  }

  // ───────────── 背一背挂点 ─────────────
  // drill.js 调：attach(root, {route, top, stage}) → {strike, settled, finish, detach}
  function attach(root, {route = {}, top, stage} = {}) {
    const g = G(); if (!g || !root || !top) return null;
    if (fx()?.settings?.().tier === 'quiet' && !route.forceBattle) { /* 安静档仍显示敌人和血条，只是没有粒子 */ }
    const form0 = g.equippedForm();
    const a = arena({form: form0, strip: true});
    root.dataset.battle = '1';
    // 状态条：× · 碧琪 · 连击 · 本组进度 · 怪的名牌和血条 · 怪 · 星星，一行。
    top.classList.add('pkb-top'); top.append(a.root);
    const mark = () => { const r = top.getBoundingClientRect(); if (!r.height) return; const s = document.documentElement.style; s.setProperty('--pkb-arena-bottom', Math.round(r.bottom) + 'px'); s.setProperty('--pkb-arena-cx', Math.round(r.left + r.width / 2) + 'px'); };
    requestAnimationFrame(mark);
    let alive = true, original = 0, correct = 0, combo = 0, shown = 0;
    a.setHp(1, {instant: true}); a.setCombo(0);
    Promise.all([g.state(30000).catch(() => null), g.forms().catch(() => null), g.manifest()]).then(() => { if (!alive) return; const f = g.equippedForm(); if (f) a.setForm(f); });
    enemyForRoute(route).then(e => { if (alive && e) a.setEnemy(e); });
    return {
      arena: a,
      // 每道题出来时（讨伐换怪）。
      show(item, {total} = {}) {
        if (total) original = total;
        if (item?.monster) a.setEnemy(monsterEnemy(item.monster, item.variant));
        shown = performance.now();
      },
      // 本地判出对错的瞬间（还没等后端）：命中或闪开。
      strike({correct: ok, firstTry, learned, partial, ms} = {}) {
        if (!alive || learned) return;
        if (!ok) { a.dodge(); return; }
        const next = combo + 1;
        const fast = (ms ?? (performance.now() - shown)) < 3500;
        const crit = Boolean(firstTry && !partial && (next % 5 === 0 || (fast && next >= 3)));
        const damage = Math.round((partial ? 48 : 96 + next * 6) * (crit ? 1.8 : 1) + Math.random() * 9);
        a.strike({crit, damage, partial});
      },
      // 后端回来以后：连击（以 drill 的计数为准）、血条、奖励、大招。
      settled({response, combo: n, correctCount, total, ok} = {}) {
        if (!alive) return;
        if (total) original = total;
        if (Number.isFinite(correctCount)) correct = correctCount;
        const before = combo; combo = n || 0; a.setCombo(combo);
        if (original) a.setHp(1 - correct / original);
        const awards = response?.game?.awards || [];
        if (awards.length) g.play(awards, {from: a.foe});
        if (ok && combo > before && combo > 0 && combo % a.threshold === 0) a.ult(combo);
      },
      finish(summary) {
        if (!alive) return;
        if (original && correct >= original) a.defeat({capture: route.source === 'hunt'});
        const awards = summary?.game?.awards || [];
        if (awards.length) setTimeout(() => g.play(awards, {from: a.foe}), 500);
        else g.pending();
      },
      detach() { alive = false; a.root.remove(); top.classList.remove('pkb-top'); delete root.dataset.battle; },
    };
  }

  // ───────────── 守关战（gameguard）：后端判分的单选卷 ─────────────
  function mountGuard(host, ctx) {
    const g = G(); const local = ctx.local?.() || {};
    const opts = local.guardRoute || local.gameOpts || {};
    host.classList.add('pkb-guard');
    // 跟背一背同一套作答页：顶上一条状态条，下面一栏（最宽 760）题型小字 → 题干 → 选项 → 反馈卡。
    const top = el('header', 'pk-drill-top pkb-top pkb-guard__top');
    const back = el('button', 'pkb-x', '×'); back.type = 'button'; back.setAttribute('aria-label', '退出守关战');
    const title = el('div', 'pkb-guard__title'); title.append(el('small', 'pkb-kicker', 'GUARD BATTLE'), el('b', '', opts.node?.name ? `守关 · ${opts.node.name}` : '守关战'));
    const count = el('span', 'pk-drill-count pkb-guard__count pkb-num', '');
    top.append(back, title, count); host.append(top);
    const backTo = () => { const v = local.returnView; return v && v !== 'gameguard' ? v : 'gamemap'; };
    const backName = v => desk()?.backName?.(v) || ({today: '回营地', gamemap: '回地图', gamehunt: '回讨伐', stage: '回舞台'}[v] || '返回');
    // 注意 go() 没有返回值：以前写成 `ctx.go?.(…) ?? desk().go('today')`，回了地图又被拽回营地。
    const leaveNow = () => (ctx.go ? ctx.go(backTo()) : desk()?.go(backTo()));
    // 做到一半退出要问一句（和讨伐一样）：守关卷不能接着做，退了这次就不算。
    let finished = false, asking = false, i = 0;
    const askLeave = () => {
      if (finished || i === 0 || !payload?.items?.length) { leaveNow(); return; }
      if (asking) return; asking = true;
      const dialog = el('dialog', 'lesson-dialog pk-drill-ask'); dialog.setAttribute('aria-label', '退出守关战');
      dialog.append(el('p', '', `守关卷做到第 ${Math.min(i + 1, items.length)} / ${items.length} 题。现在退出，这次不算，下次重新出卷。`));
      const row = el('div', 'pk-done-actions');
      const stay = el('button', 'pk-btn', '接着打'); stay.type = 'button'; stay.dataset.kind = 'go'; stay.addEventListener('click', () => dialog.close('stay'));
      const quit = el('button', 'pk-link', `退出，${backName(backTo())}`); quit.type = 'button'; quit.addEventListener('click', () => dialog.close('leave'));
      row.append(stay, quit); dialog.append(row); host.append(dialog); dialog.showModal(); stay.focus();
      dialog.addEventListener('close', () => { asking = false; const go = dialog.returnValue === 'leave'; dialog.remove(); if (go) leaveNow(); }, {once: true});
    };
    back.addEventListener('click', askLeave);
    back.setAttribute('aria-label', `退出守关战，${backName(backTo())}`); back.title = back.getAttribute('aria-label');
    const payload = opts.payload;
    if (!payload?.items?.length) { host.append(el('p', 'pkb-empty', '守关卷还没准备好。回地图再点一次守关。')); return; }
    const a = arena({form: g.equippedForm(), strip: true}); top.append(a.root);
    a.setEnemy({kind: 'guard', species: GUARDIAN[opts.node?.region] || 'fog-puff', name: `${REGION_NAME[opts.node?.region] || '区域'} · 守卫`, level: 3, note: opts.node?.name || ''});
    a.setHp(1, {instant: true}); a.setCombo(0);
    const stage = el('div', 'pk-drill-stage pkb-guard__stage'); const qWrap = el('section', 'pk-drill-col pkb-guard__q'); stage.append(qWrap); host.append(stage);
    const live = el('div', 'pk-sr'); live.setAttribute('aria-live', 'polite'); host.append(live);
    const items = payload.items; let right = 0, combo = 0, busy = false, alive = true;
    const paint = () => { count.textContent = `${Math.min(i + 1, items.length)} / ${items.length}`; };
    function show() {
      paint(); qWrap.replaceChildren();
      const it = items[i]; if (!it) return finish();
      const q = el('div', 'pk-drill-q');
      const stem = el('h3', 'pk-drill-stem', it.prompt); if (String(it.prompt || '').length > 90) stem.classList.add('is-long');
      q.append(el('p', 'pk-drill-kicker', it.point ? `第 ${i + 1} 题 · 考点 · ${it.point}` : `第 ${i + 1} 题 · 单选`), stem);
      const list = el('div', 'pk-drill-options pkb-guard__opts');
      it.options.forEach((o, k) => { const b = el('button', 'pk-choice pkb-opt'); b.type = 'button'; b.append(el('kbd', '', 'ABCD'[k] || String(k + 1)), el('span', '', o)); b.addEventListener('click', () => pick(k, b)); list.append(b); });
      q.append(list);
      const bar = el('footer', 'pk-drill-bar'); bar.append(el('span', 'pk-drill-keys', `点选即作答 · 1–${it.options.length} 或 A–${'ABCD'[it.options.length - 1] || 'D'}`));
      qWrap.append(q, bar); // 不自动聚焦第一项：焦点环看起来像已经选了 A。键盘 1–4 / A–D 由页面 keydown 接。
    }
    async function pick(k, b) {
      if (busy || !alive) return; busy = true;
      const t0 = performance.now();
      const buttons = [...qWrap.querySelectorAll('.pkb-opt')]; buttons.forEach(x => { x.disabled = true; }); b.classList.add('is-lock');
      host.dataset.lockMs = String(Math.round(performance.now() - t0));
      let r;
      try { r = await g.call('guard.answer', {attemptId: payload.attemptId, itemId: items[i].itemId, answer: k}); }
      catch (e) { buttons.forEach(x => { x.disabled = false; }); b.classList.remove('is-lock'); busy = false; live.textContent = e.message || '没记上'; return; }
      if (!alive) return;
      host.dataset.feedbackMs = String(Math.round(performance.now() - t0));
      b.classList.remove('is-lock'); buttons[r.answer]?.classList.add('is-answer'); if (!r.correct) b.classList.add('is-wrong');
      if (r.correct) { right++; combo = r.combo ?? combo + 1; a.strike({crit: Boolean(r.crit), damage: r.damage || 100}); } else { combo = 0; a.dodge(); }
      a.setCombo(combo); a.setHp(1 - right / items.length);
      if (r.correct && combo > 0 && combo % a.threshold === 0) a.ult(combo);
      qWrap.querySelector('.pk-drill-bar')?.remove();
      const next = () => { i++; busy = false; show(); };
      const R = window.__pinkieDeskReward;
      if (R?.feedbackSheet) {
        const sheet = R.feedbackSheet(qWrap, {kind: r.correct ? 'right' : 'wrong', title: r.correct ? '命中' : '记下了', again: false, line: r.correct ? (r.explain || '') : `这题会变成错题怪，过几天回来。${r.explain ? ' ' + r.explain : ''}`, onContinue: next});
        const copy = sheet?.sheet?.querySelector('.pk-sheet-copy');
        if (copy) {
          const p = el('p', 'pk-sheet-explain', '碧琪在按标准答案讲…');
          copy.append(p);
          g.call('guard.explain', {attemptId: payload.attemptId, itemId: items[i].itemId, yours: items[i].options[k]}).then(res => {
            if (!p.isConnected) return;
            if (res?.text) p.textContent = res.text; else p.remove();
          }).catch(() => { if (p.isConnected) p.remove(); });
        }
      } else {
        const note = el('div', 'pkb-guard__explain'); note.append(el('b', '', r.correct ? '命中' : '这题记下了，会变成错题怪回来'), el('p', '', r.explain || ''));
        const nb = el('button', 'pkg-btn pk-btn', i + 1 < items.length ? '下一题' : '结算'); nb.type = 'button'; nb.addEventListener('click', next); note.append(nb); qWrap.append(note); nb.focus();
      }
      live.textContent = r.correct ? '答对了' : '没答对';
    }
    async function finish() {
      finished = true;
      qWrap.replaceChildren(el('p', 'pkb-empty', '结算中…'));
      try {
        const r = await g.call('guard.finish', {attemptId: payload.attemptId});
        if (!alive) return;
        if (r.passed) a.defeat();
        const card = el('div', 'pkb-result'); card.dataset.passed = String(Boolean(r.passed));
        card.append(el('small', 'pkb-kicker', r.perfect ? 'PERFECT' : r.passed ? 'CLEARED' : 'RETREAT'), el('h3', '', r.passed ? (r.perfect ? '满分守关' : '守关成功') : '这次没守住'),
          el('p', 'pkb-result__score', ''), el('p', 'pkb-result__line', r.passed ? '这一区的路通了。' : '没关系，错的题已经记成错题怪，过几天打回来。'));
        card.querySelector('.pkb-result__score').append(el('b', 'pkb-num', String(r.score ?? right)), document.createTextNode(` / ${items.length}`));
        const actions = el('div', 'pkb-result__act');
        const home = backTo();
        const primary = el('button', 'pkg-btn', backName(home)); primary.type = 'button'; primary.addEventListener('click', () => ctx.go?.(home));
        actions.append(primary);
        if (home !== 'gamemap') { const toMap = el('button', 'pkb-link', '回地图'); toMap.type = 'button'; toMap.addEventListener('click', () => ctx.go?.('gamemap')); actions.append(toMap); }
        if (home !== 'today') { const toCamp = el('button', 'pkb-link', '回营地'); toCamp.type = 'button'; toCamp.addEventListener('click', () => desk()?.go('today')); actions.append(toCamp); }
        card.append(actions); qWrap.replaceChildren(card);
        if (r.awards?.length) g.play(r.awards, {from: a.foe});
      } catch (e) { qWrap.replaceChildren(el('p', 'pkb-empty', e.message || '结算失败，再点一次')); }
    }
    show();
    return {unmount() { alive = false; }, keydown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') { event.preventDefault(); askLeave(); return; }
      const key = String(event.key || '').toLowerCase(); const n = /^[1-4]$/.test(key) ? Number(key) : 'abcd'.indexOf(key) + 1;
      if (n >= 1 && n <= 4) { event.preventDefault(); qWrap.querySelectorAll('.pkb-opt')[n - 1]?.click(); }
      if (event.key === 'Enter' && !event.target?.closest?.('button')) qWrap.querySelector('.pk-sheet .pk-btn, .pkb-guard__explain .pk-btn')?.click();
    }};
  }

  // ───────────── 讨伐（gamehunt）：错题怪名单 + 开打 ─────────────
  async function mountHunt(host, ctx) {
    const g = G();
    host.classList.add('pkb-hunt');
    const head = el('header', 'pkb-page__head');
    const back = el('button', 'pkb-x', '×'); back.type = 'button'; back.setAttribute('aria-label', G()?.backLabel?.() || '回营地'); back.addEventListener('click', () => (G()?.goBack ? G().goBack() : desk()?.go('today')));
    const t = el('div'); t.append(el('small', 'pkb-kicker', 'HUNT'), el('h2', '', '讨伐错题怪'));
    const hudHost = el('div', 'pkb-page__hud');
    head.append(back, t, hudHost); host.append(head);
    try { await g.manifest(); await g.forms(); await g.state(); g.hud(hudHost, {compact: true}); } catch { /* HUD 可选 */ }
    const tabs = el('div', 'pkg-seg'); let filter = ctx.local?.()?.huntFilter || 'due';
    const body = el('div', 'pkb-hunt__grid');
    const foot = el('div', 'pkb-hunt__foot');
    for (const [id, label] of [['due', '到期'], ['active', '潜伏中'], ['captured', '已收服']]) { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-selected', String(id === filter)); b.addEventListener('click', () => { filter = id; if (ctx.local) ctx.local().huntFilter = id; tabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b))); load(); }); tabs.append(b); }
    host.append(el('p', 'pkb-hunt__lede', '答错的题会变成错题怪，隔几天回来。打赢两次（中间隔 3 天以上）就收服。讨伐用的是碧琪新出的变体题，不是原题。'), tabs, body, foot);
    async function load() {
      body.replaceChildren(el('p', 'pkb-empty', '正在点名…'));
      let list = [];
      try { list = (await g.call('monsters.list', {filter}))?.monsters || []; } catch (e) { body.replaceChildren(el('p', 'pkb-empty', e.message)); return; }
      body.replaceChildren();
      if (!list.length) body.append(el('p', 'pkb-empty', filter === 'due' ? '现在没有到期的错题怪。它们会按记忆曲线回来。' : filter === 'captured' ? '还没有收服的错题怪。' : '没有潜伏中的错题怪。答错的题会出现在这里。'));
      for (const m of list) {
        const card = el('article', 'pkb-mon'); card.dataset.state = m.state; card.dataset.level = String(Math.min(5, m.level || 1)); card.style.setProperty('--tone', LEVEL_TONE[Math.min(5, m.level || 1)] || 'transparent');
        const pic = el('div', 'pkb-mon__art'); const src = g.art(`monster/${m.species}`);
        if (src) { const i = el('img'); i.src = src; i.alt = ''; i.decoding = 'async'; pic.append(i); } else pic.append(el('span', 'pkb-mon__ghost', (m.name || '?').slice(0, 1)));
        const info = el('div', 'pkb-mon__info');
        info.append(el('small', 'pkb-kicker', `${REGION_NAME[m.region] || '迷雾'} · LV.${m.level || 1}${m.evolved ? ' · 进化' : ''}`), el('b', '', m.name || '错题怪'), el('p', '', m.blurb || ''));
        const due = m.state === 'captured' ? '已收服' : m.state === 'due' ? '到期 · 可以讨伐' : `${Math.max(1, Math.ceil(((m.dueAt || Date.now()) - Date.now()) / 86400000))} 天后回来`;
        info.append(el('em', '', `${due} · 已打赢 ${m.wins || 0}/2`));
        card.append(pic, info); body.append(card);
      }
      foot.replaceChildren();
      const dueN = list.filter(m => m.state === 'due').length;
      if (filter === 'due' && dueN) {
        const go = el('button', 'pkg-go pkb-hunt__go'); go.type = 'button';
        const tx = el('span', 'pkg-go__text'); tx.append(el('small', '', 'HUNT'), el('b', '', '讨伐'), el('em', '', `${Math.min(8, dueN)} 只 · 每只一道新变体题`)); go.append(tx, el('i', 'pkg-go__rule'));
        go.addEventListener('click', async () => {
          go.disabled = true; tx.querySelector('em').textContent = '碧琪在出变体题…';
          try { const s = await g.call('hunt.start', {}, 60000); window.__pinkieDrill?.start({session: s, source: 'hunt', returnTo: 'gamehunt'}); }
          catch (e) { go.disabled = false; tx.querySelector('em').textContent = e.message || '没打开，再点一次'; }
        });
        foot.append(go);
      }
    }
    load();
  }

  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('gameguard', {title: '守关战', wide: 720, mount: (host, ctx) => mountGuard(host, ctx), keydown: (e, ctx) => ctx.pane?.runtime?.keydown?.(e)});
    d.registerView('gamehunt', {title: '讨伐', wide: 720, mount: (host, ctx) => mountHunt(host, ctx)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 20000); }
  // 从营地 / 地图打开守关战时，把 payload 放进这一页的状态。
  window.addEventListener('pinkie:game-open', e => { const {id, opts} = e.detail || {}; if (id !== 'guard') return; const p = desk()?.pane?.(); if (p?.state) p.state.guardRoute = opts; });

  window.__pinkieGameBattle = {attach, arena, monsterEnemy, ultThreshold};
})();
