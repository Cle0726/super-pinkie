import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decryptFeedbackEnvelope, generateFeedbackKeypair} from '../services/mode-architecture/feedback-crypto.mjs';
import {
  FeedbackManager,
  readFeedbackBuildConfig,
  registerFeedback,
} from '../services/mode-architecture/feedback.mjs';
import {sanitizeFeedbackRecord, sanitizeFeedbackText} from '../services/mode-architecture/feedback-sanitize.mjs';
import {resetGuardModeCache} from '../services/mode-architecture/settings-guard.mjs';

function makeTempDir(prefix = 'pinkie-fb-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('without user consent, release mode records nothing and sends zero network requests', async () => {
  const root = makeTempDir();
  const pair = generateFeedbackKeypair();
  let calls = 0;
  const manager = new FeedbackManager({
    root,
    batchSize: 2,
    buildConfig: {
      channel: 'release',
      version: '2.5.49',
      repo: 'Cle0726/pinkie-feedback',
      token: 'ghp_FAKE12345678901234567890123456',
      publicKey: pair.publicKeyDerBase64,
    },
    fetchFn: async () => { calls += 1; return {ok: true, status: 201}; },
  });

  assert.equal(manager.status().consent, false);
  assert.equal(manager.status().asked, false);
  assert.equal(manager.status().canUpload, false);

  manager.onUserPrompt({sessionKey: 'agent:project:main', mode: 'project', prompt: '帮我写个脚本'});
  manager.onModelStarted({runId: 'r1', provider: 'mm', model: 'gemini-2.5-flash'});
  manager.onToolAfter({toolName: 'edit'}, {sessionKey: 'agent:project:main'});
  manager.onAgentEnd({runId: 'r1', success: true}, {sessionKey: 'agent:project:main'});

  manager.onUserPrompt({sessionKey: 'agent:project:main', mode: 'project', prompt: '不对，你没运行测试就说好了'});
  manager.onAgentEnd({runId: 'r2', success: true}, {sessionKey: 'agent:project:main'});

  assert.equal(manager.status().queueCount, 0);
  const flushed = await manager.flush();
  assert.equal(flushed.ok, false);
  assert.equal(flushed.reason, 'no_consent');
  assert.equal(calls, 0);
});

test('dev build never uploads over network even if token is passed, and supports localDebug queue', async () => {
  const root = makeTempDir();
  const pair = generateFeedbackKeypair();
  let calls = 0;
  const manager = new FeedbackManager({
    root,
    batchSize: 1,
    buildConfig: {
      channel: 'dev',
      version: '2.5.49',
      repo: 'Cle0726/pinkie-feedback',
      token: 'ghp_SHOULD_BE_IGNORED_IN_DEV_12345678',
      publicKey: pair.publicKeyDerBase64,
    },
    fetchFn: async () => { calls += 1; return {ok: true, status: 201}; },
  });

  // 即使尝试传 consent: true，开发版也不能打开网络上传
  manager.setPrefs({consent: true, localDebug: true});
  assert.equal(manager.status().isRelease, false);
  assert.equal(manager.status().consent, false);
  assert.equal(manager.status().localDebug, true);
  assert.equal(manager.status().canUpload, false);

  manager.onUserPrompt({sessionKey: 'agent:main:chat1', mode: 'chat', prompt: '写一首短诗'});
  manager.onAgentEnd({success: true}, {sessionKey: 'agent:main:chat1'});

  assert.equal(manager.status().queueCount, 1);
  const res = await manager.flush();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'dev_mode');
  assert.equal(calls, 0);

  const cleared = manager.clear();
  assert.equal(cleared.cleared, 1);
  assert.equal(manager.status().queueCount, 0);
});

