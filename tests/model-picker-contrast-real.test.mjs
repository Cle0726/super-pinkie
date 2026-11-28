// B11·model-picker 对比度复发测试（mac-coord 7216343281，macdev5）。
// thinking.md 外壳表：输入框里的思考强度入口 button.pinkie-effort-trigger
//   ① 「关闭」档位字（.pinkie-external-tier，background-clip:text）日间像素实测 4.04~4.39 → 要 ≥ 4.5；
//   ② 触发按钮边框 1.21~1.31（默认态是 1px transparent）→ 要对输入框底 ≥ 3。
// 测法：真装的 Control UI（home-project 场景），1440 / 820 × 日 / 夜，非 Metre；入口切到「关闭」档后量：
//   正向：本分支每一组都 ≥ 线；
//   反例：同页注回 origin/main@647fc80d 的透明边框与 #605a65，边框每一组都不到线；
//     「关闭」字取日间两档宽度里最浅的一档，必须不到线（820 宽 main 原值在 4px 分箱下也有 4.56，单档断言会误红）；
//   并且页面没有报错。档位字只在日间断言（夜间走 laolao-night.css 自己的色，本 PR 不碰）。
// 「关闭」字用 4px 分箱（约一笔宽）：12px 分箱下 main 1440 只有 4.49，离线太近，反例不稳；正向和反例用同一分箱。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {REVERT_CSS, TIER, TRIGGER, borderContrast, tierPalest} from './visual/lib/model-picker-contrast.mjs';

const TEXT_MIN = 4.5;
const BORDER_MIN = 3;
const BIN_PX = 4;

// 页面里把入口切到「关闭」：和 laolao-model-picker.js syncEffortTrigger 写出来的结构一致。
async function forceOff(page) {
  await page.evaluate(([sel, tier]) => {
    const e = document.querySelector(sel);
    e.dataset.pinkieMaterial = 'off';
    const t = e.querySelector(tier);
    if (t) t.textContent = '关闭';
  }, [TRIGGER, TIER]);
  await page.waitForFunction(([sel, tier]) => {
    const e = document.querySelector(sel);
    return e?.dataset.pinkieMaterial === 'off' && e.querySelector(tier)?.textContent === '关闭';
  }, [TRIGGER, TIER], {timeout: 5_000});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function revert(page) {
  await page.addStyleTag({content: REVERT_CSS});
  await page.waitForFunction((sel) => {
    const e = document.querySelector(sel);
    const s = getComputedStyle(e);
    const off = getComputedStyle(e).getPropertyValue('--pinkie-outside-ink').trim().toLowerCase();
    return /rgba\(0, 0, 0, 0\)|transparent/.test(s.borderTopColor) && off === '#605a65'
      && !e.getAnimations({subtree: false}).some((a) => a instanceof CSSTransition && a.playState === 'running');
  }, TRIGGER, {timeout: 5_000});
}

test('B11 model-picker：「关闭」档位字 ≥ 4.5、触发按钮边框 ≥ 3；注回 main 的值就不到', {timeout: 300_000}, async (t) => {
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

  const oldTexts = [];
  for (const theme of ['day', 'night']) for (const width of [1440, 820]) {
    const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'home-project', theme, {});
    try {
      await page.setViewportSize({width, height: 800});
      await page.waitForSelector(TRIGGER, {timeout: 15_000});
      const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
      assert.notEqual(mode, 'metre', 'Metre 模式由 laolao-metre-skin.css 接管，这里要量非 Metre');
      await forceOff(page);

      const border = await borderContrast(page);
      const text = theme === 'day' ? await tierPalest(page, {binPx: BIN_PX}) : null;
      t.diagnostic(`${theme} ${width} head border ${border.ratio.toFixed(2)} (${border.raw} on ${border.outer.map(Math.round)})${text ? ` off-text ${text.toFixed(2)}` : ''}`);
      assert.ok(border.ratio >= BORDER_MIN, `${theme} ${width} 边框 ${border.ratio.toFixed(2)} < ${BORDER_MIN}`);
      if (text) assert.ok(text >= TEXT_MIN, `${theme} ${width}「关闭」${text.toFixed(2)} < ${TEXT_MIN}`);

      await revert(page);
      const oldBorder = await borderContrast(page);
      const oldText = theme === 'day' ? await tierPalest(page, {binPx: BIN_PX}) : null;
      if (oldText) oldTexts.push(oldText);
      t.diagnostic(`${theme} ${width} main border ${oldBorder.ratio.toFixed(2)}${oldText ? ` off-text ${oldText.toFixed(2)}` : ''}`);
      assert.ok(oldBorder.ratio < BORDER_MIN, `反例没生效：${theme} ${width} main 边框也有 ${oldBorder.ratio.toFixed(2)}`);

      assert.deepEqual(pageErrors, [], '页面没有报错');
    } finally {
      await context.close();
    }
  }
  assert.equal(oldTexts.length, 2, '日间两档宽度都要量到 main「关闭」');
  const worstOld = Math.min(...oldTexts);
  assert.ok(worstOld < TEXT_MIN, `反例没生效：main「关闭」日间最浅一档也有 ${worstOld.toFixed(2)}`);
});
