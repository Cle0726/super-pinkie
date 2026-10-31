// Real behaviour of the ported browser entry in the new plugin.
//
// These tests exercise the module that actually ships in services/cle-studio
// (not the original ui/injections copy), because that is where the split-pane
// and native-bridge regressions live. Two things are load-bearing:
//   1. every visible pane owns its own launcher button (one global id moved
//      between panes made the other side silently lose its tool), and
//   2. without window.webkit the module must say "in-page preview" instead of
//      pretending the native floating browser opened.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../services/cle-studio/static/legacy/laolao-link-viewer.js'),
  'utf8',
);

function el(tag = 'div', className = '') {
  const node = {
    tagName: tag.toUpperCase(),
    className,
    children: [],
    parentElement: null,
    dataset: {},
    attributes: new Map(),
    listeners: {},
    removed: false,
    id: '',
    textContent: '',
    style: {},
    classList: {add() {}, remove() {}, toggle() {}, contains: () => false},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    append(...nodes) { nodes.forEach((n) => node.appendChild(n)); },
    appendChild(n) { n.parentElement = node; node.children.push(n); return n; },
    insertBefore(n, ref) {
      n.parentElement = node;
      const at = ref ? node.children.indexOf(ref) : -1;
      if (at >= 0) node.children.splice(at, 0, n); else node.children.push(n);
      return n;
    },
    removeChild(n) { const i = node.children.indexOf(n); if (i >= 0) node.children.splice(i, 1); n.parentElement = null; },
    remove() { node.removed = true; node.parentElement?.removeChild?.(node); },
    addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
    setAttribute(name, value) { node.attributes.set(name, String(value)); },
    getAttribute(name) { return node.attributes.get(name) ?? null; },
    hasAttribute(name) { return node.attributes.has(name); },
    closest() { return null; },
    getBoundingClientRect() { return {width: 300, height: 40, left: 0, right: 300, top: 0, bottom: 40}; },
  };
  return node;
}

// A pane as the real Lit shell renders it: .chat-pane-cache__pane containing a
// composer lead. `inert` panes are cached but not shown.
function pane({lead = true, inert = false} = {}) {
  const p = el('openclaw-chat-pane', 'chat-pane-cache__pane');
  if (inert) p.attributes.set('inert', '');
  if (lead) {
    const leadNode = el('div', 'agent-chat__composer-lead');
    leadNode.querySelector = (selector) => {
      if (selector === ':scope > .laolao-browser-entry') {
        return leadNode.children.find((c) => c.className === 'laolao-browser-entry') || null;
      }
      if (selector === '#pinkie-party-entry') {
        return leadNode.children.find((c) => c.id === 'pinkie-party-entry') || null;
      }
      return null;
    };
    p.appendChild(leadNode);
    p.lead = leadNode;
  }
  p.querySelector = (selector) => {
    if (selector === '.agent-chat__composer-lead') return p.lead || null;
    if (selector === '.chat-workspace-rail') return null;
    if (selector === ':scope > .laolao-browser-entry') {
      return p.children.find((c) => c.className === 'laolao-browser-entry') || null;
    }
    return null;
  };
  return p;
}

