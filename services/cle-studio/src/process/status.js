// The live status line, as the original app had it: one moving mark, one verb, the actual
// command or file, and elapsed time. This is the *view*; the choreography lives in model.js
// and the renderer in particles.js.
//
// Contract with the new DOM:
//   · while a pane works, the native `.chat-working-indicator` holds the line;
//   · when the run ends that indicator is gone, so the line moves to the turn recap (or the
//     last activity row) to play 落款 there, then leaves after the hold;
//   · every visible pane owns its own run keyed by its session — 双模式 never shares one.
//
// Cost: anchors are resolved lazily and cached (~1.5 s or on disconnect), child nodes are
// cached per pane, and a paint only touches the DOM when its signature changes. The frame loop
// stops by itself when no run is live and no 落款 is playing.
import {createGlyphPool} from './particles.js';
import {applyEvent, pace, stateFor, fmtElapsed, newRun, shouldRescan, isLiveEvent, DONE_HOLD, STOP_HOLD} from './model.js';
import {mountFocus} from './focus.js';
import {paneSessionKey, visiblePanes} from '../rooms/split.js';

const OURS = '.cle-status';
const ANCHOR_TTL = 1500;
const GRACE = 2500;              // how long a finished run waits for the re-rendered turn
// After a run ends, an indicator left in the DOM must not be mistaken for a new run. Only a
// genuine new start (or a long quiet gap) may begin one again.
const RESUME_AFTER = 8000;

// `visiblePanes()` also returns cached panes the app keeps for a session switch. Those are
// inert / aria-hidden and not on screen: painting into them would run a second renderer that
// nobody looks at and break the two-context ceiling in single-pane use.
const shownPanes = () => visiblePanes().filter((pane) =>
  pane.isConnected && !pane.hasAttribute('inert') && pane.getAttribute('aria-hidden') !== 'true');
const VERB = {
  think: '思考中', read: '正在读取', write: '正在写入', edit: '正在修改',
  exec: '正在执行', ask: '等你确认', plan: '正在更新计划', reply: '正在回复',
};

