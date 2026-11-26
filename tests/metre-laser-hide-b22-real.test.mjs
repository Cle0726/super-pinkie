// B22 复发防护（真页面）：Metre 里激光笔入口必须藏住，不能把底栏设置齿轮挤到连接方灯上。
// uireview #225 记：windows 日间 /cron 1440 底栏多出 pinkie-laser-entry（179..211），设置齿轮被挤到 147..177，
// 和方灯（141..151）横向叠 4px。原因：laolao-laser-pointer.js mount() 给按钮的 class 是 sidebar-brand__icon sidebar-footer-icon，
// laolao-metre-skin.css「侧栏交互图标」那条（:not(#_m1..#_m3) + :is(... .sidebar-brand__icon)，特异度 3,3,2）给它
// display: inline-flex !important，压过原来特异度 3,1,1 的 Metre 隐藏规则。Metre 里激光笔不轮询、只在载入时挂一次，
// 所以只有底栏先到的那次载入会露出来（看着像时好时坏）。
// 这里在真实安装的 OpenClaw Control UI + 碧琪注入上进 /cron，照 mount() 的样子确定地挂上按钮（不靠时机），日夜各量一遍：
// 按钮 display 必须是 none，底栏没有任何按钮压到方灯。
// 反例写在测试里：把隐藏规则换回原来的选择器（:not(#_m1):not(#_m2)），按钮必须重新露出来。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

// 照 laolao-laser-pointer.js mount()：挂进底栏图标那一排，放在「更多工具」前面，class 一样。
function mountLikeLaser() {
  const footer = document.querySelector('.sidebar-shell__footer');
  const host = footer?.querySelector('.sidebar-footer-actions') || footer?.querySelector('.sidebar-footer-bar') || footer;
  if (!host) return false;
  let btn = document.getElementById('pinkie-laser-entry');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'pinkie-laser-entry';
    btn.type = 'button';
    btn.className = 'sidebar-brand__icon sidebar-footer-icon';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20 14 10"></path></svg>';
    const more = host.querySelector('.laolao-footer-more');
    if (more) more.before(btn); else host.append(btn);
  }
  return true;
}

// 量：激光笔按钮的 display，方灯和底栏每个看得见的按钮的横向 / 纵向范围，谁压了方灯。
function readFoot() {
  const side = document.querySelector('aside.sidebar');
  const laser = document.getElementById('pinkie-laser-entry');
  const lamp = side?.querySelector('.pinkie-connection-status');
  const box = (e) => { const r = e.getBoundingClientRect(); return {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom)}; };
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const lb = lamp && shown(lamp) ? box(lamp) : null;
  const items = [];
  for (const e of side?.querySelectorAll('.sidebar-shell__footer :is(button, a, [role="button"])') || []) {
    if (e.closest('.laolao-mode-switcher, .pinkie-connection-status') || !shown(e)) continue;
    items.push({id: e.id || e.getAttribute('aria-label') || e.title || e.className.split(' ')[0], ...box(e)});
  }
  const onLamp = lb ? items.filter((i) => i.l < lb.r && lb.l < i.r && i.t < lb.b && lb.t < i.b).map((i) => i.id) : [];
  return {laserDisplay: laser ? getComputedStyle(laser).display : null, lamp: lb, items, onLamp};
}

const HIDE_NEW = 'html[data-laolao-mode="metre"]:not(#_m1):not(#_m2):not(#_m3):not(#_m4)';
const HIDE_OLD = 'html[data-laolao-mode="metre"]:not(#_m1):not(#_m2)';

test('B22 real page: in Metre the laser entry stays hidden on /cron and nothing in the footer sits on the lamp; with the old hide selector it shows again', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    const {context, page, meta} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      await page.setViewportSize({width: 1440, height: 900});
      await page.goto(`${server.origin}/cron?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`, {waitUntil: 'load', timeout: 60_000});
      await page.waitForFunction(() => document.documentElement.getAttribute('data-laolao-mode') === 'metre', null, {timeout: 30_000});
      await page.waitForSelector('aside.sidebar .sidebar-shell__footer .pinkie-connection-status', {timeout: 30_000});
      assert.ok(await page.evaluate(mountLikeLaser), `${theme}: 找不到底栏，挂不上激光笔按钮`);
      await page.waitForTimeout(300);
      const got = await page.evaluate(readFoot);
      const show = JSON.stringify(got);
      console.log(`ℹ ${theme}: ${show}`);
      assert.ok(got.lamp, `${theme}: 没量到方灯 — ${show}`);
      assert.equal(got.laserDisplay, 'none', `${theme}: Metre 里激光笔按钮露出来了 — ${show}`);
      assert.deepEqual(got.onLamp, [], `${theme}: 底栏有按钮压在方灯上 — ${show}`);

      if (theme === 'day') {
        // 反例：把隐藏规则换回原来的选择器，激光笔按钮必须重新露出来（被「侧栏交互图标」那条压过）。
        const swapped = await page.evaluate(({nu, old}) => {
          for (const sh of document.styleSheets) {
            if (!/laolao-metre-skin\.css/.test(sh.href || '')) continue;
            for (let i = 0; i < sh.cssRules.length; i++) {
              const r = sh.cssRules[i];
              // 只认隐藏规则本身：同时带激光笔入口和新选择器（皮肤里更早还有别的规则也列了 #pinkie-power-entry）。
              const sel = r.selectorText || '';
              if (!sel.includes('#pinkie-laser-entry') || !sel.includes(nu)) continue;
              const text = r.cssText.split(nu).join(old);
              if (text === r.cssText) return -1;
              sh.deleteRule(i);
              sh.insertRule(text, i);
              return sh.cssRules[i].selectorText.includes(nu) ? -1 : 1;
            }
          }
          return 0;
        }, {nu: HIDE_NEW, old: HIDE_OLD});
        assert.equal(swapped, 1, '没找到 Metre 激光笔隐藏规则（或换不回原选择器）');
        await page.waitForTimeout(300);
        const bad = await page.evaluate(readFoot);
        console.log(`ℹ day with old selector: ${JSON.stringify(bad)}`);
        assert.notEqual(bad.laserDisplay, 'none', '反例没生效：换回原选择器后激光笔按钮仍是 display none');
      }
    } finally {
      await context.close();
    }
  }
});
