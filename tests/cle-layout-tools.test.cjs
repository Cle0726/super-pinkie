// Behavioural tests for the folded tools menu and per-pane room marking.
// These drive a real (mini) DOM: open the menu, run several frames, press ArrowDown, and assert
// that the nodes and the focus survive — not merely that the source contains "ArrowDown".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');

const root = path.join(__dirname, '../services/cle-studio');
const composerSource = fs.readFileSync(path.join(root, 'src/composer/composer.js'), 'utf8');
const panesSource = fs.readFileSync(path.join(root, 'src/composer/panes.js'), 'utf8');

// composer.js imports ./panes.js; strip the import and inject the module as a global instead so
// the file can run in a bare vm context.
function loadComposer() {
  const document = createDocument();
  const frames = [];
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    listeners: [],
    addEventListener(type, handler) { this.listeners.push({type, handler}); },
    removeEventListener(type, handler) {
      this.listeners = this.listeners.filter((entry) => entry.type !== type || entry.handler !== handler);
    },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
  };
  const observers = [];
  class RecordingObserver {
    constructor(callback) { this.callback = callback; this.records = []; observers.push(this); }
    observe(target) { this.target = target; document.addObserver?.(this); this.attached = true; }
    // a record is delivered when its target is inside the observed subtree (or is the target)
    sees(record) {
      if (this.disconnected || !this.attached) return false;
      for (let node = record.target; node; node = node.parentElement) if (node === this.target) return true;
      return false;
    }
    disconnect() { this.disconnected = true; document.removeObserver?.(this); }
    take(records) { this.records.push(...records); this.callback(records, this); }
  }
  const panesContext = {document, requestAnimationFrame: window.requestAnimationFrame, MutationObserver: RecordingObserver};
  // the modules are ESM; strip `export` so they can run in a bare vm context
  const panesPlain = panesSource.replace(/\bexport\s+/g, '');
  const panesModule = vm.runInNewContext(`${panesPlain}\n;({mountPaneRooms, markPaneRooms, roomOfSession, paneSessionKey})`, panesContext);

  const body = `${composerSource.replace(/^import .*$/m, '').replace(/\bexport\s+/g, '')}\n;({mountToolFold, classifyTool})`;
  const context = {
    document, window,
    requestAnimationFrame: window.requestAnimationFrame,
    MutationObserver: RecordingObserver,
    AbortController,
    mountPaneRooms: panesModule.mountPaneRooms,
    console,
  };
  const exported = vm.runInNewContext(body, context);
  // one frame = deliver the pending mutation records (microtask), then run rAF callbacks,
  // which is the real ordering that let the old code loop every frame
  const runFrames = (count = 1) => {
    for (let i = 0; i < count; i++) {
      document.flushMutations();
      const batch = frames.splice(0, frames.length);
      for (const fn of batch) fn(0);
    }
  };
  return {document, window, exported, observers, runFrames};
}

// Build one composer with a lead holding: attach (essential), permission (normal),
// browser (low), voice (low), model (essential).
function makeComposer(document, {width = 864, leadWidth = 359} = {}) {
  const composerEl = document.createElement('div');
  composerEl.className = 'cle-composer';
  const input = document.createElement('div');
  input.className = 'agent-chat__input';
  const footer = document.createElement('div');
  footer.className = 'agent-chat__composer-footer';
  const lead = document.createElement('div');
  lead.className = 'agent-chat__composer-lead';
  lead.clientWidth = leadWidth;
  const make = (cls, box) => {
    const el = document.createElement('button');
    el.className = cls;
    el.box = {left: 0, top: 0, width: box, height: 32, right: box, bottom: 32};
    el.textContent = cls;
    return el;
  };
  const attach = make('agent-chat__input-btn', 36);
  const permission = make('chat-controls__permission-trigger', 30);
  const browser = make('chat-browser-panel-toggle', 30);
  const voice = make('chat-send-btn--voice', 30);
  const model = make('chat-controls__inline-select-trigger', 120);
  lead.append(attach, permission, browser, voice, model);
  footer.append(lead);
  input.append(footer);
  composerEl.append(input);
  document.body.append(composerEl);
  return {composerEl, input, footer, lead, attach, permission, browser, voice, model};
}

test('opening the tools menu is stable across frames and keeps the focused item', () => {
  const {document, exported, runFrames} = loadComposer();
  const {composerEl, lead} = makeComposer(document);
  const controller = new AbortController();
  exported.mountToolFold(controller.signal);
  runFrames(2);

  const more = lead.querySelector('.cle-tools-more');
  assert.ok(more, 'the fold trigger exists');
  more.dispatch('click');
  const menu = document.querySelector('.cle-tools-menu');
  assert.equal(menu.hidden, false, 'the menu opens');
  const rows = () => [...menu.children];
  const firstBatch = rows();
  assert.ok(firstBatch.length >= 1, 'the menu lists the folded controls');
  assert.equal(document.activeElement, firstBatch[0], 'the first item takes focus');

  // simulate the observer firing for several frames, as it does in the real app
  for (let i = 0; i < 5; i++) {
    runFrames(1);
    more.dispatch('click');     // toggles closed
    more.dispatch('click');     // and open again
  }
  assert.equal(menu.hidden, false);

  // open once, then let frames pass without re-toggling: nodes and focus must be untouched
  const before = rows();
  runFrames(6);
  assert.deepEqual(rows(), before, 'no rebuild while the control set is unchanged');
  assert.equal(document.activeElement, before[0], 'focus stays on the first item');

  controller.abort();
});

