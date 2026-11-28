#!/usr/bin/env node
// B11（无限模式输入区「脱敏」钮日间静息态偏淡）给 uireview / 协调者看图和对比度数值用，走 .github/workflows/pr-shots.yml 在 CI 上拍。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/b11-desensitize-btn-day.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI，home-unrestricted 进空会话 × 1440 / 820 × 日间，只截输入区操作栏：
//   after  = 本分支现状；
//   before = 同一页把修复前的 color-mix(#9c6177 88%, transparent) 直接注回钮上。
// shots.jsonl 每行多一个 contrast 字段：字 / 图标按像素量的对比度。不连真网关、不改基线。
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
const B = await import(pathToFileURL(path.join(root, 'tests/visual/lib/desensitize-btn-contrast.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const lines = [];

const shoot = async (page, name) => {
  const m = await B.measureBtn(page);
  const contrast = {text: m.textPx, icon: m.iconPx, color: m.color};
  const box = await page.locator('.agent-chat__input .laolao-desensitize-btn').first().boundingBox();
  const pad = 40;
  const clip = {x: Math.max(0, box.x - pad * 3), y: Math.max(0, box.y - pad), width: box.width + pad * 6, height: box.height + pad * 2};
  const file = `${name}.png`;
  await page.screenshot({path: path.join(out, file), clip, scale: 'device'});
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), contrast});
  console.log(`pr-shots: ${name} text=${m.textPx?.ratio} icon=${m.iconPx?.ratio}`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const width of [1440, 820]) {
    const {context, page} = await H.openRealScenePage(browser, server.origin, 'home-unrestricted', 'day', {timezoneId: 'Asia/Shanghai'});
    try {
      await page.setViewportSize({width, height: 900});
      await B.openDesensitizeBtn(page);
      await shoot(page, `b11-desensitize-btn-${width}-day-after`);
      await B.revertBtnColor(page);
      await shoot(page, `b11-desensitize-btn-${width}-day-before`);
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
