/**
 * Startup layer: the first frame must already be C.le., and it must fail honestly.
 *
 * These tests run the real patch against fixture documents shaped like the shipped
 * Control UI, then assert on the bytes a browser would receive. They deliberately do
 * not assert "the CSS looks right" — only the properties that would break at runtime:
 * placement in the cascade, idempotency, the offline copy, the CSP gate, and refusal
 * to touch the signed App or the live profile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {applyLayer, revert, refuseReason, styleAllowed, readJsonLiteral, injectLayer, replaceIcons, assertWritableTarget, refreshTwins, injectEarlyGuard} from '../services/cle-studio/scripts/apply-startup.mjs';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/startup.css'), 'utf8');

const BOOT = `<script data-cfasync="false">globalThis.__zod_globalConfig ??= {};</script>`;
const HEAD = (buildId) => `<!doctype html>
<html data-openclaw-control-ui-build-id="${buildId}" lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>OpenClaw Control</title>
    <meta name="color-scheme" content="dark light" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#faf9f7" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e1015" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png" />
    ${BOOT}
    <style>html,body{min-height:100%}html{color-scheme:dark;background:#0e1015}</style>`;

const TAIL = `    <script data-cfasync="false" type="module" crossorigin src="./assets/index-6IbSgfWn.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/control-ui-core-yIvVj14Y.css" />
  </head>
  <body>
    <openclaw-app></openclaw-app>
    <section id="openclaw-mount-fallback" class="mount-fallback" hidden>
      <div class="mount-fallback__panel" tabindex="-1">
        <p class="mount-fallback__eyebrow">OpenClaw Control UI</p>
        <h1 id="openclaw-mount-fallback-title">Control UI did not start</h1>
        <p id="openclaw-mount-fallback-summary">
          The browser loaded the static page, but the app bundle did not start. The gateway may be
          restarting, or this page may reference assets from a different OpenClaw version.
        </p>
        <ul>
          <li>If startup fails, OpenClaw will retry the current app bundle automatically.</li>
          <li>If this persists, reload or try a clean browser profile.</li>
          <li><a href="https://docs.openclaw.ai/web/control-ui#blank-control-ui-page">Control UI troubleshooting</a></li>
        </ul>
        <div class="mount-fallback__actions">
          <button type="button" id="openclaw-mount-retry" class="mount-fallback__button mount-fallback__button--primary">Try again</button>
          <button type="button" id="openclaw-mount-wait" class="mount-fallback__button">Keep waiting</button>
        </div>
      </div>
    </section>
  </body>
</html>
`;

const BUILD_ID = '2026.10.4-release-383c124cc32f-2026-10-15T17-18-22.749Z';
const CSP = "default-src 'self'; script-src 'self' 'sha256-g30CWRMlZumMHvjOkMce6NnzY9k1/zZU+9vzyMq8ETQ='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:";

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** The gateway's own derivation: rows are localeCompare-sorted, then hashed with NUL separators. */
function generationOf(assets) {
  const sorted = [...assets].sort((a, b) => a.path.localeCompare(b.path));
  return crypto.createHash('sha256').update(sorted.map((row) => `${row.path}\0${row.size}\0${row.sha256}\n`).join('')).digest('hex');
}

/**
 * A fixture shaped like the shipped package: index.html with a real precompressed pair, a
 * manifest whose sha256/size/generation rows describe those exact bytes, and sw.js.
 */
function makeRoot({html = HEAD(BUILD_ID) + TAIL, csp = CSP, buildId = BUILD_ID, sw = true, twins = true, manifest = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-startup-'));
  const root = path.join(dir, 'control-ui');
  const dist = path.dirname(root);
  fs.mkdirSync(root, {recursive: true});
  fs.writeFileSync(path.join(root, 'index.html'), html);
  if (twins) {
    fs.writeFileSync(path.join(root, 'index.html.br'), zlib.brotliCompressSync(Buffer.from(html)));
    fs.writeFileSync(path.join(root, 'index.html.gz'), zlib.gzipSync(Buffer.from(html)));
  }
  // the packaged lobster icons the app rewrites its <link> hrefs to
  fs.writeFileSync(path.join(root, 'favicon-32.png'), Buffer.from('lobster'));
  fs.writeFileSync(path.join(root, 'apple-touch-icon.png'), Buffer.from('lobster'));
  fs.writeFileSync(path.join(root, 'favicon.svg'), '<svg viewBox="0 0 120 120"><!-- lobster --></svg>');
  if (sw) {
    const boot = {html: html.replace(/^<!doctype html>\n/, ''), assets: [], csp, publicAssetVersion: 'v1', publicAssets: [], id: 'abc123'};
    fs.writeFileSync(path.join(root, 'sw.js'),
      `const CACHE_PREFIX = "openclaw-control-";\nconst OFFLINE_BOOT = ${JSON.stringify(boot)};\nconst CACHE_NAME = \`x\`;\n`);
  }
  // The manifest rows have to describe the bytes that are on disk *now*, which is why it is
  // written after the icons and the worker exist.
  // The real manifest only lists `assets/**` (the gateway rejects any other path), so the
  // fixture must too — including one asset the patch itself rewrites, to prove rows follow bytes.
  const rows = [];
  if (manifest) {
    fs.mkdirSync(path.join(root, 'assets'), {recursive: true});
    const asset = path.join(root, 'assets', 'index-test.js');
    fs.writeFileSync(asset, html);
    for (const file of [asset]) {
      const bytes = fs.readFileSync(file);
      rows.push({path: path.relative(root, file).split(path.sep).join('/'), sha256: sha256(bytes), size: bytes.length});
    }
  }
  fs.writeFileSync(path.join(root, 'asset-manifest.json'), JSON.stringify({version: 1, generation: generationOf(rows), assets: rows}));
  fs.writeFileSync(path.join(root, 'manifest.webmanifest'), JSON.stringify({
    name: 'OpenClaw Control', short_name: 'OpenClaw', theme_color: '#0a0a0a', background_color: '#0a0a0a',
    icons: [{src: './favicon.svg', sizes: 'any', type: 'image/svg+xml'},
      {src: './favicon-32.png', sizes: '32x32', type: 'image/png'},
      {src: './apple-touch-icon.png', sizes: '180x180', type: 'image/png'}],
  }, null, 2));
  // the CSP source chunk the fallback reader looks for
  fs.writeFileSync(path.join(dist, 'control-ui-TestChunk.mjs'), `function buildControlUiCspHeader(){} function t(){ return [\n\t\t"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",\n].join("; "); }\n`);
  return {dir, root, buildId};
}

/** Everything the patch can touch, for byte-exact restore assertions. */
function snapshot(root, names) {
  const out = {};
  for (const name of names) {
    const file = path.join(root, name);
    out[name] = fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  return out;
}

function assertSnapshot(root, before, label) {
  for (const [name, bytes] of Object.entries(before)) {
    const file = path.join(root, name);
    if (bytes === null) {
      assert.equal(fs.existsSync(file), false, `${label}: ${name} should not exist`);
      continue;
    }
    assert.ok(fs.existsSync(file), `${label}: ${name} should exist`);
    assert.ok(fs.readFileSync(file).equals(bytes), `${label}: ${name} must be byte-identical`);
  }
}

function readBootSw(root) {
  const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const anchor = source.indexOf('const OFFLINE_BOOT = ');
  const literal = readJsonLiteral(source, anchor);
  return JSON.parse(literal.text);
}

test('first paint is C.le.: title, icons and window colour travel in the served HTML', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<title>C\.le\.<\/title>/);
  assert.doesNotMatch(html, /<title>[^<]*OpenClaw/u, 'no upstream title survives');
  // The package rewrites the <link> hrefs itself at boot, so the icons are fixed by replacing
  // the files (asserted separately). Markup keeps the packaged paths the app restores.
  assert.equal((html.match(/rel="icon"/gu) || []).length, 2);
  assert.match(html, /content="#F4EFE4"/);
  assert.match(html, /content="#0A0D16"/);
  assert.equal((html.match(/rel="icon"/gu) || []).length, 2, 'both icon links kept');
  assert.match(html, /type="image\/png"/, 'declared type matches the supplied PNG');
});

