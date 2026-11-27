#!/usr/bin/env node
// B11·T5（#362 走查 T5）改前 / 改后数值：输入框火花按钮 .laolao-deep-think-btn__spark 在静止 / 悬停 / 菜单展开（鼠标仍在按钮上）/
// 菜单展开（鼠标移开）四种状态下的对比度，1440 / 820 × 夜（日间作对照），thinking 首页。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关；不连真网关、不改基线。
// 「改前」= 在本页临时注入 main@e3c9910a 的效果（夜间悬停时火花按钮仍是 theme.css 的 .66 白底 + #cdbdc6），「改后」= 本分支 CSS 原样。
// 底色 = 同一块拍「藏掉火花」那张、取按钮中心像素（已含半透明底与毛玻璃的合成结果）；
// stroke = 火花 svg 的计算色；另给出有火花 / 藏火花两张逐像素比的最大值（细描边抗锯齿后的实际墨色）。
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
const HEIGHT = 820;
const NEED = 3;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

// 多一个 :not(#_n2) 压过本分支的夜间悬停规则；只在截图时临时注入，不进产品文件。
const MAIN_CSS = `html[data-pinkie-night]:not(#_n):not(#_n2) .agent-chat__input .laolao-deep-think-btn:hover {
  background: rgba(255, 255, 255, .66) !important; color: #cdbdc6 !important; }`;
const BTN = '.agent-chat__input .laolao-deep-think-btn';
const HIDE = `${BTN} .laolao-deep-think-btn__spark{visibility:hidden!important}`;

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgbOf = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const r2 = (v) => Math.round(v * 100) / 100;

const snap = (page, opts = {}) => engine === 'webkit'
  ? wkshotBuffer(page, {settleMs: 150, ...opts})
  : page.screenshot({animations: 'disabled', ...opts});
const lines = [];
const save = (name, buf) => {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width: null, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

async function withStyle(page, css, fn) {
  const handle = await page.addStyleTag({content: css});
  try { await page.waitForTimeout(60); return await fn(); } finally { await handle.evaluate((el) => el.remove()); await page.waitForTimeout(60); }
}

async function measure(page) {
  const btn = page.locator(BTN).first();
  const info = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector('.laolao-deep-think-btn__spark');
    const r = el.getBoundingClientRect();
    return {bg: cs.backgroundColor, color: cs.color, stroke: svg ? getComputedStyle(svg).stroke : null,
      sparkShown: Boolean(svg && getComputedStyle(svg).display !== 'none'), expanded: el.getAttribute('aria-expanded'),
      hover: el.matches(':hover'), rect: [r.left, r.top, r.width, r.height]};
  });
  if (!info.sparkShown) return {...info, error: 'spark hidden'};
  const [x, y, w, h] = info.rect;
  const clip = {x: Math.floor(x), y: Math.floor(y), width: Math.ceil(w), height: Math.ceil(h)};
  const A = decodePng(await snap(page, {clip}));
  const B = decodePng(await withStyle(page, HIDE, () => snap(page, {clip})));
  const base = px(B, Math.floor(B.width / 2), Math.floor(B.height / 2));
  let ink = 1;
  for (let j = 0; j < A.height; j++) for (let i = 0; i < A.width; i++) ink = Math.max(ink, contrast(px(A, i, j), px(B, i, j)));
  const stroke = rgbOf(info.stroke || info.color);
  return {...info, base: hex(base), strokeHex: hex(stroke), ratio: r2(contrast(stroke, base)), ink: r2(ink)};
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
const report = {engine, need: NEED, cells: [], errors: []};
try {
  for (const theme of ['night', 'day']) for (const width of [1440, 820]) for (const variant of theme === 'night' ? ['before', 'after'] : ['after']) {
    let opened;
    const cell = {theme, width, variant, states: {}};
    try {
      opened = await H.openRealScenePage(browser, server.origin, 'home-thinking', theme, {timezoneId: 'Asia/Shanghai'});
      const {page, pageErrors} = opened;
      await page.setViewportSize({width, height: HEIGHT});
      await page.waitForTimeout(500);
      if (variant === 'before') await page.addStyleTag({content: MAIN_CSS});
      const btn = page.locator(BTN).first();
      await btn.waitFor({state: 'visible', timeout: 10_000});
      await page.mouse.move(5, HEIGHT - 5);
      await page.waitForTimeout(300);
      cell.states.rest = await measure(page);
      await btn.hover();
      await page.waitForTimeout(350);
      cell.states.hover = await measure(page);
      await btn.click({timeout: 8_000});
      await page.waitForFunction(() => { const m = document.querySelector('#laolao-deep-think-menu'); return m && !m.hidden && m.getBoundingClientRect().height > 40; }, null, {timeout: 8_000});
      await page.waitForTimeout(400);
      cell.states.menuHover = await measure(page);
      save(`t5-deepthink-menu-${width}-${theme}-${variant}`, await snap(page));
      lines[lines.length - 1].width = width;
      await page.mouse.move(5, HEIGHT - 5);
      await page.waitForTimeout(350);
      cell.states.menuOpen = await measure(page);
      cell.pageErrors = pageErrors.slice(0, 5);
    } catch (error) {
      cell.error = String(error?.message || error).slice(0, 300);
      report.errors.push(`${theme}-${width}-${variant}: ${cell.error}`);
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
    console.log(`${c.theme}\t${c.width}\t${c.variant}\t${state}\t${m.error ? 'ERROR ' + m.error : `stroke=${m.strokeHex} base=${m.base} ratio=${m.ratio} ink=${m.ink} expanded=${m.expanded} hover=${m.hover}`}`);
    if (c.variant === 'after' && !m.error) after.push(m.ratio);
  }
  if (c.error) console.log(`${c.theme}\t${c.width}\t${c.variant}\tERROR ${c.error}`);
}
if (report.errors.length || after.some((r) => r < NEED)) { console.log(`ERROR ${report.errors.join('; ') || 'after ratio below ' + NEED}`); process.exitCode = 1; }
