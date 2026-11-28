#!/usr/bin/env node
// B11 项目模式「工作程度」`.pinkie-chip--mode` 字与下拉小箭头 `.pinkie-chip__caret` 日间真对比度，约定照 tools/pr-shots/minimal.mjs：
// node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report-<engine>.json。真页面，不改基线。
// 改前 = 本页临时注入 main 的旧色（OLD_CHIP_CSS）；改后 = 当前分支。量法见 tests/visual/lib/work-level-chip-contrast.mjs。
// PINKIE_VISUAL_ENGINE=webkit 走 WebKit。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {OLD_CHIP_CSS, measureChip, shot} from '../../tests/visual/lib/work-level-chip-contrast.mjs';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const git = (...a) => { try { return execFileSync('git', ['-C', repoRoot, ...a], {encoding: 'utf8'}).trim(); } catch { return null; } };
const head = {head: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain'))};
console.log(`pr-shots: 被测头 ${JSON.stringify(head)}`);

const SCENES = (process.env.PINKIE_SCENES || 'home-project,sidebar-collapsed,model-picker,long-conversation').split(',');
const THEMES = (process.env.PINKIE_THEMES || 'day,night').split(',');
const HEIGHT = 900;

const engine = H.resolveRealEngine();
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit' ? await playwright().webkit.launch({headless: true}) : await H.launchRealBrowser(engine);
const report = [];
const lines = [];

async function one(scene, theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    for (const phase of ['after', 'before']) {
      const tag = phase === 'before' ? await page.addStyleTag({content: OLD_CHIP_CSS}) : null;
      await page.waitForTimeout(120);
      const buf = await shot(page);
      const name = `b11-work-level-${scene}-${theme}-${width}-${phase}`, file = `${name}.png`;
      fs.writeFileSync(path.join(out, file), buf);
      lines.push({name, file, os: process.platform, browser: engine, width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...head});
      report.push({scene, theme, width, phase, engine, ...(await measureChip(page, buf)), pageErrors: pageErrors.length});
      if (tag) await tag.evaluate((n) => n.remove());
    }
  } finally {
    await context.close();
  }
}

try {
  for (const theme of THEMES) for (const width of [1440, 820]) for (const scene of SCENES) {
    try { await one(scene, theme, width); }
    catch (error) { report.push({scene, theme, width, engine, error: error.message.split('\n')[0]}); }
  }
} finally {
  fs.writeFileSync(path.join(out, `report-${engine}.json`), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
for (const r of report) {
  if (r.error || r.missing) { console.log(`${r.scene} ${r.theme} ${r.width} ${r.phase || ''} ${r.mode || ''} ${r.error || 'missing'}`); continue; }
  console.log(`${r.scene.padEnd(18)} ${String(r.mode).padEnd(8)} ${r.theme.padEnd(5)} ${String(r.width).padEnd(4)} ${r.phase.padEnd(6)} 「${r.text}」 ${r.color} hover=${r.hover} 字 ${r.textPx?.ratio} (${r.textPx?.fg} on ${r.textPx?.bg})  箭头 ${r.caretPx?.ratio} op=${r.caretOpacity}`);
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