test('each icon href carries a content token, so no browser serves the cached lobster', () => {
  // The gateway rewrites a bare `href="./favicon-32.png"` to `?v=<build-id>` and serves it
  // immutable for a year. A token makes the first request a different URL entirely.
  const {root} = makeRoot();
  applyLayer(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const token = /href="\.\/favicon-32\.png\?cle=([a-f0-9]{12})"/u.exec(html)?.[1];
  assert.ok(token, 'favicon-32.png carries a token');
  for (const name of ['favicon.svg', 'apple-touch-icon.png']) {
    assert.match(html, new RegExp(`href="\\./${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\?cle=${token}"`, 'u'), `${name} shares the token`);
  }
  // the build id is untouched: the gateway parses it as <base>-<64 hex> and would call this a
  // stale asset tree otherwise, rebuilding the UI
  assert.match(html, /data-openclaw-control-ui-build-id="2026\.10\.4-release-383c124cc32f-2026-10-15T17-18-22\.749Z"/);
  assert.doesNotMatch(html, /data-openclaw-control-ui-build-id="[^"]*cle=/u);
  // the token is derived from the donor bytes, so it moves when the art moves
  assert.match(token, /^[a-f0-9]{12}$/u);
});

test('the token is stable across runs, so re-entry does not churn the document', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const once = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  applyLayer(root);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), once);
});

test('the layer sits last in <head>, so it beats the core stylesheet in the cascade', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const layer = html.indexOf('data-cle-startup');
  const sheet = html.indexOf('control-ui-core-yIvVj14Y.css');
  const headEnd = html.indexOf('</head>');
  assert.ok(layer > sheet, 'startup style must come after the core stylesheet');
  assert.ok(layer < headEnd, 'and still inside <head>');
  assert.equal((html.match(/data-cle-startup/gu) || []).length, 1, 'exactly one layer');
});

test('the layer never blanks the app: the wait mark is limited to an empty mount and yields to errors', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /openclaw-app\s*\{[^}]*display:\s*none/);
  assert.match(html, /openclaw-app:empty/);
  assert.match(html, /mount-fallback-active[^{]*openclaw-app:empty::before[^{]*\{\s*display:\s*none/);
  assert.match(html, /html:not\(\[data-cle\]\)/, 'tokens are scoped to the pre-plugin window');
});

test('the native failure panel is branded but keeps every word and action', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  // eyebrow: static markup the plugin cannot reach
  assert.match(html, />C\.le\. Studio<\/p>/);
  assert.doesNotMatch(html, />OpenClaw Control UI<\/p>/);
  // the real message, the retry/wait actions and the troubleshooting link survive verbatim
  assert.match(html, /Control UI did not start/);
  assert.match(html, /id="openclaw-mount-retry"/);
  assert.match(html, /id="openclaw-mount-wait"/);
  assert.match(html, /docs\.openclaw\.ai\/web\/control-ui/);
  // and the CSS may restyle the panel but never hide it
  assert.doesNotMatch(CSS, /\.mount-fallback(?:__panel)?\s*\{[^}]*display:\s*none/u);
  assert.match(CSS, /openclaw-mount-fallback-active/);
});

test('running twice changes nothing (installer re-entry and hot reload)', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const once = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const swOnce = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  applyLayer(root);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), once);
  assert.equal(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), swOnce);
});

test('a CSS edit replaces the old block instead of stacking a second copy', () => {
  const base = HEAD(BUILD_ID) + TAIL;
  const first = injectLayer(base, 'a{}').html;
  const second = injectLayer(first, 'b{}').html;
  assert.equal((second.match(/data-cle-startup/gu) || []).length, 1);
  assert.match(second, /b\{\}/);
  assert.doesNotMatch(second, /a\{\}/);
});

test('the offline shell carries the same first frame, with a fresh cache id', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const boot = readBootSw(root);
  assert.match(boot.html, /<title>C\.le\.<\/title>/);
  assert.match(boot.html, /data-cle-startup/);
  assert.notEqual(boot.id, 'abc123', 'cache name must move or the old shell wins offline');
  assert.equal(boot.id.length, 16);
  // and the worker must still parse
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')));
});

test('offline shell is left byte-identical when it already matches', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const first = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  applyLayer(root);
  assert.equal(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), first);
});

