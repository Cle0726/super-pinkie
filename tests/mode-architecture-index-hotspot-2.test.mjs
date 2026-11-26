// services/mode-architecture/index.mjs 热点复发锁（第二批）。
// #167 的 tests/mode-architecture-index-hotspot.test.mjs 已锁 7f271ad9（deep-think 幂等键带档位）
// 和 a2514d6e（改写不带硬编码 apiKey）；这里接着锁其余还留在 index.mjs、
// 但现有测试在「只回退该修复」时不会变红的接线。
//
// 隔离：所有目录都在 os.tmpdir() 下的临时目录；网关命令行是一个假的 openclaw.mjs，
// 网关 SDK 是一个假的 gateway-runtime.js，都只记录调用。不联网、不起网关、不调上游模型。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-hotspot-index-2-'));
for (const dir of ['claude', 'codex', 'state', 'openclaw', path.join('runtime', 'dist', 'plugin-sdk')]) {
  fs.mkdirSync(path.join(scratch, dir), {recursive: true});
}
fs.writeFileSync(path.join(scratch, 'openclaw', 'openclaw.json'), '{}\n');
// 假网关命令行：模拟老安装里只读配对的 CLI，chat.send 被「scope upgrade」拒掉、非零退出。
const fakeCli = path.join(scratch, 'runtime', 'openclaw.mjs');
fs.writeFileSync(fakeCli, [
  "import fs from 'node:fs';",
  "fs.appendFileSync(process.env.PINKIE_HOTSPOT_CLI_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
  "process.stdout.write('gateway error: scope upgrade pending approval');",
  'process.exit(1);',
].join('\n') + '\n');
// 假网关 SDK（CommonJS 写法，import() 能识别命名导出）：本机托管网关的后端通道，只记录。
fs.writeFileSync(path.join(scratch, 'runtime', 'dist', 'plugin-sdk', 'gateway-runtime.js'), [
  'exports.callGatewayFromCli = async (method, opts, params, extra) => {',
  '  (globalThis[Symbol.for("pinkie.hotspot2.rpc")] ||= []).push({method, params, extra});',
  '  return {ok: true, status: "started"};',
  '};',
].join('\n') + '\n');

const cliLog = path.join(scratch, 'cli.log');
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.CLAUDE_CONFIG_DIR = path.join(scratch, 'claude');
process.env.CODEX_HOME = path.join(scratch, 'codex');
process.env.PINKIE_STATE_ROOT = path.join(scratch, 'state');
process.env.OPENCLAW_STATE_DIR = path.join(scratch, 'openclaw');
process.env.OPENCLAW_CONFIG_PATH = path.join(scratch, 'openclaw', 'openclaw.json');
process.env.PINKIE_OPENCLAW_ENTRY = fakeCli;
process.env.PINKIE_HOTSPOT_CLI_LOG = cliLog;
// 托管的本机网关（loopback、无鉴权）才允许走后端通道重试。
process.env.PINKIE_MANAGED_GATEWAY = '1';
delete process.env.OPENCLAW_GATEWAY_URL;
delete process.env.PINKIE_OPENCLAW_RUNTIME;
delete process.env.OPENCLAW_SERVICE_KIND;
delete process.env.OPENCLAW_PROFILE;

const {default: plugin} = await import('../services/mode-architecture/index.mjs');
const {waitNudge} = await import('../services/mode-architecture/background-jobs.mjs');

const BG = Symbol.for('pinkie.backgroundJobs.v1');
const RPC = Symbol.for('pinkie.hotspot2.rpc');

