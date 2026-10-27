// Queue copy — the native queue is correct, its Chinese is not. 2026.10's zh-CN
// bundle renders `chat.queue.steer` as “引导”, which is a literal translation of the
// RPC verb and means nothing to a reader; the same screen mixes it with “待发送” and
// “重试”. The raw `sendError` strings from the gateway are English even in a Chinese
// UI. Both are presentation, so this layer only rewrites text-node values inside
// `.chat-queue` and keeps the original string in `title` for anyone who needs it.
//
// Deliberately narrow:
//  - never touches chat messages, code or the composer;
//  - never assigns textContent (that deletes Lit's comment markers and stops the
//    pane from committing new replies — see tests/lit-safe-chat-dom.test.cjs);
//  - leaves a word it does not know exactly as it was.

// One vocabulary for "this message is waiting / went / failed".
// zh-CN renders both the steer *action* and the "steered" *badge* as “引导”, so the
// same word needs two readings. The element decides, not the string.
const EXACT = new Map([
  ['Steer', '立即追加'],
  ['Steered', '正在确认追加'],
  ['Retry', '重试'],
  ['引导', '立即追加'],
  ['使用队列中的消息进行引导', '立即追加这条消息'],
  ['移除队列中的消息', '移除待发送消息'],
  ['重试队列中的消息', '重试这条消息'],
  ['编辑队列中的消息', '编辑这条消息'],
  ['更多队列消息操作', '更多操作'],
  ['正在等待重新连接', '等待重新连接'],
  ['送达状态不确定', '送达未确认'],
  ['送达状态未确认', '送达未确认'],
  ['等待模型准备好', '等待模型'],
  ['发送失败', '未发送'],
  ['这个位置固定, 无法调整顺序', '这条消息位置固定'],
  ['此消息的位置固定, 无法调整顺序', '这条消息位置固定'],
]);

// The "steered" badge reuses the action word; it reports a past state, not an offer.
const BADGE_STEERED = new Set(['引导', 'Steer', 'Steered', '已引导', '已追加']);

// Gateway error strings that reach `sendError` untranslated. Keep the meaning, drop
// the RPC phrasing; the original stays available as a tooltip.
const ERROR_EXACT = new Map([
  ['Delivery has not been confirmed. Check the conversation — retry only if your message didn\'t arrive.',
    '还不能确认这条是否送到了。先看看对话；如果确实没出现，再重试。'],
  ['Message will send when the Gateway reconnects.',
    '连接恢复后会自动送出。'],
  ['The Gateway asked us to retry this message shortly.',
    '网关要求稍后重试这条消息。'],
  ['Chat failed before the run started; try again.',
    '这一轮还没开始就失败了，再试一次。'],
  ['Could not store this message for reconnect. Free browser storage or reconnect before sending.',
    '这条消息没能存下来，断线后会丢。清理浏览器存储或重新连接后再发。'],
  ['The active run ended before the steer message was accepted.',
    '这一轮刚结束，追加没赶上；下一轮会带上。'],
  ['Steer failed before it reached the run; try again.',
    '追加没有送达，稍后重试。'],
]);

// `Queued (3)` arrives either as three Lit bindings or as one string.
const QUEUED = /^Queued\s*\((\d+)\)$/i;
const QUEUED_PREFIX = /^Queued\s*\($/i;
const QUEUED_SUFFIX = /^\)$/;

export function queueText(value) {
  const raw = String(value ?? '');
  const core = raw.trim();
  if (!core) return null;
  const mapped = EXACT.get(core);
  if (mapped) return mapped === core ? null : raw.replace(core, mapped);
  const queued = core.match(QUEUED);
  if (queued) return raw.replace(core, `待发送（${queued[1]}）`);
  if (QUEUED_PREFIX.test(core)) return raw.replace(core, '待发送（');
  if (QUEUED_SUFFIX.test(core)) return raw.replace(core, '）');
  return null;
}

export function queueErrorText(value) {
  const raw = String(value ?? '');
  const core = raw.trim();
  if (!core) return null;
  return ERROR_EXACT.get(core) ?? null;
}

// Which nodes may be rewritten. Two exclusions matter more than the inclusion:
// `.chat-queue__text` is the user's own sentence and `.chat-queue__edit-input` is the
// draft being edited. A queued message that literally says “引导” keeps its words.
const inQueue = (node) => Boolean(node?.parentElement?.closest?.('.chat-queue'));
const isUserCopy = (node) => Boolean(node?.parentElement?.closest?.('.chat-queue__text, .chat-queue__edit-input, textarea'));

export function localizeQueueNode(node) {
  if (node?.nodeType !== 3 || !node.nodeValue || !node.nodeValue.trim()) return false;
  if (!inQueue(node) || isUserCopy(node)) return false;
  const parent = node.parentElement;
  const error = parent?.closest?.('.chat-queue__error-text, .chat-queue__error');
  if (error) {
    const next = queueErrorText(node.nodeValue);
    if (!next) return false;
    if (!error.getAttribute('title')) error.setAttribute('title', node.nodeValue.trim());
    node.nodeValue = next;
    return true;
  }
  // A remaining steered card awaits durable confirmation; confirmed cards are removed.
  if (parent?.closest?.('.chat-queue__badge--steered') && BADGE_STEERED.has(node.nodeValue.trim())) {
    const raw = node.nodeValue;
    node.nodeValue = raw.replace(raw.trim(), '正在确认追加');
    return true;
  }
  const next = queueText(node.nodeValue);
  if (next === null) return false;
  node.nodeValue = next;
  // The accessible name is an attribute: Lit rewrites it on its next change but a
  // stale one would leave a screen reader reading “引导”.
  const button = parent?.closest?.('.chat-queue__steer, .chat-queue__retry, .chat-queue__remove');
  if (button) {
    const label = button.getAttribute('aria-label');
    if (label) {
      const mapped = queueText(label);
      if (mapped) button.setAttribute('aria-label', mapped);
    }
  }
  return true;
}

export function localizeQueueTree(root) {
  if (!root) return 0;
  let changed = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) if (localizeQueueNode(node)) changed += 1;
  return changed;
}