test('the installed window drops the upstream name and colours', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'C.le.');
  assert.equal(manifest.short_name, 'C.le.');
  assert.equal(manifest.theme_color, '#F4EFE4');
  assert.equal(manifest.background_color, '#F4EFE4');
  for (const icon of manifest.icons) {
    // Paths stay packaged: those files now hold his portrait, and the app rewrites to them.
    assert.match(icon.src, /favicon-32\.png|apple-touch-icon\.png|favicon\.svg$/);
    assert.equal(icon.type, /\.svg$/u.test(icon.src) ? 'image/svg+xml' : 'image/png');
  }
});

const TOUCHED = ['index.html', 'index.html.br', 'index.html.gz', 'sw.js', 'manifest.webmanifest',
  'asset-manifest.json', 'favicon-32.png', 'apple-touch-icon.png', 'favicon.svg'];

test('revert restores every touched file byte for byte, including twins and the manifest', () => {
  // The earlier version of this test only kept plain text files in the fixture, so it could not
  // have caught a twin or manifest row that never got backed up. This one ships a real
  // precompressed pair and a real sha256/size/generation manifest.
  const {root} = makeRoot({manifest: true});
  const before = snapshot(root, TOUCHED);
  assert.ok(before['index.html.br'] && before['index.html.gz'], 'fixture ships twins');
  assert.ok(JSON.parse(before['asset-manifest.json'].toString()).assets.length > 0, 'fixture ships manifest rows');

  applyLayer(root);
  // the patch really did move the twins …
  assert.ok(!fs.readFileSync(path.join(root, 'index.html.br')).equals(before['index.html.br']));
  assert.ok(!fs.readFileSync(path.join(root, 'index.html.gz')).equals(before['index.html.gz']));
  // … and left the manifest alone, because root documents are not manifest assets. Anything else
  // would produce a row the gateway's parser rejects.
  assert.ok(fs.readFileSync(path.join(root, 'asset-manifest.json')).equals(before['asset-manifest.json']));

  revert(root);
  assertSnapshot(root, before, 'revert');
});

test('the backup covers the compressed twins, so revert can regenerate them exactly', () => {
  const {root} = makeRoot({manifest: true});
  applyLayer(root);
  const backupDir = path.join(root, '.pinkie-startup-backup');
  const ledger = JSON.parse(fs.readFileSync(path.join(backupDir, 'ledger.json'), 'utf8'));
  for (const key of ['index.html', 'index.html.br', 'index.html.gz', 'favicon-32.png', 'apple-touch-icon.png', 'favicon.svg']) {
    assert.ok(ledger.files[key], `${key} is in the ledger`);
    assert.equal(ledger.files[key].existed, true);
    assert.ok(fs.existsSync(path.join(backupDir, `${key.replaceAll('/', '__')}.orig`)), `${key} has a backup`);
  }
  // The manifest is not a touched file here: nothing it tracks changed.
  assert.equal(ledger.files['asset-manifest.json'], undefined, 'manifest untouched when no asset row moves');
});

test('twin files refresh to match the patched document, not the pre-patch one', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const index = fs.readFileSync(path.join(root, 'index.html'));
  assert.ok(zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'index.html.br'))).equals(index));
  assert.ok(zlib.gunzipSync(fs.readFileSync(path.join(root, 'index.html.gz'))).equals(index));
});

test('manifest rows and generation follow the new bytes', () => {
  const {root} = makeRoot({manifest: true});
  // A file the manifest tracks, which the patch rewrites through refreshTwins.
  const asset = path.join(root, 'assets', 'index-test.js');
  const before = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  assert.equal(generationOf(before.assets), before.generation, 'fixture generation is derivable');

  fs.writeFileSync(asset, 'changed bytes');
  refreshTwins(root, asset);

  const after = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  const row = after.assets.find((entry) => entry.path === 'assets/index-test.js');
  const bytes = fs.readFileSync(asset);
  assert.equal(row.size, bytes.length, 'size follows the bytes');
  assert.equal(row.sha256, sha256(bytes), 'sha256 follows the bytes');
  assert.equal(after.generation, generationOf(after.assets), 'generation is re-derived, not left stale');
});

test('the manifest is never given rows the gateway would reject', () => {
  // `parseControlUiAssetManifest` only accepts paths under assets/ and rows with exactly
  // {path, sha256, size}. Writing a row for index.html or an icon would make the whole manifest
  // unparseable — worse than leaving it stale.
  const {root} = makeRoot({manifest: true});
  applyLayer(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['assets', 'generation', 'version']);
  for (const row of manifest.assets) {
    assert.deepEqual(Object.keys(row).sort(), ['path', 'sha256', 'size'], 'exact key set');
    assert.ok(row.path.startsWith('assets/'), `${row.path} stays under assets/`);
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(row.size));
  }
  assert.match(manifest.generation, /^[a-f0-9]{64}$/u);
});

test('an icon-only change counts as a change, and still refreshes any twin it has', () => {
  // The reported gap: index/sw/manifest were already correct, only the icon bytes differed, so
  // `changed` came back false and the run looked like a no-op.
  const {root} = makeRoot({manifest: true});
  applyLayer(root);

  const lobster = Buffer.from('lobster');
  fs.writeFileSync(path.join(root, 'favicon-32.png'), lobster);
  // give the icon a precompressed twin, which is what a packaged runtime may ship
  fs.writeFileSync(path.join(root, 'favicon-32.png.br'), zlib.brotliCompressSync(lobster));

  const result = applyLayer(root);
  assert.equal(result.changed, true, 'an icon-only update is still a change');
  assert.deepEqual(result.icons, ['favicon-32.png']);
  assert.equal(result.index, 'unchanged');
  assert.equal(result.offlineShell, 'unchanged');

  // the twin followed the new bytes instead of keeping the lobster
  const donor = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/startup/icon-32.png'));
  assert.ok(zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'favicon-32.png.br'))).equals(donor));
  // and it is backed up, so revert can put the lobster twin back
  const ledger = JSON.parse(fs.readFileSync(path.join(root, '.pinkie-startup-backup', 'ledger.json'), 'utf8'));
  assert.ok(ledger.files['favicon-32.png.br'], 'icon twin is in the ledger');
  revert(root);
  assert.ok(zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'favicon-32.png.br'))).equals(lobster));
});

test('a plain re-run reports no change at all', () => {
  const {root} = makeRoot({manifest: true});
  applyLayer(root);
  const again = applyLayer(root);
  assert.equal(again.changed, false);
  assert.deepEqual(again.icons, []);
  assert.equal(again.index, 'unchanged');
  assert.equal(again.offlineShell, 'unchanged');
  assert.equal(again.manifest, 'unchanged');
});

