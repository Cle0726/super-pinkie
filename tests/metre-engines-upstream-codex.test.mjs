// 引擎台「碧琪模型」Codex 那一家（engines-upstream.mjs 末尾 + engines-bridge.mjs ensureCodexPinkie）：
// Codex 不用 ChatGPT 订阅，走碧琪上游的 /v1/responses。每条都带反例。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CODEX_PINKIE_FOLDER, CODEX_PINKIE_INSTANCE, PINKIE_INSTANCE, PinkieRelay, TOP_EFFORT, codexLaunchArgs, codexPinkieInstance, pinkieModels}
  from '../services/mode-architecture/engines-upstream.mjs';
import {EngineBridge, driverOf, isPinkieRow, summarizeProviders} from '../services/mode-architecture/engines-bridge.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-codex-'));
// 假钥匙运行时拼，测试文件里没有一整串像钥匙的字。
const KEY = ['fake', 'gateway', 'key', 'q1w2e3r4t5'].join('-');
const OAKEY = ['fake', 'responses', 'key', 'p0o9i8u7'].join('-');
const CONFIG = {models: {providers: {
  gw: {baseUrl: 'http://127.0.0.1:1466/v1', apiKey: KEY, models: [
    {id: 'aws-quick/claude-opus-5-5'}, {id: 'claude-opus-5-5-low'}, {id: 'claude-haiku-4-5-20251001'}, {id: 'gpt-5'}]},
  remote: {baseUrl: 'http://10.0.0.5/v1', apiKey: 'r'.repeat(12), models: [{id: 'claude-opus-5-5'}]},
  oa: {baseUrl: 'https://api.example/v1', api: 'openai-responses', apiKey: OAKEY, models: [{id: 'claude-opus-5-5'}, {id: 'claude-opus-5-5-low'}, {id: 'gpt-5.1'}]},
  chatonly: {baseUrl: 'https://chat.example/v1', api: 'openai-completions', apiKey: 'c'.repeat(12), models: [{id: 'gpt-5.1'}]},
}}};
const PASS = 'session-pass-0123456789abcdef';

test('codex: only models whose upstream speaks /v1/responses are offered, top tier only', () => {
  const slugs = pinkieModels(CONFIG, {family: 'codex'}).map(model => model.slug);
  assert.ok(slugs.includes('gw/aws-quick/claude-opus-5-5'), 'the local gateway answers /v1/responses');
  assert.equal(slugs.some(slug => slug.startsWith('chatonly/')), false, 'a Chat-only upstream cannot serve Codex');
  assert.equal(slugs.some(slug => slug.startsWith('remote/')), false, 'plain http to another machine is refused');
  assert.ok(slugs.includes('oa/claude-opus-5-5'), 'an https upstream marked openai-responses is offered');
  // 反例：碧琪档位表里 GPT 是 mid 档（用户只用 top 档），低思考档和非 top 档都不列。
  for (const bad of ['gw/claude-opus-5-5-low', 'gw/claude-haiku-4-5-20251001', 'oa/claude-opus-5-5-low', 'oa/gpt-5.1', 'gw/gpt-5'])
    assert.equal(slugs.includes(bad), false, `${bad} is not top tier / not the top effort`);
  // 反例：Claude 那一家照旧只要 Claude 系，不会因为加了 Codex 而多出别家的模型。
  assert.equal(pinkieModels(CONFIG).some(model => !/claude/i.test(model.slug)), false);
  assert.deepEqual(pinkieModels({}, {family: 'codex'}), []);
});

