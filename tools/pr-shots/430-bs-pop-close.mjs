#!/usr/bin/env node
// #430（fix/metre-backstage-pop-close）Metre「后台」带子「引擎」声部弹层的 PR 截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs 的 metre-board 场景，关掉总谱）；网关请求在页里接：pinkie.engines.status 回「开着、在跑」，
// pinkie.fs.* 接到小项目 /proj（照 tools/pr-shots/374-wb-status.mjs），总谱数据里放两条外部引擎声部（Codex 失败、Kiro 等你）。
//   bs-pop-1440-<日夜>        1440 宽点「引擎」开着弹层
//   bs-pop-820-code-<日夜>    820 宽先在对话页点开弹层，再不经点击切到工作台代码页（__pinkieWorkbench.show()，B16 把带子藏起），弹层应跟着收起
// report.json 每格记：弹层开没开出来、切页后带子显不显示、窄窗 / 视图标记、页面里还剩几个 .pk-bs__pop。
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
const HEIGHT = 900;
const VOICES = [{key: 'e1', external: true, engineName: 'Codex', state: 'fail'}, {key: 'e2', external: true, engineName: 'Kiro', state: 'wait'}];
const NAMES = ['README.md', 'package.json', 'src/app.js'];

const initScript = new Function(`
const NAMES = ${JSON.stringify(NAMES)};
const rel = (p) => { const s = String(p || ''); return s.startsWith('/proj/') ? s.slice(6) : s === '/proj' ? '' : s; };
const answers = {
  'pinkie.engines.status': () => ({enabled: true, running: true}),
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => { const d = rel(p.path); const kids = new Map();
    for (const n of NAMES) { if (d && !n.startsWith(d + '/')) continue; const rest = d ? n.slice(d.length + 1) : n; const head = rest.split('/')[0];
      kids.set(head, {name: head, path: d ? d + '/' + head : head, kind: rest.includes('/') ? 'dir' : 'file'}); }
    return {entries: [...kids.values()]}; },
  'pinkie.fs.read': (p) => { const c = ['# proj', '', 'npm run dev', ''].join(String.fromCharCode(10)); return {kind: 'text', content: c, path: p.path, readOnly: false, size: c.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', ahead: 0, behind: 0, changes: []}),
  'pinkie.fs.gitShow': () => ({content: '# proj' + String.fromCharCode(10), exists: true}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__bs430) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function bs430Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__bs430 = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const shot = async (page, name, extra) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name, file, os: process.platform, browser: engine || 'chromium', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...extra});
};
const SEG = '.pk-metre-backstage:not(.pk-metre-backstage--probe) .pk-bs__seg--pop';
const state = (page) => page.evaluate(() => {
  const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)');
  const root = document.documentElement;
  return {
    pops: document.querySelectorAll('.pk-bs__pop').length,
    dialogs: document.querySelectorAll('.pk-bs__pop[role="dialog"]').length,
    band: Boolean(band && !band.hidden && getComputedStyle(band).display !== 'none'),
    wbNarrow: root.dataset.pkWbNarrow || '', wbView: root.dataset.pkWbView || '',
    popText: (document.querySelector('.pk-bs__pop')?.textContent || '').trim().slice(0, 60),
  };
});
const redraw = (page) => page.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
const feedVoices = (page) => page.evaluate((v) => {
  const prev = window.__pinkieMetreBoardData || {};
  window.__pinkieMetreBoardData = {...prev, data: {...(prev.data || {}), sessions: v}};
}, VOICES);

async function openPop(page) {
  await feedVoices(page);
  await redraw(page);
  await page.waitForSelector(SEG, {state: 'visible', timeout: 20_000});
  await feedVoices(page);
  await page.locator(SEG).first().click();
  await page.waitForSelector('.pk-bs__pop[role="dialog"]', {timeout: 5_000});
  await page.waitForTimeout(300);
}

async function cell(theme, width) {
  const tag = width === 1440 ? `bs-pop-1440-${theme}` : `bs-pop-820-code-${theme}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  const row = {tag, theme, width, pageErrors};
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.waitForTimeout(400);
    await openPop(page);
    row.opened = await state(page);
    if (width !== 1440) {
      // 不经点击切到工作台代码页（pointerdown 收起不会触发）：工作台自己的 show() 把窄窗视图设成 code
      row.shown = await page.evaluate(() => window.__pinkieWorkbench?.show?.() ?? null).catch((e) => 'show 出错：' + e.message);
      await page.waitForFunction(() => document.documentElement.dataset.pkWbView === 'code', null, {timeout: 10_000}).catch(() => {});
      await feedVoices(page);
      await redraw(page);
      await page.waitForTimeout(600);
    }
    row.after = await state(page);
    await shot(page, tag, {after: row.after});
  } catch (error) {
    row.error = error.message.split('\n')[0];
    try { row.after = await state(page); await shot(page, `${tag}-error`, {}); } catch {}
  } finally {
    report.push(row);
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) for (const width of [1440, 820]) await cell(theme, width);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) console.log(`pr-shots: ${r.tag} opened=${r.opened?.dialogs ?? '-'} band=${r.after?.band} view=${r.after?.wbView || '-'} pops=${r.after?.pops ?? '-'}${r.error ? ' 出错：' + r.error : ''}`);
