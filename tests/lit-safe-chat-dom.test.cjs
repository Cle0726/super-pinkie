const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// Lit renders a text binding after a comment marker and later writes the new
// value into that same text node. Scripts that assign textContent to a native
// label delete the marker; Lit's next update then throws inside the chat pane,
// which stops new replies from being committed and scrolled into view until
// the app is reopened. These tests pin both the fix and the self-heal.

/** Minimal element with enough selector support for laolao-phrases. */
function element(classes, parent = null, tag = 'span') {
  const node = {
    tagName: tag.toUpperCase(), classes: new Set(classes.split(/\s+/).filter(Boolean)), parentElement: parent,
    dataset: {}, setAttribute() {}, getAttribute() { return null; },
    matches(selector) { return selector.split(',').some((alt) => matchChain(node, alt.trim().split(/\s+/))); },
    closest(selector) {
      for (let current = node; current; current = current.parentElement) if (current.matches(selector)) return current;
      return null;
    },
  };
  return node;
}
function matchCompound(node, compound) {
  const match = /^([a-z]*)((?:\.[\w-]+)*)$/i.exec(compound);
  if (!match) return false;
  if (match[1] && node.tagName !== match[1].toUpperCase()) return false;
  return match[2].split('.').filter(Boolean).every((name) => node.classes.has(name));
}
function matchChain(node, parts) {
  if (!matchCompound(node, parts.at(-1))) return false;
  let rest = parts.slice(0, -1);
  for (let ancestor = node.parentElement; rest.length && ancestor; ancestor = ancestor.parentElement) {
    if (matchCompound(ancestor, rest.at(-1))) rest = rest.slice(0, -1);
  }
  return rest.length === 0;
}
const textNode = (nodeValue, parentElement) => ({nodeType: 3, nodeValue, parentElement});

function loadPhrases() {
  const source = read('ui/injections/laolao-phrases.js')
    .replace(/\}\)\(\);\s*$/, 'window.__phrasesTest = {localizeText};})();');
  const window = {addEventListener() {}, dispatchEvent() {}};
  const document = {readyState: 'loading', addEventListener() {}};
  class MutationObserver { observe() {} disconnect() {} }
  vm.runInNewContext(source, {
    window, document, MutationObserver, Node: {TEXT_NODE: 3, ELEMENT_NODE: 1}, NodeFilter: {SHOW_TEXT: 4},
    CustomEvent: class {}, console,
  });
  return window.__phrasesTest;
}

