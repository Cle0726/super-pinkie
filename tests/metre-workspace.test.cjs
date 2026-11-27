// 第六批（m5 线）· S1 会话筛选、K2 Esc 停住 / 连按清空、K3 会话快捷键 —— 契约测试，不起浏览器。
// 加载真实的 ui/injections/laolao-metre-workspace.js 到 vm 沙盒，用最小的假 DOM 断言：
// 按下去碰了哪个原生部件（停止键、会话行链接、输入框），<html> 上挂了什么，样式表靠什么藏行。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INJ = path.join(ROOT, 'ui/injections');
const JS = 'laolao-metre-workspace.js';
const CSS = 'laolao-metre-workspace.css';
const read = (file) => fs.readFileSync(path.join(INJ, file), 'utf8');

const LINK = 'a.sidebar-recent-session__link';
const MARK = {
  running: '.pinkie-session-status--running',
  waiting: '.pinkie-session-status--waiting',
  error: '.pinkie-session-status--error',
  unread: '.pinkie-session-unread',
};

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.parentElement = null;
    this.clicks = 0;
    this.focused = false;
  }
  get classList() {
    const self = this;
    const list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (...c) => { self.className = [...new Set([...list(), ...c])].join(' '); },
      remove: (...c) => { self.className = list().filter((x) => !c.includes(x)).join(' '); },
    };
  }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter((c) => c !== this); this.parentElement = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  click() { this.clicks += 1; for (const fn of this.listeners.click || []) fn({}); }
  focus() { this.focused = true; }
  contains(n) { for (let x = n; x; x = x.parentElement) if (x === this) return true; return false; }
  getBoundingClientRect() { return {left: 12, bottom: 40, width: 200, height: 28}; }
  getClientRects() { return [1]; }
  matches(sel) {
    if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => this.classList.contains(c));
    const attr = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
    if (attr) return this.getAttribute(attr[1]) === attr[2];
    return this.tagName === sel.toUpperCase();
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel) { return this.all().find((n) => n.matches(sel)) || null; }
  querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); }
}

function fakeRow({active = false, marks = [], part = false, visible = true} = {}) {
  const link = {clicks: 0, click() { this.clicks += 1; }};
  const cls = ['sidebar-recent-session', 'session-row-host'];
  if (active) cls.push('sidebar-recent-session--active');
  if (part) cls.push('pinkie-session-part');
  return {
    link,
    classList: {contains: (c) => cls.includes(c)},
    querySelector: (sel) => (sel === LINK ? link : marks.includes(sel) ? {} : null),
    getClientRects: () => (visible ? [1] : []),
  };
}

function sandbox({mode = 'metre', platform = 'Win32'} = {}) {
  const attrs = {'data-laolao-mode': mode};
  const documentElement = {
    getAttribute: (k) => attrs[k] ?? null,
    hasAttribute: (k) => k in attrs,
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
  };
  const controls = new FakeEl('div');
  controls.className = 'laolao-session-controls';
  const body = new FakeEl('body');
  const env = {attrs, controls, body, rows: [], layers: [], stop: null, textarea: null, now: 1_000_000, docListeners: {}, winListeners: {}, winCapture: {},
    palette: null, targets: {}, store: new Map()};
  const document = {
    documentElement,
    body,
    createElement: (tag) => new FakeEl(tag),
    addEventListener: (t, fn) => (env.docListeners[t] ??= []).push(fn),
    removeEventListener: () => {},
    get activeElement() { return null; },
    querySelector(sel) {
      if (sel === 'aside.sidebar .laolao-session-controls') return env.controls;
      if (sel === 'aside.sidebar .pk-metre-nav--filter') return env.controls.querySelector('.pk-metre-nav--filter');
      if (sel === '.agent-chat__input .chat-send-btn--stop') return env.stop;
      if (sel === '.agent-chat__input textarea') return env.textarea;
      if (sel === 'openclaw-command-palette') return env.palette;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '#laolao-session-manager .session-row-host') return env.rows;
      if (sel.includes('.slash-menu')) return env.layers;
      if (sel === '.agent-chat__input textarea') return env.textarea ? [env.textarea] : [];
      if (sel === '.pk-metre-nav--filter') return env.controls.querySelectorAll('.pk-metre-nav--filter');
      return env.targets[sel] || [];
    },
  };
  const window = {
    navigator: {platform},
    addEventListener: (t, fn, opt) => { (env.winListeners[t] ??= []).push(fn); if (opt === true || opt?.capture) (env.winCapture[t] ??= []).push(fn); },
    localStorage: {getItem: (k) => env.store.get(k) ?? null, setItem: (k, v) => env.store.set(k, String(v))},
  };
  const ctx = {
    window, document, console, JSON, Object, Number, String, Boolean, Array, Set, Map,
    Date: {now: () => env.now},
    Event: class { constructor(type, init) { this.type = type; this.bubbles = Boolean(init?.bubbles); } },
    setTimeout: (fn) => { fn(); return 1; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(JS), ctx, {filename: JS});
  env.api = window.Pinkie.metreWorkspace;
  env.window = window;
  return env;
}

