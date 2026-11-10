// 2026-11-09 升级逻辑（run-contract.mjs 顶部的五条规矩）：每条规矩至少一条测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEPTH_LADDER, LEVELS, RIGOR_LADDER, TIERS, buildContract, mergeLayers, messageWeight, proportion, rigorLayers, unverifiedNote,
} from '../services/mode-architecture/run-contract.mjs';
import {
  ReasoningEnhancer as BaseEnhancer, ReviewStore, adaptiveBand, auditPrompt, recipeFor, workKindsFor,
} from '../services/mode-architecture/reasoning.mjs';
import {independentViews} from '../services/mode-architecture/work-kinds.mjs';
import {ModeArchitecture, TIER_RETRY_LIMITS, buildDeliberationPlan, classifyDeliberationTask, deliberationRequirements} from '../services/mode-architecture/index.mjs';

const tempStore = () => new ReviewStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-ladder-test-')));
class ReasoningEnhancer extends BaseEnhancer {
  constructor(api, options = {}) { super(api, {store: tempStore(), ...options}); }
}

const SOLVER = /独立解题助手|独立起草助手|验收清单助手/;
const GEMINI = {id: 'gemini-3.8-flash-tiered', reasoning: true, compat: {supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh']}};
const GLM = {id: 'workbuddy/glm-5.3', reasoning: true, compat: {supportedReasoningEfforts: ['high']}};
const TOP = {id: 'gpt-6.1-sol', reasoning: true, compat: {supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']}};

function fixture(options = {}) {
  const calls = [];
  const sent = [];
  const model = options.model || GEMINI.id;
  const api = {
    config: {
      agents: {defaults: {workspace: '/tmp', model: {primary: `mm/${GEMINI.id}`}}, list: []},
      models: {providers: {mm: {models: [GEMINI, GLM, TOP]}}},
    },
    runtime: {agent: {
      session: {getSessionEntry: ({sessionKey}) => ({providerOverride: 'mm', modelOverride: model, sessionKey})},
      runEmbeddedAgent: async (params) => {
        calls.push(params);
        if (options.run) return options.run(params, calls.length);
        return {payloads: [{text: SOLVER.test(params.prompt) ? `解答 ${calls.length}` : '{"pass": true}'}], meta: {}};
      },
    }},
    on() {},
    registerGatewayMethod() {},
  };
  const runProcess = async (file, args) => { sent.push(JSON.parse(args[args.indexOf('--params') + 1])); return {stdout: '{"ok":true,"status":"started"}'}; };
  return {api, calls, sent, runProcess};
}

const KEY = 'agent:main:ladder';
const ask = (level, message, extra = {}) => ({sessionKey: KEY, requestId: `request-${level}-${Math.random().toString(36).slice(2, 10)}`, level, message, ...extra});
const turn = (prompt, reply, tools = []) => ({success: true, messages: [
  {role: 'user', content: prompt},
  ...tools.map(([name, text]) => ({role: 'toolResult', toolName: name, content: [{type: 'text', text}]})),
  {role: 'assistant', content: [{type: 'text', text: reply}]},
]});
const solverCalls = (calls) => calls.filter((call) => SOLVER.test(call.prompt));
const auditCalls = (calls) => calls.filter((call) => /验收员|审稿人/.test(call.prompt));

// ---------- 一份梯子 ----------

test('both ladders live in one place and every consumer reads the same numbers', () => {
  assert.deepEqual(TIER_RETRY_LIMITS, Object.fromEntries(TIERS.map((tier) => [tier, RIGOR_LADDER[tier].continuationLimit])));
  assert.deepEqual(TIER_RETRY_LIMITS, {base: 3, boost: 6, full: 10, marathon: 40});
  assert.equal(rigorLayers('base'), null, 'the base tier has no delivery review');
  assert.deepEqual(['solvers', 'rounds', 'critic'].map((key) => rigorLayers('full')[key]), [1, 2, true]);
  // The numbers the picker shows the user for XHigh / Max / Ultra.
  assert.deepEqual(['xhigh', 'max', 'ultra'].map((level) => [DEPTH_LADDER[level].solvers, DEPTH_LADDER[level].rounds]), [[1, 1], [2, 2], [3, 3]]);
  assert.deepEqual([...LEVELS], ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']);
});

test('each rung up keeps everything below it and adds one more kind of work', () => {
  const rungs = ['medium', 'high', 'xhigh', 'max', 'ultra'].map((level) => DEPTH_LADDER[level]);
  for (let index = 1; index < rungs.length; index += 1) {
    const below = rungs[index - 1], above = rungs[index];
    for (const flag of ['think', 'selfCheck', 'critic', 'audit']) assert.ok(above[flag] || !below[flag], `${flag} never drops going up (rung ${index})`);
    assert.ok(above.solvers >= below.solvers && above.rounds >= below.rounds);
    assert.notDeepEqual(above, below, 'a rung that adds nothing is not a rung');
  }
  // Medium and High used to be the same brief: High now also checks its own answer before sending.
  assert.equal(DEPTH_LADDER.medium.selfCheck, false);
  assert.equal(DEPTH_LADDER.high.selfCheck, true);
  // Max on a model that tops out at High also gets the lower rungs; on a model with a native Max it does not need them.
  assert.deepEqual(['think', 'selfCheck', 'solvers'].map((key) => recipeFor('max', GLM)[key]), [true, true, 2]);
  assert.deepEqual(['think', 'selfCheck', 'solvers'].map((key) => recipeFor('max', TOP)[key]), [false, false, 2]);
  const rigor = TIERS.map((tier) => RIGOR_LADDER[tier]);
  assert.deepEqual(rigor.map((tier) => tier.strict), [0, 1, 2, 2]);
  assert.deepEqual(rigor.map((tier) => tier.roles), ['advisory', 'advisory', 'required', 'advisory']);
});

// ---------- 1. 力气跟着活走 ----------

test('message weight: small talk, a bare go-ahead, and a real task are three different things', () => {
  for (const text of ['谢谢', '谢谢你！', '晚安~', '早上好', '你好', '哈哈哈', 'thanks', 'Hi']) assert.equal(messageWeight(text), 'social', text);
  // 「好的」「可以」常常是让碧琪动手的那句话：不是寒暄，要核对的是它接着做的那件事。
  for (const text of ['好的', '可以', '继续', '好的，继续吧', '可以，开始吧', '嗯', 'ok', 'go on']) assert.equal(messageWeight(text), 'carry', text);
  for (const text of ['帮我做一个记账网页', '谢谢，再帮我把标题改成红色', '继续，但是把第二页删掉', '你好，这道题怎么做：x + 4 = 9']) assert.equal(messageWeight(text), 'task', text);
});

test('small talk under Ultra adds nothing, stores nothing, and still lets the message go out', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  const result = await enhancer.prepare(ask('ultra', '谢谢'));
  // The UI refuses to send a Max / Ultra message unless prepare says it is prepared.
  assert.equal(result.prepared, true);
  assert.equal(result.mode, 'prompt');
  assert.deepEqual([result.recipe.solvers, result.recipe.rounds, result.crossCheck, result.recipe.weight], [0, 0, false, 'social']);
  assert.equal(enhancer.status({sessionKey: KEY}).phase, 'idle');
  assert.equal(enhancer.beforePromptBuild({prompt: '谢谢'}, {sessionKey: KEY}), undefined);
  assert.deepEqual(await enhancer.agentEnded(turn('谢谢', '不客气。'), {sessionKey: KEY}), {reviewed: false});
  assert.equal(f.calls.length, 0, 'no independent pass and no reviewer for a thank-you');
});

test('a work tier chosen alone does not review a good-night either', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  assert.equal(enhancer.armTier(KEY, 'full').armed, true);
  assert.equal(enhancer.beforePromptBuild({prompt: '晚安'}, {sessionKey: KEY}), undefined);
  assert.equal(enhancer.status({sessionKey: KEY}).phase, 'idle');
  assert.equal(f.calls.length, 0);
});

test('unrestricted mode keeps its old behaviour for small talk', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  const result = await enhancer.prepare({...ask('max', '谢谢'), sessionKey: 'agent:unrestricted:ladder'});
  assert.equal(result.mode, 'delivery-review');
  assert.equal(result.recipe.solvers, 2);
});

test('a bare 继续 is checked against the task it continues', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  await enhancer.prepare(ask('max', '继续'));
  const earlier = [
    {role: 'user', content: '帮我做一个记账网页，手机上也要能用'},
    {role: 'assistant', content: [{type: 'text', text: '好，页面骨架搭好了，还差导出功能。'}]},
    {role: 'user', content: '[pinkie-tier-control] 内部提醒'},
  ];
  assert.match(enhancer.beforePromptBuild({prompt: '继续', messages: earlier}, {sessionKey: KEY}).appendContext, /交付验收/);
  const status = enhancer.status({sessionKey: KEY});
  assert.equal(status.workKind, 'web_ui', 'the kind of work comes from the earlier request, not from the word 继续');
  assert.equal(status.weight, 'carry');
  await enhancer.agentEnded(turn('继续', '导出功能加好了。', [['write', 'ok']]), {sessionKey: KEY});
  const solvers = solverCalls(f.calls);
  assert.equal(solvers.length, 2);
  for (const call of solvers) {
    assert.match(call.prompt, /验收清单助手/);
    assert.match(call.prompt, /帮我做一个记账网页，手机上也要能用/);
  }
  assert.match(auditCalls(f.calls)[0].prompt, /这一句是让接着做之前这条请求：帮我做一个记账网页/);
});

test('a bare 继续 with nothing to continue starts no independent pass but keeps the delivery check', async () => {
  const f = fixture();
  const enhancer = new ReasoningEnhancer(f.api);
  await enhancer.prepare(ask('max', '继续'));
  const context = enhancer.beforePromptBuild({prompt: '继续', messages: []}, {sessionKey: KEY}).appendContext;
  assert.match(context, /交付验收/);
  // Real-model run L1-d: without a word the model searched the whole disk for "the last task".
  assert.match(context, /直接用一句话问用户要接着做哪件事/);
  assert.doesNotMatch(context, /pinkie:effort level=/, 'no thinking brief for a task that does not exist');
  assert.equal(enhancer.independent.size, 0);
  await enhancer.agentEnded(turn('继续', '好的，我接着整理。'), {sessionKey: KEY});
  assert.equal(solverCalls(f.calls).length, 0);
  assert.equal(auditCalls(f.calls).length, 1);
});

test('adaptive has three bands: Low for a one-liner, Medium for ordinary writing and choices, XHigh for hard or hands-on work', () => {
  const band = (message, sessionKey = KEY) => adaptiveBand(message, sessionKey);
  assert.equal(band('你是谁'), 'easy');
  assert.equal(band('帮我写一段 100 字左右的自我介绍'), 'normal');
  assert.equal(band('帮我做一个记账的小网页'), 'hard');
  assert.equal(band('用一句话介绍长城：恰好 30 个汉字（标点不算），只有一句。'), 'hard');
  assert.deepEqual(['as', 'difficulty'].map((key) => recipeFor('adaptive', GEMINI, {message: '帮我写一段 100 字左右的自我介绍', sessionKey: KEY})[key]), ['medium', 'normal']);
  // On a model that only has High, the middle band becomes a shorter answer, the hard band gets a second view and a reviewer.
  assert.equal(recipeFor('adaptive', GLM, {message: '帮我做一个记账的小网页', sessionKey: KEY}).solvers, 1);
  assert.equal(recipeFor('adaptive', GLM, {message: '你是谁', sessionKey: KEY}).solvers, 0);
  // Unrestricted mode has no work kinds: only the message itself decides.
  assert.equal(band('为什么天是蓝的，分析一下', 'agent:unrestricted:ladder'), 'normal');
});

// ---------- 2. 往上一级是多一种做法；复核要收敛 ----------

test('High adds a self-check to the brief; with a delivery review on, the review notice says it once', async () => {
  const plain = fixture({model: GLM.id});
  plain.api.config.models.providers.mm.models = [{id: GLM.id, reasoning: false}];
  const enhancer = new ReasoningEnhancer(plain.api);
  await enhancer.prepare(ask('medium', '这两个方案选哪个好，帮我比较一下'));
  const medium = enhancer.beforePromptBuild({prompt: '这两个方案选哪个好，帮我比较一下'}, {sessionKey: KEY}).appendContext;
  assert.match(medium, /回答前先把问题拆清楚/);
  assert.doesNotMatch(medium, /写完先别交/);
  await enhancer.prepare(ask('high', '这两个方案选哪个好，再帮我比较一下'));
  const high = enhancer.beforePromptBuild({prompt: '这两个方案选哪个好，再帮我比较一下'}, {sessionKey: KEY}).appendContext;
  assert.match(high, /回答前先把问题拆清楚/);
  assert.match(high, /写完先别交：对着用户的每条要求逐条核一遍/);
  await enhancer.prepare(ask('xhigh', '这两个方案到底选哪个好，帮我比较一下'));
  const xhigh = enhancer.beforePromptBuild({prompt: '这两个方案到底选哪个好，帮我比较一下'}, {sessionKey: KEY}).appendContext;
  assert.doesNotMatch(xhigh, /写完先别交/);
  assert.match(xhigh, /回复前先自己逐条对一遍/);
});

test('a re-review after a send-back chases the earlier issues and does not open new minor ones', async () => {
  let audits = 0;
  const f = fixture({run: (params) => {
    if (SOLVER.test(params.prompt)) return {payloads: [{text: '独立做法'}]};
    audits += 1;
    return {payloads: [{text: audits === 1
      ? '{"pass": false, "issues": [{"what": "回复说写了 3 段，实际只有 2 段", "evidence": "机械统计：2 个非空行", "fix": "补上第三段"}]}'
      : '{"pass": true}'}]};
  }});
  const enhancer = new ReasoningEnhancer(f.api, {runProcess: f.runProcess, cliEntry: '/x/openclaw.mjs'});
  const message = '把 report.md 写成 3 段';
  await enhancer.prepare(ask('max', message));
  enhancer.beforePromptBuild({prompt: message}, {sessionKey: KEY});
  assert.deepEqual(await enhancer.agentEnded(turn(message, '写好了，一共 3 段。', [['write', 'ok']]), {sessionKey: KEY}), {reviewed: true, pass: false, fixScheduled: true});
  const first = auditCalls(f.calls)[0].prompt;
  assert.doesNotMatch(first, /上一轮你指出的问题/);
  enhancer.beforePromptBuild({prompt: f.sent[0].message}, {sessionKey: KEY});
  assert.deepEqual(await enhancer.agentEnded(turn(f.sent[0].message, '补上了第三段：……'), {sessionKey: KEY}), {reviewed: true, pass: true});
  const second = auditCalls(f.calls)[1].prompt;
  assert.match(second, /上一轮你指出的问题（这一轮先逐条核对它们改了没有）】\n1\. 回复说写了 3 段，实际只有 2 段（当时要求：补上第三段）/);
  assert.match(second, /新问题只报三种/);
  assert.match(second, /措辞、排版、可改可不改的地方，这一轮一律不提/);
  assert.match(auditPrompt({message: 'q', reply: 'r', evidence: 'e'}), /逐项核对/);
});

// ---------- 3. 两套档位是一个决定 ----------

test('merging the two selections: counts take the larger, order does not matter, and "faster" never cancels a check', () => {
  const max = recipeFor('max', GEMINI), full = rigorLayers('full');
  const forward = mergeLayers(max, full), backward = mergeLayers(full, max);
  assert.deepEqual(['solvers', 'rounds', 'critic', 'audit'].map((key) => forward[key]), [2, 2, true, true]);
  assert.deepEqual(['solvers', 'rounds', 'critic', 'audit'].map((key) => backward[key]), [2, 2, true, true]);
  // Low on a model that cannot go that low means "answer faster". Next to a tier that demands proof it only shortens the prose.
  const low = recipeFor('low', GLM);
  assert.equal(low.brevity, true);
  const merged = mergeLayers(low, rigorLayers('boost'));
  assert.deepEqual([merged.brevity, merged.concise, merged.audit], [false, true, true]);
  // Without a tier, "faster" stays plain brevity.
  assert.equal(proportion(low, 'task').brevity, true);
});

test('Low together with the boost tier: short prose, every check kept', async () => {
  const f = fixture({model: GLM.id});
  const enhancer = new ReasoningEnhancer(f.api);
  const message = '帮我做一个记账网页';
  enhancer.armTier(KEY, 'boost');
  const result = await enhancer.prepare(ask('low', message));
  assert.deepEqual([result.merged, result.workTier, result.mode], [true, 'boost', 'delivery-review']);
  const context = enhancer.beforePromptBuild({prompt: message}, {sessionKey: KEY}).appendContext;
  assert.match(context, /同时开了「加强档」/);
  assert.match(context, /核对一步都不能省/);
  assert.doesNotMatch(context, /只做必要的一两步/, 'the old "do one or two steps" brief fought the tier\'s evidence gate');
  // Low alone keeps the plain faster brief.
  const alone = new ReasoningEnhancer(fixture({model: GLM.id}).api);
  await alone.prepare(ask('low', message));
  assert.match(alone.beforePromptBuild({prompt: message}, {sessionKey: KEY}).appendContext, /只做必要的一两步/);
});

test('independent versions are counted once: the tier\'s own helpers first, the nine-level engine only tops up', async () => {
  const sum = '求方程 x² = 4 的所有实数解';
  assert.equal(workKindsFor(sum, KEY)[0], 'standard_answer');
  assert.equal(independentViews(['standard_answer'], 'full'), 2);
  assert.equal(independentViews(['standard_answer'], 'boost'), 0, 'helpers are only advice below the full tier');
  assert.equal(independentViews(['web_ui'], 'full'), 1, 'the checklist drafter');
  assert.equal(independentViews(['code'], 'full'), 0, 'a tester looks at the product; it is not an independent version');
  assert.equal(independentViews(['writing'], 'full'), 2);

  const started = async (level, tier, message = sum) => {
    const f = fixture();
    const enhancer = new ReasoningEnhancer(f.api);
    if (tier) enhancer.armTier(KEY, tier);
    if (level) await enhancer.prepare(ask(level, message));
    enhancer.beforePromptBuild({prompt: message}, {sessionKey: KEY});
    // The engine starts its passes in the background: wait until the call count stops changing
    // (a fixed 5 ms was flaky under load).
    for (let last = -1, stable = 0; stable < 3;) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      stable = f.calls.length === last ? stable + 1 : 0;
      last = f.calls.length;
    }
    return {f, enhancer, solvers: solverCalls(f.calls)};
  };
  assert.equal((await started('max', '')).solvers.length, 2, 'Max alone: two engine passes');
  assert.equal((await started('max', 'boost')).solvers.length, 2, 'boost sends no helpers of its own');
  assert.equal((await started('max', 'full')).solvers.length, 0, 'the full tier\'s two solvers are the two versions');
  const ultra = await started('ultra', 'full');
  assert.equal(ultra.solvers.length, 1, 'Ultra wants three: two from the tier, one topped up');
  assert.match(ultra.solvers[0].prompt, /先逐条列出题目里的全部要求/, 'the top-up takes the angle the tier\'s solvers do not use');
  assert.deepEqual([ultra.enhancer.status({sessionKey: KEY}).recipe.tierViews, ultra.enhancer.status({sessionKey: KEY}).recipe.engineSolvers], [2, 1]);
  assert.equal((await started('', 'full')).solvers.length, 0, 'the full tier alone no longer duplicates its own solvers');
  assert.equal((await started('', 'full', '给 utils.py 里的 parse_date 加一个单元测试')).solvers.length, 1);
});

