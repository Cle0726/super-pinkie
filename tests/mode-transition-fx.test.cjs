const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const fxSource = read('ui/injections/laolao-mode-transition-fx.js');

function loadFx({reduced = false, webgl = true, setting = null} = {}) {
  const context = {
    module: {exports: {}},
    matchMedia: () => ({matches: reduced}),
    localStorage: {getItem: () => setting},
    document: {
      createElement(tag) {
        if (tag !== 'canvas') return {};
        return {
          getContext: () => webgl ? {getExtension: () => ({loseContext() {}})} : null,
        };
      },
    },
  };
  context.window = context;
  vm.runInNewContext(fxSource, context, {filename: 'laolao-mode-transition-fx.js'});
  return context.module.exports;
}

test('FX configures the five modes with only shipped assets; the splash has its own module', () => {
  const fx = loadFx();
  assert.deepEqual([...fx.modes].sort(), ['chat', 'learning', 'project', 'thinking', 'unrestricted']);
  assert.equal(fx.playSplash, undefined, 'cold-start splash lives in laolao-splash-fx.js');
  for (const id of fx.modes) {
    assert.ok(fx._test.MODES[id], `${id} has configuration`);
    for (const assetUrl of Object.values(fx.assetUrls(id))) {
      const relative = assetUrl.split('?', 1)[0].replace(/^\//, '');
      assert.ok(fs.existsSync(path.join(root, 'ui', 'assets', relative)), `${id}: ${relative}`);
    }
  }
});

test('FX falls back to the old transition when it cannot animate', () => {
  assert.equal(loadFx({reduced: true}).supported('chat'), false, 'reduced motion');
  assert.equal(loadFx({webgl: false}).supported('chat'), false, 'no WebGL');
  assert.equal(loadFx({setting: 'off'}).supported('chat'), false, 'user switch');
});

test('fragments and both installers carry the same splash and FX revisions', () => {
  const fragment = read('ui/injections/laolao-head.fragment.html');
  const body = read('ui/injections/laolao-body.fragment.html');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  const revisions = {
    'laolao-mode-transition-fx.js': 'modetransitionfx3',
    'laolao-mode-transition-fx.css': 'modetransitionfx3',
    'laolao-splash-fx.js': 'splashfx1',
    'laolao-splash.js': 'splash28',
    'laolao-splash.css': 'splash20',
    'laolao-handoff-bootstrap.js': 'handoff7',
  };
  for (const [file, revision] of Object.entries(revisions)) {
    assert.match(mac, new RegExp(`${file.replace('.', '\\.') }\\?v=${revision}`), `macOS: ${file}`);
    assert.match(windows, new RegExp(`'${file.replace('.', '\\.') }' = '${revision}'`), `Windows: ${file}`);
  }
  assert.match(fragment, /laolao-splash\.css\?v=splash20/);
  assert.match(fragment, /laolao-mode-transition-fx\.css\?v=modetransitionfx3/);
  assert.match(fragment, /laolao-mode-transition-fx\.js\?v=modetransitionfx3/);
  assert.match(fragment, /laolao-splash-fx\.js\?v=splashfx1/);
  assert.match(body, /laolao-handoff-bootstrap\.js\?v=handoff7/);
  for (const file of ['laolao-splash-fx.js', 'laolao-splash-mask.png', 'laolao-splash-plate.webp', 'laolao-splash-plate-soft.png', 'laolao-splash-char-soft.png']) {
    assert.match(mac, new RegExp(file.replace(/\./g, '\\.')), `macOS copies ${file}`);
    assert.match(windows, new RegExp(file.replace(/\./g, '\\.')), `Windows copies ${file}`);
  }
  assert.ok(fragment.indexOf('laolao-mode-transition-fx.css') > fragment.indexOf('laolao-motion-system.css'));
  assert.ok(fragment.indexOf('laolao-mode-transition-fx.js') < fragment.indexOf('laolao-mode-switcher.js'));
  assert.match(fragment, /laolao-mode-switcher\.js\?v=mode39/);
  assert.match(windows, /\$fxPattern[\s\S]*\$switcherMatch[\s\S]*\$html\.Substring\(0, \$switcherMatch\.Index\)/);
  assert.match(windows, /\$switcherTag[\s\S]*\$1/);
});

test('an unavailable or broken FX controller keeps the legacy transition path available', () => {
  const source = read('ui/injections/laolao-mode-switcher.js');
  const fxStart = source.indexOf('fx = window.PinkieModeTransitionFx?.play?.');
  const legacyStart = source.indexOf('const overlay = document.createElement("section")', fxStart);
  assert.ok(fxStart >= 0, 'tries the optional FX controller first');
  assert.ok(legacyStart > fxStart, 'legacy overlay is retained after the FX branch');
  assert.match(source.slice(fxStart, legacyStart), /if \(fx\) \{[\s\S]*await fx\.ready;[\s\S]*await fx\.covered;[\s\S]*return \{overlay: fx\.overlay, fx,/);
  assert.match(source.slice(fxStart, legacyStart + 90), /return new Promise\(\(resolve\) => \{/);
  assert.match(source, /let fx = null;\s*try \{[\s\S]*PinkieModeTransitionFx\?\.play\?\./);
  assert.doesNotMatch(source, /PinkieModeTransitionFx\?\.warm\(mode\.id\)/);
});

test('FX keeps its canvas visible during the controlled leave animation', () => {
  const css = read('ui/injections/laolao-mode-transition-fx.css');
  assert.match(css, /\.laolao-mode-transition--fx\.is-leaving\s*\{\s*opacity:\s*1;\s*\}/);
});

