#!/usr/bin/env node
// B11 改前 / 改后读数：提问卡「其他」输入框占位字 `.laolao-ask__other-input::placeholder` 对实际底色。
// home-chat 场景 × 日（5 模式）/ 夜（chat）× 1440 / 820，静置与聚焦两态；Metre 另起一行只作参考（不计 LOW）。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关；提问卡用 window.__laolaoAskUser.show() 弹出示例题。
// 「改前」= 本页临时注入 origin/main 的旧色 #b98ea1（不进产品文件），「改后」= 本分支 CSS 原样。不连真网关、不改基线。
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
const WIDTHS = [1440, 820], HEIGHT = 900, NEED = 4.5;
const CELLS = [
  ...['chat', 'project', 'thinking', 'learning', 'unrestricted'].map((mode) => ['day', mode, true]),
  ['night', 'chat', true],
  ['day', 'metre', false],
];
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

const INPUT = '.laolao-ask__other-input';
const P = ':not(#p1):not(#p2):not(#p3):not(#p4)';
const MAIN_CSS = `html${P} ${INPUT}::placeholder { color: #b98ea1; opacity: 1; }`;
const HIDE = `html${P}${P} ${INPUT}::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important}`;
const RECORD = {
  question: '这次的项目说明，你想先看哪一部分？',
  header: '示例',
  options: [{label: '整体结构', description: '先讲目录和模块分工'}, {label: '运行方式', description: '先讲怎么装、怎么跑'}],
};

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => +((Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05)).toFixed(2);
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const pixels = (img) => { const all = []; for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) all.push(px(img, x, y)); return all; };

const snap = (page, opts = {}) => engine === 'webkit'
  ? wkshotBuffer(page, {settleMs: 150, ...opts})
  : page.screenshot({animations: 'disabled', ...opts});
const lines = [];
const save = (name, buf) => {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

async function withStyle(page, css, fn) {
  const tag = await page.addStyleTag({content: css});
  try { await page.waitForTimeout(120); return await fn(); } finally { await tag.evaluate((n) => n.remove()); }
}

const openCard = (page, id) => page.evaluate(({record, id}) => {
  const api = window.__laolaoAskUser;
  if (!api?.show) return {error: 'window.__laolaoAskUser.show missing'};
  api.show({...record, id});
  const input = document.querySelector('.laolao-ask__other-input');
  if (!input) return {error: 'ask card input missing'};
  input.value = '';
  return {placeholder: input.placeholder};
}, {record: RECORD, id});

// 计算色作参考；底色取「藏占位字」截图里占位字所在条带的均值与最不利像素；字色取同条带有字截图里离底色最远的像素（实际墨色）。
async function measure(page) {
  const info = await page.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect(), cs = getComputedStyle(n), pad = parseFloat(cs.paddingLeft) || 0;
    let computed = null;
    try { computed = getComputedStyle(n, '::placeholder').color; } catch {}
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const w = Math.min(r.width - pad * 2, ctx.measureText(n.placeholder).width);
    const size = parseFloat(cs.fontSize) || 13.5;
    return {computed, focused: document.activeElement === n, box: {x: r.x + pad, y: r.y + (r.height - size * 1.3) / 2, width: w, height: size * 1.3}};
  }, INPUT);
  if (!info || info.box.width < 4) return {error: `no visible ${INPUT}`};
  const vw = page.viewportSize().width, b = info.box;
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  const clip = {x, y, width: Math.min(vw - x, Math.ceil(b.width)), height: Math.min(HEIGHT - y, Math.ceil(b.height))};
  if (clip.width < 4 || clip.height < 4) return {error: `off-screen ${INPUT}`};
  const inked = pixels(decodePng(await snap(page, {clip})));
  const bare = pixels(decodePng(await withStyle(page, HIDE, () => snap(page, {clip}))));
  const mean = [0, 1, 2].map((i) => bare.reduce((s, p) => s + p[i], 0) / bare.length);
  const ink = inked.reduce((w, p) => (Math.abs(lum(p) - lum(mean)) > Math.abs(lum(w) - lum(mean)) ? p : w), inked[0]);
  const dark = lum(ink) < lum(mean);
  const worst = bare.reduce((w, p) => ((dark ? lum(p) > lum(w) : lum(p) < lum(w)) ? p : w), bare[0]);
  const rMean = contrast(ink, mean), rWorst = contrast(ink, worst);
  return {focused: info.focused, computed: info.computed, ink: hex(ink), bg: hex(mean), worstBg: hex(worst), ratio: Math.min(rMean, rWorst), rMean, rWorst};
}

