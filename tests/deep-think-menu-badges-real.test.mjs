// 深度思考档位卡角标与边框对比度的真页面复发测试（B11·T3 / T4）。
// 根：罗马数字角标和「推荐 / 长时」角标是白字压在 accent 混白的浅底上，四档都 < 4.5；
// 档位卡边框是 rgba(255,255,255,.28)，日间几乎看不见（≈1.0），夜间也 < 3。
// 测法：真装的 Control UI，home-thinking × 1440 / 820 × 日 / 夜，点开菜单，非 hover、非选中的档位卡逐个量（量法见 deep-think-badges-contrast.mjs）：
// 角标白字对角标底 ≥ 4.5；卡边框对卡底、对面板底都 ≥ 3。反例：注回旧底色和旧白边框，角标必须 < 4.5、边框必须 < 3。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {openDeepThinkMenu} from './visual/lib/deep-think-menu-contrast.mjs';
import {measureBadges, revertBadgeColors, settleTierItems} from './visual/lib/deep-think-badges-contrast.mjs';

test('档位卡罗马数字 / 推荐角标白字 ≥ 4.5、卡边框 ≥ 3（日夜）；注回旧底色与旧白边框必须量出不达标', async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      try { await server?.close(); }
      finally { installed.cleanup(); }
    }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const width of [1440, 820]) {
    for (const theme of ['day', 'night']) {
      await t.test(`${width} ${theme}`, async () => {
        const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'home-thinking', theme);
        try {
          await page.setViewportSize({width, height: 800});
          await page.waitForSelector('.laolao-deep-think-btn', {timeout: 15_000});
          assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-pinkie-night')), theme === 'night', 'data-pinkie-night 和场景日夜一致');
          t.diagnostic(`data-laolao-mode=${await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'))}`);
          await openDeepThinkMenu(page);
          await settleTierItems(page);
          const now = await page.evaluate(measureBadges);
          t.diagnostic(`${width} ${theme} 现在 ${JSON.stringify(now)}`);
          const tiers = Object.keys(now);
          assert.ok(tiers.length >= 3, `至少量到 3 张非选中档位卡（实际 ${tiers.join(',')}）`);
          assert.ok(tiers.some((k) => now[k].recommended), '至少一张卡有推荐 / 长时角标');
          for (const [tier, row] of Object.entries(now)) {
            assert.ok(row.numeral, `${tier} 有罗马数字角标`);
            for (const name of ['numeral', 'recommended']) if (row[name]) assert.ok(row[name].ratio >= 4.5, `${theme} ${tier} ${name} ${row[name].ratio} ≥ 4.5（${JSON.stringify(row[name])}）`);
            assert.ok(row.border.ratio >= 3, `${theme} ${tier} 边框 ${row.border.ratio} ≥ 3（${JSON.stringify(row.border)}）`);
          }
          await revertBadgeColors(page);
          const reverted = await page.evaluate(measureBadges);
          t.diagnostic(`${width} ${theme} 注回旧色 ${JSON.stringify(reverted)}`);
          for (const [tier, row] of Object.entries(reverted)) {
            for (const name of ['numeral', 'recommended']) if (row[name]) assert.ok(row[name].ratio < 4.5, `反例：旧底色下 ${theme} ${tier} ${name} 必须 < 4.5（实际 ${row[name].ratio}）`);
            assert.ok(row.border.ratio < 3, `反例：旧白边框下 ${theme} ${tier} 边框必须 < 3（实际 ${row.border.ratio}）`);
          }
          assert.deepEqual(pageErrors, [], '页面没有报错');
        } finally {
          await context.close();
        }
      });
    }
  }
});
