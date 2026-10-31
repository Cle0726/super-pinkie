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

// OpenClaw 2026.10 moved the transport body into openai-completions-transport-*
// and builds SDK request options in a shared helper without a maxRetries flag.
const current = `\t\t\tconst requestOptions = {
\t\t\t\t...await encodeBody(params),
\t\t\t\tsignal: firstEventAbort.signal,
\t\t\t\tmaxRetries: 0
\t\t\t};
\t\t\tconst { data: responseStream, response } = await client.chat.completions.create(params, requestOptions).withResponse();
\t\t\tconst hookedResponseStream = withProviderResponseHook({`;

test('2026.10 completions transport disables SDK retries only for loopback base URLs', () => {
  const patched = transform(current);
  assert.match(patched, /pinkie-loopback-model-reliability:v1/);
  assert.match(patched, /options\?\.maxRetries === void 0/);
  assert.match(patched, /requestOptions\.maxRetries = 0/);
  assert.match(patched, /localhost/);
  assert.equal(transform(patched), patched, 'idempotent');
  const body = patched.slice(patched.indexOf('pinkie-loopback-model-reliability'));
  // The guard is evaluated per request and leaves remote relays untouched.
  const guard = /if \((requestOptions && .+)\) requestOptions\.maxRetries = 0;/u.exec(body)[1];
  const isLoopback = new Function('requestOptions', 'options', 'model', `return Boolean(${guard});`);
  assert.equal(isLoopback({}, {}, {baseUrl: 'http://127.0.0.1:1467/v1'}), true);
  assert.equal(isLoopback({}, {}, {baseUrl: 'http://localhost:1467/v1'}), true);
  assert.equal(isLoopback({}, {}, {baseUrl: 'http://[::1]:1467'}), true);
  assert.equal(isLoopback({}, {}, {baseUrl: 'https://api.example.com/v1'}), false);
  assert.equal(isLoopback({}, {}, {baseUrl: ''}), false);
  assert.equal(isLoopback({}, {maxRetries: 2}, {baseUrl: 'http://127.0.0.1:1467'}), false, 'explicit maxRetries wins');
});

test('2026.10 patch backs up and patches the transport chunk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-loopback-2026-'));
  try {
    const dist = path.join(root, 'node_modules', '@openclaw', 'ai', 'dist');
    const backup = path.join(root, 'backup');
    fs.mkdirSync(dist, {recursive: true});
    fs.writeFileSync(path.join(dist, 'openai-completions-transport-fixture.mjs'), current);
    fs.writeFileSync(path.join(dist, 'openai-completions-fixture.mjs'), 'export {};\n');
    const first = apply(root, {backupRoot: backup});
    assert.equal(first.changed, true);
    assert.equal(first.file, 'openai-completions-transport-fixture.mjs');
    assert.equal(fs.readFileSync(path.join(backup, 'openai-completions-transport-fixture.mjs'), 'utf8'), current);
    assert.equal(apply(root, {backupRoot: backup}).changed, false);
    assert.equal(fs.readFileSync(path.join(dist, 'openai-completions-fixture.mjs'), 'utf8'), 'export {};\n');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
