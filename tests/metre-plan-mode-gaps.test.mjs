// 第五批 I4「先出方案」（#94）的单元测试缺口：已有 tests/metre-plan-mode.test.mjs 没碰到的纯逻辑分支。
// 只补缺口，不重复已有用例；不起浏览器。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPlanModeStore, registerMetrePlanMode} from '../services/mode-architecture/metre-plan-mode.mjs';

const METRE = 'agent:metre:dashboard:abc';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'metre-plan-mode-gaps-'));

function fakeApi() {
  const methods = new Map(), hooks = new Map();
  return {
    methods, hooks,
    registerGatewayMethod(name, fn, opts) { methods.set(name, {fn, scope: opts?.scope}); },
    on(name, fn) { hooks.set(name, fn); },
    async call(name, params) {
      let out;
      await methods.get(name).fn({params, respond: (ok, payload, error) => { out = {ok, payload, error}; }});
      return out;
    },
  };
}

test('without a root the switch lives only in memory; set reports the current value', () => {
  const store = createPlanModeStore();
  assert.equal(store.get(METRE), false);
  assert.equal(store.set(METRE, true), true);
  assert.equal(store.get(METRE), true);
  assert.equal(store.set(METRE, false), false);
  assert.equal(store.get(METRE), false);
  // 没有 root 就没有文件可写：换一个新 store，刚才的开关不在了。
  assert.equal(createPlanModeStore().get(METRE), false);
});

test('setting the same value twice does not rewrite the file', () => {
  const root = tmp();
  const store = createPlanModeStore(root);
  assert.equal(fs.existsSync(path.join(root, 'plan-mode.json')), false, 'nothing written yet');
  assert.equal(store.set(METRE, false), false);
  assert.equal(fs.existsSync(path.join(root, 'plan-mode.json')), false, 'setting the default off writes nothing');
  store.set(METRE, true);
  const file = path.join(root, 'plan-mode.json');
  const content = fs.readFileSync(file, 'utf8');
  // 先把文件时间拨到 10 秒前：再 set 同样的值，文件时间必须纹丝不动（只看内容不够，同毫秒内重写也看不出来）。
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(file, old, old);
  store.set(METRE, true);
  assert.equal(fs.readFileSync(file, 'utf8'), content, 'same value: content unchanged');
  assert.equal(fs.statSync(file).mtimeMs, old.getTime(), 'same value: file untouched');
  store.set(METRE, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {on: []});
});

test('a corrupt plan-mode.json is tolerated, and the next set repairs it', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'plan-mode.json'), 'broken{{{');
  const store = createPlanModeStore(root);
  assert.equal(store.get(METRE), false, 'a broken file reads as all-off, it does not throw');
  assert.equal(store.set(METRE, true), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'plan-mode.json'), 'utf8')), {on: [METRE]});
});

test('set only accepts a strict true: "yes", 1 and "true" all leave it off', async () => {
  const api = fakeApi();
  registerMetrePlanMode(api, {root: tmp()});
  for (const on of ['yes', 1, 'true']) {
    assert.equal((await api.call('pinkie.metre.planMode.set', {sessionKey: METRE, on})).payload.on, false, `on=${JSON.stringify(on)}`);
    assert.equal((await api.call('pinkie.metre.planMode.get', {sessionKey: METRE})).payload.on, false);
  }
  assert.equal((await api.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true})).payload.on, true);
});

test('the tool hook reads both toolName and name; multi_edit, create and update are blocked too', async () => {
  const api = fakeApi();
  registerMetrePlanMode(api, {root: tmp()});
  const tool = api.hooks.get('before_tool_call');
  const ctx = {sessionKey: METRE};
  await api.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true});
  // name 写法（已有测试只用了 toolName）。
  assert.equal(tool({name: 'write'}, ctx)?.block, true, 'name is read the same as toolName');
  assert.equal(tool({name: 'read'}, ctx), undefined);
  // PLAN_BLOCKED_TOOLS 里已有测试没点到的三个。
  for (const name of ['multi_edit', 'create', 'update']) {
    const r = tool({toolName: name}, ctx);
    assert.equal(r?.block, true, `${name} should be blocked`);
    assert.match(r.blockReason, /先出方案/);
  }
  // 工具名缺省时不拦：不是“没名字就当坏工具”。
  assert.equal(tool({}, ctx), undefined);
});

test('isLocked also bypasses the prompt hook, not just the tool hook', async () => {
  const locked = fakeApi();
  registerMetrePlanMode(locked, {root: tmp(), isLocked: () => true});
  await locked.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true});
  const ctx = {sessionKey: METRE};
  assert.equal(locked.hooks.get('before_prompt_build')({}, ctx), undefined, 'locked: no plan context is added');
  assert.equal(locked.hooks.get('before_tool_call')({toolName: 'write'}, ctx), undefined);
  // 对照：没上锁时同一会话要加约束。
  const open = fakeApi();
  registerMetrePlanMode(open, {root: tmp()});
  await open.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true});
  assert.ok(open.hooks.get('before_prompt_build')({}, ctx).appendSystemContext.includes('先出方案'));
});

test('a non-Metre session is left alone by the tool hook too, and get without a key is off', async () => {
  const api = fakeApi();
  registerMetrePlanMode(api, {root: tmp()});
  await api.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true});
  const tool = api.hooks.get('before_tool_call');
  assert.equal(tool({toolName: 'write'}, {sessionKey: 'agent:main:chat:x'}), undefined);
  assert.equal(tool({toolName: 'write'}, {sessionKey: ''}), undefined);
  assert.deepEqual((await api.call('pinkie.metre.planMode.get', {})).payload, {sessionKey: '', on: false});
});
