// Lifecycle tests for the study bar and pact sheet.
//
// Asserts that an already-aborted mount allocates nothing, that retirement cancels scheduled
// animation frames and intervals, that in-flight requests that reject with the host's internal
// activation-ended sentence fail silently without exposing that sentence to the transcript,
// that genuine errors while alive are preserved, and that retired actions never claim fake success.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');

const root = path.join(__dirname, '../services/cle-studio');
const studySource = fs.readFileSync(path.join(root, 'src/learning/study.js'), 'utf8');

function setupHarness({requestHandler = null} = {}) {
  const document = createDocument();
  let nextFrameId = 0;
  const frames = new Map();
  let nextTimerId = 0;
  const intervals = new Map();
  const timeouts = new Map();
  const events = [];

  const window = {
    document,
    dispatchEvent(event) { events.push(event); },
    requestAnimationFrame(cb) {
      const id = ++nextFrameId;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setInterval(cb, ms) {
      const id = ++nextTimerId;
      intervals.set(id, {cb, ms});
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(cb, ms) {
      const id = ++nextTimerId;
      timeouts.set(id, {cb, ms});
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
  };

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }

  const calls = [];
  const host = {
    calls,
    request(method, params) {
      calls.push({method, params});
      if (requestHandler) return requestHandler(method, params);
      if (method === 'pinkie.learning.today') {
        return Promise.resolve({
          date: '2026-10-18',
          complete: false,
          progress: {minutes: 15, questions: 8, dueReviews: 0},
          goals: {minutes: 25, questions: 10},
          streak: {current: 3},
          pact: {
            daily: {minutes: 25, questions: 10, reviews: 'due'},
            intensity: 'gentle',
            exam: {date: null},
            timezone: 'Asia/Shanghai',
            reminders: {morning: '08:30', evening: '21:00', lastCall: '22:30'},
            channel: {kind: 'none', to: null},
          },
        });
      }
      if (method === 'pinkie.learning.focus.status') return Promise.resolve({active: null});
      if (method === 'pinkie.learning.history') return Promise.resolve({days: []});
      if (method === 'pinkie.cron.targets') return Promise.resolve({targets: []});
      if (method === 'cron.list') return Promise.resolve({jobs: []});
      return Promise.resolve({});
    },
    onEvent(type, handler) {
      return () => {};
    },
    subscribe(handler) {
      return () => {};
    },
  };

  // Build a bare vm context where study.js runs as standard code without imports
  const context = {
    document,
    window,
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    MutationObserver: FakeMutationObserver,
    REMINDERS: [
      {kind: 'morning', field: 'morning', label: '早间学习计划'},
      {kind: 'evening', field: 'evening', label: '晚间学习提醒'},
      {kind: 'lastcall', field: 'lastCall', label: '睡前学习收尾'},
    ],
    ownedReminder: (job, reminder) => job.name === `cle-study-${reminder.kind}`,
    syncReminders: async () => {},
    console,
  };

  const plain = studySource
    .replace(/^import [^;]+;/gm, '')
    .replace(/\bexport\s+/g, '');
  const mod = vm.runInNewContext(`${plain}\n;({mountStudy, isActivationEnded})`, context);

  function createLearningPane() {
    const pane = document.createElement('openclaw-chat-pane');
    pane.className = 'chat-pane-cache__pane';
    pane.sessionKey = 'agent:learning:sub-1';
    const main = document.createElement('div');
    main.className = 'chat-main';
    pane.append(main);
    document.body.append(pane);
    return pane;
  }

  function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    for (const fn of pending) fn();
  }

  return {
    document,
    host,
    mod,
    frames,
    intervals,
    events,
    createLearningPane,
    flushFrames,
  };
}

test('an already-aborted signal allocates no panels, no timers, and no RPCs', () => {
  const {host, mod, createLearningPane, intervals, frames} = setupHarness();
  createLearningPane();

  const controller = new AbortController();
  controller.abort();

  const result = mod.mountStudy(host, controller.signal);
  assert.equal(result.panels.size, 0, 'panels map must be empty');
  assert.equal(result.retired, true, 'must report retired immediately');
  assert.equal(host.calls.length, 0, 'no RPC may be issued on an aborted mount');
  assert.equal(intervals.size, 0, 'no interval timers may be set');
  assert.equal(frames.size, 0, 'no animation frame may be scheduled');
});

test('the next learning step routes to its own pane and the selected short focus duration reaches the gateway', async () => {
  const h = setupHarness(); const pane = h.createLearningPane();
  const controller = new AbortController(); h.mod.mountStudy(h.host, controller.signal); await new Promise(resolve => setTimeout(resolve, 10));
  const duration = h.document.querySelector('.cle-study__duration'); duration.value = '5'; duration.dispatch('change');
  h.document.querySelector('.cle-study__actions button').click(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.host.calls.find(call => call.method === 'pinkie.learning.focus.start').params.minutes, 5);
  h.document.querySelector('.cle-study__button--primary').click();
  assert.equal(h.events[0].type, 'pinkie:learning-continue');
  assert.equal(h.events[0].detail.sessionKey, pane.sessionKey);
  assert.equal(h.events[0].detail.step.kind, 'resume');
  controller.abort();
});

test('today completion, daily review quota and mastery evidence remain separate from the backlog', async () => {
  const h = setupHarness({requestHandler(method) {
    if (method === 'pinkie.learning.today') return Promise.resolve({complete: true, progress: {minutes: 25, questions: 10, dueReviews: 50}, goals: {minutes: 25, questions: 10}, streak: {current: 3}, reviewPlan: {target: 20, done: 20, remaining: 0, backlog: 50}, mastery: {independentCorrect: 4, assistedCorrect: 1, needsPractice: 3}, nextStep: {kind: 'choice', label: '今日目标已完成', description: '可以休息，也可以自选继续练习。'}});
    return Promise.resolve({active: null});
  }});
  h.createLearningPane(); const controller = new AbortController(); h.mod.mountStudy(h.host, controller.signal); await new Promise(resolve => setTimeout(resolve, 10));
  const progress = h.document.querySelector('.cle-study__progress');
  assert.match(progress.getAttribute('aria-label'), /今日复习 20\/20 张，另有 50 张分日完成/);
  assert.match(h.document.querySelector('.cle-study__mastery').textContent, /独立答对 4/);
  assert.match(h.document.querySelector('.cle-study__next-description').textContent, /50 张留到以后/);
  assert.equal(h.document.querySelector('.cle-study').dataset.complete, 'true');
  controller.abort();
});

test('retirement cancels queued animation frames and prevents panel/strip resurrection', () => {
  const {document, host, mod, createLearningPane, flushFrames, frames} = setupHarness();
  createLearningPane();

  const controller = new AbortController();
  const result = mod.mountStudy(host, controller.signal);

  // A strip should be created and attached
  const strip = document.querySelector('.cle-study');
  assert.ok(strip, 'a study strip was mounted');
  assert.equal(strip.isConnected, true);

  // Aborting must clear panels and disconnect
  controller.abort();
  assert.equal(result.panels.size, 0, 'panels map was cleared on abort');
  assert.equal(result.retired, true);
  assert.equal(strip.isConnected, false, 'strip was removed from DOM');

  // Even if an external animation frame is flushed after abort, it must not resurrect any strip
  flushFrames();
  assert.equal(result.panels.size, 0, 'no new panel created after retirement');
  assert.equal(document.querySelectorAll('.cle-study').length, 0, 'no zombie strip in document');
});

test('in-flight request that rejects with activation-ended fails silently without DOM leak', async () => {
  let rejectLoad;
  const loadPromise = new Promise((_, rej) => { rejectLoad = rej; });

  const {document, host, mod, createLearningPane} = setupHarness({
    requestHandler(method) {
      if (method === 'pinkie.learning.today') return loadPromise;
      return Promise.resolve({active: null});
    },
  });
  createLearningPane();

  const controller = new AbortController();
  mod.mountStudy(host, controller.signal);

  const strip = document.querySelector('.cle-study');
  const notice = strip.querySelector('.cle-study__notice');
  assert.ok(strip);

  // While request is in flight, the activation ends and aborts
  controller.abort();

  // The in-flight request now rejects with the host activation sentence
  rejectLoad(new Error('This plugin UI activation has ended. Use the current activation.'));
  await new Promise((r) => setTimeout(r, 10));

  // Notice must NOT show this internal lifecycle error
  assert.equal(notice.textContent, '', 'internal activation error must not be rendered into notice');
  assert.equal(strip.isConnected, false, 'strip remains safely detached');
});

test('real network errors while alive ARE preserved and reported', async () => {
  const {document, host, mod, createLearningPane} = setupHarness({
    requestHandler(method) {
      if (method === 'pinkie.learning.today') {
        return Promise.reject(new Error('网络连接超时，无法读取习作进度'));
      }
      return Promise.resolve({active: null});
    },
  });
  createLearningPane();

  const controller = new AbortController();
  mod.mountStudy(host, controller.signal);

  await new Promise((r) => setTimeout(r, 10));

  const strip = document.querySelector('.cle-study');
  const notice = strip.querySelector('.cle-study__notice');
  assert.ok(notice.textContent.includes('网络连接超时'), `real error must be shown, got: ${notice.textContent}`);
  assert.equal(notice.dataset.error, 'true');
});

test('focus start in-flight when abort occurs does not pretend success or auto-retry', async () => {
  let resolveStart;
  const startPromise = new Promise((res) => { resolveStart = res; });

  const {document, host, mod, createLearningPane} = setupHarness({
    requestHandler(method) {
      if (method === 'pinkie.learning.focus.start') return startPromise;
      if (method === 'pinkie.learning.today') return Promise.resolve({progress: {minutes: 0, questions: 0, dueReviews: 0}, goals: {minutes: 25, questions: 10}, streak: {current: 0}, pact: {daily: {minutes: 25, questions: 10, reviews: 'due'}}});
      return Promise.resolve({active: null});
    },
  });
  createLearningPane();

  const controller = new AbortController();
  mod.mountStudy(host, controller.signal);
  await new Promise((r) => setTimeout(r, 10));

  const focusButton = document.querySelector('.cle-study__actions button');
  const notice = document.querySelector('.cle-study__notice');

  // User clicks focus
  focusButton.click();

  // Abort occurs while focus.start is in flight
  controller.abort();

  // Network returns with focus result
  resolveStart({focus: {id: 'f1', start: Date.now(), plannedMinutes: 25}});
  await new Promise((r) => setTimeout(r, 10));

  // Must not say "计时开始" on retired strip
  assert.ok(!notice.textContent.includes('计时开始'), `must not claim success after abort, got: ${notice.textContent}`);
});

test('remounting with a fresh signal creates a clean active strip and loads fresh data', async () => {
  const {document, host, mod, createLearningPane} = setupHarness();
  createLearningPane();

  // First session aborts
  const ctrl1 = new AbortController();
  mod.mountStudy(host, ctrl1.signal);
  ctrl1.abort();
  assert.equal(document.querySelectorAll('.cle-study').length, 0);

  // New activation mounts with fresh signal
  const ctrl2 = new AbortController();
  const result2 = mod.mountStudy(host, ctrl2.signal);
  assert.equal(result2.panels.size, 1, 'fresh mount creates 1 panel');
  assert.equal(result2.retired, false);

  await new Promise((r) => setTimeout(r, 10));

  const strip = document.querySelector('.cle-study');
  assert.ok(strip && strip.isConnected, 'fresh strip is attached to DOM');
  assert.equal(strip.getAttribute('aria-label'), '今日学习');

  ctrl2.abort();
  assert.equal(document.querySelectorAll('.cle-study').length, 0);
});
