import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {SessionSearch, registerSessionSearch} from '../services/mode-architecture/session-search.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-session-search-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const entries = {};
  const access = {list: async () => ({entries, dir})};
  const search = new SessionSearch({access});
  function add(key, rows, options = {}) {
    const sessionId = 'id-' + Object.keys(entries).length;
    entries[key] = {sessionId, label: '普通会话标题', updatedAt: 10, ...options};
    fs.writeFileSync(path.join(dir, sessionId + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  return {dir, entries, access, search, add};
}
const ask = (query, extra = {}) => ({agentId: 'main', mode: 'chat', query, ...extra});
const msg = (id, parentId, role, content, extra = {}) => ({type: 'message', id, parentId, message: {role, content, ...extra}});

test('searches the requested mode, title and visible text, with archived opt-in and usable highlight ranges', async t => {
  const f = fixture(t);
  f.add('agent:main:visible', [msg('a', null, 'user', '前文'.repeat(22) + '深海计划' + '后文'.repeat(22))], {updatedAt: 200});
  f.add('agent:main:archived', [msg('b', null, 'assistant', [{type: 'thinking', thinking: '秘密'}, {type: 'text', text: '完成深海计划'}])], {archivedAt: 123, updatedAt: 100});
  f.add('agent:project:other', [msg('c', null, 'user', '深海计划跨模式')], {updatedAt: 300});
  f.add('agent:main:title', [], {label: '深海计划标题', updatedAt: 50});
  const visible = await f.search.search(ask('深海计划'));
  assert.equal(visible.ok, true);
  assert.deepEqual(visible.results.map(r => r.key), ['agent:main:visible', 'agent:main:title']);
  assert.equal(visible.results[0].entryId, 'a');
  assert.equal(visible.results[0].snippet.slice(...visible.results[0].hitRanges[0]), '深海计划');
  assert.equal(visible.results[1].entryId, undefined);
  const all = await f.search.search(ask('深海计划', {includeArchived: true, limit: 2}));
  assert.deepEqual(all.results.map(r => r.key), ['agent:main:visible', 'agent:main:archived']);
  assert.equal(all.results[1].archived, true);
  assert.equal((await f.search.search(ask('深海计划', {mode: 'project'}))).ok, false);
  f.add('agent:thinking:visible', [msg('t', null, 'user', '想法模式关键词')]);
  for (const mode of ['thinking', 'ideas']) {
    const ideas = await f.search.search({agentId: 'thinking', mode, query: '想法模式关键词'});
    assert.equal(ideas.results[0].key, 'agent:thinking:visible');
  }
});

test('only searches the selected branch and excludes tools, thinking and internal messages', async t => {
  const f = fixture(t);
  f.add('agent:main:branch', [
    msg('a', null, 'user', '普通第一轮'),
    msg('b', 'a', 'assistant', '旧版本标记'),
    msg('c', 'b', 'user', '旧分支标记'),
    {type: 'leaf', id: 'l1', parentId: 'c', targetId: 'a'},
    msg('d', 'a', 'user', '新分支标记'),
    msg('e', 'd', 'toolResult', '工具机密标记'),
    msg('f', 'e', 'assistant', [{type: 'thinking', thinking: '思考机密标记'}, {type: 'text', text: '正常答复'}]),
    msg('g', 'f', 'user', '[pinkie-watchdog] 内部机密标记'),
  ]);
  assert.equal((await f.search.search(ask('旧分支标记'))).results.length, 0);
  assert.equal((await f.search.search(ask('新分支标记'))).results[0].entryId, 'd');
  for (const term of ['工具机密标记', '思考机密标记', '内部机密标记']) {
    assert.equal((await f.search.search(ask(term))).results.length, 0, term);
  }
  f.add('agent:main:flat', [{type: 'message', message: {role: 'user', content: '旧格式可搜索'}}]);
  assert.equal((await f.search.search(ask('旧格式可搜索'))).results[0].key, 'agent:main:flat');
});

test('literal queries and invalid inputs do not leak paths or widen a search', async t => {
  const f = fixture(t);
  f.add('agent:main:literal', [msg('a', null, 'user', 'Unicode 🐴 A+B [x] a+b')]);
  const result = await f.search.search(ask('a+b'));
  assert.deepEqual(result.results[0].hitRanges.map(range => result.results[0].snippet.slice(...range)), ['A+B', 'a+b']);
  assert.deepEqual(await f.search.search(ask('   ')), {ok: true, results: []});
  for (const params of [ask('x', {limit: 0}), ask('x', {includeArchived: 'yes'}), ask('x', {agentId: 'project'}), ask('x'.repeat(513))]) {
    const response = await f.search.search(params);
    assert.equal(response.ok, false);
    assert.match(response.error, /[\u4e00-\u9fff]/u);
  }
  f.entries['agent:main:outside'] = {sessionId: 'outside', sessionFile: '../private.jsonl', label: '普通会话标题'};
  assert.equal((await f.search.search(ask('private'))).results.length, 0);
  const broken = new SessionSearch({access: {list: async () => {throw Error('/private/secret');}}});
  assert.deepEqual(await broken.search(ask('x')), {ok: false, error: '搜索暂时不可用，请稍后重试'});
  const slow = new SessionSearch({access: {list: () => new Promise(resolve => setTimeout(() => resolve({entries: {}, dir: f.dir}), 50))}, timeoutMs: 5});
  assert.match((await slow.search(ask('x'))).error, /搜索超时/);
});

test('registers the documented gateway method and returns Chinese errors in the payload', async t => {
  const f = fixture(t); const methods = {};
  registerSessionSearch({registerGatewayMethod(name, fn) { methods[name] = fn; }}, {titles: {access: f.access}});
  let answer;
  await methods['pinkie.session.search']({params: ask('x', {mode: 'project'}), respond: (ok, value) => { answer = {ok, value}; }});
  assert.equal(answer.ok, true);
  assert.equal(answer.value.ok, false);
  assert.match(answer.value.error, /当前模式/);
});

test('streams 500 ordinary sessions within the search budget', async t => {
  const f = fixture(t);
  for (let i = 0; i < 500; i++) f.add(`agent:main:session-${i}`, [msg(`m${i}`, null, 'user', `搜索目标 ${i}`)], {updatedAt: i + 1});
  const start = performance.now();
  const response = await f.search.search(ask('搜索目标', {limit: 500}));
  assert.equal(response.ok, true, response.error);
  assert.equal(response.results.length, 500);
  assert.ok(performance.now() - start <= 1500);
});
