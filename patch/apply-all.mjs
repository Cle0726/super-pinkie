#!/usr/bin/env node
// Apply every patch in the installer order (installer/macos/apply-theme.sh)
// on a clean copy, then verify syntax and precompressed twins.
//   node patch/apply-all.mjs [--keep]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {TRY, freshCopy, hashes, diffHashes, spawnSync} from './trial-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep');
// Order taken from installer/macos/apply-theme.sh.
const ORDER = [
  'apply-chat-timeline.mjs',
  'apply-chat-math.mjs',
  'apply-chat-linebreaks.mjs',
  'apply-composer-drafts.mjs',
  'apply-context-budget.mjs',
  'apply-compaction-boundary-recovery.mjs',
  'apply-loopback-model-reliability.mjs',
  'apply-work-thinking.mjs',
  'apply-thinking-capabilities.mjs',
  'apply-image-access.mjs',
  'apply-control-ui-workspace-media.mjs',
  'apply-control-ui-file-delivery.mjs',
  'apply-material-preview-csp.mjs',
  'apply-local-unrestricted-policy.mjs',
  'apply-computer-v2.mjs',
  // install.sh (unrestricted kit), after the theme runtime patches.
  'reapply-unrestricted-patch.mjs',
  'apply-same-session-recovery.mjs',
  // Last: the first-paint layer rewrites index.html, sw.js and the web manifest, so it
  // must run after every patch that also touches the Control UI entry document.
  'apply-startup.mjs',
];

freshCopy();
const backups = path.join(os.tmpdir(), 'pinkie-apply-all-backups');
fs.rmSync(backups, {recursive: true, force: true});
const before = hashes(TRY);
let failed = 0;
console.log('# apply order');
for (const name of ORDER) {
  const run = spawnSync(process.execPath, [path.join(here, name)], {
    env: {...process.env, OPENCLAW_ROOT: TRY, PINKIE_PATCH_BACKUP_ROOT: backups, PINKIE_PATCH_BACKUP: backups, UR_PROMPTS_DIR: backups},
    encoding: 'utf8',
    timeout: 180000,
  });
  if (run.status !== 0) failed += 1;
  const line = (run.stdout || '').trim().split('\n').filter(Boolean).slice(0, 2).join(' | ');
  console.log(`${run.status === 0 ? 'ok  ' : 'FAIL'} ${name}  ${line}`);
  if (run.status !== 0) console.log((run.stderr || '').trim().split('\n').slice(0, 4).join('\n'));
}
console.log('\n# changed files');
const diff = diffHashes(before, hashes(TRY));
for (const file of diff.changed) console.log('changed', file);
for (const file of diff.added) console.log('added  ', file);
for (const file of diff.removed) console.log('removed', file);

// node --check every changed/added .js/.mjs file.
console.log('\n# node --check');
let checkFailed = 0;
for (const rel of [...diff.changed, ...diff.added]) {
  if (!/\.(?:m?js)$/u.test(rel)) continue;
  const run = spawnSync(process.execPath, ['--check', path.join(TRY, rel)], {encoding: 'utf8'});
  if (run.status !== 0) { checkFailed += 1; console.log('FAIL', rel, (run.stderr || '').split('\n').slice(0, 3).join(' ')); }
}
console.log(checkFailed ? `${checkFailed} files failed node --check` : 'all changed .js/.mjs pass node --check');

// Precompressed twins must decompress to the patched file, and the manifest
// must still describe all three.
console.log('\n# precompressed twins');
const twins = [];
const manifestPath = path.join(TRY, 'dist/control-ui/asset-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestByPath = new Map(manifest.assets.map((asset) => [asset.path, asset]));
for (const rel of diff.changed) {
  if (!rel.startsWith('dist/control-ui/assets/') || !rel.endsWith('.js')) continue;
  const file = path.join(TRY, rel);
  const source = fs.readFileSync(file);
  for (const [suffix, decode] of [['.br', zlib.brotliDecompressSync], ['.gz', zlib.gunzipSync]]) {
    const twin = file + suffix;
    if (!fs.existsSync(twin)) { twins.push(`MISSING ${rel}${suffix}`); continue; }
    const ok = decode(fs.readFileSync(twin)).equals(source);
    twins.push(`${ok ? 'ok  ' : 'BAD '} ${rel}${suffix}`);
    const entry = manifestByPath.get(rel.split(path.sep).join('/') + suffix);
    const sha = entry ? entry.sha256 : '';
    if (entry) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(twin)).digest('hex');
      twins.push(`${actual === sha ? 'ok  ' : 'BAD '} manifest ${rel.split(path.sep).join('/')}${suffix}`);
    }
  }
}
const jsEntries = manifest.assets.filter((asset) => /^assets\/[^/]+\.js$/u.test(asset.path));
for (const entry of jsEntries) {
  const file = path.join(TRY, 'dist/control-ui', entry.path);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== entry.sha256) twins.push(`BAD manifest ${entry.path}`);
}
console.log(twins.join('\n') || 'no patched Control UI assets');

console.log(`\npatches failed: ${failed}`);
if (!keep) freshCopy();
process.exit(failed || checkFailed || twins.some((line) => /^BAD|^MISSING/u.test(line)) ? 1 : 0);
