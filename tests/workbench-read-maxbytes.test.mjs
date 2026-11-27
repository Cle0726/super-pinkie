// R5 ③（设计稿 docs/redesign/R5-FILE-PREVIEW-EDIT.md 第二节 4）：pinkie.fs.read 可选 maxBytes，只读开头一段给只读预览面板用。
// 复发防护：
//   1. 不给 maxBytes（或给 0 / 负数 / 不是数）和以前一模一样：整份读，没有 truncated，项目里可写（反例：默认行为不能变）。
//   2. 给了且文件比它大：只回开头，标 truncated，一律只读（半份内容不能被存回去盖掉原文件）；文件不比它大就是整份、不标。
//   3. 切在中文（多字节 UTF-8）中间时退回到上一个完整字符，末尾没有 �。
//   4. 二进制、超 8 MB 照旧走 binary / too-large。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-read-maxbytes-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const {Workbench} = await import(pathToFileURL(path.resolve('services/mode-architecture/workbench.mjs')).href);
  const bench = new Workbench({home: root, config: () => ({agents: {list: [{id: 'project', workspace: project}]}})});
  const read = (name, extra = {}) => bench.read({sessionKey: 'agent:project:main', path: path.join(project, name), ...extra});
  return {project, read};
}

test('without maxBytes a read is exactly what it was: whole file, no truncated flag, writable inside the project', async t => {
  const {project, read} = await fixture(t);
  fs.writeFileSync(path.join(project, 'a.txt'), 'x'.repeat(5000));
  for (const extra of [{}, {maxBytes: 0}, {maxBytes: -5}, {maxBytes: 'abc'}, {maxBytes: null}]) {
    const r = await read('a.txt', extra);
    assert.equal(r.kind, 'text');
    assert.equal(r.content.length, 5000, JSON.stringify(extra));
    assert.equal(r.truncated, undefined);
    assert.equal(r.readOnly, false);
  }
});

test('maxBytes smaller than the file returns only the head, marked truncated and read-only; a file that fits is whole', async t => {
  const {project, read} = await fixture(t);
  fs.writeFileSync(path.join(project, 'big.txt'), 'line\r\n'.repeat(1000));
  const cut = await read('big.txt', {maxBytes: 100});
  assert.equal(cut.kind, 'text');
  assert.equal(Buffer.byteLength(cut.content), 100);
  assert.equal(cut.truncated, true);
  assert.equal(cut.readOnly, true, 'half a file must never be saved back over the original');
  assert.equal(cut.size, 6000, 'size is still the real file size');
  assert.equal(cut.eol, 'crlf');
  const whole = await read('big.txt', {maxBytes: 6000});
  assert.equal(whole.content.length, 6000);
  assert.equal(whole.truncated, undefined);
  assert.equal(whole.readOnly, false);
});

test('a cut in the middle of a Chinese character steps back to the last whole character', async t => {
  const {project, read} = await fixture(t);
  fs.writeFileSync(path.join(project, 'zh.md'), '中文预览'.repeat(100));   // 每字 3 字节
  for (const cap of [10, 11, 12]) {
    const r = await read('zh.md', {maxBytes: cap});
    assert.doesNotMatch(r.content, /�/, 'cap ' + cap);
    assert.equal(Buffer.byteLength(r.content), Math.floor(cap / 3) * 3, 'cap ' + cap);
  }
  fs.writeFileSync(path.join(project, 'emoji.txt'), 'a' + '😀'.repeat(10));   // 4 字节
  const e = await read('emoji.txt', {maxBytes: 7});
  assert.equal(e.content, 'a😀');
});

test('binary files stay binary under maxBytes', async t => {
  const {project, read} = await fixture(t);
  fs.writeFileSync(path.join(project, 'b.bin'), Buffer.concat([Buffer.from('head'), Buffer.alloc(10), Buffer.from('x'.repeat(5000))]));
  assert.equal((await read('b.bin', {maxBytes: 100})).kind, 'binary');
  assert.equal((await read('b.bin')).kind, 'binary');
});
