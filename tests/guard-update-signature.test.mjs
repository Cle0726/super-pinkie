// 设定防护 A6：latest.json 发布签名 + 安装包哈希签名（CI sign-latest，更新器 verify-latest）。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {signLatest, verifyLatest} from '../installer/guard/guard.mjs';

const GUARD = fileURLToPath(new URL('../installer/guard/guard.mjs', import.meta.url));
const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
const keyPem = privateKey.export({type: 'pkcs8', format: 'pem'});
const pub = publicKey.export({type: 'spki', format: 'der'}).toString('base64');
const commit = 'b'.repeat(40);
const latest = () => ({version: '9.9.9', notes: 'n', commit, assets: {
  'super-pinkie-windows-9.9.9-portable.zip': {sha256: '1'.repeat(64), size: 10},
  'super-pinkie-macos-9.9.9.zip': {sha256: '2'.repeat(64), size: 20},
}});

test('signed latest.json verifies for the covered package and commit only', () => {
  const signed = signLatest(latest(), keyPem);
  const ok = verifyLatest(signed, {asset: 'super-pinkie-windows-9.9.9-portable.zip', sha256: '1'.repeat(64), commit, key: pub});
  assert.equal(ok.ok, true);
  assert.equal(verifyLatest(signed, {asset: 'super-pinkie-windows-9.9.9-portable.zip', sha256: '3'.repeat(64), key: pub}).ok, false);
  assert.equal(verifyLatest(signed, {commit: 'c'.repeat(40), key: pub}).ok, false);
  // 改任何一处都不过：版本号、某个包的哈希、提交
  assert.equal(verifyLatest({...signed, version: '9.9.10'}, {key: pub}).ok, false);
  const swapped = structuredClone(signed); swapped.assets['super-pinkie-windows-9.9.9-portable.zip'].sha256 = '3'.repeat(64);
  assert.equal(verifyLatest(swapped, {asset: 'super-pinkie-windows-9.9.9-portable.zip', sha256: '3'.repeat(64), key: pub}).ok, false);
  assert.equal(verifyLatest({...signed, commit: 'c'.repeat(40)}, {key: pub}).ok, false);
  // 没签名 / 别的私钥签的 / 官方公钥验测试签名
  assert.equal(verifyLatest(latest(), {key: pub}).ok, false);
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'pem'});
  assert.equal(verifyLatest(signLatest(latest(), other), {key: pub}).ok, false);
  assert.equal(verifyLatest(signed).ok, false);
});

test('sign-latest refuses a manifest without a commit', () => {
  const bare = latest(); delete bare.commit;
  assert.throws(() => signLatest(bare, keyPem), /commit/);
});

test('CLI sign-latest / verify-latest exit codes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-latest-'));
  const file = path.join(dir, 'latest.json'), key = path.join(dir, 'key.pem');
  fs.writeFileSync(file, JSON.stringify(latest())); fs.writeFileSync(key, keyPem);
  assert.equal(spawnSync(process.execPath, [GUARD, 'sign-latest', file, key]).status, 0);
  const run = (...extra) => spawnSync(process.execPath, [GUARD, 'verify-latest', file, '--public-key', pub, ...extra]).status;
  assert.equal(run('--asset', 'super-pinkie-macos-9.9.9.zip', '--sha256', '2'.repeat(64)), 0);
  assert.equal(run('--asset', 'super-pinkie-macos-9.9.9.zip', '--sha256', '1'.repeat(64)), 1);
  const tampered = JSON.parse(fs.readFileSync(file, 'utf8')); tampered.assets['super-pinkie-macos-9.9.9.zip'].sha256 = '9'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(tampered));
  assert.equal(run('--asset', 'super-pinkie-macos-9.9.9.zip', '--sha256', '9'.repeat(64)), 1);
  assert.equal(spawnSync(process.execPath, [GUARD, 'verify-latest', path.join(dir, 'missing.json')]).status, 1);
});
