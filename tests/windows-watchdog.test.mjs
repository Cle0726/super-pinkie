// The Windows package builds the mode plugin from the repository's
// services/mode-architecture with the Mac snapshot laid over it
// (build-win.ps1). Assemble it the same way and check which failed turns the
// watchdog retries.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-windows-plugin-'));
fs.cpSync(path.join(root, 'services/mode-architecture'), plugin, {recursive: true});
fs.cpSync(path.join(root, 'desktop/windows/mac-runtime/services/mode-architecture'), plugin, {recursive: true});
process.on('exit', () => fs.rmSync(plugin, {recursive: true, force: true}));
const {UpstreamWatchdog, WatchdogJobStore, localSetupFailure} = await import(pathToFileURL(path.join(plugin, 'index.mjs')).href);

const workflow = {
  enqueueNextTurnInjection: async () => ({}),
  unscheduleSessionTurnsByTag: async () => ({}),
  scheduleSessionTurn: async () => ({}),
};
const key = 'agent:main:main';
const ctx = {sessionKey: key, agentId: 'main'};

function watchdog() {
  const logs = [];
  const logger = {info: line => logs.push(line), warn: line => logs.push(line)};
  const dog = new UpstreamWatchdog({session: {workflow}, logger}, () => '', async () => ({stdout: '{}'}), '',
    () => ({pending: 0, quietForMs: Infinity}), new WatchdogJobStore(''));
  return {dog, logs};
}

async function fail(dog, error, times) {
  for (let i = 0; i < times; i += 1) await dog.agentEnded({success: false, error, runId: `run-${i}`}, ctx);
}

test('a stream that breaks off is continued automatically', async () => {
  const {dog, logs} = watchdog();
  await fail(dog, 'terminated', 3);
  assert.equal(dog.attempts.get(key), 3);
  assert.deepEqual(dog.status(key), {state: 'retrying', attempt: 3});
  assert.match(logs.join('\n'), /watchdog retry scheduled .*attempt=3 reason=terminated/);
});

for (const [name, error, message] of [
  ['a missing plugin file', "Cannot find module './vendor/reading-node.mjs' imported from C:\\碧琪\\index.mjs", /缺少运行需要的文件/],
  ['a missing program', 'spawn /usr/bin/python3 ENOENT', /缺少运行需要的文件/],
  ['a core plugin that never loaded', 'unknown method: pinkie.plan.get', /核心插件没有完整加载/],
  ['a model URL that does not exist', '404 404 page not found', /404/],
]) test(`${name} is reported, not retried`, async () => {
  const {dog, logs} = watchdog();
  await fail(dog, error, 1);
  assert.equal(dog.attempts.get(key) || 0, 0);
  const status = dog.status(key);
  assert.equal(status.state, 'stopped');
  assert.equal(status.kind, 'setup');
  assert.match(status.message, message);
  assert.match(logs.join('\n'), /watchdog not retrying .*kind=setup/);
});

test('a refused local port gets two quick tries, then is reported', async () => {
  const {dog} = watchdog();
  const error = 'Connection error. connect ECONNREFUSED 127.0.0.1:1467';
  assert.equal(localSetupFailure(error, 0), '');
  await fail(dog, error, 2);
  assert.equal(dog.status(key).state, 'retrying');
  await fail(dog, error, 1);
  assert.equal(dog.status(key).state, 'stopped');
  assert.match(dog.status(key).message, /连不上模型服务/);
});

test('a lasting outage stops after 30 attempts and says so', async () => {
  const {dog} = watchdog();
  await fail(dog, 'terminated', 30);
  assert.equal(dog.status(key).state, 'retrying');
  await fail(dog, 'terminated', 1);
  assert.equal(dog.status(key).kind, 'exhausted');
  assert.match(dog.status(key).message, /连续重试 30 次/);
});

test('a later successful turn or a new message clears the notice', async () => {
  const {dog} = watchdog();
  await fail(dog, '404 page not found', 1);
  await dog.agentEnded({success: true, runId: 'ok'}, ctx);
  assert.deepEqual(dog.status(key), {state: 'idle'});
  await fail(dog, '404 page not found', 1);
  dog.beforeModelResolve({prompt: '再试一次'}, ctx);
  assert.deepEqual(dog.status(key), {state: 'idle'});
});
