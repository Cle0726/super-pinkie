/**
 * Brand guard: the native app rewrites the document title and the sidebar labels *after* the
 * plugin loads, so a one-shot pass is not enough.
 *
 * These tests run the real module against a small DOM that mirrors what the 2026.10 Control UI
 * actually renders:
 *
 *   <title>Main Session — OpenClaw</title>            (router, on every navigation)
 *   <title>… · Production</title>                     (environment suffix, appended)
 *   <button aria-label="OpenClaw · 工作区菜单">        (workspace header)
 *     <span class="sidebar-agent-card__name-text hover-marquee">
 *       <span class="hover-marquee__text">OpenClaw</span>
 *
 * The point is immediacy (a write must be corrected within the same batch, not on an idle
 * timeout), teardown (nothing keeps observing after the signal aborts) and restraint (message
 * bodies, code and user-named agents are untouched).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const MODULE = pathToFileURL(
  path.join(import.meta.dirname, '..', 'services', 'cle-studio', 'src', 'core', 'brand.js'),
).href;

/* ---------- a minimal DOM ---------- */

class Node {
  constructor(type = 1, name = '') {
    this.nodeType = type;
    this.nodeName = name;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this._text = type === 3 ? '' : null;
  }
  get nodeValue() { return this._text; }
  set nodeValue(value) {
    this._text = String(value);
    this._notify(this, 'characterData');
  }
  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    // Assigning textContent replaces the whole subtree, exactly like the real DOM — this is the
    // shape `document.title = "..."` produces.
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this._notify(this, 'childList');
    if (value !== '' && value != null) this.appendChild(new Text(String(value)));
  }
  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    this._notify(this, 'childList', [child]);
    return child;
  }
  removeAttribute(name) {
    this.attrs.delete(name);
    this._notify(this, 'attributes', [], name);
  }
  setAttribute(name, value) { this.setAttributeNS(name, String(value)); }
  setAttributeNS(name, value) {
    this.attrs.set(name, String(value));
    this._notify(this, 'attributes', [], name);
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  get isConnected() {
    // The real DOM computes this from the tree, so a freshly appended subtree is connected
    // immediately. Mirror that instead of tracking a flag.
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === globalThis.document?.documentElement;
  }
  matches(selector) { return matchSelector(this, selector); }
  closest(selector) {
    let node = this;
    while (node) { if (node.nodeType === 1 && matchSelector(node, selector)) return node; node = node.parentNode; }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    // Real DOM semantics: descendants only. callers that need the root include it explicitly.
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (matchSelector(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  _notify(target, type, added = [], attributeName = null) {
    for (const observer of observers) {
      if (!observer.active) continue;
      if (!observer.covers(target)) continue;
      if (type === 'attributes' && observer.filter && !observer.filter.includes(attributeName)) continue;
      observer.pending.push({type, target, addedNodes: added, attributeName});
    }
  }
}

class Text extends Node {
  constructor(value) {
    super(3, '#text');
    this._text = String(value);
  }
}

class Element extends Node {
  constructor(tag, attrs = {}) {
    super(1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.className = attrs.class ?? '';
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') continue;
      this.attrs.set(key, String(value));
    }
    // Real anchors expose .href as an absolute URL. The brand guard reads it, and a bare
    // attribute would make every promotion link look like a relative one.
    if (this.localName === 'a' && this.attrs.has('href')) {
      const raw = this.attrs.get('href');
      this._href = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : new URL(raw, 'https://app.local/').href;
    }
  }
  get href() { return this._href; }
  set href(value) { this._href = String(value); this.attrs.set('href', String(value)); }
  get classList() {
    return {contains: (name) => this.className.split(/\s+/).includes(name)};
  }
}

/* selector support: only what these tests need — comma lists of simple selectors with
   descendant combinators, tag / .class / [attr] / #id parts. */
function matchSelector(node, selector) {
  return selector.split(',').map((part) => part.trim()).some((part) => matchCompound(node, part));
}
function matchCompound(node, compound) {
  const parts = compound.split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (!matchSimple(node, parts[parts.length - 1])) return false;
  let index = parts.length - 2;
  let current = node.parentNode;
  while (index >= 0) {
    let found = null;
    while (current) { if (current.nodeType === 1 && matchSimple(current, parts[index])) { found = current; break; } current = current.parentNode; }
    if (!found) return false;
    current = found.parentNode;
    index -= 1;
  }
  return true;
}
function matchSimple(node, simple) {
  if (node.nodeType !== 1) return false;
  const tokens = simple.match(/^([a-zA-Z0-9-]*|\*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/);
  if (!tokens) return false;
  const [, tag, rest] = tokens;
  if (tag && tag !== '*' && node.localName !== tag.toLowerCase()) return false;
  for (const piece of rest.match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
    if (piece.startsWith('.')) {
      if (!node.className.split(/\s+/).includes(piece.slice(1))) return false;
    } else if (piece.startsWith('#')) {
      if (node.getAttribute('id') !== piece.slice(1)) return false;
    } else {
      const name = piece.slice(1, -1).split('=')[0];
      if (!node.hasAttribute(name)) return false;
    }
  }
  return true;
}

const observers = [];
class MutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.active = false;
    this.pending = [];
    this.targets = [];
    this.filter = null;
    observers.push(this);
  }
  observe(target, options = {}) {
    this.active = true;
    this.targets.push({target, options});
    if (options.attributeFilter) this.filter = options.attributeFilter;
  }
  disconnect() { this.active = false; this.pending = []; this.targets = []; }
  covers(node) {
    for (const {target, options} of this.targets) {
      let current = node;
      while (current) {
        if (current === target) {
          if (current === node) return true;
          return options.subtree === true;
        }
        current = current.parentNode;
      }
    }
    return false;
  }
  /** Deliver queued records, like the microtask checkpoint would. */
  takeRecords() { const out = this.pending; this.pending = []; return out; }
}

/* ---------- a document shaped like the native app ---------- */

function makeDocument(titleText = 'Main Session — OpenClaw') {
  const document = {
    titleListeners: [],
    createElement: (tag) => new Element(tag),
    createTextNode: (value) => new Text(value),
    querySelector: (selector) => document.documentElement.querySelector(selector),
    querySelectorAll: (selector) => document.documentElement.querySelectorAll(selector),
    createTreeWalker(root) {
      const nodes = [];
      const walk = (node) => { for (const child of node.childNodes) { if (child.nodeType === 3) nodes.push(child); walk(child); } };
      walk(root);
      let index = 0;
      return {nextNode: () => nodes[index++] ?? null};
    },
  };

  const html = new Element('html');
  html._connected = true;
  const head = new Element('head');
  const body = new Element('body');
  const title = new Element('title');
  title._connected = true;
  title.appendChild(new Text(titleText));
  head.appendChild(title);
  head._parent = html;
  html.appendChild(head);
  html.appendChild(body);
  head._connected = true;
  body._connected = true;

  document.documentElement = html;
  document.head = head;
  document.body = body;
  Object.defineProperty(document, 'title', {
    get() { return title.textContent; },
    set(value) {
      // Exactly what the browser does: replace the text node inside <title>.
      title.textContent = value;
      for (const listener of document.titleListeners) listener(value);
    },
  });
  document._titleNode = title;
  return document;
}

/** Build the workspace header exactly as control-ui-boot-shared renders it. */
function makeSidebar(document, {name = 'OpenClaw', agentName = null} = {}) {
  const header = new Element('div', {class: 'sidebar-workspace-header'});
  const button = new Element('button', {
    class: 'sidebar-workspace-header__main',
    'aria-label': `${name} · 工作区菜单`,
  });
  const mark = new Element('span', {class: 'sidebar-workspace-header__mark sidebar-workspace-header__mark--neutral'});
  const text = new Element('span', {class: 'sidebar-agent-card__text'});
  const nameWrap = new Element('span', {class: 'sidebar-agent-card__name'});
  const marquee = new Element('span', {class: 'sidebar-agent-card__name-text hover-marquee hover-marquee--loop'});
  marquee.appendChild(new Text(name));
  const chevron = new Element('span', {class: 'sidebar-agent-card__chevron'});
  nameWrap.appendChild(marquee);
  nameWrap.appendChild(chevron);
  text.appendChild(nameWrap);
  button.appendChild(mark);
  button.appendChild(text);
  header.appendChild(button);
  document.body.appendChild(header);

  const agentCard = new Element('div', {class: 'sidebar-agent-card'});
  const cardMain = new Element('button', {
    class: 'sidebar-agent-card__main',
    'aria-label': `${agentName ?? name} · ${agentName ? '切换智能体' : '智能体菜单'}`,
  });
  agentCard.appendChild(cardMain);
  document.body.appendChild(agentCard);
  return {header, button, marquee, agentCard, cardMain};
}

/* ---------- harness ---------- */

async function withDom(title, run) {
  const document = makeDocument(title);
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    NodeFilter: globalThis.NodeFilter,
    MutationObserver: globalThis.MutationObserver,
  };
  globalThis.document = document;
  globalThis.NodeFilter = {SHOW_TEXT: 4};
  globalThis.MutationObserver = MutationObserver;
  globalThis.window = globalThis;
  observers.length = 0;
  // requestIdleCallback is deliberately absent: the guard must not depend on idle time, so the
  // setTimeout fallback is what runs here. Tests advance it explicitly via flushIdle().
  globalThis.requestIdleCallback = undefined;
  try {
    return await run(document);
  } finally {
    for (const observer of observers) observer.disconnect();
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.NodeFilter = previous.NodeFilter;
    globalThis.MutationObserver = previous.MutationObserver;
  }
}

/** Deliver pending records to observers and run any scheduled flush synchronously. */
async function deliver(flushes) {
  // the guard schedules on a microtask; let anything already queued run first
  await Promise.resolve();
  let delivered = true;
  while (delivered) {
    delivered = false;
    for (const observer of observers) {
      if (!observer.active) continue;
      const records = observer.takeRecords();
      if (!records.length) continue;
      delivered = true;
      observer.callback(records, observer);
    }
  }
  await Promise.resolve();
  await Promise.resolve();
  await flushes.run();
  await Promise.resolve();
}

function makeFlusher() {
  const queue = [];
  return {
    install() {
      globalThis.setTimeout = (fn) => { queue.push(fn); return queue.length; };
      globalThis.requestIdleCallback = (fn) => { queue.push(fn); return queue.length; };
    },
    async run() {
      // Drain in insertion order; flushes may schedule nothing further.
      while (queue.length) {
        const fn = queue.shift();
        await fn({didTimeout: false, timeRemaining: () => 50});
      }
    },
  };
}

/* ---------- tests ---------- */

test('the title is rebranded the moment the router writes it, without an idle wait', async () => {
  const brand = await import(MODULE);
  assert.equal(brand.localTitle('Main Session — OpenClaw'), 'Main Session — C.le.');
  assert.equal(brand.localTitle('OpenClaw'), 'C.le.');
  assert.equal(brand.localTitle('(2) Chat — OpenClaw'), '(2) Chat — C.le.');
  // the environment suffix the router appends after the fact
  assert.equal(brand.localTitle('Main Session — OpenClaw · Production'), 'Main Session — C.le. · Production');
  assert.equal(brand.localTitle('C.le.'), 'C.le.');
});

test('a title written after activation is corrected on the next microtask batch', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();
    assert.equal(document.title, 'Main Session — C.le.', 'a clean title is left alone');

    // the router assigns on a navigation — this is the "Main Session — OpenClaw" regress
    document.title = 'Main Session — OpenClaw';
    await deliver(flusher);
    assert.equal(document.title, 'Main Session — C.le.', 'corrected in the same batch, not on idle');
    stop?.();
  });
});

