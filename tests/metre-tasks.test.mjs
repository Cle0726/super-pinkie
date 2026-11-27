// L36 T3 #24「后台任务列表」（ui/injections/laolao-metre-tasks.js）的契约测试。
// 用极简假 DOM + 假工作台跑（照 tests/metre-pr-page.test.mjs）：只在 Metre 挂入口、点了开「后台任务」页并取 pinkie.work.status、
// 后台命令 / 协作 / 子任务三种都列出来且在跑的排前面、没有就写空状态、读不到给原因不假装为空、
// 只认当前会话的那一份、「看结果」走 pinkie.work.detail、不加定时器 / 观察器 / 全局名、登记在头片段和 metre 区域。
// 反例：去掉入口里的 Metre 判断、去掉空状态、去掉会话核对，各自的用例都会红（PR 说明里有实测）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SRC = read('ui/injections/laolao-metre-tasks.js');
const CSS = read('ui/injections/laolao-metre-tasks.css');
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.className = ''; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.dataset = {}; this.type = ''; this.title = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  fire(t) { for (const f of this.listeners[t] || []) f({stopPropagation() {}, preventDefault() {}}); }
  get text() { return this.textContent + this.children.map((c) => c.text).join(''); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  byClass(c) { return this.all((n) => n.className.split(/\s+/).includes(c)); }
  button(label) { return this.all((n) => n.tagName === 'BUTTON' && n.text === label)[0] || null; }
}

const KEY = 'agent:metre:main';
function env({mode = 'metre', status, detail, fail = false, key = KEY} = {}) {
  const calls = [], winListeners = {};
  let page = null, box = null, current = mode;
  const draw = () => { if (!page) return; box = new El('div'); page.render(box); };
  const handlers = {
    'pinkie.work.status': () => { if (fail) throw new Error('还没连上网关'); return typeof status === 'function' ? status() : status; },
    'pinkie.work.detail': (p) => (detail ? detail(p) : {found: true, output: '结果全文', sessionKey: KEY}),
  };
  const wb = {tabActions: new Map(), renders: 0, renderTabs() { this.renders++; }, state: {key},
    rpc: async (m, p) => { calls.push([m, JSON.parse(JSON.stringify(p))]); return handlers[m]?.(p); },
    openPage: async (id, title, icon, render) => { page = {id, title, icon, render}; draw(); },
    refreshPage: (id) => { if (page?.id === id) draw(); }};
  const doc = {documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? current : null)}, createElement: (t) => new El(t), addEventListener() {}};
  const win = {__pinkieWorkbench: wb, addEventListener: (t, f) => { (winListeners[t] ||= []).push(f); }};
  vm.runInNewContext(SRC, {window: win, document: doc, console});
  return {win, wb, calls, box: () => box, page: () => page, setMode: (m) => { current = m; },
    emit: (t) => { for (const f of winListeners[t] || []) f({}); }, api: () => win.Pinkie.metreTasks};
}

const NOW = Date.now();
const FULL = {
  sessionKey: KEY,
  background: [
    {id: 'bg-done', execId: 'e1', command: 'npm test', state: 'done', startedAt: NOW - 90_000, endedAt: NOW - 30_000, woke: true},
    {id: 'bg-run', execId: 'e2', command: 'npm run build -- --watch', state: 'running', startedAt: NOW - 65_000, endedAt: 0, woke: false},
  ],
  reasoning: {phase: 'idle', jobs: [{id: 'j1', label: '独立解答', model: 'qa/gpt-5', state: 'failed', summary: '超时', startedAt: NOW - 50_000, endedAt: NOW - 20_000, hasOutput: true}]},
  tier: {active: true, children: [{id: 'c1', roleLabel: '查资料', model: 'qa/sel', state: 'running', summary: '在翻文档', startedAt: NOW - 10_000, endedAt: 0, hasOutput: true}]},
  now: NOW,
};
const EMPTY = {sessionKey: KEY, background: [], reasoning: {phase: 'idle', jobs: []}, tier: {active: false, children: []}, now: NOW};

test('只在 Metre：标签栏挂一颗「后台任务」键，不在 Metre 不出也不开页；点了开「后台任务」页并取 pinkie.work.status', async () => {
  const e = env({status: FULL});
  const make = e.wb.tabActions.get('tasks');
  assert.equal(typeof make, 'function');
  assert.ok(e.wb.renders >= 1, '挂上后要请工作台重画标签栏');
  e.setMode('project');
  assert.equal(make(), null, '不在 Metre 不出');
  await e.api().open();
  assert.equal(e.page(), null, '不在 Metre 不开页');
  assert.deepEqual(e.calls, [], '不在 Metre 不问后台');
  e.setMode('metre');
  const b = make();
  assert.equal(b.tagName, 'BUTTON'); assert.equal(b.attrs['aria-label'], '后台任务');
  b.fire('click'); await flush();
  assert.equal(e.page().id, 'tasks'); assert.equal(e.page().title, '后台任务');
  assert.deepEqual(e.calls, [['pinkie.work.status', {}]], '会话键由工作台的 rpc 带上，这里不自己拼');
});

