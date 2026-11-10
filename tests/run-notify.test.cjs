// Plan B §3 + §4: reminders when the page cannot be seen.
// Visible and looking at that session → nothing. Not visible → each layer
// exactly once per run; the system notification only after 60 seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const JS = 'ui/injections/laolao-run-notify.js';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const SK = 'agent:project:dashboard:aaa';
const OTHER = 'agent:project:dashboard:bbb';

function rowStub(key, name) {
  const attrs = {};
  return {
    dataset: {sessionKey: key}, attrs,
    setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    querySelector(sel) { return sel.includes('__name') ? {textContent: name} : null; },
  };
}

function load({hidden = false, current = SK, prefs = null, permission = 'granted', nativeNotify = false} = {}) {
  let clock = 1_800_000_000_000;
  const store = new Map();
  if (prefs) store.set('pinkie.runNotify.v1', JSON.stringify(prefs));
  const listeners = {};
  const posted = [];
  const notifications = [];
  const asks = [];
  const rows = [rowStub(SK, '整理销售数据'), rowStub(OTHER, '做个记账网页')];
  class FakeNotification {
    constructor(title, options) { this.title = title; this.options = options; notifications.push(this); }
    static requestPermission() { asks.push('requested'); FakeNotification.permission = 'granted'; return Promise.resolve('granted'); }
  }
  FakeNotification.permission = permission;
  const document = {
    hidden, title: '碧琪',
    readyState: 'complete',
    addEventListener(type, fn) { (listeners['doc:' + type] ||= []).push(fn); },
    querySelector(sel) {
      if (sel.includes('--active')) return rows.find((r) => r.dataset.sessionKey === current) || null;
      return null;
    },
    querySelectorAll(sel) { return sel.includes('sidebar-recent-session') ? rows : []; },
    hasFocus() { return !document.hidden; },
    createElement() {
      const node = {children: [], dataset: {}, style: {}, classList: {add() {}, remove() {}, toggle() {}},
        setAttribute() {}, append(...k) { node.children.push(...k); }, addEventListener(t, f) { node['on' + t] = f; },
        remove() { node.removed = true; }, querySelector() { return null; }};
      asks.push(node);
      return node;
    },
    body: {append() {}},
    documentElement: {dataset: {}},
  };
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent() { return true; },
    setInterval() { return 0; }, clearInterval() {}, setTimeout(fn) { return 0; }, clearTimeout() {},
    location: {href: `http://127.0.0.1/chat?session=${encodeURIComponent(current)}`},
    focus() {},
    webkit: {messageHandlers: {laolaoWindowControl: {postMessage(m) { posted.push(m); }}}},
    __laolaoSidebar: {navigateSession(key) { posted.push({navigate: key}); }},
  };
  if (nativeNotify) window.webkit.messageHandlers.pinkieNotify = {postMessage(m) { posted.push({native: m}); }};
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  };
  window.localStorage = localStorage;
  window.Notification = FakeNotification;
  const DateStub = class extends Date { static now() { return clock; } };
  vm.runInNewContext(read(JS), {
    window, document, localStorage, console, URL, Map, Set, Date: DateStub, Math, JSON, Promise, Notification: FakeNotification,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
  }, {filename: 'laolao-run-notify.js'});
  const fire = (event, payload) => (listeners['pinkie:gateway-event'] || []).forEach((fn) => fn({detail: {event, payload}}));
  const start = (key = SK, runId = 'run-1') => fire('agent', {sessionKey: key, runId, stream: 'lifecycle', data: {phase: 'start'}});
  const final = (key = SK, runId = 'run-1', text = '做好了，页面在桌面上。顺手修了两处对齐。') => fire('chat', {sessionKey: key, runId, state: 'final',
    message: {role: 'assistant', content: [{type: 'text', text}]}});
  return {
    api: window.__pinkieRunNotify, document, window, rows, posted, notifications, asks, store, listeners, fire, start, final,
    tick(ms) { clock += ms; },
    recovered(detail) { (listeners['pinkie:run-recovered'] || []).forEach((fn) => fn({detail})); },
  };
}

test('the notify module exists and exposes its decision', () => {
  assert.ok(fs.existsSync(path.join(ROOT, JS)), 'laolao-run-notify.js is missing');
  const h = load();
  assert.equal(typeof h.api?.decide, 'function');
  assert.match(read('ui/injections/laolao-head.fragment.html'), /laolao-run-notify\.js\?v=/);
});

test('visible and looking at the session: nothing at all', () => {
  const h = load({hidden: false});
  h.start(); h.tick(120_000); h.final();
  assert.equal(h.notifications.length, 0);
  assert.equal(h.document.title, '碧琪');
  assert.equal(h.posted.filter((m) => m.action === 'attention').length, 0);
  assert.equal(h.rows[0].getAttribute('data-pinkie-run'), null);
});

