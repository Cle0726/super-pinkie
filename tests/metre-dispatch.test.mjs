// Metre 批 1 · 派发（briefs/metre-mode-1113 PLAN 2.4–2.6、ACCEPTANCE A1-*）。
// 父会话是 Metre 时的新规则；老模式的规则另有 session-lineage.test.mjs 原样守着，这里只补「老模式没变」的对照。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {METRE_TARGETS, SessionLineage, normalizeChildRequest, normalizeMode, registerMetreModelsTool, registerSessionLineage,
  resolveFolder} from '../services/mode-architecture/session-lineage.mjs';
import {SessionPrefs} from '../services/mode-architecture/session-prefs.mjs';
import {ModelHealth} from '../services/mode-architecture/model-health.mjs';
import {catalog, chooseChildModel, listModels, normalizeModelId, tierOf} from '../services/mode-architecture/metre-models.mjs';

const metre = 'agent:metre:dashboard:boss';
const project = 'agent:project:dashboard:parent';
const SELF = 'mm/workbuddy/hy4free';
const CONFIG = {
  agents: {defaults: {model: {primary: SELF}}, list: [{id: 'main'}, {id: 'project', model: {primary: 'mm/workbuddy/glm-5.3'}},
    {id: 'thinking'}, {id: 'learning'}, {id: 'unrestricted'}, {id: 'metre'}]},
  models: {providers: {mm: {models: [
    {id: 'workbuddy/hy4free', input: ['text', 'image']}, {id: 'workbuddy/glm-5.3', input: ['text', 'image']},
    {id: 'workbuddy/kimi-k2.7', input: ['text']}, {id: 'claude-opus-5-5-high', input: ['text', 'image']},
    {id: 'claude-opus-5-5-low', input: ['text', 'image']}, {id: 'gemini-3.5-flash-lite'}, {id: 'imagen-4-image'},
    {id: 'claude-sonnet-5-5-medium', input: ['text', 'image']},
  ]}}},
};
const job = (title = '整理报告', extra = {}) => ({title, prompt: '把 /tmp/a.md 整理成提纲，汇报写清改了什么。', initiation: 'user_asked',
  mode: 'project', model: 'mm/workbuddy/glm-5.3', ...extra});

function fixture(t, {config = CONFIG} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-dispatch-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const entries = new Map(), bindings = new Map(), running = new Set(), stopped = new Set(), sent = [], calls = [];
  const add = (key, props = {}) => { entries.set(key, {key, sessionId: 'id-' + key, label: '总控', ...props}); return entries.get(key); };
  add(metre); add(project, {label: '项目清单'});
  bindings.set(metre, {root: '/tmp/boss', name: 'boss'});
  const access = {
    entry: async key => entries.get(key) || null,
    list: async () => ({entries: Object.fromEntries(entries), dir: root}),
    async rpc(method, params) {
      calls.push([method, params]);
      if (method === 'sessions.list') return {sessions: [...entries.values()].filter(entry => entry.key.startsWith(`agent:${params.agentId}:`))
        .filter(entry => params.archived !== false || !entry.archivedAt).map(entry => ({...entry, hasActiveRun: running.has(entry.key)}))};
      if (method === 'chat.history') return {messages: []};
      if (method === 'sessions.create') {
        if (params.label && [...entries.values()].some(entry => entry.label === params.label)) throw new Error('label already in use');
        const child = add(params.key, {parentSessionKey: params.parentSessionKey, label: params.label, model: params.model});
        return {key: child.key, sessionId: child.sessionId};
      }
      if (method === 'pinkie.project.bind') {
        if (params.path) bindings.set(params.key, {root: params.path, name: params.name});
        return {binding: bindings.get(params.key) || null};
      }
      if (method === 'chat.send') { sent.push(params); running.add(params.sessionKey); return {status: 'started'}; }
      if (method === 'pinkie.deepThink.disarm' || method === 'pinkie.watchdog.cancel') { stopped.add(params.sessionKey); return {ok: true}; }
      if (method === 'chat.abort') { running.delete(params.sessionKey); return {ok: true, aborted: true}; }
      if (method === 'sessions.patch') {
        if (params.unread !== undefined) entries.get(params.key).unread = params.unread;
        if (params.archived !== undefined) entries.get(params.key).archivedAt = params.archived ? 1 : undefined;
        return {ok: true};
      }
      if (method === 'sessions.delete') { entries.delete(params.key); return {ok: true}; }
      throw new Error('unexpected RPC ' + method);
    },
  };
  const prefs = new SessionPrefs(root), health = new ModelHealth();
  const options = {root, titles: {access, record() {}}, isBusy: key => running.has(key), stopped: key => stopped.has(key),
    schedule: () => ({unref() {}}), prefs, config: () => config, modelHealth: health, stopTimeoutMs: 2000};
  const lineage = new SessionLineage({logger: {warn() {}}}, options);
  return {root, lineage, options, prefs, health, entries, bindings, running, stopped, sent, calls, add};
}
const free = f => { f.running.clear(); f.lineage.reserved.clear(); };
const userTurn = (f, key = metre, runId = 'human', prompt = '把这三件事同时做了') => f.lineage.begin({prompt, runId}, {sessionKey: key});
const wakeTurn = (f, key = metre, runId = 'pinkie-session-wake-1') =>
  f.lineage.begin({prompt: '[pinkie-watchdog] [pinkie-session-wake] 有一份汇报', runId}, {sessionKey: key});
