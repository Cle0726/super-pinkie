// B11 全页面走查（Metre）：回答下面「Sources」来源行的小字、侧栏「筛选」菜单的计数，对它们实际所在的底要 ≥ 4.5:1。
// 复发防护：这几处原来直接用 --metre-muted（日间 #77736B）当字色，真页面量出来（1440 / 820 都一样）：
//   「Sources」在页面底 #F7F6F3 上 4.37:1；编号「1」在它自己的 --metre-hover 底 #EFEDE8 上 4.03:1；
//   网站名「nodejs.org」悬停签条时落在 #EFEDE8 上 4.03:1；筛选菜单的数字悬停行时 4.03:1、按下时（--metre-side-active）日间 3.51:1、夜间 4.41:1。
// 反例（写在测试里）：把这几处换回 var(--metre-muted)，同一套计算必须量出 < 4.5:1。
// 第一段不起浏览器：读皮肤里日、夜两组 Metre 变量，按 srgb 算 color-mix，再算 WCAG 对比度；
// 第二段（有 Chromium 才跑）：把皮肤变量 + 两张样式表放进页面，读计算后的颜色再量一次，证明层叠里没有别的规则压掉它。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const skin = read('../ui/injections/laolao-metre-skin.css');
const citeCss = read('../ui/injections/laolao-metre-cite.css');
const wsCss = read('../ui/injections/laolao-metre-workspace.css');

