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
import {applyLayer, revert, refuseReason, styleAllowed, readJsonLiteral, injectLayer, replaceIcons} from '../services/cle-studio/scripts/apply-startup.mjs';

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

function makeRoot({html = HEAD(BUILD_ID) + TAIL, csp = CSP, buildId = BUILD_ID, sw = true} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-startup-'));
  const root = path.join(dir, 'control-ui');
  const dist = path.dirname(root);
  fs.mkdirSync(root, {recursive: true});
  fs.writeFileSync(path.join(root, 'index.html'), html);
  fs.writeFileSync(path.join(root, 'asset-manifest.json'), JSON.stringify({generation: 'g', assets: []}));
  fs.writeFileSync(path.join(root, 'manifest.webmanifest'), JSON.stringify({
    name: 'OpenClaw Control', short_name: 'OpenClaw', theme_color: '#0a0a0a', background_color: '#0a0a0a',
    icons: [{src: './favicon.svg', sizes: 'any', type: 'image/svg+xml'},
      {src: './favicon-32.png', sizes: '32x32', type: 'image/png'},
      {src: './apple-touch-icon.png', sizes: '180x180', type: 'image/png'}],
  }, null, 2));
  if (sw) {
    const boot = {html: html.replace(/^<!doctype html>\n/, ''), assets: [], csp, publicAssetVersion: 'v1', publicAssets: [], id: 'abc123'};
    fs.writeFileSync(path.join(root, 'sw.js'),
      `const CACHE_PREFIX = "openclaw-control-";\nconst OFFLINE_BOOT = ${JSON.stringify(boot)};\nconst CACHE_NAME = \`x\`;\n`);
  }
  // the packaged lobster icons the app rewrites its <link> hrefs to
  fs.writeFileSync(path.join(root, 'favicon-32.png'), Buffer.from('lobster'));
  fs.writeFileSync(path.join(root, 'apple-touch-icon.png'), Buffer.from('lobster'));
  fs.writeFileSync(path.join(root, 'favicon.svg'), '<svg viewBox="0 0 120 120"><!-- lobster --></svg>');
  // the CSP source chunk the fallback reader looks for
  fs.writeFileSync(path.join(dist, 'control-ui-TestChunk.mjs'), `function buildControlUiCspHeader(){} function t(){ return [\n\t\t"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",\n].join("; "); }\n`);
  return {dir, root, buildId};
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

test('revert restores the original bytes for every touched file', () => {
  const {root} = makeRoot();
  const before = Object.fromEntries(['index.html', 'sw.js', 'manifest.webmanifest']
    .map((name) => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
  applyLayer(root);
  revert(root);
  for (const [name, text] of Object.entries(before)) {
    assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), text, name);
  }
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

test('startup.css cannot drift into hiding the app or dropping the brand rules', () => {
  assert.match(CSS, /html:not\(\[data-cle\]\)/);
  assert.match(CSS, /\.community-invite-card/);
  assert.match(CSS, /\.sidebar-shell__invite/);
  assert.match(CSS, /\.agent-chat__welcome-clawd/);
  assert.doesNotMatch(CSS, /openclaw-app\s*\{\s*(?:display|visibility)\s*:\s*(?:none|hidden)/);
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

test('a failed plugin still ends in a real error, not a permanently blank welcome', () => {
  // The stock identity is hidden unscoped (a scoped rule would let it return on hot reload),
  // so the layer must hand it back on the same budget the native fallback uses.
  const rule = /\.agent-chat__welcome-identity\s*\{([^}]*)\}/u.exec(CSS);
  assert.ok(rule, 'identity rule present');
  assert.match(rule[1], /visibility:\s*hidden/);
  assert.match(rule[1], /animation:\s*cle-brand-return\s+0s\s+linear\s+(\d+)s/u);
  const delay = Number(/animation:\s*cle-brand-return\s+0s\s+linear\s+(\d+)s/u.exec(rule[1])[1]);
  assert.ok(delay >= 10 && delay <= 12, `return delay ${delay}s should match the native 12s mount fallback`);
  assert.match(CSS, /@keyframes cle-brand-return[^}]*\{[^}]*visibility:\s*visible/u);
  // the model-setup notice is the only instruction a half-configured install has
  assert.doesNotMatch(CSS, /welcome--setup\s*>\s*h2[^{]*\{[^}]*visibility:\s*hidden/u);
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
  assert.deepEqual(replaced.sort(), ['apple-touch-icon.png', 'favicon-32.png', 'favicon.svg']);
  const donor = fs.readFileSync(path.join(import.meta.dirname, '..', 'services/cle-studio/static/startup/icon-32.png'));
  assert.ok(fs.readFileSync(path.join(root, 'favicon-32.png')).equals(donor));
  assert.equal(replaceIcons(root).length, 0, 'idempotent: identical bytes are left alone');
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
