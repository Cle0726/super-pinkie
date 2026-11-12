import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyEdit, parseTestOutput, detectTestCommand, compareWithBaseline, findRefs, formatRefs, quickSyntax, CodeWatch, createCodeEditTool, createRunTestsTool, forgetBaselines} from '../services/mode-architecture/code-work.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'code-work-'));

test('applyEdit: exact single match', () => {
  const r = applyEdit('a\nb\nc\n', 'b', 'B');
  assert.equal(r.ok, true); assert.equal(r.content, 'a\nB\nc\n'); assert.equal(r.startLine, 2);
});
test('applyEdit: multiple matches need more context or replace_all', () => {
  const r = applyEdit('x = 1\ny = 2\nx = 1\n', 'x = 1', 'x = 3');
  assert.equal(r.ok, false); assert.equal(r.reason, 'multiple'); assert.match(r.message, /第 1、3 行/);
  const all = applyEdit('x = 1\ny = 2\nx = 1\n', 'x = 1', 'x = 3', {replaceAll: true});
  assert.equal(all.content, 'x = 3\ny = 2\nx = 3\n'); assert.equal(all.count, 2);
});
test('applyEdit: indentation differs, keeps the file indentation', () => {
  const file = 'def f():\n    if a:\n        return 1\n    return 2\n';
  const r = applyEdit(file, 'if a:\n    return 1', 'if a and b:\n    return 10');
  assert.equal(r.ok, true); assert.equal(r.fuzzy, true);
  assert.equal(r.content, 'def f():\n    if a and b:\n        return 10\n    return 2\n');
});
test('applyEdit: keeps CRLF', () => {
  const r = applyEdit('a\r\nb\r\nc\r\n', 'a\nb', 'a\nB');
  assert.equal(r.content, 'a\r\nB\r\nc\r\n');
});
test('applyEdit: no match returns the nearest block with line numbers', () => {
  const file = 'function total(items) {\n  let sum = 0;\n  for (const item of items) sum += item.price;\n  return sum;\n}\n';
  const r = applyEdit(file, '  let sum = 0;\n  for (const item of items) sum += item.cost;\n  return sum;', 'x');
  assert.equal(r.ok, false); assert.equal(r.reason, 'nomatch');
  assert.deepEqual(r.nearest, {startLine: 2, endLine: 4});
  assert.match(r.message, /item\.price/); assert.match(r.message, /第 3 行和你给的不一样/);
  const none = applyEdit(file, 'completely unrelated text here', 'x');
  assert.equal(none.nearest, undefined);
});
test('parseTestOutput: pytest', () => {
  const r = parseTestOutput('FAILED tests/test_a.py::test_x - assert 1 == 2\n===== 1 failed, 4 passed, 1 skipped in 0.12s =====\n', 1);
  assert.equal(r.framework, 'pytest'); assert.equal(r.passed, 4); assert.equal(r.failed, 1); assert.equal(r.skipped, 1);
  assert.deepEqual(r.failedNames, ['tests/test_a.py::test_x']); assert.equal(r.ok, false);
});
test('parseTestOutput: unittest, node:test, jest, vitest, go, cargo, mocha', () => {
  let r = parseTestOutput('FAIL: test_x (pkg.T)\n----\nRan 5 tests in 0.01s\n\nFAILED (failures=1)\n', 1);
  assert.deepEqual([r.passed, r.failed, r.failedNames[0]], [4, 1, 'pkg.T.test_x']);
  r = parseTestOutput('Ran 3 tests in 0.01s\n\nOK\n', 0);
  assert.deepEqual([r.passed, r.failed, r.ok], [3, 0, true]);
  r = parseTestOutput('not ok 2 - adds numbers\n# tests 3\n# pass 2\n# fail 1\n', 1);
  assert.deepEqual([r.framework, r.passed, r.failed, r.failedNames[0]], ['node:test', 2, 1, 'adds numbers']);
  r = parseTestOutput('  ✕ renders (5 ms)\nTests:       1 failed, 5 passed, 6 total\n', 1);
  assert.deepEqual([r.framework, r.passed, r.failed, r.failedNames[0]], ['jest', 5, 1, 'renders']);
  r = parseTestOutput(' FAIL  src/a.test.ts > sum > adds\n Tests  1 failed | 5 passed (6)\n', 1);
  assert.deepEqual([r.framework, r.passed, r.failed], ['vitest', 5, 1]);
  r = parseTestOutput('--- FAIL: TestAdd (0.00s)\n--- PASS: TestSub (0.00s)\nFAIL\tpkg\t0.1s\n', 1);
  assert.deepEqual([r.framework, r.failed, r.failedNames[0]], ['go test', 1, 'TestAdd']);
  r = parseTestOutput('test a::b ... FAILED\ntest result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured\n', 101);
  assert.deepEqual([r.framework, r.passed, r.failed, r.failedNames[0]], ['cargo test', 3, 1, 'a::b']);
  r = parseTestOutput('  5 passing (10ms)\n  1 failing\n\n  1) suite does it:\n', 1);
  assert.deepEqual([r.framework, r.passed, r.failed], ['mocha', 5, 1]);
});
test('parseTestOutput: nonzero exit without counts is not ok', () => {
  const r = parseTestOutput('ModuleNotFoundError: No module named x\n', 2);
  assert.equal(r.ok, false); assert.equal(r.passed, null);
});
test('compareWithBaseline tells what this change broke', () => {
  const c = compareWithBaseline({failedNames: ['old'], failed: 1}, {failedNames: ['old', 'new'], failed: 2});
  assert.deepEqual(c, {broke: ['new'], fixed: [], stillFailing: ['old']});
  assert.deepEqual(compareWithBaseline({failedNames: [], failed: 1}, {failedNames: [], failed: 3}), {brokeCount: 2, fixedCount: 0});
});
test('detectTestCommand: real scripts only', () => {
  const dir = tmp();
  assert.equal(detectTestCommand(dir), null);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts: {test: 'echo "Error: no test specified" && exit 1'}}));
  assert.equal(detectTestCommand(dir), null);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts: {test: 'vitest run'}}));
  assert.equal(detectTestCommand(dir).command, 'npm test');
  const py = tmp();
  fs.mkdirSync(path.join(py, 'tests')); fs.writeFileSync(path.join(py, 'app.py'), '');
  assert.match(detectTestCommand(py).command, /-m unittest discover -s tests/);
  fs.writeFileSync(path.join(py, 'requirements.txt'), 'pytest\n');
  assert.match(detectTestCommand(py).command, /-m pytest -q$/);
});
test('findRefs: definitions and uses, whole word', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function parseOrder(x) { return x; }\nconst parseOrders = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.js'), "import {parseOrder} from './a.js';\n// parseOrder is used here\nparseOrder(1);\n");
  fs.mkdirSync(path.join(dir, 'node_modules')); fs.writeFileSync(path.join(dir, 'node_modules', 'c.js'), 'parseOrder()');
  const r = findRefs(dir, 'parseOrder');
  assert.equal(r.definitions.length, 1); assert.equal(r.definitions[0].file, 'a.js');
  assert.equal(r.total, 4); assert.equal(r.files, 2);
  assert.match(formatRefs(r), /b\.js/);
  assert.throws(() => findRefs(dir, 'a.b()'));
  assert.match(formatRefs(findRefs(dir, 'nothingHere')), /没有/);
});
test('quickSyntax and CodeWatch', () => {
  const dir = tmp();
  const bad = path.join(dir, 'bad.js'), good = path.join(dir, 'good.json');
  fs.writeFileSync(bad, 'function (\n'); fs.writeFileSync(good, '{"a":1}');
  assert.ok(quickSyntax(bad)); assert.equal(quickSyntax(good), null);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{"a":}');
  assert.match(quickSyntax(path.join(dir, 'bad.json')).message, /JSON/);
  const watch = new CodeWatch();
  watch.afterTool({toolName: 'write', params: {path: 'bad.js'}}, {sessionKey: 's'}, {baseDirs: [dir]});
  assert.match(watch.block('s'), /bad\.js 第 \d+ 行/);
  fs.writeFileSync(bad, 'function f() {}\n');
  assert.equal(watch.block('s'), '');
  watch.afterTool({toolName: 'read', params: {path: 'bad.js'}}, {sessionKey: 's'}, {baseDirs: [dir]});
  assert.equal(watch.block('s'), '');
});
test('code_edit tool: edits, reports syntax, refuses outside root and overwrite', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'm.js'), 'const a = 1;\nconst b = 2;\n');
  const watch = new CodeWatch();
  const tool = createCodeEditTool({sessionKey: 's'}, {rootFor: () => dir, watch});
  let r = await tool.execute('1', {path: 'm.js', old_text: 'const b = 2;', new_text: 'const b = ;'});
  assert.equal(r.details.changed, true); assert.ok(r.details.syntaxError); assert.match(r.content[0].text, /语法检查没过/);
  assert.match(watch.block('s'), /m\.js/);
  r = await tool.execute('2', {path: 'm.js', old_text: 'const b = ;', new_text: 'const b = 3;'});
  assert.match(r.content[0].text, /语法检查通过/); assert.equal(watch.block('s'), '');
  assert.equal(r.details.absolutePath, path.join(dir, 'm.js'));
  r = await tool.execute('3', {path: '../x.js', old_text: '', new_text: 'x'});
  assert.equal(r.isError, true);
  r = await tool.execute('4', {path: 'm.js', old_text: '', new_text: 'x'});
  assert.equal(r.isError, true);
  r = await tool.execute('5', {path: 'sub/n.js', old_text: '', new_text: 'export const n = 1;\n'});
  assert.equal(r.details.created, true); assert.ok(fs.existsSync(path.join(dir, 'sub/n.js')));
});
test('run_tests tool: baseline then comparison', async () => {
  forgetBaselines();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts: {test: 'x'}}));
  const outputs = [
    {exitCode: 1, output: 'not ok 1 - old\n# pass 2\n# fail 1\n', seconds: 0.1, timedOut: false},
    {exitCode: 1, output: 'not ok 1 - old\nnot ok 2 - fresh\n# pass 1\n# fail 2\n', seconds: 0.1, timedOut: false},
  ];
  const commands = [];
  const tool = createRunTestsTool({sessionKey: 's'}, {rootFor: () => dir, run: async command => { commands.push(command); return outputs.shift(); }});
  let r = await tool.execute('1', {});
  assert.match(r.content[0].text, /记为基线/); assert.match(r.content[0].text, /原来就有 1 条失败/);
  r = await tool.execute('2', {});
  assert.deepEqual(r.details.comparison.broke, ['fresh']); assert.match(r.content[0].text, /这次弄坏的/);
  assert.deepEqual(commands, ['npm test', 'npm test']);
  const none = createRunTestsTool({sessionKey: 's'}, {rootFor: () => tmp()});
  assert.equal((await none.execute('3', {})).isError, true);
});
