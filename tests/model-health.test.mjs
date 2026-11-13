import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelHealth, classifyModelFailure, configuredModels, turnFailed} from '../services/mode-architecture/model-health.mjs';

test('upstream "no auth available" is an account problem, a 429 is busy', () => {
  assert.equal(classifyModelFailure('503 auth_unavailable: no auth available'), 'account');
  assert.equal(classifyModelFailure("You've reached your subscription usage limit"), 'account');
  assert.equal(classifyModelFailure('402 insufficient_quota'), 'account');
  assert.equal(classifyModelFailure('429 Too Many Requests'), 'busy');
  assert.equal(classifyModelFailure('503 service unavailable'), 'down');
  assert.equal(classifyModelFailure('401 invalid api key'), 'key');
  assert.equal(classifyModelFailure('Request timed out'), 'timeout');
  assert.equal(classifyModelFailure('404 模型 gpt-5.5 不在当前 API Key 的可用模型范围内 error'), 'missing');
  assert.equal(classifyModelFailure(''), 'other');
});

test('a failed turn keeps its model and reason; a later success clears it', () => {
  let now = 1000;
  const health = new ModelHealth({now: () => now});
  health.callStarted({runId: 'r1', provider: 'mm', model: 'gemini-3.8-flash-tiered'});
  health.callEnded({runId: 'r1', provider: 'mm', model: 'gemini-3.8-flash-tiered', outcome: 'error'});
  health.turnEnded('agent:main:a', {runId: 'r1', success: false, reason: '503 auth_unavailable: no auth available'});
  const {failure} = health.failure('agent:main:a');
  assert.deepEqual({model: failure.model, kind: failure.kind, unusable: failure.unusable},
    {model: 'mm/gemini-3.8-flash-tiered', kind: 'account', unusable: true});
  now = 2000;
  health.turnEnded('agent:main:a', {runId: 'r2', success: true});
  assert.equal(health.failure('agent:main:a').failure, null);
});

test('suggests a model that worked recently, never the failed one or one that just failed', () => {
  let now = 0;
  const health = new ModelHealth({now: () => ++now});
  const call = (model, outcome) => health.callEnded({provider: 'mm', model, outcome});
  call('gemini-3-flash', 'completed');
  call('claude-opus-4-6-thinking', 'error');
  call('gemini-3.8-flash-tiered', 'error');
  health.turnEnded('agent:main:a', {success: false, reason: 'auth_unavailable', model: 'mm/gemini-3.8-flash-tiered'});
  const candidates = ['mm/gemini-3.8-flash-tiered', 'mm/claude-opus-4-6-thinking', 'mm/gemini-3-flash', 'mm/grok-4.5'];
  assert.equal(health.failure('agent:main:a', {candidates}).suggestion, 'mm/gemini-3-flash');
  // Nothing known to work yet: first configured model that has not just failed.
  const fresh = new ModelHealth();
  fresh.turnEnded('agent:main:b', {success: false, reason: 'auth_unavailable', model: 'mm/gemini-3.8-flash-tiered'});
  assert.equal(fresh.failure('agent:main:b', {candidates}).suggestion, 'mm/claude-opus-4-6-thinking');
});

test('configured candidates: the mode first, then defaults, then other modes\' fallbacks', () => {
  const config = {agents: {
    defaults: {model: {primary: 'mm/gemini-3.8-flash-tiered', fallbacks: ['mm/claude-opus-4-6-thinking']}},
    list: [{id: 'main', model: 'mm/gemini-3.8-flash-tiered'},
      {id: 'unrestricted', model: {primary: 'mm/gemini-3.8-flash-tiered', fallbacks: ['mm/gemini-3-flash']}}],
  }};
  assert.deepEqual(configuredModels(config, 'main'),
    ['mm/gemini-3.8-flash-tiered', 'mm/claude-opus-4-6-thinking', 'mm/gemini-3-flash']);
});

test('a turn whose last assistant message errored is a failure even when agent_end says success', () => {
  const failed = {success: true, messages: [{role: 'user', content: '你好'},
    {role: 'assistant', content: [{type: 'text', text: ''}], stopReason: 'error', errorMessage: '503 auth_unavailable: no auth available'}]};
  assert.equal(turnFailed(failed), true);
  assert.equal(turnFailed({success: true, messages: [{role: 'assistant', stopReason: 'stop'}]}), false);
  assert.equal(turnFailed({success: true, messages: [{message: {role: 'assistant', stopReason: 'error'}}]}), true);
  assert.equal(turnFailed({success: false}), true);
  assert.equal(turnFailed({success: true}), false);
});

test('a model whose call "completed" but whose turn failed is not suggested again', () => {
  let now = 0;
  const health = new ModelHealth({now: () => ++now});
  health.callStarted({runId: 'r1', provider: 'mm', model: 'gemini-3.8-flash-tiered'});
  health.callEnded({runId: 'r1', provider: 'mm', model: 'gemini-3.8-flash-tiered', outcome: 'completed'});
  health.callEnded({provider: 'mm', model: 'gemini-3-flash', outcome: 'completed'});
  health.turnEnded('agent:main:a', {runId: 'r1', success: false, reason: 'auth_unavailable'});
  const {failure, suggestion} = health.failure('agent:main:a', {candidates: ['mm/gemini-3.8-flash-tiered', 'mm/gemini-3-flash']});
  assert.equal(failure.model, 'mm/gemini-3.8-flash-tiered');
  assert.equal(suggestion, 'mm/gemini-3-flash');
  health.turnEnded('agent:main:b', {success: false, reason: 'x', model: 'mm/gemini-3-flash'});
  assert.equal(health.failure('agent:main:c', {candidates: []}).failure, null);
  assert.equal(health.failure('agent:main:b', {candidates: ['mm/gemini-3.8-flash-tiered', 'mm/gemini-3-flash']}).suggestion, '');
});
