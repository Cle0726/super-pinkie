const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// 2026-10-04 incident: the live 1467 proxy once ran with
// UR_PROXY_FIRST_BYTE_TIMEOUT=8 + UR_PROXY_RETRY_BUDGET=20. Large-context
// requests need 15-25s for the first byte, so every one of the 64 attempts
// was cut at 8s and big sessions got a deterministic fake 503 while small
// requests looked perfectly healthy. These pins keep the wall from
// returning via reinstall or script default drift.
test('retry proxy template pins generous first-byte timeout and budget', () => {
  const plist = read('launchd/openclaw-proxy/com.openclaw.mm-retry-proxy.plist');
  const firstByte = Number(plist.match(/UR_PROXY_FIRST_BYTE_TIMEOUT<\/key>\s*<string>(\d+)<\/string>/)?.[1]);
  const budget = Number(plist.match(/UR_PROXY_RETRY_BUDGET<\/key>\s*<string>(\d+)<\/string>/)?.[1]);
  assert.ok(firstByte >= 45, `first-byte timeout ${firstByte}s is below the 45s large-request floor`);
  assert.ok(budget >= firstByte * 2, `retry budget ${budget}s must fit at least two full attempts`);
});

test('retry proxy script defaults also clear the large-request floor', () => {
  const script = read('proxy/mm-retry-proxy.py');
  const firstByte = Number(script.match(/UR_PROXY_FIRST_BYTE_TIMEOUT", "(\d+)"/)?.[1]);
  const budget = Number(script.match(/UR_PROXY_RETRY_BUDGET", "(\d+)"/)?.[1]);
  assert.ok(firstByte >= 30, `script default first-byte ${firstByte}s too small`);
  assert.ok(budget >= firstByte, `script default budget ${budget}s smaller than one attempt`);
});
