// A dispatch call that rejects with a bare null/undefined (not an Error) used to crash the catch on `error.status`:
// the external engine's request hung with no reply and the gateway saw an unhandledRejection TypeError instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineDispatch} from '../services/mode-architecture/engines-dispatch.mjs';

for (const [label, value] of [['null', null], ['undefined', undefined]]) {
  test(`engines-dispatch: a call rejecting with ${label} still answers and leaves no unhandled rejection`, async t => {
    const unhandled = [];
    const onUnhandled = error => unhandled.push(String(error?.message ?? error));
    process.on('unhandledRejection', onUnhandled);
    const dispatch = new EngineDispatch({bridge: {sessions: {all: () => ({})}}, lineage: {lineage: () => ({})}, isEnabled: () => true});
    dispatch.call = async () => { throw value; };
    t.after(() => { process.off('unhandledRejection', onUnhandled); dispatch.close(); });
    const port = await dispatch.listen();

    const response = await fetch(`http://127.0.0.1:${port}/dispatch`, {method: 'POST', body: '{}',
      headers: {'content-type': 'application/json'}, signal: AbortSignal.timeout(3000)});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, 'string');
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  });
}
