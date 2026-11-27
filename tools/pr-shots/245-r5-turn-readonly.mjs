#!/usr/bin/env node
// #245（R5 ② 回合中 Metre 在改的文件，工作台里临时只读；回合结束放开并按磁盘重读）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 假项目、聊天历史、pinkie.fs.* 接法和 218-r5-open-chip.mjs 相同（/proj，git 仓库，不碰用户会话）；另加 window.__r5bDisk：
// 设了以后 README.md 按它读、mtime 变新，代表 Metre 这一轮写进磁盘的内容。事件走真实的 pinkie:gateway-event（和 tests/metre-files.test.mjs 同一种）。
// 每格（1440 × 日夜）拍：
//   r5b-hold   工作台打开 README.md，Metre 的 edit 工具开始以后：标签带锁、顶上说明、打字无效
//   r5b-after  这一轮结束（lifecycle end）以后：锁和说明拿掉，内容换成 Metre 写进磁盘的版本
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
    const content = (window.__r5bDisk && r === 'README.md') ? window.__r5bDisk : FILES[r] ? FILES[r][1] : outside ? '127.0.0.1 localhost\\n::1 localhost\\n' : '';
    return {kind: 'text', content, path: p.path, readOnly: outside, size: content.length, mtimeMs: (window.__r5bDisk && r === 'README.md') ? 2 : 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: (window.__r5bDisk && rel(x) === 'README.md') ? 2 : 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: [{path: 'README.md', status: 'M'}, {path: 'src/app.js', status: 'M'}]}),
  'pinkie.fs.gitShow': (p) => { const r = rel(p.path); return FILES[r] ? {content: FILES[r][0], exists: true} : {content: '', exists: false}; },
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__r5bShots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function r5bSend(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      (window.__r5ShotsRpc ||= []).push(f.method + ' ' + ((f.params || {}).path || ''));
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__r5bShots = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

const HEIGHT = 900;
const AFTER = '# proj\n\n启动：\n\n\`\`\`\nnpm run dev\n\`\`\`\n\n端口：5174（Metre 这一轮写的）\n';
const HOLD = 'Metre 正在改这个文件，这一轮结束后可以编辑';
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
const gw = (page, payload) => page.evaluate((p) => window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: 'agent', payload: p}})), payload);
const state = (page) => page.evaluate(() => {
  const w = window.__pinkieWorkbench; const t = (w?.state?.tabs || []).find((x) => x.path === 'README.md');
  const notice = document.querySelector('.pk-wb-notice:not([hidden]) .pk-wb-notice__text');
  return {visible: Boolean(w?.state?.visible), active: w?.state?.active, held: [...(w?.held?.keys?.() || [])], lock: Boolean(document.querySelector('.pk-wb-tab__readonly')),
    notice: notice ? notice.textContent : '', content: t?.model?.getValue?.() ?? null};
});
const typeZ = async (page) => {
  await page.locator('.monaco-editor .view-lines').first().click({timeout: 5000}).catch(() => {});
  await page.keyboard.press('End'); await page.keyboard.type('Z');
  return page.evaluate(() => (window.__pinkieWorkbench.state.tabs.find((x) => x.path === 'README.md')?.model?.getValue?.() || '').endsWith('Z'));
};

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    const shown = await page.evaluate(() => window.__pinkieWorkbench?.show?.());
    await page.evaluate(() => window.__pinkieWorkbench.open('README.md', {pinned: true}));
    await page.waitForFunction(() => window.__pinkieWorkbench.state.tabs.find((x) => x.path === 'README.md')?.kind === 'text', null, {timeout: 15_000}).catch(() => {});
    // Metre 这一轮的 edit 工具开始（不带 sessionKey = 当前会话）
    await gw(page, {runId: 'r5b', stream: 'tool', data: {phase: 'start', name: 'edit', toolCallId: 'w1', args: {path: '/proj/README.md'}}});
    const held = await page.waitForFunction(() => document.querySelector('.pk-wb-tab__readonly'), null, {timeout: 10_000}).then(() => true, () => false);
    const typed = await typeZ(page);
    await page.waitForTimeout(600);
    const hold = await state(page);
    await shot(page, 'r5b-hold', theme, width, {held, typed});
    report.push({theme, width, step: 'hold', mode, shown, held, typedWhileHeld: typed, noteMatches: hold.notice.includes(HOLD), ...hold});

    // 这一轮结束：磁盘上是 Metre 写的版本
    await page.evaluate((c) => { window.__r5bDisk = c; }, AFTER);
    await gw(page, {runId: 'r5b', stream: 'lifecycle', data: {phase: 'end'}});
    const reread = await page.waitForFunction((c) => window.__pinkieWorkbench.state.tabs.find((x) => x.path === 'README.md')?.model?.getValue?.() === c, AFTER, {timeout: 10_000}).then(() => true, () => false);
    const unlocked = await page.waitForFunction(() => !document.querySelector('.pk-wb-tab__readonly'), null, {timeout: 5000}).then(() => true, () => false);
    await page.waitForTimeout(800);
    const after = await state(page);
    await shot(page, 'r5b-after', theme, width, {reread, unlocked});
    report.push({theme, width, step: 'after', reread, unlocked, ...after, rpc: await page.evaluate(() => window.__r5ShotsRpc || []), pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) await cell(theme, 1440);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
const bad = report.filter((r) => (r.step === 'hold' && (!r.held || r.typedWhileHeld || !r.noteMatches)) || (r.step === 'after' && (!r.reread || !r.unlocked || r.notice)));
console.log(`pr-shots: ${lines.length} 张 → ${out}${bad.length ? '；不符合预期 ' + bad.length + ' 格，见 report.json' : ''}`);
if (bad.length) process.exitCode = 1;
