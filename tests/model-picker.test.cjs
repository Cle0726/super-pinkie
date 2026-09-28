const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/** A range plus the slider/details it sits in, wired the way the real DOM is. */
function harness(overrides = {}) {
  const listeners = new Map();
  const props = new Map();
  const dots = [];
  const slider = {
    style: { setProperty: (name, value) => props.set(name, value) },
    querySelectorAll: () => dots,
  };
  const details = {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    toggleAttribute(name, enabled) {
      if (enabled) this.attributes.set(name, '');
      else this.attributes.delete(name);
    },
  };
  const document = { addEventListener(name, fn) { listeners.set(name, fn); } };
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), { window: {}, document, requestAnimationFrame() {} });
  const range = {
    min: '0', max: '4', step: '1', value: '0', disabled: false,
    closest: (selector) => (selector === '.chat-controls__reasoning-slider' ? slider : details),
    matches: (selector) => selector === '.chat-controls__reasoning-range',
    ...overrides,
  };
  return { props, details, dots, range, input: () => listeners.get('input')({ target: range }) };
}

test('the compact picker lights up only at the actual highest reasoning step', () => {
  const listeners = new Map();
  const details = {
    attributes: new Set(),
    toggleAttribute(name, enabled) {
      if (enabled) this.attributes.add(name);
      else this.attributes.delete(name);
    },
  };
  const document = { addEventListener(name, fn) { listeners.set(name, fn); } };
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), { window: {}, document, requestAnimationFrame() {} });
  const range = {
    min: '0', max: '4', step: '1', value: '3', disabled: false,
    closest() { return details; },
    matches(selector) { return selector === '.chat-controls__reasoning-range'; },
  };
  listeners.get('input')({ target: range });
  assert.equal(details.attributes.has('data-pinkie-max'), false);
  range.value = '4';
  listeners.get('input')({ target: range });
  assert.equal(details.attributes.has('data-pinkie-max'), true);
  range.disabled = true;
  listeners.get('input')({ target: range });
  assert.equal(details.attributes.has('data-pinkie-max'), false);
});

test('an empty native picker recovers the live model catalog and session slider without closing', async () => {
  const source = read('ui/injections/laolao-model-picker.js').replace(/\}\)\(\);\s*$/, 'window.__pickerTest = {ensureFallbackData, ensureFallbackRange};})();');
  const requests = [];
  const listeners = new Map();
  const timers = new Map();
  const stored = new Map();
  const key = 'agent:unrestricted:dashboard:current';
  const window = {
    location: {search: `?session=${encodeURIComponent(key)}`},
    localStorage: {getItem(name) { return stored.get(name) || null; }, setItem(name, value) { stored.set(name, value); }, removeItem(name) { stored.delete(name); }},
    setTimeout(fn) { timers.set(1, fn); return 1; },
    clearTimeout() { timers.clear(); },
    __laolaoSidebar: {gwRequest(method, params) {
      requests.push([method, params]);
      if (method === 'chat.metadata') return Promise.resolve({models: [
        {provider: 'mm', id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro', available: true},
        {provider: 'mm', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', available: true},
      ]});
      return Promise.resolve({sessions: [{key, model: 'gemini-3.1-pro-low', modelProvider: 'mm', thinkingLevel: 'high', thinkingOptions: ['off', 'low', 'medium', 'high'], hasActiveRun: false}]});
    }},
  };
  const browser = {querySelectorAll: () => [], querySelector: () => null};
  const details = {dataset: {}, open: true, removeAttribute() {}, isConnected: false,
    setAttribute() {}, toggleAttribute() {}, style: {setProperty() {}},
    querySelector() { return menu; },
  };
  const document = {addEventListener(name, fn) { listeners.set(name, fn); }};
  vm.runInNewContext(source, {window, document, requestAnimationFrame() {}});
  const state = window.__pickerTest.ensureFallbackData(details, browser);
  assert.equal(details.dataset.pinkieFallbackReady, '0', 'the loading placeholder is not shown as a fake option');
  await new Promise((resolve) => setImmediate(resolve));
  window.__pickerTest.ensureFallbackData(details, browser);
  assert.equal(details.dataset.pinkieFallbackReady, '1');
  assert.equal(state.models.length, 2);
  assert.equal(state.modelName, 'Gemini 3.1 Pro');
  assert.equal(state.session.hasActiveRun, false);
  assert.deepEqual(requests.map(([method]) => method), ['chat.metadata', 'sessions.list']);
  assert.equal(details.dataset.pinkieFallback, '1');
  const secondPicker = {dataset: {}, removeAttribute() {}};
  window.__pickerTest.ensureFallbackData(secondPicker, browser);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.filter(([method]) => method === 'chat.metadata').length, 1, 'another picker reuses the loaded catalog');

  let fallbackRange;
  let stopLayer;
  const slider = {style: {setProperty() {}},
    querySelector(selector) { return selector.includes('pinkie-reasoning-stops') ? stopLayer : fallbackRange; },
    append(node) { fallbackRange = node; },
    prepend(node) { stopLayer = node; },
  };
  const native = {closest: () => slider};
  let label;
  const panel = {querySelector() { return label; }, prepend(node) { label = node; }};
  const menu = {querySelector(selector) { return selector === '.chat-controls__reasoning-panel' ? panel : native; }};
  document.createElement = () => ({dataset: {}, setAttribute() {}});
  const range = window.__pickerTest.ensureFallbackRange(details, menu, state);
  assert.equal(range.max, '5', 'four native levels plus Max and Ultra remain on the slider');
  assert.equal(range.value, '3', 'the backend High selection is reflected on the slider');
  assert.equal(range.disabled, false, 'a completed session is not frozen by stale native UI state');
  assert.equal(details.dataset.pinkieFallbackRange, '1');

  document.createElement = () => ({dataset: {}, style: {setProperty() {}}, setAttribute() {}, replaceChildren() {}});
  range.value = '5';
  range.matches = (selector) => selector === '.chat-controls__reasoning-range';
  range.closest = (selector) => selector === '.chat-controls__reasoning-slider' ? slider : details;
  range.getAttribute = () => null;
  listeners.get('input')({target: range, stopImmediatePropagation() {}});
  assert.equal(label.textContent, '思考等级 · Ultra');
  assert.equal(details.open, true, 'dragging the recovered slider never closes the popup');
  assert.equal(timers.size, 1, 'a tier selection schedules one automatic save');
  details.isConnected = true;
  timers.get(1)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.find(([method]) => method === 'sessions.patch')?.[1].thinkingLevel, 'high');
  assert.equal(details.open, true, 'the popup stays open after the backend save');

  range.remove = () => { fallbackRange = null; };
  state.session.thinkingOptions = ['off'];
  assert.equal(window.__pickerTest.ensureFallbackRange(details, menu, state), null);
  assert.equal(fallbackRange, null, 'a model with no thinking support removes the previous slider');
  assert.equal(details.dataset.pinkieNoReasoning, '1');
});

