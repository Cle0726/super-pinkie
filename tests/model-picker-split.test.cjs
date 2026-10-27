const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sources = ['ui/injections/laolao-model-picker.js', 'services/cle-studio/static/legacy/laolao-model-picker.js'];
function harness(source) {
  const listeners = new Map(), windowEvents = new Map(), storage = new Map(), props = new Map(), motionAttributes = new Set(), frames = [];
  let sessionKey = 'agent:main:A';
  const children = [];
  const parent = {children};
  function ownElement() {
    return {attributes: {}, dataset: {}, className: '', text: '', children: [], isConnected: false,
      get textContent() { return this.children.length ? this.children.map(node => node.textContent).join('') : this.text; },
      set textContent(value) { this.children = []; this.text = value; },
      replaceChildren(...nodes) { this.children = nodes; },
      querySelector(selector) { return selector === ':scope > .pinkie-external-tier' ? this.children.find(node => node.className === 'pinkie-external-tier') || null : null; },
      getAttribute(name) { return this.attributes[name] || null; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      closest(selector) { return selector === '.pinkie-effort-trigger' && this.className === 'pinkie-effort-trigger' ? this : null; },
      remove() { this.isConnected = false; const i = children.indexOf(this); if (i >= 0) children.splice(i, 1); },
      getBoundingClientRect() { return {top: 700, bottom: 728, left: 760, right: 870}; },
    };
  }
  const native = {textContent: 'Gemini Test · High', nextElementSibling: null,
    style: {setProperty() {}, removeProperty() {}},
    after(node) { this.nextElementSibling = node; node.remove = () => { native.nextElementSibling = null; }; },
  };
  const summary = {dataset: {}, attributes: {}, parentElement: null,
    querySelector: () => native,
    getAttribute(name) { return this.attributes[name] || ''; },
    setAttribute(name, value) { this.attributes[name] = value; },
    closest(selector) {
      if (selector.startsWith('details.chat-controls__model')) return details;
      if (selector === '.chat-controls__inline-select-trigger') return summary;
      return null;
    },
    getBoundingClientRect: () => ({top: 700, bottom: 728, left: 600, right: 750}),
  };
  const composer = {getBoundingClientRect: () => ({top: 630, bottom: 730})};
  const pane = {getBoundingClientRect: () => ({top: 50, bottom: 750, left: 100, right: 900})};
  const menu = {children: [Object.freeze({nativeLitRange: true})], offsetParent: null,
    attributes: new Set(),
    setAttribute(name) { this.attributes.add(name); },
    removeAttribute(name) { this.attributes.delete(name); },
    hasAttribute(name) { return this.attributes.has(name); },
    matches: (selector) => selector === '.chat-controls__inline-select-menu--combined',
    querySelector: () => null,
    style: {getPropertyValue: (name) => props.get(name), setProperty: (name, value) => props.set(name, value)},
    getBoundingClientRect: () => ({height: Math.min(details.dataset.pinkiePickerView === 'effort' ? 150 : 340, parseFloat(props.get('--pinkie-popup-max-height')) || 340)}),
  };
  const details = {parentElement: parent, open: false, isConnected: true, dataset: {},
    scrollLeft: 0, scrollTop: 0, clientLeft: 0, clientTop: 0,
    querySelector(selector) {
      if (selector.startsWith(':scope > summary')) return summary;
      if (selector === ':scope > .chat-controls__inline-select-menu--combined') return menu;
      return null; // The live surface fixture is tested separately; sync can stop here.
    },
    closest(selector) {
      if (selector === '[data-session-key]') return {dataset: {sessionKey}};
      if (selector === '.agent-chat__composer-shell') return composer;
      if (selector === '.chat-main') return pane;
      return null;
    },
    after(node) { if (node.parentElement !== parent || !node.isConnected) { children.push(node); node.parentElement = parent; node.isConnected = true; } },
    setAttribute(name) { if (name === 'open') this.open = true; },
    removeAttribute(name) { if (name === 'open') this.open = false; },
    toggleAttribute(name, active) { active ? motionAttributes.add(name) : motionAttributes.delete(name); },
    contains(node) { return node === summary; },
    getBoundingClientRect: () => ({top: 700, left: 600}),
  };
  summary.parentElement = details; menu.offsetParent = details;
  const window = {innerWidth: 1000, innerHeight: 800, addEventListener(name, fn) { windowEvents.set(name, fn); },
    localStorage: {getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key)},
  };
  const document = {createElement: ownElement, addEventListener(name, fn) { listeners.set(name, fn); }};
  const js = fs.readFileSync(path.join(__dirname, '..', source), 'utf8').replace(/\}\)\(\);\s*$/,
    'window.__test = {syncTrigger, syncEffortTrigger, openPickerView, finishPicker, layoutPopup, effortTriggers, triggerObservers, fallbackStates};})();');
  vm.runInNewContext(js, {window, document, requestAnimationFrame(callback) { frames.push(callback); return frames.length; }});
  const api = window.__test;
  api.triggerObservers.set(details, {});
  return {api, details, menu, native, summary, storage, children, props, listeners, windowEvents, motionAttributes, document, window, frames,
    setKey(value) { sessionKey = value; },
    click(target) { listeners.get('click')({target, preventDefault() {}, stopImmediatePropagation() {}}); },
  };
}
for (const source of sources) {
  test(`${source}: model and effort have separate labels, two exclusive entrances and native controls stay in place`, () => {
    const h = harness(source), nativeChildren = [...h.menu.children];
    h.api.syncTrigger(h.details);
    const effort = h.api.effortTriggers.get(h.details);
    assert.equal(h.native.nextElementSibling.textContent, 'Gemini Test');
    assert.equal(h.native.textContent, 'Gemini Test · High', 'Lit-owned text remains untouched');
    assert.equal(effort.textContent, 'High');
    assert.equal(effort.querySelector(':scope > .pinkie-external-tier').textContent, 'High', 'the original material font effect decorates the standalone tier');
    assert.equal(effort.getAttribute('aria-expanded'), 'false');
    assert.equal(h.summary.getAttribute('aria-expanded'), 'false');
    for (let i = 0; i < 20; i++) h.api.syncTrigger(h.details);
    assert.equal(h.children.length, 1, 'stream and render syncs cannot duplicate the effort trigger');
    h.click(effort);
    assert.equal(h.details.open, true);
    assert.equal(h.details.dataset.pinkiePickerView, 'effort');
    assert.equal(effort.getAttribute('aria-expanded'), 'true');
    assert.equal(h.summary.getAttribute('aria-expanded'), 'false');
    h.click(h.summary);
    assert.equal(h.details.open, true, 'switching entrances changes the view without destroying Lit controls');
    assert.equal(h.details.dataset.pinkiePickerView, 'model');
    assert.equal(effort.getAttribute('aria-expanded'), 'false');
    assert.equal(h.summary.getAttribute('aria-expanded'), 'true');
    h.click(effort);
    assert.equal(h.details.dataset.pinkiePickerView, 'effort');
    assert.deepEqual(h.menu.children, nativeChildren);
    h.click({closest: () => null});
    assert.equal(h.details.open, false);
    assert.equal(h.details.dataset.pinkiePickerView, 'model');
    assert.equal(effort.getAttribute('aria-expanded'), 'false');
    h.click(effort);
    h.listeners.get('keydown')({key: 'Escape', preventDefault() {}});
    assert.equal(h.details.open, false);
    assert.equal(h.details.dataset.pinkiePickerView, 'model');
  });
  test(`${source}: effort follows saved defaults, enhanced tiers and the current session without altering model text`, () => {
    const h = harness(source);
    const fallback = {key: 'agent:main:A', session: {thinkingLevel: null, thinkingDefault: 'xhigh'}, modelName: 'Gemini Test', selectedModel: 'mm/gemini-test'};
    h.api.fallbackStates.set(h.details, fallback); h.api.syncTrigger(h.details);
    const effort = h.api.effortTriggers.get(h.details);
    assert.equal(effort.textContent, 'XHigh');
    h.storage.set('laolao:reasoning-enhance:v1:agent:main:A', 'ultra'); h.api.syncTrigger(h.details);
    assert.equal(effort.textContent, 'Ultra');
    h.storage.set('laolao:reasoning-enhance:v1:agent:main:B', 'max'); h.setKey('agent:main:B'); h.api.syncTrigger(h.details);
    assert.equal(effort.textContent, 'Max');
    h.storage.delete('laolao:reasoning-enhance:v1:agent:main:B'); h.native.textContent = 'Gemini Test'; h.api.syncTrigger(h.details);
    assert.equal(effort.textContent, '默认');
    assert.equal(effort.getAttribute('aria-label'), '思考强度，当前 默认');
    assert.equal(h.native.textContent, 'Gemini Test');
  });
  test(`${source}: every interactive reopen recovers a missed foreground event without a timer`, () => {
    const h = harness(source);
    h.api.syncTrigger(h.details);
    h.document.hidden = true; // Stale WKWebView visibility after returning to the App.
    const effort = h.api.effortTriggers.get(h.details);
    for (let cycle = 0; cycle < 20; cycle++) {
      h.windowEvents.get('pinkie:app-background')();
      assert.equal(h.motionAttributes.has('data-pinkie-brand-motion-paused'), true);
      h.click(effort); // No focus/foreground notification accompanies this click.
      assert.equal(h.details.open, true);
      assert.equal(h.motionAttributes.has('data-pinkie-brand-motion-paused'), false);
      h.click(effort);
      assert.equal(h.details.open, false);
    }
    assert.equal(h.children.length, 1);
  });
  test(`${source}: model and effort menus are compact, independently anchored and bounded to the pane`, () => {
    const h = harness(source); h.api.syncTrigger(h.details);
    h.details.open = true; h.details.dataset.pinkiePickerView = 'model'; h.api.layoutPopup(h.details);
    assert.equal(h.props.get('--pinkie-popup-width'), '360px');
    assert.equal(h.props.get('--pinkie-popup-max-height'), '360px');
    assert.equal(h.props.get('--pinkie-popup-left'), '-210px');
    h.details.dataset.pinkiePickerView = 'effort'; h.api.layoutPopup(h.details);
    // Short tier names need only 56px; keep the usable slider length while removing the old route-caption gap.
    assert.equal(h.props.get('--pinkie-popup-width'), source.startsWith('ui/') ? '296px' : '280px');
    assert.equal(h.props.get('--pinkie-popup-max-height'), '200px');
    assert.equal(h.props.get('--pinkie-popup-left'), source.startsWith('ui/') ? '-26px' : '-10px', 'effort view uses its own sibling trigger');
    assert.equal(h.props.get('--pinkie-popup-top'), '-158px');
  });
  test(`${source}: reopening commits a new local animation timeline without overriding background pause or native controls`, () => {
    const h = harness(source), nativeChildren = [...h.menu.children];
    let committed = 0;
    h.window.getComputedStyle = () => ({get animationName() {
      assert.equal(h.menu.hasAttribute('data-pinkie-motion-reset'), true);
      committed++;
      return 'none';
    }});
    h.api.openPickerView(h.details, 'effort');
    assert.equal(committed, 1);
    assert.equal(h.frames.length, 1);
    h.api.openPickerView(h.details, 'effort');
    assert.equal(committed, 2);
    assert.equal(h.frames.length, 1, 'rapid opens share one pending frame');
    h.windowEvents.get('pinkie:app-background')();
    h.frames.shift()();
    assert.equal(h.menu.hasAttribute('data-pinkie-motion-reset'), false);
    assert.equal(h.motionAttributes.has('data-pinkie-brand-motion-paused'), true, 'animation restart cannot wake a background App');
    assert.deepEqual(h.menu.children, nativeChildren);
    h.api.openPickerView(h.details, 'effort');
    h.listeners.get('keydown')({key: 'Escape', preventDefault() {}});
    h.frames.shift()();
    assert.equal(h.details.open, false, 'a pending reset cannot reopen a closed menu');
    assert.equal(h.menu.hasAttribute('data-pinkie-motion-reset'), false);
    h.api.openPickerView(h.details, 'model');
    assert.equal(h.frames.length, 0, 'the static model catalog needs no animation reset');
  });
  test(`${source}: a modern picker without the legacy combined menu gains no duplicate effort entrance`, () => {
    const h = harness(source); h.details.querySelector = () => null;
    assert.equal(h.api.syncEffortTrigger(h.details, 'high'), null);
    assert.equal(h.children.length, 0);
  });
}
