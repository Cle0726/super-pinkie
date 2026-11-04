import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundJobs, WAKE_PREFIX, rememberKinds, runningBackgroundJobs, waitNudge, wakeMessage} from '../services/mode-architecture/background-jobs.mjs';

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
