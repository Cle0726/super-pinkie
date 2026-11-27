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
  'apply-noop-write-continue.mjs': 'aa9c0016 no-op write/edit no longer ends the turn without a reply',
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

// c092fc4b deleted patch/apply-startup.mjs but left it in ORDER: every trial run
// spawned a missing file, counted it as a failed patch and exited 1, so a clean
// run of the harness could never pass.
test('apply-all ORDER only lists patches that exist in patch/', () => {
  const missing = harnessOrder(harness).filter((name) => !fs.existsSync(path.join(root, 'patch', name)));
  assert.deepEqual(missing, [], `apply-all.mjs ORDER lists patches that are gone: ${missing.join(', ')}`);
});

// #440: ORDER lacked apply-history-image-thumbnails, apply-stream-survive-steer and
// apply-pinkie-managed-skills, so a refresh_mac_runtime.py run over the trial output
// dropped their files from desktop/windows/mac-runtime. Every patch the installer
// runs must be in ORDER, in installer order, with build.sh's managed-skills last.
const build = fs.readFileSync(path.join(root, 'desktop/macos/build.sh'), 'utf8');

function coverageGaps(harnessSource, themeSource, buildSource) {
  const order = harnessOrder(harnessSource);
  const installed = installerOrder(themeSource);
  const built = [...buildSource.matchAll(/patch\/((?:re)?apply-[a-z0-9-]+\.mjs)/gu)].map((m) => m[1]);
  const gaps = [];
  for (const name of [...installed, ...built]) {
    if (!order.includes(name)) gaps.push(`missing ${name}`);
  }
  const shared = installed.filter((name) => order.includes(name));
  const byHarness = [...shared].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (byHarness.join() !== shared.join()) gaps.push('order differs from installer/macos/apply-theme.sh');
  for (const name of built) {
    if (order.includes(name) && order.indexOf(name) !== order.length - 1) gaps.push(`${name} is not last`);
  }
  return gaps;
}

test('apply-all ORDER covers every patch apply-theme.sh and build.sh run', () => {
  assert.ok(installerOrder(theme).length >= 20, 'installerOrder no longer matches apply-theme.sh');
  assert.deepEqual(coverageGaps(harness, theme, build), []);
  const order = harnessOrder(harness);
  for (const name of ['apply-history-image-thumbnails.mjs', 'apply-stream-survive-steer.mjs', 'apply-pinkie-managed-skills.mjs']) {
    assert.ok(order.includes(name), `apply-all.mjs ORDER dropped ${name} (#440)`);
  }
});

test('the coverage check goes red when ORDER loses a patch or reorders one', () => {
  const dropped = harness.replace("  'apply-history-image-thumbnails.mjs',\n", '');
  assert.notEqual(dropped, harness);
  assert.ok(coverageGaps(dropped, theme, build).includes('missing apply-history-image-thumbnails.mjs'));
  const noSkills = harness.replace("  'apply-pinkie-managed-skills.mjs',\n", '');
  assert.ok(coverageGaps(noSkills, theme, build).includes('missing apply-pinkie-managed-skills.mjs'));
  const swapped = harness.replace(
    "  'apply-computer-v2.mjs',\n  'apply-stream-survive-steer.mjs',\n",
    "  'apply-stream-survive-steer.mjs',\n  'apply-computer-v2.mjs',\n",
  );
  assert.notEqual(swapped, harness);
  assert.ok(coverageGaps(swapped, theme, build).includes('order differs from installer/macos/apply-theme.sh'));
  const skillsEarly = noSkills.replace("  'apply-chat-timeline.mjs',\n", "  'apply-chat-timeline.mjs',\n  'apply-pinkie-managed-skills.mjs',\n");
  assert.ok(coverageGaps(skillsEarly, theme, build).includes('apply-pinkie-managed-skills.mjs is not last'));
});

// apply-theme.sh lets only computer-v2 fail (`if ! ...; then echo warning`); the
// harness must not excuse any other patch, and must stop early without the SDK.
test('apply-all only excuses the patches apply-theme.sh lets fail', () => {
  const optional = harness.match(/const OPTIONAL = new Set\(\[([^\]]*)\]\)/u);
  assert.ok(optional, 'apply-all.mjs no longer declares OPTIONAL');
  const names = [...optional[1].matchAll(/'([^']+)'/gu)].map((m) => m[1]);
  for (const name of names) {
    assert.match(theme, new RegExp(`if ! [^\\n]*patch/${name.replace(/\./gu, '\\.')}`, 'u'), `${name} is not optional in apply-theme.sh`);
  }
  assert.match(harness, /node_modules\/@openclaw\/ai\/package\.json[\s\S]*process\.exit\(2\)/u);
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
