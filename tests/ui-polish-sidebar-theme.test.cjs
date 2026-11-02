const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');
const root = path.join(__dirname, '..');
const night = fs.readFileSync(path.join(root, 'ui/injections/laolao-night.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'ui/injections/laolao-sidebar.js'), 'utf8');
const begin = sidebar.indexOf('  function syncSidebarThemeButton()');
const end = sidebar.indexOf('\n  function run()', begin);
assert.ok(begin >= 0 && end > begin);

function harness(saved = new Map()) {
  const document = createDocument(), listeners = new Map(), calls = [], messages = [];
  const key = 'openclaw.control.settings.v1:ws://127.0.0.1:18789';
  if (!saved.has(key)) saved.set(key, JSON.stringify({themeMode: 'light'}));
  document.documentElement.setAttribute('data-theme-mode', JSON.parse(saved.get(key)).themeMode);
  let mutation;
  const shell = document.createElement('openclaw-app-shell');
  shell.context = {theme: {setMode(mode, element) {
    calls.push({mode, element});
    saved.set(key, JSON.stringify({themeMode: mode}));
    document.documentElement.setAttribute('data-theme-mode', mode);
    mutation();
  }}};
  const footer = document.createElement('div'); footer.className = 'sidebar-shell__footer';
  const actions = document.createElement('div'); actions.className = 'sidebar-footer-actions';
  footer.append(actions); document.body.append(shell, footer);
  const window = {matchMedia: () => ({matches: false, addEventListener() {}}),
    addEventListener(name, fn) { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    webkit: {messageHandlers: {laolaoWindowControl: {postMessage(value) { messages.push(value); }}}}};
  let allowed = true;
  const context = {window, document, drawerFocusFixAllowed: () => allowed, location: {protocol:'http:',host:'127.0.0.1:18789',hostname:'127.0.0.1'},
    localStorage: {getItem: k => saved.get(k) ?? null}, matchMedia: () => ({matches:false,addEventListener(){}}),
    MutationObserver: class {constructor(fn) { mutation=fn; } observe() {} disconnect() {}},
    CustomEvent: class {constructor(type, options) { this.type=type; this.detail=options.detail; }},
    setTimeout: fn => fn(), console};
  vm.runInNewContext(night, context);
  vm.runInNewContext(sidebar.slice(begin, end) + '\nthis.testAPI={ensureSidebarThemeButton};', context);
  context.testAPI.ensureSidebarThemeButton();
  return {document, window, saved, calls, messages, button: actions.querySelector('.laolao-sidebar-theme-toggle'), disable() { allowed = false; context.testAPI.ensureSidebarThemeButton(); }};
}

test('sidebar button uses the native theme controller, updates its label and keeps the saved mode', () => {
  const h = harness();
  assert.equal(h.button.getAttribute('aria-label'), '切换到深色模式');
  h.button.click();
  assert.equal(h.calls[0].mode, 'dark');
  assert.equal(h.calls[0].element, h.button);
  assert.equal(h.button.getAttribute('aria-label'), '切换到浅色模式');
  assert.equal(h.button.getAttribute('aria-pressed'), 'true');
  assert.equal(h.messages.at(-1).dark, true);
  const refreshed = harness(h.saved);
  assert.equal(refreshed.button.getAttribute('aria-label'), '切换到浅色模式');
  refreshed.button.click();
  assert.equal(refreshed.window.__pinkieNight.on, false);
  assert.equal(JSON.parse(h.saved.get('openclaw.control.settings.v1:ws://127.0.0.1:18789')).themeMode, 'light');
});


test('sessions outside the included modes do not gain the new button', () => {
  const h = harness();
  h.disable();
  assert.equal(h.document.querySelector('.laolao-sidebar-theme-toggle'), null);
});
