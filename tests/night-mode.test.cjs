const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('night layer is keyed on one attribute and outranks class-only theme rules', () => {
  const css = read('ui/injections/laolao-night.css');
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^{}@\s][^{}]*(?=\{)/gm) || [];
  assert.ok(selectors.length > 50);
  const topLevel = (selector) => {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < selector.length; i += 1) {
      const c = selector[i];
      if (c === '(' || c === '[') depth += 1;
      else if (c === ')' || c === ']') depth -= 1;
      else if (c === ',' && depth === 0) { parts.push(selector.slice(start, i)); start = i + 1; }
    }
    parts.push(selector.slice(start));
    return parts;
  };
  for (const selector of selectors) {
    for (const part of topLevel(selector)) {
      assert.match(part.trim(), /^html\[data-pinkie-night\](\[[^\]]+\])*:not\(#_n\)/, part.trim());
    }
  }
});

test('night switch follows the native color mode and tells the native shell', () => {
  const js = read('ui/injections/laolao-night.js');
  assert.match(js, /data-theme-mode/);
  assert.match(js, /prefers-color-scheme: dark/);
  assert.match(js, /laolaoWindowControl/);
  assert.match(js, /disconnect\(\)/);
  const swift = read('desktop/macos/Sources/Launcher.swift');
  assert.match(swift, /"appearance"/);
  assert.match(swift, /func applyNightAppearance\(\)/);
});

test('night switch runs before anything paints and the night stylesheet loads last', () => {
  const sh = read('installer/macos/apply-theme.sh');
  assert.match(sh, /<script src="\/laolao-night\.js\?v=night2"><\/script>/);
  const fragment = read('ui/injections/laolao-head.fragment.html');
  const scripts = fragment.match(/laolao-[\w-]+\.js/g);
  assert.equal(scripts[0], 'laolao-night.js');
  const ps1 = read('installer/windows/apply-theme.ps1');
  assert.match(ps1, /<head\[\^>\]\*>/);
});

