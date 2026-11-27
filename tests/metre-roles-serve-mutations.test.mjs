// B58：只读角色（卡里没有 write）用 app_browser serve 带 command 起命令时，命令改的文件也要进 roleMutations；
// serve 只带 dir（静态目录）和别的 action 不记。走 index.mjs 真实的 before/after_tool_call 钩子。
//
// 隔离：所有目录都在 os.tmpdir() 下的临时目录；网关命令行是一个假的 openclaw.mjs。不联网、不起网关、不真的起 serve。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-b58-serve-'));
for (const dir of ['claude', 'codex', 'state', 'openclaw', 'runtime', 'library', 'materials']) {
  fs.mkdirSync(path.join(scratch, dir), {recursive: true});
}
fs.writeFileSync(path.join(scratch, 'openclaw', 'openclaw.json'), '{}\n');
const fakeCli = path.join(scratch, 'runtime', 'openclaw.mjs');
fs.writeFileSync(fakeCli, "process.stdout.write('{}');\n");

process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.CLAUDE_CONFIG_DIR = path.join(scratch, 'claude');
process.env.CODEX_HOME = path.join(scratch, 'codex');
process.env.PINKIE_STATE_ROOT = path.join(scratch, 'state');
process.env.PINKIE_LIBRARY_ROOT = path.join(scratch, 'library');
process.env.PINKIE_MATERIALS_ROOT = path.join(scratch, 'materials');
process.env.OPENCLAW_STATE_DIR = path.join(scratch, 'openclaw');
process.env.OPENCLAW_CONFIG_PATH = path.join(scratch, 'openclaw', 'openclaw.json');
process.env.PINKIE_OPENCLAW_ENTRY = fakeCli;
delete process.env.OPENCLAW_GATEWAY_URL;
delete process.env.PINKIE_OPENCLAW_RUNTIME;
delete process.env.OPENCLAW_SERVICE_KIND;
delete process.env.OPENCLAW_PROFILE;

const {default: plugin} = await import('../services/mode-architecture/index.mjs');

const hooks = new Map();
plugin.register({
  on: (name, fn, opts = {}) => {
    const list = hooks.get(name) || [];
    list.push({fn, priority: Number(opts?.priority) || 0});
    hooks.set(name, list);
  },
  registerGatewayMethod: () => {},
  registerTool: () => {},
  registerHttpRoute: () => ({}),
  logger: {info() {}, warn() {}, error() {}},
  runtime: {
    state: {resolveStateDir: () => process.env.PINKIE_STATE_ROOT},
    config: {current: () => ({gateway: {mode: 'local', bind: 'loopback', auth: {mode: 'none'}}})},
  },
  session: {workflow: {
    enqueueNextTurnInjection: async () => ({enqueued: true}),
    unscheduleSessionTurnsByTag: async () => ({removed: 0}),
  }},
});
for (const list of hooks.values()) list.sort((a, b) => b.priority - a.priority);

const mutations = globalThis[Symbol.for('pinkie.metre-roles.mutations.v1')];
const snapshotsFile = path.join(process.env.PINKIE_STATE_ROOT, 'sessions', 'session-role-snapshots.json');

after(() => {
  const bg = globalThis[Symbol.for('pinkie.backgroundJobs.v1')];
  if (bg?.timer) { clearInterval(bg.timer); bg.timer = null; }
  try {
    fs.rmSync(scratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
});

// 只读角色卡快照：能 read / exec / browser，不能 write。
function readOnlyRoleSession(name) {
  const key = `agent:roles:b58-${name}`;
  const all = fs.existsSync(snapshotsFile) ? JSON.parse(fs.readFileSync(snapshotsFile, 'utf8')) : {};
  all[key] = {
    id: 'b58-reviewer', name: 'B58 只读审查', tools: ['read', 'exec', 'browser'], deny_commands: [],
    reads: [], readsResolved: [], skills: [], skillsResolved: [], source: 'official', body: '', reportSections: [],
  };
  fs.mkdirSync(path.dirname(snapshotsFile), {recursive: true});
  fs.writeFileSync(snapshotsFile, JSON.stringify(all, null, 2) + '\n');
  const cwd = fs.mkdtempSync(path.join(scratch, `cwd-${name}-`));
  const workspaceDir = fs.mkdtempSync(path.join(scratch, `ws-${name}-`));
  return {key, cwd, ctx: {sessionKey: key, agentId: 'roles', workspaceDir}};
}

// 宿主语义：先跑全部 before_tool_call（任何一个拦截都算失败），工具「执行」，再跑全部 after_tool_call。
async function callTool(ctx, toolCallId, params, sideEffect) {
  const event = {toolName: 'app_browser', toolCallId, params};
  for (const {fn} of hooks.get('before_tool_call') || []) {
    const out = await fn(event, ctx);
    assert.ok(!out?.block, `before_tool_call 不该拦：${out?.blockReason || ''}`);
  }
  sideEffect();
  for (const {fn} of hooks.get('after_tool_call') || []) await fn({...event, result: {ok: true}}, ctx);
}

test('serve 带 command：命令在 cwd 里改的文件记进 roleMutations', async () => {
  const {key, cwd, ctx} = readOnlyRoleSession('command');
  await callTool(ctx, 'serve-1', {action: 'serve', command: 'npm run dev', cwd, port: 5173},
    () => fs.writeFileSync(path.join(cwd, 'sneaky.txt'), 'x'));
  assert.deepEqual(mutations.list(key), ['sneaky.txt']);
});

test('serve 只带 dir（静态目录，没有 command）：不记', async () => {
  const {key, cwd, ctx} = readOnlyRoleSession('dir');
  await callTool(ctx, 'serve-2', {action: 'serve', dir: cwd, cwd},
    () => fs.writeFileSync(path.join(cwd, 'static.txt'), 'x'));
  assert.deepEqual(mutations.list(key), []);
});

test('app_browser 其他 action（open）：即使带 command 字段也不记', async () => {
  const {key, cwd, ctx} = readOnlyRoleSession('open');
  await callTool(ctx, 'open-1', {action: 'open', url: 'http://127.0.0.1:5173/', command: 'npm run dev', cwd},
    () => fs.writeFileSync(path.join(cwd, 'open.txt'), 'x'));
  assert.deepEqual(mutations.list(key), []);
});
