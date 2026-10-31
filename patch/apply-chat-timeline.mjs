/**
 * Patch the native Control UI chat renderer so every visible user turn is a
 * bounded, chronological timeline. The patch is structural and all-or-nothing:
 * an upstream bundle that no longer matches is left byte-for-byte untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {refreshPrecompressed} from './lib-precompressed.mjs';

export const marker = '/* pinkie-chat-timeline:v26 */';
// Installed bundles keep their old runtime between the marker and the history
// projection function; an upgrade swaps exactly that span.
const previousMarkers = ['/* pinkie-chat-timeline:v25 */', '/* pinkie-chat-timeline:v24 */', '/* pinkie-chat-timeline:v23 */', '/* pinkie-chat-timeline:v22 */', '/* pinkie-chat-timeline:v21 */', '/* pinkie-chat-timeline:v20 */', '/* pinkie-chat-timeline:v19 */', '/* pinkie-chat-timeline:v18 */', '/* pinkie-chat-timeline:v17 */', '/* pinkie-chat-timeline:v16 */', '/* pinkie-chat-timeline:v15 */', '/* pinkie-chat-timeline:v14 */', '/* pinkie-chat-timeline:v13 */', '/* pinkie-chat-timeline:v12 */', '/* pinkie-chat-timeline:v11 */', '/* pinkie-chat-timeline:v10 */', '/* pinkie-chat-timeline:v9 */', '/* pinkie-chat-timeline:v8 */', '/* pinkie-chat-timeline:v7 */', '/* pinkie-chat-timeline:v6 */', '/* pinkie-chat-timeline:v5 */', '/* pinkie-chat-timeline:v4 */', '/* pinkie-chat-timeline:v3 */', '/* pinkie-chat-timeline:v2 */', '/* pinkie-chat-timeline:v1 */'];
export const MAX_TIMELINE_ROWS = 80;
// These are compatibility exports, not retention caps. Fetching is paginated;
// the renderer must keep every page the user has already opened reachable.
export const LIVE_MESSAGE_WINDOW = Infinity;
export const HISTORY_RENDER_LIMIT = Infinity;

