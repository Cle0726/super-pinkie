import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createDocument} = require('./fixtures/mini-dom.cjs');
const source = fs.readFileSync(new URL('../services/cle-studio/src/process/transcript.js', import.meta.url), 'utf8')
  .replace(/^import ['"].*?['"];?$/mg, '').replaceAll('export function ', 'function ');

function harness() {
  const document = createDocument(), queryLog = [], timers = new Map(), frames = new Map(), observers = [];
  let id = 0;
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const node = make(tag), qsa = node.querySelectorAll.bind(node), values = new Map();
    node.nodeType = 1;
    node.style = {setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key),
      getPropertyValue: (key) => values.get(key) || ''};
    node.querySelectorAll = (selector) => {
      queryLog.push({node, selector});
      if (selector.includes(':is(')) return qsa('.chat-text').flatMap((text) => text.children.flatMap((child) =>
        child.tagName === 'div' ? child.children : [child])).filter((child) => /^(p|ul|ol|pre|blockquote|h[1-4]|table|hr)$/.test(child.tagName));
      return qsa(selector);
    };
    return node;
  };
  const docQSA = document.querySelectorAll.bind(document);
  document.querySelectorAll = (selector) => { queryLog.push({node: document, selector}); return docQSA(selector); };
  const root = document.createElement('openclaw-app-shell');
  const pane = document.createElement('openclaw-chat-pane'); pane.state = {sessionKey: 'session-a'};
  const visible = document.createElement('div'); visible.className = 'chat-pane-cache__pane--visible';
  const latest = document.createElement('div'); latest.className = 'chat-group chat-group--latest-assistant';
  visible.append(latest); pane.append(visible); root.append(pane); document.documentElement.append(root);
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
    fire(records) { if (!this.disconnected) this.callback(records); }
  }
  function element(tag, className = '', text = '') {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
  }
  function bubble(messageId, parent = latest) {
    const node = element('div', 'chat-bubble'); node.dataset.messageId = messageId;
    const text = element('div', 'chat-text'), paragraph = element('p', '', `Text ${messageId}`);
    text.append(paragraph); node.append(text); parent.append(node);
    return {node, text, paragraph};
  }
  const controller = new AbortController();
  const context = {document, MutationObserver, console,
    requestAnimationFrame(fn) { const key = ++id; frames.set(key, fn); return key; },
    cancelAnimationFrame(key) { frames.delete(key); },
    setTimeout(fn) { const key = ++id; timers.set(key, fn); return key; },
    clearTimeout(key) { timers.delete(key); }};
  vm.runInNewContext(`${source}\nglobalThis.mountTranscript = mountTranscript;`, context);
  function start() { context.mountTranscript(controller.signal); queryLog.length = 0; return observers.at(-1); }
  function flush() { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()); }
  const mutation = (target, addedNodes = [], removedNodes = []) => ({type: 'childList', target, addedNodes, removedNodes});
  return {document, queryLog, timers, frames, observers, root, pane, visible, latest, element, bubble,
    controller, start, flush, mutation};
}

test('initial history is primed once and streaming text only scans its owning bubble', () => {
  const h = harness();
  const historical = Array.from({length: 300}, (_, index) => h.bubble(`old-${index}`));
  const current = h.bubble('current');
  const mo = h.start();
  assert.equal(h.timers.size, 0, 'mount never animates history');
  const textNode = {nodeType: 3, parentElement: current.paragraph};
  for (let token = 0; token < 20; token++) {
    mo.fire([{type: 'characterData', target: textNode}]); h.flush();
  }
  assert.equal(h.queryLog.filter((q) => q.node === h.document || q.node === h.visible || q.node === h.root).length, 0);
  assert.equal(h.queryLog.filter((q) => historical.some((old) => old.node === q.node)).length, 0);
  assert.equal(h.timers.size, 0, 'updating an existing bubble never replays its reveal');
  assert.equal(mo.options.characterData, true);
  assert.deepEqual([...mo.options.attributeFilter], ['aria-label']);
  h.controller.abort();
});

