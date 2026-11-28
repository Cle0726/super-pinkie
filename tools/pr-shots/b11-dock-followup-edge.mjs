#!/usr/bin/env node
// B11 thinking.md 外壳表：分屏按钮 `.laolao-mode-dock-trigger` 与运行中追问方式按钮 `button.laolao-followup-mode-btn` 边框改前 / 改后读数。
// dock：home-<模式> 场景 × 日 / 夜 × 1440（真页面装了 app/windows_bridge_scripts.py 的 laolaoWorkspaceDock，按钮会出现）。
// followup：home-thinking / home-chat 场景发一句，假网关跑 narrated（进行中）× 日 / 夜 × 1440 / 820，拍 live、展开思考后的 thought，再点一下切成 queue。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 读数口径同 b11-thinking-walkthrough.mjs:253–258：边框色叠到按钮外一圈的外底上，对外底取比值（均值与最不利像素取较小者）。
// 「改前」= 本页临时注入 origin/main 的旧边框（不进产品文件），「改后」= 本分支 CSS 原样。不连真网关、不改基线。
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
const HEIGHT = 900, RING = 3, NEED = 3;
const THEMES = ['day', 'night'];
const DOCK_MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];
const FOLLOW_MODES = ['thinking', 'chat'];
const FOLLOW_WIDTHS = [1440, 820];
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

const DOCK = '.laolao-mode-dock-trigger';
const FOLLOW = '.agent-chat__input button.laolao-followup-mode-btn';
// origin/main 的旧边框：dock rgba(205,85,137,.30)；followup accent 28% / queue 48% 叠透明。:not(#p*) 压过产品规则。
const P = ':not(#p1):not(#p2):not(#p3):not(#p4)';
const MAIN_CSS = `
html${P} ${DOCK} { border-color: rgba(205, 85, 137, .30) !important; }
html${P} ${FOLLOW} { border-color: color-mix(in srgb, var(--accent) 28%, transparent) !important; }
html${P} ${FOLLOW}[data-pinkie-followup-mode="queue"] { border-color: color-mix(in srgb, var(--accent) 48%, transparent) !important; }`;

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => +((Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05)).toFixed(2);
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const over = (rgba, bg) => rgba.slice(0, 3).map((v, i) => v * (rgba[3] / 255) + bg[i] * (1 - rgba[3] / 255));
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };

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
  try { await page.waitForTimeout(150); return await fn(); } finally { await tag.evaluate((n) => n.remove()); }
}

// 第一个可见节点的序号 + 计算边框色（经 canvas 归一化，兼容 color-mix / oklab）
const edgeOf = (page, sel) => page.evaluate((s) => {
  const nodes = [...document.querySelectorAll(s)];
  const k = nodes.findIndex((n) => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(n).visibility !== 'hidden'; });
  if (k < 0) return null;
  const cs = getComputedStyle(nodes[k]);
  const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillStyle = cs.borderTopColor; ctx.fillRect(0, 0, 1, 1);
  return {index: k, width: parseFloat(cs.borderTopWidth) || 0, raw: cs.borderTopColor, color: [...ctx.getImageData(0, 0, 1, 1).data]};
}, sel);

// 外底 = 按钮藏起来（visibility:hidden，连阴影一起）后，按钮框外 RING px 一圈的像素。
async function measure(page, sel) {
  const info = await edgeOf(page, sel);
  if (!info) return {error: `no visible ${sel}`};
  const box = await page.locator(sel).nth(info.index).boundingBox();
  const vw = page.viewportSize().width;
  const x0 = Math.max(0, Math.floor(box.x) - RING), y0 = Math.max(0, Math.floor(box.y) - RING);
  const x1 = Math.min(vw, Math.ceil(box.x + box.width) + RING), y1 = Math.min(HEIGHT, Math.ceil(box.y + box.height) + RING);
  const bare = decodePng(await withStyle(page, `${sel}{visibility:hidden!important}`, () => snap(page, {clip: {x: x0, y: y0, width: x1 - x0, height: y1 - y0}})));
  const ix0 = Math.floor(box.x) - x0, iy0 = Math.floor(box.y) - y0, ix1 = Math.ceil(box.x + box.width) - x0, iy1 = Math.ceil(box.y + box.height) - y0;
  const ring = [];
  for (let yy = 0; yy < bare.height; yy++) for (let xx = 0; xx < bare.width; xx++) {
    if (xx >= ix0 && xx < ix1 && yy >= iy0 && yy < iy1) continue;
    ring.push(px(bare, xx, yy));
  }
  if (!ring.length) return {error: 'empty ring'};
  const mean = [0, 1, 2].map((i) => ring.reduce((s, p) => s + p[i], 0) / ring.length);
  const fg = over(info.color, mean);
  const dark = lum(fg) < lum(mean);
  const worst = ring.reduce((w, p) => ((dark ? lum(p) > lum(w) : lum(p) < lum(w)) ? p : w), ring[0]);
  const rMean = contrast(fg, mean), rWorst = contrast(over(info.color, worst), worst);
  return {edge: hex(fg), raw: info.raw, borderWidth: info.width, bg: hex(mean), worstBg: hex(worst), ratio: Math.min(rMean, rWorst), rMean, rWorst};
}

