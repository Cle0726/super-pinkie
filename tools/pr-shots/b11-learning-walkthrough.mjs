#!/usr/bin/env node
// B11 全页面走查（学习模式）截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）：学习模式首页、学习模式下的设置页、学习台各页
// （今日/营地、看板、书架、笔记本、生词本、背一背、刷题、对话）。1440 / 820 × 日 / 夜。不连网关、不碰用户会话。
// report.json 每页记四类问题（只量视口里、没被别的元素盖住的东西）：
//   text     小字（<24px，粗体 <18.66px）对比度 <4.5；大字 <3
//   ui       图标（svg）、输入框/勾选框/有边框按钮的边框对比度 <3（边框和自身底色都不够才算）
//   overlap  两段文字的框互相压住（交叠 >=25% 小框面积且 >=16px²）
//   trunc    文字被 overflow 裁掉（scrollWidth>clientWidth）且没有省略号、也没有 title
// 底色只叠背景色，不算背景图/渐变/纸纹；叠到图的记 approx:true。
// 例外：background-clip:text 画的字（字色透明、墨色在背景里）改按像素量（clip-text-ink.mjs），
// 记 method:'pixels'，ratio 取渐变最浅那段；每页全部量值在 row.clipText。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {measureClipText} from './clip-text-ink.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const HEIGHT = 800;
const DESK_VIEWS = ['today', 'board', 'library', 'notes', 'vocab', 'drill', 'gamepractice', 'chat'];
// 宽度默认 1440 / 820；PINKIE_WALK_WIDTHS=1280,820 这样可换（L67 走查用 tools/pr-shots/L67-learning-1280.mjs 设）。
const WIDTHS = String(process.env.PINKIE_WALK_WIDTHS || '1440,820').split(',').map((w) => Number(w.trim())).filter((w) => Number.isInteger(w) && w >= 320 && w <= 3840);
if (!WIDTHS.length) throw new Error(`PINKIE_WALK_WIDTHS 无效：${process.env.PINKIE_WALK_WIDTHS}`);

