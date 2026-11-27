// services/mode-architecture/deliberation-audit.mjs 的纯逻辑单测。
// 只用内存里的假状态和临时目录：不联网、不碰 18789 正式网关、不碰用户目录、不调用任何上游模型。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MILESTONE_MISSING, PLAN_MISSING, SHORT_DONE, SHORT_FINAL,
  agentFromSessionKey, assistantTextFromMessages, auditDeliberation, buildDeliberationPlan,
  captureVerificationEvidence, captureWorkflowFinalClaims, ceremonyBudget, checkpointMilestones,
  classifyTierTask, completedEvidence, deliberationFingerprint, deliberationProgress,
  deliberationRequirements, hasDeliverableAssistantReply, hasEvidenceBackedCritique, isInside,
  kindsOf, legacyDeliberationPlan, legacyWorkflowStages, marathonMissing, modeForContext,
  modelOverrideFor, normalizedRoleLabel, onlyMilestonesMissing, readWorkspaceFile,
  requirementSummary, retryGapKind, roleForLabel, roleSpawnCap, safeWorkspace, section,
  sourceEvidenceCount, sourceReferences, tierRetryInstruction, validateJudgeSelection,
  verificationEvidenceCount, visibleReplyText, workflowProgress,
} from '../services/mode-architecture/deliberation-audit.mjs';

