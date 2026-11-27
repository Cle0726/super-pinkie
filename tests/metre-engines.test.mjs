import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EngineService, adoptSharedEngineFiles, archiveListCommand, archiveMemberEscapes, assetName, engineRoot, engineUserKey, sharedEngineRoot, errorLine, isAscii, parseJsonOutput, parseSums, readProviders} from '../services/mode-architecture/engines.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-engines-'));

test('the engine lives under a plain-ASCII folder even when the user name is Chinese', () => {
  assert.equal(engineRoot({stateDir: 'C:\\Users\\kk\\.openclaw', env: {}, platform: 'win32'}), path.join('C:\\Users\\kk\\.openclaw', 'pinkie', 'engines'));
  const env = {LOCALAPPDATA: 'C:\\Users\\碧琪\\AppData\\Local', ProgramData: 'C:\\ProgramData', USERNAME: '碧琪', USERDOMAIN: 'DESKTOP-1'};
  const root = engineRoot({stateDir: 'C:\\Users\\碧琪\\.openclaw', env, platform: 'win32'});
  assert.ok(isAscii(root), root);
  assert.equal(root, `${path.join('C:\\ProgramData', 'SuperPinkie', 'engines')}-${engineUserKey(env)}`);
  assert.match(engineUserKey(env), /^[0-9a-f]{12}$/);
});

// #343 起 App 不再提权：以前提权版建的共用 C:\ProgramData\SuperPinkie\engines 归 Administrators，
// 普通身份写不进；每个账号自己的子目录归自己，也看不到别人的引擎登录状态。
test('the ProgramData fallback is one folder per Windows account, never the old shared one', () => {
  const base = {LOCALAPPDATA: 'C:\\Users\\碧琪\\AppData\\Local', ProgramData: 'C:\\ProgramData'};
  const a = engineRoot({stateDir: 'C:\\Users\\碧琪\\.openclaw', env: {...base, USERNAME: '碧琪', USERDOMAIN: 'PC'}, platform: 'win32'});
  const b = engineRoot({stateDir: 'C:\\Users\\琪琪\\.openclaw', env: {...base, USERNAME: '琪琪', USERDOMAIN: 'PC'}, platform: 'win32'});
  const c = engineRoot({stateDir: 'C:\\Users\\碧琪\\.openclaw', env: {...base, USERNAME: '碧琪', USERDOMAIN: 'OFFICE'}, platform: 'win32'});
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  for (const root of [a, b, c]) assert.notEqual(root, sharedEngineRoot(base));
  // 同一个账号每次都落到同一个目录（大小写不敏感，Windows 账号名本来就不分大小写）。
  assert.equal(engineUserKey({USERNAME: 'KK', USERDOMAIN: 'PC'}), engineUserKey({USERNAME: 'kk', USERDOMAIN: 'pc'}));
  // 英文用户名仍然用家目录，不碰 ProgramData。
  assert.equal(engineRoot({stateDir: 'C:\\Users\\kk\\.openclaw', env: {...base, USERNAME: 'kk'}, platform: 'win32'}), path.join('C:\\Users\\kk\\.openclaw', 'pinkie', 'engines'));
});

test('moving to the per-account folder carries the switch and role picks over once, never the engine or its sign-in', () => {
  const programData = tmp();
  const env = {ProgramData: programData, USERNAME: '碧琪', USERDOMAIN: 'PC'};
  const shared = sharedEngineRoot(env);
  fs.mkdirSync(path.join(shared, 'home'), {recursive: true});
  fs.mkdirSync(path.join(shared, 'versions', '0.1.11'), {recursive: true});
  fs.writeFileSync(path.join(shared, 'prefs.json'), '{"enabled":true}');
  fs.writeFileSync(path.join(shared, 'players.json'), '{"a":1}');
  fs.writeFileSync(path.join(shared, 'home', 'auth.json'), 'secret');
  const root = `${shared}-${engineUserKey(env)}`;
  assert.deepEqual(adoptSharedEngineFiles(root, {env, platform: 'win32'}).sort(), ['players.json', 'prefs.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'prefs.json'), 'utf8')).enabled, true);
  assert.equal(fs.existsSync(path.join(root, 'home')), false);
  assert.equal(fs.existsSync(path.join(root, 'versions')), false);
  // 已有的不覆盖：之后用户在自己目录里关掉，下次启动不会被共用目录的旧开关改回去。
  fs.writeFileSync(path.join(root, 'prefs.json'), '{"enabled":false}');
  assert.deepEqual(adoptSharedEngineFiles(root, {env, platform: 'win32'}), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'prefs.json'), 'utf8')).enabled, false);
  // 只认按账号的 ProgramData 目录；家目录 / LOCALAPPDATA / 非 Windows 一律不搬。
  const other = path.join(tmp(), 'engines');
  assert.deepEqual(adoptSharedEngineFiles(other, {env, platform: 'win32'}), []);
  assert.deepEqual(adoptSharedEngineFiles(root, {env, platform: 'linux'}), []);
  assert.equal(fs.existsSync(other), false);
});

