// The live run, as data. Which step is on screen, what it says, when it is held for a beat,
// and how a run ends. No DOM and no timers in here, so the choreography can be tested
// directly: the view (status.js) only paints what this module decides.
//
// Ported from the original laolao-cle-stage.js: same verbs, same tool-name detection,
// same argument line, same MIN_STEP hold so a 40 ms tool call is still readable.

export const VERB = {
  think: '思考中', read: '正在读取', write: '正在写入', edit: '正在修改',
  exec: '正在执行', ask: '等你确认', plan: '正在更新计划', reply: '正在回复',
  done: '完成', stopped: '已中断',
};

// startup phases the gateway reports before the model says anything
export const PREP = {
  preparing_workspace: '铺纸', preparing_context: '理线索', starting_model: '凝神', retrying: '再试',
};

// A tool that answers in 40 ms must still be visible. This is presentation pacing, not
// invented progress: every step shown comes from a real tool event.
export const MIN_STEP = 1400;
export const DONE_HOLD = 6900;   // the full 落款: quill signature, ink bloom, sweep, dissolve
export const STOP_HOLD = 1200;   // interrupted runs never get a signature

const firstLine = (v) => String(v == null ? '' : v).split('\n').map((x) => x.trim()).find(Boolean) || '';
export const homeless = (p) => String(p).replace(/^\/Users\/[^/]+/, '~');

// Tool name → choreography kind. Order matters: patch/edit before write, read last.
export function kindOf(name) {
  const s = String(name || '').toLowerCase();
  if (/plan_update|update_plan|progress_card|更新工作计划/.test(s)) return 'plan';
  if (/apply_patch|\bpatch\b|\bedit\b|multiedit|replace|修改|编辑|替换|补丁/.test(s)) return 'edit';
  if (/\bwrite\b|\bcreate\b|notebook|写入|新建|创建|保存/.test(s)) return 'write';
  if (/\bread\b|fetch|search|grep|glob|\blist\b|\bls\b|browse|web|查看|读取|搜索|浏览|查找|检索/.test(s)) return 'read';
  return 'exec';
}

// What the status line says about the current step: the command itself, the file, the query.
export function argText(name, args, meta) {
  const a = args && typeof args === 'object' ? args : {};
  const path = a.path || a.file_path || a.filePath || a.file;
  if (name === 'plan_update' && Array.isArray(a.items)) {
    const item = a.items.find((x) => x && x.status === 'in_progress') || a.items.find((x) => x && x.status !== 'completed');
    return {text: item ? firstLine(item.text) : '全部完成', mono: false};
  }
  let t = '', mono = true;
  if (a.command || a.cmd) t = firstLine(a.command || a.cmd);
  else if (path) {
    t = homeless(path);
    const from = Number(a.offset || a.start_line || 0), n = Number(a.limit || 0);
    if (from || n) t += ':' + (from || 1) + (n ? '–' + ((from || 1) + n - 1) : '');
  } else if (a.query || a.q) { t = firstLine(a.query || a.q); mono = false; }
  else if (a.url) t = a.url;
  else if (meta) { t = firstLine(meta); mono = false; }
  else { const v = Object.values(a).find((x) => typeof x === 'string' && x.trim()); t = firstLine(v); mono = false; }
  if (!t && meta) { t = firstLine(meta); mono = false; }
  return {text: t.length > 160 ? t.slice(0, 159) + '…' : t, mono};
}

// Particle states the renderer knows: idle think read write edit done.
export function stateFor(kind) {
  if (kind === 'done') return 'done';
  if (!kind || kind === 'stopped') return 'idle';
  if (kind === 'read' || kind === 'edit' || kind === 'think') return kind;
  return 'write';                         // exec · ask · plan · reply — the quill works
}

export function fmtElapsed(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export function newRun(now = Date.now(), startedAt) {
  return {
    on: true, seen: true, finished: false,
    since: Number.isFinite(startedAt) ? startedAt : now,
    endedAt: 0, stopped: false, until: 0, took: 0, holdUntil: 0,
    bg: 'think', queue: [], cur: null, tools: 0,
  };
}

const step = (kind, text, mono, extra) => ({kind, text: text || '', mono: !!mono, label: '', done: false, at: 0, ...extra});

// Streams that mean "this session is doing something right now". Used to resume a run when
// the page was opened in the middle of one (no lifecycle start will arrive).
export const LIVE_STREAMS = new Set(['thinking', 'assistant', 'tool', 'execution', 'run_status', 'plan']);

// The native `chat` payload carries no `stream` field: it is `{runId, sessionKey, state, …}`
// with state ∈ delta | final | error | aborted (or a `message` for injected turns). Older
// adapters (and our own previous version) expected `stream: 'chat'`, so terminal states from
// the real bus were silently dropped and the run never ended.
const CHAT_STATES = new Set(['delta', 'final', 'error', 'aborted']);

export function normalizeChat(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.stream === 'chat') return {stream: 'chat', data: {state: p.state ?? p.data?.state}, sessionKey: p.sessionKey};
  const state = typeof p.state === 'string' ? p.state : '';
  if (!CHAT_STATES.has(state)) return null;
  return {stream: 'chat', data: {state}, sessionKey: p.sessionKey};
}

// Does this event prove the session is working right now? Used instead of assuming that any
// event implies activity — an unknown or terminal event must never create a busy state.
export function isLiveEvent(p) {
  if (!p || typeof p !== 'object') return false;
  const chat = normalizeChat(p);
  if (chat) return chat.data.state === 'delta';
  const stream = p.stream;
  if (stream === 'lifecycle') return p.data?.phase === 'start';
  return LIVE_STREAMS.has(stream);
}

