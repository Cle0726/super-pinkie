// B11 走查脚本误报（协调者 11-26 09:45）：思考强度牌「关闭」（.pinkie-external-tier）用 background-clip:text 画字，
// backgroundColor 就是墨色，tools/pr-shots/b11-learning-walkthrough.mjs 按 color 对 backgroundColor 算出 1.04。
// 修法：这类字交给 tools/pr-shots/clip-text-ink.mjs 按像素量（有字 / 藏字两张截图逐像素比，按半个字宽分段取最浅段）。
// 这里在真浏览器里核：
//   ① 深色 clip-text（off 档 #605a65）像素量 ≥ 4.5，而旧算法（color 对 backgroundColor）只有 ~1——反例；
//   ② 很浅的渐变 clip-text 量出 < 4.5，且报的是最浅那段、低于中位；
//   ③ 普通实色字：像素量和计算色算出的对比度相差不到 0.3（量法本身是准的）。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {playwright} from '../tools/study-desk/harness.mjs';
import {clipTextInk, decodePng} from '../tools/pr-shots/clip-text-ink.mjs';

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const CLIP = 'display:inline-block;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:inherit';
const page = (style, text = '关闭') => `<!doctype html><html><body style="margin:0;background:#fff;font:760 12px/1.25 system-ui,sans-serif">
<div style="padding:20px"><span id="t" style="${style}">${text}</span></div></body></html>`;

let shared;
after(async () => { const b = await shared; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) {
    try { return await lib.chromium.launch({headless: true, ...options}); } catch {}
  }
  return {why: 'no Chromium browser here'};
}
async function withPage(fn) {
  shared ??= start();
  const b = await shared;
  if (b.why) return b.why;
  const p = await b.newPage({viewport: {width: 300, height: 120}, deviceScaleFactor: 2});
  try { await fn(p); } finally { await p.close(); }
  return '';
}
const inkOf = async (p) => {
  const r = await p.locator('#t').boundingBox();
  const clip = {x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4};
  return clipTextInk(p, '#t', clip, 12);
};
// 旧算法：color（透明字色就退回 backgroundColor 叠白）对 backgroundColor 叠白。
const oldRatio = (p) => p.evaluate(() => {
  const s = getComputedStyle(document.querySelector('#t'));
  const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const [r, g, b, a = 1] = parse(s.backgroundColor);
  const bg = [r, g, b].map((v) => v * a + 255 * (1 - a));
  const [cr, cg, cb] = parse(s.color);
  const fg = [cr, cg, cb];
  const L = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = L(fg), y = L(bg);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
});

test('decodePng 读得回 Playwright 截图的颜色', async (t) => {
  const why = await withPage(async (p) => {
    await p.setContent('<body style="margin:0;background:rgb(10,200,90)"></body>');
    const png = decodePng(await p.screenshot({clip: {x: 0, y: 0, width: 8, height: 6}}));
    assert.equal(png.width, 16);
    assert.equal(png.height, 12);
    assert.deepEqual(png.rgb(5, 7), [10, 200, 90]);
  });
  if (why) t.skip(why);
});

test('深色 background-clip:text：像素量 ≥ 4.5，旧算法只有 ~1（误报复现）', async (t) => {
  const why = await withPage(async (p) => {
    await p.setContent(page(`${CLIP};background:#605a65;color:#605a65`));
    const ink = await inkOf(p);
    const old = await oldRatio(p);
    t.diagnostic(`pixels ${ink.ratio} (median ${ink.median}, ${ink.bins} bins) / old ${old.toFixed(2)}`);
    assert.ok(old < 1.5, `反例没复现：旧算法 ${old.toFixed(2)}`);
    assert.ok(ink.ratio >= 4.5, `像素量只有 ${ink.ratio}`);
    assert.ok(ink.bins >= 2);
  });
  if (why) t.skip(why);
});

test('很浅的渐变 clip-text：报最浅那段 < 4.5，且低于中位', async (t) => {
  const why = await withPage(async (p) => {
    await p.setContent(page(`${CLIP};background:linear-gradient(90deg,#4a3f55 0%,#4a3f55 45%,#f3e9f2 55%,#f3e9f2 100%);color:#4a3f55`, '关闭关闭'));
    const ink = await inkOf(p);
    t.diagnostic(`pixels ${ink.ratio} (median ${ink.median}, ${ink.bins} bins)`);
    assert.ok(ink.ratio < 4.5, `浅段没量出来：${ink.ratio}`);
    assert.ok(ink.ratio < ink.median, '最浅段应低于中位');
  });
  if (why) t.skip(why);
});

test('普通实色字：像素量和计算色对比度相差不到 0.3', async (t) => {
  const why = await withPage(async (p) => {
    for (const hex of ['#605a65', '#8d72a1', '#2b2328']) {
      await p.setContent(page(`color:${hex}`));
      const ink = await inkOf(p);
      const want = contrast(hexRgb(hex), [255, 255, 255]);
      t.diagnostic(`${hex} pixels ${ink.ratio} vs ${want.toFixed(2)}`);
      assert.ok(Math.abs(ink.median - want) < 0.3, `${hex} 像素中位 ${ink.median}，应约 ${want.toFixed(2)}`);
    }
  });
  if (why) t.skip(why);
});
