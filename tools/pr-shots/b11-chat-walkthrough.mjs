#!/usr/bin/env node
// B11 全页面走查（日常聊天模式 chat）截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs，场景 home-chat）：唠嗑模式首页、模型菜单、模式菜单、侧栏收起/展开、
// 设置页，以及从首页「最近会话」点进去的对话页（种一段带长回复的历史）。1440 / 820 × 日 / 夜。不连网关、不碰用户会话。
// report.json 每页记四类问题（只量视口里、没被别的元素盖住的东西）：
//   text     小字（<24px，粗体 <18.66px）对比度 <4.5；大字 <3
//   ui       图标（svg）、输入框/勾选框/有边框按钮的边框对比度 <3（边框和自身底色都不够才算）
//   overlap  两段文字的框互相压住（交叠 >=25% 小框面积且 >=16px²）
//   trunc    文字被 overflow 裁掉（scrollWidth>clientWidth）且没有省略号、也没有 title
// 底色只叠背景色，不算背景图/渐变/纸纹；叠到图的记 approx:true。
// 例外：background-clip:text 画的字（字色透明、墨色在背景里，如思考强度牌 .pinkie-external-tier）改按像素量，
// 记 method:'pixels'，ratio 取渐变最浅那段；每页全部量值在 row.clipText。
// 像素量法照 #354 的 tools/pr-shots/clip-text-ink.mjs（win/b11-walk-clip-text@af756259）原样内联；#354 合并后改成 import。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {wrapWebKitPlaywright} from '../../tests/visual/lib/webkit-screenshot.mjs';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const HEIGHT = 800;
const SCENE = 'home-chat';

