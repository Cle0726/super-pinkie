const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('follow-up mode stays with the session when the same busy pane is reused', () => {
  const pane = {
    dataset: {},
    state: { sessionKey: 'agent:learning:dashboard:first', chatRunId: 'first-run', chatQueue: [] },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const document = {
    readyState: 'loading',
    documentElement: { getAttribute() { return 'learning'; } },
    addEventListener() {},
    querySelectorAll() { return [pane]; },
  };
  const window = { addEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout, setInterval() {} };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-queue-steer.js'), 'utf8');
  vm.runInNewContext(source, { window, document, CustomEvent, WeakMap, Set, Array, Object, String, Date, Promise, console });
  const api = window.__laolaoQueueSteer;
  assert.equal(api.setFollowUpMode(pane, 'queue'), 'queue');
  assert.equal(api.getFollowUpMode(pane), 'queue');
  pane.state.sessionKey = 'agent:project:dashboard:second';
  pane.state.chatRunId = 'second-run';
  assert.equal(api.getFollowUpMode(pane), 'steer', 'the first keypress must not inherit the old session mode');
  api.syncQueueControls();
  assert.equal(api.getFollowUpMode(pane), 'steer');
  assert.equal(pane.dataset.pinkieFollowupMode, 'steer');
  pane.state.sessionKey = 'agent:learning:dashboard:first';
  assert.equal(api.getFollowUpMode(pane), 'steer', 'reused panes do not revive a previous session toggle');
});