test('effort-suffixed Gemini endpoints become two family rows while the slider keeps their real IDs', () => {
  const source = read('ui/injections/laolao-model-picker.js').replace(/\}\)\(\);\s*$/, 'window.__pickerTest = {presentationModels, familyTargetModel, fallbackModelName};})();');
  const window = {};
  vm.runInNewContext(source, {window, document: {addEventListener() {}}, requestAnimationFrame() {}});
  const model = (id, name = id) => ({provider: 'mm', id, name, reasoning: true, input: ['text', 'image'], contextWindow: 1000000});
  const models = [
    model('gemini-3.5-flash-extra-low'), model('gemini-3.5-flash-low'),
    model('gemini-3.6-flash-high'), model('gemini-3.6-flash-low'),
    model('gemini-3.6-flash-medium'), model('gemini-3.6-flash-tiered'),
    model('gemini-2.5-flash-thinking'), model('gemini-3-flash-agent'),
    model('gemini-3.1-flash-image'), model('grok-3-mini-fast'),
  ];
  const shown = window.__pickerTest.presentationModels(models);
  assert.equal(shown.length, 6, 'six effort variants become two rows; four specialized endpoints remain');
  assert.deepEqual(Array.from(shown.slice(0, 2), (item) => item.name), ['Gemini 3.5 Flash', 'Gemini 3.6 Flash']);
  const state = {models, session: {modelProvider: 'mm', model: 'gemini-3.6-flash-high', thinkingLevel: 'high'}};
  assert.equal(window.__pickerTest.fallbackModelName(state), 'Gemini 3.6 Flash', 'old sessions display the family name');
  assert.equal(window.__pickerTest.familyTargetModel(state, 'low'), 'mm/gemini-3.6-flash-low');
  assert.equal(window.__pickerTest.familyTargetModel(state, 'medium'), 'mm/gemini-3.6-flash-medium');
  assert.equal(window.__pickerTest.familyTargetModel(state, 'high'), 'mm/gemini-3.6-flash-high');
  assert.equal(window.__pickerTest.familyTargetModel(state, 'ultra'), 'mm/gemini-3.6-flash-tiered');
  state.session.model = 'gemini-3.5-flash-extra-low';
  assert.equal(window.__pickerTest.familyTargetModel(state, 'minimal'), 'mm/gemini-3.5-flash-extra-low');
  assert.equal(window.__pickerTest.familyTargetModel(state, 'low'), 'mm/gemini-3.5-flash-low');
  models[1].input = ['text'];
  assert.equal(window.__pickerTest.presentationModels(models).length, 7, 'only the differing 3.5 pair splits; the compatible 3.6 family stays grouped');
});