test('the one delivery review compares against the versions from both systems, and tops up what the tier never sent', async () => {
  const message = '求方程 x² = 4 的所有实数解';
  // The tier's helpers came back: the reviewer gets them, and nothing is done twice.
  const withViews = fixture();
  const reviewed = new ReasoningEnhancer(withViews.api, {tierViews: () => [{role: 'solver', text: '候选 A：x = 2 或 x = -2'}, {role: 'solver', text: '候选 B：x = ±2'}, {role: 'reviewer', text: ''}]});
  reviewed.armTier(KEY, 'full');
  await reviewed.prepare(ask('max', message));
  reviewed.beforePromptBuild({prompt: message}, {sessionKey: KEY});
  assert.deepEqual(await reviewed.agentEnded(turn(message, 'x = 2 或 x = -2。', [['exec', '4']]), {sessionKey: KEY}), {reviewed: true, pass: true});
  assert.equal(solverCalls(withViews.calls).length, 0);
  assert.equal(auditCalls(withViews.calls).length, 1);
  assert.match(auditCalls(withViews.calls)[0].prompt, /候选 A：x = 2 或 x = -2[\s\S]*候选 B：x = ±2/);

  // The model never sent its helpers (no such tool, or it ignored the one reminder): the missing versions are made now.
  const without = fixture();
  const backfilled = new ReasoningEnhancer(without.api, {tierViews: () => []});
  backfilled.armTier(KEY, 'full');
  await backfilled.prepare(ask('max', message));
  backfilled.beforePromptBuild({prompt: message}, {sessionKey: KEY});
  assert.equal(solverCalls(without.calls).length, 0);
  await backfilled.agentEnded(turn(message, 'x = 2 或 x = -2。', [['exec', '4']]), {sessionKey: KEY});
  assert.equal(solverCalls(without.calls).length, 2, 'two versions were owed by the tier');
  assert.match(auditCalls(without.calls)[0].prompt, /独立解答 1[\s\S]*独立解答 2/);
});

