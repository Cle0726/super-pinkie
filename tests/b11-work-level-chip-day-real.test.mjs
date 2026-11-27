// B11 项目模式「工作程度」chip 日间看不清的真页面复发测试（mac-coord 7222525019，mac2 7219007441 实测 3.28~4.03）。
// 根：chip 在输入盒外的第 2 行，压在 .card.chat::after 的雾色和模糊壁纸上，--muted-strong #4c7478 不够；
// 修法是项目模式日间默认态改用 --chat-text，小箭头 stroke:currentColor 跟着达标。
// 测法：真装的 Control UI，项目模式几个场景 × 1440 / 820 日间，按截图像素量字（≥4.5）和箭头（≥3）。
// 反例：页内注回 main 的旧色，最差那格必须 < 4.5。PINKIE_VISUAL_ENGINE=webkit 走 WebKit。
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
import {OLD_CHIP_CSS, measureChip, shot} from './visual/lib/work-level-chip-contrast.mjs';
import {playwright} from '../tools/study-desk/harness.mjs';

const SCENES = ['home-project', 'sidebar-collapsed', 'model-picker', 'long-conversation'];

test('项目模式「工作程度」日间字 ≥ 4.5、箭头 ≥ 3；注回旧色最差那格必须 < 4.5', async (t) => {
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
  browser = engine === 'webkit' ? await playwright().webkit.launch({headless: true}) : await launchRealBrowser(engine);

  const oldWorst = [];
  for (const width of [1440, 820]) {
    for (const scene of SCENES) {
      await t.test(`${engine} ${scene} ${width}`, async () => {
        const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, scene, 'day');
        try {
          await page.setViewportSize({width, height: 900});
          await page.mouse.move(0, 0);
          await page.waitForTimeout(400);
          const now = await measureChip(page, await shot(page));
          t.diagnostic(`现在 ${JSON.stringify(now)}`);
          assert.ok(!now.missing, `${scene} 有「工作程度」chip（mode=${now.mode}）`);
          assert.equal(now.mode, 'project');
          assert.equal(now.value, 'default');
          assert.equal(now.hover || now.focus, false, '量的是默认态，不是悬停 / 聚焦');
          assert.ok(now.textPx.ratio >= 4.5, `字 ${now.textPx.ratio} ≥ 4.5（${JSON.stringify(now.textPx)}）`);
          assert.ok(now.caretPx?.ratio >= 3, `箭头 ${now.caretPx?.ratio} ≥ 3（${JSON.stringify(now.caretPx)}）`);
          const tag = await page.addStyleTag({content: OLD_CHIP_CSS});
          await page.waitForTimeout(120);
          const old = await measureChip(page, await shot(page));
          t.diagnostic(`旧色 ${JSON.stringify(old)}`);
          oldWorst.push({scene, width, ratio: old.textPx.ratio});
          await tag.evaluate((n) => n.remove());
          assert.deepEqual(pageErrors, [], '页面没有报错');
        } finally {
          await context.close();
        }
      });
    }
  }
  const worst = oldWorst.reduce((a, b) => (b.ratio < a.ratio ? b : a), {ratio: Infinity});
  t.diagnostic(`旧色最差 ${JSON.stringify(worst)}`);
  assert.ok(worst.ratio < 4.5, `反例：旧色最差那格必须 < 4.5（${JSON.stringify(oldWorst)}）`);
});
