/* laolao-metre-ship.js —— T3 #22（L34）Metre 引擎台右侧「改动」面板的「提交 / 开 PR」。只在 Metre 里起作用。
 * 面板（laolao-metre-engine.js 画的 .pk-eng-drawer）已到行数例外上限，所以另起这个文件，不改它：在面板最底下接一条 .pk-ship。
 *   - 只给按钮：引擎自己不提交、不开 PR。「提交…」「开 PR…」点了先在面板里展开一个确认框（写着要提交几个文件、到哪个分支，
 *     开 PR 写着会推送哪个分支、不强推、不合并），再点「确认提交」/「确认开 PR」才调网关；「取消」什么都不做。
 *   - 确认时把 pinkie.engines.ship.status 给的 token 原样带回；看完以后改动、分支或头变了，后端拒绝（pr-flow.mjs 的 EngineShip）。
 *   - 不能点的按钮灰着，下面一行写为什么（引擎还在做、没有改动、在 main 上、没有远端、gh 没登录、已经有 PR…）。
 * 发现面板：window.Pinkie.domWatch.watch（共用观察器，不新增观察器、定时器）。只在面板打开、换会话、面板里的文件数变了、
 * 点「刷新」、每次操作完时读一次状态。对外只挂 window.Pinkie.metre.ship，给单测用。样式在 laolao-metre-ship.css（.pk-ship*）。 */