test('codex: the launch arguments point at the relay with the session pass, the top effort, and no upstream key', () => {
  const args = codexLaunchArgs({baseUrl: 'http://127.0.0.1:5063', token: PASS});
  assert.match(args, /-c "model_provider=\\"pinkie\\""/);
  assert.match(args, /base_url=\\"http:\/\/127\.0\.0\.1:5063\/v1\\"/);
  assert.match(args, /wire_api=\\"responses\\"/);
  assert.match(args, /requires_openai_auth=false/, 'no ChatGPT login needed');
  assert.match(args, new RegExp(`experimental_bearer_token=\\\\"${PASS}\\\\"`));
  assert.match(args, new RegExp(`model_reasoning_effort=\\\\"${TOP_EFFORT}\\\\"`));
  assert.equal(args.includes(KEY) || args.includes(OAKEY), false);
  // 反例：地址和令牌不对就不生成，避免把别的东西拼进命令行。
  assert.throws(() => codexLaunchArgs({baseUrl: 'http://10.0.0.5:1', token: PASS}), /地址不对/);
  assert.throws(() => codexLaunchArgs({baseUrl: 'http://127.0.0.1:5063" --dangerously', token: PASS}), /地址不对/);
  assert.throws(() => codexLaunchArgs({baseUrl: 'http://127.0.0.1:5063', token: 'a"b; rm'}), /令牌不对/);
  const instance = codexPinkieInstance('C:\\h\\.codex-metre-pinkie', [{slug: 'gw/a', name: 'A'}], {baseUrl: 'http://127.0.0.1:5063', token: PASS});
  assert.deepEqual([instance.driver, instance.config.shadowHomePath, instance.config.homePath], ['codex', 'C:\\h\\.codex-metre-pinkie', undefined],
    'a shadow folder over ~/.codex (shared history, own auth.json), never a replacement CODEX_HOME');
});

async function relayWith(respond) {
  const seen = [];
  const relay = new PinkieRelay({config: () => CONFIG, fetchImpl: async (url, init) => { seen.push({url, init}); return respond(url, init); }});
  await relay.start();
  relay.codexModel = 'gw/aws-quick/claude-opus-5-5';
  relay.defaultModel = 'gw/aws-quick/claude-opus-5-5';
  const post = (pass, body, extra = {}) => fetch(relay.baseUrl + '/v1/responses', {method: 'POST',
    headers: {authorization: `Bearer ${pass}`, 'content-type': 'application/json', ...extra}, body: JSON.stringify(body)});
  return {relay, seen, post};
}

test('codex: the relay forwards /v1/responses with the real key as a bearer, and keeps the stream', async () => {
  const {relay, seen, post} = await relayWith(() => new Response('event: response.created\ndata: {}\n\n', {status: 200, headers: {'content-type': 'text/event-stream'}}));
  try {
    assert.equal((await post('wrong-pass-000000', {model: 'x'})).status, 401);
    assert.equal(seen.length, 0, 'a wrong pass never reaches the upstream');
    const ok = await post(relay.token, {model: 'oa/claude-opus-5-5', stream: true, input: 'hi'}, {'chatgpt-account-id': 'acct-1', cookie: 'c=1'});
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /response\.created/);
    assert.equal(seen[0].url, 'https://api.example/v1/responses');
    assert.equal(seen[0].init.headers.authorization, `Bearer ${OAKEY}`, 'each provider gets its own key');
    assert.equal(seen[0].init.headers['x-api-key'], undefined, 'no Anthropic header on the OpenAI path');
    assert.equal(seen[0].init.headers['chatgpt-account-id'], undefined, 'ChatGPT account headers are not forwarded');
    assert.equal(seen[0].init.headers.cookie, undefined);
    assert.equal(JSON.parse(seen[0].init.body).model, 'claude-opus-5-5', 'the provider prefix is taken off');
    // 反例：Codex 自己的模型名（gpt-5.5-codex 之类）不在碧琪目录里，换成 Codex 那条路的默认模型，不会去别家。
    await post(relay.token, {model: 'gpt-5.5-codex', input: 'x'});
    assert.equal(seen[1].url, 'http://127.0.0.1:1466/v1/responses');
    assert.equal(JSON.parse(seen[1].init.body).model, 'aws-quick/claude-opus-5-5');
    // 反例：Chat-only 的上游、mid 档的模型，点名也到不了，都换成默认模型。
    await post(relay.token, {model: 'chatonly/gpt-5.1', input: 'x'});
    assert.notEqual(new URL(seen[2].url).host, 'chat.example');
    await post(relay.token, {model: 'oa/gpt-5.1', input: 'x'});
    assert.equal(JSON.parse(seen[3].init.body).model, 'aws-quick/claude-opus-5-5');
  } finally { await relay.stop(); }
});

