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
import { buildInstallLock, envWithoutTokens, installLockedTarball } from '../tools/core/locked-install.mjs';
import { compareCores } from '../tools/core/verify-equivalence.mjs';

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

test('cle install lock nests every dependency and swaps in the vendored @openclaw/ai', () => {
  const pkg = { name: 'openclaw', version: '1.0.0-2', dependencies: { left: '1.0.0', '@openclaw/ai': '1.0.0-2' } };
  const shrinkwrap = {
    version: '1.0.0-2',
    packages: {
      '': {},
      'node_modules/left': { version: '1.0.0', integrity: 'sha512-left', dependencies: { right: '2.0.0' } },
      'node_modules/right': { version: '2.0.5', os: ['darwin'], cpu: ['x64'] },
      'node_modules/@openclaw/ai': { version: '1.0.0-2', resolved: 'https://registry/ai.tgz', integrity: 'sha512-npm' },
    },
  };
  const core = { resolved: 'file:.cle-core/openclaw.tgz', integrity: 'sha512-core' };
  const ai = { resolved: 'file:.cle-core/openclaw-ai.tgz', integrity: 'sha512-own' };
  const { packages } = buildInstallLock({ pkg, shrinkwrap, core, ai }).lock;

  assert.equal(packages['node_modules/left'], undefined, 'dependencies must not be hoisted');
  assert.equal(packages['node_modules/openclaw/node_modules/left'].integrity, 'sha512-left');
  assert.equal(packages['node_modules/openclaw/node_modules/left'].dependencies.right, '2.0.5', 'the pin beats a conflicting exact range');
  assert.equal(packages['node_modules/openclaw/node_modules/@openclaw/ai'].integrity, 'sha512-own');
  assert.equal(packages['node_modules/openclaw/node_modules/@openclaw/ai'].resolved, ai.resolved);

  assert.deepEqual(packages['node_modules/openclaw/node_modules/right'], { version: '2.0.5' }, 'no platform filtering');
  assert.throws(() => buildInstallLock({ pkg: { ...pkg, version: '1.0.0' }, shrinkwrap, core, ai }), /does not match/);
  const escaping = { ...shrinkwrap, packages: { ...shrinkwrap.packages, 'node_modules/../../outside': {} } };
  assert.throws(() => buildInstallLock({ pkg, shrinkwrap: escaping, core, ai }), /invalid path/);
});

test('cle install refuses to empty a node_modules it does not own', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-k2-prefix-'));
  try {
    fs.mkdirSync(path.join(tmp, 'node_modules', 'someone-elses-package'), { recursive: true });
    const runNpm = () => assert.fail('npm must not run');
    assert.throws(
      () => installLockedTarball({ tarball: 'unused', prefixDir: tmp, coreVersion: 'x', runNpm, registry: '' }),
      /not a dedicated core prefix/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('install scripts never receive repository tokens', () => {
  const env = envWithoutTokens({ CLE_CORE_TOKEN: 'a', GH_TOKEN: 'b', GITHUB_TOKEN: 'c', KEEP: 'd' });
  assert.deepEqual(env, { KEEP: 'd' });
});

test('equivalence check catches changed bytes, renamed chunks and hoisted dependencies', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-k2-equal-'));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const make = (prefix, { body = 'same', chunk = 'index-AAAA.js', hoist = false } = {}) => {
    const root = path.join(prefix, 'node_modules/openclaw');
    write(path.join(root, 'package.json'), '{"name":"openclaw","version":"1.0.0"}');
    write(path.join(root, 'dist/run.js'), body);
    write(path.join(root, 'dist/control-ui/assets', chunk), 'ui');
    write(path.join(root, 'node_modules/@openclaw/ai/package.json'), '{"version":"1.0.0"}');
    write(path.join(root, 'node_modules/@openclaw/ai/dist/index.mjs'), 'ai');
    write(path.join(hoist ? prefix : root, 'node_modules/left/package.json'), '{"version":"1.0.0"}');
    return prefix;
  };
  try {
    const official = make(path.join(tmp, 'official'));
    const problems = (name, options) => compareCores(official, make(path.join(tmp, name), options)).problems.join('\n');
    assert.equal(problems('same'), '');
    assert.match(problems('bytes', { body: 'other' }), /changed dist\/run\.js/);
    assert.match(problems('chunk', { chunk: 'index-BBBB.js' }), /missing dist\/control-ui\/assets\/index-AAAA\.js/);
    assert.match(problems('hoisted', { hoist: true }), /dependency .*node_modules\/left/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('K2-7: the C.le. CI job fails closed and really compares the two cores', () => {
  const ci = read('.github/workflows/ci.yml');
  const job = ci.slice(ci.indexOf('cle-core-checks:'));
  assert.doesNotMatch(job, /skipping private|exit 0/);
  assert.match(job, /CLE_CORE_TOKEN is not configured[\s\S]{0,120}exit 1/);
  assert.equal(job.match(/verify-equivalence\.mjs/g).length, 2, 'compare before and after patches');
});
