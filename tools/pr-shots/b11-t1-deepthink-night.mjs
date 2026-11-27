#!/usr/bin/env node
// B11·T1（夜间思考强度菜单内文看不清）给 uireview / 协调者看图和对比度数值用，走 .github/workflows/pr-shots.yml 在 CI 上拍。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/b11-t1-deepthink-night.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI，home-thinking × 1440 / 820 × 日 / 夜，点开思考强度菜单只截菜单：
//   after  = 本分支现状；
//   before = 同一页注回修复前写死的日间深紫（只拍夜间，日间本来就是这四个色），
// shots.jsonl 每行多一个 contrast 字段：head / summary / hint / footer 对底的最差对比度。不连真网关、不改基线。
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
const M = await import(pathToFileURL(path.join(root, 'tests/visual/lib/deep-think-menu-contrast.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const HEIGHT = 800;
const lines = [];

const shoot = async (page, name, contrast) => {
  const box = await page.locator('#laolao-deep-think-menu').boundingBox();
  const pad = 12;
  const clip = {x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2};
  const file = `${name}.png`;
  await page.screenshot({path: path.join(out, file), clip, scale: 'device'});
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), contrast});
  console.log(`pr-shots: ${name} ${Object.entries(contrast).map(([k, v]) => `${k}=${v?.ratio}`).join(' ')}`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const width of [1440, 820]) {
    for (const theme of ['day', 'night']) {
      const {context, page} = await H.openRealScenePage(browser, server.origin, 'home-thinking', theme, {timezoneId: 'Asia/Shanghai'});
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForSelector('.laolao-deep-think-btn', {timeout: 15_000});
        await M.openDeepThinkMenu(page);
        await shoot(page, `b11-t1-${width}-${theme}-after`, await page.evaluate(M.measureMenu, M.MENU_PARTS));
        if (theme === 'night') {
          await M.revertMenuColors(page);
          await shoot(page, `b11-t1-${width}-${theme}-before`, await page.evaluate(M.measureMenu, M.MENU_PARTS));
        }
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