test('codex: quota used up upstream comes back as a 429 with its reset headers and no key', async () => {
  const {relay, post} = await relayWith(() => new Response(JSON.stringify({error: {type: 'insufficient_quota', message: `limit for ${KEY}`}}),
    {status: 429, headers: {'content-type': 'application/json', 'retry-after': '120', 'x-ratelimit-reset-requests': '2m'}}));
  try {
    const res = await post(relay.token, {model: 'gw/aws-quick/claude-opus-5-5', input: 'x'});
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '120');
    assert.equal(res.headers.get('x-ratelimit-reset-requests'), '2m');
    const text = await res.text();
    assert.match(text, /insufficient_quota/);
    assert.equal(text.includes(KEY), false);
    // 反例：转发口自己的错误在 Codex 这条路上是 OpenAI 的格式（Codex 读 error.message），不是 Anthropic 的。
    const bad = await fetch(relay.baseUrl + '/v1/responses', {method: 'POST', headers: {authorization: `Bearer ${relay.token}`}, body: 'not json'});
    assert.equal(bad.status, 400);
    const body = await bad.json();
    assert.equal(body.type, undefined);
    assert.equal(body.error.type, 'invalid_request_error');
  } finally { await relay.stop(); }
});

function bridgeWith(answers, config = CONFIG) {
  const calls = [];
  const root = tmp();
  const service = {root, home: path.join(root, 'home'), status: () => ({running: true, url: 'http://127.0.0.1:3790', port: 3790}),
    cli: async () => ({ok: true}), addProject: async () => ({ok: true})};
  class Rpc {
    request(tag, payload) { calls.push([tag, payload]); return Promise.resolve(typeof answers[tag] === 'function' ? answers[tag](payload) : answers[tag]); }
    first(tag) { calls.push([tag]); return Promise.resolve(typeof answers[tag] === 'function' ? answers[tag]() : answers[tag]); }
    close() {}
  }
  const logs = [];
  const home = tmp();
  const bridge = new EngineBridge({service, RpcImpl: Rpc, homeDir: home, logger: {warn: (...a) => logs.push(a.join(' ')), info: (...a) => logs.push(a.join(' '))}, pinkieConfig: () => config});
  return {bridge, calls, logs, home};
}

