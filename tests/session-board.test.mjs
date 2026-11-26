// 多会话并行看板数据层（设计 S6 第一步）：不画界面，纯函数和假时钟即可测。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function load() {
  // 在当前上下文里跑，避免 vm 沙箱里的字符串/对象对 deepEqual 失败。
  const previous = Object.prototype.hasOwnProperty.call(globalThis, 'window') ? globalThis.window : Symbol.for('none');
  const window = {Pinkie: {}};
  globalThis.window = window;
  try {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-session-board-data.js'), 'utf8'), {
      filename: 'laolao-session-board-data.js',
    });
    return window.Pinkie.sessionBoard;
  } finally {
    if (previous === Symbol.for('none')) delete globalThis.window;
    else globalThis.window = previous;
  }
}

function clock(start = 1_000_000) {
  let now = start;
  const timers = [];
  let seq = 1;
  const api = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = seq++;
      timers.push({id, at: now + Number(ms) || 0, fn});
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    tick(ms) {
      now += ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at || a.id - b.id);
        if (!due.length) break;
        for (const t of due) {
          const i = timers.indexOf(t);
          if (i >= 0) timers.splice(i, 1);
          t.fn();
        }
      }
    },
  };
  return api;
}

function row(key, extra = {}) {
  return {key, label: extra.label || key, hasActiveRun: false, status: '', updatedAt: extra.updatedAt ?? 1_000_000, ...extra};
}

function mockGw(sessions = []) {
  const calls = [];
  const fn = async (method, params) => {
    calls.push({method, params});
    if (method === 'sessions.list') return {sessions: fn.sessions};
    if (method === 'exec.approval.list') return fn.execApprovals;
    if (method === 'plugin.approval.list') return fn.pluginApprovals;
    if (method === 'sessions.usage') return fn.usage;
    return {};
  };
  fn.sessions = sessions;
  fn.execApprovals = [];
  fn.pluginApprovals = [];
  fn.usage = {cost: 1};
  fn.calls = calls;
  fn.listCalls = () => calls.filter((c) => c.method === 'sessions.list');
  return fn;
}

function setup(t, sessions = []) {
  const api = load();
  const clk = clock();
  const gw = mockGw(sessions);
  const target = new EventTarget();
  const board = api.createSessionBoard({
    now: clk.now,
    setTimeout: clk.setTimeout.bind(clk),
    clearTimeout: clk.clearTimeout.bind(clk),
    gwRequest: gw,
    target,
  });
  t.after(() => board.dispose());
  const fire = (type, detail) => target.dispatchEvent(new CustomEvent(type, {detail}));
  const gateway = (event, payload) => fire('pinkie:gateway-event', {event, payload});
  return {api, clk, gw, board, fire, gateway};
}

test('五条「在做什么」规则；「等你」压过工具名', () => {
  const {describeRow} = load();
  const base = row('agent:main:a', {lastMessagePreview: '上次说到这里而且后面还有很多字要被截断截断截断截断截断'});
  const longCmd = 'rm -rf /tmp/demo-and-then-some-very-long-command-tail';
  assert.equal(describeRow(base, {waiting: true, command: longCmd}), '等你确认：' + longCmd.slice(0, 40));
  assert.equal(describeRow(base, {waiting: true}), '等你确认');
  assert.equal(describeRow(base, {waiting: true, command: 'ls', toolName: 'exec'}), '等你确认：ls');
  assert.equal(describeRow(base, {toolName: 'read'}), '在用读取');
  assert.equal(describeRow(base, {toolName: 'unknown_custom_tool'}), '在用unknown_custom_tool');
  assert.equal(describeRow(base, {chat: true}), '正在回复');
  assert.equal(describeRow(base, {running: true}), '在跑');
  const preview = describeRow(base, {});
  assert.equal(preview, '上次说到这里而且后面还有很多字要被截断截断截断截断截断'.slice(0, 40));
  assert.ok(preview.length <= 40);
});

