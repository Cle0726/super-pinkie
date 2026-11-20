import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import { pinkieQueueUnconfirmed, transformWithStatus } from '../patch/apply-queue-unconfirmed.mjs';

const fixture = [
  'function Ku(e){',
  'if(!t||!n.trim()&&!e.attachments?.length||e.pendingRunId||e.sendState===`sending`)return null',
  'let i=e.sendState===`failed`||e.sendState===`waiting-reconnect`||e.sendState===`waiting-model`?e.sendState:void 0',
  '...e.kind===`queued`||e.kind===`steered`?{kind:e.kind}:{},...r.length?{attachments:r}:{}',
  't.sendState===`failed`||t.sendState===`waiting-reconnect`?o.sendState=t.sendState',
  'case`failed`:return`Failed`;default:return null}}function Xv',
  '${t.sendState===`failed`&&e.onQueueRetry?',
  't.sendState!==`sending`&&t.sendState!==`waiting-model`&&t.sendState!==`failed`&&(t.sessionKey==null||t.sessionKey===e.sessionKey)',
].join('\n');

test('unconfirmed delivery is scoped to included sessions and distinct from ordinary queue states', () => {
  for (const mode of ['main', 'project', 'thinking', 'learning', 'unrestricted']) {
    assert.equal(pinkieQueueUnconfirmed({ sessionKey: `agent:${mode}:qa`, sendState: 'unconfirmed' }), true);
    assert.equal(pinkieQueueUnconfirmed({ sessionKey: `agent:${mode}:qa`, sendState: 'failed' }), false);
    assert.equal(pinkieQueueUnconfirmed({ sessionKey: `agent:${mode}:qa` }), false);
  }
  assert.equal(pinkieQueueUnconfirmed({ sessionKey: 'agent:other:qa', sendState: 'unconfirmed' }), false);
  assert.equal(pinkieQueueUnconfirmed({ sessionKey: 'agent:metre:qa', sendState: 'unconfirmed' }), false);
  assert.equal(pinkieQueueUnconfirmed(null), false);
});

test('UI patch preserves status, exposes retry and blocks implicit draining; unknown bundles fail closed', () => {
  const result = transformWithStatus(fixture);
  assert.equal(result.changed, true);
  assert.match(result.text, /pinkie-queue-unconfirmed:v2/);
  assert.match(result.text, /pinkieQueueUnconfirmed\(e\)\?e.sendState:void 0/);
  assert.match(result.text, /pinkieQueueUnconfirmed\(t\)\?o.sendState=t.sendState/);
  assert.match(result.text, /pinkieQueueUnconfirmed\(t\)&&!t.pendingRunId/);
  assert.match(result.text, /!pinkieQueueUnconfirmed\(t\)&&\(t.sessionKey/);
  assert.equal(transformWithStatus(result.text).reason, 'already-patched');
  assert.equal(transformWithStatus('different UI').reason, 'unsupported-ui');
  assert.equal(transformWithStatus(fixture + '\n' + fixture).reason, 'unsupported-ui');
});

test('already bundled v1 can be upgraded in place without duplicating the native hook', () => {
  const patched = transformWithStatus(fixture).text;
  const legacy = patched.replace('pinkie-queue-unconfirmed:v2', 'pinkie-queue-unconfirmed:v1')
    .replace('|learning|unrestricted)', '|learning)');
  const upgrade = transformWithStatus(legacy);
  assert.equal(upgrade.changed, true);
  assert.equal(upgrade.text, patched);
  assert.equal(transformWithStatus(upgrade.text).reason, 'already-patched');
});

test('native entry loads the versioned queued-message bundle after an upgrade', () => {
  const runtime = new URL('../ui/runtime/', import.meta.url);
  const file = 'chat-page-DrPkxqJK.js';
  const body = readFileSync(new URL(file,runtime));
  const digest = createHash('sha256').update(body).digest('hex').slice(0,12);
  const entry = readFileSync(new URL('index-Bvtt7vVx.js',runtime),'utf8');
  const imports = [...entry.matchAll(/\.\/chat-page-DrPkxqJK\.js\?v=clekk-history59&h=([a-f0-9]+)/g)];
  assert.ok(imports.length > 0);
  assert.ok(imports.every(([, hash]) => hash === digest));
  assert.equal(transformWithStatus(body.toString('utf8')).reason, 'already-patched');
});
