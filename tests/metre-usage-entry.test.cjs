// 界面吸收计划第 27 项「用量页入口」（#96 L39）—— 契约测试，不起浏览器。
// 加载真实的 ui/injections/laolao-metre-usage.js 到 vm 沙盒，用最小的假 DOM 断言：
// 只在 Metre 侧栏加一颗「用量」、点下去调的是原生路由 navigate('usage')（没有时退回 history + popstate）、
// 在 /usage 上标 aria-current，其他模式一个节点都不加；以及头片段 / regions.json / 样式表的登记和健康规矩。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INJ = path.join(ROOT, 'ui/injections');
const JS = 'laolao-metre-usage.js';
const CSS = 'laolao-metre-usage.css';
const read = (file) => fs.readFileSync(path.join(INJ, file), 'utf8');

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.parentElement = null;
  }
  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    return {contains: (c) => list().includes(c)};
  }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn({}); }
  matches(sel) { return sel.startsWith('.') && sel.slice(1).split('.').every((c) => this.classList.contains(c)); }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel) { return this.all().find((n) => n.matches(sel)) || null; }
  querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); }
}

function load({mode = 'metre', shell = 'navigate', pathname = '/chat', controls = true} = {}) {
  const html = new FakeEl('html');
  if (mode) html.setAttribute('data-laolao-mode', mode);
  const env = {html, controls: controls ? new FakeEl('div') : null, navigated: [], pushed: [], popstates: 0, polls: [], winListeners: {}, timeouts: []};
  if (env.controls) env.controls.className = 'laolao-session-controls';
  const location = {pathname};
  env.location = location;
  const shellEl = shell === 'navigate' ? {navigate: (r) => { env.navigated.push(r); location.pathname = '/' + r; }}
    : shell === 'context' ? {context: {navigate: (r) => { env.navigated.push(r); location.pathname = '/' + r; }}}
    : shell === 'plain' ? {} : null;
  const document = {
    documentElement: html,
    createElement: (tag) => new FakeEl(tag),
    querySelector: (sel) => {
      if (sel === 'aside.sidebar .laolao-session-controls') return env.controls;
      if (sel === 'openclaw-app-shell') return shellEl;
      return null;
    },
  };
  class PopStateEvent { constructor(type) { this.type = type; } }
  const window = {
    location,
    history: {pushState: (_s, _t, url) => { env.pushed.push(url); location.pathname = url; }},
    dispatchEvent: (ev) => { if (ev.type === 'popstate') env.popstates += 1; },
    addEventListener: (t, fn) => { (env.winListeners[t] ??= []).push(fn); },
    Pinkie: {domWatch: {poll: (fn, ms) => env.polls.push({fn, ms})}},
  };
  const sandbox = {window, document, PopStateEvent, setTimeout: (fn) => { env.timeouts.push(fn); return env.timeouts.length; }};
  vm.runInNewContext(read(JS), sandbox, {filename: JS});
  env.window = window;
  env.api = window.Pinkie.metreUsage;
  env.btns = () => (env.controls ? env.controls.querySelectorAll('.pk-metre-nav--usage') : []);
  env.flush = () => { const q = env.timeouts.splice(0); q.forEach((fn) => fn()); };
  return env;
}

test('Metre：侧栏 controls 里加一颗「用量」pk-metre-nav 键，重复 ensure 不会加第二颗', () => {
  const env = load();
  const btns = env.btns();
  assert.equal(btns.length, 1);
  const btn = btns[0];
  assert.ok(btn.classList.contains('pinkie-sidebar-entry'), '和「总谱」「筛选」同一类侧栏条目，Metre 皮肤统一管底色字色');
  assert.ok(btn.classList.contains('pk-metre-nav'), '带 pk-metre-nav：会话列表重画时被留住、其他模式被统一藏掉');
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.type, 'button');
  assert.equal(btn.children[0].textContent, '用量');
  assert.match(btn.getAttribute('aria-label'), /用量页/);
  env.api.ensure(); env.api.ensure();
  env.flush();
  assert.equal(env.btns().length, 1, '不会重复加');
});

test('点「用量」调原生路由 navigate("usage")，不重载页面、不 pushState；之后按键标成当前页', () => {
  const env = load();
  const btn = env.btns()[0];
  assert.equal(btn.getAttribute('aria-current'), null, '在 /chat 上不是当前页');
  btn.click();
  assert.deepEqual(env.navigated, ['usage']);
  assert.deepEqual(env.pushed, [], '有原生 navigate 时不走 history');
  assert.equal(env.popstates, 0);
  assert.equal(btn.getAttribute('aria-current'), 'page');
});

