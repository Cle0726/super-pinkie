// 引擎上游切换（#127）的单元测试缺口：已有三份测试没碰到的纯逻辑分支。
// 只补缺口，不重复 tests/metre-engines-upstream*.test.mjs 已有的用例；不起浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {PINKIE_FOLDER, PinkieRelay, codexLaunchArgs, codexPinkieInstance, linkPinkieHistory, openCodeConfigContent, openCodePinkieInstance, pinkieModels, routeModel, upstreamBase, versionOf, writePinkieSettings}
  from '../services/mode-architecture/engines-upstream.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-upstream-gaps-'));
// 假钥匙运行时拼出来，测试文件里不出现一整串像钥匙的字。
const KEY = ['fake', 'upstream', 'key', 'a1b2c3d4e5f6'].join('-');
const PASS = 'session-pass-0123456789abcdef';
const CONFIG = {models: {providers: {
  gw: {baseUrl: 'http://127.0.0.1:1466/v1', apiKey: KEY, models: [{id: 'claude-opus-5-5'}, {id: 'claude-opus-4-7'}]},
  blank: {baseUrl: 'https://gw.example/v1', apiKey: '   ', models: [{id: 'claude-opus-5-5'}]},
}}};

test('versionOf: dotted versions, old-style names, two-digit majors, and no version at all', () => {
  assert.equal(versionOf('claude-opus-5.5'), 505, '5.5 counts as 5.5, not 5.0');
  assert.equal(versionOf('claude-5-5'), 505, 'old-style name without opus/sonnet/haiku');
  assert.equal(versionOf('claude-opus-10-1'), 1001, 'two-digit major is not capped at 9');
  assert.equal(versionOf('claude-opus-5-5-high'), 505, 'effort suffix after the version is ignored');
  assert.equal(versionOf('gpt-5'), 0, 'not a Claude name, no version');
  assert.equal(versionOf('claude-opus-x'), 0);
  assert.equal(versionOf(''), 0);
});

test('pinkieModels: a whitespace-only key counts as no key; health records at the boundary', () => {
  const slugs = pinkieModels(CONFIG).map(model => model.slug);
  assert.equal(slugs.some(slug => slug.startsWith('blank/')), false, 'a provider whose key is only spaces is skipped');
  const health = {models: new Map([
    ['gw/claude-opus-5-5', {failAt: 20}], // 有失败、没成功过：还坏着
    ['gw/claude-opus-4-7', {failAt: 10, okAt: 10}], // 同一时间失败又成功：不算坏
  ])};
  const ranked = pinkieModels(CONFIG, {health});
  assert.equal(ranked.find(model => model.slug === 'gw/claude-opus-5-5').failing, true);
  assert.equal(ranked.find(model => model.slug === 'gw/claude-opus-4-7').failing, undefined, 'failAt == okAt is not failing');
  assert.equal(ranked.at(-1).slug, 'gw/claude-opus-5-5', 'the still-failing one goes last');
  const okOnly = {models: new Map([['gw/claude-opus-5-5', {okAt: 30}]])};
  assert.equal(pinkieModels(CONFIG, {health: okOnly}).find(model => model.slug === 'gw/claude-opus-5-5').failing, undefined);
});

test('upstreamBase: every loopback spelling works, lookalike hostnames do not', () => {
  assert.equal(upstreamBase('http://localhost:1466/v1'), 'http://localhost:1466');
  assert.equal(upstreamBase('http://[::1]:1466/v1'), 'http://[::1]:1466');
  assert.equal(upstreamBase('https://localhost/v1'), 'https://localhost');
  assert.equal(upstreamBase('HTTP://127.0.0.1:1466/v1'), 'http://127.0.0.1:1466', 'scheme case is normalized by URL');
  assert.equal(upstreamBase('http://127.0.0.1.evil.com/v1'), '', 'a suffix that looks like loopback is not loopback');
  assert.equal(upstreamBase('http://localhost.evil.com/v1'), '');
  assert.equal(upstreamBase('http://127.0.0.1:1466.evil.com/v1'), '');
});

