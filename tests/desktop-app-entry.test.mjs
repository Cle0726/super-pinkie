import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// macOS 26 LaunchServices refuses a .app whose CFBundleExecutable is a shell script (-10669), and deleting a
// .app leaves its LaunchServices record behind. Both are checked against the real AppWindow.swift here.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'desktop/macos/pinkie/Sources/AppWindow.swift');
const driverSource = path.join(repo, 'tests/desktop-app-entry-driver.swift');
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const id = 'w0123456789abcde';
const MACHO = new Set(['feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca']);

// Foundation hands back /tmp/... while the same directory is /private/tmp/... on disk; a deleted .app can no
// longer be realpath'd, so both spellings are tried.
function spellings(p) {
  const bare = p.replace(/^\/private(?=\/(tmp|var)\/)/, '');
  return [bare, /^\/(tmp|var)\//.test(bare) ? `/private${bare}` : bare];
}

function samePath(actual, expected) {
  return spellings(actual).some(a => spellings(expected).includes(a));
}

function registered(bundlePath) {
  const dump = execFileSync(lsregister, ['-dump'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const wanted = spellings(bundlePath);
  return dump.split('\n').some(line => /^path:\s/.test(line) && wanted.some(p => line.includes(p)));
}

test('desktop work .app starts through LaunchServices and leaves no stale record', {
  skip: process.platform !== 'darwin',
  timeout: 240_000,
}, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-app-entry-')));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  const appDir = path.join(state, 'apps', id);
  fs.mkdirSync(path.join(home, 'Applications'), { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'index.html'), '<!doctype html><title>t</title><p>拼词</p>');
  const writeIndex = name => fs.writeFileSync(path.join(state, 'apps', 'index.json'), JSON.stringify({ apps: { [id]: { name } } }));
  const env = { ...process.env, HOME: home, CFFIXED_USER_HOME: home, PINKIE_STATE_ROOT: state };
  const made = [];
  try {
    const driver = path.join(root, 'driver');
    execFileSync('xcrun', ['swiftc', '-parse-as-library', '-Onone', source, driverSource,
      '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'CoreServices', '-o', driver], { stdio: 'pipe' });
    const native = (...args) => JSON.parse(execFileSync(driver, args, { env, encoding: 'utf8' }).trim());

    writeIndex('入口测试');
    const first = native('install', id);
    assert.equal(first.ok, true, JSON.stringify(first));
    made.push(first.path);
    const run = path.join(first.path, 'Contents/MacOS/run');
    const magic = fs.readFileSync(run).subarray(0, 4).toString('hex');
    assert.ok(MACHO.has(magic), `entry must be Mach-O, got ${JSON.stringify(fs.readFileSync(run).subarray(0, 12).toString())}`);
    assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--strict', first.path]).status, 0, 'copied entry must carry a valid signature');

    // No arguments, as Finder / Dock start it: the copied Launcher must find its work through PinkieAppId.
    const launched = spawnSync(run, [], { env, encoding: 'utf8' });
    assert.equal(launched.status, 0, launched.stderr);
    const marker = path.join(state, `launched-${id}.txt`);
    const markerPath = () => fs.readFileSync(marker, 'utf8').trim();
    assert.ok(samePath(markerPath(), first.path), `direct start found ${markerPath()}, want ${first.path}`);
    assert.ok(registered(first.path), 'install registers the .app with LaunchServices');

    // The same way Finder double-click goes: a shell-script entry fails here with -10669.
    fs.rmSync(marker);
    const opened = spawnSync('/usr/bin/open', ['-n', '--env', `PINKIE_STATE_ROOT=${state}`, first.path], { env, encoding: 'utf8' });
    assert.equal(opened.status, 0, `open -n failed: ${opened.stderr}`);
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) spawnSync('/bin/sleep', ['0.1']);
    assert.ok(fs.existsSync(marker), 'LaunchServices-started entry must find its work');
    assert.ok(samePath(markerPath(), first.path), `LaunchServices start found ${markerPath()}, want ${first.path}`);

    writeIndex('入口测试改名');
    const second = native('install', id);
    assert.equal(second.ok, true, JSON.stringify(second));
    made.push(second.path);
    assert.equal(fs.existsSync(first.path), false);
    assert.equal(registered(first.path), false, 'renaming must unregister the old .app');

    assert.equal(native('uninstall', id).ok, true);
    assert.equal(fs.existsSync(second.path), false);
    assert.equal(registered(second.path), false, 'uninstall must unregister the .app');
  } finally {
    for (const bundle of made) spawnSync(lsregister, ['-u', bundle]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