function userText(message = {}) {
  if (typeof message.content === 'string') return message.content;
  if (typeof message.text === 'string') return message.text;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part && typeof part === 'object' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function hasVisibleUserPayload(message = {}) {
  if (typeof message.MediaPath === 'string' && message.MediaPath.trim()) return true;
  if (Array.isArray(message.MediaPaths)
      && message.MediaPaths.some((item) => typeof item === 'string' && item.trim())) return true;
  if (!Array.isArray(message.content)) return false;
  return message.content.some((part) => {
    if (!part || typeof part !== 'object') return false;
    return !['text', 'input_text', 'output_text', 'thinking', 'reasoning'].includes(part.type);
  });
}

function isInternalUserMessage(message = {}) {
  const raw = userText(message);
  const visible = raw.replace(/[\u200B-\u200D\u2060\u2063\uFEFF]/gu, '').trim();
  if (message?.__openclaw?.kind === 'pending-send') return true;
  if (/^\[pinkie-(?:watchdog|tier-control|tier)\]/iu.test(visible)) return true;
  return !visible && !hasVisibleUserPayload(message);
}

/** The legacy renderer has no virtual list. Its retained data stays complete;
 * only an explicit, navigable page is passed into Lit. Without pane options,
 * installed callers retain all loaded history instead of a silent hard tail. */
export function pinkieSelectMessageWindow(messages = [], shouldSkip = () => false, options) {
  const source = Array.isArray(messages) ? messages : [];
  const visible = (message) => !shouldSkip(message)
    && !(String(message?.role || '').toLowerCase() === 'user' && isInternalUserMessage(message));
  if (!options || typeof options !== 'object') return source.filter(visible);
  const view = pinkieLegacyHistoryView(options);
  const pane = pinkieHistoryPane(options);
  const sessionId = pane?.state?.currentSessionId || '';
  if (view.sessionId !== sessionId) {
    view.sessionId = sessionId;
    view.browsing = false;
    view.endKey = null;
    view.userAnchor = null;
    view.toolAnchors = new Map();
  }
  let end = source.length;
  if (view.browsing && view.endKey) {
    const cached = view.endIndex - 1;
    const at = cached >= 0 && pinkieHistoryMessageKey(source[cached]) === view.endKey
      ? cached : source.findIndex((message) => pinkieHistoryMessageKey(message) === view.endKey);
    if (at >= 0) end = at + 1;
    else { view.browsing = false; view.endKey = null; }
  }
  if (pane) {
    pane.__pinkieHistoryBrowsing = view.browsing === true;
    pane.__pinkieLegacyHistoryPaged = true;
  }
  const selected = [];
  let start = end;
  let chars = 0;
  while (start > 0 && selected.length < 100) {
    const message = source[start - 1];
    if (!visible(message)) { start -= 1; continue; }
    const weight = pinkieHistoryMessageWeight(message);
    if (selected.length && chars + weight > 240000) break;
    start -= 1;
    selected.unshift(message);
    chars += weight;
  }
  // If the first row is a tool result, keep its nearby call card as page
  // context as well. Parallel calls can share one assistant row.
  const first = selected[0];
  const result = textParts(first).find(isToolResultPart);
  const resultId = String(first?.toolCallId || first?.tool_call_id
    || (result ? partCallId(result, first) : ''));
  let toolContextIndex = -1;
  if (resultId) {
    const cache = view.toolAnchors || (view.toolAnchors = new Map());
    const cached = cache.get(resultId);
    let at = cached && cached.index < start
      && pinkieHistoryMessageKey(source[cached.index]) === cached.key ? cached.index : -1;
    if (at < 0) for (let index = start - 1; index >= 0; index -= 1) {
      const candidate = source[index];
      if (textParts(candidate).some((part) => isToolCallPart(part) && partCallId(part, candidate) === resultId)) {
        at = index;
        break;
      }
    }
    if (at >= 0) {
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(resultId, {index: at, key: pinkieHistoryMessageKey(source[at])});
      toolContextIndex = at;
      selected.unshift(source[at]);
    }
  }
  const realUser = (message) => String(message?.role || '').toLowerCase() === 'user' && visible(message);
  // A page may start halfway through a long tool run. Retain its user prompt
  // as context, while every intervening step remains reachable by paging.
  if (selected.length && !realUser(selected[0])) {
    const cached = view.userAnchor;
    const appended = source.length - (view.rawLength ?? source.length);
    const appendOnly = appended >= 0 && appended <= end - start && view.rawLength > 0
      && pinkieHistoryMessageKey(source[view.rawLength - 1]) === view.lastRawKey;
    let at = cached && (cached.start === start || appendOnly) && cached.index < start
      && pinkieHistoryMessageKey(source[cached.index]) === cached.key ? cached.index : -1;
    if (at < 0) for (let index = start - 1; index >= 0; index -= 1) {
      if (realUser(source[index])) { at = index; break; }
    }
    if (at >= 0) {
      const key = pinkieHistoryMessageKey(source[at]);
      view.userAnchor = {start, index: at, key};
      if (toolContextIndex >= 0 && toolContextIndex < at) selected.splice(1, 0, source[at]);
      else selected.unshift(source[at]);
    }
  }
  view.startIndex = start;
  view.endIndex = end;
  view.source = source;
  view.rawLength = source.length;
  view.lastRawKey = pinkieHistoryMessageKey(source.at(-1));
  view.shouldSkip = shouldSkip;
  view.hasPrevious = start > 0;
  view.hasNext = end < source.length;
  return selected;
}

function pinkieHistoryMessageKey(message) {
  if (!message) return '';
  if (message.__openclaw?.id) return `id:${message.__openclaw.id}`;
  if (Number.isSafeInteger(message.__openclaw?.seq)) return `seq:${message.__openclaw.seq}`;
  if (message.messageId) return `message:${message.messageId}`;
  return `${message.role || ''}:${message.timestamp ?? message.ts ?? ''}:${userText(message)}`;
}

function pinkieHistoryMessageWeight(message) {
  if (typeof message?.content === 'string') return message.content.length;
  if (Array.isArray(message?.content)) return message.content.reduce((total, part) => total
    + (typeof part?.text === 'string' ? part.text.length : 0)
    + (typeof part?.thinking === 'string' ? part.thinking.length : 0)
    + (typeof part?.reasoning === 'string' ? part.reasoning.length : 0), 0);
  return typeof message?.text === 'string' ? message.text.length : 0;
}

function pinkieLegacyHistoryView(options = {}) {
  const views = globalThis.__pinkieLegacyHistoryViews instanceof Map
    ? globalThis.__pinkieLegacyHistoryViews : (globalThis.__pinkieLegacyHistoryViews = new Map());
  const key = `${options.sessionKey || ''}:${options.paneId || 'main'}`;
  if (!views.has(key)) {
    if (views.size >= 128) views.delete(views.keys().next().value);
    views.set(key, {browsing: false, endKey: null});
  }
  return views.get(key);
}

function pinkieHistoryRenderOptions(options) {
  return pinkieLegacyHistoryView(options).browsing
    ? {...options, toolMessages: [], streamSegments: [], stream: null,
      streamStartedAt: null, runId: null, loading: false, sending: false}
    : options;
}

function pinkieHistoryPane(options = {}) {
  const panes = Array.from(globalThis.document?.querySelectorAll?.('openclaw-chat-pane') || []);
  const sameSession = (pane) => !options.sessionKey || pane?.state?.sessionKey === options.sessionKey;
  const exact = panes.find((pane) => sameSession(pane)
    && options.paneId != null && String(pane?.paneId ?? pane?.id ?? '') === String(options.paneId));
  if (exact) return exact;
  const candidates = panes.filter(sameSession);
  const sameMessages = candidates.filter((pane) => options.messages && pane?.state?.chatMessages === options.messages);
  if (sameMessages.length === 1) return sameMessages[0];
  return candidates.length === 1 ? candidates[0] : null;
}

function pinkieHistoryRepaint(pane, latest = false) {
  const state = pane.state;
  pane.__pinkieHistoryBrowsing = !latest;
  state.chatFollowLocked = !latest;
  state.chatUserNearBottom = latest;
  state.requestUpdate?.();
  pane.requestUpdate?.();
  Promise.resolve(pane.updateComplete).then(() => {
    if (pane.state !== state) return;
    if (latest) state.scrollToBottom?.({smooth: false});
    else {
      const thread = pane.querySelector?.('.chat-thread, .chat-messages, .chat-thread-scroll');
      if (thread) thread.scrollTop = 0;
    }
  });
}

function pinkieNavigateHistory(pane, options, direction) {
  const view = pinkieLegacyHistoryView(options);
  const source = pane?.state?.chatMessages;
  if (!Array.isArray(source) || !source.length) return;
  view.revision = (view.revision || 0) + 1;
  if (direction === 'latest') {
    view.browsing = false;
    view.endKey = null;
    pinkieHistoryRepaint(pane, true);
    return;
  }
  let end = view.endIndex;
  if (direction === 'previous') end = view.startIndex;
  else {
    let count = 0;
    let chars = 0;
    while (end < source.length && count < 100) {
      const message = source[end];
      const visible = !view.shouldSkip?.(message)
        && !(String(message?.role || '').toLowerCase() === 'user' && isInternalUserMessage(message));
      const weight = visible ? pinkieHistoryMessageWeight(message) : 0;
      if (visible && count && chars + weight > 240000) break;
      end += 1;
      if (visible) { count += 1; chars += weight; }
    }
  }
  if (end < 1) return;
  view.browsing = true;
  view.endIndex = end;
  view.endKey = pinkieHistoryMessageKey(source[end - 1]);
  view.userAnchor = null;
  pinkieHistoryRepaint(pane);
}

/** Legacy paging is explicit and Lit-owned; current native virtual scrolling
 * is never replaced. The earliest loaded page can fetch one more server page. */
function pinkieEarlierHistory(options) {
  const pane = pinkieHistoryPane(options);
  const state = pane?.state;
  if (!pane || !state) return c;
  const view = pinkieLegacyHistoryView(options);
  const canFetch = state.chatHistoryPagination?.hasMore === true
    && typeof globalThis.__laolaoLoadEarlierHistory === 'function';
  if (!view.hasPrevious && !view.browsing && !canFetch) return c;
  const pending = globalThis.__pinkieEarlierHistoryLoads instanceof WeakSet
    ? globalThis.__pinkieEarlierHistoryLoads : (globalThis.__pinkieEarlierHistoryLoads = new WeakSet());
  const failures = globalThis.__pinkieEarlierHistoryFailures instanceof WeakSet
    ? globalThis.__pinkieEarlierHistoryFailures : (globalThis.__pinkieEarlierHistoryFailures = new WeakSet());
  const loading = pending.has(pane) || pane.loadingOlder || state.chatLoading;
  // The server returns 128 rows while the old renderer displays up to 100.
  // At a loaded boundary, fetch before showing a tiny leftover page so a
  // reader does not have to click twice for each chunk. Keep other modes on
  // their existing path and never discard locally available history if the
  // fetch fails.
  const needsBoundaryPage = () => {
    if (!canFetch || !view.hasPrevious || !/^agent:(?:main|project|thinking|learning):/u.test(String(options.sessionKey || ''))) return false;
    let count = 0;
    let chars = 0;
    for (let index = view.startIndex - 1; index >= 0; index -= 1) {
      const message = view.source[index];
      if (view.shouldSkip?.(message) || (String(message?.role || '').toLowerCase() === 'user' && isInternalUserMessage(message))) continue;
      const weight = pinkieHistoryMessageWeight(message);
      if (count && chars + weight > 240000) return false;
      count += 1;
      chars += weight;
      if (count >= 100) return false;
    }
    return true;
  };
  const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
  const previous = (event) => {
    stop(event);
    if (pending.has(pane) || pane.state !== state || loading) return;
    const prefetchBoundary = needsBoundaryPage();
    if (view.hasPrevious && !prefetchBoundary) { pinkieNavigateHistory(pane, options, 'previous'); return; }
    if (!canFetch) return;
    const firstKey = pinkieHistoryMessageKey(view.source?.[view.startIndex]);
    pending.add(pane);
    failures.delete(pane);
    pane.requestUpdate?.();
    Promise.resolve().then(() => globalThis.__laolaoLoadEarlierHistory(pane)).then((changed) => {
      if (pane.state !== state) return;
      if (changed === false) {
        if (state.chatHistoryPagination?.hasMore === true) failures.add(pane);
        if (prefetchBoundary && view.hasPrevious) pinkieNavigateHistory(pane, options, 'previous');
      }
      else if (changed) {
        const source = state.chatMessages;
        const at = source.findIndex((message) => pinkieHistoryMessageKey(message) === firstKey);
        if (at > 0) {
          view.startIndex = at;
          pinkieNavigateHistory(pane, options, 'previous');
        }
      }
    }).catch(() => {
      failures.add(pane);
      if (prefetchBoundary && pane.state === state && view.hasPrevious) pinkieNavigateHistory(pane, options, 'previous');
    }).finally(() => {
      pending.delete(pane);
      pane.requestUpdate?.();
    });
  };
  const next = (event) => { stop(event); if (pane.state === state) pinkieNavigateHistory(pane, options, 'next'); };
  const latest = (event) => { stop(event); if (pane.state === state) pinkieNavigateHistory(pane, options, 'latest'); };
  const earliest = !view.hasPrevious && !canFetch;
  const buttonStyle = 'flex:0 0 auto;width:auto;min-width:0;height:24px;min-height:24px;padding:0 8px;font-size:12px;line-height:22px;white-space:nowrap;background:transparent;box-shadow:none';
  return s`<nav class="pinkie-history-pagination" aria-label="聊天记录分页" style="position:static;flex:0 0 auto;display:flex;align-items:center;justify-content:center;align-self:center;gap:4px;width:fit-content;max-width:100%;height:28px;min-height:28px;box-sizing:border-box;padding:2px;margin:0 auto 8px;border:0;background:transparent;box-shadow:none"><button class="btn btn--sm" style=${buttonStyle} data-pinkie-load-earlier title=${earliest ? '已到最早消息' : '查看更早的聊天记录'} ?disabled=${loading || earliest} @click=${previous}>${loading ? '正在加载更早消息…' : earliest ? '已到最早消息' : view.hasPrevious ? '上一页' : failures.has(pane) ? '重试加载更早消息' : '加载更早消息'}</button>${view.browsing ? s`<button class="btn btn--sm" style=${buttonStyle} data-pinkie-history-next ?disabled=${!view.hasNext} @click=${next}>下一页</button><button class="btn btn--sm" style=${buttonStyle} data-pinkie-history-latest @click=${latest}>回到最近</button>` : c}</nav>`;
}

// UI state is separate from persisted messages. Lit alone owns body creation
// and disposal; closing a card never removes native template markers by hand.
export function pinkieTimelineView(key) {
  const views = globalThis.__pinkieTimelineViews instanceof Map
    ? globalThis.__pinkieTimelineViews : (globalThis.__pinkieTimelineViews = new Map());
  if (!views.has(key)) {
    if (views.size >= 512) views.delete(views.keys().next().value);
    views.set(key, {open: false, count: 80});
  }
  return views.get(key);
}
export function pinkieProcessOpen(entry) {
  const view = pinkieTimelineView(entry.key);
  view.processDefault = entry.processLive === true || entry.processCurrent === true;
  return view.processChoice ?? (view.processDefault || view.open);
}
export function pinkieTimelineRows(entry, rows) {
  const view = pinkieTimelineView(entry.key);
  return view.open ? rows.slice(-view.count) : [];
}
function pinkieTimelineUpdate(target, update) {
  const pane = target?.closest?.('openclaw-chat-pane');
  const render = () => {
    update();
    if (pane?.requestUpdate) pane.requestUpdate();
    else pane?.state?.requestUpdate?.();
    return pane?.updateComplete;
  };
  return globalThis.__pinkieChatViewport?.preserve
    ? globalThis.__pinkieChatViewport.preserve(pane, render) : render();
}
export function pinkieTimelineToggle(event, key) {
  event.preventDefault();
  event.stopPropagation();
  return pinkieTimelineUpdate(event.currentTarget, () => {
    const view = pinkieTimelineView(key);
    view.open = !(view.processChoice ?? (view.processDefault || view.open));
    if ('processDefault' in view) view.processChoice = view.open;
    if (!view.open) view.count = 80;
  });
}
export function pinkieTimelineMore(event, key) {
  event.preventDefault();
  event.stopPropagation();
  return pinkieTimelineUpdate(event.currentTarget, () => { pinkieTimelineView(key).count += 80; });
}

function partType(part = {}) {
  return String(part.type || '').toLowerCase().replace(/[\s_-]/gu, '');
}

function partCallId(part = {}, message = {}) {
  return String(part.callId || part.toolCallId || part.tool_call_id || part.id
    || message.toolCallId || message.tool_call_id || message.toolUseId || message.tool_use_id || '');
}

function isToolCallPart(part = {}) {
  const type = partType(part);
  return type === 'toolcall' || type === 'tooluse'
    || (typeof part.name === 'string' && (part.arguments != null || part.args != null || part.input != null));
}

function isToolResultPart(part = {}) {
  const type = partType(part);
  return type === 'toolresult';
}

function textParts(message = {}) {
  if (typeof message.content === 'string') return [{type: 'text', text: message.content}];
  if (typeof message.text === 'string' && !Array.isArray(message.content)) {
    return [{type: 'text', text: message.text}];
  }
  return Array.isArray(message.content) ? message.content : [];
}

/** The native session-message handler defers history reloads during a run.
 * Gemini can persist its public preamble before it emits any assistant delta,
 * so consume that authoritative text immediately in the selected pane. Tools
 * and thoughts retain their separate native/event owners; history reconciles
 * this same durable message id normally after the run. */
export function pinkieApplySessionMessage(state, payload, selected) {
  if (!selected || !state || !payload || typeof payload !== 'object') return false;
  if (state.currentSessionId && payload.sessionId && state.currentSessionId !== payload.sessionId) return false;
  const source = payload.message;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const role = String(source.role || '').toLowerCase();
  if (role !== 'user' && role !== 'assistant') return false;
  if (role === 'user' && isInternalUserMessage(source)) return false;
  const content = textParts(source).filter((part) => ['text', 'inputtext', 'outputtext'].includes(partType(part))
    && typeof part.text === 'string' && Boolean(part.text.trim()));
  if (!content.length) return false;
  const id = String(source.__openclaw?.id || payload.messageId || '');
  if (!id) return false;
  const message = {...source, content: role === 'user' ? source.content : content,
    __openclaw: {...source.__openclaw, id}};
  const messages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  const head = messages.findLastIndex(item => String(item?.role || '').toLowerCase() === 'user' && !isInternalUserMessage(item));
  // chat.final can precede the durable session.message. Replace only the
  // received final from this user turn; identical replies in older turns or
  // two distinct durable messages must retain their own identities.
  const receipt = role === 'assistant' && !isToolPreamble(source) && !textParts(source).some(isToolCallPart)
    ? messages.findLastIndex((item, offset) => offset > head && !item?.__openclaw?.id
      && item?.__pinkieReceivedFinal?.sessionKey === state.sessionKey
      && userText(item) === userText(message)) : -1;
  if (role === 'assistant' && !state.chatRunId && receipt < 0) return false;
  let index = messages.findIndex((item) => item?.__openclaw?.id === id);
  if (receipt >= 0) {
    message.__pinkieReceivedFinal = messages[receipt].__pinkieReceivedFinal;
    if (index < 0) index = receipt;
  }
  if (index < 0 && role === 'user') {
    const pending = messages.findLastIndex(item => String(item?.role || '').toLowerCase() === 'user'
      && !isInternalUserMessage(item));
    const previous = messages[pending];
    if (previous && !previous.__openclaw?.id && userText(previous) === userText(source)) index = pending;
  }
  if (index >= 0 && (receipt < 0 || receipt === index) && JSON.stringify(messages[index]) === JSON.stringify(message)) return false;
  state.chatMessages = index < 0 ? [...messages, message]
    : messages.flatMap((item, offset) => offset === index ? [message] : offset === receipt ? [] : [item]);
  return true;
}

function isToolPreamble(message = {}) {
  return /^tool[_-]?(?:use|calls?)$/iu.test(String(message.stopReason || ''));
}

/** Called only inside the native branch that has accepted this run's final.
 * Mark that received reply for the short race with a stale history snapshot.
 * Some adapters concatenate prior tool preambles into chat.final; remove only
 * an exact prefix that this same turn has already persisted as narration. */
export function pinkieAcceptFinalMessage(state, payload, message) {
  if (!message || payload?.state !== 'final') return message;
  const messages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  const head = messages.findLastIndex((item) => String(item?.role || '').toLowerCase() === 'user' && !isInternalUserMessage(item));
  const prefix = messages.slice(head + 1).filter(isToolPreamble)
    .map((item) => textParts(item).filter((part) => partType(part) === 'text').map((part) => part.text || '').join('').trim()).join('');
  const parts = textParts(message);
  const text = parts.filter((part) => partType(part) === 'text').map((part) => part.text || '').join('');
  const remainder = prefix && text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : '';
  let replaced = false;
  const content = remainder ? parts.flatMap((part) => {
    if (partType(part) !== 'text') return [part];
    if (replaced) return [];
    replaced = true;
    return [{...part, text: remainder}];
  }) : parts;
  const accepted = {...message, content, stopReason: message.stopReason || payload.stopReason || 'stop',
    __pinkieReceivedFinal: {sessionKey: state.sessionKey, sessionId: state.currentSessionId || '', runId: payload.runId || ''}};
  // Reverse event order: native final append deduplicates stream fallbacks,
  // not durable messages. Replace this exact durable id before that append.
  const durable = messages.slice(head + 1).findLast(item => item?.__openclaw?.id
    && String(item?.role || '').toLowerCase() === 'assistant' && !isToolPreamble(item)
    && !textParts(item).some(isToolCallPart) && userText(item) === userText(accepted));
  if (!durable) return accepted;
  state.chatMessages = messages.filter((item, offset) => offset <= head || item?.__openclaw?.id !== durable.__openclaw.id);
  return {...durable, __pinkieReceivedFinal: accepted.__pinkieReceivedFinal};
}

function cleanAssistantMessage(message, content) {
  const copy = {...message, role: 'assistant', content};
  delete copy.toolName;
  delete copy.tool_name;
  delete copy.toolCallId;
  delete copy.tool_call_id;
  delete copy.toolUseId;
  delete copy.tool_use_id;
  return copy;
}

function makeToolMessage(message, content) {
  // Keep tool identity only in the synthetic content parts.  The native
  // renderer treats any top-level toolName/toolCallId alias as a standalone
  // tool-result message, which adds its generic "Tool output" summary ahead
  // of the actual tool name.  cleanAssistantMessage removes those aliases
  // while leaving the tool_call/tool_result data intact for the native parser.
  return cleanAssistantMessage(message, content);
}

/**
 * Split a mixed assistant/tool message into user-visible prose rows and one
 * independently expandable row per tool call. getToolCalls is the native
 * bundle's existing parser (lb in current builds), so tool labels and details
 * continue to use OpenClaw's own normalization.
 */
export function pinkieSplitTimelineMessage(entry = {}, getToolCalls = () => []) {
  const message = entry.message && typeof entry.message === 'object' ? entry.message : {};
  const key = String(entry.key || 'timeline-message');
  const role = String(message.role || '').toLowerCase();
  let calls = [];
  try {
    calls = getToolCalls(message, key) || [];
  } catch {}
  const content = textParts(message);
  const isMixedToolMessage = role === 'assistant'
    && (calls.length > 0 || content.some((part) => isToolCallPart(part) || isToolResultPart(part)));
  if (!isMixedToolMessage) {
    const hasVisibleContent = content.some((part) => {
      const type = partType(part);
      if (type === 'text' || type === 'inputtext' || type === 'outputtext') {
        return typeof part?.text === 'string' && Boolean(part.text.trim());
      }
      return Boolean(part && typeof part === 'object' && part.type
        && type !== 'thinking' && type !== 'reasoning');
    });
    // Thinking-only and empty assistant records have no user-facing bubble.
    // Keeping the native message here creates a blank bubble (and its action
    // row) after a history refresh.
    if (role === 'assistant' && !hasVisibleContent && !calls.length) return [];
    // History replies carry tool results as standalone toolResult messages
    // whose call part was not kept. Render them like every other tool row
    // ("读取文件 · Read") instead of the native generic "Tool output" card.
    const name = message.toolName || message.tool_name;
    if (role !== 'assistant' && role !== 'user' && name) {
      const callId = partCallId({}, message);
      const output = content.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n');
      return [{
        role: 'tool',
        message: makeToolMessage(message, [
          {type: 'tool_call', name: String(name), ...(callId ? {callId} : {})},
          {type: 'tool_result', name: String(name), text: output, ...(callId ? {callId} : {}),
            ...(typeof message.isError === 'boolean' ? {isError: message.isError} : {})},
        ]),
        key,
      }];
    }
    return [{
      role: role === 'assistant' ? 'assistant' : 'tool',
      message,
      key,
    }];
  }

  const rows = [];
  const consumedResults = new Set();
  const usedCalls = new Set();
  let callCursor = 0;
  const nextCall = (id, part) => {
    const wanted = id || partCallId(part, message);
    if (wanted) {
      const found = calls.findIndex((call, index) => !usedCalls.has(index)
        && String(call.callId || '') === wanted);
      if (found >= 0) {
        usedCalls.add(found);
        return calls[found];
      }
    }
    while (callCursor < calls.length && usedCalls.has(callCursor)) callCursor += 1;
    if (callCursor < calls.length) {
      const index = callCursor++;
      usedCalls.add(index);
      return calls[index];
    }
    return null;
  };

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index] || {};
    const type = partType(part);
    if ((type === 'text' || type === 'inputtext' || type === 'outputtext')
        && typeof part.text === 'string' && part.text.trim()) {
      rows.push({
        role: 'assistant',
        message: cleanAssistantMessage(message, [part]),
        key: `${key}:timeline:text:${index}`,
      });
      continue;
    }
    if (isToolCallPart(part)) {
      const id = partCallId(part, message);
      const call = nextCall(id, part) || {};
      const callId = String(call.callId || id || '');
      const name = String(call.name || part.name || message.toolName || message.tool_name || 'tool');
      const relatedResults = [];
      for (let resultIndex = index + 1; resultIndex < content.length; resultIndex += 1) {
        const candidate = content[resultIndex] || {};
        if (!isToolResultPart(candidate)) continue;
        const resultId = partCallId(candidate, message);
        if (callId && resultId && callId !== resultId) continue;
        if (callId) relatedResults.splice(0, relatedResults.length, candidate);
        else relatedResults.push(candidate);
        consumedResults.add(resultIndex);
      }
      const callPart = {
        type: 'tool_call',
        name,
        arguments: call.args ?? part.arguments ?? part.args ?? part.input,
        ...(callId ? {callId} : {}),
      };
      const details = [callPart, ...relatedResults];
      if (!relatedResults.length && call.outputText !== undefined) {
        details.push({
          type: 'tool_result', name, text: call.outputText,
          ...(callId ? {callId} : {}),
          ...(typeof call.isError === 'boolean' ? {isError: call.isError} : {}),
        });
      }
      rows.push({
        role: 'tool',
        message: makeToolMessage(message, details, {...call, name, callId}),
        key: `${key}:timeline:tool:${index}`,
      });
      continue;
    }
    if (isToolResultPart(part)) {
      if (consumedResults.has(index)) continue;
      const resultCall = calls.find((call) => call.callId
        && String(call.callId) === partCallId(part, message));
      if (resultCall) usedCalls.add(calls.indexOf(resultCall));
      rows.push({
        role: 'tool',
        message: makeToolMessage(message, [part], resultCall || {
          name: part.name || message.toolName || message.tool_name,
          callId: partCallId(part, message),
        }),
        key: `${key}:timeline:result:${index}`,
      });
      continue;
    }
    if (part && typeof part === 'object' && part.type && part.type !== 'thinking' && part.type !== 'reasoning') {
      rows.push({
        role: 'assistant',
        message: cleanAssistantMessage(message, [part]),
        key: `${key}:timeline:content:${index}`,
      });
    }
  }

  // Some OpenClaw/provider adapters expose parsed calls only at the message
  // level. Keep those visible even when content parts omit call objects.
  calls.forEach((call, index) => {
    if (usedCalls.has(index)) return;
    const callId = String(call.callId || '');
    const callPart = {
      type: 'tool_call',
      name: String(call.name || message.toolName || message.tool_name || 'tool'),
      arguments: call.args,
      ...(callId ? {callId} : {}),
    };
    const details = [callPart];
    if (call.outputText !== undefined) {
      details.push({type: 'tool_result', name: call.name, text: call.outputText,
        ...(callId ? {callId} : {}),
        ...(typeof call.isError === 'boolean' ? {isError: call.isError} : {})});
    }
    rows.push({
      role: 'tool',
      message: makeToolMessage(message, details, call),
      key: `${key}:timeline:tool:fallback:${index}`,
    });
  });

  return rows;
}

