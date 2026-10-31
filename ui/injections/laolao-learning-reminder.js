/* A quiet reminder in the existing learning chat header. Read-only desk data. */
(() => {
  'use strict';
  if (window.__pinkieLearningReminder) return;
  const root = document.documentElement, ID = 'pinkie-learning-reminder';
  const state = {key: '', generation: 0, node: null, host: null, panel: null, data: null, error: '', timer: 0, frame: 0, pending: null, readAt: 0};
  const key = () => new URL(location.href).searchParams.get('session') || window.__pinkieStudyDesk?.sessionKey?.() || '';
  const active = () => {
    const owner = /^agent:([^:]+):/.exec(key())?.[1];
    return !window.__pinkieDeskChat && root.dataset.laolaoMode === 'learning' && owner === 'learning';
  };
  const visible = node => node && !node.closest('[hidden], [inert]') && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden';
  const header = () => ['header.topbar .dashboard-header', '.chat-pane__header .dashboard-header', '.topnav-shell__content', '.chat-pane__header', '.topnav-shell'].map(s => document.querySelector(s)).find(visible);
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  const dayLabel = exam => !Number.isFinite(exam.daysLeft) ? '待定' : exam.daysLeft === 0 ? '今天' : exam.daysLeft < 0 ? `已过 ${Math.abs(exam.daysLeft)} 天` : `${exam.daysLeft} 天`;
  const shortName = exam => exam.id === 'pretco-b' || /英语\s*B\s*级/i.test(exam.name) ? 'B级' : exam.id === 'zsb' || exam.name === '专升本' ? '升本' : exam.name;
  const exams = () => (Array.isArray(state.data?.exams) ? state.data.exams : []).filter(e => e && typeof e.name === 'string').slice().sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
  const progress = () => {
    const data = state.data, items = [];
    if (number(data?.goals?.minutes) !== null) items.push(`每天 ${data.goals.minutes} 分钟`);
    if (number(data?.streak?.current) !== null) items.push(`连续 ${data.streak.current} 天`);
    if (number(data?.progress?.lessons) !== null && number(data?.goals?.lessons) !== null) items.push(`上课 ${data.progress.lessons} / ${data.goals.lessons} 节`);
    return items;
  };
  function closePanel() {
    state.panel?.remove(); state.panel = null;
    state.node?.setAttribute('aria-expanded', 'false');
  }
  function positionPanel() {
    if (!state.panel || !state.node) return;
    const rect = state.node.getBoundingClientRect(), panel = state.panel.getBoundingClientRect();
    state.panel.style.left = Math.max(8, Math.min(rect.left, innerWidth - panel.width - 8)) + 'px';
    state.panel.style.top = Math.min(rect.bottom + 8, innerHeight - panel.height - 8) + 'px';
  }
  function panelContent() {
    if (!state.panel) return;
    const nodes = [el('strong', 'pinkie-learning-reminder-panel__title', '学习提醒')];
    for (const exam of exams()) {
      const row = el('div', 'pinkie-learning-reminder-panel__exam');
      const label = el('span', '', exam.name); if (exam.date) label.append(el('small', '', exam.date));
      row.append(label, el('b', '', dayLabel(exam))); nodes.push(row);
    }
    if (progress().length) nodes.push(el('p', '', progress().join(' · ')));
    if (state.error) nodes.push(el('small', 'pinkie-learning-reminder-panel__error', state.data ? '暂时无法刷新，显示上次同步的数据' : '学习提醒暂未连接，稍后会自动重试'));
    else if (!state.data) nodes.push(el('p', '', '正在读取学习台数据…'));
    state.panel.replaceChildren(...nodes); positionPanel();
  }
  function togglePanel() {
    if (state.panel) { closePanel(); return; }
    const panel = state.panel = el('section', 'pinkie-learning-reminder-panel'); panel.id = ID + '-details';
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '考试倒计时和学习进度');
    document.body.append(panel); state.node.setAttribute('aria-expanded', 'true'); panelContent();
    if (state.error) void refresh(true);
  }
  function paint() {
    if (!state.node) return;
    const parts = [];
    for (const [i, exam] of exams().entries()) {
      const chip = el('span', 'pinkie-learning-reminder__exam'); chip.dataset.nearest = String(i === 0);
      const name = el('span', 'pinkie-learning-reminder__exam-name');
      name.append(el('span', 'pinkie-learning-reminder__full-name', exam.name), el('span', 'pinkie-learning-reminder__short-name', shortName(exam)));
      chip.append(name, el('b', '', dayLabel(exam))); parts.push(chip);
    }
    if (progress().length) parts.push(el('span', 'pinkie-learning-reminder__progress', progress().join(' · ')));
    if (!parts.length) parts.push(el('span', 'pinkie-learning-reminder__empty', state.error ? '提醒待连接' : '学习提醒'));
    state.node.replaceChildren(...parts);
    state.node.dataset.stale = String(Boolean(state.error));
    state.node.setAttribute('aria-label', [...exams().map(e => `${e.name} ${dayLabel(e)}`), ...progress(), state.error ? '暂时无法刷新' : '', '查看完整学习提醒'].filter(Boolean).join('，'));
    fit(); panelContent();
  }
  function fit() {
    const {node, host} = state; if (!node || !host) return;
    // A previous narrow window must not lock an intrinsically sized header
    // into the abbreviated state after the window grows again.
    node.style.removeProperty('max-width'); node.dataset.density = 'full';
    const s = getComputedStyle(host), own = getComputedStyle(node);
    const siblings = [...host.children].filter(n => n !== node && getComputedStyle(n).position !== 'absolute' && getComputedStyle(n).display !== 'none');
    const used = siblings.reduce((sum, n) => { const c = getComputedStyle(n); return sum + n.getBoundingClientRect().width + (parseFloat(c.marginLeft) || 0) + (parseFloat(c.marginRight) || 0); }, 0);
    const available = Math.max(24, host.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0) - used - (parseFloat(s.columnGap) || 0) * siblings.length - (parseFloat(own.marginLeft) || 0) - 2);
    node.style.maxWidth = Math.floor(available) + 'px';
    for (const density of ['full', 'short', 'exams', 'nearest', 'number']) {
      node.dataset.density = density;
      if (node.scrollWidth <= available + 1) break;
    }
    positionPanel();
  }
  function stopTimer() { clearTimeout(state.timer); state.timer = 0; }
  function scheduleRead() {
    stopTimer();
    if (active() && !document.hidden && root.dataset.pinkieStudyDesk !== 'desk') state.timer = setTimeout(() => void refresh(true), state.error ? 15000 : 60000);
  }
  async function refresh(force = false) {
    if (!active() || document.hidden || !state.node) return;
    if (state.pending || (!force && Date.now() - state.readAt < 30000)) { scheduleRead(); return; }
    const sessionKey = state.key, generation = state.generation;
    const request = window.__pinkieStudyDesk?.request || window.__laolaoSidebar?.gwRequest;
    const pending = state.pending = {};
    try {
      if (typeof request !== 'function') throw Error('gateway not ready');
      const result = await request('pinkie.learning.desk.today', {sessionKey}, 12000);
      if (!result || !Array.isArray(result.exams)) throw Error('invalid desk response');
      if (generation !== state.generation || sessionKey !== key() || !active()) return;
      state.data = result; state.error = ''; state.readAt = Date.now(); paint();
    } catch (error) {
      if (generation !== state.generation || sessionKey !== key() || !active()) return;
      state.error = error.message || 'unavailable'; paint();
    } finally {
      if (state.pending === pending) { state.pending = null; scheduleRead(); }
    }
  }
  const resize = new ResizeObserver(() => queue());
  function remove() {
    stopTimer(); resize.disconnect(); closePanel(); state.node?.remove(); state.host?.classList.remove('pinkie-learning-reminder-host');
    state.node = state.host = null;
  }
  function reconcile() {
    if (state.key !== key()) {
      state.generation++; state.key = key(); state.pending = null; state.data = null; state.error = ''; state.readAt = 0; remove();
    }
    const host = active() && root.dataset.pinkieStudyDesk !== 'desk' ? header() : null;
    if (!host) { if (state.node) remove(); return; }
    if (!state.node) {
      const button = state.node = el('button', 'pinkie-learning-reminder'); button.id = ID; button.type = 'button';
      button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', ID + '-details');
      button.addEventListener('click', event => { event.stopPropagation(); togglePanel(); });
      paint();
    }
    if (state.host !== host || state.node.parentNode !== host) {
      state.host?.classList.remove('pinkie-learning-reminder-host'); state.host = host; host.classList.add('pinkie-learning-reminder-host');
      host.insertBefore(state.node, host.querySelector(':scope > .dashboard-header__actions, :scope > .laolao-usage, :scope > .topnav-shell__actions'));
      resize.disconnect(); resize.observe(host);
    }
    fit(); void refresh();
  }
  function queue() {
    if (!state.frame) state.frame = requestAnimationFrame(() => { state.frame = 0; reconcile(); });
  }
  const mounts = 'header.topbar, .topnav-shell__content, .dashboard-header, .chat-pane__header';
  const observer = new MutationObserver(records => {
    if (records.some(r => r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.matches(mounts) || n.querySelector(mounts))))) queue();
  });
  const observe = () => {
    observer.observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-pinkie-study-desk']});
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-laolao-mode-label']});
  };
  for (const name of ['pinkie:session-selected', 'laolao:modechange', 'popstate', 'pinkie:study-desk-view', 'pinkie:study-desk-mounted', 'pinkie:desk-chat-ready']) window.addEventListener(name, queue);
  window.addEventListener('pinkie:learning-state', () => { if (active() && !document.hidden) { state.readAt = 0; queue(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTimer(); closePanel(); } else { state.readAt = 0; queue(); } });
  window.addEventListener('resize', queue);
  document.addEventListener('pointerdown', event => { if (state.panel && !state.panel.contains(event.target) && !state.node?.contains(event.target)) closePanel(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.panel) { event.preventDefault(); closePanel(); state.node?.focus(); } });
  window.addEventListener('pagehide', () => { state.generation++; state.pending = null; observer.disconnect(); remove(); });
  window.addEventListener('pageshow', () => { observe(); queue(); });
  window.__pinkieLearningReminder = {refresh: () => refresh(true)};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { observe(); queue(); }, {once: true}); else { observe(); queue(); }
})();
