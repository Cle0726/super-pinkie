// D1 连接器：新接的先由运行时 `openclaw mcp add` 连一次，连不上就不写配置；
// Windows 上 npx 换成 node.exe + npx-cli.js（运行时 shell:false 起不了 .cmd）。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {CONNECTOR_CATALOG, friendlyProbeError, mcpAddArgs, registerRichRuntime, resolveLaunch} from '../services/mode-architecture/rich-runtime.mjs';

function fakeApi(servers = {}) {
  const methods = new Map();
  const writes = [];
  const cfg = {mcp: {servers}};
  const api = {
    registerGatewayMethod: (name, fn) => methods.set(name, fn),
    registerTool() {}, on() {}, registerHttpRoute() {},
    runtime: {
      state: {resolveStateDir: () => os.tmpdir()},
      config: {
        current: () => cfg,
        async mutateConfigFile({mutate}) { const draft = structuredClone(cfg); await mutate(draft); writes.push(draft); return {}; },
      },
    },
  };
  const call = (name, params) => new Promise(resolve => methods.get(name)({params, respond: (ok, value, error) => resolve({ok, value, error})}));
  return {api, call, writes};
}

test('Windows: npx 换成同一个 Node 安装里的 node.exe + npx-cli.js', () => {
  const base = 'C:\\Program Files\\nodejs';
  const have = new Set([path.win32.join(base, 'npx.cmd'), path.win32.join(base, 'node.exe'),path.win32.join(base, 'node_modules', 'npm', 'bin', 'npx-cli.js')]);
  const out = resolveLaunch({command: 'npx', args: ['-y', 'pkg', 'D:\\资料']}, {platform: 'win32', env: {PATH: `C:\\Windows;${base}`}, exists: p => have.has(p)});
  assert.equal(out.command, path.win32.join(base, 'node.exe'));
  assert.deepEqual(out.args, [path.win32.join(base, 'node_modules', 'npm', 'bin', 'npx-cli.js'), '-y', 'pkg', 'D:\\资料']);
  assert.throws(() => resolveLaunch({command: 'npx', args: []}, {platform: 'win32', env: {PATH: 'C:\\Windows'}, exists: () => false}), /还没装 Node\.js/);
  const mac = {command: 'npx', args: ['-y', 'pkg']};
  assert.equal(resolveLaunch(mac, {platform: 'darwin'}), mac);
  const remote = {url: 'https://x.example/mcp'};
  assert.equal(resolveLaunch(remote, {platform: 'win32'}), remote);
});

test('mcp add 的参数：以 - 开头的值写成 --arg=-y，不会被当成选项', () => {
  const args = mcpAddArgs('amap', {command: 'node.exe', args: ['cli.js', '-y', '@amap/amap-maps-mcp-server'], env: {AMAP_MAPS_API_KEY: 'k123456'},
    toolFilter: {include: ['read_file', 'list_directory']}});
  assert.deepEqual(args, ['add', 'amap', '--command=node.exe', '--arg=cli.js', '--arg=-y', '--arg=@amap/amap-maps-mcp-server',
    '--env=AMAP_MAPS_API_KEY=k123456', '--include=read_file,list_directory']);
  assert.deepEqual(mcpAddArgs('gh', {url: 'https://api.example/mcp/', transport: 'streamable-http', headers: {Authorization: 'Bearer t'}}),
    ['add', 'gh', '--url=https://api.example/mcp/', '--transport=streamable-http', '--header=Authorization=Bearer t']);
});

test('连不上的原因说成一句中文，去掉配置文件路径', () => {
  const msg = friendlyProbeError('MCP probe failed for "bad" in C:\\Users\\x\\.openclaw\\openclaw.json: spawn not-a-real-cmd ENOENT');
  assert.match(msg, /找不到启动命令「not-a-real-cmd」/);
  assert.match(msg, /配置没有改动/);
  assert.doesNotMatch(msg, /openclaw\.json/);
});

test('填错的命令：运行时连不上 → 不写配置，返回原因，密钥被抹掉', async () => {
  const calls = [];
  const runner = async (args) => { calls.push(args); const e = new Error('Command failed'); e.stderr = 'MCP probe failed for "files" in /h/.openclaw/openclaw.json: spawn nope ENOENT secret-value-1'; throw e; };
  const {api, call, writes} = fakeApi();
  registerRichRuntime(api, {store: {}, runner, stateDir: os.tmpdir()});
  const result = await call('pinkie.connectors.save', {name: 'files', config: {command: 'nope', args: ['x'], env: {K: 'secret-value-1'}}});
  assert.equal(result.ok, false);
  assert.match(result.error.message, /找不到启动命令「nope」/);
  assert.doesNotMatch(result.error.message, /secret-value-1/);
  assert.equal(writes.length, 0, '连不上就不写');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'add');
});

test('连上了：由运行时 mcp add 写入；网页登录授权的（Notion）不先连，照旧经运行时校验写入', async () => {
  const calls = [];
  const {api, call, writes} = fakeApi();
  registerRichRuntime(api, {store: {}, runner: async (args) => { calls.push(args); return {stdout: 'Saved MCP server', stderr: ''}; }, stateDir: os.tmpdir()});
  const ok = await call('pinkie.connectors.save', {name: 'service', config: {url: 'https://mcp.example.com/mcp'}});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.probed, true);
  assert.equal(writes.length, 0, '写配置的是运行时 CLI，插件自己不再写一遍');
  const notion = CONNECTOR_CATALOG.find(c => c.id === 'notion');
  const oauth = await call('pinkie.connectors.save', {name: 'notion', config: notion.config});
  assert.equal(oauth.ok, true);
  assert.equal(calls.length, 1, 'Notion 没有先连');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].mcp.servers.notion.auth, 'oauth');
});

test('同名的不覆盖；预置清单里有高德地图，Key 走 env 不进网址', async () => {
  const {api, call} = fakeApi({files: {command: 'npx'}});
  registerRichRuntime(api, {store: {}, runner: async () => ({stdout: ''}), stateDir: os.tmpdir()});
  const dup = await call('pinkie.connectors.save', {name: 'files', config: {command: 'npx'}});
  assert.equal(dup.ok, false);
  assert.match(dup.error.message, /同名/);
  const amap = CONNECTOR_CATALOG.find(c => c.id === 'amap');
  assert.equal(amap.credential, 'env');
  assert.equal(amap.envKey, 'AMAP_MAPS_API_KEY');
  assert.equal(amap.config.url, undefined);
});
