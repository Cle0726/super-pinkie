import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundJobs, MAX_BUSY_WAIT_MS, WAKE_PREFIX, WAKE_RETRY_MS, rememberKinds, runningBackgroundJobs, softenWaitNudge, waitNudge, wakeMessage} from '../services/mode-architecture/background-jobs.mjs';

const STATE = Symbol.for('pinkie.backgroundJobs.v1');
function fresh(options = {}) {
  if (globalThis[STATE]?.timer) clearInterval(globalThis[STATE].timer);
  delete globalThis[STATE];
  const sent = [];
  const live = new Set();
  let clock = 1_000;
  const jobs = new BackgroundJobs({
    runProcess: async (file, args) => { sent.push(JSON.parse(args[args.indexOf('--params') + 1])); return {stdout: '{"ok":true}'}; },
    cliEntry: '/x/openclaw.mjs',
    now: () => clock,
    alive: (pid) => live.has(pid),
    pollMs: 60_000,
    ...options,
  });
  return {jobs, sent, live, advance: (ms) => { clock += ms; }};
}
const running = (id, pid) => ({toolName: 'exec', params: {command: 'npm run build', background: true}, result: {content: [{type: 'text', text: `Command still running (session ${id}, pid ${pid}). Use process (list/poll/log/write/send-keys/submit/paste/kill/clear/remove) for follow-up.`}]}});
const ctx = {sessionKey: 'agent:project:abc'};

test('only the background waiting reminder is recorded as deferred instead of an error', () => {
  const reason = waitNudge([{command: 'render', startedAt: 0}], [], 5000);
  const message = {role: 'toolResult', isError: true, content: [{type: 'text', text: reason}],
    details: {status: 'blocked', deniedReason: 'plugin-before-tool-call', reason}};
  const softened = softenWaitNudge(message);
  assert.equal(softened.isError, false);
  assert.equal(softened.details.status, 'deferred');
  assert.deepEqual(softened.content, message.content);
  assert.equal(softenWaitNudge({...message, details: {...message.details, deniedReason: 'tool-loop'}}), null);
  assert.equal(softenWaitNudge({...message, content: [{text: 'Process exited with code 1'}]}), null);
  assert.equal(softenWaitNudge({role: 'assistant'}), null);
});

test('a backgrounded exec is watched and wakes the same session with a hidden message when it exits', async () => {
  const {jobs, sent, live, advance} = fresh();
  live.add(4242);
  const job = jobs.afterTool(running('tidal-harbor', 4242), ctx);
  assert.equal(job.execId, 'tidal-harbor');
  assert.equal(jobs.runningFor('agent:project:abc').length, 1);
  await jobs.tick();
  assert.equal(sent.length, 0, 'still running');
  live.delete(4242);
  advance(42_000);
  await jobs.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessionKey, 'agent:project:abc');
  assert.equal(sent[0].agentId, 'project');
  assert.equal(sent[0].deliver, false);
  assert.ok(sent[0].message.startsWith(WAKE_PREFIX), 'the chat timeline hides [pinkie-tier] messages');
  assert.match(sent[0].message, /process 工具的 log/);
  assert.match(sent[0].message, /用时约 42 秒/);
  await jobs.tick();
  assert.equal(sent.length, 1, 'woken once');
  assert.deepEqual(jobs.status('agent:project:abc').map(({state, woke}) => [state, woke]), [['done', true]]);
});

test('no wake when the agent already read the exit itself, and none while the session is still busy', async () => {
  let busy = true;
  const {jobs, sent, live} = fresh({isBusy: () => busy});
  live.add(1);
  jobs.afterTool(running('quick-one', 1), ctx);
  jobs.afterTool({toolName: 'process', params: {action: 'poll', sessionId: 'quick-one'}, result: {content: [{type: 'text', text: 'done\n\nProcess exited with code 0.'}], details: {status: 'completed'}}}, ctx);
  live.delete(1);
  await jobs.tick();
  assert.equal(sent.length, 0);
  live.add(2);
  jobs.afterTool(running('slow-one', 2), ctx);
  live.delete(2);
  await jobs.tick();
  assert.equal(sent.length, 0, 'waits while the agent is still answering');
  busy = false;
  await jobs.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /slow-one/);
});