function isFailedAssistantMessage(message = {}) {
  return String(message.role || '').toLowerCase() === 'assistant'
    && String(message.stopReason || '').toLowerCase() === 'error';
}

function failureDetail(message = {}) {
  const detail = String(message.errorMessage || message.error || '').replace(/\s+/gu, ' ').trim();
  if (!detail || /assistant turn failed before producing content/iu.test(detail)) return '';
  return detail.slice(0, 180);
}

function formatFailureSummary(message = {}, count = 1) {
  const detail = failureDetail(message);
  const summary = detail ? `这次没连上模型：${detail}` : '这次回复没能完成，请稍后再试。';
  return `${summary}${count > 1 ? `（连续 ${count} 次）` : ''}`;
}

/** Merge a run of repeated failed assistant replies, even if each retry had
 * its own user bubble. Keep those user messages in order and show one clean,
 * actionable Chinese failure line after the last failed attempt. */
function collapseFailedAssistantEntries(entries) {
  const output = [];
  let pending = null;
  const flush = () => {
    if (!pending) return;
    const source = pending.last.message;
    const message = {
      ...source,
      role: 'assistant',
      content: [{type: 'text', text: formatFailureSummary(source, pending.count)}],
      __pinkieFailureSummary: true,
      __pinkieFailureCount: pending.count,
    };
    for (const key of ['stopReason', 'errorMessage', 'error', 'actions', 'retryable', 'isError']) delete message[key];
    output.push({
      ...pending.last.group,
      messages: [{...pending.last.entry, message}],
      timestamp: pending.last.group.timestamp ?? source.timestamp ?? source.ts,
    });
    pending = null;
  };

  for (const entry of entries) {
    const messages = entry?.kind === 'group' && Array.isArray(entry.messages) ? entry.messages : [];
    const failures = messages.filter((wrapped) => isFailedAssistantMessage(wrapped?.message || {}));
    const isFailureOnlyGroup = entry?.kind === 'group'
      && String(entry.role || '').toLowerCase() === 'assistant'
      && failures.length === messages.length && failures.length > 0;
    if (isFailureOnlyGroup) {
      for (const wrapped of failures) {
        const message = wrapped.message || {};
        const signature = failureDetail(message) || 'model-failure';
        if (pending && pending.signature !== signature) flush();
        if (!pending) pending = {signature, count: 0, last: null};
        pending.count += 1;
        pending.last = {group: entry, entry: wrapped, message};
      }
      continue;
    }
    // Internal control turns were removed before this pass, while real user
    // turns stay visible and do not split a consecutive retry streak.
    if (entry?.kind === 'group' && String(entry.role || '').toLowerCase() === 'user') {
      output.push(entry);
      continue;
    }
    flush();
    output.push(entry);
  }
  flush();
  return output;
}

function timelineGroup(group, row) {
  const entry = {...row.entry, message: row.message, key: row.key};
  return {
    ...group,
    key: row.key,
    role: row.role,
    senderLabel: null,
    messages: [entry],
    timestamp: row.message?.timestamp ?? group.timestamp,
    isTimelineStep: true,
    isStreaming: group.isStreaming === true,
  };
}

function resultParts(group, getToolCalls) {
  const results = new Map();
  for (const entry of group.messages || []) {
    const message = entry?.message || {};
    if (String(message.role || '').toLowerCase() === 'assistant') continue;
    let calls = [];
    try { calls = getToolCalls(message, entry.key) || []; } catch {}
    for (const call of calls) {
      if (!call.callId || call.outputText === undefined && call.isError === undefined) continue;
      const id = String(call.callId);
      const list = results.get(id) || [];
      list.push({entry, call});
      results.set(id, list);
    }
  }
  return results;
}

