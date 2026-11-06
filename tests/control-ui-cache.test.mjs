import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {helperSource, marker, transform} from '../patch/apply-control-ui-cache.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const snapshot = path.join(root, 'desktop/windows/mac-runtime/openclaw/dist/control-ui-CuoxgbYo.js');
const helper = new Function('fs', `${helperSource}\nreturn pinkieRespondNotModified;`)(fs);

function fakeResponse() {
  return {headers: {}, statusCode: 200, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end() { this.ended = true; }};
}

test('an unchanged file answers 304 without being read; a changed one is sent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-cache-'));
  const file = path.join(dir, 'laolao-theme.css');
  fs.writeFileSync(file, 'body{color:pink}');
  let fd = fs.openSync(file, 'r');
  const first = fakeResponse();
  assert.equal(helper({headers: {}}, first, fd), false);
  const etag = first.headers.etag;
  assert.match(etag, /^"pk-[0-9a-z]+-[0-9a-z]+"$/);
  const again = fakeResponse();
  assert.equal(helper({headers: {'if-none-match': etag}}, again, fd), true);
  assert.equal(again.statusCode, 304);
  assert.equal(again.headers['cache-control'], 'no-cache');
  assert.ok(again.ended);
  const weak = fakeResponse();
  assert.equal(helper({headers: {'if-none-match': `"other", W/${etag}`}}, weak, fd), true);
  fs.closeSync(fd);
  fs.writeFileSync(file, 'body{color:hotpink}');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  fd = fs.openSync(file, 'r');
  const changed = fakeResponse();
  assert.equal(helper({headers: {'if-none-match': etag}}, changed, fd), false);
  assert.notEqual(changed.headers.etag, etag);
  fs.closeSync(fd);
});

test('the shipped Windows snapshot is patched once, and the patch is idempotent', () => {
  const source = fs.readFileSync(snapshot, 'utf8');
  assert.equal(source.split(marker).length - 1, 1);
  assert.match(source, /if \(pinkieRespondNotModified\(req, res, safeFile\.fd\)\) return true;\n\t\tserveResolvedFile\(res, safeFile\.path, await readOpenedFile\(safeFile\.fd\)\);/);
  assert.equal(transform(source), source);
  // index.html is still served by serveResolvedIndexHtml with no-cache, before the guard.
  const indexAt = source.indexOf('serveResolvedIndexHtml(res, await readOpenedFileText(safeFile.fd)');
  assert.ok(indexAt > 0 && indexAt < source.indexOf('if (pinkieRespondNotModified('));
  assert.equal(spawnSync(process.execPath, ['--check', snapshot]).status, 0);
});

test('both installers apply the cache patch and the worker fix', () => {
  const mac = fs.readFileSync(path.join(root, 'installer/macos/apply-theme.sh'), 'utf8');
  const win = fs.readFileSync(path.join(root, 'installer/windows/apply-theme.ps1'), 'utf8');
  for (const text of [mac, win]) {
    assert.match(text, /apply-control-ui-cache\.mjs/);
    assert.match(text, /sw_cache\.py/);
  }
  const sw = fs.readFileSync(path.join(root, 'desktop/windows/mac-runtime/openclaw/dist/control-ui/sw.js'), 'utf8');
  assert.match(sw, /kept\.headers\.get\("etag"\) !== tag/);
  assert.match(sw, /catch\(\(\) => caches\.match\(event\.request\)\)/);
});
