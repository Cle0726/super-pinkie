// #113 打回（uireview 11-26 00:49Z）复发防护（真页面）：白板浮层 `position: fixed; inset: 24px`，没有遮罩、没有 aria-modal / inert，
// 上边切过页面顶栏，四周露出页面，而且背后的键还能点。
// 现在：四周垫一层实的遮罩（点了不穿透、点它就关）、根标 aria-modal、背后页面 inert、关掉后全部撤掉。
// 量法：真实安装的 Control UI + 碧琪注入，想法模式首页，1440 / 1024 / 820 × 日 / 夜，打开白板后
// 白板四角外留白的中点、上边留白中点、顶栏中心点，elementFromPoint 都要命中白板或遮罩。
// 反例写在同一个测试里：把遮罩藏掉、撤掉 inert（= 打回时的样子），四角外的点必须命中页面原有的东西。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const SIZES = [[1440, 900], [1024, 768], [820, 900]];
const CORNERS = ['tl', 'tr', 'bl', 'br'];

// 每个点命中的是什么：白板 / 遮罩 / 页面（带上标签和类名，失败时好看）
const probe = (page) => page.evaluate(() => {
  const r = document.querySelector('.pk-whiteboard').getBoundingClientRect();
  const W = innerWidth; const H = innerHeight;
  const gx = r.left / 2; const gy = r.top / 2; const gr = (W + r.right) / 2; const gb = (H + r.bottom) / 2;
  const pts = {tl: [gx, gy], tr: [gr, gy], bl: [gx, gb], br: [gr, gb], top: [W / 2, gy], bar: [W / 2, 20]};
  const out = {gap: [r.left, r.top, W - r.right, H - r.bottom].map(Math.round)};
  for (const [k, [x, y]] of Object.entries(pts)) {
    const e = document.elementFromPoint(x, y);
    const own = e ? (e.closest('.pk-whiteboard') ? 'board' : e.closest('.pk-whiteboard__scrim') ? 'scrim' : '') : '';
    const cls = e && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    out[k] = {own, at: [Math.round(x), Math.round(y)], tag: e ? e.tagName.toLowerCase() + cls : null};
  }
  return out;
});

const backdrop = (page) => page.evaluate(() => {
  const root = document.querySelector('.pk-whiteboard');
  const scrim = document.querySelector('.pk-whiteboard__scrim');
  const others = [...document.body.children].filter((n) => n !== root && n !== scrim && !/^(SCRIPT|STYLE|LINK)$/.test(n.tagName));
  return {
    open: Boolean(root && !root.hidden), modal: root?.getAttribute('aria-modal') || null,
    scrim: Boolean(scrim && !scrim.hidden && getComputedStyle(scrim).display !== 'none'),
    others: others.length, inert: others.filter((n) => n.inert).length,
  };
});

const openBoard = (page) => page.evaluate(() => Promise.resolve(window.Pinkie.whiteboard.open()).then(() => true, () => true));

test('#113 real page: whiteboard overlay has a solid scrim, aria-modal and inert page behind; old look (no scrim) fails', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'home-thinking', theme);
    try {
      await page.waitForFunction(() => typeof window.Pinkie?.whiteboard?.open === 'function', null, {timeout: 10_000});
      for (const [W, H] of SIZES) {
        const tag = `${W}-${theme}`;
        await page.setViewportSize({width: W, height: H});
        await page.waitForTimeout(150);
        await openBoard(page);
        await page.waitForTimeout(200);

        const bd = await backdrop(page);
        t.diagnostic(`${tag} backdrop ${JSON.stringify(bd)}`);
        assert.equal(bd.open, true, `${tag}: 想法模式首页打不开白板`);
        assert.equal(bd.modal, 'true', `${tag}: 白板根要 aria-modal="true"`);
        assert.equal(bd.scrim, true, `${tag}: 打开白板时要有遮罩`);
        assert.ok(bd.others > 0 && bd.inert === bd.others, `${tag}: 背后页面没全设 inert（${bd.inert}/${bd.others}）`);

        const hit = await probe(page);
        t.diagnostic(`${tag} hits ${JSON.stringify(hit)}`);
        assert.ok(hit.gap.every((g) => g >= 2), `${tag}: 白板四周没有留白，量不了 ${JSON.stringify(hit.gap)}`);
        for (const k of [...CORNERS, 'top', 'bar']) assert.ok(hit[k].own, `${tag}: ${k} 点 ${JSON.stringify(hit[k].at)} 命中了页面的 ${hit[k].tag}，不是白板或遮罩`);
        for (const k of CORNERS) assert.equal(hit[k].own, 'scrim', `${tag}: ${k} 角外应该是遮罩，命中了 ${hit[k].tag}`);

        // 点上边留白（遮罩）：不穿透、白板关掉、inert 全撤
        const before = await page.evaluate(() => location.href);
        await page.mouse.click(...hit.top.at);
        await page.waitForTimeout(200);
        const after = await backdrop(page);
        assert.equal(after.open, false, `${tag}: 点遮罩要关白板`);
        assert.equal(after.scrim, false, `${tag}: 关掉后遮罩要藏`);
        assert.equal(after.inert, 0, `${tag}: 关掉后 inert 要撤干净（还剩 ${after.inert}）`);
        assert.equal(await page.evaluate(() => location.href), before, `${tag}: 点遮罩穿透到页面了（地址变了）`);

        // Esc 也能关，且一样撤 inert
        await openBoard(page);
        await page.waitForTimeout(150);
        await page.evaluate(() => document.querySelector('.pk-whiteboard').focus());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        const esc = await backdrop(page);
        assert.deepEqual([esc.open, esc.inert], [false, 0], `${tag}: Esc 关白板后 ${JSON.stringify(esc)}`);

        // 反例：打开后藏掉遮罩、撤掉 inert（= 打回时的样子），四角外的点必须命中页面
        await openBoard(page);
        await page.waitForTimeout(150);
        await page.evaluate(() => {
          document.querySelector('.pk-whiteboard__scrim').hidden = true;
          for (const n of document.body.children) n.inert = false;
        });
        const old = await probe(page);
        const leaked = CORNERS.filter((k) => !old[k].own).map((k) => `${k}:${old[k].tag}`);
        t.diagnostic(`${tag} counter-example leaks ${leaked.join(' ')}`);
        assert.equal(leaked.length, 4, `反例没生效（${tag}）：没遮罩时四角外还是命中白板 ${JSON.stringify(old)}`);
        await page.evaluate(() => window.Pinkie.whiteboard.close());
        await page.waitForTimeout(100);
      }
    } finally {
      await context.close();
    }
  }
});
