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

// B55 (windows-checks hung 30 min in study-desk-ui, run 45841300853): close() waited for every open
// request to end. A page that is killed or stalls mid-request leaves one open forever, and close never
// returns. close() must drop open connections itself; the test timeout turns a regression into a named
// failure instead of a silent hang.
import net from 'node:net';
const holdOpen = (url, text) => new Promise((resolve, reject) => {
  const socket = net.connect(Number(new URL(url).port), '127.0.0.1', () => { socket.write(text); setTimeout(() => resolve(socket), 100); });
  socket.on('error', reject);
});
for (const [name, text] of [
  ['a request whose body never finishes', 'POST /rpc HTTP/1.1\r\nHost: qa\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"method":'],
  ['a request whose headers never finish', 'GET /chat HTTP/1.1\r\nHost: qa\r\n'],
]) {
  test(`close() returns while a client holds ${name}`, async () => {
    const harness = await startHarness({vendor: false});
    const socket = await holdOpen(harness.url, text);
    const ended = new Promise(resolve => socket.once('close', resolve));
    let timer;
    const outcome = await Promise.race([
      harness.close().then(() => 'closed'),
      new Promise(resolve => { timer = setTimeout(resolve, 3000, 'still waiting after 3 s'); }),
    ]);
    clearTimeout(timer);
    // On a red run, drop the client ourselves so the stuck close() can finish and this file still exits.
    socket.destroy();
    assert.equal(outcome, 'closed', 'close() must not wait for a client that never finishes its request');
    await ended;
    await assert.rejects(fetch(harness.url, {signal: AbortSignal.timeout(1000)}));
  });
}

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
