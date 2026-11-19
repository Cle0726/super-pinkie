import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

import {
  MetreLock,
  cooldownMsForFailures,
  loadHashRecord,
  registerMetreLock,
  resolveMachineId,
  setActiveMetreLock,
  verifyScryptPassword,
} from '../services/mode-architecture/metre-lock.mjs';
import {registerMetreMemory} from '../services/mode-architecture/metre-memory.mjs';
import {registerMetreBoard} from '../services/mode-architecture/metre-board.mjs';
import {registerQuietMode} from '../services/mode-architecture/quiet-mode.mjs';
import {registerSessionLineage, registerMetreModelsTool} from '../services/mode-architecture/session-lineage.mjs';
import {registerSessionManage} from '../services/mode-architecture/session-manage.mjs';
import projectScopePlugin from '../services/project-scope/index.mjs';
import {transformWithStatus} from '../patch/apply-metre-lock.mjs';
import {hashPassword, writePasswordHash} from '../tools/metre/set-password.mjs';
import {buildManifest, signBytes, startup} from '../installer/guard/guard.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const {sharedUi} = require('./fixtures/shared-ui.cjs');

const TEST_PASSPHRASE = 'test-fixture-metre-passphrase-123456';
const put = (file, content) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
};

async function makeTempLock({
  channel = 'release',
  configured = true,
  password = TEST_PASSPHRASE,
  machineId = 'darwin:machine-alpha',
  nowFn,
  fastVerify = false,
} = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-metre-lock-')));
  const stateRoot = path.join(dir, 'pinkie-state');
  const hashFile = path.join(dir, 'metre-lock-hash.json');
  let hashRecord = null;
  if (configured) {
    hashRecord = await hashPassword(password, {
      salt: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      N: 16384,
      r: 8,
      p: 1,
      keylen: 64,
    });
    fs.writeFileSync(hashFile, JSON.stringify(hashRecord, null, 2));
  } else {
    fs.writeFileSync(hashFile, JSON.stringify({algorithm: 'scrypt', configured: false}, null, 2));
  }
  const verifyPassword = fastVerify
    ? async (candidate) => candidate === password
    : undefined;
  const create = (overrides = {}) => new MetreLock({
    mode: {enabled: channel === 'release', channel, version: '9.9.9', bundleRoot: dir},
    pinkieStateRoot: stateRoot,
    hashFile,
    machineId,
    now: nowFn || (() => Date.now()),
    verifyPassword,
    ...overrides,
  });
  return {dir, stateRoot, hashFile, hashRecord, create, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

function createPluginApiMock(extraConfig = {}, stateDir = os.tmpdir()) {
  const methods = new Map();
  const tools = [];
  const hooks = new Map();
  return {
    methods,
    tools,
    hooks,
    api: {
      config: extraConfig,
      logger: {info() {}, warn() {}, error() {}},
      runtime: {
        state: {resolveStateDir: () => stateDir},
        config: {
          loadConfig: () => extraConfig,
          writeConfigFile: async () => {},
        },
        agent: {
          session: {
            resolveSessionTranscriptPath: (id) => path.join(stateDir, `${id}.jsonl`),
          },
        },
      },
      registerGatewayMethod(name, handler, meta = {}) {
        methods.set(name, {handler, meta});
      },
      registerTool(factoryOrDef, meta = {}) {
        tools.push({factoryOrDef, meta});
      },
      registerHttpRoute() {},
      registerService() {},
      registerCli() {},
      on(hookName, handler, opts = {}) {
        if (!hooks.has(hookName)) hooks.set(hookName, []);
        hooks.get(hookName).push({handler, priority: Number(opts?.priority || 0)});
      },
      registerHook(hookName, handler, opts = {}) {
        if (!hooks.has(hookName)) hooks.set(hookName, []);
        hooks.get(hookName).push({handler, priority: Number(opts?.priority || 0)});
      },
      resolvePath: p => p,
    },
  };
}

async function callGatewayMethod(methods, name, params = {}) {
  const entry = methods.get(name);
  assert.ok(entry, `gateway method registered: ${name}`);
  return await new Promise((resolve) => {
    let settled = false;
    const respond = (ok, payload, error) => {
      if (settled) return;
      settled = true;
      resolve({ok, payload, error});
    };
    const maybe = entry.handler({params, respond});
    if (maybe && typeof maybe.then === 'function') {
      maybe.catch(err => respond(false, undefined, {code: 'EXCEPTION', message: err?.message || String(err)}));
    }
  });
}

test('repo ships either the placeholder or a valid scrypt hash (never a plaintext password) and set-password generates valid scrypt record', async () => {
  const shippedFile = path.join(ROOT, 'services/mode-architecture/metre-lock-hash.json');
  const shipped = JSON.parse(fs.readFileSync(shippedFile, 'utf8'));
  assert.equal(shipped.algorithm, 'scrypt');
  assert.deepEqual(Object.keys(shipped).filter(k => /pass|plain|secret/i.test(k)), []);
  if (shipped.configured === true) {
    const record = loadHashRecord(shippedFile);
    assert.ok(record, 'configured hash must be a valid scrypt record');
    assert.ok(record.N >= 16384);
  } else {
    assert.equal(shipped.hash, undefined);
    assert.equal(shipped.salt, undefined);
    assert.equal(loadHashRecord(shippedFile), null);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-setpw-'));
  try {
    const outFile = path.join(dir, 'metre-lock-hash.json');
    const {record} = await writePasswordHash(TEST_PASSPHRASE, {outFile, N: 16384});
    assert.equal(record.configured, true);
    assert.equal(record.algorithm, 'scrypt');
    assert.equal(fs.readFileSync(outFile, 'utf8').includes(TEST_PASSPHRASE), false);

    const parsed = loadHashRecord(outFile);
    assert.ok(parsed);
    assert.equal(await verifyScryptPassword(TEST_PASSPHRASE, parsed), true);
    assert.equal(await verifyScryptPassword('wrong-password', parsed), false);
    assert.equal(await verifyScryptPassword('', parsed), false);

    const cliReject = spawnSync(process.execPath, ['tools/metre/set-password.mjs', '--password', 'bad'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(cliReject.status, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('dev build never locks Metre and creates no lock state file', async () => {
  const ctx = await makeTempLock({channel: 'dev'});
  try {
    const lock = ctx.create();
    const st = lock.status();
    assert.equal(st.channel, 'dev');
    assert.equal(st.required, false);
    assert.equal(st.locked, false);
    assert.equal(st.unlocked, true);
    assert.equal(lock.isLockedSession('agent:metre:main'), false);
    assert.equal(lock.checkGatewayRequest('pinkie.metre.board', {}), '');
    assert.equal(lock.checkGatewayRequest('chat.send', {sessionKey: 'agent:metre:main'}), '');
    assert.equal((await lock.unlock('')).ok, true);
    assert.equal(lock.lock().unlocked, true);
    assert.equal(fs.existsSync(path.join(ctx.stateRoot, 'guard/metre-lock.json')), false);
  } finally {
    ctx.cleanup();
  }
});

test('release build fails closed when unconfigured and requires password + machine binding when configured', async () => {
  const unconfiguredCtx = await makeTempLock({channel: 'release', configured: false});
  try {
    const lock = unconfiguredCtx.create();
    assert.equal(lock.status().required, true);
    assert.equal(lock.status().configured, false);
    assert.equal(lock.status().locked, true);
    const attempt = await lock.unlock(TEST_PASSPHRASE);
    assert.equal(attempt.ok, false);
    assert.equal(attempt.code, 'NOT_CONFIGURED');
    assert.equal(lock.isLocked(), true);
  } finally {
    unconfiguredCtx.cleanup();
  }

  const ctx = await makeTempLock({channel: 'release', configured: true});
  try {
    const lock1 = ctx.create();
    assert.equal(lock1.status().locked, true);

    const wrong = await lock1.unlock('not-the-password');
    assert.equal(wrong.ok, false);
    assert.equal(wrong.code, 'WRONG_PASSWORD');
    assert.equal(wrong.failures, 1);
    assert.equal(wrong.remainingAttempts, 4);

    const empty = await lock1.unlock('');
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'EMPTY_PASSWORD');
    assert.equal(empty.failures, 1);

    const ok = await lock1.unlock(TEST_PASSPHRASE);
    assert.equal(ok.ok, true);
    assert.equal(ok.unlocked, true);
    assert.equal(ok.locked, false);
    assert.equal(ok.failures, 0);

    // Same machine survives restart unlocked.
    const restarted = ctx.create();
    assert.equal(restarted.status().unlocked, true);
    assert.equal(restarted.status().locked, false);

    // Copied state file onto another machine stays locked.
    const otherMachine = ctx.create({machineId: 'win32:machine-beta'});
    assert.equal(otherMachine.status().unlocked, false);
    assert.equal(otherMachine.status().locked, true);

    // Platform machine-id resolution extracts hardware IDs on macOS, Windows, and Linux.
    assert.equal(resolveMachineId({platform: 'darwin', useCache: false, exec: () => '"IOPlatformUUID" = "MAC-UUID-123"'}), 'darwin:MAC-UUID-123');
    assert.equal(resolveMachineId({platform: 'win32', useCache: false, exec: () => '    MachineGuid    REG_SZ    WIN-GUID-456\r\n'}), 'win32:WIN-GUID-456');
    assert.equal(resolveMachineId({platform: 'linux', useCache: false, readFile: () => 'linux-id-789\n'}), 'linux:linux-id-789');

    // Tampered MAC on same machine stays locked.
    const stateFile = path.join(ctx.stateRoot, 'guard', 'metre-lock.json');
    const tampered = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    tampered.mac = '0'.repeat(64);
    fs.writeFileSync(stateFile, JSON.stringify(tampered));
    const afterTamper = ctx.create();
    assert.equal(afterTamper.status().locked, true);

    // Unlock again, then relock explicitly and confirm restart stays locked.
    assert.equal((await afterTamper.unlock(TEST_PASSPHRASE)).ok, true);
    assert.equal(afterTamper.lock().locked, true);
    assert.equal(ctx.create().status().locked, true);

    // Dual plugin registration in one gateway process shares one live lock instance (no split-brain on unlock/relock).
    const firstApi = createPluginApiMock();
    const secondApi = createPluginApiMock();
    const regOpts = {
      mode: {enabled: true, channel: 'release', version: '9.9.9', bundleRoot: ctx.dir},
      pinkieStateRoot: ctx.stateRoot,
      hashFile: ctx.hashFile,
      machineId: 'darwin:machine-alpha',
    };
    const lockA = registerMetreLock(firstApi.api, regOpts);
    const lockB = registerMetreLock(secondApi.api, regOpts);
    assert.equal(lockA, lockB, 'duplicate registerMetreLock calls share one instance');
    const unlockedDual = await callGatewayMethod(firstApi.methods, 'pinkie.guard.metreUnlock', {password: TEST_PASSPHRASE});
    assert.equal(unlockedDual.payload?.unlocked, true);
    assert.equal(lockB.isLocked(), false);
    const relockedDual = await callGatewayMethod(firstApi.methods, 'pinkie.guard.metreLock', {});
    assert.equal(relockedDual.payload?.locked, true);
    assert.equal(lockB.isLocked(), true);
  } finally {
    setActiveMetreLock(null);
    ctx.cleanup();
  }
});

test('cooldown enforces 10m after 5 failures, doubles each subsequent failure, and survives restart', async () => {
  assert.equal(cooldownMsForFailures(4), 0);
  assert.equal(cooldownMsForFailures(5), 10 * 60_000);
  assert.equal(cooldownMsForFailures(6), 20 * 60_000);
  assert.equal(cooldownMsForFailures(7), 40 * 60_000);

  let now = 1_700_000_000_000;
  let verifyCalls = 0;
  const ctx = await makeTempLock({
    channel: 'release',
    nowFn: () => now,
  });
  const countVerify = async (candidate) => {
    verifyCalls += 1;
    return candidate === TEST_PASSPHRASE;
  };
  try {
    const lock = ctx.create({verifyPassword: countVerify});
    for (let i = 1; i <= 4; i++) {
      now += 1000;
      const res = await lock.unlock(`bad-${i}`);
      assert.equal(res.code, 'WRONG_PASSWORD');
      assert.equal(res.failures, i);
      assert.equal(res.lockedUntil, 0);
    }

    now += 1000;
    const fifth = await lock.unlock('bad-5');
    assert.equal(fifth.code, 'COOLDOWN');
    assert.equal(fifth.failures, 5);
    assert.equal(fifth.lockedUntil, now + 10 * 60_000);
    assert.equal(fifth.retryAfterMs, 10 * 60_000);

    // During cooldown: even correct password is rejected without running scrypt verify.
    const verifyBefore = verifyCalls;
    now += 60_000;
    const blocked = await lock.unlock(TEST_PASSPHRASE);
    assert.equal(blocked.code, 'COOLDOWN');
    assert.equal(blocked.failures, 5);
    assert.equal(blocked.retryAfterMs, 9 * 60_000);
    assert.equal(verifyCalls, verifyBefore);

    // Restart preserves cooldown & failure count.
    const restarted = ctx.create({verifyPassword: countVerify});
    assert.equal(restarted.status().failures, 5);
    assert.equal(restarted.status().retryAfterMs, 9 * 60_000);

    // After 10m cooldown expires, 6th wrong password doubles cooldown to 20m.
    now += 9 * 60_000 + 1;
    const sixth = await restarted.unlock('bad-6');
    assert.equal(sixth.code, 'COOLDOWN');
    assert.equal(sixth.failures, 6);
    assert.equal(sixth.retryAfterMs, 20 * 60_000);

    // After 20m cooldown expires, 7th wrong password doubles cooldown to 40m.
    now += 20 * 60_000 + 1;
    const seventh = await restarted.unlock('bad-7');
    assert.equal(seventh.code, 'COOLDOWN');
    assert.equal(seventh.failures, 7);
    assert.equal(seventh.retryAfterMs, 40 * 60_000);

    // Waiting out 40m + correct password clears failure count and unlocks.
    now += 40 * 60_000 + 1;
    const ok = await restarted.unlock(TEST_PASSPHRASE);
    assert.equal(ok.ok, true);
    assert.equal(ok.failures, 0);
    assert.equal(ok.lockedUntil, 0);
    assert.equal(ctx.create().status().unlocked, true);
  } finally {
    ctx.cleanup();
  }
});

test('module-level guards reject Metre sessions, tools, and RPCs while preserving normal modes & home festival lookup', async () => {
  const ctx = await makeTempLock({channel: 'release', fastVerify: true});
  const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-openclaw-state-'));
  const prevState = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = tmpState;
  try {
    const lock = ctx.create();
    const {api, methods, tools, hooks} = createPluginApiMock({}, tmpState);
    registerMetreLock(api, {lock});
    registerMetreMemory(api, {resolveAgentDir: () => tmpState, getActiveScope: () => ''});
    registerMetreBoard(api, {resolveWorkspace: () => tmpState});
    registerQuietMode(api, {wakeSession: async () => {}});
    const sharedTitles = {access: {sync() {}}, mark() {}, has() { return false; }, isStarted() { return false; }};
    registerSessionLineage(api, {
      root: tmpState,
      titles: sharedTitles,
      wakeSession: async () => {},
      config: () => ({agents: {list: [{id: 'main'}, {id: 'metre'}]}}),
    });
    registerMetreModelsTool(api, {configPath: () => path.join(tmpState, 'openclaw.json')});
    registerSessionManage(api, {
      root: tmpState,
      stateRoot: tmpState,
      titles: sharedTitles,
      configPath: () => path.join(tmpState, 'openclaw.json'),
      transcriptPath: (key) => path.join(tmpState, `${key.replace(/[:/]/g, '_')}.jsonl`),
    });
    projectScopePlugin.register(api);

    // While locked: pinkie.metre.today calendar festival lookup ({date}) STILL works!
    const festivalRes = await callGatewayMethod(methods, 'pinkie.metre.today', {date: '2026-02-17'});
    assert.equal(festivalRes.ok, true);

    // While locked: pinkie.metre.today with sessionKey/folder/scope is blocked!
    const festivalWithSession = await callGatewayMethod(methods, 'pinkie.metre.today', {sessionKey: 'agent:metre:main'});
    assert.equal(festivalWithSession.ok, false);
    assert.match(festivalWithSession.error?.message || '', /密码/);

    for (const [method, params] of [
      ['pinkie.metre.memory', {folder: tmpState}],
      ['pinkie.metre.board', {}],
      ['pinkie.metre.resume', {taskId: 't1'}],
      ['pinkie.metre.pause', {sessionKey: 'agent:metre:main'}],
      ['pinkie.metre.stopAll', {sessionKey: 'agent:metre:main'}],
      ['pinkie.quiet.set', {quiet: true}],
      ['pinkie.session.manage.cards', {key: 'agent:metre:main'}],
      ['pinkie.session.manage.placements', {agentId: 'metre'}],
      ['pinkie.project.bind', {key: 'agent:metre:main', path: tmpState}],
    ]) {
      const res = await callGatewayMethod(methods, method, params);
      assert.equal(res.ok, false, `locked release rejects ${method}`);
      assert.match(res.error?.message || '', /密码/);
    }

    const restoreBackup = path.join(tmpState, 'backups', 'sessions-deleted', 'b1');
    put(path.join(restoreBackup, 'session.json'), JSON.stringify({key: 'agent:metre:main', agentId: 'metre'}));
    const restoreRes = await callGatewayMethod(methods, 'pinkie.session.manage.restore', {backup: restoreBackup});
    assert.equal(restoreRes.payload?.ok, false);
    assert.match(restoreRes.payload?.error || '', /密码/);

    // Metre-only tools return null or throw on locked metre context.
    for (const {factoryOrDef} of tools) {
      if (typeof factoryOrDef !== 'function') continue;
      const produced = factoryOrDef({sessionKey: 'agent:metre:main', agentId: 'metre'});
      if (produced?.execute) {
        await assert.rejects(() => produced.execute('c1', {action: 'list', sessionKey: 'agent:metre:main'}), /密码/);
      } else {
        assert.equal(produced, null);
      }
      // Normal chat context should NOT yield metre-only tools (unless shared cross-mode tool like plan/sessions)
      const chatProduced = factoryOrDef({sessionKey: 'agent:main:main', agentId: 'main'});
      if (chatProduced?.name === 'metre_memory' || chatProduced?.name === 'pinkie_models') {
        assert.equal(chatProduced, null);
      }
    }

    // Quiet mode before_agent_run skips locked metre quietly.
    const quietHook = (hooks.get('before_agent_run') || [])[0]?.handler;
    assert.ok(quietHook);
    assert.equal(await quietHook({prompt: 'hello'}, {sessionKey: 'agent:metre:main', agentId: 'metre'}), undefined);

    // Unlock via gateway RPC -> now Metre RPCs & tools succeed!
    const unlockRes = await callGatewayMethod(methods, 'pinkie.guard.metreUnlock', {password: TEST_PASSPHRASE});
    assert.equal(unlockRes.ok, true);
    assert.equal(unlockRes.payload?.unlocked, true);

    const boardAfter = await callGatewayMethod(methods, 'pinkie.metre.board', {});
    assert.equal(boardAfter.ok, true);
  } finally {
    setActiveMetreLock(null);
    if (prevState === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = prevState;
    fs.rmSync(tmpState, {recursive: true, force: true});
    ctx.cleanup();
  }
});

test('full mode-architecture plugin reads disk guard-build.json, blocks locked Metre agent/tools/RPCs, and keeps SettingsGuard active after unlock', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-e2e-')));
  const bundleDir = path.join(root, 'SuperPinkie');
  const home = path.join(root, 'home');
  const stateDir = path.join(home, '.openclaw');
  const pinkieRoot = path.join(root, 'app-state');
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
  const keyPem = privateKey.export({type: 'pkcs8', format: 'pem'});
  const pub = publicKey.export({type: 'spki', format: 'der'}).toString('base64');

  const prevState = process.env.OPENCLAW_STATE_DIR;
  const prevPinkieRoot = process.env.PINKIE_STATE_ROOT;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.PINKIE_STATE_ROOT = pinkieRoot;
  put(path.join(stateDir, 'openclaw.json'), JSON.stringify({agents: {list: [{id: 'main'}, {id: 'metre', workspace: path.join(stateDir, 'workspace-metre')}]}}));
  put(path.join(bundleDir, 'VERSION'), '9.9.9\n');
  put(path.join(bundleDir, 'build-info.json'), JSON.stringify({guard: true, channel: 'release', version: '9.9.9'}));
  put(path.join(bundleDir, 'personas/chat/SOUL.md'), 'official chat soul');
  put(path.join(bundleDir, 'personas/metre/SOUL.md'), 'official metre soul');
  put(path.join(bundleDir, 'installer/guard/guard.mjs'), fs.readFileSync(path.join(ROOT, 'installer/guard/guard.mjs'), 'utf8'));
  fs.cpSync(path.join(ROOT, 'services', 'mode-architecture'), path.join(bundleDir, 'services', 'mode-architecture'), {recursive: true});
  await writePasswordHash(TEST_PASSPHRASE, {
    outFile: path.join(bundleDir, 'services', 'mode-architecture', 'metre-lock-hash.json'),
    N: 16384,
  });
  // Simulate extension already installed into stateDir before guard startup repairs & writes guard-build.json.
  fs.cpSync(path.join(bundleDir, 'services', 'mode-architecture'), path.join(stateDir, 'extensions', 'pinkie-mode-architecture'), {recursive: true});
  put(path.join(stateDir, 'extensions', 'pinkie-mode-architecture', 'index.mjs'), '// tampered plugin before startup');
  const manifest = buildManifest(bundleDir, {commit: 'c'.repeat(40)});
  fs.writeFileSync(path.join(bundleDir, 'guard-manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(bundleDir, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(bundleDir, 'guard-manifest.json')), keyPem));
  const startupRes = startup({bundle: bundleDir, home, appState: pinkieRoot, key: pub});
  assert.equal(startupRes.trusted, true);

  try {
    const installedEntry = path.join(stateDir, 'extensions', 'pinkie-mode-architecture', 'index.mjs');
    const {default: isolatedPlugin} = await import(`${pathToFileURL(installedEntry).href}?t=${Date.now()}`);
    const {api, methods, tools, hooks} = createPluginApiMock({agents: {list: [{id: 'main'}, {id: 'metre'}]}}, stateDir);
    isolatedPlugin.register(api);
    const stRes = await callGatewayMethod(methods, 'pinkie.guard.metreStatus', {});
    assert.equal(stRes.ok, true);
    assert.equal(stRes.payload?.required, true);
    assert.equal(stRes.payload?.configured, true);
    assert.equal(stRes.payload?.locked, true);

    // 1. before_agent_run must block agent:metre:main while locked!
    const runHooks = hooks.get('before_agent_run') || [];
    let blockedDecision = null;
    for (const h of runHooks) {
      const out = await h.handler({prompt: 'hi'}, {sessionKey: 'agent:metre:main', agentId: 'metre'});
      if (out?.outcome === 'block') { blockedDecision = out; break; }
    }
    assert.equal(blockedDecision?.outcome, 'block');
    assert.equal(blockedDecision?.reason, 'metre-locked');

    // 2. before_tool_call must block tools for agent:metre:main AND cross-mode tools targeting Metre while locked!
    const toolHooks = hooks.get('before_tool_call') || [];
    let toolBlocked = null;
    for (const h of toolHooks) {
      const out = await h.handler({toolName: 'exec', params: {command: 'echo hi'}}, {sessionKey: 'agent:metre:main', agentId: 'metre'});
      if (out?.block === true) { toolBlocked = out; break; }
    }
    assert.equal(toolBlocked?.block, true);
    assert.match(toolBlocked?.blockReason || '', /密码/);

    for (const [toolName, params] of [
      ['sessions_send', {sessionKey: 'agent:metre:main', message: 'bypass'}],
      ['sessions_spawn', {agentId: 'metre', prompt: 'bypass'}],
      ['cron', {job: {agentId: 'metre', sessionKey: 'agent:metre:main'}}],
      ['pinkie_sessions', {action: 'read', target: 'agent:metre:main'}],
    ]) {
      let crossBlocked = null;
      for (const h of toolHooks) {
        const out = await h.handler({toolName, params}, {sessionKey: 'agent:unrestricted:main', agentId: 'unrestricted'});
        if (out?.block === true) { crossBlocked = out; break; }
      }
      assert.equal(crossBlocked?.block, true, `cross-mode ${toolName} targeting Metre blocked while locked`);
    }
    // Ordinary non-Metre tool calls remain unaffected.
    let normalCrossBlocked = null;
    for (const h of toolHooks) {
      const out = await h.handler({toolName: 'sessions_send', params: {sessionKey: 'agent:project:main', message: 'mention metre in text'}}, {sessionKey: 'agent:main:main', agentId: 'main'});
      if (out?.block === true) { normalCrossBlocked = out; break; }
    }
    assert.equal(normalCrossBlocked, null);

    // 3. Gateway RPCs targeting agent:metre:main must fail while locked; pinkie.guard.metreStatus proceeds!
    for (const method of ['pinkie.run.status', 'pinkie.webGpt.arm', 'pinkie.webGpt.inject', 'pinkie.watchdog.status', 'pinkie.reasoning.status']) {
      if (!methods.has(method)) continue;
      const res = await callGatewayMethod(methods, method, {sessionKey: 'agent:metre:main'});
      assert.equal(res.ok, false, `blocked ${method}`);
      assert.match(res.error?.message || '', /密码/);
    }

    // 4. Metre tools are suppressed while locked.
    const metreScopedToolCount = tools
      .filter(t => typeof t.factoryOrDef === 'function')
      .map(t => t.factoryOrDef({sessionKey: 'agent:metre:main', agentId: 'metre'}))
      .filter(Boolean).length;
    assert.equal(metreScopedToolCount, 0);

    // 5. Unlock via real gateway RPC -> before_agent_run / before_tool_call are no longer blocked by metre-lock.
    const unlockRpc = await callGatewayMethod(methods, 'pinkie.guard.metreUnlock', {password: TEST_PASSPHRASE});
    assert.equal(unlockRpc.ok, true);
    assert.equal(unlockRpc.payload?.unlocked, true);
    let postUnlockBlock = null;
    for (const h of runHooks) {
      const out = await h.handler({prompt: 'hi'}, {sessionKey: 'agent:metre:main', agentId: 'metre'});
      if (out?.reason === 'metre-locked') postUnlockBlock = out;
    }
    assert.equal(postUnlockBlock, null);

    // 6. SettingsGuard remains active even AFTER unlocking Metre (live hook + isolated SettingsGuard)!
    for (const targetFile of [path.join(stateDir, 'workspace-metre/SOUL.md'), path.join(stateDir, 'openclaw.json')]) {
      let postUnlockToolBlock = null;
      for (const h of toolHooks) {
        const out = await h.handler({toolName: 'write', params: {file_path: targetFile}}, {agentId: 'metre', sessionKey: 'agent:metre:main'});
        if (out?.block === true) { postUnlockToolBlock = out; break; }
      }
      assert.equal(postUnlockToolBlock?.block, true, `SettingsGuard still blocks ${targetFile}`);
    }
    const {SettingsGuard: IsoSettingsGuard} = await import(pathToFileURL(path.join(stateDir, 'extensions', 'pinkie-mode-architecture', 'settings-guard.mjs')).href);
    const sg = new IsoSettingsGuard({home, stateDir, appState: pinkieRoot});
    assert.equal(sg.enabled, true);
    assert.equal(sg.status().channel, 'release');
  } finally {
    setActiveMetreLock(null);
    if (prevState === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = prevState;
    if (prevPinkieRoot === undefined) delete process.env.PINKIE_STATE_ROOT;
    else process.env.PINKIE_STATE_ROOT = prevPinkieRoot;
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('OpenClaw gateway patch intercepts chat.send / sessions.* / agent / nested params, is idempotent, and fails closed when plugin missing in release', async () => {
  const sample = [
    'const ErrorCodes = { INVALID_REQUEST: "INVALID_REQUEST" };',
    'const errorShape = (code, message) => ({ code, message });',
    'function authorizeGatewayMethod() {}',
    'export async function handleGatewayRequest({ req, respond }) {',
    '\tconst authError = authorizeGatewayMethod();',
    '\tif (authError) {',
    '\t\trespond(false, void 0, authError);',
    '\t\treturn;',
    '\t}',
    '\trespond(true, { ok: true, forwarded: req.method });',
    '}',
  ].join('\n');

  const first = transformWithStatus(sample);
  assert.equal(first.changed, true);
  assert.equal(first.reason, 'patched');
  const second = transformWithStatus(first.text);
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'already-patched');

  const simRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-gw-patch-')));
  const patchedFile = path.join(simRoot, 'runtime', 'openclaw', 'dist', 'server-methods-test.mjs');
  put(path.join(simRoot, 'build-info.json'), JSON.stringify({guard: true, channel: 'release', version: '9.9.9'}));
  put(patchedFile, first.text);

  const ctx = await makeTempLock({channel: 'release', fastVerify: true});
  try {
    const {handleGatewayRequest: fn} = await import(`${pathToFileURL(patchedFile).href}?t=${Date.now()}`);
    const invoke = async (method, params) => {
      let response = null;
      await fn({
        req: {method, params},
        respond: (ok, payload, error) => { response = {ok, payload, error}; },
      });
      return response;
    };

    // Fail-closed test: even if plugin failed to load (activeMetreLock === null) on a release runtime, Metre calls stay blocked!
    setActiveMetreLock(null);
    delete globalThis[Symbol.for('pinkie.metreLock.releaseRuntime.v1')];
    assert.equal((await invoke('chat.send', {sessionKey: 'agent:metre:main', message: 'hi'})).ok, false);
    assert.equal((await invoke('cron.add', {job: {agentId: 'metre', sessionKey: 'agent:metre:main'}})).ok, false);
    assert.equal((await invoke('pinkie.metre.board', {})).ok, false);
    assert.equal((await invoke('pinkie.metre.today', {date: '2026-11-18'})).ok, true);
    assert.equal((await invoke('chat.send', {sessionKey: 'agent:main:main', message: 'hi'})).ok, true);

    const lock = ctx.create();
    setActiveMetreLock(lock);

    // Locked release rejects direct gateway chat.send, sessions.*, agent, agents.*, cron.add targeting metre.
    for (const [method, params] of [
      ['chat.send', {sessionKey: 'agent:metre:main', message: 'hi'}],
      ['sessions.create', {agentId: 'metre', key: 'agent:metre:new'}],
      ['sessions.send', {key: 'agent:metre:main', message: 'hi'}],
      ['sessions.steer', {sessionKey: 'agent:metre:main', message: 'hi'}],
      ['agent', {sessionKey: 'agent:metre:main', prompt: 'hi'}],
      ['chat.inject', {sessionKey: 'agent:metre:main'}],
      ['agents.update', {id: 'metre', name: 'x'}],
      ['cron.add', {job: {agentId: 'metre', payload: {message: 'hi'}}}],
    ]) {
      const res = await invoke(method, params);
      assert.equal(res.ok, false, `${method} blocked while locked`);
      assert.equal(res.error?.code, 'INVALID_REQUEST');
      assert.match(res.error?.message || '', /密码/);
    }

    // Allows unlock RPCs and non-metre requests while locked!
    assert.equal((await invoke('pinkie.guard.metreStatus', {})).ok, true);
    assert.equal((await invoke('pinkie.guard.metreUnlock', {password: TEST_PASSPHRASE})).ok, true);
    assert.equal((await invoke('chat.send', {sessionKey: 'agent:main:main', message: 'talk about metre'})).ok, true);

    // After unlocking, Metre gateway requests succeed!
    await lock.unlock(TEST_PASSPHRASE);
    assert.equal((await invoke('chat.send', {sessionKey: 'agent:metre:main', message: 'hi'})).ok, true);
  } finally {
    setActiveMetreLock(null);
    delete globalThis[Symbol.for('pinkie.metreLock.releaseRuntime.v1')];
    ctx.cleanup();
    fs.rmSync(simRoot, {recursive: true, force: true});
  }
});

test('simulated release bundle & dev bundle guard verification preserve hash file and handle unlock state safely', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-sim-bundle-')));
  try {
    const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
    const keyPem = privateKey.export({type: 'pkcs8', format: 'pem'});
    const pub = publicKey.export({type: 'spki', format: 'der'}).toString('base64');

    const bundle = path.join(root, 'SuperPinkie');
    const home = path.join(root, 'home');
    const state = path.join(home, '.openclaw');
    const appState = path.join(root, 'app-state');

    const hashData = await writePasswordHash(TEST_PASSPHRASE, {
      outFile: path.join(bundle, 'services/mode-architecture/metre-lock-hash.json'),
      N: 16384,
    });
    assert.equal(hashData.record.configured, true);

    put(path.join(bundle, 'VERSION'), '9.9.9\n');
    put(path.join(bundle, 'build-info.json'), JSON.stringify({guard: true, channel: 'release', version: '9.9.9'}));
    put(path.join(bundle, 'services/mode-architecture/metre-lock.mjs'), fs.readFileSync(path.join(ROOT, 'services/mode-architecture/metre-lock.mjs'), 'utf8'));
    put(path.join(bundle, 'services/mode-architecture/index.mjs'), '// release mode-architecture');
    put(path.join(bundle, 'personas/chat/SOUL.md'), 'official chat');
    put(path.join(bundle, 'installer/guard/guard.mjs'), fs.readFileSync(path.join(ROOT, 'installer/guard/guard.mjs'), 'utf8'));

    const manifest = buildManifest(bundle, {commit: 'b'.repeat(40)});
    assert.ok(manifest.files['services/mode-architecture/metre-lock-hash.json'], 'metre-lock-hash.json included in guard manifest');
    assert.ok(manifest.files['services/mode-architecture/metre-lock.mjs'], 'metre-lock.mjs included in guard manifest');
    fs.writeFileSync(path.join(bundle, 'guard-manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(bundle, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(bundle, 'guard-manifest.json')), keyPem));

    // Suppose someone tampers the hash file AND deletes metre-lock.mjs in ~/.openclaw/extensions -> guard startup restores BOTH!
    put(path.join(state, 'extensions/pinkie-mode-architecture/metre-lock-hash.json'), '{"configured":true,"algorithm":"scrypt","hash":"evil"}');
    assert.equal(fs.existsSync(path.join(state, 'extensions/pinkie-mode-architecture/metre-lock.mjs')), false);
    const res = startup({bundle, home, appState, key: pub});
    assert.equal(res.trusted, true);
    assert.equal(res.nonOfficial, false);
    assert.equal(fs.existsSync(path.join(state, 'extensions/pinkie-mode-architecture/metre-lock.mjs')), true, 'deleted metre-lock.mjs restored');
    const restoredHash = JSON.parse(fs.readFileSync(path.join(state, 'extensions/pinkie-mode-architecture/metre-lock-hash.json'), 'utf8'));
    assert.equal(restoredHash.hash, hashData.record.hash);

    // MetreLock reading the restored release bundle enforces lock + persists unlock into <appState>/guard/metre-lock.json
    const releaseLock = new MetreLock({
      mode: {enabled: true, channel: 'release', version: '9.9.9', bundleRoot: bundle, source: 'build-info'},
      pinkieStateRoot: appState,
      machineId: 'darwin:sim-mac',
    });
    assert.equal(releaseLock.status().locked, true);
    assert.equal((await releaseLock.unlock(TEST_PASSPHRASE)).ok, true);
    assert.equal(fs.existsSync(path.join(appState, 'guard/metre-lock.json')), true);

    // Simulated dev bundle ignores lock completely
    const devBundle = path.join(root, 'DevSuperPinkie');
    put(path.join(devBundle, 'build-info.json'), JSON.stringify({guard: false, channel: 'dev', version: '9.9.9'}));
    assert.deepEqual(startup({bundle: devBundle, home, appState, key: pub}), {guard: false});
    const devLock = new MetreLock({
      mode: {enabled: false, channel: 'dev', version: '9.9.9', bundleRoot: devBundle, source: 'build-info'},
      pinkieStateRoot: appState,
      machineId: 'darwin:sim-mac',
    });
    assert.equal(devLock.status().required, false);
    assert.equal(devLock.status().locked, false);
    assert.equal(devLock.status().unlocked, true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('frontend metre-lock module enforces prompts, cooldowns, dock curtains, and cold-start exits cleanly', async () => {
  const head = sharedUi({entries: ['laolao-metre-lock.css', 'laolao-metre-lock.js', 'laolao-mode-switcher.js'], assets: []});
  assert.match(head, /laolao-metre-lock\.css\?v=metrelock1/);
  assert.match(head, /laolao-metre-lock\.js\?v=metrelock1/);
  assert.ok(head.indexOf('laolao-metre-lock.js') < head.indexOf('laolao-mode-switcher.js'));

  const lockJs = fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-metre-lock.js'), 'utf8');
  const switcherJs = fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-mode-switcher.js'), 'utf8');
  const sidebarJs = fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-sidebar.js'), 'utf8');
  const nativeJs = fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-native.js'), 'utf8');
  const settingsJs = fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-settings-user.js'), 'utf8');

  assert.match(switcherJs, /ensureModeUnlocked/);
  assert.match(switcherJs, /__pinkieMetreLock\?\.ensureUnlocked/);
  assert.match(sidebarJs, /__pinkieMetreLock\?\.isKnownLocked/);
  assert.match(nativeJs, /__pinkieMetreLock\?\.ensureUnlocked/);
  assert.match(settingsJs, /开发者模式/);
  assert.match(settingsJs, /重新上锁/);

  // Packaging parity checks
  assert.match(fs.readFileSync(path.join(ROOT, 'app/super_pinkie.py'), 'utf8'), /apply-metre-lock\.mjs/);
  assert.match(fs.readFileSync(path.join(ROOT, 'installer/windows/apply-theme.ps1'), 'utf8'), /apply-metre-lock\.mjs/);
  assert.match(fs.readFileSync(path.join(ROOT, 'patch/apply-all.mjs'), 'utf8'), /apply-metre-lock\.mjs/);
  assert.match(fs.readFileSync(path.join(ROOT, 'services/mode-architecture/setup.py'), 'utf8'), /metre-lock\.mjs/);
  assert.match(fs.readFileSync(path.join(ROOT, 'services/mode-architecture/setup.py'), 'utf8'), /metre-lock-hash\.json/);
  assert.match(fs.readFileSync(path.join(ROOT, 'installer/macos/apply-theme.sh'), 'utf8'), /metre-lock\.mjs/);
  assert.match(fs.readFileSync(path.join(ROOT, 'desktop/macos/build.sh'), 'utf8'), /metre-lock\.mjs metre-lock-hash\.json/);

  function runFrontend(href, {statusSequence, unlockHandler, lockHandler, initialAttrs = {}, docked = false} = {}) {
    let timerSeq = 1;
    let fakeNow = Date.now();
    const listeners = new Map();
    const storage = new Map();
    let dockClosed = false;
    let historyHref = href;
    const urlObj = new URL(href);

    class FakeEl {
      constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.className = '';
        this.children = [];
        this.parentNode = null;
        this.attrs = new Map();
        this.listeners = new Map();
        this.value = '';
        this.type = '';
        this.disabled = false;
        this.textContent = '';
      }
      setAttribute(k, v) { this.attrs.set(k, String(v)); }
      getAttribute(k) { return this.attrs.get(k) ?? null; }
      removeAttribute(k) { this.attrs.delete(k); }
      append(...nodes) {
        for (const n of nodes) {
          if (n && typeof n === 'object') {
            n.parentNode = this;
            this.children.push(n);
          }
        }
      }
      remove() {
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter(c => c !== this);
          this.parentNode = null;
        }
      }
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      }
      removeEventListener() {}
      focus() {}
      async click() {
        for (const fn of this.listeners.get('click') || []) await fn({target: this, preventDefault() {}});
      }
      async submit() {
        for (const fn of this.listeners.get('submit') || []) await fn({target: this, preventDefault() {}});
      }
      findAll(pred) {
        const out = [];
        if (pred(this)) out.push(this);
        for (const c of this.children) out.push(...c.findAll(pred));
        return out;
      }
    }

    const htmlEl = new FakeEl('html');
    for (const [k, v] of Object.entries(initialAttrs)) htmlEl.setAttribute(k, v);
    if (docked) htmlEl.setAttribute('data-laolao-workspace-dock', '1');
    const bodyEl = new FakeEl('body');

    const document = {
      readyState: 'complete',
      documentElement: htmlEl,
      body: bodyEl,
      createElement: tag => new FakeEl(tag),
      querySelector: sel => (sel === 'openclaw-app-shell' ? null : null),
      addEventListener(type, fn) {
        if (!listeners.has(`doc:${type}`)) listeners.set(`doc:${type}`, []);
        listeners.get(`doc:${type}`).push(fn);
      },
      removeEventListener() {},
    };

    const window = {
      document,
      location: urlObj,
      history: {
        state: null,
        replaceState(_s, _t, nextUrl) {
          historyHref = new URL(nextUrl, urlObj).href;
          window.location = new URL(historyHref);
        },
      },
      localStorage: {
        getItem: k => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
      },
      addEventListener(type, fn) {
        if (!listeners.has(`win:${type}`)) listeners.set(`win:${type}`, []);
        listeners.get(`win:${type}`).push(fn);
      },
      dispatchEvent() { return true; },
      requestAnimationFrame: fn => fn(),
      setTimeout: (fn) => timerSeq++,
      setInterval: () => timerSeq++,
      clearInterval: () => {},
      webkit: {
        messageHandlers: {
          laolaoWorkspaceDock: {
            postMessage(msg) { if (msg?.action === 'close') dockClosed = true; },
          },
        },
      },
      __laolaoSidebar: {
        async gwRequest(method, params) {
          if (method === 'pinkie.guard.metreStatus') {
            return statusSequence.length > 1 ? statusSequence.shift() : statusSequence[0];
          }
          if (method === 'pinkie.guard.metreUnlock') return unlockHandler(params);
          if (method === 'pinkie.guard.metreLock') return lockHandler(params);
          throw new Error(`unexpected rpc ${method}`);
        },
      },
      Date: Object.assign(Date, {now: () => fakeNow}),
    };
    window.window = window;

    const context = {
      window,
      document,
      location: window.location,
      history: window.history,
      localStorage: window.localStorage,
      URL,
      URLSearchParams,
      CustomEvent: class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o.detail; } },
      PopStateEvent: class PopStateEvent { constructor(t) { this.type = t; } },
    };
    vm.runInNewContext(lockJs, context);
    return {
      api: window.__pinkieMetreLock,
      bodyEl,
      htmlEl,
      storage,
      getHistoryHref: () => historyHref,
      isDockClosed: () => dockClosed,
    };
  }

  // Case 1: dev build opens Metre immediately without prompt.
  const devEnv = runFrontend('http://127.0.0.1:18789/chat', {
    statusSequence: [{required: false, unlocked: true, locked: false, configured: true}],
  });
  assert.equal(await devEnv.api.ensureUnlocked(), true);
  assert.equal(devEnv.bodyEl.findAll(el => el.className.includes('laolao-metre-lock-dialog')).length, 0);

  // Case 2: release build locked -> cancel returns false; wrong then right password unlocks -> returns true.
  const lockedStatus = {required: true, unlocked: false, locked: true, configured: true, remainingAttempts: 5, lockedUntil: 0, retryAfterMs: 0};
  const relCancel = runFrontend('http://127.0.0.1:18789/chat', {
    statusSequence: [lockedStatus],
  });
  const cancelPromise = relCancel.api.ensureUnlocked();
  await new Promise(r => setTimeout(r, 0));
  const cancelBtn = relCancel.bodyEl.findAll(el => el.tagName === 'BUTTON' && el.type === 'button')[0];
  assert.ok(cancelBtn);
  await cancelBtn.click();
  assert.equal(await cancelPromise, false);

  const relUnlock = runFrontend('http://127.0.0.1:18789/chat', {
    statusSequence: [lockedStatus],
    unlockHandler: async ({password}) => {
      if (password !== TEST_PASSPHRASE) {
        return {ok: false, code: 'WRONG_PASSWORD', error: '开发者密码不正确。', remainingAttempts: 4, locked: true, unlocked: false, configured: true, required: true};
      }
      return {ok: true, required: true, locked: false, unlocked: true, configured: true, failures: 0, lockedUntil: 0, retryAfterMs: 0};
    },
  });
  const unlockPromise = relUnlock.api.ensureUnlocked();
  await new Promise(r => setTimeout(r, 0));
  const inputEl = relUnlock.bodyEl.findAll(el => el.tagName === 'INPUT')[0];
  const formEl = relUnlock.bodyEl.findAll(el => el.tagName === 'FORM')[0];
  const errEl = relUnlock.bodyEl.findAll(el => el.className.includes('laolao-metre-lock-dialog__error'))[0];
  inputEl.value = 'wrong';
  await formEl.submit();
  assert.match(errEl.textContent, /还剩 4 次/);
  inputEl.value = TEST_PASSPHRASE;
  await formEl.submit();
  assert.equal(await unlockPromise, true);

  // Case 2b: Cooldown state disables input + shows remaining countdown.
  const cooldownEnv = runFrontend('http://127.0.0.1:18789/chat', {
    statusSequence: [{...lockedStatus, failures: 5, remainingAttempts: 0, lockedUntil: Date.now() + 125_000, retryAfterMs: 125_000}],
  });
  const cooldownPromise = cooldownEnv.api.ensureUnlocked();
  await new Promise(r => setTimeout(r, 0));
  const cdInput = cooldownEnv.bodyEl.findAll(el => el.tagName === 'INPUT')[0];
  const cdSubmit = cooldownEnv.bodyEl.findAll(el => el.tagName === 'BUTTON' && el.type === 'submit')[0];
  const cdErr = cooldownEnv.bodyEl.findAll(el => el.className.includes('laolao-metre-lock-dialog__error'))[0];
  assert.equal(cdInput.disabled, true);
  assert.equal(cdSubmit.disabled, true);
  assert.match(cdErr.textContent, /输错次数过多，请等/);
  const cdCancel = cooldownEnv.bodyEl.findAll(el => el.tagName === 'BUTTON' && el.type === 'button')[0];
  await cdCancel.click();
  assert.equal(await cooldownPromise, false);

  // Case 3: Docked Metre view gets locked curtain & 关闭分屏 button; regular Metre exits to chat on relock.
  const dockEnv = runFrontend('http://127.0.0.1:18789/chat?session=agent:metre:main&laolao-dock=1', {
    statusSequence: [lockedStatus],
    initialAttrs: {'data-laolao-mode': 'metre'},
    docked: true,
  });
  await dockEnv.api.enforcePageLock();
  assert.equal(dockEnv.bodyEl.findAll(el => el.className.includes('laolao-metre-lock-curtain')).length, 1);
  const closeSplitBtn = dockEnv.bodyEl.findAll(el => el.tagName === 'BUTTON' && el.type === 'button')[0];
  await closeSplitBtn.click();
  assert.equal(dockEnv.isDockClosed(), true);

  const normalEnv = runFrontend('http://127.0.0.1:18789/chat?session=agent:metre:main', {
    statusSequence: [{required: true, unlocked: true, locked: false, configured: true}],
    lockHandler: async () => lockedStatus,
    initialAttrs: {'data-laolao-mode': 'metre'},
  });
  await normalEnv.api.lock();
  assert.equal(normalEnv.storage.get('laolao:active-mode'), 'chat');
  assert.equal(normalEnv.htmlEl.getAttribute('data-laolao-mode'), 'chat');
  assert.match(normalEnv.getHistoryHref(), /session=agent%3Amain%3Amain/);

  // Case 4: Relocking from /settings keeps the user on /settings while resetting active mode to chat.
  const settingsEnv = runFrontend('http://127.0.0.1:18789/settings', {
    statusSequence: [{required: true, unlocked: true, locked: false, configured: true}],
    lockHandler: async () => lockedStatus,
    initialAttrs: {'data-laolao-mode': 'metre'},
  });
  await settingsEnv.api.lock();
  assert.equal(settingsEnv.storage.get('laolao:active-mode'), 'chat');
  assert.equal(settingsEnv.htmlEl.getAttribute('data-laolao-mode'), 'chat');
  assert.equal(settingsEnv.getHistoryHref(), 'http://127.0.0.1:18789/settings');
});
