// B11 无限模式输入区「脱敏」触发钮日间静息态看不清的真页面复发测试（macdev5 实测字 2.98~3.02、图标 3.02~3.04）。
// 根：钮在输入盒第 2 行、背景透明，静息态吃共用的 var(--fog-muted)（--muted #9c6177 再 88% 透明），压在粉雾上不够；
// 修法是日间给这颗钮把 --fog-muted 换成 --muted-strong（#814a61），夜间不动，开启态的 --accent 不动。
// 测法：真装的 Control UI，home-unrestricted 进空会话 × 1440 / 820 × 日 / 夜，按截图像素量字（≥4.5）和图标（≥3）。
// 反例：旧色直接注到被量的钮上并关掉 color 过渡，日间最差那格必须 < 4.5。PINKIE_VISUAL_ENGINE=webkit 走 WebKit。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  resolveRealEngine,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {measureBtn, openDesensitizeBtn, revertBtnColor} from './visual/lib/desensitize-btn-contrast.mjs';

test('无限模式「脱敏」钮静息态字 ≥ 4.5、图标 ≥ 3；日间注回旧色最差那格必须 < 4.5', async (t) => {
  const engine = resolveRealEngine();
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
  browser = await launchRealBrowser(engine);

  const oldWorst = [];
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await t.test(`${engine} ${theme} ${width}`, async () => {
        const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'home-unrestricted', theme);
        try {
          await page.setViewportSize({width, height: 900});
          await openDesensitizeBtn(page);
          const now = await measureBtn(page);
          t.diagnostic(`现在 ${JSON.stringify(now)}`);
          assert.ok(!now.missing, `有「脱敏」钮（mode=${now.mode}）`);
          assert.equal(now.mode, 'unrestricted');
          assert.equal(now.night, theme === 'night');
          assert.equal(now.hover || now.pressed, false, '量的是静息态，不是悬停 / 开启');
          assert.ok(now.textShown, '「脱敏」两个字显示着');
          assert.ok(now.textPx.ratio >= 4.5, `字 ${now.textPx.ratio} ≥ 4.5（${JSON.stringify(now.textPx)}）`);
          assert.ok(now.iconPx?.ratio >= 3, `图标 ${now.iconPx?.ratio} ≥ 3（${JSON.stringify(now.iconPx)}）`);
          if (theme === 'day') {
            const tag = await revertBtnColor(page);
            const old = await measureBtn(page);
            t.diagnostic(`旧色 ${JSON.stringify(old)}`);
            oldWorst.push({width, ratio: old.textPx.ratio});
            await tag.evaluate((n) => n.remove());
          }
          assert.deepEqual(pageErrors, [], '页面没有报错');
        } finally {
          await context.close();
        }
      });
    }
  }
  const worst = oldWorst.reduce((a, b) => (b.ratio < a.ratio ? b : a), {ratio: Infinity});
  t.diagnostic(`旧色最差 ${JSON.stringify(worst)}`);
  assert.equal(oldWorst.length, 2, '日间两个宽度都量了旧色');
  assert.ok(worst.ratio < 4.5, `反例：旧色最差那格必须 < 4.5（${JSON.stringify(oldWorst)}）`);
});
