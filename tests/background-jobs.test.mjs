import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundJobs, WAKE_PREFIX, runningBackgroundJobs, wakeMessage} from '../services/mode-architecture/background-jobs.mjs';

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
