#!/usr/bin/env node
// B11·T5（thinking.md T5）改前 / 改后数值：火花按钮 .laolao-deep-think-btn 在悬停 / 菜单展开（鼠标在按钮上）/ 菜单展开（鼠标移开）
// 三种状态下火花图标与按钮描边的对比度，夜 / 日 × 1440 / 820，thinking 首页。
// 两种输入框：input = 常规输入框（theme.css 的 !important 规则接管按钮外观，证明本分支不改像素）；
// plain = html[data-laolao-plain-composer]（theme.css 规则不适用，真正走 laolao-deep-think.js 的 :609 与 :648 夜间覆盖）。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关；不连真网关、不改基线。
// 「改前」= 运行时从 #laolao-deep-think-style 里删掉本分支追加在 :648 的夜间按钮覆盖，「改后」= 本分支原样。
// 图标：stroke 计算色对「藏火花」同框截图的按钮中心像素；描边：border 计算色叠在按钮外侧像素上，对外侧像素与按钮内侧像素取较小值。
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
const PAD = 4;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

const OVERRIDE = ':is(html[data-theme-mode="dark"],html[data-pinkie-night]) :is(.laolao-deep-think-btn:hover,.laolao-deep-think-btn[aria-expanded="true"],.laolao-deep-think-btn.is-selected){';
const BTN = '.agent-chat__input .laolao-deep-think-btn';
const HIDE = `${BTN} .laolao-deep-think-btn__spark{visibility:hidden!important}`;

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgbaOf = (s) => { const n = (String(s).match(/[\d.]+/g) || []).map(Number); return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]; };
const over = ([r, g, b, a], bg) => [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));
const r2 = (v) => Math.round(v * 100) / 100;

const snap = (page, opts = {}) => engine === 'webkit'
  ? wkshotBuffer(page, {settleMs: 150, ...opts})
  : page.screenshot({animations: 'disabled', ...opts});
