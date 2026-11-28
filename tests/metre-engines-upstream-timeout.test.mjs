// 引擎转发口打上游时等响应头限时（#96 L117）。
// 原来 PinkieRelay.handle 调 fetchImpl 不带 signal、不设任何超时：上游一直不回头，Claude Code / Codex / OpenCode 那边就一直挂着。
// 这里用很短的 headersTimeoutMs 和假上游测超时分支；反例：头按时到、正文流得比限时还久，照常转完，不被掐断。不打任何真上游。
import test from 'node:test';
import assert from 'node:assert/strict';
import {PinkieRelay, UPSTREAM_HEADERS_TIMEOUT_MS} from '../services/mode-architecture/engines-upstream.mjs';

const KEY = ['fake', 'upstream', 'key', 'timeout', '9f8e7d6c'].join('-');
const CONFIG = {models: {providers: {
  gw: {baseUrl: 'http://127.0.0.1:1466/v1', apiKey: KEY, models: [{id: 'claude-opus-5-5'}]},
}}};
const SHORT = 150;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function relayWith(fetchImpl, headersTimeoutMs = SHORT) {
  const relay = new PinkieRelay({config: () => CONFIG, fetchImpl, headersTimeoutMs});
  await relay.start();
  return relay;
}

const post = (relay, path, model = 'gw/claude-opus-5-5') => fetch(relay.baseUrl + path, {method: 'POST',
  headers: {'x-api-key': relay.token, 'content-type': 'application/json'},
  body: JSON.stringify({model, messages: [], input: []})});

test('the headers timeout is a named constant, and it is the default', () => {
  assert.equal(UPSTREAM_HEADERS_TIMEOUT_MS, 300_000);
  assert.equal(new PinkieRelay({config: () => CONFIG}).headersTimeoutMs, UPSTREAM_HEADERS_TIMEOUT_MS);
});

test('an upstream that never sends headers: 504 in Anthropic shape, and the upstream request is aborted', async () => {
  let signal;
  const relay = await relayWith((url, init) => { signal = init.signal; return new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), {once: true});
  }); });
  try {
    const started = Date.now();
    const res = await post(relay, '/v1/messages');
    assert.equal(res.status, 504);
    assert.deepEqual(await res.json(), {type: 'error', error: {type: 'timeout_error', message: '上游太久没回应，已断开'}});
    assert.ok(Date.now() - started < 5000, 'answered soon after the short timeout, not left hanging');
    assert.ok(signal, 'the upstream call gets a signal');
    assert.equal(signal.aborted, true, 'the stuck upstream request is cancelled, not left open');
  } finally { await relay.stop(); }
});

test('a fetchImpl that ignores the signal still cannot hang the relay; Codex and OpenCode routes get OpenAI shape', async () => {
  const relay = await relayWith(() => new Promise(() => {}));
  try {
    for (const path of ['/v1/responses', '/v1/chat/completions']) {
      const res = await post(relay, path);
      assert.equal(res.status, 504, path);
      assert.deepEqual(await res.json(), {error: {type: 'timeout_error', message: '上游太久没回应，已断开', code: 'timeout_error'}}, path);
    }
  } finally { await relay.stop(); }
});

test('counter-example: headers in time, then a body that streams for longer than the timeout is passed through whole', async () => {
  let signal;
  const relay = await relayWith((url, init) => {
    signal = init.signal;
    const encoder = new TextEncoder();
    const body = new ReadableStream({async start(controller) {
      for (const piece of ['event: a\n\n', 'event: b\n\n', 'event: c\n\n']) { controller.enqueue(encoder.encode(piece)); await wait(SHORT); }
      controller.close();
    }});
    return new Response(body, {status: 200, headers: {'content-type': 'text/event-stream'}});
  });
  try {
    const started = Date.now();
    const res = await post(relay, '/v1/messages');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'event: a\n\nevent: b\n\nevent: c\n\n', 'nothing is cut off');
    assert.ok(Date.now() - started >= SHORT * 2, 'the stream really ran past the headers timeout');
    assert.equal(signal.aborted, false, 'a slow body after headers is not aborted');
  } finally { await relay.stop(); }
});

test('counter-example: a quick upstream error is passed through as before, not turned into 504', async () => {
  const relay = await relayWith(() => new Response('{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}',
    {status: 429, headers: {'content-type': 'application/json', 'retry-after': '7'}}));
  try {
    const res = await post(relay, '/v1/messages');
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '7');
    await res.text();
    await wait(SHORT * 2); // 计时器撤掉了：过了限时也不会再写一次回复。
  } finally { await relay.stop(); }
});

test('counter-example: a fetchImpl that throws right away still answers 502 at once, not after the timeout', async () => {
  const relay = await relayWith(() => { throw new Error('connect refused'); }, 60_000);
  try {
    const started = Date.now();
    const res = await post(relay, '/v1/messages');
    assert.equal(res.status, 502);
    assert.match(await res.text(), /connect refused/);
    assert.ok(Date.now() - started < 5000, 'a sync throw is not held until the 60s timeout');
  } finally { await relay.stop(); }
});
