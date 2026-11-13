// Every runtime patch must actually be run by the installer. A patch with a
// passing unit test but no caller looks fixed and never ships (11-13: the
// retry-user-preservation fix sat unwired for two weeks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = ['installer/macos/apply-theme.sh', 'patch/apply-all.mjs', 'desktop/macos/build.sh']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
// Unwired since the 10-30 Windows sync / older ports; each needs a review
// against the current runtime before it is wired or deleted. Do not add to this list.
const PENDING_REVIEW = new Set([
  'apply-optimistic-user-reconcile.mjs',
  'apply-queue-unconfirmed.mjs',
  'apply-steer-identity.mjs',
  'apply-steer-images.mjs',
  // Only run by tools/claude-deploy/prepare-work-first-completion.py (live hand-install);
  // work-first-chat is live, media-gate is not. Neither ships in a build.
  'apply-work-first-chat.mjs',
  'apply-work-first-media-gate.mjs',
]);
test('every patch/apply-*.mjs is run by the installer', () => {
  const unwired = fs.readdirSync(path.join(root, 'patch'))
    .filter(n => /^(?:re)?apply-.*\.mjs$/.test(n) && n !== 'apply-all.mjs')
    .filter(n => !installer.includes(n) && !PENDING_REVIEW.has(n));
  assert.deepEqual(unwired, [], `patches nobody runs: ${unwired.join(', ')}`);
});
