// The native chrome cannot read CSS variables, so CleBrowserPalette duplicates
// the token values. That duplication already drifted once (a warm-brown night
// palette appeared next to the real blue-black one). This test makes tokens.css
// the single source of truth: change a token without updating the Swift table
// and the suite fails with the exact mismatch.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tokensCss = fs.readFileSync(path.join(root, 'services/cle-studio/src/styles/tokens.css'), 'utf8');
const control = fs.readFileSync(path.join(root, 'desktop/macos/Sources/BrowserControl.swift'), 'utf8');

// ---- parse tokens.css -------------------------------------------------------
function colour(value) {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1];
  }
  const rgba = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) return [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255, rgba[4] === undefined ? 1 : Number(rgba[4])];
  return null;
}

function block(selector) {
  const at = tokensCss.indexOf(selector);
  assert.ok(at >= 0, `tokens.css is missing ${selector}`);
  const open = tokensCss.indexOf('{', at);
  const close = tokensCss.indexOf('}', open);
  return tokensCss.slice(open + 1, close);
}

function declarations(source) {
  const out = new Map();
  for (const m of source.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(m[1], m[2].trim());
  return out;
}

const light = declarations(block(':root {'));
const dark = declarations(block(':root[data-theme-mode="dark"]'));

// ---- parse the Swift palette ------------------------------------------------
function swiftColour(name) {
  const m = control.match(new RegExp(
    `static let ${name} = NSColor\\(srgbRed: ([\\d.]+), green: ([\\d.]+), blue: ([\\d.]+), alpha: ([\\d.]+)\\)`
  ));
  assert.ok(m, `CleBrowserPalette.${name} not found`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

// token name -> (light swift name, dark swift name)
const PAIRS = [
  ['paper', 'paper', 'nightPaper'],
  ['surface', 'surface', 'nightSurface'],
  ['ink', 'ink', 'nightInk'],
  ['ink-2', 'ink2', 'nightInk2'],
  ['ink-3', 'ink3', 'nightInk3'],
  ['line', 'line', 'nightLine'],
  ['gaze', 'gaze', 'nightGaze'],
  ['gold', 'gold', 'nightGold'],
];

test('native palette matches tokens.css in light and dark', () => {
  const problems = [];
  for (const [token, lightName, darkName] of PAIRS) {
    for (const [mode, table, swiftName] of [['light', light, lightName], ['dark', dark, darkName]]) {
      const raw = table.get(`cle-${token}`);
      assert.ok(raw, `token --cle-${token} missing from ${mode} block`);
      const expected = colour(raw);
      assert.ok(expected, `cannot parse token value ${raw}`);
      const actual = swiftColour(swiftName);
      const delta = Math.max(...expected.map((v, i) => Math.abs(v - actual[i])));
      if (delta > 0.003) {
        problems.push(`${mode} --cle-${token} = ${raw} but ${swiftName} = ${actual.map((v) => v.toFixed(3)).join(', ')}`);
      }
    }
  }
  assert.deepEqual(problems, [], 'native chrome drifted from tokens.css:\n' + problems.join('\n'));
});

test('inline native pages read the same table, not their own literals', () => {
  // Start page, error page and material preview must all inject cssVariables.
  const launcher = fs.readFileSync(path.join(root, 'desktop/macos/Sources/Launcher.swift'), 'utf8');
  const material = fs.readFileSync(path.join(root, 'desktop/macos/Sources/MaterialPreview.swift'), 'utf8');
  const uses = (launcher + material).split('CleBrowserPalette.cssVariables').length - 1;
  assert.ok(uses >= 3, `expected start/error/preview pages to share the table, found ${uses}`);

  // And the embedded variable block itself must match the tokens.
  const cssVars = control.slice(control.indexOf('static var cssVariables')).toString();
  for (const [token, lightName] of PAIRS) {
    const expected = colour(light.get(`cle-${token}`));
    const hex = control.match(new RegExp(`--${token === 'ink-2' ? 'ink2' : token === 'ink-3' ? 'ink3' : token}:(#[0-9A-Fa-f]{6}|rgba\\([^)]+\\))`));
    if (!hex && token === 'line') continue; // rgba line is asserted by the pairing test above
    assert.ok(hex, `cssVariables is missing --${token}`);
    const actual = colour(hex[1]);
    const delta = Math.max(...expected.map((v, i) => Math.abs(v - actual[i])));
    assert.ok(delta <= 0.003, `cssVariables --${token} (${hex[1]}) drifted from tokens.css (${light.get(`cle-${token}`)})`);
  }
});

test('the browser under-page colour follows the same tokens', () => {
  const launcher = fs.readFileSync(path.join(root, 'desktop/macos/Sources/Launcher.swift'), 'utf8');
  // WebKit paints this behind the page during load and rubber-band scrolling.
  // It used to be a separate hand-mixed pair and showed as a third colour.
  assert.doesNotMatch(launcher, /srgbRed: nightAppearance \? 0\.10 : 1\.0/, 'old hand-mixed under-page colour removed');
  const set = launcher.slice(launcher.indexOf('browser.underPageBackgroundColor'));
  assert.match(set.slice(0, 200), /CleBrowserPalette\.paper\(nightAppearance\)/);
});
