import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EngineRegistry, FIRST_CLASS, agentView, instanceIdFor} from '../services/mode-architecture/engines-registry.mjs';
import {EngineBridge, REGISTRY_DRIVER, authView, driverOf, summarizeProviders} from '../services/mode-architecture/engines-bridge.mjs';

// 「更多引擎」（PLAN 3.7 末段、E6）。字段照引擎服务 0.1.11 的 server.searchAcpRegistry（11-23 本机实测搜出 43 家）。
const agent = (id, name, extra = {}) => ({id, name, version: '1.0.0', description: `${name} coding agent`, authors: [], license: 'MIT', website: null, repository: null,
  icon: `https://cdn.agentclientprotocol.com/registry/v1/latest/${id}.svg`, distribution: 'npx', integrity: 'registry', ...extra});
const AGENTS = [
  agent('devin', 'Devin', {license: 'proprietary', website: 'https://devin.ai', distribution: 'binary'}),
  agent('qwen-code', 'Qwen Code', {license: 'Apache-2.0', repository: 'https://github.com/QwenLM/qwen-code'}),
  agent('kilo', 'Kilo', {website: 'javascript:alert(1)', distribution: 'binary', integrity: 'sha256'}),
  agent('claude-acp', 'Claude Agent'), agent('muse-code', 'Muse Code'), agent('cursor', 'Cursor'),
  agent('Bad ID!', 'Broken'),
];

function fakeBridge(instances = {}) {
  const calls = [];
  const bridge = {
    calls, instances,
    async call(tag, payload) {
      calls.push([tag, payload]);
      if (tag === 'server.searchAcpRegistry') return {agents: AGENTS.filter(a => !payload.query || a.name.toLowerCase().includes(payload.query.toLowerCase()))};
      if (tag === 'server.prepareAcpRegistryAgent') return {agentId: payload.agentId, version: '1.0.0', distribution: 'npx', prepared: true};
      if (tag === 'server.updateSettings') { const m = payload.providerInstanceMutation; bridge.instances = {...bridge.instances, [m.instanceId]: m.instance}; return {}; }
      return {};
    },
    async settings() { return {providerInstances: bridge.instances}; },
    async refreshOne(id) { calls.push(['refreshOne', id]); },
    async catalog() { return {engines: [], levels: []}; },
  };
  return bridge;
}

test('the registry list leaves out the ten engines already in the menu and shows licence, source and how it installs', async () => {
  const bridge = fakeBridge({acpRegistry_kilo: {driver: REGISTRY_DRIVER, config: {agentId: 'kilo'}}, local: {driver: REGISTRY_DRIVER, config: {source: 'local', agentId: 'devin'}}});
  const registry = new EngineRegistry(bridge);
  const all = await registry.search({query: '   '});
  assert.deepEqual(bridge.calls[0], ['server.searchAcpRegistry', {query: '', limit: 512}], 'an empty search lists everything');
  assert.deepEqual(all.agents.map(a => a.id), ['devin', 'qwen-code', 'kilo'], 'no duplicates of the ten, no malformed ids');
  for (const id of ['claude-acp', 'codex-acp', 'antigravity-acp', 'cursor', 'grok-build', 'opencode', 'pi-acp', 'muse-code']) assert.ok(FIRST_CLASS.has(id), id);
  const [devin, qwen, kilo] = all.agents;
  assert.deepEqual([devin.how, devin.dist, devin.link, devin.license, devin.added], ['下载运行包', 'binary', 'https://devin.ai', 'proprietary', false]);
  assert.deepEqual([qwen.how, qwen.link], ['用 npm 装', 'https://github.com/QwenLM/qwen-code'], 'falls back to the repository');
  assert.deepEqual([kilo.link, kilo.checked, kilo.added], ['', true, true], 'only https links; already added is marked');
  assert.equal('icon' in devin, false, 'the screen never loads pictures from other sites');
  const some = await registry.search({query: ' qwen '});
  assert.deepEqual(bridge.calls.at(-1), ['server.searchAcpRegistry', {query: 'qwen'}]);
  assert.deepEqual(some.agents.map(a => a.id), ['qwen-code']);
  assert.equal(agentView({id: 'x', name: 'T3 Code helper', description: 'see https://app.t3.codes/x'}).name.includes('T3'), false, 'the engine service name never shows');
});

