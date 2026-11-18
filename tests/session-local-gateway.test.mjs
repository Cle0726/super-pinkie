import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSessionAccess, isManagedLoopbackNoAuth, scopeUpgradeFallbackRunner} from '../services/mode-architecture/session-titles.mjs';

const localApi = {config: {gateway: {mode: 'local', bind: 'loopback', auth: {mode: 'none'}}}};
const managed = {PINKIE_MANAGED_GATEWAY: '1'};

test('local desktop session RPCs do not pair the CLI identity with read-only scope', async () => {
  const calls = [];
  const access = createSessionAccess(localApi, {env: managed, loadSdk: () => ({
    callGatewayFromCli: async (...args) => { calls.push(args); return {ok: true}; },
  })});
  await access.rpc('sessions.list', {agentId: 'metre'});
  await access.rpc('chat.abort', {sessionKey: 'agent:metre:main'}, {admin: true});
  assert.deepEqual(calls[0][3], {clientName: 'gateway-client', mode: 'backend', deviceIdentity: null});
  assert.deepEqual(calls[1][3], {clientName: 'gateway-client', mode: 'backend', deviceIdentity: null, scopes: ['operator.admin']});
});

test('remote, authenticated and non-desktop gateways retain their normal identity', async () => {
  const cases = [
    [localApi, {}],
    [localApi, {...managed, OPENCLAW_GATEWAY_URL: 'wss://example.test'}],
    [{config: {gateway: {mode: 'remote', auth: {mode: 'none'}}}}, managed],
    [{config: {gateway: {mode: 'local', bind: 'lan', auth: {mode: 'none'}}}}, managed],
    [{config: {gateway: {mode: 'local', auth: {mode: 'token'}}}}, managed],
  ];
  for (const [api, env] of cases) {
    assert.equal(isManagedLoopbackNoAuth(api, env), false);
    const calls = [];
    const access = createSessionAccess(api, {env, loadSdk: () => ({callGatewayFromCli: async (...args) => { calls.push(args); return {}; }})});
    await access.rpc('sessions.list', {});
    assert.equal(calls[0][3], undefined);
  }
});

test('a previously paired read-only CLI can resume only after an explicit scope rejection', async () => {
  const request = {sessionKey: 'agent:metre:main', message: '继续', idempotencyKey: 'retry-1'};
  const args = ['openclaw.mjs', 'gateway', 'call', 'chat.send', '--params', JSON.stringify(request)];
  const seen = [];
  const denied = Object.assign(new Error('failed'), {stderr: 'GatewayClientRequestError: scope upgrade pending approval'});
  const run = scopeUpgradeFallbackRunner(localApi, {cli: 'openclaw.mjs', env: managed,
    runProcess: async () => { throw denied; }, access: {rpc: async (...call) => { seen.push(call); return {status: 'started'}; }}});
  assert.deepEqual(JSON.parse((await run(process.execPath, args, {})).stdout), {status: 'started'});
  assert.deepEqual(seen, [['chat.send', request]]);

  const timeout = new Error('gateway timed out after dispatch');
  const noRetry = scopeUpgradeFallbackRunner(localApi, {cli: 'openclaw.mjs', env: managed,
    runProcess: async () => { throw timeout; }, access: {rpc: async () => { throw Error('must not resend'); }}});
  await assert.rejects(noRetry(process.execPath, args, {}), error => error === timeout);
  await assert.rejects(run(process.execPath, ['openclaw.mjs', 'gateway', 'call', 'sessions.delete'], {}), error => error === denied);
  const remote = scopeUpgradeFallbackRunner(localApi, {cli: 'openclaw.mjs', env: {},
    runProcess: async () => { throw denied; }, access: {rpc: async () => { throw Error('must not bypass pairing'); }}});
  await assert.rejects(remote(process.execPath, args, {}), error => error === denied);
});
