import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PLAN_CONTINUE_LIMIT, PLAN_CONTROL_MARK, PlanContinuationState, RichStore, planControlText, planOpenItems} from '../services/mode-architecture/rich-runtime.mjs';
import {TierContinuation} from '../services/mode-architecture/index.mjs';

const KEY = 'agent:project:plan-test';
const PREFIX = '[pinkie-tier-control]';
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-plan-'));
  let now = 1_000;
  const clock = () => now;
  const store = new RichStore(root, clock);
  const state = new PlanContinuationState(store, clock);
  const tick = (ms = 1_000) => { now += ms; };
  const plan = statuses => store.updatePlan(KEY, {items: statuses.map((status, i) => ({text: `步骤 ${i + 1}`, status}))});
  const facts = extra => ({mode: 'project', success: true, prefix: PREFIX, ...extra});
  return {root, store, state, tick, plan, facts};
}

test('an unfinished plan continues after the turn ends, a finished one does not', () => {
  const {state, tick, plan, facts} = setup();
  state.userMessage(KEY); tick();
  plan(['completed', 'in_progress', 'pending']);
  state.toolCalled(KEY, 'write');
  const decision = state.consider(KEY, facts());
  assert.equal(decision.continue, true);
  assert.equal(decision.open, 2);
  const status = state.status(KEY);
  assert.equal(status.active, true);
  assert.match(status.message, /^\[pinkie-tier-control\] 【计划续跑】/);
  assert.match(status.message, /从「步骤 2」接着做/);
  assert.match(status.message, /不得输出 NO_REPLY/);
  tick(); plan(['completed', 'completed', 'completed']);
  assert.deepEqual(state.consider(KEY, facts()), {continue: false, reason: 'done'});
  assert.equal(state.status(KEY).active, false);
});

test('a plan left over from before the last user message never triggers a continuation', () => {
  const {state, tick, plan, facts} = setup();
  plan(['completed', 'pending']); tick();
  state.userMessage(KEY); tick();
  assert.equal(state.consider(KEY, facts()).reason, 'stale-plan');
  // 网关重启后没有这段会话的记录：旧清单同样不触发。
  const fresh = setup();
  fresh.plan(['pending', 'pending']); fresh.tick();
  assert.equal(fresh.state.consider(KEY, fresh.facts()).reason, 'stale-plan');
});

test('legitimate stops are respected: asking the user, reporting a blocker, background work, user stop, failed run', () => {
  for (const [extra, reason] of [
    [{waitingOnUser: true}, 'waiting-on-user'],
    [{honestIncomplete: true}, 'reported-blocked'],
    [{backgroundRunning: true}, 'background-running'],
    [{userStopped: true}, 'user-stopped'],
    [{success: false}, 'run-failed'],
    [{tierActive: true}, 'tier-owns-continuation'],
  ]) {
    const {state, tick, plan, facts} = setup();
    state.userMessage(KEY); tick(); plan(['in_progress', 'pending']);
    assert.equal(state.consider(KEY, facts(extra)).reason, reason, reason);
    assert.equal(state.status(KEY).active, false);
  }
});

test('a user stop holds until the next real user message', () => {
  const {state, tick, plan, facts} = setup();
  state.userMessage(KEY); tick(); plan(['in_progress', 'pending']);
  assert.equal(state.consider(KEY, facts({userStopped: true})).reason, 'user-stopped');
  assert.equal(state.consider(KEY, facts()).reason, 'user-stopped');
  state.userMessage(KEY); tick(); plan(['in_progress', 'pending']);
  assert.equal(state.consider(KEY, facts()).continue, true);
});

test('only chat, project and ideas modes continue; learning, unrestricted and internal sessions never do', () => {
  for (const extra of [{mode: 'learning'}, {mode: 'none'}, {mode: null}, {internalSession: true}]) {
    const {state, tick, plan, facts} = setup();
    state.userMessage(KEY); tick(); plan(['pending']);
    assert.equal(state.consider(KEY, facts(extra)).reason, 'not-applicable');
  }
  for (const mode of ['chat', 'ideas']) {
    const {state, tick, plan, facts} = setup();
    state.userMessage(KEY); tick(); plan(['pending']);
    assert.equal(state.consider(KEY, facts({mode})).continue, true);
  }
});

