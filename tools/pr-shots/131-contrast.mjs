#!/usr/bin/env node
// #131（X4）给协调者看图用的截图脚本，走 .github/workflows/pr-shots.yml 在 CI 上拍，本机不开浏览器。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/131-contrast.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI + Metre（tests/visual/lib/real-harness.mjs，和 metre-contrast-real.test.mjs 同一套），
// 1440×800，日 / 夜 × 平时 / prefers-contrast: more，各拍整页 + 侧栏 + 状态带。不改基线、不连真网关。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = await import(pathToFileURL(path.join(root, 'tests/visual/lib/real-harness.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const WIDTH = 1440, HEIGHT = 800;
const lines = [];

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  // PNG IHDR：宽在 16–19 字节，高在 20–23 字节
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
// 等 CSS 过渡停下再拍：切高对比后 Metre 字色有 160ms 过渡；只看过渡，不看猫、加载圈这类无限动画。
const settle = (page) => page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running'), null, {timeout: 5000}).then(() => page.waitForTimeout(300));
const zoom = async (page, sel, name, pad) => {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (!box) { console.log(`pr-shots: ${name} 没找到 ${sel}，跳过`); return; }
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const clip = {x, y, width: Math.min(WIDTH - x, box.width + pad * 2), height: Math.min(HEIGHT - y, box.height + pad * 2)};
  await page.screenshot({path: path.join(out, `${name}.png`), clip});
  record(name, `${name}.png`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of ['day', 'night']) {
    const {context, page} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
    try {
      await page.setViewportSize({width: WIDTH, height: HEIGHT});
      await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
      await page.waitForSelector('.agent-chat__composer-combobox textarea', {timeout: 10_000});
      for (const contrast of ['no-preference', 'more']) {
        await page.emulateMedia({contrast});
        await settle(page);
        const base = `131-${theme}-${contrast === 'more' ? 'contrast-more' : 'normal'}`;
        await page.screenshot({path: path.join(out, `${base}.png`)});
        record(base, `${base}.png`);
        await zoom(page, 'aside.sidebar, .shell-nav, nav', `${base}-sidebar`, 0);
        await zoom(page, '.pk-metre-backstage, .pk-bs', `${base}-band`, 8);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
