#!/usr/bin/env node
// #187（G4 项目规矩入口）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）的 metre-board 场景；pinkie.metre.memory / pinkie.fs.stat 在页面里接成示例数据，不碰用户会话。
// 每格（1440 / 820 × 日夜）拍一张：总控台「项目记忆」区，下面一行「项目规矩」列出 CLAUDE.md 和 .cursorrules。
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

const initScript = () => {
  const items = [
    {id: 'm1', category: 'commands', categoryName: '命令', text: '全量门禁：node tools/release-gate/run-tests.mjs', pinned: true, updatedAt: 3},
    {id: 'm2', category: 'conventions', categoryName: '规矩', text: '新文件不超过 1500 行，超长文件只许变短', updatedAt: 2},
    {id: 'm3', category: 'pitfalls', categoryName: '踩坑', text: 'WebKit 下每次 newPage 约 10 秒，e2e 多场景共用一页', updatedAt: 1},
  ];
  const answers = {
    'pinkie.metre.memory': (p) => p.action === 'stats'
      ? {ok: true, folder: '/Users/demo/super-pinkie', name: 'super-pinkie', count: items.length, known: 3, byCategory: {commands: 1, conventions: 1, pitfalls: 1}}
      : {ok: true, items},
    'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => (['CLAUDE.md', '.cursorrules'].includes(x) ? {path: x, exists: true, kind: 'file'} : {path: x, exists: false}))}),
  };
  const patch = (Cls) => {
    if (!Cls?.prototype || Cls.prototype.__g4Shots) return;
    const orig = Cls.prototype.send;
    Cls.prototype.send = function g4Send(data) {
      let f = null; try { f = JSON.parse(data); } catch {}
      if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
        Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
        return;
      }
      return orig.call(this, data);
    };
    Cls.prototype.__g4Shots = true;
  };
  let cur = window.WebSocket;
  Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});
};

const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const rulesOk = await page.waitForFunction(() => document.querySelectorAll('.pk-mb-rules button').length >= 2, null, {timeout: 15_000})
      .then(() => true, () => false);
    await page.evaluate(() => document.querySelector('[data-metre-slot="memory"]')?.scrollIntoView({block: 'start'}));
    await page.waitForTimeout(300);
    const rules = await page.evaluate(() => [...document.querySelectorAll('.pk-mb-rules button')].map((b) => b.textContent));
    const file = `g4-rules-${width}-${theme}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name: `g4-rules-${width}-${theme}`, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
      bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), rulesOk});
    report.push({theme, width, rulesOk, rules, pageErrors});
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
