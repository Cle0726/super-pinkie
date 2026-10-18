const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/* Minimal DOM with MutationObserver support: enough for mountGaze's mount lifecycle
   (closest/querySelectorAll, childList records, rAF). Selectors are compound-only so an
   unsupported selector throws instead of silently matching nothing. */
function parseSimple(sel) {
  const match = /^([a-z]*)((?:\.[\w-]+)*)(?:\[data-([\w-]+)(?:="([^"]*)")?\])?$/i.exec(sel.trim());
  if (!match) throw new Error(`unsupported selector: ${sel}`);
  return {tag: match[1], classes: match[2].split('.').filter(Boolean), attr: match[3], value: match[4]};
}
function matches(node, selector) {
  for (const alt of selector.split(',').map((s) => s.trim())) {
    if (alt.includes(' ') && !alt.includes(':scope')) {
      // descendant form: last compound must match, an ancestor must match the rest
      const parts = alt.split(/\s+/);
      const last = parseSimple(parts.at(-1));
      if (!nodeMatches(node, last)) continue;
      let rest = parts.slice(0, -1);
      for (let p = node.parentElement; rest.length && p; p = p.parentElement) {
        if (nodeMatches(p, parseSimple(rest.at(-1)))) rest = rest.slice(0, -1);
      }
      if (!rest.length) return true;
      continue;
    }
    if (nodeMatches(node, parseSimple(alt))) return true;
  }
  return false;
}
function nodeMatches(node, spec) {
  if (spec.tag && node.tagName !== spec.tag.toUpperCase()) return false;
  if (!spec.classes.every((c) => node.classList.contains(c))) return false;
  if (spec.attr) {
    const key = 'data' + spec.attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const have = node.dataset[key];
    if (spec.value === undefined) { if (have === undefined) return false; }
    else if (have !== spec.value) return false;
  }
  return true;
}

function makeDocument() {
  const observers = [];
  const rafQueue = [];
  const cancelled = new Set();
  class Node_ {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.dataset = {};
      this.classList = {
        set: new Set(),
        contains: (name) => this.classList.set.has(name),
        add: (name) => this.classList.set.add(name),
        remove: (name) => this.classList.set.delete(name),
        toggle: (name, on) => { const v = on === undefined ? !this.classList.set.has(name) : !!on; if (v) this.classList.set.add(name); else this.classList.set.delete(name); return v; },
      };
      this.attributes = new Map();
      this.textContent = '';
      this.title = '';
      this.innerHTML = '';
      this.isConnected = true;
      this.nodeType = 1;
    }
    get className() { return [...this.classList.set].join(' '); }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
    prepend(n) { n.parentElement = this; this.children.unshift(n); }
    insertBefore(n, ref) { n.parentElement = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { const p = this.parentElement; if (!p) return; const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); this.parentElement = null; }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    removeAttribute(k) { this.attributes.delete(k); }
    hasAttribute(k) { return this.attributes.has(k); }
    toggleAttribute(k, on) { if (on === undefined ? !this.attributes.has(k) : on) this.attributes.set(k, ''); else this.attributes.delete(k); return this.attributes.has(k); }
    matches(sel) { return matches(this, sel); }
    descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
    querySelectorAll(sel) {
      // :scope > X means a direct child of this node — resolve before generic filtering
      if (sel.includes(':scope >')) {
        const target = sel.split(':scope >').pop().trim();
        return this.children.filter((c) => matches(c, target));
      }
      return this.descendants().filter((n) => matches(n, sel));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    closest(sel) { for (let n = this; n; n = n.parentElement) if (matches(n, sel)) return n; return null; }
  }
  const doc = new Node_('body');
  doc.nodeType = 9;
  doc.createElement = (tag) => new Node_(tag);
  doc.createDocumentFragment = () => new Node_('fragment');
  doc.querySelectorAll = (sel) => doc.descendants().filter((n) => matches(n, sel));
  doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
  doc.matches = () => false;
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.hidden = false;
  doc.body = doc;
  doc.__observers = observers;
  doc.__raf = rafQueue;
  doc.__cancelled = cancelled;
  class MO {
    constructor(cb) { this.cb = cb; this.records = []; this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    takeRecords() { const r = this.records; this.records = []; return r; }
    emit(records) { if (this.connected) this.cb(records, this); }
  }
  return {
    Node: Node_, MO, doc, observers,
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: (id) => { cancelled.add(id); },
    runFrames() {
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const [i, fn] of batch.entries()) if (!cancelled.has(i + 1)) fn();
    },
  };
}

function pickerEls(Node_) {
  const details = new Node_('details');
  details.className = 'chat-controls__inline-select chat-controls__effort-picker';
  details.open = true;
  details.isConnected = true;
  const summary = new Node_('summary');
  summary.className = 'chat-controls__inline-select-trigger chat-controls__effort-trigger';
  summary.dataset.chatThinkingValue = 'high';
  const label = new Node_('span');
  label.className = 'chat-controls__inline-select-label';
  label.textContent = 'High';
  summary.append(label);
  details.append(summary);
  return {details, summary, label};
}

function loadGaze(env) {
  const levels = read('services/cle-studio/src/composer/gaze-levels.js')
    .replace(/export const/g, 'const').replace(/export function/g, 'function');
  const gaze = read('services/cle-studio/src/composer/gaze.js')
    .replace(/^import '\.\/models\.css';$/m, '')
    .replace(/^import \{[^}]*\} from '\.\/gaze-levels\.js';$/m, '')
    .replace(/^export \{[^}]*\}[^;]*;$/m, '')
    .replace(/export function/g, 'function');
  const sandbox = {
    console,
    document: env.doc,
    requestAnimationFrame: env.requestAnimationFrame,
    cancelAnimationFrame: env.cancelAnimationFrame,
    MutationObserver: env.MO,
    AbortController,
  };
  vm.runInNewContext(`${levels}\n${gaze}\nthis.__gaze={mountGaze, decoratePicker};`, sandbox, {});
  return sandbox.__gaze;
}