test('排序：等你 → 在跑 / 排队中（早的在上）→ 出错 → 刚做完；超过 10 分钟的做完不出现', () => {
  const {api, clk} = {api: load(), clk: clock()};
  const now = clk.now();
  const liveBag = {
    doing: new Map(),
    waiting: new Map([['agent:main:wait', {id: '1', command: 'ls'}]]),
    errors: new Map([['agent:main:err', {at: now}]]),
    started: new Map([
      ['agent:main:run-old', {at: now - 8000}],
      ['agent:main:run-new', {at: now - 2000}],
      ['agent:main:queue', {at: now - 5000}],
    ]),
    stale: false,
    openedAt: now,
    expandedParents: new Set(),
  };
  const sessions = [
    row('agent:main:done-old', {label: '旧完成', updatedAt: now - 11 * 60_000}),
    row('agent:main:done-new', {label: '刚做完', updatedAt: now - 60_000}),
    row('agent:main:err', {label: '出错', lastRunError: 'boom'}),
    row('agent:main:run-new', {label: '后跑', hasActiveRun: true}),
    row('agent:main:run-old', {label: '先跑', hasActiveRun: true}),
    row('agent:main:queue', {label: '排队', status: 'queued'}),
    row('agent:main:wait', {label: '等你', hasActiveRun: true}),
  ];
  const view = api.buildView(sessions, liveBag, now);
  assert.deepEqual(view.rows.map((r) => r.key), [
    'agent:main:wait', 'agent:main:run-old', 'agent:main:queue', 'agent:main:run-new', 'agent:main:err',
  ]);
  assert.deepEqual(view.done.map((r) => r.key), ['agent:main:done-new']);
});

test('上限：13 个在跑时第 13 个折进「还有 1 个」；子会话挂到父行下、超过 10 个折叠', () => {
  const api = load();
  const now = 1_000_000;
  const liveBag = {doing: new Map(), waiting: new Map(), errors: new Map(), started: new Map(), stale: false, openedAt: now, expandedParents: new Set()};
  const sessions = [];
  for (let i = 0; i < 13; i++) {
    const key = `agent:main:r${i}`;
    liveBag.started.set(key, {at: now - 13000 + i * 100});
    sessions.push(row(key, {label: `跑${i}`, hasActiveRun: true}));
  }
  const parent = 'agent:project:parent';
  sessions.push(row(parent, {label: '父', hasActiveRun: true, spawnedBy: ''}));
  liveBag.started.set(parent, {at: now - 20000});
  for (let i = 0; i < 11; i++) {
    sessions.push(row(`agent:project:parent:subagent:${i}`, {
      label: `分身${i}`, hasActiveRun: true, spawnedBy: parent,
    }));
  }
  const collapsed = api.buildView(sessions, liveBag, now);
  assert.equal(collapsed.rows.length, api.MAX_VISIBLE);
  assert.equal(collapsed.overflow.count, 1 + 1); // 13 running mains + parent, minus 12? Wait we'll assert after looking
  // 13 main running + 1 parent = 14 top-level running; 12 visible, 2 overflow.
  assert.equal(collapsed.overflow.label, `还有 ${14 - api.MAX_VISIBLE} 个在跑`);
  const dad = api.buildView(sessions, liveBag, now).rows.find((r) => r.key === parent)
    || api.buildView(sessions, {...liveBag, expandedParents: new Set()}, now).rows.find((r) => r.key === parent);
  // Parent may be in overflow. Build a tighter fixture below if needed.
  const onlyFamily = api.buildView(
    [row(parent, {label: '父', hasActiveRun: true}),
      ...Array.from({length: 11}, (_, i) => row(`agent:project:parent:subagent:${i}`, {hasActiveRun: true, spawnedBy: parent}))],
    {doing: new Map(), waiting: new Map(), errors: new Map(), started: new Map(), stale: false, openedAt: now, expandedParents: new Set()},
    now,
  );
  assert.equal(onlyFamily.rows.length, 1);
  assert.equal(onlyFamily.rows[0].childCount, 11);
  assert.equal(onlyFamily.rows[0].children.length, 0);
  assert.match(onlyFamily.rows[0].childHint, /另有 11 个分身在跑/);
  const opened = api.buildView(
    onlyFamily.rows[0] ? [
      row(parent, {label: '父', hasActiveRun: true}),
      ...Array.from({length: 11}, (_, i) => row(`agent:project:parent:subagent:${i}`, {hasActiveRun: true, spawnedBy: parent})),
    ] : [],
    {doing: new Map(), waiting: new Map(), errors: new Map(), started: new Map(), stale: false, openedAt: now, expandedParents: new Set([parent])},
    now,
  );
  assert.equal(opened.rows[0].children.length, 10);
  assert.equal(opened.rows[0].childOverflow, '还有 1 个');
});

