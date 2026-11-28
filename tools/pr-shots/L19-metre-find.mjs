#!/usr/bin/env node
// L19（界面计划 T3 #3 会话内查找，linux2）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），聊天历史用 __fakeSeedHistory 种一段含「端口」的对话，不碰用户会话。
// Metre（metre-board 场景，先关掉总谱）每格（1440 / 820 × 日夜）拍：
//   find-hits  Ctrl+F 唤出查找条，输入「端口」：全部命中高亮，当前那条实心，计数 1/n
//   find-next  再按两次 Enter：当前那条往下走，计数 3/n
//   find-none  输入一个不存在的词：计数位写「无匹配」，上一条 / 下一条变灰
//   find-esc   Esc 关闭：查找条和高亮都没了
// 对照（project 模式，long-conversation 场景，只拍 1440 日 / 夜）：
//   native-project  按 Ctrl+F 仍是原生「过滤消息」搜索条，页面上没有 .pk-metre-find
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

const t = (text) => [{type: 'text', text}];
const HISTORY = [
  {role: 'user', content: t('开发服务器的端口被占用了，帮我看看怎么改'), timestamp: 1},
  {role: 'assistant', stopReason: 'stop', content: t('5173 端口被另一个进程占着。可以在 vite.config.js 里把 **端口** 改成 5174，或者先结束占用端口的进程。'), timestamp: 2},
  {role: 'user', content: t('改成 5174 吧'), timestamp: 3},
  {role: 'assistant', stopReason: 'stop', content: t('改好了：`server.port` 现在是 5174。重新运行 `npm run dev` 就会用新端口。'), timestamp: 4},
];
const initScript = new Function(`window.__fakeSeedHistory = ${JSON.stringify(HISTORY)};`);

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
const findState = (page) => page.evaluate(() => {
  const bar = document.querySelector('.pk-metre-find');
  const reg = typeof CSS !== 'undefined' ? CSS.highlights : null;
  return {open: Boolean(bar && !bar.hidden), label: bar?.querySelector('.pk-metre-find__count')?.textContent ?? null,
    state: window.Pinkie?.metreFind?.state?.() ?? null,
    marks: reg ? [reg.get('pk-metre-find')?.size ?? 0, reg.get('pk-metre-find-current')?.size ?? 0] : null,
    prevDisabled: bar?.querySelector('[data-find="prev"]')?.disabled ?? null,
    nativeBar: Boolean(document.querySelector('.agent-chat__search-bar'))};
});
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function metreCell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    await page.waitForFunction(() => [...document.querySelectorAll('.chat-thread .chat-text')].some((n) => n.textContent.includes('端口')), null, {timeout: 15_000}).catch(() => {});
    await page.locator('.agent-chat__composer-combobox textarea').first().click({timeout: 5000}).catch(() => {});

    await page.keyboard.press(`${MOD}+f`);
    await page.waitForSelector('.pk-metre-find:not([hidden])', {timeout: 5000}).catch(() => {});
    await page.keyboard.type('端口');
    await page.waitForFunction(() => /^\d+\/\d+/.test(document.querySelector('.pk-metre-find__count')?.textContent || ''), null, {timeout: 5000}).catch(() => {});
    await page.waitForTimeout(300);
    const hits = await findState(page);
    await shot(page, 'find-hits', theme, width, {mode, label: hits.label});
    report.push({theme, width, step: 'hits', mode, ...hits});

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const next = await findState(page);
    await shot(page, 'find-next', theme, width, {label: next.label});
    report.push({theme, width, step: 'next', ...next});

    await page.fill('.pk-metre-find__input', '不存在的词');
    await page.waitForFunction(() => document.querySelector('.pk-metre-find__count')?.textContent === '无匹配', null, {timeout: 5000}).catch(() => {});
    await page.waitForTimeout(200);
    const none = await findState(page);
    await shot(page, 'find-none', theme, width, {label: none.label});
    report.push({theme, width, step: 'none', ...none});

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const esc = await findState(page);
    await shot(page, 'find-esc', theme, width, {open: esc.open});
    report.push({theme, width, step: 'esc', ...esc, pageErrors});
  } finally {
    await context.close();
  }
}

async function nativeCell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'long-conversation', theme);
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.locator('.agent-chat__composer-combobox textarea').first().click({timeout: 5000}).catch(() => {});
    await page.keyboard.press(`${MOD}+f`);
    await page.waitForSelector('.agent-chat__search-bar', {timeout: 5000}).catch(() => {});
    await page.waitForTimeout(300);
    const st = await findState(page);
    await shot(page, 'native-project', theme, width, {mode, nativeBar: st.nativeBar, metreBar: st.open});
    report.push({theme, width, step: 'native', mode, ...st, metreBarNode: await page.evaluate(() => Boolean(document.querySelector('.pk-metre-find'))), pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await metreCell(theme, width);
    await nativeCell(theme, 1440);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