test('routeModel: the fallback chain ends at the first model, never at nothing', () => {
  const models = pinkieModels(CONFIG);
  assert.equal(routeModel('nope', models, 'gw/does-not-exist').slug, models[0].slug, 'a fallback that is not listed falls through to the first model');
  assert.equal(routeModel('', models).slug, models[0].slug, 'an empty request also takes the first model');
  assert.equal(routeModel('x', []), null);
  // 提供方名字里带「/」：菜单拼出来的 slug 在第一个「/」处拆，拆出来的提供方对不上号。
  const slash = pinkieModels({models: {providers: {'my/gw': {baseUrl: 'https://gw.example/v1', apiKey: KEY, models: [{id: 'claude-opus-5-5'}]}}}});
  assert.deepEqual(slash.map(model => model.slug), ['my/gw/claude-opus-5-5'], 'it is still offered on the menu');
  assert.deepEqual(routeModel('my/gw/claude-opus-5-5', slash), {slug: 'my/gw/claude-opus-5-5', provider: 'my', model: 'gw/claude-opus-5-5'});
});

test('a provider name with a slash is listed but never reaches an upstream: the relay answers 503 and sends nothing out', async () => {
  const seen = [];
  const relay = new PinkieRelay({config: () => ({models: {providers: {'my/gw': {baseUrl: 'https://gw.example/v1', apiKey: KEY, models: [{id: 'claude-opus-5-5'}]}}}}),
    fetchImpl: async (url, init) => { seen.push({url, init}); return new Response('ok', {status: 200}); }});
  await relay.start();
  try {
    const res = await fetch(relay.baseUrl + '/v1/messages', {method: 'POST',
      headers: {'x-api-key': relay.token, 'content-type': 'application/json'},
      body: JSON.stringify({model: 'my/gw/claude-opus-5-5', messages: []})});
    assert.equal(res.status, 503);
    assert.match(await res.text(), /没配好/);
    assert.equal(seen.length, 0, 'no upstream call, so the key cannot go to the wrong provider');
  } finally { await relay.stop(); }
});

test('scrub: secrets are replaced before the 600-character cut; short secrets are left alone', () => {
  const relay = new PinkieRelay({config: () => CONFIG, token: 'short'});
  const long = 'x'.repeat(100) + KEY + 'y'.repeat(500);
  const cleaned = relay.scrub(long);
  assert.equal(cleaned.includes(KEY), false);
  assert.ok(cleaned.length <= 600, `cut to 600, got ${cleaned.length}`);
  assert.match(cleaned, /…/, 'the key is replaced by an ellipsis, not just cut off');
  assert.equal(relay.scrub('oops short'), 'oops short', 'a secret shorter than 8 characters is not scrubbed');
  assert.deepEqual(relay.currentKeys(), [KEY], 'a whitespace-only key is not a secret to scrub');
});

test('fail: Anthropic and OpenAI error shapes, and a response whose headers already went out', () => {
  const relay = new PinkieRelay({config: () => CONFIG});
  const capture = () => { const out = {}; return {res: {headersSent: false, writeHead(status, headers) { out.status = status; out.headers = headers; }, end(body) { out.body = body; }}, out}; };
  const a = capture();
  relay.fail(a.res, 400, 'invalid_request_error', 'msg');
  assert.equal(a.out.status, 400);
  assert.deepEqual(JSON.parse(a.out.body), {type: 'error', error: {type: 'invalid_request_error', message: 'msg'}});
  const b = capture();
  relay.fail(b.res, 400, 'invalid_request_error', 'msg', {openai: true});
  assert.deepEqual(JSON.parse(b.out.body), {error: {type: 'invalid_request_error', message: 'msg', code: 'invalid_request_error'}});
  let ended = 0;
  const sent = {headersSent: true, writeHead() { throw new Error('must not write headers twice'); }, end() { ended++; }};
  relay.fail(sent, 500, 'api_error', 'msg');
  assert.equal(ended, 1, 'headers already sent: just end, do not throw');
});

async function relayWith(respond, config = CONFIG) {
  const seen = [];
  const relay = new PinkieRelay({config: () => config, fetchImpl: async (url, init) => { seen.push({url, init}); return respond(url, init); }});
  await relay.start();
  return {relay, seen};
}

