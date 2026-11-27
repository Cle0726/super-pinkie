import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// watchdog-runtime.mjs 里两个定时器回调把 dispatch 的 Promise 直接 void 掉（backlog P2）。
// UpstreamWatchdog.dispatchImmediateNow 在 try 之前调 activityFor，TierContinuation.dispatch
// 在 try 之前调 statusFor / activityFor；注入的回调一抛，Promise 就 reject，没人接 →
// unhandledRejection（网关进程直接退出）。
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-wd-reject-'));
process.env.PINKIE_STATE_ROOT = path.join(ROOT, 'state');
process.on('exit', () => fs.rmSync(ROOT, {recursive: true, force: true}));

const {UpstreamWatchdog, TierContinuation} = await import('../services/mode-architecture/watchdog-runtime.mjs');

function fakeApi(warnings) {
  return {
    logger: {info() {}, warn: message => warnings.push(String(message))},
    session: {workflow: {
      unscheduleSessionTurnsByTag: async () => {},
      scheduleSessionTurn: async () => {},
      enqueueNextTurnInjection: async () => {},
    }},
  };
}

const runner = async () => ({stdout: '{"status":"ok"}'});
const memoryStore = {set() {}, delete() {}, list() { return []; }, get() {}};
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

async function collectUnhandled(fn) {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await fn();
    await tick(200);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return unhandled;
}

test('UpstreamWatchdog：activityFor 抛错时立即重试的定时器不留 unhandledRejection，错误记进 warn', async () => {
  const warnings = [];
  const watchdog = new UpstreamWatchdog(fakeApi(warnings), () => '', runner, '/fake/cli.js',
    () => { throw new Error('activityFor boom'); }, memoryStore);
  const unhandled = await collectUnhandled(() => {
    assert.equal(watchdog.scheduleImmediate({sessionKey: 's1', agentId: 'a', runId: 'r1', attempt: 1, delayMs: 0, tag: 't'}), true);
  });
  for (const timer of watchdog.timers.values()) clearTimeout(timer);
  assert.deepEqual(unhandled.map(reason => String(reason?.message || reason)), []);
  assert.ok(warnings.some(message => message.includes('session=s1') && message.includes('activityFor boom')), warnings.join('\n'));
});

test('TierContinuation：statusFor 抛错时续跑定时器不留 unhandledRejection，错误记进 warn', async () => {
  const warnings = [];
  const tier = new TierContinuation(fakeApi(warnings), () => { throw new Error('statusFor boom'); },
    () => ({pending: 0, quietForMs: Infinity}), runner, '/fake/cli.js');
  const unhandled = await collectUnhandled(() => {
    tier.scheduleTimer({sessionKey: 's2', agentId: 'a', tag: 't', delayMs: 0});
  });
  for (const timer of tier.timers.values()) clearTimeout(timer);
  assert.deepEqual(unhandled.map(reason => String(reason?.message || reason)), []);
  assert.ok(warnings.some(message => message.includes('session=s2') && message.includes('statusFor boom')), warnings.join('\n'));
});
