import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanReplyText, sanitizeAssistantMessage} from '../services/mode-architecture/reply-hygiene.mjs';

// Shapes copied from real learning-mode replies where Gemini wrote its
// internal anti-spoiler self-check (and once the answer) into the reply.
test('a self-check aside is removed and the rest of the reply is untouched', () => {
  const reply = '消灭了这个拼写小坑，咱们信心满满迎战 **第 36 题**！\n（严格执行【出题自检门禁】：**纯净裸题，零前戏、零暗示**👇）\n\n---\n\n### 📝 2024.12 真题 · 第 36 题\n\n**36. You are welcome to take this program (develop) ________ by our university.**';
  const cleaned = cleanReplyText(reply);
  assert.doesNotMatch(cleaned, /门禁|零前戏/);
  assert.match(cleaned, /^消灭了这个拼写小坑，咱们信心满满迎战 \*\*第 36 题\*\*！/);
  assert.match(cleaned, /### 📝 2024\.12 真题 · 第 36 题/);
  assert.match(cleaned, /\(develop\) ________ by our university/);
});

test('a leaked draft with the answer plus a checklist is dropped, keeping the real reply', () => {
  const reply = [
    '第 37 题原题：',
    '考点：词缀变形。',
    '名词前面需要形容词，harm + ful 变成 harmful（有害的），因此填 harmful。',
    '',
    '执行【出题自检门禁】：',
    '- 纯净裸题，无前情提要，无剧透原词，无秒杀暗示！',
    '- 标注生词简单释义与好读谐音：',
    '  - avoid【谐音：额窝意得】= 避免',
    '- 格式规范：单道题，等待先生作答！**太帅了先生！全中！双 A B 满分通过！** 🎯💯',
    '',
    '- 第 1 题：看到 `by` 选被动，稳稳选 **A）written**！',
    '',
    '### 📝 2024.12 真题 · 第 37 题',
    '**37. We should avoid using cleaning products that contain (harm) ________ chemicals.**',
  ].join('\n');
  const cleaned = cleanReplyText(reply);
  assert.doesNotMatch(cleaned, /harmful|考点：|门禁|纯净裸题|格式规范/);
  assert.match(cleaned, /^\*\*太帅了先生！全中！双 A B 满分通过！\*\* 🎯💯/);
  assert.match(cleaned, /第 1 题：看到 `by` 选被动/);
  assert.match(cleaned, /\(harm\) ________ chemicals/);
});

test('a heading glued to the last checklist item survives', () => {
  const reply = '先生答对啦！\n\n执行【出题自检门禁】：\n- 题干中是否包含挖空答案原词？否。\n- 只有纯净裸题，等待先生作答！### 📝 2024.12 真题 · 第 34 题\n\n**34. ____ a college student, he works hard.**';
  const cleaned = cleanReplyText(reply);
  assert.match(cleaned, /^先生答对啦！/, 'text addressed to the user before the checklist stays');
  assert.match(cleaned, /### 📝 2024\.12 真题 · 第 34 题/);
  assert.doesNotMatch(cleaned, /门禁|挖空答案原词/);
});

test('ordinary replies, teaching labels and empty results are left alone', () => {
  for (const reply of [
    '先生太棒了！记住【看到 by，闭眼抓 -ed！】这条秒杀铁律。',
    '这一步我已经核对过了，测试全部通过。',
    '',
  ]) assert.equal(cleanReplyText(reply), reply);
  // Nothing worth sending would be left: keep the original instead of blanking it.
  const onlyGate = '（执行【出题自检门禁】：纯净裸题）';
  assert.equal(cleanReplyText(onlyGate), onlyGate);
});

test('assistant messages are cleaned part by part and untouched messages return null', () => {
  const message = {role: 'assistant', stopReason: 'stop', content: [
    {type: 'thinking', thinking: '内部思考【出题自检门禁】'},
    {type: 'text', text: '咱们拿下下一题！\n（执行【出题自检门禁】：纯净裸题，2 选 1 秒杀👇）\n\n**38. Which one is correct?**'},
  ]};
  const cleaned = sanitizeAssistantMessage(message);
  assert.equal(cleaned.content[0], message.content[0], 'thinking parts are not rewritten');
  assert.doesNotMatch(cleaned.content[1].text, /门禁/);
  assert.equal(sanitizeAssistantMessage({role: 'assistant', content: '普通回复'}), null);
  assert.equal(sanitizeAssistantMessage({role: 'user', content: '（执行【出题自检门禁】）'}), null);
});
