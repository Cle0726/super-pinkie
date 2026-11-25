/* laolao-metre-pr.js —— 新功能第 5 项「PR 一条龙」的界面（后端 services/mode-architecture/pr-flow.mjs），只在 Metre。
 * 入口：工作台状态栏右边一颗「PR」（wb.extraStatus），点了在编辑区开一页「PR」（wb.openPage，和「AI 模型路由」同一套）。
 * 一页三段：审查（按严重程度排，点一条在工作台打开文件跳到行）、跟进（CI / 跟 base / 按选中意见改 / 回评论，勾了才做）、
 * 合并（CI 没绿 / 草稿 / 不是打开的 就灰着并说为什么；点了先在页里再确认一次，写着 PR 号和头，确认才调 pinkie.pr.merge）。
 * 用用户自己 gh 的登录，这里不碰令牌。不开定时器、不开观察器、不加 window.__ 全局名：只在开页、每次操作完、点「刷新」时取状态。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metrePr) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const SEV = {high: '高', medium: '中', low: '低'};
  const STEPS = [['ci', '看 CI'], ['main', '跟上 base 分支（只 merge，不变基）'], ['fix', '按选中的意见改（交给引擎，改完提交、不推送）'], ['reply', '回一条评论']];
  const GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  const s = {data: null, error: '', busy: '', number: 0, review: null, picked: new Set(), steps: new Set(['ci']), body: '', confirm: false, result: ''};

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (label, run, cls = '') => { const b = el('button', 'pk-mpr__btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', run); return b; };
  const wb = () => window.__pinkieWorkbench;
  const refresh = () => wb()?.refreshPage?.('pr');
  const short = (sha) => String(sha || '').slice(0, 8);

  // 合并为什么不能点：没有 PR / 不是打开的 / 草稿 / CI 没全绿。空字符串 = 能点。
  function mergeBlock(pr) {
    if (!pr) return '当前分支还没有 PR。';
    if (pr.state !== 'OPEN') return '这个 PR 不是打开的。';
    if (pr.isDraft) return '还是草稿，先改成可以审查。';
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    if (!checks.length) return 'CI 还没有结果。';
    if (!checks.every((c) => GREEN.has(String(c.conclusion || c.state || '').toUpperCase()))) return 'CI 还没全绿。';
    return '';
  }
  function ciLine(pr) {
    const checks = Array.isArray(pr?.statusCheckRollup) ? pr.statusCheckRollup : [];
    if (!checks.length) return 'CI：还没有结果';
    const ok = checks.filter((c) => GREEN.has(String(c.conclusion || c.state || '').toUpperCase())).length;
    return `CI：${ok} / ${checks.length} 通过`;
  }

  async function call(method, params, busy, timeout = 120000) {
    s.busy = busy; s.error = ''; refresh();
    try { return await wb().rpc(method, params, timeout); }
    catch (error) { s.error = String(error?.message || error); return null; }
    finally { s.busy = ''; }
  }
  async function load() {
    const data = await call('pinkie.pr.status', {}, '正在看这个仓库的 PR…', 60000);
    if (data) { s.data = data; if (!s.number || !(data.recent || []).some((p) => p.number === s.number)) s.number = data.current?.number || data.recent?.[0]?.number || 0; }
    refresh();
  }
  async function review() {
    const r = await call('pinkie.pr.review', {number: s.number}, `引擎在审 #${s.number}（只读，不改文件）…`, 16 * 60000);
    if (r) { s.review = r; s.picked = new Set(r.findings.map((_, i) => i).filter((i) => r.findings[i].severity === 'high')); }
    refresh();
  }
  async function followUp() {
    const steps = [...s.steps];
    const params = {number: s.number, steps};
    if (s.steps.has('fix')) params.findings = (s.review?.findings || []).filter((_, i) => s.picked.has(i));
    if (s.steps.has('reply')) { params.body = s.body; params.confirm = true; } // 勾了「回一条评论」再点「开始跟进」就是在界面上确认发
    const r = await call('pinkie.pr.followUp', params, '正在跟进…', 10 * 60000);
    if (r) {
      const bits = [];
      if (r.ci) bits.push(`CI ${r.ci.filter((c) => /pass|success/i.test(c.bucket || c.state)).length} / ${r.ci.length} 通过`);
      if (r.main) bits.push(r.main.merged ? '已跟上 base' : `跟 base 有冲突，已撤回：${r.main.conflicts.join('、')}`);
      if (r.fix) bits.push('已交给引擎改，进度在引擎台里看');
      if (r.reply) bits.push('评论已发');
      s.result = bits.join('；') || '做完了';
      if (r.reply) s.body = '';
    }
    await load();
  }
  async function merge(pr) {
    s.confirm = false;
    const r = await call('pinkie.pr.merge', {number: pr.number, confirm: `${pr.number}@${pr.headRefOid}`}, `正在合并 #${pr.number}…`, 120000);
    if (r?.merged) s.result = `#${r.number} 已合并（头 ${short(r.head)}）`;
    await load();
  }
  async function stop() { await call('pinkie.pr.stop', {}, '正在停…', 20000); refresh(); }

  function section(page, title) { const sec = el('section', 'pk-mpr__sec'); sec.append(el('h2', 'pk-mpr__h', title)); page.append(sec); return sec; }

  function render(box) {
    const page = el('div', 'pk-wb-page pk-mpr');
    page.append(el('h1', 'pk-wb-page__title', 'PR'));
    const bar = el('div', 'pk-mpr__bar');
    bar.append(btn('刷新', () => void load()));
    if (s.busy) bar.append(el('span', 'pk-mpr__busy', s.busy), btn('停下', () => void stop()));
    page.append(bar);
    if (s.error) page.append(el('p', 'pk-mpr__msg pk-mpr__msg--error', s.error));
    if (s.result) page.append(el('p', 'pk-mpr__msg', s.result));
    const d = s.data;
    if (!d) { page.append(el('p', 'pk-mpr__msg', s.busy ? '' : '还没取到状态，点「刷新」。')); box.append(page); return; }
    if (!d.ready) { page.append(el('p', 'pk-mpr__msg pk-mpr__why', d.why)); box.append(page); return; }

    const recent = d.recent || [];
    const pr = d.current && d.current.number === s.number ? d.current : null;
    const head = el('div', 'pk-mpr__head');
    if (recent.length) {
      const pick = el('select', 'pk-mpr__pick'); pick.setAttribute('aria-label', '选一个 PR');
      for (const p of recent) { const o = el('option', '', `#${p.number} ${p.title}${p.isDraft ? '（草稿）' : ''}`); o.value = String(p.number); o.selected = p.number === s.number; pick.append(o); }
      pick.addEventListener('change', () => { s.number = Number(pick.value); s.review = null; s.picked.clear(); s.confirm = false; refresh(); });
      head.append(pick);
    } else head.append(el('span', 'pk-mpr__msg', '这个仓库还没有打开的 PR。'));
    if (pr) head.append(el('span', 'pk-mpr__meta', `${pr.headRefName} → ${pr.baseRefName} · 头 ${short(pr.headRefOid)} · ${ciLine(pr)}`));
    page.append(head);
    if (!s.number) { box.append(page); return; }

    // 审查
    const rev = section(page, '审查');
    rev.append(btn(s.review ? '重新审查' : '让引擎审查', () => void review(), 'pk-mpr__btn--main'));
    const findings = s.review?.number === s.number ? s.review.findings : [];
    if (s.review?.number === s.number && !findings.length) rev.append(el('p', 'pk-mpr__msg', '引擎没提出问题。'));
    if (findings.length) {
      const list = el('ol', 'pk-mpr__findings');
      findings.forEach((f, i) => {
        const li = el('li', 'pk-mpr__finding pk-mpr__finding--' + f.severity);
        const box2 = el('input'); box2.type = 'checkbox'; box2.checked = s.picked.has(i); box2.setAttribute('aria-label', '改这一条');
        box2.addEventListener('change', () => { if (box2.checked) s.picked.add(i); else s.picked.delete(i); });
        const where = f.file ? btn(f.file + (f.line ? ':' + f.line : ''), () => void wb()?.open?.(f.file, f.line ? {line: f.line} : {}), 'pk-mpr__file') : el('span');
        const text = el('div', 'pk-mpr__ftext'); text.append(el('strong', '', f.title)); if (f.detail) text.append(el('p', '', f.detail));
        li.append(box2, el('span', 'pk-mpr__sev', SEV[f.severity] || f.severity), where, text);
        list.append(li);
      });
      rev.append(list);
    }

    // 跟进
    const fol = section(page, '跟进');
    for (const [id, label] of STEPS) {
      const row = el('label', 'pk-mpr__step'), c = el('input'); c.type = 'checkbox'; c.checked = s.steps.has(id);
      c.addEventListener('change', () => { if (c.checked) s.steps.add(id); else s.steps.delete(id); refresh(); });
      row.append(c, el('span', '', label));
      if (d.progress?.step === id) row.append(el('span', 'pk-mpr__phase pk-mpr__phase--' + d.progress.phase, `${{running: '在做', done: '做完了', failed: '没成', stopped: '已停', queued: '排着'}[d.progress.phase] || d.progress.phase}${d.progress.detail ? '：' + d.progress.detail : ''}`));
      fol.append(row);
    }
    if (s.steps.has('reply')) {
      const ta = el('textarea', 'pk-mpr__body'); ta.value = s.body; ta.placeholder = '评论正文'; ta.rows = 3;
      ta.addEventListener('input', () => { s.body = ta.value; });
      fol.append(ta);
    }
    fol.append(btn('开始跟进', () => void followUp(), 'pk-mpr__btn--main'));

    // 合并
    const mer = section(page, '合并');
    const why = mergeBlock(pr);
    if (why || !s.confirm) {
      const m = btn('合并', () => { s.confirm = true; refresh(); }, 'pk-mpr__btn--main'); m.disabled = Boolean(why);
      mer.append(m);
      if (why) mer.append(el('p', 'pk-mpr__msg pk-mpr__why', why));
    } else {
      const ask = el('div', 'pk-mpr__confirm');
      ask.append(el('p', '', `把 #${pr.number} 合并进 ${pr.baseRefName}？头 ${short(pr.headRefOid)}，用普通合并（不压缩、不变基）。`),
        btn('确认合并', () => void merge(pr), 'pk-mpr__btn--main'), btn('取消', () => { s.confirm = false; refresh(); }));
      mer.append(ask);
    }
    box.append(page);
  }

  async function open() {
    if (!isMetre() || !wb()?.openPage) return;
    await wb().openPage('pr', 'PR', 'git-pull-request', render);
    await load();
  }

  // 状态栏入口：只在 Metre。工作台每次重画状态栏都会调这个函数。
  function statusItem() {
    if (!isMetre()) return null;
    const b = el('button', 'pk-wb-status__item pk-mpr__status'); b.type = 'button'; b.title = 'PR：审查、跟进、合并';
    const i = el('i', 'codicon codicon-git-pull-request'); i.setAttribute('aria-hidden', 'true');
    b.append(i, el('span', '', s.data?.current ? `PR #${s.data.current.number}` : 'PR'));
    b.addEventListener('click', (e) => { e.stopPropagation(); void open(); });
    return b;
  }
  function attach() { const w = wb(); if (w?.extraStatus && !w.extraStatus.has('pr')) { w.extraStatus.set('pr', statusItem); w.renderStatus?.(); } }
  ns.metrePr = {open, mergeBlock, render, state: s};
  attach();
  if (!wb()?.extraStatus) document.addEventListener('DOMContentLoaded', attach, {once: true});
})();
