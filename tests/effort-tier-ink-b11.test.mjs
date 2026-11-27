// B11 学习表后续（协调者 11-26 09:45 (b)）：思考强度渐变档（Minimal…Ultra）日间字最浅处只有 1.18–1.68:1。
// 原因：laolao-model-picker.css 每档的 --pinkie-outside-ink 渐变里有接近白色的高光色标（#fff0dc、#fff8e9…），
// 流光扫到哪个字母，那个字母就几乎看不见。
// 修法：只改这 8 行渐变里不够线的色标——往本档最深的色标混到约 5.2:1（对日间输入框底 #fffaf9，取整成 hex 后 5.19–5.27），保留本档色相；
// 渐变形状、动效、光晕、下划线不动。夜间用自己的 background-image（更高优先级）、Metre 用 !important 换实色，都不受影响。
// 这里：
//   ① 日间 8 个渐变档 × 5 个流光位置，按像素量（tools/pr-shots 的 clip-text 量法），最浅段 ≥ 4.5；
//      反例：main 原样（把 8 行色标换回去）至少有一档 < 4.5；
//   ② 文件里这 8 行所有色标对 #fffaf9 都 ≥ 5.1:1（留余量，真正的线是像素量 4.5）；
//   ③ 夜间和 Metre：有没有这次改动，「关闭」以外各档的计算样式逐项相同。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const FILES = ['laolao-theme.css', 'laolao-composer-tray.css', 'laolao-model-picker.css', 'laolao-night.css', 'laolao-metre-skin.css'];
const sheets = Object.fromEntries(FILES.map((f) => [f, read(`../ui/injections/${f}`)]));
const picker = sheets['laolao-model-picker.css'];
const TIERS = {minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', adaptive: 'Adaptive', max: 'Max', ultra: 'Ultra'};
// main 上这 8 行的渐变色标（反例用）。
const MAIN_INK = {
  minimal: 'linear-gradient(100deg,#625a70 8%,#d5c8d8 37%,#736781 61%,#625a70 90%)',
  low: 'linear-gradient(100deg,#5c4e73 6%,#a88ac3 33%,#eee1ee 49%,#735a93 70%,#5c4e73 94%)',
  medium: 'linear-gradient(100deg,#805065 5%,#cf8f97 32%,#ffe6cb 48%,#ba758a 69%,#805065 94%)',
  high: 'linear-gradient(100deg,#79395f 4%,#e967a3 27%,#fff0dc 42%,#e779b5 58%,#8b3c75 82%,#79395f 96%)',
  xhigh: 'linear-gradient(100deg,#62416e 2%,#b65f9c 24%,#f2c4e4 38%,#fff2e7 48%,#a775cf 66%,#62416e 95%)',
  adaptive: 'linear-gradient(100deg,#385b71 2%,#78abae 24%,#d8efe0 43%,#9c83c0 63%,#385b71 95%)',
  max: 'linear-gradient(100deg,#793a61 2%,#d86f98 21%,#ffe2a9 37%,#fff8e9 48%,#dc8a7c 66%,#793a61 95%)',
  ultra: 'linear-gradient(100deg,#6b4380 2%,#d66cae 19%,#bdebe8 36%,#fff2f0 48%,#c07ce7 64%,#6b4380 95%)',
};
const inkLine = (css, tier) => css.split('\n').find((l) => l.includes(`data-pinkie-outside-material="${tier}"]`) && l.includes('--pinkie-outside-ink'));
const reverted = picker.split('\n').map((l) => {
  const t = Object.keys(TIERS).find((k) => l.includes(`data-pinkie-outside-material="${k}"]`) && l.includes('--pinkie-outside-ink'));
  return t ? l.replace(/linear-gradient\(100deg,[^)]*\)/, MAIN_INK[t]) : l;
}).join('\n');

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// 和 tools/pr-shots/clip-text-ink.mjs 同一量法（那个模块在另一个 PR 里，这里内联一份最小实现，免得互相等合并）。
function decodePng(buf) {
  let o = 8, w = 0, h = 0, type = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; } else if (kind === 'IDAT') idat.push(d); else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const ch = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[up + x] : 0, c = x >= ch && y ? px[up + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return {width: w, height: h, rgb: (x, y) => { const i = y * stride + x * ch; return [px[i], px[i + 1], px[i + 2]]; }};
}
function palest(withBuf, withoutBuf, binPx) {
  const A = decodePng(withBuf), B = decodePng(withoutBuf), cols = [];
  for (let x = 0; x < A.width; x++) {
    let best = 1, n = 0;
    for (let y = 0; y < A.height; y++) { const r = contrast(A.rgb(x, y), B.rgb(x, y)); if (r > 1.15) n++; if (r > best) best = r; }
    cols.push(n >= 2 ? best : 0);
  }
  const step = Math.max(2, Math.round(binPx)), bins = [];
  for (let x = 0; x < cols.length; x += step) { const s = cols.slice(x, x + step).filter(Boolean); if (s.length >= Math.max(2, step * 0.4)) bins.push(Math.max(...s)); }
  return bins.length ? Math.min(...bins) : 1;
}

