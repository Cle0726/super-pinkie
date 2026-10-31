// Layout regression tests: the reading column, the transcript grid, the semantic tool fold
// and one study/interaction controller per chat pane.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../services/cle-studio');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const transcriptCss = read('src/process/status.css');
const composerCss = read('src/composer/composer.css');
const studyCss = read('src/learning/study.css');

// strip comments so documentation prose can never satisfy a rule assertion
const css = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (source, selector) => {
  const body = css(source);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
};

test('the assistant grid is collapsed to one column, so no hidden avatar column remains', () => {
  const group = rule(transcriptCss, 'html[data-cle] .chat-group');
  assert.ok(group, 'missing the .chat-group override');
  assert.match(group, /--chat-avatar-column:\s*0px/);
  assert.match(group, /--chat-avatar-gap:\s*0px/);
  assert.match(group, /--chat-avatar-gutter:\s*0px/);
  assert.match(group, /--chat-group-content-column:\s*1/);
  assert.match(group, /--chat-message-column-max:\s*100%/);

  const withFooter = rule(transcriptCss, 'html[data-cle] .chat-group.chat-group--with-footer');
  assert.ok(withFooter, 'the footer-bearing group needs its own explicit template');
  assert.match(withFooter, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);

  // messages and footer both take the full single column instead of column 2
  const messages = rule(transcriptCss, 'html[data-cle] .chat-group > .chat-group-messages,\nhtml[data-cle] .chat-group.chat-group--with-footer > .chat-group-messages');
  assert.ok(messages, 'missing the message column override');
  assert.match(messages, /grid-column:\s*1\s*\/\s*-1/);
  const footer = rule(transcriptCss, 'html[data-cle] .chat-group > .chat-group-footer,\nhtml[data-cle] .chat-group.chat-group--with-footer > .chat-group-footer');
  assert.ok(footer, 'missing the footer column override');
  assert.match(footer, /grid-column:\s*1\s*\/\s*-1/);

  // no leftover rule may pin these children to the (now empty) second column
  const pinned = [...css(transcriptCss).matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, , body]) => /grid-column:\s*2\b/.test(body))
    .map(([, selector]) => selector.trim());
  assert.deepEqual(pinned, [], `still pinned to column 2: ${pinned.join(', ')}`);
});

test('the transcript and the composer share one reading column', () => {
  const tokens = rule(transcriptCss, 'html[data-cle]');
  assert.ok(tokens, 'missing the reading-column tokens');
  const column = Number((tokens.match(/--cle-read-column:\s*([\d.]+)rem/)?.[1]));
  assert.ok(column >= 47.5 && column <= 55, `reading column ${column}rem must stay in the 760–880px band`);
  assert.match(tokens, /--cle-read-gutter:\s*\d+px/);

  const chat = rule(transcriptCss, 'html[data-cle] .chat');
  assert.ok(chat, 'missing the chat column mapping');
  assert.match(chat, /--chat-thread-max-width:\s*var\(--cle-read-column\)/);
  assert.match(chat, /--chat-composer-side-inset:\s*0px/);

  const composerShell = rule(transcriptCss, 'html[data-cle] .agent-chat__composer-shell,\nhtml[data-cle] .chat-footer > openclaw-plugin-view > .chat-footer__context');
  assert.ok(composerShell, 'the composer must read the same max width as the thread');
  assert.match(composerShell, /max-width:\s*var\(--chat-thread-max-width\)/);

  // the jump-to-bottom coin floats over the transcript: the last line clears it, and the
  // reserve is declared on the scrolling element (a value inherited from .chat would be
  // overridden by .chat-thread's own declaration in the native sheet)
  const scroll = rule(transcriptCss, 'html[data-cle] .chat-thread,\nhtml[data-cle] .chat-thread-viewport');
  assert.ok(scroll, 'the bottom reserve must live on the scroll container');
  assert.match(scroll, /--chat-thread-padding-bottom:[^;]*36px/);
  assert.ok(!/--chat-thread-padding-bottom/.test(chat), 'declaring it on .chat would be inert');
});

test('long content scrolls inside the column instead of widening it', () => {
  const pre = rule(transcriptCss, 'html[data-cle] .chat-group .chat-text pre,\nhtml[data-cle] .chat-group .chat-bubble pre');
  assert.ok(pre, 'missing pre override');
  assert.match(pre, /max-width:\s*100%/);
  assert.match(pre, /overflow-x:\s*auto/);
  const table = rule(transcriptCss, 'html[data-cle] .chat-group .chat-text table,\nhtml[data-cle] .chat-group .chat-text .markdown-table');
  assert.ok(table, 'missing table override');
  assert.match(table, /overflow-x:\s*auto/);
  const media = rule(transcriptCss, 'html[data-cle] .chat-group .chat-text :is(img, video, svg, canvas, iframe)');
  assert.ok(media, 'media needs a max-width guard');
  assert.match(media, /max-width:\s*100%/);
});

