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
//
// 2026-11-26: 60s / 180s still cut hy4flash-free long-context replies, whose
// first byte takes 76-90s, so every attempt died at 60s and the budget ran out
// on retries (503). A Feishu reply is capped at 300s, which caps the budget:
// past that nobody is waiting. Two full slow attempts would need 360s, so the
// rule is one full attempt plus 120s for a retry, not twice the first byte.
const HY4_FIRST_BYTE = 90;
const FEISHU_REPLY_CAP = 300;
const RETRY_HEADROOM = 120;

function assertSlowModelTimeouts(where, firstByte, budget) {
  assert.ok(firstByte > HY4_FIRST_BYTE, `${where}: first-byte timeout ${firstByte}s cuts a ${HY4_FIRST_BYTE}s hy4 first byte`);
  assert.ok(budget >= firstByte + RETRY_HEADROOM, `${where}: retry budget ${budget}s leaves no room to retry after a ${firstByte}s attempt`);
  assert.ok(budget <= FEISHU_REPLY_CAP, `${where}: retry budget ${budget}s outlives the ${FEISHU_REPLY_CAP}s Feishu reply cap`);
}

test('retry proxy template pins timeouts that let a slow model answer', () => {
  const plist = read('launchd/openclaw-proxy/com.openclaw.mm-retry-proxy.plist');
  const firstByte = Number(plist.match(/UR_PROXY_FIRST_BYTE_TIMEOUT<\/key>\s*<string>(\d+)<\/string>/)?.[1]);
  const budget = Number(plist.match(/UR_PROXY_RETRY_BUDGET<\/key>\s*<string>(\d+)<\/string>/)?.[1]);
  assertSlowModelTimeouts('launchd plist', firstByte, budget);
});

// Windows starts the same script without launchd, so the app has to pass the
// values itself; left alone it would fall back to the script's 35s / 75s.
test('Windows relay launch passes the same timeouts as the launchd plist', () => {
  const app = read('app/super_pinkie.py');
  const line = app.match(/^RELAY_TIMEOUTS = \{[^\n]*\}$/m)?.[0] ?? '';
  const firstByte = Number(line.match(/"UR_PROXY_FIRST_BYTE_TIMEOUT": "(\d+)"/)?.[1]);
  const budget = Number(line.match(/"UR_PROXY_RETRY_BUDGET": "(\d+)"/)?.[1]);
  assertSlowModelTimeouts('app/super_pinkie.py RELAY_TIMEOUTS', firstByte, budget);
  const plist = read('launchd/openclaw-proxy/com.openclaw.mm-retry-proxy.plist');
  assert.equal(String(firstByte), plist.match(/UR_PROXY_FIRST_BYTE_TIMEOUT<\/key>\s*<string>(\d+)<\/string>/)?.[1]);
  assert.equal(String(budget), plist.match(/UR_PROXY_RETRY_BUDGET<\/key>\s*<string>(\d+)<\/string>/)?.[1]);
});

test('retry proxy script defaults also clear the large-request floor', () => {
  const script = read('proxy/mm-retry-proxy.py');
  const firstByte = Number(script.match(/UR_PROXY_FIRST_BYTE_TIMEOUT", "(\d+)"/)?.[1]);
  const budget = Number(script.match(/UR_PROXY_RETRY_BUDGET", "(\d+)"/)?.[1]);
  assert.ok(firstByte >= 30, `script default first-byte ${firstByte}s too small`);
  assert.ok(budget >= firstByte, `script default budget ${budget}s smaller than one attempt`);
});
