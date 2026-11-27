import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {formatMeasurement, measure, repoFiles} from '../tools/health/measure.mjs';
import {comparePatchLists, PATCH_LIST, patchApplyFileNames, patchListChanges, readPatchList} from '../tools/health/patch-list.mjs';
import {healthChanges, loadExceptions, readJson, SYNC_HINT} from '../tools/health/ratchet.mjs';

test('代码健康度：每个文件不能变差，改善后要同步基线', async () => {
  const baseline = readJson(new URL('../tools/health/baseline.json', import.meta.url));
  const exceptions = loadExceptions(fileURLToPath(new URL('..', import.meta.url)));
  const {increases, decreases, unused} = healthChanges(await measure(undefined, {includeTestInventory: false}), baseline, exceptions);
  const notes = [...increases, ...decreases, ...unused].map(message => `- ${message}`);
  if (decreases.length) notes.push(SYNC_HINT);
  if (notes.length) assert.fail(`代码健康度检查未通过：\n${notes.join('\n')}`);
});

test('测量口径：CRLF/LF 一致，只数独立全局名、观察子树设置和字面版本号', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-health-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const js = 'ui/injections/check.js';
  const sources = {
    [js]: [
      'window.__shared=1; window.__shared = 2;',
      'window.__notAssigned == 1; window.__notAssignedEither === 1;',
      'const watch = new MutationObserver(fn); void new MutationObserver;',
      'watch.observe(root, {childList: true, subtree:!0});',
      'root.getAnimations({subtree: true}); setInterval(fn, 10);',
      'const VERSION = "literal3";',
      'const href = `theme.css?v=${VERSION}`;',
      'const generated = "other.css?v=@hash";',
    ].join('\n') + '\n',
    'ui/injections/another.css': 'x { color: red !important; }',
    'ui/injections/laolao-vendor-sample.js': 'setInterval(fn, 1);',
    'ui/injections/laolao-katex/snapshot.js': 'setInterval(fn, 1);',
    'ui/injections/vendor/snapshot.js': 'setInterval(fn, 1);',
    'ui/injections/laolao-head.fragment.html': '<link href="theme.css?v=head2">\n',
    'tools/ui-parity/bundle.py': 'versions = ("old?v=x1", "new?v=x2")\n',
    'ui/runtime/index-example.js': 'import("./chat-page-name.js?v=chat1&h=aaaaaaaa"); import("./main.js?v=other");\n',
  };
  function writeFiles(eol) {
    for (const [file, text] of Object.entries(sources)) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, text.replaceAll('\n', eol));
    }
  }
  writeFiles('\n');
  const lf = await measure(dir);
  writeFiles('\r\n');
  assert.equal(formatMeasurement(await measure(dir)), formatMeasurement(lf));
  assert.deepEqual(lf.injections[js], {important: 0, lines: 8, mutationObservers: 2, setIntervals: 1, subtreeObserverCalls: 1, windowGlobals: 1,
    importantIndirect: 0, mutationObserverRefs: 0, observeUnclear: 0, setIntervalRefs: 0, windowGlobalsIndirect: 0});
  assert.equal(Object.keys(lf.injections).length, 3);
  assert.equal(lf.injections['ui/injections/another.css'].lines, 1);
  assert.deepEqual(lf.manualVersions.counts, {head: 1, injections: 1, runtime: 1, tooling: 2});
  assert.deepEqual(lf.manualVersions.occurrences.map(({value}) => value), ['x1', 'x2', 'literal3', 'head2', 'chat1']);
});

test('例外仅放行该文件的准确计数；新文件上限、全仓版本总量及缩小后的同步仍生效', () => {
  const empty = {injections: {}, longFiles: {}, manualVersions: {total: 0, occurrences: []}};
  const file = 'services/example.mjs', versionFile = 'tools/ui-parity/bundle.py';
  const current = {...empty, longFiles: {[file]: 1501}, manualVersions: {total: 1, occurrences: [{file: versionFile}]}};
  const exception = (file, metric, value) => ({file, metric, value, reason: '对照测试'});
  assert.equal(healthChanges(current, empty).increases.length, 2);
  assert.equal(healthChanges(current, empty, [exception(file, 'lines', 1502)]).increases.length, 2);
  assert.deepEqual(healthChanges(current, empty, [exception(file, 'lines', 1501), exception(versionFile, 'manualVersions', 1)]), {increases: [], decreases: [], unused: []});
  assert.equal(healthChanges(empty, current).decreases.length, 2);
});

