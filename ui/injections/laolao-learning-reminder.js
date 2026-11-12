/* A quiet reminder in the existing learning chat header. Read-only desk data. */
(() => {
  'use strict';
  if (window.__pinkieLearningReminder) return;
  const root = document.documentElement, ID = 'pinkie-learning-reminder';
  const state = {key: '', generation: 0, node: null, host: null, data: null, error: '', timer: 0, frame: 0, pending: null, readAt: 0};
  const learningKey = value => /^agent:learning:/.test(value || '') ? value : '';
  const key = () => {
    const found = [
      new URL(location.href).searchParams.get('session') || '',
      window.__pinkieStudyDesk?.sessionKey?.() || '',
      ...[...document.querySelectorAll('openclaw-chat-pane')].map(pane => pane.state?.sessionKey || pane.sessionKey || ''),
      document.querySelector('openclaw-app-shell')?.activeSessionKey || '',
      document.querySelector('openclaw-app-shell')?.context?.gateway?.snapshot?.sessionKey || '',
      document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset.sessionKey || '',
    ].find(learningKey);
    if (found) return found;
    return root.dataset.laolaoMode === 'learning' ? 'agent:learning:main' : '';
  };
  const active = () => {
    // __pinkieDeskChat is the desk-chat API and is set for the whole session.
    // Treating it as "already on the desk" removed the top-bar countdown forever.
    if (root.dataset.laolaoMode !== 'learning') return false;
    const owner = /^agent:([^:]+):/.exec(key())?.[1];
    return !owner || owner === 'learning';
  };
  const visible = node => node && !node.closest('[hidden], [inert]') && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden';
  const header = () => {
    // The bar in the screenshot is the row that holds 「学习台」 and the usage chips.
    const usage = [...document.querySelectorAll('.laolao-usage')].find(visible);
    const bar = usage?.parentElement;
    if (bar && visible(bar)) return bar;
    return ['.dashboard-header', '.chat-pane__header', '.pk-workspace-header', '.topnav-shell', 'header.topbar'].map(s => document.querySelector(s)).find(visible);
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const dayLabel = exam => !Number.isFinite(exam.daysLeft) ? '待定' : exam.daysLeft === 0 ? '今天' : exam.daysLeft < 0 ? `已过 ${Math.abs(exam.daysLeft)} 天` : `${exam.daysLeft} 天`;
  const exams = () => (Array.isArray(state.data?.exams) ? state.data.exams : []).filter(e => e && typeof e.name === 'string').slice().sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
  function paint() {
    if (!state.node) return;
    const parts = [];
    for (const [i, exam] of exams().entries()) {
      // One quiet line, the same size as the rest of the bar: name + days.
      const chip = el('span', 'pinkie-learning-reminder__exam'); chip.dataset.nearest = String(i === 0);
      const days = Number.isFinite(exam.daysLeft) && exam.daysLeft > 0;
      chip.append(el('span', 'pinkie-learning-reminder__name', exam.name), el('b', 'pinkie-learning-reminder__days', days ? String(exam.daysLeft) : dayLabel(exam)));
      if (days) chip.append(el('span', 'pinkie-learning-reminder__unit', '天'));
      if (exam.date) chip.title = `${exam.name} ${exam.date}`;
      parts.push(chip);
    }
    state.node.replaceChildren(...parts);
    state.node.dataset.stale = String(Boolean(state.error));
    state.node.setAttribute('aria-label', '考试倒计时：' + exams().map(e => `${e.name} ${dayLabel(e)}`).join('，'));
    fit();
  }
  function fit() {
    const {node, host} = state; if (!node || !host) return;
    // Too narrow for both exams → keep only the nearest; too narrow for that → hide. Never clip.
    node.hidden = !node.children.length; if (node.hidden) return;
    const over = () => node.scrollWidth > node.clientWidth + 1 || host.scrollWidth > host.clientWidth + 1;
    node.dataset.density = 'full';
    if (over()) node.dataset.density = 'nearest';
    if (over()) node.hidden = true;
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
    stopTimer(); resize.disconnect(); state.node?.remove(); state.host?.classList.remove('pinkie-learning-reminder-host');
    state.node = state.host = null;
  }
  function reconcile() {
    if (state.key !== key()) {
      state.generation++; state.key = key(); state.pending = null; state.data = null; state.error = ''; state.readAt = 0; remove();
    }
    const host = active() && root.dataset.pinkieStudyDesk !== 'desk' ? header() : null;
    if (!host) { if (state.node) remove(); return; }
    if (!state.node) {
      const line = state.node = el('div', 'pinkie-learning-reminder'); line.id = ID; line.setAttribute('role', 'status');
      paint();
    }
    if (state.host !== host || state.node.parentNode !== host) {
      state.host?.classList.remove('pinkie-learning-reminder-host'); state.host = host; host.classList.add('pinkie-learning-reminder-host');
      const usage = [...host.querySelectorAll('.laolao-usage')].find(node => node.parentElement === host);
      host.insertBefore(state.node, usage || host.querySelector(':scope > .dashboard-header__actions, :scope > .topnav-shell__actions, :scope > .pk-workspace-header__views'));
      resize.disconnect(); resize.observe(host);
    }
    fit(); void refresh();
  }
  function queue() {
    if (!state.frame) state.frame = requestAnimationFrame(() => { state.frame = 0; reconcile(); });
  }
  const mounts = 'header.topbar, .topnav-shell__content, .dashboard-header, .chat-pane__header, .pk-workspace-header';
  const observer = new MutationObserver(records => {
    if (records.some(r => r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.matches(mounts) || n.querySelector(mounts))))) queue();
  });
  const observe = () => {
    observer.observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-pinkie-study-desk']});
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-laolao-mode-label']});
  };
  for (const name of ['pinkie:session-selected', 'laolao:modechange', 'popstate', 'pinkie:study-desk-view', 'pinkie:study-desk-mounted', 'pinkie:desk-chat-ready']) window.addEventListener(name, queue);
  window.addEventListener('pinkie:learning-state', () => { if (active() && !document.hidden) { state.readAt = 0; queue(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTimer(); } else { state.readAt = 0; queue(); } });
  window.addEventListener('resize', queue);
  window.addEventListener('pagehide', () => { state.generation++; state.pending = null; observer.disconnect(); remove(); });
  window.addEventListener('pageshow', () => { observe(); queue(); });
  window.__pinkieLearningReminder = {refresh: () => refresh(true)};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { observe(); queue(); }, {once: true}); else { observe(); queue(); }
})();