const page = (mode, night, pickerCss, tier, pos) => `<!doctype html><html data-theme="${night ? 'dark' : 'light'}" data-laolao-mode="${mode}"${night ? ' data-pinkie-night=""' : ''}><head>
${FILES.map((f) => `<style>${f === 'laolao-model-picker.css' ? pickerCss : sheets[f]}</style>`).join('\n')}
${pos ? `<style>.pinkie-external-tier{animation:none!important;background-position:${pos} 50%!important}</style>` : ''}
<style>body{margin:0;background:${night ? '#100b13' : '#fffaf9'}}</style></head><body>
<div class="agent-chat__input" style="display:flex;align-items:center;gap:8px;padding:16px">
<details class="chat-controls__model" data-pinkie-outside-material="${tier}" data-pinkie-material="${tier}"><summary class="chat-controls__inline-select-trigger"><span class="chat-controls__inline-select-label pinkie-trigger-label"><span class="pinkie-external-model-name">gemini-3.6-flash</span> · <span class="pinkie-external-tier" id="legacy">${TIERS[tier]}</span></span></summary></details>
<button type="button" class="pinkie-effort-trigger" data-pinkie-material="${tier}"><span class="pinkie-external-tier" id="effort">${TIERS[tier]}</span></button>
</div></body></html>`;

let shared;
after(async () => { const b = await shared; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  for (const options of [{}, {channel: 'chrome'}, {channel: 'msedge'}]) { try { return await lib.chromium.launch({headless: true, ...options}); } catch {} }
  return {why: 'no Chromium browser here'};
}
async function withPage(fn) {
  shared ??= start();
  const b = await shared;
  if (b.why) return b.why;
  const p = await b.newPage({viewport: {width: 520, height: 90}, deviceScaleFactor: 2});
  try { await fn(p); } finally { await p.close(); }
  return '';
}
async function worstOf(p, pickerCss, mode) {
  let worst = 99, at = '';
  for (const tier of Object.keys(TIERS)) for (const pos of ['0%', '25%', '50%', '75%', '100%']) {
    await p.setContent(page(mode, false, pickerCss, tier, pos));
    for (const id of ['effort', 'legacy']) {
      const r = await p.locator('#' + id).boundingBox();
      const clip = {x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4};
      const a = await p.screenshot({clip});
      const tag = await p.addStyleTag({content: `#${id}{color:transparent!important;-webkit-text-fill-color:transparent!important;background:none!important;filter:none!important}`});
      const b = await p.screenshot({clip});
      await tag.evaluate((n) => n.remove());
      const k = palest(a, b, 12);
      if (k < worst) { worst = k; at = `${tier} ${id} @${pos}`; }
    }
  }
  return {worst, at};
}

test('B11 强度牌：8 行渐变色标对日间底都 ≥ 5.1:1，main 原样有色标不到', () => {
  for (const tier of Object.keys(TIERS)) {
    const line = inkLine(picker, tier);
    assert.ok(line, `找不到 ${tier} 的渐变行`);
    const ink = line.match(/--pinkie-outside-ink:\s*(linear-gradient\(100deg,[^)]*\))/)[1];
    for (const h of ink.match(/#[0-9a-f]{6}/gi)) assert.ok(contrast(hexRgb(h), [255, 250, 249]) >= 5.1, `${tier} 色标 ${h} 不够 5.1`);
    const old = MAIN_INK[tier].match(/#[0-9a-f]{6}/gi);
    assert.ok(old.some((h) => contrast(hexRgb(h), [255, 250, 249]) < 4.5), `反例：main 的 ${tier} 应有浅色标`);
  }
  assert.notEqual(reverted, picker);
  assert.equal(picker.split('\n').length, reverted.split('\n').length, '只换色标、不加减行');
});

test('B11 强度牌：日间 5 个模式 × 8 档 × 5 个流光位置，像素量最浅段 ≥ 4.5；换回 main 就不到', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of ['chat', 'project', 'thinking', 'learning', 'unrestricted']) {
      const now = await worstOf(p, picker, mode);
      t.diagnostic(`${mode} palest ${now.worst.toFixed(2)} (${now.at})`);
      assert.ok(now.worst >= 4.5, `${mode} 最浅 ${now.worst.toFixed(2)}：${now.at}`);
    }
    const old = await worstOf(p, reverted, 'chat');
    t.diagnostic(`main chat palest ${old.worst.toFixed(2)} (${old.at})`);
    assert.ok(old.worst < 4.5, `反例没生效：main 最浅也有 ${old.worst.toFixed(2)}`);
  });
  if (why) t.skip(why);
});

test('B11 强度牌：夜间五个模式和 Metre 日夜，有没有这次改动计算样式一样', async (t) => {
  const why = await withPage(async (p) => {
    const snap = () => p.evaluate(() => [...document.querySelectorAll('.pinkie-external-tier')].map((n) => {
      const s = getComputedStyle(n);
      return [s.backgroundImage, s.backgroundSize, s.color, s.webkitTextFillColor, s.filter].join(' | ');
    }));
    for (const [mode, night] of [...['chat', 'project', 'thinking', 'learning', 'unrestricted'].map((m) => [m, true]), ['metre', false], ['metre', true]]) {
      for (const tier of Object.keys(TIERS)) {
        await p.setContent(page(mode, night, picker, tier, ''));
        const now = await snap();
        await p.setContent(page(mode, night, reverted, tier, ''));
        assert.deepEqual(now, await snap(), `${mode}${night ? ' 夜间' : ' 日间'} ${tier} 被这次改动影响了`);
      }
    }
  });
  if (why) t.skip(why);
});
