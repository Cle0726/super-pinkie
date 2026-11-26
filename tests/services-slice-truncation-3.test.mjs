// B3 残项：run_tests 报告里「第一个失败的原文」「输出的最后一段」被截后交给模型，截了必须明说。
// 复发点：parseTestOutput 只取失败段前 45 行且无标记；formatTestReport 对「最后一段」取的是开头 3500 字，
// 把最末尾的真正报错原因切掉了。
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTestOutput, formatTestReport} from '../services/mode-architecture/code-work.mjs';

const report = (output, exitCode = 1) => formatTestReport({command: 'npm test', exitCode, seconds: 1, timedOut: false, parsed: parseTestOutput(output, exitCode), comparison: null, baselineNote: '', filtered: false});

test('失败段超过 45 行：报告明说截了，并说还剩多少行', () => {
  const frames = Array.from({length: 60}, (_, i) => `  File "pkg/m${i}.py", line ${i + 1}, in f${i}`);
  const output = ['Traceback (most recent call last):', ...frames, 'ValueError: 真正的原因在最底下'].join('\n');
  const text = report(output);
  assert.match(text, /第一个失败的原文/);
  assert.doesNotMatch(text, /真正的原因在最底下/, '这一行确实在 45 行窗口之外');
  assert.match(text, /已截断/);
  assert.match(text, /后面还有 17 行/);
});

test('失败段超过 3500 字：报告写明原文共多少字', () => {
  const body = Array.from({length: 40}, (_, i) => `    at frame${i} ${'x'.repeat(120)}`);
  const detail = ['AssertionError: values differ', ...body].join('\n');
  const text = report(detail);
  assert.match(text, new RegExp(`已截断，原文共 ${detail.length} 字`));
});

test('没认出失败段时，「输出的最后一段」保留最末尾的报错', () => {
  const noise = Array.from({length: 39}, (_, i) => `building module ${i} ${'y'.repeat(120)}`);
  const output = [...noise, 'fatal: 最后一行才是原因'].join('\n');
  const text = report(output, 2);
  assert.match(text, /输出的最后一段/);
  assert.match(text, /fatal: 最后一行才是原因/);
  assert.match(text, /已截断，原文共 \d+ 字，只给了最后 3500 字/);
});

test('短的失败原文照原样给，不加截断标记', () => {
  const output = 'not ok 1 - adds\n  expected 3 got 4\n# tests 1\n# pass 0\n# fail 1\n';
  const text = report(output);
  assert.match(text, /expected 3 got 4/);
  assert.doesNotMatch(text, /已截断/);
});
