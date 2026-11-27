// P3 复发测试（learning-game-exam.mjs 真题轮询）：GameExam 构造时开 60 s 轮询 + 15 s 首轮，原来没有 stop，
// 插件在同一进程里被再加载一次（registerLearningGame 再调一次）就多一组，服务停了也还在跑。
// 修复后：多次注册只留一组；服务 stop / gateway_stop 后计时器归零；再 start 只开一组。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore} from '../services/mode-architecture/learning.mjs';
import {registerLearningGame} from '../services/mode-architecture/learning-game.mjs';

// 记下本测试期间创建、还没被清掉（一次性的也还没触发）的计时器，按间隔分组计数。
function trackTimers(t) {
  const live = new Map();
  const orig = {setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  globalThis.setInterval = (fn, ms, ...args) => { const id = orig.setInterval(fn, ms, ...args); live.set(id, {kind: 'interval', ms}); return id; };
  globalThis.setTimeout = (fn, ms, ...args) => { let id = null; id = orig.setTimeout((...a) => { live.delete(id); fn(...a); }, ms, ...args); live.set(id, {kind: 'timeout', ms}); return id; };
  globalThis.clearInterval = id => { live.delete(id); orig.clearInterval(id); };
  globalThis.clearTimeout = id => { live.delete(id); orig.clearTimeout(id); };
  t.after(() => {
    for (const id of live.keys()) { orig.clearInterval(id); orig.clearTimeout(id); }
    Object.assign(globalThis, orig);
  });
  return (kind, ms) => [...live.values()].filter(v => v.kind === kind && v.ms === ms).length;
}

function fakeApi() {
  const services = [], stopHooks = [];
  return {
    services, stopHooks,
    api: {registerGatewayMethod() {}, registerHttpRoute() {}, logger: {},
      registerService: s => services.push(s), on: (name, fn) => { if (name === 'gateway_stop') stopHooks.push(fn); }},
  };
}

function freshStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-exam-timers-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
}

// 有模型才会开真题轮询；测试里不推进时间，模型不会真被调用。
const requestModel = async () => { throw new Error('测试里不该调模型'); };

test('插件在同一进程里注册 3 次：真题轮询只留一组（60 s 轮询 1 个、15 s 首轮 1 个）', t => {
  const count = trackTimers(t);
  let last;
  for (let i = 0; i < 3; i++) { const {api} = fakeApi(); last = registerLearningGame(api, freshStore(t), {requestModel}); }
  assert.equal(count('interval', 60000), 1, '每注册一次就多一个 60 s 轮询');
  assert.equal(count('timeout', 15000), 1, '每注册一次就多一个 15 s 首轮');
  last.stop();
  assert.equal(count('interval', 60000), 0);
  assert.equal(count('timeout', 15000), 0);
});

test('服务 stop / gateway_stop 后计时器归零；再 start 只开一组，重复 start 不叠加', t => {
  const count = trackTimers(t);
  const {api, services, stopHooks} = fakeApi();
  registerLearningGame(api, freshStore(t), {requestModel});
  const service = services.find(s => s.id === 'pinkie-learning-game');
  assert.ok(service, '注册了能停的服务');
  assert.equal(count('interval', 60000), 1);
  service.stop();
  assert.equal(count('interval', 60000), 0, '服务停了 60 s 轮询还在跑');
  assert.equal(count('timeout', 15000), 0, '服务停了 15 s 首轮还在等');
  service.start(); service.start();
  assert.equal(count('interval', 60000), 1, '重新 start 只开一组');
  assert.ok(stopHooks.length > 0, '挂了 gateway_stop');
  for (const fn of stopHooks) fn();
  assert.equal(count('interval', 60000), 0, 'gateway_stop 后 60 s 轮询还在跑');
  assert.equal(count('timeout', 15000), 0, 'gateway_stop 后 15 s 首轮还在等');
});

test('停了以后，出卷收尾排的 5 s 补卷也不再排', t => {
  const count = trackTimers(t);
  const {api} = fakeApi();
  const game = registerLearningGame(api, freshStore(t), {requestModel});
  const exam = game.modules.exam;
  game.stop();
  exam.later(() => { throw new Error('停了还在跑'); }, 5000);
  assert.equal(count('timeout', 5000), 0);
});
