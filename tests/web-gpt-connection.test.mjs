import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WebGptConnectionManager} from '../services/mode-architecture/web-gpt-connection.mjs';

// 假桥接：Node 脚本放在 runtime/bin/c2c.js（Windows 上由 Node 直接跑它），
// 其它系统再套一个 pinkie-collab 外壳，和安装出来的结构一致。
function fakeBridge(root, body) {
  const script = path.join(root, 'runtime', 'bin', 'c2c.js');
  fs.mkdirSync(path.dirname(script), {recursive: true});
  fs.writeFileSync(script, `const fs = require('node:fs');
const [cmd, sub] = process.argv.slice(2);
const out = value => console.log(typeof value === 'string' ? value : JSON.stringify(value));
${body}
`);
  fs.writeFileSync(path.join(root, 'pinkie-collab'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`, {mode: 0o700});
}

test('connection status is read-only, workspace-scoped and keeps destructive actions confirmed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-connection-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const bindingFile = path.join(root, 'bindings.json');
  const sessionKey = 'agent:project:connection-test';
  fs.writeFileSync(bindingFile, JSON.stringify({[sessionKey]: {root: workspace, name: '测试项目'}}));
  const cli = path.join(root, 'pinkie-collab');
  fakeBridge(root, `if (cmd === 'status') out({ok: true, running: true, publicUrl: 'https://pinkie.example', tunnel: {running: true}});
else if (cmd === 'prefs') out({ok: true, developerModeEnabled: true});
else if (cmd === 'session') {
  if (sub === 'set') { fs.writeFileSync(${JSON.stringify(`${cli}.bind`)}, process.argv.slice(2).join(' ') + '\\n'); out('已保存'); }
  else out({ok: true, conversation: {connectorName: '只读项目连接器'}});
} else if (cmd === 'doctor') out({report: {oauth: {ok: true}, tunnel: {ok: true}}, chatgptRepair: {connectorName: '只读项目连接器'}});
else if (cmd === 'pair') out({ok: true, pairingCode: 'ABCD-1234', expiresAt: 1900000000000});
else if (cmd === 'unpair') out('已撤销');`);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root, bindingFile});
  const chatOnly = manager.chatStatus(sessionKey, workspace);
  assert.equal(chatOnly.workspace, fs.realpathSync(workspace));
  assert.equal(chatOnly.projectRequired, false);
  assert.equal(chatOnly.conversation.chatUrl, null);
  assert.equal(fs.existsSync(`${cli}.bind`), false);
  const status = await manager.status(sessionKey, workspace);
  assert.equal(status.bridge.running, true);
  assert.equal(status.bridge.publicReady, true);
  assert.equal(status.diagnostics.report.oauth.ok, true);
  assert.equal(status.conversation.connectorName, '只读项目连接器');
  const paired = await manager.pair(sessionKey, workspace);
  assert.equal(paired.pairing.pairingCode, 'ABCD-1234');
  assert.equal(paired.pairing.pairingExpiresAt, 1900000000000);
  await assert.rejects(() => manager.unpair(sessionKey, workspace), /缺少断开/);
  const revoked = await manager.unpair(sessionKey, workspace, 'UNPAIR_CURRENT_WEB_GPT');
  assert.equal(revoked.revoked.ok, true);
  await manager.bindConversation(sessionKey, workspace, 'https://chatgpt.com/c/real-visible-chat');
  assert.match(fs.readFileSync(`${cli}.bind`, 'utf8'), /--url https:\/\/chatgpt\.com\/c\/real-visible-chat/);
  assert.match(fs.readFileSync(`${cli}.bind`, 'utf8'), /--mode long-chat/);
  await assert.rejects(() => manager.bindConversation(sessionKey, workspace, 'https://example.com/c/fake'), /只能绑定/);
  await assert.rejects(() => manager.status(sessionKey, os.homedir()), /整个用户目录/);
  const other = path.join(root, 'other-project');
  fs.mkdirSync(other);
  await assert.rejects(() => manager.status(sessionKey, other), /只能读取当前会话/);
});

test('an unbound chat never falls back to Pinkie memory or an internal agent workspace', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-unbound-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({
    root,
    bindingFile: path.join(root, 'missing-bindings.json'),
  });
  const chatOnly = manager.chatStatus('agent:learning:unbound-session');
  assert.equal(chatOnly.projectRequired, true);
  assert.equal(chatOnly.workspace, '');
  const status = await manager.status('agent:learning:unbound-session');
  assert.equal(status.projectRequired, true);
  assert.equal(status.workspace, '');
  assert.equal(status.bridge.running, false);
  assert.doesNotMatch(JSON.stringify(status), /workspace-learning|memory|persona/);
  await manager.bindConversation('agent:learning:unbound-session', '', 'https://chatgpt.com/c/web-only');
  assert.equal(
    (await manager.status('agent:learning:unbound-session')).conversation.chatUrl,
    'https://chatgpt.com/c/web-only',
  );
  await assert.rejects(
    () => manager.start('agent:learning:unbound-session'),
    /不会读取碧琪记忆或内部工作区/,
  );
});

test('browser conversation state is isolated by Pinkie session even inside one project', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-session-state-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const bindingFile = path.join(root, 'bindings.json');
  const first = 'agent:project:session-first';
  const second = 'agent:project:session-second';
  fs.writeFileSync(bindingFile, JSON.stringify({
    [first]: {root: workspace, name: '同一项目'},
    [second]: {root: workspace, name: '同一项目'},
  }));
  const cli = path.join(root, 'pinkie-collab');
  fakeBridge(root, `if (cmd === 'status') out({ok: true, running: true, publicUrl: 'https://pinkie.example', tunnel: {running: true}});
else if (cmd === 'prefs' || cmd === 'doctor') out({ok: true});
else if (cmd === 'session') {
  if (sub === 'set') out('已保存');
  else out({ok: true, conversation: {chatUrl: 'https://chatgpt.com/c/legacy-shared-chat', connectorName: '只读项目连接器'}});
}`);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));

  const manager = new WebGptConnectionManager({root, bindingFile});
  // A workspace-wide legacy pointer is deliberately not reused by a different
  // Pinkie session, because that is how cross-chat logical state leaked.
  const before = await manager.status(second, workspace);
  assert.equal(before.conversation.chatUrl, null);
  assert.equal(before.conversation.reason, 'new-pinkie-session');

  await manager.bindConversation(first, workspace, 'https://chatgpt.com/c/first-chat');
  await manager.bindConversation(first, workspace, 'https://chatgpt.com/c/first-web-chat', 'web');
  await manager.bindConversation(second, workspace, 'https://chatgpt.com/c/second-chat');
  const firstState = await manager.status(first, workspace);
  const secondState = await manager.status(second, workspace);
  assert.equal(firstState.conversation.chatUrl, 'https://chatgpt.com/c/first-chat');
  assert.equal(firstState.conversation.projectChatUrl, 'https://chatgpt.com/c/first-chat');
  assert.equal(firstState.conversation.webChatUrl, 'https://chatgpt.com/c/first-web-chat');
  assert.equal(firstState.conversation.webChatSurface, 'chat');
  assert.equal(secondState.conversation.chatUrl, 'https://chatgpt.com/c/second-chat');
  assert.equal(firstState.conversation.sessionScoped, true);
  assert.equal(secondState.conversation.sessionScoped, true);

  await manager.clearConversation(first, workspace);
  assert.equal((await manager.status(first, workspace)).conversation.chatUrl, null);
  assert.equal((await manager.status(second, workspace)).conversation.chatUrl, 'https://chatgpt.com/c/second-chat');
});

test('old single-chat records remain project chats when web-only state is added', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-migrate-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const sessionKey = 'agent:project:legacy-chat';
  const bindingFile = path.join(root, 'bindings.json');
  fs.writeFileSync(bindingFile, JSON.stringify({[sessionKey]: {root: workspace}}));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root, bindingFile});
  manager.writeConversationBindings({
    [sessionKey]: {workspace, url: 'https://chatgpt.com/c/old-project-chat', connectorName: '旧连接器'},
  });
  const conversation = manager.conversationFor(sessionKey, workspace);
  assert.equal(conversation.projectChatUrl, 'https://chatgpt.com/c/old-project-chat');
  assert.equal(conversation.webChatUrl, null);
  assert.equal(conversation.webChatSurface, null);
  assert.equal(conversation.connectorName, '旧连接器');
});

test('old web URLs are not trusted as ChatGPT chat-mode conversations', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-surface-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root});
  const sessionKey = 'agent:learning:dashboard:old-work';
  manager.writeConversationBindings({
    [sessionKey]: {workspace: '', webChatUrl: 'https://chatgpt.com/c/old-work-conversation'},
  });
  const conversation = manager.conversationFor(sessionKey, '');
  assert.equal(conversation.webChatUrl, 'https://chatgpt.com/c/old-work-conversation');
  assert.equal(conversation.webChatSurface, null);
});

test('stale tunnel URLs are never reported as ready or accepted for pairing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-stale-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const bindingFile = path.join(root, 'bindings.json');
  const sessionKey = 'agent:project:stale-test';
  fs.writeFileSync(bindingFile, JSON.stringify({[sessionKey]: {root: workspace, name: '测试项目'}}));
  const cli = path.join(root, 'pinkie-collab');
  fakeBridge(root, `if (cmd === 'status') out({ok: true, running: true, publicUrl: 'https://stale.example', tunnel: {running: true, detail: 'Unauthorized: Tunnel not found'}});
else if (cmd === 'prefs' || cmd === 'session' || cmd === 'doctor') out({ok: true});
else if (cmd === 'pair') out({ok: true, pairingCode: 'MUST-NOT-RUN'});`);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root, bindingFile});
  const status = await manager.status(sessionKey, workspace);
  assert.equal(status.bridge.publicReady, false);
  await assert.rejects(() => manager.pair(sessionKey, workspace), /请先建立安全连接/);
});

test('a running tunnel with an unreachable public URL is not reported as connected', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-unreachable-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const bindingFile = path.join(root, 'bindings.json');
  const sessionKey = 'agent:project:unreachable-test';
  fs.writeFileSync(bindingFile, JSON.stringify({[sessionKey]: {root: workspace}}));
  const cli = path.join(root, 'pinkie-collab');
  fakeBridge(root, `if (cmd === 'status') out({ok: true, running: true, publicUrl: 'https://unreachable.example', tunnel: {running: true}});
else if (cmd === 'doctor') out({report: {tunnel: {ok: false, detail: '公网地址无法访问'}}});
else if (cmd === 'prefs' || cmd === 'session') out({ok: true});
else if (cmd === 'pair') out({ok: true, pairingCode: 'MUST-NOT-RUN'});`);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root, bindingFile});
  const status = await manager.status(sessionKey, workspace);
  assert.equal(status.bridge.publicReady, false);
  await assert.rejects(() => manager.pair(sessionKey, workspace), /请先建立安全连接/);
});

test('transient quick-tunnel timeout is retried once and then reports the live public URL', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-retry-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const bindingFile = path.join(root, 'bindings.json');
  const sessionKey = 'agent:project:retry-test';
  fs.writeFileSync(bindingFile, JSON.stringify({[sessionKey]: {root: workspace, name: '测试项目'}}));
  const cli = path.join(root, 'pinkie-collab');
  fakeBridge(root, `const counter = ${JSON.stringify(`${cli}.counter`)};
if (!fs.existsSync(counter)) fs.writeFileSync(counter, '0');
let count = Number(fs.readFileSync(counter, 'utf8'));
if (cmd === 'start') {
  count += 1; fs.writeFileSync(counter, String(count));
  if (count === 1) { console.error(JSON.stringify({error: 'Tunnel start timed out'})); process.exit(1); }
  out({ok: true, mcpUrl: 'https://pinkie.example/mcp'});
} else if (cmd === 'status') out(count >= 2
  ? {ok: true, running: true, publicUrl: 'https://pinkie.example', tunnel: {running: true}, tokenCount: 0}
  : {ok: true, running: true, publicUrl: null, tunnel: {running: false}, tokenCount: 0});
else if (cmd === 'prefs' || cmd === 'session') out({ok: true});
else if (cmd === 'doctor') out({report: {oauth: {ok: true}}});`);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root, bindingFile});
  const result = await manager.start(sessionKey, workspace);
  assert.equal(result.bridge.publicUrl, 'https://pinkie.example');
  assert.equal(fs.readFileSync(`${cli}.counter`, 'utf8'), '2');
});
