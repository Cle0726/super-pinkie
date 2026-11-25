// M5 第六批：Metre 侧栏「筛选」在真实 Control UI 上的复发测试（界面审查打回 1124 23:55 第 1–3 条）。
// 真实安装的 Control UI + 碧琪注入 + 假网关（tests/visual/lib/real-harness.mjs），三宽 × 日夜：
//   1. 1024 / 820 侧栏是抽屉：用鼠标点筛选菜单里的一项，抽屉不能被收掉（.shell 仍有 shell--nav-drawer-open、侧栏 x=0）；
//   2. 选中后「筛选」键的按下态真的有底色（计算值不是透明），没在筛选时仍是透明；
//   3. 筛到 0 条（预置会话没有未读）时有一行空态提示和「显示全部」，不截断、不出侧栏；点「显示全部」列表回来；
//      空态正文和它实际底色的对比度 ≥ 4.5:1（监工打回 11-24 20:14 第 3 条）。
// 监工打回 11-24 20:14 第 1、2 条：
//   4. 菜单打开时和按键（侧栏列表那一栏）等宽、底不透明，菜单上下范围内没有会话列表的字露在菜单右边；
//   5. 「筛选」键只有一个图标：静止 / 菜单打开（指针还在键上）/ 筛选=未读 / 未读时再打开菜单，图标都相同，
//      和侧栏其他键（新会话、搜索、作品、总谱、模式切换箭头）都不一样；打开 / 关闭菜单时键上文字不变。
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

// 侧栏各键图标（::before 的 mask；模式切换键的箭头 mask 在元素自己身上）和「筛选」键上的文字
const keys = () => {
  const mask = (e, pseudo) => { if (!e) return null; const cs = getComputedStyle(e, pseudo); return cs.maskImage || cs.webkitMaskImage || null; };
  const q = (sel) => document.querySelector('aside.sidebar ' + sel);
  return {
    filter: mask(q('.pk-metre-nav--filter'), '::before'),
    label: q('.pk-metre-nav--filter')?.textContent.trim(),
    others: {
      newSession: mask(q('.sidebar-new-session'), '::before'),
      search: mask(q('.pinkie-sidebar-entry--search'), '::before'),
      artifacts: mask(q('.pinkie-sidebar-entry--artifacts'), '::before'),
      board: mask(q('.pk-metre-nav--board'), '::before'),
      modeArrow: mask(q('.laolao-mode-switcher .laolao-mode-button__arrow')),
    },
  };
};

// 量按键底色前把焦点和指针挪开，量到的只是按下态，不是焦点 / 悬停底色。
async function restingBackground(page, width) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(width - 10, 790);
  await page.waitForTimeout(300);
  return page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, FILTER);
}