test('a busy mark that never clears does not hold the wake back forever', async () => {
  const logs = [];
  const {jobs, sent, live, advance} = fresh({isBusy: () => true, logger: {info: t => logs.push(t), warn: t => logs.push(t)}});
  live.add(7);
  jobs.afterTool(running('faint-lobster', 7), {sessionKey: 'agent:metre:dashboard:x'});
  live.delete(7);
  await jobs.tick();
  advance(MAX_BUSY_WAIT_MS - 1_000);
  await jobs.tick();
  assert.equal(sent.length, 0, 'still waiting while the session may really be answering');
  advance(2_000);
  await jobs.tick();
  assert.equal(sent.length, 1, 'woken after the cap; the gateway queues it behind any live turn');
  assert.equal(sent[0].sessionKey, 'agent:metre:dashboard:x');
  assert.ok(logs.some(t => /waiting session=agent:metre:dashboard:x/.test(t)));
  assert.ok(logs.some(t => /waking anyway/.test(t)));
});

test('a failed wake is retried with growing gaps and only given up after every retry, with a log line', async () => {
  const logs = [];
  let ok = false, calls = 0;
  const {jobs, live, advance} = fresh({
    runProcess: async () => { calls += 1; if (!ok) throw new Error('gateway restarting'); return {stdout: '{"ok":true}'}; },
    logger: {info: t => logs.push(t), warn: t => logs.push(t)},
  });
  live.add(8);
  jobs.afterTool(running('tidal-mist', 8), ctx);
  live.delete(8);
  await jobs.tick();
  assert.equal(calls, 1);
  await jobs.tick();
  await jobs.tick();
  assert.equal(calls, 1, 'no hammering within the retry gap');
  advance(WAKE_RETRY_MS[0]);
  await jobs.tick();
  assert.equal(calls, 2);
  ok = true;
  advance(WAKE_RETRY_MS[1]);
  await jobs.tick();
  assert.equal(calls, 3);
  assert.deepEqual(jobs.status('agent:project:abc').map(({woke}) => woke), [true]);
  assert.ok(logs.some(t => /attempt 1 failed/.test(t)) && logs.some(t => /^background wake sent/.test(t)));

  const gaveUp = [];
  const again = fresh({runProcess: async () => { throw new Error('down'); }, logger: {info() {}, warn: t => gaveUp.push(t)}});
  again.live.add(9);
  again.jobs.afterTool(running('dead', 9), ctx);
  again.live.delete(9);
  for (let i = 0; i <= WAKE_RETRY_MS.length; i++) {
    await again.jobs.tick();
    again.advance(WAKE_RETRY_MS[Math.min(i, WAKE_RETRY_MS.length - 1)]);
  }
  assert.ok(gaveUp.some(t => /gave up after 6 failed attempts/.test(t)));
});

test('only real chat sessions are watched, and foreground results are ignored', () => {
  const {jobs} = fresh();
  assert.equal(jobs.afterTool(running('x', 9), {sessionKey: 'agent:project:subagent:child'}), null);
  assert.equal(jobs.afterTool(running('x', 9), {sessionKey: 'agent:other:abc'}), null);
  assert.equal(jobs.afterTool({toolName: 'exec', params: {}, result: 'hello\n'}, ctx), null);
  assert.equal(jobs.runningFor('agent:project:abc').length, 0);
  assert.match(wakeMessage({execId: 'a', command: 'make', startedAt: 0, endedAt: 3000}), /用时约 3 秒/);
});

test('wake-up tells 碧琪 to merge what she did while waiting, and the running list is read-only', () => {
  const text = wakeMessage({execId: 'a', command: 'render', startedAt: 0, endedAt: 1000});
  assert.match(text, /等它的时候做好的部分合进来/);
  assert.match(text, /亲眼验证/);
  const STATE = Symbol.for('pinkie.backgroundJobs.v1');
  const shared = globalThis[STATE] ||= {jobs: new Map(), timer: null};
  const owner = shared.owner;
  shared.jobs.set('bg-r1', {id: 'bg-r1', sessionKey: 'agent:main:r', state: 'running', command: 'x', startedAt: 0});
  shared.jobs.set('bg-r2', {id: 'bg-r2', sessionKey: 'agent:main:r', state: 'done', command: 'y', startedAt: 0});
  try {
    assert.deepEqual(runningBackgroundJobs('agent:main:r').map(job => job.id), ['bg-r1']);
    assert.deepEqual(runningBackgroundJobs(''), []);
    assert.equal(shared.owner, owner, 'reading must not install a new waker');
  } finally { shared.jobs.delete('bg-r1'); shared.jobs.delete('bg-r2'); }
});