// 临时目录：测试结束自动删掉。返回 realpath，避免 macOS 上 /var → /private/var 让「是否在工作区内」误判。
function tempDir(t, prefix = 'pinkie-deliberation-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

// 一条干净的工作模式运行状态（captureVerificationEvidence 需要这几个数组）。
function runState(extra = {}) {
  return {mode: 'project', tier: 'boost', taskType: 'implementation', workKinds: [], progressDigests: [], verificationEvidence: [], progressSequence: 0, ...extra};
}

test('模型覆盖与会话键：只认「提供方/模型」与 agent:<id>: 前缀', () => {
  assert.deepEqual(modelOverrideFor('openai/gpt'), {providerOverride: 'openai', modelOverride: 'gpt'});
  // 只按第一个斜杠切：模型名自己可以带斜杠。
  assert.deepEqual(modelOverrideFor('a/b/c'), {providerOverride: 'a', modelOverride: 'b/c'});
  for (const bad of ['', '/x', 'x/', 'noslash', undefined, null]) assert.equal(modelOverrideFor(bad), undefined, String(bad));
  assert.equal(agentFromSessionKey('agent:main:abc'), 'main');
  assert.equal(agentFromSessionKey('agent:main'), '');
  assert.equal(agentFromSessionKey(), '');
  assert.equal(modeForContext({sessionKey: 'agent:project:x'}), 'project');
  assert.equal(modeForContext({agentId: 'unrestricted', sessionKey: 'agent:main:x'}), 'none', 'agentId 优先于会话键');
  assert.equal(modeForContext({agentId: 'zzz'}), null);
  assert.equal(modeForContext(), null);
});

test('角色标签：中英文别名归一，词边界不误伤，编号后缀保留', () => {
  assert.equal(roleForLabel('求解·1'), 'solver');
  assert.equal(roleForLabel('critic'), 'critic');
  assert.equal(roleForLabel('judge'), 'judge');
  assert.equal(roleForLabel('verifier-2'), 'verifier');
  assert.equal(roleForLabel('counter-critic'), 'countercritic', '反批评要先于批评匹配');
  assert.equal(roleForLabel('反批评'), 'countercritic');
  assert.equal(roleForLabel('planner'), 'planner');
  assert.equal(roleForLabel('plane'), '');
  assert.equal(roleForLabel('solvent'), '');
  assert.equal(roleForLabel('随便'), '');
  assert.equal(normalizedRoleLabel('solver', 'solver-2'), '求解·2');
  assert.equal(normalizedRoleLabel('judge', 'x'), '仲裁');
  assert.equal(normalizedRoleLabel('', 'orig'), 'orig', '认不出角色时原样返回');
});

test('助手回复：取最后一条有正文的助手消息；失败气泡、工具中途停、控制前缀都不算可交付', () => {
  assert.equal(assistantTextFromMessages([
    {role: 'assistant', content: [{type: 'text', text: 'a'}, {type: 'image'}, {type: 'text', text: 'b'}]},
    {role: 'user', content: 'u'},
  ]), 'a\nb');
  // 外层 {message} 包装也认；最后一条是空数组时往前找。
  assert.equal(assistantTextFromMessages([{message: {role: 'assistant', content: ' s '}}, {role: 'assistant', content: []}]), 's');
  assert.equal(assistantTextFromMessages('not array'), '');

  assert.equal(hasDeliverableAssistantReply({messages: [{role: 'assistant', content: 'hi'}]}), true);
  assert.equal(hasDeliverableAssistantReply({success: false, lastAssistantMessage: 'x'}), false);
  for (const stopReason of ['toolUse', 'tool_use', 'error', 'aborted', 'cancelled']) {
    assert.equal(hasDeliverableAssistantReply({messages: [{role: 'assistant', content: 'hi', stopReason}]}), false, stopReason);
  }
  assert.equal(hasDeliverableAssistantReply({lastAssistantMessage: '[pinkie-tier-control] 续跑'}), false);
  assert.equal(hasDeliverableAssistantReply({lastAssistantMessage: 'The agent run failed before producing a reply.'}), false);
  assert.equal(hasDeliverableAssistantReply({messages: []}), false);
});

test('子任务候选证据：空结果跳过，候选方案带编号，会话键取末段前 8 位', () => {
  assert.equal(completedEvidence({childResults: new Map()}), '');
  assert.equal(completedEvidence(null), '');
  const text = completedEvidence({
    childResults: new Map([
      ['agent:x:sub:abcdefghij', {text: ' 结果一 ', role: 'solver'}],
      ['k2', {text: '', role: 'critic'}],
      ['k3', {text: '方案B', candidateId: 'B', role: 'solver'}],
    ]),
    childRoles: new Map(),
  });
  assert.ok(text.startsWith('【已完成子任务的候选证据】'));
  assert.match(text, /--- 求解 · abcdefgh ---\n结果一\n/);
  assert.match(text, /--- 候选方案 B · 求解 ---\n方案B/);
  assert.doesNotMatch(text, /批评/, '空文本的子任务不出现');
});

test('活儿种类：无限制模式按旧五类换算，工作模式过滤无效种类', () => {
  assert.deepEqual(kindsOf({mode: 'none', taskType: 'implementation', workKinds: ['web']}), ['code']);
  assert.deepEqual(kindsOf({mode: 'project', taskType: 'fact_check', workKinds: ['bogus']}), ['fact_check'], '全无效时回落到旧五类');
  assert.deepEqual(kindsOf({mode: 'project', workKinds: []}), []);
  // 只说「继续」时沿用上一条真实请求，不降成简单问答。
  const state = classifyTierTask({mode: 'project'}, '继续', '帮我修复 services/a.mjs 的 bug 并跑测试');
  assert.equal(state.taskPrompt, '帮我修复 services/a.mjs 的 bug 并跑测试');
  assert.equal(state.taskType, 'implementation');
  assert.deepEqual(state.workKinds, ['code']);
  // 无限制模式不加新分类。
  const none = classifyTierTask({mode: 'none'}, '帮我修复这个 bug 并跑测试');
  assert.equal(none.taskType, 'implementation');
  assert.equal(none.workKind, '');
  assert.deepEqual(none.workKinds, []);
});

test('档位要求：未知档位回落加强档；证据种类与续跑上限随档位走', () => {
  const weird = deliberationRequirements('weird', 'none', 'fact_check');
  assert.equal(weird.tier, 'boost');
  assert.equal(weird.retryLimit, 6);
  assert.equal(weird.evidenceKind, 'sources');
  assert.equal(weird.needsEvidence, true);
  const simple = deliberationRequirements('base', 'project', 'simple');
  assert.deepEqual(simple.roles, {});
  assert.equal(simple.evidenceKind, '');
  assert.equal(simple.retryLimit, 3);
  assert.equal(deliberationRequirements('boost', 'project', 'bogus').taskType, 'simple', '未知任务类型按简单问答');
  assert.equal(requirementSummary('boost', 'project', 'implementation'), '写代码 / 修 bug：不派求解代理');
  assert.equal(requirementSummary('boost', 'none', 'fact_check'), '查事实：不派求解代理；需交叉核对两个来源');
  assert.equal(requirementSummary('full', 'none', 'standard_answer'), '有标准答案的难题：最多 2 位不同解法；需取得相关验证证据');
});

test('派子任务上限：求解按 maxSolvers，仲裁/批评按可选名额，空角色与待定任务为 0', () => {
  const full = {tier: 'full', mode: 'project', taskType: 'standard_answer'};
  assert.equal(roleSpawnCap(full, 'solver'), 3);
  assert.equal(roleSpawnCap(full, 'judge'), 1);
  assert.equal(roleSpawnCap(full, 'critic'), 1);
  assert.equal(roleSpawnCap(full, ''), 0);
  assert.equal(roleSpawnCap({tier: 'boost', mode: 'project', taskType: 'pending'}, 'solver'), 0);
  assert.equal(roleSpawnCap({tier: 'boost', mode: 'project', taskType: 'implementation'}, 'judge'), 0);
});

test('仪式预算：工作模式按档位提醒次数放行，无限制模式永不放行', () => {
  assert.deepEqual(ceremonyBudget({mode: 'project', rolePushes: 0, finalPushes: 0}, 'full'), {rolesWaived: false, finalWaived: false});
  assert.deepEqual(ceremonyBudget({mode: 'project', rolePushes: 1, finalPushes: 1}, 'full'), {rolesWaived: true, finalWaived: true});
  assert.deepEqual(ceremonyBudget({mode: 'none', rolePushes: 99, finalPushes: 99}, 'full'), {rolesWaived: false, finalWaived: false});
  // 未知档位按加强档：加强档不提醒子任务（0 次），终稿提醒 1 次。
  assert.deepEqual(ceremonyBudget({mode: 'project'}, 'nope'), {rolesWaived: true, finalWaived: false});
});

test('记录工具证据：改动/测试/记账分类，重复记录去重，失败输出判不通过', () => {
  const state = runState();
  const write = captureVerificationEvidence(state, {toolName: 'write', params: {path: 'a.js'}, result: ''});
  assert.equal(write.kind, 'mutation');
  assert.equal(write.output, '工具操作已返回', '改动结果为空也要留下');
  assert.equal(state.lastMutationSequence, 1);
  const run = captureVerificationEvidence(state, {toolName: 'exec', params: {command: 'node --test x'}, result: 'ok 1'});
  assert.equal(run.kind, 'test');
  assert.equal(run.ok, true);
  assert.equal(captureVerificationEvidence(state, {toolName: 'exec', params: {command: 'node --test x'}, result: 'ok 1'}), null, '同一次改动后的重复记录丢掉');
  const failed = captureVerificationEvidence(state, {toolName: 'exec', params: {command: 'node --test x'}, result: 'not ok 1 boom'});
  assert.equal(failed.ok, false);
  assert.equal(captureVerificationEvidence(state, {toolName: 'bash', params: {command: 'ls'}, result: 'a'}).kind, 'command');
  assert.equal(captureVerificationEvidence(state, {toolName: 'web_fetch', params: {}, result: 'page'}).kind, 'source');
  assert.equal(captureVerificationEvidence(state, {toolName: 'zzz', params: {}, result: ''}), null, '空结果的普通工具不记');
  assert.equal(state.progressSequence, 5);
  assert.equal(state.verificationEvidence.length, 5);
});

test('记录工具证据：勾检查点与计划只算记账，Windows 双反斜杠路径也认', () => {
  const state = runState();
  const windowsNote = captureVerificationEvidence(state, {toolName: 'edit', params: {path: 'C:\\memory\\context\\sessions\\a.md'}, result: 'ok'});
  assert.equal(windowsNote.kind, 'note');
  assert.equal(captureVerificationEvidence(state, {toolName: 'plan_update', params: {}, result: 'ok'}).kind, 'note');
  assert.equal(state.lastMutationSequence, undefined, '记账不刷新最后改动序号');
  // 无限制模式保持旧记法：同样的编辑算改动。
  const legacy = runState({mode: 'none'});
  assert.equal(captureVerificationEvidence(legacy, {toolName: 'edit', params: {path: 'memory/context/a.md'}, result: 'ok'}).kind, 'mutation');
});

test('改完再跑同一条命令是新的核对，不被去重', () => {
  const state = runState();
  captureVerificationEvidence(state, {toolName: 'exec', params: {command: 'npm test'}, result: 'ok'});
  captureVerificationEvidence(state, {toolName: 'write', params: {path: 'a.js'}, result: 'done'});
  const again = captureVerificationEvidence(state, {toolName: 'exec', params: {command: 'npm test'}, result: 'ok'});
  assert.ok(again, '最后一次改动之后的同一条测试要记下');
  assert.equal(verificationEvidenceCount(state, {evidenceKind: 'test'}), 1, '只数最后一次改动之后的测试');
  assert.equal(verificationEvidenceCount(runState(), {evidenceKind: 'test'}), 0, '没有改动就没有测试证据');
  assert.equal(verificationEvidenceCount(state, {evidenceKind: 'verification'}), 3);
});

test('审议指纹：证据摘要顺序无关，子任务结果变化会改变指纹', () => {
  assert.equal(deliberationFingerprint({progressDigests: ['b', 'a']}), deliberationFingerprint({progressDigests: ['a', 'b']}));
  const one = deliberationFingerprint({childResults: new Map([['k', {text: 'x'}]])});
  const two = deliberationFingerprint({childResults: new Map([['k', {text: 'y'}]])});
  assert.notEqual(one, two);
  assert.equal(deliberationFingerprint(null), deliberationFingerprint({}));
});

test('来源引用：网址与路径都算，大小写与中文标点不影响', () => {
  assert.deepEqual(sourceReferences('见 https://a.example/x，以及 HTTPS://A.example/x'), ['https://a.example/x']);
  assert.equal(sourceReferences('没有出处').length, 0);
  const two = {verificationEvidence: [
    {ok: true, params: '', output: '见 https://a.example/1'},
    {ok: true, params: '', output: '见 https://b.example/2'},
    {ok: false, params: '', output: '见 https://c.example/3'},
  ]};
  assert.equal(sourceEvidenceCount(two), 2, '失败的工具结果不算来源');
});

// 真 bug（未修，只标出）：sourceReferences 的路径正则把前导的空格/引号一起截进了匹配，
// 于是同一个文件 /etc/a.md 在 params 里是 `"/etc/a.md`、在输出里是 ` /etc/a.md`，被当成两个「可区分的来源」，
// 查事实门禁「缺少两个可区分的来源」被一个文件骗过；终稿里同一路径写两遍也会让 finalSourceSummary 变成 true。
// 复现：sourceEvidenceCount({verificationEvidence: [{ok: true, params: '{"path":"/etc/a.md"}', output: 'content of /etc/a.md'}]}) 目前返回 2，应为 1。
test.todo('来源引用：同一路径带不同前导字符（引号/空格）应只算一个来源（deliberation-audit.mjs sourceReferences 目前算成两个）');

test('终稿声明：取舍要有对比和交给用户选，查事实要两个来源加不确定性', () => {
  const trade = {mode: 'none', taskType: 'tradeoff'};
  captureWorkflowFinalClaims(trade, '对比两种方案的成本，请你选择其中一个。');
  assert.equal(trade.tradeoffCompared, true);
  assert.equal(trade.tradeoffPresented, true);
  captureWorkflowFinalClaims(trade, '就用 A。');
  assert.equal(trade.tradeoffCompared, false);
  const fact = {mode: 'none', taskType: 'fact_check'};
  captureWorkflowFinalClaims(fact, '见 https://a.example/1 与 https://b.example/2，两者存在差异。');
  assert.equal(fact.finalSourceSummary, true);
  captureWorkflowFinalClaims(fact, '见 https://a.example/1 与 https://b.example/2。');
  assert.equal(fact.finalSourceSummary, false, '没写不确定性');
});

test('批评与仲裁：批评要逐条带证据；仲裁只能选一个已有候选并引用实测结果', () => {
  assert.equal(hasEvidenceBackedCritique(''), false);
  assert.equal(hasEvidenceBackedCritique('一切正常'), false);
  assert.equal(hasEvidenceBackedCritique('问题：./src/a.mjs 第 3 行空指针。\n风险：没有说明。'), false, '有一条没证据就不算');
  const evidence = [{ok: true, output: 'node --test 输出 ok 3 全部通过', params: ''}];
  const candidates = [{candidateId: 'A'}, {candidateId: 'b'}];
  assert.deepEqual(validateJudgeSelection('选择：候选方案 B\n依据：node --test 输出 ok 3 全部通过', candidates, evidence), {ok: true, selected: 'B'});
  assert.equal(validateJudgeSelection('选择：A 选择：B', candidates, evidence).reason, '必须明确选择一个已有候选方案');
  assert.equal(validateJudgeSelection('选择：C', candidates, evidence).reason, '所选方案不在已有候选中');
  assert.equal(validateJudgeSelection('选择：B，合并 A 的优点\n依据：通过', candidates, evidence).reason, '仲裁不能合成新方案');
  assert.equal(validateJudgeSelection('选择：B', candidates, evidence).reason, '依据必须说明实际检验结果');
  assert.equal(validateJudgeSelection('选择：B\n依据：测试通过', candidates, evidence).reason, '依据没有引用已取得的实际检验结果');
  assert.equal(validateJudgeSelection('选择：B\n依据：node --test 输出 ok 3 全部通过', candidates, [{...evidence[0], ok: false}]).ok, false, '失败的证据不能引用');
});

test('长跑档检查点：解析复选框里程碑，缺文件/空文件返回 null', t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'cp.md');
  fs.writeFileSync(file, '# 计划\r\n- [ ] 第一步 — 验证：跑测试\r\n1. [x] 第二步\n* [✓] 第三步\n+ [X]   放弃：  不做  \n- [] 不是复选框\n');
  assert.deepEqual(checkpointMilestones(file), {open: ['第一步 — 验证：跑测试'], done: ['第二步', '第三步', '放弃： 不做']});
  assert.equal(checkpointMilestones(path.join(dir, 'missing.md')), null);
  assert.equal(checkpointMilestones(''), null);
  fs.writeFileSync(path.join(dir, 'blank.md'), '  \n');
  assert.equal(checkpointMilestones(path.join(dir, 'blank.md')), null);

  const marathon = {mode: 'project', tier: 'marathon', taskType: 'implementation', checkpointFile: file};
  assert.deepEqual(marathonMissing(marathon), [MILESTONE_MISSING + '第一步 — 验证：跑测试']);
  fs.writeFileSync(path.join(dir, 'noboxes.md'), '只有文字，没有复选框\n');
  assert.deepEqual(marathonMissing({...marathon, checkpointFile: path.join(dir, 'noboxes.md')}), [PLAN_MISSING]);
  assert.deepEqual(marathonMissing({...marathon, taskType: 'simple'}), [], '简单问答不要检查点');
  assert.deepEqual(marathonMissing({...marathon, tier: 'full'}), [], '只管长跑档');
  assert.deepEqual(marathonMissing({...marathon, mode: 'none'}), [], '无限制模式不管');
  assert.equal(onlyMilestonesMissing([]), false);
  assert.equal(onlyMilestonesMissing([PLAN_MISSING]), true);
  assert.equal(onlyMilestonesMissing([MILESTONE_MISSING + 'a', '求解 0/2']), false);
});

