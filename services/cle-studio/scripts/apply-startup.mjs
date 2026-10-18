#!/usr/bin/env node
/**
 * apply-startup.mjs — put the C.le. startup layer in front of the native first paint.
 *
 * The Control UI serves index.html unchanged, and that file carries upstream branding in its
 * own markup: <title>OpenClaw Control</title>, a lobster favicon, dark #0e1015 for html/body and
 * the claw red accent. The cle-studio plugin can only fix those after its bundle downloads, so
 * refreshes show the old product for a moment. This patch writes the brand cleanup and the
 * first-paint tokens *into the HTML*, where they are parsed before anything is painted, and
 * needs no inline script (the gateway CSP allows inline style, not inline script).
 *
 * Surfaces patched:
 *   index.html              served document
 *   sw.js OFFLINE_BOOT.html the service worker's offline copy of the same document
 *   manifest.webmanifest    installed-window name and colours
 *
 * Safety:
 *   - the target must be passed explicitly; nothing is discovered from the live profile
 *   - /Applications/** and the live ~/.openclaw profile are refused outright
 *   - the build must be the 2026.10 Control UI shape (inline boot graph + handshaked CSP)
 *   - the CSP must allow inline style, otherwise the layer would be blocked and the flash
 *     would simply move; the script refuses instead
 *   - every write is idempotent, and the first write keeps a byte-exact backup
 *
 * Usage:
 *   node apply-startup.mjs --control-ui <path/to/dist/control-ui> [--css <startup.css>]
 *                          [--check] [--revert] [--json]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const MARKER = '/* pinkie-cle-startup:v1 */';
const BEGIN = '<!-- pinkie-cle-startup:begin do not edit by hand -->';
const END = '<!-- pinkie-cle-startup:end -->';
const BACKUP_DIR = '.pinkie-startup-backup';
// The supplied portrait, copied to the sizes a tab strip and an installed window ask for.
// These replace the packaged lobster bytes rather than the <link> tags: the app rewrites
// `link[rel="icon"][type="image/png"]` back to favicon-32.png at boot, so rewriting only the
// markup is undone a second later. Replacing the files makes every rewrite a no-op.
const ICON_DIR = fileURLToPath(new URL('../static/startup/', import.meta.url));
const ICON_ASSETS = {
  'favicon-32.png': 'icon-32.png',
  'apple-touch-icon.png': 'icon-180.png',
  'favicon.svg': 'favicon.svg',
};
const PAPER = '#F4EFE4';
const NIGHT = '#0A0D16';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSS = path.join(here, '..', 'static', 'startup.css');

/** Refuse anything that would touch the signed App bundle or the live operator profile. */
export function refuseReason(target) {
  const resolved = path.resolve(target);
  const segments = resolved.split(path.sep);
  if (resolved.includes('/Contents/Resources/SuperPinkie')) return 'refusing the bundled SuperPinkie runtime';
  const apps = segments.some((segment) => segment === 'Applications');
  if (apps && segments.some((segment) => segment.endsWith('.app'))) return 'refusing a packaged .app bundle';
  const home = os.homedir();
  if (resolved === path.join(home, '.openclaw') || resolved.startsWith(path.join(home, '.openclaw') + path.sep)) {
    return 'refusing the live ~/.openclaw profile';
  }
  if (!path.isAbsolute(resolved)) return 'control-ui path must be absolute';
  return null;
}

function parseArgs(argv) {
  const out = {check: false, revert: false, json: false};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--control-ui') out.controlUi = argv[++i];
    else if (arg === '--css') out.css = argv[++i];
    else if (arg === '--check') out.check = true;
    else if (arg === '--revert') out.revert = true;
    else if (arg === '--json') out.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.controlUi) throw new Error('--control-ui <path> is required (explicit test runtime path)');
  return out;
}

/** Balanced-brace JSON literal reader: strings and nesting both honoured. */
export function readJsonLiteral(source, start) {
  let index = start;
  while (index < source.length && source[index] !== '{') index += 1;
  if (index >= source.length) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = index; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return {text: source.slice(index, i + 1), start: index, end: i + 1};
    }
  }
  return null;
}

