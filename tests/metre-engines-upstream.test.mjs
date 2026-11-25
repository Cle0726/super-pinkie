// 引擎台「碧琪模型」那条路（engines-upstream.mjs）：Claude Code 不用订阅，走碧琪上游。
// 覆盖：注入的环境变量对、钥匙不外泄、切换后下一轮生效、额度用完时原样转给引擎；每条都带反例。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ENV_NAMES, PINKIE_FOLDER, PINKIE_INSTANCE, PinkieRelay, TOP_EFFORT, linkPinkieHistory, pinkieInstance, pinkieModels, routeModel, upstreamBase, versionOf, writePinkieSettings}
  from '../services/mode-architecture/engines-upstream.mjs';
import {EngineBridge, driverOf, summarizeProviders} from '../services/mode-architecture/engines-bridge.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-upstream-'));
// 假钥匙运行时拼出来，测试文件里不出现一整串像钥匙的字。
const KEY = ['fake', 'upstream', 'key', 'a1b2c3d4e5f6'].join('-');
const OTHER = ['fake', 'remote', 'key', 'z9y8x7w6'].join('-');
const CONFIG = {models: {providers: {
  gw: {baseUrl: 'http://127.0.0.1:1466/v1', apiKey: KEY, models: [
    {id: 'claude-opus-4-20250514'}, {id: 'aws-quick/claude-opus-5-5'}, {id: 'claude-opus-4-7'}, {id: 'claude-opus-5-5-high'},
    {id: 'claude-opus-5-5-low'}, {id: 'claude-opus-5-5-medium'}, {id: 'claude-haiku-4-5-20251001'}, {id: 'gpt-5'}, {id: 'claude-image-1'}]},
  remote: {baseUrl: 'http://10.0.0.5/v1', apiKey: OTHER, models: [{id: 'claude-opus-5-5'}]},
  nokey: {baseUrl: 'https://gw.example/v1', models: [{id: 'claude-opus-5-5'}]},
}}};

test('only top-tier Claude models with a usable upstream are offered, newest first, failing ones last', () => {
  const slugs = pinkieModels(CONFIG).map(model => model.slug);
  assert.equal(slugs[0], 'gw/aws-quick/claude-opus-5-5', 'newest version first; a plain name before its -high twin');
  assert.ok(slugs.indexOf('gw/claude-opus-4-7') < slugs.indexOf('gw/claude-opus-4-20250514'), 'a date is not a minor version');
  for (const bad of ['gw/claude-opus-5-5-low', 'gw/claude-opus-5-5-medium', 'gw/claude-haiku-4-5-20251001', 'gw/gpt-5', 'gw/claude-image-1'])
    assert.equal(slugs.includes(bad), false, `${bad} is not offered (low effort, not top tier, not Claude, or not a chat model)`);
  assert.equal(slugs.some(slug => slug.startsWith('remote/')), false, 'plain http to another machine is refused');
  assert.equal(slugs.some(slug => slug.startsWith('nokey/')), false, 'a provider without a key is skipped');
  assert.deepEqual(pinkieModels({}), [], 'no catalog, no row');
  const health = {models: new Map([['gw/aws-quick/claude-opus-5-5', {failAt: 20, okAt: 10}], ['gw/claude-opus-4-7', {failAt: 10, okAt: 20}]])};
  const ranked = pinkieModels(CONFIG, {health});
  assert.equal(ranked.at(-1).slug, 'gw/aws-quick/claude-opus-5-5', 'the last call failed: it goes to the end');
  assert.equal(ranked.at(-1).failing, true);
  assert.equal(ranked[0].failing, undefined, 'a recovered model is not marked');
  assert.deepEqual([versionOf('claude-opus-5-5'), versionOf('claude-opus-4-20250514'), versionOf('claude-sonnet-4-6-thinking')], [505, 400, 406]);
});

test('upstream addresses: loopback http or https only, /v1 dropped, nothing after the host kept but the path', () => {
  assert.equal(upstreamBase('http://127.0.0.1:1466/v1'), 'http://127.0.0.1:1466');
  assert.equal(upstreamBase('https://gw.example/api/v1/'), 'https://gw.example/api');
  const withLogin = 'https://' + 'user' + ':' + 'pw' + '@gw.example/v1?x=1#y';
  assert.equal(upstreamBase(withLogin), 'https://gw.example', 'user info, query and fragment never reach the request');
  assert.equal(upstreamBase('http://10.0.0.5/v1'), '');
  assert.equal(upstreamBase('file:///etc/passwd'), '');
  assert.equal(upstreamBase('not a url'), '');
});

