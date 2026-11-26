#!/usr/bin/env node
// #218（R5 ① Metre 回答下面「文件」签条，在工作台打开 / 看改动）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；聊天历史用 __fakeSeedHistory 种一轮读 / 改文件，
// pinkie.fs.* 在页面里接到一个小项目（/proj，git 仓库），不碰用户会话。每格（1440 / 820 × 日夜）拍：
//   r5-chips  回答下面的「文件」一行（app.js 改动、hosts 打开、README.md 改动）
//   r5-open   点「hosts」以后：工作台出来、标签开着（项目外，后端答 readOnly）
//   r5-diff   点「README.md 改动」以后：差异视图（上次提交 ↔ 现在）
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
  {role: 'user', content: t('看看 src/app.js 和 hosts，再把 README 里的启动命令改成 npm run dev'), timestamp: 1},
  {role: 'assistant', stopReason: 'toolUse', content: [call('r1', 'read', {path: '/proj/src/app.js'}), call('r2', 'read', {file_path: '/etc/hosts'})], timestamp: 2},
  {role: 'toolResult', toolCallId: 'r1', toolName: 'read', content: t('export const port = 5173;'), timestamp: 3},
  {role: 'toolResult', toolCallId: 'r2', toolName: 'read', content: t('127.0.0.1 localhost'), timestamp: 4},
  {role: 'assistant', stopReason: 'toolUse', content: [call('w1', 'edit', {path: '/proj/README.md', oldText: 'npm start', newText: 'npm run dev'}), call('w2', 'edit', {path: '/proj/src/app.js', oldText: '5173', newText: '5174'})], timestamp: 5},
  {role: 'toolResult', toolCallId: 'w1', toolName: 'edit', content: t('ok'), timestamp: 6},
  {role: 'toolResult', toolCallId: 'w2', toolName: 'edit', content: t('ok'), timestamp: 7},
  {role: 'assistant', stopReason: 'stop', content: t('看过了：app.js 端口改成 5174（5173 被占了），README 的启动命令改成 `npm run dev`，hosts 没动。'), timestamp: 8},
];
const FILES = {
  'README.md': ['# proj\n\n启动：\n\n```\nnpm start\n```\n', '# proj\n\n启动：\n\n```\nnpm run dev\n```\n'],
  'src/app.js': ['export const port = 5173;\n', 'export const port = 5174;\n'],
};
// 页面里：fake-gateway.js 赋 window.WebSocket 时接住它，pinkie.fs.* 答成一个小项目；其余照旧交给假网关。
const initScript = new Function(`window.__fakeSeedHistory = ${JSON.stringify(HISTORY)};
const FILES = ${JSON.stringify(FILES)};
const rel = (p) => String(p || '').replace(/^\\/proj\\/?/, '');
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => (rel(p.path) === '' ? {entries: [{name: 'src', path: 'src', kind: 'dir'}, {name: 'README.md', path: 'README.md', kind: 'file'}]}
    : rel(p.path) === 'src' ? {entries: [{name: 'app.js', path: 'src/app.js', kind: 'file'}]} : {entries: []}),
  'pinkie.fs.read': (p) => { const r = rel(p.path); const outside = String(p.path).startsWith('/') && !String(p.path).startsWith('/proj/');
    const content = FILES[r] ? FILES[r][1] : outside ? '127.0.0.1 localhost\\n::1 localhost\\n' : '';
    return {kind: 'text', content, path: p.path, readOnly: outside, size: content.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: [{path: 'README.md', status: 'M'}, {path: 'src/app.js', status: 'M'}]}),
  'pinkie.fs.gitShow': (p) => { const r = rel(p.path); return FILES[r] ? {content: FILES[r][0], exists: true} : {content: '', exists: false}; },
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__r5Shots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function r5Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      (window.__r5ShotsRpc ||= []).push(f.method + ' ' + ((f.params || {}).path || ''));
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__r5Shots = true;
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
const benchState = (page) => page.evaluate(() => {
  const w = window.__pinkieWorkbench;
  return {visible: Boolean(w?.state?.visible), tabs: (w?.state?.tabs || []).map((x) => [x.path, x.kind, Boolean(x.readOnly)]), rpc: window.__r5ShotsRpc || []};
});

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    // 场景 metre-board 会先打开总谱（占右侧）；关掉它，拍对话区和工作台。
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    const chips = await page.waitForFunction(() => document.querySelectorAll('.pk-mfile-row .pk-mfile-chip').length >= 3, null, {timeout: 15_000})
      .then(() => page.locator('.pk-mfile-chip').evaluateAll((l) => l.map((b) => [b.textContent, b.dataset.action])), () => []);
    await page.evaluate(() => document.querySelector('.pk-mfile-row')?.scrollIntoView({block: 'center'}));
    await page.waitForTimeout(300);
    await shot(page, 'r5-chips', theme, width, {mode, chips: chips.length});
    report.push({theme, width, step: 'chips', mode, chips});

    await page.locator('.pk-mfile-chip[data-action="open"]').first().click({timeout: 5000}).catch(() => {});
    const opened = await page.waitForFunction(() => (window.__pinkieWorkbench?.state?.tabs || []).some((x) => x.path === '/etc/hosts' && x.kind === 'text'), null, {timeout: 15_000})
      .then(() => true, () => false);
    await page.waitForTimeout(800);
    await shot(page, 'r5-open', theme, width, {opened});
    report.push({theme, width, step: 'open', opened, ...(await benchState(page))});

    // 820 时工作台是紧凑的「代码 / 对话」两页，打开以后停在代码页、盖住对话；照用户的做法先切回对话再点下一个签条。
    const narrow = await page.evaluate(() => 'pkWbNarrow' in document.documentElement.dataset);
    if (narrow) { await page.getByRole('button', {name: '对话', exact: true}).first().click({timeout: 5000}).catch(() => {}); await page.waitForTimeout(400); }
    await page.locator('.pk-mfile-chip[data-path="/proj/README.md"]').first().click({timeout: 5000}).catch(() => {});
    const diffed = await page.waitForFunction(() => (window.__pinkieWorkbench?.state?.tabs || []).some((x) => x.kind === 'diff'), null, {timeout: 20_000})
      .then(() => true, () => false);
    await page.waitForTimeout(1200);
    await shot(page, 'r5-diff', theme, width, {diffed});
    report.push({theme, width, step: 'diff', diffed, ...(await benchState(page)), pageErrors});
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
