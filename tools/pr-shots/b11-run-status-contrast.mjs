#!/usr/bin/env node
// B11 #449 改前 / 改后读数：运行状态条 section.pk-run 的 R1 `.pk-run__meta`、R2「去确认」/ 跳过白字底色（含 hover），
// 以及「有新消息」`button.chat-new-messages` 边框对外侧。home-thinking × 日 / 夜 × 1440 / 820 / 480。
// 约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关；运行态复用 scripts/chat-ui-harness/run-status-shots.js 的 asking，
// 「有新消息」照 scripts/chat-ui-harness/composer-feedback.cjs 把 chatNewMessagesBelow 钉成 true。
// 「改前」= 本页临时注入 origin/main 的旧值（不进产品文件），「改后」= 本分支 CSS 原样。不连真网关、不改基线。
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
const RUN_SCRIPT = path.join(repoRoot, 'scripts/chat-ui-harness/run-status-shots.js');
const WIDTHS = [1440, 820, 480], HEIGHT = 820;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

// origin/main 4821ee9a 的旧值；R1 / R2 只改过日间，所以只压日间。多一个 :not(#p4) 压过产品规则。
const P = ':not(#p1):not(#p2):not(#p3):not(#p4)';
const MAIN_CSS = `
html:not([data-pinkie-night])${P} .pk-run__meta { color: #a36b82; }
html:not([data-pinkie-night])${P} .pk-run__btn:is([data-act="answer"], [data-act="skip"]) { background: #e94f91; }
html:not([data-pinkie-night])${P} .pk-run__btn:is([data-act="answer"], [data-act="skip"]):hover { background: #c2457c; }
html${P} .chat-new-messages:not(:hover) { border-color: var(--border); }`;
const HIDE = 'color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important';
const META = 'section.pk-run.is-shown .pk-run__meta:not([hidden])';
const BTN = 'section.pk-run.is-shown .pk-run__btn:is([data-act="answer"], [data-act="skip"])';
const PILL = 'button.chat-new-messages';

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

// 计算色 → [r,g,b,a]（经 canvas 归一化，兼容 color() / oklab 等写法）
const colorsOf = (page, sel, props, index = 0) => page.evaluate(({s, ps, k}) => {
  const n = document.querySelectorAll(s)[k];
  if (!n) return null;
  const cs = getComputedStyle(n);
  const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  const rgba = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
  const r = {text: n.textContent.trim().slice(0, 24), act: n.dataset.act || ''};
  for (const p of ps) r[p] = rgba(cs.getPropertyValue(p));
  return r;
}, {s: sel, ps: props, k: index});

async function boxOf(page, sel, index = 0) {
  const box = await page.locator(sel).nth(index).boundingBox().catch(() => null);
  if (!box || box.width < 2 || box.height < 2) return null;
  const vw = page.viewportSize().width;
  return {box, clip: (pad) => {
    const x = Math.max(0, Math.floor(box.x - pad)), y = Math.max(0, Math.floor(box.y - pad));
    return {x, y, width: Math.min(vw - x, Math.ceil(box.width + pad * 2)), height: Math.min(HEIGHT - y, Math.ceil(box.height + pad * 2))};
  }};
}

// R1：字色按计算色叠到「藏字」截图的底色上；底色取均值与最不利像素（字深取最亮、字浅取最暗）两种，报较小者。
async function measureMeta(page) {
  const b = await boxOf(page, META);
  if (!b) return {error: `no ${META}`};
  const info = await colorsOf(page, META, ['color']);
  const bare = decodePng(await withStyle(page, `${META}{${HIDE}}`, () => snap(page, {clip: b.clip(1)})));
  const sum = [0, 0, 0], all = [];
  for (let y = 0; y < bare.height; y++) for (let x = 0; x < bare.width; x++) { const p = px(bare, x, y); all.push(p); p.forEach((v, i) => { sum[i] += v; }); }
  const mean = sum.map((v) => v / all.length);
  const fgMean = over(info.color, mean);
  const dark = lum(fgMean) < lum(mean);
  const worst = all.reduce((w, p) => ((dark ? lum(p) > lum(w) : lum(p) < lum(w)) ? p : w), all[0]);
  const rMean = contrast(fgMean, mean), rWorst = contrast(over(info.color, worst), worst);
  return {text: info.text, color: hex(fgMean), bg: hex(mean), worstBg: hex(worst), ratio: Math.min(rMean, rWorst), rMean, rWorst};
}

// R2：按钮底是实色，直接用计算色；hover 真把鼠标挪上去再读一次。
async function measureButtons(page) {
  const n = await page.locator(BTN).count();
  if (!n) return [{error: `no ${BTN}`}];
  const rows = [];
  for (let k = 0; k < n; k++) {
    const rest = await colorsOf(page, BTN, ['color', 'background-color'], k);
    const bg = over(rest['background-color'], [255, 255, 255]);
    const row = {act: rest.act, text: rest.text, color: hex(over(rest.color, bg)), bg: hex(bg), ratio: contrast(over(rest.color, bg), bg)};
    try {
      await page.locator(BTN).nth(k).hover({timeout: 3000});
      await page.waitForTimeout(150);
      const hv = await colorsOf(page, BTN, ['color', 'background-color'], k);
      const hb = over(hv['background-color'], [255, 255, 255]);
      Object.assign(row, {hoverBg: hex(hb), hoverRatio: contrast(over(hv.color, hb), hb)});
    } catch (error) {
      row.hoverError = String(error?.message || error).slice(0, 160);
    } finally {
      await page.mouse.move(2, 2);
    }
    rows.push(row);
  }
  return rows;
}