test('ArrowDown moves to the next item and is not reset by later frames', () => {
  const {document, exported, runFrames} = loadComposer();
  const {lead} = makeComposer(document);
  const controller = new AbortController();
  exported.mountToolFold(controller.signal);
  runFrames(2);
  const more = lead.querySelector('.cle-tools-more');
  more.dispatch('click');
  const menu = document.querySelector('.cle-tools-menu');
  const rows = [...menu.children];
  assert.ok(rows.length >= 2, 'at least two folded tools');

  menu.dispatch('keydown', {key: 'ArrowDown', target: rows[0]});
  assert.equal(document.activeElement, rows[1], 'focus moved to the second item');

  runFrames(6);
  assert.deepEqual([...menu.children], rows, 'the menu was not rebuilt');
  assert.equal(document.activeElement, rows[1], 'ArrowDown was not undone by a refresh');

  menu.dispatch('keydown', {key: 'ArrowDown', target: rows[1]});
  assert.equal(document.activeElement, rows[2 % rows.length]);
  controller.abort();
});

test('menu rebuilds only when the folded control set really changes', () => {
  const {document, exported, runFrames, observers} = loadComposer();
  const {lead, voice} = makeComposer(document);
  const controller = new AbortController();
  exported.mountToolFold(controller.signal);
  runFrames(2);
  const more = lead.querySelector('.cle-tools-more');
  more.dispatch('click');
  const menu = document.querySelector('.cle-tools-menu');
  const before = [...menu.children];
  assert.equal(before.length, 2);
  runFrames(3);
  assert.deepEqual([...menu.children], before, 'stable');

  // a real change: the browser control disappears from the lead. The body observer reports the
  // removal, which schedules one sync on the next frame.
  const browser = lead.querySelector('.chat-browser-panel-toggle');
  browser.remove();
  const mo = observers.find((entry) => entry.target === document.body);
  assert.ok(mo, 'the fold watches the body');
  mo.take([{type: 'childList', target: lead, addedNodes: [], removedNodes: [browser]}]);
  runFrames(3);
  assert.equal([...menu.children].length, 1, 'the menu follows the control set');
  assert.equal(document.activeElement, menu.children[0], 'focus is preserved on rebuild');
  controller.abort();
});

test('dispose removes every global listener and the menu node', () => {
  const {document, window, exported, runFrames} = loadComposer();
  const {lead} = makeComposer(document);
  const controller = new AbortController();
  exported.mountToolFold(controller.signal);
  runFrames(2);
  const listenersDuring = window.listeners.length;
  assert.ok(listenersDuring >= 2, 'resize + scroll are registered');

  controller.abort();
  const stillThere = window.listeners.filter((entry) => entry.type === 'resize' || entry.type === 'scroll');
  assert.deepEqual(stillThere, [], 'window listeners are gone after abort');
  assert.equal(document.querySelector('.cle-tools-menu'), null, 'the menu node is removed');
  assert.equal(document.querySelector('.cle-tools-more'), null, 'the trigger is removed');
});

test('mounting twice does not accumulate window listeners', () => {
  const {document, window, exported, runFrames} = loadComposer();
  makeComposer(document);
  const first = new AbortController();
  exported.mountToolFold(first.signal);
  runFrames(2);
  first.abort();
  const afterFirst = window.listeners.length;
  const second = new AbortController();
  exported.mountToolFold(second.signal);
  runFrames(2);
  const delta = window.listeners.length - afterFirst;
  assert.ok(delta <= 2, `second mount added ${delta} window listeners (resize + scroll expected)`);
  second.abort();
  assert.equal(window.listeners.length, afterFirst, 'and it cleans up symmetrically');
});

test('the fold is driven by measured occupancy, not by a fixed pane width', () => {
  const {document, exported, runFrames, observers} = loadComposer();
  // 864px composer: 359px lead, tools that fit on one row
  const wide = makeComposer(document, {leadWidth: 800});
  const controller = new AbortController();
  exported.mountToolFold(controller.signal);
  runFrames(2);
  assert.equal(wide.composerEl.classList.contains('is-crowded'), false, 'a wide row with room does not fold');

  // a narrow lead whose essentials alone overflow (adding a composer mutates the body, which the
  // real observer reports; replay that record here)
  const narrow = makeComposer(document, {leadWidth: 120});
  const mo = observers.find((entry) => entry.target === document.body);
  mo.take([{type: 'childList', target: document.body, addedNodes: [narrow.composerEl], removedNodes: []}]);
  runFrames(2);
  assert.equal(narrow.composerEl.classList.contains('is-crowded'), true, 'a crowded row folds regardless of pane width');

  // the essential controls are never folded away
  for (const el of [narrow.attach, narrow.model]) {
    assert.notEqual(el.dataset.clePriority, 'low', 'essentials are not marked low');
  }
  controller.abort();
});
