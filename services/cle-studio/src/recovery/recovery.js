// Recovery — what the 2026.7 resume/phrases pair did for the old skin, rebuilt on the
// 2026.10 native chat pane. Two jobs only, both presentation/queue repair:
//
//  1. Internal control turns must never read as chat. The gateway watchdog and the
//     tier controller resume a turn by sending a user-role message that opens with a
//     fixed prefix ([pinkie-watchdog] / [pinkie-tier-control] / [pinkie-tier…]). The
//     old runtime hid them in its patched timeline; 2026.10 ships that filter only in
//     the `pinkie` build, so a stock pane renders the whole instruction. We mark the
//     native row and let CSS fold it away — never the message data, never a global
//     string replace, and never a user message that merely quotes the words.
//
//  2. A queued message that lost its native terminal event stays stuck. The native
//     queue owns send/steer/retry; what it does not do is notice that a pane went
//     idle while one of its own cards still says "waiting for reconnect". We only
//     ask that pane's own native retry to run, and only when the backend says that
//     pane's session has no active run. No synthetic stop, no re-send of a message
//     that already appears in history, no cross-pane borrowing.
//
// Everything is scoped to the pane that owns the session key. The pane's state is the
// authority; we never write chat DOM through Lit-owned nodes.
import {paneSessionKey, visiblePanes} from '../rooms/split.js';
import {localizeQueueTree} from './queue-copy.js';
const WATCHDOG_PREFIX = '[pinkie-watchdog]';
const TIER_PREFIX = '[pinkie-tier-control]';
// `[pinkie-tier]`, `[pinkie-tier-report]`, … are the same control family.
const TIER_ANY = /^\[pinkie-tier[\w-]*\]/i;
const RESTART_NOTICE = '[System] Your previous turn was interrupted by a gateway restart';
const SESSION_FENCE = /^(?:⚠️\s*)?Agent failed before reply:\s*(?:EmbeddedAttemptSessionTakeoverError:\s*)?session file changed while embedded prompt lock was released:/i;
// Runs that are internal continuations, not a turn the user started.
const CONTROL_SEGMENT = /\[pinkie-(?:watchdog|tier[\w-]*)\]/i;

// A user bubble prints the whole message through .chat-text; the row carries the raw
// text in data-message-text. Read the attribute: it is the untouched source, so a
// translated or truncated render can never make us mis-classify.
const rowText = (bubble) => {
  const raw = bubble?.getAttribute?.('data-message-text');
  return typeof raw === 'string' ? raw : '';
};

export function isInternalTurnText(raw) {
  const source = String(raw || '');
  // A lone U+2063 is the older watchdog sentinel; it carries no visible text, so it
  // has to be checked before the empty-after-strip guard below.
  if (source.replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '').trim() === '\u2063') return true;
  const text = source.replace(/[\u200B-\u200D\u2060\u2063\uFEFF]/gu, '').trim();
  if (!text) return false;
  if (text.startsWith(WATCHDOG_PREFIX)) return true;
  if (text.startsWith(TIER_PREFIX)) return true;
  if (TIER_ANY.test(text)) return true;
  if (text.startsWith(RESTART_NOTICE)) return true;
  return SESSION_FENCE.test(text);
}

// A code block or a quote is the user showing the text, not the gateway sending it.
// Check the rendered markdown: the native bubble keeps code inside .chat-text, and a
// user quoting the instruction will have a <pre> or <code> in the same bubble.
const isQuoted = (bubble) => Boolean(bubble.querySelector?.('pre, code, blockquote'));

const markInternal = (bubble, internal) => {
  if (internal && !isQuoted(bubble)) {
    if (bubble.dataset.cleInternalTurn !== '1') {
      bubble.dataset.cleInternalTurn = '1';
      bubble.setAttribute('aria-hidden', 'true');
    }
    return true;
  }
  if (bubble.dataset.cleInternalTurn) {
    delete bubble.dataset.cleInternalTurn;
    bubble.removeAttribute('aria-hidden');
  }
  return false;
};

