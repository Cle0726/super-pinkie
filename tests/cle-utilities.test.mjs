// 功能面板的入口编排：这些断言跑真实的 src/legacy/utilities.js（ESM），
// 用一个最小 DOM 桩驱动，验证的是行为而不是"文件里出现了某段字符串"。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/* ── 最小 DOM ───────────────────────────────────────────────────────────── */
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    this._html = '';
    this.parentElement = null;
    this.isConnected = true;
  }
  set className(v) { this._class = String(v); }
  get className() { return this._class || ''; }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get textContent() {
    return this._text + this.children.map(c => c.textContent).join('');
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  append(...nodes) {
    for (const n of nodes) {
      if (n == null) continue;
      n.parentElement = this;
      this.children.push(n);
    }
  }
  prepend(n) { n.parentElement = this; this.children.unshift(n); }
  before(n) { const i = this.parentElement?.children.indexOf(this) ?? -1; if (i >= 0) { n.parentElement = this.parentElement; this.parentElement.children.splice(i, 0, n); } }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter(c => c !== this); this.isConnected = false; this.parentElement = null; }
  get childElementCount() { return this.children.filter((c) => c && c.tagName).length; }
  replaceChildren(...nodes) { for (const c of this.children) { c.parentElement = null; c.isConnected = false; } this.children = []; this.append(...nodes); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  removeAttribute(k) { this.attributes.delete(k); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  dispatch(type, event = {}) {
    const ev = {target: this, preventDefault() {}, stopPropagation() {}, ...event};
    for (const fn of this.listeners.get(type) || []) fn(ev);
  }
  focus() {
    this.focused = true;
    if (globalThis.document) globalThis.document.activeElement = this;
  }
  getClientRects() { return [1]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains(node) { return node === this || this.children.includes(node); }
}

function makeDocument() {
  const body = new El('body');
  const head = new El('head');
  const doc = {
    body, head, documentElement: new El('html'),
    readyState: 'complete',
    title: '',
    activeElement: null,
    createElement: (tag) => new El(tag),
    createTextNode: (t) => ({nodeType: 3, textContent: t, parentElement: null, isConnected: true, closest: () => null}),
    addEventListener(type, fn) { if (type === 'keydown') (doc.__keydown ||= []).push(fn); },
    removeEventListener() {},
    querySelector: (selector) => selectAll(selector)[0] || null,
    querySelectorAll: (selector) => selectAll(selector),
    getElementById: (id) => walk(body).find(el => el.id === id) || null,
  };
  globalThis.window.document = doc;
  globalThis.document = doc;
  return doc;
}

/* 只支持本模块真正用到的选择器：`#id`、`.cls`、标签名，以及空格后代组合。
   不追求通用，够用即可；选择器写错时测试会直接失败，而不是静默通过。 */
function matchesSimple(el, part) {
  if (!part) return false;
  if (part.startsWith('#')) return el.id === part.slice(1);
  if (part.startsWith('.')) return (el.className || '').split(/\s+/).includes(part.slice(1));
  return el.tagName === part.toUpperCase();
}
function selectAll(selector, rootNode = globalThis.document.body) {
  // 组选择器（a, b）各自求值后合并，和浏览器一样按文档顺序去重
  if (selector.includes(',')) {
    const picked = selector.split(',').flatMap(part => selectAll(part.trim(), rootNode));
    return walk(rootNode).filter(el => picked.includes(el));
  }
  const parts = selector.trim().split(/\s+/);
  let pool = walk(rootNode);
  for (const part of parts) {
    const next = [];
    for (const el of pool) {
      // 后代组合：候选必须出现在当前池节点的子树里
      for (const cand of walk(el.children?.length ? el : el)) {
        if (cand !== el && matchesSimple(cand, part)) next.push(cand);
      }
    }
    pool = [...new Set(next)];
  }
  // 单段选择器：直接在全树里找
  if (parts.length === 1) pool = walk(rootNode).filter(el => matchesSimple(el, parts[0]));
  return pool;
}

function walk(el, out = []) {
  out.push(el);
  for (const c of el.children || []) walk(c, out);
  return out;
}
const findAll = (rootNode, pred) => walk(rootNode).filter(pred);
const closestClass = (el, cls) => {
  for (let n = el; n; n = n.parentElement) if ((n.className || '').split(/\s+/).includes(cls)) return n;
  return null;
};

/* ── 环境 ───────────────────────────────────────────────────────────────── */
function installDom() {
  const listeners = new Map();
  const timers = [];
  const window = {
    document: null,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn, ms) => realSetTimeout(fn, Math.min(ms ?? 0, 5)),
    clearTimeout: (id) => realClearTimeout(id),
    location: {href: 'http://127.0.0.1:19789/'},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    __timers: timers,
  };
  globalThis.window = window;
  // utilities.js 用的是全局定时器。mount 的 1.2s 轮询会一直吊住事件循环，
  // 这里换成不排期的 interval；setTimeout 保留真实实现但压到 5ms 以内，
  // 这样"稍后重试"的路径仍会真的发生，而不是被测试伪造。
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  globalThis.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms ?? 0, 5));
  globalThis.document = null;
  makeDocument();
  return window;
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const settle = (ms = 40) => new Promise(r => realSetTimeout(r, ms));