function key(init) {
  return {
    key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    isComposing: false, keyCode: 0, target: null, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...init,
  };
}

// ---------- S1 会话筛选 ----------
test('S1: in Metre a 「筛选」 entry joins the sidebar controls as a pk-metre-nav button and survives a second ensure()', () => {
  const env = sandbox();
  const btns = env.controls.querySelectorAll('.pk-metre-nav--filter');
  assert.equal(btns.length, 1);
  const btn = btns[0];
  assert.ok(btn.classList.contains('pk-metre-nav'), '带 pk-metre-nav：会话列表重画时和「总谱」一样被留住');
  assert.ok(btn.classList.contains('pinkie-sidebar-entry'));
  assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(btn.querySelector('span').textContent, '筛选');
  env.api.ensure();
  assert.equal(env.controls.querySelectorAll('.pk-metre-nav--filter').length, 1, '不会重复加');
});

test('S1: other modes get no filter button and never keep a filter attribute', () => {
  const env = sandbox({mode: 'project'});
  assert.equal(env.controls.querySelectorAll('.pk-metre-nav--filter').length, 0);
  assert.equal(env.api.setFilter('running'), '');
  assert.equal('data-pk-mw-filter' in env.attrs, false);
});

test('S1: choosing a filter marks <html>, relabels the button; counts come from the markers the session list already drew', () => {
  const env = sandbox();
  env.rows = [
    fakeRow({marks: [MARK.running]}),
    fakeRow({marks: [MARK.waiting, MARK.unread]}),
    fakeRow({marks: [MARK.unread]}),
    fakeRow({marks: []}),
    fakeRow({marks: [MARK.running], part: true}), // 派发到别的模式的子会话行不算
  ];
  assert.deepEqual({...env.api.counts()}, {'': 4, running: 1, waiting: 1, error: 0, unread: 2});
  assert.equal(env.api.setFilter('unread'), 'unread');
  assert.equal(env.attrs['data-pk-mw-filter'], 'unread');
  const btn = env.controls.querySelector('.pk-metre-nav--filter');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(btn.querySelector('span').textContent, '筛选 · 未读');
  assert.equal(env.api.setFilter('bogus'), '', '不认识的值回到全部');
  assert.equal('data-pk-mw-filter' in env.attrs, false);
});

test('S1: the menu lists 全部 / 在跑 / 等你回复 / 未读 / 上一轮出错 with counts; picking one sets it and closes', () => {
  const env = sandbox();
  env.rows = [fakeRow({marks: [MARK.error]}), fakeRow()];
  const btn = env.controls.querySelector('.pk-metre-nav--filter');
  btn.click();
  const menu = env.body.querySelector('.pk-mw-filter-menu');
  assert.ok(menu, '点了出菜单');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const items = menu.querySelectorAll('.pk-mw-filter-menu__item');
  assert.deepEqual(items.map((i) => i.querySelector('.pk-mw-filter-menu__label').textContent), ['全部会话', '在跑', '等你回复', '未读', '上一轮出错']);
  assert.deepEqual(items.map((i) => i.querySelector('.pk-mw-filter-menu__count').textContent), ['2', '0', '0', '0', '1']);
  assert.ok(items.every((i) => i.getAttribute('role') === 'menuitemradio'));
  items[4].click();
  assert.equal(env.attrs['data-pk-mw-filter'], 'error');
  assert.equal(env.body.querySelector('.pk-mw-filter-menu'), null, '选完收起');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.ok(btn.focused, '焦点回到按键');
});

