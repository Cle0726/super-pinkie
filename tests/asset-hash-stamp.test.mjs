import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {measure} from '../tools/health/measure.mjs';
import {healthChanges, loadExceptions, readJson} from '../tools/health/ratchet.mjs';
import {
  ASSET_MANIFEST_JS,
  HEAD_FRAGMENT,
  sha10,
  stampControlUi,
} from '../tools/assets/stamp.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function parseAssetUrls(htmlText) {
  const map = new Map();
  for (const [, attrPath, ver] of htmlText.matchAll(/(?:src|href)=["']\/([^"'?]+)\?v=([a-f0-9]{10})(?:&[^"']*)?["']/g)) {
    map.set(attrPath, ver);
  }
  return map;
}

function parseManifestTable(manifestJsText) {
  const match = /const M = (\{[\s\S]*?\});\s*window\.__pinkieAssetManifest/.exec(manifestJsText);
  assert.ok(match, 'laolao-asset-manifest.js must define const M');
  return JSON.parse(match[1]);
}

function createFixtureRepo(tmpDir) {
  const repo = path.join(tmpDir, 'repo');
  const filesToCopy = [
    'ui/parity-policy.json',
    'ui/injections/laolao-body.fragment.html',
    'ui/injections/laolao-night.js',
    'ui/injections/laolao-night.css',
    'ui/injections/laolao-theme.css',
    'ui/injections/laolao-sidebar.js',
    'ui/injections/laolao-mode-switcher.js',
    'ui/injections/laolao-study-desk-drill.js',
    'ui/injections/laolao-handoff-bootstrap.js',
    'ui/injections/laolao-reasoning-off.svg',
    'ui/assets/laolao-avatar.png',
    'ui/assets/ProviderIcon-crossmodel.svg',
    'ui/runtime/chat-page-DrPkxqJK.js',
    'ui/runtime/index-Bvtt7vVx.js',
    'tools/ui-parity/bundle.py',
    'tools/ui-parity/sw_cache.py',
    'tools/assets/stamp.mjs',
    'patch/lib-precompressed.mjs',
    'installer/windows/apply-theme.ps1',
  ];
  for (const rel of filesToCopy) {
    const dst = path.join(repo, rel);
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  fs.writeFileSync(
    path.join(repo, 'ui/injections/laolao-head.fragment.html'),
    [
      '<script src="/laolao-night.js?v=@hash"></script>',
      '<!-- pinkie-native-assets -->',
      '<link rel="stylesheet" href="/laolao-theme.css?v=@hash">',
      '<script defer src="/laolao-sidebar.js?v=@hash"></script>',
      '<script defer src="/laolao-mode-switcher.js?v=@hash"></script>',
      '<link rel="stylesheet" href="/laolao-night.css?v=@hash">',
      '',
    ].join('\n'),
    'utf8'
  );
  return repo;
}

test('M2-1: source tree has 0 manual versions, uses @hash placeholders, and ratchet rejects any manual ?v=', async () => {
  const report = await measure(ROOT, {includeTestInventory: false});
  assert.equal(report.manualVersions.total, 0);
  assert.deepEqual(report.manualVersions.counts, {head: 0, injections: 0, runtime: 0, tooling: 0});
  assert.deepEqual(report.manualVersions.occurrences, []);

  const head = fs.readFileSync(path.join(ROOT, 'ui/injections/laolao-head.fragment.html'), 'utf8');
  const queryMatches = [...head.matchAll(/\?v=([^\s"'&>]+)/g)];
  assert.ok(queryMatches.length >= 195);
  for (const [, val] of queryMatches) {
    assert.equal(val, '@hash', 'every ?v= in laolao-head.fragment.html must be @hash');
  }

  const baseline = readJson(path.join(ROOT, 'tools/health/baseline.json'));
  // 生效例外 = exceptions.json + exceptions.d 增量（和 ratchet 一样合并），否则用增量的 PR 会多出假的「抬高」。
  const exceptions = loadExceptions(ROOT);
  assert.equal(baseline.manualVersions.total, 0);

  // Counterexample: adding a manual version fails the ratchet immediately.
  const polluted = structuredClone(report);
  polluted.manualVersions = {
    counts: {head: 1, injections: 0, runtime: 0, tooling: 0},
    occurrences: [{file: 'ui/injections/laolao-head.fragment.html', line: 1, column: 1, source: 'head', value: 'manual1'}],
    total: 1,
  };
  const diff = healthChanges(polluted, baseline, exceptions);
  assert.equal(diff.increases.length, 1);
  assert.match(diff.increases[0], /手写版本号总数增加（基线 0 → 当前 1）/);
});

test('M2-2: modifying 1 byte of an injection file changes only its URL hash across Windows packaging and installer paths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-m2-one-byte-'));
  try {
    const repo = createFixtureRepo(tmp);
    const openclawRoot = path.join(tmp, 'openclaw');
    const controlUi = path.join(openclawRoot, 'dist/control-ui');
    const manifestOut = path.join(tmp, 'windows-ui-manifest.json');
    fs.mkdirSync(path.join(controlUi, 'assets'), {recursive: true});
    const initialIndex = '<!doctype html><html><head><script type="module" src="/assets/index-Bvtt7vVx.js?v=@hash&pinkie-surface=6&pinkie-browser=3&pinkie-learning=8"></script></head><body><openclaw-app></openclaw-app></body></html>\n';
    fs.writeFileSync(path.join(controlUi, 'index.html'), initialIndex, 'utf8');

    // Path 1: Windows packaging UI step (bundle.py install + tools/assets/stamp.mjs)
    const bundlePy = path.join(repo, 'tools/ui-parity/bundle.py');
    execFileSync(PYTHON, [bundlePy, 'install', '--root', repo, '--control-ui', controlUi, '--output', manifestOut], {stdio: 'pipe'});
    stampControlUi(controlUi, {root: repo, manifestOutput: manifestOut});

    const beforeIndexUrls = parseAssetUrls(fs.readFileSync(path.join(controlUi, 'index.html'), 'utf8'));
    const beforeHeadUrls = parseAssetUrls(fs.readFileSync(path.join(controlUi, HEAD_FRAGMENT), 'utf8'));
    const beforeTable = parseManifestTable(fs.readFileSync(path.join(controlUi, ASSET_MANIFEST_JS), 'utf8'));

    // Modify 1 byte of laolao-sidebar.js
    const sidebarPath = path.join(repo, 'ui/injections/laolao-sidebar.js');
    fs.writeFileSync(sidebarPath, Buffer.concat([fs.readFileSync(sidebarPath), Buffer.from('\n')]));
    const expectedSidebarHash = sha10(fs.readFileSync(sidebarPath));

    execFileSync(PYTHON, [bundlePy, 'install', '--root', repo, '--control-ui', controlUi, '--output', manifestOut], {stdio: 'pipe'});
    stampControlUi(controlUi, {root: repo, manifestOutput: manifestOut});

    const afterIndexUrls = parseAssetUrls(fs.readFileSync(path.join(controlUi, 'index.html'), 'utf8'));
    const afterHeadUrls = parseAssetUrls(fs.readFileSync(path.join(controlUi, HEAD_FRAGMENT), 'utf8'));
    const afterTable = parseManifestTable(fs.readFileSync(path.join(controlUi, ASSET_MANIFEST_JS), 'utf8'));

    assert.notEqual(afterIndexUrls.get('laolao-sidebar.js'), beforeIndexUrls.get('laolao-sidebar.js'));
    assert.equal(afterIndexUrls.get('laolao-sidebar.js'), expectedSidebarHash);
    assert.equal(afterHeadUrls.get('laolao-sidebar.js'), expectedSidebarHash);
    assert.equal(afterTable['laolao-sidebar.js'], expectedSidebarHash);

    for (const [asset, beforeHash] of beforeIndexUrls.entries()) {
      if (asset === 'laolao-sidebar.js' || asset === ASSET_MANIFEST_JS) continue;
      assert.equal(afterIndexUrls.get(asset), beforeHash, `unrelated asset URL in index.html must not change: ${asset}`);
    }
    for (const [key, beforeHash] of Object.entries(beforeTable)) {
      if (key === 'laolao-sidebar.js') continue;
      assert.equal(afterTable[key], beforeHash, `unrelated asset in laolao-asset-manifest.js must not change: ${key}`);
    }

    // Path 2: Windows installer script (installer/windows/apply-theme.ps1) on Windows
    if (process.platform === 'win32') {
      const isoHome = path.join(tmp, 'home');
      fs.mkdirSync(isoHome, {recursive: true});
      const psExe = fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
        ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        : 'powershell';
      const env = {
        ...process.env,
        USERPROFILE: isoHome,
        HOME: isoHome,
        APPDATA: path.join(isoHome, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(isoHome, 'AppData', 'Local'),
        OPENCLAW_ROOT: openclawRoot,
        PINKIE_SKIP_APP_BUNDLES: '1',
        PINKIE_SKIP_RUNTIME_PATCHES: '1',
      };
      // Modify 1 byte of laolao-mode-switcher.js and re-run apply-theme.ps1
      const switcherPath = path.join(repo, 'ui/injections/laolao-mode-switcher.js');
      fs.writeFileSync(switcherPath, Buffer.concat([fs.readFileSync(switcherPath), Buffer.from('\n')]));
      const expectedSwitcherHash = sha10(fs.readFileSync(switcherPath));

      execFileSync(psExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'installer/windows/apply-theme.ps1')], {
        cwd: repo,
        env,
        stdio: 'pipe',
      });

      const psIndexUrls = parseAssetUrls(fs.readFileSync(path.join(controlUi, 'index.html'), 'utf8'));
      const psTable = parseManifestTable(fs.readFileSync(path.join(controlUi, ASSET_MANIFEST_JS), 'utf8'));
      assert.equal(psIndexUrls.get('laolao-mode-switcher.js'), expectedSwitcherHash);
      assert.equal(psTable['laolao-mode-switcher.js'], expectedSwitcherHash);
      for (const [asset, prevHash] of afterIndexUrls.entries()) {
        if (asset === 'laolao-mode-switcher.js' || asset === ASSET_MANIFEST_JS) continue;
        assert.equal(psIndexUrls.get(asset), prevHash, `apply-theme.ps1 must keep unrelated asset URL unchanged: ${asset}`);
      }
    }
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test('M2-3: second browser load in isolated environment fetches modified file with HTTP 200 and new content', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-m2-browser-cache-'));
  let server;
  let browser;
  try {
    const controlUi = path.join(tmp, 'control-ui');
    fs.mkdirSync(path.join(controlUi, 'assets'), {recursive: true});
    fs.writeFileSync(path.join(controlUi, 'laolao-night.js'), 'window.__nightLoaded = 1;\n', 'utf8');
    fs.writeFileSync(path.join(controlUi, 'laolao-probe.js'), 'window.__probeVersion = "v1-initial";\n', 'utf8');
    fs.writeFileSync(path.join(controlUi, 'laolao-lazy.js'), 'window.__lazyVersion = "lazy-v1";\n', 'utf8');
    fs.writeFileSync(path.join(controlUi, 'laolao-handoff-bootstrap.js'), 'window.__handoffLoaded = 1;\n', 'utf8');
    fs.writeFileSync(path.join(controlUi, 'assets/chat-page-DrPkxqJK.js'), 'export const chat = 1;\n', 'utf8');
    fs.writeFileSync(path.join(controlUi, 'assets/index-Bvtt7vVx.js'), 'window.__entryLoaded = 1;\n', 'utf8');
    fs.writeFileSync(
      path.join(controlUi, HEAD_FRAGMENT),
      '<script src="/laolao-night.js?v=@hash"></script>\n<!-- pinkie-native-assets -->\n<script defer src="/laolao-probe.js?v=@hash"></script>\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(controlUi, 'index.html'),
      [
        '<!doctype html><html><head>',
        '    <script src="/laolao-night.js?v=@hash"></script>',
        '    <script type="module" src="/assets/index-Bvtt7vVx.js?v=@hash"></script>',
        '    <script defer src="/laolao-probe.js?v=@hash"></script>',
        '  </head><body><openclaw-app></openclaw-app></body></html>',
      ].join('\n'),
      'utf8'
    );

    stampControlUi(controlUi, {root: tmp});

    // Server implements apply-control-ui-cache.mjs ETag + 304 Not Modified + aggressive cache for versioned assets
    const serverRequests = [];
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const filePath = path.join(controlUi, rel);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const stat = fs.statSync(filePath);
      const etag = `"pk-${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
      res.setHeader('ETag', etag);
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && String(ifNoneMatch).split(',').map((s) => s.trim()).includes(etag)) {
        serverRequests.push({url: req.url, status: 304});
        res.statusCode = 304;
        res.setHeader('Cache-Control', 'no-cache');
        res.end();
        return;
      }
      const ext = path.extname(filePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', ext === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      serverRequests.push({url: req.url, status: 200});
      res.end(fs.readFileSync(filePath));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/`;

    const {chromium} = playwright();
    try {
      browser = await chromium.launch({headless: true});
    } catch {
      browser = await chromium.launch({headless: true, channel: 'chrome'});
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    const browserResponses = [];
    page.on('response', (response) => {
      browserResponses.push({url: response.url(), status: response.status(), fromServiceWorker: response.fromServiceWorker()});
    });

    // First page load
    await page.goto(baseUrl, {waitUntil: 'networkidle'});
    const firstProbe = await page.evaluate(async () => {
      const lazyUrl = window.__pinkieAsset('laolao-lazy.js');
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/' + lazyUrl;
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
      });
      return {
        probeVersion: window.__probeVersion,
        lazyVersion: window.__lazyVersion,
        lazyUrl,
      };
    });
    assert.equal(firstProbe.probeVersion, 'v1-initial');
    assert.equal(firstProbe.lazyVersion, 'lazy-v1');
    const firstProbeHash = sha10(fs.readFileSync(path.join(controlUi, 'laolao-probe.js')));
    const firstLazyHash = sha10(fs.readFileSync(path.join(controlUi, 'laolao-lazy.js')));
    assert.equal(firstProbe.lazyUrl, `laolao-lazy.js?v=${firstLazyHash}`);

    // Modify 1 byte of laolao-probe.js and laolao-lazy.js, then re-stamp
    fs.writeFileSync(path.join(controlUi, 'laolao-probe.js'), 'window.__probeVersion = "v2-updated";\n', 'utf8');
    fs.writeFileSync(path.join(controlUi, 'laolao-lazy.js'), 'window.__lazyVersion = "lazy-v2";\n', 'utf8');
    stampControlUi(controlUi, {root: tmp});
    const secondProbeHash = sha10(fs.readFileSync(path.join(controlUi, 'laolao-probe.js')));
    const secondLazyHash = sha10(fs.readFileSync(path.join(controlUi, 'laolao-lazy.js')));
    assert.notEqual(secondProbeHash, firstProbeHash);
    assert.notEqual(secondLazyHash, firstLazyHash);

    browserResponses.length = 0;
    serverRequests.length = 0;

    // Second page load in the same browser context
    await page.goto(baseUrl, {waitUntil: 'networkidle'});
    const secondProbe = await page.evaluate(async () => {
      const lazyUrl = window.__pinkieAsset('laolao-lazy.js');
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/' + lazyUrl;
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
      });
      return {
        probeVersion: window.__probeVersion,
        lazyVersion: window.__lazyVersion,
        lazyUrl,
      };
    });

    assert.equal(secondProbe.probeVersion, 'v2-updated');
    assert.equal(secondProbe.lazyVersion, 'lazy-v2');
    assert.equal(secondProbe.lazyUrl, `laolao-lazy.js?v=${secondLazyHash}`);

    const probeResponse = browserResponses.find((r) => r.url.endsWith(`/laolao-probe.js?v=${secondProbeHash}`));
    const lazyResponse = browserResponses.find((r) => r.url.endsWith(`/laolao-lazy.js?v=${secondLazyHash}`));
    assert.ok(probeResponse, `browser must request updated laolao-probe.js?v=${secondProbeHash}`);
    assert.equal(probeResponse.status, 200, 'modified head script must return HTTP 200');
    assert.ok(lazyResponse, `browser must request updated laolao-lazy.js?v=${secondLazyHash}`);
    assert.equal(lazyResponse.status, 200, 'modified lazy script must return HTTP 200');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test('M2-4: two branches modifying different injection files merge with zero conflict on laolao-head.fragment.html', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-m2-merge-tree-'));
  try {
    const runGit = (...args) => execFileSync('git', args, {cwd: tmp, encoding: 'utf8'}).trim();
    runGit('init', '-b', 'main');
    runGit('config', 'core.autocrlf', 'false');
    runGit('config', 'user.name', 'Pinkie Test');
    runGit('config', 'user.email', 'pinkie@example.com');

    for (const rel of [
      'ui/injections/laolao-head.fragment.html',
      'ui/injections/laolao-sidebar.js',
      'ui/injections/laolao-model-picker.js',
    ]) {
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), {recursive: true});
      fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    runGit('add', '.');
    runGit('commit', '-m', 'base with @hash head fragment');

    // Branch A modifies laolao-sidebar.js (no need to touch laolao-head.fragment.html!)
    runGit('checkout', '-b', 'branch-a');
    fs.appendFileSync(path.join(tmp, 'ui/injections/laolao-sidebar.js'), '\n// branch-a edit\n', 'utf8');
    runGit('commit', '-am', 'branch-a: edit laolao-sidebar.js');

    // Branch B modifies laolao-model-picker.js (no need to touch laolao-head.fragment.html!)
    runGit('checkout', 'main');
    runGit('checkout', '-b', 'branch-b');
    fs.appendFileSync(path.join(tmp, 'ui/injections/laolao-model-picker.js'), '\n// branch-b edit\n', 'utf8');
    runGit('commit', '-am', 'branch-b: edit laolao-model-picker.js');

    const treeOid = runGit('merge-tree', '--write-tree', 'branch-a', 'branch-b');
    assert.match(treeOid, /^[0-9a-f]{40}$/, `expected clean merge tree OID, got: ${treeOid}`);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});