async function finishChild(f, childKey, text) {
  const runId = f.sent.find(item => item.sessionKey === childKey).idempotencyKey;
  f.lineage.begin({prompt: 'x', runId}, {sessionKey: childKey});
  f.running.delete(childKey);
  await f.lineage.ended({success: true, runId, messages: [{role: 'assistant', content: text, stopReason: 'stop'}]}, {sessionKey: childKey});
}

test('A1-13 Metre 可以派到五个模式（含无限制）；老模式仍然不认 unrestricted，谁都不能把活开进 Metre', async t => {
  assert.equal(normalizeMode('unrestricted', {metre: true}), 'unrestricted');
  assert.equal(normalizeMode('无限制模式', {metre: true}), 'unrestricted');
  assert.throws(() => normalizeMode('unrestricted'), /模式只能是/);
  assert.throws(() => normalizeMode('metre'), /模式只能是/);
  assert.throws(() => normalizeMode('metre', {metre: true}), /不能开在 Metre 里/);
  assert.deepEqual(Object.keys(METRE_TARGETS), ['chat', 'project', 'ideas', 'learning', 'unrestricted']);
  const f = fixture(t);
  const child = await f.lineage.start(metre, 'human', job('无限制那块', {mode: 'unrestricted'}), 'u');
  assert.match(child.key, /^agent:unrestricted:pinkie-child:/);
  assert.equal(f.lineage.lineage()[child.key].fromMode, 'metre');
  assert.match(f.sent[0].message, /这份简报来自 Metre/);
  // 汇报回来：卡片上有模式和模型
  await finishChild(f, child.key, '无限制模式做完了');
  const card = (await f.lineage.cards(metre)).cards.at(-1);
  assert.equal(card.modeName, '无限制模式');
  await assert.rejects(f.lineage.start(project, 'human', {...job(), mode: 'unrestricted'}, 'p'), /模式只能是/);
  await assert.rejects(f.lineage.start(metre, 'human', {...job(), mode: undefined}, 'none'), /要写 mode/);
});