test('L78：patch/apply-*.mjs 只许减少、不许新增（按 tools/health/patch-files.json 的名字比）', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const listed = readPatchList(root);
  assert.ok(Array.isArray(listed), `缺少 ${PATCH_LIST}`);
  const {added, removed} = patchListChanges(patchApplyFileNames(root, repoFiles(root)), listed);
  const notes = [...added, ...removed].map(message => `- ${message}`);
  if (notes.length) assert.fail(`补丁清单检查未通过：\n${notes.join('\n')}`);
});

test('补丁清单口径：新增、删一加一、删了文件不改清单、去掉清单都拦得住；和目标分支比不许多出名字', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-patches-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const file of ['patch/apply-a.mjs', 'patch/apply-b.mjs', 'patch/lib-x.mjs', 'patch/sub/apply-c.mjs', 'patch/apply-d.js']) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
    fs.writeFileSync(path.join(dir, file), '');
  }
  const files = patchApplyFileNames(dir, repoFiles(dir));
  assert.deepEqual(files, ['patch/apply-a.mjs', 'patch/apply-b.mjs'], '只数 patch/ 顶层的 apply-*.mjs');
  const list = ['patch/apply-a.mjs', 'patch/apply-b.mjs'];
  assert.deepEqual(patchListChanges(files, list), {added: [], removed: []});
  assert.match(patchListChanges([...files, 'patch/apply-new.mjs'], list).added.join('\n'), /patch\/apply-new\.mjs：新增了内核补丁。改内核行为一律去 cle-core 改/);
  const swapped = patchListChanges(['patch/apply-a.mjs', 'patch/apply-new.mjs'], list);
  assert.equal(swapped.added.length, 1, '删一个再加一个，个数不变也要拦');
  assert.equal(swapped.removed.length, 1);
  assert.match(patchListChanges(['patch/apply-a.mjs'], list).removed.join('\n'), /patch\/apply-b\.mjs：补丁文件已经删了，请从 tools\/health\/patch-files\.json 删掉这一行/);
  assert.equal(patchListChanges(files, null).added.length, 1, '整个去掉清单不能放行');

  assert.equal(readPatchList(dir), null);
  fs.mkdirSync(path.join(dir, 'tools/health'), {recursive: true});
  fs.writeFileSync(path.join(dir, PATCH_LIST), JSON.stringify({files: ['patch/apply-a.mjs', 'patch/apply-a.mjs']}));
  assert.throws(() => readPatchList(dir), /重复登记/);
  fs.writeFileSync(path.join(dir, PATCH_LIST), '﻿' + JSON.stringify({files: ['patch/lib-x.mjs']}));
  assert.throws(() => readPatchList(dir), /必须是 patch\/apply-\*\.mjs/);
  fs.writeFileSync(path.join(dir, PATCH_LIST), JSON.stringify({files: list}));
  assert.deepEqual(readPatchList(dir), list);

  const target = {targetList: list, targetFiles: files};
  assert.deepEqual(comparePatchLists({prList: list, ...target}), {failures: [], notes: []});
  assert.match(comparePatchLists({prList: [...list, 'patch/apply-new.mjs'], ...target}).failures.join('\n'), /新增登记：patch\/apply-new\.mjs/);
  const shrunk = comparePatchLists({prList: ['patch/apply-a.mjs'], ...target});
  assert.deepEqual(shrunk.failures, []);
  assert.match(shrunk.notes.join('\n'), /补丁清单减少：patch\/apply-b\.mjs/);
  assert.match(comparePatchLists({prList: null, ...target}).failures.join('\n'), /删掉了 tools\/health\/patch-files\.json/);
  // 目标分支还没有清单（本 PR 首次引入）：名字必须是目标分支上真有的补丁文件。
  assert.deepEqual(comparePatchLists({prList: list, targetList: null, targetFiles: files}).failures, []);
  assert.match(comparePatchLists({prList: [...list, 'patch/apply-new.mjs'], targetList: null, targetFiles: files}).failures.join('\n'), /登记了目标分支上没有的补丁：patch\/apply-new\.mjs/);
});
