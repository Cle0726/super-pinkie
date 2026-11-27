// R2 每个聊天会话一个终端（briefs/program-1120/设计-R2.md）：纯 node 部分。
// 1. 服务端 WorkbenchContext.update 只收挂在本会话上的那一个终端。反例：去掉 sessionKey 过滤或改回 slice(0,3)，应红。
// 2. 界面侧对应表：按会话存、terminal.list 对账、每窗口 8 个、只关最久没看的空闲终端、全忙不关。反例：LRU 不看忙闲，应红。
// 3. 上报前打码 NAME=value（KEY / TOKEN / SECRET / PASSWORD / CREDENTIAL）。变量名和值全是假的。
// 4. 模型侧没有路径调到 terminal.input：模型跑命令走 I6 的 pinkie.shell.run。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {WorkbenchContext} from '../services/mode-architecture/workbench.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(repo, 'ui/injections/laolao-workbench-term.js');
const plain = value => JSON.parse(JSON.stringify(value));

function load() {
  const window = {sessionStorage: null};
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), {window}, {filename: SRC});
  return window.Pinkie.workbench.term;
}
const term = load();

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data};
}

test('服务端：只收本会话的终端，最多一个，别的会话的输出不进上下文', () => {
  const ctx = new WorkbenchContext({now: () => 1000});
  const A = 'agent:project:a', B = 'agent:project:b';
  ctx.update({key: B, root: '/r'}, {clientId: 'w1', active: true, terminals: [
    {sessionKey: A, sessionId: 'term-a', output: 'A 会话里敲的 secret-a'},
    {sessionKey: B, sessionId: 'term-b', output: 'B 的输出'},
    {sessionKey: B, sessionId: 'term-b2', output: 'B 的第二个'},
    {sessionId: 'term-nokey', output: '没带会话的旧上报'},
  ]});
  const got = ctx.sessions.get(B).get('w1').terminals;
  assert.deepEqual(got.map(t => t.sessionId), ['term-b']);
  assert.ok(!JSON.stringify(got).includes('secret-a'));
});

test('对应表：按会话存取，存进 pinkie.terminal.bySession.v1，重开窗口能读回', () => {
  const storage = memoryStorage();
  const reg = term.createRegistry({storage, now: () => 1});
  reg.set('agent:project:a', 't-a', {root: '/r', name: '会话 A'});
  reg.set('agent:project:b', 't-b', {root: '/r', name: '会话 B'});
  assert.equal(reg.get('agent:project:a').id, 't-a');
  assert.equal(reg.get('agent:project:b').id, 't-b');
  assert.ok(storage.data.has('pinkie.terminal.bySession.v1'));
  const again = term.createRegistry({storage});
  assert.equal(again.get('agent:project:a').id, 't-a');
  assert.equal(again.keyOf('t-b'), 'agent:project:b');
});

test('对应表：terminal.list 里没有的 id 被丢掉', () => {
  const reg = term.createRegistry({storage: memoryStorage()});
  reg.set('a', 't-a'); reg.set('b', 't-b');
  assert.deepEqual(plain(reg.reconcile(['t-b'])), ['a']);
  assert.equal(reg.get('a'), null);
  assert.equal(reg.get('b').id, 't-b');
});

test('LRU：第 9 个会话开终端时关掉最久没看的空闲那个，并出提示', () => {
  let t = 100000;
  const reg = term.createRegistry({storage: memoryStorage(), now: () => t});
  for (let i = 1; i <= 8; i++) { t += 1000; reg.set(`s${i}`, `t${i}`, {name: `会话${i}`}); }
  t += 1000; reg.touch('s1');
  t += 1000; reg.noteOutput('t2');
  const room = plain(reg.makeRoom('s9'));
  assert.deepEqual(room, {ok: true, evict: {key: 's3', id: 't3'}, notice: '已关闭 会话3 的终端（最久未用）'});
  assert.equal(reg.size(), 7);
});

test('LRU：全都在跑时不关，提示「终端开太多了，先关一个」', () => {
  const t = 100000;
  const reg = term.createRegistry({storage: memoryStorage(), now: () => t});
  for (let i = 1; i <= 8; i++) { reg.set(`s${i}`, `t${i}`); reg.noteOutput(`t${i}`); }
  assert.deepEqual(plain(reg.makeRoom('s9')), {ok: false, evict: null, notice: '终端开太多了，先关一个'});
  assert.equal(reg.size(), 8);
  assert.deepEqual(plain(reg.makeRoom('s1')), {ok: true, evict: null, notice: null});
});

test('原生报错落成一行提示，不弹框', () => {
  assert.equal(term.noticeForError(new Error('terminal session limit reached (24)')), '终端开太多了，先关一个');
  assert.equal(term.noticeForError(new Error('terminal unavailable: sandboxed')), '当前会话在沙箱里运行，终端不可用');
  assert.equal(term.noticeForError(new Error('something else')), null);
});

test('打码：NAME 含 KEY / TOKEN / SECRET / PASSWORD / CREDENTIAL 的 NAME=value 只留名字', () => {
  // 假变量名 + 拼出来的假值，不碰真实环境变量。
  const hidden = ['OPENAI_API_KEY', 'GH_TOKEN', 'db_password', 'My_Secret', 'AWS_CREDENTIALS_FILE'];
  const kept = ['PATH', 'HOME', 'LANG'];
  const fake = name => name + '=' + 'fake-' + name.length;
  const raw = [...hidden.map(fake), 'export ' + fake('GH_TOKEN'), '  ' + fake('NPM_TOKEN'), ...kept.map(fake), 'echo token is here', 'KEY='].join('\n');
  const want = [...hidden.map(n => n + '=***'), 'export GH_TOKEN=***', '  NPM_TOKEN=***', ...kept.map(fake), 'echo token is here', 'KEY='].join('\n');
  assert.equal(term.maskEnv(raw), want);
  assert.ok(!term.maskEnv(raw).includes('fake-14'), '打码后不留 OPENAI_API_KEY 的值');
});

test('模型侧没有路径调到 terminal.input（模型跑命令走 pinkie.shell.run）', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(!/['"`]terminal\.input['"`]/.test(src), '新模块不发 terminal.input');
  assert.match(src, /pinkie\.shell\.run/);
  const servicesDir = path.join(repo, 'services');
  const hits = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.(mjs|cjs|js)$/.test(e.name) && /['"`]terminal\.input['"`]/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(repo, p));
  } };
  walk(servicesDir);
  assert.deepEqual(hits, [], '服务端（模型工具）不调 terminal.input');
});
