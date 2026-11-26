import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRoleToolCall} from '../services/mode-architecture/metre-roles.mjs';

// B18: run_tests appends `filter` verbatim to the test command and runs it with shell: true.
const card = {id: 'backend-fix', name: '后端修复', tools: ['read', 'write', 'exec', 'net'], deny_commands: ['git push', 'npm publish']};

test('a role\'s deny_commands also covers run_tests filter', () => {
  for (const params of [
    {filter: 'tests/a.test.mjs && git push'},
    {filter: 'x; npm publish'},
    {filter: 'x\ngit push origin main'},
    {command: 'node --test', filter: 'a.test.mjs | git push'},
    {command: 'git', filter: 'push'},
  ]) {
    assert.equal(checkRoleToolCall(card, 'run_tests', params).block, true, `应拦截：${JSON.stringify(params)}`);
  }
});

test('ordinary run_tests calls and filters are still allowed', () => {
  for (const params of [{}, {filter: 'tests/push.test.mjs'}, {filter: 'git push 的测试名'.replace('git push', 'gitpush')}, {command: 'npm test', filter: '--grep publish'}, {command: 'node --test tests/a.test.mjs'}]) {
    assert.equal(checkRoleToolCall(card, 'run_tests', params).block, false, `不应拦截：${JSON.stringify(params)}`);
  }
  assert.equal(checkRoleToolCall(card, 'exec', {command: 'git status'}).block, false);
  assert.equal(checkRoleToolCall(card, 'exec', {command: 'git push'}).block, true);
});