test('not visible and longer than 60 seconds: exactly one of each reminder', () => {
  const h = load({hidden: true});
  h.start(); h.tick(61_000); h.final();
  h.final(); // the same run reported twice (history resync) must not repeat anything
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].title, '整理销售数据');
  assert.equal(h.notifications[0].options.body, '做好了，页面在桌面上。');
  assert.match(h.document.title, /^✓ /);
  assert.equal(h.posted.filter((m) => m.action === 'attention').length, 1);
  // Clicking the notification brings back that very session.
  h.notifications[0].onclick?.();
  assert.ok(h.posted.some((m) => m.navigate === SK));
});

test('not visible but short: title and dock, no system notification', () => {
  const h = load({hidden: true});
  h.start(); h.tick(30_000); h.final();
  assert.equal(h.notifications.length, 0);
  assert.match(h.document.title, /^✓ /);
  assert.equal(h.posted.filter((m) => m.action === 'attention').length, 1);
});

test('errors and questions get their own marks', () => {
  const err = load({hidden: true});
  err.start(); err.tick(90_000);
  err.fire('chat', {sessionKey: SK, runId: 'run-1', state: 'error', errorMessage: 'boom'});
  assert.match(err.document.title, /^! /);
  assert.equal(err.notifications.length, 1);
  assert.doesNotMatch(err.notifications[0].options.body, /boom|error/i, 'no technical words');

  const ask = load({hidden: true});
  ask.start(); ask.tick(90_000);
  ask.fire('agent', {sessionKey: SK, runId: 'run-1', stream: 'tool', data: {phase: 'start', name: 'ask_user', args: {question: '要不要连旧版本一起删？'}}});
  assert.match(ask.document.title, /^\? /);
  assert.equal(ask.notifications.length, 1);
  assert.equal(ask.notifications[0].options.body, '要不要连旧版本一起删？');
});

test('coming back clears the title mark', () => {
  const h = load({hidden: true});
  h.start(); h.tick(61_000); h.final();
  h.document.hidden = false;
  (h.listeners['doc:visibilitychange'] || []).forEach((fn) => fn());
  assert.equal(h.document.title, '碧琪');
});

test('another session finishing while this page is visible: only the list mark', () => {
  const h = load({hidden: false, current: SK});
  h.start(OTHER, 'run-9');
  assert.equal(h.rows[1].getAttribute('data-pinkie-run'), 'running');
  h.tick(120_000); h.final(OTHER, 'run-9');
  assert.equal(h.rows[1].getAttribute('data-pinkie-run'), 'unread');
  assert.equal(h.notifications.length, 0);
  assert.equal(h.document.title, '碧琪');
  // Opening it clears the mark.
  h.api.viewed(OTHER);
  assert.equal(h.rows[1].getAttribute('data-pinkie-run'), null);
});

test('every layer can be switched off in settings', () => {
  const h = load({hidden: true, prefs: {list: false, title: false, system: false}});
  h.start(); h.tick(120_000); h.final();
  assert.equal(h.notifications.length, 0);
  assert.equal(h.document.title, '碧琪');
  assert.equal(h.posted.filter((m) => m.action === 'attention').length, 0);
  assert.equal(h.rows[0].getAttribute('data-pinkie-run'), null);
});

test('after a reconnect, a run that ended while offline is reported once', () => {
  const h = load({hidden: true});
  h.start(); h.tick(90_000);
  h.recovered({sessionKey: SK, runId: 'run-1', outcome: 'done', text: '都做完了。'});
  h.recovered({sessionKey: SK, runId: 'run-1', outcome: 'done', text: '都做完了。'});
  assert.equal(h.notifications.length, 1);
  h.final(); // the late final for the same run stays quiet
  assert.equal(h.notifications.length, 1);
});

test('asks for permission once in Pinkie\'s voice; a no is remembered', () => {
  const h = load({hidden: false, permission: 'default'});
  const prompt = h.api.permissionPrompt();
  assert.ok(prompt, 'offers to ask');
  assert.ok([...String(prompt.text)].length <= 22);
  assert.match(prompt.text, /碧琪/);
  assert.deepEqual(JSON.parse(JSON.stringify(prompt.buttons)), ['好呀', '不用了']);
  h.api.answerPermission(false);
  assert.equal(h.api.permissionPrompt(), null, 'never asks again after a no');
});

test('uses the native notification bridge when the shell has one', () => {
  const h = load({hidden: true, nativeNotify: true});
  h.start(); h.tick(61_000); h.final();
  const native = h.posted.filter((m) => m.native);
  assert.equal(native.length, 1);
  assert.equal(native[0].native.title, '整理销售数据');
  assert.equal(h.notifications.length, 0, 'not both');
});
