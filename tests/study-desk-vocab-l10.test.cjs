'use strict';
// #250 L10：生词本标题上方不能露出 JS 异常原文（如「Cannot read properties of undefined (reading 'due')」）。
// 不起浏览器：用 vm 加一个最小 DOM 直接跑注入脚本。不往沙箱里塞宿主的 Error / TypeError，
// 让脚本自己抛的异常和 instanceof 判断用同一套内置对象，跟真页面一致。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-study-desk-vocab.js'), 'utf8');

class FakeClassList {
  constructor(node) { this.node = node; }
  get list() { return String(this.node.className || '').split(/\s+/).filter(Boolean); }
  write(list) { this.node.className = [...new Set(list)].join(' '); }
  add(...names) { this.write([...this.list, ...names]); }
  remove(...names) { this.write(this.list.filter(n => !names.includes(n))); }
  contains(name) { return this.list.includes(name); }
  toggle(name, force) { const on = force === undefined ? !this.contains(name) : Boolean(force); if (on) this.add(name); else this.remove(name); return on; }
}
function matches(node, selector) {
  if (node.nodeType !== 1) return false;
  const m = /^((?:\.[-\w]+)*)((?:\[[\w-]+\])*)$/.exec(selector.trim());
  if (!m) throw new Error(`fake DOM: unsupported selector ${selector}`);
  for (const c of m[1].split('.').filter(Boolean)) if (!node.classList.contains(c)) return false;
  for (const raw of m[2].match(/\[[\w-]+\]/g) || []) {
    const name = raw.slice(1, -1);
    if (name.startsWith('data-') ? !(name.slice(5) in node.dataset) : !node.attrs.has(name)) return false;
  }
  return true;
}
class FakeNode {
  constructor(doc, tag, text) {
    this.ownerDocument = doc;
    this.localName = tag;
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
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this.own = v == null ? '' : String(v); }
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
  getClientRects() { return []; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(type, fn) { this.listeners.push({type, fn}); }
}
class FakeDocument {
  constructor() { this.body = new FakeNode(this, 'body'); this.hidden = false; }
  createElement(tag) { return new FakeNode(this, String(tag).toLowerCase()); }
  createTextNode(text) { return new FakeNode(this, '#text', text); }
  querySelector() { return null; }
}

function mountVocab(respond) {
  const doc = new FakeDocument();
  const warnings = [];
  const local = {};
  const desk = {
    views: {},
    registerView(id, spec) { desk.views[id] = spec; },
    icon: () => doc.createElement('i'),
    local: () => local,
    sticker: () => '',
    isFocused: () => true,
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
  vm.runInContext(SOURCE, sandbox, {filename: 'laolao-study-desk-vocab.js'});
  const root = doc.createElement('section');
  doc.body.append(root);
  const ctx = {
    desk,
    go() {},
    request: async (method, params) => respond(String(method).replace(/^pinkie\.learning\.vocab\./, ''), params),
  };
  const runtime = desk.views.vocab.mount(root, ctx);
  return {root, runtime, warnings};
}
const settle = async () => { for (let k = 0; k < 10; k++) await new Promise(r => setImmediate(r)); };
const countText = m => m.root.querySelector('.v-count').textContent;
const RAW_JS_ERROR = /Cannot read|undefined|is not a function|is not iterable|TypeError/;

test('L10：生词本应答是 {}（假网关默认应答）时按空生词本显示，不露 JS 异常原文', async () => {
  const m = mountVocab(name => (name === 'list' ? {} : undefined));
  await settle();
  assert.doesNotMatch(countText(m), RAW_JS_ERROR);
  assert.equal(countText(m), '还没有生词');
  assert.match(m.root.querySelector('.v-empty').textContent, /生词本还是空的/);
  assert.equal(m.warnings.length, 0);
});

test('L10：应答缺 counts 但带了 words 时，按 words 补出总数照常渲染', async () => {
  const word = {id: 'w1', word: 'ambulance', status: 'ready', meaning: '救护车', collocations: [], exams: []};
  const m = mountVocab(name => (name === 'list' ? {words: [word]} : undefined));
  await settle();
  assert.equal(countText(m), '1 个词');
  assert.ok(m.root.querySelector('.v-card'), '缺 counts 也要把词卡画出来');
});

test('L10：渲染时脚本自己抛异常，只显示中文兜底，原文只进控制台', async () => {
  const m = mountVocab(name => (name === 'list' ? {counts: {total: 1}, words: [], exams: 5} : undefined));
  await settle();
  assert.equal(countText(m), '生词本暂时读不出来，稍后再试');
  assert.doesNotMatch(countText(m), RAW_JS_ERROR);
  assert.equal(m.warnings.length, 1);
  assert.match(String(m.warnings[0][0]), /生词本渲染失败/);
});

test('L10：网关报的业务错误（不在学习模式会话）照样显示给用户', async () => {
  const m = mountVocab(name => { if (name === 'list') throw new Error('互动学习只在学习模式会话中可用'); });
  await settle();
  assert.equal(countText(m), '互动学习只在学习模式会话中可用');
  assert.equal(m.warnings.length, 0);
});
