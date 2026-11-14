// tools-health-1113 D2: project-mode children of a git project each get their own worktree and branch;
// the parent hears the branch names; untouched worktrees are cleaned; nothing is merged or pushed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SessionLineage} from '../services/mode-architecture/session-lineage.mjs';
import {isGitRepo, prepareChildWorktree} from '../services/mode-architecture/child-worktree.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8'}).trim();
const parent = 'agent:project:dashboard:parent';

function repo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-wt-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const root = path.join(base, 'proj');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.invalid');
  git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'shared.txt'), 'v0\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'init');
  return {base, root};
}

// Stands in for OpenClaw's managed worktree service (worktrees.create / worktrees.remove) with real git.
function fixture(t, root, base) {
  const entries = new Map(), bindings = new Map(), sent = [], calls = [], trees = new Map();
  const add = (key, props = {}) => entries.set(key, {key, sessionId: 'id-' + key, label: '项目', ...props});
  add(parent);
  bindings.set(parent, {root, name: '项目'});
  const access = {
    entry: async key => entries.get(key) || null,
    list: async () => ({entries: Object.fromEntries(entries), dir: base}),
    async rpc(method, params, options) {
      calls.push([method, params, options]);
      if (method === 'sessions.list') return {sessions: [...entries.values()]};
      if (method === 'sessions.create') { add(params.key, {parentSessionKey: params.parentSessionKey, label: params.label}); return {key: params.key, sessionId: 'id-' + params.key}; }
      if (method === 'pinkie.project.bind') { if (params.path) bindings.set(params.key, {root: params.path, name: params.name}); return {binding: bindings.get(params.key) || null}; }
      if (method === 'chat.send') { sent.push(params); return {status: 'started', runId: params.idempotencyKey}; }
      if (method === 'sessions.patch') return {ok: true};
      if (method === 'worktrees.create') {
        assert.deepEqual(options, {admin: true});
        // Like the real service (checked live 11-13): baseRef comes back as the literal "HEAD".
        const wtPath = path.join(base, 'worktrees', params.name), branch = 'openclaw/' + params.name, baseRef = 'HEAD';
        git(params.repoRoot, 'worktree', 'add', '-q', '-b', branch, wtPath, baseRef);
        const record = {id: 'wt-' + params.name, path: wtPath, branch, baseRef, repoRoot: params.repoRoot};
        trees.set(record.id, record);
        return record;
      }
      if (method === 'worktrees.remove') {
        const record = trees.get(params.id);
        git(record.repoRoot, 'worktree', 'remove', '--force', record.path);
        git(record.repoRoot, 'branch', '-D', record.branch);
        return {removed: true};
      }
      throw new Error('unexpected RPC ' + method);
    },
  };
  const lineage = new SessionLineage({logger: {warn() {}}}, {root: base, titles: {access, record() {}}, isBusy: () => false, stopped: () => false,
    now: () => 10_000, schedule: () => ({unref() {}})});
  return {lineage, bindings, sent, calls, entries};
}

test('two children of a git project work in separate branches; parent gets both branch names; clean ones go', async t => {
  const {base, root} = repo(t);
  const f = fixture(t, root, base);
  const a = await f.lineage.start(parent, 'human', {title: '改文案 A', prompt: '改 shared.txt', initiation: 'user_asked'}, 'a');
  const b = await f.lineage.start(parent, 'human', {title: '改文案 B', prompt: '也改 shared.txt', initiation: 'user_asked'}, 'b');
  const wa = f.lineage.lineage()[a.key].worktree, wb = f.lineage.lineage()[b.key].worktree;
  assert.notEqual(wa.path, wb.path);
  assert.notEqual(wa.branch, wb.branch);
  assert.equal(f.bindings.get(a.key).root, wa.path, 'child A is bound to its own worktree');
  assert.equal(f.bindings.get(b.key).root, wb.path);
  assert.equal(f.bindings.get(parent).root, root, 'parent keeps the project folder');
  assert.ok(f.sent.find(s => s.sessionKey === a.key).message.includes(wa.branch), 'brief names the branch');

  // A edits and commits the same file B also touches; B leaves its copy alone.
  fs.writeFileSync(path.join(wa.path, 'shared.txt'), 'from A\n');
  git(wa.path, 'commit', '-qam', 'A');
  fs.writeFileSync(path.join(wb.path, 'shared.txt'), 'from B, not committed\n');
  assert.equal(fs.readFileSync(path.join(root, 'shared.txt'), 'utf8'), 'v0\n', 'project folder untouched');

  await f.lineage.report(a.key, f.lineage.lineage()[a.key], 'A 做完了', 'r1');
  await f.lineage.report(b.key, f.lineage.lineage()[b.key], 'B 做完了', 'r2');
  const cards = f.lineage.state(parent).cards.filter(c => c.kind === 'report');
  const text = cards.map(c => c.full || c.text).join('\n');
  assert.ok(text.includes(wa.branch) && text.includes(wb.branch), 'parent receives both branch names');
  assert.ok(fs.existsSync(wa.path) && fs.existsSync(wb.path), 'changed worktrees are kept');

  // A third child that changes nothing is cleaned when it reports, and goes back to the project folder.
  const c = await f.lineage.start(parent, 'human', {title: '只看看', prompt: '读一下', initiation: 'user_asked'}, 'c');
  const wc = f.lineage.lineage()[c.key].worktree;
  await f.lineage.report(c.key, f.lineage.lineage()[c.key], '看完了', 'r3');
  assert.equal(fs.existsSync(wc.path), false);
  assert.equal(git(root, 'branch', '--list', wc.branch), '');
  assert.equal(f.lineage.lineage()[c.key].worktree.removed, true);
  assert.equal(f.bindings.get(c.key).root, root);

  // Nothing merged, nothing pushed.
  assert.equal(git(root, 'log', '--format=%s', 'main'), 'init');
  assert.equal(git(root, 'remote'), '');
  assert.ok(!f.calls.some(([m, p]) => /merge|push/i.test(m + JSON.stringify(p || {}))));
});

test('no worktree outside project mode or outside a git repo', async t => {
  const {base, root} = repo(t);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-plain-'));
  t.after(() => fs.rmSync(plain, {recursive: true, force: true}));
  const rpc = async () => { throw new Error('should not be called'); };
  assert.equal(await isGitRepo(root), true);
  assert.equal(await isGitRepo(plain), false);
  assert.equal(await prepareChildWorktree({rpc, root: plain, mode: 'project', id: 'x'}), null);
  assert.equal(await prepareChildWorktree({rpc, root, mode: 'thinking', id: 'x'}), null);
});
