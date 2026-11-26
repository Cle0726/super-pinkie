// B3b · services/ 下「正文 slice(0, N) 之后又交给模型或用户看」的复发防护（同 #199：截断吞正文）。
// 三处：交付验收给审稿员的最终回复、外部引擎交回 / 递话、PR 审查的 diff。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as reasoning from '../services/mode-architecture/reasoning.mjs';
import * as engineTask from '../services/mode-architecture/engines-task.mjs';
import * as prFlow from '../services/mode-architecture/pr-flow.mjs';

// 整个模块导入：只回退修复时，每条用例按行为变红，而不是整份文件在导入时就挂掉。
const {ReasoningEnhancer, ReviewStore} = reasoning;
const {EngineTasks, reportOf} = engineTask;
const {reviewPrompt} = prFlow;
const replyForReview = text => { assert.equal(typeof reasoning.replyForReview, 'function', 'reasoning.mjs exports replyForReview'); return reasoning.replyForReview(text); };
const REPORT_KEEP = engineTask.REPORT_KEEP ?? 20_000;
const REVIEW_DIFF_MAX = prFlow.REVIEW_DIFF_MAX ?? 200_000;

const SOLVER = /独立解题助手|独立起草助手|验收清单助手/;
const GEMINI = {id: 'gemini-3.8-flash-tiered', reasoning: true, compat: {supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh']}};

function reviewFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-slice-review-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const calls = [];
  const api = {
    config: {
      agents: {defaults: {workspace: '/tmp', model: {primary: 'mm/gemini-3.8-flash-tiered'}}, list: [{id: 'learning', model: 'mm/gemini-3.8-flash-tiered'}]},
      models: {providers: {mm: {models: [GEMINI]}}},
    },
    runtime: {agent: {
      session: {getSessionEntry: () => ({providerOverride: 'mm', modelOverride: 'gemini-3.8-flash-tiered'})},
      runEmbeddedAgent: async (params) => { calls.push(params); return {payloads: [{text: SOLVER.test(params.prompt) ? '对照稿' : '{"pass": true}'}], meta: {}}; },
    }},
    on: () => {},
    registerGatewayMethod: () => {},
  };
  const enhancer = new ReasoningEnhancer(api, {store: new ReviewStore(root), runProcess: async () => ({stdout: '{"ok":true}'}), cliEntry: '/x/openclaw.mjs'});
  return {enhancer, calls};
}

const MESSAGE = '把 report.md 写成 3 段';
const runEvent = reply => ({success: true, messages: [
  {role: 'user', content: MESSAGE},
  {role: 'toolResult', toolName: 'write', content: [{type: 'text', text: 'Successfully wrote 300 bytes'}]},
  {role: 'assistant', content: [{type: 'text', text: reply}]},
]});

test('交付验收：审稿员看到长回复的全文，后半截不被悄悄截掉', async t => {
  const {enhancer, calls} = reviewFixture(t);
  await enhancer.prepare({tier: 'max', requestId: 'request-slice-0001', sessionKey: 'agent:learning:one', message: MESSAGE, history: []});
  enhancer.beforePromptBuild({prompt: MESSAGE}, {sessionKey: 'agent:learning:one'});
  // 旧逻辑截到前 8000 字：9000 多字的回复，结尾那段审稿员从来看不到。
  const reply = `${'第一段内容写得很长。'.repeat(900)}\n结尾那段：REPLY-TAIL-第三段`;
  assert.ok(reply.length > 9000);
  const outcome = await enhancer.agentEnded(runEvent(reply), {sessionKey: 'agent:learning:one'});
  assert.deepEqual(outcome, {reviewed: true, pass: true});
  const audit = calls.find(call => /验收员|审稿人/.test(call.prompt));
  assert.ok(audit, 'the review pass ran');
  assert.match(audit.prompt, /REPLY-TAIL-第三段/, 'the end of the delivered reply reaches the reviewer');
  // 机械统计按全文算，不按截断后的算。
  const nonSpace = reply.replace(/\s/g, '').length;
  assert.match(audit.prompt, new RegExp(`${nonSpace} 个非空白字符`));
});

test('交付验收：真超过上限时明说截了多少，不装作是全文', () => {
  const short = '短回复';
  assert.equal(replyForReview(short), short);
  const huge = 'x'.repeat(70_000);
  const shown = replyForReview(huge);
  assert.ok(shown.length < huge.length);
  assert.match(shown, /后面还有 10000 字没有放进来/);
});

test('外部引擎交回：长回话完整转给 Metre，超长时标明已截断', () => {
  const tail = 'ENGINE-TAIL-最后一句';
  const long = `${'它做了很多事。'.repeat(1200)}${tail}`;
  assert.ok(long.length > 6000, 'longer than the old 6000 cut');
  const done = reportOf({items: [{kind: 'reply', text: long}], changes: []}, {engineName: 'Codex', status: 'done'});
  assert.ok(done.endsWith(tail), 'the end of the engine reply survives');
  const failed = reportOf({items: [{kind: 'reply', text: `${'半路。'.repeat(1000)}${tail}`}], changes: [], error: {text: '超时'}}, {engineName: 'Codex', status: 'failed'});
  assert.match(failed, new RegExp(tail), 'the old 2000 cut on failure is gone');
  const stopped = reportOf({items: [{kind: 'reply', text: `${'停了。'.repeat(1000)}${tail}`}], changes: []}, {engineName: 'Codex', status: 'stopped'});
  assert.match(stopped, new RegExp(tail));
  const huge = reportOf({items: [{kind: 'reply', text: 'y'.repeat(REPORT_KEEP + 500)}], changes: [{file: 'a.md', counted: false}]}, {engineName: 'Codex', status: 'done'});
  assert.match(huge, /已截断：后面还有约 500 字没放进来/);
  assert.match(huge, /改了：a\.md$/, 'the changed-files line still follows');
});

function engineTasks() {
  const PARENT = 'agent:metre:main-1';
  const KEY = 'agent:metre:pinkie-child:' + 'a'.repeat(32);
  const records = {[KEY]: {kind: 'external', parentKey: PARENT, threadId: 'thread-1'}};
  const sent = [];
  const tasks = new EngineTasks({
    bridge: {send: async params => { sent.push(params); return {status: 'running'}; }},
    lineage: {lineage: () => records, updateLineage: (key, fields) => (records[key] = {...records[key], ...fields})},
    schedule: () => null,
  });
  return {tasks, sent, PARENT, KEY};
}

test('外部引擎递话：超长的话不悄悄截一半递过去', async () => {
  const {tasks, sent, PARENT, KEY} = engineTasks();
  const ok = `${'请再改一下。'.repeat(1800)}SAY-TAIL`;
  assert.ok(ok.length <= 12_000);
  await tasks.run(PARENT, 'r1', {action: 'say', target: KEY, text: ok});
  assert.equal(sent.at(-1).text, ok, 'a message within the limit goes over whole');
  const tooLong = 'z'.repeat(12_001);
  await assert.rejects(tasks.run(PARENT, 'r1', {action: 'say', target: KEY, text: tooLong}), /超过一次能递的 12000 字，没有递出去/);
  assert.equal(sent.length, 1, 'nothing half-cut reached the engine');
});

const PR = {number: 7, title: '加一个按钮', headRefName: 'feat/button', baseRefName: 'main'};

test('PR 审查：diff 在上限内时提示词和原来一样', () => {
  const diff = 'diff --git a/x b/x\n+1';
  assert.equal(reviewPrompt({pr: PR, diff}), [
    '审查这个 PR：#7「加一个按钮」（feat/button → main）。只读，不要改文件、不要提交、不要合并。',
    '找真正的问题（错误、漏掉的情况、安全、和说明不符），不要挑风格。',
    '只回一个 JSON 数组，每条 {"severity":"high|medium|low","file":"相对路径","line":行号,"title":"一句话","detail":"为什么、怎么改"}；没有问题就回 []。',
    '', '```diff', diff, '```',
  ].join('\n'));
});

test('PR 审查：diff 超长时明说只给了前一部分，没看到的不能当没问题', () => {
  const diff = `${'+line\n'.repeat(Math.ceil(REVIEW_DIFF_MAX / 6) + 100)}diff --git a/TAILFILE b/TAILFILE`;
  assert.ok(diff.length > REVIEW_DIFF_MAX);
  const prompt = reviewPrompt({pr: PR, diff});
  assert.match(prompt, new RegExp(`只放了前 ${REVIEW_DIFF_MAX} 字`));
  assert.match(prompt, /没看到的部分不能算没问题/);
  assert.match(prompt, /（diff 到这里被截断）$/);
  assert.doesNotMatch(prompt, /TAILFILE/);
});
