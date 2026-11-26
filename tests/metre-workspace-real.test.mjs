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
import fs from 'node:fs';
import path from 'node:path';
import test, {after} from 'node:test';
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

// CI 提速：整个文件只起一个浏览器，两个顶层测试共用。
// 隔离不变：每个子测试仍由 openRealScenePage 新建 context，结束就关。
// launch 的 Promise 只建一次；起不来时两个测试收到同一次失败，不改成跳过。
let sharedBrowser;
// 安装（拷上游包 + bundle install/stamp/check）也整个文件只做一次：CI 上一次约 25s，原来两个顶层测试各做一遍。
// 装不上时记住那次失败，两个测试都重抛（不改成跳过）。
let sharedInstall;
after(async () => {
  try {
    const browser = sharedBrowser && await sharedBrowser.catch(() => null);
    if (browser) await browser.close();
  } finally {
    sharedInstall?.installed?.cleanup();
  }
});
function browserForFile() {
  sharedBrowser ??= launchRealBrowser();
  return sharedBrowser;
}
function installForFile() {
  if (!sharedInstall) {
    try { sharedInstall = {installed: installRealControlUi({repoRoot: REPO_ROOT})}; }
    catch (error) { sharedInstall = {error}; }
  }
  if (sharedInstall.error) throw sharedInstall.error;
  return sharedInstall.installed;
}
// 假服务仍是每个顶层测试各起一个：它在 runDir 下落盘会话偏好（pinkie.session.prefs.set），
// 每个测试给一个新的 state 子目录，两个测试互相看不到对方写的偏好；子目录随安装目录一起删。
async function serverForTest(t) {
  const installed = installForFile();
  const runDir = fs.mkdtempSync(path.join(installed.runDir, 'state-'));
  const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir});
  t.after(() => server.close());
  return server;
}

test('M5 b6 real page: Metre 会话筛选——鼠标选项不收抽屉、按下态有底色、0 条有空态、菜单盖满列表、图标固定（三宽 × 日夜）', async (t) => {
  // 假服务的关闭在 serverForTest 里起好就登记；浏览器起不来时假服务照样关，node 能退出。
  // 浏览器和安装目录是全文件共用的，由文件级 after 收拾。
  const server = await serverForTest(t);
  const browser = await browserForFile();

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

// K2 Esc 复发测试（协调者打回 11-25，依据 mac1 报告 #86@cfd93253）：输入框下方关着的
// <details class="laolao-context-viewer"> 里有 section[role=dialog]，计算样式是 block、getClientRects 有一块，
// 但看不见。旧的 shown() 只看 getClientRects，把它算成开着的弹层，escape() 一进来就让路。
//   1. 前提：页面上真有这个关着的查看器，且它的弹层 getClientRects 非空（不然测不到这个坑）；
//   2. 输入框有字 → 两下 Esc 变空；
//   3. 有停止键时 Esc 点到它（假停止键挂在真输入区里，只数点击）；
//   4. 反例：查看器真的打开时，弹层归它，两下 Esc 不清输入框、不点停止键。
const BOX = '.agent-chat__input textarea';
const viewerState = () => {
  const v = document.querySelector('.agent-chat__input details.laolao-context-viewer');
  const p = v && (v.__lcvPanel || v.querySelector('.laolao-context-viewer__popover'));
  return v ? {open: v.open, role: p?.getAttribute('role') || null, rects: p ? p.getClientRects().length : 0} : null;
};

async function fillBox(page, text) {
  await page.click(BOX);
  await page.fill(BOX, text);
  await page.waitForTimeout(100);
}
async function doubleEsc(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  return page.inputValue(BOX);
}
const addFakeStop = () => {
  const host = document.querySelector('.agent-chat__input');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-send-btn chat-send-btn--stop pk-test-fake-stop';
  btn.textContent = '停';
  btn.style.cssText = 'position:fixed;left:4px;top:4px;width:24px;height:24px;z-index:99999';
  window.__pkTestStopClicks = 0;
  btn.addEventListener('click', () => { window.__pkTestStopClicks += 1; });
  host.append(btn);
  return Boolean(btn.getClientRects().length);
};
const removeFakeStop = () => document.querySelector('.pk-test-fake-stop')?.remove();

test('M5 b6 real page: K2 Esc——关着的上下文查看器不挡 Esc；两下 Esc 清空、Esc 点停止键；查看器开着时让路（1440 日 / 820 夜）', async (t) => {
  // 浏览器和安装目录全文件共用（文件级 after 收拾）；假服务本测试自己一个，起好就登记关闭。
  const server = await serverForTest(t);
  const browser = await browserForFile();

  for (const [width, theme] of [[1440, 'day'], [820, 'night']]) {
    await t.test(`K2 ${width} ${theme}`, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
      try {
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.setViewportSize({width, height: 800});
        await page.waitForSelector(BOX, {timeout: 5_000});
        await page.waitForSelector('.agent-chat__input details.laolao-context-viewer', {state: 'attached', timeout: 8_000});
        await page.waitForTimeout(300);

        // 1. 前提
        const v0 = await page.evaluate(viewerState);
        t.diagnostic(`K2 ${width} ${theme} 查看器 ${JSON.stringify(v0)}`);
        assert.ok(v0, '前提：输入区有上下文查看器');
        assert.equal(v0.open, false, '前提：查看器关着');
        assert.equal(v0.role, 'dialog', '前提：查看器弹层带 role=dialog（会匹配 LAYERS）');
        assert.ok(v0.rects > 0, '前提：关着时弹层 getClientRects 仍非空（旧 shown() 会误判）');
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');

        // 2. 两下 Esc 清空
        await fillBox(page, '测试草稿');
        assert.equal(await doubleEsc(page), '', '输入框有字，0.5 秒内两下 Esc 清空');
        await fillBox(page, '慢一点');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        assert.equal(await page.inputValue(BOX), '慢一点', '两下隔太久不清空');
        await page.fill(BOX, '');

        // 3. Esc 点停止键
        assert.ok(await page.evaluate(addFakeStop), '前提：假停止键看得见');
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => window.__pkTestStopClicks), 1, '在跑时 Esc 点到停止键一次');

        // 4. 反例：查看器开着，Esc 归它
        await page.evaluate(() => { document.querySelector('.agent-chat__input details.laolao-context-viewer').open = true; });
        await page.waitForTimeout(300);
        assert.equal((await page.evaluate(viewerState)).open, true, '反例前提：查看器开着');
        await page.evaluate(() => { window.__pkTestStopClicks = 0; document.activeElement?.blur?.(); });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => window.__pkTestStopClicks), 0, '查看器开着时 Esc 不点停止键');
        await page.evaluate(removeFakeStop);
        await page.evaluate(() => { document.querySelector('.agent-chat__input details.laolao-context-viewer').open = true; });
        await page.waitForTimeout(200);
        await page.evaluate((sel) => { const b = document.querySelector(sel); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(b, '还在'); b.dispatchEvent(new Event('input', {bubbles: true})); b.focus(); }, BOX);
        await page.waitForTimeout(150);
        assert.equal(await doubleEsc(page), '还在', '查看器开着时两下 Esc 不清输入框');
        await page.evaluate(() => { document.querySelector('.agent-chat__input details.laolao-context-viewer').open = false; });
        assert.deepEqual(pageErrors, [], '页面没有报错');
      } finally {
        await context.close();
      }
    });
  }
});
