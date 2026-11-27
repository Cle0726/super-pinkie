#!/usr/bin/env node
// B11 learning.md:51 复测：夜间三组 svg 图标的真墨色对比度。
// 约定照 tools/pr-shots/minimal.mjs：node tools/pr-shots/b11-night-svg-audit.mjs --out <目录>，写 PNG + shots.jsonl + report.json。
// 页面：home-learning / home-chat / home-thinking 首页，study-desk 学习台各页；1440 / 820 × 夜（PINKIE_SVG_THEMES=day,night 可加日间）。
// 每页两份读数：
//   probe  —— 每个命中选择器的 svg 都量一遍（不管过没过线），取色同走查脚本 inkOf：只看子图形，stroke / fill 各按自身 opacity
//             和到 svg 之间各层 opacity 叠出实际墨色，跳过 none / url()，取最好的一笔；底色同走查脚本 bgOf。
//   walk   —— 直接跑 b11-learning-walkthrough.mjs 自己的 measure()，挑出这三组选择器的 ui 报项（应为空）。
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
const HEIGHT = 800;
const THEMES = String(process.env.PINKIE_SVG_THEMES || 'night').split(',').map((t) => t.trim()).filter((t) => t === 'day' || t === 'night');
const DESK_VIEWS = ['today', 'board', 'library', 'notes', 'vocab', 'drill', 'gamepractice', 'chat'];
const TARGETS = {
  ring: '.laolao-context-viewer summary svg',
  glyph: '.pkg-glyph svg',
  nib: '.pk-drill-nib svg',
};
const WALK_RE = /laolao-context-viewer|pkg-glyph|pk-drill-nib/;

const walkSrc = fs.readFileSync(path.join(repoRoot, 'tools/pr-shots/b11-learning-walkthrough.mjs'), 'utf8');
const from = walkSrc.indexOf('function measure() {'), to = walkSrc.indexOf('\n}\n', from);
if (from < 0 || to < 0) throw new Error('走查脚本里找不到 measure()');
const MEASURE = `(${walkSrc.slice(from, to + 2)})()`;

