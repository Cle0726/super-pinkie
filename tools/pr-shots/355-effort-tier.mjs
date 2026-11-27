#!/usr/bin/env node
// #355（B11 思考强度渐变档日间对比度）给 uireview / 协调者看图用，走 .github/workflows/pr-shots.yml 在 CI 上拍。
// 约定同 tools/pr-shots/minimal.mjs：node tools/pr-shots/355-effort-tier.mjs --out <目录>，写 PNG + <目录>/shots.jsonl。
// 真装的 Control UI（tests/visual/lib/real-harness.mjs），1440×800：
//   home-chat / home-learning × 日 / 夜 × 9 档（关闭…Ultra）——输入框下面那一行（模型名 + 思考强度牌）放大；
//   metre-board × 日 / 夜 × 关闭 / High / Ultra——确认 Metre 实色不变。
// 档位直接改页面上强度牌的 data-pinkie-material 和文字（和 laolao-model-picker.js syncEffortTrigger 写的一样），
// 流光停在 50%（大多数档高光在这附近，最难读的位置），不连真网关、不改基线。
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
const LABELS = {off: '关闭', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', adaptive: 'Adaptive', max: 'Max', ultra: 'Ultra'};
const lines = [];

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

// 把页面上所有强度牌切到某一档；返回改到的个数（0 = 这页没有强度牌）。
const setTier = (page, tier) => page.evaluate(([t, label]) => {
  let n = 0;
  for (const b of document.querySelectorAll('.pinkie-effort-trigger')) {
    b.dataset.pinkieMaterial = t;
    const s = b.querySelector(':scope > .pinkie-external-tier');
    if (s) { s.textContent = label; n++; }
  }
  for (const d of document.querySelectorAll('details.chat-controls__model[data-pinkie-outside-material]')) d.dataset.pinkieOutsideMaterial = t;
  for (const s of document.querySelectorAll('.chat-controls__model .pinkie-external-tier')) { s.textContent = label; n++; }
  return n;
}, [tier, LABELS[tier]]);

const shotRow = async (page, name) => {
  const box = await page.locator('.pinkie-effort-trigger').first().boundingBox().catch(() => null);
  if (!box) { console.log(`pr-shots: ${name} 没找到 .pinkie-effort-trigger，跳过`); return; }
  const x = Math.max(0, box.x - 360), y = Math.max(0, box.y - 14);
  const clip = {x, y, width: Math.min(WIDTH - x, box.width + 360 + 120), height: Math.min(HEIGHT - y, box.height + 28)};
  await page.screenshot({path: path.join(out, `${name}.png`), clip, scale: 'device'});
  record(name, `${name}.png`);
};

const installed = H.installRealControlUi({repoRoot: root});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: root, runDir: installed.runDir});
const browser = await H.launchRealBrowser(engine);
const plan = [
  ['home-chat', Object.keys(LABELS)],
  ['home-learning', Object.keys(LABELS)],
  ['metre-board', ['off', 'high', 'ultra']],
];
try {
  for (const [scene, tiers] of plan) {
    for (const theme of ['day', 'night']) {
      const {context, page} = await H.openRealScenePage(browser, server.origin, scene, theme, {timezoneId: 'Asia/Shanghai'});
      try {
        await page.setViewportSize({width: WIDTH, height: HEIGHT});
        if (scene === 'metre-board') await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
        await page.addStyleTag({content: '.pinkie-external-tier,.pinkie-external-tier::after{animation:none!important;background-position:50% 50%!important}'});
        await page.waitForSelector('.pinkie-effort-trigger', {timeout: 15_000}).catch(() => {});
        for (const tier of tiers) {
          const n = await setTier(page, tier);
          await page.waitForTimeout(150);
          const name = `355-${scene}-${theme}-${tier}`;
          if (!n) console.log(`pr-shots: ${name} 页面上没有强度牌文字`);
          await shotRow(page, name);
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
