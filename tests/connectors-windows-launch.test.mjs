import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {registerRichRuntime, resolveConnectorLaunch} from '../services/mode-architecture/rich-runtime.mjs';

const base = 'C:\\Program Files\\nodejs';
const node = path.win32.join(base, 'node.exe');
const cli = path.win32.join(base, 'node_modules', 'npm', 'bin', 'npx-cli.js');
const files = new Set([node, cli, path.win32.join(base, 'npx.cmd')]);
const windows = {platform: 'win32', env: {PATH: `C:\\Windows;"${base}"`}, exists: value => files.has(value)};

test('Windows starts npx through Node without a shell and keeps the original arguments', () => {
  const original = {command: 'npx', args: ['-y', '@example/server', 'D:\\资料 文件']};
  assert.deepEqual(resolveConnectorLaunch(original, windows), {command: node, args: [cli, ...original.args]});
  assert.equal(resolveConnectorLaunch(original, {platform: 'darwin'}), original);
  assert.throws(() => resolveConnectorLaunch(original, {...windows, exists: () => false}), /没有找到 Node\.js/);
});

test('saving an unavailable Windows npx connector does not change the configuration', async () => {
  const methods = new Map();
  const state = {mcp: {servers: {}}};
  let saved = 0, savedDraft, nodeAvailable = false;
  const api = {registerGatewayMethod: (name, fn) => methods.set(name, fn), registerTool() {}, on() {}, registerHttpRoute() {},
    runtime: {state: {resolveStateDir: () => os.tmpdir()}, config: {current: () => state,
      async mutateConfigFile({mutate}) { const draft = structuredClone(state); mutate(draft); savedDraft = draft; saved++; return {}; }}}};
  registerRichRuntime(api, {store: {}, stateDir: os.tmpdir(), connectorLaunchOptions: {...windows, exists: value => nodeAvailable && files.has(value)}});
  const result = await new Promise(resolve => methods.get('pinkie.connectors.save')({params: {name: 'files', config: {command: 'npx', args: ['-y', 'pkg']}}, respond: (ok, value, error) => resolve({ok, value, error})}));
  assert.equal(result.ok, false);
  assert.match(result.error.message, /没有找到 Node\.js/);
  assert.equal(saved, 0);
  nodeAvailable = true;
  const accepted = await new Promise(resolve => methods.get('pinkie.connectors.save')({params: {name: 'files', config: {command: 'npx', args: ['-y', 'pkg']}}, respond: (ok, value, error) => resolve({ok, value, error})}));
  assert.equal(accepted.ok, true);
  assert.equal(savedDraft.mcp.servers.files.command, node);
  assert.deepEqual(savedDraft.mcp.servers.files.args, [cli, '-y', 'pkg']);
});
