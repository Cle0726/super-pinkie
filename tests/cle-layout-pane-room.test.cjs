// Per-pane room marking and container-query scoping.
//
// `html[data-cle-room]` is the sidebar's room — a page value. In 双模式 the two panes can sit in
// different rooms, so type size and spacing must read the pane's own session. These tests drive
// the real marking module over a fake split view and assert the CSS that consumes the marks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');

const root = path.join(__dirname, '../services/cle-studio');
const panesSource = fs.readFileSync(path.join(root, 'src/composer/panes.js'), 'utf8');
const statusCss = fs.readFileSync(path.join(root, 'src/process/status.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const composerCss = fs.readFileSync(path.join(root, 'src/composer/composer.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function loadPanes() {
  const document = createDocument();
  const observers = [];
  class Observer { constructor(cb) { this.callback = cb; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  const context = {
    document,
    requestAnimationFrame: (fn) => { fn(0); return 1; },
    MutationObserver: Observer,
    console,
  };
  const plain = panesSource.replace(/\bexport\s+/g, '');
  const mod = vm.runInNewContext(`${plain}\n;({markPaneRooms, roomOfSession, paneSessionKey})`, context);
  return {document, mod, observers};
}

function makePane(document, {sessionKey = '', ownerKey = null, classes = []} = {}) {
  const pane = document.createElement('openclaw-chat-pane');
  pane.className = ['chat-pane-cache__pane', 'chat-pane-cache__pane--visible', ...classes].join(' ');
  if (sessionKey) pane.sessionKey = sessionKey;
  if (ownerKey) pane.dataset.mcpAppOwnerKey = JSON.stringify(['owner', ownerKey]);
  const chat = document.createElement('div');
  chat.className = 'chat';
  const inner = document.createElement('div');
  inner.className = 'chat-thread-inner';
  chat.append(inner);
  pane.append(chat);
  document.body.append(pane);
  return {pane, chat, inner};
}

test('each pane is stamped with the room of its own session, independently of the page', () => {
  const {document, mod} = loadPanes();
  document.documentElement.dataset.cleRoom = 'learning';   // sidebar says learning
  const left = makePane(document, {sessionKey: 'agent:project:abc'});
  const right = makePane(document, {sessionKey: 'agent:learning:xyz'});

  mod.markPaneRooms();
  assert.equal(left.pane.dataset.clePaneRoom, 'project', 'the project pane is not relabelled by the page room');
  assert.equal(right.pane.dataset.clePaneRoom, 'learning');

  // focus moves; the page room changes to project — the learning pane must keep its own mark
  document.documentElement.dataset.cleRoom = 'project';
  mod.markPaneRooms();
  assert.equal(right.pane.dataset.clePaneRoom, 'learning', 'a page-room change does not rewrite a pane');
  assert.equal(left.pane.dataset.clePaneRoom, 'project');
});

test('a pane with no recognised session is left unmarked instead of inheriting a page room', () => {
  const {document, mod} = loadPanes();
  document.documentElement.dataset.cleRoom = 'learning';
  const pending = makePane(document, {});
  mod.markPaneRooms();
  assert.equal('clePaneRoom' in pending.pane.dataset, false, 'unbound panes carry no room');
});

test('the owner key and an inner pane are both accepted as the session source', () => {
  const {document, mod} = loadPanes();
  const viaOwner = makePane(document, {ownerKey: 'agent:thinking:one'});
  const host = makePane(document, {});
  const inner = document.createElement('openclaw-chat-pane');
  inner.sessionKey = 'agent:unrestricted:two';
  host.pane.append(inner);

  mod.markPaneRooms();
  assert.equal(viaOwner.pane.dataset.clePaneRoom, 'thinking');
  assert.equal(host.pane.dataset.clePaneRoom, 'unrestricted');
});

test('roomOfSession maps every agent id and rejects foreign keys', () => {
  const {document: _document, mod} = loadPanes();
  const table = {
    'agent:main:a': 'chat',
    'agent:project:a': 'project',
    'agent:thinking:a': 'thinking',
    'agent:learning:a': 'learning',
    'agent:unrestricted:a': 'unrestricted',
  };
  for (const [key, room] of Object.entries(table)) assert.equal(mod.roomOfSession(key), room);
  assert.equal(mod.roomOfSession('agent:unknown:a'), '');
  assert.equal(mod.roomOfSession(''), '');
});

test('type size keys on the pane, never on the page-wide room attribute', () => {
  // no remaining rule may switch typography from html[data-cle-room]
  const offenders = statusCss
    .split('}')
    .filter((block) => /\.chat-text/.test(block) && /html\[data-cle\]\[data-cle-room/.test(block));
  assert.deepEqual(offenders, [], 'typography must not read the page room');
  assert.match(statusCss, /\.chat-pane-cache__pane\[data-cle-pane-room="learning"\] \.chat-group\.assistant \.chat-text\s*\{[^}]*16\.5px/);
  assert.match(statusCss, /\.chat-pane-cache__pane\[data-cle-pane-room="learning"\] \.chat-group\.assistant \.chat-text\s*\{\s*font-size:\s*16px/,
    'the narrow-pane learning step is also pane-scoped');
});

test('container queries only address elements inside the container', () => {
  // Pull out each @container block and reject a subject that is the container's ancestor.
  const blocks = [...statusCss.matchAll(/@container cle-pane[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 1, 'the transcript has a container block');
  for (const block of blocks) {
    const subjects = [...block.matchAll(/(^|\n)\s*([^{}\n]+)\{/g)].map((m) => m[2].trim());
    for (const subject of subjects) {
      assert.ok(!/^html\[data-cle\]\s*\{\s*--/.test(subject),
        `"${subject}" targets the container's ancestor and would never apply`);
      if (/^html\[data-cle\]/.test(subject)) {
        assert.ok(/\.(chat|chat-thread-inner|chat-group|chat-pane-cache__pane|agent-chat__composer-shell|cle-composer)/.test(subject),
          `"${subject}" must target a descendant of the pane`);
      }
    }
  }
  // the gutter is what caused the split pane to run border-to-border: it must be set inside
  assert.match(statusCss, /@container cle-pane[^{]*\{[\s\S]*?html\[data-cle\] \.chat \{ --cle-read-gutter: 16px; \}/);
});

test('a narrow pane keeps a side margin on both the thread and the composer', () => {
  const block = statusCss.match(/@container cle-pane \(max-width: 720px\) \{([\s\S]*?)\n\}/)[1];
  // the thread is inset by the gutter...
  assert.match(block, /\.chat-thread-inner\s*\{[^}]*padding-inline:\s*var\(--cle-read-gutter\)/);
  assert.match(block, /\.chat-thread-inner\s*\{[^}]*box-sizing:\s*border-box/);
  // ...and the composer is inset by the same amount, so the two stay on one axis
  assert.match(block, /\.agent-chat__composer-shell,\s*\n?\s*html\[data-cle\] \.chat-footer[^{]*\{[^}]*width:\s*calc\(100% - 2 \* var\(--cle-read-gutter\)\)/);
  // and neither collapses to the pane edge
  assert.ok(!/\.chat-thread-inner\s*\{[^}]*padding-inline:\s*0/.test(block), 'the thread must not lose its inset');
});

test('the composer grid gives the lead a flexible track instead of an auto column', () => {
  const rule = composerCss.match(/\.cle-composer \.agent-chat__input \{([\s\S]*?)\n\}/)[1];
  assert.match(rule, /grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.ok(!/grid-template-columns:\s*auto minmax/.test(rule), 'an auto first column sized by max-content caused the 359px lead');
  // row 1 spans both tracks so the model controls in row 2 cannot size the text row
  assert.match(rule, /grid-template-areas:\s*"words words"\s*"tools utils"/);
  assert.match(composerCss, /\.agent-chat__composer-lead \{[^}]*grid-area:\s*tools/);
  // the send cluster shares row 1 and is pinned to the end
  assert.match(composerCss, /\.agent-chat__composer-actions \{[^}]*grid-area:\s*words[^}]*justify-self:\s*end/);
  // the text reserves the cluster's width instead of a column defined by another row
  assert.match(composerCss, /\.agent-chat__composer-input-row \{[^}]*padding:\s*13px 92px 13px 20px/);
});

test('the permission trigger is sized as a coin, not stretched by its display:contents host', () => {
  // <wa-dropdown> is display:contents, so the trigger's native width:100% resolves against the
  // whole lead (532px measured live). The trigger itself must be constrained.
  const rule = composerCss.match(/\.agent-chat__composer-lead \.chat-controls__permission-trigger \{([\s\S]*?)\n\}/)[1];
  assert.match(rule, /width:\s*var\(--chat-composer-control-size[^)]*\)[^;]*!important/);
  assert.match(rule, /min-width:\s*var\(--chat-composer-control-size/);
  assert.match(rule, /max-width:\s*var\(--chat-composer-control-size/);
  assert.match(rule, /flex:\s*0 0 auto/);
});

test('the narrow-pane block addresses declared areas instead of a four-column index', () => {
  const block = composerCss.match(/@container cle-pane \(max-width: 720px\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(!/grid-area:\s*\d+\s*\/\s*\d+\s*\/\s*\d+\s*\/\s*\d+/.test(block),
    'numeric grid-area indices reference tracks the template does not have and create implicit ones');
  assert.match(block, /grid-template-areas:\s*"words actions"\s*"tools tools"\s*"utils utils"/);
  assert.match(block, /agent-chat__composer-lead \{ grid-area: tools;/);
  assert.match(block, /agent-chat__composer-controls \{ grid-area: utils;/);
});

test('the native mobile-toolbar sizing is overridden where it would pin the lead', () => {
  assert.match(composerCss, /agent-chat__input--mobile-toolbar \.agent-chat__composer-footer \{ display: contents !important; \}/);
  assert.match(composerCss, /agent-chat__input--mobile-toolbar \.agent-chat__composer-lead \{ flex: 1 1 auto !important; order: 0 !important; \}/);
});

test('folding is occupancy-driven, with the narrow-pane rule only as a first-paint floor', () => {
  assert.match(composerCss, /\.cle-composer\.is-crowded \.agent-chat__composer-lead > \[data-cle-priority="low"\] \{ display: none !important; \}/);
  const narrow = composerCss.match(/@container cle-pane \(max-width: 620px\) \{([\s\S]*?)\n\}/)[1];
  assert.match(narrow, /has-low-tools \.cle-tools-more \{ display: inline-grid; \}/);
});
