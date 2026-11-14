// 批 M · Metre 项目记忆（PLAN 6.2，ACCEPTANCE AM-1～AM-8）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CATEGORIES, MAX_ITEMS, MetreMemory, PROFILE_BUDGET, UNBOUND, USER, folderKey, normalizeFolder, registerMetreMemory}
  from '../services/mode-architecture/metre-memory.mjs';

function setup(t) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-mem-'));
  t.after(() => fs.rmSync(state, {recursive: true, force: true}));
  const folders = {};
  for (const name of ['A', 'B', 'C']) { folders[name] = path.join(state, 'work', name); fs.mkdirSync(folders[name], {recursive: true}); }
  // 同名不同路径
  folders.A2 = path.join(state, 'other', 'A'); fs.mkdirSync(folders.A2, {recursive: true});
  const bindingsFile = path.join(state, 'project-scope', 'bindings.json');
  fs.mkdirSync(path.dirname(bindingsFile), {recursive: true});
  const bind = (key, folder) => {
    let all = {}; try { all = JSON.parse(fs.readFileSync(bindingsFile, 'utf8')); } catch {}
    if (folder) all[key] = {root: folder}; else delete all[key];
    fs.writeFileSync(bindingsFile, JSON.stringify(all));
  };
  const hooks = {}, tools = [], methods = new Map();
  const api = {
    on: (name, fn) => (hooks[name] ??= []).push(fn),
    registerTool: (factory, opts) => tools.push({factory, name: opts.name}),
    registerGatewayMethod: (name, fn) => methods.set(name, fn),
    logger: {info() {}, warn() {}, error() {}},
  };
  let running = false;
  const store = registerMetreMemory(api, {root: path.join(state, 'metre-memory'), stateRoot: state, bindingsFile,
    childrenRunning: async () => running});
  const tool = key => tools.find(item => item.name === 'metre_memory').factory({sessionKey: key});
  const call = async (key, params) => {
    const result = await tool(key).execute('call-' + Math.random(), params);
    if (result.isError) throw new Error(result.content[0].text);
    return result.details;
  };
  const prompt = key => hooks.before_prompt_build.map(fn => fn({prompt: 'x'}, {sessionKey: key})).find(Boolean)?.appendSystemContext || '';
  const rpc = async (name, params) => {
    let out;
    await methods.get(name)({params, respond: (ok, payload, error) => { out = ok ? payload : {ok: false, error}; }});
    return out;
  };
  return {state, folders, bind, store, call, prompt, rpc, tool, hooks, setRunning: v => { running = v; }};
}

test('AM-3 same folder in different spellings is one key; same name elsewhere is another', () => {
  assert.equal(folderKey('F:\\Projects\\Demo', 'win32'), folderKey('f:/projects/demo/', 'win32'));
  assert.equal(folderKey('F:\\Projects\\Demo\\', 'win32'), folderKey('"f:\\PROJECTS\\demo"', 'win32'));
  assert.equal(folderKey('/f/Projects/Demo', 'win32'), folderKey('F:\\Projects\\Demo', 'win32'));
  assert.notEqual(folderKey('F:\\Projects\\Demo', 'win32'), folderKey('F:\\Other\\Demo', 'win32'));
  assert.equal(normalizeFolder('F:\\', 'win32'), 'f:/');
  // macOS / Linux 区分大小写
  assert.notEqual(folderKey('/Users/a/Demo', 'darwin'), folderKey('/Users/a/demo', 'darwin'));
  assert.equal(folderKey('/Users/a/Demo/', 'darwin'), folderKey('/Users/a/Demo', 'darwin'));
});

