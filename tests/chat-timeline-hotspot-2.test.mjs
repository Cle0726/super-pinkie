// HOTSPOTS 复发锁（B7 续）：patch/apply-chat-timeline.mjs 里几处修复，
// 原提交自带的测试在「只回退该修复」时仍然全绿，这里逐条补上。
// #182 已锁「运行时事件不再当成用户气泡」，本文件不重复。
//
// 纯逻辑：直接 import 投影函数 + 一个最小的原生 bundle 片段，
// 不启动浏览器，不联网，不用上游模型。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pinkieBuildTimeline, pinkieSplitTimelineMessage, transformWithStatus} from '../patch/apply-chat-timeline.mjs';

const message = (role, content, id, extra = {}) => ({role, content, timestamp: 1, __openclaw: {id}, ...extra});
const group = (role, key, messages) => ({
  kind: 'group', key, role, timestamp: 1,
  messages: messages.map((entry, index) => ({message: entry, key: `${key}:${index}`})),
});
const idOf = (item) => item?.messages?.[0]?.message?.__openclaw?.id;

// 与 tests/chat-tool-timeline.test.mjs 相同形状的原生 bundle 最小片段（保留全部锚点）。
const bundleFixture = `
function Li(e){if(!e||typeof e!=\`object\`)return!1;let t=e;if(O(t.role)!==\`assistant\`||typeof t.senderLabel==\`string\`)return!1;let{text:n,hasVisibleNonTextContent:r}=Ii(t.content);return r?!1:Pi(n).shouldSkip}
function mi(e){return e}
function ei(e){return false}
function lb(e,t){return []}
function aC(e,t,n,r){let a=e,o=typeof a.role==\`string\`?a.role:\`unknown\`,l=U(o),u=mi(e),d=U(u.role)===\`tool\`,f=ei(e),p=n.showToolCalls??!0?lb(e,t):[]}
function gS(e,n,r,t){return {}}
function rC(e,t){return null}
function Zb(e){return 5}function Qb(e,t,n){let r=0,i=0,a=e.length;return a}function $b(e){let t=[],n=Zb(e.historyRenderLimit),r=(()=>{let t=[],n=Array.isArray(e.messages)?e.messages:[];for(let e=n.length-1;e>=0&&t.length<5;e--){let r=n[e];Li(r)||t.unshift(r)}return t})(),o=Qb(r,e.showToolCalls,n),i=Array.isArray(e.toolMessages)?e.toolMessages:[],a=i.map(e=>e).filter(e=>!!e);if(false)t.push({message:{content:\`Showing last \${c} messages\`}});return Tb(bb(Fb(Sb(Ub(t,_)))))}function afterHistory(){return null}
function _S(e,t){let n=U(e.role),r=t.assistantName??\`Assistant\`;if(n===\`tool\`&&t.showToolCalls===!1)return c;if(n===\`tool\`&&e.messages.length>1){return c}let d=e.messages.map(e=>rC(e.message,t.onOpenSidebar)),f=e.messages.length-1,p=d[f]??null;return s\`\${aC(n.message,n.key,gS(e,n,r,t),t.onOpenSidebar)}\`}
function hS(e,t={}){let{onOpenSidebar:n,assistant:r,basePath:i,authToken:a}=t,o=r?.name??\`Assistant\`,l=e.flatMap(e=>e.kind===\`stream\`?[e.startedAt]:[]),u=l.length>0?Math.min(...l):null;return s\`
<div class="chat-group assistant">
  \${hi(\`assistant\`,r,void 0,i,a)}
  <div class="chat-group-messages">\${u===null?c:s\`<div class="chat-group-footer">\${zx(u)}</div>\`}</div>
</div>\`}
function afterStreaming(){return null}
function nativeProjectionEqual(e,t){return e.sessionKey===t.sessionKey&&e.messages===t.messages&&e.historyRenderLimit===t.historyRenderLimit}\nfunction nativeProjection(e){let t=nativeCache;if(t.input&&nativeProjectionEqual(t.input,e))return t.items;let n=$b(e);return t.input=e,t.items=n,n}\nfunction nativeThread(e){let t=pane(e.paneId),n=e.onRequestUpdate,h=nativeProjection({sessionKey:e.sessionKey,messages:e.messages,toolMessages:e.toolMessages,streamSegments:e.streamSegments,stream:e.stream,streamStartedAt:e.streamStartedAt,queue:e.queue,historyRenderLimit:e.historyRenderLimit});return s\`<div class="chat-thread"><div class="chat-thread-inner">\${footer(e)}</div></div>\`}
function nativeSessionMessage(e,t){let n=decode(t);if(!n||!accept(e,n))return;let r=selected(e,n);r&&n.archived!==null;}
function nativeFinal(e,t){if(false){}else if(t.state===\`final\`){let n=decode(t.message);n&&!noop}}
function nativeToolSync(e){e.toolStreamSyncTimer!=null&&(clearTimeout(e.toolStreamSyncTimer),e.toolStreamSyncTimer=null),sync(e)}
function nativeFollow(e,u,l,d,n){return (u||l===\`always\`||l===\`near-bottom\`&&(d||!e.chatFollowLocked&&(e.chatUserNearBottom||n<Cc)))}
`;

