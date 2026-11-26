#!/usr/bin/env node
// B36（backlog）高 DPI 走查，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），deviceScaleFactor 1.25 / 1.5 × 四模式首页（项目 / 学习 / 无限 / Metre）+ 设置 × 1440 × 日夜。
// 每格拍一张，report.json 里量：
//   cut     文字被截但没有省略号（scrollWidth > clientWidth + 1，overflow 不是 visible，text-overflow 不是 ellipsis）
//   ellip   带省略号被截的（正常，列出来方便对照有没有截过头）
//   hair    宽或高 < 1 设备像素的可见边框 / 分隔线（缩放后会糊或消失）
//   pageErrors
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const SCENES = ['home-project', 'home-learning', 'home-unrestricted', 'metre-board', 'settings'];
const SCALES = [1.25, 1.5];
const WIDTH = 1440, HEIGHT = 900;

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const measure = (page) => page.evaluate(() => {
  const dpr = window.devicePixelRatio || 1;
  const visible = (el, r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const cut = [], ellip = [], hair = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const cs = getComputedStyle(el);
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const srOnly = cs.clip !== 'auto' || (r.width <= 1 && r.height <= 1);  // visually-hidden labels are cut on purpose
    if (text && !srOnly && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') {
      const row = {el: name(el), text: text.slice(0, 40), over: el.scrollWidth - el.clientWidth, x: Math.round(r.left), y: Math.round(r.top)};
      (cs.textOverflow === 'ellipsis' ? ellip : cut).push(row);
    }
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      const w = parseFloat(cs['border' + side + 'Width']);
      if (w > 0 && w * dpr < 1 && cs['border' + side + 'Style'] !== 'none') hair.push({el: name(el), side, css: w, device: +(w * dpr).toFixed(2)});
    }
    if (!el.closest('svg') && ((r.height > 0 && r.height * dpr < 1) || (r.width > 0 && r.width * dpr < 1))) hair.push({el: name(el), side: 'box', css: +Math.min(r.width, r.height).toFixed(2), device: +(Math.min(r.width, r.height) * dpr).toFixed(2)});
  }
  return {dpr, mode: document.documentElement.dataset.laolaoMode || '', cut: cut.slice(0, 40), cutCount: cut.length, ellipCount: ellip.length, ellip: ellip.slice(0, 20), hairCount: hair.length, hair: hair.slice(0, 20)};
});

async function cell(scene, theme, scale) {
  const tag = `${scene}-${theme}-x${String(scale).replace('.', '')}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {deviceScaleFactor: scale});
  try {
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
    await page.waitForTimeout(800);
    const m = await measure(page);
    const file = `b36-${tag}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name: `b36-${tag}`, file, os: process.platform, browser: engine || 'chromium', width: WIDTH, height: HEIGHT, deviceScaleFactor: scale,
      bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), cut: m.cutCount, hair: m.hairCount});
    report.push({tag, scene, theme, scale, ...m, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const scene of SCENES) for (const theme of ['day', 'night']) for (const scale of SCALES) await cell(scene, theme, scale);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
