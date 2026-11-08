import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bundle = fs.readFileSync(path.join(root, 'ui/runtime/chat-page-DrPkxqJK.js'), 'utf8');

// Extract the real, shipped ack branch (the in-flight/`np(r.status)` path that
// runs when a follow-up message is appended while a run is still streaming).
// Running the actual bundle bytes as a function is the closest thing to the
// browser without a live model: it proves the preserved-stream logic, not just
// that a marker string is present.
function runAckBranch(state, ack, timestamp) {
  const start = bundle.indexOf('/* pinkie-stream-survive-steer:v1 */');
  assert.ok(start > 0, 'the shared renderer must carry the stream-survive-steer patch');
  const end = bundle.indexOf('}else gc(', start);
  assert.ok(end > start, 'the ack branch must end before the interrupted path');
  const code = bundle.slice(start, end);
  assert.match(code, /keepPreviousStream/);
  const fn = new Function('e', 'r', 'd', `${code}; return e;`);
  return fn(state, ack, timestamp);
}

test('appending a message mid-stream keeps the half-written reply visible', () => {
  // A follow-up send acknowledges a *different* run id while the first run is
  // still streaming. Before the fix, the branch reassigned chatRunId and
  // blanked chatStream, so the bubble emptied and re-grew from zero.
  const state = {chatRunId: 'run-first', chatStream: '正在写到一半的流式回答', chatStreamStartedAt: 1000};
  const result = runAckBranch(state, {runId: 'run-follow-up', status: 'in_flight'}, 2000);
  assert.equal(result.chatRunId, 'run-follow-up', 'the new run id still takes over');
  assert.equal(result.chatStream, '正在写到一半的流式回答', 'the visible text must survive the run id switch');
  assert.equal(result.chatStreamStartedAt, 1000, 'the original stream start time is kept');
});

test('a first ack with no in-progress stream still clears and re-arms the stream', () => {
  const state = {chatRunId: null, chatStream: '', chatStreamStartedAt: 0};
  const result = runAckBranch(state, {runId: 'run-first', status: 'ok'}, 5000);
  assert.equal(result.chatRunId, 'run-first');
  assert.equal(result.chatStream, '');
  assert.equal(result.chatStreamStartedAt, 5000, 'the new run gets a fresh start timestamp');
});

test('an ack for the same run never clears its stream', () => {
  const state = {chatRunId: 'run-same', chatStream: '同一轮继续输出', chatStreamStartedAt: 1000};
  const result = runAckBranch(state, {runId: 'run-same', status: 'in_flight'}, 9000);
  assert.equal(result.chatStream, '同一轮继续输出');
  assert.equal(result.chatStreamStartedAt, 1000);
});

test('an empty in-progress stream is cleared on a run id switch', () => {
  const state = {chatRunId: 'run-first', chatStream: '   ', chatStreamStartedAt: 1000};
  const result = runAckBranch(state, {runId: 'run-next', status: 'in_flight'}, 9000);
  assert.equal(result.chatStream, '', 'whitespace-only text is not a reply worth preserving');
  assert.equal(result.chatStreamStartedAt, 9000);
});
