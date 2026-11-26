// real-scene model-picker 截图就绪的复发测试（ui4，11-26，监工 10:57 / macdev2 #96 issuecomment-7200817506）。
// 根：tests/visual/lib/real-harness.mjs 的 model-picker 场景点开后只等菜单高 > 40 再死等 200ms，
// 没等回退目录（laolao-model-picker.js ensureFallbackData：chat.metadata + sessions.list）落地，
// 也没等列表排好；慢的 runner 上就会拍到半截 / 还在重排的列表（#302 0.5166%、#313 0.8530%）。
// 测法：真页面，用 opts.initScript 把 chat.metadata 的回包扣住（= 目录晚到），点开模型菜单：
//   ① 旧条件（菜单高 > 40）在目录没到时就成立 —— 证明旧写法会在就绪前截图；
//   ② 新的 waitModelPickerReady 在目录扣着时不返回（短超时要超时）；
//   ③ 放行回包后它返回，列表非空、data-pinkie-fallback-ready="1"，且返回的就是此刻菜单的样子。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
  waitModelPickerReady,
} from './visual/lib/real-harness.mjs';

const TRIGGER = 'details.chat-controls__model > summary, details.chat-controls__model-picker > summary';
const DETAILS = 'details.chat-controls__model[open], details.chat-controls__model-picker[open]';
const MENU = '.chat-controls__inline-select-menu--combined';

test('real model-picker scene waits for the async catalog and a still list before it is shot', {timeout: 300_000}, async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); } catch {}
    try { await server?.close(); }
    finally { installed.cleanup(); }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'home-project', 'day', {
    initScript: () => { window.__realHarnessHoldCatalog = true; },
  });
  try {
    await page.waitForSelector(TRIGGER, {timeout: 10_000});
    await page.click(TRIGGER);

    // ① 旧条件：只看菜单高度。目录还扣着，它照样成立。
    await page.waitForFunction(([d, m]) => {
      const menu = document.querySelector(d)?.querySelector(m);
      return Boolean(menu && menu.getBoundingClientRect().height > 40);
    }, [DETAILS, MENU], {timeout: 10_000});
    const before = await page.evaluate((d) => ({
      ready: document.querySelector(d)?.dataset.pinkieFallbackReady ?? null,
      held: (window.__realHarnessHeldCatalog || []).length,
    }), DETAILS);
    t.diagnostic(`old wait satisfied with ${JSON.stringify(before)}`);
    assert.ok(before.held >= 1, `the catalog request must be parked by the test hook (held=${before.held})`);
    assert.notEqual(before.ready, '1', 'old wait is satisfied before the catalog lands: main would shoot a list that is not ready');

    // ② 新等待：目录没到就不返回。
    await assert.rejects(waitModelPickerReady(page, {timeout: 1_500}), /timeout/i, 'new wait must not return while the catalog is still pending');

    // ③ 放行回包，新等待返回的是落地且静止的列表。
    await page.evaluate(() => {
      window.__realHarnessHoldCatalog = false;
      for (const reply of (window.__realHarnessHeldCatalog || []).splice(0)) reply();
    });
    const settled = await waitModelPickerReady(page);
    t.diagnostic(`settled ${JSON.stringify(settled).slice(0, 240)}`);
    assert.ok(settled && settled.options.length > 0, `settled list must have options: ${JSON.stringify(settled).slice(0, 200)}`);
    const after = await page.evaluate(([d, m]) => {
      const details = document.querySelector(d);
      return {ready: details?.dataset.pinkieFallbackReady, height: Math.round(details.querySelector(m).getBoundingClientRect().height)};
    }, [DETAILS, MENU]);
    assert.equal(after.ready, '1');
    assert.equal(after.height, settled.height, 'what the wait settled on is what is on screen');
    assert.deepEqual(pageErrors, [], '页面没有报错');
  } finally {
    await context.close();
  }
});
