#!/usr/bin/env node
/**
 * Generate content-hashed asset URLs (sha256[:10]) for a Control UI directory.
 *
 * - Stamps CSS url("./laolao-*?v=@hash") references with target asset hashes
 * - Stamps assets/index-*.js dynamic chat-page imports with chat-page sha256[:10]
 * - Generates control-ui/laolao-asset-manifest.js (window.__pinkieAsset)
 * - Stamps control-ui/laolao-head.fragment.html and control-ui/index.html
 * - Refreshes precompressed twins / asset-manifest.json when present
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {refreshPrecompressed} from '../../patch/lib-precompressed.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(THIS_FILE), '../..');
export const HASH_LEN = 10;
export const ASSET_MANIFEST_JS = 'laolao-asset-manifest.js';
export const HEAD_FRAGMENT = 'laolao-head.fragment.html';
export const UI_MANIFEST_JSON = 'pinkie-ui-manifest.json';

const TAG_RE = /<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>|<link\b[^>]*>/gi;
const REF_RE = /\b(src|href)=(["'])([^"']+)\2/i;
const NATIVE_ENTRY_RE = /^assets\/index-[^/]+\.(?:js|css)$/;
const CSS_URL_HASH_RE = /url\((["']?)(\.?\/)?(laolao-[A-Za-z0-9._/-]+)\?v=(?:@hash|[a-f0-9]{10})\1\)/g;
const CHAT_PAGE_IMPORT_RE = /(\.\/chat-page-[A-Za-z0-9_-]+\.js)(?:\?v=[^`"'\\)]*)?/g;
const RUNTIME_DATA = new Set(['laolao-stats.json', 'laolao-quota.json', 'laolao-exam-packs.json']);
const FRAGMENTS = new Set(['laolao-head.fragment.html', 'laolao-body.fragment.html']);

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha10(buffer) {
  return sha256(buffer).slice(0, HASH_LEN);
}

export function refPath(ref) {
  const clean = String(ref || '').split('#', 1)[0].split('?', 1)[0];
  return clean.replace(/^(?:\.\/|\/)+/, '');
}

export function isOwnedEntry(ref) {
  const name = refPath(ref);
  return (name.startsWith('laolao-') || name.startsWith('vendor/')) && (name.endsWith('.js') || name.endsWith('.css'));
}

export function isManifestResource(relPath) {
  if (!relPath || relPath.endsWith('.br') || relPath.endsWith('.gz')) return false;
  if (relPath === ASSET_MANIFEST_JS || relPath === UI_MANIFEST_JSON || FRAGMENTS.has(relPath) || RUNTIME_DATA.has(relPath)) {
    return false;
  }
  if (relPath === 'apple-touch-icon.png') return true;
  if (relPath.startsWith('laolao-') || relPath.startsWith('vendor/') || relPath.startsWith('fonts/')
    || relPath.startsWith('study-desk/') || relPath.startsWith('study-game/') || relPath.startsWith('deep-think/')
    || relPath.startsWith('provider-icons/') || relPath.startsWith('ProviderIcon-')) {
    return true;
  }
  if (/^assets\/(?:chat-page-|index-)[^/]+\.(?:js|css)$/.test(relPath)) return true;
  return false;
}

function walkFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function writeIfChanged(filePath, buffer) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath).equals(buffer)) return false;
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, buffer);
  return true;
}

export function stampCssText(cssText, lookupHash) {
  return cssText.replace(CSS_URL_HASH_RE, (full, quote, prefix = '', target) => {
    const hash = lookupHash(target);
    if (!hash) return full;
    return `url(${quote}${prefix}${target}?v=${hash}${quote})`;
  });
}

export function stampNativeEntryBytes(entryBytes, resolveTargetBytes) {
  const text = entryBytes.toString('utf8');
  const next = text.replace(CHAT_PAGE_IMPORT_RE, (full, relImport) => {
    const targetName = relImport.replace(/^\.\//, '');
    const targetBytes = resolveTargetBytes(targetName);
    const hash = targetBytes ? sha10(targetBytes) : sha10(Buffer.from(relImport, 'utf8'));
    return `${relImport}?v=${hash}`;
  });
  return Buffer.from(next, 'utf8');
}

export function renderAssetManifestJs(hashes) {
  const sortedKeys = Object.keys(hashes)
    .filter((k) => k !== ASSET_MANIFEST_JS && !FRAGMENTS.has(k))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const table = {};
  for (const key of sortedKeys) table[key] = hashes[key];
  return [
    '(() => {',
    '  "use strict";',
    `  const M = ${JSON.stringify(table, null, 2).replace(/\n/g, '\n  ')};`,
    '  window.__pinkieAssetManifest = M;',
    '  window.__pinkieAsset = (p) => {',
    '    const s = String(p || "");',
    '    const q = s.indexOf("?");',
    '    const clean = q < 0 ? s : s.slice(0, q);',
    '    const key = clean.replace(/^(?:\\.\\/|\\/)+/, "");',
    '    const h = M[key];',
    '    return h ? `${clean}?v=${h}` : s;',
    '  };',
    '})();',
    '',
  ].join('\n');
}

function formatQuery(pairs) {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function parseQuery(queryString) {
  if (!queryString) return [];
  const params = new URLSearchParams(queryString);
  const out = [];
  for (const [k, v] of params.entries()) out.push([k, v]);
  return out;
}

export function stampTag(tag, hashes) {
  const match = REF_RE.exec(tag);
  if (!match) return tag;
  const [, attr, quote, rawRef] = match;
  const target = refPath(rawRef);
  const hash = hashes[target];
  if (!hash) return tag;
  const qIndex = rawRef.indexOf('?');
  const rawQuery = qIndex >= 0 ? rawRef.slice(qIndex + 1) : '';
  const preserved = parseQuery(rawQuery).filter(([k]) => k !== 'v' && k !== 'h');
  preserved.push(['v', hash]);
  const nextRef = `/${target}?${formatQuery(preserved)}`;
  return `${tag.slice(0, match.index)}${attr}=${quote}${nextRef}${quote}${tag.slice(match.index + match[0].length)}`;
}

export function stampHeadFragment(fragmentText, hashes) {
  let text = fragmentText.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const manifestHash = hashes[ASSET_MANIFEST_JS];
  const manifestTag = `<script src="/${ASSET_MANIFEST_JS}?v=${manifestHash || '@hash'}"></script>`;
  // Remove any existing manifest tag so repeated stamping stays idempotent.
  text = text.replace(/^[ \t]*<script\b[^>]*\bsrc=["']\/?laolao-asset-manifest\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>[ \t]*\n?/gim, '');
  text = text.replace(TAG_RE, (tag) => stampTag(tag, hashes));
  if (manifestHash) {
    text = text.replace(/(<script\b[^>]*\bsrc=["']\/laolao-night\.js\?v=[^"']+["'][^>]*>\s*<\/script>)/i, `$1\n${manifestTag}`);
  }
  return text;
}

export function stampIndexHtml(indexHtml, hashes) {
  let html = indexHtml.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const manifestHash = hashes[ASSET_MANIFEST_JS];
  const manifestTag = `<script src="/${ASSET_MANIFEST_JS}?v=${manifestHash}"></script>`;
  // Split around inline scripts so we never alter CSP-sensitive inline script bodies.
  const chunks = html.split(/(<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>)/i);
  for (let i = 0; i < chunks.length; i += 2) {
    let part = chunks[i];
    part = part.replace(/\n?[ \t]*<script\b[^>]*\bsrc=["'](?:\.\/|\/)?laolao-asset-manifest\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi, '');
    part = part.replace(TAG_RE, (tag) => {
      const m = REF_RE.exec(tag);
      if (!m) return tag;
      const target = refPath(m[3]);
      if (isOwnedEntry(m[3]) || NATIVE_ENTRY_RE.test(target)) {
        return stampTag(tag, hashes);
      }
      return tag;
    });
    if (manifestHash) {
      part = part.replace(/(<script\b[^>]*\bsrc=["']\/laolao-night\.js\?v=[^"']+["'][^>]*>\s*<\/script>)/i, `$1\n    ${manifestTag}`);
    }
    chunks[i] = part;
  }
  return chunks.join('');
}

export function stampControlUi(controlUiDir, {root = DEFAULT_ROOT, check = false, manifestOutput = null} = {}) {
  const control = path.resolve(controlUiDir);
  const repoRoot = root ? path.resolve(root) : DEFAULT_ROOT;
  if (!fs.existsSync(control)) {
    throw new Error(`Control UI directory does not exist: ${control}`);
  }

  const allFiles = walkFiles(control);
  const rawHashes = {};
  for (const rel of allFiles) {
    if (!isManifestResource(rel)) continue;
    rawHashes[rel] = sha10(fs.readFileSync(path.join(control, rel)));
  }

  const modifiedFiles = [];

  // 1. Stamp CSS files containing url("./laolao-*?v=@hash|<10hex>")
  for (const rel of allFiles) {
    if (!rel.endsWith('.css') || !rel.startsWith('laolao-')) continue;
    const full = path.join(control, rel);
    const original = fs.readFileSync(full, 'utf8');
    if (!CSS_URL_HASH_RE.test(original)) continue;
    CSS_URL_HASH_RE.lastIndex = 0;
    const stamped = stampCssText(original, (target) => rawHashes[target]);
    const buf = Buffer.from(stamped, 'utf8');
    rawHashes[rel] = sha10(buf);
    if (stamped !== original) {
      if (check) throw new Error(`Unstamped CSS asset URLs in ${rel}`);
      writeIfChanged(full, buf);
      modifiedFiles.push(full);
    }
  }

  // 2. Stamp assets/index-*.js dynamic imports for ./chat-page-*.js
  for (const rel of allFiles) {
    if (!/^assets\/index-[^/]+\.js$/.test(rel)) continue;
    const full = path.join(control, rel);
    const original = fs.readFileSync(full);
    const stamped = stampNativeEntryBytes(original, (targetName) => {
      const candidate = path.join(control, 'assets', targetName);
      return fs.existsSync(candidate) ? fs.readFileSync(candidate) : null;
    });
    rawHashes[rel] = sha10(stamped);
    if (!stamped.equals(original)) {
      if (check) throw new Error(`Unstamped chat-page import in ${rel}`);
      writeIfChanged(full, stamped);
      modifiedFiles.push(full);
    }
  }

  // 3. Render laolao-asset-manifest.js and compute its own 10-char hash
  const manifestJsText = renderAssetManifestJs(rawHashes);
  const manifestJsBytes = Buffer.from(manifestJsText, 'utf8');
  const hashes = {...rawHashes, [ASSET_MANIFEST_JS]: sha10(manifestJsBytes)};
  const manifestJsPath = path.join(control, ASSET_MANIFEST_JS);
  if (check) {
    if (!fs.existsSync(manifestJsPath) || !fs.readFileSync(manifestJsPath).equals(manifestJsBytes)) {
      throw new Error(`Missing or stale ${ASSET_MANIFEST_JS}`);
    }
  } else if (writeIfChanged(manifestJsPath, manifestJsBytes)) {
    modifiedFiles.push(manifestJsPath);
  }

  // 4. Stamp control-ui/laolao-head.fragment.html
  const repoHeadPath = path.join(repoRoot, 'ui/injections', HEAD_FRAGMENT);
  const controlHeadPath = path.join(control, HEAD_FRAGMENT);
  const headSourcePath = fs.existsSync(repoHeadPath) ? repoHeadPath : (fs.existsSync(controlHeadPath) ? controlHeadPath : null);
  if (headSourcePath) {
    const stampedHead = Buffer.from(stampHeadFragment(fs.readFileSync(headSourcePath, 'utf8'), hashes), 'utf8');
    if (check) {
      if (!fs.existsSync(controlHeadPath) || !fs.readFileSync(controlHeadPath).equals(stampedHead)) {
        throw new Error(`Missing or stale ${HEAD_FRAGMENT}`);
      }
    } else if (writeIfChanged(controlHeadPath, stampedHead)) {
      modifiedFiles.push(controlHeadPath);
    }
  }

  // 5. Stamp control-ui/index.html
  const indexPath = path.join(control, 'index.html');
  if (fs.existsSync(indexPath)) {
    const originalIndex = fs.readFileSync(indexPath, 'utf8');
    const stampedIndex = stampIndexHtml(originalIndex, hashes);
    const stampedIndexBytes = Buffer.from(stampedIndex, 'utf8');
    if (check) {
      if (!fs.readFileSync(indexPath).equals(stampedIndexBytes)) {
        throw new Error('Stale asset hashes in index.html');
      }
    } else if (writeIfChanged(indexPath, stampedIndexBytes)) {
      modifiedFiles.push(indexPath);
    }
  }

  // 6. Refresh OpenClaw 2026.10+ precompressed twins / asset-manifest.json if present
  if (!check && fs.existsSync(path.join(control, 'asset-manifest.json'))) {
    for (const rel of allFiles) {
      if (/^assets\/index-[^/]+\.js$/.test(rel)) {
        refreshPrecompressed(path.join(control, rel), {
          extraFiles: fs.existsSync(indexPath) ? [indexPath] : [],
        });
      }
    }
  }

  // 7. Refresh pinkie-ui-manifest.json if present (or if --manifest requested)
  const uiManifestPath = path.join(control, UI_MANIFEST_JSON);
  if (!check && (fs.existsSync(uiManifestPath) || manifestOutput)) {
    const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
    const injections = [];
    for (const m of html.matchAll(TAG_RE)) {
      const ref = REF_RE.exec(m[0]);
      if (ref && isOwnedEntry(ref[3]) && refPath(ref[3]) !== 'laolao-handoff-bootstrap.js') {
        injections.push(m[0]);
      }
    }
    const resources = {};
    const currentFiles = walkFiles(control);
    const includeIndex = fs.existsSync(path.join(repoRoot, 'ui/control-ui.index.html'))
      || (fs.existsSync(uiManifestPath) && Boolean(JSON.parse(fs.readFileSync(uiManifestPath, 'utf8'))?.resources?.['index.html']));
    if (includeIndex && fs.existsSync(indexPath)) {
      const data = fs.readFileSync(indexPath);
      resources['index.html'] = {sha256: sha256(data), bytes: data.length};
    }
    for (const rel of currentFiles) {
      if (rel === ASSET_MANIFEST_JS || rel === HEAD_FRAGMENT || isManifestResource(rel) || rel.startsWith('assets/')) {
        if (rel === UI_MANIFEST_JSON || RUNTIME_DATA.has(rel)) continue;
        const data = fs.readFileSync(path.join(control, rel));
        resources[rel] = {sha256: sha256(data), bytes: data.length};
      }
    }
    const manifestObj = {schema: 1, injections, resources};
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj, null, 2) + '\n', 'utf8');
    if (fs.existsSync(uiManifestPath)) writeIfChanged(uiManifestPath, manifestBytes);
    if (manifestOutput) writeIfChanged(path.resolve(manifestOutput), manifestBytes);
  }

  return {hashes, modifiedFiles};
}

function parseArgs(argv) {
  const options = {root: DEFAULT_ROOT, controlUi: null, check: false, manifestOutput: null};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') options.root = argv[++i];
    else if (arg === '--control-ui') options.controlUi = argv[++i];
    else if (arg === '--manifest' || arg === '--output') options.manifestOutput = argv[++i];
    else if (arg === '--check') options.check = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.controlUi) {
    throw new Error('Usage: node tools/assets/stamp.mjs --control-ui <dir> [--root <repo>] [--manifest <file>] [--check]');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    stampControlUi(opts.controlUi, opts);
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
