import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ReasoningEnhancer as BaseEnhancer, ReviewStore, registerReasoningGateway, toolEvidence, fixMessage, finalReply,
  recipeFor, nativeLevels, messageDifficulty, solverPrompt, auditPrompt, replyFacts, REVIEW_TOOLS, adaptiveDifficulty, workKindsFor,
} from '../services/mode-architecture/reasoning.mjs';

// Every enhancer gets its own state directory; a second instance on the same directory sees the same state.
const tempStore = () => new ReviewStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-review-test-')));
class ReasoningEnhancer extends BaseEnhancer {
  constructor(api, options = {}) { super(api, {store: tempStore(), ...options}); }
}

// 独立解答按活儿种类变用途：答题类「独立解题」、文案点子「独立起草」、动手的活「验收清单」。
const SOLVER = /独立解题助手|独立起草助手|验收清单助手/;
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
        return {payloads: [{text: SOLVER.test(params.prompt) ? `解答 ${calls.length}` : '{"pass": true}'}], meta: {}};
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
const solverCalls = (calls) => calls.filter((call) => SOLVER.test(call.prompt));
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
    if (SOLVER.test(call.prompt)) {
      assert.equal(call.disableTools, true, 'independent passes never use tools');
      assert.equal(call.toolsAllow, undefined);
    } else {
      // 审稿员只带只读工具：能打开截图、文档、网页，不能执行、写文件、操作浏览器。
      assert.equal(call.disableTools, false);
      assert.deepEqual(call.toolsAllow, [...REVIEW_TOOLS]);
      // OpenClaw turns every tool off for raw model runs, which left toolsAllow matching nothing.
      assert.notEqual(call.modelRun, true, 'review pass must not be a raw model run');
      assert.equal(call.bootstrapContextMode, 'lightweight');
      for (const name of ['exec', 'write', 'edit', 'apply_patch', 'browser', 'app_browser', 'process']) assert.ok(!call.toolsAllow.includes(name), name);
    }
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
  // 「把 report.md 写成 3 段」是写作：两份独立起草作对照稿。
  assert.match(audit.prompt, /对照稿 1[\s\S]*对照稿 2/);
  assert.ok(solverCalls(f.calls).every((call) => /独立起草助手/.test(call.prompt)));
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
  const f = fixture({run: async (params) => ({payloads: [{text: SOLVER.test(params.prompt) ? '解答' : JSON.stringify(verdict)}]})});
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  const first = await enhancer.agentEnded(runEvent('修好了，测试通过。'), {sessionKey: 'agent:learning:one'});
  assert.equal(first.fixScheduled, true);
  assert.equal(f.sent[0].sessionKey, 'agent:learning:one');
  assert.match(f.sent[0].message, /^\[pinkie-tier\] 交付验收/, 'hidden by the chat timeline filter');
  assert.match(f.sent[0].message, /工具记录里没有运行测试/);
  assert.match(f.sent[0].message, /先用工具或重新推导确认/, 'the main model checks the critique instead of obeying it blindly');
  assert.match(f.sent[0].message, /只发更正/, 'the user already saw the reply: send a correction, not the whole answer again');
  for (let round = 1; round <= 2; round += 1) {
    enhancer.beforePromptBuild({prompt: f.sent.at(-1).message}, {sessionKey: 'agent:learning:one'});
    await enhancer.agentEnded(runEvent('还是没跑。'), {sessionKey: 'agent:learning:one'});
  }
  assert.equal(f.sent.length, 2, 'Max has two send-back rounds');
  // 打回后的那条只是更正：连同之前已经交给用户的回复一起审。
  const later = auditCalls(f.calls).at(-1).prompt;
  assert.match(later, /之前已经交给用户的回复】\n修好了，测试通过。/);
  assert.match(later, /这次补充的更正】\n还是没跑。/);
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
  assert.match(auditCalls(f.calls)[0].prompt, /对照稿 3/);
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

// ---- 2026-11-02 档位升级：按活儿种类变用途、审稿能打开成品、九档 + 四档只验收一次 ----

