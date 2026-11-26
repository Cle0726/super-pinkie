// R2 每个聊天会话一个终端（briefs/program-1120/设计-R2.md）第二步接线：纯 node 部分，不起浏览器。
// 测的是 laolao-workbench-term.js 里工作台真正调用的三块：createContext（终端现场 → 上报）、createController / createSession（停放 / 接回 / 新开 / 腾位置）。
// 反例（对应设计第六节）：
//   1. 同一文件夹两个会话 A / B 各自一个终端，A → B → A 时 A 走 attach。退回「按 root 存」应红。
//   2. 上报：B 的快照里没有 A 的输出。恢复 :468-471「同 root 的终端改 key 到新会话」应红。
//   3. 满 8 个时关最久没看的空闲那个（terminal.close）；全忙不关、给提示。
//   4. terminal.list 里没有的 id 恢复时丢掉，面板显示「打开终端」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(repo, 'ui/injections/laolao-workbench-term.js');
const BENCH = path.join(repo, 'ui/injections/laolao-workbench.js');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function memoryStorage() {
  const data = new Map();
  return {getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data};
}
function load(storage = memoryStorage()) {
  const window = {sessionStorage: storage};
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), {window}, {filename: SRC});
  return window.Pinkie.workbench.term;
}
// 假网关：只记 terminal.* 调用；live 是还活着的原生终端。
function fakeGateway(live = new Set()) {
  const calls = [];
  const request = async (method, params = {}) => {
    calls.push([method, params.sessionId || '']);
    if (method === 'terminal.list') return {sessions: [...live].map(sessionId => ({sessionId}))};
    if (method === 'terminal.close') { live.delete(params.sessionId); return {ok: true}; }
    return {};
  };
  return {calls, live, request};
}

test('同一文件夹两个会话各自一个终端；A → B → A 时 A 接回（attach），不新开、不串到 B', async () => {
  const storage = memoryStorage();
  const term = load(storage);
  const gw = fakeGateway();
  const session = term.createSession({request: gw.request, storage, nameOf: k => k});
  const A = 'agent:project:a', B = 'agent:project:b', root = '/work/proj';

  assert.deepEqual(plain(session.view(A)), {busy: true, notice: null}, '先查对应表，查的时候按钮不可点');
  await tick();
  assert.deepEqual(plain(session.view(A)), {busy: false, notice: null}, 'A 还没有终端：显示「打开终端」，不自动开');
  session.start(A); await tick(); await tick();
  assert.equal(session.view(A), null, '点了才挂组件');
  assert.equal(storage.getItem(term.PANEL_KEY), '[]', 'PANEL_KEY 写空：组件自己新开一个');
  gw.live.add('t-a');
  const cd = session.control.opened(A, root, {sessionId: 't-a', cwd: '/home/u', shell: '/bin/zsh'});
  assert.equal(cd.text, "cd -- '/work/proj' && clear\r", 'cd 加引号');
  session.park(A, 't-a', root);

  session.view(B); await tick();
  assert.deepEqual(plain(session.view(B)), {busy: false, notice: null}, 'B 和 A 同一文件夹，但 B 没有自己的终端');
  session.start(B); await tick(); await tick();
  assert.equal(session.view(B), null);
  assert.equal(storage.getItem(term.PANEL_KEY), '[]', 'B 不接 A 的终端');
  gw.live.add('t-b');
  session.control.opened(B, root, {sessionId: 't-b', cwd: root, shell: '/bin/zsh'});
  session.park(B, 't-b', root);

  session.view(A); await tick();
  assert.equal(session.view(A), null, '切回 A：直接挂');
  assert.equal(storage.getItem(term.PANEL_KEY), '["t-a"]', '组件拿 A 原来那个去 attach');
  assert.equal(session.control.registry.get(B).id, 't-b');
  assert.notEqual(session.control.registry.get(A).id, session.control.registry.get(B).id);
  assert.ok(!gw.calls.some(([m]) => m === 'terminal.close'), '切会话只停放，不关');
});

test('terminal.list 里没有的 id 恢复时丢掉，面板回到「打开终端」', async () => {
  const storage = memoryStorage();
  const term = load(storage);
  const gw = fakeGateway(new Set(['t-b']));
  const session = term.createSession({request: gw.request, storage});
  session.park('a', 't-a', '/r');   // t-a 已被原生 reaper 回收
  session.park('b', 't-b', '/r');
  session.view('a'); await tick();
  assert.deepEqual(plain(session.view('a')), {busy: false, notice: null});
  assert.equal(session.control.registry.get('a'), null);
  assert.equal(session.control.registry.get('b').id, 't-b');
});

