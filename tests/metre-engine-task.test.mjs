// E4 · Metre 派活给外部引擎（briefs/metre-engines-1122 PLAN 3.4）：pinkie_engine_task、守望、回报、在跑上限、总谱声部。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EngineTasks, doingOf, registerEngineTasks, reportOf} from '../services/mode-architecture/engines-task.mjs';
import {SessionEngines} from '../services/mode-architecture/engines-bridge.mjs';
import {Players, registerPlayers} from '../services/mode-architecture/engines-players.mjs';
import {MetreBaton, dispatchOutcome} from '../services/mode-architecture/metre-baton.mjs';
import {MetreBoard} from '../services/mode-architecture/metre-board.mjs';

const PARENT = 'agent:metre:main-1';
const CATALOG = {engines: [
  {id: 'antigravity', name: 'Antigravity', state: 'ready', text: '', plan: 'Pro', quota: {state: 'ok', text: '已用 20%'},
    models: [{slug: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash'}, {slug: 'gpt-oss-120b-medium', name: 'GPT OSS', isDefault: true}, {slug: 'gemini-4-argon', name: 'Gemini 4 Argon', out: true}]},
  {id: 'claudeAgent-2', name: 'Claude Code · Metre', state: 'ready', text: '', quota: {state: 'ok', text: ''}, models: [{slug: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', isDefault: true}]},
  {id: 'codex', name: 'Codex', state: 'ready', text: '', quota: {state: 'out', resetAt: '11-26 17:44', text: '额度用完了'}, models: [{slug: 'gpt-5.6', name: 'GPT 5.6'}]},
  {id: 'cursor', name: 'Cursor', state: 'signin', text: '还没登录', quota: {state: 'unknown', text: ''}, models: []},
]};

function setup(t, {turn = {user: true}, running = 0, solo = false, paused = false, enabled = true} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-engine-task-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = 1_000_000;
  const records = {}, states = {[PARENT]: {cards: []}}, sent = [], reports = [], deferred = [];
  const lineage = {
    lineage: () => records,
    updateLineage: (key, fields) => (records[key] = {...records[key], ...fields}),
    state: key => states[key] || {},
    updateState: (key, update) => (states[key] = update(states[key] || {})),
    solo: () => solo, paused: () => paused,
    parentEntry: async key => { if (records[key]) throw new Error('子会话里不能再开子会话'); return {key}; },
    turns: new Map(turn ? [[PARENT, {...turn}]] : []),
    metreLimits: () => ({maxRunning: 2, requestCap: 24}),
    maxRunning: () => 2,
    runningChildren: () => running + [...Object.keys(records)].filter(key => lineage.externalBusy?.(key)).length,
    familyRows: async () => new Map(),
    countMetreStart: key => { states[key] = {...states[key], metreStarts: (states[key]?.metreStarts || 0) + 1}; },
    slotsLeft: async () => 1,
    notify: () => {},
    titles: {record: () => null},
    access: {rpc: async (name, params) => { sent.push({name, params}); return name === 'sessions.create' ? {key: params.key, entry: {label: params.label}} : {ok: true}; }},
    report: async (key, child, text, runId, options = {}) => { reports.push({key, text, runId, ...options}); },
    defer: key => deferred.push(key),
  };
  let thread = {status: 'running', items: [], changes: [], pending: [], runId: 'run-1'};
  const calls = [];
  const bridge = {
    stateRoot: root,
    sessions: new SessionEngines(path.join(root, 'sessions.json')),
    service: {status: () => ({running: true})},
    catalog: async () => structuredClone(CATALOG),
    folderFor: () => root,
    start: async params => { calls.push({start: params}); return {threadId: 'thread-1'}; },
    thread: async () => structuredClone(thread),
    send: async params => { calls.push({send: params}); return {status: 'running'}; },
    stop: async params => { calls.push({stop: params}); return {status: 'stopped'}; },
  };
  lineage.rolesRegistry = () => ({validIds: ['reviewer'], byId: {reviewer: {name: '审稿人', body: '只挑错，不改文件。'}}});
  const players = new Players(path.join(root, 'players.json'));
  const tasks = new EngineTasks({bridge, lineage, players, isEnabled: () => enabled, now: () => clock, schedule: () => null});
  const tools = [], hooks = {}, methods = new Map();
  const api = {registerTool: (factory, opts) => tools.push({factory, opts}), on: (name, fn) => (hooks[name] ??= []).push(fn)};
  registerEngineTasks(api, {tasks, register: (_api, name, fn) => methods.set(name, fn)});
  const tool = key => tools.find(item => item.opts.name === 'pinkie_engine_task').factory({sessionKey: key, runId: 'r1'});
  return {root, tasks, lineage, records, states, sent, reports, deferred, calls, methods, hooks, tool, tick: ms => { clock += ms; },
    setThread: next => { thread = {status: 'running', items: [], changes: [], pending: [], runId: 'run-1', ...next}; }};
}

test('start hands the job to the engine as a child of the Metre session, without waiting, and holds a running slot', async t => {
  const env = setup(t);
  const out = await env.tasks.run(PARENT, 'r1', {engine: 'antigravity', model: 'gemini-3.8-flash', task: '新建 hello.md\n写一行字', level: 'auto'});
  assert.match(out.key, /^agent:metre:pinkie-child:[0-9a-f]{32}$/);
  assert.equal(out.engineName, 'Antigravity');
  assert.match(out.message, /交给 Antigravity（Gemini 3.8 Flash）/);
  const create = env.sent.find(call => call.name === 'sessions.create');
  assert.deepEqual(create.params, {agentId: 'metre', key: out.key, label: '新建 hello.md', parentSessionKey: PARENT});
  assert.ok(env.sent.some(call => call.name === 'pinkie.project.bind' && call.params.key === out.key));
  const {start} = env.calls[0];
  assert.equal(start.engine, 'antigravity');
  assert.equal(start.model, 'gemini-3.8-flash');
  assert.equal(start.level, 'auto');
  assert.match(start.text, /^新建 hello\.md\n写一行字\n\n做完后用几句话交回/);
  // 引擎台按这一份画：点开子会话就是它的对话。
  assert.equal(env.tasks.bridge.sessions.get(out.key).threadId, 'thread-1');
  const record = env.records[out.key];
  assert.equal(record.kind, 'external');
  assert.equal(record.parentKey, PARENT);
  assert.equal(record.initiation, 'in_scope');
  assert.equal(record.modelName, 'Gemini 3.8 Flash');
  assert.equal(env.states[PARENT].metreStarts, 1);
  assert.equal(env.tasks.busy(out.key), true);
  assert.equal(env.lineage.externalBusy(out.key), true);
  // 不写 model 用那家的默认。
  const second = await env.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: '另一件'});
  assert.equal(env.calls[1].start.model, 'gpt-oss-120b-medium');
  // 两个在跑，上限 2：第三个说「名额满了」那句，Baton 认得出是「派不出去」。
  await assert.rejects(env.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: '第三件'}), error => {
    assert.match(error.message, /这个父会话已有 2 个子会话在跑/);
    assert.equal(dispatchOutcome({result: {content: [{type: 'text', text: error.message}], isError: true}}), 'unavailable');
    return true;
  });
  assert.notEqual(second.key, out.key);
});

test('start refuses plainly: engine not ready, used-up quota or model, not a user turn, paused, Virtuoso, or inside a child', async t => {
  const env = setup(t);
  const fails = async (params, pattern) => assert.rejects(env.tasks.run(PARENT, 'r1', params), pattern);
  await fails({engine: 'cursor', task: 'x'}, /Cursor现在用不了（还没登录）/);
  await fails({engine: 'codex', task: 'x'}, /Codex额度用完了，11-26 17:44 恢复/);
  await fails({engine: 'antigravity', model: 'gemini-4-argon', task: 'x'}, /额度用完了：换一个模型/);
  await fails({engine: 'nope', task: 'x'}, /先用 action: engines/);
  await fails({engine: 'antigravity'}, /task 写简报/);
  assert.equal(env.sent.length, 0);
  await assert.rejects(setup(t, {turn: {internal: true}}).tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'}), /不是用户亲自发来的/);
  await assert.rejects(setup(t, {paused: true}).tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'}), /暂停了派发/);
  await assert.rejects(setup(t, {solo: true}).tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'}), /Virtuoso/);
  await assert.rejects(setup(t, {enabled: false}).tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'}), error => {
    assert.match(error.message, /还没打开外部引擎/);
    assert.equal(dispatchOutcome({result: {content: [{type: 'text', text: error.message}], isError: true}}), 'unavailable');
    return true;
  });
  // A wake turn (a report came back) may dispatch the next stage, like pinkie_session_start.
  const woke = setup(t, {turn: {wake: true, internal: true}});
  assert.ok((await woke.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'})).key);
  // An engine that fails to open the thread leaves no half-made child behind.
  const broken = setup(t);
  broken.tasks.bridge.start = async () => { throw new Error('引擎服务没回'); };
  await assert.rejects(broken.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'}), /没交出去：引擎服务没回/);
  assert.ok(broken.sent.some(call => call.name === 'sessions.delete'));
  assert.deepEqual(broken.records, {});
});

test('the watcher reports once when the job is done: last reply and changed files, then wakes Metre', async t => {
  const env = setup(t);
  const {key} = await env.tasks.run(PARENT, 'r1', {engine: 'claudeAgent-2', task: '末尾加一行'});
  env.setThread({status: 'running', items: [{kind: 'command', command: 'printf "x" >> hello.md'}]});
  await env.tasks.tick();
  assert.equal(env.tasks.doing(key), '跑 printf "x" >> hello.md');
  assert.equal(env.reports.length, 0);
  env.setThread({status: 'done', runId: 'run-1', items: [{kind: 'reply', text: '加好了，第三行。'}],
    changes: [{file: 'hello.md', additions: 1, deletions: 0, counted: true}]});
  await env.tasks.tick();
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0].key, key);
  assert.equal(env.reports[0].failed, false);
  assert.equal(env.reports[0].text, '加好了，第三行。\n\n改了：hello.md（+1 −0）');
  assert.deepEqual(env.deferred, [PARENT]);
  assert.equal(env.tasks.busy(key), false);
  assert.equal(env.records[key].engineWatch, false);
  await env.tasks.tick();
  assert.equal(env.reports.length, 1);
  // Metre 递一句话：同一件活接着做，做完再交回一次。
  await env.tasks.run(PARENT, 'r2', {action: 'say', target: key, text: '再加一行'});
  assert.equal(env.calls.at(-1).send.threadId, 'thread-1');
  assert.equal(env.tasks.busy(key), true);
  env.setThread({status: 'done', runId: 'run-2', items: [{kind: 'reply', text: '又加了一行。'}]});
  await env.tasks.tick();
  assert.equal(env.reports.length, 2);
  await assert.rejects(env.tasks.run(PARENT, 'r2', {action: 'say', target: 'agent:metre:pinkie-child:other', text: 'x'}), /target 要写/);
});

test('waiting for the user is reported once as 等你; a failure is reported as failed with the plain reason', async t => {
  const env = setup(t);
  const {key} = await env.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: '改配置', level: 'approval-required'});
  env.setThread({status: 'waiting', pending: [{requestId: 'req-1', kind: 'approval'}],
    items: [{kind: 'approval', requestId: 'req-1', prompt: 'rm -rf build', open: true}]});
  await env.tasks.tick();
  await env.tasks.tick();
  assert.equal(env.reports.length, 1);
  assert.match(env.reports[0].text, /^Antigravity等你批准：rm -rf build/);
  assert.equal(env.states[key].phase, 'waiting');
  assert.equal(env.tasks.busy(key), false);
  env.setThread({status: 'running'});
  await env.tasks.tick();
  assert.equal(env.states[key].phase, undefined);
  assert.equal(env.tasks.busy(key), true);
  env.setThread({status: 'failed', runId: 'run-1', error: {text: '额度用完了', resetAt: '11-24 08:00'}, items: []});
  await env.tasks.tick();
  assert.equal(env.reports.length, 2);
  assert.equal(env.reports[1].failed, true);
  assert.equal(env.reports[1].text, 'Antigravity没做成：额度用完了（11-24 08:00 恢复）');
  assert.equal(env.states[key].phase, 'error');
});

test('a job that never starts, or an engine service that went away, ends as failed instead of running forever', async t => {
  const env = setup(t);
  const {key} = await env.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'});
  env.setThread({status: 'idle', runId: null});
  await env.tasks.tick();
  assert.equal(env.reports.length, 0);
  env.tick(120_000);
  await env.tasks.tick();
  assert.match(env.reports[0].text, /没跑起来/);
  const gone = setup(t);
  const second = await gone.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'});
  gone.tasks.bridge.service.status = () => ({running: false});
  for (let i = 0; i < 12; i++) await gone.tasks.tick();
  assert.equal(gone.reports.length, 1);
  assert.match(gone.reports[0].text, /外部引擎停了/);
  assert.equal(gone.tasks.busy(second.key), false);
  void key;
});

test('stopping everything (收住) also stops the external job', async t => {
  const env = setup(t);
  await env.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'});
  env.tick(1000);
  env.states[PARENT].lastStop = {at: 1_000_500};
  await env.tasks.tick();
  await env.tasks.tick();
  assert.equal(env.calls.filter(call => call.stop).length, 1);
});

test('the sidebar list names each engine session by its account name; jobs carry engine · model and live status', async t => {
  const env = setup(t);
  const {key} = await env.tasks.run(PARENT, 'r1', {engine: 'claudeAgent-2', task: 'x'});
  env.tasks.bridge.sessions.set('agent:metre:chat-2', {engine: 'antigravity', model: 'gemini-3.8-flash', threadId: 't2'});
  env.tasks.bridge.sessions.set('agent:metre:chat-3', {engine: 'metre'});
  const {sessions} = await env.methods.get('pinkie.engines.sessions')();
  assert.deepEqual(Object.keys(sessions).sort(), ['agent:metre:chat-2', key].sort());
  assert.deepEqual(sessions['agent:metre:chat-2'], {engine: 'antigravity', name: 'Antigravity', model: 'gemini-3.8-flash', modelName: 'Gemini 3.8 Flash', task: false});
  assert.equal(sessions[key].name, 'Claude Code · Metre');
  assert.equal(sessions[key].modelName, 'Claude Haiku 5.5');
  assert.equal(sessions[key].status, 'running');
});

test('the tool is only offered to a Metre parent under Baton with engines on; messages to a job go to the engine', async t => {
  const env = setup(t);
  assert.ok(env.tool(PARENT));
  assert.equal(env.tool('agent:project:main'), null);
  const {key} = await env.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'});
  assert.equal(env.tool(key), null, 'a child never dispatches further');
  const solo = setup(t, {solo: true});
  assert.equal(solo.tool(PARENT), null);
  assert.equal(setup(t, {enabled: false}).tool(PARENT), null);
  const [hook] = env.hooks.before_tool_call;
  assert.match(hook({toolName: 'pinkie_session_message', params: {target: key, message: 'hi'}}, {sessionKey: PARENT}).blockReason, /pinkie_engine_task/);
  assert.equal(hook({toolName: 'pinkie_session_message', params: {target: 'agent:project:pinkie-child:x'}}, {sessionKey: PARENT}), undefined);
  // Tool output in the gateway's shape.
  const result = await env.tool(PARENT).execute('call-1', {action: 'engines'});
  assert.deepEqual(JSON.parse(result.content[0].text).engines.map(row => row.id), ['antigravity', 'claudeAgent-2', 'codex', 'cursor']);
});

test('Baton counts an engine dispatch as a real dispatch, and Virtuoso blocks it', () => {
  const baton = new MetreBaton({isMetre: key => key.startsWith('agent:metre:'), solo: key => key.endsWith('solo')});
  baton.after(PARENT, 'pinkie_engine_task', dispatchOutcome({result: {details: {key: 'agent:metre:pinkie-child:abc'}}}));
  assert.equal(baton.state(PARENT).dispatched, true);
  assert.equal(baton.before('agent:metre:solo', 'pinkie_engine_task', {}).block, true);
});

test('the score shows an external job as a voice: engine · model, what it is doing, one span from hand-off to return', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-engine-board-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const JOB = 'agent:metre:pinkie-child:job';
  const lineage = {
    lineage: () => ({[JOB]: {parentKey: PARENT, title: '末尾加一行', kind: 'external', engine: 'claudeAgent-2', engineName: 'Claude Code · Metre',
      model: 'claude-haiku-5-5', modelName: 'Claude Haiku 5.5', createdAt: 1000, engineSince: 1000, started: true, initiation: 'in_scope'}}),
    state: () => ({}), familyRows: async () => new Map(), busy: key => key === JOB, externalDoing: () => '改 hello.md',
    metreLimits: () => ({maxRunning: 8, requestCap: 24}), turns: new Map(),
  };
  const board = new MetreBoard({root, lineage, now: () => 5000});
  const view = await board.board(PARENT);
  const [voice] = view.sessions;
  assert.equal(voice.modeName, 'Claude Code · Metre');
  assert.equal(voice.model, 'Claude Haiku 5.5');
  assert.equal(voice.external, true);
  assert.equal(voice.status, 'running');
  assert.equal(voice.doing, '改 hello.md');
  assert.deepEqual(voice.spans, [{from: 1000, to: 5000, kind: 'run'}]);
});

test('doing and report text are short plain words', () => {
  assert.equal(doingOf({items: [{kind: 'you'}, {kind: 'edit', file: 'F:/a/b/hello.md'}]}), '改 hello.md');
  assert.equal(doingOf({items: [{kind: 'reply', streaming: true}]}), '写回话');
  assert.equal(doingOf({items: []}), '准备中');
  assert.equal(reportOf({items: [], changes: []}, {engineName: 'Codex', status: 'done'}), 'Codex做完了，没有写回话。');
  assert.match(reportOf({items: [{kind: 'reply', text: '一半'}], changes: []}, {engineName: 'Codex', status: 'stopped'}), /^Codex停下了，这件活没做完。\n\n停之前它说：一半$/);
});

test('players: a saved name + engine + model + level (+ role card) is used when Metre writes player', async t => {
  const env = setup(t);
  const players = env.tasks.players;
  const methods = new Map();
  registerPlayers({}, {players, register: (_api, name, fn) => methods.set(name, fn), roles: () => [{id: 'reviewer', name: '审稿人'}]});
  const saved = (await methods.get('pinkie.engines.players')({action: 'save', player: {name: '  审稿 a@b.com ', engine: 'claudeAgent-2', model: 'claude-haiku-5-5', level: 'auto', role: 'reviewer'}})).saved;
  assert.equal(saved.name, '审稿', 'no email in a name');
  assert.deepEqual((await methods.get('pinkie.engines.players')({})).roles, [{id: 'reviewer', name: '审稿人'}]);
  assert.throws(() => players.save({name: '审稿', engine: 'antigravity'}), /已经有一个叫「审稿」/);
  assert.throws(() => players.save({name: 'x', engine: 'metre'}), /外部引擎/);
  assert.equal(players.find('审稿').id, saved.id);
  const listed = await env.tasks.run(PARENT, 'r1', {action: 'engines'});
  assert.deepEqual(listed.players, [{name: '审稿', engine: 'claudeAgent-2', model: 'claude-haiku-5-5', level: 'auto', role: 'reviewer'}]);
  const out = await env.tasks.run(PARENT, 'r1', {player: '审稿', task: '看看 hello.md 有没有错字'});
  assert.equal(out.player, '审稿');
  const {start} = env.calls[0];
  assert.equal(start.engine, 'claudeAgent-2');
  assert.equal(start.model, 'claude-haiku-5-5');
  assert.equal(start.level, 'auto');
  assert.match(start.text, /^【这件活里你的角色：审稿人】\n只挑错，不改文件。\n\n【要做的事】\n看看 hello\.md 有没有错字/);
  assert.equal(env.records[out.key].player, '审稿');
  assert.equal(env.records[out.key].metreRole, undefined, 'not a roles-agent child: no role report checks');
  // engine / level written explicitly win over the player's.
  await env.tasks.run(PARENT, 'r1', {player: '审稿', engine: 'antigravity', task: 'x'});
  assert.equal(env.calls[1].start.engine, 'antigravity');
  assert.equal(env.calls[1].start.model, 'gpt-oss-120b-medium', "the other engine's default, not the player's model");
  await assert.rejects(env.tasks.run(PARENT, 'r1', {player: '没这人', task: 'x'}), /没有「没这人」这个乐手：现有 审稿/);
  const view = (await env.methods.get('pinkie.engines.sessions')()).sessions[out.key];
  assert.equal(view.player, '审稿');
  await methods.get('pinkie.engines.players')({action: 'remove', id: saved.id});
  assert.deepEqual(players.list(), []);
});

test('a word from the user in the job panel or the score re-arms the watcher, so the next result is reported too', async t => {
  const env = setup(t);
  const {key} = await env.tasks.run(PARENT, 'r1', {engine: 'antigravity', task: 'x'});
  env.setThread({status: 'done', runId: 'run-1', items: [{kind: 'reply', text: '好了'}]});
  await env.tasks.tick();
  assert.equal(env.records[key].engineWatch, false);
  env.tasks.bridge.afterSay(key);
  assert.equal(env.records[key].engineWatch, true);
  env.setThread({status: 'done', runId: 'run-2', items: [{kind: 'reply', text: '又好了'}]});
  await env.tasks.tick();
  assert.deepEqual(env.reports.map(report => report.text), ['好了', '又好了']);
  env.tasks.bridge.afterSay('agent:metre:not-a-job');
  assert.equal(env.records['agent:metre:not-a-job'], undefined);
});