test('the contract says who makes each independent version and which gaps are only reminded once', () => {
  const both = buildContract({level: 'ultra', workTier: 'full', kinds: ['standard_answer'], tierViews: independentViews(['standard_answer'], 'full'), mode: 'chat'});
  assert.deepEqual([both.copies, both.copiesBy, both.rounds, both.recompute], [3, {tier: 2, engine: 1}, 3, true]);
  assert.deepEqual(both.pushes, {roles: 1, final: 1});
  assert.equal(both.roles, 'required');
  const base = buildContract({level: 'high', workTier: 'base', kinds: ['fact_check']});
  assert.deepEqual([base.strict, base.review, base.pushes, base.roles], [0, false, {roles: 0, final: 0}, 'advisory']);
  const social = buildContract({level: 'ultra', workTier: 'full', kinds: ['simple'], weight: 'social'});
  assert.deepEqual([social.copies, social.rounds, social.review, social.evidence, social.strict], [0, 0, false, [], 0]);
  assert.deepEqual([social.pushes, social.roles, social.continuationLimit, social.planList], [{roles: 0, final: 0}, '', 0, false], 'nothing to remind or continue for a greeting');
  const carry = buildContract({level: 'max', workTier: 'boost', weight: 'carry', hasTask: false});
  assert.deepEqual([carry.copies, carry.review], [0, true]);
  assert.equal(buildContract({level: 'low', workTier: 'boost', levelCopies: 0, levelRounds: 0, levelCritic: false}).concise, false, 'concise comes from the recipe, not from the level name');
  // "Faster" depends on the model (its lowest level is above the chosen one), so the caller passes it in.
  const faster = buildContract({level: 'low', workTier: 'boost', kinds: ['data_charts'], levelCopies: 0, levelRounds: 0, levelCritic: false, levelBrevity: true});
  assert.deepEqual([faster.concise, faster.review, faster.rounds, faster.evidence.includes('delivery')], [true, true, 1, true], 'short prose, every check kept');
  assert.equal(buildContract({level: 'low', levelCopies: 0, levelRounds: 0, levelCritic: false, levelBrevity: true}).concise, false, 'without a rigor tier "faster" is just faster');
  for (const level of LEVELS) for (const workTier of TIERS) {
    const contract = buildContract({level, workTier, kinds: ['document']});
    assert.equal(contract.copies, contract.copiesBy.tier + contract.copiesBy.engine, `${level}/${workTier}`);
    assert.equal(contract.continuationLimit, RIGOR_LADDER[workTier].continuationLimit);
  }
});