test('a model name outside the catalog goes to the default, never to some other provider', () => {
  const models = pinkieModels(CONFIG);
  assert.deepEqual(routeModel('gw/claude-opus-4-7', models), {slug: 'gw/claude-opus-4-7', provider: 'gw', model: 'claude-opus-4-7'});
  assert.equal(routeModel('claude-haiku-4-5-20251001', models, 'gw/claude-opus-4-7').slug, 'gw/claude-opus-4-7', 'Claude Code background calls use the chosen model');
  assert.equal(routeModel('remote/claude-opus-5-5', models).provider, 'gw', 'a refused provider cannot be reached by naming it');
  assert.equal(routeModel('x', []), null);
});

async function relayWith(respond) {
  const seen = [];
  const logs = [];
  const fetchImpl = async (url, init) => { seen.push({url, init}); return respond(url, init); };
  const relay = new PinkieRelay({config: () => CONFIG, fetchImpl, logger: {warn: (...a) => logs.push(a.join(' ')), info: (...a) => logs.push(a.join(' '))}});
  await relay.start();
  relay.defaultModel = 'gw/claude-opus-4-7';
  const post = (pass, body, extra = {}) => fetch(relay.baseUrl + '/v1/messages', {method: 'POST',
    headers: {'x-api-key': pass, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...extra}, body: typeof body === 'string' ? body : JSON.stringify(body)});
  return {relay, seen, logs, post};
}

test('the relay only answers its own session pass, swaps in the real key, and rewrites the model', async () => {
  const {relay, seen, logs, post} = await relayWith(() => new Response('event: message_start\ndata: {"type":"message_start"}\n\n', {status: 200, headers: {'content-type': 'text/event-stream'}}));
  try {
    const wrong = await post('not-the-pass-0000', {model: 'x', messages: []});
    assert.equal(wrong.status, 401);
    assert.equal(seen.length, 0, 'a wrong pass never reaches the upstream');
    const none = await fetch(relay.baseUrl + '/v1/messages', {method: 'POST', body: '{}'});
    assert.equal(none.status, 401, 'no pass at all is refused too');

    const ok = await post(relay.token, {model: 'gw/aws-quick/claude-opus-5-5', stream: true, messages: [{role: 'user', content: 'hi'}]}, {'anthropic-beta': 'b1', cookie: 'c=1'});
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /message_start/, 'the stream is passed through');
    assert.equal(seen[0].url, 'http://127.0.0.1:1466/v1/messages');
    assert.equal(seen[0].init.headers['x-api-key'], KEY, 'the upstream gets the real key');
    assert.equal(seen[0].init.headers['anthropic-beta'], 'b1');
    assert.equal(seen[0].init.headers.cookie, undefined, 'other headers are not forwarded');
    assert.equal(JSON.parse(seen[0].init.body).model, 'aws-quick/claude-opus-5-5', 'the provider prefix is taken off for the upstream');

    const bearer = await fetch(relay.baseUrl + '/v1/messages', {method: 'POST', headers: {authorization: 'Bearer ' + relay.token}, body: JSON.stringify({model: 'claude-haiku-x'})});
    assert.equal(bearer.status, 200, 'the pass also works as a bearer header (ANTHROPIC_AUTH_TOKEN)');
    assert.equal(JSON.parse(seen[1].init.body).model, 'claude-opus-4-7', 'an unknown model goes to the default');

    assert.equal((await post(relay.token, 'not json')).status, 400);
    assert.equal((await fetch(relay.baseUrl + '/v1/complete', {method: 'POST', headers: {'x-api-key': relay.token}, body: '{}'})).status, 404, 'only /v1/messages is relayed');
    const list = await (await fetch(relay.baseUrl + '/v1/models', {headers: {'x-api-key': relay.token}})).json();
    assert.equal(list.data[0].id, 'gw/aws-quick/claude-opus-5-5');

    const shown = JSON.stringify(relay) + JSON.stringify({...relay}) + logs.join('\n');
    assert.equal(shown.includes(relay.token), false, 'the pass never shows in a snapshot or a log');
    assert.equal(shown.includes(KEY), false, 'the key never shows in a snapshot or a log');
  } finally { await relay.stop(); }
});

