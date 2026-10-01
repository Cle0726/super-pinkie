import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ASK_MARKER, ASK_USER_RULES, createAskUserTool, endsWithUserQuestion, normalizeAskParams, parseAskToolResult,
} from '../services/mode-architecture/ask.mjs';
import {CleKkAuditLog, CleKkSupervisor, CompletionIntegrityGuard} from '../services/mode-architecture/index.mjs';

test('ask_user validates 2–4 distinct options and keeps the card recoverable from its result', async () => {
  const tool = createAskUserTool();
  assert.equal(tool.name, 'ask_user');
  assert.deepEqual(tool.parameters.required, ['question', 'options']);
  const result = await tool.execute('call-1', {
    question: '先修哪个问题？', header: '优先级',
    options: [{label: '时间线（推荐）', description: '影响每一轮'}, {label: '笔记', description: '只在学习模式'}],
  });
  assert.equal(result.isError, false);
  assert.ok(result.content[0].text.startsWith(ASK_MARKER));
  const card = parseAskToolResult(result.content[0].text);
  assert.equal(card.id, 'call-1');
  assert.equal(card.question, '先修哪个问题？');
  assert.deepEqual(card.options.map((option) => option.label), ['时间线（推荐）', '笔记']);
  assert.equal(card.multiSelect, false);

  for (const bad of [
    {question: '', options: ['a', 'b']},
    {question: '选哪个？', options: ['只有一个']},
    {question: '选哪个？', options: ['a', 'b', 'c', 'd', 'e']},
    {question: '选哪个？', options: ['重复', '重复']},
  ]) {
    const failed = await tool.execute('bad', bad);
    assert.equal(failed.isError, true);
    assert.equal(parseAskToolResult(failed.content[0].text), null);
  }
  assert.equal(normalizeAskParams({question: '多选？', options: ['a', 'b'], multi_select: true}).multiSelect, true);
  assert.match(ASK_USER_RULES, /ask_user/);
  assert.match(ASK_USER_RULES, /本轮就此停下/);
});

test('a turn ending on ask_user is a deliberate pause, not an interrupted tool lane', () => {
  const ask = {role: 'assistant', stopReason: 'toolUse', content: [
    {type: 'text', text: '这个得你来定。'}, {type: 'toolCall', name: 'ask_user', id: 'q1', arguments: {}},
  ]};
  const result = {role: 'toolResult', toolName: 'ask_user', toolCallId: 'q1', isError: false,
    content: [{type: 'text', text: `${ASK_MARKER}{}`}]};
  assert.equal(endsWithUserQuestion([ask, result]), true);
  assert.equal(endsWithUserQuestion([ask]), true);
  assert.equal(endsWithUserQuestion([{...result, isError: true}]), false);
  const read = {role: 'toolResult', toolName: 'read', toolCallId: 'r1', content: [{type: 'text', text: 'x'}]};
  assert.equal(endsWithUserQuestion([ask, result, read]), false);
  const mixed = {...ask, content: [...ask.content, {type: 'toolCall', name: 'exec', id: 'e1', arguments: {}}]};
  assert.equal(endsWithUserQuestion([mixed]), false);
});

test('the delivery gate accepts a turn that stops to ask the user', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-kk-ask-user-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const key = 'agent:project:ask-user', ctx = {agentId: 'project', sessionKey: key, runId: 'r1'};
  const supervisor = new CleKkSupervisor({audit: new CleKkAuditLog(root), integrity: new CompletionIntegrityGuard()});
  supervisor.begin({prompt: '帮我把登录页改好看一点', runId: 'r1'}, ctx);
  supervisor.afterTool({toolName: 'read', toolCallId: 'r', runId: 'r1', params: {path: 'login.css'}, result: 'css'}, ctx);
  supervisor.afterTool({toolName: 'ask_user', toolCallId: 'q', runId: 'r1', params: {}, result: {content: [{type: 'text', text: `${ASK_MARKER}{}`}]}}, ctx);
  const decision = supervisor.integrity.finalize({lastAssistantMessage: '选好我就接着做。'}, ctx, {verifyExternal: false});
  assert.equal(decision?.action === 'revise', false, decision?.reason);
});
