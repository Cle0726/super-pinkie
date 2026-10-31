/* laolao-plan:v2 —— 碧琪的工作计划（plan_update 工具的真实状态）
 *
 *   计划  整理销售数据                         2 / 5  ⌄
 *   ▰▰▱▱▱
 *   ✓ 读取三个月的订单
 *   ✓ 核对退款
 *   ◌ 画趋势图            ← 进行中：一道光扫过文字，圈在转
 *   ○ 写结论
 *
 * 和工作过程的状态行同一套 C.le. 语言。全部做完后收成一行「计划 · 5 项都完成了」。
 * 每个聊天窗格各管各的；状态变化时只改那一行的 data-status，样式过渡自然发生。 */
(() => {
  'use strict';
  if (window.__pinkiePlan) return;
  const views = new Map();
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const request = (method, params) => window.__laolaoSidebar?.gwRequest?.(method, params, 12000);
  const MARK = {
    completed: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M4.9 8.3 7 10.3l4.2-4.5"/></svg>',
    in_progress: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><circle class="pk-plan__arc" cx="8" cy="8" r="6.2"/></svg>',
    pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/></svg>',
  };
  const SAY = {completed: '已完成', in_progress: '进行中', pending: '未开始'};
  let scheduled = false;
  const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(() => { scheduled = false; attach(); }, 240); } };

  function build(view) {
    const card = el('section', 'pk-plan'); card.setAttribute('aria-label', '工作计划');
    const head = el('button', 'pk-plan__head'); head.type = 'button';
    head.append(el('span', 'pk-plan__label', '计划'), el('span', 'pk-plan__title'), el('span', 'pk-plan__count'), el('span', 'pk-plan__chev'));
    head.addEventListener('click', () => {
      view.folded = !view.folded;
      view.userFolded = true;
      card.classList.toggle('is-folded', view.folded);
      head.setAttribute('aria-expanded', String(!view.folded));
    });
    const bar = el('div', 'pk-plan__bar'); bar.setAttribute('aria-hidden', 'true');
    const body = el('div', 'pk-plan__body');
    body.append(el('ol', 'pk-plan__list'), el('p', 'pk-plan__note'));
    card.append(head, bar, body);
    return card;
  }

  function update(view, card, plan) {
    const items = plan.items || [];
    const total = items.length, done = items.filter((i) => i.status === 'completed').length;
    const finished = total > 0 && done === total;
    card.dataset.state = finished ? 'done' : 'running';
    const named = plan.title && plan.title !== '工作计划' ? plan.title : '';
    card.querySelector('.pk-plan__title').textContent = finished ? (named ? named + ' · ' : '') + total + ' 项都完成了' : named || '这次要做的 ' + total + ' 件事';
    card.querySelector('.pk-plan__count').textContent = finished ? '' : done + ' / ' + total;
    // 做完自动收起；先生自己点开过就尊重他的选择
    if (!view.userFolded) view.folded = finished;
    card.classList.toggle('is-folded', !!view.folded);
    card.querySelector('.pk-plan__head').setAttribute('aria-expanded', String(!view.folded));

    const bar = card.querySelector('.pk-plan__bar');
    while (bar.children.length > total) bar.lastChild.remove();
    while (bar.children.length < total) bar.append(el('i'));
    items.forEach((item, i) => { bar.children[i].dataset.status = item.status; });

    const list = card.querySelector('.pk-plan__list');
    const rows = new Map([...list.children].map((li) => [li.dataset.id, li]));
    let prev = null;
    for (const item of items) {
      let li = rows.get(item.id);
      if (!li) {
        li = el('li', 'pk-plan__item'); li.dataset.id = item.id;
        li.append(el('span', 'pk-plan__mark'), el('span', 'pk-plan__text'));
        if (view.painted) li.classList.add('is-new');
      }
      rows.delete(item.id);
      if (li.dataset.status !== item.status) {
        li.dataset.status = item.status;
        li.querySelector('.pk-plan__mark').innerHTML = MARK[item.status] || MARK.pending;
        li.setAttribute('aria-label', SAY[item.status] + '：' + item.text);
      }
      const text = li.querySelector('.pk-plan__text');
      if (text.textContent !== item.text) text.textContent = item.text;
      if (prev ? prev.nextSibling !== li : list.firstChild !== li) prev ? prev.after(li) : list.prepend(li);
      prev = li;
    }
    for (const li of rows.values()) li.remove();
    const note = card.querySelector('.pk-plan__note');
    note.textContent = plan.explanation || '';
    note.hidden = !plan.explanation;
    view.painted = true;
  }

  function paint(view) {
    const {host, plan} = view;
    if (!plan || !plan.items?.length) { view.card?.remove(); view.card = null; return; }
    const match = plan.toolCallId ? [...host.querySelectorAll('[data-message-id]')].find((n) => n.dataset.messageId.includes(plan.toolCallId)) : null;
    const target = match?.closest('.chat-group.assistant') || (Date.now() - plan.updatedAt < 300000 ? [...host.querySelectorAll('.chat-group.assistant')].pop() : null);
    if (!target) return;
    const sig = JSON.stringify([plan.title, plan.items, plan.explanation]);
    if (view.card?.isConnected && view.sig === sig && view.card.parentElement === target.querySelector(':scope > .chat-group-messages')) return;
    if (!view.card) view.card = build(view);
    update(view, view.card, plan);
    const messages = target.querySelector(':scope > .chat-group-messages');
    if (!messages) return;
    if (view.card.parentElement !== messages) {
      const process = messages.querySelector(':scope > .pinkie-process');
      process ? process.before(view.card) : messages.prepend(view.card);
    }
    view.sig = sig;
  }

  async function refresh(view) {
    if (view.busy || !view.key || typeof window.__laolaoSidebar?.gwRequest !== 'function') return;
    view.busy = true;
    const key = view.key;
    try {
      const result = await request('pinkie.plan.get', {sessionKey: key});
      if (view.key === key && view.host.isConnected) { view.plan = result.plan; paint(view); }
    } catch { /* 老网关没有计划，聊天照常 */ }
    finally { view.busy = false; }
  }
  function attach() {
    for (const [host, view] of views) if (!host.isConnected || !host.closest('.chat-pane-cache__pane--active')) { view.observer.disconnect(); view.card?.remove(); views.delete(host); }
    for (const host of document.querySelectorAll('.chat-pane-cache__pane--active .chat-thread-viewport')) {
      const key = window.__laolaoRichApi?.sessionFor(host);
      if (!key) continue;
      let view = views.get(host);
      if (!view) {
        view = {host, key, plan: null, card: null, sig: '', folded: false, userFolded: false, painted: false};
        // 重绘会把卡片冲掉：只在卡片不在了的时候才重新挂（节流）
        view.observer = new MutationObserver(() => { if (view.plan && !view.card?.isConnected) schedule(); });
        view.observer.observe(host, {childList: true, subtree: true});
        views.set(host, view); void refresh(view);
      } else if (key !== view.key) {
        view.card?.remove();
        Object.assign(view, {card: null, plan: null, key, sig: '', folded: false, userFolded: false, painted: false});
        void refresh(view);
      } else paint(view);
    }
  }
  window.addEventListener('pinkie:gateway-event', (event) => {
    const payload = event.detail?.payload;
    if (!payload) return;
    const data = payload.data || {};
    const relevant = event.detail.event === 'chat' && ['final', 'error', 'aborted'].includes(payload.state)
      || payload.stream === 'tool' && /plan_update/.test(String(data.name || data.toolName || ''));
    if (!relevant) return;
    for (const view of views.values()) if (!payload.sessionKey || payload.sessionKey === view.key) setTimeout(() => void refresh(view), 180);
  });
  window.addEventListener('popstate', schedule);
  window.addEventListener('laolao:modechange', schedule);
  setInterval(attach, 1200);
  window.__pinkiePlan = {refresh: () => { attach(); for (const view of views.values()) void refresh(view); }};
  attach();
})();
