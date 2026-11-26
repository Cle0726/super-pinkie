// B14（backlog，uireview #164 记）：Metre 侧栏底栏的模式黑卡和连接方灯。
// 1. 方灯比黑卡中心高约 10px：卡是从底往上放的（bottom 13px、高 38px），灯却写死 top 16px（#164 shots.jsonl：卡 y849..887 中心 868，灯 y853..863 中心 858）。
//    改成 top 26px，灯的竖直中心和卡的竖直中心对齐。
// 2. 日间卡里的 ◇（上下箭头）偏暗：◇ 是 mask 图形，颜色取 background（--metre-muted，日间 #77736B，在 #131312 黑卡上实测 3.94:1，过了图形 3:1 但看着发暗；按文字 4.5:1 要求）；
//    旧规则只改了 color，mask 用不上。改成 background 也用浅钴蓝 #8496E6（卡日夜同一张，◇ 日夜同色）。
// 真实安装的 OpenClaw Control UI + 碧琪注入，metre-board 场景 1440 宽，日 / 夜都量；反例：删掉这两处新声明，日间两条都必须不过。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

// 在页面里：量黑卡、方灯的竖直中心，◇ 的填色对黑卡底色的对比度。
function readFoot() {
  const rgb = (s) => {
    const n = (s.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^rgba?\(/.test(s)) return n;
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    throw new Error(`读不懂的颜色格式：${s}`);
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const side = document.querySelector('aside.sidebar');
  const card = side?.querySelector('.laolao-mode-switcher.laolao-mode-button--plain');
  const lamp = side?.querySelector('.pinkie-connection-status');
  const arrow = card?.querySelector('.laolao-mode-button__arrow');
  if (!card || !lamp || !arrow) return {missing: [!card && 'card', !lamp && 'lamp', !arrow && 'arrow'].filter(Boolean).join(',')};
  const cr = card.getBoundingClientRect(), lr = lamp.getBoundingClientRect(), ar = arrow.getBoundingClientRect();
  const fill = rgb(getComputedStyle(arrow).backgroundColor), bg = rgb(getComputedStyle(card).backgroundColor).slice(0, 3);
  const a = fill[3] === undefined ? 1 : fill[3];
  const op = Number(getComputedStyle(arrow).opacity);
  const ink = fill.slice(0, 3).map((v, i) => a * op * v + (1 - a * op) * bg[i]);
  const x = lum(ink), y = lum(bg);
  return {
    cardMid: cr.top + cr.height / 2, lampMid: lr.top + lr.height / 2, lampH: lr.height,
    lampRightOfCard: lr.left >= cr.right, arrowShown: ar.width > 0 && ar.height > 0,
    fill: getComputedStyle(arrow).backgroundColor, cardBg: getComputedStyle(card).backgroundColor, opacity: op,
    ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05),
  };
}

// 两处新声明（删反例时按它找）：方灯 top 26px、◇ background #8496E6
const LAMP_SEL = 'aside.sidebar:not(.sidebar--collapsed) .pinkie-connection-status';
const ARROW_SEL = 'aside.sidebar:not(.sidebar--collapsed) .laolao-mode-switcher.laolao-mode-button--plain .laolao-mode-button__arrow';

test('B14 real page: Metre footer light is vertically centred on the mode card and the ◇ reads at ≥ 4.5:1 on the card, day and night; reverting the two declarations breaks both in day', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      await page.setViewportSize({width: 1440, height: 900});
      await page.mouse.move(900, 400);   // 指针不在卡上，量的是平时的样子
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
      const m = await page.evaluate(readFoot);
      assert.equal(m.missing, undefined, `${theme}: 页面上没有 ${m.missing}`);
      console.log(`ℹ ${theme}: ${JSON.stringify(m)}`);
      assert.ok(m.arrowShown, `${theme}: ◇ 没显示`);
      assert.ok(m.lampRightOfCard, `${theme}: 方灯压到卡上了`);
      assert.ok(Math.abs(m.lampMid - m.cardMid) <= 2, `${theme}: 方灯中心 y${m.lampMid} 和卡中心 y${m.cardMid} 差 ${(m.lampMid - m.cardMid).toFixed(1)}px`);
      assert.ok(m.ratio >= 4.5, `${theme}: ◇ ${m.fill} 在卡 ${m.cardBg} 上只有 ${m.ratio.toFixed(2)}:1`);

      if (theme === 'day') {
        // 反例：把两处新声明删掉（方灯回到 top 16px、◇ 回到 --metre-muted），日间两条都要不过
        const removed = await page.evaluate(([lampSel, arrowSel]) => {
          let n = 0;
          for (const sh of document.styleSheets) {
            let rules; try { rules = sh.cssRules; } catch { continue; }
            for (const r of rules) {
              const s = r.selectorText || '';
              if (s.endsWith(lampSel) && r.style.getPropertyValue('top') === '26px') { r.style.setProperty('top', '16px', 'important'); n++; }
              if (s.endsWith(arrowSel) && /#8496e6|rgb\(132, ?150, ?230\)/i.test(r.style.getPropertyValue('background-color'))) { r.style.removeProperty('background'); r.style.removeProperty('background-color'); n++; }
            }
          }
          return n;
        }, [LAMP_SEL, ARROW_SEL]);
        assert.equal(removed, 2, `反例：页面上没找到那两处新声明（找到 ${removed} 处）`);
        await page.waitForTimeout(300);
        const bad = await page.evaluate(readFoot);
        console.log(`ℹ day without the fix: ${JSON.stringify(bad)}`);
        assert.ok(Math.abs(bad.lampMid - bad.cardMid) >= 6, `反例没生效：方灯回到 top 16px 后仍和卡中心对齐（差 ${(bad.lampMid - bad.cardMid).toFixed(1)}px）`);
        assert.ok(bad.ratio < 4.5, `反例没生效：◇ 回到 --metre-muted 后仍 ≥ 4.5:1（${bad.ratio.toFixed(2)}）`);
      }
    } finally {
      await context.close();
    }
  }
});
