#!/usr/bin/env node
// B11·project 走查 #13 工作台编辑器行号对比度的界面截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs），项目（home-project）/ 无限（home-unrestricted）× 日夜 × 1440 / 820，
// 工作台开一个 12 行的 /proj/a.js，每格拍「改后」和「改前」（页面拿到的 laolao-workbench.js 行号那一行换回 hex(c.muted, 0.7) / hex(c.accent)），
// report.json 记每个行号的字色和对它所在底色（当前行叠高亮底）的对比度。
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

const NEW_LINE = /'editorLineNumber\.foreground': [^\n]*?'editorLineNumber\.activeForeground': hex\(reach\([^\n]*?\)\),/;
const OLD_LINE = "'editorLineNumber.foreground': hex(c.muted, 0.7), 'editorLineNumber.activeForeground': hex(c.accent),";
const SCENES = {project: 'home-project', unrestricted: 'home-unrestricted'};

const initScript = new Function(`
const body = Array.from({length: 12}, (_, i) => 'const line' + (i + 1) + ' = ' + (i + 1) + ';').join(String.fromCharCode(10));
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'main', name: 'proj', bound: true, unrestricted: document.documentElement.dataset.laolaoMode === 'unrestricted'}),
  'pinkie.fs.list': () => ({entries: [{name: 'a.js', path: 'a.js', kind: 'file'}]}),
  'pinkie.fs.read': (p) => ({kind: 'text', content: body, path: p.path, readOnly: false, size: body.length, mtimeMs: 1}),
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: 'main', changes: []}),
  'pinkie.fs.gitShow': () => ({content: body, exists: true}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b11lnShots) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b11lnSend(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b11lnShots = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

const measure = () => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r, g, b, a}; };
  const over = (fg, bg) => ({r: bg.r + (fg.r - bg.r) * fg.a, g: bg.g + (fg.g - bg.g) * fg.a, b: bg.b + (fg.b - bg.b) * fg.a, a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const baseBg = (n) => { for (let e = n; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c; } return {r: 255, g: 255, b: 255, a: 1}; };
  const nums = [...document.querySelectorAll('.pk-wb-editor .monaco-editor .margin-view-overlays .line-numbers')].filter((n) => n.offsetWidth && n.textContent.trim());
  const rows = nums.map((n) => {
    let bg = baseBg(n);
    const top = n.parentElement?.style.top;
    const hl = [...(n.parentElement?.parentElement?.children || [])].filter((d) => d.style.top === top).flatMap((d) => [...d.querySelectorAll('.current-line-margin, .current-line')]);
    for (const h of hl) { const c = parse(getComputedStyle(h).backgroundColor); if (c && c.a > 0) bg = over(c, bg); }
    const fg = over(parse(getComputedStyle(n).color), bg);
    return {n: n.textContent.trim(), active: n.classList.contains('active-line-number'), color: getComputedStyle(n).color, ratio: Math.round(ratio(fg, bg) * 100) / 100};
  });
  const plain = rows.filter((r) => !r.active).map((r) => r.ratio);
  return {mode: document.documentElement.dataset.laolaoMode, rows, min: plain.length ? Math.min(...plain) : null, max: plain.length ? Math.max(...plain) : null, active: rows.find((r) => r.active)?.ratio ?? null};
};

const HEIGHT = 900;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

async function cell(mode, theme, width, before) {
  const tag = `b11-ln-${mode}-${width}-${theme}-${before ? 'before' : 'after'}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, SCENES[mode], theme, {initScript});
  let swapped = 0;
  try {
    if (before) {
      await context.route(/laolao-workbench\.js(\?|$)/, async (route) => {
        const res = await route.fetch();
        const text = (await res.text()).replace(NEW_LINE, () => { swapped++; return OLD_LINE; });
        await route.fulfill({response: res, body: text});
      });
      await page.reload();
    }
    await page.setViewportSize({width, height: HEIGHT});
    await page.evaluate(() => window.__pinkieWorkbench?.show?.());
    await page.evaluate(() => window.__pinkieWorkbench.open('/proj/a.js', {pinned: true}));
    await page.waitForFunction(() => document.querySelectorAll('.pk-wb-editor .monaco-editor .line-numbers').length >= 10, null, {timeout: 20_000}).catch(() => {});
    await page.waitForTimeout(500);
    const m = await page.evaluate(measure);
    const file = `${tag}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name: tag, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), min: m.min, max: m.max, active: m.active});
    report.push({tag, mode, theme, width, before, swapped, ...m, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const mode of Object.keys(SCENES)) for (const theme of ['day', 'night']) for (const width of [1440, 820]) {
    await cell(mode, theme, width, false);
    await cell(mode, theme, width, true);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
