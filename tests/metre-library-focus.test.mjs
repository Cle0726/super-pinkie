// B63 复发防护（不开浏览器）：作品库「在工作台打开」键开出只读预览、再关掉以后，焦点要回到这个键上。
// WebKit / WKWebView 里鼠标点按钮不给它焦点，点的那一刻 document.activeElement 是 body；
// 修之前 openPreview 记的是 document.activeElement，关掉后焦点落回页面顶上。
// 浏览器里的同一件事在 tests/metre-library.test.mjs 的 B63 用例里（macOS WebKit CI 跑）；这里用一个极小的假 DOM
// 在 node:vm 里跑真的 laolao-metre-library.js，任何机器上都能抓住回退。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const source = fs.readFileSync(fileURLToPath(new URL('../ui/injections/laolao-metre-library.js', import.meta.url)), 'utf8');

// ---------- 极小的假 DOM：只够这个注入文件用 ----------
function makeDom() {
  const listeners = new WeakMap();
  const on = (target, type, fn) => {
    if (!listeners.has(target)) listeners.set(target, new Map());
    const map = listeners.get(target);
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const off = (target, type, fn) => {
    const list = listeners.get(target)?.get(type);
    const at = list ? list.indexOf(fn) : -1;
    if (at >= 0) list.splice(at, 1);
  };
  // 返回 true 表示有人 stopPropagation / stopImmediatePropagation，冒泡到此为止
  const fire = (target, event) => {
    let stopped = false;
    event.preventDefault ??= () => {};
    event.stopImmediatePropagation = () => { stopped = true; };
    event.stopPropagation = () => { stopped = true; };
    for (const fn of [...(listeners.get(target)?.get(event.type) || [])]) { fn.call(target, event); if (stopped) break; }
    return stopped;
  };
  const document = {activeElement: null};
  class Node {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.children = []; this.parentElement = null;
      this.className = ''; this.attrs = {}; this.dataset = {}; this.hidden = false; this._text = '';
    }
    get classList() { const names = () => this.className.split(/\s+/).filter(Boolean); return {contains: c => names().includes(c)}; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this._text = String(v); this.children = []; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
    append(...nodes) { for (const n of nodes) { n.remove(); n.parentElement = this; this.children.push(n); } }
    after(node) { node.remove(); const p = this.parentElement; node.parentElement = p; p.children.splice(p.children.indexOf(this) + 1, 0, node); }
    remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
    get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n === document.documentElement; }
    matches(sel) {
      if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
      const m = /^([\w-]+)(?:\[([\w-]+)\])?$/.exec(sel);
      return Boolean(m) && this.tagName === m[1].toUpperCase() && (!m[2] || this.getAttribute(m[2]) !== null);
    }
    querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const hit = c.querySelector(sel); if (hit) return hit; } return null; }
    closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
    addEventListener(type, fn) { on(this, type, fn); }
    removeEventListener(type, fn) { off(this, type, fn); }
    dispatchEvent(event) {
      event.target ??= this;
      const path = []; for (let n = this; n; n = n.parentElement) path.push(n);   // 先定好冒泡路径：监听里删了节点也照样冒
      for (const n of path) if (fire(n, event)) break;
      return true;
    }
    // 脚本 click()：和 WebKit 鼠标点按钮一样，只发 click，不挪焦点
    click() { this.dispatchEvent({type: 'click'}); }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = document.body; }
  }
  document.createElement = tag => new Node(tag);
  document.documentElement = new Node('html');
  document.documentElement.setAttribute('data-laolao-mode', 'metre');
  document.body = new Node('body');
  document.documentElement.append(document.body);
  document.activeElement = document.body;
  document.querySelector = sel => document.documentElement.querySelector(sel);
  const reads = [];
  const window = {
    document,
    location: {search: '?session=agent%3Ametre%3Atest'},
    URLSearchParams,
    requestAnimationFrame: fn => { fn(); return 1; },
    addEventListener: (type, fn) => on(window, type, fn),
    removeEventListener: (type, fn) => off(window, type, fn),
    dispatchEvent: event => { event.target ??= window; fire(window, event); return true; },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    __laolaoSidebar: {gwRequest: async (method, params = {}) => {
      if (method === 'pinkie.fs.status') return {root: '/proj', bound: true};
      if (method === 'pinkie.fs.read') { reads.push(params.path); return {kind: 'text', content: 'text of ' + params.path, path: params.path, readOnly: true, truncated: false}; }
      return {};
    }},
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(source, window, {filename: 'laolao-metre-library.js'});
  return {window, document, reads};
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

// 照作品库查看器的结构搭一个（.pinkie-art-viewer > .pinkie-art-view > header > 版本标签 + actions），再发它会发的事件
async function viewerWithKey(dom, path = '/proj/notes.md') {
  const {window, document} = dom;
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n; };
  const mask = el('div', 'pinkie-art-viewer');
  const view = el('section', 'pinkie-art-view');
  const header = el('header');
  const actions = el('div', 'pinkie-art-view__actions');
  header.append(el('span', 'pinkie-art-versions__label', '版本 2 / 2'), actions);
  view.append(header);
  mask.append(view);
  document.body.append(mask);
  window.dispatchEvent(new window.CustomEvent('pinkie:art-viewer', {detail: {item: {id: 'a1', path, kind: 'doc'}, actions}}));
  await flush();
  const key = view.querySelector('.pk-mlib-open');
  assert.ok(key, 'the key is there (Metre, text artifact inside the project)');
  return key;
}
const preview = dom => dom.document.body.querySelector('.pk-mlib-preview');

test('B63: the key was clicked without getting focus (WebKit mouse); Esc closes the preview and focus goes back to the key, not body', async () => {
  const dom = makeDom();
  const key = await viewerWithKey(dom);
  assert.ok(dom.document.activeElement === dom.document.body, 'precondition: like a WebKit mouse click, nothing focused the key');
  key.click();
  await flush();
  assert.ok(preview(dom), 'no workbench here, so the read-only preview opens');
  assert.deepEqual(dom.reads, ['/proj/notes.md']);
  assert.ok(dom.document.activeElement?.classList.contains('pk-mlib-preview__close'), 'focus moves into the preview');
  dom.window.dispatchEvent({type: 'keydown', key: 'Escape'});
  assert.equal(preview(dom), null, 'Esc closes it');
  assert.ok(dom.document.activeElement === key, 'Esc: focus goes back to the key, not body (now on ' + dom.document.activeElement?.tagName + ')');
});

test('B63: same with the × button', async () => {
  const dom = makeDom();
  const key = await viewerWithKey(dom);
  key.click();
  await flush();
  preview(dom).querySelector('.pk-mlib-preview__close').click();
  assert.equal(preview(dom), null, '× closes it');
  assert.ok(dom.document.activeElement === key, '×: focus goes back to the key, not body (now on ' + dom.document.activeElement?.tagName + ')');
});

test('a direct openPreview(path) call without an opener still returns focus to whatever had it (unchanged)', async () => {
  const dom = makeDom();
  const other = dom.document.createElement('button');
  dom.document.body.append(other);
  other.focus();
  assert.equal(await dom.window.Pinkie.metreLibrary.openPreview('/proj/a.md'), 'text');
  assert.ok(dom.document.activeElement?.classList.contains('pk-mlib-preview__close'));
  dom.window.Pinkie.metreLibrary.closePanel();
  assert.ok(dom.document.activeElement === other, 'focus goes back to the button that had it');
});
