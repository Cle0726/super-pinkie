import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { apply, transform } from '../patch/apply-control-ui-workspace-media.mjs';

const before = 'function zS(e,t){if(FS(e))return!0;let n=IS(e),r=n?[RS(n)]:[];return r.length===0?!1:t.some(e=>r.some(n=>n===e||n.startsWith(e+"/")))}';

test('Control UI allows ordinary home files but rejects local secrets through preflight', () => {
  const patched = transform(before);
  assert.match(patched, /pinkie-control-ui-workspace-media:v2/);
  assert.match(patched, /laolaoHomeMediaPathAllowed/);
  assert.match(patched, /\.openclaw/);
  assert.match(patched, /\.ssh/);
  assert.match(patched, /keychains/);
  assert.equal(transform(patched), patched);

  const context = {};
  const runtime = transform('function FS(){return!1}function IS(e){return e}function RS(e){return e}' + before + ';globalThis.check=zS');
  vm.runInNewContext(runtime, context);
  assert.equal(context.check('/Users/Admin/.openclaw/workspace-project/runs/shot.png', []), true);
  assert.equal(context.check('/Users/Admin/项目视频剪辑管理/133.mp4', []), true);
  assert.equal(context.check('C:/Users/Admin/Projects/demo/answer.txt', []), true);
  assert.equal(context.check('/Users/Admin/.openclaw/config/credentials.json', []), false);
  assert.equal(context.check('/Users/Admin/.openclaw/openclaw.json', []), false);
  assert.equal(context.check('/Users/Admin/.ssh/id_ed25519', []), false);
  assert.equal(context.check('/Users/Admin/Library/Keychains/login.keychain-db', []), false);
  assert.equal(context.check('/etc/passwd', []), false);
});

test('Control UI workspace-media patch upgrades an installed v1 preflight', () => {
  const v1 = '/* pinkie-control-ui-workspace-media:v1 */function laolaoWorkspaceMediaPathAllowed(e){let t=IS(e);if(!t)return!1;t=RS(t);return/^(?:\\/Users\\/[^/]+|\\/home\\/[^/]+|[a-z]:\\/Users\\/[^/]+)\\/.openclaw\\/workspace(?:-[a-z0-9][a-z0-9._-]*)?(?:\\/|$)/i.test(t)}function zS(e,t){if(FS(e)||laolaoWorkspaceMediaPathAllowed(e))return!0;';
  const upgraded = transform(v1);
  assert.match(upgraded, /pinkie-control-ui-workspace-media:v2/);
  assert.match(upgraded, /laolaoHomeMediaPathAllowed/);
  assert.equal(transform(upgraded), upgraded);
});

test('Control UI patch updates the one lazy chat bundle atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-kk-ui-media-'));
  try {
    const assets = path.join(root, 'dist', 'control-ui', 'assets');
    fs.mkdirSync(assets, { recursive: true });
    const file = path.join(assets, 'chat-page-test.js');
    fs.writeFileSync(file, before);
    const backup = path.join(root, 'backup');
    assert.equal(apply(root, { backupRoot: backup }).changed, true);
    assert.equal(fs.readFileSync(path.join(backup, 'chat-page-test.js'), 'utf8'), before);
    assert.equal(apply(root, { backupRoot: backup }).changed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
