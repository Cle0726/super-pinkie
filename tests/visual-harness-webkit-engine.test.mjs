import test from 'node:test';
import assert from 'node:assert/strict';

import {launchVisualBrowser} from './visual/lib/harness.mjs';

const CHROMIUM_ARGS = [
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--force-color-profile=srgb',
  '--num-raster-threads=1',
];

function fakePlaywright({chromiumFailsWithoutChannel = false} = {}) {
  const calls = [];
  const launcher = (name) => ({
    async launch(opts) {
      calls.push({name, opts});
      if (name === 'chromium' && chromiumFailsWithoutChannel && !opts.channel) {
        throw new Error('bundled chromium missing');
      }
      return {launchedBy: name};
    },
  });
  return {
    calls,
    pw: {chromium: launcher('chromium'), webkit: launcher('webkit'), firefox: launcher('firefox')},
  };
}

for (const engine of ['webkit', 'firefox']) {
  test(`launchVisualBrowser('${engine}') launches the real ${engine} engine without Chromium args`, async () => {
    const {calls, pw} = fakePlaywright({chromiumFailsWithoutChannel: true});
    const browser = await launchVisualBrowser(engine, pw);
    assert.equal(browser.launchedBy, engine);
    assert.deepEqual(calls, [{name: engine, opts: {headless: true}}]);
  });
}

test('default engine still launches bundled chromium with the stability args and no channel', async () => {
  const {calls, pw} = fakePlaywright();
  const browser = await launchVisualBrowser('', pw);
  assert.equal(browser.launchedBy, 'chromium');
  assert.deepEqual(calls, [{name: 'chromium', opts: {headless: true, args: CHROMIUM_ARGS}}]);
});

test('default engine still falls back to the chrome channel when bundled chromium fails', async () => {
  const {calls, pw} = fakePlaywright({chromiumFailsWithoutChannel: true});
  const browser = await launchVisualBrowser('', pw);
  assert.equal(browser.launchedBy, 'chromium');
  assert.deepEqual(calls, [
    {name: 'chromium', opts: {headless: true, args: CHROMIUM_ARGS}},
    {name: 'chromium', opts: {headless: true, args: CHROMIUM_ARGS, channel: 'chrome'}},
  ]);
});

for (const channel of ['msedge', 'chrome']) {
  test(`launchVisualBrowser('${channel}') still uses chromium with channel ${channel}`, async () => {
    const {calls, pw} = fakePlaywright();
    const browser = await launchVisualBrowser(channel, pw);
    assert.equal(browser.launchedBy, 'chromium');
    assert.deepEqual(calls, [{name: 'chromium', opts: {headless: true, args: CHROMIUM_ARGS, channel}}]);
  });
}

test('each engine label maps to the launcher that actually runs', async () => {
  const expected = {chromium: 'chromium', msedge: 'chromium', chrome: 'chromium', webkit: 'webkit', firefox: 'firefox'};
  for (const [engine, launcher] of Object.entries(expected)) {
    const {calls, pw} = fakePlaywright();
    await launchVisualBrowser(engine, pw);
    assert.deepEqual(calls.map((c) => c.name), [launcher], engine);
  }
});
