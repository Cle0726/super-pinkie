import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply, pinkieBuildTimeline, pinkieSelectMessageWindow, pinkieSplitTimelineMessage, transform, transformWithStatus} from '../patch/apply-chat-timeline.mjs';

const message = (role, content, id) => ({role, content, timestamp: 1, __openclaw: {id}});
const group = (role, key, messages) => ({
  kind: 'group', key, role, timestamp: 1,
  messages: messages.map((entry, index) => ({message: entry, key: `${key}:${index}`})),
});
// A turn's steps now live inside one process card; expand it back into rows.
const flat = (timeline) => timeline.flatMap((item) => (item.isProcessCard ? item.processRows : [item]));

function parseToolRows(value) {
  const content = Array.isArray(value.content) ? value.content : [];
  const calls = [];
  for (const part of content) {
    const type = String(part?.type || '').toLowerCase().replace(/[_-]/g, '');
    const id = String(part?.callId || part?.id || value.toolCallId || '');
    if (type === 'toolcall' || type === 'tooluse') {
      calls.push({callId: id, name: part.name, args: part.arguments ?? part.args});
    } else if (type === 'toolresult') {
      let call = calls.find((item) => item.callId && item.callId === id);
      if (!call) {
        call = {callId: id, name: part.name};
        calls.push(call);
      }
      call.outputText = part.text;
      call.isError = part.isError;
    }
  }
  return calls;
}

test('the current user turn is split into chronological text and single-tool rows', () => {
  const entries = [
    group('user', 'image-only-user', [message('user', [{type: 'image', url: 'media://photo'}], 'image-only-user')]),
    group('user', 'old-user', [message('user', 'earlier question', 'old-user')]),
    group('assistant', 'old-assistant', [message('assistant', 'earlier answer', 'old-assistant')]),
    group('user', 'current-user', [message('user', 'please inspect this', 'current-user')]),
    group('user', 'watchdog', [message('user', '\u2063', 'watchdog')]),
    group('user', 'tier-control', [message('user', '[pinkie-tier-control] continue', 'tier-control')]),
    group('assistant', 'progress', [message('assistant', '我先检查两个入口的调用方式。', 'progress')]),
    group('tool', 'tools', [
      message('assistant', [
        {type: 'text', text: '先核对实现和测试。'},
        {type: 'tool_call', callId: 'read-1', name: 'read', arguments: {path: 'src/app.js'}},
        {type: 'tool_call', callId: 'exec-1', name: 'exec', arguments: {command: 'npm test'}},
      ], 'tool-calls'),
      message('tool', [{type: 'tool_result', callId: 'read-1', name: 'read', text: 'source'}], 'read-result'),
      message('tool', [{type: 'tool_result', callId: 'exec-1', name: 'exec', text: 'ok'}], 'exec-result'),
    ]),
    group('assistant', 'final', [message('assistant', '改动已完成。', 'final')]),
  ];

  const timeline = flat(pinkieBuildTimeline(entries, parseToolRows));
  assert.equal(timeline.some((item) => item.key === 'image-only-user'), true);
  assert.equal(timeline.some((item) => item.key === 'watchdog' || item.key === 'tier-control'), false);
  const current = timeline.findIndex((item) => item.key === 'current-user');
  assert.ok(current >= 0);
  const rows = timeline.slice(current + 1);
  assert.deepEqual(rows.map((item) => item.role), ['assistant', 'assistant', 'tool', 'tool', 'assistant']);
  assert.match(rows[1].messages[0].message.content[0].text, /核对实现/);
  // Tool identity lives only in the content parts; a top-level toolName would
  // make the native renderer add its generic "Tool output" card label.
  assert.equal(rows[2].messages[0].message.toolName, undefined);
  assert.equal(rows[2].messages[0].message.content[0].name, 'read');
  assert.equal(rows[3].messages[0].message.content[0].name, 'exec');
  assert.equal(rows[2].messages[0].message.content.some((part) => part.type === 'tool_result'), true);
  assert.equal(rows[3].messages[0].message.content.some((part) => part.type === 'tool_result'), true);
  assert.equal(rows.slice(0, -1).every((item) => item.isTimelineStep === true), true);
  assert.equal(rows.at(-1).isTimelineStep, undefined);
});

