// Plan B §2 + §4: the run-status bar above the composer.
// The bar's wording and layout decisions are a pure model (describe / layoutFor /
// durations) so every state can be checked without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const JS = 'ui/injections/laolao-run-status.js';
const CSS = 'ui/injections/laolao-run-status.css';

function load() {
  const store = new Map();
  const listeners = {};
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {}, dispatchEvent() { return true; },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame() { return 0; },
    matchMedia() { return {matches: false, addEventListener() {}}; },
    innerWidth: 1280, innerHeight: 820,
    location: {href: 'http://127.0.0.1/chat?session=agent%3Aproject%3Adashboard%3Ax'},
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const document = {
    readyState: 'loading', hidden: false,
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { throw new Error('the model must not touch the DOM'); },
    documentElement: {dataset: {}},
  };
  window.localStorage = localStorage;
  vm.runInNewContext(read(JS), {
    window, document, localStorage, console, URL, Map, Set, WeakMap, Date, Math, JSON, Promise,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
  }, {filename: 'laolao-run-status.js'});
  return {api: window.__pinkieRunStatus, store, listeners, window};
}

const T0 = 1_800_000_000_000;
const base = (over = {}) => ({
  now: T0 + 30_000,
  conn: {online: true, attempt: 0},
  live: {active: true, state: 'thinking', startedAt: T0},
  status: null, plan: null, durations: {}, phaseSince: T0,
  ...over,
});

const FORBIDDEN = /\b(?:base|boost|full|marathon|tier|review|supersede)\b|门禁|续跑|合同|裁决|R\d|#\d/i;
const hanLength = (text) => [...String(text).replace(/\s/g, '')].length;

test('the run-status files exist and expose a pure model', () => {
  assert.ok(fs.existsSync(path.join(ROOT, JS)), 'laolao-run-status.js is missing');
  assert.ok(fs.existsSync(path.join(ROOT, CSS)), 'laolao-run-status.css is missing');
  const {api} = load();
  for (const name of ['describe', 'layoutFor', 'median', 'recordDuration', 'duration']) {
    assert.equal(typeof api?.[name], 'function', `__pinkieRunStatus.${name}`);
  }
});

test('each phase reads as plain Pinkie language', () => {
  const {api} = load();
  const cases = [
    ['plan steps', base({live: {active: true, state: 'working', startedAt: T0}, plan: {items: [
      {id: 'a', text: '读需求', status: 'completed'}, {id: 'b', text: '写页面', status: 'completed'},
      {id: 'c', text: '截图核对手机宽度', status: 'in_progress'}, {id: 'd', text: '写结论', status: 'pending'},
      {id: 'e', text: '打包', status: 'pending'}, {id: 'f', text: '交付', status: 'pending'}]}}),
    /^在做第 3 步，共 6 步：截图核对手机宽度$/],
    ['background command', base({now: T0 + 5 * 60_000, live: {active: true, state: 'working', startedAt: T0,
      bg: {startedAt: T0 + 60_000}}}), /^等后台命令（已跑 4 分钟）$/],
    ['independent copy', base({status: {active: true, phase: 'working', missing: ['独立起草 0/1'],
      continuations: {tier: 0}, review: {phase: 'idle'}}}), /^另做一版对照$/],
    ['reviewer', base({status: {active: true, phase: 'working', missing: ['看图审稿 0/1'],
      continuations: {tier: 0}, review: {phase: 'idle'}}}), /^审稿员在打开成品核对$/],
    ['delivery review', base({status: {active: true, phase: 'running', missing: [],
      continuations: {tier: 0}, review: {phase: 'reviewing'}}}), /^审稿员在打开成品核对$/],
    ['make-up step', base({status: {active: true, phase: 'coordinating', missing: ['还没看过手机宽度的截图'],
      continuations: {tier: 1}, review: {phase: 'idle'}}}), /^补做：手机宽度截图$/],
  ];
  for (const [name, input, expected] of cases) {
    const view = api.describe(input);
    assert.match(view.text, expected, name);
    assert.ok(hanLength(view.text) <= 22, `${name}: "${view.text}" is longer than 22 characters`);
    assert.doesNotMatch(view.text + ' ' + (view.meta || ''), FORBIDDEN, name);
    assert.ok(['thinking', 'working', 'writing', 'asking', 'done', 'oops'].includes(view.sticker), name);
    assert.ok(view.actions.some((a) => a.id === 'stop' && a.label === '停下'), `${name} offers 停下`);
  }
});