test('the environment suffix appended to the title is corrected too', async () => {
  await withDom('Chat — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();

    // applyControlUiPresentation() appends " · <label>" to whatever the title is
    document.title = `${document.title} · Production`;
    await deliver(flusher);
    assert.equal(document.title, 'Chat — C.le. · Production', 'the suffix survives, the wordmark does not');

    // and a later navigation resets it to the upstream form again
    document.title = 'Main Session — OpenClaw · Production';
    await deliver(flusher);
    assert.equal(document.title, 'Main Session — C.le. · Production');
    stop?.();
  });
});

test('a title changed before the plugin loads is corrected at start', async () => {
  await withDom('Learning — OpenClaw', async (document) => {
    const brand = await import(MODULE);
    brand.startBrandGuard();
    assert.equal(document.title, 'Learning — C.le.', 'synchronous pass on activate');
  });
});

test('the workspace header label and the marquee name are both rebranded', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const {button, marquee, cardMain} = makeSidebar(document, {name: 'OpenClaw'});
    const stop = brand.startBrandGuard();

    assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单');
    assert.equal(marquee.textContent, 'C.le.');
    assert.equal(cardMain.getAttribute('aria-label'), 'C.le. · 智能体菜单');
    stop?.();
  });
});

test('a sidebar rendered after activation is caught, and its label keeps its purpose', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();

    const {button, marquee} = makeSidebar(document, {name: 'OpenClaw'});
    assert.equal(button.getAttribute('aria-label'), 'OpenClaw · 工作区菜单', 'not touched before the batch');
    await deliver(flusher);
    assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单', 'menu purpose survives');
    assert.equal(marquee.textContent, 'C.le.');
    stop?.();
  });
});

