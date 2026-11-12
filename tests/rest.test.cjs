// 打盹和自动减负 (laolao-rest.js) and the temporary "ease" overlay in laolao-tuning.js.
// Everything here runs against a fake page; nothing was measured in a real browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function page({store = {}, focused = true} = {}) {
  let now = 1000;
  const saved = new Map(Object.entries(store));
  const events = [];
  const winListeners = new Map(), docListeners = new Map();
  const attrs = new Set();
  const animations = [], videos = [], ids = new Set(), said = [];
  const frames = [];
  const state = {focused, hidden: false, reduce: false, observers: []};
  const listen = (map) => (type, fn) => map.set(type, [...(map.get(type) || []), fn]);
  const window = {
    devicePixelRatio: 2,
    addEventListener: listen(winListeners),
    dispatchEvent(event) { events.push(event); for (const fn of winListeners.get(event.type) || []) fn(event); },
    __pinkieMotion: {get reduce() { return state.reduce; }},
    __pinkieBuddy: {say: (text) => said.push(text)},
  };
  const localStorage = {
    getItem: (k) => (saved.has(k) ? saved.get(k) : null),
    setItem: (k, v) => saved.set(k, String(v)),
    removeItem: (k) => saved.delete(k),
  };
  window.localStorage = localStorage;
  const root = {
    hasAttribute: (name) => attrs.has(name),
    toggleAttribute(name, on) { if (on) attrs.add(name); else attrs.delete(name); },
  };
  const document = {
    documentElement: root,
    get hidden() { return state.hidden; },
    hasFocus: () => state.focused,
    getAnimations: () => animations,
    querySelectorAll: (selector) => (selector === 'video' ? videos : []),
    getElementById: (id) => (ids.has(id) ? {} : null),
    addEventListener: listen(docListeners),
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  class MutationObserver { constructor(fn) { state.observers.push(fn); } observe() {} }
  const context = {
    window, document, localStorage, CustomEvent, MutationObserver, JSON, Object, Number, Math, Set, Boolean,
    performance: {now: () => now},
    setInterval: () => 0,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
  };
  vm.runInNewContext(read('ui/injections/laolao-tuning.js'), context);
  vm.runInNewContext(read('ui/injections/laolao-rest.js'), context);
  const fire = (map, type) => { for (const fn of map.get(type) || []) fn({type}); };
  const animation = (iterations) => {
    const a = {playState: 'running', effect: {getComputedTiming: () => ({iterations})},
      pause() { a.playState = 'paused'; }, play() { a.playState = 'running'; }};
    animations.push(a);
    return a;
  };
  // Run the frame probe: `count` frames, `gap` ms apart.
  const run = (count, gap) => {
    for (let i = 0; i < count; i += 1) {
      const fn = frames.shift();
      if (!fn) return false;
      now += gap;
      fn(now);
    }
    return true;
  };
  return {
    T: window.PinkieTuning, R: window.__pinkieRest, saved, events, attrs, ids, said, state, animation, run,
    advance: (ms) => { now += ms; },
    setRunning(on) { root.toggleAttribute('data-pinkie-running', on); for (const fn of state.observers) fn(); },
    blur() { state.focused = false; fire(winListeners, 'blur'); },
    focus() { state.focused = true; fire(winListeners, 'focus'); },
    input() { fire(winListeners, 'pointermove'); },
  };
}

test('ease overlay: only on the untouched 标准 level, never over a hand-set control, never stored', () => {
  const {T, saved} = page();
  assert.equal(T.auto, true);
  assert.deepEqual(T.setEase({'effects.ambientFps': 20, 'render.pixelRatio': 'low'}).sort(), ['effects.ambientFps', 'render.pixelRatio']);
  assert.equal(T.get('effects.ambientFps', 30), 20, 'the overlay beats the script constant');
  assert.equal(T.get('effects.particles', 1), 1, 'untouched keys keep their value');
  assert.equal(saved.size, 0, 'nothing is written');

  T.set('effects.ambientFps', 60);
  assert.equal(T.get('effects.ambientFps', 30), 60, 'a control the user set wins');
  assert.deepEqual({...T.easing}, {'render.pixelRatio': 'low'});
  T.reset();

  T.setLevel('max');
  assert.equal(T.get('effects.ambientFps', 30), 60, 'no easing on 尽情用');
  assert.deepEqual({...T.easing}, {});
  T.setLevel('saver');
  assert.deepEqual({...T.easing}, {}, 'nor on 省着用');
  T.setLevel('standard');
  assert.equal(T.get('effects.ambientFps', 30), 20);

  T.setAuto(false);
  assert.equal(T.get('effects.ambientFps', 30), 30, 'switched off: exactly what the user chose');
  assert.deepEqual({...T.easing}, {});
});

