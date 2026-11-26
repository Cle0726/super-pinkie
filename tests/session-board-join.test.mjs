// S6 第 2、3 步接上第 1 步：linux2 的数据层（laolao-session-board-data.js，#231）和 engines 的两种皮（laolao-session-board.js，#229）
// 按 laolao-head.fragment.html 的顺序装进同一个页面环境，用假网关验接线。不起浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (name) => fs.readFileSync(new URL(`../ui/injections/${name}`, import.meta.url), 'utf8');
const DATA = read('laolao-session-board-data.js');
const UI = read('laolao-session-board.js');
const HEAD = read('laolao-head.fragment.html');

function el(tag = 'div') {
  return {
    tag, className: '', type: '', dataset: {}, hidden: false, textContent: '', innerHTML: '', title: '', nextElementSibling: null,
    style: {setProperty() {}}, attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    append() {}, remove() { this.removed = true; }, focus() {},
    before(other) { other.nextElementSibling = this; this.prev = other; },
  };
}

function page({orderDataFirst = true, mode = 'chat', running = 2} = {}) {
  let clock = Date.UTC(2026, 10, 26, 12, 0, 0);
  const calls = [];
  const sessions = [
    ...Array.from({length: running}, (_, i) => ({key: `agent:project:s${i}`, label: `会话 ${i}`, status: 'running', hasActiveRun: true, updatedAt: clock})),
    {key: 'agent:main:idle', label: '闲着', status: 'done', updatedAt: clock - 3_600_000},
  ];
  const gwRequest = async (method, params) => {
    calls.push({method, params});
    if (method === 'sessions.list') return {sessions};
    if (method === 'sessions.usage') return {cost: 0.25};
    return [];
  };
  const opened = [];
  const controls = el('div');
  const filled = [];
  const window = new EventTarget();
  window.Pinkie = {};
  window.__laolaoSidebar = {gwRequest};
  window.__pinkieNativeBridge = {openSession: (key) => opened.push(key)};
  window.__pinkieMetreBoard = {isOpen: false, fill: (slot, node) => filled.push({slot, node})};
  const document = {
    readyState: 'complete', activeElement: null,
    documentElement: {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)},
    body: el('body'),
    addEventListener() {}, createElement: (tag) => el(tag),
    querySelector: (sel) => (sel === 'aside.sidebar .laolao-session-controls' ? controls : null),
  };
  class FakeDate extends Date { static now() { return clock; } }
  const ctx = vm.createContext({
    window, document, CustomEvent, Event, EventTarget, Promise, Date: FakeDate, Math, Number, String, Object, JSON, Array, Map, Set, Boolean, Error,
    setTimeout: () => 0, clearTimeout() {}, Element: class {},
  });
  for (const src of orderDataFirst ? [DATA, UI] : [UI, DATA]) vm.runInContext(src, ctx);
  const tick = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
  return {
    window, calls, opened, filled, controls, tick,
    pill: () => (controls.prev?.className === 'pk-sb-pill' ? controls.prev : null),
    advance: (ms) => { clock += ms; },
    fire: (type) => window.dispatchEvent(new Event(type)),
    lists: () => calls.filter((c) => c.method === 'sessions.list').length,
  };
}

test('头片段先装数据层再装界面，数据层登记在 sidebar 区域', () => {
  const data = HEAD.indexOf('/laolao-session-board-data.js?v=@hash');
  const ui = HEAD.indexOf('/laolao-session-board.js?v=@hash');
  assert.ok(data > 0 && ui > data, '数据层排在界面前面');
  const regions = JSON.parse(read('regions.json'));
  const owner = regions.regions.find((r) => (r.files || []).includes('laolao-session-board-data.js'));
  assert.equal(owner?.id, 'sidebar');
});

test('界面直接用数据层的现成实例：两种装载顺序都接得上（就绪事件），不包一层', () => {
  for (const orderDataFirst of [true, false]) {
    const p = page({orderDataFirst});
    const board = p.window.Pinkie.sessionBoard;
    for (const fn of ['start', 'stop', 'view', 'subscribe', 'open', 'usage', 'refreshBadge']) assert.equal(typeof board[fn], 'function', fn);
    assert.ok(p.pill(), `胶囊挂在快捷键那一组前面（数据层${orderDataFirst ? '先' : '后'}装）`);
    assert.ok(p.window.Pinkie.sessionBoardUi);
  }
});

test('看板关着：载入时一律不读；会话有变化后胶囊数字最多 5 秒读一次', async () => {
  const p = page({running: 2});
  await p.tick();
  assert.equal(p.calls.length, 0, '载入时不发请求');
  assert.equal(p.pill().hidden, true, '没读到之前 0 个在跑，不显示');
  p.fire('laolao:sessions-changed'); await p.tick();
  assert.equal(p.lists(), 1);
  assert.equal(p.pill().textContent, '在跑 2');
  assert.equal(p.pill().hidden, false);
  p.advance(2000); p.fire('laolao:sessions-changed'); await p.tick();
  assert.equal(p.lists(), 1, '5 秒内的变化不再读');
  p.advance(4000); p.fire('laolao:sessions-changed'); await p.tick();
  assert.equal(p.lists(), 2, '过了 5 秒再读');
});

test('Metre 总控台打开：数据层开始读，「全部会话」一栏画出数据层排好的行；关上就停，点行经原生桥跳过去', async () => {
  const p = page({mode: 'metre', running: 3});
  p.window.__pinkieMetreBoard.isOpen = true;
  p.fire('pinkie:metre-board-open'); await p.tick();
  const list = p.calls.find((c) => c.method === 'sessions.list');
  assert.deepEqual({...list.params}, {limit: 200, includeLastMessage: true});
  const last = p.filled.at(-1);
  assert.equal(last.slot, 'all');
  for (let i = 0; i < 3; i += 1) assert.match(last.node.innerHTML, new RegExp(`agent:project:s${i}`));
  assert.doesNotMatch(last.node.innerHTML, /agent:main:idle/, '一小时前做完的不出现');
  assert.equal(p.pill().textContent, '在跑 3', '开着时胶囊跟着数据层的 view');

  p.window.__pinkieMetreBoard.isOpen = false;
  p.fire('pinkie:metre-board-closed');
  const before = p.lists();
  p.window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: 'sessions.changed', payload: {sessionKey: 'agent:project:s0'}}}));
  await p.tick();
  assert.equal(p.lists(), before, '关上后网关事件不触发读列表');

  p.window.Pinkie.sessionBoard.open('agent:project:s1');
  assert.deepEqual(p.opened, ['agent:project:s1']);
  assert.deepEqual({...(await p.window.Pinkie.sessionBoard.usage('agent:project:s1'))}, {cost: 0.25});
});
