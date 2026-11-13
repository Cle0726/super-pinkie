/* M1–M5: edit and resend, regenerate, version switch, copy, thumbs. The
   gateway owns the transcript tree (pinkie.chat.*); this file only decorates
   the native chat groups and reloads history after a branch change. */
(() => {
  'use strict';
  if (window.__pinkieMessageActions) return;
  const BUSY = '这轮跑完再改';
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
  const ICONS = {
    copy: '<path d="M9 9h10v10H9z"/><path d="M5 15V5h10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    up: '<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 20H7"/>',
    down: '<path d="M7 13V4H4v9zM7 13l4 8a2 2 0 0 0 2-2v-4h6a2 2 0 0 0 2-2.3l-1.3-7A2 2 0 0 0 17.7 4H7"/>',
    caret: '<path d="M7 10l5 5 5-5"/>',
  };
  function icon(name) {
    const span = el('span', 'pinkie-msg-icon');
    span.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    return span;
  }
  function button(label, iconName, onClick, className = '') {
    const node = el('button', 'pinkie-msg-btn ' + className);
    node.type = 'button';
    node.title = label;
    node.setAttribute('aria-label', label);
    if (iconName) node.append(icon(iconName));
    else node.textContent = label;
    node.onclick = event => { event.stopPropagation(); onClick?.(event); };
    return node;
  }

  let toastTimer = 0;
  function toast(text) {
    if (typeof window.__laolaoToast === 'function') { window.__laolaoToast(text); return; }
    let node = document.querySelector('.pinkie-msg-toast');
    if (!node) { node = el('div', 'pinkie-msg-toast'); node.setAttribute('role', 'status'); document.body.append(node); }
    node.textContent = text;
    node.dataset.show = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { delete node.dataset.show; }, 2600);
  }

  function activePane() {
    const panes = [...document.querySelectorAll('openclaw-chat-pane')];
    return panes.find(pane => pane.active === true) || panes[0] || null;
  }
  function currentKey(pane = activePane()) {
    if (!pane) return '';
    return new URL(location.href).searchParams.get('session') || pane.state?.sessionKey || '';
  }
  const running = pane => {
    const state = pane?.state;
    return Boolean(state?.chatRunId || state?.chatSending || state?.chatStream);
  };
  const readonlyKey = key => /:subagent:/i.test(key) || /:persona[:-]/i.test(key);
  function isChannel(key) {
    const row = [...document.querySelectorAll('.session-row-host')].find(item => item.dataset.sessionKey === key);
    return Boolean(row?.querySelector('.pinkie-session-channel'));
  }

  // The renderer numbers a paged window, so the DOM id is matched to a history
  // item by its own id, or by role+timestamp when that identifies one item.
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
    // 失败后自动重试的同一次发送：实时记录里会有两条同时间、同 idempotencyKey 的用户消息
    // （第一次尝试那条已被重试分支替掉）。取最后一条——它才在当前分支上。
    const send = candidates[0]?.__openclaw?.idempotencyKey;
    if (candidates.length > 1 && typeof send === 'string' && send
      && candidates.every(item => item?.__openclaw?.idempotencyKey === send)) return candidates[candidates.length - 1];
    return null;
  }
  const entryIdOf = item => typeof item?.__openclaw?.id === 'string' ? item.__openclaw.id : '';
  function textOf(item) {
    const content = item?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return typeof item?.text === 'string' ? item.text : '';
    return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  }
  // Plain copy: drop Markdown marks, keep the words and line breaks.
  function plainText(markdown) {
    return String(markdown || '')
      .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch {
      const area = el('textarea'); area.value = text; document.body.append(area); area.select();
      try { document.execCommand('copy'); toast('已复制'); } catch { toast('没复制成功'); }
      area.remove();
    }
  }

  // ── per-session data ──
  let session = '', variants = new Map(), ratings = {}, loadSeq = 0, lastLength = -1;
  const pendingRatings = new Map();
  async function loadMeta(key, pane) {
    const seq = ++loadSeq;
    const [v, f] = await Promise.all([
      request('pinkie.chat.variants', {key}).catch(() => null),
      request('pinkie.feedback.get', {key}).catch(() => null),
    ]);
    if (seq !== loadSeq || key !== currentKey(pane)) return;
    variants = new Map((v?.ok ? v.items : []).map(item => [item.entryId, item]));
    ratings = f?.ok ? {...(f.ratings || {})} : {};
    for (const [id, value] of pendingRatings) { if (value) ratings[id] = value; else delete ratings[id]; }
    schedule();
  }

  async function reloadHistory(pane, key, focusId = '') {
    try {
      const result = await request('chat.history', {sessionKey: key, limit: 200}, 20_000);
      if (currentKey(pane) !== key || !Array.isArray(result?.messages)) return;
      pane.state.chatMessages = result.messages;
      pane.requestUpdate?.();
    } catch {}
    await loadMeta(key, pane);
    if (!focusId) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = [...pane.querySelectorAll('.chat-bubble[data-message-id]')]
        .find(node => entryIdOf(historyItem(node.dataset.messageId, pane.state?.chatMessages)) === focusId);
      target?.scrollIntoView({block: 'center', behavior: window.__pinkieMotion?.reduce ? 'auto' : 'smooth'});
    }));
  }

  async function act(pane, key, method, params, {focus = '', reload = true} = {}) {
    if (running(pane)) { toast(BUSY); return false; }
    let result;
    try { result = await request(method, {key, ...params}, 45_000); }
    catch (error) { toast(error?.message || '没改成，请稍后再试'); return false; }
    if (!result?.ok) { toast(result?.error || '没改成，请稍后再试'); return false; }
    if (reload) await reloadHistory(pane, key, focus);
    return result;
  }

  // ── menus ──
  let openMenu = null;
  function closeMenu() { openMenu?.remove(); openMenu = null; }
  document.addEventListener('pointerdown', event => { if (openMenu && !openMenu.contains(event.target)) closeMenu(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && openMenu) { closeMenu(); event.stopPropagation(); } }, true);
  function menu(anchor, items) {
    closeMenu();
    const box = el('div', 'pinkie-msg-menu');
    box.setAttribute('role', 'menu');
    for (const item of items) {
      if (item.heading) { box.append(el('div', 'pinkie-msg-menu__heading', item.heading)); continue; }
      const row = el('button', 'pinkie-msg-menu__item', item.label);
      row.type = 'button'; row.setAttribute('role', 'menuitem');
      if (item.detail) row.append(el('span', 'pinkie-msg-menu__detail', item.detail));
      row.onclick = () => { closeMenu(); item.run(); };
      box.append(row);
    }
    document.body.append(box);
    const rect = anchor.getBoundingClientRect(), size = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, innerWidth - size.width - 8));
    const below = rect.bottom + 4 + size.height <= innerHeight - 8;
    box.style.left = left + 'px';
    box.style.top = (below ? rect.bottom + 4 : Math.max(8, rect.top - size.height - 4)) + 'px';
    openMenu = box;
    box.querySelector('button')?.focus();
  }

  async function modelMenu(anchor, pane, key, userId) {
    const catalog = window.__laolaoModelPickerCatalog;
    const agentId = (key.match(/^agent:([^:]+):/) || [])[1] || 'main';
    let models = [];
    try { models = catalog ? catalog.present(await catalog.load(agentId)) : []; } catch {}
    if (!models.length) { toast('模型目录暂时不可用'); return; }
    menu(anchor, [{heading: '用哪个模型重新回答（只这一次）'},
      ...models.slice(0, 40).map(model => ({label: model.name || model.id, detail: model.provider,
        run: () => void act(pane, key, 'pinkie.chat.regenerate', {entryId: userId, model: model.provider + '/' + model.id}, {focus: userId})}))]);
  }

  // ── inline edit (M1) ──
  function startEdit(pane, key, bubble, item) {
    if (running(pane)) { toast(BUSY); return; }
    if (bubble.querySelector('.pinkie-msg-edit')) return;
    const entryId = entryIdOf(item);
    const box = el('div', 'pinkie-msg-edit');
    const area = el('textarea', 'pinkie-msg-edit__input');
    area.value = textOf(item);
    area.rows = Math.min(12, Math.max(2, area.value.split('\n').length));
    area.setAttribute('aria-label', '修改这条消息');
    const row = el('div', 'pinkie-msg-edit__row');
    const hint = el('span', 'pinkie-msg-edit__hint', '旧的那一版会保留，可以切回去');
    const cancel = el('button', 'pinkie-msg-edit__cancel', '取消');
    const send = el('button', 'pinkie-msg-edit__send', '发送');
    cancel.type = send.type = 'button';
    row.append(hint, cancel, send);
    box.append(area, row);
    bubble.dataset.pinkieEditing = '1';
    bubble.append(box);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    const close = () => { box.remove(); delete bubble.dataset.pinkieEditing; };
    cancel.onclick = close;
    const submit = async () => {
      const text = area.value;
      if (!text.trim()) { toast('请写点内容再发送'); return; }
      send.disabled = true; send.textContent = '发送中…';
      const ok = await act(pane, key, 'pinkie.chat.edit', {entryId, text});
      if (ok) close(); else { send.disabled = false; send.textContent = '发送'; }
    };
    send.onclick = () => void submit();
    area.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    });
  }

  // ── thumbs (M5) ──
  function feedbackNote(anchor, onSave) {
    closeMenu();
    const box = el('div', 'pinkie-msg-menu pinkie-msg-feedback');
    const area = el('textarea', 'pinkie-msg-feedback__input');
    area.placeholder = '哪里不好？（可不填）';
    area.maxLength = 2000; area.rows = 3;
    const row = el('div', 'pinkie-msg-edit__row');
    const skip = el('button', 'pinkie-msg-edit__cancel', '不填了');
    const save = el('button', 'pinkie-msg-edit__send', '提交');
    skip.type = save.type = 'button';
    skip.onclick = () => { closeMenu(); onSave(''); };
    save.onclick = () => { const note = area.value; closeMenu(); onSave(note); };
    row.append(skip, save);
    box.append(area, row);
    document.body.append(box);
    const rect = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(rect.left, innerWidth - 300)) + 'px';
    box.style.top = (rect.bottom + 270 < innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 140)) + 'px';
    openMenu = box;
    area.focus();
  }
  async function rate(key, entryId, rating, note) {
    const previous = ratings[entryId];
    if (rating) ratings[entryId] = rating; else delete ratings[entryId];
    pendingRatings.set(entryId, rating);
    schedule();
    try {
      const result = await request('pinkie.feedback.record', {key, entryId, rating, ...(note ? {note} : {})});
      if (!result?.ok) throw new Error(result?.error);
      if (pendingRatings.get(entryId) === rating) pendingRatings.delete(entryId);
      if (rating) toast(rating === 'up' ? '收到，谢谢' : '记下了，谢谢');
    } catch {
      pendingRatings.delete(entryId);
      if (previous) ratings[entryId] = previous; else delete ratings[entryId];
      schedule();
      toast('没记上，请稍后再试');
    }
  }

  // ── decorate ──
  function userGroupBefore(group) {
    for (let node = group.previousElementSibling; node; node = node.previousElementSibling) {
      if (!node.classList?.contains('chat-group')) continue;
      if (node.classList.contains('user')) return node;
    }
    return null;
  }
  function lastEntryIn(group, history) {
    const bubbles = [...group.querySelectorAll('.chat-bubble[data-message-id]')];
    for (let index = bubbles.length - 1; index >= 0; index--) {
      const id = entryIdOf(historyItem(bubbles[index].dataset.messageId, history));
      if (id) return id;
    }
    return '';
  }

  function decorateUser(pane, key, bubble, history, editable, busy) {
    const item = historyItem(bubble.dataset.messageId, history);
    const entryId = entryIdOf(item);
    const signature = [entryId, editable, busy, JSON.stringify(variants.get(entryId) || null)].join('|');
    if (bubble.dataset.pinkieActions === signature) return;
    bubble.dataset.pinkieActions = signature;
    bubble.querySelector(':scope > .pinkie-msg-row')?.remove();
    if (!item) return;
    const row = el('div', 'pinkie-msg-row pinkie-msg-row--user');
    row.append(button('复制', 'copy', () => void copyText(textOf(item))));
    if (editable && entryId) {
      const edit = button('编辑', 'edit', () => startEdit(pane, key, bubble, item));
      edit.disabled = busy; if (busy) edit.title = BUSY;
      row.append(edit);
    }
    const variant = variants.get(entryId);
    if (variant && variant.total > 1) {
      const nav = el('span', 'pinkie-msg-variants');
      const go = offset => {
        const target = variant.siblings[variant.index - 1 + offset];
        if (target) void act(pane, key, 'pinkie.chat.switch', {entryId: target}, {focus: target});
      };
      const prev = button('上一版', '', () => go(-1), 'pinkie-msg-variants__step'); prev.textContent = '‹';
      const next = button('下一版', '', () => go(1), 'pinkie-msg-variants__step'); next.textContent = '›';
      prev.disabled = busy || variant.index <= 1; next.disabled = busy || variant.index >= variant.total;
      nav.append(prev, el('span', 'pinkie-msg-variants__count', `${variant.index} / ${variant.total}`), next);
      row.prepend(nav);
    }
    bubble.append(row);
  }

  function decorateAssistant(pane, key, group, history, editable, busy) {
    const userGroup = userGroupBefore(group);
    const userId = userGroup ? lastEntryIn(userGroup, history) : '';
    const ownId = lastEntryIn(group, history);
    const streaming = Boolean(group.querySelector('.chat-bubble.streaming'));
    const signature = [userId, ownId, editable, busy, streaming, ratings[ownId] || ''].join('|');
    const footer = group.querySelector('.chat-group-footer');
    if (!footer || group.dataset.pinkieActions === signature) return;
    group.dataset.pinkieActions = signature;
    footer.querySelector('.pinkie-msg-row')?.remove();
    if (streaming || !ownId) return;
    let slot = footer.querySelector('.chat-group-footer-actions');
    if (!slot) { slot = el('div', 'chat-group-footer-actions'); footer.append(slot); }
    const messages = [...group.querySelectorAll('.chat-bubble[data-message-id]')]
      .map(node => historyItem(node.dataset.messageId, history)).filter(Boolean);
    const markdown = () => messages.map(textOf).filter(Boolean).join('\n\n');
    const row = el('div', 'pinkie-msg-row pinkie-msg-row--assistant');
    if (editable && userId) {
      const retry = button('重新回答', 'retry', () => void act(pane, key, 'pinkie.chat.regenerate', {entryId: userId}, {focus: userId}));
      const more = button('换个模型重新回答', 'caret', event => void modelMenu(event.currentTarget, pane, key, userId), 'pinkie-msg-btn--caret');
      retry.disabled = more.disabled = busy;
      if (busy) retry.title = more.title = BUSY;
      const split = el('span', 'pinkie-msg-split'); split.append(retry, more);
      row.append(split);
    }
    const copy = button('复制', 'copy', () => void copyText(plainText(markdown())));
    const copyMore = button('复制方式', 'caret', event => menu(event.currentTarget, [
      {label: '复制', run: () => void copyText(plainText(markdown()))},
      {label: '复制为 Markdown', run: () => void copyText(markdown())},
    ]), 'pinkie-msg-btn--caret');
    const copySplit = el('span', 'pinkie-msg-split'); copySplit.append(copy, copyMore);
    row.append(copySplit);
    const current = ratings[ownId];
    const up = button('有帮助', 'up', () => void rate(key, ownId, current === 'up' ? null : 'up'), 'pinkie-msg-thumb');
    const down = button('不太好', 'down', event => {
      if (current === 'down') { void rate(key, ownId, null); return; }
      const anchor = event.currentTarget;
      feedbackNote(anchor, note => void rate(key, ownId, 'down', note.trim()));
    }, 'pinkie-msg-thumb');
    up.setAttribute('aria-pressed', String(current === 'up'));
    down.setAttribute('aria-pressed', String(current === 'down'));
    row.append(up, down);
    slot.append(row);
  }

  // ── 失败卡：说清楚为什么没成，给一个「换成 xx 再发一次」 ──
  // 聊天记录不保留失败原因（errorMessage 会被网关删掉），原因由插件记着：pinkie.model.failure。
  // 只装饰对话里最后一张失败卡（插件只记每个会话最近一次失败）。不改 Lit 管的文字节点：
  // 原来那句「这次回复没能完成，请稍后再试」用属性藏起来，换成我们自己的一块。
  const FAILURE_TEXT = /^\s*这次(?:回复没能完成|没连上模型)/;
  const failures = new Map();   // sessionKey → {at, data, loading}
  const FAILURE_SAY = {
    account: (m) => `「${m}」现在用不了：模型那边没有可用的账号（或额度用完了），等多久都不会好。`,
    key: (m) => `「${m}」现在用不了：模型的密钥不对或过期了。`,
    missing: (m) => `「${m}」现在用不了：模型那边找不到这个模型。`,
    busy: (m) => `「${m}」那边正忙，排队的人太多，过一会儿再发就好。`,
    timeout: (m) => `「${m}」太久没回话，这一轮先停下了。`,
    network: () => '网络断了一下，碧琪没够着模型。看看网络或代理，再发一次。',
    down: (m) => `「${m}」那边出了故障，这次没回出来。`,
    other: (m) => `这次没连上「${m}」，没能回出来。`,
  };
  async function modelNames(key) {
    const catalog = window.__laolaoModelPickerCatalog;
    const agentId = (key.match(/^agent:([^:]+):/) || [])[1] || 'main';
    try {
      const models = catalog ? catalog.present(await catalog.load(agentId)) : [];
      return new Map(models.map(model => [model.provider + '/' + model.id, model.name || model.id]));
    } catch { return new Map(); }
  }
  const shortModel = (ref, names) => names.get(ref) || String(ref || '').split('/').slice(1).join('/') || '这个模型';
  function loadFailure(pane, key) {
    const known = failures.get(key);
    if (known && (known.loading || Date.now() - known.at < 4000)) return known.data;
    failures.set(key, {at: Date.now(), data: known?.data || null, loading: true});
    Promise.all([request('pinkie.model.failure', {sessionKey: key}, 10_000).catch(() => null), modelNames(key)])
      .then(([data, names]) => {
        failures.set(key, {at: Date.now(), data: data?.failure ? {...data, names} : null, loading: false});
        schedule();
      });
    return known?.data || null;
  }
  async function switchAndResend(pane, key, userId, model, buttonNode) {
    if (running(pane)) { toast(BUSY); return; }
    buttonNode.disabled = true;
    const agentId = (key.match(/^agent:([^:]+):/) || [])[1];
    try {
      await request('sessions.patch', {key, ...(agentId ? {agentId} : {}), model}, 15_000);
    } catch (error) {
      buttonNode.disabled = false;
      toast(error?.message || '没换成模型，请稍后再试');
      return;
    }
    failures.delete(key);
    const ok = await act(pane, key, 'pinkie.chat.regenerate', {entryId: userId, model}, {focus: userId});
    if (!ok) buttonNode.disabled = false;
  }
  function decorateFailure(pane, key, thread, history, editable, busy) {
    const groups = [...thread.querySelectorAll(':scope > .chat-group')].filter(group => !group.closest('.pinkie-session-cards'));
    const last = groups[groups.length - 1];
    const bubble = last?.classList.contains('assistant') ? last.querySelector('.chat-bubble') : null;
    for (const old of thread.querySelectorAll('.chat-bubble[data-pinkie-fail]')) {
      if (old === bubble) continue;
      old.removeAttribute('data-pinkie-fail');
      old.querySelector(':scope > .pinkie-fail')?.remove();
    }
    if (!bubble || !FAILURE_TEXT.test(bubble.querySelector('.chat-text')?.textContent || '')) return;
    const info = loadFailure(pane, key);
    if (!info?.failure) return;
    const {failure, suggestion, names} = info;
    const userGroup = userGroupBefore(last);
    const userId = userGroup ? lastEntryIn(userGroup, history) : '';
    const failed = shortModel(failure.model, names);
    const say = (FAILURE_SAY[failure.kind] || FAILURE_SAY.other)(failed);
    const offer = Boolean(suggestion && editable && userId && failure.kind !== 'busy');
    const next = offer ? shortModel(suggestion, names) : '';
    const signature = [failure.at, failure.kind, suggestion, userId, busy, offer].join('|');
    if (bubble.dataset.pinkieFail === signature) return;
    bubble.dataset.pinkieFail = signature;
    bubble.querySelector(':scope > .pinkie-fail')?.remove();
    const box = el('div', 'pinkie-fail');
    box.append(el('p', 'pinkie-fail__why', say));
    if (offer) {
      const action = el('button', 'pinkie-fail__switch', `换成 ${next} 再发一次`);
      action.type = 'button';
      action.disabled = busy;
      action.title = `把这个对话的模型换成 ${next}，再把你刚才那句话发一次`;
      action.onclick = () => void switchAndResend(pane, key, userId, suggestion, action);
      box.append(action);
    } else if (failure.unusable) {
      box.append(el('p', 'pinkie-fail__hint', '在输入框右下角换一个模型，再发一次就好。'));
    }
    if (failure.reason) {
      const raw = el('details', 'pinkie-fail__raw');
      raw.append(el('summary', '', '原文'), el('code', '', failure.reason));
      box.append(raw);
    }
    bubble.append(box);
  }

  function paint() {
    frame = 0;
    const pane = activePane();
    const key = currentKey(pane);
    if (!pane || !key) return;
    if (key !== session) {
      session = key; variants = new Map(); ratings = {}; lastLength = -1; pendingRatings.clear();
    }
    const history = pane.state?.chatMessages;
    const busy = running(pane);
    const length = Array.isArray(history) ? history.length : 0;
    if (length !== lastLength && !busy) { lastLength = length; void loadMeta(key, pane); }
    const editable = !readonlyKey(key) && !isChannel(key);
    const thread = pane.querySelector('.chat-thread-inner') || pane;
    for (const bubble of thread.querySelectorAll('.chat-group.user .chat-bubble[data-message-id]')) {
      if (bubble.closest('.pinkie-session-cards') || bubble.dataset.pinkieEditing) continue;
      decorateUser(pane, key, bubble, history, editable, busy);
    }
    for (const group of thread.querySelectorAll('.chat-group.assistant')) {
      if (group.closest('.pinkie-session-cards') || group.classList.contains('chat-group--timeline-step')) continue;
      decorateAssistant(pane, key, group, history, editable, busy);
    }
    decorateFailure(pane, key, thread, history, editable, busy);
  }
  let frame = 0;
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  const observer = new MutationObserver(mutations => {
    if (mutations.every(mutation => [...mutation.addedNodes, ...mutation.removedNodes]
      .every(node => node.nodeType === 1 && node.closest?.('.pinkie-msg-row, .pinkie-msg-menu, .pinkie-msg-toast, .pinkie-msg-edit, .pinkie-fail')))) return;
    schedule();
  });
  const start = () => {
    observer.observe(document.body, {childList: true, subtree: true});
    schedule();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, {once: true});
  setInterval(schedule, 1500);

  window.__pinkieMessageActions = Object.freeze({plainText, historyItem, reloadHistory, paint: schedule, failureSay: FAILURE_SAY});
})();
