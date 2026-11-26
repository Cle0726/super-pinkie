import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  adaptFeishuClientSource, adaptFeishuMonitorSource, applyFeishuLiveness,
  FEISHU_LIVENESS_BASELINES, FEISHU_PING_TIMEOUT_SEC, FEISHU_HANDSHAKE_TIMEOUT_MS,
} from '../services/messaging-connect/apply-feishu-liveness.mjs';

const SELF = fileURLToPath(import.meta.url);
const CLIENT = 'dist/client-B7EAV_Ss.js';
const MONITOR = 'dist/monitor.account-Dr7do33p.js';

const CLIENT_FRAGMENT = [
  'const FEISHU_WS_CONFIG = {',
  '\tPingInterval: 30,',
  '\tPingTimeout: 3',
  '};',
  'async function createFeishuWSClient(account, callbacks = {}) {',
  '\tconst { accountId, appId, appSecret, domain } = account;',
  '\tconst agent = await getWsProxyAgent();',
  '\treturn new feishuClientSdk.WSClient({',
  '\t\tappId,',
  '\t\tappSecret,',
  '\t\tdomain: resolveDomain(domain),',
  '\t\t...callbacks,',
  '\t\tloggerLevel: feishuClientSdk.LoggerLevel.info,',
  '\t\twsConfig: FEISHU_WS_CONFIG,',
  '\t\t...agent ? { agent } : {}',
  '\t});',
  '}',
  ''
].join('\n');

const MONITOR_FRAGMENT = [
  '\t\t\tconst publishWsConnected = () => {',
  '\t\t\t\tconst connectedAt = Date.now();',
  '\t\t\t\tstatusSink?.({',
  '\t\t\t\t\tconnected: true,',
  '\t\t\t\t\tlastConnectedAt: connectedAt,',
  '\t\t\t\t\tlastEventAt: connectedAt,',
  '\t\t\t\t\tlastError: null',
  '\t\t\t\t});',
  '\t\t\t};',
  '\t\t\twsClient = await createFeishuWSClient(account, {',
  '\t\t\t\tonError: handleWsError,',
  '\t\t\t\tonReady: publishWsConnected,',
  '\t\t\t\tonReconnected: publishWsConnected,',
  '\t\t\t\tonReconnecting: publishWsReconnecting',
  '\t\t\t});',
  ''
].join('\n');

function loadFactory(source) {
  const sdk = {
    LoggerLevel: {info: 'info'},
    WSClient: class { constructor(params) { this.params = params; this.wsConfig = {setWSInstance: ws => { this.ws = ws; }}; } },
  };
  const body = `const getWsProxyAgent = async () => undefined; const resolveDomain = d => d;\n${source}\nreturn {createFeishuWSClient, FEISHU_WS_CONFIG};`;
  return new Function('feishuClientSdk', body)(sdk);
}

test('client patch arms the SDK pong watchdog and handshake timeout, keeping upstream keys', async () => {
  const patched = adaptFeishuClientSource(CLIENT_FRAGMENT);
  const {createFeishuWSClient, FEISHU_WS_CONFIG} = loadFactory(patched);
  assert.equal(FEISHU_WS_CONFIG.pingTimeout, FEISHU_PING_TIMEOUT_SEC);
  assert.equal(FEISHU_WS_CONFIG.PingTimeout, 3);
  const client = await createFeishuWSClient({appId: 'a', appSecret: 'b'}, {onReady() {}});
  assert.equal(client.params.handshakeTimeoutMs, FEISHU_HANDSHAKE_TIMEOUT_MS);
  assert.equal(typeof client.params.onReady, 'function');

  const upstream = loadFactory(CLIENT_FRAGMENT);
  assert.equal(upstream.FEISHU_WS_CONFIG.pingTimeout, undefined, 'upstream never arms the SDK watchdog');
  assert.equal((await upstream.createFeishuWSClient({appId: 'a', appSecret: 'b'})).params.handshakeTimeoutMs, undefined);
});