test('M5 b6 real page: Metre 会话筛选——鼠标选项不收抽屉、按下态有底色、0 条有空态、菜单盖满列表、图标固定（三宽 × 日夜）', async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  // 清理先注册：浏览器起不来时（如找不到 playwright-core）假服务也要关掉，否则 node 永远不退出。
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
          const k0 = await page.evaluate(keys);
          assert.ok(k0.filter && k0.filter !== 'none', `「筛选」键有图标（实际 ${k0.filter}）`);
          for (const [name, m] of Object.entries(k0.others)) assert.notEqual(k0.filter, m, `「筛选」键图标和${name}不同`);

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
          // 第 4 条：菜单盖满侧栏列表那一栏，右边不露出列表残片
          const cover = await page.evaluate((sel) => {
            const menu = document.querySelector('.pk-mw-filter-menu');
            const b = document.querySelector(sel).getBoundingClientRect();
            const m = menu.getBoundingClientRect();
            const bg = getComputedStyle(menu).backgroundColor;
            const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg)?.[1];
            const leak = [];
            for (const e of document.querySelectorAll('#laolao-session-manager *')) {
              if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
              const cs = getComputedStyle(e);
              if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
              for (const r of e.getClientRects()) {
                if (r.width < 1 || r.bottom <= m.top + 1 || r.top >= m.bottom - 1) continue;
                if (r.right > m.right + 0.5) leak.push(`${e.textContent.trim().slice(0, 12)}@${Math.round(r.left)}..${Math.round(r.right)}`);
              }
            }
            return {keyL: Math.round(b.left), keyR: Math.round(b.right), menuL: Math.round(m.left), menuR: Math.round(m.right), bg, opaque: alpha == null || Number(alpha) === 1, leak: leak.slice(0, 6)};
          }, FILTER);
          t.diagnostic(`${width} ${theme} 菜单 ${JSON.stringify(cover)}`);
          assert.ok(cover.menuL <= cover.keyL + 1 && cover.menuR >= cover.keyR - 1, `菜单和按键等宽、盖满侧栏列表那一栏：${JSON.stringify(cover)}`);
          assert.ok(cover.opaque, `菜单底不透明（实际 ${cover.bg}）`);
          assert.deepEqual(cover.leak, [], '菜单上下范围内没有会话列表的字露在菜单右边');
          // 第 5 条：菜单打开时（指针还停在键上）图标和文字不跳
          const k1 = await page.evaluate(keys);
          assert.equal(k1.filter, k0.filter, '菜单打开时「筛选」键图标不变');
          assert.equal(k1.label, k0.label, '菜单打开时「筛选」键文字不变');
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
          const k2 = await page.evaluate(keys);
          assert.equal(k2.filter, k0.filter, '筛选=未读时「筛选」键图标不变');
          assert.equal(k2.label, '筛选 · 未读');
          await page.click(FILTER);
          await page.waitForSelector('.pk-mw-filter-menu', {timeout: 3_000});
          const k3 = await page.evaluate(keys);
          assert.equal(k3.filter, k0.filter, '未读时再打开菜单，图标不变');
          assert.equal(k3.label, k2.label, '未读时再打开菜单，文字不变');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          assert.equal(await page.evaluate(() => Boolean(document.querySelector('.pk-mw-filter-menu'))), false, 'Esc 关菜单');
          assert.equal((await page.evaluate(keys)).label, k2.label, '关菜单后文字不变');

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
            // color-mix 的计算值是 color(srgb r g b [/ a])，通道 0–1；rgb()/rgba() 是 0–255
            const rgb = (c) => { const v = (c.match(/[\d.]+/g) || []).map(Number); return c.startsWith('color(srgb') ? v.map((x, i) => (i < 3 ? x * 255 : x)) : v; };
            const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
            let bgc = null;
            for (let n = text; n && !bgc; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] === 1)) bgc = c; }
            const fg = rgb(getComputedStyle(text).color);
            const [hi, lo] = [lum(fg), lum(bgc || [255, 255, 255])].sort((a, b) => b - a);
            const ratio = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
            return {fg: getComputedStyle(text).color, bg: bgc ? `rgb(${bgc.slice(0, 3).join(', ')})` : null, ratio, text: text.textContent, all: all.textContent, inside: r.left >= side.left - 1 && r.right <= side.right + 1 && ar.right <= side.right + 1, trunc: trunc(text) || trunc(all), h: Math.round(r.height)};
          });
          assert.ok(empty, '0 条时有空态提示');
          assert.equal(empty.text, '没有未读的会话');
          assert.equal(empty.all, '显示全部');
          assert.ok(empty.inside && !empty.trunc, `空态不截断、不出侧栏：${JSON.stringify(empty)}`);
          t.diagnostic(`${width} ${theme} 空态正文 ${empty.fg} 底 ${empty.bg} 对比度 ${empty.ratio}:1`);
          assert.ok(empty.bg && empty.ratio >= 4.5, `空态正文对比度 ≥ 4.5:1：${JSON.stringify(empty)}`);

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
