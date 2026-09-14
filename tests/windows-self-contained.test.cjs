const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// Cache-busting query versions, as `asset -> highest version number seen`.
const cacheVersions = (text, tableForm) => {
  const found = new Map();
  const bump = (asset, version) => {
    const number = Number(/(\d+)$/.exec(version)[1]);
    if (!found.has(asset) || number > found.get(asset).number) found.set(asset, { number, version });
  };
  for (const [, asset, version] of text.matchAll(/laolao-([a-z-]+\.(?:js|css))\?v=([a-z]+\d+)/g)) bump(asset, version);
  if (tableForm) {
    for (const [, asset, version] of text.matchAll(/'laolao-([a-z-]+\.(?:js|css))'\s*=\s*'([a-z]+\d+)'/g)) bump(asset, version);
  }
  return found;
};

test('Windows injects the same asset versions as macOS, never older ones', () => {
  // Both installers write into the same ui\injections assets. A version below
  // the asset's actual generation lets WebView2 keep its cached copy, so an
  // upgrade looks like it did nothing. macOS is the reference implementation.
  const mac = cacheVersions(read('installer/macos/apply-theme.sh'));
  const windows = cacheVersions(read('installer/windows/apply-theme.ps1'), true);
  const fragment = cacheVersions(read('ui/injections/laolao-head.fragment.html'));

  const stale = [];
  for (const [asset, target] of mac) {
    const current = windows.get(asset);
    // Absent from the table is fine only when the fragment already carries the
    // right version; the table runs afterwards and would otherwise rewrite it.
    if (!current) {
      const fromFragment = fragment.get(asset);
      if (!fromFragment || fromFragment.number < target.number) stale.push(`${asset}: missing, macOS has ${target.version}`);
      continue;
    }
    if (current.number < target.number) stale.push(`${asset}: ${current.version} < macOS ${target.version}`);
  }
  assert.deepEqual(stale, [], `Windows cache-bust versions are behind macOS:\n${stale.join('\n')}`);

  const downgraded = [];
  for (const [asset, fromFragment] of fragment) {
    const current = windows.get(asset);
    if (current && current.number < fromFragment.number) {
      downgraded.push(`${asset}: table ${current.version} < fragment ${fromFragment.version}`);
    }
  }
  assert.deepEqual(downgraded, [], `Windows lowers the version the shared head fragment injects:\n${downgraded.join('\n')}`);
});

