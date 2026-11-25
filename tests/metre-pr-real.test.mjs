// 第 5 项「PR 一条龙」PR 页在真实 Control UI 上的测试（m5，11-25）。设计：build/quick-run/设计-PR一条龙.md。
// 真实安装的 Control UI + 碧琪注入 + 假网关（tests/visual/lib/real-harness.mjs），1440 日 / 820 夜：
//   1. 只在 Metre：工作台状态栏有「PR」；切到别的模式重画状态栏就没有，open() 也不取状态；
//   2. CI 没全绿：「合并」灰着并写「CI 还没全绿。」，硬点也不调 pinkie.pr.merge；
//   3. CI 全绿：点「合并」先出页内确认（写 PR 号、base、头），不调 merge；「取消」收回；
//      再点「合并」→「确认合并」才调一次 pinkie.pr.merge，confirm = <号>@<头>；
//   4. 合并按钮边框对按钮底、字对按钮底的对比度（日 / 夜）。
// 网关方法 pinkie.pr.* 在页里替换 __pinkieWorkbench.rpc 回假数据（后端另有 pr-flow / pr-flow-e2e 测试），不碰真 gh。
// 反例：让「合并」按钮直接调 merge（跳过确认）→ 第 3 条变红（见 PR #119 说明）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
const pr = (checks) => ({number: 7, title: '加 PR 页', state: 'OPEN', isDraft: false, headRefName: 'feat/m5-pr-page', baseRefName: 'main', headRefOid: HEAD, statusCheckRollup: checks});
const status = (checks) => ({ready: true, current: pr(checks), recent: [pr(checks)], progress: null});
const PENDING = [{name: 'windows-checks', conclusion: 'SUCCESS'}, {name: 'macos-check', state: 'PENDING'}];
const GREEN = [{name: 'windows-checks', conclusion: 'SUCCESS'}, {name: 'macos-check', conclusion: 'SUCCESS'}];

// 在页里换掉工作台的 rpc：pinkie.pr.status 回 window.__prTestStatus，其余记下来。
const stub = (st) => {
  window.__prTestStatus = st;
  if (window.__prTestCalls) return;
  window.__prTestCalls = [];
  window.__pinkieWorkbench.rpc = async (method, params = {}) => {
    window.__prTestCalls.push({method, params});
    if (method === 'pinkie.pr.status') return window.__prTestStatus;
    if (method === 'pinkie.pr.merge') return {merged: true, number: params.number, head: params.confirm?.split('@')[1]};
    return {};
  };
};
const calls = (method) => (window.__prTestCalls || []).filter((c) => c.method === method);
const mergeBtn = (page) => page.locator('.pk-mpr .pk-mpr__sec .pk-mpr__btn', {hasText: /^合并$/});
const contrast = () => {
  const lum = (s) => { const [r, g, b] = s.match(/[\d.]+/g).map(Number).slice(0, 3).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (x, y) => { const a = lum(x), c = lum(y); return Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 100) / 100; };
  const opaque = (s) => { const m = s.match(/[\d.]+/g); return m && (m.length < 4 || Number(m[3]) >= 0.99); };
  const b = [...document.querySelectorAll('.pk-mpr .pk-mpr__btn')].find((n) => n.textContent === '刷新'); if (!b) return null;
  const cs = getComputedStyle(b);
  let bg = cs.backgroundColor;
  if (!opaque(bg)) { bg = 'rgb(255, 255, 255)'; for (let el = b.parentElement; el; el = el.parentElement) { const x = getComputedStyle(el).backgroundColor; if (opaque(x)) { bg = x; break; } } }
  return {fg: cs.color, border: cs.borderTopColor, bg, text: ratio(cs.color, bg), edge: ratio(cs.borderTopColor, bg)};
};

