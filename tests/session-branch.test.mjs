import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {BUSY, SessionBranches, feedbackState, latestLeafUnder, recordFeedback, variantsOf}
  from '../services/mode-architecture/session-branch.mjs';

const msg = (id, parentId, role, content) => ({type: 'message', id, parentId, message: {role, content}});
const custom = (id, parentId) => ({type: 'custom', id, parentId});

// In-memory stand-in for OpenClaw's SessionManager: entries in a jsonl file, the
// leaf kept in a sidecar so reopening sees the persisted leaf.
class FakeSessionManager {
  static open(file) { return new FakeSessionManager(file); }
  constructor(file) {
    this.file = file;
    this.entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const leafFile = file + '.leaf';
    this.leaf = fs.existsSync(leafFile) ? JSON.parse(fs.readFileSync(leafFile, 'utf8')) : this.entries.at(-1)?.id ?? null;
  }
  getEntries() { return this.entries; }
  getEntry(id) { return this.entries.find(entry => entry.id === id); }
  getLeafId() { return this.leaf; }
  getBranch() {
    const out = [];
    for (let id = this.leaf; id;) { const entry = this.getEntry(id); out.unshift(entry); id = entry.parentId; }
    return out;
  }
  branch(id) { if (!this.getEntry(id)) throw new Error('missing'); this.leaf = id; }
  resetLeaf() { this.leaf = null; }
  rewriteFile() { fs.writeFileSync(this.file + '.leaf', JSON.stringify(this.leaf)); }
}

function fixture(t, rows, {entry = {}, busy = false, send} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-branch-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const transcript = path.join(dir, 's.jsonl');
  fs.writeFileSync(transcript, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const calls = [];
  const access = {
    entry: async () => ({key: 'agent:main:a', sessionId: 's', transcript, ...entry}),
    sdk: async name => name === 'agent-sessions' ? {SessionManager: FakeSessionManager}
      : {acquireSessionWriteLock: async () => ({release: async () => {}})},
    rpc: async (method, params) => {
      calls.push([method, params]);
      if (method === 'sessions.list') return {sessions: [{key: 'agent:main:a', hasActiveRun: busy}]};
      if (method === 'chat.send') return send ? send(params) : {runId: 'run-1'};
      if (method === 'agent.wait') return {status: 'ok'};
      return {};
    },
  };
  const branches = new SessionBranches({}, {access, root: dir});
  const leaf = () => FakeSessionManager.open(transcript).getLeafId();
  return {dir, branches, calls, leaf};
}

const tree = [
  custom('c0', null),
  msg('u1', 'c0', 'user', '第一问'),
  msg('a1', 'u1', 'assistant', [{type: 'text', text: '第一答'}]),
  custom('c1', 'a1'), msg('u2', 'c1', 'user', '第二问'),
  msg('a2', 'u2', 'assistant', [{type: 'text', text: '第二答'}]),
  custom('c2', 'a1'), msg('u2b', 'c2', 'user', '第二问改'),
  msg('a2b', 'u2b', 'assistant', [{type: 'text', text: '改后答'}]),
];

test('variants group user messages that follow the same reply, across bookkeeping entries', () => {
  const branch = [tree[0], tree[1], tree[2], tree[6], tree[7], tree[8]];
  assert.deepEqual(variantsOf(tree, branch), [{entryId: 'u2b', index: 2, total: 2, siblings: ['u2', 'u2b']}]);
  assert.equal(latestLeafUnder(tree, 'u2'), 'a2');
  assert.equal(latestLeafUnder(tree, 'u2b'), 'a2b');
});

test('edit moves the leaf before the message and sends the new text as a sibling', async t => {
  const f = fixture(t, tree.slice(0, 6));
  const result = await f.branches.edit('agent:main:a', 'u2', '新的第二问');
  assert.deepEqual(result, {ok: true, runId: 'run-1'});
  assert.equal(f.leaf(), 'c1');
  const send = f.calls.find(([method]) => method === 'chat.send')[1];
  assert.equal(send.message, '新的第二问');
  assert.equal(send.sessionKey, 'agent:main:a');
});

test('editing the first message resets the leaf to the root', async t => {
  const f = fixture(t, [msg('u1', null, 'user', '只有一问'), msg('a1', 'u1', 'assistant', '答')]);
  await f.branches.edit('agent:main:a', 'u1', '换个问法');
  assert.equal(f.leaf(), null);
});

test('a refused send restores the previous leaf', async t => {
  const f = fixture(t, tree.slice(0, 6), {send: () => ({status: 'error'})});
  await assert.rejects(f.branches.edit('agent:main:a', 'u2', '新'), /原来的内容已恢复/);
  assert.equal(f.leaf(), 'a2');
});

test('a running session, a channel session and a message off the branch are refused', async t => {
  const busy = fixture(t, tree.slice(0, 6), {busy: true});
  await assert.rejects(busy.branches.edit('agent:main:a', 'u2', '新'), new RegExp(BUSY));
  await assert.rejects(busy.branches.switchTo('agent:main:a', 'u2'), new RegExp(BUSY));
  const channel = fixture(t, tree.slice(0, 6), {entry: {channel: 'wechat', origin: {provider: 'wechat'}, displayName: '微信'}});
  channel.branches.entryFor = async () => { throw new Error('渠道会话撤不回已发出的消息，不能改'); };
  await assert.rejects(channel.branches.edit('agent:main:a', 'u2', '新'), /渠道会话/);
  const f = fixture(t, tree);
  await assert.rejects(f.branches.edit('agent:main:a', 'u2', '新'), /找不到当前分支/);
});

test('switch goes to the newest leaf under the chosen sibling and back', async t => {
  const f = fixture(t, tree);
  assert.equal(f.leaf(), 'a2b');
  await f.branches.switchTo('agent:main:a', 'u2');
  assert.equal(f.leaf(), 'a2');
  const {items} = await f.branches.variants('agent:main:a');
  assert.deepEqual(items.map(item => [item.entryId, item.index, item.total]), [['u2', 1, 2]]);
  await f.branches.switchTo('agent:main:a', 'u2b');
  assert.equal(f.leaf(), 'a2b');
});

test('regenerate resends the original text and a one-off model is put back afterwards', async t => {
  const f = fixture(t, tree.slice(0, 6), {entry: {modelOverride: 'gpt-x', providerOverride: 'relay'}});
  await f.branches.regenerate('agent:main:a', 'u2', 'other/model-b');
  assert.equal(f.calls.find(([method]) => method === 'chat.send')[1].message, '第二问');
  await new Promise(resolve => setTimeout(resolve, 20));
  const patches = f.calls.filter(([method]) => method === 'sessions.patch').map(([, params]) => params.model);
  assert.deepEqual(patches, ['other/model-b', 'relay/gpt-x']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'session-branch-restore.json'), 'utf8')), {});
});

test('feedback is appended and the latest rating per message wins', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-feedback-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  recordFeedback(dir, {key: 'agent:main:a', entryId: 'a1', rating: 'down', note: '太长'});
  recordFeedback(dir, {key: 'agent:main:a', entryId: 'a2', rating: 'up'});
  recordFeedback(dir, {key: 'agent:main:a', entryId: 'a2', rating: null});
  assert.deepEqual(feedbackState(dir, 'agent:main:a').ratings, {a1: 'down'});
  assert.throws(() => recordFeedback(dir, {key: 'agent:main:a', entryId: 'a1', rating: 'meh'}), /评价不对/);
});
