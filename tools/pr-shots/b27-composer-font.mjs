#!/usr/bin/env node
// B27 输入框下方「Metre」字日 / 夜字体核对，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）：Metre 会话，关掉总谱，拍输入框区域。1280 × 日 / 夜。不连网关、不碰用户会话。
// report.json 记输入框里每个带字的元素（含「Metre」那颗引擎键、Baton / Virtuoso、速度记号 ::before）
// 的 getComputedStyle：font-family / font-style / font-weight / font-size；Chromium 下再记引擎键实际渲染用到的字体（CDP）。
// 末尾 diff 列出日夜不一致的项。
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
const WIDTH = 1280, HEIGHT = 800;

// 只量输入框这一块：外壳 .agent-chat__input 里所有自身带字的元素，外加 ::before / ::after 有字的。
const measure = (page) => page.evaluate(() => {
  const root = document.querySelector('.chat-main .agent-chat__input') || document.querySelector('.agent-chat__input');
  if (!root) return {missing: true, items: [], metre: []};
  const where = (e) => {
    const parts = [];
    for (let x = e; x && x !== root; x = x.parentElement) {
      const cls = [...x.classList].slice(0, 2).map((c) => '.' + c).join('');
      parts.unshift(x.tagName.toLowerCase() + cls);
    }
    return parts.slice(-3).join(' > ');
  };
  const pick = (s) => ({fontFamily: s.fontFamily, fontStyle: s.fontStyle, fontWeight: s.fontWeight, fontSize: s.fontSize});
  const items = [];
  for (const e of root.querySelectorAll('*')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
    if (own) items.push({sel: where(e), text: own.slice(0, 40), pseudo: '', ...pick(getComputedStyle(e)), x: Math.round(r.left), y: Math.round(r.top)});
    for (const pseudo of ['::before', '::after']) {
      const s = getComputedStyle(e, pseudo);
      const c = s.content;
      if (!c || c === 'none' || c === 'normal' || c === '""' || s.display === 'none') continue;
      const text = c.startsWith('attr(') ? '' : c.replace(/^"|"$/g, '');
      const shown = text || e.getAttribute('data-metre-tempo') || '';
      if (!shown.trim()) continue;
      items.push({sel: where(e), text: shown.slice(0, 40), pseudo, ...pick(s), x: Math.round(r.left), y: Math.round(r.top)});
    }
  }
  return {missing: false, items, metre: items.filter((i) => /metre/i.test(i.text))};
});

// Chromium：问 CDP 这个节点实际用的是哪套字体（getComputedStyle 只给声明的字体栈）。
async function platformFonts(page, sel) {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
    const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector: sel});
    if (!nodeId) return null;
    const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId});
    await cdp.detach();
    return fonts;
  } catch (err) {
    return {error: String(err).slice(0, 160)};
  }
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine() || 'chromium';
const report = {cells: [], diff: [], onlyDay: [], onlyNight: []};
const lines = [];

const record = async (page, name, clip) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file), ...(clip ? {clip} : {})});
  lines.push({
    name, file, os: process.platform, browser: engine,
    width: clip ? Math.round(clip.width) : WIDTH,
    height: clip ? Math.round(clip.height) : HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  });
};

const zoom = async (page, sel, name, pad = 24) => {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (!box) return record(page, name);
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  return record(page, name, {x, y, width: Math.min(WIDTH - x, box.width + pad * 2), height: Math.min(HEIGHT - y, box.height + pad * 2)});
};

async function cell(theme) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {timezoneId: 'Asia/Shanghai'});
  try {
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
    await page.waitForTimeout(400);
    await page.locator('.chat-main .agent-chat__input').first().waitFor({state: 'visible', timeout: 15_000});
    // 引擎键（文字「Metre」）是异步插进按键行的，等它出来；等不到也照拍，report 里看得出来。
    await page.waitForSelector('.agent-chat__composer-controls > .pk-eng-chip', {timeout: 8_000}).catch(() => {});
    await page.waitForTimeout(300);
    await record(page, `page-${theme}`);
    await zoom(page, '.chat-main .agent-chat__input', `composer-${theme}`, 20);
    const m = await measure(page);
    const fonts = engine === 'chromium'
      ? {engineChip: await platformFonts(page, '.agent-chat__composer-controls > .pk-eng-chip .pk-eng-chip__name')}
      : null;
    const html = await page.evaluate(() => ({
      mode: document.documentElement.getAttribute('data-laolao-mode'),
      theme: document.documentElement.getAttribute('data-theme'),
      night: document.documentElement.hasAttribute('data-pinkie-night'),
    }));
    report.cells.push({theme, width: WIDTH, engine, html, pageErrors: pageErrors.slice(0, 5), ...m, platformFonts: fonts});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) await cell(theme);
  const [day, night] = report.cells;
  if (day && night) {
    const key = (i) => `${i.sel}${i.pseudo}|${i.text}`;
    const nightBy = new Map(night.items.map((i) => [key(i), i]));
    for (const d of day.items) {
      const n = nightBy.get(key(d));
      if (!n) continue;
      const fields = ['fontFamily', 'fontStyle', 'fontWeight', 'fontSize'].filter((f) => d[f] !== n[f]);
      if (fields.length) report.diff.push({sel: d.sel, pseudo: d.pseudo, text: d.text, fields, day: Object.fromEntries(fields.map((f) => [f, d[f]])), night: Object.fromEntries(fields.map((f) => [f, n[f]]))});
    }
    const dayKeys = new Set(day.items.map(key));
    report.onlyDay = day.items.filter((i) => !nightBy.has(key(i))).map(key);
    report.onlyNight = night.items.filter((i) => !dayKeys.has(key(i))).map(key);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}；日夜字体不一致 ${report.diff.length} 项`);
