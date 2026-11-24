import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {formatMeasurement, measure} from '../tools/health/measure.mjs';
import {healthChanges, readJson, SYNC_HINT} from '../tools/health/ratchet.mjs';

test('代码健康度：每个文件不能变差，改善后要同步基线', async () => {
  const baseline = readJson(new URL('../tools/health/baseline.json', import.meta.url));
  const exceptions = readJson(new URL('../tools/health/exceptions.json', import.meta.url));
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
  assert.deepEqual(lf.injections[js], {important: 0, lines: 8, mutationObservers: 2, setIntervals: 1, subtreeObserverCalls: 1, windowGlobals: 1});
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
