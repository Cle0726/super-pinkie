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

test('native startup uses the bundled opaque mascot video instead of exposing the desktop', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const loading = read('ui/launcher-loading.html');
  assert.match(launcher, /ui\/launcher-loading\.html/);
  assert.match(loading, /<video class="scene"/);
  assert.match(loading, /assets\/laolao-splash\.mp4/);
  assert.match(loading, /assets\/laolao-splash-video-poster\.png/);
  assert.match(loading, /background: #efcbd3/);
  assert.doesNotMatch(loading, /background:\s*transparent/);
  assert.doesNotMatch(loading, /<main\b|超級碧琪正在准备<\/p>/);
  assert.match(launcher, /let remaining = 6\.1 - Date\(\)\.timeIntervalSince\(started\)/);
  assert.match(launcher, /contentView\.layer\?\.backgroundColor = NSColor\(/);
  assert.match(launcher, /didFinish navigation:[\s\S]*NSColor\.clear\.cgColor/);
});

test('the web stage keeps the original 来啦～老弟 entrance after the native movie', () => {
  const body = read('ui/injections/laolao-body.fragment.html');
  const splash = read('ui/injections/laolao-splash.css');
  assert.match(body, /class="laolao-splash__title">来啦～老弟/);
  assert.doesNotMatch(body, /laolao-splash__video|laolao-splash\.mp4/);
  assert.match(splash, /url\("\.\/laolao-splash\.png"\)/);
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
