#!/usr/bin/env node
// Core manifest loader, SHA-256 verifier, and dual-core installer (OpenClaw / C.le.).
// Reads only core-manifest.json at the repository root.
//
// CLI usage:
//   node tools/core/manifest.mjs info [--root <dir>] [--core openclaw|cle]
//   node tools/core/manifest.mjs field <dotted.path> [--root <dir>] [--core openclaw|cle]
//   node tools/core/manifest.mjs fetch-cle [--root <dir>] [--cache-dir <dir>]
//   node tools/core/manifest.mjs install --prefix <dir> [--root <dir>] [--core openclaw|cle] [--registry <url>] [--cache-dir <dir>]
//
// Environment:
//   PINKIE_CORE              Override default core ("openclaw" | "cle")
//   PINKIE_NPM_REGISTRY      npm registry URL (default https://registry.npmmirror.com)
//   PINKIE_CLE_CORE_TARBALL  Optional local .tgz path for offline/isolated runs (SHA-256 STILL verified!)
//   CLE_CORE_TOKEN           Optional GitHub PAT for private Cle0726/cle-core release downloads
//   GH_TOKEN / GITHUB_TOKEN  Fallback token env vars for GitHub API release downloads

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envWithoutTokens, installLockedTarball } from './locked-install.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');
export const VALID_CORES = new Set(['openclaw', 'cle']);
const SHA256_RE = /^[0-9a-f]{64}$/;

export function loadCoreManifest(repoRoot = DEFAULT_REPO_ROOT) {
  const manifestPath = path.join(repoRoot, 'core-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`core-manifest.json not found at ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`core-manifest.json is not valid JSON: ${err.message}`);
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('core-manifest.json must be a JSON object');
  }
  if (!VALID_CORES.has(manifest.default)) {
    throw new Error(`core-manifest.json "default" must be "openclaw" or "cle", got: ${JSON.stringify(manifest.default)}`);
  }
  if (typeof manifest.node !== 'string' || !manifest.node.trim()) {
    throw new Error('core-manifest.json "node" version is required');
  }
  if (!manifest.openclaw || typeof manifest.openclaw.version !== 'string' || !manifest.openclaw.version.trim()) {
    throw new Error('core-manifest.json "openclaw.version" is required');
  }
  if (!manifest.cle || typeof manifest.cle !== 'object') {
    throw new Error('core-manifest.json "cle" section is required');
  }
  for (const field of ['version', 'url', 'sha256']) {
    if (typeof manifest.cle[field] !== 'string' || !manifest.cle[field].trim()) {
      throw new Error(`core-manifest.json "cle.${field}" is required`);
    }
  }
  const normalizedSha = manifest.cle.sha256.trim().toLowerCase();
  if (!SHA256_RE.test(normalizedSha)) {
    throw new Error(`core-manifest.json "cle.sha256" must be 64 lowercase hex characters, got: ${manifest.cle.sha256}`);
  }
  manifest.cle.sha256 = normalizedSha;
  return manifest;
}

export function resolveCoreSelection(manifest, coreOverride = process.env.PINKIE_CORE) {
  const rawCore = typeof coreOverride === 'string' && coreOverride.trim()
    ? coreOverride.trim().toLowerCase()
    : manifest.default;
  if (!VALID_CORES.has(rawCore)) {
    throw new Error(`Unsupported PINKIE_CORE="${coreOverride}". Expected "openclaw" or "cle".`);
  }
  return {
    core: rawCore,
    defaultCore: manifest.default,
    node: manifest.node,
    spec: manifest[rawCore],
    manifest,
  };
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export function verifyTarballSha256(filePath, expectedSha256, label = 'core package') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found for SHA-256 verification: ${filePath}`);
  }
  const expected = String(expectedSha256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(expected)) {
    throw new Error(`${label} expected SHA-256 is invalid: ${expectedSha256}`);
  }
  const actual = sha256File(filePath);
  if (actual !== expected) {
    throw new Error(
      `${label} SHA-256 mismatch!\n`
      + `  file:     ${filePath}\n`
      + `  expected: ${expected}\n`
      + `  actual:   ${actual}`,
    );
  }
  return actual;
}

function parseGitHubReleaseUrl(urlString) {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/.exec(urlString);
  if (!m) return null;
  return { repo: m[1], tag: decodeURIComponent(m[2]), asset: decodeURIComponent(m[3]) };
}

async function downloadToFile(url, destPath, headers = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'super-pinkie-core-installer',
      ...headers,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} while downloading ${url}`);
  }
  const arrayBuf = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuf));
}

