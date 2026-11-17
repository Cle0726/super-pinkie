import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transformIp, transformSsrf} from '../patch/apply-fake-ip-benchmark-v6.mjs';

const RUNTIME = process.env.OPENCLAW_ROOT || '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw';
const dist = path.join(RUNTIME, 'dist');
const find = (re) => fs.existsSync(dist) && fs.readdirSync(dist).find(n => n.endsWith('.js') && re.test(fs.readFileSync(path.join(dist, n), 'utf8')));
const ipFile = find(/function isBlockedSpecialUseIpv6Address\(/);
const ssrfFile = find(/function resolveIpv6SpecialUseBlockOptions\(/);
const skip = !ipFile || !ssrfFile ? 'OpenClaw runtime not present' : false;

test('both transforms patch once and are idempotent', {skip}, () => {
  for (const [file, transform] of [[ipFile, transformIp], [ssrfFile, transformSsrf]]) {
    const source = fs.readFileSync(path.join(dist, file), 'utf8');
    const first = transform(source);
    assert.ok(['patched', 'already-patched'].includes(first.reason), `${file}: ${first.reason}`);
    assert.equal(transform(first.text).reason, 'already-patched');
  }
  assert.equal(transformIp('function other(){}').reason, 'unsupported-runtime');
  assert.equal(transformSsrf('function other(){}').reason, 'unsupported-runtime');
});

test('with the benchmark opt-in, Clash fake-IP answers pass and real internal addresses stay blocked', {skip}, async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-ip-v6-'));
  fs.cpSync(dist, path.join(copy, 'dist'), {recursive: true});
  for (const [file, transform] of [[ipFile, transformIp], [ssrfFile, transformSsrf]]) {
    const target = path.join(copy, 'dist', file);
    fs.writeFileSync(target, transform(fs.readFileSync(target, 'utf8')).text);
  }
  if (fs.existsSync(path.join(RUNTIME, 'node_modules'))) fs.symlinkSync(path.join(RUNTIME, 'node_modules'), path.join(copy, 'node_modules'));
  fs.writeFileSync(path.join(copy, 'package.json'), fs.readFileSync(path.join(RUNTIME, 'package.json')));
  const ssrf = await import(pathToFileURL(path.join(copy, 'dist', ssrfFile)).href);
  const resolve = Object.values(ssrf).find(fn => typeof fn === 'function' && fn.name === 'resolvePinnedHostnameWithPolicy');
  assert.ok(resolve, 'resolvePinnedHostnameWithPolicy export');
  const answer = (...addresses) => async () => addresses.map(address => ({address, family: address.includes(':') ? 6 : 4}));
  const on = {allowRfc2544BenchmarkRange: true};
  // The exact answer Clash Verge gave for zhuanlan.zhihu.com.
  const pinned = await resolve('zhuanlan.zhihu.com', {policy: on, lookupFn: answer('198.18.0.244', '2001:2::c4')});
  assert.deepEqual(pinned.addresses, ['198.18.0.244', '2001:2::c4']);
  await assert.rejects(resolve('zhuanlan.zhihu.com', {policy: {}, lookupFn: answer('198.18.0.244', '2001:2::c4')}), /special-use/);
  for (const internal of ['127.0.0.1', '10.0.0.5', '192.168.1.2', '169.254.169.254', '::1', 'fe80::1', 'fd00::1']) {
    await assert.rejects(resolve('evil.example', {policy: on, lookupFn: answer(internal)}), /special-use|private|Blocked/, internal);
  }
  fs.rmSync(copy, {recursive: true, force: true});
});
