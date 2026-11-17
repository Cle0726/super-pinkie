import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UpstreamWatchdog, WATCHDOG_OUTAGE_DELAYS_MS, isProviderOutage} from '../services/mode-architecture/index.mjs';

const makeWatchdog = () => {
  const scheduled = [], injected = [];
  const watchdog = new UpstreamWatchdog({session: {workflow: {
    enqueueNextTurnInjection: async value => { injected.push(value); return {enqueued: true}; },
    unscheduleSessionTurnsByTag: async () => ({removed: 0}),
    scheduleSessionTurn: async value => { scheduled.push(value); return {id: 'retry'}; },
  }}}, () => '', async () => ({stdout: '{}'}), '');
  return {watchdog, scheduled, injected};
};

test('provider outages are recognised; quota exhaustion is not an outage', () => {
  for (const reason of ['FailoverError: 503 auth_unavailable: no auth available', 'LLM request failed: connection refused by the provider endpoint.',
    'fetch failed', 'ECONNRESET', '502 Bad Gateway']) assert.equal(isProviderOutage(reason), true, reason);
  for (const reason of ["You've reached your usage limit", 'quota exceeded', 'invalid api key']) assert.equal(isProviderOutage(reason), false, reason);
});

test('a free-model session waits out an outage on its own model with growing gaps, and a success resets it', async () => {
  const {watchdog, scheduled} = makeWatchdog();
  const key = 'agent:metre:dashboard:outage';
  watchdog.models.set(key, 'mm/workbuddy/hy4flash-free');
  const fail = () => watchdog.agentEnded({success: false, error: '503 auth_unavailable: no auth available'}, {agentId: 'metre', sessionKey: key});
  for (let i = 0; i < 9; i += 1) assert.equal(await fail(), true, `attempt ${i + 1} keeps the job alive`);
  assert.equal(watchdog.models.get(key), 'mm/workbuddy/hy4flash-free', 'never switched to a paid model');
  const delays = scheduled.map(item => item.delayMs);
  assert.ok(delays[0] <= 4_000 && delays[1] <= 4_000, 'the first two retries stay quick');
  assert.ok(delays[2] >= WATCHDOG_OUTAGE_DELAYS_MS[0], 'then it starts waiting');
  assert.ok(delays.at(-1) >= delays[2] * 4, 'and waits longer each time');
  assert.equal(await watchdog.agentEnded({success: true, messages: [{role: 'assistant', content: '好了', stopReason: 'stop'}]}, {agentId: 'metre', sessionKey: key}), false);
  assert.equal(watchdog.outageSteps.has(key), false, 'a finished turn resets the wait');
});
