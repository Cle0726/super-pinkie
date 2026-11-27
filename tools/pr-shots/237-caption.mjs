#!/usr/bin/env node
// #237 B23 截图：Windows 右上窗口键胶囊（app/windows_bridge_scripts.py 注入的 #pinkie-native-window-controls）在 Metre 里换成 Metre 色板。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真实安装的 Control UI + 碧琪注入 + bridge（real-harness 把 bridge 当页面脚本发）。不连网关。
// 拍：
//   caption-metre-<宽>-<日夜>        ：Metre 看板整页
//   caption-metre-<宽>-<日夜>-zoom   ：右上胶囊放大（clip 右上 320x60）
//   caption-metre-1440-day-hover-close-zoom ：关闭键悬停
//   caption-plain-1440-day(-zoom)    ：普通会话对照，胶囊应仍是原来的粉色
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

function readCaption() {
  const el = document.getElementById('pinkie-native-window-controls');
  if (!el) return {missing: true};
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const star = el.querySelector('.pinkie-update-control .pk-star');
  return {mode: document.documentElement.getAttribute('data-laolao-mode'), bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 60),
    edge: cs.borderTopColor, star: star ? getComputedStyle(star).fill : null,
    rect: {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)}};
}

const installed = installRealControlUi({repoRoot: REPO_ROOT});
const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
const browser = await launchRealBrowser();
const engine = browser.__pinkieEngine || 'chromium';
const lines = [];
const notes = [];

async function shoot(page, name, width, height, info, clip) {
  const file = name + '.png';
  const buf = await page.screenshot(clip ? {path: path.join(out, file), clip, scale: 'device'} : {path: path.join(out, file)});
  lines.push({name, file, os: process.platform, browser: engine, width: clip ? clip.width : width, height: clip ? clip.height : height,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...info});
}

async function capsule(page, base, width, height) {
  const info = await page.evaluate(readCaption);
  notes.push(`${base}: mode=${info.mode} bg=${info.bg} img=${info.bgImage} edge=${info.edge} star=${info.star} rect=${JSON.stringify(info.rect)}`);
  await shoot(page, base, width, height, info);
  if (info.rect) {
    const clip = {x: Math.max(0, width - 320), y: 0, width: 320, height: 60};
    await shoot(page, base + '-zoom', width, height, info, clip);
  }
  return info;
}

try {
  for (const theme of ['day', 'night']) {
    const {context, page} = await openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      for (const [width, height] of [[1440, 900], [820, 900]]) {
        await page.setViewportSize({width, height});
        await page.waitForTimeout(500);
        await capsule(page, `caption-metre-${width}-${theme}`, width, height);
        if (theme === 'day' && width === 1440) {
          const close = page.locator('#pinkie-native-window-controls button[data-act="close"]');
          if (await close.count()) {
            await close.hover();
            await page.waitForTimeout(300);
            const info = await page.evaluate(readCaption);
            await shoot(page, 'caption-metre-1440-day-hover-close-zoom', width, height, info, {x: width - 320, y: 0, width: 320, height: 60});
            await page.mouse.move(700, 500);
          }
        }
      }
    } finally {
      await context.close();
    }
  }
  const {context, page} = await openRealScenePage(browser, server.origin, 'sidebar-expanded', 'day');
  try {
    await page.setViewportSize({width: 1440, height: 900});
    await page.waitForTimeout(500);
    await capsule(page, 'caption-plain-1440-day', 1440, 900);
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(notes.join('\n'));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
