import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BATON_FREE_STEPS, MetreBaton, dispatchOutcome, registerMetreBaton} from '../services/mode-architecture/metre-baton.mjs';

const isMetre = key => key.startsWith('agent:metre:');
const fakeApi = () => {
  const hooks = {};
  return {hooks, on(name, fn) { (hooks[name] ||= []).push(fn); }};
};
const run = (api, name, event, ctx) => (api.hooks[name] || []).map(fn => fn(event, ctx)).find(Boolean);

test('Baton lets a few hands-on steps through, then asks Metre to dispatch', () => {
  const solo = new Set();
  const api = fakeApi();
  registerMetreBaton(api, {isMetre, solo: key => solo.has(key)});
  const ctx = {sessionKey: 'agent:metre:dashboard:a'};
  run(api, 'before_agent_run', {}, ctx);
  for (let i = 0; i < BATON_FREE_STEPS; i += 1) assert.equal(run(api, 'before_tool_call', {toolName: 'write'}, ctx), undefined);
  assert.equal(run(api, 'before_tool_call', {toolName: 'read'}, ctx), undefined, 'reading is never blocked');
  assert.equal(run(api, 'before_tool_call', {toolName: 'exec'}, ctx), undefined, 'running a check is never blocked');
  const blocked = run(api, 'before_tool_call', {toolName: 'code_edit'}, ctx);
  assert.equal(blocked?.block, true);
  assert.match(blocked.blockReason, /pinkie_session_start/);
  // A real child session unlocks the parent's own integration edits.
  run(api, 'after_tool_call', {toolName: 'pinkie_session_start', result: {details: {key: 'agent:project:pinkie-child:x'}}}, ctx);
  assert.equal(run(api, 'before_tool_call', {toolName: 'code_edit'}, ctx), undefined);
  // A new run starts counting again.
  run(api, 'before_agent_run', {}, ctx);
  for (let i = 0; i < BATON_FREE_STEPS; i += 1) run(api, 'before_tool_call', {toolName: 'image_generate'}, ctx);
  assert.equal(run(api, 'before_tool_call', {toolName: 'image_generate'}, ctx)?.block, true);
});

test('a failed dispatch, Virtuoso and other modes are never blocked; offer cards do not count as dispatch', () => {
  const solo = new Set(['agent:metre:dashboard:solo']);
  const baton = new MetreBaton({isMetre, solo: key => solo.has(key)});
  const key = 'agent:metre:dashboard:b';
  for (let i = 0; i < 10; i += 1) baton.before('agent:project:main', 'write');
  assert.equal(baton.before('agent:project:main', 'write'), undefined);
  for (let i = 0; i < 10; i += 1) assert.equal(baton.before('agent:metre:dashboard:solo', 'write'), undefined);
  for (let i = 0; i < BATON_FREE_STEPS; i += 1) baton.before(key, 'write');
  baton.after(key, 'pinkie_session_start', dispatchOutcome({result: {details: {ok: true, card: 'offer'}}}));
  assert.equal(baton.before(key, 'write')?.block, true, 'a card waiting for the user is not a dispatch');
  baton.after(key, 'pinkie_session_start', dispatchOutcome({result: {content: [{type: 'text', text: '名额满了'}], isError: true}}));
  assert.equal(baton.before(key, 'write'), undefined, 'after a failed dispatch Metre finishes the work itself');
});

test('registering on the same api twice does not double count', () => {
  const api = fakeApi();
  const first = registerMetreBaton(api, {isMetre, solo: () => false});
  registerMetreBaton(api, {isMetre, solo: () => false, baton: first});
  const ctx = {sessionKey: 'agent:metre:dashboard:c'};
  for (let i = 0; i < BATON_FREE_STEPS; i += 1) assert.equal(run(api, 'before_tool_call', {toolName: 'edit'}, ctx), undefined);
  assert.equal(run(api, 'before_tool_call', {toolName: 'edit'}, ctx)?.block, true);
});

test('a free model may be dispatched to itself; a paid one may not', async () => {
  const {chooseChildModel, freeModel} = await import('../services/mode-architecture/metre-models.mjs');
  assert.equal(freeModel('workbuddy/hy4flash-free'), true);
  assert.equal(freeModel('openai/gpt-5'), false);
  assert.equal(freeModel('acme/freedom-1'), false);
  const config = {models: {providers: {workbuddy: {models: [{id: 'hy4flash-free'}]}, openai: {models: [{id: 'gpt-5'}]}}}};
  assert.equal(chooseChildModel({config, selfModel: 'workbuddy/hy4flash-free', requested: 'workbuddy/hy4flash-free'}).model, 'workbuddy/hy4flash-free');
  assert.throws(() => chooseChildModel({config, selfModel: 'openai/gpt-5', requested: 'openai/gpt-5'}), /同一个模型/);
});