async function measureBoth(page) {
  await page.evaluate((s) => document.querySelector(s)?.blur(), INPUT);
  await page.waitForTimeout(250);
  const rest = await measure(page);
  await page.focus(INPUT);
  await page.waitForTimeout(250);
  const focus = await measure(page);
  await page.evaluate((s) => document.querySelector(s)?.blur(), INPUT);
  return {rest, focus};
}

async function setMode(page, mode) {
  await page.evaluate((m) => document.documentElement.setAttribute('data-laolao-mode', m), mode);
  await page.waitForTimeout(200);
  return page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
}

const report = {engine, need: NEED, rows: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
try {
  for (const [theme, mode, gated] of CELLS) for (const width of WIDTHS) {
    const row = {theme, mode, width, gated, modeSeen: null, placeholder: null, after: null, before: null, errors: []};
    let opened;
    try {
      opened = await H.openRealScenePage(browser, server.origin, 'home-chat', theme, {timezoneId: 'Asia/Shanghai'});
      const {page} = opened;
      await page.setViewportSize({width, height: HEIGHT});
      await page.mouse.move(2, 2);
      row.modeSeen = await setMode(page, mode);
      const card = await openCard(page, `b11-shot-${theme}-${mode}-${width}`);
      if (card.error) throw new Error(card.error);
      row.placeholder = card.placeholder;
      await page.waitForTimeout(900);
      save(`b11-ask-ph-${mode}-${width}-${theme}-after`, await snap(page));
      row.after = await measureBoth(page);
      await withStyle(page, MAIN_CSS, async () => {
        save(`b11-ask-ph-${mode}-${width}-${theme}-before`, await snap(page));
        row.before = await measureBoth(page);
      });
      if (await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')) !== mode) row.errors.push('mode attribute changed during measurement');
    } catch (error) {
      row.errors.push(String(error?.message || error).slice(0, 300));
    } finally {
      await opened?.context.close();
    }
    report.rows.push(row);
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

const low = [];
const fmt = (m) => (!m ? '-' : m.error ? 'n/a' : `${m.ratio}(${m.ink}/${m.bg})`);
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
console.log('theme\tmode\twidth\tvariant\trest\tfocus');
for (const r of report.rows) {
  for (const variant of ['before', 'after']) {
    const m = r[variant];
    if (!m) continue;
    console.log(`${r.theme}\t${r.mode}\t${r.width}\t${variant}\t${fmt(m.rest)}\t${fmt(m.focus)}${r.gated ? '' : '\t(参考)'}`);
    if (variant !== 'after' || !r.gated) continue;
    for (const k of ['rest', 'focus']) if (m[k].error || m[k].ratio < NEED) low.push(`${r.theme}-${r.mode}-${r.width} ${k} ${fmt(m[k])}`);
  }
  for (const e of r.errors) console.log(`${r.theme}\t${r.mode}\t${r.width}\tERROR ${e}`);
}
if (low.length) console.log(`LOW after: ${low.join('; ')}`);
if (report.error || low.length || report.rows.some((r) => r.gated && r.errors.length)) { console.log(`ERROR ${report.error || 'see report.json'}`); process.exitCode = 1; }