test('changing a grouped slider stop saves the matching backend model without closing', async () => {
  const source = read('ui/injections/laolao-model-picker.js').replace(/\}\)\(\);\s*$/, 'window.__pickerTest = {fallbackStates};})();');
  const key = 'agent:project:grouped-test';
  const listeners = new Map();
  const patches = [];
  let save;
  const model = (id) => ({provider: 'mm', id, reasoning: true, input: ['text', 'image'], contextWindow: 1000000});
  const models = ['gemini-3.6-flash-low', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-high', 'gemini-3.6-flash-tiered'].map(model);
  const session = {key, modelProvider: 'mm', model: 'gemini-3.6-flash-low', thinkingLevel: 'low', thinkingOptions: ['off', 'low', 'medium', 'high']};
  const details = {
    dataset: {}, open: true, isConnected: true,
    closest() { return null; }, querySelector() { return null; },
    setAttribute() {}, toggleAttribute() {},
  };
  const slider = {style: {setProperty() {}}};
  const range = {
    min: '0', max: '5', step: '1', value: '2', disabled: false,
    dataset: {pinkieFallback: '1', chatThinkingValues: 'off,low,medium,high,max,ultra', pinkieNativeValues: 'off,low,medium,high'},
    matches(selector) { return selector === '.chat-controls__reasoning-range'; },
    closest(selector) { return selector === '.chat-controls__reasoning-slider' ? slider : details; },
  };
  const window = {
    location: {search: `?session=${encodeURIComponent(key)}`},
    localStorage: {getItem() { return null; }, removeItem() {}},
    setTimeout(fn) { save = fn; return 1; }, clearTimeout() {},
    __laolaoSidebar: {async gwRequest(method, payload) {
      if (method === 'sessions.patch') {
        patches.push(payload);
        return {};
      }
      if (method === 'sessions.list') return {sessions: [{...session, model: 'gemini-3.6-flash-medium', thinkingLevel: 'medium'}]};
      throw new Error(`unexpected RPC: ${method}`);
    }},
    dispatchEvent() {},
  };
  const document = {addEventListener(name, fn) { listeners.set(name, fn); }};
  vm.runInNewContext(source, {window, document, Event: class {}, requestAnimationFrame() {}});
  const state = {key, models, session, selectedModel: 'mm/gemini-3.6-flash-low', modelName: 'Gemini 3.6 Flash'};
  window.__pickerTest.fallbackStates.set(details, state);
  listeners.get('input')({target: range, stopImmediatePropagation() {}});
  assert.equal(state.selectedModel, 'mm/gemini-3.6-flash-medium');
  assert.equal(details.open, true);
  assert.equal(typeof save, 'function');
  save();
  await new Promise(setImmediate);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].model, 'mm/gemini-3.6-flash-medium');
  assert.equal(patches[0].thinkingLevel, 'medium');
  assert.equal(state.modelName, 'Gemini 3.6 Flash');
  assert.equal(details.open, true);
});

test('every reasoning step publishes its fill, scale, index and fallback material', () => {
  const h = harness();
  h.range.value = '0';
  h.input();
  assert.equal(h.props.get('--reasoning-fill'), '0.00%');
  assert.equal(h.props.get('--reasoning-scale'), '0');
  assert.equal(h.props.get('--reasoning-end-offset'), '0.00px');
  assert.equal(h.details.attributes.get('data-pinkie-level'), '0');
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'off');

  h.range.value = '2';
  h.input();
  assert.equal(h.props.get('--reasoning-fill'), '50.00%');
  assert.equal(h.props.get('--reasoning-scale'), '0.5');
  assert.equal(h.props.get('--reasoning-end-offset'), '13.00px');
  assert.equal(h.details.attributes.get('data-pinkie-level'), '2');
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'low');

  h.range.value = '4';
  h.input();
  assert.equal(h.props.get('--reasoning-fill'), '100.00%');
  assert.equal(h.props.get('--reasoning-scale'), '1');
  assert.equal(h.props.get('--reasoning-end-offset'), '26.00px');
  assert.equal(h.details.attributes.get('data-pinkie-level'), '4');
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'high');
});

test('semantic reasoning names select the intended material regardless of slider length', () => {
  const h = harness({
    min: '0', max: '8', step: '1', value: '4',
    dataset: { chatThinkingValues: 'off,minimal,low,medium,high,xhigh,adaptive,max,ultra' },
  });
  h.input();
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'high');
  h.range.value = '5';
  h.input();
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'xhigh');
  h.range.value = '6';
  h.input();
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'adaptive');
  h.range.value = '7';
  h.input();
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'max');
  h.range.value = '8';
  h.input();
  assert.equal(h.details.attributes.get('data-pinkie-material'), 'ultra');
});

test('session-scoped enhanced Max and Ultra reuse their own art without faking the native range', () => {
  const listeners = new Map();
  const selected = new Map([['laolao:reasoning-enhance:v1:agent:learning:lesson', 'max']]);
  const window = {
    location: {search: '?session=agent%3Alearning%3Alesson'},
    localStorage: {getItem: (key) => selected.get(key) || null},
  };
  const details = {attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); }, toggleAttribute() {}, style: {setProperty() {}}};
  const slider = {style: {setProperty() {}}};
  const document = {addEventListener(name, fn) { listeners.set(name, fn); }};
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), {window, document, requestAnimationFrame() {}});
  const range = {
    min: '0', max: '5', step: '1', value: '5', disabled: false,
    dataset: {chatThinkingValues: 'off,minimal,low,medium,high,xhigh'},
    closest: (selector) => selector === '.chat-controls__reasoning-slider' ? slider : details,
    matches: (selector) => selector === '.chat-controls__reasoning-range',
  };
  listeners.get('input')({target: range});
  assert.equal(details.attributes.get('data-pinkie-material'), 'max');
  assert.equal(range.value, '5', 'native XHigh draft is not overwritten');
  selected.set('laolao:reasoning-enhance:v1:agent:learning:lesson', 'ultra');
  listeners.get('input')({target: range});
  assert.equal(details.attributes.get('data-pinkie-material'), 'ultra');
});

