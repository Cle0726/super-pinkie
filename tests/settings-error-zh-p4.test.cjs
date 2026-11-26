// P4：设置页的状态行不再把英文异常原文 / 堆栈写进界面。
// 复发场景：网关超时时 savePrefs 抛 Error('gateway timeout')，pywebview 把 Python 异常原文（带 Traceback）抛给页面。
// 修复前状态行显示「没保存上：gateway timeout」；修复后显示中文，原文只进 console.warn。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui/injections/laolao-settings-user.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

// 只够设置页自己建节点用的小 DOM：文本节点、子节点链、属性、事件、点击。
function makeDocument() {
  const all = [];
  class Text {
    constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; }
    get nodeValue() { return this.data; }
    set nodeValue(value) { this.data = String(value); }
    get textContent() { return this.data; }
  }
  class Element {
    constructor(tag) {
      this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null;
      this.attributes = new Map(); this.dataset = {}; this.style = {}; this.listeners = new Map();
      this.hidden = false; this.disabled = false; this.className = ''; this.value = '';
      this.classList = {toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false};
      all.push(this);
    }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() { const list = this.parentNode?.childNodes || []; return list[list.indexOf(this) + 1] || null; }
    get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new Text(node) : node); }
    appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
    insertBefore(node, ref) { node.parentNode = this; const i = this.childNodes.indexOf(ref); if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node); return node; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, handler) { (this.listeners.get(type) || this.listeners.set(type, []).get(type)).push(handler); }
    removeEventListener() {}
    click() { for (const handler of this.listeners.get('click') || []) handler({target: this, preventDefault() {}, stopPropagation() {}}); }
    focus() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return {left: 0, top: 0, width: 800, height: 40, bottom: 40}; }
  }
  const document = {
    readyState: 'complete', activeElement: null,
    createElement: tag => new Element(tag), createTextNode: text => new Text(text),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  };
  document.body = new Element('body');
  return {document, all};
}

function mount(bridge) {
  const {document, all} = makeDocument();
  const warnings = [];
  const store = new Map();
  const window = {
    location: {pathname: '/chat', search: '', hash: '', assign() {}},
    localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key)},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {},
    __pinkieNativeBridge: bridge,
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  vm.runInNewContext(source, {
    window, document, navigator: {platform: 'Win32', userAgent: 'test'}, CustomEvent, Event: CustomEvent,
    console: {warn: (...args) => warnings.push(args), log() {}, error() {}},
    setTimeout: () => 0, clearTimeout() {}, URL, URLSearchParams, JSON, Object, Array, String, Boolean, Date, Number, Map, Set, Promise, Math, RegExp, Error,
  }, {filename: 'laolao-settings-user.js'});
  const statuses = () => all.filter(node => String(node.className).includes('pinkie-user-settings__status'));
  return {all, warnings, statuses};
}

const LEAK = /gateway|timeout|Traceback|KeyError|File "|line \d+/i;

test('网关超时：保存回答风格失败时状态行是中文，不带英文原文', async () => {
  const failure = new Error('gateway timeout');
  const page = mount({savePrefs: () => Promise.reject(failure), loadPrefs: () => Promise.resolve({}), pinkieNative: () => Promise.resolve({ok: true})});
  const concise = page.all.find(node => node.dataset.style === 'concise');
  assert.ok(concise, '找不到「简洁」按钮');
  concise.click();
  await settle();
  const shown = page.statuses().map(node => node.textContent).find(text => text.startsWith('没保存上'));
  assert.ok(shown, '状态行没有显示保存失败');
  assert.doesNotMatch(shown, LEAK, `状态行漏出了原文：${shown}`);
  assert.match(shown, /[㐀-鿿]{4,}/);
  assert.ok(page.warnings.some(args => args.includes(failure)), '原文应该进 console.warn');
});

test('原生端抛 Python 异常：改快捷键失败时状态行不带 Traceback', async () => {
  const failure = new Error('Traceback (most recent call last):\n  File "app/windows_bridge.py", line 386, in pinkieNative\nKeyError: \'accelerator\'');
  const page = mount({savePrefs: () => Promise.resolve({}), loadPrefs: () => Promise.resolve({}), pinkieNative: () => Promise.reject(failure)});
  const off = page.all.find(node => node.tagName === 'BUTTON' && node.textContent === '关闭');
  assert.ok(off, '找不到快捷键「关闭」按钮');
  off.click();
  await settle();
  const shown = page.statuses().filter(node => node.dataset.state === 'error').map(node => node.textContent).find(Boolean);
  assert.ok(shown, '状态行没有显示快捷键失败');
  assert.doesNotMatch(shown, LEAK, `状态行漏出了原文：${shown}`);
  assert.match(shown, /^快捷键没改成：[㐀-鿿]/);
  assert.ok(page.warnings.some(args => args.includes(failure)), '原文应该进 console.warn');
});