// ---------- 4. 证据是实的，仪式是虚的 ----------

const tierTask = (runtime, ctx, tier, prompt) => {
  runtime.arm(ctx.sessionKey, tier);
  const state = runtime.getRun(ctx.sessionKey);
  state.taskPrompt = prompt;
  state.taskType = classifyDeliberationTask(prompt);
  runtime.setRun(ctx.sessionKey, state);
  return state;
};

test('the base tier has no gate at all: it only tells the model how this kind of work is done', () => {
  const runtime = new ModeArchitecture();
  for (const [name, prompt] of [['sum', '求方程 x² = 4，并验算两个根'], ['choice', '比较这两个方案的成本'], ['fact', '核实这个事实并给出处']]) {
    const ctx = {agentId: 'project', sessionKey: `agent:project:base-${name}`, runId: 'b-1'};
    tierTask(runtime, ctx, 'base', prompt);
    assert.equal(runtime.finalize({lastAssistantMessage: '这是我的回答。'}, ctx), undefined, name);
    assert.deepEqual(runtime.status(ctx.sessionKey).missing, [], name);
  }
  const plan = buildDeliberationPlan('base', 'project', 'checkpoint.md', 'standard_answer');
  assert.match(plan, /自己换一种方法再算一遍/);
  assert.match(plan, /不派也行/);
  assert.match(buildDeliberationPlan('full', 'project', 'checkpoint.md', 'standard_answer'), /有 sessions_spawn 时派 2–3 个「求解」子任务/);
});