test('Max and Ultra are slider stops with a live label, without passing virtual values to the native picker', async () => {
  const listeners = new Map();
  const stored = new Map();
  const nativeInputs = [];
  const nativeChanges = [];
  const key = 'laolao:reasoning-enhance:v1:agent:learning:lesson';
  const window = {
    location: {search: '?session=agent%3Alearning%3Alesson'},
    localStorage: {
      getItem: (name) => stored.get(name) || null,
      setItem: (name, value) => stored.set(name, value),
      removeItem: (name) => stored.delete(name),
    },
  };
  let label;
  let button;
  const nameNode = {textContent: ''};
  const panel = {prepend(node) { label = node; }, querySelector() { return label; }};
  const save = {disabled: true, dataset: {}};
  const slider = {style: {setProperty() {}}};
  const menu = {
    querySelector(selector) {
      if (selector === '.chat-controls__reasoning-range') return range;
      if (selector === '.chat-controls__model-browser') return {};
      if (selector === ':scope > .pinkie-model-current') return button;
      if (selector === '.chat-controls__reasoning-panel') return panel;
      if (selector === '.chat-controls__picker-actions .primary') return save;
      return null;
    },
    insertBefore(node) { button = node; },
  };
  const details = {
    isConnected: true, open: true, dataset: {}, style: {setProperty() {}},
    matches(selector) { return selector === 'details.chat-controls__model'; },
    querySelector(selector) {
      if (selector === '.chat-controls__inline-select-menu--combined') return menu;
      if (selector === '.chat-controls__inline-select-label') return {textContent: 'Gemini 3.8 Flash Tiered · High'};
      return null;
    },
    closest() { return null; },
    hasAttribute() { return false; },
    setAttribute() {}, toggleAttribute() {}, removeAttribute(name) { if (name === 'open') this.open = false; },
  };
  const range = {
    min: '0', max: '5', step: '1', value: '5', disabled: false,
    dataset: {chatThinkingValues: 'off,minimal,low,medium,high,xhigh'},
    closest(selector) { return selector === '.chat-controls__reasoning-slider' ? slider : details; },
    matches(selector) { return selector === '.chat-controls__reasoning-range'; },
    setAttribute(name, value) { this[name] = value; },
    dispatchEvent(event) { dispatch('input', event); },
  };
  const document = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    createElement(tag) {
      if (tag === 'button') return {setAttribute() {}, querySelector: () => nameNode};
      return {textContent: ''};
    },
  };
  function dispatch(type, event) {
    event.target = range;
    event.stopImmediatePropagation = () => { event.stopped = true; };
    listeners.get(type)(event);
    if (!event.stopped) (type === 'input' ? nativeInputs : nativeChanges).push(range.value);
  }
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), {
    window, document, Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class {observe() {} disconnect() {}},
    requestAnimationFrame(fn) { fn(); },
  });
  listeners.get('toggle')({target: details});
  assert.equal(range.max, '7');
  assert.equal(range.dataset.chatThinkingValues, 'off,minimal,low,medium,high,xhigh,max,ultra');
  assert.equal(label.textContent, '思考等级 · XHigh');
  assert.equal(menu.querySelector('[data-pinkie-enhancement]'), null, 'no separate tier buttons');

  range.value = '6';
  dispatch('input', {});
  assert.equal(stored.get(key), 'max');
  assert.equal(range.value, '6');
  assert.equal(label.textContent, '思考等级 · Max');
  assert.equal(save.disabled, true, 'the hidden native Save action is no longer used');
  assert.deepEqual(nativeInputs, [], 'already-native-XHigh should not send a fake Max input');
  dispatch('change', {});
  assert.deepEqual(nativeChanges, [], 'the native handler must not see the virtual stop on release');

  range.value = '7';
  dispatch('input', {});
  assert.equal(stored.get(key), 'ultra');
  assert.equal(label.textContent, '思考等级 · Ultra');
  range.value = '4';
  dispatch('input', {});
  assert.equal(stored.has(key), false);
  assert.equal(label.textContent, '思考等级 · High');
  assert.deepEqual(nativeInputs, ['4'], 'native steps still reach the native picker');

  range.value = '6';
  dispatch('input', {});
  assert.equal(details.open, true, 'selecting a tier leaves the picker open');
  assert.equal(stored.get(key), 'max');
});

test('unfilled stops reveal every clickable tier and vanish behind the selected fill', () => {
  const listeners = new Map();
  const markerStyles = [];
  let layer;
  const slider = {
    style: {setProperty() {}},
    querySelector() { return layer; },
    prepend(node) { layer = node; },
  };
  const details = {setAttribute() {}, toggleAttribute() {}, style: {setProperty() {}}};
  const document = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    createElement() {
      return {
        dataset: {}, setAttribute() {},
        style: {setProperty(name, value) { markerStyles.push([name, value]); }},
        replaceChildren(...nodes) { this.markers = nodes; },
      };
    },
  };
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), {window: {}, document, requestAnimationFrame() {}});
  const range = {
    min: '0', max: '7', step: '1', value: '2', disabled: false,
    dataset: {chatThinkingValues: 'off,minimal,low,medium,high,xhigh,max,ultra'},
    closest(selector) { return selector === '.chat-controls__reasoning-slider' ? slider : details; },
    matches(selector) { return selector === '.chat-controls__reasoning-range'; },
  };
  listeners.get('input')({target: range});
  assert.equal(layer.markers.length, 8);
  assert.deepEqual(layer.markers.map((marker) => marker.dataset.pinkieCovered), ['1','1','1','0','0','0','0','0']);
  assert.equal(markerStyles[0][1], '0.000%');
  assert.equal(markerStyles.at(-1)[1], '100.000%');
  range.value = '7';
  listeners.get('input')({target: range});
  assert.equal(layer.markers.every((marker) => marker.dataset.pinkieCovered === '1'), true);
  const css = read('ui/injections/laolao-theme.css');
  assert.match(css, /\.pinkie-reasoning-stop\[data-pinkie-covered="1"\] \{\s*opacity: 0;/);
  assert.match(css, /\.pinkie-reasoning-stops \{[\s\S]*?pointer-events: none;/);
});

