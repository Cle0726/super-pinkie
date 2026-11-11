/* Chat-side view of gateway-owned proposals, reports, and lineage. */
(() => {
  'use strict';
  const stateLabels = {expired: '已过期', dismissed: '已跳过', here: '已在这里继续', started: '已开启子会话'};
  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };

  function proposalState(card, now = Date.now()) {
    if (card.state !== 'pending') return card.state;
    return card.expiresAt <= now ? 'expired' : 'pending';
  }

  function cardActions(card, now) {
    if (card.kind !== 'proposal' || proposalState(card, now) !== 'pending') return [];
    return card.initiation === 'offer' ? [['start', '开新会话'], ['here', '就在这里做']]
      : [['start', '开始'], ['dismiss', '不用了']];
  }

  const request = (method, params, timeout) => {
    const sidebar = window.__laolaoSidebar;
    return sidebar ? sidebar.gwRequest(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  function activePane() {
    const panes = [...document.querySelectorAll('openclaw-chat-pane')];
    return panes.find(pane => pane.active === true) || panes[0] || null;
  }

  function currentKey() {
    if (!activePane()) return '';
    return new URL(location.href).searchParams.get('session')
      || activePane()?.state?.sessionKey
      || document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset.sessionKey || '';
  }

  function link(key, label, className = '') {
    const anchor = el('a', className, label);
    anchor.href = '/chat?session=' + encodeURIComponent(key);
    anchor.title = label;
    anchor.onclick = event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      window.__laolaoSidebar?.navigateSession(key);
    };
    return anchor;
  }

  let selected = '', data = null, sequence = 0, frame = 0, expiryTimer = 0, refreshTimer = 0;
  let panel, parentLink;
  const busy = new Set();
  const errors = new Map();

  function renderCard(card, key) {
    const proposal = card.kind === 'proposal';
    const state = proposal ? proposalState(card) : 'report';
    const box = el('section', 'pinkie-session-card');
    box.dataset.sessionCard = card.id;
    box.dataset.state = state;
    const heading = el('div', 'pinkie-session-card__title');
    if (proposal) heading.textContent = card.title;
    else heading.append('子会话「', link(card.childKey, card.title), '」做完一轮');
    box.append(heading, el('div', 'pinkie-session-card__body', proposal ? card.summary : card.text));

    const actions = el('div', 'pinkie-session-card__actions');
    for (const [action, label] of cardActions(card)) {
      const button = el('button', 'laolao-managed-button pinkie-session-card__button', label);
      button.type = 'button';
      button.disabled = busy.has(card.id);
      button.onclick = async () => {
        if (busy.has(card.id) || key !== selected) return;
        busy.add(card.id);
        errors.delete(card.id);
        paint();
        try {
          const result = await request('pinkie.session.card.act', {key, id: card.id, action}, 45_000);
          if (key === selected && data) data.cards = data.cards.map(item => item.id === card.id ? result : item);
          window.PinkieSessionList?.invalidate();
        } catch (error) {
          if (key === selected) errors.set(card.id, error.message || '这次没有完成，请再试一次');
        } finally {
          busy.delete(card.id);
          if (key === selected) paint();
        }
      };
      actions.append(button);
    }
    if (proposal && stateLabels[state]) {
      const status = state === 'started' && card.childKey
        ? link(card.childKey, stateLabels[state]) : el('span', '', stateLabels[state]);
      actions.append(status);
    }
    if (errors.has(card.id)) actions.append(el('span', 'pinkie-session-card__error', errors.get(card.id)));
    if (actions.childNodes.length) box.append(actions);
    return box;
  }

  function paint() {
    const pane = activePane(), key = currentKey();
    if (pane) pane.toggleAttribute('data-pinkie-session-readonly', /:subagent:/i.test(key));
    const thread = pane?.querySelector('.chat-thread-inner');
    const signature = JSON.stringify([selected, data, [...busy], [...errors],
      (data?.cards || []).map(card => proposalState(card))]);
    if (!thread || !data || key !== selected || /:subagent:/i.test(key)) {
      panel?.remove();
      parentLink?.remove();
      return;
    }
    const host = pane.querySelector('.chat-thread, .chat-thread-scroll') || thread;
    if (data.parentKey) {
      if (!parentLink || parentLink.parentElement !== host.parentElement || parentLink.dataset.signature !== signature) {
        parentLink?.remove();
        parentLink = link(data.parentKey, '来自：' + data.parentTitle, 'pinkie-session-parent');
        parentLink.dataset.signature = signature;
        host.before(parentLink);
      }
    } else parentLink?.remove();
    if (!(data.cards || []).length) {
      panel?.remove();
      return;
    }
    if (panel?.parentElement === thread && panel.dataset.signature === signature) return;
    panel?.remove();
    panel = el('div', 'pinkie-session-cards');
    panel.dataset.signature = signature;
    panel.setAttribute('aria-label', '子会话提案和汇报');
    for (const card of data.cards) panel.append(renderCard(card, key));
    thread.append(panel);

    clearTimeout(expiryTimer);
    const expiresAt = Math.min(...data.cards.filter(card => cardActions(card).length).map(card => card.expiresAt));
    if (Number.isFinite(expiresAt)) expiryTimer = setTimeout(paint, Math.max(0, expiresAt - Date.now()));
  }

  async function refresh(key = currentKey()) {
    if (!key || /:subagent:/i.test(key)) {
      data = null;
      paint();
      return;
    }
    const requestId = ++sequence;
    try {
      const result = await request('pinkie.session.cards', {key});
      if (requestId !== sequence || key !== currentKey()) return;
      data = result;
      paint();
    } catch { /* The chat remains usable while an older gateway reconnects. */ }
  }

  function reconcile() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const key = currentKey();
      if (key !== selected) {
        selected = key;
        data = null;
        errors.clear();
        void refresh(key);
      }
      paint();
    });
  }

  function refreshSoon() {
    reconcile();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 180);
  }

  window.PinkieSessionCards = {cardActions, proposalState};
  if (typeof MutationObserver !== 'function') return;
  new MutationObserver(reconcile).observe(document.documentElement, {subtree: true, childList: true});
  window.addEventListener('popstate', reconcile);
  window.addEventListener('pinkie:session-selected', reconcile);
  window.addEventListener('pinkie:sidebar-gateway-ready', refreshSoon);
  window.addEventListener('pinkie:gateway-event', ({detail}) => {
    if (detail?.event === 'sessions.changed' && detail.payload?.sessionKey === selected
        || detail?.event === 'chat' && ['final', 'error', 'aborted'].includes(detail.payload?.state)
          && detail.payload?.sessionKey === selected) refreshSoon();
  });
  reconcile();
})();