const lines = [];
const save = (name, width, buf) => {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

async function withStyle(page, css, fn) {
  const handle = await page.addStyleTag({content: css});
  try { await page.waitForTimeout(60); return await fn(); } finally { await handle.evaluate((el) => el.remove()); await page.waitForTimeout(60); }
}

// 删掉 :648 行尾的夜间按钮覆盖；找不到就报错，避免「改前」悄悄等于「改后」。
const stripOverride = (page) => page.evaluate((head) => {
  const el = document.getElementById('laolao-deep-think-style');
  const at = el ? el.textContent.indexOf(head) : -1;
  if (at < 0) return false;
  const end = el.textContent.indexOf('}', at);
  el.textContent = el.textContent.slice(0, at) + el.textContent.slice(end + 1);
  return true;
}, OVERRIDE);

async function measure(page) {
  const btn = page.locator(BTN).first();
  const info = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector('.laolao-deep-think-btn__spark');
    const r = el.getBoundingClientRect();
    return {bg: cs.backgroundColor, color: cs.color, stroke: svg ? getComputedStyle(svg).stroke : null,
      borderColor: cs.borderTopColor, borderWidth: parseFloat(cs.borderTopWidth) || 0,
      sparkShown: Boolean(svg && getComputedStyle(svg).display !== 'none'), expanded: el.getAttribute('aria-expanded'),
      hover: el.matches(':hover'), rect: [r.left, r.top, r.width, r.height]};
  });
  if (!info.sparkShown) return {...info, error: 'spark hidden'};
  const [x, y, w, h] = info.rect;
  const x0 = Math.max(0, Math.floor(x) - PAD), y0 = Math.max(0, Math.floor(y) - PAD);
  const clip = {x: x0, y: y0, width: Math.ceil(w) + 2 * PAD, height: Math.ceil(h) + 2 * PAD};
  const A = decodePng(await snap(page, {clip}));
  const B = decodePng(await withStyle(page, HIDE, () => snap(page, {clip})));
  const cx = Math.floor(x - x0 + w / 2), cy = Math.floor(y - y0 + h / 2);
  const base = px(B, cx, cy);
  const outside = px(B, Math.max(0, Math.floor(x - x0) - 2), cy);
  let ink = 1;
  for (let j = 0; j < A.height; j++) for (let i = 0; i < A.width; i++) ink = Math.max(ink, contrast(px(A, i, j), px(B, i, j)));
  const stroke = rgbaOf(info.stroke || info.color).slice(0, 3);
  const m = {...info, base: hex(base), outside: hex(outside), strokeHex: hex(stroke), ratio: r2(contrast(stroke, base)), ink: r2(ink)};
  const bc = rgbaOf(info.borderColor);
  if (info.borderWidth > 0 && bc[3] > 0) {
    const edge = over(bc, outside);
    m.borderHex = hex(edge);
    m.border = r2(Math.min(contrast(edge, outside), contrast(edge, base)));
  } else m.border = null;
  return m;
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
const report = {engine, need: NEED, cells: [], errors: []};
try {
  for (const composer of ['input', 'plain']) for (const theme of ['night', 'day']) for (const width of [1440, 820]) for (const variant of ['before', 'after']) {
    let opened;
    const cell = {composer, theme, width, variant, states: {}};
    try {
      opened = await H.openRealScenePage(browser, server.origin, 'home-thinking', theme, {timezoneId: 'Asia/Shanghai'});
      const {page, pageErrors} = opened;
      await page.setViewportSize({width, height: HEIGHT});
      const btn = page.locator(BTN).first();
      await btn.waitFor({state: 'visible', timeout: 15_000});
      await page.waitForTimeout(500);
      if (composer === 'plain') await page.evaluate(() => document.documentElement.setAttribute('data-laolao-plain-composer', ''));
      if (variant === 'before' && !(await stripOverride(page))) throw new Error('night override not found in #laolao-deep-think-style');
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
      await page.mouse.move(5, HEIGHT - 5);
      await page.waitForTimeout(350);
      cell.states.menuOpen = await measure(page);
      save(`t5-deepthink-btn-${composer}-${width}-${theme}-${variant}`, width, await snap(page));
      cell.pageErrors = pageErrors.slice(0, 5);
    } catch (error) {
      cell.error = String(error?.message || error).slice(0, 300);
      report.errors.push(`${composer}-${theme}-${width}-${variant}: ${cell.error}`);
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
// 门槛：改后各态火花图标 ≥3；夜间有描边时描边 ≥3（日间描边只记数，不在本单范围）。
const bad = [];
const same = [];
const key = (c) => `${c.composer}-${c.theme}-${c.width}`;
const byKey = new Map();
for (const c of report.cells) {
  for (const [state, m] of Object.entries(c.states)) {
    console.log(`${c.composer}\t${c.theme}\t${c.width}\t${c.variant}\t${state}\t${m.error ? 'ERROR ' + m.error : `stroke=${m.strokeHex} base=${m.base} ratio=${m.ratio} ink=${m.ink} border=${m.border ?? '-'}${m.borderHex ? '(' + m.borderHex + ' vs ' + m.outside + ')' : ''} bg=${m.bg} expanded=${m.expanded} hover=${m.hover}`}`);
    if (c.variant !== 'after' || m.error || state === 'rest') continue;
    if (m.ratio < NEED) bad.push(`${key(c)} ${state} icon ${m.ratio}`);
    if (c.theme === 'night' && m.border !== null && m.border < NEED) bad.push(`${key(c)} ${state} border ${m.border}`);
  }
  if (c.error) console.log(`${key(c)}\t${c.variant}\tERROR ${c.error}`);
  if (!byKey.has(key(c))) byKey.set(key(c), {});
  byKey.get(key(c))[c.variant] = c;
}
// 常规输入框里改前 = 改后（theme.css 的 !important 接管），逐态比计算色。
for (const [k, v] of byKey) {
  if (!k.startsWith('input-') || !v.before || !v.after) continue;
  for (const s of Object.keys(v.after.states)) {
    const a = v.after.states[s], b = v.before.states[s];
    if (!b || a.bg !== b.bg || a.borderColor !== b.borderColor || a.stroke !== b.stroke) same.push(`${k} ${s} changed: ${b?.bg}/${b?.borderColor} -> ${a.bg}/${a.borderColor}`);
  }
}
if (same.length) console.log(`NOTE input composer differs before/after: ${same.join('; ')}`);
if (report.errors.length || bad.length) { console.log(`ERROR ${[...report.errors, ...bad].join('; ')}`); process.exitCode = 1; }
