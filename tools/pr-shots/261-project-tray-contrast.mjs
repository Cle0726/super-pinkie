#!/usr/bin/env node
// #261 #5+#10 截图：项目模式侧栏「临时」、工作程度芯片与箭头、「工具」按钮。约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>。
// 真页面 home-project × 日 / 夜 × 1440 / 820，每格拍整页 + 输入框托盘和「临时」附近放大 3 倍。
// --old 把改动前的配方贴回页面，拍「改前」对照（文件名带 -old）。PINKIE_VISUAL_ENGINE=webkit 走 WebKit（本机 page.screenshot 回 0 字节，改用 wkshotBuffer）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {wkshotBuffer} from '../../tests/visual/lib/webkit-screenshot.mjs';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const out = path.resolve(opt('--out', process.env.PINKIE_SHOTS_OUT || 'shots'));
const old = args.includes('--old');
const repoRoot = path.resolve(opt('--repo', fileURLToPath(new URL('../../', import.meta.url))));
fs.mkdirSync(out, {recursive: true});

const OLD_RECIPE = `
.pinkie-temp-entry.pinkie-temp-entry { color: color-mix(in srgb, currentColor 55%, transparent) !important; opacity: .75 !important; }
.pinkie-chip.pinkie-chip--mode:not(#_x) { color: color-mix(in srgb, currentColor 68%, transparent) !important; }
.pinkie-chip--mode .pinkie-chip__caret.pinkie-chip__caret { opacity: .7 !important; stroke-width: 1.5 !important; }
.agent-chat__input .pinkie-tray-btn.pinkie-tray-btn { color: var(--fog-muted, color-mix(in srgb, currentColor 68%, transparent)) !important; }
`;

const git = (...a) => { try { return execFileSync('git', ['-C', repoRoot, ...a], {encoding: 'utf8'}).trim(); } catch { return null; } };
const head = {repo: repoRoot, head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')), old,
  aheadOfMain: Number(git('rev-list', '--count', 'origin/main..HEAD') ?? NaN), behindMain: Number(git('rev-list', '--count', 'HEAD..origin/main') ?? NaN)};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const engine = H.resolveRealEngine();
const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit' ? await playwright().webkit.launch({headless: true}) : await H.launchRealBrowser(engine);
const capture = async (page, opts) => {
  const buf = engine === 'webkit' ? await wkshotBuffer(page, opts) : await page.screenshot(opts);
  if (opts.path) fs.writeFileSync(opts.path, buf);
  return buf;
};
const lines = [];
const rec = (name, width, height, buf, extra) => lines.push({name, file: `${name}.png`, os: process.platform, browser: engine, width, height,
  bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...head, ...extra});

const boxes = () => {
  const box = (e) => { const r = e?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? {x: r.left, y: r.top, w: r.width, h: r.height} : null; };
  return {
    mode: document.documentElement.dataset.laolaoMode,
    night: document.documentElement.hasAttribute('data-pinkie-night'),
    temp: box(document.querySelector('aside.sidebar .pinkie-temp-entry')),
    chips: [box(document.querySelector('.agent-chat__input .pinkie-chip--mode:not(.pinkie-baton)')), box(document.querySelector('.agent-chat__input .pinkie-tray-btn'))].filter(Boolean),
  };
};

async function zoomShot(context, page, name, width, list, extra) {
  list = list.filter(Boolean);
  if (!list.length) return;
  const x0 = Math.max(0, Math.floor(Math.min(...list.map((b) => b.x)) - 16));
  const y0 = Math.max(0, Math.floor(Math.min(...list.map((b) => b.y)) - 16));
  const x1 = Math.min(width, Math.ceil(Math.max(...list.map((b) => b.x + b.w)) + 16));
  const y1 = Math.min(HEIGHT, Math.ceil(Math.max(...list.map((b) => b.y + b.h)) + 16));
  const clip = {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
  if (clip.width <= 0 || clip.height <= 0) return;
  const raw = await capture(page, {clip});
  const zoom = await context.newPage();
  try {
    await zoom.setViewportSize({width: clip.width * 3, height: clip.height * 3});
    await zoom.setContent(`<body style="margin:0"><img style="width:${clip.width * 3}px;height:${clip.height * 3}px;image-rendering:pixelated" src="data:image/png;base64,${raw.toString('base64')}"></body>`);
    await zoom.waitForTimeout(200);
    rec(`${name}-zoom`, clip.width * 3, clip.height * 3, await capture(zoom, {path: path.join(out, `${name}-zoom.png`)}), {...extra, clip});
  } finally { await zoom.close(); }
}

try {
  for (const theme of ['day', 'night']) {
    const {context, page} = await H.openRealScenePage(browser, server.origin, 'home-project', theme, {timezoneId: 'Asia/Shanghai'});
    try {
      if (old) await page.addStyleTag({content: OLD_RECIPE});
      for (const width of [1440, 820]) {
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForTimeout(900);
        const b = await page.evaluate(boxes);
        const name = `261-home-project-${width}-${theme}${old ? '-old' : ''}`;
        const extra = {scene: 'home-project', theme, mode: b.mode, night: b.night};
        rec(name, width, HEIGHT, await capture(page, {path: path.join(out, `${name}.png`)}), extra);
        await zoomShot(context, page, `${name}-composer`, width, b.chips, extra);
        if (b.temp) await zoomShot(context, page, `${name}-temp`, width, [b.temp], extra);
        console.log(`${name}: mode=${b.mode} night=${b.night} temp=${Boolean(b.temp)} chips=${b.chips.length}`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