test('an unreadable or missing shared folder never stops the engine service from loading', () => {
  const env = {ProgramData: tmp(), USERNAME: '碧琪', USERDOMAIN: 'PC'};
  const root = `${sharedEngineRoot(env)}-${engineUserKey(env)}`;
  assert.deepEqual(adoptSharedEngineFiles(root, {env, platform: 'win32'}), []);
  // 共用目录里是个读不了的东西（这里用同名目录代替拒绝访问的文件）：跳过，不抛。
  fs.mkdirSync(path.join(sharedEngineRoot(env), 'prefs.json'), {recursive: true});
  assert.doesNotThrow(() => adoptSharedEngineFiles(root, {env, platform: 'win32'}));
  assert.equal(fs.existsSync(path.join(root, 'prefs.json')), false);
});

test('release asset names follow the official T3 Code release for supported machines only', () => {
  assert.equal(assetName('0.1.11', 'win32', 'x64'), 't3-0.1.11-win32-x64.zip');
  assert.equal(assetName('0.1.11', 'darwin', 'arm64'), 't3-0.1.11-darwin-arm64.tar.gz');
  assert.equal(assetName('0.1.11', 'darwin', 'x64'), '');
});

test('checksum lines and JSON output with surrounding noise are read reliably', () => {
  const sum = 'a'.repeat(64);
  assert.equal(parseSums(`${'b'.repeat(64)}  other.zip\n${sum} *t3-0.1.11-win32-x64.zip\n`, 't3-0.1.11-win32-x64.zip'), sum);
  assert.equal(parseSums('junk', 'x.zip'), '');
  assert.deepEqual(parseJsonOutput('note\n{"threadId":"t1","status":"failed"}\nThread t1 stopped {x}'), {threadId: 't1', status: 'failed'});
  assert.equal(parseJsonOutput('no json here'), null);
  assert.equal(errorLine("[20:06:01.766] ERROR (#2): ProjectAlreadyExistsError: An active project already exists for 'F:\\w'.\n    at runProjectMutation (x)"),
    "ProjectAlreadyExistsError: An active project already exists for 'F:\\w'.");
  assert.equal(errorLine('    at a (b)\nplain failure'), 'plain failure');
});

// 假 Windows：tar 不在 PATH 里（像 runProcess 遇到 ENOENT 那样返回 127），PowerShell 读 zip 目录时返回 entries。
function fakeInstall(root, {corrupt = false, entries = ['t3-win/', 't3-win/t3.exe', 't3-win/resources/app.asar']} = {}) {
  const calls = [];
  const payload = Buffer.from('fake release');
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'curl') {
      const out = args[args.indexOf('-o') + 1];
      if (out.endsWith('SHA256SUMS')) {
        const digest = crypto.createHash('sha256').update(corrupt ? Buffer.from('other') : payload).digest('hex');
        fs.writeFileSync(out, `${digest}  t3-0.1.11-win32-x64.zip\n`);
      } else fs.writeFileSync(out, payload);
      return {code: 0, stdout: '', stderr: ''};
    }
    if (file === 'tar') return {code: 127, stdout: '', stderr: 'spawn tar ENOENT'};
    if (file === 'powershell' && /ZipFile\]::OpenRead/.test(args.at(-1))) return {code: 0, stdout: entries.join('\r\n') + '\r\n', stderr: ''};
    if (file === 'powershell') {
      const dest = args.at(-1).match(/-DestinationPath '([^']+)'/)[1];
      fs.mkdirSync(path.join(dest, 't3-win'), {recursive: true});
      fs.writeFileSync(path.join(dest, 't3-win', 't3.exe'), 'exe');
      return {code: 0, stdout: '', stderr: ''};
    }
    return {code: 0, stdout: '', stderr: ''};
  };
  return {calls, service: new EngineService({root, platform: 'win32', arch: 'x64', exec, proxy: async () => 'http://127.0.0.1:7897'})};
}