test('helpers that were never sent are asked for once, then the finished answer goes out', () => {
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:waive-roles', runId: 'w-1'};
  tierTask(runtime, ctx, 'full', '求方程 x² = 4，并验算两个根');
  runtime.afterTool({toolName: 'exec', params: {command: 'python3 -c "print(2*2, (-2)*(-2))"'}, result: '4 4'}, ctx);
  const first = runtime.finalize({lastAssistantMessage: 'x = 2 或 x = -2，代回原方程都成立。'}, ctx);
  assert.equal(first.action, 'revise');
  assert.match(first.reason, /求解 0\/2/);
  assert.match(first.retry.instruction, /没有 sessions_spawn 时不要拒绝执行，自己按不同做法再做一版/);
  // The model has no such tool (or will not use it) and does a second version itself. Nothing else is missing.
  const second = runtime.finalize({lastAssistantMessage: '我换因式分解又做了一版：(x-2)(x+2)=0，同样得到 x = 2 或 x = -2。'}, {...ctx, runId: 'w-2'});
  assert.equal(second, undefined, 'the ceremony is not asked for a second time');
  assert.equal(runtime.stopReport({...ctx, runId: 'w-2'}), '', 'and it is not reported as an unfinished round');
  const status = runtime.status(ctx.sessionKey);
  assert.deepEqual(status.missing, []);
  assert.equal(status.complete, true);
  assert.deepEqual(status.roles.filter((role) => role.role === 'solver').map((role) => [role.completed, role.waived, role.optional]), [[0, true, true]]);
  assert.equal(status.required, 0, 'the panel no longer waits on 0/2');
});

