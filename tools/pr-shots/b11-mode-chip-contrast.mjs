#!/usr/bin/env node
// B11·thinking 外壳表 `.pinkie-chip--mode > span`（「想法取向」）截图与数值，约定照 tools/pr-shots/minimal.mjs：
// node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。真页面（tests/visual/lib/real-harness.mjs），不改基线。
// 真实页面 × 日夜 × 1440 / 820，输入框下面那颗模式按钮（想法：想法取向；项目：工作程度），改前 / 改后各量一次、各拍一张。
// 「改前」= 在本页临时注入 main 的旧色（非项目模式下继承 .pinkie-chip 的 currentColor 68%）。
// 量法两种，都记进 report.json：
//   computed  字色（含透明度）叠到祖先一层层合成出来的底上
//   pixel     字框里出现最多的像素当底色，字框里与底色对比度最高的像素当前景
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

const MAIN = 'html:not([data-laolao-mode="project"]) .pinkie-chip.pinkie-chip--mode[data-value="default"]:not(.pinkie-baton):not(:hover) { color: color-mix(in srgb, currentColor 68%, transparent) !important; }';
const SCENES = ['home-thinking', 'home-project', 'sidebar-collapsed', 'model-picker', 'long-conversation'];
const HEIGHT = 800;
const SEL = '.agent-chat__input .pinkie-chip--mode:not(.pinkie-baton) > span';

const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine() || 'chromium';
const report = [];
const lines = [];

const readChip = (page, png) => page.evaluate(async ({png, sel}) => {
  const el = [...document.querySelectorAll(sel)].find(n => n.getClientRects().length);
  if (!el) return {missing: true, mode: document.documentElement.getAttribute('data-laolao-mode')};
  const rgb = s => {
    const n = (String(s).match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (/^color\(srgb\s/.test(s)) return n.map((v, i) => (i < 3 ? v * 255 : v));
    return n;
  };
  const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3]));
  let bg = [255, 255, 255];
  const chain = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(getComputedStyle(n).backgroundColor);
  for (const c of chain.reverse()) { const v = rgb(c); bg = over([v[0], v[1], v[2], v[3] ?? 1], bg); }
  let op = 1;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
  const color = getComputedStyle(el).color;
  const raw = rgb(color);
  const fg = over([raw[0], raw[1], raw[2], (raw[3] ?? 1) * op], bg);
  const r = el.getBoundingClientRect();
  const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
  const cv = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height});
  const cx = cv.getContext('2d', {willReadFrequently: true}); cx.drawImage(img, 0, 0);
  const glyph = [], count = new Map();
  const data = cx.getImageData(Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)).data;
  for (let i = 0; i < data.length; i += 4) { const c = [data[i], data[i + 1], data[i + 2]]; glyph.push(c); const k = c.join(','); count.set(k, (count.get(k) || 0) + 1); }
  const pixBg = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  return {text: el.textContent.trim(), color, mode: document.documentElement.getAttribute('data-laolao-mode'),
    box: {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)},
    bg: bg.map(Math.round), fg: fg.map(Math.round), pixBg, glyph};
}, {png, sel: SEL});

async function one(scene, theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForTimeout(400);
    for (const phase of ['before', 'after']) {
      const tag = phase === 'before' ? await page.addStyleTag({content: MAIN}) : null;
      await page.waitForTimeout(100);
      const buf = await page.screenshot({animations: 'disabled'});
      const name = `${scene}-${theme}-${width}-${phase}`, file = `${name}.png`;
      fs.writeFileSync(path.join(out, file), buf);
      lines.push({name, file, os: process.platform, browser: engine, width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
      const got = await readChip(page, buf.toString('base64'));
      if (got.missing) report.push({scene, theme, width, phase, mode: got.mode, missing: true, pageErrors: pageErrors.length});
      else {
        const pixelFg = got.glyph.reduce((best, c) => (ratio(c, got.pixBg) > ratio(best, got.pixBg) ? c : best), got.pixBg);
        report.push({scene, theme, width, phase, mode: got.mode, text: got.text, box: got.box, color: got.color,
          computed: {fg: got.fg, bg: got.bg, ratio: ratio(got.fg, got.bg)},
          pixel: {fg: pixelFg, bg: got.pixBg, ratio: ratio(pixelFg, got.pixBg)}, pageErrors: pageErrors.length});
      }
      if (tag) await tag.evaluate(n => n.remove());
    }
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) for (const width of [1440, 820]) for (const scene of SCENES) {
    try { await one(scene, theme, width); }
    catch (error) { report.push({scene, theme, width, error: error.message.split('\n')[0]}); }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map(l => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
for (const r of report) {
  if (r.error || r.missing) { console.log(`${r.scene} ${r.theme} ${r.width} ${r.phase || ''} ${r.mode || ''} ${r.error || 'missing'}`); continue; }
  console.log(`${r.scene.padEnd(18)} ${r.mode.padEnd(8)} ${r.theme.padEnd(5)} ${String(r.width).padEnd(4)} ${r.phase.padEnd(6)} 「${r.text}」 computed ${r.computed.ratio} (${r.computed.fg} on ${r.computed.bg})  pixel ${r.pixel.ratio} (${r.pixel.fg} on ${r.pixel.bg})`);
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