test('AM-1 each folder injects only its own entries', async t => {
  const env = setup(t);
  env.bind('agent:metre:a', env.folders.A);
  env.bind('agent:metre:b', env.folders.B);
  for (let i = 0; i < 5; i++) {
    await env.call('agent:metre:a', {action: 'remember', category: CATEGORIES[i], text: `甲项目第${i}条：用 pnpm 跑第${i}号脚本 alpha${i}`});
    await env.call('agent:metre:b', {action: 'remember', category: CATEGORIES[i], text: `乙项目第${i}条：用 cargo 跑 beta${i}`});
  }
  env.bind('agent:metre:a2', env.folders.A);   // A 里的新会话
  const a = env.prompt('agent:metre:a2');
  assert.match(a, /【项目档案：/);
  for (let i = 0; i < 5; i++) { assert.ok(a.includes(`alpha${i}`)); assert.ok(!a.includes(`beta${i}`)); }
  const b = env.prompt('agent:metre:b');
  for (let i = 0; i < 5; i++) { assert.ok(b.includes(`beta${i}`)); assert.ok(!b.includes(`alpha${i}`)); }
});

test('AM-2 twenty entries each, ten switches back and forth: no turn ever shows the other folder', async t => {
  const env = setup(t);
  const key = 'agent:metre:switch';
  for (const [name, tag] of [['A', 'apple'], ['B', 'berry']]) {
    env.bind(key, env.folders[name]);
    for (let i = 0; i < 20; i++) {
      await env.call(key, {action: 'remember', category: CATEGORIES[i % CATEGORIES.length], text: `${tag}${i} 号事实 ${'说明'.repeat(i % 3)} ${i * 7919}`});
    }
  }
  for (let round = 0; round < 10; round++) {
    for (const [name, mine, other] of [['A', 'apple', 'berry'], ['B', 'berry', 'apple']]) {
      env.bind(key, env.folders[name]);
      const text = env.prompt(key);
      assert.ok(text.includes(mine), `第 ${round} 轮 ${name} 没有自己的条目`);
      assert.ok(!text.includes(other), `第 ${round} 轮 ${name} 串进了另一个文件夹`);
      if (round > 0 || name === 'B') assert.match(text, /【项目已换】/);
      const recalled = await env.call(key, {action: 'recall', query: ''});
      assert.equal(recalled.items.length, 20);
      assert.ok(recalled.items.every(item => item.text.startsWith(mine)));
    }
  }
  // 同一个文件夹不换时不报「已换」
  assert.doesNotMatch(env.prompt(key), /【项目已换】/);
});

test('AM-4 remember cannot target another folder; recall from another project is marked and not copied', async t => {
  const env = setup(t);
  env.bind('agent:metre:a', env.folders.A);
  env.bind('agent:metre:b', env.folders.B);
  await env.call('agent:metre:b', {action: 'remember', category: 'decisions', text: '乙项目定了用 sqlite 存数据'});
  await assert.rejects(env.call('agent:metre:a', {action: 'remember', category: 'decisions', text: '想写到乙', folder: env.folders.B}), /只能写当前项目/);
  const other = await env.call('agent:metre:a', {action: 'recall', query: 'sqlite', folder: env.folders.B});
  assert.equal(other.fromOtherProject, true);
  assert.match(other.note, /来自另一个项目/);
  assert.match(other.items[0].from, /来自另一个项目/);
  const mine = await env.call('agent:metre:a', {action: 'recall', query: 'sqlite'});
  assert.equal(mine.items.length, 0);
  assert.ok(!env.prompt('agent:metre:a').includes('sqlite'));
  // 同名不同路径是另一个项目
  env.bind('agent:metre:a2', env.folders.A2);
  await env.call('agent:metre:a', {action: 'remember', category: 'overview', text: '甲是一个记账小程序'});
  assert.ok(!env.prompt('agent:metre:a2').includes('记账'));
});

