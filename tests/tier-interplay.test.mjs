import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CleKkAuditLog, CleKkSupervisor, CompletionIntegrityGuard} from '../services/mode-architecture/index.mjs';
import {ReasoningEnhancer, ReviewStore} from '../services/mode-architecture/reasoning.mjs';
import {evidenceSignals} from '../services/mode-architecture/work-kinds.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-tier-interplay-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const calls = [];
  const api = {
    config: {agents: {defaults: {workspace: root}}, models: {providers: {mm: {models: [
      {id: 'model', reasoning: true, compat: {supportedReasoningEfforts: ['high']}},
    ]}}}},
    runtime: {agent: {
      session: {getSessionEntry: () => ({providerOverride: 'mm', modelOverride: 'model'})},
      runEmbeddedAgent: async params => {
        calls.push(params);
        return {payloads: [{text: /审稿人|验收员/.test(params.prompt) ? '{"pass":true}' : '独立意见'}]};
      },
    }},
  };
  return {root, calls, enhancer: new ReasoningEnhancer(api, {store: new ReviewStore(path.join(root, 'reviews'))})};
}

test('a queued message cannot replace the review of the run already answering', async t => {
  const {enhancer, calls} = fixture(t);
  const sessionKey = 'agent:project:queued-review';
  const first = {sessionKey, level: 'max', requestId: 'request-first-0001', message: '第一件事：检查甲文件'};
  const second = {sessionKey, level: 'max', requestId: 'request-second-0002', message: '第二件事：检查乙文件'};
  await enhancer.prepare(first);
  enhancer.beforePromptBuild({prompt: first.message}, {sessionKey, runId: 'run-first'});
  await enhancer.prepare(second);
  const result = await enhancer.agentEnded({success: true, messages: [
    {role: 'assistant', content: [{type: 'text', text: '甲文件检查结果。'}]},
  ]}, {sessionKey, runId: 'run-first'});
  assert.equal(result.reviewed, true);
  const review = calls.find(call => /审稿人|验收员/.test(call.prompt));
  assert.match(review.prompt, /第一件事：检查甲文件/);
  assert.doesNotMatch(review.prompt, /第二件事：检查乙文件/);
  assert.match(enhancer.beforePromptBuild({prompt: second.message}, {sessionKey, runId: 'run-second'}).appendContext, /交付验收/);
});

test('a newly selected work tier is not merged into an older prepared message', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:project:tier-switch';
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'request-earlier-01', message: '第一件事'});
  enhancer.armTier(sessionKey, 'full');
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-earlier-01'}).workTier, '');
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'request-next-00002', message: '第二件事'});
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-next-00002'}).workTier, 'full');
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-earlier-01'}).workTier, '');
});

test('two runs in one session keep their own review when they finish out of order', async t => {
  const {enhancer, calls} = fixture(t);
  const sessionKey = 'agent:project:overlapping';
  for (const [requestId, runId, message] of [
    ['request-first-0003', 'run-first', '检查甲文件'],
    ['request-second-004', 'run-second', '检查乙文件'],
  ]) {
    await enhancer.prepare({sessionKey, level: 'max', requestId, message});
    enhancer.beforePromptBuild({prompt: message}, {sessionKey, runId});
  }
  for (const [runId, reply] of [['run-second', '乙文件结果'], ['run-first', '甲文件结果']]) {
    const result = await enhancer.agentEnded({success: true, messages: [{role: 'assistant', content: reply}]}, {sessionKey, runId});
    assert.equal(result.reviewed, true, runId);
  }
  const reviews = calls.filter(call => /审稿人|验收员/.test(call.prompt));
  assert.equal(reviews.length, 2);
  assert.match(reviews[0].prompt, /检查乙文件[\s\S]*乙文件结果/);
  assert.match(reviews[1].prompt, /检查甲文件[\s\S]*甲文件结果/);
});

