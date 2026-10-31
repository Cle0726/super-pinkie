const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/* A small DOM with the parts the modern picker actually touches: a details, a summary whose
   label is a real text node (Lit rewrites it), and a catalog behind __laolaoSidebar. The
   selector engine is compound-only so an unsupported selector throws rather than silently
   matching nothing. */
/* compound = tag? .class* ( [name] | [name="value"] )*  — enough for the selectors the
   picker uses, and it throws on anything else so a new selector cannot pass unnoticed. */
function parseCompound(sel) {
  let rest = sel.trim();
  const tag = (/^[a-z]+/i.exec(rest) || [''])[0];
  rest = rest.slice(tag.length);
  const classes = [];
  const attrs = [];
  while (rest) {
    if (rest[0] === '.') {
      const m = /^\.([\w-]+)/.exec(rest);
      if (!m) throw new Error(`unsupported selector: ${sel}`);
      classes.push(m[1]); rest = rest.slice(m[0].length); continue;
    }
    if (rest[0] === '[') {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest);
      if (!m) throw new Error(`unsupported selector: ${sel}`);
      attrs.push({name: m[1], value: m[2]}); rest = rest.slice(m[0].length); continue;
    }
    throw new Error(`unsupported selector: ${sel}`);
  }
  return {tag, classes, attrs};
}
function nodeMatches(node, spec) {
  if (spec.tag && node.tagName !== spec.tag.toUpperCase()) return false;
  if (!spec.classes.every((c) => node.classList.contains(c))) return false;
  for (const a of spec.attrs) {
    let have;
    if (a.name.startsWith('data-')) have = node.dataset[a.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    else have = node.getAttribute ? node.getAttribute(a.name) : undefined;
    if (have === undefined || have === null) return false;
    if (a.value !== undefined && String(have) !== a.value) return false;
  }
  return true;
}
function matches(node, sel) {
  for (const alt of sel.split(',').map((s) => s.trim())) {
    if (alt.startsWith(':scope > ')) {
      const rest = alt.slice(9).trim();
      if (node.parentElement && nodeMatches(node, parseCompound(rest))) return true;
      continue;
    }
    // descendant form: the rightmost compound must match, and an ancestor must match the rest
    const parts = alt.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      if (!nodeMatches(node, parseCompound(parts.at(-1)))) continue;
      let rest = parts.slice(0, -1);
      for (let p = node.parentElement; rest.length && p; p = p.parentElement) {
        if (nodeMatches(p, parseCompound(rest.at(-1)))) rest = rest.slice(0, -1);
      }
      if (!rest.length) return true;
      continue;
    }
    if (nodeMatches(node, parseCompound(alt))) return true;
  }
  return false;
}
function el(tag, cls = '') {
  const node = {
    tagName: tag.toUpperCase(), children: [], parentElement: null, dataset: {}, attributes: new Map(),
    textContent: '', style: {setProperty() {}, removeProperty() {}}, isConnected: true, nodeType: 1,
    classList: {
      set: new Set(cls.split(/\s+/).filter(Boolean)),
      contains(n) { return this.set.has(n); },
      add(n) { this.set.add(n); },
      remove(n) { this.set.delete(n); },
    },
    get className() { return [...this.classList.set].join(' '); },
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); },
    append(...ns) { for (const n of ns) { n.parentElement = node; node.children.push(n); } },
    after(n) { const p = node.parentElement; n.parentElement = p; const i = p.children.indexOf(node); p.children.splice(i + 1, 0, n); },
    insertBefore(n, ref) { n.parentElement = node; const i = ref ? node.children.indexOf(ref) : -1; if (i < 0) node.children.push(n); else node.children.splice(i, 0, n); return n; },
    prepend(n) { n.parentElement = node; node.children.unshift(n); },
    replaceChildren(...ns) { node.children = []; node.append(...ns); },
    remove() { const p = node.parentElement; if (!p) return; const i = p.children.indexOf(node); if (i >= 0) p.children.splice(i, 1); node.parentElement = null; },
    setAttribute(k, v) {
      node.attributes.set(k, String(v));
      if (k.startsWith('data-')) node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    },
    getAttribute(k) { return node.attributes.has(k) ? node.attributes.get(k) : null; },
    removeAttribute(k) {
      node.attributes.delete(k);
      if (k.startsWith('data-')) delete node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    },
    hasAttribute(k) { return node.attributes.has(k); },
    toggleAttribute(k, on) { if (on === undefined ? !node.attributes.has(k) : on) node.setAttribute(k, ''); else node.removeAttribute(k); },
    get title() { return node.attributes.get('title') || ''; },
    set title(v) { node.attributes.set('title', String(v)); },
    matches(sel) { return matches(node, sel); },
    descendants() { return node.children.flatMap((c) => [c, ...c.descendants()]); },
    querySelectorAll(sel) {
      if (sel.includes(':scope > ')) {
        const rest = sel.split(':scope > ').pop().trim();
        return node.children.filter((c) => matches(c, rest));
      }
      return node.descendants().filter((n) => matches(n, sel));
    },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    closest(sel) { for (let n = node; n; n = n.parentElement) if (matches(n, sel)) return n; return null; },
  };
  return node;
}

