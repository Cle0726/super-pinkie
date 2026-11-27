#!/usr/bin/env node
// B11 非 Metre 归档撤销条「已归档 · 撤销」对比度与避让的界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），项目（sidebar-expanded）/ 无限（home-unrestricted）× 日夜 × 1440 / 820，
// 侧栏会话行按 Delete 触发撤销条，每格拍「改后」和「改前」（页面拿到的 laolao-sidebar.css / .js 换回旧写法，见 tests/visual/lib/archive-undo-probe.mjs），
// report.json 记撤销条 rect、和输入框外壳 / 控件的相交面积、「撤销」对比度、swapped、pageErrors。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {SCENES, archiveOneRow, measureUndo, openDrawer, routeOld} from '../../tests/visual/lib/archive-undo-probe.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

async function cell(mode, theme, width, before) {
  const tag = `b11-undo-${mode}-${width}-${theme}-${before ? 'before' : 'after'}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, SCENES[mode], theme, {timezoneId: 'Asia/Shanghai'});
  let swapped = null;
  let error = null;
  let m = null;
  try {
    if (before) { swapped = await routeOld(context); await page.reload(); }
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForTimeout(500);
    try {
      await openDrawer(page);
      await archiveOneRow(page);
      m = await measureUndo(page);
    } catch (err) { error = err.message.split('\n')[0]; }
    const file = `${tag}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name: tag, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ratio: m?.ratio ?? null, shellOverlap: m?.shellOverlap ?? null});
    report.push({tag, mode, theme, width, before, swapped, error, ...(m || {}), pageErrors: [...pageErrors]});
  } finally {
    await context.close();
  }
}

try {
  for (const mode of Object.keys(SCENES)) for (const theme of ['day', 'night']) for (const width of [1440, 820]) {
    await cell(mode, theme, width, false);
    await cell(mode, theme, width, true);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
