import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply, pinkieBuildTimeline, pinkieSelectMessageWindow, pinkieTimelineView, pinkieProcessOpen, pinkieTimelineRows, pinkieTimelineToggle, pinkieTimelineMore, processBranchSource, overflowBranchSource, pinkieSplitTimelineMessage, transform, transformCurrentWithStatus, transformWithStatus} from '../patch/apply-chat-timeline.mjs';

const message = (role, content, id, timestamp = 1) => ({role, content, timestamp, __openclaw: {id}});
const group = (role, key, messages) => ({
  kind: 'group', key, role, timestamp: 1,
  messages: messages.map((entry, index) => ({message: entry, key: `${key}:${index}`})),
});
// A turn's steps now live inside one process card; expand it back into rows.
const flat = (timeline) => timeline.flatMap((item) => (item.isProcessCard ? item.processRows : [item]));
// 每一轮被拆成独立消息项后，顶层 key 是 "<owner>:<index>"，紧凑的行键是
// "<owner>:timeline:…"。断言关心的是属于哪一轮，而不是索引，所以比较前先把
// 结尾的 ":<digits>" 去掉，避免把行序变化也当成回归。
const own = (key) => String(key ?? '').replace(/:\d+$/, '');

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
  assert.equal(timeline.some((item) => own(item.key) === 'image-only-user'), true);
  assert.equal(timeline.some((item) => own(item.key) === 'watchdog' || own(item.key) === 'tier-control'), false);
  const current = timeline.findIndex((item) => own(item.key) === 'current-user');
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
  const projectedCompaction = timeline.find((item) => own(item.key) === 'compact');
  assert.equal(projectedCompaction?.messages[0].message.__openclaw.kind, 'compaction');
  assert.equal(timeline.some((item) => own(item.key) === 'orphan-tail'), false);
  assert.equal(timeline.some((item) => own(item.key) === 'visible-user'), true);
  assert.equal(timeline.some((item) => item.isProcessCard && item.processRows.some((row) => own(row.key) === 'orphan-tail')), true);
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
  // No blank assistant bubble survives; the user row stays. The turn still
  // gets a card because the page recorded thinking for it, and that thinking
  // lives inside the card — an empty-step card without thinking is the only
  // shape we forbid.
  assert.deepEqual(timeline.map((item) => own(item.key)), ['blank-user', 'pinkie:process::blank-user']);
  const card = timeline.find((item) => item.isProcessCard);
  assert.equal(card.processRows.length, 0);
  assert.equal(card.processThinking, 'private', 'the card exists only to carry the recorded thinking');
  assert.equal(timeline.some((item) => own(item.key) === 'blank-thinking' || own(item.key) === 'blank-message'), false,
    'thinking-only and empty assistant groups leave no bubble');
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
  const second = timeline.findIndex((item) => own(item.key) === 'second-user');
  assert.ok(second > 0);
  assert.deepEqual(timeline.slice(0, second).map((item) => item.role), [
    'user', 'assistant', 'tool', 'assistant',
  ]);
  assert.equal(timeline.some((item) => /(?:watchdog|tier-control|empty-control)/u.test(item.key)), false);
  assert.equal(timeline[1].isTimelineStep, true);
  assert.equal(timeline[2].isTimelineStep, true);
  assert.equal(timeline[2].messages[0].message.content[0].name, 'read');
  assert.equal(timeline[2].messages[0].message.content.some((part) => part.type === 'tool_result'), true);
  assert.equal(own(timeline[3].key), 'first-final');
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
  const latest = first.findIndex((item) => own(item.key) === 'latest-user');
  const oldRows = first.slice(0, latest);
  // user + overflow + 79 trailing steps + the final answer outside the card
  assert.equal(oldRows.length, 82);
  assert.equal(oldRows[1].timelineOverflow, true);
  assert.equal(oldRows[1].overflowCount, 20);
  assert.equal(own(oldRows[1].key), 'pinkie:timeline:overflow:old-user');
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
  assert.equal(timeline.some((item) => own(item.key) === 'stale-stream' || own(item.key) === 'stale-reading'), false);
  // The live reply streams below the card as a normal bubble.
  assert.equal(timeline.find((item) => own(item.key) === 'live-stream')?.isTimelineStep, undefined);
  assert.equal(timeline.find((item) => own(item.key) === 'live-reading')?.kind, 'reading-indicator');
  const live = projected.find((item) => item.isProcessCard);
  assert.equal(own(live?.key), 'pinkie:process::latest-user');
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
    'first-user:0', 'narrate:0', 'call:0:timeline:tool:0', 'steer-user:0',
    'result:0', 'after-steer:0', 'final:0',
  ]);
  const call = first.find((item) => item.key === 'call:0:timeline:tool:0');
  const result = first.find((item) => item.key === 'result:0');
  assert.equal(call?.isTimelineStep, true);
  assert.equal(result?.isTimelineStep, true);
  assert.equal(call?.role, 'tool');
  assert.equal(result?.role, 'tool');
  assert.equal(first.find((item) => item.key === 'after-steer:0')?.isTimelineStep, true);
  assert.equal(first.find((item) => own(item.key) === 'final')?.isTimelineStep, undefined);
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
  const start = timeline.findIndex((item) => own(item.key) === 'turn-user');
  const rows = timeline.slice(start);
  assert.equal(rows.length, 82);
  assert.equal(rows[1].timelineOverflow, true);
  assert.equal(rows[1].overflowCount, 20);
  assert.equal(rows.at(-1).messages[0].message.content, 'step 99');
  const renderer = fs.readFileSync(new URL('../patch/apply-chat-timeline.mjs', import.meta.url), 'utf8');
  assert.match(renderer, /<details class="chat-timeline-overflow"/);
});

test('all loaded pages remain reachable beyond the former 512-message boundary', () => {
  const messages = [
    message('user', 'long task', 'turn-user'),
    ...Array.from({length: 519}, (_, index) => message('assistant', `step ${index}`, `step-${index}`)),
  ];
  const selected = pinkieSelectMessageWindow(messages, () => false, 512);
  assert.equal(selected.length, 520);
  assert.equal(selected[0].__openclaw.id, 'turn-user');
  assert.deepEqual(selected.map((item) => item.__openclaw.id),
    messages.map((item) => item.__openclaw.id));
});

