/* laolao-workbench:v1 —— 项目模式 / 学习模式 / 无限模式的 VS Code 式工作台
 *
 *  ┌──┬────────────┬──────────────────────────────┬───────────────┐
 *  │活│ 资源管理器 │ 标签  app.js ●  README.md     │               │
 *  │动│ ▾ src      │ src › app.js                 │   碧琪对话    │
 *  │栏│   app.js   │  1  const a = 1              │ （原来的聊天 │
 *  │  │ 搜索 / Git │                              │   原样保留）  │
 *  │  │            ├──────────────────────────────┤               │
 *  │  │            │ 终端 · 问题                  │               │
 *  ├──┴────────────┴──────────────────────────────┴───────────────┤
 *  │ C.le. 无限模式  ⎇ main ↑1   ⊗0 ⚠0          行 3，列 9  UTF-8  │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * 工作台是挂在 body 上的独立一层，不改 Lit 渲染的聊天页；聊天只是被挤到右边（main.content 加左内边距）。
 * 编辑器 Monaco、终端复用应用自带的 openclaw-terminal-panel（ghostty），文件读写走插件的 pinkie.fs.*。
 * 无限模式不弹任何确认；删除和放弃改动都进碧琪的回收站，提示条里一键撤销。 */
(() => {
  'use strict';
  if (window.__pinkieWorkbench) return;
  const BASE = new URL('.', document.currentScript?.src || location.href).href;
  const MONACO = BASE + 'laolao-vendor-monaco/';
  const WORKERS = {json: 'json.worker-Csf_TLih.js', css: 'css.worker-BpD9FCKP.js', html: 'html.worker-CLuInTTy.js', ts: 'ts.worker-g3pjEjl4.js', editor: 'editor.worker-_vAIFJDs.js'};
  const MODES = new Set(['project', 'learning', 'unrestricted']);
  const MODE_NAME = {project: '项目模式', learning: '学习模式', unrestricted: '无限模式'};
  const TEXT_LIMIT = 8 * 1024 * 1024;

  /* ───────── 小工具 ───────── */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const icon = (name, extra) => { const i = el('i', 'codicon codicon-' + name + (extra ? ' ' + extra : '')); i.setAttribute('aria-hidden', 'true'); return i; };
  const button = (name, title, onClick, cls = 'pk-wb-icon') => { const b = el('button', cls); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.append(icon(name)); if (onClick) b.addEventListener('click', onClick); return b; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pinkie.wb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('pinkie.wb.' + k, JSON.stringify(v)); } catch {} },
  };
  const rpc = (method, params = {}, timeout = 20000) => {
    const request = window.__laolaoSidebar?.gwRequest;
    if (typeof request !== 'function') return Promise.reject(new Error('还没连上网关'));
    return request(method, {sessionKey: state.key, ...params}, timeout);
  };
  const toast = (message, action) => showNotice(message, action);
  const basename = p => String(p).split('/').filter(Boolean).pop() || String(p);
  const dirname = p => { const parts = String(p).split('/'); parts.pop(); return parts.join('/'); };
  const join = (a, b) => a ? a.replace(/\/$/, '') + '/' + b : b;
  const shellQuote = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const isMac = /Mac/.test(navigator.platform);
  const keyLabel = s => isMac ? s : s.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+');

  /* ───────── 状态 ───────── */
  const state = {
    visible: false, mode: '', key: '', info: null, root: '', referenceFolders: [],
    view: store.get('view', 'explorer'), sideOpen: store.get('sideOpen', true),
    sideWidth: store.get('sideWidth', 220), chatWidth: store.get('chatWidth', 380), panelHeight: store.get('panelHeight', 220), panelOpen: store.get('panelOpen', false),
    panelTab: 'terminal',
    tree: new Map(), expanded: new Set(), selected: '',
    tabs: [], active: '',
    git: null, files: null, filesAt: 0,
    ext: {items: null, query: '', filter: 'all', open: '', brew: null, brewQuery: '', busy: false},
    search: {query: '', replace: '', caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '', showReplace: false, showFilters: false, results: null, busy: false},
  };
  // 更新一次默认分栏；之后仍保留用户拖动的宽度。
  if (store.get('layoutVersion', 0) < 2) {
    state.sideWidth = Math.min(state.sideWidth, 228);
    state.chatWidth = Math.min(state.chatWidth, 420);
    store.set('sideWidth', state.sideWidth); store.set('chatWidth', state.chatWidth); store.set('layoutVersion', 2);
  }
  const extraStatus = new Map();
  window.__pinkieWorkbench = {state, open: (path, options) => openFile(path, options), refresh: () => refreshAll(), extraStatus};

  /* ───────── 让模型看见当前工作台和运行现场 ───────── */
  const contextClientId = crypto.randomUUID();
  const terminalContext = new Map(), contextSent = new Map();
  let contextQueue = Promise.resolve(), contextBusy = 0;
  const plainTerminal = value => String(value || '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[@-_]/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  function adoptTerminalContext(id, key, rootDir, initialCwd, buffer) {
    if (!id) return;
    let item = terminalContext.get(id);
    if (!item || item.root !== rootDir) item = {sessionId:id, key, root:rootDir, initialCwd, raw:'', draft:'', command:'', exitCode:null, updatedAt:0};
    item.key = key;
    if (buffer) { item.raw = String(buffer).slice(-18000); item.updatedAt = Date.now(); }
    terminalContext.set(id, item);
    if (terminalContext.size > 12) terminalContext.delete(terminalContext.keys().next().value);
    contextSoon();
  }
  function recordTerminalInput(id, data) {
    const item = terminalContext.get(id);
    if (!item) return;
    // 记录已经回车的命令；未提交的输入不发送给模型。
    for (const ch of String(data).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')) {
      if (ch === '\r' || ch === '\n') {
        if (item.draft.trim()) { item.command = item.draft.trim().slice(-800); item.raw = ''; item.exitCode = null; item.updatedAt = Date.now(); }
        item.draft = '';
      } else if (ch === '\x7f' || ch === '\b') item.draft = item.draft.slice(0,-1);
      else if (ch === '\x03' || ch === '\x15') item.draft = '';
      else if (ch >= ' ') item.draft = (item.draft + ch).slice(-2000);
    }
    contextSoon();
  }
  window.addEventListener('pinkie:gateway-event', event => {
    const {event: name, payload} = event.detail || {};
    const item = terminalContext.get(payload?.sessionId);
    if (!item) return;
    if (name === 'terminal.data' && typeof payload.data === 'string') item.raw = (item.raw + payload.data).slice(-18000);
    else if (name === 'terminal.exit') item.exitCode = Number.isInteger(payload.exitCode) ? payload.exitCode : null;
    else return;
    item.updatedAt = Date.now(); contextSoon();
  });
  function workbenchSnapshot(key) {
    const active = state.visible && key === sessionKey();
    const ready = active && key === state.key && Boolean(state.info?.root);
    const snapshot = {active, root:ready ? state.root : '', activeFile:null, diagnostics:[], terminals:[]};
    if (!ready) return snapshot;
    const tab = findTab(state.active), model = tab?.kind === 'text' ? tab.model : null;
    const position = model && editor?.getModel() === model ? editor.getPosition() : null;
    if (tab && !['page','pending','loading'].includes(tab.kind)) {
      const line = position?.lineNumber || 1, selection = model && editor?.getModel() === model ? editor.getSelection() : null;
      const excerptStartLine = Math.max(1,line - 15);
      snapshot.activeFile = {
        path:tab.kind === 'diff' ? tab.source : tab.path, language:model?.getLanguageId() || '', dirty:Boolean(tab.dirty),
        line, column:position?.column || 1,
        selection:selection && !selection.isEmpty() ? {startLine:selection.startLineNumber,endLine:selection.endLineNumber,text:model.getValueInRange(selection).slice(0,2000)} : null,
        unsavedExcerpt:tab.dirty && model ? model.getLinesContent().slice(excerptStartLine - 1,line + 15).join('\n').slice(0,4000) : '', excerptStartLine,
      };
    }
    const modelPaths = new Map(state.tabs.filter(t=>t.model).map(t=>[t.model.uri.toString(),t.path]));
    snapshot.diagnostics = (window.monaco?.editor.getModelMarkers({}) || []).filter(m=>modelPaths.has(m.resource.toString()) && (m.severity === 8 || m.severity === 4))
      .sort((a,b)=>b.severity-a.severity).slice(0,30).map(m=>({path:modelPaths.get(m.resource.toString()),line:m.startLineNumber,column:m.startColumn,severity:m.severity === 8 ? 'error':'warning',message:m.message,source:m.source || ''}));
    snapshot.terminals = [...terminalContext.values()].filter(t=>t.key === key && t.root === state.root && t.updatedAt)
      .sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,3).map(t=>({sessionId:t.sessionId,initialCwd:t.initialCwd,command:t.command,output:plainTerminal(t.raw).slice(-6000),exitCode:t.exitCode,updatedAt:t.updatedAt}));
    return snapshot;
  }
  function publishContext(forMessage = false, key = sessionKey(), closed = false) {
    if (!/^agent:(project|learning|unrestricted):/.test(key)) return Promise.resolve();
    if (!forMessage && !closed && contextBusy) return Promise.resolve();
    contextBusy++;
    const task = contextQueue.catch(()=>{}).then(async()=>{
      const snapshot = closed ? {active:false} : workbenchSnapshot(key);
      const signature = JSON.stringify(snapshot), previous = contextSent.get(key);
      if (!forMessage && previous?.signature === signature && (!snapshot.active || Date.now() - previous.at < 15000)) return;
      await rpc('pinkie.workbench.context', {sessionKey:key,clientId:contextClientId,forMessage,...snapshot}, 8000);
      contextSent.set(key,{signature,at:Date.now()});
      if (contextSent.size > 40) contextSent.delete(contextSent.keys().next().value);
    });
    contextQueue = task;
    return task.finally(()=>{ contextBusy--; });
  }
  const contextSoon = debounce(()=>void publishContext().catch(()=>{}), 180);
  // 聊天发送流程会等待这一帧现场同步完成，避免用户刚运行出错就发送时读到旧状态。
  window.__pinkieWorkbench.flushContext = async key => {
    if (/^agent:(project|learning|unrestricted):/.test(key) && wanted() && key === sessionKey() && (state.key !== key || !state.info?.root)) await switchSession(key);
    return publishContext(true, key);
  };

  /* ───────── 文件图标（material-icon-theme 精选） ───────── */
  let iconMap = null;
  fetch(BASE + 'laolao-vendor-fileicons/icons.json').then(r => r.json()).then(map => { iconMap = map; if (state.visible) renderTree(); renderTabs(); }).catch(() => {});
  function fileIcon(name, kind, open, isRoot) {
    const m = iconMap;
    let id = kind === 'dir' ? (open ? 'folder-open' : 'folder') : 'file';
    if (m) {
      const lower = name.toLowerCase();
      if (kind === 'dir') id = isRoot ? (open ? m.rootFolderExpanded : m.rootFolder) : (open ? m.folderNamesExpanded[lower] || m.folderExpanded : m.folderNames[lower] || m.folder);
      else {
        id = m.fileNames[lower];
        if (!id) { const parts = lower.split('.'); for (let i = 1; i < parts.length && !id; i++) id = m.fileExtensions[parts.slice(i).join('.')]; }
        id ||= m.file;
      }
    }
    const img = el('img', 'pk-wb-ficon'); img.alt = ''; img.draggable = false;
    img.src = BASE + 'laolao-vendor-fileicons/' + id + '.svg';
    img.onerror = () => { img.onerror = null; img.src = BASE + 'laolao-vendor-fileicons/' + (kind === 'dir' ? 'folder' : 'file') + '.svg'; };
    return img;
  }

  /* ───────── 骨架 ───────── */
  const root = el('div', 'pk-wb'); root.setAttribute('role', 'application'); root.setAttribute('aria-label', '碧琪工作台'); root.hidden = true;
  const activity = el('nav', 'pk-wb-views'); activity.setAttribute('aria-label', '视图'); activity.setAttribute('role', 'tablist');
  const side = el('aside', 'pk-wb-side');
  const sideSash = el('div', 'pk-wb-sash pk-wb-sash--side');
  const center = el('section', 'pk-wb-center');
  const chatSash = el('div', 'pk-wb-sash pk-wb-sash--chat'); chatSash.title = '拖动调整对话宽度';
  const status = el('footer', 'pk-wb-status');
  root.append(side, sideSash, center, chatSash);

  const views = {
    explorer: {icon: 'files', title: '资源管理器', key: '⇧⌘E'},
    search: {icon: 'search', title: '搜索', key: '⇧⌘F'},
    scm: {icon: 'source-control', title: '源代码管理', key: '⌃⇧G'},
    extensions: {icon: 'extensions', title: '扩展', key: '⇧⌘X'},
  };
  const activityButtons = {};
  const VIEW_LABEL = {explorer: '文件', search: '搜索', scm: 'Git', extensions: '扩展'};
  for (const [id, view] of Object.entries(views)) {
    const b = button(view.icon, view.title + '（' + keyLabel(view.key) + '）', () => toggleView(id), 'pk-wb-act');
    b.dataset.view = id; b.setAttribute('role', 'tab');
    b.append(el('span', 'pk-wb-act__label', VIEW_LABEL[id] || view.title));
    if (id === 'scm') { const badge = el('span', 'pk-wb-badge'); badge.hidden = true; b.append(badge); }
    activityButtons[id] = b; activity.append(b);
  }
  // 终端、问碧琪、收起工作台：放在编辑卡片标题栏的最右边（常驻）
  const benchTools = el('div', 'pk-wb-tabs__bench');
  const actTerminal = button('terminal', '终端（' + keyLabel('⌃`') + '）', () => togglePanel('terminal'));
  const actChat = button('comment-discussion', '问碧琪（选中代码后 ' + keyLabel('⌘L') + '）', () => askPinkie());
  const actClose = button('screen-normal', '收起工作台，回到普通聊天（' + keyLabel('⌥⌘B') + '）', () => setEnabled(false));
  benchTools.append(actTerminal, actChat, actClose);

  // 侧栏
  const sideHead = el('header', 'pk-wb-side__head');
  const sideTitle = el('h2', 'pk-wb-side__title');
  const sideActions = el('div', 'pk-wb-side__actions');
  sideTitle.classList.add('pk-wb-sr');
  sideHead.append(activity, sideTitle, sideActions);
  const sideBody = el('div', 'pk-wb-side__body');
  side.append(sideHead, sideBody);

  // 编辑区
  const editorArea = el('div', 'pk-wb-editor');
  const tabsBar = el('div', 'pk-wb-tabs'); tabsBar.setAttribute('role', 'tablist');
  const tabsList = el('div', 'pk-wb-tabs__list');
  const tabsActions = el('div', 'pk-wb-tabs__actions');
  tabsBar.append(tabsList, tabsActions, benchTools);
  const crumbs = el('div', 'pk-wb-crumbs');
  const notice = el('div', 'pk-wb-notice'); notice.hidden = true;
  const host = el('div', 'pk-wb-host');
  const monacoHost = el('div', 'pk-wb-monaco');
  const diffHost = el('div', 'pk-wb-monaco pk-wb-monaco--diff'); diffHost.hidden = true;
  const preview = el('div', 'pk-wb-preview'); preview.hidden = true;
  const welcome = el('div', 'pk-wb-welcome');
  host.append(monacoHost, diffHost, preview, welcome);
  editorArea.append(tabsBar, crumbs, notice, host);
  const panelSash = el('div', 'pk-wb-sash pk-wb-sash--panel');
  const panel = el('section', 'pk-wb-panel');
  const panelHead = el('header', 'pk-wb-panel__head');
  const panelBody = el('div', 'pk-wb-panel__body');
  panel.append(panelHead, panelBody);
  editorArea.append(status);
  center.append(editorArea, panelSash, panel);
  const toggleButton = el('button', 'pk-wb-reopen'); toggleButton.type = 'button'; toggleButton.hidden = true;
  toggleButton.append(icon('layout-sidebar-left'), el('span', '', '工作台'));
  toggleButton.title = '打开工作台（' + keyLabel('⌥⌘B') + '）';
  toggleButton.setAttribute('aria-label', '打开工作台');
  toggleButton.addEventListener('click', () => setEnabled(true));
  const quick = el('div', 'pk-wb-quick'); quick.hidden = true;
  const menu = el('div', 'pk-wb-menu'); menu.hidden = true; menu.setAttribute('role', 'menu');
  const workspaceHeader = el('header', 'pk-workspace-header'); workspaceHeader.hidden = true;
  const historyButton = button('history', '显示聊天记录', () => {
    const edge = document.querySelector('.pinkie-sidebar-edge');
    if (document.documentElement.dataset.pinkieSidebarAuto === '1' && edge) edge.click();
    else if (innerWidth > 850) document.querySelector('.sidebar [data-pinkie-sidebar-toggle]')?.click();
    else document.querySelector('.topbar-nav-toggle')?.click();
  });
  const workspaceIdentity = el('div', 'pk-workspace-header__identity');
  const workspaceViews = el('div', 'pk-workspace-header__views');
  workspaceViews.setAttribute('role', 'tablist'); workspaceViews.setAttribute('aria-label', '工作区页面');
  let workspaceView = 'code', compactSide = false;
  const codeView = el('button', '', '代码'), chatView = el('button', '', '对话');
  for (const [node, value] of [[codeView, 'code'], [chatView, 'chat']]) {
    node.type = 'button'; node.setAttribute('role', 'tab');
    node.addEventListener('click', () => { workspaceView = value; place(); });
    workspaceViews.append(node);
  }
  workspaceHeader.append(historyButton, workspaceIdentity);

  /* ───────── 何时出现 ───────── */
  const enabledPref = mode => store.get('enabled.' + mode, true);
  function setEnabled(on) {
    store.set('enabled.' + state.mode, on);
    sync();
    if (on) setTimeout(() => { if (state.visible && wanted()) (state.active ? editor?.focus() : sideBody.focus()); }, 60);
  }
  const mainContent = () => document.querySelector('main.content.content--chat');
  function wanted() {
    const mode = document.documentElement.dataset.laolaoMode || '';
    return MODES.has(mode) && !document.documentElement.matches('[data-laolao-workspace-split="1"], [data-laolao-workspace-dock="1"], [data-laolao-browser-workspace="1"]') && /\/chat\/?$/.test(location.pathname) && !!mainContent() && innerWidth >= 600 && /^agent:(project|learning|unrestricted):/.test(sessionKey());
  }
  const sessionKey = () => new URLSearchParams(location.search).get('session') || '';
  function sync() {
    const mode = document.documentElement.dataset.laolaoMode || '';
    if (mode !== state.mode) state.mode = mode;
    const can = wanted();
    const show = can && enabledPref(mode);
    toggleButton.hidden = !can || show;
    if (!root.isConnected) document.body.append(root, toggleButton, quick, menu, workspaceHeader);
    if (show !== state.visible) {
      state.visible = show;
      lastPlacement = '';
      if (!show) { hideQuick(); hideMenu(); }
    }
    // Async file/editor loads can finish after the user closes the bench.
    // Reconcile the whole surface on every sync, not only on a state change.
    if (root.hidden !== !show) root.hidden = !show;
    if (show) {
      if (document.documentElement.dataset.pinkieWb !== 'on') document.documentElement.dataset.pinkieWb = 'on';
    } else {
      cancelSashDrag?.();
      workspaceHeader.hidden = true;
      for (const key of ['pinkieWb', 'pkWbCompact', 'pkWbNarrow', 'pkWbView']) {
        if (key in document.documentElement.dataset) delete document.documentElement.dataset[key];
      }
      document.documentElement.style.removeProperty('--pk-wb-w');
      document.documentElement.style.removeProperty('--pk-wb-headroom');
    }
    if (show) {
      if (!root.style.getPropertyValue('--wb-editor')) applyCardColors();
      place();
      const key = sessionKey();
      if (key !== state.key) switchSession(key);
    } else if (can) placeReopen();
    contextSoon();
  }

  /* ───────── 布局与拖动 ───────── */
  let lastPlacement = '';
  const setStyle = (node, key, value) => { if (node.style[key] !== value) node.style[key] = value; };
  const setVariable = (node, key, value) => { if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value); };
  const setAttr = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
  function place() {
    if (!state.visible || !wanted() || !enabledPref(state.mode)) return;
    const content = mainContent();
    if (!content) return;
    const r = content.getBoundingClientRect();
    const signature = [r.left,r.top,r.width,innerHeight,state.chatWidth,state.sideWidth,state.sideOpen,compactSide,state.panelHeight,state.panelOpen,workspaceView].join(':');
    if (lastPlacement === signature && workspaceHeader.isConnected && !workspaceHeader.hidden && root.style.width) return;
    lastPlacement = signature;
    const total = r.width;
    const narrow = total < 840;
    const compact = true;
    for (const [key, value] of Object.entries({pkWbCompact: compact ? '1' : '0', pkWbNarrow: narrow ? '1' : '0', pkWbView: narrow ? workspaceView : 'both'})) {
      if (document.documentElement.dataset[key] !== value) document.documentElement.dataset[key] = value;
    }
    workspaceHeader.hidden = narrow && workspaceView === 'code';
    const chatPage = narrow && workspaceView === 'chat';
    if (workspaceHeader.parentElement !== document.body) document.body.append(workspaceHeader);
    const viewParent = chatPage ? workspaceHeader : benchTools;
    if (workspaceViews.parentElement !== viewParent) viewParent.prepend(workspaceViews);
    setAttr(codeView, 'aria-selected', String(workspaceView === 'code'));
    setAttr(chatView, 'aria-selected', String(workspaceView === 'chat'));
    const minChat = 320, minBench = Math.min(Math.max(560, total * .6), total - minChat);
    let chat = Math.min(Math.max(state.chatWidth, minChat), Math.max(minChat, total - minBench));
    const bench = narrow ? total : Math.max(0, total - chat);
    setStyle(workspaceHeader, 'left', (narrow ? r.left : r.left + bench) + 'px');
    setStyle(workspaceHeader, 'width', (narrow ? total : chat) + 'px');
    const top = Math.max(r.top, 0);
    const s = root.style;
    const want = {left: r.left + 'px', top: top + 'px', width: bench + 'px', height: (innerHeight - top) + 'px'};
    for (const [k, v] of Object.entries(want)) if (s[k] !== v) s[k] = v;
    setVariable(document.documentElement, '--pk-wb-w', (narrow ? 0 : bench) + 'px');
    setVariable(document.documentElement, '--pk-wb-headroom', (narrow && !chatPage ? 0 : 36) + 'px');
    const smallSide = bench < 520;
    const showSide = state.sideOpen && (!smallSide || compactSide);
    setVariable(root, '--pk-wb-side', (showSide && !smallSide ? Math.min(state.sideWidth, Math.max(170, bench * .32)) : 46) + 'px');
    setVariable(root, '--pk-wb-panel', (state.panelOpen ? state.panelHeight : 0) + 'px');
    root.classList.toggle('is-side-closed', !showSide);
    root.classList.toggle('is-side-overlay', smallSide && showSide);
    activity.classList.toggle('is-vertical', !showSide || smallSide);
    root.classList.toggle('is-panel-closed', !state.panelOpen);

  }
  function placeReopen() {
    // The rail belongs to the chat, and cannot cover a peeking history sidebar.
    const rail = document.querySelector('.chat-workspace-rail');
    const parent = rail || document.body;
    if (toggleButton.parentElement !== parent) parent.prepend(toggleButton);
    toggleButton.classList.toggle('is-in-rail', !!rail);
    toggleButton.style.removeProperty('left');
    toggleButton.style.removeProperty('top');
  }
  let cancelSashDrag = null;
  function dragSash(sash, onMove, onEnd) {
    sash.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !state.visible) return;
      event.preventDefault();
      cancelSashDrag?.();
      const pointerId = event.pointerId;
      sash.setPointerCapture(pointerId);
      sash.classList.add('is-dragging'); root.classList.add('is-dragging');
      const start = {x: event.clientX, y: event.clientY};
      const move = e => { if (e.pointerId === pointerId) onMove(e.clientX - start.x, e.clientY - start.y, e); };
      let finished = false;
      const finish = e => {
        if (finished || (e && e.pointerId !== pointerId)) return;
        finished = true;
        sash.removeEventListener('pointermove', move);
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) sash.removeEventListener(type, finish);
        sash.classList.remove('is-dragging'); root.classList.remove('is-dragging');
        if (cancelSashDrag === finish) cancelSashDrag = null;
        if (sash.hasPointerCapture(pointerId)) sash.releasePointerCapture(pointerId);
        onEnd?.();
      };
      cancelSashDrag = finish;
      sash.addEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) sash.addEventListener(type, finish);
      onMove(0, 0, event, true);
    });
  }
  { let base; dragSash(sideSash, (dx, dy, e, first) => { if (first) base = state.sideWidth; state.sideWidth = Math.min(Math.max(base + dx, 170), 560); place(); }, () => store.set('sideWidth', state.sideWidth)); }
  { let base; dragSash(chatSash, (dx, dy, e, first) => { if (first) base = state.chatWidth; state.chatWidth = Math.min(Math.max(base - dx, 340), innerWidth * 0.7); place(); }, () => store.set('chatWidth', state.chatWidth)); }
  { let base; dragSash(panelSash, (dx, dy, e, first) => { if (first) base = state.panelHeight; state.panelHeight = Math.min(Math.max(base - dy, 120), innerHeight * 0.75); place(); }, () => store.set('panelHeight', state.panelHeight)); }
  sideSash.addEventListener('dblclick', () => { state.sideWidth = 220; store.set('sideWidth', 220); place(); });
  chatSash.addEventListener('dblclick', () => { state.chatWidth = 380; store.set('chatWidth', 380); place(); });

  function toggleView(id) {
    if (root.clientWidth < 520) {
      compactSide = !(compactSide && state.view === id);
      state.view = id; state.sideOpen = true; renderSide(); place(); return;
    }
    if (state.view === id && state.sideOpen) { state.sideOpen = false; }
    else { state.view = id; state.sideOpen = true; }
    store.set('view', state.view); store.set('sideOpen', state.sideOpen);
    renderSide(); place();
    if (state.sideOpen && id === 'search') setTimeout(() => side.querySelector('.pk-wb-search__query')?.focus(), 30);
  }
  function openView(id) {
    if (root.clientWidth < 520) compactSide = true;
    state.view = id; state.sideOpen = true;
    store.set('view', id); store.set('sideOpen', true);
    renderSide(); place();
    if (id === 'search') setTimeout(() => { const q = side.querySelector('.pk-wb-search__query'); q?.focus(); q?.select(); }, 30);
  }
  function togglePanel(tab, force) {
    const open = force ?? !(state.panelOpen && state.panelTab === tab);
    state.panelOpen = open; if (tab) state.panelTab = tab;
    store.set('panelOpen', open);
    renderPanel(); place();
  }

  /* ───────── 会话 / 根目录 ───────── */
  let sessionLoadGeneration = 0;
  async function switchSession(key) {
    const generation = ++sessionLoadGeneration;
    const isCurrent = () => generation === sessionLoadGeneration && state.key === key && sessionKey() === key;
    persistTabs();
    if (state.key && state.key !== key) void publishContext(false, state.key, true).catch(()=>{});
    state.key = key; state.info = null;
    if (!key) return;
    let info;
    try { info = await rpc('pinkie.fs.status'); }
    catch (error) { if (isCurrent()) { state.info = {error: error.message}; if (state.visible) { renderSide(); renderWelcome(); renderStatus(); } } return; }
    if (!isCurrent()) return;
    const changed = info.root !== state.root;
    if (changed) parkTerminal(state.root);
    state.info = info; state.root = info.root;
    state.referenceFolders = store.get('references.' + info.agentId, []).filter(item => item && typeof item.path === 'string' && item.path.startsWith('/')).slice(0, 8);
    const restore = changed || (!state.tree.has('') && !state.tabs.length);
    if (changed) {
      closeAllTabs(true);
      state.tree.clear(); state.expanded = new Set(store.get('expanded.' + info.root, [])); state.selected = '';
      state.files = null; state.git = null; state.search.results = null;
    }
    // A newer status request may adopt the same root while its first list is
    // still pending. The newer generation must load that missing list itself.
    if (changed || !state.tree.has('')) {
      await loadDir('');
      if (!isCurrent()) return;
      if (restore) restoreTabs();
    }
    if (!isCurrent()) return;
    if (state.visible) renderAll();
    refreshGit();
    void fileList().then(() => loadExtensions(true));
    if (terminalEl) terminalEl.agentId = info.agentId;
    for (const id of liveTerminalIds()) {
      const item = terminalContext.get(id);
      if (item?.root === state.root) item.key = key;
    }
    contextSoon();
  }
  function persistTabs() {
    if (!state.root) return;
    store.set('tabs.' + state.root, {tabs: state.tabs.filter(t => t.kind !== 'diff' && t.kind !== 'page').map(t => t.path).slice(0, 30), active: state.active.startsWith('page:') ? '' : state.active});
    store.set('expanded.' + state.root, [...state.expanded].slice(0, 300));
  }
  function restoreTabs() {
    const saved = store.get('tabs.' + state.root, null);
    if (!saved?.tabs?.length) return;
    for (const path of saved.tabs) state.tabs.push({path, name: basename(path), kind: 'pending', pinned: true});
    const active = saved.tabs.includes(saved.active) ? saved.active : saved.tabs[0];
    void activate(active);
  }

  /* ───────── 资源管理器 ───────── */
  const loadingDirs = new Set();
  async function loadDir(path) {
    const key = state.key, rootDir = state.root, generation = sessionLoadGeneration;
    const isCurrent = () => state.key === key && state.root === rootDir && generation === sessionLoadGeneration;
    try {
      const result = await rpc('pinkie.fs.list', {path});
      if (isCurrent()) state.tree.set(path, result.entries);
      return result.entries;
    } catch (error) {
      if (isCurrent()) state.tree.set(path, {error: error.message});
      return [];
    }
  }
  async function refreshTree() {
    const dirs = ['', ...[...state.expanded].sort()];
    await Promise.all(dirs.map(async dir => { if (dir === '' || state.tree.has(dir)) await loadDir(dir); }));
    renderTree();
  }
  const refreshSoon = debounce(() => { if (state.visible) { refreshTree(); refreshGit(); state.files = null; checkOpenFiles(); } }, 700);

  function gitDecorations() {
    const map = new Map();
    for (const change of state.git?.changes || []) {
      const prev = map.get(change.path);
      if (!prev || change.status === 'C' || (!change.staged && prev !== 'C')) map.set(change.path, change.status);
    }
    return map;
  }
  function visibleRows() {
    const rows = [];
    const decos = gitDecorations();
    const walk = (dir, depth) => {
      const entries = state.tree.get(dir);
      if (!entries) {
        const key = state.key, token = key + '\0' + dir;
        if (state.expanded.has(dir) && !loadingDirs.has(token)) {
          loadingDirs.add(token);
          void loadDir(dir).finally(() => { loadingDirs.delete(token); if (state.key === key) renderTree(); });
        }
        return;
      }
      if (entries.error) { rows.push({error: entries.error, depth}); return; }
      for (const entry of entries) {
        const open = entry.kind === 'dir' && state.expanded.has(entry.path);
        let deco = decos.get(entry.path);
        if (entry.kind === 'dir' && !deco) for (const [p, s] of decos) if (p.startsWith(entry.path + '/')) { deco = s === 'D' ? 'M' : s; break; }
        rows.push({entry, depth, open, deco});
        if (open) walk(entry.path, depth + 1);
      }
    };
    if (state.info?.bound) walk('', 0);
    const references = [];
    if (state.info?.workspaceRoot && (!state.info.bound || state.info.workspaceRoot !== state.root)) {
      references.push({path: state.info.workspaceRoot, name: (MODE_NAME[state.info.agentId] || '当前模式') + '工作区'});
    }
    for (const folder of state.referenceFolders) {
      if (folder.path !== state.root && !references.some(item => item.path === folder.path)) references.push(folder);
    }
    rows.push({section: '参考资料'});
    for (const folder of references) {
      const open = state.expanded.has(folder.path);
      rows.push({entry: {name: folder.name || basename(folder.path), path: folder.path, kind: 'dir'}, depth: 0, open, referenceRoot: true});
      if (open) walk(folder.path, 1);
    }
    return rows;
  }
  function renderTree() {
    if (state.view !== 'explorer' || !state.sideOpen) return;
    const list = sideBody.querySelector('.pk-wb-tree');
    if (!list) return;
    const rows = visibleRows();
    const dirty = new Set(state.tabs.filter(t => t.dirty).map(t => t.path));
    const frag = document.createDocumentFragment();
    if (!state.info?.bound || (!state.tree.get('')?.length && !state.tree.get('')?.error)) {
      const empty = el('div', 'pk-wb-empty');
      if (!state.info?.bound) empty.append(el('p', '', '打开项目文件夹，在项目里写代码、运行和管理 Git。'), Object.assign(el('button', 'pk-wb-btn pk-wb-open-project', '打开项目文件夹…'), {type: 'button', onclick: () => pickAndBindFolder()}));
      else empty.append(el('p', '', '这个文件夹还是空的。'), Object.assign(el('button', 'pk-wb-btn', '新建文件'), {type: 'button', onclick: () => newEntry('', 'file')}));
      frag.append(empty);
    }
    for (const row of rows) {
      if (row.section) {
        const heading = el('div', 'pk-wb-reference-head');
        heading.append(el('span', '', row.section), button('folder-opened', '浏览其他文件夹（不切换项目）', () => browseReferenceFolder()));
        frag.append(heading); continue;
      }
      if (row.error) { const e = el('div', 'pk-wb-row pk-wb-row--error', row.error); e.style.setProperty('--depth', row.depth); frag.append(e); continue; }
      const {entry, depth, open, deco} = row;
      const item = el('div', 'pk-wb-row');
      item.setAttribute('role', 'treeitem'); item.tabIndex = -1;
      item.dataset.path = entry.path; item.dataset.kind = entry.kind;
      if (row.referenceRoot) { item.classList.add('is-reference-root'); item.title = entry.path; }
      if (entry.kind === 'dir') item.setAttribute('aria-expanded', String(open));
      item.style.setProperty('--depth', depth);
      if (entry.path === state.selected) item.classList.add('is-selected');
      if (entry.path === state.active) item.classList.add('is-active');
      if (deco) item.dataset.git = deco;
      item.append(icon(entry.kind === 'dir' ? (open ? 'chevron-down' : 'chevron-right') : 'blank', 'pk-wb-row__twist'), fileIcon(entry.name, entry.kind, open), el('span', 'pk-wb-row__name', entry.name));
      if (dirty.has(entry.path)) item.append(el('span', 'pk-wb-row__dirty'));
      if (deco) item.append(el('span', 'pk-wb-row__git', deco === 'U' ? 'U' : deco === 'C' ? '!' : deco));
      item.draggable = !readOnlyPath(entry.path);
      frag.append(item);
    }
    list.replaceChildren(frag);
  }
  async function toggleDir(path, force) {
    const open = force ?? !state.expanded.has(path);
    if (open) { state.expanded.add(path); if (!state.tree.has(path)) await loadDir(path); }
    else state.expanded.delete(path);
    renderTree(); persistTabs();
  }
  async function revealInTree(path) {
    let base = '', relative = path;
    if (path.startsWith('/')) {
      const candidates = [state.info?.workspaceRoot, ...state.referenceFolders.map(item => item.path)].filter(Boolean);
      base = candidates.find(root => path === root || path.startsWith(root.replace(/\/$/, '') + '/')) || dirname(path);
      if (!candidates.includes(base)) {
        state.referenceFolders.push({path: base, name: basename(base) || base});
        state.referenceFolders = state.referenceFolders.slice(-8);
        store.set('references.' + state.info.agentId, state.referenceFolders);
      }
      state.expanded.add(base); if (!state.tree.has(base)) await loadDir(base);
      relative = path.slice(base.length).replace(/^\//, '');
    }
    const parts = relative.split('/'); parts.pop();
    let acc = base;
    for (const part of parts) { acc = join(acc, part); state.expanded.add(acc); if (!state.tree.has(acc)) await loadDir(acc); }
    state.selected = path; renderTree();
    sideBody.querySelector('.pk-wb-row[data-path="' + CSS.escape(path) + '"]')?.scrollIntoView({block: 'nearest'});
  }

  function treeEvents(list) {
    list.addEventListener('click', event => {
      const row = event.target.closest('.pk-wb-row[data-path]');
      if (!row) return;
      state.selected = row.dataset.path;
      if (row.dataset.kind === 'dir') void toggleDir(row.dataset.path);
      else { void openFile(row.dataset.path, {preview: true}); renderTree(); }
      row.focus({preventScroll: true});
    });
    list.addEventListener('dblclick', event => {
      const row = event.target.closest('.pk-wb-row[data-kind="file"]');
      if (row) pinTab(row.dataset.path);
    });
    list.addEventListener('contextmenu', event => {
      event.preventDefault();
      const row = event.target.closest('.pk-wb-row[data-path]');
      if (row) { state.selected = row.dataset.path; renderTree(); }
      treeMenu(row?.dataset.path || '', row?.dataset.kind || 'dir', event.clientX, event.clientY);
    });
    list.addEventListener('keydown', event => {
      const rows = [...list.querySelectorAll('.pk-wb-row[data-path]')];
      const index = rows.findIndex(r => r.dataset.path === state.selected);
      const current = rows[index];
      const go = i => { const r = rows[Math.max(0, Math.min(rows.length - 1, i))]; if (!r) return; state.selected = r.dataset.path; renderTree(); list.querySelector('.is-selected')?.focus(); list.querySelector('.is-selected')?.scrollIntoView({block: 'nearest'}); };
      if (event.key === 'ArrowDown') { event.preventDefault(); go(index + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); go(index - 1); }
      else if (event.key === 'ArrowRight' && current?.dataset.kind === 'dir') { event.preventDefault(); void toggleDir(current.dataset.path, true); }
      else if (event.key === 'ArrowLeft' && current) { event.preventDefault(); if (current.dataset.kind === 'dir' && state.expanded.has(current.dataset.path)) void toggleDir(current.dataset.path, false); else { const parent = dirname(current.dataset.path); if (parent) { state.selected = parent; renderTree(); } } }
      else if (event.key === 'Enter' && current) { event.preventDefault(); if (isMac) startRename(current.dataset.path); else current.click(); }
      else if (event.key === 'F2' && current) { event.preventDefault(); startRename(current.dataset.path); }
      else if ((event.key === 'Backspace' && event.metaKey || event.key === 'Delete') && current) { event.preventDefault(); void trashPath(current.dataset.path); }
      else if (event.key === ' ' && current?.dataset.kind === 'file') { event.preventDefault(); void openFile(current.dataset.path, {preview: true}); }
    });
    // 拖动到文件夹 = 移动
    list.addEventListener('dragstart', event => { const row = event.target.closest('.pk-wb-row[data-path]'); if (!row) return; event.dataTransfer.setData('text/x-pinkie-path', row.dataset.path); event.dataTransfer.setData('text/plain', row.dataset.path); event.dataTransfer.effectAllowed = 'move'; });
    list.addEventListener('dragover', event => {
      if (!event.dataTransfer.types.includes('text/x-pinkie-path')) return;
      event.preventDefault();
      list.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop'));
      const row = event.target.closest('.pk-wb-row[data-path]');
      (row?.dataset.kind === 'dir' ? row : row ? list.querySelector('.pk-wb-row[data-path="' + CSS.escape(dirname(row.dataset.path)) + '"]') : null)?.classList.add('is-drop');
      if (!row) list.classList.add('is-drop-root');
    });
    list.addEventListener('dragleave', event => { if (!list.contains(event.relatedTarget)) { list.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop')); list.classList.remove('is-drop-root'); } });
    list.addEventListener('drop', event => {
      const from = event.dataTransfer.getData('text/x-pinkie-path');
      list.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop')); list.classList.remove('is-drop-root');
      if (!from) return;
      event.preventDefault();
      const row = event.target.closest('.pk-wb-row[data-path]');
      const dir = row ? (row.dataset.kind === 'dir' ? row.dataset.path : dirname(row.dataset.path)) : '';
      if (dir === dirname(from) || dir === from || dir.startsWith(from + '/')) return;
      void movePath(from, join(dir, basename(from)));
    });
  }

  function treeMenu(path, kind, x, y) {
    const dir = kind === 'dir' ? path : dirname(path);
    const readOnly = readOnlyPath(path);
    const items = readOnly ? [] : [
      {label: '新建文件…', icon: 'new-file', run: () => newEntry(dir, 'file')},
      {label: '新建文件夹…', icon: 'new-folder', run: () => newEntry(dir, 'dir')},
    ];
    if (path) items.push('-',
      ...(kind === 'file' ? [{label: '打开', icon: 'go-to-file', run: () => openFile(path)}, {label: '让碧琪看看这个文件', icon: 'comment-discussion', run: () => askAboutFile(path)}] : [{label: '在终端中打开', icon: 'terminal', run: () => terminalCd(path)}]),
      {label: '在访达中显示', icon: 'folder-opened', run: () => rpc('pinkie.fs.reveal', {path}).catch(e => toast(e.message))},
      '-',
      {label: '复制路径', icon: 'copy', key: '⌥⌘C', run: () => copyText(absolute(path))},
      {label: '复制相对路径', icon: 'copy', key: '⌥⇧⌘C', run: () => copyText(path)},
      ...(!readOnly ? ['-',
        {label: '重命名…', icon: 'edit', key: 'F2', run: () => startRename(path)},
        {label: '删除', icon: 'trash', key: '⌘⌫', run: () => trashPath(path)}] : []));
    else items.push('-', {label: '在访达中显示项目', icon: 'folder-opened', run: () => rpc('pinkie.fs.reveal', {path: ''}).catch(e => toast(e.message))}, {label: '刷新', icon: 'refresh', run: () => refreshAll()});
    showMenu(items, x, y);
  }
  const absolute = path => path.startsWith('/') ? path : state.root.replace(/\/$/, '') + (path ? '/' + path : '');
  const readOnlyPath = path => !state.info?.unrestricted && String(path).startsWith('/') && path !== state.root && !path.startsWith(state.root.replace(/\/$/, '') + '/');
  function copyText(text) { navigator.clipboard?.writeText(text).then(() => toast('已复制：' + text), () => toast('复制失败')); }

  function inlineInput(row, initial, onDone, select) {
    const input = el('input', 'pk-wb-inline');
    input.value = initial; input.spellcheck = false;
    const finish = commit => { if (input.dataset.done) return; input.dataset.done = '1'; const value = input.value.trim(); input.remove(); onDone(commit && value && value !== initial ? value : null); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } e.stopPropagation(); });
    input.addEventListener('blur', () => finish(true));
    row.append(input);
    input.focus();
    if (select) { const dot = initial.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : initial.length); } else input.select();
    return input;
  }
  async function newEntry(dir, kind) {
    if (state.view !== 'explorer' || !state.sideOpen) openView('explorer');
    if (dir) await toggleDir(dir, true);
    const list = sideBody.querySelector('.pk-wb-tree');
    const ghost = el('div', 'pk-wb-row pk-wb-row--ghost');
    const depth = dir ? dir.split('/').length : 0;
    ghost.style.setProperty('--depth', depth);
    ghost.append(icon('blank', 'pk-wb-row__twist'), fileIcon(kind === 'dir' ? 'folder' : 'file', kind, false));
    const anchor = dir ? list.querySelector('.pk-wb-row[data-path="' + CSS.escape(dir) + '"]') : null;
    anchor ? anchor.after(ghost) : list.prepend(ghost);
    inlineInput(ghost, '', async name => {
      ghost.remove();
      if (!name) return;
      if (/[\\:]/.test(name) || name.split('/').some(p => p === '..' || p === '')) { toast('名字里不能有 \\ : 或 ..'); return; }
      const path = join(dir, name);
      try {
        await rpc('pinkie.fs.touch', {path, kind});
        await loadDir(dir); if (name.includes('/')) await refreshTree();
        state.selected = path; renderTree(); refreshGit(); state.files = null;
        if (kind === 'file') openFile(path, {pinned: true});
      } catch (error) { toast(error.message); }
    });
  }
  function startRename(path) {
    const row = sideBody.querySelector('.pk-wb-row[data-path="' + CSS.escape(path) + '"]');
    if (!row) return;
    row.classList.add('is-renaming');
    inlineInput(row, basename(path), async name => {
      row.classList.remove('is-renaming');
      if (!name) return;
      if (/[\\:/]/.test(name) || name === '..') { toast('名字里不能有 / \\ : 或 ..'); return; }
      await movePath(path, join(dirname(path), name));
    }, true);
  }
  async function movePath(from, to) {
    try {
      await rpc('pinkie.fs.rename', {from, to});
      for (const tab of state.tabs) {
        if (tab.path === from || tab.path.startsWith(from + '/')) {
          const next = to + tab.path.slice(from.length);
          if (state.active === tab.path) state.active = next;
          tab.path = next; tab.name = basename(next);
          if (tab.model) { const value = tab.model.getValue(); const old = tab.model; emitModel('close', {path: from + tab.path.slice(next.length) || from, model: old}); tab.model = window.monaco.editor.createModel(value, languageFor(next), uriFor(next)); if (editor?.getModel() === old) editor.setModel(tab.model); old.dispose(); trackModel(tab); emitModel('open', tab); }
        }
      }
      if (state.expanded.has(from)) { state.expanded.delete(from); state.expanded.add(to); }
      await loadDir(dirname(from)); if (dirname(to) !== dirname(from)) await loadDir(dirname(to));
      state.selected = to; renderTree(); renderTabs(); renderCrumbs(); refreshGit(); state.files = null;
    } catch (error) { toast(error.message); }
  }
  async function trashPath(path) {
    const affected = state.tabs.filter(t => t.path === path || t.path.startsWith(path + '/'));
    try {
      const result = await rpc('pinkie.fs.trash', {path});
      for (const tab of affected) closeTab(tab.path, true);
      await loadDir(dirname(path)); renderTree(); refreshGit(); state.files = null;
      toast('已把「' + basename(path) + '」放进碧琪的回收站', {label: '撤销', run: async () => { try { await rpc('pinkie.fs.restore', {trashId: result.trashId}); await loadDir(dirname(path)); renderTree(); refreshGit(); toast('已恢复「' + basename(path) + '」'); } catch (e) { toast(e.message); } }});
    } catch (error) { toast(error.message); }
  }
  // 项目模式用的「再按一次」：不是弹窗，只是第二次确认
  const armed = new Map();
  function confirmTwice(id, message) {
    const at = armed.get(id);
    if (at && Date.now() - at < 4000) { armed.delete(id); return true; }
    armed.set(id, Date.now()); toast(message); return false;
  }

  /* ───────── Monaco ───────── */
  let monacoReady = null, editor = null, diffEditor = null;
  function loadMonaco() {
    if (monacoReady) return monacoReady;
    monacoReady = new Promise((resolve, reject) => {
      const done = () => {
        const amd = window.define?.amd;
        // 只让 Monaco 自己的脚本看到 AMD：Chart.js / Mermaid / KaTeX 这些 UMD 库照旧挂到 window 上。
        if (amd && !Object.getOwnPropertyDescriptor(window.define, 'amd')?.get) {
          Object.defineProperty(window.define, 'amd', {configurable: true, get: () => (document.currentScript?.src || '').includes('/laolao-vendor-monaco/') ? amd : undefined});
        }
        window.require.config({paths: {vs: MONACO + 'vs'}});
        window.require(['vs/editor/editor.main'], () => {
          const label = id => id === 'json' ? 'json' : ['css', 'scss', 'less'].includes(id) ? 'css' : ['html', 'handlebars', 'razor'].includes(id) ? 'html' : ['typescript', 'javascript'].includes(id) ? 'ts' : 'editor';
          self.MonacoEnvironment = {getWorker: (_, id) => new Worker(MONACO + 'worker-boot.js?w=' + WORKERS[label(id)])};
          // 补全、报错、AI 行内补全在单独的模块里（语言服务器客户端）
          const code = document.createElement('script'); code.src = BASE + 'laolao-workbench-code.js?v=4'; code.async = true; document.head.append(code);
          resolve(window.monaco);
        }, reject);
      };
      if (window.require?.config && window.monaco) { resolve(window.monaco); return; }
      const script = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = ok; s.onerror = no; document.head.append(s); });
      // 中文界面：语言包只是给 globalThis 设消息表，必须在编辑器之前作为普通脚本加载
      script(MONACO + 'vs/nls/lang/zh-cn.js').catch(() => {}).then(() => script(MONACO + 'vs/loader.js')).then(done, () => { monacoReady = null; reject(new Error('编辑器加载失败')); });
    });
    return monacoReady;
  }

  function cssColor(value, fallback) {
    const probe = el('span'); probe.style.color = value; probe.style.display = 'none'; document.body.append(probe);
    const c = getComputedStyle(probe).color; probe.remove();
    const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?/);
    if (!m) return fallback;
    return {r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4]};
  }
  const hex = (c, a) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') + (a == null ? '' : Math.round(a * 255).toString(16).padStart(2, '0'));
  const mix = (a, b, t) => ({r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t});
  const luma = c => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  // C.le. 主题：底色、强调色取当前模式的 CSS 变量；语法色固定一套碧琪粉 + C.le. 蓝。
  function themeColors() {
    const v = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const elevated = cssColor(v('--bg-elevated') || '#2a2030', {r: 42, g: 32, b: 48, a: 1});
    const text = cssColor(v('--text') || '#efe5ea', {r: 239, g: 229, b: 234, a: 1});
    const accent = cssColor(v('--accent') || '#ff7aa2', {r: 255, g: 122, b: 162, a: 1});
    const cle = cssColor(v('--cle-accent') || '#62b4ff', {r: 98, g: 180, b: 255, a: 1});
    const dark = luma(elevated) < 0.5;
    const bg = dark ? mix(elevated, {r: 12, g: 8, b: 14}, 0.38) : mix(elevated, {r: 255, g: 255, b: 255}, 0.55);
    return {dark, bg, text, accent, cle, muted: mix(bg, text, 0.48), faint: mix(bg, text, 0.12), line: mix(bg, text, 0.07), widget: mix(bg, dark ? {r: 255, g: 255, b: 255} : {r: 0, g: 0, b: 0}, dark ? 0.05 : 0.025)};
  }
  function applyCardColors() {
    const c = themeColors();
    setVariable(root, '--wb-editor', hex(c.bg));
    root.classList.toggle('is-light', !c.dark);
    return c;
  }
  let editorThemeSignature = '';
  function applyTheme() {
    const c = applyCardColors();
    const m = window.monaco;
    if (!m) return;
    const signature = JSON.stringify(c);
    if (signature === editorThemeSignature) return;
    editorThemeSignature = signature;
    themeTerminal(true);
    const tok = c.dark
      ? {comment: '8d7c87', keyword: hex(c.accent).slice(1), type: 'c8a8ff', fn: hex(c.cle).slice(1), string: '8fdcc0', number: 'f6c76f', regexp: 'ff9e7a', property: 'ffc4d8', variable: hex(c.text).slice(1), tag: hex(c.accent).slice(1), attr: 'c8a8ff', delim: 'b5a3ae', constant: 'f6c76f', invalid: 'ff6b6b'}
      : {comment: '9a8792', keyword: 'd6336c', type: '7048e8', fn: '1c6fd1', string: '0b8a6f', number: 'c2410c', regexp: 'b45309', property: 'a8326a', variable: hex(c.text).slice(1), tag: 'd6336c', attr: '7048e8', delim: '7d6b75', constant: 'c2410c', invalid: 'e03131'};
    m.editor.defineTheme('cle', {
      base: c.dark ? 'vs-dark' : 'vs', inherit: true,
      rules: [
        {token: '', foreground: tok.variable},
        {token: 'comment', foreground: tok.comment, fontStyle: 'italic'},
        {token: 'keyword', foreground: tok.keyword}, {token: 'keyword.control', foreground: tok.keyword}, {token: 'storage', foreground: tok.keyword},
        {token: 'type', foreground: tok.type}, {token: 'type.identifier', foreground: tok.type}, {token: 'class', foreground: tok.type},
        {token: 'identifier.function', foreground: tok.fn}, {token: 'function', foreground: tok.fn}, {token: 'predefined', foreground: tok.fn},
        {token: 'string', foreground: tok.string}, {token: 'string.escape', foreground: tok.regexp}, {token: 'regexp', foreground: tok.regexp},
        {token: 'number', foreground: tok.number}, {token: 'constant', foreground: tok.constant},
        {token: 'tag', foreground: tok.tag}, {token: 'metatag', foreground: tok.tag}, {token: 'attribute.name', foreground: tok.attr}, {token: 'attribute.value', foreground: tok.string},
        {token: 'delimiter', foreground: tok.delim}, {token: 'operator', foreground: tok.delim},
        {token: 'variable', foreground: tok.variable}, {token: 'variable.predefined', foreground: tok.property}, {token: 'key', foreground: tok.property}, {token: 'string.key.json', foreground: tok.property},
        {token: 'emphasis', fontStyle: 'italic'}, {token: 'strong', fontStyle: 'bold'}, {token: 'keyword.md', foreground: tok.keyword}, {token: 'string.link', foreground: tok.fn},
        {token: 'invalid', foreground: tok.invalid},
      ],
      colors: {
        'editor.background': hex(c.bg), 'editor.foreground': hex(c.text),
        'editorCursor.foreground': hex(c.accent),
        'editor.lineHighlightBackground': hex(c.accent, c.dark ? 0.06 : 0.05), 'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': hex(c.accent, c.dark ? 0.28 : 0.22), 'editor.inactiveSelectionBackground': hex(c.accent, 0.12),
        'editor.selectionHighlightBackground': hex(c.cle, 0.14), 'editor.wordHighlightBackground': hex(c.cle, 0.12), 'editor.wordHighlightStrongBackground': hex(c.cle, 0.2),
        'editor.findMatchBackground': hex(c.cle, 0.42), 'editor.findMatchHighlightBackground': hex(c.cle, 0.2),
        'editorLineNumber.foreground': hex(c.muted, 0.7), 'editorLineNumber.activeForeground': hex(c.accent),
        'editorIndentGuide.background1': hex(c.faint), 'editorIndentGuide.activeBackground1': hex(c.muted, 0.6),
        'editorWhitespace.foreground': hex(c.faint), 'editorRuler.foreground': hex(c.faint),
        'editorBracketMatch.background': hex(c.cle, 0.18), 'editorBracketMatch.border': hex(c.cle, 0.6),
        'editorGutter.background': hex(c.bg), 'editorWidget.background': hex(c.widget), 'editorWidget.border': hex(c.faint),
        'editorSuggestWidget.background': hex(c.widget), 'editorSuggestWidget.selectedBackground': hex(c.accent, 0.18), 'editorSuggestWidget.highlightForeground': hex(c.accent),
        'editorHoverWidget.background': hex(c.widget), 'editorHoverWidget.border': hex(c.faint),
        'quickInput.background': hex(c.widget), 'list.activeSelectionBackground': hex(c.accent, 0.2), 'list.hoverBackground': hex(c.text, 0.05), 'list.highlightForeground': hex(c.accent),
        'focusBorder': hex(c.accent, 0.55), 'input.background': hex(c.line), 'input.border': hex(c.faint),
        'scrollbarSlider.background': hex(c.text, 0.1), 'scrollbarSlider.hoverBackground': hex(c.text, 0.18), 'scrollbarSlider.activeBackground': hex(c.accent, 0.35),
        'minimap.background': hex(c.bg), 'minimapSlider.background': hex(c.text, 0.07),
        'diffEditor.insertedTextBackground': c.dark ? '#3ccfa233' : '#0ca67826', 'diffEditor.removedTextBackground': hex(c.accent, 0.22),
        'diffEditor.insertedLineBackground': c.dark ? '#3ccfa214' : '#0ca67812', 'diffEditor.removedLineBackground': hex(c.accent, 0.09),
        'editorOverviewRuler.border': '#00000000', 'editorError.foreground': '#ff6b81', 'editorWarning.foreground': '#f6c76f', 'editorInfo.foreground': hex(c.cle),
        'peekViewEditor.background': hex(c.widget), 'peekViewResult.background': hex(c.widget), 'peekView.border': hex(c.accent, 0.6),
      },
    });
    m.editor.setTheme('cle');
    root.classList.toggle('is-light', !c.dark);
  }

  let notebookReady = null;
  async function ensureNotebook() {
    if (window.__pinkieNotebook) return window.__pinkieNotebook;
    return notebookReady ||= (async () => {
      if (!document.getElementById('pk-nb-style')) {
        const link = document.createElement('link');
        link.id = 'pk-nb-style';
        link.rel = 'stylesheet';
        link.href = BASE + 'laolao-workbench-notebook.css';
        document.head.append(link);
      }
      if (!document.getElementById('pk-nb-script')) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.id = 'pk-nb-script';
          s.src = BASE + 'laolao-workbench-notebook.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('笔记本模块加载失败'));
          document.head.append(s);
        });
      }
      return window.__pinkieNotebook;
    })();
  }

  async function ensureEditor() {
    const m = await loadMonaco();
    if (editor) return editor;
    applyTheme();
    editor = m.editor.create(monacoHost, {
      model: null, automaticLayout: false, fontFamily: '"SF Mono", "JetBrains Mono", Menlo, ui-monospace, monospace', fontSize: 13, lineHeight: 20, fontLigatures: true,
      minimap: {enabled: store.get('minimap', false), renderCharacters: false, scale: 1, showSlider: 'mouseover'}, smoothScrolling: true, cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all', roundedSelection: true, scrollBeyondLastLine: false, padding: {top: 8, bottom: 8}, bracketPairColorization: {enabled: true},
      guides: {bracketPairs: 'active', indentation: true}, stickyScroll: {enabled: true}, tabSize: 2, detectIndentation: true, wordWrap: 'off', mouseWheelZoom: true,
      fixedOverflowWidgets: true, contextmenu: true, unicodeHighlight: {ambiguousCharacters: false},
    });
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveActive());
    editor.addAction({id: 'pinkie.ask', label: '问碧琪（带上选中的代码）', keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyL], contextMenuGroupId: '0_pinkie', contextMenuOrder: 1, run: () => askPinkie()});
    editor.addAction({id: 'pinkie.explain', label: '让碧琪解释这段代码', contextMenuGroupId: '0_pinkie', contextMenuOrder: 2, run: () => askPinkie('请解释这段代码在做什么，有没有隐患：')});
    editor.addAction({id: 'pinkie.fix', label: '在对话里让碧琪修改这段代码', contextMenuGroupId: '0_pinkie', contextMenuOrder: 4, run: () => askPinkie('请修改这段代码：')});
    editor.addAction({id: 'pinkie.copyRef', label: '复制代码位置', contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 9, run: () => { const s = editor.getSelection(); copyText(state.active + ':' + s.startLineNumber + (s.endLineNumber !== s.startLineNumber ? '-' + s.endLineNumber : '')); }});
    editor.onDidChangeCursorSelection(() => renderStatusSoon());
    editor.onDidChangeModel(() => renderStatusSoon());
    m.editor.onDidChangeMarkers(debounce(() => { renderStatus(); if (state.panelOpen && state.panelTab === 'problems') renderPanel(); }, 250));
    return editor;
  }
  // 代码模块（语言服务 / AI / 运行 / 模型路由）在编辑器加载后才注入；命令需要它时先把它加载好
  async function codeModule() {
    await ensureEditor();
    for (let i = 0; i < 60 && !window.__pinkieWorkbenchCode; i++) await new Promise(r => setTimeout(r, 100));
    return window.__pinkieWorkbench;
  }
  async function ensureDiff() {
    const m = await loadMonaco();
    if (diffEditor) return diffEditor;
    applyTheme();
    diffEditor = m.editor.createDiffEditor(diffHost, {automaticLayout: false, fontFamily: '"SF Mono", Menlo, ui-monospace, monospace', fontSize: 13, lineHeight: 20, renderSideBySide: true, readOnly: false, originalEditable: false, minimap: {enabled: false}, scrollBeyondLastLine: false, renderOverviewRuler: true, useInlineViewWhenSpaceIsLimited: true, hideUnchangedRegions: {enabled: true}});
    diffEditor.getModifiedEditor().addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveActive());
    return diffEditor;
  }
  function languageFor(path) {
    const m = window.monaco;
    const name = basename(path).toLowerCase();
    const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
    for (const lang of m.languages.getLanguages()) {
      if (lang.filenames?.some(f => f.toLowerCase() === name)) return lang.id;
    }
    const special = {'.mjs': 'javascript', '.cjs': 'javascript', '.mts': 'typescript', '.cts': 'typescript', '.jsonc': 'json', '.zsh': 'shell', '.env': 'ini', '.toml': 'ini', '.vue': 'html', '.svelte': 'html', '.plist': 'xml', '.gradle': 'java'};
    if (special[ext]) return special[ext];
    if (/^\.env(\.|$)/.test(name)) return 'ini';
    for (const lang of m.languages.getLanguages()) if (ext && lang.extensions?.includes(ext)) return lang.id;
    return 'plaintext';
  }
  const uriFor = path => window.monaco.Uri.from({scheme: 'pinkie', path: '/' + path.replace(/^\/+/, '')});
  function langName(id) {
    const lang = window.monaco?.languages.getLanguages().find(l => l.id === id);
    return lang?.aliases?.[0] || id;
  }

  /* ───────── 标签与打开文件 ───────── */
  const findTab = path => state.tabs.find(t => t.path === path);
  function fileLocation(file) {
    if (!file.startsWith('/')) return {name: state.info?.name || '当前项目', root: '', relative: file};
    const roots = [{path: state.root, name: state.info?.bound ? state.info.name : (MODE_NAME[state.info?.agentId] || '当前模式') + '工作区'},
      {path: state.info?.workspaceRoot, name: (MODE_NAME[state.info?.agentId] || '当前模式') + '工作区'}, ...state.referenceFolders];
    const found = roots.filter(r => r.path && (file === r.path || file.startsWith(r.path.replace(/\/$/, '') + '/'))).sort((a, b) => b.path.length - a.path.length)[0];
    return found ? {name: found.name || basename(found.path), root: found.path, relative: file.slice(found.path.length).replace(/^\//, '')}
      : {name: basename(dirname(file)) || '/', root: dirname(file), relative: basename(file)};
  }
  async function openFile(path, options = {}) {
    if (!path) return;
    let tab = findTab(path);
    if (!tab) {
      // 预览标签（斜体）会被下一个预览替换，和 VS Code 一样；双击或编辑后固定。
      const previewTab = options.preview ? state.tabs.find(t => !t.pinned && t.kind !== 'diff' && !t.dirty) : null;
      tab = {path, name: basename(path), kind: 'pending', pinned: !options.preview};
      if (previewTab) { const i = state.tabs.indexOf(previewTab); disposeTab(previewTab); state.tabs.splice(i, 1, tab); }
      else { const i = state.tabs.findIndex(t => t.path === state.active); state.tabs.splice(i < 0 ? state.tabs.length : i + 1, 0, tab); }
    } else if (options.pinned) tab.pinned = true;
    await activate(path, options);
  }
  function pinTab(path) { const tab = findTab(path); if (tab && !tab.pinned) { tab.pinned = true; renderTabs(); } }
  async function loadTab(tab) {
    tab.kind = 'loading'; renderTabs();
    try {
      const result = await rpc('pinkie.fs.read', {path: tab.path}, 30000);
      tab.mtimeMs = result.mtimeMs; tab.size = result.size; tab.readOnly = Boolean(result.readOnly);
      // .ipynb 不按文本打开：交给笔记本视图（cell 可编辑 + 可执行）
      if (/\.ipynb$/i.test(tab.path) && result.kind === 'text') {
        tab.kind = 'notebook';
        tab.readOnly = Boolean(result.readOnly);
        return;
      }
      if (result.kind === 'text') {
        await ensureEditor();
        tab.kind = 'text'; tab.eol = result.eol;
        const uri = uriFor(tab.path);
        window.monaco.editor.getModel(uri)?.dispose();
        tab.model = window.monaco.editor.createModel(result.content, languageFor(tab.path), uri);
        tab.model.setEOL(result.eol === 'crlf' ? 1 : 0);
        tab.saved = tab.model.getAlternativeVersionId();
        trackModel(tab);
        emitModel('open', tab);
        if (result.dataUrl) tab.dataUrl = result.dataUrl;
      } else { tab.kind = result.kind; tab.dataUrl = result.dataUrl; }
    } catch (error) { tab.kind = 'error'; tab.error = error.message; }
  }
  function trackModel(tab) {
    tab.model.onDidChangeContent(() => {
      const dirty = tab.model.getAlternativeVersionId() !== tab.saved;
      if (!tab.pinned) tab.pinned = true;
      if (dirty !== tab.dirty) { tab.dirty = dirty; renderTabs(); renderTree(); }
    });
  }
  async function activate(path, options = {}) {
    const tab = findTab(path);
    if (!tab) return;
    const activeKey = state.key, activeRoot = state.root;
    const isCurrent = () => state.key === activeKey && state.root === activeRoot && state.active === path && findTab(path) === tab;
    const prev = findTab(state.active);
    if (prev?.model && editor?.getModel() === prev.model) prev.viewState = editor.saveViewState();
    state.active = path; state.selected = path.startsWith('diff:') ? state.selected : path;
    if (tab.kind === 'pending') { renderTabs(); await loadTab(tab); if (!isCurrent()) return; }
    renderTabs(); renderCrumbs(); renderTree(); hideNotice();
    monacoHost.hidden = diffHost.hidden = preview.hidden = welcome.hidden = true;
    if (tab.kind !== 'diff' && tab.kind !== 'error' && tab.kind !== 'page') remember(path);
    if (tab.kind === 'text') {
      await ensureEditor();
      if (!isCurrent()) return;
      monacoHost.hidden = false;
      if (editor.getModel() !== tab.model) editor.setModel(tab.model);
      editor.updateOptions({readOnly: Boolean(tab.readOnly)});
      if (tab.viewState) editor.restoreViewState(tab.viewState);
      place();
      if (options.line) {
        const range = new window.monaco.Range(options.line, options.column || 1, options.line, (options.column || 1) + (options.length || 0));
        editor.revealRangeInCenterIfOutsideViewport(range);
        editor.setSelection(range);
        flashLine(options.line);
      }
      if (options.focus !== false && state.visible && wanted()) editor.focus();
    } else if (tab.kind === 'notebook') {
      preview.hidden = false; preview.classList.remove('is-page');
      preview.replaceChildren();
      const host = el('div', 'pk-nb-host');
      preview.append(host);
      await ensureNotebook();
      try {
        await window.__pinkieNotebook.open(host, absolute(tab.path));
      } catch (error) {
        console.warn('[workbench] notebook open failed', error);
      }
    } else if (tab.kind === 'page') {
      preview.hidden = false; preview.classList.add('is-page'); preview.replaceChildren();
      try { tab.render(preview); } catch (error) { preview.append(el('p', 'pk-wb-msg pk-wb-msg--error', error.message)); }
    } else if (tab.kind === 'diff') {
      await ensureDiff();
      if (!isCurrent()) return;
      diffHost.hidden = false;
      diffEditor.setModel({original: tab.original, modified: tab.modified});
      place();
    } else renderPreview(tab);
    renderStatus(); persistTabs();
    if (state.view === 'explorer' && !path.startsWith('diff:') && !path.startsWith('page:')) revealInTree(path);
  }
  function flashLine(line) {
    if (!editor) return;
    const ids = editor.deltaDecorations([], [{range: new window.monaco.Range(line, 1, line, 1), options: {isWholeLine: true, className: 'pk-wb-flash'}}]);
    setTimeout(() => editor.deltaDecorations(ids, []), 1400);
  }
  function renderPreview(tab) {
    preview.hidden = false; preview.classList.remove('is-page');
    preview.replaceChildren();
    const card = el('div', 'pk-wb-preview__card');
    if (tab.kind === 'image' && tab.dataUrl) {
      const img = el('img', 'pk-wb-preview__img'); img.src = tab.dataUrl; img.alt = tab.name;
      const meta = el('p', 'pk-wb-preview__meta');
      img.onload = () => { meta.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' · ' + size(tab.size); };
      preview.append(img, meta); return;
    }
    if (tab.kind === 'loading') { card.append(el('div', 'pk-wb-spinner'), el('p', '', '正在打开…')); preview.append(card); return; }
    const text = {binary: '这是二进制文件，工作台不直接显示。', 'too-large': '文件超过 8 MB，工作台里不打开。', error: tab.error || '打不开这个文件。'}[tab.kind] || '打不开这个文件。';
    card.append(icon(tab.kind === 'error' ? 'warning' : 'file-binary', 'pk-wb-preview__icon'), el('p', '', text));
    if (tab.kind !== 'error') card.append(Object.assign(el('button', 'pk-wb-btn', '用系统默认程序打开'), {type: 'button', onclick: () => rpc('pinkie.fs.reveal', {path: tab.path, open: true}).catch(e => toast(e.message))}));
    preview.append(card);
  }
  const size = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

  function disposeTab(tab) { if (tab.kind === 'diff') { tab.original?.dispose(); tab.modifiedOwned && tab.modified?.dispose(); } else if (tab.model) { emitModel('close', tab); tab.model.dispose(); } }
  function emitModel(type, tab) { try { window.dispatchEvent(new CustomEvent('pinkie:wb-model', {detail: {type, path: tab.path, model: tab.model, absolute: absolute(tab.path)}})); } catch {} }
  function closeTab(path, force) {
    const tab = findTab(path);
    if (!tab) return;
    if (tab.dirty && !force) {
      if (!confirmTwice('close:' + path, '「' + tab.name + '」还没保存。再关一次会放弃改动（' + keyLabel('⌘S') + ' 保存）')) return;
    }
    const index = state.tabs.indexOf(tab);
    if (editor?.getModel() === tab.model) editor.setModel(null);
    if (tab.kind === 'diff' && diffEditor) diffEditor.setModel(null);
    disposeTab(tab);
    state.tabs.splice(index, 1);
    if (state.active === path) {
      const next = state.tabs[index] || state.tabs[index - 1];
      state.active = '';
      if (next) void activate(next.path); else { renderTabs(); renderCrumbs(); renderWelcome(); renderStatus(); renderTree(); }
    } else renderTabs();
    persistTabs();
  }
  function closeAllTabs(force) {
    for (const tab of [...state.tabs]) { if (editor?.getModel() === tab.model) editor.setModel(null); if (tab.kind === 'diff') diffEditor?.setModel(null); disposeTab(tab); }
    state.tabs = []; state.active = '';
    if (!force) persistTabs();
    renderTabs(); renderCrumbs(); renderWelcome();
  }
  function renderTabs() {
    const names = new Map();
    for (const t of state.tabs) names.set(t.name, (names.get(t.name) || 0) + 1);
    const frag = document.createDocumentFragment();
    for (const tab of state.tabs) {
      const t = el('div', 'pk-wb-tab');
      t.setAttribute('role', 'tab'); t.dataset.path = tab.path; t.title = tab.kind === 'diff' ? tab.title : absolute(tab.path);
      t.setAttribute('aria-selected', String(tab.path === state.active));
      if (tab.path === state.active) t.classList.add('is-active');
      if (!tab.pinned) t.classList.add('is-preview');
      if (tab.dirty) t.classList.add('is-dirty');
      t.append(tab.kind === 'diff' ? icon('diff', 'pk-wb-tab__diff') : tab.kind === 'page' ? icon(tab.icon || 'settings', 'pk-wb-tab__diff') : fileIcon(tab.name, 'file'));
      const label = el('span', 'pk-wb-tab__label', tab.kind === 'diff' || tab.kind === 'page' ? tab.title : tab.name);
      t.append(label);
      if (names.get(tab.name) > 1 && tab.kind !== 'diff') { const loc = fileLocation(tab.path); t.append(el('span', 'pk-wb-tab__dir', dirname(loc.relative) || loc.name)); }
      if (tab.readOnly) { const lock = icon('lock', 'pk-wb-tab__readonly'); lock.title = '参考文件 · 只读'; t.append(lock); }
      const close = button('close', '关闭（' + keyLabel('⌘W') + '）', e => { e.stopPropagation(); closeTab(tab.path); }, 'pk-wb-tab__close');
      t.append(close);
      t.addEventListener('click', () => activate(tab.path));
      t.addEventListener('dblclick', () => pinTab(tab.path));
      t.addEventListener('auxclick', e => { if (e.button === 1) closeTab(tab.path); });
      t.addEventListener('contextmenu', e => { e.preventDefault(); showMenu([
        {label: '关闭', key: '⌘W', run: () => closeTab(tab.path)},
        {label: '关闭其他', run: () => state.tabs.filter(x => x !== tab && !x.dirty).forEach(x => closeTab(x.path))},
        {label: '关闭右侧', run: () => state.tabs.slice(state.tabs.indexOf(tab) + 1).filter(x => !x.dirty).forEach(x => closeTab(x.path))},
        {label: '关闭已保存的', run: () => state.tabs.filter(x => !x.dirty).forEach(x => closeTab(x.path))},
        '-', ...(tab.kind !== 'diff' ? [{label: '复制路径', run: () => copyText(absolute(tab.path))}, {label: '在资源管理器中显示', run: () => { openView('explorer'); revealInTree(tab.path); }}] : []),
      ], e.clientX, e.clientY); });
      frag.append(t);
    }
    tabsList.replaceChildren(frag);
    tabsList.querySelector('.is-active')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    tabsBar.classList.toggle('is-empty', !state.tabs.length);
    const tab = findTab(state.active);
    const extra = [];
    for (const make of (window.__pinkieWorkbench.tabActions || new Map()).values()) { try { const node = make(tab); if (node) extra.push(node); } catch {} }
    tabsActions.replaceChildren(
      ...extra,
      ...(tab?.kind === 'text' && state.git?.repo ? [button('git-compare', '和上次提交比较', () => openDiff(tab.path, false))] : []),
      ...(tab?.kind === 'text' && /\.(md|markdown|html?)$/i.test(tab.path) ? [button('open-preview', '在侧栏浏览器预览', () => previewInBrowser(tab))] : []),
    );
    actTerminal.classList.toggle('is-on', state.panelOpen);
  }
  function renderCrumbs() {
    const tab = findTab(state.active);
    crumbs.replaceChildren();
    crumbs.hidden = !tab;
    if (!tab) return;
    if (tab.kind === 'diff' || tab.kind === 'page') { crumbs.append(icon(tab.kind === 'page' ? tab.icon || 'settings' : 'diff'), el('span', 'pk-wb-crumb', tab.title)); return; }
    const loc = fileLocation(tab.path);
    const parts = loc.relative.split('/').filter(Boolean);
    if (loc.root) {
      const c = el('button', 'pk-wb-crumb pk-wb-crumb--root', loc.name); c.type = 'button'; c.title = loc.root;
      c.addEventListener('click', () => { openView('explorer'); revealInTree(loc.root); });
      crumbs.append(c, icon('chevron-right', 'pk-wb-crumb__sep'));
    }
    parts.forEach((part, i) => {
      if (i) crumbs.append(icon('chevron-right', 'pk-wb-crumb__sep'));
      const c = el('button', 'pk-wb-crumb'); c.type = 'button';
      if (i === parts.length - 1) c.append(fileIcon(part, 'file'));
      c.append(el('span', '', part));
      const prefix = (loc.root ? loc.root.replace(/\/$/, '') + '/' : '') + parts.slice(0, i + 1).join('/');
      c.title = absolute(prefix);
      c.addEventListener('click', () => { if (i < parts.length - 1) { openView('explorer'); toggleDir(prefix, true).then(() => revealInTree(prefix)); } });
      crumbs.append(c);
    });
  }

  function renderWelcome() {
    const show = !state.active;
    welcome.hidden = !show;
    if (show) { monacoHost.hidden = diffHost.hidden = preview.hidden = true; }
    if (!show) return;
    welcome.replaceChildren();
    const mark = el('div', 'pk-wb-welcome__mark');
    mark.append(el('i', 'pk-wb-mark'));
    const title = el('h1', 'pk-wb-welcome__title', state.info?.name || '碧琪工作台');
    const sub = el('p', 'pk-wb-welcome__sub', state.info?.error ? state.info.error : state.info ? (state.info.bound ? '项目文件夹 · ' : '工作区 · ') + state.info.root : '正在连接…');
    const keys = el('div', 'pk-wb-welcome__keys');
    for (const [label, k, run] of [['快速打开文件', '⌘P', () => showQuick('')], ['在文件中搜索', '⇧⌘F', () => openView('search')], ['打开终端', '⌃`', () => togglePanel('terminal', true)], ['命令', '⇧⌘P', () => showQuick('>')], ['问碧琪', '⌘L', () => askPinkie()]]) {
      const row = el('button', 'pk-wb-welcome__key'); row.type = 'button';
      row.append(el('span', '', label), el('kbd', '', keyLabel(k)));
      row.addEventListener('click', run);
      keys.append(row);
    }
    const recent = store.get('recent.' + state.root, []).filter(p => !findTab(p)).slice(0, 6);
    welcome.append(mark, title, sub, keys);
    if (recent.length) {
      const list = el('div', 'pk-wb-welcome__recent');
      list.append(el('h3', '', '最近打开'));
      for (const p of recent) { const r = el('button', 'pk-wb-welcome__file'); r.type = 'button'; r.append(fileIcon(basename(p), 'file'), el('span', '', basename(p)), el('small', '', dirname(p))); r.addEventListener('click', () => openFile(p, {pinned: true})); list.append(r); }
      welcome.append(list);
    }
  }
  function remember(path) {
    const key = 'recent.' + state.root;
    store.set(key, [path, ...store.get(key, []).filter(p => p !== path)].slice(0, 20));
  }

  /* ───────── 保存、冲突、同步碧琪的改动 ───────── */
  async function saveActive(force) {
    let tab = findTab(state.active);
    if (tab?.kind === 'diff') tab = findTab(tab.source);
    if (!tab?.model) return;
    if (tab.readOnly) { toast('这是项目外的参考文件；请在当前项目中保存修改。'); return; }
    try { await window.__pinkieWorkbench.beforeSave?.(tab); } catch {}
    const content = tab.model.getValue(tab.eol === 'crlf' ? 2 : 1);
    try {
      const version = tab.model.getAlternativeVersionId();
      const result = await rpc('pinkie.fs.write', {path: tab.path, content, baseMtimeMs: tab.mtimeMs, force: !!force}, 30000);
      tab.mtimeMs = result.mtimeMs; tab.saved = version; tab.dirty = tab.model.getAlternativeVersionId() !== version;
      renderTabs(); renderTree(); hideNotice(); remember(tab.path);
      emitModel('save', tab);
      statusFlash('已保存 ' + tab.name);
      refreshGit();
    } catch (error) {
      if (/别处被修改|不存在/.test(error.message)) conflictNotice(tab, error.message);
      else toast('保存失败：' + error.message);
    }
  }
  function conflictNotice(tab, message) {
    showBar(message, [
      {label: '比较', run: () => compareWithDisk(tab)},
      {label: '用我的覆盖', run: () => saveActive(true)},
      {label: '重新载入（放弃我的改动）', run: () => reloadTab(tab, true)},
    ]);
  }
  async function reloadTab(tab, force) {
    try {
      const result = await rpc('pinkie.fs.read', {path: tab.path}, 30000);
      if (result.kind !== 'text' || !tab.model) return;
      if (tab.dirty && !force) return;
      const view = editor?.getModel() === tab.model ? editor.saveViewState() : null;
      tab.model.pushEditOperations([], [{range: tab.model.getFullModelRange(), text: result.content}], () => null);
      tab.mtimeMs = result.mtimeMs; tab.saved = tab.model.getAlternativeVersionId(); tab.dirty = false;
      if (view) editor.restoreViewState(view);
      hideNotice(); renderTabs(); renderTree();
    } catch (error) { toast(error.message); }
  }
  async function compareWithDisk(tab) {
    try {
      const disk = await rpc('pinkie.fs.read', {path: tab.path});
      const m = await loadMonaco();
      await openDiffTab({id: 'diff:disk:' + tab.path, title: tab.name + '（磁盘 ↔ 我的）', source: tab.path, original: m.editor.createModel(disk.content || '', languageFor(tab.path)), modified: tab.model, modifiedOwned: false});
    } catch (error) { toast(error.message); }
  }
  // 打开的文件被碧琪（或别的程序）改了：没改动就直接载入新内容，有改动就提示冲突。
  async function checkOpenFiles() {
    const tabs = state.tabs.filter(t => t.kind === 'text' && t.mtimeMs);
    if (!tabs.length || !state.visible || document.hidden) return;
    let stats;
    try { ({stats} = await rpc('pinkie.fs.stat', {paths: tabs.map(t => t.path)})); } catch { return; }
    for (const s of stats) {
      const tab = findTab(s.path);
      if (!tab || !tab.mtimeMs) continue;
      if (!s.exists) { if (!tab.gone) { tab.gone = true; renderTabs(); } continue; }
      tab.gone = false;
      if (s.mtimeMs === tab.mtimeMs) continue;
      if (tab.dirty) { if (tab.path === state.active && notice.hidden) conflictNotice(tab, '「' + tab.name + '」在别处被修改了，你这里也有没保存的改动。'); continue; }
      await reloadTab(tab);
      if (tab.path === state.active) statusFlash('已同步「' + tab.name + '」的最新改动');
    }
  }
  setInterval(() => void checkOpenFiles(), 2500);
  window.addEventListener('focus', () => { if (state.visible) { void checkOpenFiles(); refreshSoon(); } });

  /* ───────── 改动对比（Git） ───────── */
  async function openDiff(path, staged) {
    try {
      const m = await loadMonaco();
      const [base, current] = await Promise.all([rpc('pinkie.fs.gitShow', {path, staged: false}), rpc('pinkie.fs.read', {path}).catch(() => ({kind: 'text', content: ''}))]);
      const open = findTab(path);
      const modified = open?.model || m.editor.createModel(current.kind === 'text' ? current.content : '', languageFor(path));
      await openDiffTab({id: 'diff:' + path, title: basename(path) + '（上次提交 ↔ 现在）', source: path, original: m.editor.createModel(base.content, languageFor(path)), modified, modifiedOwned: !open?.model});
    } catch (error) { toast(error.message); }
  }
  async function openDiffTab(spec) {
    const existing = findTab(spec.id);
    if (existing) { disposeTab(existing); state.tabs.splice(state.tabs.indexOf(existing), 1); }
    state.tabs.push({path: spec.id, name: spec.title, title: spec.title, kind: 'diff', pinned: true, original: spec.original, modified: spec.modified, modifiedOwned: spec.modifiedOwned, source: spec.source});
    await activate(spec.id);
  }
  async function refreshGit() {
    if (!state.key || !state.visible) return;
    try { state.git = await rpc('pinkie.fs.git'); } catch { state.git = null; }
    const count = state.git?.changes?.length || 0;
    const badge = activityButtons.scm.querySelector('.pk-wb-badge');
    badge.hidden = !count; badge.textContent = count > 99 ? '99' : String(count); badge.title = count + ' 个改动';
    if (state.view === 'scm' && state.sideOpen) renderScm();
    renderTree(); renderStatus();
  }
  async function gitAction(action, paths, extra = {}) {
    try {
      const result = await rpc('pinkie.fs.gitAction', {action, paths, ...extra}, 60000);
      if (action === 'discard') {
        for (const p of paths) { const tab = findTab(p); if (tab) await reloadTab(tab, true); }
        toast('已放弃 ' + paths.length + ' 个文件的改动（原内容在碧琪回收站）', {label: '撤销', run: async () => { for (const id of result.trashIds || []) await rpc('pinkie.fs.restore', {trashId: id}).catch(e => toast(e.message)); refreshSoon(); for (const p of paths) { const tab = findTab(p); if (tab) await reloadTab(tab, true); } }});
      }
      if (action === 'commit') toast('已提交：' + (result.summary || ''));
      await refreshGit(); refreshTree();
      return result;
    } catch (error) { toast(error.message); return null; }
  }

  /* ───────── 侧栏视图 ───────── */
  // 在工作台里选文件夹开工：弹出系统选择器（App 内）或粘贴路径（外部浏览器），绑定当前会话后切根目录
  function pickFolderDialog(initialPath, {reference = false} = {}) {
    const bridge = window.webkit?.messageHandlers?.laolaoProjectFolder;
    if (bridge) {
      return new Promise((resolve) => {
        const requestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        const previous = window.__laolaoProjectFolderResult;
        let timer;
        const handler = (payload) => {
          if (payload?.requestId !== requestId) { if (typeof previous === 'function') previous(payload); return; }
          clearTimeout(timer);
          if (window.__laolaoProjectFolderResult === handler) window.__laolaoProjectFolderResult = previous;
          resolve(payload);
        };
        window.__laolaoProjectFolderResult = handler;
        timer = setTimeout(() => handler({ requestId, timeout: true }), 120000);
        try { bridge.postMessage({ action: 'choose', requestId, path: initialPath || '' }); }
        catch { handler({ requestId, error: true }); }
      });
    }
    const request = reference ? async (method, params, timeout) => {
      if (method !== 'pinkie.project.validate') return rpc(method, params, timeout);
      const listed = await rpc('pinkie.fs.list', {path: params.path});
      return {path: listed.absolutePath || params.path};
    } : rpc;
    return window.PinkieSessionList?.chooseFolder(initialPath, request) || Promise.resolve(null);
  }
  async function pickAndBindFolder() {
    try {
      const picked = await pickFolderDialog(state.root);
      if (!picked || picked.cancelled || picked.timeout || picked.error || !picked.path) return;
      const result = await rpc('pinkie.project.bind', { key: state.key, path: picked.path, name: picked.name || picked.path.split('/').filter(Boolean).pop() }, 15000);
      if (result?.binding?.root) {
        toast('已绑定项目文件夹：' + result.binding.root);
        window.dispatchEvent(new CustomEvent('pinkie:project-scope-changed', {detail:{key:state.key,path:result.binding.root}}));
      }
    } catch (error) {
      toast('文件夹未打开：' + error.message);
    }
  }
  async function browseReferenceFolder() {
    try {
      const picked = await pickFolderDialog(state.info?.workspaceRoot || state.root, {reference: true});
      if (!picked?.path || picked.cancelled || picked.error || picked.timeout) return;
      const listed = await rpc('pinkie.fs.list', {path: picked.path});
      const path = listed.absolutePath || picked.path;
      if (path === state.root) { toast('这就是当前项目文件夹。'); return; }
      state.referenceFolders = [...state.referenceFolders.filter(item => item.path !== path), {path, name: picked.name || basename(path) || path}].slice(-8);
      store.set('references.' + state.info.agentId, state.referenceFolders);
      state.tree.set(path, listed.entries); state.expanded.add(path); renderTree(); persistTabs();
      toast('已打开参考目录，当前项目保持不变。');
    } catch (error) { toast('目录未打开：' + error.message); }
  }
  function renderSide() {
    for (const [id, b] of Object.entries(activityButtons)) { b.classList.toggle('is-active', state.view === id); b.setAttribute('aria-selected', String(state.view === id)); }
    activity.classList.toggle('is-vertical', !state.sideOpen);
    if (!state.sideOpen) return;
    sideActions.replaceChildren();
    sideBody.replaceChildren();
    sideBody.tabIndex = -1;
    if (state.view === 'explorer') {
      sideTitle.textContent = '资源管理器';
      // 文件操作放在项目名那一行（悬停显示），卡片顶部只留视图标签，窄的时候也不挤
      const head = el('div', 'pk-wb-project');
      head.title = state.info?.root || '';
      head.append(icon('root-folder'), el('span', 'pk-wb-project__name', state.info?.bound ? state.info.name : '当前项目'));
      if (state.info) head.append(el('span', 'pk-wb-project__tag', state.info.bound ? '主目录' : '未打开'));
      const acts = el('span', 'pk-wb-project__acts');
      acts.append(
        button('folder-opened', '打开文件夹（选目录开工）', () => pickAndBindFolder()),
        button('new-file', '新建文件', () => newEntry(selectedDir(), 'file')),
        button('new-folder', '新建文件夹', () => newEntry(selectedDir(), 'dir')),
        button('refresh', '刷新', () => refreshAll()),
        button('collapse-all', '全部折叠', () => { state.expanded.clear(); renderTree(); persistTabs(); }),
      );
      head.append(acts);
      const list = el('div', 'pk-wb-tree'); list.setAttribute('role', 'tree'); list.tabIndex = 0;
      treeEvents(list);
      sideBody.append(head, list);
      renderTree();
    } else if (state.view === 'search') {
      sideTitle.textContent = '搜索';
      sideActions.append(button('clear-all', '清除结果', () => { state.search.results = null; state.search.query = ''; renderSide(); }), button('collapse-all', '全部折叠', () => { sideBody.querySelectorAll('.pk-wb-hits').forEach(n => n.classList.add('is-collapsed')); }));
      renderSearch();
    } else if (state.view === 'extensions') {
      sideTitle.textContent = '扩展';
      sideActions.append(button('refresh', '刷新', () => loadExtensions(true)));
      renderExtensions();
    } else if (state.view === 'scm') {
      sideTitle.textContent = '源代码管理';
      sideActions.append(button('refresh', '刷新', () => refreshGit()), button('check', '提交（' + keyLabel('⌘↵') + '）', () => commit()));
      renderScm();
    }
  }
  const selectedDir = () => { const p = state.selected; if (!p) return ''; const entries = state.tree.get(dirname(p)); const e = Array.isArray(entries) && entries.find(x => x.path === p); return e?.kind === 'dir' ? p : dirname(p); };

  function toggleChip(name, title, keyName) {
    const b = button(name, title, () => { state.search[keyName] = !state.search[keyName]; b.classList.toggle('is-on', state.search[keyName]); runSearch(); }, 'pk-wb-chip');
    b.classList.toggle('is-on', !!state.search[keyName]);
    return b;
  }
  function renderSearch() {
    const s = state.search;
    const box = el('div', 'pk-wb-search');
    const row = el('div', 'pk-wb-search__row');
    const expand = button(s.showReplace ? 'chevron-down' : 'chevron-right', '切换替换', () => { s.showReplace = !s.showReplace; renderSide(); }, 'pk-wb-search__expand');
    const fields = el('div', 'pk-wb-search__fields');
    const qWrap = el('div', 'pk-wb-field');
    const q = el('input', 'pk-wb-search__query'); q.placeholder = '搜索'; q.value = s.query; q.spellcheck = false;
    q.addEventListener('input', () => { s.query = q.value; searchSoon(); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
    qWrap.append(q, toggleChip('case-sensitive', '区分大小写', 'caseSensitive'), toggleChip('whole-word', '全字匹配', 'wholeWord'), toggleChip('regex', '使用正则表达式', 'regex'));
    fields.append(qWrap);
    if (s.showReplace) {
      const rWrap = el('div', 'pk-wb-field');
      const r = el('input', 'pk-wb-search__replace'); r.placeholder = '替换'; r.value = s.replace; r.spellcheck = false;
      r.addEventListener('input', () => { s.replace = r.value; });
      const all = button('replace-all', '全部替换', () => replaceAll(), 'pk-wb-chip');
      rWrap.append(r, all); fields.append(rWrap);
    }
    row.append(expand, fields);
    const more = button('ellipsis', '包含 / 排除的文件', () => { s.showFilters = !s.showFilters; renderSide(); }, 'pk-wb-search__more');
    box.append(row, more);
    if (s.showFilters) {
      const inc = el('input', 'pk-wb-input'); inc.placeholder = '要包含的文件（例如 *.ts, src/**）'; inc.value = s.include;
      const exc = el('input', 'pk-wb-input'); exc.placeholder = '要排除的文件'; exc.value = s.exclude;
      inc.addEventListener('input', () => { s.include = inc.value; searchSoon(); }); exc.addEventListener('input', () => { s.exclude = exc.value; searchSoon(); });
      box.append(el('label', 'pk-wb-label', '包含'), inc, el('label', 'pk-wb-label', '排除'), exc);
    }
    const results = el('div', 'pk-wb-results');
    box.append(results);
    sideBody.append(box);
    renderResults(results);
  }
  const searchSoon = debounce(() => runSearch(), 380);
  let searchSeq = 0;
  async function runSearch() {
    const s = state.search;
    const seq = ++searchSeq;
    if (!s.query) { s.results = null; renderResults(); return; }
    s.busy = true; renderResults();
    try {
      const result = await rpc('pinkie.fs.search', {query: s.query, caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, regex: s.regex, include: s.include, exclude: s.exclude}, 30000);
      if (seq !== searchSeq) return;
      s.results = result;
    } catch (error) { if (seq === searchSeq) s.results = {error: error.message}; }
    s.busy = false; renderResults();
  }
  function renderResults(target) {
    const box = target || sideBody.querySelector('.pk-wb-results');
    if (!box) return;
    const r = state.search.results;
    box.replaceChildren();
    if (state.search.busy) { box.append(el('div', 'pk-wb-progress')); }
    if (!r) return;
    if (r.error) { box.append(el('p', 'pk-wb-msg pk-wb-msg--error', r.error)); return; }
    box.append(el('p', 'pk-wb-msg', r.total ? r.results.length + ' 个文件中有 ' + r.total + ' 个结果' + (r.limited ? '（只显示前面部分）' : '') : '没有找到结果。'));
    for (const file of r.results) {
      const group = el('div', 'pk-wb-hits');
      const head = el('button', 'pk-wb-hits__file'); head.type = 'button';
      head.append(icon('chevron-down', 'pk-wb-hits__twist'), fileIcon(basename(file.path), 'file'), el('span', 'pk-wb-hits__name', basename(file.path)), el('span', 'pk-wb-hits__dir', dirname(file.path)), el('span', 'pk-wb-count', String(file.matches.length)));
      head.addEventListener('click', () => group.classList.toggle('is-collapsed'));
      group.append(head);
      for (const match of file.matches.slice(0, 200)) {
        const line = el('button', 'pk-wb-hit'); line.type = 'button';
        const text = match.preview;
        const start = Math.max(0, match.column - 1 - 26);
        const pre = (start ? '…' : '') + text.slice(start, match.column - 1).trimStart();
        const hit = text.slice(match.column - 1, match.column - 1 + match.length);
        const post = text.slice(match.column - 1 + match.length, match.column - 1 + match.length + 120);
        line.append(el('span', '', pre), el('mark', state.search.showReplace && state.search.replace ? 'is-replaced' : '', hit));
        if (state.search.showReplace && state.search.replace) line.append(el('ins', '', state.search.regex ? '' : state.search.replace));
        line.append(el('span', '', post));
        line.title = file.path + ':' + match.line;
        line.addEventListener('click', () => openFile(file.path, {pinned: true, line: match.line, column: match.column, length: match.length, focus: false}));
        group.append(line);
      }
      box.append(group);
    }
  }
  async function replaceAll() {
    const s = state.search, r = s.results;
    if (!r?.total) return;
    const dirtyOpen = state.tabs.filter(t => t.dirty && r.results.some(f => f.path === t.path));
    if (dirtyOpen.length) { toast('先保存这些文件再替换：' + dirtyOpen.map(t => t.name).join('、')); return; }
    try {
      const result = await rpc('pinkie.fs.replaceAll', {query: s.query, replacement: s.replace, regex: s.regex, caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, paths: r.results.map(f => f.path)}, 60000);
      toast('已在 ' + result.changedFiles + ' 个文件里替换 ' + result.replacements + ' 处', {label: '撤销', run: async () => { for (const id of result.trashIds || []) await rpc('pinkie.fs.restore', {trashId: id}).catch(e => toast(e.message)); for (const f of r.results) { const tab = findTab(f.path); if (tab) await reloadTab(tab, true); } runSearch(); refreshGit(); toast('已撤销这次替换'); }});
      for (const f of r.results) { const tab = findTab(f.path); if (tab) await reloadTab(tab); }
      runSearch(); refreshGit();
    } catch (error) { toast(error.message); }
  }

  function renderScm() {
    if (state.view !== 'scm' || !state.sideOpen) return;
    sideBody.replaceChildren();
    const g = state.git;
    if (!g) { sideBody.append(el('div', 'pk-wb-progress')); return; }
    if (!g.repo) {
      const empty = el('div', 'pk-wb-empty');
      empty.append(icon('source-control', 'pk-wb-empty__icon'), el('p', '', '这个文件夹还不是 Git 仓库。'));
      const init = el('button', 'pk-wb-btn', '在终端里初始化（git init）'); init.type = 'button';
      init.addEventListener('click', () => { togglePanel('terminal', true); setTimeout(() => terminalType('git init\r'), 900); });
      empty.append(init); sideBody.append(empty); return;
    }
    const box = el('div', 'pk-wb-scm');
    const msg = el('textarea', 'pk-wb-scm__msg'); msg.rows = 3; msg.placeholder = '提交说明（' + keyLabel('⌘↵') + ' 提交，分支 ' + g.branch + '）'; msg.value = store.get('commitMsg.' + state.root, '');
    msg.addEventListener('input', () => store.set('commitMsg.' + state.root, msg.value));
    msg.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } });
    const staged = g.changes.filter(c => c.staged), unstaged = g.changes.filter(c => !c.staged);
    const go = el('button', 'pk-wb-btn pk-wb-btn--primary'); go.type = 'button';
    go.append(icon('check'), el('span', '', staged.length ? '提交暂存的 ' + staged.length + ' 项' : unstaged.length ? '全部提交' : '没有改动'));
    go.disabled = !g.changes.length;
    go.addEventListener('click', () => commit());
    box.append(msg, go);
    if (g.ahead || g.behind) box.append(el('p', 'pk-wb-msg', (g.ahead ? '比远端多 ' + g.ahead + ' 个提交 ' : '') + (g.behind ? '落后远端 ' + g.behind + ' 个提交' : '') + '（推送 / 拉取请在终端里做）'));
    const section = (title, items, isStaged) => {
      if (!items.length) return;
      const sec = el('div', 'pk-wb-scm__sec');
      const head = el('div', 'pk-wb-scm__head');
      head.append(el('span', '', title), el('span', 'pk-wb-count', String(items.length)));
      const acts = el('span', 'pk-wb-scm__acts');
      if (isStaged) acts.append(button('remove', '全部取消暂存', () => gitAction('unstage', items.map(c => c.path))));
      else acts.append(button('discard', '全部放弃改动', () => discard(items)), button('add', '全部暂存', () => gitAction('stage', items.map(c => c.path))));
      head.append(acts);
      sec.append(head);
      for (const c of items) {
        const row = el('div', 'pk-wb-scm__row'); row.dataset.git = c.status; row.tabIndex = 0;
        row.append(fileIcon(basename(c.path), 'file'), el('span', 'pk-wb-scm__name', basename(c.path)), el('span', 'pk-wb-scm__dir', dirname(c.path)));
        const a = el('span', 'pk-wb-scm__acts');
        a.append(button('go-to-file', '打开文件', e => { e.stopPropagation(); openFile(c.path, {pinned: true}); }));
        if (isStaged) a.append(button('remove', '取消暂存', e => { e.stopPropagation(); gitAction('unstage', [c.path]); }));
        else a.append(button('discard', '放弃改动', e => { e.stopPropagation(); discard([c]); }), button('add', '暂存', e => { e.stopPropagation(); gitAction('stage', [c.path]); }));
        row.append(a, el('span', 'pk-wb-scm__st', c.status === 'U' ? 'U' : c.status === 'C' ? '!' : c.status));
        row.addEventListener('click', () => c.status === 'D' || c.status === 'U' ? openFile(c.path, {pinned: true}) : openDiff(c.path, isStaged));
        sec.append(row);
      }
      box.append(sec);
    };
    section('暂存的更改', staged, true);
    section('更改', unstaged, false);
    if (!g.changes.length) box.append(el('p', 'pk-wb-msg', '工作区很干净，没有未提交的改动。'));
    sideBody.append(box);
  }
  async function discard(items) {
    await gitAction('discard', items.map(c => c.path));
  }
  async function commit() {
    const g = state.git;
    if (!g?.repo) return;
    const msgBox = sideBody.querySelector('.pk-wb-scm__msg');
    const message = (msgBox?.value || store.get('commitMsg.' + state.root, '')).trim();
    if (!message) { toast('先写一句提交说明'); msgBox?.focus(); return; }
    for (const tab of state.tabs.filter(t => t.dirty)) { state.active === tab.path ? await saveActive() : null; }
    const staged = g.changes.some(c => c.staged);
    const result = await gitAction('commit', [], {message, all: !staged});
    if (result) { store.set('commitMsg.' + state.root, ''); renderScm(); }
  }

  /* ───────── 扩展市场 ───────── */
  // 语言服务、格式化 / 检查、运行环境、开发工具：一键安装 / 卸载，不弹确认；装完自动接进补全 / 格式化 / 运行 / code_check
  const EXT_KINDS = {lsp: '语言服务', format: '格式化与检查', runtime: '运行环境', tool: '开发工具'};
  const EXT_FILTERS = [['all', '全部'], ['installed', '已安装'], ['recommended', '推荐'], ['lsp', '语言服务'], ['format', '格式化'], ['runtime', '运行环境'], ['tool', '工具']];
  const EXT_ICON_FALLBACK = {github: 'github', ffmpeg: 'file-media', sqlite: 'database', 'list-tree': 'list-tree', globe: 'globe', 'file-media': 'file-media', search: 'search', console: 'terminal', json: 'json'};
  const LANG_BY_EXT = {py: 'python', go: 'go', rs: 'rust', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', m: 'objective-c', swift: 'swift', sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml', php: 'php', lua: 'lua', java: 'java', kt: 'kotlin', kts: 'kotlin', md: 'markdown', sql: 'sql', js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', css: 'css', scss: 'scss', html: 'html', json: 'json', toml: 'toml'};
  async function loadExtensions(force) {
    if (state.ext.busy || (state.ext.items && !force)) return;
    state.ext.busy = true; if (state.view === 'extensions') renderExtensions();
    try { state.ext.items = (await rpc('pinkie.ext.list', {}, 20000)).items; } catch (error) { state.ext.error = error.message; }
    state.ext.busy = false;
    if (state.view === 'extensions' && state.sideOpen) renderExtensions();
    updateExtBadge();
  }
  function projectLanguages() {
    const langs = new Map();
    for (const f of state.files || []) {
      const name = basename(f).toLowerCase();
      const lang = name === 'dockerfile' ? 'dockerfile' : LANG_BY_EXT[name.split('.').pop()];
      if (lang) langs.set(lang, (langs.get(lang) || 0) + 1);
    }
    return langs;
  }
  function recommended(items) {
    const langs = projectLanguages();
    const open = new Set(state.tabs.map(t => t.model?.getLanguageId?.()).filter(Boolean));
    return items.filter(i => !i.installed && (i.kind === 'lsp' || i.kind === 'format') && (i.langs || []).some(l => langs.has(l) || open.has(l)));
  }
  function updateExtBadge() {
    const b = activityButtons.extensions;
    if (!b) return;
    let badge = b.querySelector('.pk-wb-badge');
    if (!badge) { badge = el('span', 'pk-wb-badge pk-wb-badge--soft'); b.append(badge); }
    const busy = (state.ext.items || []).some(i => i.job && i.job.state !== 'done');
    const rec = state.ext.items ? recommended(state.ext.items).length : 0;
    badge.hidden = !busy && !rec;
    badge.textContent = busy ? '…' : String(rec);
    badge.title = busy ? '正在安装' : rec + ' 个推荐给这个项目的扩展';
  }
  function extIcon(item) {
    const wrap = el('span', 'pk-wb-ext__icon');
    const fb = EXT_ICON_FALLBACK[item.icon];
    if (fb && !['search', 'console', 'json'].includes(item.icon)) { wrap.append(icon(fb)); return wrap; }
    const img = el('img'); img.alt = ''; img.src = BASE + 'laolao-vendor-fileicons/' + item.icon + '.svg';
    img.onerror = () => { img.replaceWith(icon(fb || 'extensions')); };
    wrap.append(img);
    return wrap;
  }
  function extButton(item) {
    const job = item.job;
    if (job && job.state !== 'done') {
      const b = el('button', 'pk-wb-ext__btn is-busy'); b.type = 'button'; b.disabled = true;
      b.append(icon('loading', 'codicon-modifier-spin'), el('span', '', job.state === 'queued' ? '排队中' : job.action === 'uninstall' ? '卸载中' : '安装中'));
      return b;
    }
    if (item.installed) {
      if (!item.removable) return el('span', 'pk-wb-ext__tag', item.via === 'system' ? '系统自带' : '已安装');
      const b = el('button', 'pk-wb-ext__btn is-ghost', '卸载'); b.type = 'button';
      b.addEventListener('click', e => { e.stopPropagation(); extAction(item, 'uninstall'); });
      return b;
    }
    const b = el('button', 'pk-wb-ext__btn', '安装'); b.type = 'button';
    if (item.via === 'system') { b.textContent = '如何获取'; b.classList.add('is-ghost'); }
    b.addEventListener('click', e => { e.stopPropagation(); extAction(item, 'install'); });
    return b;
  }
  async function extAction(item, action) {
    try {
      if (item.brew) await rpc('pinkie.ext.brewInstall', {name: item.name, action}, 20000);
      else await rpc(action === 'install' ? 'pinkie.ext.install' : 'pinkie.ext.uninstall', {id: item.id}, 20000);
      item.job = {state: 'queued', action, log: []};
      state.ext.open = item.brew ? 'brew:' + item.name : item.id;
      renderExtensions(); updateExtBadge();
    } catch (error) { toast(error.message); }
  }
  function extRow(item) {
    const key = item.brew ? 'brew:' + item.name : item.id;
    const row = el('div', 'pk-wb-ext' + (state.ext.open === key ? ' is-open' : '') + (item.installed ? ' is-installed' : ''));
    row.tabIndex = 0; row.dataset.id = key;
    const main = el('div', 'pk-wb-ext__main');
    const head = el('div', 'pk-wb-ext__head');
    head.append(el('span', 'pk-wb-ext__name', item.brew ? item.name : item.name));
    if (item.installed) head.append(icon('pass-filled', 'pk-wb-ext__ok'));
    main.append(head, el('div', 'pk-wb-ext__desc', item.desc || ''));
    const meta = el('div', 'pk-wb-ext__meta');
    meta.append(el('span', '', item.brew ? 'Homebrew' + (item.version ? ' · ' + item.version : '') : (EXT_KINDS[item.kind] || '') + ' · ' + item.source));
    if (item.needs) meta.append(el('span', 'pk-wb-ext__warn', '需要先装 ' + item.needs));
    main.append(meta);
    row.append(item.brew ? Object.assign(el('span', 'pk-wb-ext__icon'), {}) : extIcon(item), main, extButton(item));
    if (item.brew) row.firstChild.append(icon('package'));
    if (state.ext.open === key) {
      const more = el('div', 'pk-wb-ext__more');
      if (item.langs?.length) { const chips = el('div', 'pk-wb-ext__chips'); for (const l of item.langs) chips.append(el('span', 'pk-wb-ext__chip', langName(l))); more.append(chips); }
      const facts = [];
      if (item.license) facts.push('许可证：' + item.license);
      if (item.path) facts.push('位置：' + item.path);
      if (item.homepage) facts.push(item.homepage);
      if (item.via === 'system' && !item.installed) facts.push('在终端运行 xcode-select --install 即可获得');
      for (const f of facts) more.append(el('div', 'pk-wb-ext__fact', f));
      if (item.job?.log?.length) { const log = el('pre', 'pk-wb-ext__log'); log.textContent = item.job.log.slice(-12).join('\n'); more.append(log); }
      if (item.job?.state === 'done') more.append(el('div', 'pk-wb-ext__result ' + (item.job.ok ? 'is-ok' : 'is-fail'), item.job.ok ? (item.job.action === 'uninstall' ? '已卸载' : '安装完成，已经可以用了') : '没有成功，详细输出在上面'));
      row.append(more);
    }
    row.addEventListener('click', () => { state.ext.open = state.ext.open === key ? '' : key; renderExtensions(); });
    row.addEventListener('keydown', e => { if (e.key === 'Enter') row.click(); });
    return row;
  }
  function renderExtensions() {
    if (state.view !== 'extensions' || !state.sideOpen) return;
    const scrollTop = sideBody.scrollTop;
    const keepFocus = document.activeElement?.classList?.contains('pk-wb-ext__search');
    const caret = keepFocus ? document.activeElement.selectionStart : 0;
    sideBody.replaceChildren();
    const box = el('div', 'pk-wb-exts');
    const search = el('div', 'pk-wb-field pk-wb-ext__field');
    const q = el('input', 'pk-wb-ext__search'); q.placeholder = '搜索扩展（回车也在 Homebrew 里找）'; q.value = state.ext.query; q.spellcheck = false;
    q.addEventListener('input', () => { state.ext.query = q.value; state.ext.brew = null; renderExtList(); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') brewSearch(); });
    search.append(icon('search'), q);
    const filters = el('div', 'pk-wb-ext__filters');
    for (const [id, label] of EXT_FILTERS) {
      const f = el('button', 'pk-wb-ext__filter' + (state.ext.filter === id ? ' is-on' : ''), label); f.type = 'button';
      f.addEventListener('click', () => { state.ext.filter = id; renderExtensions(); });
      filters.append(f);
    }
    const list = el('div', 'pk-wb-ext__list');
    box.append(search, filters, list);
    sideBody.append(box);
    renderExtList();
    if (keepFocus) { q.focus(); q.setSelectionRange(caret, caret); }
    sideBody.scrollTop = scrollTop;
  }
  function renderExtList() {
    const list = sideBody.querySelector('.pk-wb-ext__list');
    if (!list) return;
    list.replaceChildren();
    if (!state.ext.items) { list.append(el('div', 'pk-wb-progress')); if (state.ext.error) list.append(el('p', 'pk-wb-msg pk-wb-msg--error', state.ext.error)); void loadExtensions(); return; }
    const query = state.ext.query.trim().toLowerCase();
    let items = state.ext.items;
    if (query) items = items.filter(i => (i.name + ' ' + i.id + ' ' + i.desc + ' ' + (i.langs || []).join(' ')).toLowerCase().includes(query));
    const rec = recommended(state.ext.items);
    const section = (title, group, hint) => {
      if (!group.length) return;
      const h = el('div', 'pk-wb-ext__section'); h.append(el('span', '', title), el('span', 'pk-wb-count', String(group.length)));
      if (hint) h.title = hint;
      list.append(h);
      for (const item of group) list.append(extRow(item));
    };
    const f = state.ext.filter;
    if (f === 'installed') section('已安装', items.filter(i => i.installed));
    else if (f === 'recommended') { section('推荐给这个项目', rec.filter(i => items.includes(i)), '根据项目里的文件类型'); if (!rec.length) list.append(el('p', 'pk-wb-msg', '这个项目需要的语言服务和格式化工具都装好了。')); }
    else if (EXT_KINDS[f]) section(EXT_KINDS[f], items.filter(i => i.kind === f));
    else {
      if (!query && rec.length) section('推荐给这个项目', rec, '根据项目里的文件类型');
      for (const [kind, title] of Object.entries(EXT_KINDS)) section(title, items.filter(i => i.kind === kind && (query || !rec.includes(i))));
    }
    if (query) {
      const brewBox = el('div', 'pk-wb-ext__brew');
      if (state.ext.brew === 'loading') brewBox.append(el('div', 'pk-wb-progress'));
      else if (Array.isArray(state.ext.brew)) {
        const h = el('div', 'pk-wb-ext__section'); h.append(el('span', '', 'Homebrew 里的结果'), el('span', 'pk-wb-count', String(state.ext.brew.length))); brewBox.append(h);
        if (!state.ext.brew.length) brewBox.append(el('p', 'pk-wb-msg', '没找到。'));
        for (const r of state.ext.brew) brewBox.append(extRow({...r, brew: true, kind: 'tool', source: 'Homebrew', removable: r.installed, job: r.jobObj}));
      } else {
        const b = el('button', 'pk-wb-btn pk-wb-ext__brewbtn'); b.type = 'button';
        b.append(icon('package'), el('span', '', '在 Homebrew 里搜索「' + state.ext.query.trim() + '」'));
        b.addEventListener('click', brewSearch);
        brewBox.append(b);
      }
      list.append(brewBox);
    }
  }
  async function brewSearch() {
    const query = state.ext.query.trim();
    if (!query) return;
    state.ext.brew = 'loading'; renderExtList();
    try { state.ext.brew = (await rpc('pinkie.ext.brewSearch', {query}, 40000)).results; }
    catch (error) { state.ext.brew = []; toast(error.message); }
    if (state.ext.query.trim() === query) renderExtList();
  }
  window.addEventListener('pinkie:gateway-event', event => {
    const d = event.detail;
    if (d?.event !== 'plugin.pinkie.ext.progress') return;
    const p = d.payload || {};
    const target = String(p.id || '').startsWith('brew:')
      ? (Array.isArray(state.ext.brew) ? state.ext.brew.find(r => 'brew:' + r.name === p.id) : null)
      : state.ext.items?.find(i => i.id === p.id);
    if (target) {
      const job = String(p.id).startsWith('brew:') ? (target.jobObj ||= {log: []}) : (target.job ||= {log: []});
      if (p.state) { job.state = p.state; if (p.action) job.action = p.action; if (p.state === 'done') job.ok = p.ok; }
      if (p.line) { job.log = [...(job.log || []), p.line].slice(-40); }
    }
    if (p.state === 'done') {
      toast((p.ok ? '' : '没有成功：') + (target?.name || p.id) + (p.ok ? (p.action === 'uninstall' ? ' 已卸载' : ' 安装好了') : ''), p.ok ? null : {label: '看输出', run: () => { openView('extensions'); state.ext.open = p.id; renderExtensions(); }});
      void loadExtensions(true).then(() => window.dispatchEvent(new CustomEvent('pinkie:wb-ext-changed', {detail: p})));
      state.files = null;
    }
    if (state.view === 'extensions' && state.sideOpen) {
      const focus = document.activeElement?.classList?.contains('pk-wb-ext__search');
      focus ? renderExtList() : renderExtensions();
    }
    updateExtBadge();
  });

  /* ───────── 面板：终端 / 问题 ───────── */
  let terminalEl = null;
  const terminalClient = {
    async request(method, params) {
      const key = state.key, rootDir = state.root;
      if (method === 'terminal.input') recordTerminalInput(params.sessionId, params.data);
      const result = await window.__laolaoSidebar.gwRequest(method, params, 30000);
      if (method === 'terminal.open' || method === 'terminal.attach') adoptTerminalContext(result?.sessionId || params.sessionId, key, rootDir, result?.cwd || rootDir, result?.buffer);
      // 新开的终端默认在模式工作区；项目绑定了文件夹就切过去
      if (method === 'terminal.open' && result?.sessionId && state.root && result.cwd !== state.root) {
        window.__laolaoSidebar.gwRequest('terminal.input', {sessionId: result.sessionId, data: ' cd ' + shellQuote(state.root) + ' && clear\r'}, 8000).catch(() => {});
      }
      return result;
    },
    addEventListener(callback) {
      const handler = event => { const d = event.detail; if (d?.event === 'terminal.data' || d?.event === 'terminal.exit') callback({event: d.event, payload: d.payload}); };
      window.addEventListener('pinkie:gateway-event', handler);
      return () => window.removeEventListener('pinkie:gateway-event', handler);
    },
  };
  // 终端组件把要恢复的会话记在共享的 sessionStorage 键里；每个项目文件夹各自保存一份，切项目时换掉
  const TERM_KEY = 'openclaw.terminal.sessions.v1';
  function liveTerminalIds() { try { return (terminalEl?.tabs || []).filter(t => t.status === 'live' && t.gatewaySessionId).map(t => t.gatewaySessionId); } catch { return []; } }
  function parkTerminal(oldRoot) {
    if (!terminalEl) return;
    if (oldRoot) store.set('term.' + oldRoot, liveTerminalIds());
    terminalEl.parentElement?.remove();
    terminalEl = null;
    if (state.panelOpen && state.panelTab === 'terminal') setTimeout(renderPanel, 0);
  }
  window.addEventListener('beforeunload', () => { if (terminalEl && state.root) store.set('term.' + state.root, liveTerminalIds()); });
  function terminalAvailable() { return state.info?.terminal?.enabled === true || document.documentElement.dataset.openclawTerminalEnabled === 'true'; }
  function renderPanel() {
    panelHead.replaceChildren();
    const tabs = el('div', 'pk-wb-panel__tabs');
    const markers = window.monaco ? window.monaco.editor.getModelMarkers({}) : [];
    const errors = markers.filter(m => m.severity === 8).length, warns = markers.filter(m => m.severity === 4).length;
    for (const [id, label] of [['terminal', '终端'], ['problems', '问题']]) {
      const t = el('button', 'pk-wb-panel__tab' + (state.panelTab === id ? ' is-active' : ''), label); t.type = 'button';
      if (id === 'problems' && markers.length) t.append(el('span', 'pk-wb-count', String(errors + warns || markers.length)));
      t.addEventListener('click', () => { state.panelTab = id; renderPanel(); });
      tabs.append(t);
    }
    const acts = el('div', 'pk-wb-panel__acts');
    acts.append(button(state.panelHeight > innerHeight * 0.5 ? 'chevron-down' : 'chevron-up', '放大 / 还原', () => { state.panelHeight = state.panelHeight > innerHeight * 0.5 ? 260 : Math.round(innerHeight * 0.62); store.set('panelHeight', state.panelHeight); place(); renderPanel(); }), button('close', '收起面板', () => togglePanel(state.panelTab, false)));
    panelHead.append(tabs, acts);
    if (!state.panelOpen) return;
    for (const child of [...panelBody.children]) if (child !== terminalEl?.parentElement) child.remove();
    const termBox = terminalEl?.parentElement;
    if (state.panelTab === 'terminal') {
      if (!terminalAvailable()) {
        if (termBox) termBox.hidden = true;
        const card = el('div', 'pk-wb-empty pk-wb-empty--terminal');
        card.append(icon('terminal', 'pk-wb-empty__icon'), el('p', '', '终端还没开启。'), el('p', 'pk-wb-msg', '需要在网关配置里打开 gateway.terminal.enabled，再重启网关。终端只在这台电脑的窗口里出现，配对的手机上不会显示。'));
        panelBody.append(card);
        return;
      }
      if (!terminalEl) {
        if (!ghosttyPatch) void patchGhostty();
        const box = el('div', 'pk-wb-term');
        try { sessionStorage.setItem(TERM_KEY, JSON.stringify(store.get('term.' + state.root, []))); } catch {}
        terminalEl = document.createElement('openclaw-terminal-panel');
        terminalEl.fullscreen = true;
        terminalEl.client = terminalClient;
        terminalEl.agentId = state.info?.agentId || state.mode;
        terminalEl.themeMode = root.classList.contains('is-light') ? 'light' : 'dark';
        terminalEl.available = true;
        box.append(terminalEl);
        panelBody.append(box);
      }
      terminalEl.parentElement.hidden = false;
      setTimeout(() => themeTerminal(true), 400);
    } else {
      if (termBox) termBox.hidden = true;
      const list = el('div', 'pk-wb-problems');
      if (!markers.length) list.append(el('p', 'pk-wb-msg', '没有发现问题。（只检查打开过的文件）'));
      const byFile = new Map();
      for (const m of markers) { const p = m.resource.path.replace(/^\//, ''); if (!byFile.has(p)) byFile.set(p, []); byFile.get(p).push(m); }
      for (const [p, items] of byFile) {
        const head = el('div', 'pk-wb-problems__file'); head.append(fileIcon(basename(p), 'file'), el('span', '', basename(p)), el('small', '', dirname(p)), el('span', 'pk-wb-count', String(items.length)));
        list.append(head);
        for (const m of items.sort((a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber)) {
          const row = el('button', 'pk-wb-problem'); row.type = 'button';
          row.append(icon(m.severity === 8 ? 'error' : m.severity === 4 ? 'warning' : 'info', 'is-sev-' + m.severity), el('span', '', m.message), el('small', '', '[' + m.startLineNumber + ', ' + m.startColumn + ']'));
          row.addEventListener('click', () => openFile(p, {pinned: true, line: m.startLineNumber, column: m.startColumn, length: Math.max(0, m.endColumn - m.startColumn)}));
          list.append(row);
        }
      }
      panelBody.append(list);
    }
  }
  function terminalTheme() {
    const c = themeColors();
    const dark = c.dark;
    return {
      background: hex(c.bg), foreground: hex(c.text), cursor: hex(c.accent), cursorAccent: hex(c.bg), selectionBackground: hex(c.accent, 0.3),
      black: dark ? '#2a2130' : '#3b3340', red: '#ff6b81', green: dark ? '#5fd3a8' : '#0f9f72', yellow: dark ? '#f6c76f' : '#b7791f', blue: hex(c.cle), magenta: hex(c.accent), cyan: dark ? '#7bd3dd' : '#0e8a96', white: dark ? '#e9e2e7' : '#5c5360',
      brightBlack: dark ? '#6f6070' : '#8a7f8c', brightRed: '#ff8fa0', brightGreen: '#7fe0bb', brightYellow: '#ffd98a', brightBlue: '#8ccaff', brightMagenta: '#ff9cbc', brightCyan: '#9be3ea', brightWhite: dark ? '#ffffff' : '#2a2130',
    };
  }
  // ghostty-web 的终端打开后不支持换配色（源码里明确写了），所以在 Terminal.prototype.open 前面套一层：
  // 打开在工作台卡片里的终端先换成 C.le. 配色；应用自带的终端面板不受影响。模块地址跟随 OpenClaw 打包文件名。
  const GHOSTTY_MODULE = BASE + 'assets/ghostty-web-Br6esZQ-.js';
  let ghosttyPatch = null;
  function patchGhostty() {
    return ghosttyPatch ||= import(GHOSTTY_MODULE).then(mod => {
      const T = mod?.Terminal;
      if (!T || T.prototype.__pkThemed) return;
      const open = T.prototype.open;
      T.prototype.open = function (parent) {
        try { if (parent?.getRootNode?.()?.host?.closest?.('.pk-wb-term')) this.options.theme = {...(this.options.theme || {}), ...terminalTheme()}; } catch {}
        return open.call(this, parent);
      };
      T.prototype.__pkThemed = true;
    }).catch(() => {});
  }
  void patchGhostty();
  function themeTerminal() {}
  function terminalType(data, options = {}) {
    const activeTab = () => terminalEl?.tabs?.find(t => t.id === terminalEl.activeId);
    const writable = tab => Boolean(tab?.gatewaySessionId && tab.status === 'live' && !tab.cancelled);
    if (!options.wait) {
      const tab = activeTab();
      if (writable(tab)) return terminalClient.request('terminal.input', {sessionId: tab.gatewaySessionId, data}).catch(() => {});
      toast('终端还没准备好');
      return Promise.resolve();
    }
    const expectedRoot = options.root ?? state.root, expectedKey = options.sessionKey ?? state.key;
    const deadline = performance.now() + Math.min(30000, Math.max(100, Number(options.timeoutMs) || 10000));
    return (async () => {
      while (true) {
        if (state.root !== expectedRoot || state.key !== expectedKey || sessionKey() !== expectedKey) throw new Error('项目或会话已切换，请在当前工作台重新运行');
        if (options.active !== undefined && state.active !== options.active) throw new Error('当前文件已切换，运行已取消');
        if (!state.visible || !state.panelOpen || state.panelTab !== 'terminal') throw new Error('终端已收起，运行已取消');
        if (!terminalAvailable()) throw new Error('终端未开启，无法运行');
        const tab = activeTab();
        // The production panel marks a tab live before terminal.open resolves.
        // A real gatewaySessionId is assigned by adoptSession only after that RPC.
        if (terminalEl?.isConnected && writable(tab)) return terminalClient.request('terminal.input', {sessionId: tab.gatewaySessionId, data});
        if (terminalEl?.errorText && !terminalEl.booting) throw new Error(terminalEl.errorText);
        if (tab?.status === 'exited') throw new Error('当前终端已退出，请新建终端后运行');
        if (performance.now() >= deadline) throw new Error('终端连接超时，请重试');
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    })();
  }
  function terminalCd(path) { togglePanel('terminal', true); setTimeout(() => terminalType(' cd ' + shellQuote(absolute(path)) + '\r'), terminalEl?.tabs?.length ? 50 : 1200); }

  /* ───────── 状态栏 ───────── */
  let statusFrame = 0;
  const renderStatusSoon = () => { if (!statusFrame) statusFrame = requestAnimationFrame(() => { statusFrame = 0; renderStatus(); }); };
  let flashTimer = 0;
  function statusFlash(text) { const n = status.querySelector('.pk-wb-status__flash'); if (!n) return; n.textContent = text; n.classList.add('is-on'); clearTimeout(flashTimer); flashTimer = setTimeout(() => n.classList.remove('is-on'), 2600); }
  function renderStatus() {
    const left = el('div', 'pk-wb-status__side'), right = el('div', 'pk-wb-status__side');
    const mode = el('span', 'pk-wb-status__mode');
    mode.append(el('i', 'pk-wb-mark'), el('span', '', MODE_NAME[state.mode] || ''));
    left.append(mode);
    const g = state.git;
    if (g?.repo) {
      const b = el('button', 'pk-wb-status__item'); b.type = 'button'; b.title = '源代码管理';
      b.append(icon('git-branch'), el('span', '', g.branch || 'HEAD'));
      if (g.ahead || g.behind) b.append(el('span', '', (g.behind ? ' ↓' + g.behind : '') + (g.ahead ? ' ↑' + g.ahead : '')));
      if (g.changes.length) b.append(el('span', 'pk-wb-status__dirty', '*'));
      b.addEventListener('click', () => openView('scm'));
      left.append(b);
    }
    const markers = window.monaco ? window.monaco.editor.getModelMarkers({}) : [];
    const p = el('button', 'pk-wb-status__item'); p.type = 'button'; p.title = '问题';
    p.append(icon('error'), el('span', '', String(markers.filter(m => m.severity === 8).length)), icon('warning'), el('span', '', String(markers.filter(m => m.severity === 4).length)));
    p.addEventListener('click', () => togglePanel('problems', true));
    p.dataset.opt = 'problems';
    left.append(p, el('span', 'pk-wb-status__flash'));
    const tab = findTab(state.active);
    if (tab?.readOnly) { const ref = el('span', 'pk-wb-status__item', '参考 · 只读'); ref.title = absolute(tab.path); left.append(ref); }
    if (tab?.kind === 'text' && editor?.getModel() === tab.model) {
      const sel = editor.getSelection(); const pos = editor.getPosition();
      const chosen = sel && !sel.isEmpty() ? tab.model.getValueInRange(sel).length : 0;
      const ln = el('button', 'pk-wb-status__item', '行 ' + pos.lineNumber + '，列 ' + pos.column + (chosen ? '（已选择 ' + chosen + '）' : '')); ln.type = 'button';
      ln.addEventListener('click', () => showQuick(':'));
      const opts = tab.model.getOptions();
      const indent = el('button', 'pk-wb-status__item', (opts.insertSpaces ? '空格：' : '制表符：') + opts.tabSize); indent.type = 'button';
      indent.addEventListener('click', () => { editor.focus(); editor.trigger('status', 'editor.action.indentationToSpaces'); });
      const eol = el('button', 'pk-wb-status__item', tab.model.getEOL() === '\r\n' ? 'CRLF' : 'LF'); eol.type = 'button';
      eol.addEventListener('click', () => { const crlf = tab.model.getEOL() !== '\r\n'; tab.model.pushEOL(crlf ? 1 : 0); tab.eol = crlf ? 'crlf' : 'lf'; renderStatus(); });
      const lang = el('button', 'pk-wb-status__item', langName(tab.model.getLanguageId())); lang.type = 'button';
      lang.addEventListener('click', () => showQuick('#'));
      indent.dataset.opt = 'indent'; eol.dataset.opt = 'eol'; lang.dataset.opt = 'lang';
      const enc = el('span', 'pk-wb-status__item', 'UTF-8'); enc.dataset.opt = 'enc';
      right.append(ln, indent, enc, eol, lang);
    }
    for (const item of extraStatus.values()) { try { const node = item(tab); if (node) right.append(node); } catch {} }
    const live = document.documentElement.hasAttribute('data-cle-live');
    const pinkie = el('button', 'pk-wb-status__item pk-wb-status__pinkie' + (live ? ' is-live' : '')); pinkie.type = 'button';
    pinkie.append(el('i', 'pk-wb-status__dot'), el('span', '', live ? '碧琪工作中' : '碧琪'));
    pinkie.title = '把焦点移到对话输入框';
    pinkie.addEventListener('click', () => composer()?.focus());
    right.append(pinkie);
    status.replaceChildren(left, right);
  }
  new MutationObserver(debounce(() => { if (state.visible) renderStatus(); }, 200)).observe(document.documentElement, {attributes: true, attributeFilter: ['data-cle-live']});

  /* ───────── 问碧琪 ───────── */
  const composer = () => document.querySelector('.agent-chat__input textarea');
  function insertIntoComposer(text) {
    const box = composer();
    if (!box) { toast('找不到对话输入框'); return; }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const current = box.value;
    setter.call(box, (current && !current.endsWith('\n') ? current + '\n\n' : current) + text);
    box.dispatchEvent(new Event('input', {bubbles: true}));
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
  function askPinkie(prefix = '') {
    workspaceView = 'chat'; place();
    const tab = findTab(state.active);
    const file = tab?.kind === 'diff' ? tab.source : tab?.path;
    const model = tab?.kind === 'text' ? tab.model : null;
    if (model && editor) {
      const sel = editor.getSelection();
      const code = sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
      if (code) {
        const range = sel.startLineNumber === sel.endLineNumber ? 'L' + sel.startLineNumber : 'L' + sel.startLineNumber + '-L' + sel.endLineNumber;
        const fence = code.includes('```') ? '````' : '```';
        insertIntoComposer((prefix ? prefix + '\n' : '') + '`' + file + ':' + range + '`\n' + fence + model.getLanguageId() + '\n' + code.replace(/\s+$/, '') + '\n' + fence + '\n');
        return;
      }
    }
    if (file) { insertIntoComposer((prefix || '关于这个文件：') + ' `' + file + '`\n'); return; }
    composer()?.focus();
  }
  function askAboutFile(path) { insertIntoComposer('请看一下 `' + path + '`：'); }
  function previewInBrowser(tab) {
    insertIntoComposer('请在侧栏浏览器里打开预览 `' + absolute(tab.path) + '`');
  }

  /* ───────── 对话里的文件名 → 点击打开 ───────── */
  const PATHISH = /^(?:\.\/)?([\w@.\-一-鿿]+(?:\/[\w@.\-一-鿿]+)*\.[\w]{1,10})(?::(\d+)(?:[:-]L?(\d+))?)?$/;
  async function fileList() {
    if (state.files && Date.now() - state.filesAt < 20000) return state.files;
    try { const r = await rpc('pinkie.fs.find', {}, 20000); state.files = r.files; state.filesAt = Date.now(); } catch { state.files = state.files || []; }
    return state.files;
  }
  function resolveChatPath(text) {
    const m = PATHISH.exec(text.trim().replace(/^`|`$/g, '').replace(/#L(\d+)/, ':$1'));
    if (!m || !state.files) return null;
    let p = m[1].replace(/^\.\//, '');
    if (p.startsWith(state.root + '/')) p = p.slice(state.root.length + 1);
    const hit = state.files.includes(p) ? p : state.files.find(f => f.endsWith('/' + p));
    return hit ? {path: hit, line: m[2] ? Number(m[2]) : 0} : null;
  }
  document.addEventListener('mouseover', event => {
    if (!state.visible) return;
    const code = event.target.closest?.('.chat-thread code:not(pre code), .chat-thread a');
    if (!code || code.dataset.pkWbChecked) return;
    code.dataset.pkWbChecked = '1';
    void fileList().then(() => { if (resolveChatPath(code.textContent || '')) { code.classList.add('pk-wb-filelink'); code.title = '在工作台打开'; } });
  }, {passive: true});
  document.addEventListener('click', event => {
    if (!state.visible) return;
    const code = event.target.closest?.('code.pk-wb-filelink, a.pk-wb-filelink');
    if (!code) return;
    const hit = resolveChatPath(code.textContent || '');
    if (!hit) return;
    event.preventDefault(); event.stopPropagation();
    void openFile(hit.path, {pinned: true, line: hit.line || undefined});
  }, true);

  /* ───────── 快速打开 / 命令 ───────── */
  function fuzzy(query, text) {
    const q = query.toLowerCase(), t = text.toLowerCase();
    let score = 0, ti = 0, last = -2, positions = [];
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return null;
      score += found === last + 1 ? 6 : 1;
      if (found === 0 || '/._- '.includes(t[found - 1])) score += 4;
      positions.push(found); last = found; ti = found + 1;
    }
    const base = t.lastIndexOf('/') + 1;
    if (positions[0] >= base) score += 10;
    score -= text.length * 0.02;
    return {score, positions};
  }
  function highlight(text, positions) {
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const p of positions || []) { if (p > i) frag.append(text.slice(i, p)); frag.append(el('b', '', text[p])); i = p + 1; }
    frag.append(text.slice(i));
    return frag;
  }
  const COMMANDS = () => [
    {label: '文件：保存', key: '⌘S', run: () => saveActive()},
    {label: '文件：新建文件', run: () => newEntry(selectedDir(), 'file')},
    {label: '文件：新建文件夹', run: () => newEntry(selectedDir(), 'dir')},
    {label: '文件：打开项目文件夹', run: () => pickAndBindFolder()},
    {label: '文件：浏览其他文件夹（保留当前项目）', run: () => { openView('explorer'); browseReferenceFolder(); }},
    {label: '文件：关闭编辑器', key: '⌘W', run: () => state.active && closeTab(state.active)},
    {label: '文件：关闭所有已保存的编辑器', run: () => state.tabs.filter(t => !t.dirty).forEach(t => closeTab(t.path))},
    {label: '视图：资源管理器', key: '⇧⌘E', run: () => openView('explorer')},
    {label: '视图：在文件中搜索', key: '⇧⌘F', run: () => openView('search')},
    {label: '视图：源代码管理', key: '⌃⇧G', run: () => openView('scm')},
    {label: '视图：切换侧栏', key: '⌘B', run: () => { state.sideOpen = !state.sideOpen; store.set('sideOpen', state.sideOpen); renderSide(); place(); }},
    {label: '视图：切换终端', key: '⌃`', run: () => togglePanel('terminal')},
    {label: '视图：问题', run: () => togglePanel('problems', true)},
    {label: '视图：收起工作台', key: '⌥⌘B', run: () => setEnabled(false)},
    {label: '编辑器：转到行…', key: '⌃G', run: () => showQuick(':')},
    {label: '编辑器：转到符号…', key: '⇧⌘O', run: () => { editor?.focus(); editor?.trigger('quick', 'editor.action.quickOutline'); }},
    {label: '编辑器：格式化文档', key: '⌥⇧F', run: () => { editor?.focus(); editor?.trigger('quick', 'editor.action.formatDocument'); }},
    {label: '编辑器：切换「保存时格式化」', run: async () => (await codeModule()).toggleFormatOnSave?.()},
    {label: '视图：扩展', key: '⇧⌘X', run: () => openView('extensions')},
    {label: 'AI：模型路由（补全 / 行内修改用哪些模型）', run: async () => (await codeModule()).openRoutePage?.()},
    {label: '编辑器：切换缩略图', run: () => { const on = !store.get('minimap', false); store.set('minimap', on); editor?.updateOptions({minimap: {enabled: on}}); }},
    {label: '编辑器：切换自动换行', key: '⌥Z', run: () => { const on = editor?.getOption(window.monaco.editor.EditorOption.wordWrap) !== 'off'; editor?.updateOptions({wordWrap: on ? 'off' : 'on'}); }},
    {label: '编辑器：编辑器命令面板（Monaco）', key: 'F1', run: () => { editor?.focus(); editor?.trigger('quick', 'editor.action.quickCommand'); }},
    {label: 'Git：和上次提交比较', run: () => state.active && openDiff(state.active)},
    {label: 'Git：刷新', run: () => refreshGit()},
    {label: '碧琪：问碧琪（带上选中的代码）', key: '⌘L', run: () => askPinkie()},
    {label: '碧琪：让碧琪看看当前文件', run: () => state.active && askAboutFile(state.active)},
    {label: '碧琪：' + (store.get('follow', true) ? '关闭' : '打开') + '「跟随碧琪的改动」', run: () => { store.set('follow', !store.get('follow', true)); toast(store.get('follow', true) ? '碧琪改文件时会在工作台里打开' : '不再自动打开碧琪改的文件'); }},
    {label: '运行：运行当前文件', key: 'F5', run: async () => (await codeModule()).runActive?.()},
    {label: '编辑器：让碧琪修改选中的代码（行内）', key: '⌘I', run: async () => (await codeModule()).inlineEdit?.()},
    {label: '项目：在访达中显示', run: () => rpc('pinkie.fs.reveal', {path: ''}).catch(e => toast(e.message))},
    {label: '项目：刷新文件', run: () => refreshAll()},
  ];
  let quickItems = [], quickIndex = 0;
  async function showQuick(prefix = '') {
    if (!state.visible) return;
    hideMenu();
    quick.hidden = false;
    quick.replaceChildren();
    const r = editorArea.getBoundingClientRect();
    quick.style.left = (r.left + r.width / 2) + 'px'; quick.style.top = (r.top + 6) + 'px';
    const input = el('input', 'pk-wb-quick__input'); input.spellcheck = false; input.value = prefix;
    input.placeholder = '按文件名搜索（> 命令，: 跳到行，@ 符号，# 语言）';
    const list = el('div', 'pk-wb-quick__list'); list.setAttribute('role', 'listbox');
    quick.append(input, list);
    input.focus(); input.setSelectionRange(prefix.length, prefix.length);
    const files = await fileList();
    const recent = store.get('recent.' + state.root, []);
    const update = () => {
      const v = input.value;
      quickIndex = 0;
      if (v.startsWith('>')) {
        const q = v.slice(1).trim();
        quickItems = COMMANDS().map(c => ({...c, m: q ? fuzzy(q, c.label) : {score: 0, positions: []}})).filter(c => c.m).sort((a, b) => b.m.score - a.m.score).map(c => ({label: c.label, positions: c.m.positions, detail: c.key ? keyLabel(c.key) : '', icon: 'symbol-event', run: c.run}));
      } else if (v.startsWith(':')) {
        const [line, col] = v.slice(1).split(/[:,]/).map(Number);
        quickItems = editor && findTab(state.active)?.kind === 'text' ? [{label: line ? '转到第 ' + line + ' 行' + (col ? '，第 ' + col + ' 列' : '') : '输入行号（共 ' + editor.getModel().getLineCount() + ' 行）', icon: 'list-ordered', run: () => { if (line) { editor.revealLineInCenter(line); editor.setPosition({lineNumber: line, column: col || 1}); flashLine(line); editor.focus(); } }}] : [{label: '先打开一个文件', icon: 'info', run: () => {}}];
      } else if (v.startsWith('@')) {
        quickItems = [{label: '转到当前文件里的符号', icon: 'symbol-class', run: () => { editor?.focus(); editor?.trigger('quick', 'editor.action.quickOutline'); }}];
      } else if (v.startsWith('#')) {
        const q = v.slice(1).trim();
        const tab = findTab(state.active);
        quickItems = (window.monaco?.languages.getLanguages() || []).map(l => ({l, m: q ? fuzzy(q, (l.aliases?.[0] || l.id)) : {score: 0, positions: []}})).filter(x => x.m).sort((a, b) => b.m.score - a.m.score).slice(0, 60).map(({l, m}) => ({label: l.aliases?.[0] || l.id, positions: m.positions, detail: l.id, icon: 'symbol-keyword', run: () => { if (tab?.model) { window.monaco.editor.setModelLanguage(tab.model, l.id); renderStatus(); } }}));
      } else {
        const q = v.trim().replace(/\s+/g, '');
        let picked;
        if (!q) picked = [...recent.filter(p => files.includes(p)), ...files.filter(p => !recent.includes(p))].slice(0, 60).map(p => ({p, m: {score: 0, positions: []}}));
        else picked = files.map(p => ({p, m: fuzzy(q, p)})).filter(x => x.m).sort((a, b) => b.m.score - a.m.score).slice(0, 60);
        quickItems = picked.map(({p, m}) => {
          const base = p.lastIndexOf('/') + 1;
          return {label: p.slice(base), positions: m.positions.filter(x => x >= base).map(x => x - base), detail: p.slice(0, Math.max(0, base - 1)), file: p, run: () => openFile(p, {pinned: true})};
        });
        if (!files.length) quickItems = [{label: '正在读取文件列表…', icon: 'loading', run: () => {}}];
      }
      paint();
    };
    const paint = () => {
      list.replaceChildren();
      quickItems.forEach((item, i) => {
        const row = el('div', 'pk-wb-quick__item' + (i === quickIndex ? ' is-active' : '')); row.setAttribute('role', 'option');
        row.append(item.file ? fileIcon(item.label, 'file') : icon(item.icon || 'circle-small'));
        const label = el('span', 'pk-wb-quick__label'); label.append(highlight(item.label, item.positions)); row.append(label);
        if (item.detail) row.append(el('span', 'pk-wb-quick__detail', item.detail));
        row.addEventListener('mousedown', e => { e.preventDefault(); quickIndex = i; choose(); });
        list.append(row);
      });
      list.children[quickIndex]?.scrollIntoView({block: 'nearest'});
    };
    const choose = () => { const item = quickItems[quickIndex]; hideQuick(); item?.run?.(); };
    input.addEventListener('input', update);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); quickIndex = Math.min(quickItems.length - 1, quickIndex + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); quickIndex = Math.max(0, quickIndex - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(); }
      else if (e.key === 'Escape') { e.preventDefault(); hideQuick(); editor?.focus(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => setTimeout(hideQuick, 120));
    update();
  }
  function hideQuick() { quick.hidden = true; quick.replaceChildren(); }

  /* ───────── 右键菜单、提示条 ───────── */
  function showMenu(items, x, y) {
    hideQuick();
    menu.replaceChildren();
    for (const item of items) {
      if (item === '-') { menu.append(el('div', 'pk-wb-menu__sep')); continue; }
      const b = el('button', 'pk-wb-menu__item'); b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.append(item.icon ? icon(item.icon) : el('i', 'pk-wb-menu__pad'), el('span', '', item.label));
      if (item.key) b.append(el('kbd', '', keyLabel(item.key)));
      b.addEventListener('click', () => { hideMenu(); item.run(); });
      menu.append(b);
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    menu.querySelector('button')?.focus();
  }
  function hideMenu() { menu.hidden = true; }
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target)) hideMenu(); }, true);
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('button')]; const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); hideMenu(); }
  });

  const noticeHost = el('div', 'pk-wb-toasts');
  root.append(noticeHost);
  function showNotice(message, action) {
    const t = el('div', 'pk-wb-toast'); t.setAttribute('role', 'status');
    t.append(el('span', '', message));
    if (action) { const b = el('button', 'pk-wb-toast__act', action.label); b.type = 'button'; b.addEventListener('click', () => { t.remove(); action.run(); }); t.append(b); }
    const x = button('close', '关闭', () => t.remove(), 'pk-wb-toast__x'); t.append(x);
    noticeHost.append(t);
    while (noticeHost.children.length > 3) noticeHost.firstChild.remove();
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 260); }, action ? 9000 : 3600);
  }
  function showBar(message, actions) {
    notice.hidden = false; notice.replaceChildren(icon('warning'), el('span', 'pk-wb-notice__text', message));
    for (const a of actions) { const b = el('button', 'pk-wb-btn', a.label); b.type = 'button'; b.addEventListener('click', () => a.run()); notice.append(b); }
    notice.append(button('close', '关闭', () => hideNotice()));
  }
  function hideNotice() { notice.hidden = true; }

  /* ───────── 快捷键 ───────── */
  document.addEventListener('keydown', event => {
    if (!state.visible) {
      if (event.altKey && event.metaKey && event.code === 'KeyB' && wanted()) { event.preventDefault(); setEnabled(true); }
      return;
    }
    const mod = isMac ? event.metaKey : event.ctrlKey;
    const inBench = root.contains(event.target) || quick.contains(event.target);
    const k = event.code;
    const hit = (cond, fn) => { if (cond) { event.preventDefault(); event.stopPropagation(); fn(); return true; } return false; };
    if (hit(mod && !event.shiftKey && !event.altKey && k === 'KeyP', () => showQuick(''))) return;
    if (hit(mod && event.shiftKey && k === 'KeyP' && inBench, () => showQuick('>'))) return;
    if (hit(mod && event.shiftKey && k === 'KeyF', () => openView('search'))) return;
    if (hit(mod && event.shiftKey && k === 'KeyE', () => openView('explorer'))) return;
    if (hit(event.ctrlKey && event.shiftKey && k === 'KeyG', () => openView('scm'))) return;
    if (hit(mod && event.shiftKey && k === 'KeyX', () => openView('extensions'))) return;
    if (hit(event.ctrlKey && k === 'Backquote', () => togglePanel('terminal'))) return;
    if (hit(event.altKey && event.metaKey && k === 'KeyB', () => setEnabled(false))) return;
    if (!inBench) return;
    if (hit(mod && !event.shiftKey && k === 'KeyB', () => { state.sideOpen = !state.sideOpen; store.set('sideOpen', state.sideOpen); renderSide(); place(); })) return;
    if (hit(mod && k === 'KeyS', () => saveActive())) return;
    if (hit(mod && k === 'KeyW' && state.active, () => closeTab(state.active))) return;
    if (hit(event.ctrlKey && k === 'KeyG', () => showQuick(':'))) return;
    if (hit(mod && event.altKey && (k === 'ArrowRight' || k === 'ArrowLeft') && state.tabs.length > 1, () => { const i = state.tabs.findIndex(t => t.path === state.active); const n = state.tabs[(i + (k === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length]; activate(n.path); })) return;
  }, true);

  /* ───────── 刷新与监听 ───────── */
  function renderAll() { if (!state.visible || !wanted()) return; renderSide(); renderTabs(); renderCrumbs(); if (!state.active) renderWelcome(); renderPanel(); renderStatus(); place(); }
  async function refreshAll() { state.files = null; await refreshTree(); await refreshGit(); void checkOpenFiles(); }
  // 当前窗口选了开工文件夹后，立刻按新的项目根目录重读文件树。
  window.addEventListener('pinkie:project-scope-changed', event => {
    if (!state.visible) return;
    const key = event.detail?.key || '';
    if (key && key !== state.key) return;
    switchSession(state.key);
  });
  // 碧琪用工具改文件时，文件树、Git 和打开的标签跟着更新
  window.addEventListener('pinkie:gateway-event', event => {
    if (!state.visible) return;
    const {event: name, payload} = event.detail || {};
    if (payload?.sessionKey && payload.sessionKey !== state.key) return;
    const data = payload?.data || {};
    const tool = String(data.name || data.toolName || '');
    if (name === 'agent' && payload?.stream === 'tool') followAgent(tool, data);
    if ((name === 'agent' && payload?.stream === 'tool' && /^(write|edit|apply_patch|exec|bash|process)$/i.test(tool) && /result|end|done|complete/i.test(String(data.phase || data.state || 'result')))
      || (name === 'chat' && ['final', 'aborted', 'error'].includes(payload?.state))) refreshSoon();
  });
  // 碧琪用 workbench_show 指给先生看；写 / 改文件时（跟随开着）在预览标签里打开，不抢输入框的焦点
  const toolArgs = new Map();
  function relativePath(raw) {
    let p = String(raw || '');
    if (!p) return '';
    const rootDir = state.root.replace(/\/$/, '');
    if (p.startsWith(rootDir + '/')) p = p.slice(rootDir.length + 1);
    else if (p.startsWith('/')) return p;
    return p.replace(/^\.\//, '');
  }
  function followAgent(tool, data) {
    if (data.phase === 'start' && data.toolCallId) { toolArgs.set(data.toolCallId, data.args || {}); if (toolArgs.size > 200) toolArgs.delete(toolArgs.keys().next().value); return; }
    if (data.phase !== 'result' || data.isError) return;
    const args = toolArgs.get(data.toolCallId) || {};
    toolArgs.delete(data.toolCallId);
    if (tool === 'workbench_show') {
      const p = relativePath(args.path);
      if (p) void openFile(p, {pinned: true, line: Number(args.line) || undefined, focus: false});
      return;
    }
    if (/^(write|edit)$/i.test(tool) && store.get('follow', true)) {
      const p = relativePath(args.path || args.file_path);
      if (p && !findTab(p)?.dirty) setTimeout(() => void openFile(p, {preview: !findTab(p), focus: false}), 350);
    }
  }
  let themeTimer = 0;
  new MutationObserver(() => { clearTimeout(themeTimer); themeTimer = setTimeout(() => { applyTheme(); sync(); }, 40); })
    .observe(document.documentElement, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-pinkie-night', 'data-theme', 'data-theme-mode', 'class', 'data-laolao-workspace-split', 'data-laolao-workspace-dock', 'data-laolao-browser-workspace']});
  new MutationObserver(() => { if (state.visible) place(); else if (!toggleButton.hidden) placeReopen(); }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-pinkie-sidebar-auto']});
  window.addEventListener('resize', debounce(() => sync(), 60));
  window.addEventListener('popstate', () => setTimeout(sync, 30));
  window.addEventListener('pinkie:session-selected', () => setTimeout(sync, 60));
  window.addEventListener('laolao:modechange', () => setTimeout(sync, 60));
  // Lit 换路由、侧栏收放时 main.content 的位置会变；轻量轮询兜底（只读几何，不改 DOM）
  setInterval(() => { if (state.visible || !toggleButton.hidden || wanted()) sync(); if (state.visible && state.panelOpen) themeTerminal(false); }, 700);
  // Resize only the editor whose actual host changed, including hidden -> shown.
  // Geometry polling must not re-layout Monaco or replace a pressed button.
  let editorLayoutFrame = 0;
  const editorSizes = new WeakMap();
  const editorResize = new ResizeObserver(() => {
    if (editorLayoutFrame) return;
    editorLayoutFrame = requestAnimationFrame(() => {
      editorLayoutFrame = 0;
      for (const [node, instance] of [[monacoHost, editor], [diffHost, diffEditor]]) {
        const width = node.clientWidth, height = node.clientHeight;
        if (!instance || !width || !height) continue;
        const size = width + ':' + height;
        if (editorSizes.get(instance) !== size) { editorSizes.set(instance, size); instance.layout({width, height}); }
      }
    });
  });
  editorResize.observe(monacoHost); editorResize.observe(diffHost);
  const ro = new ResizeObserver(debounce(() => { if (state.visible) place(); }, 30));
  const watchContent = () => { const c = mainContent(); if (c && !c.__pkWbObserved) { c.__pkWbObserved = true; ro.observe(c); } };
  setInterval(watchContent, 1500);
  window.addEventListener('beforeunload', persistTabs);
  // 给代码模块（语言服务、AI、运行）用的接口
  Object.assign(window.__pinkieWorkbench, {
    rpc, toast, absolute, findTab, openFile, statusFlash, insertIntoComposer, togglePanel, terminalType, renderStatus, renderTabs, basename, dirname, shellQuote, keyLabel, fileList,
    async saveAll() { for (const tab of state.tabs.filter(t => t.dirty && t.model)) { const keep = state.active; state.active = tab.path; await saveActive(); state.active = keep; } },
    tabActions: new Map(), openView, showMenu, codeModule,
    // 编辑区里的自定义页面（例如「AI 模型路由」）
    async openPage(id, title, iconName, render) {
      const path = 'page:' + id;
      let tab = findTab(path);
      if (!tab) { tab = {path, name: title, title, kind: 'page', icon: iconName, pinned: true, render}; state.tabs.push(tab); }
      else tab.render = render;
      await activate(path);
    },
    refreshPage(id) { if (state.active === 'page:' + id) void activate(state.active); }, loadExtensions: () => loadExtensions(true),
    showExtension(query) { state.ext.query = query || ''; state.ext.filter = 'all'; state.ext.brew = null; openView('extensions'); },
  });
  // 注意：Object.assign 会把 getter 求值成固定值，编辑器是后来才创建的，必须用 defineProperty
  Object.defineProperty(window.__pinkieWorkbench, 'editor', {get: () => editor, configurable: true});
  Object.defineProperty(window.__pinkieWorkbench, 'monaco', {get: () => window.monaco, configurable: true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
