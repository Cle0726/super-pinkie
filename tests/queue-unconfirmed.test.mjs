import test from 'node:test';
import assert from 'node:assert/strict';
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
  for (const mode of ['main', 'project', 'thinking', 'learning']) {
    assert.equal(pinkieQueueUnconfirmed({ sessionKey: `agent:${mode}:qa`, sendState: 'unconfirmed' }), true);
    assert.equal(pinkieQueueUnconfirmed({ sessionKey: `agent:${mode}:qa`, sendState: 'failed' }), false);
    assert.equal(pinkieQueueUnconfirmed({ sessionKey: `agent:${mode}:qa` }), false);
  }
  assert.equal(pinkieQueueUnconfirmed({ sessionKey: 'agent:other:qa', sendState: 'unconfirmed' }), false);
  assert.equal(pinkieQueueUnconfirmed(null), false);
});

test('UI patch preserves status, exposes retry and blocks implicit draining; unknown bundles fail closed', () => {
  const result = transformWithStatus(fixture);
  assert.equal(result.changed, true);
  assert.match(result.text, /pinkie-queue-unconfirmed:v1/);
  assert.match(result.text, /pinkieQueueUnconfirmed\(e\)\?e.sendState:void 0/);
  assert.match(result.text, /pinkieQueueUnconfirmed\(t\)\?o.sendState=t.sendState/);
  assert.match(result.text, /pinkieQueueUnconfirmed\(t\)&&!t.pendingRunId/);
  assert.match(result.text, /!pinkieQueueUnconfirmed\(t\)&&\(t.sessionKey/);
  assert.equal(transformWithStatus(result.text).reason, 'already-patched');
  assert.equal(transformWithStatus('different UI').reason, 'unsupported-ui');
  assert.equal(transformWithStatus(fixture + '\n' + fixture).reason, 'unsupported-ui');
});