test('install downloads through the local proxy, verifies SHA-256, extracts itself and cleans up', async () => {
  const root = tmp();
  const {calls, service} = fakeInstall(root);
  assert.deepEqual(await service.install(), {ok: true});
  assert.ok(service.installed());
  assert.equal(fs.readFileSync(service.exe, 'utf8'), 'exe');
  const curls = calls.filter(call => call[0] === 'curl');
  assert.equal(curls.length, 2);
  assert.ok(curls.every(call => call.includes('-x') && call.includes('http://127.0.0.1:7897')));
  assert.ok(curls[0].at(-1).startsWith('https://github.com/pingdotgg/t3code/releases/download/v0.1.11/'));
  assert.equal(fs.readdirSync(path.join(root, 'downloads')).length, 0, 'staging removed');
  assert.deepEqual(await service.install(), {ok: true, already: true});
});

test('a download that does not match the published checksum is refused and nothing is installed', async () => {
  const root = tmp();
  const {service} = fakeInstall(root, {corrupt: true});
  await assert.rejects(service.install(), /校验不对/);
  assert.equal(service.installed(), false);
  assert.equal(fs.readdirSync(path.join(root, 'downloads')).length, 0);
});

test('on Windows the zip entries are listed through PowerShell, so a missing tar does not break the install', async () => {
  const root = tmp();
  const {calls, service} = fakeInstall(root);
  assert.deepEqual(await service.install(), {ok: true});
  assert.ok(service.installed());
  assert.equal(calls.some(call => call[0] === 'tar'), false, 'tar is never called on Windows');
  const ps = calls.filter(call => call[0] === 'powershell');
  assert.equal(ps.length, 2);
  assert.match(ps[0].at(-1), /ZipFile\]::OpenRead/, 'entries are listed before unpacking');
  assert.match(ps[1].at(-1), /Expand-Archive/);
});

test('a Windows zip entry that leaves the extract directory is refused before Expand-Archive runs', async () => {
  const bad = ['..\\pwned.txt', '../pwned.txt', 't3-win\\..\\..\\pwned.txt', 'C:\\Windows\\pwned.txt', 'C:pwned.txt',
    '\\\\server\\share\\pwned.txt', '/etc/pwned', 't3-win\\...\\pwned.txt', 't3-win/.. /pwned.txt'];
  for (const entry of bad) {
    const root = tmp();
    const {calls, service} = fakeInstall(root, {entries: ['t3-win/', entry, 't3-win/t3.exe']});
    await assert.rejects(service.install(), /越界路径/, entry);
    assert.equal(service.installed(), false, entry);
    assert.equal(calls.some(call => call[0] === 'powershell' && /Expand-Archive/.test(call.at(-1))), false, entry);
    assert.equal(calls.some(call => call[0] === 'tar'), false, entry);
    assert.equal(fs.readdirSync(path.join(root, 'downloads')).length, 0, entry);
  }
});

test('archive member names: escapes in either slash style are caught, ordinary names pass', () => {
  for (const name of ['../x', '..\\x', 'a/../../x', 'a\\..\\x', '/abs', '\\abs', 'C:\\x', 'c:/x', 'C:x', '\\\\srv\\share\\x', '...\\x', 'a/.. /x']) {
    assert.equal(archiveMemberEscapes(name), true, name);
  }
  for (const name of ['', 't3', './t3', 't3-win/', 't3-win/t3.exe', 'a..b/c', '.hidden/x', 'x./y', 'resources/app.asar']) {
    assert.equal(archiveMemberEscapes(name), false, name);
  }
});

