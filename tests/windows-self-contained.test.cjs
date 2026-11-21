const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const pythonBin = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

// Content-hashed query versions, as `asset -> 10-char sha256 hex digest`.
const stampedAssetHashes = (text) => {
  const found = new Map();
  for (const [, asset, hash] of text.matchAll(/(?:src|href)=["']\/([^"'?]+)\?v=([a-f0-9]{10})(?:&[^"']*)?["']/g)) {
    found.set(asset, hash);
  }
  return found;
};

const verifyMacWindowsHashParity = (macDir, winDir) => {
  const macHead = stampedAssetHashes(fs.readFileSync(path.join(macDir, 'laolao-head.fragment.html'), 'utf8'));
  const winHead = stampedAssetHashes(fs.readFileSync(path.join(winDir, 'laolao-head.fragment.html'), 'utf8'));
  const macIndex = stampedAssetHashes(fs.readFileSync(path.join(macDir, 'index.html'), 'utf8'));
  const winIndex = stampedAssetHashes(fs.readFileSync(path.join(winDir, 'index.html'), 'utf8'));
  assert.ok(macHead.size >= 190, `expected full stamped head fragment, got ${macHead.size}`);
  assert.deepEqual([...winHead.keys()], [...macHead.keys()], 'Mac and Windows head asset lists must match');
  assert.deepEqual([...winIndex.keys()], [...macIndex.keys()], 'Mac and Windows index.html asset lists must match');
  for (const [asset, macHash] of macIndex.entries()) {
    const winHash = winIndex.get(asset);
    assert.equal(winHash, macHash, `Windows hash mismatch for ${asset}: win=${winHash} mac=${macHash}`);
    const winBytes = fs.readFileSync(path.join(winDir, asset));
    const actualWinHash = crypto.createHash('sha256').update(winBytes).digest('hex').slice(0, 10);
    assert.equal(actualWinHash, macHash, `Windows packaged file ${asset} content hash (${actualWinHash}) differs from Mac (${macHash})`);
  }
};

test('Windows and macOS compute identical content hashes for every asset and catch any stale Windows file', () => {
  require('./fixtures/shared-ui.cjs').sharedUi({'entries': ['laolao-mode-menu-fx.css'], 'assets': []});
  const source = read('build-win.ps1');
  assert.ok(source.indexOf('bundle.py') > source.indexOf('clean_ui.py'));
  assert.ok(source.indexOf('stamp.mjs') > source.indexOf('clean_ui.py'));
  assert.match(source, /windows-ui-manifest\.json/);
  assert.match(read('.github/workflows/release.yml'), /ui-parity:/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-win-hash-parity-'));
  try {
    const fixtureRoot = path.join(tmp, 'repo');
    for (const rel of [
      'ui/parity-policy.json',
      'ui/injections/laolao-body.fragment.html',
      'ui/injections/laolao-night.js',
      'ui/injections/laolao-night.css',
      'ui/injections/laolao-theme.css',
      'ui/injections/laolao-mode-menu-fx.css',
      'ui/injections/laolao-sidebar.js',
      'ui/injections/laolao-handoff-bootstrap.js',
      'ui/injections/laolao-reasoning-off.svg',
      'ui/assets/laolao-avatar.png',
      'ui/assets/ProviderIcon-crossmodel.svg',
      'ui/runtime/chat-page-DrPkxqJK.js',
      'ui/runtime/index-Bvtt7vVx.js',
    ]) {
      const dst = path.join(fixtureRoot, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(root, rel), dst);
    }
    fs.writeFileSync(
      path.join(fixtureRoot, 'ui/injections/laolao-head.fragment.html'),
      [
        '<script src="/laolao-night.js?v=@hash"></script>',
        '<!-- pinkie-native-assets -->',
        '<link rel="stylesheet" href="/laolao-theme.css?v=@hash">',
        '<link rel="stylesheet" href="/laolao-mode-menu-fx.css?v=@hash">',
        '<script defer src="/laolao-sidebar.js?v=@hash"></script>',
        '<link rel="stylesheet" href="/laolao-night.css?v=@hash">',
        '',
      ].join('\n'),
      'utf8'
    );

    const macUi = path.join(tmp, 'mac-control-ui');
    const winUi = path.join(tmp, 'win-control-ui');
    const macManifest = path.join(tmp, 'macos-ui-manifest.json');
    const winManifest = path.join(tmp, 'windows-ui-manifest.json');
    const bundlePy = path.join(root, 'tools/ui-parity/bundle.py');
    const stampMjs = path.join(root, 'tools/assets/stamp.mjs');
    for (const [uiDir, manifestOut] of [[macUi, macManifest], [winUi, winManifest]]) {
      fs.mkdirSync(path.join(uiDir, 'assets'), { recursive: true });
      fs.writeFileSync(
        path.join(uiDir, 'index.html'),
        '<!doctype html><html><head><script type="module" src="/assets/index-Bvtt7vVx.js?v=@hash&pinkie-surface=6&pinkie-browser=3&pinkie-learning=8"></script></head><body><openclaw-app></openclaw-app></body></html>\n',
        'utf8'
      );
      execFileSync(pythonBin, [bundlePy, 'install', '--root', fixtureRoot, '--control-ui', uiDir, '--output', manifestOut], { stdio: 'pipe' });
      execFileSync(process.execPath, [stampMjs, '--root', fixtureRoot, '--control-ui', uiDir, '--manifest', manifestOut], { stdio: 'pipe' });
    }
    const macHead = stampedAssetHashes(fs.readFileSync(path.join(macUi, 'laolao-head.fragment.html'), 'utf8'));
    const winHead = stampedAssetHashes(fs.readFileSync(path.join(winUi, 'laolao-head.fragment.html'), 'utf8'));
    assert.equal(macHead.size, 6);
    assert.deepEqual([...winHead.entries()], [...macHead.entries()]);
    execFileSync(pythonBin, [bundlePy, 'compare', macManifest, winManifest], { stdio: 'pipe' });

    const assertHashParity = () => {
      const mIdx = stampedAssetHashes(fs.readFileSync(path.join(macUi, 'index.html'), 'utf8'));
      const wIdx = stampedAssetHashes(fs.readFileSync(path.join(winUi, 'index.html'), 'utf8'));
      const mismatches = [];
      for (const [asset, macHash] of mIdx.entries()) {
        const winHash = wIdx.get(asset);
        const actualWinHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(winUi, asset))).digest('hex').slice(0, 10);
        if (winHash !== macHash || actualWinHash !== macHash) {
          mismatches.push(`${asset} (mac=${macHash}, winUrl=${winHash}, winFile=${actualWinHash})`);
        }
      }
      assert.equal(mismatches.length, 0, `Windows hash mismatch for ${mismatches.join(', ')}`);
    };
    assertHashParity();

    // Counterexample (M2-5): simulate Windows packaging missing the new version of an injection file.
    const targetAsset = 'laolao-sidebar.js';
    const originalWinBytes = fs.readFileSync(path.join(winUi, targetAsset));
    fs.writeFileSync(path.join(winUi, targetAsset), Buffer.concat([originalWinBytes, Buffer.from('\n/* stale windows copy */\n')]));
    assert.throws(
      () => assertHashParity(),
      /laolao-sidebar\.js/,
      'hash comparison must fail when Windows ships a different version of laolao-sidebar.js'
    );
    assert.throws(
      () => execFileSync(pythonBin, [bundlePy, 'check', '--root', fixtureRoot, '--control-ui', winUi], { stdio: 'pipe' }),
      /stale\/modified UI resource: laolao-sidebar\.js/,
      'bundle.py check must reject a Windows package with a stale asset'
    );
    // Even if Windows re-stamped its own stale copy, its stamped hash differs from Mac's hash.
    execFileSync(process.execPath, [stampMjs, '--root', fixtureRoot, '--control-ui', winUi, '--manifest', winManifest], { stdio: 'pipe' });
    assert.throws(
      () => assertHashParity(),
      /Windows hash mismatch for .*laolao-sidebar\.js/,
      'hash comparison must catch Windows stamping an older/different file than Mac'
    );
    assert.throws(
      () => execFileSync(pythonBin, [bundlePy, 'compare', macManifest, winManifest], { stdio: 'pipe' }),
      /Mac and Windows packaged UI manifests differ/,
      'bundle.py compare must reject mismatched Mac and Windows manifests'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the Windows installer pins one content hash per asset via bundle.py and stamp.mjs', () => {
  const source = read('installer/windows/apply-theme.ps1');
  assert.doesNotMatch(source, /\$headTags = @\(|\$versions = @\{/);
  assert.match(source, /tools\\assets\\stamp\.mjs/);
  require('./fixtures/shared-ui.cjs').sharedUi({entries:['laolao-theme.css','laolao-sidebar.js']});
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
  assert.match(build, /PINKIE_SKIP_RUNTIME_PATCHES/);
  assert.match(build, /desktop\\windows\\mac-runtime/);
  assert.match(build, /\$serviceStage;services/);
  assert.match(build, /\$personaStage;personas/);
});

test('both packages share the complete Mac browser renderer and preserve the backend snapshot', () => {
  const snapshot = path.join(root, 'desktop/windows/mac-runtime');
  const sums = fs.readFileSync(path.join(snapshot, 'SHA256SUMS'), 'utf8').trim().split('\n');
  const backend = sums.filter(line => line.includes('  openclaw/'));
  const backendText = backend.map(line => fs.readFileSync(path.join(snapshot, line.split('  ')[1]), 'utf8')).join('\n');
  for (const marker of ['pinkie-history-image-thumbnails:v1', 'pinkie-oversized-user-record:v1',
    'pinkie-context-breakdown:v1', 'pinkie-work-first-media-gate:v2']) {
    assert.ok(backendText.includes(marker), `the Mac snapshot is missing ${marker}`);
  }
  for (const line of sums) {
    const splitAt = line.indexOf('  ');
    assert.ok(splitAt > 0, line);
    const expected = line.slice(0, splitAt);
    const relative = line.slice(splitAt + 2);
    const file = path.join(snapshot, relative);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(actual, expected, relative);
  }
  const chat = read('ui/runtime/chat-page-DrPkxqJK.js');
  assert.match(chat, /\/\* pinkie-chat-timeline:v31 \*\//);
  assert.match(chat, /pinkie-thinking-segments:v1/);
  assert.doesNotMatch(chat, /pinkie-chat-timeline:v25/);
  // 追加消息时保留流式输出：ack 换新 runId 时不再清空 chatStream。
  assert.match(chat, /pinkie-stream-survive-steer:v1/);
  assert.match(chat, /keepPreviousStream/);
  const index = read('ui/control-ui.index.html');
  assert.match(index, /pinkie-surface=6/);
  assert.match(index, /pinkie-browser=3/);
  assert.match(index, /pinkie-learning=8/);
  assert.doesNotMatch(index, /laolao-[^" ]+\.(?:js|css)/, "runtime snapshot must not own a second skin");
  assert.ok(!fs.existsSync(path.join(snapshot, 'services/mode-architecture/index.mjs')), 'Windows must use the shared mode engine');
  assert.ok(!sums.some(line => line.endsWith('  services/mode-architecture/index.mjs')), 'the overlay must not replace the shared mode engine');
  const mode = read('services/mode-architecture/index.mjs');
  assert.doesNotMatch(mode, /C\.le\. 执行控制层/);
  // Personas ship from the repository; a snapshot copy used to overwrite them.
  assert.ok(!sums.some((line) => line.includes('  personas/')), 'the Mac snapshot must not carry personas');
  assert.ok(!fs.existsSync(path.join(snapshot, 'personas')));
  const soul = fs.readFileSync(path.join(root, 'personas/chat/SOUL.md'), 'utf8');
  assert.match(soul, /碧琪/);
  assert.doesNotMatch(soul, /Li An/);
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
  assert.match(loading, /AbortController/);
  assert.match(loading, /controller\.abort\(\), 2000\)/);
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
  assert.match(release, /\n  publish:\n    needs: \[windows-smoke, ui-parity\]\n/);
  assert.doesNotMatch(release, /action-gh-release|^  (source|macos-publish|windows-publish):/m);
  const publisher = read('tools/release/publish-github.sh');
  assert.match(publisher, /gh release create.*--verify-tag --draft/);
  assert.match(publisher, /verify-upload[\s\S]*gh release edit.*--verify-tag --draft=false --latest/);
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
  assert.match(launcher, /transparent=True/);
  assert.match(launcher, /configure_native_glass/);
  assert.match(launcher, /pinkie-native-resize-handles/);
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    assert.match(launcher, new RegExp(`data-edge=\\"?${edge}|['\"]${edge}['\"]`));
  }
  assert.match(launcher, /begin_resize/);
  assert.match(launcher, /window\.events\.maximized/);
  assert.match(launcher, /window\.events\.restored/);
  assert.match(launcher, /data-pinkie-maximized/);
  assert.match(launcher, /data-pinkie-platform', 'windows/);
  // The refined Windows caption uses real SVGs, not the old span pseudo-elements.
  assert.match(launcher, /captionIcon\('<path d="m5 5 10 10M15 5 5 15"\/>/);
  assert.match(launcher, /width:32px;height:30px/);
  assert.match(launcher, /button:focus-visible \{\s*outline:2px solid/);
  assert.match(launcher, /button\?\.setAttribute\('aria-pressed', String\(maximized\)\)/);
  assert.match(launcher, /icon\.innerHTML = maximized \? restoreIcon : maximizeIcon/);
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
    assert.equal(bytes.includes(Buffer.from('\r\n')), false, `${name} must keep LF line endings`);
  }
});

test('the injected bridge waits for a document it can actually append to', () => {
  // WebView2 reports the navigation as loaded while the document can still be
  // mid-parse, so `document.body` may not exist yet when the shell injects its
  // bridge.  `document.body.append(...)` threw there ("Cannot read properties of
  // null (reading 'append')"), the shell logged "native bridge setup skipped",
  // and the update health marker -- written after the injection at the time --
  // never appeared, which is how a working build gets rolled back.
  const found = /BRIDGE_SCRIPT = r"""([\s\S]*?)"""/.exec(read('app/windows_desktop.py'));
  assert.ok(found, 'app/windows_desktop.py must keep a BRIDGE_SCRIPT');

  const created = [];
  const listeners = [];
  const element = () => {
    const node = {
      id: '', className: '', textContent: '', innerHTML: '', children: [],
      style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      // dockState() mirrors the Mac shell's split attributes onto <html>. The
      // stub used to omit toggleAttribute, so the whole bridge threw here before
      // reaching anything this test cares about.
      toggleAttribute() {},
      setAttribute() {}, append(...kids) { node.children.push(...kids); }, prepend() {},
      querySelector: () => null, remove() {}, addEventListener() {},
    };
    created.push(node);
    return node;
  };
  const document = {
    documentElement: element(),
    body: null, // still parsing, which is the whole point
    head: element(),
    getElementById: () => null,
    querySelector: () => null,
    createElement: element,
    addEventListener: (type, handler) => listeners.push([type, handler]),
  };
  const sandbox = {
    document,
    window: { addEventListener() {}, dispatchEvent() {} },
    location: { protocol: 'http:', search: '', href: 'http://127.0.0.1:18789/' },
    URLSearchParams,
    Event: class { constructor(type) { this.type = type; } },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  };

  // The old script threw on `document.body.append(drag)` right here.
  vm.runInNewContext(found[1], sandbox);
  assert.equal(
    created.filter(node => node.id === 'pinkie-native-window-controls').length, 0,
    'nothing may be installed while the document cannot take it',
  );
  const waiting = listeners.find(([type]) => type === 'DOMContentLoaded');
  assert.ok(waiting, 'the bridge must wait for DOMContentLoaded instead of guessing');

  document.body = element();
  waiting[1]();
  const controls = created.find(node => node.id === 'pinkie-native-window-controls');
  assert.ok(controls, 'the window controls must appear once the document can take them');
  assert.ok(document.body.children.includes(controls), 'the controls must land in the body');
});

test('links inside the chat UI stay with its router; other local pages go back to chat', () => {
  // The bridge used to send every 127.0.0.1:18789 link to open_chat, so the
  // sidebar's 设置 (/settings/general) reloaded the chat page instead of
  // opening settings.
  const found = /BRIDGE_SCRIPT = r"""([\s\S]*?)"""/.exec(read('app/windows_desktop.py'));
  const run = (pageUrl) => {
    const clicks = [];
    const calls = [];
    const element = () => {
      const node = {
        id: '', className: '', textContent: '', innerHTML: '', children: [], style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        toggleAttribute() {}, setAttribute() {}, getAttribute: () => null, append(...kids) { node.children.push(...kids); },
        prepend() {}, querySelector: () => null, querySelectorAll: () => [], remove() {}, addEventListener() {},
      };
      return node;
    };
    const document = {
      documentElement: element(), body: null, head: element(),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: element,
      addEventListener: (type, handler) => { if (type === 'click') clicks.push(handler); },
    };
    const api = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return Promise.resolve(); } });
    const url = new URL(pageUrl);
    vm.runInNewContext(found[1], {
      document, URL, URLSearchParams, Promise,
      window: { addEventListener() {}, dispatchEvent() {}, pywebview: { api } },
      location: { protocol: url.protocol, host: url.host, search: url.search, href: url.href },
      Event: class { constructor(type) { this.type = type; } },
      setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    });
    const link = { href: new URL('/settings/general', 'http://127.0.0.1:18789/').href };
    const event = { target: { closest: selector => (selector === 'a[href]' ? link : null) }, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    for (const handler of clicks) handler(event);
    return { prevented: event.defaultPrevented, opened: calls.some(([name]) => name === 'open_chat') };
  };
  assert.deepEqual(run('http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain'), { prevented: false, opened: false });
  assert.deepEqual(run('http://127.0.0.1:18790/party'), { prevented: true, opened: true });
});
