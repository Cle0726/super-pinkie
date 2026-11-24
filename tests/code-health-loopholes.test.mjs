// M0 返工：每个棘轮口子一个反例。修之前这些情形都能静默通过，修之后必须失败。
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {compareBaselines} from '../tools/health/compare-baseline.mjs';
import {measure} from '../tools/health/measure.mjs';
import {adoptUnmeasured, healthChanges, syncBaseline} from '../tools/health/ratchet.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const metrics = (over = {}) => ({important: 0, lines: 10, mutationObservers: 0, setIntervals: 0, subtreeObserverCalls: 0, windowGlobals: 0,
  importantIndirect: 0, mutationObserverRefs: 0, observeUnclear: 0, setIntervalRefs: 0, windowGlobalsIndirect: 0, ...over});
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

// ---- L1–L4、L5a/b、L6：在临时目录里放一个干净的小仓库，量一次当基线，再放进反例看棘轮是否变红 ----
const CLEAN = {
  'ui/injections/laolao-night.css': '.night { color: red; }\n',
  'ui/injections/laolao-head.fragment.html': '<link rel="stylesheet" href="laolao-night.css?v=@hash">\n',
};
const filler = n => Array.from({length: n}, (_, i) => `// ${i}`).join('\n') + '\n';
const BAD = 'x.style.color = "red !important";\nnew MutationObserver(f);\nsetInterval(f, 9);\nwindow.__bypass = 1;\n';

function writeFiles(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, text);
  }
}
function scratch(t, files = CLEAN) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-loophole-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  writeFiles(dir, files);
  return dir;
}
const quick = dir => measure(dir, {includeTestInventory: false});
// 干净仓库量出来的就是基线；放进反例后再量，返回棘轮报的增长。
async function growthAfter(t, probe) {
  const dir = scratch(t);
  const baseline = structuredClone(await quick(dir));
  writeFiles(dir, probe);
  const current = await quick(dir);
  return {current, increases: healthChanges(current, baseline).increases};
}
const mentions = (increases, file) => increases.filter(message => message.startsWith(`${file}：`));

test('L1：ui/party 等别的 UI 目录里的新文件要量（超长、!important、观察器、定时器、全局名）', async t => {
  const file = 'ui/party/audit-probe.js';
  const {current, increases} = await growthAfter(t, {[file]: BAD + filler(1600)});
  assert.ok(current.otherUi[file], 'ui/party 下的文件应记在 otherUi 一节');
  const hits = mentions(increases, file).join('\n');
  for (const label of ['行数', '!important', 'MutationObserver（变化观察器）', 'setInterval（定时器）', 'window.__ 全局名']) {
    assert.ok(hits.includes(label), `缺少 ${label}：\n${hits}`);
  }
});

test('L2：以前没扫的目录（scripts/、根目录脚本）里新增超 1500 行的源码要失败', async t => {
  const {increases} = await growthAfter(t, {'scripts/audit-probe.js': filler(1600), 'audit-probe.ps1': filler(1600)});
  assert.equal(mentions(increases, 'scripts/audit-probe.js').length, 1, increases.join('\n'));
  assert.equal(mentions(increases, 'audit-probe.ps1').length, 1, increases.join('\n'));
});

test('L3：laolao-vendor-* 和 vendor/ 目录不再自动跳过；清单里写了但不存在的路径报错', async t => {
  const probe = {
    'ui/injections/laolao-vendor-audit-probe.js': BAD + '.observe(document, {subtree: true});\nconst u = "a.js?v=manual99";\n' + filler(1600),
    'ui/injections/vendor/audit-probe.js': BAD,
  };
  const {increases} = await growthAfter(t, probe);
  for (const file of Object.keys(probe)) assert.ok(mentions(increases, file).length >= 4, `${file}：\n${increases.join('\n')}`);
  assert.ok(increases.some(message => message.includes('其他 UI 文件里的手写版本号')), increases.join('\n'));

  const dir = scratch(t, {...CLEAN, 'tools/health/third-party.json': JSON.stringify({paths: [
    {path: 'ui/injections/laolao-vendor-gone.js', kind: 'third-party', reason: '反例'},
  ]})});
  await assert.rejects(quick(dir), /不量清单里写了但不存在：ui\/injections\/laolao-vendor-gone\.js/);
});

test('L4a：注释拆开或转义写出的 !important 要数（不增加行数）', async t => {
  const file = 'ui/injections/laolao-night.css';
  const {current, increases} = await growthAfter(t, {[file]: '.night { color: red; }.p{color:red!/*x*/important}.q{color:red!\\69 mportant}\n'});
  assert.equal(current.injections[file].lines, 1);
  assert.equal(current.injections[file].importantIndirect, 2);
  assert.equal(mentions(increases, file).length, 1, increases.join('\n'));
  assert.match(increases[0], /绕开字面的 !important/);
});

