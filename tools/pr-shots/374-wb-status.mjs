#!/usr/bin/env node
// #374（backlog B50）工作台状态栏右半边整项藏的界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），工作台开 README.md，pinkie.fs.* 在页里接到小项目 /proj（照 254-wb-diff-tabs.mjs）。
//   b50-metre-<宽>-<日夜>-<短|长>   Metre（有 PR 项）× 1440 / 1280 / 820 × 日夜 × 短 / 长分支名
//   b50-project-1440-<日夜>-长      碧琪项目（没有 PR 项）
// 每张记右半边每项的露出宽 / 完整宽、哪些藏了、有没有半截（cut 应为空）。
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
const LONG = 'feat/metre-ui4-r5-turn-readonly';
const NAMES = ['README.md', 'package.json', 'src/app.js'];
const initScript = new Function(`
const NAMES = ${JSON.stringify(NAMES)};
const rel = (p) => { const s = String(p || ''); return s.startsWith('/proj/') ? s.slice(6) : s === '/proj' ? '' : s; };
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => { const d = rel(p.path); const kids = new Map();
    for (const n of NAMES) { if (d && !n.startsWith(d + '/')) continue; const rest = d ? n.slice(d.length + 1) : n; const head = rest.split('/')[0];
      kids.set(head, {name: head, path: d ? d + '/' + head : head, kind: rest.includes('/') ? 'dir' : 'file'}); }
    return {entries: [...kids.values()]}; },
  'pinkie.fs.read': (p) => { const c = ['# proj', '', 'npm run dev', ''].join(String.fromCharCode(10)); return {kind: 'text', content: c, path: p.path, readOnly: false, size: c.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: localStorage.getItem('b50Branch') || 'main', ahead: 2, behind: 1, changes: [{path: 'README.md', status: 'M'}]}),
  'pinkie.fs.gitShow': () => ({content: '# proj' + String.fromCharCode(10), exists: true}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b50) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b50Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b50 = true;
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
  const right = document.querySelector('.pk-wb-status > .pk-wb-status__side:last-child'); if (!right) return null;
  const s = right.getBoundingClientRect();
  const items = [...right.children].map((n) => { const r = n.getBoundingClientRect(); const vis = Math.max(0, Math.min(r.right, s.right) - Math.max(r.left, s.left));
    return {opt: n.dataset.opt || (n.classList.contains('pk-wb-status__pinkie') ? 'pinkie' : ''), text: (n.textContent || '').trim().slice(0, 24), hidden: getComputedStyle(n).display === 'none', w: Math.round(r.width), visW: Math.round(vis)}; });
  return {rightW: Math.round(s.width), hidden: items.filter((i) => i.hidden).map((i) => i.opt), cut: items.filter((i) => !i.hidden && i.w > 0 && i.visW < i.w - 0.5).map((i) => i.opt), items};
});

async function cell(scene, theme, width, branch) {
  const tag = `${scene === 'metre-board' ? 'metre' : 'project'}-${width}-${theme}-${branch === LONG ? '长' : '短'}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript});
  try {
    await page.evaluate((b) => localStorage.setItem('b50Branch', b), branch);
    await page.setViewportSize({width, height: HEIGHT});
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.evaluate(() => window.__pinkieWorkbench?.show?.()).catch(() => {});
    await page.evaluate(() => window.__pinkieWorkbench.open('README.md', {pinned: true}));
    await page.waitForFunction(() => window.__pinkieWorkbench.state.tabs.find((x) => x.path === 'README.md')?.kind === 'text', null, {timeout: 15_000}).catch(() => {});
    await page.waitForFunction(() => { const r = document.querySelector('.pk-wb-status > .pk-wb-status__side:last-child'); return r && ['ln', 'ai'].every((k) => r.querySelector(`:scope > [data-opt="${k}"]`)); }, null, {timeout: 15_000}).catch(() => {});
    // 诊断（uireview 22:17Z ②）：renderStatus 刚跑完和 600ms 后各量一次左半边宽、右半边宽和字体状态，看是谁在 fit 之后变了
    const probe = () => page.evaluate(() => { const s = document.querySelector('.pk-wb-status'); const [l, r] = s ? [s.firstElementChild, s.lastElementChild] : []; return {leftW: l ? Math.round(l.getBoundingClientRect().width * 10) / 10 : null, rightW: r ? Math.round(r.getBoundingClientRect().width * 10) / 10 : null, fonts: document.fonts?.status, loading: document.fonts ? [...document.fonts].filter((f) => f.status === 'loading').map((f) => f.family).slice(0, 6) : []}; });
    const t0 = await page.evaluate(() => { window.__pinkieWorkbench.renderStatus(); const s = document.querySelector('.pk-wb-status'); return {leftW: s ? Math.round(s.firstElementChild.getBoundingClientRect().width * 10) / 10 : null, rightW: s ? Math.round(s.lastElementChild.getBoundingClientRect().width * 10) / 10 : null, fonts: document.fonts?.status}; });
    await page.waitForTimeout(600);
    const t600 = await probe();
    const m = await measure(page);
    await shot(page, `b50-${tag}`, {width, ...m});
    report.push({tag, mode: await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), ...m, t0, t600, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) for (const width of [1440, 1280, 820]) for (const branch of ['main', LONG]) await cell('metre-board', theme, width, branch);
  for (const theme of ['day', 'night']) await cell('home-project', theme, 1440, LONG);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