test('AM-5 the project file stays under 1800 characters; the rest is found by recall', async t => {
  const env = setup(t);
  const key = 'agent:metre:big';
  env.bind(key, env.folders.C);
  for (let i = 0; i < 60; i++) {
    await env.call(key, {action: 'remember', category: CATEGORIES[i % CATEGORIES.length],
      text: `第${i}条 ${String(i).padStart(3, '0')}-${'事实细节'.repeat(8)}-${i * 104729}`});
  }
  const text = env.prompt(key);
  const profile = env.store.profile(env.store.keyFor(env.folders.C)).text;
  assert.ok([...profile].length <= PROFILE_BUDGET, `${[...profile].length}`);
  assert.match(profile, /共 60 条/);
  const shown = (text.match(/\[m-[0-9a-f]{8}\]/g) || []).length;
  assert.ok(shown > 5 && shown < 60, `${shown}`);
  const recalled = await env.call(key, {action: 'recall', query: '059-'});
  assert.equal(recalled.items.length, 1);
  // 没绑文件夹、没有记忆：不注入
  assert.equal(env.prompt('agent:metre:empty'), '');
});

test('AM-6 only Metre has metre_memory; Pinkie memory files are never touched', async t => {
  const env = setup(t);
  for (const agent of ['main', 'project', 'thinking', 'learning', 'unrestricted']) {
    assert.equal(env.tool(`agent:${agent}:x`), null, agent);
    assert.equal(env.prompt(`agent:${agent}:x`), '');
  }
  env.bind('agent:metre:a', env.folders.A);
  await env.call('agent:metre:a', {action: 'remember', category: 'commands', text: 'npm test 跑单测'});
  const written = [];
  (function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else written.push(path.relative(env.state, full));
  } })(env.state);
  assert.ok(written.filter(file => !file.startsWith('work') && !file.startsWith('other') && !file.startsWith('project-scope'))
    .every(file => file.startsWith('metre-memory')), written.join(', '));
  const source = fs.readFileSync(new URL('../services/mode-architecture/metre-memory.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from '\.\/memory\.mjs'/);
});

test('unbound sessions use their own pool; user-level preferences come after the project, ≤400', async t => {
  const env = setup(t);
  await env.call('agent:metre:free', {action: 'remember', category: 'open', text: '没绑文件夹时记的待办'});
  assert.match(env.prompt('agent:metre:free'), /没绑文件夹/);
  env.bind('agent:metre:a', env.folders.A);
  assert.ok(!env.prompt('agent:metre:a').includes('待办'));
  await env.call('agent:metre:a', {action: 'remember', scope: 'user', category: 'preferences', text: '回答用中文，结论先说'});
  await env.call('agent:metre:a', {action: 'remember', category: 'overview', text: '甲项目是官网'});
  const text = env.prompt('agent:metre:a');
  assert.ok(text.indexOf('甲项目是官网') < text.indexOf('结论先说'));
  assert.ok(env.prompt('agent:metre:free').includes('结论先说'));
  assert.equal(env.store.keyFor(''), UNBOUND);
  assert.equal(env.store.items(USER).length, 1);
});

test('similar entries in the same category point to update instead of a new one', async t => {
  const env = setup(t);
  env.bind('agent:metre:a', env.folders.A);
  const first = await env.call('agent:metre:a', {action: 'remember', category: 'commands', text: '跑测试用 npm test，大概两分钟'});
  await assert.rejects(env.call('agent:metre:a', {action: 'remember', category: 'commands', text: '跑测试用 npm test，大概三分钟'}), /update/);
  const updated = await env.call('agent:metre:a', {action: 'update', id: first.remembered.id, text: '跑测试用 npm test，大概三分钟'});
  assert.match(updated.updated.text, /三分钟/);
  await assert.rejects(env.call('agent:metre:a', {action: 'remember', category: 'commands', text: 'x'.repeat(401)}), /400/);
  await env.call('agent:metre:a', {action: 'forget', id: first.remembered.id});
  assert.equal((await env.call('agent:metre:a', {action: 'list'})).items.length, 0);
});

