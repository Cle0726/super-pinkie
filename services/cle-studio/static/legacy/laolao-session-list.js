/* C.le. 侧边栏 · 会话列表
   原文件：ui/injections/laolao-session-list.js
   原实现把分组接进原生侧栏（移动 Lit 渲染的行、包装 WebSocket 嗅探事件）。新版改为：
   - 自己读出当前模式的会话（原生 sessions.list，含归档分页）；
   - 只在自己的容器里渲染，不碰原生句柄，原生列表由 CSS 隐藏；
   - 增删改都走原生接口，并在每次变更后重新拉取，让列表与原生会话状态一致；
   - 模式取自 document.documentElement.dataset.cleRoom（雅叙/营造/堇思/习作/挥洒）。 */
(() => {
  'use strict';
  if (window.__cleSidebar) return;

  /* ---------- 基础 ---------- */
  const BOOT_AT = Date.now();
  const el = (tag, cls = '', text = '') => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== '') n.textContent = text; return n; };
  const button = (text, label, action, cls = '') => {
    const b = el('button', 'cle-sb-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
    if (action) b.addEventListener('click', action);
    return b;
  };
  const iconButton = (icon, label, action, cls = '') => {
    const b = el('button', 'cle-sb-icobtn' + (cls ? ' ' + cls : ''));
    b.type = 'button'; b.innerHTML = icon; b.title = label; b.setAttribute('aria-label', label);
    b.addEventListener('click', action);
    return b;
  };
  const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const ICONS = {
    pin: svg('<path d="M9 4h6l1 6 3 3v2H5v-2l3-3z"/><path d="M12 15v6"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>'),
    archive: svg('<path d="M4 7h16v12H4z"/><path d="M3 4h18v3H3zM9 11h6"/>'),
    restore: svg('<path d="M4 11a8 8 0 1 0 2-5.3L4 8"/><path d="M4 3v5h5"/>'),
    chevron: svg('<path d="M6 9l6 6 6-6"/>'),
    close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
    grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>'),
    more: svg('<path d="M9 6l6 6-6 6"/>'),
    broom: svg('<path d="M15 3l6 6-4 1-6-6z"/><path d="M11 4l-7 7 9 9 7-7"/><path d="M5 12l7 7"/>'),
    rename: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>'),
  };
  const host = () => window.CLE?.host;
  const request = (method, params, timeoutMs = 15000) => {
    // Native calls go through the host (it refreshes the native session caches after a
    // mutation); the legacy gwRequest is only a fallback when the host is not there.
    if (host()?.request) return host().request(method, params || {});
    const gw = window.__laolaoSidebar?.gwRequest;
    if (gw) return gw(method, params, timeoutMs);
    return Promise.reject(new Error('gateway unavailable'));
  };

  /* ---------- 模式 ---------- */
  const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];
  const MODE_AGENT = {chat: 'main', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'unrestricted'};
  const AGENT_MODE = Object.fromEntries(Object.entries(MODE_AGENT).map(([mode, agent]) => [agent, mode]));
  const MODE_ZH = {chat: '雅叙', project: '营造', thinking: '堇思', learning: '习作', unrestricted: '挥洒'};
  const currentMode = () => {
    const mode = document.documentElement.dataset.cleRoom;
    return MODES.includes(mode) ? mode : 'chat';
  };
  const modeForSession = (key) => AGENT_MODE[String(key || '').match(/^agent:([^:]+):/)?.[1]] || null;
  const currentAgent = () => MODE_AGENT[currentMode()];
  const currentKey = () => host()?.sessions?.selectedKey || window.__laolaoSidebar?.currentSessionKey?.() || '';

  const selectedKeyFor = (agentId) => {
    const key = currentKey();
    return key && key.startsWith('agent:' + agentId + ':') ? key : '';
  };

  /* ---------- 每个模式的本地状态 ---------- */
  const storageKey = (mode) => `laolao.sidebar.v2.${mode}`;
  const MIGRATION_KEY = 'laolao.sidebar.v2.migrated';
  const emptyState = () => ({pins: [], projects: {}, projectFolders: {}, collapsed: {}});
  const normalizeState = (value) => ({
    pins: Array.isArray(value?.pins) ? value.pins.filter((k) => typeof k === 'string') : [],
    projects: value?.projects && typeof value.projects === 'object'
      ? Object.fromEntries(Object.entries(value.projects).map(([name, keys]) => [name, Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []]))
      : {},
    projectFolders: value?.projectFolders && typeof value.projectFolders === 'object'
      ? Object.fromEntries(Object.entries(value.projectFolders).filter(([, p]) => typeof p === 'string' && p))
      : {},
    collapsed: value?.collapsed && typeof value.collapsed === 'object' ? value.collapsed : {},
  });
  const readModeState = (mode) => {
    try { const raw = localStorage.getItem(storageKey(mode)); return raw ? normalizeState(JSON.parse(raw)) : emptyState(); }
    catch { return emptyState(); }
  };
  const writeModeState = (mode, value) => { try { localStorage.setItem(storageKey(mode), JSON.stringify(value)); } catch {} };
  const migrateLegacyState = () => {
    try {
      if (localStorage.getItem(MIGRATION_KEY) === '1') return;
      const fallback = currentMode();
      const byMode = Object.fromEntries(MODES.map((m) => [m, readModeState(m)]));
      const raw = localStorage.getItem('laolao.sidebar.v1');
      if (raw) {
        const legacy = normalizeState(JSON.parse(raw));
        for (const key of legacy.pins) { const m = modeForSession(key) || fallback; if (!byMode[m].pins.includes(key)) byMode[m].pins.push(key); }
        for (const [name, keys] of Object.entries(legacy.projects)) {
          for (const key of keys) { const m = modeForSession(key) || fallback; byMode[m].projects[name] = byMode[m].projects[name] || []; if (!byMode[m].projects[name].includes(key)) byMode[m].projects[name].push(key); }
          if (!keys.length) byMode[fallback].projects[name] = byMode[fallback].projects[name] || [];
        }
        for (const m of MODES) byMode[m].collapsed = {...legacy.collapsed, ...byMode[m].collapsed};
      }
      for (const m of MODES) writeModeState(m, byMode[m]);
      localStorage.setItem(MIGRATION_KEY, '1');
    } catch {}
  };
  migrateLegacyState();
  let stateMode = currentMode();
  let state = readModeState(stateMode);
  const save = () => writeModeState(stateMode, state);
  const syncModeState = () => {
    const next = currentMode();
    if (next === stateMode) return false;
    stateMode = next; state = readModeState(stateMode); query = ''; archived = false; loaded.delete(next);
    return true;
  };
  const projectOf = (key) => {
    for (const [name, keys] of Object.entries(state.projects)) if (keys.includes(key)) return name;
    return null;
  };

  /* ---------- 浮层：菜单 / 输入 / 弹窗 / 提示 ---------- */
  let activeMenu = null;
  function closeMenu() { if (activeMenu) { activeMenu.remove(); activeMenu = null; } }
  document.addEventListener('pointerdown', (event) => {
    if (activeMenu && !activeMenu.contains(event.target) && !event.target.closest?.('[data-cle-sb-anchor]')) closeMenu();
  }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); }, true);

  function openMenu(anchor, build) {
    closeMenu();
    anchor.setAttribute?.('data-cle-sb-anchor', '');
    const menu = el('div', 'cle-sb-menu');
    menu.setAttribute('role', 'menu');
    build(menu);
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - menuRect.width, innerWidth - menuRect.width - 8));
    const below = rect.bottom + 6;
    const top = below + menuRect.height <= innerHeight - 8 ? below : Math.max(8, rect.top - menuRect.height - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    activeMenu = menu;
    return menu;
  }

  function menuItem(menu, icon, label, onClick, options = {}) {
    const btn = el('button', 'cle-sb-menu__item' + (options.danger ? ' cle-sb-menu__item--danger' : '') + (options.checked ? ' is-checked' : ''));
    btn.type = 'button'; btn.setAttribute('role', 'menuitem');
    btn.innerHTML = (icon || '') + '<span></span>';
    btn.querySelector('span').textContent = label;
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!options.keepOpen) closeMenu();
      const {keepOpen, ...rest} = options;
      try { await onClick(rest); } catch (error) { toast(error?.message || '操作失败，请稍后再试'); }
    });
    menu.appendChild(btn);
    return btn;
  }
  function menuDivider(menu) { const d = el('div', 'cle-sb-menu__divider'); menu.appendChild(d); return d; }

  function showNameInput(menu, {value = '', placeholder = '名称，回车确认', onSubmit}) {
    menu.innerHTML = '';
    const input = el('input', 'cle-sb-input');
    input.placeholder = placeholder; input.value = value; input.setAttribute('aria-label', placeholder);
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') { closeMenu(); return; }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const name = input.value.trim();
      if (!name || input.disabled) return;
      input.disabled = true;
      try { await onSubmit(name); } finally { closeMenu(); }
    });
    menu.appendChild(input);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  function showModal({title, body, dangerText = '确认', busyText = '处理中…', onConfirm}) {
    const mask = el('div', 'cle-sb-mask');
    mask.innerHTML = `<div class="cle-sb-modal" role="dialog" aria-modal="true"><h3 class="cle-sb-modal__title"></h3><p class="cle-sb-modal__body"></p><p class="cle-sb-modal__error" role="status" hidden></p><div class="cle-sb-modal__buttons"><button type="button" class="cle-sb-btn" data-act="cancel">取消</button><button type="button" class="cle-sb-btn cle-sb-btn--danger" data-act="ok"></button></div></div>`;
    mask.querySelector('.cle-sb-modal__title').textContent = title;
    mask.querySelector('.cle-sb-modal__body').textContent = body;
    const okBtn = mask.querySelector('[data-act="ok"]');
    const errorEl = mask.querySelector('.cle-sb-modal__error');
    okBtn.textContent = dangerText;
    mask.querySelector('[data-act="cancel"]').addEventListener('click', () => mask.remove());
    mask.addEventListener('pointerdown', (event) => { if (event.target === mask) mask.remove(); });
    mask.addEventListener('keydown', (event) => { if (event.key === 'Escape') mask.remove(); });
    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true; okBtn.textContent = busyText; errorEl.hidden = true;
      try { await onConfirm(); mask.remove(); }
      catch (error) { errorEl.textContent = error?.message || '操作失败，请稍后再试'; errorEl.hidden = false; okBtn.disabled = false; okBtn.textContent = dangerText; }
    });
    document.body.appendChild(mask);
    okBtn.focus({preventScroll: true});
    return mask;
  }

  let toastTimer = null;
  function toast(text) {
    if (!text) return;
    let node = document.querySelector('.cle-sb-toast');
    if (!node) { node = el('div', 'cle-sb-toast'); node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); document.body.appendChild(node); }
    node.textContent = text;
    requestAnimationFrame(() => node.classList.add('is-show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-show'), 2800);
  }
  window.__cleToast = toast;
  window.addEventListener('laolao:toast', (event) => { const message = event?.detail?.message; if (typeof message === 'string' && message.trim()) toast(message); });

  /* ---------- 文件夹 ---------- */
  const folderRequests = new Map();
  window.__laolaoProjectFolderResult = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const pending = folderRequests.get(payload.requestId);
    if (!pending) return;
    folderRequests.delete(payload.requestId);
    clearTimeout(pending.timer);
    pending.resolve(payload);
  };
  function requestNativeFolder(path) {
    const bridge = window.webkit?.messageHandlers?.laolaoProjectFolder;
    if (!bridge) return chooseFolderDialog(path);
    const requestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { folderRequests.delete(requestId); toast('文件夹选择没有响应，先生再试一次吧'); resolve(null); }, 120000);
      folderRequests.set(requestId, {resolve, timer});
      bridge.postMessage({action: 'choose', requestId, path: path || ''});
    });
  }
  function revealNativeFolder(path) {
    const bridge = window.webkit?.messageHandlers?.laolaoProjectFolder;
    if (!bridge || !path) return toast('这个项目还没有关联文件夹');
    bridge.postMessage({action: 'reveal', path});
  }
  function chooseFolderDialog(value) {
    return new Promise((resolve) => {
      const mask = el('div', 'cle-sb-mask');
      const dialog = el('form', 'cle-sb-modal');
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      dialog.append(
        el('h3', 'cle-sb-modal__title', '选择项目文件夹'),
        el('p', 'cle-sb-modal__body', '浏览器不能直接取得本机文件夹路径。粘贴完整路径即可；App 内仍可使用系统选择器。'),
      );
      const input = el('input', 'cle-sb-input');
      input.value = value || ''; input.placeholder = '/完整路径/项目文件夹'; input.setAttribute('aria-label', '项目文件夹完整路径');
      const error = el('p', 'cle-sb-modal__error'); error.setAttribute('role', 'status'); error.hidden = true;
      dialog.append(input, error);
      const actions = el('div', 'cle-sb-modal__buttons');
      const finish = (result) => { mask.remove(); resolve(result); };
      const cancel = button('取消', '取消选择文件夹', () => finish(null));
      const ok = el('button', 'cle-sb-btn cle-sb-btn--primary', '使用这个文件夹'); ok.type = 'submit';
      actions.append(cancel, ok); dialog.append(actions); mask.append(dialog); document.body.append(mask);
      dialog.addEventListener('submit', async (event) => {
        event.preventDefault(); ok.disabled = true;
        try {
          const result = await request('pinkie.project.validate', {path: input.value.trim()});
          finish({path: result.path, name: result.path.split('/').filter(Boolean).pop()});
        } catch (e) { error.textContent = e.message; error.hidden = false; ok.disabled = false; }
      });
      mask.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(null); });
      setTimeout(() => input.focus(), 0);
    });
  }

  /* ---------- 会话数据 ---------- */
  const loaded = new Map(); // mode -> {rows, archivedRows, at}
  let loading = 0;
  let revision = 0, signature = '';
  let query = '', archived = false, limit = 30, projectsOnly = false;
  // The rows on screen when the list was last drawn; the delete actions default to these.
  let visibleRows = [];
  // Keys the last authoritative list contained; the 20 s poll uses it to notice deletions.
  let knownKeys = new Set();
  let refreshNotice = '';
  let deleteFilter = null; // debug/test only: narrows the delete actions, never widens them

  const extractSessions = (payload) => {
    const arr = Array.isArray(payload) ? payload : payload?.sessions || payload?.items || payload?.results || [];
    return arr.map((it) => {
      const key = it?.key || it?.sessionKey;
      const parsed = typeof key === 'string' ? key.match(/^agent:([^:]+):/) : null;
      return {
        key, agentId: it?.agentId || parsed?.[1], sessionId: it?.sessionId,
        label: it?.label, archived: !!it?.archived, pinned: !!it?.pinned,
        name: it?.displayName || it?.title || it?.derivedTitle || it?.label || it?.name,
        derivedTitle: it?.derivedTitle, displayName: it?.displayName, title: it?.title,
        updatedAt: it?.updatedAt || it?.lastActivityAt || it?.createdAt || 0,
        classification: it?.classification, isMain: !!it?.isMain,
      };
    }).filter((s) => typeof s.key === 'string' && s.key && !s.key.includes(':subagent:'));
  };

  const inflight = new Map();          // mode → the fetch already running for it
  let retryTimer = 0, failing = false;
  function fetchMode(mode, options = {}) {
    // one request per mode at a time: a render that happens while a fetch is pending waits for it
    if (!options.force && inflight.has(mode)) return inflight.get(mode);
    const run = fetchModeNow(mode, options).finally(() => { if (inflight.get(mode) === run) inflight.delete(mode); });
    inflight.set(mode, run);
    return run;
  }
  async function fetchModeNow(mode, {force = false, notice = ''} = {}) {
    const agentId = MODE_AGENT[mode];
    if (notice && mode === stateMode) refreshNotice = notice;
    const cache = loaded.get(mode);
    if (!force && cache && Date.now() - cache.at < 8000) return cache;
    const version = revision;
    loading++;
    try {
      const [active, archivedList] = await Promise.all([
        request('sessions.list', {agentId, archived: false, includeDerivedTitles: true, limit: 1000}),
        request('sessions.list', {agentId, archived: true, includeDerivedTitles: true, limit: 1000}).catch(() => ({sessions: []})),
      ]);
      const nextKeys = new Set([...extractSessions(active), ...extractSessions(archivedList)].map((s) => s.key));
      const gone = [...knownKeys].filter((key) => !nextKeys.has(key) && key.startsWith(`agent:${agentId}:`));
      if (knownKeys.size) {
        if (gone.length) {
          // The same session was deleted elsewhere: drop pins/groups and let the native side re-route.
          for (const key of gone) removeSessionFromState(key);
          const wasOpen = selectedKeyFor(agentId);
          if (gone.includes(wasOpen)) { refreshNotice = '当前会话已在别处删除，已为你打开一个新会话'; following = null; void followAfterLeaves(wasOpen, projectOf(wasOpen)); }
        } else if (cache) {
          const before = JSON.stringify((cache.rows || []).map((s) => [s.key, s.label, s.updatedAt]));
          const after = JSON.stringify(extractSessions(active).filter((s) => s.agentId === agentId).map((s) => [s.key, s.label, s.updatedAt]));
          if (before !== after) refreshNotice = '会话列表已更新';
        }
      }
      if (mode === stateMode) knownKeys = nextKeys;
      const rows = extractSessions(active).filter((s) => s.agentId === agentId);
      const archivedRows = extractSessions(archivedList).filter((s) => s.agentId === agentId)
        .map((s) => ({...s, archived: true})); // sessions.list(archived:true) omits archivedAt
      failing = false;
      if (version === revision || !cache) loaded.set(mode, {rows, archivedRows, at: Date.now()});
      return loaded.get(mode);
    } catch (error) {
      if (cache) { cache.error = error.message; cache.at = Date.now(); return cache; }
      // Remember the failure as an (empty) cache entry. Without it renderNow() saw "no cache",
      // fetched again, the request failed again at once, and finally{} rendered again: a microtask
      // loop that froze the page for as long as the gateway was away (and after it came back).
      // The entry ages out like any cache, so the next render after 8s retries once.
      const failed = {rows: [], archivedRows: [], at: Date.now(), error: error.message, failed: true};
      loaded.set(mode, failed);
      // and come back for it: once the entry has aged, re-render, which fetches it again
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (loaded.get(mode) === failed) { loaded.delete(mode); signature = ''; schedule(); } }, 8000);
      if (!failing) toast('会话列表暂未刷新：' + error.message);   // once per outage, not every retry
      failing = true;
      return failed;
    } finally {
      loading = Math.max(0, loading - 1);
      signature = '';
      renderNow();
    }
  }

  const placeholderTitle = (value, key = '', sessionId = '') => {
    const text = String(value || '').trim();
    if (!text) return true;
    if (/^(?:(?:.+?)\s*·\s*)?(?:新会话(?:\s*\d+)?|会话\s*\d+)$/i.test(text)) return true;
    if (/^[0-9a-f]{8}\b/i.test(text)) return true;
    return [String(key || '').split(':').pop(), String(sessionId || '')].filter(Boolean).some((id) => {
      const short = id.slice(0, 8);
      return text === id || text === short || text === short + '…' || text.startsWith(short + ' (');
    });
  };
  const isPlaceholderRow = (s) => {
    if (!s) return true;
    return ['label', 'name', 'derivedTitle', 'displayName'].every((field) => typeof s[field] !== 'string' || placeholderTitle(s[field], s.key, s.sessionId));
  };
  const title = (s) => {
    if (!s) return '';
    const label = typeof s.label === 'string' ? s.label.trim() : '';
    if (label && !placeholderTitle(label, s.key, s.sessionId) && !/^agent:/.test(label)) return label;
    return [s.derivedTitle, s.displayName, s.name, label].find((v) => typeof v === 'string' && v.trim() && !/^agent:/.test(v) && !placeholderTitle(v, s.key, s.sessionId))
      || label || (s.key?.endsWith(':main') ? '主会话' : '新会话');
  };
  const rowOf = (key) => {
    const cache = loaded.get(stateMode);
    if (!cache) return null;
    return cache.rows.find((s) => s.key === key) || cache.archivedRows.find((s) => s.key === key) || null;
  };
  function invalidate(forceFetch = true) {
    revision++;
    signature = '';
    if (forceFetch) { loaded.delete(stateMode); void fetchMode(stateMode, true); }
    renderNow();
  }

  /* ---------- 自动命名（原实现的「新会话」自动改成第一句话） ---------- */
  const autoTitlePending = new Set(), autoTitleDone = new Set();
  const autoTitleQueue = [];
  let autoTitleRunning = false;
  const messageText = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((p) => typeof p === 'string' ? p : (p?.type === 'text' || p?.type === 'input_text' ? p.text || p.content || '' : '')).join(' ');
    if (value && typeof value === 'object') return messageText(value.content ?? value.text ?? value.message ?? '');
    return '';
  };
  const autoTitleFromText = (value) => {
    const cleaned = messageText(value).replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ')
      .replace(/[\u200B-\u200D\u2060\u2063\u2064\uFEFF]/g, ' ').replace(/^\s*(?:[#>*-]|\d+[.)])\s*/gm, '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    const sentence = cleaned.split(/[。！？!?\n]/, 1)[0].trim() || cleaned;
    return sentence.length > 28 ? sentence.slice(0, 27).trim() + '…' : sentence;
  };
  async function maybeAutoTitle(key, message) {
    const next = autoTitleFromText(message);
    const mode = modeForSession(key);
    if (!next || !mode || key.endsWith(':main') || autoTitlePending.has(key) || autoTitleDone.has(key)) return false;
    autoTitlePending.add(key);
    try {
      const listed = await request('sessions.list', {agentId: MODE_AGENT[mode], limit: 1000});
      const row = extractSessions(listed).find((item) => item.key === key);
      if (!row || !isPlaceholderRow(row)) { autoTitleDone.add(key); return false; }
      await request('sessions.patch', {key, agentId: MODE_AGENT[mode], label: next});
      autoTitleDone.add(key);
      if (mode === stateMode) invalidate();
      return true;
    } catch (error) {
      if (!/label already in use/i.test(String(error?.message || ''))) return false;
      try { await request('sessions.patch', {key, agentId: MODE_AGENT[mode], label: `${next} · ${String(key).slice(-4)}`}); autoTitleDone.add(key); if (mode === stateMode) invalidate(); return true; }
      catch { return false; }
    } finally {
      autoTitlePending.delete(key);
    }
  }
  async function drainAutoTitles() {
    if (autoTitleRunning) return;
    autoTitleRunning = true;
    try {
      while (autoTitleQueue.length) {
        const entry = autoTitleQueue.shift();
        const key = typeof entry === 'string' ? entry : entry.key;
        const agentId = modeForSession(key) ? MODE_AGENT[modeForSession(key)] : '';
        if (!key || !agentId || autoTitleDone.has(key) || autoTitlePending.has(key) || key.endsWith(':main')) continue;
        try {
          let user = null;
          for (const offset of [0, 12, 24, 36]) {
            const history = await request('chat.history', {sessionKey: key, agentId, limit: 12, offset, maxChars: 16000});
            const messages = Array.isArray(history?.messages) ? history.messages : Array.isArray(history?.items) ? history.items : [];
            user = messages.find((item) => String(item?.role || item?.message?.role || '').toLowerCase() === 'user' && autoTitleFromText(item.message ?? item));
            if (user || messages.length < 12) break;
          }
          if (user) await maybeAutoTitle(key, user.message ?? user);
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    } finally { autoTitleRunning = false; }
  }
  function queueAutoTitles(rows = []) {
    for (const row of rows) {
      if (!row?.key || row.key.endsWith(':main') || autoTitleDone.has(row.key) || autoTitlePending.has(row.key)) continue;
      if (!isPlaceholderRow(row)) continue;
      // Only sessions this page created (or the open one without a title) may be renamed.
      const isNewHere = (row.updatedAt || 0) >= BOOT_AT - 60_000;
      if (!isNewHere && row.key !== currentKey()) continue;
      if (autoTitleQueue.some((e) => (typeof e === 'string' ? e : e.key) === row.key)) continue;
      autoTitleQueue.push({key: row.key, at: row.updatedAt || 0});
    }
    if (autoTitleQueue.length) void drainAutoTitles();
  }

  /* ---------- 原生动作 ---------- */
  const navigateSession = (key) => {
    const agentId = String(key).match(/^agent:([^:]+):/)?.[1];
    if (!agentId) return;
    host()?.sessions?.open?.({sessionKey: key, agentId});
  };
  const activePane = () => document.querySelector('openclaw-app-shell')?.context?.activePane
    || document.querySelector('openclaw-app-shell')?.activePane
    || document.querySelector('.chat-pane.is-active, .chat-pane--active, .shell-chat-pane:not([hidden])')?.dataset?.sessionKey
    || '';

  const guard = (key) => { if (modeForSession(key) !== stateMode) throw new Error('请回到该会话所属的模式再操作'); };
  async function patchSession(key, changes) {
    guard(key);
    const agentId = MODE_AGENT[modeForSession(key)];
    const row = rowOf(key);
    const params = {key, agentId, ...changes};
    if ((typeof changes.archived === 'boolean' || 'snoozedUntil' in changes) && row?.sessionId && !params.expectedSessionId) params.expectedSessionId = row.sessionId;
    const result = await request('sessions.patch', params);
    invalidate();
    return result;
  }
  function removeSessionFromState(key) {
    state.pins = state.pins.filter((item) => item !== key);
    for (const name of Object.keys(state.projects)) state.projects[name] = (state.projects[name] || []).filter((item) => item !== key);
    save();
  }

  async function createSession(name = null, options = {}) {
    const agentId = currentAgent();
    const ownerMode = stateMode, ownerState = state;
    let label = options.label || (name ? `${name} · 新会话` : '新会话');
    const labelTaken = async (value) => {
      try {
        const listed = await request('sessions.list', {agentId, limit: 1000});
        return extractSessions(listed).some((s) => s.label === value);
      } catch { return false; }
    };
    if (await labelTaken(label)) label = `${label} ${String(Date.now()).slice(-3)}`;
    let created = null;
    for (let attempt = 0; attempt < 4 && !created; attempt++) {
      try { created = await request('sessions.create', {agentId, label}, 20000); }
      catch (error) {
        if (!/label already in use/i.test(String(error?.message || ''))) throw error;
        label = `${label} ${String(Date.now()).slice(-3)}`;
      }
    }
    if (!created?.key) throw new Error('新建会话没有返回会话 key');
    if (name) {
      if (!ownerState.projectFolders[name]) throw new Error('请先为「' + name + '」选择项目文件夹');
      await request('pinkie.project.bind', {key: created.key, path: ownerState.projectFolders[name], name});
      if (!ownerState.projects[name]) ownerState.projects[name] = [];
      if (!ownerState.projects[name].includes(created.key)) ownerState.projects[name].push(created.key);
      writeModeState(ownerMode, ownerState);
    }
    loaded.delete(agentIdToMode(agentId));
    navigateSession(created.key);
    invalidate();
    toast(name ? `已在「${name}」中新建会话` : '已新建会话');
    return created.key;
  }
  const agentIdToMode = (agentId) => AGENT_MODE[agentId] || 'chat';

  // A single-flight task: several triggers in one tick must not create two sessions.
  let following = null;
  function followAfterLeaves(key, projectName) {
    if (currentKey() !== key) return Promise.resolve();
    if (following) return following;
    const project = projectName === undefined ? projectOf(key) : projectName;
    following = (async () => {
      try { await createSession(project && state.projectFolders[project] ? project : null); }
      catch (error) { toast('记录已处理，但新会话创建失败：' + (error?.message || '请手动点新会话')); }
    })().finally(() => { following = null; });
    return following;
  }
  async function archiveSession(key) {
    await patchSession(key, {archived: true});
    await followAfterLeaves(key);
    toast('已归档；记录、项目绑定和文件都保留');
  }
  async function restoreSession(key) {
    await patchSession(key, {archived: false});
    toast('会话已恢复，原记录和项目绑定都保留');
  }
  async function deleteSession(key, options = {}) {
    guard(key);
    const mode = modeForSession(key);
    const project = projectOf(key);
    const row = rowOf(key);
    const params = {key, agentId: MODE_AGENT[mode], deleteTranscript: true};
    if (row?.sessionId) params.expectedSessionId = row.sessionId;
    await request('sessions.delete', params, 30000);
    removeSessionFromState(key);
    invalidate();
    if (!options.silentFollowUp) {
      // The native router still points at the deleted key: move it to a live session.
      await followAfterLeaves(key, project);
    }
    return key;
  }
  function askDeleteSession(key, label) {
    showModal({
      title: '删除会话',
      body: `确定删除「${label}」吗？聊天记录会一起删除，项目文件夹里的真实文件不会被动。此操作不可撤销。`,
      dangerText: '确认删除',
      busyText: '删除中…',
      onConfirm: () => deleteSession(key),
    });
  }

  function sessionMenu(anchor, key, label, isArchived = false) {
    openMenu(anchor, (menu) => {
      if (isArchived) {
        menuItem(menu, ICONS.restore, '恢复会话', async () => { await restoreSession(key); });
        menuDivider(menu);
        menuItem(menu, ICONS.trash, '永久删除…', () => askDeleteSession(key, label), {danger: true});
        return;
      }
      menuItem(menu, ICONS.rename, '重命名会话…', () => showNameInput(menu, {
        value: label, placeholder: '会话名称，回车保存',
        onSubmit: async (name) => {
          try { await patchSession(key, {label: name}); toast('会话名称已保存'); }
          catch (error) { toast(/label already in use/i.test(error.message) ? '已有同名会话，请换一个名称' : error.message); }
        },
      }), {keepOpen: true});
      menuItem(menu, ICONS.pin, state.pins.includes(key) ? '取消置顶' : '置顶会话', () => togglePin(key));
      menuItem(menu, ICONS.folder, '归入项目…', () => openProjectMenu(anchor, key), {keepOpen: true});
      menuItem(menu, ICONS.archive, '归档会话（保留记录）', async () => { await archiveSession(key); });
      menuDivider(menu);
      menuItem(menu, ICONS.trash, '删除会话和记录…', () => askDeleteSession(key, label), {danger: true});
    });
  }

  async function togglePin(key) {
    guard(key);
    const pinned = !state.pins.includes(key);
    const row = rowOf(key);
    const params = {key, agentId: MODE_AGENT[modeForSession(key)], pinned};
    if (row?.sessionId) params.expectedSessionId = row.sessionId;
    try { await request('sessions.patch', params); }
    catch (error) { toast('置顶未保存：' + error.message); return; }
    const i = state.pins.indexOf(key);
    if (pinned && i < 0) state.pins.push(key);
    if (!pinned && i >= 0) state.pins.splice(i, 1);
    save(); invalidate();
    toast(pinned ? '已置顶' : '已取消置顶');
  }

  /* ---------- 项目 ---------- */
  function uniqueProjectName(base) {
    const clean = String(base || '新项目').trim() || '新项目';
    if (!state.projects[clean]) return clean;
    let n = 2; while (state.projects[`${clean} ${n}`]) n += 1;
    return `${clean} ${n}`;
  }
  async function addFolderProject(existingName, options = {}) {
    const ownerMode = stateMode;
    if (existingName && state.projectFolders[existingName] && state.projects[existingName]?.length) {
      toast('已有会话的项目目录固定不变。换目录请新建项目，避免混用记录。');
      return null;
    }
    const folder = await requestNativeFolder(existingName ? state.projectFolders[existingName] : '');
    if (!folder || folder.cancelled || !folder.path) return null;
    if (stateMode !== ownerMode) { toast('模式已切换，未把文件夹添加到其他模式'); return null; }
    let path = folder.path;
    try { path = (await request('pinkie.project.validate', {path})).path; }
    catch (error) { toast('文件夹未添加：' + error.message); return null; }
    if (stateMode !== ownerMode) { toast('模式已切换，未把文件夹添加到其他模式'); return null; }
    const duplicate = Object.entries(state.projectFolders).find(([name, p]) => p === path && name !== existingName);
    if (duplicate) { toast(`这个文件夹已经是「${duplicate[0]}」`); return duplicate[0]; }
    let projectName = existingName;
    if (existingName) { state.projectFolders[existingName] = path; toast(`「${existingName}」已换成新的文件夹`); }
    else {
      projectName = uniqueProjectName(folder.name || path.split('/').filter(Boolean).pop());
      state.projects[projectName] = state.projectFolders[projectName] ? state.projects[projectName] || [] : [];
      state.projectFolders[projectName] = path;
      state.collapsed.__projects = false;
      toast(`已添加文件夹项目「${projectName}」`);
    }
    save(); invalidate(false);
    const key = currentKey();
    if (options.bindCurrent && !existingName && projectName && modeForSession(key) === ownerMode && !projectOf(key)) {
      await assignToProject(key, projectName);
      window.dispatchEvent(new CustomEvent('pinkie:project-scope-changed', {detail: {key, path}}));
    }
    return projectName;
  }
  async function copyProjectPath(name) {
    const path = state.projectFolders[name];
    if (!path) return;
    try { await navigator.clipboard.writeText(path); toast('项目路径已复制'); }
    catch { toast(path); }
  }
  function renameProject(oldName, requestedName) {
    const newName = String(requestedName || '').trim();
    if (!newName || newName === oldName) return;
    if (state.projects[newName]) return toast(`已经有一个「${newName}」了`);
    state.projects[newName] = state.projects[oldName] || [];
    delete state.projects[oldName];
    if (state.projectFolders[oldName]) { state.projectFolders[newName] = state.projectFolders[oldName]; delete state.projectFolders[oldName]; }
    const collapsedKey = `proj:${oldName}`;
    if (collapsedKey in state.collapsed) { state.collapsed[`proj:${newName}`] = state.collapsed[collapsedKey]; delete state.collapsed[collapsedKey]; }
    save(); invalidate(false);
    toast(`项目已改名为「${newName}」`);
  }
  function removeProject(name) {
    delete state.projects[name];
    delete state.projectFolders[name];
    delete state.collapsed[`proj:${name}`];
    save(); invalidate(false);
    toast(`已移除「${name}」，里面的会话仍然保留`);
  }
  function deleteProjectWithSessions(anchor, name) {
    const keys = [...(state.projects[name] || [])];
    const rows = keys.map(rowOf).filter(Boolean);
    const archivedKeys = rows.filter((r) => r.archived).map((r) => r.key);
    const liveKeys = rows.filter((r) => !r.archived).map((r) => r.key);
    showModal({
      title: `删除项目「${name}」`,
      body: `会移除这个项目分组，并删除其中的 ${keys.length} 个会话和聊天记录（归档中的 ${archivedKeys.length} 个也会永久删除）。${state.projectFolders[name] ? '项目文件夹里的真实文件不会被动。' : ''}此操作不可撤销。`,
      dangerText: '删除项目与记录',
      busyText: '正在删除…',
      onConfirm: async () => {
        const failed = [];
        for (const key of [...liveKeys, ...archivedKeys]) {
          try { await deleteSession(key, {silentFollowUp: true}); }
          catch (error) { failed.push(error.message); }
        }
        removeProject(name);
        if (failed.length) throw new Error(`已删除其余会话，${failed.length} 个未能删除：${failed[0]}`);
        toast(`已删除项目「${name}」及其 ${keys.length} 个会话`);
        closeMenu();
      },
    });
  }
  function openProjectSettings(anchor, name) {
    openMenu(anchor, (menu) => {
      const path = state.projectFolders[name];
      const info = el('div', 'cle-sb-menu__path', path || '仅会话分组 · 尚未选择文件夹');
      info.title = path || '';
      menu.appendChild(info);
      if (path) {
        menuItem(menu, ICONS.external, '在 Finder 中显示', () => revealNativeFolder(path));
        menuItem(menu, ICONS.copy, '复制文件夹路径', () => copyProjectPath(name));
      }
      menuItem(menu, ICONS.folder, path ? '重新选择文件夹…' : '选择文件夹…', async () => { await addFolderProject(name); });
      menuItem(menu, ICONS.plus, '重命名项目…', () => showNameInput(menu, {value: name, onSubmit: (next) => renameProject(name, next)}), {keepOpen: true});
      menuDivider(menu);
      menuItem(menu, ICONS.trash, '删除项目与记录…', () => deleteProjectWithSessions(anchor, name), {danger: true});
      menuItem(menu, ICONS.close, '移除项目（保留会话）', () => removeProject(name));
    });
  }
  function openProjectMenu(anchor, key) {
    openMenu(anchor, (menu) => {
      const current = projectOf(key);
      const names = Object.keys(state.projects);
      for (const name of names) {
        menuItem(menu, ICONS.folder, name === current ? `${name}（当前）` : name, async () => {
          if (name !== current) await assignToProject(key, name);
        }, {checked: name === current});
      }
      if (names.length) menuDivider(menu);
      menuItem(menu, ICONS.plus, '添加文件夹项目…', async () => {
        const ownerMode = stateMode;
        const name = await addFolderProject();
        if (name && stateMode === ownerMode) await assignToProject(key, name);
      });
      if (current) menuItem(menu, ICONS.close, '移出项目', () => assignToProject(key, null));
    });
  }
  async function assignToProject(key, name) {
    if (modeForSession(key) !== stateMode) { toast('这个会话属于其他模式，不能放进当前项目'); return; }
    const ownerMode = stateMode, ownerState = state;
    try {
      const current = await request('pinkie.project.bind', {key, path: null});
      if (current.binding && (!name || ownerState.projectFolders[name] !== current.binding.root)) throw new Error('这个会话已有固定项目。请在目标项目中新建会话。');
      if (name) {
        if (!ownerState.projectFolders[name]) throw new Error('请先给这个分组选择文件夹');
        await request('pinkie.project.bind', {key, path: ownerState.projectFolders[name], name});
      }
    } catch (error) { toast(error.message); return; }
    if (stateMode !== ownerMode) { toast('模式已切换，请回原模式重新操作'); return; }
    for (const keys of Object.values(state.projects)) { const i = keys.indexOf(key); if (i >= 0) keys.splice(i, 1); }
    if (name) { (state.projects[name] = state.projects[name] || []).push(key); toast(`已归入「${name}」`); }
    else toast('已移出项目');
    save(); invalidate(false);
  }

  /* ---------- 一键清理 / 全部删除 ----------
     两者都只作用于「列表里看得见的会话」：当前列表按搜索/归档页过滤，
     再叠加 options.filter（测试或只清理某一类时使用）。filter 只会缩小范围，不会扩大。 */
  const safeFilter = (filter) => (s) => { try { return !!filter(s); } catch { return false; } };
  const scope = (options = {}) => {
    const filter = typeof options.filter === 'function' ? safeFilter(options.filter)
      : typeof deleteFilter === 'function' ? safeFilter(deleteFilter) : null;
    const visible = new Set(visibleRows);
    // 列表还没画出来时没有可见集合，退回当前模式的全部会话。
    const inScope = visible.size === 0 ? null : (s) => visible.has(s.key);
    return {filter, inScope};
  };
  async function cleanupSessions(options = {}) {
    const agentId = currentAgent();
    const {filter, inScope} = scope(options);
    const match = (s) => (!filter || filter(s)) && (!inScope || inScope(s));
    const keep = new Set([selectedKeyFor(agentId), ...state.pins]);
    for (const keys of Object.values(state.projects)) for (const k of keys || []) keep.add(k);
    const [active, archivedList] = await Promise.all([
      request('sessions.list', {agentId, archived: false, limit: 1000}),
      request('sessions.list', {agentId, archived: true, limit: 1000}),
    ]);
    const all = [...extractSessions(active), ...extractSessions(archivedList)];
    const seen = new Set();
    const targets = all.filter((s) => s.agentId === agentId && !keep.has(s.key) && !seen.has(s.key) && seen.add(s.key) && match(s));
    if (!targets.length) { toast('没有需要清理的会话'); return {deleted: [], failed: []}; }
    const deleted = [], failed = [];
    for (let i = 0; i < targets.length; i += 5) {
      const batch = targets.slice(i, i + 5);
      const results = await Promise.all(batch.map(async (s) => {
        try {
          const params = {key: s.key, agentId, deleteTranscript: true};
          if (s.sessionId) params.expectedSessionId = s.sessionId;
          await request('sessions.delete', params, 30000);
          return {ok: true, key: s.key};
        } catch (error) { return {ok: false, key: s.key, error: error.message}; }
      }));
      for (const r of results) (r.ok ? deleted : failed).push(r.key);
    }
    for (const key of deleted) removeSessionFromState(key);
    invalidate();
    const current = selectedKeyFor(agentId);
    if (deleted.includes(current)) await createSession(null);
    toast(`清理完成：删除 ${deleted.length} 个会话${failed.length ? `，${failed.length} 个失败` : ''}（当前、置顶、项目内会话已保留）`);
    return {deleted, failed};
  }
  function askCleanup(options = {}) {
    showModal({
      title: '一键清理会话记录',
      body: `只清理${MODE_ZH[stateMode]}列表里未整理的会话及聊天记录；其他模式不会受影响。当前打开、置顶和项目内会话都会保留。此操作不可撤销，确定继续吗？`,
      dangerText: '确认清理',
      busyText: '清理中…',
      onConfirm: () => cleanupSessions(options),
    });
  }

  async function deleteAllSessions(options = {}) {
    const agentId = currentAgent();
    const {filter, inScope} = scope(options);
    const current = selectedKeyFor(agentId);
    const currentProject = projectOf(current);
    const [active, archivedRows] = await Promise.all([
      request('sessions.list', {agentId, archived: false, limit: 1000}),
      request('sessions.list', {agentId, archived: true, limit: 1000}),
    ]);
    const all = new Map();
    for (const item of [...extractSessions(active), ...extractSessions(archivedRows)]) {
      if (item.agentId === agentId && item.key !== `agent:${agentId}:main` && !all.has(item.key)) all.set(item.key, item);
    }
    const targets = [...all.values()].filter((s) => (!filter || filter(s)) && (!inScope || inScope(s)));
    if (!targets.length) { toast(visibleRows.length ? '当前列出的会话里没有可删除的普通会话' : '当前模式没有可删除的普通会话'); return {deleted: [], failed: []}; }
    const deleted = [], failed = [];
    for (let i = 0; i < targets.length; i += 5) {
      const results = await Promise.all(targets.slice(i, i + 5).map(async (item) => {
        try {
          const params = {key: item.key, agentId, deleteTranscript: true};
          if (item.sessionId) params.expectedSessionId = item.sessionId;
          await request('sessions.delete', params, 30000);
          return true;
        } catch { return false; }
      }));
      results.forEach((ok, index) => (ok ? deleted : failed).push(targets[i + index].key));
    }
    for (const key of deleted) removeSessionFromState(key);
    invalidate();
    if (deleted.includes(current)) await createSession(currentProject && state.projectFolders[currentProject] ? currentProject : null);
    toast(`已删除 ${deleted.length} 个会话和记录${failed.length ? `，${failed.length} 个未能删除` : ''}`);
    return {deleted, failed};
  }
  function askDeleteAllSessions(options = {}) {
    showModal({
      title: '删除当前模式全部会话',
      body: visibleRows.length
        ? `列表里列出的普通会话和聊天记录会一次删除；其他模式、主会话以及项目文件夹里的真实文件不会被动。此操作不可撤销。`
        : `当前模式的普通会话和聊天记录会一次删除；其他模式、主会话以及项目文件夹里的真实文件不会被动。此操作不可撤销。`,
      dangerText: '全部删除',
      busyText: '正在批量删除…',
      onConfirm: () => deleteAllSessions(options),
    });
  }

  /* ---------- 导航（更多菜单里的原生页面） ---------- */
  const NATIVE_PAGES = [
    {match: /^\/chat\/main\/?$/, zh: '首页'},
    {match: /^\/agents(?:-home)?\/?$/, zh: '智能体'},
    {match: /^\/dashboards\/?$/, zh: '仪表盘'},
    {match: /^\/systems\/?$/, zh: '系统'},
    {match: /^\/automations\/?$|^\/cron\/?$/, zh: '自动化'},
    {match: /^\/plugins\/?$/, zh: '插件'},
    {match: /logbook/i, zh: 'Logbook'},
    {match: /workboard|workboards/i, zh: '工作看板'},
    {match: /^\/settings\/?$/, zh: '设置'},
  ];
  function nativePages() {
    const seen = new Set();
    const pages = [];
    for (const a of document.querySelectorAll('.sidebar-nav a[href]')) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || seen.has(href)) continue;
      if (a.closest('[data-session-key], .sidebar-recent-session') || /[?&]session=|^\/chat\/[^/]+\/./.test(href)) continue; // a session row, not a page
      seen.add(href);
      const zh = NATIVE_PAGES.find((p) => p.match.test(a.pathname || href))?.zh || a.textContent.trim();
      pages.push({href, zh});
    }
    // Native destinations that have no fixed sidebar entry are still reachable here.
    const extra = [
      {href: '/settings', zh: '设置'},
      {href: '/settings/usage', zh: '用量'},
      {href: '/settings/devices', zh: '设备'},
    ];
    for (const page of extra) {
      if (pages.some((p) => p.href === page.href)) continue;
      pages.push(page);
    }
    return pages;
  }
  function navigateNative(href) {
    // The native router owns drawer cleanup and pane switching; a plain anchor is the safest.
    const a = el('a');
    a.href = href;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------- 渲染 ---------- */
  const root = el('div', 'cle-sb');
  root.id = 'cle-sidebar';
  root.dataset.cleRoot = '1';
  let mounted = false;

  function mount() {
    const sidebar = document.querySelector('aside.sidebar');
    const brand = sidebar?.querySelector('.sidebar-brand');
    if (!sidebar || !brand) return;
    if (root.parentElement !== sidebar || root.previousElementSibling !== brand) {
      brand.insertAdjacentElement('afterend', root);
      document.documentElement.setAttribute('data-cle-sidebar', '1');
      mounted = true;
      signature = '';
      renderNow();
    }
  }

  function row(s) {
    const n = el('div', 'cle-sb-row');
    n.dataset.sessionKey = s.key;
    n.classList.toggle('is-active', s.key === selectedKeyFor(currentAgent()));
    n.setAttribute('role', 'listitem');
    const link = el('button', 'cle-sb-row__main');
    link.type = 'button';
    link.title = title(s);
    link.setAttribute('aria-current', s.key === selectedKeyFor(currentAgent()) ? 'true' : 'false');
    link.append(el('span', 'cle-sb-row__name', title(s)));
    if (state.pins.includes(s.key)) {
      const pin = el('span', 'cle-sb-row__pin'); pin.innerHTML = ICONS.pin; pin.setAttribute('aria-hidden', 'true');
      link.append(pin);
    }
    link.addEventListener('click', () => navigateSession(s.key));
    const dots = iconButton(ICONS.dots, '管理会话：' + title(s), (event) => sessionMenu(event.currentTarget, s.key, title(s), !!s.archived), 'cle-sb-row__menu');
    dots.setAttribute('aria-haspopup', 'menu');
    n.append(link, dots);
    return n;
  }

  function group(id, labelText, rows, options = {}) {
    const hooks = options.hooks || null;
    const n = el('section', 'cle-sb-group');
    n.dataset.group = id;
    const collapsed = !!state.collapsed[id];
    n.classList.toggle('is-collapsed', collapsed);
    const head = el('div', 'cle-sb-group__head');
    const toggle = el('button', 'cle-sb-group__toggle');
    toggle.type = 'button';
    toggle.innerHTML = ICONS.chevron;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? `展开${labelText}` : `收起${labelText}`;
    toggle.setAttribute('aria-label', toggle.title);
    const flip = () => { state.collapsed[id] = !state.collapsed[id]; save(); invalidate(false); };
    toggle.addEventListener('click', flip);
    const label = el('button', 'cle-sb-group__label', labelText);
    label.type = 'button'; label.title = `折叠或展开${labelText}`;
    label.addEventListener('click', flip);
    if (options.folder) label.classList.add('is-folder');
    head.append(toggle, label, el('span', 'cle-sb-group__count', rows.length ? String(rows.length) : ''));
    for (const action of options.actions || []) head.append(action);
    n.append(head);
    if (options.folderOnly) return n;
    if (hooks && options.groupable) hooks.groups.push({id, name: options.name || '', node: n});
    if (!collapsed) {
      const list = el('div', 'cle-sb-group__list');
      list.setAttribute('role', 'list');
      for (const s of rows) list.append(row(s));
      if (!rows.length) list.append(el('div', 'cle-sb-group__empty', options.empty || '暂无会话'));
      n.append(list);
      if (options.path) { const p = el('div', 'cle-sb-group__path', options.path.replace(/^\/Users\/[^/]+/, '~')); p.title = options.path; n.append(p); }
    }
    return n;
  }

  function renderSearch(container) {
    const wrap = el('label', 'cle-sb-search' + (projectsOnly ? ' is-hidden' : ''));
    const icon = el('span', 'cle-sb-search__icon'); icon.innerHTML = ICONS.search;
    const input = el('input', 'cle-sb-search__input');
    input.type = 'search'; input.value = query;
    input.placeholder = `搜索${MODE_ZH[stateMode]}的会话`;
    input.setAttribute('aria-label', `搜索${MODE_ZH[stateMode]}的会话`);
    input.addEventListener('input', () => { query = input.value; signature = ''; renderNow(); });
    wrap.append(icon, input);
    container.append(wrap);
  }

  function renderBar(container) {
    const bar = el('div', 'cle-sb-bar');
    const archiveBtn = button(archived ? '返回' : '归档', archived ? '返回进行中的会话' : '查看已归档会话', () => { archived = !archived; limit = 30; invalidate(false); }, 'cle-sb-btn--quiet');
    archiveBtn.dataset.action = 'archive-toggle';
    const projectBtn = button('项目', '查看项目文件夹', () => { projectsOnly = !projectsOnly; invalidate(false); }, 'cle-sb-btn--quiet');
    projectBtn.dataset.action = 'projects-view';
    projectBtn.setAttribute('aria-pressed', String(projectsOnly));
    projectBtn.classList.toggle('is-on', projectsOnly);
    const all = button('全部删除', '删除当前模式的全部普通会话和聊天记录', () => askDeleteAllSessions(), 'cle-sb-btn--quiet cle-sb-btn--danger');
    all.dataset.action = 'delete-all';
    bar.append(archiveBtn, projectBtn, el('span', 'cle-sb-bar__grow'), all);
    container.append(bar);
  }

  function renderNav(container) {
    const nav = el('div', 'cle-sb-nav');
    const moreBtn = el('button', 'cle-sb-nav__item');
    moreBtn.type = 'button';
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.dataset.action = 'more';
    moreBtn.innerHTML = ICONS.more + '<span>更多</span>';
    moreBtn.title = '更多：系统页面与侧栏清除';
    moreBtn.addEventListener('click', (event) => {
      moreBtn.setAttribute('aria-expanded', 'true');
      openMenu(moreBtn, (menu) => {
        const pages = nativePages();
        if (pages.length) {
          for (const page of pages) menuItem(menu, ICONS.grid, page.zh, () => navigateNative(page.href));
          menuDivider(menu);
        }
        menuItem(menu, ICONS.broom, '一键清理会话记录', () => askCleanup());
        menuItem(menu, ICONS.archive, archived ? '返回进行中的会话' : '查看已归档会话', () => { archived = !archived; limit = 30; invalidate(false); });
        menuItem(menu, ICONS.close, '清除侧栏（回到原生）', () => {
          document.documentElement.setAttribute('data-cle-sidebar-off', '1');
          toast('已切回原生侧栏；再点「更多 › 恢复侧栏」即可打开');
        });
        menuItem(menu, ICONS.more, '恢复侧栏', () => {
          document.documentElement.removeAttribute('data-cle-sidebar-off');
          schedule();
          toast('侧栏已恢复');
        });
      });
      event.currentTarget.blur?.();
      setTimeout(() => moreBtn.setAttribute('aria-expanded', String(!!activeMenu)), 0);
    });
    // The 更多 entry hides with the block; this small escape hatch stays while the sidebar is off.
    restorePanel();
    // sessions.changed can arrive twice for one delete; coalesce refreshes.
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { signature = ''; void fetchMode(stateMode, true); }, 220);
    nav.append(moreBtn);
    container.append(nav);
  }

  function renderList(container) {
    const cache = loaded.get(stateMode);
    const rows = (archived ? cache?.archivedRows : cache?.rows) || [];
    const q = query.toLowerCase();
    const filtered = rows.filter((s) => !q || title(s).toLowerCase().includes(q)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // 全部删除 / 一键清理 act on these rows. A debug filter narrows them; it never widens.
    visibleRows = filtered.map((s) => s.key);
    const groups = el('div', 'cle-sb-groups');
    const hooks = {groups: []};
    const folderHead = group('__projects-head', '项目文件夹', [], {
      folderOnly: true,
      actions: [(() => { const b = button('＋ 打开文件夹', '选择文件夹并建立项目', () => addFolderProject(null, {bindCurrent: true}), 'cle-sb-btn--ghost'); b.dataset.action = 'open-folder'; return b; })()],
    });
    if (archived) {
      groups.append(group('__archive', '已归档', filtered, {empty: cache ? '没有归档的会话' : '正在读取…'}));
      container.append(groups);
      return;
    }
    if (projectsOnly) {
      // Only the project folders, in project order; the same markup as the list below.
      groups.dataset.mode = 'projects-only';
      for (const name of Object.keys(state.projects)) groups.append(projectGroup(name, () => true, hooks));
      groups.append(folderHead);
      container.append(groups);
      return;
    }
    const pinned = filtered.filter((s) => state.pins.includes(s.key));
    if (pinned.length) groups.append(group('__pins', '置顶', pinned));

    const assigned = new Set();
    for (const [name, keys] of Object.entries(state.projects)) {
      for (const k of keys) assigned.add(k);
      if (query && !keys.some((k) => filtered.some((s) => s.key === k)) && !name.toLowerCase().includes(q)) continue;
      projectGroup(name, (s) => keys.includes(s.key) && !state.pins.includes(s.key), hooks);
    }
    // One 项目文件夹 heading with its groups inside: 最近 follow only if there are projects.
    if (hooks.groups.length) {
      const wrap = el('div', 'cle-sb-projects');
      wrap.dataset.group = '__projects';
      wrap.append(folderHead);
      for (const entry of hooks.groups) wrap.append(entry.node);
      groups.append(wrap);
    }
    const recent = filtered.filter((s) => !assigned.has(s.key) && !state.pins.includes(s.key));
    groups.append(group('__recent', '最近', recent.slice(0, limit), {empty: cache ? '暂无会话，点「新会话」开始' : '正在读取…'}));
    if (recent.length > limit) {
      groups.append(button('显示更多会话', '显示更多当前模式会话', () => { limit += 30; invalidate(false); }, 'cle-sb-btn--ghost cle-sb-more-btn'));
    }
    container.append(groups);
  }

  function projectGroup(name, rowFilter, hooks) {
    const cache = loaded.get(stateMode);
    const rows = (((cache?.rows) || []).filter(rowFilter)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const add = button('', `在项目「${name}」中新建会话`, async () => { try { await createSession(name); } catch (error) { toast('新建失败：' + error.message); } }, 'cle-sb-icobtn');
    add.innerHTML = ICONS.plus;
    const settings = button('', `管理项目「${name}」`, (event) => openProjectSettings(event.currentTarget, name), 'cle-sb-icobtn');
    settings.innerHTML = ICONS.dots;
    const actions = [add, settings];
    if (state.projectFolders[name]) {
      const open = button('', `在 Finder 中打开项目「${name}」`, () => revealNativeFolder(state.projectFolders[name]), 'cle-sb-icobtn');
      open.innerHTML = ICONS.external;
      actions.unshift(open);
    }
    return group('proj:' + name, name, rows, {folder: !!state.projectFolders[name], actions, path: state.projectFolders[name], empty: '点 ＋ 开始一个会话', hooks, groupable: true, name});
  }

  const restorePanel = () => {
    let restore = document.querySelector('#cle-sidebar-restore');
    const off = document.documentElement.hasAttribute('data-cle-sidebar-off');
    if (restore) { restore.style.display = off ? 'inline-flex' : 'none'; return; }
    if (!off) return;
    restore = button('', '恢复 C.le. 侧栏', () => {
      document.documentElement.removeAttribute('data-cle-sidebar-off');
      document.querySelector('#cle-sidebar-restore')?.remove();
      renderNow();
    }, 'cle-sb-restore');
    restore.id = 'cle-sidebar-restore';
    restore.innerHTML = ICONS.more;
    restore.style.display = 'inline-flex';
    document.body.appendChild(restore);
  };

  function renderNow() {
    restorePanel();
    if (!mounted) { mount(); return; }
    syncModeState();
    if (!state.projects && !loaded.get(stateMode)) void fetchMode(stateMode);
    const cache = loaded.get(stateMode);
    const next = JSON.stringify([stateMode, archived, projectsOnly, query, limit, cache?.rows || [], cache?.archivedRows || [], state.pins, state.projects, state.projectFolders, state.collapsed, selectedKeyFor(currentAgent()), currentMode()]);
    if (next === signature && !refreshNotice) return;
    signature = next;
    const scroll = root.querySelector('.cle-sb-scroll');
    const keepScroll = scroll ? scroll.scrollTop : 0;
    const focusedRow = document.activeElement?.closest?.('.cle-sb-row')?.dataset?.sessionKey || '';
    const searchInput = root.querySelector('.cle-sb-search__input');
    const searchCaret = searchInput && document.activeElement === searchInput ? searchInput.selectionStart : null;
    root.innerHTML = '';
    const head = el('div', 'cle-sb-head');
    renderSearch(head);
    renderBar(head);
    const plus = button('＋ 新会话', '新建会话', async () => {
      const project = projectOf(selectedKeyFor(currentAgent()));
      try { await createSession(project && state.projectFolders[project] ? project : null); }
      catch (error) { toast('新建失败：' + error.message); }
    }, 'cle-sb-new');
    plus.dataset.action = 'new-session';
    if (projectsOnly) plus.classList.add('is-hidden');
    const scrollBox = el('div', 'cle-sb-scroll');
    renderList(scrollBox);
    const foot = el('div', 'cle-sb-head cle-sb-head--bottom');
    renderNav(foot);
    root.append(head, plus, scrollBox, foot);
    scrollBox.scrollTop = keepScroll;
    if (searchCaret !== null) {
      const nextInput = root.querySelector('.cle-sb-search__input');
      if (nextInput) { nextInput.focus({preventScroll: true}); nextInput.setSelectionRange(searchCaret, searchCaret); }
    }
    if (focusedRow) root.querySelector(`.cle-sb-row[data-session-key="${CSS.escape(focusedRow)}"] .cle-sb-row__main`)?.focus({preventScroll: true});
    if (!cache) void fetchMode(stateMode);
    else if (cache.rows?.length) queueAutoTitles(cache.rows);
    if (refreshNotice) { toast(refreshNotice); refreshNotice = ''; }
  }

  let renderQueued = 0;
  let refreshTimer = 0;
  const schedule = () => { cancelAnimationFrame(renderQueued); renderQueued = requestAnimationFrame(renderNow); };

  /* ---------- 生命周期 ---------- */
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    mount();
    // The native sidebar re-renders; keep our block right below the brand.
    const observer = new MutationObserver(() => { if (!root.isConnected || root.previousElementSibling !== document.querySelector('aside.sidebar .sidebar-brand')) { mount(); } });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    const roomObserver = new MutationObserver(() => { if (syncModeState()) { void fetchMode(stateMode); } schedule(); });
    roomObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-room']});
    // Native selection changes (menu, shortcuts, links) move the highlight.
    window.CLE?.host?.subscribe?.(() => schedule());
    window.addEventListener('laolao:sessions-changed', () => { schedule(); void fetchMode(stateMode, true); });
    window.addEventListener('laolao:modechange', () => { void fetchMode(stateMode); schedule(); });
    window.addEventListener('pinkie:gateway-event', (event) => {
      const name = event.detail?.event;
      if (name === 'sessions.changed') { signature = ''; void fetchMode(stateMode, true); }
    });
    window.addEventListener('laolao:sidebar-invalidate', () => invalidate());
    setInterval(() => { if (!document.hidden) void fetchMode(stateMode, true); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
    window.addEventListener('focus', () => invalidate());
    void fetchMode(stateMode);
    queueAutoTitles(loaded.get(stateMode)?.rows || []);
  }

  /* ---------- 调试句柄 ---------- */
  window.__cleSidebarUI = {
    // Debug handle: also exposes the query state so the search can be checked without typing.
    set query(value) { query = String(value || ''); signature = ''; renderNow(); },
    get query() { return query; },
    // Debug/test scope for the two delete actions: a predicate over the current mode's rows.
    set deleteFilter(value) { deleteFilter = typeof value === 'function' ? value : null; },
    get deleteFilter() { return deleteFilter; },
    get visibleRows() { return [...visibleRows]; },
    get mode() { return stateMode; },
    get state() { return state; },
    get loaded() { return loaded.get(stateMode); },
    get mounted() { return mounted; },
    get root() { return root; },
    render: schedule,
    refresh: () => invalidate(),
    createSession,
    refresh: (mode) => fetchMode(mode || stateMode, true),
    deleteSession,
    archiveSession,
    restoreSession,
    togglePin,
    patchSession,
    addFolderProject,
    assignToProject,
    renameProject,
    removeProject,
    deleteProjectWithSessions,
    cleanupSessions,
    deleteAllSessions,
    askCleanup,
    askDeleteAllSessions,
    sessionMenu,
    openProjectSettings,
    openProjectMenu,
    navigateSession,
    navigateNative,
    nativePages,
    chooseFolder: chooseFolderDialog,
    toast,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
  // The plugin may load after the shell has painted; retry a few times for the sidebar.
  let tries = 0;
  const retry = setInterval(() => { if (root.isConnected || ++tries > 60) { clearInterval(retry); return; } mount(); }, 500);
})();
