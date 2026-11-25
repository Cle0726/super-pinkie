// 820 窄窗：工作台「代码」页铺满主列时，底部「后台」状态带不能画在工作台最后一屏上面（协调者 11-25 07:43：main 原有）。
// 原因：窄窗「代码」页只把对话那一列 visibility: hidden（laolao-workbench.css），输入框的 getClientRects() 仍非空，
//   后台带（z 36，挂在 body 上）照旧按输入框的位置画在窗口底部，压住工作台（z 24）的最后一屏。
// 真实安装的 Control UI + 碧琪注入 + 假网关（tests/visual/lib/real-harness.mjs），820 × 日 / 夜：
//   1. 前提：对话页有后台带，在最上层、点得到；
//   2. 打开工作台（窄窗默认「代码」页）：工作台底部 40px 里每个采样点的最上层都不是后台带 / 引擎弹层，后台带自己也看不见；
//   3. 切回「对话」页：后台带回来，在最上层、点得到。
import assert from 'node:assert/strict';
import test from 'node:test';
import {REPO_ROOT, installRealControlUi, launchRealBrowser, openRealScenePage, startRealUiServer} from './visual/lib/real-harness.mjs';

const look = () => {
  const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)');
  const wb = document.querySelector('.pk-wb');
  const shown = (n) => Boolean(n && !n.hidden && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
  const name = (e) => (e ? e.getAttribute('class') || e.tagName : 'none');
  const html = document.documentElement.dataset;
  const out = {band: shown(band), wb: shown(wb), on: html.pinkieWb || '', view: html.pkWbView || '', narrow: html.pkWbNarrow || ''};
  if (out.band) {
    const B = band.getBoundingClientRect(), pts = [];
    for (let i = 1; i < 10; i++) pts.push([B.left + B.width * i / 10, B.top + B.height / 2]);
    out.bandBox = [B.left, B.top, B.width, B.height].map(Math.round);
    out.bandOnTop = pts.filter((p) => band.contains(document.elementFromPoint(...p))).length; out.bandOf = pts.length;
  }
  if (out.wb) {
    const W = wb.getBoundingClientRect(), hits = [];
    for (let i = 1; i < 20; i++) for (const dy of [4, 12, 20, 28, 36]) {
      const e = document.elementFromPoint(W.left + W.width * i / 20, Math.min(W.bottom, innerHeight) - dy);
      hits.push(e && wb.contains(e) ? 'wb' : e?.closest('.pk-metre-backstage, .pk-bs__pop') ? 'band' : name(e));
    }
    out.wbBox = [W.left, W.top, W.width, W.height].map(Math.round);
    out.wbOf = hits.length; out.byBand = hits.filter((h) => h === 'band').length;
    out.byOther = [...new Set(hits.filter((h) => h !== 'wb' && h !== 'band'))].slice(0, 6);
  }
  return out;
};

test('820 窄窗：工作台「代码」页的最后一屏不被底部「后台」状态带盖住；回「对话」页状态带回来（日 / 夜）', async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  // 清理先注册：浏览器起不来时假服务也要关掉，否则 node 不退出。
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      try { await server?.close(); }
      finally { installed.cleanup(); }
    }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    await t.test(`820 ${theme}`, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
      try {
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.setViewportSize({width: 820, height: 800});
        await page.waitForSelector('.pk-metre-backstage:not(.pk-metre-backstage--probe):not([hidden])', {timeout: 8_000});
        await page.waitForTimeout(400);

        const s0 = await page.evaluate(look);
        t.diagnostic(`对话页 ${JSON.stringify(s0)}`);
        assert.equal(s0.on, '', '前提：工作台还没开');
        assert.ok(s0.band, '前提：820 对话页有后台带');
        assert.equal(s0.bandOnTop, s0.bandOf, '前提：对话页后台带在最上层、点得到');

        await page.evaluate(() => document.querySelector('.pk-wb-reopen')?.click());
        await page.waitForFunction(() => document.documentElement.dataset.pinkieWb === 'on' && document.documentElement.dataset.pkWbView === 'code', null, {timeout: 5_000});
        await page.waitForTimeout(500);
        const s1 = await page.evaluate(look);
        t.diagnostic(`代码页 ${JSON.stringify(s1)}`);
        assert.equal(s1.narrow, '1', '前提：820 是窄窗（工作台和对话分页）');
        assert.ok(s1.wb, '前提：工作台看得见');
        assert.equal(s1.byBand, 0, `工作台底部 40px 没有一点被后台带 / 引擎弹层盖住：${s1.byBand}/${s1.wbOf} 点 ${JSON.stringify(s1.bandBox)}`);
        assert.equal(s1.band, false, '「代码」页里后台带看不见（对话那一列都藏了，它跟着藏）');
        // 反例：把那一条换回 main 的样子（只藏对话那一列），后台带又压在工作台最后一屏上——测试会红
        const swapped = await page.evaluate(() => {
          for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch { continue; }
            for (let i = rules.length - 1; i >= 0; i--) {
              const r = rules[i];
              if (r.selectorText?.includes('data-pk-wb-view="code"') && r.selectorText.includes('pk-metre-backstage')) {
                const text = r.cssText; sheet.deleteRule(i);
                sheet.insertRule('html[data-pk-wb-narrow="1"][data-pk-wb-view="code"] main.content.content--chat > * { visibility: hidden; pointer-events: none; }', i);
                window.__pkBandRule = {sheet, i, text}; return true;
              }
            }
          }
          return false;
        });
        assert.ok(swapped, '反例真的把那一条换回了 main 的样子');
        await page.waitForTimeout(200);
        const sx = await page.evaluate(look);
        t.diagnostic(`反例 ${JSON.stringify(sx)}`);
        assert.ok(sx.band && sx.byBand > 0, '反例（main 的样子）：后台带压在工作台最后一屏上 ' + JSON.stringify(sx));
        await page.evaluate(() => { const {sheet, i, text} = window.__pkBandRule; sheet.deleteRule(i); sheet.insertRule(text, i); });
        assert.equal((await page.evaluate(look)).byBand, 0, '换回修好的那一条以后又不压了');

        await page.evaluate(() => [...document.querySelectorAll('.pk-workspace-header__views button')].find((b) => b.textContent.trim() === '对话')?.click());
        await page.waitForFunction(() => document.documentElement.dataset.pkWbView === 'chat', null, {timeout: 5_000});
        await page.waitForTimeout(400);
        const s2 = await page.evaluate(look);
        t.diagnostic(`回对话页 ${JSON.stringify(s2)}`);
        assert.ok(s2.band, '回「对话」页后台带回来');
        assert.equal(s2.bandOnTop, s2.bandOf, '回「对话」页后台带在最上层、点得到');
        assert.deepEqual(pageErrors, [], '页面没有报错');
      } finally {
        await context.close();
      }
    });
  }
});