test('a picker that exists at mount time is decorated before any click', () => {
  const env = makeDocument();
  const {Node, doc, runFrames} = env;
  const {details, summary} = pickerEls(Node);
  doc.append(details);
  const gaze = loadGaze(env);
  const controller = new AbortController();
  gaze.mountGaze(controller.signal);
  runFrames();
  const eye = summary.querySelector('.cle-eye');
  assert.ok(eye, 'the eye must exist without user interaction');
  assert.equal(summary.dataset.cleLevel, 'high');
  assert.match(eye.innerHTML, /^<svg/, 'the eye carries its generated glyph');
  assert.equal(eye.dataset.cleOpen, '0.68', 'High is a half-open gaze');
  assert.equal(eye.dataset.cleOwned, '1');
});

test('two pickers arriving in one later frame are both decorated', () => {
  const env = makeDocument();
  const {Node, doc, runFrames, doc: _d} = env;
  const gaze = loadGaze(env);
  const controller = new AbortController();
  gaze.mountGaze(controller.signal);   // mount first, panes arrive after
  runFrames();
  const left = pickerEls(Node);
  const right = pickerEls(Node);
  right.summary.dataset.chatThinkingValue = 'max';
  const paneA = new Node('div'); paneA.append(left.details);
  const paneB = new Node('div'); paneB.append(right.details);
  doc.append(paneA, paneB);
  // one observer callback carrying both additions, like a split view render
  for (const mo of env.observers) mo.emit([
    {target: paneA, addedNodes: [left.details], removedNodes: []},
    {target: paneB, addedNodes: [right.details], removedNodes: []},
  ]);
  runFrames();
  assert.ok(left.summary.querySelector('.cle-eye'), 'left pane decorated');
  assert.ok(right.summary.querySelector('.cle-eye'), 'right pane decorated in the same frame');
  assert.equal(right.summary.dataset.cleLevel, 'max');
});

test('a re-rendered summary inside an existing picker is decorated again', () => {
  const env = makeDocument();
  const {Node, doc, runFrames} = env;
  const {details, summary} = pickerEls(Node);
  doc.append(details);
  const gaze = loadGaze(env);
  gaze.mountGaze(new AbortController().signal);
  runFrames();
  assert.ok(summary.querySelector('.cle-eye'));
  // Lit replaces the summary wholesale; the new node carries no eye and must be picked up
  const next = new Node('summary');
  next.className = 'chat-controls__inline-select-trigger chat-controls__effort-trigger';
  next.dataset.chatThinkingValue = 'ultra';
  const label = new Node('span'); label.className = 'chat-controls__inline-select-label'; label.textContent = 'Ultra';
  next.append(label);
  details.replaceChildren(next);
  for (const mo of env.observers) mo.emit([{target: details, addedNodes: [next], removedNodes: [summary]}]);
  runFrames();
  assert.ok(next.querySelector('.cle-eye'), 'the rebuilt trigger gets its own eye');
  assert.equal(next.dataset.cleLevel, 'ultra');
});

test('our own insertions do not schedule another pass', () => {
  const env = makeDocument();
  const {Node, doc, runFrames} = env;
  const {details, summary} = pickerEls(Node);
  doc.append(details);
  const gaze = loadGaze(env);
  gaze.mountGaze(new AbortController().signal);
  runFrames();
  const eye = summary.querySelector('.cle-eye');
  assert.equal(eye.dataset.cleOwned, '1', 'owned nodes are marked');
  // emulate the observer seeing our own eye mount
  const before = env.doc.__raf.length;
  for (const mo of env.observers) mo.emit([{target: summary, addedNodes: [eye], removedNodes: []}]);
  assert.equal(env.doc.__raf.length, before, 'no frame is queued for our own node');
});

test('aborting cancels the pending frame and never writes to the DOM afterwards', () => {
  const env = makeDocument();
  const {Node, doc, runFrames} = env;
  const {details, summary} = pickerEls(Node);
  doc.append(details);
  const gaze = loadGaze(env);
  const controller = new AbortController();
  gaze.mountGaze(controller.signal);
  controller.abort();          // cancel before the first flush runs
  runFrames();
  assert.equal(summary.querySelector('.cle-eye'), null, 'a cancelled mount must not decorate');
  // and a later addition must not resume work
  const late = pickerEls(Node);
  doc.append(late.details);
  for (const mo of env.observers) mo.emit([{target: doc, addedNodes: [late.details], removedNodes: []}]);
  runFrames();
  assert.equal(late.summary.querySelector('.cle-eye'), null);
  assert.ok(env.observers.every((mo) => !mo.connected), 'observers are disconnected on abort');
});
