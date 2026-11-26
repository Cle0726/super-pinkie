#!/usr/bin/env node
// B11 全页面走查（无限制模式 / unrestricted）截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs 的 home-unrestricted 场景）：会话在 agent:unrestricted: 下。
// 1440 / 820 × 日 / 夜，每格依次拍：
//   home       无限制模式首页（问候语 + 继续之前的工作）
//   chat       离开首页后的空会话（输入框上有无限制模式独有的「脱敏」按钮）
//   artifacts  作品库（侧栏「作品」）
//   workbench  工作台（输入区右侧「工作台」按钮打开）
//   settings   设置页（侧栏底部齿轮）
// report.json 每页记：小字对比度 <4.5、边框 / 图标对比度 <3、可点元素重叠、文字截断
// （scrollWidth > clientWidth 且没有省略号、自己和祖先都没有 title）。不连网关、不碰用户会话。
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
const LIMIT = 40;   // 每类问题每页最多记这么多条，够看出规律

// 在页面里量。只看视口里看得见的元素；渐变 / 图片底色量不准，记 bgImage 让人工看图核对。
const measure = (page, limit) => page.evaluate((LIMIT) => {
  const P = (c) => {
    const srgb = String(c).match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/i);
    if (srgb) return {r: +srgb[1] * 255, g: +srgb[2] * 255, b: +srgb[3] * 255, a: srgb[4] === undefined ? 1 : +srgb[4]};
    if (!c || c === 'transparent') return {r: 0, g: 0, b: 0, a: 0};
    const m = String(c).match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    return {r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1};
  };
  const L = ({r, g, b}) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1,
  });
  const ratio = (a, b) => { const x = L(a), y = L(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
  const rgb = (c) => `rgb(${[c.r, c.g, c.b].map((x) => Math.round(x)).join(',')})`;
  const parentOf = (e) => e.parentElement || e.getRootNode()?.host || null;
  const bgOf = (e) => {
    const stack = [];
    let image = false;
    for (let x = e; x && x.nodeType === 1; x = parentOf(x)) {
      const s = getComputedStyle(x);
      if (s.backgroundImage && s.backgroundImage !== 'none') image = true;
      const c = P(s.backgroundColor);
      if (c.a > 0) stack.push(c);
      if (c.a >= 1) break;
    }
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (const c of stack.reverse()) base = over(c, base);
    return {color: base, image};
  };
  const vw = innerWidth, vh = innerHeight;
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return null;
    for (let x = e; x && x.nodeType === 1; x = parentOf(x)) {
      const s = getComputedStyle(x);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return null;
    }
    return r;
  };
  const effOpacity = (e) => { let o = 1; for (let x = e; x && x.nodeType === 1; x = parentOf(x)) o *= Number(getComputedStyle(x).opacity) || 0; return o; };
  const selOf = (e) => {
    const part = (x) => {
      if (x.id) return `${x.localName}#${x.id}`;
      const cls = [...(x.classList || [])].filter((c) => !/^(is-|has-)/.test(c)).slice(0, 2);
      const aria = x.getAttribute?.('aria-label');
      return x.localName + (cls.length ? '.' + cls.join('.') : '') + (!cls.length && aria ? `[aria-label="${aria.slice(0, 20)}"]` : '');
    };
    const parts = [];
    for (let x = e, i = 0; x && x.nodeType === 1 && i < 4; x = parentOf(x), i++) {
      parts.unshift(part(x));
      if (x.id) break;
    }
    return parts.join(' > ');
  };
  const box = (r) => ({x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)});
  const ownText = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const walk = (root, fn) => {
    for (const e of root.querySelectorAll('*')) { fn(e); if (e.shadowRoot) walk(e.shadowRoot, fn); }
  };
  const all = [];
  walk(document, (e) => all.push(e));

  const smallText = [], border = [], icon = [], overlap = [], truncated = [];
  const seen = new Set();
  for (const e of all) {
    if (['script', 'style', 'head', 'meta', 'link', 'title', 'noscript', 'template'].includes(e.localName)) continue;
    const text = ownText(e);
    if (!text && !['input', 'textarea'].includes(e.localName)) continue;
    const r = visible(e);
    if (!r) continue;
    const s = getComputedStyle(e);
    const size = parseFloat(s.fontSize) || 0, weight = Number(s.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const bg = bgOf(e);
    const fgRaw = P(s.color);
    const fg = over({...fgRaw, a: fgRaw.a * effOpacity(e)}, bg.color);
    const k = ratio(fg, bg.color);
    const shown = text || e.getAttribute('placeholder') || '';
    if (!large && shown && k < 4.5) {
      const sel = selOf(e), key = sel + '|' + shown.slice(0, 20);
      if (!seen.has(key)) {
        seen.add(key);
        smallText.push({sel, text: shown.slice(0, 40), ratio: k, color: s.color, bg: rgb(bg.color), bgImage: bg.image, fontSize: size, ...box(r)});
      }
    }
    // 截断：只看自己有字的元素
    if (text && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && s.overflowX !== 'visible') {
      let titled = false;
      for (let x = e, i = 0; x && x.nodeType === 1 && i < 4; x = parentOf(x), i++) if (x.getAttribute('title')) { titled = true; break; }
      const ellipsis = s.textOverflow === 'ellipsis';
      if (!ellipsis && !titled) truncated.push({sel: selOf(e), text: text.slice(0, 40), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, overflowX: s.overflowX, ...box(r)});
    }
  }

  // 边框：可交互控件的边框是它唯一的边界（自身底色和父级底色分不开）时才算
  const interactiveSel = 'button, a[href], input:not([type=hidden]), textarea, select, summary, [role=button], [role=tab], [role=menuitem], [role=switch], [role=checkbox]';
  const controls = [];
  walk(document, (e) => { if (e.matches?.(interactiveSel)) controls.push(e); });
  for (const e of controls) {
    const r = visible(e);
    if (!r) continue;
    const s = getComputedStyle(e);
    const w = parseFloat(s.borderTopWidth) || 0;
    const bc = P(s.borderTopColor);
    if (w < 1 || s.borderTopStyle === 'none' || bc.a === 0) continue;
    const parent = parentOf(e);
    const outer = parent ? bgOf(parent) : {color: {r: 255, g: 255, b: 255, a: 1}, image: false};
    const own = bgOf(e);
    if (ratio(own.color, outer.color) >= 3) continue;
    const edge = over({...bc, a: bc.a * effOpacity(e)}, outer.color);
    const k = ratio(edge, outer.color);
    if (k < 3) border.push({sel: selOf(e), text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), ratio: k, borderColor: s.borderTopColor, bg: rgb(outer.color), bgImage: outer.image || own.image, ...box(r)});
  }

  // 图标：看得见的小 svg / 图标字体，取描边或填充色，对它所在的底
  const icons = [];
  walk(document, (e) => { if (e.localName === 'svg' || e.matches?.('.codicon, [class*="icon"]:empty')) icons.push(e); });
  for (const e of icons) {
    const r = visible(e);
    if (!r || r.width > 40 || r.height > 40) continue;
    if (e.closest?.('[aria-hidden="true"]') && !e.closest?.(interactiveSel)) continue;   // 纯装饰
    const s = getComputedStyle(e);
    let paint = null;
    if (e.localName === 'svg') {
      const shape = e.querySelector('path, circle, rect, line, polyline, polygon, ellipse');
      const ss = shape ? getComputedStyle(shape) : s;
      const stroke = ss.stroke && ss.stroke !== 'none' ? P(ss.stroke) : null;
      const fill = ss.fill && ss.fill !== 'none' && !String(ss.fill).startsWith('url') ? P(ss.fill) : null;
      paint = (stroke && stroke.a > 0 ? stroke : null) || (fill && fill.a > 0 ? fill : null);
    } else {
      paint = P(s.color);
    }
    if (!paint || paint.a === 0) continue;
    const bg = bgOf(parentOf(e) || e);
    const fg = over({...paint, a: paint.a * effOpacity(e)}, bg.color);
    const k = ratio(fg, bg.color);
    if (k < 3) icon.push({sel: selOf(e), owner: selOf(e.closest?.(interactiveSel) || parentOf(e) || e), ratio: k, paint: rgb(paint), bg: rgb(bg.color), bgImage: bg.image, ...box(r)});
  }

  // 重叠：两个可点元素互不包含、相交面积超过 4px²，且相交区中心点上露在最上面的不是其中某一个的内部
  const boxes = controls.map((e) => ({e, r: visible(e)})).filter((x) => x.r && x.r.width >= 4 && x.r.height >= 4);
  const topAt = (x, y) => { let t = document.elementFromPoint(x, y); while (t?.shadowRoot) { const n = t.shadowRoot.elementFromPoint(x, y); if (!n || n === t) break; t = n; } return t; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      const x1 = Math.max(a.r.left, b.r.left), y1 = Math.max(a.r.top, b.r.top);
      const x2 = Math.min(a.r.right, b.r.right), y2 = Math.min(a.r.bottom, b.r.bottom);
      const area = (x2 - x1) * (y2 - y1);
      if (x2 <= x1 || y2 <= y1 || area <= 4) continue;
      const t = topAt((x1 + x2) / 2, (y1 + y2) / 2);
      const covered = t && a.e.contains(t) ? selOf(b.e) : t && b.e.contains(t) ? selOf(a.e) : null;
      overlap.push({a: selOf(a.e), b: selOf(b.e), area: Math.round(area), covered, at: {x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1)}});
    }
  }
  const cap = (list) => ({count: list.length, items: list.slice(0, LIMIT)});
  return {
    url: location.pathname + location.search.replace(/harnessSession=[^&]*&?/, ''),
    mode: document.documentElement.getAttribute('data-laolao-mode'),
    theme: document.documentElement.getAttribute('data-theme-mode'),
    smallText: cap(smallText.sort((x, y) => x.ratio - y.ratio)),
    border: cap(border.sort((x, y) => x.ratio - y.ratio)),
    icon: cap(icon.sort((x, y) => x.ratio - y.ratio)),
    overlap: cap(overlap.sort((x, y) => y.area - x.area)),
    truncated: cap(truncated),
  };
}, limit);

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const record = async (page, name) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file), animations: 'disabled', caret: 'hide'});
  lines.push({
    name, file, os: process.platform, browser: engine || 'chromium',
    width: page.viewportSize().width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  });
};

