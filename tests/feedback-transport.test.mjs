// 反馈上报传输层（services/mode-architecture/feedback-transport.mjs）的纯逻辑单测。
// 全部用假 fetch，不联网、不碰真实令牌；只验证分支选择、请求拼装与错误归类。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTransportError,
  createFeedbackTransport,
  makeBatchFilePath,
} from '../services/mode-architecture/feedback-transport.mjs';

const FILE_RE = /^reports\/\d{4}-\d{2}-\d{2}\/\d{8}T\d{6}Z-[0-9a-f]{12}\.enc\.json$/;

// 记录每次调用的假 fetch；reply 可返回响应对象或抛错。
function fakeFetch(reply = () => ({ok: true, status: 201})) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({url, init});
    return reply(url, init);
  };
  fn.calls = calls;
  return fn;
}

test('makeBatchFilePath 按 UTC 日期分目录、去掉毫秒，并带 12 位随机后缀', () => {
  const date = new Date('2026-11-26T12:13:14.567Z');
  const file = makeBatchFilePath(date);
  assert.match(file, FILE_RE);
  assert.ok(file.startsWith('reports/2026-11-26/20261126T121314Z-'), file);
  // 同一时刻连续生成也不能重名（每次新建唯一文件，不覆盖已有文件）。
  const many = new Set(Array.from({length: 50}, () => makeBatchFilePath(date)));
  assert.equal(many.size, 50);
  // 默认参数取当前时间，格式一致。
  assert.match(makeBatchFilePath(), FILE_RE);
});

test('classifyTransportError 按 HTTP 状态码归类并标注能否重试', () => {
  const cases = [
    [401, 'auth', false],
    [403, 'auth', false],
    [404, 'not_found', false],
    [429, 'rate_limit', true],
    [409, 'conflict', true],
    [422, 'conflict', true],
    [500, 'server', true],
    [502, 'server', true],
    [503, 'server', true],
    [400, 'rejected', false],
    [302, 'rejected', false],
    [418, 'rejected', false],
  ];
  for (const [status, errorCode, retryable] of cases) {
    assert.deepEqual(classifyTransportError(status), {errorCode, retryable}, `status ${status}`);
  }
});

test('classifyTransportError 无状态码时区分超时与断网', () => {
  const timeout = {errorCode: 'timeout', retryable: true};
  const offline = {errorCode: 'offline', retryable: true};
  assert.deepEqual(classifyTransportError(0, Object.assign(new Error('t'), {name: 'TimeoutError'})), timeout);
  assert.deepEqual(classifyTransportError(0, Object.assign(new Error('a'), {name: 'AbortError'})), timeout);
  assert.deepEqual(classifyTransportError(0, {code: 'ETIMEDOUT'}), timeout);
  // fetch 把底层错误包在 cause 里，同样要识别。
  assert.deepEqual(classifyTransportError(0, new TypeError('fetch failed', {cause: {code: 'ETIMEDOUT'}})), timeout);
  assert.deepEqual(classifyTransportError(0, new TypeError('fetch failed', {cause: {code: 'ENOTFOUND'}})), offline);
  assert.deepEqual(classifyTransportError(0, new Error('ECONNREFUSED')), offline);
  // 没有任何错误信息、状态码非法时一律当作断网，不抛异常。
  assert.deepEqual(classifyTransportError(0), offline);
  assert.deepEqual(classifyTransportError(Number.NaN, null), offline);
  assert.deepEqual(classifyTransportError(-1, undefined), offline);
  assert.deepEqual(classifyTransportError(undefined, undefined), offline);
});

test('未配置时返回 none 传输，上传给出结构化 not_configured 而不抛异常', async () => {
  for (const config of [undefined, {}, {repo: 'owner/name'}, {token: 'secret'}, {repo: 'owner/name', token: '   '}]) {
    const fetchFn = fakeFetch();
    const transport = createFeedbackTransport(config, {fetchFn});
    assert.equal(transport.kind, 'none', JSON.stringify(config));
    assert.equal(transport.configured, false);
    assert.deepEqual(await transport.upload({envelope: {v: 1}}), {ok: false, retryable: false, errorCode: 'not_configured'});
    assert.equal(fetchFn.calls.length, 0);
  }
});

