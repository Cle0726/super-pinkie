import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ReasoningEnhancer as BaseEnhancer, ReviewStore, registerReasoningGateway, toolEvidence, fixMessage, finalReply} from '../services/mode-architecture/reasoning.mjs';

// Every enhancer gets its own state directory; a second instance on the same directory sees the same state.
const tempStore = () => new ReviewStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-review-test-')));
class ReasoningEnhancer extends BaseEnhancer {
  constructor(api, options = {}) { super(api, {store: tempStore(), ...options}); }
}

function fixture(options = {}) {
  const calls = [];
  const sent = [];
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
        return {payloads: [{text: '{"pass": true}'}], meta: {}};
      },
    }},
    on: (name, fn, opts) => hooks.set(name, {fn, opts}),
    registerGatewayMethod: (name, fn, opts) => methods.set(name, {fn, opts}),
  };
  const runProcess = async (file, args) => { sent.push(JSON.parse(args[args.indexOf('--params') + 1])); return {stdout: '{"ok":true,"status":"started"}'}; };
  return {api, calls, sent, hooks, methods, runProcess};
}

const request = (tier, requestId = 'request-12345678', sessionKey = 'agent:learning:one') => ({
  tier, requestId, sessionKey, message: '把 report.md 写成 3 段', history: [{role: 'assistant', text: '上一题选 A'}],
});
const runEvent = (reply, tools = []) => ({success: true, messages: [
  {role: 'user', content: '把 report.md 写成 3 段'},
  ...tools.map(([name, text]) => ({role: 'toolResult', toolName: name, content: [{type: 'text', text}]})),
  {role: 'assistant', content: [{type: 'text', text: reply}]},
]});

test('Max no longer blocks the send: prepare returns at once and makes no model call', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  const result = await enhancer.prepare(request('max'));
  assert.equal(result.prepared, true);
  assert.equal(result.mode, 'delivery-review');
  assert.equal(result.rounds, 1);
  assert.equal(f.calls.length, 0);
  assert.equal((await enhancer.prepare(request('max'))).prepared, true, 'retry is idempotent');
  await assert.rejects(enhancer.prepare({...request('max'), message: '另一题'}), /编号重复/);
});

test('only the matching real turn is marked for review, and the reply is then audited against tool evidence', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  assert.equal(enhancer.beforePromptBuild({prompt: '另一道题'}, {sessionKey: 'agent:learning:one'}), undefined);
  assert.equal(enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:two'}), undefined);
  const context = enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  assert.match(context.appendContext, /交付验收/);
  const outcome = await enhancer.agentEnded(runEvent('写好了，3 段。', [['write', 'Successfully wrote 300 bytes']]), {sessionKey: 'agent:learning:one'});
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.disableTools, true);
  assert.equal(call.thinkLevel, 'high', 'xhigh measured no better than high, so the audit uses high');
  assert.match(call.sessionKey, /^agent:learning:internal-session-effects:pinkie-reasoning-/);
  assert.equal(call.authProfileId, 'existing-profile');
  assert.equal(fs.existsSync(call.sessionFile), false);
  assert.match(call.prompt, /Successfully wrote 300 bytes/);
  assert.match(call.prompt, /写好了，3 段/);
  assert.equal(enhancer.status({sessionKey: 'agent:learning:one'}).phase, 'passed');
  assert.equal(f.sent.length, 0);
});

test('a concrete issue triggers exactly one hidden fix turn for Max, then stops', async () => {
  const verdict = {pass: false, issues: [{what: '说「测试通过」', evidence: '工具记录里没有运行测试', fix: '运行测试后再说'}]};
  const f = fixture({run: async () => ({payloads: [{text: JSON.stringify(verdict)}]})});
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  const first = await enhancer.agentEnded(runEvent('修好了，测试通过。'), {sessionKey: 'agent:learning:one'});
  assert.equal(first.fixScheduled, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].sessionKey, 'agent:learning:one');
  assert.match(f.sent[0].message, /^\[pinkie-tier\] 交付验收/, 'hidden by the chat timeline filter');
  assert.match(f.sent[0].message, /工具记录里没有运行测试/);
  assert.equal(enhancer.status({sessionKey: 'agent:learning:one'}).phase, 'fixing');
  enhancer.beforePromptBuild({prompt: f.sent[0].message}, {sessionKey: 'agent:learning:one'});
  const second = await enhancer.agentEnded(runEvent('还是没跑。'), {sessionKey: 'agent:learning:one'});
  assert.equal(second.pass, false);
  assert.equal(f.sent.length, 1, 'Max has a single fix round');
  assert.equal(enhancer.status({sessionKey: 'agent:learning:one'}).phase, 'unresolved');
});