test('a window that starts inside a task puts the orphaned prefix in a process card', () => {
  const compaction = group('system', 'compact', [message('system', 'Compaction', 'compact')]);
  compaction.messages[0].message.__openclaw.kind = 'compaction';
  const entries = [
    group('assistant', 'orphan-note', [message('assistant', '我接着核对剩下的内容。', 'orphan-note')]),
    group('tool', 'orphan-tools', [
      message('assistant', [{type: 'tool_call', callId: 'orphan-read', name: 'read', arguments: {path: 'a.md'}}], 'orphan-call'),
      message('toolResult', [{type: 'tool_result', callId: 'orphan-read', name: 'read', text: 'ok'}], 'orphan-result'),
    ]),
    compaction,
    group('tool', 'orphan-tail', [message('toolResult', [{type: 'tool_result', name: 'read', text: 'more'}], 'orphan-tail')]),
    group('user', 'visible-user', [message('user', '继续往下做', 'visible-user')]),
    group('assistant', 'visible-final', [message('assistant', '完成啦。', 'visible-final')]),
  ];

  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  const firstCard = timeline.find((item) => item.isProcessCard);
  assert.equal(firstCard?.processTitle, '接着之前的工作');
  assert.deepEqual(firstCard?.processRows.map((row) => row.role), ['assistant', 'tool']);
  const projectedCompaction = timeline.find((item) => item.key === 'compact');
  assert.equal(projectedCompaction?.messages[0].message.__openclaw.kind, 'compaction');
  assert.equal(timeline.some((item) => item.key === 'orphan-tail'), false);
  assert.equal(timeline.some((item) => item.key === 'visible-user'), true);
  assert.equal(timeline.some((item) => item.isProcessCard && item.processRows.some((row) => row.key === 'orphan-tail:0')), true);
});

test('an incomplete historical tool turn is marked stopped instead of live', () => {
  const entries = [
    group('user', 'interrupted-user', [message('user', '请继续检查', 'interrupted-user')]),
    group('tool', 'interrupted-tool', [message('assistant', [
      {type: 'tool_call', callId: 'unfinished', name: 'exec', arguments: {command: 'check'}},
    ], 'unfinished-call')]),
  ];
  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  const card = timeline.find((item) => item.isProcessCard);
  assert.equal(card.processLive, false);
  assert.equal(card.processState, 'oops');
  assert.equal(card.processTitle, '这一轮停下来了');
  assert.match(card.processMeta, /已中断/u);
});

test('an active orphaned tail stays live while keeping the continuation title', () => {
  const previousRuns = globalThis.__pinkieActiveChatRuns;
  const previousLocation = globalThis.location;
  globalThis.__pinkieActiveChatRuns = new Map([['agent:active-tail', true]]);
  globalThis.location = {search: '?session=agent%3Aactive-tail'};
  try {
    const timeline = pinkieBuildTimeline([
      group('tool', 'active-orphan', [message('assistant', [
        {type: 'tool_call', callId: 'active-tail-call', name: 'exec', arguments: {command: 'check'}},
      ], 'active-tail-call')]),
    ], parseToolRows);
    const card = timeline.find((item) => item.isProcessCard);
    assert.equal(card.processLive, true);
    assert.equal(card.processState, '');
    assert.equal(card.processTitle, '接着之前的工作');
    assert.match(card.processMeta, /已做 1 步/u);
    assert.doesNotMatch(card.processMeta, /已中断/u);
  } finally {
    if (previousRuns === undefined) delete globalThis.__pinkieActiveChatRuns;
    else globalThis.__pinkieActiveChatRuns = previousRuns;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});

test('repeated model failures become one Chinese line and keep no English placeholder', () => {
  const entries = [];
  for (let index = 0; index < 3; index += 1) {
    entries.push(group('user', `failure-user-${index}`, [message('user', '再试一次', `failure-user-${index}`)]));
    entries.push(group('assistant', `failure-${index}`, [{
      ...message('assistant', '[assistant turn failed before producing content]', `failure-${index}`),
      stopReason: 'error', errorMessage: '503 模型上游暂时没有回应，请稍后再试。',
    }]));
  }
  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  const failures = timeline.flatMap((item) => item.messages || [])
    .map((wrapped) => wrapped.message).filter((message) => message.__pinkieFailureSummary);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].__pinkieFailureCount, 3);
  assert.equal(failures[0].content[0].text,
    '这次没连上模型：503 模型上游暂时没有回应，请稍后再试。（连续 3 次）');
  assert.equal(failures[0].stopReason, undefined);
  assert.doesNotMatch(JSON.stringify(timeline), /assistant turn failed before producing content/u);
});

