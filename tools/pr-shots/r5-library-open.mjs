#!/usr/bin/env node
// R5 ③（作品库「在工作台打开」+ 工作台不在时的只读预览面板）界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre 模式；作品库查看器是真的（window.PinkieArtifacts.openViewer），
// pinkie.artifacts.get / read 和 pinkie.fs.* 在页面里接到一个小项目（/proj），不碰用户会话。拍：
//   r5l-viewer   1440 / 820 × 日夜：查看器停在旧版本，键上写「打开当前文件（作品库里看的是第 1 版）」
//   r5l-bench    1440 / 820 × 日夜：点键以后工作台出来、标签开着、查看器收起
//   r5l-preview  560 × 日夜：工作台出不来，开只读预览面板（截到前 256 KB，有说明）
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

const V1 = '# 周报\n\n- 整理上周没做完的事\n';
const V2 = '# 周报\n\n- 整理上周没做完的事\n- 这周要注意的安排\n- 端口改成 5174\n';
const ITEM = {id: 'a1', path: '/proj/notes/weekly.md', kind: 'doc', title: 'weekly.md', sessionKey: 'agent:metre:dashboard:preview1', mode: 'metre',
  exists: true, total: 2, createdAt: 1, updatedAt: 2, versions: [{v: 1, size: V1.length, at: 1, snapshot: true}, {v: 2, size: V2.length, at: 2, snapshot: true}]};
const initScript = new Function(`
const ITEM = ${JSON.stringify(ITEM)}; const V = {1: ${JSON.stringify(V1)}, 2: ${JSON.stringify(V2)}};
const rel = (p) => String(p || '').replace(/^\\/proj\\/?/, '');
const answers = {
  'pinkie.artifacts.get': () => ({ok: true, item: ITEM}),
  'pinkie.artifacts.read': (p) => ({ok: true, data: V[p.v || 2] || V[2], mime: 'text/markdown', encoding: 'utf8', size: (V[p.v || 2] || V[2]).length}),
  'pinkie.artifacts.list': () => ({ok: true, items: [], cursor: null}),
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => (rel(p.path) === '' ? {entries: [{name: 'notes', path: 'notes', kind: 'dir'}]}
    : rel(p.path) === 'notes' ? {entries: [{name: 'weekly.md', path: 'notes/weekly.md', kind: 'file'}]} : {entries: []}),
  // 预览面板带 maxBytes：照后端的样子只回开头、标 truncated、只读
  'pinkie.fs.read': (p) => p.maxBytes ? {kind: 'text', content: V[2], path: p.path, readOnly: true, truncated: true, size: 900000, mtimeMs: 1}
    : {kind: 'text', content: V[2], path: p.path, readOnly: false, size: V[2].length, mtimeMs: 1},
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: false}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__r5lShots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function r5lSend(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      const p = f.params || {};
      (window.__r5lShotsRpc ||= []).push(f.method + ' ' + (p.path || p.id || '') + (p.maxBytes ? ' max=' + p.maxBytes : ''));
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](p)}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__r5lShots = true;
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
  return {visible: Boolean(w?.state?.visible), tabs: (w?.state?.tabs || []).map((x) => [x.path, x.kind, Boolean(x.readOnly)]),
    viewer: Boolean(document.querySelector('.pinkie-art-viewer')), preview: Boolean(document.querySelector('.pk-mlib-preview')),
    key: document.querySelector('.pk-mlib-open')?.textContent || null, note: document.querySelector('.pk-mlib-preview__note')?.textContent || null,
    // 查看器头部挤不挤：× 在不在纸面里；带键和临时拿掉键各量一次，分清是键挤出去的还是本来就挤
    head: (() => {
      const view = document.querySelector('.pinkie-art-view'); const head = view?.querySelector('.pinkie-art-view__head'); if (!head) return null;
      const measure = () => { const x = head.querySelector('.pinkie-art-close')?.getBoundingClientRect(); const v = view.getBoundingClientRect();
        return {scroll: head.scrollWidth, client: head.clientWidth, closeRight: x ? Math.round(x.right) : null, viewRight: Math.round(v.right), closeInside: Boolean(x && x.right <= v.right + 0.5 && x.width > 0)}; };
      const withKey = measure(); const strip = view.querySelector('.pk-mlib-strip'); if (!strip) return {withKey};
      const k = strip.querySelector('.pk-mlib-open').getBoundingClientRect(); withKey.keyOnScreen = k.width > 0 && k.right <= innerWidth && k.left >= 0;
      const next = strip.nextSibling; const parent = strip.parentNode; strip.remove(); const withoutKey = measure(); parent.insertBefore(strip, next);
      return {withKey, withoutKey};
    })(),
    rpc: window.__r5lShotsRpc || []};
});

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode'));
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForFunction(() => !document.querySelector('.pk-metre-board:not([hidden])'), null, {timeout: 5000}).catch(() => {});
    // 停在旧版本（第 1 版）打开真查看器
    await page.evaluate(() => window.PinkieArtifacts?.openViewer?.('a1', {v: 1}));
    const keyed = await page.waitForFunction(() => document.querySelector('.pk-mlib-open'), null, {timeout: 15_000}).then(() => true, () => false);
    await page.waitForTimeout(600);
    const narrowPreview = width < 600;
    await shot(page, 'r5l-viewer', theme, width, {mode, keyed});
    report.push({theme, width, step: 'viewer', mode, keyed, ...(await state(page))});

    await page.locator('.pk-mlib-open').first().click({timeout: 5000}).catch((error) => console.log('[r5l] 点键失败：' + error.message.split('\n')[0]));
    if (narrowPreview) {
      const shown = await page.waitForFunction(() => document.querySelector('.pk-mlib-preview__text'), null, {timeout: 15_000}).then(() => true, () => false);
      await page.waitForTimeout(400);
      await shot(page, 'r5l-preview', theme, width, {shown});
      report.push({theme, width, step: 'preview', shown, ...(await state(page)), pageErrors});
    } else {
      const opened = await page.waitForFunction(() => (window.__pinkieWorkbench?.state?.tabs || []).some((x) => /weekly\.md$/.test(x.path) && x.kind === 'text')
        && !document.querySelector('.pinkie-art-viewer'), null, {timeout: 15_000}).then(() => true, () => false);
      await page.waitForTimeout(800);
      await shot(page, 'r5l-bench', theme, width, {opened});
      report.push({theme, width, step: 'bench', opened, ...(await state(page)), pageErrors});
    }
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820, 560]) await cell(theme, width);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