test('A1-1 Metre 同时跑 8 个，第 9 个被拒并说明；设置可调 2–12；项目模式仍是 4', async t => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) await f.lineage.start(metre, 'human', job('块' + i), 'c' + i);
  await assert.rejects(f.lineage.start(metre, 'human', job('第九块'), 'c9'), /已有 8 个子会话在跑/);
  f.prefs.setGlobal({metreMaxRunning: 10});
  await f.lineage.start(metre, 'human', job('第九块'), 'c9');
  assert.throws(() => f.prefs.setGlobal({metreMaxRunning: 13}), /2 到 12/);
  assert.throws(() => f.prefs.setGlobal({metreMaxRunning: 1}), /2 到 12/);
  for (let i = 0; i < 4; i++) await f.lineage.start(project, 'human', {...job('项目' + i), mode: undefined, model: undefined}, 'p' + i);
  await assert.rejects(f.lineage.start(project, 'human', {...job('项目5'), mode: undefined}, 'p5'), /已有 4 个子会话在跑/);
});

test('A1-2 Metre 在被汇报叫醒的那一轮能 in_scope（一轮 6 个）；项目模式同样轮次被拒；心跳、记忆整理轮次 Metre 也被拒', async t => {
  const f = fixture(t), scoped = extra => job('块', {initiation: 'in_scope', ...extra});
  wakeTurn(f);
  for (let i = 0; i < 6; i++) await f.lineage.start(metre, 'pinkie-session-wake-1', scoped({title: '醒来派' + i}), 'w' + i);
  await assert.rejects(f.lineage.start(metre, 'pinkie-session-wake-1', scoped({title: '第七'}), 'w7'), /一轮最多自己开 6 个/);
  // user_asked 在叫醒的那一轮仍然不行（那一轮不是用户说的话）。
  wakeTurn(f, metre, 'pinkie-session-wake-2');
  await assert.rejects(f.lineage.start(metre, 'pinkie-session-wake-2', job('冒充用户'), 'ua'), /内部通知不能代替用户授权/);
  f.lineage.begin({prompt: 'Read HEARTBEAT.md', runId: 'beat'}, {sessionKey: metre, trigger: 'heartbeat'});
  await assert.rejects(f.lineage.start(metre, 'beat', scoped({title: '心跳'}), 'hb'), /不是用户亲自发来的/);
  f.lineage.begin({prompt: '[pinkie-watchdog] [pinkie-session-wake] 整理', runId: 'pinkie-session-wake-3'}, {sessionKey: metre, trigger: 'memory'});
  await assert.rejects(f.lineage.start(metre, 'pinkie-session-wake-3', scoped({title: '记忆'}), 'mem'), /不是用户亲自发来的/);
  wakeTurn(f, project, 'pinkie-session-wake-p');
  await assert.rejects(f.lineage.start(project, 'pinkie-session-wake-p', {...scoped({}), mode: undefined, model: undefined}, 'pw'), /不是用户亲自发来的/);
  // 用户亲自发来的一轮里 Metre 也是 6 个。
  userTurn(f, metre, 'human-2');
  for (let i = 0; i < 6; i++) { free(f); await f.lineage.start(metre, 'human-2', scoped({title: '用户轮' + i}), 'h' + i); }
  await assert.rejects(f.lineage.start(metre, 'human-2', scoped({title: '用户轮7'}), 'h7'), /一轮最多自己开 6 个/);
});

test('A1-3 / A1-14 一次用户请求累计到上限（默认 24）就停下来告诉用户；用户回话后归零；设成 0 不封顶', async t => {
  const f = fixture(t);
  assert.equal(f.prefs.metreLimits().requestCap, 24);
  for (let i = 0; i < 24; i++) { free(f); await f.lineage.start(metre, 'human', job('批' + i), 'b' + i); }
  free(f);
  await assert.rejects(f.lineage.start(metre, 'human', job('第25'), 'b24'), /已经开了 24 个子会话，到了上限（24）。先停下来.*告诉用户.*等用户回话/);
  f.lineage.receive({content: '继续'}, {sessionKey: metre});
  assert.equal(f.lineage.state(metre).metreStarts, 0);
  await f.lineage.start(metre, 'human', job('第25'), 'b24');
  f.prefs.setGlobal({metreRequestCap: 0});
  for (let i = 0; i < 30; i++) { free(f); await f.lineage.start(metre, 'human', job('不封顶' + i), 'u' + i); }
  assert.equal(f.lineage.state(metre).metreStarts, 31);
});