test('assistant messages containing only thoughts or no content leave no blank bubble', () => {
  assert.deepEqual(pinkieSplitTimelineMessage({
    key: 'thought-only',
    message: message('assistant', [{type: 'thinking', thinking: 'private'}], 'thought-only'),
  }), []);
  const timeline = pinkieBuildTimeline([
    group('user', 'blank-user', [message('user', '继续', 'blank-user')]),
    group('assistant', 'blank-thinking', [message('assistant', [{type: 'reasoning', text: 'private'}], 'blank-thinking')]),
    group('assistant', 'blank-message', [message('assistant', '', 'blank-message')]),
  ], parseToolRows);
  assert.deepEqual(timeline.map((item) => item.key), ['blank-user']);
});

test('older real turns use the same timeline rows and internal user messages do not split them', () => {
  const entries = [
    group('user', 'first-user', [message('user', '先完成第一件事', 'first-user')]),
    group('tool', 'first-tools', [
      message('assistant', [
        {type: 'text', text: '我先查第一轮的资料。'},
        {type: 'tool_call', callId: 'first-read', name: 'read', arguments: {path: 'first.md'}},
      ], 'first-call'),
      message('tool', [
        {type: 'tool_result', callId: 'first-read', name: 'read', text: 'first result'},
      ], 'first-result'),
    ]),
    group('user', 'watchdog-control', [message('user', '\u2063', 'watchdog-control')]),
    group('user', 'tier-control', [message('user', '[pinkie-tier-control] continue', 'tier-control')]),
    group('user', 'empty-control', [message('user', '', 'empty-control')]),
    group('assistant', 'first-final', [message('assistant', '第一轮已经完成。', 'first-final')]),
    group('user', 'second-user', [message('user', '再完成第二件事', 'second-user')]),
    group('assistant', 'second-final', [message('assistant', '第二轮已经完成。', 'second-final')]),
  ];

  const timeline = flat(pinkieBuildTimeline(entries, parseToolRows));
  const second = timeline.findIndex((item) => item.key === 'second-user');
  assert.ok(second > 0);
  assert.deepEqual(timeline.slice(0, second).map((item) => item.role), [
    'user', 'assistant', 'tool', 'assistant',
  ]);
  assert.equal(timeline.some((item) => /(?:watchdog|tier-control|empty-control)/u.test(item.key)), false);
  assert.equal(timeline[1].isTimelineStep, true);
  assert.equal(timeline[2].isTimelineStep, true);
  assert.equal(timeline[2].messages[0].message.content[0].name, 'read');
  assert.equal(timeline[2].messages[0].message.content.some((part) => part.type === 'tool_result'), true);
  assert.equal(timeline[3].key, 'first-final');
  assert.equal(timeline[3].isTimelineStep, undefined);
});

test('each historical turn has its own stable overflow row', () => {
  const entries = [group('user', 'old-user', [message('user', 'old long task', 'old-user')])];
  for (let index = 0; index < 100; index += 1) {
    entries.push(group('assistant', `old-step-${index}`, [
      message('assistant', `old step ${index}`, `old-step-${index}`),
    ]));
  }
  entries.push(group('user', 'latest-user', [message('user', 'new task', 'latest-user')]));
  entries.push(group('assistant', 'latest-final', [message('assistant', 'new answer', 'latest-final')]));

  const first = flat(pinkieBuildTimeline(entries, parseToolRows));
  const second = flat(pinkieBuildTimeline(entries, parseToolRows));
  const latest = first.findIndex((item) => item.key === 'latest-user');
  const oldRows = first.slice(0, latest);
  // user + overflow + 79 trailing steps + the final answer outside the card
  assert.equal(oldRows.length, 82);
  assert.equal(oldRows[1].timelineOverflow, true);
  assert.equal(oldRows[1].overflowCount, 20);
  assert.equal(oldRows[1].key, 'pinkie:timeline:overflow:old-user');
  assert.deepEqual(first.map((item) => item.key), second.map((item) => item.key));
});