test('client patch reports every inbound frame of every socket as transport activity', async () => {
  const {createFeishuWSClient} = loadFactory(adaptFeishuClientSource(CLIENT_FRAGMENT));
  let activity = 0;
  const client = await createFeishuWSClient({appId: 'a', appSecret: 'b'}, {onTransportActivity: () => { activity++; }});
  assert.equal('onTransportActivity' in client.params, false, 'SDK must not receive the Pinkie-only callback');
  const first = new EventEmitter(), second = new EventEmitter();
  client.wsConfig.setWSInstance(first);
  assert.equal(client.ws, first);
  assert.equal(activity, 1, 'a fresh socket counts as activity');
  first.emit('message', Buffer.alloc(0));
  first.emit('message', Buffer.alloc(0));
  assert.equal(activity, 3);
  client.wsConfig.setWSInstance(null);
  client.wsConfig.setWSInstance(second);
  second.emit('message', Buffer.alloc(0));
  assert.equal(activity, 5);

  const quiet = await createFeishuWSClient({appId: 'a', appSecret: 'b'}, {onTransportActivity: () => { throw new Error('sink failed'); }});
  const socket = new EventEmitter();
  quiet.wsConfig.setWSInstance(socket);
  assert.doesNotThrow(() => socket.emit('message', Buffer.alloc(0)), 'a failing sink must not break the SDK frame loop');
});

test('monitor patch publishes lastTransportActivityAt so the gateway can flag stale sockets', () => {
  const patched = adaptFeishuMonitorSource(MONITOR_FRAGMENT);
  assert.match(patched, /lastEventAt: connectedAt,\n\t+lastTransportActivityAt: connectedAt,\n\t+lastError: null/);
  assert.match(patched, /onReconnecting: publishWsReconnecting,\n[^\n]*\n\t+onTransportActivity: \(\) => statusSink\?\.\(\{ lastTransportActivityAt: Date\.now\(\) \}\)\n\t+\}\);/);
  assert.doesNotMatch(MONITOR_FRAGMENT, /lastTransportActivityAt/, 'upstream WS mode never reports transport activity');
});

test('unknown or duplicated publisher structure is rejected', () => {
  assert.throws(() => adaptFeishuClientSource(CLIENT_FRAGMENT.replace('PingTimeout: 3', 'PingTimeout: 5')), /Unknown Feishu WS config structure/);
  assert.throws(() => adaptFeishuClientSource(CLIENT_FRAGMENT + CLIENT_FRAGMENT), /Unknown Feishu/);
  assert.throws(() => adaptFeishuMonitorSource(MONITOR_FRAGMENT.replace('onReconnecting: publishWsReconnecting', 'onReconnecting: x')), /Unknown Feishu WS client callbacks structure/);
  assert.throws(() => adaptFeishuMonitorSource(MONITOR_FRAGMENT + MONITOR_FRAGMENT), /Unknown Feishu/);
});

function fakePackage(version = '2026.7.1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-liveness-'));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: '@openclaw/feishu', version}));
  fs.writeFileSync(path.join(root, CLIENT), CLIENT_FRAGMENT);
  fs.writeFileSync(path.join(root, MONITOR), MONITOR_FRAGMENT);
  return root;
}

function snapshot(root) {
  const files = {};
  for (const name of fs.readdirSync(path.join(root, 'dist'))) files[name] = fs.readFileSync(path.join(root, 'dist', name), 'utf8');
  return files;
}

test('publisher SHA mismatch writes nothing', t => {
  const root = fakePackage();
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const before = snapshot(root);
  assert.throws(() => applyFeishuLiveness(root), /Feishu publisher file changed: dist\/client-B7EAV_Ss\.js; nothing was written/);
  assert.deepEqual(snapshot(root), before, 'no backup, temporary or patched file may appear');
});

test('only the verified plugin version is accepted', t => {
  const root = fakePackage('2026.7.2');
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const before = snapshot(root);
  assert.throws(() => applyFeishuLiveness(root), /requires verified @openclaw\/feishu 2026\.7\.1/);
  assert.deepEqual(snapshot(root), before);
});

