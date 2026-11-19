// 批 5 · Metre 总控台的数据（PLAN 2.12，BOARD-HANDOFF.md，ACCEPTANCE A5-*）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MetreBoard, RAW_LIMIT, changeOf, describeTool, registerMetreBoard} from '../services/mode-architecture/metre-board.mjs';

const PARENT = 'agent:metre:main-1';
const A = 'agent:project:pinkie-child:aaaa';
const B = 'agent:learning:pinkie-child:bbbb';
const OTHER = 'agent:project:solo';

function setup(t, metreRoleCatalog = () => null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-board-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = 1_000_000;
  const lineageRecords = {
    [A]: {parentKey: PARENT, title: '页面骨架', mode: 'project', model: 'mm/glm-5', createdAt: clock, started: true, initiation: 'in_scope'},
    [B]: {parentKey: PARENT, title: '资料摘要', mode: 'learning', model: 'mm/kimi-k3', createdAt: clock, started: true, initiation: 'in_scope'},
  };
  const states = {[PARENT]: {cards: [], metreStarts: 2}, [A]: {}, [B]: {}};
  const busy = new Set();
  const sent = [];
  const lineage = {
    lineage: () => lineageRecords,
    state: key => states[key] || {},
    familyRows: async () => new Map([[PARENT, {key: PARENT, totalTokens: 12000, contextTokens: 200000}], [A, {key: A, totalTokens: 900}]]),
    busy: key => busy.has(key),
    metreLimits: () => ({maxRunning: 8, requestCap: 24}),
    turns: new Map(),
    setPaused: (key, paused) => { states[key].paused = paused; return {ok: true}; },
    access: {rpc: async (name, params) => { sent.push({name, params}); return {ok: true}; }},
  };
  const plans = {plan: key => key === PARENT ? {title: '做个页面', updatedAt: 1, items: [
    {id: '1', text: '拆活', status: 'completed'}, {id: '2', text: '派发', status: 'in_progress'}, {id: '3', text: '验收', status: 'pending'}]} : null};
  const modelHealth = {models: new Map([['mm/glm-5', {okAt: 5}], ['mm/kimi-k3', {okAt: 1, failAt: 9, reason: 'rate limit'}]]), sessions: new Map(), runs: new Map()};
  const hooks = {}, methods = new Map();
  const api = {on: (name, fn) => (hooks[name] ??= []).push(fn), registerGatewayMethod: (name, fn) => methods.set(name, fn)};
  const board = registerMetreBoard(api, {root, lineage, plans, modelHealth, metreRoleCatalog});
  board.now = () => clock;
  board.schedule = fn => { fn(); return null; };
  const fire = (name, event, ctx) => hooks[name].forEach(fn => fn(event, ctx));
  const rpc = async (name, params) => {
    let out;
    await methods.get(name)({params, respond: (ok, payload, error) => { out = ok ? payload : {ok: false, error}; }});
    return out;
  };
  return {root, board, fire, rpc, busy, states, sent, tick: ms => { clock += ms; }, lineageRecords};
}

test('只记 Metre 父会话和它的子会话；别的模式的会话不碰', t => {
  const {board, fire, root} = setup(t);
  fire('before_agent_run', {}, {sessionKey: OTHER});
  fire('after_tool_call', {toolName: 'write', params: {path: '/x/a.txt', content: 'a'}}, {sessionKey: OTHER});
  assert.equal(board.parentOf(OTHER), '');
  assert.equal(board.parentOf(A), PARENT);
  assert.equal(board.parentOf(PARENT), PARENT);
  assert.equal(fs.readdirSync(root).length, 0);
});