test('三种都列：在跑的排前面，再是失败、做完；每行写状态、是什么、在做什么、用时；入口键带在跑个数', async () => {
  const e = env({status: FULL});
  await e.api().open(); await flush();
  const rows = e.box().byClass('pk-mtask__row');
  assert.deepEqual(rows.map((r) => r.dataset.state), ['running', 'running', 'failed', 'done']);
  assert.deepEqual(rows.map((r) => r.dataset.kind), ['child', 'bg', 'job', 'bg'], '同一档里新开始的在上面');
  assert.match(rows[0].text, /在跑查资料 · sel已跑 0:10在翻文档/);
  assert.match(rows[1].text, /在跑后台命令已跑 1:05npm run build -- --watch/);
  assert.match(rows[2].text, /失败独立解答 · gpt-5用时 0:30超时/);
  assert.match(rows[3].text, /做完了后台命令用时 1:00npm test已接着做/);
  assert.match(e.box().text, /共 4 项：2 个在跑、1 个失败、1 个做完了/);
  const b = e.wb.tabActions.get('tasks')();
  assert.equal(b.attrs['aria-label'], '后台任务（2 个在跑）');
  assert.equal(b.byClass('pk-mtask__count')[0]?.text, '2');
});

test('没有后台任务：写「这个会话现在没有后台任务」，不画空列表；入口键不带数', async () => {
  const e = env({status: EMPTY});
  await e.api().open(); await flush();
  assert.match(e.box().text, /这个会话现在没有后台任务。/);
  assert.equal(e.box().byClass('pk-mtask__list').length, 0);
  assert.equal(e.wb.tabActions.get('tasks')().byClass('pk-mtask__count').length, 0);
});

test('读不到（断线 / 会话无效）：给原因，不假装「没有后台任务」；点「刷新」再问一次', async () => {
  const e = env({fail: true});
  await e.api().open(); await flush();
  assert.match(e.box().text, /读不到后台任务：还没连上网关/);
  assert.doesNotMatch(e.box().text, /没有后台任务。/);
  e.box().button('刷新').fire('click'); await flush();
  assert.equal(e.calls.filter((c) => c[0] === 'pinkie.work.status').length, 2);
});

test('只认当前会话：后台回的是别的会话、或换了会话，旧的那份不显示', async () => {
  const e = env({status: {...FULL, sessionKey: 'agent:metre:other'}});
  await e.api().open(); await flush();
  assert.equal(e.box().byClass('pk-mtask__row').length, 0, '别的会话的任务不进这一页');
  const e2 = env({status: FULL});
  await e2.api().open(); await flush();
  assert.equal(e2.box().byClass('pk-mtask__row').length, 4);
  e2.wb.state.key = 'agent:metre:next';
  e2.emit('pinkie:session-selected');
  e2.wb.refreshPage('tasks');
  assert.equal(e2.box().byClass('pk-mtask__row').length, 0, '换会话后不留上一个会话的列表');
  assert.match(e2.box().text, /还没取到状态，点「刷新」/);
});

test('「看结果」只给有结果的协作 / 子任务，走 pinkie.work.detail；再点收起；后台命令没有这个键', async () => {
  const e = env({status: FULL});
  await e.api().open(); await flush();
  const rows = () => e.box().byClass('pk-mtask__row');
  assert.deepEqual(rows().map((r) => Boolean(r.button('看结果'))), [true, false, true, false]);
  rows()[2].button('看结果').fire('click'); await flush();
  assert.deepEqual(e.calls.find((c) => c[0] === 'pinkie.work.detail')[1], {kind: 'job', id: 'j1'});
  assert.match(rows()[2].byClass('pk-mtask__detail')[0].text, /结果全文/);
  assert.equal(rows()[2].button('收起结果').attrs['aria-expanded'], 'true');
  rows()[2].button('收起结果').fire('click'); await flush();
  assert.equal(rows()[2].byClass('pk-mtask__detail').length, 0);
});

test('rows 是纯函数：缺字段不炸，状态归成在跑 / 失败 / 做完了三种', () => {
  const {rows} = env().api();
  assert.deepEqual(JSON.parse(JSON.stringify(rows(null))), []);
  const r = JSON.parse(JSON.stringify(rows({tier: {children: [{id: 'a', state: 'aborted'}, {id: 'b', state: 'queued'}, {id: 'c', state: 'ok'}]}})));
  assert.deepEqual(r.map((x) => [x.id, x.state]), [['b', 'running'], ['a', 'failed'], ['c', 'done']]);
});

test('不新增定时器、观察器和 window.__ 全局名，不轮询；CSS 不用 !important、只带 Metre 前缀；登记在头片段和 metre 区域', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setInterval|setTimeout|requestAnimationFrame|MutationObserver|ResizeObserver|IntersectionObserver/);
  assert.doesNotMatch(code, /window\.__(?!pinkieWorkbench)/);
  assert.doesNotMatch(SRC, /Claude|OpenClaw|Copilot|碧琪/i);
  assert.doesNotMatch(CSS, /!important/);
  for (const rule of CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((x) => x.trim()).filter(Boolean)) {
    assert.match(rule, /^html\[data-laolao-mode="metre"\] \.pk-mtask/, '每条规则都只在 Metre、只管本文件的类名：' + rule.slice(0, 80));
  }
  const head = read('ui/injections/laolao-head.fragment.html');
  const at = (n) => head.indexOf(`/${n}?v=@hash`);
  assert.ok(at('laolao-metre-tasks.css') > at('laolao-workbench.js') && at('laolao-metre-tasks.js') > at('laolao-metre-tasks.css'), '在工作台后面加载');
  const regions = JSON.parse(read('ui/injections/regions.json'));
  const metre = Object.values(regions.regions || regions).find((r) => r?.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-tasks.js') && metre.files.includes('laolao-metre-tasks.css'));
});
