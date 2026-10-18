import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply, transform} from '../patch/apply-material-preview-csp.mjs';

// 2026.7 CSP table.
const legacy = 'return [\n\t\t"img-src \'self\' data: blob:",\n\t\t"media-src \'self\' data: blob:",\n\t].join("; ");\n';
// 2026.10 CSP table (dist/control-ui-*.mjs).
const current = 'return [\n\t\t"default-src \'self\'",\n\t\t"frame-ancestors \'none\'",\n'
  + '\t\t"frame-src \'self\' blob: http: https:",\n'
  + '\t\t"style-src \'self\' \'unsafe-inline\'",\n'
  + '\t\t"img-src \'self\' data: blob: https:",\n'
  + '\t\t"media-src \'self\' data: blob:",\n'
  + '\t\t"font-src \'self\' https://fonts.gstatic.com",\n'
  + '\t].join("; ");\n';

for (const [label, source] of [['2026.7', legacy], ['2026.10', current]]) {
  test(`${label}: only the shell scheme is added to img/media/frame sources`, () => {
    const patched = transform(source);
    assert.notEqual(patched, source);
    assert.match(patched, /pinkie-material-preview-csp:v3/);
    assert.match(patched, /"img-src 'self' data: blob:[^"]*clekk-material:"/);
    if (label === '2026.7') assert.match(patched, /"media-src 'self' data: blob: clekk-material:"/);
    else assert.match(patched, /"media-src 'self' data: blob:",/);
    assert.doesNotMatch(patched, / (?:\*|unsafe-eval)\b/, 'no wildcard or eval relaxation');
    assert.doesNotMatch(patched, /default-src[^"]*clekk-material/);
    assert.doesNotMatch(patched, /script-src[^"]*clekk-material/);
    assert.equal(transform(patched), patched, 'idempotent');
  });
}

test('2026.10 frame-src keeps its http: and https: sources and gains the shell scheme', () => {
  const patched = transform(current);
  assert.match(patched, /"frame-src 'self' blob: http: https: clekk-material:",/);
  assert.equal((patched.match(/"frame-src/gu) || []).length, 1, 'no duplicated directive');
  assert.match(patched, /"img-src 'self' data: blob: https: clekk-material:",/);
});

test('upgrades an installed v2 patch from the 2026.7 layout label', () => {
  const v2 = transform(legacy).replace('pinkie-material-preview-csp:v3', 'pinkie-material-preview-csp:v2');
  const upgraded = transform(v2);
  assert.match(upgraded, /pinkie-material-preview-csp:v3/);
  assert.equal(transform(upgraded), upgraded);
});

test('locates the .mjs control-ui chunk that builds the CSP header', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-csp-'));
  try {
    const dist = path.join(root, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'control-ui-CSP.mjs'), `function buildControlUiCspHeader(opts) {\n${current}}\n`);
    fs.writeFileSync(path.join(dist, 'control-ui-OTHER.mjs'), 'export {};\n');
    const result = apply(root);
    assert.deepEqual(result, {changed: true, file: 'control-ui-CSP.mjs'});
    assert.equal(apply(root).changed, false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
