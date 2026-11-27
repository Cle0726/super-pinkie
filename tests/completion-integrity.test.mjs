import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  CompletionIntegrityGuard, HOUSEKEEPING_TURN, assistantMessageHasToolCall, auditRecordDigest, hashForAudit,
  housekeepingTurn, internalControlText, isTerminalAssistantMessage, meaningfulChildResult, payloadText,
  runtimeTurnText, visibleAssistantText,
} from '../services/mode-architecture/completion-integrity.mjs';
import {SESSION_WAKE_MARK} from '../services/mode-architecture/session-lineage.mjs';

// completion-integrity.mjs 的纯逻辑单测：小工具函数，以及 CompletionIntegrityGuard 里不需要真实系统就能验证的
// 状态流转。不联网、不跑校验器子进程、不读真实 OpenClaw 配置：工作区一律用临时目录传进 ctx.workspaceDir。

const sha = value => createHash('sha256').update(String(value)).digest('hex');
function tempDir(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pinkie-completion-integrity-${label}-`));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}
// 默认用 unrestricted 智能体：不触发四个工作模式的改写，便于看清门禁本身的行为。
const ctxFor = (dir, name, agent = 'unrestricted') => ({
  agentId: agent, sessionKey: `agent:${agent}:${name}`, runId: `run-${name}`, workspaceDir: dir,
});
const read = (guard, ctx, id, file) => guard.afterTool({toolName: 'read', toolCallId: id, params: {path: file}, result: 'ok'}, ctx);
const promptOf = (guard, ctx) => guard.snapshot(ctx.sessionKey).prompt;
// 一张表逐条断言：[输入, 期望] 或 [输入, 期望, 说明]。
const table = (fn, rows) => { for (const [input, want, note] of rows) assert.deepEqual(fn(input), want, note || JSON.stringify(input)); };

test('hashForAudit：SHA-256 十六进制，空值按空串算', () => {
  assert.match(hashForAudit('x'), /^[0-9a-f]{64}$/);
  table(hashForAudit, [['abc', sha('abc')], [undefined, sha('')], [null, sha('')], [0, sha(''), '0 走 || 兜底成空串'], [12, sha('12')]]);
});

test('internalControlText：只认内部控制标记，大小写不敏感', () => {
  for (const text of ['⁣隐形标记', '[pinkie-tier] 续跑', 'PINKIE-INTEGRITY retry', '[pinkie-watchdog] 叫醒',
    'pinkie-marathon', '自动续接保护', '档位控制器说', '档位续跑', '全局交付真实性门禁：x']) assert.equal(internalControlText(text), true, text);
  for (const text of ['', null, undefined, '帮我改 README', 'pinkie-other', 'tier integrity watchdog']) assert.equal(internalControlText(text), false, String(text));
});

test('runtimeTurnText：运行时塞进来的轮只认开头前缀，内部上下文块在哪都算', () => {
  for (const text of [
    'A background task completed. Use this result.', '  \n[Internal task completion event] image done',
    'Continue the OpenClaw runtime event now', 'Before accepting the previous final answer, apply this revision request: 改',
    'Pre-compaction memory flush. Write notes.', 'Read HEARTBEAT.md if it exists', '用户的话\n<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\n内部',
  ]) assert.equal(runtimeTurnText(text), true, text);
  for (const text of ['', null, '请看：A background task completed.', 'Continue the OpenClaw runtime eventually', '读一下 HEARTBEAT.md']) assert.equal(runtimeTurnText(text), false, String(text));
});

test('housekeepingTurn：trigger=memory 或压缩前记忆整理文本才是整理轮', () => {
  table(args => housekeepingTurn(...args), [
    [[{}, {trigger: 'memory'}], true], [[{trigger: 'memory'}, {}], true],
    [[{prompt: 'Pre-compaction memory flush. 写要点'}, {}], true],
    [[{}, {}, '前面\nPre-compaction memory flush'], true, '第三个参数里的 prompt 也算'],
    [[{trigger: 'user'}, {trigger: 'cron'}, '帮我做视频'], false], [[], false],
  ]);
  assert.equal(HOUSEKEEPING_TURN.test('Pre-compaction memory flushing'), false, '要求单词边界');
});

test('visibleAssistantText：只取助手消息里的文字块', () => {
  table(visibleAssistantText, [
    [{role: 'user', content: '用户'}, ''], [null, ''], [undefined, ''], [{role: 'assistant', content: {text: '对象'}}, ''],
    [{role: 'assistant', content: '  直接文字 \n'}, '直接文字'],
    [{role: 'assistant', content: [{type: 'thinking', thinking: '想'}, {type: 'text', text: ' 第一段'}, null,
      {type: 'toolCall', name: 'exec'}, {type: 'text', text: 42}, {type: 'text', text: '第二段 '}]}, '第一段\n第二段'],
  ]);
});

test('assistantMessageHasToolCall：内容块里的 toolCall / tool_use 与并列的工具调用字段', () => {
  table(assistantMessageHasToolCall, [
    [{content: [{type: 'text', text: 'x'}, {type: 'toolCall'}]}, true], [{content: [{type: 'tool_use'}]}, true],
    [{content: [], toolCalls: [{id: 1}]}, true], [{content: [], tool_calls: [{id: 1}]}, true],
    [{content: [], toolCall: {id: 1}}, true], [{content: [], tool_call: {id: 1}}, true],
    [{content: [{type: 'text', text: 'x'}], toolCalls: []}, false], [undefined, false],
  ]);
});

// 疑似 bug：开头 `if (!Array.isArray(message.content)) return false;` 让 content 为字符串 / null 的消息（OpenAI 风格
// `content: null, tool_calls: [...]`）永远判成没有工具调用，后面并列检查的字段形同虚设；file-delivery.mjs 的同类判断
// 不看 content 形状。连带 isTerminalAssistantMessage 会把带工具调用、标了 final 的消息当成终答。按任务要求不修，只标 todo。
// 不带函数体：tools/release-gate/tap.mjs 只把 # SKIP 排除在失败之外，带失败断言的 todo 会输出
// `not ok … # TODO` 并被发版门禁记成新失败，所以这里只登记，不跑会失败的断言。
// 修源码的 PR 把下面这条恢复成普通 test，断言原文：
//   assert.equal(assistantMessageHasToolCall({role: 'assistant', content: null, tool_calls: [{id: 'c1'}]}), true);
//   assert.equal(assistantMessageHasToolCall({role: 'assistant', content: '调用中', toolCalls: [{id: 'c1'}]}), true);
//   assert.equal(isTerminalAssistantMessage({role: 'assistant', content: '调用中', tool_calls: [{id: 'c1'}], final: true}), false);
test.todo('assistantMessageHasToolCall：content 不是数组时也应认出 tool_calls 字段（待修源码）');

test('isTerminalAssistantMessage：显式终答标记或终止类 stopReason 才算终答', () => {
  const done = extra => isTerminalAssistantMessage({role: 'assistant', content: [], ...extra});
  for (const flag of ['final', 'isFinal', 'terminal']) assert.equal(done({[flag]: true}), true, flag);
  for (const stop of ['stop', ' STOP ', 'end', 'complete', 'completed', 'error', 'aborted', 'length']) assert.equal(done({stopReason: stop}), true, stop);
  for (const stop of ['toolUse', 'tool_calls', '', undefined]) assert.equal(done({stopReason: stop}), false, String(stop));
  assert.equal(done({stop_reason: 'end'}), true, '下划线写法');
  assert.equal(done({final: 'yes'}), false, '必须严格等于 true');
  assert.equal(isTerminalAssistantMessage({role: 'assistant', content: [{type: 'toolCall'}], stopReason: 'stop'}), false, '带工具调用不是终答');
  assert.equal(isTerminalAssistantMessage({role: 'user', content: [], final: true}), false);
  assert.equal(isTerminalAssistantMessage(null), false);
});

test('payloadText：字符串直接修剪，对象取 text 再取 body', () => {
  table(payloadText, [['  你好 ', '你好'], [{text: ' 正文 ', body: '备用'}, '正文'], [{text: '', body: ' 备用 '}, '备用'],
    [{}, ''], [null, ''], [undefined, '']]);
});

test('meaningfulChildResult：空话、单字确认和不足 40 个字的结果不算有效汇报', () => {
  for (const text of ['', null, '   ', 'NO_REPLY', 'done.', 'OK！', '完成', '已完成。', '成功!!']) assert.equal(meaningfulChildResult(text), false, String(text));
  table(meaningfulChildResult, [['改'.repeat(39), false], ['改'.repeat(40), true, '按字符计数，不按字节'],
    ['😀'.repeat(39), false, '按码点计数，emoji 不按两个算'], [`  ${'a'.repeat(40)}  `, true, '先修剪再计数']]);
});

test('auditRecordDigest：忽略 hash 字段，不改动原记录，字段顺序参与摘要', () => {
  const record = {type: 'tool_result', at: 1, hash: 'old'};
  assert.equal(auditRecordDigest(record), hashForAudit(JSON.stringify({type: 'tool_result', at: 1})));
  assert.equal(record.hash, 'old', '原对象不被删字段');
  assert.equal(auditRecordDigest({...record, hash: 'other'}), auditRecordDigest(record));
  assert.notEqual(auditRecordDigest({at: 1, type: 'tool_result'}), auditRecordDigest(record));
  assert.notEqual(auditRecordDigest({...record, at: 2}), auditRecordDigest(record));
});

test('has / reset / end：没有会话键时退回 runId，两者都没有就什么都不做', () => {
  const guard = new CompletionIntegrityGuard();
  guard.begin({prompt: '做点事'}, {});
  assert.equal(guard.runs.size, 0, '没有会话键也没有 runId 就不开轮');
  assert.deepEqual([guard.has(''), guard.has()], [false, false]);
  guard.begin({prompt: '做点事'}, {runId: 'only-run'});
  assert.equal(guard.has('only-run'), true);
  guard.reset();
  assert.equal(guard.has('only-run'), true, 'reset 不带键不清别人');
  guard.end({}, {runId: 'only-run'});
  assert.equal(guard.has('only-run'), false);
});

test('begin：同一轮只开一次；内部轮沿用用户上一条真实的话；工作台说明按模式剥离', (t) => {
  const dir = tempDir(t, 'begin');
  const guard = new CompletionIntegrityGuard();
  const ctx = ctxFor(dir, 'begin');
  guard.begin({prompt: '帮我做一个视频'}, ctx); guard.begin({prompt: '第二次'}, ctx);
  assert.equal(promptOf(guard, ctx), '帮我做一个视频');
  for (const internal of ['A background task completed. source: image_generation', '[pinkie-tier] 档位续跑']) {
    guard.reset(ctx.sessionKey); guard.begin({prompt: internal}, ctx);
    assert.equal(promptOf(guard, ctx), '帮我做一个视频', internal);
  }
  const [fresh, project, none, wake] = [ctxFor(dir, 'fresh'), ctxFor(dir, 'wb', 'project'), ctxFor(dir, 'wb2'), ctxFor(dir, 'wake')];
  guard.begin({prompt: 'A background task completed. x'}, fresh);
  assert.equal(promptOf(guard, fresh), 'A background task completed. x', '没有先前的话就保留原文');
  guard.begin({prompt: '改标题\n  【工作台】这里是注入说明'}, project);
  assert.equal(promptOf(guard, project), '改标题');
  guard.begin({prompt: '改标题\n【工作台】说明'}, none);
  assert.equal(promptOf(guard, none), '改标题\n【工作台】说明', '无限制模式保留原文');
  guard.begin({prompt: `${SESSION_WAKE_MARK} 子会话汇报`}, wake);
  assert.equal(guard.snapshot(wake.sessionKey).sessionReport, wake.sessionKey);
  assert.equal(guard.snapshot(ctx.sessionKey).sessionReport, '');
});

test('begin：用户原话最多记 512 个会话，最旧的先淘汰', (t) => {
  const guard = new CompletionIntegrityGuard();
  const first = ctxFor(tempDir(t, 'lru'), 's0');
  const internalTurn = tag => { guard.reset(first.sessionKey); guard.begin({prompt: `A background task completed. ${tag}`}, first); };
  guard.begin({prompt: '最早的需求'}, first);
  for (let index = 1; index <= 511; index += 1) guard.begin({prompt: `需求 ${index}`}, {sessionKey: `agent:unrestricted:s${index}`});
  assert.equal(guard.userPrompts.size, 512);
  internalTurn('a');
  assert.equal(promptOf(guard, first), '最早的需求', '满 512 之前还在');
  guard.begin({prompt: '第 513 个'}, {sessionKey: 'agent:unrestricted:s512'});
  assert.equal(guard.userPrompts.size, 512);
  internalTurn('b');
  assert.equal(promptOf(guard, first), 'A background task completed. b', '第 513 个挤掉最早的');
});

test('snapshot / restore：往返一致，坏数据被清洗', (t) => {
  const guard = new CompletionIntegrityGuard();
  const ctx = ctxFor(tempDir(t, 'snap'), 'snap');
  guard.begin({prompt: '需'.repeat(13_000)}, ctx);
  guard.afterTool({toolName: 'exec', toolCallId: 'x', params: {command: 'ls', extra: 'drop-me'}, result: 'a.txt'}, ctx);
  assert.equal(guard.snapshot('nope'), null);
  const full = guard.snapshot(ctx.sessionKey);
  assert.deepEqual([full.v, full.prompt.length], [1, 12_000]);
  assert.deepEqual(full.tools[0].params, {command: 'ls'}, '只保留白名单参数');
  assert.deepEqual(guard.snapshot(ctx.sessionKey, {includeTools: false}).tools, []);
  for (const [key, value] of [['', full], ['k', null], ['k', {...full, v: 2}]]) assert.equal(guard.restore(key, value), false);
  const other = new CompletionIntegrityGuard();
  assert.equal(other.restore('k2', full), true);
  assert.deepEqual(other.snapshot('k2'), full);
  assert.equal(other.restore('dirty', {
    v: 1, startedAt: 'bad', contractCutoffNs: '12ab', prompt: 5, sessionReport: 7,
    tools: [{name: 'exec', output: 'y'.repeat(7_000), params: 'oops', effects: 'x', at: '3', failed: 1}, null],
    skills: [['a', {verifier: 'v'}], ['bad'], 'x'], softGates: null, mutationEpoch: '2', verification: 'yes',
    authorityRecords: [['k', {}], [1]],
  }), true);
  const dirty = other.snapshot('dirty');
  assert.ok(typeof dirty.startedAt === 'number' && dirty.startedAt > 0, '坏的 startedAt 换成当前时间');
  assert.deepEqual([dirty.contractCutoffNs, dirty.prompt, dirty.sessionReport], ['', '5', '']);
  assert.deepEqual(dirty.tools.map(entry => ({...entry, output: entry.output.length})), [
    {name: 'exec', failed: true, output: 6_000, params: {}, effects: [], at: 3},
    {name: '', failed: false, output: 0, params: {}, effects: [], at: 0},
  ]);
  assert.deepEqual(dirty.skills, [['a', {verifier: 'v'}]]);
  assert.deepEqual([dirty.softGates, dirty.mutationEpoch, dirty.verification, dirty.authorityRecords.length], [{}, 2, null, 1]);
});

test('restore：旧快照没有 contractSkills 时，只把自带验收器的 Skill 当契约', (t) => {
  const dir = tempDir(t, 'legacy');
  const [withVerifier, plain] = ['a', 'b'].map(name => path.join(dir, 'skills', name, 'SKILL.md'));
  fs.mkdirSync(path.join(dir, 'skills', 'a', 'tools'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'skills', 'a', 'tools', 'verify_completion.py'), 'print(1)\n');
  const guard = new CompletionIntegrityGuard();
  guard.restore('legacy', {v: 1, loadedSkills: [withVerifier, plain]});
  assert.deepEqual(guard.snapshot('legacy').contractSkills, [withVerifier]);
  guard.restore('explicit', {v: 1, loadedSkills: [withVerifier, plain], contractSkills: []});
  assert.deepEqual(guard.snapshot('explicit').contractSkills, [], '新快照显式记录的为准');
});

test('replayTools：按时间排序、跳过无名条目、和已有证据去重', () => {
  const guard = new CompletionIntegrityGuard();
  assert.equal(guard.replayTools('none', [{name: 'exec'}]), 0);
  guard.restore('k', {v: 1});
  const entries = [{name: 'exec', at: 30, params: {command: 'ls'}}, {name: 'read', at: 10, params: {path: '/a'}},
    {name: 'exec', at: 30, params: {command: 'ls'}}, {name: '', at: 5}, {at: 1}];
  assert.equal(guard.replayTools('k', entries), 2);
  assert.deepEqual(guard.snapshot('k').tools.map(entry => [entry.name, entry.at]), [['read', 10], ['exec', 30]]);
  assert.equal(guard.replayTools('k', entries), 2, '重放同一批不重复');
  assert.equal(guard.replayTools('k', [{name: 'exec', at: 30, params: {command: 'pwd'}}]), 3, '同时间同名但参数不同算新证据');
});

test('updatePrompt / amendPrompt：补空 prompt、不覆盖真实需求、忽略内部控制文本', (t) => {
  const dir = tempDir(t, 'prompt');
  const guard = new CompletionIntegrityGuard();
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(name => ctxFor(dir, name));
  guard.updatePrompt({prompt: '新需求'}, a);
  assert.equal(promptOf(guard, a), '新需求', '没有记录就开一轮');
  guard.updatePrompt({prompt: '另一句'}, a);
  assert.equal(promptOf(guard, a), '新需求', '已有真实需求不覆盖');
  guard.updatePrompt({prompt: '[pinkie-integrity] 打回'}, a);
  assert.equal(promptOf(guard, a), '新需求');
  guard.begin({prompt: ''}, b); guard.updatePrompt({prompt: '  后到的需求  '}, b);
  assert.equal(promptOf(guard, b), '后到的需求');
  guard.begin({prompt: '[pinkie-tier] 控制'}, c); guard.updatePrompt({prompt: '真正的需求'}, c);
  assert.equal(promptOf(guard, c), '真正的需求', '内部控制文本占位时被替换');
  guard.updatePrompt({prompt: `${SESSION_WAKE_MARK} 汇报`}, c);
  assert.equal(guard.snapshot(c.sessionKey).sessionReport, c.sessionKey);
  guard.amendPrompt({prompt: '真正的需求\n再加一条'}, c);
  assert.equal(promptOf(guard, c), '真正的需求\n再加一条');
  guard.amendPrompt({prompt: '档位续跑'}, c);
  assert.equal(promptOf(guard, c), '真正的需求\n再加一条');
  guard.amendPrompt({prompt: '追加'}, d);
  assert.equal(guard.has(d.sessionKey), false, 'amendPrompt 不开新轮');
});

test('afterTool：主机确认文件真的变了才推进改动纪元，失败与 delivery_guard 不算', (t) => {
  const dir = tempDir(t, 'effects');
  const guard = new CompletionIntegrityGuard();
  const ctx = ctxFor(dir, 'effects');
  guard.begin({prompt: '把 a.txt 写成 hello'}, ctx);
  const file = path.join(dir, 'a.txt');
  const run = (name, id, change, extra = {}) => {
    guard.beforeTool({toolName: name, toolCallId: id, params: {path: file}}, ctx);
    if (change !== undefined) fs.writeFileSync(file, change);
    guard.afterTool({toolName: name, toolCallId: id, params: {path: file}, result: 'ok', ...extra}, ctx);
    return guard.snapshot(ctx.sessionKey);
  };
  let snap = run('write', 'w1', 'hello');
  assert.deepEqual([snap.mutationEpoch, snap.tools.at(-1).effects[0].changed], [1, true]);
  assert.equal(guard.runs.get(ctx.sessionKey).pendingTools.size, 0, '前后快照用完即删');
  assert.equal(run('write', 'w2', 'hello').mutationEpoch, 1, '内容没变不算改动');
  snap = run('write', 'w3', 'denied', {error: 'EACCES'});
  assert.deepEqual([snap.mutationEpoch, snap.tools.at(-1).failed], [1, true], '失败的工具不算');
  assert.equal(run('delivery_guard', 'd1', 'by-guard').mutationEpoch, 1, '验收工具自身不推进纪元');
  guard.runs.get(ctx.sessionKey).verification = {ok: true};
  guard.afterTool({toolName: 'edit', toolCallId: 'e1', params: {path: file}, result: {details: {changed: true}}}, ctx);
  snap = guard.snapshot(ctx.sessionKey);
  assert.equal(snap.mutationEpoch, 2, '没有前快照时按宿主回执 details.changed 算');
  assert.equal(snap.tools.at(-1).effects[0].hostReported, true);
  assert.equal(snap.verification, null, '新改动作废旧验收');
  const other = path.join(dir, 'proj', 'b.js');
  guard.afterTool({toolName: 'code_edit', toolCallId: 'c1', params: {path: 'b.js'}, result: {details: {changed: true, absolutePath: other}}}, ctx);
  snap = guard.snapshot(ctx.sessionKey);
  assert.equal(snap.tools.at(-1).effects[0].path, other, 'code_edit 用回执里的绝对路径');
  assert.equal(snap.mutationEpoch, 3);
});

test('读取 SKILL.md：开工前就自带 verify_completion.py 的才锁成验收契约', async (t) => {
  const dir = tempDir(t, 'skills');
  const verifierOf = skill => path.join(path.dirname(skill), 'tools', 'verify_completion.py');
  const make = (name, verifier) => {
    const skill = path.join(dir, 'skills', name, 'SKILL.md');
    fs.mkdirSync(path.join(path.dirname(skill), 'tools'), {recursive: true});
    fs.writeFileSync(skill, `# ${name}\n`);
    if (verifier) fs.writeFileSync(verifierOf(skill), 'print(1)\n');
    return skill;
  };
  const [plain, locked, late] = [make('plain', false), make('locked', true), make('late', false)];
  const guard = new CompletionIntegrityGuard();
  const ctx = ctxFor(dir, 'skills');
  guard.begin({prompt: '用 Skill 做视频'}, ctx);
  read(guard, ctx, 'r1', plain);
  let snap = guard.snapshot(ctx.sessionKey);
  assert.deepEqual([snap.loadedSkills, snap.contractSkills], [[plain], []], '普通 Skill 不是契约');
  read(guard, ctx, 'r2', locked);
  snap = guard.snapshot(ctx.sessionKey);
  assert.deepEqual(snap.contractSkills, [locked]);
  assert.deepEqual(snap.skills.map(([, contract]) => contract.verifier), [verifierOf(locked)]);
  // 普通 Skill 读取之后才补出来的验收器，不能把它升级成契约
  fs.writeFileSync(verifierOf(plain), 'print("PASS")\n');
  read(guard, ctx, 'r3', verifierOf(plain));
  assert.equal(guard.snapshot(ctx.sessionKey).skills.length, 1);
  // 开工后才放上验收器的 Skill：算契约，但锁不住，记成缺验收器。先等 25ms：Linux ext4 的文件时间戳按时钟节拍取整，
  // 开轮后 1~2ms 内写的文件常与边界同刻，会被当成开工前就有（见 PR 说明）；真实回合里模型动手远晚于此。
  await new Promise(resolve => setTimeout(resolve, 25));
  fs.writeFileSync(verifierOf(late), 'print(1)\n');
  read(guard, ctx, 'r4', late);
  snap = guard.snapshot(ctx.sessionKey);
  assert.deepEqual([snap.missingVerifiers, snap.skills.length], [[late], 1]);
  const verdict = await guard.verifyExternal(ctx.sessionKey);
  assert.deepEqual([verdict.ok, /没有独立 verify_completion\.py/.test(verdict.reason)], [false, true], verdict.reason);
  assert.equal(await guard.verifyAfterTool({}, ctx), undefined, '最后一个工具不是跑验收器，就不触发外部验收');
});

test('verifyExternal：不起子进程的几条分支', async (t) => {
  const dir = tempDir(t, 'verify');
  const guard = new CompletionIntegrityGuard();
  assert.deepEqual(await guard.verifyExternal('none'), {ok: false, reason: '当前会话没有可核验的执行记录'});
  const diag = ctxFor(dir, 'diag');
  guard.begin({prompt: '只读检查一下网关状态，不要修改任何东西'}, diag);
  assert.deepEqual(await guard.verifyExternal(diag.sessionKey), {ok: false, reason: '只读诊断尚未取得真实的主机检查结果'});
  guard.afterTool({toolName: 'read', toolCallId: 'x', params: {path: path.join(dir, 'nope')}, error: 'ENOENT', result: 'fail'}, diag);
  assert.equal((await guard.verifyExternal(diag.sessionKey)).ok, false, '失败的检查不算');
  read(guard, diag, 'r', path.join(dir, 'status.txt'));
  const ok = await guard.verifyExternal(diag.sessionKey);
  assert.deepEqual([ok.ok, ok.scope], [true, 'read-only-diagnostic']);
  assert.equal(guard.snapshot(diag.sessionKey).verification.scope, 'read-only-diagnostic');
  const work = ctxFor(dir, 'work');
  guard.begin({prompt: '帮我把 README 的标题改成 Hello'}, work);
  guard.runs.get(work.sessionKey).verification = {ok: true};
  assert.deepEqual(await guard.verifyExternal(work.sessionKey), {ok: false, reason: '本轮没有已锁定的独立 Skill 验收契约'});
  assert.equal(guard.snapshot(work.sessionKey).verification, null);
});

test('workflowContext / recordEvidence / assertFreshRunFile：错误路径', async (t) => {
  const dir = tempDir(t, 'workflow');
  const guard = new CompletionIntegrityGuard();
  assert.throws(() => guard.workflowContext('none', dir), /没有可核验的执行记录/);
  const ctx = ctxFor(dir, 'wf');
  guard.begin({prompt: '跑视频工作流'}, ctx);
  assert.throws(() => guard.workflowContext(ctx.sessionKey, dir), /没有先读取视频工作流 SKILL\.md/);
  await assert.rejects(guard.recordEvidence(ctx.sessionKey, {kind: 'bogus'}), /不支持的受控证据类型/);
  await assert.rejects(guard.recordEvidence(ctx.sessionKey, {kind: 'qc_report', run_dir: dir}), /没有先读取视频工作流/);
  const runDir = path.join(dir, 'runs', 'r1');
  fs.mkdirSync(runDir, {recursive: true});
  const fresh = (file, label) => guard.assertFreshRunFile(file, runDir, guard.runs.get(ctx.sessionKey).startedAt, label);
  const [outside, newFile, old] = [path.join(dir, 'outside.png'), path.join(runDir, 'fresh.txt'), path.join(runDir, 'old.txt')];
  fs.writeFileSync(outside, 'x'); fs.writeFileSync(newFile, 'new'); fs.writeFileSync(old, 'old');
  fs.utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
  assert.throws(() => fresh(outside, '截图'), /截图 不在本轮运行目录或不存在/);
  assert.throws(() => fresh(path.join(runDir, 'missing.png'), '截图'), /不在本轮运行目录/);
  assert.throws(() => fresh(runDir, '目录'), /不在本轮运行目录/, '运行目录本身不算目录内文件');
  assert.deepEqual(fresh(newFile, '证据'), {path: newFile, sha256: sha('new'), size: 3});
  assert.throws(() => fresh(old, '旧证据'), /旧证据 早于本轮开始/);
  const link = path.join(runDir, 'link.txt');
  try { fs.symlinkSync(newFile, link); } catch { return; } // Windows 无权限建符号链接时跳过这一条
  assert.throws(() => fresh(link, '链接'), /链接 不在本轮运行目录或不存在/, '符号链接不算');
});

test('softRevise / revise：同一条回复只提醒一次，改过的新回复放行', (t) => {
  const guard = new CompletionIntegrityGuard();
  const ctx = ctxFor(tempDir(t, 'soft'), 'soft');
  guard.begin({prompt: '做视频'}, ctx);
  const key = ctx.sessionKey, state = guard.runs.get(key);
  const first = guard.softRevise(key, state, 'promise', '我这就去做', '只说了要做');
  assert.deepEqual(first, guard.revise(key, '只说了要做'));
  assert.deepEqual([first.action, first.reason], ['revise', '全局交付真实性门禁：只说了要做']);
  assert.deepEqual([first.retry.idempotencyKey, first.retry.maxAttempts], [`pinkie-integrity-${key}`, 24]);
  assert.match(first.retry.instruction, /^上一版不能交付：只说了要做。/);
  assert.equal(guard.softRevise(key, state, 'promise', '我这就去做', '只说了要做')?.action, 'revise', '同一条回复结果一致');
  assert.equal(guard.softRevise(key, state, 'promise', '已经改好了', '只说了要做'), null);
  assert.equal(guard.softRevise(key, state, 'inspection', '已经改好了', '没看过')?.action, 'revise', '各门禁独立计');
  assert.equal(guard.snapshot(key).softGates.promise, hashForAudit('我这就去做'));
});

test('finalize：问用户、后台任务进行中直接放行；执行型请求没有执行记录要打回', (t) => {
  const dir = tempDir(t, 'final');
  const guard = new CompletionIntegrityGuard();
  const offline = {verifyExternal: false};
  assert.equal(guard.finalize({lastAssistantMessage: '完成了'}, ctxFor(dir, 'none')), undefined, '没有记录不拦');
  const [ask, bg, bare] = ['ask', 'bg', 'bare'].map(name => ctxFor(dir, name));
  guard.begin({prompt: '帮我把 README 的标题改成 Hello'}, ask);
  guard.afterTool({toolName: 'ask_user', toolCallId: 'q', params: {}, result: 'ok'}, ask);
  assert.equal(guard.finalize({lastAssistantMessage: '已经全部完成。'}, ask, offline), undefined);
  guard.begin({prompt: '生成一张猫的图片'}, bg);
  guard.afterTool({toolName: 'image_generate', toolCallId: 'i', params: {}, result: 'Background task started for image generation (id 1)'}, bg);
  assert.equal(guard.finalize({lastAssistantMessage: '图片已经生成完成。'}, bg, offline), undefined);
  guard.begin({prompt: '帮我把 README 的标题改成 Hello'}, bare);
  const decision = guard.finalize({lastAssistantMessage: '已经把标题改好了，全部完成。'}, bare, offline);
  assert.deepEqual([decision?.action, /本轮没有任何真实执行工具记录/.test(decision?.reason)], ['revise', true], decision?.reason);
  guard.end({}, bare);
  assert.equal(guard.has(bare.sessionKey), false);
});
