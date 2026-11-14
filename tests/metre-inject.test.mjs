// Metre 模式批 0（briefs/metre-mode-1113 ACCEPTANCE A0-4 / A0-5 / A0-6 / A0-7 / A0-10）：
// 抓三个插件 before_prompt_build 的真实产出，断言 Metre 一轮里没有碧琪那一套、开销在预算内，老模式的注入没变。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.PINKIE_MANAGED_GATEWAY;
delete process.env.OPENCLAW_SERVICE_KIND;
process.env.PINKIE_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-inject-state-'));
process.on('exit', () => fs.rmSync(process.env.PINKIE_STATE_ROOT, {recursive: true, force: true}));

const {collect, pluginHooks} = await import('../tools/metre/inject-inventory.mjs');
const {CompletionIntegrityGuard, modeForContext} = await import('../services/mode-architecture/index.mjs');
const {normalizeMode} = await import('../services/mode-architecture/session-lineage.mjs');
const {sessionHintBlock} = await import('../services/mode-architecture/session-hints.mjs');

// 这些是项目模式一轮里各段注入的标题（清点见 briefs/metre-mode-1113/INJECTION-INVENTORY.md）。
const BIQI_ONLY = [
  ['打法卡 / 活儿卡', /【这件活/],
  ['工具箱提示', /【先备好工具】/],
  ['技能路由', /【技能/],
  ['别的模式更拿手', /更拿手/],
  ['边做边学', /【独立模块：边做边学】/],
  ['记忆自动回放', /【独立长期记忆引擎/],
  ['模式记忆规则', /【模式记忆运行规则/],
  ['做事标准', /做事标准（每个模式/],
  ['App 指南', /碧琪的家/],
  ['富回复说明', /聊天已支持富回复/],
  ['工作过程展示', /【工作过程展示】/],
  ['碧琪称呼', /先生|老板/],
  ['无限制运行时标记', /OPENCLAW_UR_INJECT/],
];
const PROMPTS = [
  '帮我把登录页的按钮改成蓝色，顺便跑一下测试，看看有没有别的地方也要改',
  '帮我写一份市场调研报告，再做一个展示页面',
  '你好',
  '给这个新产品起几个名字，顺便想想海报怎么设计',
];

test('A0-5/A0-10 Metre 一轮里没有碧琪的人设、打法、路由、陪伴、改写和无限制标记', async () => {
  for (const prompt of PROMPTS) {
    const metre = await collect('metre', {prompt});
    for (const [label, pattern] of BIQI_ONLY) assert.doesNotMatch(metre.text, pattern, `${label} 出现在 Metre：${prompt}`);
    assert.match(metre.text, /【全局交付真实性门禁】/, '门禁说明必须还在');
  }
});

test('老模式的注入没被 Metre 的分支改动（项目模式仍有整套）', async () => {
  const project = await collect('project', {prompt: PROMPTS[0]});
  for (const marker of [/【全局交付真实性门禁】/, /【工具调用前的进度说明】/, /【长时间命令放后台】/, /做事标准/, /碧琪的家/,
    /【主动提问】/, /【独立模块：边做边学】/, /【模式记忆运行规则：project】/, /聊天已支持富回复/, /【工作过程展示】/, /【工作台】/]) {
    assert.match(project.text, marker);
  }
  assert.doesNotMatch(project.text, /【后台命令】长命令/);
});

test('A0-4 Metre 一轮的固定文字开销不超过 6000 字（工作区文件 + 插件注入）', async () => {
  for (const prompt of PROMPTS) {
    const metre = await collect('metre', {prompt});
    assert.ok(metre.total <= 6000, `${metre.total} 字：${prompt}`);
  }
  const workspace = fs.readdirSync(path.resolve('personas/metre')).sort();
  assert.deepEqual(workspace, ['AGENTS.md', 'IDENTITY.md', 'SOUL.md']);
});

test('A0-9 Metre 的插件工具不少于项目模式', async () => {
  const project = await collect('project');
  const metre = await collect('metre');
  assert.deepEqual(project.toolNames.filter(name => !metre.toolNames.includes(name)), []);
});

test('A0-6 交付门禁对 Metre 照常拦：和项目模式同样的经过、同样的结论', () => {
  const run = agentId => {
    const results = [];
    for (const [suffix, steps] of Object.entries({
      'no-exec': guard => guard.finalize({lastAssistantMessage: '已经全部完成并成功交付。'}, ctx(agentId, 'no-exec')),
      'last-error': guard => {
        guard.afterTool({toolName: 'exec', error: 'command failed', result: 'Command exited with code 1'}, ctx(agentId, 'last-error'));
        return guard.finalize({lastAssistantMessage: '程序已经成功修复完成。'}, ctx(agentId, 'last-error'));
      },
      'write-no-check': guard => {
        guard.beforeTool({toolName: 'write', toolCallId: 'w', params: {path: '/tmp/metre-gate.txt'}}, ctx(agentId, 'write-no-check'));
        guard.afterTool({toolName: 'write', toolCallId: 'w', params: {path: '/tmp/metre-gate.txt'}, result: {ok: true}}, ctx(agentId, 'write-no-check'));
        guard.afterTool({toolName: 'exec', params: {command: 'npm test'}, result: 'tests failed', isError: true}, ctx(agentId, 'write-no-check'));
        return guard.finalize({lastAssistantMessage: '改好了，测试全部通过。'}, ctx(agentId, 'write-no-check'));
      },
    })) {
      const guard = new CompletionIntegrityGuard();
      guard.begin({prompt: '修改文件并运行测试'}, ctx(agentId, suffix));
      const decision = steps(guard);
      results.push([suffix, decision?.action || 'accept', decision?.reason || '']);
    }
    return results;
  };
  const ctx = (agentId, suffix) => ({agentId, sessionKey: `agent:${agentId}:gate-${suffix}`, runId: `run-${agentId}-${suffix}`});
  const project = run('project');
  const metre = run('metre');
  assert.deepEqual(metre, project);
  for (const [suffix, action] of metre) assert.equal(action, 'revise', suffix);
});

test('A0-7 别的模式不能把活派进 Metre，提醒里也不建议去 Metre', () => {
  assert.throws(() => normalizeMode('metre'));
  assert.throws(() => normalizeMode('Metre模式'));
  for (const mode of ['chat', 'project', 'ideas', 'learning']) {
    const agent = {chat: 'main', ideas: 'thinking'}[mode] || mode;
    for (const prompt of PROMPTS) {
      const hint = sessionHintBlock(`agent:${agent}:hint-test`, prompt, [], {mode});
      assert.doesNotMatch(hint || '', /metre|Metre/);
    }
  }
  assert.equal(modeForContext({sessionKey: 'agent:metre:x'}), 'metre');
});

test('Metre 的回复不做第一人称改写，老模式照旧', async () => {
  const {hooks} = await pluginHooks();
  const send = hooks.filter(hook => hook.name === 'reply_payload_sending');
  assert.ok(send.length);
  const run = async ctx => {
    let event = {payload: {text: '我已经检查完配置了。'}};
    for (const hook of send) {
      const out = await hook.fn(event, ctx);
      if (out?.payload) event = {...event, payload: out.payload};
    }
    return event.payload.text;
  };
  assert.equal(await run({agentId: 'metre', sessionKey: 'agent:metre:first-person'}), '我已经检查完配置了。');
  assert.equal(await run({agentId: 'main', sessionKey: 'agent:main:first-person'}), '碧琪已经检查完配置了。');
});
