// 引擎台「碧琪模型」OpenCode 那一家（engines-upstream.mjs 末尾 + engines-bridge.mjs ensureOpenCodePinkie）：
// OpenCode 不用自己的账号，走碧琪上游的 /v1/chat/completions。每条都带反例。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {OPENCODE_PINKIE_INSTANCE, OPENCODE_PROVIDER_ID, PinkieRelay, TOP_EFFORT, openCodeConfigContent, openCodePinkieInstance, pinkieModels}
  from '../services/mode-architecture/engines-upstream.mjs';
import {EngineBridge, driverOf, isPinkieRow, summarizeProviders} from '../services/mode-architecture/engines-bridge.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-opencode-'));
// 假钥匙运行时拼，测试文件里没有一整串像钥匙的字。
const KEY = ['fake', 'gateway', 'key', 'm1n2b3v4c5'].join('-');
const CHATKEY = ['fake', 'chat', 'key', 'x9z8y7w6'].join('-');
const CONFIG = {models: {providers: {
  gw: {baseUrl: 'http://127.0.0.1:1466/v1', apiKey: KEY, models: [
    {id: 'aws-quick/claude-opus-5-5'}, {id: 'claude-opus-5-5-low'}, {id: 'claude-haiku-4-5-20251001'}, {id: 'gpt-5'}]},
  remote: {baseUrl: 'http://10.0.0.5/v1', apiKey: 'r'.repeat(12), models: [{id: 'claude-opus-5-5'}]},
  chat: {baseUrl: 'https://chat.example/v1', api: 'openai-completions', apiKey: CHATKEY, models: [{id: 'claude-opus-5-5'}, {id: 'gpt-5.1'}]},
  resp: {baseUrl: 'https://resp.example/v1', api: 'openai-responses', apiKey: 'p'.repeat(12), models: [{id: 'claude-opus-5-5'}]},
}}};
const PASS = 'session-pass-0123456789abcdef';

test('opencode: only top-tier models whose upstream speaks /v1/chat/completions are offered', () => {
  const slugs = pinkieModels(CONFIG, {family: 'chat'}).map(model => model.slug);
  assert.ok(slugs.includes('gw/aws-quick/claude-opus-5-5'), 'the local gateway answers /v1/chat/completions');
  assert.ok(slugs.includes('chat/claude-opus-5-5'), 'an https upstream marked openai-completions is offered');
  // 反例：只有 Responses 的上游、别的机器上的明文 http、非 top 档、低思考档都不列。
  for (const bad of ['resp/claude-opus-5-5', 'remote/claude-opus-5-5', 'chat/gpt-5.1', 'gw/gpt-5', 'gw/claude-opus-5-5-low', 'gw/claude-haiku-4-5-20251001'])
    assert.equal(slugs.includes(bad), false, `${bad} is not offered`);
  assert.deepEqual(pinkieModels({}, {family: 'chat'}), []);
});

test('opencode: the config content points one provider at the relay with the session pass and the top effort, and holds no upstream key', () => {
  const models = [{slug: 'gw/aws-quick/claude-opus-5-5', name: 'Opus 5.5'}];
  const text = openCodeConfigContent({baseUrl: 'http://127.0.0.1:5063', token: PASS, models});
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed), ['provider'], 'only a provider is added; the rest of the user\'s OpenCode settings are untouched');
  const provider = parsed.provider[OPENCODE_PROVIDER_ID];
  assert.equal(provider.npm, '@ai-sdk/openai-compatible');
  assert.deepEqual(provider.options, {baseURL: 'http://127.0.0.1:5063/v1', apiKey: PASS});
  assert.deepEqual(provider.models['gw/aws-quick/claude-opus-5-5'].options, {reasoningEffort: TOP_EFFORT});
  assert.equal(text.includes(KEY) || text.includes(CHATKEY), false);
  // 反例：地址和令牌不对就不生成。
  assert.throws(() => openCodeConfigContent({baseUrl: 'http://10.0.0.5:1', token: PASS, models}), /地址不对/);
  assert.throws(() => openCodeConfigContent({baseUrl: 'http://127.0.0.1:5063', token: 'a"b', models}), /令牌不对/);

  const instance = openCodePinkieInstance(models, {baseUrl: 'http://127.0.0.1:5063', token: PASS});
  assert.equal(instance.driver, 'opencode');
  assert.deepEqual(instance.environment.map(v => [v.name, v.sensitive]), [['OPENCODE_CONFIG_CONTENT', true]], 'the content carries the pass, so it is stored as a secret');
  assert.deepEqual(instance.config.customModels, [{slug: `${OPENCODE_PROVIDER_ID}/gw/aws-quick/claude-opus-5-5`, name: 'Opus 5.5'}],
    'menu names are pinkie/<Pinkie model>: the engine service splits at the first slash');
  assert.equal(JSON.stringify(instance.config).includes(PASS), false, 'the pass is only in the sensitive variable, not in the plain settings');
});

