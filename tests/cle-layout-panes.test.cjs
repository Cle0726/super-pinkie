// Two learning panes, mounted for real: each side must get its own 互动学习 / 学习工具 / 笔记,
// answer with its own session key, and lose nothing when the other side is clicked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');

const root = path.join(__dirname, '../services/cle-studio');
const source = fs.readFileSync(path.join(root, 'static/legacy/laolao-learning-stage.js'), 'utf8');

// A pane as the native split view renders it: the pane element carries the session key and
// contains its own .chat-main > composer > lead.
function makePane(document, sessionKey, box, active = false) {
  const pane = document.createElement('openclaw-chat-pane');
  // faithful to the split view: exactly one pane carries --active, both carry --visible
  pane.className = `chat-pane-cache__pane chat-pane-cache__pane--visible chat-split-view__pane${active ? ' chat-pane-cache__pane--active' : ''}`;
  pane.sessionKey = sessionKey;
  pane.dataset.mcpAppOwnerKey = JSON.stringify(['owner', sessionKey]);
  pane.box = box;
  const main = document.createElement('div'); main.className = 'chat-main';
  const conversation = document.createElement('div'); conversation.className = 'chat-main__conversation';
  const footer = document.createElement('div'); footer.className = 'chat-footer';
  const shell = document.createElement('div'); shell.className = 'agent-chat__composer-shell';
  const input = document.createElement('div'); input.className = 'agent-chat__input';
  const lead = document.createElement('div'); lead.className = 'agent-chat__composer-lead';
  input.append(lead);
  shell.append(input);
  footer.append(shell);
  conversation.append(footer);
  main.append(conversation);
  pane.append(main);
  return {pane, main, lead};
}

function boot(specs = []) {
  const document = createDocument();
  const panes = specs.map(([sessionKey, box], index) => makePane(document, sessionKey, box, index === 0));
  document.body.append(...panes.map((entry) => entry.pane));
  const requests = [];
  const window = {
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: (fn) => { fn(0); return 1; },
    setInterval: () => 0, clearInterval() {},
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; }, clearTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} },
    location: {href: 'http://localhost/chat'},
    __laolaoSidebar: {gwRequest: async (method, params) => {
      requests.push({method, params});
      if (method === 'pinkie.learning.current') return {enabled: true, revision: 1, current: null};
      if (method === 'pinkie.learning.notes.list') return {notes: [], dueCount: 0};
      if (method === 'sessions.list') return {sessions: []};
      return {ok: true, revision: 1, today: {date: '2026-10-18', progress: {minutes: 0, questions: 0, dueReviews: 0}, goals: {minutes: 25, questions: 5}, streak: {current: 0}, complete: false, pact: {}}};
    }},
  };
  const context = {
    window, document, location: window.location, URL,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    crypto: {randomUUID: () => `id-${requests.length}`},
    console, navigator: {},
  };
  window.document = document;
  vm.runInNewContext(source, context);
  return {window, document, requests, panes};
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const LEFT = [0, 0, 508, 720];
const RIGHT = [516, 0, 1024, 720];
const box = ([left, top, right, bottom]) => ({left, top, right, bottom, width: right - left, height: bottom - top});

test('both panes get 互动学习, 学习工具 and 笔记 — not just the active one', async () => {
  const {panes} = boot([['agent:learning:left', box(LEFT)], ['agent:learning:right', box(RIGHT)]]);
  const [left, right] = panes;
  for (const side of [left, right]) {
    assert.ok(side.lead.querySelector('.laolao-learning-toggle'), `missing 互动学习 in ${side.pane.sessionKey}`);
    assert.ok(side.lead.querySelector('.laolao-learning-tools'), `missing 学习工具 in ${side.pane.sessionKey}`);
    assert.ok(side.lead.querySelector('.laolao-learning-notebook-button'), `missing 笔记 in ${side.pane.sessionKey}`);
  }
  assert.equal(left.lead.querySelectorAll('.laolao-learning-toggle').length, 1, 'no duplicated controls');
  assert.equal(right.lead.querySelectorAll('.laolao-learning-toggle').length, 1, 'no duplicated controls');
});

test('each side answers with its own session key', async () => {
  const {window, requests, panes} = boot([['agent:learning:left', box(LEFT)], ['agent:learning:right', box(RIGHT)]]);
  const [left, right] = panes;
  const controllers = [...window.__cleLearningControllers];
  const leftController = controllers.find((item) => item.sessionKey === 'agent:learning:left');
  const rightController = controllers.find((item) => item.sessionKey === 'agent:learning:right');
  assert.ok(leftController && rightController, 'both sides own a controller');

  // clicking the right side's toggle sends a control message for the right session only
  await right.lead.querySelector('.laolao-learning-toggle').dispatch('click');
  await tick();
  const sent = requests.filter((entry) => entry.method === 'chat.send');
  assert.ok(sent.length >= 1, 'the toggle sends one control message');
  assert.ok(sent.every((entry) => entry.params.sessionKey === 'agent:learning:right'), 'never answers in the left pane');

  assert.equal(leftController.sessionKey, 'agent:learning:left');
  assert.equal(rightController.sessionKey, 'agent:learning:right');
  assert.notEqual(leftController.pane, rightController.pane);
});

test('a non-learning pane gets no learning tools, its neighbour keeps them', async () => {
  const {window, panes} = boot([['agent:main:one', box(LEFT)], ['agent:learning:two', box(RIGHT)]]);
  const [chat, study] = panes;
  for (const controller of [...window.__cleLearningControllers]) controller.reconcile();
  await tick();

  assert.equal(chat.lead.querySelector('.laolao-learning-toggle'), null, 'chat pane stays plain');
  assert.equal(chat.lead.querySelector('.laolao-learning-tools'), null, 'no 学习工具 outside learning');
  assert.ok(study.lead.querySelector('.laolao-learning-toggle'), 'learning pane keeps its controls');
  assert.ok(study.lead.querySelector('.laolao-learning-tools'), 'learning pane keeps its tools');
});

test('cached panes are adopted, not duplicated', async () => {
  const {window, panes} = boot([['agent:learning:left', box(LEFT)]]);
  const [left] = panes;
  const controller = [...window.__cleLearningControllers].find((item) => item.pane === left.pane);
  assert.ok(controller);
  controller.reconcile();
  controller.reconcile();
  assert.equal(left.lead.querySelectorAll('.laolao-learning-toggle').length, 1);
  assert.equal(left.lead.querySelectorAll('.laolao-learning-tools').length, 1);
});
