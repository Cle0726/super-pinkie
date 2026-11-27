import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {formatMeasurement, measure, repoFiles} from '../tools/health/measure.mjs';
import {compareLoadedLists, comparePatchLists, LOAD_LISTS, loadedListChanges, loadedPatchNames, loadListEntries, PATCH_LIST, patchApplyFileNames,
  patchListChanges, readLoadedList, readPatchList} from '../tools/health/patch-list.mjs';
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

test('L86：加载名单（apply-all.mjs 的 ORDER、apply-theme.sh、install.sh）只许减少、不许新增（按 patch-files.json 的 loaded 比）', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const listed = readLoadedList(root);
  assert.ok(Array.isArray(listed), `${PATCH_LIST} 缺少 loaded`);
  const current = loadedPatchNames(root);
  assert.deepEqual(Object.keys(current.byFile).sort(), LOAD_LISTS.map(({file}) => file).sort(), '三份加载名单都要读得到');
  assert.ok(current.names.includes('patch/reapply-unrestricted-patch.mjs'), '不叫 apply-*.mjs 的补丁也算进加载名单');
  const {added} = loadedListChanges(current, listed);
  if (added.length) assert.fail(`加载名单检查未通过：\n${added.map(message => `- ${message}`).join('\n')}`);
});

test('加载名单口径：ORDER 加 foo.mjs、脚本里加换名字的补丁都红；删名单项绿；去掉 loaded、读不懂的名单都不放行', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-load-lists-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
    fs.writeFileSync(path.join(dir, file), text);
  };
  const order = names => `const keep = 1;\n// Order taken from apply-theme.sh.\nconst ORDER = [\n${names.map(name => `  '${name}',`).join('\n')}\n  // build.sh, after apply-theme.sh.\n];\nconst OPTIONAL = new Set(['apply-optional.mjs']);\n`;
  const theme = refs => `${refs.map(ref => `    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/${ref}"`).join('\n')}\n`
    + '  for source_file in "$REPO_ROOT/patch"/*.mjs; do\n    copy_if_changed "$source_file" "$bundled_root/patch/$(basename "$source_file")"\n  done\n';
  const install = refs => `PATCH_SCRIPT="$REPO_DIR/patch/reapply-unrestricted-patch.mjs"\nnode "$PATCH_SCRIPT"\n${refs.map(ref => `node "$REPO_DIR/${ref}"`).join('\n')}\nnode "$REPO_DIR/tools/core/manifest.mjs"\n`;
  const writeLists = ({orderNames, themeRefs, installRefs}) => {
    write('patch/apply-all.mjs', order(orderNames));
    write('installer/macos/apply-theme.sh', theme(themeRefs));
    write('install.sh', install(installRefs));
  };
  const lists = {orderNames: ['apply-a.mjs', 'reapply-unrestricted-patch.mjs', 'apply-b.mjs'], themeRefs: ['patch/apply-a.mjs'], installRefs: ['patch/apply-b.mjs']};
  const list = ['patch/apply-a.mjs', 'patch/apply-b.mjs', 'patch/reapply-unrestricted-patch.mjs'];
  writeLists(lists);
  const base = loadedPatchNames(dir);
  assert.deepEqual(base.names, list);
  assert.deepEqual(base.byFile['install.sh'], ['patch/apply-b.mjs', 'patch/reapply-unrestricted-patch.mjs']);
  assert.deepEqual(base.byFile['installer/macos/apply-theme.sh'], ['patch/apply-a.mjs'], '整目录拷贝 "$REPO_ROOT/patch"/*.mjs 不算加载');
  assert.deepEqual(loadedListChanges(base, list), {added: [], unused: []});

  // 反例：往 ORDER 加一个 foo.mjs 必须红——它不叫 apply-*.mjs，L78 的 files 检查看不到它。
  writeLists({...lists, orderNames: [...lists.orderNames, 'foo.mjs']});
  const foo = loadedListChanges(loadedPatchNames(dir), list);
  assert.equal(foo.added.length, 1);
  assert.match(foo.added[0], /^patch\/apply-all\.mjs 加载了没登记的补丁 patch\/foo\.mjs。改内核行为一律去 cle-core 改/);
  // 换名字（子目录、.js、反斜杠）写进 apply-theme.sh / install.sh 也红。
  writeLists({...lists, themeRefs: [...lists.themeRefs, 'patch/sub/foo.js'], installRefs: [...lists.installRefs, 'patch\\foo.mjs']});
  const renamed = loadedListChanges(loadedPatchNames(dir), list);
  assert.equal(renamed.added.length, 2);
  assert.match(renamed.added.join('\n'), /^install\.sh 加载了没登记的补丁 patch\/foo\.mjs。/m);
  assert.match(renamed.added.join('\n'), /^installer\/macos\/apply-theme\.sh 加载了没登记的补丁 patch\/sub\/foo\.js。/m);
  // 删名单项是绿的：ORDER 和 apply-theme.sh 都不再加载 apply-a，loaded 里留着的旧名字只作说明。
  writeLists({...lists, orderNames: ['reapply-unrestricted-patch.mjs', 'apply-b.mjs'], themeRefs: []});
  const shrunk = loadedListChanges(loadedPatchNames(dir), list);
  assert.deepEqual(shrunk.added, []);
  assert.match(shrunk.unused.join('\n'), /^patch\/apply-a\.mjs：加载名单里已经没有它了/);
  assert.equal(loadedListChanges(base, null).added.length, 1, '整个去掉 loaded 不能放行');

  const orderList = LOAD_LISTS.find(({kind}) => kind === 'order');
  assert.throws(() => loadListEntries(orderList, "const ORDER = ['apply-a.mjs', EXTRA];\n"), /只能写补丁名的字符串字面量/);
  assert.throws(() => loadListEntries(orderList, 'const order = [];\n'), /找不到 const ORDER/);
  assert.throws(() => loadListEntries(orderList, "const ORDER = ['../evil.mjs'];\n"), /看不懂的补丁路径/);

  assert.equal(readLoadedList(dir), null, '没有 patch-files.json');
  write(PATCH_LIST, JSON.stringify({files: []}));
  assert.equal(readLoadedList(dir), null, '目标分支的清单还没有 loaded');
  write(PATCH_LIST, JSON.stringify({files: [], loaded: [...list, list[0]]}));
  assert.throws(() => readLoadedList(dir), /loaded 里重复登记/);
  write(PATCH_LIST, '\uFEFF' + JSON.stringify({files: [], loaded: ['tools/x.mjs']}));
  assert.throws(() => readLoadedList(dir), /loaded 必须是 patch\/ 下补丁路径的数组/);
  write(PATCH_LIST, JSON.stringify({files: [], loaded: list}));
  assert.deepEqual(readLoadedList(dir), list);

  const target = {targetList: list, targetNames: list};
  assert.deepEqual(compareLoadedLists({prList: list, ...target}), {failures: [], notes: []});
  assert.match(compareLoadedLists({prList: [...list, 'patch/foo.mjs'], ...target}).failures.join('\n'), /loaded 新增登记：patch\/foo\.mjs/);
  const fewer = compareLoadedLists({prList: list.slice(1), ...target});
  assert.deepEqual(fewer.failures, []);
  assert.match(fewer.notes.join('\n'), /加载名单登记减少：patch\/apply-a\.mjs/);
  assert.match(compareLoadedLists({prList: null, ...target}).failures.join('\n'), /删掉了 tools\/health\/patch-files\.json 的 loaded/);
  // 目标分支还没有 loaded（本 PR 首次引入）：登记的名字必须在目标分支的加载名单里。
  assert.deepEqual(compareLoadedLists({prList: list, targetList: null, targetNames: list}).failures, []);
  assert.match(compareLoadedLists({prList: [...list, 'patch/foo.mjs'], targetList: null, targetNames: list}).failures.join('\n'), /登记了目标分支加载名单里没有的补丁：patch\/foo\.mjs/);
});
