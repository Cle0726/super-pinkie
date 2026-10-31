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
// Runs that are internal continuations, not a turn the user started.
const CONTROL_SEGMENT = /\[pinkie-(?:watchdog|tier[\w-]*)\]/i;

// The prefixes above are short, so on their own they are not evidence: anyone can
// type “[pinkie-watchdog] 这个是什么意思”. A real control turn is a machine-written
// instruction, and every builder in services/mode-architecture ends it with one of
// these sentences. Recognising the whole shape — leading prefix AND the trailing
// instruction — is what separates the gateway's own message from a reader quoting it.
const WATCHDOG_TAIL = /这是当前用户轮次的内部续跑命令[，,]?\s*先生看不到这条消息[；;]\s*不要回复\s*NO_REPLY[，,]?\s*也不要在回复里提到这条命令。?\s*$/u;
const TIER_TAIL = /这是当前用户轮次的内部续跑命令[。.]?\s*$/u;
const TIER_TAIL_YIELD = /这是当前用户轮次的内部续跑命令[。.]?\s*立即用\s*sessions_spawn\s*补齐缺失角色[\s\S]*绝对不得输出\s*NO_REPLY\s*规避缺口[。.]?\s*$/u;
// The gateway's own control turns: leading prefix plus the instruction tail every
// builder appends. A short line that merely starts with the prefix is a person talking
// about the mechanism, and it stays on screen.
//
// Order matters: the yield variant puts more text after the “内部续跑命令” sentence, so
// the simple tail (which is anchored at the end) is checked last.
//
// The length gate is only a cheap pre-filter, not the evidence: a real tier message can
// sit under 60 characters once its scaffold is short. The anchored tails decide.
const CONTROL_MIN_CHARS = 40;

// The gateway's restart notice is a real instruction to the model, and the reader does
// not need to act on it — but the *failure* it describes is real. Only the exact
// upstream sentence is treated as an internal turn; anything a person or the model
// writes about it stays.
const RESTART_EXACT = /^\[System\] Your previous turn was interrupted by a gateway restart while OpenClaw was waiting on tool\/model work\. Continue from the existing transcript and finish the interrupted response\.?\s*$/u;

// A user bubble prints the whole message through .chat-text; the row carries the raw
// text in data-message-text. Read the attribute: it is the untouched source, so a
// translated or truncated render can never make us mis-classify.
const rowText = (bubble) => {
  const raw = bubble?.getAttribute?.('data-message-text');
  return typeof raw === 'string' ? raw : '';
};