test('a second wait in a row on a running job is turned into the while-waiting list; real work resets it', () => {
  const STATE = Symbol.for('pinkie.backgroundJobs.v1');
  const shared = globalThis[STATE] ||= {jobs: new Map(), timer: null};
  const jobs = new BackgroundJobs({now: () => 100_000});
  const sessionKey = 'agent:thinking:wait';
  shared.jobs.set('bg-w1', {id: 'bg-w1', sessionKey, state: 'running', command: 'python3 render.py', startedAt: 40_000});
  rememberKinds(sessionKey, ['video_motion']);
  const ctx = {sessionKey};
  const poll = {toolName: 'process', params: {action: 'poll', sessionId: 'x', timeout: 25000}};
  try {
    assert.equal(jobs.beforeTool({toolName: 'process', params: {action: 'log', sessionId: 'x'}}, ctx), null, 'first look is fine');
    const blocked = jobs.beforeTool(poll, ctx);
    assert.equal(blocked?.block, true);
    assert.match(blocked.blockReason, /「python3 render\.py」（已跑约 60 秒）还在后台跑/);
    assert.match(blocked.blockReason, /抽帧/, 'video list');
    assert.equal(jobs.beforeTool({toolName: 'exec', params: {command: 'ps aux | grep render.py | grep -v grep'}}, ctx)?.block, true, 'ps is waiting too');
    assert.equal(jobs.beforeTool({toolName: 'exec', params: {command: 'sleep 20'}}, ctx)?.block, true);
    assert.equal(jobs.beforeTool({toolName: 'write', params: {path: 'cover.html'}}, ctx), null, 'real work');
    assert.equal(jobs.beforeTool(poll, ctx), null, 'streak reset');
    assert.equal(jobs.beforeTool({toolName: 'exec', params: {command: 'ls output && python3 make_cover.py'}}, ctx), null, 'mixed command is work');
    // stuck case: after 4 blocked waits in a row it lets the wait through
    jobs.beforeTool(poll, ctx);
    let allowed = 0;
    for (let i = 0; i < 6; i += 1) if (!jobs.beforeTool(poll, ctx)) allowed += 1;
    assert.ok(allowed >= 1);
    assert.equal(jobs.beforeTool(poll, {sessionKey: 'agent:unrestricted:wait'}), null, 'not in unrestricted mode');
    shared.jobs.get('bg-w1').state = 'done';
    assert.equal(jobs.beforeTool(poll, ctx), null, 'nothing running → no guard');
    assert.match(waitNudge([{command: 'x', startedAt: 0}], [], 5000), /写好交付说明/, 'generic list');
  } finally { shared.jobs.delete('bg-w1'); shared.waitStreak?.delete(sessionKey); shared.kinds?.delete(sessionKey); }
});

test('waiting right after a job goes to the background is turned into the while-waiting list the first time too', () => {
  // 11-04 routes-m R-ad: both runs did exec (still running) → process poll at once; the judge marked both down.
  const {jobs} = fresh();
  const sessionKey = 'agent:thinking:first-wait';
  const ctx = {sessionKey};
  rememberKinds(sessionKey, ['video_motion']);
  const poll = {toolName: 'process', params: {action: 'poll', sessionId: 'vivid-orbit', timeout: 15000}};
  try {
    jobs.afterTool({...running('vivid-orbit', 8630), params: {command: 'python3 render_video.py'}}, ctx);
    const first = jobs.beforeTool(poll, ctx);
    assert.equal(first?.block, true, 'no work since the start: blocked');
    assert.match(first.blockReason, /「python3 render_video\.py」.*还在后台跑/);
    assert.match(first.blockReason, /抽帧/);
    assert.equal(jobs.beforeTool(poll, ctx)?.block, true, 'still nothing done: second wait in a row is blocked as before');
    assert.equal(jobs.beforeTool({toolName: 'write', params: {path: 'cover.html'}}, ctx), null, 'real work');
    assert.equal(jobs.beforeTool(poll, ctx), null, 'a wait after doing something is fine');

    // Work between the start and the first wait: that wait is not blocked.
    jobs.afterTool({...running('lucky-crest', 10428), params: {command: 'python3 render_video.py'}}, ctx);
    assert.equal(jobs.beforeTool({toolName: 'exec', params: {command: 'python3 make_cover.py'}}, ctx), null);
    assert.equal(jobs.beforeTool(poll, ctx), null);
  } finally {
    const shared = globalThis[Symbol.for('pinkie.backgroundJobs.v1')];
    shared?.waitStreak?.delete(sessionKey); shared?.kinds?.delete(sessionKey); shared?.idleSinceStart?.delete(sessionKey);
    if (shared?.timer) clearInterval(shared.timer);
  }
});
