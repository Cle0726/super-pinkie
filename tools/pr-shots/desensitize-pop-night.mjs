#!/usr/bin/env node
// B11 脱敏浮窗日夜对比度：给 uireview / 协调者看图和对比度数值用，走 .github/workflows/pr-shots.yml 在 CI 上拍。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/desensitize-pop-night.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI，home-unrestricted × 1440 / 820 × 日 / 夜，点开脱敏浮窗只截浮窗：
//   after  = 本分支现状；
//   before = 同一页注回修复前的颜色（夜间连浮窗亮底一起注回，即只打 data-pinkie-night 时的旧样子）。
// shots.jsonl 每行多一个 contrast 字段：字对底、边框对底的最差对比度。不连真网关、不改基线。
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
const M = await import(pathToFileURL(path.join(root, 'tests/visual/lib/desensitize-pop-contrast.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const ARGS = {pop: M.POP, text: M.TEXT_PARTS, border: M.BORDER_PARTS, outsideOnly: M.OUTSIDE_ONLY};
const HEIGHT = 800;
const lines = [];

const shoot = async (page, name, contrast) => {
  const box = await page.locator(M.POP).boundingBox();
  const pad = 12;
  const clip = {x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2};
  const file = `${name}.png`;
  await page.screenshot({path: path.join(out, file), clip, scale: 'device'});
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), contrast});
  console.log(`pr-shots: ${name} ${Object.entries(contrast).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => `${k}=${v.ratio}`).join(' ')}`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const width of [1440, 820]) {
    for (const theme of ['day', 'night']) {
      const {context, page} = await H.openRealScenePage(browser, server.origin, 'home-unrestricted', theme, {timezoneId: 'Asia/Shanghai'});
      try {
        await page.setViewportSize({width, height: HEIGHT});
        await M.openDesensitizePop(page);
        await shoot(page, `b11-desens-${width}-${theme}-after`, await page.evaluate(M.measurePop, ARGS));
        await M.revertPopColors(page, theme);
        await shoot(page, `b11-desens-${width}-${theme}-before`, await page.evaluate(M.measurePop, ARGS));
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
