/* 碧琪上岸记 · 刷题（真题题库，REDO-1109 E2）。两页学习台视图：
   - gamepractice：题库首页。上面四个快速入口（随机 10 题 / 错题重刷 / 听力 Part I / 按年份整套），中间按题型，主体是考点表（题数 · 做过 · 正确率，弱项排前）。
   - gamepracset：作答页。跟背一背 / 守关一套版式：顶上状态条（× · 标题 · 进度 · 战斗条），下面题目；篇章题左文右题（窄屏上文下题），文章自己滚动、题目固定可见。
   判分只认官方答案（后端判）；答完显示官方解析，「讲给我听」才调模型。做错的真题变成错题怪。
   视觉：VFX.md（衬线标题、拉丁窄体小字、等宽数字、发丝线、不出 emoji）。 */
(() => {
  'use strict';
  if (window.__pinkieGamePractice) return;
  const G = () => window.__pinkieGame;
  const desk = () => window.__pinkieStudyDesk;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  const pct = v => (v == null ? '—' : `${v}%`);
  const QKIND = {choice: '词汇语法 · 选择', 'word-form': '词汇语法 · 词形', 'passage-choice': '阅读 · 短文选择', 'practical-fill': '阅读 · 填空', 'passage-short': '阅读 · 简答',
    'term-match': '阅读 · 术语配对', 'translate-choice': '翻译 · 选择', 'translate-passage': '翻译 · 段落', writing: '写作',
    'listen-response': '听力 · 问句应答', 'listen-dialogue': '听力 · 短对话', 'listen-conversation': '听力 · 对话理解', 'listen-dictation': '听力 · 短文填空'};
  const TEXT_KINDS = new Set(['word-form', 'practical-fill', 'passage-short', 'listen-dictation']);
  const BIG_KINDS = new Set(['translate-passage', 'writing']);
  const backName = v => desk()?.backName?.(v) || '返回';

  // 开一组：后端出题 → 放进这一页的状态 → 进作答页（作答页记住从哪进来）
  async function openSet(params, {from} = {}) {
    const g = G();
    const ready = Promise.all([g.manifest(), g.forms()]).catch(() => {}); // 舞台要用美术清单和形态表；不经营地直接进来时这里补上
    const r = await g.call('practice.start', {...params, requestId: rid()}, 60000);
    if (r?.empty || !r?.setId) { g.toast(r?.why || '这一类题现在没有可做的'); return null; }
    await ready;
    const pane = desk()?.pane?.();
    if (pane?.state) { pane.state.practiceSet = r; pane.state.practiceParams = params; }
    desk()?.go('gamepracset');
    return r;
  }

  // ───────────── 题库首页 ─────────────
  async function mountHome(host, ctx) {
    const g = G();
    host.classList.add('pkp-home');
    const head = el('header', 'pkb-page__head');
    const back = btn('pkb-x', '×'); back.setAttribute('aria-label', g?.backLabel?.() || '回营地'); back.title = back.getAttribute('aria-label');
    back.addEventListener('click', () => (g?.goBack ? g.goBack() : desk()?.go('today')));
    const t = el('div'); t.append(el('small', 'pkb-kicker', 'DRILL · 真题题库'), el('h2', '', '刷题'));
    const hudHost = el('div', 'pkb-page__hud');
    head.append(back, t, hudHost); host.append(head);
    try { await g.manifest(); await g.forms(); await g.state(); g.hud(hudHost, {compact: true}); } catch { /* HUD 可选 */ }
    const body = el('div', 'pkp-body'); host.append(body);
    body.append(el('p', 'pkg-empty', '正在翻题库…'));
    let ov;
    try { ov = await g.call('practice.overview', {}, 30000); } catch (e) { body.replaceChildren(el('p', 'pkg-empty', e.message || '题库没打开')); return; }
    if (!host.isConnected) return;
    body.replaceChildren();
    const local = ctx.local?.() || {};
    const busy = b => { b.disabled = true; b.dataset.busy = '1'; };
    const free = b => { b.disabled = false; delete b.dataset.busy; };
    const go = async (b, params) => { busy(b); try { await openSet(params); } catch (e) { g.toast(e.message || '没打开'); } finally { if (b.isConnected) free(b); } };

    if (!ov.total) {
      const empty = el('section', 'pkp-empty');
      empty.append(el('h3', '', '题库还是空的'), el('p', '', '插上放真题的 U 盘、开着 App，碧琪会把每套卷拆好放进考场，题库跟着就有了。'));
      body.append(empty); return;
    }
    const lede = el('p', 'pkp-lede');
    const papers = ov.papers || 0;
    lede.append(el('b', 'pkg-num', String(papers)), document.createTextNode(' 套历年真题和官方模拟卷，'), el('b', 'pkg-num', String(ov.total)), document.createTextNode(' 道题。答案和解析都是官方的。'));
    const locked = (ov.reserved || []).filter(r => r.locked);
    if (locked.length) lede.append(document.createTextNode(` 最新 ${locked.length} 套留给整套模考，不进随机。`));
    body.append(lede);

    // 快速入口
    const quick = el('nav', 'pkp-quick'); quick.setAttribute('aria-label', '刷题方式');
    const card = (id, en, zh, sub, run, {hot = false, off = false} = {}) => {
      const b = btn('pkp-qcard'); b.dataset.q = id; if (hot) b.dataset.hot = '1';
      b.append(el('small', '', en), el('b', '', zh), el('em', '', sub), el('i', 'pkp-qcard__rule'));
      if (off) { b.disabled = true; b.dataset.off = '1'; } else b.addEventListener('click', () => run(b));
      quick.append(b); return b;
    };
    const r = ov.random || {};
    card('random', 'RANDOM', '随机 10 题', r.total ? `词汇 · 词形 · 翻译单题 · 已做 ${r.done}/${r.total}` : '单题池是空的', b => go(b, {mode: 'random', count: 10}), {hot: true, off: !r.total});
    card('wrong', 'RETRY', '错题重刷', ov.wrong ? `${ov.wrong} 道做错的真题原题` : '刷题里还没有做错的题', b => go(b, {mode: 'wrong', count: 10}), {off: !ov.wrong});
    const lis = (ov.kinds || []).find(k => k.id === 'listening');
    card('listening', 'LISTENING', '听力 Part I', lis?.total ? '随机一套 · 放原录音' : '没有听力题', b => go(b, {mode: 'listening'}), {off: !lis?.total});
    card('year', 'BY YEAR', '按年份整套', '进考场，按年份选整卷', () => desk()?.go('gameexam'));
    body.append(quick);

    // 考点表（主体）
    const pts = el('section', 'pkp-points');
    const ph = el('header', 'pkg-sec'); ph.append(el('small', 'pkg-kicker', 'BY TOPIC'), el('h3', '', '按考点'), el('span', 'pkg-sec__meta', '弱项排前 · 10 题一组'));
    pts.append(ph);
    const seg = el('div', 'pkg-seg'); seg.setAttribute('role', 'tablist');
    const areas = [{id: 'all', name: '全部'}, ...(ov.areas || []).filter(a => a.id !== 'listening')];
    let area = areas.some(a => a.id === local.practiceArea) ? local.practiceArea : 'all';
    const list = el('div', 'pkp-plist');
    const paint = () => {
      list.replaceChildren();
      const rows = (ov.points || []).filter(p => area === 'all' || p.area === area);
      if (!rows.length) list.append(el('p', 'pkg-empty', '这一类还没有标好考点的题。'));
      const head = el('div', 'pkp-prow is-head'); head.append(el('span', '', '考点'), el('span', '', '题数'), el('span', '', '做过'), el('span', '', '正确率'), el('span', '', ''));
      if (rows.length) list.append(head);
      for (const p of rows) {
        const row = btn('pkp-prow'); row.dataset.point = p.id;
        const weak = p.done >= 3 && p.acc != null && p.acc < 60;
        if (weak) row.dataset.weak = '1';
        const name = el('span', 'pkp-prow__name'); name.append(el('b', '', p.name), el('small', '', p.groupName));
        const bar = el('i', 'pkp-prow__bar'); bar.style.setProperty('--p', `${p.acc ?? 0}%`); if (p.acc == null) bar.dataset.none = '1';
        const accCell = el('span', 'pkp-prow__acc'); accCell.append(el('b', 'pkg-num', pct(p.acc)), bar);
        row.append(name, el('span', 'pkg-num', String(p.total)), el('span', 'pkg-num', String(p.done)), accCell, el('span', 'pkp-prow__go', weak ? '先补这个' : '练'));
        row.setAttribute('aria-label', `${p.groupName} ${p.name}：${p.total} 题，做过 ${p.done}，正确率 ${pct(p.acc)}`);
        row.addEventListener('click', () => go(row, {mode: 'point', point: p.id, count: 10}));
        list.append(row);
      }
    };
    for (const a of areas) {
      const b = btn('', a.name); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(a.id === area));
      b.addEventListener('click', () => { area = a.id; local.practiceArea = a.id; seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b))); paint(); });
      seg.append(b);
    }
    const listen = btn('', '听力'); listen.disabled = true; listen.dataset.off = '1'; listen.title = '先按套练 Part I，单题随机准备中'; listen.setAttribute('aria-disabled', 'true');
    seg.append(listen);
    const listenNote = el('p', 'pkp-listenote', '先按套练 Part I，单题随机准备中');
    pts.append(seg, listenNote, list); paint();

    // 按题型（侧栏）
    const kinds = el('section', 'pkp-kinds');
    const kh = el('header', 'pkg-sec'); kh.append(el('small', 'pkg-kicker', 'BY TYPE'), el('h3', '', '按题型'));
    kinds.append(kh);
    for (const k of (ov.kinds || []).filter(x => x.id !== 'listening')) {
      const b = btn('pkp-kind'); b.dataset.kind = k.id;
      const txt = el('span', 'pkp-kind__t'); txt.append(el('b', '', k.name), el('small', '', k.note || ''));
      b.append(txt, el('span', 'pkp-kind__n pkg-num', k.total ? `${k.done}/${k.total}` : '—'));
      if (!k.total) b.disabled = true; else b.addEventListener('click', () => go(b, {mode: 'kind', kind: k.id, count: 10}));
      kinds.append(b);
    }
    // 留卷
    if ((ov.reserved || []).length) {
      const res = el('div', 'pkp-reserved');
      res.append(el('small', 'pkg-kicker', 'RESERVED'), el('p', '', '最新几套真题留给考场整套模考；考过或手动解锁后进题库。'));
      for (const p of ov.reserved) {
        const row = el('div', 'pkp-res'); row.append(el('span', '', p.title));
        if (p.locked) {
          const u = btn('pkb-link', '解锁'); u.addEventListener('click', async () => { u.disabled = true; try { await g.call('practice.unlock', {paperId: p.paperId}); desk()?.go('gamepractice'); } catch (e) { u.disabled = false; g.toast(e.message || '没解锁'); } });
          row.append(u);
        } else row.append(el('em', '', '已进题库'));
        res.append(row);
      }
      kinds.append(res);
    }
    const tg = ov.tagging || {};
    if (tg.untagged) kinds.append(el('p', 'pkp-tagnote', tg.state === 'tagging' ? `碧琪在给新题标考点（${tg.untagged} 道）…` : `${tg.untagged} 道新题还没标考点，碧琪在线时会补上。`));
    if (ov.unclassified) kinds.append(el('p', 'pkp-tagnote', `${ov.unclassified} 道题考点没标出来，在「未分类」里。`));
    const grid = el('div', 'pkp-grid'); grid.append(pts, kinds); body.append(grid);
    return {unmount() {}};
  }

  // ───────────── 作答页（v4 舞台版） ─────────────
  // 上面一条战斗舞台（区域背景 · 碧琪 · 这一波的怪），下面是题。一组题切成几波，每波一只怪，血量 = 这一波的题数：
  // 答对 = 碧琪出手打掉一格；答错 = 怪反扑一下、这格血留着。一波做完：全对 = 击破；有错 = 它带着错题溜走（后端把错题记成错题怪，过几天回来）。
  // 判分、奖励、连击都以后端为准；舞台只负责把结果演出来，单次演出 ≤ 400 ms，不挡「下一题」。
  function mountSet(host, ctx) {
    const g = G(), S = window.__pinkieGameStage;
    const local = ctx.local?.() || {};
    const data = local.practiceSet;
    host.classList.add('pkq', 'pkp-set');
    const backTo = () => { const v = local.returnView; return v && v !== 'gamepracset' ? v : 'gamepractice'; };
    const leaveNow = () => (ctx.go ? ctx.go(backTo()) : desk()?.go(backTo()));
    const items = data?.items || [];
    const splitKey = it => (it.qkind === 'term-match' ? null : it.material && !it.qkind.startsWith('listen') ? it.material : (it.qkind === 'listen-dictation' ? it.material : null));
    const tight = items.some(it => splitKey(it) || BIG_KINDS.has(it.qkind)) || data?.mode === 'listening';
    const form = g.equippedForm();
    const stage = S.create({form, scene: S.sceneOf(items[0]), compact: tight, total: items.length});
    const back = S.closeButton(`退出刷题，${backName(backTo())}`);
    stage.top.prepend(back);
    stage.setTitle(data?.mode === 'listening' ? 'DRILL · 听力' : 'DRILL · 真题', data?.title || '刷题');
    host.append(stage.root);
    if (!items.length) {
      const body = el('div', 'pkq-body'); const card = el('div', 'pkq-card');
      card.append(el('h3', 'pkq-stem is-zh', '这组题不在了'), el('p', 'pkq-result__line', '回题库再开一组。'));
      const b = S.actionButton(backName(backTo()), {kind: 'next'}); b.addEventListener('click', leaveNow);
      const bar = el('div', 'pkq-bar'); bar.append(el('span'), b); card.append(bar); body.append(card); host.append(body);
      back.addEventListener('click', leaveNow); stage.setEnemy(null);
      return {unmount() { stage.destroy(); }};
    }
    const answered = {...(data.answered || {})};
    let i = items.findIndex(it => !answered[it.itemId]); if (i < 0) i = items.length;
    let right = Object.values(answered).filter(r => r.correct).length, combo = 0, maxCombo = 0, busy = false, alive = true, finished = Boolean(data.finished), asking = false, stars = 0;
    let picked = null, waveNow = -1; const t0 = Date.now();
    const waves = S.waves(items); stage.setWaveMarks(waves);
    const waveOf = idx => waves.find(w => idx >= w.from && idx < w.from + w.size) || waves.at(-1);
    const waveRight = w => items.slice(w.from, w.from + w.size).filter(it => answered[it.itemId]?.correct).length;
    const threshold = form?.bonus?.kind === 'ultThreshold' ? Number(form.bonus.value) || 10 : 10;
    const paintPips = () => stage.setProgress(items.map(it => (answered[it.itemId] ? (answered[it.itemId].correct ? 'right' : 'wrong') : undefined)), i);
    const paintGauge = () => stage.setGauge((combo % threshold || (combo ? threshold : 0)) / threshold, {full: combo > 0 && combo % threshold === 0});
    // 听力：整套原录音一个播放条
    let audio = null;
    if (data.audio?.url) { audio = new Audio(data.audio.url); audio.preload = 'metadata'; host.append(recordBar(audio)); }
    else if (data.mode === 'listening') host.append(el('p', 'pkp-warn', '本机没有这套的原录音，只能看题。'));
    const body = el('div', 'pkq-body'); host.append(body);
    const live = el('div', 'pk-sr'); live.setAttribute('aria-live', 'polite'); host.append(live);

    const askLeave = () => {
      const done = Object.keys(answered).length;
      if (finished || !done) { leaveNow(); return; }
      if (asking) return; asking = true;
      const dialog = el('dialog', 'lesson-dialog pk-drill-ask'); dialog.setAttribute('aria-label', '退出刷题');
      dialog.append(el('p', '', `这组做到第 ${Math.min(i + 1, items.length)} / ${items.length} 题。做过的都记下了（星星已经发了），剩下的下次再抽。`));
      const row = el('div', 'pk-done-actions');
      const stay = btn('pk-btn', '接着做'); stay.dataset.kind = 'go'; stay.addEventListener('click', () => dialog.close('stay'));
      const quit = btn('pk-link', `先放着，${backName(backTo())}`); quit.addEventListener('click', () => dialog.close('leave'));
      row.append(stay, quit); dialog.append(row); host.append(dialog); dialog.showModal(); stay.focus();
      dialog.addEventListener('close', () => { asking = false; const leave = dialog.returnValue === 'leave'; dialog.remove(); if (leave) leaveNow(); }, {once: true});
    };
    back.addEventListener('click', askLeave);

    // 文章：同一篇只建一次，换题不跳
    let shownMaterial, matPane = null, qCol = null;
    function layout(it) {
      const key = splitKey(it);
      if (key === shownMaterial && qCol?.isConnected) return;
      shownMaterial = key; body.replaceChildren(); body.classList.toggle('is-split', Boolean(key));
      if (key) {
        matPane = el('article', 'pkq-material');
        const k = el('small', '', it.qkind === 'listen-dictation' ? 'PASSAGE · 听写原文' : 'PASSAGE · 原文'); k.prepend(S.icon('book'));
        const text = el('div', 'pkq-material__text'); text.textContent = data.materials?.[key] || ''; matPane.append(k, text);
        body.append(matPane);
      } else matPane = null;
      qCol = el('section', 'pkq-card'); body.append(qCol);
    }
    function enterWave(w, first) {
      waveNow = w.index;
      stage.setScene(w.scene);
      stage.setEnemy({species: w.species, name: w.name, level: w.level, elite: w.elite, hp: w.size, left: w.size - waveRight(w)}, {instant: first && S.reduced()});
      if (first) { stage.intro(); stage.banner(waves.length > 1 ? `ENCOUNTER · 1 / ${waves.length}` : 'ENCOUNTER', w.name, 1200); }
      else stage.banner(w.elite ? `ELITE · ${w.index + 1} / ${waves.length}` : `WAVE · ${w.index + 1} / ${waves.length}`, w.name, 1000);
    }
    const DIFF = {易: 1, 中: 2, 难: 3};
    function stemNode(it, prompt) {
      const stem = el('h3', 'pkq-stem'); const long = prompt.length > 110 || BIG_KINDS.has(it.qkind);
      if (long) stem.classList.add('is-long'); if (/[一-鿿]/.test(prompt.slice(0, 12))) stem.classList.add('is-zh');
      const parts = prompt.split(/_{3,}/);
      parts.forEach((p, k) => { if (k) stem.append(el('span', 'pkq-blank')); stem.append(document.createTextNode(p)); });
      if (it.base) stem.append(el('span', 'pkq-base', `（${it.base}）`));
      return stem;
    }
    const fieldLine = () => { const t = document.createElement('template'); t.innerHTML = '<svg class="pkq-field__line" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><path d="M0 2h100" pathLength="1"/></svg>'; return t.content.firstChild; };
    function show() {
      const it = items[i];
      if (!it) { finish(); return; }
      const w = waveOf(i);
      if (w.index !== waveNow) enterWave(w, waveNow < 0);
      paintPips(); paintGauge();
      layout(it);
      qCol.replaceChildren(); busy = false; picked = null;
      if (!S.reduced()) { qCol.classList.remove('is-in'); void qCol.offsetWidth; qCol.classList.add('is-in'); }
      const meta = el('div', 'pkq-meta');
      meta.append(el('span', 'pkq-chip is-no', `${String(i + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`), el('span', 'pkq-chip', QKIND[it.qkind] || '真题'));
      if (it.point && it.point !== '未分类') meta.append(el('span', 'pkq-chip is-point', it.point));
      if (DIFF[it.difficulty]) { const c = el('span', 'pkq-chip', `难度 ${it.difficulty}`); const dots = el('span', 'pkq-dots'); for (let k = 1; k <= 3; k++) { const d = el('i'); if (k <= DIFF[it.difficulty]) d.dataset.on = '1'; dots.append(d); } c.append(dots); meta.append(c); }
      meta.append(el('span', 'pkq-src', `${it.paper}${it.no ? ' · 原卷第 ' + it.no + ' 题' : ''}`));
      const prompt = it.qkind === 'listen-response' ? '听问句，选最佳应答' : it.qkind === 'listen-dialogue' ? '听对话，回答问题' : it.qkind === 'listen-conversation' ? '听长对话 / 短文，回答问题' : (it.prompt || '');
      qCol.append(meta, stemNode(it, prompt));
      const fire = S.actionButton('出手', {hint: 'Enter'}); fire.classList.add('pkq-fire'); fire.setAttribute('aria-disabled', 'true');
      const bar = el('div', 'pkq-bar'); const keys = el('div', 'pkq-keys'); bar.append(keys, fire);
      const hint = (...parts) => { for (const p of parts) keys.append(typeof p === 'string' ? document.createTextNode(p) : p); };
      const kbd = t => el('kbd', '', t);
      if (it.options || it.qkind === 'term-match') {
        const opts = it.options ? it.options.map((o, k) => ({answer: k, key: 'ABCDEFGH'[k] || String(k + 1), text: o})) : letterChoices(data.materials?.[it.material] || '').map(L => ({answer: L.letter, key: L.letter, text: L.text}));
        const list = el('div', 'pkq-opts'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', '选项');
        if (it.qkind === 'term-match') list.classList.add('is-letters'); else if (opts.some(o => o.text.length > 34)) list.classList.add('is-list');
        for (const o of opts) { const b = S.optionButton(o.key, o.text); b.addEventListener('click', () => choose(o.answer, b, list, fire)); list.append(b); }
        qCol.append(list);
        fire.addEventListener('click', () => { if (!picked || busy || fire.getAttribute('aria-disabled') === 'true') return; submit(picked.answer, picked.el); });
        if (it.options) hint(kbd('1'), '–', kbd(String(opts.length)), ' 或 ', kbd('A'), '–', kbd(opts.at(-1).key), ' 选 · 再按一次或 ', kbd('Enter'), ' 出手');
        else hint('点一项，选错了可以改 · ', kbd('Enter'), ' 出手');
      } else if (BIG_KINDS.has(it.qkind)) {
        const ta = el('textarea', 'pkq-essay'); ta.rows = it.qkind === 'writing' ? 11 : 7; ta.placeholder = it.qkind === 'writing' ? '在这里写作文（80–100 词）。写完交给碧琪阅卷。' : '在这里写中文译文。';
        ta.setAttribute('aria-label', '你的作答');
        const draftKey = `pkp-draft:${data.setId}:${it.itemId}`;
        try { ta.value = sessionStorage.getItem(draftKey) || ''; } catch { /* 无 */ }
        const ready = () => fire.setAttribute('aria-disabled', String(!ta.value.trim()));
        ta.addEventListener('input', () => { try { sessionStorage.setItem(draftKey, ta.value); } catch { /* 无 */ } ready(); });
        fire.querySelector('.pkq-act__text').textContent = '交给碧琪阅卷'; fire.querySelector('.pkq-act__kbd')?.remove(); ready();
        fire.addEventListener('click', () => { if (busy || !ta.value.trim()) { ta.focus(); return; } submit(ta.value, fire, {essay: true}); });
        qCol.append(ta); hint(it.qkind === 'writing' ? '按考场五档细则判分，约半分钟' : '按准确 8 + 通顺 4 判分');
      } else {
        const fillForm = el('form', 'pkq-fill'); const field = el('div', 'pkq-field'); const input = el('input', 'pkq-input'); input.autocomplete = 'off'; input.spellcheck = false; input.autocapitalize = 'off';
        input.placeholder = it.qkind === 'word-form' ? '填词的正确形式' : '填答案（1–3 个词）'; input.setAttribute('aria-label', '你的答案');
        field.append(input, fieldLine()); fillForm.append(field); qCol.append(fillForm);
        input.addEventListener('input', () => { const ok = Boolean(input.value.trim()); if (ok && fire.getAttribute('aria-disabled') === 'true') S.sfx('ui-pick'); fire.setAttribute('aria-disabled', String(!ok)); });
        const go = () => { if (busy) return; if (!input.value.trim()) { input.focus(); return; } submit(input.value, fire, {field}); };
        fillForm.addEventListener('submit', e => { e.preventDefault(); go(); }); fire.addEventListener('click', go);
        hint(kbd('Enter'), ' 出手 · 不分大小写');
        setTimeout(() => { if (alive && input.isConnected) input.focus({preventScroll: true}); }, 60);
      }
      qCol.append(bar);
      qCol.scrollTop = 0; if (!matPane) body.scrollTop = 0;
    }
    // 点一下选定（还能改），同一项再点一次 / 回车 / 出手键 = 交卷
    function choose(answer, b, list, fire) {
      if (busy) return;
      if (picked?.el === b) { submit(answer, b); return; }
      picked = {answer, el: b}; S.sfx('ui-pick');
      list.querySelectorAll('.pkq-opt').forEach(n => { n.classList.toggle('is-on', n === b); n.setAttribute('aria-pressed', String(n === b)); });
      if (fire.getAttribute('aria-disabled') === 'true') { fire.setAttribute('aria-disabled', 'false'); if (!S.reduced()) { fire.classList.remove('is-ready-pop'); void fire.offsetWidth; fire.classList.add('is-ready-pop'); } }
    }

    async function submit(answer, b, {essay = false, field = null} = {}) {
      if (busy || !alive) return; busy = true;
      const it = items[i]; const w = waveOf(i);
      const controls = [...qCol.querySelectorAll('button, input, textarea')]; controls.forEach(x => { x.disabled = true; });
      const fire = qCol.querySelector('.pkq-fire'); if (fire) fire.dataset.busy = '1';
      S.sfx('ui-go'); b?.classList.add('is-lock');
      const waitNote = essay ? el('p', 'pkq-wait', '碧琪在按考场细则阅卷…') : null; if (waitNote) qCol.querySelector('.pkq-bar')?.before(waitNote);
      let r;
      try { r = await G().call('practice.answer', {setId: data.setId, itemId: it.itemId, answer}, essay ? 90000 : 20000); }
      catch (e) { controls.forEach(x => { x.disabled = false; }); b?.classList.remove('is-lock'); if (fire) delete fire.dataset.busy; waitNote?.remove(); busy = false; live.textContent = e.message || '没记上，再交一次'; G().toast(e.message || '没记上，再交一次'); return; }
      if (!alive) return;
      waitNote?.remove(); b?.classList.remove('is-lock');
      answered[it.itemId] = r;
      const list = qCol.querySelector('.pkq-opts'); list?.classList.add('is-done');
      if (list) { const all = [...list.querySelectorAll('.pkq-opt')]; const keyEl = it.options ? all[r.answer] : all.find(x => x.dataset.key === r.key); keyEl?.classList.add('is-answer'); b?.classList.remove('is-on'); if (!r.correct) b?.classList.add('is-wrong'); }
      if (field) field.dataset.s = r.correct ? 'right' : 'wrong';
      combo = r.combo || 0; maxCombo = Math.max(maxCombo, combo);
      const last = i === w.from + w.size - 1;
      if (r.correct) {
        right++;
        const crit = combo > 0 && combo % 5 === 0;
        stage.strike({crit, damage: Math.round((96 + combo * 6) * (crit ? 1.8 : 1) + Math.random() * 9), kill: last && waveRight(w) === w.size});
      } else stage.counter();
      if (last && waveRight(w) < w.size) { const foeNow = stage.enemy; setTimeout(() => { if (alive && stage.enemy === foeNow) stage.flee(w.size - waveRight(w)); }, S.reduced() ? 0 : 620); }
      stage.setCombo(combo); paintGauge(); paintPips();
      if (r.correct && combo > 0 && combo % threshold === 0) ult(combo);
      const got = (r.awards || []).filter(a => a.kind === 'stars').reduce((n, a) => n + (Number(a.amount) || 0), 0);
      if (got) { stars += got; stage.addGain(got); }
      if (r.awards?.length) G().play(r.awards, {from: stage.foe});
      qCol.querySelector('.pkq-bar')?.remove();
      feedback(it, r, got);
      live.textContent = r.correct ? '答对了' : '没答对';
    }
    async function ult(n) {
      const engine = window.__pinkieGameFx; if (!engine?.cinematic || !form) return;
      const TITLE = {burst: '新星', slash: '一闪', spell: '星阵', curtain: '谢幕', ink: '泼墨', warp: '跃迁', rain: '星落', stamp: '落印', beam: '天光'};
      const u = window.__pinkieLoadout?.ultOf(form) || {preset: form.ult || 'burst', palette: form.palette};
      try { await engine.cinematic(u.preset, {text: TITLE[u.preset] || '大招', sub: `${n} COMBO · ${form.name}`, kicker: form.name, art: g.ultArt(form.id) || g.portrait(form.id), palette: u.palette, particle: form.particle, form: g.fxForm(form)}); }
      catch { /* 过场被跳过或没有 WebGL */ }
    }
    function feedback(it, r, got) {
      const box = el('div', 'pkq-fb'); box.dataset.kind = r.correct ? 'right' : 'wrong';
      const headline = r.grade ? `${r.grade.score} / ${r.grade.max} 分` : r.correct ? '命中' : '被它躲开了';
      const h = el('div', 'pkq-fb__head'); const seal = el('span', 'pkq-fb__seal'); seal.append(S.icon(r.correct ? 'check' : 'cross'));
      h.append(seal, el('b', '', headline), el('small', '', r.correct ? (combo > 1 ? `HIT · ${combo} COMBO` : 'HIT') : 'MISS'));
      if (got) { const p = el('span', 'pkq-fb__plus'); p.append(S.icon('star'), document.createTextNode(`+${got}`)); h.append(p); }
      box.append(h);
      const rowOf = (label, node) => { const p = el('p', 'pkq-fb__row'); p.append(el('small', '', label), node); return p; };
      if (r.grade?.reason) box.append(rowOf('碧琪评语', el('span', '', r.grade.reason)));
      if (!r.grade) box.append(rowOf('官方答案', el('b', '', r.key || '')));
      if (r.why) box.append(rowOf('官方解析', el('span', '', r.why)));
      if (r.script) box.append(rowOf('录音原文', el('span', '', r.script)));
      if (r.grade?.reference) { const ref = el('details'); ref.append(el('summary', '', '看官方参考答案'), el('p', '', r.grade.reference)); box.append(ref); }
      if (r.monster) box.append(el('p', 'pkq-fb__note', `这题变成了错题怪「${r.monster.name}」，过几天回来，讨伐时出变体题。`));
      const row = el('div', 'pkq-fb__act');
      const next = S.actionButton(i + 1 < items.length ? '下一题' : '结算', {kind: 'next', hint: 'Enter'}); next.classList.add('pkq-next');
      next.addEventListener('click', () => { S.sfx('ui-next'); i++; show(); });
      const explain = S.ghostButton('讲给我听'); const explainText = explain.querySelector('span');
      let explainNotice;
      const failed = message => {
        if (!box.isConnected) return;
        explain.disabled = false; explainText.textContent = '再讲一次';
        explainNotice = el('p', 'pkq-fb__note', message || '这次没有生成讲解，请检查内置模型后重试。');
        const switchModel = btn('pkb-link', '切换模型'); switchModel.addEventListener('click', () => desk()?.openBuiltinModel?.());
        explainNotice.append(document.createTextNode(' '), switchModel); row.before(explainNotice);
      };
      explain.addEventListener('click', async () => {
        explainNotice?.remove(); explainNotice = null;
        explain.disabled = true; explainText.textContent = '碧琪在按标准答案讲…';
        try {
          const res = await G().call('practice.explain', {setId: data.setId, itemId: it.itemId}, 260000);
          if (!box.isConnected) return;
          if (res?.text) { explain.remove(); row.before(el('p', 'pkq-fb__lecture', res.text)); return; }
          failed(res?.error);
        }
        catch (e) { failed(e.message || '讲解暂时没连上，请重试。'); }
      });
      row.append(next, explain); box.append(row);
      qCol.append(box); next.focus({preventScroll: true});
      box.scrollIntoView({block: 'nearest', behavior: S.reduced() ? 'auto' : 'smooth'});
    }
    const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    function countTo(node, to, {ms = 700, after = null} = {}) {
      const paint = v => { node.textContent = String(v); if (after) node.append(after); };
      if (S.reduced() || !(to > 0)) { paint(to); return; }
      const start = performance.now(); let lastTick = -1;
      const step = () => { if (!node.isConnected) return; const k = Math.min(1, (performance.now() - start) / ms); paint(Math.round(to * (1 - (1 - k) ** 3))); const tick = Math.floor(k * 8); if (tick !== lastTick) { lastTick = tick; S.sfx('tally', {n: tick}); } if (k < 1) requestAnimationFrame(step); };
      step();
    }
    async function finish() {
      if (!alive) return;
      finished = true;
      try { audio?.pause(); } catch { /* 无 */ }
      shownMaterial = undefined; body.classList.remove('is-split'); body.replaceChildren(); qCol = el('section', 'pkq-card'); body.append(qCol);
      qCol.append(el('p', 'pkq-wait', '结算中…'));
      let r;
      try { r = await G().call('practice.finish', {setId: data.setId}); }
      catch (e) { qCol.replaceChildren(el('p', 'pkq-wait', e.message || '结算失败，再点一次')); const retry = S.ghostButton('再结算一次'); retry.addEventListener('click', finish); qCol.append(retry); return; }
      if (!alive) return;
      const scored = r.scored || 0, acc = scored ? r.correct / scored : 0;
      const rank = scored && r.correct === scored ? 'S' : acc >= .8 ? 'A' : acc >= .6 ? 'B' : 'C';
      const TITLE = {S: '一题不错', A: '打得漂亮', B: '稳稳过关', C: '这组有点硬'};
      const got = (r.awards || []).filter(a => a.kind === 'stars').reduce((n, a) => n + (Number(a.amount) || 0), 0); stars += got;
      stage.setEnemy(null); stage.victory(rank !== 'C'); stage.setProgress(items.map(it => (answered[it.itemId]?.correct ? 'right' : 'wrong')), items.length);
      const card = el('div', 'pkq-result'); card.dataset.rank = rank; card.dataset.passed = String(acc >= .6);
      const badge = S.rankBadge(rank);
      const main = el('div', 'pkq-result__main');
      main.append(el('small', '', rank === 'S' ? 'PERFECT CLEAR' : 'STAGE CLEAR'), el('h3', '', TITLE[rank]));
      const stats = el('div', 'pkq-stats');
      const stat = (label, tone) => { const s = el('div', 'pkq-stat'); if (tone) s.dataset.tone = tone; const b = el('b', '', '0'); s.append(el('small', '', label), b); stats.append(s); return b; };
      const sRight = stat('答对'), sCombo = stat('最高连击'), sTime = stat('用时'), sStar = stat('星星', 'gold');
      main.append(stats);
      const foes = el('div', 'pkq-foes');
      for (const w of waves) { const down = waveRight(w) === w.size; const c = el('span', 'pkq-foechip'); c.dataset.s = down ? 'down' : 'fled'; const src = g.art(`monster/${w.species}`); if (src) { const im = el('img'); im.alt = ''; im.src = src; c.append(im); } c.append(document.createTextNode(w.speciesName), el('em', '', down ? '击破' : '溜了')); foes.append(c); }
      main.append(foes);
      main.append(el('p', 'pkq-result__line', scored > r.correct ? '溜走的怪带着你的错题，过几天会回来；也能在「错题重刷」里再做原题。' : r.maxCombo >= 5 ? `全程没断，最高连击 ${r.maxCombo}。` : '题库里还有很多，换个考点试试。'));
      const act = el('div', 'pkq-result__act');
      const home = backTo();
      const again = S.actionButton('再来一组', {hint: 'Enter'}); again.classList.add('pkq-again');
      again.addEventListener('click', async () => { if (again.dataset.busy) return; again.dataset.busy = '1'; S.sfx('ui-go'); try { const pane = desk()?.pane?.(); const params = pane?.state?.practiceParams || {mode: 'random'}; const nx = await G().call('practice.start', {...params, requestId: rid()}, 60000); if (nx?.empty || !nx?.setId) { G().toast(nx?.why || '这一类题现在没有可做的'); delete again.dataset.busy; return; } pane.state.practiceSet = nx; mountAgain(); } catch (e) { delete again.dataset.busy; G().toast(e.message || '没打开'); } });
      const out = S.ghostButton(backName(home)); out.addEventListener('click', leaveNow);
      act.append(again, out);
      if (home !== 'gamepractice') { const lib = S.ghostButton('回题库'); lib.addEventListener('click', () => desk()?.go('gamepractice')); act.append(lib); }
      card.append(badge, main, act);
      // 错题回顾：这组没答对的题和官方答案，一眼扫完（细看去「错题重刷」）
      const missed = items.map((it, k) => ({it, k, r: answered[it.itemId]})).filter(x => x.r && !x.r.correct && x.r.key);
      if (missed.length) {
        const rev = el('div', 'pkq-review'); rev.append(el('small', '', `REVIEW · 这组错了 ${missed.length} 道`));
        missed.slice(0, 6).forEach((x, n) => { const row = el('div', 'pkq-review__row'); row.style.animationDelay = `${.3 + n * .06}s`; row.append(el('i', '', String(x.k + 1).padStart(2, '0')), el('span', '', (x.it.prompt || QKIND[x.it.qkind] || '').replace(/_{3,}/g, '____')), el('b', '', x.r.key)); row.title = x.it.prompt || ''; rev.append(row); });
        card.append(rev);
      }
      qCol.replaceChildren(card); again.focus({preventScroll: true});
      setTimeout(() => S.sfx('rank', {rank}), S.reduced() ? 0 : 260);
      // 装了结算动画就在结算卡上演一遍（烟花 / 彩带 / 印章雨 / 立体书）
      setTimeout(() => { if (alive && card.isConnected) window.__pinkieLoadout?.result(card, {rank}); }, S.reduced() ? 0 : 420);
      countTo(sRight, r.correct, {after: el('em', '', `/ ${scored}`)}); countTo(sCombo, Math.max(r.maxCombo || 0, maxCombo)); sTime.textContent = mmss(Date.now() - t0); countTo(sStar, stars, {ms: 900});
      if (got) stage.addGain(got);
      if (r.awards?.length) setTimeout(() => G().play(r.awards, {from: badge}), 500); else G().pending?.();
    }
    // 「再来一组」：同一页重新挂（返回目标不变）
    function mountAgain() { alive = false; try { audio?.pause(); } catch { /* 无 */ } stage.destroy(); host.replaceChildren(); host.classList.remove('pkq', 'pkp-set'); const rt = mountSet(host, ctx); host.__pkpRuntime = rt; }

    show();
    return {
      unmount() { alive = false; stage.destroy(); try { audio?.pause(); } catch { /* 无 */ } },
      keydown(event) {
        if (host.__pkpRuntime) return host.__pkpRuntime.keydown(event);
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Escape') { event.preventDefault(); askLeave(); return; }
        if (host.querySelector('dialog[open]')) return;
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const key = String(event.key || '').toLowerCase();
        const choices = [...(qCol?.querySelectorAll('.pkq-opt:not(:disabled)') || [])];
        if (choices.length && !qCol.querySelector('.pkq-fb')) {
          const byKey = choices.findIndex(c => c.dataset.key?.toLowerCase() === key);
          const idx = /^[1-9]$/.test(key) ? Number(key) - 1 : byKey;
          if (idx >= 0 && idx < choices.length) { event.preventDefault(); choices[idx].click(); return; }
        }
        if (event.key === 'Enter') {
          if (event.target?.closest?.('.pkq-act')) return;
          const next = qCol?.querySelector('.pkq-fb .pkq-next, .pkq-result .pkq-again');
          const fire = qCol?.querySelector('.pkq-fire[aria-disabled="false"]');
          if (next || fire) { event.preventDefault(); (next || fire).click(); }
        }
      },
    };
  }

  // 术语配对的候选：「A — xxx」一行一个
  function letterChoices(material) {
    const out = [];
    for (const line of String(material).split(/\n+/)) {
      const m = /^\s*([A-Z])\s*[—\-–:：.)）]\s*(.+)$/.exec(line);
      if (m && !out.some(x => x.letter === m[1])) out.push({letter: m[1], text: m[2].trim()});
    }
    return out;
  }
  function recordBar(audio) {
    const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const bar = el('div', 'pke-record pkp-record');
    const b = btn('pke-play');
    const meta = el('div', 'pke-record__meta'); meta.append(el('small', 'pkg-kicker', 'ORIGINAL AUDIO'), el('b', '', '原录音'));
    const track = el('div', 'pke-record__track'); track.tabIndex = 0; track.setAttribute('role', 'slider'); track.setAttribute('aria-label', '录音进度');
    const fill = el('i', 'pke-record__fill'); track.append(el('i', 'pke-record__rail'), fill);
    const time = el('span', 'pke-record__time pkg-num', '00:00 / --:--');
    const icon = () => { b.innerHTML = audio.paused ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>'; b.setAttribute('aria-label', audio.paused ? '播放原录音' : '暂停'); };
    const paint = () => { const d = audio.duration; fill.style.transform = `scaleX(${Number.isFinite(d) && d > 0 ? audio.currentTime / d : 0})`; time.textContent = `${mmss(audio.currentTime * 1000)} / ${Number.isFinite(d) ? mmss(d * 1000) : '--:--'}`; bar.dataset.on = audio.paused ? '' : '1'; icon(); };
    b.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => { time.textContent = '录音放不了，请检查声音输出'; }); else audio.pause(); });
    const seek = x => { const r = track.getBoundingClientRect(); if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * audio.duration; };
    track.addEventListener('pointerdown', e => { seek(e.clientX); track.setPointerCapture?.(e.pointerId); });
    track.addEventListener('pointermove', e => { if (e.buttons) seek(e.clientX); });
    track.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5)); } });
    for (const ev of ['timeupdate', 'play', 'pause', 'loadedmetadata', 'ended']) audio.addEventListener(ev, () => { if (bar.isConnected) paint(); });
    audio.addEventListener('error', () => { if (bar.isConnected) { time.textContent = '录音没加载上（重开这一组会重新取）'; bar.dataset.err = '1'; } });
    icon(); bar.append(b, meta, track, time);
    return bar;
  }

  // 营地 / 地图用：直接开某个考点的一组（讲完课的下一站）
  async function startPoint(point, {nodeId = '', from} = {}) {
    if (from) from.disabled = true;
    try { return await openSet({mode: 'point', point, count: 8, nodeId}); }
    catch (e) { G()?.toast(e.message || '没打开'); return null; }
    finally { if (from) from.disabled = false; }
  }

  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('gamepractice', {title: '刷题', wide: true, mount: (h, c) => mountHome(h, c)});
    d.registerView('gamepracset', {title: '刷题', wide: true, mount: (h, c) => mountSet(h, c), keydown: (e, ctx) => ctx.pane?.runtime?.keydown?.(e)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 20000); }

  window.__pinkieGamePractice = {openSet, startPoint, letterChoices};
})();
