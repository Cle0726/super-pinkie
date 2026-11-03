const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const css = read('ui/injections/laolao-motion-system.css');
const modeMenuFx = read('ui/injections/laolao-mode-menu-fx.css');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('motion tokens are defined once and used instead of hard-coded timings', () => {
  for (const token of ['--motion-instant', '--motion-fast', '--motion-base', '--motion-slow',
    '--ease-out', '--ease-in', '--ease-standard', '--ease-spring']) {
    assert.match(css, new RegExp(`:root \\{[\\s\\S]*?${token}:`), `${token} defined`);
  }
  const body = rules.replace(/:root \{[\s\S]*?\}/, '').replace(/@keyframes[\s\S]*?\n\}/g, '');
  assert.doesNotMatch(body.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*$/, ''),
    /\b\d+(?:\.\d+)?m?s\b/, 'durations outside :root must use variables');
});

test('motion only animates compositor-friendly properties and never repositions via transform keyframes', () => {
  assert.doesNotMatch(css, /transition:[^;]*\b(?:width|height|top|left|margin|padding)\b/);
  for (const frames of css.match(/@keyframes[\s\S]*?\n\}/g)) {
    assert.doesNotMatch(frames, /\btransform\s*:/, 'keyframes use translate/scale so element positioning is kept');
  }
  assert.match(css, /laolao-motion-page-in \{\s*from \{ opacity: \.55/);
  assert.match(css, /html:not\(\[data-laolao-workspace-split\]\):not\(\[data-laolao-workspace-dock\]\)/);
});

test('reduced motion zeroes every token and removes press offsets and entrances', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const token of ['--motion-instant', '--motion-fast', '--motion-base', '--motion-slow']) {
    assert.match(reduced, new RegExp(`${token}: 0\\.01ms`));
  }
  assert.match(reduced, /transform: none !important/);
  assert.match(reduced, /animation: none !important/);
});

test('motion system loads after the theme on macOS and Windows with matching versions', () => {
  const head = require('./fixtures/shared-ui.cjs').sharedUi({'entries': ['laolao-motion-system.css', 'laolao-mode-menu-fx.css', 'laolao-theme.css'], 'assets': []});
  assert.ok(head.indexOf('laolao-motion-system.css') > head.indexOf('laolao-theme.css'));
  assert.ok(head.indexOf('laolao-mode-menu-fx.css') > head.indexOf('laolao-motion-system.css'));
  assert.doesNotMatch(css, /MutationObserver|<script/);
  assert.doesNotMatch(modeMenuFx, /MutationObserver|<script/);
});
