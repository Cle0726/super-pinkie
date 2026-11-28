#!/usr/bin/env node
// #96 L32（T3 #4 Metre 时间线缩略条 / 小节线）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；聊天历史用 __fakeSeedHistory 种 5 条提问的长对话，不碰用户会话。
// 每格（1440 / 820 × 日夜）拍：
//   l32-top   刚打开、滚到顶：右边一条小节线，第 1 小节是钴蓝，浅框是看得到的那一段
//   l32-jump  点第 4 根小节线以后：第 4 条提问到了顶上并闪一下，钴蓝跟着到第 4 小节
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
const QUESTIONS = ['先看看登录页现在是怎么写的', '把登录按钮改成蓝色，悬停再深一点', '顺便跑一下前端测试，看有没有挂的', '还有别的页面用到同一个按钮样式吗', '最后把这次的改动整理成一段说明'];
const para = (i) => Array.from({length: 7}, (_, k) => `第 ${i + 1} 段回答的第 ${k + 1} 行：这里是用来撑开对话高度的说明文字，确保整段对话需要滚动，缩略条才会出现。`).join('\n\n');
const HISTORY = QUESTIONS.flatMap((q, i) => [
  {role: 'user', content: t(q), timestamp: 1000 + i * 10},
  {role: 'assistant', stopReason: 'stop', content: t(para(i)), timestamp: 1005 + i * 10},
]);
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
const state = (page) => page.evaluate(() => {
  const rail = document.querySelector('.pk-mmap');
  const inner = document.querySelector('openclaw-chat-pane .chat-thread-inner');
  const r = rail?.getBoundingClientRect(), ir = inner?.getBoundingClientRect();
  const ticks = [...document.querySelectorAll('.pk-mmap__tick')].map((b) => [b.getAttribute('aria-label'), b.hasAttribute('aria-current')]);
  return {rail: Boolean(rail), tight: document.documentElement.dataset.pkMmap || '', ticks,
    railLeft: r ? Math.round(r.left) : null, textRight: ir ? Math.round(ir.right) : null,
    clearOfText: r && ir ? r.left >= ir.right : null};
});

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    // 场景 metre-board 会先打开总谱（占右侧）；关掉它，拍对话区。
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('openclaw-chat-pane .chat-group.user').length >= 5, null, {timeout: 15_000}).catch(() => {});
    await page.evaluate(() => { const th = document.querySelector('openclaw-chat-pane .chat-thread'); if (th) th.scrollTop = 0; });
    const shown = await page.waitForFunction(() => document.querySelectorAll('.pk-mmap__tick').length >= 5, null, {timeout: 10_000}).then(() => true, () => false);
    await page.waitForTimeout(300);
    await shot(page, 'l32-top', theme, width, {mode, shown});
    report.push({theme, width, step: 'top', mode, shown, ...(await state(page))});

    await page.locator('.pk-mmap__tick').nth(3).click({timeout: 5000}).catch((error) => console.log('[l32] 点小节线失败：' + error.message.split('\n')[0]));
    const jumped = await page.waitForFunction(() => document.querySelector('.pk-mmap__tick[data-index="3"]')?.hasAttribute('aria-current'), null, {timeout: 5000}).then(() => true, () => false);
    await page.waitForTimeout(250);
    await shot(page, 'l32-jump', theme, width, {jumped});
    report.push({theme, width, step: 'jump', jumped, ...(await state(page)), pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell(theme, width);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
