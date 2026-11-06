// 进阶调节: one versioned config, defaults locked to today's constants.
// Browser proof that each control changes behaviour: tools/power-settings/e2e.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function loadTuning(initial = {}, dpr = 2) {
  const store = new Map(Object.entries(initial));
  const events = [];
  const listeners = new Map();
  const window = {
    devicePixelRatio: dpr,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    dispatchEvent(event) { events.push(event); },
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  window.localStorage = localStorage;
  vm.runInNewContext(read('ui/injections/laolao-tuning.js'), {window, localStorage, CustomEvent, JSON, Object, Number, Math});
  const fireStorage = (key, value) => {
    if (value == null) store.delete(key); else store.set(key, value);
    for (const fn of listeners.get('storage') || []) fn({key});
  };
  return {T: window.PinkieTuning, store, events, window, fireStorage};
}

// Each key, the script that reads it, and the constant that script uses today.
const WIRING = [
  ['history.liveWindow', 'laolao-resume.js', /const LIVE_MESSAGE_WINDOW = (\d+);/, /tuned\("history\.liveWindow", LIVE_MESSAGE_WINDOW\)/],
  ['history.pageSize', 'laolao-resume.js', /const HISTORY_PAGE_SIZE = (\d+);/, /tuned\("history\.pageSize", HISTORY_PAGE_SIZE\)/],
  ['history.scanPages', 'laolao-resume.js', /const HISTORY_MAX_SCAN_PAGES = (\d+);/, /tuned\("history\.scanPages", HISTORY_MAX_SCAN_PAGES\)/],
  ['history.maxChars', 'laolao-resume.js', /const HISTORY_MAX_CHARS = (\d+);/, /tuned\("history\.maxChars", HISTORY_MAX_CHARS\)/],
  ['process.maxCards', 'laolao-process-card.js', /const MAX_CARDS = (\d+);/, /tuned\("process\.maxCards", MAX_CARDS\)/],
  ['process.maxText', 'laolao-process-card.js', /const MAX_TEXT = (\d+);/, /tuned\("process\.maxText", MAX_TEXT\)/],
  ['warmup.idleRoutes', 'laolao-page-warmup.js', /const MAX_IDLE_ROUTES = (\d+);/, /tuned\("warmup\.idleRoutes", MAX_IDLE_ROUTES\)/],
  ['warmup.maxRoutes', 'laolao-page-warmup.js', /const MAX_WARMED_ROUTES = (\d+);/, /tuned\("warmup\.maxRoutes", MAX_WARMED_ROUTES\)/],
];

test('a fresh profile stores nothing and every value is the script\'s own constant', () => {
  const {T, store} = loadTuning();
  assert.equal(store.size, 0, 'loading writes nothing');
  assert.equal(T.level, 'standard');
  assert.deepEqual({...T.overrides}, {});
  for (const [key, value] of Object.entries(T.DEFAULTS)) {
    assert.equal(T.get(key, value), value, key);
    assert.equal(T.get(key), value, `${key} without fallback`);
  }
  // A script's fallback always wins on the standard level: nothing is replaced.
  assert.equal(T.get('history.maxChars', 12345), 12345);
  assert.deepEqual(Object.keys(T.PRESETS.standard), [], 'the standard level is empty');
});

test('DEFAULTS equal the constants each script used before 进阶调节, and each script reads its key', () => {
  const {T} = loadTuning();
  for (const [key, file, constant, wiring] of WIRING) {
    const source = read(`ui/injections/${file}`);
    const value = Number(constant.exec(source)?.[1]);
    assert.equal(T.DEFAULTS[key], value, `${key} default vs ${file}`);
    assert.match(source, wiring, `${file} reads ${key}`);
  }
  const companion = read('ui/injections/laolao-companion.js');
  assert.equal(T.DEFAULTS['effects.ambientFps'], 30);
  assert.match(companion, /tuned\("effects\.ambientFps", 30\)/);
  assert.match(companion, /fps === 30 \? now - last < 33/, '30 fps keeps the exact old frame gate');
  assert.equal(T.DEFAULTS['effects.particles'], 1);
  for (const n of [4, 16, 7, 26, 34]) assert.match(companion, new RegExp(`density\\((?:send \\? 4 : 16|${n})\\)`));
  assert.match(companion, /pick === "standard" \? \(soft \? 1 : Math\.min\(1\.5, devicePixelRatio \|\| 1\)\)/, 'standard keeps the ambient resolution rule');
  const laser = read('ui/injections/laolao-laser-pointer.js');
  assert.equal(T.DEFAULTS['ink.scale'], 1);
  assert.match(laser, /const MAX_POINTS = 480;/);
  assert.match(laser, /const MAX_STROKE_POINTS = 1200;/);
  assert.match(laser, /Math\.round\(MAX_POINTS \* inkScale\(\)\)/);
  assert.match(laser, /Math\.round\(MAX_STROKE_POINTS \* inkScale\(\)\)/);
  assert.match(laser, /pixelRatio\(2\.5\) : Math\.min\(window\.devicePixelRatio \|\| 1, 2\.5\)/);
  for (const file of ['laolao-buddy-rig.js', 'laolao-compaction-glyph.js', 'laolao-cle-space.js']) {
    assert.match(read(`ui/injections/${file}`), /PinkieTuning\.pixelRatio\(2\) : Math\.min\(2, window\.devicePixelRatio \|\| 1\)/, file);
  }
  const card = read('ui/injections/laolao-process-card.js');
  assert.match(card, /pixelRatio\(Infinity\) : devicePixelRatio/, 'confetti keeps the full screen density by default');
  assert.match(card, /Math\.round\(22 \* tuned\("effects\.particles", 1\)\)/);
});