export function mountStatus(host, signal) {
  const pool = createGlyphPool(signal);
  const focus = mountFocus(signal);
  const runs = new Map();      // sessionKey → run
  const tombstones = new Map(); // sessionKey → time the run last ended (no resurrection)
  const views = new Map();     // pane → view
  let queued = false, raf = 0, running = false, lastSecond = -1;

  const build = () => {
    const el = document.createElement('span');
    el.className = 'cle-status';
    // The native working indicator and the turn recap are themselves `role="status"`. Putting
    // another live region inside them makes a screen reader read the same progress twice. This
    // line is the visual layer of the same information, so it stays out of the a11y tree: the
    // app already announces "working" and "done in …".
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="cle-status__glyph"></span>'
      + '<span class="cle-status__verb"></span>'
      + '<span class="cle-status__chip" hidden></span>'
      + '<span class="cle-status__time"></span>';
    return el;
  };

  const viewFor = (pane) => {
    let view = views.get(pane);
    if (!view) {
      const el = build();
      view = {
        el, key: '',
        glyph: el.querySelector('.cle-status__glyph'),
        verb: el.querySelector('.cle-status__verb'),
        chip: el.querySelector('.cle-status__chip'),
        time: el.querySelector('.cle-status__time'),
        anchor: null, anchorKind: '', anchorAt: 0, sig: '',
      };
      views.set(pane, view);
    }
    return view;
  };

  const dropView = (pane) => {
    const view = views.get(pane);
    if (!view) return;
    if (view.key) pool.release(view.key);
    view.el.remove();
    views.delete(pane);
  };

  // Where the line lives right now, inside this pane. Cached: a querySelectorAll per pane per
  // frame would be the most expensive thing this module does.
  const anchorFor = (pane, view, runningNow, now) => {
    const wanted = runningNow ? 'live' : 'after';
    const fresh = view.anchor && view.anchor.isConnected && view.anchorKind === wanted && now - view.anchorAt < ANCHOR_TTL;
    if (fresh) return view.anchor;

    let host_ = null, kind = '';
    if (runningNow) {
      host_ = pane.querySelector('.chat-working-indicator');
      if (host_) kind = 'live';
    }
    if (!host_) {
      const recaps = pane.querySelectorAll('.chat-turn-recap');
      if (recaps.length) { host_ = recaps[recaps.length - 1]; kind = 'recap'; }
    }
    if (!host_) {
      const rows = pane.querySelectorAll('.chat-activity-group__summary');
      if (rows.length) { host_ = rows[rows.length - 1]; kind = 'row'; }
    }
    // Last resort: a turn that produced only text has no recap and no tool row, but it always
    // has its own group. Without this the 落款 would have nowhere to land and be dropped.
    if (!host_) {
      const groups = pane.querySelectorAll('.chat-thread-inner > .chat-group');
      const last = groups[groups.length - 1];
      if (last) { host_ = last; kind = 'group'; }
    }
    view.anchor = host_;
    view.anchorKind = host_ ? wanted : '';
    view.anchorAt = now;
    view.anchorType = kind;
    return host_;
  };

  const summaryOf = (run) => (run.tools ? `${run.tools} 个步骤` : '');

  // The app marks an interrupted turn. But a pane keeps its whole history, so only a marker
  // that belongs to *this* run may count. A run that began after the pane last rendered must
  // not inherit an error from an older turn, which is why the run's own start time is the
  // boundary and not a positional guess.
  // The app marks an interrupted turn, and a pane keeps its whole history. Only a marker that
  // belongs to *this* run may count. Groups that already existed when the run started are not
  // candidates, whatever class they carry.
  const endedAsStopped = (pane, run, host_) => {
    const marked = pane.querySelectorAll('.chat-tasks-status, [data-run-stopped], .chat-group--error');
    if (!marked.length) return false;
    const owner = host_?.closest?.('.chat-thread-inner > .chat-group');
    for (const node of marked) {
      const turn = node.closest?.('.chat-thread-inner > .chat-group') || node;
      if (run.turns && run.turns.has(turn)) return true;
      // a turn that carries no relation to this run is history, not verdict
      if (turn === owner && host_ && run.anchorIsOurs) return true;
    }
    return false;
  };

  const paint = (view, run, step, now, fresh) => {
    const kind = run.on ? step.kind : (run.stopped ? 'stopped' : 'done');
    const live = run.on ? '1' : '0';
    const word = run.on ? (step.label || VERB[step.kind] || VERB.think) : (run.stopped ? '已中断' : '完成');
    const detail = run.on ? (step.label ? '' : step.text) : summaryOf(run);
    const elapsed = run.on ? fmtElapsed(now - run.since) : (run.took ? fmtElapsed(run.took) : '');
    const mono = !!(run.on && detail && step.mono);
    const sig = `${run.key || ''}|${run.since}|${kind}|${live}|${word}|${detail}|${elapsed}|${mono}`;
    if (sig === view.sig && !fresh) return;
    view.sig = sig;

    const el = view.el;
    if (el.dataset.kind !== kind) el.dataset.kind = kind;
    if (el.dataset.live !== live) el.dataset.live = live;

    if (view.verb.textContent !== word) {
      view.verb.textContent = word;
      view.verb.classList.remove('is-new');
      void view.verb.offsetWidth;
      view.verb.classList.add('is-new');
    }
    if (view.chip.textContent !== (detail || '')) view.chip.textContent = detail || '';
    if (view.chip.hidden === !!detail) view.chip.hidden = !detail;
    view.chip.toggleAttribute('data-mono', mono);
    if (view.time.textContent !== elapsed) view.time.textContent = elapsed;
  };

  const mount = (view, host_) => {
    if (view.el.parentElement !== host_) host_.append(view.el);
    const type = view.anchorType || '';
    if (view.el.dataset.anchor !== type) view.el.dataset.anchor = type;
  };

  const finish = (run, now) => {
    run.on = false;
    run.until = now + (run.stopped ? STOP_HOLD : DONE_HOLD);
    run.took = Math.max(0, now - run.since);
  };

  // One pass over every visible pane.
  const sync = () => {
    const now = Date.now();
    const second = Math.floor(now / 1000);
    const newSecond = second !== lastSecond;
    if (newSecond) lastSecond = second;
    const panes = shownPanes();
    const alive = new Set();
    const liveKeys = new Set();
    let active = false, retry = false;

    for (const pane of panes) {
      if (!pane.isConnected) continue;
      alive.add(pane);
      // Each pane owns its session. Falling back to the global selected session would make a
      // second pane borrow the first pane's run — two lines, one state, wrong on both sides.
      const key = paneSessionKey(pane);
      if (!key) { dropView(pane); continue; }

      let run = runs.get(key);
      // Our own line already inside the indicator is not a signal by itself; the native
      // indicator only appears when the app thinks this pane is working.
      const indicator = pane.querySelector('.chat-working-indicator');

      // Opened in the middle of a run: no lifecycle start will arrive. The native indicator
      // is the signal — but only once. Without the tombstone, the indicator still being in the
      // DOM after a run ends would recreate a fresh busy run on the very next pass and the
      // pane would never settle.
      if (!run && indicator) {
        const endedAt = tombstones.get(key) || 0;
        if (now - endedAt > RESUME_AFTER) { run = newRun(now); runs.set(key, run); }
      }
      if (!run) { dropView(pane); continue; }
      run.key = key;

      const view = viewFor(pane);
      if (view.key && view.key !== key) { pool.release(view.key); view.sig = ''; }
      view.key = key;

      if (run.on) {
        active = true;
        const step = pace(run, now);
        const host_ = anchorFor(pane, view, true, now);
        if (!host_) { retry = true; continue; }
        mount(view, host_);
        // Remember which turns this run actually owns. History that was already there can
        // never be mistaken for this run's verdict later.
        const turn = host_.closest?.('.chat-thread-inner > .chat-group');
        if (turn) {
          if (!run.turns) run.turns = new Set();
          run.turns.add(turn);
        }
        paint(view, run, step, now, newSecond);
        pool.use(key, view.glyph, stateFor(step.kind));
        liveKeys.add(key);
        // note() is already idempotent (it compares a signature), and gating it on the wall
        // clock meant a re-render in the same second could skip the focus mark entirely.
        focus.note(pane, run, host_);
        continue;
      }

      // The run has ended. The app removes the working indicator and re-renders the turn a
      // moment later; dropping the line on the first empty pass would throw the 落款 away.
      if (!run.until) finish(run, now);
      const host_ = anchorFor(pane, view, false, now);
      if (!host_) {
        if (now < run.until + GRACE) { retry = true; continue; }
        dropView(pane); runs.delete(key); continue;
      }
      if (now >= run.until) { dropView(pane); runs.delete(key); continue; }

      // After a re-render the history is the verdict. If the app now says the run was
      // interrupted, withdraw the 完成 that was already on screen — never let it sit there
      // saying “finished” while the transcript says “interrupted”.
      if (!run.stopped && endedAsStopped(pane, run, host_)) {
        run.stopped = true;
        run.until = Math.min(run.until, now + STOP_HOLD);
        view.sig = '';
      }

      mount(view, host_);
      // 落款 is painted once: repainting it every frame would restart the sheen and the chip
      // entrance animations on top of the particle signature.
      paint(view, run, {kind: 'done'}, now, newSecond);
      pool.use(key, view.glyph, run.stopped ? 'idle' : 'done');
      if (!run.stopped) focus.note(pane, run, host_);
      active = true;
    }

    for (const pane of [...views.keys()]) if (!alive.has(pane)) dropView(pane);
    // 收尾 is per pane: a finished side releases its mark while the other side keeps working.
    focus.set(liveKeys);
    return active || retry;
  };

  const needsFrames = () => {
    const now = Date.now();
    for (const run of runs.values()) {
      if (run.on) return true;
      if (run.until && now < run.until) return true;
    }
    return false;
  };

  const loop = () => {
    raf = 0;
    if (signal.aborted || document.hidden) { running = false; return; }
    const active = sync();
    if (!active) { running = false; if (needsFrames()) start(); return; }
    raf = requestAnimationFrame(loop);
  };

  const start = () => {
    if (running || raf || signal.aborted || document.hidden) return;
    if (!needsFrames()) return;
    running = true;
    raf = requestAnimationFrame(loop);
  };

  const schedule = () => {
    if (queued || signal.aborted) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (signal.aborted) return;
      sync();
      if (needsFrames()) start();
    });
  };

  // Only an event that proves activity may create a run. Creating one for any event with a
  // sessionKey left `on: true` ghosts behind every unrelated or terminal message; each ghost
  // kept the frame loop alive forever.
  const onAgent = (p) => {
    // last events, for diagnosing the line in a real run (window.__cleAgentLog)
    try { const log = (window.__cleAgentLog ||= []); log.push({stream: p?.stream, phase: p?.data?.phase, state: p?.state, name: p?.data?.name, key: p?.sessionKey}); if (log.length > 200) log.shift(); } catch {}
    const key = String(p?.sessionKey || '');
    if (!key) return;
    let run = runs.get(key);
    if (!run) {
      if (!isLiveEvent(p)) return;               // unknown / terminal event: nothing to show
      run = newRun(Number(p.ts) || Date.now());
      runs.set(key, run);
    }
    const before = run.on;
    if (!applyEvent(run, p)) {
      // a terminal event for a run we already forgot must not resurrect the busy state
      if (run.on && !before) runs.delete(key);
      return;
    }
    if (!run.on && !run.until) {
      finish(run, Date.now());
      tombstones.set(key, Date.now());
    }
    // a real start clears the tombstone: this is a new run, not a leftover indicator
    if (run.on) tombstones.delete(key);
    schedule();
    start();
  };

  const offAgent = host.onEvent('agent', onAgent);
  const offChat = host.onEvent('chat', onAgent);

  // Observe the panes only, and ignore our own writes: the observer can never feed itself.
  const isOurs = (node) => {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return !!(el && el.closest && el.closest(OURS));
  };
  let mo = null, observed = [];
  const attach = () => {
    const panes = shownPanes();
    const same = panes.length === observed.length && panes.every((p, i) => p === observed[i]);
    if (same) return false;
    mo?.disconnect();
    observed = panes;
    if (!mo) {
      mo = new MutationObserver((records) => {
        for (const record of records) {
          if (shouldRescan(record, isOurs)) { schedule(); start(); return; }
        }
      });
    }
    for (const pane of panes) mo.observe(pane, {childList: true, subtree: true});
    return true;
  };
  attach();

  // Pane set and session keys change without an event we can subscribe to. A light poll
  // rebinds; it does no DOM work when nothing changed.
  const discover = setInterval(() => {
    if (document.hidden || signal.aborted) return;
    if (attach()) schedule();
    else if (needsFrames()) start();
  }, 1200);

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf); raf = 0; running = false;
      pool.parkAll();
    } else { schedule(); start(); }
  };
  const onPageHide = () => {
    cancelAnimationFrame(raf); raf = 0; running = false;
    pool.parkAll();
  };
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('pagehide', onPageHide);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const onReduce = () => { if (reduce.matches) pool.parkAll(); else { schedule(); start(); } };
  reduce.addEventListener('change', onReduce);

  schedule();

  signal.addEventListener('abort', () => {
    offAgent?.(); offChat?.(); mo?.disconnect();
    clearInterval(discover);
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
    removeEventListener('pagehide', onPageHide);
    reduce.removeEventListener('change', onReduce);
    pool.disposeAll();
    focus.dispose();
    for (const view of views.values()) view.el.remove();
    views.clear();
    document.querySelectorAll(OURS).forEach((el) => el.remove());
  }, {once: true});
}
