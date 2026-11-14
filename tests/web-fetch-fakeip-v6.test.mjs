// tools-health-1113 A1: allowRfc2544BenchmarkRange also lets the IPv6 fake-IP
// range 2001:2::/48 through, and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {marker, transform} from '../patch/apply-web-fetch-fakeip-v6.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotFile = path.join(root, 'desktop/windows/mac-runtime/openclaw/dist/ssrf-BayeDjCv.js');

// A real OpenClaw dist to run the patched module against (its ip / ipaddr code
// decides what counts as private). Mac: the pristine sandbox or the app;
// Windows: the installed app's runtime. Never modified: the patched copy is
// written to a temp file whose relative imports point back at this dist.
function realDist() {
  const home = os.homedir();
  const candidates = [
    process.env.PINKIE_TEST_OPENCLAW_DIST,
    path.join(home, 'release-superpinkie/sandbox/openclaw-pristine/dist'),
    '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist',
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'Programs/SuperPinkie/_internal/runtime/node_modules/openclaw/dist'),
  ].filter(Boolean);
  return candidates.find((dir) => {
    try { return fs.readdirSync(dir).some((n) => /^ssrf-[^.]+\.m?js$/u.test(n)); } catch { return false; }
  });
}

async function loadPatched(dist, source) {
  const name = fs.readdirSync(dist).find((n) => /^ssrf-[^.]+\.m?js$/u.test(n)
    && fs.readFileSync(path.join(dist, n), 'utf8').includes('function isPrivateIpAddress('));
  const text = transform(source ?? fs.readFileSync(path.join(dist, name), 'utf8'))
    .replace(/from "\.\/([^"]+)"/gu, (_, rel) => `from "${pathToFileURL(path.join(dist, rel)).href}"`);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pk-ssrf-')), name.replace(/\.js$/u, '.mjs'));
  fs.writeFileSync(tmp, text);
  const mod = await import(pathToFileURL(tmp).href);
  // isPrivateIpAddress is exported under a one-letter alias.
  const alias = text.match(/isPrivateIpAddress as (\w+)/u)[1];
  return mod[alias];
}

test('transform inserts one guarded allowance and is idempotent', () => {
  const source = 'function isPrivateIpAddress(address, policy) {\n\tconst strictIp = parse(address);\n\tif (strictIp) {\n\t\tif (isIpv4Address(strictIp)) return isBlockedSpecialUseIpv4Address(strictIp, blockOptions);\n\t\tif (isBlockedSpecialUseIpv6Address(strictIp, ipv6BlockOptions)) return true;\n\t}\n}\n';
  const once = transform(source);
  assert.equal(once.split(marker).length, 2);
  assert.match(once, /allowRfc2544BenchmarkRange === true && Array\.isArray\(strictIp\.parts\)/u);
  assert.equal(transform(once), once);
  assert.throws(() => transform('function somethingElse() {}\n'), /isPrivateIpAddress/u);
});

test('the Windows package snapshot carries the same patch', () => {
  const text = fs.readFileSync(snapshotFile, 'utf8');
  assert.ok(text.includes(marker), 'desktop/windows/mac-runtime ssrf module is patched');
  assert.equal(transform(text), text);
  const sums = fs.readFileSync(path.join(root, 'desktop/windows/mac-runtime/SHA256SUMS'), 'utf8');
  const line = sums.split('\n').find((l) => l.endsWith('openclaw/dist/ssrf-BayeDjCv.js'));
  assert.equal(line.split('  ')[0], createHash('sha256').update(fs.readFileSync(snapshotFile)).digest('hex'));
});

const dist = realDist();
test('2001:2::/48 passes only with the switch on; every other private range stays blocked', {skip: !dist && 'no OpenClaw dist on this machine'}, async () => {
  const isPrivate = await loadPatched(dist);
  const on = {allowRfc2544BenchmarkRange: true};
  for (const ip of ['2001:2::e', '2001:2::a5', '2001:2:0:ffff::1', '198.18.0.16']) {
    assert.equal(isPrivate(ip, on), false, `${ip} allowed with the switch on`);
  }
  for (const ip of ['2001:2::e', '198.18.0.16']) assert.equal(isPrivate(ip, {}), true, `${ip} blocked with the switch off`);
  for (const ip of ['10.0.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', 'fd00::1', 'fc00::1', 'fe80::1', '::1',
    '2001:2:1::1', '2001:db8::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivate(ip, on), true, `${ip} still blocked with the switch on`);
  }
});

test('the patched snapshot module behaves the same', {skip: !dist && 'no OpenClaw dist on this machine'}, async () => {
  const isPrivate = await loadPatched(dist, fs.readFileSync(snapshotFile, 'utf8'));
  assert.equal(isPrivate('2001:2::e', {allowRfc2544BenchmarkRange: true}), false);
  assert.equal(isPrivate('fd00::1', {allowRfc2544BenchmarkRange: true}), true);
  assert.equal(isPrivate('192.168.1.1', {allowRfc2544BenchmarkRange: true}), true);
});