test('A1-4 模型规则：和自己相同（含前缀、思考强度后缀的写法）、不在列表、不健康都被拒；默认和自己相同又没写 model 被拒', async t => {
  const f = fixture(t);
  await assert.rejects(f.lineage.start(metre, 'human', job('同一个', {model: SELF}), 'a'), /同一个模型/);
  await assert.rejects(f.lineage.start(metre, 'human', job('省前缀', {model: 'workbuddy/hy4free'}), 'b'), /同一个模型/);
  await assert.rejects(f.lineage.start(metre, 'human', job('只写名字', {model: 'hy4free'}), 'c'), /同一个模型/);
  await assert.rejects(f.lineage.start(metre, 'human', job('没这个', {model: 'mm/nope-1'}), 'd'), /没有「mm\/nope-1」这个模型/);
  await assert.rejects(f.lineage.start(metre, 'human', job('生图模型', {model: 'mm/imagen-4-image'}), 'e'), /没有/);
  f.health.callEnded({provider: 'mm', model: 'workbuddy/kimi-k2.7', outcome: 'error', errorMessage: '429 rate limit'});
  await assert.rejects(f.lineage.start(metre, 'human', job('不健康', {model: 'mm/workbuddy/kimi-k2.7'}), 'f'), /最近调用失败/);
  await assert.rejects(f.lineage.start(metre, 'human', job('唠嗑默认', {mode: 'chat', model: undefined}), 'g'), /默认模型.*和你自己相同，必须写 model/);
  // 项目模式的默认（glm-5.3）和自己不同：不写 model 也行，用默认，不把 Metre 的模型带过去。
  const plain = await f.lineage.start(metre, 'human', job('项目默认', {model: undefined}), 'h');
  assert.equal(f.calls.filter(([m]) => m === 'sessions.create').at(-1)[1].model, undefined);
  assert.equal(f.lineage.lineage()[plain.key].model, 'mm/workbuddy/glm-5.3');
  // 思考强度后缀：Metre 自己是 opus-5-5-high 时，-low 也算同一个。
  f.entries.get(metre).providerOverride = 'mm'; f.entries.get(metre).modelOverride = 'claude-opus-5-5-high';
  await assert.rejects(f.lineage.start(metre, 'human', job('换强度', {model: 'mm/claude-opus-5-5-low'}), 'i'), /同一个模型/);
  const ok = await f.lineage.start(metre, 'human', job('能派', {model: 'mm/claude-sonnet-5-5-medium'}), 'j');
  assert.equal(ok.model, 'mm/claude-sonnet-5-5-medium');
  // 这一轮真正调用的模型优先于会话设置（模型健康记下的 runId → 模型）。
  f.health.callStarted({provider: 'mm', model: 'workbuddy/glm-5.3', runId: 'human-x'});
  userTurn(f, metre, 'human-x');
  await assert.rejects(f.lineage.start(metre, 'human-x', job('跟这轮同一个', {model: 'mm/workbuddy/glm-5.3'}), 'k'), /同一个模型/);
});

test('A1-5（参数层）指定的模型原样传给 sessions.create；模型被网关拒绝时如实报错，不退回默认', async t => {
  const f = fixture(t);
  const child = await f.lineage.start(metre, 'human', job('指定', {model: 'kimi-k2.7'}), 'a');
  assert.equal(f.calls.find(([m]) => m === 'sessions.create')[1].model, 'mm/workbuddy/kimi-k2.7');
  assert.equal(f.entries.get(child.key).model, 'mm/workbuddy/kimi-k2.7');
  const original = f.lineage.access.rpc;
  f.lineage.access.rpc = async (method, params) => {
    if (method === 'sessions.create' && params.model) throw new Error('model not allowed for this agent');
    return original(method, params);
  };
  await assert.rejects(f.lineage.start(metre, 'human', job('被拒', {model: 'mm/workbuddy/glm-5.3'}), 'b'), /开不起来/);
});