test('Ultra cross-checks with an independent solve that runs while the main reply is written', async () => {
  const f = fixture({run: async (params, index) => ({payloads: [{text: index === 1 ? '独立结论：答案是 299' : '{"pass": true}'}]})});
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  const result = await enhancer.prepare(request('ultra'));
  assert.equal(result.rounds, 2);
  assert.equal(result.crossCheck, true);
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  await enhancer.agentEnded(runEvent('答案是 299。'), {sessionKey: 'agent:learning:one'});
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].prompt, /独立解题助手/);
  assert.doesNotMatch(f.calls[0].prompt, /答案是 299。/, 'the independent solve never sees the main reply');
  assert.match(f.calls[1].prompt, /独立结论：答案是 299/);
});

test('failed runs and cancelled requests are never reviewed', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  assert.deepEqual(await enhancer.agentEnded({success: false, messages: []}, {sessionKey: 'agent:learning:one'}), {reviewed: false});
  await enhancer.prepare(request('max', 'request-87654321'));
  assert.deepEqual(enhancer.cancel({sessionKey: 'agent:learning:one', requestId: 'request-87654321'}), {cancelled: true});
  assert.equal(enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'}), undefined);
  assert.equal(f.calls.length, 0);
});

test('evidence extraction keeps real tool results and marks a turn without tools', () => {
  assert.match(toolEvidence([]), /没有调用任何工具/);
  const text = toolEvidence(runEvent('x', [['exec', 'FAILED (failures=2)']]).messages);
  assert.match(text, /exec → FAILED/);
  assert.equal(finalReply(runEvent('最终答复').messages), '最终答复');
  assert.match(fixMessage([{what: 'a', evidence: 'b', fix: 'c'}]), /1\. a（依据：b；应改为：c）/);
});

test('gateway methods require admin scope and reject unsupported sessions', async () => {
  const f = fixture();
  registerReasoningGateway(f.api);
  for (const name of ['pinkie.reasoning.prepare', 'pinkie.reasoning.cancel', 'pinkie.reasoning.status']) {
    assert.equal(f.methods.get(name).opts.scope, 'operator.admin');
  }
  assert.equal(f.hooks.get('before_prompt_build').opts.priority, -11900);
  await assert.rejects(new ReasoningEnhancer(f.api).prepare(request('max', 'request-12345678', 'agent:other:one')), /请求无效/);
});

test('work tiers review the first real message after arming, and only once the whole tier task is done', async () => {
  const f = fixture();
  let tierActive = true;
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs', readyForReview: () => !tierActive});
  assert.equal(enhancer.armTier('agent:learning:one', 'base').armed, false, 'base tier has no delivery review');
  assert.equal(enhancer.armTier('agent:learning:one', 'boost').armed, true);
  assert.equal(enhancer.beforePromptBuild({prompt: '[pinkie-tier-control] 续跑'}, {sessionKey: 'agent:learning:one'}), undefined, 'control turns never start a review');
  assert.match(enhancer.beforePromptBuild({prompt: '帮我修测试'}, {sessionKey: 'agent:learning:one'}).appendContext, /交付验收/);
  assert.deepEqual(await enhancer.agentEnded(runEvent('先派子任务。'), {sessionKey: 'agent:learning:one'}), {reviewed: false, waiting: true});
  assert.equal(f.calls.length, 0);
  tierActive = false;
  assert.deepEqual(await enhancer.agentEnded(runEvent('修好了。', [['exec', 'OK']]), {sessionKey: 'agent:learning:one'}), {reviewed: true, pass: true});
  assert.match(f.calls[0].prompt, /帮我修测试/);
  const full = new ReasoningEnhancer(fixture().api, {readyForReview: () => true});
  full.armTier('agent:learning:two', 'full');
  full.beforePromptBuild({prompt: '这题怎么算'}, {sessionKey: 'agent:learning:two'});
  assert.equal(full.independent.size, 1, 'full tier starts the independent solve once the message is known');
});

test('state is shared through disk: the gateway instance arms, the agent-runtime instance injects and reviews', async () => {
  const f = fixture();
  const store = tempStore();
  const gateway = new BaseEnhancer(f.api, {store});
  const runtime = new BaseEnhancer(f.api, {store, runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await gateway.prepare(request('max'));
  assert.equal(gateway.status({sessionKey: 'agent:learning:one'}).phase, 'armed');
  assert.match(runtime.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'}).appendContext, /交付验收/);
  assert.equal(gateway.status({sessionKey: 'agent:learning:one'}).phase, 'answering');
  await runtime.agentEnded(runEvent('写好了。', [['write', 'ok']]), {sessionKey: 'agent:learning:one'});
  assert.equal(gateway.status({sessionKey: 'agent:learning:one'}).phase, 'passed');
  assert.deepEqual(gateway.cancel({sessionKey: 'agent:learning:one'}), {cancelled: true});
  assert.equal(runtime.status({sessionKey: 'agent:learning:one'}).phase, 'idle');
});
