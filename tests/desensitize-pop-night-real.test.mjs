// 脱敏浮窗日夜对比度的真页面复发测试（B11，#96 mac-coord 派单）。
// 根：浮窗夜间规则只认 html[data-theme-mode="dark"]，碧琪夜间（data-pinkie-night）下仍是亮底；浮窗里的下拉 / 输入框 /
// 按钮边框是 .16~.28 的浅色细线，placeholder、状态字、「填入」白字对底也都不到 4.5。
// 测法：真装的 Control UI，home-unrestricted × 1440 / 820 × 日 / 夜，点开浮窗量字（≥ 4.5）和边框（≥ 3）（量法见 desensitize-pop-contrast.mjs）。
// 夜间另测只留 data-pinkie-night、拿掉 data-theme-mode 时浮窗仍是深底且达标。反例：注回旧色并关掉过渡，必须量出不达标。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {
  BORDER_PARTS, OUTSIDE_ONLY, POP, REVERT_MUST_FAIL, TEXT_PARTS,
  measurePop, openDesensitizePop, popLightWithNightAttrOnly, revertPopColors,
} from './visual/lib/desensitize-pop-contrast.mjs';

const ARGS = {pop: POP, text: TEXT_PARTS, border: BORDER_PARTS, outsideOnly: OUTSIDE_ONLY};
const need = (name) => (name in BORDER_PARTS ? 3 : 4.5);

function assertAllPass(m, label) {
  for (const name of [...Object.keys(TEXT_PARTS), ...Object.keys(BORDER_PARTS)]) {
    assert.ok(m[name], `${label} 浮窗里有 ${name}`);
    assert.ok(m[name].ratio >= need(name), `${label} ${name} 对比度 ${m[name].ratio} ≥ ${need(name)}（${JSON.stringify(m[name])}）`);
  }
}

// 浮窗位置是点开那一刻按窗口宽度算的，所以每换一次宽度都先关掉再重新点开。
async function reopenAt(page, width) {
  await page.setViewportSize({width, height: 800});
  if (await page.evaluate((sel) => !!document.querySelector(sel), POP)) {
    await page.keyboard.press('Escape');
    await page.waitForFunction((sel) => !document.querySelector(sel), POP, {timeout: 3_000});
  }
  await openDesensitizePop(page);
}

test('脱敏浮窗的字 ≥ 4.5、下拉 / 输入框 / 按钮边框 ≥ 3，日夜都达标且夜间认 data-pinkie-night；注回旧色必须不达标', async (t) => {
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

  // 同一个 theme 只开一次页：先量 1440 / 820 正例，再注一次旧色量 1440 / 820 反例，页面加载与网关握手 4 → 2。
  for (const theme of ['day', 'night']) {
    await t.test(theme, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'home-unrestricted', theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-pinkie-night')), theme === 'night', 'data-pinkie-night 和场景日夜一致');
        const label = theme === 'day' ? '日间' : '夜间';
        for (const width of [1440, 820]) {
          await reopenAt(page, width);
          const now = await page.evaluate(measurePop, ARGS);
          t.diagnostic(`${width} ${theme} 现在 ${JSON.stringify(now)}`);
          assertAllPass(now, `${width} ${label}`);
          if (theme !== 'night') continue;
          assert.ok(now.popLuminance < 0.1, `${width} 夜间浮窗是深底（亮度 ${now.popLuminance}）`);
          const only = await page.evaluate(popLightWithNightAttrOnly, POP);
          assert.equal(only.light, false, `${width} 只留 data-pinkie-night 时浮窗仍是深底（${only.bg}）`);
          const prev = await page.evaluate(() => document.documentElement.getAttribute('data-theme-mode'));
          await page.evaluate(() => document.documentElement.removeAttribute('data-theme-mode'));
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme-mode')), false, `${width} 量的时候确实没有 data-theme-mode`);
          const nightOnly = await page.evaluate(measurePop, ARGS);
          t.diagnostic(`${width} 只留 data-pinkie-night ${JSON.stringify(nightOnly)}`);
          assertAllPass(nightOnly, `${width} 只留 data-pinkie-night`);
          assert.ok(nightOnly.popLuminance < 0.1, `${width} 只留 data-pinkie-night 时浮窗是深底（亮度 ${nightOnly.popLuminance}）`);
          if (prev !== null) await page.evaluate((v) => document.documentElement.setAttribute('data-theme-mode', v), prev);
        }
        await revertPopColors(page, theme);
        for (const width of [1440, 820]) {
          await reopenAt(page, width);
          await page.waitForFunction((sel) => getComputedStyle(document.querySelector(sel).querySelector('.ds-status')).color === 'rgba(87, 54, 74, 0.52)', POP, {timeout: 3_000});
          const reverted = await page.evaluate(measurePop, ARGS);
          t.diagnostic(`${width} ${theme} 注回旧色 ${JSON.stringify(reverted)}`);
          for (const name of REVERT_MUST_FAIL) assert.ok(reverted[name].ratio < need(name), `反例：旧色下 ${width} ${label} ${name} 必须 < ${need(name)}（实际 ${reverted[name].ratio}）`);
        }
        assert.deepEqual(pageErrors, [], '页面没有报错');
      } finally {
        await context.close();
      }
    });
  }
});
