const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const script = read('ui/injections/laolao-process-card.js');
const css = read('ui/injections/laolao-process-card.css');

test('the process card script only fills the renderer slots from live gateway events', () => {
  assert.match(script, /pinkie:gateway-event/);
  assert.match(script, /\[data-pinkie-thinking\]/);
  assert.match(script, /\[data-pinkie-status\]/);
  assert.match(script, /payload\.stream === "thinking"/);
  for (const state of ['thinking', 'working', 'writing', 'asking', 'done', 'oops']) {
    assert.match(script, new RegExp(`${state}: "`));
  }
  assert.match(script, /laolao-pinkie-status-\$\{state\}\.png/);
  // Thinking is not in chat.history, so it is kept per card and its key follows the history sync.
  assert.match(script, /laolao:process-thinking:v1/);
  assert.match(script, /__pinkieProcessKeep/);
  assert.match(script, /function migrateThinking/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /request\("chat\.send"/);
});

test('the card matches the original bubbles and respects reduced motion', () => {
  assert.match(css, /\.chat-group\.chat-group--process \{[\s\S]*?padding-left: 46px;/);
  assert.match(css, /linear-gradient\(135deg, rgba\(255, 253, 254, 0\.74\), rgba\(255, 247, 251, 0\.52\)\)/);
  assert.match(css, /\.pinkie-process\[data-live="1"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const source of [read('ui/injections/laolao-head.fragment.html'), read('installer/macos/apply-theme.sh'), read('installer/windows/apply-theme.ps1')]) {
    assert.match(source, /laolao-process-card\.css\?v=processcard1/);
    assert.match(source, /laolao-process-card\.js\?v=processcard2/);
  }
});