test('loaded history skips internal user messages without cutting any real steps', () => {
  const items = [message('user', 'real task', 'real-user'),
    message('user', '[pinkie-watchdog] continue', 'internal'),
    ...Array.from({length: 513}, (_, index) => message('assistant', `step ${index}`, `a-${index}`))];
  const selected = pinkieSelectMessageWindow(items, () => false);
  assert.equal(selected.length, 514);
  assert.equal(selected[0].__openclaw.id, 'real-user');
  assert.equal(selected.some(item => item.__openclaw.id === 'internal'), false);
});

test('paging backward preserves every loaded user turn and does not mutate the source', () => {
  const latest = Array.from({length: 600}, (_, index) => message(index % 2 ? 'assistant' : 'user', `latest ${index}`, `latest-${index}`));
  const older = Array.from({length: 600}, (_, index) => message(index % 2 ? 'assistant' : 'user', `older ${index}`, `older-${index}`));
  const loaded = [...older, ...latest];
  const selected = pinkieSelectMessageWindow(loaded, () => false, 512);
  assert.equal(selected.length, 1200);
  assert.equal(selected[0].__openclaw.id, 'older-0');
  assert.equal(selected.at(-1).__openclaw.id, 'latest-599');
  assert.equal(loaded.length, 1200);
  const entries = selected.map((item) => group(item.role, item.__openclaw.id, [item]));
  const timeline = flat(pinkieBuildTimeline(entries, parseToolRows));
  assert.equal(timeline.filter(item => item.role === 'user').length, 600);
  assert.equal(timeline.find(item => item.role === 'user').messages[0].message.__openclaw.id, 'older-0');
});

test('closed process and overflow cards never call row renderers, and old steps mount in batches', async t => {
  const previous = globalThis.__pinkieTimelineViews;
  globalThis.__pinkieTimelineViews = new Map();
  t.after(() => { globalThis.__pinkieTimelineViews = previous; });
  const html = (strings, ...values) => ({strings, values});
  let rendered = 0;
  const row = () => { rendered += 1; return 'row'; };
  const compile = source => Function('e', 't', 's', 'c', 'pinkieTimelineView', 'pinkieTimelineRows',
    'pinkieTimelineToggle', 'pinkieTimelineMore', 'renderRow', 'pinkieProcessOpen', source);
  const renderProcess = compile(processBranchSource('renderRow'));
  const renderOverflow = compile(overflowBranchSource('renderRow'));
  const call = (render, entry) => render(entry, {}, html, null, pinkieTimelineView, pinkieTimelineRows,
    pinkieTimelineToggle, pinkieTimelineMore, row, pinkieProcessOpen);
  const process = {key: 'lazy-process', isProcessCard: true, processRows: Array.from({length: 80}, () => ({kind: 'group'}))};
  call(renderProcess, process);
  assert.equal(rendered, 0, 'closed process does not construct any row template');
  pinkieTimelineView(process.key).open = true;
  call(renderProcess, process);
  assert.equal(rendered, 80);
  pinkieTimelineView(process.key).open = false;
  call(renderProcess, process);
  assert.equal(rendered, 80, 'closing produces no body, leaving Lit to dispose the previous body');
  const overflow = {key: 'lazy-overflow', timelineOverflow: true,
    overflowItems: Array.from({length: 241}, (_, id) => ({kind: 'group', id}))};
  call(renderOverflow, overflow);
  assert.equal(rendered, 80);
  pinkieTimelineView(overflow.key).open = true;
  call(renderOverflow, overflow);
  assert.equal(rendered, 160, 'opening old steps mounts one batch of 80');
  const pane = {requestUpdate() {}, updateComplete: Promise.resolve()};
  const event = {preventDefault() {}, stopPropagation() {}, currentTarget: {closest: () => pane}};
  await pinkieTimelineMore(event, overflow.key);
  assert.equal(pinkieTimelineRows(overflow, overflow.overflowItems).length, 160);
  await pinkieTimelineToggle(event, overflow.key);
  assert.deepEqual(pinkieTimelineRows(overflow, overflow.overflowItems), []);
  assert.equal(pinkieTimelineView(overflow.key).count, 80, 'reopening starts with a bounded batch');
});

test('process toggles preserve the viewport through the native Lit update', async t => {
  const previous = globalThis.__pinkieChatViewport;
  let updates = 0, preserved = 0;
  const pane = {requestUpdate() { updates += 1; }, updateComplete: Promise.resolve('painted')};
  globalThis.__pinkieChatViewport = {async preserve(target, change) {
    assert.equal(target, pane);
    preserved += 1;
    assert.equal(await change(), 'painted');
  }};
  t.after(() => { globalThis.__pinkieChatViewport = previous; });
  await pinkieTimelineToggle({preventDefault() {}, stopPropagation() {}, currentTarget: {closest: () => pane}}, 'viewport-process');
  assert.equal(updates, 1);
  assert.equal(preserved, 1);
});