function attachToolResults(entry, groupResults, pairedResultKeys, getToolCalls) {
  const message = entry?.message || {};
  if (String(message.role || '').toLowerCase() !== 'assistant') return entry;
  let calls = [];
  try { calls = getToolCalls(message, entry.key) || []; } catch {}
  if (!calls.length) return entry;
  const content = Array.isArray(message.content) ? [...message.content] : textParts(message);
  for (const call of calls) {
    if (!call.callId || call.outputText !== undefined) continue;
    const results = groupResults.get(String(call.callId)) || [];
    const result = results.at(-1);
    if (!result) continue;
    const {entry: resultEntry, call: output} = result;
    pairedResultKeys.add(resultEntry.key);
    content.push({
      type: 'tool_result',
      name: call.name || output.name,
      callId: String(call.callId),
      text: output.outputText ?? '',
      ...(typeof output.isError === 'boolean' ? {isError: output.isError} : {}),
    });
  }
  return {...entry, message: {...message, content}};
}

function isRealUserGroup(item) {
  return item?.kind === 'group'
    && String(item.role || '').toLowerCase() === 'user'
    && (item.messages || []).some((entry) => !isInternalUserMessage(entry?.message || {}));
}

function timelineTimestamp(item) {
  return item?.timestamp
    ?? item?.messages?.[0]?.message?.timestamp
    ?? item?.messages?.[0]?.timestamp
    ?? 0;
}

function collapseTimelineRows(rows, maxRows, ownerKey) {
  const rowLimit = Math.max(4, Number.isFinite(maxRows) ? Math.floor(maxRows) : 80);
  if (rows.length <= rowLimit) return rows;
  const trailingRows = rowLimit - 1;
  const hidden = rows.slice(0, rows.length - trailingRows);
  const overflow = {
    kind: 'group',
    key: `pinkie:timeline:overflow:${ownerKey}`,
    role: 'assistant',
    messages: [],
    timestamp: timelineTimestamp(hidden[0]),
    timelineOverflow: true,
    overflowItems: hidden,
    overflowCount: hidden.length,
  };
  return [overflow, ...rows.slice(-trailingRows)];
}

