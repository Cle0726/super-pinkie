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
  assert.match(build, /services\/process_io\.py/);
  assert.match(launcher, /openclaw\/openclaw\.mjs/);
  assert.match(launcher, /python\/bin\/python3/);
  assert.match(launcher, /task\.executableURL = node/);
  assert.match(launcher, /Gateway\.stop\(\)/);
  assert.match(launcher, /startGatewayMonitor\(\)/);
  assert.match(launcher, /withTimeInterval: 2\.0/);
  assert.match(launcher, /gatewayProbeFailures >= 2/);
  assert.match(launcher, /gatewayRepairGraceUntil/);
  assert.match(launcher, /Date\(\) < graceUntil/);
  assert.match(launcher, /Date\(\)\.addingTimeInterval\(20\)/);
  assert.match(launcher, /Gateway\.repair\(\)/);
  assert.match(launcher, /gatewayMonitor\?\.invalidate\(\)/);
});

test('native startup uses the bundled opaque mascot video instead of exposing the desktop', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const loading = read('ui/launcher-loading.html');
  assert.match(launcher, /ui\/launcher-loading\.html/);
  assert.match(loading, /<video class="scene"/);
  assert.doesNotMatch(loading, /<video class="scene"[^>]*\bloop\b/);
  assert.match(loading, /addEventListener\("ended"/);
  assert.match(loading, /scene\.duration - 0\.04/);
  assert.match(loading, /assets\/laolao-splash\.mp4/);
  assert.match(loading, /assets\/laolao-splash-video-poster\.png/);
  assert.match(loading, /background: #efcbd3/);
  assert.doesNotMatch(loading, /background:\s*transparent/);
  assert.doesNotMatch(loading, /<main\b|超級碧琪正在准备<\/p>/);
  assert.match(launcher, /let remaining = 6\.1 - Date\(\)\.timeIntervalSince\(started\)/);
  assert.match(launcher, /contentView\.layer\?\.backgroundColor = NSColor\(/);
  assert.match(launcher, /didFinish navigation:[\s\S]*NSColor\.clear\.cgColor/);
  const updater = read('installer/macos/apply-theme.sh');
  assert.match(updater, /copy_if_changed "\$REPO_ROOT\/ui\/launcher-loading\.html"/);
  assert.match(updater, /install_relay_watchdog/);
  const watchdog = read('services/watchdog/cle-watchdog.sh');
  assert.match(watchdog, /status" != "000"/);
  assert.match(watchdog, /FAILURE_THRESHOLD/);
  assert.doesNotMatch(watchdog, /STATUS" != "200"/);
  assert.match(updater, /copy_if_changed "\$ASSET_ROOT\/laolao-splash\.mp4"/);
  assert.match(updater, /apply_ui_skin "\$bundled_ui"/);
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
  assert.match(setup, /\[\[ -e "\$target_dir\/\$filename" \|\| -L "\$target_dir\/\$filename" \]\]/);
});

test('source updaters preserve every existing user persona and context file', () => {
  const mac = read('install-full.sh');
  const windows = read('install.ps1');
  assert.match(mac, /\[\[ -e "\$target_dir\/\$filename" \|\| -L "\$target_dir\/\$filename" \]\]/);
  assert.match(mac, /保留已有 \$filename/);
  assert.match(windows, /if \(Test-Path \$dst\) \{[\s\S]*?keeping existing \$f[\s\S]*?continue/);
  assert.doesNotMatch(windows, /Copy-Item \$src \$dst -Force/);
});

test('release workflow publishes both desktop formats from self-contained builders', () => {
  const release = read('.github/workflows/release.yml');
  assert.match(release, /\.\/desktop\/macos\/build\.sh/);
  assert.match(release, /dist\/super-pinkie-macos-\*\.zip/);
  assert.match(release, /\.\\build-win\.ps1/);
  assert.match(release, /dist\/super-pinkie-windows-\*\.exe/);
});

test('roundtable uses its project as cwd without turning it into an access sandbox', () => {
  const server = read('services/roundtable/server.py');
  assert.match(server, /cwd=project/);
  assert.match(server, /不是访问权限边界/);
  assert.doesNotMatch(server, /worker_sandbox|sandbox-exec/);
});