test('审计：停止请求直接放行；无限制模式查事实缺来源与终稿说明', () => {
  assert.deepEqual(auditDeliberation({stopRequested: true}), {complete: true, missing: [], roleGaps: [], finalGaps: [], waived: []});
  const result = auditDeliberation({mode: 'none', tier: 'boost', taskType: 'fact_check', verificationEvidence: []}, '结论');
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ['缺少两个可区分的来源', '最终答复缺少两个来源和不确定性说明']);
  assert.deepEqual(result.finalGaps, ['最终答复缺少两个来源和不确定性说明']);
});

test('审计：全开档缺求解与等待中的子任务；提醒过后求解缺口转为放行', () => {
  const state = {tier: 'full', mode: 'project', taskType: 'standard_answer', pendingChildren: new Set(['c1']), completedRoles: new Map([['solver', 1]]), rolePushes: 0, verificationEvidence: []};
  const result = auditDeliberation(state, '答案是 42');
  assert.deepEqual(result.missing, ['求解 1/2', '等待中的子任务 1', '缺少与本任务相关的实际验证证据']);
  assert.deepEqual(result.roleGaps, ['求解 1/2']);
  const waived = auditDeliberation({...state, pendingChildren: new Set(), rolePushes: 1}, '答案是 42');
  assert.deepEqual(waived.missing, ['缺少与本任务相关的实际验证证据']);
  assert.deepEqual(waived.waived, ['求解 1/2']);
});

