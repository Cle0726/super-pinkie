#!/usr/bin/env node
// B11·chat S2（docs/b11-walkthrough/chat.md S2）截图与数值，约定照 tools/pr-shots/minimal.mjs。
// 真实页面（五个首页 / sidebar-collapsed / model-picker / long-conversation）× 日夜 × 1440 / 820：
//   输入区右下「13%」，改前（让它回到继承 summary 的 var(--fog-muted)）和改后各量一次、各拍一张。
// 量法两种，都记进 report.json：
//   computed  「13%」的计算色叠在字框里出现最多的像素（底色）上
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

const MAIN = 'html .agent-chat__input .laolao-context-viewer__percent { color: inherit !important; }';
const SCENES = ['home-chat', 'home-project', 'home-thinking', 'home-learning', 'home-unrestricted', 'sidebar-collapsed', 'model-picker', 'long-conversation'];
const HEIGHT = 800;

const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine() || 'chromium';
const report = [];
const lines = [];

const readPercent = (page, png) => page.evaluate(async ({png}) => {
  const el = document.querySelector('.agent-chat__input .laolao-context-viewer__percent');
  if (!el || !el.getClientRects().length) return {missing: true};
  const r = el.getBoundingClientRect();
  const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
  const cv = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height});
  const cx = cv.getContext('2d', {willReadFrequently: true}); cx.drawImage(img, 0, 0);
  const glyph = [], count = new Map();
  const data = cx.getImageData(Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)).data;
  for (let i = 0; i < data.length; i += 4) { const c = [data[i], data[i + 1], data[i + 2]]; glyph.push(c); const k = c.join(','); count.set(k, (count.get(k) || 0) + 1); }
  const bg = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const color = getComputedStyle(el).color;
  const one = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  one.fillStyle = `rgb(${bg.join(',')})`; one.fillRect(0, 0, 1, 1); one.fillStyle = '#000'; one.fillStyle = color; one.fillRect(0, 0, 1, 1);
  return {text: el.textContent.trim(), color, mode: document.documentElement.getAttribute('data-laolao-mode'),
    box: {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)},
    bg, computedFg: [...one.getImageData(0, 0, 1, 1).data.slice(0, 3)], glyph};
}, {png});

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
      const got = await readPercent(page, buf.toString('base64'));
      if (got.missing) report.push({scene, theme, width, phase, missing: true, pageErrors: pageErrors.length});
      else {
        const pixelFg = got.glyph.reduce((best, c) => (ratio(c, got.bg) > ratio(best, got.bg) ? c : best), got.bg);
        report.push({scene, theme, width, phase, mode: got.mode, text: got.text, box: got.box, color: got.color,
          computed: {fg: got.computedFg, bg: got.bg, ratio: ratio(got.computedFg, got.bg)},
          pixel: {fg: pixelFg, bg: got.bg, ratio: ratio(pixelFg, got.bg)}, pageErrors: pageErrors.length});
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
  if (r.error || r.missing) { console.log(`${r.scene} ${r.theme} ${r.width} ${r.phase || ''} ${r.error || 'missing'}`); continue; }
  console.log(`${r.scene.padEnd(18)} ${r.theme.padEnd(5)} ${String(r.width).padEnd(4)} ${r.phase.padEnd(6)} computed ${r.computed.ratio} (${r.computed.fg} on ${r.computed.bg})  pixel ${r.pixel.ratio} (${r.pixel.fg})`);
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
