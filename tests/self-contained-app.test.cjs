const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('macOS app ships and prefers its own gateway, node and python runtimes', () => {
  const build = read('desktop/macos/build.sh');
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  assert.match(build, /RUNTIME_ROOT\/openclaw/);
  assert.match(build, /RUNTIME_ROOT\/python/);
  assert.match(build, /RUNTIME_ROOT\/bin\/node/);
  assert.match(build, /RUNTIME_ROOT\/bin\/npm/);
  assert.match(launcher, /openclaw\/openclaw\.mjs/);
  assert.match(launcher, /python\/bin\/python3/);
  assert.match(launcher, /task\.executableURL = node/);
  assert.match(launcher, /Gateway\.stop\(\)/);
});

test('native startup uses a code-native loading mark instead of a pasted scene image', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const loading = read('ui/launcher-loading.html');
  assert.match(launcher, /ui\/launcher-loading\.html/);
  assert.match(loading, /class="mark"/);
  assert.doesNotMatch(loading, /<img\b|laolao-splash\.png/);
});

test('bundle keeps user state external and first launch uses bundled executables', () => {
  const build = read('desktop/macos/build.sh');
  const setup = read('installer/macos/apply-bundled.sh');
  assert.doesNotMatch(build, /cp[^\n]*openclaw\.json/);
  assert.match(build, /not copied/);
  assert.match(setup, /PINKIE_OPENCLAW_BIN/);
  assert.match(setup, /PINKIE_PYTHON_BIN/);
  assert.match(setup, /PINKIE_MANAGED_GATEWAY/);
});

test('roundtable sandbox admits an app-bundled runtime root', () => {
  const server = read('services/roundtable/server.py');
  assert.match(server, /for parent in Path\(binary\)\.resolve\(\)\.parents if \(parent\/'bin\/node'\)\.is_file\(\)/);
  assert.doesNotMatch(server, /parent\.name\.startswith\('v'\)/);
});
