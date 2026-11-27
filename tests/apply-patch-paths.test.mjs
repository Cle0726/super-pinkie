import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {toolTargetPaths} from '../services/mode-architecture/evidence-rules.mjs';

const base = path.join(os.tmpdir(), 'apply-patch-ws');
const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');

test('最小复现：Delete File 相对路径不再吃到补丁结尾', () => {
  const got = toolTargetPaths('apply_patch', {input: patch('*** Delete File: c.txt')}, base);
  assert.deepEqual(got, [path.resolve(base, 'c.txt')]);
});

test('Add File 相对路径按 baseDir 解析，正文行不当目标', () => {
  const got = toolTargetPaths('apply_patch', {input: patch('*** Add File: notes/y.txt', '+hi', "+const p = '/usr/bin/env'")}, base);
  assert.deepEqual(got, [path.resolve(base, 'notes/y.txt')]);
});

test('Update File 绝对路径原样保留', () => {
  const abs = path.join(base, 'x.txt');
  const got = toolTargetPaths('apply_patch', {input: patch(`*** Update File: ${abs}`, '@@', '-a', '+b')}, base);
  assert.deepEqual(got, [abs]);
});

test('Move to：源和目标都算，CRLF 不带进路径', () => {
  const text = patch('*** Update File: old/a.txt', '*** Move to: new/a.txt', '@@', '-a', '+b').replace(/\n/g, '\r\n');
  const got = toolTargetPaths('apply_patch', {patch: text}, base);
  assert.deepEqual(got, [path.resolve(base, 'old/a.txt'), path.resolve(base, 'new/a.txt')]);
});

test('一个补丁多个文件头全部列出且去重', () => {
  const got = toolTargetPaths('apply_patch', {input: patch(
    '*** Add File: a.txt', '+1', '*** Delete File: b.txt', '*** Update File: a.txt', '@@', '-1', '+2',
  )}, base);
  assert.deepEqual(got, [path.resolve(base, 'a.txt'), path.resolve(base, 'b.txt')]);
});

test('没有 input / patch 字段时退回扫其他字符串字段', () => {
  const got = toolTargetPaths('apply_patch', {body: patch('*** Delete File: z.txt')}, base);
  assert.deepEqual(got, [path.resolve(base, 'z.txt')]);
});