test('adding one prepares it first, then creates an acpRegistry instance and has the engine service check it', async () => {
  const bridge = fakeBridge({acpRegistry_qwen_code: {driver: 'codex'}});
  const registry = new EngineRegistry(bridge);
  const result = await registry.add({agentId: 'qwen-code'});
  const tags = bridge.calls.map(call => call[0]);
  assert.ok(tags.indexOf('server.prepareAcpRegistryAgent') < tags.indexOf('server.updateSettings'), 'downloaded before the instance exists');
  assert.deepEqual(bridge.calls.find(call => call[0] === 'server.prepareAcpRegistryAgent')[1], {agentId: 'qwen-code'});
  assert.deepEqual(bridge.calls.find(call => call[0] === 'server.updateSettings')[1], {patch: {}, providerInstanceMutation: {operation: 'create', instanceId: 'acpRegistry_qwen_code_2',
    instance: {driver: 'acpRegistry', enabled: true, displayName: 'Qwen Code', config: {agentId: 'qwen-code', distribution: 'auto'}}}});
  assert.deepEqual(bridge.calls.at(-1), ['refreshOne', 'acpRegistry_qwen_code_2']);
  assert.equal(result.engine, 'acpRegistry_qwen_code_2');
  bridge.calls.length = 0;
  await assert.rejects(registry.add({agentId: 'qwen-code'}), /加过/);
  await assert.rejects(registry.add({agentId: 'claude-acp'}), /不认识/, 'the ten are added from the menu, not here');
  await assert.rejects(registry.add({agentId: 'nope'}), /没有找到/);
  await assert.rejects(registry.add({agentId: '../x'}), /不认识/);
  assert.equal(bridge.calls.some(call => call[0] === 'server.prepareAcpRegistryAgent'), false, 'nothing is downloaded when it is refused');
});

test('instance ids follow the engine service rule: driver_name, at most 64 characters, _2 when taken', () => {
  assert.equal(instanceIdFor('opencode.v3'), 'acpRegistry_opencode_v3');
  assert.equal(instanceIdFor('devin', new Set(['acpRegistry_devin'])), 'acpRegistry_devin_2');
  const long = instanceIdFor('a'.repeat(128), new Set([`acpRegistry_${'a'.repeat(48)}`]));
  assert.ok(long.length <= 64 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(long), long);
  assert.equal(driverOf('acpRegistry_qwen_code'), 'acpRegistry');
  assert.equal(driverOf('acpRegistry_../x'), '');
});

function realBridge(calls, answers) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-registry-'));
  const service = {root, home: path.join(root, 'home'), status: () => ({running: true, url: 'http://127.0.0.1:3790', port: 3790}),
    cli: async () => ({text: 'x'.repeat(40)})};
  class Rpc {
    request(tag, payload) { calls.push([tag, payload]); return Promise.resolve(typeof answers[tag] === 'function' ? answers[tag](payload) : answers[tag]); }
    stream(tag, payload) { calls.push([tag, payload]); return Promise.resolve({close() {}}); }
    close() {}
  }
  return new EngineBridge({service, RpcImpl: Rpc});
}