test('仓库名不合法时不启用 GitHub 传输', () => {
  for (const repo of ['owner', 'a/b/c', 'a b/c', 'owner/', '/name', 'own?er/name', '../x/y']) {
    assert.equal(createFeedbackTransport({repo, token: 'tok'}).kind, 'none', repo);
  }
  // 前后空白会被裁掉后再校验。
  assert.equal(createFeedbackTransport({repo: '  owner/name.repo-1_x  ', token: ' tok '}).kind, 'github');
});

test('中转地址只接受 https 或本机 http，其余回落到下一种传输', () => {
  const relay = ['https://relay.example.workers.dev/upload', 'http://127.0.0.1:8787/x', 'http://localhost/x', 'http://[::1]:9000/', '  https://relay.example/  '];
  for (const endpoint of relay) {
    const transport = createFeedbackTransport({endpoint});
    assert.equal(transport.kind, 'relay', endpoint);
    assert.equal(transport.configured, true);
  }
  const rejected = ['http://relay.example/upload', 'http://192.168.1.2/x', 'ftp://relay.example/', 'file:///etc/passwd', 'not a url', 'javascript:alert(1)'];
  for (const endpoint of rejected) {
    assert.equal(createFeedbackTransport({endpoint}).kind, 'none', endpoint);
    assert.equal(createFeedbackTransport({endpoint, repo: 'o/r', token: 't'}).kind, 'github', endpoint);
  }
});

test('同时配置中转与 GitHub 时优先中转，且令牌不会随请求发往中转', async () => {
  const fetchFn = fakeFetch(() => ({ok: true, status: 200}));
  const transport = createFeedbackTransport(
    {endpoint: 'https://relay.example/upload', repo: 'owner/name', token: 'ghp_SECRET_TOKEN'},
    {fetchFn, appVersion: '2.5.49'},
  );
  assert.equal(transport.kind, 'relay');
  const envelope = {v: 1, data: '密文'};
  const result = await transport.upload({envelope, filePath: 'reports/2026-11-26/a.enc.json'});
  assert.deepEqual(result, {ok: true, path: 'reports/2026-11-26/a.enc.json', status: 200});

  assert.equal(fetchFn.calls.length, 1);
  const {url, init} = fetchFn.calls[0];
  assert.equal(url, 'https://relay.example/upload');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['User-Agent'], 'SuperPinkie-Feedback/2.5.49');
  assert.equal(init.headers.Authorization, undefined);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body), {path: 'reports/2026-11-26/a.enc.json', envelope});
  assert.doesNotMatch(JSON.stringify(fetchFn.calls), /ghp_SECRET_TOKEN/);
});

test('中转上传：默认文件名、失败状态码与网络异常都返回结构化结果', async () => {
  const ok = fakeFetch(() => ({ok: true, status: 202}));
  const defaulted = await createFeedbackTransport({endpoint: 'https://r.example/'}, {fetchFn: ok}).upload({envelope: {}});
  assert.equal(defaulted.ok, true);
  assert.match(defaulted.path, FILE_RE);
  assert.equal(JSON.parse(ok.calls[0].init.body).path, defaulted.path);

  const busy = createFeedbackTransport({endpoint: 'https://r.example/'}, {fetchFn: fakeFetch(() => ({ok: false, status: 503}))});
  assert.deepEqual(await busy.upload({envelope: {}}), {ok: false, status: 503, errorCode: 'server', retryable: true});

  const down = createFeedbackTransport({endpoint: 'https://r.example/'}, {
    fetchFn: fakeFetch(() => { throw new TypeError('fetch failed', {cause: {code: 'ECONNRESET'}}); }),
  });
  assert.deepEqual(await down.upload({envelope: {}}), {ok: false, errorCode: 'offline', retryable: true});

  const noFetch = createFeedbackTransport({endpoint: 'https://r.example/'}, {fetchFn: null});
  assert.deepEqual(await noFetch.upload({envelope: {}}), {ok: false, retryable: false, errorCode: 'no_fetch'});
  // upload 不传参数也不能抛异常。
  assert.equal((await createFeedbackTransport({endpoint: 'https://r.example/'}, {fetchFn: ok}).upload()).ok, true);
});

test('中转请求超过 timeoutMs 会被中止并归类为 timeout', async () => {
  // 假 fetch 只在 signal 中止时才结束，用来验证超时信号确实接到了请求上。
  const hanging = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), {once: true});
  });
  const transport = createFeedbackTransport({endpoint: 'https://r.example/'}, {fetchFn: hanging, timeoutMs: 20});
  assert.deepEqual(await transport.upload({envelope: {}}), {ok: false, errorCode: 'timeout', retryable: true});
});