test('S1: Esc with the filter menu open closes only the menu, before the sidebar drawer hears it (1024 / 820 drawer)', () => {
  const env = sandbox();
  const btn = env.controls.querySelector('.pk-metre-nav--filter');
  // 侧栏在 document 捕获阶段一听到 Esc 就收抽屉；本文件必须挂在 window 捕获阶段，才能先拦下来。
  assert.ok((env.winCapture.keydown || []).includes(env.api.menuEscape), 'Esc 处理挂在 window 的捕获阶段');
  assert.equal(env.api.menuEscape(key({key: 'Escape'})), false, '菜单没开时不拦 Esc');
  btn.click();
  assert.ok(env.body.querySelector('.pk-mw-filter-menu'));
  let stopped = false;
  const ev = key({key: 'Escape', stopPropagation() { stopped = true; }});
  assert.equal(env.api.menuEscape(ev), true);
  assert.ok(stopped, '停止传播：抽屉听不到这一下');
  assert.equal(ev.defaultPrevented, true);
  assert.equal(env.body.querySelector('.pk-mw-filter-menu'), null, '菜单关了');
  assert.ok(btn.focused, '焦点回到筛选键');
  assert.equal(env.api.menuEscape(key({key: 'Escape'})), false, '再按一次交给别人（这时才收抽屉）');
});

test('S1: the stylesheet hides only rows (and emptied groups) without the chosen marker, Metre only, no !important', () => {
  const css = read(CSS);
  assert.equal(/!\s*important/i.test(css), false);
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  for (const [id, mark] of Object.entries(MARK)) {
    const row = `html[data-laolao-mode="metre"][data-pk-mw-filter="${id}"] #laolao-session-manager .session-row-host:not(.pinkie-session-part):not(:has(${mark}))`;
    const group = `html[data-laolao-mode="metre"][data-pk-mw-filter="${id}"] #laolao-session-manager .laolao-group:not(:has(${mark}))`;
    for (const sel of [row, group]) {
      const at = flat.indexOf(sel);
      assert.ok(at >= 0, `缺少规则：${sel}`);
      assert.match(flat.slice(at, flat.indexOf('}', at)), /\{ ?display: none;/);
    }
  }
  for (const rule of flat.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean)) {
    for (const sel of rule.split(',').map((s) => s.trim())) {
      assert.ok(sel.startsWith('html[data-laolao-mode="metre"]') || sel.startsWith('html:not([data-laolao-mode="metre"])'), `只对 Metre 生效：${sel}`);
    }
  }
});

// ---------- K2 Esc ----------
test('K2: Esc while a turn runs clicks the native stop button (native sends chat.abort)', () => {
  const env = sandbox();
  env.stop = {disabled: false, clicks: 0, click() { this.clicks += 1; }, getClientRects: () => [1]};
  const ev = key({key: 'Escape', code: 'Escape'});
  assert.equal(env.api.handleKey(ev), 'stop');
  assert.equal(env.stop.clicks, 1);
  assert.equal(ev.defaultPrevented, true);
});

