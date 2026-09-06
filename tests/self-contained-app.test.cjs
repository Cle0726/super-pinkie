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
  assert.match(build, /RUNTIME_ROOT\/cua-driver-helper\.tar\.gz/);
  assert.match(build, /RUNTIME_ROOT\/bin\/npm/);
  assert.match(build, /services\/process_io\.py/);
  assert.match(launcher, /openclaw\/openclaw\.mjs/);
  assert.match(launcher, /python\/bin\/python3/);
  assert.match(launcher, /\/Applications\/CuaDriver\.app/);
  assert.match(launcher, /task\.executableURL = node/);
  assert.match(launcher, /gatewayEnvironment\["OPENCLAW_SERVICE_KIND"\] = "gateway"/);
  assert.match(launcher, /gatewayEnvironment\["PINKIE_OPENCLAW_ENTRY"\] = entry\.path/);
  assert.match(launcher, /Gateway\.stop\(\)/);
  assert.match(launcher, /startGatewayMonitor\(\)/);
  assert.match(launcher, /withTimeInterval: 2\.0/);
  assert.match(launcher, /gatewayProbeFailures >= 6/);
  assert.match(launcher, /gatewayRepairGraceUntil/);
  assert.match(launcher, /Date\(\) < graceUntil/);
  assert.match(launcher, /Date\(\)\.addingTimeInterval\(90\)/);
  assert.match(launcher, /Gateway\.isReady/);
  assert.match(launcher, /if ready \{\s+self\?\.startGatewayMonitor\(\)\s+self\?\.loadDashboard\(\)/);
  assert.match(launcher, /Gateway\.repair\(\)/);
  assert.match(launcher, /gatewayMonitor\?\.invalidate\(\)/);
});

