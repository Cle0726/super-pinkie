// tools-health-1113 C2: one hint per session when exec does read / code_search / web_fetch's job.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EXEC_HINT, createExecHints, execCategory, registerExecHints} from '../services/mode-architecture/exec-hints.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the hint is the sentence Fable wrote (PLAN section five)', () => {
  const plan = fs.readFileSync(path.join(root, 'briefs/tools-health-1113/PLAN.md'), 'utf8');
  assert.ok(plan.includes(`> ${EXEC_HINT}`));
});

test('commands are classified by their first segment only', () => {
  for (const c of ['cat src/a.js', 'head -n 50 x.py', 'sed -n 1,80p f', 'Get-Content C:\a.txt', 'type a.txt', 'tail -f log | grep x']) assert.equal(execCategory(c), 'read', c);
  for (const c of ['grep -rn send_order .', 'rg foo', 'Select-String -Path *.js -Pattern x', 'git grep foo', 'findstr /s foo *.js']) assert.equal(execCategory(c), 'search', c);
  for (const c of ['curl -s https://x', 'wget https://x', 'Invoke-WebRequest https://x', 'python -c "import urllib.request as u; print(u.urlopen(\'https://x\').read())"']) assert.equal(execCategory(c), 'fetch', c);
  for (const c of ['npm test | head -20', 'python build.py', 'git status', 'ls -la', 'node x.js && cat out.txt', '', undefined]) assert.equal(execCategory(c), null, String(c));
});

function run(hints, {id, command, sessionKey = 's1', isError = false, tool = 'exec'}) {
  hints.remember({toolName: tool, toolCallId: id, params: {command}}, {sessionKey});
  return hints.annotate({toolName: tool, toolCallId: id, message: {role: 'toolResult', isError, content: [{type: 'text', text: 'out'}]}}, {sessionKey, toolCallId: id});
}

test('one hint per session, appended to a normal result; errors untouched; nothing blocked', () => {
  const hints = createExecHints();
  assert.equal(run(hints, {id: 'a', command: 'cat x', isError: true}), undefined, 'failed command: no hint');
  const first = run(hints, {id: 'b', command: 'cat x'});
  assert.deepEqual(first.message.content.map(c => c.text), ['out', EXEC_HINT]);
  assert.equal(first.message.isError, false, 'not marked as error');
  assert.equal(run(hints, {id: 'c', command: 'grep -rn x .'}), undefined, 'same session: once only');
  assert.equal(run(hints, {id: 'd', command: 'curl https://x'}), undefined);
  assert.ok(run(hints, {id: 'e', command: 'rg x', sessionKey: 's2'}), 'another session gets its own');
  assert.equal(run(hints, {id: 'f', command: 'npm test', sessionKey: 's3'}), undefined, 'ordinary command');
  assert.equal(run(hints, {id: 'g', command: 'cat x', sessionKey: 's4', tool: 'read'}), undefined, 'only exec');
});

test('the plugin registers a non-blocking before_tool_call and a sync persist hook', () => {
  const handlers = {};
  registerExecHints({on: (name, fn) => { handlers[name] = fn; }});
  assert.equal(handlers.before_tool_call({toolName: 'exec', toolCallId: 'x', params: {command: 'cat a'}}, {sessionKey: 'k'}), undefined);
  const out = handlers.tool_result_persist({toolName: 'exec', toolCallId: 'x', message: {content: 'raw'}}, {sessionKey: 'k', toolCallId: 'x'});
  assert.equal(typeof out?.then, 'undefined', 'synchronous');
  assert.deepEqual(out.message.content.map(c => c.text), ['raw', EXEC_HINT]);
});