test('pixelRatio: standard keeps each canvas cap, native uses the screen, low is 1×', () => {
  const {T} = loadTuning({}, 3);
  assert.equal(T.pixelRatio(2), 2);
  assert.equal(T.pixelRatio(2.5), 2.5);
  assert.equal(T.pixelRatio(Infinity), 3);
  T.set('render.pixelRatio', 'native');
  assert.equal(T.pixelRatio(2), 3);
  T.set('render.pixelRatio', 'low');
  assert.equal(T.pixelRatio(2), 1);
  const low = loadTuning({}, 1).T;
  assert.equal(low.pixelRatio(2), 1);
});

test('levels, single overrides, persistence and reset', () => {
  const {T, store, events} = loadTuning();
  T.setLevel('max');
  assert.equal(T.get('history.liveWindow', 512), 2000);
  assert.equal(T.get('history.maxChars', 240000), 500000, 'never above the gateway maximum');
  assert.ok(T.get('history.pageSize') <= 1000, 'never above the gateway page maximum');
  assert.deepEqual(JSON.parse(store.get(T.KEY)), {version: 1, level: 'max', values: {}});
  assert.equal(events.at(-1).type, 'pinkie:tuning-change');
  assert.ok(events.at(-1).detail.keys.includes('history.liveWindow'));

  assert.equal(T.set('history.liveWindow', 256), true);
  assert.equal(T.get('history.liveWindow'), 256);
  assert.deepEqual({...T.overrides}, {'history.liveWindow': 256});
  assert.equal(T.set('history.liveWindow', 2000), true, 'picking the level value drops the override');
  assert.deepEqual({...T.overrides}, {});

  assert.equal(T.set('history.liveWindow', 99999), false, 'values outside the offered options are refused');
  assert.equal(T.set('made.up', 1), false);

  T.setLevel('saver');
  assert.equal(T.get('effects.ambientFps', 30), 20);
  T.set('effects.ambientFps', 60);
  T.setLevel('standard');
  assert.deepEqual({...T.overrides}, {}, 'a new level clears hand-made changes');
  T.set('process.maxText', 50000);
  T.reset();
  assert.equal(store.has(T.KEY), false, 'reset removes the key entirely');
  assert.equal(T.get('process.maxText', 8000), 8000);
});

test('stored config is validated, versioned and followed across windows', () => {
  const bad = loadTuning({'pinkie.tuning.v1': JSON.stringify({version: 2, level: 'max', values: {}})}).T;
  assert.equal(bad.level, 'standard', 'another version is ignored');
  const junk = loadTuning({'pinkie.tuning.v1': '{not json'}).T;
  assert.equal(junk.level, 'standard');
  const mixed = loadTuning({'pinkie.tuning.v1': JSON.stringify({version: 1, level: 'saver', values: {'history.pageSize': 500, 'history.maxChars': 7, other: 1}})}).T;
  assert.equal(mixed.level, 'saver');
  assert.deepEqual({...mixed.overrides}, {'history.pageSize': 500}, 'unknown keys and values are dropped');

  const {T, events, fireStorage} = loadTuning();
  fireStorage(T.KEY, JSON.stringify({version: 1, level: 'max', values: {}}));
  assert.equal(T.level, 'max', 'another window changing the setting applies here');
  assert.equal(events.at(-1).type, 'pinkie:tuning-change');
});

test('nothing decides by hardware: no GPU, memory, core or OS-flag reads', () => {
  for (const file of ['laolao-tuning.js', 'laolao-power-settings.js']) {
    const source = read(`ui/injections/${file}`);
    assert.doesNotMatch(source, /hardwareConcurrency|deviceMemory|navigator\.gpu|WEBGL_debug_renderer_info|getBattery|prefers-reduced-motion|matchMedia/, file);
  }
});

test('the config loads third and synchronously; the page loads with the settings page', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  const scripts = [...head.matchAll(/<script[^>]*src="\/([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(0, 3), ['laolao-night.js', 'laolao-motion-preference.js', 'laolao-tuning.js']);
  assert.doesNotMatch(head.split('laolao-tuning.js')[0], /defer/);
  const power = scripts.indexOf('laolao-power-settings.js');
  assert.ok(power > 0 && power < scripts.indexOf('laolao-settings-user.js'));
  assert.match(head, /laolao-power-settings\.css/);
});

test('the page is easy to find and owns no second motion switch', () => {
  const settings = read('ui/injections/laolao-settings-user.js');
  assert.match(settings, /"pinkie-power-entry", scroll, \(\) => window\.__pinkiePower\?\.open\(\)/);
  assert.ok(settings.indexOf('pinkie-power-entry') < settings.indexOf('const modeCard'), 'first card on 常用设置');
  assert.match(read('ui/injections/laolao-companion.js'), /item\("power", "进阶调节", \(\) => window\.__pinkiePower\.open\(\)/);
  const page = read('ui/injections/laolao-power-settings.js');
  assert.match(page, /window\.__pinkieMotion\?\.set\(value\)/, 'motion goes through the one existing switch');
  assert.doesNotMatch(page, /pinkie\.motion\.reduce\.v1/, 'and never writes its storage directly');
  assert.match(page, /BUDDY_PREF_KEY = "pinkie-buddy-prefs-v1"/, '氛围 shares the 小碧琪 menu preference');
  for (const name of ['buddy-chat-sleepy', 'buddy-chat-rest', 'buddy-unrestricted-happy', 'buddy-chat-happy']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', `ui/assets/laolao-pinkie-${name}.png`)), name);
  }
  // Every numeric row on the page maps to a real key.
  const keys = [...page.matchAll(/\{key: "([\w.]+)"/g)].map((m) => m[1]).sort();
  const {T} = loadTuning();
  assert.deepEqual(keys, Object.keys(T.DEFAULTS).sort());
});