test('a backup left by an earlier run is never overwritten by a later one', () => {
  // A runtime that was patched before this ledger existed already holds `.orig` files with the
  // pristine bytes and no ledger entry. Re-running must keep them: overwriting would replace the
  // original with an already-patched copy and turn revert into a silent no-op.
  const {root} = makeRoot();
  const pristine = fs.readFileSync(path.join(root, 'favicon-32.png'));
  const backupDir = path.join(root, '.pinkie-startup-backup');
  fs.mkdirSync(backupDir, {recursive: true});
  fs.writeFileSync(path.join(backupDir, 'favicon-32.png.orig'), pristine);
  // simulate a tree that was already patched: the live bytes are the donor, not the lobster
  const donor = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/startup/icon-32.png'));
  fs.writeFileSync(path.join(root, 'favicon-32.png'), donor);

  applyLayer(root);
  // the stale-but-pristine backup survived the run
  assert.ok(fs.readFileSync(path.join(backupDir, 'favicon-32.png.orig')).equals(pristine));
  revert(root);
  assert.ok(fs.readFileSync(path.join(root, 'favicon-32.png')).equals(pristine), 'revert reaches the real original');
});

test('a build the patch does not understand is refused, not silently half-applied', () => {
  const old = makeRoot({html: HEAD('2026.7.1-2') + TAIL});
  assert.throws(() => applyLayer(old.root), /unsupported Control UI build/);
  assert.match(fs.readFileSync(path.join(old.root, 'index.html'), 'utf8'), /OpenClaw Control/, 'untouched');
});

test('a CSP without inline style is refused: the layer would be blocked and the flash would stay', () => {
  const strict = makeRoot({csp: "default-src 'self'; style-src 'self'"});
  assert.throws(() => applyLayer(strict.root), /inline style is not allowed/);
  assert.equal(styleAllowed("style-src 'self'"), false);
  assert.equal(styleAllowed("style-src 'self' 'unsafe-inline'"), true);
});

test('the signed App and the live profile are refused by path', () => {
  assert.match(refuseReason('/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui'), /SuperPinkie|\.app/);
  assert.match(refuseReason(path.join(os.homedir(), '.openclaw', 'dist', 'control-ui')), /live/);
  assert.equal(refuseReason('/tmp/cle-stage/control-ui'), null);
});

test('a relative path is refused instead of being silently resolved', () => {
  // path.resolve() would have turned both of these into absolute paths and let them through,
  // which made the old isAbsolute check unreachable.
  assert.match(refuseReason('dist/control-ui'), /must be absolute/);
  assert.match(refuseReason('./control-ui'), /must be absolute/);
  assert.match(refuseReason('../control-ui'), /must be absolute/);
  assert.match(refuseReason(''), /required/);
  assert.match(refuseReason(undefined), /required/);
});

test('a symlink pointing at a protected tree is refused', () => {
  // The protected root here is a scratch directory, not the real live profile: the boundary
  // logic is what is under test, and nothing is written near ~/.openclaw.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-boundary-'));
  const protectedRoot = path.join(scratch, 'live-profile');
  fs.mkdirSync(protectedRoot, {recursive: true});
  fs.writeFileSync(path.join(protectedRoot, 'index.html'), 'live');
  const link = path.join(scratch, 'innocent');
  fs.symlinkSync(protectedRoot, link, 'dir');

  assert.equal(refuseReason(protectedRoot, {extraProtected: [protectedRoot]}), `refusing the protected path ${protectedRoot}`);
  // the symlink is absolute and its literal path is clean, so only the real-path check catches it
  assert.match(refuseReason(link, {extraProtected: [protectedRoot]}), /refusing the protected path/);
});

test('a file symlink inside the root is refused instead of followed', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-filelink-'));
  const root = path.join(scratch, 'control-ui');
  const outside = path.join(scratch, 'outside');
  fs.mkdirSync(root, {recursive: true});
  fs.mkdirSync(outside, {recursive: true});
  fs.writeFileSync(path.join(outside, 'index.html'), 'outside');
  fs.symlinkSync(path.join(outside, 'index.html'), path.join(root, 'index.html'));

  assert.throws(() => assertWritableTarget(root, path.join(root, 'index.html')), /symlink/);
  assert.equal(fs.readFileSync(path.join(outside, 'index.html'), 'utf8'), 'outside', 'target untouched');
});

test('writes outside the root are refused even without symlinks', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-escape-'));
  const root = path.join(scratch, 'control-ui');
  fs.mkdirSync(root, {recursive: true});
  assert.throws(() => assertWritableTarget(root, path.join(scratch, 'elsewhere.txt')), /outside/);
  // and a root reached through a symlink still accepts writes inside its real tree
  const real = path.join(scratch, 'real-ui');
  fs.mkdirSync(real, {recursive: true});
  const alias = path.join(scratch, 'alias-ui');
  fs.symlinkSync(real, alias, 'dir');
  assert.doesNotThrow(() => assertWritableTarget(alias, path.join(alias, 'file.txt')));
});