// ---- 像素量法（#354 clip-text-ink.mjs）----
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (kind === 'IDAT') idat.push(d);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const ch = {0: 1, 2: 3, 4: 2, 6: 4}[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`unsupported PNG: depth ${depth} type ${type} interlace ${interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[up + x] : 0, c = x >= ch && y ? px[up + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  const rgb = (x, y) => { const i = y * stride + x * ch; return ch >= 3 ? [px[i], px[i + 1], px[i + 2]] : [px[i], px[i], px[i]]; };
  return {width: w, height: h, rgb};
}

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

function inkRatio(withBuf, withoutBuf, binPx) {
  const A = decodePng(withBuf), B = decodePng(withoutBuf);
  if (A.width !== B.width || A.height !== B.height) throw new Error('crop sizes differ');
  const cols = [];
  for (let x = 0; x < A.width; x++) {
    let best = 1, n = 0;
    for (let y = 0; y < A.height; y++) {
      const r = contrast(lum(A.rgb(x, y)), lum(B.rgb(x, y)));
      if (r > 1.15) n++;
      if (r > best) best = r;
    }
    cols.push(n >= 2 ? best : 0);
  }
  const step = Math.max(2, Math.round(binPx)), bins = [];
  for (let x = 0; x < cols.length; x += step) {
    const inked = cols.slice(x, x + step).filter(Boolean);
    if (inked.length >= Math.max(2, step * 0.4)) bins.push(Math.max(...inked));
  }
  if (!bins.length) return {ratio: 1, median: 1, bins: 0};
  const sorted = [...bins].sort((a, b) => a - b);
  return {ratio: +sorted[0].toFixed(2), median: +sorted[sorted.length >> 1].toFixed(2), bins: bins.length};
}

const HIDE = 'color:transparent!important;-webkit-text-fill-color:transparent!important;background:none!important;filter:none!important;text-shadow:none!important';

async function clipTextInk(page, hide, clip, binPx) {
  const withBuf = await page.screenshot({clip, animations: 'disabled'});
  const tag = await page.addStyleTag({content: `${hide}{${HIDE}}`});
  try {
    const withoutBuf = await page.screenshot({clip, animations: 'disabled'});
    return inkRatio(withBuf, withoutBuf, binPx);
  } finally {
    await tag.evaluate((n) => n.remove());
  }
}
// ---- 像素量法结束 ----

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
      e.dataset.pkWalkClip = id; src.dataset.pkWalkClipSrc = id;
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

  // <svg> 根的 fill 默认是不透明黑，不能当图标色：只看真正画出来的子图形，
  // stroke/fill 各按自身 opacity 与到 svg 之间各层 opacity 叠出实际墨色，跳过 none 和 url() 渐变，取对比度最高的一笔。
  const inkOf = (svg, bg) => {
    let best = null;
    for (const g of svg.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon,text')) {
      const gs = getComputedStyle(g);
      if (gs.display === 'none' || gs.visibility === 'hidden') continue;
      let op = 1;
      for (let x = g; x && x !== svg; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
      const paints = [[gs.stroke, gs.strokeOpacity, parseFloat(gs.strokeWidth) > 0], [gs.fill, gs.fillOpacity, g.tagName !== 'line']];
      for (const [paint, alpha, on] of paints) {
        if (!on || !paint || paint === 'none' || /^url\(/.test(paint)) continue;
        const c = P(paint), a = c.a * Number(alpha) * op;
        if (a <= 0) continue;
        const fg = over({...c, a}, bg), k = ratio(fg, bg);
        if (!best || k > best.k) best = {k, fg};
      }
    }
    return best;
  };
  for (const svg of document.querySelectorAll('svg')) {
    if (svg.parentElement?.closest('svg')) continue;
    const r = shown(svg); if (!r || r.width < 6 || !onTop(svg, r)) continue;
    const {bg, approx} = bgOf(svg.parentElement), ink = inkOf(svg, bg);
    if (!ink) continue;
    if (ink.k < 3) add('ui', sel(svg), {kind: 'icon', sel: sel(svg), label: (svg.closest('[aria-label]')?.getAttribute('aria-label') || '').slice(0, 30), ratio: ink.k, need: 3, fg: hex(ink.fg), bg: hex(bg), approx, ...box(r)});
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
    path: location.pathname,
    session: new URLSearchParams(location.search).get('session') || '',
  };
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
// launchRealBrowser 只开 Chromium；PINKIE_VISUAL_ENGINE=webkit 时照 color-mode-light-shots.mjs 自己开 WebKit（mac 上 page.screenshot 回 0 字节由包装兜底）。
const engine = H.resolveRealEngine();
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser(engine);
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

// measure() 标出来的 background-clip:text 字：页面外按像素量，不够线的并回 issues.text。
async function measureClipText(page, row) {
  const vp = page.viewportSize();
  for (const c of row.clipText || []) {
    const x = Math.max(0, c.x - 2), y = Math.max(0, c.y - 2);
    const clip = {x, y, width: Math.min(vp.width - x, c.w + 4), height: Math.min(vp.height - y, c.h + 4)};
    if (clip.width < 2 || clip.height < 2) { c.skipped = 'offscreen'; continue; }
    try {
      const dpr = await page.evaluate(() => devicePixelRatio);
      const hide = `[data-pk-walk-clip="${c.id}"], [data-pk-walk-clip-src="${c.id}"]`;
      Object.assign(c, await clipTextInk(page, hide, clip, (c.fontSize * dpr) / 2));
    } catch (error) {
      c.error = String(error?.message || error).slice(0, 160);
      continue;
    }
    if (c.ratio < c.need) {
      row.issues.text.push({sel: c.sel, text: c.text, ratio: c.ratio, median: c.median, need: c.need, method: 'pixels', fontSize: c.fontSize, fontWeight: c.fontWeight, x: c.x, y: c.y, w: c.w, h: c.h, count: 1});
      row.counts.text++;
    }
  }
  row.issues.text.sort((a, b) => a.ratio - b.ratio);
  await page.evaluate(() => { for (const n of document.querySelectorAll('[data-pk-walk-clip], [data-pk-walk-clip-src]')) { delete n.dataset.pkWalkClip; delete n.dataset.pkWalkClipSrc; } });
}

const shoot = async (page, pageErrors, {group, theme, width}) => {
  const name = `${group}-${width}-${theme}`;
  const row = {name, group, theme, width};
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

async function openScene(theme, width, opts = {}) {
  const opened = await H.openRealScenePage(browser, server.origin, SCENE, theme, {timezoneId: 'Asia/Shanghai', ...opts});
  await opened.page.setViewportSize({width, height: HEIGHT});
  await opened.page.waitForTimeout(500);
  return opened;
}

const fail = (group, theme, width, error) => report.push({name: `${group}-${width}-${theme}`, group, theme, width, error: String(error?.message || error).slice(0, 300)});

// 一步一张：出错只记这一组，接着走下一组。
async function step(page, pageErrors, group, theme, width, act) {
  try {
    await act();
    await shoot(page, pageErrors, {group, theme, width});
  } catch (error) {
    fail(group, theme, width, error);
  }
}

async function closePopups(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
  await page.evaluate(() => { for (const d of document.querySelectorAll('details[open]')) d.open = false; }).catch(() => {});
  await page.waitForTimeout(150);
}

const visibleFirst = async (page, selector) => {
  const all = page.locator(selector);
  for (let i = 0, n = await all.count(); i < n; i++) if (await all.nth(i).isVisible()) return all.nth(i);
  return null;
};

// 首页 → 模型菜单 → 模式菜单 → 侧栏（1440 收起 / 820 展开）→ 设置。
async function shell(theme, width) {
  let opened;
  try {
    opened = await openScene(theme, width);
    const {page, pageErrors} = opened;
    await shoot(page, pageErrors, {group: 'home', theme, width});

    await step(page, pageErrors, 'model-menu', theme, width, async () => {
      const summary = await visibleFirst(page, 'details.chat-controls__model > summary, details.chat-controls__model-picker > summary');
      if (!summary) throw new Error('没找到模型菜单触发器');
      await summary.click();
      await page.waitForFunction(() => [...document.querySelectorAll('.chat-controls__inline-select-menu--combined')].some((m) => m.getBoundingClientRect().height > 40), null, {timeout: 5_000});
      await page.waitForTimeout(300);
    });
    await closePopups(page);

    // 模式按钮在侧栏里：窄屏侧栏收在视口外，isVisible 仍为真但点不到，所以 820 先展开侧栏再点。
    const modeMenu = () => step(page, pageErrors, 'mode-menu', theme, width, async () => {
      const trigger = await visibleFirst(page, 'button.laolao-mode-switcher, .laolao-mode-dock-trigger');
      if (!trigger) throw new Error('没找到模式菜单触发器');
      await trigger.click({timeout: 10_000});
      await page.waitForFunction(() => [...document.querySelectorAll('.laolao-mode-menu')].some((m) => m.getBoundingClientRect().height > 40), null, {timeout: 5_000});
      await page.waitForTimeout(300);
    });
    const sidebarInView = () => page.evaluate(() => {
      const b = document.querySelector('a.sidebar-footer-icon[aria-label="设置"]')?.getBoundingClientRect();
      return Boolean(b && b.width > 0 && b.left >= 0 && b.right <= innerWidth);
    });
    const openSidebar = async () => {
      const opener = await visibleFirst(page, 'button[aria-label="展开侧边栏"], button[aria-label="打开侧边栏"]');
      if (!opener) throw new Error('没找到展开侧边栏按钮');
      await opener.click({timeout: 10_000});
      await page.waitForTimeout(600);
    };

    if (width >= 1100) {
      await modeMenu();
      await closePopups(page);
      await step(page, pageErrors, 'sidebar-collapsed', theme, width, async () => {
        const toggle = await visibleFirst(page, '.sidebar [data-pinkie-sidebar-toggle], .sidebar button[aria-label="折叠侧边栏"]');
        if (!toggle) throw new Error('没找到折叠侧边栏按钮');
        await toggle.click();
        await page.waitForTimeout(600);
      });
      const opener = await visibleFirst(page, 'button[aria-label="展开侧边栏"], button[aria-label="打开侧边栏"]');
      if (opener) { await opener.click().catch(() => {}); await page.waitForTimeout(600); }
    } else {
      await step(page, pageErrors, 'sidebar-open', theme, width, openSidebar);
      await modeMenu();
      await closePopups(page);
      if (!(await sidebarInView())) await openSidebar().catch(() => {});
    }

    await step(page, pageErrors, 'settings', theme, width, async () => {
      const link = page.locator('a.sidebar-footer-icon[aria-label="设置"]').first();
      await link.waitFor({state: 'visible', timeout: 10_000});
      await link.click();
      await page.waitForFunction(() => location.pathname.startsWith('/settings') && Boolean(document.querySelector('#laolao-user-settings:not([hidden])')), null, {timeout: 10_000});
      await page.waitForTimeout(400);
    });
  } catch (error) {
    fail('shell', theme, width, error);
  } finally {
    await opened?.context.close();
  }
}

// 对话页：种一段带长回复（标题、列表、代码块、表格、引用）的历史，从首页点第一条最近会话进去。
function seedChatHistory() {
  const t = Date.now();
  const text = (s) => [{type: 'text', text: s}];
  window.__fakeSeedHistory = [
    {role: 'user', content: text('帮我整理一下周末去郊外露营要带的东西，顺便给个简单的出发时间表。'), timestamp: t - 300_000},
    {role: 'assistant', stopReason: 'stop', timestamp: t - 240_000, content: text([
      '## 露营清单',
      '',
      '按用途分三类，**加粗**的是必带：',
      '',
      '1. **帐篷、防潮垫、睡袋**（夜里会降到 8℃ 左右）',
      '2. 头灯、充电宝、`备用电池`',
      '3. 炉头、气罐、折叠锅，外加一卷垃圾袋',
      '',
      '> 小提示：气罐别放在车里暴晒，到营地再拿出来。',
      '',
      '| 时间 | 安排 |',
      '| --- | --- |',
      '| 07:30 | 出门，路上买早饭 |',
      '| 09:30 | 到营地，先搭帐篷 |',
      '| 12:00 | 午饭、休息 |',
      '',
      '```text',
      '出发前检查：天气预报 → 车况 → 证件 → 手机电量',
      '```',
      '',
      '需要的话我可以再按人数算一下食物的量。',
    ].join('\n'))},
    {role: 'user', content: text('四个人，两天一夜。'), timestamp: t - 120_000},
    {role: 'assistant', stopReason: 'stop', timestamp: t - 60_000, content: text('四个人两天一夜，大约准备：主食 8 份、饮用水 16 升、零食两大袋。肉类建议买真空包装，放进保温箱里能撑到第二天中午。')},
  ];
}

async function conversation(theme, width) {
  let opened;
  try {
    opened = await openScene(theme, width, {initScript: seedChatHistory});
    const {page, pageErrors} = opened;
    await step(page, pageErrors, 'chat', theme, width, async () => {
      const item = page.locator('.laolao-startup-home__item').first();
      await item.waitFor({state: 'visible', timeout: 10_000});
      await item.click();
      await page.waitForFunction(() => (document.querySelector('.chat-main')?.textContent || '').includes('露营清单'), null, {timeout: 10_000})
        .catch(() => {});
      await page.waitForTimeout(800);
    });
  } catch (error) {
    fail('chat', theme, width, error);
  } finally {
    await opened?.context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await shell(theme, width);
      await conversation(theme, width);
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
for (const r of report) console.log(`${r.name}\t${r.error ? 'ERROR ' + r.error : JSON.stringify(r.counts)}${r.session !== undefined ? '\t' + r.session : ''}`);