test('independent passes change purpose with the kind of work', () => {
  const math = solverPrompt({message: '证明：n^3 - n 能被 6 整除', history: '', index: 0, workKind: 'standard_answer'});
  assert.match(math, /独立解题助手/);
  assert.match(solverPrompt({message: 'q', history: '', index: 0}), /独立解题助手/, 'no kind keeps the old independent answer');
  const page = solverPrompt({message: '帮我做一个记账网页', history: '', index: 1, workKind: 'web_ui'});
  assert.match(page, /验收清单助手/);
  assert.match(page, /网页 \/ 界面/);
  assert.match(page, /最可能翻车的 3 处/);
  assert.match(page, /行家/, 'the second checklist takes the expert angle');
  assert.doesNotMatch(page, /独立解题助手/);
  for (const kind of ['document', 'video_motion', 'data_charts', 'automation', 'code', 'publish', 'environment']) {
    assert.match(solverPrompt({message: 'x', history: '', workKind: kind}), /验收清单助手/, kind);
  }
  const draft = solverPrompt({message: '给咖啡店起 5 个名字', history: '', index: 2, workKind: 'ideas'});
  assert.match(draft, /独立起草助手/);
  assert.match(draft, /更短、更有记忆点/);
  assert.match(solverPrompt({message: '写一段文案', history: '', workKind: 'writing'}), /独立起草助手/);
  for (const prompt of [math, page, draft]) assert.match(prompt, /不调用工具/);
});

test('adaptive sends hands-on work down the XHigh path and small talk down Low', () => {
  const as = (message, sessionKey = 'agent:main:one') => recipeFor('adaptive', GEMINI, {message, sessionKey}).as;
  assert.equal(as('帮我做一个记账的小网页'), 'xhigh');
  assert.equal(as('把这份 PPT 做得好看一点'), 'xhigh');
  assert.equal(as('剪个 30 秒的片头'), 'xhigh');
  assert.equal(as('我的程序报错了，打不开'), 'xhigh');
  assert.equal(as('早上好'), 'low');
  assert.equal(as('你是谁'), 'low');
  // 硬性计数的写作仍按难题（原规则保留）；普通写作按分数，还是简单。
  assert.equal(as('用一句话介绍长城：恰好 30 个汉字（标点不算），只有一句。'), 'xhigh');
  assert.equal(as('帮我写一段 100 字左右的自我介绍'), 'low');
  // 无限制模式不分活儿种类，只用原来的分数。
  assert.deepEqual(workKindsFor('帮我做一个记账的小网页', 'agent:unrestricted:one'), []);
  assert.equal(adaptiveDifficulty('帮我做一个记账的小网页', 'agent:unrestricted:one'), messageDifficulty('帮我做一个记账的小网页'));
  // 学习模式默认按讲题。
  assert.deepEqual(workKindsFor('这道题怎么做', 'agent:learning:one'), ['tutoring']);
});

const toolRun = (reply, calls = []) => ({success: true, messages: [
  {role: 'user', content: '帮我做一个记账网页'},
  ...calls.flatMap(([name, args, text], index) => [
    {role: 'assistant', content: [{type: 'toolCall', id: `call-${index}`, name, arguments: args}]},
    {role: 'toolResult', toolCallId: `call-${index}`, toolName: name, content: [{type: 'text', text}]},
  ]),
  {role: 'assistant', content: [{type: 'text', text: reply}]},
]});