test('an explicitly supplied run ID distinguishes identical queued messages', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:project:identical-queue';
  const message = '请检查这个文件';
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'request-same-0001', runId: 'host-run-1', message});
  await enhancer.prepare({sessionKey, level: 'ultra', requestId: 'request-same-0002', runId: 'host-run-2', message});
  enhancer.beforePromptBuild({prompt: message}, {sessionKey, runId: 'host-run-2'});
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-same-0002'}).phase, 'answering');
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-same-0001'}).phase, 'armed');
  enhancer.beforePromptBuild({prompt: message}, {sessionKey, runId: 'host-run-1'});
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-same-0001'}).phase, 'answering');
  await assert.rejects(enhancer.prepare({sessionKey, level: 'max', requestId: 'request-same-0003', runId: 'host-run-2', message}), /运行编号已绑定/);
});

test('a different run cannot steal a review already bound to a run ID', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:project:bound-run';
  const message = '请检查这个文件';
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'request-bound-001', runId: 'host-run-a', message});
  assert.equal(enhancer.beforePromptBuild({prompt: message}, {sessionKey, runId: 'host-run-b'}), undefined);
  const original = enhancer.store.get(sessionKey, {requestId: 'request-bound-001'});
  assert.equal(original.phase, 'armed');
  assert.equal(original.runId, 'host-run-a');
});

test('a long-running review is not expired before its correction run', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:project:long-review';
  const requestId = 'request-long-0001';
  await enhancer.prepare({sessionKey, level: 'max', requestId, runId: 'host-run-a', message: '检查这个文件'});
  const active = enhancer.store.get(sessionKey, {requestId});
  enhancer.store.set({...active, phase: 'fixing', createdAt: Date.now() - 2 * 60 * 60_000});
  enhancer.beforePromptBuild({prompt: `[pinkie-tier] 交付验收 [request=${requestId}] 继续`}, {sessionKey, runId: 'host-run-b'});
  assert.equal(enhancer.store.get(sessionKey, {requestId})?.phase, 'answering');
});

test('preparing the same request after restart never overwrites an active review', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:project:prepare-restart';
  const request = {sessionKey, level: 'max', workTier: 'full', requestId: 'request-restart-01', runId: 'host-run-a', message: '检查这个文件'};
  const initial = await enhancer.prepare(request);
  enhancer.beforePromptBuild({prompt: request.message}, {sessionKey, runId: request.runId});
  const restarted = new ReasoningEnhancer(enhancer.api, {store: enhancer.store});
  assert.deepEqual(await restarted.prepare(request), initial);
  assert.equal(restarted.store.get(sessionKey, {requestId: request.requestId}).phase, 'answering');
  await assert.rejects(restarted.prepare({...request, message: '另一条消息'}), /请求编号重复/);
  assert.equal(restarted.store.get(sessionKey, {requestId: request.requestId}).message, request.message);
});

test('an explicit work tier is combined with a native level without reusing an older selection', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:project:explicit-tier';
  enhancer.armTier(sessionKey, 'boost');
  const result = await enhancer.prepare({sessionKey, level: 'high', workTier: 'full', runId: 'host-run-full', requestId: 'request-full-0001', message: '做个网页'});
  assert.equal(result.prepared, true);
  assert.equal(result.workTier, 'full');
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-full-0001'}).workTier, 'full');
  assert.equal(enhancer.store.list(sessionKey).filter(item => !item.message).length, 0);
  enhancer.armTier(sessionKey, 'full');
  await enhancer.prepare({sessionKey, level: 'high', workTier: 'base', runId: 'host-run-base', requestId: 'request-base-0002', message: '另一条消息'});
  assert.equal(enhancer.store.list(sessionKey).filter(item => !item.message).length, 0);
});

test('an explicit tier binding never falls back to an unrelated or already active request', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:project:invalid-binding';
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'request-bound-002', message: '检查文件'});
  assert.equal(enhancer.armTier(sessionKey, 'full', {requestId: 'request-missing-01'}).armed, false);
  assert.equal(enhancer.store.list(sessionKey).length, 1);
  enhancer.beforePromptBuild({prompt: '检查文件'}, {sessionKey, runId: 'active-run'});
  assert.equal(enhancer.armTier(sessionKey, 'full', {requestId: 'request-bound-002'}).armed, false);
  assert.equal(enhancer.store.list(sessionKey).length, 1);
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-bound-002'}).workTier, '');
});

