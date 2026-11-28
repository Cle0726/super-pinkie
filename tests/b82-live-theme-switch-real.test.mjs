// B82 · 真页面：页面开着时系统深浅色一切换，html[data-pinkie-night] 和 pinkie:night 当场跟上（Chromium + WebKit 各一遍）。
// 正例：保存的配色是「跟随系统」，emulateMedia 切到深色 → 打上 data-pinkie-night、收到 pinkie:night(true)；切回浅色 → 拿掉。
// 反例：保存的是「浅色」，系统切到深色 → data-pinkie-night 不出现、也不发 pinkie:night。
// 每个引擎只开一个页面：正例跑完后在同页经原生配色控制器（__pinkieNight.setMode）改成 light，同时改存 themeMode 并补发 storage 事件让 laolao-night.js 重读设置
// （同页写 localStorage 不会自己发 storage；只改存储不改控制器的话，原生界面内存里仍是 system，系统切深色会把 data-theme-mode 写成 dark），再跑反例。
// 不调 settleRealPage（它会强制 setMode / data-theme-mode，盖掉要测的动态切换）。
// 不登记进 tests/webkit-ci.list：real-harness 的 WebKit 启动还在等 #115（见该文件表头）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const SCENE = 'metre-board';
const night = (page) => page.evaluate(() => document.documentElement.hasAttribute('data-pinkie-night'));

// 所有 openclaw.control.settings.v1[:*] 键都改，laolao-night.js 会按顺序读
const SET_THEME_MODE = `
  const prefix = 'openclaw.control.settings.v1';
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== prefix && !key.startsWith(prefix + ':')) continue;
    try { localStorage.setItem(key, JSON.stringify({...JSON.parse(localStorage.getItem(key) || '{}'), themeMode: mode})); } catch {}
  }
`;
// 在 harness 写完 settings 之后再改 themeMode（作为 initScript 每次加载都跑）
const savedThemeMode = (mode) => new Function(`const mode = ${JSON.stringify(mode)};${SET_THEME_MODE}`);
// 页面开着时改配色：走原生配色控制器（和设置页同一条路），否则它内存里仍是 system，系统切深色时会自己把 data-theme-mode 写成 dark；
// 再把所有设置键改掉并补发 storage 事件，让 laolao-night.js 重读
const switchThemeMode = (page, mode) => page.evaluate(([body, m]) => {
  const native = window.__pinkieNight?.setMode?.(m) === true;
  new Function('mode', body)(m);
  window.dispatchEvent(new StorageEvent('storage', {key: 'openclaw.control.settings.v1'}));
  return native;
}, [SET_THEME_MODE, mode]);
const themeAttr = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme-mode'));

// 先在页面里挂好监听（返回对象句柄，不等事件），再切系统外观，免得监听晚于切换
const armNightEvent = (page) => page.evaluateHandle(() => {
  const box = {};
  box.done = new Promise((resolve) => window.addEventListener('pinkie:night', (e) => resolve(e.detail), {once: true}));
  return box;
});
const firedWithin = (handle, ms) => handle.evaluate((box, wait) => Promise.race([
  box.done.then((detail) => ({fired: true, detail})),
  new Promise((resolve) => setTimeout(() => resolve({fired: false}), wait)),
]), ms);

test('B82 真页面：跟随系统时深浅色实时同步；保存浅色时系统切深色不跟', {timeout: 300_000}, async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  t.after(async () => {
    try { await server?.close(); }
    finally { installed.cleanup(); }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});

  for (const engine of ['chromium', 'webkit']) {
    await t.test(engine, async (st) => {
      let browser;
      try { browser = await launchRealBrowser(engine); }
      catch (err) { st.skip(`${engine} 起不来：${err.message.split('\n')[0]}`); return; }
      try {
        const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, SCENE, 'day', {initScript: savedThemeMode('system')});
        try {
          await st.test('正例：themeMode=system，系统切深色再切回浅色', async () => {
            assert.equal(await night(page), false, '系统浅色 + 跟随系统：一开始不应是黑夜');

            let armed = await armNightEvent(page);
            await page.emulateMedia({colorScheme: 'dark'});
            await page.waitForFunction(() => document.documentElement.hasAttribute('data-pinkie-night'), null, {timeout: 5000});
            assert.deepEqual(await firedWithin(armed, 2000), {fired: true, detail: true}, '切到深色要发 pinkie:night(true)');

            armed = await armNightEvent(page);
            await page.emulateMedia({colorScheme: 'light'});
            await page.waitForFunction(() => !document.documentElement.hasAttribute('data-pinkie-night'), null, {timeout: 5000});
            assert.deepEqual(await firedWithin(armed, 2000), {fired: true, detail: false}, '切回浅色要发 pinkie:night(false)');

            assert.deepEqual(pageErrors, [], '页面不能报错');
          });

          await st.test('反例：themeMode=light，系统切深色不跟', async () => {
            // 配色从 system 换成 light 会让 laolao-night.js 发一次 pinkie:night(false)，收到它才说明页面确实按 light 重读了
            const reread = await armNightEvent(page);
            assert.equal(await switchThemeMode(page, 'light'), true, '要能通过原生配色控制器改成浅色，否则反例测不到真实路径');
            assert.deepEqual(await firedWithin(reread, 2000), {fired: true, detail: false}, '改存浅色后页面要重读配色');
            await page.waitForFunction(() => document.documentElement.getAttribute('data-theme-mode') === 'light', null, {timeout: 5000});
            assert.equal(await night(page), false);

            const armed = await armNightEvent(page);
            await page.emulateMedia({colorScheme: 'dark'});
            assert.deepEqual(await firedWithin(armed, 1500), {fired: false}, '保存浅色时不应因系统外观发 pinkie:night');
            assert.equal(await night(page), false, '保存浅色时系统切深色不能打上 data-pinkie-night');
            assert.equal(await themeAttr(page), 'light', '保存浅色时原生界面也不能跟着系统切成深色');
            assert.deepEqual(pageErrors, [], '页面不能报错');
          });
        } finally { await context.close(); }
      } finally { await browser.close(); }
    });
  }
});
