#!/usr/bin/env node
// B11·chat S7 改前 / 改后数值：820 宽顶栏原生搜索键 .topbar-search（原生 CSS 只在 width<=1100px 显示）的描边与图标对比度，
// 日 / 夜 × home-chat / home-project / model-picker / settings / long-conversation，静止 + 悬停。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关；不连真网关、不改基线。
// 「改前」= 在本页临时注入原生描边（--border 88% / 悬停 --border-strong 90%），「改后」= 本分支 CSS 原样。
// ratio = 计算描边色合成到按钮外侧像素后与该像素的对比度；edge = 截图里描边附近 3 列像素对外侧像素的最大对比度；
// icon = 按钮中心 20×20 内像素对按钮内底色的最大对比度。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {playwright} from '../study-desk/harness.mjs';
import {wkshotBuffer, wrapWebKitPlaywright} from '../../tests/visual/lib/webkit-screenshot.mjs';
import {decodePng} from '../../tests/visual/lib/png-diff.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const WIDTH = 820;
const HEIGHT = 820;
const NEED = 3;
const PAD = 6;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const SCENES = (process.env.S7_SCENES || 'home-chat,home-project,model-picker,settings,long-conversation').split(',');

// 多一个 :not(#_t2) 压过本分支 theme.css 的规则；只在截图时临时注入，不进产品文件。
const MAIN_CSS = `html:not(#_t):not(#_t2) .topbar-search:not(:hover) { border-color: color-mix(in srgb, var(--border) 88%, transparent); }
html:not(#_t):not(#_t2) .topbar-search:hover { border-color: color-mix(in srgb, var(--border-strong) 90%, transparent); }`;
const BTN = 'button.topbar-search';

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgba = (s) => { const n = (String(s).match(/[\d.]+/g) || []).map(Number); return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]; };
const over = ([r, g, b, a], bg) => [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));
const r2 = (v) => Math.round(v * 100) / 100;

const snap = (page, opts = {}) => engine === 'webkit'
  ? wkshotBuffer(page, {settleMs: 150, ...opts})
  : page.screenshot({animations: 'disabled', ...opts});
const lines = [];
const save = (name, buf) => {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width: WIDTH, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

async function measure(page) {
  const btn = page.locator(BTN).first();
  const info = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {border: cs.borderTopColor, bw: cs.borderTopWidth, bg: cs.backgroundColor, color: cs.color,
      display: cs.display, hover: el.matches(':hover'), rect: [r.left, r.top, r.width, r.height]};
  });
  if (info.display === 'none' || !info.rect[2]) return {...info, error: 'button hidden'};
  const [x, y, w, h] = info.rect;
  const clip = {x: Math.max(0, Math.floor(x) - PAD), y: Math.max(0, Math.floor(y) - PAD), width: Math.ceil(w) + PAD * 2, height: Math.ceil(h) + PAD * 2};
  const img = decodePng(await snap(page, {clip}));
  const midY = Math.floor(img.height / 2);
  const left = Math.round(x) - clip.x;
  const outside = px(img, Math.max(0, left - 3), midY);
  let edge = 1;
  for (let i = left - 1; i <= left + 1; i++) edge = Math.max(edge, contrast(px(img, i, midY), outside));
  const inside = px(img, left + 4, midY);
  let icon = 1;
  const cx = img.width / 2, cy = img.height / 2;
  for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
    if (Math.abs(i - cx) < 10 && Math.abs(j - cy) < 10) icon = Math.max(icon, contrast(px(img, i, j), inside));
  }
  const borderOnOut = over(rgba(info.border), outside);
  return {...info, outside: hex(outside), borderHex: hex(borderOnOut), inside: hex(inside),
    ratio: r2(contrast(borderOnOut, outside)), edge: r2(edge), icon: r2(icon)};
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
const report = {engine, need: NEED, width: WIDTH, cells: [], errors: []};
try {
  for (const scene of SCENES) for (const theme of ['day', 'night']) for (const variant of ['before', 'after']) {
    let opened;
    const cell = {scene, theme, variant, states: {}};
    try {
      opened = await H.openRealScenePage(browser, server.origin, scene, theme, {timezoneId: 'Asia/Shanghai'});
      const {page, pageErrors} = opened;
      await page.setViewportSize({width: WIDTH, height: HEIGHT});
      await page.waitForTimeout(500);
      if (variant === 'before') await page.addStyleTag({content: MAIN_CSS});
      const btn = page.locator(BTN).first();
      await btn.waitFor({state: 'visible', timeout: 10_000});
      await page.mouse.move(5, HEIGHT - 5);
      await page.waitForTimeout(350);
      cell.states.rest = await measure(page);
      save(`s7-topbar-search-${scene}-${theme}-${variant}`, await snap(page, {clip: {x: 0, y: 0, width: WIDTH, height: 96}}));
      await btn.hover();
      await page.waitForTimeout(350);
      cell.states.hover = await measure(page);
      cell.pageErrors = pageErrors.slice(0, 5);
    } catch (error) {
      cell.error = String(error?.message || error).slice(0, 300);
      report.errors.push(`${scene}-${theme}-${variant}: ${cell.error}`);
    } finally {
      await opened?.context.close();
    }
    report.cells.push(cell);
  }
} catch (error) {
  report.errors.push(String(error?.message || error).slice(0, 300));
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
const after = [];
for (const c of report.cells) {
  for (const [state, m] of Object.entries(c.states)) {
    console.log(`${c.scene}\t${c.theme}\t${c.variant}\t${state}\t${m.error ? 'ERROR ' + m.error : `border=${m.borderHex} outside=${m.outside} ratio=${m.ratio} edge=${m.edge} icon=${m.icon} hover=${m.hover}`}`);
    if (c.variant === 'after') after.push(m.error ? 0 : Math.min(m.ratio, m.icon));
  }
  if (c.error) console.log(`${c.scene}\t${c.theme}\t${c.variant}\tERROR ${c.error}`);
}
if (report.errors.length || after.some((r) => r < NEED)) { console.log(`ERROR ${report.errors.join('; ') || 'after ratio below ' + NEED}`); process.exitCode = 1; }