test('ease overlay never raises a value and drops anything unknown', () => {
  const {T} = page();
  T.setEase({'effects.ambientFps': 60, 'effects.particles': 2, 'render.pixelRatio': 'native', 'history.pageSize': 7, nope: 1});
  assert.deepEqual({...T.easing}, {});
  T.setEase({'effects.particles': 0.5});
  assert.deepEqual({...T.easing}, {'effects.particles': 0.5});
  T.setEase(null);
  assert.deepEqual({...T.easing}, {});
});

test('自动减负 off is remembered; on leaves stored configs exactly as before', () => {
  const first = page();
  first.T.setAuto(false);
  assert.deepEqual(JSON.parse(first.saved.get('pinkie.tuning.v1')), {version: 1, level: 'standard', values: {}, auto: false});
  const again = page({store: Object.fromEntries(first.saved)});
  assert.equal(again.T.auto, false, 'survives a restart');
  again.T.setLevel('max');
  assert.equal(again.T.auto, false, 'changing the level keeps it');
  again.T.setAuto(true);
  assert.deepEqual(JSON.parse(again.saved.get('pinkie.tuning.v1')), {version: 1, level: 'max', values: {}}, 'no auto field when on');
  again.T.reset();
  assert.equal(again.saved.size, 0);
});

test('打盹: away after 20s in the background, rest only once the work is done for 30s', () => {
  const p = page();
  p.R._evaluate();
  assert.equal(p.R.away, false);
  p.blur();
  p.advance(19000); p.R._evaluate();
  assert.equal(p.R.away, false, 'not yet');
  p.advance(2000); p.R._evaluate();
  assert.equal(p.R.away, true);
  assert.equal(p.R.rest, false, 'the last turn ended less than 30s ago');
  assert.ok(p.attrs.has('data-pinkie-away'));
  p.advance(30000); p.R._evaluate();
  assert.equal(p.R.rest, true);
  assert.ok(p.attrs.has('data-pinkie-rest'));
  assert.deepEqual(p.events.filter((e) => e.type === 'pinkie:rest-change').map((e) => [e.detail.away, e.detail.rest]), [[true, false], [true, true]]);

  p.focus();
  assert.equal(p.R.away, false, 'coming back wakes at once');
  assert.equal(p.R.rest, false);
  assert.equal(p.attrs.has('data-pinkie-away') || p.attrs.has('data-pinkie-rest'), false);
});

test('打盹: five idle minutes in the foreground count too, any input wakes', () => {
  const p = page();
  p.advance(299000); p.R._evaluate();
  assert.equal(p.R.away, false);
  p.advance(2000); p.R._evaluate();
  assert.equal(p.R.rest, true);
  p.input();
  assert.equal(p.R.rest, false);
  p.advance(10000); p.R._evaluate();
  assert.equal(p.R.away, false, 'the idle clock restarted');
});

test('打盹: 碧琪 working keeps the buddy awake even while nobody watches', () => {
  const p = page();
  p.blur();
  p.advance(60000); p.R._evaluate();
  assert.equal(p.R.rest, true);
  p.setRunning(true);
  assert.equal(p.R.away, true, 'the ambient canvas stays frozen');
  assert.equal(p.R.rest, false, 'the buddy and status animations move');
  p.advance(60000);
  p.setRunning(false);
  assert.equal(p.R.rest, false, 'no nap right as the turn ends');
  p.advance(31000); p.R._evaluate();
  assert.equal(p.R.rest, true);
});

test('打盹: only endless animations and looping videos pause, and they come back', () => {
  const p = page();
  const loop = p.animation(Infinity), once = p.animation(1);
  p.blur();
  p.advance(60000); p.R._evaluate();
  assert.equal(loop.playState, 'paused');
  assert.equal(once.playState, 'running', 'an enter/leave animation is left to finish');
  const late = p.animation(Infinity);
  p.R._evaluate();
  assert.equal(late.playState, 'paused', 'a loop that appears during the nap stops too');
  assert.equal(p.R.inspect().pausedLoops, 2);
  p.focus();
  assert.equal(loop.playState, 'running');
  assert.equal(late.playState, 'running');
  assert.equal(p.R.inspect().pausedLoops, 0);
});

