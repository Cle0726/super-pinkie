// B3 截断吞正文续 · reasoning.mjs 余项（同 #241 / tests/services-slice-truncation.test.mjs）：
// 交给独立解答、审稿员、任务面板的正文不再静默 slice(0, N)，改为全文，真超上限时在文本里明说截了多少。
// 五处：「继续」所指的那条请求（旧 4000）、独立解答 / 审稿员交回的原文（旧 6000）、做事档位子任务交回的
// 独立做法（旧 6000）、没经 prepare 登记的这一轮原话（旧 MAX_MESSAGE 12000）、存进任务记录的主回复（旧 6000）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as reasoning from '../services/mode-architecture/reasoning.mjs';

const {ReasoningEnhancer, ReviewStore} = reasoning;
const SOLVER = /独立解题助手|独立起草助手|验收清单助手/;
const GEMINI = {id: 'gemini-3.8-flash-tiered', reasoning: true, compat: {supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh']}};
const KEY = 'agent:main:slice3';
const MATH = '求方程 x² = 4 的所有实数解';

function fixture(t, run = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-slice3-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const calls = [];
  const api = {
    config: {
      agents: {defaults: {workspace: '/tmp', model: {primary: `mm/${GEMINI.id}`}}, list: []},
      models: {providers: {mm: {models: [GEMINI]}}},
    },
    runtime: {agent: {
      session: {getSessionEntry: () => ({providerOverride: 'mm', modelOverride: GEMINI.id})},
      runEmbeddedAgent: async (params) => {
        calls.push(params);
        const text = run ? run(params) : undefined;
        return {payloads: [{text: text ?? (SOLVER.test(params.prompt) ? '对照稿' : '{"pass": true}')}], meta: {}};
      },
    }},
    on() {},
    registerGatewayMethod() {},
  };
  const make = (options = {}) => new ReasoningEnhancer(api, {store: new ReviewStore(root), ...options});
  return {calls, make};
}

const ask = (level, message) => ({sessionKey: KEY, requestId: `request-${Math.random().toString(36).slice(2, 10)}`, level, message});
const turn = (prompt, reply, tools = []) => ({success: true, messages: [
  {role: 'user', content: prompt},
  ...tools.map(([name, text]) => ({role: 'toolResult', toolName: name, content: [{type: 'text', text}]})),
  {role: 'assistant', content: [{type: 'text', text: reply}]},
]});
const solverCalls = (calls) => calls.filter((call) => SOLVER.test(call.prompt));
const auditCalls = (calls) => calls.filter((call) => /验收员|审稿人/.test(call.prompt));

async function carryOn(t, task) {
  const f = fixture(t);
  const enhancer = f.make();
  await enhancer.prepare(ask('max', '继续'));
  const earlier = [
    {role: 'user', content: task},
    {role: 'assistant', content: [{type: 'text', text: '好，页面骨架搭好了，还差导出功能。'}]},
  ];
  enhancer.beforePromptBuild({prompt: '继续', messages: earlier}, {sessionKey: KEY});
  assert.deepEqual(await enhancer.agentEnded(turn('继续', '导出功能加好了。', [['write', 'ok']]), {sessionKey: KEY}), {reviewed: true, pass: true});
  return f.calls;
}

test('「继续」：它所指的那条请求比旧的 4000 字长时，审稿员和独立做法看到全文', async t => {
  const task = `${'帮我做一个记账网页，手机上也要能用。'.repeat(300)}TASK-TAIL-导出 CSV`;
  assert.ok(task.length > 4000 && task.length < 20_000);
  const calls = await carryOn(t, task);
  const audit = auditCalls(calls)[0];
  assert.ok(audit, 'the review pass ran');
  assert.match(audit.prompt, /这一句是让接着做之前这条请求：[\s\S]*TASK-TAIL-导出 CSV/, 'the end of the continued request reaches the reviewer');
  assert.doesNotMatch(audit.prompt, /已截断/);
  assert.ok(solverCalls(calls).length > 0, 'independent passes ran');
  for (const call of solverCalls(calls)) assert.match(call.prompt, /TASK-TAIL-导出 CSV/);
});

test('「继续」：那条请求真超过上限时明说截了多少', async t => {
  const task = `${'帮我做一个记账网页。'.repeat(2500)}TASK-TAIL-超长`;
  const calls = await carryOn(t, task);
  const audit = auditCalls(calls)[0].prompt;
  assert.match(audit, new RegExp(`之前这条请求太长，已截断 ${task.length - 20_000} 字`));
  assert.doesNotMatch(audit, /TASK-TAIL-超长/);
});

async function reviewed(t, run, options = {}) {
  const f = fixture(t, run);
  const enhancer = f.make(options.enhancer);
  if (options.tier) enhancer.armTier(KEY, options.tier);
  await enhancer.prepare(ask('max', MATH));
  enhancer.beforePromptBuild({prompt: MATH}, {sessionKey: KEY});
  const outcome = await enhancer.agentEnded(turn(MATH, 'x = 2 或 x = -2。', [['exec', '4']]), {sessionKey: KEY});
  return {calls: f.calls, outcome, enhancer};
}

test('独立解答：交回的原文比旧的 6000 字长时，审稿员看到全文', async t => {
  const long = `${'先把方程两边开平方，再检查正负两个根。'.repeat(400)}SOLVER-TAIL-x=±2`;
  assert.ok(long.length > 6000);
  const {calls, outcome} = await reviewed(t, params => (SOLVER.test(params.prompt) ? long : undefined));
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  assert.ok(solverCalls(calls).length > 0, 'independent passes ran');
  assert.match(auditCalls(calls)[0].prompt, /SOLVER-TAIL-x=±2/);
});

test('独立解答：交回的原文真超过上限时明说截了多少', async t => {
  const {calls} = await reviewed(t, params => (SOLVER.test(params.prompt) ? 'y'.repeat(70_000) : undefined));
  assert.match(auditCalls(calls)[0].prompt, /这份输出太长，已截断 10000 字/);
});

test('审稿员：结论 JSON 超过旧的 6000 字时不再被截成坏 JSON，验收照常给出结论', async t => {
  // 旧逻辑把审稿员的输出截到 6000 字，JSON 少了结尾的括号，两次都解析失败，验收停在「没核对」。
  const verdict = JSON.stringify({pass: true, note: '逐条核对过了，没有发现问题。'.repeat(500)});
  assert.ok(verdict.length > 6000);
  const {outcome, enhancer} = await reviewed(t, params => (/验收员|审稿人/.test(params.prompt) ? verdict : undefined));
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  assert.equal(enhancer.status({sessionKey: KEY}).phase, 'passed');
});

test('做事档位：子任务交回的独立做法比旧的 6000 字长时审稿员看到全文，真超上限时明说截了多少', async t => {
  const view = `${'换一种方法：代入检验 2 和 -2。'.repeat(400)}VIEW-TAIL-代入成立`;
  const huge = `${'z'.repeat(25_000)}VIEW-TAIL-超长`;
  assert.ok(view.length > 6000 && view.length < 20_000);
  const {calls, outcome} = await reviewed(t, null, {tier: 'full', enhancer: {tierViews: () => [{role: 'solver', text: view}, {role: 'solver', text: huge}]}});
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  const audit = auditCalls(calls)[0].prompt;
  assert.match(audit, /VIEW-TAIL-代入成立/);
  assert.match(audit, new RegExp(`这份独立做法太长，已截断 ${huge.length - 20_000} 字`));
  assert.doesNotMatch(audit, /VIEW-TAIL-超长/);
});

async function tierOnly(t, prompt) {
  const f = fixture(t);
  const enhancer = f.make();
  enhancer.armTier(KEY, 'full');
  assert.match(enhancer.beforePromptBuild({prompt, messages: []}, {sessionKey: KEY}).appendContext, /交付验收/);
  assert.deepEqual(await enhancer.agentEnded(turn(prompt, '整理好了。', [['write', 'ok']]), {sessionKey: KEY}), {reviewed: true, pass: true});
  return auditCalls(f.calls)[0].prompt;
}

test('只选了做事档位（没经 prepare 登记原话）：这一轮原话超过 12000 字时不再静默截', async t => {
  const prompt = `${'请把这份需求文档逐条整理成表格。'.repeat(800)}PROMPT-TAIL-最后一条`;
  assert.ok(prompt.length > 12_000 && prompt.length < 20_000);
  const audit = await tierOnly(t, prompt);
  assert.match(audit, /【用户这一轮的原话】\n[\s\S]*PROMPT-TAIL-最后一条/);
});

test('只选了做事档位：这一轮原话真超过上限时明说截了多少', async t => {
  const prompt = `${'请把这份需求文档逐条整理成表格。'.repeat(1600)}PROMPT-TAIL-超长`;
  const audit = await tierOnly(t, prompt);
  assert.match(audit, new RegExp(`用户这一轮的原话太长，已截断 ${prompt.length - 20_000} 字`));
  assert.doesNotMatch(audit, /PROMPT-TAIL-超长/);
});

async function mainJobOutput(t, reply) {
  const f = fixture(t);
  const enhancer = f.make();
  await enhancer.prepare(ask('max', MATH));
  enhancer.beforePromptBuild({prompt: MATH}, {sessionKey: KEY});
  await enhancer.agentEnded(turn(MATH, reply, [['exec', '4']]), {sessionKey: KEY});
  const main = enhancer.status({sessionKey: KEY}).jobs.find(job => job.role === 'main');
  assert.ok(main, 'the main job is listed');
  // 任务面板点开一行走 pinkie.work.detail → reasoning.job，直接显示 output。
  const detail = enhancer.job({sessionKey: KEY, jobId: main.id});
  assert.equal(detail.found, true);
  return detail.output;
}

test('任务面板：主回复比旧的 6000 字长时，点开看到的是全文', async t => {
  const reply = `${'x = 2 或 x = -2，下面是推导。'.repeat(450)}REPLY-TAIL-结论`;
  assert.ok(reply.length > 6000);
  assert.equal(await mainJobOutput(t, reply), reply);
});

test('任务面板：主回复真超过上限时明说截了多少', async t => {
  const output = await mainJobOutput(t, `${'r'.repeat(70_000)}REPLY-TAIL-超长`);
  assert.match(output, /这条回复太长，已截断 \d+ 字/);
  assert.doesNotMatch(output, /REPLY-TAIL-超长/);
});