test('A1-6 folder：子会话绑到另一个项目文件夹（盘符、反斜杠、引号都认）；不存在的被拒', async t => {
  const f = fixture(t);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-other-'));
  t.after(() => fs.rmSync(other, {recursive: true, force: true}));
  const written = process.platform === 'win32' ? '"' + other.replace(/\//g, '\\') + '\\"' : other + '/';
  const child = await f.lineage.start(metre, 'human', job('另一个项目', {folder: written}), 'a');
  assert.equal(f.bindings.get(child.key).root, fs.realpathSync.native(other));
  assert.equal(f.lineage.lineage()[child.key].folder, fs.realpathSync.native(other));
  const same = await f.lineage.start(metre, 'human', job('跟父会话'), 'b');
  assert.equal(f.bindings.get(same.key).root, '/tmp/boss');
  await assert.rejects(f.lineage.start(metre, 'human', job('不存在', {folder: path.join(other, 'nope')}), 'c'), /文件夹不存在/);
  await assert.rejects(f.lineage.start(metre, 'human', job('相对路径', {folder: 'src/app'}), 'd'), /绝对路径/);
  if (process.platform === 'win32') {
    assert.equal(resolveFolder(other.toUpperCase().replace(/\\/g, '/')).toLowerCase(), fs.realpathSync.native(other).toLowerCase());
  }
  // 老模式的请求里 folder / model 不被读取（工具说明里也没有）。
  assert.deepEqual(Object.keys(normalizeChildRequest({...job(), folder: other})).sort(), ['context', 'initiation', 'mode', 'prompt', 'title']);
});

test('A1-7 pinkie_models：每项有档次、健康、看图、self；恰好一项 self；不发请求；最多 40 个', async t => {
  const health = new ModelHealth();
  health.callEnded({provider: 'mm', model: 'workbuddy/glm-5.3', outcome: 'completed'});
  health.callEnded({provider: 'mm', model: 'workbuddy/kimi-k2.7', outcome: 'error', errorMessage: '503 upstream'});
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('不该联网'); };
  try {
    const result = listModels({config: CONFIG, health, selfModel: SELF});
    assert.ok(result.models.every(item => ['top', 'mid', 'light'].includes(item.tier) && typeof item.healthy === 'boolean'
      && typeof item.vision === 'boolean' && typeof item.self === 'boolean' && typeof item.toolsStable === 'boolean'));
    assert.equal(result.models.filter(item => item.self).length, 1);
    assert.equal(result.models.find(item => item.self).id, SELF);
    assert.ok(!result.models.some(item => /imagen/.test(item.id)), '生图模型不列');
    const kimi = result.models.find(item => item.id.endsWith('kimi-k2.7'));
    assert.equal(kimi.healthy, false); assert.match(kimi.reason, /503/);
    assert.equal(result.models.at(-1), kimi, '不健康的排最后');
    assert.equal(result.models.find(item => item.id.endsWith('glm-5.3')).health, 'ok');
    assert.equal(listModels({config: CONFIG, selfModel: 'mm/claude-opus-5-5-high'}).models.filter(item => item.self).length, 1);
    const many = {models: {providers: {mm: {models: Array.from({length: 90}, (_, i) => ({id: `m-${i}${i % 3 ? '-flash' : ''}`}))}}}};
    const big = listModels({config: many, selfModel: 'mm/m-87'});
    assert.equal(big.models.length, 40); assert.ok(big.models.some(item => item.self)); assert.match(big.more, /还有 50 个/);
    assert.ok(big.models.filter(item => item.tier === 'light').length >= 13, '便宜的不被挤掉');
    assert.deepEqual(listModels({config: CONFIG, selfModel: SELF, tier: 'top'}).models.filter(item => !item.self).map(item => item.tier),
      ['top', 'top']);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(normalizeModelId('mm/workbuddy/Claude-Opus-5-5-High'), 'claude-opus-5-5');
  assert.equal(normalizeModelId('gemini-3.5-flash-extra-low'), 'gemini-3.5-flash');
  assert.equal(normalizeModelId('openrouter/qwen3-coder:free'), 'qwen3-coder');
  assert.equal(normalizeModelId('grok-4.20-0309-non-reasoning'), 'grok-4.20-0309');
  assert.equal(tierOf('mm/claude-opus-5-5-high'), 'top');
  assert.equal(tierOf('mm/gemini-3.5-flash-lite'), 'light');
  assert.equal(tierOf('mm/workbuddy/glm-5.3'), 'mid');
  assert.equal(catalog(CONFIG).length, 7);
  // 工具只在 Metre 里出现。
  const f = fixture(t), tools = [];
  registerMetreModelsTool({registerTool: (factory, options) => tools.push({factory, options})}, f.lineage);
  assert.equal(tools[0].options.name, 'pinkie_models');
  assert.equal(tools[0].factory({sessionKey: project}), null);
  const tool = tools[0].factory({sessionKey: metre});
  const out = await tool.execute('call', {});
  assert.equal(out.details.models.filter(item => item.self).length, 1);
  assert.match((await tool.execute('call', {tier: 'huge'})).content[0].text, /tier 只能是/);
});

test('A1-8 Baton / Virtuoso：默认派发；独做时两个派发工具不提供、注入【本轮：独做】；切回恢复；老模式不受影响', async t => {
  const f = fixture(t), tools = [];
  registerSessionLineage({on() {}, registerTool: (factory, options) => tools.push({factory, options}), logger: {warn() {}}},
    {...f.options, root: f.root + '-tools'});
  const named = name => tools.find(tool => tool.options.name === name);
  const prefs = f.prefs;
  // registerSessionLineage 用的是 options.prefs（同一个 SessionPrefs）。
  assert.equal(prefs.forSession(metre).dispatch, 'dispatch');
  assert.match(prefs.promptContext(metre), /【本轮：派发】$/);
  const start = named('pinkie_session_start').factory({sessionKey: metre});
  assert.deepEqual(start.parameters.required, ['title', 'prompt', 'initiation', 'mode']);
  assert.ok(start.parameters.properties.model && start.parameters.properties.folder);
  assert.deepEqual(start.parameters.properties.mode.enum, ['chat', 'project', 'ideas', 'learning', 'unrestricted']);
  assert.doesNotMatch(start.description, /只能在用户亲自发来的这一轮用/);
  assert.ok(named('pinkie_mode_ask').factory({sessionKey: metre}));
  prefs.setSession(metre, {dispatch: 'solo'});
  assert.equal(named('pinkie_session_start').factory({sessionKey: metre}), null);
  assert.equal(named('pinkie_mode_ask').factory({sessionKey: metre}), null);
  assert.ok(named('pinkie_session_list').factory({sessionKey: metre}), '看自己的子会话不算派发');
  assert.match(prefs.promptContext(metre), /【本轮：独做】$/);
  assert.doesNotMatch(prefs.promptContext(metre), /派发/);
  // 后端也守着（万一工具是更早一轮拿到的）。
  await assert.rejects(f.lineage.start(metre, 'human', job(), 'solo'), /Virtuoso/);
  await assert.rejects(f.lineage.ask(metre, 'human', {mode: 'ideas', question: '配色？', model: 'mm/workbuddy/glm-5.3'}, 'q'), /Virtuoso/);
  prefs.setSession(metre, {dispatch: 'dispatch'});
  assert.ok(named('pinkie_session_start').factory({sessionKey: metre}));
  assert.match(prefs.promptContext(metre), /【本轮：派发】$/);
  assert.throws(() => prefs.setSession(metre, {dispatch: 'baton'}), /dispatch（Baton）或 solo（Virtuoso）/);
  assert.throws(() => prefs.setSession(project, {dispatch: 'solo'}), /这个模式没有这个选项/);
  // 老模式：工具和说明原样。
  const old = named('pinkie_session_start').factory({sessionKey: project});
  assert.deepEqual(old.parameters.properties.mode.enum, ['chat', 'project', 'ideas', 'learning']);
  assert.match(old.description, /只能在用户亲自发来的这一轮用，一轮最多 3 个/);
  assert.equal(old.parameters.properties.model, undefined);
  assert.equal('dispatch' in prefs.forSession(project), false);
  assert.doesNotMatch(prefs.promptContext(project), /【本轮/);
});

test('A1-9 暂停派发：新开的被拒并说明，在跑的不受影响；取消后恢复；只有 Metre 能暂停', async t => {
  const f = fixture(t);
  const running = await f.lineage.start(metre, 'human', job('先开的'), 'a');
  assert.deepEqual(f.lineage.setPaused(metre, true), {ok: true, key: metre, paused: true});
  await assert.rejects(f.lineage.start(metre, 'human', job('暂停后'), 'b'), /用户暂停了派发/);
  await assert.rejects(f.lineage.ask(metre, 'human', {mode: 'ideas', question: '?', model: 'mm/workbuddy/glm-5.3'}, 'q'), /暂停了派发/);
  assert.ok(f.running.has(running.key));
  assert.ok(!f.calls.some(([m, p]) => m === 'chat.abort' && p.sessionKey === running.key));
  f.lineage.setPaused(metre, false);
  await f.lineage.start(metre, 'human', job('取消暂停后'), 'b');
  assert.throws(() => f.lineage.setPaused(project, true), /只有 Metre/);
  assert.throws(() => f.lineage.setPaused(running.key, true), /只有 Metre/);
});

test('A1-10 全停：Metre 这一轮和 3 个在跑的子会话都停下；不归档、不删除；记录完整', async t => {
  const f = fixture(t);
  const kids = [];
  for (let i = 0; i < 3; i++) kids.push(await f.lineage.start(metre, 'human', job('在跑' + i), 'k' + i));
  const done = await f.lineage.start(metre, 'human', job('已交回'), 'k3');
  await finishChild(f, done.key, '交回了');
  f.running.add(metre);
  const before = structuredClone(f.lineage.lineage());
  const started = Date.now();
  const result = await f.lineage.stopAll(metre);
  assert.ok(Date.now() - started < 15_000);
  assert.equal(result.ok, true); assert.equal(result.parentStopped, true); assert.equal(result.stopped, 3);
  assert.equal(f.running.size, 0);
  for (const kid of kids) assert.ok(f.calls.some(([m, p]) => m === 'chat.abort' && p.sessionKey === kid.key));
  assert.ok(!f.calls.some(([m, p]) => m === 'sessions.patch' && p.archived));
  assert.ok(!f.calls.some(([m]) => m === 'sessions.delete'));
  assert.deepEqual(f.lineage.lineage(), before);
  assert.deepEqual(result.children.map(item => [item.was, item.stopped]),
    [['running', true], ['running', true], ['running', true], ['done', false]]);
  assert.equal(result.children[0].model, 'mm/workbuddy/glm-5.3');
  assert.equal(f.lineage.state(metre).lastStop.children.length, 4);
  await assert.rejects(f.lineage.stopAll(project), /只有 Metre/);
});

test('A1-11 每份汇报都叫醒 Metre（不等其他子会话）；Metre 忙时到的 3 份合并成一次唤醒，三份都在', async t => {
  const f = fixture(t);
  const kids = [];
  for (let i = 0; i < 5; i++) kids.push(await f.lineage.start(metre, 'human', job('块' + i), 'k' + i));
  const wakes = () => f.sent.filter(item => item.sessionKey === metre && /^pinkie-session-wake-/.test(item.idempotencyKey));
  await finishChild(f, kids[0].key, '第一块的汇报');
  await f.lineage.drainParent(metre);
  assert.equal(wakes().length, 1, '其他四个还在跑，也叫醒');
  assert.match(f.lineage.prompt({}, {sessionKey: metre}).appendContext, /第一块的汇报/);
  // Metre 被叫醒后正在忙：这时到达三份。
  f.running.add(metre);
  for (const [i, kid] of kids.slice(1, 4).entries()) await finishChild(f, kid.key, `第 ${i + 2} 块的汇报`);
  assert.equal(await f.lineage.drainParent(metre), true, '忙的时候不叫');
  assert.equal(wakes().length, 1);
  f.running.delete(metre);
  await f.lineage.drainParent(metre);
  assert.equal(wakes().length, 2, '三份合并成一次');
  const injected = f.lineage.prompt({}, {sessionKey: metre}).appendContext;
  for (const n of [2, 3, 4]) assert.match(injected, new RegExp(`第 ${n} 块的汇报`));
  assert.match(injected, /"模型":"mm\/workbuddy\/glm-5.3"/);
  // 不封顶：再来三次单独的汇报，都叫醒（老模式到 3 次就不叫了）。
  f.running.delete(metre);
  for (let i = 0; i < 3; i++) {
    const kid = await f.lineage.start(metre, 'human', job('又一块' + i), 'm' + i);
    await finishChild(f, kid.key, '又一份' + i);
    await f.lineage.drainParent(metre);
    f.running.delete(metre);
  }
  assert.equal(wakes().length, 5);
});

test('A1-12 汇报卡片和 pinkie_session_list 带着子会话用的模型', async t => {
  const f = fixture(t);
  const kid = await f.lineage.start(metre, 'human', job('带模型', {model: 'mm/workbuddy/kimi-k2.7'}), 'a');
  const busy = await f.lineage.start(metre, 'human', job('还在跑'), 'b');
  await finishChild(f, kid.key, '做完了');
  const cards = (await f.lineage.cards(metre)).cards;
  assert.equal(cards.at(-1).model, 'mm/workbuddy/kimi-k2.7');
  const listed = (await f.lineage.list(metre)).children;
  assert.equal(listed.find(item => item.key === kid.key).model, 'mm/workbuddy/kimi-k2.7');
  assert.equal(listed.find(item => item.key === busy.key).model, 'mm/workbuddy/glm-5.3');
  assert.equal(f.lineage.lineage()[kid.key].model, 'mm/workbuddy/kimi-k2.7');
});

test('Metre 的 pinkie_mode_ask：可以问五个模式，模型规则同样生效', async t => {
  const f = fixture(t);
  f.lineage.askTimeoutMs = 10;
  await assert.rejects(f.lineage.ask(metre, 'human', {mode: 'chat', question: '今天吃什么'}, 'q1'), /必须写 model/);
  const pending = await f.lineage.ask(metre, 'human', {mode: 'unrestricted', question: '这段话怎么改', model: 'mm/workbuddy/glm-5.3'}, 'q2');
  assert.equal(pending.pending, true);
  assert.match(pending.message, /无限制模式那边还在想/);
  assert.match(f.sent.at(-1).message, /总控 Metre 替用户来问/);
  assert.match(pending.key, /^agent:unrestricted:pinkie-child:/);
});

test('chooseChildModel 的边界：没有目录时只按默认比较；目标模式没默认时不拦', () => {
  assert.throws(() => chooseChildModel({config: {}, selfModel: SELF, requested: 'x/y'}), /没有/);
  assert.deepEqual(chooseChildModel({config: {}, selfModel: SELF, targetAgent: 'project'}), {model: '', explicit: false});
  assert.throws(() => chooseChildModel({config: CONFIG, selfModel: SELF, targetAgent: 'learning'}), /必须写 model/);
});