test('the listing command is PowerShell ZipFile on Windows and tar -tf elsewhere', () => {
  assert.deepEqual(archiveListCommand('linux', '/s/t3.tar.gz'), ['tar', ['-tf', '/s/t3.tar.gz']]);
  assert.deepEqual(archiveListCommand('darwin', '/s/t3.tar.gz'), ['tar', ['-tf', '/s/t3.tar.gz']]);
  const [file, args] = archiveListCommand('win32', "C:\\Pro'gram\\t3.zip");
  assert.equal(file, 'powershell');
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(args[3], /\[IO\.Compression\.ZipFile\]::OpenRead\('C:\\Pro''gram\\t3\.zip'\)/, 'single quotes in the path are doubled');
  assert.match(args[3], /\$ErrorActionPreference='Stop'/, 'an unreadable zip makes PowerShell exit non-zero');
  assert.match(args[3], /Dispose\(\)/);
});

function linuxDownload(root, onTar) {
  const calls = [];
  const payload = Buffer.from('fake release');
  const name = 't3-0.1.11-linux-x64.tar.gz';
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'curl') {
      const out = args[args.indexOf('-o') + 1];
      if (out.endsWith('SHA256SUMS')) fs.writeFileSync(out, `${crypto.createHash('sha256').update(payload).digest('hex')}  ${name}\n`);
      else fs.writeFileSync(out, payload);
      return {code: 0, stdout: '', stderr: ''};
    }
    if (file === 'tar') return onTar(args, calls);
    return {code: 0, stdout: '', stderr: ''};
  };
  return {calls, service: new EngineService({root, platform: 'linux', arch: 'x64', exec, proxy: async () => ''})};
}

test('an archive member that leaves the extract directory is refused before unpacking', async () => {
  const root = tmp();
  const outside = path.join(root, 'pwned.txt');
  const {calls, service} = linuxDownload(root, args => {
    if (args[0] === '-tf') return {code: 0, stdout: '../pwned.txt\nt3\n', stderr: ''};
    const dest = args[args.indexOf('-C') + 1];
    fs.mkdirSync(dest, {recursive: true});
    fs.writeFileSync(outside, 'PINKIE_LEAK');
    fs.writeFileSync(path.join(dest, 't3'), 'exe');
    return {code: 0, stdout: '', stderr: ''};
  });
  await assert.rejects(service.install(), /越界路径/);
  assert.equal(service.installed(), false);
  assert.equal(fs.existsSync(outside), false);
  assert.equal(calls.some(call => call[0] === 'tar' && call[1] === '-xzf'), false);
});

test('a symlink shipped as the engine binary is refused', async () => {
  const root = tmp();
  const evil = path.join(root, 'evil-bin');
  fs.writeFileSync(evil, 'evil');
  const {service} = linuxDownload(root, args => {
    if (args[0] === '-tf') return {code: 0, stdout: 't3\n', stderr: ''};
    const dest = args[args.indexOf('-C') + 1];
    fs.mkdirSync(dest, {recursive: true});
    fs.symlinkSync(evil, path.join(dest, 't3'));
    return {code: 0, stdout: '', stderr: ''};
  });
  await assert.rejects(service.install(), /不是普通文件|目录外面/);
  assert.equal(service.installed(), false);
  assert.equal(fs.existsSync(path.join(service.dir, 't3')), false);
});

