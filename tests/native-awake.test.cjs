// N2 keep-awake (设计-N2.md): the shells hold the system awake while sessions
// run and let go when the page stops sending context for 120 s. So the page
// must keep sending while something runs, and stay quiet when nothing does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function load(sessions) {
  const sent = [];
  let poll = null;
  const listeners = {};
  const window = {
    pywebview: {api: {pinkieNative: (message) => { sent.push(message); return {ok: true}; }}},
    __laolaoSidebar: {mode: 'chat', gwRequest: async (method) => (method === 'sessions.list' ? {sessions: sessions()} : {})},
    Pinkie: {domWatch: {poll(fn) { poll = fn; }}},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent() {},
    location: {pathname: '/chat', search: '', hash: ''},
    localStorage: {getItem: () => null, setItem() {}},
  };
  const document = {
    hidden: false, title: '碧琪', readyState: 'complete',
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    hasFocus: () => true, createElement: () => ({style: {}, setAttribute() {}, append() {}}),
  };
  const context = vm.createContext({
    window, document, console, Date, JSON, Map, Set, Promise, URL, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: window.localStorage, location: window.location, CustomEvent: class {},
  });
  window.window = window;
  vm.runInContext(read('ui/injections/laolao-native.js'), context, {filename: 'laolao-native.js'});
  const contexts = () => sent.filter((m) => m.type === 'context');
  const tick = async () => { await poll(); await new Promise((r) => setImmediate(r)); };
  return {contexts, tick, hasPoll: () => typeof poll === 'function'};
}

test('while a session runs, every poll resends context (heartbeat for the shell lease)', async () => {
  const page = load(() => [{key: 'agent:main:a', label: '甲', hasActiveRun: true}]);
  assert.ok(page.hasPoll());
  await page.tick();
  await page.tick();
  await page.tick();
  assert.equal(page.contexts().length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(page.contexts()[2].running)), [{key: 'agent:main:a', title: '甲'}]);
});

test('counter-case: nothing running and nothing changed -> sent once, then quiet', async () => {
  const page = load(() => [{key: 'agent:main:a', label: '甲', status: 'done'}]);
  await page.tick();
  await page.tick();
  await page.tick();
  assert.equal(page.contexts().length, 1);
  assert.equal(page.contexts()[0].running.length, 0);
});

test('the run ending is reported once, then the page goes quiet again', async () => {
  let busy = true;
  const page = load(() => [{key: 'agent:main:a', label: '甲', hasActiveRun: busy}]);
  await page.tick();
  busy = false;
  await page.tick();
  await page.tick();
  assert.deepEqual(page.contexts().map((m) => m.running.length), [1, 0]);
});

test('both shells keep the system (not the display) awake under the same rules', () => {
  const win = read('app/windows_native.py');
  const mac = read('desktop/macos/pinkie/Sources/PinkieNative.swift');
  assert.match(win, /AWAKE_LEASE_S = 120\b/);
  assert.match(win, /AWAKE_CAP_S = 8 \* 3600\b/);
  assert.match(mac, /awakeLease: TimeInterval = 120\b/);
  assert.match(mac, /awakeCap: TimeInterval = 8 \* 3600\b/);
  assert.match(win, /AWAKE_DEFAULT = True\b/);
  assert.match(mac, /awakeDefault = true\b/);
  assert.doesNotMatch(win, /ES_DISPLAY_REQUIRED/);
  assert.match(mac, /beginActivity\(options: \[\.idleSystemSleepDisabled\]/);
  assert.doesNotMatch(mac, /idleDisplaySleepDisabled/);
  // Every begin has a matching end, and isolated UI tests never touch power state.
  assert.equal((mac.match(/beginActivity\(/g) || []).length, 1);
  assert.match(mac, /endActivity\(token\)/);
  assert.match(mac, /awakeSystem = ProcessInfo\.processInfo\.environment\["PINKIE_NATIVE_NO_SYSTEM"\] != "1"/);
  assert.match(mac, /let wanted = awakeSystem && awakeEnabled && !running\.isEmpty/);
  // Same message names on both shells.
  assert.match(win, /kind == "setAwake"/);
  assert.match(mac, /case "setAwake":/);
});
