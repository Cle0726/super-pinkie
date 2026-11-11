// Plan B §1: a run interrupted by a follow-up message keeps its process card.
// Native control-ui appends the steered user row to chatMessages, while the
// live tool stream renders after all messages, so the earlier run's tool rows
// used to land under the new message and the old card emptied out.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'patch', 'apply-chat-timeline.mjs')).href);

const msg = (role, content, id, timestamp, extra = {}) => ({role, content, timestamp, __openclaw: {id}, ...extra});
const group = (role, key, timestamp, messages) => ({kind: 'group', key, role, timestamp,
  messages: messages.map((message, index) => ({message, key: `${key}:${index}`}))});
const toolCall = (id, at) => group('tool', `call-${id}`, at, [
  msg('assistant', [{type: 'tool_call', callId: id, name: 'exec', arguments: {command: `step ${id}`}}], `a-${id}`, at),
  msg('tool', [{type: 'tool_result', callId: id, name: 'exec', text: 'ok'}], `r-${id}`, at + 1),
]);
function calls(message) {
  const out = [];
  for (const part of Array.isArray(message.content) ? message.content : []) {
    const type = String(part?.type || '').toLowerCase().replace(/[_-]/g, '');
    if (type === 'toolcall') out.push({callId: part.callId, name: part.name, args: part.arguments});
    if (type === 'toolresult') {
      const call = out.find(c => c.callId === part.callId) || (out.push({callId: part.callId, name: part.name}), out.at(-1));
      call.outputText = part.text;
    }
  }
  return out;
}
const cards = (timeline) => timeline.filter(item => item.isProcessCard);
const toolRows = (card) => card.processRows.filter(row => String(row.role).toLowerCase() === 'tool').length;

for (const n of [0, 1, 10]) {
  test(`steer during a run with ${n} tool call(s): the earlier card keeps every row`, async () => {
    const {pinkieBuildTimeline} = await load();
    const u1 = group('user', 'u1', 1000, [msg('user', 'first ask', 'u1', 1000, {idempotencyKey: 'run-1:user'})]);
    const earlier = Array.from({length: n}, (_, i) => toolCall(`t${i}`, 2000 + i * 10));
    // Optimistic steered row (native Vh): appended to chatMessages, newer timestamp.
    const u2 = group('user', 'u2', 9000, [msg('user', 'also do this', 'u2', 9000, {__pinkieOptimisticRunId: 'run-2'})]);
    const later = [toolCall('after', 9500)];
    // Live layout before history sync: [history..., u2, ...toolMessages].
    const live = pinkieBuildTimeline([u1, u2, ...earlier, ...later], calls);
    // Layout after history sync: transcript order.
    const synced = pinkieBuildTimeline([u1, ...earlier, u2, ...later], calls);
    for (const timeline of [live, synced]) {
      const [first, second] = cards(timeline);
      if (n) {
        assert.ok(first, 'the interrupted run still has its card');
        assert.equal(toolRows(first), n);
        assert.equal(first.processTitle, '这一轮被你的新消息接上了');
        assert.equal(first.processState, '');
        assert.equal(first.processRunId, 'run-1');
        assert.equal(toolRows(second), 1);
      } else {
        assert.equal(toolRows(cards(timeline).at(-1)), 1);
      }
    }
    // Keys are the run id, identical before and after the sync.
    assert.deepEqual(cards(live).map(c => c.key), cards(synced).map(c => c.key));
  });
}

test('a duplicated live row that history already holds is shown once', async () => {
  const {pinkieBuildTimeline} = await load();
  const u1 = group('user', 'u1', 1000, [msg('user', 'go', 'u1', 1000, {idempotencyKey: 'run-1:user'})]);
  const u2 = group('user', 'u2', 9000, [msg('user', 'more', 'u2', 9000, {idempotencyKey: 'run-2:user'})]);
  const timeline = pinkieBuildTimeline([u1, toolCall('x', 2000), u2, toolCall('x', 2000), toolCall('y', 9500)], calls);
  const [first, second] = cards(timeline);
  assert.equal(toolRows(first), 1);
  assert.equal(toolRows(second), 1);
});

test('a run stopped by error before the next message still reads as stopped', async () => {
  const {pinkieBuildTimeline} = await load();
  const u1 = group('user', 'u1', 1000, [msg('user', 'go', 'u1', 1000)]);
  const failed = group('assistant', 'fail', 3000, [msg('assistant', 'boom', 'fail', 3000, {stopReason: 'error'})]);
  const u2 = group('user', 'u2', 9000, [msg('user', 'retry', 'u2', 9000)]);
  const [first] = cards(pinkieBuildTimeline([u1, toolCall('a', 2000), failed, u2], calls));
  assert.equal(first.processTitle, '这一轮停下来了');
});

test('the rendered card carries the run id and the prior key for thought migration', async () => {
  const {processBranchSource} = await load();
  const source = processBranchSource('X');
  assert.match(source, /data-pinkie-run=/);
  assert.match(source, /data-pinkie-prior=/);
});

