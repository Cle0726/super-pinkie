// B-C3 / B-T3：Metre 里 diff 代码块配色、从右往左的文字（laolao-metre-code.css）。
// 复发防护：
//   1. 原生 hljs 的 +/- 行是 GitHub 夜间主题的浅绿浅红，Metre 日间谱纸底上对比度只有 1.30 / 1.63（11-24 静态页实测）。
//      Metre 日夜都要 ≥ 4.5，底色铺满整行，不撑出代码块。
//   2. 阿拉伯文段落要从右往左排（第一个字在右边）；代码块永远从左往右。
//   3. 其他模式一个字不动。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const head = read('../ui/injections/laolao-head.fragment.html');
const regions = JSON.parse(read('../ui/injections/regions.json'));
const css = read('../ui/injections/laolao-metre-code.css');
const PORT = 30124;
// 只带上和代码块、对话区有关的原生 CSS 太难挑，这里用原生 hljs 的那几条（和打包里一样的值）+ 本文件。
const nativeHljs = '.hljs-addition{color:#7ee787;background:#2ea0431f}.hljs-deletion{color:#ffa198;background:#f851491f}.hljs-meta{color:#c9d1d9}';
const code = '<span class="hljs-meta">@@ -1,3 +1,3 @@</span>\n const a = 1;\n<span class="hljs-deletion">-const b = 2;</span>\n<span class="hljs-addition">+const b = 3;</span>\n const c = 4;';
const page = (mode, night) => `<!doctype html><html data-laolao-mode="${mode}"${night ? ' data-pinkie-night="1"' : ''}><head><style>
body { margin: 0; background: ${night ? '#151514' : '#F7F6F3'}; color: ${night ? '#F1E6EC' : '#1B1A18'}; font: 15px/1.6 system-ui; }
pre { margin: 0; padding: 12px; overflow-x: auto; background: ${night ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.52)'}; }
${nativeHljs}</style><style>${css}</style></head><body>
<div class="chat-bubble" style="width:640px;margin:20px"><div class="chat-text">
<div class="code-block-wrapper"><pre id="diff"><code class="hljs language-diff">${code}</code></pre></div>
<p id="ar">مرحبا بالعالم، هذا اختبار 123.</p>
<p id="zh">中文段落 English mixed，照常从左往右。</p>
<pre id="code"><code class="language-js">const x = "مرحبا";</code></pre>
</div></div></body></html>`;