test('审计：取舍类终稿缺对比/没交给用户选时报终稿缺口，写全后通过', () => {
  const state = {mode: 'none', tier: 'base', taskType: 'tradeoff', completedRoles: new Map([['solver', 2]]), verificationEvidence: []};
  const bad = auditDeliberation(state, '随便');
  assert.deepEqual(bad.finalGaps, ['最终答复缺少方案差异和代价对比', '最终答复还没有交给用户选择']);
  assert.equal(retryGapKind(bad.missing), 'final');
  assert.equal(auditDeliberation(state, '对比两种方案的成本，请你选择其中一个。').complete, true);
});

test('环节进度：旧五类按证据先后判断复现/修改/测试', () => {
  const requirement = deliberationRequirements('boost', 'none', 'implementation');
  const full = [
    {kind: 'test', ok: false, sequence: 1, output: 'not ok'},
    {kind: 'mutation', ok: true, sequence: 2, output: 'x'},
    {kind: 'test', ok: true, sequence: 3, output: 'ok'},
  ];
  assert.deepEqual(legacyWorkflowStages('implementation', {verificationEvidence: full}, requirement).map(s => s.used), [true, true, true]);
  // 测试跑在改动之前：不算「测试」，也没有失败的复现。
  const early = [{kind: 'test', ok: true, sequence: 1, output: 'ok'}, {kind: 'mutation', ok: true, sequence: 2, output: 'x'}];
  assert.deepEqual(legacyWorkflowStages('implementation', {verificationEvidence: early}, requirement).map(s => s.used), [false, true, false]);
  const fullStd = deliberationRequirements('full', 'project', 'standard_answer');
  const stages = legacyWorkflowStages('standard_answer', {verificationEvidence: [], completedRoles: new Map([['solver', 2], ['critic', 1]])}, fullStd);
  assert.deepEqual(stages, [
    {label: '独立解法', used: true}, {label: '验算', used: false}, {label: '必要时裁决', used: false}, {label: '按需证据审查', used: true},
  ]);
  const simple = workflowProgress({mode: 'none', tier: 'base', taskType: 'simple', endedAt: 1});
  assert.equal(simple.tierLabel, '基础档');
  assert.deepEqual(simple.stages, [{label: '此问题无需多方案，已直接回答', used: true}]);
  assert.deepEqual(workflowProgress({mode: 'none', tier: 'boost', taskType: 'implementation'}).kinds, [], '无限制模式不列新种类');
});

