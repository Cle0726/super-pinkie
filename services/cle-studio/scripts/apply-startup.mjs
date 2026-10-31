#!/usr/bin/env node
/**
 * apply-startup.mjs — put the C.le. startup layer in front of the native first paint.
 *
 * The Control UI serves index.html unchanged, and that file carries upstream branding in its
 * own markup: the "OpenClaw Control" title, a lobster favicon, dark #0e1015 for html/body and
 * the claw red accent. The cle-studio plugin can only fix those after its bundle downloads, so
 * refreshes show the old product for a moment. This patch writes the brand cleanup and the
 * first-paint tokens *into the HTML*, where they are parsed before anything is painted, and
 * needs no inline script (the gateway CSP allows inline style, not inline script).
 *
 * Surfaces patched:
 *   index.html              served document
 *   sw.js OFFLINE_BOOT.html the service worker's offline copy of the same document
 *   manifest.webmanifest    installed-window name and colours
 *   favicon*.png/svg        packaged icon bytes (the app rewrites the <link> hrefs at boot)
 *
 * Safety:
 *   - the target must be an absolute path passed explicitly; nothing is discovered
 *   - the signed App bundle and the live ~/.openclaw profile are refused, and the check runs on
 *     the real path too, so a symlink in a scratch directory cannot reach them
 *   - every individual write is re-checked against the root's real path, and writing through a
 *     symlink is refused outright
 *   - the build must be the 2026.10 Control UI shape (inline boot graph + handshaked CSP)
 *   - the CSP must allow inline style, otherwise the layer would be blocked and the flash
 *     would simply move; the script refuses instead
 *   - every write is idempotent, and the first write of *every* touched file (including the
 *     precompressed twins and the asset manifest) keeps a byte-exact backup
 *
 * Usage:
 *   node apply-startup.mjs --control-ui <absolute path/to/dist/control-ui> [--css <startup.css>]
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
// The early guard ships as its own same-origin file. It must be a classic script in <head>: the
// app's entry is type="module", which the browser defers until the document is parsed, so a
// synchronous classic script placed before it runs first. CSP allows `script-src 'self'` here, so
// no inline script (and no policy change) is involved.
const EARLY_BEGIN = '<!-- pinkie-cle-early:begin do not edit by hand -->';
const EARLY_END = '<!-- pinkie-cle-early:end -->';
const EARLY_SRC = '/cle-early.js';
const BACKUP_DIR = '.pinkie-startup-backup';
const LEDGER = 'ledger.json';
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

const LIVE_PROFILE = (() => {
  const home = os.homedir();
  return path.join(home, '.openclaw');
})();

function isInside(candidate, root) {
  if (!candidate || !root) return false;
  const resolvedRoot = path.resolve(root);
  return candidate === resolvedRoot || candidate.startsWith(resolvedRoot + path.sep);
}

/** Every form of a path a boundary check should consider, including symlink targets. */
function pathForms(target) {
  const forms = new Set();
  const resolved = path.resolve(target);
  forms.add(resolved);
  try {
    forms.add(fs.realpathSync(resolved));
  } catch {
    // Not created yet: the nearest existing ancestor still has to resolve inside the boundary.
    let probe = resolved;
    while (probe !== path.dirname(probe) && !fs.existsSync(probe)) probe = path.dirname(probe);
    try {
      forms.add(fs.realpathSync(probe));
    } catch {}
  }
  return [...forms];
}

/**
 * Refuse anything that would touch the signed App bundle or a protected profile.
 *
 * `extraProtected` exists so tests can point the boundary at a scratch directory instead of
 * writing near the live profile. It is never set by the CLI, so the shipped default stands.
 */