test('a plain thinking / working / writing run stays hidden: the process card already says it', () => {
  const {api} = load();
  for (const state of ['thinking', 'working', 'writing']) {
    const view = api.describe(base({live: {active: true, state, startedAt: T0}}));
    assert.equal(view.visible, false, state);
  }
});

test('elapsed time and the usual duration are real numbers, never placeholders', () => {
  const {api} = load();
  const plain = api.describe(base({now: T0 + 75_000}));
  assert.match(plain.meta, /已用 1 分 15 秒/);
  assert.doesNotMatch(plain.meta, /平时/);
  // Unknown start (page opened mid-run): no invented elapsed time.
  const unknown = api.describe(base({live: {active: true, state: 'thinking', startedAt: 0}}));
  assert.doesNotMatch(unknown.meta || '', /已用/);

  let durations = {};
  for (const ms of [60_000, 120_000, 180_000]) durations = api.recordDuration(durations, 'review', ms);
  const review = api.describe(base({durations, phaseSince: T0, now: T0 + 30_000,
    status: {active: true, phase: 'running', missing: [], continuations: {tier: 0}, review: {phase: 'reviewing'}}}));
  assert.match(review.meta, /平时约 2 分钟/);
});

test('only the last 20 runs feed the median', () => {
  const {api} = load();
  let d = {};
  for (let i = 1; i <= 25; i += 1) d = api.recordDuration(d, 'alt', i * 1000);
  assert.equal(d.alt.length, 20);
  assert.deepEqual(JSON.parse(JSON.stringify(d.alt.slice(0, 2))), [6000, 7000]);
  assert.equal(api.median(d.alt), 15500);
  assert.equal(api.median([]), 0);
});

test('three times longer than usual: say so and offer both ways out', () => {
  const {api} = load();
  let durations = {};
  for (const ms of [60_000, 60_000, 60_000]) durations = api.recordDuration(durations, 'review', ms);
  const view = api.describe(base({durations, phaseSince: T0, now: T0 + 4 * 60_000,
    status: {active: true, phase: 'running', missing: [], continuations: {tier: 0}, review: {phase: 'reviewing'}}}));
  assert.equal(view.text, '比平时久，还在跑');
  assert.equal(view.slow, true);
  assert.deepEqual(JSON.parse(JSON.stringify(view.actions.map((a) => a.label))), ['停下', '不等审稿，先交']);
});

test('waiting for the user: accent tone with the question itself and a button', () => {
  const {api} = load();
  const view = api.describe(base({live: {active: true, state: 'asking', startedAt: T0,
    ask: {text: '要把旧版本也删掉吗？'}}}));
  assert.equal(view.tone, 'ask');
  assert.equal(view.sticker, 'asking');
  assert.equal(view.text, '要把旧版本也删掉吗？');
  assert.ok(view.actions.some((a) => a.id === 'answer' && a.label === '去确认'));
});

