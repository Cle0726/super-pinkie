// B92/B94: the C.le. core lives in a private repo. A build without a token, a local
// tarball, a file:// URL or a verified cache copy must stop before it starts and say
// how to fix it, instead of failing halfway through with a 404.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleCorePreflight, DEFAULT_REPO_ROOT, sha256File } from '../tools/core/manifest.mjs';

const CLI = path.join(DEFAULT_REPO_ROOT, 'tools', 'core', 'manifest.mjs');

function fakeRepo(dir, { url, sha256 }) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'core-manifest.json'), JSON.stringify({
    default: 'cle',
    node: '24.20.0',
    openclaw: { version: '2026.7.1-2' },
    cle: { version: '2026.7.1-2-c.9', url, sha256 },
  }, null, 2));
  return repo;
}

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-cle-preflight-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PRIVATE_URL = 'https://github.com/Cle0726/cle-core/releases/download/cle-core-v2026.7.1-2-c.9/cle-core-v2026.7.1-2-c.9.tgz';
const SHA = 'a'.repeat(64);

test('preflight refuses a default=cle build with no token, tarball or cache, and names all three ways out', () => withTmp((dir) => {
  const repoRoot = fakeRepo(dir, { url: PRIVATE_URL, sha256: SHA });
  assert.throws(
    () => cleCorePreflight({ repoRoot, coreOverride: '', cacheDir: path.join(dir, 'cache'), localOverride: '', token: '' }),
    (err) => {
      assert.match(err.message, /private repo Cle0726\/cle-core/);
      assert.match(err.message, /CLE_CORE_TOKEN/);
      assert.match(err.message, /PINKIE_CLE_CORE_TARBALL/);
      assert.match(err.message, /PINKIE_CORE=openclaw/);
      assert.match(err.message, /cle-core-v2026\.7\.1-2-c\.9\.tgz/);
      return true;
    },
  );
}));

test('preflight passes with a token, an existing local tarball, a file:// URL, or a verified cache copy', () => withTmp((dir) => {
  const repoRoot = fakeRepo(dir, { url: PRIVATE_URL, sha256: SHA });
  const base = { repoRoot, coreOverride: '', cacheDir: path.join(dir, 'cache'), localOverride: '', token: '' };
  assert.equal(cleCorePreflight({ ...base, token: 'ghp_example' }).source, 'token');

  const tgz = path.join(dir, 'local.tgz');
  fs.writeFileSync(tgz, 'payload');
  assert.equal(cleCorePreflight({ ...base, localOverride: tgz }).source, 'local');

  const fileRepo = fakeRepo(path.join(dir, 'file'), { url: 'file:///nowhere/cle.tgz', sha256: SHA });
  assert.equal(cleCorePreflight({ ...base, repoRoot: fileRepo }).source, 'file-url');

  const cacheDir = path.join(dir, 'cache-ok');
  fs.mkdirSync(cacheDir);
  const cached = path.join(cacheDir, 'cle-core-v2026.7.1-2-c.9.tgz');
  fs.writeFileSync(cached, 'cached payload');
  const goodRepo = fakeRepo(path.join(dir, 'good'), { url: PRIVATE_URL, sha256: sha256File(cached) });
  assert.equal(cleCorePreflight({ ...base, repoRoot: goodRepo, cacheDir }).source, 'cache');
}));

test('preflight does not trust a cache copy whose SHA-256 is wrong, nor a tarball path that does not exist', () => withTmp((dir) => {
  const repoRoot = fakeRepo(dir, { url: PRIVATE_URL, sha256: SHA });
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, 'cle-core-v2026.7.1-2-c.9.tgz'), 'not the real core');
  const base = { repoRoot, coreOverride: '', cacheDir, localOverride: '', token: '' };
  assert.throws(() => cleCorePreflight(base), /no way to fetch it is set/);
  assert.throws(() => cleCorePreflight({ ...base, localOverride: path.join(dir, 'missing.tgz') }), /points to a missing file/);
}));

test('preflight never blocks the openclaw fallback build', () => withTmp((dir) => {
  const repoRoot = fakeRepo(dir, { url: PRIVATE_URL, sha256: SHA });
  const res = cleCorePreflight({ repoRoot, coreOverride: 'openclaw', cacheDir: path.join(dir, 'cache'), localOverride: '', token: '' });
  assert.deepEqual(res, { ok: true, core: 'openclaw', source: 'npm' });
}));

test('preflight CLI exits non-zero with the instructions, and 0 for PINKIE_CORE=openclaw', () => withTmp((dir) => {
  const repoRoot = fakeRepo(dir, { url: PRIVATE_URL, sha256: SHA });
  const env = { ...process.env, CLE_CORE_TOKEN: '', GH_TOKEN: '', GITHUB_TOKEN: '', PINKIE_CLE_CORE_TARBALL: '', PINKIE_CORE: '' };
  const args = [CLI, 'preflight', '--root', repoRoot, '--cache-dir', path.join(dir, 'cache')];
  const bad = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /\[core-manifest\] ERROR: C\.le\. core .* private repo/);
  assert.match(bad.stderr, /PINKIE_CORE=openclaw/);
  const ok = spawnSync(process.execPath, args, { env: { ...env, PINKIE_CORE: 'openclaw' }, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { ok: true, core: 'openclaw', source: 'npm' });
}));

test('build-win.ps1 runs the preflight before installing Python packages or the core', () => {
  const ps = fs.readFileSync(path.join(DEFAULT_REPO_ROOT, 'build-win.ps1'), 'utf8');
  const preflight = ps.indexOf('$coreHelper preflight');
  assert.ok(preflight > 0, 'build-win.ps1 must call manifest.mjs preflight');
  assert.ok(preflight < ps.indexOf('python -m pip install'), 'preflight must come before pip install');
  assert.ok(preflight < ps.indexOf('$coreHelper install'), 'preflight must come before the core install');
  assert.match(ps.slice(preflight, preflight + 400), /build\\cache\\core/, 'preflight must look at the same cache the core install uses');
});
