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
// Browser patches ship baked into the shared ui/runtime bundle instead;
// they count as wired when every marker they write is present there.
const baked = fs.readdirSync(path.join(root, 'ui/runtime')).filter(n => n.endsWith('.js'))
  .map(n => fs.readFileSync(path.join(root, 'ui/runtime', n), 'utf8')).join('\n');
const bakedIn = (name) => {
  const markers = [...new Set(fs.readFileSync(path.join(root, 'patch', name), 'utf8').match(/pinkie-[a-z0-9-]+:v\d+/g) || [])];
  return markers.length > 0 && markers.some(m => baked.includes(m));
};
test('every patch/apply-*.mjs is run by the installer', () => {
  const unwired = fs.readdirSync(path.join(root, 'patch'))
    .filter(n => /^(?:re)?apply-.*\.mjs$/.test(n) && n !== 'apply-all.mjs')
    .filter(n => !installer.includes(n) && !bakedIn(n));
  assert.deepEqual(unwired, [], `patches nobody runs: ${unwired.join(', ')}`);
});
