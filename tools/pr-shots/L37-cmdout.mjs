#!/usr/bin/env node
// L37 / T3#9（Metre 命令输出面板：工作过程里命令那一步的命令头）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；聊天历史用 __fakeSeedHistory 种一轮：一条失败的测试命令、
// 一条放到后台的命令、一次读文件。每格（1440 / 820 × 日夜）拍：
//   cmdout-steps   点开工具组、展开两条命令：每条输出上方一行「$ 命令 · 结果 · 复制命令 / 复制输出」
//   cmdout-project 同一页切到项目模式（对照：命令头全部拿掉）
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
const call = (id, name, a) => ({type: 'toolCall', id, name, arguments: a});
const HISTORY = [
  {role: 'user', content: t('跑一下登录相关的测试，再把开发服务起起来'), timestamp: 1},
  {role: 'assistant', stopReason: 'toolUse', content: [{type: 'text', text: '先跑测试。'}, call('c1', 'exec', {command: 'npm test -- --grep login'})], timestamp: 2},
  {role: 'toolResult', toolCallId: 'c1', toolName: 'exec', isError: true,
    content: t('\u001b[31mFAIL\u001b[0m tests/login.test.js\n  ✕ 密码错误时提示（12 ms）\n\nTests: 1 failed, 7 passed\n\n(Command exited with code 1)'), timestamp: 3},
  {role: 'assistant', stopReason: 'toolUse', content: [call('c2', 'exec', {command: 'npm run dev'}), call('r1', 'read', {path: 'tests/login.test.js'})], timestamp: 4},
  {role: 'toolResult', toolCallId: 'c2', toolName: 'exec', content: t('Command still running (session dawn-glade, pid 29891). Use process for follow-up.'), timestamp: 5},
  {role: 'toolResult', toolCallId: 'r1', toolName: 'read', content: t("test('密码错误时提示', ...)"), timestamp: 6},
  {role: 'assistant', stopReason: 'stop', content: t('登录测试有 1 条没过（密码错误时的提示），开发服务已经在后台跑着。'), timestamp: 7},
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
// 点开工作过程、工具组（「● 运行了 2 个命令 ›」）和每条命令那一步，原生才把输出画出来。
const expandSteps = async (page) => {
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      document.querySelectorAll('details.pinkie-process:not([open])').forEach((d) => { d.open = true; });
      document.querySelectorAll('.pinkie-process .cle-run[aria-expanded="false"]').forEach((b) => b.click());
      document.querySelectorAll('.pinkie-process .chat-tool-msg-summary[aria-expanded="false"]').forEach((b) => {
        if (/执行命令|exec|命令/i.test(b.textContent || '')) b.click();
      });
    });
    await page.waitForTimeout(400);
  }
};
const heads = (page) => page.evaluate(() => [...document.querySelectorAll('.pk-mcmd')].map((h) => h.innerText.replace(/\s+/g, ' ').trim()));

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    // 场景 metre-board 会先打开总谱（占右侧）；关掉它，拍对话区。
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    await page.waitForFunction(() => document.querySelector('.pinkie-process'), null, {timeout: 15_000}).catch(() => console.log('[L37] 没等到工作过程卡'));
    await expandSteps(page);
    await page.waitForFunction(() => document.querySelectorAll('.pk-mcmd').length >= 2, null, {timeout: 10_000}).catch(() => console.log('[L37] 命令头不到 2 个'));
    await page.evaluate(() => document.querySelector('.pk-mcmd')?.scrollIntoView({block: 'center'}));
    await page.waitForTimeout(300);
    const found = await heads(page);
    await shot(page, 'cmdout-steps', theme, width, {mode, heads: found.length});
    report.push({theme, width, step: 'steps', mode, heads: found, pageErrors});

    // 对照：同一页切到项目模式，命令头应全部拿掉
    await page.evaluate(() => { document.documentElement.setAttribute('data-laolao-mode', 'project'); window.dispatchEvent(new CustomEvent('laolao:modechange')); });
    await page.waitForFunction(() => !document.querySelector('.pk-mcmd'), null, {timeout: 5000}).catch(() => console.log('[L37] 切到项目模式后命令头还在'));
    await page.waitForTimeout(300);
    const left = await heads(page);
    await shot(page, 'cmdout-project', theme, width, {heads: left.length});
    report.push({theme, width, step: 'project', heads: left});
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