test('sanitizer strips home paths, usernames, secrets, URL query params, emails and honorifics', () => {
  const dirty = '先生你看 /Users/Alice/Desktop/secret.txt 和 C:\\Users\\Bob\\app.env?token=abc&key=1 https://api.example.com/v1?api_key=sk-1234567890abcdef12 邮箱 alice@example.com 令牌 ghp_ABCDEFGHIJKLMNOPQRST123456 叫我老王';
  const clean = sanitizeFeedbackText(dirty, 500);
  assert.doesNotMatch(clean, /Alice|Bob|secret|app\.env|sk-1234567890abcdef12|ghp_ABCDEFGHIJKLMNOPQRST123456|alice@example\.com|token=abc|先生|老王/);
  assert.match(clean, /<USER_HOME>/);
  assert.match(clean, /https:\/\/api\.example\.com/);

  const rec = sanitizeFeedbackRecord({
    id: 'id-1',
    type: 'usage',
    at: '2026-11-18T02:00:00.000Z',
    appVersion: '2.5.49',
    channel: 'release',
    platform: 'darwin',
    arch: 'arm64',
    mode: 'project',
    workKind: 'code',
    tools: ['read', 'edit', 'exec'],
    model: 'mm/gemini-2.5-flash?key=sk-1234567890abcdef',
    durationMs: 1234,
    outcome: 'success',
  });
  assert.doesNotMatch(JSON.stringify(rec), /sk-1234567890abcdef/);
});

test('release mode queues sanitized usage + deduplicated correction records with zero raw prompt text', async () => {
  const root = makeTempDir();
  const pair = generateFeedbackKeypair();
  let t = 1_700_000_000_000;
  const manager = new FeedbackManager({
    root,
    now: () => t,
    batchSize: 50,
    buildConfig: {
      channel: 'release',
      version: '2.5.49',
      repo: 'Cle0726/pinkie-feedback',
      token: 'ghp_FAKE12345678901234567890123456',
      publicKey: pair.publicKeyDerBase64,
    },
    fetchFn: async () => ({ok: true, status: 201}),
  });

  manager.setPrefs({consent: true});

  // 第一轮：普通做代码的任务（非纠错）
  manager.onUserPrompt({
    sessionKey: 'agent:project:main',
    mode: 'project',
    prompt: '帮我修一下 /Users/Alice/proj/app.py 里的报错，不要泄露 sk-1234567890abcdef',
    runId: 'run-1',
  });
  manager.onModelStarted({runId: 'run-1', provider: 'mm', model: 'gemini-2.5-flash'});
  manager.onToolAfter({toolName: 'read'}, {sessionKey: 'agent:project:main'});
  manager.onToolAfter({toolName: 'edit'}, {sessionKey: 'agent:project:main'});
  t += 3500;
  manager.onAgentEnd({runId: 'run-1', success: true}, {sessionKey: 'agent:project:main'});

  // 第二轮：用户纠正碧琪，且模型调用 clekk_memory(kind=feedback) 记下规则 -> 同一轮应合并成 1 条纠错记录
  t += 5000;
  const secretPrompt = '不对，先生发现你没跑 pytest 验证 /Users/Alice/proj/app.py 就说好了，而且把 https://a.com?token=secret999 搞丢了，以后改完必须先跑测试！';
  manager.onUserPrompt({
    sessionKey: 'agent:project:main',
    mode: 'project',
    prompt: secretPrompt,
    runId: 'run-2',
  });
  manager.onModelStarted({runId: 'run-2', provider: 'mm', model: 'gemini-2.5-flash'});
  manager.onToolAfter({
    toolName: 'clekk_memory',
    params: {action: 'remember', kind: 'feedback', text: '以后改完 Python 代码不要不跑 pytest 就声称完成'},
  }, {sessionKey: 'agent:project:main'});
  t += 2100;
  manager.onAgentEnd({runId: 'run-2', success: true}, {sessionKey: 'agent:project:main'});

  const queueRaw = fs.readFileSync(path.join(root, 'queue.json'), 'utf8');
  // 严格检查：落盘队列中绝对不含任何原文、路径用户名、密钥、网址参数、称呼
  for (const forbidden of ['Alice', 'app.py', 'sk-1234567890abcdef', 'secret999', '先生', 'pytest', 'ghp_FAKE']) {
    assert.equal(queueRaw.includes(forbidden), false, `queue.json leaked forbidden string: ${forbidden}`);
  }

  const parsed = JSON.parse(queueRaw);
  // 2 条 usage + 1 条合并后的 correction
  assert.equal(parsed.items.length, 3);
  const usages = parsed.items.filter(x => x.type === 'usage');
  const corrections = parsed.items.filter(x => x.type === 'correction');
  assert.equal(usages.length, 2);
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].source, 'both');
  assert.equal(corrections[0].mistakeKind, 'verification_gap');
  assert.equal(corrections[0].correctionDirection, 'verify_before_claim');
  assert.equal(corrections[0].prevWorkKind, 'debugging');
  assert.deepEqual(corrections[0].prevTools, ['read', 'edit']);
  assert.match(corrections[0].summary, /项目模式/);
});