test('stream and reading indicators are retained only for the latest real turn', () => {
  const entries = [
    group('user', 'old-user', [message('user', 'old task', 'old-user')]),
    {kind: 'stream', key: 'stale-stream', text: 'stale', startedAt: 2},
    {kind: 'reading-indicator', key: 'stale-reading'},
    group('assistant', 'old-final', [message('assistant', 'old answer', 'old-final')]),
    group('user', 'latest-user', [message('user', 'latest task', 'latest-user')]),
    {kind: 'stream', key: 'live-stream', text: 'live', startedAt: 3},
    {kind: 'reading-indicator', key: 'live-reading'},
    group('assistant', 'latest-final', [message('assistant', 'latest answer', 'latest-final')]),
  ];

  const projected = pinkieBuildTimeline(entries, parseToolRows);
  const timeline = flat(projected);
  assert.equal(timeline.some((item) => item.key === 'stale-stream' || item.key === 'stale-reading'), false);
  // The live reply streams below the card as a normal bubble.
  assert.equal(timeline.find((item) => item.key === 'live-stream')?.isTimelineStep, undefined);
  assert.equal(timeline.find((item) => item.key === 'live-reading')?.kind, 'reading-indicator');
  const live = projected.find((item) => item.isProcessCard);
  assert.equal(live?.key, 'pinkie:process:latest-user');
  assert.equal(live?.processLive, true);
  assert.equal(projected.filter((item) => item.isProcessCard).length, 1);
});

test('a user steer between a tool call and its result remains chronological without losing either tool step', () => {
  const entries = [
    group('user', 'first-user', [message('user', '先查旧方法', 'first-user')]),
    group('assistant', 'narrate', [message('assistant', '我先读现状。', 'narrate')]),
    group('tool', 'call', [message('assistant', [
      {type: 'tool_call', callId: 'read-1', name: 'read', arguments: {path: 'old.md'}},
    ], 'call')]),
    // This is an accepted `messages.queue: steer` user message. Its result
    // may land while the tool it interrupted is still finishing.
    group('user', 'steer-user', [message('user', '改成用 X 方法继续', 'steer-user')]),
    group('tool', 'result', [message('tool', [
      {type: 'tool_result', callId: 'read-1', name: 'read', text: '旧方法结果'},
    ], 'result')]),
    group('assistant', 'after-steer', [message('assistant', '按 X 方法继续。', 'after-steer')]),
    group('assistant', 'final', [message('assistant', '已经完成。', 'final')]),
  ];

  const first = flat(pinkieBuildTimeline(entries, parseToolRows));
  const second = flat(pinkieBuildTimeline(entries, parseToolRows));
  assert.deepEqual(first.map((item) => item.key), second.map((item) => item.key));
  assert.deepEqual(first.map((item) => item.key), [
    'first-user', 'narrate:0', 'call:0:timeline:tool:0', 'steer-user',
    'result:0', 'after-steer:0', 'final',
  ]);
  const call = first.find((item) => item.key === 'call:0:timeline:tool:0');
  const result = first.find((item) => item.key === 'result:0');
  assert.equal(call?.isTimelineStep, true);
  assert.equal(result?.isTimelineStep, true);
  assert.equal(call?.role, 'tool');
  assert.equal(result?.role, 'tool');
  assert.equal(first.find((item) => item.key === 'after-steer:0')?.isTimelineStep, true);
  assert.equal(first.find((item) => item.key === 'final')?.isTimelineStep, undefined);
});

test('messages mixing prose and multiple tool calls split in source order', () => {
  const source = {
    message: message('assistant', [
      {type: 'text', text: '先读取配置。'},
      {type: 'tool_call', callId: 'a', name: 'read', arguments: {path: 'a.json'}},
      {type: 'text', text: '再查日志。'},
      {type: 'tool_call', callId: 'b', name: 'exec', arguments: {command: 'tail log'}},
    ], 'mixed'),
    key: 'mixed-entry',
  };
  const rows = pinkieSplitTimelineMessage(source, parseToolRows);
  assert.deepEqual(rows.map((row) => row.role), ['assistant', 'tool', 'assistant', 'tool']);
  assert.deepEqual(rows.map((row) => row.key), [
    'mixed-entry:timeline:text:0',
    'mixed-entry:timeline:tool:1',
    'mixed-entry:timeline:text:2',
    'mixed-entry:timeline:tool:3',
  ]);
});

test('turns beyond 80 rows collapse older steps into one expandable row', () => {
  const entries = [group('user', 'turn-user', [message('user', 'long task', 'turn-user')])];
  for (let index = 0; index < 100; index += 1) {
    entries.push(group('assistant', `step-${index}`, [message('assistant', `step ${index}`, `step-${index}`)]));
  }
  const timeline = flat(pinkieBuildTimeline(entries, parseToolRows));
  const start = timeline.findIndex((item) => item.key === 'turn-user');
  const rows = timeline.slice(start);
  assert.equal(rows.length, 82);
  assert.equal(rows[1].timelineOverflow, true);
  assert.equal(rows[1].overflowCount, 20);
  assert.equal(rows.at(-1).messages[0].message.content, 'step 99');
  const renderer = fs.readFileSync(new URL('../patch/apply-chat-timeline.mjs', import.meta.url), 'utf8');
  assert.match(renderer, /<details class="chat-timeline-overflow">/);
});