test('quota used up upstream: the 429 and its reset time go back as they are, with any key taken out', async () => {
  const {relay, post} = await relayWith(() => new Response(JSON.stringify({type: 'error', error: {type: 'rate_limit_error', message: `limit for ${KEY}`}}),
    {status: 429, headers: {'content-type': 'application/json', 'retry-after': '3600'}}));
  try {
    const res = await post(relay.token, {model: 'gw/claude-opus-4-7', messages: []});
    assert.equal(res.status, 429, 'Claude Code and the engine service see a usage limit, the same as a subscription running out');
    assert.equal(res.headers.get('retry-after'), '3600');
    const text = await res.text();
    assert.match(text, /rate_limit_error/);
    assert.equal(text.includes(KEY), false, 'an upstream error that repeats the key is cleaned');
  } finally { await relay.stop(); }
  const down = await relayWith(() => { throw new Error(`connect refused with ${KEY}`); });
  try {
    const res = await down.post(down.relay.token, {model: 'gw/claude-opus-4-7', messages: []});
    assert.equal(res.status, 502);
    assert.equal((await res.text()).includes(KEY), false, 'a network error that carries the key is cleaned');
  } finally { await down.relay.stop(); }
});

test('the instance settings point Claude Code at the relay with every model slot and the top effort, and hold no upstream key', () => {
  const dir = path.join(tmp(), PINKIE_FOLDER);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({theme: 'dark', env: {ANTHROPIC_BASE_URL: 'https://old.example', MY_OWN: '1'}}));
  const pass = 'session-pass-0123456789abcdef';
  writePinkieSettings(dir, {baseUrl: 'http://127.0.0.1:5063', token: pass, model: 'gw/aws-quick/claude-opus-5-5'});
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  const saved = JSON.parse(raw);
  assert.equal(saved.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:5063', 'an old address is replaced');
  assert.equal(saved.env.ANTHROPIC_AUTH_TOKEN, pass);
  for (const slot of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'])
    assert.equal(saved.env[slot], 'gw/aws-quick/claude-opus-5-5', `${slot} uses the chosen top model`);
  assert.equal(saved.env.CLAUDE_CODE_EFFORT_LEVEL, TOP_EFFORT);
  assert.equal(saved.effortLevel, TOP_EFFORT);
  assert.equal(saved.theme, 'dark', 'the user\'s own settings stay');
  assert.equal(saved.env.MY_OWN, '1', 'the user\'s own variables stay');
  assert.equal(Object.keys(saved.env).filter(name => !ENV_NAMES.includes(name)).join(), 'MY_OWN');
  assert.equal(raw.includes(KEY) || raw.includes(OTHER), false, 'no upstream key on disk');
  assert.equal(saved.env.ANTHROPIC_API_KEY, undefined);
  assert.throws(() => writePinkieSettings('relative/dir', {baseUrl: 'x', token: 'y'}), /绝对路径/);
  const instance = pinkieInstance(dir, [{slug: 'gw/a', name: 'A'}]);
  assert.deepEqual(instance.config, {homePath: dir, customModels: [{slug: 'gw/a', name: 'A'}]});
  assert.equal(JSON.stringify(instance).includes(KEY), false);
});

test('the menu row for Pinkie models needs no subscription login and cannot be renamed or removed', () => {
  const rows = summarizeProviders([
    {instanceId: PINKIE_INSTANCE, driver: 'claudeAgent', displayName: 'whatever', enabled: true, installed: true, status: 'ready', auth: {status: 'unauthenticated'}, setup: {canAuthenticate: true}, models: [{slug: 'gw/aws-quick/claude-opus-5-5', name: 'Opus 5.5'}]},
    {instanceId: 'claudeAgent-2', driver: 'claudeAgent', enabled: true, installed: true, status: 'ready', auth: {status: 'unauthenticated'}},
  ]);
  const pinkie = rows.find(row => row.id === PINKIE_INSTANCE);
  assert.deepEqual([pinkie.name, pinkie.upstream, pinkie.account, pinkie.state], ['Claude Code · 碧琪模型', 'pinkie', false, 'ready']);
  const own = rows.find(row => row.id === 'claudeAgent-2');
  assert.deepEqual([own.upstream, own.state], ['own', 'signin'], 'an added subscription account still has to log in');
  assert.equal(driverOf(PINKIE_INSTANCE), 'claudeAgent');
  const ids = rows.map(row => row.id);
  assert.ok(ids.indexOf('claudeAgent') < ids.indexOf(PINKIE_INSTANCE) && ids.indexOf(PINKIE_INSTANCE) < ids.indexOf('codex'), 'listed with Claude Code');
});

function bridgeWith(answers) {
  const calls = [];
  const root = tmp();
  const service = {root, home: path.join(root, 'home'), status: () => ({running: true, url: 'http://127.0.0.1:3790', port: 3790}),
    cli: async args => (args[0] === 'auth' ? {text: 'x'.repeat(40)} : {ok: true}), addProject: async () => ({ok: true})};
  class Rpc {
    request(tag, payload) { calls.push([tag, payload]); return Promise.resolve(typeof answers[tag] === 'function' ? answers[tag](payload) : answers[tag]); }
    first(tag) { calls.push([tag]); return Promise.resolve(typeof answers[tag] === 'function' ? answers[tag]() : answers[tag]); }
    close() {}
  }
  const logs = [];
  const logger = {warn: (...a) => logs.push(a.join(' ')), info: (...a) => logs.push(a.join(' '))};
  let config = CONFIG;
  const home = tmp();
  const bridge = new EngineBridge({service, RpcImpl: Rpc, homeDir: home, logger, pinkieConfig: () => config});
  return {bridge, calls, logs, home, setConfig: next => { config = next; }};
}

test('starting on Pinkie models sets up the relay and the instance first; switching mid-conversation takes effect from the next turn', async () => {
  let instances = {claudeAgent: {driver: 'claudeAgent'}};
  const folder = tmp();
  const {bridge, calls, logs, home, setConfig} = bridgeWith({
    'server.getConfig': () => ({providers: [], settings: {providerInstances: instances}}),
    'server.updateSettings': payload => { const m = payload.providerInstanceMutation; instances = {...instances, [m.instanceId]: m.instance}; return {}; },
    'server.refreshProviders': {},
    'orchestration.subscribeShell': () => ({snapshot: {projects: [{id: 'p1', workspaceRoot: folder}]}}),
    'orchestration.launchThread': {threadId: 't1'},
    'orchestration.dispatchCommand': {},
    'orchestration.getThreadProjection': {thread: {id: 't1'}},
  });
  try {
    const started = await bridge.start({folder, engine: PINKIE_INSTANCE, model: 'gw/aws-quick/claude-opus-5-5', text: '改一下 README'});
    assert.equal(started.threadId, 't1');
    const create = calls.find(call => call[0] === 'server.updateSettings')[1].providerInstanceMutation;
    assert.equal(create.operation, 'create');
    assert.equal(create.instanceId, PINKIE_INSTANCE);
    assert.equal(create.instance.config.homePath, path.join(home, PINKIE_FOLDER), 'its own config folder, not the user\'s ~/.claude');
    assert.equal(create.instance.config.customModels[0].slug, 'gw/aws-quick/claude-opus-5-5');
    const launch = calls.find(call => call[0] === 'orchestration.launchThread')[1];
    assert.deepEqual(launch.modelSelection, {instanceId: PINKIE_INSTANCE, model: 'gw/aws-quick/claude-opus-5-5'});
    assert.ok(calls.findIndex(call => call[0] === 'server.updateSettings') < calls.findIndex(call => call[0] === 'orchestration.launchThread'), 'set up before the thread opens');
    const settings = JSON.parse(fs.readFileSync(path.join(home, PINKIE_FOLDER, 'settings.json'), 'utf8'));
    assert.equal(settings.env.ANTHROPIC_BASE_URL, bridge.relay.baseUrl, 'Claude Code is pointed at the live relay');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, bridge.relay.token);

    // 再开一次：实例已经对了，不重复改引擎服务的设置。
    const before = calls.filter(call => call[0] === 'server.updateSettings').length;
    await bridge.start({folder, engine: PINKIE_INSTANCE, model: 'gw/aws-quick/claude-opus-5-5', text: '再来'});
    assert.equal(calls.filter(call => call[0] === 'server.updateSettings').length, before, 'an instance that is already right is left alone');

    // 中途切换：只换这段对话的模型选择，引擎服务从下一轮起用新的。
    calls.length = 0;
    await bridge.configure({threadId: 't1', engine: 'claudeAgent', model: 'claude-opus-4-7'});
    assert.deepEqual(calls.find(call => call[0] === 'orchestration.dispatchCommand')[1].modelSelection, {instanceId: 'claudeAgent', model: 'claude-opus-4-7'});
    assert.equal(calls.some(call => call[0] === 'server.updateSettings'), false, 'switching to the subscription does not touch the Pinkie instance');
    calls.length = 0;
    await bridge.configure({threadId: 't1', engine: PINKIE_INSTANCE, model: 'gw/claude-opus-4-7'});
    const set = calls.find(call => call[0] === 'orchestration.dispatchCommand')[1];
    assert.deepEqual([set.type, set.modelSelection], ['thread.model-selection.set', {instanceId: PINKIE_INSTANCE, model: 'gw/claude-opus-4-7'}]);
    assert.equal(calls.some(call => call[0] === 'orchestration.launchThread'), false, 'the same thread, not a new one');

    await assert.rejects(bridge.renameAccount({engine: PINKIE_INSTANCE, name: 'x'}), /碧琪模型/);
    await assert.rejects(bridge.removeAccount({engine: PINKIE_INSTANCE}), /碧琪模型/);

    // 会话存档不一定写过：有就一起查，没有不算失败，也不能让后面的反例被跳过。
    const sessions = path.join(bridge.service.root, 'sessions.json');
    const everything = JSON.stringify(calls) + logs.join('\n') + fs.readFileSync(path.join(home, PINKIE_FOLDER, 'settings.json'), 'utf8')
      + (fs.existsSync(sessions) ? fs.readFileSync(sessions, 'utf8') : '');
    assert.equal(everything.includes(KEY), false, 'the key is never sent to the engine service, written down or logged');
  } finally { await bridge.relay?.stop(); }

  // 反例：碧琪目录里没有能用的模型，就开不了「碧琪模型」，也不去建实例。
  const empty = bridgeWith({'server.getConfig': () => ({providers: [], settings: {providerInstances: {}}})});
  empty.setConfig({models: {providers: {gw: {baseUrl: 'http://127.0.0.1:1466/v1', apiKey: KEY, models: [{id: 'gpt-5'}]}}}});
  await assert.rejects(empty.bridge.start({folder, engine: PINKIE_INSTANCE, model: 'x', text: 'hi'}), /没有能给 Claude Code 用的模型/);
  assert.equal(empty.calls.some(call => call[0] === 'server.updateSettings'), false);
  assert.equal(empty.bridge.relay, null, 'no relay is opened');
});