test('the relay refuses /v1/models without a pass, and /v1/messages/count_tokens goes through like /v1/messages', async () => {
  const {relay, seen} = await relayWith(() => new Response('{}', {status: 200, headers: {'content-type': 'application/json'}}));
  try {
    assert.equal((await fetch(relay.baseUrl + '/v1/models')).status, 401);
    const list = await fetch(relay.baseUrl + '/v1/models', {headers: {'x-api-key': relay.token}});
    assert.equal(list.status, 200);
    assert.equal((await list.json()).data[0].id, 'gw/claude-opus-5-5');
    const counted = await fetch(relay.baseUrl + '/v1/messages/count_tokens', {method: 'POST',
      headers: {'x-api-key': relay.token, 'content-type': 'application/json'},
      body: JSON.stringify({model: 'gw/claude-opus-4-7', messages: []})});
    assert.equal(counted.status, 200);
    assert.equal(seen.at(-1).url, 'http://127.0.0.1:1466/v1/messages/count_tokens');
  } finally { await relay.stop(); }
});

const MAX_BODY = 32 * 1024 * 1024;
function sizedBody(bytes) {
  const base = JSON.stringify({model: 'gw/claude-opus-4-7', messages: [{role: 'user', content: ''}]});
  return JSON.stringify({model: 'gw/claude-opus-4-7', messages: [{role: 'user', content: 'x'.repeat(bytes - base.length)}]});
}

test('a body of exactly 32MB passes; one byte more is 413, in both error shapes', async () => {
  const exact = sizedBody(MAX_BODY);
  assert.equal(Buffer.byteLength(exact), MAX_BODY);
  const over = sizedBody(MAX_BODY + 1);
  assert.equal(Buffer.byteLength(over), MAX_BODY + 1);
  const {relay} = await relayWith(() => new Response('ok', {status: 200}));
  try {
    const ok = await fetch(relay.baseUrl + '/v1/messages', {method: 'POST',
      headers: {'x-api-key': relay.token, 'content-type': 'application/json'}, body: exact});
    assert.equal(ok.status, 200, 'exactly at the limit is allowed');
    const tooBig = await fetch(relay.baseUrl + '/v1/messages', {method: 'POST',
      headers: {'x-api-key': relay.token, 'content-type': 'application/json'}, body: over});
    assert.equal(tooBig.status, 413);
    assert.deepEqual(JSON.parse(await tooBig.text()), {type: 'error', error: {type: 'request_too_large', message: '请求太大'}});
    const tooBigOpenai = await fetch(relay.baseUrl + '/v1/responses', {method: 'POST',
      headers: {'x-api-key': relay.token, 'content-type': 'application/json'}, body: over});
    assert.equal(tooBigOpenai.status, 413);
    assert.deepEqual(JSON.parse(await tooBigOpenai.text()), {error: {type: 'request_too_large', message: '请求太大', code: 'request_too_large'}});
  } finally { await relay.stop(); }
});

test('with no usable model, each of the three routes answers 503 with its own wording', async () => {
  const {relay, seen} = await relayWith(() => new Response('ok', {status: 200}), {models: {providers: {}}});
  try {
    for (const [path, word] of [['/v1/messages', 'Claude Code'], ['/v1/responses', 'Codex'], ['/v1/chat/completions', 'OpenCode']]) {
      const res = await fetch(relay.baseUrl + path, {method: 'POST',
        headers: {'x-api-key': relay.token, 'content-type': 'application/json'},
        body: JSON.stringify({model: 'x', messages: []})});
      assert.equal(res.status, 503, path);
      assert.match(await res.text(), new RegExp(`没有能给 ${word} 用的模型`), path);
    }
    assert.equal(seen.length, 0, 'nothing is forwarded when there is no route');
  } finally { await relay.stop(); }
});

function postRaw(port, pathName, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path: pathName, method: 'POST', headers}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, text: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('headers: the client pass never reaches the upstream; content-type and anthropic-version get defaults', async () => {
  const {relay, seen} = await relayWith(() => new Response('ok', {status: 200, headers: {'content-type': 'application/json'}}));
  try {
    // Buffer 正文 + 不带 content-type：Node 不会自动补，转发口要补 application/json。
    const res = await postRaw(relay.port, '/v1/messages',
      {'x-api-key': relay.token, authorization: 'Bearer client-token-xxx'},
      Buffer.from(JSON.stringify({model: 'gw/claude-opus-4-7', messages: []})));
    assert.equal(res.status, 200);
    const headers = seen[0].init.headers;
    assert.equal(headers.authorization, `Bearer ${KEY}`, 'the upstream gets the real key, not the client pass');
    assert.equal(headers['x-api-key'], KEY);
    assert.equal(headers['content-type'], 'application/json', 'no content-type from the client: defaulted');
    assert.equal(headers['anthropic-version'], '2023-06-01', 'no anthropic-version from the client: defaulted');
  } finally { await relay.stop(); }
});

