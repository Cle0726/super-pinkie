/**
 * Regenerate the precompressed twins of patched Control UI assets.
 *
 * OpenClaw 2026.10 ships every dist/control-ui/assets/*.js together with a
 * sibling *.js.br and *.js.gz, and dist/control-ui/asset-manifest.json records
 * the sha256/size of all three. The gateway prefers the compressed copy, so a
 * patch that rewrites a .js without refreshing its twins (and the manifest)
 * silently never reaches the browser.
 *
 * Usage from a patch: `refreshPrecompressed(file)` after writing `file`.
 * Safe to call for any file: non-Control-UI paths, missing twins and missing
 * manifests are left alone. Never throws: a failure is reported and the patch
 * keeps its .js change.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const MANIFEST = 'asset-manifest.json';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assetRootFor(file) {
  const segments = path.dirname(file).split(path.sep);
  const index = segments.lastIndexOf('control-ui');
  if (index < 0) return null;
  return segments.slice(0, index + 1).join(path.sep) || path.sep;
}

/**
 * Rewrite `<file>.br` / `<file>.gz` from `file` and refresh the manifest entry
 * of every file that changed. `extraFiles` (e.g. index.html) are refreshed in
 * the manifest too when they exist on disk.
 */
export function refreshPrecompressed(file, {extraFiles = []} = {}) {
  const report = {file, updated: [], missing: [], modified: true};
  try {
    const root = assetRootFor(path.resolve(file));
    if (!root || !fs.existsSync(path.join(root, MANIFEST))) {
      return {...report, modified: false, reason: 'not a packaged Control UI asset'};
    }
    const source = fs.readFileSync(file);

    for (const [extension, encode, decode] of [
      ['.br', (buffer) => zlib.brotliCompressSync(buffer), (buffer) => zlib.brotliDecompressSync(buffer)],
      ['.gz', (buffer) => zlib.gzipSync(buffer), (buffer) => zlib.gunzipSync(buffer)],
    ]) {
      const twin = file + extension;
      if (!fs.existsSync(twin)) {
        report.missing.push(path.basename(twin));
        continue;
      }
      const current = fs.readFileSync(twin);
      let stale = true;
      try {
        stale = !decode(current).equals(source);
      } catch {
        stale = true;
      }
      if (stale) {
        fs.writeFileSync(twin, encode(source));
        report.updated.push(path.basename(twin));
      }
    }
    refreshManifest(root, [file, ...extraFiles.filter((name) => fs.existsSync(name))], report);
  } catch (error) {
    report.error = String(error?.message || error);
  }
  return report;
}

function refreshManifest(root, files, report) {
  const manifestPath = path.join(root, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    report.manifest = 'missing';
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    report.manifest = 'unreadable: ' + String(error?.message || error);
    return;
  }
  if (!Array.isArray(manifest?.assets)) {
    report.manifest = 'unexpected shape';
    return;
  }
  const wanted = new Set();
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    wanted.add(relative);
    if (fs.existsSync(file + '.br')) wanted.add(relative + '.br');
    if (fs.existsSync(file + '.gz')) wanted.add(relative + '.gz');
  }
  let dirty = false;
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.path !== 'string' || !wanted.has(asset.path)) continue;
    const absolute = path.join(root, asset.path);
    if (!fs.existsSync(absolute)) continue;
    const buffer = fs.readFileSync(absolute);
    const sha = sha256(buffer);
    if (asset.sha256 === sha && asset.size === buffer.length) continue;
    asset.sha256 = sha;
    asset.size = buffer.length;
    dirty = true;
  }
  if (!dirty) {
    report.manifest = 'unchanged';
    return;
  }
  const sorted = manifest.assets.slice().sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  // The generation id is the digest of the (path, size, sha256) lines, so it
  // has to move with the entries exactly like the upstream builder does.
  const hash = crypto.createHash('sha256');
  for (const entry of sorted) hash.update(`${entry.path}\0${entry.size}\0${entry.sha256}\n`);
  manifest.assets = sorted;
  manifest.generation = hash.digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  // The gateway parses this as <runtime-build>-<64-hex asset generation>.
  // Replace the generation rather than appending a short digest: append-only
  // updates break that shape and eventually exceed the 161-character limit.
  const indexPath = path.join(root, 'index.html');
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8');
    const bumped = html.replace(/(data-openclaw-control-ui-build-id=")([^"\s]+)(")/u, (attribute, before, id, after) => {
      // Also repair suffixes left by earlier versions of this helper. Unknown
      // build identifiers belong to a different runtime and stay untouched.
      const parsed = /^([a-zA-Z0-9._-]{1,96})-[a-f0-9]{64}(?:-[a-f0-9]{12})*$/u.exec(id);
      return parsed ? `${before}${parsed[1]}-${manifest.generation}${after}` : attribute;
    });
    if (bumped !== html) {
      fs.writeFileSync(indexPath, bumped);
      report.indexBuildId = 'updated';
    }
  }
  report.manifest = 'updated';
}

export default refreshPrecompressed;