test('子任务面板：等待中和已预约都算 pending；放行后不计入必须项', () => {
  const state = {
    tier: 'full', mode: 'project', taskType: 'standard_answer',
    pendingChildren: new Set(['c1']), childRoles: new Map([['c1', 'solver']]),
    reservations: new Map([['r', {role: 'solver'}]]), completedRoles: new Map([['solver', 1]]), rolePushes: 0,
  };
  const progress = deliberationProgress(state);
  const solver = progress.roles.find(entry => entry.role === 'solver');
  assert.deepEqual(solver, {role: 'solver', label: '求解', completed: 1, pending: 2, required: 2, optional: false});
  assert.equal(progress.required, 2);
  assert.equal(progress.completed, 1);
  assert.ok(progress.roles.filter(entry => entry.role !== 'solver').every(entry => entry.optional));
  const waived = deliberationProgress({...state, rolePushes: 1});
  assert.equal(waived.roles.find(entry => entry.role === 'solver').waived, true);
  assert.equal(waived.required, 0);
});

test('工作区读取：越界、缺文件、目录一律返回空；超长截断并提示', t => {
  const root = tempDir(t);
  fs.writeFileSync(path.join(root, 'big.md'), 'x'.repeat(30));
  assert.equal(readWorkspaceFile(root, 'big.md', 10), 'xxxxxxxxxx\n\n[文件超过全量加载上限，请先精简后再继续累积]');
  assert.equal(readWorkspaceFile(root, 'big.md'), 'x'.repeat(30));
  assert.equal(readWorkspaceFile(root, '../etc/passwd'), '');
  assert.equal(readWorkspaceFile(root, 'missing.md'), '');
  assert.equal(readWorkspaceFile(root, '.'), '');
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/b', `/a/b${path.sep}c`), true);
  assert.equal(isInside('/a/b', '/a/bc'), false, '同前缀的兄弟目录不算在内');
  assert.equal(safeWorkspace({workspaceDir: 'relative'}), null);
  assert.equal(safeWorkspace({workspaceDir: path.join(root, 'nope')}), null);
  assert.equal(safeWorkspace({workspaceDir: root}), root);
  assert.equal(safeWorkspace(), null);
});

