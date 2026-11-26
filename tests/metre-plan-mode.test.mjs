// 第五批 I4「先出方案」的复发测试（services/mode-architecture/metre-plan-mode.mjs）。
// 改前：没有这个文件，index.mjs 也不注册 pinkie.metre.planMode.*，整份测试失败。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.join(here, '..', 'services', 'mode-architecture', 'metre-plan-mode.mjs');
const load = () => import('../services/mode-architecture/metre-plan-mode.mjs');

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
const METRE = 'agent:metre:dashboard:abc';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'metre-plan-mode-'));

test('plan mode is off by default, only Metre sessions can turn it on, and it survives a restart', async () => {
  assert.ok(fs.existsSync(modPath), 'metre-plan-mode.mjs 不存在');
  const {registerMetrePlanMode} = await load();
  const root = tmp();
  const api = fakeApi();
  registerMetrePlanMode(api, {root});
  assert.equal(api.methods.get('pinkie.metre.planMode.get').scope, 'operator.read');
  assert.equal(api.methods.get('pinkie.metre.planMode.set').scope, 'operator.admin');
  assert.deepEqual((await api.call('pinkie.metre.planMode.get', {sessionKey: METRE})).payload, {sessionKey: METRE, on: false});
  const other = await api.call('pinkie.metre.planMode.set', {sessionKey: 'agent:main:chat:x', on: true});
  assert.equal(other.ok, false);
  assert.match(other.error.message, /只有 Metre/);
  assert.equal((await api.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true})).payload.on, true);
  const again = fakeApi();
  registerMetrePlanMode(again, {root});
  assert.equal((await again.call('pinkie.metre.planMode.get', {sessionKey: METRE})).payload.on, true, '重启后要记得');
  assert.equal((await again.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: false})).payload.on, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'plan-mode.json'), 'utf8')), {on: []});
});

test('while on: the prompt asks for a plan first, and edits, commands and dispatch are blocked; reading and plan_update are not', async () => {
  const {registerMetrePlanMode, PLAN_MODE_CONTEXT} = await load();
  const api = fakeApi();
  registerMetrePlanMode(api, {root: tmp()});
  const prompt = api.hooks.get('before_prompt_build'), tool = api.hooks.get('before_tool_call');
  const ctx = {sessionKey: METRE};
  assert.equal(prompt({}, ctx), undefined, '关着时不加任何东西');
  assert.equal(tool({toolName: 'write'}, ctx), undefined);
  await api.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true});
  assert.ok(prompt({}, ctx).appendSystemContext.includes(PLAN_MODE_CONTEXT));
  for (const name of ['write', 'edit', 'apply_patch', 'exec', 'bash', 'process', 'pinkie_engine_task']) {
    const r = tool({toolName: name}, ctx);
    assert.equal(r?.block, true, name + ' 应该被拦');
    assert.match(r.blockReason, /先出方案/);
  }
  for (const name of ['read', 'plan_update', 'ask_user', 'web_search']) assert.equal(tool({toolName: name}, ctx), undefined, name + ' 不该被拦');
  // 别的模式的会话、上了锁的 Metre 会话都不管
  assert.equal(prompt({}, {sessionKey: 'agent:main:chat:x'}), undefined);
  const locked = fakeApi();
  registerMetrePlanMode(locked, {root: tmp(), isLocked: () => true});
  await locked.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: true});
  assert.equal(locked.hooks.get('before_tool_call')({toolName: 'write'}, ctx), undefined);
  await api.call('pinkie.metre.planMode.set', {sessionKey: METRE, on: false});
  assert.equal(tool({toolName: 'write'}, ctx), undefined, '批准（关掉）后照常动手');
});

test('the plugin entry registers plan mode for Metre', () => {
  const src = fs.readFileSync(path.join(here, '..', 'services', 'mode-architecture', 'index.mjs'), 'utf8');
  assert.match(src, /import \{registerMetrePlanMode\} from '\.\/metre-plan-mode\.mjs';/);
  assert.match(src, /registerMetrePlanMode\(toolApi, \{root: path\.join\(pinkieStateRoot\(\), 'metre-plan-mode'\)/);
});