// Real-model check 11-10: the 碧琪 skin hides every closed, finished card
// (laolao-cle-stage.css), so a superseded card that defaults to closed vanished
// from the screen right after the follow-up, rows and all. The cards of the
// job still in progress (the latest turn plus the superseded runs leading into
// it) stay open; an older finished turn keeps its collapsed default.
test('superseded cards leading into the latest turn stay open; finished older turns do not', async () => {
  const {pinkieBuildTimeline, pinkieProcessOpen} = await load();
  globalThis.__pinkieTimelineViews = new Map();
  const u0 = group('user', 'u0', 100, [msg('user', 'earlier job', 'u0', 100)]);
  const done = [toolCall('d0', 200), group('assistant', 'final0', 300, [msg('assistant', [{type: 'text', text: 'all done'}], 'f0', 300)])];
  const u1 = group('user', 'u1', 1000, [msg('user', 'first ask', 'u1', 1000)]);
  const run1 = [toolCall('a', 2000), toolCall('b', 2010)];
  const u2 = group('user', 'u2', 3000, [msg('user', 'append 1', 'u2', 3000)]);
  const run2 = [toolCall('c', 3500)];
  const u3 = group('user', 'u3', 4000, [msg('user', 'append 2', 'u3', 4000)]);
  const run3 = [toolCall('e', 4500)];
  const timeline = pinkieBuildTimeline([u0, ...done, u1, ...run1, u2, ...run2, u3, ...run3], calls);
  const [older, first, second, latest] = cards(timeline);
  assert.equal(first.processSuperseded, true);
  assert.equal(second.processSuperseded, true);
  assert.equal(pinkieProcessOpen(first), true, 'first superseded run stays open');
  assert.equal(pinkieProcessOpen(second), true, 'second superseded run stays open');
  assert.equal(pinkieProcessOpen(latest), true);
  assert.equal(pinkieProcessOpen(older), false, 'a finished earlier job keeps its collapsed default');
});


// Real-model check 11-10, one exec call: the follow-up's turn only replied
// (no tools, so no card of its own). The interrupted card must still stay open.
test('a superseded card stays open when the latest turn has no card of its own', async () => {
  const {pinkieBuildTimeline, pinkieProcessOpen} = await load();
  globalThis.__pinkieTimelineViews = new Map();
  const u1 = group('user', 'u1', 1000, [msg('user', 'run one', 'u1', 1000)]);
  const run1 = [toolCall('one', 2000)];
  const u2 = group('user', 'u2', 3000, [msg('user', 'append 1', 'u2', 3000)]);
  const reply = group('assistant', 'final', 4000, [msg('assistant', [{type: 'text', text: 'done'}], 'f', 4000)]);
  const [only] = cards(pinkieBuildTimeline([u1, ...run1, u2, reply], calls));
  assert.equal(only.processSuperseded, true);
  assert.equal(pinkieProcessOpen(only), true);
});

// Real-model check 11-10 (hy4free, 10 exec calls, 3 follow-ups): native chat
// orders items by message timestamp. A follow-up keeps the time it was sent,
// earlier than the result of the command still running then, so after a
// refresh that result jumped behind the follow-up into the next card. A user
// message the transcript recorded is ordered by its record time instead.
test('a recorded follow-up is ordered by when the transcript stored it', async () => {
  const {withRecordedUserOrder} = await load();
  const native = 'function Vb(e){switch(e.kind){case`message`:return e.key===`chat:history:notice`?-1/0:Bb(e.message);case`divider`:return e.timestamp;case`stream`:return e.startedAt}return null}';
  const patched = withRecordedUserOrder(native);
  assert.notEqual(patched, native);
  assert.equal(withRecordedUserOrder(patched), patched, 'idempotent');
  const Vb = new Function('Bb', `${patched};return Vb;`)(m => m.timestamp);
  const item = message => ({kind: 'message', key: 'k', message});
  const result = {role: 'toolResult', timestamp: 1300, __openclaw: {seq: 29, recordTimestampMs: 1300}};
  const steer = {role: 'user', timestamp: 1200, __openclaw: {seq: 30, recordTimestampMs: 1301}};
  const optimistic = {role: 'user', timestamp: 1200};
  assert.ok(Vb(item(steer)) > Vb(item(result)));
  assert.equal(Vb(item(optimistic)), 1200, 'an unsaved row keeps its send time');
  assert.equal(Vb(item(result)), 1300, 'other roles are unchanged');
  assert.equal(Vb({kind: 'message', key: 'chat:history:notice', message: steer}), -Infinity);
});

// Real-model check 11-10: while a steered run is live the runtime briefly
// holds two copies of the follow-up (same idempotency key), and native chat
// folded them as "×2", as if the user had sent it twice. One send stored twice
// is one message; a real repeat still counts.
test('two stored copies of one send fold without a duplicate count', async () => {
  const {withSameSendFold} = await load();
  const native = 'function Fb(e){let t=[],n=null,r=null;for(let i of e){if(i.kind!==`message`){t.push(i),n=null,r=null;continue}let e=Pb(i.message),a=Ob(i.message),o=t[t.length-1];if(a&&r===a&&o?.kind===`message`&&Nb(o.message,i.message)){continue}if(e&&n===e&&o?.kind===`message`&&!(a&&r&&a!==r)){o.duplicateCount=(o.duplicateCount??1)+1;continue}t.push(i),n=e,r=a}return t}';
  const patched = withSameSendFold(native);
  assert.notEqual(patched, native);
  assert.equal(withSameSendFold(patched), patched, 'idempotent');
  const Fb = new Function('Pb', 'Ob', 'Nb', `${patched};return Fb;`)(m => `user:${m.content}`, () => null, () => false);
  const item = (content, extra = {}) => ({kind: 'message', message: {role: 'user', content, ...extra}});
  const same = Fb([item('追加 1', {idempotencyKey: 'run-2:user'}), item('追加 1', {__openclaw: {idempotencyKey: 'run-2:user'}})]);
  assert.equal(same.length, 1);
  assert.equal(same[0].duplicateCount, undefined);
  const repeat = Fb([item('again', {idempotencyKey: 'a:user'}), item('again', {idempotencyKey: 'b:user'})]);
  assert.equal(repeat.length, 1);
  assert.equal(repeat[0].duplicateCount, 2);
});
