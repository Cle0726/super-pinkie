// Focus while 碧琪 works.
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
//
//收尾 is per pane. In 双模式 one side finishing must release its own mark immediately while the
// other side is still working; waiting for "no run anywhere is live" left the finished pane
// carrying data-cle-focus-run forever, and a cached pane's run could pin the root attribute.
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

  const clearPane = (pane) => {
    pane.removeAttribute(RUN_ATTR);
    for (const el of pane.querySelectorAll(`[${TURN_ATTR}]`)) el.removeAttribute(TURN_ATTR);
    marked.delete(pane);
  };

  const turnOf = (pane, anchor) => {
    const own = anchor?.closest?.('.chat-thread-inner > .chat-group');
    if (own) return own;
    // no anchor turn (the indicator went away): focus belongs to the most recent turn that is
    // actually part of this run — never an older failed turn that happens to be last.
    const groups = [...pane.querySelectorAll('.chat-thread-inner > .chat-group')];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.classList.contains('chat-group--error')) continue;
      return g;
    }
    return groups[groups.length - 1] || null;
  };

  return {
    // Called at most once per second per pane while it runs. `anchor` is the element the status
    // line is mounted in, so the owning turn is found without another scan.
    note(pane, run, anchor) {
      if (signal.aborted || !pane?.isConnected) return;
      const turn = turnOf(pane, anchor);
      const rowKey = turn?.dataset?.chatRowKey || '';
      const signature = `${run.key || ''}|${rowKey}|${run.since}`;
      if (pane.getAttribute(RUN_ATTR) === signature) return;
      clearPane(pane);
      // The pane mark does not depend on finding a turn: if the DOM has not rendered one yet
      // the decoration should still retreat, and the turn is picked up on a later pass.
      pane.setAttribute(RUN_ATTR, signature);
      if (turn) turn.setAttribute(TURN_ATTR, '');
      marked.add(pane);
      lastSignature = signature;
    },
    clear(pane) {
      if (marked.has(pane) || pane?.hasAttribute(RUN_ATTR)) clearPane(pane);
    },
    // `liveKeys` holds the session keys that are working *right now*. Per-pane release happens
    // first, so a finished side never waits for a busy neighbour.
    set(liveKeys) {
      for (const pane of [...marked]) {
        const signature = pane.getAttribute(RUN_ATTR) || '';
        const key = signature.split('|')[0];
        if (!liveKeys.has(key)) clearPane(pane);
      }
      setRoot(marked.size > 0);
    },
    dispose() {
      setRoot(false);
      for (const pane of [...marked]) clearPane(pane);
      marked.clear();
      root.removeAttribute(ROOT_ATTR);
      lastSignature = '';
    },
    get signature() { return lastSignature; },
    get panes() { return marked.size; },
  };
}