// Group-level fold: a turn made only of control text must not leave the avatar row
// and the footer behind. Count only the bubbles this pane actually rendered.
const syncGroup = (group) => {
  if (!group || group.classList.contains('chat-group--typing')) return;
  const bubbles = [...group.querySelectorAll('.chat-bubble[data-message-text]')];
  if (!bubbles.length) return;
  const hidden = bubbles.filter((bubble) => bubble.dataset.cleInternalTurn === '1').length;
  const all = hidden === bubbles.length;
  if (all) {
    if (group.dataset.cleInternalOnly !== '1') {
      group.dataset.cleInternalOnly = '1';
      group.setAttribute('aria-hidden', 'true');
    }
  } else if (group.dataset.cleInternalOnly) {
    delete group.dataset.cleInternalOnly;
    group.removeAttribute('aria-hidden');
  }
};

export function projectPane(pane) {
  if (!pane?.querySelectorAll) return 0;
  let hidden = 0;
  for (const group of pane.querySelectorAll('.chat-group')) {
    const bubbles = group.querySelectorAll('.chat-bubble[data-message-text]');
    if (!bubbles.length) continue;
    for (const bubble of bubbles) if (markInternal(bubble, isInternalTurnText(rowText(bubble)))) hidden += 1;
    syncGroup(group);
  }
  // Queue copy is chrome, not message content: it may be rewritten in place.
  for (const queue of pane.querySelectorAll('.chat-queue')) localizeQueueTree(queue);
  return hidden;
}

// The native run status is the only honest "is this pane working" signal. The stop
// button is a fallback for builds whose state we cannot read, but it must be visible
// and enabled — a disabled stop button means the run already ended.
const paneBusy = (pane) => {
  const state = pane?.state;
  if (!state) return true;
  // Offline: the native queue will keep the card in waiting-reconnect by design.
  if (state.connected === false) return true;
  // History still loading: the transcript is not authoritative yet, so a card
  // could look undelivered only because its message has not been painted.
  if (state.chatLoading) return true;
  if (state.chatRunId || state.chatSending || state.chatStream) return true;
  if (state.chatRunStartup) return true;
  const phase = state.chatRunStatus?.phase;
  if (phase && !['done', 'interrupted', 'failed'].includes(phase)) return true;
  if (Array.isArray(state.chatQueue) && state.chatQueue.some((item) => item?.pendingRunId)) return true;
  const stop = pane.querySelector?.('.chat-send-btn--stop');
  return Boolean(stop && !stop.disabled && stop.offsetParent !== null);
};

const queueOf = (pane) => (Array.isArray(pane?.state?.chatQueue) ? pane.state.chatQueue : []);

// Only one state is safe to retry without asking the user: `waiting-reconnect` means
// the message never left this browser because the socket was down — exactly the case
// the old resume layer fixed. `unconfirmed` and `held` mean the gateway may already
// have it; 2026.10 deliberately asks the reader to check before retrying, and an
// automatic resend there would duplicate a delivered message. `failed` carries a real
// error the reader must see. So: retry the disconnect, leave the rest visible.
const STUCK_STATES = new Set(['waiting-reconnect']);
export function isStuckItem(item) {
  if (!item || item.pendingRunId) return false;
  if (item.localCommandName) return false;
  return STUCK_STATES.has(item.sendState);
}

// Match a queued card against the transcript for that same pane. A message the model
// already answered must never be sent a second time; the identity is the run id when
// the pane recorded one, else the text plus timestamp inside a small window.
const messageText = (message) => {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part && ['text', 'input_text'].includes(part.type) && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
};
const normalize = (value) => String(value || '').replace(/\s+/gu, ' ').trim();

