import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldRescan, newRun, applyEvent, pace} from '../services/cle-studio/src/process/model.js';

// Minimal stand-ins: the real predicate only walks parent/sibling links.
const node = (tag, parent = null) => ({
  tag, parent,
  get nodeType() { return 1; },
  get parentElement() { return parent; },
  closest(sel) {
    let n = this;
    while (n) { if (n.tag === sel.replace(/^\./, '')) return n; n = n.parent; }
    return null;
  },
});
const isOurs = (n) => {
  const el = n?.nodeType === 1 ? n : n?.parentElement;
  return !!(el && el.closest && el.closest('.cle-status'));
};

test('our own DOM writes never schedule another scan (no observer feedback loop)', () => {
  const pane = node('pane');
  const status = node('cle-status', pane);
  const glyph = node('span', status);

  // we appended the glyph inside our own line
  assert.equal(shouldRescan({target: status, addedNodes: [glyph], removedNodes: []}, isOurs), false);
  // we replaced our own children
  assert.equal(shouldRescan({target: glyph, addedNodes: [], removedNodes: [node('svg', glyph)]}, isOurs), false);
  // we removed the line itself from the pane
  assert.equal(shouldRescan({target: pane, addedNodes: [], removedNodes: [status]}, isOurs), false);
});

test('real chat traffic still schedules a scan', () => {
  const pane = node('pane');
  const status = node('cle-status', pane);
  const bubble = node('chat-bubble', pane);
  // a new message appeared
  assert.equal(shouldRescan({target: pane, addedNodes: [bubble], removedNodes: []}, isOurs), true);
  // the app re-rendered the indicator (mixed nodes: real + ours)
  assert.equal(shouldRescan({target: pane, addedNodes: [bubble, status], removedNodes: []}, isOurs), true);
  // an attribute-only record on a real element
  assert.equal(shouldRescan({target: bubble, addedNodes: [], removedNodes: []}, isOurs), true);
});

test('two panes keep two runs: one pane finishing does not clear the other', () => {
  const runs = new Map();
  const a = newRun(0);
  const b = newRun(0);
  runs.set('agent:main:main', a);
  runs.set('agent:project:main', b);

  applyEvent(a, {sessionKey: 'agent:main:main', stream: 'tool', data: {phase: 'start', name: 'read', toolCallId: 'x', args: {path: '/a'}}}, 10);
  applyEvent(b, {sessionKey: 'agent:project:main', stream: 'tool', data: {phase: 'start', name: 'exec', toolCallId: 'y', args: {command: 'make'}}}, 10);

  assert.equal(pace(a, 100).kind, 'read');
  assert.equal(pace(b, 100).kind, 'exec');

  applyEvent(a, {sessionKey: 'agent:main:main', stream: 'lifecycle', data: {phase: 'end'}}, 200);
  assert.equal(a.on, false);
  assert.equal(b.on, true, 'the other pane keeps working');
  assert.equal(pace(b, 300).kind, 'exec', 'and keeps its own step');
});

test('an event for a session that is not on screen is kept, not dropped onto the active pane', () => {
  const runs = new Map();
  const hidden = newRun(0);
  runs.set('agent:thinking:main', hidden);
  applyEvent(hidden, {sessionKey: 'agent:thinking:main', stream: 'tool', data: {phase: 'start', name: 'exec', toolCallId: 'z', args: {command: 'sleep 5'}}}, 5);
  assert.equal(runs.get('agent:thinking:main').queue.length, 1);
  assert.equal(runs.size, 1);
});

test('a run that was never started by an event still paces from the background stream', () => {
  const run = newRun(1000);
  assert.equal(pace(run, 1000).kind, 'think');
  applyEvent(run, {sessionKey: 'k', stream: 'assistant', data: {}}, 1100);
  assert.equal(pace(run, 1100).kind, 'reply');
});

test('a finished run is not yanked the moment the indicator disappears', () => {
  // Reproduces the ordering the app really has: lifecycle end arrives first, the working
  // indicator is removed, and only then does the turn get re-rendered. The status line must
  // survive that gap, otherwise the 落款 would be thrown away before it can play.
  const run = newRun(0);
  applyEvent(run, {sessionKey: 'k', stream: 'lifecycle', data: {phase: 'end'}}, 1000);
  assert.equal(run.on, false);
  assert.equal(run.until, 0, 'no hold is set until the view decides');
});

test('shouldRescan treats an attribute-only record on real content as traffic', () => {
  const pane = node('pane');
  const bubble = node('chat-bubble', pane);
  assert.equal(shouldRescan({target: bubble, addedNodes: [], removedNodes: []}, isOurs), true);
  assert.equal(shouldRescan(null, isOurs), false);
});