// 在页面里跑：返回 {counts, issues}。
function measure() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', {willReadFrequently: true});
  const cache = new Map();
  const P = (c) => {
    if (cache.has(c)) return cache.get(c);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const v = {r: d[0], g: d[1], b: d[2], a: d[3] / 255};
    cache.set(c, v); return v;
  };
  const L = ({r, g, b}) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
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
  const sel = (e) => {
    const parts = [];
    for (let x = e; x && x !== document.body && parts.length < 4; x = x.parentElement) {
      let s = x.tagName.toLowerCase();
      if (x.id) { parts.unshift(`${s}#${x.id}`); break; }
      const cls = [...x.classList].filter((c) => !/^(on|active|is-|has-)/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      else if (x.dataset.view) s += `[data-view="${x.dataset.view}"]`;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const W = innerWidth, Hh = innerHeight;
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= Hh || r.left >= W) return null;
    let op = 1;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
      op *= Number(s.opacity); if (op < 0.1) return null;
    }
    return r;
  };
  const related = (a, b) => a === b || a.contains(b) || b.contains(a);
  const onTop = (e, r) => {
    const px = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), py = Math.min(Hh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(px, py);
    return !hit || related(e, hit) || (hit.closest?.('svg') && e.contains(hit.closest('svg')));
  };
  const box = (r) => ({x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)});
  const issues = {text: new Map(), ui: new Map(), overlap: new Map(), trunc: new Map()};
  const add = (type, key, row) => { const m = issues[type]; const o = m.get(key); if (o) o.count++; else m.set(key, {...row, count: 1}); };

  // 文字叶子：自己直接带非空文字的元素，框取直接文字节点的并集。
  const leaves = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let e = walker.currentNode; e; e = walker.nextNode()) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|svg|path|text|tspan|CANVAS)$/.test(e.tagName)) continue;
    const texts = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    const r = shown(e); if (!r) continue;
    let tr = null;
    for (const t of texts) {
      range.selectNodeContents(t);
      for (const q of range.getClientRects()) {
        if (q.width < 1 || q.height < 1) continue;
        tr = tr ? {left: Math.min(tr.left, q.left), top: Math.min(tr.top, q.top), right: Math.max(tr.right, q.right), bottom: Math.max(tr.bottom, q.bottom)} : {left: q.left, top: q.top, right: q.right, bottom: q.bottom};
      }
    }
    if (!tr) continue;
    tr.width = tr.right - tr.left; tr.height = tr.bottom - tr.top;
    if (!onTop(e, tr)) continue;
    leaves.push({e, r: tr, text: texts.map((t) => t.textContent.trim()).join(' ').slice(0, 40)});
  }

  // background-clip:text 画的字：字色透明、墨色在背景里，按 color / backgroundColor 算会是假低分，交给页面外按像素量。
  const clipText = [];
  const clipSource = (e) => {
    if (P(getComputedStyle(e).webkitTextFillColor || 'transparent').a > 0 && P(getComputedStyle(e).color).a > 0) return null;
    for (let x = e, i = 0; x && x.nodeType === 1 && i < 4; x = x.parentElement, i++) {
      const s = getComputedStyle(x);
      if (s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text') return x;
    }
    return null;
  };

  for (const {e, r, text} of leaves) {
    const s = getComputedStyle(e), px = parseFloat(s.fontSize), wt = Number(s.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && wt >= 700);
    const src = clipSource(e), need = large ? 3 : 4.5;
    if (src) {
      const id = String(clipText.length);
      e.dataset.pkWalkClip = id; src.dataset.pkWalkClipSrc = [src.dataset.pkWalkClipSrc, id].filter(Boolean).join(" ");
      clipText.push({id, sel: sel(e), text, need, fontSize: px, fontWeight: wt, ...box(r)});
    } else {
      const {bg, approx} = bgOf(e), fg = over(P(s.color), bg), k = ratio(fg, bg);
      if (k < need) add('text', sel(e), {sel: sel(e), text, ratio: k, need, color: s.color, fg: hex(fg), bg: hex(bg), fontSize: px, fontWeight: wt, approx, ...box(r)});
    }
    // 截断：往上 3 层找第一个会裁的盒子。
    let x = e;
    for (let i = 0; i < 4 && x && x !== document.body; i++, x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (!/^(hidden|clip)$/.test(cs.overflowX) || x.clientWidth <= 0) continue;
      const xr = x.getBoundingClientRect();
      if (x.scrollWidth > x.clientWidth + 1 && (r.right > xr.right + 1 || r.left < xr.left - 1)) {
        let titled = false;
        for (let y = e, j = 0; y && j < 5; y = y.parentElement, j++) if (y.getAttribute?.('title')) { titled = true; break; }
        if (cs.textOverflow !== 'ellipsis' && getComputedStyle(e).textOverflow !== 'ellipsis' && !titled) {
          add('trunc', sel(x), {sel: sel(x), text, scrollWidth: x.scrollWidth, clientWidth: x.clientWidth, overflow: cs.overflowX, whiteSpace: getComputedStyle(e).whiteSpace, ...box(xr)});
        }
      }
      break;
    }
  }

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j];
      if (related(a.e, b.e)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 0 || h <= 0) continue;
      const area = w * h, small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (area < 16 || area < small * 0.25) continue;
      const ka = sel(a.e), kb = sel(b.e);
      add('overlap', `${ka} | ${kb}`, {a: ka, aText: a.text, b: kb, bText: b.text, area: Math.round(area), share: +(area / small).toFixed(2), ...box({left: Math.max(a.r.left, b.r.left), top: Math.max(a.r.top, b.r.top), width: w, height: h})});
    }
  }

  for (const svg of document.querySelectorAll('svg')) {
    if (svg.parentElement?.closest('svg')) continue;
    const r = shown(svg); if (!r || r.width < 6 || !onTop(svg, r)) continue;
    const s = getComputedStyle(svg);
    let c = s.stroke && s.stroke !== 'none' ? s.stroke : s.fill;
    if (!c || c === 'none' || P(c).a === 0) {
      const p = svg.querySelector('path,circle,rect,line,polyline,polygon');
      if (p) { const ps = getComputedStyle(p); c = ps.stroke && ps.stroke !== 'none' ? ps.stroke : ps.fill; }
    }
    if (!c || c === 'none' || /^url\(/.test(c)) continue;
    const {bg, approx} = bgOf(svg.parentElement), fg = over(P(c), bg), k = ratio(fg, bg);
    if (P(c).a === 0) continue;
    if (k < 3) add('ui', sel(svg), {kind: 'icon', sel: sel(svg), label: (svg.closest('[aria-label]')?.getAttribute('aria-label') || '').slice(0, 30), ratio: k, need: 3, fg: hex(fg), bg: hex(bg), approx, ...box(r)});
  }

  for (const e of document.querySelectorAll('input:not([type=hidden]),textarea,select,button,[role=checkbox],[role=radio],[role=switch],[role=slider]')) {
    const r = shown(e); if (!r || !onTop(e, r)) continue;
    const s = getComputedStyle(e), bw = parseFloat(s.borderTopWidth) || parseFloat(s.borderBottomWidth) || 0;
    const bs = s.borderTopStyle !== 'none' ? s.borderTopStyle : s.borderBottomStyle, bcRaw = s.borderTopStyle !== 'none' ? s.borderTopColor : s.borderBottomColor;
    if (bw < 1 || bs === 'none' || P(bcRaw).a === 0) continue;
    const {bg: outer, approx} = bgOf(e.parentElement), own = over(P(s.backgroundColor), outer), bc = over(P(bcRaw), outer);
    const kb = ratio(bc, outer), ko = ratio(own, outer);
    if (Math.max(kb, ko) < 3) add('ui', sel(e), {kind: 'border:' + e.tagName.toLowerCase(), sel: sel(e), label: (e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 30), ratio: kb, fillRatio: ko, need: 3, border: hex(bc), bg: hex(outer), approx, ...box(r)});
  }

  const list = (m, by) => [...m.values()].sort(by).slice(0, 40);
  return {
    leaves: leaves.length,
    clipText,
    counts: Object.fromEntries(Object.entries(issues).map(([k, m]) => [k, m.size])),
    issues: {
      text: list(issues.text, (a, b) => a.ratio - b.ratio),
      ui: list(issues.ui, (a, b) => a.ratio - b.ratio),
      overlap: list(issues.overlap, (a, b) => b.share - a.share),
      trunc: list(issues.trunc, (a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth)),
    },
    deskStatus: (document.querySelector('#pinkie-study-desk .desk-status')?.textContent || '').trim().slice(0, 120),
    deskView: document.querySelector('#pinkie-study-desk')?.dataset.view || '',
    path: location.pathname,
  };
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const record = async (page, name) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({
    name, file, os: process.platform, browser: engine || 'chromium',
    width: (await page.viewportSize()).width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  });
};