test('K2: Esc leaves the stop button alone when something else owns Esc, when already handled, or outside Metre', () => {
  const env = sandbox();
  env.stop = {disabled: false, clicks: 0, click() { this.clicks += 1; }, getClientRects: () => [1]};
  env.layers = [{getClientRects: () => [1]}]; // 斜杠菜单 / 引用回复 / 旁问结果 / 弹层开着
  assert.equal(env.api.handleKey(key({key: 'Escape'})), false);
  env.layers = [];
  assert.equal(env.api.handleKey(key({key: 'Escape', defaultPrevented: true})), false, '原生已处理的不再管');
  assert.equal(env.api.handleKey(key({key: 'Escape', isComposing: true})), false, '输入法选字时不管');
  env.stop.disabled = true;
  assert.equal(env.api.handleKey(key({key: 'Escape'})), false);
  assert.equal(env.stop.clicks, 0);
  const other = sandbox({mode: 'chat'});
  other.stop = {disabled: false, clicks: 0, click() { this.clicks += 1; }, getClientRects: () => [1]};
  assert.equal(other.api.handleKey(key({key: 'Escape'})), false);
  assert.equal(other.stop.clicks, 0, '其他模式逐字不变');
});

test('K2: two Esc within 0.5 s in a non-empty composer clear it (input event fired); slower presses do not', () => {
  const env = sandbox();
  const box = {value: '草稿一句', events: [], dispatchEvent(e) { this.events.push(e.type); }};
  env.textarea = box;
  assert.equal(env.api.handleKey(key({key: 'Escape', target: box})), false);
  env.now += 800;
  assert.equal(env.api.handleKey(key({key: 'Escape', target: box})), false, '隔太久不算连按');
  assert.equal(box.value, '草稿一句');
  env.now += 300;
  const ev = key({key: 'Escape', target: box});
  assert.equal(env.api.handleKey(ev), 'clear');
  assert.equal(box.value, '');
  assert.deepEqual(box.events, ['input'], '让原生知道草稿变了');
  assert.equal(ev.defaultPrevented, true);
  box.value = 'x';
  env.now += 100;
  assert.equal(env.api.handleKey(key({key: 'Escape', target: box})), false, '清完重新计数');
});

// ---------- K3 会话快捷键 ----------
test('K3: Ctrl+1…9 opens the Nth visible session row by clicking its own link (Windows uses Ctrl)', () => {
  const env = sandbox();
  env.rows = [fakeRow({active: true}), fakeRow(), fakeRow({visible: false}), fakeRow()];
  const ev = key({key: '2', code: 'Digit2', ctrlKey: true});
  assert.equal(env.api.handleKey(ev), 'jump');
  assert.equal(env.rows[1].link.clicks, 1);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(env.api.handleKey(key({key: '3', code: 'Digit3', ctrlKey: true})), 'jump');
  assert.equal(env.rows[3].link.clicks, 1, '跳过看不见的行');
  assert.equal(env.api.handleKey(key({key: '9', code: 'Digit9', ctrlKey: true})), false, '没有第 9 个');
  assert.equal(env.api.handleKey(key({key: '1', code: 'Digit1', metaKey: true})), false, 'Windows 上 ⌘ 不算');
  assert.equal(env.api.handleKey(key({key: '1', code: 'Digit1', ctrlKey: true, altKey: true})), false);
});

test('K3: on macOS the modifier is ⌘', () => {
  const env = sandbox({platform: 'MacIntel'});
  env.rows = [fakeRow(), fakeRow()];
  assert.equal(env.api.handleKey(key({key: '2', code: 'Digit2', metaKey: true})), 'jump');
  assert.equal(env.rows[1].link.clicks, 1);
  assert.equal(env.api.handleKey(key({key: '1', code: 'Digit1', ctrlKey: true})), false);
});

test('K3: Ctrl+Tab / Ctrl+Shift+Tab walk next / previous from the active row and wrap', () => {
  const env = sandbox();
  env.rows = [fakeRow(), fakeRow({active: true}), fakeRow()];
  assert.equal(env.api.handleKey(key({key: 'Tab', ctrlKey: true})), 'jump');
  assert.equal(env.rows[2].link.clicks, 1);
  assert.equal(env.api.handleKey(key({key: 'Tab', ctrlKey: true, shiftKey: true})), 'jump');
  assert.equal(env.rows[0].link.clicks, 1);
  const wrap = sandbox();
  wrap.rows = [fakeRow(), fakeRow({active: true})];
  wrap.api.handleKey(key({key: 'Tab', ctrlKey: true}));
  assert.equal(wrap.rows[0].link.clicks, 1, '到底回到第一个');
});