// 整个文件只起一个浏览器（CI 里测试文件并行跑，多起会拖慢别的文件里的浏览器测试）。
let sharedBrowser;
after(async () => { const b = await sharedBrowser; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function launch(t) {
  sharedBrowser ??= start();
  const b = await sharedBrowser;
  if (b.why) { t.skip(b.why); return null; }
  return {newPage: (...a) => b.newPage(...a), close: async () => { for (const c of b.contexts()) await c.close(); }};
}
async function open(browser, mode, night) {
  const tab = await browser.newPage({viewport: {width: 900, height: 600}});
  await tab.route(`http://127.0.0.1:${PORT}/**`, route => route.fulfill({contentType: 'text/html; charset=utf-8', body: page(mode, night)}));
  await tab.goto(`http://127.0.0.1:${PORT}/chat`);
  return tab;
}
// 在页面里算：字色叠在（自己的底 → 代码块底 → 页面底）上面的对比度
const measure = tab => tab.evaluate(() => {
  const parse = c => { const unit = /^color\(srgb/.test(c); const n = c.replace(/^color\(srgb/, '').match(/\d*\.?\d+/g).map(Number); const [r, g, b] = n.slice(0, 3).map(v => unit ? v : v / 255); return {r, g, b, a: n.length > 3 ? n[3] : 1}; };
  const over = (f, b) => ({r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1});
  const lum = ({r, g, b}) => [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const backdrop = el => { const layers = []; for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) layers.push(c); } return layers.reverse().reduce((acc, c) => over(parse(c), acc), {r: 1, g: 1, b: 1, a: 1}); };
  const pre = document.querySelector('#diff');
  const box = pre.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(pre).paddingLeft);
  const one = sel => { const e = pre.querySelector(sel); const r = e.getBoundingClientRect(); return {ratio: +ratio(parse(getComputedStyle(e).color), backdrop(e)).toFixed(2), left: Math.round(r.left - box.left), right: Math.round(box.right - r.right), width: Math.round(r.width)}; };
  return {add: one('.hljs-addition'), del: one('.hljs-deletion'), meta: one('.hljs-meta'), inner: Math.round(box.width - 2 * pad), pad, scroll: pre.scrollWidth > pre.clientWidth + 1};
});
// 段落第一个字在左边还是右边
const firstCharSide = (tab, id) => tab.evaluate(id => {
  const p = document.getElementById(id); const range = document.createRange(); const text = p.firstChild;
  range.setStart(text, 0); range.setEnd(text, 1);
  const r = range.getBoundingClientRect(), box = p.getBoundingClientRect();
  return (r.left - box.left) < (box.right - r.right) ? 'left' : 'right';
}, id);

test('loaded after the Metre engine files, owned by the metre region, CSS only, no !important', () => {
  const at = name => head.indexOf(`/${name}?v=@hash`);
  assert.ok(at('laolao-metre-code.css') > at('laolao-metre-engine.js'));
  const metre = Object.values(regions.regions || regions).find(region => (region.files || []).includes('laolao-metre-engine.js'));
  assert.ok(metre?.files.includes('laolao-metre-code.css'));
  assert.doesNotMatch(css, /!important/);
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(s => s.trim()).filter(Boolean)) {
    for (const selector of rule.split('{')[0].split(/,(?![^(]*\))/)) assert.match(selector.trim(), /^html\[data-laolao-mode="metre"\]/, 'every rule is scoped to Metre: ' + selector.trim());
  }
});

test('in Metre, diff lines are readable day and night and their tint fills the whole line inside the block', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    for (const night of [false, true]) {
      const tab = await open(browser, 'metre', night);
      const m = await measure(tab);
      for (const k of ['add', 'del', 'meta']) assert.ok(m[k].ratio >= 4.5, `${night ? 'night' : 'day'} ${k} contrast ${m[k].ratio}`);
      for (const k of ['add', 'del']) {
        assert.ok(m[k].width >= m.inner - 1, `${k} tint covers the line: ${m[k].width} vs ${m.inner}`);
        assert.ok(m[k].left >= -1 && m[k].right >= -1, `${k} tint stays inside the block`);
      }
      assert.equal(m.scroll, false, 'the tint does not add a horizontal scroll');
      await tab.close();
    }
  } finally { await browser.close(); }
});

test('in Metre, an Arabic paragraph runs right to left; Chinese / English and code stay left to right', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'metre', false);
    assert.equal(await firstCharSide(tab, 'ar'), 'right');
    assert.equal(await firstCharSide(tab, 'zh'), 'left');
    assert.equal(await tab.locator('#code').evaluate(e => getComputedStyle(e).direction), 'ltr');
  } finally { await browser.close(); }
});

test('in other modes nothing changes', {timeout: 60_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  try {
    const tab = await open(browser, 'chat', false);
    const look = await tab.evaluate(() => ({add: getComputedStyle(document.querySelector('.hljs-addition')).color, display: getComputedStyle(document.querySelector('.hljs-addition')).display, bidi: getComputedStyle(document.getElementById('ar')).unicodeBidi}));
    // 浏览器默认 p 的 unicode-bidi 就是 isolate；只要求本文件的 plaintext 没生效、阿拉伯文段落仍跟着整页从左往右
    assert.equal(look.add, 'rgb(126, 231, 135)');
    assert.equal(look.display, 'inline');
    assert.notEqual(look.bidi, 'plaintext');
    assert.equal(await firstCharSide(tab, 'ar'), 'left');
  } finally { await browser.close(); }
});
