#!/usr/bin/env node
// L26（T3 #12，Metre 输入框图片缩略条点开放大）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；往原生输入框塞两张图片附件 + 一个文件附件
// （pane.state.chatAttachments，和 laolao-startup-home.js 搬附件同一做法），不碰用户会话。每格（1440 / 820 × 日夜）拍：
//   thumbs-strip   输入框上方的缩略条（图片两张、文件一个）
//   thumbs-viewer  点第一张缩略图以后：看图器打开整张原图
//   thumbs-closed  Esc 以后：看图器关掉、附件还在（没被移除）
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

const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const shot = async (page, name, theme, width, extra = {}) => {
  const file = `${name}-${width}-${theme}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name: `${name}-${width}-${theme}`, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};

// 页面里画两张 PNG（一张横、一张竖长），交给原生输入框当附件；再加一个文本文件附件当对照。
const seedAttachments = () => {
  const png = (w, h, a, b, label) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, a); grad.addColorStop(1, b);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = `${Math.round(Math.min(w, h) / 8)}px sans-serif`; g.fillText(label, w * 0.08, h * 0.2);
    return c.toDataURL('image/png');
  };
  const pane = document.querySelector('openclaw-chat-pane');
  if (!pane?.state) return {ok: false, why: 'no pane'};
  const wide = png(1280, 720, '#2F4BD8', '#8496E6', '截图 1280×720');
  const tall = png(600, 1800, '#1F1E1D', '#6B6860', '长图');
  pane.state.chatAttachments = [
    {id: 'att-l26-1', mimeType: 'image/png', fileName: '截图.png', sizeBytes: wide.length, previewUrl: wide, dataUrl: wide},
    {id: 'att-l26-2', mimeType: 'image/png', fileName: '长图.png', sizeBytes: tall.length, previewUrl: tall, dataUrl: tall},
    {id: 'att-l26-3', mimeType: 'text/plain', fileName: 'notes.txt', sizeBytes: 12},
  ];
  pane.state.requestUpdate?.(); pane.requestUpdate?.();
  return {ok: true};
};
const viewerState = (page) => page.evaluate(() => {
  const v = document.getElementById('laolao-image-viewer');
  const img = v?.querySelector('img');
  return {open: Boolean(v), src: img ? img.src.slice(0, 22) : null, alt: img?.alt ?? null,
    natural: img ? [img.naturalWidth, img.naturalHeight] : null,
    thumbs: document.querySelectorAll('.chat-attachments-preview .chat-attachment-thumb').length};
});

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    const seeded = await page.evaluate(seedAttachments);
    const strip = await page.waitForFunction(() => document.querySelectorAll('.chat-attachments-preview .chat-attachment-thumb img').length >= 2, null, {timeout: 15_000})
      .then(() => true, () => false);
    await page.waitForTimeout(300);
    await shot(page, 'thumbs-strip', theme, width, {mode, strip});
    report.push({theme, width, step: 'strip', mode, seeded, strip, ...(await viewerState(page))});

    await page.locator('.chat-attachments-preview .chat-attachment-thumb:not(.chat-attachment-thumb--file) img').first().click({timeout: 5000}).catch((e) => console.log('[l26] 点缩略图失败：' + e.message.split('\n')[0]));
    const opened = await page.waitForFunction(() => document.querySelector('#laolao-image-viewer.is-open img')?.complete, null, {timeout: 5000})
      .then(() => true, () => false);
    await page.waitForTimeout(300);
    await shot(page, 'thumbs-viewer', theme, width, {opened});
    report.push({theme, width, step: 'viewer', opened, ...(await viewerState(page))});

    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction(() => !document.getElementById('laolao-image-viewer'), null, {timeout: 5000}).then(() => true, () => false);
    await page.waitForTimeout(200);
    await shot(page, 'thumbs-closed', theme, width, {closed});
    report.push({theme, width, step: 'closed', closed, ...(await viewerState(page)), pageErrors});
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
