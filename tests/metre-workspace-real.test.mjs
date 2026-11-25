// M5 第六批：Metre 侧栏「筛选」在真实 Control UI 上的复发测试（界面审查打回 1124 23:55 第 1–3 条）。
// 真实安装的 Control UI + 碧琪注入 + 假网关（tests/visual/lib/real-harness.mjs），三宽 × 日夜：
//   1. 1024 / 820 侧栏是抽屉：用鼠标点筛选菜单里的一项，抽屉不能被收掉（.shell 仍有 shell--nav-drawer-open、侧栏 x=0）；
//   2. 选中后「筛选」键的按下态真的有底色（计算值不是透明），没在筛选时仍是透明；
//   3. 筛到 0 条（预置会话没有未读）时有一行空态提示和「显示全部」，不截断、不出侧栏；点「显示全部」列表回来。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/;
const FILTER = 'aside.sidebar .pk-metre-nav--filter';

const state = () => {
  const shell = document.querySelector('.shell');
  const side = document.querySelector('aside.sidebar');
  return {
    drawerOpen: Boolean(shell?.classList.contains('shell--nav-drawer-open')),
    sideLeft: side ? Math.round(side.getBoundingClientRect().left) : null,
    filter: document.documentElement.getAttribute('data-pk-mw-filter'),
    menu: Boolean(document.querySelector('.pk-mw-filter-menu')),
    rows: [...document.querySelectorAll('#laolao-session-manager .session-row-host')].filter((n) => n.getClientRects().length).length,
  };
};

async function openMetre(browser, origin, width, theme) {
  const opened = await openRealScenePage(browser, origin, 'metre-board', theme);
  const {page} = opened;
  await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
  await page.setViewportSize({width, height: 800});
  await page.waitForTimeout(400);
  const left = await page.evaluate(() => Math.round(document.querySelector('aside.sidebar')?.getBoundingClientRect().left ?? -9999));
  if (left < 0) {
    // 窄宽下侧栏是抽屉：点原生「展开侧边栏」
    await page.click('button[aria-label="展开侧边栏"]');
    await page.waitForFunction(() => document.querySelector('aside.sidebar')?.getBoundingClientRect().left >= 0, null, {timeout: 5_000});
    await page.waitForTimeout(300);
  }
  await page.waitForSelector(FILTER, {timeout: 5_000});
  return opened;
}

// 量按键底色前把焦点和指针挪开，量到的只是按下态，不是焦点 / 悬停底色。
async function restingBackground(page, width) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(width - 10, 790);
  await page.waitForTimeout(300);
  return page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, FILTER);
}

test('M5 b6 real page: Metre 会话筛选——鼠标选项不收抽屉、按下态有底色、0 条有空态（三宽 × 日夜）', async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  const browser = await launchRealBrowser();
  t.after(async () => {
    await browser.close();
    await server.close();
    installed.cleanup();
  });

  for (const theme of ['day', 'night']) {
    for (const width of [1440, 1024, 820]) {
      await t.test(`${width} ${theme}`, async () => {
        const {context, page, pageErrors} = await openMetre(browser, server.origin, width, theme);
        try {
          const drawer = width < 1100;
          const s0 = await page.evaluate(state);
          assert.equal(s0.sideLeft, 0, '前提：侧栏在窗口里');
          if (drawer) assert.ok(s0.drawerOpen, '前提：抽屉开着');
          assert.ok(s0.rows > 0, '前提：有会话行');
          const idle = await restingBackground(page, width);
          assert.match(idle, TRANSPARENT, `没在筛选时「筛选」键是透明底（实际 ${idle}）`);

          // 第 1 条：鼠标点菜单项
          await page.click(FILTER);
          await page.waitForSelector('.pk-mw-filter-menu', {timeout: 3_000});
          const geo = await page.evaluate((sel) => {
            const menu = document.querySelector('.pk-mw-filter-menu');
            const b = document.querySelector(sel).getBoundingClientRect();
            const m = menu.getBoundingClientRect();
            return {inNav: Boolean(menu.closest('.shell-nav')), dx: Math.round(m.left - b.left), dy: Math.round(m.top - b.bottom), right: Math.round(m.right), bottom: Math.round(m.bottom)};
          }, FILTER);
          assert.ok(geo.inNav, '菜单挂在 .shell-nav 里（不在 body 上）');
          assert.ok(Math.abs(geo.dx) <= 2 && Math.abs(geo.dy - 4) <= 2, `菜单在按键正下方：${JSON.stringify(geo)}`);
          assert.ok(geo.right <= width && geo.bottom <= 800, `菜单在窗口内：${JSON.stringify(geo)}`);
          await page.locator('.pk-mw-filter-menu__item[data-filter="unread"]').click();
          await page.waitForTimeout(400);
          const s1 = await page.evaluate(state);
          assert.equal(s1.filter, 'unread', '选中了「未读」');
          assert.equal(s1.menu, false, '菜单收起');
          assert.equal(s1.sideLeft, 0, `鼠标选项后侧栏仍在 x=0（实际 ${s1.sideLeft}）`);
          if (drawer) assert.ok(s1.drawerOpen, '鼠标选项后抽屉仍开着（shell--nav-drawer-open 还在）');

          // 第 2 条：按下态底色
          const pressed = await restingBackground(page, width);
          t.diagnostic(`${width} ${theme} 按下态底色 ${pressed}`);
          assert.doesNotMatch(pressed, TRANSPARENT, `按下态有底色（实际 ${pressed}）`);

          // 第 3 条：0 条空态
          assert.equal(s1.rows, 0, '预置会话没有未读，筛完 0 行');
          const empty = await page.evaluate(() => {
            const box = document.querySelector('#laolao-session-manager .pk-mw-filter-empty');
            if (!box || !box.getClientRects().length) return null;
            const side = document.querySelector('aside.sidebar').getBoundingClientRect();
            const r = box.getBoundingClientRect();
            const text = box.querySelector('.pk-mw-filter-empty__text');
            const all = box.querySelector('.pk-mw-filter-empty__all');
            const ar = all.getBoundingClientRect();
            const trunc = (n) => n.scrollWidth > n.clientWidth + 1;
            return {text: text.textContent, all: all.textContent, inside: r.left >= side.left - 1 && r.right <= side.right + 1 && ar.right <= side.right + 1, trunc: trunc(text) || trunc(all), h: Math.round(r.height)};
          });
          assert.ok(empty, '0 条时有空态提示');
          assert.equal(empty.text, '没有未读的会话');
          assert.equal(empty.all, '显示全部');
          assert.ok(empty.inside && !empty.trunc, `空态不截断、不出侧栏：${JSON.stringify(empty)}`);

          await page.click('#laolao-session-manager .pk-mw-filter-empty__all');
          await page.waitForTimeout(400);
          const s2 = await page.evaluate(state);
          assert.equal(s2.filter, null, '「显示全部」清掉筛选');
          assert.ok(s2.rows > 0, '列表回来了');
          assert.equal(s2.sideLeft, 0, '点「显示全部」不收抽屉');
          if (drawer) assert.ok(s2.drawerOpen);
          assert.equal(await page.evaluate(() => Boolean(document.querySelector('#laolao-session-manager .pk-mw-filter-empty')?.getClientRects().length)), false, '有会话时不显示空态');
          assert.deepEqual(pageErrors, [], '页面没有报错');
        } finally {
          await context.close();
        }
      });
    }
  }
});
