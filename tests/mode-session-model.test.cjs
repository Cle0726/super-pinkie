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

test('split view opens its mode root without replaying a stale recent chat or restarting the gateway', () => {
  assert.match(mode, /const sessionKey = mode\.sessionKey/);
  assert.match(mode, /bridge\.postMessage\(\{ action: "open", mode: mode\.id, sessionKey \}\)/);
  assert.doesNotMatch(mode, /Gateway\.(?:start|stop|repair)|gateway\s+restart/);
});

test('mode changes defer repaint and session observers until the transition is finished', () => {
  assert.match(mode, /laolao:mode-transition-start/);
  assert.match(mode, /laolao:mode-session-handoff/);
  assert.match(mode, /laolao:mode-transition-finished/);
  assert.match(mode, /data-laolao-mode-pending/);
  assert.match(mode, /if \(modeTransitionTargetId\) \{[\s\S]*?return;\s*\}/);
  assert.match(mode, /progressAnimation = motion\.animateProgress\(ui\.fill, ui\.percentage, ui\.progress, 68, 96, 28 \* 92, "linear"\)/);
  assert.match(mode, /const visualValue = motion\.displayedProgress\(ui\.fill\) \?\? 68;\s*progressAnimation\.cancel\(\);\s*progressAnimation = null;\s*ui\.fill\.style\.transform = `scaleX\(\$\{visualValue \/ 100\}\)`/);
  assert.ok(mode.indexOf('await finishModeTransition(targetMode, transition)') < mode.indexOf('"pinkie:session-selected"'));
  assert.doesNotMatch(mode, /setTimeout\(\(\) => window\.dispatchEvent\(new CustomEvent\(\s*"pinkie:session-selected"/);
});
