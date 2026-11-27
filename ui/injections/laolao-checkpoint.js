/* M6: 「回到这一轮之前」。后台 pinkie.checkpoint.list / preview / restore 管快照和截对话；
   这里只给回答下方操作栏加键、弹确认框、回退后重新拉记录并回填输入框。
   不开观察器：接 laolao-session-cards.js 每次整理气泡后发的 pk-chat-turns。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.checkpoint) return;
  const LABEL = '回到这一轮之前';
  const BUSY = '先停下再回退';
  const ACTION = {modify: '改回原样', delete: '删掉（这几轮新建的）', recreate: '重新放回（这几轮删掉的）'};
  const REASON = {'too-large': '太大没存', exec: '命令行改的，事先没认出来', missing: '备份不见了', 'skipped-dir': '在跳过的目录里', outside: '在项目文件夹外面'};
  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const request = (method, params, timeout = 30_000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    return typeof rpc === 'function' ? rpc(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  async function call(method, params, timeout) {
    let result;
    try { result = await request(method, params, timeout); } catch (error) { return {ok: false, error: error?.message || ''}; }
    return result?.ok ? result : {ok: false, error: result?.error || ''};
  }
  let toastTimer = 0;
  function toast(text) {
    if (typeof window.__laolaoToast === 'function') { window.__laolaoToast(text); return; }
    let node = document.querySelector('.pinkie-ckpt-toast');
    if (!node) { node = el('div', 'pinkie-ckpt-toast'); node.setAttribute('role', 'status'); document.body.append(node); }
    node.textContent = text;
    node.dataset.show = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { delete node.dataset.show; }, 2600);
  }
  const running = pane => Boolean(pane?.state?.chatRunId || pane?.state?.chatSending || pane?.state?.chatStream);
  const readonlyKey = key => /:subagent:/i.test(key) || /:persona[:-]/i.test(key);
  const entryIdOf = item => typeof item?.__openclaw?.id === 'string' ? item.__openclaw.id : '';
  // 和 laolao-message-actions.js 同一取法：DOM 的 msg:… 只按自己的 id，或能唯一认出的 role+timestamp 对上记录。
  function historyItem(messageId, history) {
    const domId = String(messageId || '');
    if (!domId.startsWith('msg:') || !Array.isArray(history)) return null;
    const candidates = history.filter(item => {
      const direct = [item?.id, item?.messageId].filter(value => typeof value === 'string' && value);
      if (direct.length) return direct.some(value => domId === 'msg:' + value);
      if (typeof item?.timestamp !== 'number') return false;
      const prefix = `msg:${item.role || 'unknown'}:${item.timestamp}:`;
      return domId.startsWith(prefix) && /^\d+$/.test(domId.slice(prefix.length));
    });
    if (candidates.length === 1) return candidates[0];
    const send = candidates[0]?.__openclaw?.idempotencyKey;
    if (candidates.length > 1 && typeof send === 'string' && send
      && candidates.every(item => item?.__openclaw?.idempotencyKey === send)) return candidates[candidates.length - 1];
    return null;
  }

  let cache = {key: '', sig: '', turns: [], running: false, loading: null};
  function load(pane, key) {
    const sig = `${pane.state?.chatMessages?.length ?? -1}:${running(pane)}`;
    if (cache.key === key && cache.sig === sig) return cache.loading || Promise.resolve(cache);
    const next = {key, sig, turns: [], running: false, loading: null};
    cache = next;
    next.loading = call('pinkie.checkpoint.list', {sessionKey: key}, 20_000).then(result => {
      next.turns = result.ok && Array.isArray(result.turns) ? result.turns : [];
      next.running = Boolean(result.running);
      next.loading = null;
      return next;
    });
    return next.loading;
  }

  function paint(pane, key, data) {
    const byEntry = new Map();
    for (const row of data.key === key ? data.turns : []) for (const id of row.assistantEntryIds || []) byEntry.set(id, row);
    const busy = running(pane) || data.running;
    const bubbles = readonlyKey(key) ? [] : [...pane.querySelectorAll('.chat-group.assistant .chat-bubble[data-message-id]')];
    const last = new Map();
    for (const bubble of bubbles) {
      if (bubble.classList.contains('streaming') || bubble.classList.contains('chat-bubble--tool-shell')) continue;
      const entryId = entryIdOf(historyItem(bubble.dataset.messageId, pane.state?.chatMessages));
      const row = byEntry.get(entryId);
      if (row) last.set(row.turn, {bubble, entryId, row});
    }
    const slots = new Map();
    for (const item of last.values()) {
      const footer = item.bubble.closest('.chat-group')?.querySelector('.chat-group-footer');
      if (!footer) continue;
      let slot = footer.querySelector('.chat-group-footer-actions');
      if (!slot) { slot = el('div', 'chat-group-footer-actions'); footer.append(slot); }
      slots.set(item, slot);
    }
    const keep = new Set(slots.values());
    for (const node of pane.querySelectorAll('.pinkie-ckpt')) if (!keep.has(node.parentElement)) node.remove();
    for (const [{bubble, entryId, row}, slot] of slots) {
      let box = slot.querySelector(':scope > .pinkie-ckpt');
      if (!box) {
        box = el('span', 'pinkie-ckpt');
        const btn = el('button', 'pinkie-ckpt__btn', LABEL);
        btn.type = 'button';
        btn.onclick = event => { event.stopPropagation(); void open(pane, key, box.dataset.entryId, btn); };
        box.append(btn, el('span', 'pinkie-ckpt__hint', BUSY));
        slot.append(box);
      }
      if (box.dataset.messageId !== bubble.dataset.messageId) box.dataset.messageId = bubble.dataset.messageId;
      if (box.dataset.entryId !== entryId) box.dataset.entryId = entryId;
      if (box.dataset.turn !== String(row.turn)) box.dataset.turn = String(row.turn);
      const btn = box.firstChild;
      if ((btn.getAttribute('aria-disabled') === 'true') !== busy) {
        if (busy) { btn.setAttribute('aria-disabled', 'true'); btn.tabIndex = -1; box.dataset.busy = '1'; }
        else { btn.removeAttribute('aria-disabled'); btn.removeAttribute('tabindex'); delete box.dataset.busy; }
      }
    }
  }

  function fileList(title, items, render) {
    if (!items.length) return null;
    const group = el('section', 'pinkie-ckpt-group');
    group.append(el('h4', 'pinkie-ckpt-group__title', title));
    const list = el('ul', 'pinkie-ckpt-group__list');
    for (const item of items) list.append(render(item));
    group.append(list);
    return group;
  }
  function row(path, note) {
    const li = el('li', 'pinkie-ckpt-file');
    li.append(el('code', 'pinkie-ckpt-file__path', path), el('span', 'pinkie-ckpt-file__note', note));
    return li;
  }

  function confirmBox(plan) {
    return new Promise(resolve => {
      const mask = el('div', 'laolao-modal-mask pinkie-ckpt-mask');
      const box = el('div', 'laolao-modal pinkie-ckpt-modal');
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      const title = el('h3', 'laolao-modal__title', `回到第 ${plan.turn} 轮之前`);
      title.id = 'pinkie-ckpt-title';
      box.setAttribute('aria-labelledby', title.id);
      box.append(title, el('p', 'laolao-modal__body', `第 ${plan.turn} 轮和之后的对话会撤掉；这几轮里改过的文件会还原。`));
      const groups = [
        fileList('会还原', plan.restore || [], item => row(item.path, ACTION[item.action] || '改回原样')),
        fileList('之后被别处改过（勾上才覆盖）', plan.conflicts || [], item => {
          const li = row(item.path, ACTION[item.action] || '改回原样');
          const label = el('label', 'pinkie-ckpt-file__pick');
          const pick = el('input');
          pick.type = 'checkbox';
          pick.value = item.path;
          pick.setAttribute('aria-label', `覆盖 ${item.path}`);
          label.append(pick, el('span', '', '覆盖'));
          li.append(label);
          return li;
        }),
        fileList('还原不了', plan.unrecoverable || [], item => row(item.path, REASON[item.reason] || '还原不了')),
      ].filter(Boolean);
      if (groups.length) { const wrap = el('div', 'pinkie-ckpt-groups'); wrap.append(...groups); box.append(wrap); }
      if (plan.auditIncomplete?.length) box.append(el('p', 'pinkie-ckpt-note', `第 ${plan.auditIncomplete.join('、')} 轮用命令改过的文件可能没有全列出来`));
      const error = el('p', 'laolao-modal__error');
      error.setAttribute('role', 'status');
      error.hidden = true;
      const buttons = el('div', 'laolao-modal__buttons');
      const cancel = el('button', 'laolao-modal__btn', '算了');
      const ok = el('button', 'laolao-modal__btn laolao-modal__btn--danger', LABEL);
      cancel.type = ok.type = 'button';
      buttons.append(cancel, ok);
      box.append(error, buttons);
      mask.append(box);
      const done = value => { mask.remove(); document.removeEventListener('keydown', onKey, true); resolve(value); };
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!ok.disabled) done(null); return; }
        if (event.key !== 'Tab') return;
        const stops = [...box.querySelectorAll('input, button')].filter(node => !node.disabled);
        const at = stops.indexOf(document.activeElement);
        event.preventDefault();
        event.stopPropagation();
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      };
      document.addEventListener('keydown', onKey, true);
      cancel.onclick = () => done(null);
      mask.addEventListener('pointerdown', event => { if (event.target === mask && !ok.disabled) done(null); });
      ok.onclick = () => resolve({
        overwrite: [...box.querySelectorAll('input[type=checkbox]:checked')].map(node => node.value),
        busy(on) { ok.disabled = cancel.disabled = on; ok.textContent = on ? '正在回退…' : LABEL; },
        fail(text) { error.textContent = text; error.hidden = false; },
        close: () => done(null),
        retry: () => new Promise(next => { resolve = next; }),
      });
      document.body.append(mask);
      cancel.focus();
    });
  }

  async function reloadHistory(pane, key) {
    try {
      const result = await request('chat.history', {sessionKey: key, limit: 200}, 20_000);
      if (Array.isArray(result?.messages)) { pane.state.chatMessages = result.messages; pane.requestUpdate?.(); }
    } catch {}
  }
  function fillComposer(pane, text) {
    const state = pane.state;
    if (typeof state?.handleChatDraftChange === 'function') state.handleChatDraftChange(text);
    else if (state) state.chatMessage = text;
    pane.requestUpdate?.();
    requestAnimationFrame(() => pane.querySelector('.agent-chat__composer-combobox textarea')?.focus());
  }

  let opening = false;
  async function open(pane, key, assistantEntryId, btn) {
    if (btn.getAttribute('aria-disabled') === 'true' || running(pane) || opening) return;
    opening = true;
    try {
      const plan = await call('pinkie.checkpoint.preview', {sessionKey: key, assistantEntryId});
      if (!plan.ok) { toast(plan.error || '没回退成功，请稍后再试'); return; }
      if (plan.running) { toast(BUSY); return; }
      let pending = confirmBox(plan);
      for (let answer = await pending; answer; answer = await pending) {
        pending = answer.retry();
        answer.busy(true);
        const result = await call('pinkie.checkpoint.restore', {sessionKey: key, assistantEntryId, overwrite: answer.overwrite}, 60_000);
        answer.busy(false);
        if (!result.ok) { answer.fail(result.error || '没回退成功，请稍后再试'); continue; }
        answer.close();
        cache = {key: '', sig: '', turns: [], running: false, loading: null};
        await reloadHistory(pane, key);
        fillComposer(pane, typeof plan.text === 'string' ? plan.text : '');
        toast(`已回到第 ${result.turn ?? plan.turn} 轮之前，还原了 ${Number(result.restored) || 0} 个文件`);
        break;
      }
    } finally { opening = false; }
  }

  function refresh(pane, key) {
    if (!pane || !key) return;
    paint(pane, key, cache);
    void load(pane, key).then(data => { if (data === cache) paint(pane, key, data); });
  }
  document.addEventListener('pk-chat-turns', event => {
    const pane = event.target?.closest?.('openclaw-chat-pane') || event.target;
    refresh(pane, String(event.detail?.key || ''));
  });
  ns.checkpoint = {refresh};
})();
