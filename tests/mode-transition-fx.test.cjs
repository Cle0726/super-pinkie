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

test('FX module configures every mode and only references shipped assets', () => {
  const fx = loadFx();
  assert.deepEqual([...fx.modes].sort(), ['chat', 'learning', 'project', 'thinking', 'unrestricted']);
  for (const id of fx.modes) {
    assert.ok(fx._test.MODES[id], `${id} has configuration`);
    for (const assetUrl of Object.values(fx.assetUrls(id))) {
      const relative = assetUrl.split('?', 1)[0].replace(/^\//, '');
      assert.ok(fs.existsSync(path.join(root, 'ui', 'assets', relative)), `${id}: ${relative}`);
    }
  }
});

test('FX falls back when reduced motion is requested or WebGL is unavailable', () => {
  assert.equal(loadFx({reduced: true}).supported('chat'), false);
  assert.equal(loadFx({webgl: false}).supported('chat'), false);
  assert.equal(loadFx({setting: 'off'}).supported('chat'), false);
});

test('head fragments and both installers carry the same FX revision', () => {
  const fragment = read('ui/injections/laolao-head.fragment.html');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  for (const file of ['laolao-mode-transition-fx.js', 'laolao-mode-transition-fx.css']) {
    assert.match(fragment, new RegExp(`${file.replace('.', '\\.') }\\?v=modetransitionfx1`));
    assert.match(mac, new RegExp(`${file.replace('.', '\\.') }\\?v=modetransitionfx1`));
    assert.match(windows, new RegExp(`'${file.replace('.', '\\.') }' = 'modetransitionfx1'`));
  }
  assert.ok(fragment.indexOf('laolao-mode-transition-fx.css') > fragment.indexOf('laolao-motion-system.css'));
  assert.ok(fragment.indexOf('laolao-mode-transition-fx.js') < fragment.indexOf('laolao-mode-switcher.js'));
  assert.match(fragment, /laolao-mode-switcher\.js\?v=mode38/);
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
