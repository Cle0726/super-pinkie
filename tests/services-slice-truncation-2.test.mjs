// B3c · services/ 下「正文 slice(0, N) 之后又交给模型或用户看」的复发防护（续 B3b / #241，同 #199：截断吞正文）。
// 两处：长期记忆正文（memory.mjs）、工作台行内修改要求（workbench-lsp.mjs）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as memoryModule from '../services/mode-architecture/memory.mjs';
import * as lsp from '../services/mode-architecture/workbench-lsp.mjs';

// 整个模块导入：只回退修复时，每条用例按行为变红，而不是整份文件在导入时就挂掉。
const {LongTermMemoryStore, explicitMemoryCandidate} = memoryModule;
const {CodeAssistant} = lsp;
const MEMORY_TEXT_MAX = memoryModule.MEMORY_TEXT_MAX ?? 2400;
const EDIT_INSTRUCTION_MAX = lsp.EDIT_INSTRUCTION_MAX ?? 2000;

function memoryFixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-slice-memory-'));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const root = path.join(home, '.openclaw/workspace');
  fs.mkdirSync(path.join(root, 'memory'), {recursive: true});
  const memory = new LongTermMemoryStore({home, stateRoot: path.join(home, 'state'), now: () => 1_900_000_000_000});
  // 不受环境里设定守卫开关影响：这里只测长度。
  memory.guardEnabled = false;
  const ctx = {mode: 'chat', agentId: 'main', sessionKey: 'agent:main:main', workspaceDir: root};
  return {memory, ctx};
}

// 记忆正文按 NFKC 归一化存（全角「：」会变成「:」），所以测试文本只用归一化前后不变的字符。
const longFact = (n, tail) => `项目资料 ${'这一段写得很长。'.repeat(Math.ceil(n / 8))}`.slice(0, n - tail.length) + tail;

test('长期记忆：上限内的正文原样存下，结尾不丢', t => {
  const {memory, ctx} = memoryFixture(t);
  const text = longFact(MEMORY_TEXT_MAX, 'MEM-TAIL-结尾');
  assert.equal(text.length, MEMORY_TEXT_MAX);
  const {record} = memory.remember(ctx, {kind: 'fact', text});
  assert.equal(record.text, text);
  assert.ok(memory.list(ctx).records[0].text.endsWith('MEM-TAIL-结尾'));
});

test('长期记忆：超长正文直接拒绝并说清楚，不截一半存进去', t => {
  const {memory, ctx} = memoryFixture(t);
  const text = longFact(MEMORY_TEXT_MAX + 600, 'MEM-TAIL-丢了');
  assert.throws(() => memory.remember(ctx, {kind: 'fact', text}),
    new RegExp(`记忆内容有 ${text.length} 字，超过一条能存的 ${MEMORY_TEXT_MAX} 字，没有写入`));
  assert.equal(memory.list(ctx).records.length, 0, 'nothing half-cut was stored');
});

test('长期记忆：超长的「请记住」原话不自动截一半存，交给主会话整理', t => {
  const {memory, ctx} = memoryFixture(t);
  const prompt = `请记住：${longFact(MEMORY_TEXT_MAX + 200, 'PROMPT-TAIL')}`;
  assert.equal(explicitMemoryCandidate(prompt), '');
  assert.equal(memory.captureExplicit(ctx, prompt), null);
  assert.equal(memory.list(ctx).records.length, 0);
  // 正常长度的原话照旧自动存，全文不变。
  const short = '请记住:我偏爱安静、克制的界面。';
  assert.equal(explicitMemoryCandidate(short), short);
  assert.equal(memory.captureExplicit(ctx, short).record.text, short);
});

function assistantFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-slice-lsp-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const calls = [];
  const transport = {
    catalog: () => ({models: [{ref: 'mm/gemini-3-flash', name: 'gemini-3-flash'}]}),
    requestModel: async (model, rules, items) => { calls.push({model, items}); return {text: 'x = 1'}; },
  };
  const assistant = new CodeAssistant({runtime: {config: {current: () => ({})}}}, {transport, routeFile: path.join(dir, 'route.json')});
  t.after(() => clearTimeout(assistant.saveTimer));
  return {assistant, calls};
}

test('行内修改：上限内的修改要求整段交给模型', async t => {
  const {assistant, calls} = assistantFixture(t);
  const instruction = `${'把变量名改清楚一点。'.repeat(Math.ceil(EDIT_INSTRUCTION_MAX / 10))}`.slice(0, EDIT_INSTRUCTION_MAX - 9) + 'EDIT-TAIL';
  assert.equal(instruction.length, EDIT_INSTRUCTION_MAX);
  const out = await assistant.edit({path: 'a.py', language: 'python', instruction, code: 'x=1'});
  assert.equal(out.text, 'x = 1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].items[0].instruction, instruction, 'the end of the instruction reaches the model');
});

test('行内修改：超长的修改要求直接拒绝，不截一半交给模型再替换选区', async t => {
  const {assistant, calls} = assistantFixture(t);
  const instruction = `${'先这样改，'.repeat(500)}最后这条要求最重要：EDIT-TAIL`;
  assert.ok(instruction.length > EDIT_INSTRUCTION_MAX);
  await assert.rejects(assistant.edit({path: 'a.py', language: 'python', instruction, code: 'x=1'}),
    new RegExp(`修改要求有 ${instruction.length} 字，超过 ${EDIT_INSTRUCTION_MAX} 字，没有发出去`));
  assert.equal(calls.length, 0, 'nothing half-cut reached the model');
});
