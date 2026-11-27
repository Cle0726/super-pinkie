import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A work's .app runs a copy of the Launcher made at install time. After Super Pinkie updates, the copy must follow:
// refreshInstalled() swaps in the current Launcher and re-signs, only inside .app bundles we made for the id the
// ledger names. Two builds of the driver stand in for the old and the upgraded Launcher.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'desktop/macos/pinkie/Sources/AppWindow.swift');
const driverSource = path.join(repo, 'tests/desktop-app-entry-driver.swift');
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const id = 'w0123456789abcde';
const strangerId = 'wfedcba987654321';
const otherId = 'w00000000000000f';

function spellings(p) {
  const bare = p.replace(/^\/private(?=\/(tmp|var)\/)/, '');
  return [bare, /^\/(tmp|var)\//.test(bare) ? `/private${bare}` : bare];
}

function registered(bundlePath) {
  const dump = execFileSync(lsregister, ['-dump'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const wanted = spellings(bundlePath);
  return dump.split('\n').some(line => /^path:\s/.test(line) && wanted.some(p => line.includes(p)));
}

function build(appWindowSource, out, defines = []) {
  execFileSync('xcrun', ['swiftc', '-parse-as-library', '-Onone', ...defines, appWindowSource, driverSource,
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'CoreServices', '-o', out], { stdio: 'pipe' });
}

function snapshot(dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, entry);
    if (fs.statSync(file).isFile()) out[entry] = fs.readFileSync(file).toString('base64');
  }
  return out;
}

// Installs a work with the v1 driver, then lets `upgraded` run refresh as Super Pinkie does at start.
function scenario(root, upgraded) {
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  const apps = path.join(home, 'Applications');
  fs.mkdirSync(apps, { recursive: true });
  for (const each of [id, strangerId, otherId]) {
    fs.mkdirSync(path.join(state, 'apps', each), { recursive: true });
    fs.writeFileSync(path.join(state, 'apps', each, 'index.html'), '<!doctype html><title>t</title>');
  }
  fs.writeFileSync(path.join(state, 'apps', 'index.json'), JSON.stringify({ apps: { [id]: { name: '升级测试' } } }));
  const env = { ...process.env, HOME: home, CFFIXED_USER_HOME: home, PINKIE_STATE_ROOT: state };
  const made = [];
  try {
    const installed = JSON.parse(execFileSync(path.join(root, '..', 'v1'), ['install', id], { env, encoding: 'utf8' }).trim());
    assert.equal(installed.ok, true, JSON.stringify(installed));
    made.push(installed.path);
    const run = path.join(installed.path, 'Contents/MacOS/run');
    const plist = path.join(installed.path, 'Contents/Info.plist');
    const version = () => execFileSync(run, ['version'], { env, encoding: 'utf8' }).trim();
    assert.equal(version(), 'v1');

    // Ledger entries we must not touch: someone else's .app (no PinkieAppId), and our marker naming another work.
    const stranger = path.join(apps, '别人的应用.app');
    fs.mkdirSync(path.join(stranger, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(stranger, 'Contents', 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.stranger</string></dict></plist>\n');
    fs.writeFileSync(path.join(stranger, 'Contents', 'MacOS', 'run'), 'not ours');
    const other = path.join(apps, '别的作品.app');
    fs.mkdirSync(path.join(other, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(other, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>PinkieAppId</key><string>${id}</string></dict></plist>\n`);
    fs.writeFileSync(path.join(other, 'Contents', 'MacOS', 'run'), 'old');
    const ledger = path.join(state, 'apps', 'shortcuts-mac.json');
    const book = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    fs.writeFileSync(ledger, JSON.stringify({ ...book, [strangerId]: stranger, [otherId]: other }));
    const untouched = { stranger: snapshot(stranger), other: snapshot(other) };
    const plistBefore = fs.readFileSync(plist, 'utf8');
    const iconBefore = fs.existsSync(path.join(installed.path, 'Contents/Resources/icon.icns'));

    const refresh = () => JSON.parse(execFileSync(upgraded, ['refresh'], { env, encoding: 'utf8' }).trim());
    const first = refresh();
    const after = {
      first,
      version: version(),
      signed: spawnSync('/usr/bin/codesign', ['--verify', '--strict', installed.path]).status === 0,
      appId: /<key>PinkieAppId<\/key>\s*<string>w0123456789abcde<\/string>/.test(fs.readFileSync(plist, 'utf8')),
      bundleId: fs.readFileSync(plist, 'utf8').includes(`com.cle0726.super-pinkie.app.${id}`),
      icon: fs.existsSync(path.join(installed.path, 'Contents/Resources/icon.icns')) === iconBefore,
      plistChanged: fs.readFileSync(plist, 'utf8') !== plistBefore,
      strangerKept: JSON.stringify(snapshot(stranger)) === JSON.stringify(untouched.stranger),
      otherKept: JSON.stringify(snapshot(other)) === JSON.stringify(untouched.other),
    };
    const mtime = fs.statSync(run).mtimeMs;
    after.second = refresh()[id];
    after.secondKeptRun = fs.statSync(run).mtimeMs === mtime;
    return after;
  } finally {
    for (const bundle of made) spawnSync(lsregister, ['-u', bundle]);
    for (const bundle of made) assert.equal(registered(bundle), false, `LaunchServices record left behind for ${bundle}`);
  }
}

test('installed work .app follows the upgraded Launcher, only ours, and keeps its signature', {
  skip: process.platform !== 'darwin',
  timeout: 360_000,
}, () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-app-refresh-')));
  try {
    build(source, path.join(top, 'v1'));
    build(source, path.join(top, 'v2'), ['-D', 'PINKIE_DRIVER_V2']);

    const real = path.join(top, 'real');
    fs.mkdirSync(real);
    const got = scenario(real, path.join(top, 'v2'));
    assert.deepEqual(got.first, { [id]: 'updated', [strangerId]: 'skipped', [otherId]: 'skipped' });
    assert.equal(got.version, 'v2', 'the installed work must run the upgraded Launcher');
    assert.equal(got.signed, true, 'the refreshed .app must carry a valid signature');
    assert.equal(got.appId && got.bundleId && got.icon, true, 'refresh must keep the work id, bundle id and icon');
    assert.equal(got.plistChanged, true, 'the Launcher hash in Info.plist must follow the new Launcher');
    assert.equal(got.strangerKept, true, "someone else's .app named in the ledger must not change by a byte");
    assert.equal(got.otherKept, true, 'an .app marked for another work must not change by a byte');
    assert.equal(got.second, 'current', 'a second start with the same Launcher must do nothing');
    assert.equal(got.secondKeptRun, true, 'an up-to-date Launcher must not be rewritten');

    // Counter-example: with the refresh logic taken out, the old Launcher stays and the check above goes red.
    const mutantSource = path.join(top, 'AppWindow.swift');
    const text = fs.readFileSync(source, 'utf8');
    const head = 'static func refreshInstalled(from launcher: URL? = Bundle.main.executableURL) -> [String: String] {';
    assert.ok(text.includes(head), 'refreshInstalled signature moved; update the counter-example');
    fs.writeFileSync(mutantSource, text.replace(head, `${head}\n        if true { return [:] }`));
    build(mutantSource, path.join(top, 'v2-mutant'), ['-D', 'PINKIE_DRIVER_V2']);
    const mutant = path.join(top, 'mutant');
    fs.mkdirSync(mutant);
    assert.equal(scenario(mutant, path.join(top, 'v2-mutant')).version, 'v1', 'without refresh the old Launcher must remain');
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
});
