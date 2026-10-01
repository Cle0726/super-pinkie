const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const css = read('ui/injections/laolao-mode-menu-fx.css');
const switcher = read('ui/injections/laolao-mode-switcher.js');

test('every mode owns its palette, halo, and one signature motion', () => {
  const palettes = {
    chat: {colors: ['#e94f91', '#f6bd69'], motions: ['chat-bounce', 'chat-balloon']},
    project: {colors: ['#e75d9c', '#59aaa5'], motions: ['project-peek', 'project-paper']},
    thinking: {colors: ['#9d74c8', '#8bc6df'], motions: ['thinking-tilt', 'thinking-bubbles', 'thinking-star']},
    learning: {colors: ['#b277c7', '#f4c66d'], motions: ['learning-star-draw', 'learning-pen']},
    unrestricted: {colors: ['#ef568f', '#f3ca63', '#63bfe9'], motions: ['unrestricted-steps', 'unrestricted-speed']},
  };
  for (const [mode, {colors, motions}] of Object.entries(palettes)) {
    const block = css.match(new RegExp(`\\[data-mode="${mode}"\\][\\s\\S]*?(?=\\n\\.laolao-mode-button__portrait\\[data-mode|\\n/\\* 覆盖)`))?.[0] || '';
    for (const color of colors) assert.match(block, new RegExp(color), `${mode} ${color}`);
    for (const name of motions) assert.match(css, new RegExp(`laolao-mode-fx-${name}`), `${mode} ${name}`);
  }
  assert.match(css, /conic-gradient\(from 28deg/);
  assert.match(css, /laolao-mode-button__portrait\.is-current .laolao-mode-button__halo/);
});

test('thinking mode gives its three bubbles independent, staggered entrances before the star', () => {
  assert.match(switcher, /mode\.id === "thinking"[\s\S]*?index < 3[\s\S]*?document\.createElement\("i"\)/);
  assert.match(css, /laolao-mode-button__fx-bubbles > i:nth-child\(1\)[\s\S]*?--laolao-mode-fx-bubble-delay: 0ms/);
  assert.match(css, /laolao-mode-button__fx-bubbles > i:nth-child\(2\)[\s\S]*?--laolao-mode-fx-bubble-delay: 80ms/);
  assert.match(css, /laolao-mode-button__fx-bubbles > i:nth-child\(3\)[\s\S]*?--laolao-mode-fx-bubble-delay: 160ms/);
  assert.match(css, /fx-bubbles > i[\s\S]*?thinking-bubbles[\s\S]*?var\(--laolao-mode-fx-bubble-delay\)/);
  assert.match(css, /thinking-star[\s\S]*?280ms/);
});

test('menu enters in staggered portrait pops and the current check pops once', () => {
  assert.match(switcher, /--laolao-mode-fx-delay", `\$\{index \* 40\}ms`/);
  assert.match(css, /laolao-mode-menu--fx-opening[\s\S]*laolao-mode-fx-option-in/);
  assert.match(css, /laolao-mode-fx-portrait-in[\s\S]*scale: \.6/);
  assert.match(css, /laolao-mode-menu__option\[aria-checked="true"\][\s\S]*laolao-mode-fx-check-in/);
  assert.match(switcher, /laolao-mode-menu--fx-opening/);
});

test('the only repeating effect is the open menu current-mode halo', () => {
  const repeats = [...css.matchAll(/animation:[^;]*\binfinite\b/g)].map((match) => match[0]);
  assert.equal(repeats.length, 1, 'no ambient animation should keep running');
  assert.match(repeats[0], /laolao-mode-fx-halo-breathe/);
  assert.match(css, /laolao-mode-menu--fx .*aria-checked="true".*laolao-mode-button__halo/s);
});

test('selection burst starts before menu removal and does not postpone the transition', () => {
  const switchStart = switcher.indexOf('const switchMode = async');
  const selection = switcher.indexOf('launchSelectionBurst(sourceOption, mode);', switchStart);
  const close = switcher.indexOf('closeMenu();', selection);
  const transition = switcher.indexOf('playModeTransition(mode)', close);
  assert.ok(selection > switchStart && close > selection && transition > close);
  assert.match(switcher, /for \(let index = 0; index < 5; index \+= 1\).*document\.createElement\("i"\)/s);
  assert.match(css, /laolao-mode-fx-selection-avatar[\s\S]*scale: 1\.15/);
  assert.match(css, /z-index: 2147483647/);
});

test('a real mode change queues exactly one top portrait swap, while normal repaint stays quiet', () => {
  assert.match(switcher, /let presentedModeId = null;/);
  assert.match(switcher, /const previousMode = presentedModeId \?\? document\.documentElement\.getAttribute\("data-laolao-mode"\);/);
  assert.match(switcher, /if \(previousMode && !modeFxReduced\(\)\) \{[\s\S]*from: previousMode,[\s\S]*to: mode\.id,[\s\S]*armed: !switching/);
  assert.match(switcher, /await finishModeTransition\(targetMode, transition\);\s*flushPendingModePortraitFx\(targetMode\);/);
  assert.match(switcher, /pending\.armed = true;\s*render\(\);/);
  assert.match(switcher, /force: shouldSwapPortrait,/);
  assert.match(switcher, /createPortraitImage\(outgoingMode\?\.avatar\) \|\| currentPortrait/);
  assert.match(switcher, /laolao-mode-button__portrait--fx-swap/);
  assert.match(switcher, /const modeSignatureCleanup = new WeakMap\(\);/);
  assert.match(switcher, /modeSignatureCleanup\.get\(option\)\?\.\(\);/);
  assert.match(switcher, /event\.animationName === modeSignatureAnimation\[option\.dataset\.mode\]/);
  assert.match(switcher, /MODE_MENU_FX_ACTION_LIFETIME = 1100/);
  assert.match(css, /laolao-mode-fx-top-out/);
  assert.match(css, /laolao-mode-fx-top-in/);
  assert.match(css, /laolao-mode-fx-top-halo-flash/);
  assert.match(css, /laolao-mode-switcher:hover .laolao-mode-button__portrait:not\(/);
  assert.equal((switcher.match(/new MutationObserver\(/g) || []).length, 1, 'FX adds no new observer');
});

test('reduced motion removes all portrait effects but retains a static halo', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /animation: none !important/);
  assert.match(reduced, /transition: none !important/);
  assert.match(reduced, /laolao-mode-button__fx,[\s\S]*laolao-mode-button__fx-bubbles,[\s\S]*display: none !important/);
  assert.doesNotMatch(reduced, /laolao-mode-button__halo\s*\{[\s\S]{0,100}display:\s*none/);
  assert.match(reduced, /laolao-mode-button__portrait\.is-current .laolao-mode-button__halo/);
});

test('FX keyframes stay on compositor-friendly independent properties', () => {
  for (const keyframes of css.match(/@keyframes[\s\S]*?\n\}/g) || []) {
    assert.doesNotMatch(keyframes, /\btransform\s*:/, keyframes.slice(0, 72));
    assert.doesNotMatch(keyframes, /\bfilter\s*:/, keyframes.slice(0, 72));
  }
  assert.match(css, /stroke-dashoffset: 96/);
  assert.match(css, /laolao-mode-fx-learning-star-draw/);
});