export function appearsInTranscript(item, messages) {
  if (!Array.isArray(messages) || !messages.length) return false;
  if (item?.sendRunId && messages.some((m) => m?.runId === item.sendRunId)) return true;
  const text = normalize(item?.text);
  if (!text) return false;
  const createdAt = Number(item.createdAt) || 0;
  return messages.some((message) => {
    if (String(message?.role || '').toLowerCase() !== 'user') return false;
    if (normalize(messageText(message)) !== text) return false;
    // Without a timestamp we cannot tell a replay from a coincidence; require one.
    const at = Number(message.timestamp ?? message.ts ?? 0) || 0;
    if (!createdAt || !at) return false;
    return Math.abs(at - createdAt) <= 10 * 60_000;
  });
}

// The pane's own native retry. 2026.10 puts it on the custom element; older builds
// proxy it onto the controller/state that the element keeps. Never assume one shape.
export function nativeAction(pane, name, id) {
  for (const owner of [pane, pane?.controller, pane?.chatController, pane?.state]) {
    const fn = owner?.[name];
    if (typeof fn === 'function') return () => fn.call(owner, id);
  }
  return null;
}
export const nativeRetry = (pane, id) => nativeAction(pane, 'retryQueuedChatMessage', id);

const repaint = (pane) => {
  pane?.state?.requestUpdate?.();
  pane?.requestUpdate?.();
};

// Ask the gateway whether this exact session is running. Only an explicit "no" lets
// us touch the queue: an error, a timeout, a missing row or a row without a status
// field all mean "unknown", and resuming a healthy run is worse than a stuck card.
export async function sessionIdle(host, sessionKey) {
  if (!sessionKey) return false;
  let res;
  try {
    res = await host.request('sessions.list', {limit: 1000, includeDerivedTitles: false});
  } catch {
    return false;
  }
  const row = (res?.sessions || []).find((entry) => entry?.key === sessionKey);
  if (!row) return false;
  if (row.hasActiveRun === true) return false;
  const status = typeof row.status === 'string' ? row.status.toLowerCase() : '';
  // SessionRow.status is optional and only ever carries one of these seven values;
  // the first two mean a run is live, the rest are terminal. An absent field tells us
  // nothing, so it is not permission to send.
  return ['done', 'failed', 'interrupted', 'killed', 'timeout'].includes(status);
}

// One recovery pass for one pane. Returns the ids that were retried.
export async function recoverPane(pane, host, options = {}) {
  const state = pane?.state;
  const sessionKey = paneSessionKey(pane) || options.sessionKey || '';
  if (!state || !sessionKey) return [];
  if (state.sessionKey && state.sessionKey !== sessionKey) return [];
  if (paneBusy(pane)) return [];
  const stuck = queueOf(pane).filter(isStuckItem);
  if (!stuck.length) return [];
  if (!(await sessionIdle(host, sessionKey))) return [];
  // Re-read after the await: the pane may have started a run, changed session, or
  // drained the queue while the roster was in flight.
  if (pane.state !== state || paneBusy(pane)) return [];
  if ((paneSessionKey(pane) || options.sessionKey || '') !== sessionKey) return [];

  const messages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  const retried = [];
  for (const item of queueOf(pane).filter(isStuckItem)) {
    if (item.sessionKey && item.sessionKey !== sessionKey) continue;
    // Already delivered: drop the card through the native remover, never resend.
    if (appearsInTranscript(item, messages)) {
      const remove = nativeAction(pane, 'removeQueuedMessage', item.id);
      if (remove) { try { await remove(); } catch {} }
      continue;
    }
    const retry = nativeRetry(pane, item.id);
    if (!retry) break;
    // Retry is serial on purpose: the native path starts a run, and a second item
    // must wait for that run's own queue drain.
    try { await retry(); retried.push(item.id); } catch {}
    break;
  }
  if (retried.length) repaint(pane);
  return retried;
}

