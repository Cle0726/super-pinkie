import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ReasoningEnhancer as BaseEnhancer, ReviewStore, registerReasoningGateway, toolEvidence, fixMessage, finalReply,
  recipeFor, nativeLevels, messageDifficulty, solverPrompt, auditPrompt, replyFacts,
} from '../services/mode-architecture/reasoning.mjs';

// Every enhancer gets its own state directory; a second instance on the same directory sees the same state.
const tempStore = () => new ReviewStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-review-test-')));
class ReasoningEnhancer extends BaseEnhancer {
  constructor(api, options = {}) { super(api, {store: tempStore(), ...options}); }
}

const GEMINI = {id: 'gemini-3.8-flash-tiered', reasoning: true, compat: {supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh']}};
const GLM = {id: 'workbuddy/glm-5.3', reasoning: true, compat: {supportedReasoningEfforts: ['high']}};
const PLAIN = {id: 'gpt-6-sol', reasoning: false};

function fixture(options = {}) {
  const calls = [];
  const sent = [];
  const methods = new Map();
  const hooks = new Map();
  const model = options.model || 'gemini-3.8-flash-tiered';
  const api = {
    config: {
      agents: {defaults: {workspace: '/tmp', model: {primary: 'mm/gemini-3.7-flash-tiered'}}, list: [{id: 'learning', model: 'mm/gemini-3.8-flash-tiered'}]},
      models: {providers: {
        mm: {models: [GEMINI, GLM, PLAIN]},
        clekk: {models: [{id: 'gpt-6.1-sol', reasoning: true, compat: {supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']}}]},
      }},
    },
    runtime: {agent: {
      session: {getSessionEntry: ({sessionKey}) => ({providerOverride: 'mm', modelOverride: model, authProfileOverride: 'existing-profile', sessionKey})},
      runEmbeddedAgent: async (params) => {
        calls.push(params);
        if (options.run) return options.run(params, calls.length);
        return {payloads: [{text: /独立解题助手/.test(params.prompt) ? `解答 ${calls.length}` : '{"pass": true}'}], meta: {}};
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
const solverCalls = (calls) => calls.filter((call) => /独立解题助手/.test(call.prompt));
const auditCalls = (calls) => calls.filter((call) => /验收员|审稿人/.test(call.prompt));

test('each of the nine stops resolves against what the current model really supports', () => {
  assert.deepEqual(nativeLevels(GEMINI), ['minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(nativeLevels(GLM), ['high']);
  assert.deepEqual(nativeLevels(PLAIN), ['off']);
  assert.deepEqual(nativeLevels({reasoning: true}), ['high'], 'undeclared reasoning routes count as a single high stop');
  // Gemini 3.8: everything up to XHigh is native; Off can only be made faster.
  assert.equal(recipeFor('xhigh', GEMINI).kind, 'native');
  assert.equal(recipeFor('minimal', GEMINI).kind, 'native');
  assert.deepEqual([recipeFor('off', GEMINI).kind, recipeFor('off', GEMINI).native, recipeFor('off', GEMINI).brevity], ['down', 'minimal', true]);
  // GLM 5.3 only has high: lower stops only shorten the answer, XHigh is made up by process.
  for (const level of ['off', 'minimal', 'low', 'medium']) assert.equal(recipeFor(level, GLM).kind, 'down', level);
  assert.deepEqual(['kind', 'native', 'solvers', 'critic', 'rounds', 'audit'].map((key) => recipeFor('xhigh', GLM)[key]), ['up', 'high', 1, true, 1, true]);
  // A model without reasoning gets a think-first brief for Medium/High.
  assert.deepEqual(['kind', 'native', 'think', 'solvers'].map((key) => recipeFor('high', PLAIN)[key]), ['up', 'off', true, 0]);
  // Max and Ultra always add process on top of the model's best native effort.
  assert.deepEqual(['kind', 'native', 'solvers', 'rounds'].map((key) => recipeFor('max', GEMINI)[key]), ['enhanced', 'xhigh', 2, 2]);
  assert.deepEqual(['kind', 'native', 'solvers', 'rounds'].map((key) => recipeFor('ultra', GLM)[key]), ['enhanced', 'high', 3, 3]);
});

test('adaptive is simulated per message when the model has no native adaptive effort', () => {
  assert.equal(messageDifficulty('谢谢'), 'easy');
  assert.equal(messageDifficulty('证明：对任意正整数 n，n^3 - n 能被 6 整除，并给出推导。'), 'hard');
  // 硬性计数的写作（Low 档实测数不准字数）按难题；普通写作和闲聊仍按简单。
  assert.equal(messageDifficulty('用一句话介绍长城：恰好 30 个汉字（标点不算），只有一句。'), 'hard');
  assert.equal(messageDifficulty('写一首五言绝句：4 行，每行恰好 5 个汉字。'), 'hard');
  assert.equal(messageDifficulty('写一段介绍猫的文字，要求恰好 3 句话。'), 'hard');
  assert.equal(messageDifficulty('帮我写一段 100 字左右的自我介绍'), 'easy');
  assert.equal(messageDifficulty('列出 5 个水果'), 'easy');
  const hard = recipeFor('adaptive', GLM, {message: '这个函数报错 Traceback，帮我排查原因并重构：```def f(x): return x/0```'});
  assert.deepEqual(['kind', 'as', 'native', 'solvers'].map((key) => hard[key]), ['adaptive', 'xhigh', 'high', 1]);
  const easy = recipeFor('adaptive', GEMINI, {message: '早上好'});
  assert.deepEqual(['kind', 'as', 'native', 'solvers'].map((key) => easy[key]), ['adaptive', 'low', 'low', 0]);
});

test('a native stop prepares nothing; a prompt-only stop injects a brief once and makes no model call', async () => {
  const gemini = fixture();
  const enhancer = new ReasoningEnhancer(gemini.api);
  const native = await enhancer.prepare({...request('high'), level: 'high'});
  assert.equal(native.prepared, false);
  assert.equal(native.thinkingLevel, 'high');
  const glm = fixture({model: 'workbuddy/glm-5.3'});
  const fast = new ReasoningEnhancer(glm.api);
  const prepared = await fast.prepare({...request('off'), level: 'off'});
  assert.deepEqual([prepared.prepared, prepared.mode, prepared.recipe.kind], [true, 'prompt', 'down']);
  const context = fast.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  assert.match(context.appendContext, /直接给结论/);
  assert.match(context.appendContext, /最低只能用「High」/);
  assert.equal(fast.status({sessionKey: 'agent:learning:one'}).phase, 'idle', 'brief-only stops do not wait for a review');
  assert.deepEqual(await fast.agentEnded(runEvent('好。'), {sessionKey: 'agent:learning:one'}), {reviewed: false});
  assert.equal(glm.calls.length, 0);
});

test('Max no longer blocks the send: prepare returns at once and makes no model call', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  const result = await enhancer.prepare(request('max'));
  assert.equal(result.prepared, true);
  assert.equal(result.mode, 'delivery-review');
  assert.equal(result.rounds, 2);
  assert.equal(f.calls.length, 0);
  assert.equal((await enhancer.prepare(request('max'))).prepared, true, 'retry is idempotent');
  await assert.rejects(enhancer.prepare({...request('max'), message: '另一题'}), /编号重复/);
});

test('only the matching real turn is reviewed; solves and the critic all use the current model at its best effort', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  assert.equal(enhancer.beforePromptBuild({prompt: '另一道题'}, {sessionKey: 'agent:learning:one'}), undefined);
  assert.equal(enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:two'}), undefined);
  const context = enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  assert.match(context.appendContext, /交付验收/);
  const outcome = await enhancer.agentEnded(runEvent('写好了，3 段。', [['write', 'Successfully wrote 300 bytes']]), {sessionKey: 'agent:learning:one'});
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  assert.equal(solverCalls(f.calls).length, 2);
  assert.equal(auditCalls(f.calls).length, 1);
  for (const call of f.calls) {
    assert.equal(call.disableTools, true);
    assert.equal(call.lane, 'subagent', 'helpers queue on the subagent lane, not the 4-slot main lane');
    assert.equal(`${call.provider}/${call.model}`, 'mm/gemini-3.8-flash-tiered', 'every helper follows the session model');
    assert.equal(call.thinkLevel, 'xhigh', 'quality first: helpers use the model\'s highest native effort');
    assert.equal(call.authProfileId, 'existing-profile');
    assert.match(call.sessionKey, /^agent:learning:internal-session-effects:pinkie-reasoning-/);
    assert.equal(fs.existsSync(call.sessionFile), false);
  }
  const audit = auditCalls(f.calls)[0];
  assert.match(audit.prompt, /Successfully wrote 300 bytes/);
  assert.match(audit.prompt, /写好了，3 段/);
  assert.match(audit.prompt, /独立解答 1[\s\S]*独立解答 2/);
  assert.match(audit.prompt, /正确性/);
  assert.equal(enhancer.status({sessionKey: 'agent:learning:one'}).phase, 'passed');
  assert.equal(f.sent.length, 0);
});

test('the critic follows a configured model only when one is configured', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {critics: ['clekk/gpt-6.1-sol']});
  await enhancer.prepare(request('max'));
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  await enhancer.agentEnded(runEvent('写好了。', [['write', 'ok']]), {sessionKey: 'agent:learning:one'});
  const audit = auditCalls(f.calls)[0];
  assert.equal(`${audit.provider}/${audit.model}`, 'clekk/gpt-6.1-sol');
  assert.equal(audit.thinkLevel, 'max');
  assert.equal(audit.authProfileId, undefined, 'another provider never borrows the session auth profile');
  for (const call of solverCalls(f.calls)) assert.equal(call.model, 'gemini-3.8-flash-tiered');
});

test('concrete issues send the reply back up to the stop\'s round limit, then stop', async () => {
  const verdict = {pass: false, issues: [{what: '说「测试通过」', evidence: '工具记录里没有运行测试', fix: '运行测试后再说'}]};
  const f = fixture({run: async (params) => ({payloads: [{text: /独立解题助手/.test(params.prompt) ? '解答' : JSON.stringify(verdict)}]})});
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  const first = await enhancer.agentEnded(runEvent('修好了，测试通过。'), {sessionKey: 'agent:learning:one'});
  assert.equal(first.fixScheduled, true);
  assert.equal(f.sent[0].sessionKey, 'agent:learning:one');
  assert.match(f.sent[0].message, /^\[pinkie-tier\] 交付验收/, 'hidden by the chat timeline filter');
  assert.match(f.sent[0].message, /工具记录里没有运行测试/);
  assert.match(f.sent[0].message, /先用工具或重新推导确认/, 'the main model checks the critique instead of obeying it blindly');
  for (let round = 1; round <= 2; round += 1) {
    enhancer.beforePromptBuild({prompt: f.sent.at(-1).message}, {sessionKey: 'agent:learning:one'});
    await enhancer.agentEnded(runEvent('还是没跑。'), {sessionKey: 'agent:learning:one'});
  }
  assert.equal(f.sent.length, 2, 'Max has two send-back rounds');
  assert.equal(enhancer.status({sessionKey: 'agent:learning:one'}).phase, 'unresolved');
});

test('Ultra runs three differently-angled solves alongside the main reply, none of which sees that reply', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  const result = await enhancer.prepare(request('ultra'));
  assert.equal(result.rounds, 3);
  assert.equal(result.crossCheck, true);
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段', messages: [{role: 'user', content: '上一题'}, {role: 'assistant', content: '选 B'}]}, {sessionKey: 'agent:learning:one'});
  await enhancer.agentEnded(runEvent('答案是 299。'), {sessionKey: 'agent:learning:one'});
  const solves = solverCalls(f.calls);
  assert.equal(solves.length, 3);
  assert.equal(new Set(solves.map((call) => call.prompt.match(/做法：(.+)/)[1])).size, 3, 'each solve takes a different approach');
  for (const call of solves) assert.doesNotMatch(call.prompt, /答案是 299。/);
  assert.match(auditCalls(f.calls)[0].prompt, /独立解答 3/);
  const status = enhancer.status({sessionKey: 'agent:learning:one'});
  assert.deepEqual(status.jobs.map((job) => job.role), ['main', 'solver', 'solver', 'solver', 'critic']);
  assert.ok(status.jobs.every((job) => job.state === 'done' && !('output' in job)));
  const main = enhancer.job({sessionKey: 'agent:learning:one', jobId: status.jobs[0].id});
  assert.equal(main.output, '答案是 299。');
});

test('history comes from the turn itself when the UI did not send any', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  await enhancer.prepare({...request('ultra'), history: undefined});
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段', messages: [
    {role: 'user', content: '前一题是什么'}, {role: 'user', content: '[pinkie-watchdog] 内部'}, {role: 'assistant', content: [{type: 'text', text: '是数列题'}]},
  ]}, {sessionKey: 'agent:learning:one'});
  await enhancer.independent.values().next().value;
  const prompt = solverCalls(f.calls)[0].prompt;
  assert.match(prompt, /用户：前一题是什么\n助手：是数列题/);
  assert.doesNotMatch(prompt, /pinkie-watchdog/);
});

test('failed runs and cancelled requests are never reviewed', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  assert.deepEqual(await enhancer.agentEnded({success: false, messages: []}, {sessionKey: 'agent:learning:one'}), {reviewed: false});
  assert.equal(auditCalls(f.calls).length, 0);
  await enhancer.prepare(request('max', 'request-87654321'));
  assert.deepEqual(enhancer.cancel({sessionKey: 'agent:learning:one', requestId: 'request-87654321'}), {cancelled: true});
  assert.equal(enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'}), undefined);
});

test('evidence extraction keeps real tool results and marks a turn without tools', () => {
  assert.match(toolEvidence([]), /没有调用任何工具/);
  const text = toolEvidence(runEvent('x', [['exec', 'FAILED (failures=2)']]).messages);
  assert.match(text, /exec → FAILED/);
  assert.equal(finalReply(runEvent('最终答复').messages), '最终答复');
  assert.match(fixMessage([{what: 'a', evidence: 'b', fix: 'c'}]), /1\. a（依据：b；应改为：c）/);
  assert.match(solverPrompt({message: 'q', history: '', index: 1}), /换一种和常规不同的方法/);
  assert.doesNotMatch(auditPrompt({message: 'q', reply: 'r', evidence: 'e'}), /正确性/, 'the plain delivery check stays narrow');
});

test('gateway methods require admin scope and reject unsupported sessions', async () => {
  const f = fixture();
  registerReasoningGateway(f.api);
  for (const name of ['pinkie.reasoning.prepare', 'pinkie.reasoning.cancel', 'pinkie.reasoning.status', 'pinkie.reasoning.job']) {
    assert.equal(f.methods.get(name).opts.scope, 'operator.admin');
  }
  assert.equal(f.hooks.get('before_prompt_build').opts.priority, -11900);
  await assert.rejects(new ReasoningEnhancer(f.api).prepare(request('max', 'request-12345678', 'agent:other:one')), /请求无效/);
  await assert.rejects(new ReasoningEnhancer(f.api).prepare({...request('max'), tier: 'turbo'}), /请求无效/);
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
  assert.ok(gateway.status({sessionKey: 'agent:learning:one'}).jobs.length >= 3, 'the panel reads helper rows written by the runtime instance');
  assert.deepEqual(gateway.cancel({sessionKey: 'agent:learning:one'}), {cancelled: true});
  assert.equal(runtime.status({sessionKey: 'agent:learning:one'}).phase, 'idle');
});

test('the critic gets exact character, line and sentence counts instead of counting by itself', () => {
  const facts = replyFacts('山高月小时，\n青山不改色。\n远山含笑意，\n山中有故人。');
  assert.match(facts, /全文：20 个汉字/);
  assert.match(facts, /第1行 5，第2行 5，第3行 5，第4行 5/);
  assert.match(auditPrompt({message: 'q', reply: '猫很安静。它们爱睡觉。', evidence: 'e'}), /机械统计[\s\S]*第1句 4，第2句 5/);
  assert.equal(replyFacts(''), '');
});