test('composer label follows the session-specific enhanced tier and restores native High', () => {
  const listeners = new Map();
  const stored = new Map([['laolao:reasoning-enhance:v1:agent:project:one', 'ultra']]);
  const window = {
    location: {search: '?session=agent%3Aproject%3Aone'},
    localStorage: {getItem: (key) => stored.get(key) || null},
    addEventListener(name, fn) { listeners.set(name, fn); },
  };
  const label = {textContent: 'Gemini 3.1 Pro · High'};
  const summary = {
    aria: '聊天模型, 聊天思考级别: Gemini 3.1 Pro · High',
    querySelector() { return label; },
    getAttribute() { return this.aria; },
    setAttribute(name, value) { if (name === 'aria-label') this.aria = value; },
  };
  const details = {
    isConnected: true, open: false,
    querySelector(selector) { return selector.startsWith(':scope > summary') ? summary : null; },
    removeAttribute() {}, closest() { return null; },
  };
  const document = {
    body: null,
    addEventListener() {},
    querySelectorAll() { return [details]; },
  };
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), {
    window, document, MutationObserver: class {observe() {} disconnect() {}}, requestAnimationFrame(fn) { fn(); },
  });
  assert.equal(label.textContent, 'Gemini 3.1 Pro · Ultra');
  assert.match(summary.aria, /Ultra$/);
  stored.delete('laolao:reasoning-enhance:v1:agent:project:one');
  listeners.get('storage')({key: 'laolao:reasoning-enhance:v1:agent:project:one'});
  assert.equal(label.textContent, 'Gemini 3.1 Pro · High');
  stored.set('laolao:reasoning-enhance:v1:agent:project:two', 'max');
  window.location.search = '?session=agent%3Aproject%3Atwo';
  listeners.get('pinkie:session-selected')();
  assert.equal(label.textContent, 'Gemini 3.1 Pro · Max');
});

test('model and slider selections patch the session without closing the picker', async () => {
  const listeners = new Map();
  const pending = new Map();
  let nextTimer = 1;
  const patches = [];
  const stored = new Map([['laolao:reasoning-enhance:v1:agent:project:one', 'ultra']]);
  const details = {
    isConnected: true, open: true, dataset: {},
    closest() { return null; },
    querySelector() { return null; },
    removeAttribute() {}, toggleAttribute() {},
  };
  const window = {
    location: {search: '?session=agent%3Aproject%3Aone'},
    setTimeout(fn) { const id = nextTimer++; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    localStorage: {
      getItem(name) { return stored.get(name) || null; },
      setItem(name, value) { stored.set(name, value); },
      removeItem(name) { stored.delete(name); },
    },
    __laolaoSidebar: {gwRequest: async (method, payload) => { patches.push([method, payload]); }},
    dispatchEvent() {},
  };
  const document = {addEventListener(name, fn) { listeners.set(name, fn); }};
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), {
    window, document, Event: class { constructor(type) { this.type = type; } }, requestAnimationFrame() {},
  });
  const option = {disabled: false, getAttribute(name) { return name === 'data-chat-model-option' ? 'mm/gemini-3.1-pro' : 'false'; }};
  listeners.get('click')({target: {closest(selector) {
    if (selector === 'details.chat-controls__model') return details;
    if (selector === '[data-chat-model-option]') return option;
    return null;
  }}});
  assert.equal(stored.has('laolao:reasoning-enhance:v1:agent:project:one'), false, 'new model does not keep the old Ultra artwork');
  assert.equal(pending.size, 1);
  [...pending.values()][0]();
  await new Promise(setImmediate);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][0], 'sessions.patch');
  assert.equal(patches[0][1].model, 'mm/gemini-3.1-pro');
  assert.equal(details.open, true);
  const range = {
    value: '4', dataset: {chatThinkingValues: 'off,minimal,low,medium,high'},
    matches(selector) { return selector === '.chat-controls__reasoning-range'; },
    closest(selector) { return selector === 'details.chat-controls__model' ? details : details; },
  };
  listeners.get('change')({target: range});
  assert.equal(pending.size, 1, 'slider commits only on change, never on each input position');
  [...pending.values()][0]();
  await new Promise(setImmediate);
  assert.equal(patches.length, 2);
  assert.equal(patches[1][1].thinkingLevel, 'high');
  assert.equal(details.open, true);
  assert.match(read('ui/injections/laolao-theme.css'), /\.chat-controls__model\[data-pinkie-enhanced="1"\] \.chat-controls__picker-actions \{\s*display: none !important;/);
});

