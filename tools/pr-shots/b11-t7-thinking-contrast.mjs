#!/usr/bin/env node
// B11·T7（#362 走查 T7）改前 / 改后数值：日间 1440 会话页，进行中思考框的折叠箭头 .pinkie-thinking__chev
// 与 shimmer 标签 .pinkie-thinking__label（以及共用规则的状态胶囊 .pinkie-status__phrase.is-shimmer）。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关，造法照 #362 的 chat-live；不连真网关、不改基线。
// 「改前」= 在本页临时注入 main 的旧色（chev #a36b82、亮点 #e94f91），「改后」= 本分支 CSS 原样。
// chev 按计算字色对截图里的卡面底色算；shimmer 字是 background-clip:text，按像素量：同一块拍有字 / 藏字两张逐像素比，
// 每个分箱取最强像素、再取所有分箱最小值。截图关了动画，亮点停在哪由 background-position 决定，所以把它扫一遍取最小。
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
const WIDTH = 1440, HEIGHT = 800;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

const SHIMMER = 'html .pinkie-thinking.is-live .pinkie-thinking__label, html .pinkie-status__phrase.is-shimmer';
const MAIN_CSS = `html .pinkie-thinking__chev { color: #a36b82; }
${SHIMMER} { background-image: linear-gradient(90deg, #805269 35%, #e94f91 50%, #805269 65%); }`;
// background-size 250% 时亮点（渐变 50% 处）只在 background-position 约 17%–83% 之间露出来。
const POSITIONS = [0, 20, 35, 50, 65, 80, 100];
// 只在截图时临时注入，不进产品文件；tools/ 下不计 important。
const HIDE = 'color:transparent!important;-webkit-text-fill-color:transparent!important;background:none!important;text-shadow:none!important';

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };

function inkRatio(withBuf, withoutBuf, binPx) {
  const A = decodePng(withBuf), B = decodePng(withoutBuf);
  if (A.width !== B.width || A.height !== B.height) throw new Error('crop sizes differ');
  const cols = [];
  for (let x = 0; x < A.width; x++) {
    let best = 1, n = 0;
    for (let y = 0; y < A.height; y++) {
      const r = contrast(lum(px(A, x, y)), lum(px(B, x, y)));
      if (r > 1.15) n++;
      if (r > best) best = r;
    }
    cols.push(n >= 2 ? best : 0);
  }
  const step = Math.max(2, Math.round(binPx)), bins = [];
  for (let x = 0; x < cols.length; x += step) {
    const inked = cols.slice(x, x + step).filter(Boolean);
    if (inked.length >= Math.max(2, step * 0.4)) bins.push(Math.max(...inked));
  }
  if (!bins.length) return {ratio: null, bins: 0};
  return {ratio: +Math.min(...bins).toFixed(2), bins: bins.length};
}
function meanRgb(buf) {
  const img = decodePng(buf), sum = [0, 0, 0];
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) px(img, x, y).forEach((v, i) => { sum[i] += v; });
  return sum.map((v) => Math.round(v / (img.width * img.height)));
}
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

const snap = (page, opts = {}) => engine === 'webkit'
  ? wkshotBuffer(page, {settleMs: 150, ...opts})
  : page.screenshot({animations: 'disabled', ...opts});