// ---- Integration layer: real SDK + plugin ws against a local fake Feishu server. ----

function varint(n) {
  const out = [];
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7; }
  out.push(n);
  return out;
}
const field = (no, wire, bytes) => [...varint((no << 3) | wire), ...bytes];
const lengthField = (no, bytes) => field(no, 2, [...varint(bytes.length), ...bytes]);
function encodeFrame({service, method, headers, payload}) {
  const out = [...field(1, 0, varint(0)), ...field(2, 0, varint(0)), ...field(3, 0, varint(service)), ...field(4, 0, varint(method))];
  for (const [key, value] of headers) out.push(...lengthField(5, [...lengthField(1, [...Buffer.from(key)]), ...lengthField(2, [...Buffer.from(value)])]));
  if (payload) out.push(...lengthField(8, [...Buffer.from(payload)]));
  return Buffer.from(out);
}

// PingInterval must exceed the watchdog: the SDK re-arms on every ping.
const CLIENT_CONFIG = {PingInterval: 12, ReconnectCount: -1, ReconnectInterval: 1, ReconnectNonce: 0};
const WINDOWS = {'half-dead': 14000, healthy: 14000, 'stuck-handshake': 18000};

async function runScenario(name, clientModule) {
  const {i: createFeishuWSClient} = await import(pathToFileURL(clientModule).href);
  const {WebSocketServer} = createRequire(clientModule)('ws');
  const counts = {ws: 0, closes: 0, tcp: 0, activity: 0};
  let lastActivity = 0;
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let stuck;
  if (name === 'stuck-handshake') {
    stuck = net.createServer(() => { counts.tcp++; });
    await listen(stuck);
  }
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const port = (stuck ?? server).address().port;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({code: 0, msg: 'ok', data: {URL: `ws://127.0.0.1:${port}/ws?device_id=d1&service_id=7`, ClientConfig: CLIENT_CONFIG}}));
    });
  });
  new WebSocketServer({server}).on('connection', socket => {
    counts.ws++;
    socket.on('close', () => { counts.closes++; });
    socket.on('message', () => {
      if (name !== 'healthy') return;
      socket.send(encodeFrame({service: 7, method: 0, headers: [['type', 'pong']], payload: JSON.stringify(CLIENT_CONFIG)}));
    });
  });
  await listen(server);
  const client = await createFeishuWSClient(
    {accountId: 'liveness-test', appId: 'cli_0123456789abcdef', appSecret: 'test-only', domain: `http://127.0.0.1:${server.address().port}`},
    {onError() {}, onTransportActivity: () => { counts.activity++; lastActivity = Date.now(); }});
  await client.start({eventDispatcher: {}});
  await new Promise(resolve => setTimeout(resolve, WINDOWS[name]));
  process.stdout.write(`\nRESULT:${JSON.stringify({...counts, activityAgeMs: lastActivity ? Date.now() - lastActivity : null})}\n`);
  process.exit(0);
}

const scenarioIndex = process.argv.indexOf('--feishu-scenario');
if (scenarioIndex !== -1) await runScenario(process.argv[scenarioIndex + 1], process.argv[scenarioIndex + 2]);

const PACKAGE_ROOT = process.env.FEISHU_LIVENESS_TEST_PACKAGE_ROOT;
const SKIP = !PACKAGE_ROOT && 'set FEISHU_LIVENESS_TEST_PACKAGE_ROOT to the installed @openclaw/feishu 2026.7.1';

function copyPackage(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `feishu-liveness-${label}-`));
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'package.json'), path.join(root, 'package.json'));
  fs.cpSync(path.join(PACKAGE_ROOT, 'dist'), path.join(root, 'dist'), {recursive: true});
  // Read-only dependency link: the patch only writes dist/ inside the temporary copy.
  fs.symlinkSync(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return root;
}

