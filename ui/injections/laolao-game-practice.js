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
    const r = await g.call('practice.start', {...params, requestId: rid()}, 60000);
    if (r?.empty || !r?.setId) { g.toast(r?.why || '这一类题现在没有可做的'); return null; }
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
    pts.append(seg, list); paint();

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

  // ───────────── 作答页 ─────────────
  function mountSet(host, ctx) {
    const g = G();
    const local = ctx.local?.() || {};
    const data = local.practiceSet;
    host.classList.add('pkb-guard', 'pkp-set');
    const top = el('header', 'pk-drill-top pkb-top pkb-guard__top');
    const back = btn('pkb-x', '×');
    const title = el('div', 'pkb-guard__title'); title.append(el('small', 'pkb-kicker', 'DRILL · 真题'), el('b', '', data?.title || '刷题'));
    const count = el('span', 'pk-drill-count pkb-guard__count pkb-num', '');
    top.append(back, title, count); host.append(top);
    const backTo = () => { const v = local.returnView; return v && v !== 'gamepracset' ? v : 'gamepractice'; };
    const leaveNow = () => (ctx.go ? ctx.go(backTo()) : desk()?.go(backTo()));
    back.setAttribute('aria-label', `退出刷题，${backName(backTo())}`); back.title = back.getAttribute('aria-label');
    if (!data?.items?.length) {
      const p = el('div', 'pkb-result'); p.append(el('h3', '', '这组题不在了'), el('p', 'pkb-result__line', '回题库再开一组。'));
      const b = btn('pkg-btn', backName(backTo())); b.addEventListener('click', leaveNow); p.append(b);
      host.append(p); back.addEventListener('click', leaveNow); return {};
    }
    const items = data.items;
    const answered = {...(data.answered || {})};
    let i = items.findIndex(it => !answered[it.itemId]); if (i < 0) i = items.length;
    let right = Object.values(answered).filter(r => r.correct).length, combo = 0, busy = false, alive = true, finished = Boolean(data.finished), asking = false;
    const a = window.__pinkieGameBattle?.arena({form: g.equippedForm(), strip: true});
    if (a) {
      top.append(a.root);
      a.setEnemy({kind: 'target', name: data.mode === 'listening' ? '纸靶 · 听力' : '纸靶 · 真题', level: 1, note: data.title});
      a.setHp(1 - right / items.length, {instant: true}); a.setCombo(0);
    }
    // 听力：整套原录音一个播放条
    let audio = null;
    if (data.audio?.url) { audio = new Audio(data.audio.url); audio.preload = 'metadata'; host.append(recordBar(audio)); }
    else if (data.mode === 'listening') host.append(el('p', 'pkp-warn', '本机没有这套的原录音，只能看题。'));
    const stage = el('div', 'pk-drill-stage pkp-stage'); host.append(stage);
    const live = el('div', 'pk-sr'); live.setAttribute('aria-live', 'polite'); host.append(live);
    const paintCount = () => { count.textContent = `${Math.min(i + 1, items.length)} / ${items.length}`; };

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
    let shownMaterial = null, matPane = null, qCol = null;
    function layout(it) {
      // 术语配对的候选已经是右边的按钮，不再左边重复列一遍
      const key = it.qkind === 'term-match' ? null : it.material && !it.qkind.startsWith('listen') ? it.material : (it.qkind === 'listen-dictation' ? it.material : null);
      if (key === shownMaterial && qCol) return;
      shownMaterial = key; stage.replaceChildren();
      if (key) {
        const wrap = el('div', 'pkp-split'); matPane = el('article', 'pkp-material');
        matPane.append(el('small', 'pkg-kicker', it.qkind === 'term-match' ? 'CANDIDATES · 候选' : it.qkind === 'listen-dictation' ? 'PASSAGE · 听写原文' : 'PASSAGE · 原文'));
        const text = el('div', 'pkp-material__text'); text.textContent = data.materials?.[key] || ''; matPane.append(text);
        qCol = el('section', 'pk-drill-col pkp-qcol'); wrap.append(matPane, qCol); stage.append(wrap);
      } else { matPane = null; qCol = el('section', 'pk-drill-col pkb-guard__q'); stage.append(qCol); }
    }
    function show() {
      paintCount();
      const it = items[i];
      if (!it) { finish(); return; }
      layout(it);
      qCol.replaceChildren(); busy = false;
      const q = el('div', 'pk-drill-q');
      const meta = [`第 ${i + 1} 题`, QKIND[it.qkind] || '真题', it.point && it.point !== '未分类' ? `考点 · ${it.point}` : '', it.difficulty ? `难度 ${it.difficulty}` : ''].filter(Boolean).join(' · ');
      q.append(el('p', 'pk-drill-kicker', meta));
      const prompt = it.qkind === 'listen-response' ? '听问句，选最佳应答' : it.qkind === 'listen-dialogue' ? '听对话，回答问题' : it.qkind === 'listen-conversation' ? '听长对话 / 短文，回答问题' : (it.prompt || '');
      const stem = el('h3', 'pk-drill-stem', prompt); if (prompt.length > 90 || BIG_KINDS.has(it.qkind)) stem.classList.add('is-long');
      if (it.base) stem.append(el('span', 'pkp-base', ` （${it.base}）`));
      q.append(stem);
      q.append(el('small', 'pkp-source', `${it.paper}${it.no ? ' · 原卷第 ' + it.no + ' 题' : ''}`));
      if (it.options) {
        const list = el('div', 'pk-drill-options pkb-guard__opts');
        it.options.forEach((o, k) => { const b = btn('pk-choice pkb-opt'); b.append(el('kbd', '', 'ABCD'[k] || String(k + 1)), el('span', '', o)); b.addEventListener('click', () => submit(k, b)); list.append(b); });
        q.append(list);
        q.append(barOf(`点选即作答 · 1–${it.options.length} 或 A–${'ABCD'[it.options.length - 1]}`));
      } else if (it.qkind === 'term-match') {
        const letters = letterChoices(data.materials?.[it.material] || '');
        const list = el('div', 'pkp-letters');
        for (const L of letters) { const b = btn('pk-choice pkp-letter'); b.append(el('kbd', '', L.letter), el('span', '', L.text)); b.addEventListener('click', () => submit(L.letter, b)); list.append(b); }
        q.append(list, barOf('点选左侧候选里对应的那一项'));
      } else if (BIG_KINDS.has(it.qkind)) {
        const ta = el('textarea', 'pkp-essay'); ta.rows = it.qkind === 'writing' ? 12 : 8; ta.placeholder = it.qkind === 'writing' ? '在这里写作文（80–100 词）。写完点「交给碧琪阅卷」。' : '在这里写中文译文。';
        ta.setAttribute('aria-label', '你的作答');
        const draftKey = `pkp-draft:${data.setId}:${it.itemId}`;
        try { ta.value = sessionStorage.getItem(draftKey) || ''; } catch { /* 无 */ }
        ta.addEventListener('input', () => { try { sessionStorage.setItem(draftKey, ta.value); } catch { /* 无 */ } });
        const sub = btn('pkg-btn', '交给碧琪阅卷'); sub.addEventListener('click', () => submit(ta.value, sub, {essay: true}));
        const row = el('div', 'pkp-row'); row.append(sub, el('small', '', it.qkind === 'writing' ? '按考场五档细则判分，约半分钟' : '按准确 8 + 通顺 4 判分'));
        q.append(ta, row);
      } else {
        const form = el('form', 'pkp-fill'); const input = el('input', 'pkp-input'); input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = it.qkind === 'word-form' ? '填词的正确形式' : '填答案（1–3 个词）';
        input.setAttribute('aria-label', '你的答案');
        const sub = btn('pkg-btn', '提交'); sub.type = 'submit';
        form.append(input, sub);
        form.addEventListener('submit', e => { e.preventDefault(); if (!input.value.trim()) { input.focus(); return; } submit(input.value, sub); });
        q.append(form, barOf('回车提交 · 不分大小写'));
        setTimeout(() => input.focus(), 40);
      }
      qCol.append(q);
      if (matPane) matPane.scrollTop = matPane.scrollTop; // 不跳
      qCol.scrollTop = 0;
    }
    function barOf(text) { const bar = el('footer', 'pk-drill-bar'); bar.append(el('span', 'pk-drill-keys', text)); return bar; }

    async function submit(answer, b, {essay = false} = {}) {
      if (busy || !alive) return; busy = true;
      const it = items[i];
      const controls = [...qCol.querySelectorAll('button, input, textarea')]; controls.forEach(x => { x.disabled = true; });
      b?.classList.add('is-lock');
      const wait = essay ? el('p', 'pkp-wait', '碧琪在按考场细则阅卷…') : null; if (wait) qCol.querySelector('.pk-drill-q')?.append(wait);
      let r;
      try { r = await G().call('practice.answer', {setId: data.setId, itemId: it.itemId, answer}, essay ? 90000 : 20000); }
      catch (e) { controls.forEach(x => { x.disabled = false; }); b?.classList.remove('is-lock'); wait?.remove(); busy = false; live.textContent = e.message || '没记上，再交一次'; G().toast(e.message || '没记上，再交一次'); return; }
      if (!alive) return;
      wait?.remove(); b?.classList.remove('is-lock');
      answered[it.itemId] = r;
      if (it.options) { const opts = qCol.querySelectorAll('.pkb-opt'); opts[r.answer]?.classList.add('is-answer'); if (!r.correct) b?.classList.add('is-wrong'); }
      if (it.qkind === 'term-match') { qCol.querySelectorAll('.pkp-letter').forEach(x => { if (x.querySelector('kbd')?.textContent === r.key) x.classList.add('is-answer'); }); if (!r.correct) b?.classList.add('is-wrong'); }
      if (r.correct) { right++; a?.strike({crit: r.combo > 0 && r.combo % 5 === 0, damage: 96 + (r.combo || 1) * 6}); } else a?.dodge();
      combo = r.combo || 0; a?.setCombo(combo); a?.setHp(1 - right / items.length);
      if (r.correct && combo > 0 && a && combo % a.threshold === 0) a.ult(combo);
      if (r.awards?.length) G().play(r.awards, {from: a?.foe || b});
      qCol.querySelector('.pk-drill-bar')?.remove();
      feedback(it, r);
      live.textContent = r.correct ? '答对了' : '没答对';
    }
    function feedback(it, r) {
      const box = el('div', 'pkp-fb'); box.dataset.kind = r.correct ? 'right' : 'wrong';
      const headline = r.grade ? `${r.grade.score} / ${r.grade.max} 分` : r.correct ? '答对了' : '没答对';
      const h = el('div', 'pkp-fb__head'); h.append(el('small', 'pkg-kicker', r.correct ? 'HIT' : 'MISS'), el('b', '', headline));
      box.append(h);
      if (r.grade?.reason) box.append(el('p', 'pkp-fb__line', r.grade.reason));
      if (!r.grade) { const k = el('p', 'pkp-fb__key'); k.append(el('small', '', '官方答案'), el('b', '', r.key || '')); box.append(k); }
      if (r.why) { const w = el('p', 'pkp-fb__why'); w.append(el('small', '', '官方解析'), document.createTextNode(r.why)); box.append(w); }
      if (r.script) { const s = el('p', 'pkp-fb__why'); s.append(el('small', '', '录音原文'), document.createTextNode(r.script)); box.append(s); }
      if (r.grade?.reference) { const ref = el('details', 'pkp-fb__ref'); ref.append(el('summary', '', '看官方参考答案'), el('p', '', r.grade.reference)); box.append(ref); }
      if (r.monster) box.append(el('p', 'pkp-fb__mon', `这题变成了错题怪「${r.monster.name}」，过几天回来，讨伐时出变体题。`));
      const row = el('div', 'pkp-row');
      const next = btn('pk-btn', i + 1 < items.length ? '下一题' : '结算'); next.dataset.kind = 'go'; next.addEventListener('click', () => { i++; show(); });
      const explain = btn('pkb-link', '讲给我听');
      explain.addEventListener('click', async () => {
        explain.disabled = true; explain.textContent = '碧琪在按标准答案讲…';
        try { const res = await G().call('practice.explain', {setId: data.setId, itemId: it.itemId}, 45000); if (!box.isConnected) return; const p = el('p', 'pkp-fb__lecture', res?.text || '碧琪这会儿讲不了（内置模型不在线），先看官方解析。'); explain.replaceWith(p); }
        catch (e) { explain.disabled = false; explain.textContent = '讲给我听'; G().toast(e.message || '没讲出来'); }
      });
      row.append(next, explain); box.append(row);
      qCol.append(box); next.focus({preventScroll: true});
      box.scrollIntoView({block: 'nearest', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
    }
    async function finish() {
      if (!alive) return;
      finished = true;
      try { audio?.pause(); } catch { /* 无 */ }
      stage.replaceChildren(); const col = el('section', 'pk-drill-col pkb-guard__q'); stage.append(col); qCol = col; shownMaterial = undefined;
      col.append(el('p', 'pkb-empty', '结算中…'));
      let r;
      try { r = await G().call('practice.finish', {setId: data.setId}); } catch (e) { col.replaceChildren(el('p', 'pkb-empty', e.message || '结算失败，再点一次')); return; }
      if (!alive) return;
      const perfect = r.scored > 0 && r.correct === r.scored;
      if (r.correct >= (r.total || items.length)) a?.defeat();
      const card = el('div', 'pkb-result'); card.dataset.passed = String(r.scored ? r.correct / r.scored >= .6 : false);
      card.append(el('small', 'pkb-kicker', perfect ? 'PERFECT' : 'RESULT'), el('h3', '', perfect ? '一题不错' : '这组做完了'), el('p', 'pkb-result__score', ''));
      card.querySelector('.pkb-result__score').append(el('b', 'pkb-num', String(r.correct)), document.createTextNode(` / ${r.scored} 题对`));
      card.append(el('p', 'pkb-result__line', r.scored > r.correct ? '错的题记成了错题怪，也能在「错题重刷」里再做原题。' : r.maxCombo >= 5 ? `最高连击 ${r.maxCombo}。` : '题库里还有很多，换个考点试试。'));
      const act = el('div', 'pkb-result__act');
      const home = backTo();
      const again = btn('pkg-btn', '再来一组'); again.addEventListener('click', async () => { again.disabled = true; try { const pane = desk()?.pane?.(); const params = pane?.state?.practiceParams || {mode: 'random'}; const nx = await G().call('practice.start', {...params, requestId: rid()}, 60000); if (nx?.empty || !nx?.setId) { G().toast(nx?.why || '这一类题现在没有可做的'); again.disabled = false; return; } pane.state.practiceSet = nx; mountAgain(); } catch (e) { again.disabled = false; G().toast(e.message || '没打开'); } });
      const out = btn('pkb-link', backName(home)); out.addEventListener('click', leaveNow);
      act.append(again, out);
      if (home !== 'gamepractice') { const lib = btn('pkb-link', '回题库'); lib.addEventListener('click', () => desk()?.go('gamepractice')); act.append(lib); }
      card.append(act); col.replaceChildren(card); again.focus({preventScroll: true});
      if (r.awards?.length) setTimeout(() => G().play(r.awards, {from: a?.foe || card}), 400); else G().pending?.();
    }
    // 「再来一组」：同一页重新挂（返回目标不变）
    function mountAgain() { alive = false; try { audio?.pause(); } catch { /* 无 */ } host.replaceChildren(); host.className = host.className.replace(/\bpk[pb]-[\w-]+/g, '').trim(); const rt = mountSet(host, ctx); host.__pkpRuntime = rt; }

    show();
    return {
      unmount() { alive = false; try { audio?.pause(); } catch { /* 无 */ } },
      keydown(event) {
        if (host.__pkpRuntime) return host.__pkpRuntime.keydown(event);
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Escape') { event.preventDefault(); askLeave(); return; }
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const key = String(event.key || '').toLowerCase();
        const n = /^[1-4]$/.test(key) ? Number(key) : 'abcd'.indexOf(key) + 1;
        if (n >= 1 && n <= 4 && qCol?.querySelector('.pkb-opt:not(:disabled)')) { event.preventDefault(); qCol.querySelectorAll('.pkb-opt')[n - 1]?.click(); }
        if (event.key === 'Enter' && !event.target?.closest?.('button')) qCol?.querySelector('.pkp-fb .pk-btn')?.click();
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