test('打盹: never with 减少动效, a hidden page, the splash or a mode transition', () => {
  for (const setup of [
    (p) => { p.state.reduce = true; },
    (p) => { p.state.hidden = true; },
    (p) => { p.ids.add('laolao-splash'); },
    (p) => { p.attrs.add('data-laolao-mode-pending'); },
  ]) {
    const p = page();
    setup(p);
    p.blur();
    p.advance(120000); p.R._evaluate();
    assert.equal(p.R.away, false);
    assert.equal(p.R.rest, false);
  }
});

test('自动减负: three stuttering 5s windows step down once, a calm minute steps back', () => {
  const p = page();
  assert.equal(p.R.level, 0);
  p.run(1, 16);
  p.run(52, 200); // two windows of slow frames
  assert.equal(p.R.level, 0, 'two bad windows are not enough');
  p.run(26, 200);
  assert.equal(p.R.level, 1);
  assert.deepEqual({...p.T.easing}, {'effects.ambientFps': 20, 'render.pixelRatio': 'low'});
  assert.ok(p.attrs.has('data-pinkie-easing'));
  assert.equal(p.said.length, 1, '碧琪 says so once');
  assert.match(p.said[0], /进阶调节/);

  p.run(78, 200);
  assert.equal(p.R.level, 2);
  assert.equal(p.T.easing['effects.particles'], 0.5);
  p.run(200, 200);
  assert.equal(p.R.level, 2, 'the ladder ends there: nothing is ever removed');
  assert.equal(p.said.length, 1);

  p.run(Math.ceil(66000 / 16), 16);
  assert.equal(p.R.level, 1, 'smooth for a minute: one step back');
  p.run(Math.ceil(66000 / 16), 16);
  assert.equal(p.R.level, 0);
  assert.deepEqual({...p.T.easing}, {});
  assert.equal(p.attrs.has('data-pinkie-easing'), false);
});

test('自动减负: a single long hitch or a mostly smooth window changes nothing', () => {
  const p = page();
  p.run(1, 16);
  for (let i = 0; i < 12; i += 1) { p.run(1, 2000); p.run(190, 16); }
  assert.equal(p.R.level, 0);
});

test('自动减负: off, or off the 标准 level, restores everything at once', () => {
  const p = page();
  p.run(1, 16); p.run(78, 200);
  assert.equal(p.R.level, 1);
  p.T.setAuto(false);
  assert.equal(p.R.level, 0);
  p.run(200, 200);
  assert.equal(p.R.level, 0, 'and it stays off');

  const q = page();
  q.run(1, 16); q.run(78, 200);
  assert.equal(q.R.level, 1);
  q.T.setLevel('max');
  assert.equal(q.R.level, 0);
});

test('自动减负: nothing is measured in the background', () => {
  const p = page({focused: false});
  assert.equal(p.run(1, 16), false, 'no frame probe without focus');
  p.focus();
  assert.equal(p.run(1, 16), true);
});

test('rest reads no hardware, loads before the scripts that ask it, and both canvases obey', () => {
  const source = read('ui/injections/laolao-rest.js');
  assert.doesNotMatch(source, /hardwareConcurrency|deviceMemory|navigator\.gpu|WEBGL_debug_renderer_info|getBattery|matchMedia/);
  const head = read('ui/injections/laolao-head.fragment.html');
  const scripts = [...head.matchAll(/<script[^>]*src="\/([^"?]+)/g)].map((m) => m[1]);
  const rest = scripts.indexOf('laolao-rest.js');
  assert.ok(rest > scripts.indexOf('laolao-tuning.js'));
  for (const later of ['laolao-power-settings.js', 'laolao-buddy-rig.js', 'laolao-companion.js']) assert.ok(rest < scripts.indexOf(later), later);
  const rig = read('ui/injections/laolao-buddy-rig.js');
  assert.match(rig, /!window\.__pinkieRest\?\.rest\) \{ this\.last = 0;/, 'the rig does not start a frame while resting');
  assert.match(rig, /removeEventListener\("pinkie:rest-change", this\.onVis\)/, 'and unhooks on destroy');
  const companion = read('ui/injections/laolao-companion.js');
  assert.match(companion, /window\.__pinkieRest\?\.away && canvas && canvas\.parentElement === card/, 'the ambient canvas freezes in place');
  assert.match(companion, /addEventListener\("pinkie:rest-change", sync\)/);
  const power = read('ui/injections/laolao-power-settings.js');
  assert.match(power, /kind: "auto", title: "卡的时候自动减负"/);
  assert.match(power, /T\(\)\?\.setAuto\(value\)/);
});