async function load() {
  const url = new URL('../services/cle-studio/src/legacy/utilities.js', import.meta.url);
  url.search = '?t=' + Math.random();
  return import(url.href);
}

const flush = () => new Promise(r => setImmediate(r));

function mountFooter() {
  const bar = new El('div');
  bar.className = 'sidebar-footer-bar';
  const footer = new El('div');
  footer.className = 'sidebar-shell__footer';
  footer.append(bar);
  document.body.append(footer);
  return {bar, footer};
}

/* ── 测试 ───────────────────────────────────────────────────────────────── */
test('入口是一个和原生 footer 同尺寸的图标按钮，而不是文字胶囊', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);

  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));
  assert.ok(entry, 'footer 里应有功能入口');
  assert.ok(entry.className.includes('sidebar-footer-icon'), '复用原生 footer 图标尺寸');
  assert.equal(entry.tagName, 'BUTTON');
  assert.equal(entry.getAttribute('aria-expanded'), 'false');
  assert.ok(entry.title.includes('记忆'), '标题说明真实内容');
  // 图标是 SVG 常量，不是 emoji / 文字
  assert.match(entry.children[0].innerHTML, /<svg/);
  assert.doesNotMatch(entry.textContent, /功能/, '入口不再用文字占位');
});

test('打开面板时按需加载被移植的卡片；模块缺席时给出可读降级而不是静默空白', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  let mountedHeader = null;
  window.__pinkieCapabilities = {
    mount(target) {
      mountedHeader = target;
      const card = document.createElement('div');
      card.id = 'pinkie-connectors';
      target.append(card);
    },
  };
  window.__laolaoUsage = {view: {input: 1}, render() { this.rendered = true; }};

  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);
  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));

  entry.dispatch('click');
  await flush();

  assert.ok(mountedHeader, 'capabilities.mount 应收到卡片容器');
  assert.equal(window.__laolaoUsage.rendered, true, '用量胶囊应被渲染');
  const panel = document.getElementById?.('cle-utilities') || null;
  assert.equal(entry.getAttribute('aria-expanded'), 'true');
});

test('没有原生桥时，空间入口保留真实地址并说明降级，不假装已打开', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);
  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));
  entry.dispatch('click');

  const layer = document.body.children.find(c => (c.className || '').includes('cle-utilities-layer'));
  assert.ok(layer, '面板层已挂载');
  const party = findAll(layer, el => el.tagName === 'A' && String(el.href || '').includes('18889'))[0];
  assert.ok(party, '派对空间的真实地址仍在');
  assert.equal(party.target, '_blank');
  assert.equal(party.rel, 'noopener');
  assert.equal(party.dataset.native, '0');
  assert.match(party.title, /新标签页/, '无桥时如实说明打开方式');

  party.dispatch('click');
  const status = findAll(layer, el => (el.className || '').includes('cle-utilities__status'))[0];
  assert.match(status.textContent, /新标签页|内置服务/, '降级提示是真实文案');
  assert.equal(status.hidden, false);
});

test('有原生桥时，空间入口走桥并把面板收起', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const posted = [];
  window.webkit = {messageHandlers: {laolaoParty: {postMessage: (m) => posted.push(m)}}};
  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);
  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));
  entry.dispatch('click');

  const layer = document.body.children.find(c => (c.className || '').includes('cle-utilities-layer'));
  const party = findAll(layer, el => el.tagName === 'A' && String(el.href || '').includes('18889'))[0];
  assert.equal(party.dataset.native, '1');

  let prevented = false;
  party.dispatch('click', {preventDefault: () => { prevented = true; }});
  assert.deepEqual(posted, [{action: 'open'}], '通过原生桥打开，而不是新标签');
  assert.equal(prevented, true);
  assert.equal(layer.hidden, true, '打开后收起面板');
});

test('记忆入口在记忆匣未就绪时给出提示，就绪后才转交', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);
  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));
  entry.dispatch('click');

  const layer = document.body.children.find(c => (c.className || '').includes('cle-utilities-layer'));
  const memoryRow = findAll(layer, el => (el.className || '') === 'cle-utilities__row')[0];
  memoryRow.dispatch('click');
  const status = findAll(layer, el => (el.className || '').includes('cle-utilities__status'))[0];
  assert.match(status.textContent, /记忆匣/, '未就绪时说明真实状态');
  assert.equal(layer.hidden, false, '不要在没打开任何东西时收起面板');

  let opened = 0;
  window.__clekkMemoryUI = {open() { opened += 1; }};
  memoryRow.dispatch('click');
  assert.equal(opened, 1);
  assert.equal(layer.hidden, true);
});

