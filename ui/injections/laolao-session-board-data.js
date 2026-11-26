/* laolao-session-board-data:v1 —— 多会话并行看板的纯数据层（设计 S6 第一步）
 *
 * 只负责读列表、节流、看门狗、事件拼「在做什么 / 等你」、排序和上限。
 * 不画界面。挂 window.Pinkie.sessionBoard，不新增 window.__*，不加观察器。 */
(() => {
  'use strict';

  const MAX_VISIBLE = 12;
  const MAX_DONE = 5;
  const DONE_MS = 10 * 60_000;
  const MAX_CHILDREN = 10;
  const LIST_LIMIT = 200;
  const LIST_THROTTLE_MS = 1000;
  const WATCH_MS = 20_000;
  const BADGE_THROTTLE_MS = 5000;
  const PREVIEW_CHARS = 40;
  const AGENT_MODE = {main: 'chat', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'unrestricted', metre: 'metre'};
  const MODE_LABEL = {chat: '唠嗑', project: '项目', thinking: '想法', learning: '学习', unrestricted: '无限制', metre: 'Metre'};
  const TOOL_WORDS = [
    [/^(?:read|workbench_read|code_search|code_refs|code_check|grep|glob|ls|find|pinkie_session_list|learning_library|clekk_memory)$/, '读取'],
    [/^(?:web_search|web_fetch|pinkie_search|browser|app_browser|web_gpt_activity)$/, '搜索'],
    [/^(?:web_gpt)$/, '网页 GPT'],
    [/^(?:write|edit|apply_patch|code_edit|multi_edit)$/, '修改'],
    [/^(?:exec|bash|process|run_tests)$/, '命令'],
    [/^(?:computer|computer_flow)$/, '电脑'],
    [/^(?:pinkie_session_message)$/, '发消息'],
    [/^(?:plan_update)$/, '更新计划'],
    [/^(?:pinkie_session_start)$/, '派发'],
    [/^(?:pinkie_models|pinkie_model_capability)$/, '可用模型'],
    [/^(?:metre_memory)$/, '项目记忆'],
  ];

  const agentOf = (key) => /^agent:([^:]+):/.exec(String(key || ''))?.[1] || '';
  const modeOf = (key) => AGENT_MODE[agentOf(key)] || '';
  const modeLabel = (key) => MODE_LABEL[modeOf(key)] || '';
  const titleOf = (row = {}) => String(row.label || row.displayName || row.derivedTitle || '新会话');
  const isSubagent = (row) => String(row?.key || '').includes(':subagent:') || String(row?.kind || '') === 'subagent';
  const clip = (text, n = PREVIEW_CHARS) => {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) : s;
  };

  function toolLabel(name) {
    const raw = String(name || '');
    if (!raw) return '';
    const api = (typeof window !== 'undefined' && window.__pinkieToolKind) || null;
    if (api) {
      const kind = typeof api.refine === 'function' ? api.refine('', raw, {}, null) : '';
      const phrase = (kind && typeof api.ing === 'function' && api.ing(kind)) || (api.ING && api.ING[kind]) || '';
      if (phrase) return String(phrase).replace(/^正在/, '').replace(/^在/, '');
    }
    const hit = TOOL_WORDS.find(([re]) => re.test(raw));
    return hit ? hit[1] : raw;
  }

  function describeRow(row = {}, live = {}) {
    if (live.waiting) {
      const cmd = clip(live.command);
      return cmd ? `等你确认：${cmd}` : '等你确认';
    }
    if (live.toolName) return `在用${toolLabel(live.toolName)}`;
    if (live.chat) return '正在回复';
    if (live.running) return '在跑';
    return clip(row.lastMessagePreview || live.preview || '');
  }

  function isRunning(row, live = {}) {
    if (live.waiting) return false;
    return row.hasActiveRun === true || row.status === 'running' || row.status === 'queued';
  }

  function statusOf(row, live = {}) {
    if (live.stale && isRunning(row, {...live, waiting: false}) && !live.waiting) return 'stale-running';
    if (live.waiting) return 'waiting';
    if (row.status === 'queued' || live.status === 'queued') return 'queued';
    if (live.error) return 'error';
    if (row.status === 'error' || row.lastRunError) return 'error';
    if (isRunning(row, live)) return 'running';
    return 'done';
  }

  function formatElapsed(ms, estimated) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const m = Math.floor(ms / 60000);
    if (estimated) return `≥ ${Math.max(m, 1)} 分`;
    const s = Math.floor((ms % 60000) / 1000);
    return m > 0 ? `${m} 分${s ? ` ${s} 秒` : ''}` : `${s} 秒`;
  }

  function startOf(row, live = {}) {
    if (Number.isFinite(live.startedAt)) return {at: live.startedAt, estimated: Boolean(live.estimated)};
    if (Number.isFinite(row.startedAt)) return {at: row.startedAt, estimated: Boolean(live.openedAt) && row.startedAt < live.openedAt};
    return null;
  }

  function rankOf(status) {
    if (status === 'waiting') return 0;
    if (status === 'running' || status === 'queued' || status === 'stale-running') return 1;
    if (status === 'error') return 2;
    return 3;
  }

  function decorate(row, liveBag, now) {
    const key = row.key;
    const waiting = liveBag.waiting.get(key);
    const doing = liveBag.doing.get(key) || {};
    const started = liveBag.started.get(key);
    const live = {
      waiting: Boolean(waiting),
      command: waiting?.command || '',
      toolName: doing.toolName || '',
      chat: doing.chat === true,
      running: isRunning(row, {waiting: false}),
      error: liveBag.errors.has(key),
      stale: liveBag.stale,
      startedAt: started?.at,
      estimated: started?.estimated,
      openedAt: liveBag.openedAt,
      status: row.status,
    };
    if (live.running && !doing.toolName && !doing.chat && !waiting) live.running = true;
    const status = statusOf(row, live);
    const startedInfo = startOf(row, live);
    let elapsed = '';
    if (startedInfo && (status === 'running' || status === 'queued' || status === 'stale-running' || status === 'waiting')) {
      const estimated = startedInfo.estimated || (liveBag.openedAt && startedInfo.at < liveBag.openedAt && !Number.isFinite(started?.at && !started.estimated ? started.at : NaN) && !Number.isFinite(live.startedAt) === false ? started?.estimated : startedInfo.estimated);
      elapsed = formatElapsed(now - startedInfo.at, Boolean(startedInfo.estimated));
    }
    const text = describeRow(row, {
      waiting: live.waiting,
      command: live.command,
      toolName: doing.toolName,
      chat: doing.chat,
      running: status === 'running' || status === 'queued' || status === 'stale-running',
    });
    return {
      key,
      title: titleOf(row),
      mode: modeOf(key),
      modeLabel: modeLabel(key),
      status: status === 'stale-running' ? 'stale-running' : status,
      statusText: status === 'stale-running' ? '断线前在跑' : status,
      doing: status === 'stale-running' ? '断线前在跑' : text,
      doingIdle: !live.waiting && !doing.toolName && !doing.chat && status !== 'running' && status !== 'queued' && status !== 'stale-running',
      elapsed,
      startedAt: startedInfo?.at || 0,
      estimated: Boolean(startedInfo?.estimated),
      totalTokens: row.totalTokens,
      contextTokens: row.contextTokens,
      pinkieCompactionBudget: row.pinkieCompactionBudget,
      spawnedBy: row.spawnedBy || '',
      model: row.model || row.activeModel || '',
      subagent: isSubagent(row),
      source: row,
    };
  }

  function buildView(sessions, liveBag, now, opts = {}) {
    const expanded = opts.expandedParents || liveBag.expandedParents || new Set();
    const parents = new Map();
    const orphans = [];
    const decorated = sessions.map((row) => decorate(row, liveBag, now));
    for (const row of decorated) {
      if (row.subagent) {
        const parentKey = row.spawnedBy || '';
        if (parentKey) {
          if (!parents.has(parentKey)) parents.set(parentKey, []);
          parents.get(parentKey).push(row);
        } else orphans.push(row);
        continue;
      }
      if (!parents.has(row.key)) parents.set(row.key, parents.get(row.key) || []);
    }
    const top = [];
    for (const row of decorated) {
      if (row.subagent) continue;
      const children = (parents.get(row.key) || []).slice().sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
      const runningKids = children.filter((c) => c.status === 'running' || c.status === 'queued' || c.status === 'waiting' || c.status === 'stale-running').length;
      const open = expanded.has(row.key);
      const shownKids = open ? children.slice(0, MAX_CHILDREN) : [];
      const hiddenKids = open ? Math.max(0, children.length - MAX_CHILDREN) : 0;
      top.push({
        ...row,
        childCount: children.length,
        runningChildren: runningKids,
        childHint: runningKids ? `另有 ${runningKids} 个分身在跑` : (children.length ? `另有 ${children.length} 个分身` : ''),
        children: shownKids,
        childOverflow: hiddenKids ? `还有 ${hiddenKids} 个` : '',
        expanded: open,
      });
    }
    for (const row of orphans) top.push({...row, childCount: 0, runningChildren: 0, childHint: '', children: [], childOverflow: '', expanded: false});

    const active = [];
    const done = [];
    for (const row of top) {
      if (row.status === 'done') {
        const at = row.source.updatedAt || row.source.endedAt || 0;
        if (at && now - at <= DONE_MS) done.push(row);
        continue;
      }
      active.push(row);
    }
    active.sort((a, b) => {
      const d = rankOf(a.status) - rankOf(b.status);
      if (d) return d;
      if (rankOf(a.status) === 1) return (a.startedAt || 0) - (b.startedAt || 0);
      return (b.source.updatedAt || 0) - (a.source.updatedAt || 0);
    });
    done.sort((a, b) => (b.source.updatedAt || 0) - (a.source.updatedAt || 0));
    const visible = active.slice(0, MAX_VISIBLE);
    const hidden = active.length - visible.length;
    return {
      stale: Boolean(liveBag.stale),
      rows: visible,
      overflow: hidden > 0 ? {count: hidden, label: `还有 ${hidden} 个在跑`} : null,
      done: done.slice(0, MAX_DONE),
    };
  }

  function asArray(res, key) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res[key])) return res[key];
    if (res && Array.isArray(res.items)) return res.items;
    if (res && Array.isArray(res.sessions)) return res.sessions;
    return [];
  }

  function approvalKey(item) {
    return String(item?.sessionKey || item?.request?.sessionKey || item?.request?.session_key || item?.key || '');
  }
  function approvalCommand(item) {
    const c = item?.request?.command ?? item?.command ?? '';
    return Array.isArray(c) ? c.join(' ') : String(c || '');
  }
  function approvalId(item) {
    return item?.id || item?.request?.id || '';
  }

  function eventName(detail) {
    return detail?.event || detail?.name || '';
  }
  function eventPayload(detail) {
    return detail?.payload || detail || {};
  }
  function payloadKey(payload) {
    return String(payload?.sessionKey || payload?.key || payload?.request?.sessionKey || payload?.data?.sessionKey || '');
  }

  function snapshotRow(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const row = payload.session && typeof payload.session === 'object' ? {...payload.session} : {...payload};
    const key = row.key || payload.sessionKey;
    if (!key) return null;
    if (payload.hasActiveRun === undefined && payload.status === undefined && payload.startedAt === undefined && !payload.session) return null;
    row.key = key;
    if (payload.hasActiveRun !== undefined) row.hasActiveRun = payload.hasActiveRun;
    if (payload.activeRunIds !== undefined) row.activeRunIds = payload.activeRunIds;
    if (payload.status !== undefined) row.status = payload.status;
    if (payload.startedAt !== undefined) row.startedAt = payload.startedAt;
    if (payload.updatedAt !== undefined) row.updatedAt = payload.updatedAt;
    if (payload.reason === 'send' && !row.status) row.status = 'running';
    return row;
  }

  function createSessionBoard(deps = {}) {
    const now = deps.now || Date.now;
    const setTimer = deps.setTimeout || setTimeout;
    const clearTimer = deps.clearTimeout || clearTimeout;
    const gwRequest = deps.gwRequest;
    const target = deps.target || (typeof window !== 'undefined' ? window : null);

    const liveBag = {
      doing: new Map(),
      waiting: new Map(),
      errors: new Map(),
      started: new Map(),
      stale: false,
      openedAt: 0,
      expandedParents: new Set(),
    };
    let sessions = [];
    let opened = false;
    let lastEventAt = 0;
    let lastListAt = 0;
    let listTimer = 0;
    let watchTimer = 0;
    let badgeTimer = 0;
    let lastBadgeAt = 0;
    let listQueued = false;
    const listeners = [];

    const nativeOpen = (key) => {
      const bridge = deps.nativeBridge || (typeof window !== 'undefined' ? window.__pinkieNativeBridge : null);
      if (bridge && typeof bridge.openSession === 'function') return bridge.openSession(key);
    };

    function view() {
      return buildView(sessions, liveBag, now());
    }

    function hasRunning() {
      return view().rows.some((r) => r.status === 'running' || r.status === 'queued' || r.status === 'waiting' || r.status === 'stale-running');
    }

    function noteEvent() {
      lastEventAt = now();
      armWatch();
    }

    function armWatch() {
      if (watchTimer) { clearTimer(watchTimer); watchTimer = 0; }
      if (!opened || liveBag.stale || !hasRunning()) return;
      watchTimer = setTimer(() => {
        watchTimer = 0;
        if (!opened || liveBag.stale || !hasRunning()) return;
        if (now() - lastEventAt >= WATCH_MS) void readList();
        else armWatch();
      }, WATCH_MS);
    }

    function mergeSnapshot(row) {
      if (!row?.key) return;
      const i = sessions.findIndex((s) => s.key === row.key);
      if (i >= 0) sessions[i] = {...sessions[i], ...row};
      else sessions.push(row);
    }

    async function readList() {
      if (!opened || typeof gwRequest !== 'function') return;
      listQueued = false;
      listTimer = 0;
      lastListAt = now();
      const listed = await gwRequest('sessions.list', {limit: LIST_LIMIT, includeLastMessage: true});
      sessions = asArray(listed, 'sessions').map((s) => ({...s}));
    }

    async function readApprovals() {
      if (!opened || typeof gwRequest !== 'function') return;
      const take = (items) => {
        for (const item of items) {
          const key = approvalKey(item);
          if (!key) continue;
          liveBag.waiting.set(key, {id: approvalId(item), command: approvalCommand(item)});
        }
      };
      try { take(asArray(await gwRequest('exec.approval.list', {}), 'approvals')); } catch {}
      try { take(asArray(await gwRequest('plugin.approval.list', {}), 'approvals')); } catch {}
    }

    function requestList() {
      if (!opened) return;
      const wait = Math.max(0, LIST_THROTTLE_MS - (now() - lastListAt));
      if (wait === 0 && !listTimer) {
        void readList();
        return;
      }
      listQueued = true;
      if (listTimer) return;
      listTimer = setTimer(() => {
        listTimer = 0;
        if (listQueued && opened) void readList();
      }, wait || LIST_THROTTLE_MS);
    }

    async function open() {
      opened = true;
      liveBag.stale = false;
      liveBag.openedAt = now();
      lastEventAt = now();
      await Promise.all([readList(), readApprovals()]);
      armWatch();
      return view();
    }

    function close() {
      opened = false;
      if (listTimer) { clearTimer(listTimer); listTimer = 0; }
      if (watchTimer) { clearTimer(watchTimer); watchTimer = 0; }
      listQueued = false;
    }

    function markWaiting(payload) {
      const key = payloadKey(payload);
      if (!key) return;
      liveBag.waiting.set(key, {id: payload.id || payload.request?.id || '', command: approvalCommand(payload)});
    }
    function clearWaiting(payload) {
      const id = payload?.id || payload?.request?.id || '';
      const key = payloadKey(payload);
      if (key && liveBag.waiting.has(key)) {
        const cur = liveBag.waiting.get(key);
        if (!id || !cur.id || cur.id === id) liveBag.waiting.delete(key);
        return;
      }
      if (!id) return;
      for (const [k, v] of liveBag.waiting) {
        if (v.id === id) liveBag.waiting.delete(k);
      }
    }

    function onGateway(detail) {
      if (!opened) return;
      const name = eventName(detail);
      const payload = eventPayload(detail);
      const data = payload.data || {};
      const key = payloadKey(payload);

      if (name === 'sessions.changed') {
        noteEvent();
        const row = snapshotRow(payload);
        if (row) {
          mergeSnapshot(row);
          if (Number.isFinite(row.startedAt) && (row.hasActiveRun || row.status === 'running')) {
            liveBag.started.set(row.key, {at: row.startedAt, estimated: liveBag.openedAt && row.startedAt < liveBag.openedAt});
          }
        }
        requestList();
        return;
      }
      if (name === 'agent' && payload.stream === 'lifecycle') {
        noteEvent();
        if (data.phase === 'start') {
          const at = Number.isFinite(data.startedAt) ? data.startedAt : now();
          if (key) liveBag.started.set(key, {at, estimated: false});
        }
        if (data.phase === 'start' || data.phase === 'end' || data.phase === 'error') requestList();
        if (data.phase === 'error' && key) liveBag.errors.set(key, {at: now()});
        if (data.phase === 'end' && key) {
          liveBag.doing.delete(key);
          liveBag.errors.delete(key);
        }
        return;
      }
      if (name === 'agent' && payload.stream === 'tool') {
        noteEvent();
        const tool = data.name || data.toolName || payload.name || payload.toolName || '';
        if (key && tool) liveBag.doing.set(key, {toolName: tool, chat: false, at: now()});
        return;
      }
      if (name === 'chat') {
        noteEvent();
        const state = payload.state || data.state || '';
        if (state === 'delta' || data.delta || payload.delta) {
          if (key) liveBag.doing.set(key, {...(liveBag.doing.get(key) || {}), chat: true, at: now()});
        }
        if (state === 'error' && key) liveBag.errors.set(key, {at: now()});
        if ((state === 'final' || state === 'aborted' || state === 'error') && key) {
          if (state !== 'error') liveBag.doing.delete(key);
        }
        return;
      }
      if (name === 'exec.approval.requested' || name === 'plugin.approval.requested') {
        noteEvent();
        markWaiting(payload);
        return;
      }
      if (name === 'exec.approval.resolved' || name === 'plugin.approval.resolved') {
        noteEvent();
        clearWaiting(payload);
      }
    }

    function onLost() {
      if (!opened) return;
      liveBag.stale = true;
      if (watchTimer) { clearTimer(watchTimer); watchTimer = 0; }
    }

    async function onReady() {
      if (!opened) return;
      liveBag.stale = false;
      liveBag.doing.clear();
      liveBag.waiting.clear();
      liveBag.errors.clear();
      liveBag.started.clear();
      lastEventAt = now();
      await readList();
      armWatch();
    }

    function on(type, fn) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, fn);
      listeners.push([type, fn]);
    }
    on('pinkie:gateway-event', (ev) => onGateway(ev.detail || ev));
    on('laolao:sessions-changed', () => {
      if (!opened) return;
      noteEvent();
      requestList();
    });
    on('pinkie:sidebar-gateway-lost', onLost);
    on('pinkie:sidebar-gateway-ready', () => { void onReady(); });

    async function refreshBadge() {
      if (typeof gwRequest !== 'function') return 0;
      const wait = Math.max(0, BADGE_THROTTLE_MS - (now() - lastBadgeAt));
      if (wait && lastBadgeAt) return deps.badgeCount || 0;
      lastBadgeAt = now();
      const listed = await gwRequest('sessions.list', {limit: LIST_LIMIT, includeLastMessage: true});
      const rows = asArray(listed, 'sessions').filter((s) => !isSubagent(s) && (s.hasActiveRun || s.status === 'running' || s.status === 'queued'));
      return rows.length;
    }

    async function usage(key) {
      if (typeof gwRequest !== 'function') return null;
      return gwRequest('sessions.usage', {key});
    }

    function dispose() {
      close();
      if (badgeTimer) clearTimer(badgeTimer);
      if (target && typeof target.removeEventListener === 'function') {
        for (const [type, fn] of listeners) target.removeEventListener(type, fn);
      }
      listeners.length = 0;
    }

    return {
      open, close, dispose, view,
      isOpen: () => opened,
      requestList, readList,
      openSession: nativeOpen,
      expand: usage,
      toggleChildren(key) {
        if (liveBag.expandedParents.has(key)) liveBag.expandedParents.delete(key);
        else liveBag.expandedParents.add(key);
        return view();
      },
      refreshBadge,
      handleGateway: onGateway,
      handleLost: onLost,
      handleReady: onReady,
    };
  }

  const api = {
    describeRow, buildView, createSessionBoard, formatElapsed, toolLabel,
    modeOf, modeLabel, titleOf, isSubagent, statusOf,
    MAX_VISIBLE, MAX_DONE, DONE_MS, MAX_CHILDREN, LIST_LIMIT, LIST_THROTTLE_MS, WATCH_MS,
  };
  const root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.Pinkie = root.Pinkie || {};
  root.Pinkie.sessionBoard = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
