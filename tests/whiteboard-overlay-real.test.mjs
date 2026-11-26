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
// 真页面框架会加载 app/windows_bridge_scripts.py（桌面壳的拖动条 / 改大小 / 窗口键），它们浮在一切之上、白板开着也要能用。
const NATIVE_SEL = '[id^="pinkie-native-"], [id^="pinkie-update-"], [id^="laolao-native-"]';

// 每个点命中的是什么：白板 / 遮罩 / 桌面壳 / 页面（带上标签和类名，失败时好看）
const probe = (page) => page.evaluate((NATIVE) => {
  const r = document.querySelector('.pk-whiteboard').getBoundingClientRect();
  const W = innerWidth; const H = innerHeight;
  const gx = r.left / 2; const gy = r.top / 2; const gr = (W + r.right) / 2; const gb = (H + r.bottom) / 2;
  const pts = {tl: [gx, gy], tr: [gr, gy], bl: [gx, gb], br: [gr, gb], top: [W / 2, gy], bar: [W / 2, 20], left: [gx, H / 2], bottom: [W / 2, gb]};
  const out = {gap: [r.left, r.top, W - r.right, H - r.bottom].map(Math.round)};
  for (const [k, [x, y]] of Object.entries(pts)) {
    const e = document.elementFromPoint(x, y);
    const own = e ? (e.closest('.pk-whiteboard') ? 'board' : e.closest('.pk-whiteboard__scrim') ? 'scrim' : e.closest(NATIVE) ? 'native' : '') : '';
    const cls = e && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    out[k] = {own, at: [Math.round(x), Math.round(y)], tag: e ? e.tagName.toLowerCase() + cls : null};
  }
  return out;
}, NATIVE_SEL);

const backdrop = (page) => page.evaluate((NATIVE) => {
  const root = document.querySelector('.pk-whiteboard');
  const scrim = document.querySelector('.pk-whiteboard__scrim');
  const kids = [...document.body.children].filter((n) => n !== root && n !== scrim && !/^(SCRIPT|STYLE|LINK)$/.test(n.tagName));
  const others = kids.filter((n) => !n.matches(NATIVE));
  const native = kids.filter((n) => n.matches(NATIVE));
  return {
    open: Boolean(root && !root.hidden), modal: root?.getAttribute('aria-modal') || null,
    scrim: Boolean(scrim && !scrim.hidden && getComputedStyle(scrim).display !== 'none'),
    others: others.length, inert: others.filter((n) => n.inert).length,
    native: native.map((n) => n.id), nativeInert: native.filter((n) => n.inert).map((n) => n.id),
  };
}, NATIVE_SEL);

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
        assert.deepEqual(bd.nativeInert, [], `${tag}: 桌面壳的 ${bd.nativeInert.join(', ')} 不能设 inert`);

        const hit = await probe(page);
        t.diagnostic(`${tag} hits ${JSON.stringify(hit)}`);
        assert.ok(hit.gap.every((g) => g >= 2), `${tag}: 白板四周没有留白，量不了 ${JSON.stringify(hit.gap)}`);
        // 每个点只能是白板、遮罩或桌面壳自己的键，不能是页面原有的东西
        for (const k of [...CORNERS, 'top', 'bar', 'left', 'bottom']) assert.ok(hit[k].own, `${tag}: ${k} 点 ${JSON.stringify(hit[k].at)} 命中了页面的 ${hit[k].tag}，不是白板、遮罩或桌面壳`);
        for (const k of [...CORNERS, 'left', 'bottom']) assert.ok(hit[k].own === 'scrim' || hit[k].own === 'native', `${tag}: ${k} 角外应该是遮罩，命中了 ${hit[k].tag}`);
        assert.equal(hit.left.own, 'scrim', `${tag}: 左边留白中点应该是遮罩，命中了 ${hit.left.tag}`);

        // 点左边留白（遮罩，桌面壳不在这里）：不穿透、白板关掉、inert 全撤
        const before = await page.evaluate(() => location.href);
        await page.mouse.click(...hit.left.at);
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
        // 只看原来是遮罩的点（桌面壳盖着的点本来就不是页面，不算）
        const masked = [...CORNERS, 'left', 'bottom'].filter((k) => hit[k].own === 'scrim');
        const leaked = masked.filter((k) => !old[k].own).map((k) => `${k}:${old[k].tag}`);
        t.diagnostic(`${tag} counter-example leaks ${leaked.join(' ')} (of ${masked.join(',')})`);
        assert.ok(masked.length >= 3, `${tag}: 遮罩盖着的点太少 ${masked.join(',')}`);
        assert.equal(leaked.length, masked.length, `反例没生效（${tag}）：没遮罩时还有点命中白板 ${JSON.stringify(old)}`);
        await page.evaluate(() => window.Pinkie.whiteboard.close());
        await page.waitForTimeout(100);
      }
    } finally {
      await context.close();
    }
  }
});

