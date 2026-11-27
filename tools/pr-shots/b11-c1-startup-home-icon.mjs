#!/usr/bin/env node
// B11·C1（#375 chat 走查 C1）截图与数值，约定照 tools/pr-shots/minimal.mjs。
// 真实首页（home-chat / home-project / home-thinking / home-learning / home-unrestricted）× 日夜 × 1440 / 820：
//   「继续之前的工作」第一行左边的对话图标，改前（放回 main 的 14% 底色）和改后各量一次、各拍一张。
// 量法两种，都记进 report.json：
//   computed  图标描边色 / 方块底色按计算样式，叠在方块左边 4px 处实拍到的背景像素上
//   pixel     截图里方块顶边中点（避开图标）当底色，图标区里与底色对比度最高的像素当前景
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

// main 的图标：14% 方块 + 纯 accent 描边。最近列表是 .laolao-startup-home 的兄弟节点，选择器挂在 __recent 上才命中。
const MAIN = 'html .laolao-startup-home__recent .laolao-startup-home__icon { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }';
const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];
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

// 在页面里跑：把截图画进 canvas 读像素；计算样式也在同一个 canvas 上叠色换成 sRGB。
const readIcon = (page, png) => page.evaluate(async ({png}) => {
  const icon = document.querySelector('.laolao-startup-home__recent .laolao-startup-home__icon');
  if (!icon) return {missing: true};
  const r = icon.getBoundingClientRect(), svg = icon.querySelector('svg');
  const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
  const cv = Object.assign(document.createElement('canvas'), {width: img.width, height: img.height});
  const cx = cv.getContext('2d', {willReadFrequently: true}); cx.drawImage(img, 0, 0);
  const px = (x, y) => [...cx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)];
  const one = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  const paint = (...layers) => { one.clearRect(0, 0, 1, 1); for (const c of layers) { one.fillStyle = '#000'; one.fillStyle = c; one.fillRect(0, 0, 1, 1); } return [...one.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  const backdrop = px(r.left - 4, r.top + r.height / 2), square = getComputedStyle(icon).backgroundColor, stroke = getComputedStyle(svg).stroke;
  const css = c => `rgb(${c.join(',')})`;
  const glyph = [];
  const g = svg.getBoundingClientRect();
  for (let y = Math.floor(g.top); y < Math.ceil(g.bottom); y++) for (let x = Math.floor(g.left); x < Math.ceil(g.right); x++) glyph.push(px(x, y));
  return {box: {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)},
    square, stroke, backdrop, computedBg: paint(css(backdrop), square), computedFg: paint(css(backdrop), square, stroke),
    pixelBg: px(r.left + r.width / 2, r.top + 2), glyph};
}, {png});

async function one(mode, theme, width) {
  const scene = `home-${mode}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => document.querySelectorAll('.laolao-startup-home__recent .laolao-startup-home__icon').length >= 1, null, {timeout: 15_000});
    await page.waitForTimeout(300);
    for (const phase of ['before', 'after']) {
      const tag = phase === 'before' ? await page.addStyleTag({content: MAIN}) : null;
      await page.waitForTimeout(100);
      const buf = await page.screenshot({animations: 'disabled'});
      const name = `${scene}-${theme}-${width}-${phase}`, file = `${name}.png`;
      fs.writeFileSync(path.join(out, file), buf);
      lines.push({name, file, os: process.platform, browser: engine, width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
      const got = await readIcon(page, buf.toString('base64'));
      if (got.missing) { report.push({scene, theme, width, phase, missing: true, pageErrors}); }
      else {
        const pixelFg = got.glyph.reduce((best, c) => (ratio(c, got.pixelBg) > ratio(best, got.pixelBg) ? c : best), got.pixelBg);
        report.push({scene, theme, width, phase, box: got.box, square: got.square, stroke: got.stroke, backdrop: got.backdrop,
          computed: {fg: got.computedFg, bg: got.computedBg, ratio: ratio(got.computedFg, got.computedBg)},
          pixel: {fg: pixelFg, bg: got.pixelBg, ratio: ratio(pixelFg, got.pixelBg)}, pageErrors: pageErrors.length});
      }
      if (tag) await tag.evaluate(n => n.remove());
    }
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) for (const width of [1440, 820]) for (const mode of MODES) {
    try { await one(mode, theme, width); }
    catch (error) { report.push({scene: `home-${mode}`, theme, width, error: error.message.split('\n')[0]}); }
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
  console.log(`${r.scene.padEnd(18)} ${r.theme.padEnd(5)} ${String(r.width).padEnd(4)} ${r.phase.padEnd(6)} computed ${r.computed.ratio} (${r.computed.fg} on ${r.computed.bg})  pixel ${r.pixel.ratio} (${r.pixel.fg} on ${r.pixel.bg})`);
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