async function downloadGitHubPrivateAsset({ repo, tag, asset, token, destPath }) {
  const apiHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'super-pinkie-core-installer',
  };
  const releaseUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const relRes = await fetch(releaseUrl, { headers: apiHeaders });
  if (!relRes.ok) {
    throw new Error(`GitHub API failed (${relRes.status}) querying release ${repo}@${tag}`);
  }
  const rel = await relRes.json();
  const assetObj = Array.isArray(rel.assets) ? rel.assets.find((a) => a && a.name === asset) : null;
  if (!assetObj || !assetObj.url) {
    throw new Error(`Release asset "${asset}" not found in ${repo}@${tag}`);
  }
  const dlRes = await fetch(assetObj.url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'super-pinkie-core-installer',
    },
  });
  if (!dlRes.ok) {
    throw new Error(`GitHub API failed (${dlRes.status}) downloading asset ${assetObj.url}`);
  }
  const buf = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

function tryGhReleaseDownload({ repo, tag, asset, destDir }) {
  const ghCmd = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const result = spawnSync(
    ghCmd,
    ['release', 'download', tag, '--repo', repo, '--pattern', asset, '--dir', destDir, '--clobber'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      detail: (result.stderr || result.error?.message || `exit ${result.status}`).trim(),
    };
  }
  return { ok: true, filePath: path.join(destDir, asset) };
}

export async function fetchCleCoreTarball({
  repoRoot = DEFAULT_REPO_ROOT,
  cacheDir = path.join(os.tmpdir(), 'pinkie-core-cache'),
  localOverride = process.env.PINKIE_CLE_CORE_TARBALL,
  token = process.env.CLE_CORE_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
} = {}) {
  const manifest = loadCoreManifest(repoRoot);
  const spec = manifest.cle;
  const parsed = parseGitHubReleaseUrl(spec.url);
  const assetName = spec.asset || parsed?.asset || `cle-core-v${spec.version}.tgz`;

  // 1. Optional local tarball override (offline / CI / isolated test).
  //    SHA-256 is STILL strictly verified against core-manifest.json!
  if (localOverride && localOverride.trim()) {
    const resolvedLocal = path.resolve(localOverride.trim());
    verifyTarballSha256(resolvedLocal, spec.sha256, `cle-core (${spec.version})`);
    return { tarballPath: resolvedLocal, sha256: spec.sha256, version: spec.version, source: 'local' };
  }

  // 2. Local file:// URL (useful for deterministic tests without network).
  if (spec.url.startsWith('file://')) {
    const filePath = fileURLToPath(spec.url);
    verifyTarballSha256(filePath, spec.sha256, `cle-core (${spec.version})`);
    return { tarballPath: filePath, sha256: spec.sha256, version: spec.version, source: 'file-url' };
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedPath = path.join(cacheDir, assetName);
  if (fs.existsSync(cachedPath)) {
    const cachedSha = sha256File(cachedPath);
    if (cachedSha === spec.sha256) {
      return { tarballPath: cachedPath, sha256: cachedSha, version: spec.version, source: 'cache' };
    }
    // Stale or corrupted cached file; remove before re-downloading.
    fs.rmSync(cachedPath, { force: true });
  }

  const tmpDir = fs.mkdtempSync(path.join(cacheDir, '.download-'));
  const tmpPath = path.join(tmpDir, assetName);
  try {
    let downloaded = false;
    const errors = [];

    if (parsed && token) {
      try {
        await downloadGitHubPrivateAsset({
          repo: spec.repo || parsed.repo,
          tag: spec.tag || parsed.tag,
          asset: assetName,
          token,
          destPath: tmpPath,
        });
        downloaded = true;
      } catch (err) {
        errors.push(`GitHub API with token: ${err.message}`);
      }
    }

    if (!downloaded && parsed) {
      const ghRes = tryGhReleaseDownload({
        repo: spec.repo || parsed.repo,
        tag: spec.tag || parsed.tag,
        asset: assetName,
        destDir: tmpDir,
      });
      if (ghRes.ok && fs.existsSync(tmpPath)) {
        downloaded = true;
      } else {
        errors.push(`gh release download: ${ghRes.detail}`);
      }
    }

    if (!downloaded) {
      try {
        await downloadToFile(spec.url, tmpPath);
        downloaded = true;
      } catch (err) {
        errors.push(`direct fetch: ${err.message}`);
      }
    }

    if (!downloaded || !fs.existsSync(tmpPath)) {
      throw new Error(
        `Failed to download cle-core ${spec.version} from ${spec.url}.\n`
        + `If Cle0726/cle-core is private, set CLE_CORE_TOKEN (or log in with gh auth login).\n`
        + `Attempts:\n  - ${errors.join('\n  - ')}`,
      );
    }

    verifyTarballSha256(tmpPath, spec.sha256, `cle-core (${spec.version})`);
    fs.copyFileSync(tmpPath, cachedPath);
    return { tarballPath: cachedPath, sha256: spec.sha256, version: spec.version, source: 'downloaded' };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runNpm(args, env = envWithoutTokens()) {
  const isWin = process.platform === 'win32';
  const res = isWin
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { stdio: 'inherit', env })
    : spawnSync('npm', args, { stdio: 'inherit', env });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`npm ${args.join(' ')} exited with code ${res.status}`);
  }
}

