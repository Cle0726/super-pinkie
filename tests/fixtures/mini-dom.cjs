// A minimal DOM good enough to mount the learning controls twice and click them:
// elements, classes, datasets, a small selector engine (tag / .class / tag.class and
// descendant chains), events, and geometry. No layout, no CSS.
function parseCompound(text) {
  const trimmed = text.trim();
  const tagMatch = trimmed.match(/^([a-zA-Z][\w-]*|\*)?/);
  const tag = tagMatch?.[1] && tagMatch[1] !== '*' ? tagMatch[1].toLowerCase() : null;
  const rest = trimmed.slice(tagMatch?.[0]?.length || 0);
  const classes = [];
  const ids = [];
  const attrs = [];
  const tokenPattern = /([.#][\w-]+)|\[([\w-]+)(?:=(["']?)([^\]"']*)\3)?\]/g;
  let consumed = 0;
  let match;
  while ((match = tokenPattern.exec(rest))) {
    if (match.index !== consumed) throw new Error(`unsupported selector part: ${text}`);
    consumed = match.index + match[0].length;
    if (match[1]) {
      if (match[1][0] === '.') classes.push(match[1].slice(1));
      else ids.push(match[1].slice(1));
    } else {
      attrs.push({name: match[2], value: match[4]});
    }
  }
  if (consumed !== rest.length) throw new Error(`unsupported selector part: ${text}`);
  return {tag, classes, ids, attrs};
}
function matchesCompound(el, compound) {
  if (compound.tag && el.tagName !== compound.tag) return false;
  if (compound.ids.length && !compound.ids.every((id) => el.id === id)) return false;
  if (!compound.classes.every((name) => el.classList.contains(name))) return false;
  return compound.attrs.every(({name, value}) => {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!(key in el.dataset)) return false;
    } else if (!el.attributes.has(name) && el[name] === undefined) return false;
    if (value === undefined) return true;
    const actual = name.startsWith('data-')
      ? el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
      : (el.attributes.get(name) ?? el[name]);
    return String(actual) === value;
  });
}
// "a b .c" -> [[a],[b],[.c]]; evaluated right to left over ancestors.
// A leading ":scope" means "the element querySelectorAll was called on", which is the
// parent of every match, so it only ever guards the first hop.
// Split on top-level commas: ".a, .b" is a selector list, not one compound.
function splitList(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

// "a b .c" -> [[a],[b],[.c]]; evaluated right to left over ancestors.
// A leading ":scope >" means "a direct child of the element querySelectorAll was called on".
function parseSelector(selector) {
  let rest = selector.trim();
  let scoped = false;
  if (rest.startsWith(':scope')) { scoped = true; rest = rest.slice(':scope'.length).trim(); }
  let direct = false;
  if (rest.startsWith('>')) { direct = true; rest = rest.slice(1).trim(); }
  const parts = rest ? rest.split(/\s+/) : [];
  return {scoped, direct, chain: parts.map(parseCompound), source: selector};
}

let uid = 0;
class FakeElement {
  constructor(tagName, document) {
    this.tagName = String(tagName || 'div').toLowerCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.isConnected = true;
    this.listeners = new Map();
    this._uid = ++uid;
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => name && this._classes.add(name)),
      remove: (...names) => names.forEach((name) => this._classes.delete(name)),
      contains: (name) => this._classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this._classes.has(name) : Boolean(force);
        if (on) this._classes.add(name); else this._classes.delete(name);
        return on;
      },
      toString: () => [...this._classes].join(' '),
    };
  }
  get className() { return [...this._classes].join(' '); }
  set className(value) { this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean)); }
  get id() { return this.attributes.get('id') || ''; }
  set id(value) { this.attributes.set('id', String(value)); }
  setAttribute(name, value) {
    const next = String(value);
    const previous = this.attributes.has(name) ? this.attributes.get(name) : null;
    this.attributes.set(name, next);
    if (previous !== next) this._notify({type: 'attributes', target: this, attributeName: name, oldValue: previous});
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) { if (force) this.setAttribute(name, ''); else this.removeAttribute(name); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((entry) => entry !== handler));
  }
  dispatch(type, event = {}) {
    const payload = {...event, type, target: event.target || this,
      stopped: false,
      stopPropagation() { payload.propagationStopped = true; payload.stopped = true; },
      preventDefault() { payload.defaultPrevented = true; },
    };
    for (let node = this; node; node = node.parentElement) {
      for (const handler of node.listeners.get(type) || []) handler(payload);
      if (payload.propagationStopped) break;
    }
    return payload;
  }
  click() { if (!this.disabled) this.dispatch('click', {target: this}); }
  _notify(record) { this.ownerDocument?.queueRecord?.(record); }
  append(...nodes) {
    const added = [];
    for (const node of nodes) {
      if (typeof node === 'string') { this.textContent += node; continue; }
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.push(node);
      added.push(node);
    }
    if (added.length) this._notify({type: 'childList', target: this, addedNodes: added, removedNodes: []});
  }
  prepend(...nodes) {
    const added = [];
    for (const node of [...nodes].reverse()) {
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.unshift(node);
      added.push(node);
    }
    if (added.length) this._notify({type: 'childList', target: this, addedNodes: added, removedNodes: []});
  }
  insertBefore(node, reference) {
    const index = reference ? this.children.indexOf(reference) : -1;
    node.parentElement?.removeChild(node);
    node.parentElement = this;
    if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
    this._notify({type: 'childList', target: this, addedNodes: [node], removedNodes: []});
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentElement = null;
    this._notify({type: 'childList', target: this, addedNodes: [], removedNodes: [node]});
  }
  remove() { this.parentElement?.removeChild(this); this.isConnected = false; }
  replaceChildren(...nodes) {
    const removed = [...this.children];
    for (const child of removed) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentElement = null;
    }
    const added = [];
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
      added.push(node);
    }
    if (removed.length || added.length) this._notify({type: 'childList', target: this, addedNodes: added, removedNodes: removed});
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  matches(selector) {
    return splitList(selector).some((part) => matchesChain(this, parseSelector(part).chain));
  }
  querySelectorAll(selector) {
    const out = [];
    for (const part of splitList(selector)) {
      const {scoped, direct, chain} = parseSelector(part);
      if (!chain.length) continue;
      const visit = (node, depth) => {
        for (const child of node.children) {
          // ":scope > .x" only matches direct children; ":scope .x" matches any descendant
          const eligible = scoped && direct ? depth === 0 : true;
          if (eligible && matchesChain(child, chain) && !out.includes(child)) out.push(child);
          visit(child, depth + 1);
        }
      };
      visit(this, 0);
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() {
    if (this.box) return this.box;
    const parent = this.parentElement?.getBoundingClientRect?.() || {left: 0, top: 0, width: 1024, height: 768};
    return {left: parent.left, top: parent.top, width: parent.width, height: parent.height, right: parent.left + parent.width, bottom: parent.top + parent.height};
  }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  focus() { this.ownerDocument.activeElement = this; this.focused = true; }
  get isConnectedRoot() { return this.isConnected; }
}
function matchesChain(el, chain) {
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let index = chain.length - 2;
  for (let node = el.parentElement; node && index >= 0; node = node.parentElement) {
    if (matchesCompound(node, chain[index])) index -= 1;
  }
  return index < 0;
}

function createDocument() {
  const document = {
    readyState: 'complete',
    activeElement: null,
    listeners: new Map(),
    documentElement: null,
    body: null,
    createElement(tag) { return new FakeElement(tag, document); },
    createTextNode(text) { const node = new FakeElement('#text', document); node.textContent = text; return node; },
    querySelector(selector) { return document.body.querySelector(selector); },
    querySelectorAll(selector) { return document.body.querySelectorAll(selector); },
    addEventListener(type, handler) {
      if (!document.listeners.has(type)) document.listeners.set(type, []);
      document.listeners.get(type).push(handler);
    },
    removeEventListener() {},
    // MutationObserver plumbing: a real browser reports every DOM write to the observers watching
    // that subtree. Without this, a self-triggered observer loop cannot be reproduced in a test.
    _observers: [],
    _pending: [],
    addObserver(observer) { document._observers.push(observer); },
    removeObserver(observer) { document._observers = document._observers.filter((entry) => entry !== observer); },
    queueRecord(record) { document._pending.push(record); },
    // deliver queued records, like the browser's microtask checkpoint
    flushMutations() {
      if (!document._pending.length) return 0;
      const batch = document._pending.splice(0, document._pending.length);
      let delivered = 0;
      for (const observer of [...document._observers]) {
        if (observer.disconnected) continue;
        const seen = batch.filter((record) => observer.sees(record));
        if (!seen.length) continue;
        delivered += seen.length;
        observer.callback(seen, observer);
      }
      return delivered;
    },
  };
  document.documentElement = new FakeElement('html', document);
  document.documentElement.dataset = {};
  document.body = new FakeElement('body', document);
  document.body.append(document.documentElement);
  return document;
}

module.exports = {FakeElement, createDocument};