test('满 8 个时关掉最久没看的空闲那个并提示；全在跑时不关，只提示', async () => {
  let t = 100000;
  const storage = memoryStorage();
  const term = load(storage);
  const gw = fakeGateway();
  const registry = term.createRegistry({storage, now: () => t});
  const control = term.createController({request: gw.request, storage, registry, nameOf: k => '会话' + k.slice(1)});
  for (let i = 1; i <= 8; i++) { t += 1000; gw.live.add(`t${i}`); control.park(`s${i}`, `t${i}`, '/r'); }
  t += 1000; registry.touch('s1');
  assert.deepEqual(plain(await control.open('s9')), {ok: true, notice: '已关闭 会话2 的终端（最久未用）', ids: []});
  assert.deepEqual(gw.calls.filter(([m]) => m === 'terminal.close'), [['terminal.close', 't2']]);

  const gw2 = fakeGateway();
  const busy = term.createRegistry({storage: memoryStorage(), now: () => t});
  const control2 = term.createController({request: gw2.request, storage: memoryStorage(), registry: busy});
  for (let i = 1; i <= 8; i++) { gw2.live.add(`t${i}`); control2.park(`s${i}`, `t${i}`); control2.noteOutput(`t${i}`); }
  assert.deepEqual(plain(await control2.open('s9')), {ok: false, notice: '终端开太多了，先关一个', ids: []});
  assert.equal(gw2.calls.filter(([m]) => m === 'terminal.close').length, 0);
});

test('上报：B 的快照里没有 A 的输出；同一个终端换了会话就从头记（反例：恢复 :468-471 改 key）', () => {
  const term = load();
  let t = 1;
  const ctx = term.createContext({now: () => ++t});
  const A = 'agent:project:a', B = 'agent:project:b', root = '/r';
  ctx.adopt('t-a', A, root, root, '');
  ctx.input('t-a', 'echo hi\r');
  // 用户敲 env：每个变量独占一行（打码只认行首的 NAME=value，口径见 laolao-workbench-term.js maskEnv）
  ctx.event('terminal.data', {sessionId: 't-a', data: 'A 的输出\r\nGH_TOKEN=fake-a\r\n'});
  ctx.adopt('t-b', B, root, root, '');
  ctx.event('terminal.data', {sessionId: 't-b', data: 'B 的输出'});
  const a = plain(ctx.snapshot(A, root)), b = plain(ctx.snapshot(B, root));
  assert.deepEqual(a.map(x => x.sessionId), ['t-a']);
  assert.equal(a[0].command, 'echo hi');
  assert.match(a[0].output, /GH_TOKEN=\*\*\*/, '上报前打码');
  assert.ok(!a[0].output.includes('fake-a'));
  assert.equal(a[0].sessionKey, A, '服务端按 sessionKey 只收本会话的');
  assert.deepEqual(b.map(x => x.sessionId), ['t-b']);
  assert.ok(!JSON.stringify(b).includes('A 的输出'));
  // 同一个终端 id 被别的会话接上：不能把 A 的输出带过去
  ctx.adopt('t-a', B, root, root, '');
  // 接上后 t-a 再有输出：它成了 B 最新的终端（只报一个），旧的 A 输出不能跟着进 B 的上报
  ctx.event('terminal.data', {sessionId: 't-a', data: 'B 接上后的输出'});
  const b2 = plain(ctx.snapshot(B, root));
  assert.deepEqual(b2.map(x => x.sessionId), ['t-a']);
  assert.match(b2[0].output, /B 接上后的输出/);
  assert.ok(!JSON.stringify(b2).includes('A 的输出'), '换了会话从头记，不带 A 的输出');
  assert.ok(!JSON.stringify(b2).includes('echo hi'), '也不带 A 敲的命令');
  assert.deepEqual(plain(ctx.snapshot(A, root)), []);
});

test('工作台不再按项目文件夹存终端，也不在切会话时改终端的 key', () => {
  const src = fs.readFileSync(BENCH, 'utf8');
  assert.doesNotMatch(src, /store\.set\('term\.'/, '不再按 root 存终端 id');
  assert.doesNotMatch(src, /item\.key\s*=\s*key/, '不再把同 root 的终端改到新会话上（:468-471）');
  assert.doesNotMatch(src, /openclaw\.terminal\.sessions\.v1/, 'PANEL_KEY 只在 laolao-workbench-term.js 里写');
  assert.match(src, /if \(state\.key !== key\) parkTerminal\(state\.key, state\.root\)/, '切会话就停放，不只在换文件夹时');
});