test('only the leading product name is replaced in a label', async () => {
  const brand = await import(MODULE);
  assert.equal(brand.localLabel('OpenClaw · 工作区菜单'), 'C.le. · 工作区菜单');
  assert.equal(brand.localLabel('OpenClaw · 智能体菜单'), 'C.le. · 智能体菜单');
  assert.equal(brand.localLabel('OpenClaw'), 'C.le.');
  // a user-named agent that merely starts with the word must be left alone
  assert.equal(brand.localLabel('OpenClaw Notes · 工作区菜单'), 'OpenClaw Notes · 工作区菜单');
  assert.equal(brand.localLabel('My OpenClaw · 工作区菜单'), 'My OpenClaw · 工作区菜单');
  assert.equal(brand.localLabel('碧琪 · 工作区菜单'), '碧琪 · 工作区菜单');
});

test('a user-chosen agent name is never rewritten, only the upstream fallback', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    // an agent genuinely named "OpenClaw Notes" is a user choice: leave it
    const user = makeSidebar(document, {name: 'OpenClaw Notes'});
    const stop = brand.startBrandGuard();
    assert.equal(user.button.getAttribute('aria-label'), 'OpenClaw Notes · 工作区菜单');
    await deliver(flusher);
    assert.equal(user.button.getAttribute('aria-label'), 'OpenClaw Notes · 工作区菜单', 'user name preserved');
    assert.equal(user.marquee.textContent, 'OpenClaw Notes');
    stop?.();
  });
});