export async function installCoreIntoPrefix({
  repoRoot = DEFAULT_REPO_ROOT,
  prefixDir,
  coreOverride = process.env.PINKIE_CORE,
  npmRegistry = process.env.PINKIE_NPM_REGISTRY || 'https://registry.npmmirror.com',
  cacheDir = path.join(os.tmpdir(), 'pinkie-core-cache'),
  localOverride = process.env.PINKIE_CLE_CORE_TARBALL,
} = {}) {
  if (!prefixDir) throw new Error('--prefix <dir> is required');
  const manifest = loadCoreManifest(repoRoot);
  const selected = resolveCoreSelection(manifest, coreOverride);
  fs.mkdirSync(prefixDir, { recursive: true });

  let verifiedSha256 = null;
  if (selected.core === 'openclaw') {
    runNpm([
      'install',
      '--prefix', prefixDir,
      '--registry', npmRegistry,
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      `openclaw@${selected.spec.version}`,
    ]);
  } else {
    const fetched = await fetchCleCoreTarball({ repoRoot, cacheDir, localOverride });
    verifiedSha256 = fetched.sha256;
    installLockedTarball({
      tarball: fetched.tarballPath,
      prefixDir,
      coreVersion: selected.spec.version,
      registry: npmRegistry,
      runNpm,
    });
  }

  const packageRoot = path.join(prefixDir, 'node_modules', 'openclaw');
  if (!fs.existsSync(path.join(packageRoot, 'openclaw.mjs'))) {
    throw new Error(`Installed core (${selected.core}) is incomplete: missing ${path.join(packageRoot, 'openclaw.mjs')}`);
  }

  // Patches, the Windows snapshot and the macOS bundle all expect dependencies
  // inside the package directory; a hoisted install is unusable.
  if (!fs.existsSync(path.join(packageRoot, 'node_modules', '@openclaw', 'ai', 'package.json'))) {
    throw new Error(`Installed core (${selected.core}) is incomplete: dependencies are not nested under ${packageRoot}`);
  }

  return {
    core: selected.core,
    version: selected.spec.version,
    node: selected.node,
    sha256: verifiedSha256,
    packageRoot,
  };
}

function getField(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseCliArgs(process.argv.slice(2));
  const cmd = positional[0] || 'info';
  const repoRoot = flags.root ? path.resolve(flags.root) : DEFAULT_REPO_ROOT;
  const coreOverride = typeof flags.core === 'string' ? flags.core : process.env.PINKIE_CORE;

  if (cmd === 'info') {
    const manifest = loadCoreManifest(repoRoot);
    const sel = resolveCoreSelection(manifest, coreOverride);
    console.log(JSON.stringify({
      core: sel.core,
      default: sel.defaultCore,
      node: sel.node,
      version: sel.spec.version,
      url: sel.spec.url || null,
      sha256: sel.spec.sha256 || null,
    }, null, 2));
    return;
  }

  if (cmd === 'field') {
    const key = positional[1];
    if (!key) throw new Error('field name required');
    const manifest = loadCoreManifest(repoRoot);
    const sel = resolveCoreSelection(manifest, coreOverride);
    const info = {
      core: sel.core,
      default: sel.defaultCore,
      node: sel.node,
      version: sel.spec.version,
      url: sel.spec.url || '',
      sha256: sel.spec.sha256 || '',
      manifest,
    };
    const val = getField(info, key);
    if (val === undefined) throw new Error(`Unknown manifest field: ${key}`);
    process.stdout.write(String(val));
    return;
  }

  if (cmd === 'fetch-cle') {
    const res = await fetchCleCoreTarball({
      repoRoot,
      cacheDir: flags['cache-dir'] ? path.resolve(flags['cache-dir']) : undefined,
      localOverride: typeof flags.tarball === 'string' ? flags.tarball : undefined,
    });
    process.stdout.write(res.tarballPath);
    return;
  }

  if (cmd === 'install') {
    const res = await installCoreIntoPrefix({
      repoRoot,
      prefixDir: flags.prefix ? path.resolve(flags.prefix) : '',
      coreOverride,
      npmRegistry: typeof flags.registry === 'string' ? flags.registry : undefined,
      cacheDir: flags['cache-dir'] ? path.resolve(flags['cache-dir']) : undefined,
      localOverride: typeof flags.tarball === 'string' ? flags.tarball : undefined,
    });
    console.log(JSON.stringify(res));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

function isDirectCliEntry(entryPath) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(entryPath);
  } catch {
    return path.resolve(process.argv[1]) === entryPath;
  }
}

if (isDirectCliEntry(__filename)) {
  main().catch((err) => {
    console.error(`[core-manifest] ERROR: ${err.message}`);
    process.exit(1);
  });
}