test('all nine levels and four explicit work tiers retain their own selections', async t => {
  const {enhancer} = fixture(t);
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra'];
  const tiers = ['base', 'boost', 'full', 'marathon'];
  for (const [tierIndex, workTier] of tiers.entries()) {
    for (const [levelIndex, level] of levels.entries()) {
      const sessionKey = `agent:project:matrix-${tierIndex}-${levelIndex}`;
      const requestId = `request-matrix-${tierIndex}-${levelIndex}`;
      const runId = `host-matrix-${tierIndex}-${levelIndex}`;
      const result = await enhancer.prepare({sessionKey, level, workTier, requestId, runId, message: '检查这个文件'});
      if (workTier !== 'base') assert.equal(result.prepared, true, `${workTier}/${level}`);
      if (!result.prepared) continue; // Native-only base levels have no review record.
      const stored = enhancer.store.get(sessionKey, {requestId});
      assert.equal(stored.level, level, `${workTier}/${level}`);
      assert.equal(stored.workTier, workTier === 'base' ? '' : workTier, `${workTier}/${level}`);
      assert.equal(stored.runId, runId, `${workTier}/${level}`);
    }
  }
});

test('an old single-file review is migrated without deleting other requests', async t => {
  const {root, enhancer} = fixture(t);
  const sessionKey = 'agent:project:old-review';
  const legacy = enhancer.store.file(sessionKey);
  fs.mkdirSync(path.dirname(legacy), {recursive: true});
  fs.writeFileSync(legacy, JSON.stringify({sessionKey, requestId: 'legacy-request-01', phase: 'armed', createdAt: Date.now()}));
  const old = enhancer.store.get(sessionKey, {requestId: 'legacy-request-01'});
  enhancer.store.set({...old, phase: 'answering'});
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'request-new-00001', message: '新任务'});
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'legacy-request-01'}).phase, 'answering');
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'request-new-00001'}).phase, 'armed');
  assert.ok(root);
});

test('unrestricted mode retains its existing single-review and tier merge behavior', async t => {
  const {enhancer} = fixture(t);
  const sessionKey = 'agent:unrestricted:legacy';
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'legacy-first-001', message: '第一件事'});
  await enhancer.prepare({sessionKey, level: 'max', requestId: 'legacy-second-02', message: '第二件事'});
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'legacy-first-001'}), null);
  assert.equal(enhancer.armTier(sessionKey, 'full').requestId, 'legacy-second-02');
  assert.equal(enhancer.store.get(sessionKey, {requestId: 'legacy-second-02'}).workTier, 'full');
});

test('a response that does not claim completion is not rejected based on guessed user intent', () => {
  for (const agent of ['main', 'project', 'thinking', 'learning']) {
    const guard = new CompletionIntegrityGuard();
    const ctx = {agentId: agent, sessionKey: `agent:${agent}:pending`};
    guard.begin({prompt: '帮我修改这个文件'}, ctx);
    assert.equal(guard.finalize({lastAssistantMessage: '我会先检查相关文件。'}, ctx), undefined, agent);
  }
});

test('an explicitly unfinished action is not mistaken for a completion claim', () => {
  for (const reply of ['文件还没修改完成。', '目前没有完成修改。', '页面还没有做好。', '文件尚未生成。']) {
    const guard = new CompletionIntegrityGuard();
    const ctx = {agentId: 'project', sessionKey: `agent:project:not-finished-${reply.length}`};
    guard.begin({prompt: '请修改文件并交付'}, ctx);
    assert.equal(guard.finalize({lastAssistantMessage: reply}, ctx), undefined, reply);
  }
});

test('an unsupported claim of success still fails the integrity check', () => {
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:false-success'};
  guard.begin({prompt: '帮我修改这个文件'}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '文件已经修改完成。'}, ctx)?.action, 'revise');
});

test('unsupported English action claims also require real evidence', () => {
  for (const reply of ['I modified the file.', 'The file was updated.', 'The tests passed.', 'I have sent the email.']) {
    const guard = new CompletionIntegrityGuard();
    const ctx = {agentId: 'project', sessionKey: `agent:project:english-${reply.length}`};
    guard.begin({prompt: '请修改文件并测试'}, ctx);
    assert.equal(guard.finalize({lastAssistantMessage: reply}, ctx)?.action, 'revise', reply);
  }
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:english-unfinished'};
  guard.begin({prompt: '请修改文件'}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: 'I have not modified the file yet.'}, ctx), undefined);
});