/** The CSP that will guard this document: offline shell first, then the server-side table. */
export function readCsp(root) {
  const swPath = path.join(root, 'sw.js');
  if (fs.existsSync(swPath)) {
    const source = fs.readFileSync(swPath, 'utf8');
    const anchor = source.indexOf('const OFFLINE_BOOT = ');
    const literal = anchor < 0 ? null : readJsonLiteral(source, anchor);
    if (literal) {
      try {
        const boot = JSON.parse(literal.text);
        if (typeof boot.csp === 'string') return boot.csp;
      } catch {}
    }
  }
  const dist = path.dirname(root);
  for (const name of fs.readdirSync(dist)) {
    if (!/^control-ui-[A-Za-z0-9_-]+\.mjs$/u.test(name)) continue;
    const source = fs.readFileSync(path.join(dist, name), 'utf8');
    if (!source.includes('buildControlUiCspHeader')) continue;
    const style = /"style-src ([^"]+)"/u.exec(source);
    if (style) return `style-src ${style[1]}`;
  }
  return null;
}

export function styleAllowed(csp) {
  if (!csp) return false;
  const directive = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('style-src'));
  return Boolean(directive && /'unsafe-inline'/u.test(directive));
}

/** Brand-facing head edits; each anchor must exist exactly once or the build is not ours to touch. */
export function rewriteHead(html) {
  const changes = [];
  const replaceOnce = (pattern, to, label) => {
    const hits = html.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
    if (!hits || hits.length !== 1) throw new Error(`无法唯一确认 ${label}（命中 ${hits ? hits.length : 0}）`);
    html = html.replace(pattern, to);
    changes.push(label);
  };
  if (/<title>OpenClaw Control<\/title>/u.test(html)) {
    replaceOnce(/<title>OpenClaw Control<\/title>/u, '<title>C.le.</title>', 'title');
  }
  // The failure panel is static markup in index.html, so it is readable with no bundle at all —
  // which also means the plugin can never reach it. Its eyebrow still said OpenClaw.
  if (html.includes('>OpenClaw Control UI</p>')) {
    html = html.replace(/>OpenClaw Control UI<\/p>/u, '>C.le. Studio</p>');
    changes.push('fallback eyebrow');
  }
  // Favicons (svg, png, apple-touch) are handled by replacing the packaged files — see
  // replaceIcons. The app rewrites all of these hrefs at boot, so markup alone would be undone.
  // Window chrome colour: mirror the C.le. paper/night pair instead of claw's near-black.
  html = html.replace(/(<meta name="theme-color" media="\(prefers-color-scheme: light\)" content=")[^"]*"/gu, `$1${PAPER}"`);
  html = html.replace(/(<meta name="theme-color" media="\(prefers-color-scheme: dark\)" content=")[^"]*"/gu, `$1${NIGHT}"`);
  return {html, changes};
}

/**
 * Insert (or refresh) the startup layer. The block is delimited so a later CSS change
 * replaces the old bytes instead of stacking a second copy.
 */
export function injectLayer(html, css) {
  const block = `${BEGIN}\n<style data-cle-startup>\n${MARKER}\n${css.trim()}\n</style>\n${END}`;
  const existing = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u');
  if (existing.test(html)) {
    const next = html.replace(existing, block);
    return {html: next, changed: next !== html};
  }
  const heads = html.match(/<\/head>/gu) || [];
  if (heads.length !== 1) throw new Error(`</head> 必须唯一（命中 ${heads.length}）`);
  return {html: html.replace('</head>', `${block}\n  </head>`), changed: true};
}

/** True when this document already is the 2026.10 Control UI shape. */
export function isTargetBuild(html) {
  const id = /data-openclaw-control-ui-build-id="([^"]+)"/u.exec(html)?.[1] || '';
  return {id, ok: /^2026\.(?:10|11|12)\./u.test(id), hasApp: html.includes('<openclaw-app'), hasFallback: html.includes('openclaw-mount-fallback')};
}

function backupOnce(root, file) {
  // A file the build does not ship (an older build's favicon.svg, say) has nothing to back up;
  // revert then simply leaves the added file in place, which restore() reports.
  if (!fs.existsSync(file)) return null;
  const dir = path.join(root, BACKUP_DIR);
  fs.mkdirSync(dir, {recursive: true});
  const target = path.join(dir, path.basename(file) + '.orig');
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
  return target;
}

