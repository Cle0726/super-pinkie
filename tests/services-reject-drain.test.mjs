// 回 4xx 之前要先把请求体读掉（同 services/roundtable #204，B5）。Node 不读请求体就回包时：客户端带 Connection: close、
// req.destroy()、或者在 for await (… of req) 里提前 return，关连接那一下内核都对没读的字节回 RST，Windows 上连回复都收不到。
// 判定：收到 EOF 后再写 1 字节。服务端正常 FIN 时写得进去（对方半关）；被 RST 时报 EPIPE / ECONNRESET。
// 反例：把 engines-upstream.mjs 的 drainThen 改成直接 reply()、或把三处改动撤掉，*_closes_cleanly 每条都红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {EngineDispatch} from '../services/mode-architecture/engines-dispatch.mjs';
import {PinkieRelay} from '../services/mode-architecture/engines-upstream.mjs';
import {AppBrowserServers, createAppBrowserTool} from '../services/mode-architecture/app-browser.mjs';

// 比内核和 Node 顺手读进来的缓冲大得多，又不超过 DRAIN_LIMIT（1 MiB）。
const BODY = Buffer.alloc(256 * 1024, 120);

// Node 先 writeHead 再 end 时走 Transfer-Encoding: chunked，正文要先拆块。
function unchunk(text) {
  let out = '', rest = text;
  while (rest) {
    const at = rest.indexOf('\r\n');
    const size = parseInt(rest.slice(0, at), 16);
    if (!(size > 0)) break;
    out += rest.slice(at + 2, at + 2 + size);
    rest = rest.slice(at + 2 + size + 2);
  }
  return out;
}

// 发完整个请求（带 Connection: close），返回 {status, head, body, verdict}；verdict 是 'clean' 或 'reset:<code>'。
function exchange(port, {method = 'POST', url, headers = {}, body = BODY}) {
  return new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port, allowHalfOpen: true});
    let got = Buffer.alloc(0), done = false;
    const finish = verdict => {
      if (done) return; done = true; socket.destroy();
      const text = got.toString('latin1');
      const cut = text.indexOf('\r\n\r\n');
      const head = cut < 0 ? text : text.slice(0, cut), rest = cut < 0 ? '' : text.slice(cut + 4);
      const raw = /\r\ntransfer-encoding: chunked/i.test(head) ? unchunk(rest) : rest;
      resolve({status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] || 0), head: head.toLowerCase(),
        body: Buffer.from(raw, 'latin1').toString('utf8'), verdict});
    };
    socket.on('data', chunk => { got = Buffer.concat([got, chunk]); });
    socket.on('error', error => finish('reset:' + error.code));
    socket.on('end', () => setTimeout(() => socket.write('x', error => finish(error ? 'reset:' + error.code : 'clean')), 50));
    socket.setTimeout(8000, () => finish('timeout'));
    const lines = [`${method} ${url} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Connection: close', `Content-Length: ${body.length}`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    socket.write(body);
  });
}

// 只发请求头、声称一个超大的请求体：读到回复头为止。没修好时服务端会一直等请求体，这里 3 秒超时。
function headOnly(port, {url, headers = {}, length}) {
  return new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port});
    let got = '';
    const finish = head => { socket.destroy(); resolve(head.toLowerCase()); };
    socket.on('data', chunk => { got += chunk.toString('latin1'); if (got.includes('\r\n\r\n')) finish(got.split('\r\n\r\n')[0]); });
    socket.on('error', () => finish(got));
    socket.on('end', () => finish(got));
    socket.setTimeout(3000, () => finish('timeout'));
    socket.write([`POST ${url} HTTP/1.1`, `Host: 127.0.0.1:${port}`, `Content-Length: ${length}`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join('\r\n') + '\r\n\r\n');
  });
}

async function dispatchPort(t) {
  const dispatch = new EngineDispatch({bridge: {sessions: {all: () => ({})}}, lineage: {lineage: () => ({})}, isEnabled: () => true});
  t.after(() => dispatch.close());
  return dispatch.listen();
}

async function relayOf(t) {
  const relay = new PinkieRelay({config: () => ({}), fetchImpl: async () => { throw new Error('测试里不该走到上游'); }});
  await relay.start();
  t.after(() => relay.stop());
  return relay;
}

test('engines-dispatch: wrong path 404 closes cleanly', async t => {
  const port = await dispatchPort(t);
  const reply = await exchange(port, {url: '/nope', headers: {'Content-Type': 'application/json'}});
  assert.equal(reply.status, 404);
  assert.equal(reply.verdict, 'clean');
});

test('engines-dispatch: body over 64 KiB gets a 413 instead of a bare reset', async t => {
  const port = await dispatchPort(t);
  const reply = await exchange(port, {url: '/dispatch', headers: {'Content-Type': 'application/json', Authorization: 'Bearer x'}});
  assert.equal(reply.status, 413, '修复前 req.destroy()：一个字节的回复都没有');
  assert.equal(reply.verdict, 'clean');
  assert.equal(JSON.parse(reply.body).ok, false);
});

test('engines-dispatch: an accepted body still reaches the token check (401)', async t => {
  const port = await dispatchPort(t);
  const reply = await exchange(port, {url: '/dispatch', headers: {'Content-Type': 'application/json'}, body: Buffer.from('{"action":"list"}')});
  assert.equal(reply.status, 401);
  assert.equal(reply.verdict, 'clean');
  assert.match(JSON.parse(reply.body).error, /令牌/);
});

test('engines-upstream relay: wrong token 401 closes cleanly', async t => {
  const relay = await relayOf(t);
  const reply = await exchange(relay.port, {url: '/v1/messages', headers: {'Content-Type': 'application/json', 'x-api-key': 'wrong'}});
  assert.equal(reply.status, 401);
  assert.equal(reply.verdict, 'clean');
  assert.equal(JSON.parse(reply.body).error.type, 'authentication_error');
});

test('engines-upstream relay: unknown path 404 closes cleanly', async t => {
  const relay = await relayOf(t);
  const reply = await exchange(relay.port, {url: '/v1/other', headers: {'Content-Type': 'application/json', 'x-api-key': relay.token}});
  assert.equal(reply.status, 404);
  assert.equal(reply.verdict, 'clean');
});

test('engines-upstream relay: declared body over 32 MiB gets 413 with Connection: close at once', async t => {
  const relay = await relayOf(t);
  const head = await headOnly(relay.port, {url: '/v1/messages', headers: {'Content-Type': 'application/json', 'x-api-key': relay.token}, length: 33 * 1024 * 1024});
  assert.match(head, /^http\/1\.1 413 /, '修复前服务端一直等请求体（for await），最后在循环里 return 时回 RST');
  assert.match(head, /\r\nconnection: close/);
});

test('engines-upstream relay: a non-JSON body that was read still gets its 400', async t => {
  const relay = await relayOf(t);
  const reply = await exchange(relay.port, {url: '/v1/messages', headers: {'Content-Type': 'application/json', 'x-api-key': relay.token}});
  assert.equal(reply.status, 400);
  assert.equal(reply.verdict, 'clean');
});

test('app-browser static preview: POST 405 closes cleanly, GET still serves', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-drain-static-'));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const servers = new AppBrowserServers({environment: {}, homeDirectory: home, memoryFile: path.join(home, 'memory.json'),
    systemBrowser: true, systemOpener: async () => {}});
  t.after(() => servers.dispose?.());
  const tool = createAppBrowserTool({sessionKey: 'agent:main:main', sessionId: 's1'}, {servers});
  const run = async params => (await tool.execute('call', params)).details;
  fs.writeFileSync(path.join(home, 'index.html'), '<h1>ok</h1>');
  const started = await run({action: 'serve', dir: home});
  assert.equal(started.ok, true, started.reason);
  t.after(() => run({action: 'stop_serve', port: started.port}));
  const reply = await exchange(started.port, {url: '/', headers: {'Content-Type': 'application/octet-stream'}});
  assert.equal(reply.status, 405);
  assert.equal(reply.verdict, 'clean');
  assert.equal(await fetch(`http://127.0.0.1:${started.port}/`).then(r => r.text()), '<h1>ok</h1>');
});

