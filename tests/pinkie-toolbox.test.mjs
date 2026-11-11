import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unpackZip, treeDigest} from '../tools/pinkie-toolbox/toolbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'personas/project/playbooks/toolbox.mjs');
const names = ['python', 'screenshot', 'video', 'node', 'office-view', 'pdf', 'docs-write', 'image', 'fonts-cjk', 'tts', 'git'];

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '碧琪 工具箱-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const bin = path.join(dir, 'bin');
  const isolatedHome = path.join(dir, 'home');
  fs.mkdirSync(bin); fs.mkdirSync(isolatedHome);
  return {dir, bin, isolatedHome, box: path.join(dir, 'box'), env: {
    ...process.env, PINKIE_TOOLBOX_HOME: isolatedHome,
    OPENCLAW_STATE_DIR: path.join(dir, 'state'), PINKIE_TOOLBOX_DIR: path.join(dir, 'box'),
    PINKIE_TOOLBOX_OFFLINE: '1', PINKIE_DOWNLOADS_LEDGER: path.join(dir, 'ledger.json'), PATH: bin,
  }};
}

function call(args, env, timeout = 15_000) {
  return spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', env, timeout});
}

test('list provides the eleven planned capabilities in machine-readable form', t => {
  const f = fixture(t);
  const result = call(['list'], f.env);
  assert.equal(result.status, 0, result.stderr);
  const items = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(items.map(item => item.capability).sort(), names.toSorted());
});

test('human output is optional and does not create an installation directory', t => {
  const f = fixture(t);
  const result = call(['list', '--human'], f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /screenshot/);
  assert.equal(fs.existsSync(f.box), false);
});

test('unknown capability is rejected without touching the installation directory', t => {
  const f = fixture(t);
  const result = call(['ensure', 'not-a-capability'], f.env);
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(f.box), false);
});

test('an unavailable office viewer never invokes system package managers', {skip: process.platform !== 'darwin'}, t => {
  const f = fixture(t);
  const marker = path.join(f.dir, 'brew-was-run');
  fs.writeFileSync(path.join(f.bin, 'brew'), `#!/bin/sh\n/usr/bin/touch '${marker}'\n`, {mode: 0o755});
  const result = call(['ensure', 'office-view'], f.env);
  assert.notEqual(result.status, null, result.error?.message);
  assert.equal(fs.existsSync(marker), false, 'must not invoke Homebrew');
  assert.notEqual(result.status, 0, 'an unavailable viewer must not be reported as ready');
});

test('node capability reports the interpreter that actually ran the tool', t => {
  const f = fixture(t);
  const result = call(['check', 'node'], f.env);
  assert.equal(result.status, 0, result.stderr);
  const item = JSON.parse(result.stdout.trim().split('\n')[0]);
  assert.equal(item.ok, true);
  assert.equal(item.path, process.execPath);
  assert.equal(fs.existsSync(f.box), false);
});

test('a low disk-space limit prevents installation before making the toolbox directory', t => {
  const f = fixture(t);
  const result = call(['ensure', 'image'], {...f.env, PINKIE_TOOLBOX_NO_SYSTEM: '1', PINKIE_TOOLBOX_MIN_FREE_BYTES: String(10 ** 16)});
  assert.equal(result.status, 1);
  assert.match(result.stdout, /空间不够/);
  assert.equal(fs.existsSync(f.box), false);
});