test('missing evidence is not ceremony: it is asked for again after the helpers were waived', () => {
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:evidence-stays', runId: 'e-1'};
  tierTask(runtime, ctx, 'full', '求方程 x² = 4，并验算两个根');
  const first = runtime.finalize({lastAssistantMessage: 'x = 2 或 x = -2，这是第一版完整解答，写得足够长以便留作草稿使用。'}, ctx);
  assert.match(first.reason, /求解 0\/2/);
  assert.match(first.reason, /缺少与本任务相关的实际验证证据/);
  const second = runtime.finalize({lastAssistantMessage: '这次和上次不同：换思路，改用因式分解重新推导，结论仍是 x = 2 或 x = -2。'}, {...ctx, runId: 'e-2'});
  assert.equal(second.action, 'revise');
  assert.doesNotMatch(second.reason, /求解/);
  assert.match(second.reason, /缺少与本任务相关的实际验证证据/);
});

test('unrestricted mode keeps asking for its helpers exactly as before', () => {
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'unrestricted', sessionKey: 'agent:unrestricted:roles', runId: 'u-1'};
  tierTask(runtime, ctx, 'base', '求方程 x² = 4，并验算两个根');
  assert.deepEqual(deliberationRequirements('base', 'none', 'standard_answer').roles, {solver: 2});
  assert.match(runtime.finalize({lastAssistantMessage: '还没解完。'}, ctx).reason, /未完成|实际结果|继续/);
  const second = runtime.finalize({lastAssistantMessage: '这次和上次不同：换思路，改用因式分解重新推导。'}, {...ctx, runId: 'u-2'});
  assert.equal(second.action, 'revise', 'still pushed after the first reminder');
  assert.ok(runtime.status(ctx.sessionKey).missing.some((item) => /求解 0\/2/.test(item)));
});