test('A5-1 区块内容和实际一致：派 2 块、1 块失败', async t => {
  const {fire, rpc, busy, states, tick} = setup(t);
  fire('message_received', {content: '帮我做个页面和一份摘要'}, {sessionKey: PARENT});
  fire('after_tool_call', {toolName: 'pinkie_session_start', params: {title: '页面骨架', mode: 'project', model: 'mm/glm-5'}}, {sessionKey: PARENT});
  fire('after_tool_call', {toolName: 'pinkie_session_start', params: {title: '资料摘要', mode: 'learning'}}, {sessionKey: PARENT});
  tick(1000);
  fire('before_agent_run', {}, {sessionKey: A}); busy.add(A);
  fire('before_agent_run', {}, {sessionKey: B}); busy.add(B);
  tick(2000);
  fire('after_tool_call', {toolName: 'write', params: {path: 'F:/p/index.html', content: 'a\nb\nc'}}, {sessionKey: A});
  fire('after_tool_call', {toolName: 'edit', params: {path: 'F:/p/index.html', old_string: 'a', new_string: 'a\nz'}}, {sessionKey: A});
  fire('llm_output', {usage: {input: 100, output: 20}}, {sessionKey: A});
  let view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(view.ok, true);
  assert.equal(view.overview.running, 2);
  assert.equal(view.overview.limit, 8);
  assert.equal(view.overview.started, 2);
  assert.equal(view.overview.cap, 24);
  assert.equal(view.sessions.find(s => s.key === A).doing, '改 index.html');
  assert.deepEqual(view.changes[0].files[0], {path: 'F:/p/index.html', added: 5, removed: 1});
  assert.deepEqual(view.plan.items.map(item => item.status), ['done', 'active', 'pending']);
  // A 交回，B 出错
  tick(3000);
  busy.delete(A); states[A] = {phase: 'done', at: 1_006_000};
  states[PARENT].cards.push({kind: 'report', childKey: A, text: '做好了', createdAt: 1_006_000});
  fire('agent_end', {success: true}, {sessionKey: A});
  busy.delete(B); states[B] = {phase: 'error', at: 1_006_000};
  fire('agent_end', {success: false, error: 'upstream 429 rate limit'}, {sessionKey: B});
  view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  const a = view.sessions.find(s => s.key === A), b = view.sessions.find(s => s.key === B);
  assert.equal(a.status, 'done');
  assert.equal(a.statusText, '已交回');
  assert.equal(b.status, 'failed');
  assert.match(b.error, /\S/);
  assert.equal(view.overview.returned, 1);
  assert.equal(view.overview.failed, 1);
  assert.equal(view.overview.running, 0);
  assert.equal(a.spans.length, 1);
  assert.equal(a.spans[0].kind, 'done');
  assert.equal(b.spans[0].kind, 'fail');
  assert.ok(a.usage.input === 100 && a.usage.output === 20);
  // 一轮跑完（end）和真交回汇报（report，来自汇报卡片）分开记；出错的那块记 error
  const kinds = view.timeline.map(item => item.kind);
  assert.ok(kinds.includes('end') && kinds.includes('report') && kinds.includes('error'), kinds.join(','));
  assert.ok(view.timeline.find(item => item.kind === 'report').text.includes('页面骨架'));
  assert.ok(view.timeline.some(item => item.kind === 'dispatch' && item.text.includes('页面骨架')));
  // 运行环境：用过的两个模型，一个健康一个不健康；上下文是 Metre 自己的
  assert.deepEqual(view.runtime.models.map(m => m.health).sort(), ['fail', 'ok']);
  assert.deepEqual(view.runtime.context, {used: 12000, max: 200000});
  assert.ok(view.runtime.errors.some(item => /429/.test(item.text)));
  assert.ok(view.raw.length >= 6);
});

test('A5-6 待你处理：ask_user 出现，用户在那个会话说话后消失；Metre 的提案卡片也算', async t => {
  const {fire, rpc, states} = setup(t);
  fire('after_tool_call', {toolName: 'ask_user', toolCallId: 'q1', params: {question: 'Baton 要不要中文名？'}}, {sessionKey: B});
  states[PARENT].cards.push({kind: 'proposal', id: 'p1', state: 'pending', title: '补说明', prompt: '写 README', createdAt: 5, expiresAt: Infinity});
  let view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(view.pending.length, 2);
  assert.match(view.overview.state, /等你/);
  fire('message_received', {content: '加中文'}, {sessionKey: B});
  view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.deepEqual(view.pending.map(item => item.kind), ['confirm']);
});

test('A5-4 暂停派发的状态从后端来（刷新后还在）；全停后显示已停，「接着做」给 Metre 发一句', async t => {
  const {rpc, states, sent} = setup(t);
  states[PARENT].paused = true; states[PARENT].pausedAt = 7;
  let view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(view.overview.paused, true);
  assert.equal(view.overview.state, '暂停派发');
  states[PARENT].paused = false;
  states[PARENT].lastStop = {at: 1_000_500, parent: true, children: [{key: A, stopped: true}]};
  view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(view.overview.state, '已停');
  assert.equal(view.overview.stopped, true);
  assert.equal(view.sessions.find(s => s.key === A).status, 'stopped');
  assert.ok(view.timeline.some(item => item.kind === 'stop'));
  const resumed = await rpc('pinkie.metre.resume', {sessionKey: PARENT});
  assert.equal(resumed.ok, true);
  assert.equal(sent.at(-1).name, 'chat.send');
  assert.equal(sent.at(-1).params.sessionKey, PARENT);
  assert.equal((await rpc('pinkie.metre.resume', {sessionKey: A})).ok, false);
});

