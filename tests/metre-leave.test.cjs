// 11-24 第 4 轮：Metre ⇄ 碧琪 来回切换。Metre → 碧琪 先播 Metre 离场；第 5 轮起目标模式原来的转场和离场同时开始备贴图，
// 到离场的 handoff.hold 那一拍才起（引子只留 handoff.intro），碧琪转场盖住之后才拿掉 Metre 谱纸、才动路由；
// 碧琪五个模式互相切换时不播 Metre 离场、转场拿到的参数和原来一样；减少动效时离场不做、退回原来的行为。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-mode-switcher.js'), 'utf8');
const part = (first, last) => {
  const from = source.indexOf(first), to = source.indexOf(last, from);
  assert.ok(from >= 0 && to > from, first);
  return source.slice(from, to);
};
const play = part('  const playModeTransition = async', '  const navigateWithinApp =');
const switchMode = part('  const switchMode = async', '\n  };\n') + '\n  };\n';
const PINKIE = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];
const mode = (id) => ({id, label: id, phrases: ['…'], readyPhrase: id, transition: '', sessionKey: `agent:${id}:main`});
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return {promise, resolve}; };

function harness(from, {reduce = false} = {}) {
  const log = [], exit = deferred(), cue = deferred(), fx = deferred(), seen = {};
  const window = {
    location: {href: `http://127.0.0.1/chat?session=agent:${from}:main`},
    PinkieMetreTransition: {
      play: () => null,
      leave: (to) => {
        log.push('leave'); seen.leaveTo = to;
        return reduce ? null : {covered: exit.promise, release: () => log.push('release'), handoff: {hold: cue.promise.then(() => log.push('cue')), intro: 100}};
      },
    },
    PinkieModeTransitionFx: {
      play: (m, hooks) => {
        log.push(`fx:${m.id}`); seen.hooks = hooks;
        const ready = hooks.hold ? hooks.hold.then(() => log.push('fx-start')) : Promise.resolve();
        return {overlay: {dataset: {}}, ready, covered: fx.promise.then(() => log.push('fx-covered')), waiting() {}, abort() {}, finish: async () => {}};
      },
    },
    dispatchEvent() {},
  };
  const context = {
    window, console, URL, Promise,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    activeMode: () => from, closeMenu() {}, ensureModeUnlocked: async () => true,
    resolveTargetSession: async (m) => `agent:${m.id}:main`, rememberSession() {}, currentSessionKey: () => `agent:${from}:main`,
    localStorage: {setItem() {}, getItem() {}}, sessionStorage: {setItem() {}, removeItem() {}},
    navigateWithinApp: () => { log.push('route'); return 'router'; },
    render() {}, launchSelectionBurst() {}, syncModePresentation() {}, flushPendingModePortraitFx() {},
    finishModeTransition: async () => { log.push('finish'); }, modeFxReduced: () => reduce,
    motion: {frames: async () => {}, enter() {}, modeAssets: () => Promise.resolve(), preload: () => Promise.resolve()},
    document: {documentElement: {setAttribute() {}}, querySelector: () => null},
  };
  const api = vm.runInNewContext(`let switching = false, metreExit = null, modeTransitionTargetId = null;
const storageKey = 'k', skipEntrySplashParam = 's', skipEntrySplashKey = 'sk', modeHandoffKey = 'mh';
${play}
${switchMode}
({switchMode});`, context);
  return {log, exit, cue, fx, seen, switchMode: api.switchMode};
}

test('Metre → each Pinkie mode: the exit plays first, the Pinkie transition loads meanwhile and starts on the handoff beat; the route waits for its covered', async () => {
  for (const id of PINKIE) {
    const h = harness('metre');
    const done = h.switchMode(mode(id));
    await flush();
    assert.deepEqual(h.log, ['leave', `fx:${id}`], `${id}: the Pinkie transition is asked for at once (to load its art), no route yet`);
    assert.equal(h.seen.hooks.intro, 100, `${id}: only the last 100ms of its lead-in are kept`);
    assert.equal(typeof h.seen.hooks.onExit, 'function');
    assert.equal(h.seen.leaveTo, id, `${id}: the exit knows where it is going`);
    h.cue.resolve(); await flush();
    assert.deepEqual(h.log, ['leave', `fx:${id}`, 'cue', 'fx-start'], `${id}: it starts on the handoff beat, still no route`);
    h.fx.resolve(); await done;
    assert.deepEqual(h.log, ['leave', `fx:${id}`, 'cue', 'fx-start', 'fx-covered', 'release', 'route', 'finish'],
      `${id}: the Metre paper is released under a covered Pinkie transition, then the route changes`);
  }
});

test('switching among the five Pinkie modes never plays the Metre exit', async () => {
  for (const from of PINKIE) for (const id of PINKIE) {
    if (from === id) continue;
    const h = harness(from);
    h.fx.resolve();
    await h.switchMode(mode(id));
    assert.deepEqual(h.log, [`fx:${id}`, 'fx-covered', 'route', 'finish'], `${from} → ${id}`);
    assert.deepEqual(Object.keys(h.seen.hooks), ['onExit'], `${from} → ${id}: the transition gets exactly the hooks it always got`);
  }
});

test('reduced motion: no Metre exit, the switch falls back to the previous behaviour', async () => {
  const h = harness('metre', {reduce: true});
  h.fx.resolve();
  await h.switchMode(mode('chat'));
  assert.deepEqual(h.log, ['leave', 'fx:chat', 'fx-covered', 'route', 'finish'], 'leave() declines (returns null) and nothing is released');
  const src = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-metre-transition.js'), 'utf8');
  assert.match(src, /function score\(label\) \{\n    if \(reduced\(\)\) return null;/, '进场和离场共用的谱纸在减少动效时都不画');
  assert.match(src, /window\.PinkieMetreTransition = Object\.freeze\(\{play, leave\}\);/);
});

test('handoff: the Pinkie transition holds its start for the cue and skips most of its lead-in; the fold of the paper collapses with the staff', () => {
  const fx = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-mode-transition-fx.js'), 'utf8');
  assert.match(fx, /let clock = Math\.max\(0, POP - \(hooks\.intro \?\? POP\)\),/, 'without hooks.intro the clock starts at 0 as before');
  assert.match(fx, /if \(hooks\.hold\) \{ await hooks\.hold; if \(destroyed\) throw new Error\('aborted'\); \}[\s\S]{0,400}root\.document\.body\.append\(ui\.overlay\);/, 'nothing is shown before the cue');
  const src = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-metre-transition.js'), 'utf8');
  const [, cue, intro] = /CUE = (\d+), INTRO = (\d+);/.exec(src).map(Number);
  const gone = Number(/GONE = (\d+)/.exec(src)[1]);
  assert.ok(cue + intro <= gone && cue + intro >= gone - 80, 'the reveal begins just before the score clears: no empty stage between them');
  assert.ok(gone - cue <= 150, 'the two overlap by at most ~150ms');
  assert.match(src, /intro: to === 'unrestricted' \? 0 : INTRO/, '无限制的彩虹斜切从角上细细地起：不留引子');
  assert.match(src, /if \(k < 1\) box\(a, y0 === 0 \? mid - 1 : mid, W - 2 \* a, 1, C\.dim\);/, '中缝和五线一起收掉');
  assert.match(source, /if \(metreExit\) \{ try \{ await metreExit\.covered; \} catch \{\} \}[^\n]*\n    return new Promise/, 'without the graphics transition the old overlay still waits for the exit to clear');
});