const CATALOG = [
  {provider: 'mm', id: 'workbuddy/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash · Work Buddy', available: true},
  {provider: 'mm', id: 'workbuddy/deepseek-v4.1-pro', name: 'DeepSeek V4.1 Pro · Work Buddy', available: true},
  {provider: 'mm', id: 'gemini-3.8-flash-tiered', name: 'Gemini 3.8 Flash', available: true},
];

function mountPicker({catalog = CATALOG, value = 'mm/workbuddy/deepseek-v4.1-flash', label = 'DeepSeek V4.1 Flash · WB'} = {}) {
  const raf = [];
  const document = {
    addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [], querySelector: () => null,
    createElement: (tag) => el(tag),
    body: el('body'),
  };
  const details = el('details', 'chat-controls__inline-select model-picker');
  details.dataset.pinkiePicker = 'modern';
  details.isConnected = true;
  const summary = el('summary', 'chat-controls__inline-select-trigger chat-controls__model-trigger');
  summary.setAttribute('data-chat-select-value', value);
  const native = el('span', 'chat-controls__inline-select-label');
  native.textContent = label;
  summary.append(native);
  details.append(summary);
  document.querySelectorAll = (sel) => (matches(details, sel) ? [details] : []);

  const requests = [];
  const window = {
    addEventListener() {}, removeEventListener() {},
    location: {search: '?session=agent:unrestricted:dashboard:test'},
    localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
    __laolaoSidebar: {gwRequest(method, params) {
      requests.push([method, params]);
      if (method === 'chat.metadata') return Promise.resolve({models: catalog});
      return Promise.resolve({sessions: []});
    }},
  };
  const src = read('services/cle-studio/static/legacy/laolao-model-picker.js')
    .replace(/\}\)\(\);\s*$/, 'window.__t={syncModern, sync, scanPickers, presentTriggerName, readableModelName, sameModel, looksLikeRawModelId, ensureCatalog};})();');
  // a no-op observer: these tests drive the name resolution directly, not the mount lifecycle
  class NoopMO { observe() {} disconnect() {} takeRecords() { return []; } }
  vm.runInNewContext(src, {
    window, document, MutationObserver: NoopMO,
    requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
    setTimeout: () => 0, clearTimeout() {},
  });
  window.__t.scanPickers();
  const flush = () => { const batch = raf.splice(0); for (const fn of batch) fn(); };
  flush();
  return {details, summary, native, window, requests, flush, label: () => summary.querySelector(':scope > .pinkie-model-name')};
}

