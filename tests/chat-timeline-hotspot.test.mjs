// Recurrence lock for a fix in patch/apply-chat-timeline.mjs that the tests
// shipped with that commit do not catch.
//
// 6890089b added "Continue the OpenClaw runtime event" to isInternalUserMessage.
// The older pattern only matched [pinkie-watchdog], [pinkie-tier-control] and
// [pinkie-tier]. tests/chat-tool-timeline.test.mjs still only feeds those
// prefixes, so deleting the runtime-event alternative leaves that file green.
//
// No browser, no upstream calls. The projection functions are pure.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinkieBuildTimeline, pinkieSelectMessageWindow} from '../patch/apply-chat-timeline.mjs';

const message = (role, content, id, extra = {}) => ({role, content, timestamp: 1, __openclaw: {id}, ...extra});
const group = (role, key, messages) => ({
  kind: 'group', key, role, timestamp: 1,
  messages: messages.map((entry, index) => ({message: entry, key: `${key}:${index}`})),
});

function textsOf(value) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.content === 'string') found.push(node.content);
    if (typeof node.text === 'string') found.push(node.text);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const item of Object.values(node)) walk(item);
  };
  walk(value);
  return found;
}

const RUNTIME_EVENT = 'Continue the OpenClaw runtime event.';
const RUNTIME_EVENT_BARE = 'Continue the OpenClaw runtime event';

test('a runtime-event prompt is not a user bubble and does not drop the real turn', () => {
  const real = message('user', '把这一段写完', 'real');
  const event = message('user', RUNTIME_EVENT, 'flush');
  const bare = message('user', RUNTIME_EVENT_BARE, 'flush-bare');
  const hidden = message('user', `\u200B${RUNTIME_EVENT}`, 'flush-zw');
  const spoken = message('user', '请不要只回复 Continue the OpenClaw runtime event.', 'spoken');
  const answer = {...message('assistant', '写好了。', 'answer'), stopReason: 'stop'};
  const after = {...message('assistant', '接着写。', 'after'), stopReason: 'stop'};

  const selected = pinkieSelectMessageWindow([
    real, event, bare, hidden, spoken, answer,
  ], () => false);
  assert.deepEqual(selected.map((item) => item.__openclaw.id), ['real', 'spoken', 'answer']);

  const timeline = pinkieBuildTimeline([
    group('user', 'real', [real]),
    group('assistant', 'answer', [answer]),
    group('user', 'flush', [event]),
    group('user', 'flush-bare', [bare]),
    group('user', 'flush-zw', [hidden]),
    group('assistant', 'after', [after]),
    group('user', 'spoken', [spoken]),
  ], () => []);
  const userRows = timeline.filter((item) => item.role === 'user');
  assert.deepEqual(userRows.map((item) => item.messages[0].message.__openclaw.id), ['real', 'spoken']);
  const rendered = textsOf(timeline);
  assert.equal(rendered.includes(RUNTIME_EVENT), false);
  assert.equal(rendered.includes(RUNTIME_EVENT_BARE), false);
  assert.ok(rendered.includes('写好了。'));
  assert.ok(rendered.includes('接着写。'));
  assert.ok(rendered.includes('请不要只回复 Continue the OpenClaw runtime event.'));
});