test('installing Python with uv disables global command links', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t);
  const marker = path.join(f.dir, 'uv-args');
  fs.writeFileSync(path.join(f.bin, 'uv'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nexit 1\n`, {mode: 0o755});
  const result = call(['ensure', 'python'], {...f.env, PINKIE_TOOLBOX_OFFLINE: '0', PINKIE_AGENT_PYTHON: ''});
  assert.equal(result.status, 1);
  assert.match(fs.readFileSync(marker, 'utf8'), /--no-bin/);
});

test('ensure records a verified tool without overwriting the user notes', t => {
  const f = fixture(t);
  const workspace = path.join(f.dir, 'workspace');
  fs.mkdirSync(workspace);
  const file = path.join(workspace, 'TOOLS.md');
  fs.writeFileSync(file, '我的自定义记录\n', {mode: 0o600});
  const env = {...f.env, PINKIE_TOOLBOX_WORKSPACE: workspace};
  for (let i = 0; i < 2; i++) assert.equal(call(['ensure', 'node'], env).status, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^我的自定义记录\n/);
  assert.equal((text.match(/<!-- pinkie-toolbox:start -->/g) || []).length, 1);
  assert.equal((text.match(/- node:/g) || []).length, 1);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('all four bundled workspaces use exactly the tested toolbox source', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'tools/pinkie-toolbox/sync.mjs'), '--check'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('installing an absent package never changes an existing agent environment', {timeout: 180_000}, t => {
  const base = process.env.PINKIE_TEST_PYTHON;
  if (!base || !fs.existsSync(base)) return t.skip('set PINKIE_TEST_PYTHON to an available Python 3.11+');
  const f = fixture(t);
  const external = path.join(f.dir, 'existing-env');
  const made = spawnSync(base, ['-m', 'venv', external], {encoding: 'utf8', timeout: 90_000});
  assert.equal(made.status, 0, made.stderr);
  const python = process.platform === 'win32' ? path.join(external, 'Scripts', 'python.exe') : path.join(external, 'bin', 'python');
  const before = spawnSync(python, ['-m', 'pip', 'list', '--format=freeze'], {encoding: 'utf8'}).stdout;
  const result = call(['ensure', 'image'], {...f.env, PINKIE_AGENT_PYTHON: python, PINKIE_TOOLBOX_NO_SYSTEM: '1'}, 90_000);
  assert.equal(result.status, 1, 'offline installation must fail honestly');
  assert.ok(fs.existsSync(process.platform === 'win32' ? path.join(f.box, 'venv', 'Scripts', 'python.exe') : path.join(f.box, 'venv', 'bin', 'python')));
  const after = spawnSync(python, ['-m', 'pip', 'list', '--format=freeze'], {encoding: 'utf8'}).stdout;
  assert.equal(after, before);
});

test('portable tool archives cannot write outside their target directory', t => {
  const python = process.env.PINKIE_TEST_PYTHON;
  if (!python || !fs.existsSync(python)) return t.skip('set PINKIE_TEST_PYTHON to an available Python 3.11+');
  const f = fixture(t);
  const archive = path.join(f.dir, 'malicious.zip');
  const destination = path.join(f.dir, 'extract');
  fs.mkdirSync(destination);
  const create = spawnSync(python, ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('../escape','oops'); z.close()", archive], {encoding: 'utf8'});
  assert.equal(create.status, 0, create.stderr);
  assert.equal(unpackZip(python, archive, destination).ok, false);
  assert.equal(fs.existsSync(path.join(f.dir, 'escape')), false);
});

test('a valid portable archive extracts into a directory with Chinese and spaces', t => {
  const python = process.env.PINKIE_TEST_PYTHON;
  if (!python || !fs.existsSync(python)) return t.skip('set PINKIE_TEST_PYTHON to an available Python 3.11+');
  const f = fixture(t);
  const archive = path.join(f.dir, 'portable.zip');
  const destination = path.join(f.dir, '工具 目录');
  fs.mkdirSync(destination);
  const create = spawnSync(python, ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('cmd/git.exe','test'); z.close()", archive], {encoding: 'utf8'});
  assert.equal(create.status, 0, create.stderr);
  assert.equal(unpackZip(python, archive, destination).ok, true);
  assert.equal(fs.readFileSync(path.join(destination, 'cmd', 'git.exe'), 'utf8'), 'test');
});

test('browser directory digest ignores install markers and catches any changed or added file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '碧琪 内核-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'chrome-headless-shell-mac-arm64'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'), 'binary');
  fs.writeFileSync(path.join(dir, 'chrome-headless-shell-mac-arm64', 'resources.pak'), 'pak');
  const skip = new Set(['INSTALLATION_COMPLETE', 'DEPENDENCIES_VALIDATED']);
  const before = treeDigest(dir, skip);
  assert.match(before, /^sha256-[A-Za-z0-9+/]+=*$/);
  fs.writeFileSync(path.join(dir, 'INSTALLATION_COMPLETE'), '');
  fs.writeFileSync(path.join(dir, 'DEPENDENCIES_VALIDATED'), '');
  assert.equal(treeDigest(dir, skip), before);
  fs.writeFileSync(path.join(dir, 'chrome-headless-shell-mac-arm64', 'resources.pak'), 'pak!');
  assert.notEqual(treeDigest(dir, skip), before);
  fs.writeFileSync(path.join(dir, 'chrome-headless-shell-mac-arm64', 'resources.pak'), 'pak');
  fs.writeFileSync(path.join(dir, 'extra.dylib'), 'x');
  assert.notEqual(treeDigest(dir, skip), before);
});

test('manifest pins uv per platform with a hash and the browser revision of the locked playwright', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/pinkie-toolbox/toolbox-manifest.json'), 'utf8'));
  for (const key of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64']) {
    const file = manifest.uv.files[key];
    assert.match(file.integrity, /^sha256-[A-Za-z0-9+/]{43}=$/, key);
    assert.ok(file.path.endsWith('.whl') && file.path.includes(`uv-${manifest.uv.version}-`), key);
  }
  assert.ok(manifest.uv.mirrors[0].includes('tuna') && manifest.uv.mirrors.at(-1).includes('pythonhosted'));
  assert.equal(manifest.browser.dir, `chromium_headless_shell-${manifest.browser.revision}`);
  const lock = fs.readFileSync(path.join(root, 'tools/pinkie-toolbox/requirements/screenshot.lock'), 'utf8');
  assert.ok(lock.includes(`playwright==${manifest.playwrightVersion}`));
  for (const digest of Object.values(manifest.browser.digests)) assert.match(digest, /^sha256-/);
});

test('without a verified browser digest for this machine the toolbox refuses to download one', t => {
  const {env} = fixture(t);
  const result = call(['ensure', 'screenshot'], {...env, PINKIE_TOOLBOX_NO_SYSTEM: '1'});
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /"ok":true/);
});
