import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {transform, marker} from '../patch/apply-noop-write-continue.mjs';
import {applyDist} from '../patch/lib-apply-dist.mjs';

// Shape of dist/sessions-*.js in OpenClaw 2026.7.1-2 (tabs as shipped).
const T = (n) => '\t'.repeat(n);
const source = [
  'function createEdit(textResult) {',
  `${T(3)}return async function run(path, realEdits, normalizedError, EditNoChangeError) {`,
  `${T(5)}if (realEdits.length === 0) return {`,
  `${T(6)}...textResult(\`No changes made to \${path}. The replacement text is identical to the original.\`, void 0),`,
  `${T(6)}terminate: true`,
  `${T(5)}};`,
  `${T(5)}if (normalizedError instanceof EditNoChangeError) return {`,
  `${T(6)}...textResult(\`No changes made to \${path}. The replacement produced identical content.\`, void 0),`,
  `${T(6)}terminate: true`,
  `${T(5)}};`,
  `${T(5)}if (normalizedError) throw normalizedError;`,
  `${T(5)}return textResult(\`Successfully replaced text in \${path}.\`, void 0);`,
  `${T(3)}};`,
  '}',
  'function createWrite(textResult) {',
  `${T(3)}return async function run(path, precheck) {`,
  `${T(4)}if (precheck.state === "same") return {`,
  `${T(5)}...textResult(\`No changes made to \${path}. The file already has identical content.\`, void 0),`,
  `${T(5)}terminate: true`,
  `${T(4)}};`,
  `${T(4)}return textResult(\`Successfully wrote \${path}.\`, void 0);`,
  `${T(3)}};`,
  '}',
  'return {createEdit, createWrite};',
].join('\n');

const textResult = (text) => ({content: [{type: 'text', text}]});
const load = (src) => new Function(src)();
class EditNoChangeError extends Error {}

async function results(src) {
  const {createEdit, createWrite} = load(src);
  const edit = createEdit(textResult);
  const write = createWrite(textResult);
  return {
    noopEdit: await edit('a.txt', [], null, EditNoChangeError),
    noopEditErr: await edit('a.txt', [1], new EditNoChangeError(), EditNoChangeError),
    realEdit: await edit('a.txt', [1], null, EditNoChangeError),
    editError: await edit('a.txt', [1], new Error('oldText not found'), EditNoChangeError).catch((e) => e),
    noopWrite: await write('a.txt', {state: 'same'}),
    realWrite: await write('a.txt', {state: 'changed'}),
  };
}

test('unpatched runtime ends the turn on every no-op (reproduces B64)', async () => {
  const r = await results(source);
  assert.equal(r.noopEdit.terminate, true);
  assert.equal(r.noopEditErr.terminate, true);
  assert.equal(r.noopWrite.terminate, true);
});

test('patched no-op results keep their text but no longer terminate', async () => {
  const out = transform(source);
  assert.equal(out.reason, 'patched');
  assert.equal(out.text.split(marker).length, 4);
  assert.ok(!out.text.includes('terminate'));
  const before = await results(source);
  const after = await results(out.text);
  for (const k of ['noopEdit', 'noopEditErr', 'noopWrite']) {
    assert.equal('terminate' in after[k], false, k);
    assert.deepEqual(after[k].content, before[k].content, k);
    assert.match(after[k].content[0].text, /^No changes made to a\.txt\./);
  }
});

test('real write, real edit and edit errors are unchanged', async () => {
  const before = await results(source);
  const after = await results(transform(source).text);
  assert.deepEqual(after.realEdit, before.realEdit);
  assert.deepEqual(after.realWrite, before.realWrite);
  assert.ok(after.editError instanceof Error);
  assert.equal(after.editError.message, before.editError.message);
});

test('patching twice is a no-op', () => {
  const once = transform(source).text;
  const twice = transform(once);
  assert.equal(twice.reason, 'already-patched');
  assert.equal(twice.text, once);
});

test('a missing or duplicated anchor is refused, nothing half-patched', () => {
  const missing = source.replace('The file already has identical content.', 'The file is unchanged.');
  assert.deepEqual(transform(missing), {changed: false, reason: 'unsupported-runtime', text: missing});
  const lines = source.split('\n');
  const dup = [...lines.slice(0, 6), ...lines.slice(2, 6), ...lines.slice(6)].join('\n');
  assert.equal(transform(dup).reason, 'unsupported-runtime');
  assert.equal(transform('const x = 1;').reason, 'unsupported-runtime');
});

test('applyDist patches the one runtime file and fails loudly when none matches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noop-continue-'));
  const backup = path.join(root, 'backup');
  const prev = process.env.PINKIE_PATCH_BACKUP_ROOT;
  process.env.PINKIE_PATCH_BACKUP_ROOT = backup;
  try {
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'sessions-X.js'), source);
    fs.writeFileSync(path.join(root, 'dist', 'other-Y.js'), 'export {};\n');
    assert.deepEqual(applyDist(root, 'noop-write-continue', [transform]), [{file: 'sessions-X.js', reason: 'patched'}]);
    assert.ok(fs.readFileSync(path.join(root, 'dist', 'sessions-X.js'), 'utf8').includes(marker));
    assert.equal(fs.readFileSync(path.join(backup, 'sessions-X.js'), 'utf8'), source);
    assert.deepEqual(applyDist(root, 'noop-write-continue', [transform]), [{file: 'sessions-X.js', reason: 'already-patched'}]);
    fs.writeFileSync(path.join(root, 'dist', 'sessions-X.js'), 'export {};\n');
    assert.throws(() => applyDist(root, 'noop-write-continue', [transform]), /found 0/);
  } finally {
    if (prev === undefined) delete process.env.PINKIE_PATCH_BACKUP_ROOT; else process.env.PINKIE_PATCH_BACKUP_ROOT = prev;
    fs.rmSync(root, {recursive: true, force: true});
  }
});