test('GitHub 上传：PUT 到 contents 接口，逐段编码路径，正文为 base64 的格式化 JSON', async () => {
  const fetchFn = fakeFetch(() => ({ok: true, status: 201}));
  const transport = createFeedbackTransport(
    {repo: 'my-org/feedback.inbox', token: 'ghp_abc', githubApiBase: 'https://ghe.example/api/v3///'},
    {fetchFn, appVersion: '9.9.9'},
  );
  assert.equal(transport.kind, 'github');
  assert.equal(transport.configured, true);
  const envelope = {v: 1, note: '中文 ✓', n: [1, 2]};
  const filePath = 'reports/2026-11-26/a b#?.enc.json';
  assert.deepEqual(await transport.upload({envelope, filePath}), {ok: true, path: filePath, status: 201});

  const {url, init} = fetchFn.calls[0];
  assert.equal(url, 'https://ghe.example/api/v3/repos/my-org/feedback.inbox/contents/reports/2026-11-26/a%20b%23%3F.enc.json');
  assert.equal(init.method, 'PUT');
  assert.equal(init.headers.Authorization, ['Bearer', 'ghp_abc'].join(' '));
  assert.equal(init.headers.Accept, 'application/vnd.github+json');
  assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(init.headers['User-Agent'], 'SuperPinkie-Feedback/9.9.9');
  assert.ok(init.signal instanceof AbortSignal);
  const body = JSON.parse(init.body);
  assert.equal(body.message, `feedback: ${filePath}`);
  // 只新建文件：请求体里不带 sha，不会改写已有文件。
  assert.equal(body.sha, undefined);
  assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), JSON.stringify(envelope, null, 2) + '\n');
});

test('GitHub 默认接口地址与默认文件名', async () => {
  const fetchFn = fakeFetch();
  const result = await createFeedbackTransport({repo: 'o/r', token: 't'}, {fetchFn}).upload({envelope: {}});
  assert.equal(result.ok, true);
  assert.match(result.path, FILE_RE);
  assert.equal(fetchFn.calls[0].url, `https://api.github.com/repos/o/r/contents/${result.path}`);
});

test('GitHub 失败与异常不抛出、不回显令牌', async () => {
  const token = 'ghp_TOP_SECRET_123';
  for (const [status, errorCode, retryable] of [[401, 'auth', false], [404, 'not_found', false], [422, 'conflict', true], [429, 'rate_limit', true]]) {
    const transport = createFeedbackTransport({repo: 'o/r', token}, {fetchFn: fakeFetch(() => ({ok: false, status}))});
    const result = await transport.upload({envelope: {}, filePath: 'reports/x.enc.json'});
    assert.deepEqual(result, {ok: false, status, errorCode, retryable});
  }
  const throwing = createFeedbackTransport({repo: 'o/r', token}, {
    fetchFn: fakeFetch(() => { throw new Error(`boom with ${token}`); }),
  });
  const result = await throwing.upload({envelope: {}});
  assert.deepEqual(result, {ok: false, errorCode: 'offline', retryable: true});
  assert.doesNotMatch(JSON.stringify(result), /TOP_SECRET/);

  const noFetch = createFeedbackTransport({repo: 'o/r', token}, {fetchFn: 'nope'});
  assert.deepEqual(await noFetch.upload({envelope: {}}), {ok: false, retryable: false, errorCode: 'no_fetch'});
});

test('User-Agent 版本号截断到 24 字符，空版本回落到 0.0.0', async () => {
  const longFetch = fakeFetch();
  await createFeedbackTransport({repo: 'o/r', token: 't'}, {fetchFn: longFetch, appVersion: 'y'.repeat(60)}).upload({envelope: {}});
  assert.equal(longFetch.calls[0].init.headers['User-Agent'], `SuperPinkie-Feedback/${'y'.repeat(24)}`);

  const emptyFetch = fakeFetch();
  await createFeedbackTransport({endpoint: 'https://r.example/'}, {fetchFn: emptyFetch, appVersion: ''}).upload({envelope: {}});
  assert.equal(emptyFetch.calls[0].init.headers['User-Agent'], 'SuperPinkie-Feedback/0.0.0');
});