test('installing over an old fragment moves night assets, uses root paths and stays idempotent', () => {
  const sh = read('installer/macos/apply-theme.sh');
  const start = sh.indexOf('  # fragment 或旧版安装');
  assert.ok(start > 0);
  const block = sh.slice(start, sh.indexOf('\n}', start));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-night-'));
  const file = path.join(dir, 'index.html');
  const fixtures = [
    '<html><head><script src="./assets/main.js"></script><link rel="stylesheet" href="./assets/late.css"></head><body></body></html>',
    '<html><head data-boot="1"><script src="/main.js"></script><script defer src="./laolao-night.js?v=night1"></script><link rel="stylesheet" href="./laolao-night.css?v=night1"><link rel="stylesheet" href="/late.css"></head><body></body></html>',
    '<html><HEAD><script src="/laolao-night.js?v=night1"></script><script src="./laolao-night.js"></script><link href="/laolao-night.css" rel="stylesheet"></HEAD></html>',
  ];
  try {
    for (const fixture of fixtures) {
      fs.writeFileSync(file, fixture);
      const run = () => execFileSync('bash', ['-c', `set -e; ui_root="$1"; index_file="$1/index.html"; DID_CHANGE=0; normalize() {\n${block}\n}; normalize`, 'night-test', dir]);
      run();
      const output = fs.readFileSync(file, 'utf8');
      assert.match(output, /<head\b[^>]*>\s*<script src="\/laolao-night.js\?v=night2"><\/script>/i);
      assert.match(output, /<link rel="stylesheet" href="\/laolao-night.css\?v=night1">\s*<\/head>/i);
      assert.equal((output.match(/laolao-night\.js/g) || []).length, 1);
      assert.equal((output.match(/laolao-night\.css/g) || []).length, 1);
      assert.ok(!output.includes('"./assets/'), output);
      run();
      assert.equal(fs.readFileSync(file, 'utf8'), output);
    }
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  const ps1 = read('installer/windows/apply-theme.ps1');
  assert.ok(ps1.includes("$html.Replace('\"./assets/', '\"/assets/')"));
});

function nightHarness({saved = 'system', mediaDark = false, native = null, unrelated = null} = {}) {
  const attrs = new Map(native ? [['data-theme-mode', native]] : []);
  const settings = new Map();
  if (unrelated) settings.set('openclaw.control.settings.v1:ws://elsewhere:9999', JSON.stringify({themeMode:unrelated}));
  const key = 'openclaw.control.settings.v1:ws://127.0.0.1:18789';
  settings.set(key, JSON.stringify({themeMode:saved}));
  const listeners = new Map(), messages = [];
  let mediaChange, mutation, observed = false;
  const media = {matches:mediaDark, addEventListener:(_name, fn)=>{mediaChange=fn;}};
  const window = {matchMedia:()=>media,
    webkit:{messageHandlers:{laolaoWindowControl:{postMessage:m=>messages.push(m)}}},
    addEventListener:(name, fn)=>listeners.set(name, fn), dispatchEvent:()=>{}};
  const context = {window, location:{protocol:'http:',host:'127.0.0.1:18789',hostname:'127.0.0.1'},
    matchMedia:()=>media, setTimeout:fn=>fn(),
    localStorage:{getItem:key=>settings.get(key) ?? null},
    document:{documentElement:{getAttribute:name=>attrs.get(name) ?? null,
      toggleAttribute:(name, on)=>{if(on) attrs.set(name, ''); else attrs.delete(name);}}},
    CustomEvent:class {constructor(name, options){this.type=name;this.detail=options.detail;}},
    MutationObserver:class {constructor(fn){mutation=fn;} observe(){observed=true;} disconnect(){observed=false;}},
  };
  vm.runInNewContext(read('ui/injections/laolao-night.js'), context);
  return {attrs, media, messages, listeners, window, get observed(){return observed;},
    changeMedia(on){media.matches=on;mediaChange();},
    changeNative(mode){attrs.set('data-theme-mode',mode); if(observed) mutation();},
    setSaved(mode){settings.set(key, JSON.stringify({themeMode:mode}));window.__pinkieNight.apply();}};
}

test('cold start uses the selected gateway setting rather than an unrelated saved theme', () => {
  const h = nightHarness({saved:'dark', unrelated:'light'});
  assert.equal(h.window.__pinkieNight.on, true);
  assert.equal(h.messages.at(-1).mode, 'dark');
  h.changeNative('light');
  assert.equal(h.window.__pinkieNight.on, false);
});

test('system appearance changes and returning from page cache keep the night layer in sync', () => {
  const h = nightHarness();
  h.changeMedia(true);
  assert.equal(h.window.__pinkieNight.on, true);
  h.listeners.get('pagehide')();
  assert.equal(h.observed, false);
  h.listeners.get('pageshow')();
  assert.equal(h.observed, true);
  h.changeNative('light');
  assert.equal(h.window.__pinkieNight.on, false);
});

test('switching dark to system still updates native preference when both resolve to dark', () => {
  const h = nightHarness({saved:'dark',mediaDark:true,native:'dark'});
  h.setSaved('system');
  assert.equal(h.window.__pinkieNight.on, true);
  assert.equal(h.messages.at(-1).mode, 'system');
  const swift = read('desktop/macos/Sources/Launcher.swift');
  assert.match(swift, /NSApp\.appearance = followSystem \? nil : appearance/);
  assert.match(swift, /message\.webView === webView,\s*let body[^]*?body\["action"\] as\? String == "appearance"/);
});

test('companion, redesign, immersion and the 25 companion poses ship on both platforms', () => {
  const sh = read('installer/macos/apply-theme.sh');
  const ps1 = read('installer/windows/apply-theme.ps1');
  const files = ['laolao-companion.css', 'laolao-companion.js', 'laolao-redesign.css', 'laolao-immersion.js', 'laolao-night.css', 'laolao-night.js'];
  for (const mode of ['chat', 'project', 'thinking', 'learning', 'unrestricted']) {
    for (const state of ['rest', 'typing', 'working', 'happy', 'sleepy']) files.push(`laolao-pinkie-buddy-${mode}-${state}.png`);
  }
  for (const file of files) {
    assert.ok(sh.includes(file), `macOS installer misses ${file}`);
    assert.ok(ps1.includes(file), `Windows installer misses ${file}`);
    const source = file.endsWith('.png') ? `ui/assets/${file}` : `ui/injections/${file}`;
    assert.ok(fs.existsSync(path.join(root, source)), `${source} is missing`);
  }
});

test('Pinkie steps aside while a composer popover is open, and typing adds no effects', () => {
  const css = read('ui/injections/laolao-companion.css');
  assert.match(css, /\.agent-chat__composer-shell:has\(details\[open\], \.chat-settings-popover--open\) > \.pinkie-buddy/);
  const js = read('ui/injections/laolao-immersion.js');
  assert.doesNotMatch(js, /r3-mote|r3-tap|r3-light/);
});
