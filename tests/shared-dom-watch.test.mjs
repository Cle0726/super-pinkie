// M3-2 verification:
// 1. Static check via tools/health/measure.mjs: only ui/injections/laolao-dom-watch.js
//    may have subtreeObserverCalls > 0, and the page-wide total is exactly 1.
// 2. Runtime browser check: instrument window.MutationObserver before page load,
//    load laolao-dom-watch.js plus representative migrated injection scripts,
//    and assert only 1 real subtree MutationObserver is ever created while
//    domWatch subscribers receive live DOM mutations.
import assert from 'node:assert/strict';
import test from 'node:test';
import {measure} from '../tools/health/measure.mjs';
import {
  REPO_ROOT,
  launchVisualBrowser,
  startVisualServer,
} from './visual/lib/harness.mjs';

test('M3-2 static: exactly 1 subtree MutationObserver call remains in ui/injections (laolao-dom-watch.js)', async () => {
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

test('M3-2 runtime: live browser page creates exactly 1 subtree MutationObserver across migrated modules', async () => {
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
    await page.goto(`${server.origin}/scene?id=home-project`, {waitUntil: 'networkidle'});

    // Load representative migrated injection scripts that previously each created subtree observers
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
      handle.disconnect();
      return {
        runtime: window.__m3RuntimeStats,
        domWatchStats: window.Pinkie.domWatch.stats(),
        received,
      };
    });

    assert.equal(
      result.runtime.subtreeObserveCalls,
      1,
      `expected exactly 1 runtime subtree observe() call, got ${JSON.stringify(result.runtime)}`,
    );
    assert.equal(result.domWatchStats.observerCount, 1);
    assert.ok(result.received >= 1, `expected shared domWatch subscriber to receive DOM mutation, got ${result.received}`);
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
