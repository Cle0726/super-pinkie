// Focus while Li An works.
//
// The original stage dimmed *everything else* — sidebar, rail, ambient canvas, and every
// earlier turn — for as long as the run lasted. That reads as "the page went dark" once a run
// takes a few minutes, and on a paper-white theme it makes the transcript hard to read.
//
// So this version separates two ideas:
//   · decoration retreat  — the ambient painting, the pet, the rail. These recede while a run
//     is live and come straight back; they carry no text you need to read.
//   · current-turn focus  — the turn being worked on is marked; only turns *before* it step
//     back, and only slightly (opacity, not blur), and hover restores them.
// Nothing is dimmed in a pane that is not running, and the turn being read is never dimmed.
const ROOT_ATTR = 'data-cle-live';
const TURN_ATTR = 'data-cle-focus';
const RUN_ATTR = 'data-cle-focus-run';

export function mountFocus(signal) {
  const marked = new Set();     // panes currently carrying a focus mark
  let rootLive = false;
  let lastSignature = '';

  const root = document.documentElement;

  const setRoot = (live) => {
    if (live === rootLive) return;
    rootLive = live;
    if (live) root.setAttribute(ROOT_ATTR, '');
    else root.removeAttribute(ROOT_ATTR);
  };

  // The turn that owns the run: the row group that actually contains the working indicator.
  // Falling back to the last group keeps a just-finished turn in focus for the 落款.
  const turnOf = (pane, anchor) => {
    const own = anchor?.closest?.('.chat-thread-inner > .chat-group');
    if (own) return own;
    const groups = pane.querySelectorAll('.chat-thread-inner > .chat-group');
    return groups[groups.length - 1] || null;
  };

  const clearPane = (pane) => {
    pane.removeAttribute(RUN_ATTR);
    for (const el of pane.querySelectorAll(`[${TURN_ATTR}]`)) el.removeAttribute(TURN_ATTR);
    marked.delete(pane);
  };

  return {
    // Called at most once per second per pane while it runs. `anchor` is the element the
    // status line is mounted in, so no extra scan is needed to find the turn.
    note(pane, run, anchor) {
      if (signal.aborted || !pane?.isConnected) return;
      const key = anchor?.closest?.('.chat-thread-inner > .chat-group')?.dataset?.chatRowKey || '';
      const signature = `${key}|${run.since}`;
      if (pane.getAttribute(RUN_ATTR) === signature) return;
      const turn = turnOf(pane, anchor);
      if (!turn) return;
      clearPane(pane);
      pane.setAttribute(RUN_ATTR, signature);
      turn.setAttribute(TURN_ATTR, '');
      marked.add(pane);
      lastSignature = signature;
    },
    clear(pane) {
      if (marked.has(pane) || pane?.hasAttribute(RUN_ATTR)) clearPane(pane);
    },
    // `runs` is the live map; the root attribute is set only while some pane is working.
    set(runs) {
      let live = false;
      for (const run of runs.values()) if (run.on) { live = true; break; }
      setRoot(live);
      if (!live) for (const pane of [...marked]) clearPane(pane);
    },
    dispose() {
      setRoot(false);
      for (const pane of [...marked]) clearPane(pane);
      marked.clear();
      root.removeAttribute(ROOT_ATTR);
      lastSignature = '';
    },
    get signature() { return lastSignature; },
  };
}