// 原生发送路径与媒体占位文字的最小片段（锚点同 tests/send-echo.test.mjs）。
const sendPath = 'async function $h(e,o,c,s,a,l,d,u,m,send){try{let r=a.skillWorkshopRevision?await Bh(e,{}):await Rh(e,{message:o,attachments:c?s:void 0,runId:u,sessionKey:l,agentId:a.agentId});if(r.status===`error`)return`failed`;if(Vh(e,o,c?s:void 0,d,r.runId),r.status===`ok`)return`sent`;return`sent`}catch(r){let i=ls(r);return Yh(r,i)?(od(e),`pending`):`failed`}}';
const captionStrip = 'function Tn(e){if(!e)return e;let t=e.replace(un,``);if(!vn.test(t))return t;return t}';

const THINKING_SEGMENTS = '/* pinkie-thinking-segments:v1 */';

// c092fc4b：已带当前版本号、但缺少分段思考标记的安装包，必须原地升级，
// 而不是被当成 already-patched 跳过（否则历史思考永远不分段）。
test('c092fc4b：当前版本号但缺分段思考标记的 bundle 会被原地升级', () => {
  const current = transformWithStatus(bundleFixture);
  assert.equal(current.changed, true, current.reason);
  assert.ok(current.text.includes(`\n${THINKING_SEGMENTS}`));
  const installed = current.text.replace(`\n${THINKING_SEGMENTS}`, '');
  assert.equal(installed.includes(THINKING_SEGMENTS), false);

  const upgraded = transformWithStatus(installed);
  assert.equal(upgraded.changed, true, upgraded.reason);
  assert.match(upgraded.reason, /^upgraded-v\d+$/u);
  assert.ok(upgraded.text.includes(THINKING_SEGMENTS));
  assert.equal(upgraded.text.split(THINKING_SEGMENTS).length, 2, '只插入一次');
  assert.doesNotThrow(() => new vm.Script(upgraded.text));
  assert.equal(transformWithStatus(upgraded.text).reason, 'already-patched');
});

// b2aafe75：发送路径的两处小修复叠加在每条路径上（全新、升级、已打过补丁）。
// send-echo.test.mjs 只测两个函数本身，没测 transformBundle 是否真的调用它们。
test('b2aafe75：早显用户气泡与媒体占位修复在全新与已打补丁两条路径上都会叠加', () => {
  const fresh = transformWithStatus(`${bundleFixture}\n${sendPath}\n${captionStrip}\n`);
  assert.equal(fresh.changed, true, fresh.reason);
  assert.equal(fresh.reason, 'patched');
  assert.match(fresh.text, /pinkie-early-user-echo:v1/u);
  assert.match(fresh.text, /pinkie-media-caption:v1/u);
  assert.doesNotThrow(() => new vm.Script(fresh.text));

  // 先只打时间线补丁，再把原生发送路径接上：核心判定 already-patched，
  // 外层仍要补上两处发送修复，并报告 send-path-updated。
  const timelineOnly = transformWithStatus(bundleFixture).text;
  assert.doesNotMatch(timelineOnly, /pinkie-early-user-echo:v1/u);
  const later = transformWithStatus(`${timelineOnly}\n${sendPath}\n${captionStrip}\n`);
  assert.equal(later.changed, true, later.reason);
  assert.equal(later.reason, 'send-path-updated');
  assert.match(later.text, /pinkie-early-user-echo:v1/u);
  assert.match(later.text, /pinkie-media-caption:v1/u);
  assert.deepEqual(transformWithStatus(later.text), {text: later.text, changed: false, reason: 'already-patched'});
});