// 出错时把页面现场写进测试输出（CI 不传截图，靠这个看是哪一步没对上）。
const scene = () => {
  const wb = window.__pinkieWorkbench, ds = document.documentElement.dataset;
  const b = document.querySelector('.pk-wb-status .pk-mpr__status'), r = b?.getBoundingClientRect();
  const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  const pv = document.querySelector('.pk-mpr')?.closest('[hidden]');
  return {active: wb?.state?.active, tabs: (wb?.state?.tabs || []).map((t) => t.path).slice(0, 6), visible: wb?.state?.visible,
    narrow: ds.pkWbNarrow, view: ds.pkWbView, mpr: (document.querySelector('.pk-mpr')?.textContent || '').slice(0, 200), mprHiddenBy: pv?.className || '',
    prBtn: r && {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)},
    prBtnTop: top ? (top === b || b.contains(top) ? 'self' : String(top.className || top.tagName)) : null,
    calls: (window.__prTestCalls || []).map((c) => c.method)};
};
async function step(t, page, pageErrors, label, run) {
  try { return await run(); }
  catch (error) { t.diagnostic(`${label} 现场 ${JSON.stringify(await page.evaluate(scene).catch((e) => String(e)))} 页面报错 ${JSON.stringify(pageErrors)}`); throw error; }
}

async function openBench(page) {
  // 「打开工作台」在顶栏右侧，CI 的窄视口里会被原生窗口按钮组（最小化）盖住、指针点不到（main 上就这样，不归本 PR），
  // 所以直接调按钮自己的 click，测的是 PR 页，不是顶栏布局。
  const reopen = page.locator('.pk-wb-reopen');
  if (await reopen.isVisible().catch(() => false)) await reopen.evaluate((b) => b.click());
  await page.waitForSelector('.pk-wb-status .pk-mpr__status', {timeout: 8_000});
  // 假网关（scripts/chat-ui-harness/fake-gateway.js）对 pinkie.fs.status 回 {}，工作台就拿到 root = undefined，
  // 开任何页签时 renderTabs → absolute() 调 state.root.replace 会抛错（CI 现场：active 是 page:pr、PR 页没画、一个 rpc 都没调）。
  // 真网关总会回 root（services/mode-architecture/workbench.mjs 的 scope），这里照真网关补一个，测的是 PR 页，不是假网关。
  await page.evaluate(() => { const st = window.__pinkieWorkbench.state; if (typeof st.root !== 'string' || !st.root) st.root = '/tmp/pinkie-pr-real'; });
}

