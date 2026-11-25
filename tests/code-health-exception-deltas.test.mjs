import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {compareBaselines} from '../tools/health/compare-baseline.mjs';
import {EXCEPTION_DELTAS_DIR, EXCEPTIONS_FILE, exceptionsByMetric, healthChanges, loadExceptions} from '../tools/health/ratchet.mjs';

// exceptions.d/：每个 PR 自己一个增量文件，给 exceptions.json 已有的条目加数；同时开着的界面 PR 合并时不再冲突。
const HEAD = 'ui/injections/laolao-head.fragment.html';
const BASE = [{file: HEAD, metric: 'lines', value: 225, reason: '基础原因。'}];

function repo(t, files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'health-deltas-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const [name, value] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
    fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  }
  return dir;
}
const delta = (add, reason = '加两个新文件。', file = HEAD, metric = 'lines') => [{file, metric, add, reason}];
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

test('D1 没有 exceptions.d 时和以前完全一样；有增量时生效值 = value + add，原因接在后面', t => {
  const plain = repo(t, {[EXCEPTIONS_FILE]: BASE});
  assert.deepEqual(loadExceptions(plain), BASE);
  const dir = repo(t, {[EXCEPTIONS_FILE]: BASE, [`${EXCEPTION_DELTAS_DIR}/feat-a.json`]: delta(2, 'A 的两个文件。'), [`${EXCEPTION_DELTAS_DIR}/feat-b.json`]: delta(3, 'B 的三个文件。')});
  const [entry] = loadExceptions(dir);
  assert.equal(entry.value, 230);
  assert.match(entry.reason, /^基础原因。 A 的两个文件。（feat-a\.json，\+2） B 的三个文件。（feat-b\.json，\+3）$/);
  // 不改原数组（调用方可能复用）。
  assert.equal(BASE[0].value, 225);
});

test('D2 生效值照样是「准确计数」：多一行、少一行都不行', t => {
  const dir = repo(t, {[EXCEPTIONS_FILE]: BASE, [`${EXCEPTION_DELTAS_DIR}/feat-a.json`]: delta(2)});
  const exceptions = loadExceptions(dir);
  const baseline = {injections: {[HEAD]: {lines: 205}}, longFiles: {}};
  const at = lines => healthChanges({injections: {[HEAD]: {lines}}, longFiles: {}}, baseline, exceptions);
  assert.deepEqual(at(227).increases, []);
  assert.equal(at(228).increases.length, 1, '超出生效值要红');
  assert.match(at(226).unused.join('\n'), /没有被用到/, '少于生效值要提示删例外（准确计数）');
});

test('D3 坏增量一律报错：没有基础条目、add 不是正整数、没写原因、不是数组', t => {
  const bad = (content) => repo(t, {[EXCEPTIONS_FILE]: BASE, [`${EXCEPTION_DELTAS_DIR}/x.json`]: content});
  assert.throws(() => loadExceptions(bad(delta(2, '新文件', 'ui/injections/other.css'))), /没有基础条目；新例外要写进/);
  assert.throws(() => loadExceptions(bad(delta(2, '换指标', HEAD, 'important'))), /没有基础条目/);
  for (const add of [0, -1, 1.5, '2']) assert.throws(() => loadExceptions(bad(delta(add))), /add（正整数）/, String(add));
  assert.throws(() => loadExceptions(bad(delta(2, '  '))), /reason/);
  assert.throws(() => loadExceptions(bad({file: HEAD, metric: 'lines', add: 2, reason: 'r'})), /必须是数组/);
  // 正例：.json 以外的文件（说明、草稿）不读。
  const ok = repo(t, {[EXCEPTIONS_FILE]: BASE, [`${EXCEPTION_DELTAS_DIR}/README.md`]: 'not json'});
  assert.deepEqual(loadExceptions(ok), BASE);
});

test('D4 和目标分支比：增量照样算「抬高例外」，要协调者认可；目标分支已有的增量不算新抬高', t => {
  const target = repo(t, {[EXCEPTIONS_FILE]: BASE});
  const pr = repo(t, {[EXCEPTIONS_FILE]: BASE, [`${EXCEPTION_DELTAS_DIR}/feat-a.json`]: delta(2)});
  const empty = {injections: {}, longFiles: {}};
  const base = {prBaseline: empty, targetBaseline: empty, targetMeasured: empty, prMeasured: empty, prSkipped: [], targetSkipped: [], targetHasList: true};
  const raised = compareBaselines({...base, prExceptions: loadExceptions(pr), targetExceptions: loadExceptions(target)}).failures;
  assert.match(raised.join('\n'), /抬高例外，需协调者逐条认可.*225 → 227/);
  const same = compareBaselines({...base, prExceptions: loadExceptions(pr), targetExceptions: loadExceptions(pr)}).failures;
  assert.deepEqual(same, []);
  assert.equal(exceptionsByMetric(loadExceptions(pr)).get(`${HEAD}\0lines`), 227);
});

test('D5 两个分支各加一个增量文件，git 合并零冲突，合并后生效值是两边之和', t => {
  const dir = repo(t, {[EXCEPTIONS_FILE]: BASE});
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  for (const [branch, add] of [['feat-a', 2], ['feat-b', 3]]) {
    git(dir, 'checkout', '-q', '-b', branch, 'main');
    fs.mkdirSync(path.join(dir, EXCEPTION_DELTAS_DIR), {recursive: true});
    fs.writeFileSync(path.join(dir, EXCEPTION_DELTAS_DIR, `${branch}.json`), JSON.stringify(delta(add), null, 2) + '\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', branch);
    // 前提：在各自分支上，生效值只含自己那份。
    assert.equal(loadExceptions(dir)[0].value, 225 + add);
  }
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-edit', 'feat-a');
  git(dir, 'merge', '-q', '--no-edit', 'feat-b');
  assert.equal(git(dir, 'diff', '--name-only', '--diff-filter=U').trim(), '', '不能有冲突文件');
  assert.equal(loadExceptions(dir)[0].value, 230);
  // 反例：两边都去改 exceptions.json 同一条的 value，就会冲突（这正是要躲开的写法）。
  const root = git(dir, 'rev-list', '--max-parents=0', 'main').trim();
  for (const [branch, value] of [['old-c', 227], ['old-d', 228]]) {
    git(dir, 'checkout', '-q', '-b', branch, root);
    fs.writeFileSync(path.join(dir, EXCEPTIONS_FILE), JSON.stringify([{...BASE[0], value}], null, 2) + '\n');
    git(dir, 'commit', '-q', '-am', branch);
  }
  assert.throws(() => git(dir, 'merge', '-q', '--no-edit', 'old-c'));
  assert.equal(git(dir, 'diff', '--name-only', '--diff-filter=U').trim(), EXCEPTIONS_FILE);
  git(dir, 'merge', '--abort');
});