test('不是 Metre 会话不给总控台；子会话的 key 换算到父会话', async t => {
  const {rpc} = setup(t);
  assert.equal((await rpc('pinkie.metre.board', {sessionKey: OTHER})).ok, false);
  assert.equal((await rpc('pinkie.metre.board', {sessionKey: A})).sessionKey, PARENT);
});

test('没派过活：每块都是空的实话，不是假数据', async t => {
  const {rpc, lineageRecords} = setup(t);
  for (const key of Object.keys(lineageRecords)) delete lineageRecords[key];
  const view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(view.overview.state, '还没派过活');
  assert.deepEqual(view.sessions, []);
  assert.deepEqual(view.changes, []);
});

test('原始记录最多 200 条，账本落盘后重开还在', t => {
  const {fire, root, board} = setup(t);
  for (let i = 0; i < RAW_LIMIT + 30; i++) fire('after_tool_call', {toolName: 'read', params: {path: 'a'}}, {sessionKey: A});
  assert.equal(board.journal(PARENT).raw.length, RAW_LIMIT);
  const again = new MetreBoard({root, lineage: board.lineage});
  assert.equal(again.journal(PARENT).raw.length, RAW_LIMIT);
});

test('改动行数和「在做什么」的说法', () => {
  assert.deepEqual(changeOf('write', {path: 'a', content: 'x\ny'}), {path: 'a', added: 2, removed: 0});
  assert.deepEqual(changeOf('edit', {file_path: 'a', old_string: 'x', new_string: 'y\nz'}), {path: 'a', added: 2, removed: 1});
  assert.equal(changeOf('read', {path: 'a'}), null);
  assert.equal(describeTool('exec', {command: 'npm test\nmore'}), '跑 npm test');
  assert.equal(describeTool('read', {path: 'C:\\a\\b.md'}), '读 b.md');
});