test('AM-8 every change is audited; at 300 the least useful unpinned entry goes, pinned ones stay', async t => {
  let clock = 1_000_000;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-mem-cap-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new MetreMemory(root, {now: () => ++clock});
  const key = 'k';
  const pinned = store.remember(key, {category: 'overview', text: '钉住的项目说明 zzz', confidence: 'guess', pinned: true});
  const guess = store.remember(key, {category: 'open', text: '最先写的推测 qqq', confidence: 'guess'});
  for (let i = 0; store.items(key).length < MAX_ITEMS; i++) {
    store.remember(key, {category: CATEGORIES[i % 9], text: `条目 ${i} ${i * 7907} ${'甲乙丙丁'.slice(0, i % 4)}`, confidence: 'verified'});
  }
  assert.equal(store.items(key).length, MAX_ITEMS);
  store.remember(key, {category: 'pitfalls', text: '第 301 条新坑 www', confidence: 'user'});
  const ids = store.items(key).map(item => item.id);
  assert.equal(ids.length, MAX_ITEMS);
  assert.ok(ids.includes(pinned.id), '钉住的不淘汰');
  assert.ok(!ids.includes(guess.id), '先淘汰没钉住、置信最低、最久没用的');
  store.edit(key, ids[5], {text: '改过的正文'}, {actor: 'user'});
  store.forget(key, ids[6], {actor: 'user'});
  const log = store.auditLog(key, 500);
  assert.ok(log.some(entry => entry.action === 'evict' && entry.id === guess.id));
  const edit = log.find(entry => entry.action === 'edit');
  assert.equal(edit.actor, 'user');
  assert.ok(edit.before.text !== edit.after.text);
  assert.ok(log.some(entry => entry.action === 'forget' && entry.before));
});

test('gateway pinkie.metre.memory: stats, list, search, pin, edit, delete with audit', async t => {
  const env = setup(t);
  env.bind('agent:metre:a', env.folders.A);
  const made = await env.call('agent:metre:a', {action: 'remember', category: 'decisions', text: '定了先做移动端'});
  await env.call('agent:metre:a', {action: 'remember', category: 'commands', text: '用 make dev 起服务'});
  const stats = await env.rpc('pinkie.metre.memory', {sessionKey: 'agent:metre:a'});
  assert.equal(stats.count, 2);
  assert.equal(stats.name, 'A');
  assert.equal(stats.known, 2);
  assert.equal(stats.byCategory.decisions, 1);
  assert.equal((await env.rpc('pinkie.metre.memory', {sessionKey: 'agent:metre:a', action: 'search', query: 'make'})).items.length, 1);
  assert.equal((await env.rpc('pinkie.metre.memory', {sessionKey: 'agent:metre:a', action: 'pin', id: made.remembered.id})).item.pinned, true);
  await env.rpc('pinkie.metre.memory', {sessionKey: 'agent:metre:a', action: 'edit', id: made.remembered.id, text: '定了先做桌面端'});
  await env.rpc('pinkie.metre.memory', {sessionKey: 'agent:metre:a', action: 'delete', id: made.remembered.id});
  const audit = await env.rpc('pinkie.metre.memory', {sessionKey: 'agent:metre:a', action: 'audit'});
  assert.deepEqual(audit.entries.map(entry => entry.action), ['remember', 'remember', 'pin', 'edit', 'forget']);
  assert.equal((await env.rpc('pinkie.metre.memory', {sessionKey: 'agent:project:x'})).ok, false);
});

test('finishing a piece of work reminds once next turn; not while children are still running', async t => {
  const env = setup(t);
  const key = 'agent:metre:r';
  const end = () => Promise.all(env.hooks.agent_end.map(fn => fn({}, {sessionKey: key})));
  const tool = name => env.hooks.after_tool_call.forEach(fn => fn({toolName: name}, {sessionKey: key}));
  await end();
  assert.doesNotMatch(env.prompt(key), /【记一下】/);   // 没动手不提醒
  tool('exec');
  env.setRunning(true); await end();
  assert.doesNotMatch(env.prompt(key), /【记一下】/);   // 子会话还在跑
  env.setRunning(false); await end();
  assert.match(env.prompt(key), /【记一下】/);
  assert.doesNotMatch(env.prompt(key), /【记一下】/);   // 只提醒一次
});
