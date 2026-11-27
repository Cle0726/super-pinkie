import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRoleToolCall} from '../services/mode-architecture/metre-roles.mjs';

// B18: app_browser serve with a command runs it through a shell, so it must be treated as exec.
const browserOnly = {id: 'competitor-analyst', name: '竞品分析', tools: ['read', 'net', 'browser']};
const withExec = {id: 'frontend-fix', name: '前端修复', tools: ['read', 'write', 'exec', 'browser', 'net'], deny_commands: ['git push']};
const serve = command => ({action: 'serve', command, cwd: '/tmp/x', port: 5173});

test('a browser-only role cannot start a shell command through app_browser serve', () => {
  const r = checkRoleToolCall(browserOnly, 'app_browser', serve('npm run dev'));
  assert.equal(r.block, true);
  assert.match(r.blockReason, /exec/);
});

test('deny_commands applies to the app_browser serve command', () => {
  assert.equal(checkRoleToolCall(withExec, 'app_browser', serve('npm run dev && git push')).block, true);
  assert.equal(checkRoleToolCall(withExec, 'app_browser', serve('npm run dev')).block, false);
});

test('other app_browser actions and static-directory serve stay browser-category', () => {
  assert.equal(checkRoleToolCall(browserOnly, 'app_browser', {action: 'open', url: 'https://example.com'}).block, false);
  assert.equal(checkRoleToolCall(browserOnly, 'app_browser', {action: 'serve', dir: '/tmp/site'}).block, false);
  assert.equal(checkRoleToolCall(browserOnly, 'app_browser', {action: 'serve_logs'}).block, false);
});
