import test from 'node:test';
import assert from 'node:assert/strict';
import {transform} from '../patch/apply-steer-fallback-wait.mjs';

const runner = [
  'import { A as replyRunRegistry, P as runAfterReplyOperationClear } from "./run-state-BteeOQT8.js";',
  'async function x() {',
  '\tif (effectiveShouldSteer && isActive) {',
  '\t\tconst steerOutcome = await queueEmbeddedAgentMessageWithOutcomeAsync(steerSessionId, followupRun.prompt, {});',
  '\t\tif (steerOutcome.queued) {',
  '\t\t\ttry {',
  '\t\t\t\tawait opts?.onTurnAdopted?.();',
  '\t\t\t} catch {}',
  '\t\t\treturn;',
  '\t\t}',
  '\t}',
  '}',
].join('\n');

test('steer hands fallback persistence a wait on the active run', () => {
  const out = transform(runner);
  assert.match(out, /pinkie-steer-fallback-wait:v1/);
  assert.match(out, /markRuntimePersistencePending\(Promise\.resolve\(replyRunRegistry\.waitForIdle\(pinkieSteerRunKey/);
  assert.equal(transform(out), out, 'idempotent');
});

test('refuses an unknown runner shape instead of guessing', () => {
  assert.throws(() => transform(runner.replace('if (steerOutcome.queued) {', 'if (steerOutcome.ok) {')), /structure changed/);
  assert.throws(() => transform(runner.replace('replyRunRegistry,', 'other,')), /replyRunRegistry/);
});

test('the fallback really waits: recorder skips its own write once the run persisted it', async () => {
  // Minimal model of createUserTurnTranscriptRecorder.persistFallback().
  let persisted = false; let pending; const writes = [];
  const recorder = {
    hasPersisted: () => persisted,
    hasRuntimePersistencePending: () => pending !== undefined,
    markRuntimePersistencePending: (p) => { pending = p; },
    markRuntimePersisted: () => { persisted = true; },
    persistFallback: async () => { if (pending) await pending; if (!persisted) writes.push('fallback'); },
  };
  let finishRun;
  const replyRunRegistry = {waitForIdle: () => new Promise((r) => { finishRun = r; })};
  const followupRun = {userTurnTranscriptRecorder: recorder};
  const activeReplyOperation = {key: 'agent:project:dashboard:x'};
  const sessionKey = activeReplyOperation.key;
  const body = transform(runner).match(/\/\* pinkie-steer-fallback-wait:v1 \*\/([\s\S]*?)\n\t\t\ttry \{/)[1];
  new Function('followupRun', 'activeReplyOperation', 'sessionKey', 'replyRunRegistry', body)(followupRun, activeReplyOperation, sessionKey, replyRunRegistry);
  const fallback = recorder.persistFallback();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(writes, [], 'no write while the run is still going');
  recorder.markRuntimePersisted();
  finishRun(true);
  await fallback;
  assert.deepEqual(writes, [], 'run wrote it, fallback skipped');
});
