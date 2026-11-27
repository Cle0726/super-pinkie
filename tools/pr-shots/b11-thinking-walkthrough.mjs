#!/usr/bin/env node
// B11 全页面走查（深度思考模式 thinking）截图与问题表，约定照 tools/pr-shots/b11-learning-walkthrough.mjs：
// node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）+ 假网关，不连真网关、不碰用户会话。1440 / 820 × 日 / 夜。
// 页面：thinking 首页、从 thinking 首页进的设置页、会话页（跑一轮带思考的 narrated 剧本：进行中 / 展开思考 / 跑完）、
// 极致思考强度菜单、模型选择器、思考强度面板（.pinkie-external-tier）。
// 引擎：PINKIE_SHOTS_ENGINE=webkit 时自己起 WebKit、截图走 wkshotBuffer（本机 WebKit 的 page.screenshot 会回 0 字节）。
// 问题四类同学习走查（text / ui / overlap / trunc）。background-clip:text 画的字（思考强度牌）计算样式里没有字色，
// 按 #354 的思路改按像素量：同一块拍有字 / 藏字两张逐像素比，结果并回 issues.text，标 method:'pixels'。
// #354 合入后把下面 decodePng / inkRatio / clipTextInk 换成 import。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {playwright} from '../study-desk/harness.mjs';
import {wkshotBuffer, wrapWebKitPlaywright} from '../../tests/visual/lib/webkit-screenshot.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const HEIGHT = 800;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

// ---------- background-clip:text 像素量法（照 #354 clipTextInk） ----------
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
// 只在走查截图时临时注入，不进产品文件；tools/ 下不计 important。
const HIDE = 'color:transparent!important;-webkit-text-fill-color:transparent!important;background:none!important;filter:none!important;text-shadow:none!important';
const snap = (page, opts = {}) => engine === 'webkit'
  ? wkshotBuffer(page, {settleMs: 150, ...opts})
  : page.screenshot({animations: 'disabled', ...opts});
async function clipTextInk(page, hide, clip, binPx) {
  const withBuf = await snap(page, {clip});
  const tag = await page.addStyleTag({content: `${hide}{${HIDE}}`});
  try {
    const withoutBuf = await snap(page, {clip});
    return inkRatio(withBuf, withoutBuf, binPx);
  } finally {
    await tag.evaluate((n) => n.remove());
  }
}