test('工作区读取：指向工作区外的软链接不读', {skip: process.platform === 'win32' && 'Windows 建软链接需要额外权限'}, t => {
  const root = tempDir(t);
  const outside = tempDir(t, 'pinkie-deliberation-outside-');
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'link.md'));
  assert.equal(readWorkspaceFile(root, 'link.md'), '');
});

test('运行单：无限制模式走旧运行单，工作模式按种类加求解与长跑检查点', () => {
  assert.equal(buildDeliberationPlan('nope', 'none').split('\n')[0], '【极致思考运行单：boost / none】');
  assert.match(legacyDeliberationPlan('full', 'none'), /全开档的批评环节按需启动/);
  assert.match(legacyDeliberationPlan('marathon', 'none', 'CP'), /“CP”/);
  assert.match(legacyDeliberationPlan('boost', 'none'), /本档续跑上限为 6 次/);
  assert.match(buildDeliberationPlan('full', 'project', 'cp', 'standard_answer'), /派 2–3 个「求解」子任务/);
  assert.match(buildDeliberationPlan('boost', 'project', 'cp', 'tradeoff'), /不派也行/);
  const marathon = buildDeliberationPlan('marathon', 'project', '/cp.md', 'implementation');
  assert.ok(marathon.includes('“/cp.md”'));
  assert.match(marathon, /本档续跑上限 40 次/);
  assert.doesNotMatch(buildDeliberationPlan('base', 'project', 'cp', 'simple'), /续跑上限/, '简单问答不加重试规则');
  // 运行状态对象也能当 task 传入。
  assert.match(buildDeliberationPlan('boost', 'project', 'cp', {taskType: 'implementation', workKinds: ['code']}), /续跑上限 6 次/);
});

