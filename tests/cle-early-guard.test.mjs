/**
 * Early guard: the title must be C.le. before the plugin bundle exists.
 *
 * The reported sequence is a race, not a styling problem:
 *
 *   document parsed → module entry runs → router renders → document.title = "New session — OpenClaw"
 *                                                                   ↑ first AX sample is this
 *   …bundle download… → plugin activate() → brand.js starts
 *
 * src/core/brand.js cannot run before its module is evaluated, so the title has to be owned by a
 * classic script that executes during parsing. These tests load the *real* early-guard.js into a
 * DOM and drive that exact order, including the case where the plugin never arrives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const GUARD = path.join(import.meta.dirname, '..', 'services', 'cle-studio', 'static', 'early-guard.js');
const SOURCE = fs.readFileSync(GUARD, 'utf8');

/* ---------- minimal DOM (same shapes the module tests use) ---------- */

class Node {
  constructor(type, name) {
    this.nodeType = type;
    this.nodeName = name;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this._text = type === 3 ? '' : null;
  }
  get nodeValue() { return this._text; }
  set nodeValue(v) { this._text = String(v); notify(this, 'characterData'); }
  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    notify(this, 'childList');
    if (v !== '' && v != null) this.appendChild(new Text(String(v)));
  }
  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    notify(this, 'childList', [child]);
    return child;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === globalThis.document?.documentElement;
  }
  matches(sel) { return matchesSelector(this, sel); }
  closest(sel) {
    let n = this;
    while (n) { if (n.nodeType === 1 && matchesSelector(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (matchesSelector(c, sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

class Text extends Node {
  constructor(v) { super(3, '#text'); this._text = String(v); }
}

class Element extends Node {
  constructor(tag, attrs = {}) {
    super(1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.className = attrs.class ?? '';
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') continue;
      this.attrs.set(key, String(value));
    }
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    notify(this, 'attributes', [], name);
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) {
    this.attrs.delete(name);
    notify(this, 'attributes', [], name);
  }
}

function matchesSelector(node, selector) {
  return selector.split(',').map((s) => s.trim()).some((part) => {
    const m = /^([a-zA-Z0-9-]*)((?:[.#][\w-]+)*)$/.exec(part);
    if (!m) return false;
    const [, tag, rest] = m;
    if (tag && node.localName !== tag.toLowerCase()) return false;
    for (const piece of rest.match(/[.#][\w-]+/g) || []) {
      if (piece.startsWith('.')) { if (!node.className.split(/\s+/).includes(piece.slice(1))) return false; }
    }
    return true;
  });
}

const observers = [];
class MutationObserver {
  constructor(cb) { this.cb = cb; this.active = false; this.targets = []; this.pending = []; observers.push(this); }
  observe(target, options = {}) { this.active = true; this.targets.push({target, options}); }
  disconnect() { this.active = false; this.pending = []; this.targets = []; }
  takeRecords() { const out = this.pending; this.pending = []; return out; }
}
function notify(target, type, added = [], attributeName = null) {
  for (const ob of observers) {
    if (!ob.active) continue;
    for (const {target: root, options} of ob.targets) {
      // real observers honour attributeFilter: a record for another attribute is not delivered
      if (type === 'attributes' && options.attributeFilter && !options.attributeFilter.includes(attributeName)) continue;
      let n = target;
      while (n) {
        if (n === root) {
          if (n === target || options.subtree) {
            // MutationRecord shape: attributeName is present for attribute records
            ob.pending.push({type, target, addedNodes: added, attributeName});
          }
          break;
        }
        n = n.parentNode;
      }
    }
  }
}
async function deliver() {
  for (let round = 0; round < 6; round += 1) {
    let any = false;
    for (const ob of observers) {
      if (!ob.active) continue;
      const records = ob.takeRecords();
      if (!records.length) continue;
      any = true;
      ob.cb(records, ob);
    }
    await Promise.resolve();
    if (!any) break;
  }
}

/* ---------- harness ---------- */

function makeDocument(titleText, {withBody = true} = {}) {
  const html = new Element('html');
  const head = new Element('head');
  const title = new Element('title');
  title.appendChild(new Text(titleText));
  head.appendChild(title);
  html.appendChild(head);
  // During parsing a <head> script runs before the parser has created <body>; the real document
  // reports null there, so the fixture has to be able to reproduce that.
  const body = withBody ? new Element('body') : null;
  if (body) html.appendChild(body);

  const document = {
    documentElement: html,
    head,
    body,
    readyState: withBody ? 'interactive' : 'loading',
    _listeners: [],
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    createTextNode: (v) => new Text(v),
    createElement: (t) => new Element(t),
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') document._listeners.push(fn); },
    /** The parser creating <body> after a <head> script already ran. */
    _appendBody() {
      const created = new Element('body');
      document.body = created;
      document.readyState = 'interactive';
      html.appendChild(created);
      return created;
    },
    _fireDomContentLoaded() {
      for (const fn of document._listeners.splice(0)) fn();
    },
  };
  Object.defineProperty(document, 'title', {
    configurable: true,
    enumerable: true,
    get() { return title.textContent; },
    // Mirrors the browser: assigning replaces the text node inside <title>.
    set(v) { title.textContent = v; },
  });
  document._title = title;
  return document;
}

function loadGuard(document) {
  const sandbox = {
    document,
    MutationObserver,
    console,
    globalThis: undefined,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  // A fresh context per load: the guard's idempotency key lives on its global.
  vm.runInContext(SOURCE, context, {filename: 'early-guard.js'});
  return {sandbox, context};
}

/* ---------- tests ---------- */

test('the title is already C.le. the instant the guard executes, before any plugin code', async () => {
  const document = makeDocument('OpenClaw');
  loadGuard(document);
  assert.equal(document.title, 'C.le.', 'synchronous rewrite on parse');
});

test('the router writing the title first is corrected with no plugin present', async () => {
  // This is the reported sequence: the module entry renders and writes the upstream title while
  // the plugin bundle is still downloading. Nothing else runs in this test.
  const document = makeDocument('C.le.');
  loadGuard(document);
  document.title = 'New session — OpenClaw';
  await deliver();
  assert.equal(document.title, 'New session — C.le.', 'fixed by the early observer alone');
  // and every later navigation too (the sample URL was /chat/project/.../codex-ui-right-…)
  document.title = 'Codex独立验收·右栏状态 — OpenClaw';
  await deliver();
  assert.equal(document.title, 'Codex独立验收·右栏状态 — C.le.');
});

test('the environment suffix appended after the fact is corrected too', async () => {
  const document = makeDocument('C.le.');
  loadGuard(document);
  document.title = 'Chat — C.le.';
  await deliver();
  // applyControlUiPresentation() appends " · <label>" to whatever the title currently is
  document.title = `${document.title} · Production`;
  await deliver();
  assert.equal(document.title, 'Chat — C.le. · Production');
  document.title = 'Chat — OpenClaw · Production';
  await deliver();
  assert.equal(document.title, 'Chat — C.le. · Production');
});

test('a session named after the upstream project keeps its name', async () => {
  const document = makeDocument('OpenClaw');
  loadGuard(document);
  document.title = '关于OpenClaw的笔记 — OpenClaw';
  await deliver();
  assert.equal(document.title, '关于OpenClaw的笔记 — C.le.', 'only the brand position moves');
  document.title = '关于OpenClaw的笔记';
  await deliver();
  assert.equal(document.title, '关于OpenClaw的笔记', 'no native brand position, nothing to rewrite');
});

test('loading the guard twice does not stack observers', async () => {
  const document = makeDocument('C.le.');
  const {context} = loadGuard(document);
  const afterFirst = observers.filter((ob) => ob.active).length;
  // a second <script> of the same file runs in the *same* realm, so the guard's global key is
  // what has to stop it — a fresh sandbox would trivially pass and prove nothing.
  vm.runInContext(SOURCE, context, {filename: 'early-guard.js'});
  const afterSecond = observers.filter((ob) => ob.active).length;
  assert.equal(afterSecond, afterFirst, `observers: ${afterFirst} → ${afterSecond}`);
  // and behaviour is still correct with only one title observer
  document.title = 'New session — OpenClaw';
  await deliver();
  assert.equal(document.title, 'New session — C.le.');
});

test('re-executing the file in the same realm is a no-op', async () => {
  const document = makeDocument('C.le.');
  const {context} = loadGuard(document);
  const before = observers.filter((ob) => ob.active).length;
  vm.runInContext(SOURCE, context, {filename: 'early-guard.js'});
  assert.equal(observers.filter((ob) => ob.active).length, before, 'same global key short-circuits');
});

test('a replaced <title> element is re-attached and still corrected', async () => {
  const document = makeDocument('C.le.');
  loadGuard(document);
  // a document-level rewrite swaps the element wholesale
  const fresh = new Element('title');
  fresh.appendChild(new Text('Split view — OpenClaw'));
  document.head.childNodes.length = 0;
  document.head.appendChild(fresh);
  Object.defineProperty(document, 'title', {
    get() { return fresh.textContent; },
    set(v) { fresh.textContent = v; },
  });
  await deliver();
  assert.equal(document.title, 'Split view — C.le.', 're-attachment picked up the new node');
});

test('the early guard and the plugin guard agree on the same title rules', async () => {
  // Both implement localTitle independently (one must stay dependency-free and tiny). If they
  // disagree, a title could flip back and forth as ownership moves between them.
  const {pathToFileURL} = await import('node:url');
  const mod = await import(pathToFileURL(
    path.join(import.meta.dirname, '..', 'services', 'cle-studio', 'src', 'core', 'brand.js'),
  ).href);
  const document = makeDocument('x');
  const {sandbox} = loadGuard(document);
  const early = sandbox.__cleEarlyBrandGuard.localTitle;
  const inputs = [
    'OpenClaw', 'OpenClaw Control', 'C.le.', '',
    'Main Session — OpenClaw', 'New session — OpenClaw',
    'Main Session — OpenClaw · Production',
    '关于OpenClaw的笔记 — OpenClaw', '关于OpenClaw的笔记',
    'Meeting · Q3 — OpenClaw · Production',
    'Codex独立验收·右栏状态 — OpenClaw',
    'Codex独立验收·右栏状态 — C.le.',
    'learning — OpenClaw', '(3) learning — OpenClaw',
  ];
  for (const input of inputs) {
    assert.equal(early(input), mod.localTitle(input), `disagree on ${JSON.stringify(input)}`);
  }
});

test('shipped as an external same-origin file, not an inline script', () => {
  // CSP here is `script-src 'self'`; an inline script would be blocked and the fix would silently
  // not run. Assert the file is standalone and carries no inline-only assumptions.
  assert.match(SOURCE, /^\/\* C\.le\. early guard/u);
  assert.doesNotMatch(SOURCE, /<script/u, 'the file itself contains no markup');
  // no eval / Function constructor: the gateway CSP forbids unsafe-eval and a review would
  // reject it anyway
  assert.doesNotMatch(SOURCE, /\beval\s*\(|new Function\s*\(/u);
  assert.ok(fs.statSync(GUARD).size < 16_384, 'small enough to load synchronously');
});

test('the disconnected-state title keeps its prefix and session name, and only moves the brand', async () => {
  // Real failure path (22:00 UTC): the host ended activation, and every title update during the
  // disconnect read
  //   "(已断开连接) Codex独立验收·右栏状态 — OpenClaw"
  // until reconnect. The prefix and the session name are the user's; only the brand tail moves.
  const document = makeDocument('C.le.');
  loadGuard(document);
  const cases = [
    ['(已断开连接) Codex独立验收·右栏状态 — OpenClaw', '(已断开连接) Codex独立验收·右栏状态 — C.le.'],
    ['(已断开连接) 关于OpenClaw的笔记 — OpenClaw', '(已断开连接) 关于OpenClaw的笔记 — C.le.'],
    ['(已断开连接) Chat — OpenClaw · Production', '(已断开连接) Chat — C.le. · Production'],
    ['(3) (已断开连接) Chat — OpenClaw', '(3) (已断开连接) Chat — C.le.'],
  ];
  for (const [input, want] of cases) {
    document.title = input;
    await deliver();
    assert.equal(document.title, want, `disconnected form ${JSON.stringify(input)}`);
  }
});

test('the guard keeps working when the plugin is never activated or has been unloaded', async () => {
  // The early guard is a page-level classic script: nothing in the plugin teardown reaches it.
  // This test never loads brand.js at all — it stands in for "activation ended, router still
  // updating the title".
  const document = makeDocument('New session — OpenClaw');
  loadGuard(document);
  assert.equal(document.title, 'New session — C.le.', 'title owned before any plugin code ran');

  // plugin would have been unloaded here; the title keeps being rewritten by the native router
  for (const next of [
    '(已断开连接) Codex独立验收·右栏状态 — OpenClaw',
    'Codex独立验收·右栏状态 — OpenClaw',
    '(已断开连接) Chat — OpenClaw · Production',
  ]) {
    document.title = next;
    await deliver();
    assert.doesNotMatch(document.title, /— OpenClaw/u, `still correcting: ${document.title}`);
  }
});

test('the guard survives a document-level title reset without a plugin', async () => {
  const document = makeDocument('C.le.');
  loadGuard(document);
  // a full replacement of <title> text, as a router render does
  document._title.textContent = '';
  document._title.appendChild(new Text('Sidebar — OpenClaw'));
  await deliver();
  assert.equal(document.title, 'Sidebar — C.le.');
});

/* ---------- product chrome across the plugin lifecycle ---------- */

/** Build the sidebar exactly as control-ui-boot-shared renders it. */
function makeSidebar(document, {name = 'OpenClaw'} = {}) {
  const header = new Element('div', {class: 'sidebar-workspace-header'});
  const button = new Element('button', {class: 'sidebar-workspace-header__main'});
  button.setAttribute('aria-label', `${name} · 工作区菜单`);
  const mark = new Element('span', {class: 'sidebar-workspace-header__mark'});
  const text = new Element('span', {class: 'sidebar-agent-card__text'});
  const nameWrap = new Element('span', {class: 'sidebar-agent-card__name'});
  const marquee = new Element('span', {class: 'sidebar-agent-card__name-text hover-marquee'});
  marquee.appendChild(new Text(name));
  nameWrap.appendChild(marquee);
  text.appendChild(nameWrap);
  button.appendChild(mark);
  button.appendChild(text);
  header.appendChild(button);
  document.body.appendChild(header);
  return {header, button, marquee};
}

test('the workspace label is rebranded at first paint, before any plugin code', async () => {
  const document = makeDocument('C.le.');
  const {button} = makeSidebar(document, {name: 'OpenClaw'});
  loadGuard(document);
  assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单');
});

test('the label is rebranded again after the plugin retires and the app restores it', async () => {
  // The reported failure: a disconnect ends activation, the plugin's guard is gone, and the native
  // sidebar re-render put the upstream name back — visible in the first disconnected AX sample.
  const document = makeDocument('C.le.');
  const {button} = makeSidebar(document, {name: 'OpenClaw'});
  loadGuard(document);
  assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单');

  // the native app re-renders the label verbatim; no plugin is alive to help
  button.setAttribute('aria-label', 'OpenClaw · 工作区菜单');
  await deliver();
  assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单', 'page-level guard still owns it');
});

test('an attribute-only label update is corrected without any other DOM change', async () => {
  const document = makeDocument('C.le.');
  const {button} = makeSidebar(document, {name: 'C.le.'});
  loadGuard(document);
  button.setAttribute('aria-label', 'OpenClaw · 工作区菜单');
  await deliver();
  assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单');
});

test('the fallback marker follows the name slot, and clears for a chosen name', async () => {
  const document = makeDocument('C.le.');
  const {marquee} = makeSidebar(document, {name: 'OpenClaw'});
  loadGuard(document);
  assert.equal(marquee.hasAttribute('data-cle-fallback'), true, 'fallback is marked so CSS brands it');

  // the gateway answers with the user's own name (assigning textContent replaces the subtree,
  // which is what a Lit re-render does and what the observer actually sees)
  marquee.textContent = '碧琪的工作区';
  await deliver();
  assert.equal(marquee.hasAttribute('data-cle-fallback'), false, 'a chosen name keeps its own glyphs');
  assert.equal(marquee.textContent, '碧琪的工作区', 'and is not rewritten');

  // and it re-marks if the app falls back again (e.g. after a disconnect clears the identity)
  marquee.textContent = 'OpenClaw';
  await deliver();
  assert.equal(marquee.hasAttribute('data-cle-fallback'), true);
});

test('a user-named agent keeps its label across every sync', async () => {
  const document = makeDocument('C.le.');
  const {button} = makeSidebar(document, {name: 'OpenClaw Notes'});
  loadGuard(document);
  assert.equal(button.getAttribute('aria-label'), 'OpenClaw Notes · 工作区菜单');
  await deliver();
  assert.equal(button.getAttribute('aria-label'), 'OpenClaw Notes · 工作区菜单');
  button.setAttribute('aria-label', 'OpenClaw Notes · 工作区菜单');
  await deliver();
  assert.equal(button.getAttribute('aria-label'), 'OpenClaw Notes · 工作区菜单');
});

test('the chrome rules and the plugin rules agree on every label shape', async () => {
  const {pathToFileURL} = await import('node:url');
  const mod = await import(pathToFileURL(
    path.join(import.meta.dirname, '..', 'services', 'cle-studio', 'src', 'core', 'brand.js'),
  ).href);
  const document = makeDocument('x');
  const {sandbox} = loadGuard(document);
  const early = sandbox.__cleEarlyBrandGuard.localLabel;
  const inputs = [
    'OpenClaw · 工作区菜单', 'OpenClaw · 智能体菜单', 'OpenClaw',
    'OpenClaw Control', 'OpenClaw Control · 工作区菜单',
    'OpenClaw Notes · 工作区菜单', 'My OpenClaw · 工作区菜单',
    'OpenClaw Controls · 工作区菜单', '碧琪 · 工作区菜单', '',
  ];
  for (const input of inputs) {
    assert.equal(early(input), mod.localLabel(input), `disagree on ${JSON.stringify(input)}`);
  }
  // and the round trip is stable
  for (const input of inputs) {
    const once = mod.localLabel(input);
    assert.equal(mod.localLabel(once), once, `not idempotent: ${JSON.stringify(input)}`);
  }
});

test('messages, code and third-party labels are never rewritten', async () => {
  const document = makeDocument('C.le.');
  // a user message that mentions the product, and an unrelated labelled control
  const chat = new Element('div', {class: 'chat-group'});
  const bubble = new Element('div', {class: 'chat-text'});
  bubble.appendChild(new Text('OpenClaw 是上游项目名'));
  chat.appendChild(bubble);
  document.body.appendChild(chat);
  const other = new Element('button', {class: 'third-party-action'});
  other.setAttribute('aria-label', 'OpenClaw · 第三方控件');
  document.body.appendChild(other);

  loadGuard(document);
  await deliver();
  assert.equal(bubble.textContent, 'OpenClaw 是上游项目名', 'user message intact');
  assert.equal(other.getAttribute('aria-label'), 'OpenClaw · 第三方控件', 'third-party label untouched');
});

/* ---------- real parse order: the guard runs before <body> exists ---------- */

test('the chrome observer attaches even though document.body is null at parse time', async () => {
  // The published script is a synchronous classic <head> script: the parser has created <html> and
  // <head> but not <body>. The earlier version guarded the observer with `if (document.body)`, so
  // on a cold boot it never attached and every later label change went unguarded.
  const document = makeDocument('C.le.', {withBody: false});
  assert.equal(document.body, null, 'fixture reproduces the parse-time state');

  loadGuard(document, {expectGlobal: true});
  assert.ok(
    observers.some((observer) => observer.active && observer.targets.some(({target}) => target === document.documentElement)),
    'chrome observer is attached to documentElement',
  );

  // the parser now creates <body> and the app appends the sidebar
  const body = document._appendBody();
  const header = new Element('div', {class: 'sidebar-workspace-header'});
  const button = new Element('button', {class: 'sidebar-workspace-header__main'});
  button.setAttribute('aria-label', 'OpenClaw · 工作区菜单');
  const textWrap = new Element('span', {class: 'sidebar-agent-card__text'});
  const nameWrap = new Element('span', {class: 'sidebar-agent-card__name'});
  const slot = new Element('span', {class: 'sidebar-agent-card__name-text hover-marquee'});
  slot.appendChild(new Text('OpenClaw'));
  nameWrap.appendChild(slot);
  textWrap.appendChild(nameWrap);
  button.appendChild(textWrap);
  header.appendChild(button);
  body.appendChild(header);

  await deliver();
  assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单', 'first label is caught before paint');
  assert.equal(slot.hasAttribute('data-cle-fallback'), true, 'fallback marked for the wordmark rule');
});

test('after a cold boot the label still holds once the plugin never activated, and after it retires', async () => {
  const document = makeDocument('C.le.', {withBody: false});
  loadGuard(document, {expectGlobal: true});
  const body = document._appendBody();

  const makeHeader = (label) => {
    const header = new Element('div', {class: 'sidebar-workspace-header'});
    const button = new Element('button', {class: 'sidebar-workspace-header__main'});
    button.setAttribute('aria-label', label);
    header.appendChild(button);
    body.appendChild(header);
    return button;
  };

  // 1. plugin never activates: the app renders its own sidebar
  const first = makeHeader('OpenClaw · 工作区菜单');
  await deliver();
  assert.equal(first.getAttribute('aria-label'), 'C.le. · 工作区菜单');

  // 2. plugin retires (no activate ever happened) and the app restores the label verbatim
  first.setAttribute('aria-label', 'OpenClaw · 工作区菜单');
  await deliver();
  assert.equal(first.getAttribute('aria-label'), 'C.le. · 工作区菜单', 'still owned after teardown');

  // 3. a later reconnect re-renders the whole header
  first.parentNode.childNodes.length = 0;
  const second = makeHeader('OpenClaw · 工作区菜单');
  await deliver();
  assert.equal(second.getAttribute('aria-label'), 'C.le. · 工作区菜单', 'new node caught too');
});

test('a cold-boot guard does not touch message text inserted afterwards', async () => {
  const document = makeDocument('C.le.', {withBody: false});
  loadGuard(document, {expectGlobal: true});
  const body = document._appendBody();

  const chat = new Element('div', {class: 'chat-group'});
  const bubble = new Element('div', {class: 'chat-text'});
  bubble.appendChild(new Text('OpenClaw 是上游项目名'));
  chat.appendChild(bubble);
  body.appendChild(chat);
  await deliver();
  assert.equal(bubble.textContent, 'OpenClaw 是上游项目名', 'user content untouched');
});

test('a cold-boot guard is bounded: unrelated insertions schedule no pass', async () => {
  const document = makeDocument('C.le.', {withBody: false});
  loadGuard(document, {expectGlobal: true});
  const body = document._appendBody();

  let passes = 0;
  const original = Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll = function patched(selector) {
    if (String(selector).includes('aria-label')) passes += 1;
    return original.call(this, selector);
  };
  try {
    for (let i = 0; i < 5; i += 1) {
      const junk = new Element('div', {class: 'unrelated'});
      junk.appendChild(new Text(`row ${i}`));
      body.appendChild(junk);
    }
    await deliver();
  } finally {
    Element.prototype.querySelectorAll = original;
  }
  assert.equal(passes, 0, 'no chrome pass for unrelated nodes');
});

test('the guard still catches the DOMContentLoaded pass without missing the module render', async () => {
  // DOMContentLoaded fires after parsing and before the deferred module executes, so a pass there
  // is still early enough; assert it runs and is idempotent with the observer's pass.
  const document = makeDocument('C.le.', {withBody: false});
  loadGuard(document, {expectGlobal: true});
  const body = document._appendBody();
  const header = new Element('div', {class: 'sidebar-workspace-header'});
  const button = new Element('button', {class: 'sidebar-workspace-header__main'});
  button.setAttribute('aria-label', 'OpenClaw · 工作区菜单');
  header.appendChild(button);
  body.appendChild(header);

  document._fireDomContentLoaded();
  assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单');
  await deliver();
  assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单', 'no double rewrite / no churn');
});