// Apply one gateway agent event. Returns true when the run changed.
export function applyEvent(run, p, now = Date.now()) {
  if (!run || !p) return false;
  const chat = normalizeChat(p);
  if (chat) p = chat;
  const stream = p.stream, d = p.data || {};

  if (stream === 'lifecycle') {
    if (d.phase === 'start') {
      Object.assign(run, newRun(now, d.startedAt));
      return true;
    }
    if (d.phase === 'end' || d.phase === 'error') {
      run.on = false;
      run.endedAt = Number.isFinite(d.endedAt) ? d.endedAt : now;
      run.stopped = d.phase === 'error' || d.aborted === true
        || /abort|error|cancel|interrupt/i.test(String(d.stopReason || d.reason || ''));
      run.queue.length = 0;
      run.cur = null;
      return true;
    }
    return false;
  }

  if (stream === 'chat') {
    // the chat stream reports terminal states on the payload itself
    const state = String(d.state || '');
    if (['aborted', 'error', 'final', 'completed'].includes(state)) {
      if (!run.on) return false;
      run.on = false;
      run.endedAt = now;
      run.stopped = state === 'aborted' || state === 'error';
      run.queue.length = 0;
      run.cur = null;
      return true;
    }
    if (state === 'delta') {
      if (!run.on) return false;
      const was = run.bg;
      run.bg = 'reply';
      return was !== 'reply';
    }
    return false;
  }

  if (!run.on && run.finished) return false;

  if (stream === 'thinking') { const was = run.bg; run.bg = 'think'; return was !== 'think'; }
  if (stream === 'assistant') { const was = run.bg; run.bg = 'reply'; return was !== 'reply'; }

  if (stream === 'run_status') {
    const word = PREP[d.phase];
    if (!word) return false;
    const id = `prep:${d.phase}`;
    if (run.queue.some((x) => x.id === id) || (run.cur && run.cur.id === id)) return false;
    // a startup phase has no end event of its own: it is shown for one beat (MIN_STEP) and then
    // gives way. Left open it held the line on 凝神 for the whole run, every tool queued behind it.
    run.queue.push(step('think', '', false, {id, label: word, done: true}));
    return true;
  }

  if (stream === 'plan') {
    const items = Array.isArray(d.items) ? d.items : null;
    const text = items ? argText('plan_update', {items}).text : firstLine(d.title || '');
    run.queue.push(step('plan', text, false, {id: `plan:${now}`}));
    return true;
  }

  if (stream === 'tool') {
    const id = String(d.toolCallId || d.itemId || '');
    if (d.phase === 'start') {
      const kind = d.name === 'ask_user' ? 'ask' : kindOf(d.name);
      const a = argText(d.name, d.args, d.meta);
      run.tools += 1;
      run.queue.push(step(kind, a.text, a.mono, {id}));
      return true;
    }
    if (d.phase === 'result' || d.phase === 'end') {
      const hit = (run.cur && run.cur.id === id ? run.cur : null) || run.queue.find((x) => x.id === id);
      if (hit && !hit.done) { hit.done = true; return true; }
      return false;
    }
    return false;
  }

  if (stream === 'execution') {
    // approvals wait on the user: show it as 「等你确认」 until it is resolved
    const approval = d.approval;
    if (approval && approval.state === 'pending') {
      run.queue.push(step('ask', String(approval.label || approval.reason || ''), false, {id: `approval:${approval.id || now}`}));
      return true;
    }
    if (approval && approval.state === 'resolved') {
      const hit = run.queue.find((x) => String(x.id || '').startsWith('approval:')) || (run.cur && String(run.cur.id || '').startsWith('approval:') ? run.cur : null);
      if (hit) hit.done = true;
      return true;
    }
    return false;
  }

  return false;
}

// Which step should be on screen now. Mutates only the queue cursor.
// Each step is held for at least MIN_STEP so the particle state is actually seen.
export function pace(run, now = Date.now()) {
  if (!run) return {kind: 'think', text: '', mono: false, label: ''};
  if (run.cur) {
    const held = now - run.cur.at < MIN_STEP;
    if (held || !run.cur.done) return run.cur;
  }
  if (run.queue.length) {
    run.cur = run.queue.shift();
    run.cur.at = now;
    return run.cur;
  }
  run.cur = null;
  return {kind: run.bg, text: '', mono: false, label: ''};
}

// How long until the current hold expires (0 = nothing pending).
export function holdFor(run, now = Date.now()) {
  if (!run || !run.cur) return 0;
  const left = run.cur.at + MIN_STEP - now;
  return left > 0 ? left : 0;
}

// Does a mutation record come from our own writes? Our line is the only thing we put into a
// pane, so anything inside `.cle-status` (or a record whose added/removed nodes are all our
// own) must not schedule another scan — otherwise the observer feeds itself forever.
// `isOurs(node)` is supplied by the caller because it needs the live DOM.
export function shouldRescan(record, isOurs) {
  if (!record) return false;
  if (isOurs(record.target)) return false;
  const added = record.addedNodes || [];
  const removed = record.removedNodes || [];
  // A record with no nodes is not one of our appends (we always add or remove the line), so
  // treat it as real traffic.
  if (!added.length && !removed.length) return true;
  const ours = (list) => {
    for (const node of list) if (!isOurs(node)) return false;
    return true;
  };
  return !(ours(added) && ours(removed));
}
