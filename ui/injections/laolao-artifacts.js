/* PLAN §7 milestone 4 page side.
   W2 artifact library · W3 file cards under the turn that made them ·
   P1 project settings dialog · N4 keyboard shortcut sheet (⌘/ · Ctrl+/).
   Back end: artifacts.mjs / project-settings.mjs (contract §8, plus
   pinkie.artifacts.read and pinkie.project.settings.files for previews). */
(() => {
  'use strict';
  if (window.PinkieArtifacts) return;

  const MODE_AGENT = {chat: 'main', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'unrestricted', metre: 'metre'};
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || '');
  const isWindows = /Windows/i.test(navigator.userAgent || '') || document.documentElement.dataset.pinkiePlatform === 'windows';
  const revealLabel = () => isWindows ? '在文件夹中显示' : '在访达中显示';
  const request = (method, params, timeout = 20_000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    return typeof rpc === 'function' ? rpc(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  const rpcOk = async (method, params, timeout) => {
    const value = await request(method, params, timeout);
    if (value?.ok === false) throw new Error(value.error || '没有成功');
    return value;
  };
  const currentKey = () => new URL(location.href).searchParams.get('session') || '';
  const agentOf = key => /^agent:([^:]+):/.exec(String(key || ''))?.[1] || '';
  const currentAgent = () => MODE_AGENT[window.__laolaoSidebar?.mode] || agentOf(currentKey()) || 'main';
  const pane = () => document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, className, onClick, text = label) => {
    const node = el('button', className, text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.onclick = event => { event.stopPropagation(); onClick?.(event); };
    return node;
  };
  function toast(text) {
    if (typeof window.__laolaoToast === 'function') { window.__laolaoToast(text); return; }
    window.__laolaoSidebar?.toast?.(text);
  }
  const native = message => {
    const call = window.pinkieNative;
    return typeof call === 'function' ? call(message, 15_000) : Promise.reject(new Error('这个功能要在碧琪 App 里用'));
  };
  const openFile = path => native({type: 'openFile', path}).catch(error => toast(error.message || '没能打开'));
  const revealFile = path => native({type: 'revealFile', path}).catch(error => toast(error.message || '没能显示'));
  function size(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function when(ms) {
    if (!ms) return '';
    const date = new Date(ms), now = new Date();
    const pad = n => String(n).padStart(2, '0');
    if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }
  const KIND_LABEL = {all: '全部', html: '网页', image: '图片', doc: '文档', slides: '幻灯片', sheet: '表格', video: '视频'};
  const ICON = {
    html: 'M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01',
    doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
    slides: 'M3 5h18v11H3zM12 16v4M8 20h8',
    sheet: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
    video: 'M4 6h12v12H4zM16 10l5-3v10l-5-3',
  };
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('pinkie-art-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON[kind] || ICON.doc);
    svg.append(path);
    return svg;
  }

  // ---------- session titles (for "来自哪个会话") ----------
  const titleCache = new Map();
  async function sessionTitles(agentId) {
    const cached = titleCache.get(agentId);
    if (cached && Date.now() - cached.at < 30_000) return cached.map;
    const map = new Map();
    try {
      const listed = await request('sessions.list', {agentId: agentId || undefined, limit: 1000}, 15_000);
      for (const item of listed?.sessions || []) map.set(item.key, item.label || item.displayName || item.derivedTitle || '未命名会话');
    } catch {}
    titleCache.set(agentId, {at: Date.now(), map});
    return map;
  }

  // ---------- small previews ----------
  const previewCache = new Map();
  function readPreview(id, v) {
    const cacheKey = id + '@' + (v || 'latest');
    if (!previewCache.has(cacheKey)) {
      previewCache.set(cacheKey, rpcOk('pinkie.artifacts.read', {id, ...(v ? {v} : {})}, 30_000).catch(error => ({ok: false, error: error.message})));
      if (previewCache.size > 300) previewCache.delete(previewCache.keys().next().value);
    }
    return previewCache.get(cacheKey);
  }
  // html previews run with an opaque origin: no allow-same-origin, so the page
  // can never reach the app window, its storage or the gateway token.
  function htmlFrame(html, {scripts = false, title = '网页预览'} = {}) {
    const frame = el('iframe', 'pinkie-art-frame');
    frame.setAttribute('sandbox', scripts ? 'allow-scripts' : '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('loading', 'lazy');
    frame.title = title;
    frame.srcdoc = html;
    return frame;
  }
  function fillThumb(host, item) {
    host.replaceChildren(icon(item.kind));
    if (item.kind !== 'image' && item.kind !== 'html') return;
    const load = async () => {
      const preview = await readPreview(item.id);
      if (!host.isConnected || !preview?.ok || !preview.data) return;
      if (item.kind === 'image') {
        const img = el('img', 'pinkie-art-thumb__img');
        img.alt = '';
        img.decoding = 'async';
        img.src = `data:${preview.mime};${preview.encoding === 'base64' ? 'base64,' : 'charset=utf-8,'}${preview.encoding === 'base64' ? preview.data : encodeURIComponent(preview.data)}`;
        img.onerror = () => img.remove();
        host.replaceChildren(img);
      } else {
        const frame = htmlFrame(preview.data, {title: item.title + ' 小预览'});
        frame.tabIndex = -1;
        frame.classList.add('pinkie-art-thumb__frame');
        host.replaceChildren(frame);
      }
    };
    if (typeof IntersectionObserver !== 'function') { void load(); return; }
    const watcher = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      watcher.disconnect();
      void load();
    }, {rootMargin: '200px'});
    watcher.observe(host);
  }

  // ---------- W2 library ----------
  let library = null;
  // The page covers the content area: it starts right of the sidebar only
  // while the sidebar is really docked and shown; collapsed, peeking or
  // hidden it starts at the window edge.
  function sidebarRight() {
    const side = document.querySelector('aside.sidebar');
    if (!side || side.classList.contains('sidebar--collapsed') || side.closest('[inert]')) return 0;
    const style = getComputedStyle(side);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05 || style.position === 'fixed') return 0;
    const rect = side.getBoundingClientRect();
    if (rect.width < 40 || rect.left < -2 || rect.right > window.innerWidth / 2) return 0;
    return Math.round(rect.right);
  }
  function libraryBounds(page) {
    const left = sidebarRight();
    if (page.style.left !== left + 'px') page.style.left = left + 'px';
  }
  function closeLibrary() {
    if (!library) return;
    library.page.remove();
    document.removeEventListener('keydown', library.onKey, true);
    window.removeEventListener('resize', library.onResize);
    clearInterval(library.follow);
    library = null;
  }
  function openLibrary(options = {}) {
    if (library) { closeLibrary(); }
    const state = {kind: options.kind || 'all', allModes: false, query: '', items: [], cursor: null, seq: 0};
    const page = el('section', 'pinkie-art-page');
    page.setAttribute('role', 'dialog');
    page.setAttribute('aria-label', '作品库');
    const head = el('header', 'pinkie-art-page__head');
    const title = el('h2', 'pinkie-art-page__title', '作品');
    const search = el('input', 'pinkie-art-search');
    search.type = 'search';
    search.placeholder = '搜索作品';
    search.setAttribute('aria-label', '搜索作品');
    const close = button('关闭作品库', 'pinkie-art-close', closeLibrary, '×');
    head.append(title, search, close);
    const filters = el('div', 'pinkie-art-filters');
    filters.setAttribute('role', 'toolbar');
    const kinds = el('div', 'pinkie-art-kinds');
    for (const kind of Object.keys(KIND_LABEL)) {
      const chip = button(KIND_LABEL[kind], 'pinkie-art-chip', () => { state.kind = kind; paintFilters(); void load(); });
      chip.dataset.kind = kind;
      kinds.append(chip);
    }
    const scope = button('全部模式', 'pinkie-art-chip pinkie-art-chip--scope', () => { state.allModes = !state.allModes; paintFilters(); void load(); });
    filters.append(kinds, scope);
    const note = el('p', 'pinkie-art-note', '碧琪在这个模式里写出、改过、生成的文件都会放在这里，每次改动都留一个版本。');
    const grid = el('div', 'pinkie-art-grid');
    const more = button('再看更多', 'pinkie-art-more', () => void load(true));
    more.hidden = true;
    const body = el('div', 'pinkie-art-page__body');
    body.append(note, grid, more);
    page.append(head, filters, body);
    function paintFilters() {
      for (const chip of kinds.children) chip.setAttribute('aria-pressed', String(chip.dataset.kind === state.kind));
      scope.setAttribute('aria-pressed', String(state.allModes));
    }
    async function load(append = false) {
      const seq = ++state.seq;
      const params = {limit: 60, ...(state.allModes ? {} : {mode: currentAgent()}),
        ...(state.kind !== 'all' ? {kind: state.kind} : {}), ...(state.query ? {query: state.query} : {}),
        ...(append && state.cursor ? {cursor: state.cursor} : {})};
      let result;
      try { result = await rpcOk('pinkie.artifacts.list', params, 20_000); }
      catch (error) { if (seq === state.seq) { grid.replaceChildren(el('p', 'pinkie-art-empty', '作品库没打开：' + error.message)); } return; }
      if (seq !== state.seq) return;
      state.items = append ? state.items.concat(result.items || []) : (result.items || []);
      state.cursor = result.cursor || null;
      await paintGrid();
    }
    async function paintGrid() {
      const titles = new Map();
      for (const agent of new Set(state.items.map(item => item.mode))) for (const [key, value] of await sessionTitles(agent)) titles.set(key, value);
      grid.replaceChildren();
      if (!state.items.length) {
        grid.append(el('p', 'pinkie-art-empty', state.query || state.kind !== 'all' ? '没有找到符合条件的作品' : '还没有作品。碧琪写出网页、文档、图片后会出现在这里。'));
      }
      for (const item of state.items) {
        const card = el('article', 'pinkie-art-card');
        card.tabIndex = 0;
        card.dataset.artifactId = item.id;
        card.dataset.kind = item.kind;
        card.setAttribute('aria-label', item.title);
        const thumb = el('div', 'pinkie-art-thumb');
        fillThumb(thumb, item);
        const info = el('div', 'pinkie-art-card__info');
        const name = el('strong', 'pinkie-art-card__title', item.title);
        name.title = item.path;
        const from = titles.get(item.sessionKey) || (item.sessionKey ? '已删除的会话' : '');
        const meta = el('span', 'pinkie-art-card__meta', [from, when(item.updatedAt), item.total > 1 ? item.total + ' 个版本' : ''].filter(Boolean).join(' · '));
        info.append(name, meta);
        if (!item.exists) info.append(el('span', 'pinkie-art-card__gone', '原文件已不在'));
        card.append(thumb, info);
        card.onclick = () => openViewer(item.id, {onChange: () => void load()});
        card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); } };
        grid.append(card);
      }
      more.hidden = !state.cursor;
    }
    let searchTimer = 0;
    search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = search.value.trim(); void load(); }, 180); };
    const onKey = event => {
      if (event.key !== 'Escape' || document.querySelector('.pinkie-art-viewer')) return;
      event.preventDefault(); event.stopPropagation(); closeLibrary();
    };
    const onResize = () => libraryBounds(page);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    document.body.append(page);
    libraryBounds(page);
    // Follow the sidebar while open (⌘B, the collapse button, auto-hide).
    const follow = setInterval(onResize, 250);
    library = {page, onKey, onResize, follow, reload: load, state};
    paintFilters();
    void load();
    setTimeout(() => search.focus(), 0);
    return library;
  }

  // ---------- viewer with version bar ----------
  async function renderBody(host, item, v) {
    host.replaceChildren(el('p', 'pinkie-art-loading', '正在打开…'));
    const preview = await readPreview(item.id, v);
    if (!host.isConnected) return;
    host.replaceChildren();
    const fallback = text => {
      const box = el('div', 'pinkie-art-fallback');
      box.append(icon(item.kind), el('p', '', text));
      box.append(button('用默认应用打开这个版本', 'pinkie-art-btn', async () => {
        try { const {path} = await rpcOk('pinkie.artifacts.version', {id: item.id, v}); await openFile(path); }
        catch (error) { toast(error.message); }
      }));
      host.append(box);
    };
    if (!preview?.ok) { fallback(preview?.error || '这个版本打不开'); return; }
    if (preview.tooLarge) { fallback('文件比较大（' + size(preview.size) + '），用默认应用打开更快。'); return; }
    if (preview.unsupported) { fallback('这类文件在碧琪里还看不了预览。'); return; }
    const ext = (item.path.split('.').pop() || '').toLowerCase();
    if (item.kind === 'image') {
      const img = el('img', 'pinkie-art-view__img');
      img.alt = item.title;
      img.src = preview.encoding === 'base64' ? `data:${preview.mime};base64,${preview.data}` : `data:${preview.mime};charset=utf-8,${encodeURIComponent(preview.data)}`;
      host.append(img);
    } else if (item.kind === 'html') {
      host.append(htmlFrame(preview.data, {scripts: true, title: item.title}));
    } else if (ext === 'md') {
      const doc = el('div', 'pinkie-art-view__md');
      const render = window.PinkieSessionTools?.markdownToHtml;
      if (render) doc.innerHTML = render(preview.data);
      else doc.textContent = preview.data;
      host.append(doc);
    } else {
      host.append(el('pre', 'pinkie-art-view__text', preview.data));
    }
  }
  async function openViewer(id, {onChange, v: startAt} = {}) {
    document.querySelector('.pinkie-art-viewer')?.remove();
    let item;
    try { item = (await rpcOk('pinkie.artifacts.get', {id})).item; }
    catch (error) { toast(error.message); return null; }
    const mask = el('div', 'pinkie-art-viewer');
    const box = el('section', 'pinkie-art-view');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', item.title + ' 预览');
    const head = el('header', 'pinkie-art-view__head');
    const name = el('strong', 'pinkie-art-view__title', item.title);
    name.title = item.path;
    const versions = el('div', 'pinkie-art-versions');
    const prev = button('上一个版本', 'pinkie-art-ver', () => step(-1), '‹');
    const label = el('span', 'pinkie-art-versions__label');
    const next = button('下一个版本', 'pinkie-art-ver', () => step(1), '›');
    const restore = button('恢复这个版本', 'pinkie-art-restore', () => void doRestore());
    versions.append(label, prev, next, el('span', 'pinkie-art-versions__dot', '·'), restore);
    const open = button('打开', 'pinkie-art-btn', () => openFile(item.path));
    const reveal = button(revealLabel(), 'pinkie-art-btn', () => revealFile(item.path));
    const remove = button('从作品库移除', 'pinkie-art-btn pinkie-art-btn--quiet', () => void doRemove());
    const close = button('关闭预览', 'pinkie-art-close', () => finish(), '×');
    const actions = el('div', 'pinkie-art-view__actions');
    actions.append(open, reveal, remove, close);
    head.append(name, versions, actions);
    const body = el('div', 'pinkie-art-view__body');
    const status = el('p', 'pinkie-art-status');
    status.setAttribute('role', 'status');
    box.append(head, body, status);
    mask.append(box);
    document.body.append(mask);
    let index = Math.max(0, item.versions.findIndex(entry => entry.v === Number(startAt)));
    if (!startAt) index = item.versions.length - 1;
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
      else if (event.key === 'ArrowLeft' && !event.target.closest?.('input,textarea')) step(-1);
      else if (event.key === 'ArrowRight' && !event.target.closest?.('input,textarea')) step(1);
    };
    document.addEventListener('keydown', onKey, true);
    mask.onpointerdown = event => { if (event.target === mask) finish(); };
    function finish() { mask.remove(); document.removeEventListener('keydown', onKey, true); }
    function paint() {
      const version = item.versions[index];
      label.textContent = `版本 ${index + 1} / ${item.versions.length}`;
      label.dataset.v = String(version?.v || '');
      prev.disabled = index <= 0;
      next.disabled = index >= item.versions.length - 1;
      restore.disabled = index === item.versions.length - 1 || !version?.snapshot;
      restore.title = !version?.snapshot ? '这个版本太大，没有存副本' : '';
      open.disabled = reveal.disabled = !item.exists;
      void renderBody(body, item, version?.v);
    }
    function step(delta) {
      const target = index + delta;
      if (target < 0 || target >= item.versions.length) return;
      index = target; status.textContent = ''; paint();
    }
    async function doRestore() {
      const version = item.versions[index];
      restore.disabled = true;
      try {
        const result = await rpcOk('pinkie.artifacts.restore', {id: item.id, v: version.v, key: currentKey()});
        item = (await rpcOk('pinkie.artifacts.get', {id: item.id})).item;
        index = item.versions.length - 1;
        status.textContent = `已恢复到版本 ${version.v}，存成了新的版本 ${result.v}`;
        previewCache.clear();
        paint();
        onChange?.();
      } catch (error) { status.textContent = error.message; restore.disabled = false; }
    }
    async function doRemove() {
      const ok = await confirmBox('从作品库移除「' + item.title + '」？', '只是从作品库里拿掉，电脑上的文件不会删除。', '移除');
      if (!ok) return;
      try { await rpcOk('pinkie.artifacts.remove', {id: item.id}); finish(); toast('已从作品库移除，文件还在原处'); onChange?.(); scheduleCards(true); }
      catch (error) { status.textContent = error.message; }
    }
    paint();
    return {mask, finish};
  }
  function confirmBox(title, text, okLabel) {
    return new Promise(resolve => {
      const mask = el('div', 'laolao-modal-mask pinkie-tools-mask pinkie-art-confirm');
      const box = el('div', 'laolao-modal pinkie-tools-modal');
      box.setAttribute('role', 'alertdialog');
      box.append(el('h3', 'laolao-modal__title', title), el('p', 'pinkie-art-confirm__text', text));
      const buttons = el('div', 'laolao-modal__buttons');
      const done = value => { mask.remove(); document.removeEventListener('keydown', onKey, true); resolve(value); };
      const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      const cancel = button('取消', 'laolao-modal__button', () => done(false));
      const ok = button(okLabel, 'laolao-modal__button laolao-modal__button--primary', () => done(true));
      buttons.append(cancel, ok);
      box.append(buttons);
      mask.append(box);
      document.body.append(mask);
      ok.focus();
    });
  }

  // ---------- W3 file cards under the turn that made them ----------
  let cardData = {key: '', at: 0, items: [], loading: null};
  async function loadCards(force = false) {
    const key = currentKey();
    if (!key || /:subagent:/i.test(key)) { cardData = {key, at: Date.now(), items: [], loading: null}; return cardData; }
    if (!force && cardData.key === key && Date.now() - cardData.at < 8000) return cardData;
    if (cardData.loading && cardData.key === key) return cardData.loading;
    cardData.key = key;
    cardData.loading = (async () => {
      try {
        const result = await rpcOk('pinkie.artifacts.list', {sessionKey: key, mode: 'all', limit: 200}, 15_000);
        if (currentKey() === key) cardData = {key, at: Date.now(), items: result.items || [], loading: null};
      } catch { cardData = {key, at: Date.now(), items: [], loading: null}; }
      return cardData;
    })();
    return cardData.loading;
  }
  function fileCard(item, version) {
    const card = el('div', 'pinkie-file-card');
    card.dataset.artifactId = item.id;
    card.dataset.path = item.path;
    const visual = el('span', 'pinkie-file-card__icon');
    visual.append(icon(item.kind));
    const info = el('span', 'pinkie-file-card__info');
    const name = el('button', 'pinkie-file-card__name', item.title);
    name.type = 'button';
    name.title = '在作品库里看这个版本';
    name.onclick = () => openViewer(item.id, {v: version.v});
    const meta = el('span', 'pinkie-file-card__meta', size(version.size) + (item.total > 1 ? ` · 版本 ${item.versions.findIndex(entry => entry.v === version.v) + 1}` : ''));
    info.append(name, meta);
    const actions = el('span', 'pinkie-file-card__actions');
    const open = button('打开 ' + item.title, 'pinkie-file-card__btn', () => openFile(item.path), '打开');
    const reveal = button(revealLabel() + ' ' + item.title, 'pinkie-file-card__btn', () => revealFile(item.path), revealLabel());
    if (!item.exists) { open.disabled = reveal.disabled = true; meta.textContent += ' · 原文件已不在'; }
    actions.append(open, reveal);
    card.append(visual, info, actions);
    return card;
  }
  function paintCards() {
    const p = pane();
    const thread = p?.querySelector('.chat-thread-inner');
    const history = p?.state?.chatMessages;
    const helpers = window.__pinkieMessageActions;
    const stale = thread ? [...thread.querySelectorAll(':scope > .pinkie-file-cards')] : [...document.querySelectorAll('.pinkie-file-cards')];
    if (!thread || !Array.isArray(history) || cardData.key !== currentKey()) { stale.forEach(node => node.remove()); return; }
    const groups = [...thread.children].filter(node => node.classList?.contains('chat-group'));
    // Turns: each user group with its timestamp, then the last assistant group before the next user group.
    const turns = [];
    for (const group of groups) {
      if (group.classList.contains('user')) {
        const bubble = group.querySelector('.chat-bubble[data-message-id]');
        const item = bubble && helpers?.historyItem?.(bubble.dataset.messageId, history);
        const at = Number(item?.timestamp) || Date.parse(group.querySelector('time[datetime]')?.getAttribute('datetime') || '') || 0;
        turns.push({at, reply: null});
      } else if (group.classList.contains('assistant') && turns.length) {
        if (!group.querySelector('.chat-bubble.streaming')) turns.at(-1).reply = group;
        else turns.at(-1).streaming = true;
      }
    }
    const placements = new Map();
    for (const item of cardData.items) {
      for (const version of item.versions || []) {
        if (version.sessionKey && version.sessionKey !== cardData.key) continue;
        if (!version.sessionKey && item.sessionKey !== cardData.key) continue;
        let turn = null;
        for (const candidate of turns) if (candidate.at && candidate.at <= version.ts) turn = candidate;
        if (!turn?.reply || turn.streaming) continue;
        if (turn.reply.querySelector(`.laolao-delivery-card[data-laolao-material-path="${CSS.escape(item.path)}"]`)) continue;
        const list = placements.get(turn.reply) || new Map();
        list.set(item.id, {item, version});
        placements.set(turn.reply, list);
      }
    }
    const keep = new Set();
    for (const [reply, entries] of placements) {
      const signature = JSON.stringify([...entries.values()].map(({item, version}) => [item.id, version.v, item.exists, item.total]));
      let host = reply.nextElementSibling?.classList?.contains('pinkie-file-cards') ? reply.nextElementSibling : null;
      if (!host || host.dataset.signature !== signature) {
        const next = el('div', 'pinkie-file-cards');
        next.dataset.signature = signature;
        next.setAttribute('aria-label', '这一轮做出的文件');
        for (const {item, version} of entries.values()) next.append(fileCard(item, version));
        if (host) host.replaceWith(next); else reply.after(next);
        host = next;
      }
      keep.add(host);
    }
    for (const node of thread.querySelectorAll(':scope > .pinkie-file-cards')) if (!keep.has(node)) node.remove();
  }
  let cardsFrame = 0;
  function scheduleCards(force = false) {
    if (force) cardData.at = 0;
    if (cardsFrame) return;
    cardsFrame = requestAnimationFrame(async () => {
      cardsFrame = 0;
      try { await loadCards(); paintCards(); } catch {}
    });
  }
  window.addEventListener('pinkie:gateway-event', event => {
    const {event: name, payload} = event.detail || {};
    if (name === 'chat' && payload?.state === 'final' && payload.sessionKey === currentKey()) setTimeout(() => scheduleCards(true), 300);
  });

  // ---------- P1 project settings ----------
  async function openProjectSettings(name, folder = '') {
    document.querySelector('.pinkie-project-settings')?.closest('.laolao-modal-mask')?.remove();
    let data;
    try { data = await rpcOk('pinkie.project.settings.get', {name, ...(folder ? {folder} : {})}); }
    catch (error) { toast(error.message); return null; }
    let pinned = [...(data.pinned || [])];
    const mask = el('div', 'laolao-modal-mask pinkie-tools-mask');
    const box = el('form', 'laolao-modal pinkie-tools-modal pinkie-project-settings');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '项目设置');
    box.append(el('h3', 'laolao-modal__title', '项目设置'));
    const field = (labelText, control, hint) => {
      const wrap = el('label', 'pinkie-ps-field');
      wrap.append(el('span', 'pinkie-ps-label', labelText), control);
      if (hint) wrap.append(hint);
      box.append(wrap);
      return wrap;
    };
    const nameBox = el('div', 'pinkie-ps-static', name);
    field('名称', nameBox);
    const folderRow = el('div', 'pinkie-ps-folder');
    const folderText = el('span', 'pinkie-ps-folder__path', data.folder ? data.folder.replace(/^\/Users\/[^/]+/, '~') : '还没有选文件夹');
    folderText.title = data.folder || '';
    folderRow.append(folderText);
    if (data.folder) folderRow.append(button(revealLabel(), 'pinkie-art-btn', () => native({type: 'revealFile', path: data.folder}).catch(() => window.__laolaoSidebar?.revealProject?.(data.folder))));
    field('文件夹', folderRow);
    const area = el('textarea', 'pinkie-ps-instructions');
    area.maxLength = 8000;
    area.rows = 8;
    area.placeholder = '碧琪在这个项目的每个会话里都会看到';
    area.value = data.instructions || '';
    const count = el('span', 'pinkie-ps-count');
    const paintCount = () => { count.textContent = `${[...area.value].length} / 8000`; };
    area.oninput = paintCount; paintCount();
    field('项目说明', area, count);
    const pinList = el('ul', 'pinkie-ps-pins');
    const picker = el('div', 'pinkie-ps-picker');
    const find = el('input', 'pinkie-ps-find');
    find.type = 'search';
    find.placeholder = data.folder ? '在项目文件夹里找文件…' : '先给项目选文件夹';
    find.disabled = !data.folder;
    const results = el('ul', 'pinkie-ps-results');
    picker.append(find, results);
    const pinWrap = el('div', 'pinkie-ps-pinwrap');
    pinWrap.append(pinList, picker);
    field('常看资料（最多 20 个，碧琪只看到路径，需要时再去读）', pinWrap);
    const status = el('p', 'pinkie-art-status');
    const buttons = el('div', 'laolao-modal__buttons');
    const cancel = button('取消', 'laolao-modal__button', () => close());
    const save = el('button', 'laolao-modal__button laolao-modal__button--primary', '保存');
    save.type = 'submit';
    buttons.append(cancel, save);
    box.append(status, buttons);
    const rel = path => data.folder && path.startsWith(data.folder) ? path.slice(data.folder.length).replace(/^[\\/]/, '') : path;
    function paintPins() {
      pinList.replaceChildren();
      if (!pinned.length) pinList.append(el('li', 'pinkie-ps-empty', '还没有常看资料'));
      for (const path of pinned) {
        const row = el('li', 'pinkie-ps-pin');
        const text = el('span', 'pinkie-ps-pin__path', rel(path));
        text.title = path;
        row.append(text, button('移除 ' + rel(path), 'pinkie-ps-pin__x', () => { pinned = pinned.filter(item => item !== path); paintPins(); void search(); }, '×'));
        pinList.append(row);
      }
      find.disabled = !data.folder || pinned.length >= 20;
      if (pinned.length >= 20) find.placeholder = '已经 20 个了';
    }
    let seq = 0;
    async function search() {
      if (!data.folder) return;
      const mine = ++seq;
      let files = [];
      try { files = (await rpcOk('pinkie.project.settings.files', {name, folder: data.folder, query: find.value.trim()})).files || []; }
      catch (error) { status.textContent = error.message; }
      if (mine !== seq) return;
      results.replaceChildren();
      for (const file of files.filter(file => !pinned.includes(file.path)).slice(0, 8)) {
        const row = el('li', 'pinkie-ps-result');
        const pick = button('加入常看资料：' + file.rel, 'pinkie-ps-result__btn', () => {
          if (pinned.length >= 20) { status.textContent = '常看资料最多 20 个'; return; }
          pinned.push(file.path); paintPins(); void search();
        }, file.rel);
        row.append(pick);
        results.append(row);
      }
    }
    let timer = 0;
    find.oninput = () => { clearTimeout(timer); timer = setTimeout(search, 150); };
    find.onfocus = () => void search();
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    function close() { mask.remove(); document.removeEventListener('keydown', onKey, true); }
    document.addEventListener('keydown', onKey, true);
    mask.onpointerdown = event => { if (event.target === mask) close(); };
    box.onsubmit = async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        await rpcOk('pinkie.project.settings.set', {name, ...(data.folder ? {folder: data.folder} : {}), instructions: area.value, pinned});
        close();
        toast('项目设置已保存，这个项目的会话下一轮起就会照做');
      } catch (error) { status.textContent = error.message; save.disabled = false; }
    };
    paintPins();
    mask.append(box);
    document.body.append(mask);
    setTimeout(() => area.focus(), 0);
    return {mask, close};
  }

  // ---------- N4 shortcut sheet ----------
  const k = (mac, win) => isMac ? mac : (win || mac.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+').replace(/⌃/g, 'Ctrl+'));
  function hotkeyLabel() {
    const prefs = window.__pinkieNativeBridge && window.__pinkieShortcutPrefs;
    const value = prefs?.hotkey;
    if (value === null) return '已关闭';
    if (!value || value === 'default') return isMac ? '⌥Space' : 'Ctrl+Alt+Space';
    return isMac ? value.replace(/Alt\+?/gi, '⌥').replace(/(Ctrl|Control)\+?/gi, '⌃').replace(/Shift\+?/gi, '⇧').replace(/(Cmd|Command|Meta)\+?/gi, '⌘') : value;
  }
  function shortcutGroups() {
    return [
      ['会话', [
        ['新会话', k('⌘N')], ['临时会话', k('⌘⇧N')], ['命令面板（找页面、会话）', k('⌘K')],
        ['上一条 / 下一条提问', k('⌥↑ / ⌥↓', 'Alt+↑ / Alt+↓')], ['长对话目录', '顶栏「目录」'],
      ]],
      ['输入框', [
        ['发送', 'Enter'], ['换行', k('⇧Enter', 'Shift+Enter')], ['提及文件或会话', '@'],
        ['编辑消息时发送', k('⌘Enter')], ['取消编辑 / 关闭弹窗', 'Esc'],
      ]],
      ['侧栏', [
        ['多选会话', k('⌘ 点击', 'Ctrl+点击') + ' · ' + k('⇧ 点击', 'Shift+点击')], ['在列表里移动', '↑ / ↓'],
        ['打开会话', 'Enter'], ['改名', 'F2'], ['归档（可撤销）', 'Delete'], ['取消选择', 'Esc'],
      ]],
      ['作品', [['上一个 / 下一个版本', '← / →'], ['关闭预览', 'Esc']]],
      ['全局', [
        ['快速提问（在任何地方）', hotkeyLabel()], ['快捷键一览', k('⌘/')], ['显示 / 隐藏侧栏', k('⌘B')], ['终端面板', k('⌃`', 'Ctrl+`')],
      ]],
      ['代码工作台', [
        ['快速打开文件', k('⌘P')], ['命令', k('⇧⌘P', 'Ctrl+Shift+P')], ['在文件中搜索', k('⇧⌘F', 'Ctrl+Shift+F')],
        ['保存', k('⌘S')], ['问碧琪（带上选中的代码）', k('⌘L')], ['行内修改', k('⌘I')],
      ]],
    ];
  }
  let sheet = null;
  async function openShortcuts() {
    if (sheet) { sheet.close(); return null; }
    try { window.__pinkieShortcutPrefs = await window.__pinkieNativeBridge?.loadPrefs?.(); } catch {}
    const mask = el('div', 'laolao-modal-mask pinkie-tools-mask');
    const box = el('div', 'laolao-modal pinkie-tools-modal pinkie-shortcuts');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '快捷键');
    const head = el('div', 'pinkie-shortcuts__head');
    head.append(el('h3', 'laolao-modal__title', '快捷键'), button('关闭快捷键一览', 'pinkie-art-close', () => close(), '×'));
    const grid = el('div', 'pinkie-shortcuts__grid');
    for (const [title, rows] of shortcutGroups()) {
      const section = el('section', 'pinkie-shortcuts__group');
      section.append(el('h4', 'pinkie-shortcuts__title', title));
      const list = el('dl', 'pinkie-shortcuts__list');
      for (const [label, keys] of rows) {
        const row = el('div', 'pinkie-shortcuts__row');
        row.append(el('dt', '', label), el('dd', '', keys));
        list.append(row);
      }
      section.append(list);
      grid.append(section);
    }
    box.append(head, grid);
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    function close() { mask.remove(); document.removeEventListener('keydown', onKey, true); sheet = null; }
    document.addEventListener('keydown', onKey, true);
    mask.onpointerdown = event => { if (event.target === mask) close(); };
    mask.append(box);
    document.body.append(mask);
    sheet = {mask, close};
    return sheet;
  }
  document.addEventListener('keydown', event => {
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!mod || event.altKey || !(event.key === '/' || event.code === 'Slash')) return;
    if (event.target?.closest?.('.monaco-editor')) return;
    event.preventDefault();
    event.stopPropagation();
    void openShortcuts();
  }, true);

  // ---------- paint loop ----------
  const observer = new MutationObserver(mutations => {
    if (mutations.every(mutation => [...mutation.addedNodes, ...mutation.removedNodes].every(node => node.nodeType !== 1
      || node.closest?.('.pinkie-file-cards, .pinkie-art-page, .pinkie-art-viewer, .pinkie-sources, .pinkie-cite, .pinkie-msg-row')))) return;
    scheduleCards();
  });
  const start = () => { observer.observe(document.body, {childList: true, subtree: true}); scheduleCards(true); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, {once: true});
  let lastKey = '';
  setInterval(() => { const key = currentKey(); if (key !== lastKey) { lastKey = key; scheduleCards(true); } else scheduleCards(); }, 2000);

  window.PinkieArtifacts = Object.freeze({
    open: openLibrary, close: closeLibrary, openViewer, openProjectSettings, openShortcuts, shortcutGroups,
    refreshCards: () => scheduleCards(true), get library() { return library; },
  });
})();