function writeAtomic(file, content) {
  const temp = `${file}.pinkie-startup-tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

/**
 * Replace the packaged lobster icon bytes with the supplied portrait.
 *
 * The Control UI rewrites `link[rel="icon"][type="image/png"]` to favicon-32.png and
 * `link[rel="apple-touch-icon"]` to apple-touch-icon.png during boot, so any markup-only fix is
 * reverted within a second. Substituting the files makes those rewrites land on his face instead.
 * Byte-identical files are left alone, which keeps re-runs free.
 */
export function replaceIcons(root, {iconDir = ICON_DIR} = {}) {
  const replaced = [];
  for (const [target, source] of Object.entries(ICON_ASSETS)) {
    const file = path.join(root, target);
    const donor = path.join(iconDir, source);
    if (!fs.existsSync(donor)) throw new Error(`missing supplied icon ${donor}`);
    const bytes = fs.readFileSync(donor);
    const png = bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG';
    const svg = /^\s*<svg[\s>]/u.test(bytes.toString('utf8', 0, 32));
    if (!bytes.length || (target.endsWith('.svg') ? !svg : !png)) throw new Error(`${donor} is not ${target.endsWith('.svg') ? 'an SVG' : 'a PNG'}`);
    if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) continue;
    backupOnce(root, file);
    writeAtomic(file, bytes);
    replaced.push(target);
  }
  return replaced;
}

/** Keep .br/.gz twins and the manifest honest when a patched file has them. */
function refreshTwins(root, file) {
  const report = {twins: [], manifest: 'n/a'};
  const source = fs.readFileSync(file);
  for (const [suffix, decode, encode] of [
    ['.br', zlib.brotliDecompressSync, zlib.brotliCompressSync],
    ['.gz', zlib.gunzipSync, zlib.gzipSync],
  ]) {
    const twin = file + suffix;
    if (!fs.existsSync(twin)) continue;
    let same = false;
    try { same = decode(fs.readFileSync(twin)).equals(source); } catch { same = false; }
    if (!same) fs.writeFileSync(twin, encode(source));
    report.twins.push(path.basename(twin));
  }
  const manifestPath = path.join(root, 'asset-manifest.json');
  if (!fs.existsSync(manifestPath)) return report;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.assets)) return report;
  let dirty = false;
  for (const asset of manifest.assets) {
    const absolute = path.join(root, asset.path);
    if (absolute !== file && absolute !== file + '.br' && absolute !== file + '.gz') continue;
    if (!fs.existsSync(absolute)) continue;
    const bytes = fs.readFileSync(absolute);
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (asset.sha256 !== sha || asset.size !== bytes.length) {
      asset.sha256 = sha;
      asset.size = bytes.length;
      dirty = true;
    }
  }
  if (dirty) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    report.manifest = 'updated';
  }
  return report;
}

export function applyLayer(root, {cssPath = DEFAULT_CSS, check = false} = {}) {
  const reason = refuseReason(root);
  if (reason) throw new Error(reason);
  const indexFile = path.join(root, 'index.html');
  const manifestFile = path.join(root, 'asset-manifest.json');
  if (!fs.existsSync(indexFile)) throw new Error(`not a Control UI root: ${indexFile}`);
  if (!fs.existsSync(manifestFile)) throw new Error(`asset-manifest.json missing under ${root}`);
  const css = fs.readFileSync(cssPath, 'utf8');
  if (!css.includes('html:not([data-cle])')) throw new Error('startup.css must scope first-paint tokens to html:not([data-cle])');
  if (!/\.community-invite-card/u.test(css) || !/\.agent-chat__welcome-clawd/u.test(css)) throw new Error('startup.css is missing the brand cleanup rules');

  const original = fs.readFileSync(indexFile, 'utf8');
  const build = isTargetBuild(original);
  if (!build.ok) throw new Error(`unsupported Control UI build "${build.id || 'none'}"; this patch targets 2026.10+`);
  if (!build.hasApp) throw new Error('index.html has no <openclaw-app> mount point');
  const csp = readCsp(root);
  if (!styleAllowed(csp)) throw new Error(`inline style is not allowed by the gateway CSP (${csp || 'not found'}); the layer would be blocked`);

  const head = rewriteHead(original);
  const injected = injectLayer(head.html, css);
  const indexNext = injected.html;
  const indexChanged = indexNext !== original;

  const result = {root, csp: csp.slice(0, 120) + '…', headChanges: head.changes, index: indexChanged ? 'patched' : 'unchanged', offlineShell: 'skipped', manifest: 'unchanged', twins: []};
  result.icons = [];
  if (check) {
    result.index = original.includes(MARKER) ? 'present' : 'missing';
    result.icons = Object.keys(ICON_ASSETS).filter((name) => {
      const file = path.join(root, name);
      const donor = path.join(ICON_DIR, ICON_ASSETS[name]);
      return fs.existsSync(file) && fs.existsSync(donor) && fs.readFileSync(file).equals(fs.readFileSync(donor));
    });
    return result;
  }

  if (indexChanged) {
    backupOnce(root, indexFile);
    writeAtomic(indexFile, indexNext);
    Object.assign(result, refreshTwins(root, indexFile));
  }
  // Files first: the app rewrites the <link> hrefs to these names at boot anyway.
  result.icons = replaceIcons(root);

  // Offline shell: the same document, embedded in the worker. Without this an offline
  // navigation would restore the pre-patch first frame.
  const swFile = path.join(root, 'sw.js');
  if (fs.existsSync(swFile)) {
    const sw = fs.readFileSync(swFile, 'utf8');
    const anchor = sw.indexOf('const OFFLINE_BOOT = ');
    const literal = anchor < 0 ? null : readJsonLiteral(sw, anchor);
    if (literal) {
      const boot = JSON.parse(literal.text);
      const offline = injectLayer(rewriteHead(String(boot.html)).html, css);
      if (String(boot.html) !== offline.html) {
        boot.html = offline.html;
        // The worker names its cache after this id; moving it retires the stale shell
        // instead of letting a previous build's HTML win offline.
        boot.id = crypto.createHash('sha256').update(offline.html).digest('hex').slice(0, 16);
        backupOnce(root, swFile);
        writeAtomic(swFile, sw.slice(0, literal.start) + JSON.stringify(boot) + sw.slice(literal.end));
        Object.assign(result, {offlineShell: 'patched'}, refreshTwins(root, swFile));
      } else result.offlineShell = 'unchanged';
    }
  }

  // Installed window: name and splash colours are read before any HTML exists.
  const webmanifest = path.join(root, 'manifest.webmanifest');
  if (fs.existsSync(webmanifest)) {
    const raw = fs.readFileSync(webmanifest, 'utf8');
    const data = JSON.parse(raw);
    const wanted = {name: 'C.le.', short_name: 'C.le.', theme_color: PAPER, background_color: PAPER};
    let changed = false;
    for (const [key, value] of Object.entries(wanted)) if (data[key] !== value) { data[key] = value; changed = true; }
    // Icon entries keep their packaged paths on purpose: those files now hold his portrait
    // (replaceIcons), and the app rewrites these hrefs to the same paths at boot anyway.
    // Only the declared type has to stay truthful.
    if (Array.isArray(data.icons)) {
      for (const icon of data.icons) {
        const wanted = /\.svg(?:$|\?)/u.test(icon.src) ? 'image/svg+xml' : 'image/png';
        if (icon.type !== wanted) { icon.type = wanted; changed = true; }
      }
    }
    if (changed) {
      backupOnce(root, webmanifest);
      writeAtomic(webmanifest, JSON.stringify(data, null, 2) + '\n');
      result.manifest = 'patched';
    }
  }
  return result;
}

export function revert(root) {
  const reason = refuseReason(root);
  if (reason) throw new Error(reason);
  const dir = path.join(root, BACKUP_DIR);
  if (!fs.existsSync(dir)) return {restored: []};
  const restored = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.orig')) continue;
    const original = name.replace(/\.orig$/u, '');
    fs.copyFileSync(path.join(dir, name), path.join(root, original));
    restored.push(original);
  }
  return {restored};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.revert) {
      const out = revert(args.controlUi);
      console.log(args.json ? JSON.stringify(out) : `restored: ${out.restored.join(', ') || '(nothing)'}`);
    } else {
      const out = applyLayer(args.controlUi, {cssPath: args.css ? path.resolve(args.css) : DEFAULT_CSS, check: args.check});
      if (args.json) console.log(JSON.stringify(out));
      else console.log([`root       ${out.root}`, `index      ${out.index}`, `offline    ${out.offlineShell}`, `manifest   ${out.manifest}`, `head       ${out.headChanges.join(', ') || '(already)'}`, `icons      ${out.icons.join(', ') || '(already)'}`, `twins      ${out.twins.join(', ') || '(none)'}`].join('\n'));
    }
  } catch (error) {
    console.error(`apply-startup: ${error.message}`);
    process.exit(1);
  }
}