test('续跑提示：按缺口种类写不同的补救，旧稿截到 DRAFT_KEEP', () => {
  assert.equal(retryGapKind([]), '');
  assert.equal(retryGapKind([SHORT_FINAL]), 'final');
  assert.equal(retryGapKind(['求解 0/2']), 'roles');
  assert.equal(retryGapKind(['等待中的子任务 1']), 'roles');
  assert.equal(retryGapKind(['缺少两个可区分的来源']), 'evidence');
  assert.equal(tierRetryInstruction(['缺少两个可区分的来源'], 'evidence', ''),
    '当前任务还差：缺少两个可区分的来源。只补做缺的那一步核对（打开、截图、转图片、运行或重算），不要重做已经做完的部分。确实做不到就如实说本轮没做完、卡在哪。不要在回复里提到这条提醒。');
  assert.match(tierRetryInstruction([SHORT_FINAL], 'final', ''), /不用再调用工具/);
  const roles = tierRetryInstruction(['求解 0/2'], 'roles', '旧稿');
  assert.match(roles, /sessions_spawn/);
  assert.ok(roles.endsWith('上一版回复：<<<旧稿>>>'));
  const long = tierRetryInstruction(['x'], 'evidence', 'y'.repeat(70_000));
  assert.equal(long.match(/<<<(y*)>>>/)[1].length, 60_000);
});

test('小工具：去空白计字、分段标题、短完成语', () => {
  assert.equal(visibleReplyText(' a b\n\tc '), 'abc');
  assert.equal(section('a.md', '  x  '), '\n--- a.md（本轮从当前模式工作区完整重载）---\nx\n');
  assert.equal(section('a.md', ''), '');
  for (const done of ['做好了。', '搞定', 'done', '已完成！']) assert.ok(SHORT_DONE.test(done), done);
  assert.equal(SHORT_DONE.test('做好了，但还差一步'), false);
});
