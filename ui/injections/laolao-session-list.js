/* Independent sidebar DOM: never move Lit-owned native session nodes. */
(() => {
  'use strict';
  const cache=new Map(),loading=new Map();
  let current=null,revision=0,archived=false,query='',limit=30,signature='',lastMode='',dataVersion=0;
  const el=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
  function button(text,label,action){const b=el('button','laolao-managed-button',text);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.onclick=action;return b;}
  function invalidate(){for(const entry of cache.values())entry.stale=true;revision++;signature='';if(current)void load(current.api);}
  const requestedTitles = new Map(), clearingUnread = new Set();
  const internalKey = key => /:(?:unknown|structured-gap|failed-tool-result)$|:internal-session-effects:/i.test(key || '');
  const internalRow = s => internalKey(s.key) || !s.lineage?.parentKey && Boolean(s.meta?.internal);
  const isPersona = key => /:subagent:/iu.test(key || '');
  const parentOf = s => {
    if (s.lineage?.detached) return '';
    const parent = s.lineage?.parentKey || s.parentSessionKey || s.spawnedBy;
    return parent && parent !== s.key && parent.split(':')[1] === s.key.split(':')[1] ? parent : '';
  };
  const hasMessages = s => Boolean(s.lastMessagePreview || s.meta?.hasMessages);
  // Mirror the title rules in session-titles.mjs. Tests compare both sides.
  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  const lowInformation = /^(?:(?:hi|hey|hello)(?:there|pinkie|碧琪)?|ping|test(?:ing)?\d*|ok(?:ay)?|thanks|thankyou|gotit|yes|yep|sure|continue|goon|你好(?:呀|啊|吗|么|碧琪)?|您好|在(?:吗|不在|不)|嗨|哈[喽啰]|[嗯哦啊]+|测试(?:一下|哈)?\d*|好的?|收到|知道了|可以|对|继续(?:吧|啊|呀)?|接着|明白了|谢谢|早上好|晚安)$/iu;
  const emptyTitle = /^(?:.+?\s*·\s*)?(?:新会话(?:\s*\d+)?|会话\s*\d+|New session(?:\s*\d+)?|Untitled)$/iu;
  const badTitle = /^(?:(?:ou|on|oc|om|wxid|wm|cid|ding|dt)_|\[(?:pinkie-[\w-]+|System)\]|agent:|[0-9a-f]{8}\b)|\s·\s[0-9a-f]{4}$|[\uD800-\uDFFF\uFFFD]/iu;
  function isBadTitle(value, key = '', sessionId = '') {
    const name = String(value || '').trim();
    const effective = name.replace(/[^\p{L}\p{N}]/gu, '');
    return !name || emptyTitle.test(name) || badTitle.test(name)
      || [...segmenter.segment(effective)].length < 4
      || lowInformation.test(effective) || [String(key).split(':').pop(), String(sessionId)].filter(Boolean).some(id => name === id);
  }

  function title(s) {
    if (internalRow(s)) return '后台记录';
    if (isPersona(s.key)) return s.label && !badTitle.test(s.label) ? s.label : s.subagentRole === 'orchestrator' ? '协调分身' : '分身';
    if (['user', 'system'].includes(s.meta?.source) && s.label) return s.label;
    if (s.lineage?.title && !s.label) return s.lineage.title;
    if (!hasMessages(s)) return '新会话';
    const label = typeof s.label === 'string' ? s.label.trim() : '';
    if (label && !isBadTitle(label, s.key, s.sessionId)) return label;
    return s.meta?.channelTitle || '新会话';
  }

  async function load(api) {
    const key = api.mode + '|' + archived;
    if (loading.has(key) || cache.has(key) && !cache.get(key).stale) return;
    const version = revision, archiveView = archived;
    const list = archived => api.gwRequest('sessions.list', {agentId: api.agentId, archived, includeLastMessage: true, limit: 1000});
    const job = Promise.all([
      list(archiveView), archiveView ? list(false) : null,
      api.gwRequest('pinkie.session.lineage', {agentId: api.agentId}).catch(() => null),
    ]);
    loading.set(key, job);
    try {
      const [data, active, lineage] = await job;
      const owned = s => s.key?.startsWith('agent:' + api.agentId + ':');
      const rows = (data.sessions || []).filter(owned);
      const activeRows = (active?.sessions || []).filter(owned);
      const allRows = [...rows, ...activeRows];
      for (const s of allRows) {
        s.lineage = lineage?.children?.[s.key];
        s.phase = lineage?.states?.[s.key]?.phase;
      }
      const keys = [...new Set(allRows.flatMap(s => [s.key, parentOf(s)]).filter(Boolean))];
      const metadata = await api.gwRequest('pinkie.session.title.metadata', {keys}).catch(() => null);
      if (version !== revision) return;
      for (const s of allRows) {
        s.meta = metadata?.rows?.[s.key];
        s.parentArchived = metadata?.rows?.[parentOf(s)]?.archived === true;
      }
      cache.set(key, {rows: archiveView ? [...rows, ...activeRows.filter(s => internalRow(s) || s.parentArchived)] : rows, version: ++dataVersion});
    } catch (error) {
      if (version !== revision) return;
      cache.set(key, {rows: cache.get(key)?.rows || [], version: ++dataVersion});
      if (current?.api.mode === api.mode) api.toast('会话列表暂未刷新：' + error.message);
    } finally {
      if (loading.get(key) === job) loading.delete(key);
      signature = '';
      if (current) render(current.section, current.api);
    }
  }

  function ensureVisibleTitles(groups, rows, api) {
    if (archived) return;
    const visible = new Set([...groups.querySelectorAll('.session-row-host')].map(node => node.dataset.sessionKey));
    const candidates = rows.filter(s => visible.has(s.key) && hasMessages(s) && !internalRow(s) && !isPersona(s.key)
      && !['user', 'auto', 'system'].includes(s.meta?.source));
    candidates.sort((a, b) => Number(isBadTitle(b.label, b.key, b.sessionId)) - Number(isBadTitle(a.label, a.key, a.sessionId)));
    const keys = [];
    for (const s of candidates) {
      const marker = JSON.stringify([s.sessionId, s.label, s.lastActivityAt || s.updatedAt]);
      if (requestedTitles.get(s.key) === marker) continue;
      if (requestedTitles.size >= 1500) requestedTitles.delete(requestedTitles.keys().next().value);
      requestedTitles.set(s.key, marker);
      keys.push(s.key);
    }
    for (let offset = 0; offset < keys.length; offset += 20) {
      void api.gwRequest('pinkie.session.title.ensure', {keys: keys.slice(offset, offset + 20)}).catch(() => {});
    }
  }
  // Keep independent children and read-only workers grouped even when a
  // search matches a descendant or the parent has been archived.
  function buildTree(rows, {archive = false, currentKey = '', query = ''} = {}) {
    const sorted = [...rows].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const byKey = new Map(sorted.map(s => [s.key, s]));
    const nodes = new Map();
    const search = query.trim().toLowerCase();
    const matches = s => title(s).toLowerCase().includes(search);
    const visible = s => archive || !internalRow(s) && !s.parentArchived
      && (s.key === currentKey || hasMessages(s) || s.hasActiveRun || s.lineage);
    const ordinary = sorted.filter(s => !isPersona(s.key) && visible(s));
    for (const s of ordinary) nodes.set(s.key, {session: s, children: [], workers: []});
    const roots = [];
    function ordinaryParent(s) {
      const seen = new Set([s.key]);
      let key = parentOf(s);
      while (key && !seen.has(key)) {
        seen.add(key);
        const parent = byKey.get(key);
        if (!parent) return '';
        if (!isPersona(key) && nodes.has(key)) return key;
        key = parentOf(parent);
      }
      return '';
    }
    for (const s of ordinary) {
      const node = nodes.get(s.key);
      const parentKey = ordinaryParent(s);
      const parent = nodes.get(parentKey);
      if (!parent || parentOf(parent.session) === s.key || internalRow(s)) roots.push(node);
      else parent.children.push(node);
    }
    for (const s of sorted) {
      if (isPersona(s.key) && !internalRow(s)) nodes.get(ordinaryParent(s))?.workers.push(s);
    }
    // Normal UI children are one level. If native history has deeper chains,
    // retain the descendants under the first visible root.
    for (const root of roots) {
      const visited = new Set([root.session.key]);
      const stack = [...root.children], flat = [];
      while (stack.length) {
        const child = stack.shift();
        if (visited.has(child.session.key)) continue;
        visited.add(child.session.key);
        flat.push(child);
        stack.push(...child.children);
        child.children = [];
      }
      root.children = flat;
    }
    if (!search) return roots;
    for (const root of roots) {
      const rootMatches = matches(root.session);
      root.workers = root.workers.filter(matches);
      root.children = root.children.filter(child => {
        child.workers = child.workers.filter(matches);
        return rootMatches || matches(child.session) || child.workers.length;
      });
    }
    return roots.filter(root => matches(root.session) || root.children.length || root.workers.length);
  }

  const foldKey = key => 'pinkie:session-sidebar:fold:' + key;
  const temporaryFolds = new Map();
  function folded(key, fallback) {
    if (temporaryFolds.has(key)) return temporaryFolds.get(key);
    try {
      const value = localStorage.getItem(foldKey(key));
      return value === null ? fallback : value === '1';
    } catch { return fallback; }
  }

  function setFolded(key, value) {
    temporaryFolds.set(key, value);
    try { localStorage.setItem(foldKey(key), value ? '1' : '0'); } catch {}
    signature = '';
    if (current) render(current.section, current.api);
  }

  function viewChildren(key) {
    if (!current) return;
    query = '';
    setFolded(key, false);
    const host = [...current.section.querySelectorAll('.session-row-host')].find(node => node.dataset.sessionKey === key);
    host?.scrollIntoView({block: 'nearest'});
  }

  const shapes = {
    running: ['M21 12a9 9 0 1 1-9-9'],
    waiting: ['M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.4z', 'M9 12h6'],
    error: ['M12 8v4m0 4h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0'],
    feishu: ['m22 2-7 20-4-9-9-4 20-7Z', 'M22 2 11 13'],
    chat: ['M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.3-3.2A7.5 7.5 0 1 1 20 11.5Z', 'M10 11h5'],
  };
  const statusLabels = {running: '运行中', waiting: '等你回复', error: '上一轮出错'};
  function sessionIcon(kind, label, className) {
    const icon = el('span', className);
    icon.title = label;
    icon.setAttribute('aria-label', label);
    icon.setAttribute('role', 'img');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of shapes[kind]) {
      const line = document.createElementNS(svg.namespaceURI, 'path');
      line.setAttribute('d', d);
      svg.append(line);
    }
    icon.append(svg);
    return icon;
  }

  function sessionStatus(s) {
    if (s.hasActiveRun || s.hasActiveSubagentRun
        || s.hasActiveRun === undefined && /^(?:running|queued)$/i.test(s.status || '')) return 'running';
    if (s.phase === 'waiting') return 'waiting';
    if (s.phase === 'error' || /^(?:error|failed|timeout)$/i.test(s.status || '')) return 'error';
    return '';
  }

  // Compare local calendar days, not elapsed 24-hour periods (DST days can
  // have 23 or 25 hours). Invalid timestamps remain in the oldest section.
  function calendarAge(value, now = Date.now()) {
    const date = new Date(value), today = new Date(now);
    if (!value || !Number.isFinite(date.getTime()) || !Number.isFinite(today.getTime())) return Infinity;
    const day = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.max(0, Math.floor((day(today) - day(date)) / 86400000));
  }
  function dateGroup(value, now = Date.now()) {
    const age = calendarAge(value, now);
    return age === 0 ? '今天' : age === 1 ? '昨天' : age < 7 ? '7 天内' : age < 30 ? '30 天内' : '更早';
  }
  function dateLabel(value, now = Date.now()) {
    const age = calendarAge(value, now);
    if (!Number.isFinite(age)) return '';
    const date = new Date(value);
    if (age === 0) return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    if (age < 7) return '周' + '日一二三四五六'[date.getDay()];
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function readCurrent(rows, api) {
    const key = api.currentKey;
    const row = rows.find(s => s.key === key && s.unread);
    if (!row || clearingUnread.has(key)) return;
    clearingUnread.add(key);
    void api.gwRequest('sessions.patch', {key, agentId: api.agentId, unread: false}).then(() => {
      row.unread = false;
      signature = '';
      if (current) render(current.section, current.api);
    }).catch(() => {}).finally(() => clearingUnread.delete(key));
  }

  function row(s, api, {children = 0, collapsed = false, worker = false} = {}) {
    const n = el('div', 'sidebar-recent-session session-row-host');
    n.dataset.sessionKey = s.key;
    n.classList.toggle('sidebar-recent-session--active', s.key === api.currentKey);
    n.classList.toggle('pinkie-session-persona', worker);
    const name = title(s);
    const link = el('a', 'sidebar-recent-session__link');
    link.href = '/chat?session=' + encodeURIComponent(s.key);
    link.title = worker ? name + '（只读）' : name;
    const channel = s.meta?.channel;
    if (channel) link.append(sessionIcon(channel === 'feishu' ? 'feishu' : 'chat',
      s.meta.channelTitle || channel, 'pinkie-session-icon pinkie-session-channel'));
    link.append(el('span', 'sidebar-recent-session__name', name));
    link.onclick = e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      api.navigateSession(s.key);
    };
    const aside = el('span', 'session-row-aside');
    const phase = sessionStatus(s);
    if (phase) aside.append(sessionIcon(phase, statusLabels[phase], 'pinkie-session-icon pinkie-session-status--' + phase));
    if (s.unread) {
      const dot = el('span', 'pinkie-session-unread');
      dot.title = '未读';
      dot.setAttribute('aria-label', '未读');
      dot.setAttribute('role', 'img');
      aside.append(dot);
    }
    if (!phase && !s.unread) {
      const time = dateLabel(s.updatedAt);
      if (time) aside.append(el('time', 'pinkie-session-time', time));
    }
    if (children) {
      const expand = button((collapsed ? '› ' : '⌄ ') + children, (collapsed ? '展开' : '收起') + name + '的子会话',
        () => setFolded(archived ? 'archive:' + s.key : s.key, !collapsed));
      expand.classList.add('pinkie-session-fold');
      expand.setAttribute('aria-expanded', String(!collapsed));
      aside.append(expand);
    }
    const actions = el('span', 'laolao-row-actions');
    if (archived && s.archived) {
      actions.append(
        button('↶', '恢复会话：' + name, async e => {
          const b = e.currentTarget;
          b.disabled = true;
          try { await api.patchSession(s.key, {archived: false}); api.toast('会话已恢复，记录和项目绑定都保留'); }
          catch (error) { api.toast(error.message); }
          finally { b.disabled = false; }
        }),
        button('⋯', '管理已归档会话：' + name, e => api.sessionMenu(e.currentTarget, s.key, name, true))
      );
    } else if (!worker && !archived) {
      actions.append(button('⋯', '管理会话：' + name, e => api.sessionMenu(e.currentTarget, s.key, name, false, {
        detachable: Boolean(s.lineage?.parentKey && !s.lineage.detached), children,
      })));
    }
    aside.append(actions);
    n.append(link, aside);
    return n;
  }

  function addWorkers(host, node, api) {
    if (!node.workers.length) return;
    const key = 'workers:' + node.session.key;
    const collapsed = !query.trim() && folded(key, true);
    const list = el('div', 'pinkie-session-branch pinkie-session-workers');
    const toggle = button((collapsed ? '›' : '⌄') + ' 分身 ' + node.workers.length,
      (collapsed ? '展开' : '收起') + '分身', () => setFolded(key, !collapsed));
    toggle.setAttribute('aria-expanded', String(!collapsed));
    list.append(toggle);
    for (const s of node.workers) if (!collapsed || s.key === api.currentKey) list.append(row(s, api, {worker: true}));
    host.append(list);
  }

  function addTree(host, node, api) {
    const key = archived ? 'archive:' + node.session.key : node.session.key;
    const collapsed = !query.trim() && folded(key, archived);
    host.append(row(node.session, api, {children: node.children.length, collapsed}));
    const shown = collapsed ? node.children.filter(child => child.session.key === api.currentKey
      || child.workers.some(worker => worker.key === api.currentKey)) : node.children;
    if (shown.length) {
      const branch = el('div', 'pinkie-session-branch');
      for (const child of shown) {
        branch.append(row(child.session, api));
        addWorkers(branch, child, api);
      }
      host.append(branch);
    }
    addWorkers(host, node, api);
  }
  function group(id,name,rows,api,project){
    const n=el('section','laolao-group');n.dataset.laolaoGroup=id;
    const head=el('div','laolao-group__head');const collapsed=!!api.state.collapsed[id];
    const toggle=button(collapsed?'›':'⌄',(collapsed?'展开':'收起')+name,()=>api.toggleGroup(id));toggle.classList.add('laolao-group__toggle');toggle.setAttribute('aria-expanded',String(!collapsed));
    const label=el('span','laolao-group__label',name);label.onclick=()=>api.toggleGroup(id);
    head.append(toggle,label,el('span','laolao-group__count',String(rows.reduce((count, node) => count + [node, ...node.children].filter(item => hasMessages(item.session)).length, 0) || '')));
    if(project){
      const add=button('＋','在项目「'+name+'」中新建会话',async()=>{add.disabled=true;try{await api.createProjectSession(name);}finally{add.disabled=false;}});add.classList.add('laolao-group__action');
      const settings=button('⋯','管理项目「'+name+'」',e=>api.openProjectSettings(e.currentTarget,name));settings.classList.add('laolao-group__action');head.append(add,settings);
      const path=api.state.projectFolders[name];
      if(path){const open=button('打开','在 Finder 中打开项目「'+name+'」',()=>api.revealProject(path));open.classList.add('laolao-group__action','laolao-group__open');head.insertBefore(open,settings);}
    }
    n.append(head);
    if(!collapsed){
      const list=el('div','laolao-group__list');
      if(id==='__recent') {
        const now=Date.now();
        for(const label of ['今天','昨天','7 天内','30 天内','更早']) {
          const matching=rows.filter(node=>dateGroup(node.session.updatedAt,now)===label);
          if(!matching.length)continue;
          list.append(el('div','pinkie-session-date',label));
          for(const node of matching)addTree(list,node,api);
        }
      } else for(const node of rows)addTree(list,node,api);
      if(!rows.length)list.append(el('div','laolao-group__empty',loading.size?'正在读取…':project?'点 ＋ 开始一个会话':'暂无会话'));
      if(project&&api.state.projectFolders[name]){const p=el('div','laolao-project__path',api.state.projectFolders[name].replace(/^\/Users\/[^/]+/,'~'));p.title=api.state.projectFolders[name];n.append(p);}
      n.append(list);
    }
    return n;
  }
  function render(section,api){
    current={section,api};
    if(lastMode!==api.mode){lastMode=api.mode;query='';archived=false;limit=30;signature='';}
    const key=api.mode+'|'+archived;void load(api);
    // Only our DOM is rebuilt. Native list remains mounted and can reconcile safely.
    section.classList.add('laolao-managed-sessions');
    document.documentElement.setAttribute('data-laolao-sessions-managed','1');
    let host=section.querySelector('#laolao-session-manager');
    if(!host){host=el('div');host.id='laolao-session-manager';section.append(host);signature='';}
    const cached = cache.get(key);
    const rows = cached?.rows || [];
    const next = JSON.stringify([api.mode, archived, query, limit, cached?.version, api.state, api.currentKey, new Date().toDateString()]);
    if(signature===next)return;signature=next;
    let search=host.querySelector('.laolao-session-search');
    if(!search){search=el('input','laolao-session-search');search.type='search';search.placeholder='搜索当前模式的会话';search.setAttribute('aria-label','搜索当前模式的会话');search.oninput=()=>{query=search.value;signature='';render(current.section,current.api);};}
    search.value=query;
    let controls=host.querySelector('.laolao-session-controls');
    if(!controls){controls=el('div','laolao-session-controls');controls.append(search);host.append(controls);}
    for(const n of [...controls.children])if(n!==search)n.remove();
    controls.append(button(archived?'‹ 返回':'归档',archived?'返回进行中的会话':'查看已归档会话',()=>{archived=!archived;limit=30;signature='';render(section,api);}));
    if(['chat','project','thinking','learning'].includes(api.mode)&&typeof api.openSessionManagement==='function'){
      controls.append(button('更多','更多会话管理',e=>api.openSessionManagement(e.currentTarget)));
    }else{
      const deleteAll=button('全部删除','删除当前模式的全部普通会话和聊天记录',()=>api.askDeleteAllSessions());
      deleteAll.classList.add('laolao-managed-button--danger');controls.append(deleteAll);
    }
    const old=host.querySelector('.laolao-managed-groups');const groups=el('div','laolao-managed-groups');
    const tree = buildTree(rows, {archive: archived, currentKey: api.currentKey, query});
    if (archived) groups.append(group('__archive', '已归档', tree, api));
    else {
      const pinned = node => [node, ...node.children].some(item => api.state.pins.includes(item.session.key));
      const pinnedRows = tree.filter(pinned);
      if (pinnedRows.length) groups.append(group('__pins', '置顶', pinnedRows, api));
      const heading = el('div', 'laolao-group__head');
      heading.append(el('span', 'laolao-group__label', '项目文件夹'));
      const add = button('＋ 打开文件夹', '选择文件夹并建立项目', () => api.addFolderProject(null, {bindCurrent: true}));
      add.classList.add('laolao-group__action', 'laolao-group__add-project');
      heading.append(add);
      groups.append(heading);
      const assigned = new Set();
      for (const [name, keys] of Object.entries(api.state.projects)) {
        const members = new Set(keys);
        const projectRows = tree.filter(node => !pinned(node) && (members.has(node.session.key)
          || node.session.lineage?.detached && members.has(node.session.lineage.parentKey)));
        for (const node of projectRows) assigned.add(node.session.key);
        if (query && !projectRows.length && !name.toLowerCase().includes(query.toLowerCase())) continue;
        groups.append(group('proj:' + name, name, projectRows, api, true));
      }
      const recent = tree.filter(node => !assigned.has(node.session.key) && !pinned(node));
      groups.append(group('__recent', '最近', recent.slice(0, limit), api));
      if (recent.length > limit) groups.append(button('显示更多会话', '显示更多当前模式会话', () => {
        limit += 30; signature = ''; render(section, api);
      }));
    }
    if(old)old.replaceWith(groups);else host.append(groups);
    ensureVisibleTitles(groups, rows, api);
    if (!archived) readCurrent(rows, api);
  }
  function chooseFolder(value,request){
    return new Promise(resolve=>{
      const mask=el('div','laolao-modal-mask');const dialog=el('form','laolao-modal');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
      dialog.append(el('h3','laolao-modal__title','选择项目文件夹'),el('p','laolao-modal__body','浏览器不能直接取得本机文件夹路径。粘贴完整路径即可，App 内仍可使用系统选择器。'));
      const input=el('input','laolao-menu__input');input.value=value||'';input.placeholder='/完整路径/项目文件夹';input.setAttribute('aria-label','项目文件夹完整路径');dialog.append(input);
      const error=el('p','laolao-modal__body');error.setAttribute('role','status');dialog.append(error);
      const actions=el('div','laolao-modal__buttons');const cancel=button('取消','取消选择文件夹',()=>finish(null));const ok=button('使用这个文件夹','确认项目文件夹',()=>{});ok.type='submit';actions.append(cancel,ok);dialog.append(actions);mask.append(dialog);document.body.append(mask);
      function finish(result){mask.remove();resolve(result);}
      dialog.onsubmit=async e=>{e.preventDefault();ok.disabled=true;try{const result=await request('pinkie.project.validate',{path:input.value.trim()});finish({path:result.path,name:result.path.split('/').filter(Boolean).pop()});}catch(e){error.textContent=e.message;}finally{ok.disabled=false;}};
      mask.onkeydown=e=>{if(e.key==='Escape')finish(null);};input.focus();
    });
  }
  window.PinkieSessionList={render,invalidate,chooseFolder,isBadTitle,buildTree,viewChildren,sessionStatus,dateGroup,dateLabel};
  let refreshTimer;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(invalidate, 250);
  }
  window.addEventListener('laolao:sessions-changed', refreshSoon);
  window.addEventListener('pinkie:sidebar-gateway-ready', refreshSoon);
  window.addEventListener('pinkie:gateway-event', ({detail}) => {
    if (detail?.event === 'agent' && detail.payload?.stream === 'lifecycle') refreshSoon();
  });
})();