function formatProcessDuration(ms) {
  const seconds = Math.max(1, Math.round(Number(ms) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function pinkieRunIsActive() {
  const activeRuns = globalThis.__pinkieActiveChatRuns;
  let sessionKey = '';
  try { sessionKey = new URLSearchParams(globalThis.location?.search || '').get('session') || ''; } catch {}
  if (sessionKey && activeRuns && typeof activeRuns.has === 'function' && activeRuns.has(sessionKey)) {
    return activeRuns.get(sessionKey) === true;
  }
  const panes = Array.from(globalThis.document?.querySelectorAll?.('openclaw-chat-pane') || []);
  const pane = panes.find((item) => !sessionKey || item?.state?.sessionKey === sessionKey) || panes[0];
  const state = pane?.state;
  if (state?.chatRunId || state?.chatStream) return true;
  const session = state?.sessionsResult?.sessions?.find?.((item) => item?.key === (sessionKey || state.sessionKey));
  return session?.hasActiveRun === true;
}

/**
 * One turn becomes: the user message, one "process card" holding Pinkie's
 * narration and tool rows in source order, then the final reply bubble. While
 * live, narration is shown outside the folded tool details; completion moves
 * it into those details. The native final stream/reading rows stay outside.
 * Plain answers without
 * any intermediate step keep exactly the native layout.
 */
function pinkieProcessTurnKey(head, ownerKey) {
  let session = '';
  try { session = new URLSearchParams(globalThis.location?.search || '').get('session') || ''; } catch {}
  const id = String(head?.messages?.[0]?.message?.__openclaw?.id || ownerKey);
  return `pinkie:process:${session}:${id}`;
}

/** Only trusted learning-tool results create slots. Prose and arbitrary HTML
 * never become executable content, and the correct answer stays on the server. */
export function pinkieLearningInlineReferences(rows, getToolCalls = () => []) {
  const refs = new Map();
  for (const row of rows || []) for (const entry of row.messages || []) {
    let calls = [];
    try { calls = getToolCalls(entry.message || {}, entry.key) || []; } catch {}
    for (const call of calls) {
      if (!['learning_activity', 'learning_desk'].includes(String(call.name || '').split('.').at(-1)) || call.isError
        || typeof call.outputText !== 'string' || call.outputText.length > 500000) continue;
      let data;
      try {
        data = JSON.parse(call.outputText);
        if (!data?.inline && data?.details?.inline) data = data.details;
        if (!data?.inline && Array.isArray(data?.content)) {
          const part = data.content.find(part => part?.type === 'text' && typeof part.text === 'string');
          if (part) data = JSON.parse(part.text);
        }
      } catch { continue; }
      const value = data?.inline;
      if (value?.v !== 1 || !['quiz', 'function_plot', 'process_flow', 'sentence_parse', 'mapreduce_lab', 'c_program', 'memory_lab', 'device_lab', 'illustrated_guide', 'circuit_lab', 'network_lab', 'math_check', 'english_reading', 'english_writing', 'mock_exam', 'review_queue', 'concept_lab', 'logic_lab', 'timing_lab', 'sequence_lab', 'desk_card', 'desk_receipt', 'desk_plan'].includes(value.kind)
        || typeof value.id !== 'string' || !value.id || value.id.length > 160
        || typeof value.sessionKey !== 'string' || !/^agent:learning:[^\r\n]{1,480}$/.test(value.sessionKey)) continue;
      const key = `${value.sessionKey}:${value.kind}:${value.id}`;
      refs.set(key, {v: 1, id: value.id, kind: value.kind, sessionKey: value.sessionKey,
        title: String(value.title || '互动学习').slice(0, 160), revision: Number(value.revision) || 0});
    }
  }
  return [...refs.values()];
}

function projectTimelineTurn(entries, getToolCalls, maxRows, isLatestTurn = false) {
  if (!entries.length) return [];
  const hasUserHead = isRealUserGroup(entries[0]);
  const firstStepIndex = hasUserHead ? 1 : 0;
  let lastToolIndex = -1;
  for (let index = firstStepIndex; index < entries.length; index += 1) {
    const item = entries[index];
    if (item?.kind === 'group' && String(item.role || '').toLowerCase() === 'tool') {
      lastToolIndex = index;
    }
  }
  let finalAssistantIndex = -1;
  for (let index = firstStepIndex; index < entries.length; index += 1) {
    const item = entries[index];
    if (item?.kind === 'group' && String(item.role || '').toLowerCase() === 'assistant'
        && !isToolPreamble(item.messages?.at?.(-1)?.message)
        && (item.messages || []).some(entry => pinkieSplitTimelineMessage(entry, getToolCalls)
          .some(part => part.role === 'assistant'))
        && (lastToolIndex < 0 || index > lastToolIndex)) {
      finalAssistantIndex = index;
    }
  }

  const head = hasUserHead ? entries[0] : null;
  const steps = [];
  const tail = [];
  let liveItems = false;
  for (let index = firstStepIndex; index < entries.length; index += 1) {
    let item = entries[index];
    if (item?.kind !== 'group') {
      // Live-only entries are emitted by the active user turn. A stale one
      // must not survive as an old native-rendered row after the next send.
      if (item?.kind === 'stream' || item?.kind === 'reading-indicator') {
        if (!isLatestTurn) continue;
        liveItems = true;
        if (item.kind === 'stream') {
          // A persisted last assistant is authoritative. Some adapters send
          // preambles + final as a cumulative stream after it has arrived.
          if (finalAssistantIndex >= 0) continue;
          const prefix = entries.flatMap(entry => entry.messages || [])
            .map(entry => entry.message || {}).filter(isToolPreamble)
            .map(message => userText(message).trim()).join('');
          const text = String(item.text || '');
          if (prefix && prefix.startsWith(text.trim()) && text.trim()) continue;
          if (prefix && text.startsWith(prefix)) item = {...item, text: text.slice(prefix.length).trimStart()};
        }
        // A sentence Pinkie streamed before a later tool call is narration:
        // it must stay visible now, not only after the history sync.
        if (item.kind === 'stream' && index < lastToolIndex && String(item.text || '').trim()) {
          steps.push({
            kind: 'group', role: 'assistant', key: String(item.key || `stream:${index}`), senderLabel: null,
            messages: [{message: {role: 'assistant', content: [{type: 'text', text: String(item.text)}], timestamp: item.startedAt}, key: String(item.key || `stream:${index}`)}],
            timestamp: item.startedAt, isTimelineStep: true,
          });
          continue;
        }
        tail.push(item);
        continue;
      }
      tail.push(item);
      continue;
    }
    const role = String(item.role || '').toLowerCase();
    if (role === 'assistant' && index === finalAssistantIndex) {
      // The final response deliberately keeps the normal assistant bubble.
      tail.push(item);
      continue;
    }
    if (role !== 'assistant' && role !== 'tool') {
      tail.push(item);
      continue;
    }

    const pairedResultKeys = new Set();
    const results = role === 'tool' ? resultParts(item, getToolCalls) : new Map();
    for (const entry of item.messages || []) {
      if (pairedResultKeys.has(entry.key)) continue;
      const augmented = role === 'tool'
        ? attachToolResults(entry, results, pairedResultKeys, getToolCalls)
        : entry;
      const parts = pinkieSplitTimelineMessage(augmented, getToolCalls);
      for (const part of parts) {
        steps.push(timelineGroup(item, {...part, entry: augmented}));
      }
    }
  }
  const ownerKey = String(head?.key || head?.messages?.[0]?.key
    || entries[0]?.key || entries[0]?.messages?.[0]?.key || 'turn');
  const processKey = pinkieProcessTurnKey(head || entries[0], ownerKey);
  const historyThinking = entries.filter(item => item?.kind === 'group' && item.role === 'assistant')
    .flatMap(item => item.messages || []).flatMap(entry => textParts(entry.message))
    .filter(part => ['thinking', 'reasoning'].includes(partType(part)))
    .map(part => part.thinking || part.reasoning || part.text || '').filter(text => typeof text === 'string' && text.trim()).join('\n\n');
  const live = isLatestTurn && (liveItems || pinkieRunIsActive());
  // The live turn always gets its card, so thinking has a place before the
  // first step. A finished plain answer keeps one only when the page recorded
  // its thinking (laolao-process-card maintains this read-only key set).
  const keep = globalThis.__pinkieProcessKeep;
  const legacyOwner = head?.pinkieLegacyOwnerKey || ownerKey;
  const legacyKey = `pinkie:process:${legacyOwner}`;
  const savedThinking = globalThis.__laolaoProcessCard?.store || {};
  const kept = Boolean(keep && typeof keep.has === 'function' && (keep.has(processKey)
    || keep.has(legacyKey) || keep.has(pinkieProcessTurnKey(null, legacyOwner))))
    || Object.values(savedThinking).some(record => record?.text && record.turn?.id
      && processKey === `pinkie:process:${record.turn.session}:${record.turn.id}`);
  if (!steps.length && !live && !kept && !historyThinking) return [...(head ? [head] : []), ...tail];

  const finalMessage = finalAssistantIndex >= 0
    ? entries[finalAssistantIndex]?.messages?.at?.(-1)?.message || {}
    : {};
  const finalReason = String(finalMessage.stopReason || '').toLowerCase();
  const processInterrupted = steps.length > 0 && (finalAssistantIndex < 0
    || finalAssistantIndex <= lastToolIndex
    || finalReason === 'error' || finalReason === 'aborted' || finalReason === 'timeout'
    || finalMessage.__pinkieFailureSummary === true);

  const toolCount = steps.filter((row) => String(row.role || '').toLowerCase() === 'tool').length;
  const lastItem = tail.length ? tail[tail.length - 1] : steps[steps.length - 1];
  const started = Number(timelineTimestamp(head || entries[0]));
  const ended = Number(timelineTimestamp(lastItem));
  const duration = started > 0 && ended > started ? formatProcessDuration(ended - started) : '';
  const card = {
    kind: 'group',
    key: processKey,
    role: 'assistant',
    messages: [],
    timestamp: timelineTimestamp(steps[0]),
    isProcessCard: true,
    processLive: live,
    processCurrent: isLatestTurn,
    processThinking: historyThinking,
    processLegacyKey: `pinkie:process:${head?.pinkieLegacyOwnerKey || ownerKey}`,
    processLiveRows: [], // laolao: live narration stays in the card, interleaved with tools (like the finished card)
    processState: !live && processInterrupted ? 'oops' : '',
    processRows: collapseTimelineRows(steps, maxRows, ownerKey),
    processSteps: toolCount,
    processTitle: !hasUserHead ? '接着之前的工作'
      : live ? '碧琪正在干活'
        : processInterrupted ? '这一轮停下来了' : '碧琪的工作过程',
    processMeta: live
      ? (toolCount ? `已做 ${toolCount} 步` : '')
      : [toolCount ? `${toolCount} 个步骤` : '', duration ? `用时 ${duration}` : '',
        processInterrupted ? '已中断' : ''].filter(Boolean).join(' · '),
  };
  // Tool-created activities are part of this reply, not its folded work log.
  // Give them a stable row after the answer so a long reply cannot leave the
  // card above the viewport while telling the student to answer below.
  const learningCards = pinkieLearningInlineReferences(steps, getToolCalls);
  const learningRow = learningCards.length ? [{kind: 'group', role: 'assistant',
    key: `${processKey}:learning`, messages: [], isLearningCard: true, learningCards}] : [];
  return [...(head ? [head] : []), card, ...tail, ...learningRow];
}

/** Pure timeline projection, also exercised directly by unit tests. */
export function pinkieBuildTimeline(entries = [], getToolCalls = () => [], maxRows = 80, options) {
  const pageIsLive = !options || !pinkieLegacyHistoryView(options).browsing;
  const pagePresentation = (timeline) => pageIsLive ? timeline : timeline.map((item) => item?.isProcessCard
    ? {...item, processLive: false, processCurrent: false, processState: '', processTitle: '本页工作过程',
      processMeta: '分页查看'} : item);
  const visibleEntries = (Array.isArray(entries) ? entries : []).flatMap((item) => {
    if (item?.kind !== 'group' || String(item.role || '').toLowerCase() !== 'user') return [item];
    const messages = (item.messages || []).filter((entry) => !isInternalUserMessage(entry?.message || {}));
    return messages.length ? [{...item, messages}] : [];
  });
  const safeEntries = collapseFailedAssistantEntries(visibleEntries).flatMap((item) => {
    if (item?.kind !== 'group') return [item];
    const messages = (item.messages || []).filter((entry) => {
      const message = entry?.message || {};
      const role = String(message.role || item.role || '').toLowerCase();
      if (role !== 'assistant' || message.__pinkieFailureSummary === true) return true;
      const parts = textParts(message);
      return parts.some((part) => {
        const type = partType(part);
        if (type === 'text' || type === 'inputtext' || type === 'outputtext') {
          return typeof part?.text === 'string' && Boolean(part.text.trim());
        }
        return Boolean(part && typeof part === 'object' && part.type);
      }) || Boolean(message.toolName || message.tool_name || message.toolCallId || message.tool_call_id);
    });
    if (!messages.length) return [];
    if (item.role === 'assistant' || item.role === 'user') return messages.map(entry => ({...item,
      key: entry.key, pinkieLegacyOwnerKey: item.key, messages: [entry], timestamp: entry.message?.timestamp ?? item.timestamp}));
    return [{...item, messages}];
  });
  const turnStarts = [];
  for (let index = 0; index < safeEntries.length; index += 1) {
    if (isRealUserGroup(safeEntries[index])) turnStarts.push(index);
  }
  if (!turnStarts.length) {
    if (!safeEntries.length) return [];
    // When a fresh page's native ten-message tail has no user head, the
    // selected session's backend run state still tells us whether this orphan
    // chunk is live. Earlier chunks separated by compaction remain historical.
    return pagePresentation(projectOrphanEntries(safeEntries, getToolCalls, maxRows, pageIsLive && pinkieRunIsActive()));
  }

  const timeline = projectOrphanEntries(safeEntries.slice(0, turnStarts[0]), getToolCalls, maxRows);
  for (let turnIndex = 0; turnIndex < turnStarts.length; turnIndex += 1) {
    const start = turnStarts[turnIndex];
    const end = turnStarts[turnIndex + 1] ?? safeEntries.length;
    timeline.push(...projectTimelineTurn(
      safeEntries.slice(start, end),
      getToolCalls,
      maxRows,
      pageIsLive && turnIndex === turnStarts.length - 1,
    ));
  }
  return pagePresentation(timeline);
}

function isCompactionEntry(item) {
  return item?.kind === 'group' && (item.messages || []).some((entry) =>
    entry?.message?.__openclaw?.kind === 'compaction');
}

function projectOrphanEntries(entries, getToolCalls, maxRows, latestChunkIsLive = false) {
  if (!entries.length) return [];
  // Compaction changes model context, not the run's completion state. After a
  // refresh its retained history can lack a user head; keep that active task's
  // narration visible on both sides of the divider rather than folding the
  // prefix as if it were already finished.
  if (latestChunkIsLive) return projectTimelineTurn(entries, getToolCalls, maxRows, true);
  const output = [];
  let chunk = [];
  const flush = (isLatestChunk = false) => {
    if (chunk.length) output.push(...projectTimelineTurn(chunk, getToolCalls, maxRows,
      latestChunkIsLive && isLatestChunk));
    chunk = [];
  };
  for (const entry of entries) {
    if (isCompactionEntry(entry)) {
      flush();
      output.push(entry);
    } else chunk.push(entry);
  }
  flush(true);
  return output;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function replaceExactlyOnce(source, pattern, replacement, description) {
  const matches = typeof pattern === 'string'
    ? source.split(pattern).length - 1
    : [...source.matchAll(new RegExp(pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;
  if (matches !== 1) throw new Error(`${description}: expected one structural match, found ${matches}`);
  return source.replace(pattern, replacement);
}

function functionSection(source, markerText) {
  const markerIndex = source.indexOf(markerText);
  if (markerIndex < 0 || source.indexOf(markerText, markerIndex + markerText.length) >= 0) {
    throw new Error('cannot identify the history projection');
  }
  const start = source.lastIndexOf('function ', markerIndex);
  const next = source.indexOf('function ', markerIndex);
  if (start < 0 || next < 0) throw new Error('history projection boundaries are missing');
  return {start, end: next, text: source.slice(start, next)};
}

function splitRuntimeSource() {
  return `${userText.toString()}\n${hasVisibleUserPayload.toString()}\n${isInternalUserMessage.toString()}\n${pinkieSelectMessageWindow.toString()}\n${pinkieHistoryMessageKey.toString()}\n${pinkieHistoryMessageWeight.toString()}\n${pinkieLegacyHistoryView.toString()}\n${pinkieHistoryRenderOptions.toString()}\n${pinkieHistoryPane.toString()}\n${pinkieHistoryRepaint.toString()}\n${pinkieNavigateHistory.toString()}\n${pinkieEarlierHistory.toString()}\n${pinkieTimelineView.toString()}\n${pinkieProcessOpen.toString()}\n${pinkieTimelineRows.toString()}\n${pinkieTimelineUpdate.toString()}\n${pinkieTimelineToggle.toString()}\n${pinkieTimelineMore.toString()}\n${partType.toString()}\n${partCallId.toString()}\n${isToolCallPart.toString()}\n${isToolResultPart.toString()}\n${textParts.toString()}\n${pinkieApplySessionMessage.toString()}\n${isToolPreamble.toString()}\n${pinkieAcceptFinalMessage.toString()}\n${cleanAssistantMessage.toString()}\n${makeToolMessage.toString()}\n${pinkieSplitTimelineMessage.toString()}\n${isFailedAssistantMessage.toString()}\n${failureDetail.toString()}\n${formatFailureSummary.toString()}\n${collapseFailedAssistantEntries.toString()}\n${timelineGroup.toString()}\n${resultParts.toString()}\n${attachToolResults.toString()}\n${isRealUserGroup.toString()}\n${timelineTimestamp.toString()}\n${collapseTimelineRows.toString()}\n${formatProcessDuration.toString()}\n${pinkieRunIsActive.toString()}\n${pinkieProcessTurnKey.toString()}\n${pinkieLearningInlineReferences.toString()}\n${projectTimelineTurn.toString()}\n${isCompactionEntry.toString()}\n${projectOrphanEntries.toString()}\n${pinkieBuildTimeline.toString()}`;
}

function withSessionMessageProgress(source) {
  if (source.includes('pinkieApplySessionMessage(e,t,r);')) return source;
  return replaceExactlyOnce(source,
    /(function\s+[\w$]+\(e,t\)\{let n=[\w$]+\(t\);if\(!n\|\|![\w$]+\(e,n\)\)return;let r=[\w$]+\(e,n\);)(?=r&&n\.archived!==null)/u,
    (match) => `${match}pinkieApplySessionMessage(e,t,r);`, 'selected session-message progress handler');
}

function withReceivedFinal(source) {
  // Remove the v12 receipt writer when upgrading; native history remains the
  // source of narration and standalone tool results (as in v8).
  if (source.includes('/* pinkie-history-reconcile:v1 */')) source = replaceExactlyOnce(source,
    'e.chatMessages=pinkieReconcileHistory(e,ql(f,c),u.sessionInfo?.sessionId||u.sessionId)/* pinkie-history-reconcile:v1 */,',
    'e.chatMessages=ql(f,c),', 'remove v12 history receipts');
  source = withToolStreamRendering(withScrollIntent(source));
  if (source.includes('n=pinkieAcceptFinalMessage(e,t,n);')) return source;
  return replaceExactlyOnce(source,
    /(else if\(t\.state===`final`\)\{let n=[\w$]+\(t\.message\);)(?=n&&!)/u,
    (match) => `${match}n=pinkieAcceptFinalMessage(e,t,n);`, 'accepted native final reply');
}

function withToolStreamRendering(source) {
  if (source.includes('/* pinkie-tool-stream-sync:v1 */')) return source;
  return replaceExactlyOnce(source,
    /(function\s+[\w$]+\(e\)\{e\.toolStreamSyncTimer!=null&&\(clearTimeout\(e\.toolStreamSyncTimer\),e\.toolStreamSyncTimer=null\),[\w$]+\(e\))(?=\})/u,
    '$1,e.requestUpdate?.()/* pinkie-tool-stream-sync:v1 */', 'deferred tool stream render');
}

function withScrollIntent(source) {
  if (source.includes('/* pinkie-scroll-intent:v1 */')) return source;
  return replaceExactlyOnce(source,
    '(u||l===`always`||l===`near-bottom`&&(d||!e.chatFollowLocked&&(e.chatUserNearBottom||n<Cc)))',
    '(u||l!==`off`&&!e.chatFollowLocked&&(e.chatUserNearBottom||n<Cc))/* pinkie-scroll-intent:v1 */',
    'delayed follow respects a newer user scroll');
}

/** Closed cards retain only their summary; Lit mounts rows on a user click. */
export function processBranchSource(groupName) {
  return `if(e&&e.isProcessCard)return s\`<div class="chat-group assistant chat-group--process" data-pinkie-process=\${e.key}><div class="chat-group-messages"><details class="pinkie-process" .open=\${pinkieProcessOpen(e)} data-live=\${e.processLive?\`1\`:\`0\`}><summary class="pinkie-process__summary" @click=\${n=>pinkieTimelineToggle(n,e.key)}><span class="pinkie-process__title">\${e.processTitle}</span><span class="pinkie-process__meta">\${e.processMeta}</span></summary>\${pinkieProcessOpen(e)?s\`<div class="pinkie-process__thinking" data-pinkie-thinking=\${e.key} .pinkieHistoryThinking=\${e.processThinking||\`\`} .pinkieLegacyKey=\${e.processLegacyKey||\`\`}></div><div class="pinkie-process__rows">\${e.processRows.map(n=>n.kind===\`group\`?${groupName}(n,t):c)}</div>\`:c}</details><div class="pinkie-process__status" data-pinkie-status=\${e.key} data-live=\${e.processLive?\`1\`:\`0\`} data-state=\${e.processState||\`\`}></div></div></div>\`;if(e&&e.isLearningCard)return s\`<div class="chat-group assistant chat-group--learning"><div class="chat-group-messages"><div class="pinkie-learning-inline-slot" data-pinkie-learning-slot=\${e.key} .pinkieLearningCards=\${e.learningCards||[]} .pinkieLearningSession=\${t?.sessionKey||\`\`}></div></div></div>\`;`;
}
export function overflowBranchSource(groupName) {
  return `if(e&&e.timelineOverflow)return s\`<details class="chat-timeline-overflow" .open=\${pinkieTimelineView(e.key).open}><summary @click=\${n=>pinkieTimelineToggle(n,e.key)}>前面还有 \${e.overflowCount} 步</summary>\${pinkieTimelineView(e.key).open?s\`<div class="chat-timeline-overflow__body">\${pinkieTimelineRows(e,e.overflowItems).map(n=>n.kind===\`group\`?${groupName}({...n,timelineOverflow:!1},t):c)}\${pinkieTimelineView(e.key).count<e.overflowItems.length?s\`<button type="button" @click=\${n=>pinkieTimelineMore(n,e.key)}>再显示前面 80 步</button>\`:c}</div>\`:c}</details>\`;`;
}

/** Add the process branch to a renderer patched by an older release. */
function withProcessBranch(source) {
  if (source.includes('e.isProcessCard')) {
    const renderer = /function\s+([\w$]+)\(e,t\)\{if\(e&&e\.isProcessCard\)/u.exec(source);
    if (!renderer) throw new Error('process-card renderer is missing');
    source = replaceExactlyOnce(source,
      /if\(e&&e\.isProcessCard\)return s`[\s\S]*?`;(?=if\(e&&e\.timelineOverflow\))/u,
      () => processBranchSource(renderer[1]), 'process-card renderer upgrade');
    return replaceExactlyOnce(source, /if\(e&&e\.timelineOverflow\)return s`[\s\S]*?`;(?=let n=U\(e\.role\))/, () => overflowBranchSource(renderer[1]), 'overflow renderer upgrade');
  }
  const match = /function\s+([\w$]+)\(e,t\)\{if\(e&&e\.timelineOverflow\)/u.exec(source);
  if (!match) throw new Error('timeline overflow renderer is missing');
  const at = match.index + match[0].length - 'if(e&&e.timelineOverflow)'.length;
  const output = source.slice(0, at) + processBranchSource(match[1]) + source.slice(at);
  return replaceExactlyOnce(output, /if\(e&&e\.timelineOverflow\)return s`[\s\S]*?`;(?=let n=U\(e\.role\))/, () => overflowBranchSource(match[1]), 'overflow renderer upgrade');
}

function withNativePresentation(source) {
  // This option belongs to the native boxed Reasoning renderer. The separate
  // laolao-process-card thinking stream and the model's reasoning tier are
  // unaffected. New tool bodies start folded; native expansion maps still
  // own later manual clicks.
  const policy = 'e={...e,showThinking:false,autoExpandToolCalls:false};';
  if (source.includes(policy)) return source;
  return replaceExactlyOnce(source,
    /(function\s+[\w$]+\(e\)\{)(?=let t=[\w$]+\(e\.paneId\),n=e\.onRequestUpdate)/u,
    (match) => `${match}${policy}`, 'native chat presentation options');
}

function withChatCompactionSlot(source) {
  if (source.includes('data-pinkie-compaction=')) return source;
  const main = /function\s+[\w$]+\(e\)\{e=\{\.\.\.e,showThinking:false,autoExpandToolCalls:false\};let t=[\w$]+\(e\.paneId\),n=e\.onRequestUpdate/u.exec(source);
  if (!main) throw new Error('native chat thread renderer is missing');
  const next = source.indexOf('function ', main.index + 9);
  const end = next < 0 ? source.length : next;
  const section = source.slice(main.index, end);
  const footer = /(\$\{[\w$]+\(e\)\})(\s*<\/div>\s*<\/div>\s*`)/u;
  const patched = replaceExactlyOnce(section, footer,
    (_match, footerCall, closing) => `<div class="pinkie-chat-compaction" data-pinkie-compaction=\${e.sessionKey}></div>\n        ${footerCall}${closing}`,
    'chat compaction status slot');
  return sourceWithReplacement(source, main.index, end, patched);
}

function withEarlierHistoryControl(source) {
  const main = /function\s+[\w$]+\(e\)\{e=\{\.\.\.e,showThinking:false,autoExpandToolCalls:false\};let t=[\w$]+\(e\.paneId\),n=e\.onRequestUpdate/u.exec(source);
  if (!main) throw new Error('native chat thread renderer is missing');
  const next = source.indexOf('function ', main.index + 9);
  const end = next < 0 ? source.length : next;
  const section = source.slice(main.index, end);
  const call = '${pinkieEarlierHistory(e)}';
  if (section.split(call).length > 2) throw new Error('legacy earlier-history control is duplicated');
  const clean = section.replace(call, '');
  const patched = replaceExactlyOnce(clean, '<div class="chat-thread-inner">',
    `<div class="chat-thread-inner">${call}`, 'legacy earlier-history control inside the transcript');
  return sourceWithReplacement(source, main.index, end, patched);
}

function withLegacyHistoryPagingContext(source) {
  const main = /function\s+[\w$]+\(e\)\{e=\{\.\.\.e,showThinking:false,autoExpandToolCalls:false\};let t=[\w$]+\(e\.paneId\),n=e\.onRequestUpdate/u.exec(source);
  if (!main) throw new Error('native chat thread renderer is missing');
  const next = source.indexOf('function ', main.index + 9);
  const end = next < 0 ? source.length : next;
  let section = source.slice(main.index, end);
  const oldProps = /([\w$]+)\(\{sessionKey:e\.sessionKey,messages:e\.messages,toolMessages:e\.toolMessages,streamSegments:e\.streamSegments,stream:[\w$.]+(?:\?\?null)?,streamStartedAt:e\.streamStartedAt,queue:e\.queue/u;
  const newProps = /([\w$]+)\(\{paneId:e\.paneId,pinkieHistoryRevision:pinkieLegacyHistoryView\(e\)\.revision\|\|0,sessionKey:e\.sessionKey/u;
  const match = oldProps.exec(section) || newProps.exec(section);
  if (!match) throw new Error('native history projection props are missing');
  const memoName = match[1];
  section = section.replace(oldProps, (_all, name) => `${name}({paneId:e.paneId,pinkieHistoryRevision:pinkieLegacyHistoryView(e).revision||0,sessionKey:e.sessionKey,messages:e.messages,toolMessages:e.toolMessages,streamSegments:e.streamSegments,stream:e.stream??null,streamStartedAt:e.streamStartedAt,queue:e.queue`);
  let output = sourceWithReplacement(source, main.index, end, section);
  const at = output.indexOf(`function ${memoName}(e){`);
  const memoEnd = output.indexOf('function ', at + 9);
  if (at < 0 || memoEnd < 0) throw new Error('native history projection cache is missing');
  const memo = output.slice(at, memoEnd);
  if (memo.includes('t.input.pinkieHistoryRevision===e.pinkieHistoryRevision')) return output;
  const patched = replaceExactlyOnce(memo,
    /(if\(t\.input&&[\w$]+\(t\.input,e\))\)return t\.items/u,
    '$1&&t.input.paneId===e.paneId&&t.input.pinkieHistoryRevision===e.pinkieHistoryRevision)return t.items',
    'native history paging cache key');
  return sourceWithReplacement(output, at, memoEnd, patched);
}

function withLoadedHistoryProjection(source) {
  const history = functionSection(source, 'Showing last ${c} messages');
  const renderLimitName = /let\s+[\w$]+\s*=\[\],[\w$]+\s*=([\w$]+)\(e\.historyRenderLimit\)/u.exec(history.text)?.[1];
  if (!renderLimitName) throw new Error('history render-limit call is missing');
  // This native helper limits the projection after messages and tool rows are
  // combined. Changing only the tail selector would still hide loaded pages.
  let output = replaceExactlyOnce(source,
    new RegExp(`function ${escapeRegExp(renderLimitName)}\\(e\\)\\{return (?:5|512|Infinity)\\}`, 'u'),
    `function ${renderLimitName}(e){return Infinity}`,
    'loaded history render limit');
  output = output.replace(/pinkieSelectMessageWindow\(e\.messages,([\w$]+),(?:512|Infinity)\)/gu,
    'pinkieSelectMessageWindow(e.messages,$1,e)');
  output = output.replace(/pinkieSelectMessageWindow\(e\.messages,([\w$]+)\)/gu,
    'pinkieSelectMessageWindow(e.messages,$1,e)');
  output = output.replace(/pinkieBuildTimeline\(__pinkieTimelineEntries,([\w$]+)(?:,80,e)?\)/gu,
    'pinkieBuildTimeline(__pinkieTimelineEntries,$1,80,e)');
  const current = functionSection(output, 'Showing last ${c} messages');
  if (!current.text.includes('e=pinkieHistoryRenderOptions(e);')) {
    const projected = current.text.replace(/^(function\s+[\w$]+\(e\)\{)/u, '$1e=pinkieHistoryRenderOptions(e);');
    output = sourceWithReplacement(output, current.start, current.end, projected);
  }
  const projected = functionSection(output, 'Showing last ${c} messages');
  if (!projected.text.includes('o=0,/* pinkie-paged-byte-budget */')) {
    const text = replaceExactlyOnce(projected.text, /o=[\w$]+\(r,e\.showToolCalls,n\),/u,
      'o=0,/* pinkie-paged-byte-budget */', 'native secondary history clipping');
    output = sourceWithReplacement(output, projected.start, projected.end, text);
  }
  return output;
}

function upgradeBundle(original, previousMarker) {
  const version = /:(v\d+) \*\/$/u.exec(previousMarker)?.[1] || 'old';
  try {
    const markerIndex = original.indexOf(previousMarker);
    if (markerIndex < 0 || original.indexOf(previousMarker, markerIndex + previousMarker.length) >= 0) {
      throw new Error(`cannot identify exactly one ${version} timeline runtime`);
    }
    const history = functionSection(original, 'Showing last ${c} messages');
    if (history.start <= markerIndex
        || !history.text.includes('pinkieBuildTimeline(__pinkieTimelineEntries,')) {
      throw new Error(`${version} history projection is missing`);
    }
    const runtime = `${marker}${splitRuntimeSource()}\n`;
    return {
      text: withLegacyHistoryPagingContext(withEarlierHistoryControl(withLoadedHistoryProjection(withReceivedFinal(withSessionMessageProgress(withChatCompactionSlot(withNativePresentation(withProcessBranch(sourceWithReplacement(original, markerIndex, history.start, runtime))))))))),
      changed: true,
      reason: `upgraded-${version}`,
    };
  } catch (error) {
    return {text: original, changed: false, reason: String(error?.message || error)};
  }
}

export function transform(original) {
  return transformBundle(String(original || '')).text;
}

export function transformWithStatus(original) {
  return transformBundle(String(original || ''));
}

/** Patch only live presentation in an installed legacy bundle. Learning slots,
 * protocol handlers, and all other native rendering remain byte-for-byte intact. */
export function transformLivePresentation(original) {
  if (original.includes('/* pinkie-live-process:v1 */')) return original;
  if (!original.includes('/* pinkie-chat-timeline:v24 */')) throw new Error('不是已验证的 v24 聊天渲染器，未覆盖');
  let source = original;
  source = replaceExactlyOnce(source, 'processLive: live,', 'processLive: live,\n    processCurrent: isLatestTurn,', 'latest process default');
  source = replaceExactlyOnce(source, '{...item, processLive: false, processState:', '{...item, processLive: false, processCurrent: false, processState:', 'historical page stays collapsed');
  const at = source.indexOf('function pinkieTimelineToggle('), end = source.indexOf('\nfunction ',at+9);
  if (at<0 || end<0) throw new Error('无法识别过程展开状态，未覆盖');
  source = source.slice(0,at)+pinkieTimelineToggle.toString()+source.slice(end);
  const pattern = /if\(e&&e\.isProcessCard\)return s`[\s\S]*?`;(?=if\(e&&e\.timelineOverflow\))/u;
  source = replaceExactlyOnce(source,pattern,branch=>{
    if (branch.split('pinkieTimelineView(e.key).open').length!==3) throw new Error('过程模板已变化，未覆盖');
    return branch.replaceAll('pinkieTimelineView(e.key).open','pinkieProcessOpen(e)');
  },'live process mounts as events arrive');
  source = source.replace('/* pinkie-chat-timeline:v24 */',marker+'\n/* pinkie-live-process:v1 */\n'+pinkieProcessOpen.toString()+'\n');
  return source;
}

function sourceWithReplacement(source, start, end, replacement) {
  return source.slice(0, start) + replacement + source.slice(end);
}

export function transformLearningInlineKinds(original) {
  const start = original.indexOf('function pinkieLearningInlineReferences(');
  const tail = 'return [...refs.values()];\n}';
  const end = original.indexOf(tail, start);
  if (start < 0 || end < start || original.indexOf('function pinkieLearningInlineReferences(', start + 1) >= 0) throw new Error('不能唯一定位消息内学习组件引用解析器');
  const section = original.slice(start, end + tail.length), pattern = /!\[([^\]]+)\]\.includes\(value\.kind\)/u;
  const match = section.match(pattern);
  if (!match) throw new Error('学习组件类型检查与预期不符');
  const kinds = JSON.parse('[' + match[1].replaceAll("'", '"') + ']');
  // 碧琪手账 v2：learning_desk 工具的三种卡片也走这个解析器。
  const wanted = ['memory_lab', 'device_lab', 'illustrated_guide', 'desk_card', 'desk_receipt', 'desk_plan'];
  const tool = "String(call.name || '').split('.').at(-1) !== 'learning_activity'";
  if (wanted.every(kind => kinds.includes(kind)) && !section.includes(tool)) return original;
  const next = [...new Set([...kinds, ...wanted])];
  const patched = section.replace(pattern, `![${next.map(v => JSON.stringify(v)).join(',')}].includes(value.kind)`)
    .replace(tool, "!['learning_activity', 'learning_desk'].includes(String(call.name || '').split('.').at(-1))");
  return original.slice(0, start) + patched + original.slice(end + tail.length);
}

function transformBundle(original) {
  if (original.includes(marker)) {
    if (!original.includes('function pinkieLearningInlineReferences(')) return {text: original, changed: false, reason: 'already-patched'};
    const text = transformLearningInlineKinds(original);
    return {text, changed: text !== original, reason: text === original ? 'already-patched' : 'learning-components-updated'};
  }
  const previousMarker = previousMarkers.find((value) => original.includes(value));
  if (previousMarker) return upgradeBundle(original, previousMarker);
  try {
    let source = original;
    const liPattern = /(function\s+([\w$]+)\(e\)\{)(?=if\(!e\|\|typeof e!=`object`\)return!1;let t=e;if\(O\(t\.role\)!==`assistant`)(?=[\s\S]{0,800}?hasVisibleNonTextContent)/gu;
    const liMatches = [...source.matchAll(liPattern)];
    if (liMatches.length !== 1) throw new Error('cannot identify the native internal-message filter');
    const controlFilter = `if(e&&typeof e==="object"&&String(e.role||"").toLowerCase()==="user"){let t=typeof e.content==="string"?e.content:Array.isArray(e.content)?e.content.map(e=>e&&typeof e.text==="string"?e.text:"").join(""):typeof e.text==="string"?e.text:"";let n=t.replace(/[\\u200B-\\u200D\\u2060\\u2063\\uFEFF]/gu,"").trim();if(e.__openclaw?.kind==="pending-send"||/^\\[pinkie-(?:watchdog|tier-control|tier)\\]/iu.test(n))return!0;let r=Array.isArray(e.content)&&e.content.some(e=>e&&typeof e==="object"&&(!e.type||!["text","input_text","output_text","thinking","reasoning"].includes(e.type)));let i=typeof e.MediaPath==="string"&&!!e.MediaPath.trim()||Array.isArray(e.MediaPaths)&&e.MediaPaths.some(e=>typeof e==="string"&&e.trim());if(!n&&!r&&!i)return!0}`;
    source = source.replace(liPattern, `$1${controlFilter}`);

    const history = functionSection(source, 'Showing last ${c} messages');
    const historyFunctionName = /^function\s+([\w$]+)\(/u.exec(history.text)?.[1];
    if (!historyFunctionName) throw new Error('history projection function name is missing');
    const renderLimitName = /let\s+[\w$]+\s*=\[\],[\w$]+\s*=([\w$]+)\(e\.historyRenderLimit\)/u.exec(history.text)?.[1];
    if (!renderLimitName) throw new Error('history render-limit call is missing');
    source = replaceExactlyOnce(source,
      new RegExp(`function ${escapeRegExp(renderLimitName)}\\(e\\)\\{return 5\\}`, 'u'),
      `function ${renderLimitName}(e){return ${HISTORY_RENDER_LIMIT}}`,
      'history render limit');

    const tailPattern = /r=\(\(\)=>\{let t=\[\],n=Array\.isArray\(e\.messages\)\?e\.messages:\[\];for\(let e=n\.length-1;e>=0&&t\.length<5;e--\)\{let r=n\[e\];([\w$]+)\(r\)\|\|t\.unshift\(r\)\}return t\}\)\(\),/gu;
    const historyNow = functionSection(source, 'Showing last ${c} messages');
    const tailMatches = [...historyNow.text.matchAll(tailPattern)];
    if (tailMatches.length !== 1) throw new Error('cannot identify the bounded native message tail');
    if (tailMatches[0][1] !== liMatches[0][2]) {
      throw new Error('native message window and internal-message filters do not agree');
    }
    source = source.replace(tailPattern,
      `r=pinkieSelectMessageWindow(e.messages,${liMatches[0][2]},e),`);

    const parserPattern = /function\s+[\w$]+\(e,t,n,r\)\{let a=e,o=typeof a\.role==`string`\?a\.role:`unknown`,l=U\(o\),u=([\w$]+)\(e\),d=U\(u\.role\)===`tool`,f=([\w$]+)\(e\),p=n\.showToolCalls\?\?!0\?([\w$]+)\(e,t\):\[\]/gu;
    const parserMatches = [...source.matchAll(parserPattern)];
    if (parserMatches.length !== 1) throw new Error('cannot identify native tool parser and renderer');
    const toolParserName = parserMatches[0][3];
    const messageRendererName = /([\w$]+)\(n\.message,n\.key,([\w$]+)\(e,n,r,t\),t\.onOpenSidebar\)/u.exec(source)?.[1];
    const renderContextName = /([\w$]+)\(n\.message,n\.key,([\w$]+)\(e,n,r,t\),t\.onOpenSidebar\)/u.exec(source)?.[2];
    if (!messageRendererName || !renderContextName) throw new Error('cannot identify the native grouped-message renderer');

    const timelineRuntime = `${marker}${splitRuntimeSource()}`;
    const functionNeedle = `function ${historyFunctionName}(`;
    source = replaceExactlyOnce(source, new RegExp(escapeRegExp(functionNeedle), 'gu'),
      `${timelineRuntime}\n${functionNeedle}`, 'history renderer insertion');

    const nestedPipeline = new RegExp(`return ([\\w$]+)\\(([\\w$]+)\\(([\\w$]+)\\(([\\w$]+)\\(([\\w$]+)\\(t,_\\)\\)\\)\\)\\)\\}`, 'gu');
    const currentHistory = functionSection(source, 'Showing last ${c} messages');
    const pipelineMatches = [...currentHistory.text.matchAll(nestedPipeline)];
    if (pipelineMatches.length !== 1) throw new Error('cannot identify native chronological grouping pipeline');
    const [, finish, group, dedupe, pairTools, sort] = pipelineMatches[0];
    const pipeline = `${finish}(${group}(${dedupe}(${pairTools}(${sort}(t,_)))))`;
    const replacement = `let __pinkieTimelineEntries=${pipeline};return pinkieBuildTimeline(__pinkieTimelineEntries,${toolParserName})}`;
    const sectionStart = currentHistory.start;
    const sectionText = currentHistory.text.replace(nestedPipeline, replacement);
    source = source.slice(0, sectionStart) + sectionText + source.slice(currentHistory.end);

    const groupPattern = /function\s+([\w$]+)\(e,t\)\{let n=U\(e\.role\),r=t\.assistantName/gu;
    const groupMatches = [...source.matchAll(groupPattern)];
    if (groupMatches.length !== 1) throw new Error('cannot identify the native message-group renderer');
    const groupName = groupMatches[0][1];
    const groupStart = groupMatches[0].index;
    const nextFunction = source.indexOf('function ', groupStart + 9);
    if (nextFunction < 0) throw new Error('message-group renderer boundary is missing');
    let groupSource = source.slice(groupStart, nextFunction);
    const overflowBranch = overflowBranchSource(groupName);
    groupSource = replaceExactlyOnce(groupSource,
      /function\s+[\w$]+\(e,t\)\{/gu,
      (match) => `${match}${processBranchSource(groupName)}${overflowBranch}`,
      'timeline overflow renderer');

    const callMatch = /if\(n===`tool`&&t\.showToolCalls===!1\)return c;/u;
    if (!callMatch.test(groupSource)) throw new Error('native tool-group visibility guard is missing');
    const toolBranch = `if(n===\`tool\`&&e.isTimelineStep){let d=e.messages.flatMap((n,r)=>pinkieSplitTimelineMessage(n,${toolParserName}).map((a,o)=>{let i={...n,message:a.message,key:a.key},u=${renderContextName}(e,i,r,t);return s\`<div class="\${a.role===\`tool\`?\`chat-timeline-tool-row\`:\`chat-timeline-text-row\`}">\${${messageRendererName}(a.message,a.key,u,t.onOpenSidebar)}</div>\`}));return s\`<div class="chat-group tool chat-group--timeline-step chat-group--timeline-tools"><div class="chat-group-messages">\${d}</div></div>\`}`;
    groupSource = replaceExactlyOnce(groupSource, callMatch, (match) => `${match}${toolBranch}`, 'flat tool-row renderer');

    const normalAssistant = /let d=e\.messages\.map\(e=>[\w$]+\(e\.message,t\.onOpenSidebar\)\),f=e\.messages\.length-1,p=d\[f\]\?\?null;/gu;
    const assistantMatches = [...groupSource.matchAll(normalAssistant)];
    if (assistantMatches.length !== 1) throw new Error('cannot identify the final assistant-message renderer');
    const interimBranch = `if(n===\`assistant\`&&e.isTimelineStep){let d=e.messages.map((n,r)=>${messageRendererName}(n.message,n.key,${renderContextName}(e,n,r,t),t.onOpenSidebar));return s\`<div class="chat-group assistant chat-group--timeline-step"><div class="chat-group-messages">\${d}</div></div>\`}`;
    groupSource = groupSource.replace(normalAssistant, `${interimBranch}${assistantMatches[0][0]}`);
    source = source.slice(0, groupStart) + groupSource + source.slice(nextFunction);

    const streamPattern = /function\s+([\w$]+)\(e,t=\{\}\)\{let\{onOpenSidebar:n,assistant:r,basePath:i,authToken:a\}=t/gu;
    const streamMatches = [...source.matchAll(streamPattern)];
    if (streamMatches.length !== 1) throw new Error('cannot identify the streaming-message renderer');
    const streamStart = streamMatches[0].index;
    const streamEnd = source.indexOf('function ', streamStart + 9);
    if (streamEnd < 0) throw new Error('streaming-message renderer boundary is missing');
    let streamSource = source.slice(streamStart, streamEnd);
    streamSource = replaceExactlyOnce(streamSource, '<div class="chat-group assistant">',
      '<div class="chat-group assistant \${e.some(e=>e.isTimelineStep)?`chat-group--timeline-step`:``}">',
      'streaming timeline class');
    streamSource = replaceExactlyOnce(streamSource, '\${hi(`assistant`,r,void 0,i,a)}',
      '\${e.some(e=>e.isTimelineStep)?c:hi(`assistant`,r,void 0,i,a)}',
      'streaming timeline avatar');
    streamSource = replaceExactlyOnce(streamSource, '\${u===null?c:s`',
      '\${u===null||e.some(e=>e.isTimelineStep)?c:s`',
      'streaming timeline footer');
    source = source.slice(0, streamStart) + streamSource + source.slice(streamEnd);

    return {text: withLegacyHistoryPagingContext(withEarlierHistoryControl(withLoadedHistoryProjection(withReceivedFinal(withSessionMessageProgress(withChatCompactionSlot(withNativePresentation(source))))))), changed: true, reason: 'patched'};
  } catch (error) {
    return {text: original, changed: false, reason: String(error?.message || error)};
  }
}



/* ---------------------------------------------------------------------------
 * OpenClaw 2026.10 port (control-ui-boot-chat-*.js).
 *
 * Every helper is minified differently on each build, so this port only uses
 * stable product facts:
 *   - `data-chat-row-key=${e.key}` identifies the message group being rendered,
 *   - `toolmsg:${t}` is the per-message tool card id,
 *   - `chat-group ${v} chat-group--with-footer…` marks a user/assistant group,
 *   - `chat-group tool chat-group--turn-block…` marks a tool preview block.
 * The native virtual list and lazy tool bodies own all child nodes. The skin
 * adds stable metadata and a tool-group class without moving Lit-owned nodes.
 * ------------------------------------------------------------------------- */
const currentMarker = '/* pinkie-chat-timeline-2026:v3 */';
const previousMetadataMarker = '/* pinkie-chat-timeline-2026:v2 */';
const previousCurrentMarker = '/* pinkie-chat-timeline-2026:v1 */';
const GROUP_ROW_KEY = 'data-chat-row-key=${e.key}';
const TOOL_BLOCK_HEAD = 'class="chat-group tool chat-group--turn-block';

export function currentTimelineCss() {
  // Native virtual-list layout and tool bodies must keep their own sizing.
  return `${currentMarker}\n`;
}

const previousCurrentCss = `/* pinkie-chat-timeline-2026:v1 */ #chat-messages{display:flex;flex-direction:column;gap:.35rem}
#chat-messages .chat-timeline-tool-row{display:flex;flex-direction:column;gap:.25rem;opacity:.92}
#chat-messages .chat-timeline-tool-row>.chat-bubble,#chat-messages .chat-timeline-tool-row>.chat-tool-card{margin:0}
#chat-messages .chat-group--timeline-tools .chat-tool-card> :first-child,#chat-messages .chat-timeline-tool-row .chat-tool-card> :first-child{margin-top:0}
`;

/** Native 2026.10 owns its virtual list and lazy tool bodies. Add metadata only. */
export function currentTimelineRuntimeSource() {
  return `function __pkTimelineGroupId(key) {
  return "turn-" + String(key == null ? "" : key).replace(/[^\\w:-]/g, "_");
}`;
}

/** Status variant used by apply(): DOM projection for 2026.10 renderers. */
export function transformCurrentWithStatus(original) {
  const originalText = String(original || '');
  let text = originalText;
  if (text.includes(currentMarker)) return {text, changed: false, reason: 'already-patched'};
  if (text.includes(previousMetadataMarker)) {
    const previous = `${previousMetadataMarker}\n${currentTimelineRuntimeSource()}\n`;
    if (!text.includes(previous)) return {text: originalText, changed: false, reason: 'previous metadata runtime is incomplete'};
    text = text.replace(previous, '');
  }
  if (text.includes(previousCurrentMarker)) {
    // Remove the v1 observer/mover as one recognized span. Never touch native
    // virtual-list or tool renderer code when upgrading an installed bundle.
    const start = text.indexOf(previousCurrentMarker);
    const tail = 'export default __pkTimelineInstall;';
    const end = text.indexOf(tail, start);
    if (end < 0) return {text, changed: false, reason: 'previous timeline runtime is incomplete'};
    text = text.slice(0, start) + text.slice(end + tail.length);
    text = text.replace('\${(globalThis.__pkTimelineRoot??=globalThis.document?.body,globalThis.document?.body?__pkTimelineInstall(globalThis.__pkTimelineRoot):"")}', '');
  }

  const groupKey = /chat-group--with-footer[\s\S]{0,400}?data-chat-row-key=\$\{e\.key\}/u;
  const match = groupKey.exec(text);
  if (!match) return {text: originalText, changed: false, reason: 'chat group row key not found'};
  const keyAt = match.index + match[0].lastIndexOf(GROUP_ROW_KEY);
  let output = text;
  if (!text.includes('data-timeline-group-id=${__pkTimelineGroupId(e.key)}')) {
    output = text.slice(0, keyAt + GROUP_ROW_KEY.length)
      + `\n      data-timeline-group-id=\${__pkTimelineGroupId(e.key)}`
      + text.slice(keyAt + GROUP_ROW_KEY.length);
  }

  if (!output.includes(TOOL_BLOCK_HEAD + ' chat-group--timeline-tools') && output.split(TOOL_BLOCK_HEAD).length === 2) {
    output = output.replace(TOOL_BLOCK_HEAD, `${TOOL_BLOCK_HEAD} chat-group--timeline-tools`);
  }
  // The native virtualizer continues to own the row. Only an empty, stable
  // child slot is added; the learning renderer owns that slot's children.
  output = output.replace(/(<div\s+class="chat-group tool chat-group--turn-block[^"\n]*"[^>]{0,900}>\s*<div class="chat-group-messages">)/gu, (opening) => {
    return `${opening}<div class="pinkie-learning-inline-slot" data-pinkie-learning-slot=\${e?.key||e?.[0]?.key} .pinkieLearningSource=\${e}></div>`;
  });
  // Single tool messages use the ordinary group renderer. Aggregate work and
  // activity groups also have a continuation branch with no outer group div.
  // Keep the owned slot outside their lazy/collapsed body in both branches.
  const slot = '<div class="pinkie-learning-inline-slot" data-pinkie-learning-slot=${e?.key||e?.[0]?.key} .pinkieLearningSource=${e}></div>';
  output = output.replace(/(class="chat-group \$\{[^]{0,1000}?chat-group--with-footer[^]{0,1000}?data-chat-row-key=\$\{e\.key\}[^]{0,600}?<div class="chat-group-messages">)/u, `$1${slot}`);
  output = output.replace(/return ([\w$]+)\.presentation===`continuation`\?([\w$]+):([\w$]+)`(\s*<div\s+class="chat-group tool chat-group--turn-block chat-group--work")/u,
    (_, options, body, html, opening) => `return ${options}.presentation===\`continuation\`?${html}\`${slot}\${${body}}\`:${html}\`${opening}`);
  output = output.replace(/return ([\w$]+)===`continuation`\?([\w$]+):([\w$]+)`(\s*<div\s+class="chat-group tool chat-group--turn-block chat-group--activity[^"\n]*")/u,
    (_, presentation, body, html, opening) => `return ${presentation}===\`continuation\`?${html}\`${slot}\${${body}}\`:${html}\`${opening}`);
  const head = /\/\/#region [^\n]*\n?/u.exec(output);
  const at = head ? head.index : 0;
  output = `${output.slice(0, at)}${currentMarker}\n${currentTimelineRuntimeSource()}\n${output.slice(at)}`;
  return {text: output, changed: true, reason: 'patched-2026'};
}

/** 2026.10: keep native virtualization and mark groups without moving nodes. */
function applyCurrent(root, file, name, {backupRoot} = {}) {
  const original = fs.readFileSync(file, 'utf8');
  const result = transformCurrentWithStatus(original);
  if (!result.changed) return {changed: false, skipped: true, reason: result.reason, file: name};
  if (fs.readFileSync(file, 'utf8') !== original) return {changed: false, skipped: true, reason: 'chat chunk changed while patching', file: name};
  const backupBase = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SuperPinkie', 'backups')
    : path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups');
  const backup = backupRoot || path.join(backupBase, `chat-timeline-${Date.now()}`);
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, name));
  fs.writeFileSync(file, result.text);
  refreshPrecompressed(file);
  // The projection's CSS travels with the skin stylesheet: no markup or inline
  // style is added to the transcript itself.
  const css = path.join(root, 'dist', 'control-ui', 'laolao-theme.css');
  if (fs.existsSync(css)) {
    const sheet = fs.readFileSync(css, 'utf8').replace(previousCurrentCss, '');
    if (!sheet.includes(currentMarker)) {
      fs.writeFileSync(css, `${sheet}\n${currentTimelineCss()}`);
      refreshPrecompressed(css);
    }
  }
  return {changed: true, backup, file: name, mode: '2026-dom'};
}

export function apply(root, {backupRoot} = {}) {
  const assets = path.join(root, 'dist', 'control-ui', 'assets');
  if (!fs.existsSync(assets) || !fs.statSync(assets).isDirectory()) {
    return {changed: false, skipped: true, reason: 'native chat assets not found'};
  }
  const files = fs.readdirSync(assets);
  const legacyChunks = files.filter((name) => /^chat-page-[\w-]+\.js$/u.test(name));
  // 2026.10 renderer chunk: control-ui-boot-chat-*.js without the style shard.
  // Native 2026.10 virtualizes messages; only metadata is patched.
  const currentChunks = files.filter((name) => /^control-ui-boot-chat-(?!styles)[\w-]+\.js$/u.test(name)
    && fs.readFileSync(path.join(assets, name), 'utf8').includes(GROUP_ROW_KEY));
  if (!legacyChunks.length && currentChunks.length === 1) {
    return applyCurrent(root, path.join(assets, currentChunks[0]), currentChunks[0], {backupRoot});
  }
  const candidates = legacyChunks;
  if (candidates.length !== 1) {
    return {changed: false, skipped: true, reason: `expected one chat-page chunk, found ${candidates.length}`};
  }
  const file = path.join(assets, candidates[0]);
  const original = fs.readFileSync(file, 'utf8');
  const result = transformBundle(original);
  if (!result.changed) return {changed: false, skipped: true, reason: result.reason, file: candidates[0]};
  if (fs.readFileSync(file, 'utf8') !== original) {
    return {changed: false, skipped: true, reason: 'chat-page chunk changed while patching', file: candidates[0]};
  }
  const backupBase = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SuperPinkie', 'backups')
    : path.join(os.homedir(), 'Library/Application Support/SuperPinkie/backups');
  const backup = backupRoot || path.join(backupBase, `chat-timeline-${Date.now()}`);
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, candidates[0]));
  fs.writeFileSync(file, result.text);
  return {changed: true, backup, file: candidates[0]};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error('OPENCLAW_ROOT is required');
  console.log(JSON.stringify(apply(root, {
    backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined,
  })));
}
