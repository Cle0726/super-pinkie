// B62/B51 复发测试：visual-baseline「3 遍确定性」同进程偶发 6–7 px（CI #434 model-picker-day、
// #430 home-unrestricted-night，box x=1181..1243 y=732..737 Δ1，发送按钮上沿圆角）。
// 根因：首帧之后发送按钮被局部重画（字体晚到、失焦等），Chromium 局部重画的圆角抗锯齿和
// 整块光栅化差 1 个色阶。基线截图入口 screenshotScene 截图前必须整页重新光栅化。
// 触发方式（页面就绪之后、截图之前）：
//   - partial-repaint：发送按钮加 outline，画两帧，再去掉，再画两帧（必然局部重画）；
//   - focus-blur：键盘把焦点移到发送按钮再失焦（真实页面里常见的来源）；
//   - late-font：字体晚到 1500ms（CI 上的来源之一，本机不一定每次触发）。
// 要求截到的图都和正常截图逐字节一致（容差 0）。去掉 screenshotScene 里的整页重画后前两种必红。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureScenePng,
  launchVisualBrowser,
  openScenePage,
  screenshotScene,
  startVisualServer,
} from './visual/lib/harness.mjs';
import {comparePng, describeRepeatDiff} from './visual/lib/png-diff.mjs';

const FONT_URL = '**/fonts/PinkieUI-NotoSansSC.woff2';
const FONT_DELAY_MS = 1500;

const frames = (page, n) => page.evaluate((k) => new Promise((resolve) => {
  let i = 0;
  const tick = () => (++i >= k ? resolve() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);

// 和真 browser 一样能 newContext，只是每个 context 先挂上「字体晚到」路由。
function lateFontBrowser(browser) {
  return {
    async newContext(options) {
      const context = await browser.newContext(options);
      await context.route(FONT_URL, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS));
        await route.continue();
      });
      return context;
    },
  };
}

const TRIGGERS = {
  'partial-repaint': {
    async run(page) {
      await page.evaluate(() => { document.getElementById('m5-send-btn').style.outline = '2px solid red'; });
      await frames(page, 2);
      await page.evaluate(() => { document.getElementById('m5-send-btn').style.outline = ''; });
      await frames(page, 2);
    },
  },
  'focus-blur': {
    async run(page) {
      await page.focus('#m5-input');
      await page.keyboard.press('Tab');
      await page.evaluate(() => document.activeElement?.blur());
      await frames(page, 2);
    },
  },
  'late-font': {lateFont: true},
};

test('B62: 首帧后局部重画过的页面，截图仍和正常截图逐字节一致', async (t) => {
  const server = await startVisualServer();
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); } finally { await server.close(); }
  });
  browser = await launchVisualBrowser();
  const late = lateFontBrowser(browser);

  for (const [scene, theme] of [['model-picker', 'day'], ['home-unrestricted', 'night']]) {
    await t.test(`${scene}-${theme}`, async () => {
      const normal = await captureScenePng(browser, server.origin, scene, theme);
      assert.deepEqual(normal.pageErrors, []);
      for (const [name, trigger] of Object.entries(TRIGGERS)) {
        const {context, page, pageErrors} = await openScenePage(trigger.lateFont ? late : browser, server.origin, scene, theme);
        let png;
        try {
          if (trigger.run) await trigger.run(page);
          png = await screenshotScene(page);
        } finally {
          await context.close();
        }
        assert.deepEqual(pageErrors, [], `[${name}] pageerror`);
        const diff = comparePng(normal.png, png, {channelTolerance: 0});
        assert.equal(diff.diffPixels, 0, `[${name}] ${describeRepeatDiff({scene, theme, runA: 1, runB: 2}, diff)}`);
      }
    });
  }
});
