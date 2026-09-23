import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WebGptConnectionManager} from '../services/mode-architecture/web-gpt-connection.mjs';

test('connection status is read-only, workspace-scoped and keeps destructive actions confirmed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-connection-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const bindingFile = path.join(root, 'bindings.json');
  const sessionKey = 'agent:project:connection-test';
  fs.writeFileSync(bindingFile, JSON.stringify({[sessionKey]: {root: workspace, name: '测试项目'}}));
  const cli = path.join(root, 'pinkie-collab');
  fs.writeFileSync(cli, `#!/bin/sh
case "$1" in
  status) printf '%s\\n' '{"ok":true,"running":true,"publicUrl":"https://pinkie.example","tunnel":{"running":true}}' ;;
  prefs) printf '%s\\n' '{"ok":true,"developerModeEnabled":true}' ;;
  session)
    if [ "$2" = "set" ]; then printf '%s\\n' "$*" > "$0.bind"; printf '%s\\n' '已保存';
    else printf '%s\\n' '{"ok":true,"conversation":{"connectorName":"只读项目连接器"}}'; fi ;;
  doctor) printf '%s\\n' '{"report":{"oauth":{"ok":true},"tunnel":{"ok":true}},"chatgptRepair":{"connectorName":"只读项目连接器"}}' ;;
  pair) printf '%s\\n' '{"ok":true,"pairingCode":"ABCD-1234","expiresAt":1900000000000}' ;;
  unpair) printf '%s\\n' '已撤销' ;;
esac
`, {mode: 0o700});
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root, bindingFile});
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
  const status = await manager.status('agent:learning:unbound-session');
  assert.equal(status.projectRequired, true);
  assert.equal(status.workspace, '');
  assert.equal(status.bridge.running, false);
  assert.doesNotMatch(JSON.stringify(status), /workspace-learning|memory|persona/);
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
  fs.writeFileSync(cli, `#!/bin/sh
case "$1" in
  status) printf '%s\\n' '{"ok":true,"running":true,"publicUrl":"https://pinkie.example","tunnel":{"running":true}}' ;;
  prefs|doctor) printf '%s\\n' '{"ok":true}' ;;
  session)
    if [ "$2" = "set" ]; then printf '%s\\n' '已保存';
    else printf '%s\\n' '{"ok":true,"conversation":{"chatUrl":"https://chatgpt.com/c/legacy-shared-chat","connectorName":"只读项目连接器"}}'; fi ;;
esac
`, {mode: 0o700});
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));

  const manager = new WebGptConnectionManager({root, bindingFile});
  // A workspace-wide legacy pointer is deliberately not reused by a different
  // Pinkie session, because that is how cross-chat logical state leaked.
  const before = await manager.status(second, workspace);
  assert.equal(before.conversation.chatUrl, null);
  assert.equal(before.conversation.reason, 'new-pinkie-session');

  await manager.bindConversation(first, workspace, 'https://chatgpt.com/c/first-chat');
  await manager.bindConversation(second, workspace, 'https://chatgpt.com/c/second-chat');
  const firstState = await manager.status(first, workspace);
  const secondState = await manager.status(second, workspace);
  assert.equal(firstState.conversation.chatUrl, 'https://chatgpt.com/c/first-chat');
  assert.equal(secondState.conversation.chatUrl, 'https://chatgpt.com/c/second-chat');
  assert.equal(firstState.conversation.sessionScoped, true);
  assert.equal(secondState.conversation.sessionScoped, true);

  await manager.clearConversation(first, workspace);
  assert.equal((await manager.status(first, workspace)).conversation.chatUrl, null);
  assert.equal((await manager.status(second, workspace)).conversation.chatUrl, 'https://chatgpt.com/c/second-chat');
});

test('stale tunnel URLs are never reported as ready or accepted for pairing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-web-gpt-stale-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace);
  const bindingFile = path.join(root, 'bindings.json');
  const sessionKey = 'agent:project:stale-test';
  fs.writeFileSync(bindingFile, JSON.stringify({[sessionKey]: {root: workspace, name: '测试项目'}}));
  const cli = path.join(root, 'pinkie-collab');
  fs.writeFileSync(cli, `#!/bin/sh
case "$1" in
  status) printf '%s\\n' '{"ok":true,"running":true,"publicUrl":"https://stale.example","tunnel":{"running":true,"detail":"Unauthorized: Tunnel not found"}}' ;;
  prefs|session|doctor) printf '%s\\n' '{"ok":true}' ;;
  pair) printf '%s\\n' '{"ok":true,"pairingCode":"MUST-NOT-RUN"}' ;;
esac
`, {mode: 0o700});
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
  fs.writeFileSync(cli, `#!/bin/sh
counter="$0.counter"
[ -f "$counter" ] || printf '0' > "$counter"
count=$(cat "$counter")
case "$1" in
  start)
    count=$((count + 1)); printf '%s' "$count" > "$counter"
    if [ "$count" -eq 1 ]; then printf '%s\\n' '{"error":"Tunnel start timed out"}' >&2; exit 1; fi
    printf '%s\\n' '{"ok":true,"mcpUrl":"https://pinkie.example/mcp"}' ;;
  status)
    if [ "$count" -ge 2 ]; then printf '%s\\n' '{"ok":true,"running":true,"publicUrl":"https://pinkie.example","tunnel":{"running":true},"tokenCount":0}'
    else printf '%s\\n' '{"ok":true,"running":true,"publicUrl":null,"tunnel":{"running":false},"tokenCount":0}'; fi ;;
  prefs) printf '%s\\n' '{"ok":true}' ;;
  session) printf '%s\\n' '{"ok":true}' ;;
  doctor) printf '%s\\n' '{"report":{"oauth":{"ok":true}}}' ;;
esac
`, {mode: 0o700});
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manager = new WebGptConnectionManager({root, bindingFile});
  const result = await manager.start(sessionKey, workspace);
  assert.equal(result.bridge.publicUrl, 'https://pinkie.example');
  assert.equal(fs.readFileSync(`${cli}.counter`, 'utf8'), '2');
});
