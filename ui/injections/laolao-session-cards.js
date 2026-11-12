/* Chat-side view of gateway-owned proposals, reports, and lineage. */
(() => {
  'use strict';
  const stateLabels = {expired: '已过期', dismissed: '已跳过', here: '已在这里继续', started: '已开启'};
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

  const agentOf = key => String(key || '').split(':')[1] || '';
  const MODE_OF_AGENT = {main: '唠嗑模式', project: '项目模式', thinking: '想法模式', learning: '学习模式'};
  function link(key, label, className = '') {
    const anchor = el('a', className, label);
    anchor.href = '/chat?session=' + encodeURIComponent(key);
    anchor.title = label;
    anchor.onclick = event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      // 别的模式里的会话：侧栏只认当前模式，交给模式切换器带过去。
      if (agentOf(key) !== agentOf(currentKey())) window.dispatchEvent(new CustomEvent('pinkie:open-session-in-mode', {detail: {sessionKey: key}}));
      else window.__laolaoSidebar?.navigateSession(key);
    };
    return anchor;
  }

  let selected = '', data = null, sequence = 0, frame = 0, expiryTimer = 0, refreshTimer = 0;
  let parentLink, decisionBar, layoutObserver, observedThread, observedComposer;
  const panels = new Map(), expanded = new Set(), fullPrompts = new Map(), loadingFull = new Set();
  const busy = new Set();
  const errors = new Map();

  function cardButton(label, action, className = '') {
    const button = el('button', 'pinkie-session-card__button ' + className, label);
    button.type = 'button'; button.setAttribute('aria-label', label); button.onclick = action;
    return button;
  }
  async function showFullPrompt(card, key) {
    if (expanded.has(card.id)) { expanded.delete(card.id); paint(); return; }
    if (fullPrompts.has(card.id)) { expanded.add(card.id); paint(); return; }
    if (loadingFull.has(card.id)) return;
    loadingFull.add(card.id); errors.delete(card.id); paint();
    try {
      const result = await request('pinkie.session.card.get', {key, id: card.id});
      if (result?.ok === false) throw new Error(result.error || '简报暂时无法读取');
      if (typeof result?.card?.prompt !== 'string') throw new Error('没有取得完整简报');
      if (key === selected) { fullPrompts.set(card.id, result.card.prompt); expanded.add(card.id); }
    } catch (error) { if (key === selected) errors.set(card.id, error.message || '简报暂时无法读取'); }
    finally { loadingFull.delete(card.id); if (key === selected) paint(); }
  }

  function chooseAnchor(card, messages) {
    const id = card.anchor?.entryId;
    if (id) {
      const index = messages.findIndex(message => message.ids?.some(value => value === id || value === 'msg:' + id || value === 'message:' + id));
      if (index >= 0) return index;
    }
    if (!Number.isFinite(Number(card.createdAt))) return -1;
    let nearest = -1, distance = Infinity;
    messages.forEach((message, index) => {
      if (!Number.isFinite(message.at)) return;
      const delta = Math.abs(message.at - Number(card.createdAt));
      if (delta < distance) { nearest = index; distance = delta; }
    });
    return nearest;
  }

  // Align to the assistant text, without extending beyond the composer.
  // On a fresh page the conversation can still be hidden, so the composer is
  // also a useful fallback until the first assistant message is painted.
  function cardMeasure(composer, message) {
    if (!composer || composer.width <= 0) return null;
    const left = message?.width > 0 ? Math.max(composer.left, message.left) : composer.left;
    const right = message?.width > 0 ? Math.min(composer.right, message.right) : composer.right;
    return right > left ? {left, width: right - left} : {left: composer.left, width: composer.width};
  }

  function alignInParent(node, measure) {
    const parent = node?.parentElement;
    if (!parent || !measure) return;
    const rect = parent.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(parent).paddingLeft) || 0;
    const left = Math.max(0, measure.left - rect.left - parent.clientLeft - padding + parent.scrollLeft);
    const width = `${Math.max(0, measure.width)}px`;
    const margin = `${left}px`;
    if (node.style.width !== width) node.style.width = width;
    if (node.style.marginLeft !== margin) node.style.marginLeft = margin;
    if (node.style.marginRight !== '0px') node.style.marginRight = '0px';
  }

  function alignCards(thread, composer) {
    if (!composer) return;
    const input = composer.getBoundingClientRect();
    const message = thread.querySelector('.chat-group.assistant .chat-group-messages')?.getBoundingClientRect();
    const measure = cardMeasure(input, message);
    for (const panel of panels.values()) alignInParent(panel, measure);
    alignInParent(decisionBar, input.width > 0 ? {left: input.left, width: input.width} : null);
  }

  function observeLayout(thread, composer) {
    if (typeof ResizeObserver !== 'function' || (thread === observedThread && composer === observedComposer)) return;
    layoutObserver?.disconnect();
    observedThread = thread; observedComposer = composer;
    layoutObserver = new ResizeObserver(reconcile);
    if (thread) layoutObserver.observe(thread);
    if (composer) layoutObserver.observe(composer);
  }

  function forkEntryId(messageId, history = []) {
    const domId = String(messageId || '');
    if (!domId.startsWith('msg:') || !Array.isArray(history)) return '';
    const candidates = history.filter(item => {
      const direct = [item?.id, item?.messageId].filter(value => typeof value === 'string' && value);
      if (direct.length) return direct.some(value => domId === 'msg:' + value);
      if (typeof item?.timestamp !== 'number') return false;
      const prefix = `msg:${item.role || 'unknown'}:${item.timestamp}:`;
      return domId.startsWith(prefix) && /^\d+$/.test(domId.slice(prefix.length));
    });
    // The renderer numbers a paged window, so its index need not be the
    // history-array index. A timestamp is safe only when it identifies one entry.
    return candidates.length === 1 && typeof candidates[0].__openclaw?.id === 'string' ? candidates[0].__openclaw.id : '';
  }
  function currentTitle(key) {
    const row = [...document.querySelectorAll('.session-row-host')].find(item => item.dataset.sessionKey === key);
    return row?.querySelector('.sidebar-recent-session__name')?.textContent || '当前会话';
  }
  function ensureEntryPoints(pane, key) {
    const sidebar = window.__laolaoSidebar;
    const topbar = document.querySelector('.shell--chat .topnav-shell__actions');
    if (topbar && sidebar?.sessionMenu) {
      let more = topbar.querySelector('.pinkie-chat-session-menu');
      if (!more) {
        more = cardButton('⋯', null, 'pinkie-chat-session-menu');
        more.setAttribute('aria-label', '聊天会话菜单'); topbar.append(more);
      }
      more.onclick = event => sidebar.sessionMenu(event.currentTarget, key, currentTitle(key), false, {isChild:Boolean(data?.parentKey)});
    }
    const canFork = !data?.parentKey && !/:subagent:/i.test(key);
    for (const bubble of pane.querySelectorAll('.chat-group.assistant .chat-bubble[data-message-id]')) {
      let button = bubble.querySelector('.pinkie-fork-action');
      if (!canFork || bubble.classList.contains('streaming') || bubble.classList.contains('chat-bubble--tool-shell')) { button?.remove(); continue; }
      if (!button) {
        button = cardButton('从这里分出去', null, 'pinkie-fork-action'); bubble.append(button);
      }
      button.onclick = () => sidebar?.openChildSessionDialog(key, currentTitle(key),
        {fromMessage:true, forkAt:forkEntryId(bubble.dataset.messageId, pane.state?.chatMessages)});
    }
  }

  function renderCard(card, key) {
    const proposal = card.kind === 'proposal';
    const state = proposal ? proposalState(card) : 'report';
    const box = el('section', 'pinkie-session-card');
    box.dataset.sessionCard = card.id;
    box.dataset.state = state;
    if (proposal && state !== 'pending') {
      const header = el('div', 'pinkie-session-card__compact');
      const icon = {started:'✓', dismissed:'—', here:'↩', expired:'◷'}[state] || '•';
      const childState = state === 'started' && card.childKey ? ' · ' + (data?.childStates?.[card.childKey] || '已完成') : '';
      const toggle = cardButton(`${icon} ${stateLabels[state] || state} · ${card.title}${childState}`,
        () => { if (expanded.has(card.id)) { expanded.delete(card.id); paint(); } else void showFullPrompt(card, key); },
        'pinkie-session-card__compact-toggle');
      toggle.setAttribute('aria-expanded', String(expanded.has(card.id)));
      header.append(toggle);
      if (state === 'started' && card.childKey) header.append(link(card.childKey, card.modeName ? '去' + card.modeName + '打开 ›' : '打开 ›'));
      box.append(header);
      if (expanded.has(card.id)) box.append(el('div', 'pinkie-session-card__body', fullPrompts.get(card.id) || card.summary || ''));
      if (errors.has(card.id)) box.append(el('div', 'pinkie-session-card__error', errors.get(card.id)));
      return box;
    }
    const heading = el('div', 'pinkie-session-card__title');
    const where = card.modeName ? card.modeName + ' · ' : '';
    if (proposal) heading.textContent = where + card.title;
    else heading.textContent = where + card.title + (card.consult ? ' 的回答' : ' 做完一轮');
    const body = el('div', 'pinkie-session-card__body', proposal
      ? (expanded.has(card.id) ? fullPrompts.get(card.id) : card.summary) : card.text);
    if (!expanded.has(card.id)) body.classList.add('pinkie-session-card__body--preview');
    box.append(heading, body);

    const actions = el('div', 'pinkie-session-card__actions');
    if (proposal) {
      const full = cardButton(loadingFull.has(card.id) ? '正在读取简报…' : expanded.has(card.id) ? '收起简报 ⌃' : '看完整简报 ⌄',
        () => void showFullPrompt(card, key), 'pinkie-session-card__text-button');
      full.disabled = loadingFull.has(card.id); full.setAttribute('aria-expanded', String(expanded.has(card.id)));
      box.append(full);
    } else {
      const full = cardButton(expanded.has(card.id) ? '收起全文' : '展开全文', () => {
        if (expanded.has(card.id)) expanded.delete(card.id); else expanded.add(card.id); paint();
      }, 'pinkie-session-card__text-button');
      full.setAttribute('aria-expanded', String(expanded.has(card.id)));
      // 去别的模式问一句的会话答完就归档了，没有可打开的东西。
      actions.append(full);
      if (!card.consult) actions.append(link(card.childKey, card.modeName ? '去' + card.modeName + '打开 ›' : '打开子会话 ›'));
    }
    for (const [action, label] of cardActions(card)) {
      const button = cardButton(label, null, action === 'start' ? 'pinkie-session-card__primary' : 'pinkie-session-card__secondary');
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
    if (errors.has(card.id)) actions.append(el('span', 'pinkie-session-card__error', errors.get(card.id)));
    if (actions.childNodes.length) box.append(actions);
    return box;
  }

  function paint() {
    const pane = activePane(), key = currentKey();
    if (pane) pane.toggleAttribute('data-pinkie-session-readonly', /:subagent:/i.test(key));
    const thread = pane?.querySelector('.chat-thread-inner');
    const signature = JSON.stringify([selected, data?.parentKey, data?.parentTitle]);
    if (!thread || !data || key !== selected || /:subagent:/i.test(key)) {
      for (const panel of panels.values()) panel.remove(); panels.clear();
      window.PinkieCrew?.clear();
      parentLink?.remove();
      decisionBar?.remove();
      document.querySelector('.pinkie-chat-session-menu')?.remove();
      for (const button of pane?.querySelectorAll('.pinkie-fork-action') || []) button.remove();
      return;
    }
    const host = pane.querySelector('.chat-thread, .chat-thread-scroll') || thread;
    ensureEntryPoints(pane, key);
    if (data.parentKey) {
      if (!parentLink || parentLink.parentElement !== host.parentElement || parentLink.dataset.signature !== signature) {
        parentLink?.remove();
        const fromMode = agentOf(data.parentKey) !== agentOf(key) ? MODE_OF_AGENT[agentOf(data.parentKey)] : '';
        parentLink = link(data.parentKey, (fromMode ? '来自' + fromMode + '：' : '来自：') + data.parentTitle, 'pinkie-session-parent');
        parentLink.dataset.signature = signature;
        host.before(parentLink);
      }
    } else parentLink?.remove();
    const cards = data.cards || [], ids = new Set(cards.map(card => card.id));
    for (const [id, panel] of panels) if (!ids.has(id)) { panel.remove(); panels.delete(id); }
    const groups = [...thread.querySelectorAll('.chat-group')].filter(group => !group.closest('.pinkie-session-cards'));
    const messages = groups.map(group => ({group,
      ids: [...group.querySelectorAll('[data-message-id]')].flatMap(node =>
        [node.dataset.messageId, forkEntryId(node.dataset.messageId, pane.state?.chatMessages)].filter(Boolean)),
      at: Date.parse(group.querySelector('time[datetime]')?.getAttribute('datetime') || '')}));
    const placed = new Map();
    for (const card of cards) {
      const cardSignature = JSON.stringify([card, proposalState(card), busy.has(card.id), errors.get(card.id),
        expanded.has(card.id), fullPrompts.get(card.id), loadingFull.has(card.id), data.childStates?.[card.childKey]]);
      let panel = panels.get(card.id);
      if (!panel || panel.dataset.signature !== cardSignature) {
        const replacement = el('div', 'pinkie-session-cards');
        replacement.dataset.signature = cardSignature;
        replacement.setAttribute('aria-label', '子会话提案和汇报');
        replacement.append(renderCard(card, key));
        if (panel?.isConnected) panel.replaceWith(replacement);
        panel = replacement; panels.set(card.id, panel);
      }
      const index = chooseAnchor(card, messages);
      let anchor = index < 0 ? null : messages[index].group;
      while (anchor && anchor.parentElement !== thread) anchor = anchor.parentElement;
      const cursor = placed.get(anchor) || anchor;
      if (cursor && cursor.parentElement === thread) {
        if (cursor.nextElementSibling !== panel) cursor.after(panel);
      } else if (panel.parentElement !== thread || thread.lastElementChild !== panel) thread.append(panel);
      placed.set(anchor, panel);
    }

    const pending = cards.filter(card => cardActions(card).length);
    const composer = pane.querySelector('.agent-chat__composer-shell');
    if (!pending.length || !composer) decisionBar?.remove();
    else {
      if (!decisionBar) decisionBar = cardButton('', () => {
        panels.get(pending[0].id)?.scrollIntoView({block:'center',behavior:'auto'});
      }, 'pinkie-session-decisions');
      decisionBar.onclick = () => panels.get(pending[0].id)?.scrollIntoView({block:'center',behavior:'auto'});
      const label = `有 ${pending.length} 件事等你决定 ↓`;
      if (decisionBar.textContent !== label) { decisionBar.textContent = label; decisionBar.setAttribute('aria-label', label); }
      if (decisionBar.parentElement !== composer.parentElement || decisionBar.nextElementSibling !== composer) composer.before(decisionBar);
    }
    window.PinkieCrew?.render(composer, data.family, key);
    observeLayout(thread, composer);
    alignCards(thread, composer);

    clearTimeout(expiryTimer);
    const expiresAt = Math.min(...cards.filter(card => cardActions(card).length).map(card => card.expiresAt));
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
      const agentId = key.split(':')[1];
      const [result, list, lineage] = await Promise.all([
        request('pinkie.session.cards', {key}),
        request('sessions.list', {agentId, archived:false, limit:1000}).catch(() => null),
        request('pinkie.session.lineage', {agentId}).catch(() => null),
      ]);
      if (requestId !== sequence || key !== currentKey()) return;
      result.childStates = Object.fromEntries((list?.sessions || []).map(row => {
        const phase = window.PinkieSessionList?.sessionStatus({...row, phase:lineage?.states?.[row.key]?.phase});
        return [row.key, {running:'运行中', waiting:'等你回复', error:'出错'}[phase] || '已完成'];
      }));
      // 分工气球（laolao-crew.js）用的那一家子：这个会话开出去的子会话，同模式的和开到别的模式里的。
      const phases = {running: 'running', waiting: 'waiting', error: 'error'};
      const rows = new Map((list?.sessions || []).map(row => [row.key, row]));
      const reported = new Set((result.cards || []).filter(card => card.kind === 'report').map(card => card.childKey));
      const AGENT_MODE = {main: 'chat', project: 'project', thinking: 'ideas', learning: 'learning'};
      result.family = [
        ...Object.entries(lineage?.children || {})
          .filter(([childKey, child]) => child.parentKey === key && !child.cross && !/:subagent:/i.test(childKey) && rows.has(childKey))
          .map(([childKey, child]) => ({key: childKey, title: child.title || rows.get(childKey).label, mode: AGENT_MODE[agentId] || 'chat',
            status: phases[window.PinkieSessionList?.sessionStatus({...rows.get(childKey), phase: lineage?.states?.[childKey]?.phase})] || 'done'})),
        ...Object.entries(lineage?.away || {}).filter(([, child]) => child.parentKey === key)
          .map(([childKey, child]) => ({key: childKey, title: child.title, mode: child.mode, status: reported.has(childKey) ? 'done' : 'running'})),
      ];
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
        expanded.clear(); fullPrompts.clear(); loadingFull.clear();
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

  window.PinkieSessionCards = {cardActions, proposalState, chooseAnchor, forkEntryId, cardMeasure};
  if (typeof MutationObserver !== 'function') return;
  new MutationObserver(reconcile).observe(document.documentElement, {subtree: true, childList: true});
  window.addEventListener('popstate', reconcile);
  window.addEventListener('resize', reconcile);
  window.addEventListener('pinkie:session-selected', reconcile);
  window.addEventListener('pinkie:sidebar-gateway-ready', refreshSoon);
  window.addEventListener('pinkie:gateway-event', ({detail}) => {
    const eventKey = detail?.payload?.sessionKey;
    const relevant = eventKey === selected || (data?.cards || []).some(card => card.childKey === eventKey);
    if (relevant && (detail?.event === 'sessions.changed'
        || detail?.event === 'agent' && detail.payload?.stream === 'lifecycle'
        || detail?.event === 'chat' && ['final', 'error', 'aborted'].includes(detail.payload?.state))) refreshSoon();
  });
  reconcile();
})();