test('the Windows installer pins one version per asset, not two', () => {
  // $headTags adds tags to legacy fragments that lack them, then the $versions
  // table normalises every reference.  When the two disagree the tag list wins
  // for the tags it injects, so a lower number there keeps serving the stale
  // cached copy even though the table looks correct.
  const source = read('installer/windows/apply-theme.ps1');
  const tags = source.slice(source.indexOf('$headTags = @('), source.indexOf('$versions = @{'));
  const table = source.slice(source.indexOf('$versions = @{'), source.indexOf('foreach ($entry in $versions.GetEnumerator())'));
  const pinned = (text, tableForm) => {
    const found = new Map();
    const collect = (asset, version) => { if (!found.has(asset)) found.set(asset, version); };
    for (const [, asset, version] of text.matchAll(/laolao-([a-z-]+\.(?:js|css))\?v=([a-z]+\d+)/g)) collect(asset, version);
    if (tableForm) {
      for (const [, asset, version] of text.matchAll(/'laolao-([a-z-]+\.(?:js|css))'\s*=\s*'([a-z]+\d+)'/g)) collect(asset, version);
    }
    return found;
  };
  const fromTags = pinned(tags), fromTable = pinned(table, true);
  const mismatched = [];
  for (const [asset, version] of fromTags) {
    const other = fromTable.get(asset);
    if (other && other !== version) mismatched.push(`${asset}: $headTags ${version} vs $versions ${other}`);
  }
  assert.deepEqual(mismatched, [], `The Windows installer pins two versions for one asset:\n${mismatched.join('\n')}`);
  assert.ok(fromTags.size >= 20, `the legacy-fragment tag list should still pin the shipped assets, saw ${fromTags.size}`);
});

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
  assert.match(launcher, /GATEWAY_CHAT_URL = urllib\.parse\.urljoin\(GATEWAY_URL, "chat"\)/);
  assert.match(launcher, /return GATEWAY_CHAT_URL/);
  assert.match(launcher, /gateway_environment\["OPENCLAW_SERVICE_KIND"\] = "gateway"/);
  assert.match(launcher, /while not self\.closing\.wait\(\.75\)/);
  assert.match(launcher, /self\.failure_limit = 2/);
  assert.match(launcher, /failures >= self\.failure_limit/);
  assert.doesNotMatch(launcher, /age < self\.startup_grace/);
  assert.match(launcher, /--auth", "none/);
  assert.match(launcher, /--bind", "loopback/);
  assert.match(launcher, /cleanup_orphan_webview/);
  assert.match(launcher, /PINKIE_KEEP_GATEWAY/);
  assert.match(launcher, /OPENCLAW_NO_AUTO_UPDATE/);
  assert.match(launcher, /CUA_DRIVER_RS_UPDATE_CHECK/);
  assert.match(launcher, /keeping gateway for background sessions/);
  assert.match(launcher, /pywebview window APIs from this worker thread/);
  assert.match(launcher, /synchronous evaluate_js there deadlocks/);
  assert.doesNotMatch(launcher, /self\.window\s*=/, 'js_api must not expose the recursive pywebview Window object');
  assert.match(launcher, /self\._window\s*=/);
  assert.match(launcher, /threading\.Thread\(target=bootstrap/);
  assert.match(launcher, /Never kill a still-live Gateway/);
  const loading = read('ui/launcher-loading.html');
  assert.match(loading, /location\.replace\("http:\/\/127\.0\.0\.1:18789\//);
  assert.match(loading, /location\.replace\("http:\/\/127\.0\.0\.1:18789\/chat"\)/);
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
  assert.match(launcher, /UpdateRoot/);
  assert.match(launcher, /Get-ChildItem -LiteralPath \$UpdateRoot/);
  assert.match(launcher, /Where-Object \{ \$_.Name -match '\^\[vV\]\?/);
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
  // The relay is mm-retry-proxy.py (what install.ps1 and the docs use, with
  // refusal-triggered fallback), not the older ur-rewrite-proxy.py. The frozen
  // build ships no interpreter, so it is started by re-executing the app.
  assert.match(launcher, /proxy\/mm-retry-proxy\.py/);
  assert.doesNotMatch(launcher, /ur-rewrite-proxy/);
  assert.match(launcher, /--ur-relay/);
  assert.match(entry, /--ur-relay/);
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
  assert.match(watchdog, /Start-Sleep -Milliseconds 2000/);
  assert.match(watchdog, /TotalSeconds -lt 8/);
  assert.doesNotMatch(watchdog, /taskkill/);
  // State lives under LOCALAPPDATA on Windows, and only on Windows.  Exactly
  // one module may spell that rule out; every other service resolves its state
  // directory through it, so the rule cannot drift apart again -- it had been
  // copied into six places, one of which never learned about sandboxes.
  const CANONICAL = 'services/state_root.py';
  assert.match(read(CANONICAL), /LOCALAPPDATA/,
    `${CANONICAL} is the definition that must know about LOCALAPPDATA`);
  assert.match(read(CANONICAL), /os\.name\s*!=\s*['"]nt['"]/,
    `${CANONICAL} must keep the Windows-only branch`);
  assert.match(read(CANONICAL), /PINKIE_STATE_ROOT/,
    `${CANONICAL} must keep the override the suites isolate themselves with`);
  for (const name of ['services/context/context_budget.py', 'services/context/setup.py',
    'services/project-scope/setup.py', 'services/party/setup.py',
    'services/party/usage.py', 'services/party/server.py',
    'services/roundtable/server.py']) {
    const source = read(name);
    // Also matches the subscript form, budget['state_root'](home), where the
    // closing quote and bracket sit between the name and the call.
    assert.match(source, /state_root['"]?\]?\s*\(/,
      `${name} must resolve its state directory through state_root()`);
    assert.doesNotMatch(source, /LOCALAPPDATA/,
      `${name} must not spell the state-root rule out again - ${CANONICAL} owns it`);
  }
});

test('the desktop shell reads PINKIE_STATE_ROOT instead of only exporting it', () => {
  const launcher = read('app/windows_desktop.py');
  const start = launcher.indexOf('def state_root(');
  assert.ok(start !== -1, 'app/windows_desktop.py must keep a state_root()');
  const body = launcher.slice(start, launcher.indexOf('\ndef ', start + 1));
  // It used to only *export* the variable to its child processes.  A guard that
  // just looked for the name therefore passed while the shell itself ignored it,
  // and a suite that set it kept writing the staged update and the updater log
  // into the live profile.
  assert.match(body, /os\.environ\.get\(\s*["']PINKIE_STATE_ROOT["']\s*\)/,
    'state_root() must read PINKIE_STATE_ROOT, not just pass it down');
  // Compare the code, not the prose above it: the comment names LOCALAPPDATA
  // too, and matching it first would report the override as coming second.
  const code = body.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  const override = code.indexOf('PINKIE_STATE_ROOT');
  const fallback = code.indexOf('LOCALAPPDATA');
  assert.ok(override !== -1 && fallback !== -1 && override < fallback,
    'the override must be consulted before the LOCALAPPDATA fallback');
});

test('the update suite keeps its downloads and log lines out of the live profile', () => {
  const suite = read('tests/windows_update_test.py');
  assert.match(suite, /PINKIE_STATE_ROOT/,
    'windows_update_test.py must isolate the state root it resolves');
  assert.doesNotMatch(suite, /LOCALAPPDATA/,
    'shadowing LOCALAPPDATA is a Windows-only accident; use the shared override');
});

test('uninstall finds the proxy by command line, not by executable path', () => {
  const install = read('install.ps1');
  // The proxy runs as `pythonw.exe proxy\mm-retry-proxy.py`, so its .Path is
  // pythonw.exe.  Matching the script name there never matched anything and
  // -Remove left the proxy listening on 1467; the script path only appears in
  // the command line, which Get-Process does not expose on 5.1.
  assert.match(install, /Get-CimInstance Win32_Process/);
  assert.match(install, /CommandLine[\s\S]{0,80}mm-retry-proxy/);
  assert.doesNotMatch(install, /\$_\.Path\s+-like\s+"\*mm-retry-proxy\*"/,
    'the executable path cannot identify a python-run script');
});

test('Windows bundled watchdog has a dedicated task installer', () => {
  const installer = read('installer/windows/register-bundled-watchdog.ps1');
  assert.match(installer, /SuperPinkieGatewayWatchdog/);
  assert.match(installer, /windows-gateway-watchdog\.ps1/);
  assert.match(installer, /-Port 18789 -Loop/);
  assert.match(installer, /New-ScheduledTaskTrigger/);
  assert.match(installer, /RunLevel Limited/);
});

test('every PowerShell script carries the UTF-8 BOM Windows PowerShell needs', () => {
  // Windows PowerShell 5.1 reads a BOM-less script with the machine's ANSI code
  // page, so every Chinese literal in it turns into mojibake as soon as that
  // code page is not UTF-8 -- which is the default on an English Windows.  CI
  // never caught it because GitHub Actions runs `pwsh` (PowerShell 7), and PS7
  // assumes UTF-8.  The costly one was `build-win.ps1`, which produced a build
  // whose payload folder was literally named "è¶…ç´šç¢§çª".
  //
  // Enumerate the tree instead of naming files by hand: the hand-written list
  // that used to live here is exactly why `build-win.ps1` and `update.ps1`
  // slipped through.
  const skipped = new Set(['.git', 'build', 'dist', 'node_modules', '__pycache__']);
  const scripts = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (skipped.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ps1')) scripts.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  assert.ok(scripts.length >= 6, `expected the shipped PowerShell scripts, found ${scripts.length}`);

  for (const name of scripts) {
    const bytes = fs.readFileSync(path.join(root, name));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} must start with a UTF-8 BOM`);
  }
});