test('no progress stops the loop: at once when nothing ran, after two rounds when work ran but the list did not move', () => {
  const idle = setup();
  idle.state.userMessage(KEY); idle.tick(); idle.plan(['in_progress', 'pending']);
  assert.equal(idle.state.consider(KEY, idle.facts()).continue, true);
  assert.equal(idle.state.consider(KEY, idle.facts()).reason, 'stalled');

  const busy = setup();
  busy.state.userMessage(KEY); busy.tick(); busy.plan(['in_progress', 'pending']);
  assert.equal(busy.state.consider(KEY, busy.facts()).continue, true);
  busy.state.toolCalled(KEY, 'exec');
  assert.equal(busy.state.consider(KEY, busy.facts()).continue, true);
  busy.state.toolCalled(KEY, 'exec');
  assert.equal(busy.state.consider(KEY, busy.facts()).reason, 'stalled');
  // 更新清单本身不算干活；失败的调用也不算。
  const bookkeeping = setup();
  bookkeeping.state.userMessage(KEY); bookkeeping.tick(); bookkeeping.plan(['in_progress', 'pending']);
  assert.equal(bookkeeping.state.consider(KEY, bookkeeping.facts()).continue, true);
  bookkeeping.state.toolCalled(KEY, 'plan_update');
  bookkeeping.state.toolCalled(KEY, 'exec', true);
  assert.equal(bookkeeping.state.consider(KEY, bookkeeping.facts()).reason, 'stalled');
});

