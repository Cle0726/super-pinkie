'use strict';
// #250 L9：看板的 metrics 应答缺 answered 等字段（假网关默认应答 {}、旧插件、异常应答）时，
// 不能抛 TypeError 卡住 load：骨架屏要复位、「重新分析」要能点、界面不露 JS 异常原文。
// 不起浏览器：用 vm 加一个最小 DOM 直接跑注入脚本。不往沙箱里塞宿主的 Error / TypeError，
// 让脚本自己抛的异常和 instanceof 判断用同一套内置对象，跟真页面一致。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-study-desk-board.js'), 'utf8');

class FakeClassList {
  constructor(node) { this.node = node; }
  get list() { return String(this.node.className || '').split(/\s+/).filter(Boolean); }
  write(list) { this.node.className = [...new Set(list)].join(' '); }
  add(...names) { this.write([...this.list, ...names]); }
  remove(...names) { this.write(this.list.filter(n => !names.includes(n))); }
  contains(name) { return this.list.includes(name); }
  toggle(name, force) { const on = force === undefined ? !this.contains(name) : Boolean(force); if (on) this.add(name); else this.remove(name); return on; }
}
function matchesCompound(node, selector) {
  if (node.nodeType !== 1) return false;
  const m = /^([a-z][-\w]*)?((?:\.[-\w]+)*)((?:\[[\w-]+\])*)$/i.exec(selector);
  if (!m || !(m[1] || m[2] || m[3])) throw new Error(`fake DOM: unsupported selector ${selector}`);
  if (m[1] && node.localName !== m[1].toLowerCase()) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!node.classList.contains(c)) return false;
  for (const raw of m[3].match(/\[[\w-]+\]/g) || []) {
    const name = raw.slice(1, -1);
    if (name.startsWith('data-') ? !(name.slice(5) in node.dataset) : !node.attrs.has(name)) return false;
  }
  return true;
}
// 只支持「标签/类/属性」复合选择器和空格后代组合。
function matches(node, selector) {
  const parts = selector.trim().split(/\s+/);
  if (!matchesCompound(node, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let p = node.parentNode; i >= 0 && p; p = p.parentNode) if (matchesCompound(p, parts[i])) i--;
  return i < 0;
}
class FakeNode {
  constructor(doc, tag, text) {
    this.ownerDocument = doc;
    this.localName = tag;
    this.nodeName = String(tag).toUpperCase();
    this.nodeType = tag === '#text' ? 3 : 1;
    this.parentNode = null;
    this.children = [];
    this.className = '';
    this.attrs = new Map();
    this.dataset = {};
    this.listeners = [];
    this.own = text == null ? '' : String(text);
    this.style = {};
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
  }
  get childNodes() { return this.children; }
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this.own = v == null ? '' : String(v); }
  // 只给 template 用：标题里不带标签时按纯文本处理就够了。
  set innerHTML(v) { this.content = {childNodes: [this.ownerDocument.createTextNode(String(v))]}; }
  append(...nodes) {
    for (let n of nodes) {
      if (typeof n === 'string') n = this.ownerDocument.createTextNode(n);
      n.remove(); n.parentNode = this; this.children.push(n);
    }
  }
  prepend(...nodes) {
    const ready = [];
    for (let n of nodes) {
      if (typeof n === 'string') n = this.ownerDocument.createTextNode(n);
      n.remove(); n.parentNode = this; ready.push(n);
    }
    this.children.unshift(...ready);
  }
  remove() { const p = this.parentNode; if (!p) return; p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  querySelectorAll(selector) {
    const out = [];
    const walk = n => { for (const c of n.children) { if (matches(c, selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(type, fn) { this.listeners.push({type, fn}); }
  removeEventListener() {}
}
class FakeDocument {
  constructor() { this.body = new FakeNode(this, 'body'); }
  createElement(tag) { return new FakeNode(this, String(tag).toLowerCase()); }
  createElementNS(ns, tag) { return new FakeNode(this, String(tag)); }
  createTextNode(text) { return new FakeNode(this, '#text', text); }
  querySelector() { return null; }
}

function mountBoard(respond) {
  const doc = new FakeDocument();
  const warnings = [];
  const desk = {
    views: {},
    registerView(id, spec) { desk.views[id] = spec; },
    icon: () => doc.createElement('i'),
    sticker: () => '',
  };
  const sandbox = {
    document: doc,
    console: {log() {}, warn: (...args) => warnings.push(args), error() {}},
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    addEventListener() {},
    __pinkieStudyDesk: desk,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, {filename: 'laolao-study-desk-board.js'});
  const root = doc.createElement('section');
  doc.body.append(root);
  const ctx = {
    pane: {state: {}},
    motion: {},
    sessionKey: 'agent:learning:study-desk-l9',
    go() {},
    request: async (method, params) => respond(String(method).replace(/^pinkie\.learning\.(desk\.)?/, ''), params),
  };
  const runtime = desk.views.board.mount(root, ctx);
  return {root, runtime, warnings};
}
const settle = async () => { for (let k = 0; k < 10; k++) await new Promise(r => setImmediate(r)); };
const RAW_JS_ERROR = /Cannot read|undefined|is not a function|is not iterable|TypeError/;
const FULL = {
  range: '7d', learning: {total: 10, learned: 2, practiced: 1, mastered: 0, learnedNotPracticed: 0},
  minutes: {total: 12, series: [0, 0, 0, 0, 0, 2, 10], delta: null},
  answered: {total: 3, independentRate: 1, series: [0, 0, 0, 0, 0, 1, 2], assessed: 3},
  reviews: {done: 4, backlog: 2, series: [0, 0, 0, 0, 0, 0, 4]},
  streak: {current: 2, best: 5, series: [0, 0, 0, 0, 0, 1, 1]},
  pace: null,
};
const withoutAnswered = () => { const copy = structuredClone(FULL); delete copy.answered; return copy; };
const metricCards = m => m.root.querySelectorAll('.b-metric').map(card => ({
  label: card.querySelector('small')?.textContent,
  value: card.querySelector('.b-counter')?.textContent,
  note: card.querySelector('.b-delta')?.textContent,
}));
const assertSettled = m => {
  assert.equal(m.root.querySelector('.b-refresh').disabled, false, '「重新分析」要复位成可点');
  assert.equal(m.root.getAttribute('aria-busy'), 'false', 'aria-busy 要复位');
  assert.equal(m.root.querySelector('.b-skeleton'), null, '骨架屏要换掉');
};

test('L9：metrics 应答是 {}（假网关默认应答）时按 0 画四张卡，不卡住 load、不露 JS 异常原文', async () => {
  const m = mountBoard(() => ({}));
  await settle();
  assertSettled(m);
  const cards = metricCards(m);
  assert.deepEqual(cards.map(c => c.label), ['专注', '作答', '复习', '连续']);
  assert.deepEqual(cards.map(c => c.value), ['0', '0', '0', '0']);
  assert.equal(cards[1].note, '暂无可判断的作答');
  assert.doesNotMatch(m.root.textContent, RAW_JS_ERROR);
  assert.equal(m.warnings.length, 0);
});

test('L9：只缺 answered 时其他三张卡照常显示真实数字', async () => {
  const m = mountBoard(name => (name === 'metrics' ? withoutAnswered() : {}));
  await settle();
  assertSettled(m);
  const cards = metricCards(m);
  assert.deepEqual(cards.map(c => c.value), ['12', '0', '4', '2']);
  assert.equal(cards[1].note, '暂无可判断的作答');
  assert.equal(cards[2].note, '积压 2 张');
  assert.equal(cards[3].note, '历史最佳 5 天');
  assert.ok(m.root.querySelector('.b-learning-row'), '学习进度照常画');
  assert.doesNotMatch(m.root.textContent, RAW_JS_ERROR);
  assert.equal(m.warnings.length, 0);
});

test('L9：metrics 应答是 null 时也不抛，按空统计显示', async () => {
  const m = mountBoard(name => (name === 'metrics' ? null : {}));
  await settle();
  assertSettled(m);
  assert.deepEqual(metricCards(m).map(c => c.value), ['0', '0', '0', '0']);
  assert.doesNotMatch(m.root.textContent, RAW_JS_ERROR);
  assert.equal(m.warnings.length, 0);
});

test('L9：渲染时脚本自己抛异常，只显示中文兜底，原文只进控制台', async () => {
  const broken = {...FULL, pace: {total: 10, lit: 1, history: 5, startDate: '2026-11-01', examDate: '2027-03-01'}};
  const m = mountBoard(name => (name === 'metrics' ? broken : {}));
  await settle();
  assertSettled(m);
  assert.equal(m.root.querySelector('.b-metrics .b-failure').textContent, '统计暂时读不到，稍后重试。');
  assert.doesNotMatch(m.root.textContent, RAW_JS_ERROR);
  assert.equal(m.warnings.length, 1);
  assert.match(String(m.warnings[0][0]), /看板渲染失败/);
});

test('L9：网关报的业务错误（不在学习模式会话）照样显示给用户', async () => {
  const m = mountBoard(name => {
    if (name === 'metrics' || name === 'insight') throw new Error('互动学习只在学习模式会话中可用');
    return {};
  });
  await settle();
  assertSettled(m);
  assert.equal(m.root.querySelector('.b-metrics .b-failure').textContent, '统计暂时没有读到：互动学习只在学习模式会话中可用');
  assert.equal(m.root.querySelector('.b-findings .b-failure').textContent, '互动学习只在学习模式会话中可用');
  assert.equal(m.warnings.length, 0);
});
