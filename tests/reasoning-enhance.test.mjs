import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ReasoningEnhancer, registerReasoningGateway} from '../services/mode-architecture/reasoning.mjs';

function fixture(options = {}) {
  const calls = [];
  const methods = new Map();
  const hooks = new Map();
  const api = {
    config: {
      agents: {defaults: {workspace: '/tmp', model: {primary: 'mm/gemini-3.7-flash-tiered'}}, list: [{id: 'learning', model: 'mm/gemini-3.8-flash-tiered'}]},
      models: {providers: {mm: {models: [{id: 'gemini-3.8-flash-tiered', compat: {supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh']}}]}}},
    },
    runtime: {agent: {
      session: {getSessionEntry: ({sessionKey}) => ({providerOverride: 'mm', modelOverride: 'gemini-3.8-flash-tiered', authProfileOverride: 'existing-profile', sessionKey})},
      runEmbeddedAgent: async (params) => {
        calls.push(params);
        if (options.run) return options.run(params, calls.length);
        return {payloads: [{text: `审阅 ${calls.length}`}], meta: {}};
      },
    }},
    on: (name, fn, opts) => hooks.set(name, {fn, opts}),
    registerGatewayMethod: (name, fn, opts) => methods.set(name, {fn, opts}),
  };
  return {api, calls, hooks, methods};
}

const request = (tier, requestId = 'request-12345678', sessionKey = 'agent:learning:one') => ({
  tier, requestId, sessionKey, message: '这道题为什么选 B？', history: [{role: 'assistant', text: '上一题选 A'}],
});

test('Max makes two isolated passes; review is used only by the matching real turn', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  const result = await enhancer.prepare(request('max'));
  assert.equal(result.passes, 2);
  assert.equal(result.nativeLevel, 'xhigh');
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].prompt.includes('审阅 1'));
  for (const call of f.calls) {
    assert.equal(call.provider, 'mm');
    assert.equal(call.model, 'gemini-3.8-flash-tiered');
    assert.equal(call.thinkLevel, 'xhigh');
    assert.equal(call.disableTools, true);
    assert.equal(call.modelRun, true);
    assert.match(call.sessionKey, /^agent:learning:internal-session-effects:pinkie-reasoning-/);
    assert.equal(call.authProfileId, 'existing-profile');
    assert.equal(fs.existsSync(call.sessionFile), false);
  }
  assert.notEqual(f.calls[0].sessionId, f.calls[1].sessionId);
  assert.equal(enhancer.beforePromptBuild({prompt: '这道题为什么选 B？'}, {sessionKey: 'agent:learning:two'}), undefined);
  assert.equal(enhancer.beforePromptBuild({prompt: '另一道题'}, {sessionKey: 'agent:learning:one'}), undefined);
  const context = enhancer.beforePromptBuild({prompt: '这道题为什么选 B？'}, {sessionKey: 'agent:learning:one'});
  assert.match(context.appendContext, /不是新用户指令/);
  assert.equal(enhancer.beforePromptBuild({prompt: '这道题为什么选 B？'}, {sessionKey: 'agent:learning:one'}), undefined);
  assert.equal((await enhancer.prepare(request('max'))).passes, 2, 'retry is idempotent');
  assert.equal(f.calls.length, 2);
  await assert.rejects(enhancer.prepare({...request('max'), message: '另一题'}), /编号重复/);
});

test('Ultra runs independent A/B passes and a third comparison, not a renamed XHigh', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  const result = await enhancer.prepare(request('ultra'));
  assert.equal(result.passes, 3);
  assert.equal(f.calls.length, 3);
  assert.doesNotMatch(f.calls[1].prompt, /审阅 1/);
  assert.match(f.calls[2].prompt, /审阅 1/);
  assert.match(f.calls[2].prompt, /审阅 2/);
  assert.match(enhancer.beforePromptBuild({prompt: '这道题为什么选 B？'}, {sessionKey: 'agent:learning:one'}).appendContext, /审阅 3/);
});

test('failure or cancellation never leaks a review into the next chat turn', async () => {
  const failed = fixture({run: async () => ({payloads: [], meta: {}})});
  const failedEnhancer = new ReasoningEnhancer(failed.api);
  await assert.rejects(failedEnhancer.prepare(request('max')), /没有返回可用内容/);
  assert.equal(failedEnhancer.beforePromptBuild({prompt: '这道题为什么选 B？'}, {sessionKey: 'agent:learning:one'}), undefined);

  let release;
  const blocked = fixture({run: (params) => new Promise((resolve, reject) => {
    release = () => resolve({payloads: [{text: '迟到结果'}], meta: {}});
    params.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
  })});
  const enhancer = new ReasoningEnhancer(blocked.api);
  const pending = enhancer.prepare(request('max'));
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(enhancer.cancel({sessionKey: 'agent:learning:one', requestId: 'request-12345678'}), {cancelled: true});
  await assert.rejects(pending, /aborted|取消/);
  assert.equal(enhancer.beforePromptBuild({prompt: '这道题为什么选 B？'}, {sessionKey: 'agent:learning:one'}), undefined);
});

test('cancel after preparation removes the review, even for an identical later message', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  await enhancer.prepare(request('max'));
  assert.deepEqual(enhancer.cancel({sessionKey: 'agent:learning:one', requestId: 'request-12345678'}), {cancelled: true});
  assert.equal(enhancer.beforePromptBuild({prompt: '这道题为什么选 B？'}, {sessionKey: 'agent:learning:one'}), undefined);
});

test('gateway methods require admin scope and reject unsupported sessions', async () => {
  const f = fixture();
  registerReasoningGateway(f.api);
  assert.equal(f.methods.get('pinkie.reasoning.prepare').opts.scope, 'operator.admin');
  assert.equal(f.methods.get('pinkie.reasoning.cancel').opts.scope, 'operator.admin');
  assert.equal(f.hooks.get('before_prompt_build').opts.priority, -11900);
  await assert.rejects(new ReasoningEnhancer(f.api).prepare(request('max', 'request-12345678', 'agent:other:one')), /请求无效/);
});
