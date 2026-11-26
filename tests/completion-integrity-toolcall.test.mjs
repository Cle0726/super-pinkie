// 复发锁：assistantMessageHasToolCall 在 content 不是数组时曾直接 return false，
// 导致 content 为 null / 字符串、却带着 tool_calls / toolCalls / toolCall 的消息
// 被判成「没有工具调用」，进而让 isTerminalAssistantMessage 把标了 final 的
// 工具调用消息当成终答。纯函数测试：假消息对象，不联网，不起服务。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assistantMessageHasToolCall,
  isTerminalAssistantMessage,
} from '../services/mode-architecture/completion-integrity.mjs';

const NON_ARRAY_CONTENTS = [null, undefined, '', '调用中', {type: 'text', text: '对象形 content'}];

const TOOL_FIELDS = [
  ['tool_calls', {tool_calls: [{id: 'c1', type: 'function', function: {name: 'read', arguments: '{}'}}]}],
  ['toolCalls', {toolCalls: [{id: 'c1', name: 'read'}]}],
  ['toolCall', {toolCall: {id: 'c1', name: 'read'}}],
  ['tool_call', {tool_call: {id: 'c1', name: 'read'}}],
];

test('content 不是数组时仍认出 tool_calls / toolCalls / toolCall / tool_call 字段', () => {
  for (const content of NON_ARRAY_CONTENTS) {
    for (const [field, extra] of TOOL_FIELDS) {
      const message = {role: 'assistant', content, ...extra};
      assert.equal(assistantMessageHasToolCall(message), true, `content=${JSON.stringify(content)} 字段=${field}`);
    }
  }
});

test('content 不是数组、带工具调用、又标了 final / 终止 stopReason 的消息不算终答', () => {
  const terminalMarks = [{final: true}, {isFinal: true}, {terminal: true}, {stopReason: 'stop'}, {stop_reason: 'end'}];
  for (const content of NON_ARRAY_CONTENTS) {
    for (const [field, extra] of TOOL_FIELDS) {
      for (const mark of terminalMarks) {
        const message = {role: 'assistant', content, ...extra, ...mark};
        assert.equal(isTerminalAssistantMessage(message), false,
          `content=${JSON.stringify(content)} 字段=${field} 标记=${JSON.stringify(mark)}`);
      }
    }
  }
});

test('没有任何工具调用时，非数组 content 仍判为无工具调用，终答判断不受影响', () => {
  for (const content of NON_ARRAY_CONTENTS) {
    const plain = {role: 'assistant', content};
    assert.equal(assistantMessageHasToolCall(plain), false, `content=${JSON.stringify(content)}`);
    assert.equal(isTerminalAssistantMessage({...plain, final: true}), true, `final content=${JSON.stringify(content)}`);
    assert.equal(isTerminalAssistantMessage({...plain, stopReason: 'stop'}), true, `stop content=${JSON.stringify(content)}`);
    assert.equal(isTerminalAssistantMessage(plain), false, `无标记 content=${JSON.stringify(content)}`);
  }
  // 空数组 / 假值字段不算工具调用
  assert.equal(assistantMessageHasToolCall({role: 'assistant', content: null, tool_calls: [], toolCalls: [], toolCall: null}), false);
  assert.equal(assistantMessageHasToolCall({role: 'assistant', content: '文字', tool_calls: 'not-array'}), false);
});

test('数组 content 的原有行为保持不变', () => {
  assert.equal(assistantMessageHasToolCall({role: 'assistant', content: [{type: 'toolCall', id: 'c1'}]}), true);
  assert.equal(assistantMessageHasToolCall({role: 'assistant', content: [{type: 'tool_use', id: 'c1'}]}), true);
  assert.equal(assistantMessageHasToolCall({role: 'assistant', content: [{type: 'text', text: '好'}]}), false);
  assert.equal(assistantMessageHasToolCall({role: 'assistant', content: [{type: 'text', text: '好'}], tool_calls: [{id: 'c1'}]}), true);
  assert.equal(isTerminalAssistantMessage({role: 'assistant', content: [{type: 'text', text: '完成了'}], final: true}), true);
  assert.equal(isTerminalAssistantMessage({role: 'assistant', content: [{type: 'toolCall'}], stopReason: 'stop'}), false);
});