const bundleFixture = `
function Li(e){if(!e||typeof e!=\`object\`)return!1;let t=e;if(O(t.role)!==\`assistant\`||typeof t.senderLabel==\`string\`)return!1;let{text:n,hasVisibleNonTextContent:r}=Ii(t.content);return r?!1:Pi(n).shouldSkip}
function mi(e){return e}
function ei(e){return false}
function lb(e,t){return []}
function aC(e,t,n,r){let a=e,o=typeof a.role==\`string\`?a.role:\`unknown\`,l=U(o),u=mi(e),d=U(u.role)===\`tool\`,f=ei(e),p=n.showToolCalls??!0?lb(e,t):[]}
function gS(e,n,r,t){return {}}
function rC(e,t){return null}
function Zb(e){return 5}function Qb(e,t,n){let r=0,i=0,a=e.length;return a}function $b(e){let t=[],n=Zb(e.historyRenderLimit),r=(()=>{let t=[],n=Array.isArray(e.messages)?e.messages:[];for(let e=n.length-1;e>=0&&t.length<5;e--){let r=n[e];Li(r)||t.unshift(r)}return t})(),o=Qb(r,e.showToolCalls,n),i=Array.isArray(e.toolMessages)?e.toolMessages:[],a=i.map(e=>e).filter(e=>!!e);if(false)t.push({message:{content:\`Showing last \u0024{c} messages\`}});return Tb(bb(Fb(Sb(Ub(t,_)))))}function afterHistory(){return null}
function _S(e,t){let n=U(e.role),r=t.assistantName??\`Assistant\`;if(n===\`tool\`&&t.showToolCalls===!1)return c;if(n===\`tool\`&&e.messages.length>1){return c}let d=e.messages.map(e=>rC(e.message,t.onOpenSidebar)),f=e.messages.length-1,p=d[f]??null;return s\`\u0024{aC(n.message,n.key,gS(e,n,r,t),t.onOpenSidebar)}\`}
function hS(e,t={}){let{onOpenSidebar:n,assistant:r,basePath:i,authToken:a}=t,o=r?.name??\`Assistant\`,l=e.flatMap(e=>e.kind===\`stream\`?[e.startedAt]:[]),u=l.length>0?Math.min(...l):null;return s\`
<div class="chat-group assistant">
  \u0024{hi(\`assistant\`,r,void 0,i,a)}
  <div class="chat-group-messages">\u0024{u===null?c:s\`<div class="chat-group-footer">\u0024{zx(u)}</div>\`}</div>
</div>\`}
function afterStreaming(){return null}
function nativeProjectionEqual(e,t){return e.sessionKey===t.sessionKey&&e.messages===t.messages&&e.historyRenderLimit===t.historyRenderLimit}\nfunction nativeProjection(e){let t=nativeCache;if(t.input&&nativeProjectionEqual(t.input,e))return t.items;let n=$b(e);return t.input=e,t.items=n,n}\nfunction nativeThread(e){let t=pane(e.paneId),n=e.onRequestUpdate,h=nativeProjection({sessionKey:e.sessionKey,messages:e.messages,toolMessages:e.toolMessages,streamSegments:e.streamSegments,stream:e.stream,streamStartedAt:e.streamStartedAt,queue:e.queue,historyRenderLimit:e.historyRenderLimit});return s\`<div class="chat-thread"><div class="chat-thread-inner">\${footer(e)}</div></div>\`}
function nativeSessionMessage(e,t){let n=decode(t);if(!n||!accept(e,n))return;let r=selected(e,n);r&&n.archived!==null;}
function nativeFinal(e,t){if(false){}else if(t.state===\`final\`){let n=decode(t.message);n&&!noop}}
function nativeToolSync(e){e.toolStreamSyncTimer!=null&&(clearTimeout(e.toolStreamSyncTimer),e.toolStreamSyncTimer=null),sync(e)}
function nativeFollow(e,u,l,d,n){return (u||l===\`always\`||l===\`near-bottom\`&&(d||!e.chatFollowLocked&&(e.chatUserNearBottom||n<Cc)))}
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
  return currentBundle.replace('/* pinkie-chat-timeline:v26 */', `/* pinkie-chat-timeline:${version} */`);
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
  assert.match(result.text, /pinkie-chat-timeline:v26/);
  assert.match(result.text, /pinkieSelectMessageWindow\(e\.messages,Li,e\)/);
  assert.match(result.text, /function Zb\(e\)\{return Infinity\}/);
  assert.match(result.text, /pinkieBuildTimeline\(/);
  assert.match(result.text, /pinkieBuildTimeline\(__pinkieTimelineEntries,lb,80,e\)/);
  assert.match(result.text, /let __pinkieTimelineEntries=Tb\(bb\(Fb\(Sb\(Ub\(t,_\)\)\)\)\)/);
  assert.match(result.text, /return source\.filter\(visible\)/);
  assert.match(result.text, /MediaPaths/);
  assert.match(result.text, /chat-timeline-overflow/);
  assert.match(result.text, /class="chat-thread-inner">\$\{pinkieEarlierHistory\(e\)\}/);
  assert.doesNotMatch(result.text, /return s`\$\{pinkieEarlierHistory\(e\)\}/);
  assert.doesNotThrow(() => new vm.Script(result.text));
  assert.equal(transform(result.text), result.text);
  const mismatch = transformWithStatus('function upstreamChanged(){return true}');
  assert.equal(mismatch.changed, false);
  assert.equal(mismatch.text, 'function upstreamChanged(){return true}');
  assert.deepEqual(apply('/not-a-control-ui-root'), {
    changed: false, skipped: true, reason: 'native chat assets not found',
  });
});

test('legacy earlier-history control targets its own pane, prevents duplicate loads and disappears at the end', async () => {
  let finish;
  let requested = [];
  const state = {sessionKey: 'shared', chatMessages: [], chatHistoryPagination: {hasMore: true, nextOffset: 600}};
  const other = {paneId: 'other', state: {...state}};
  const pane = {paneId: 'target', state, requestUpdate() {}};
  const context = vm.createContext({c: null, document: {querySelectorAll: () => [other, pane]},
    s: (strings, ...values) => ({strings, values}),
    __laolaoLoadEarlierHistory: (target) => { requested.push(target); return new Promise(resolve => { finish = resolve; }); },
    options: {paneId: 'target', sessionKey: 'shared', messages: state.chatMessages}});
  vm.runInContext(transformWithStatus(bundleFixture).text, context);
  const control = vm.runInContext('pinkieEarlierHistory(options)', context);
  assert.match(control.strings.join(''), /data-pinkie-load-earlier/);
  const click = control.values.find(value => typeof value === 'function');
  const event = {preventDefault() {}, stopPropagation() {}};
  click(event);
  click(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requested, [pane]);
  assert.equal(vm.runInContext('pinkieEarlierHistory(options)', context).values.find(value => typeof value === 'string' && /^(?:上一页|正在加载|重试加载)/.test(value)), '正在加载更早消息…');
  finish(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('pinkieEarlierHistory(options)', context).values.find(value => typeof value === 'string' && /^(?:上一页|正在加载|重试加载)/.test(value)), '重试加载更早消息');
  state.chatHistoryPagination = {hasMore: false};
  assert.equal(vm.runInContext('pinkieEarlierHistory(options)', context), null);
});