test('a running model id is shown as its readable catalog name, never the raw id', async () => {
  const h = mountPicker();
  // selected -> done state: the native label already carries a readable name
  assert.equal(h.summary.getAttribute('data-pinkie-model-label'), null, 'no override while the name is fine');
  assert.equal(h.label(), null);
  assert.equal(h.native.textContent, 'DeepSeek V4.1 Flash · WB');

  // the run starts: the native picker rewrites the label to the running value (raw id)
  h.native.textContent = 'mm/deepseek-v4.1-flash';
  h.summary.setAttribute('data-chat-select-value', 'mm/deepseek-v4.1-flash');
  h.window.__t.syncModern(h.details);
  await new Promise((r) => setImmediate(r));   // catalog load
  h.flush();
  h.window.__t.syncModern(h.details);

  const resolved = h.label();
  assert.ok(resolved, 'a readable name replaces the raw id');
  assert.equal(resolved.textContent, 'DeepSeek V4.1 Flash · WB');
  assert.notEqual(h.native.textContent, 'DeepSeek V4.1 Flash · WB', 'the native text node is not rewritten');
  assert.equal(h.native.style.display, undefined);
  // the exact id is still available for verification, and the route is untouched
  assert.equal(h.summary.dataset.pinkieExactId, 'mm/deepseek-v4.1-flash');
  assert.equal(h.summary.getAttribute('data-chat-select-value'), 'mm/deepseek-v4.1-flash');
  assert.match(h.summary.getAttribute('title'), /mm\/deepseek-v4\.1-flash/);
});

test('when the run settles the native readable label comes back and our override is removed', async () => {
  const h = mountPicker();
  h.native.textContent = 'mm/deepseek-v4.1-flash';
  h.summary.setAttribute('data-chat-select-value', 'mm/deepseek-v4.1-flash');
  h.window.__t.syncModern(h.details);
  await new Promise((r) => setImmediate(r));
  h.flush();
  h.window.__t.syncModern(h.details);
  assert.ok(h.label(), 'override present while running');

  // done: the picker restores the catalog name and the settled value
  h.native.textContent = 'DeepSeek V4.1 Flash · WB';
  h.summary.setAttribute('data-chat-select-value', 'mm/workbuddy/deepseek-v4.1-flash');
  h.window.__t.syncModern(h.details);
  assert.equal(h.label(), null, 'the sibling is removed so the native label shows again');
  assert.equal(h.summary.getAttribute('data-pinkie-model-label'), null);
  assert.equal(h.native.textContent, 'DeepSeek V4.1 Flash · WB');
  assert.equal(h.summary.getAttribute('title'), null, 'the run-scoped tooltip does not outlive the run');
  assert.equal(h.summary.dataset.pinkieOwnTitle, undefined);
});

test('an unknown running model keeps an honest readable name instead of borrowing another one', async () => {
  const h = mountPicker();
  h.native.textContent = 'mm/some-unlisted-model-9b';
  h.summary.setAttribute('data-chat-select-value', 'mm/some-unlisted-model-9b');
  h.window.__t.syncModern(h.details);
  await new Promise((r) => setImmediate(r));
  h.flush();
  h.window.__t.syncModern(h.details);
  assert.equal(h.label(), null, 'no catalog match means no invented name');
  assert.equal(h.native.textContent, 'mm/some-unlisted-model-9b', 'the honest raw value stays visible');
});

test('sameModel accepts the workbuddy alias and rejects a different model', () => {
  const h = mountPicker();
  const same = h.window.__t.sameModel;
  assert.equal(same('mm/deepseek-v4.1-flash', {provider: 'mm', id: 'workbuddy/deepseek-v4.1-flash'}), true);
  assert.equal(same('mm/workbuddy/deepseek-v4.1-flash', {provider: 'mm', id: 'workbuddy/deepseek-v4.1-flash'}), true);
  assert.equal(same('mm/deepseek-v4.1-flash', {provider: 'mm', id: 'workbuddy/deepseek-v4.1-pro'}), false,
    'a different variant must never be substituted');
  assert.equal(same('mm/deepseek-v4.1-flash', {provider: 'clekk', id: 'workbuddy/deepseek-v4.1-flash'}), false,
    'a different provider is not the same route');
  assert.equal(same('mm/gemini-3.8-flash-tiered', {provider: 'mm', id: 'gemini-3.8-flash-tiered'}), true);
});
