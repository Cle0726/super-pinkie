// G3 复发防护（真页面）：Metre 设置弹层里要有「技能」入口，点了经原生路由进 /skills（openclaw-skills-page）。
// 11-26 核实：Metre 侧栏展开时原生导航 .sidebar-nav 整个被 laolao-metre-skin.css 藏掉，原生「技能」跟着没了；
// 设置弹层（settings-user / capabilities / power-settings / metre-prefs）里也没有任何技能入口。
// 入口放在 laolao-metre-prefs.js 的 .pk-metre-skills 卡里，只在 Metre 显示，跳转不重载页面。
// 反例写在测试里：把按钮换成不带监听的克隆（等于入口没接上），点了必须留在 /settings；非 Metre（project）里卡片必须藏着。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const CARD = '#laolao-user-settings .pk-metre-skills';
const BTN = CARD + ' .pk-metre-skills__open';

async function openMetreSettings(browser, origin, theme) {
  const opened = await openRealScenePage(browser, origin, 'metre-board', theme);
  const {page, meta} = opened;
  await page.goto(`${origin}/settings/general?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`, {waitUntil: 'load', timeout: 60_000});
  await page.waitForFunction(() => document.documentElement.getAttribute('data-laolao-mode') === 'metre', null, {timeout: 30_000});
  await page.waitForSelector('#laolao-user-settings:not([hidden])', {timeout: 30_000});
  await page.waitForSelector(BTN, {timeout: 10_000});
  await page.evaluate(() => { window.__g3NoReload = 1; });
  return opened;
}

const readCard = (sel) => {
  const card = document.querySelector(sel);
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return {hidden: card.hidden || card.closest('[hidden]') !== null, h: r.height, text: card.innerText};
};

test('G3 real page: Metre settings shows a skills entry that routes to /skills without reloading; a dead button stays put', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  // B101（提速）：每个主题只开一页（原来正例、反例各开一页，每页又是场景 + /settings 两次加载）。
  // 先跑反例：把按钮换成不带监听的克隆，点了必须还在 /settings；再把原来那个按钮节点放回去（监听在它自己身上，跟着回来），
  // 跑正例。「不重载」标记在反例之前就打上了，反例要是重载了页面，正例那条也会红。
  for (const theme of ['day', 'night']) {
    const {context, page} = await openMetreSettings(browser, server.origin, theme);
    try {
      // 反例：按钮没接上（克隆不带监听），点了必须还在 /settings。
      await page.evaluate((sel) => { const b = document.querySelector(sel); window.__g3Orig = b; b.replaceWith(b.cloneNode(true)); }, BTN);
      await page.click(BTN);
      await page.waitForTimeout(800);
      const where = await page.evaluate(() => location.pathname);
      assert.ok(where.startsWith('/settings'), `${theme}: 反例没红——没接上的按钮也跳到了 ${where}`);
      assert.equal(await page.$('openclaw-skills-page'), null, `${theme}: 反例里技能页出现了`);
      await page.evaluate((sel) => { const dead = document.querySelector(sel); dead.replaceWith(window.__g3Orig); delete window.__g3Orig; }, BTN);

      // 正例：卡片在、看得见、点了进 /skills，同一个页面（标记还在）。
      const got = await page.evaluate(readCard, CARD);
      assert.ok(got, `${theme}: Metre 设置弹层里没有技能卡`);
      assert.equal(got.hidden, false, `${theme}: Metre 里技能卡被藏着`);
      assert.ok(got.h > 40, `${theme}: 技能卡高度 ${got.h}`);
      assert.match(got.text, /技能/);
      assert.match(got.text, /打开技能/);
      assert.doesNotMatch(got.text, /OpenClaw|Claude/);
      await page.click(BTN);
      await page.waitForFunction(() => location.pathname === '/skills', null, {timeout: 10_000});
      await page.waitForSelector('openclaw-skills-page', {timeout: 30_000});
      assert.equal(await page.evaluate(() => window.__g3NoReload), 1, `${theme}: 跳 /skills 时整页重载了`);
      await page.waitForFunction(() => document.querySelector('#laolao-user-settings')?.hidden === true, null, {timeout: 10_000});
    } finally {
      await context.close();
    }
  }

  // 非 Metre：project 模式的设置弹层里，技能卡要藏着（只在 Metre 露出）。
  const {context, page} = await openRealScenePage(browser, server.origin, 'settings', 'day');
  try {
    assert.notEqual(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
    const got = await page.evaluate(readCard, CARD);
    assert.ok(!got || got.hidden, `非 Metre 里技能卡露出来了 — ${JSON.stringify(got)}`);
  } finally {
    await context.close();
  }
});