function run({panes, bridge}, {body = el('body')} = {}) {
  const posts = [];
  const appended = [];
  const timers = [];
  const observers = [];
  const document = {
    body,
    readyState: 'complete',
    documentElement: el('html'),
    head: el('head'),
    listeners: {},
    addEventListener(type, fn) { (document.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    getElementById() { return null; },
    createElement(tag) { return el(tag); },
    querySelector(selector) {
      if (selector === '.agent-chat__composer-lead') return panes.map((p) => p.lead).find(Boolean) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.chat-pane-cache__pane') return panes;
      return [];
    },
    // Observers fire synchronously in tests so a pane added later is visible
    // without waiting for the 1.5s poll.
    observer: null,
  };
  class TestMutationObserver {
    constructor(cb) { document.observer = cb; observers.push(cb); }
    observe() {}
    disconnect() {}
  }
  const window = {
    location: {href: 'http://127.0.0.1:19789/chat'},
    addEventListener() {},
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    innerWidth: 1400,
    innerHeight: 900,
    navigator: {userAgent: 'Macintosh'},
    webkit: bridge
      ? {messageHandlers: {laolaoBrowserWorkspace: {postMessage: (m) => posts.push(m)}}}
      : undefined,
  };
  const context = {
    document,
    window,
    navigator: window.navigator,
    location: window.location,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    CustomEvent: class {},
    MutationObserver: TestMutationObserver,
    URL,
    console,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return {posts, timers, document, window, appended, observers};
}

const entries = (p) => p.lead?.children.filter((c) => c.className === 'laolao-browser-entry') || [];

test('both split panes get their own browser entry and neither loses it', () => {
  const left = pane();
  const right = pane();
  const {posts} = run({panes: [left, right], bridge: true});

  assert.equal(entries(left).length, 1, 'left pane keeps exactly one launcher');
  assert.equal(entries(right).length, 1, 'right pane keeps exactly one launcher');
  // Distinct DOM nodes: no shared global id being re-parented.
  assert.notEqual(entries(left)[0], entries(right)[0]);
  assert.equal(entries(left)[0].id, '', 'launcher must not rely on one global id');

  // Both open the same native workspace through the script bridge.
  entries(right)[0].listeners.click[0]({preventDefault() {}, stopPropagation() {}});
  // Objects created inside the vm realm are not reference-equal to host
  // literals; compare the serialised message instead.
  assert.equal(JSON.stringify(posts), JSON.stringify([{action: 'open'}]));
});

test('cached inert panes are left alone rather than mounting hidden tools', () => {
  const visible = pane();
  const cached = pane({inert: true});
  run({panes: [visible, cached], bridge: true});
  assert.equal(entries(visible).length, 1);
  assert.equal(entries(cached).length, 0, 'inert pane must not grow a tool row');
});

test('a remount is idempotent and does not stack duplicate buttons', () => {
  const left = pane();
  const {timers} = run({panes: [left], bridge: true});
  const before = entries(left).length;
  // setInterval mount + the click-driven remount both run the same sync.
  for (const tick of timers) tick();
  for (const tick of timers) tick();
  assert.equal(entries(left).length, before);
  assert.equal(before, 1);
});

test('without a native bridge the entry advertises an in-page preview', () => {  const left = pane();
  const {posts, timers, document} = run({panes: [left], bridge: false});
  const button = entries(left)[0];
  assert.equal(button.dataset.native, 'false');
  assert.match(button.title, /页内预览/);
  assert.doesNotMatch(button.title, /原生浏览器工作区/);

  button.listeners.click[0]({preventDefault() {}, stopPropagation() {}});
  assert.equal(posts.length, 0, 'must not post to a bridge that does not exist');

  // The fallback viewer labels itself honestly instead of claiming a floating
  // native window. It is created lazily on that click.
  const viewer = document.body.children.find((c) => c.id === 'laolao-link-viewer');
  assert.ok(viewer, 'fallback viewer opens');
  assert.match(viewer.getAttribute('aria-label'), /页内预览/);
  const header = viewer.children[0];
  const note = header.children.find((c) => c.className === 'laolao-link-viewer__mode');
  assert.ok(note, 'fallback header states the real capability');
  assert.match(note.textContent, /页内预览/);
});

test('fallback text explains a refused embed is not a native-workspace failure', () => {
  assert.match(source, /这不是原生浮窗失败/);
  assert.match(source, /没有 App 浏览器桥/);
});

test('a pane added by splitting gets its entry on the next mutation, not 1.5s later', () => {
  const first = pane();
  const {document, observers} = run({panes: [first], bridge: true});
  assert.equal(observers.length, 1, 'a mutation observer is installed for pane caches');

  // 打开分屏：新 pane 插入到同一个 document 里。
  const second = pane();
  document.querySelectorAll = ((original) => (selector) =>
    selector === '.chat-pane-cache__pane' ? [first, second] : original(selector))(document.querySelectorAll);
  // No timer tick: only the observer runs.
  document.observer();

  assert.equal(entries(second).length, 1, 'split pane is usable immediately');
  assert.equal(entries(first).length, 1, 'existing pane is not duplicated');
});