export function refuseReason(target, {extraProtected = []} = {}) {
  if (typeof target !== 'string' || !target.trim()) return 'control-ui path is required';
  // Check the caller's string, not a normalised one: path.resolve() turns "dist/x" into an
  // absolute path, which would make the absolute-path requirement vacuous.
  if (!path.isAbsolute(target)) return 'control-ui path must be absolute';

  const protectedRoots = [LIVE_PROFILE, ...extraProtected].filter(Boolean);
  // Normalise both sides the same way. On macOS /var is a symlink to /private/var, so a real
  // path on one side and a literal path on the other would never compare equal.
  const protectedForms = protectedRoots.flatMap((root) => pathForms(root));
  for (const form of pathForms(target)) {
    if (form.includes('/Contents/Resources/SuperPinkie')) return 'refusing the bundled SuperPinkie runtime';
    const segments = form.split(path.sep);
    if (segments.some((segment) => segment === 'Applications') && segments.some((segment) => segment.endsWith('.app'))) {
      return 'refusing a packaged .app bundle';
    }
    for (const protectedForm of protectedForms) {
      if (!isInside(form, protectedForm)) continue;
      const liveForms = pathForms(LIVE_PROFILE);
      const isLive = liveForms.includes(protectedForm);
      return `refusing ${isLive ? 'the live ~/.openclaw profile' : `the protected path ${protectedRoots.find((root) => pathForms(root).includes(protectedForm)) ?? protectedForm}`}`;
    }
  }
  return null;
}

/**
 * Guard one concrete write. The root may itself be reached through a symlink, so the comparison
 * is between real paths; a target that is a symlink is refused instead of followed.
 */
export function assertWritableTarget(root, file) {
  const realRoot = pathForms(root).at(-1);
  const resolvedFile = path.resolve(file);

  let stat = null;
  try {
    stat = fs.lstatSync(resolvedFile);
  } catch {}
  if (stat?.isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${resolvedFile}`);

  const parent = path.dirname(resolvedFile);
  let realParent = parent;
  try {
    realParent = fs.realpathSync(parent);
  } catch {
    let probe = parent;
    while (probe !== path.dirname(probe) && !fs.existsSync(probe)) probe = path.dirname(probe);
    try {
      realParent = fs.realpathSync(probe);
    } catch {}
  }
  if (!isInside(realParent, realRoot)) throw new Error(`refusing to write outside ${realRoot}: ${resolvedFile}`);
  return resolvedFile;
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
export function rewriteHead(html, {token = null} = {}) {
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
  // The token matters even so: it makes the *first* request a URL no browser has cached (the
  // gateway's ?v=build-id form is immutable for a year), without touching the build id itself.
  if (token) {
    for (const name of Object.keys(ICON_ASSETS)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const pattern = new RegExp(`(href=")\\.?/?${escaped}(")`, 'gu');
      if (!pattern.test(html)) continue;
      html = html.replace(pattern, `$1./${name}?cle=${token}$2`);
      changes.push(`${name} cache token`);
    }
  }
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

/**
 * Insert the early-guard <script> before the app's module entry.
 *
 * Placement is the whole point: index.html loads the app as
 *     <script type="module" crossorigin src="./assets/index-*.js"></script>
 * and a module script is deferred by default, so a classic script that appears earlier in the
 * document executes first. Anchoring to the module tag (rather than to </head>) keeps that
 * ordering even if the head grows other scripts later.
 */
export function injectEarlyGuard(html, {src = EARLY_SRC} = {}) {
  const block = `${EARLY_BEGIN}\n  <script data-cle-early src="${src}"></script>\n  ${EARLY_END}`;
  const existing = new RegExp(`${EARLY_BEGIN.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\\s\\S]*?${EARLY_END.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u');
  if (existing.test(html)) {
    const next = html.replace(existing, block);
    return {html: next, changed: next !== html};
  }
  // A single module entry is the shape this patch targets; anything else is not ours to guess at.
  const entries = [...html.matchAll(/<script[^>]*\btype="module"[^>]*><\/script>/gu)];
  if (entries.length !== 1) throw new Error(`module entry 必须唯一（命中 ${entries.length}）`);
  const at = entries[0].index;
  return {html: `${html.slice(0, at)}${block}\n  ${html.slice(at)}`, changed: true};
}

/** True when this document already is the 2026.10 Control UI shape. */
export function isTargetBuild(html) {
  const id = /data-openclaw-control-ui-build-id="([^"]+)"/u.exec(html)?.[1] || '';
  return {id, ok: /^2026\.(?:10|11|12)\./u.test(id), hasApp: html.includes('<openclaw-app'), hasFallback: html.includes('openclaw-mount-fallback')};
}

