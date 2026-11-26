// B5: engines-dispatch and engines-upstream answer 413 to an oversized body without killing the connection.
// main: dispatch called req.destroy() past MAX_BODY (no reply at all), upstream returned out of `for await`
// (the stream is destroyed, the socket reset). The client here sends everything first and reads afterwards, like
// urllib: its socket stays paused until the server has had time to answer and close, so a queued RST always
// throws the reply away on Windows. Counter-example: with main's two files the 413 tests fail every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {EngineDispatch} from '../services/mode-architecture/engines-dispatch.mjs';
import {PinkieRelay} from '../services/mode-architecture/engines-upstream.mjs';
import {readBody, DRAIN_LIMIT} from '../services/mode-architecture/http-body.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Send the head and `size` body bytes with the socket paused, wait, then read everything. Returns {status, head, reset}.
function sendThenRead(port, {url, headers = {}, size, declared = size}) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.pause();
    let got = Buffer.alloc(0), reset = false, settled = false;
    const finish = () => {
      if (settled) return; settled = true; socket.destroy();
      const text = got.toString('latin1');
      resolve({status: Number((/^HTTP\/1\.[01] (\d{3})/.exec(text) || [])[1] || 0), head: text.split('\r\n\r\n')[0], reset});
    };
    socket.on('error', () => { reset = true; finish(); });
    socket.on('data', chunk => {
      got = Buffer.concat([got, chunk]);
      const text = got.toString('latin1'), end = text.indexOf('\r\n\r\n');
      const length = Number((/\r\ncontent-length: *(\d+)/i.exec(text.slice(0, end)) || [])[1] || 0);
      if (end >= 0 && got.length >= end + 4 + length) finish();
    });
    socket.on('end', finish);
    socket.on('connect', async () => {
      const head = [`POST ${url} HTTP/1.1`, 'Host: 127.0.0.1', 'Content-Type: application/json', `Content-Length: ${declared}`,
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', ''].join('\r\n');
      socket.write(head);
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      for (let sent = 0; sent < size && !settled;) {
        const piece = chunk.subarray(0, Math.min(chunk.length, size - sent));
        sent += piece.length;
        if (!socket.write(piece)) await new Promise(r => { socket.once('drain', r); socket.once('close', r); });
      }
      await sleep(300);
      if (!settled) socket.resume();
      setTimeout(finish, 5000).unref();
    });
  });
}

test('dispatch: a body over MAX_BODY gets a 413 instead of a reset', async t => {
  const dispatch = new EngineDispatch({bridge: {sessions: {all: () => ({}), get: () => null, byThread: () => null}}, lineage: {lineage: () => ({}), turns: new Map()}});
  const port = await dispatch.listen();
  t.after(() => dispatch.close());
  const res = await sendThenRead(port, {url: '/dispatch', size: 1 << 20});
  assert.equal(res.reset, false, 'connection reset before the reply');
  assert.equal(res.status, 413);
});

test('upstream: a body over 32 MiB gets a 413 instead of a reset', async t => {
  const relay = new PinkieRelay({config: () => ({})});
  await relay.start();
  t.after(() => relay.stop());
  const res = await sendThenRead(relay.port, {url: '/v1/messages', headers: {'x-api-key': relay.token}, size: (32 << 20) + (768 << 10)});
  assert.equal(res.reset, false, 'connection reset before the reply');
  assert.equal(res.status, 413);
});

test('upstream: a body claimed far past the limit gets 413 + Connection: close without being read', async t => {
  const relay = new PinkieRelay({config: () => ({})});
  await relay.start();
  t.after(() => relay.stop());
  const res = await sendThenRead(relay.port, {url: '/v1/messages', headers: {'x-api-key': relay.token}, size: 0, declared: (32 << 20) + DRAIN_LIMIT + 1});
  assert.equal(res.status, 413);
  assert.match(res.head, /\r\nconnection: close/i);
});

test('readBody: under the limit, over it within the drain allowance, past it', async t => {
  const results = [];
  const server = http.createServer(async (req, res) => { results.push(await readBody(req, {max: 1024, drain: 4096})); res.end('ok'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const post = body => fetch(`http://127.0.0.1:${server.address().port}/`, {method: 'POST', body}).then(r => r.text()).catch(() => '');
  await post('x'.repeat(1000));
  await post('x'.repeat(3000));
  await post('x'.repeat(10000));
  assert.equal(results[0].body.length, 1000);
  assert.deepEqual(results[1], {tooLarge: true, close: false});
  assert.deepEqual(results[2], {tooLarge: true, close: true});
});
