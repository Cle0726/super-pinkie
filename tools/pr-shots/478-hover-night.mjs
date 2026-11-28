#!/usr/bin/env node
// #478（B24：设置弹层 6 个共享键夜间 hover 边框 alpha .5 → .62）的 PR 截图脚本，约定照 tools/pr-shots/minimal.mjs：
// node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json（量到的边框 / 底色 / 对比度）。
// 真页面（tests/visual/lib/real-harness.mjs）的 settings 场景，只拍夜间，1440×900 / 820×1180。
// 每格把「看上个月」（共享键 .pinkie-user-settings__button）滚进视口、悬停后拍：
//   改后 = 本分支 CSS 原样（.62）；改前 = 本页临时注入 origin/main 的旧值 .5（不进产品文件）。
// 每张整页图另配一张键周围的局部图（-crop），1px 边框在整页图里不好看清。
// 边框对比按 tests/settings-hover-border-night.test.mjs 的口径：对外侧（键外的卡片）和对内侧（键自己的 hover 底）取较差，要 ≥ 3:1。
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

const SEL = '#laolao-user-settings .laolao-recap-open';
const OLD = 'rgba(255, 154, 196, .5)';
// 只压夜间；!important 盖过本分支夜间块里的 .62。
const BEFORE_CSS = `html[data-pinkie-night] #laolao-user-settings { --pinkie-settings-hover-border: ${OLD} !important; }`;
const SIZES = [[1440, 900], [820, 1180]];

const MEASURE = (sel) => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const el = document.querySelector(sel);
  if (!el) return {sel, missing: true};
  const layers = [];
  for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) layers.push(c); }
  const outside = layers.reverse().reduce((acc, c) => over(c, acc), {r: 0, g: 0, b: 0, a: 1});
  const cs = getComputedStyle(el);
  const own = parse(cs.backgroundColor);
  const inside = own && own.a > 0 ? over(own, outside) : outside;
  const edge = parse(cs.borderTopColor);
  const rOut = ratio(over(edge, outside), outside), rIn = ratio(over(edge, inside), inside);
  return {sel, text: el.textContent.trim().slice(0, 12),
    night: document.documentElement.hasAttribute('data-pinkie-night'),
    hoverBorderVar: getComputedStyle(document.getElementById('laolao-user-settings')).getPropertyValue('--pinkie-settings-hover-border').trim(),
    border: cs.borderTopColor, borderWidth: cs.borderTopWidth, outsideBg: hex(outside), insideBg: hex(inside),
    outside: +rOut.toFixed(2), inside: +rIn.toFixed(2), ratio: +Math.min(rOut, rIn).toFixed(2)};
};

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const engine = String(H.resolveRealEngine() || 'chromium');
const browser = await H.launchRealBrowser(engine);
const report = [];
const lines = [];

const record = (name, buf, extra) => {
  const file = name + '.png';
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};

async function shoot(page, name, m) {
  const extra = {hoverBorderVar: m.hoverBorderVar, borderOutside: m.outside, borderInside: m.inside};
  record(name, await page.screenshot({animations: 'disabled', caret: 'hide'}), extra);
  const box = await page.locator(SEL).boundingBox();
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x - 24)), y = Math.max(0, Math.floor(box.y - 24));
  const clip = {x, y, width: Math.min(vp.width - x, Math.ceil(box.width + 48)), height: Math.min(vp.height - y, Math.ceil(box.height + 48))};
  record(name + '-crop', await page.screenshot({clip, animations: 'disabled', caret: 'hide'}), extra);
}

async function cell(width, height) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'settings', 'night', {lockPerfClock: true});
  const row = {width, height, after: null, before: null, errors: [], pageErrors};
  try {
    await page.setViewportSize({width, height});
    await page.waitForSelector(SEL, {timeout: 10_000});
    await page.locator(SEL).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.hover(SEL);
    await page.waitForTimeout(400);   // 边框 transition .16s
    row.after = await page.evaluate(MEASURE, SEL);
    if (!row.after.night) row.errors.push('not night: html lacks data-pinkie-night');
    await shoot(page, `478-hover-night-${width}-after`, row.after);
    const tag = await page.addStyleTag({content: BEFORE_CSS});
    await page.waitForTimeout(400);
    row.before = await page.evaluate(MEASURE, SEL);
    await shoot(page, `478-hover-night-${width}-before`, row.before);
    await tag.evaluate((n) => n.remove());
  } catch (error) {
    row.errors.push(String(error?.message || error).slice(0, 300));
  } finally {
    await context.close();
  }
  return row;
}

try {
  for (const [width, height] of SIZES) {
    let row = await cell(width, height);
    if (row.errors.length) row = {...(await cell(width, height)), retried: true, firstErrors: row.errors};
    report.push(row);
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const unique = [...new Map(lines.map((l) => [l.name, l])).values()];
fs.appendFileSync(path.join(out, 'shots.jsonl'), unique.map((l) => JSON.stringify(l) + '\n').join(''));

console.log(`pr-shots: ${unique.length} 张 → ${out}（${engine}）`);
console.log('width\tvariant\thover-border\t对卡片\t对 hover 底\t较差');
let bad = false;
for (const r of report) {
  for (const v of ['before', 'after']) {
    const m = r[v];
    if (!m || m.missing) { console.log(`${r.width}\t${v}\tmissing`); bad = true; continue; }
    console.log(`${r.width}\t${v}\t${m.hoverBorderVar}\t${m.outside}\t${m.inside}\t${m.ratio}`);
  }
  if (r.after && !r.after.missing && r.after.ratio < 3) { console.log(`LOW after ${r.width}: ${r.after.ratio}:1`); bad = true; }
  for (const e of r.errors) { console.log(`${r.width}\tERROR ${e}`); bad = true; }
}
if (bad) process.exitCode = 1;
