// B11 学习表（docs/b11-walkthrough/learning.md）：日间侧栏分组标题、计数、分组按钮、会话时间太淡——
//   原弱化色 accent 18% + #9a8b92 在浅色侧栏上只有 3.1–3.5:1，再叠 laolao-sidebar.css 的 .45–.7 透明度只剩约 2:1（走查量到 3.39 / 3.61–4.22）。
// 修法（laolao-sidebar-surface.css 第一段后面）：日间五个碧琪模式换 #6e6067、文字不透明、分组按钮 .8。
// 这里在浏览器里放真样式表 + 和 laolao-session-list.js 一样的侧栏结构，读计算后的颜色和祖先透明度，按最亮的底（白）算：
//   ① 日间五个模式：标题 / 计数 / 日期 / 时间 ≥ 4.5:1，分组按钮 ≥ 3:1；
//   ② 反例：删掉这几行（main 原样），同一套量法必须不到 4.5:1；
//   ③ 夜间五个模式和 Metre 日夜：有没有这几行，计算结果逐项相同；
//   ④ 鼠标移到分组头上，分组按钮仍是 1（没把悬停态钉在 .8）。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const FILES = ['laolao-theme.css', 'laolao-sidebar.css', 'laolao-sidebar-surface.css', 'laolao-night.css', 'laolao-metre-contrast.css'];
const sheets = Object.fromEntries(FILES.map((f) => [f, read(`../ui/injections/${f}`)]));
const SCOPE = ':not([data-pinkie-night]):not([data-laolao-mode="metre"])';
const surface = sheets['laolao-sidebar-surface.css'];
// 反例：去掉日间这几条规则（含变量段的三行），等于 main 原来的写法。
function revert(css) {
  const out = []; let skip = false;
  for (const line of css.split('\n')) {
    if (skip) { if (line.trim() === '}') skip = false; continue; }
    if (!line.includes(SCOPE)) { out.push(line); continue; }
    if (line.trimEnd().endsWith('{')) skip = true;   // 变量段占三行：开头、--sb-muted、}
  }
  return out.join('\n');
}
const reverted = revert(surface);

const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];

test('B11 侧栏弱字：只在日间碧琪模式、不加强制覆盖、反例确实去掉了这几条', () => {
  const lines = surface.split('\n').filter((l) => l.includes(SCOPE));
  assert.equal(lines.length, 3);   // 变量、文字、分组按钮各一行
  for (const l of lines) assert.doesNotMatch(l, /!important/);
  assert.notEqual(reverted, surface);
  assert.ok(!reverted.includes(SCOPE), '反例里不该还有日间规则');
  assert.match(reverted, /--sb-muted: color-mix\(in srgb, var\(--accent\) 18%, #9a8b92\);/);
});

const rgb = (s) => {
  const srgb = s.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/i);
  if (srgb) return [...srgb.slice(1, 4).map((x) => Number(x) * 255), srgb[4] == null ? 1 : Number(srgb[4])];
  const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i);
  if (m) return [...m.slice(1, 4).map(Number), m[4] == null ? 1 : Number(m[4])];
  throw new Error('看不懂的颜色：' + s);
};
const lum = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const WHITE = [255, 255, 255];
// 字色（含 alpha）× 祖先透明度，叠在白底上。
const onWhite = ({color, opacity}) => { const c = rgb(color), a = c[3] * opacity; return c.slice(0, 3).map((v, i) => v * a + WHITE[i] * (1 - a)); };

