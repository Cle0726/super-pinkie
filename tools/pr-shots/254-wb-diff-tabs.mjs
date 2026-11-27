#!/usr/bin/env node
// #254（backlog B30）工作台差异标签 + 标签栏溢出提示的界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），Metre（metre-board）和碧琪项目（home-project）两种模式 × 1440 / 820 × 日夜。
// pinkie.fs.* 在页面里接到一个小项目（/proj，git 仓库），照 218-r5-open-chip.mjs 的做法。每格拍：
//   b30-diff   只开 README.md 的差异：标签是「README.md」+ 灰色「上次提交 ↔ 现在」，不溢出，没有「全部标签」键
//   b30-many   再开 10 个文件：标签栏溢出，右端淡出，露出「全部标签」键
//   b30-menu   点「全部标签」：列出所有标签，当前那个打勾
//   b30-mid    标签栏滚到中间：两头都淡出
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

const NAMES = ['README.md', 'package.json', 'src/app.js', 'src/router.js', 'src/store.js', 'src/views/home.vue', 'src/views/settings.vue', 'src/api/client.js', 'src/util/format.js', 'tests/app.test.js', 'vite.config.js'];
const initScript = new Function(`
const NAMES = ${JSON.stringify(NAMES)};
const rel = (p) => String(p || '').replace(/^\\/proj\\/?/, '');
const body = (r, old) => r === 'README.md' ? (old ? '# proj\\n\\nnpm start\\n' : '# proj\\n\\nnpm run dev\\n') : '// ' + r + '\\nexport default {};\\n';
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: document.documentElement.dataset.laolaoMode === 'metre' ? 'metre' : 'main', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => { const d = rel(p.path); const kids = new Map();
    for (const n of NAMES) { if (d && !n.startsWith(d + '/')) continue; const rest = d ? n.slice(d.length + 1) : n; const head = rest.split('/')[0];
      kids.set(head, {name: head, path: d ? d + '/' + head : head, kind: rest.includes('/') ? 'dir' : 'file'}); }
    return {entries: [...kids.values()]}; },
  'pinkie.fs.read': (p) => { const c = body(rel(p.path), false); return {kind: 'text', content: c, path: p.path, readOnly: false, size: c.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: [{path: 'README.md', status: 'M'}]}),
  'pinkie.fs.gitShow': (p) => ({content: body(rel(p.path), true), exists: true}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b30Shots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b30Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b30Shots = true;
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
// 量标签栏：溢出与否、两头淡出、「全部标签」键、差异标签里文件名 / 说明是不是被截（scrollWidth > clientWidth）
const measure = (page) => page.evaluate(() => {
  const list = document.querySelector('.pk-wb-tabs__list'), more = document.querySelector('.pk-wb-tabs__more');
  const diff = document.querySelector('.pk-wb-tab.is-diff');
  const cut = (n) => (n ? n.scrollWidth > n.clientWidth + 1 : null);
  const label = diff?.querySelector('.pk-wb-tab__label'), vs = diff?.querySelector('.pk-wb-tab__vs');
  return {tabs: document.querySelectorAll('.pk-wb-tab').length, over: list ? list.scrollWidth - list.clientWidth : null, clipStart: list?.classList.contains('is-clip-start'), clipEnd: list?.classList.contains('is-clip-end'),
    more: Boolean(more && !more.hidden && more.getBoundingClientRect().width > 0), diffLabel: label?.textContent, diffVs: vs?.textContent, labelCut: cut(label), vsCut: cut(vs), title: diff?.title,
    menu: [...document.querySelectorAll('.pk-wb-menu:not([hidden]) .pk-wb-menu__item')].map((b) => b.textContent)};
});

async function cell(scene, theme, width) {
  const tag = `${scene === 'metre-board' ? 'metre' : 'project'}-${width}-${theme}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    const shown = await page.evaluate(() => window.__pinkieWorkbench?.show?.()).catch(() => false);
    await page.evaluate(() => window.__pinkieWorkbench.diff('/proj/README.md'));
    await page.waitForFunction(() => document.querySelector('.pk-wb-tab.is-diff'), null, {timeout: 15_000}).catch(() => {});
    await page.waitForTimeout(600);
    let m = await measure(page);
    await shot(page, `b30-diff-${tag}`, {width, shown, ...m});
    report.push({tag, step: 'diff', shown, ...m});

    for (const n of ['package.json', 'src/app.js', 'src/router.js', 'src/store.js', 'src/views/home.vue', 'src/views/settings.vue', 'src/api/client.js', 'src/util/format.js', 'tests/app.test.js', 'vite.config.js']) {
      await page.evaluate((p) => window.__pinkieWorkbench.open(p, {pinned: true}), '/proj/' + n);
    }
    // 回到差异标签（最左），这样右边溢出
    await page.locator('.pk-wb-tab.is-diff').click({timeout: 5000}).catch(() => {});
    await page.evaluate(() => { const l = document.querySelector('.pk-wb-tabs__list'); if (l) l.scrollLeft = 0; });
    await page.waitForTimeout(500);
    m = await measure(page);
    await shot(page, `b30-many-${tag}`, {width, ...m});
    report.push({tag, step: 'many', ...m});

    await page.locator('.pk-wb-tabs__more').click({timeout: 5000}).catch(() => {});
    await page.waitForTimeout(300);
    m = await measure(page);
    await shot(page, `b30-menu-${tag}`, {width, ...m});
    report.push({tag, step: 'menu', ...m});
    await page.keyboard.press('Escape');

    await page.evaluate(() => { const l = document.querySelector('.pk-wb-tabs__list'); if (l) l.scrollLeft = (l.scrollWidth - l.clientWidth) / 2; });
    await page.waitForTimeout(400);
    m = await measure(page);
    await shot(page, `b30-mid-${tag}`, {width, ...m});
    report.push({tag, step: 'mid', ...m, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const scene of ['metre-board', 'home-project']) {
    for (const theme of ['day', 'night']) {
      for (const width of [1440, 820]) await cell(scene, theme, width);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
