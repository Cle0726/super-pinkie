// M3 rework domWatch verification:
// Behavioral equivalence takes priority over M3-2 single runtime observer count.
// 1. Static check: ui/injections/laolao-dom-watch.js remains the single wrapper
//    module declaring observe({ ..., subtree: true }) in ui/injections.
// 2. Runtime browser check: laolao-dom-watch.js does not allocate an idle eager
//    root observer on load, returns genuine native MutationObserver instances
//    from createObserver(), and delivers live DOM mutations to migrated modules
//    and watchTree handles without page errors.
import assert from 'node:assert/strict';
import test from 'node:test';
import {measure} from '../tools/health/measure.mjs';
import {
  REPO_ROOT,
  launchVisualBrowser,
  startVisualServer,
} from './visual/lib/harness.mjs';

test('M3 domWatch static: only ui/injections/laolao-dom-watch.js declares subtree:true in ui/injections', async () => {
  const report = await measure(REPO_ROOT, {includeTestInventory: false});
  const holders = Object.entries(report.injections)
    .filter(([, metrics]) => metrics.subtreeObserverCalls > 0)
    .map(([file, metrics]) => ({file, count: metrics.subtreeObserverCalls}));
  assert.deepEqual(
    holders,
    [{file: 'ui/injections/laolao-dom-watch.js', count: 1}],
    `expected only ui/injections/laolao-dom-watch.js to call observe({subtree:true}), got ${JSON.stringify(holders)}`,
  );
  assert.equal(report.injectionTotals.subtreeObserverCalls, 1);
});

test('M3 domWatch runtime: no eager root observer, native MutationObserver instances, live delivery across migrated modules', async () => {
  const server = await startVisualServer();
  const browser = await launchVisualBrowser();
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const NativeMO = window.MutationObserver;
      window.__m3RuntimeStats = {totalCreated: 0, subtreeObserveCalls: 0};
      window.MutationObserver = class CountingMutationObserver extends NativeMO {
        constructor(cb) {
          super(cb);
          window.__m3RuntimeStats.totalCreated += 1;
        }
        observe(target, options) {
          if (options && options.subtree) {
            window.__m3RuntimeStats.subtreeObserveCalls += 1;
          }
          return super.observe(target, options);
        }
      };
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));

    // Blank page with ONLY laolao-dom-watch.js: must NOT create an idle eager root observer
    await page.goto(`${server.origin}/scene?id=home-project`, {waitUntil: 'networkidle'});
    const beforeScripts = await page.evaluate(() => ({
      domWatchStats: window.Pinkie.domWatch.stats(),
      isNativeInstance: window.Pinkie.domWatch.createObserver(() => {}) instanceof MutationObserver,
    }));
    assert.equal(beforeScripts.domWatchStats.createdObservers, 0, 'laolao-dom-watch.js must not eagerly allocate a root observer at load time');
    assert.equal(beforeScripts.isNativeInstance, true, 'createObserver() must return a genuine MutationObserver instance');

    // Load representative migrated injection scripts
    for (const script of [
      '/laolao-motion-preference.js',
      '/laolao-metre-skin.js',
      '/laolao-stream-fx.js',
      '/laolao-reading-view.js',
      '/laolao-side-layout.js',
    ]) {
      await page.addScriptTag({url: `${server.origin}${script}`});
    }

    const result = await page.evaluate(async () => {
      let received = 0;
      const handle = window.Pinkie.domWatch.watchTree(document.body, (records) => {
        received += records.length;
      }, {childList: true});
      const probe = document.createElement('div');
      probe.id = 'm3-live-probe';
      document.body.appendChild(probe);
      await new Promise((r) => setTimeout(r, 20));
      const receivedBeforeDisconnect = received;
      handle.disconnect();
      const probe2 = document.createElement('div');
      document.body.appendChild(probe2);
      await new Promise((r) => setTimeout(r, 20));
      return {
        runtime: window.__m3RuntimeStats,
        domWatchStats: window.Pinkie.domWatch.stats(),
        receivedBeforeDisconnect,
        receivedAfterDisconnect: received,
      };
    });

    assert.deepEqual(pageErrors, []);
    assert.ok(result.runtime.subtreeObserveCalls >= 1, `expected migrated modules to register native subtree observers, got ${JSON.stringify(result.runtime)}`);
    assert.ok(result.domWatchStats.createdObservers >= 1, `expected createdObservers >= 1, got ${JSON.stringify(result.domWatchStats)}`);
    assert.ok(result.receivedBeforeDisconnect >= 1, `expected watchTree subscriber to receive DOM mutation, got ${result.receivedBeforeDisconnect}`);
    assert.equal(result.receivedAfterDisconnect, result.receivedBeforeDisconnect, 'disconnect() must stop delivering mutations');
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
