/* PLAN §8 native bridge + N1 notifications + N2/N3 page side.
   pinkieNative(msg) → Promise: Mac posts to webkit.messageHandlers.pinkieNative
   and waits for window.__pinkieNativeReply(reqId, payload); Windows calls the
   pywebview js_api method of the same name. The page decides *when* to
   notify; the native side only shows it. */
(() => {
  'use strict';
  if (window.__pinkieNativeBridge) return;
  const pending = new Map();
  let sequence = 0;

  function hasNative() {
    return Boolean(window.webkit?.messageHandlers?.pinkieNative || window.pywebview?.api?.pinkieNative);
  }
  function pinkieNative(message, timeout = 120_000) {
    const mac = window.webkit?.messageHandlers?.pinkieNative;
    if (mac) {
      const reqId = 'n' + (++sequence) + '-' + Date.now().toString(36);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('原生端没有回应')); }, timeout);
        pending.set(reqId, value => { clearTimeout(timer); resolve(value); });
        try { mac.postMessage({...message, reqId}); }
        catch (error) { clearTimeout(timer); pending.delete(reqId); reject(error); }
      });
    }
    const win = window.pywebview?.api?.pinkieNative;
    if (typeof win === 'function') return Promise.resolve(win(message)).then(value => value || {ok: true});
    return Promise.reject(new Error('这个功能要在碧琪 App 里用'));
  }
  window.__pinkieNativeReply = (reqId, payload) => {
    const done = pending.get(reqId);
    if (!done) return;
    pending.delete(reqId);
    done(payload);
  };
  window.pinkieNative = pinkieNative;

  const request = (method, params, timeout = 15_000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    return typeof rpc === 'function' ? rpc(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  const MODE_AGENT = {chat: 'main', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'unrestricted'};
  const AGENT_MODE = Object.fromEntries(Object.entries(MODE_AGENT).map(([mode, agent]) => [agent, mode]));
  const MODE_LABEL = {chat: '唠嗑', project: '项目', thinking: '想法', learning: '学习', unrestricted: '无限制'};
  const agentOf = key => /^agent:([^:]+):/.exec(String(key || ''))?.[1] || '';
  const modeOf = key => AGENT_MODE[agentOf(key)] || '';
  const currentKey = () => new URL(location.href).searchParams.get('session') || '';
  const currentMode = () => window.__laolaoSidebar?.mode || modeOf(currentKey()) || 'chat';

  // ---------- app preferences (pinkie.prefs.*) ----------
  let prefs = null, prefsAt = 0;
  async function loadPrefs(force = false) {
    if (!force && prefs && Date.now() - prefsAt < 60_000) return prefs;
    try {
      const value = await request('pinkie.prefs.get', {});
      if (value && value.ok !== false) { prefs = value; prefsAt = Date.now(); }
    } catch {}
    return prefs || {notify: {done: true, waiting: true}, menubar: true, hotkey: null, defaultStyle: 'default'};
  }
  async function savePrefs(patch) {
    const value = await request('pinkie.prefs.set', patch);
    if (value?.ok === false) throw new Error(value.error || '没保存上');
    prefs = value; prefsAt = Date.now();
    window.dispatchEvent(new CustomEvent('pinkie:prefs-change', {detail: value}));
    return value;
  }

  // ---------- navigation used by notification clicks and the menu bar ----------
  function openSession(key) {
    if (!key) return;
    const mode = modeOf(key);
    if (mode && mode !== currentMode()) {
      // Another mode: hand the key to the mode switcher's own restore path.
      try { localStorage.setItem('laolao:last-session:' + mode, key); localStorage.setItem('laolao:active-mode', mode); } catch {}
      const next = new URL(location.href);
      next.searchParams.set('session', key);
      next.searchParams.set('laolao-switch', '1');
      location.assign(next.href);
      return;
    }
    window.__laolaoSidebar?.navigateSession?.(key);
  }
  function openSettings() {
    // The shell's own sidebar link carries the router's click handling.
    const link = document.querySelector('a[href="/settings/general"], a[href$="/settings/general"]');
    if (link) { link.click(); return; }
    location.assign('/settings/general' + location.hash);
  }

  // ---------- N1: when to notify ----------
  const LONG_RUN_MS = 20_000;
  const runs = new Map();        // runId → {sessionKey, startedAt, waiting}
  const notified = new Set();
  const titles = new Map();
  const clip = (text, n) => {
    const chars = [...String(text || '').replace(/\s+/g, ' ').trim()];
    return chars.length > n ? chars.slice(0, n).join('') + '…' : chars.join('');
  };
  const plain = text => String(text || '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s]+/gm, '').replace(/[*_~]{1,3}/g, '');
  function messageText(message) {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) return message.content.map(part => part?.type === 'text' || typeof part?.text === 'string' ? part.text || '' : '').join('');
    return typeof message.text === 'string' ? message.text : '';
  }
  function windowInFront() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }
  function shouldNotify(sessionKey) {
    if (window.__pinkieNotifyTest?.forceBackground) return true;
    return !windowInFront() || sessionKey !== currentKey();
  }
  async function sessionTitle(key) {
    if (titles.has(key)) return titles.get(key);
    let title = '';
    try {
      const listed = await request('sessions.list', {agentId: agentOf(key) || undefined, limit: 1000});
      const item = (listed?.sessions || []).find(entry => entry.key === key);
      title = item?.label || item?.displayName || item?.derivedTitle || '';
    } catch {}
    if (!title) {
      const row = [...document.querySelectorAll('.session-row-host')].find(node => node.dataset.sessionKey === key);
      title = row?.querySelector('.sidebar-recent-session__title, .pinkie-session-title')?.textContent?.trim() || '';
    }
    title = title || '会话';
    titles.set(key, title);
    return title;
  }
  // The final event carries text only; a pending ask_user lives in history.
  async function pendingQuestion(key) {
    try {
      const history = await request('chat.history', {sessionKey: key, limit: 12});
      const messages = Array.isArray(history?.messages) ? history.messages : [];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index] || {};
        if (message.role === 'user' && messageText(message).trim()) return '';
        if (/^toolresult$/i.test(String(message.role || '')) && message.toolName === 'ask_user') {
          const parsed = window.__laolaoAskUser?.parseRecord?.(messageText(message));
          return parsed?.question || '';
        }
      }
    } catch {}
    return '';
  }
  async function pendingProposal(key, runId) {
    try {
      const cards = await request('pinkie.session.cards', {key});
      const list = Array.isArray(cards?.cards) ? cards.cards : Array.isArray(cards?.items) ? cards.items : [];
      const card = list.find(item => item.kind !== 'report' && item.state === 'pending'
        && (!item.anchor || item.anchor.runId === runId));
      return card ? (card.title || '要不要开一个子会话') : '';
    } catch { return ''; }
  }
  async function send(kind, runId, sessionKey, text) {
    if (!runId || notified.has(runId)) return;
    const settings = await loadPrefs();
    const want = kind === 'waiting' ? settings.notify?.waiting !== false : settings.notify?.done !== false;
    if (!want || !shouldNotify(sessionKey)) return;
    notified.add(runId);
    if (notified.size > 400) notified.delete(notified.values().next().value);
    const title = '碧琪 · ' + await sessionTitle(sessionKey);
    const body = kind === 'waiting' ? '等你回答：' + clip(text, 60)
      : kind === 'error' ? '这轮出错了：' + clip(text || '没有说明原因', 60)
      : clip(plain(text), 80) || '这轮做完了';
    const message = {type: 'notify', id: runId, sessionKey, title, body, kind};
    window.__pinkieNotifyLog?.push(message);
    // 系统通知只走 laolao-run-notify 一个通道（它读同一份 pinkie.prefs.notify）。这里再发，
    // App 在后台跑满一轮就会弹两条。保留判断和日志给测试 / 排查用，不再真的发。
  }
  async function onChat(payload) {
    const runId = String(payload.runId || '');
    const sessionKey = String(payload.sessionKey || '');
    if (!runId || !sessionKey || /:subagent:/i.test(sessionKey)) return;
    if (!runs.has(runId)) runs.set(runId, {sessionKey, startedAt: Date.now()});
    const run = runs.get(runId);
    const state = payload.state;
    if (!['final', 'error', 'aborted'].includes(state)) return;
    runs.delete(runId);
    if (runs.size > 200) runs.delete(runs.keys().next().value);
    if (state === 'aborted' || notified.has(runId)) return;
    if (!shouldNotify(sessionKey)) return;
    if (state === 'error') { await send('error', runId, sessionKey, payload.errorMessage || payload.error || ''); return; }
    const question = run.question || await pendingQuestion(sessionKey) || await pendingProposal(sessionKey, runId);
    if (question) { await send('waiting', runId, sessionKey, question); return; }
    const elapsed = Date.now() - (run.startedAt || Date.now());
    if (elapsed >= LONG_RUN_MS || window.__pinkieNotifyTest?.minMs === 0) await send('done', runId, sessionKey, messageText(payload.message));
  }
  window.addEventListener('pinkie:gateway-event', event => {
    const {event: name, payload} = event.detail || {};
    if (!payload) return;
    if (name === 'chat') { void onChat(payload); return; }
    // Run start time: the first agent event of a run is earlier than chat deltas.
    if (name === 'agent' && payload.runId && payload.sessionKey && !runs.has(payload.runId)) {
      runs.set(payload.runId, {sessionKey: payload.sessionKey, startedAt: Date.now()});
    }
    if ((name === 'agent' || name === 'session.tool') && payload.stream === 'tool' && payload.runId) {
      const data = payload.data || {};
      if (data.name === 'ask_user' && data.phase === 'result' && data.isError !== true) {
        const run = runs.get(payload.runId);
        const record = window.__laolaoAskUser?.parseRecord?.(typeof data.result === 'string' ? data.result : messageText(data.result));
        if (run && record?.question) run.question = record.question;
      }
    }
  });

  // ---------- native → page ----------
  async function quickAsk(mode, text) {
    const agentId = MODE_AGENT[mode] || MODE_AGENT[currentMode()] || 'main';
    const key = `agent:${agentId}:dashboard:${crypto.randomUUID?.() || Date.now().toString(36)}`;
    try {
      const created = await request('sessions.create', {agentId, key, label: clip(text, 24) || '快速提问'}, 20_000);
      const sessionKey = created?.key || key;
      await request('chat.send', {sessionKey, message: text, deliver: false, idempotencyKey: 'quick-' + Date.now().toString(36)}, 30_000);
      openSession(sessionKey);
    } catch (error) {
      window.__laolaoToast?.('快速提问没发出去：' + (error?.message || '请稍后再试'));
    }
  }
  window.addEventListener('pinkie-native', event => {
    const detail = event.detail || {};
    if (detail.type === 'openSession') openSession(detail.sessionKey);
    else if (detail.type === 'newSession') window.__laolaoSidebar?.createSession?.();
    else if (detail.type === 'openSettings') openSettings();
    else if (detail.type === 'quickAsk' && detail.text) void quickAsk(detail.mode, String(detail.text));
  });

  // ---------- page → native context (menu bar running list, quick-ask mode) ----------
  let lastContext = '';
  async function pushContext() {
    if (!hasNative() || document.hidden && !lastContext) return;
    let running = [];
    try {
      const listed = await request('sessions.list', {limit: 1000}, 10_000);
      running = (listed?.sessions || [])
        .filter(item => item?.key && !/:subagent:/i.test(item.key) && (item.hasActiveRun || /^(?:running|queued)$/i.test(item.status || '')))
        .slice(0, 20).map(item => ({key: item.key, title: item.label || item.displayName || item.derivedTitle || '未命名会话'}));
    } catch { return; }
    const mode = currentMode();
    const context = {type: 'context', mode, modeLabel: MODE_LABEL[mode] || '碧琪', running};
    const signature = JSON.stringify(context);
    if (signature === lastContext) return;
    lastContext = signature;
    pinkieNative(context, 10_000).catch(() => {});
  }
  let contextTimer = 0;
  const scheduleContext = () => { clearTimeout(contextTimer); contextTimer = setTimeout(pushContext, 400); };
  window.addEventListener('pinkie:gateway-event', event => {
    const name = event.detail?.event;
    const state = event.detail?.payload?.state;
    if (name === 'sessions.changed' || name === 'chat' && state !== 'delta') scheduleContext();
  });
  window.addEventListener('laolao:modechange', scheduleContext);
  setInterval(pushContext, 15_000);
  setTimeout(pushContext, 3000);

  window.__pinkieNativeBridge = {
    pinkieNative, hasNative, loadPrefs, savePrefs, openSession, openSettings,
    shouldNotify, onChat, plain, clip, LONG_RUN_MS,
  };
})();