test('a long bounded message tail still includes its real user-turn boundary', () => {
  const messages = [
    message('user', 'long task', 'turn-user'),
    ...Array.from({length: 519}, (_, index) => message('assistant', `step ${index}`, `step-${index}`)),
  ];
  const selected = pinkieSelectMessageWindow(messages, () => false, 512);
  assert.equal(selected.length, 513);
  assert.equal(selected[0].__openclaw.id, 'turn-user');
  assert.deepEqual(selected.slice(1).map((item) => item.__openclaw.id),
    messages.slice(-512).map((item) => item.__openclaw.id));
});

const bundleFixture = `
function Li(e){if(!e||typeof e!=\`object\`)return!1;let t=e;if(O(t.role)!==\`assistant\`||typeof t.senderLabel==\`string\`)return!1;let{text:n,hasVisibleNonTextContent:r}=Ii(t.content);return r?!1:Pi(n).shouldSkip}
function mi(e){return e}
function ei(e){return false}
function lb(e,t){return []}
function aC(e,t,n,r){let a=e,o=typeof a.role==\`string\`?a.role:\`unknown\`,l=U(o),u=mi(e),d=U(u.role)===\`tool\`,f=ei(e),p=n.showToolCalls??!0?lb(e,t):[]}
function gS(e,n,r,t){return {}}
function rC(e,t){return null}
function Zb(e){return 5}function Qb(e,t,n){let r=0,i=0,a=e.length;return a}function $b(e){let t=[],n=Zb(e.historyRenderLimit),r=(()=>{let t=[],n=Array.isArray(e.messages)?e.messages:[];for(let e=n.length-1;e>=0&&t.length<5;e--){let r=n[e];Li(r)||t.unshift(r)}return t})(),i=Array.isArray(e.toolMessages)?e.toolMessages:[],a=i.map(e=>e).filter(e=>!!e);if(false)t.push({message:{content:\`Showing last \u0024{c} messages\`}});return Tb(bb(Fb(Sb(Ub(t,_)))))}function afterHistory(){return null}
function _S(e,t){let n=U(e.role),r=t.assistantName??\`Assistant\`;if(n===\`tool\`&&t.showToolCalls===!1)return c;if(n===\`tool\`&&e.messages.length>1){return c}let d=e.messages.map(e=>rC(e.message,t.onOpenSidebar)),f=e.messages.length-1,p=d[f]??null;return s\`\u0024{aC(n.message,n.key,gS(e,n,r,t),t.onOpenSidebar)}\`}
function hS(e,t={}){let{onOpenSidebar:n,assistant:r,basePath:i,authToken:a}=t,o=r?.name??\`Assistant\`,l=e.flatMap(e=>e.kind===\`stream\`?[e.startedAt]:[]),u=l.length>0?Math.min(...l):null;return s\`
<div class="chat-group assistant">
  \u0024{hi(\`assistant\`,r,void 0,i,a)}
  <div class="chat-group-messages">\u0024{u===null?c:s\`<div class="chat-group-footer">\u0024{zx(u)}</div>\`}</div>
</div>\`}
function afterStreaming(){return null}
`;

// A compact fixture for the runtime shape emitted by the released v1 patch.
// Its prefix branch is the behavior this upgrade must replace, not preserve.
const legacyV1BuildTimeline = `function pinkieBuildTimeline(entries = [], getToolCalls = () => [], maxRows = 80) {
  const safeEntries = entries.flatMap((item) => {
    if (item?.kind !== 'group' || String(item.role || '').toLowerCase() !== 'user') return [item];
    const messages = (item.messages || []).filter((entry) => !isInternalUserMessage(entry?.message || {}));
    return messages.length ? [{...item, messages}] : [];
  });
  const userIndex = safeEntries.findLastIndex((item) => item?.kind === 'group'
    && String(item.role || '').toLowerCase() === 'user'
    && (item.messages || []).some((entry) => !isInternalUserMessage(entry?.message || {})));
  if (userIndex < 0) return safeEntries;
  const prefix = safeEntries.slice(Math.max(0, userIndex - 16), userIndex);
  return [...prefix, ...safeEntries.slice(userIndex)];
}`;

