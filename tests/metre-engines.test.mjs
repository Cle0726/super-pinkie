import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EngineService, assetName, engineRoot, errorLine, isAscii, parseJsonOutput, parseSums, readProviders} from '../services/mode-architecture/engines.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-engines-'));

test('the engine lives under a plain-ASCII folder even when the user name is Chinese', () => {
  assert.equal(engineRoot({stateDir: 'C:\\Users\\kk\\.openclaw', env: {}, platform: 'win32'}), path.join('C:\\Users\\kk\\.openclaw', 'pinkie', 'engines'));
  const root = engineRoot({stateDir: 'C:\\Users\\碧琪\\.openclaw', env: {LOCALAPPDATA: 'C:\\Users\\碧琪\\AppData\\Local', ProgramData: 'C:\\ProgramData'}, platform: 'win32'});
  assert.ok(isAscii(root), root);
  assert.equal(root, path.join('C:\\ProgramData', 'SuperPinkie', 'engines'));
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

function fakeInstall(root, {corrupt = false} = {}) {
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
  assert.deepEqual(Object.keys(methods).sort(), ['pinkie.engines.enable', 'pinkie.engines.open', 'pinkie.engines.status', 'pinkie.engines.threads']);
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
  await assert.rejects(methods['pinkie.engines.threads']({}), /没有在运行/);
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
