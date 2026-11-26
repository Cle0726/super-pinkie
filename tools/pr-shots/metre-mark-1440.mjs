#!/usr/bin/env node
// 17（协调者 22:09 / 22:14，uireview #98 审图「日 1440 左下角 METRE 标志压住齿轮 / 切换 / 书本图标」）的 PR 截图脚本。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真实安装的 Control UI + 碧琪注入，metre-board 场景，1440 / 820 × 日 / 夜。不连网关、不碰用户会话。
// 每组拍两张：
//   mark-<宽>-<日夜>       ：整页
//   mark-<宽>-<日夜>-foot  ：左下角底栏放大（侧栏底部 300 × 80，裁图 3 倍）
// shots.jsonl 每行另记侧栏宽、黑卡 / 方灯 / 底栏每个图标的横向范围，以及谁和谁叠着（overlaps，空数组才算没压）。
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

// 底栏里看得见的东西：模式黑卡、连接方灯、底栏每个可点的图标（隐藏的、0 宽的不算）。
function measureFoot() {
  const side = document.querySelector('aside.sidebar');
  const vis = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' ? r : null; };
  const box = (r) => r && {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom)};
  const items = [];
  const card = vis(side?.querySelector('.laolao-mode-switcher'));
  if (card) items.push({id: 'card', ...box(card)});
  const lamp = vis(side?.querySelector('.pinkie-connection-status'));
  if (lamp) items.push({id: 'lamp', ...box(lamp)});
  const bar = side?.querySelector('.sidebar-footer-bar');
  for (const e of bar ? bar.querySelectorAll('button, a, [role="button"]') : []) {
    if (e.closest('.laolao-mode-switcher, .pinkie-connection-status')) continue;
    const r = vis(e); if (!r) continue;
    items.push({id: e.id || e.getAttribute('aria-label') || e.title || e.className.split(' ')[0] || e.tagName, ...box(r)});
  }
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) overlaps.push(`${a.id}×${b.id}`);
  }
  const sr = side?.getBoundingClientRect();
  return {sideW: sr ? Math.round(sr.width) : null, sideBottom: sr ? Math.round(sr.bottom) : null, items, overlaps};
}

const installed = installRealControlUi({repoRoot: REPO_ROOT});
const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
const browser = await launchRealBrowser();
const lines = [];
const notes = [];
const rec = (name, width, height, buf, info) => lines.push({name, file: name + '.png', os: process.platform, browser: browser.__pinkieEngine || 'chromium', width, height,
  bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...info});
try {
  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      for (const [width, height] of [[1440, 900], [820, 900]]) {
        await page.setViewportSize({width, height});
        await page.waitForTimeout(900);
        const info = await page.evaluate(measureFoot);
        const name = `mark-${width}-${theme}`;
        rec(name, width, height, await page.screenshot({path: path.join(out, name + '.png')}), info);
        const clip = {x: 0, y: Math.max(0, (info.sideBottom ?? height) - 80), width: 300, height: 80};
        const foot = name + '-foot';
        const p2 = await context.newPage();
        try {
          // 放大图：同一页再截一块，用 CSS 像素裁好后放大 3 倍写盘（不改原页面的缩放）
          const raw = await page.screenshot({clip});
          await p2.setViewportSize({width: clip.width * 3, height: clip.height * 3});
          await p2.setContent(`<body style="margin:0"><img style="width:${clip.width * 3}px;height:${clip.height * 3}px;image-rendering:pixelated" src="data:image/png;base64,${raw.toString('base64')}"></body>`);
          rec(foot, clip.width * 3, clip.height * 3, await p2.screenshot({path: path.join(out, foot + '.png')}), {...info, clip});
        } finally { await p2.close(); }
        notes.push(`${name}: side=${info.sideW} ` + info.items.map((i) => `${i.id}[${i.l}..${i.r}]`).join(' ') + ` overlaps=${JSON.stringify(info.overlaps)}`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(notes.join('\n'));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