const lines = [];
const save = (name, buf) => {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
const clipOf = async (page, sel, pad) => {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (!box) return null;
  const x = Math.max(0, Math.floor(box.x - pad)), y = Math.max(0, Math.floor(box.y - pad));
  return {x, y, width: Math.min(WIDTH - x, Math.ceil(box.width + pad * 2)), height: Math.min(HEIGHT - y, Math.ceil(box.height + pad * 2))};
};
const isLive = (page) => page.evaluate(() => Boolean(document.querySelector('.pinkie-thinking.is-live .pinkie-thinking__label')));

async function withStyle(page, css, fn) {
  const tag = await page.addStyleTag({content: css});
  try { await page.waitForTimeout(80); return await fn(); } finally { await tag.evaluate((n) => n.remove()); }
}

async function measureChev(page) {
  const CHEV = '.pinkie-thinking.is-live .pinkie-thinking__chev';
  const clip = await clipOf(page, CHEV, 3);
  if (!clip) return {error: `no ${CHEV}`};
  const color = await page.evaluate((s) => {
    const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
    ctx.fillStyle = '#000'; ctx.fillStyle = getComputedStyle(document.querySelector(s)).color; ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, CHEV);
  const withBuf = await snap(page, {clip});
  const withoutBuf = await withStyle(page, `.pinkie-thinking__chev{${HIDE}}`, () => snap(page, {clip}));
  const bg = meanRgb(withoutBuf);
  return {color: hex(color), bg: hex(bg), ratio: +contrast(lum(color), lum(bg)).toFixed(2), pixels: inkRatio(withBuf, withoutBuf, 4).ratio};
}

async function measureShimmer(page, sel) {
  const clip = await clipOf(page, sel, 2);
  if (!clip) return {error: `no ${sel}`};
  const fontPx = await page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize) * (devicePixelRatio || 1), sel);
  const byPos = [];
  for (const p of POSITIONS) {
    const r = await withStyle(page, `${SHIMMER}{animation:none!important;background-position:${p}% 0!important}`, async () => {
      const withBuf = await snap(page, {clip});
      const withoutBuf = await withStyle(page, `${sel}{${HIDE}}`, () => snap(page, {clip}));
      return inkRatio(withBuf, withoutBuf, fontPx / 2);
    });
    // 量完这一档还得仍在进行中，否则截到的是已收起的普通标签，不算数。
    byPos.push({pos: p, ratio: r.ratio, bins: r.bins, live: await isLive(page)});
  }
  const ok = byPos.filter((b) => b.live).map((b) => b.ratio).filter((v) => v != null);
  return {min: ok.length ? Math.min(...ok) : null, byPos};
}

const report = {engine, width: WIDTH, theme: 'day', need: 4.5, variants: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
try {
  const {context, page} = await H.openRealScenePage(browser, server.origin, 'home-thinking', 'day', {timezoneId: 'Asia/Shanghai'});
  try {
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
    await page.waitForTimeout(500);
    // 每组量之前都要正在思考；auto 带 once，所以每次都重新登记再发一条。
    const startLive = async () => {
      await page.evaluate(() => {
        window.__fakeRunStatus = {active: true, phase: 'working', review: {phase: 'idle'}, continuations: {tier: 0, integrity: 0}, missing: []};
        // narrated 先 sleep(gap) 才开始思考，思考分 4 段、每段 gap/3：gap=21000 约 21 s 出框、进行中约 28 s，够量两组。
        window.__fake.auto('narrated', {thinking: true, gap: 21000, once: true});
        (window.__fake.checks?.send || window.__fake.send)('帮我想想这个周末的读书计划怎么排');
      });
      await page.waitForFunction(() => document.querySelector('.pinkie-thinking.is-live .pinkie-thinking__label') && document.querySelector('.chat-group--process[data-pinkie-process]'), null, {timeout: 40_000});
      await page.waitForTimeout(400);
    };
    await startLive();
    save('t7-chat-live-1440-day', await snap(page));
    for (const variant of ['after', 'before']) {
      if (!(await isLive(page))) await startLive();
      const run = async () => {
        const row = {variant, chev: await measureChev(page), label: await measureShimmer(page, '.pinkie-thinking.is-live .pinkie-thinking__label')};
        if (await page.locator('.pinkie-status__phrase.is-shimmer').count()) row.phrase = await measureShimmer(page, '.pinkie-status__phrase.is-shimmer');
        const card = await clipOf(page, '.pinkie-thinking.is-live', 8);
        if (card) save(`t7-thinking-${variant}`, await snap(page, {clip: card}));
        row.stillLive = await isLive(page);
        return row;
      };
      report.variants.push(variant === 'before' ? await withStyle(page, MAIN_CSS, run) : await run());
    }
  } finally {
    await context.close();
  }
} catch (error) {
  report.error = String(error?.message || error).slice(0, 300);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
for (const v of report.variants) {
  console.log(`${v.variant}\tchev=${v.chev.ratio ?? v.chev.error} (${v.chev.color} on ${v.chev.bg}, pixels ${v.chev.pixels})\tlabel=${v.label.min ?? v.label.error}\tphrase=${v.phrase ? v.phrase.min : '-'}\tlive=${v.stillLive}`);
}
if (report.error) { console.log(`ERROR ${report.error}`); process.exitCode = 1; }
