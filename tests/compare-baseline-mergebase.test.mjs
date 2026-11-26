// B38：目标分支在 PR 的 merge-base 之后缩了 PR 没改的文件，不能算 PR「抬高基线」；PR 真抬高的照样红。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {compareBaselines, mergeBaseInfo} from '../tools/health/compare-baseline.mjs';
import {injectionTotals} from '../tools/health/ratchet.mjs';

const metrics = (over = {}) => ({important: 0, lines: 10, mutationObservers: 0, setIntervals: 0, subtreeObserverCalls: 0, windowGlobals: 0,
  importantIndirect: 0, mutationObserverRefs: 0, observeUnclear: 0, setIntervalRefs: 0, windowGlobalsIndirect: 0, ...over});
const report = (injections, longFiles = {}) => ({
  injectionTotals: injectionTotals(injections, 0), injections, longFiles,
  manualVersions: {counts: {}, occurrences: [], total: 0}, patchApplyFiles: 0,
});
const A = 'ui/injections/a.js', B = 'ui/injections/b.css', LONG = 'services/mode-architecture/learning.mjs';
// merge-base：a.js 有 5 个 !important，learning.mjs 2501 行。目标分支之后把这两个都缩了。
const mergeBase = report({[A]: metrics({important: 5}), [B]: metrics({important: 1})}, {[LONG]: 2501});
const target = report({[A]: metrics({important: 3}), [B]: metrics({important: 1})}, {[LONG]: 2495});
const args = (prBaseline, extra = {}) => ({prBaseline, targetBaseline: target, targetMeasured: target, prMeasured: prBaseline,
  prExceptions: [], targetExceptions: [], prSkipped: [], targetSkipped: [], targetHasList: true, ...extra});

test('反例：目标分支缩了 PR 没改的文件，PR 基线还是 merge-base 的数字，不报抬高（合计也不报）', () => {
  const {failures, notes} = compareBaselines(args(structuredClone(mergeBase), {mergeBaseBaseline: mergeBase, changedFiles: ['ui/other.js']}));
  assert.deepEqual(failures, []);
  assert.match(notes.join('\n'), /不算抬高：longFiles › services\/mode-architecture\/learning\.mjs（目标分支 2495，PR 基线 2501，merge-base 2501）/);
  assert.match(notes.join('\n'), /不算抬高：injections › ui\/injections\/a\.js › important/);
  assert.match(notes.join('\n'), /合计项.*injectionTotals › important（目标分支 4 → PR 6）/);
});

test('没有 merge-base 信息时照旧逐项严格比（这就是 B38 以前的误报）', () => {
  const {failures} = compareBaselines(args(structuredClone(mergeBase)));
  assert.match(failures.join('\n'), /基线被抬高：longFiles › services\/mode-architecture\/learning\.mjs（目标分支 2495 → PR 2501）/);
  assert.match(failures.join('\n'), /基线被抬高：injectionTotals › important/);
});

test('正例：PR 改过的文件高于目标分支，照样报抬高', () => {
  const {failures} = compareBaselines(args(structuredClone(mergeBase), {mergeBaseBaseline: mergeBase, changedFiles: [LONG, A]}));
  assert.match(failures.join('\n'), /基线被抬高：longFiles › services\/mode-architecture\/learning\.mjs（目标分支 2495 → PR 2501）/);
  assert.match(failures.join('\n'), /基线被抬高：injections › ui\/injections\/a\.js › important（目标分支 3 → PR 5）/);
  assert.match(failures.join('\n'), /基线被抬高：injectionTotals › important（目标分支 4 → PR 6）/);
});

test('正例：PR 没改的文件，但基线手抬过 merge-base，照样报抬高', () => {
  const raised = report({[A]: metrics({important: 7}), [B]: metrics({important: 1})}, {[LONG]: 2600});
  const {failures} = compareBaselines(args(raised, {mergeBaseBaseline: mergeBase, changedFiles: ['ui/other.js']}));
  assert.match(failures.join('\n'), /基线被抬高：longFiles › services\/mode-architecture\/learning\.mjs（目标分支 2495 → PR 2600）/);
  assert.match(failures.join('\n'), /基线被抬高：injections › ui\/injections\/a\.js › important（目标分支 3 → PR 7）/);
  assert.match(failures.join('\n'), /基线被抬高：injectionTotals › important/);
});

test('正例：放过没改的文件，同时 PR 改过的另一个文件也抬了，合计只放宽没改文件那部分', () => {
  const pr = report({[A]: metrics({important: 5}), [B]: metrics({important: 2})}, {[LONG]: 2501});
  const {failures} = compareBaselines(args(pr, {mergeBaseBaseline: mergeBase, changedFiles: [B]}));
  assert.match(failures.join('\n'), /基线被抬高：injections › ui\/injections\/b\.css › important（目标分支 1 → PR 2）/);
  assert.match(failures.join('\n'), /基线被抬高：injectionTotals › important（目标分支 4 → PR 7，其中 2 是目标分支缩了 PR 没改的文件）/);
  assert.doesNotMatch(failures.join('\n'), /a\.js|learning\.mjs/);
});

const git = (cwd, ...cmd) => {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-C', cwd, ...cmd], {encoding: 'utf8'});
  assert.equal(run.status, 0, `git ${cmd.join(' ')}：${run.stderr}`);
  return run.stdout.trim();
};
const put = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
  fs.writeFileSync(path.join(root, file), text);
};

test('mergeBaseInfo：从 git 算出 merge-base 上的基线和 PR 改过的文件（含没跟踪的）；算不出就返回 null', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-b38-'));
  t.after(() => fs.rmSync(tmp, {recursive: true, force: true}));
  const repo = path.join(tmp, 'repo'), targetDir = path.join(tmp, 'target'), other = path.join(tmp, 'other');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  put(repo, 'tools/health/baseline.json', '﻿' + JSON.stringify({longFiles: {[LONG]: 2501}}));
  put(repo, LONG, 'a\n');
  put(repo, A, 'a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '-b', 'pr');
  put(repo, A, 'b\n');
  git(repo, 'commit', '-q', '-am', 'pr');
  git(repo, 'checkout', '-q', 'main');
  put(repo, LONG, 'shrunk\n');
  put(repo, 'tools/health/baseline.json', JSON.stringify({longFiles: {[LONG]: 2495}}));
  git(repo, 'commit', '-q', '-am', 'main shrinks');
  git(repo, 'worktree', 'add', '-q', '--detach', targetDir, 'main');
  git(repo, 'checkout', '-q', 'pr');
  put(repo, B, 'new\n'); // 没跟踪的新文件也算 PR 改过

  const info = mergeBaseInfo(repo, targetDir);
  assert.deepEqual(info.mergeBaseBaseline, {longFiles: {[LONG]: 2501}});
  assert.deepEqual(info.changedFiles, [A, B].sort());
  assert.match(info.note, new RegExp(`merge-base ${base.slice(0, 8)}`));

  fs.mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  put(other, 'x.txt', 'x\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'unrelated');
  const none = mergeBaseInfo(repo, other);
  assert.equal(none.mergeBaseBaseline, null);
  assert.equal(none.changedFiles, null);
  assert.match(none.note, /严格比/);
});
