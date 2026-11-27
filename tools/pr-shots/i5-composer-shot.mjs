#!/usr/bin/env node
// I5（#128，feat/metre-ui2-i5）工具箱「添加」组的「截图」PR 截图脚本，约定同 tools/pr-shots/minimal.mjs：
// node tools/pr-shots/i5-composer-shot.mjs --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真装的 Control UI（tests/visual/lib/real-harness.mjs 的 long-conversation 场景）；只把 navigator.mediaDevices.getDisplayMedia
// 换成假的：ok 给一条 320×200 钴蓝画布流（浏览器没有 canvas.captureStream 时记 noCapture，不拍那张），denied 抛 NotAllowedError。
// 每格（1440 / 820 × 日 / 夜）拍：工具箱菜单（四项「拍照 / 照片 / 文件 / 截图」）、截图后输入框（照片框里有一张 PNG）、
// 没给屏幕录制权限时的提示。
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
const HEIGHT = 800;
const widths = (process.env.PINKIE_I5_WIDTHS || '1440,820').split(',').map(Number);
const themes = (process.env.PINKIE_I5_THEMES || 'day,night').split(',');
const lines = [], report = [];

const initScript = () => {
  window.__i5Mode = 'ok';
  window.__i5Toasts = [];
  window.addEventListener('laolao:toast', (e) => window.__i5Toasts.push(String(e.detail?.message || '')));
  const fake = async () => {
    if (window.__i5Mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const g = canvas.getContext('2d'); g.fillStyle = '#2f4bb0'; g.fillRect(0, 0, 320, 200);
    const stream = canvas.captureStream(5);
    const tick = () => { g.fillRect(0, 0, 1, 1); if (stream.active) requestAnimationFrame(tick); }; tick();
    return stream;
  };
  const install = () => {
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', {value: {}, configurable: true});
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {value: fake, configurable: true});
  };
  try { install(); } catch {}
};

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
const shoot = async (page, name, sel) => {
  const file = `${name}.png`;
  const target = sel ? page.locator(sel).first() : null;
  if (target && await target.count()) await target.screenshot({path: path.join(out, file)});
  else await page.screenshot({path: path.join(out, file)});
  record(name, file);
};
const COMPOSER = '.agent-chat__input';
const TRAY_BTN = '.agent-chat__input .pinkie-tray-btn';
const SHOT = '.pinkie-tray__row[data-key="attach-shot"] .pinkie-tray__item';
const openTray = async (page) => {
  await page.click(TRAY_BTN);
  await page.waitForSelector(SHOT, {timeout: 5_000});
  await page.waitForTimeout(250);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const theme of themes) {
    for (const width of widths) {
      const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'long-conversation', theme, {initScript});
      const cell = {theme, width, pageErrors};
      const base = `i5-${theme}-${width}`;
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForSelector(TRAY_BTN, {timeout: 10_000});
        await page.waitForTimeout(300);

        await openTray(page);
        cell.names = await page.$$eval('.pinkie-tray__tiles .pinkie-tray__name', (list) => list.map((n) => n.textContent));
        await shoot(page, `${base}-tray`);

        cell.imgsBefore = await page.$$eval(`${COMPOSER} img`, (l) => l.map((n) => (n.className || n.parentElement?.className || 'img') + ':' + String(n.getAttribute('src') || '').slice(0, 24)));
        cell.capture = await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === 'function');
        if (cell.capture) {
          await page.click(SHOT);
          await page.waitForTimeout(1500);
          cell.menuClosed = !(await page.locator('.pinkie-tray').count());
          cell.previews = await page.locator(`${COMPOSER} .chat-attachment-thumb`).count();
          cell.imgsAfter = await page.$$eval(`${COMPOSER} img`, (l) => l.map((n) => (n.className || n.parentElement?.className || 'img') + ':' + String(n.getAttribute('src') || '').slice(0, 24)));
          await shoot(page, `${base}-attached`, COMPOSER);
        } else cell.noCapture = true;

        await page.evaluate(() => { window.__i5Mode = 'denied'; });
        await openTray(page);
        await page.click(SHOT);
        await page.waitForTimeout(600);
        cell.toasts = await page.evaluate(() => window.__i5Toasts.slice());
        await shoot(page, `${base}-denied`);
      } catch (error) {
        cell.error = error.message;
        try { await shoot(page, `${base}-error`); } catch {}
      } finally {
        report.push(cell);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) console.log(`pr-shots: ${r.theme} ${r.width} names=${(r.names || []).join('/')} previews=${r.previews ?? '-'} toasts=${(r.toasts || []).length}${r.error ? ' 出错：' + r.error : ''}`);
