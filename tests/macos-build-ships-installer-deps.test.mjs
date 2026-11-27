// B7 (HOTSPOTS #19 desktop/macos/build.sh): the App bundle kept leaving out a file
// the bundled installer later needs (cd5957f0: tools/ui-parity/sw_cache.py; the
// mode-architecture modules setup.py installs, aeff5aa6, are guarded separately in
// macos-launcher-hotspot.test.mjs). Inside the App, REPO_ROOT for
// installer/macos/apply-theme.sh is Contents/Resources/SuperPinkie, so every
// $REPO_ROOT/<path> it reads there must be copied in by build.sh. core-manifest only
// pins sw_cache.py by name; this catches the next file apply-theme.sh starts reading.
// Not counted: sync_launcher_resources (only runs when SKIP_APP_BUNDLES != 1, and
// both bundled callers set it to 1 - asserted below), paths behind an -f test, and
// the retry proxy (install_model_retry_proxy returns 0 when its source is absent).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const theme = read('installer/macos/apply-theme.sh');
const build = read('desktop/macos/build.sh');
const OPTIONAL = new Set(['proxy/mm-retry-proxy.py']);

function withoutFunction(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  assert.ok(start >= 0, `apply-theme.sh no longer defines ${name}()`);
  const end = lines.findIndex((l, i) => i > start && l === '}');
  assert.ok(end > start, `${name}() has no closing brace at column 0`);
  return [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n');
}

function neededInBundle() {
  const src = withoutFunction(theme, 'sync_launcher_resources');
  const guarded = new Set([...src.matchAll(/-f "\$REPO_ROOT\/([A-Za-z0-9_./-]+)"/g)].map((m) => m[1]));
  const used = new Set([...src.matchAll(/\$REPO_ROOT\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1].replace(/\/+$/, '')));
  return [...used].filter((p) => p && !guarded.has(p) && !OPTIONAL.has(p));
}

// Everything build.sh copies under Contents/Resources/SuperPinkie, with simple
// `for x in a b c; do ... done` loops expanded.
function shippedByBuild() {
  const lines = build.split('\n');
  const out = [];
  const dest = /"\$CONTENTS\/Resources\/SuperPinkie\/([^"]*)"/;
  const emit = (line, vars) => {
    if (!/^\s*(cp|ditto)\b/.test(line)) return;
    const d = line.match(dest);
    if (!d) return;
    const sub = (s) => s.replace(/\$\{?([A-Za-z_]+)\}?/g, (m, v) => (v in vars ? vars[v] : m));
    const to = sub(d[1]);
    if (!to.endsWith('/')) { out.push(to.replace(/\/+$/, '')); return; }
    for (const s of line.matchAll(/"\$REPO_ROOT\/([^"]*)"(\*\.[A-Za-z0-9]+)?/g)) {
      out.push(to + path.posix.basename(sub(s[1]) + (s[2] || '')));
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const loop = lines[i].match(/^\s*for (\w+) in ([^;]+); do\s*$/);
    if (!loop) { emit(lines[i], {}); continue; }
    let j = i + 1;
    while (j < lines.length && !/^\s*done\b/.test(lines[j])) j++;
    for (const item of loop[2].trim().split(/\s+/).filter((x) => !x.startsWith('$'))) {
      for (let k = i + 1; k < j; k++) emit(lines[k], {[loop[1]]: item});
    }
    i = j;
  }
  return out;
}

const globRe = (s) => new RegExp('^' + s.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');
// A shipped entry covers a path if it is that path, a directory above it, a glob
// matching it, or (for a directory reference) something shipped inside it.
const covers = (s, p) => s === p || p.startsWith(s + '/') || s.startsWith(p + '/')
  || (s.includes('*') && globRe(s).test(p));

// The whole command (with `\` continuation lines) on each line that mentions needle.
function commandsMentioning(src, needle) {
  const lines = src.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!line.includes(needle) || /^\s*#/.test(line)) return;
    let a = i;
    while (a > 0 && lines[a - 1].trimEnd().endsWith('\\')) a--;
    out.push(lines.slice(a, i + 1).join('\n'));
  });
  return out;
}

test('both callers of the bundled apply-theme.sh keep PINKIE_SKIP_APP_BUNDLES=1', () => {
  for (const [file, src, needle] of [
    ['desktop/macos/build.sh', build, '/bin/bash "$REPO_ROOT/installer/macos/apply-theme.sh"'],
    ['installer/macos/apply-bundled.sh', read('installer/macos/apply-bundled.sh'), '"$SCRIPT_DIR/apply-theme.sh"'],
  ]) {
    const cmds = commandsMentioning(src, needle);
    assert.ok(cmds.length > 0, `${file} no longer runs apply-theme.sh`);
    for (const cmd of cmds) assert.ok(cmd.includes('PINKIE_SKIP_APP_BUNDLES=1'), `${file} runs apply-theme.sh without PINKIE_SKIP_APP_BUNDLES=1:\n${cmd}`);
  }
});

test('build.sh ships every repo path the bundled apply-theme.sh reads', () => {
  const shipped = shippedByBuild();
  assert.ok(shipped.length > 20, `parsed only ${shipped.length} shipped entries from build.sh`);
  const needed = neededInBundle();
  assert.ok(needed.length > 20, `read only ${needed.length} paths from apply-theme.sh`);
  const missing = needed.filter((p) => !shipped.some((s) => covers(s, p)));
  assert.deepEqual(missing, [], 'apply-theme.sh reads these inside the App, but build.sh does not copy them');
});
