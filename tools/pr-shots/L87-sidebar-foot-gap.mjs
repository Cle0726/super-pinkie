#!/usr/bin/env node
// L87（win-coord #96）的 PR 截图脚本：Metre 侧栏底栏，开 / 关工作台时连接方灯和设置的位置。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真实安装的 Control UI + 碧琪注入，metre-board 场景，1440 × 日 / 夜 × 工作台关 / 开（__pinkieWorkbench.show()）。
// 不连网关、不碰用户会话；工作台要的 pinkie.fs.* 在页里接住（同 tests/metre-foot-L87-real.test.mjs）。
// 每组拍两张：
//   foot-1440-<日夜>-wb-<off|on>       ：整页
//   foot-1440-<日夜>-wb-<off|on>-zoom  ：左下角底栏放大（侧栏底部 300 × 80，3 倍）
// shots.jsonl 每行另记 data-pk-wb-compact、方灯 / 设置的框、两者水平间距（gap）和竖直中心差（midDiff）、底栏每个可点项的框。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

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

function measureFoot() {
  const side = document.querySelector('aside.sidebar');
  const bar = side?.querySelector('.sidebar-footer-bar');
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return {l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, mid: Math.round((r.top + r.height / 2) * 10) / 10}; };
  const lampEl = bar?.querySelector('.pinkie-connection-status');
  const lamp = lampEl && shown(lampEl) ? box(lampEl) : null;
  const gear = box([...(bar?.querySelectorAll('a.sidebar-footer-icon[aria-label="设置"], .laolao-footer-more') || [])].find(shown) || null);
  const items = [...(bar?.querySelectorAll('button, a, [role="button"]') || [])].filter(shown)
    .map((e) => ({id: e.id || e.getAttribute('aria-label') || String(e.className).split(' ')[0] || e.tagName, ...box(e)}));
  const sr = side?.getBoundingClientRect();
  return {
    compact: document.documentElement.dataset.pkWbCompact ?? null,
    wb: document.documentElement.dataset.pinkieWb ?? null,
    sideW: sr ? Math.round(sr.width) : null, sideBottom: sr ? Math.round(sr.bottom) : null,
    lampPos: lampEl ? getComputedStyle(lampEl).position : null,
    lamp, gear,
    gap: lamp && gear ? Math.round((gear.l - lamp.r) * 10) / 10 : null,
    midDiff: lamp && gear ? Math.round((lamp.mid - gear.mid) * 10) / 10 : null,
    items,
  };
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const installed = installRealControlUi({repoRoot: REPO_ROOT});
const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
const browser = await launchRealBrowser();
const lines = [];
const rec = (name, width, height, buf, info) => lines.push({name, file: name + '.png', os: process.platform, browser: browser.__pinkieEngine || 'chromium', width, height,
  bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...info});
const [W, H] = [1440, 900];
try {
  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
    try {
      await page.setViewportSize({width: W, height: H});
      await page.mouse.move(900, 400);
      for (const wb of ['off', 'on']) {
        if (wb === 'on') {
          await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
          await page.waitForFunction(() => typeof window.__pinkieWorkbench?.show === 'function', null, {timeout: 15_000});
          await page.evaluate(() => window.__pinkieWorkbench.show());
          await page.waitForFunction(() => window.__pinkieWorkbench?.state?.visible === true && document.documentElement.dataset.pkWbCompact === '1', null, {timeout: 15_000});
          await page.mouse.move(900, 400);
        }
        await settle(page);
        const info = {theme, workbench: wb, ...(await page.evaluate(measureFoot))};
        const name = `foot-${W}-${theme}-wb-${wb}`;
        rec(name, W, H, await page.screenshot({path: path.join(out, name + '.png')}), info);
        const clip = {x: 0, y: Math.max(0, (info.sideBottom ?? H) - 80), width: 300, height: 80};
        const zoom = name + '-zoom';
        const p2 = await context.newPage();
        try {
          const raw = await page.screenshot({clip});
          await p2.setViewportSize({width: clip.width * 3, height: clip.height * 3});
          await p2.setContent(`<body style="margin:0"><img style="width:${clip.width * 3}px;height:${clip.height * 3}px;image-rendering:pixelated" src="data:image/png;base64,${raw.toString('base64')}"></body>`);
          rec(zoom, clip.width * 3, clip.height * 3, await p2.screenshot({path: path.join(out, zoom + '.png')}), {...info, clip});
        } finally { await p2.close(); }
        console.log(`${name}: compact=${info.compact} lamp=${JSON.stringify(info.lamp)} gear=${JSON.stringify(info.gear)} gap=${info.gap} midDiff=${info.midDiff}`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`${lines.length} 张 → ${out}`);