test('an engine added from the registry is an ordinary menu row: managed sign-in, and removing it does not sign the user out', async () => {
  const provider = {instanceId: 'acpRegistry_qwen_code', driver: 'acpRegistry', displayName: 'Qwen Code', enabled: true, installed: true, status: 'ready',
    auth: {status: 'unauthenticated'}, setup: {canAuthenticate: false}, models: []};
  const rows = summarizeProviders([provider, {instanceId: 'acpRegistry', driver: 'acpRegistry', enabled: true, installed: false, status: 'warning'}]);
  const row = rows.find(r => r.id === 'acpRegistry_qwen_code');
  assert.deepEqual([row.name, row.registry, row.account, row.multi, row.state, row.guide.managedSignin], ['Qwen Code', true, true, false, 'signin', true]);
  assert.equal(rows.some(r => r.id === 'acpRegistry'), false, 'the empty registry instance (no engine picked) is not listed');
  assert.equal(rows.at(-1).id, 'acpRegistry_qwen_code', 'after the ten');

  const calls = [];
  let instances = {acpRegistry_qwen_code: {driver: 'acpRegistry', displayName: 'Qwen Code', config: {agentId: 'qwen-code'}}};
  const bridge = realBridge(calls, {
    'server.getConfig': () => ({providers: [provider], settings: {providerInstances: instances}}),
    'server.updateSettings': payload => { const m = payload.providerInstanceMutation; if (m.operation === 'remove') delete instances[m.instanceId]; return {}; },
    'provider.auth.start': {instanceId: 'acpRegistry_qwen_code', phase: 'waiting', flowId: 'f1', interaction: {type: 'browser', id: 'i1', url: 'https://chat.qwen.ai/login', requiresConsent: true}},
    'server.refreshProviders': {},
  });
  const started = await bridge.signin({engine: 'acpRegistry_qwen_code', open: true, methodId: 'qwen-oauth'});
  assert.equal(started.how, 'managed');
  assert.deepEqual(calls.find(call => call[0] === 'provider.auth.start')[1], {instanceId: 'acpRegistry_qwen_code', methodId: 'qwen-oauth'});
  await bridge.removeAccount({engine: 'acpRegistry_qwen_code'});
  assert.equal(calls.some(call => call[0] === 'provider.auth.logout'), false, 'its login is shared on this computer, so it stays');
  assert.equal(instances.acpRegistry_qwen_code, undefined);
});

// 11-23 真机：Qwen Code 0.28.4 加上花了 7 分 17 秒（npm），登录只有「Use OpenAI API key」，点了报英文的「Internal error」。
test('a registry engine that only signs in with an API key is said plainly, not as a sign-in that keeps failing', () => {
  const [row] = summarizeProviders([{instanceId: 'acpRegistry_qwen_code', driver: 'acpRegistry', displayName: 'Qwen Code', enabled: true, installed: true, status: 'warning',
    auth: {status: 'unauthenticated', type: 'agent'}, message: 'Sign in in provider settings using "Use OpenAI API key".', setup: {canAuthenticate: true}, models: [{slug: 'default'}]}], {all: false});
  assert.deepEqual([row.state, row.text], ['keyonly', '只能填 API 密钥登录，Metre 里不经手密钥，用不了']);
  const [codex] = summarizeProviders([{instanceId: 'codex', driver: 'codex', enabled: true, installed: true, status: 'error', auth: {status: 'unauthenticated'}, message: 'Set OPENAI_API_KEY or run codex login'}], {all: false});
  assert.equal(codex.state, 'signin', 'only registry engines; the ten keep their own sign-in');
  const methods = [{id: 'openai', name: 'Use OpenAI API key', description: 'Requires setting the `OPENAI_API_KEY` environment variable', type: 'agent'}];
  const failed = authView({phase: 'failed', flowId: 'f', message: 'The ACP agent could not complete sign-in. Internal error', methods});
  assert.equal(failed.message, '只能填 API 密钥登录，Metre 里不经手密钥，用不了');
  assert.equal(failed.methods[0].type, 'credentials', 'so the card does not offer it as another way to sign in');
  const browser = authView({phase: 'failed', flowId: 'f', message: 'Expired', methods: [...methods, {id: 'oauth', name: 'Sign in with browser', type: 'agent'}]});
  assert.equal(browser.message, 'Expired', 'a browser method is still there: keep the real reason');
});
