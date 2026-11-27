#!/usr/bin/env node
// #96 L39（界面吸收计划第 27 项：Metre 侧栏「用量」入口）的 PR 截图脚本，约定照 tools/pr-shots/minimal.mjs：
// node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）的 metre-board 场景进 /chat，1440×900 / 1024×768 / 820×1180 × 日 / 夜：
// 每格先拍侧栏（悬停「用量」），量字色 / 底色对比度、键自己有没有截断、和同排键有没有重叠；
// 再点一下，记下落到的路径、原生用量页（openclaw-usage-page）有没有出来、键是不是标成当前页，并拍一张用量页。
// 侧栏在窄宽度是抽屉、没露出来时先点原生的侧栏开关；开不了就照实记 sidebarHidden，不硬拍。
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

const SEL = 'aside.sidebar .laolao-session-controls .pk-metre-nav--usage';
const TOGGLES = ['.sidebar-brand__icon[aria-label*="侧栏"]', 'button[aria-label*="展开侧栏"]', 'button[aria-label*="打开侧栏"]', 'button[aria-label*="sidebar" i]'];

const MEASURE = (sel) => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const el = document.querySelector(sel);
  if (!el) return {sel, missing: true};
  const r = el.getBoundingClientRect();
  const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  const layers = [];
  for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) layers.push(c); }
  const base = layers.reverse().reduce((acc, c) => over(c, acc), {r: 255, g: 255, b: 255, a: 1});
  const cs = getComputedStyle(el);
  const own = parse(cs.backgroundColor);
  const ground = own && own.a > 0 ? over(own, base) : base;
  const fg = parse(cs.color);
  const span = el.querySelector('span');
  const truncated = Boolean(span && span.scrollWidth > span.clientWidth + 1);
  const overlaps = [...el.parentElement.children].filter((n) => n !== el).map((n) => ({n, b: n.getBoundingClientRect()}))
    .filter(({b}) => b.width > 0 && b.height > 0 && b.left < r.right - 1 && b.right > r.left + 1 && b.top < r.bottom - 1 && b.bottom > r.top + 1)
    .map(({n}) => n.className || n.tagName);
  const offscreen = r.right > innerWidth + 1 || r.left < -1;
  return {sel, visible, text: el.textContent.trim(), rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
    color: cs.color, bg: cs.backgroundColor, ratio: fg ? +ratio(over(fg, ground), ground).toFixed(2) : null,
    truncated, overlaps, offscreen, current: el.getAttribute('aria-current'),
    night: document.documentElement.hasAttribute('data-pinkie-night'), mode: document.documentElement.getAttribute('data-laolao-mode')};
};

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const engine = String(H.resolveRealEngine() || 'chromium');
const browser = await H.launchRealBrowser(engine);
const report = [];
const lines = [];

function record(name, file, extra) {
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
}

async function revealSidebar(page) {
  if ((await page.evaluate(MEASURE, SEL)).visible) return 'already';
  for (const sel of TOGGLES) {
    const btn = await page.$(sel);
    if (!btn || !(await btn.isVisible())) continue;
    await btn.click();
    await page.waitForTimeout(400);
    if ((await page.evaluate(MEASURE, SEL)).visible) return sel;
  }
  return '';
}

async function cell(theme, width, height) {
  const {context, page, pageErrors, meta} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {lockPerfClock: true});
  try {
    await page.setViewportSize({width, height});
    await page.goto(`${server.origin}/chat?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`, {waitUntil: 'load', timeout: 60_000});
    await page.waitForFunction(() => document.documentElement.getAttribute('data-laolao-mode') === 'metre', null, {timeout: 30_000});
    await page.waitForSelector(SEL, {state: 'attached', timeout: 20_000});
    const opened = await revealSidebar(page);
    const rest = await page.evaluate(MEASURE, SEL);
    if (!rest.visible) { report.push({theme, width, sidebarHidden: true, opened, rest, pageErrors}); return; }
    await page.hover(SEL);
    await page.waitForTimeout(400);
    const hover = await page.evaluate(MEASURE, SEL);
    const name = `l39-usage-entry-${theme}-${width}`;
    await page.screenshot({path: path.join(out, name + '.png'), animations: 'disabled', caret: 'hide'});
    record(name, name + '.png', {restRatio: rest.ratio, hoverRatio: hover.ratio, truncated: rest.truncated, overlaps: rest.overlaps.length});
    await page.click(SEL);
    await page.waitForFunction(() => location.pathname === '/usage', null, {timeout: 10_000}).catch(() => {});
    const usagePage = Boolean(await page.waitForSelector('openclaw-usage-page', {timeout: 15_000}).catch(() => null));
    const routed = await page.evaluate(() => location.pathname);
    const stillMetre = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.waitForTimeout(600);
    await revealSidebar(page);
    const after = await page.evaluate(MEASURE, SEL);
    const name2 = `l39-usage-page-${theme}-${width}`;
    await page.mouse.move(width - 4, height - 4);
    await page.screenshot({path: path.join(out, name2 + '.png'), animations: 'disabled', caret: 'hide'});
    record(name2, name2 + '.png', {routed, usagePage, current: after.current, stillMetre});
    report.push({theme, width, opened, rest, hover, routed, usagePage, stillMetre, after, pageErrors});
  } catch (error) {
    report.push({theme, width, error: error.message, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const [width, height] of [[1440, 900], [1024, 768], [820, 1180]]) {
      await cell(theme, width, height);
      if (report.at(-1)?.error) { report.at(-1).retried = true; await cell(theme, width, height); }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const unique = [...new Map(lines.map((l) => [l.name, l])).values()];
fs.appendFileSync(path.join(out, 'shots.jsonl'), unique.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${unique.length} 张 → ${out}`);
for (const r of report) {
  if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} 出错：${r.error}`);
  else if (r.sidebarHidden) console.log(`pr-shots: ${r.theme} ${r.width} 侧栏没露出来（开关 ${r.opened || '没找到'}）`);
  else console.log(`pr-shots: ${r.theme} ${r.width} 对比度 ${r.rest.ratio}/${r.hover.ratio} 截断 ${r.rest.truncated} 重叠 ${r.rest.overlaps.length} → ${r.routed} 用量页 ${r.usagePage} 当前页 ${r.after.current}`);
}