test('phrases localizes Lit-owned chat labels only through their text node values', () => {
  const source = read('ui/injections/laolao-phrases.js');
  assert.doesNotMatch(source, /(?:textContent|innerHTML|innerText)\s*=[^=]/);
  assert.doesNotMatch(source, /replaceChildren\(/);

  const {localizeText} = loadPhrases();
  const run = (node) => { localizeText(node); localizeText(node); return node.nodeValue; };

  // `Activity: ${count} tool${plural}` keeps its live count node.
  const group = element('chat-group tool chat-group--activity', null, 'div');
  const label = element('chat-activity-group__label', element('chat-activity-group__summary', group, 'button'));
  assert.deepEqual(['Activity: ', '4', ' tool', 's'].map((value) => run(textNode(value, label))),
    ['工具进度 · ', '4', ' 项', '']);

  const summary = element('chat-tool-msg-summary__label', element('chat-tool-msg-summary', group, 'button'));
  assert.equal(run(textNode('exec', summary)), '执行命令 · exec');
  assert.equal(run(textNode('Tool output', summary)), '工具结果');

  const footer = element('chat-group-footer', group, 'div');
  assert.equal(run(textNode('Activity', element('chat-sender-name', footer))), '碧琪的行动小记录');
  const toolGroup = element('chat-group tool', null, 'div');
  assert.equal(run(textNode('Tool', element('chat-sender-name', toolGroup))), '工具');

  const userGroup = element('chat-group user', null, 'div');
  assert.equal(run(textNode('You', element('chat-sender-name', userGroup))), '你');
  // A user's own message that says "You" is content, not chrome.
  assert.equal(run(textNode('You', element('chat-text', element('chat-bubble', userGroup, 'div'), 'div'))), 'You');

  // The native queue uses the same comment-delimited Lit text bindings as
  // activity labels. Its count, actions and error need Chinese text without
  // replacing the parent element or deleting those markers.
  const queue = element('chat-queue', null, 'div');
  const title = element('chat-queue__title', queue, 'div');
  assert.deepEqual(['Queued (', '2', ')'].map((value) => run(textNode(value, title))),
    ['待发送（', '2', '）']);
  // Newer bundles put the count in one binding instead of three; that still
  // has to stay a node-value-only localization.
  assert.equal(run(textNode('Queued (12)', title)), '待发送（12）');
  const badge = element('chat-queue__badge', queue, 'span');
  assert.equal(run(textNode('Steered', badge)), '正在确认追加');
  const steer = element('chat-queue__steer', queue, 'button');
  assert.equal(run(textNode('Steer', element('', steer))), '立即追加');
  const retry = element('chat-queue__retry', queue, 'button');
  assert.equal(run(textNode('Retry', element('', retry))), '重试');
  const error = element('chat-queue__error', queue, 'div');
  assert.equal(run(textNode('Steer failed before it reached the run; try again.', error)),
    '追加没有送达，这轮结束后发送。');
});

test('short progress phrases are limited to status surfaces, not setting labels', () => {
  const {localizeText} = loadPhrases();
  const run = (value, parent) => {
    const node = textNode(value, parent);
    localizeText(node);
    return node.nodeValue;
  };
  const setting = element('qs-row__label', element('qs-card qs-card--model', null, 'div'));
  const progress = element('chat-activity-group__summary', element('chat-activity-group', null, 'div'), 'button');
  const retry = element('laolao-deep-think-status__retry', element('laolao-deep-think-status', null, 'div'), 'button');

  assert.equal(run('Thinking', setting), 'Thinking');
  assert.equal(run('Running', setting), 'Running');
  assert.equal(run('Retry', setting), 'Retry');
  assert.equal(run('Thinking', progress), '碧琪在转着卷卷鬃毛想呀想…');
  assert.equal(run('Running', progress), '碧琪正在忙活中…');
  assert.equal(run('Retry', retry), '再试一次');
});

test('native chat timeline patches render through Lit templates without rewriting Lit-owned DOM', () => {
  const patch = read('patch/apply-chat-timeline.mjs');
  const resume = read('ui/injections/laolao-resume.js');
  assert.doesNotMatch(patch, /(?:textContent|innerHTML|innerText)\s*=(?!=)/);
  assert.doesNotMatch(patch, /replaceChildren\(|\.remove\(\)/);
  assert.doesNotMatch(resume, /(?:textContent|innerHTML|innerText)\s*=(?!=)/);
  assert.match(patch, /pinkieBuildTimeline/);
  assert.match(patch, /return s\\`<details class="chat-timeline-overflow" \.open=/);
  assert.match(patch, /pinkieTimelineView\(e\.key\)\.open\?s/);
});

function loadResumeGuard() {
  const source = read('ui/injections/laolao-resume.js');
  const events = [];
  const window = {
    location: {pathname: '/chat', search: ''},
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
    addEventListener() {}, dispatchEvent(event) { events.push(event); },
    requestAnimationFrame(callback) { callback(); },
    customElements: {whenDefined: () => new Promise(() => {}), get() {}},
  };
  const document = {
    hidden: false, visibilityState: 'visible', activeElement: null,
    documentElement: {setAttribute() {}, removeAttribute() {}, hasAttribute() { return false; }},
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
  };
  class MutationObserver { observe() {} disconnect() {} }
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  vm.runInNewContext(source, {
    window, document, location: window.location, MutationObserver, CustomEvent, Element: class {},
    URLSearchParams, URL, Map, Set, WeakMap, Number, Array, JSON, Promise, Error, TypeError, Date, console: {warn() {}},
  }, {filename: 'laolao-resume.js'});
  return {hooks: window.__laolaoRenderGuardTestHooks, events};
}

/** A pane whose Lit tree has one text binding; `detached` mimics a deleted marker. */
function fakePaneClass() {
  const connected = () => ({isConnected: true, nextSibling: {nodeType: 3}});
  const freshPart = () => ({_$AA: connected(), _$AH: {_$AV: [{_$AA: connected(), _$AH: 'gemini · Off'}]}});
  return class FakePane {
    constructor() {
      this.renderOptions = {};
      this.state = {sessionKey: 'agent:main:main', chatUserNearBottom: true, scrollToBottom() { this.scrolled = true; }};
      this.renderRoot = {
        _$litPart$: freshPart(), childCount: 3,
        replaceChildren() { this.childCount = 0; }, contains() { return false; },
      };
      this.renders = 0;
      this.fail = null;
    }
    detachLabelMarker() {
      const label = this.renderRoot._$litPart$._$AH._$AV[0];
      label._$AA = {isConnected: false, nextSibling: null};
    }
    update() {
      this.renders += 1;
      if (this.fail) throw this.fail;
      const label = this.renderRoot._$litPart$?._$AH._$AV[0];
      if (label && !label._$AA.isConnected) throw new TypeError("Cannot set properties of null (setting 'data')");
      this.renderRoot._$litPart$ ??= Object.assign(freshPart(), {rebuilt: true});
    }
  };
}

test('chat pane render guard rebuilds the pane DOM only for detached Lit markers', () => {
  const {hooks, events} = loadResumeGuard();
  const Pane = fakePaneClass();
  hooks.guardChatPaneRender(Pane);
  hooks.guardChatPaneRender(Pane); // idempotent

  const pane = new Pane();
  assert.equal(hooks.hasDetachedLitMarkers(pane), false);
  pane.update();
  assert.equal(pane.renders, 1);

  pane.detachLabelMarker();
  const oldPart = pane.renderRoot._$litPart$;
  let disconnected = null;
  oldPart.setConnected = (value) => { disconnected = value; };
  assert.equal(hooks.hasDetachedLitMarkers(pane), true);
  pane.update();
  assert.equal(disconnected, false);
  assert.equal(pane.renderRoot.childCount, 0);
  assert.equal(pane.renderRoot._$litPart$.rebuilt, true);
  assert.equal(pane.state.scrolled, true);
  assert.equal(hooks.hasDetachedLitMarkers(pane), false);
  assert.deepEqual(events.filter((event) => event.type === 'pinkie:chat-pane-rebuilt').map((event) => event.detail.sessionKey),
    ['agent:main:main']);

  // A second corruption inside the rate limit surfaces instead of looping.
  pane.detachLabelMarker();
  assert.throws(() => pane.update(), /setting 'data'/);

  // Any other render failure is rethrown with the DOM left alone.
  const other = new Pane();
  other.fail = new TypeError('Cannot read properties of undefined (reading \'map\')');
  assert.throws(() => other.update(), /reading 'map'/);
  assert.equal(other.renderRoot.childCount, 3);
});
