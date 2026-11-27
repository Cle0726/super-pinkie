#!/usr/bin/env node
// B82 截图：保存的配色是「跟随系统」，页面开着时用 emulateMedia 切系统外观，拍切换后的 metre-board。约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>。
// 1440 / 820 × 日（系统浅色）/ 夜（开页后再切到系统深色，不重开页面），每张记 data-pinkie-night 与是否收到 pinkie:night。
// PINKIE_VISUAL_ENGINE=webkit 走 WebKit（本机 page.screenshot 回 0 字节，改用 wkshotBuffer）。
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
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
fs.mkdirSync(out, {recursive: true});

const git = (...a) => { try { return execFileSync('git', ['-C', repoRoot, ...a], {encoding: 'utf8'}).trim(); } catch { return null; } };
const head = {head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain'))};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const SCENE = 'metre-board';
const HEIGHT = 900;
const systemThemeMode = `
  const prefix = 'openclaw.control.settings.v1';
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== prefix && !key.startsWith(prefix + ':')) continue;
    try { localStorage.setItem(key, JSON.stringify({...JSON.parse(localStorage.getItem(key) || '{}'), themeMode: 'system'})); } catch {}
  }`;

const engine = H.resolveRealEngine();
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit' ? await playwright().webkit.launch({headless: true}) : await H.launchRealBrowser(engine);
const lines = [];

async function one(width, theme) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, SCENE, 'day', {initScript: new Function(systemThemeMode)});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForTimeout(400);
    let event = null;
    if (theme === 'night') {
      const armed = await page.evaluateHandle(() => ({done: new Promise((r) => window.addEventListener('pinkie:night', (e) => r(e.detail), {once: true}))}));
      await page.emulateMedia({colorScheme: 'dark'});
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-pinkie-night'), null, {timeout: 5000});
      event = await armed.evaluate((box) => Promise.race([box.done, new Promise((r) => setTimeout(() => r('none'), 2000))]));
      await page.waitForTimeout(300);
    }
    const night = await page.evaluate(() => document.documentElement.hasAttribute('data-pinkie-night'));
    const buf = engine === 'webkit' ? await wkshotBuffer(page, {}) : await page.screenshot({animations: 'disabled'});
    const name = `b82-${SCENE}-${theme}-${width}`;
    fs.writeFileSync(path.join(out, `${name}.png`), buf);
    lines.push({name, file: `${name}.png`, os: process.platform, browser: engine, width, height: HEIGHT, bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'), night, pinkieNightEvent: event, pageErrors: pageErrors.length, ...head});
  } finally {
    await context.close();
  }
}

try {
  for (const width of [1440, 820]) for (const theme of ['day', 'night']) await one(width, theme);
} finally {
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
for (const l of lines) console.log(`${l.name.padEnd(32)} night=${l.night} event=${l.pinkieNightEvent} errors=${l.pageErrors} ${l.bytes}B`);
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