test('short local boundary pages fetch older rows before paging, without hiding history on failure', async () => {
  async function exercise(sessionKey, succeeds) {
    const messages = Array.from({length: 112}, (_, index) => message(index % 2 ? 'assistant' : 'user', `turn ${index}`, `m-${index}`));
    const older = Array.from({length: 128}, (_, index) => message(index % 2 ? 'assistant' : 'user', `older ${index}`, `old-${index}`));
    const state = {sessionKey, currentSessionId:'instance', chatMessages:messages, chatHistoryPagination:{hasMore:true,nextOffset:112}};
    const pane = {paneId:'target',state,requestUpdate(){}};
    let requests=0;
    const context=vm.createContext({c:null,document:{querySelectorAll:()=>[pane]},s:(strings,...values)=>({strings,values}),pane,
      options:{paneId:pane.paneId,sessionKey,messages},
      __laolaoLoadEarlierHistory:async()=>{requests++;if(!succeeds)return false;state.chatMessages=[...older,...state.chatMessages];return true;}});
    vm.runInContext(transformWithStatus(bundleFixture).text,context);
    const project=()=>vm.runInContext('pinkieSelectMessageWindow(pane.state.chatMessages,()=>false,options)',context);
    assert.equal(project().length,100);
    const control=vm.runInContext('pinkieEarlierHistory(options)',context);
    control.values.find(x=>typeof x==='function')({preventDefault(){},stopPropagation(){}});
    await new Promise(resolve=>setImmediate(resolve));
    const page=project();
    return {requests,ids:Array.from(page,x=>x.__openclaw.id),state};
  }
  const loaded=await exercise('agent:learning:audit',true);
  assert.equal(loaded.requests,1);
  assert.equal(loaded.ids.length,100);
  assert.equal(loaded.ids[0],'old-40');
  assert.equal(loaded.ids.at(-1),'m-11');
  assert.equal(loaded.state.chatMessages.length,240);
  const failed=await exercise('agent:learning:audit',false);
  assert.equal(failed.requests,1);
  assert.deepEqual(failed.ids,Array.from({length:12},(_,i)=>`m-${i}`));
  const excluded=await exercise('agent:other:audit',true);
  assert.equal(excluded.requests,0);
  assert.deepEqual(excluded.ids,Array.from({length:12},(_,i)=>`m-${i}`));
});

test('legacy local pages keep 10000 retained messages reachable with 100-row projections and stable reading pages', () => {
  const messages = Array.from({length: 10000}, (_, index) => message(index % 2 ? 'assistant' : 'user', `turn ${index}`, `m-${index}`));
  const state = {sessionKey: 'paged', currentSessionId: 'one', chatMessages: messages, chatHistoryPagination: {hasMore: false}};
  const pane = {paneId: 'paged-pane', state, requestUpdate() {}};
  const options = {paneId: pane.paneId, sessionKey: state.sessionKey, messages};
  const context = vm.createContext({c: null, document: {querySelectorAll: () => [pane]},
    s: (strings, ...values) => ({strings, values}), options, pane});
  vm.runInContext(transformWithStatus(bundleFixture).text, context);
  const project = () => vm.runInContext('pinkieSelectMessageWindow(pane.state.chatMessages,()=>false,options)', context);
  const visited = new Set();
  for (let page = 0; page < 100; page += 1) {
    const selected = project();
    assert.equal(selected.length, 100);
    selected.forEach(item => visited.add(item.__openclaw.id));
    if (page < 99) vm.runInContext("pinkieNavigateHistory(pane,options,'previous')", context);
  }
  assert.equal(visited.size, 10000);
  assert.equal(state.chatMessages.length, 10000);
  assert.equal(project()[0].__openclaw.id, 'm-0');
  assert.equal(pane.__pinkieHistoryBrowsing, true);
  state.chatMessages = [...messages, message('user', 'new turn', 'new-10000')];
  assert.equal(project()[0].__openclaw.id, 'm-0');
  assert.equal(project().at(-1).__openclaw.id, 'm-99');
  vm.runInContext("pinkieNavigateHistory(pane,options,'next')", context);
  assert.equal(project()[0].__openclaw.id, 'm-100');
  vm.runInContext("pinkieNavigateHistory(pane,options,'latest')", context);
  assert.equal(project().at(-1).__openclaw.id, 'new-10000');
  assert.equal(pane.__pinkieHistoryBrowsing, false);
  assert.equal(state.chatMessages.length, 10001);
});

test('legacy long-turn pages retain user and boundary tool context without scanning history on every token', () => {
  const messages = [message('user', 'long task', 'task'),
    ...Array.from({length: 9999}, (_, index) => message('assistant', `step ${index}`, `step-${index}`)),
    message('assistant', [{type: 'toolCall', id: 'boundary-call', name: 'read', arguments: {path: 'a'}}], 'boundary-assistant'),
    {...message('toolResult', 'result', 'boundary-result'), toolCallId: 'boundary-call', toolName: 'read'},
    ...Array.from({length: 99}, (_, index) => message('assistant', `last ${index}`, `last-${index}`))];
  const state = {sessionKey: 'long-paged', currentSessionId: 'one', chatMessages: messages};
  const pane = {paneId: 'long-pane', state, requestUpdate() {}};
  const context = vm.createContext({c: null, document: {querySelectorAll: () => [pane]},
    s: (strings, ...values) => ({strings, values}), options: {paneId: pane.paneId, sessionKey: state.sessionKey}, pane});
  vm.runInContext(transformWithStatus(bundleFixture).text, context);
  const first = vm.runInContext('pinkieSelectMessageWindow(pane.state.chatMessages,()=>false,options)', context);
  assert.equal(first.length, 102);
  assert.equal(first[0].__openclaw.id, 'task');
  assert.equal(first[1].__openclaw.id, 'boundary-assistant');
  assert.equal(first[2].__openclaw.id, 'boundary-result');
  state.chatMessages = [...messages, message('assistant', 'one token later', 'new-step')];
  let scans = 0;
  context.shouldSkip = () => { scans += 1; return false; };
  const second = vm.runInContext('pinkieSelectMessageWindow(pane.state.chatMessages,shouldSkip,options)', context);
  assert.equal(second[0].__openclaw.id, 'task');
  assert.ok(scans < 250, `one appended message checked ${scans} rows`);
  assert.ok(second.length <= 102);
  vm.runInContext("pinkieNavigateHistory(pane,options,'previous')", context);
  state.chatRunId = 'still-running-current-turn';
  const renderOptions = vm.runInContext("pinkieHistoryRenderOptions({...options,toolMessages:[1,2,3],stream:'new reply',streamSegments:[1],runId:'active'})", context);
  assert.equal(renderOptions.toolMessages.length, 0);
  assert.equal(renderOptions.streamSegments.length, 0);
  assert.equal(renderOptions.stream, null);
  assert.equal(renderOptions.runId, null);
  const projected = vm.runInContext("pinkieSelectMessageWindow(pane.state.chatMessages,()=>false,options)", context);
  context.entries = projected.map(item => group(item.role, item.__openclaw.id, [item]));
  const historical = vm.runInContext('pinkieBuildTimeline(entries,()=>[],80,options)', context);
  assert.equal(historical.some(item => item.processLive), false);
});