const shoot = async (page, pageErrors, {group, view, theme, width}) => {
  const name = `${group}${view ? '-' + view : ''}-${width}-${theme}`;
  const row = {name, group, view: view || '', theme, width};
  try {
    await record(page, name);
    Object.assign(row, await page.evaluate(measure));
    await measureClipText(page, row);
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

const fail = (group, theme, width, error) => report.push({name: `${group}-${width}-${theme}`, group, theme, width, error: String(error?.message || error).slice(0, 300)});

// 首页 + 设置：学习模式首页（新会话启动页），再从侧栏进设置。
async function homeAndSettings(theme, width) {
  let opened;
  try {
    opened = await openScene('home-learning', theme, width);
    const {page, pageErrors} = opened;
    await shoot(page, pageErrors, {group: 'home', theme, width});
    if (width < 1100) {
      const opener = page.locator('button[aria-label="展开侧边栏"], button[aria-label="打开侧边栏"]').first();
      if (await opener.count()) await opener.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    const link = page.locator('a.sidebar-footer-icon[aria-label="设置"]').first();
    await link.waitFor({state: 'visible', timeout: 10_000});
    await link.click();
    await page.waitForFunction(() => location.pathname.startsWith('/settings') && Boolean(document.querySelector('#laolao-user-settings:not([hidden])')), {timeout: 10_000});
    await page.waitForTimeout(400);
    await shoot(page, pageErrors, {group: 'settings', theme, width});
  } catch (error) {
    fail('home-settings', theme, width, error);
  } finally {
    await opened?.context.close();
  }
}

// 学习台：study-desk 场景（先进背一背），再逐页 go()。
async function desk(theme, width) {
  let opened;
  try {
    opened = await openScene('study-desk', theme, width);
    const {page, pageErrors} = opened;
    for (const view of DESK_VIEWS) {
      try {
        await page.evaluate((v) => window.__pinkieStudyDesk.go(v), view);
        await page.waitForFunction((v) => {
          const root = document.querySelector('#pinkie-study-desk');
          if (!root) return false;
          if (v === 'chat') return root.dataset.view === 'chat';
          const host = root.querySelector(`.view[data-view="${v}"]`);
          return Boolean(host && host.childElementCount > 0);
        }, view, {timeout: 8_000}).catch(() => {});
        await page.waitForTimeout(500);
        await shoot(page, pageErrors, {group: 'desk', view, theme, width});
      } catch (error) {
        fail(`desk-${view}`, theme, width, error);
      }
    }
  } catch (error) {
    fail('desk', theme, width, error);
  } finally {
    await opened?.context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of WIDTHS) {
      await homeAndSettings(theme, width);
      await desk(theme, width);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
for (const r of report) console.log(`${r.name}\t${r.error ? 'ERROR ' + r.error : JSON.stringify(r.counts)}`);
