import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {downloadVerified} from '../tools/pinkie-toolbox/toolbox-download.mjs';

test('a bad hash is discarded and the next mirror supplies the verified file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '工具箱 下载-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const server = http.createServer((req, res) => res.end(req.url === '/bad' ? 'wrong' : 'verified'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const integrity = 'sha256-' + crypto.createHash('sha256').update('verified').digest('base64');
  const target = path.join(dir, '下载', 'test.bin');
  const result = await downloadVerified({urls: [`${base}/bad`, `${base}/good`], target, integrity, maxBytes: 1000, allowLoopback: true});
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'verified');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['test.bin']);
});

test('an oversized or unverified file is never installed', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '工具箱 校验-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const server = http.createServer((req, res) => res.end('not-the-expected-content'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const target = path.join(dir, 'result');
  const integrity = 'sha256-' + crypto.createHash('sha256').update('expected').digest('base64');
  const result = await downloadVerified({urls: [`http://127.0.0.1:${server.address().port}/`], target, integrity, maxBytes: 5, allowLoopback: true});
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a stalled source times out and falls back', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '工具箱 超时-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const server = http.createServer((req, res) => { if (req.url === '/slow') return; res.end('ok'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.closeAllConnections());
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const integrity = 'sha256-' + crypto.createHash('sha256').update('ok').digest('base64');
  const result = await downloadVerified({urls: [`${base}/slow`, `${base}/good`], target: path.join(dir, 'ok'), integrity, maxBytes: 10, idleMs: 100, allowLoopback: true});
  assert.equal(result.ok, true);
});

test('a dropped connection resumes from the partial file with Range and still verifies the whole file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '工具箱 续传-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const body = crypto.randomBytes(200_000);
  const ranges = [];
  let first = true;
  const server = http.createServer((req, res) => {
    ranges.push(req.headers.range || '');
    if (first) {
      first = false;
      res.writeHead(200, {'Content-Length': body.length});
      res.write(body.subarray(0, 80_000), () => req.socket.destroy());
      return;
    }
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0);
    res.writeHead(start ? 206 : 200, {'Content-Length': body.length - start});
    res.end(body.subarray(start));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const integrity = 'sha256-' + crypto.createHash('sha256').update(body).digest('base64');
  const target = path.join(dir, 'office.dmg');
  const result = await downloadVerified({urls: [`http://127.0.0.1:${server.address().port}/f`], target, integrity, maxBytes: 300_000, allowLoopback: true});
  assert.equal(result.ok, true, result.note);
  assert.equal(result.resumed, true);
  assert.equal(ranges[0], '');
  assert.match(ranges[1], /^bytes=\d+-$/);
  assert.ok(Number(/\d+/.exec(ranges[1])[0]) > 0);
  assert.ok(fs.readFileSync(target).equals(body));
  assert.equal(fs.existsSync(`${target}.part`), false);
});
