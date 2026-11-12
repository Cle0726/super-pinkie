import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCodeSearchTool, findFiles, formatResult, globToRegExp, outlineFile, searchCode} from '../services/mode-architecture/code-tools.mjs';

const write = (root, file, text) => { const full = path.join(root, file); fs.mkdirSync(path.dirname(full), {recursive: true}); fs.writeFileSync(full, text); };
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-search-'));
  write(root, 'src/export/exportAll.js', 'import xlsx from "xlsx";\nexport function exportAll(records) {\n  return xlsx.write(records);\n}\nconst helper = (a) => a;\n');
  write(root, 'src/pages/Records.jsx', 'export default function Records() {\n  return <button onClick={exportAll}>导出全部</button>;\n}\n');
  write(root, 'src/中文 目录/工具.py', 'class Tool:\n    def run(self, path):\n        return path\n\nasync def main():\n    pass\n');
  write(root, 'node_modules/xlsx/index.js', 'export function exportAll() {}\n');
  write(root, '.venv/lib/site.py', 'def exportAll(): pass\n');
  write(root, 'dist/bundle.min.js', 'exportAll');
  write(root, 'assets/logo.png', Buffer.from([0x89, 0x50, 0, 0, 1, 2]));
  write(root, 'package-lock.json', '{"exportAll": 1}');
  write(root, 'README.md', '# 记账\n\n## 开发\n\n```\n# 不是标题\n```\n\n### 导出\n');
  return root;
}

test('content search finds lines with numbers and skips dependencies, builds, binaries and lock files', () => {
  const root = project();
  const result = searchCode(root, {query: 'exportall'});
  assert.deepEqual(result.results.map(group => group.file), ['src/export/exportAll.js', 'src/pages/Records.jsx']);
  assert.equal(result.total, 2);
  assert.deepEqual(result.results[0].matches[0], {line: 2, text: 'export function exportAll(records) {'});
  assert.match(formatResult(result), /src\/pages\/Records\.jsx\n {2}2: /);
});

test('search understands Chinese text, scopes, regex with anchors, context lines and case', () => {
  const root = project();
  assert.equal(searchCode(root, {query: '导出全部'}).results[0].file, 'src/pages/Records.jsx');
  assert.equal(searchCode(root, {query: 'export', glob: '*.py'}).total, 0);
  assert.equal(searchCode(root, {query: 'def', glob: '*.py'}).total, 2);
  assert.equal(searchCode(root, {query: 'return', path: 'src/中文 目录'}).results[0].file, 'src/中文 目录/工具.py');
  assert.equal(searchCode(root, {query: '^class \\w+:$', regex: true}).total, 1);
  assert.equal(searchCode(root, {query: 'EXPORTALL', caseSensitive: true}).total, 0);
  const around = searchCode(root, {query: 'xlsx.write', context: 1}).results[0].matches[0];
  assert.deepEqual([around.before, around.after], [['export function exportAll(records) {'], ['}']]);
  assert.equal(searchCode(root, {query: 'helper', path: 'src/export/exportAll.js'}).total, 1, 'path may be one file');
  // 想查库的源码时，把 path 指过去就能搜到
  assert.equal(searchCode(root, {query: 'exportAll', path: 'node_modules/xlsx'}).total, 1);
});

test('no hit says what to try next instead of a bare nothing', () => {
  const root = project();
  const result = searchCode(root, {query: 'exportAll monthly'});
  assert.equal(result.total, 0);
  assert.match(result.hint, /拆开搜有：「exportAll」2 处/);
  assert.match(formatResult(result), /换说法/);
  assert.throws(() => searchCode(root, {query: '(', regex: true}), /正则写得不对/);
  assert.throws(() => searchCode(root, {query: ' '}), /不能是空的/);
  assert.throws(() => searchCode(root, {query: 'x', path: '../..'}), /只能在当前项目目录里找/);
});

test('results are capped and say so', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-search-'));
  write(root, 'big.txt', Array.from({length: 300}, (_, i) => `needle ${i}`).join('\n'));
  const result = searchCode(root, {query: 'needle', max: 10});
  assert.equal(result.total, 300);
  assert.equal(result.results[0].matches.length, 10);
  assert.ok(result.truncated);
  assert.match(result.hint, /一共 300 处，只列了前 10 处/);
});

test('file search by words and by glob', () => {
  const root = project();
  assert.deepEqual(findFiles(root, {query: 'export'}).files, ['src/export/exportAll.js']);
  assert.deepEqual(findFiles(root, {query: '*.jsx'}).files, ['src/pages/Records.jsx']);
  assert.deepEqual(findFiles(root, {query: 'src/**/*.py'}).files, ['src/中文 目录/工具.py']);
  assert.deepEqual(findFiles(root, {query: '工具'}).files, ['src/中文 目录/工具.py']);
  assert.equal(findFiles(root, {query: 'nothing-here'}).total, 0);
  assert.ok(globToRegExp('*.{js,ts}').test('a/b/c.ts'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
  assert.ok(globToRegExp('tests/').test('pkg/tests/a.py'));
});

test('outline lists functions, classes and headings with line numbers', () => {
  const root = project();
  assert.deepEqual(outlineFile(root, 'src/export/exportAll.js').items.map(item => item.line), [2, 5]);
  assert.deepEqual(outlineFile(root, 'src/中文 目录/工具.py').items.map(item => [item.line, item.text]), [[1, 'class Tool:'], [2, 'def run(self, path):'], [5, 'async def main():']]);
  assert.deepEqual(outlineFile(root, 'README.md').items.map(item => item.text), ['# 记账', '## 开发', '### 导出'], 'a # inside a code fence is not a heading');
  assert.match(formatResult(outlineFile(root, 'src/中文 目录/工具.py')), /共 6 行.*\n1: class Tool:/);
  assert.throws(() => outlineFile(root, 'assets/logo.png'), /不是文本文件/);
});

test('the tool answers in plain lines and reports mistakes as errors', async () => {
  const root = project();
  const tool = createCodeSearchTool({sessionKey: 'agent:project:x'}, {rootFor: () => root});
  assert.equal(tool.name, 'code_search');
  const hit = await tool.execute('1', {query: '导出全部'});
  assert.match(hit.content[0].text, /Records\.jsx/);
  assert.ok(!hit.isError);
  assert.match((await tool.execute('2', {mode: 'files', query: '*.py'})).content[0].text, /工具\.py/);
  assert.match((await tool.execute('3', {mode: 'outline', path: 'src/export/exportAll.js'})).content[0].text, /2: export function exportAll/);
  assert.ok((await tool.execute('4', {mode: 'outline'})).isError);
  assert.ok((await createCodeSearchTool({}, {rootFor: () => ''}).execute('5', {query: 'x'})).isError);
});