// Targeted projection: only the group a changed node actually belongs to. A long
// transcript must not be re-walked for every streamed token, which is exactly the
// cost the 2026.7 module's own header warns about.
export function projectNode(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element?.closest) return 0;
  const group = element.closest('.chat-group');
  let hidden = 0;
  if (group) {
    for (const bubble of group.querySelectorAll('.chat-bubble[data-message-text]')) {
      if (markInternal(bubble, isInternalTurnText(rowText(bubble)))) hidden += 1;
    }
    syncGroup(group);
  }
  const queue = element.closest('.chat-queue');
  if (queue) localizeQueueTree(queue);
  return hidden;
}

// Mount. Two independent duties share one observer so a long conversation pays for
// one traversal per changed row, not one per streamed token.
//
// Recovery state must never look like a second, unmerged product. These are the exact
// chrome strings the native zh-CN bundle still prints with the upstream name inside the
// chat surface, which the brand guard deliberately skips (it must not rewrite a reply
// the model wrote). They are chrome, so renaming them is safe — and only these.
const CHROME_BRAND = new Map([
  ['OpenClaw 正在思考', '李岸正在思考'],
  ['OpenClaw 无法回复。 请重试。', '李岸这次没能回复。再试一次。'],
  ['给 OpenClaw 发消息…', '给李岸发消息…'],
  ['给 OpenClaw 发消息...', '给李岸发消息…'],
]);

// Only exact known chrome strings, and only on an attribute: a reply that mentions the
// upstream project keeps its words.
export function localizeRecoveryChrome(root = document) {
  let changed = 0;
  for (const control of root.querySelectorAll?.('textarea[placeholder], input[placeholder]') || []) {
    const value = (control.getAttribute('placeholder') || '').trim();
    const next = CHROME_BRAND.get(value);
    if (next) { control.setAttribute('placeholder', next); changed += 1; }
  }
  return changed;
}

// Presentation for the seams above is injected from this module rather than imported
// by main.js, so mounting recovery cannot depend on stylesheet order.
const STYLE_ID = 'cle-recovery-style';
const STYLE = `
/* An internal continuation turn is recorded for crash recovery but is not chat.
   Fold it out of the flow without removing it: the transcript keeps its data, the
   reader never sees gateway RPC instructions. */
.chat-bubble[data-cle-internal-turn="1"] { display: none !important; }

/* When the whole turn was internal, its avatar row and footer go with it,
   otherwise a blank header is left behind. */
.chat-group[data-cle-internal-only="1"] { display: none !important; }
`;

const ensureStyle = () => {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
};

// Inject at module evaluation so a caller that projects before mounting (a test, or a
// pane that is already on screen when this module loads) still gets the rule.
ensureStyle();

