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
    'laolao-mode-transition-fx.js': 'modetransitionfx4',
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
  assert.match(fragment, /laolao-mode-transition-fx\.js\?v=modetransitionfx4/);
  assert.match(fragment, /laolao-splash-fx\.js\?v=splashfx1/);
  assert.match(body, /laolao-handoff-bootstrap\.js\?v=handoff7/);
  for (const file of ['laolao-splash-fx.js', 'laolao-splash-mask.png', 'laolao-splash-plate.webp', 'laolao-splash-plate-soft.png', 'laolao-splash-char-soft.png']) {
    assert.match(mac, new RegExp(file.replace(/\./g, '\\.')), `macOS copies ${file}`);
    assert.match(windows, new RegExp(file.replace(/\./g, '\\.')), `Windows copies ${file}`);
  }
  assert.ok(fragment.indexOf('laolao-mode-transition-fx.css') > fragment.indexOf('laolao-motion-system.css'));
  assert.ok(fragment.indexOf('laolao-mode-transition-fx.js') < fragment.indexOf('laolao-mode-switcher.js'));
  assert.match(fragment, /laolao-mode-switcher\.js\?v=mode41/);
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


// A fake WebGL that counts the expensive work: contexts, programs and texture uploads.
function fakeGl(counters) {
  const noop = () => {};
  return new Proxy({}, {
    get(_, name) {
      if (name === 'getExtension') return (ext) => (ext === 'KHR_parallel_shader_compile' ? {COMPLETION_STATUS_KHR: 0x91B1} : {loseContext() {}});
      if (name === 'getProgramParameter') return () => true;
      if (name === 'createProgram') return () => { counters.programs += 1; return {}; };
      if (name === 'texImage2D') return () => { counters.uploads += 1; };
      if (/^create|^get/.test(String(name))) return () => ({});
      if (/^[A-Z_0-9]+$/.test(String(name))) return 1;
      return noop;
    },
  });
}

test('the shared stage is prepared once, after the splash, and keeps every mode on the GPU', async () => {
  const counters = {contexts: 0, programs: 0, uploads: 0};
  const listeners = new Map();
  let splash = {};
  const context = {
    module: {exports: {}},
    setTimeout, clearTimeout,
    matchMedia: () => ({matches: false}),
    localStorage: {getItem: () => null},
    addEventListener: (name, fn) => listeners.set(name, fn),
    Image: class {
      set src(value) { this.naturalWidth = 1672; this.naturalHeight = 941; setTimeout(() => this.onload(), 1); }
      decode() { return Promise.resolve(); }
    },
    document: {
      getElementById: (id) => (id === 'laolao-splash' ? splash : null),
      documentElement: {getAttribute: () => 'chat'},
      createElement(tag) {
        if (tag !== 'canvas') return {};
        return {
          setAttribute() {}, addEventListener() {},
          getContext: () => { counters.contexts += 1; return fakeGl(counters); },
        };
      },
    },
  };
  context.window = context;
  vm.runInNewContext(fxSource, context, {filename: 'laolao-mode-transition-fx.js'});
  const fx = context.module.exports;
  assert.equal(fx.supported('chat'), true);
  const probes = counters.contexts;   // supported() probes WebGL once

  fx.warm('project');
  fx.warm('chat');
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(counters.programs, 0, 'nothing compiles while the cold-start splash is playing');

  splash = null;
  listeners.get('laolao:splash-cleared')();
  await new Promise((resolve) => setTimeout(resolve, 2600));
  assert.equal(counters.contexts - probes, 1, 'one WebGL context for every transition');
  assert.equal(counters.programs, 1, 'the shader is compiled once');
  assert.equal(counters.uploads, 10, 'five textures for each warmed mode');
  fx.warm('project');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(counters.uploads, 10, 'a prepared mode is not uploaded again');
});

test('the transition clock pauses through a main-thread stall instead of skipping ahead', () => {
  assert.match(fxSource, /clock \+= Math\.min\(Math\.max\(0, now - lastNow\), MAX_STEP\)/);
  assert.match(fxSource, /const MAX_STEP = 40;/);
  assert.doesNotMatch(fxSource, /now - startAt/);
});