test('batch flush uploads encrypted unique files to GitHub and removes sent items from queue', async () => {
  const root = makeTempDir();
  const pair = generateFeedbackKeypair();
  let t = 1_700_000_000_000;
  const requests = [];

  const manager = new FeedbackManager({
    root,
    now: () => t,
    batchSize: 2,
    buildConfig: {
      channel: 'release',
      version: '2.5.49',
      repo: 'Cle0726/pinkie-feedback',
      token: 'ghp_REAL_LIKE_TOKEN_FOR_MOCK_ONLY_12345',
      publicKey: pair.publicKeyDerBase64,
    },
    fetchFn: async (url, init) => {
      requests.push({url, init});
      return {ok: true, status: 201};
    },
  });

  manager.setPrefs({consent: true});

  for (let i = 0; i < 2; i += 1) {
    manager.onUserPrompt({sessionKey: `agent:main:s${i}`, mode: 'chat', prompt: '你好'});
    manager.onAgentEnd({success: true}, {sessionKey: `agent:main:s${i}`});
  }

  // 等异步 auto-flush 完成
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.github\.com\/repos\/Cle0726\/pinkie-feedback\/contents\/reports\/\d{4}-\d{2}-\d{2}\/.+\.enc\.json$/);
  assert.equal(requests[0].init.method, 'PUT');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer ghp_REAL_LIKE_TOKEN_FOR_MOCK_ONLY_12345');

  const body = JSON.parse(requests[0].init.body);
  const rawFileText = Buffer.from(body.content, 'base64').toString('utf8');
  assert.doesNotMatch(rawFileText, /2\.5\.49|chat|simple/);
  const envelope = JSON.parse(rawFileText);
  const decrypted = decryptFeedbackEnvelope(envelope, pair.privateKeyPem);
  assert.equal(decrypted.records.length, 2);
  assert.equal(manager.status().queueCount, 0);
  assert.equal(manager.status().uploadedCount, 2);
});

