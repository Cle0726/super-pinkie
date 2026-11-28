#!/usr/bin/env node
// B11·model-picker（思考强度入口「关闭」档位字与触发按钮边框对比度）给 uireview / 协调者看图和数值用，走 .github/workflows/pr-shots.yml 在 CI 上拍。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/b11-model-picker-contrast.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI，home-project × 1440 / 820 × 日 / 夜，入口切到「关闭」，只截输入框控件条：
//   after  = 本分支现状；
//   before = 同一页注回 origin/main@647fc80d 的透明边框与 #605a65。
// shots.jsonl 每行多一个 contrast 字段：border（对输入框底）与 offText（日间像素量，4px 分箱，与复发测试同口径）。不连真网关、不改基线。
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
const C = await import(pathToFileURL(path.join(root, 'tests/visual/lib/model-picker-contrast.mjs')).href);
const engine = String(H.resolveRealEngine() || 'chromium');
const lines = [];

const forceOff = (page) => page.evaluate(([sel, tier]) => {
  const e = document.querySelector(sel);
  e.dataset.pinkieMaterial = 'off';
  const t = e.querySelector(tier);
  if (t) t.textContent = '关闭';
}, [C.TRIGGER, C.TIER]);

const measure = async (page, theme) => {
  const border = await C.borderContrast(page);
  return {border: Number(border.ratio.toFixed(2)), offText: theme === 'day' ? Number((await C.tierPalest(page, {binPx: 4})).toFixed(2)) : null};
};

const shoot = async (page, name, contrast) => {
  const box = await page.locator(C.TRIGGER).boundingBox();
  const pad = 48;
  const clip = {x: Math.max(0, box.x - pad * 4), y: Math.max(0, box.y - pad / 2), width: box.width + pad * 5, height: box.height + pad};
  const file = `${name}.png`;
  await page.screenshot({path: path.join(out, file), clip, scale: 'device', animations: 'disabled'});
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), contrast});
  console.log(`pr-shots: ${name} border=${contrast.border}${contrast.offText == null ? '' : ` offText=${contrast.offText}`}`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
try {
  for (const width of [1440, 820]) {
    for (const theme of ['day', 'night']) {
      const {context, page} = await H.openRealScenePage(browser, server.origin, 'home-project', theme, {timezoneId: 'Asia/Shanghai'});
      try {
        await page.setViewportSize({width, height: 800});
        await page.waitForSelector(C.TRIGGER, {timeout: 15_000});
        await forceOff(page);
        await page.waitForTimeout(200);
        await shoot(page, `b11-model-picker-${width}-${theme}-after`, await measure(page, theme));
        await page.addStyleTag({content: C.REVERT_CSS});
        await page.waitForTimeout(200);
        await shoot(page, `b11-model-picker-${width}-${theme}-before`, await measure(page, theme));
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
