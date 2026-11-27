#!/usr/bin/env node
// L35（T3 #23 本会话产出的文件）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；聊天历史用 __fakeSeedHistory 种两轮写 / 改文件，
// pinkie.fs.* 和 pinkie.artifacts.list 在页面里接到一个小项目（/proj，git 仓库），不碰用户会话。每格（1440 / 820 × 日夜）拍：
//   l35-status   工作台出来以后，状态栏右边的「文件 N」
//   l35-page     点它以后：编辑区「本会话文件」一页（聊天里改过的 + 作品库里这个会话的图片）
//   l35-diff     点「README.md」以后：差异视图（上次提交 ↔ 现在）
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
  {role: 'user', content: t('写个 README，再把 app.js 的端口改成 5174'), timestamp: 1},
  {role: 'assistant', stopReason: 'toolUse', content: [call('w1', 'write', {path: '/proj/README.md'}), call('w2', 'edit', {path: '/proj/src/app.js', oldText: '5173', newText: '5174'})], timestamp: 2},
  {role: 'toolResult', toolCallId: 'w1', toolName: 'write', content: t('ok'), timestamp: 3},
  {role: 'toolResult', toolCallId: 'w2', toolName: 'edit', content: t('ok'), timestamp: 4},
  {role: 'assistant', stopReason: 'stop', content: t('README 写好了，端口改成 5174。'), timestamp: 5},
  {role: 'user', content: t('README 的启动命令改成 npm run dev，再画一张架构图'), timestamp: 6},
  {role: 'assistant', stopReason: 'toolUse', content: [call('w3', 'edit', {path: '/proj/README.md', oldText: 'npm start', newText: 'npm run dev'}), call('x1', 'exec', {command: 'python tools/draw.py > docs/arch.png'})], timestamp: 7},
  {role: 'toolResult', toolCallId: 'w3', toolName: 'edit', content: t('ok'), timestamp: 8},
  {role: 'toolResult', toolCallId: 'x1', toolName: 'exec', content: t(''), timestamp: 9},
  {role: 'assistant', stopReason: 'stop', content: t('启动命令改好了，架构图在 docs/arch.png。'), timestamp: 10},
];
const FILES = {
  'README.md': ['# proj\n\n启动：\n\n```\nnpm start\n```\n', '# proj\n\n启动：\n\n```\nnpm run dev\n```\n'],
  'src/app.js': ['export const port = 5173;\n', 'export const port = 5174;\n'],
};
const ART = [{id: 'l35a', path: '/proj/docs/arch.png', kind: 'image', title: 'arch.png', exists: true, total: 1, versions: [{v: 1, ts: 9, size: 2048}]}];
// 页面里：fake-gateway.js 赋 window.WebSocket 时接住它，pinkie.fs.* / pinkie.artifacts.list 答成一个小项目；其余照旧交给假网关。
const initScript = new Function(`window.__fakeSeedHistory = ${JSON.stringify(HISTORY)};
const FILES = ${JSON.stringify(FILES)};
const ART = ${JSON.stringify(ART)};
const rel = (p) => String(p || '').replace(/^\\/proj\\/?/, '');
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => (rel(p.path) === '' ? {entries: [{name: 'docs', path: 'docs', kind: 'dir'}, {name: 'src', path: 'src', kind: 'dir'}, {name: 'README.md', path: 'README.md', kind: 'file'}]}
    : rel(p.path) === 'src' ? {entries: [{name: 'app.js', path: 'src/app.js', kind: 'file'}]} : {entries: []}),
  'pinkie.fs.read': (p) => { const r = rel(p.path); const content = FILES[r] ? FILES[r][1] : ''; return {kind: 'text', content, path: p.path, readOnly: false, size: content.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: [{path: 'README.md', status: 'M'}, {path: 'src/app.js', status: 'M'}]}),
  'pinkie.fs.gitShow': (p) => { const r = rel(p.path); return FILES[r] ? {content: FILES[r][0], exists: true} : {content: '', exists: false}; },
  'pinkie.artifacts.list': () => ({ok: true, items: ART, cursor: null}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__l35Shots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function l35Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      (window.__l35ShotsRpc ||= []).push(f.method + ' ' + ((f.params || {}).sessionKey || (f.params || {}).path || ''));
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__l35Shots = true;
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
const state = (page) => page.evaluate(() => {
  const w = window.__pinkieWorkbench;
  return {visible: Boolean(w?.state?.visible), active: w?.state?.active || '', tabs: (w?.state?.tabs || []).map((x) => [x.path, x.kind]),
    rows: [...document.querySelectorAll('.pk-mout__row')].map((r) => [r.dataset.path, r.querySelector('.pk-mout__when')?.textContent || '']),
    status: document.querySelector('.pk-mout__status')?.textContent || '', rpc: window.__l35ShotsRpc || []};
});

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    // 场景 metre-board 会先打开总谱（占右侧）；关掉它，拍对话区和工作台。
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    const shown = await page.evaluate(() => window.__pinkieWorkbench?.show?.()).catch(() => false);
    await page.waitForFunction(() => document.querySelector('.pk-mout__status'), null, {timeout: 15_000}).catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, 'l35-status', theme, width, {mode, shown: Boolean(shown)});
    report.push({theme, width, step: 'status', mode, shown, ...(await state(page))});

    await page.locator('.pk-mout__status').first().click({timeout: 5000}).catch((error) => console.log('[l35] 点状态栏失败：' + error.message.split('\n')[0]));
    const listed = await page.waitForFunction(() => document.querySelectorAll('.pk-mout__row').length >= 3, null, {timeout: 15_000}).then(() => true, () => false);
    await page.waitForTimeout(400);
    await shot(page, 'l35-page', theme, width, {listed});
    report.push({theme, width, step: 'page', listed, ...(await state(page))});

    await page.locator('.pk-mout__row[data-path="/proj/README.md"] .pk-mout__name').first().click({timeout: 5000}).catch(() => {});
    const diffed = await page.waitForFunction(() => (window.__pinkieWorkbench?.state?.tabs || []).some((x) => x.kind === 'diff'), null, {timeout: 20_000}).then(() => true, () => false);
    await page.waitForTimeout(1200);
    await shot(page, 'l35-diff', theme, width, {diffed});
    report.push({theme, width, step: 'diff', diffed, ...(await state(page)), pageErrors});
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