async function relayWith(respond) {
  const seen = [];
  const relay = new PinkieRelay({config: () => CONFIG, fetchImpl: async (url, init) => { seen.push({url, init}); return respond(url, init); }});
  await relay.start();
  relay.chatModel = 'gw/aws-quick/claude-opus-5-5';
  const post = (pass, body, extra = {}) => fetch(relay.baseUrl + '/v1/chat/completions', {method: 'POST',
    headers: {authorization: `Bearer ${pass}`, 'content-type': 'application/json', ...extra}, body: JSON.stringify(body)});
  return {relay, seen, post};
}

test('opencode: the relay forwards /v1/chat/completions with the real key as a bearer, and keeps the stream', async () => {
  const {relay, seen, post} = await relayWith(() => new Response('data: {"choices":[]}\n\n', {status: 200, headers: {'content-type': 'text/event-stream'}}));
  try {
    assert.equal((await post('wrong-pass-000000', {model: 'x'})).status, 401);
    assert.equal(seen.length, 0, 'a wrong pass never reaches the upstream');
    const ok = await post(relay.token, {model: 'chat/claude-opus-5-5', stream: true, messages: []}, {cookie: 'c=1'});
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /choices/);
    assert.equal(seen[0].url, 'https://chat.example/v1/chat/completions');
    assert.equal(seen[0].init.headers.authorization, `Bearer ${CHATKEY}`);
    assert.equal(seen[0].init.headers['x-api-key'], undefined, 'no Anthropic header on the OpenAI path');
    assert.equal(seen[0].init.headers.cookie, undefined);
    assert.equal(JSON.parse(seen[0].init.body).model, 'claude-opus-5-5');
    // 反例：只有 Responses 的上游点名也到不了；不在目录里的名字换成 OpenCode 那条路的默认模型。
    await post(relay.token, {model: 'resp/claude-opus-5-5', messages: []});
    assert.equal(seen[1].url, 'http://127.0.0.1:1466/v1/chat/completions');
    assert.equal(JSON.parse(seen[1].init.body).model, 'aws-quick/claude-opus-5-5');
  } finally { await relay.stop(); }
});

test('opencode: quota used up upstream comes back as a 429 with its reset headers and no key', async () => {
  const {relay, post} = await relayWith(() => new Response(JSON.stringify({error: {type: 'rate_limit', message: `limit for ${CHATKEY}`}}),
    {status: 429, headers: {'content-type': 'application/json', 'retry-after': '90'}}));
  try {
    const res = await post(relay.token, {model: 'chat/claude-opus-5-5', messages: []});
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '90');
    const text = await res.text();
    assert.match(text, /rate_limit/);
    assert.equal(text.includes(CHATKEY), false);
    // 反例：转发口自己的错误在这条路上是 OpenAI 的格式。
    const bad = await fetch(relay.baseUrl + '/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${relay.token}`}, body: 'not json'});
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).type, undefined);
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
  const bridge = new EngineBridge({service, RpcImpl: Rpc, homeDir: tmp(), logger: {warn: (...a) => logs.push(a.join(' ')), info: (...a) => logs.push(a.join(' '))}, pinkieConfig: () => config});
  return {bridge, calls, logs};
}

