#!/usr/bin/env node
// #111「月度回顾」界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用，本机不开浏览器。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json（量到的颜色 / 尺寸 / 文字）。
// 真页面（tests/visual/lib/real-harness.mjs），时钟拨到 2026-12-02 10:00（回顾只在每月 1–7 日出），
// 假 pinkie.recap.month + 只给回顾自己的 sessions.list 一份固定会话（和 tests/recap-ui.test.mjs 同一套数），别的调用照走真网关。
// 每格（1440 / 820 × 日夜）拍：
//   home           唠嗑首页整页（回顾卡在「继续之前的工作」前面）
//   home-card      回顾卡本身
//   settings       设置弹层里的「月度回顾」卡片
//   settings-open  点「看上个月」后的预览（没有「收起」）
//   settings-card  上面那张卡片本身
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
  // 真夹具先把 Date 冻在 11-20；这里在它之后跑，换成 12-02 10:00（本机时间）。
  const parent = Object.getPrototypeOf(window.Date);
  const Base = typeof parent === 'function' && parent !== Function.prototype ? parent : window.Date;
  const ms = new Base(2026, 11, 2, 10, 0, 0).getTime();
  class RecapDate extends Base {
    constructor(...a) { super(...(a.length ? a : [ms])); }
    static now() { return ms; }
  }
  window.Date = RecapDate;
  window.__laolaoStartupHomeClock = () => new RecapDate(ms);
  try { localStorage.removeItem('pinkie.recap.prefs'); } catch {}

  const day = (m, d) => new Base(2026, m - 1, d, 10, 0, 0).getTime();
  const sessions = [
    ['agent:main:a', '聊天一', day(11, 3)], ['agent:main:b', '聊天二', day(11, 9)], ['agent:main:c', '聊天三', day(11, 28)],
    ['agent:project:p1', '登录页改蓝色', day(11, 12)], ['agent:project:p2', '月报脚本', day(11, 20)],
    ['agent:learning:l1', '专升本数学', day(11, 15)],
    ['agent:unrestricted:u1', '随便聊', day(11, 5)],
    ['agent:main:old', '十月的', day(10, 30)],
    ['agent:main:sub:subagent:x', '子任务', day(11, 10)],
  ].map(([key, label, updatedAt]) => ({key, label, updatedAt}));
  const study = {month: '2026-11', study: {activeDays: 9, minutes: 320, answered: 140, correct: 112, wrong: 28, reviews: 35, notes: 4, lessons: 3},
    vocab: {added: 40, reviewed: 120}, streak: {current: 5, best: 9}};
  window.__recapShotCalls = [];
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__recap) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => {
      if (method === 'pinkie.recap.month') { window.__recapShotCalls.push(method); return Promise.resolve(study); }
      // 只接回顾自己那次（调用栈里有 laolao-recap.js），侧栏等别的 sessions.list 照走真网关。
      if (method === 'sessions.list' && /laolao-recap\.js/.test(String(new Error().stack || ''))) {
        window.__recapShotCalls.push(method); return Promise.resolve({sessions});
      }
      return real(method, params, timeout);
    };
    fake.__recap = true;
    sidebar.gwRequest = fake;
    return true;
  };
  if (!wrap()) { const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 20); }
};

const measure = (page, selectors) => page.evaluate(list => list.map(sel => {
  const node = document.querySelector(sel);
  if (!node) return {sel, missing: true};
  const s = getComputedStyle(node), r = node.getBoundingClientRect();
  return {sel, text: (node.textContent || '').trim().slice(0, 80), color: s.color, background: s.backgroundColor, border: s.borderColor, font: s.fontSize,
    w: Math.round(r.width), h: Math.round(r.height), overflowX: node.scrollWidth > node.clientWidth + 1};
}), selectors);

const CARD_SELECTORS = ['.laolao-startup-home__recap', '.laolao-startup-home__recap-title', '.laolao-startup-home__recap-line', '.laolao-startup-home__recap-close'];
const HEIGHT = 800;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const engine = String(H.resolveRealEngine() || 'chromium');
const browser = await H.launchRealBrowser(engine);
const report = [];
const lines = [];

const record = (name, file) => {
  const buf = fs.readFileSync(path.join(out, file));
  // PNG IHDR：宽在 16–19 字节，高在 20–23 字节
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
const shot = async (page, name, theme, width) => {
  const file = `111-${name}-${theme}-${width}.png`;
  await page.screenshot({path: path.join(out, file)});
  record(`111-${name}-${theme}-${width}`, file);
};
const shotOf = async (locator, name, theme, width) => {
  const file = `111-${name}-${theme}-${width}.png`;
  await locator.screenshot({path: path.join(out, file)});
  record(`111-${name}-${theme}-${width}`, file);
};

async function home(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'home-chat', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const card = page.locator('.chat-main > .laolao-startup-home__recap');
    await card.waitFor({timeout: 15_000});
    if (await card.getAttribute('data-short') === '1') {
      // 网关还没连上时回顾拿到的是空数，记下来再开一次。
      report.push({theme, width, step: 'home', short: true, calls: await page.evaluate(() => window.__recapShotCalls)});
      await page.reload();
      await card.waitFor({timeout: 15_000});
    }
    await page.waitForTimeout(600);
    await shot(page, 'home', theme, width);
    await card.scrollIntoViewIfNeeded();
    await shotOf(card, 'home-card', theme, width);
    report.push({theme, width, step: 'home', date: await page.evaluate(() => new Date().toString()),
      calls: await page.evaluate(() => window.__recapShotCalls),
      nextSibling: await page.evaluate(() => document.querySelector('.chat-main > .laolao-startup-home__recap')?.nextElementSibling?.className || ''),
      styles: await measure(page, CARD_SELECTORS), pageErrors});
  } catch (error) {
    report.push({theme, width, step: 'home', error: error.message, pageErrors});
  } finally {
    await context.close();
  }
}

async function settings(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'settings', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const card = page.locator('#laolao-user-settings .laolao-recap-settings');
    await card.waitFor({timeout: 10_000});
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'settings', theme, width);
    await page.locator('#laolao-user-settings .laolao-recap-open').click();
    const preview = page.locator('#laolao-user-settings .laolao-recap-preview .laolao-startup-home__recap');
    await preview.waitFor({timeout: 10_000});
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'settings-open', theme, width);
    await shotOf(card, 'settings-card', theme, width);
    report.push({theme, width, step: 'settings', calls: await page.evaluate(() => window.__recapShotCalls),
      closeButtons: await preview.locator('.laolao-startup-home__recap-close').count(),
      styles: await measure(page, ['.laolao-recap-settings', '.laolao-recap-open', ...CARD_SELECTORS.map(s => '.laolao-recap-preview ' + s)]), pageErrors});
  } catch (error) {
    report.push({theme, width, step: 'settings', error: error.message, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await home(theme, width);
      await settings(theme, width);
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) if (r.error) console.log(`pr-shots: ${r.theme} ${r.width} ${r.step} 出错：${r.error}`);