test('relay transport replaces GitHub upload in one place when endpoint is configured', async () => {
  const root = makeTempDir();
  const pair = generateFeedbackKeypair();
  const requests = [];

  const manager = new FeedbackManager({
    root,
    batchSize: 10,
    buildConfig: {
      channel: 'release',
      version: '2.5.49',
      endpoint: 'https://pinkie-relay.example.workers.dev/upload',
      publicKey: pair.publicKeyDerBase64,
    },
    fetchFn: async (url, init) => {
      requests.push({url, init});
      return {ok: true, status: 200};
    },
  });

  manager.setPrefs({consent: true});
  manager.onUserPrompt({sessionKey: 'agent:thinking:t1', mode: 'thinking', prompt: '给我想几个点子'});
  manager.onAgentEnd({success: true}, {sessionKey: 'agent:thinking:t1'});

  const flushed = await manager.flush();
  assert.equal(flushed.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://pinkie-relay.example.workers.dev/upload');
  assert.equal(requests[0].init.method, 'POST');
  const payload = JSON.parse(requests[0].init.body);
  const decrypted = decryptFeedbackEnvelope(payload.envelope, pair.privateKeyPem);
  assert.equal(decrypted.records[0].mode, 'thinking');
});

test('offline or expired token keeps queue intact, does not throw, and never leaks token', async () => {
  const root = makeTempDir();
  const pair = generateFeedbackKeypair();
  const secretToken = 'ghp_EXPIRED_SECRET_TOKEN_DO_NOT_LEAK_99';
  const logs = [];
  let mode = 'offline';

  const manager = new FeedbackManager({
    root,
    batchSize: 50,
    logger: {info: msg => logs.push(String(msg))},
    buildConfig: {
      channel: 'release',
      version: '2.5.49',
      repo: 'Cle0726/pinkie-feedback',
      token: secretToken,
      publicKey: pair.publicKeyDerBase64,
    },
    fetchFn: async () => {
      if (mode === 'offline') throw new Error('ECONNREFUSED');
      return {ok: false, status: 401};
    },
  });

  manager.setPrefs({consent: true});
  manager.onUserPrompt({sessionKey: 'agent:main:s1', mode: 'chat', prompt: '测试断网'});
  manager.onAgentEnd({success: true}, {sessionKey: 'agent:main:s1'});

  const offlineRes = await manager.flush();
  assert.equal(offlineRes.ok, false);
  assert.equal(offlineRes.errorCode, 'offline');
  assert.equal(manager.status().queueCount, 1);

  mode = 'expired';
  const authRes = await manager.flush();
  assert.equal(authRes.ok, false);
  assert.equal(authRes.errorCode, 'auth');
  assert.equal(manager.status().queueCount, 1);

  const allSerialized = JSON.stringify({
    status: manager.status(),
    preview: manager.preview(),
    logs,
    prefs: fs.readFileSync(path.join(root, 'prefs.json'), 'utf8'),
    queue: fs.readFileSync(path.join(root, 'queue.json'), 'utf8'),
  });
  assert.equal(allSerialized.includes(secretToken), false);
});

test('reads release feedback config from packaged build-info.json without leaking into dev builds', () => {
  const tmp = makeTempDir('pinkie-bundle-');
  const pair = generateFeedbackKeypair();
  const entry = path.join(tmp, 'runtime/openclaw/openclaw.mjs');
  fs.mkdirSync(path.dirname(entry), {recursive: true});
  fs.writeFileSync(entry, '');
  fs.writeFileSync(path.join(tmp, 'VERSION'), '2.5.49\n');

  fs.writeFileSync(path.join(tmp, 'build-info.json'), JSON.stringify({
    guard: false,
    channel: 'dev',
    version: '2.5.49',
    feedback: {repo: 'Cle0726/pinkie-feedback', token: 'ghp_dev_should_ignore', publicKey: pair.publicKeyDerBase64},
  }));
  resetGuardModeCache();
  const devCfg = readFeedbackBuildConfig({entry});
  assert.equal(devCfg.isRelease, false);
  assert.equal(devCfg.token, '');

  fs.writeFileSync(path.join(tmp, 'build-info.json'), JSON.stringify({
    guard: true,
    channel: 'release',
    version: '2.5.49',
    feedback: {repo: 'Cle0726/pinkie-feedback', token: 'ghp_release_tok', publicKey: pair.publicKeyDerBase64},
  }));
  resetGuardModeCache();
  const relCfg = readFeedbackBuildConfig({entry});
  assert.equal(relCfg.isRelease, true);
  assert.equal(relCfg.repo, 'Cle0726/pinkie-feedback');
  assert.equal(relCfg.token, 'ghp_release_tok');
  resetGuardModeCache();
});

test('gateway methods status/setPrefs/preview/clear/flush work through registerFeedback', async () => {
  const root = makeTempDir();
  const methods = new Map();
  const hooks = new Map();
  const api = {
    registerGatewayMethod(name, handler) { methods.set(name, handler); },
    on(name, handler) { hooks.set(name, handler); },
  };
  const call = (name, params = {}) => new Promise(resolve => {
    methods.get(name)({params, respond: (ok, result, error) => resolve({ok, result, error})});
  });

  const mgr = registerFeedback(api, {
    root,
    buildConfig: {channel: 'release', version: '2.5.49', repo: '', token: '', publicKey: ''},
  });

  const s0 = await call('pinkie.feedback.status');
  assert.equal(s0.ok, true);
  assert.equal(s0.result.consent, false);

  const s1 = await call('pinkie.feedback.setPrefs', {consent: true});
  assert.equal(s1.result.consent, true);
  assert.equal(s1.result.asked, true);

  mgr.onUserPrompt({sessionKey: 'agent:main:x', mode: 'chat', prompt: '你好'});
  mgr.onAgentEnd({success: true}, {sessionKey: 'agent:main:x'});

  const prev = await call('pinkie.feedback.preview');
  assert.equal(prev.result.count, 1);
  assert.equal(prev.result.items.length, 1);

  const clr = await call('pinkie.feedback.clear');
  assert.equal(clr.result.cleared, 1);
  assert.equal(clr.result.status.queueCount, 0);
});

test('24-hour interval triggers auto-flush even below 50-item batch cap', async () => {
  const root = makeTempDir();
  const pair = generateFeedbackKeypair();
  let t = 1_700_000_000_000;
  const requests = [];
  const manager = new FeedbackManager({
    root,
    now: () => t,
    batchSize: 50,
    flushIntervalMs: 24 * 60 * 60 * 1000,
    buildConfig: {
      channel: 'release',
      version: '2.5.49',
      repo: 'Cle0726/pinkie-feedback',
      token: 'ghp_FAKE_TOKEN_INTERVAL_TEST_123456',
      publicKey: pair.publicKeyDerBase64,
    },
    fetchFn: async (url, init) => {
      requests.push({url, init});
      return {ok: true, status: 201};
    },
  });

  manager.setPrefs({consent: true});
  manager.onUserPrompt({sessionKey: 'agent:main:d1', mode: 'chat', prompt: '你好'});
  manager.onAgentEnd({success: true}, {sessionKey: 'agent:main:d1'});
  assert.equal(manager.shouldAutoFlush(), true, 'first upload with lastUploadAt=0 triggers after enqueue/check');

  const first = await manager.maybeAutoFlush();
  assert.equal(first.ok, true);
  assert.equal(requests.length, 1);

  t += 60 * 60 * 1000; // 1 小时后：不满 50 条也不满 24 小时，应攒在本地
  manager.onUserPrompt({sessionKey: 'agent:main:d2', mode: 'chat', prompt: '你好'});
  manager.onAgentEnd({success: true}, {sessionKey: 'agent:main:d2'});
  assert.equal(manager.shouldAutoFlush(), false);

  t += 24 * 60 * 60 * 1000; // 满 24 小时后自动触发
  assert.equal(manager.shouldAutoFlush(), true);
  const second = await manager.maybeAutoFlush();
  assert.equal(second.ok, true);
  assert.equal(requests.length, 2);
});

test('Mac/Win packagers and release workflow wire feedback config only on release channel', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const buildSh = fs.readFileSync(path.join(repoRoot, 'desktop/macos/build.sh'), 'utf8');
  const buildPs1 = fs.readFileSync(path.join(repoRoot, 'build-win.ps1'), 'utf8');
  const releaseYml = fs.readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  for (const text of [buildSh, buildPs1, releaseYml]) {
    assert.match(text, /PINKIE_FEEDBACK_TOKEN/);
    assert.match(text, /PINKIE_FEEDBACK_PUBLIC_KEY/);
    assert.match(text, /PINKIE_FEEDBACK_REPO/);
    assert.match(text, /PINKIE_FEEDBACK_RELAY_URL/);
  }
  assert.match(buildSh, /if \(channel === 'release'\)/);
  assert.match(buildPs1, /if \(\$guardChannel -eq 'release'\)/);
});

