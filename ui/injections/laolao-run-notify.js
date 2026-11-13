/* laolao-run-notify:v2 —— 看不到页面时的提醒（计划书 B 第三节，第四节的补发）
 *
 * 全 App 只有这里发「做完 / 等你回答」的系统通知（laolao-native 不再另发一条）。
 * 前两层在 设置 → 外观与声音 →「碧琪做完时提醒我」里开关；系统通知只有一处开关：
 * 设置 → 通知与快捷 的「做完时 / 等我回答时」（存在后端 pinkie.prefs.notify）。
 * 三层，逐层加强：
 *   1. 会话列表：在跑的会话名前一个粉色小圈（有进展时轻跳一下，不循环）；做完未读 = 粉点；
 *      出错或等你确认 = 感叹号。写在行上的 data-pinkie-run，样式在 laolao-run-status.css。
 *   2. 窗口标题前加「✓」「!」「?」，并请原生壳让 Dock / 任务栏图标提醒一下。
 *   3. 系统通知：只在页面看不见、而且这一轮跑了 60 秒以上时发。标题是会话名，正文是结果第一句；
 *      点通知回到那个会话。第一次需要权限时碧琪问一句，拒绝了就不再问。
 * 同一轮只提醒一次；正看着这个会话时什么都不发。
 * 断线期间结束的一轮：laolao-run-status 重连后发 pinkie:run-recovered，这里照同样的规矩补一次。 */
