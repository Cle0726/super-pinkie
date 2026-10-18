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
  constructor(tag) {
    super(1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.className = '';
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
function notify(target, type, added = []) {
  for (const ob of observers) {
    if (!ob.active) continue;
    for (const {target: root, options} of ob.targets) {
      let n = target;
      while (n) {
        if (n === root) {
          if (n === target || options.subtree) ob.pending.push({type, target, addedNodes: added});
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

function makeDocument(titleText) {
  const html = new Element('html');
  const head = new Element('head');
  const body = new Element('body');
  const title = new Element('title');
  title.appendChild(new Text(titleText));
  head.appendChild(title);
  html.appendChild(head);
  html.appendChild(body);

  const document = {
    documentElement: html,
    head,
    body,
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    createTextNode: (v) => new Text(v),
    createElement: (t) => new Element(t),
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
