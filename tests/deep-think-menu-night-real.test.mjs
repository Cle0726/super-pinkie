// 夜间思考强度菜单字看不清的真页面复发测试（B11·T1，#362 走查）。
// 根：菜单容器带 role="menu"，夜间被 laolao-night.css 的通用浮层规则铺成深底；菜单里的标题、档位说明、提示、页脚
// 却写死日间深紫 rgba(87,54,74,…)，而 laolao-deep-think.js 原来唯一的夜间规则只认 data-theme-mode="dark"，
// 还被 night.css 的 !important 盖住，等于没有。
// 测法：真装的 Control UI，home-thinking × 1440 / 820 × 日 / 夜，点开菜单量四处字对底的对比度（量法见 deep-think-menu-contrast.mjs）。
// 夜间四处都要 ≥ 4.5；日间四处颜色必须和原来一样（本修复不碰日间）。反例：夜间注回旧日间深紫，必须量出 < 4.5。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {MENU_PARTS, measureMenu, openDeepThinkMenu, revertMenuColors} from './visual/lib/deep-think-menu-contrast.mjs';

const DAY_COLORS = {head: 'rgba(87, 54, 74, 0.72)', summary: 'rgba(87, 54, 74, 0.53)', hint: 'rgba(87, 54, 74, 0.62)', footer: 'rgba(87, 54, 74, 0.43)'};

test('夜间思考强度菜单的标题 / 档位说明 / 提示 / 页脚对深底 ≥ 4.5，日间颜色不变；注回旧日间色必须量出 < 4.5', async (t) => {
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
          await openDeepThinkMenu(page);
          const now = await page.evaluate(measureMenu, MENU_PARTS);
          t.diagnostic(`${width} ${theme} 现在 ${JSON.stringify(now)}`);
          for (const name of Object.keys(MENU_PARTS)) assert.ok(now[name], `菜单里有 ${name}`);
          if (theme === 'day') {
            for (const [name, color] of Object.entries(DAY_COLORS)) assert.equal(now[name].color, color, `日间 ${name} 颜色不变`);
          } else {
            for (const name of Object.keys(MENU_PARTS)) assert.ok(now[name].ratio >= 4.5, `夜间 ${name} 对比度 ${now[name].ratio} ≥ 4.5（${JSON.stringify(now[name])}）`);
            await revertMenuColors(page);
            const reverted = await page.evaluate(measureMenu, MENU_PARTS);
            t.diagnostic(`${width} ${theme} 注回旧色 ${JSON.stringify(reverted)}`);
            for (const name of Object.keys(MENU_PARTS)) assert.ok(reverted[name].ratio < 4.5, `反例：旧色下夜间 ${name} 必须 < 4.5（实际 ${reverted[name].ratio}）`);
          }
          assert.deepEqual(pageErrors, [], '页面没有报错');
        } finally {
          await context.close();
        }
      });
    }
  }
});
