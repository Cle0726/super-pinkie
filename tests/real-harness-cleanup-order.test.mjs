// B55: a real-UI test that starts its server and only registers cleanup after launchRealBrowser()
// leaks the listening server when the browser fails to launch, so node never exits and windows-checks
// sits until its 30-minute step limit (seen locally: hotspot-real-ui-regression launch failed at 34 s,
// then the file hung until killed). Cleanup must be registered before the server or browser starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(testsDir).filter((f) => /\.test\.(mjs|cjs)$/.test(f) && f !== path.basename(fileURLToPath(import.meta.url)));

// Once a server is listening, its cleanup (t.after / after / try) must be registered before the
// browser is launched: a launch failure in between leaves the server open and the file never exits.
const CLEANUP = /\bt\.after\(|\bafter\(|\btry\s*\{/;
const TEST_START = /\btest\(\s*['"`]|\bbefore\(/g;
function lateCleanups(source) {
  const bad = [];
  const lineOf = (index) => source.slice(0, index).split('\n').length;
  const testStarts = [...source.matchAll(TEST_START)].map((m) => m.index);
  for (const start of source.matchAll(/\bstartRealUiServer\(/g)) {
    const bodyStart = Math.max(0, ...testStarts.filter((i) => i < start.index));
    const bodyEnd = Math.min(source.length, ...testStarts.filter((i) => i > start.index));
    if (CLEANUP.test(source.slice(bodyStart, start.index))) continue;
    const rest = source.slice(start.index, bodyEnd);
    const launch = rest.search(/\blaunchRealBrowser\(/);
    if (launch < 0) continue;
    if (!CLEANUP.test(rest.slice(0, launch))) bad.push(`startRealUiServer at line ${lineOf(start.index)} before launchRealBrowser at line ${lineOf(start.index + launch)}`);
  }
  return bad;
}

test('real-UI tests register cleanup before they start the server or the browser', () => {
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(testsDir, file), 'utf8');
    if (!/startRealUiServer|launchRealBrowser/.test(source)) continue;
    for (const where of lateCleanups(source)) offenders.push(`${file}: ${where}`);
  }
  assert.deepEqual(offenders, [], 'cleanup registered too late (server leaks when the browser fails to launch):\n' + offenders.join('\n'));
});

test('the checker itself flags the late order and accepts the early one', () => {
  const late = "test('x', async (t) => {\n  const server = await startRealUiServer({});\n  const browser = await launchRealBrowser();\n  t.after(() => {});\n});";
  assert.deepEqual(lateCleanups(late), ['startRealUiServer at line 2 before launchRealBrowser at line 3']);
  const lateTry = "test('x', async () => {\n  const server = await startRealUiServer({});\n  const browser = await launchRealBrowser();\n  try {} finally { await server.close(); }\n});";
  assert.deepEqual(lateCleanups(lateTry), ['startRealUiServer at line 2 before launchRealBrowser at line 3']);
  const early = "test('x', async (t) => {\n  t.after(() => {});\n  server = await startRealUiServer({});\n  browser = await launchRealBrowser();\n});";
  assert.deepEqual(lateCleanups(early), []);
  const between = "test('x', async (t) => {\n  const server = await startRealUiServer({});\n  t.after(() => server.close());\n  const browser = await launchRealBrowser();\n});";
  assert.deepEqual(lateCleanups(between), []);
  const twoTests = "test('a', async (t) => {\n  t.after(() => {});\n  await startRealUiServer({});\n});\ntest('b', async () => {\n  await startRealUiServer({});\n  await launchRealBrowser();\n});";
  assert.deepEqual(lateCleanups(twoTests), ['startRealUiServer at line 6 before launchRealBrowser at line 7']);
});
