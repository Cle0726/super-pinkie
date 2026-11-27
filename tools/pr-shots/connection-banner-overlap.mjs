#!/usr/bin/env node
// B9 断线横幅截图。约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面 long-conversation 聊天页 × 日 / 夜 × 1440 / 820：聊天区顶部放一条长错误 callout，让 openclaw-app-shell 自己渲染断线横幅，
// 每格拍整页 + 横幅与 callout 附近放大 2 倍，并记下胶囊 / callout 的位置、重叠面积和胶囊底色。
// PINKIE_VISUAL_ENGINE=webkit 走 WebKit（本机 page.screenshot 回 0 字节，改用 wkshotBuffer）。
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
const head = {repo: repoRoot, head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain'))};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const LONG_ERR = "Error: ENOENT: no such file or directory, open '/Users/me/Library/Application Support/SuperPinkie/workspaces/project-2026-11/attachments/very-long-attachment-name-quarterly-report-final-v3.xlsx' (errno -2)";
const LONG_STATE = 'WebSocket closed with code 1006 (abnormal closure) while reconnecting to ws://127.0.0.1:19999/ws, retrying in 8s';
const HEIGHT = 900;
const engine = H.resolveRealEngine();
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

async function showBanner(page) {
  return page.evaluate(async ({LONG_ERR, LONG_STATE}) => {
    const pane = document.querySelector('openclaw-chat-pane');
    if (!pane) return 'openclaw-chat-pane';
    const box = document.createElement('div');
    box.className = 'callout danger';
    box.id = 'b9-callout';
    box.textContent = LONG_ERR;
    pane.prepend(box);
    const host = document.querySelector('openclaw-app-shell');
    if (!host || !('gatewayConnected' in host)) return 'openclaw-app-shell.gatewayConnected';
    host.gatewayLastError = LONG_STATE;
    host.gatewayConnected = false;
    await host.updateComplete;
    return document.querySelector('main.content--chat > openclaw-connection-banner .connection-banner__pill') ? null : '原生横幅';
  }, {LONG_ERR, LONG_STATE});
}

function measure() {
  const box = (e) => { const r = e.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; };
  const pill = document.querySelector('openclaw-connection-banner .connection-banner__pill');
  const callout = document.querySelector('#b9-callout');
  const a = pill.getBoundingClientRect();
  const b = callout.getBoundingClientRect();
  const overlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) * Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  return {ua: navigator.userAgent, pillBox: box(pill), calloutBox: box(callout), overlap: Math.round(overlap), bg: getComputedStyle(pill).backgroundColor};
}

async function zoomShot(context, page, name, width, boxes, extra) {
  const x0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.x)) - 16));
  const y0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.y)) - 16));
  const x1 = Math.min(width, Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)) + 16));
  const y1 = Math.min(HEIGHT, Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)) + 16));
  const clip = {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
  const raw = await capture(page, {clip});
  const zoom = await context.newPage();
  try {
    await zoom.setViewportSize({width: clip.width * 2, height: clip.height * 2});
    await zoom.setContent(`<body style="margin:0"><img style="width:${clip.width * 2}px;height:${clip.height * 2}px;image-rendering:pixelated" src="data:image/png;base64,${raw.toString('base64')}"></body>`);
    await zoom.waitForTimeout(200);
    rec(`${name}-zoom`, clip.width * 2, clip.height * 2, await capture(zoom, {path: path.join(out, `${name}-zoom.png`)}), {...extra, clip});
  } finally { await zoom.close(); }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      const {context, page} = await H.openRealScenePage(browser, server.origin, 'long-conversation', theme);
      try {
        await page.setViewportSize({width, height: HEIGHT});
        const missing = await showBanner(page);
        if (missing) throw new Error(`${width}-${theme}: 页面上没有 ${missing}`);
        await page.waitForTimeout(600);
        const info = await page.evaluate(measure);
        const name = `b9-banner-${width}-${theme}`;
        const extra = {theme, ...info};
        rec(name, width, HEIGHT, await capture(page, {path: path.join(out, `${name}.png`)}), extra);
        await zoomShot(context, page, name, width, [info.pillBox, info.calloutBox], extra);
        report.push({width, ...extra});
        console.log(`${name}: overlap=${info.overlap} bg=${info.bg} pill=${JSON.stringify(info.pillBox)} callout=${JSON.stringify(info.calloutBox)}`);
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
