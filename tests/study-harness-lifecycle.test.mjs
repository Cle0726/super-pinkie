import test from 'node:test';
import assert from 'node:assert/strict';
import {launchWithHarness, startHarness} from '../tools/study-desk/harness.mjs';

test('browser launch failure closes the already-started test server and preserves the original error', async () => {
  let closes = 0;
  const failure = new Error('browser unavailable');
  await assert.rejects(launchWithHarness({close: async () => { closes++; }}, () => { throw failure; }), error => error === failure);
  assert.equal(closes, 1);
});

test('successful browser launch leaves the harness open for the caller', async () => {
  let closes = 0;
  const browser = {};
  assert.equal(await launchWithHarness({close: async () => { closes++; }}, async () => browser), browser);
  assert.equal(closes, 0);
});

test('browser and cleanup failures are both reported', async () => {
  const failure = new Error('browser unavailable'), cleanup = new Error('cannot close server');
  await assert.rejects(launchWithHarness({close: async () => { throw cleanup; }}, async () => { throw failure; }),
    error => error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === cleanup);
});

// Exercise a real local listener: launch failure must release the port, not just call a mock.
test('a failed launch closes a real isolated HTTP server', async () => {
  const harness = await startHarness({vendor: false});
  let closed = false;
  try {
    const response = await fetch(harness.url);
    assert.equal(response.status, 200);
    await response.text();
    const failure = new Error('simulated browser launch failure');
    await assert.rejects(launchWithHarness(harness, () => Promise.reject(failure)), error => error === failure);
    closed = true;
    await assert.rejects(fetch(harness.url, {signal: AbortSignal.timeout(1000)}));
  } finally { if (!closed) await harness.close(); }
});