const page = (mode, night, surfaceCss) => `<!doctype html><html data-theme="light" data-laolao-mode="${mode}"${night ? ' data-pinkie-night=""' : ''}><head>
${FILES.map((f) => `<style>${f === 'laolao-sidebar-surface.css' ? surfaceCss : sheets[f]}</style>`).join('\n')}
<style>body{margin:0;background:#fff}</style></head><body>
<aside class="sidebar"><section id="sidebar"><div id="laolao-session-manager"><div class="laolao-group">
<div class="laolao-group__head"><span class="laolao-group__label">最近</span><span class="laolao-group__count">2</span><button class="laolao-group__action pinkie-recent-menu" type="button">⋯</button></div>
<div class="pinkie-session-date">今天</div>
<div class="sidebar-recent-session session-row-host"><a class="sidebar-recent-session__link" href="#"><span class="sidebar-recent-session__name">视觉基线与热点核对</span></a><span class="session-row-aside"><time class="pinkie-session-time">03:58</time></span></div>
</div></div></section></aside></body></html>`;

const PARTS = {label: '.laolao-group__label', count: '.laolao-group__count', action: '.laolao-group__action', date: '.pinkie-session-date', time: '.pinkie-session-time'};
async function measure(p) {
  return p.evaluate((parts) => {
    const out = {};
    for (const [k, sel] of Object.entries(parts)) {
      const n = document.querySelector(sel);
      let opacity = 1; for (let m = n; m; m = m.parentElement) opacity *= Number(getComputedStyle(m).opacity);
      out[k] = {color: getComputedStyle(n).color, opacity: Math.round(opacity * 1000) / 1000};
    }
    return out;
  }, PARTS);
}

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
  const p = await b.newPage({viewport: {width: 320, height: 240}});
  try { await fn(p); } finally { await p.close(); }
  return '';
}
const need = (k) => (k === 'action' ? 3 : 4.5);

test('B11 侧栏弱字：日间五个模式标题 / 计数 / 日期 / 时间 ≥ 4.5:1、分组按钮 ≥ 3:1；换回原写法就不到', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of MODES) {
      await p.setContent(page(mode, false, surface));
      const got = await measure(p);
      for (const [k, v] of Object.entries(got)) {
        const r = ratio(onWhite(v), WHITE);
        t.diagnostic(`${mode} ${k} ${v.color} × ${v.opacity} → ${r.toFixed(2)}:1`);
        assert.ok(r >= need(k), `${mode} ${k} 只有 ${r.toFixed(2)}:1（要 ${need(k)}）`);
      }
      await p.setContent(page(mode, false, reverted));
      const old = await measure(p);
      for (const k of ['label', 'count', 'time']) {
        const r = ratio(onWhite(old[k]), WHITE);
        assert.ok(r < 4.5, `反例没生效：${mode} ${k} 原写法也有 ${r.toFixed(2)}:1`);
      }
    }
  });
  if (why) t.skip(why);
});

test('B11 侧栏弱字：夜间五个模式和 Metre 日夜，有没有这几行计算结果一样', async (t) => {
  const why = await withPage(async (p) => {
    const cases = [...MODES.map((m) => [m, true]), ['metre', false], ['metre', true]];
    for (const [mode, night] of cases) {
      await p.setContent(page(mode, night, surface));
      const now = await measure(p);
      await p.setContent(page(mode, night, reverted));
      assert.deepEqual(now, await measure(p), `${mode}${night ? ' 夜间' : ' 日间'} 被这次改动影响了`);
    }
  });
  if (why) t.skip(why);
});

test('B11 侧栏弱字：鼠标移到分组头上，分组按钮仍是不透明', async (t) => {
  const why = await withPage(async (p) => {
    await p.setContent(page('learning', false, surface));
    await p.hover('.laolao-group__head');
    // 分组按钮带 opacity 过渡（.2s），等它走完；走不到 1 就是层叠把悬停态压住了。
    const settled = await p.waitForFunction(() => getComputedStyle(document.querySelector('.laolao-group__action')).opacity === '1', null, {timeout: 2000})
      .then(() => true, () => false);
    const got = await measure(p);
    assert.ok(settled, `悬停后分组按钮停在 ${got.action.opacity}`);
    assert.equal(got.action.opacity, 1);
  });
  if (why) t.skip(why);
});