test('model header opens by pointer and click-away or Escape closes only when requested', () => {
  const listeners = new Map();
  const label = {textContent: 'Gemini 3.1 Pro · High'};
  const summary = {querySelector() { return label; }, getAttribute() { return ''; }};
  const details = {
    open: true, isConnected: true, dataset: {},
    querySelector(selector) { return selector.startsWith(':scope > summary') ? summary : null; },
    contains(target) { return target === button; },
    removeAttribute(name) { if (name === 'open') this.open = false; },
    closest() { return null; },
  };
  const button = {parentElement: {}, closest(selector) {
    if (selector === 'details.chat-controls__model') return details;
    if (selector === '.pinkie-model-current') return button;
    return null;
  }};
  const document = {body: null, addEventListener(name, fn) { listeners.set(name, fn); }, querySelectorAll() { return [details]; }};
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), {
    window: {}, document, MutationObserver: class {observe() {} disconnect() {}}, requestAnimationFrame() {},
  });
  listeners.get('pointerdown')({button: 0, target: button});
  assert.equal(details.dataset.pinkieModelsOpen, '1');
  listeners.get('click')({target: button, preventDefault() {}, stopPropagation() {}});
  assert.equal(details.dataset.pinkieModelsOpen, '1', 'following click does not immediately collapse the list');
  listeners.get('click')({target: {closest() { return null; }}});
  assert.equal(details.open, false);
  details.open = true;
  listeners.get('keydown')({key: 'Escape', preventDefault() {}});
  assert.equal(details.open, false);
});

test('a range the picker does not own is left alone', () => {
  const h = harness();
  h.range.matches = () => false;
  h.range.value = '3';
  h.input();
  assert.equal(h.props.size, 0);
  assert.equal(h.details.attributes.get('data-pinkie-level'), undefined);
});