// 一段对话的记录写在一边，另一边能不能读到同一份。
function sharesHistory(pinkieProjects, ownProjects) {
  const name = `probe-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const session = path.join(ownProjects, name, 's1.jsonl');
  fs.mkdirSync(path.dirname(session), {recursive: true});
  fs.writeFileSync(session, '{"turn":1}\n');
  const seen = fs.existsSync(path.join(pinkieProjects, name, 's1.jsonl'));
  // 反过来：碧琪那边接着写的一轮，订阅那边也看得到。
  let back = false;
  if (seen) { fs.appendFileSync(path.join(pinkieProjects, name, 's1.jsonl'), '{"turn":2}\n'); back = /turn":2/.test(fs.readFileSync(session, 'utf8')); }
  fs.rmSync(path.join(ownProjects, name), {recursive: true, force: true});
  return seen && back;
}

test('history: the Pinkie folder reads the same projects as the default account, through a junction, and never takes over a real folder', () => {
  const home = tmp();
  const dir = path.join(home, PINKIE_FOLDER);
  const shared = path.join(home, '.claude', 'projects');
  fs.mkdirSync(path.join(home, '.claude'), {recursive: true});
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"mine":true}');

  // 反例先行：两个各自独立的文件夹，判据必须说「不共用」——判据本身能分辨。
  fs.mkdirSync(path.join(dir, 'projects'), {recursive: true});
  fs.mkdirSync(shared, {recursive: true});
  assert.equal(sharesHistory(path.join(dir, 'projects'), shared), false, 'two plain folders do not share history');
  // 那里已经有真目录：不删、不覆盖，原样留着。
  fs.writeFileSync(path.join(dir, 'projects', 'keep.txt'), 'x');
  assert.equal(linkPinkieHistory(dir, {shared}).state, 'conflict');
  assert.equal(fs.readFileSync(path.join(dir, 'projects', 'keep.txt'), 'utf8'), 'x', 'a real folder is left as it was');
  assert.equal(fs.lstatSync(path.join(dir, 'projects')).isSymbolicLink(), false);
  fs.rmSync(path.join(dir, 'projects'), {recursive: true});

  // 正例：没有 projects 时建链接，两边读写同一份。
  assert.equal(linkPinkieHistory(dir, {shared}).state, 'linked');
  assert.equal(fs.lstatSync(path.join(dir, 'projects')).isSymbolicLink(), true, 'a link (junction on Windows), not a copy');
  assert.equal(sharesHistory(path.join(dir, 'projects'), shared), true, 'both sides see the same conversation');
  assert.equal(linkPinkieHistory(dir, {shared}).state, 'ok', 'a second run leaves the link alone');

  // 指向别处的链接也不替人改。
  const elsewhere = path.join(home, 'elsewhere');
  fs.mkdirSync(elsewhere);
  const dir2 = path.join(home, 'other-pinkie');
  fs.mkdirSync(dir2);
  fs.symlinkSync(elsewhere, path.join(dir2, 'projects'), 'junction');
  assert.equal(linkPinkieHistory(dir2, {shared}).state, 'conflict');
  assert.equal(fs.realpathSync(path.join(dir2, 'projects')).toLowerCase(), fs.realpathSync(elsewhere).toLowerCase());

  // ~/.claude 里别的东西一样都没动。
  assert.deepEqual(fs.readdirSync(path.join(home, '.claude')).sort(), ['projects', 'settings.json']);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{"mine":true}');
  assert.throws(() => linkPinkieHistory('relative', {shared}), /绝对路径/);
});

test('history: once the bridge sets up Pinkie models, switching a conversation to and from it keeps its history', async () => {
  let instances = {claudeAgent: {driver: 'claudeAgent'}};
  const {bridge, home, logs} = bridgeWith({
    'server.getConfig': () => ({providers: [], settings: {providerInstances: instances}}),
    'server.updateSettings': payload => { const m = payload.providerInstanceMutation; instances = {...instances, [m.instanceId]: m.instance}; return {}; },
    'server.refreshProviders': {},
  });
  try {
    assert.ok(await bridge.ensurePinkie());
    const own = path.join(home, '.claude', 'projects');
    const pinkie = path.join(home, PINKIE_FOLDER, 'projects');
    assert.equal(bridge.pinkieHistory.state, 'linked');
    // 这一条靠 ensurePinkie 里那个 junction：去掉它，碧琪那边就是一个空的新文件夹，这里会红。
    assert.equal(sharesHistory(pinkie, own), true, 'the subscription side and the Pinkie side read one projects folder');
    await bridge.ensurePinkie();
    assert.equal(bridge.pinkieHistory.state, 'linked', 'not re-linked on every call');
    assert.equal(logs.some(line => /history not shared/.test(line)), false);
  } finally { await bridge.relay?.stop(); }

  // 反例：碧琪文件夹里已经有一个真的 projects，就不接、不动，只记一句。
  const second = bridgeWith({
    'server.getConfig': () => ({providers: [], settings: {providerInstances: {}}}),
    'server.updateSettings': {}, 'server.refreshProviders': {},
  });
  try {
    const real = path.join(second.home, PINKIE_FOLDER, 'projects');
    fs.mkdirSync(real, {recursive: true});
    fs.writeFileSync(path.join(real, 'old.jsonl'), 'old');
    await second.bridge.ensurePinkie();
    assert.equal(second.bridge.pinkieHistory.state, 'conflict');
    assert.equal(fs.readFileSync(path.join(real, 'old.jsonl'), 'utf8'), 'old');
    assert.equal(sharesHistory(real, path.join(second.home, '.claude', 'projects')), false);
    assert.ok(second.logs.some(line => /history not shared: conflict/.test(line)), 'the conflict is logged, not hidden');
  } finally { await second.bridge.relay?.stop(); }
});