// mac1 任务 54（WebKit 真页面，#113@e432b648）：桌面壳的窗口键胶囊和拖动条（app/windows_bridge_scripts.py 注入，z-index ≈ 2^31，
// 压在一切之上）盖住白板工具条——820 宽「全部」整个被盖、「便签」「选择」点不到，1440 宽「导出 PNG」「关闭」上沿被压。
// 另外它们是 body 的直接子节点，遮罩那一版会把它们一起设 inert，白板开着时窗口最小化 / 关闭 / 拖动都用不了。
// 这里照 windows_bridge_scripts.py 的位置和层级放两个替身（CI 的真页面没有桌面壳），量：
//   白板顶边让到替身下面、工具条每颗键的上沿和中心都点得到它自己、替身不是 inert 且点得动、点替身不关白板；
//   反例：把白板顶边改回原来的 CSS（去掉让位），至少一颗工具条键被替身盖住。
const NATIVE_STUB = (W) => {
  for (const id of ['pinkie-native-drag-strip', 'pinkie-native-window-controls']) document.getElementById(id)?.remove();
  const narrow = W <= 900;
  const drag = document.createElement('div');
  drag.id = 'pinkie-native-drag-strip';
  drag.style.cssText = `position:fixed;z-index:2147483000;top:0;left:${narrow ? 54 : 264}px;right:204px;height:34px`;
  const ctl = document.createElement('div');
  ctl.id = 'pinkie-native-window-controls';
  ctl.style.cssText = `position:fixed;z-index:2147483647;top:4px;right:${narrow ? 10 : 12}px;width:190px;height:36px;display:flex`;
  const min = document.createElement('button');
  min.type = 'button'; min.textContent = '–'; min.style.cssText = 'flex:1';
  window.__stubClicks = 0;
  min.addEventListener('click', () => { window.__stubClicks += 1; });
  ctl.append(min);
  document.body.append(drag, ctl);
};

const toolbarHits = (page) => page.evaluate(() => {
  const root = document.querySelector('.pk-whiteboard');
  const out = [];
  for (const b of root.querySelectorAll('.pk-whiteboard__bar button')) {
    const r = b.getBoundingClientRect();
    if (!r.width) continue;
    for (const [k, y] of [['top', r.top + 3], ['mid', r.top + r.height / 2]]) {
      const e = document.elementFromPoint(r.left + r.width / 2, y);
      const own = Boolean(e && (e === b || b.contains(e)));
      out.push({b: b.textContent.trim() || b.getAttribute('aria-label') || '?', k, own, by: own ? '' : (e?.closest('[id]')?.id || e?.tagName || null)});
    }
  }
  return {top: Math.round(root.getBoundingClientRect().top), hits: out};
});

test('#113 real page: whiteboard toolbar clears the desktop shell window controls / drag strip, which stay usable (not inert); old offset is covered', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'home-thinking', theme);
    try {
      await page.waitForFunction(() => typeof window.Pinkie?.whiteboard?.open === 'function', null, {timeout: 10_000});
      for (const [W, H] of [[1440, 900], [820, 900]]) {
        const tag = `${W}-${theme}`;
        await page.setViewportSize({width: W, height: H});
        await page.evaluate(NATIVE_STUB, W);
        await page.waitForTimeout(150);
        await openBoard(page);
        await page.waitForTimeout(200);

        const ctlBottom = await page.evaluate(() => Math.max(...['pinkie-native-window-controls', 'pinkie-native-drag-strip'].map((id) => document.getElementById(id).getBoundingClientRect().bottom)));
        const now = await toolbarHits(page);
        const covered = now.hits.filter((h) => !h.own);
        t.diagnostic(`${tag} board top ${now.top} (shell bottom ${ctlBottom}); ${now.hits.length / 2} toolbar keys; covered ${JSON.stringify(covered)}`);
        assert.ok(now.top >= ctlBottom + 4, `${tag}: 白板顶边 ${now.top} 没让到窗口键 / 拖动条（下沿 ${ctlBottom}）下面`);
        assert.ok(now.hits.length >= 20, `${tag}: 工具条键太少 ${now.hits.length / 2}`);
        assert.deepEqual(covered, [], `${tag}: 工具条有键被盖住`);

        const shell = await page.evaluate(() => ['pinkie-native-window-controls', 'pinkie-native-drag-strip'].map((id) => document.getElementById(id).inert));
        assert.deepEqual(shell, [false, false], `${tag}: 白板开着时桌面壳的窗口键 / 拖动条不能设 inert`);
        const btn = await page.locator('#pinkie-native-window-controls button').boundingBox();
        await page.mouse.click(btn.x + btn.width / 2, btn.y + btn.height / 2);
        await page.waitForTimeout(100);
        const after = await page.evaluate(() => ({clicks: window.__stubClicks, open: window.Pinkie.whiteboard.isOpen()}));
        assert.deepEqual(after, {clicks: 1, open: true}, `${tag}: 白板开着时窗口键要点得动、点了不关白板 ${JSON.stringify(after)}`);

        // 反例：去掉让位（顶边回到原来的 CSS），至少一颗键被替身盖住
        await page.evaluate(() => document.querySelector('.pk-whiteboard').style.removeProperty('top'));
        await page.waitForTimeout(100);
        const old = await toolbarHits(page);
        const oldCovered = old.hits.filter((h) => !h.own);
        t.diagnostic(`${tag} counter-example top ${old.top}; covered ${oldCovered.map((h) => `${h.b}/${h.k}<${h.by}`).join(' ')}`);
        assert.ok(oldCovered.length >= 1, `反例没生效（${tag}）：顶边 ${old.top} 时工具条一颗都没被盖住`);
        await page.evaluate(() => window.Pinkie.whiteboard.close());
        await page.waitForTimeout(100);
        const closed = await page.evaluate(() => ['pinkie-native-window-controls', 'pinkie-native-drag-strip'].map((id) => document.getElementById(id).inert));
        assert.deepEqual(closed, [false, false], `${tag}: 关掉白板后窗口键 / 拖动条状态被改了`);
      }
    } finally {
      await context.close();
    }
  }
});
