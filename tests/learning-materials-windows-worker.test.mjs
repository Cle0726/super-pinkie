import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {extractFile} from '../services/mode-architecture/learning-materials-extract.mjs';

test('text extraction uses the bundled Node worker on Windows without a Git Bash PATH', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinkie-text-worker-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const file = path.join(root, '含 空格.md');
  await fs.writeFile(file, '# 电流\n电荷定向移动。');
  const original = process.env.PATH;
  if (process.platform === 'win32') process.env.PATH = path.dirname(process.execPath);
  try {
    assert.deepEqual((await extractFile(file)).map(p => p.text), ['# 电流\n电荷定向移动。']);
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
});
