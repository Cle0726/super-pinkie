import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {apply, pinkieBuildTimeline, pinkieSelectMessageWindow, pinkieSplitTimelineMessage, transform, transformWithStatus} from '../patch/apply-chat-timeline.mjs';

const message = (role, content, id) => ({role, content, timestamp: 1, __openclaw: {id}});
const group = (role, key, messages) => ({
  kind: 'group', key, role, timestamp: 1,
  messages: messages.map((entry, index) => ({message: entry, key: `${key}:${index}`})),
});

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

  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  assert.equal(timeline.some((item) => item.key === 'image-only-user'), true);
  assert.equal(timeline.some((item) => item.key === 'watchdog' || item.key === 'tier-control'), false);
  const current = timeline.findIndex((item) => item.key === 'current-user');
  assert.ok(current >= 0);
  const rows = timeline.slice(current + 1);
  assert.deepEqual(rows.map((item) => item.role), ['assistant', 'assistant', 'tool', 'tool', 'assistant']);
  assert.match(rows[1].messages[0].message.content[0].text, /核对实现/);
  assert.equal(rows[2].messages[0].message.toolName, 'read');
  assert.equal(rows[3].messages[0].message.toolName, 'exec');
  assert.equal(rows[2].messages[0].message.content.some((part) => part.type === 'tool_result'), true);
  assert.equal(rows[3].messages[0].message.content.some((part) => part.type === 'tool_result'), true);
  assert.equal(rows.slice(0, -1).every((item) => item.isTimelineStep === true), true);
  assert.equal(rows.at(-1).isTimelineStep, undefined);
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
  const timeline = pinkieBuildTimeline(entries, parseToolRows);
  const start = timeline.findIndex((item) => item.key === 'turn-user');
  const rows = timeline.slice(start);
  assert.equal(rows.length, 80);
  assert.equal(rows[1].timelineOverflow, true);
  assert.equal(rows[1].overflowCount, 22);
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

test('native bundle patch is structural, idempotent, syntax-safe and skips changed upstream code', () => {
  const result = transformWithStatus(bundleFixture);
  assert.equal(result.changed, true, result.reason);
  assert.match(result.text, /pinkie-chat-timeline:v1/);
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

test('timeline tool details keep no card shell and injection cache keys advance', () => {
  const css = fs.readFileSync(new URL('../ui/injections/laolao-tool-stream.css', import.meta.url), 'utf8');
  const head = fs.readFileSync(new URL('../ui/injections/laolao-head.fragment.html', import.meta.url), 'utf8');
  const mac = fs.readFileSync(new URL('../installer/macos/apply-theme.sh', import.meta.url), 'utf8');
  const windows = fs.readFileSync(new URL('../installer/windows/apply-theme.ps1', import.meta.url), 'utf8');
  assert.match(css, /\.chat-group--timeline-tools \.chat-tool-msg-collapse\s*\{[^}]*border: 0 !important;[^}]*background: transparent !important;[^}]*box-shadow: none !important;/u);
  for (const source of [head, mac, windows]) {
    assert.match(source, /laolao-tool-stream\.css\?v=toolstream3/u);
    assert.match(source, /laolao-resume\.js\?v=resume40/u);
  }
});