test('the critic opens the deliverable: read-only tools, the real workspace and the files made this turn', async () => {
  // 审稿员在自己的会话文件里留下工具调用：读回来记到面板的那一行上（实测靠它核对「真的打开过成品」）。
  const f = fixture({run: async (params, count) => {
    if (SOLVER.test(params.prompt)) return {payloads: [{text: `清单 ${count}`}]};
    fs.writeFileSync(params.sessionFile, [
      {type: 'message', message: {role: 'assistant', content: [{type: 'toolCall', id: 'r1', name: 'read', arguments: {path: '/Users/me/Projects/ledger/shot.mobile.png'}}]}},
      {type: 'message', message: {role: 'toolResult', toolCallId: 'r1', toolName: 'read', content: [{type: 'text', text: 'Read image file [image/png]'}]}},
    ].map((row) => JSON.stringify(row)).join('\n'));
    return {payloads: [{text: '{"pass": true}'}]};
  }});
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare({level: 'max', requestId: 'request-web-0001', sessionKey: 'agent:project:one', message: '帮我做一个记账网页'});
  const context = enhancer.beforePromptBuild({prompt: '帮我做一个记账网页'}, {sessionKey: 'agent:project:one', workspaceDir: '/Users/me/Projects/ledger'});
  assert.match(context.appendContext, /审稿员会打开你做出来的文件和截图本身看/);
  const outcome = await enhancer.agentEnded(toolRun('做好了，截图看过。', [
    ['write', {path: '/Users/me/Projects/ledger/index.html', content: '<html></html>'}, 'Successfully wrote 13 bytes'],
    ['exec', {command: 'look-page /Users/me/Projects/ledger/index.html --mobile -o /Users/me/Projects/ledger/shot.mobile.png'}, '截图：/Users/me/Projects/ledger/shot.mobile.png'],
  ]), {sessionKey: 'agent:project:one'});
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  const solves = solverCalls(f.calls);
  assert.equal(solves.length, 2);
  assert.ok(solves.every((call) => /验收清单助手/.test(call.prompt) && call.disableTools === true));
  const [audit] = auditCalls(f.calls);
  assert.equal(audit.disableTools, false);
  assert.deepEqual(audit.toolsAllow, ['read', 'image', 'pdf', 'web_fetch', 'web_search']);
  assert.equal(audit.workspaceDir, '/Users/me/Projects/ledger', 'the critic runs in the project folder, not the mode workspace');
  assert.match(audit.prompt, /- \/Users\/me\/Projects\/ledger\/index\.html/);
  assert.match(audit.prompt, /- \/Users\/me\/Projects\/ledger\/shot\.mobile\.png/);
  assert.match(audit.prompt, /必须打开交付物本身核对/);
  assert.match(audit.prompt, /验收清单 1[\s\S]*验收清单 2/);
  assert.match(audit.prompt, /这是一件「网页 \/ 界面 \/ 小工具」】打开截图/);
  const critic = enhancer.status({sessionKey: 'agent:project:one'}).jobs.find((job) => job.role === 'critic');
  assert.deepEqual([critic.toolsUsed, critic.opened], [['read'], ['/Users/me/Projects/ledger/shot.mobile.png']]);
  assert.equal(fs.existsSync(audit.sessionFile), false, 'the pass transcript is still removed afterwards');
  // 不在项目里时退回模式工作区。
  const g = fixture();
  const plain = new ReasoningEnhancer(g.api);
  await plain.prepare({level: 'max', requestId: 'request-web-0002', sessionKey: 'agent:main:one', message: '1+1 等于几，证明一下'});
  plain.beforePromptBuild({prompt: '1+1 等于几，证明一下'}, {sessionKey: 'agent:main:one'});
  await plain.agentEnded(toolRun('等于 2。'), {sessionKey: 'agent:main:one'});
  const [quiet] = auditCalls(g.calls);
  assert.ok(path.isAbsolute(quiet.workspaceDir) && quiet.workspaceDir !== '/Users/me/Projects/ledger', 'no project folder: the mode workspace');
  assert.doesNotMatch(quiet.prompt, /本轮做出来的文件和截图/, 'nothing to open for a text answer');
});