test('an upstream error with an empty or unreadable body falls back to a short message; a long one is cut', async () => {
  const fakeUpstream = (status, text, throws = false) => ({ok: false, status,
    headers: {get: () => 'application/json'},
    text: async () => { if (throws) throw new Error('boom'); return text; }});
  const {relay} = await relayWith(() => fakeUpstream(500, ''));
  try {
    const empty = await fetch(relay.baseUrl + '/v1/messages', {method: 'POST',
      headers: {'x-api-key': relay.token, 'content-type': 'application/json'},
      body: JSON.stringify({model: 'gw/claude-opus-4-7', messages: []})});
    assert.equal(empty.status, 500);
    assert.deepEqual(JSON.parse(await empty.text()), {type: 'error', error: {type: 'api_error', message: '上游 500'}});
  } finally { await relay.stop(); }
  const unreadable = await relayWith(() => fakeUpstream(502, 'whatever', true));
  try {
    const res = await fetch(unreadable.relay.baseUrl + '/v1/messages', {method: 'POST',
      headers: {'x-api-key': unreadable.relay.token, 'content-type': 'application/json'},
      body: JSON.stringify({model: 'gw/claude-opus-4-7', messages: []})});
    assert.equal(res.status, 502);
    assert.deepEqual(JSON.parse(await res.text()), {type: 'error', error: {type: 'api_error', message: '上游 502'}});
  } finally { await unreadable.relay.stop(); }
  const long = await relayWith(() => fakeUpstream(500, KEY + 'e'.repeat(1000)));
  try {
    const res = await fetch(long.relay.baseUrl + '/v1/messages', {method: 'POST',
      headers: {'x-api-key': long.relay.token, 'content-type': 'application/json'},
      body: JSON.stringify({model: 'gw/claude-opus-4-7', messages: []})});
    const text = await res.text();
    assert.ok(text.length <= 600, `long upstream errors are cut to 600, got ${text.length}`);
    assert.equal(text.includes(KEY), false, 'the key is cleaned even in a long error');
  } finally { await long.relay.stop(); }
});

test('start/stop are idempotent, and toJSON only shows the running state', async () => {
  const relay = new PinkieRelay({config: () => CONFIG});
  assert.deepEqual(relay.toJSON(), {running: false, port: 0, defaultModel: '', codexModel: '', chatModel: ''});
  await relay.start();
  const port = relay.port;
  assert.ok(port > 0);
  await relay.start();
  assert.equal(relay.port, port, 'starting twice keeps the same port');
  assert.equal(relay.toJSON().running, true);
  await relay.stop();
  await relay.stop();
  assert.deepEqual(relay.toJSON(), {running: false, port: 0, defaultModel: '', codexModel: '', chatModel: ''});
  await relay.start();
  assert.ok(relay.port > 0 && relay.toJSON().running, 'it starts again after stopping');
  await relay.stop();
});

test('writePinkieSettings: 0600, no temp file left, old model slots cleared, a broken file is still writable', () => {
  const dir = path.join(tmp(), PINKIE_FOLDER);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'settings.json'), 'not json{{{');
  writePinkieSettings(dir, {baseUrl: 'http://127.0.0.1:5063', token: PASS, model: 'gw/claude-opus-5-5'});
  const file = path.join(dir, 'settings.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).env.ANTHROPIC_MODEL, 'gw/claude-opus-5-5', 'a broken file does not stop the write');
  // Windows 没有 POSIX 权限位（stat().mode 只反映只读属性），这一行只在 Linux/macOS 上查。
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'settings hold a session pass: 0600');
  assert.equal(fs.readdirSync(dir).includes('settings.json.tmp'), false, 'no temp file left behind');

  // 不给 model：旧的模型槽清掉，自己的变量留着。
  fs.writeFileSync(file, JSON.stringify({env: {ANTHROPIC_MODEL: 'old-model', ANTHROPIC_BASE_URL: 'https://old.example', MY_OWN: '1'}}));
  writePinkieSettings(dir, {baseUrl: 'http://127.0.0.1:5063', token: PASS});
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.env.ANTHROPIC_MODEL, undefined, 'an old model slot is cleared when no model is given');
  assert.equal(saved.env.MY_OWN, '1', 'the user\'s own variables stay');
  assert.equal(saved.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:5063');
});

