// Reproduce the native plugin host's handover: mount the next activation first,
// then call the previous activation's disposer. Both revisions share a document.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from '../services/cle-studio/node_modules/esbuild/lib/main.js';

const main = path.resolve(import.meta.dirname, '../services/cle-studio/src/main.js');
const lifecycle = path.resolve(import.meta.dirname, '../services/cle-studio/src/core/activation.js');
const parts = `
export const blink = {}, composer = {};
export function ensureTheme() { return document.themeReady !== false; }
export function startBrandGuard() {}
export function initModes() {}
export function retainSkin() {}
export function mountRooms(host, signal) {
  document.events.push('rooms:' + host.id);
  document.live.add(host.id);
  document.documentElement.dataset.cleRoom = host.id;
  signal.addEventListener('abort', () => {
    document.events.push('dispose:' + host.id);
    document.live.delete(host.id);
    delete document.documentElement.dataset.cleRoom;
  }, {once: true});
  return host.id;
}
export function mountComposer(host, signal) {
  document.composer = host.id;
  signal.addEventListener('abort', () => { document.composer = null; }, {once: true});
}
export function mountUtilities() { return {}; }
export function mountWelcome() {}
export function mountGaze() {}
export function mountToolFold() {}
export function loadLegacy() {}
export function makeHostFacade() { return {sessions: {selectedKey: 'safe-selected'}}; }
export function installLegacyShim() { document.legacySelection = window.CLE?.host?.sessions?.selectedKey; }
export function mountStatus() {}
export function mountRecovery() {}
export function mountStudy() {}
export function mountSplash() {}
export function mountLineDecor() {}
export function mountBackdrop() {}
export function mountGazeFx() {}
export function mountKeys() {}
export function mountReasoning() {}
export function mountTranscript() {}
export function mountPrune() {}
export function mountViewport() {}
`;
async function loadMain(revision) {
  const result = await build({entryPoints: [main], bundle: true, write: false, format: 'esm',
    plugins: [{name: 'isolate-activation', setup(b) {
      b.onLoad({filter: /\.css$/}, () => ({contents: '', loader: 'js'}));
      b.onLoad({filter: /\.js$/}, (args) => {
        if (args.path === main || args.path === lifecycle) return;
        return {contents: parts, loader: 'js'};
      });
    }}],
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${revision}`)).default;
}
function fixture() {
  const saved = Object.fromEntries(['document', 'window', 'MutationObserver'].map((key) => [key, globalThis[key]]));
  globalThis.document = {
    documentElement: {dataset: {}, toggleAttribute() {}},
    events: [], live: new Set(), composer: null,
  };
  globalThis.window = {};
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  return {doc: document, restore() {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }};
}

test('new activation survives the native mount-next / dispose-previous order', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const app = await loadMain('same-module');
  const f = fixture();
  try {
    const oldDispose = app.activate({id: 'left'});
    const nextDispose = app.activate({id: 'single'});
    oldDispose();
    assert.equal(f.doc.documentElement.dataset.cle, '0.1.0');
    assert.equal(f.doc.documentElement.dataset.cleActive, '1');
    assert.equal(f.doc.documentElement.dataset.cleRoom, 'single');
    assert.equal(f.doc.composer, 'single');
    assert.deepEqual([...f.doc.live], ['single']);
    assert.deepEqual(f.doc.events, ['rooms:left', 'dispose:left', 'rooms:single']);
    oldDispose();
    assert.equal(f.doc.composer, 'single', 'a repeated late dispose must be harmless');
    nextDispose();
    // a connection loss keeps the UI through the reconnect grace: the upstream app must not show
    assert.equal(f.doc.documentElement.dataset.cleActive, '1', 'the live UI waits out the reconnect grace');
    assert.equal(f.doc.composer, 'single');
    t.mock.timers.tick(10_000);
    assert.equal(f.doc.documentElement.dataset.cle, '0.1.0', 'static document skin survives disconnect');
    assert.equal(f.doc.documentElement.dataset.cleActive, undefined, 'live controls are explicitly retired');
    assert.equal(f.doc.live.size, 0);
    assert.equal(f.doc.composer, null);
  } finally { f.restore(); }
});

test('separately imported UI revisions still share the document handover', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const [before, after] = await Promise.all([loadMain('old-bundle'), loadMain('new-bundle')]);
  const f = fixture();
  try {
    const oldDispose = before.activate({id: 'before-reload'});
    const nextDispose = after.activate({id: 'after-reload'});
    oldDispose();
    assert.deepEqual([...f.doc.live], ['after-reload']);
    assert.equal(f.doc.documentElement.dataset.cleRoom, 'after-reload');
    assert.equal(f.doc.composer, 'after-reload');
    nextDispose(); nextDispose();
    t.mock.timers.tick(10_000);
    assert.equal(f.doc.live.size, 0);
  } finally { f.restore(); }
});

test('a theme-reload activation retires the previous UI and disposes safely', async () => {
  const app = await loadMain('theme-reload');
  const f = fixture();
  try {
    const oldDispose = app.activate({id: 'old'});
    f.doc.themeReady = false;
    const reloadDispose = app.activate({id: 'reload'});
    assert.equal(f.doc.live.size, 0);
    assert.equal(f.doc.documentElement.dataset.cle, '0.1.0', 'theme reload keeps the last good skin until navigation');
    reloadDispose(); oldDispose();
    f.doc.themeReady = true;
    const finalDispose = app.activate({id: 'connected'});
    reloadDispose();
    assert.equal(f.doc.composer, 'connected');
    finalDispose();
  } finally { f.restore(); }
});

test('legacy notifications during install already see the safe host facade', async () => {
  const app = await loadMain('facade-order');
  const f = fixture();
  try {
    window.CLE = {host: {get sessions() { throw new Error('previous activation ended'); }}};
    const dispose = app.activate({id: 'current'});
    assert.equal(f.doc.legacySelection, 'safe-selected');
    assert.equal(window.CLE.host.sessions.selectedKey, 'safe-selected');
    dispose();
  } finally { f.restore(); }
});

test('a reconnect inside the grace hands over in one task, never showing the upstream app', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const app = await loadMain('reconnect');
  const f = fixture();
  try {
    const lostDispose = app.activate({id: 'before'});
    lostDispose();                                   // connection lost
    assert.equal(f.doc.documentElement.dataset.cleActive, '1');
    assert.deepEqual([...f.doc.live], ['before']);
    t.mock.timers.tick(3000);
    const backDispose = app.activate({id: 'after'}); // reconnected
    assert.deepEqual(f.doc.events, ['rooms:before', 'dispose:before', 'rooms:after']);
    t.mock.timers.tick(10_000);                      // the old grace timer must not retire the new UI
    assert.equal(f.doc.composer, 'after');
    assert.equal(f.doc.documentElement.dataset.cleActive, '1');
    backDispose();
  } finally { f.restore(); }
});