test('startup.css cannot drift into hiding the app or dropping the brand rules', () => {
  assert.match(CSS, /html:not\(\[data-cle\]\)/);
  assert.match(CSS, /\.community-invite-card/);
  assert.match(CSS, /\.sidebar-shell__invite/);
  assert.match(CSS, /\.agent-chat__welcome-clawd/);
  assert.doesNotMatch(CSS, /openclaw-app\s*\{\s*(?:display|visibility)\s*:\s*(?:none|hidden)/);
  // the boot curtain hides the rendered app only until C.le. is live, never the login gate or the
  // mount fallback, and always gives the app back after the native fallback's 12 s budget
  assert.match(CSS, /html:not\(\[data-cle-active\]\) body:not\(\.openclaw-mount-fallback-active\) > openclaw-app:not\(:empty\) \{\s*visibility: hidden;\s*animation: cle-boot-reveal 0s linear 12s forwards;/);
  assert.match(CSS, /html:not\(\[data-cle-active\]\) openclaw-app \.login-gate \{ visibility: visible; \}/);
  assert.match(CSS, /@keyframes cle-boot-reveal \{ to \{ visibility: visible; \} \}/);
  // both themes must define every token the skeleton and error panel read
  for (const token of ['--bg', '--card', '--text', '--text-strong', '--muted', '--border', '--skeleton-base']) {
    const count = (CSS.match(new RegExp(`${token}:`, 'gu')) || []).length;
    assert.ok(count >= 2, `${token} needs a light and a dark value`);
  }
});

test('brand cleanup that outlives the plugin never blanks a node the plugin still needs', () => {
  // The plugin paints .sidebar-workspace-header__mark with a background image and hides its
  // inner svg. If the startup layer hid the whole element, the native <img> variant would
  // disappear once data-cle is set. It may only be replaced.
  const markRule = /\nimg\.sidebar-workspace-header__mark\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(markRule, 'the image variant is handled');
  assert.doesNotMatch(markRule[1], /display\s*:\s*none/);
  assert.match(markRule[1], /content:\s*url\(/);
  // The mascot node must go permanently: the room welcome replaces the identity block only,
  // so a scoped rule would let the old layer return on plugin hot reload.
  const mascotRules = CSS.split('\n').filter((line) => /welcome-clawd/.test(line));
  assert.ok(mascotRules.length >= 1);
  assert.ok(mascotRules.some((line) => !line.includes('data-cle')), 'mascot removal is unscoped');
  assert.match(CSS, /\.agent-chat__welcome-clawd \{ display: none !important; \}/);
});

test('the welcome identity is always C.le., never blank and never the old wordmark', () => {
  // Neither hiding the block (blank stands in for an error) nor revealing it later (the old
  // product returns) is acceptable. It stays in place and is rebranded in CSS instead.
  assert.doesNotMatch(CSS, /cle-brand-return/u, 'no timeout that brings the old identity back');
  assert.doesNotMatch(CSS, /\.agent-chat__welcome-identity\s*\{[^}]*visibility:\s*hidden/u);

  // the avatar becomes the supplied portrait and hides whatever the native renderer put in it
  const avatar = /html:not\(\[data-cle\]\) \.agent-chat__welcome-avatar\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(avatar, 'avatar rule present');
  assert.match(avatar[1], /background:[^;]*avatar\.webp/u);
  const avatarChild = /html:not\(\[data-cle\]\) \.agent-chat__welcome-avatar > \*\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(avatarChild, 'native avatar content is neutralised');
  assert.match(avatarChild[1], /opacity:\s*0/);

  // the name line becomes the wordmark, and the original text is not left visible behind it
  const name = /html:not\(\[data-cle\]\) \.agent-chat__welcome-identity-copy > h2\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(name, 'identity copy rule present');
  assert.match(name[1], /font-size:\s*0/);
  const wordmark = /html:not\(\[data-cle\]\) \.agent-chat__welcome-identity-copy > h2::after\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(wordmark, 'wordmark present');
  assert.match(wordmark[1], /content:\s*"C\.le\."/);

  // every one of these is scoped, so the real agent name returns with the plugin
  for (const selector of ['.agent-chat__welcome-avatar', '.agent-chat__welcome-identity-copy > h2']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const unscoped = new RegExp(`(?:^|\\n)${escaped}\\s*\\{`, 'u');
    assert.doesNotMatch(CSS, unscoped, `${selector} must not appear unscoped`);
  }

  // the model-setup notice is the only instruction a half-configured install has
  assert.doesNotMatch(CSS, /welcome--setup[^}]*font-size:\s*0/u);
  // and the failure panel is a separate element, so this never covers a real error
  assert.doesNotMatch(CSS, /\.mount-fallback(?:__panel)?\s*\{[^}]*display:\s*none/u);
});

test('the sidebar text mark survives the plugin retiring, and still spares a chosen name', () => {
  // The rule used to be scoped to html:not([data-cle]); that meant a disconnect (which ends
  // activation) brought the upstream wordmark back. It is now keyed on the fallback state instead,
  // so the brand outlives the plugin without flattening a user-chosen name.
  const rule = /\.sidebar-agent-card__name-text\[data-cle-fallback\]\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(rule, 'fallback-keyed rule present');
  assert.match(rule[1], /font-size:\s*0/);
  const wordmark = /\.sidebar-agent-card__name-text\[data-cle-fallback\]::after\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(wordmark, 'wordmark present');
  assert.match(wordmark[1], /content:\s*"C\.le\."/);

  // it must NOT be gated on the plugin being alive any more
  assert.doesNotMatch(CSS, /html:not\(\[data-cle\]\) \.sidebar-agent-card__name-text/u);

  // the chevron sits inside the same span and must not be squashed away with the text
  assert.match(CSS, /sidebar-agent-card__chevron/);
  // no unconditional rule may flatten the agent name
  assert.doesNotMatch(CSS, /(?:^|\n)\.sidebar-agent-card__name-text\s*\{/u);
});

test('the sidebar rules match the markup the 2026.10 boot bundle actually renders', () => {
  // The name is wrapped by the hover-marquee helper, so the string lives one level deeper than
  // the class the header passes in:
  //   span.sidebar-agent-card__name-text.hover-marquee > span.hover-marquee__text
  // A rule that only zeroed the outer span would leave the inner node contributing its own font
  // metrics, so both levels are asserted here.
  assert.match(CSS, /\.sidebar-agent-card__name-text\[data-cle-fallback\] \.hover-marquee__text\s*\{[^}]*font-size:\s*0/u);

  // The header's mark has two branches: an <img src=favicon.svg> (default) and
  // span.sidebar-workspace-header__mark--neutral holding an inline <svg> (theme mascot "none").
  // Neither may be hidden — both must end up showing the approved portrait.
  const imgRule = /\nimg\.sidebar-workspace-header__mark\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(imgRule, 'img branch handled');
  assert.match(imgRule[1], /content:\s*url\(/);
  assert.doesNotMatch(imgRule[1], /display:\s*none/);
  const spanRule = /span\.sidebar-workspace-header__mark--neutral\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(spanRule, 'span branch handled');
  assert.match(spanRule[1], /background:[^;]*avatar\.webp/u);
  const glyphRule = /span\.sidebar-workspace-header__mark--neutral > svg\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(glyphRule, 'the inline glyph is neutralised rather than the whole mark');
  assert.match(glyphRule[1], /opacity:\s*0/);

  // only approved art is referenced — no new artwork invented for the startup layer
  for (const url of CSS.matchAll(/url\(['"]?([^'")]+)['"]?\)/gu)) {
    assert.match(url[1], /^\/cle\/static\/art\/avatar\.webp$/u, `unexpected asset ${url[1]}`);
  }
});

test('declared icon sizes match the files on disk, and the files are real PNGs', () => {
  const dir = path.join(import.meta.dirname, '..', 'services/cle-studio/static/startup');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(files, ['icon-180.png', 'icon-256.png', 'icon-32.png']);
  for (const name of files) {
    const bytes = fs.readFileSync(path.join(dir, name));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name} is a PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const claimed = Number(/icon-(\d+)\.png/u.exec(name)[1]);
    assert.equal(width, claimed, `${name} width matches its name`);
    assert.equal(height, claimed, `${name} height matches its name`);
    assert.ok(bytes.length < 400_000, `${name} stays small enough to inline into the shell cache`);
  }
  // every donor the byte replacement copies must exist in the plugin's static tree
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/scripts/apply-startup.mjs'), 'utf8');
  const donors = [...source.matchAll(/'[\w.-]+\.(?:png|svg)':\s*'([\w.-]+\.(?:png|svg))'/gu)].map((match) => match[1]);
  assert.ok(donors.length >= 3, 'png 32, png 180 and the svg mark');
  for (const name of donors) assert.ok(fs.existsSync(path.join(dir, name)), `donor ${name} is shipped`);
});

test('icon bytes are replaced, because the app rewrites the <link> hrefs at boot', () => {
  // Reproduces the real regression: after boot the app sets
  // link[rel="icon"][type="image/png"].href = favicon-32.png and the apple-touch-icon href,
  // so a markup-only fix is reverted within a second. The packaged files must carry his face.
  const {root} = makeRoot();
  assert.equal(fs.readFileSync(path.join(root, 'favicon-32.png'), 'latin1'), 'lobster');
  const replaced = replaceIcons(root);
  assert.deepEqual(replaced.replaced.sort(), ['apple-touch-icon.png', 'favicon-32.png', 'favicon.svg']);
  const donor = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/startup/icon-32.png'));
  assert.ok(fs.readFileSync(path.join(root, 'favicon-32.png')).equals(donor));
  assert.equal(replaceIcons(root).replaced.length, 0, 'idempotent: identical bytes are left alone');
  // and a revert puts the original bytes back
  revert(root);
  assert.equal(fs.readFileSync(path.join(root, 'favicon-32.png'), 'latin1'), 'lobster');
});

test('icon replacement refuses a non-PNG donor instead of writing garbage over a good icon', () => {
  const {root} = makeRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-icons-'));
  fs.writeFileSync(path.join(dir, 'icon-32.png'), 'not a png');
  fs.writeFileSync(path.join(dir, 'icon-180.png'), 'not a png');
  fs.writeFileSync(path.join(dir, 'favicon.svg'), 'not a png');
  assert.throws(() => replaceIcons(root, {iconDir: dir}), /not a PNG/);
  assert.equal(fs.readFileSync(path.join(root, 'favicon-32.png'), 'latin1'), 'lobster');
});

test('the early guard is a same-origin external script placed before the deferred module', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  // external, not inline: CSP here is script-src 'self'
  const tag = /<script[^>]*data-cle-early[^>]*>/u.exec(html);
  assert.ok(tag, 'early guard tag present');
  assert.match(tag[0], /src="\/cle-early\.js"/u, 'loaded from the same origin');
  assert.doesNotMatch(tag[0], />\s*[^\s<]/u, 'no inline body');
  // and it must precede the module entry, which is what buys the earlier execution
  const early = html.indexOf('data-cle-early');
  const module = html.search(/<script[^>]*type="module"/u);
  assert.ok(early < module, 'early guard precedes the module entry');
  // the stylesheet layer still sits last in the cascade
  assert.ok(html.indexOf('data-cle-startup') > html.indexOf('control-ui-core'));
});

test('the early guard file is written into the served root, backed up, and removed on revert', () => {
  const {root} = makeRoot();
  const before = snapshot(root, ['cle-early.js']);
  assert.equal(before['cle-early.js'], null, 'fixture does not ship it');

  applyLayer(root);
  const shipped = path.join(root, 'cle-early.js');
  assert.ok(fs.existsSync(shipped), 'written next to index.html so the same route serves it');
  const donor = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/early-guard.js'));
  assert.ok(fs.readFileSync(shipped).equals(donor), 'byte-identical to the source');

  const ledger = JSON.parse(fs.readFileSync(path.join(root, '.pinkie-startup-backup', 'ledger.json'), 'utf8'));
  assert.equal(ledger.files['cle-early.js'].existed, false, 'ledger records that it is new');

  revert(root);
  assert.equal(fs.existsSync(shipped), false, 'revert removes the file it created');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /data-cle-early/u);
});

test('the offline shell carries the early guard as well', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const boot = readBootSw(root);
  assert.match(boot.html, /data-cle-early/u);
  const early = boot.html.indexOf('data-cle-early');
  const module = boot.html.search(/<script[^>]*type="module"/u);
  assert.ok(early < module, 'ordering holds offline too, or an offline navigation reopens the window');
});

