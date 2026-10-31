const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const sources = ['ui/injections/laolao-model-picker.js', 'services/cle-studio/static/legacy/laolao-model-picker.js'];

class Node {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.textContent = '';
    const props = new Map();
    this.style = {getPropertyValue: (key) => props.get(key) || '', setProperty: (key, value) => props.set(key, value)};
  }
  get isConnected() { return true; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, enabled = !this.hasAttribute(name)) { if (enabled) this.setAttribute(name, ''); else this.removeAttribute(name); return enabled; }
  append(...nodes) { for (const node of nodes) { if (node.tagName === 'fragment') this.append(...node.children); else { node.parentElement = this; this.children.push(node); } } }
  prepend(node) { this.children.unshift(node); node.parentElement = this; }
  insertBefore(node, before) { const at = this.children.indexOf(before); if (at < 0) this.append(node); else { this.children.splice(at, 0, node); node.parentElement = this; } }
  replaceChildren(fragment) { this.children = []; this.append(fragment); }
  addEventListener() {}
  matches(selector) { return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : selector.startsWith('[') ? this.hasAttribute(selector.slice(1, -1)) : false; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map((s) => s.trim());
    return this.children.flatMap((child) => [...(selectors.some((s) => child.matches(s)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function harness(source) {
  const stored = new Map();
  const document = {documentElement: {hasAttribute: () => true}, addEventListener() {},
    createElement: (tag) => new Node(tag), createDocumentFragment: () => new Node('fragment')};
  const window = {addEventListener() {}, removeEventListener() {}, localStorage: {
    getItem: (key) => stored.get(key) || null, setItem: (key, value) => stored.set(key, value),
  }};
  vm.runInNewContext(read(source).replace(/\}\)\(\);\s*$/, 'window.__test = {syncCatalogSurface, surfaceStates, formatModelContext, recentModels, rememberModel};})();'),
    {window, document, requestAnimationFrame() {}});
  const menu = new Node(), browser = new Node(); browser.className = 'chat-controls__model-options'; menu.append(browser);
  const details = {};
  const add = (value, name, context, selected = false) => {
    const row = new Node('button'); row.setAttribute('data-chat-model-option', value); row.setAttribute('aria-selected', String(selected));
    const label = new Node('span'); label.className = 'chat-controls__model-option-name'; label.textContent = name; row.append(label);
    if (context) { const meta = new Node('span'); meta.className = 'chat-controls__model-option-meta'; meta.textContent = context; row.append(meta); }
    browser.append(row); return row;
  };
  return {api: window.__test, stored, menu, browser, details, add, sync: () => window.__test.syncCatalogSurface(details, menu, browser)};
}

for (const source of sources) {
  test(`${source}: filters actual catalog rows, keeps current model and preserves route identity`, () => {
    const h = harness(source);
    const a = h.add('route-a/gemini-new', 'Gemini New', '1M · API', true);
    const b = h.add('route-b/gpt-new', 'GPT New', '128k');
    const c = h.add('custom/anything-new', 'Local Choice', '');
    h.sync();
    assert.deepEqual(h.browser.children, [a, b, c]);
    assert.equal(a.dataset.pinkieContext, '1M');
    assert.equal(b.dataset.pinkieContext, '128k');
    assert.match(b.getAttribute('title'), /route-b\/gpt-new/);
    assert.match(b.getAttribute('aria-label'), /route-b\/gpt-new/);
    assert.equal(c.dataset.pinkieContext, '', 'unknown capacity is never replaced with a guessed default');
    assert.equal(c.dataset.pinkieBrand, 'crossmodel');
    const state = h.api.surfaceStates.get(h.details);
    state.brand = 'openai'; h.sync();
    assert.equal(a.hidden, true); assert.equal(b.hidden, false); assert.equal(c.hidden, true);
    assert.equal(b.getAttribute('data-chat-model-option'), 'route-b/gpt-new');
    h.menu.querySelector('.chat-controls__model-search').value = 'Gemini'; h.sync();
    assert.equal(b.hidden, true); assert.equal(state.empty.hidden, false);
    state.brand = 'all'; h.sync();
    assert.equal(a.hidden, false, 'all search includes every brand');
    assert.equal(state.empty.hidden, true);
    b.children = b.children.filter((node) => !node.className.includes('model-option-meta'));
    h.sync(); assert.equal(b.dataset.pinkieContext, '', 'catalog refresh cannot leave stale capacity behind');
  });

  test(`${source}: default Common only contains actual usage while All retains the complete catalog`, () => {
    const h = harness(source);
    const rows = Array.from({length: 60}, (_, i) => h.add(`custom/model-${i}`, `Choice ${i}`, '', i === 59));
    h.sync();
    assert.equal(rows.filter((row) => !row.hidden).length, 1);
    h.api.surfaceStates.get(h.details).brand = 'common'; h.sync();
    assert.deepEqual(rows.filter((row) => !row.hidden), [rows[59]], 'no synthetic favourites are inserted');
    h.api.surfaceStates.get(h.details).brand = 'all'; h.sync();
    assert.equal(rows[59].hidden, false, 'selected model is present even at the end of a large catalog');
    h.menu.querySelector('.chat-controls__model-search').value = 'Choice 49'; h.sync();
    assert.deepEqual(rows.filter((row) => !row.hidden), [rows[49]]);
  });

  test(`${source}: the recovered catalog excludes hidden native duplicates from counts and keyboard rows`, () => {
    const h = harness(source);
    const nativeA = h.add('route-a/gemini-new', 'Gemini New', '', true);
    const nativeB = h.add('route-b/gpt-new', 'GPT New', '');
    const fallbackA = h.add('route-a/gemini-new', 'Gemini New', '', false);
    const fallbackB = h.add('route-b/gpt-new', 'GPT New', '', true);
    const nativePanel = new Node(), fallbackPanel = new Node();
    nativePanel.className = 'chat-controls__provider-models'; nativePanel.hidden = true;
    fallbackPanel.className = 'pinkie-fallback-catalog';
    h.browser.children = [];
    nativePanel.append(nativeA, nativeB); fallbackPanel.append(fallbackA, fallbackB);
    h.browser.append(nativePanel, fallbackPanel);
    h.sync();
    const bar = h.api.surfaceStates.get(h.details).bar;
    const all = bar.children.find(tab => tab.dataset.pinkieModelFilter === 'all');
    assert.equal(all.textContent, '全部 2');
    assert.equal(fallbackB.hasAttribute('data-chat-model-highlighted'), true);
    assert.equal(nativeA.hasAttribute('data-chat-model-highlighted'), false);
    h.api.surfaceStates.get(h.details).brand = 'common'; h.sync();
    assert.equal(fallbackA.hidden, true); assert.equal(fallbackB.hidden, false);
    assert.deepEqual(h.browser.children, [nativePanel, fallbackPanel], 'Lit-owned nodes stay in their original parent');
  });

  test(`${source}: usage history stays bounded and invalid storage does not break the picker`, () => {
    const h = harness(source);
    h.stored.set('pinkie:model-picker:recent:v1', '{broken');
    assert.equal(h.api.recentModels().length, 0);
    for (let i = 0; i < 20; i++) h.api.rememberModel(`route/model-${i}`);
    h.api.rememberModel('route/model-18');
    const recent = [...h.api.recentModels()];
    assert.equal(recent.length, 6); assert.equal(new Set(recent).size, 6); assert.equal(recent[0], 'route/model-18');
    for (const value of [null, undefined, 0, -1, 'unknown']) assert.equal(h.api.formatModelContext(value), '');
    assert.equal(h.api.formatModelContext(1000000), '1M'); assert.equal(h.api.formatModelContext(128000), '128k');
  });

  test(`${source}: the catalog retains every backing route while folding duplicate and effort choices`, () => {
    let list;
    const document = {addEventListener() {}, createElement: (tag) => new Node(tag), createDocumentFragment: () => new Node('fragment')};
    const window = {addEventListener() {}, removeEventListener() {}};
    vm.runInNewContext(read(source).replace(/\}\)\(\);\s*$/, 'window.__test = {renderFallbackCatalog};})();'), {window, document, requestAnimationFrame() {}});
    const models = [
      {provider: 'a', id: 'gpt-5.4', name: 'Same Name'}, {provider: 'b', id: 'gpt-5.4', name: 'Same Name'},
      {provider: 'mm', id: 'gemini-3.6-flash-low', name: 'Gemini Low'},
      {provider: 'mm', id: 'gemini-3.6-flash-high', name: 'Gemini High'},
      ...Array.from({length: 56}, (_, i) => ({provider: 'custom', id: `model-${i}`, name: `Choice ${i}`})),
    ];
    const browser = {querySelector: () => list, append: (node) => { list = node; }};
    window.__test.renderFallbackCatalog({}, browser, {surface: true, models, selectedModel: 'b/gpt-5.4', session: {}});
    const rows = list.children.filter((node) => node.dataset.chatModelOption);
    assert.equal(rows.length, 58);
    const routes = new Set(rows.flatMap(row => JSON.parse(row.dataset.pinkieSources)));
    assert.deepEqual([...routes].sort(), models.map(model => `${model.provider}/${model.id}`).sort());
    assert.deepEqual(rows.filter((row) => row.getAttribute('aria-selected') === 'true').map((row) => row.dataset.chatModelOption), ['b/gpt-5.4']);
  });
}
