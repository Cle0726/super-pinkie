#!/usr/bin/env node
// 配色键「颜色模式：浅睡」改名的界面截图。约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），碧琪首页和 Metre 看板 × 日 / 夜 × 1440 / 820，每格两条路由：
//   board  首页：配色键收在「更多工具」里（按钮隐藏但仍挂着），打开菜单拍「外观 · …」那一行，并记下隐藏按钮的 aria-label
//   cron   重载原生 /cron：classic-shell 不收次要键，配色键摊在底栏，悬停让 tooltip 弹出来拍
// 每格拍整页 + 配色键 / 菜单附近放大 3 倍。PINKIE_VISUAL_ENGINE=webkit 走 WebKit（本机 page.screenshot 回 0 字节，改用 wkshotBuffer）。
// --repo <目录> 指定被测仓库（拍 main 对照时指向 main 的 worktree），默认本仓库；被测头写进输出和每一行 jsonl。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {wkshotBuffer, wrapWebKitPlaywright} from '../../tests/visual/lib/webkit-screenshot.mjs';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const out = path.resolve(opt('--out', process.env.PINKIE_SHOTS_OUT || 'shots'));
const repoRoot = path.resolve(opt('--repo', fileURLToPath(new URL('../../', import.meta.url))));
fs.mkdirSync(out, {recursive: true});

const git = (...a) => { try { return execFileSync('git', ['-C', repoRoot, ...a], {encoding: 'utf8'}).trim(); } catch { return null; } };
const head = {repo: repoRoot, head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')),
  aheadOfMain: Number(git('rev-list', '--count', 'origin/main..HEAD') ?? NaN), behindMain: Number(git('rev-list', '--count', 'HEAD..origin/main') ?? NaN)};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const engine = H.resolveRealEngine();
const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser(engine);
const capture = async (page, opts) => {
  const buf = engine === 'webkit' ? await wkshotBuffer(page, opts) : await page.screenshot(opts);
  if (opts.path) fs.writeFileSync(opts.path, buf);
  return buf;
};
const report = [];
const lines = [];
const rec = (name, width, height, buf, extra) => lines.push({name, file: `${name}.png`, os: process.platform, browser: engine, width, height,
  bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...head, ...extra});

// 配色键（可见与否都记）、tooltip .content、弹出层、「更多工具」菜单里外观那一行。
const readToggle = () => {
  const box = (e) => { const r = e?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? {x: r.left, y: r.top, w: r.width, h: r.height} : null; };
  const btn = document.querySelector('button.theme-mode-toggle');
  const portal = [...document.querySelectorAll('body > .openclaw-tooltip')].pop() || null;
  const menu = document.querySelector('.laolao-footer-overflow');
  const menuOpen = Boolean(menu && !menu.hidden && box(menu));
  const themeRow = menuOpen ? [...menu.querySelectorAll('.laolao-footer-overflow__item')].find((r) => /^外观/.test(r.textContent.trim())) : null;
  return {
    mode: document.documentElement.getAttribute('data-laolao-mode'), path: location.pathname, ua: navigator.userAgent,
    label: btn?.getAttribute('aria-label') ?? null, content: btn?.closest('openclaw-tooltip')?.content ?? null,
    box: box(btn), tip: portal?.textContent ?? null, tipBox: box(portal),
    menuOpen, menuRow: themeRow?.textContent.trim() ?? null, menuBox: menuOpen ? box(menu) : null,
    sleepy: [...document.querySelectorAll('[aria-label], [title]')].filter((e) => /颜色模式：浅睡/.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''}`)).length
      + (document.body.textContent.match(/颜色模式：浅睡/g) || []).length,
  };
};

async function zoomShot(context, page, name, width, boxes, extra) {
  boxes = boxes.filter(Boolean);
  if (!boxes.length) return;
  const x0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.x)) - 24));
  const y0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.y)) - 24));
  const x1 = Math.min(width, Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)) + 24));
  const y1 = Math.min(HEIGHT, Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)) + 24));
  const clip = {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
  const raw = await capture(page, {clip});
  const zoom = await context.newPage();
  try {
    await zoom.setViewportSize({width: clip.width * 3, height: clip.height * 3});
    await zoom.setContent(`<body style="margin:0"><img style="width:${clip.width * 3}px;height:${clip.height * 3}px;image-rendering:pixelated" src="data:image/png;base64,${raw.toString('base64')}"></body>`);
    await zoom.waitForTimeout(200);
    rec(`${name}-zoom`, clip.width * 3, clip.height * 3, await capture(zoom, {path: path.join(out, `${name}-zoom.png`)}), {...extra, clip});
  } finally { await zoom.close(); }
}

async function step(context, page, scene, theme, route, width) {
  await page.setViewportSize({width, height: HEIGHT});
  await page.waitForTimeout(900);
  let info = await page.evaluate(readToggle);
  if (info.box) {
    await page.mouse.move(info.box.x + info.box.w / 2, info.box.y + info.box.h / 2);
    await page.waitForFunction(() => document.querySelector('body > .openclaw-tooltip')?.textContent, null, {timeout: 3_000}).catch(() => {});
  } else {
    const more = page.locator('.sidebar-shell__footer .laolao-footer-more').first();
    if (await more.isVisible().catch(() => false)) {
      await more.click({timeout: 3_000}).catch(() => {});
      await page.waitForFunction(() => { const m = document.querySelector('.laolao-footer-overflow'); return m && !m.hidden; }, null, {timeout: 3_000}).catch(() => {});
    }
  }
  await page.waitForTimeout(300);
  info = await page.evaluate(readToggle);
  const name = `color-mode-${scene}-${route}-${width}-${theme}`;
  const extra = {scene, theme, route, ...info};
  rec(name, width, HEIGHT, await capture(page, {path: path.join(out, `${name}.png`)}), extra);
  await zoomShot(context, page, name, width, info.box ? [info.box, info.tipBox] : [info.menuBox], extra);
  if (info.menuOpen) { await page.keyboard.press('Escape'); await page.mouse.click(width - 10, 10).catch(() => {}); }
  await page.mouse.move(width - 10, HEIGHT - 10);
  report.push({...extra, width});
  console.log(`${name}: mode=${info.mode} label=${info.label} content=${info.content} shown=${Boolean(info.box)} tip=${info.tip} menu=${info.menuRow} 页面里「颜色模式：浅睡」${info.sleepy} 处`);
}

try {
  for (const scene of ['home-project', 'metre-board']) {
    for (const theme of ['day', 'night']) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme);
      try {
        for (const width of [1440, 820]) await step(context, page, scene, theme, 'board', width);
        const u = new URL(page.url()); u.pathname = '/cron';
        await page.goto(u.href);
        await page.waitForTimeout(1500);
        for (const width of [1440, 820]) await step(context, page, scene, theme, 'cron', width);
        if (pageErrors?.length) report.push({scene, theme, pageErrors});
      } finally {
        await context.close();
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({head, engine, report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
