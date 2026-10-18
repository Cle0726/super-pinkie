// The live status line: the original C.le. particles, one verb, the actual command
// or file, and elapsed time. The adapter follows the native active session.
// Driven by the gateway's agent events for the session on screen; replaces the stock dots.
import {particleGlyph} from './particles.js';

const TOOL_VERBS = [
  [/^(exec|bash|shell|process|terminal)/i, '执行'],
  [/^(read|view|cat|look|open)/i, '翻阅'],
  [/^(write|create)/i, '落笔'],
  [/^(edit|apply_patch|patch|replace)/i, '修改'],
  [/(search|grep|find|glob)/i, '搜寻'],
  [/(web|fetch|browser|http|app_browser)/i, '远望'],
  [/(memory|clekk_memory)/i, '回想'],
  [/(plan_update|plan)/i, '排布'],
  [/(code_check|test)/i, '核对'],
  [/(computer|screen)/i, '动手'],
  [/(learning|quiz)/i, '出题'],
  [/(sessions_spawn|subagent|agent)/i, '分派'],
];
const THINK = ['凝神', '端详', '推敲', '斟酌', '静观'];
const PREP = {preparing_workspace: '铺纸', preparing_context: '理线索', starting_model: '凝神'};

const verbFor = (name) => (TOOL_VERBS.find(([re]) => re.test(name || ''))?.[1]) || '动手';
const detailFor = (data) => {
  const a = data?.args || {};
  const raw = a.command || a.cmd || a.path || a.file_path || a.filePath || a.url || a.query || a.pattern || data?.meta || '';
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return s.length > 64 ? s.slice(0, 61) + '…' : s;
};
const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function mountStatus(host, signal) {
  const glyph = particleGlyph(signal);
  const runs = new Map();                 // sessionKey → {startedAt, mode, verb, detail}
  let thinkIdx = 0;
  const current = () => runs.get(host.sessions?.selectedKey || '');

  const render = (el, run) => {
    if (!run) return;
    el.dataset.mode = run.mode;
    const verb = el.querySelector('.cle-status__verb');
    if (verb.textContent !== run.verb) { verb.textContent = run.verb; verb.classList.remove('is-new'); void verb.offsetWidth; verb.classList.add('is-new'); }
    const chip = el.querySelector('.cle-status__chip');
    chip.textContent = run.detail || '';
    chip.hidden = !run.detail;
    el.querySelector('.cle-status__time').textContent = fmt(Date.now() - run.startedAt);
  };

  const build = () => {
    const el = document.createElement('span');
    el.className = 'cle-status';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="cle-status__glyph" aria-hidden="true"></span><span class="cle-status__verb"></span><span class="cle-status__chip" hidden></span><span class="cle-status__time"></span>`;
    return el;
  };

  // mount into the native working indicator of the pane on screen
  const sync = () => {
    const pane = document.querySelector('.chat-pane-cache__pane--active') || document;
    const indicators = pane.querySelectorAll('.chat-working-indicator');
    if (!indicators.length) glyph.park();
    for (const ind of indicators) {
      let el = ind.querySelector(':scope > .cle-status');
      if (!el) { el = build(); ind.append(el); }
      const run = current() || {startedAt: Date.now(), mode: 'think', verb: THINK[0], detail: ''};
      if (!current()) runs.set(host.sessions?.selectedKey || '', run);
      render(el, run);
      glyph.attach(el.querySelector('.cle-status__glyph'), run);
    }
  };

  const onAgent = (p) => {
    const key = p?.sessionKey; if (!key) return;
    const d = p.data || {};
    let run = runs.get(key);
    if (p.stream === 'lifecycle' && d.phase === 'start') { run = {startedAt: d.startedAt || Date.now(), mode: 'think', verb: THINK[0], detail: ''}; runs.set(key, run); }
    if (!run) { run = {startedAt: p.ts || Date.now(), mode: 'think', verb: THINK[0], detail: ''}; runs.set(key, run); }
    if (p.stream === 'run_status' && PREP[d.phase]) Object.assign(run, {mode: 'prep', verb: PREP[d.phase], detail: ''});
    else if (p.stream === 'thinking') { if (run.mode !== 'think') Object.assign(run, {mode: 'think', verb: THINK[thinkIdx++ % THINK.length], detail: ''}); }
    else if (p.stream === 'tool' && d.phase === 'start') Object.assign(run, {mode: 'tool', tool: d.name, verb: verbFor(d.name), detail: detailFor(d)});
    else if (p.stream === 'tool' && d.phase === 'result') Object.assign(run, {mode: 'think', verb: THINK[thinkIdx++ % THINK.length], detail: ''});
    else if (p.stream === 'assistant') Object.assign(run, {mode: 'write', verb: '落笔', detail: ''});
    else if (p.stream === 'lifecycle' && (d.phase === 'end' || d.phase === 'error')) { Object.assign(run, {mode: 'done', verb: d.phase === 'error' ? '停笔' : '落款', detail: ''}); setTimeout(() => runs.delete(key), 4000); }
    schedule();
  };

  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  const off = host.onEvent('agent', onAgent);
  // the work is shown, not hidden: open each activity group once (the user can still fold it again)
  const unfold = () => {
    for (const b of document.querySelectorAll('.chat-pane-cache__pane--active .chat-activity-group__summary:not([data-cle-auto])')) {
      b.dataset.cleAuto = '1';
      if (b.getAttribute('aria-expanded') === 'false') b.click();
    }
  };
  const mo = new MutationObserver(() => { schedule(); requestAnimationFrame(unfold); });
  mo.observe(document.body, {childList: true, subtree: true});
  const tick = setInterval(() => { if (document.querySelector('.chat-working-indicator')) schedule(); }, 1000);
  signal.addEventListener('abort', () => { off?.(); mo.disconnect(); clearInterval(tick); document.querySelectorAll('.cle-status').forEach((e) => e.remove()); }, {once: true});
}