test('macOS app owns an unrestricted computer-control driver and capable node', () => {
  const build = read('desktop/macos/build.sh');
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const manifest = read('desktop/macos/runtime-manifest.json.in');
  assert.match(build, /CUA_DRIVER_VERSION="0\.22\.0"/);
  assert.match(build, /59603bc7e5f8d9d70f165d87158e577f99227ffcbb91d5fd9f9c688f4beb3727/);
  assert.match(build, /CUA_DRIVER_TEAM_ID="YCK386LBJ7"/);
  assert.match(build, /CUA_SDK_VERSION/);
  assert.match(build, /Library\/Caches/);
  assert.match(build, /curl -fL --retry 3 --retry-all-errors/);
  assert.match(build, /ACTUAL_CUA_SHA256/);
  assert.match(build, /cp "\$CUA_DRIVER_ARCHIVE_SOURCE" "\$RUNTIME_ROOT\/cua-driver-helper\.tar\.gz"/);
  assert.match(build, /codesign --verify --deep --strict "\$CUA_DRIVER_APP_SOURCE"/);
  assert.doesNotMatch(build, /codesign[^\n]*RUNTIME_ROOT\/bin\/cua-driver/);
  assert.match(build, /designated => identifier "com\.cle0726\.super-pinkie"/);
  assert.match(build, /SIGN_IDENTITY.*== "-"/);
  assert.match(manifest, /"cuaDriver": "@CUA_DRIVER_VERSION@"/);

  assert.match(launcher, /OPENCLAW_CUA_DRIVER_ENDPOINT/);
  assert.match(launcher, /private final class DesktopControlService/);
  assert.match(launcher, /URL\(fileURLWithPath: "\/tmp"/);
  assert.match(launcher, /clekk-cua-/);
  assert.match(launcher, /task\.executableURL = URL\(fileURLWithPath: "\/usr\/bin\/open"\)/);
  assert.match(launcher, /"-W", "-n", "-g"/);
  assert.match(launcher, /"--args", "serve"/);
  assert.match(launcher, /"--dangerously-bypass-approvals"/);
  assert.doesNotMatch(launcher, /"--no-permissions-gate"/);
  // Keep the CuaDriver cursor overlay enabled. Disabling it makes
  // move_cursor look like a permission failure even when input injection is
  // healthy, and removes useful action feedback during desktop work.
  assert.doesNotMatch(launcher, /"--no-overlay"/);
  assert.match(launcher, /private static func stopDriverApplications/);
  assert.match(launcher, /ensureCuaDriverApp/);
  assert.match(launcher, /TeamIdentifier=/);
  assert.match(launcher, /cua-driver-helper\.tar\.gz/);
  assert.match(launcher, /"node", "run"/);
  assert.match(launcher, /"--display-name", Self\.displayName/);
  assert.match(launcher, /"node", "identity", "--json"/);
  assert.match(launcher, /"nodes", "pending", "--json", "--timeout", "3000"/);
  assert.match(launcher, /row\["nodeId"\] as\? String == nodeID/);
  assert.match(launcher, /commands\.contains\("computer\.act"\)/);
  assert.match(launcher, /commands\.contains\("screen\.snapshot"\)/);
  assert.match(launcher, /"nodes", "approve", requestID/);
  assert.match(launcher, /private static func stopAndReap/);
  assert.match(launcher, /Self\.stopAndReap\(\[\(node, true\)\]\)/);
  assert.match(launcher, /SIGKILL/);
  assert.match(launcher, /desktopControl\.start\(\)/);
  assert.match(launcher, /desktopControl\.stop\(\)/);
  assert.match(launcher, /CUA_DRIVER_RS_UPDATE_CHECK=false/);
  assert.match(launcher, /CUA_DRIVER_RS_TELEMETRY_ENABLED=false/);
});

test('packaged runtimes ignore upstream update feeds and keep the CLE Kk updater', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const windows = read('app/windows_desktop.py');
  const setup = read('services/mode-architecture/setup.py');
  for (const source of [launcher, windows]) {
    assert.match(source, /OPENCLAW_NO_AUTO_UPDATE/);
    assert.match(source, /CUA_DRIVER_RS_UPDATE_CHECK/);
  }
  assert.match(setup, /update\["checkOnStart"\] = False/);
  assert.match(launcher, /主动拉取 CLE Kk 更新/);
  assert.match(windows, /Cle0726\/super-pinkie\/releases\/latest/);
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
  assert.match(launcher, /window\.hasShadow = false/);
  assert.match(launcher, /contentView\.layer\?\.borderColor = NSColor\(/);
  assert.match(launcher, /didFinish navigation:[\s\S]*srgbRed: 239\.0 \/ 255\.0/);
  assert.doesNotMatch(launcher, /didFinish navigation:[\s\S]{0,700}NSColor\.clear\.cgColor/);
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

test('startup splash controller is mounted once and tolerates the current app shell', () => {
  const body = read('ui/injections/laolao-body.fragment.html');
  const splash = read('ui/injections/laolao-splash.js');
  const installer = read('installer/macos/apply-theme.sh');
  assert.doesNotMatch(body, /<script[^>]+laolao-splash\.js/);
  assert.match(splash, /laolaoSplashController/);
  assert.match(splash, /openclaw-app-shell, openclaw-app \.shell/);
  assert.match(splash, /readyMode = !switching && ids\.includes\(mountedMode\)/);
  assert.match(installer, /exactly one startup controller/);
  assert.match(installer, /laolao-splash\.js\?v=splash22/);
});

test('current runtime keeps the classic single-chat shell instead of the upstream control console', () => {
  const css = read('ui/injections/laolao-classic-shell.css');
  const js = read('ui/injections/laolao-classic-shell.js');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  assert.match(css, /--oc-assistant-reserve-right: 0px/);
  assert.match(css, /openclaw-assistant-panel/);
  assert.match(css, /\.chat-pane__header-trailing/);
  assert.match(css, /\.laolao-classic-workspace-rail/);
  assert.match(css, /\.chat-workspace-rail\.laolao-classic-workspace-rail \{[\s\S]*?top: 0;/);
  assert.match(css, /\.chat-workspace-rail\.laolao-classic-workspace-rail::after \{[\s\S]*?top: 45px;/);
  assert.match(js, /laolao-classic-breadcrumb/);
  assert.match(js, /laolao-classic-more/);
  assert.match(js, /chat-workspace-rail--collapsed/);
  assert.match(js, /碧琪设置/);
  assert.match(js, /laolao-classic-account-avatar/);
  assert.match(js, /给 碧琪 发消息/);
  assert.match(css, /data-pinkie-native-glass="1"/);
  assert.match(css, /\.laolao-splash, \.laolao-mode-transition/);
  assert.match(mac, /laolao-classic-shell\.css/);
  assert.match(mac, /laolao-classic-shell\.js/);
  assert.match(windows, /laolao-classic-shell\.css/);
  assert.match(windows, /laolao-classic-shell\.js/);
  assert.match(mac, /laolao-memory\.css/);
  assert.match(mac, /laolao-memory\.js/);
  assert.match(windows, /laolao-memory\.css/);
  assert.match(windows, /laolao-memory\.js/);
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
  assert.match(build, /index\.mjs memory\.mjs setup\.py package\.json openclaw\.plugin\.json/);
});

test('source updaters preserve every existing user persona and context file', () => {
  const mac = read('install-full.sh');
  const windows = read('install.ps1');
  assert.match(mac, /\[\[ -e "\$target_dir\/\$filename" \|\| -L "\$target_dir\/\$filename" \]\]/);
  assert.match(mac, /保留已有 \$filename/);
  assert.match(windows, /if \(Test-Path \$dst\) \{[\s\S]*?keeping existing \$f[\s\S]*?continue/);
  assert.doesNotMatch(windows, /Copy-Item \$src \$dst -Force/);
  assert.match(mac, /restore_app_on_failure/);
  assert.match(mac, /已恢复上一版超級碧琪\.app/);
});

test('macOS manual update leaves the gateway page before replacing the App', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const updater = read('installer/macos/detached-update.sh');
  assert.match(launcher, /laolaoUpdate/);
  assert.match(launcher, /主动拉取更新/);
  assert.match(launcher, /copyItem\(at: bundledScript, to: helper\)/);
  assert.match(launcher, /NSApp\.terminate\(nil\)/);
  assert.doesNotMatch(launcher, /terminationHandler[\s\S]{0,500}更新完成/);
  assert.match(updater, /while .*kill -0.*CURRENT_PID/);
  assert.match(updater, /git -C "\$REPO" pull --ff-only/);
  assert.match(updater, /"\$REPO\/update-full\.sh"/);
  assert.match(updater, /reopen_app/);
  assert.match(updater, /旧版没有被改动|保留或恢复旧版/);
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
