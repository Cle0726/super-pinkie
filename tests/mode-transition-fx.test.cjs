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

test('FX configures five modes plus the shared splash scene, with only shipped assets', () => {
  const fx = loadFx();
  assert.deepEqual([...fx.modes].sort(), ['chat', 'learning', 'project', 'thinking', 'unrestricted']);
  assert.equal(typeof fx.playSplash, 'function');
  assert.ok(fx._test.SCENES.splash, 'splash has scene configuration');
  const splash = fx._test.SCENES.splash;
  for (const key of ['anchor', 'hair', 'mustache', 'dust', 'motion']) {
    assert.ok(splash[key], `${key}: splash configuration`);
  }

  for (const id of [...fx.modes, 'splash']) {
    assert.ok(fx._test.SCENES[id], `${id} has configuration`);
    for (const assetUrl of Object.values(fx.assetUrls(id))) {
      const relative = assetUrl.split('?', 1)[0].replace(/^\//, '');
      assert.ok(fs.existsSync(path.join(root, 'ui', 'assets', relative)), `${id}: ${relative}`);
    }
  }
  assert.deepEqual(
    Object.values(fx.assetUrls('splash')).map((url) => path.basename(url.split('?', 1)[0])).sort(),
    ['laolao-splash-char-soft.png', 'laolao-splash-mask.png', 'laolao-splash-plate-soft.png',
      'laolao-splash-plate.webp', 'laolao-splash.png'].sort(),
  );
});

test('FX falls back for both a normal transition and splash when it cannot animate', () => {
  for (const id of ['chat', 'splash']) {
    assert.equal(loadFx({reduced: true}).supported(id), false, `${id}: reduced motion`);
    assert.equal(loadFx({webgl: false}).supported(id), false, `${id}: no WebGL`);
    assert.equal(loadFx({setting: 'off'}).supported(id), false, `${id}: user switch`);
  }
});

test('fragments and both installers carry the same splash and FX revisions', () => {
  const fragment = read('ui/injections/laolao-head.fragment.html');
  const body = read('ui/injections/laolao-body.fragment.html');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  const revisions = {
    'laolao-mode-transition-fx.js': 'modetransitionfx2',
    'laolao-mode-transition-fx.css': 'modetransitionfx2',
    'laolao-splash.js': 'splash27',
    'laolao-splash.css': 'splash19',
    'laolao-handoff-bootstrap.js': 'handoff6',
  };
  for (const [file, revision] of Object.entries(revisions)) {
    assert.match(mac, new RegExp(`${file.replace('.', '\\.') }\\?v=${revision}`), `macOS: ${file}`);
    assert.match(windows, new RegExp(`'${file.replace('.', '\\.') }' = '${revision}'`), `Windows: ${file}`);
  }
  assert.match(fragment, /laolao-splash\.css\?v=splash19/);
  assert.match(fragment, /laolao-mode-transition-fx\.css\?v=modetransitionfx2/);
  assert.match(fragment, /laolao-mode-transition-fx\.js\?v=modetransitionfx2/);
  assert.match(body, /laolao-handoff-bootstrap\.js\?v=handoff6/);
  for (const file of ['laolao-splash-mask.png', 'laolao-splash-plate.webp', 'laolao-splash-plate-soft.png', 'laolao-splash-char-soft.png']) {
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

test('the splash cross-fades its aligned canvas and keeps party particles over the copy', () => {
  const css = read('ui/injections/laolao-splash.css');
  assert.match(css, /\.laolao-splash \.laolao-splash__gl\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transition:\s*opacity 300ms/);
  assert.match(css, /\.laolao-splash\.is-fx-ready \.laolao-splash__gl\s*\{\s*opacity:\s*1;/);
  assert.match(css, /\.laolao-splash \.laolao-splash__particles\s*\{[\s\S]*?z-index:\s*6;/);
  assert.match(css, /\.laolao-splash__content\s*\{\s*position:\s*relative;\s*z-index:\s*2;/);
});