test('K3: with a filter on, shortcuts only walk the rows the filter shows', () => {
  const env = sandbox();
  env.rows = [fakeRow({active: true}), fakeRow(), fakeRow({marks: [MARK.unread]}), fakeRow({marks: [MARK.unread]})];
  env.api.setFilter('unread');
  env.api.handleKey(key({key: '1', code: 'Digit1', ctrlKey: true}));
  assert.equal(env.rows[2].link.clicks, 1);
  env.api.handleKey(key({key: 'Tab', ctrlKey: true}));
  assert.equal(env.rows[2].link.clicks, 2, '当前行不在筛选里时从第一个开始');
});

test('K3: shortcuts stay out of the code editor and other modes', () => {
  const env = sandbox();
  env.rows = [fakeRow(), fakeRow()];
  const inEditor = {closest: (sel) => (sel.includes('.monaco-editor') ? {} : null)};
  assert.equal(env.api.handleKey(key({key: '2', code: 'Digit2', ctrlKey: true, target: inEditor})), false);
  const other = sandbox({mode: 'learning'});
  other.rows = [fakeRow(), fakeRow()];
  assert.equal(other.api.handleKey(key({key: '2', code: 'Digit2', ctrlKey: true})), false);
  assert.equal(other.rows[1].link.clicks, 0);
});

// ---------- K1 命令面板补动作 ----------
const SPLIT = '[aria-label="分屏工作区：在右侧打开另一个模式"]';
const btn = () => ({disabled: false, clicks: 0, click() { this.clicks += 1; }});
function withPalette(env) {
  // 原生 openclaw-command-palette 的最小样子：searchSessions 写 sessionItems，onNavigate 收 nav: 后面的部分。
  const native = {routes: [], searched: []};
  env.palette = {
    open: true, sessionItems: [], activeIndex: 3,
    async searchSessions(q) { native.searched.push(q); this.sessionItems = [{id: 'session-a', action: 'session:agent:metre:a', label: '会话 A'}]; },
    onNavigate: (route) => native.routes.push(route),
  };
  env.api.ensurePalette();
  return native;
}

test('K1: typing in the native palette puts Metre actions first, ahead of the native session hits, and keeps those hits', async () => {
  const env = sandbox();
  env.targets['.pk-metre-nav--board'] = [btn()];
  env.targets[SPLIT] = [btn()];
  const native = withPalette(env);
  await env.palette.searchSessions('');
  assert.deepEqual(native.searched, [''], '原生搜索照样跑');
  const labels = [...env.palette.sessionItems.map((i) => i.label)];
  assert.deepEqual(labels.slice(0, 3), ['打开总谱', '分屏：在右侧打开另一个模式', '会话筛选']);
  assert.equal(labels.at(-1), '会话 A', '原生的会话结果留在后面');
  assert.equal(env.palette.activeIndex, 0);
  assert.ok(env.palette.sessionItems.slice(0, 3).every((i) => i.action.startsWith('nav:pinkie-mw:') && i.category === 'navigation'));
  await env.palette.searchSessions('总谱');
  assert.deepEqual([...env.palette.sessionItems.map((i) => i.label)], ['打开总谱', '会话 A'], '按关键词过滤');
});

test('K1: an action whose button is not on the page is not listed (nothing unwired appears)', async () => {
  const env = sandbox();
  withPalette(env);
  await env.palette.searchSessions('');
  const ids = env.palette.sessionItems.map((i) => i.id);
  assert.ok(!ids.includes('pinkie-mw-board') && !ids.includes('pinkie-mw-workbench') && !ids.includes('pinkie-mw-model'));
  assert.ok(!ids.includes('pinkie-mw-btw'), '没有输入框就不列旁问');
  assert.ok(!ids.includes('pinkie-mw-export'), '没有导出功能就不列导出');
  env.targets['.pk-wb-reopen'] = [{disabled: true, click() {}}];
  await env.palette.searchSessions('');
  assert.ok(!env.palette.sessionItems.some((i) => i.id === 'pinkie-mw-workbench'), '按键是禁用的也不列');
});