export function mountRecovery(host, signal) {
  ensureStyle();
  const timers = new WeakMap();
  const lastAttempt = new WeakMap();
  const pending = new WeakSet();
  let frame = 0;
  // A retry that the gateway rejects must not turn into a request per frame. The
  // card keeps its own error text, so waiting is honest; six seconds is short
  // enough that a real reconnect is still picked up promptly.
  const RETRY_COOLDOWN_MS = 6000;

  const schedule = (pane, delay) => {
    if (!pane?.isConnected || timers.has(pane)) return;
    const timer = setTimeout(() => { timers.delete(pane); void pass(pane); }, delay);
    timers.set(pane, timer);
  };

  const pass = async (pane) => {
    if (pending.has(pane)) return;
    const attempted = lastAttempt.get(pane) || 0;
    if (Date.now() - attempted < RETRY_COOLDOWN_MS) return;
    pending.add(pane);
    try {
      projectPane(pane);
      const retried = await recoverPane(pane, host);
      // Only a real attempt starts the cooldown; a pane that was simply busy is
      // allowed to be looked at again on the next terminal event.
      if (retried.length) lastAttempt.set(pane, Date.now());
    } catch (error) {
      // A recovery attempt is best-effort by definition; never let it surface as a
      // chat error or stop the pane from rendering.
      console.warn('[cle] recovery pass skipped', error?.message || error);
    } finally {
      pending.delete(pane);
    }
  };

  // Which panes need work? `projectPane` is cheap and only runs on a mutation batch;
  // the gateway round-trip happens later, in `pass`, and only for a pane whose own
  // card is stuck. This keeps a healthy run in the other half completely untouched.
  const sweep = () => {
    for (const pane of visiblePanes()) {
      projectPane(pane);
      if (!queueOf(pane).some(isStuckItem)) continue;
      schedule(pane, 900);
    }
  };

  const onEvent = host.onEvent?.('agent', (payload) => {
    // A run ending is exactly when the native one-shot queue drain can be missed.
    const phase = payload?.data?.phase;
    if (phase !== 'end' && phase !== 'error' && phase !== 'aborted') return;
    const sessionKey = payload?.sessionKey;
    if (!sessionKey) return;
    for (const pane of visiblePanes()) {
      if (paneSessionKey(pane) !== sessionKey) continue;
      // Let native terminal handling run first; only then look for leftovers.
      setTimeout(() => { if (pane.isConnected) schedule(pane, 0); }, 700);
    }
  });

  // The pane re-renders constantly during streaming. Project only the subtrees that
  // actually changed; this is the difference between O(changed) and O(transcript).
  const observer = new MutationObserver((records) => {
    const seen = new Set();
    for (const record of records) {
      const target = record.target;
      if (record.type === 'characterData') {
        const group = target?.parentElement?.closest?.('.chat-group');
        if (group && !seen.has(group)) { seen.add(group); projectNode(group); }
        continue;
      }
      for (const added of record.addedNodes) {
        const element = added.nodeType === 1 ? added : added.parentElement;
        const group = element?.closest?.('.chat-group');
        if (group && !seen.has(group)) { seen.add(group); projectNode(group); }
        const queue = element?.closest?.('.chat-queue');
        if (queue && !seen.has(queue)) { seen.add(queue); localizeQueueTree(queue); }
      }
    }
    // A pane that just appeared (room switch, split) has never been projected.
    for (const pane of visiblePanes()) {
      if (pane.dataset.cleRecoveryProjected === '1') continue;
      pane.dataset.cleRecoveryProjected = '1';
      projectPane(pane);
    }
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; sweep(); });
  });
  observer.observe(document.body, {childList: true, subtree: true, characterData: true});

  // Reconnect: the native socket lifecycle is the only moment a waiting-reconnect
  // card becomes sendable again. `connection` is the host's snapshot signal.
  const offSubscribe = host.subscribe?.(() => {
    if (!host.connection?.connected) return;
    for (const pane of visiblePanes()) if (queueOf(pane).some(isStuckItem)) schedule(pane, 600);
  });

  const tick = setInterval(sweep, 4000);
  const start = () => {
    for (const pane of visiblePanes()) { projectPane(pane); schedule(pane, 1200); }
    // The pane mounts its composer after this module runs, so retry the two chrome
    // strings once the DOM settles, and again whenever a pane appears.
    localizeRecoveryChrome(document);
    setTimeout(() => localizeRecoveryChrome(document), 900);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();

  signal?.addEventListener('abort', () => {
    observer.disconnect();
    clearInterval(tick);
    offSubscribe?.();
    for (const pane of visiblePanes()) timers.has(pane) && (clearTimeout(timers.get(pane)), timers.delete(pane));
    for (const el of document.querySelectorAll('[data-cle-internal-turn], [data-cle-internal-only]')) {
      delete el.dataset.cleInternalTurn;
      delete el.dataset.cleInternalOnly;
      el.removeAttribute('aria-hidden');
    }
    document.getElementById(STYLE_ID)?.remove();
  }, {once: true});
}

export const __test = {isInternalTurnText, isStuckItem, appearsInTranscript, projectPane, CONTROL_SEGMENT};
