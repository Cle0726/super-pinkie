#!/usr/bin/env node
// B11·T6（#362 走查 T6）改前 / 改后数值：过程卡标题行 .cle-status 的 b（思考中 / 正在执行 / 完成）、
// > span > em（步骤数 / 命令）、i（秒数），日 / 夜各一套，1440 会话页。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关，造法照 #362 的 home-thinking；不连真网关、不改基线。
// 「改前」= 在本页临时注入 main@007aa7a8 的旧变量，「改后」= 本分支 CSS 原样。
// 实色字按计算色对截图底色算；运行中的扫光是 background-clip:text，按像素量：同一块拍有字 / 藏字两张逐像素比，
// 每个分箱取最强像素、再取所有分箱最小值；关掉动画，把 background-position 扫一遍取最小，并确认量时仍在运行中。
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
const WIDTH = 1440, HEIGHT = 820;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

// 多一个 :not(#p4) 压过产品规则；只在截图时临时注入，不进产品文件。
const MAIN_CSS = `html:not(#p1):not(#p2):not(#p3):not(#p4) {
  --cle-mute: rgba(29, 27, 43, .48); --cle-accent: #2f7bff; --cle-sweep: #2f7bff;
  --cle-sweep-verb: rgba(29, 27, 43, .46); --cle-sweep-cmd: rgba(29, 27, 43, .5); --cle-fail: #e5484d; --cle-fail-hi: #ff8589; }
html[data-pinkie-night]:not(#p1):not(#p2):not(#p3):not(#p4) {
  --cle-mute: rgba(236, 232, 240, .46); --cle-accent: #62b4ff; --cle-sweep: #ffffff;
  --cle-sweep-verb: rgba(236, 232, 240, .42); --cle-sweep-cmd: rgba(214, 228, 255, .48); --cle-fail: #e5484d; --cle-fail-hi: #ff8589; }`;
const RUN = '.pinkie-process[data-cle-run] .cle-status:not([data-kind="done"]):not([data-kind="stopped"])';
const DONE = '.pinkie-process:not([data-cle-run]) .cle-status[data-kind="done"]';
const DONE_RUN = '.pinkie-process[data-cle-run] .cle-status[data-kind="done"]';
// 思考中 span 是 hidden 的；要等第一个工具步骤出了命令小签才有 em
const EM_LIVE = `${RUN} > span:not([hidden]) > em`;
const GAP = 15000;
const POSITIONS = [0, 15, 30, 45, 55, 70, 85, 100];
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
  return bins.length ? {ratio: +Math.min(...bins).toFixed(2), bins: bins.length} : {ratio: null, bins: 0};
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
const visible = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !n.closest('[hidden]'); }, sel);
const clipOf = async (page, sel, pad) => {
  if (!(await visible(page, sel))) return null;
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (!box) return null;
  const x = Math.max(0, Math.floor(box.x - pad)), y = Math.max(0, Math.floor(box.y - pad));
  return {x, y, width: Math.min(WIDTH - x, Math.ceil(box.width + pad * 2)), height: Math.min(HEIGHT - y, Math.ceil(box.height + pad * 2))};
};
const isRunning = (page) => page.evaluate((s) => Boolean(document.querySelector(s)), RUN);

async function withStyle(page, css, fn) {
  const tag = await page.addStyleTag({content: css});
  try { await page.waitForTimeout(80); return await fn(); } finally { await tag.evaluate((n) => n.remove()); }
}

async function measureSolid(page, sel) {
  const clip = await clipOf(page, sel, 2);
  if (!clip) return {error: `no ${sel}`};
  const info = await page.evaluate((s) => {
    const n = document.querySelector(s);
    const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
    ctx.fillStyle = '#000'; ctx.fillStyle = getComputedStyle(n).color; ctx.fillRect(0, 0, 1, 1);
    return {rgba: [...ctx.getImageData(0, 0, 1, 1).data], text: n.textContent.trim().slice(0, 24)};
  }, sel);
  const withBuf = await snap(page, {clip});
  const withoutBuf = await withStyle(page, `${sel}{${HIDE}}`, () => snap(page, {clip}));
  const bg = meanRgb(withoutBuf);
  const a = info.rgba[3] / 255, fg = info.rgba.slice(0, 3).map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
  return {text: info.text, color: hex(fg), bg: hex(bg), ratio: +contrast(lum(fg), lum(bg)).toFixed(2), pixels: inkRatio(withBuf, withoutBuf, 4).ratio};
}

async function measureSweep(page, sel) {
  const clip = await clipOf(page, sel, 2);
  if (!clip) return {error: `no ${sel}`};
  const meta = await page.evaluate((s) => {
    const n = document.querySelector(s), cs = getComputedStyle(n);
    const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
    const stops = (cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) || []).map((c) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    });
    return {text: n.textContent.trim().slice(0, 24), fontPx: parseFloat(cs.fontSize) * (devicePixelRatio || 1), stops};
  }, sel);
  const byPos = [];
  let bg = null;
  for (const p of POSITIONS) {
    const r = await withStyle(page, `${RUN} :is(b, em){animation:none!important;background-position:${p}% 0!important}`, async () => {
      const withBuf = await snap(page, {clip});
      const withoutBuf = await withStyle(page, `${sel}{${HIDE}}`, () => snap(page, {clip}));
      if (!bg) bg = meanRgb(withoutBuf);
      return inkRatio(withBuf, withoutBuf, meta.fontPx / 2);
    });
    byPos.push({pos: p, ratio: r.ratio, bins: r.bins, running: await isRunning(page)});
  }
  const ok = byPos.filter((b) => b.running).map((b) => b.ratio).filter((v) => v != null);
  // 计算色：渐变各色标叠到实测底色上，相邻色标之间线性插值 21 点取最小（同 tests/cle-status-contrast.test.mjs）
  let calc = null;
  if (bg && meta.stops.length) {
    const comp = meta.stops.map(([r, g, b, a]) => [r, g, b].map((v, i) => v * (a / 255) + bg[i] * (1 - a / 255)));
    const rs = [];
    for (let k = 0; k < comp.length; k++) {
      const A = comp[k], B = comp[Math.min(k + 1, comp.length - 1)];
      for (let s = 0; s <= 20; s++) rs.push(contrast(lum(A.map((v, i) => v + (B[i] - v) * s / 20)), lum(bg)));
    }
    calc = +Math.min(...rs).toFixed(2);
  }
  return {text: meta.text, calc, bg: bg && hex(bg), stops: meta.stops, pixels: ok.length ? Math.min(...ok) : null, min: calc ?? (ok.length ? Math.min(...ok) : null), byPos};
}

