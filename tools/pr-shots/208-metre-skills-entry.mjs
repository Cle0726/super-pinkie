#!/usr/bin/env node
// #208（19 / G3：Metre 设置弹层「技能」入口）的 PR 截图脚本，约定照 tools/pr-shots/minimal.mjs：
// node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json（量到的字色 / 底色 / 对比度、点后路由）。
// 真页面（tests/visual/lib/real-harness.mjs）的 metre-board 场景进 /settings/general，1440×900 / 820×1180 × 日 / 夜，
// 每格把技能卡滚进视口、悬停「打开技能」拍整页，再点一下记下落到的路径。对比度逐层叠背景（含 alpha，渐变逐个色标）算。
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

const MEASURE = (sel) => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const el = document.querySelector(sel);
  if (!el) return {sel, missing: true};
  const layers = [];
  for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) layers.push(c); }
  const base = layers.reverse().reduce((acc, c) => over(c, acc), {r: 255, g: 255, b: 255, a: 1});
  const cs = getComputedStyle(el);
  const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse);
  const own = parse(cs.backgroundColor);
  const grounds = stops.length ? stops.map((c) => over(c, base)) : [own && own.a > 0 ? over(own, base) : base];
  const fg = parse(cs.color);
  return {sel, text: el.textContent.trim().slice(0, 12), color: cs.color, bg: cs.backgroundColor,
    night: document.documentElement.hasAttribute('data-pinkie-night'), mode: document.documentElement.getAttribute('data-laolao-mode'),
    ratio: +Math.min(...grounds.map((g) => ratio(over(fg, g), g))).toFixed(2)};
};

const CARD = '#laolao-user-settings .pk-metre-skills';
const SEL = CARD + ' .pk-metre-skills__open';
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const engine = String(H.resolveRealEngine() || 'chromium');
const browser = await H.launchRealBrowser(engine);
const report = [];
const lines = [];

async function cell(theme, width, height) {
  const {context, page, pageErrors, meta} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {lockPerfClock: true});
  try {
    await page.setViewportSize({width, height});
    await page.goto(`${server.origin}/settings/general?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`, {waitUntil: 'load', timeout: 60_000});
    await page.waitForFunction(() => document.documentElement.getAttribute('data-laolao-mode') === 'metre', null, {timeout: 30_000});
    await page.waitForSelector('#laolao-user-settings:not([hidden])', {timeout: 30_000});
    await page.waitForSelector(SEL, {timeout: 10_000});
    await page.locator(CARD).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const rest = await page.evaluate(MEASURE, SEL);
    await page.hover(SEL);
    await page.waitForTimeout(400);
    const hover = await page.evaluate(MEASURE, SEL);
    const name = `208-metre-skills-${theme}-${width}`;
    const file = name + '.png';
    await page.screenshot({path: path.join(out, file), animations: 'disabled', caret: 'hide'});
    await page.click(SEL);
    await page.waitForFunction(() => location.pathname === '/skills', null, {timeout: 10_000}).catch(() => {});
    const skillsPage = Boolean(await page.waitForSelector('openclaw-skills-page', {timeout: 15_000}).catch(() => null));
    const routed = await page.evaluate(() => location.pathname);
    const buf = fs.readFileSync(path.join(out, file));
    lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'), restRatio: rest.ratio, hoverRatio: hover.ratio, routed, skillsPage});
    report.push({theme, width, rest, hover, routed, skillsPage, pageErrors});
  } catch (error) {
    report.push({theme, width, error: error.message, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const [width, height] of [[1440, 900], [820, 1180]]) {
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
for (const r of report) if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} 出错：${r.error}`);
