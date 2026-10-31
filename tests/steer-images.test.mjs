import test from 'node:test';
import assert from 'node:assert/strict';
import { transformRunner, transformSelection } from '../patch/apply-steer-images.mjs';

const runner = `\t\tconst steerOutcome = await queueEmbeddedAgentMessageWithOutcomeAsync(steerSessionId, followupRun.prompt, {
\t\t\tsteeringMode: "all",`;
const selection = `async function steerAndWaitForTranscriptCommit(activeSession, text, timeoutMs, userTurnTranscriptRecorder) {
  (userTurnTranscriptRecorder ? activeSession.steer(text, void 0, userTurnTranscriptRecorder) : activeSession.steer(text)).catch((err) => {});
}
async function steerActiveSessionWithOptionalDeliveryWait(activeSession, text, options) {
 if (options?.waitForTranscriptCommit !== true) {
\t\tif (options?.userTurnTranscriptRecorder) await activeSession.steer(text, void 0, options.userTurnTranscriptRecorder);
\t\telse await activeSession.steer(text);
  return;
 }
 await steerAndWaitForTranscriptCommit(activeSession, text, options.deliveryTimeoutMs ?? DEFAULT_QUEUE_TRANSCRIPT_COMMIT_TIMEOUT_MS, options.userTurnTranscriptRecorder);
}`;

test('both runtime transforms fail closed and are idempotent', () => {
  for (const [transform, input] of [[transformRunner, runner], [transformSelection, selection]]) {
    const result = transform(input);
    assert.equal(result.changed, true);
    assert.equal(transform(result.text).reason, 'already-patched');
    assert.equal(transform('different runtime').reason, 'unsupported-runtime');
    assert.equal(transform(input + input).reason, 'unsupported-runtime');
  }
});

test('image resolution is scoped to the four included modes and retains input ordering', async () => {
  const output = transformRunner(runner).text;
  const body = output.slice(output.indexOf('/* pinkie-steer-current-images:v1 */'), output.indexOf('const steerOutcome'));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction('sessionKey', 'followupRun', 'opts', 'sessionCtx', 'resolveQueuedReplyRuntimeConfig', 'resolveCurrentTurnImages', `${body}\nreturn pinkieSteerImages;`);
  const image = { type: 'image', data: 'fixture', mimeType: 'image/png' };
  const run = { run: { sessionKey: 'agent:learning:qa', config: { sample: true } }, images: [image], imageOrder: ['inline'] };
  let calls = [];
  const resolver = async params => { calls.push(params); return { images: params.images }; };
  const config = value => value;
  for (const mode of ['main', 'project', 'thinking', 'learning']) {
    assert.deepEqual(await execute(`agent:${mode}:qa`, run, {}, { MediaPath: 'isolated.png' }, config, resolver), [image]);
  }
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].imageOrder, ['inline']);
  assert.equal(calls[0].ctx.MediaPath, 'isolated.png');
  calls = [];
  assert.equal(await execute('agent:other:qa', run, {}, {}, config, resolver), undefined);
  assert.equal(calls.length, 0);
});

test('the session steer receives images and recorder with and without delivery wait', async () => {
  const output = transformSelection(selection).text;
  const waitCalls = [];
  const run = new Function('steerAndWaitForTranscriptCommit', 'DEFAULT_QUEUE_TRANSCRIPT_COMMIT_TIMEOUT_MS', `${output.slice(output.indexOf('async function steerActiveSessionWithOptionalDeliveryWait'))}\nreturn steerActiveSessionWithOptionalDeliveryWait;`)(
    async (...args) => waitCalls.push(args), 120000,
  );
  const calls = [], session = { steer: async (...args) => calls.push(args) };
  const images = [{ type: 'image', data: 'fixture' }], recorder = { id: 'one' };
  await run(session, 'append', { images, userTurnTranscriptRecorder: recorder });
  assert.deepEqual(calls[0], ['append', images, recorder]);
  await run(session, 'append', { images });
  assert.deepEqual(calls[1], ['append', images]);
  await run(session, 'append', {});
  assert.deepEqual(calls[2], ['append']);
  await run(session, 'append', { images, userTurnTranscriptRecorder: recorder, waitForTranscriptCommit: true });
  assert.deepEqual(waitCalls[0], [session, 'append', 120000, recorder, images]);
});