const measureRun = async (page) => ({
  b: await measureSweep(page, `${RUN} b`),
  em: await measureSweep(page, EM_LIVE),
  i: await measureSolid(page, `${RUN} i`),
});
const measureDone = async (page) => ({
  b: await measureSolid(page, `${DONE} b`),
  em: await measureSolid(page, `${DONE} > span > em`),
  i: await measureSolid(page, `${DONE} i`),
});

const report = {engine, width: WIDTH, need: 4.5, themes: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
try {
  for (const theme of ['day', 'night']) {
    const row = {theme, running: {}, runDone: {}, done: {}, errors: {}};
    // 每个变体开一个新页面单独跑一轮：narrated 只走一步 exec，命令小签从 tool start 到 result 后再停 2×gap，够量一组 b / em / i。
    for (const variant of ['after', 'before']) {
      const {context, page} = await H.openRealScenePage(browser, server.origin, 'home-thinking', theme, {timezoneId: 'Asia/Shanghai'});
      try {
        await page.setViewportSize({width: WIDTH, height: HEIGHT});
        await page.waitForTimeout(500);
        await page.evaluate((g) => {
          window.__fakeRunStatus = {active: true, phase: 'working', review: {phase: 'idle'}, continuations: {tier: 0, integrity: 0}, missing: []};
          window.__fake.auto('narrated', {gap: g, once: true, steps: [['我先看一下测试入口有哪些。', 'exec', {command: 'ls tests'}, 'a.test.cjs\nb.test.cjs']]});
          (window.__fake.checks?.send || window.__fake.send)('帮我看看 tests 目录里有哪些测试');
        }, GAP);
        await page.waitForFunction((s) => document.querySelector(s), EM_LIVE, {timeout: 90_000});
        await page.waitForTimeout(400);
        if (variant === 'after') save(`t6-chat-live-1440-${theme}`, await snap(page));
        const go = () => measureRun(page);
        row.running[variant] = variant === 'before' ? await withStyle(page, MAIN_CSS, go) : await go();
        row.running[variant].stillRunning = await page.evaluate((s) => Boolean(document.querySelector(s)), EM_LIVE);
        // 刚结束、仍挂 data-cle-run 的落款「完成」用 --cle-accent
        const held = await page.waitForFunction((s) => document.querySelector(s), DONE_RUN, {timeout: 150_000}).then(() => true, () => false);
        if (held) {
          const go2 = async () => ({b: await measureSolid(page, `${DONE_RUN} b`)});
          row.runDone[variant] = variant === 'before' ? await withStyle(page, MAIN_CSS, go2) : await go2();
        }
        await page.evaluate(() => { window.__fakeRunStatus = {active: false, phase: 'idle', review: {phase: 'idle'}, continuations: {tier: 0, integrity: 0}, missing: []}; });
        const ended = await page.waitForFunction((s) => document.querySelector(s), DONE, {timeout: 60_000}).then(() => true, () => false);
        if (ended) {
          await page.waitForTimeout(600);
          if (variant === 'after') save(`t6-chat-done-1440-${theme}`, await snap(page));
          const go3 = () => measureDone(page);
          row.done[variant] = variant === 'before' ? await withStyle(page, MAIN_CSS, go3) : await go3();
        } else {
          const cards = await page.evaluate(() => [...document.querySelectorAll('.pinkie-process')].map((d) => ({run: d.hasAttribute('data-cle-run'), ended: d.hasAttribute('data-cle-ended'), live: d.dataset.live, kind: d.querySelector('.cle-status')?.dataset.kind, text: d.querySelector('.cle-status')?.textContent.trim().slice(0, 40)})));
          row.errors[variant] = `done timeout: ${JSON.stringify(cards)}`.slice(0, 400);
        }
      } catch (error) {
        row.errors[variant] = String(error?.message || error).slice(0, 300);
      } finally {
        await context.close();
      }
    }
    report.themes.push(row);
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
const v = (m) => m ? (m.error ? 'n/a' : (m.min ?? m.ratio ?? 'n/a')) : '-';
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
for (const t of report.themes) {
  for (const state of ['running', 'runDone', 'done']) for (const variant of ['before', 'after']) {
    const m = t[state]?.[variant];
    if (m) console.log(`${t.theme}\t${state}\t${variant}\tb=${v(m.b)}\tem=${v(m.em)}\ti=${v(m.i)}`);
  }
  for (const [variant, e] of Object.entries(t.errors || {})) console.log(`${t.theme}\t${variant}\tERROR ${e}`);
}
if (report.error || report.themes.some((t) => Object.keys(t.errors || {}).length)) { console.log(`ERROR ${report.error || 'see report.json'}`); process.exitCode = 1; }