test('PR 页 real page: 只在 Metre，CI 没绿合并灰着，合并要页内再确认（1440 日 / 820 夜）', async (t) => {
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
  browser = await launchRealBrowser();

  for (const [width, theme] of [[1440, 'day'], [820, 'night']]) {
    await t.test(`PR 页 ${width} ${theme}`, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
      try {
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.setViewportSize({width, height: 800});
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
        await openBench(page);
        await page.evaluate(stub, status(PENDING));

        // 1. 只在 Metre
        const offMetre = await page.evaluate(async () => {
          const root = document.documentElement, keep = root.getAttribute('data-laolao-mode');
          root.setAttribute('data-laolao-mode', 'project');
          window.__pinkieWorkbench.renderStatus();
          const item = !!document.querySelector('.pk-wb-status .pk-mpr__status');
          const before = window.__prTestCalls.length;
          await window.Pinkie.metrePr.open();
          const fetched = window.__prTestCalls.length - before;
          root.setAttribute('data-laolao-mode', keep);
          window.__pinkieWorkbench.renderStatus();
          return {item, fetched, back: !!document.querySelector('.pk-wb-status .pk-mpr__status')};
        });
        assert.deepEqual(offMetre, {item: false, fetched: 0, back: true}, '别的模式下没有「PR」入口、不取状态；回到 Metre 又有');

        // 2. CI 没全绿：合并灰着、写原因、硬点也不合并
        // 820 宽时 Metre 的后台状态带（position: fixed，main 上的）会压在工作台状态栏上、指针点不到「PR」，
        // 先用真指针点 3 秒；点不到就把现场写进输出、改调按钮自己的 click（测的是 PR 页，不是状态带布局）。
        await page.click('.pk-wb-status .pk-mpr__status', {timeout: 3_000}).catch(async () => {
          t.diagnostic(`PR 页 ${width} ${theme}「PR」入口指针点不到，现场 ${JSON.stringify(await page.evaluate(scene))}`);
          await page.locator('.pk-wb-status .pk-mpr__status').evaluate((b) => b.click());
        });
        await step(t, page, pageErrors, `PR 页 ${width} ${theme} 等 PR 页头`, () => page.waitForSelector('.pk-mpr .pk-mpr__head .pk-mpr__meta', {timeout: 8_000}));
        const meta = await page.textContent('.pk-mpr__meta');
        assert.match(meta, /feat\/m5-pr-page → main · 头 abcdef12 · CI：1 \/ 2 通过/);
        assert.equal(await mergeBtn(page).isDisabled(), true, 'CI 没全绿时「合并」灰着');
        assert.equal((await page.textContent('.pk-mpr .pk-mpr__sec:last-of-type .pk-mpr__why')).trim(), 'CI 还没全绿。');
        await mergeBtn(page).evaluate((b) => b.click());
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.pk-mpr__confirm').count(), 0, '灰着的按钮点了不出确认');
        assert.equal((await page.evaluate(calls, 'pinkie.pr.merge')).length, 0, 'CI 没绿不调 merge');

        // 4. 对比度（按钮底多半透明，取背后实际底色）
        const c = await page.evaluate(contrast);
        t.diagnostic(`PR 页 ${width} ${theme} 对比 ${JSON.stringify(c)}`);
        assert.ok(c.text >= 4.5, `按钮字 / 底 ${c.text} < 4.5（${c.fg} on ${c.bg}）`);
        assert.ok(c.edge >= 3, `按钮边框 / 底 ${c.edge} < 3（${c.border} on ${c.bg}）`);

        // 3. CI 全绿：合并要页内再确认
        await page.evaluate(stub, status(GREEN));
        await page.click('.pk-mpr__bar .pk-mpr__btn >> text=刷新');
        await page.waitForFunction(() => /CI：2 \/ 2 通过/.test(document.querySelector('.pk-mpr__meta')?.textContent || ''), null, {timeout: 5_000});
        assert.equal(await mergeBtn(page).isDisabled(), false, 'CI 全绿「合并」能点');
        await mergeBtn(page).click();
        await page.waitForSelector('.pk-mpr__confirm', {timeout: 3_000});
        const ask = await page.textContent('.pk-mpr__confirm p');
        assert.match(ask, /#7.*main.*头 abcdef12/, `确认写 PR 号、base、头（${ask}）`);
        assert.equal((await page.evaluate(calls, 'pinkie.pr.merge')).length, 0, '点「合并」只出确认，不调 merge');
        await page.click('.pk-mpr__confirm .pk-mpr__btn >> text=取消');
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.pk-mpr__confirm').count(), 0, '取消收回确认');
        assert.equal((await page.evaluate(calls, 'pinkie.pr.merge')).length, 0, '取消不调 merge');
        await mergeBtn(page).click();
        await page.click('.pk-mpr__confirm .pk-mpr__btn >> text=确认合并');
        await page.waitForFunction(() => /#7 已合并/.test(document.querySelector('.pk-mpr')?.textContent || ''), null, {timeout: 5_000});
        const merges = await page.evaluate(calls, 'pinkie.pr.merge');
        assert.deepEqual(merges.map((m) => m.params), [{number: 7, confirm: `7@${HEAD}`}], '确认后只调一次 merge，confirm = 号@头');
        assert.deepEqual(pageErrors, [], '页面没有报错');
      } finally {
        await context.close();
      }
    });
  }
});