test('message bodies, code and documents are never rewritten', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();

    const chat = new Element('div', {class: 'chat-group'});
    const bubble = new Element('div', {class: 'chat-text'});
    bubble.appendChild(new Text('OpenClaw is the upstream project name in this message.'));
    chat.appendChild(bubble);
    const code = new Element('pre');
    code.appendChild(new Text('const name = "OpenClaw";'));
    document.body.appendChild(chat);
    document.body.appendChild(code);

    const stop = brand.startBrandGuard();
    await deliver(flusher);
    assert.equal(bubble.textContent, 'OpenClaw is the upstream project name in this message.', 'user message intact');
    assert.equal(code.textContent, 'const name = "OpenClaw";', 'code intact');
    stop?.();
  });
});

test('the guard stops observing once the plugin unloads', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const controller = new AbortController();
    brand.startBrandGuard(controller.signal);
    assert.ok(observers.some((observer) => observer.active), 'watching while active');

    controller.abort();
    assert.equal(observers.every((observer) => !observer.active), true, 'every observer disconnected');

    // a late write is no longer corrected, which proves nothing is still running
    document.title = 'Main Session — OpenClaw';
    await deliver(flusher);
    assert.equal(document.title, 'Main Session — OpenClaw');
  });
});

test('an aborted guard drops queued work instead of sweeping a dead document', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const controller = new AbortController();
    brand.startBrandGuard(controller.signal);

    makeSidebar(document, {name: 'OpenClaw'});
    controller.abort();
    // the queued idle callback still fires; it must be a no-op
    await flusher.run();
    assert.equal(document.title, 'Main Session — C.le.');
  });
});