test('a final that lacks the "your choice" sentence is reminded once, not held back for it', () => {
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:final-once', runId: 'f-1'};
  tierTask(runtime, ctx, 'boost', '比较这两个方案的成本');
  const first = runtime.finalize({lastAssistantMessage: '方案 A 上线更快；方案 B 以后更好维护。'}, ctx);
  assert.equal(first.action, 'revise');
  assert.match(first.reason, /最终答复还没有交给用户选择/);
  assert.match(first.retry.instruction, /不用再调用工具，直接给出完整的最终回复/);
  const second = runtime.finalize({lastAssistantMessage: '方案 A 上线更快，适合赶时间；方案 B 以后更好维护。我会选 B，你来定。'}, {...ctx, runId: 'f-2'});
  assert.equal(second, undefined);
  assert.deepEqual(runtime.status(ctx.sessionKey).missing, []);
});

// ---------- 5. 推不动了：交成品，照实说 ----------

test('when the pushes run out the finished work is delivered with an honest note, whole and first', () => {
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:deliver-note', runId: 'n-1'};
  tierTask(runtime, ctx, 'boost', '求方程 x² = 4，并验算两个根');
  const long = 'x = 2 或 x = -2。' + '推导如下：把方程写成 (x-2)(x+2)=0，两个因式分别为零。'.repeat(400);
  assert.ok(long.length > 6000, 'longer than the old 6000-character draft cut');
  assert.equal(runtime.finalize({lastAssistantMessage: long}, ctx).action, 'revise');
  assert.equal(runtime.finalize({lastAssistantMessage: long}, {...ctx, runId: 'n-2'}), undefined);
  const report = runtime.stopReport({...ctx, runId: 'n-2'});
  assert.ok(report.startsWith(long), 'the whole reply, not a truncated reference copy');
  assert.match(report.slice(long.length), /^\n\n有几步碧琪还没能亲眼核对：缺少与本任务相关的实际验证证据。用之前请先看一眼，或者说一声「接着核对」。$/);
  assert.equal(unverifiedNote([]), '');
});

