#!/usr/bin/env node
// B11 走查 #6（tools/pr-shots/b11-infinite-walkthrough.md:29）作品库选中键字色 + 「再看更多」边框的 PR 截图脚本。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面 settings / home-unrestricted × 1440 / 820 × 日夜 × 改后 / 改前。
// 改前：同页停用 laolao-artifacts.css，换成与 tests/b11-artifacts-chip-more.test.mjs 反例同一套替换还原的旧写法（82% / --pa-line）。
// 作品库数据照 tests/project-artifacts-header.test.mjs 接 gwRequest；list 返回非空 cursor，「再看更多」才显示。
// report 记：选中键（「全部」）文字对自身底、「再看更多」边框对外侧 / 内侧取较差的对比度。
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

const CSS = fs.readFileSync(path.join(repoRoot, 'ui/injections/laolao-artifacts.css'), 'utf8');
const CSS_OLD = CSS
  .replace(/\.pinkie-art-chip\[aria-pressed="true"\] \{[^}]*\}/, (r) => r.replace('var(--pa-accent) 60%', 'var(--pa-accent) 82%'))
  .replace(/\.pinkie-art-more \{[^}]*\}/, (r) => r.replace('border:1px solid var(--pa-edge)', 'border:1px solid var(--pa-line)'));
if (CSS_OLD === CSS) throw new Error('改前替换没有命中，脚本与 CSS 不同步');

const initScript = () => {
  const item = {id: 'a1b2', kind: 'doc', title: '单词表.txt', path: 'C:/work/单词表.txt', mode: 'project', sessionKey: '',
    createdAt: 0, updatedAt: 0, exists: true, size: 2048, version: 1, total: 1,
    versions: [{v: 1, ts: 0, size: 2048, runId: '', source: 'tool', snapshot: true}]};
  const answers = {
    'pinkie.artifacts.list': {ok: true, items: [item], cursor: 'next'},
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.list': {ok: true, apps: []},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__art) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__art = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
};

function measure() {
  const parse = (s) => {
    let m = String(s).match(/^rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = String(s).match(/^color\(srgb\s+([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return [0, 0, 0, 0];
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const chain = (node) => { const list = []; for (let n = node; n && n.nodeType === 1; n = n.parentElement) list.push(n); return list; };
  const backdrop = (node, withSelf) => {
    let c = [255, 255, 255, 1];
    for (const n of chain(withSelf ? node : node.parentElement).reverse()) c = over(parse(getComputedStyle(n).backgroundColor), c);
    return c;
  };
  const opacity = (node) => chain(node).reduce((acc, n) => acc * Number(getComputedStyle(n).opacity || 1), 1);
  const ink = (node, color) => { const c = parse(color); c[3] *= opacity(node); return c; };
  const chip = document.querySelector('.pinkie-art-page .pinkie-art-kinds .pinkie-art-chip[aria-pressed="true"]');
  const more = document.querySelector('.pinkie-art-page .pinkie-art-more:not([hidden])');
  const res = {mode: document.documentElement.getAttribute('data-laolao-mode'), platform: document.documentElement.getAttribute('data-pinkie-platform'), chip: null, more: null};
  if (chip) {
    const bg = backdrop(chip, true);
    res.chip = {text: chip.textContent, color: getComputedStyle(chip).color, ratio: ratio(over(ink(chip, getComputedStyle(chip).color), bg), bg)};
  }
  if (more) {
    const outer = backdrop(more, false);
    const inner = over(parse(getComputedStyle(more).backgroundColor), outer);
    const edge = ink(more, getComputedStyle(more).borderTopColor);
    res.more = {edge: getComputedStyle(more).borderTopColor, ratio: Math.min(ratio(over(edge, outer), outer), ratio(over(edge, inner), inner))};
  }
  return res;
}

async function swapToOld(page) {
  await page.evaluate((text) => {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (/laolao-artifacts\.css/.test(link.getAttribute('href') || '')) link.disabled = true;
    }
    const style = document.createElement('style');
    style.id = 'b11-art-before';
    style.textContent = text;
    document.head.appendChild(style);
  }, CSS_OLD);
  await page.waitForTimeout(200);
}

const HEIGHT = 800;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const engine = String(H.resolveRealEngine() || 'chromium');
const browser = await H.launchRealBrowser(engine);
const report = [];
const lines = [];
const errors = [];

async function shot(page, name, m) {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file), animations: 'disabled', caret: 'hide'});
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20),
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), platform: m.platform});
}

async function cell(scene, theme, width) {
  const where = `${scene}/${theme}/${width}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__art === true, null, {timeout: 15_000});
    await page.evaluate(() => window.PinkieArtifacts.open());
    await page.waitForSelector('.pinkie-art-page .pinkie-art-more:not([hidden])', {timeout: 10_000});
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {timeout: 10_000});
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(1, HEIGHT - 1);
    await page.waitForTimeout(300);
    const after = await page.evaluate(measure);
    await shot(page, `b11-art-after-${scene}-${width}-${theme}`, after);
    await swapToOld(page);
    const before = await page.evaluate(measure);
    await shot(page, `b11-art-before-${scene}-${width}-${theme}`, before);
    report.push({scene, theme, width, after, before, pageErrors});
  } catch (error) {
    errors.push(`${where}: ${error.message.split('\n')[0]}`);
    report.push({scene, theme, width, error: error.message.split('\n')[0]});
  } finally {
    await context.close();
  }
}

try {
  for (const scene of ['settings', 'home-unrestricted']) {
    for (const theme of ['day', 'night']) {
      for (const width of [1440, 820]) await cell(scene, theme, width);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({errors, cells: report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}${errors.length ? `，${errors.length} 格出错` : ''}`);
for (const r of report) {
  if (r.error) console.log(`pr-shots: ${r.scene} ${r.theme} ${r.width} 出错：${r.error}`);
  else console.log(`pr-shots: ${r.scene} ${r.theme} ${r.width} chip ${r.before.chip?.ratio} → ${r.after.chip?.ratio}；more ${r.before.more?.ratio} → ${r.after.more?.ratio}`);
}