test('a work tier chosen first, then Max: one merged review after the whole tier task', async () => {
  const f = fixture();
  let tierActive = true;
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs', readyForReview: () => !tierActive});
  const key = 'agent:main:one';
  assert.equal(enhancer.armTier(key, 'full').armed, true);
  const prepared = await enhancer.prepare({level: 'max', requestId: 'request-merge-0001', sessionKey: key, message: '帮我做一个记账网页'});
  assert.deepEqual([prepared.prepared, prepared.merged, prepared.workTier, prepared.rounds, prepared.crossCheck], [true, true, 'full', 2, true]);
  const status = enhancer.status({sessionKey: key});
  assert.deepEqual([status.requestId, status.workTier, status.workKind, status.phase], ['request-merge-0001', 'full', 'web_ui', 'armed']);
  assert.deepEqual([status.recipe.solvers, status.recipe.critic, status.recipe.rounds], [2, true, 2], 'solvers and rounds take the larger of Max (2/2) and full (1/2)');
  const context = enhancer.beforePromptBuild({prompt: '帮我做一个记账网页'}, {sessionKey: key});
  assert.equal(context.appendContext.match(/交付验收/g).length, 1, 'one review notice, not two');
  assert.equal(enhancer.independent.size, 1);
  assert.deepEqual(await enhancer.agentEnded(toolRun('先派子任务。'), {sessionKey: key}), {reviewed: false, waiting: true});
  assert.equal(auditCalls(f.calls).length, 0, 'no review while the tier task is still running');
  tierActive = false;
  assert.deepEqual(await enhancer.agentEnded(toolRun('做好了。'), {sessionKey: key}), {reviewed: true, pass: true});
  assert.equal(auditCalls(f.calls).length, 1);
  assert.equal(solverCalls(f.calls).length, 2);
  // Ultra + 全开档：3 份独立、3 轮打回。
  const u = new ReasoningEnhancer(fixture().api);
  u.armTier(key, 'full');
  const ultra = await u.prepare({level: 'ultra', requestId: 'request-merge-0002', sessionKey: key, message: '证明 n^3-n 能被 6 整除'});
  assert.deepEqual([ultra.merged, ultra.rounds], [true, 3]);
  assert.equal(u.status({sessionKey: key}).recipe.solvers, 3);
  // 一个只加提示的档（Medium 往上补）和档位合并后照样验收，并保留补强提示。
  const m = new ReasoningEnhancer(fixture({model: 'gpt-6-sol'}).api);
  m.armTier(key, 'boost');
  const medium = await m.prepare({level: 'medium', requestId: 'request-merge-0003', sessionKey: key, message: '把这份 PPT 做好看一点'});
  assert.deepEqual([medium.prepared, medium.mode, medium.merged], [true, 'delivery-review', true]);
  const brief = m.beforePromptBuild({prompt: '把这份 PPT 做好看一点'}, {sessionKey: key}).appendContext;
  assert.match(brief, /验收清单/);
  assert.match(brief, /交付验收/);
  // 原生档（不用补）不碰档位的登记。
  const n = new ReasoningEnhancer(fixture().api);
  n.armTier(key, 'full');
  assert.equal((await n.prepare({level: 'high', requestId: 'request-merge-0004', sessionKey: key, message: '做个网页'})).prepared, false);
  assert.deepEqual([n.status({sessionKey: key}).workTier, n.status({sessionKey: key}).phase], ['full', 'armed']);
});