test('a re-run neither duplicates the tag nor rewrites the file', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const once = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const guardOnce = fs.readFileSync(path.join(root, 'cle-early.js'));
  applyLayer(root);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), once);
  assert.ok(fs.readFileSync(path.join(root, 'cle-early.js')).equals(guardOnce));
  assert.equal((fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/data-cle-early/gu) || []).length, 1);
});

test('rewriting the layer replaces the early block instead of stacking a second one', () => {
  const base = HEAD(BUILD_ID) + TAIL;
  const once = injectEarlyGuard(base).html;
  const twice = injectEarlyGuard(once).html;
  assert.equal((twice.match(/data-cle-early/gu) || []).length, 1);
  assert.equal(twice, once);
});

test('a document without exactly one module entry is refused, not guessed at', () => {
  // Inserting "somewhere near the top" would risk landing after the entry and losing the race.
  const twoModules = (HEAD(BUILD_ID) + TAIL).replace(
    '</head>', '<script type="module" src="./a.js"></script>\n</head>',
  );
  assert.throws(() => injectEarlyGuard(twoModules), /module entry 必须唯一/u);
});

test('the offline shell precaches the early guard with a real integrity hash', () => {
  // An offline reload must still get the script, or the guard silently never runs when the
  // network is gone — which is exactly the disconnected-state window that was observed.
  const {root} = makeRoot();
  applyLayer(root);
  const boot = readBootSw(root);
  const row = boot.assets.find((entry) => entry.path === 'cle-early.js');
  assert.ok(row, 'the file has a precache row');
  const bytes = fs.readFileSync(path.join(root, 'cle-early.js'));
  assert.equal(row.integrity, `sha256-${crypto.createHash('sha256').update(bytes).digest('base64')}`);
  assert.ok(boot.publicAssets.includes('cle-early.js'), 'and it is listed as a public asset');
  // the shipped list is sorted by plain codepoint order; keep that invariant
  const paths = boot.assets.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort());
  // the worker must still parse with the added row
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')));
});

