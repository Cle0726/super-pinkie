import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {CodeChecker} from '../services/mode-architecture/workbench-lsp.mjs';

test('code check does not read a path or symlink outside the project', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-check-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-check-out-'));
  t.after(() => {
    fs.rmSync(root, {recursive: true, force: true});
    fs.rmSync(outside, {recursive: true, force: true});
  });
  const marker = 'PINKIE_LEAK';
  fs.writeFileSync(path.join(outside, 'secret.json'), marker);
  fs.writeFileSync(path.join(root, 'bad.json'), '{');
  fs.symlinkSync(path.join(outside, 'secret.json'), path.join(root, 'link.json'));
  const rel = path.relative(root, path.join(outside, 'secret.json'));
  const checker = new CodeChecker();
  const escaped = await checker.check(root, [rel]);
  const linked = await checker.check(root, ['link.json']);
  const inside = await checker.check(root, ['bad.json']);
  assert.equal(JSON.stringify(escaped).includes(marker), false);
  assert.equal(JSON.stringify(linked).includes(marker), false);
  assert.equal(inside.errors >= 1, true);
  assert.equal(JSON.stringify(inside).includes(marker), false);
});