(() => {
  'use strict';
  const pinkie = (window.Pinkie = window.Pinkie || {});
  const ns = (pinkie.metre = pinkie.metre || {});
  if (ns.ship) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const sessionKey = () => {
    try { const key = new URL(window.location.href).searchParams.get('session') || ''; return /^agent:metre:/.test(key) ? key : ''; }
    catch { return ''; }
  };
  const rpc = (method, params, timeout) => (typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, timeout) : Promise.reject(new Error('还没连上碧琪')));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (label, run, cls) => {
    const b = el('button', cls || 'pk-ship__btn', label);
    b.type = 'button';
    b.addEventListener('click', (event) => { event?.preventDefault?.(); event?.stopPropagation?.(); if (!b.disabled) run(); });
    return b;
  };
  const short = (sha) => String(sha || '').slice(0, 8);
  const errText = (error) => String(error?.message || error || '没成功').slice(0, 300);
  const LOOKING = '正在看 git…';
  const bars = new WeakMap(); // 面板 → 这一条的状态

  function fresh() {
    const bar = el('div', 'pk-ship');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '提交和开 PR');
    return {bar, key: '', sig: null, open: false, data: null, error: '', busy: '', loading: false, ask: '', message: '', title: '', body: '', draft: true, result: '', link: ''};
  }

  function decorate(drawer) {
    if (!drawer) return;
    let s = bars.get(drawer);
    const key = isMetre() ? sessionKey() : '';
    if (!key) { if (s) { s.bar.remove(); bars.delete(drawer); } return; }
    if (!s) { s = fresh(); bars.set(drawer, s); }
    if (s.bar.parentElement !== drawer) drawer.append(s.bar);
    if (drawer.hidden) { s.open = false; return; }
    const sig = drawer.querySelector('.pk-eng-drawer__sum')?.textContent ?? '';
    if (s.open && s.key === key && s.sig === sig) return;
    if (s.key !== key) Object.assign(s, {ask: '', message: '', title: '', body: '', draft: true, result: '', link: '', data: null, error: ''});
    Object.assign(s, {open: true, key, sig});
    void load(s);
  }

  async function load(s) {
    if (s.loading) return;
    s.loading = true;
    if (!s.data && !s.busy) s.busy = LOOKING;
    render(s);
    try { s.data = await rpc('pinkie.engines.ship.status', {sessionKey: s.key}, 60000); s.error = ''; }
    catch (error) { s.data = null; s.error = errText(error); }
    finally { s.loading = false; if (s.busy === LOOKING) s.busy = ''; }
    render(s);
  }

  async function commit(s) {
    const token = s.data?.commitToken, message = s.message.trim();
    if (!token || !message) return;
    Object.assign(s, {ask: '', busy: '正在提交…', result: '', link: ''});
    render(s);
    try {
      const r = await rpc('pinkie.engines.ship.commit', {sessionKey: s.key, message, confirm: token}, 120000);
      s.result = `已提交 ${short(r?.head)}（${Number(r?.files) || 0} 个文件）。`;
      s.message = '';
    } catch (error) { s.result = '没提交：' + errText(error); }
    s.busy = '';
    await load(s);
  }

  async function openPr(s) {
    const token = s.data?.prToken, title = s.title.trim();
    if (!token || !title) return;
    Object.assign(s, {ask: '', busy: '正在推送并开 PR…', result: '', link: ''});
    render(s);
    try {
      const r = await rpc('pinkie.engines.ship.openPr', {sessionKey: s.key, title, body: s.body, draft: s.draft, confirm: token}, 180000);
      s.result = r?.draft === false ? '已开 PR：' : '已开草稿 PR：';
      s.link = /^https:\/\//.test(String(r?.url || '')) ? String(r.url) : '';
      if (!s.link) s.result += String(r?.url || '');
      s.title = ''; s.body = '';
    } catch (error) { s.result = '没开成：' + errText(error); }
    s.busy = '';
    await load(s);
  }

  function fileList(files) {
    const list = el('ul', 'pk-ship__files');
    for (const f of files.slice(0, 8)) list.append(el('li', '', `${f.status} ${f.file}`));
    if (files.length > 8) list.append(el('li', 'pk-ship__more', `…还有 ${files.length - 8} 个`));
    return list;
  }

  function commitAsk(s, d) {
    const box = el('div', 'pk-ship__ask');
    box.append(el('p', 'pk-ship__q', `把这 ${d.files.length} 个文件提交到 ${d.branch || '当前分支'}？（git add -A 再 git commit，不推送）`), fileList(d.files));
    const msg = el('textarea', 'pk-ship__input');
    msg.rows = 2; msg.value = s.message; msg.placeholder = '提交说明（必填）';
    msg.setAttribute('aria-label', '提交说明');
    const ok = btn('确认提交', () => void commit(s), 'pk-ship__btn pk-ship__btn--main');
    ok.disabled = !s.message.trim();
    msg.addEventListener('input', () => { s.message = msg.value; ok.disabled = !s.message.trim(); });
    const acts = el('div', 'pk-ship__acts');
    acts.append(ok, btn('取消', () => { s.ask = ''; render(s); }));
    box.append(msg, acts);
    return box;
  }

  function prAsk(s, d) {
    const box = el('div', 'pk-ship__ask');
    box.append(el('p', 'pk-ship__q', `把 ${d.branch} 推到 origin（普通推送，不强推），再开一个 PR？不会合并。`));
    const title = el('input', 'pk-ship__input');
    title.type = 'text'; title.value = s.title; title.placeholder = 'PR 标题（必填）';
    title.setAttribute('aria-label', 'PR 标题');
    const body = el('textarea', 'pk-ship__input');
    body.rows = 3; body.value = s.body; body.placeholder = '说明（可以不写）';
    body.setAttribute('aria-label', 'PR 说明');
    const draftRow = el('label', 'pk-ship__check');
    const draft = el('input');
    draft.type = 'checkbox'; draft.checked = s.draft;
    draft.addEventListener('change', () => { s.draft = draft.checked; });
    draftRow.append(draft, el('span', '', '开成草稿'));
    const ok = btn('确认开 PR', () => void openPr(s), 'pk-ship__btn pk-ship__btn--main');
    ok.disabled = !s.title.trim();
    title.addEventListener('input', () => { s.title = title.value; ok.disabled = !s.title.trim(); });
    body.addEventListener('input', () => { s.body = body.value; });
    const acts = el('div', 'pk-ship__acts');
    acts.append(ok, btn('取消', () => { s.ask = ''; render(s); }));
    box.append(title, body, draftRow, acts);
    return box;
  }

  function render(s) {
    const d = s.data, kids = [];
    const head = el('div', 'pk-ship__head');
    const where = d?.ready ? `${d.branch || '（没有分支）'} · ${d.files?.length ? d.files.length + ' 个文件没提交' : '都提交了'}` : '';
    head.append(el('span', 'pk-ship__title', 'Ship'), el('span', 'pk-ship__where', where), btn('刷新', () => void load(s), 'pk-ship__link'));
    kids.push(head);
    if (s.busy) kids.push(el('p', 'pk-ship__note', s.busy));
    else if (s.error) kids.push(el('p', 'pk-ship__note pk-ship__note--warn', '读不到 git 状态：' + s.error));
    else if (d && !d.ready) kids.push(el('p', 'pk-ship__note', d.why || '这里用不了。'));
    if (d?.ready && !s.busy) {
      if (s.ask === 'commit' && d.canCommit) kids.push(commitAsk(s, d));
      else if (s.ask === 'pr' && d.canPr) kids.push(prAsk(s, d));
      else {
        s.ask = '';
        const acts = el('div', 'pk-ship__acts');
        const c = btn('提交…', () => { Object.assign(s, {ask: 'commit', result: '', link: ''}); render(s); });
        c.disabled = !d.canCommit;
        const p = btn('开 PR…', () => { Object.assign(s, {ask: 'pr', result: '', link: ''}); render(s); });
        p.disabled = !d.canPr;
        acts.append(c, p);
        kids.push(acts);
        if (!d.canCommit && d.commitWhy) kids.push(el('p', 'pk-ship__note', '提交：' + d.commitWhy));
        if (!d.canPr && d.prWhy) kids.push(el('p', 'pk-ship__note', '开 PR：' + d.prWhy));
      }
    }
    if (s.result) {
      const done = el('p', 'pk-ship__done', s.result);
      if (s.link) { const a = el('a', '', s.link); a.href = s.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; done.append(a); }
      kids.push(done);
    }
    s.bar.replaceChildren(...kids);
  }

  ns.ship = {decorate, stateOf: (drawer) => bars.get(drawer) || null};
  const start = () => window.Pinkie?.domWatch?.watch?.('.pk-eng-drawer', (drawers) => drawers.forEach(decorate), {immediate: true});
  if (window.Pinkie?.domWatch?.watch) start();
  else document.addEventListener('DOMContentLoaded', start, {once: true});
})();