test('the early-guard precache row is idempotent across runs', () => {
  const {root} = makeRoot();
  applyLayer(root);
  const once = readBootSw(root);
  applyLayer(root);
  const twice = readBootSw(root);
  assert.equal(twice.assets.filter((entry) => entry.path === 'cle-early.js').length, 1);
  assert.equal(twice.publicAssets.filter((name) => name === 'cle-early.js').length, 1);
  assert.equal(twice.id, once.id, 'the cache id is stable, so the worker is not churned');
});

/* ---------- redeploy closed loop (review fifth) ---------- */

/** A donor directory: the patch's own inputs, copied so a test can mutate them in isolation. */
function makeDonor(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-donor-'));
  const css = path.join(dir, 'startup.css');
  const guard = path.join(dir, 'early-guard.js');
  fs.writeFileSync(css, fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/startup.css')));
  if (overrides.guard !== false) {
    fs.writeFileSync(guard, fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/early-guard.js')));
  }
  return {dir, css, guard};
}

test('a changed guard script upserts the existing precache row integrity', () => {
  // Reported: the row was only added when absent, so a script-only change left a stale integrity
  // and the worker would reject the cached script.
  const {root} = makeRoot();
  const donor = makeDonor();
  const first = applyLayer(root, {cssPath: donor.css});
  assert.equal(first.earlyGuard, 'patched');
  const boot1 = readBootSw(root);
  const row1 = boot1.assets.find((entry) => entry.path === 'cle-early.js');
  assert.ok(row1, 'row exists after the first run');

  // byte change in the guard only — the html the patch injects is identical
  fs.appendFileSync(donor.guard, '\n// one extra comment line\n');
  const second = applyLayer(root, {cssPath: donor.css});
  assert.equal(second.earlyGuard, 'patched');
  const boot2 = readBootSw(root);
  const row2 = boot2.assets.find((entry) => entry.path === 'cle-early.js');

  const served = fs.readFileSync(path.join(root, 'cle-early.js'));
  const actual = `sha256-${crypto.createHash('sha256').update(served).digest('base64')}`;
  assert.equal(row2.integrity, actual, 'integrity follows the served bytes');
  assert.notEqual(row2.integrity, row1.integrity, 'and it actually moved');
  assert.equal(boot2.assets.filter((entry) => entry.path === 'cle-early.js').length, 1, 'upsert, not append');
});

test('a script-only change moves the offline cache generation and reports changed', () => {
  const {root} = makeRoot();
  const donor = makeDonor();
  applyLayer(root, {cssPath: donor.css});
  const boot1 = readBootSw(root);
  const index1 = fs.readFileSync(path.join(root, 'index.html'));

  fs.appendFileSync(donor.guard, '\n// comment\n');
  const second = applyLayer(root, {cssPath: donor.css});
  const boot2 = readBootSw(root);

  assert.ok(fs.readFileSync(path.join(root, 'index.html')).equals(index1), 'index.html is untouched');
  assert.notEqual(boot2.id, boot1.id, 'the cache name must move with the script bytes');
  assert.equal(boot2.id.length, 16);
  assert.equal(second.changed, true, 'a script-only deployment is a change');
  assert.equal(second.offlineShell, 'patched', 'and the worker was rewritten');
});

test('re-applying identical inputs is a no-op, including the cache id', () => {
  // The id must be deterministic: a random value per run would defeat idempotency.
  const {root} = makeRoot();
  const donor = makeDonor();
  applyLayer(root, {cssPath: donor.css});
  const boot1 = readBootSw(root);
  const index1 = fs.readFileSync(path.join(root, 'index.html'));
  const guard1 = fs.readFileSync(path.join(root, 'cle-early.js'));

  const again = applyLayer(root, {cssPath: donor.css});
  const boot2 = readBootSw(root);

  assert.equal(again.changed, false);
  assert.equal(again.earlyGuard, 'unchanged');
  assert.equal(again.offlineShell, 'unchanged');
  assert.equal(again.index, 'unchanged');
  assert.equal(boot2.id, boot1.id, 'same bytes, same generation');
  assert.ok(fs.readFileSync(path.join(root, 'index.html')).equals(index1));
  assert.ok(fs.readFileSync(path.join(root, 'cle-early.js')).equals(guard1));
});

test('a missing guard source fails before any byte of the root is written', () => {
  // Reported: index.html was written with a <script data-cle-early> reference, then the run threw
  // on the missing file — leaving a page that points at a script which does not exist.
  const {root} = makeRoot();
  const donor = makeDonor({guard: false});
  const before = {
    index: fs.readFileSync(path.join(root, 'index.html')),
    sw: fs.readFileSync(path.join(root, 'sw.js')),
    webmanifest: fs.readFileSync(path.join(root, 'manifest.webmanifest')),
    icon: fs.readFileSync(path.join(root, 'favicon-32.png')),
    manifest: fs.readFileSync(path.join(root, 'asset-manifest.json')),
  };
  assert.throws(() => applyLayer(root, {cssPath: donor.css}), /missing early guard source/u);

  assert.ok(fs.readFileSync(path.join(root, 'index.html')).equals(before.index), 'index.html untouched');
  assert.ok(fs.readFileSync(path.join(root, 'sw.js')).equals(before.sw), 'sw.js untouched');
  assert.ok(fs.readFileSync(path.join(root, 'manifest.webmanifest')).equals(before.webmanifest));
  assert.ok(fs.readFileSync(path.join(root, 'favicon-32.png')).equals(before.icon), 'no half-substituted icons');
  assert.ok(fs.readFileSync(path.join(root, 'asset-manifest.json')).equals(before.manifest));
  assert.equal(fs.existsSync(path.join(root, 'cle-early.js')), false);
  assert.equal(fs.existsSync(path.join(root, '.pinkie-startup-backup')), false, 'not even a backup dir');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /data-cle-early/u);
});

test('a refused write target fails before the document is touched', () => {
  // Same class of bug as the missing source: the target check must precede the write, and a
  // symlinked target is refused rather than followed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-guardlink-'));
  const root = path.join(dir, 'control-ui');
  const scratch = makeRoot();
  fs.cpSync(scratch.root, root, {recursive: true});
  fs.rmSync(path.join(root, '.pinkie-startup-backup'), {recursive: true, force: true});
  const outside = path.join(dir, 'outside.js');
  fs.writeFileSync(outside, '// not ours\n');
  fs.symlinkSync(outside, path.join(root, 'cle-early.js'));

  const before = fs.readFileSync(path.join(root, 'index.html'));
  const donor = makeDonor();
  assert.throws(() => applyLayer(root, {cssPath: donor.css}), /symlink|outside/u);
  assert.ok(fs.readFileSync(path.join(root, 'index.html')).equals(before), 'index.html untouched');
  assert.equal(fs.readFileSync(outside, 'utf8'), '// not ours\n', 'the symlink target was not written');
});

test('the guard twin and manifest row follow a script-only change too', () => {
  // Give the shipped file a precompressed twin, as a packaged runtime might.
  const {root} = makeRoot();
  const donor = makeDonor();
  applyLayer(root, {cssPath: donor.css});
  const guardPath = path.join(root, 'cle-early.js');
  fs.writeFileSync(`${guardPath}.br`, zlib.brotliCompressSync(fs.readFileSync(guardPath)));

  fs.appendFileSync(donor.guard, '\n// twin check\n');
  applyLayer(root, {cssPath: donor.css});

  const served = fs.readFileSync(guardPath);
  assert.ok(zlib.brotliDecompressSync(fs.readFileSync(`${guardPath}.br`)).equals(served), 'twin refreshed');
  const ledger = JSON.parse(fs.readFileSync(path.join(root, '.pinkie-startup-backup', 'ledger.json'), 'utf8'));
  assert.ok(ledger.files['cle-early.js.br'], 'the twin is in the ledger so revert can restore it');
});

test('the login gate removes the upstream name from the accessibility tree, not just the pixels', () => {
  // font-size:0 hid the glyphs but left the string readable by a screen reader — the AX snapshot
  // still started with "OpenClaw". Hiding the element removes it from that tree.
  const nameRule = /\.login-gate__brand-name\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(nameRule, 'login gate name rule present');
  assert.match(nameRule[1], /display:\s*none/u, 'removed from layout and from the AX tree');
  assert.doesNotMatch(nameRule[1], /font-size:\s*0/u, 'the old pixels-only trick is gone');

  // the brand is supplied on the header instead: approved portrait + wordmark
  const before = /\.login-gate__brand::before\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(before, 'portrait rule present');
  assert.match(before[1], /background:[^;]*avatar\.webp/u);
  const after = /\.login-gate__brand::after\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(after, 'wordmark rule present');
  assert.match(after[1], /content:\s*"C\.le\."/u);

  // and the layer still only ever points at the approved artwork
  for (const url of CSS.matchAll(/url\(['"]?([^'")]+)['"]?\)/gu)) {
    assert.equal(url[1], '/cle/static/art/avatar.webp', `unexpected asset ${url[1]}`);
  }
});

/* ---------- retired document skin (data-cle retained, data-cle-active removed) ---------- */

const ROOMS_CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio', 'src', 'rooms', 'rooms.css'), 'utf8');

test('the sidebar keeps a wordmark name while the plugin is retired, without depending on :has()', () => {
  // rooms.css hides the native header text under [data-cle] and its .cle-brandmark only exists
  // while a plugin instance is mounted; after a disconnect the corner was an empty gold ring.
  const rule = /html\[data-cle\]:not\(\[data-cle-active\]\) \.sidebar-brand::before\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(rule, 'retired-state fallback present');
  assert.match(rule[1], /content:\s*"C\.le\."/u);
  // it must not be an image or a mask — a real string is what reaches the accessibility tree
  assert.doesNotMatch(rule[1], /background|mask|url\(/u);
  // and the rule must not rely on :has(), which the target WebKit cannot be trusted with here.
  // Strip comments first: the explanation above the rule mentions :has() on purpose.
  const block = CSS.replace(/\/\*[\s\S]*?\*\//gu, '');
  assert.doesNotMatch(block, /:has\(/u, 'no :has() in the live rules');

  // the header button also gets an accessible name, visually hidden but present
  const name = /html\[data-cle\]:not\(\[data-cle-active\]\) \.sidebar-workspace-header__main::after\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(name, 'header accessible name present');
  assert.match(name[1], /content:\s*"C\.le\."/u);
  assert.match(name[1], /clip-path:\s*inset\(50%\)|clip:\s*rect/u, 'visually hidden, not display:none');
});

test('the retired fallback is gated on the active marker, so it never fights a live plugin', () => {
  // data-cle alone means "document skin retained"; only data-cle-active means a live instance.
  for (const match of CSS.matchAll(/html\[data-cle\]:not\(\[data-cle-active\]\)[^{]*\{/gu)) {
    assert.ok(match[0].includes('data-cle-active'), match[0]);
  }
  // and nothing may treat a retained data-cle as "plugin online"
  assert.doesNotMatch(CSS, /html\[data-cle\]\s+\.agent-chat__composer-shell/u);
});

test('Claude\'s welcome art and the rooms file are untouched by the startup layer', () => {
  // rooms.css belongs to the art pass; startup.css must not restate its selectors.
  for (const selector of ['.cle-brandmark {', '.cle-room {', '.cle-welcome__line']) {
    assert.doesNotMatch(CSS, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), `startup must not own ${selector}`);
  }
  // and it never hides the app or the failure panel
  assert.doesNotMatch(CSS, /openclaw-app\s*\{[^}]*display:\s*none/u);
  assert.doesNotMatch(CSS, /\.mount-fallback(?:__panel)?\s*\{[^}]*display:\s*none/u);
});
