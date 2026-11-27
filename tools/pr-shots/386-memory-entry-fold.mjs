#!/usr/bin/env node
// #386（B57 Metre 底栏记忆入口挂上那一帧就藏）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）的 metre-board 场景进 /cron。等 laolao-memory.js 挂的入口被收进「更多工具」后，
// 照 ensureEntry() 同步重挂一个，同一个任务里马上拍——这正是修前会露出、把设置挤到方灯上的那一帧。
// 每格（1440 / 820 × 日夜）拍整页一张 + 侧栏底栏放大一张；report.json 记底栏每个按钮的横向范围、方灯和压灯的按钮。
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

// 同 tests/metre-memory-entry-fold-b57-real.test.mjs：同步重挂入口，返回底栏量值和底栏框（截图用）。
function remount() {
  document.querySelectorAll('.laolao-memory-entry').forEach((n) => n.remove());
  const host = document.querySelector('.sidebar-shell__footer .sidebar-footer-bar') || document.querySelector('.sidebar-shell__footer');
  if (!host) return null;
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'laolao-memory-entry';
  entry.title = '当前模式的独立长期记忆';
  entry.setAttribute('aria-label', '打开当前模式的独立长期记忆');
  host.append(entry);
  const side = document.querySelector('aside.sidebar');
  const lamp = side?.querySelector('.pinkie-connection-status');
  const box = (e) => { const r = e.getBoundingClientRect(); return {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom)}; };
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const lb = lamp && shown(lamp) ? box(lamp) : null;
  const items = [];
  for (const e of side?.querySelectorAll('.sidebar-shell__footer :is(button, a, [role="button"])') || []) {
    if (e.closest('.laolao-mode-switcher, .pinkie-connection-status') || !shown(e)) continue;
    items.push({id: e.getAttribute('aria-label') || e.id || e.title || e.className.split(' ')[0], ...box(e)});
  }
  const onLamp = lb ? items.filter((i) => i.l < lb.r && lb.l < i.r && i.t < lb.b && lb.t < i.b).map((i) => i.id) : [];
  const f = document.querySelector('.sidebar-shell__footer')?.getBoundingClientRect();
  return {memoryDisplay: getComputedStyle(entry).display, lamp: lb, items, onLamp, footer: f ? {x: f.left, y: f.top, width: f.width, height: f.height} : null};
}

const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const save = (name, buf, width, extra = {}) => lines.push({name, file: `${name}.png`, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
  bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});

async function cell(theme, width) {
  const {context, page, meta, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.goto(`${server.origin}/cron?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`, {waitUntil: 'load', timeout: 60_000});
    await page.waitForFunction(() => document.documentElement.getAttribute('data-laolao-mode') === 'metre', null, {timeout: 30_000});
    const folded = await page.waitForFunction(() => document.querySelector('.laolao-memory-entry')?.dataset.laolaoFooterSecondary === '1', null, {timeout: 30_000})
      .then(() => true, () => false);
    await page.waitForTimeout(300);
    // 截图要出一帧，classic-shell 的 rAF 标记会先跑，所以图里是那一帧之后的底栏（修前修后看着一样，用来看底栏没被改坏）；
    // 挂上那一刻露没露、压没压灯，以 report.json 为准（remount() 在同一个任务里读的，修前 memoryDisplay grid、设置压灯）。
    const got = await page.evaluate(remount);
    const name = `b57-memory-entry-${width}-${theme}`;
    save(name, await page.screenshot({path: path.join(out, `${name}.png`)}), width, {folded, memoryDisplay: got?.memoryDisplay, onLamp: got?.onLamp});
    if (got?.footer) {
      const f = got.footer, clip = {x: Math.max(0, f.x), y: Math.max(0, f.y - 8), width: Math.min(width, f.width), height: Math.min(HEIGHT - Math.max(0, f.y - 8), f.height + 16)};
      const zoom = `${name}-footer`;
      save(zoom, await page.screenshot({path: path.join(out, `${zoom}.png`), clip, scale: 'device'}), width, {clip});
    }
    report.push({theme, width, folded, ...got, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell(theme, width);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) console.log(`${r.width}-${r.theme}\tfolded=${r.folded} memory=${r.memoryDisplay} onLamp=${JSON.stringify(r.onLamp)} items=${JSON.stringify((r.items || []).map((i) => `${i.id.slice(0, 6)}${i.l}..${i.r}`))}`);