test('mode-architecture plugin registers pinkie.feedback.* gateway methods cleanly', async () => {
  const methods = new Map();
  const hooks = new Map();
  const prevState = process.env.PINKIE_STATE_ROOT;
  const tmpState = makeTempDir('pinkie-plugin-state-');
  process.env.PINKIE_STATE_ROOT = tmpState;
  try {
    const plugin = (await import('../services/mode-architecture/index.mjs')).default;
    const api = {
      logger: {info() {}, warn() {}, error() {}},
      config: {},
      runtime: {state: {resolveStateDir: () => tmpState}},
      registerTool() {},
      registerHttpRoute() {},
      registerGatewayMethod(name, handler) { methods.set(name, handler); },
      on(name, handler) { (hooks.get(name) || hooks.set(name, []).get(name)).push(handler); },
      session: {workflow: {enqueueNextTurnInjection: async () => ({enqueued: true})}},
    };
    plugin.register(api);
    for (const method of [
      'pinkie.feedback.status',
      'pinkie.feedback.setPrefs',
      'pinkie.feedback.preview',
      'pinkie.feedback.clear',
      'pinkie.feedback.flush',
    ]) {
      assert.equal(methods.has(method), true, `missing gateway method ${method}`);
    }
    const status = await new Promise(resolve => {
      methods.get('pinkie.feedback.status')({params: {}, respond: (ok, result) => resolve({ok, result})});
    });
    assert.equal(status.ok, true);
    assert.equal(status.result.consent, false);
  } finally {
    if (prevState === undefined) delete process.env.PINKIE_STATE_ROOT;
    else process.env.PINKIE_STATE_ROOT = prevState;
  }
});
