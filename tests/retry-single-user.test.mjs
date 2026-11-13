import test from 'node:test';
import assert from 'node:assert/strict';
import {transform, marker} from '../patch/apply-retry-single-user.mjs';

const attempt = [
  'async function runEmbeddedAttempt(params) {',
  '\t\t\tconst preparedUserTurnMessage = await params.userTurnTranscriptRecorder?.resolveMessage();',
  '\t\t\tawait lock(async () => {',
  '\t\t\t\tconst x = 1;',
  '\t\t\t\tconst leafEntry = isRawModelRun ? null : sessionManager.getLeafEntry();',
  '\t\t\t\tif (leafEntry?.type === "message" && leafEntry.message.role === "user") {',
  '\t\t\t\t\tlog$2.warn("orphan");',
  '\t\t\t\t}',
  '\t\t\t});',
  '}',
].join('\n');

function block(out) {
  const start = out.indexOf(marker);
  const end = out.indexOf('\t\t\t\tconst leafEntry = isRawModelRun');
  return out.slice(start, end);
}

// Small model of the pi SessionManager tree: entries by id, a leaf pointer,
// and the active branch read from the leaf back to the root.
function sessionManager(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let leafId = entries.at(-1)?.id ?? null;
  return {
    getLeafEntry: () => (leafId ? byId.get(leafId) : undefined),
    getEntry: (id) => byId.get(id),
    branch: (id) => { if (!byId.has(id)) throw new Error('missing'); leafId = id; },
    resetLeaf: () => { leafId = null; },
    append(message) { const id = `n${byId.size}`; byId.set(id, {id, parentId: leafId, type: 'message', message}); leafId = id; },
    branchPath() { const out = []; let id = leafId; while (id) { const e = byId.get(id); out.unshift(e); id = e.parentId; } return out; },
    buildSessionContext() { return {messages: this.branchPath().filter((e) => e.type === 'message').map((e) => e.message)}; },
  };
}

function run(out, sm, {key = 'run-1:user', suppress = false} = {}) {
  const warnings = [];
  const activeSession = {agent: {state: {messages: null}}};
  const fn = new Function('params', 'preparedUserTurnMessage', 'isRawModelRun', 'sessionManager', 'activeSession', 'log$2', block(out));
  fn({runId: 'r', sessionId: 's', suppressNextUserMessagePersistence: suppress}, {role: 'user', content: '你好', idempotencyKey: key}, false, sm, activeSession, {warn: (m) => warnings.push(m)});
  return {warnings, activeSession};
}

const failedAttempt = (assistantContent = [{type: 'text', text: '[assistant turn failed before producing content]'}], userKey = 'run-1:user') => [
  {id: 'c1', parentId: null, type: 'custom'},
  {id: 'u1', parentId: 'c1', type: 'message', message: {role: 'user', content: '你好', idempotencyKey: userKey}},
  {id: 'a1', parentId: 'u1', type: 'message', message: {role: 'assistant', content: assistantContent, stopReason: 'error', errorMessage: '503 auth_unavailable'}},
];

test('patch inserts once, before the orphan-user repair, and is idempotent', () => {
  const out = transform(attempt);
  assert.equal(out.split(marker).length, 2);
  assert.ok(out.indexOf(marker) < out.indexOf('const leafEntry = isRawModelRun'));
  assert.equal(transform(out), out);
});

test('refuses unknown attempt shapes instead of guessing', () => {
  assert.throws(() => transform(attempt.replace('const leafEntry = isRawModelRun ? null : sessionManager.getLeafEntry();', 'const leafEntry = sessionManager.getLeafEntry();')), /structure changed/);
  assert.throws(() => transform(attempt.replace('const preparedUserTurnMessage = await', 'const prepared = await')), /prepared user turn/);
});

test('same-send retry after an empty failure leaves exactly one user message', () => {
  const out = transform(attempt);
  const sm = sessionManager(failedAttempt());
  const {warnings, activeSession} = run(out, sm);
  assert.equal(warnings.length, 1);
  assert.deepEqual(activeSession.agent.state.messages, [], 'model context no longer carries the failed copy');
  sm.append({role: 'user', content: '你好', idempotencyKey: 'run-1:user'});
  sm.append({role: 'assistant', content: [], stopReason: 'error'});
  const users = sm.branchPath().filter((e) => e.message?.role === 'user');
  assert.equal(users.length, 1, 'history (active branch) shows the user turn once');
  assert.equal(sm.branchPath().filter((e) => e.message?.role === 'assistant').length, 1, 'and one failure');
});

test('empty content array also counts as failed-before-content', () => {
  const sm = sessionManager(failedAttempt([]));
  run(transform(attempt), sm);
  assert.equal(sm.getLeafEntry().id, 'c1');
});

test('keeps a failed attempt that produced visible text or tool calls', () => {
  for (const content of [[{type: 'text', text: '先查一下天气'}], [{type: 'toolCall', name: 'web_search'}]]) {
    const sm = sessionManager(failedAttempt(content));
    const {warnings} = run(transform(attempt), sm);
    assert.equal(warnings.length, 0);
    assert.equal(sm.getLeafEntry().id, 'a1');
  }
});

test('a fresh send of the same words (different idempotencyKey) is left alone', () => {
  const sm = sessionManager(failedAttempt(undefined, 'run-0:user'));
  run(transform(attempt), sm);
  assert.equal(sm.getLeafEntry().id, 'a1');
});

test('never drops the user turn when this attempt will not re-persist it', () => {
  const sm = sessionManager(failedAttempt());
  run(transform(attempt), sm, {suppress: true});
  assert.equal(sm.getLeafEntry().id, 'a1');
});

test('first user message of a session resets the leaf to the root', () => {
  const entries = failedAttempt().slice(1).map((e) => (e.id === 'u1' ? {...e, parentId: null} : e));
  const sm = sessionManager(entries);
  run(transform(attempt), sm);
  assert.equal(sm.getLeafEntry(), undefined);
});
