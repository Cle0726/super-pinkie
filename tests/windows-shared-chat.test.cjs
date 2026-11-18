const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('Windows build verifies the shared renderer after installing the shared bundle', () => {
  const build = fs.readFileSync(path.join(__dirname, '../build-win.ps1'), 'utf8');
  const sharedInstall = build.indexOf('bundle.py install');
  const verify = build.indexOf('tools\\windows-package\\check_shared_chat.ps1');
  assert.ok(sharedInstall >= 0 && verify > sharedInstall);
  assert.doesNotMatch(build, /chat-page-\*\.js[\s\S]{0,120}Select-Object -First 1/);
});

test('Windows build checks the shared chat actually referenced by the entry, not an older upstream chunk',
  {skip: process.platform !== 'win32'}, () => {
    const parent = fs.realpathSync(os.tmpdir());
    const root = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'pinkie-shared-chat-')));
    assert.equal(path.dirname(root), parent);
    const source = path.join(root, 'source'), assets = path.join(root, 'assets');
    fs.mkdirSync(source); fs.mkdirSync(assets);
    const chat = '/* pinkie-chat-timeline:v31 */\n/* pinkie-thinking-segments:v1 */\n';
    fs.writeFileSync(path.join(source, 'chat-page-shared.js'), chat);
    fs.writeFileSync(path.join(source, 'index-entry.js'), 'import("./chat-page-shared.js")');
    fs.writeFileSync(path.join(assets, 'chat-page-old.js'), '// old upstream chunk');
    fs.writeFileSync(path.join(assets, 'chat-page-shared.js'), chat);
    fs.writeFileSync(path.join(assets, 'index-entry.js'), 'import("./chat-page-shared.js?v=updated")');
    const script = path.join(__dirname, '../tools/windows-package/check_shared_chat.ps1');
    const run = () => spawnSync('pwsh.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-SourceRuntime', source, '-PackagedAssets', assets], {encoding: 'utf8'});
    try {
      let result = run();
      assert.equal(result.status, 0, result.stderr || result.stdout);
      fs.writeFileSync(path.join(assets, 'chat-page-shared.js'), chat + '// changed');
      result = run(); assert.notEqual(result.status, 0, 'changed packaged renderer must fail');
      fs.writeFileSync(path.join(assets, 'chat-page-shared.js'), chat);
      fs.writeFileSync(path.join(assets, 'index-entry.js'), 'import("./chat-page-old.js")');
      result = run(); assert.notEqual(result.status, 0, 'entry referencing the old renderer must fail');
      fs.writeFileSync(path.join(assets, 'index-entry.js'), 'import("./chat-page-shared.js")');
      fs.writeFileSync(path.join(source, 'chat-page-second.js'), chat);
      result = run(); assert.notEqual(result.status, 0, 'ambiguous shared renderers must fail');
    } finally {
      const target = fs.realpathSync(root);
      if (target !== root || path.dirname(target) !== parent) throw new Error('Refusing to remove a changed test directory');
      fs.rmSync(target, {recursive: true, force: true});
    }
  });