function asOlderBundle(currentBundle, version) {
  return currentBundle.replace('/* pinkie-chat-timeline:v5 */', `/* pinkie-chat-timeline:${version} */`);
}

function asLegacyV1Bundle(v4Bundle) {
  const v2Bundle = asOlderBundle(v4Bundle, 'v2');
  const v2Marker = '/* pinkie-chat-timeline:v2 */';
  const markerIndex = v2Bundle.indexOf(v2Marker);
  const legacyStart = v2Bundle.indexOf('function isRealUserGroup', markerIndex);
  const historyStart = v2Bundle.indexOf('\nfunction $b(', legacyStart);
  assert.ok(markerIndex >= 0 && legacyStart > markerIndex && historyStart > legacyStart);
  return v2Bundle.slice(0, markerIndex)
    + '/* pinkie-chat-timeline:v1 */'
    + v2Bundle.slice(markerIndex + v2Marker.length, legacyStart)
    + legacyV1BuildTimeline
    + v2Bundle.slice(historyStart);
}

test('native bundle patch is structural, idempotent, syntax-safe and skips changed upstream code', () => {
  const result = transformWithStatus(bundleFixture);
  assert.equal(result.changed, true, result.reason);
  assert.match(result.text, /pinkie-chat-timeline:v5/);
  assert.match(result.text, /pinkieSelectMessageWindow\(e\.messages,Li,512\)/);
  assert.match(result.text, /return 512/);
  assert.match(result.text, /pinkieBuildTimeline\(/);
  assert.match(result.text, /pinkieBuildTimeline\(__pinkieTimelineEntries,lb\)/);
  assert.match(result.text, /let __pinkieTimelineEntries=Tb\(bb\(Fb\(Sb\(Ub\(t,_\)\)\)\)\)/);
  assert.match(result.text, /if \(String\(message\?\.role \|\| ''\)\.toLowerCase\(\) === 'user'\) \{\s*selected\.unshift\(message\);\s*break;/);
  assert.match(result.text, /MediaPaths/);
  assert.match(result.text, /chat-timeline-overflow/);
  assert.doesNotThrow(() => new vm.Script(result.text));
  assert.equal(transform(result.text), result.text);
  const mismatch = transformWithStatus('function upstreamChanged(){return true}');
  assert.equal(mismatch.changed, false);
  assert.equal(mismatch.text, 'function upstreamChanged(){return true}');
  assert.deepEqual(apply('/not-a-control-ui-root'), {
    changed: false, skipped: true, reason: 'native chat assets not found',
  });
});

test('an installed v1 chat bundle upgrades to v5 through apply and stays idempotent', (t) => {
  const v5 = transformWithStatus(bundleFixture).text;
  const v1 = asLegacyV1Bundle(v5);
  assert.match(v1, /pinkie-chat-timeline:v1/);
  assert.match(v1, /const prefix = safeEntries\.slice/);

  const upgraded = transformWithStatus(v1);
  assert.equal(upgraded.changed, true, upgraded.reason);
  assert.equal(upgraded.reason, 'upgraded-v1');
  assert.match(upgraded.text, /pinkie-chat-timeline:v5/);
  assert.doesNotMatch(upgraded.text, /pinkie-chat-timeline:v1|const prefix = safeEntries\.slice/);
  assert.doesNotThrow(() => new vm.Script(upgraded.text));
  assert.deepEqual(transformWithStatus(upgraded.text), {
    text: upgraded.text,
    changed: false,
    reason: 'already-patched',
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-v1-upgrade-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const assets = path.join(root, 'dist', 'control-ui', 'assets');
  const chunk = path.join(assets, 'chat-page-test.js');
  fs.mkdirSync(assets, {recursive: true});
  fs.writeFileSync(chunk, v1);
  const applied = apply(root, {backupRoot: path.join(root, 'backups')});
  assert.equal(applied.changed, true);
  assert.equal(fs.readFileSync(chunk, 'utf8'), upgraded.text);
  assert.equal(fs.readFileSync(path.join(applied.backup, 'chat-page-test.js'), 'utf8'), v1);
  const repeated = apply(root, {backupRoot: path.join(root, 'second-backup')});
  assert.equal(repeated.changed, false);
  assert.equal(repeated.reason, 'already-patched');
});

test('timeline tool details keep no card shell and injection cache keys advance', () => {
  const css = fs.readFileSync(new URL('../ui/injections/laolao-tool-stream.css', import.meta.url), 'utf8');
  const head = fs.readFileSync(new URL('../ui/injections/laolao-head.fragment.html', import.meta.url), 'utf8');
  const mac = fs.readFileSync(new URL('../installer/macos/apply-theme.sh', import.meta.url), 'utf8');
  const windows = fs.readFileSync(new URL('../installer/windows/apply-theme.ps1', import.meta.url), 'utf8');
  assert.match(css, /\.chat-group--timeline-tools \.chat-tool-msg-collapse\s*\{[^}]*border: 0 !important;[^}]*background: transparent !important;[^}]*box-shadow: none !important;/u);
  for (const source of [head, mac, windows]) {
    assert.match(source, /laolao-tool-stream\.css\?v=toolstream3/u);
    assert.match(source, /laolao-resume\.js\?v=resume44/u);
    assert.match(source, /laolao-queue-steer\.js\?v=queuesteer2/u);
  }
  for (const source of [mac, windows]) {
    assert.match(source, /clekk-history33/u);
    assert.match(source, /clekk-history-render-33/u);
  }
});

test('an installed v2 chat bundle upgrades to v5 in place', () => {
  const v5 = transformWithStatus(bundleFixture).text;
  // The released v2 runtime still gave synthetic tool rows a top-level toolName.
  const v2 = asOlderBundle(v5, 'v2').replace('return cleanAssistantMessage(message, content);',
    "return {...message, role: 'assistant', toolName: 'legacy', content};");
  assert.match(v2, /toolName: 'legacy'/);
  const upgraded = transformWithStatus(v2);
  assert.equal(upgraded.changed, true, upgraded.reason);
  assert.equal(upgraded.reason, 'upgraded-v2');
  assert.equal(upgraded.text, v5);
  assert.equal(transformWithStatus(upgraded.text).reason, 'already-patched');
});

test('history tool results without their call part render as named tool rows', () => {
  // chat.history keeps toolResult messages but drops the assistant's toolCall
  // parts, so after a reload every step arrives as a standalone result.
  const entries = [
    group('user', 'user', [message('user', '读取 SOUL.md 并总结', 'user')]),
    group('assistant', 'say', [message('assistant', '我先读取 SOUL.md。', 'say')]),
    group('tool', 'result', [{
      role: 'toolResult', toolName: 'read', toolCallId: 'read-1', isError: false,
      content: [{type: 'text', text: '# SOUL.md'}],
    }]),
    group('assistant', 'final', [message('assistant', '读完了。', 'final')]),
  ];
  const timeline = flat(pinkieBuildTimeline(entries, () => []));
  const row = timeline.find((item) => item.key === 'result:0');
  assert.equal(row.isTimelineStep, true);
  const synthetic = row.messages[0].message;
  assert.equal(synthetic.role, 'assistant');
  assert.equal(synthetic.toolName, undefined);
  assert.deepEqual(synthetic.content.map((part) => [part.type, part.name, part.callId]), [
    ['tool_call', 'read', 'read-1'],
    ['tool_result', 'read', 'read-1'],
  ]);
  assert.equal(synthetic.content[1].text, '# SOUL.md');
  assert.equal(synthetic.content[1].isError, false);
});

test('a turn with steps becomes user · process card · final reply', () => {
  const entries = [
    {...group('user', 'u1', [message('user', '跑一下测试', 'u1')]), timestamp: 1000},
    group('tool', 'tools', [
      message('assistant', [
        {type: 'text', text: '我先跑测试。'},
        {type: 'tool_call', callId: 'e1', name: 'exec', arguments: {command: 'npm test'}},
      ], 'call'),
      message('tool', [{type: 'tool_result', callId: 'e1', name: 'exec', text: 'ok'}], 'result'),
    ]),
    {...group('assistant', 'final', [message('assistant', '全部通过。', 'final')]), timestamp: 19000},
  ];
  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  assert.deepEqual(timeline.map((item) => item.key), ['u1', 'pinkie:process:u1', 'final']);
  const card = timeline[1];
  assert.equal(card.isProcessCard, true);
  assert.equal(card.processLive, false);
  assert.equal(card.processTitle, '碧琪的工作过程');
  assert.equal(card.processMeta, '1 个步骤 · 用时 18 秒');
  assert.deepEqual(card.processRows.map((row) => row.role), ['assistant', 'tool']);
  assert.equal(card.processRows.every((row) => row.isTimelineStep), true);
});

test('plain answers keep the native layout unless the page recorded their thinking', () => {
  const entries = [
    group('user', 'chat-user', [message('user', '你好', 'chat-user')]),
    group('assistant', 'chat-final', [message('assistant', '你好呀！', 'chat-final')]),
    group('user', 'next-user', [message('user', '再见', 'next-user')]),
    group('assistant', 'next-final', [message('assistant', '拜拜！', 'next-final')]),
  ];
  assert.deepEqual(pinkieBuildTimeline(entries, parseToolRows).map((item) => item.key),
    ['chat-user', 'chat-final', 'next-user', 'next-final']);
  globalThis.__pinkieProcessKeep = new Set(['pinkie:process:chat-user']);
  try {
    const kept = pinkieBuildTimeline(entries, parseToolRows);
    assert.deepEqual(kept.map((item) => item.key),
      ['chat-user', 'pinkie:process:chat-user', 'chat-final', 'next-user', 'next-final']);
    assert.equal(kept[1].processRows.length, 0);
    assert.equal(kept[1].processLive, false);
  } finally {
    delete globalThis.__pinkieProcessKeep;
  }
});

test('narration streamed before a later tool call is already a card row while live', () => {
  const entries = [
    group('user', 'live-user', [message('user', '查一下', 'live-user')]),
    {kind: 'stream', key: 'say-1', text: '我先查配置。', startedAt: 2},
    group('tool', 'tool-1', [message('assistant', [
      {type: 'tool_call', callId: 'r1', name: 'read', arguments: {path: 'a.json'}},
    ], 'tool-1')]),
    {kind: 'stream', key: 'reply', text: '查到了', startedAt: 4},
    {kind: 'reading-indicator', key: 'reading'},
  ];
  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  assert.deepEqual(timeline.map((item) => item.key), ['live-user', 'pinkie:process:live-user', 'reply', 'reading']);
  const card = timeline[1];
  assert.equal(card.processLive, true);
  assert.equal(card.processTitle, '碧琪正在干活');
  assert.equal(card.processMeta, '已做 1 步');
  assert.deepEqual(card.processRows.map((row) => [row.key, row.role]), [['say-1', 'assistant'], ['tool-1:0:timeline:tool:0', 'tool']]);
  assert.equal(card.processRows[0].messages[0].message.content[0].text, '我先查配置。');
});

test('the renderer opens the card while live and keeps status slots for the page script', () => {
  const v5 = transformWithStatus(bundleFixture).text;
  assert.match(v5, /if\(e&&e\.isProcessCard\)return s`<div class="chat-group assistant chat-group--process"/);
  assert.match(v5, /<details class="pinkie-process" \?open=\$\{e\.processLive\}/);
  assert.match(v5, /data-pinkie-thinking=\$\{e\.key\}/);
  assert.match(v5, /data-pinkie-status=\$\{e\.key\}/);
  assert.match(v5, /data-state=\$\{e\.processState\|\|`\`\}/);
  assert.match(v5, /e\.processRows\.map\(n=>n\.kind===`group`\?_S\(n,t\):c\)/);
});

test('an installed v3 bundle gains the process-card renderer when it upgrades to v5', () => {
  const v5 = transformWithStatus(bundleFixture).text;
  const branch = /if\(e&&e\.isProcessCard\)return s`[\s\S]*?`;(?=if\(e&&e\.timelineOverflow\))/u.exec(v5)?.[0];
  assert.ok(branch);
  // What v3 installed: same runtime span, renderer without the card branch.
  const v3 = asOlderBundle(v5, 'v3').replace(branch, '');
  assert.doesNotMatch(v3, /isProcessCard\)return/);
  const upgraded = transformWithStatus(v3);
  assert.equal(upgraded.reason, 'upgraded-v3');
  assert.equal(upgraded.text, v5);
  assert.equal(transformWithStatus(upgraded.text).reason, 'already-patched');
});

test('an installed v4 bundle upgrades to v5 in place', () => {
  const v5 = transformWithStatus(bundleFixture).text;
  const v4 = asOlderBundle(v5, 'v4');
  const upgraded = transformWithStatus(v4);
  assert.equal(upgraded.changed, true);
  assert.equal(upgraded.reason, 'upgraded-v4');
  assert.equal(upgraded.text, v5);
  assert.equal(transformWithStatus(upgraded.text).reason, 'already-patched');
});