test('the same final is reminded once across hooks but never twice across runs', async () => {
  const guard = new CompletionIntegrityGuard();
  const supervisor = new CleKkSupervisor({integrity: guard, audit: new CleKkAuditLog('')});
  const ctx = {agentId: 'project', sessionKey: 'agent:project:one-reminder', runId: 'run-first'};
  supervisor.begin({prompt: '修复项目文件'}, ctx);
  const event = {lastAssistantMessage: '文件已经修复完成。'};
  assert.equal(supervisor.finalizeDecision(event, ctx)?.action, 'revise');
  assert.equal(supervisor.finalizeDecision(event, ctx)?.action, 'revise');
  const retry = {...ctx, runId: 'run-retry'};
  supervisor.begin({prompt: '[pinkie-watchdog] 接着核对'}, retry);
  assert.equal(supervisor.finalizeDecision(event, retry), undefined);
  const final = supervisor.beforeMessageWrite({message: {
    role: 'assistant', stopReason: 'stop', content: [{type: 'text', text: event.lastAssistantMessage}],
  }}, retry);
  const text = final?.message?.content?.map(part => part.text || '').join('') || '';
  assert.match(text, /文件已经修复完成/);
  assert.match(text, /还没能确认/);
  const payload = await supervisor.beforeReplyPayload({kind: 'final', payload: {text: event.lastAssistantMessage, mediaUrl: '/tmp/result'}}, retry);
  assert.match(payload?.payload?.text || '', /还没能确认/);
  assert.equal(payload.payload.mediaUrl, '/tmp/result');
  assert.equal(await supervisor.beforeReplyPayload({kind: 'final', payload: {text: '另一条回复'}}, retry), undefined);
});

test('an unverified note is removed when the missing evidence arrives before delivery', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-evidence-arrives-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'sample.txt');
  const supervisor = new CleKkSupervisor({audit: new CleKkAuditLog('')});
  const first = {agentId: 'project', sessionKey: 'agent:project:evidence-arrives', runId: 'run-first', workspaceDir: dir};
  const reply = '文件已经修改完成。';
  supervisor.begin({prompt: '修改文件'}, first);
  assert.equal(supervisor.finalizeDecision({lastAssistantMessage: reply}, first)?.action, 'revise');
  const retry = {...first, runId: 'run-retry'};
  supervisor.begin({prompt: '[pinkie-watchdog] 继续'}, retry);
  assert.equal(supervisor.finalizeDecision({lastAssistantMessage: reply}, retry), undefined);
  const write = {toolName: 'write', toolCallId: 'real-write', params: {path: file}};
  supervisor.beforeTool(write, retry);
  fs.writeFileSync(file, 'real change');
  supervisor.afterTool({...write, result: {details: {changed: true}}}, retry);
  const message = {role: 'assistant', stopReason: 'stop', content: [{type: 'text', text: reply}]};
  assert.equal(supervisor.beforeMessageWrite({message}, retry), undefined);
  assert.equal(await supervisor.beforeReplyPayload({kind: 'final', payload: {text: reply}}, retry), undefined);
});

test('a read cannot support a claim that a file was changed even when the user asked a question', () => {
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:unrequested-change'};
  guard.begin({prompt: '这个文件里是什么？'}, ctx);
  guard.afterTool({toolName: 'read', toolCallId: 'read-only', params: {path: '/tmp/example.txt'}, result: '原内容'}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '我已经修改了这个文件。'}, ctx)?.action, 'revise');
  assert.equal(guard.finalize({lastAssistantMessage: '我已经看过原文件，没有修改文件。'}, ctx), undefined);
});

test('writing in the reply needs no file, but claiming the email was sent needs an action', () => {
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:email'};
  guard.begin({prompt: '帮我写一封道歉邮件'}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '邮件改好了：您好，很抱歉让您久等。'}, ctx), undefined);
  assert.equal(guard.finalize({lastAssistantMessage: '我已经发送了邮件。'}, ctx)?.action, 'revise');
});

