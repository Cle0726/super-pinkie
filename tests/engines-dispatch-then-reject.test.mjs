// handle() used readCapped(...).then(async raw => …, onReject): the second argument only covers readCapped itself, so when
// the async callback rejected (here writeHead throwing on a non-HTTP status carried by the call's error) nobody observed it,
// the gateway saw an unhandledRejection and the client hung until its own timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineDispatch} from '../services/mode-architecture/engines-dispatch.mjs';

for (const status of ['nope', 42, 1000]) {
  test(`engines-dispatch: a call error with status ${JSON.stringify(status)} closes the request and leaves no unhandled rejection`, async t => {
    const unhandled = [];
    const onUnhandled = error => unhandled.push(String(error?.code || error?.message || error));
    process.on('unhandledRejection', onUnhandled);
    const dispatch = new EngineDispatch({bridge: {sessions: {all: () => ({})}}, lineage: {lineage: () => ({})}, isEnabled: () => true});
    dispatch.call = async () => { throw Object.assign(new Error('boom'), {status}); };
    t.after(() => { process.off('unhandledRejection', onUnhandled); dispatch.close(); });
    const port = await dispatch.listen();
    const outcome = await fetch(`http://127.0.0.1:${port}/dispatch`, {method: 'POST', body: '{}',
      headers: {'content-type': 'application/json'}, signal: AbortSignal.timeout(3000)}).then(r => r.text(), error => error);
    assert.notEqual(outcome?.name, 'TimeoutError', 'the request is closed instead of left hanging');
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  });
}
