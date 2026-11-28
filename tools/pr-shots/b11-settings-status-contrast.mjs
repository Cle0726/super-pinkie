#!/usr/bin/env node
// B11 走查第 20 项改前 / 改后读数：设置页状态字 `.pinkie-user-settings__status`（默认 / busy）字色对实际底色。
// settings 场景 × 日（5 模式）/ 夜（chat 作不变对照）× 1440 / 820。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关；状态字本来是空的，本页临时写入示例文字和 data-state 再量。
// 「改前」= 本页临时注入 origin/main 的旧色（不进产品文件），「改后」= 本分支 CSS 原样。不连真网关、不改基线。
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
const WIDTHS = [1440, 820], HEIGHT = 900;
const CELLS = [
  ...['chat', 'project', 'thinking', 'learning', 'unrestricted'].map((mode) => ['day', mode]),
  ['night', 'chat'],
];
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

// origin/main 的旧值，只压日间；:not(#p*) 压过产品规则。
const P = ':not(#p1):not(#p2):not(#p3):not(#p4)';
const ST = '#laolao-user-settings .pinkie-user-settings__status';
const MAIN_CSS = `
html:not([data-pinkie-night])${P} ${ST} { color: #54846e; }
html:not([data-pinkie-night])${P} ${ST}[data-state="busy"] { color: #947248; }`;
const HIDE = 'color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important';
const TARGETS = {idle: '[data-pinkie-shot="idle"]', busy: '[data-pinkie-shot="busy"]'};

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
  try { await page.waitForTimeout(120); return await fn(); } finally { await tag.evaluate((n) => n.remove()); }
}

// 头一个可见状态字写默认态，滚到它；再挑同屏内下一个写 busy。
const prepare = (page) => page.evaluate((sel) => {
  const nodes = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
  if (nodes.length < 2) return {error: `visible status nodes ${nodes.length}`};
  nodes[0].scrollIntoView({block: 'center'});
  const inView = (n) => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; };
  const second = nodes.find((n, i) => i > 0 && inView(n)) || nodes[1];
  Object.assign(nodes[0].dataset, {pinkieShot: 'idle', state: 'success'}); nodes[0].textContent = '已保存，下次打开仍然生效。';
  Object.assign(second.dataset, {pinkieShot: 'busy', state: 'busy'}); second.textContent = '正在连接…请稍候';
  return {count: nodes.length};
}, ST);

const colorOf = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const range = document.createRange(); range.selectNodeContents(n);
  const r = range.getBoundingClientRect();
  const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  ctx.fillStyle = '#000'; ctx.fillStyle = getComputedStyle(n).color; ctx.fillRect(0, 0, 1, 1);
  return {text: n.textContent.trim().slice(0, 24), state: n.dataset.state, color: [...ctx.getImageData(0, 0, 1, 1).data],
    box: {x: r.x, y: r.y, width: r.width, height: r.height}};
}, sel);

// 字色按计算色叠到「藏字」截图的底色上；底色取均值与最不利像素，报较小者。
async function measure(page, sel) {
  const info = await colorOf(page, sel);
  if (!info || info.box.width < 2 || info.box.height < 2) return {error: `no visible ${sel}`};
  const vw = page.viewportSize().width, b = info.box;
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  const clip = {x, y, width: Math.min(vw - x, Math.ceil(b.width)), height: Math.min(HEIGHT - y, Math.ceil(b.height))};
  if (clip.width < 2 || clip.height < 2) return {error: `off-screen ${sel}`};
  const bare = decodePng(await withStyle(page, `${sel}{${HIDE}}`, () => snap(page, {clip})));
  const sum = [0, 0, 0], all = [];
  for (let yy = 0; yy < bare.height; yy++) for (let xx = 0; xx < bare.width; xx++) { const p = px(bare, xx, yy); all.push(p); p.forEach((v, i) => { sum[i] += v; }); }
  const mean = sum.map((v) => v / all.length);
  const fg = over(info.color, mean);
  const dark = lum(fg) < lum(mean);
  const worst = all.reduce((w, p) => ((dark ? lum(p) > lum(w) : lum(p) < lum(w)) ? p : w), all[0]);
  const rMean = contrast(fg, mean), rWorst = contrast(over(info.color, worst), worst);
  return {text: info.text, state: info.state, color: hex(fg), bg: hex(mean), worstBg: hex(worst), ratio: Math.min(rMean, rWorst), rMean, rWorst};
}

const measureAll = async (page) => ({idle: await measure(page, TARGETS.idle), busy: await measure(page, TARGETS.busy)});

async function setMode(page, mode) {
  await page.evaluate((m) => document.documentElement.setAttribute('data-laolao-mode', m), mode);
  await page.waitForTimeout(200);
  return page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
}

const report = {engine, need: {idle: 4.5, busy: 4.5}, rows: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
try {
  for (const [theme, mode] of CELLS) for (const width of WIDTHS) {
    const row = {theme, mode, width, modeSeen: null, nodes: null, after: null, before: null, errors: []};
    let opened;
    try {
      opened = await H.openRealScenePage(browser, server.origin, 'settings', theme, {timezoneId: 'Asia/Shanghai'});
      const {page} = opened;
      await page.setViewportSize({width, height: HEIGHT});
      await page.mouse.move(2, 2);
      row.modeSeen = await setMode(page, mode);
      const prep = await prepare(page);
      if (prep.error) throw new Error(prep.error);
      row.nodes = prep.count;
      await page.waitForTimeout(300);
      save(`b11-status-${mode}-${width}-${theme}-after`, await snap(page));
      row.after = await measureAll(page);
      await withStyle(page, MAIN_CSS, async () => {
        save(`b11-status-${mode}-${width}-${theme}-before`, await snap(page));
        row.before = await measureAll(page);
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
const fmt = (m) => (!m ? '-' : m.error ? 'n/a' : `${m.ratio}(${m.color}/${m.bg})`);
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
console.log('theme\tmode\twidth\tvariant\tidle\tbusy');
for (const r of report.rows) {
  for (const variant of ['before', 'after']) {
    const m = r[variant];
    if (!m) continue;
    console.log(`${r.theme}\t${r.mode}\t${r.width}\t${variant}\t${fmt(m.idle)}\t${fmt(m.busy)}`);
    if (variant !== 'after') continue;
    for (const k of ['idle', 'busy']) if (m[k].error || m[k].ratio < report.need[k]) low.push(`${r.theme}-${r.mode}-${r.width} ${k} ${fmt(m[k])}`);
  }
  for (const e of r.errors) console.log(`${r.theme}\t${r.mode}\t${r.width}\tERROR ${e}`);
}
if (low.length) console.log(`LOW after: ${low.join('; ')}`);
if (report.error || low.length || report.rows.some((r) => r.errors.length)) { console.log(`ERROR ${report.error || 'see report.json'}`); process.exitCode = 1; }
