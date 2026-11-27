/* laolao-metre-tasks.js —— T3 #24「后台任务列表」（L36），只在 Metre。
 * 入口：工作台标签栏右边一颗图标键（wb.tabActions），点了在编辑区开一页「后台任务」（wb.openPage，和「PR」页同一套）。
 * 数据：后端已有的只读接口 pinkie.work.status（services/mode-architecture/work-status.mjs），页面不自己猜：
 *   这个会话放到后台的命令（background-jobs.mjs）、独立解答与批评（reasoning jobs）、子任务（tier children）。
 *   输入框上方「后台工作」小胶囊读的也是这一份；这一页把它摊开成一张完整的表。
 *   「看结果」走 pinkie.work.detail（只有协作和子任务有结果可读；后台命令的输出在 process 工具里，这里不读）。
 * 一页：在跑的排前面，再是失败、做完；每行写是什么、在做什么、用时。没有就写「这个会话现在没有后台任务」。
 * 不开定时器、不开观察器、不加 window.__ 全局名：只在开页、点「刷新」时取；换会话就把旧的那份丢掉。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreTasks) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const KIND = {bg: '后台命令', job: '协作', child: '子任务'};
  const STATE = {running: '在跑', failed: '失败', done: '做完了'};
  const RANK = {running: 0, failed: 1, done: 2};
  const s = {data: null, error: '', busy: false, at: 0, open: '', detail: '', detailBusy: false};

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (label, run, cls = '') => { const b = el('button', 'pk-mtask__btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', run); return b; };
  const wb = () => window.__pinkieWorkbench;
  const refresh = () => wb()?.refreshPage?.('tasks');
  const clock = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const model = (ref) => String(ref || '').split('/').pop();
  const norm = (state) => {
    const t = String(state || '').toLowerCase();
    if (/fail|error|abort|cancel/.test(t)) return 'failed';
    return /^(running|queued|pending|armed|answering|reviewing|fixing)$/.test(t) ? 'running' : 'done';
  };

  // 后端那一份 → 一张表的行（纯函数）。在跑的排前面，同一档里新开始的在上面。
  function rows(status) {
    const out = [];
    for (const b of status?.background || []) {
      out.push({key: 'bg:' + b.id, kind: 'bg', id: String(b.id || ''), state: b.state === 'running' ? 'running' : 'done', title: KIND.bg, model: '',
        what: String(b.command || ''), note: b.state !== 'running' && b.woke ? '已接着做' : '', startedAt: Number(b.startedAt) || 0, endedAt: Number(b.endedAt) || 0, hasOutput: false});
    }
    for (const j of status?.reasoning?.jobs || []) {
      out.push({key: 'job:' + j.id, kind: 'job', id: String(j.id || ''), state: norm(j.state), title: String(j.label || KIND.job), model: model(j.model),
        what: String(j.summary || ''), note: '', startedAt: Number(j.startedAt) || 0, endedAt: Number(j.endedAt) || 0, hasOutput: Boolean(j.hasOutput)});
    }
    for (const c of status?.tier?.children || []) {
      out.push({key: 'child:' + c.id, kind: 'child', id: String(c.id || ''), state: norm(c.state), title: String(c.roleLabel || KIND.child), model: model(c.model),
        what: String(c.summary || ''), note: '', startedAt: Number(c.startedAt) || 0, endedAt: Number(c.endedAt) || 0, hasOutput: Boolean(c.hasOutput)});
    }
    return out.sort((a, b) => RANK[a.state] - RANK[b.state] || b.startedAt - a.startedAt);
  }
  // 只认当前会话的那一份：换了会话，旧的不再显示
  const current = () => (s.data && s.data.sessionKey && s.data.sessionKey === wb()?.state?.key ? rows(s.data) : null);
  function countLine(list) {
    const n = (k) => list.filter((r) => r.state === k).length;
    const bits = [['running', '在跑'], ['failed', '失败'], ['done', '做完了']].filter(([k]) => n(k)).map(([k, w]) => `${n(k)} 个${w}`);
    return `共 ${list.length} 项` + (bits.length ? '：' + bits.join('、') : '');
  }
  const stamp = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };

  async function load() {
    const w = wb();
    if (!w?.rpc || s.busy) return;
    s.busy = true; s.error = ''; refresh();
    try {
      const r = await w.rpc('pinkie.work.status', {}, 8000);
      if (r && typeof r === 'object' && r.sessionKey) { s.data = r; s.at = Date.now(); }
      else { s.data = null; s.error = '后台没给出这个会话的任务状态。'; }
    } catch (error) {
      s.data = null; s.error = '读不到后台任务：' + String(error?.message || error);
    } finally {
      s.busy = false; w.renderTabs?.(); refresh();
    }
  }
  async function showDetail(row) {
    if (s.open === row.key) { s.open = ''; refresh(); return; }
    s.open = row.key; s.detail = ''; s.detailBusy = true; refresh();
    try {
      const r = await wb().rpc('pinkie.work.detail', {kind: row.kind, id: row.id}, 10000);
      if (s.open === row.key) s.detail = r?.found ? (r.output || '（没有内容）') : '这一项的结果已经清理掉了';
    } catch {
      if (s.open === row.key) s.detail = '暂时读不到结果';
    } finally {
      if (s.open === row.key) { s.detailBusy = false; refresh(); }
    }
  }

  function render(box) {
    const page = el('div', 'pk-wb-page pk-mtask');
    page.append(el('h1', 'pk-wb-page__title', '后台任务'));
    const list = current();
    const bar = el('div', 'pk-mtask__bar');
    bar.append(btn('刷新', () => void load()));
    if (s.busy) bar.append(el('span', 'pk-mtask__meta', '正在问后台…'));
    else if (list) bar.append(el('span', 'pk-mtask__meta', `${countLine(list)} · ${stamp(s.at)} 取的`));
    page.append(bar, el('p', 'pk-mtask__hint', '这个会话放到后台的命令、独立解答与批评、子任务。页面不自己刷新，点「刷新」看最新。'));
    if (s.error) page.append(el('p', 'pk-mtask__msg pk-mtask__msg--error', s.error));
    if (!list) {
      if (!s.busy && !s.error) page.append(el('p', 'pk-mtask__msg', '还没取到状态，点「刷新」。'));
      box.append(page); return;
    }
    if (!list.length) { page.append(el('p', 'pk-mtask__msg pk-mtask__empty', '这个会话现在没有后台任务。')); box.append(page); return; }
    const ol = el('ol', 'pk-mtask__list'); ol.setAttribute('aria-label', '后台任务');
    const now = Date.now();
    for (const r of list) {
      const li = el('li', 'pk-mtask__row'); li.dataset.state = r.state; li.dataset.kind = r.kind;
      const head = el('div', 'pk-mtask__head');
      const time = r.startedAt ? (r.state === 'running' ? '已跑 ' : '用时 ') + clock((r.endedAt || now) - r.startedAt) : '';
      head.append(el('span', 'pk-mtask__state', STATE[r.state]), el('strong', 'pk-mtask__name', r.model ? `${r.title} · ${r.model}` : r.title), el('span', 'pk-mtask__clock', time));
      li.append(head);
      if (r.what) li.append(r.kind === 'bg' ? el('code', 'pk-mtask__what pk-mtask__what--cmd', r.what) : el('p', 'pk-mtask__what', r.what));
      if (r.note) li.append(el('p', 'pk-mtask__note', r.note));
      if (r.hasOutput) {
        const opened = s.open === r.key;
        const more = btn(opened ? '收起结果' : '看结果', () => void showDetail(r), 'pk-mtask__more'); more.setAttribute('aria-expanded', String(opened));
        li.append(more);
        if (opened) li.append(el('pre', 'pk-mtask__detail', s.detailBusy ? '读取中…' : s.detail));
      }
      ol.append(li);
    }
    page.append(ol);
    box.append(page);
  }

  async function open() {
    if (!isMetre() || !wb()?.openPage) return;
    await wb().openPage('tasks', '后台任务', 'server-process', render);
    await load();
  }

  // 入口：标签栏右边的一颗图标键（wb.tabActions），只在 Metre。不放状态栏：状态栏右半边放不下时按固定顺序整项藏（B50），
  // 多一项不在那张顺序表里的会挤出半截。工作台每次重画标签栏都会调这个函数；取过状态、有在跑的就带个数。
  function tabAction() {
    if (!isMetre()) return null;
    const list = current(), running = list ? list.filter((r) => r.state === 'running').length : 0;
    const label = running ? `后台任务（${running} 个在跑）` : '后台任务';
    const b = el('button', 'pk-wb-icon pk-mtask__entry'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    const i = el('i', 'codicon codicon-server-process'); i.setAttribute('aria-hidden', 'true');
    b.append(i);
    if (running) b.append(el('span', 'pk-mtask__count', String(running)));
    b.addEventListener('click', (e) => { e.stopPropagation(); void open(); });
    return b;
  }
  function attach() { const w = wb(); if (w?.tabActions && !w.tabActions.has('tasks')) { w.tabActions.set('tasks', tabAction); w.renderTabs?.(); } }
  window.addEventListener('pinkie:session-selected', () => { s.data = null; s.error = ''; s.open = ''; s.detail = ''; });
  ns.metreTasks = {open, rows, render, tabAction, state: s};
  attach();
  if (!wb()?.tabActions) document.addEventListener('DOMContentLoaded', attach, {once: true});
})();