test('演示工具未加载时不清空按钮文字，也不假装已开启', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);
  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));
  entry.dispatch('click');

  const layer = document.body.children.find(c => (c.className || '').includes('cle-utilities-layer'));
  const button = findAll(layer, el => el.tagName === 'BUTTON' && el.textContent === '打开演示工具')[0];
  const label = button.textContent;
  button.dispatch('click');
  assert.equal(button.textContent, label, '按钮文字保持稳定');
  assert.equal(button.disabled, true, '短暂禁用避免连点');
  const status = findAll(layer, el => (el.className || '').includes('cle-utilities__status'))[0];
  assert.match(status.textContent, /加载/);

  let toggled = 0;
  window.__laolaoLaser = {toggle() { toggled += 1; }};
  button.disabled = false;
  button.dispatch('click');
  assert.equal(toggled, 1);
  assert.equal(layer.hidden, true);
});

test('面板卸载时移除入口与层，不留下孤儿节点', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);
  assert.equal(bar.children.filter(c => (c.className || '').includes('cle-utilities-entry')).length, 1);

  controller.abort();
  assert.equal(bar.children.filter(c => (c.className || '').includes('cle-utilities-entry')).length, 0);
  assert.equal(document.body.children.filter(c => (c.className || '').includes('cle-utilities-layer')).length, 0);
});

test('Esc 关闭面板并把焦点还给入口', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const {mountUtilities} = await load();
  const controller = new AbortController();
  mountUtilities({}, controller.signal);
  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));
  entry.dispatch('click');

  const layer = document.body.children.find(c => (c.className || '').includes('cle-utilities-layer'));
  assert.equal(layer.hidden, false);
  // 文档级 keydown 由 utilities 自己注册；测试桩里直接取出来调用
  const keydown = (document.__keydown || []).at(-1);
  assert.ok(keydown, '应注册 Escape 处理');
  let prevented = false;
  keydown({key: 'Escape', preventDefault: () => { prevented = true; }, shiftKey: false});
  assert.equal(prevented, true);
  assert.equal(layer.hidden, true);
  assert.equal(entry.getAttribute('aria-expanded'), 'false');
  assert.equal(entry.focused, true, '关闭后焦点回到入口，键盘用户不会掉到页面顶部');
});

test('被移植卡片始终加载不出来时，面板说明原因而不是留一块空白', async () => {
  installDom();
  mountFooterAlternative();
  // 故意不安装 __pinkieCapabilities：模拟该模块加载失败
  const {mountUtilities} = await load();
  mountUtilities({}, new AbortController().signal);
  const entry = document.body.children
    .flatMap(c => c.children)
    .flatMap(c => c.children)
    .find(c => (c.className || '').includes('cle-utilities-entry'));
  entry.dispatch('click');
  await settle(120);

  const layer = document.body.children.find(c => (c.className || '').includes('cle-utilities-layer'));
  const hint = findAll(layer, el => (el.className || '').includes('cle-utilities__hint') && /定时任务和连接器/.test(el.textContent))[0];
  assert.ok(hint, '应有一条关于卡片加载状态的说明');
  assert.match(hint.textContent, /没能加载|正在加载/);
  assert.equal(hint.hidden, false);
});

test('重复挂载不会产生第二个入口或第二层', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const {mountUtilities} = await load();
  const a = new AbortController();
  mountUtilities({}, a.signal);
  mountUtilities({}, new AbortController().signal);
  assert.equal(bar.children.filter(c => (c.className || '').includes('cle-utilities-entry')).length, 1);
  assert.equal(document.body.children.filter(c => (c.className || '').includes('cle-utilities-layer')).length, 1);
});

test('重新打开面板会重建卡片容器，让移植模块重新读取任务与连接状态', async () => {
  installDom();
  const {bar} = mountFooterAlternative();
  const mounts = [];
  window.__pinkieCapabilities = {
    mount(target) {
      mounts.push((target.children || []).length);
      const card = document.createElement('div');
      card.id = 'pinkie-connectors';
      target.append(card);
    },
  };
  const {mountUtilities} = await load();
  mountUtilities({}, new AbortController().signal);
  const entry = bar.children.find(c => (c.className || '').includes('cle-utilities-entry'));

  entry.dispatch('click');
  await flush();
  entry.dispatch('click');   // 关闭
  entry.dispatch('click');   // 再打开
  await flush();

  assert.equal(mounts.length, 2, '每次打开都应重新挂载卡片');
  assert.equal(mounts[1], 0, '第二次挂载前容器必须已清空');
});

/* mountFooterAlternative 只是 mountFooter 的别名，保留名字以便读测试时更直观 */
function mountFooterAlternative() {
  return mountFooter();
}
