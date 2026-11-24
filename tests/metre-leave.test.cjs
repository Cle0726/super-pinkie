// 11-24 第 4 轮：Metre ⇄ 碧琪 来回切换。Metre → 碧琪 先播 Metre 离场，离场 covered 之后才播目标模式原来的转场，
// 碧琪转场盖住之后才拿掉 Metre 谱纸、才动路由；碧琪五个模式互相切换时不播 Metre 离场；减少动效时离场不做、退回原来的行为。
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
  const log = [], exit = deferred(), fx = deferred();
  const window = {
    location: {href: `http://127.0.0.1/chat?session=agent:${from}:main`},
    PinkieMetreTransition: {
      play: () => null,
      leave: () => {
        log.push('leave');
        return reduce ? null : {covered: exit.promise.then(() => log.push('leave-covered')), release: () => log.push('release')};
      },
    },
    PinkieModeTransitionFx: {
      play: (m) => {
        log.push(`fx:${m.id}`);
        return {overlay: {dataset: {}}, ready: Promise.resolve(), covered: fx.promise.then(() => log.push('fx-covered')), waiting() {}, abort() {}, finish: async () => {}};
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
  return {log, exit, fx, switchMode: api.switchMode};
}

test('Metre → each Pinkie mode: the Metre exit plays first; the route waits for exit covered and then the target transition covered', async () => {
  for (const id of PINKIE) {
    const h = harness('metre');
    const done = h.switchMode(mode(id));
    await flush();
    assert.deepEqual(h.log, ['leave'], `${id}: only the Metre exit is on screen; nothing stacked, no route yet`);
    h.exit.resolve(); await flush();
    assert.deepEqual(h.log, ['leave', 'leave-covered', `fx:${id}`], `${id}: the Pinkie transition starts after the exit is covered`);
    h.fx.resolve(); await done;
    assert.deepEqual(h.log, ['leave', 'leave-covered', `fx:${id}`, 'fx-covered', 'release', 'route', 'finish'],
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