test('opencode: starting on Pinkie models creates its own instance first; switching mid-conversation takes effect from the next turn', async () => {
  // 引擎服务回读时把 sensitive 的值遮掉：桥不能拿回读值比，要靠自己的戳，不然每次都会重写。
  let instances = {opencode: {driver: 'opencode'}};
  const folder = tmp();
  const {bridge, calls, logs} = bridgeWith({
    'server.getConfig': () => ({providers: [], settings: {providerInstances: Object.fromEntries(Object.entries(instances).map(([id, inst]) =>
      [id, {...inst, environment: (inst.environment || []).map(v => (v.sensitive ? {...v, value: '', valueRedacted: true} : v))}]))}}),
    'server.updateSettings': payload => { const m = payload.providerInstanceMutation; instances = {...instances, [m.instanceId]: m.instance}; return {}; },
    'server.refreshProviders': {},
    'orchestration.subscribeShell': () => ({snapshot: {projects: [{id: 'p1', workspaceRoot: folder}]}}),
    'orchestration.launchThread': {threadId: 't1'},
    'orchestration.dispatchCommand': {},
    'orchestration.getThreadProjection': {thread: {id: 't1'}},
  });
  const userConfig = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const before = fs.existsSync(userConfig) ? fs.readFileSync(userConfig) : null;
  try {
    const model = `${OPENCODE_PROVIDER_ID}/gw/aws-quick/claude-opus-5-5`;
    await bridge.start({folder, engine: OPENCODE_PINKIE_INSTANCE, model, text: '改一下 README'});
    const create = calls.find(call => call[0] === 'server.updateSettings')[1].providerInstanceMutation;
    assert.deepEqual([create.operation, create.instanceId, create.instance.driver], ['create', OPENCODE_PINKIE_INSTANCE, 'opencode']);
    const content = JSON.parse(create.instance.environment[0].value);
    assert.equal(content.provider[OPENCODE_PROVIDER_ID].options.baseURL, bridge.relay.baseUrl + '/v1', 'OpenCode is pointed at the live relay');
    const launch = calls.find(call => call[0] === 'orchestration.launchThread')[1];
    assert.deepEqual(launch.modelSelection, {instanceId: OPENCODE_PINKIE_INSTANCE, model});
    assert.ok(calls.findIndex(call => call[0] === 'server.updateSettings') < calls.findIndex(call => call[0] === 'orchestration.launchThread'));

    const count = calls.filter(call => call[0] === 'server.updateSettings').length;
    await bridge.start({folder, engine: OPENCODE_PINKIE_INSTANCE, model, text: '再来'});
    assert.equal(calls.filter(call => call[0] === 'server.updateSettings').length, count, 'a redacted read-back does not cause a rewrite every time');

    // 反例：转发口重新起了（碧琪重启：新端口、新令牌），就要重写。令牌只读，所以换一个转发口来模拟。
    const oldPass = bridge.relay.token;
    await bridge.relay.stop();
    bridge.relay = null;
    await bridge.configure({threadId: 't1', engine: OPENCODE_PINKIE_INSTANCE, model});
    assert.equal(calls.filter(call => call[0] === 'server.updateSettings').length, count + 1, 'a new pass is written');
    assert.notEqual(oldPass, bridge.relay.token);
    const rewritten = calls.filter(call => call[0] === 'server.updateSettings').at(-1)[1].providerInstanceMutation;
    assert.equal(JSON.parse(rewritten.instance.environment[0].value).provider[OPENCODE_PROVIDER_ID].options.apiKey, bridge.relay.token);

    calls.length = 0;
    await bridge.configure({threadId: 't1', engine: 'opencode', model: 'openai/gpt-5.1'});
    assert.deepEqual(calls.find(call => call[0] === 'orchestration.dispatchCommand')[1].modelSelection, {instanceId: 'opencode', model: 'openai/gpt-5.1'});
    assert.equal(calls.some(call => call[0] === 'server.updateSettings'), false);
    assert.equal(calls.some(call => call[0] === 'orchestration.launchThread'), false, 'the same thread, not a new one');

    await assert.rejects(bridge.renameAccount({engine: OPENCODE_PINKIE_INSTANCE, name: 'x'}), /碧琪模型/);
    await assert.rejects(bridge.removeAccount({engine: OPENCODE_PINKIE_INSTANCE}), /碧琪模型/);
    const everything = JSON.stringify(calls) + JSON.stringify(instances) + logs.join('\n');
    assert.equal(everything.includes(KEY) || everything.includes(CHATKEY), false, 'the keys never reach the engine service or a log');
    const after = fs.existsSync(userConfig) ? fs.readFileSync(userConfig) : null;
    assert.deepEqual(after, before, 'the user\'s own opencode.json is not changed');
  } finally { await bridge.relay?.stop(); }

  // 反例：碧琪目录里没有能走 /v1/chat/completions 的模型，就开不了，也不建实例。
  const empty = bridgeWith({'server.getConfig': () => ({providers: [], settings: {providerInstances: {}}})},
    {models: {providers: {resp: CONFIG.models.providers.resp}}});
  await assert.rejects(empty.bridge.start({folder, engine: OPENCODE_PINKIE_INSTANCE, model: 'x/y', text: 'hi'}), /没有能给 OpenCode 用的模型/);
  assert.equal(empty.calls.some(call => call[0] === 'server.updateSettings'), false);
  assert.equal(empty.bridge.relay, null);
});

test('opencode: the menu row is listed with OpenCode and cannot be renamed or removed', () => {
  const rows = summarizeProviders([
    {instanceId: OPENCODE_PINKIE_INSTANCE, driver: 'opencode', enabled: true, installed: true, status: 'ready', auth: {status: 'unknown'}, models: [{slug: 'pinkie/gw/a', name: 'A'}]},
  ]);
  const row = rows.find(r => r.id === OPENCODE_PINKIE_INSTANCE);
  assert.deepEqual([row.name, row.upstream, row.account, row.state], ['OpenCode · 碧琪模型', 'pinkie', false, 'ready']);
  assert.deepEqual([driverOf(OPENCODE_PINKIE_INSTANCE), isPinkieRow(OPENCODE_PINKIE_INSTANCE), isPinkieRow('opencode')], ['opencode', true, false]);
  const ids = rows.map(r => r.id);
  assert.ok(ids.indexOf('opencode') < ids.indexOf(OPENCODE_PINKIE_INSTANCE));
});