test('the guard does not scan the whole body on every mutation batch', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();

    // Count every querySelectorAll reachable from the <body> element itself. A batch that walks
    // the document for chrome labels would show up here; walking only the added node does not.
    let bodyWalks = 0;
    const original = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function patched(selector) {
      if (this === document.body) bodyWalks += 1;
      return original.call(this, selector);
    };
    try {
      const added = new Element('div', {class: 'unrelated'});
      added.appendChild(new Text('hello'));
      document.body.appendChild(added);
      await deliver(flusher);
    } finally {
      Element.prototype.querySelectorAll = original;
    }

    assert.equal(bodyWalks, 0, 'an unrelated node triggers no walk from <body>');
    stop?.();
  });
});

test('a batch only re-reads the chrome block it belongs to', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();

    const scopes = [];
    const original = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function patched(selector) {
      if (String(selector) === '[aria-label]') scopes.push(this.className);
      return original.call(this, selector);
    };
    try {
      const {header} = makeSidebar(document, {name: 'OpenClaw'});
      header._connected = true;
      await deliver(flusher);
    } finally {
      Element.prototype.querySelectorAll = original;
    }

    assert.ok(scopes.length > 0, 'the batch did read a chrome label scope');
    assert.equal(
      scopes.every((name) => /sidebar-(workspace-header|agent-card)/.test(name)),
      true,
      `only sidebar blocks are read, got: ${scopes.join(' | ')}`,
    );
    stop?.();
  });
});

test('repeated title writes converge and never grow the wordmark', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();

    for (let i = 0; i < 5; i += 1) {
      document.title = 'Main Session — OpenClaw';
      await deliver(flusher);
      assert.equal(document.title, 'Main Session — C.le.', `pass ${i + 1}`);
    }
    assert.doesNotMatch(document.title, /OpenClaw/u);
    stop?.();
  });
});

test('promotion links are matched by full host, so unrelated hosts are left alone', async () => {
  await withDom('Main Session — C.le.', async () => {
    const brand = await import(MODULE);
    // The regex is not exported, so assert through the observable behaviour: build links, run the
    // initial pass, and check which ones survived.
    const links = {
      'https://docs.openclaw.ai/web/control-ui': 'hide',
      'https://openclaw.ai/': 'hide',
      'https://github.com/openclaw/openclaw': 'hide',
      'https://discord.gg/openclaw': 'hide',
      // near-misses that must keep working
      'https://openclaw.ai.example.com/docs': 'keep',
      'https://github.com/openclaw-fork/other': 'keep',
      'https://example.com/guide': 'keep',
      'https://developer.mozilla.org/en-US/docs/Web/API': 'keep',
      'https://notopenclaw.ai/': 'keep',
    };
    const nodes = new Map();
    for (const [href] of Object.entries(links)) {
      const a = new Element('a', {href});
      document.body.appendChild(a);
      nodes.set(href, a);
    }
    brand.startBrandGuard();
    for (const [href, want] of Object.entries(links)) {
      const anchor = nodes.get(href);
      const hidden = anchor.hasAttribute('href') === false;
      assert.equal(hidden, want === 'hide', `${href} should ${want === 'hide' ? 'be hidden' : 'survive'}`);
    }
  });
});

test('a link inside protected content is never touched', async () => {
  await withDom('Main Session — C.le.', async () => {
    const brand = await import(MODULE);
    const chat = new Element('div', {class: 'chat-group'});
    const anchor = new Element('a', {href: 'https://docs.openclaw.ai/web'});
    anchor.appendChild(new Text('docs'));
    chat.appendChild(anchor);
    document.body.appendChild(chat);
    brand.startBrandGuard();
    assert.equal(anchor.hasAttribute('href'), true, 'a link the user sent keeps its href');
  });
});

