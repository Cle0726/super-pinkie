#!/usr/bin/env node
// L24（T3 #10 计划卡，linux/L24）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）。pinkie.plan.get 在页面里接住，答一份 5 项的计划（2 完成、1 进行中、2 未开始），
// 再换成全部完成；不连网关、不碰用户会话。每格（1440 / 820 × 日夜）拍：
//   plan-running  Metre 下计划卡进行中：钴蓝进度、实底、细边、无阴影
//   plan-done     Metre 下全部做完后收成一行
//   plan-classic  对照：项目模式（long-conversation 场景，1440 × 日夜）同一张卡，应和改前一样是碧琪那一套
// 注入对照：每一格都把 laolao-metre-plan.css 临时停用再量一次卡片的计算样式。
//   项目模式两次必须完全相同（新文件对其他模式不起作用）；Metre 两次必须不同（新文件确实生效）。结果写在 report.json / shots.jsonl。
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

const RUNNING = {title: '整理发布前检查', explanation: '只改 Metre 的配色，其他模式不动。', items: [
  {id: 'a', text: '读一遍改动清单', status: 'completed'},
  {id: 'b', text: '跑相关单测', status: 'completed'},
  {id: 'c', text: '核对日夜对比度', status: 'in_progress'},
  {id: 'd', text: '补截图', status: 'pending'},
  {id: 'e', text: '写 PR 说明', status: 'pending'},
]};
const DONE = {...RUNNING, explanation: '', items: RUNNING.items.map((i) => ({...i, status: 'completed'}))};

// 页面里：fake-gateway.js 赋 window.WebSocket 时接住它，pinkie.plan.get 答上面的计划（updatedAt 用页面自己的时钟，卡片只挂最近 5 分钟的计划）；
// 其余照旧交给假网关。写法同 tools/pr-shots/218-r5-open-chip.mjs。
const initScript = new Function(`const PLANS = ${JSON.stringify({running: RUNNING, done: DONE})};
window.__l24Plan = 'running';
const answers = {'pinkie.plan.get': () => ({plan: {...PLANS[window.__l24Plan], updatedAt: Date.now()}})};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__l24Shots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function l24Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      (window.__l24ShotsRpc ||= []).push(f.method);
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__l24Shots = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

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

// 卡片的计算样式（外框、标签、已完成圆点、进行中文字、小字）
const cardStyle = (page) => page.evaluate(() => {
  const card = document.querySelector('.pk-plan');
  if (!card) return null;
  const cs = (n) => (n ? getComputedStyle(n) : null);
  const s = cs(card), label = cs(card.querySelector('.pk-plan__label')), count = cs(card.querySelector('.pk-plan__count'));
  const dot = cs(card.querySelector('.pk-plan__item[data-status="completed"] .pk-plan__mark svg circle'));
  return {
    state: card.dataset.state, bg: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow, font: s.fontFamily, color: s.color,
    accent: s.getPropertyValue('--pk-accent').trim(), good: s.getPropertyValue('--pk-good').trim(),
    label: label ? [label.color, label.backgroundColor, label.borderRadius] : null, count: count ? count.color : null, dot: dot ? dot.fill : null,
  };
});
// 把 laolao-metre-plan.css 停用再量一次，量完恢复
const styleWithoutMine = async (page) => {
  const found = await page.evaluate(() => { const l = document.querySelector('link[href*="laolao-metre-plan.css"]'); if (l) l.disabled = true; return Boolean(l); });
  await page.waitForTimeout(100);
  const style = await cardStyle(page);
  await page.evaluate(() => { const l = document.querySelector('link[href*="laolao-metre-plan.css"]'); if (l) l.disabled = false; });
  await page.waitForTimeout(100);
  return {found, style};
};
const waitCard = (page, state) => page.waitForFunction((want) => document.querySelector(`.pk-plan[data-state="${want}"] .pk-plan__item`), state, {timeout: 15_000})
  .then(() => true, () => false);

async function cell(sceneId, theme, width, {done}) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, sceneId, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    await page.evaluate(() => window.__pinkiePlan?.refresh?.());
    const shown = await waitCard(page, 'running');
    await page.evaluate(() => document.querySelector('.pk-plan')?.scrollIntoView({block: 'center'}));
    await page.waitForTimeout(600);
    const name = mode === 'metre' ? 'plan-running' : 'plan-classic';
    const style = await cardStyle(page);
    const without = await styleWithoutMine(page);
    const changedByMine = JSON.stringify(style) !== JSON.stringify(without.style);
    await shot(page, name, theme, width, {mode, shown, changedByMine, linked: without.found});
    report.push({scene: sceneId, theme, width, step: 'running', mode, shown, style, withoutMine: without, changedByMine, rpc: await page.evaluate(() => window.__l24ShotsRpc || [])});

    if (done) {
      await page.evaluate(() => { window.__l24Plan = 'done'; window.__pinkiePlan?.refresh?.(); });
      const finished = await waitCard(page, 'done');
      await page.evaluate(() => document.querySelector('.pk-plan')?.scrollIntoView({block: 'center'}));
      await page.waitForTimeout(800);
      await shot(page, 'plan-done', theme, width, {mode, finished});
      report.push({scene: sceneId, theme, width, step: 'done', mode, finished, style: await cardStyle(page), pageErrors});
    } else report.push({scene: sceneId, theme, width, step: 'errors', pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell('metre-board', theme, width, {done: true});
    await cell('long-conversation', theme, 1440, {done: false});
  }
} finally {
  // 注入对照的结论：项目模式停用新文件前后完全一样；Metre 停用前后不一样
  const running = report.filter((r) => r.step === 'running');
  const verdict = {
    otherModesUnchanged: running.filter((r) => r.mode !== 'metre').every((r) => r.shown && r.withoutMine.found && !r.changedByMine),
    metreChanged: running.filter((r) => r.mode === 'metre').every((r) => r.shown && r.changedByMine),
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({verdict, cells: report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  console.log('L24 注入对照：' + JSON.stringify(verdict));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
