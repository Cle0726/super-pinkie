import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transform, FRAME_TOKEN_BUDGET, FRAME_LIMIT_TEXT} from '../patch/apply-overflow-compaction-events.mjs';
import {CONTEXT_OVERFLOW_FAILURE} from '../services/mode-architecture/mode-constants.mjs';
import {runner, v1, drive, importLine, nativeRecoveryText} from './helpers/fake-overflow-runner.mjs';

const frameError = 'Error: 400 context_length_exceeded: the request does not fit Amazon Quick\'s 64 KB message limit (63763 bytes after shortening, over 63000)';
const plainOverflow = 'Context overflow: prompt too large for the model';
const openaiOverflow = "Error: 400 This model's maximum context length is 128000 tokens. However, your messages resulted in 131072 tokens. Please reduce the length of the messages. (code: context_length_exceeded)";
const patched = transform(runner, importLine);

test('a frame-limit error compacts once, to the frame budget, then stops with a plain message', () => {
  const result = drive(patched, [frameError]);
  assert.equal(result.compactions, 1);
  assert.equal(result.requests.length, 1, 'compacted at most once');
  assert.equal(result.requests[0].tokenBudget, FRAME_TOKEN_BUDGET);
  assert.equal(result.requests[0].runtimeSettings.tokenBudget, FRAME_TOKEN_BUDGET);
  assert.equal(result.truncations, 0, 'no tool-result truncation round either');
  assert.equal(result.ok, false);
  assert.equal(result.text, FRAME_LIMIT_TEXT);
});

test('one compaction that fits the frame lets the run go on', () => {
  const result = drive(patched, [frameError, null]);
  assert.equal(result.ok, true);
  assert.equal(result.requests.length, 1);
});

test('the frame limit is caught from the assistant error too, and after in-attempt compaction', () => {
  assert.equal(drive(patched, [frameError], {assistantError: true}).requests.length, 1);
  const after = drive(patched, [frameError], {attemptCompactionCount: 1});
  assert.equal(after.requests.length, 1, 'compacts once instead of replaying the same oversized frame');
  assert.equal(after.text, FRAME_LIMIT_TEXT);
});

test('counter-example: a model-window overflow keeps the native three attempts and budget', () => {
  const result = drive(patched, [plainOverflow]);
  assert.equal(result.requests.length, 3);
  assert.ok(result.requests.every((request) => request.tokenBudget === 128000));
  assert.equal(result.truncations, 1);
  assert.equal(result.text, nativeRecoveryText);
  const unpatched = drive(runner, [plainOverflow]);
  assert.equal(unpatched.requests.length, 3);
});

test('counter-example: an OpenAI-style window overflow (context_length_exceeded, no 64 KB) stays native', () => {
  const result = drive(patched, [openaiOverflow]);
  assert.equal(result.requests.length, 3, 'native three compactions, not the single frame-limit one');
  assert.ok(result.requests.every((request) => request.tokenBudget === 128000), 'window budget, not the frame budget');
  assert.ok(result.requests.every((request) => request.runtimeSettings.tokenBudget === 128000));
  assert.equal(result.truncations, 1);
  assert.equal(result.text, nativeRecoveryText);
  assert.notEqual(result.text, FRAME_LIMIT_TEXT);
  const retried = drive(patched, [openaiOverflow], {attemptCompactionCount: 1});
  assert.equal(retried.requests.length, 0, 'after in-attempt compaction it still retries without compacting');
  assert.equal(retried.text, nativeRecoveryText);
});

test('counter-example: an ordinary 400 is not treated as an overflow', () => {
  const result = drive(patched, ['Error: 400 Bad Request: invalid_request_error (tool_choice)']);
  assert.equal(result.requests.length, 0);
  assert.match(result.text, /invalid_request_error/u);
});

test('idempotent, and a v1 bundle upgrades to the same v2 source', () => {
  assert.match(patched, /^\/\* pinkie-overflow-compaction-events:v2 \*\/\nimport \{ c as pinkieEmitAgentEvent \} from "\.\/agent-events-ABC\.js";\n/u);
  assert.equal(transform(patched, importLine), patched);
  const upgraded = transform(v1(), undefined);
  assert.equal(upgraded, patched);
  assert.doesNotMatch(upgraded, /:v1 \*\//u);
  assert.equal(upgraded.split('pinkieEmitAgentEvent({').length - 1, 3, 'the three v1 events are kept, not doubled');
  const events = [];
  drive(upgraded, [frameError, null], {sessionKey: 'agent:main:x', runId: 'r1', emitter: (event) => events.push(event)});
  assert.deepEqual(events.map((event) => [event.data.phase, event.data.completed]), [['start', undefined], ['end', true]]);
});

test('refuses to guess when the runtime changed', () => {
  assert.throws(() => transform(runner.replace('const hadAttemptLevelCompaction = attemptCompactionCount > 0;', ''), importLine), /attempt-level compaction anchor/u);
  assert.throws(() => transform(runner.replace('degradedReason: "context_overflow"', 'degradedReason: "x"'), importLine), /runtime settings budget anchor/u);
  assert.throws(() => transform(v1().replace('import { c as pinkieEmitAgentEvent }', 'import { c as other }'), importLine), /v1 header/u);
});

test('the watchdog retires a frame-limit failure instead of replaying it', () => {
  for (const reason of [frameError, 'context_length_exceeded', "does not fit Amazon Quick's 64 KB message limit", '(63763 bytes after shortening, over 63000)', plainOverflow, openaiOverflow]) {
    assert.match(reason, CONTEXT_OVERFLOW_FAILURE, reason);
  }
  for (const reason of ['Error: 400 Bad Request', 'rate limit exceeded', 'usage limit reached', 'message too long for Slack']) {
    assert.doesNotMatch(reason, CONTEXT_OVERFLOW_FAILURE, reason);
  }
});
