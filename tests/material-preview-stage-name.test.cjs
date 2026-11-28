// L116：聊天里图片 / 视频交付卡片的大按钮（.laolao-delivery-card__stage）只装图，没有文字。
// 原来它的名字要等原生「check」回来、mountInlineMedia 里才补上；在那之前（以及原生一直不回时）
// 读屏读到的是一个没名字的按钮，悬停也没提示。这里在假 DOM 里跑真实注入脚本，锁住：
//   1. 卡片一建出来（原生还没回）大按钮就有名字，和原生回来后补的名字一致；
//   2. 卡片里每个按钮都有可读名字（aria-label / title / 可见文字）；
//   3. 反例：名字检查器对「只有图标、没写名字」的按钮确实报错，不是空跑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'ui/injections/laolao-material-preview.js'), 'utf8');

class FakeElement {
  constructor(tag = 'div', text = '') {
    this.tagName = tag.toUpperCase();
    this.textContent = text;
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    const values = new Set();
    this.classList = {
      values,
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      contains: (name) => values.has(name),
      toggle: (name) => (values.has(name) ? (values.delete(name), false) : (values.add(name), true)),
    };
  }
  get className() { return [...this.classList.values].join(' '); }
  set className(value) { this.classList.values.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => this.classList.values.add(name)); }
  get title() { return this.attributes.title || ''; }
  set title(value) { this.attributes.title = String(value); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; }
  removeAttribute(key) { delete this.attributes[key]; }
  hasAttribute(key) { return key in this.attributes; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  dispatchEvent() { return true; }
  append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') node.parent = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') node.parent = this; } this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  replaceWith(node) {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) { parent.children[index] = node; node.parent = parent; }
    this.parent = null;
  }
  remove() { this.removed = true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  get isConnected() { return !this.removed; }
}

// 读屏会读到的名字：aria-label > title > 没被 aria-hidden 藏起来的文字。
function accessibleName(node) {
  const label = (node.getAttribute('aria-label') || '').trim();
  if (label) return label;
  const title = (node.getAttribute('title') || '').trim();
  if (title) return title;
  const text = (current) => {
    if (!current || typeof current !== 'object') return typeof current === 'string' ? current : '';
    if (current.getAttribute?.('aria-hidden') === 'true') return '';
    if (!current.children.length) return current.textContent || '';
    return current.children.map(text).join('');
  };
  return text(node).trim();
}

function buttonsIn(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (node.tagName === 'BUTTON') found.push(node);
  for (const child of node.children || []) buttonsIn(child, found);
  return found;
}

function unnamedButtons(root) {
  return buttonsIn(root).filter((button) => !accessibleName(button)).map((button) => button.className || button.tagName);
}

function runWithCard(materialPath) {
  const card = new FakeElement('div');
  card.className = 'laolao-delivery-card';
  card.setAttribute('data-laolao-material-path', materialPath);
  const posted = [];
  let timer = 0;
  const document = {
    readyState: 'complete',
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    addEventListener() {},
    querySelectorAll(selector) { return String(selector).includes('laolao-delivery-card') ? [card] : []; },
    querySelector() { return null; },
    getElementById() { return null; },
    createElement(tag) { return new FakeElement(tag); },
  };
  const window = {
    innerWidth: 1280,
    innerHeight: 820,
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {},
    setTimeout() { return ++timer; },
    clearTimeout() {},
    webkit: { messageHandlers: { laolaoMaterialPreview: { postMessage(value) { posted.push(value); } } } },
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  vm.runInNewContext(SOURCE, {
    window, document, Element: FakeElement, Node: { TEXT_NODE: 3 }, CustomEvent,
    AbortController, Promise, Map, WeakMap, Set, Date, Math, URL,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
  });
  const stage = () => card.children.find((child) => child?.classList?.contains('laolao-delivery-card__stage')) || null;
  return { card, posted, window, stage };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('图片交付卡片：大按钮一建出来就有名字，不等原生回应', async () => {
  const run = runWithCard('/Users/demo/work/shot.png');
  const stage = run.stage();
  assert.ok(stage, '图片卡片应当有大按钮');
  assert.equal(stage.tagName, 'BUTTON');
  assert.equal(run.posted[0]?.action, 'check', '此时原生检查还没回来');
  assert.equal(stage.getAttribute('aria-label'), '查看大图：shot.png');
  assert.equal(stage.title, '点击查看大图');
  assert.deepEqual(unnamedButtons(run.card), [], '卡片里每个按钮都要有名字');

  // 原生回来后 mountInlineMedia 补的名字和一开始的一致，不会一会儿一个样。
  run.window.__laolaoMaterialPreviewResult({ requestId: run.posted[0].requestId, ok: true, size: 2048 });
  await tick();
  assert.equal(run.stage(), stage);
  assert.equal(stage.getAttribute('aria-label'), '查看大图：shot.png');
  assert.equal(stage.title, '点击查看大图');
  assert.deepEqual(unnamedButtons(run.card), []);
});

test('视频交付卡片：大按钮一建出来就有名字，不等原生回应', async () => {
  const run = runWithCard('/Users/demo/work/clip.mp4');
  const stage = run.stage();
  assert.ok(stage, '视频卡片应当有大按钮');
  assert.equal(run.posted[0]?.action, 'check');
  assert.equal(stage.getAttribute('aria-label'), '播放视频：clip.mp4');
  assert.equal(stage.title, '点击播放');
  assert.deepEqual(unnamedButtons(run.card), []);

  run.window.__laolaoMaterialPreviewResult({ requestId: run.posted[0].requestId, ok: true, size: 4096 });
  await tick();
  assert.equal(stage.getAttribute('aria-label'), '播放视频：clip.mp4');
  assert.equal(stage.title, '点击播放');
  assert.deepEqual(unnamedButtons(run.card), []);
});

test('原生说文件不在：大按钮换回图标，剩下的按钮仍然都有名字', async () => {
  const run = runWithCard('/Users/demo/work/gone.png');
  run.window.__laolaoMaterialPreviewResult({ requestId: run.posted[0].requestId, ok: false, message: '这个文件已经不在原来的位置了。' });
  await tick();
  assert.equal(run.stage(), null, '文件不在时不再留大按钮');
  assert.ok(buttonsIn(run.card).length > 0, '保存 / 显示按钮还在');
  assert.deepEqual(unnamedButtons(run.card), []);
});

test('反例：只有图标、没写名字的按钮会被名字检查器抓出来', () => {
  const bare = new FakeElement('button');
  bare.className = 'icon-only';
  const glyph = new FakeElement('span', '▶');
  glyph.setAttribute('aria-hidden', 'true');
  bare.append(glyph);
  const holder = new FakeElement('div');
  holder.append(bare);
  assert.deepEqual(unnamedButtons(holder), ['icon-only']);

  bare.setAttribute('aria-label', '播放');
  assert.deepEqual(unnamedButtons(holder), []);
});