test('原生 navigate 挂在 shell.context 上时也认', () => {
  const env = load({shell: 'context'});
  env.btns()[0].click();
  assert.deepEqual(env.navigated, ['usage']);
  assert.deepEqual(env.pushed, []);
});

test('反例：老版本没有 navigate 时退回 history.pushState("/usage") + popstate，和「打开技能」同一条退路', () => {
  for (const shell of ['plain', 'none']) {
    const env = load({shell});
    assert.equal(env.api.openUsage(), 'history');
    assert.deepEqual(env.pushed, ['/usage'], shell);
    assert.equal(env.popstates, 1, shell);
    assert.deepEqual(env.navigated, []);
  }
});

test('已经在 /usage（含子路径、查询串）上打开时按键就是当前页；离开后 popstate 重画去掉标记', () => {
  for (const p of ['/usage', '/usage/', '/usage?day=1', '/usage#x']) {
    const env = load({pathname: p});
    assert.equal(env.btns()[0].getAttribute('aria-current'), 'page', p);
  }
  const env = load({pathname: '/usage'});
  env.location.pathname = '/chat';
  (env.winListeners.popstate || []).forEach((fn) => fn());
  env.flush();
  assert.equal(env.btns()[0].getAttribute('aria-current'), null);
  for (const p of ['/usages', '/chat/usage', '/settings/usage']) {
    assert.equal(load({pathname: p}).btns()[0].getAttribute('aria-current'), null, `${p} 不是用量页`);
  }
});

test('反例：其他五个模式（以及没有模式）一个节点都不加，点不到路由', () => {
  for (const mode of ['chat', 'project', 'thinking', 'learning', 'infinite', '']) {
    const env = load({mode});
    assert.equal(env.btns().length, 0, mode || '(无)');
    env.api.ensure(); env.flush();
    assert.equal(env.btns().length, 0, mode || '(无)');
    assert.deepEqual(env.navigated, []);
  }
});

test('侧栏还没画出来时不报错；画出来后靠会话列表事件 / domWatch 补上', () => {
  const env = load({controls: false});
  assert.equal(env.btns().length, 0);
  env.controls = new FakeEl('div');
  env.controls.className = 'laolao-session-controls';
  (env.winListeners['laolao:sessions-changed'] || []).forEach((fn) => fn());
  env.flush();
  assert.equal(env.btns().length, 1);
  assert.equal(env.polls.length, 1, '刷新挂在 Pinkie.domWatch.poll 上，不自己开定时器');
});

test('载入两次只初始化一次（Pinkie.metreUsage 已在就直接返回）', () => {
  const env = load();
  const again = {window: env.window, document: {documentElement: env.html, querySelector: () => { throw new Error('不该再跑'); }}, PopStateEvent: class {}, setTimeout: () => 0};
  vm.runInNewContext(read(JS), again, {filename: JS});
  assert.equal(env.btns().length, 1);
});

test('登记：头片段按 ?v=@hash 加载 css / js，regions.json 归 metre 区域，exceptions.d 各 +2 行', () => {
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-usage\.css\?v=@hash">/);
  assert.match(head, /<script defer src="\/laolao-metre-usage\.js\?v=@hash"><\/script>/);
  const regions = JSON.parse(read('regions.json'));
  const owners = [];
  const walk = (node, key) => {
    if (Array.isArray(node)) { if (node.includes(JS) && node.includes(CSS)) owners.push(key); node.forEach((n) => walk(n, key)); }
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, node.id || node.name || k);
  };
  walk(regions, '');
  assert.equal(owners.length, 1, '恰好一个区域登记这两个文件');
  assert.match(String(owners[0]), /metre/i);
  const delta = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/health/exceptions.d/feat-metre-l39-usage-entry.json'), 'utf8'));
  assert.deepEqual(delta.map((d) => [d.file, d.metric, d.add]).sort(), [
    ['ui/injections/laolao-head.fragment.html', 'lines', 2],
    ['ui/injections/regions.json', 'lines', 2],
  ]);
});

test('健康规矩：不新增重要标记、定时器、DOM 观察器、window.__ 全局名；样式只在 Metre 下生效', () => {
  const js = read(JS), css = read(CSS);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(js, /setInterval|MutationObserver|window\.__/);
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => r.includes('{'))) {
    const sel = rule.slice(0, rule.indexOf('{')).trim();
    if (sel.startsWith('@')) continue;
    assert.match(sel, /^html\[data-laolao-mode="metre"\]/, sel);
  }
  assert.match(read('laolao-metre-board.css'), /html:not\(\[data-laolao-mode="metre"\]\) \.pk-metre-nav \{ display: none/, '其他模式靠这一条统一藏掉 pk-metre-nav');
  assert.ok(js.split('\n').length < 200 && css.split('\n').length < 200);
});