test('the real thread-to-memo-to-history props flow preserves pane identity and invalidates on local page navigation', () => {
  const messages = Array.from({length: 600}, (_, index) => message('user', `message ${index}`, `m-${index}`));
  const state = {sessionKey: 'actual-flow', currentSessionId: 'one', chatMessages: messages, chatHistoryPagination: {hasMore: true}};
  const actualPane = {paneId: 'single', state, requestUpdate() {}};
  const options = {paneId: 'single', sessionKey: state.sessionKey, messages};
  const context = vm.createContext({c: null, document: {querySelectorAll: () => [actualPane]},
    s: (strings, ...values) => ({strings, values}), pane: () => ({}), footer: () => '',
    nativeCache: {input: null, items: []}, options, actualPane});
  vm.runInContext(transformWithStatus(bundleFixture).text, context);
  vm.runInContext(`let projectionCalls=0;
    $b=function(e){projectionCalls++;e=pinkieHistoryRenderOptions(e);return pinkieSelectMessageWindow(e.messages,()=>false,e).map(message=>message.__openclaw.id);};`, context);
  vm.runInContext('nativeThread(options)', context);
  assert.equal(context.nativeCache.input.paneId, 'single');
  assert.equal(context.nativeCache.items[0], 'm-500');
  assert.equal(vm.runInContext('pinkieEarlierHistory(options)', context).values.find(value => typeof value === 'string' && /^(?:上一页|正在加载|重试加载)/.test(value)), '上一页');
  vm.runInContext("pinkieNavigateHistory(actualPane,options,'previous');nativeThread(options)", context);
  assert.equal(context.nativeCache.items[0], 'm-400');
  assert.equal(vm.runInContext('projectionCalls', context), 2);
  vm.runInContext('nativeThread(options)', context);
  assert.equal(vm.runInContext('projectionCalls', context), 2, 'unchanged pages retain the native memo budget');
  vm.runInContext("pinkieNavigateHistory(actualPane,options,'latest');nativeThread(options)", context);
  assert.equal(context.nativeCache.items[0], 'm-500');
});