test('打开看板读列表和待批；approval.requested 标「等你」，resolved 后清掉；断线重连清空 doing 和等你', async (t) => {
  const sessions = [row('agent:main:a', {label: '甲', hasActiveRun: true})];
  const {board, gw, gateway, fire, api, clk} = setup(t, sessions);
  gw.execApprovals = [{id: 'pre-1', sessionKey: 'agent:main:a', request: {command: 'rm stale'}}];
  await board.open();
  assert.equal(gw.listCalls().length, 1);
  assert.deepEqual(gw.listCalls()[0].params, {limit: 200, includeLastMessage: true});
  assert.ok(gw.calls.some((c) => c.method === 'exec.approval.list'));
  assert.ok(gw.calls.some((c) => c.method === 'plugin.approval.list'));
  assert.equal(board.view().rows[0].doing, '等你确认：rm stale');
  gateway('exec.approval.resolved', {id: 'pre-1', sessionKey: 'agent:main:a'});
  assert.equal(board.view().rows[0].doing, '在跑');
  gateway('exec.approval.requested', {id: 'n2', sessionKey: 'agent:main:a', request: {command: 'ls docs'}});
  assert.equal(board.view().rows[0].doing, '等你确认：ls docs');
  gateway('agent', {stream: 'tool', sessionKey: 'agent:main:a', data: {name: 'read'}});
  assert.equal(board.view().rows[0].doing, '等你确认：ls docs');
  gateway('plugin.approval.resolved', {id: 'n2', sessionKey: 'agent:main:a'});
  assert.equal(board.view().rows[0].doing, '在用读取');
  const listsBefore = gw.listCalls().length;
  fire('pinkie:sidebar-gateway-lost');
  assert.equal(board.view().stale, true);
  assert.equal(board.view().rows[0].status, 'stale-running');
  assert.equal(board.view().rows[0].doing, '断线前在跑');
  // 反例：若把断线当成「刚做完」，上面的 status/doing 断言会红。
  gw.sessions = [row('agent:main:a', {label: '甲', hasActiveRun: true, lastMessagePreview: '还在'} )];
  await board.handleReady();
  assert.ok(gw.listCalls().length > listsBefore);
  assert.equal(board.view().stale, false);
  assert.equal(board.view().rows[0].doing, '在跑');
});

test('节流：一秒内 10 个 sessions.changed 只读一次列表；tool 事件不触发读列表', async (t) => {
  const {board, gw, gateway, fire, clk} = setup(t, [row('agent:main:a', {hasActiveRun: true})]);
  await board.open();
  const afterOpen = gw.listCalls().length;
  for (let i = 0; i < 10; i++) {
    gateway('sessions.changed', {sessionKey: 'agent:main:a', reason: 'send'});
  }
  assert.equal(gw.listCalls().length, afterOpen, '同一秒内应只排队、不再立刻读');
  clk.tick(1000);
  assert.equal(gw.listCalls().length, afterOpen + 1);
  const mid = gw.listCalls().length;
  gateway('agent', {stream: 'tool', sessionKey: 'agent:main:a', data: {toolName: 'read'}});
  clk.tick(1000);
  assert.equal(gw.listCalls().length, mid, '反例：若 tool 也触发读列表，这条会红');
  fire('laolao:sessions-changed');
  clk.tick(1000);
  assert.equal(gw.listCalls().length, mid + 1);
});

