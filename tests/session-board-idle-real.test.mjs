// #229 · 真页面：页面空闲时「在跑」胶囊不自己重画。
// 起因：侧栏用 Pinkie.domWatch.watch('aside.sidebar .laolao-session-controls', …) 调 paintPill()；
// domWatch 观察整页（childList + attributes + characterData，subtree），每批变化排一帧 rAF 调回调。
// paintPill 以前每次都把文字和属性原样写回，同值写回也算一次变化 → 又触发 watch → 每帧重绘一次，
// 所有带侧栏的真页面都一直占着 CPU（#229 windows-checks 整步慢一倍、撞 30 分钟超时）。
// 这里量胶囊上的变化记录：空闲 2 秒内应接近 0（每帧重绘时会有上百条）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const IDLE_MS = 2000;
const MAX_RECORDS = 2;

// 在页面里数 IDLE_MS 内胶囊（含子节点）的变化记录；整页的也一起数，写进失败信息方便看。
const countIdleMutations = (page, ms) => page.evaluate((wait) => new Promise((resolve) => {
  const pill = document.querySelector('aside.sidebar .pk-sb-pill');
  let onPill = 0;
  let onPage = 0;
  const pillObs = new MutationObserver((records) => { onPill += records.length; });
  const pageObs = new MutationObserver((records) => { onPage += records.length; });
  pillObs.observe(pill, {attributes: true, childList: true, characterData: true, subtree: true});
  pageObs.observe(document.documentElement, {attributes: true, childList: true, characterData: true, subtree: true});
  setTimeout(() => { pillObs.disconnect(); pageObs.disconnect(); resolve({onPill, onPage}); }, wait);
}), ms);

test('#229 真页面：空闲 2 秒内「在跑」胶囊几乎没有变化记录（paintPill 只写有变化的值，不和 domWatch 互相触发）', {timeout: 240_000}, async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); await server?.close(); }
    finally { installed.cleanup(); }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const scene of ['sidebar-expanded', 'metre-board']) {
    await t.test(scene, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, scene, 'day');
      try {
        await page.waitForSelector('aside.sidebar .pk-sb-pill', {state: 'attached', timeout: 20_000});
        await page.waitForTimeout(500);   // 让载入时的那几次正常重画先过去
        const {onPill, onPage} = await countIdleMutations(page, IDLE_MS);
        assert.ok(onPill <= MAX_RECORDS,
          `${scene}：空闲 ${IDLE_MS} ms 内胶囊有 ${onPill} 条变化记录（整页 ${onPage} 条），应 ≤ ${MAX_RECORDS}；多半是 paintPill 同值写回又触发了 domWatch`);
        assert.deepEqual(pageErrors, [], '页面不能报错');
      } finally { await context.close(); }
    });
  }
});