test('A5-2 前端只靠事件刷新：渲染文件没有轮询，已登记在页头', () => {
  const src = fs.readFileSync(new URL('../ui/injections/laolao-metre-board-data.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /setInterval|requestAnimationFrame/);
  assert.match(src, /pinkie:gateway-event/);
  assert.match(src, /1000 - \(Date\.now\(\) - lastAt\)/, '每秒最多一次');
  assert.match(src, /连接断了，正在重连/);
  const head = fs.readFileSync(new URL('../ui/injections/laolao-head.fragment.html', import.meta.url), 'utf8');
  assert.ok(head.indexOf('laolao-metre-board-data.js') > head.indexOf('laolao-metre-board.js'), '数据脚本排在骨架后面');
});
test('看门狗：每个子会话和 Metre 都带最后一次动静的时间，上游重试时它不动', async t => {
  const {fire, rpc, busy, tick} = setup(t);
  fire('before_agent_run', {}, {sessionKey: PARENT});
  fire('before_agent_run', {}, {sessionKey: A}); busy.add(A);
  const started = 1_000_000;
  tick(5000);
  fire('after_tool_call', {toolName: 'read', params: {path: 'F:/p/a.txt'}}, {sessionKey: A});
  let view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(view.sessions.find(s => s.key === A).lastActiveAt, started + 5000);
  assert.equal(view.overview.parentLastActiveAt, started);
  // 模型被 429 挡住、一直重试：没有工具调用、没有用量，时间就停在上一次。
  tick(120_000);
  view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  const a = view.sessions.find(s => s.key === A);
  assert.equal(a.status, 'running');
  assert.equal(view.at - a.lastActiveAt, 120_000);
  fire('llm_output', {usage: {input: 10, output: 2}}, {sessionKey: A});
  view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(view.sessions.find(s => s.key === A).lastActiveAt, view.at);
});

test('网关里有两个实例：一个记账、另一个读数，读数的那个也看得到最新的账', async t => {
  const {fire, board, root, busy} = setup(t);
  // 先让读数的实例把账读进缓存
  const reader = new MetreBoard({root, lineage: board.lineage, plans: board.plans, modelHealth: board.modelHealth, now: board.now, schedule: fn => { fn(); return null; }});
  fire('before_agent_run', {}, {sessionKey: PARENT});
  let view = await reader.board(PARENT);
  assert.equal(view.raw.length, 1);
  // 记账的实例接着记：子会话开跑、调工具
  await new Promise(r => setTimeout(r, 20));
  fire('before_agent_run', {}, {sessionKey: A}); busy.add(A);
  fire('after_tool_call', {toolName: 'write', params: {path: 'F:/p/a.txt', content: 'x'}}, {sessionKey: A});
  view = await reader.board(PARENT);
  assert.equal(view.raw.length, 3);
  assert.equal(view.sessions.find(s => s.key === A).spans.length, 1);
  assert.equal(view.changes.length, 1);
});

test('网关重启把正在跑的子会话打断：一轮开了头没收尾、又不在跑，算「中断了」，不算交回', async t => {
  const {fire, rpc, busy, tick} = setup(t);
  fire('before_agent_run', {}, {sessionKey: A}); busy.add(A);
  fire('before_agent_run', {}, {sessionKey: B}); busy.add(B);
  tick(3000);
  fire('agent_end', {success: true}, {sessionKey: B}); busy.delete(B);
  busy.delete(A);   // 网关被停：A 没有 agent_end
  const view = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  const a = view.sessions.find(s => s.key === A), b = view.sessions.find(s => s.key === B);
  assert.equal(a.status, 'interrupted');
  assert.equal(a.statusText, '中断了');
  assert.match(a.error, /没跑完就断了/);
  assert.equal(a.spans.at(-1).kind, 'fail');
  assert.equal(b.status, 'done');
  assert.equal(view.overview.failed, 1);
});

test('role name and source follow the dispatched snapshot; card diagnostics are independent of tasks', async t => {
  const catalogue = {
    roles: new Map([
      ['backend-fix', {id: 'backend-fix', name: '新改的名字', source: 'user'}],
      ['researcher', {id: 'researcher', name: '调研员', source: 'official'}],
    ]),
    invalid: [{file: '/private/user/broken.md', source: 'user', reason: '缺少 when'}],
  };
  const {rpc, lineageRecords, states} = setup(t, () => catalogue);
  const user = 'agent:roles:pinkie-child:cc';
  const official = 'agent:roles:pinkie-child:dd';
  const queued = 'agent:roles:pinkie-child:ee';
  lineageRecords[user] = {parentKey: PARENT, title: '修回调', metreRole: 'backend-fix',
    metreRoleName: '接口诊断', metreRoleSource: 'user', model: 'deepseek-v4-pro'};
  lineageRecords[official] = {parentKey: PARENT, metreRole: 'researcher', metreRoleSource: 'official'};
  states[PARENT].launches = {[queued]: {key: queued, metreRole: 'reviewer', metreRoleSource: 'official', metreRoleName: '验收员'}};
  states[PARENT].cards = [{kind: 'report', childKey: user, text: '验证通过', createdAt: 100}];

  let board = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  const roles = key => {
    const {role, roleName, roleSource} = board.sessions.find(row => row.key === key);
    return [role, roleName, roleSource];
  };
  assert.deepEqual(roles(A), ['', '', '']);
  assert.deepEqual(roles(user), ['backend-fix', '接口诊断', 'user']);
  assert.deepEqual(roles(official), ['researcher', '调研员', 'official']);
  assert.deepEqual(roles(queued), ['reviewer', '验收员', 'official']);
  assert.match(board.timeline.find(item => item.kind === 'report').text, /接口诊断/);
  assert.deepEqual(board.runtime.metreRoles, {valid: 2, invalid: 1,
    issues: [{file: 'broken.md', source: 'user', reason: '缺少 when'}]});

  // A refreshed catalog (e.g. after fixing the bad card) is visible on the
  // next RPC, without renaming the task dispatched with an earlier snapshot.
  catalogue.invalid.length = 0;
  board = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(board.runtime.metreRoles.invalid, 0);
  assert.deepEqual(roles(user), ['backend-fix', '接口诊断', 'user']);
});

test('failed catalog read leaves the board usable and does not report zero roles', async t => {
  const {rpc} = setup(t, () => { throw new Error('catalog unavailable'); });
  const board = await rpc('pinkie.metre.board', {sessionKey: PARENT});
  assert.equal(board.ok, true);
  assert.equal(board.runtime.metreRoles, null);
  assert.equal(board.sessions.length, 2);
});
