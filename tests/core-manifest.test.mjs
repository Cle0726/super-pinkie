// K2 dual-core manifest, SHA-256 verification, and build/install contract tests.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_REPO_ROOT,
  fetchCleCoreTarball,
  loadCoreManifest,
  resolveCoreSelection,
  sha256File,
  verifyTarballSha256,
} from '../tools/core/manifest.mjs';

const read = (rel) => fs.readFileSync(path.join(DEFAULT_REPO_ROOT, rel), 'utf8');

test('core-manifest.json defaults to openclaw and stays synced with legacy runtime-manifest.json', () => {
  const manifest = loadCoreManifest(DEFAULT_REPO_ROOT);
  const legacy = JSON.parse(read('desktop/windows/runtime-manifest.json'));
  assert.equal(manifest.default, 'openclaw');
  assert.match(manifest.node, /^24\./);
  assert.equal(manifest.openclaw.version, '2026.7.1-2');
  assert.equal(legacy.node, manifest.node);
  assert.equal(legacy.openclaw, manifest.openclaw.version);
  assert.match(manifest.cle.version, /^2026\.7\.1-2-c\./);
  assert.match(manifest.cle.url, /^https:\/\/github\.com\/Cle0726\/cle-core\/releases\/download\//);
  assert.match(manifest.cle.sha256, /^[0-9a-f]{64}$/);
});

test('resolveCoreSelection defaults to manifest.default and honors PINKIE_CORE=openclaw|cle', () => {
  const manifest = loadCoreManifest(DEFAULT_REPO_ROOT);
  const prevEnv = process.env.PINKIE_CORE;
  delete process.env.PINKIE_CORE;
  try {
    assert.equal(resolveCoreSelection(manifest, undefined).core, 'openclaw');
    assert.equal(resolveCoreSelection(manifest, '').core, 'openclaw');
    assert.equal(resolveCoreSelection(manifest, 'openclaw').core, 'openclaw');
    assert.equal(resolveCoreSelection(manifest, 'cle').core, 'cle');
    assert.equal(resolveCoreSelection(manifest, 'CLE').core, 'cle');
    assert.throws(() => resolveCoreSelection(manifest, 'unknown-core'), /Unsupported PINKIE_CORE/);
  } finally {
    if (prevEnv !== undefined) process.env.PINKIE_CORE = prevEnv;
  }
});

test('K2-2: SHA-256 verification succeeds on exact match and hard-fails on 1-char mismatch', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-k2-sha-'));
  try {
    const fakeTarball = path.join(tmpDir, 'cle-core-v2026.7.1-2-c.1.tgz');
    fs.writeFileSync(fakeTarball, Buffer.from('synthetic-cle-core-tarball-payload-k2'));
    const realSha = sha256File(fakeTarball);
    assert.equal(realSha, crypto.createHash('sha256').update('synthetic-cle-core-tarball-payload-k2').digest('hex'));

    // Exact match passes
    assert.equal(verifyTarballSha256(fakeTarball, realSha), realSha);

    const fakeRepo = path.join(tmpDir, 'repo');
    fs.mkdirSync(fakeRepo, { recursive: true });
    const goodManifest = {
      default: 'openclaw',
      node: '24.20.0',
      openclaw: { version: '2026.7.1-2' },
      cle: {
        version: '2026.7.1-2-c.1',
        url: pathToFileURL(fakeTarball).href,
        sha256: realSha,
      },
    };
    fs.writeFileSync(path.join(fakeRepo, 'core-manifest.json'), JSON.stringify(goodManifest, null, 2));

    const okRes = await fetchCleCoreTarball({
      repoRoot: fakeRepo,
      cacheDir: path.join(tmpDir, 'cache'),
      localOverride: '',
      token: '',
    });
    assert.equal(okRes.sha256, realSha);

    // Flip ONE hex character in cle.sha256 -> must fail closed
    const flippedFirst = realSha[0] === '0' ? '1' : '0';
    const badSha = flippedFirst + realSha.slice(1);
    const badManifest = {
      ...goodManifest,
      cle: { ...goodManifest.cle, sha256: badSha },
    };
    fs.writeFileSync(path.join(fakeRepo, 'core-manifest.json'), JSON.stringify(badManifest, null, 2));

    await assert.rejects(
      () => fetchCleCoreTarball({
        repoRoot: fakeRepo,
        cacheDir: path.join(tmpDir, 'cache-bad'),
        localOverride: '',
        token: '',
      }),
      /SHA-256 mismatch/,
    );
    // Even with localOverride, SHA-256 mismatch MUST still be rejected
    await assert.rejects(
      () => fetchCleCoreTarball({
        repoRoot: fakeRepo,
        cacheDir: path.join(tmpDir, 'cache-bad-local'),
        localOverride: fakeTarball,
        token: '',
      }),
      /SHA-256 mismatch/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('K2-1: Windows/Mac build and install scripts read core-manifest.json and Mac build never reads host openclaw', () => {
  const buildWin = read('build-win.ps1');
  const buildMac = read('desktop/macos/build.sh');
  const installSh = read('install.sh');
  const installPs1 = read('install.ps1');
  const applyWin = read('installer/windows/apply-theme.ps1');
  const applyMac = read('installer/macos/apply-theme.sh');

  assert.match(buildWin, /core-manifest\.json/);
  assert.match(buildWin, /tools\\core\\manifest\.mjs/);
  assert.match(buildMac, /tools\/core\/manifest\.mjs/);
  assert.doesNotMatch(buildMac, /command -v openclaw/, 'desktop/macos/build.sh must never read host-installed OpenClaw');
  assert.match(installSh, /tools\/core\/manifest\.mjs/);
  assert.match(installPs1, /tools\\core\\manifest\.mjs/);
  assert.match(applyWin, /tools\\core\\manifest\.mjs/);
  assert.match(applyMac, /tools\/core\/manifest\.mjs/);
});

test('K2-7: CI defines the C.le. core job running with PINKIE_CORE=cle', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /cle-core-checks:/);
  assert.match(ci, /PINKIE_CORE:\s*cle/);
  assert.match(ci, /tools\/core\/manifest\.mjs/);
  assert.match(ci, /tests\/visual-baseline\.test\.mjs/);
});