(() => {
  'use strict';
  if (window.__pinkieRunNotify) return;

  const PREFS_KEY = 'pinkie.runNotify.v1';
  const ASKED_KEY = 'pinkie.runNotify.permissionAsked.v1';
  const LONG_RUN_MS = 60_000;
  const SESSION = /^agent:(?:main|project|thinking|learning|unrestricted):/;
  const PREFIX = {done: '✓ ', error: '! ', ask: '? '};
  const MARK = {done: 'unread', error: 'attention', ask: 'attention'};

  const readPrefs = () => {
    try { return {list: true, title: true, system: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')}; }
    catch { return {list: true, title: true, system: true}; }
  };
  let prefs = readPrefs();
  const now = () => Date.now();
  const currentSession = () => {
    try {
      const routed = new URL(window.location.href).searchParams.get('session') || '';
      if (routed) return routed;
    } catch {}
    return document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset?.sessionKey || '';
  };
  const visible = () => !document.hidden;
  const viewing = (key) => visible() && key === currentSession();

  // 系统通知的开关在「通知与快捷」（pinkie.prefs.notify），不在本机 localStorage。
  let notifyPrefs = {done: true, waiting: true};
  const takeNotifyPrefs = (value) => {
    const n = value && typeof value === 'object' ? value.notify : null;
    if (n && typeof n === 'object') notifyPrefs = {done: n.done !== false, waiting: n.waiting !== false};
  };
  const systemWanted = (outcome, n = notifyPrefs) => (outcome === 'ask' ? n.waiting !== false : n.done !== false);

  /** Which reminders one finished (or waiting) run gets. Pure. */
  function decide({outcome, isVisible, isCurrent, durationMs, prefs: p = prefs, notify = notifyPrefs, already = false}) {
    const none = {list: null, title: null, attention: false, system: false};
    if (already) return none;
    if (isVisible && isCurrent) return none;
    const list = p.list ? MARK[outcome] || 'unread' : null;
    if (isVisible) return {...none, list};
    return {
      list,
      title: p.title ? PREFIX[outcome] || PREFIX.done : null,
      attention: Boolean(p.title),
      // 等你回答不看跑了多久：人不在就该叫一声。做完 / 出错要跑满 60 秒才发。
      system: systemWanted(outcome, notify) && (outcome === 'ask' || durationMs >= LONG_RUN_MS),
    };
  }

  // ---------- 状态 ----------
  const runs = new Map();     // sessionKey → {runId, startedAt}
  const marks = new Map();    // sessionKey → running | unread | attention
  const told = new Set();     // `${sessionKey}|${runId}`：这一轮已经提醒过
  const beats = new Map();    // sessionKey → last beat time
  let titlePrefix = '';
  let baseTitle = '';

  const rows = () => [...document.querySelectorAll('.sidebar-recent-session[data-session-key]')];
  const rowFor = (key) => rows().find((row) => row.dataset?.sessionKey === key) || null;
  const sessionName = (key) => {
    const text = String(rowFor(key)?.querySelector('.sidebar-recent-session__name')?.textContent || '').trim();
    return text || '碧琪';
  };
  function paintMarks() {
    for (const row of rows()) {
      const key = row.dataset?.sessionKey;
      const mark = prefs.list ? marks.get(key) : null;
      if (mark) { if (row.getAttribute('data-pinkie-run') !== mark) row.setAttribute('data-pinkie-run', mark); }
      else if (row.getAttribute('data-pinkie-run') !== null) row.removeAttribute('data-pinkie-run');
    }
  }
  function setMark(key, mark) {
    if (mark) marks.set(key, mark); else marks.delete(key);
    paintMarks();
  }
  function beat(key) {
    if (marks.get(key) !== 'running' || now() - (beats.get(key) || 0) < 2000) return;
    beats.set(key, now());
    const row = rowFor(key);
    if (!row) return;
    row.setAttribute('data-pinkie-beat', '1');
    window.setTimeout(() => row.removeAttribute('data-pinkie-beat'), 300);
  }

  function setTitle(prefix) {
    const current = String(document.title || '');
    const stripped = current.replace(/^[✓!?] /, '');
    if (!titlePrefix) baseTitle = stripped;
    titlePrefix = prefix || '';
    document.title = titlePrefix + (baseTitle || stripped);
  }
  function clearTitle() {
    if (!titlePrefix) return;
    titlePrefix = '';
    document.title = baseTitle || String(document.title || '').replace(/^[✓!?] /, '');
  }

  // ---------- 原生壳 ----------
  function attention(kind) {
    // Mac：WKWebView 的 laolaoWindowControl 处理 action:"attention"（需要原生加：NSApp.requestUserAttention）。
    // Windows：pywebview 的 request_attention（需要原生加：FlashWindowEx）。没有就静默。
    try { window.webkit?.messageHandlers?.laolaoWindowControl?.postMessage({action: 'attention', kind}); } catch {}
    try { window.pywebview?.api?.request_attention?.(kind); } catch {}
  }
  function openSession(key) {
    try { window.focus?.(); } catch {}
    try { window.__laolaoSidebar?.navigateSession?.(key); } catch {}
  }
  const nativeNotifier = () => window.webkit?.messageHandlers?.pinkieNotify
    || (typeof window.pywebview?.api?.notify === 'function' ? {postMessage: (m) => window.pywebview.api.notify(m)} : null);
  const webNotifier = () => (typeof window.Notification === 'function' ? window.Notification : null);
  function systemNotify(key, body) {
    const title = sessionName(key);
    const native = nativeNotifier();
    if (native) { try { native.postMessage({title, body, sessionKey: key}); return true; } catch { return false; } }
    const Web = webNotifier();
    if (!Web || Web.permission !== 'granted') return false;
    try {
      const note = new Web(title, {body, tag: 'pinkie-run-' + key, icon: './laolao-pinkie-status-done.png'});
      note.onclick = () => { openSession(key); try { note.close?.(); } catch {} };
      return true;
    } catch { return false; }
  }
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
  const BODY = {
    done: (text) => firstSentence(text) || '碧琪这一轮做完了',
    error: () => '碧琪这一轮没做完，回来看看吧',
    ask: (text) => firstSentence(text) || '碧琪在等你点头',
  };

  // ---------- 一轮结束（或停下来等你） ----------
  function settle(key, runId, outcome, text, carriedStart = 0) {
    const run = runs.get(key);
    const id = runId || run?.runId || '';
    const token = key + '|' + id;
    const already = told.has(token);
    // After a page reload this page never saw the start event: use the start time
    // laolao-run-status carried over in sessionStorage.
    const startedAt = run?.startedAt || Number(carriedStart) || 0;
    const durationMs = startedAt ? Math.max(0, now() - startedAt) : 0;
    if (outcome !== 'ask') runs.delete(key);
    if (already) { if (outcome !== 'ask' && marks.get(key) === 'running') setMark(key, viewing(key) ? null : 'unread'); return; }
    const plan = decide({outcome, isVisible: visible(), isCurrent: key === currentSession(), durationMs, prefs});
    if (viewing(key)) { if (outcome !== 'ask') setMark(key, null); hidePrompt(); return; }
    told.add(token);
    if (told.size > 200) told.delete(told.values().next().value);
    setMark(key, plan.list);
    if (plan.title) setTitle(plan.title);
    if (plan.attention) attention(outcome);
    if (plan.system) systemNotify(key, BODY[outcome](text));
  }
  function start(key, runId) {
    const run = runs.get(key);
    if (!run || (runId && run.runId && run.runId !== runId && !told.has(key + '|' + run.runId))) {
      runs.set(key, {runId: runId || '', startedAt: now()});
    } else if (runId && !run.runId) run.runId = runId;
    setMark(key, prefs.list ? 'running' : null);
  }

  const pendingEnd = new Map();
  window.addEventListener('pinkie:gateway-event', (event) => {
    const {event: name, payload} = event.detail || {};
    if (!payload) return;
    const key = String(payload.sessionKey || '');
    if (!SESSION.test(key) || /:subagent:/.test(key)) return;
    const data = payload.data || {};
    const runId = String(payload.runId || '');
    if (name === 'agent' || name === 'session.tool') {
      if (payload.stream === 'lifecycle') {
        if (data.phase === 'start') start(key, runId);
        else if (data.phase === 'error') settle(key, runId, 'error', '');
        else if (data.phase === 'end') {
          // chat final 带着回复文字，通常紧跟着到；等一下它，等不到再按「做完」提醒。
          window.clearTimeout(pendingEnd.get(key));
          const aborted = data.aborted === true || /abort|error/i.test(String(data.stopReason || ''));
          pendingEnd.set(key, window.setTimeout(() => { pendingEnd.delete(key); if (runs.has(key)) settle(key, runId, aborted ? 'error' : 'done', ''); }, 2500));
        }
        return;
      }
      if (!runs.has(key) && ['thinking', 'assistant', 'tool'].includes(payload.stream)) start(key, runId);
      if (payload.stream === 'tool' && data.phase === 'start' && String(data.name || data.toolName || '') === 'ask_user') {
        settle(key, runId, 'ask', String(data.args?.question || data.args?.prompt || ''));
      }
      beat(key);
      return;
    }
    if (/^(?:exec|plugin)\.approval\.requested$/.test(String(name))) { settle(key, runId, 'ask', '碧琪想跑一条命令，等你点头'); return; }
    if (name === 'chat' && ['final', 'error', 'aborted'].includes(payload.state)) {
      window.clearTimeout(pendingEnd.get(key)); pendingEnd.delete(key);
      if (payload.state === 'final') settle(key, runId, 'done', textOf(payload.message));
      else settle(key, runId, 'error', '');
    }
  });
  window.addEventListener('pinkie:run-recovered', (event) => {
    const {sessionKey, runId, outcome, text, startedAt} = event.detail || {};
    if (!SESSION.test(String(sessionKey || ''))) return;
    settle(sessionKey, runId, outcome === 'error' ? 'error' : 'done', text || '', startedAt);
  });

  // ---------- 回来了：清掉标题和这个会话的标记 ----------
  function viewed(key = currentSession()) {
    if (!visible()) return;
    clearTitle();
    if (key && marks.get(key) !== 'running') setMark(key, null);
  }
  document.addEventListener('visibilitychange', () => { if (visible()) viewed(); });

  // ---------- 第一次要通知权限：碧琪问一句 ----------
  // 原生壳（Mac）的权限状态由壳回报：default / granted / denied；没回报前不问。
  let nativePermission = null;
  window.__pinkieNotifyPermission = (state) => { nativePermission = String(state || ''); };
  try { window.webkit?.messageHandlers?.pinkieNotify?.postMessage({action: 'status'}); } catch {}
  function permissionPrompt() {
    if (!notifyPrefs.done && !notifyPrefs.waiting) return null;
    if (nativeNotifier()) {
      if (nativePermission !== 'default') return null;
      try { if (localStorage.getItem(ASKED_KEY)) return null; } catch {}
      return {text: '碧琪做完事，要不要敲敲你？', buttons: ['好呀', '不用了']};
    }
    const Web = webNotifier();
    if (!Web || Web.permission !== 'default') return null;
    try { if (localStorage.getItem(ASKED_KEY)) return null; } catch {}
    return {text: '碧琪做完事，要不要敲敲你？', buttons: ['好呀', '不用了']};
  }
  function answerPermission(yes) {
    try { localStorage.setItem(ASKED_KEY, yes ? 'yes' : 'no'); } catch {}
    hidePrompt();
    if (!yes) return;
    const native = window.webkit?.messageHandlers?.pinkieNotify;
    if (native) { try { native.postMessage({action: 'request-permission'}); } catch {} return; }
    try { void webNotifier()?.requestPermission?.(); } catch {}
  }
  let promptNode = null;
  function hidePrompt() { promptNode?.remove(); promptNode = null; }
  function showPrompt() {
    const ask = permissionPrompt();
    if (!ask || promptNode || typeof document.body?.append !== 'function') return;
    const anchor = document.querySelector('.agent-chat__input');
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect?.width) return;
    promptNode = document.createElement('div');
    promptNode.className = 'pk-notify-ask';
    promptNode.setAttribute('role', 'dialog');
    promptNode.setAttribute('aria-label', ask.text);
    const face = document.createElement('img'); face.src = './laolao-pinkie-status-asking.png'; face.alt = '';
    const say = document.createElement('span'); say.textContent = ask.text;
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'pk-run__btn'; yes.dataset.act = 'answer'; yes.textContent = ask.buttons[0];
    const no = document.createElement('button'); no.type = 'button'; no.className = 'pk-run__btn'; no.textContent = ask.buttons[1];
    yes.addEventListener('click', () => answerPermission(true));
    no.addEventListener('click', () => answerPermission(false));
    promptNode.append(face, say, yes, no);
    promptNode.style.left = `${Math.round(rect.left)}px`;
    promptNode.style.bottom = `${Math.round(window.innerHeight - rect.top + 46)}px`;
    document.body.append(promptNode);
  }

  // ---------- 节拍：会话列表会重画，标记按节拍补回去 ----------
  let lastKey = currentSession();
  window.setInterval(() => {
    const key = currentSession();
    if (key !== lastKey) { lastKey = key; viewed(key); }
    else if (visible() && marks.has(key) && marks.get(key) !== 'running') viewed(key);
    paintMarks();
    if (titlePrefix && !String(document.title || '').startsWith(titlePrefix)) setTitle(titlePrefix);
    const run = runs.get(key);
    if (run && visible() && now() - run.startedAt >= LONG_RUN_MS) showPrompt();
  }, 1500);
  window.addEventListener('storage', (event) => { if (event.key === PREFS_KEY) { prefs = readPrefs(); paintMarks(); } });
  window.addEventListener('pinkie:prefs-change', (event) => takeNotifyPrefs(event.detail));
  const loadNotifyPrefs = () => {
    const bridge = window.__pinkieNativeBridge;
    if (bridge?.loadPrefs) Promise.resolve(bridge.loadPrefs()).then(takeNotifyPrefs, () => {});
  };
  loadNotifyPrefs();
  window.setInterval(loadNotifyPrefs, 60_000);

  window.__pinkieRunNotify = {
    decide, viewed, permissionPrompt, answerPermission,
    get prefs() { return {...prefs}; },
    get notify() { return {...notifyPrefs}; },
    setPrefs(next) {
      prefs = {...prefs, ...next};
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
      if (!prefs.title) clearTitle();
      paintMarks();
      window.dispatchEvent(new CustomEvent('pinkie:run-notify-prefs', {detail: {...prefs}}));
    },
  };
})();
