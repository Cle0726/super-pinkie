import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply, transform} from '../patch/apply-loopback-model-reliability.mjs';

const source = `const requestOptions = {
  signal: firstEventAbort.signal,
  ...options?.timeoutMs !== void 0 ? { timeout: options.timeoutMs } : {},
  ...options?.maxRetries !== void 0 ? { maxRetries: options.maxRetries } : {}
};`;

test('loopback relay disables only implicit SDK retries', () => {
  const patched = transform(source);
  assert.match(patched, /pinkie-loopback-model-reliability:v1/);
  assert.match(patched, /model\.baseUrl/);
  assert.match(patched, /\{ maxRetries: 0 \}/);
  assert.match(patched, /options\?\.maxRetries/);
  assert.equal(transform(patched), patched);
});

test('patcher backs up and updates the unique completions transport', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-loopback-'));
  const dist = path.join(root, 'node_modules', '@openclaw', 'ai', 'dist');
  const backup = path.join(root, 'backup');
  fs.mkdirSync(dist, {recursive: true});
  const file = path.join(dist, 'openai-completions-fixture.mjs');
  fs.writeFileSync(file, source);
  const first = apply(root, {backupRoot: backup});
  assert.equal(first.changed, true);
  assert.equal(fs.readFileSync(path.join(backup, path.basename(file)), 'utf8'), source);
  assert.match(fs.readFileSync(file, 'utf8'), /maxRetries: 0/);
  assert.equal(apply(root, {backupRoot: backup}).changed, false);
});

test('installers keep the reliability patch on rebuild and reinstall', () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const name of ['installer/macos/apply-theme.sh', 'install.sh', 'install.ps1']) {
    assert.match(fs.readFileSync(path.join(root, name), 'utf8'), /apply-loopback-model-reliability\.mjs/, name);
  }
});