test('legacy large-body pages respect the soft character budget and keep every message navigable', () => {
  const messages = Array.from({length: 100}, (_, index) => message('user', 'x'.repeat(index === 50 ? 400001 : 80000), `big-${index}`));
  const state = {sessionKey: 'budget', currentSessionId: 'one', chatMessages: messages};
  const pane = {paneId: 'budget-pane', state, requestUpdate() {}};
  const context = vm.createContext({c: null, document: {querySelectorAll: () => [pane]},
    s: (strings, ...values) => ({strings, values}), options: {paneId: pane.paneId, sessionKey: state.sessionKey}, pane});
  vm.runInContext(transformWithStatus(bundleFixture).text, context);
  const visited = new Set();
  for (let page = 0; page < 100; page += 1) {
    const selected = vm.runInContext('pinkieSelectMessageWindow(pane.state.chatMessages,()=>false,options)', context);
    selected.forEach(item => visited.add(item.__openclaw.id));
    const chars = selected.reduce((sum, item) => sum + item.content.length, 0);
    assert.ok(chars <= 240000 || selected.length === 1);
    if (!vm.runInContext('pinkieLegacyHistoryView(options).hasPrevious', context)) break;
    vm.runInContext("pinkieNavigateHistory(pane,options,'previous')", context);
  }
  assert.equal(visited.size, 100);
  assert.equal(state.chatMessages.length, 100);
  assert.match(transformWithStatus(bundleFixture).text, /o=0,\/\* pinkie-paged-byte-budget \*\//);
});

test('v19 upgrades the actual dropped-props memo path and secondary byte clipping', () => {
  const current = transformWithStatus(bundleFixture).text;
  const legacy = asOlderBundle(current, 'v19')
    .replace('paneId:e.paneId,pinkieHistoryRevision:pinkieLegacyHistoryView(e).revision||0,sessionKey:e.sessionKey', 'sessionKey:e.sessionKey')
    .replace('&&t.input.paneId===e.paneId&&t.input.pinkieHistoryRevision===e.pinkieHistoryRevision', '')
    .replace('o=0,/* pinkie-paged-byte-budget */', 'o=Qb(r,e.showToolCalls,n),');
  const result = transformWithStatus(legacy);
  assert.equal(result.changed, true, result.reason);
  assert.equal(result.reason, 'upgraded-v19');
  assert.match(result.text, /paneId:e\.paneId,pinkieHistoryRevision:pinkieLegacyHistoryView\(e\)\.revision/);
  assert.match(result.text, /t\.input\.pinkieHistoryRevision===e\.pinkieHistoryRevision/);
  assert.match(result.text, /o=0,\/\* pinkie-paged-byte-budget \*\//);
  assert.equal(transformWithStatus(result.text).reason, 'already-patched');
});

test('v20 paging upgrades into the transcript without an extra chat-main layout child', () => {
  const current = transformWithStatus(bundleFixture).text;
  const legacy = asOlderBundle(current, 'v20')
    .replace('<div class="chat-thread-inner">${pinkieEarlierHistory(e)}', '<div class="chat-thread-inner">')
    .replace('return s`<div class="chat-thread">', 'return s`${pinkieEarlierHistory(e)}<div class="chat-thread">');
  const result = transformWithStatus(legacy);
  assert.equal(result.changed, true, result.reason);
  assert.equal(result.reason, 'upgraded-v20');
  assert.match(result.text, /return s`<div class="chat-thread"><div class="chat-thread-inner">\$\{pinkieEarlierHistory\(e\)\}/);
  assert.doesNotMatch(result.text, /return s`\$\{pinkieEarlierHistory\(e\)\}/);
  assert.match(result.text, /<nav class="pinkie-history-pagination"[^>]*width:fit-content;[^>]*height:28px;[^>]*background:transparent/);
  assert.doesNotMatch(result.text, /class="chat-history-pagination pinkie-history-pagination"/);
  assert.match(result.text, /earliest \? '已到最早消息'/);
  assert.equal(result.text.split('${pinkieEarlierHistory(e)}').length, 2);
});

test('an installed v1 chat bundle upgrades to the current runtime through apply and stays idempotent', (t) => {
  const v5 = transformWithStatus(bundleFixture).text;
  const v1 = asLegacyV1Bundle(v5);
  assert.match(v1, /pinkie-chat-timeline:v1/);
  assert.match(v1, /const prefix = safeEntries\.slice/);

  const upgraded = transformWithStatus(v1);
  assert.equal(upgraded.changed, true, upgraded.reason);
  assert.equal(upgraded.reason, 'upgraded-v1');
  assert.match(upgraded.text, /pinkie-chat-timeline:v26/);
  assert.doesNotMatch(upgraded.text, /pinkie-chat-timeline:v1\b|const prefix = safeEntries\.slice/);
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

test('an installed v18 hard tail upgrades both message selection and the native render limit', () => {
  const current = transformWithStatus(bundleFixture).text;
  const oldSelector = `function pinkieSelectMessageWindow(messages = [], shouldSkip = () => false, limit = 512) {
    return messages.filter(message => !shouldSkip(message)).slice(-limit);
  }`;
  const legacy = asOlderBundle(current, 'v18')
    .replace(pinkieSelectMessageWindow.toString(), oldSelector)
    .replace('function Zb(e){return Infinity}', 'function Zb(e){return 512}')
    .replace('pinkieSelectMessageWindow(e.messages,Li,e)', 'pinkieSelectMessageWindow(e.messages,Li,512)');
  const upgraded = transformWithStatus(legacy);
  assert.equal(upgraded.changed, true, upgraded.reason);
  assert.equal(upgraded.reason, 'upgraded-v18');
  assert.match(upgraded.text, /function Zb\(e\)\{return Infinity\}/);
  assert.match(upgraded.text, /pinkieSelectMessageWindow\(e\.messages,Li,e\)/);
  assert.doesNotMatch(upgraded.text, /\.slice\(-limit\)/);
  const messages = Array.from({length: 1200}, (_, index) => message('user', `turn ${index}`, `turn-${index}`));
  const selected = vm.runInNewContext(`${upgraded.text}\npinkieSelectMessageWindow(messages);`, {messages});
  assert.equal(selected.length, 1200);
  assert.equal(selected[0].__openclaw.id, 'turn-0');
  assert.equal(transformWithStatus(upgraded.text).reason, 'already-patched');
});

test('timeline tool details keep no card shell and injection cache keys advance', () => {
  const css = fs.readFileSync(new URL('../ui/injections/laolao-tool-stream.css', import.meta.url), 'utf8');
  const head = fs.readFileSync(new URL('../ui/injections/laolao-head.fragment.html', import.meta.url), 'utf8');
  const mac = fs.readFileSync(new URL('../installer/macos/apply-theme.sh', import.meta.url), 'utf8');
  const windows = fs.readFileSync(new URL('../installer/windows/apply-theme.ps1', import.meta.url), 'utf8');
  assert.match(css, /\.chat-group--timeline-tools \.chat-tool-msg-collapse\s*\{[^}]*border: 0 !important;[^}]*background: transparent !important;[^}]*box-shadow: none !important;/u);
  for (const source of [head, mac, windows]) {
    assert.match(source, /laolao-tool-stream\.css\?v=toolstream3/u);
    assert.match(source, /laolao-resume\.js\?v=resume54/u);
    assert.match(source, /laolao-queue-steer\.js\?v=queuesteer3/u);
  }
  for (const source of [mac, windows]) {
    assert.match(source, /clekk-history59/u);
    assert.match(source, /clekk-history-render-59/u);
  }
});

test('an installed v2 chat bundle upgrades to the current runtime in place', () => {
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
    {...group('user', 'u1', [message('user', '跑一下测试', 'u1', 1000)]), timestamp: 1000},
    {...group('tool', 'tools', [
      message('assistant', [
        {type: 'text', text: '我先跑测试。'},
        {type: 'tool_call', callId: 'e1', name: 'exec', arguments: {command: 'npm test'}},
      ], 'call', 2000),
      message('tool', [{type: 'tool_result', callId: 'e1', name: 'exec', text: 'ok'}], 'result', 3000),
    ]), timestamp: 2000},
    {...group('assistant', 'final', [message('assistant', '全部通过。', 'final', 19000)]), timestamp: 19000},
  ];
  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  assert.deepEqual(timeline.map((item) => own(item.key)), ['u1', 'pinkie:process::u1', 'final']);
  const card = timeline[1];
  assert.equal(card.isProcessCard, true);
  assert.equal(card.processLive, false);
  assert.equal(card.processTitle, 'Li An 的工作过程');
  assert.equal(card.processMeta, '1 个步骤 · 用时 18 秒');
  assert.deepEqual(card.processRows.map((row) => row.role), ['assistant', 'tool']);
  assert.equal(card.processRows.every((row) => row.isTimelineStep), true);
});

test('a learning activity is placed once after its own answer and keeps its session and turn', () => {
  const makeTurn = (id, session) => {
    const ref = {v:1, sessionKey:session, id:`quiz-${id}`, kind:'quiz', revision:1, title:'练习'};
    return [group('user', `user-${id}`, [message('user', '讲解并出题', `user-${id}`)]),
      group('tool', `tool-${id}`, [
        message('assistant', [{type:'tool_call',callId:`call-${id}`,name:'learning_activity',arguments:{action:'present'}}], `call-${id}`),
        message('tool', [{type:'tool_result',callId:`call-${id}`,name:'learning_activity',text:JSON.stringify({inline:ref})}], `result-${id}`),
      ]),
      group('assistant', `final-${id}`, [message('assistant', '请在下面作答。', `final-${id}`)])];
  };
  const timeline = pinkieBuildTimeline([...makeTurn('one','agent:learning:first'), ...makeTurn('two','agent:learning:second')], parseToolRows);
  const cards = timeline.filter(item => item.isLearningCard);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(item => item.learningCards[0].sessionKey), ['agent:learning:first','agent:learning:second']);
  for (const [index, name] of ['one','two'].entries()) {
    const at = timeline.findIndex(item => own(item.key) === `final-${name}`);
    assert.equal(timeline[at+1], cards[index], 'the interactive card follows its own answer');
    assert.equal(cards[index].learningCards.length, 1);
  }
  assert.equal(timeline.filter(item => item.isProcessCard).some(item => item.learningCards?.length), false);
});