// Is the whole message wrapped as a quote? Decide from the *source*, not from whether
// the bubble happens to contain a <pre>: a genuine control message embeds the previous
// draft, and that draft can hold a code block. Judging by "any code present" hid no
// real command and leaked a real one (review 1804).
//
// An outer quote shows up as a leading marker in the stored markdown:
//   > …            blockquote
//   ```lang …      fenced block
//   “…” / "…" / 「…」  quoted text
// A real control message always starts with its own [pinkie-…] prefix, so any of these
// markers in first position already means the reader is showing the text.
const QUOTE_OPEN = /^(?:>|```|~~~|["“「『])/u;
export const isExternallyQuoted = (raw) => QUOTE_OPEN.test(String(raw || '').trimStart());

export function isInternalTurnText(raw) {
  const source = String(raw || '');
  // An outer quote or fence means the reader is showing this text, not the gateway
  // sending it. Checked before anything else: a real control message always starts with
  // its own prefix, so a leading quote marker can only be the reader's wrapper.
  if (isExternallyQuoted(source)) return false;
  // A lone U+2063 is the older watchdog sentinel; it carries no visible text, so it
  // has to be checked before the empty-after-strip guard below.
  if (source.replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '').trim() === '\u2063') return true;
  const text = source.replace(/[\u200B-\u200D\u2060\u2063\uFEFF]/gu, '').trim();
  if (!text) return false;

  // Only the exact upstream restart sentence. Its subject is a real interruption, so a
  // reader-written or model-written sentence about it must stay visible.
  if (RESTART_EXACT.test(text)) return true;

  // The gateway's own control turns: leading prefix plus the instruction tail that
  // every builder appends. A short line that merely starts with the prefix is a person
  // talking about the mechanism, and it stays on screen.
  if (text.length < CONTROL_MIN_CHARS) return false;
  if (text.startsWith(WATCHDOG_PREFIX)) return WATCHDOG_TAIL.test(text);
  if (text.startsWith(TIER_PREFIX) || TIER_ANY.test(text)) {
    return TIER_TAIL_YIELD.test(text) || TIER_TAIL.test(text);
  }
  return false;
}

const markInternal = (bubble, internal) => {
  // `internal` already reflects the full control shape *and* the absence of an outer
  // quote. A code block inside the message is the embedded draft, not evidence that the
  // reader wrote it, so it must not veto the fold.
  if (internal) {
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
//
// The guard matters: a real failure bubble is never marked internal, so a group that
// holds one keeps itself visible even when every other bubble in it was folded. That
// is the difference between "this turn was machine-written" and "hide this error".
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
    .filter((part) => part && ['text', 'input_text', 'output_text'].includes(part.type) && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
};
const normalize = (value) => String(value || '').trim();

const timestampMs = (value) => {
  if (typeof value === 'string' && value.trim() && !Number.isFinite(Number(value))) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !numeric) return 0;
  return Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
};
const messageAt = (message) => timestampMs(message?.timestamp ?? message?.ts ?? message?.createdAt);
const receiptKey = (message) => String(message?.idempotencyKey ?? message?.__openclaw?.idempotencyKey
  ?? message?.metadata?.idempotencyKey ?? message?.meta?.idempotencyKey ?? '');
const attachmentCount = (item) => {
  const arrays = [item?.attachments, item?.media, item?.MediaPaths].filter(Array.isArray);
  const direct = arrays.reduce((max, values) => Math.max(max, values.filter(Boolean).length), 0);
  if (direct) return direct;
  if (typeof item?.MediaPath === 'string' && item.MediaPath.trim()) return 1;
  return Array.isArray(item?.content) ? item.content.filter((part) => part
    && !['text', 'input_text', 'output_text', 'thinking', 'reasoning'].includes(part.type)).length : 0;
};
const matchesDelivery = (item, message) => {
  if (String(message?.role || '').toLowerCase() !== 'user') return false;
  const run = String(item?.sendRunId || '').trim();
  if (run) return message?.runId === run || message?.__openclaw?.runId === run
    || receiptKey(message) === `${run}:user`;
  const createdAt = timestampMs(item?.createdAt);
  if (!createdAt || messageAt(message) < createdAt) return false;
  const text = normalize(item?.text);
  const attachments = attachmentCount(item);
  if (text && normalize(messageText(message)) !== text) return false;
  if (attachments && attachmentCount(message) < attachments) return false;
  return Boolean(text || attachments);
};
export function appearsInTranscript(item, messages) {
  return Array.isArray(messages) && messages.some((message) => matchesDelivery(item, message));
}

// A proof can consume one card over its entire lifetime, including repeated polls
// and a replacement pane that keeps the same controller. The state object fences
// unrelated controllers that happen to use the same session key.
const deliveryLedgers = new WeakMap();
const deliveryPrunes = new WeakMap();
const proofIdentity = (message) => {
  const id = message?.__openclaw?.id ?? message?.messageId ?? message?.id;
  if (id) return `id:${id}`;
  const receipt = receiptKey(message);
  if (receipt) return `receipt:${receipt}`;
  if (message?.runId) return `run:${message.runId}:user`;
  try { return `body:${messageAt(message)}:${JSON.stringify(message?.content ?? message?.text)}:${attachmentCount(message)}`; }
  catch { return ''; }
};
const ledgerFor = (state, sessionKey) => {
  const sessionId = state.currentSessionId || '';
  let ledger = deliveryLedgers.get(state);
  if (!ledger || ledger.sessionKey !== sessionKey || ledger.sessionId !== sessionId) {
    ledger = {sessionKey, sessionId, consumed: new Set()};
    deliveryLedgers.set(state, ledger);
  }
  return ledger;
};
const deliveryPairs = (state, sessionKey) => {
  const consumed = ledgerFor(state, sessionKey).consumed;
  const messages = (Array.isArray(state.chatMessages) ? state.chatMessages : [])
    .filter((message) => String(message?.role || '').toLowerCase() === 'user'
      && !consumed.has(proofIdentity(message)))
    .sort((a, b) => messageAt(a) - messageAt(b));
  const items = (Array.isArray(state.chatQueue) ? state.chatQueue : [])
    .filter((item) => item?.id && !item.localCommandName && (!item.sessionKey || item.sessionKey === sessionKey))
    .map((item, index) => ({item, index})).sort((a, b) =>
      timestampMs(a.item.createdAt) - timestampMs(b.item.createdAt) || a.index - b.index);
  const used = new Set();
  const pairs = new Map();
  const pair = (item) => {
    const at = messages.findIndex((message, index) => !used.has(index) && matchesDelivery(item, message));
    if (at < 0) return;
    used.add(at);
    pairs.set(item.id, proofIdentity(messages[at]));
  };
  // Reserve exact receipts before payload fallbacks can consume them.
  for (const {item} of items) if (item.sendRunId) pair(item);
  for (const {item} of items) if (!item.sendRunId) pair(item);
  return pairs;
};
export async function pruneConfirmedQueue(pane, options = {}) {
  const state = pane?.state;
  const sessionKey = paneSessionKey(pane) || options.sessionKey || '';
  const sessionId = state?.currentSessionId;
  if (!state || !sessionKey) return [];
  const current = () => options.isActive?.() !== false && pane.state === state
    && state.currentSessionId === sessionId
    && (paneSessionKey(pane) || options.sessionKey || '') === sessionKey
    && (!state.sessionKey || state.sessionKey === sessionKey);
  if (!current()) return [];
  const prior = deliveryPrunes.get(state);
  if (prior?.sessionKey === sessionKey) return prior.promise;
  const prune = {sessionKey, promise: null};
  deliveryPrunes.set(state, prune);
  prune.promise = (async () => {
    const removed = [];
    try {
      const ledger = ledgerFor(state, sessionKey);
      for (const [id, proof] of deliveryPairs(state, sessionKey)) {
        if (!current()) break;
        if (!queueOf(pane).some((item) => item?.id === id)) continue;
        const remove = nativeAction(pane, 'removeQueuedMessage', id);
        if (!remove) continue;
        try { await remove(); } catch { continue; }
        if (!current()) break;
        // Native removal owns persistence. A no-op is never called delivery.
        if (queueOf(pane).some((item) => item?.id === id)) continue;
        removed.push(id);
        if (proof) ledger.consumed.add(proof);
        while (ledger.consumed.size > 1024) ledger.consumed.delete(ledger.consumed.values().next().value);
      }
      if (removed.length && current()) repaint(pane);
      return removed;
    } finally {
      if (deliveryPrunes.get(state) === prune) deliveryPrunes.delete(state);
    }
  })();
  return prune.promise;
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

// One recovery pass for one pane. Returns what actually happened, so the caller can
// back off on failure as well as on success. A pass that never reached the native
// retry (busy pane, unknown backend state, nothing stuck) reports `attempted: false`,
// which must NOT start a cooldown — otherwise a transient busy moment would freeze
// recovery for seconds after the pane went idle again.
export async function recoverPaneDetailed(pane, host, options = {}) {
  const state = pane?.state;
  const sessionKey = paneSessionKey(pane) || options.sessionKey || '';
  const result = {retried: [], removed: [], attempted: false};
  const active = () => options.isActive?.() !== false;
  const current = () => active() && pane.state === state
    && (paneSessionKey(pane) || options.sessionKey || '') === sessionKey
    && (!state?.sessionKey || state.sessionKey === sessionKey);
  if (!state || !sessionKey || !current()) return result;
  // Confirmation/removal is safe during a live run and never sends anything.
  result.removed.push(...await pruneConfirmedQueue(pane, {...options, sessionKey}));
  if (!current() || paneBusy(pane) || options.allowRetry === false) return result;
  if (!queueOf(pane).some(isStuckItem)) return result;
  if (!(await sessionIdle(host, sessionKey)) || !current() || paneBusy(pane)) return result;
  // A delivery may have arrived while sessions.list was in flight.
  result.removed.push(...await pruneConfirmedQueue(pane, {...options, sessionKey}));
  if (!current() || paneBusy(pane)) return result;
  const proven = deliveryPairs(state, sessionKey);
  for (const item of queueOf(pane).filter(isStuckItem)) {
    if (!current() || paneBusy(pane)) break;
    if (item.sessionKey && item.sessionKey !== sessionKey) continue;
    // A confirmed card whose native remover failed stays visible for repair;
    // sending it again would manufacture a duplicate.
    if (proven.has(item.id)) continue;
    const retry = nativeRetry(pane, item.id);
    if (!retry) break;
    result.attempted = true;
    try { await retry(); result.retried.push(item.id); } catch {}
    break;
  }
  if (result.retried.length && current()) repaint(pane);
  return result;
}

// Kept as the simple shape the tests and the first report used.
export async function recoverPane(pane, host, options = {}) {
  const {retried} = await recoverPaneDetailed(pane, host, options);
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
  // A signal that is already aborted means this activation was retired before it
  // started — a race with a hot reload, or a caller that reuses a dead controller.
  // Bail out before allocating anything: registering 'abort' on an already-aborted
  // signal never fires, so the observer, subscriptions and interval created below
  // would live forever. The fold stylesheet stays (ensureStyle ran), but this
  // activation owns no handles and touches no rows.
  if (signal?.aborted) return () => {};
  // One activation owns one set of handles. After abort nothing in this closure may
  // schedule work, write the DOM or ask the gateway to send: a retired activation that
  // still polls is how a hot reload produced duplicate retries.
  let aborted = false;
  const timers = new WeakMap();      // pane -> pending schedule() id
  const timeouts = new Set();        // every one-shot timer, so abort can clear all
  const lastAttempt = new WeakMap();
  const pending = new WeakSet();
  let frame = 0;
  let observer = null;
  let tick = 0;
  let offEvent = null;
  let offSubscribe = null;
  const afterCleanup = [];
  // A retry that the gateway rejects must not turn into a request per frame. The
  // card keeps its own error text, so waiting is honest; six seconds is short
  // enough that a real reconnect is still picked up promptly.
  const RETRY_COOLDOWN_MS = 6000;

  // Every delayed callback goes through here so `aborted` is checked both when the
  // timer is created and when it fires. A timer already in the queue is not a licence
  // to run after the activation retired.
  const after = (fn, delay) => {
    if (aborted) return 0;
    const id = setTimeout(() => {
      timeouts.delete(id);
      if (aborted) return;
      fn();
    }, delay);
    timeouts.add(id);
    return id;
  };

  const schedule = (pane, delay) => {
    if (aborted || !pane?.isConnected || timers.has(pane)) return;
    const id = after(() => { timers.delete(pane); void pass(pane); }, delay);
    if (id) timers.set(pane, id);
  };

  const pass = async (pane) => {
    if (aborted || pending.has(pane)) return;
    const allowRetry = shouldAttempt(lastAttempt.get(pane), Date.now(), RETRY_COOLDOWN_MS);
    pending.add(pane);
    try {
      const result = await recoverPaneDetailed(pane, host, {isActive: () => !aborted, allowRetry});
      // The await can outlive the activation. Re-check before touching anything: a
      // retired activation must not repaint or re-arm a cooldown on a pane it no
      // longer owns.
      if (aborted) return;
      // Back off on every real attempt, not just on a success. A native retry that
      // throws or rejects has already started whatever it was going to do; letting the
      // next mutation or reconnect event try again immediately is how a flapping
      // socket turns one stuck card into a request storm.
      if (result.attempted) lastAttempt.set(pane, Date.now());
    } catch (error) {
      // A recovery attempt is best-effort by definition; never let it surface as a
      // chat error or stop the pane from rendering.
      if (!aborted) console.warn('[cle] recovery pass skipped', error?.message || error);
    } finally {
      pending.delete(pane);
    }
  };

  // Projection belongs to initial/new-pane/dirty-subtree handling below. A
  // mutation sweep only schedules queue work; streamed tokens never re-walk
  // the complete transcript. A live pane still needs delivery pruning.
  const sweep = () => {
    if (aborted) return;
    for (const pane of visiblePanes()) {
      if (!queueOf(pane).length) continue;
      schedule(pane, 900);
    }
  };

  offEvent = host.onEvent?.('agent', (payload) => {
    if (aborted) return;
    // A run ending is exactly when the native one-shot queue drain can be missed.
    const phase = payload?.data?.phase;
    if (phase !== 'end' && phase !== 'error' && phase !== 'aborted') return;
    const sessionKey = payload?.sessionKey;
    if (!sessionKey) return;
    for (const pane of visiblePanes()) {
      if (paneSessionKey(pane) !== sessionKey) continue;
      // Let native terminal handling run first; only then look for leftovers.
      after(() => { if (pane.isConnected) schedule(pane, 0); }, 700);
    }
  });

  // The pane re-renders constantly during streaming. Project only the subtrees that
  // actually changed; this is the difference between O(changed) and O(transcript).
  observer = new MutationObserver((records) => {
    if (aborted) return;
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
    if (!frame) {
      frame = requestAnimationFrame(() => { frame = 0; if (!aborted) sweep(); });
    }
  });
  observer.observe(document.body, {childList: true, subtree: true, characterData: true});

  // Reconnect: the native socket lifecycle is the only moment a waiting-reconnect
  // card becomes sendable again. `connection` is the host's snapshot signal.
  offSubscribe = host.subscribe?.(() => {
    if (aborted) return;
    if (!host.connection?.connected) return;
    for (const pane of visiblePanes()) if (queueOf(pane).some(isStuckItem)) schedule(pane, 600);
  });

  tick = setInterval(() => { if (!aborted) sweep(); }, 4000);
  const start = () => {
    if (aborted) return;
    for (const pane of visiblePanes()) {
      projectPane(pane);
      pane.dataset.cleRecoveryProjected = '1';
      schedule(pane, 1200);
    }
    // The pane mounts its composer after this module runs, so retry the two chrome
    // strings once the DOM settles.
    localizeRecoveryChrome(document);
    after(() => localizeRecoveryChrome(document), 900);
  };
  if (document.readyState === 'loading') {
    // `once` removes the listener after it fires, but abort can happen first: keep a
    // handle so a retired activation leaves no DOMContentLoaded hook behind.
    document.addEventListener('DOMContentLoaded', start, {once: true});
    afterCleanup.push(() => document.removeEventListener('DOMContentLoaded', start));
  } else {
    start();
  }

  signal?.addEventListener('abort', () => {
    aborted = true;
    observer?.disconnect();
    observer = null;
    clearInterval(tick);
    tick = 0;
    offEvent?.();
    offEvent = null;
    offSubscribe?.();
    offSubscribe = null;
    for (const id of timeouts) clearTimeout(id);
    timeouts.clear();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    for (const extra of afterCleanup) { try { extra(); } catch {} }
    afterCleanup.length = 0;
    // Deliberately NOT undone:
    //   - the fold markers on rows already proven internal,
    //   - the stylesheet that folds them.
    // A hot reload retires the activation while the native history DOM still holds the
    // control message. Stripping the markers is exactly what re-published it during a
    // real disconnect (review: 第四轮-真实断线待重连队列.png). The projection is
    // static and idempotent: it only ever hides rows this module positively identified,
    // and the next activation recomputes the same answer. Message data is untouched, so
    // a fresh mount still sees the real text and can un-fold a mistake.
    for (const pane of visiblePanes()) timers.delete(pane);
  }, {once: true});
}

export const __test = {isInternalTurnText, isStuckItem, appearsInTranscript, projectPane, CONTROL_SEGMENT};

// The backoff itself is worth testing without a real DOM/timer harness: it is the one
// piece that, if wrong, turns a flapping gateway into a request storm.
export function shouldAttempt(lastAttemptAt, now, cooldown = 6000) {
  return now - (lastAttemptAt || 0) >= cooldown;
}
