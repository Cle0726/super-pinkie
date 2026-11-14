// tools-health-1113 D4: pr_status reads the current branch's PR, checks and comments through gh; read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {prStatus, createPrStatusTool} from '../services/mode-architecture/pr-status.mjs';

const fakeGh = (res, seen = []) => async (args, opts) => { seen.push({args, opts}); return res; };

test('a PR with checks and comments is summarised; only `gh pr view` is run', async () => {
  const seen = [];
  const pr = {number: 7, title: 'fix', state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/7', headRefName: 'b', baseRefName: 'main',
    author: {login: 'kk'}, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', updatedAt: '2026-11-13T00:00:00Z',
    statusCheckRollup: [{name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'u1'}, {name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS'}, {name: 'build', status: 'IN_PROGRESS', conclusion: ''}],
    comments: [{author: {login: 'a'}, createdAt: '2026-11-12T00:00:00Z', body: 'please fix'}], reviews: [{author: {login: 'b'}, submittedAt: '2026-11-13T00:00:00Z', state: 'CHANGES_REQUESTED', body: 'nope'}]};
  const out = await prStatus({cwd: '/repo', gh: fakeGh({code: 0, stdout: JSON.stringify(pr), stderr: ''}, seen)});
  assert.deepEqual(seen[0].args.slice(0, 2), ['pr', 'view']);
  assert.equal(seen[0].opts.cwd, '/repo');
  assert.deepEqual([out.checks.total, out.checks.failed, out.checks.pending, out.checks.passed], [3, 1, 1, 1]);
  assert.deepEqual(out.comments.map(c => c.by), ['a', 'b']);
  assert.equal(out.review, 'REVIEW_REQUIRED');
});

test('no gh, not logged in, no PR: plain guidance, not an error', async () => {
  const missing = await prStatus({gh: fakeGh({code: 'ENOENT', stdout: '', stderr: ''})});
  assert.equal(missing.reason, 'gh-missing');
  assert.match(missing.message, /winget install --id GitHub\.cli/);
  assert.match(missing.message, /gh auth login/);
  const login = await prStatus({gh: fakeGh({code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login'})});
  assert.equal(login.reason, 'gh-login');
  const none = await prStatus({gh: fakeGh({code: 1, stdout: '', stderr: 'no pull requests found for branch "x"'})});
  assert.equal(none.none, true);
  const tool = createPrStatusTool({}, {rootFor: () => '/r', gh: fakeGh({code: 'ENOENT', stdout: '', stderr: ''})});
  assert.equal((await tool.execute('t', {})).isError, false);
});

test('the tool never asks gh to write', async () => {
  const seen = [];
  const tool = createPrStatusTool({}, {rootFor: () => '/r', gh: fakeGh({code: 1, stdout: '', stderr: 'no pull requests found'}, seen)});
  await tool.execute('t', {pr: 12});
  for (const {args} of seen) {
    assert.deepEqual(args.slice(0, 2), ['pr', 'view']);
    assert.ok(!args.some(a => /^(create|merge|comment|review|close|edit|push)$/.test(a)));
  }
  assert.equal(seen[0].args[2], '12');
});

test('real gh on this machine (skipped when gh is absent)', async (t) => {
  const out = await prStatus({cwd: process.cwd()});
  if (out.reason === 'gh-missing') return t.skip('no gh here');
  assert.ok(out.ok === true || ['gh-login', 'gh-error'].includes(out.reason), JSON.stringify(out));
});