test('codex: starting on Pinkie models creates its own instance first; switching mid-conversation takes effect from the next turn', async () => {
  let instances = {codex: {driver: 'codex'}};
  const folder = tmp();
  const {bridge, calls, logs, home} = bridgeWith({
    'server.getConfig': () => ({providers: [], settings: {providerInstances: instances}}),
    'server.updateSettings': payload => { const m = payload.providerInstanceMutation; instances = {...instances, [m.instanceId]: m.instance}; return {}; },
    'server.refreshProviders': {},
    'orchestration.subscribeShell': () => ({snapshot: {projects: [{id: 'p1', workspaceRoot: folder}]}}),
    'orchestration.launchThread': {threadId: 't1'},
    'orchestration.dispatchCommand': {},
    'orchestration.getThreadProjection': {thread: {id: 't1'}},
  });
  const codexHome = path.join(os.homedir(), '.codex', 'config.toml');
  const before = fs.existsSync(codexHome) ? fs.readFileSync(codexHome) : null;
  try {
    await bridge.start({folder, engine: CODEX_PINKIE_INSTANCE, model: 'gw/aws-quick/claude-opus-5-5', text: '改一下 README'});
    const create = calls.find(call => call[0] === 'server.updateSettings')[1].providerInstanceMutation;
    assert.deepEqual([create.operation, create.instanceId, create.instance.driver], ['create', CODEX_PINKIE_INSTANCE, 'codex']);
    assert.equal(create.instance.config.shadowHomePath, path.join(home, CODEX_PINKIE_FOLDER));
    assert.ok(fs.existsSync(path.join(home, CODEX_PINKIE_FOLDER)));
    assert.ok(create.instance.config.launchArgs.includes(bridge.relay.baseUrl + '/v1'), 'Codex is pointed at the live relay');
    const launch = calls.find(call => call[0] === 'orchestration.launchThread')[1];
    assert.deepEqual(launch.modelSelection, {instanceId: CODEX_PINKIE_INSTANCE, model: 'gw/aws-quick/claude-opus-5-5'});
    assert.ok(calls.findIndex(call => call[0] === 'server.updateSettings') < calls.findIndex(call => call[0] === 'orchestration.launchThread'));
    assert.equal(calls.some(call => call[1]?.providerInstanceMutation?.instanceId === PINKIE_INSTANCE), false, 'the Claude row is not touched by a Codex start');

    const count = calls.filter(call => call[0] === 'server.updateSettings').length;
    await bridge.start({folder, engine: CODEX_PINKIE_INSTANCE, model: 'gw/aws-quick/claude-opus-5-5', text: '再来'});
    assert.equal(calls.filter(call => call[0] === 'server.updateSettings').length, count, 'an instance that is already right is left alone');

    calls.length = 0;
    await bridge.configure({threadId: 't1', engine: 'codex', model: 'gpt-5.5'});
    assert.deepEqual(calls.find(call => call[0] === 'orchestration.dispatchCommand')[1].modelSelection, {instanceId: 'codex', model: 'gpt-5.5'});
    assert.equal(calls.some(call => call[0] === 'server.updateSettings'), false);
    calls.length = 0;
    await bridge.configure({threadId: 't1', engine: CODEX_PINKIE_INSTANCE, model: 'gw/aws-quick/claude-opus-5-5'});
    assert.equal(calls.find(call => call[0] === 'orchestration.dispatchCommand')[1].type, 'thread.model-selection.set');
    assert.equal(calls.some(call => call[0] === 'orchestration.launchThread'), false, 'the same thread, not a new one');

    await assert.rejects(bridge.renameAccount({engine: CODEX_PINKIE_INSTANCE, name: 'x'}), /碧琪模型/);
    await assert.rejects(bridge.removeAccount({engine: CODEX_PINKIE_INSTANCE}), /碧琪模型/);
    const everything = JSON.stringify(calls) + JSON.stringify(instances) + logs.join('\n');
    assert.equal(everything.includes(KEY) || everything.includes(OAKEY), false, 'the keys never reach the engine service or a log');
    const after = fs.existsSync(codexHome) ? fs.readFileSync(codexHome) : null;
    assert.deepEqual(after, before, 'the user\'s own ~/.codex/config.toml is not changed');
  } finally { await bridge.relay?.stop(); }

  // 反例：碧琪目录里没有能走 /v1/responses 的模型，就开不了，也不建实例。
  const empty = bridgeWith({'server.getConfig': () => ({providers: [], settings: {providerInstances: {}}})},
    {models: {providers: {chatonly: CONFIG.models.providers.chatonly}}});
  await assert.rejects(empty.bridge.start({folder, engine: CODEX_PINKIE_INSTANCE, model: 'x', text: 'hi'}), /没有能给 Codex 用的模型/);
  assert.equal(empty.calls.some(call => call[0] === 'server.updateSettings'), false);
  assert.equal(empty.bridge.relay, null);
});

test('codex: the menu row needs no ChatGPT login and is listed with Codex', () => {
  const rows = summarizeProviders([
    {instanceId: CODEX_PINKIE_INSTANCE, driver: 'codex', enabled: true, installed: true, status: 'ready', auth: {status: 'unauthenticated'}, setup: {canAuthenticate: true}, models: [{slug: 'gpt-6.2-sol', name: 'GPT 6.2', isCustom: false}, {slug: 'gw/a', name: 'A', isCustom: true}]},
    {instanceId: 'codex-2', driver: 'codex', enabled: true, installed: true, status: 'ready', auth: {status: 'unauthenticated'}},
  ]);
  const row = rows.find(r => r.id === CODEX_PINKIE_INSTANCE);
  assert.deepEqual([row.name, row.upstream, row.account, row.state], ['Codex · 碧琪模型', 'pinkie', false, 'ready']);
  assert.deepEqual(row.models.map(model => model.slug), ['gw/a'], 'Codex\'s own gpt models are not offered on the Pinkie row (11-25 real run)');
  assert.deepEqual([rows.find(r => r.id === 'codex-2').state], ['signin'], 'an added ChatGPT account still has to log in');
  assert.deepEqual([driverOf(CODEX_PINKIE_INSTANCE), isPinkieRow(CODEX_PINKIE_INSTANCE), isPinkieRow('codex-2')], ['codex', true, false]);
  const ids = rows.map(r => r.id);
  assert.ok(ids.indexOf('codex') < ids.indexOf(CODEX_PINKIE_INSTANCE));
});