/**
 * Content fingerprint used as an icon cache key.
 *
 * The gateway rewrites `href="./favicon-32.png"` to `?v=<build-id>` and serves that URL with
 * `immutable, max-age=31536000`. Replacing the icon bytes alone therefore changes nothing for a
 * browser that already fetched them: same URL, so the lobster stays for a year.
 *
 * The build id itself must not move — the gateway parses it as `<base>-<64 hex>` and treats any
 * other shape as a stale asset tree, which would rebuild the whole UI. Instead each icon href
 * carries its own token, so the gateway's replacement (which matches the bare href) no longer
 * applies, and the first paint requests a URL nobody has cached. Once the app boots it rewrites
 * these hrefs to the plain names, which the gateway serves `no-cache`, so revalidation wins.
 */
export function iconToken(iconDir = ICON_DIR) {
  const digest = crypto.createHash('sha256');
  for (const name of Object.keys(ICON_ASSETS).sort()) {
    const file = path.join(iconDir, ICON_ASSETS[name]);
    if (fs.existsSync(file)) digest.update(fs.readFileSync(file));
  }
  return digest.digest('hex').slice(0, 12);
}

/** Relative, posix-style name used as the ledger key. */
function ledgerKey(root, file) {
  return path.relative(path.resolve(root), path.resolve(file)).split(path.sep).join('/');
}

function readLedger(root) {
  const file = path.join(root, BACKUP_DIR, LEDGER);
  if (!fs.existsSync(file)) return {files: {}};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data.files === 'object' && data.files) return data;
  } catch {}
  return {files: {}};
}

function writeLedger(root, ledger) {
  const dir = path.join(root, BACKUP_DIR);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, LEDGER), JSON.stringify(ledger, null, 2) + '\n');
}

/**
 * Record a file's original state exactly once, then write.
 *
 * The ledger remembers whether the file existed at all: a twin the build never shipped has to be
 * *removed* on revert, not restored from a backup that was never taken.
 */
function backupOnce(root, file) {
  const key = ledgerKey(root, file);
  const ledger = readLedger(root);
  if (ledger.files[key]) return ledger.files[key];
  const exists = fs.existsSync(file);
  const dir = path.join(root, BACKUP_DIR);
  const target = path.join(dir, key.replaceAll('/', '__') + '.orig');
  // The first backup wins. A backup left by an earlier run — possibly one that predates the
  // ledger — holds the only copy of the original bytes; overwriting it here would replace the
  // pristine file with an already-patched one and make revert a silent no-op.
  if (exists && !fs.existsSync(target)) {
    fs.mkdirSync(dir, {recursive: true});
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(file, target);
  }
  ledger.files[key] = {existed: exists};
  writeLedger(root, ledger);
  return ledger.files[key];
}