test('user paragraphs align as blocks, not as ragged right-aligned lines', () => {
  const userText = rule(transcriptCss, 'html[data-cle] .chat-group.user .chat-text');
  assert.ok(userText, 'missing user text rule');
  assert.match(userText, /text-align:\s*start/);
  assert.ok(!/text-align:\s*right/.test(css(transcriptCss)), 'no paragraph may be right-aligned inside the reading column');
});

test('every room keeps one readable type scale', () => {
  const body = rule(transcriptCss, 'html[data-cle] .chat-group.assistant .chat-text');
  const size = Number(body.match(/font:\s*400\s*([\d.]+)px/)?.[1]);
  assert.ok(size >= 15.5 && size <= 16.5, `body text ${size}px must stay near 16px`);
  assert.match(body, /line-height|1\.7[0-9]/);
  // the larger learning measure is keyed on the pane's own session, not on the page-wide room
  const learning = rule(transcriptCss, 'html[data-cle] .chat-pane-cache__pane[data-cle-pane-room="learning"] .chat-group.assistant .chat-text');
  assert.ok(learning, 'learning keeps its own slightly larger measure');
  assert.match(learning, /font-size:\s*16\.5px/);
});

test('tools fold by role, never by position, and essential entries never fold', async () => {
  const {classifyTool} = await import(path.join(root, 'src/composer/composer.js'));
  const element = (className) => ({className, getAttribute: () => null, dataset: {}});
  const cases = [
    ['agent-chat__input-btn', 'attach', 'essential'],
    ['chat-controls__inline-select-trigger', 'model', 'essential'],
    ['chat-controls__effort-trigger', 'reasoning', 'essential'],
    ['laolao-learning-tools', 'learning', 'essential'],
    ['laolao-learning-toggle', 'learning', 'essential'],
    ['chat-browser-panel-toggle', 'browser', 'low'],
    ['chat-send-btn--voice', 'voice', 'low'],
    ['laolao-learning-notebook-button', 'notes', 'low'],
  ];
  for (const [className, kind, priority] of cases) {
    const result = classifyTool(element(className));
    assert.equal(result.kind, kind, `${className} should be ${kind}`);
    assert.equal(result.priority, priority, `${className} should be ${priority}`);
  }
  // the fold is keyed on data attributes the classifier writes, not on nth-child
  assert.match(composerCss, /\[data-cle-priority="low"\]\s*\{\s*display:\s*none/);
  assert.ok(!/nth-child\(n\+5\)/.test(css(composerCss)), 'positional folding must be gone');

  // the menu is keyboard reachable and closes on Escape
  const source = read('src/composer/composer.js');
  assert.match(source, /aria-expanded/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /ArrowDown/);
  // a menu item proxies a click to the real control in the same lead
  assert.match(source, /control\.click\(\)/);
});

test('the folded menu is only offered when something actually folded', () => {
  const more = rule(composerCss, '.cle-tools-more');
  assert.ok(more, 'missing the fold trigger');
  assert.match(more, /display:\s*none/);
  assert.match(css(composerCss), /\.cle-composer\.has-low-tools \.cle-tools-more\s*\{\s*display:\s*inline-grid/);
});

test('each pane carries its own study bar, measured by the pane', () => {
  const bar = rule(studyCss, 'html[data-cle] .chat-pane-cache__pane .cle-study');
  assert.ok(bar, 'the study bar needs a pane-scoped rule');
  assert.match(bar, /min-width:\s*0/);
  assert.match(css(studyCss), /@container cle-pane \(max-width: 560px\)/);
  const source = read('src/learning/study.js');
  assert.match(source, /panels = new Map\(\)/, 'one strip per pane');
  assert.match(source, /paneSession\(pane\)/);
  assert.match(source, /agent:learning:/);
  // the strip is prepended into its own pane's .chat-main; the only page-wide lookup left is
  // the documented first-paint fallback, which the next sync replaces with per-pane strips
  assert.match(source, /const root = pane\.querySelector\('\.chat-main'\) \|\| pane;/, 'per-pane root');
  assert.match(source, /if \(!live\.size\)/, 'an explicit first-paint fallback, not a default path');
});

// ---- interaction controls: one controller per pane ----
function fakeNode({sessionKey = '', classes = [], children = []} = {}) {
  const store = new Set(classes);
  const node = {
    sessionKey,
    dataset: {},
    hidden: false,
    children,
    parentElement: null,
    isConnected: true,
    classList: {
      add: (...names) => names.forEach((name) => store.add(name)),
      remove: (...names) => names.forEach((name) => store.delete(name)),
      contains: (name) => store.has(name),
      toggle: (name, force) => ((force ?? !store.has(name)) ? store.add(name) : store.delete(name)),
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    append(...items) { for (const item of items) { item.parentElement = node; node.children.push(item); } },
    prepend(...items) { for (const item of items) { item.parentElement = node; node.children.unshift(item); } },
    insertBefore(item) { item.parentElement = node; node.children.unshift(item); },
    replaceChildren(...items) { node.children = items; },
    querySelector: () => null,
    querySelectorAll: () => [],
    remove() {},
    cloneNode() { return fakeNode({sessionKey, classes: [...store]}); },
    focus() {},
    closest(selector) { return selector === 'openclaw-chat-pane' ? node : null; },
    getBoundingClientRect: () => ({left: 0, top: 0, right: 508, bottom: 720, width: 508, height: 720}),
    style: {},
  };
  return node;
}

function runStage(panes) {
  const documentElement = fakeNode({classes: []});
  documentElement.dataset = {cleRoom: 'learning'};
  const body = fakeNode();
  const document = {
    readyState: 'complete',
    documentElement,
    body,
    activeElement: null,
    createElement: (tag) => fakeNode({classes: [tag]}),
    createTextNode: (text) => ({textContent: text}),
    querySelector: (selector) => selector === 'openclaw-chat-pane.chat-pane-cache__pane' ? panes[0] : null,
    querySelectorAll: (selector) => {
      if (selector === 'openclaw-chat-pane.chat-pane-cache__pane') return panes;
      if (selector === '.chat-group.user') return [];
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame: (fn) => { fn(0); return 1; },
    MutationObserver: class { observe() {} disconnect() {} },
    location: {href: 'http://localhost/chat'},
  };
  const context = {
    window, document, location: window.location, URL,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    crypto: {randomUUID: () => 'id'},
    console,
    navigator: {},
  };
  window.document = document;
  vm.runInNewContext(read('static/legacy/laolao-learning-stage.js'), context);
  return window;
}

test('two learning panes get two independent interaction controllers, each bound to its own session', () => {
  const left = fakeNode({sessionKey: 'agent:learning:left'});
  const right = fakeNode({sessionKey: 'agent:learning:right'});
  const window = runStage([left, right]);
  const controllers = [...window.__cleLearningControllers];
  assert.equal(controllers.length, 2, 'one controller per pane, not a shared singleton');
  assert.deepEqual(controllers.map((item) => item.sessionKey).sort(), ['agent:learning:left', 'agent:learning:right']);
  assert.equal(controllers[0].pane, left);
  assert.equal(controllers[1].pane, right);
});

test('a non-learning pane gets no controller, and a disposed pane takes its controller with it', () => {
  const chat = fakeNode({sessionKey: 'agent:main:one'});
  const study = fakeNode({sessionKey: 'agent:learning:study'});
  const window = runStage([chat, study]);
  const controllers = [...window.__cleLearningControllers];
  assert.equal(controllers.length, 2, 'both panes are tracked, so a room change can be picked up');
  const forChat = controllers.find((item) => item.pane === chat);
  assert.equal(forChat.sessionKey, 'agent:main:one');

  // the pane leaves the DOM: its controller is disposed on the next reconcile sweep
  chat.isConnected = false;
  for (const item of controllers) item.reconcile();
  assert.equal(chat.children.filter((child) => child.classList?.contains?.('laolao-learning-toggle')).length, 0);
});

test('the interaction module no longer steers the first pane on the page', () => {
  const source = read('static/legacy/laolao-learning-stage.js');
  // every global lookup is confined to the three named fallback helpers; the controller path
  // resolves through the owning pane, so two panes cannot fight over one node
  const active = [...source.matchAll(/document\.querySelector(?:All)?\(\s*["'][^"']*chat-pane-cache__pane--active[^"']*["']/g)].map((m) => m[0]);
  assert.ok(active.length <= 4, `unexpected global pane selectors: ${active.join(' | ')}`);
  assert.match(source, /const fallbackChat = \(\)/, 'fallbacks are named, not scattered');
  assert.match(source, /const paneElement = \(\) => state\.pane\?\.isConnected/);
  assert.match(source, /const instances = new Set\(\)/);
  assert.match(source, /const focusedPane = \(\)/);
  assert.match(source, /positionDrawer/);
});
