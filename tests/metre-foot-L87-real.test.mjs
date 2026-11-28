// L87（win-coord #96）：Metre 侧栏底栏，开着工作台（data-pk-wb-compact="1"）时连接方灯和设置挤在一起排在右边。
// 原因：方灯的六条定位规则（laolao-metre-skin.css 815 / 885 / 931 / 1511 / 1530 / 2009）不管工作台开没开都生效，
// 开工作台后方灯仍被绝对定位到黑卡右边（或被 margin-left: 112px 推开），离设置很远。
// 修复：六条都加 :not([data-pk-wb-compact="1"])，开工作台时方灯回到底栏的 flex 流里（779 行 justify-content: flex-end 不动），
// 方灯是 footer.prepend 进去的，自然排在设置左边、整排靠右。关工作台时六条照旧生效（B14 / fix-main 测的那个样子）。
// 真实安装的 OpenClaw Control UI + 碧琪注入，metre-board 场景 1440 宽，日 / 夜，开 / 关工作台都量：
//   开：方灯在设置左边，两者竖直中心差 ≤ 2px，水平间距 ≤ 8px；
//   关：data-pk-wb-compact 不在，只记位置（B14 已断言方灯在黑卡右边、和卡竖直居中）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

// 假网关只回 {}：这里在页里接住工作台出来要的 pinkie.fs.*（和 workbench-status-fit-real 同一套做法），不然 show() 要等满 3 s。
const initScript = new Function(`
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': () => ({entries: [{name: 'README.md', path: 'README.md', kind: 'file'}]}),
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', ahead: 0, behind: 0, changes: []}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__l87) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function l87Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__l87 = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

// 在页里：方灯、设置键和底栏里每个看得见的可点项的框。
function measureFoot() {
  const side = document.querySelector('aside.sidebar');
  const bar = side?.querySelector('.sidebar-footer-bar');
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return {l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, mid: Math.round((r.top + r.height / 2) * 10) / 10}; };
  const lamp = bar?.querySelector('.pinkie-connection-status');
  const gear = [...(bar?.querySelectorAll('a.sidebar-footer-icon[aria-label="设置"], .laolao-footer-more') || [])].find(shown) || null;
  const items = [...(bar?.querySelectorAll('button, a, [role="button"]') || [])].filter(shown)
    .map((e) => ({id: e.id || e.getAttribute('aria-label') || String(e.className).split(' ')[0] || e.tagName, ...box(e)}));
  return {
    compact: document.documentElement.dataset.pkWbCompact ?? null,
    wb: document.documentElement.dataset.pinkieWb ?? null,
    sideW: side ? Math.round(side.getBoundingClientRect().width) : null,
    lampPos: lamp ? getComputedStyle(lamp).position : null,
    lamp: lamp && shown(lamp) ? box(lamp) : null,
    gear: box(gear),
    items,
  };
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('L87 real page: 开工作台时 Metre 底栏的方灯在设置左边、和设置竖直对齐、间距 ≤ 8px（1440，日 / 夜）', async (t) => {
  let installed; let server; let browser;
  t.after(async () => { await browser?.close(); await server?.close(); installed?.cleanup(); });
  installed = installRealControlUi({repoRoot: REPO_ROOT});
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const theme of ['day', 'night']) {
    await t.test(theme, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
      try {
        await page.setViewportSize({width: 1440, height: 900});
        await page.mouse.move(900, 400);
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');

        // 关工作台：六条规则照旧生效
        await settle(page);
        const off = await page.evaluate(measureFoot);
        console.log(`ℹ ${theme} 工作台关：${JSON.stringify(off)}`);
        assert.equal(off.compact, null, `${theme}：工作台没开，data-pk-wb-compact 不该在`);
        assert.ok(off.lamp, `${theme}：工作台关时看不到方灯`);

        // 开工作台
        await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.waitForFunction(() => typeof window.__pinkieWorkbench?.show === 'function', null, {timeout: 15_000});
        await page.evaluate(() => window.__pinkieWorkbench.show());
        await page.waitForFunction(() => window.__pinkieWorkbench?.state?.visible === true && document.documentElement.dataset.pkWbCompact === '1', null, {timeout: 15_000});
        await settle(page);
        const on = await page.evaluate(measureFoot);
        console.log(`ℹ ${theme} 工作台开：${JSON.stringify(on)}`);
        assert.ok(on.lamp, `${theme}：开工作台后看不到方灯。现场 ${JSON.stringify(on)}`);
        assert.ok(on.gear, `${theme}：开工作台后看不到设置键。现场 ${JSON.stringify(on)}`);
        const gap = on.gear.l - on.lamp.r;
        assert.ok(gap >= -0.5, `${theme}：方灯要在设置左边（方灯右边 x${on.lamp.r}，设置左边 x${on.gear.l}）。现场 ${JSON.stringify(on)}`);
        assert.ok(gap <= 8, `${theme}：方灯和设置间距 ${gap.toFixed(1)}px，超过 8px。现场 ${JSON.stringify(on)}`);
        assert.ok(Math.abs(on.lamp.mid - on.gear.mid) <= 2, `${theme}：方灯中心 y${on.lamp.mid} 和设置中心 y${on.gear.mid} 差 ${(on.lamp.mid - on.gear.mid).toFixed(1)}px。现场 ${JSON.stringify(on)}`);
        assert.deepEqual(pageErrors, [], '页面不该报错');
      } finally {
        await context.close();
      }
    });
  }
});