test('a draft the delivery gate could not confirm never goes out without a caveat', () => {
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:gate-note', runId: 'g-1'};
  tierTask(runtime, ctx, 'boost', '请解释闭包是什么');
  // The tier itself misses nothing; the delivery gate asked for a revision twice and nothing changed.
  const draft = '文件已经改好并保存了，闭包就是函数加上它能访问的外部变量，下面用一个计数器的例子说明。';
  const gate = {action: 'revise', reason: '全局交付真实性门禁：回复说做完了，但工具记录里没有对应动作', retry: {instruction: '补上真实结果'}};
  assert.equal(runtime.prepareRetryDecision(gate, {lastAssistantMessage: draft}, ctx).action, 'revise');
  assert.equal(runtime.prepareRetryDecision(gate, {lastAssistantMessage: draft}, {...ctx, runId: 'g-2'}).action, 'revise');
  assert.equal(runtime.prepareRetryDecision(gate, {lastAssistantMessage: draft}, {...ctx, runId: 'g-3'}), undefined);
  const report = runtime.stopReport({...ctx, runId: 'g-3'});
  assert.ok(report.startsWith(draft));
  assert.match(report, /有几步碧琪还没能亲眼核对：目前的记录还不足以核实这个结果。/);
});

test('a marathon with milestones still open is honestly reported as not finished', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-ladder-marathon-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const checkpoint = path.join(dir, 'checkpoint.md');
  fs.writeFileSync(checkpoint, '- [x] 搭好页面 — 验证：截图\n- [ ] 加导出功能 — 验证：导出一次\n');
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:marathon-open', runId: 'm-1'};
  tierTask(runtime, ctx, 'marathon', '求方程 x² = 4，并验算两个根').checkpointFile = checkpoint;
  runtime.afterTool({toolName: 'exec', params: {command: 'python3 -c "print(2*2)"'}, result: '4'}, ctx);
  // 这一版把事情说成了已经交付，其实检查点里还有一个里程碑没勾。
  const draft = '页面已经搭好并截图看过，下面是目前的进展说明，以及每个部分是怎么做出来的、放在哪里。';
  assert.equal(runtime.finalize({lastAssistantMessage: draft}, ctx).action, 'revise');
  assert.equal(runtime.finalize({lastAssistantMessage: draft}, {...ctx, runId: 'm-2'}).action, 'revise');
  assert.equal(runtime.finalize({lastAssistantMessage: draft}, {...ctx, runId: 'm-3'}), undefined);
  const report = runtime.stopReport({...ctx, runId: 'm-3'});
  assert.match(report, /^本轮未完成：/);
  assert.match(report, /上一版回复（还没核对完，仅供参考）/);
});