function registerPlugin() {
  const hooks = new Map();
  const tools = new Map();
  plugin.register({
    on: (name, fn, opts = {}) => {
      const list = hooks.get(name) || [];
      list.push({fn, priority: Number(opts?.priority) || 0});
      hooks.set(name, list);
    },
    registerGatewayMethod: () => {},
    registerTool: (factory, opts) => { if (opts?.name) tools.set(opts.name, factory); },
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
  return {hooks, tools};
}

const {hooks, tools} = registerPlugin();
const shared = globalThis[BG];

// 按优先级依次跑同名钩子，返回第一个非空结果（宿主的拦截 / 改写语义）。
async function firstResult(name, event, ctx) {
  for (const {fn} of hooks.get(name) || []) {
    const out = await fn(event, ctx);
    if (out) return out;
  }
  return undefined;
}

function finishedJob(sessionKey, id) {
  return {
    id, sessionKey, agentId: sessionKey.split(':')[1], execId: `exec-${id}`, pid: 0,
    command: 'npm run build', state: 'done', startedAt: Date.now() - 60_000, endedAt: Date.now() - 1000,
    seenByAgent: false, woke: false,
  };
}

function resetBackground() {
  for (const id of [...shared.jobs.keys()]) shared.jobs.delete(id);
  if (shared.timer) { clearInterval(shared.timer); shared.timer = null; }
  shared.waitStreak?.clear?.();
  shared.idleSinceStart?.clear?.();
  globalThis[RPC] = [];
  fs.rmSync(cliLog, {force: true});
}

after(() => {
  resetBackground();
  // Windows 上 scratch 里的文件句柄可能要等进程退出才释放，直接 rmSync 会报 EPERM（CI windows-checks 实测）。
  // 先用 Node 自带的重试再删；仍删不掉时只在 Windows 上留下这个临时目录，不算测试失败。
  try {
    fs.rmSync(scratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
});

test('前提：插件注册出了后台命令守望，网关入口是假的 openclaw.mjs', () => {
  assert.ok(shared?.owner, 'BackgroundJobs 已在 register() 里创建');
  assert.equal(shared.owner.cliEntry, fakeCli);
  assert.ok(hooks.has('subagent_spawned') && hooks.has('tool_result_persist'));
});

test('b4b39b3c：Metre 等子会话回报时，后台命令跑完马上叫醒；别的模式仍等子任务收齐', async () => {
  // 修复前 isBusy 对所有会话都是 parentRunning || pending>0：Metre 派出子会话后
  // 一直「忙」，后台命令跑完也不叫醒（11-22 实测 01:14 跑完，到 01:28 用户自己问才动）。
  resetBackground();
  const metre = 'agent:metre:hotspot-bg';
  const project = 'agent:project:hotspot-bg';
  for (const parent of [metre, project]) {
    await firstResult('subagent_spawned', {childSessionKey: `${parent}:subagent:child-1`, label: 'worker'}, {requesterSessionKey: parent});
  }
  // 两个父会话都挂着一个没回报的子会话。
  assert.equal(shared.owner.isBusy(metre), false, 'Metre 有子会话在跑也不算忙');
  assert.equal(shared.owner.isBusy(project), true, '项目模式有子会话在跑就算忙');

  shared.jobs.set('hs-metre', finishedJob(metre, 'hs-metre'));
  shared.jobs.set('hs-project', finishedJob(project, 'hs-project'));
  await shared.owner.tick();

  const sent = globalThis[RPC].filter(call => call.method === 'chat.send').map(call => call.params.sessionKey);
  assert.deepEqual(sent, [metre], '只叫醒 Metre，项目模式等子任务');
  assert.equal(shared.jobs.get('hs-metre').woke, true);
  assert.equal(shared.jobs.get('hs-project').woke, false);
  assert.ok(shared.jobs.get('hs-project').busySince > 0, '项目模式的叫醒在排队等空闲');
  resetBackground();
});

test('a4ffcb80：后台叫醒走 scope-upgrade 兜底，老安装的只读 CLI 配对不再挡住续跑', async () => {
  // 修复前 BackgroundJobs 拿的是裸 runProcess：CLI 的 chat.send 因「scope upgrade
  // pending approval」失败就算叫醒失败。修复后同一条消息、同一个幂等键改走本机后端通道。
  resetBackground();
  const sessionKey = 'agent:metre:hotspot-scope';
  shared.jobs.set('hs-scope', finishedJob(sessionKey, 'hs-scope'));
  await shared.owner.tick();

  const cliCalls = fs.readFileSync(cliLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(cliCalls.length, 1, '先试过一次命令行');
  assert.deepEqual(cliCalls[0].slice(0, 3), ['gateway', 'call', 'chat.send']);
  const cliParams = JSON.parse(cliCalls[0][cliCalls[0].indexOf('--params') + 1]);

  const rpc = globalThis[RPC].filter(call => call.method === 'chat.send');
  assert.equal(rpc.length, 1, '命令行被 scope upgrade 拒后改走后端通道');
  assert.equal(rpc[0].params.sessionKey, sessionKey);
  assert.equal(rpc[0].params.idempotencyKey, cliParams.idempotencyKey, '同一个幂等键，不会重复发');
  assert.equal(rpc[0].params.idempotencyKey, 'pinkie-bg-hs-scope');
  assert.equal(rpc[0].extra?.mode, 'backend');
  const job = shared.jobs.get('hs-scope');
  assert.equal(job.woke, true);
  assert.equal(job.wakeFailures, undefined, '叫醒一次就成功，没有进入重试');
  resetBackground();
});

test('a6ee7667 + 41b2e6f2：后台命令刚放下就去干等会被拦，拦下的等待清单存成「延后」而不是错误', async () => {
  // a6ee7667：before_tool_call 里接上 background.beforeTool，exec 转后台后紧接着 poll 直接拦下。
  // 41b2e6f2：拦下的是我们自己的等待提醒，tool_result_persist 把它改存成 deferred，
  // 不然记录里是一条 blocked 错误，模型以为工具坏了。
  resetBackground();
  const ctx = {agentId: 'project', sessionKey: 'agent:project:hotspot-wait', runId: 'hotspot-wait-run'};
  const command = 'python3 render_video.py';
  const started = {
    toolName: 'exec', toolCallId: 'hs-exec', runId: ctx.runId, params: {command},
    result: {content: [{type: 'text', text: `Command still running (session calm-reef, pid ${process.pid}). Use process (list/poll/log/write/send-keys/submit/paste/kill/clear/remove) for follow-up.`}], details: {status: 'running'}},
  };
  await firstResult('after_tool_call', started, ctx);
  const running = [...shared.jobs.values()].filter(job => job.sessionKey === ctx.sessionKey && job.state === 'running');
  assert.equal(running.length, 1, 'exec 转后台已登记');

  const poll = {toolName: 'process', toolCallId: 'hs-poll', runId: ctx.runId, params: {action: 'poll', sessionId: 'calm-reef'}};
  const blocked = await firstResult('before_tool_call', poll, ctx);
  assert.equal(blocked?.block, true, '紧接着的 poll 被拦下');
  assert.match(blocked.blockReason, /「python3 render_video\.py」.*还在后台跑，跑完系统会自动叫你/);

  const persisted = {
    role: 'toolResult', toolCallId: 'hs-poll', toolName: 'process', isError: true,
    content: [{type: 'text', text: blocked.blockReason}],
    details: {status: 'blocked', deniedReason: 'plugin-before-tool-call', reason: blocked.blockReason},
  };
  const softened = await firstResult('tool_result_persist', {toolName: 'process', message: persisted}, ctx);
  assert.equal(softened?.message?.isError, false);
  assert.equal(softened.message.details.status, 'deferred');
  assert.equal(softened.message.details.ok, true);
  assert.equal(softened.message.content[0].text, blocked.blockReason, '提醒原文保留');

  // 别人的拦截、工具循环拦截都不改：只认我们自己的等待提醒。
  const other = {...persisted, content: [{type: 'text', text: '工具被门禁拦下'}], details: {...persisted.details, reason: '工具被门禁拦下'}};
  assert.equal(await firstResult('tool_result_persist', {toolName: 'process', message: other}, ctx), undefined);
  const loop = {...persisted, details: {...persisted.details, deniedReason: 'tool-loop'}};
  assert.equal(await firstResult('tool_result_persist', {toolName: 'process', message: loop}, ctx), undefined);
  // 拦截文本就是 waitNudge 生成的那一句。
  assert.match(waitNudge([{command, startedAt: Date.now() - 5000}], []), /还在后台跑，跑完系统会自动叫你，不用再查。/);
  resetBackground();
});

test('af35303e：clekk_memory 工具说明教模型改写、合并旧记忆，而不是只会新增', () => {
  const factory = tools.get('clekk_memory');
  assert.equal(typeof factory, 'function');
  const tool = factory({agentId: 'project', sessionKey: 'agent:project:hotspot-memory'});
  assert.equal(tool?.name, 'clekk_memory');
  assert.match(tool.description, /remember 带 id 是改写那一条（改、并都用它），不带 id 是新存一条/);
  assert.match(tool.description, /forget 删掉过时、错了或已并掉的/);
  assert.match(tool.description, /存之前先 search 有没有同类的旧记录/);
  // 原有约束不丢。
  assert.match(tool.description, /remember\/forget 只能由主会话执行；子代理仅可 search\/list/);
});

test('3cc035bd：写进聊天记录前先删掉漏进正文的内部自检（不走 work-first 清洗的会话也一样）', async () => {
  // reply-hygiene.test.mjs 只测清洗函数；这里锁 before_message_write 真的调用了它。
  // main/project/thinking/learning/metre 的主会话另有 workFirstReplyText 顺带清洗，
  // 只有 sanitizeAssistantMessage 管得到的是挥洒模式（unrestricted）和子代理会话，所以两类都测。
  const leaked = '先生答对啦！\n\n执行【出题自检门禁】：\n- 题干中是否包含挖空答案原词？否。\n- 只有纯净裸题，等待先生作答！### 📝 2024.12 真题 · 第 34 题\n\n**34. ____ a college student, he works hard.**';
  for (const ctx of [
    {agentId: 'unrestricted', sessionKey: 'agent:unrestricted:hotspot-hygiene', runId: 'hotspot-hygiene-free'},
    {agentId: 'project', sessionKey: 'agent:project:hotspot-hygiene:subagent:helper', runId: 'hotspot-hygiene-child'},
    {agentId: 'learning', sessionKey: 'agent:learning:hotspot-hygiene', runId: 'hotspot-hygiene-run'},
  ]) for (const content of [leaked, [{type: 'text', text: leaked}]]) {
    const message = {role: 'assistant', content};
    const out = await firstResult('before_message_write', {message}, ctx);
    assert.ok(out?.message, '清洗后的消息被写回');
    assert.notEqual(out.block, true);
    const text = typeof out.message.content === 'string' ? out.message.content : out.message.content.map(part => part.text).join('');
    assert.doesNotMatch(text, /门禁|挖空答案原词/);
    assert.match(text, /^先生答对啦！/);
    assert.match(text, /### 📝 2024\.12 真题 · 第 34 题/);
    assert.equal(typeof content === 'string' ? content : content[0].text, leaked, '原消息对象不被就地修改');
  }
});
