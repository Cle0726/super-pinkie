#!/usr/bin/env node
// #409 B63：作品库预览关掉后焦点回到「在工作台打开」键。给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式，560 宽（工作台出不来，走只读预览），日夜各一组。
// 作品库查看器是真的（window.PinkieArtifacts.openViewer），RPC 接到页面里的小项目（/proj），照 tools/pr-shots/r5-library-open.mjs。
// 「WebKit 鼠标点按钮不给焦点」用脚本 click() 复现（任何引擎上都不挪焦点）：先 blur，再点键。拍：
//   b63-preview  点开后的只读预览
//   b63-esc      Esc 关掉后：焦点应在键上（report.json 里 focusOnKey / focusVisible）
//   b63-close    × 关掉后：同上
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

const TEXT = '# 周报\n\n- 整理上周没做完的事\n- 这周要注意的安排\n';
const ITEM = {id: 'a1', path: '/proj/notes/weekly.md', kind: 'doc', title: 'weekly.md', sessionKey: 'agent:metre:dashboard:preview1', mode: 'metre',
  exists: true, total: 1, createdAt: 1, updatedAt: 1, versions: [{v: 1, size: TEXT.length, at: 1, snapshot: true}]};
const initScript = new Function(`
const ITEM = ${JSON.stringify(ITEM)}; const TEXT = ${JSON.stringify(TEXT)};
const answers = {
  'pinkie.artifacts.get': () => ({ok: true, item: ITEM}),
  'pinkie.artifacts.read': () => ({ok: true, data: TEXT, mime: 'text/markdown', encoding: 'utf8', size: TEXT.length}),
  'pinkie.artifacts.list': () => ({ok: true, items: [], cursor: null}),
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': () => ({entries: []}),
  'pinkie.fs.read': (p) => ({kind: 'text', content: TEXT, path: p.path, readOnly: true, truncated: false, size: TEXT.length, mtimeMs: 1}),
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: false}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b63Shots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b63Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b63Shots = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

const WIDTH = 560;
const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const shot = async (page, name, theme, extra = {}) => {
  const file = `${name}-${WIDTH}-${theme}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name: `${name}-${WIDTH}-${theme}`, file, os: process.platform, browser: engine || 'chromium', width: WIDTH, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};
const focus = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return {focusOnKey: Boolean(a?.classList?.contains('pk-mlib-open')), focusVisible: Boolean(a?.matches?.(':focus-visible')),
    active: a ? a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).split(/\s+/).join('.') : '') : null,
    preview: Boolean(document.querySelector('.pk-mlib-preview')), viewer: Boolean(document.querySelector('.pinkie-art-viewer'))};
});
// 脚本 click()：不挪焦点，等于 WebKit 鼠标点按钮
const clickWithoutFocus = (page) => page.evaluate(() => { document.activeElement?.blur?.(); document.querySelector('.pk-mlib-open').click(); });
const waitPreview = (page) => page.waitForFunction(() => document.querySelector('.pk-mlib-preview__text'), null, {timeout: 15_000}).then(() => true, () => false);
const waitClosed = (page) => page.waitForFunction(() => !document.querySelector('.pk-mlib-preview'), null, {timeout: 5000}).then(() => true, () => false);

async function cell(theme) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    await page.evaluate(() => window.PinkieArtifacts?.openViewer?.('a1'));
    const keyed = await page.waitForFunction(() => document.querySelector('.pk-mlib-open'), null, {timeout: 15_000}).then(() => true, () => false);
    if (!keyed) { report.push({theme, mode, keyed, pageErrors}); return; }

    await clickWithoutFocus(page);
    const shown = await waitPreview(page);
    await page.waitForTimeout(400);
    await shot(page, 'b63-preview', theme, {mode, shown});
    report.push({theme, step: 'preview', mode, shown, ...(await focus(page))});

    await page.keyboard.press('Escape');
    const escClosed = await waitClosed(page);
    await page.waitForTimeout(300);
    const esc = await focus(page);
    await shot(page, 'b63-esc', theme, {closed: escClosed, ...esc});
    report.push({theme, step: 'esc', closed: escClosed, ...esc});

    await clickWithoutFocus(page);
    await waitPreview(page);
    await page.evaluate(() => document.querySelector('.pk-mlib-preview__close')?.click());
    const xClosed = await waitClosed(page);
    await page.waitForTimeout(300);
    const x = await focus(page);
    await shot(page, 'b63-close', theme, {closed: xClosed, ...x});
    report.push({theme, step: 'close', closed: xClosed, ...x, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) await cell(theme);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