// ③：外侧 = 盒子外 3~6px 一圈像素均值；边框计算色叠在外侧上。照 #443 走查量法取 max(边框对外侧, 填充对外侧)。
async function measurePill(page) {
  const b = await boxOf(page, PILL);
  if (!b) return {error: `no ${PILL}`};
  const info = await colorsOf(page, PILL, ['border-top-color', 'background-color']);
  const pad = 6, clip = b.clip(pad);
  const img = decodePng(await snap(page, {clip}));
  const ox = b.box.x - clip.x, oy = b.box.y - clip.y;
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const dx = Math.max(ox - x, x - (ox + b.box.width), 0), dy = Math.max(oy - y, y - (oy + b.box.height), 0);
    const d = Math.max(dx, dy);
    if (d >= 3 && d <= pad) { px(img, x, y).forEach((v, i) => { sum[i] += v; }); n++; }
  }
  if (!n) return {error: 'no outside ring'};
  const outside = sum.map((v) => v / n);
  const border = over(info['border-top-color'], outside), fill = over(info['background-color'], outside);
  const rBorder = contrast(border, outside), rFill = contrast(fill, outside);
  return {text: info.text, border: hex(border), fill: hex(fill), outside: hex(outside), rBorder, rFill, ratio: Math.max(rBorder, rFill)};
}

const measureAll = async (page) => ({meta: await measureMeta(page), buttons: await measureButtons(page), pill: await measurePill(page)});

async function pinNewMessages(page) {
  await page.evaluate(() => {
    const pane = document.querySelector('openclaw-chat-pane');
    if (!pane?.state) throw new Error('no chat pane state');
    Object.defineProperty(pane.state, 'chatNewMessagesBelow', {configurable: true, get: () => true, set: () => {}});
    pane.requestUpdate?.();
  });
  await page.waitForFunction((s) => { const n = document.querySelector(s); return n && n.getBoundingClientRect().width > 10; }, PILL, {timeout: 8000});
}

const report = {engine, need: {meta: 4.5, button: 4.5, pill: 3}, rows: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
try {
  for (const theme of ['day', 'night']) for (const width of WIDTHS) {
    const row = {theme, width, after: null, before: null, errors: []};
    let opened;
    try {
      opened = await H.openRealScenePage(browser, server.origin, 'home-thinking', theme, {timezoneId: 'Asia/Shanghai'});
      const {page} = opened;
      await page.setViewportSize({width, height: HEIGHT});
      await page.addScriptTag({path: RUN_SCRIPT});
      await page.waitForFunction(() => document.querySelector('.chat-thread') && window.__runStatusStates?.length, null, {timeout: 15_000});
      await page.waitForTimeout(1500);
      const names = await page.evaluate(() => window.__runStatusStates);
      const ask = names.indexOf('asking');
      if (ask < 0) throw new Error(`no asking state in ${names.join(',')}`);
      // asking 前的状态按顺序走一遍：共用一条事件流，跳着放会缺前置的 lifecycle start。
      for (let i = 0; i <= ask; i++) { await page.evaluate((k) => window.__runStatusShot(k), i); await page.waitForTimeout(500); }
      await page.waitForFunction((s) => document.querySelector(s), BTN, {timeout: 10_000});
      await pinNewMessages(page);
      await page.waitForTimeout(600);
      await page.mouse.move(2, 2);
      save(`rsc-asking-${width}-${theme}-after`, await snap(page));
      row.after = await measureAll(page);
      await withStyle(page, MAIN_CSS, async () => {
        save(`rsc-asking-${width}-${theme}-before`, await snap(page));
        row.before = await measureAll(page);
      });
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
const fmt = (m) => (!m ? '-' : m.error ? 'n/a' : m.ratio);
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
console.log('theme\twidth\tvariant\tmeta\tbuttons(rest/hover)\tpill(border/fill)');
for (const r of report.rows) {
  for (const variant of ['before', 'after']) {
    const m = r[variant];
    if (!m) continue;
    const btns = m.buttons.map((b) => (b.error ? 'n/a' : `${b.act}:${b.ratio}/${b.hoverRatio ?? 'n/a'}`)).join(' ');
    console.log(`${r.theme}\t${r.width}\t${variant}\t${fmt(m.meta)}\t${btns}\t${m.pill.error ? 'n/a' : `${m.pill.rBorder}/${m.pill.rFill}`}`);
    if (variant !== 'after') continue;
    if (m.meta.error || m.meta.ratio < report.need.meta) low.push(`${r.theme}-${r.width} meta ${fmt(m.meta)}`);
    for (const b of m.buttons) if (b.error || b.ratio < report.need.button || !(b.hoverRatio >= report.need.button)) low.push(`${r.theme}-${r.width} ${b.act || 'button'} ${b.ratio ?? 'n/a'}/${b.hoverRatio ?? 'n/a'}`);
    if (m.pill.error || m.pill.ratio < report.need.pill) low.push(`${r.theme}-${r.width} pill ${fmt(m.pill)}`);
  }
  for (const e of r.errors) console.log(`${r.theme}\t${r.width}\tERROR ${e}`);
}
if (low.length) console.log(`LOW after: ${low.join('; ')}`);
if (report.error || low.length || report.rows.some((r) => r.errors.length)) { console.log(`ERROR ${report.error || 'see report.json'}`); process.exitCode = 1; }
