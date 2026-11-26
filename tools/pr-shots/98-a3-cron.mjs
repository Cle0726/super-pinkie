#!/usr/bin/env node
// #98（A3 定时任务入口）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；cron.* / pinkie.cron.targets 在页面里接到三条示例任务，不碰用户会话。
// 每格（1440 / 820 × 日夜）拍：
//   a3-settings  设置页「定时任务」卡（#pinkie-schedules）：三条任务（开 / 出错 / 停用）
//   a3-cron      原生 /cron 页（openclaw-cron-page）在 Metre 里的样子，同样三条任务
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

// 页面里：fake-gateway.js 赋 window.WebSocket 时接住它，把 cron.* 请求答成示例任务，其余照旧交给假网关。
// 时间在请求时才取（那时 Date 已被 harness 冻住），截图每次一样。浏览器时区定成 Asia/Shanghai（CI 机器是 UTC），示例时间按北京时间对齐 cron 表达式。
const initScript = () => {
  const jobsAt = (t0) => [
    {id: 'j1', name: 'weather', displayName: '早上的天气', enabled: true, agentId: 'main', schedule: {kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai'},
      payload: {kind: 'agentTurn', message: '查一下今天的天气，告诉我要不要带伞、穿什么。'}, delivery: {mode: 'announce', channel: 'feishu', to: 'ou_123456'},
      // 冻住的时刻 t0 = 11-20 12:00 北京时间（周五）：下次 = 明早 08:00（+20h），上次 = 今早 08:00（-4h），和 0 8 * * * 对得上
      state: {nextRunAtMs: t0 + 20 * 3600e3, lastRunAtMs: t0 - 4 * 3600e3, lastStatus: 'ok'}},
    {id: 'j2', name: 'ci', displayName: '每隔 30 分钟看一眼 CI 有没有红', enabled: true, agentId: 'metre', schedule: {kind: 'every', everyMs: 30 * 60000},
      payload: {kind: 'agentTurn', message: '打开仓库最近一次 CI，如果有红的就把失败的测试名和第一行报错发给我，没有就什么都不用说。这一段故意写得长一点，看会不会撑破行。'},
      delivery: {mode: 'announce', channel: 'last'},
      state: {nextRunAtMs: t0 + 12 * 60000, lastRunAtMs: t0 - 18 * 60000, lastStatus: 'error'}},
    {id: 'j3', name: 'weekly', displayName: '周一的待办', enabled: false, agentId: 'project', schedule: {kind: 'cron', expr: '0 9 * * 1,3,5', tz: 'Asia/Shanghai'},
      payload: {kind: 'agentTurn', message: '整理上周没做完的事和这周要注意的安排，列成清单。'}, delivery: {mode: 'announce', channel: 'last'},
      state: {lastRunAtMs: t0 - 51 * 3600e3, lastStatus: 'ok'}},   // 停用前最后一次：周三 11-18 09:00 北京时间
  ];
  const answers = {
    'cron.list': () => { const jobs = jobsAt(Date.now()); return {jobs, total: jobs.length, offset: 0, limit: 100, hasMore: false, nextOffset: null}; },
    'cron.status': () => ({enabled: true, jobs: 3, nextWakeAtMs: Date.now() + 12 * 60000}),
    'pinkie.cron.targets': () => ({targets: [{channel: 'feishu', to: 'ou_123456', tail: '3456', at: Date.now() - 864e5}]}),
    'cron.runs': (p) => { const t0 = Date.now(); const entries = p.id === 'j2'
      ? [{jobId: 'j2', status: 'error', runAtMs: t0 - 18 * 60000, ts: t0 - 18 * 60000, error: 'tests/metre-board.test.mjs 第 3 条失败：期望 0 实际 2。'},
        {jobId: 'j2', status: 'ok', runAtMs: t0 - 48 * 60000, ts: t0 - 48 * 60000, summary: 'CI 全绿。'}]
      : [{jobId: p.id || 'j1', status: 'ok', runAtMs: t0 - 19 * 3600e3, ts: t0 - 19 * 3600e3, summary: '今天多云转小雨，记得带伞，薄外套就够。'}];
      return {entries, total: entries.length, offset: 0, limit: 50, hasMore: false, nextOffset: null}; },
    'cron.run': () => ({ok: true}), 'cron.update': () => ({ok: true}), 'cron.add': () => ({ok: true}), 'cron.remove': () => ({ok: true}),
  };
  const patch = (Cls) => {
    if (!Cls?.prototype || Cls.prototype.__a3Shots) return;
    const orig = Cls.prototype.send;
    Cls.prototype.send = function a3Send(data) {
      let f = null; try { f = JSON.parse(data); } catch {}
      if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
        (window.__a3ShotsRpc ||= []).push(f.method);
        Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
        return;
      }
      return orig.call(this, data);
    };
    Cls.prototype.__a3Shots = true;
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
const shot = async (page, name, theme, width, extra = {}) => {
  const file = `${name}-${width}-${theme}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name: `${name}-${width}-${theme}`, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript, timezoneId: 'Asia/Shanghai'});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    // 设置页：点侧栏底部的「设置」
    const link = 'a.sidebar-footer-icon[aria-label="设置"], .sidebar-shell__footer a[href^="/settings"]';
    await page.waitForSelector(link, {state: 'attached', timeout: 10_000});
    await page.evaluate((sel) => document.querySelector(sel)?.click(), link);
    const rows = await page.waitForFunction(() => document.querySelectorAll('#pinkie-schedules .pk-job').length >= 3, null, {timeout: 15_000})
      .then(() => page.locator('#pinkie-schedules .pk-job').count(), () => 0);
    await page.evaluate(() => document.querySelector('#pinkie-schedules')?.scrollIntoView({block: 'start'}));
    await page.waitForTimeout(300);
    await shot(page, 'a3-settings', theme, width, {mode, rows});
    report.push({theme, width, step: 'settings', mode, rows});

    // 原生 /cron 页：同一个页面换路由（保留查询串，init 脚本重新跑一遍）
    const u = new URL(page.url()); u.pathname = '/cron';
    await page.goto(u.href);
    const cronOk = await page.waitForFunction(() => /weather/.test(document.querySelector('openclaw-cron-page .list-title')?.textContent || ''), null, {timeout: 15_000})
      .then(() => true, () => false);
    await page.waitForTimeout(400);
    const cron = await page.evaluate(() => ({
      mode: document.documentElement.getAttribute('data-laolao-mode'), path: location.pathname,
      page: Boolean(document.querySelector('openclaw-cron-page')), rpc: window.__a3ShotsRpc || [],
    }));
    await shot(page, 'a3-cron', theme, width, {mode: cron.mode, cronOk});
    report.push({theme, width, step: 'cron', cronOk, ...cron, pageErrors});
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