// 22c69832：只靠 provenance 识别的会话间通知（如 Metre 子会话汇报，正文没有固定前缀）
// 也不是用户气泡；但 isUser=true 的转述是用户的话，必须保留。
// chat-tool-timeline 里的同类测试只用了带固定前缀的正文，回退 provenance 分支它仍绿。
test('22c69832：只凭 provenance 识别的子会话汇报不成气泡，isUser=true 的转述保留', () => {
  const report = message('user', '子会话「整理笔记」交回了结果：三条都改好了。', 'report',
    {provenance: {kind: 'inter_session', sourceTool: 'sessions_send', isUser: false}});
  const relay = message('user', '再帮我核一遍第二条。', 'relay',
    {provenance: {kind: 'inter_session', sourceTool: 'sessions_send', isUser: true}});
  const entries = [
    group('user', 'ask', [message('user', '整理一下笔记', 'ask')]),
    group('assistant', 'answer', [message('assistant', '交给子会话去整理了。', 'answer', {stopReason: 'stop'})]),
    group('user', 'report', [report]),
    group('assistant', 'late', [message('assistant', '整理好了，三条都改完。', 'late', {stopReason: 'stop'})]),
    group('user', 'relay', [relay]),
    group('assistant', 'reply', [message('assistant', '第二条核过了。', 'reply', {stopReason: 'stop'})]),
  ];
  const timeline = pinkieBuildTimeline(entries, () => []);
  const users = timeline.filter((item) => String(item?.role || '').toLowerCase() === 'user').map(idOf);
  assert.deepEqual(users, ['ask', 'relay'], '汇报不成气泡，转述保留');
  const replies = timeline.filter((item) => !item.isProcessCard && item.role === 'assistant').map(idOf);
  assert.deepEqual(replies, ['answer', 'late', 'reply'], '每条回复都还在');
});

// a2514d6e：同一 callId 的结果被改写过（先 partial 后 final）时只保留最后一份，
// 且不会多出一行孤立结果。旧逻辑取第一份并 break，第二份变成单独一行。
test('a2514d6e：同一 callId 的多份结果只保留最后一份，不多出孤立结果行', () => {
  const rows = pinkieSplitTimelineMessage({key: 'm', message: {role: 'assistant', content: [
    {type: 'tool_call', callId: 'c1', name: 'exec', arguments: {command: 'npm test'}},
    {type: 'tool_result', callId: 'c1', name: 'exec', text: 'partial'},
    {type: 'tool_result', callId: 'c1', name: 'exec', text: 'final'},
  ]}}, () => []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'tool');
  const results = rows[0].message.content.filter((part) => part.type === 'tool_result');
  assert.deepEqual(results.map((part) => part.text), ['final']);
});

// a2514d6e：只有结果部件、解析器又给出同一 callId 的调用时，这个调用已被结果行用掉，
// 不能再生成一行兜底调用（否则同一步出现两次）。
test('a2514d6e：结果行已占用的解析调用不再生成重复的兜底行', () => {
  const rows = pinkieSplitTimelineMessage({key: 'm', message: {role: 'assistant', content: [
    {type: 'tool_result', callId: 'r1', name: 'read', text: 'ok'},
  ]}}, () => [{callId: 'r1', name: 'read', outputText: 'ok'}]);
  assert.equal(rows.length, 1, '同一步只有一行');
  assert.equal(rows[0].role, 'tool');
});

// a2514d6e：stopReason=toolUse 的开场白（工具前的旁白）不是最终回复，
// 必须留在过程卡里，而不是被当成最终气泡挂在卡片外面。
test('a2514d6e：工具前旁白不会被当成最终回复气泡', () => {
  const entries = [
    group('user', 'ask', [message('user', '跑一下测试', 'ask')]),
    group('tool', 'step', [
      message('assistant', [{type: 'tool_call', callId: 'x1', name: 'exec', arguments: {}}], 'call', {stopReason: 'toolUse'}),
      message('tool', [{type: 'tool_result', callId: 'x1', name: 'exec', text: 'fail'}], 'result'),
    ]),
    group('assistant', 'say', [message('assistant', '我再跑一遍测试。', 'say', {stopReason: 'toolUse'})]),
  ];
  const timeline = pinkieBuildTimeline(entries, () => []);
  const outside = timeline.filter((item) => !item.isProcessCard && item.role === 'assistant').map(idOf);
  assert.deepEqual(outside, [], '旁白不在卡片外');
  const card = timeline.find((item) => item.isProcessCard);
  assert.ok(card, '有过程卡');
  const inside = card.processRows.flatMap((row) => row.messages || []).map((entry) => JSON.stringify(entry.message?.content));
  assert.ok(inside.some((text) => text.includes('我再跑一遍测试。')), '旁白在卡片里');
});
