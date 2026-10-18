import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEvent, pace, holdFor, stateFor, kindOf, argText, newRun, fmtElapsed,
  MIN_STEP, DONE_HOLD, STOP_HOLD,
} from '../services/cle-studio/src/process/model.js';

const tool = (phase, name, args = {}, id = 't1') => ({
  sessionKey: 'agent:main:main', stream: 'tool', data: {phase, name, toolCallId: id, args},
});
const lifecycle = (phase, extra = {}) => ({sessionKey: 'agent:main:main', stream: 'lifecycle', data: {phase, ...extra}});

test('a run starts from lifecycle start and holds its real start time', () => {
  const run = newRun(1000, 500);
  assert.equal(run.on, true);
  assert.equal(run.since, 500);
  assert.equal(run.tools, 0);
});

test('tool names map to the same choreography kinds as the original stage', () => {
  assert.equal(kindOf('exec'), 'exec');
  assert.equal(kindOf('process'), 'exec');
  assert.equal(kindOf('read'), 'read');
  assert.equal(kindOf('grep'), 'read');
  assert.equal(kindOf('apply_patch'), 'edit');
  assert.equal(kindOf('edit'), 'edit');
  assert.equal(kindOf('write'), 'write');
  assert.equal(kindOf('plan_update'), 'plan');
  // the original stage had no read rule for code_check; keep the same behaviour rather than
  // quietly inventing a different choreography for one tool
  assert.equal(kindOf('code_check'), 'exec');
  assert.equal(kindOf('clekk_memory'), 'exec');
});

test('the status line shows the command or the file, not the raw args object', () => {
  assert.deepEqual(argText('exec', {command: 'git status --short'}), {text: 'git status --short', mono: true});
  assert.deepEqual(argText('read', {path: '/Users/Admin/notes.md', offset: 10, limit: 5}), {text: '~/notes.md:10–14', mono: true});
  assert.deepEqual(argText('grep', {query: '粒子 视口'}), {text: '粒子 视口', mono: false});
  // the in-progress plan item, not the whole list
  assert.equal(argText('plan_update', {items: [{text: 'a', status: 'completed'}, {text: '正在改文本', status: 'in_progress'}]}).text, '正在改文本');
  assert.equal(argText('exec', {}).text, '');
});

test('a 40 ms tool is still held long enough to be seen', () => {
  const run = newRun(0);
  const t0 = 10_000;
  applyEvent(run, tool('start', 'exec', {command: 'ls'}), t0);
  const first = pace(run, t0);
  assert.equal(first.kind, 'exec');
  assert.equal(first.text, 'ls');
  // the result lands immediately
  applyEvent(run, tool('result', 'exec'), t0 + 40);
  // …but the step is not yanked away before MIN_STEP
  const still = pace(run, t0 + 200);
  assert.equal(still.kind, 'exec');
  assert.equal(holdFor(run, t0 + 200), MIN_STEP - 200);
  // and once the hold passes, the queue drains / falls back to the background step
  applyEvent(run, {sessionKey: 'agent:main:main', stream: 'thinking', data: {}}, t0 + 300);
  const after = pace(run, t0 + MIN_STEP + 1);
  assert.equal(after.kind, 'think');
});

test('queued tools play in order, one hold each, and never drop a real step', () => {
  const run = newRun(0);
  applyEvent(run, tool('start', 'read', {path: '/a.md'}, 'a'), 0);
  applyEvent(run, tool('start', 'exec', {command: 'npm test'}, 'b'), 0);
  applyEvent(run, tool('result', 'read', {}, 'a'), 5);
  applyEvent(run, tool('result', 'exec', {}, 'b'), 6);
  const seen = [];
  let now = 0;
  for (let i = 0; i < 40; i++) {
    const step = pace(run, now);
    const key = `${step.kind}:${step.text}`;
    if (seen[seen.length - 1] !== key) seen.push(key);
    now += 100;
  }
  assert.ok(seen.includes('read:/a.md'), 'read step shown');
  assert.ok(seen.includes('exec:npm test'), 'exec step shown');
  assert.equal(run.tools, 2);
});

test('a prefix of prep phases does not stack duplicate entries', () => {
  const run = newRun(0);
  for (let i = 0; i < 5; i++) applyEvent(run, {sessionKey: 'k', stream: 'run_status', data: {phase: 'preparing_workspace'}});
  assert.equal(run.queue.length, 1);
  applyEvent(run, {sessionKey: 'k', stream: 'run_status', data: {phase: 'starting_model'}});
  assert.equal(run.queue.length, 2);
});

test('thinking / assistant do not force a repaint while nothing changed', () => {
  const run = newRun(0);
  assert.equal(applyEvent(run, {sessionKey: 'k', stream: 'assistant', data: {text: 'a'}}), true);
  assert.equal(applyEvent(run, {sessionKey: 'k', stream: 'assistant', data: {text: 'ab'}}), false);
});

test('end and error produce the right收束, and abort is not reported as completion', () => {
  const ok = newRun(0);
  applyEvent(ok, lifecycle('end'), 5000);
  assert.equal(ok.on, false);
  assert.equal(ok.stopped, false);
  assert.equal(ok.endedAt, 5000);

  const err = newRun(0);
  applyEvent(err, lifecycle('error'), 5000);
  assert.equal(err.stopped, true);

  const aborted = newRun(0);
  applyEvent(aborted, lifecycle('end', {aborted: true}), 5000);
  assert.equal(aborted.stopped, true, 'aborted runs are stopped, never signed off as 完成');

  const chat = newRun(0);
  applyEvent(chat, {sessionKey: 'k', stream: 'chat', state: 'aborted'});
  assert.equal(chat.stopped, true);
});

test('stateFor maps every step to a renderer state that exists', () => {
  for (const kind of ['think', 'read', 'write', 'edit', 'exec', 'ask', 'plan', 'reply']) {
    assert.ok(['idle', 'think', 'read', 'write', 'edit', 'done'].includes(stateFor(kind)), kind);
  }
  assert.equal(stateFor('done'), 'done');
  assert.equal(stateFor('stopped'), 'idle', 'an interrupted run collapses quietly, no 落款');
  assert.equal(stateFor('edit'), 'edit');
});

test('elapsed text is seconds then minutes, and never negative', () => {
  assert.equal(fmtElapsed(0), '0 秒');
  assert.equal(fmtElapsed(1400), '1 秒');
  assert.equal(fmtElapsed(65_000), '1 分 5 秒');
  assert.equal(fmtElapsed(-4000), '0 秒');
});

test('holds are bounded: a signed run lasts DONE_HOLD, an interrupted one STOP_HOLD', () => {
  assert.ok(DONE_HOLD > 4000, 'the 落款 needs room for the quill signature');
  assert.ok(STOP_HOLD < DONE_HOLD);
});

test('approval requests become 等你确认 and clear when resolved', () => {
  const run = newRun(0);
  applyEvent(run, {sessionKey: 'k', stream: 'execution', data: {approval: {id: 'x', state: 'pending', label: 'Run npm publish?'}}});
  const step = pace(run, 0);
  assert.equal(step.kind, 'ask');
  assert.equal(step.text, 'Run npm publish?');
  applyEvent(run, {sessionKey: 'k', stream: 'execution', data: {approval: {id: 'x', state: 'resolved'}}});
  assert.equal(run.cur.done, true, 'the step already on screen is the one that resolves');
});
