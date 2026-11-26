// patch/apply-all.mjs is the trial harness that applies every runtime patch in
// installer order on a throwaway copy. Each fix below shipped a new runtime patch
// and also had to add it to the harness ORDER; when that line is missing the
// trial run silently skips the patch and its interaction with the others is
// never checked. These entries were added by fix commits but nothing asserted
// them (apply-overflow-compaction-events.mjs and apply-metre-lock.mjs already
// have their own checks elsewhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = fs.readFileSync(path.join(root, 'patch/apply-all.mjs'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'installer/macos/apply-theme.sh'), 'utf8');

// Read ORDER statically: importing apply-all.mjs would start a trial run.
function harnessOrder(source) {
  const block = source.match(/const ORDER = \[([\s\S]*?)\n\];/u);
  assert.ok(block, 'apply-all.mjs no longer declares const ORDER = [ ... ];');
  return [...block[1].matchAll(/^\s*'((?:re)?apply-[a-z0-9-]+\.mjs)',/gmu)].map((m) => m[1]);
}

// Order in which apply-theme.sh actually runs patch/<name>.mjs.
function installerOrder(source) {
  return [...source.matchAll(/"\$REPO_ROOT\/patch\/((?:re)?apply-[a-z0-9-]+\.mjs)"/gu)].map((m) => m[1]);
}

// name -> fix commit that added it to ORDER
const FIXED = {
  'apply-preflight-compaction-events.mjs': 'bc7482b2 pre-send compaction animates, usage refreshes',
  'apply-steer-fallback-wait.mjs': '453233e5 立即追加 no longer collides with the running turn',
  'apply-retry-single-user.mjs': 'ae380b95 automatic retry no longer writes the user message twice',
  'apply-retry-user-preservation.mjs': 'ba2c0a64 user message stays when finalize asks for another pass',
  'apply-steer-images.mjs': 'b2ada14d images sent with 立即追加 reach the running turn',
  'apply-work-first-media-gate.mjs': 'b2ada14d replies with images also go through the finalize check',
  'apply-fake-ip-benchmark-v6.mjs': 'b5cc95cd fetching pages works behind a fake-IP proxy',
};

test('apply-all ORDER keeps every runtime patch a fix added to the trial run', () => {
  const order = harnessOrder(harness);
  for (const [name, fix] of Object.entries(FIXED)) {
    assert.ok(fs.existsSync(path.join(root, 'patch', name)), `patch/${name} is gone (${fix})`);
    assert.ok(order.includes(name), `apply-all.mjs ORDER dropped ${name} (${fix})`);
    assert.equal(order.indexOf(name), order.lastIndexOf(name), `${name} listed twice in ORDER`);
  }
});

test('apply-all ORDER runs those patches in the same order as the macOS installer', () => {
  const order = harnessOrder(harness);
  const installed = installerOrder(theme);
  const names = Object.keys(FIXED);
  for (const name of names) assert.ok(installed.includes(name), `apply-theme.sh no longer runs ${name}`);
  const byHarness = [...names].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const byInstaller = [...names].sort((a, b) => installed.indexOf(a) - installed.indexOf(b));
  assert.deepEqual(byHarness, byInstaller, 'apply-all.mjs ORDER disagrees with installer/macos/apply-theme.sh');
});
