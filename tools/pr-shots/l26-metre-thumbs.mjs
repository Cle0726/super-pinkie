#!/usr/bin/env node
// L26（T3 #12，Metre 输入框图片缩略条点开放大）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；往原生输入框塞两张图片附件 + 一个文件附件
// （pane.state.chatAttachments，和 laolao-startup-home.js 搬附件同一做法），不碰用户会话。每格（1440 / 820 × 日夜）拍：
//   thumbs-strip   输入框上方的缩略条（图片两张、文件一个）
//   thumbs-viewer  点第一张缩略图以后：看图器打开整张原图
//   thumbs-closed  Esc 以后：看图器关掉、附件还在（没被移除）
//   thumbs-focus   不碰鼠标，从输入框 Shift+Tab 回到附件条，焦点落在图片缩略图上（看焦点框）；report 记 Tab 顺序和 Enter 能否打开
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {decodePng} from '../../tests/visual/lib/png-diff.mjs';

// 焦点环看不看得见（uireview 13:16Z）：focus 和 strip 两张图在聚焦格子外扩 8px 那一块逐像素比，
// 变了的像素里出现最多的颜色当环色，和 strip 同位置的底色算 WCAG 对比度（要 ≥ 3）。
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
function ringDiff(stripBuf, focusBuf, rect, dpr) {
  if (!rect) return {error: 'no focused cell'};
  const a = decodePng(stripBuf), b = decodePng(focusBuf);
  if (a.width !== b.width || a.height !== b.height) return {error: 'size differs'};
  const pad = 8, s = dpr || 1;
  const x0 = Math.max(0, Math.floor((rect[0] - pad) * s)), y0 = Math.max(0, Math.floor((rect[1] - pad) * s));
  const x1 = Math.min(a.width, Math.ceil((rect[0] + rect[2] + pad) * s)), y1 = Math.min(a.height, Math.ceil((rect[1] + rect[3] + pad) * s));
  let changed = 0, total = 0;
  const colors = new Map();
  // 格子本身的框（不含外扩）：框外变了的像素按上 / 下 / 左 / 右四条边分开数，看环是不是整圈都画出来了（下边曾被输入框盖住）。
  const L = Math.round(rect[0] * s), T = Math.round(rect[1] * s), R = Math.round((rect[0] + rect[2]) * s), B = Math.round((rect[1] + rect[3]) * s);
  const edges = {top: 0, bottom: 0, left: 0, right: 0};
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4; total++;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d <= 10) continue;
      changed++;
      if (y < T) edges.top++; else if (y >= B) edges.bottom++; else if (x < L) edges.left++; else if (x >= R) edges.right++;
      const fg = [b.data[i], b.data[i + 1], b.data[i + 2]];
      const k = fg.join(',');
      const c = colors.get(k) || {fg, bg: [a.data[i], a.data[i + 1], a.data[i + 2]], n: 0};
      c.n++; colors.set(k, c);
    }
  }
  const top = [...colors.values()].sort((p, q) => q.n - p.n)[0];
  return {box: [x0, y0, x1 - x0, y1 - y0], changed, total, edges, ring: top ? {fg: top.fg, bg: top.bg, ratio: ratio(top.fg, top.bg)} : null};
}

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
  return buf;
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
    const stripBuf = await shot(page, 'thumbs-strip', theme, width, {mode, strip});
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
    report.push({theme, width, step: 'closed', closed, ...(await viewerState(page))});

    // 键盘（uireview 08:51Z）：不碰鼠标，从输入框 Shift+Tab 回到附件条，焦点落在图片缩略图上；拍焦点框，
    // 再记 Tab 顺序（图片 → 移除）和 Enter 能否打开看图器。
    const focusInfo = () => page.evaluate(() => {
      const a = document.activeElement;
      const cs = a ? getComputedStyle(a) : null;
      const cell = a?.closest?.('.chat-attachment-thumb');
      const ccs = cell ? getComputedStyle(cell) : null;
      const chain = [];
      for (let n = a; n && chain.length < 4; n = n.parentElement) {
        const s = getComputedStyle(n);
        chain.push({el: n.tagName.toLowerCase() + (n.classList[0] ? '.' + n.classList[0] : ''), overflow: s.overflowX + '/' + s.overflowY, radius: s.borderTopLeftRadius});
        if (n.classList.contains('chat-attachments-preview')) break;
      }
      const r = cell?.getBoundingClientRect();
      return {tag: a?.tagName || null, role: a?.getAttribute?.('role') ?? null, label: a?.getAttribute?.('aria-label') ?? null,
        img: a?.tagName === 'IMG' && Boolean(a.closest('.chat-attachments-preview .chat-attachment-thumb:not(.chat-attachment-thumb--file)')),
        remove: Boolean(a?.closest?.('.chat-attachment-remove')), focusVisible: Boolean(a?.matches?.(':focus-visible')),
        outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}` : null,
        cellOutline: ccs ? `${ccs.outlineStyle} ${ccs.outlineWidth} ${ccs.outlineColor} offset ${ccs.outlineOffset}` : null,
        cellRect: r ? [r.left, r.top, r.width, r.height].map((v) => Math.round(v)) : null, dpr: window.devicePixelRatio, chain};
    });
    await page.mouse.move(0, HEIGHT - 1);
    await page.locator('.agent-chat__composer-combobox textarea').first().focus({timeout: 5000}).catch((e) => console.log('[l26] 聚焦输入框失败：' + e.message.split('\n')[0]));
    let onImg = null, steps = 0;
    for (; steps < 12; steps++) {
      await page.keyboard.press('Shift+Tab');
      onImg = await focusInfo();
      if (onImg.img) break;
    }
    await page.waitForTimeout(200);
    const focusBuf = await shot(page, 'thumbs-focus', theme, width, {focused: Boolean(onImg?.img)});
    const ring = ringDiff(stripBuf, focusBuf, onImg?.cellRect, onImg?.dpr);
    await page.keyboard.press('Tab');
    const next = await focusInfo();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    const enterOpens = await page.waitForFunction(() => document.querySelector('#laolao-image-viewer.is-open img')?.complete, null, {timeout: 5000}).then(() => true, () => false);
    await page.keyboard.press('Escape');
    report.push({theme, width, step: 'focus', shiftTabs: steps + 1, onImg, ring, nextIsRemove: next.remove, enterOpens, ...(await viewerState(page)), pageErrors});
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