test('Max first, then the marathon tier: still one review, with the final check', async () => {
  const f = fixture();
  let tierActive = true;
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs', readyForReview: () => !tierActive});
  const key = 'agent:project:one';
  await enhancer.prepare({level: 'max', requestId: 'request-merge-0005', sessionKey: key, message: '做一个能玩的贪吃蛇小游戏'});
  const armed = enhancer.armTier(key, 'marathon');
  assert.deepEqual(armed, {armed: true, requestId: 'request-merge-0005', merged: true}, 'the UI keeps tracking the prepare request');
  const status = enhancer.status({sessionKey: key});
  assert.deepEqual([status.workTier, status.workKind, status.recipe.critic, status.recipe.rounds, status.recipe.solvers], ['marathon', 'app_game_ai', true, 2, 2]);
  enhancer.beforePromptBuild({prompt: '做一个能玩的贪吃蛇小游戏'}, {sessionKey: key});
  for (let milestone = 0; milestone < 3; milestone += 1) {
    assert.deepEqual(await enhancer.agentEnded(toolRun(`里程碑 ${milestone + 1} 做完。`), {sessionKey: key}), {reviewed: false, waiting: true});
  }
  tierActive = false;
  assert.deepEqual(await enhancer.agentEnded(toolRun('全部做完。'), {sessionKey: key}), {reviewed: true, pass: true});
  assert.equal(auditCalls(f.calls).length, 1);
  // 很久以前登记的（超过合并窗口）不合并：按新的一条重新登记。
  const g = fixture();
  const stale = new ReasoningEnhancer(g.api);
  stale.armTier(key, 'full');
  const old = stale.store.get(key);
  stale.store.set({...old, createdAt: Date.now() - 11 * 60_000});
  const fresh = await stale.prepare({level: 'max', requestId: 'request-merge-0006', sessionKey: key, message: '做个网页'});
  assert.equal(fresh.merged, undefined);
  assert.equal(stale.status({sessionKey: key}).workTier, '');
  // 只有档位的验收：长跑档的终审也带批评（审稿员打开成品）。
  const h = new ReasoningEnhancer(fixture().api);
  h.armTier(key, 'marathon');
  assert.equal(h.status({sessionKey: key}).recipe.critic, true);
});

test('a send-back only asks for a correction, never the whole answer again', () => {
  const text = fixMessage([{what: '说「截图看过」', evidence: '工具记录里没有截图', fix: '截图后再说'}]);
  assert.match(text, /^\[pinkie-tier\] 交付验收/);
  assert.match(text, /用户已经看到了，所以只发更正/);
  assert.match(text, /核对过了，上面的回复不用改/);
  assert.match(text, /先用工具或重新推导确认/);
  // 审稿提示里只在有工具时列出要打开的文件；没有路径时也提醒去工作目录找。
  const hands = auditPrompt({message: '做个 PPT', reply: '做好了', evidence: 'e', workKind: 'document', tools: true, artifacts: []});
  assert.match(hands, /工具记录里没认出路径/);
  assert.match(hands, /只看过 HTML 替身不算/);
  assert.doesNotMatch(auditPrompt({message: '做个 PPT', reply: '做好了', evidence: 'e', workKind: 'document', artifacts: ['/a/b.pptx']}), /\/a\/b\.pptx/, 'no tools, no file list');
});

test('the reviewer is told which folder the files were made in and that file deliverables need no pasted source', () => {
  const text = auditPrompt({message: '写一个记账命令行脚本，带测试', history: '', reply: '在当前目录运行 python3 cli.py 即可。', evidence: 'exec pytest: 5 passed',
    workKind: 'code', tools: true, artifacts: ['/Users/me/projects/ledger/cli.py', '/Users/me/projects/ledger/tests/test_ledger.py', 'cli.py']});
  assert.match(text, /【本轮做文件的文件夹】\/Users\/me\/projects\/ledger\n/);
  assert.match(text, /不要求把文件内容（源码、全文）贴进回复/);
  assert.doesNotMatch(auditPrompt({message: 'x', reply: 'y', evidence: '', artifacts: ['a.png']}), /本轮做文件的文件夹/);
});

test('a run that ends in NO_REPLY is not reviewed and does not use up the review', async () => {
  // 11-02 隔离实测 K-poster-full：内部轮以 NO_REPLY 收尾，审稿员判成「没交付」，碧琪把整份终稿又发了一遍。
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  await enhancer.prepare(request('max'));
  enhancer.beforePromptBuild({prompt: '把 report.md 写成 3 段'}, {sessionKey: 'agent:learning:one'});
  assert.deepEqual(await enhancer.agentEnded(runEvent('NO_REPLY'), {sessionKey: 'agent:learning:one'}), {reviewed: false, silent: true});
  assert.equal(auditCalls(f.calls).length, 0);
  const outcome = await enhancer.agentEnded(runEvent('写好了，3 段。', [['write', 'Successfully wrote 300 bytes']]), {sessionKey: 'agent:learning:one'});
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  assert.equal(auditCalls(f.calls).length, 1);
});