test('steady progress continues up to the limit and then stops', () => {
  const {state, tick, store, facts} = setup();
  state.userMessage(KEY); tick();
  const total = PLAN_CONTINUE_LIMIT + 3;
  let continued = 0;
  for (let done = 0; done < total - 1; done += 1) {
    tick();
    store.updatePlan(KEY, {items: Array.from({length: total}, (_, i) => ({text: `步骤 ${i + 1}`, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending'}))});
    state.toolCalled(KEY, 'write');
    const decision = state.consider(KEY, facts());
    if (!decision.continue) { assert.equal(decision.reason, 'limit'); break; }
    continued += 1;
  }
  assert.equal(continued, PLAN_CONTINUE_LIMIT);
});

test('the reminder lists every item with its state and is recognisable as internal control text', () => {
  const text = planControlText(PREFIX, {items: [{id: '1', text: '搭页面', status: 'completed'}, {id: '2', text: '手机宽度截图', status: 'in_progress'}, {id: '3', text: '打磨', status: 'pending'}]});
  assert.match(text, /1\. \[已完成\] 搭页面/);
  assert.match(text, /2\. \[进行中\] 手机宽度截图/);
  assert.match(text, /3\. \[没做\] 打磨/);
  assert.ok(text.includes(PLAN_CONTROL_MARK));
  assert.equal(planOpenItems(null).length, 0);
});

test('the shared continuation sender delivers the plan reminder on its own tag and disarms after sending', async () => {
  const {state, tick, plan, facts} = setup();
  state.userMessage(KEY); tick(); plan(['completed', 'pending']);
  assert.equal(state.consider(KEY, facts()).continue, true);
  const calls = [], removed = [], injected = [];
  const api = {session: {workflow: {
    scheduleSessionTurn: async () => ({id: 'fallback'}),
    unscheduleSessionTurnsByTag: async value => { removed.push(value); return {removed: 1}; },
    enqueueNextTurnInjection: async value => { injected.push(value); return {enqueued: true}; },
  }}};
  const sender = new TierContinuation(api, key => state.status(key), () => ({pending: 0, quietForMs: 20_000}),
    async (file, args) => { calls.push(args); return {stdout: '{"status":"started"}', stderr: ''}; }, '/runtime/openclaw/dist/index.js',
    {messageFor: status => status.message, tagName: 'pinkie-plan-', turnName: '碧琪计划续跑', onDispatched: key => state.disarm(key)});
  assert.equal(await sender.schedule(KEY, 'project'), true);
  clearTimeout(sender.timers.get(KEY)); sender.timers.delete(KEY);
  assert.match(sender.tag(KEY), /^pinkie-plan-/);
  assert.match(injected[0].idempotencyKey, /^pinkie-plan-control-/);
  assert.equal(await sender.dispatch({sessionKey: KEY, agentId: 'project', tag: sender.tag(KEY)}), true);
  const params = JSON.parse(calls[0][calls[0].indexOf('--params') + 1]);
  assert.match(params.message, /^\[pinkie-tier-control\] 【计划续跑】/);
  assert.equal(params.deliver, false);
  assert.match(params.idempotencyKey, /^pinkie-plan-continue-/);
  assert.equal(state.status(KEY).active, false);
  // 已经发出、状态解除后，不会再发第二次。
  assert.equal(await sender.schedule(KEY, 'project'), false);
});

// 端到端：真的走一遍插件的钩子。用户发消息 → 碧琪列清单、干了一步 → 这一轮结束时清单没做完 → 排出一条计划续跑。
test('through the real plugin hooks: an unfinished plan_update list queues exactly one hidden continuation', async t => {
  const {default: plugin} = await import('../services/mode-architecture/index.mjs');
  const priorStateRoot = process.env.PINKIE_STATE_ROOT;
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-plan-hooks-'));
  process.env.PINKIE_STATE_ROOT = stateRoot;
  t.after(() => {
    if (priorStateRoot === undefined) delete process.env.PINKIE_STATE_ROOT; else process.env.PINKIE_STATE_ROOT = priorStateRoot;
    fs.rmSync(stateRoot, {recursive: true, force: true});
  });
  const hooks = new Map(), tools = [], queued = [], scheduled = [];
  plugin.register({
    on: (name, fn) => hooks.set(name, fn),
    registerGatewayMethod: () => {},
    registerTool: (factory, opts) => tools.push({factory, opts}),
    runtime: {state: {resolveStateDir: () => stateRoot}, config: {current: () => ({})}},
    registerHttpRoute: () => ({}),
    session: {workflow: {
      enqueueNextTurnInjection: async value => { queued.push(value); },
      unscheduleSessionTurnsByTag: async () => ({removed: 0}),
      scheduleSessionTurn: async value => { scheduled.push(value); return {id: 'fallback'}; },
    }},
  });
  const run = async (sessionKey, agentId, runId, items, reply) => {
    const ctx = {agentId, sessionKey, runId};
    await hooks.get('message_received')({content: '帮我做一个班级值日排班的小工具，要好用，你慢慢弄', messageId: `m-${runId}`, runId}, ctx);
    hooks.get('before_agent_run')({prompt: '帮我做一个班级值日排班的小工具，要好用，你慢慢弄', runId}, ctx);
    const planTool = tools.find(item => item.opts.name === 'plan_update').factory(ctx);
    await planTool.execute('plan-1', {items});
    await hooks.get('after_tool_call')({toolName: 'plan_update', toolCallId: 'plan-1', runId, result: {content: [{type: 'text', text: 'ok'}]}}, ctx);
    await hooks.get('after_tool_call')({toolName: 'write', toolCallId: 'w-1', runId, params: {path: '/tmp/x/index.html'}, result: {content: [{type: 'text', text: 'ok'}]}}, ctx);
    await hooks.get('agent_end')({success: true, runId, lastAssistantMessage: reply, messages: [{role: 'assistant', content: [{type: 'text', text: reply}], stopReason: 'stop'}]}, ctx);
    return queued.filter(item => String(item.sessionKey) === sessionKey && String(item.text).includes('【计划续跑】'));
  };
  const open = [{text: '搭出能显示名单的页面', status: 'completed'}, {text: '自动轮换', status: 'in_progress'}, {text: '打印成一张表', status: 'pending'}];
  const done = open.map(item => ({...item, status: 'completed'}));

  const continued = await run('agent:project:plan-hooks-open', 'project', 'run-open', open, '名单页面搭好了，接下来可以继续做自动轮换。');
  assert.equal(continued.length, 1);
  assert.match(continued[0].text, /^\[pinkie-tier-control\] 【计划续跑】/);
  assert.match(continued[0].text, /从「自动轮换」接着做/);

  assert.equal((await run('agent:project:plan-hooks-done', 'project', 'run-done', done, '排班工具做好了，双击 index.html 就能用。')).length, 0);
  assert.equal((await run('agent:learning:plan-hooks-learning', 'learning', 'run-learning', open, '第一步讲完了，你先试着做这道题。')).length, 0);
  assert.equal((await run('agent:unrestricted:plan-hooks-none', 'unrestricted', 'run-none', open, '第一步好了。')).length, 0);
  assert.equal((await run('agent:project:plan-hooks-ask', 'project', 'run-ask', open, '名单页面好了。\n```ui\n{"text":"轮换按周还是按天？","buttons":["按周（推荐）","按天"]}\n```')).length, 0);

  // 用户的新消息会撤掉还没发出去的续跑。
  await hooks.get('message_received')({content: '先停一下', messageId: 'm-stop', runId: 'run-stop'}, {agentId: 'project', sessionKey: 'agent:project:plan-hooks-open', runId: 'run-stop'});
});
