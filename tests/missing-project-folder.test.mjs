// 学习/项目会话绑定的文件夹在一块已经拔掉的盘上（Windows 上 11-06 实测：
// D:\Windows_大数据实训全套 不在了）。以前每次 pinkie.workbench.context 都报
// ENOENT mkdir，发消息前的 pinkie.project.bind 报「目录无法解析」，学习模式整段卡住。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const copies = {
  repo: 'services',
  windowsSnapshot: 'desktop/windows/mac-runtime/services',
};

function home(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-missing-folder-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

// A folder whose whole mount is gone. On Windows an unused drive letter
// reproduces an unplugged USB stick exactly. On POSIX there is always a `/`,
// so a path can never fail by "root is missing"; pick a segment whose parent
// chain is genuinely absent instead, and let the test assert the platform's
// real contract (Windows: MISSING_FOLDER; POSIX: a plain not-found error).
function goneFolder() {
  if (process.platform === 'win32') {
    for (const letter of 'QRSTUVWXYZ') if (!fs.existsSync(letter + ':\\')) return letter + ':\\实训资料';
  }
  return path.join(path.parse(os.tmpdir()).root, 'pinkie-unmounted-' + process.pid, '实训资料');
}

// Windows can name the real cause (the drive is gone). Elsewhere the path is
// merely absent, and validateRoot surfaces the filesystem's own ENOENT.
const missingRootCode = (missingFolderCode) => process.platform === 'win32'
  ? error => error.code === missingFolderCode && /项目文件夹不在了/.test(error.message) && /U 盘/.test(error.message)
  : error => error.code === 'ENOENT';

function writeBinding(stateRoot, key, folder) {
  fs.mkdirSync(path.join(stateRoot, 'project-scope'), {recursive: true});
  fs.writeFileSync(path.join(stateRoot, 'project-scope', 'bindings.json'),
    JSON.stringify({[key]: {root: folder, name: '实训资料', created: 1}}));
}

for (const [label, base] of Object.entries(copies)) {
  test(`${label}: a session bound to a missing folder runs unanchored instead of failing every tool call`, async t => {
    const dir = home(t);
    const {ProjectScope, MISSING_FOLDER} = await import(pathToFileURL(path.join(root, base, 'project-scope/index.mjs')).href);
    const stateRoot = path.join(dir, 'state');
    const key = 'agent:learning:dashboard:one';
    writeBinding(stateRoot, key, goneFolder());
    const guard = new ProjectScope({home: dir, stateRoot: path.join(stateRoot, 'project-scope')});
    assert.equal(guard.binding({sessionKey: key}), null);
    assert.equal(guard.before({toolName: 'read', params: {path: 'a.txt'}}, {sessionKey: key}), undefined);
    assert.equal(guard.prompt({sessionKey: key}), undefined);
    // Choosing the gone folder again names the real cause. On Windows that is
    // the MISSING_FOLDER code the UI tests; on POSIX the path is simply absent.
    assert.throws(() => guard.validateRoot(goneFolder()), missingRootCode(MISSING_FOLDER));
  });

  test(`${label}: the workbench falls back to the mode workspace instead of mkdir on a missing drive`, async t => {
    const dir = home(t);
    const staged = path.join(dir, 'plugin');
    fs.mkdirSync(staged);
    for (const name of fs.readdirSync(path.join(root, base, 'mode-architecture'))) {
      if (name.endsWith('.mjs')) fs.copyFileSync(path.join(root, base, 'mode-architecture', name), path.join(staged, name));
    }
    // The Windows snapshot overlays only some modules; the rest come from services/.
    for (const name of ['workbench-ext.mjs', 'openclaw-paths.mjs']) {
      if (!fs.existsSync(path.join(staged, name))) fs.copyFileSync(path.join(root, 'services/mode-architecture', name), path.join(staged, name));
    }
    const {Workbench} = await import(pathToFileURL(path.join(staged, 'workbench.mjs')).href);
    const stateRoot = path.join(dir, 'state');
    const workspace = path.join(dir, 'workspace-learning');
    const key = 'agent:learning:dashboard:one';
    const folder = goneFolder();
    writeBinding(stateRoot, key, folder);
    const bench = new Workbench({home: dir, stateRoot, config: () => ({agents: {list: [{id: 'learning', workspace}]}})});
    const scope = bench.scope({sessionKey: key});
    assert.equal(scope.root, fs.realpathSync(workspace));
    assert.equal(scope.bound, false);
    assert.equal(scope.unavailableRoot, folder);
    assert.equal(fs.existsSync(folder), false);
    const status = await bench.status({sessionKey: key});
    assert.equal(status.unavailableRoot, folder);
    assert.equal(status.projectRoot, null);
  });
}

test('sending from a learning session is not blocked by a project folder on an unplugged drive', () => {
  const sidebar = fs.readFileSync(path.join(root, 'ui/injections/laolao-sidebar.js'), 'utf8');
  const start = sidebar.indexOf('async function ensureProjectScope');
  const body = sidebar.slice(start, sidebar.indexOf('function showScope', start));
  assert.match(body, /mode==='project'\|\|!\/项目文件夹不在了\|目录无法解析\/\.test/);
  assert.match(body, /showScope\(key,null,error\.message\);return null;/);
});
