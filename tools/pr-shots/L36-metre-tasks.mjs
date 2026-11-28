#!/usr/bin/env node
// L36（T3 #24）Metre 工作台「后台任务」页的界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），pinkie.fs.* 和 pinkie.work.status / detail 在页里接住（照 374-wb-status.mjs）。
//   L36-metre-<宽>-<日夜>-<有|空>   Metre × 1440 / 1280 / 820 × 日夜 × 有任务（在跑 / 失败 / 做完）/ 没有任务
//   L36-project-1440-<日夜>          碧琪项目模式：标签栏没有「后台任务」键（对照，不该出现）
// 每张记入口键在不在、整页有几行、行有没有被横向截断（cut 应为空）。
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
const NAMES = ['README.md', 'package.json', 'src/app.js'];
const initScript = new Function(`
const NAMES = ${JSON.stringify(NAMES)};
const rel = (p) => { const s = String(p || ''); return s.startsWith('/proj/') ? s.slice(6) : s === '/proj' ? '' : s; };
const T = Date.now();
const full = (key) => ({sessionKey: key, now: T,
  background: [
    {id: 'bg-run', execId: 'e2', command: 'npm run build -- --watch', state: 'running', startedAt: T - 65000, endedAt: 0, woke: false},
    {id: 'bg-done', execId: 'e1', command: 'npm test -- --reporter=dot tests/very/long/path/that/should/wrap/instead/of/overflowing.test.mjs', state: 'done', startedAt: T - 190000, endedAt: T - 130000, woke: true},
  ],
  reasoning: {phase: 'idle', jobs: [{id: 'j1', label: '独立解答', model: 'qa/gpt-5', state: 'failed', summary: '超时：8 分钟没有交回', startedAt: T - 600000, endedAt: T - 120000, hasOutput: true}]},
  tier: {active: true, children: [{id: 'c1', roleLabel: '查资料', model: 'qa/selected', state: 'running', summary: '在翻 docs/ARCHITECTURE.md 和 PLAN', startedAt: T - 12000, endedAt: 0, hasOutput: true}]}});
const empty = (key) => ({sessionKey: key, now: T, background: [], reasoning: {phase: 'idle', jobs: []}, tier: {active: false, children: []}});
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => { const d = rel(p.path); const kids = new Map();
    for (const n of NAMES) { if (d && !n.startsWith(d + '/')) continue; const rest = d ? n.slice(d.length + 1) : n; const head = rest.split('/')[0];
      kids.set(head, {name: head, path: d ? d + '/' + head : head, kind: rest.includes('/') ? 'dir' : 'file'}); }
    return {entries: [...kids.values()]}; },
  'pinkie.fs.read': (p) => { const c = ['# proj', '', 'npm run dev', ''].join(String.fromCharCode(10)); return {kind: 'text', content: c, path: p.path, readOnly: false, size: c.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', ahead: 0, behind: 0, changes: []}),
  'pinkie.fs.gitShow': () => ({content: '# proj' + String.fromCharCode(10), exists: true}),
  'pinkie.work.status': (p) => (localStorage.getItem('l36Tasks') === 'empty' ? empty : full)(p.sessionKey),
  'pinkie.work.detail': (p) => ({found: true, output: '（截图用的假结果）' + p.kind + ' ' + p.id, sessionKey: p.sessionKey}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__l36) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function l36Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__l36 = true;
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
const shot = async (page, name, extra) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name, file, os: process.platform, browser: engine || 'chromium', height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};
const measure = (page) => page.evaluate(() => {
  const entry = document.querySelector('.pk-wb-tabs__actions .pk-mtask__entry');
  const pageBox = document.querySelector('.pk-mtask');
  const rows = [...document.querySelectorAll('.pk-mtask__row')];
  const box = pageBox?.parentElement?.getBoundingClientRect();
  const cut = box ? rows.filter((r) => { const b = r.getBoundingClientRect(); return b.right > box.right + 0.5 || r.scrollWidth > r.clientWidth + 1; }).map((r) => r.dataset.kind + ':' + r.dataset.state) : [];
  return {entry: Boolean(entry), entryLabel: entry?.getAttribute('aria-label') || '', page: Boolean(pageBox), rows: rows.map((r) => r.dataset.kind + ':' + r.dataset.state),
    empty: Boolean(document.querySelector('.pk-mtask__empty')), cut, mode: document.documentElement.getAttribute('data-laolao-mode')};
});

async function openBench(page, width) {
  await page.setViewportSize({width, height: HEIGHT});
  await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
  await page.evaluate(() => window.__pinkieWorkbench?.show?.()).catch(() => {});
  await page.evaluate(() => window.__pinkieWorkbench.open('README.md', {pinned: true})).catch(() => {});
  await page.waitForFunction(() => window.__pinkieWorkbench?.state?.tabs?.find((x) => x.path === 'README.md')?.kind === 'text', null, {timeout: 15_000}).catch(() => {});
}

async function metreCell(theme, width, kind) {
  const tag = `metre-${width}-${theme}-${kind === 'empty' ? '空' : '有'}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.evaluate((k) => localStorage.setItem('l36Tasks', k), kind);
    await openBench(page, width);
    await page.waitForSelector('.pk-wb-tabs__actions .pk-mtask__entry', {timeout: 15_000}).catch(() => {});
    await page.evaluate(() => window.Pinkie?.metreTasks?.open?.());
    await page.waitForFunction((k) => k === 'empty' ? document.querySelector('.pk-mtask__empty') : document.querySelectorAll('.pk-mtask__row').length >= 4, kind, {timeout: 15_000}).catch(() => {});
    if (kind !== 'empty') {   // 失败那一行点开「看结果」，看展开后的样子
      await page.evaluate(() => [...document.querySelectorAll('.pk-mtask__row')].find((r) => r.dataset.kind === 'job')?.querySelector('.pk-mtask__more')?.click());
      await page.waitForFunction(() => /截图用的假结果/.test(document.querySelector('.pk-mtask__detail')?.textContent || ''), null, {timeout: 10_000}).catch(() => {});
    }
    const m = await measure(page);
    await shot(page, `L36-${tag}`, {width, ...m});
    report.push({tag, ...m, pageErrors});
  } finally {
    await context.close();
  }
}

async function projectCell(theme) {
  const tag = `project-1440-${theme}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'home-project', theme, {initScript});
  try {
    await openBench(page, 1440);
    await page.evaluate(() => window.Pinkie?.metreTasks?.open?.());   // 不在 Metre：不该开页
    const m = await measure(page);
    await shot(page, `L36-${tag}`, {width: 1440, ...m});
    report.push({tag, ...m, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) for (const width of [1440, 1280, 820]) for (const kind of ['full', 'empty']) await metreCell(theme, width, kind);
  for (const theme of ['day', 'night']) await projectCell(theme);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
