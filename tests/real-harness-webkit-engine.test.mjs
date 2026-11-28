// launchRealBrowser used to launch Chromium for every engine except msedge/chrome and still tag the
// browser with the requested engine, so PINKIE_VISUAL_ENGINE=webkit real-page tests and pr-shots
// silently ran on Chromium while reporting WebKit. A fake Playwright keeps this free of real browsers.
import assert from 'node:assert/strict';
import test from 'node:test';
import {launchRealBrowser, resolveRealEngine} from './visual/lib/real-harness.mjs';

function fakePlaywright() {
  const calls = [];
  const launcher = (name) => ({
    async launch(opts) {
      calls.push({name, opts});
      return {launchedBy: name};
    },
  });
  return {calls, pw: {chromium: launcher('chromium'), webkit: launcher('webkit'), firefox: launcher('firefox')}};
}

for (const engine of ['webkit', 'firefox']) {
  test(`${engine} launches the ${engine} browser, not Chromium`, async () => {
    const {calls, pw} = fakePlaywright();
    const browser = await launchRealBrowser(engine, pw);
    assert.deepEqual(calls, [{name: engine, opts: {headless: true}}]);
    assert.equal(browser.launchedBy, engine);
    assert.equal(browser.__pinkieEngine, engine);
  });
}

test('chromium keeps the pinned Chromium launch with its stability args and no channel', async () => {
  const {calls, pw} = fakePlaywright();
  const browser = await launchRealBrowser('chromium', pw);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'chromium');
  assert.equal(calls[0].opts.headless, true);
  assert.equal(calls[0].opts.channel, undefined);
  assert.ok(calls[0].opts.args.includes('--disable-gpu'));
  assert.ok(calls[0].opts.args.includes('--force-color-profile=srgb'));
  assert.equal(browser.__pinkieEngine, 'chromium');
});

for (const channel of ['msedge', 'chrome']) {
  test(`${channel} still goes through Chromium with channel ${channel}`, async () => {
    const {calls, pw} = fakePlaywright();
    const browser = await launchRealBrowser(channel, pw);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'chromium');
    assert.equal(calls[0].opts.channel, channel);
    assert.ok(calls[0].opts.args.includes('--disable-gpu'));
    assert.equal(browser.__pinkieEngine, channel);
  });
}

test('the engine tag always matches the launcher that actually ran', async () => {
  const actual = {webkit: 'webkit', firefox: 'firefox', chromium: 'chromium', msedge: 'chromium', chrome: 'chromium'};
  for (const [engine, launcher] of Object.entries(actual)) {
    const {calls, pw} = fakePlaywright();
    const browser = await launchRealBrowser(engine, pw);
    assert.equal(calls[0].name, launcher, `${engine} ran on ${calls[0].name}`);
    assert.equal(browser.launchedBy, launcher);
    assert.equal(browser.__pinkieEngine, engine);
  }
});

test('resolveRealEngine passes webkit and firefox through and defaults to chromium', () => {
  assert.equal(resolveRealEngine('webkit'), 'webkit');
  assert.equal(resolveRealEngine('firefox'), 'firefox');
  assert.equal(resolveRealEngine(''), 'chromium');
});