async function beforeAfter(page, sel, name) {
  save(`${name}-after`, await snap(page));
  const after = await measure(page, sel);
  const before = await withStyle(page, MAIN_CSS, async () => {
    save(`${name}-before`, await snap(page));
    return measure(page, sel);
  });
  return {after, before};
}

const RUNNING = {active: true, phase: 'working', review: {phase: 'idle'}, continuations: {tier: 0, integrity: 0}, missing: []};
const report = {engine, need: NEED, rows: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();

async function openScene(scene, theme, width) {
  const opened = await H.openRealScenePage(browser, server.origin, scene, theme, {timezoneId: 'Asia/Shanghai'});
  await opened.page.setViewportSize({width, height: HEIGHT});
  await opened.page.mouse.move(2, HEIGHT - 2);
  await opened.page.waitForTimeout(500);
  return opened;
}

async function dockCell(mode, theme) {
  const width = 1440;
  const row = {target: 'dock', scene: `home-${mode}`, view: '', theme, width, errors: []};
  let opened;
  try {
    opened = await openScene(`home-${mode}`, theme, width);
    await opened.page.locator(DOCK).first().waitFor({state: 'visible', timeout: 10_000});
    Object.assign(row, await beforeAfter(opened.page, DOCK, `dock-home-${mode}-${width}-${theme}`));
  } catch (error) {
    row.errors.push(String(error?.message || error).slice(0, 300));
  } finally {
    await opened?.context.close();
  }
  report.rows.push(row);
}

async function followCells(mode, theme, width) {
  const scene = `home-${mode}`;
  let opened;
  const push = (view, data, error) => report.rows.push({target: 'followup', scene, view, theme, width, ...data, errors: error ? [String(error?.message || error).slice(0, 300)] : []});
  try {
    opened = await openScene(scene, theme, width);
    const {page} = opened;
    await page.evaluate((running) => {
      window.__fakeRunStatus = running;
      window.__fake.auto('narrated', {thinking: true, gap: 6000, once: true});
      const send = window.__fake.checks?.send || window.__fake.send;
      send('帮我想想这个周末的读书计划怎么排');
    }, RUNNING);
    const shot = async (view) => {
      try {
        await page.locator(FOLLOW).first().waitFor({state: 'visible', timeout: 15_000});
        await page.waitForTimeout(300);
        push(view, await beforeAfter(page, FOLLOW, `followup-${scene}-${view}-${width}-${theme}`));
      } catch (error) {
        push(view, {}, error);
      }
    };
    await page.waitForFunction(() => document.querySelector('.pinkie-thinking') && document.querySelector('.chat-group--process[data-pinkie-process]'), null, {timeout: 15_000}).catch(() => {});
    await shot('live');
    const head = page.locator('.pinkie-thinking__head').first();
    if (await head.count()) await head.click().catch(() => {});
    await page.waitForFunction(() => document.querySelector('.pinkie-thinking__body')?.getBoundingClientRect().height > 8, null, {timeout: 8_000}).catch(() => {});
    await shot('thought');
    await page.locator(FOLLOW).first().click({timeout: 5_000}).catch(() => {});
    await page.waitForFunction((s) => document.querySelector(s)?.dataset.pinkieFollowupMode === 'queue', FOLLOW, {timeout: 5_000}).catch(() => {});
    await page.mouse.move(2, HEIGHT - 2);
    await shot('queue');
  } catch (error) {
    push('open', {}, error);
  } finally {
    await opened?.context.close();
  }
}

try {
  for (const theme of THEMES) for (const mode of DOCK_MODES) await dockCell(mode, theme);
  for (const theme of THEMES) for (const mode of FOLLOW_MODES) for (const width of FOLLOW_WIDTHS) await followCells(mode, theme, width);
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
const fmt = (m) => (!m ? '-' : m.error ? `n/a(${m.error})` : `${m.ratio}(${m.edge}/${m.bg})`);
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
console.log('target\tscene\tview\ttheme\twidth\tbefore\tafter');
for (const r of report.rows) {
  console.log(`${r.target}\t${r.scene}\t${r.view}\t${r.theme}\t${r.width}\t${fmt(r.before)}\t${fmt(r.after)}`);
  if (r.after && (r.after.error || r.after.ratio < NEED)) low.push(`${r.target}-${r.scene}-${r.view}-${r.theme}-${r.width} ${fmt(r.after)}`);
  for (const e of r.errors) console.log(`${r.target}\t${r.scene}\t${r.view}\t${r.theme}\t${r.width}\tERROR ${e}`);
}
if (low.length) console.log(`LOW after: ${low.join('; ')}`);
if (report.error || low.length || report.rows.some((r) => r.errors.length)) { console.log(`ERROR ${report.error || 'see report.json'}`); process.exitCode = 1; }