const childEnv = () => {
  const env = {...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost'};
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
  return env;
};

function scenario(name, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SELF, '--feishu-scenario', name, path.join(root, CLIENT)], {env: childEnv(), stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), WINDOWS[name] + 15000);
    child.on('exit', () => {
      clearTimeout(timer);
      const line = output.split('\n').reverse().find(entry => entry.startsWith('RESULT:'));
      if (!line) return reject(new Error(`${name} scenario produced no result:\n${output.slice(-2000)}`));
      resolve(JSON.parse(line.slice('RESULT:'.length)));
    });
  });
}

let prepared;
function prepare() {
  prepared ??= (() => {
    const upstream = copyPackage('upstream'), patched = copyPackage('patched');
    const first = applyFeishuLiveness(patched), second = applyFeishuLiveness(patched);
    const names = Object.keys(WINDOWS);
    const runs = Promise.all([...names.map(name => scenario(name, patched)), ...names.map(name => scenario(name, upstream))])
      .then(results => Object.fromEntries(names.flatMap((name, i) => [[`patched:${name}`, results[i]], [`upstream:${name}`, results[i + names.length]]])));
    return {upstream, patched, first, second, runs};
  })();
  return prepared;
}

test.after(() => {
  if (!prepared) return;
  for (const root of [prepared.upstream, prepared.patched]) fs.rmSync(root, {recursive: true, force: true});
});

test('installed plugin: patch matches pinned hashes, keeps original backups and is idempotent', {skip: SKIP}, () => {
  const {patched, first, second} = prepare();
  assert.deepEqual(first.map(item => item.changed), [true, true]);
  assert.deepEqual(second.map(item => item.changed), [false, false]);
  assert.deepEqual(second.map(item => item.sha256), first.map(item => item.sha256));
  for (const [relative, baseline] of Object.entries(FEISHU_LIVENESS_BASELINES)) {
    const backup = fs.readFileSync(path.join(patched, `${relative}.pinkie-original`));
    assert.equal(createHashHex(backup), baseline);
    assert.equal(fs.existsSync(path.join(patched, `${relative}.pinkie-tmp`)), false);
  }
});

function createHashHex(buffer) {
  return createRequire(import.meta.url)('node:crypto').createHash('sha256').update(buffer).digest('hex');
}

test('installed plugin: half-dead socket is terminated and reconnected only when patched', {skip: SKIP, timeout: 60000}, async () => {
  const results = await prepare().runs;
  const patched = results['patched:half-dead'], upstream = results['upstream:half-dead'];
  assert.ok(patched.closes >= 1 && patched.ws >= 2, `patched client must drop and reconnect: ${JSON.stringify(patched)}`);
  assert.deepEqual([upstream.ws, upstream.closes], [1, 0], `upstream reproduces the silent hang: ${JSON.stringify(upstream)}`);
});

test('installed plugin: stuck handshake times out and retries only when patched', {skip: SKIP, timeout: 60000}, async () => {
  const results = await prepare().runs;
  const patched = results['patched:stuck-handshake'], upstream = results['upstream:stuck-handshake'];
  assert.ok(patched.tcp >= 2, `patched client must retry after the handshake timeout: ${JSON.stringify(patched)}`);
  assert.equal(upstream.tcp, 1, `upstream stays stuck in isConnecting: ${JSON.stringify(upstream)}`);
});

test('installed plugin: answered pings keep the socket and fresh transport activity', {skip: SKIP, timeout: 60000}, async () => {
  const results = await prepare().runs;
  const patched = results['patched:healthy'], upstream = results['upstream:healthy'];
  assert.deepEqual([patched.ws, patched.closes], [1, 0], `healthy socket must not be terminated: ${JSON.stringify(patched)}`);
  assert.ok(patched.activity >= 3 && patched.activityAgeMs < 5000, `pongs must refresh transport activity: ${JSON.stringify(patched)}`);
  assert.deepEqual([upstream.ws, upstream.closes, upstream.activity], [1, 0, 0]);
});
