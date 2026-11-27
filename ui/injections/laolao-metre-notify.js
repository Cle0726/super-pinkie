/* laolao-metre-notify —— T3 #20（#96 L31）：Metre 后台会话做完时，侧栏完成标记 + 系统通知；点通知回到那个会话；看过了标记消失。只在 Metre 起作用。
 * main 上已有的，这里不重做：
 *   - laolao-run-notify.js：做完提醒（标题前缀 / 任务栏 / 系统通知，设置里的开关）。但它的会话正则只认五个碧琪模式，没有 metre
 *     （laolao-metre-perm.js 头注释 N1 写过），Metre 会话做完什么都不提醒。那个共用文件不改。
 *   - laolao-metre-list.js：Metre 侧栏把后台的 unread 画成会话名加粗；打开会话时原生 markSessionRead 和 laolao-session-list.js 的
 *     readCurrent 会把 unread 清掉；laolao-metre-workspace.js 的「未读」筛选也认它。
 * 这里补的：收到 Metre 会话一轮结束（chat final / error / aborted、lifecycle end、重连后的 pinkie:run-recovered），而你当时没在看它：
 *   1. sessions.patch {unread: true}：后台记下「有新结果没看」。侧栏这一行加粗，laolao-metre-notify.css 在左边记号位画一个空心圈；
 *      打开这个会话时原有的已读逻辑把 unread 清掉，标记跟着消失。
 *   2. 页面看不见时：标题前加「✓ 」（出错「! 」），任务栏 / Dock 提醒一下，这一轮跑满 60 秒再发一条系统通知。
 *      判断照 laolao-run-notify 对外的 decide()（同一套开关）；通知走同样的原生壳接口（Mac pinkieNotify / Windows pywebview notify，
 *      点了壳会调 navigateSession），网页版用 Notification，点了回到那个会话。
 * 等你批（ask）由 laolao-metre-perm.js 提醒，这里不管。不加观察器、循环定时器、window.__ 全局。 */
