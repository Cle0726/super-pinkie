// Recurrence locks for fixes that landed in services/mode-architecture/index.mjs
// and were not asserted by the tests added with those commits.
//
// Isolation: empty temp homes only. No upstream model calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-hotspot-index-'));
fs.mkdirSync(path.join(scratch, 'claude'), {recursive: true});
fs.mkdirSync(path.join(scratch, 'codex'), {recursive: true});
fs.mkdirSync(path.join(scratch, 'state'), {recursive: true});
fs.mkdirSync(path.join(scratch, 'openclaw'), {recursive: true});
fs.writeFileSync(path.join(scratch, 'openclaw', 'openclaw.json'), '{}\n');
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.CLAUDE_CONFIG_DIR = path.join(scratch, 'claude');
process.env.CODEX_HOME = path.join(scratch, 'codex');
process.env.PINKIE_STATE_ROOT = path.join(scratch, 'state');
process.env.OPENCLAW_STATE_DIR = path.join(scratch, 'openclaw');
process.env.OPENCLAW_CONFIG_PATH = path.join(scratch, 'openclaw', 'openclaw.json');
delete process.env.PINKIE_MANAGED_GATEWAY;
delete process.env.OPENCLAW_SERVICE_KIND;
delete process.env.OPENCLAW_PROFILE;

const {default: plugin} = await import('../services/mode-architecture/index.mjs');

function registerPlugin() {
  const queued = [];
  const methods = new Map();
  plugin.register({
    on: () => {},
    registerGatewayMethod: (name, fn, opts) => methods.set(name, {fn, opts}),
    registerTool: () => {},
    registerHttpRoute: () => ({}),
    logger: {info() {}, warn() {}, error() {}},
    runtime: {
      state: {resolveStateDir: () => process.env.PINKIE_STATE_ROOT},
      config: {current: () => ({})},
    },
    session: {workflow: {
      enqueueNextTurnInjection: async value => {
        queued.push(value);
        return {enqueued: true};
      },
      unscheduleSessionTurnsByTag: async () => ({removed: 0}),
    }},
  });
  return {queued, methods};
}

const {queued, methods} = registerPlugin();

test('deep-think idempotency key keeps the tier, so two tiers in the same millisecond stay distinct', async () => {
  // 7f271ad987 restored `-${tier}` after fbc42548 dropped it. The host dedupes
  // injections by idempotencyKey. Without the suffix, arming boost and marathon
  // inside one Date.now() tick collapses into a single key and the second
  // tier's injection is treated as a replay of the first.
  const frozen = 1_700_000_000_000;
  const realNow = Date.now;
  Date.now = () => frozen;
  const arm = methods.get('pinkie.deepThink.arm').fn;
  const calls = [];
  try {
    for (const [sessionKey, tier] of [
      ['agent:thinking:hotspot-boost', 'boost'],
      ['agent:project:hotspot-marathon', 'marathon'],
    ]) {
      let response;
      await arm({
        params: {sessionKey, tier},
        respond: (...args) => { response = args; },
      });
      calls.push(response);
    }
  } finally {
    Date.now = realNow;
  }
  assert.equal(calls[0][0], true, 'boost arm accepted');
  assert.equal(calls[1][0], true, 'marathon arm accepted');
  assert.equal(queued.length, 2);
  assert.equal(queued[0].idempotencyKey, `deep-think-${frozen}-boost`);
  assert.equal(queued[1].idempotencyKey, `deep-think-${frozen}-marathon`);
  assert.notEqual(queued[0].idempotencyKey, queued[1].idempotencyKey);
  assert.equal(queued[0].metadata.tier, 'boost');
  assert.equal(queued[1].metadata.tier, 'marathon');
});

test('desensitize rewrite refuses to call upstream when no apiKey is configured', async () => {
  // a2514d6e95 removed the hardcoded gateway key
  // (`providerConfig.apiKey || '<literal>'`). An empty config must stop before
  // fetch. A non-empty source fallback skips that throw and posts upstream.
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('upstream must not be called');
  };
  let response;
  try {
    await methods.get('pinkie.desensitize.rewrite').fn({
      params: {prompt: '把这段话改写得更清楚', model: 'mm/gemini-2.5-flash'},
      respond: (...args) => { response = args; },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response[0], false);
  assert.equal(response[2].code, 'REWRITE_FAILED');
  assert.match(response[2].message, /没有读到本地网关的 apiKey/);
  assert.deepEqual(calls, []);

  const src = fs.readFileSync(new URL('../services/mode-architecture/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /const apiKey = providerConfig\.apiKey \|\| '';/);
  assert.doesNotMatch(src, /const apiKey = providerConfig\.apiKey \|\| '[^']+'/);
});