test('K1: choosing an action runs it through onNavigate (click the real button / prefill a slash command); other routes go native', async () => {
  const env = sandbox();
  const board = btn();
  env.targets['.pk-metre-nav--board'] = [board];
  const box = {value: '', events: [], focused: false, dispatchEvent(e) { this.events.push(e.type); }, focus() { this.focused = true; }};
  env.textarea = box;
  const native = withPalette(env);
  env.palette.onNavigate('pinkie-mw:board');
  assert.equal(board.clicks, 1, '点的是侧栏上真的「总谱」键');
  env.palette.onNavigate('pinkie-mw:btw');
  assert.equal(box.value, '/btw ', '原生 /btw 放进输入框，由用户补完再发');
  assert.deepEqual(box.events, ['input']);
  assert.ok(box.focused);
  env.palette.onNavigate('pinkie-mw:goal');
  assert.equal(box.value, '/goal ');
  env.palette.onNavigate('sessions');
  assert.deepEqual(native.routes, ['sessions'], '原生导航不受影响');
  assert.equal(env.api.runAction('nope'), false);
});

test('K1: recently used actions move to the front and say 最近用过', async () => {
  const env = sandbox();
  env.targets['.pk-metre-nav--board'] = [btn()];
  env.targets[SPLIT] = [btn()];
  withPalette(env);
  env.palette.onNavigate('pinkie-mw:split');
  await env.palette.searchSessions('');
  const first = env.palette.sessionItems[0];
  assert.equal(first.id, 'pinkie-mw-split');
  assert.equal(first.description, '最近用过');
  assert.equal(env.palette.sessionItems[1].description, 'Metre');
});

test('K1: wrapping is idempotent and other modes get no extra palette items', async () => {
  const env = sandbox();
  env.targets['.pk-metre-nav--board'] = [btn()];
  withPalette(env);
  const once = env.palette.searchSessions;
  env.api.ensurePalette();
  assert.equal(env.palette.searchSessions, once, '不重复包');
  const other = sandbox({mode: 'thinking'});
  other.targets['.pk-metre-nav--board'] = [btn()];
  withPalette(other);
  await other.palette.searchSessions('');
  assert.deepEqual([...other.palette.sessionItems.map((i) => i.label)], ['会话 A'], '其他模式逐字不变');
  assert.equal(other.api.runAction('board'), false);
});

// ---------- 登记与健康规矩 ----------
test('workspace files are loaded by the head fragment with ?v=@hash after dom-watch and the session list, and owned by the metre region', () => {
  const head = read('laolao-head.fragment.html');
  assert.ok(head.includes(`<link rel="stylesheet" href="/${CSS}?v=@hash">`));
  assert.ok(head.includes(`<script defer src="/${JS}?v=@hash"></script>`));
  const at = head.indexOf(`/${JS}?`);
  for (const dep of ['laolao-dom-watch.js', 'laolao-session-list.js']) {
    const d = head.indexOf(`/${dep}?`);
    assert.ok(d >= 0 && d < at, `${dep} 要先于 ${JS} 加载`);
  }
  const regions = JSON.parse(read('regions.json'));
  const metre = (regions.regions || regions).find((r) => r.id === 'metre');
  for (const f of [JS, CSS]) assert.ok(metre.files.includes(f), `${f} 登记在 metre 区域`);
});

test('workspace script adds no setInterval, MutationObserver, window.__ global or !important', () => {
  const src = read(JS);
  assert.equal(/\bsetInterval\s*\(/.test(src), false);
  assert.equal(/\bnew\s+MutationObserver\b/.test(src), false);
  assert.equal(/window\.__[\w$]+\s*=(?!=)/.test(src), false);
  assert.equal(/!\s*important/i.test(src), false);
  assert.ok(src.split('\n').length < 1500);
});