const openSidebar = async (page) => {
  if (page.viewportSize().width >= 1100) return;
  const opener = page.locator('button[aria-label="展开侧边栏"], button[aria-label="打开侧边栏"]').first();
  if (await opener.count() && await opener.isVisible().catch(() => false)) await opener.click().catch(() => {});
  await page.waitForTimeout(300);
};

const STEPS = [
  ['home', async () => {}],
  ['chat', async (page) => {
    await page.evaluate(() => window.__laolaoStartupHome?.leave?.());
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-laolao-startup-home'), {timeout: 5_000});
    await page.waitForSelector('.laolao-desensitize-btn', {state: 'attached', timeout: 5_000}).catch(() => {});
  }],
  ['artifacts', async (page) => {
    await page.waitForFunction(() => typeof window.PinkieArtifacts?.open === 'function', {timeout: 10_000});
    await page.evaluate(() => window.PinkieArtifacts.open());
    await page.waitForSelector('.pinkie-art-page', {state: 'visible', timeout: 10_000});
    await page.waitForFunction(() => document.querySelector('.pinkie-art-grid')?.childElementCount > 0, {timeout: 10_000}).catch(() => {});
  }, async (page) => page.evaluate(() => window.PinkieArtifacts?.close?.())],
  ['workbench', async (page) => {
    const reopen = page.locator('.pk-wb-reopen').first();
    await reopen.waitFor({state: 'visible', timeout: 10_000});
    await reopen.click();
    await page.waitForFunction(() => document.documentElement.dataset.pinkieWb === 'on', {timeout: 10_000});
  }],
  ['settings', async (page) => {
    await openSidebar(page);
    const link = page.locator('a.sidebar-footer-icon[aria-label="设置"]').first();
    await link.waitFor({state: 'visible', timeout: 10_000});
    await link.click();
    await page.waitForFunction(() => (
      location.pathname.startsWith('/settings')
      && document.body.getAttribute('data-pinkie-user-settings') === '1'
      && Boolean(document.querySelector('#laolao-user-settings:not([hidden])'))
    ), {timeout: 10_000});
  }],
];

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'home-unrestricted', theme, {
    timezoneId: 'Asia/Shanghai',
  });
  const tag = `${width}-${theme}`;
  const pages = [];
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForTimeout(400);
    for (const [name, enter, exit] of STEPS) {
      const row = {page: name};
      try {
        await enter(page);
        await page.waitForTimeout(350);
        await record(page, `${name}-${tag}`);
        Object.assign(row, await measure(page, LIMIT));
      } catch (error) {
        row.error = String(error?.message || error).split('\n')[0];
        await record(page, `${name}-${tag}-error`).catch(() => {});
      }
      if (exit) await exit(page).catch(() => {});
      pages.push(row);
    }
  } finally {
    report.push({theme, width, pageErrors: pageErrors.slice(0, 5), pages});
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell(theme, width);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
