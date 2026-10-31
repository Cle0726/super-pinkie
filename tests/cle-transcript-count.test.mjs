// A process-card duration is not a tool count. These are the native labels
// observed in the real QA conversation, including its 14-second one-read turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = (await fs.readFile(new URL('../services/cle-studio/src/process/transcript.js', import.meta.url), 'utf8'))
  .replace(/^import ['"].*\.css['"];?\s*$/gm, '');
const transcript = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('a native process duration never becomes a claimed number of tool steps', () => {
  for (const label of ['已处理 14秒钟', '已处理 1分 14秒', 'Processed 14 seconds', '已处理']) {
    assert.equal(transcript.summarizedTools(label).total, 0, label);
  }
});

test('only explicitly counted tool categories contribute to the summary', () => {
  assert.deepEqual(transcript.summarizedTools('1 条命令 · 2 次读取'), {total: 3, kind: 'read'});
  assert.deepEqual(transcript.summarizedTools('2 reads, 1 command'), {total: 3, kind: 'read'});
  assert.deepEqual(transcript.summarizedTools('1 条命令 · 用时 14 秒'), {total: 1, kind: 'exec'});
  assert.equal(transcript.summarizedTools('读取 report-20261021.md').total, 0);
});

test('an unrecognised or empty label retains the native wording without inventing steps', () => {
  for (const label of ['', '14', '2026 年记录', '版本 4.1', '0 次读取']) {
    assert.equal(transcript.summarizedTools(label).total, 0, label);
  }
});
