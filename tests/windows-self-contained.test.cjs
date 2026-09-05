const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Windows exe embeds its own Node and OpenClaw runtime', () => {
  const build = read('build-win.ps1');
  const manifest = JSON.parse(read('desktop/windows/runtime-manifest.json'));
  assert.match(manifest.node, /^24\./);
  assert.match(manifest.openclaw, /^2026\./);
  assert.match(build, /openclaw@\$\(\$manifest\.openclaw\)/);
  assert.match(build, /node\.exe'\);runtime\\bin/);
  assert.match(build, /runtime\\node_modules/);
  assert.match(build, /--onedir/, 'Windows builds must use the fast-starting onedir layout');
  assert.match(build, /--onefile/);
  assert.match(build, /LegacyOneFile/);
  assert.match(build, /pywebview/);
  assert.match(build, /pywin32/);
  assert.match(build, /sqlite3/);
  assert.match(build, /_sqlite3/);
  assert.match(build, /--collect-binaries/, 'native sqlite binaries must be collected');
  assert.doesNotMatch(build, /winget/);
  assert.doesNotMatch(build, /openclaw\.json/);
});

test('Windows desktop launches the bundled gateway and keeps it supervised', () => {
  const launcher = read('app/windows_desktop.py');
  assert.match(launcher, /node_modules\/openclaw\/openclaw\.mjs/);
  assert.match(launcher, /gateway", "run"/);
  assert.match(launcher, /while not self\.closing\.wait\(2\)/);
  assert.match(launcher, /self\.failure_limit = 3/);
  assert.match(launcher, /failures >= self\.failure_limit/);
  assert.doesNotMatch(launcher, /age < self\.startup_grace/);
  assert.match(launcher, /--auth", "none/);
  assert.match(launcher, /--bind", "loopback/);
  assert.match(launcher, /cleanup_orphan_webview/);
  assert.match(launcher, /PINKIE_KEEP_GATEWAY/);
  assert.match(launcher, /keeping gateway for background sessions/);
  assert.match(launcher, /pywebview window APIs from this worker thread/);
  assert.match(launcher, /synchronous evaluate_js there deadlocks/);
  assert.doesNotMatch(launcher, /self\.window\s*=/, 'js_api must not expose the recursive pywebview Window object');
  assert.match(launcher, /self\._window\s*=/);
  assert.match(launcher, /threading\.Thread\(target=bootstrap/);
  assert.match(launcher, /Never kill a still-live Gateway/);
  const loading = read('ui/launcher-loading.html');
  assert.match(loading, /location\.replace\("http:\/\/127\.0\.0\.1:18789\//);
  assert.match(loading, /mode: "no-cors"/);
  assert.match(launcher, /frameless=True/);
});

test('Windows exe checks signed release assets and can roll back a failed update', () => {
  const launcher = read('app/windows_desktop.py');
  const release = read('.github/workflows/release.yml');
  assert.match(launcher, /api\.github\.com\/repos\/Cle0726\/super-pinkie\/releases\/latest/);
  assert.match(launcher, /super-pinkie-windows-/);
  assert.match(launcher, /\.sha256/);
  assert.match(launcher, /Restore-PreviousVersion/);
  assert.match(launcher, /--update-health-token/);
  assert.match(launcher, /check_for_updates/);
  assert.match(launcher, /prepare_update/);
  assert.match(launcher, /aria-label="主动拉取更新"/);
  assert.match(launcher, /subprocess\.Popen\([\s\S]*?close_fds=True/);
  assert.match(launcher, /threading\.Timer\(\.6, self\._window\.destroy\)/);
  assert.match(release, /Get-FileHash/);
  assert.match(release, /windows-\*\.exe\.sha256/);
  assert.match(release, /portable\.zip/);
  assert.match(release, /portable\.zip\.sha256/);
});

test('Windows shell keeps all local spaces, project picker, voice and startup movie', () => {
  const launcher = read('app/windows_desktop.py');
  const entry = read('app/super_pinkie.py');
  assert.match(launcher, /services\/party\/server\.py/);
  assert.match(launcher, /services\/roundtable\/server\.py/);
  assert.match(launcher, /services\/tts\/edge_tts_server\.py/);
  assert.match(launcher, /proxy\/ur-rewrite-proxy\.py/);
  assert.match(launcher, /FOLDER_DIALOG/);
  assert.match(launcher, /laolaoNativeDictation/);
  assert.match(launcher, /SAPI\.SpSharedRecognizer/);
  assert.match(launcher, /pywebview-drag-region/);
  assert.match(launcher, /min_size=\(760, 500\), resizable=True/);
  assert.match(launcher, /shadow=True/);
  assert.match(launcher, /pinkie-native-resize-handles/);
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    assert.match(launcher, new RegExp(`data-edge=\\"?${edge}|['\"]${edge}['\"]`));
  }
  assert.match(launcher, /begin_resize/);
  assert.match(launcher, /window\.events\.maximized/);
  assert.match(launcher, /window\.events\.restored/);
  assert.match(launcher, /data-pinkie-maximized/);
  assert.match(launcher, /data-pinkie-platform', 'windows/);
  assert.match(launcher, /data-act="close"\] span::before/);
  assert.match(launcher, /width:42px;height:32px/);
  assert.match(launcher, /launcher-loading\.html/);
  assert.match(launcher, /PINKIE_STATE_ROOT/);
  assert.match(launcher, /storage_path=/);
  assert.match(launcher, /location\.protocol === 'file:'\) return/);
  assert.match(entry, /prepare_bundled_desktop/);
  assert.match(entry, /preserve_existing=True/);
  assert.match(entry, /--control-center/);
});

test('Windows subprocess streams use threads instead of unsupported pipe selectors', () => {
  const processIo = read('services/process_io.py');
  const party = read('services/party/server.py');
  const roundtable = read('services/roundtable/server.py');
  assert.match(processIo, /if os\.name != "nt"/);
  assert.match(processIo, /queue\.Queue/);
  assert.match(processIo, /read1/);
  assert.match(processIo, /taskkill/);
  assert.doesNotMatch(party, /selectors\.DefaultSelector/);
  assert.doesNotMatch(roundtable, /selectors\.DefaultSelector/);
  assert.match(party, /iter_process_output/);
  assert.match(roundtable, /iter_process_output/);
});

test('Windows deployment uses explicit ports, windowless Python and a safe gateway watchdog', () => {
  const install = read('install.ps1');
  const proxy = read('proxy/mm-retry-proxy.py');
  const watchdog = read('services/watchdog/windows-gateway-watchdog.ps1');
  assert.match(install, /pythonw\.exe/);
  assert.match(install, /UR_PROXY_UPSTREAM_PORT/);
  assert.match(install, /OpenClawGatewayWatchdog/);
  assert.match(install, /auth\.mode = "none"/);
  assert.match(proxy, /UR_PROXY_LISTEN/);
  assert.match(proxy, /UR_PROXY_UPSTREAM_PORT/);
  assert.match(proxy, /UR_PROXY_PROMPTS_DIR/);
  assert.match(watchdog, /--auth.*none/);
  assert.match(watchdog, /Invoke-WebRequest/);
  assert.doesNotMatch(watchdog, /taskkill/);
  for (const name of ['services/context/context_budget.py', 'services/context/setup.py', 'services/project-scope/setup.py', 'services/party/setup.py', 'services/roundtable/server.py']) {
    assert.match(read(name), /LOCALAPPDATA/);
    assert.match(read(name), /os\.name\s*==\s*['"]nt['"]|os\.name\s*!=\s*['"]nt['"]/);
  }
});

test('Windows bundled watchdog has a dedicated task installer', () => {
  const installer = read('installer/windows/register-bundled-watchdog.ps1');
  assert.match(installer, /SuperPinkieGatewayWatchdog/);
  assert.match(installer, /windows-gateway-watchdog\.ps1/);
  assert.match(installer, /New-ScheduledTaskTrigger/);
  assert.match(installer, /RunLevel Limited/);
});

test('PowerShell entrypoints are UTF-8 with BOM for Windows PowerShell 5.1', () => {
  for (const name of ['install.ps1', 'installer/windows/apply-theme.ps1', 'services/watchdog/windows-gateway-watchdog.ps1']) {
    const bytes = fs.readFileSync(path.join(root, name));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} must have UTF-8 BOM`);
  }
});
