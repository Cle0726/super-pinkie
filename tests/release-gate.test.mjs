import test from 'node:test';
import assert from 'node:assert/strict';
import {outcomes} from '../tools/release-gate/tap.mjs';

test('release gate distinguishes passed, failed and skipped TAP tests', () => {
  const result = outcomes({file: 'tests/example.test.mjs', code: 1, output: [
    'ok 1 - passing',
    'not ok 2 - failing',
    'ok 3 - skipped # SKIP no browser on this host',
  ].join('\n')});
  assert.deepEqual([...result.passed], ['tests/example.test.mjs :: passing']);
  assert.deepEqual([...result.failed], ['tests/example.test.mjs :: failing']);
  assert.deepEqual([...result.skipped], ['tests/example.test.mjs :: skipped']);
});

test('release gate catches a test process that exits without a TAP failure', () => {
  const result = outcomes({file: 'tests/example.test.mjs', code: 1, output: 'crashed'});
  assert.deepEqual([...result.failed], ['tests/example.test.mjs :: <file failed>']);
});
