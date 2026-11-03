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
const {UpstreamWatchdog, WatchdogJobStore, CleKkSupervisor, CleKkAuditLog, localSetupFailure} = await import(pathToFileURL(path.join(plugin, 'index.mjs')).href);

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

test('a failed final stream is retried even when OpenClaw marks the run successful', async () => {
  const {dog} = watchdog();
  const retried = await dog.agentEnded({success: true, runId: 'run-1', messages: [
    {role: 'user', content: '你好'},
    {role: 'assistant', content: [{type: 'text', text: '半句话'}], stopReason: 'error', errorMessage: 'terminated'},
  ]}, ctx);
  assert.equal(retried, true);
  assert.equal(dog.status(key).state, 'retrying');
});

test('an older failed message does not cause a completed reply to be retried', async () => {
  const {dog} = watchdog();
  const retried = await dog.agentEnded({success: true, runId: 'run-2', messages: [
    {role: 'assistant', stopReason: 'error', errorMessage: 'terminated'},
    {role: 'assistant', stopReason: 'stop', content: [{type: 'text', text: '回复完成'}]},
  ]}, ctx);
  assert.equal(retried, false);
  assert.equal(dog.status(key).state, 'idle');
});

test('a host-success failed message still reports a missing module without retrying', async () => {
  const {dog} = watchdog();
  const retried = await dog.agentEnded({success: true, runId: 'run-1', messages: [
    {message: {role: 'assistant', stopReason: 'error', errorMessage: "Cannot find module './vendor/reading-node.mjs'"}},
  ]}, ctx);
  assert.equal(retried, false);
  assert.equal(dog.status(key).kind, 'setup');
});

test('a host-success 404 stops instead of being called a recovered turn', async () => {
  const {dog} = watchdog();
  await dog.agentEnded({success: true, runId: 'run-1', messages: [
    {role: 'assistant', stopReason: 'error', errorMessage: '404 page not found'},
  ]}, ctx);
  assert.equal(dog.status(key).kind, 'setup');
  assert.match(dog.status(key).message, /404/);
});

test('a host-success connection failure keeps the two-retry bound', async () => {
  const {dog} = watchdog();
  const event = {success: true, messages: [{role: 'assistant', stopReason: 'error', errorMessage: 'Connection error.'}]};
  await dog.agentEnded({...event, runId: 'run-1'}, ctx);
  await dog.agentEnded({...event, runId: 'run-2'}, ctx);
  assert.equal(dog.status(key).state, 'retrying');
  await dog.agentEnded({...event, runId: 'run-3'}, ctx);
  assert.equal(dog.status(key).kind, 'setup');
});

test('a partial failed reply does not start an integrity retry', () => {
  const supervisor = new CleKkSupervisor({audit: new CleKkAuditLog('')});
  supervisor.begin({prompt: '测试一下：请回复一句话。'}, ctx);
  const failed = {role: 'assistant', stopReason: 'error', errorMessage: 'terminated',
    content: [{type: 'text', text: '碧琪先说到一半'}]};
  assert.equal(supervisor.beforeMessageWrite({message: failed}, ctx), undefined);
  assert.equal(supervisor.hasPending(key), false);
  const completed = {...failed, stopReason: 'stop'};
  assert.deepEqual(supervisor.beforeMessageWrite({message: completed}, ctx), {block: true});
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

test('a connection that never opens ("Connection error.") gets two tries, then is reported', async () => {
  const {dog} = watchdog();
  await fail(dog, 'Connection error.', 2);
  assert.equal(dog.status(key).state, 'retrying');
  await fail(dog, 'Connection error.', 1);
  assert.equal(dog.status(key).state, 'stopped');
});

test('a resend the local gateway CLI refuses is not rescheduled forever', async () => {
  const logs = [];
  const runner = async () => {
    const error = new Error('Command failed: node openclaw.mjs gateway call chat.send');
    error.stderr = 'Gateway call failed: GatewayCredentialsRequiredError: gateway chat.send requires credentials before opening a websocket';
    throw error;
  };
  const dog = new UpstreamWatchdog({session: {workflow}, logger: {info: l => logs.push(l), warn: l => logs.push(l)}},
    () => '', runner, 'openclaw.mjs', () => ({pending: 0, quietForMs: Infinity}), new WatchdogJobStore(''));
  await dog.agentEnded({success: false, error: 'terminated', runId: 'run-1'}, ctx);
  clearTimeout(dog.timers.get(key));
  dog.timers.delete(key);
  await dog.dispatchImmediate({sessionKey: key, agentId: 'main', runId: 'run-1', attempt: 1, tag: 't'});
  assert.equal(dog.status(key).kind, 'dispatch');
  assert.equal(dog.timers.has(key), false);
  assert.match(logs.join('\n'), /watchdog not retrying .*kind=dispatch/);
});

test('JSON error replies from the gateway are bounded too', async () => {
  const dog = new UpstreamWatchdog({session: {workflow}}, () => '',
    async () => ({stdout: JSON.stringify({status: 'timeout', error: 'gateway is draining'})}),
    'openclaw.mjs', () => ({pending: 0, quietForMs: Infinity}), new WatchdogJobStore(''));
  await dog.agentEnded({success: false, error: 'terminated', runId: 'run-1'}, ctx);
  for (let i = 0; i < 8; i += 1) {
    clearTimeout(dog.timers.get(key));
    dog.timers.delete(key);
    await dog.dispatchImmediate({sessionKey: key, agentId: 'main', runId: 'run-1', attempt: 1, tag: 't'});
  }
  assert.equal(dog.status(key).kind, 'dispatch');
  assert.equal(dog.timers.has(key), false);
});

test('a JSON credentials error stops immediately', async () => {
  const dog = new UpstreamWatchdog({session: {workflow}}, () => '',
    async () => ({stdout: JSON.stringify({status: 'error', error: 'GatewayCredentialsRequiredError'})}),
    'openclaw.mjs', () => ({pending: 0, quietForMs: Infinity}), new WatchdogJobStore(''));
  await dog.agentEnded({success: false, error: 'terminated', runId: 'run-1'}, ctx);
  clearTimeout(dog.timers.get(key));
  dog.timers.delete(key);
  await dog.dispatchImmediate({sessionKey: key, agentId: 'main', runId: 'run-1', attempt: 1, tag: 't'});
  assert.equal(dog.status(key).kind, 'dispatch');
  assert.equal(dog.timers.has(key), false);
});
