#!/usr/bin/env node
// L38（T3 #26 快捷键表 ?）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），不碰用户会话。每格（1440 / 820 × 日夜）拍：
//   keymap-metre      Metre 对话页单按 ?（焦点不在输入框）打开的快捷键一览：会话组多 K3 两行、输入框组多 K2 两行、全局「⌘/ · ?」
//   keymap-sidebar    Metre 里 Windows / Linux 按 Ctrl+B 之后（侧栏收起；Mac 上原生 ⌘B 自己管，这里不按）
//   keymap-project    对照：项目模式按 ⌘/ · Ctrl+/ 打开的一览，和 main 上一样（没有补行）；先按 ? 不打开
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const isMac = process.platform === 'darwin';

const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const shot = async (page, name, theme, width, extra = {}) => {
  const file = `${name}-${width}-${theme}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name: `${name}-${width}-${theme}`, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};
const sheetRows = (page) => page.evaluate(() => [...document.querySelectorAll('.pinkie-shortcuts .pinkie-shortcuts__row')]
  .map((r) => [r.querySelector('dt')?.textContent || '', r.querySelector('dd')?.textContent || '']));
const sheetOpen = (page) => page.evaluate(() => Boolean(document.querySelector('.pinkie-shortcuts')));
const blur = (page) => page.evaluate(() => { document.activeElement?.blur?.(); });
const closeSheet = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.pinkie-shortcuts'), null, {timeout: 3000}).catch(() => {});
};

async function metreCell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    const loaded = await page.waitForFunction(() => typeof window.Pinkie?.metreKeymap?.groups === 'function'
      && typeof window.PinkieArtifacts?.openShortcuts === 'function', null, {timeout: 15_000}).then(() => true, () => false);

    await blur(page);
    await page.keyboard.press('?');
    const opened = await page.waitForFunction(() => Boolean(document.querySelector('.pinkie-shortcuts')), null, {timeout: 5000})
      .then(() => true, () => false);
    const draft = await page.evaluate(() => document.querySelector('.agent-chat__input textarea')?.value ?? null);
    await page.waitForTimeout(300);
    const rows = await sheetRows(page);
    await shot(page, 'keymap-metre', theme, width, {mode, loaded, opened});
    report.push({theme, width, step: 'metre-?', mode, loaded, opened, draftAfterQuestion: draft, rows});
    await closeSheet(page);

    if (!isMac) {
      const collapsed = () => page.evaluate(() => document.querySelector('aside.sidebar, .sidebar')?.classList.contains('sidebar--collapsed') ?? null);
      const before = await collapsed();
      await blur(page);
      await page.keyboard.press('Control+b');
      await page.waitForTimeout(600);
      const after = await collapsed();
      await shot(page, 'keymap-sidebar', theme, width, {before, after});
      report.push({theme, width, step: 'metre-ctrl-b', before, after});
    }
    report.push({theme, width, step: 'metre-errors', pageErrors});
  } finally {
    await context.close();
  }
}

async function projectCell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'sidebar-expanded', theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.waitForFunction(() => typeof window.PinkieArtifacts?.openShortcuts === 'function', null, {timeout: 15_000}).catch(() => {});
    await blur(page);
    await page.keyboard.press('?');
    await page.waitForTimeout(400);
    const questionOpened = await sheetOpen(page);
    if (questionOpened) await closeSheet(page);
    await blur(page);
    await page.keyboard.press(isMac ? 'Meta+Slash' : 'Control+Slash');
    const opened = await page.waitForFunction(() => Boolean(document.querySelector('.pinkie-shortcuts')), null, {timeout: 5000})
      .then(() => true, () => false);
    await page.waitForTimeout(300);
    const rows = await sheetRows(page);
    // 这一格的行要和 shortcutGroups() 原样逐字一致（Metre 补行不进来）
    const native = await page.evaluate(() => JSON.stringify(window.PinkieArtifacts.shortcutGroups().flatMap(([, r]) => r.map(([l, k]) => [l, k]))));
    await shot(page, 'keymap-project', theme, width, {mode, opened, questionOpened});
    report.push({theme, width, step: 'project', mode, opened, questionOpened, rowsMatchNative: JSON.stringify(rows) === native, rows, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await metreCell(theme, width);
      await projectCell(theme, width);
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