(() => {
  'use strict';
  const NS = (window.Pinkie = window.Pinkie || {});
  if (NS.metreNotify) return;
  const root = document.documentElement;
  const isMetre = () => root?.getAttribute?.('data-laolao-mode') === 'metre';
  const METRE = /^agent:metre:/;
  const LONG_RUN_MS = 60_000;
  const PREFIX = {done: '✓ ', error: '! '};
  const BODY = {done: 'Metre 这一轮做完了', error: 'Metre 这一轮没做完，回来看看'};
  const now = () => Date.now();
  const runs = new Map();       // sessionKey → {runId, startedAt}
  const told = new Set();       // `${sessionKey}|${runId}`：这一轮已经提醒过
  const pendingEnd = new Map();
  let titled = '';

  const currentKey = () => {
    const k = document.querySelector('openclaw-chat-pane')?.state?.sessionKey;
    if (k) return String(k);
    try { return new URL(window.location.href).searchParams.get('session') || ''; } catch { return ''; }
  };
  const sessionName = (key) => {
    const row = [...document.querySelectorAll('[data-session-key]')].find((n) => n.dataset?.sessionKey === key);
    const text = String(row?.querySelector('.sidebar-recent-session__name')?.textContent || '').trim();
    return (text.length > 30 ? text.slice(0, 29) + '…' : text) || 'Metre';
  };
  const firstSentence = (text) => {
    const clean = String(text || '').replace(/[`*_#>]+/g, '').replace(/\s+/g, ' ').trim();
    const match = /^(.+?[。！？!?](?=\s|[^。！？!?]|$))/.exec(clean);
    const sentence = (match ? match[1] : clean).trim();
    return sentence.length > 60 ? sentence.slice(0, 59) + '…' : sentence;
  };
  const textOf = (message) => {
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
    return '';
  };

  /** Which reminders this finished run gets: laolao-run-notify's decide() when it is there (same switches), else the same rules. */
  function plan(outcome, isVisible, isCurrent, durationMs) {
    const rn = window.__pinkieRunNotify;
    if (typeof rn?.decide === 'function') return rn.decide({outcome, isVisible, isCurrent, durationMs, prefs: rn.prefs, notify: rn.notify});
    if (isVisible && isCurrent) return {list: null, title: null, attention: false, system: false};
    if (isVisible) return {list: 'unread', title: null, attention: false, system: false};
    return {list: 'unread', title: PREFIX[outcome] || PREFIX.done, attention: true, system: durationMs >= LONG_RUN_MS};
  }

  function markUnread(key) {
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (typeof rpc !== 'function') return;
    Promise.resolve()
      .then(() => rpc('sessions.patch', {key, agentId: 'metre', unread: true}, 10_000))
      .then(() => window.dispatchEvent(new CustomEvent('laolao:sessions-changed')), () => {});
  }
  function setTitle(prefix) {
    const base = String(document.title || '').replace(/^[✓!?] /, '');
    document.title = prefix + base;
    titled = prefix;
  }
  function clearTitle() {
    if (titled && String(document.title || '').startsWith(titled)) document.title = String(document.title).slice(titled.length);
    titled = '';
  }
  function attention(kind) {
    try { window.webkit?.messageHandlers?.laolaoWindowControl?.postMessage({action: 'attention', kind}); } catch {}
    try { window.pywebview?.api?.request_attention?.(kind); } catch {}
  }
  function openSession(key) {
    try { window.focus?.(); } catch {}
    window.dispatchEvent(new CustomEvent('pinkie:open-session-in-mode', {detail: {sessionKey: key}}));
  }
  function systemNotify(key, body) {
    const title = sessionName(key);
    const native = window.webkit?.messageHandlers?.pinkieNotify
      || (typeof window.pywebview?.api?.notify === 'function' ? {postMessage: (m) => window.pywebview.api.notify(m)} : null);
    if (native) { try { native.postMessage({title, body, sessionKey: key}); } catch {} return; }
    const Web = typeof window.Notification === 'function' ? window.Notification : null;
    if (!Web || Web.permission !== 'granted') return;
    try {
      const note = new Web(title, {body, tag: 'pinkie-metre-done-' + key});
      note.onclick = () => { openSession(key); try { note.close?.(); } catch {} };
    } catch {}
  }

  function settle(key, runId, outcome, text = '', carriedStart = 0) {
    const run = runs.get(key);
    const token = key + '|' + (runId || run?.runId || '');
    runs.delete(key);
    if (told.has(token) || !isMetre()) return null;
    const visible = !document.hidden, current = key === currentKey();
    if (visible && current) return null;
    told.add(token);
    if (told.size > 200) told.delete(told.values().next().value);
    const startedAt = run?.startedAt || Number(carriedStart) || 0;
    const p = plan(outcome, visible, current, startedAt ? Math.max(0, now() - startedAt) : 0);
    if (p.list) markUnread(key);
    if (p.title) setTitle(PREFIX[outcome] || PREFIX.done);
    if (p.attention) attention(outcome);
    if (p.system) systemNotify(key, outcome === 'error' ? BODY.error : firstSentence(text) || BODY.done);
    return p;
  }
  function start(key, runId) {
    const run = runs.get(key);
    if (!run || (runId && run.runId && run.runId !== runId)) runs.set(key, {runId: runId || '', startedAt: now()});
    else if (runId && !run.runId) run.runId = runId;
  }

  window.addEventListener('pinkie:gateway-event', (event) => {
    const {event: name, payload} = event.detail || {};
    const key = String(payload?.sessionKey || '');
    if (!METRE.test(key) || /:subagent:/.test(key)) return;
    const data = payload.data || {};
    const runId = String(payload.runId || '');
    if (name === 'agent' || name === 'session.tool') {
      if (payload.stream === 'lifecycle') {
        if (data.phase === 'start') start(key, runId);
        else if (data.phase === 'error') settle(key, runId, 'error');
        else if (data.phase === 'end') {
          // chat final 带着回复文字，通常紧跟着到；等它一下，等不到再按「做完」算。
          window.clearTimeout(pendingEnd.get(key));
          const aborted = data.aborted === true || /abort|error/i.test(String(data.stopReason || ''));
          pendingEnd.set(key, window.setTimeout(() => { pendingEnd.delete(key); if (runs.has(key)) settle(key, runId, aborted ? 'error' : 'done'); }, 2500));
        }
      } else if (!runs.has(key) && ['thinking', 'assistant', 'tool'].includes(payload.stream)) start(key, runId);
      return;
    }
    if (name === 'chat' && ['final', 'error', 'aborted'].includes(payload.state)) {
      window.clearTimeout(pendingEnd.get(key)); pendingEnd.delete(key);
      settle(key, runId, payload.state === 'final' ? 'done' : 'error', payload.state === 'final' ? textOf(payload.message) : '');
    }
  });
  window.addEventListener('pinkie:run-recovered', (event) => {
    const {sessionKey, runId, outcome, text, startedAt} = event.detail || {};
    if (!METRE.test(String(sessionKey || ''))) return;
    settle(String(sessionKey), runId, outcome === 'error' ? 'error' : 'done', text || '', startedAt);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) clearTitle(); });

  NS.metreNotify = Object.freeze({settle, plan});
})();