test('a new live subtree is deduplicated, revealed, and its same-ID remount never replays', () => {
  const h = harness(); h.bubble('history'); const mo = h.start();
  const fresh = h.bubble('fresh');
  mo.fire([h.mutation(h.latest, [fresh.node]), h.mutation(fresh.node, [fresh.text]), h.mutation(fresh.text, [fresh.paragraph])]);
  h.flush();
  assert.equal(fresh.paragraph.classList.contains('cle-reveal'), true);
  assert.equal(h.timers.size, 1);
  fresh.paragraph.dispatch('animationend');
  assert.equal(h.timers.size, 0);
  fresh.node.remove();
  const remounted = h.bubble('fresh');
  mo.fire([h.mutation(h.latest, [remounted.node], [fresh.node])]); h.flush();
  assert.equal(remounted.paragraph.classList.contains('cle-reveal'), false);
  assert.equal(h.queryLog.filter((q) => q.node === h.document).length, 0);
  h.controller.abort();
});

test('tool counts update on characterData while aria-label updates only that tool row', () => {
  const h = harness();
  const group = h.element('div', 'chat-activity-group'), label = h.element('span', 'chat-activity-group__label', '1 条命令');
  const row = h.element('div', 'chat-tool-row'), icon = h.element('span', 'chat-tool-msg-summary__icon');
  icon.setAttribute('aria-label', 'read'); row.append(icon); group.append(label, row); h.latest.append(group);
  const mo = h.start();
  assert.equal(label.dataset.cleTotal, '1'); assert.equal(row.dataset.cleKind, 'read');
  label.textContent = '1 条命令 · 2 次读取';
  mo.fire([{type: 'characterData', target: {nodeType: 3, parentElement: label}}]); h.flush();
  assert.equal(label.dataset.cleTotal, '3'); assert.equal(group.dataset.cleKind, 'read');
  icon.setAttribute('aria-label', 'write');
  mo.fire([{type: 'attributes', attributeName: 'aria-label', target: icon}]); h.flush();
  assert.equal(row.dataset.cleKind, 'write');
  assert.equal(h.queryLog.filter((q) => q.node === h.document || q.node === h.visible).length, 0);
  assert.equal(h.frames.size, 0, 'our data-cle / animation writes do not schedule another pass');
  h.controller.abort();
});

test('hidden pane content is remembered without revealing on a later remount', () => {
  const h = harness(); const mo = h.start();
  h.visible.className = 'chat-pane-cache__pane';
  const hidden = h.bubble('cached-latest');
  mo.fire([h.mutation(h.latest, [hidden.node])]); h.flush();
  assert.equal(h.timers.size, 0);
  hidden.node.remove(); h.visible.className = 'chat-pane-cache__pane--visible';
  const shown = h.bubble('cached-latest');
  mo.fire([h.mutation(h.latest, [shown.node])]); h.flush();
  assert.equal(shown.paragraph.classList.contains('cle-reveal'), false);
  h.controller.abort();
});

test('abort cancels queued work, active reveal listeners, timeouts, and presentation tags', () => {
  const h = harness(); const row = h.element('div', 'chat-tool-row');
  const verb = h.element('span', 'chat-tool-row__verb', 'read'); row.append(verb); h.latest.append(row);
  const mo = h.start(), fresh = h.bubble('live');
  mo.fire([h.mutation(h.latest, [fresh.node])]); h.flush();
  assert.equal(h.timers.size, 1);
  mo.fire([h.mutation(fresh.text, [h.element('p')])]);
  assert.equal(h.frames.size, 1);
  h.controller.abort();
  assert.equal(mo.disconnected, true);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(row.dataset.cleKind, undefined);
  assert.equal(fresh.paragraph.classList.contains('cle-reveal'), false);
  assert.equal(fresh.paragraph.listeners.get('animationend')?.length || 0, 0);
  h.flush(); assert.equal(h.frames.size, 0);
});

test('removed or animation-suppressed content releases reveal references', () => {
  const h = harness(); const mo = h.start(), fresh = h.bubble('removed');
  mo.fire([h.mutation(h.latest, [fresh.node])]); h.flush();
  assert.equal(h.timers.size, 1);
  fresh.paragraph.remove();
  mo.fire([h.mutation(fresh.text, [], [fresh.paragraph])]); h.flush();
  assert.equal(h.timers.size, 0);
  const suppressed = h.bubble('reduced-motion');
  mo.fire([h.mutation(h.latest, [suppressed.node])]); h.flush();
  assert.equal(h.timers.size, 1);
  [...h.timers.values()].forEach((finish) => finish());
  assert.equal(h.timers.size, 0);
  assert.equal(suppressed.paragraph.classList.contains('cle-reveal'), false);
  h.controller.abort();
});
