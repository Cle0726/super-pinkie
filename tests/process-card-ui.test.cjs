const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const script = read('ui/injections/laolao-process-card.js');
const css = read('ui/injections/laolao-process-card.css');
const toolStream = read('ui/injections/laolao-tool-stream.js');

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
  assert.match(script, /publishRunState\(key, true\)/);
  assert.match(script, /slot\.dataset\.state === "oops"/);
  assert.match(toolStream, /window\.__pinkieActiveChatRuns/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /request\("chat\.send"/);
});

test('the card matches the original bubbles and respects reduced motion', () => {
  assert.match(css, /\.chat-group\.chat-group--process \{[\s\S]*?padding-left: 46px;/);
  assert.match(css, /linear-gradient\(135deg, rgba\(255, 253, 254, 0\.74\), rgba\(255, 247, 251, 0\.52\)\)/);
  assert.match(css, /\.pinkie-process\[data-live="1"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const source of [read('ui/injections/laolao-head.fragment.html'), read('installer/macos/apply-theme.sh'), read('installer/windows/apply-theme.ps1')]) {
    assert.match(source, /laolao-process-card\.css\?v=processcard3/);
    assert.match(source, /laolao-process-card\.js\?v=processcard4/);
  }
});

test('a thought that arrives in one chunk is typed out instead of popping in', () => {
  // Gemini thinks silently and then delivers the whole thought right before acting.
  assert.match(script, /const TYPE_CPS = 120, TYPE_MIN = 500, TYPE_MAX = 2500, TYPE_HURRY = 400, TYPE_HOLD = 1000;/);
  assert.match(script, /typeOut\(key, before, record\.text\.length\)/);
  assert.match(script, /stopThinking\(\);\s*hurryTyping\(\);/);
  assert.match(script, /const shown = isTyping \? record\.text\.slice\(0, typed\) : record\.text;/);
  assert.match(script, /if \(reduced\(\)\) \{ typing\.delete\(key\); return; \}/);
  assert.match(css, /\.pinkie-thinking\.is-typing \.pinkie-thinking__text::after/);
  assert.match(css, /\.pinkie-thinking\.is-entering \{ animation:/);
});