test('structured nonzero exit status cannot be mistaken for a passed test', () => {
  for (const name of ['exec', 'exec_command', 'functions.exec_command']) {
    const signals = evidenceSignals({name, params: {command: 'python -m pytest'}, result: {
      content: [{type: 'text', text: '测试未通过'}], details: {status: 'completed', exitCode: 1},
    }});
    assert.ok(signals.includes('failed_test'), name);
    assert.ok(!signals.includes('test'), name);
  }
});

test('process metadata alone is not numerical calculation output', () => {
  for (const name of ['exec', 'exec_command', 'functions.exec_command']) {
    const silent = evidenceSignals({name, params: {command: 'python report.py'}, result: {
      details: {exitCode: 0, durationMs: 420},
    }});
    assert.ok(!silent.includes('recomputed'), name);
    const unwrapped = evidenceSignals({name, params: {command: 'python report.py'}, result: {exitCode: 0, durationMs: 420}});
    assert.ok(!unwrapped.includes('recomputed'), `${name}: unwrapped process metadata`);
    const calculated = evidenceSignals({name, params: {command: 'python report.py'}, result: {
      content: [{type: 'text', text: '收入 100，支出 70'}], details: {exitCode: 0},
    }});
    assert.ok(calculated.includes('recomputed'), name);
    const stdout = evidenceSignals({name, params: {command: 'python report.py'}, result: {stdout: '收入 100，支出 70', exitCode: 0}});
    assert.ok(stdout.includes('recomputed'), `${name}: direct standard output`);
  }
});

test('a real file change is not rejected solely because no extra check was claimed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-no-false-gate-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'sample.txt');
  fs.writeFileSync(file, 'before');
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:change-no-check', workspaceDir: dir};
  guard.begin({prompt: '请修改 sample.txt 文件'}, ctx);
  const write = {toolName: 'write', toolCallId: 'write-1', params: {path: file}};
  guard.beforeTool(write, ctx);
  fs.writeFileSync(file, 'after');
  guard.afterTool({...write, result: {details: {changed: true}, content: [{type: 'text', text: 'saved'}]}}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '已经完成文件修改。'}, ctx), undefined);
  assert.equal(guard.finalize({lastAssistantMessage: '已经完成文件修改，并且读回检查过。'}, ctx)?.action, 'revise');
  assert.equal(guard.finalize({lastAssistantMessage: 'I modified the file. The tests passed.'}, ctx)?.action, 'revise');
});

test('a page delivery is not rejected for an unclaimed visual inspection', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-page-claim-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'index.html');
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:page-claim', workspaceDir: dir};
  guard.begin({prompt: '做一个网页'}, ctx);
  const write = {toolName: 'write', toolCallId: 'write-1', params: {path: file}};
  guard.beforeTool(write, ctx);
  fs.writeFileSync(file, '<h1>示例</h1>');
  guard.afterTool({...write, result: {details: {changed: true}, content: [{type: 'text', text: 'saved'}]}}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '网页已经做好。'}, ctx), undefined);
  assert.equal(guard.finalize({lastAssistantMessage: '网页已经做好，并截图看过。'}, ctx)?.action, 'revise');
});

test('PowerShell readback after a real change counts as checking the result', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-powershell-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'sample.txt');
  fs.writeFileSync(file, 'before');
  const guard = new CompletionIntegrityGuard();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:powershell', workspaceDir: dir};
  guard.begin({prompt: '请修改 sample.txt 文件并测试'}, ctx);
  const write = {toolName: 'write', toolCallId: 'write-1', params: {path: file}};
  guard.beforeTool(write, ctx);
  fs.writeFileSync(file, 'after');
  guard.afterTool({...write, result: {details: {changed: true}, content: [{type: 'text', text: 'saved'}]}}, ctx);
  const read = {toolName: 'exec', toolCallId: 'check-1', params: {command: `Get-Content -LiteralPath '${file}'`}};
  guard.beforeTool(read, ctx);
  guard.afterTool({...read, result: {details: {exitCode: 0}, content: [{type: 'text', text: 'after'}]}}, ctx);
  assert.equal(guard.finalize({lastAssistantMessage: '已经完成文件修改，并且读回检查过。'}, ctx), undefined);
  assert.equal(guard.finalize({lastAssistantMessage: '已经完成文件修改，测试通过。'}, ctx)?.action, 'revise', 'reading a file is not a test run');
});