function probe(targets) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const P = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return {r: d[0], g: d[1], b: d[2], a: d[3] / 255}; };
  const L = ({r, g, b}) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const ratio = (a, b) => { const x = L(a), y = L(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
  const hex = (c) => `rgb(${[c.r, c.g, c.b].map((x) => Math.round(x)).join(',')})`;
  const bgOf = (e) => {
    const stack = []; let approx = false;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      const s = getComputedStyle(x), c = P(s.backgroundColor);
      if (s.backgroundImage && s.backgroundImage !== 'none') approx = true;
      if (c.a > 0) stack.push(c);
      if (c.a >= 1) break;
    }
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (const c of stack.reverse()) base = over(c, base);
    return {bg: base, approx};
  };
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return null;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden') return null; }
    return r;
  };
  const rows = [];
  for (const [key, selector] of Object.entries(targets)) {
    for (const svg of document.querySelectorAll(selector)) {
      const r = visible(svg); if (!r) continue;
      const {bg, approx} = bgOf(svg.parentElement);
      const paints = [];
      for (const g of svg.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon,text')) {
        const gs = getComputedStyle(g);
        if (gs.display === 'none' || gs.visibility === 'hidden') continue;
        let op = 1;
        for (let x = g; x && x !== svg; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
        for (const [what, paint, alpha, on] of [['stroke', gs.stroke, gs.strokeOpacity, parseFloat(gs.strokeWidth) > 0], ['fill', gs.fill, gs.fillOpacity, g.tagName !== 'line']]) {
          if (!on || !paint || paint === 'none' || /^url\(/.test(paint)) continue;
          const c = P(paint), a = c.a * Number(alpha) * op;
          if (a <= 0) continue;
          const fg = over({...c, a}, bg);
          paints.push({what, cls: g.getAttribute('class') || g.tagName, k: ratio(fg, bg), fg: hex(fg), a: +a.toFixed(2)});
        }
      }
      paints.sort((x, y) => y.k - x.k);
      const host = svg.closest('[data-kind]');
      rows.push({key, kind: host?.dataset.kind || '', best: paints[0]?.k ?? null, fg: paints[0]?.fg || '', bg: hex(bg), approx, paints: paints.slice(0, 4), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width)});
    }
  }
  return {rows, night: document.documentElement.hasAttribute('data-pinkie-night'), mode: document.documentElement.dataset.laolaoMode || ''};
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine() || 'chromium';
const report = [];
const lines = [];

const shoot = async (page, pageErrors, name) => {
  const row = {name, rows: [], walk: []};
  try {
    const file = `${name}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name, file, os: process.platform, browser: engine, width: page.viewportSize().width, height: HEIGHT, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
    Object.assign(row, await page.evaluate(probe, TARGETS));
    const walk = await page.evaluate(MEASURE);
    row.walk = (walk.issues?.ui || []).filter((i) => i.kind === 'icon' && WALK_RE.test(i.sel || ''));
  } catch (error) {
    row.error = String(error?.message || error).slice(0, 300);
  }
  row.pageErrors = pageErrors.slice(0, 5);
  report.push(row);
};

async function openScene(scene, theme, width) {
  const opened = await H.openRealScenePage(browser, server.origin, scene, theme, {timezoneId: 'Asia/Shanghai'});
  await opened.page.setViewportSize({width, height: HEIGHT});
  await opened.page.waitForTimeout(500);
  return opened;
}

try {
  for (const theme of THEMES) {
    for (const width of [1440, 820]) {
      for (const scene of ['home-learning', 'home-chat', 'home-thinking']) {
        let opened;
        try {
          opened = await openScene(scene, theme, width);
          await shoot(opened.page, opened.pageErrors, `${scene}-${width}-${theme}`);
        } catch (error) {
          report.push({name: `${scene}-${width}-${theme}`, error: String(error?.message || error).slice(0, 300)});
        } finally {
          await opened?.context.close();
        }
      }
      let opened;
      try {
        opened = await openScene('study-desk', theme, width);
        for (const view of DESK_VIEWS) {
          await opened.page.evaluate((v) => window.__pinkieStudyDesk.go(v), view);
          await opened.page.waitForFunction((v) => {
            const root = document.querySelector('#pinkie-study-desk');
            if (!root) return false;
            if (v === 'chat') return root.dataset.view === 'chat';
            const host = root.querySelector(`.view[data-view="${v}"]`);
            return Boolean(host && host.childElementCount > 0);
          }, view, {timeout: 8_000}).catch(() => {});
          await opened.page.waitForTimeout(500);
          await shoot(opened.page, opened.pageErrors, `desk-${view}-${width}-${theme}`);
        }
      } catch (error) {
        report.push({name: `desk-${width}-${theme}`, error: String(error?.message || error).slice(0, 300)});
      } finally {
        await opened?.context.close();
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}

console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
let low = 0;
for (const r of report) {
  if (r.error) { console.log(`${r.name}\tERROR ${r.error}`); continue; }
  const by = {};
  for (const x of r.rows) (by[x.key + (x.kind ? ':' + x.kind : '')] ||= []).push(x.best);
  const summary = Object.entries(by).map(([k, v]) => `${k}=${Math.min(...v)}~${Math.max(...v)}(${v.length})`).join(' ');
  low += r.rows.filter((x) => x.best !== null && x.best < 3).length;
  console.log(`${r.name}\tnight=${r.night}\t${summary || '-'}\twalk=${r.walk.length}${r.walk.length ? ' ' + r.walk.map((w) => `${w.sel}:${w.ratio}`).join(',') : ''}`);
}
if (low) { console.error(`svg-audit: ${low} 个图标 < 3`); process.exitCode = 1; }