// 在页面里跑：返回 {counts, issues, clipText, ...}。和学习走查一致，另把 background-clip:text 的字挑出来交给页面外按像素量。
function measure() {
  document.querySelectorAll('[data-pk-walk-clip],[data-pk-walk-clip-src]').forEach((n) => { delete n.dataset.pkWalkClip; delete n.dataset.pkWalkClipSrc; });
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
  // 字形透明、透出背景的字：自己或往上 2 层里有 background-clip:text。
  const clipSource = (e) => {
    for (let x = e, i = 0; x && x.nodeType === 1 && i < 3; x = x.parentElement, i++) {
      const s = getComputedStyle(x);
      if ((s.backgroundClip || s.webkitBackgroundClip || '').includes('text') || (s.webkitBackgroundClip || '').includes('text')) return x;
    }
    return null;
  };
  const issues = {text: new Map(), ui: new Map(), overlap: new Map(), trunc: new Map()};
  const add = (type, key, row) => { const m = issues[type]; const o = m.get(key); if (o) o.count++; else m.set(key, {...row, count: 1}); };
  const clipText = [];

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

  for (const {e, r, text} of leaves) {
    const s = getComputedStyle(e), px = parseFloat(s.fontSize), wt = Number(s.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && wt >= 700);
    const need = large ? 3 : 4.5;
    const src = clipSource(e);
    if (src) {
      const id = String(clipText.length);
      e.dataset.pkWalkClip = id; src.dataset.pkWalkClipSrc = id;
      clipText.push({id, sel: sel(e), text, need, fontSize: px, fontWeight: wt, ...box(r)});
    } else {
      const {bg, approx} = bgOf(e), fg = over(P(s.color), bg), k = ratio(fg, bg);
      if (k < need) add('text', sel(e), {sel: sel(e), text, ratio: k, need, color: s.color, fg: hex(fg), bg: hex(bg), fontSize: px, fontWeight: wt, approx, ...box(r)});
    }
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
  const bar = document.querySelector('.pk-run');
  return {
    leaves: leaves.length,
    counts: Object.fromEntries(Object.entries(issues).map(([k, m]) => [k, m.size])),
    issues: {
      text: list(issues.text, (a, b) => a.ratio - b.ratio),
      ui: list(issues.ui, (a, b) => a.ratio - b.ratio),
      overlap: list(issues.overlap, (a, b) => b.share - a.share),
      trunc: list(issues.trunc, (a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth)),
    },
    clipText,
    mode: document.documentElement.dataset.laolaoMode || '',
    runBar: Boolean(bar && !bar.hidden && bar.getBoundingClientRect().height > 0),
    thinkingBoxes: document.querySelectorAll('.pinkie-thinking').length,
    processCards: document.querySelectorAll('.chat-group--process[data-pinkie-process]').length,
    path: location.pathname,
  };
}

async function measureClipText(page, row) {
  const items = row.clipText || [];
  if (!items.length) return;
  const dpr = await page.evaluate(() => devicePixelRatio || 1);
  const vp = page.viewportSize() || {width: 1440, height: HEIGHT};
  for (const it of items) {
    const x = Math.max(0, it.x - 2), y = Math.max(0, it.y - 2);
    const clip = {x, y, width: Math.min(vp.width - x, it.w + 4), height: Math.min(vp.height - y, it.h + 4)};
    try {
      const hide = `[data-pk-walk-clip="${it.id}"],[data-pk-walk-clip-src="${it.id}"]`;
      Object.assign(it, await clipTextInk(page, hide, clip, it.fontSize * dpr / 2), {method: 'pixels'});
      if (it.ratio < it.need) {
        row.issues.text.push({sel: it.sel, text: it.text, ratio: it.ratio, median: it.median, need: it.need, fontSize: it.fontSize, fontWeight: it.fontWeight, method: 'pixels', x: it.x, y: it.y, w: it.w, h: it.h, count: 1});
        row.counts.text++;
      }
    } catch (error) {
      it.error = String(error?.message || error).slice(0, 200);
    }
  }
}

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
const report = [];
const lines = [];

const record = async (page, name) => {
  const file = `${name}.png`;
  const buf = await snap(page, {path: path.join(out, file)});
  if (!buf?.length) throw new Error(`empty screenshot ${name}`);
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({
    name, file, os: process.platform, browser: engine,
    width: (page.viewportSize() || {}).width, height: HEIGHT,
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

// 首页 + 设置：thinking 首页（新会话启动页），再从侧栏进设置。
async function homeAndSettings(theme, width) {
  let opened;
  try {
    opened = await openScene('home-thinking', theme, width);
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

const RUNNING = {active: true, phase: 'working', review: {phase: 'idle'}, continuations: {tier: 0, integrity: 0}, missing: []};
const IDLE = {active: false, phase: 'idle', review: {phase: 'idle'}, continuations: {tier: 0, integrity: 0}, missing: []};

// 会话页：在 thinking 首页发一句，假网关跑 narrated（三步、每步带思考），拍进行中 / 展开思考 / 跑完；
// 再在同一页拍极致思考菜单、模型选择器、思考强度面板。
async function session(theme, width) {
  let opened;
  try {
    opened = await openScene('home-thinking', theme, width);
    const {page, pageErrors} = opened;
    await page.evaluate((running) => {
      window.__fakeRunStatus = running;
      window.__fake.auto('narrated', {thinking: true, gap: 700, once: true});
      const send = window.__fake.checks?.send || window.__fake.send;
      send('帮我想想这个周末的读书计划怎么排');
    }, RUNNING);
    const step = async (view, fn, timeout = 15_000) => {
      try {
        await page.waitForFunction(fn, null, {timeout});
        await page.waitForTimeout(400);
        await shoot(page, pageErrors, {group: 'chat', view, theme, width});
      } catch (error) {
        fail(`chat-${view}`, theme, width, error);
      }
    };
    await step('live', () => document.querySelector('.pinkie-thinking') && document.querySelector('.chat-group--process[data-pinkie-process]'));
    const head = page.locator('.pinkie-thinking__head').first();
    if (await head.count()) await head.click().catch(() => {});
    await step('thought', () => document.querySelector('.pinkie-thinking__body')?.getBoundingClientRect().height > 8);
    await page.evaluate((idle) => { window.__fakeRunStatus = idle; }, IDLE);
    await step('done', () => (document.querySelector('.chat-thread')?.textContent || '').includes('【最终回复】') && !document.querySelector('details.pinkie-process[data-live="1"]'), 30_000);

    try {
      await page.locator('.laolao-deep-think-btn').first().click({timeout: 8_000});
      await page.waitForFunction(() => { const m = document.querySelector('#laolao-deep-think-menu'); return m && !m.hidden && m.getBoundingClientRect().height > 40; }, null, {timeout: 8_000});
      await page.waitForTimeout(400);
      await shoot(page, pageErrors, {group: 'deepthink', view: 'menu', theme, width});
      await page.keyboard.press('Escape');
      await page.mouse.click(5, HEIGHT - 5);
      await page.waitForTimeout(300);
    } catch (error) {
      fail('deepthink-menu', theme, width, error);
    }

    try {
      await page.locator('details.chat-controls__model > summary, details.chat-controls__model-picker > summary').first().click({timeout: 8_000});
      await page.waitForFunction(() => (document.querySelector('.chat-controls__inline-select-menu--combined')?.getBoundingClientRect().height || 0) > 40, null, {timeout: 8_000});
      await page.waitForTimeout(400);
      await shoot(page, pageErrors, {group: 'picker', view: 'model', theme, width});
      const effort = page.locator('.pinkie-effort-trigger').first();
      if (await effort.count()) {
        await effort.click({timeout: 5_000});
        await page.waitForTimeout(500);
        await shoot(page, pageErrors, {group: 'picker', view: 'effort', theme, width});
      } else {
        fail('picker-effort', theme, width, 'no .pinkie-effort-trigger');
      }
    } catch (error) {
      fail('picker', theme, width, error);
    }
  } catch (error) {
    fail('session', theme, width, error);
  } finally {
    await opened?.context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await homeAndSettings(theme, width);
      await session(theme, width);
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
for (const r of report) console.log(`${r.name}\t${r.error ? 'ERROR ' + r.error : JSON.stringify(r.counts) + ` mode=${r.mode} clip=${(r.clipText || []).length} run=${r.runBar}`}`);