test('plain answers keep the native layout unless the page recorded their thinking', () => {
  const entries = [
    group('user', 'chat-user', [message('user', '你好', 'chat-user')]),
    group('assistant', 'chat-final', [message('assistant', '你好呀！', 'chat-final')]),
    group('user', 'next-user', [message('user', '再见', 'next-user')]),
    group('assistant', 'next-final', [message('assistant', '拜拜！', 'next-final')]),
  ];
  assert.deepEqual(pinkieBuildTimeline(entries, parseToolRows).map((item) => item.key),
    ['chat-user:0', 'chat-final:0', 'next-user:0', 'next-final:0']);
  globalThis.__pinkieProcessKeep = new Set(['pinkie:process:chat-user']);
  try {
    const kept = pinkieBuildTimeline(entries, parseToolRows);
    assert.deepEqual(kept.map((item) => item.key),
      ['chat-user:0', 'pinkie:process::chat-user', 'chat-final:0', 'next-user:0', 'next-final:0']);
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
  assert.deepEqual(timeline.map((item) => own(item.key)), ['live-user', 'pinkie:process::live-user', 'reply', 'reading']);
  const card = timeline[1];
  assert.equal(card.processLive, true);
  assert.equal(card.processTitle, 'Li An 正在干活');
  assert.equal(card.processMeta, '已做 1 步');
  assert.deepEqual(card.processRows.map((row) => [row.key, row.role]), [['say-1', 'assistant'], ['tool-1:0:timeline:tool:0', 'tool']]);
  assert.equal(card.processRows[0].messages[0].message.content[0].text, '我先查配置。');
});

test('the renderer keeps closed cards lazy and preserves the user expansion state', () => {
  const v5 = transformWithStatus(bundleFixture).text;
  assert.match(v5, /if\(e&&e\.isProcessCard\)return s`<div class="chat-group assistant chat-group--process"/);
  assert.match(v5, /<details class="pinkie-process" \.open=\$\{pinkieProcessOpen\(e\)\}/);
  assert.match(v5, /pinkieProcessOpen\(e\)\?s`/);
  assert.match(v5, /@click=\$\{n=>pinkieTimelineToggle\(n,e\.key\)\}/);
  assert.match(v5, /data-pinkie-thinking=\$\{e\.key\}/);
  assert.match(v5, /data-pinkie-status=\$\{e\.key\}/);
  assert.match(v5, /data-state=\$\{e\.processState\|\|`\`\}/);
  assert.match(v5, /e\.processRows\.map\(n=>n\.kind===`group`\?_S\(n,t\):c\)/);
});

test('an installed v3 bundle gains the process-card renderer when it upgrades to the current runtime', () => {
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

test('an installed v4 bundle upgrades to the current runtime in place', () => {
  const v5 = transformWithStatus(bundleFixture).text;
  const v4 = asOlderBundle(v5, 'v4');
  const upgraded = transformWithStatus(v4);
  assert.equal(upgraded.changed, true);
  assert.equal(upgraded.reason, 'upgraded-v4');
  assert.equal(upgraded.text, v5);
  assert.equal(transformWithStatus(upgraded.text).reason, 'already-patched');
});

// OpenClaw 2026.10 renderer (control-ui-boot-chat-*.js) no longer exposes the
// 2026.7 pipeline anchors. Its native virtual list retains all child ownership.
const current2026 = '//#region src/x\nfunction rv(e,t){return U`\n    <div\n      class="chat-group ${v} chat-group--with-footer${C?` chat-group--turn-block`:``}"\n      style=${A}\n      data-chat-row-key=${e.key}\n      data-file-session-key=${n??K}\n    >\n      <div class="chat-group-messages">${i}</div>\n    </div>`}\n'
  + 'function av(e,t){return U`<div class="chat-group tool chat-group--turn-block chat-group--activity">${e}</div>`}\n'
  + 'const id=`toolmsg:${t}`;';

test('2026.10 renderer gets metadata without replacing the native virtual list', () => {
  const result = transformCurrentWithStatus(current2026);
  assert.equal(result.changed, true);
  assert.equal(result.reason, 'patched-2026');
  assert.match(result.text, /pinkie-chat-timeline-2026:v3/);
  assert.match(result.text, /data-timeline-group-id=\$\{__pkTimelineGroupId\(e\.key\)\}/);
  assert.doesNotMatch(result.text, /__pkTimelineInstall|MutationObserver|appendChild|insertBefore/);
  assert.match(result.text, /class="chat-group tool chat-group--turn-block chat-group--timeline-tools chat-group--activity"/);
  assert.doesNotMatch(result.text, /function __pkTimelineFold/);
  assert.equal(transformCurrentWithStatus(result.text).changed, false);
});

test('2026.10 metadata upgrade adds one owned slot to a work group without replacing its native lazy body', () => {
  const nativeBody = '<div class="chat-group tool chat-group--turn-block chat-group--work" data-chat-row-key=${e.key}><div class="chat-group-messages">${nativeLazyBody(e)}</div></div>';
  const source = current2026 + '\nfunction work(e){return U`' + nativeBody + '`}';
  const v2 = transformCurrentWithStatus(source).text
    .replace('pinkie-chat-timeline-2026:v3', 'pinkie-chat-timeline-2026:v2')
    .replaceAll('<div class="pinkie-learning-inline-slot" data-pinkie-learning-slot=${e?.key||e?.[0]?.key} .pinkieLearningSource=${e}></div>', '');
  const result = transformCurrentWithStatus(v2);
  assert.equal(result.changed, true);
  assert.equal(result.text.split('data-pinkie-learning-slot=').length, 3);
  assert.match(result.text, /\.pinkieLearningSource=\$\{e\}/);
  assert.match(result.text, /\$\{nativeLazyBody\(e\)\}/);
  assert.equal(transformCurrentWithStatus(result.text).changed, false);
});

test('the released v21 process card upgrades to an interactive row outside the process fold', () => {
  const v21 = asOlderBundle(transformWithStatus(bundleFixture).text, 'v21')
    .replace('<div class="pinkie-learning-inline-slot" data-pinkie-learning-slot=${e.key} .pinkieLearningCards=${e.learningCards||[]} .pinkieLearningSession=${t?.sessionKey||``}></div>', '');
  const result = transformWithStatus(v21);
  assert.equal(result.changed, true, result.reason);
  assert.equal(result.reason, 'upgraded-v21');
  assert.match(result.text, /if\(e&&e\.isLearningCard\)return s`<div class="chat-group assistant chat-group--learning"/);
  assert.equal(result.text.split('data-pinkie-learning-slot=').length, 2);
  assert.equal(transformWithStatus(result.text).changed, false);
});

test('2026.10 projection keeps the conversation markup untouched apart from attributes', () => {
  const {text} = transformCurrentWithStatus(current2026);
  assert.match(text, /<div class="chat-group-messages"><div class="pinkie-learning-inline-slot"[^]*?\$\{i\}<\/div>/);
  assert.match(text, /data-file-session-key=\$\{n\?\?K\}/);
  // The 2026.7 pipeline helpers are not injected into a 2026.10 bundle.
  assert.doesNotMatch(text, /pinkieBuildTimeline\(__pinkieTimelineEntries/);
});

test('2026.10 upgrades the old DOM mover without modifying native virtual-list code', () => {
  const install = '${(globalThis.__pkTimelineRoot??=globalThis.document?.body,globalThis.document?.body?__pkTimelineInstall(globalThis.__pkTimelineRoot):"")}';
  const nativeVirtualList = 'function nativeVirtualRows(){return nativeWindow.slice(start,end)}';
  const legacy = '/* pinkie-chat-timeline-2026:v1 */\nfunction __pkTimelineInstall(root){root.appendChild(node)}\nexport default __pkTimelineInstall;\n'
    + current2026.replace('data-chat-row-key=${e.key}', 'data-chat-row-key=${e.key}\n data-timeline-group-id=${__pkTimelineGroupId(e.key)}\n' + install)
    + nativeVirtualList;
  const result = transformCurrentWithStatus(legacy);
  assert.equal(result.changed, true);
  assert.match(result.text, /pinkie-chat-timeline-2026:v3/);
  assert.doesNotMatch(result.text, /__pkTimelineInstall|appendChild|MutationObserver/);
  assert.equal(result.text.split('data-timeline-group-id=').length, 2, 'existing group metadata is not duplicated');
  assert.equal(result.text.endsWith(nativeVirtualList), true);
  assert.equal(transformCurrentWithStatus(result.text).changed, false);
});

test('2026.10 patch leaves native pagination and older-page loading byte-for-byte intact', () => {
  const nativePaging = `function nativeHistoryProps(state,pane){return {
    messages:state.chatMessages,
    historyPagination:{hasMore:state.chatHistoryPagination.hasMore,onShowEarlier:()=>pane.loadOlderMessages()}
  }}
  async function nativeLoadOlder(state){const page=await state.client.request('chat.history',{sessionKey:state.sessionKey,offset:state.chatHistoryPagination.nextOffset});
    state.chatMessages=[...page.messages,...state.chatMessages];
    state.chatHistoryPagination={hasMore:page.hasMore,nextOffset:page.nextOffset};
  }`;
  const result = transformCurrentWithStatus(current2026 + nativePaging);
  assert.equal(result.changed, true);
  assert.equal(result.text.endsWith(nativePaging), true);
  assert.doesNotMatch(result.text, /chatHistoryPagination\s*=\s*\{hasMore:!1\}|messages\.slice\(-512\)/);
});

test('a bundle without the 2026.10 group markup is reported, not guessed', () => {
  assert.deepEqual(transformCurrentWithStatus('function other(){}'), {text: 'function other(){}', changed: false, reason: 'chat group row key not found'});
});

test('the live and latest process stays visible while old turns remain lazy, with explicit collapse respected',async t=>{
 const previous=globalThis.__pinkieTimelineViews;globalThis.__pinkieTimelineViews=new Map();t.after(()=>{globalThis.__pinkieTimelineViews=previous});
 const current={key:'stream-visible',processLive:true,processCurrent:true};assert.equal(pinkieProcessOpen(current),true);assert.equal(pinkieProcessOpen({...current,processLive:false}),true);assert.equal(pinkieProcessOpen({...current,processLive:false,processCurrent:false}),false);
 assert.equal(pinkieProcessOpen(current),true);const event={preventDefault(){},stopPropagation(){},currentTarget:{closest:()=>({requestUpdate(){}})}};await pinkieTimelineToggle(event,current.key);assert.equal(pinkieProcessOpen(current),false);await pinkieTimelineToggle(event,current.key);assert.equal(pinkieProcessOpen(current),true);
});
