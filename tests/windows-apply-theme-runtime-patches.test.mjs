// B7 (HOTSPOTS #6 installer/windows/apply-theme.ps1): 2910c568 had to carry Mac
// runtime patches over to Windows by hand after the two installers drifted apart.
// patches-wired.test.mjs counts a patch as shipped as soon as the macOS installer
// runs it, so the Windows install / repair path (install.ps1 -> apply-theme.ps1)
// can silently miss one: on main@f5b4191d it skipped 6 (preflight / overflow
// compaction events, retry-user-preservation, steer-images, work-first-media-gate,
// fake-ip-benchmark-v6). Release builds hide this because build-win.ps1 overlays
// the installed Mac runtime. Keep the Windows list equal to the macOS one, in order.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const unique = (xs) => [...new Set(xs)];

// Order in which apply-theme.sh runs patch/<name>.mjs (a [[ -f ]] guard repeats a name).
const macOrder = (src) => unique([...src.matchAll(/"\$REPO_ROOT\/patch\/((?:re)?apply-[a-z0-9-]+\.mjs)"/gu)].map((m) => m[1]));

function winOrder(src) {
  const block = src.match(/\$runtimePatches = @\(([\s\S]*?)\)\s*\|\s*ForEach-Object/u);
  assert.ok(block, 'apply-theme.ps1 no longer declares $runtimePatches = @( ... ) | ForEach-Object');
  return [...block[1].matchAll(/'((?:re)?apply-[a-z0-9-]+\.mjs)'/gu)].map((m) => m[1]);
}

const mac = macOrder(read('installer/macos/apply-theme.sh'));
const win = winOrder(read('installer/windows/apply-theme.ps1'));

test('Windows apply-theme.ps1 runs every runtime patch macOS runs, in the same order', () => {
  assert.ok(mac.length >= 10, `read only ${mac.length} patches from apply-theme.sh`);
  const missing = mac.filter((n) => !win.includes(n));
  const extra = win.filter((n) => !mac.includes(n));
  assert.deepEqual({missing, extra}, {missing: [], extra: []}, 'Windows and macOS runtime patch lists differ');
  assert.deepEqual(win, mac, 'same patches, different order');
});

test('every runtime patch the Windows script lists exists (Where-Object Test-Path would drop it silently)', () => {
  const absent = win.filter((n) => !fs.existsSync(path.join(root, 'patch', n)));
  assert.deepEqual(absent, []);
});