test('nine semantic stops have separate seamless motifs and motion, while the model entry stays quiet', () => {
  const css = read('ui/injections/laolao-theme.css');
  const v5Index = css.indexOf('/* Model control v5');
  const v7Index = css.indexOf('/* Model control v7');
  const v6Index = css.indexOf('/* Model control v6');
  const premium = css.slice(v7Index, v6Index);
  assert.ok(premium.length > 0, '九档材质层必须存在');
  assert.ok(v7Index > v5Index, '新材质必须位于旧层之后');
  assert.match(premium, /width: calc\(var\(--reasoning-fill, 0%\) - var\(--reasoning-end-offset, 0px\) \+ 2px\) !important;/, '填充末端必须跟随原生手柄，不能再留断层');
  const animations = [];
  const motifs = new Set();
  for (const material of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']) {
    const block = premium.match(new RegExp(`\\[data-pinkie-material="${material}"\\]\\[data-pinkie-level\\] \\.chat-controls__reasoning-slider::before \\{[^}]*\\}`));
    assert.ok(block, `${material} 必须有独立样式，且优先于旧的五级样式`);
    const animation = block[0].match(/animation:\s*([\w-]+)/)?.[1];
    assert.ok(animation, `${material} 必须有自己的动画`);
    const asset = `laolao-reasoning-${material}.svg`;
    assert.ok(block[0].includes(asset), `${material} 必须使用自己的图案`);
    const svg = read(`ui/injections/${asset}`);
    assert.match(svg, /<svg[^>]+viewBox=/);
    motifs.add(svg);
    animations.push(animation);
  }
  assert.equal(motifs.size, 9, '九档不能共用同一套素材');
  assert.equal(new Set(animations).size, 9, '九档不能共用同一个流动动画');
  assert.match(css, /height: 22px;/, '轨道不能再是细线');
  const quietControls = css.slice(v5Index, v6Index);
  assert.match(quietControls, /chat-controls__reasoning-dots \{ display: none !important; \}/, '外露节点必须保持移除');
  assert.match(quietControls, /width: 26px;[\s\S]*?-webkit-mask: url\("data:image\/svg\+xml,[\s\S]*?center \/ 18px 18px no-repeat;/, '滑块保留大点击区域，但可见标记应是轨道内的派对微光');
  assert.doesNotMatch(quietControls, /transparent 0 9px,[\s\S]*?var\(--pinkie-thumb-edge\) 11px 14px/, '不能回到突兀的竖线推进标记');
  assert.match(quietControls, /border-color: transparent;\s*\n\s*border-radius: 7px;[\s\S]*?background: transparent;\s*\n\s*box-shadow: none;/, '模型入口必须保持弱化');
});

test('each semantic stop has its own transparent Pinkie corner artwork and preserves the central slider', () => {
  const css = read('ui/injections/laolao-theme.css');
  const frames = css.slice(css.indexOf('/* Model control v8'));
  assert.match(frames, /background-size: var\(--pinkie-frame-size, 70% auto\), 100% 100%;/);
  assert.match(frames, /background-position: var\(--pinkie-frame-position, right top\), center;/);
  for (const material of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']) {
    const filename = `laolao-reasoning-frame-${material}.png`;
    assert.ok(frames.includes(filename), `${material} 应有独立角落图`);
    const png = fs.readFileSync(path.join(__dirname, '..', 'ui/injections', filename));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 1582);
    assert.equal(png.readUInt32BE(20), 994);
    assert.equal(png[25], 6, `${material} 需保留 RGBA 透明通道`);
  }
});

test('active slider effects match all nine Pinkie party scenes', () => {
  const css = read('ui/injections/laolao-theme.css');
  const active = css.slice(css.indexOf('/* Model control v9'));
  assert.ok(active.length > 0, '派对特效层必须存在');
  assert.match(active, /party-off\.svg\?v=1"\), linear-gradient/, '关闭档仍应在空轨上显示主题');
  const animations = new Set();
  const motifs = new Set();
  for (const material of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']) {
    const block = active.match(new RegExp(`\\[data-pinkie-material="${material}"\\]\\[data-pinkie-level\\] \\.chat-controls__reasoning-slider::before \\{[^}]*\\}`));
    assert.ok(block, `${material} 应有独立滑杆特效`);
    const asset = `laolao-reasoning-party-${material}.svg`;
    assert.ok(block[0].includes(asset), `${material} 应与角落角色主题相配`);
    const animation = block[0].match(/animation:\s*(pinkie-v9-[\w-]+)/)?.[1];
    assert.ok(animation && active.includes(`@keyframes ${animation}`), `${material} 应有独立可运行的动画`);
    const svg = read(`ui/injections/${asset}`);
    assert.match(svg, /<svg[^>]+viewBox=/);
    motifs.add(svg);
    animations.add(animation);
  }
  assert.equal(motifs.size, 9, '九档不能共用一个图案');
  assert.equal(animations.size, 9, '九档不能共用一个流动效果');
  assert.doesNotMatch(active, /laolao-reasoning-(?:high|ultra)\.svg/, '不能回退到水滴或晶体');
});

test('party motifs keep moving forward without reversing or jumping at the loop', () => {
  const css = read('ui/injections/laolao-theme.css');
  const active = css.slice(css.indexOf('/* Model control v9'));
  const widths = { off: 128, minimal: 136, low: 144, medium: 152, high: 160, xhigh: 168, adaptive: 176, max: 184, ultra: 200 };
  for (const [material, width] of Object.entries(widths)) {
    const block = active.match(new RegExp(`\\[data-pinkie-material="${material}"\\]\\[data-pinkie-level\\] \\.chat-controls__reasoning-slider::before \\{[^}]*\\}`));
    assert.ok(block, `${material} 应有连续动画`);
    const animation = block[0].match(/animation:\s*(pinkie-v9-[\w-]+)[^;]+;/)?.[0];
    assert.match(animation, /linear infinite;/, `${material} 不应减速、回弹或倒放`);
    const name = animation.match(/pinkie-v9-[\w-]+/)[0];
    const frames = active.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(frames, `${material} 应有关键帧`);
    assert.match(frames, new RegExp(`100% \\{ background-position: ${width}px 0,`), `${material} 应恰好前进一个完整图案周期`);
    assert.doesNotMatch(frames, /background-position:\s*-/, `${material} 不能倒退`);
  }
});

test('changing a reasoning step hands off between two preloaded background layers', async () => {
  const listeners = new Map();
  const layers = [];
  const menu = { isConnected: true, style: { backgroundImage: '', removeProperty(name) { if (name === 'background-image') this.backgroundImage = ''; } }, prepend(...nodes) { layers.push(...nodes); } };
  const details = {
    dataset: { pinkieEnhanced: '1' },
    querySelector: () => menu,
    setAttribute() {}, toggleAttribute() {},
    style: { setProperty() {} },
  };
  const slider = { style: { setProperty() {} } };
  const range = {
    min: '0', max: '8', step: '1', value: '4', disabled: false,
    dataset: { chatThinkingValues: 'off,minimal,low,medium,high,xhigh,adaptive,max,ultra' },
    closest: (selector) => selector === '.chat-controls__reasoning-slider' ? slider : details,
    matches: (selector) => selector === '.chat-controls__reasoning-range',
  };
  const document = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    createElement() {
      const classes = new Set();
      return {
        dataset: {}, setAttribute() {}, append() {},
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
      };
    },
  };
  class ImageMock {
    set src(value) { this.url = value; this.onload(); }
    decode() { return Promise.resolve(); }
  }
  vm.runInNewContext(read('ui/injections/laolao-model-picker.js'), {
    window: { Image: ImageMock }, document, requestAnimationFrame: (fn) => fn(),
  });
  listeners.get('input')({ target: range });
  assert.match(menu.style.backgroundImage, /reasoning-frame-high\.png/, '首帧加载时应固定旧背景，避免快速拖动闪切');
  await new Promise(setImmediate);
  assert.equal(layers.length, 2);
  assert.equal(layers[0].dataset.pinkieFrame, 'high');
  assert.equal(layers[0].classList.contains('is-active'), true);
  assert.equal(details.dataset.pinkieFrameReady, '1');

  range.value = '8';
  listeners.get('input')({ target: range });
  await new Promise(setImmediate);
  assert.equal(layers[1].dataset.pinkieFrame, 'ultra');
  assert.equal(layers[0].classList.contains('is-active'), false);
  assert.equal(layers[1].classList.contains('is-active'), true);
});

test('background artwork and slider interactions animate without moving the fill end', () => {
  const css = read('ui/injections/laolao-theme.css');
  const active = css.slice(css.indexOf('/* Model control v10'));
  assert.match(active, /transition: opacity 540ms/);
  assert.match(active, /@keyframes pinkie-v10-frame-drift/);
  assert.match(active, /reasoning-range:active/);
  assert.match(active, /reasoning-range:focus-visible/);
  assert.doesNotMatch(active, /transition:[^;]*\bwidth\b/, '拖动时填充末端不能滞后于原生手柄');
  for (const material of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']) {
    assert.ok(active.includes(`data-pinkie-frame="${material}"`));
  }
  assert.match(active, /prefers-reduced-motion: reduce/);
});

test('party energy rises step by step and scene changes avoid double exposure', () => {
  const css = read('ui/injections/laolao-theme.css');
  const ladder = css.slice(css.indexOf('/* Model control v11'));
  const materials = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra'];
  let lastAura = 0;
  let lastDuration = Infinity;
  let lastFrameDuration = Infinity;
  let lastDrift = -1;
  let lastImage = 0;
  for (const material of materials) {
    const block = ladder.match(new RegExp(`\\[data-pinkie-material="${material}"\\] \\{[^}]*\\}`))?.[0];
    assert.ok(block, `${material} 需要自己的舞台强度`);
    const aura = Number(block.match(/--pinkie-tier-aura:\s*([\d.]+)/)?.[1]);
    const duration = Number(block.match(/--pinkie-tier-duration:\s*([\d.]+)s/)?.[1]);
    const frameDuration = Number(block.match(/--pinkie-tier-frame-duration:\s*([\d.]+)s/)?.[1]);
    const drift = Math.abs(Number(block.match(/--pinkie-tier-drift:\s*(-?[\d.]+)px/)?.[1]));
    const image = Number(block.match(/--pinkie-tier-image:\s*([\d.]+)/)?.[1]);
    assert.ok(aura > lastAura, `${material} 的氛围光应该比前一档更强`);
    assert.ok(duration < lastDuration, `${material} 的流动节奏应该比前一档更快`);
    assert.ok(frameDuration < lastFrameDuration, `${material} 的背景动作也应该逐级增强`);
    assert.ok(drift > lastDrift, `${material} 的背景位移也应该逐级增强`);
    assert.ok(image >= lastImage, `${material} 的角色显色不能比前一档更弱`);
    lastAura = aura; lastDuration = duration; lastFrameDuration = frameDuration; lastDrift = drift; lastImage = image;
  }
  assert.match(ladder, /opacity 150ms ease/);
  assert.match(ladder, /opacity 350ms ease 160ms/, '旧图退场后新图才进场，避免重影');
  assert.match(read('ui/injections/laolao-model-picker.js'), /classList\.add\("is-initial"\)/);
});

test('each character frame stays in a corner and the ambient halo rises by tier', () => {
  const css = read('ui/injections/laolao-theme.css');
  const composition = css.slice(css.indexOf('/* Model control v12'));
  const materials = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra'];
  let lastHalo = 0;
  for (const material of materials) {
    const frame = composition.match(new RegExp(`\\[data-pinkie-frame="${material}"\\] \\{([^}]*)\\}`))?.[1];
    assert.ok(frame, `${material} 应有单独的背景构图`);
    const size = Number(frame.match(/--pinkie-frame-size:\s*(\d+)% auto/)?.[1]);
    assert.ok(size >= 60 && size <= 76, `${material} 的角色不能压到操作按钮`);
    assert.match(frame, /--pinkie-frame-position:\s*(left|right) top;/);
    const tier = composition.match(new RegExp(`\\[data-pinkie-material="${material}"\\] \\{[^}]*--pinkie-tier-halo-size:\\s*(\\d+)px;`));
    assert.ok(tier, `${material} 应有自己的氛围强度`);
    const halo = Number(tier[1]);
    assert.ok(halo > lastHalo, `${material} 的边缘光应强于前一档`);
    lastHalo = halo;
  }
  assert.match(css, /background-size: var\(--pinkie-frame-size, 70% auto\), 100% 100%/);
  assert.match(css, /background-size: var\(--pinkie-frame-size, 70% auto\);/);
});

test('model picker keeps the artwork visible in a compact two-row layout', () => {
  const css = read('ui/injections/laolao-theme.css');
  const layout = css.slice(css.indexOf('/* Model control v13'));
  assert.match(layout, /width: min\(304px, calc\(100vw - 24px\)\)/);
  assert.match(layout, /min-height: 116px/);
  assert.match(layout, /::before \{ display: none; \}/, '不能额外插入臃肿的画面区');
  assert.match(layout, /align-self: center/);
  assert.match(layout, /border: 0;[\s\S]*?background: transparent/);
  assert.match(layout, /\.pinkie-model-current__chevron \{ display: none; \}/);
  assert.match(layout, /chat-controls__reasoning-panel \{[\s\S]*?flex: 0 0 69px/);
  assert.match(layout, /\.pinkie-reasoning-current \{[\s\S]*?top: 2px;/);
  assert.match(read('ui/injections/laolao-model-picker.js'), /思考等级 · \$\{name\}/);
  assert.match(layout, /chat-controls__picker-actions \{\s*display: none !important;/);
  assert.match(layout, /pinkie-model-frame \{[\s\S]*?inset: 0;/);
  assert.match(layout, /data-pinkie-models-open="1"[\s\S]*?pinkie-model-frame \{ visibility: hidden; \}/, '展开模型清单时，人物不能挡住选项');
  for (const material of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']) {
    const rule = layout.match(new RegExp(`\\[data-pinkie-frame="${material}"\\] \\{([^}]*)\\}`))?.[1];
    assert.ok(rule, `${material} 应有独立角落构图`);
    const width = Number(rule.match(/--pinkie-frame-size:\s*(\d+)% auto/)?.[1]);
    assert.ok(width >= 79 && width <= 84, `${material} 的角色不能被缩到看不见`);
  }
});