// #263 后续：请求体超过 DRAIN_LIMIT（1 MiB）时，之前是直接回、直接关，没读的字节让客户端只收到 RST。
// 现在先回（Connection: close），接着读掉丢弃，读完才关。exchange 发完整个请求体、等服务端关完才判定，不靠竞速。
// 反例：换回 main 上 b50ea5ff 的 drainThen，下面三条 upstream 都是 reset:ECONNRESET、status 0。
const BIG = Buffer.alloc(4 * 1024 * 1024, 120);

test('engines-upstream relay: wrong token 401 with a 4 MiB body still arrives in full', async t => {
  const relay = await relayOf(t);
  const reply = await exchange(relay.port, {url: '/v1/messages', headers: {'Content-Type': 'application/json', 'x-api-key': 'wrong'}, body: BIG});
  assert.equal(reply.verdict, 'clean');
  assert.equal(reply.status, 401);
  assert.match(reply.head, /\r\nconnection: close/);
  assert.equal(JSON.parse(reply.body).error.type, 'authentication_error');
});

test('engines-upstream relay: unknown path 404 with a 4 MiB body still arrives in full', async t => {
  const relay = await relayOf(t);
  const reply = await exchange(relay.port, {url: '/v1/other', headers: {'Content-Type': 'application/json', 'x-api-key': relay.token}, body: BIG});
  assert.equal(reply.verdict, 'clean');
  assert.equal(reply.status, 404);
  assert.equal(JSON.parse(reply.body).error.type, 'not_found_error');
});

test('engines-upstream relay: a real body just over 32 MiB gets its 413 body, not a reset', async t => {
  const relay = await relayOf(t);
  const body = Buffer.alloc(32 * 1024 * 1024 + 512 * 1024, 120);
  const reply = await exchange(relay.port, {url: '/v1/messages', headers: {'Content-Type': 'application/json', 'x-api-key': relay.token}, body});
  assert.equal(reply.verdict, 'clean');
  assert.equal(reply.status, 413);
  assert.equal(JSON.parse(reply.body).error.type, 'request_too_large');
});

test('engines-upstream relay: a 256 KiB body is still drained first and the connection is not closed', async t => {
  // 1 MiB 以内行为不变：先读完再回，不加 Connection: close（请求本身不带 Connection: close）。
  const relay = await relayOf(t);
  const head = await new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port: relay.port});
    let got = '';
    const timer = setTimeout(() => { socket.destroy(); resolve(got); }, 3000);
    socket.on('data', chunk => { got += chunk.toString('latin1'); if (got.includes('\r\n\r\n')) { clearTimeout(timer); socket.destroy(); resolve(got); } });
    socket.on('error', () => { clearTimeout(timer); resolve(got); });
    socket.write(['POST /v1/messages HTTP/1.1', `Host: 127.0.0.1:${relay.port}`, 'x-api-key: wrong', `Content-Length: ${BODY.length}`, '', ''].join('\r\n'));
    socket.write(BODY);
  });
  assert.match(head, /^HTTP\/1\.1 401 /);
  assert.doesNotMatch(head.toLowerCase(), /\r\nconnection: close/);
});
