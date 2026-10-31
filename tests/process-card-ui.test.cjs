const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const script = read('ui/injections/laolao-process-card.js');
const css = read('ui/injections/laolao-process-card.css');
const toolStream = read('ui/injections/laolao-tool-stream.js');

test('the process card script only fills the renderer slots from live gateway events', () => {
  assert.match(script, /pinkie:gateway-event/);
  assert.match(script, /\[data-pinkie-thinking\]/);
  assert.match(script, /\[data-pinkie-status\]/);
  assert.match(script, /payload\.stream === "thinking"/);
  for (const state of ['thinking', 'working', 'writing', 'asking', 'done', 'oops']) {
    assert.match(script, new RegExp(`${state}: "`));
  }
  assert.match(script, /laolao-pinkie-status-\$\{state\}\.png/);
  // Thinking is not in chat.history, so it is kept per card and its key follows the history sync.
  assert.match(script, /laolao:process-thinking:v1/);
  assert.match(script, /__pinkieProcessKeep/);
  assert.match(script, /function migrateThinking/);
  assert.match(script, /publishRunState\(key, true\)/);
  assert.match(script, /slot\.dataset\.state === "oops"/);
  assert.match(toolStream, /window\.__pinkieActiveChatRuns/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /request\("chat\.send"/);
});

test('the card matches the original bubbles and respects reduced motion', () => {
  assert.match(css, /\.chat-group\.chat-group--process \{[\s\S]*?padding-left: 46px;/);
  assert.match(css, /linear-gradient\(135deg, rgba\(255, 253, 254, 0\.74\), rgba\(255, 247, 251, 0\.52\)\)/);
  assert.match(css, /\.pinkie-process\[data-live="1"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const source of [read('ui/injections/laolao-head.fragment.html'), read('installer/macos/apply-theme.sh'), read('installer/windows/apply-theme.ps1')]) {
    assert.match(source, /laolao-process-card\.css\?v=processcard6/);
    assert.match(source, /laolao-process-card\.js\?v=processcard12/);
  }
});

test('a thought that arrives in one chunk is typed out instead of popping in', () => {
  // Gemini thinks silently and then delivers the whole thought right before acting.
  assert.match(script, /const TYPE_CPS = 120, TYPE_MIN = 500, TYPE_MAX = 2500, TYPE_HURRY = 400, TYPE_HOLD = 1000;/);
  // A later chunk resumes from where the previous one stopped, so only the new
  // text is typed out instead of the whole thought popping in.
  assert.match(script, /typeOut\(key, Math\.max\(0, before - dropped\), record\.text\.length\)/);
  assert.match(script, /stopThinking\(\);\s*hurryTyping\(\);/);
  assert.match(script, /const visibleText = isTyping \? record\.text\.slice\(0, typed\) : record\.text;/);
  // Reduced motion collapses the type-out to zero duration instead of starting
  // a timer, so the thought is shown immediately rather than animating.
  assert.match(script, /typing\.set\(key, \{from: reduced\(\) \? length : from, to: length/);
  assert.match(script, /dur: reduced\(\) \? 0 :/);
  assert.match(css, /\.pinkie-thinking\.is-typing \.pinkie-thinking__text::after/);
  assert.match(css, /\.pinkie-thinking\.is-entering \{ animation:/);
});

function processHarness() {
  const frames = [], timers = [], listeners = new Map();
  let observer, globalScans = 0, preserved = 0;
  const pane = {requestUpdate() {}};
  const card = key => {
    const value = {dataset: {pinkieProcess: key}, isConnected: true, scans: 0,
      details: {open: true, live: false},
      matches: selector => selector === '.chat-group--process[data-pinkie-process]',
      closest: selector => selector === 'openclaw-chat-pane' ? pane
        : selector === '.chat-group--process[data-pinkie-process]' ? value : null,
      querySelector(selector) { return selector.includes('details.pinkie-process') && value.details.live ? value.details : null; },
      querySelectorAll() { value.scans += 1; return []; }};
    return value;
  };
  const older = card('pinkie:process:agent:main:test:old'), current = card('pinkie:process:agent:main:test:current');
  const document = {documentElement: {}, visibilityState: 'visible',
    querySelector: () => pane,
    querySelectorAll() { globalScans += 1; return [older, current]; },
    addEventListener(name, handler) { listeners.set(name, handler); }};
  const window = {addEventListener(name, handler) { listeners.set(name, handler); },
    __pinkieChatViewport: {preserve(target, change) { assert.equal(target, pane); preserved += 1; return change(); }}};
  const context = {window, document, location: {href: 'http://localhost/chat?session=agent%3Amain%3Atest'},
    localStorage: {getItem: () => '{}', setItem() {}},
    Image: class {}, URL, performance: {now: () => 1}, matchMedia: () => ({matches: true}),
    MutationObserver: class {constructor(callback) { observer = callback; } observe() {}},
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; }, cancelAnimationFrame() {},
    setTimeout(callback, ms) { timers.push({callback, ms}); return timers.length; }, clearTimeout() {}, setInterval() {}, console};
  vm.runInNewContext(script, context);
  const flush = () => { for (const callback of frames.splice(0)) callback(); };
  return {window, older, current, timers, flush, listeners,
    mutate: records => observer(records), get globalScans() { return globalScans; }, get preserved() { return preserved; }};
}

test('a streaming update visits the changed card without rescanning historical cards', () => {
  const h = processHarness();
  h.flush();
  const oldScans = h.older.scans, currentScans = h.current.scans, fullScans = h.globalScans;
  h.mutate([{target: h.current, addedNodes: [], removedNodes: []}]);
  h.flush();
  assert.equal(h.older.scans, oldScans);
  assert.ok(h.current.scans > currentScans);
  assert.equal(h.globalScans, fullScans);
  h.window.__laolaoProcessCard.run.key = h.current.dataset.pinkieProcess;
  h.window.__laolaoProcessCard.schedule();
  h.flush();
  assert.equal(h.older.scans, oldScans, 'typewriter frames keep historical cards untouched');
});

test('completion keeps a manually opened process card open', () => {
  const h = processHarness();
  h.flush();
  const run = h.window.__laolaoProcessCard.run;
  Object.assign(run, {key: h.current.dataset.pinkieProcess, session: 'agent:main:test', startedAt: Date.now()});
  h.current.details.live = true;
  h.window.__laolaoProcessCard.schedule();
  h.flush();
  h.listeners.get('pinkie:gateway-event')({detail: {event: 'agent', payload: {
    sessionKey: 'agent:main:test', stream: 'lifecycle', data: {phase: 'end'},
  }}});
  h.current.details.live = false;
  h.flush();
  assert.equal(h.current.details.open, true);
  assert.doesNotMatch(script, /details\.open\s*=\s*false/);
  assert.doesNotMatch(css, /transition:\s*(?:height|max-height)/);
  assert.doesNotMatch(css, /\.pinkie-process:not\(:has/, 'a lazy closed card must keep its summary visible');
});

test('removing an expired status pill preserves the chat viewport', () => {
  const h = processHarness();
  const classes = new Set();
  let removed = false;
  const pill = {classList: {contains: name => classes.has(name), add: name => classes.add(name)}, remove() { removed = true; }};
  const slot = {dataset: {}, closest: () => ({marker: true}), querySelector: () => pill};
  const pane = slot.closest();
  slot.closest = () => pane;
  h.window.__pinkieChatViewport.preserve = (target, change) => { assert.equal(target, pane); h.window.keptViewport = true; return change(); };
  h.current.querySelectorAll = selector => selector === '[data-pinkie-status]' ? [slot] : [];
  h.flush();
  const removal = h.timers.find(timer => timer.ms === 450);
  assert.ok(removal);
  removal.callback();
  assert.equal(removed, true);
  assert.equal(h.window.keptViewport, true);
});