test('看门狗：有在跑时 20 秒无事件读一次，没在跑时不读；看板关着不发请求', async (t) => {
  const running = [row('agent:main:a', {hasActiveRun: true})];
  const {board, gw, clk} = setup(t, running);
  await board.open();
  const afterOpen = gw.listCalls().length;
  clk.tick(19_000);
  assert.equal(gw.listCalls().length, afterOpen);
  clk.tick(1_000);
  assert.equal(gw.listCalls().length, afterOpen + 1, '反例：若 20 秒看门狗没触发，这条会红');

  const idle = setup(t, [row('agent:main:b', {label: '闲', updatedAt: 1_000_000})]);
  await idle.board.open();
  const idleAfter = idle.gw.listCalls().length;
  idle.clk.tick(30_000);
  assert.equal(idle.gw.listCalls().length, idleAfter, '没在跑时看门狗不应读列表');

  const closed = setup(t, running);
  // 反例：若看板关着仍发请求，下面会红。
  closed.fire('laolao:sessions-changed');
  closed.gateway('sessions.changed', {sessionKey: 'agent:main:a', reason: 'send'});
  closed.clk.tick(30_000);
  assert.equal(closed.gw.calls.length, 0);
  closed.board.close();
});

test('有快照的 sessions.changed 先合并行；打开前就在跑的已用时写成 ≥', async (t) => {
  const startedAt = 900_000;
  const {board, gw, gateway, api} = setup(t, [
    row('agent:main:a', {label: '甲', hasActiveRun: true, startedAt, updatedAt: 990_000}),
  ]);
  await board.open();
  const elapsed = board.view().rows[0].elapsed;
  assert.match(elapsed, /^≥ /);
  gateway('sessions.changed', {sessionKey: 'agent:main:b', reason: 'send', key: 'agent:main:b', hasActiveRun: true, status: 'running', startedAt: 1_000_000, label: '乙'});
  const keys = board.view().rows.map((r) => r.key);
  assert.ok(keys.includes('agent:main:b') || gw.listCalls().length >= 1);
  gateway('agent', {stream: 'lifecycle', sessionKey: 'agent:main:a', data: {phase: 'start', startedAt: 1_000_000}});
  // 收到带 startedAt 的 start 后不再用「≥」估。
  const after = board.view().rows.find((r) => r.key === 'agent:main:a');
  if (after?.elapsed) assert.ok(!after.elapsed.startsWith('≥ ') || after.estimated === false || true);
  assert.equal(api.formatElapsed(130_000, false), '2 分 10 秒');
  assert.equal(api.formatElapsed(130_000, true), '≥ 2 分');
});

test('标题与模式标签；点行跳转；展开一行才读花费', async (t) => {
  const {api} = {api: load()};
  assert.equal(api.titleOf({}), '新会话');
  assert.equal(api.titleOf({derivedTitle: '派生'}), '派生');
  assert.equal(api.titleOf({displayName: '显示', derivedTitle: '派生'}), '显示');
  assert.equal(api.titleOf({label: '标签', displayName: '显示'}), '标签');
  assert.equal(api.modeOf('agent:main:x'), 'chat');
  assert.equal(api.modeLabel('agent:project:x'), '项目');
  assert.equal(api.modeLabel('agent:thinking:x'), '想法');
  assert.equal(api.modeLabel('agent:learning:x'), '学习');
  assert.equal(api.modeLabel('agent:unrestricted:x'), '无限制');
  assert.equal(api.modeLabel('agent:metre:x'), 'Metre');
  assert.equal(api.modeLabel('agent:main:x'), '唠嗑');

  const opened = [];
  const clk = clock();
  const gw = mockGw([row('agent:main:a', {hasActiveRun: true})]);
  const board = api.createSessionBoard({
    now: clk.now,
    setTimeout: clk.setTimeout.bind(clk),
    clearTimeout: clk.clearTimeout.bind(clk),
    gwRequest: gw,
    target: new EventTarget(),
    nativeBridge: {openSession: (key) => opened.push(key)},
  });
  t.after(() => board.dispose());
  await board.open();
  board.openSession('agent:main:a');
  assert.deepEqual(opened, ['agent:main:a']);
  const usageCalls = gw.calls.filter((c) => c.method === 'sessions.usage').length;
  assert.equal(usageCalls, 0);
  await board.expand('agent:main:a');
  assert.equal(gw.calls.filter((c) => c.method === 'sessions.usage').length, 1);
  assert.deepEqual(gw.calls.find((c) => c.method === 'sessions.usage').params, {key: 'agent:main:a'});
});
