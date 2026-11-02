const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-sidebar.js'), 'utf8');
const start = source.indexOf('  const drawerFocusFixAllowed=');
const end = source.indexOf('  async function patchSession(', start);
assert.ok(start >= 0 && end > start, 'drawer focus handlers must be present');
const segment = source.slice(start, end);

function harness({agent = 'learning', width = 800, open = false, initiallyInert = false} = {}) {
  const events = {}, windows = {}, attributes = new Map(initiallyInert ? [['inert', '']] : []);
  const rootAttributes = new Map();
  const nav = {
    hasAttribute: (k) => attributes.has(k), getAttribute: (k) => attributes.get(k) ?? null,
    setAttribute: (k, v) => attributes.set(k, String(v)), removeAttribute: (k) => attributes.delete(k),
  };
  const calls = [];
  const host = {navDrawerOpen: open, closeNavDrawer(options) { calls.push(options); this.navDrawerOpen = false; }};
  const shell = {
    classList: {contains: (c) => c === 'shell--nav-drawer-open' && host.navDrawerOpen},
    querySelector: (s) => s === ':scope > .shell-nav' ? nav : null,
  };
  const document = {
    documentElement: {getAttribute: (k) => rootAttributes.get(k) ?? null},
    querySelector(s) { if (s === 'openclaw-app-shell') return host; if (s === '.shell.shell--chat') return shell; if (s === '.shell.shell--nav-drawer-open') return host.navDrawerOpen ? shell : null; return null; },
    addEventListener(name, handler) { events[name] = handler; },
  };
  const window = {innerWidth: width, addEventListener(name, handler) { windows[name] = handler; }};
  class Observer { constructor(handler) { this.handler = handler; } observe() {} disconnect() {} }
  const context = {document, window, MutationObserver: Observer, pageSessionKey: () => `agent:${agent}:audit`, setTimeout};
  vm.createContext(context);
  vm.runInContext(segment + '\nthis.api={ensureDrawerFocusGuard,syncDrawerFocusability,closeNavigationDrawer};', context);
  return {api: context.api, nav, host, shell, calls, events, windows, rootAttributes};
}

test('closed narrow drawer cannot receive focus and reopens normally in all included modes', () => {
  for (const agent of ['main', 'project', 'thinking', 'learning']) {
    const h = harness({agent});
    h.api.ensureDrawerFocusGuard();
    assert.equal(h.nav.hasAttribute('inert'), true, agent);
    h.host.navDrawerOpen = true;
    h.api.syncDrawerFocusability();
    assert.equal(h.nav.hasAttribute('inert'), false, agent);
    h.events.keydown({key: 'Escape'});
    assert.equal(h.calls.at(-1).restoreFocus, true, agent);
    h.api.syncDrawerFocusability();
    assert.equal(h.nav.hasAttribute('inert'), true, agent);
  }
});

test('backdrop uses native close; outside control keeps its own pointer focus', () => {
  const h = harness({open: true});
  const backdrop = {closest: (selector) => selector === '.shell-nav-backdrop' ? {} : null};
  h.events.pointerdown({target: backdrop});
  assert.equal(h.calls.length, 0);
  const outside = {closest: () => null};
  h.events.pointerdown({target: outside});
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].restoreFocus, false);
});

test('wide pinned sidebar stays available and existing inert is not cleared', () => {
  const wide = harness({width: 1440});
  wide.api.ensureDrawerFocusGuard();
  assert.equal(wide.nav.hasAttribute('inert'), false);
  const ownedElsewhere = harness({initiallyInert: true});
  ownedElsewhere.api.ensureDrawerFocusGuard();
  ownedElsewhere.host.navDrawerOpen = true;
  ownedElsewhere.api.syncDrawerFocusability();
  assert.equal(ownedElsewhere.nav.hasAttribute('inert'), true);
});

test('an unknown session keeps its previous drawer handling', () => {
  const h = harness({agent: 'other', open: true});
  h.api.ensureDrawerFocusGuard();
  assert.equal(h.nav.hasAttribute('inert'), false);
  h.events.pointerdown({target: {closest: (selector) => selector === '.shell-nav-backdrop' ? {} : null}});
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].restoreFocus, false);
});