test('linkPinkieHistory: a broken link and a non-ENOENT error are not quietly fixed', () => {
  const home = tmp();
  const shared = path.join(home, '.claude', 'projects');
  fs.mkdirSync(shared, {recursive: true});
  const dir = path.join(home, PINKIE_FOLDER);
  fs.mkdirSync(dir);
  fs.symlinkSync(path.join(home, 'no-such-target'), path.join(dir, 'projects'), 'junction');
  assert.equal(linkPinkieHistory(dir, {shared}).state, 'conflict', 'a broken link is a conflict, not something to replace');
  assert.equal(fs.lstatSync(path.join(dir, 'projects')).isSymbolicLink(), true, 'the broken link is left as it was');

  // 同一个地方、另一种写法（末尾多个斜杠）：算接上了。
  const dir2 = path.join(home, 'other-pinkie');
  fs.mkdirSync(dir2);
  fs.symlinkSync(shared + '/', path.join(dir2, 'projects'), 'junction');
  assert.equal(linkPinkieHistory(dir2, {shared}).state, 'ok');

  // lstat 不是“文件不存在”而是别的错：抛出来，不吞掉。
  const throwingFs = {...fs, lstatSync: () => { const error = new Error('denied'); error.code = 'EACCES'; throw error; }};
  assert.throws(() => linkPinkieHistory(dir, {shared, fsImpl: throwingFs}), /denied/);
});

test('codex and opencode instances: shape, launch args, and the token length boundary', () => {
  const models = [{slug: 'gw/claude-opus-5-5', name: 'Opus 5.5'}];
  const codex = codexPinkieInstance('/tmp/pinkie-codex', models, {baseUrl: 'http://127.0.0.1:5063', token: PASS});
  assert.equal(codex.driver, 'codex');
  assert.equal(codex.displayName, 'Codex · 碧琪模型');
  assert.equal(codex.config.shadowHomePath, '/tmp/pinkie-codex');
  assert.match(codex.config.launchArgs, /model_provider=\\"pinkie\\"/, 'the provider id is shell-quoted, so the inner quotes are escaped');
  assert.match(codex.config.launchArgs, /xhigh/);
  assert.deepEqual(codex.config.customModels, models);
  const open = openCodePinkieInstance(models, {baseUrl: 'http://127.0.0.1:5063', token: PASS});
  assert.equal(open.driver, 'opencode');
  const env = open.environment[0];
  assert.equal(env.name, 'OPENCODE_CONFIG_CONTENT');
  assert.equal(env.sensitive, true, 'the config content holds a session pass');
  const parsed = JSON.parse(env.value);
  assert.equal(parsed.provider.pinkie.options.baseURL, 'http://127.0.0.1:5063/v1');
  assert.equal(parsed.provider.pinkie.options.apiKey, PASS);
  assert.deepEqual(open.config.customModels, [{slug: 'pinkie/gw/claude-opus-5-5', name: 'Opus 5.5'}]);

  // 令牌 16 位刚好能过，15 位不行。
  assert.doesNotThrow(() => codexLaunchArgs({baseUrl: 'http://127.0.0.1:5063', token: 'a'.repeat(16)}));
  assert.throws(() => codexLaunchArgs({baseUrl: 'http://127.0.0.1:5063', token: 'a'.repeat(15)}), /令牌不对/);
  assert.doesNotThrow(() => openCodeConfigContent({baseUrl: 'http://127.0.0.1:5063', token: 'a'.repeat(16), models}));
  assert.throws(() => openCodeConfigContent({baseUrl: 'http://127.0.0.1:5063', token: 'a'.repeat(15), models}), /令牌不对/);
  // 地址多个斜杠、https 都不对。
  assert.throws(() => codexLaunchArgs({baseUrl: 'http://127.0.0.1:5063/', token: PASS}), /地址不对/);
  assert.throws(() => openCodeConfigContent({baseUrl: 'https://127.0.0.1:5063', token: PASS, models}), /地址不对/);
});