// 皮肤里「最后生效的那一组」日间 / 夜间变量（laolao-metre-skin.css 第十段，改颜色只改这两段）。
function block(head) {
  const at = skin.indexOf(head);
  assert.ok(at >= 0, `皮肤里找不到变量段：${head}`);
  return skin.slice(at, skin.indexOf('}', at));
}
const NAMES = ['bg', 'surface', 'text', 'muted', 'hover', 'side-active', 'accent'];
function vars(text) {
  const out = {};
  for (const n of NAMES) {
    const m = text.match(new RegExp(`--metre-${n}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(m, `变量段里没有 --metre-${n}`);
    out[n] = m[1];
  }
  return out;
}
const THEMES = {
  day: vars(block('html[data-laolao-mode="metre"]:not(#_m1):not(#_m2) {\n')),
  night: vars(block('html[data-laolao-mode="metre"]:not(#_m1):not(#_m2)[data-pinkie-night],\n')),
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// 只认这几处真的会出现的写法：var(--metre-x[, 兜底])、var(--pk-mcite-ink)、color-mix(in srgb, A p%, B)。
function evalColor(expr, v, local = {}) {
  expr = expr.trim();
  let m = expr.match(/^var\(--metre-([a-z-]+)(?:,[^)]*)?\)$/);
  if (m) { assert.ok(v[m[1]], `没有 --metre-${m[1]}`); return rgb(v[m[1]]); }
  m = expr.match(/^var\((--pk-[a-z-]+)\)$/);
  if (m) { assert.ok(local[m[1]], `${m[1]} 没定义`); return evalColor(local[m[1]], v, local); }
  m = expr.match(/^color-mix\(in srgb,\s*(var\([^)]*\))\s+(\d+(?:\.\d+)?)%,\s*(var\([^)]*\))\)$/);
  if (m) {
    const a = evalColor(m[1], v, local), b = evalColor(m[3], v, local), p = Number(m[2]) / 100;
    return a.map((x, i) => Math.round(x * p + b[i] * (1 - p)));
  }
  throw new Error(`不认识的颜色写法：${expr}`);
}

// 在样式表里找某条规则（选择器原文）的某个声明。
function decl(css, selector, prop) {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, `找不到规则：${selector}`);
  const body = css.slice(at + selector.length + 2, css.indexOf('}', at));
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop.replace(/-/g, '\\-')}:\\s*([^;]+?);`));
  assert.ok(m, `${selector} 里没有 ${prop}`);
  return m[1];
}

const M = 'html[data-laolao-mode="metre"]';
const ROW = `${M} .pinkie-sources.pk-mcite-row`;
// 每处小字：选择器、所在的底（变量名，不止一种时逐个量）。
const CASES = (cite, ws) => [
  {name: '来源行「Sources」', css: cite, sel: `${M} .pk-mcite-row__label`, on: ['bg']},
  {name: '来源签条编号', css: cite, sel: `${M} .pk-mcite-chip__n`, on: ['hover']},
  {name: '来源签条网站名', css: cite, sel: `${M} .pk-mcite-chip__host`, on: ['surface', 'hover']},
  {name: '筛选菜单计数', css: ws, sel: `${M} .pk-mw-filter-menu__count`, on: ['surface', 'hover', 'side-active']},
];

function measureAll(cite, ws) {
  const local = {};
  const ink = cite.slice(cite.indexOf(ROW + ' {')).match(/--pk-mcite-ink:\s*([^;]+?);/);
  if (ink) local['--pk-mcite-ink'] = ink[1];
  const rows = [];
  for (const [theme, v] of Object.entries(THEMES)) {
    for (const c of CASES(cite, ws)) {
      const fg = evalColor(decl(c.css, c.sel, 'color'), v, local);
      for (const on of c.on) rows.push({theme, name: c.name, on, ratio: ratio(fg, rgb(v[on]))});
    }
  }
  return rows;
}
const low = (rows) => rows.filter((r) => r.ratio < 4.5).map((r) => `${r.theme} ${r.name} 在 --metre-${r.on} 上 ${r.ratio.toFixed(2)}:1`);

test('B11：来源行小字和筛选菜单计数，日夜对所在的底都 ≥ 4.5:1（不起浏览器）', () => {
  const rows = measureAll(citeCss, wsCss);
  assert.equal(rows.length, 2 * 7);
  assert.deepEqual(low(rows), []);
  // 夜间本来就够，不许为了日间把夜间拉低。
  for (const r of rows.filter((x) => x.theme === 'night')) assert.ok(r.ratio >= 5, `${r.name} 夜间 ${r.ratio.toFixed(2)}:1`);
});

// 反例：换回纯 --metre-muted（main 上原来的写法），必须量出不到 4.5。
const revert = (css) => css.replace(/color: var\(--pk-mcite-ink\)/g, 'color: var(--metre-muted, #73726C)')
  .replace(/color: color-mix\(in srgb, var\(--metre-muted\) 78%, var\(--metre-text\)\)/g, 'color: var(--metre-muted)');
test('B11 反例：换回纯 --metre-muted 时，日间那几处必须不到 4.5:1', () => {
  const bad = low(measureAll(revert(citeCss), revert(wsCss)));
  for (const want of ['day 来源行「Sources」 在 --metre-bg 上 4.37', 'day 来源签条编号 在 --metre-hover 上 4.03',
    'day 来源签条网站名 在 --metre-hover 上 4.03', 'day 筛选菜单计数 在 --metre-hover 上 4.03', 'day 筛选菜单计数 在 --metre-side-active 上 3.51',
    'night 筛选菜单计数 在 --metre-side-active 上 4.41']) {
    assert.ok(bad.some((line) => line.startsWith(want)), `反例里应有「${want}」，实际：${bad.join('；')}`);
  }
});

test('B11：只在 Metre 里、不加强制覆盖、文件不变长', () => {
  for (const css of [citeCss, wsCss]) {
    for (const line of css.split('\n').filter((l) => /pk-mcite-ink|filter-menu__count/.test(l))) {
      assert.doesNotMatch(line, /!important/);
      if (/\{/.test(line)) assert.match(line, /^html\[data-laolao-mode="metre"\] /);
    }
  }
  assert.ok(citeCss.split('\n').length <= 122 && wsCss.split('\n').length <= 100, '两张样式表都没有多出行');
});

// ---------- 浏览器里再量一次：计算后的颜色 ----------
// 整个文件只起一个浏览器、一张页面，日夜正反例都靠 setContent 换内容；after 里先关页面再关浏览器。
let shared;
after(async () => {
  const s = await shared;
  await s?.page?.close?.();
  await s?.browser?.close?.();
});
async function launch() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function start() {
  const browser = await launch();
  if (browser.why) return browser;
  try {
    return {browser, page: await browser.newPage({viewport: {width: 820, height: 400}})};
  } catch (e) {
    await browser.close();
    throw e;
  }
}
const varCss = (v, night) => `html[data-laolao-mode="metre"]${night ? '[data-pinkie-night]' : ''} {${Object.entries(v).map(([k, x]) => `--metre-${k}:${x};`).join('')}}`;
const html = (theme, cite, ws) => `<!doctype html><html data-laolao-mode="metre"${theme === 'night' ? ' data-pinkie-night' : ''}><head>
<style>${varCss(THEMES[theme], theme === 'night')} body{margin:0;padding:20px;background:var(--metre-bg)}</style><style>${cite}</style><style>${ws}</style></head><body>
<div class="chat-group assistant"><div class="pinkie-sources pk-mcite-row"><span class="pinkie-sources__label pk-mcite-row__label">Sources</span>
<a class="pinkie-sources__item pk-mcite-chip" href="#"><span class="pk-mcite-chip__n">1</span><span class="pk-mcite-chip__title">Node.js 22 发布说明</span><span class="pk-mcite-chip__host">nodejs.org</span></a></div></div>
<div class="pk-mw-filter-menu" style="position:static"><button class="pk-mw-filter-menu__item"><span class="pk-mw-filter-menu__label">全部会话</span><span class="pk-mw-filter-menu__count">3</span></button></div>
</body></html>`;
async function computed(page) {
  return page.evaluate(() => {
    const parse = (s) => {
      const srgb = s.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
      if (srgb) return srgb.slice(1, 4).map((x) => Math.round(Number(x) * 255));
      const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      if (m) return m.slice(1, 4).map(Number);
      throw new Error('看不懂的颜色：' + s);
    };
    const c = (sel) => parse(getComputedStyle(document.querySelector(sel)).color);
    return {label: c('.pk-mcite-row__label'), n: c('.pk-mcite-chip__n'), host: c('.pk-mcite-chip__host'), count: c('.pk-mw-filter-menu__count')};
  });
}

test('B11：浏览器里计算后的颜色也 ≥ 4.5:1，换回旧写法就不到（日夜）', async (t) => {
  shared ??= start();
  const s = await shared;
  if (s.why) { t.skip(s.why); return; }
  const {page} = s;
  for (const theme of ['day', 'night']) {
    const v = THEMES[theme];
    await page.setContent(html(theme, citeCss, wsCss));
    const got = await computed(page);
    const pairs = [['label', 'bg'], ['n', 'hover'], ['host', 'surface'], ['host', 'hover'], ['count', 'surface'], ['count', 'hover'], ['count', 'side-active']];
    for (const [k, on] of pairs) {
      const r = ratio(got[k], rgb(v[on]));
      t.diagnostic(`${theme} ${k} rgb(${got[k]}) on ${v[on]} ${r.toFixed(2)}:1`);
      assert.ok(r >= 4.5, `${theme} ${k} 在 --metre-${on} 上只有 ${r.toFixed(2)}:1`);
    }
    if (theme === 'day') {
      await page.setContent(html(theme, revert(citeCss), revert(wsCss)));
      const old = await computed(page);
      assert.ok(ratio(old.label, rgb(v.bg)) < 4.5 && ratio(old.n, rgb(v.hover)) < 4.5 && ratio(old.count, rgb(v.hover)) < 4.5,
        `反例没生效：${JSON.stringify(old)}`);
    }
  }
});
