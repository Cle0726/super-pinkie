// M0 返工：每个棘轮口子一个反例。修之前这些情形都能静默通过，修之后必须失败。
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {healthChanges, syncBaseline} from '../tools/health/ratchet.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const metrics = (over = {}) => ({important: 0, lines: 10, mutationObservers: 0, setIntervals: 0, subtreeObserverCalls: 0, windowGlobals: 0, ...over});
const report = injections => ({
  injectionTotals: {important: 0, mutationObservers: 0, setIntervals: 0, subtreeObserverCalls: 0, windowGlobals: 0, windowGlobalsPerFileSum: 0},
  injections, longFiles: {}, manualVersions: {counts: {}, occurrences: [], total: 0}, patchApplyFiles: 0,
});
const exception = (file, metric, value) => ({file, metric, value, reason: '反例'});

test('L5c：没被用到的例外让检查失败', () => {
  const file = 'ui/injections/a.css';
  const same = report({[file]: metrics({important: 3})});
  const {increases, unused} = healthChanges(same, same, [exception(file, 'important', 999)]);
  assert.deepEqual(increases, []);
  assert.equal(unused.length, 1);
  assert.match(unused[0], /没有被用到/);
  // 正在用的例外不报
  const grown = report({[file]: metrics({important: 4})});
  assert.deepEqual(healthChanges(grown, same, [exception(file, 'important', 4)]).unused, []);
});

test('L7：--write-baseline 只写改善，例外的增长不写，已有数字一个都不升', () => {
  const a = 'ui/injections/a.css', b = 'ui/injections/b.js', fresh = 'ui/injections/new.js';
  const baseline = report({[a]: metrics({important: 5, lines: 100}), [b]: metrics({lines: 50})});
  baseline.tests = {total: 1};
  const current = report({
    [a]: metrics({important: 3, lines: 120}), // important 变好，lines 靠例外增长
    [b]: metrics({lines: 40, mutationObservers: 1}), // lines 变好，观察器靠例外
    [fresh]: metrics({lines: 7}),
  });
  current.tests = {total: 99};
  const exceptions = [exception(a, 'lines', 120), exception(b, 'mutationObservers', 1)];
  assert.deepEqual(healthChanges(current, baseline, exceptions).increases, []);
  const synced = syncBaseline(current, baseline);
  assert.deepEqual(synced.injections[a], metrics({important: 3, lines: 100}));
  assert.deepEqual(synced.injections[b], metrics({lines: 40}));
  assert.deepEqual(synced.injections[fresh], metrics({lines: 7}));
  assert.deepEqual(synced.tests, {total: 1});
  // 同步后例外仍然放行，检查依旧通过
  assert.deepEqual(healthChanges(current, synced, exceptions), {increases: [], decreases: [], unused: []});
});

test('hotspots：浅克隆直接报错退出 1，不输出少算的表', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-hotspots-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const env = {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', HOME: dir, USERPROFILE: dir};
  const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8'});
  const origin = path.join(dir, 'origin'), clone = path.join(dir, 'clone');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q');
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(origin, 'a.js'), `// ${n}\n`);
    git(origin, 'add', 'a.js');
    git(origin, 'commit', '-q', '-m', `fix: ${n}`);
  }
  git(dir, 'clone', '-q', '--depth', '1', `file://${origin.replaceAll('\\', '/')}`, clone);
  assert.equal(git(clone, 'rev-parse', '--is-shallow-repository').trim(), 'true');
  fs.mkdirSync(path.join(clone, 'tools/health'), {recursive: true});
  fs.copyFileSync(path.join(ROOT, 'tools/health/hotspots.mjs'), path.join(clone, 'tools/health/hotspots.mjs'));
  const run = () => spawnSync(process.execPath, ['tools/health/hotspots.mjs'], {cwd: clone, env, encoding: 'utf8'});
  const shallow = run();
  assert.equal(shallow.status, 1);
  assert.match(shallow.stderr, /浅克隆/);
  assert.equal(shallow.stdout, '');
  git(clone, 'fetch', '-q', '--unshallow');
  const full = run();
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /命中 2 个修复类提交/);
});
