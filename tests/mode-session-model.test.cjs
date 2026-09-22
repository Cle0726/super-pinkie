const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mode = fs.readFileSync(path.join(root, 'ui/injections/laolao-mode-switcher.js'), 'utf8');
const resume = fs.readFileSync(path.join(root, 'ui/injections/laolao-resume.js'), 'utf8');

test('mode switching returns to the last exact session instead of each mode main chat', () => {
  assert.match(mode, /laolao:last-session:/);
  assert.match(mode, /resolveTargetSession/);
  assert.match(mode, /sessions\.list/);
  assert.match(mode, /next\.searchParams\.set\("session", targetSessionKey\)/);
  assert.match(mode, /pinkie:session-selected/);
});

test('mode switching lets the router own session/model handoff without mutating the gateway key early', () => {
  assert.doesNotMatch(mode, /setSessionKey\?\.\(mode\.sessionKey\)/);
  assert.match(mode, /typeof shell\?\.navigate === "function"/);
  assert.match(resume, /syncSelectedSession/);
  assert.match(resume, /routedSessionKey\(\) !== key/);
  assert.match(resume, /recoverPaneChat\(pane, "session-selected"/);
});

test('split view opens the saved session and never starts or stops a gateway', () => {
  assert.match(mode, /const sessionKey = await resolveTargetSession\(mode\)/);
  assert.match(mode, /bridge\.postMessage\(\{ action: "open", mode: mode\.id, sessionKey \}\)/);
  assert.doesNotMatch(mode, /Gateway\.(?:start|stop|repair)|gateway\s+restart/);
});
