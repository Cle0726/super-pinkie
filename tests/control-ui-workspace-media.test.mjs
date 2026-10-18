import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { apply, isCurrentPreflight, transform } from '../patch/apply-control-ui-workspace-media.mjs';

const before = 'function zS(e,t){if(FS(e))return!0;let n=IS(e),r=n?[RS(n)]:[];return r.length===0?!1:t.some(e=>r.some(n=>n===e||n.startsWith(e+"/")))}';

test('Control UI allows ordinary home files but rejects local secrets through preflight', () => {
  const patched = transform(before);
  assert.match(patched, /pinkie-control-ui-workspace-media:v3/);
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
  assert.match(upgraded, /pinkie-control-ui-workspace-media:v3/);
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

// OpenClaw 2026.10 dropped the browser-side allowlist: the preflight asks the
// gateway for metadata and a media ticket, and only the gateway decides.
const current = 'function nC(e){let t=e.trim();return/^\\/(?:__openclaw__|media)\\//.test(t)?!1:/^file:/iu.test(t)||t.startsWith(`~`)}'
  + 'function UC(e,t){let n=`chat.attachments.unavailable`;setTimeout(()=>n,1e4);'
  + 'return fetch(`${e}&meta=1`).then(async r=>{if(r.status===429)throw Error(`assistant attachment metadata fetch timed out`);'
  + 'let v=await r.json();if(v?.available===!1)return `chat.attachments.outside-allowed-folders`;return v})}';

test('2026.10 preflight already sends every local path and is left untouched', () => {
  assert.equal(isCurrentPreflight(current), true);
  assert.equal(transform(current), current);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-kk-ui-media-current-'));
  try {
    const assets = path.join(root, 'dist', 'control-ui', 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, 'control-ui-boot-shared-test.js'), current);
    const result = apply(root, { backupRoot: path.join(root, 'backup') });
    assert.deepEqual(result, { changed: false, file: 'control-ui-boot-shared-test.js', upstream: true });
    assert.equal(fs.readFileSync(path.join(assets, 'control-ui-boot-shared-test.js'), 'utf8'), current);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown preflight shape is reported, not silently skipped', () => {
  assert.throws(() => transform('function somethingElse(){}'), /结构已变化/);
});