test('an aria-label-only change is corrected, with no other DOM mutation', async () => {
  // The reported gap: the attributes branch set a dirty flag but never queued the target, and
  // flush only walks queued nodes — so a label restored by the native app on its own stayed
  // upstream forever. This case changes *only* the attribute, nothing else.
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const {button} = makeSidebar(document, {name: 'OpenClaw'});
    const stop = brand.startBrandGuard();
    assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单');

    // the native app re-renders the label on a session switch: attribute write only
    button.setAttribute('aria-label', 'OpenClaw · 工作区菜单');
    // peek without draining — taking the records here would hand them to nobody
    const pending = observers.flatMap((observer) => observer.pending);
    assert.ok(pending.length > 0, 'the attribute change produced a record');
    assert.equal(pending.every((record) => record.type === 'attributes'), true, 'and nothing else');

    await deliver(flusher);
    assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单', 'label fixed from the attribute record');
    stop?.();
  });
});

test('an attribute-only change on a node that is not chrome is ignored', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();
    const plain = new Element('div', {class: 'unrelated', 'aria-label': 'OpenClaw · something'});
    document.body.appendChild(plain);
    await deliver(flusher);
    // not a sidebar block, so the label is left as the app wrote it
    assert.equal(plain.getAttribute('aria-label'), 'OpenClaw · something');
    stop?.();
  });
});

test('a label that is already correct is not rewritten again', async () => {
  await withDom('Main Session — C.le.', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const {button} = makeSidebar(document, {name: 'C.le.'});
    const stop = brand.startBrandGuard();
    button.setAttribute('aria-label', 'C.le. · 工作区菜单');
    await deliver(flusher);
    assert.equal(button.getAttribute('aria-label'), 'C.le. · 工作区菜单');
    stop?.();
  });
});

test('the title rewrite leaves the session context alone and only moves the brand tail', async () => {
  // Reported example: a session the user named after the upstream project must keep its name.
  const brand = await import(MODULE);
  const cases = [
    // startup form: the whole title is the brand
    ['OpenClaw', 'C.le.'],
    ['OpenClaw Control', 'C.le.'],
    // native tail after the em dash
    ['Main Session — OpenClaw', 'Main Session — C.le.'],
    ['(2) Chat — OpenClaw', '(2) Chat — C.le.'],
    // environment suffix appended afterwards
    ['Main Session — OpenClaw · Production', 'Main Session — C.le. · Production'],
    ['Session — OpenClaw Control · Staging', 'Session — C.le. · Staging'],
    // the reported failure: the *user's* word must survive
    ['关于OpenClaw的笔记 — OpenClaw', '关于OpenClaw的笔记 — C.le.'],
    ['关于OpenClaw的笔记', '关于OpenClaw的笔记'],
    // a context that itself contains the middot separator
    ['Meeting · Q3 — OpenClaw', 'Meeting · Q3 — C.le.'],
    ['Meeting · Q3 — OpenClaw · Production', 'Meeting · Q3 — C.le. · Production'],
    ['关于OpenClaw · 笔记 — OpenClaw', '关于OpenClaw · 笔记 — C.le.'],
    // already-localised titles are stable
    ['C.le.', 'C.le.'],
    ['Main Session — C.le. · Production', 'Main Session — C.le. · Production'],
  ];
  for (const [input, want] of cases) {
    assert.equal(brand.localTitle(input), want, `localTitle(${JSON.stringify(input)})`);
  }
  // and it is idempotent
  for (const [, want] of cases) assert.equal(brand.localTitle(want), want);
});

test('a live session named after the upstream project keeps its name while the tail is rebranded', async () => {
  await withDom('关于OpenClaw的笔记 — OpenClaw', async (document) => {
    const brand = await import(MODULE);
    const flusher = makeFlusher();
    flusher.install();
    const stop = brand.startBrandGuard();
    assert.equal(document.title, '关于OpenClaw的笔记 — C.le.', 'context preserved on activation');

    document.title = '关于OpenClaw的笔记 — OpenClaw';
    await deliver(flusher);
    assert.equal(document.title, '关于OpenClaw的笔记 — C.le.', 'context preserved on the rewrite too');
    stop?.();
  });
});
