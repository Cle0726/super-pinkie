// B11·S5 高亮会话行时间对比度复发测试（mac-coord 7218097083，macdev5）。
// chat.md：高亮行里的 .pinkie-session-time 压在 --sb-active 粉底上——
//   日间 --sb-muted 计算 4.90，但 11px 字像素只有 4.32；夜间继承行色再叠 laolao-sidebar.css:467 的 .56，只有 2.6~2.7。
// 测法：真装的 Control UI，home-chat 点进一条对话，1440 / 820（820 先展开抽屉）× 日 / 夜，非 Metre：
//   正向：每一组计算 ≥ 4.5、像素（4px 分箱最浅）≥ 4.5；
//   反例：同页注回 origin/main@b8fcd5be 的写法，夜间每一组计算都 < 4.5；
//     日间 main 的计算值本就 4.69/4.90，能否跌破 4.5 只看引擎抗锯齿（Chromium 4.25、WebKit 4.52，mac2 7226016718），
//     所以日间每一档改断言相对退化：改后比注回 main 计算、像素都至少高 DAY_GAP（实测差值 Chromium ≥1.89、WebKit ≥2.15）；
//   并且页面没有报错。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {REVERT_CSS, openActiveRow, pixelTime, visibleTimes} from './visual/lib/session-time-contrast.mjs';

const MIN = 4.5;
const DAY_GAP = 1.0;

async function measure(page, width) {
  const rows = await visibleTimes(page, width);
  assert.ok(rows.length > 0, '高亮行里要有看得见的时间');
  let calc = Infinity;
  let px = Infinity;
  for (const r of rows) {
    calc = Math.min(calc, r.ratio);
    px = Math.min(px, await pixelTime(page, r.box, {binPx: 4}));
  }
  return {calc, px, sample: rows[0]};
}

test('B11·S5：高亮会话行时间日夜 ≥ 4.5；注回 main 的写法就不到', {timeout: 300_000}, async (t) => {
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

  const dayGap = {};
  const oldNightCalc = {};
  for (const theme of ['day', 'night']) for (const width of [1440, 820]) {
    const {context, page, pageErrors} = await openActiveRow(browser, server.origin, theme, width);
    try {
      const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
      assert.notEqual(mode, 'metre', 'Metre 由 laolao-metre-skin.css 接管，这里要量非 Metre');

      const now = await measure(page, width);
      t.diagnostic(`${theme} ${width} head 计算 ${now.calc.toFixed(2)} 像素 ${now.px.toFixed(2)}（${now.sample.color} × ${now.sample.opacity} 在 ${now.sample.bg}）`);
      assert.ok(now.calc >= MIN, `${theme} ${width} 计算 ${now.calc.toFixed(2)} < ${MIN}`);
      assert.ok(now.px >= MIN, `${theme} ${width} 像素 ${now.px.toFixed(2)} < ${MIN}`);

      const tag = await page.addStyleTag({content: REVERT_CSS});
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const old = await measure(page, width);
      await tag.evaluate((n) => n.remove());
      t.diagnostic(`${theme} ${width} 注回 main 计算 ${old.calc.toFixed(2)} 像素 ${old.px.toFixed(2)}`);
      if (theme === 'day') dayGap[width] = {calc: now.calc - old.calc, px: now.px - old.px};
      else oldNightCalc[width] = old.calc;

      assert.deepEqual(pageErrors, [], `${theme} ${width} 页面报错`);
    } finally {
      await context.close();
    }
  }
  for (const [width, calc] of Object.entries(oldNightCalc)) assert.ok(calc < MIN, `反例没生效：夜间 ${width} 注回 main 也有 ${calc.toFixed(2)}`);
  for (const [width, g] of Object.entries(dayGap)) {
    assert.ok(g.calc >= DAY_GAP && g.px >= DAY_GAP, `反例没生效：日间 ${width} 改后只比注回 main 高 计算 ${g.calc.toFixed(2)} / 像素 ${g.px.toFixed(2)}（要 ≥ ${DAY_GAP}）`);
  }
});