function writeAtomic(root, file, content) {
  const target = assertWritableTarget(root, file);
  const temp = `${target}.pinkie-startup-tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, target);
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
  const refreshed = [];
  for (const [target, source] of Object.entries(ICON_ASSETS)) {
    const file = path.join(root, target);
    const donor = path.join(iconDir, source);
    if (!fs.existsSync(donor)) throw new Error(`missing supplied icon ${donor}`);
    const bytes = fs.readFileSync(donor);
    const png = bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG';
    const svg = /^\s*<svg[\s>]/u.test(bytes.toString('utf8', 0, 32));
    if (!bytes.length || (target.endsWith('.svg') ? !svg : !png)) throw new Error(`${donor} is not ${target.endsWith('.svg') ? 'an SVG' : 'a PNG'}`);
    if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) continue;
    assertWritableTarget(root, file);
    backupOnce(root, file);
    writeAtomic(root, file, bytes);
    replaced.push(target);
    // An icon with a precompressed twin or a manifest row must refresh both, or a cache can
    // still serve the lobster (or fail an integrity check) after the bytes changed.
    refreshed.push(...refreshTwins(root, file).twins.map((name) => `${target}:${name}`));
  }
  return {replaced, refreshed};
}

/**
 * Keep .br/.gz twins and the manifest honest when a patched file has them.
 *
 * Everything written here is backed up first, so revert can restore the compressed copies and
 * the sha256/size rows — not just the raw file.
 */
export function refreshTwins(root, file) {
  const report = {twins: [], manifest: 'n/a'};
  assertWritableTarget(root, file);
  const source = fs.readFileSync(file);
  for (const [suffix, decode, encode] of [
    ['.br', zlib.brotliDecompressSync, zlib.brotliCompressSync],
    ['.gz', zlib.gunzipSync, zlib.gzipSync],
  ]) {
    const twin = file + suffix;
    if (!fs.existsSync(twin)) continue;
    let same = false;
    try { same = decode(fs.readFileSync(twin)).equals(source); } catch { same = false; }
    if (!same) {
      assertWritableTarget(root, twin);
      backupOnce(root, twin);
      fs.writeFileSync(twin, encode(source));
    }
    report.twins.push(path.basename(twin));
  }
  const manifestPath = path.join(root, 'asset-manifest.json');
  if (!fs.existsSync(manifestPath)) return report;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.assets)) return report;
  const relative = path.relative(root, file).split(path.sep).join('/');
  // The manifest only describes `assets/**`; root documents, the worker and the icons are not in
  // it, and the gateway's parser rejects any path outside `assets/`. Adding rows for them would
  // make the whole manifest unparseable, which is worse than leaving it alone. Their freshness is
  // carried by the build id and the `?cle=` icon token instead.
  if (!relative.startsWith('assets/') && !relative.startsWith('assets' + path.sep)) return report;
  let dirty = false;
  const wanted = new Set([relative]);
  for (const suffix of ['.br', '.gz']) if (fs.existsSync(file + suffix)) wanted.add(relative + suffix);
  for (const asset of manifest.assets) {
    if (!wanted.has(asset.path)) continue;
    const absolute = path.join(root, asset.path);
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
    // Upstream derives `generation` from the (path, size, sha256) lines, so a manifest whose
    // rows moved but whose generation did not is internally inconsistent for any consumer that
    // validates it. Recompute it the same way instead of leaving a stale digest behind.
    if (typeof manifest.generation === 'string') {
      const digest = crypto.createHash('sha256');
      for (const entry of manifest.assets) digest.update(`${entry.path}\0${entry.size}\0${entry.sha256}\n`);
      manifest.generation = digest.digest('hex');
    }
    assertWritableTarget(root, manifestPath);
    backupOnce(root, manifestPath);
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

  const token = iconToken();
  const head = rewriteHead(original, {token});
  const injected = injectLayer(head.html, css);
  // The early guard is inserted last so it also lands inside every document this patch writes
  // (offline shell included), and always before the deferred module entry.
  const early = injectEarlyGuard(injected.html);
  const indexNext = early.html;
  const indexChanged = indexNext !== original;

  const result = {root, csp: csp.slice(0, 120) + '…', headChanges: head.changes, index: indexChanged ? 'patched' : 'unchanged', offlineShell: 'skipped', manifest: 'unchanged', twins: [], icons: [], earlyGuard: 'skipped', changed: false};
  if (check) {
    result.index = original.includes(MARKER) ? 'present' : 'missing';
    result.earlyGuard = original.includes(EARLY_BEGIN) && fs.existsSync(path.join(root, 'cle-early.js')) ? 'present' : 'missing';
    const applied = [];
    for (const [target, source] of Object.entries(ICON_ASSETS)) {
      const file = path.join(root, target);
      const donor = path.join(ICON_DIR, source);
      if (fs.existsSync(file) && fs.existsSync(donor) && fs.readFileSync(file).equals(fs.readFileSync(donor))) applied.push(target);
    }
    result.icons = applied;
    return result;
  }

  // ---- validate every input and every write target before touching the root ----
  //
  // A half-applied document is worse than no deployment: if index.html gained a <script> that
  // points at a file we then failed to write, the browser 404s and the title window reopens. So
  // the whole run is planned first and committed only after every precondition holds.
  const earlySource = path.join(path.dirname(cssPath), 'early-guard.js');
  if (!fs.existsSync(earlySource)) throw new Error(`missing early guard source: ${earlySource}`);
  const earlyBytes = fs.readFileSync(earlySource);
  if (!earlyBytes.length) throw new Error(`early guard source is empty: ${earlySource}`);
  if (!earlyBytes.toString('utf8').includes('cleEarlyBrandGuard')) {
    throw new Error(`early guard source does not look like the guard: ${earlySource}`);
  }
  const earlyTarget = path.join(root, 'cle-early.js');
  const swTarget = path.join(root, 'sw.js');
  const webmanifestTarget = path.join(root, 'manifest.webmanifest');

  // Icon donors are read before any write, so a missing or corrupt donor cannot leave a
  // half-substituted icon set behind.
  for (const [target, source] of Object.entries(ICON_ASSETS)) {
    const donor = path.join(ICON_DIR, source);
    if (!fs.existsSync(donor)) throw new Error(`missing supplied icon ${donor}`);
    const bytes = fs.readFileSync(donor);
    const png = bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG';
    const svg = /^\s*<svg[\s>]/u.test(bytes.toString('utf8', 0, 32));
    if (!bytes.length || (target.endsWith('.svg') ? !svg : !png)) {
      throw new Error(`${donor} is not ${target.endsWith('.svg') ? 'an SVG' : 'a PNG'}`);
    }
    assertWritableTarget(root, path.join(root, target));
  }
  for (const file of [indexFile, earlyTarget, swTarget, webmanifestTarget, manifestFile]) {
    assertWritableTarget(root, file);
  }

  if (indexChanged) {
    assertWritableTarget(root, indexFile);
    backupOnce(root, indexFile);
    writeAtomic(root, indexFile, indexNext);
    Object.assign(result, refreshTwins(root, indexFile));
  }
  // The referenced file has to exist, or the browser would 404 and the window would reopen.
  const earlyStale = !fs.existsSync(earlyTarget) || !fs.readFileSync(earlyTarget).equals(earlyBytes);
  if (earlyStale) {
    assertWritableTarget(root, earlyTarget);
    backupOnce(root, earlyTarget);
    writeAtomic(root, earlyTarget, earlyBytes);
    Object.assign(result, {earlyGuard: 'patched'}, refreshTwins(root, earlyTarget));
  } else result.earlyGuard = 'unchanged';
  // Files first: the app rewrites the <link> hrefs to these names at boot anyway.
  const icons = replaceIcons(root);
  result.icons = icons.replaced;
  // Icon twins belong in the same report as index/sw twins: they are files this run rewrote.
  if (icons.refreshed.length) result.twins.push(...icons.refreshed);

  // Offline shell: the same document, embedded in the worker. Without this an offline
  // navigation would restore the pre-patch first frame.
  const swFile = path.join(root, 'sw.js');
  if (fs.existsSync(swFile)) {
    const sw = fs.readFileSync(swFile, 'utf8');
    const anchor = sw.indexOf('const OFFLINE_BOOT = ');
    const literal = anchor < 0 ? null : readJsonLiteral(sw, anchor);
    if (literal) {
      const boot = JSON.parse(literal.text);
      // The offline shell must carry the early guard too: an offline navigation paints the same
      // first frames, and without the script the title would sit on the upstream wordmark there.
      const offline = injectEarlyGuard(injectLayer(rewriteHead(String(boot.html), {token}).html, css).html);
      // …and the file it references has to be precached, or an offline reload of the shell asks
      // the network for a script that is not there and the guard silently never runs. Adding it to
      // publicAssets is what makes the worker treat it as a cacheable same-origin public asset.
      const earlyName = 'cle-early.js';
      let assetsDirty = false;
      if (Array.isArray(boot.publicAssets) && !boot.publicAssets.includes(earlyName)) {
        boot.publicAssets = [...boot.publicAssets, earlyName].sort();
        assetsDirty = true;
      }
      // The precache loop iterates OFFLINE_BOOT.assets and verifies each entry's integrity, so the
      // file needs a row there too — publicAssets alone only feeds the version metadata. The row
      // is *upserted*, not merely added: when the script bytes change the integrity must move with
      // them, or the worker rejects the cached copy and the guard silently stops running.
      const earlyForBoot = fs.existsSync(earlyTarget) ? fs.readFileSync(earlyTarget) : earlyBytes;
      const earlyIntegrity = `sha256-${crypto.createHash('sha256').update(earlyForBoot).digest('base64')}`;
      if (Array.isArray(boot.assets)) {
        const existingRow = boot.assets.find((entry) => entry?.path === earlyName);
        if (!existingRow) {
          boot.assets = [...boot.assets, {path: earlyName, integrity: earlyIntegrity}]
            // The shipped list is sorted by plain codepoint order (not localeCompare), so match
            // that exactly and keep the array comparable with the upstream one.
            .sort((left, right) => (String(left?.path) < String(right?.path) ? -1 : String(left?.path) > String(right?.path) ? 1 : 0));
          assetsDirty = true;
        } else if (existingRow.integrity !== earlyIntegrity) {
          existingRow.integrity = earlyIntegrity;
          assetsDirty = true;
        }
      }
      // The cache name must move when any byte the shell depends on moves — the document *or*
      // the guard script. Hashing only the HTML left a stale cache id after a script-only change,
      // so a worker would keep serving the previous script from its cache.
      const cacheSalt = crypto.createHash('sha256').update(offline.html).update(earlyForBoot).digest('hex');
      const nextId = cacheSalt.slice(0, 16);
      const idDirty = boot.id !== nextId;
      if (String(boot.html) !== offline.html || assetsDirty || idDirty) {
        boot.html = offline.html;
        // The worker names its cache after this id; moving it retires the stale shell instead of
        // letting a previous build's HTML or script win offline. Deterministic: identical inputs
        // produce the identical id, so a re-run with the same bytes reports no change.
        boot.id = nextId;
        assertWritableTarget(root, swFile);
        backupOnce(root, swFile);
        writeAtomic(root, swFile, sw.slice(0, literal.start) + JSON.stringify(boot) + sw.slice(literal.end));
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
        const type = /\.svg(?:$|\?)/u.test(icon.src) ? 'image/svg+xml' : 'image/png';
        if (icon.type !== type) { icon.type = type; changed = true; }
      }
    }
    if (changed) {
      assertWritableTarget(root, webmanifest);
      backupOnce(root, webmanifest);
      writeAtomic(root, webmanifest, JSON.stringify(data, null, 2) + '\n');
      result.manifest = 'patched';
    }
  }

  // Any single surface moving counts as a change, including an icon-only update.
  result.changed = indexChanged
    || result.offlineShell === 'patched'
    || result.manifest === 'patched'
    || result.icons.length > 0
    // A script-only update is still a real deployment change: the file, its twin and the worker's
    // cache generation all moved, even though index.html stayed byte-identical.
    || result.earlyGuard === 'patched';
  return result;
}

/**
 * Restore every file the patch touched, including the compressed twins and the manifest, and
 * delete files the build never shipped (a twin created by a previous run, say).
 */
export function revert(root) {
  const reason = refuseReason(root);
  if (reason) throw new Error(reason);
  const dir = path.join(root, BACKUP_DIR);
  if (!fs.existsSync(dir)) return {restored: [], removed: []};
  const ledger = readLedger(root);
  const restored = [];
  const removed = [];

  for (const [key, entry] of Object.entries(ledger.files)) {
    const file = path.join(root, key.split('/').join(path.sep));
    if (entry.existed) {
      const backup = path.join(dir, key.replaceAll('/', '__') + '.orig');
      if (!fs.existsSync(backup)) continue;
      assertWritableTarget(root, file);
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.copyFileSync(backup, file);
      restored.push(key);
    } else if (fs.existsSync(file)) {
      assertWritableTarget(root, file);
      fs.rmSync(file, {force: true});
      removed.push(key);
    }
  }

  // Files from a previous scheme (or a partial run) that only have a flat .orig.
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.orig')) continue;
    const key = name.replace(/\.orig$/u, '').replaceAll('__', '/');
    if (ledger.files[key]) continue;
    const file = path.join(root, key.split('/').join(path.sep));
    if (!fs.existsSync(file)) continue;
    assertWritableTarget(root, file);
    fs.copyFileSync(path.join(dir, name), file);
    restored.push(key);
  }
  return {restored, removed};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.revert) {
      const out = revert(args.controlUi);
      console.log(args.json
        ? JSON.stringify(out)
        : `restored: ${out.restored.join(', ') || '(nothing)'}${out.removed.length ? `\nremoved: ${out.removed.join(', ')}` : ''}`);
    } else {
      const out = applyLayer(args.controlUi, {cssPath: args.css ? path.resolve(args.css) : DEFAULT_CSS, check: args.check});
      if (args.json) console.log(JSON.stringify(out));
      else console.log([`root       ${out.root}`, `index      ${out.index}`, `offline    ${out.offlineShell}`, `manifest   ${out.manifest}`, `head       ${out.headChanges.join(', ') || '(already)'}`, `icons      ${out.icons.join(', ') || '(already)'}`, `twins      ${out.twins.join(', ') || '(none)'}`, `changed    ${out.changed ? 'yes' : 'no'}`].join('\n'));
    }
  } catch (error) {
    console.error(`apply-startup: ${error.message}`);
    process.exit(1);
  }
}