test('provider status keeps sign-in state and plan but never the account e-mail', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, 'caches'));
  fs.writeFileSync(path.join(home, 'caches', 'codex.json'), JSON.stringify({displayName: 'Codex', instanceId: 'codex', driver: 'codex', enabled: true, installed: true,
    version: '0.171.0', status: 'ready', auth: {status: 'authenticated', type: 'chatgpt', label: 'ChatGPT Plus Subscription', email: 'someone@example.com'},
    models: [{slug: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', isDefault: false}]}));
  fs.writeFileSync(path.join(home, 'caches', 'claudeAgent.json'), JSON.stringify({displayName: 'Claude', instanceId: 'claudeAgent', enabled: false, installed: true,
    status: 'error', auth: {status: 'unauthenticated'}, message: 'Claude Code is not authenticated for a@b.co. Run `claude auth login`.', models: []}));
  const rows = readProviders(home);
  assert.equal(JSON.stringify(rows).includes('@'), false);
  assert.deepEqual(rows.map(row => [row.id, row.signedIn, row.plan]), [['codex', true, 'ChatGPT Plus Subscription'], ['claudeAgent', false, '']]);
  assert.match(rows[1].message, /claude auth login/);
});

test('threads are started through the CLI with the message on stdin, so quotes and newlines survive', async () => {
  const root = tmp();
  const seen = [];
  const service = new EngineService({root, platform: 'win32', arch: 'x64', proxy: async () => '', exec: async (file, args, options) => {
    seen.push({file, args, input: options.input});
    if (args[0] === 'project') return {code: 1, stdout: '', stderr: 'Project already exists'};
    return {code: 0, stdout: '{"threadId":"mcp:1","runId":"r1","status":"running"}', stderr: ''};
  }});
  fs.mkdirSync(service.dir, {recursive: true});
  fs.writeFileSync(service.exe, 'exe');
  const message = 'Fix "the bug"\nthen run tests';
  const result = await service.startThread({folder: 'F:\\work', message, provider: 'codex', model: 'gpt-5.6-luna', options: {reasoningEffort: 'high'}});
  assert.deepEqual(result, {threadId: 'mcp:1', runId: 'r1', status: 'running'});
  const start = seen.find(call => call.args[1] === 'start');
  assert.deepEqual(start.args, ['thread', 'start', 'F:\\work', '-', '--json', '--provider', 'codex', '--model', 'gpt-5.6-luna', '--option', 'reasoningEffort=high']);
  assert.equal(start.input, message);
  await assert.rejects(new EngineService({root: tmp(), platform: 'win32', arch: 'x64'}).show('x'), /还没有安装/);
});

test('gateway methods: off by default, the switch is remembered, nothing starts until it is on', async () => {
  const {registerEngines} = await import('../services/mode-architecture/engines.mjs');
  delete globalThis[Symbol.for('pinkie.engines.v1')];
  const base = tmp();
  const methods = {};
  const register = (api, name, fn) => { methods[name] = fn; };
  const service = registerEngines({logger: null}, {base, register});
  assert.deepEqual(Object.keys(methods).sort(), ['account', 'catalog', 'choose', 'diff', 'enable', 'install', 'open', 'organize', 'players', 'registry', 'respond', 'say', 'session', 'setup', 'signin', 'status', 'stop', 'thread', 'threads', 'turnOn'].map(name => 'pinkie.engines.' + name));
  assert.equal(service.root, path.join(base, 'engines'));
  const first = await methods['pinkie.engines.status']();
  assert.equal(first.enabled, false);
  assert.equal(first.running, false);
  let started = 0;
  service.start = async () => { started += 1; return service.status(); };
  service.stop = () => service.status();
  assert.equal((await methods['pinkie.engines.enable']({on: true})).enabled, true);
  assert.equal(started, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(base, 'engines', 'prefs.json'), 'utf8')).enabled, true);
  assert.equal((await methods['pinkie.engines.enable']({on: false})).enabled, false);
  // 11-23 真界面：菜单读 catalog 的 enabled 判断「外部引擎没打开」，必须是真开关，不能缺。
  assert.equal((await methods['pinkie.engines.catalog']({})).enabled, false);
  await methods['pinkie.engines.enable']({on: true});
  assert.equal((await methods['pinkie.engines.catalog']({})).enabled, true);
  await methods['pinkie.engines.enable']({on: false});
  await assert.rejects(methods['pinkie.engines.threads']({}), /没有在运行/);
  await assert.rejects(methods['pinkie.engines.registry']({action: 'search'}), /还没打开/, 'searching the registry needs the engines switched on');
  await assert.rejects(methods['pinkie.engines.open'](), /没有在运行/);
  service.status = () => ({running: true, url: 'http://127.0.0.1:3790'});
  let pairArgs = [];
  service.cli = async args => { pairArgs = args; return {pairUrl: 'http://127.0.0.1:3790/pair#token=abc', expiresAt: 'soon'}; };
  assert.deepEqual(await methods['pinkie.engines.open'](), {url: 'http://127.0.0.1:3790/pair#token=abc', expiresAt: 'soon'});
  assert.ok(pairArgs.includes('orchestration:operate') && !pairArgs.includes('terminal:operate') && !pairArgs.includes('access:write'));
  service.cli = async () => ({pairUrl: 'https://evil.example/pair#token=abc'});
  await assert.rejects(methods['pinkie.engines.open'](), /登录链接/);
  delete globalThis[Symbol.for('pinkie.engines.v1')];
});