test('L4b：setProperty important、限定名观察器、变量传 observe 选项、方括号定时器、globalThis/||= 全局名、拼接版本号都要数', async t => {
  const file = 'ui/injections/laolao-audit-alt.js';
  const {current, increases} = await growthAfter(t, {[file]: [
    'el.style.setProperty("color", "red", "important");',
    'const opts = {subtree: true}; new window.MutationObserver(fn).observe(document.documentElement, opts);',
    'window["setInterval"](fn, 100);',
    'globalThis.__bypassA = 1;',
    'window.__bypassB ||= 1;',
    "const u = 'foo.js?v=' + 'hand123';",
  ].join('\n') + '\n'});
  const m = current.injections[file];
  assert.deepEqual({importantIndirect: m.importantIndirect, mutationObserverRefs: m.mutationObserverRefs, observeUnclear: m.observeUnclear,
    setIntervalRefs: m.setIntervalRefs, windowGlobalsIndirect: m.windowGlobalsIndirect},
  {importantIndirect: 1, mutationObserverRefs: 1, observeUnclear: 1, setIntervalRefs: 1, windowGlobalsIndirect: 2});
  assert.equal(current.manualVersions.total, 1);
  assert.equal(mentions(increases, file).length, 5, increases.join('\n'));
  assert.ok(increases.some(message => message.startsWith('手写版本号总数增加')), increases.join('\n'));
});

test('L6：要量的文件含 NUL 或不是 UTF-8 时直接报错，不静默跳过', async t => {
  const nul = scratch(t, {...CLEAN, 'ui/injections/laolao-audit-null.js': '// \0\n' + BAD});
  await assert.rejects(quick(nul), /laolao-audit-null\.js 含 NUL 字节/);
  const latin = scratch(t, CLEAN);
  fs.mkdirSync(path.join(latin, 'scripts'));
  fs.writeFileSync(path.join(latin, 'scripts/latin1.py'), Buffer.from([0x23, 0x20, 0xe9, 0x0a]));
  await assert.rejects(quick(latin), /scripts\/latin1\.py 不是 UTF-8/);
});

test('L5a/L5b：和目标分支比，手改基线抬高、补进的数字高于实测、新增或抬高例外、清单盖住量过的文件都要失败', async t => {
  const dir = scratch(t, {...CLEAN, 'ui/party/party.css': '.p { color: red !important; }\n'});
  const measured = await quick(dir);
  const target = structuredClone(measured);
  delete target.otherUi; delete target.otherUiTotals; delete target.pageVersions; // 目标分支还没量过这些
  const base = {prBaseline: measured, targetBaseline: target, targetMeasured: measured, prMeasured: measured,
    prExceptions: [], targetExceptions: [], prSkipped: [], targetSkipped: [], targetHasList: true};
  assert.deepEqual(compareBaselines(base).failures, []);

  const raised = structuredClone(measured);
  raised.injections['ui/injections/laolao-night.css'].important = 1;
  raised.injectionTotals.important += 1;
  assert.match(compareBaselines({...base, prBaseline: raised}).failures.join('\n'), /基线被抬高：injections › ui\/injections\/laolao-night\.css › important/);

  const adopted = structuredClone(measured);
  adopted.otherUi['ui/party/party.css'].important = 9;
  adopted.otherUiTotals.important = 9;
  assert.match(compareBaselines({...base, prBaseline: adopted}).failures.join('\n'), /新补进基线的数字高于目标分支实测：otherUi › ui\/party\/party\.css › important（目标分支实测 1 → PR 基线 9）/);

  const sumless = structuredClone(measured);
  sumless.injectionTotals.important = 0;
  sumless.injections['ui/injections/laolao-night.css'].important = 0;
  sumless.injectionTotals.important = 5;
  assert.match(compareBaselines({...base, prBaseline: sumless}).failures.join('\n'), /不等于逐文件之和/);

  const night = 'ui/injections/laolao-night.css';
  const added = compareBaselines({...base, prExceptions: [exception(night, 'important', 1)]}).failures;
  assert.match(added.join('\n'), /新增例外，需协调者逐条认可/);
  const higher = compareBaselines({...base, targetExceptions: [exception(night, 'important', 1)], prExceptions: [exception(night, 'important', 2)]}).failures;
  assert.match(higher.join('\n'), /抬高例外，需协调者逐条认可.*1 → 2/);

  assert.match(compareBaselines({...base, prSkipped: ['ui/injections/']}).failures.join('\n'), /不量清单盖住了目标分支量过的文件：ui\/injections\//);
  assert.match(compareBaselines({...base, prSkipped: ['ui/party/']}).failures.join('\n'), /不量清单新增条目/);
});

test('--adopt-unmeasured 只补基线里没有的键，已有的数字一个都不动', () => {
  const file = 'ui/injections/a.css';
  const baseline = {injections: {[file]: {important: 1, lines: 10}}, longFiles: {}, tests: {total: 1}};
  const current = {injections: {[file]: metrics({important: 5, lines: 12, importantIndirect: 3})}, longFiles: {}, otherUi: {'ui/party/b.css': metrics()}, tests: {total: 9}};
  const adopted = adoptUnmeasured(current, baseline);
  assert.equal(adopted.injections[file].important, 1);
  assert.equal(adopted.injections[file].lines, 10);
  assert.equal(adopted.injections[file].importantIndirect, 3);
  assert.deepEqual(adopted.otherUi, current.otherUi);
  assert.deepEqual(adopted.tests, {total: 1});
});
