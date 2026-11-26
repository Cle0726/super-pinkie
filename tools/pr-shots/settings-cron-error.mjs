#!/usr/bin/env node
// 16（设置页出错的定时任务没红色）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），三条示例任务由 tests/fixtures/settings-cron-jobs.mjs 在页面里答，不碰用户会话。
// 每格（碧琪 / Metre × 1440 / 820 × 日夜）拍设置页「定时任务」卡（#pinkie-schedules）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {openSettingsSchedules, settingsCronInit} from '../../tests/fixtures/settings-cron-jobs.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const HEIGHT = 900;
const SKINS = [['pinkie', 'settings'], ['metre', 'metre-board']];
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

async function cell(skin, sceneId, theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, sceneId, theme, {initScript: settingsCronInit});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await openSettingsSchedules(page);
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => ({
      mode: document.documentElement.getAttribute('data-laolao-mode'),
      last: [...document.querySelectorAll('#pinkie-schedules .pk-job__last')].map((el) => ({state: el.dataset.state || null, text: el.textContent.trim(), color: getComputedStyle(el).color})),
    }));
    const name = `16-schedules-${skin}-${width}-${theme}`;
    const file = `${name}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
      bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), mode: info.mode});
    report.push({skin, theme, width, ...info, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const [skin, sceneId] of SKINS) {
    for (const theme of ['day', 'night']) {
      for (const width of [1440, 820]) await cell(skin, sceneId, theme, width);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