test('disconnect shows the retry count and a reconnect never reads as finished', () => {
  const {api} = load();
  const offline = api.describe(base({conn: {online: false, attempt: 2}}));
  assert.equal(offline.text, '连接断了，正在重连（第 2 次）');
  assert.equal(offline.tone, 'warn');
  // While offline even an "ended" record must not claim the run is done.
  const unsure = api.describe(base({conn: {online: false, attempt: 1}, live: {active: false, startedAt: T0},
    ended: {outcome: 'done', at: T0 + 20_000}}));
  assert.notEqual(unsure.text, '完成啦！');
  // A run that ended long ago does not bring the bar back for a later disconnect.
  const idle = api.describe(base({now: T0 + 10 * 60_000, conn: {online: false, attempt: 1}, live: {active: false, startedAt: 0},
    ended: {outcome: 'done', at: T0}}));
  assert.equal(idle.visible, false);
  // Back online, the gateway says it is still running: keep showing a run.
  const resumed = api.describe(base({conn: {online: true, attempt: 0}, live: {active: false, startedAt: T0},
    status: {active: true, phase: 'running', missing: [], continuations: {tier: 0}, review: {phase: 'idle'}}}));
  assert.notEqual(resumed.kind, 'done');
  assert.notEqual(resumed.text, '完成啦！');
});

test('an outage survives a page reload: the snapshot is packed and read back', () => {
  const {api} = load();
  assert.equal(typeof api.packOffline, 'function');
  assert.equal(typeof api.unpackOffline, 'function');
  const raw = api.packOffline({key: 'agent:project:dashboard:x', runId: 'run-1', startedAt: T0}, T0 + 5_000);
  const back = api.unpackOffline(raw, T0 + 60_000);
  assert.deepEqual(JSON.parse(JSON.stringify(back)), {key: 'agent:project:dashboard:x', runId: 'run-1', startedAt: T0});
  // Stale, broken or foreign snapshots are ignored.
  assert.equal(api.unpackOffline(raw, T0 + 5_000 + 16 * 60_000), null);
  assert.equal(api.unpackOffline('{oops', T0), null);
  assert.equal(api.unpackOffline(JSON.stringify({key: 'not a session', at: T0}), T0), null);
  assert.equal(api.unpackOffline(null, T0), null);
});

test('a finished run leaves quietly; a stopped run says so briefly, then the bar leaves', () => {
  const {api} = load();
  const done = api.describe(base({live: {active: false, startedAt: 0}, ended: {outcome: 'done', at: T0 + 29_000}}));
  assert.equal(done.visible, false);
  const stopped = api.describe(base({live: {active: false, startedAt: 0}, ended: {outcome: 'stopped', at: T0 + 29_000}}));
  assert.equal(stopped.text, '这一轮停下来了');
  assert.equal(stopped.sticker, 'oops');
  const gone = api.describe(base({now: T0 + 120_000, live: {active: false, startedAt: 0}, ended: {outcome: 'done', at: T0}}));
  assert.equal(gone.visible, false);
});

test('narrow windows fold the bar into a dot', () => {
  const {api} = load();
  assert.equal(api.layoutFor(519), 'dot');
  assert.equal(api.layoutFor(480), 'dot');
  assert.equal(api.layoutFor(520), 'bar');
  assert.equal(api.layoutFor(1280), 'bar');
});

test('wired into the shared entry, native send path untouched, calm motion', () => {
  const head = read('ui/injections/laolao-head.fragment.html');
  assert.match(head, /laolao-run-status\.css\?v=/);
  assert.match(head, /laolao-run-status\.js\?v=/);
  const js = read(JS);
  assert.doesNotMatch(js, /chat\.send|handleSendChat|sessions\.send/);
  assert.match(js, /pinkie\.run\.status/);
  assert.match(js, /pinkie:gateway-event/);
  const css = read(CSS);
  assert.doesNotMatch(css, /infinite/, 'no looping animation');
  for (const m of css.matchAll(/transition\s*:\s*([^;]+);/g)) {
    for (const part of m[1].split(',')) {
      const prop = part.trim().split(/\s+/)[0];
      assert.ok(['opacity', 'transform', 'none'].includes(prop), `transition on ${prop}`);
      const ms = /(\d*\.?\d+)(m?s)/.exec(part);
      if (ms) assert.ok((ms[2] === 's' ? Number(ms[1]) * 1000 : Number(ms[1])) <= 240, part);
    }
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /html\[data-pinkie-night\]/, "has a night variant");
});
