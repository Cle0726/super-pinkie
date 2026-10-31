// 演示工具的真实行为：在最小 DOM/Canvas 桩里跑 static/legacy/laolao-laser-pointer.js，
// 用键盘事件驱动它，验证 1-5 切工具、⌘Z 撤销、Esc 退出后不留覆盖层。
// 目的是确认"融合只改了外观"——快捷键、撤销与清理没有被样式改动影响。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../services/cle-studio/static/legacy/laolao-laser-pointer.js'), 'utf8');

function makeCtx2d() {
  const noop = () => {};
  return new Proxy({}, {
    get: (target, key) => {
      if (key === 'canvas') return {width: 1280, height: 800};
      if (key === 'createRadialGradient' || key === 'createLinearGradient') {
        return () => ({addColorStop: noop});
      }
      if (key === 'measureText') return () => ({width: 10});
      if (key in target) return target[key];
      return noop;
    },
    set: (target, key, value) => { target[key] = value; return true; },
  });
}

function boot() {
  const listeners = new Map();
  const add = (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]);
  const fire = (type, event) => {
    for (const fn of listeners.get(type) || []) fn(event);
  };

  class El {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.style = {setProperty() {}, removeProperty() {}};
      this._listeners = new Map();
      this.hidden = false;
      this.classList = {
        set: new Set(),
        add: (...c) => c.forEach((x) => this.classList.set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList.set.delete(x)),
        toggle: (c, on) => { (on ?? !this.classList.set.has(c)) ? this.classList.set.add(c) : this.classList.set.delete(c); },
        contains: (c) => this.classList.set.has(c),
      };
      this.parentElement = null;
      this.isConnected = true;
      this.offsetWidth = 276;
      this.textContent = '';
    }
    set id(v) { this.attributes.set('id', String(v)); }
    get id() { return this.attributes.get('id') || ''; }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); this._cls = v; }
    get className() { return [...this.classList.set].join(' '); }
    set innerHTML(v) { this._html = v; this.children = []; }
    get innerHTML() { return this._html || ''; }
    append(...nodes) { for (const n of nodes.flat()) if (n) { n.parentElement = this; this.children.push(n); } }
    prepend(n) { n.parentElement = this; this.children.unshift(n); }
    before(n) { const p = this.parentElement; if (p) { const i = p.children.indexOf(this); n.parentElement = p; p.children.splice(i, 0, n); } }
    remove() { const p = this.parentElement; if (p) p.children = p.children.filter((c) => c !== this); this.isConnected = false; }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    removeAttribute(k) { this.attributes.delete(k); }
    addEventListener(t, fn) { this._listeners.set(t, [...(this._listeners.get(t) || []), fn]); }
    removeEventListener(t, fn) {
      this._listeners.set(t, (this._listeners.get(t) || []).filter((f) => f !== fn));
    }
    dispatchEvent(ev) { for (const fn of this._listeners.get(ev.type) || []) fn(ev); return true; }
    getBoundingClientRect() { return {left: 10, top: 700, right: 40, bottom: 730, width: 30, height: 30}; }
    getContext() { return makeCtx2d(); }
    focus() {}
    closest() { return null; }
    querySelector(sel) {
      const want = String(sel).replace(/^[.#]/, '');
      const hit = walk(this).slice(1).find((el) => (String(sel).startsWith('.')
        ? el.className.split(/\s+/).includes(want)
        : el.attributes.get('id') === want));
      return hit || null;
    }
    querySelectorAll() { return []; }
    setPointerCapture() {}
  }

  const body = new El('body');
  const head = new El('head');
  const html = new El('html');
  const doc = {
    body, head, documentElement: html,
    readyState: 'complete',
    createElement: (t) => new El(t),
    createElementNS: (ns, t) => new El(t),
    getElementById: (id) => walk(body).find((el) => el.attributes.get('id') === id) || null,
    // 模块用 querySelector('.sidebar-shell__footer') 找入口挂载点
    querySelector: (sel) => {
      const want = sel.replace(/^[.#]/, '');
      return walk(body).find((el) => (sel.startsWith('.') ? el.className.split(/\s+/).includes(want) : el.attributes.get('id') === want)) || null;
    },
    querySelectorAll: () => [],
    addEventListener: add,
    removeEventListener: () => {},
  };
  // 侧栏 footer 是入口挂载点
  const footer = new El('div');
  footer.className = 'sidebar-shell__footer';
  const bar = new El('div');
  bar.className = 'sidebar-footer-bar';
  footer.append(bar);
  body.append(footer);

  const window = {
    document: doc,
    addEventListener: add,
    removeEventListener: () => {},
    matchMedia: () => ({matches: false}),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: () => 0,
    setTimeout: (fn) => 0,
    clearTimeout: () => {},
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    localStorage: {getItem: () => null, setItem: () => {}},
    location: {href: 'http://127.0.0.1:19789/'},
  };

  const sandbox = {
    window, document: doc, console,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    setInterval: window.setInterval,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    clearInterval: () => {},
    performance: {now: () => 1000},
    navigator: {},
    NodeFilter: {SHOW_TEXT: 4},
    CSS: {escape: (s) => s},
    structuredClone: (v) => JSON.parse(JSON.stringify(v)),
    DevicePixelRatio: 1,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {sandbox, window, doc, body, html, fire, bar, El};
}

function walk(el, out = []) {
  out.push(el);
  for (const c of el.children || []) walk(c, out);
  return out;
}

const laserOn = (html) => html.classList.contains('laolao-laser-on');

test('1-5 切换工具，⌘Z 撤销，Esc 退出并清理覆盖层与工具条', () => {
  const {sandbox, doc, html, body, fire} = boot();
  const api = sandbox.window.__laolaoLaser;
  assert.ok(api, '模块应导出调试句柄');

  api.on();
  assert.equal(laserOn(html), true, '打开后应隐藏原生光标');
  assert.ok(body.children.some((c) => c.id === 'pinkie-laser-canvas'), '应挂上覆盖画布');

  const key = (k, extra = {}) => fire('keydown', {
    key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    target: {closest: () => null}, preventDefault() {}, ...extra,
  });

  key('2');
  assert.equal(api.tool(), 'pen');
  key('3');
  assert.equal(api.tool(), 'hl');
  key('4');
  assert.equal(api.tool(), 'spot');
  key('1');
  assert.equal(api.tool(), 'laser');

  // 画笔落一笔后 ⌘Z 应能撤回
  fire('pointerdown', {button: 0, clientX: 100, clientY: 100, target: {closest: () => null}});
  fire('pointermove', {clientX: 140, clientY: 100, screenX: 140, screenY: 100, target: {closest: () => null}});
  fire('pointerup', {});
  api.setTool('pen');
  fire('pointerdown', {button: 0, clientX: 200, clientY: 200, target: {closest: () => null}});
  fire('pointermove', {clientX: 260, clientY: 260, screenX: 260, screenY: 260, target: {closest: () => null}});
  fire('pointerup', {});
  const before = api.strokes();
  assert.ok(before >= 1, '应记录到笔画');
  key('z', {metaKey: true});
  assert.equal(api.strokes(), before - 1, '⌘Z 撤销最后一笔');

  // 输入框里的 ⌘Z 不能被劫持
  const guarded = key('z', {metaKey: true, target: {closest: (sel) => (/textarea/.test(sel) ? {} : null)}});
  assert.equal(api.strokes(), before - 1, '在输入框内不处理撤销');

  key('Escape');
  assert.equal(laserOn(html), false, '退出后恢复光标');
  assert.ok(!body.children.some((c) => c.id === 'pinkie-laser-canvas'), '画布已移除');
  assert.equal(doc.querySelector('#pinkie-laser-toolbar'), null);
});

test('入口挂进原生 footer，按下态与引擎状态一致', () => {
  const {sandbox, body, El} = boot();
  const entry = walk(body).find((el) => el.attributes.get('id') === 'pinkie-laser-entry');
  assert.ok(entry, '入口应挂到 sidebar footer');
  assert.match(entry.className, /sidebar-footer-icon/);
  assert.equal(entry.getAttribute('aria-pressed'), 'false');
  entry.dispatchEvent({type: 'click', preventDefault() {}, stopPropagation() {}});
  assert.equal(sandbox.window.__laolaoLaser.active(), true);
  assert.equal(entry.getAttribute('aria-pressed'), 'true');
});
