/**
 * Patch the native Control UI chat renderer so the latest user turn is a
 * bounded, chronological timeline. The patch is structural and all-or-nothing:
 * an upstream bundle that no longer matches is left byte-for-byte untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const marker = '/* pinkie-chat-timeline:v1 */';
export const MAX_TIMELINE_ROWS = 80;
export const LIVE_MESSAGE_WINDOW = 512;
export const HISTORY_RENDER_LIMIT = 512;

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

/** Keep a bounded tail while retaining the real user turn boundary if needed. */
export function pinkieSelectMessageWindow(messages = [], shouldSkip = () => false, limit = 512) {
  const source = Array.isArray(messages) ? messages : [];
  const bound = Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 512);
  const selected = [];
  const hasUser = () => selected.some((message) =>
    String(message?.role || '').toLowerCase() === 'user');
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (selected.length >= bound && hasUser()) break;
    const message = source[index];
    if (shouldSkip(message)) continue;
    if (selected.length < bound) {
      selected.unshift(message);
      continue;
    }
    if (String(message?.role || '').toLowerCase() === 'user') {
      selected.unshift(message);
      break;
    }
  }
  return selected;
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

function makeToolMessage(message, content, call = {}) {
  const name = String(call.name || message.toolName || message.tool_name || 'tool');
  const callId = String(call.callId || message.toolCallId || message.tool_call_id || '');
  const result = {...message, role: 'assistant', toolName: name, content};
  if (callId) result.toolCallId = callId;
  delete result.tool_name;
  delete result.tool_call_id;
  delete result.toolUseId;
  delete result.tool_use_id;
  return result;
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
        relatedResults.push(candidate);
        consumedResults.add(resultIndex);
        if (callId) break;
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

  return rows.length ? rows : [{role: 'assistant', message, key}];
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

/** Pure timeline projection, also exercised directly by unit tests. */
export function pinkieBuildTimeline(entries = [], getToolCalls = () => [], maxRows = 80) {
  const safeEntries = entries.flatMap((item) => {
    if (item?.kind !== 'group' || String(item.role || '').toLowerCase() !== 'user') return [item];
    const messages = (item.messages || []).filter((entry) => !isInternalUserMessage(entry?.message || {}));
    return messages.length ? [{...item, messages}] : [];
  });
  const userIndex = safeEntries.findLastIndex((item) => item?.kind === 'group'
    && String(item.role || '').toLowerCase() === 'user'
    && (item.messages || []).some((entry) => !isInternalUserMessage(entry?.message || {})));
  if (userIndex < 0) return safeEntries;

  let lastToolIndex = -1;
  for (let index = userIndex + 1; index < safeEntries.length; index += 1) {
    const item = safeEntries[index];
    if (item?.kind === 'group' && String(item.role || '').toLowerCase() === 'tool') lastToolIndex = index;
  }
  let finalAssistantIndex = -1;
  for (let index = userIndex + 1; index < safeEntries.length; index += 1) {
    const item = safeEntries[index];
    if (item?.kind === 'group' && String(item.role || '').toLowerCase() === 'assistant'
        && (lastToolIndex < 0 || index > lastToolIndex)) finalAssistantIndex = index;
  }

  const turn = [safeEntries[userIndex]];
  for (let index = userIndex + 1; index < safeEntries.length; index += 1) {
    const item = safeEntries[index];
    if (item?.kind !== 'group') {
      turn.push(item?.kind === 'stream' || item?.kind === 'reading-indicator'
        ? {...item, isTimelineStep: true}
        : item);
      continue;
    }
    const role = String(item.role || '').toLowerCase();
    if (role === 'assistant' && index === finalAssistantIndex) {
      turn.push(item);
      continue;
    }
    if (role !== 'assistant' && role !== 'tool') {
      turn.push(item);
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
        turn.push(timelineGroup(item, {...part, entry: augmented}));
      }
    }
  }

  const prefix = safeEntries.slice(Math.max(0, userIndex - 16), userIndex);
  const rowLimit = Math.max(4, Number.isFinite(maxRows) ? Math.floor(maxRows) : 80);
  if (turn.length > rowLimit) {
    const trailingRows = rowLimit - 2;
    const hiddenEnd = turn.length - trailingRows;
    const hidden = turn.slice(1, hiddenEnd);
    const overflow = {
      kind: 'group',
      key: `pinkie:timeline:overflow:${turn[0]?.key || 'turn'}`,
      role: 'assistant',
      messages: [],
      timestamp: turn[0]?.timestamp ?? Date.now(),
      timelineOverflow: true,
      overflowItems: hidden,
      overflowCount: hidden.length,
    };
    return [...prefix, turn[0], overflow, ...turn.slice(-trailingRows)];
  }
  return [...prefix, ...turn];
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
  return `${userText.toString()}\n${hasVisibleUserPayload.toString()}\n${isInternalUserMessage.toString()}\n${pinkieSelectMessageWindow.toString()}\n${partType.toString()}\n${partCallId.toString()}\n${isToolCallPart.toString()}\n${isToolResultPart.toString()}\n${textParts.toString()}\n${cleanAssistantMessage.toString()}\n${makeToolMessage.toString()}\n${pinkieSplitTimelineMessage.toString()}\n${timelineGroup.toString()}\n${resultParts.toString()}\n${attachToolResults.toString()}\n${pinkieBuildTimeline.toString()}`;
}

function transformBundle(original) {
  if (original.includes(marker)) return {text: original, changed: false, reason: 'already-patched'};
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
      `r=pinkieSelectMessageWindow(e.messages,${liMatches[0][2]},${LIVE_MESSAGE_WINDOW}),`);

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
    const overflowBranch = `if(e&&e.timelineOverflow)return s\`<details class="chat-timeline-overflow"><summary>前面还有 \${e.overflowCount} 步</summary><div class="chat-timeline-overflow__body">\${e.overflowItems.map(n=>n.kind===\`group\`?${groupName}({...n,timelineOverflow:!1},t):n.kind===\`stream\`?${groupName}({kind:\`group\`,role:\`assistant\`,key:n.key,messages:[{message:{role:\`assistant\`,content:[{type:\`text\`,text:n.text}],timestamp:n.startedAt},key:n.key}],timestamp:n.startedAt,isTimelineStep:!0},t):c)}</div></details>\`;`;
    groupSource = replaceExactlyOnce(groupSource,
      /function\s+[\w$]+\(e,t\)\{/gu,
      (match) => `${match}${overflowBranch}`,
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

    return {text: source, changed: true, reason: 'patched'};
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

export function apply(root, {backupRoot} = {}) {
  const assets = path.join(root, 'dist', 'control-ui', 'assets');
  if (!fs.existsSync(assets) || !fs.statSync(assets).isDirectory()) {
    return {changed: false, skipped: true, reason: 'native chat assets not found'};
  }
  const candidates = fs.readdirSync(assets).filter((name) => /^chat-page-[\w-]+\.js$/u.test(name));
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
