// B11 学习表（docs/b11-walkthrough/learning.md）：侧栏「临时」入口（.pinkie-temp-entry）日间太淡，走查量到 2.51:1。
// 原因：laolao-session-tools.css 里字色是 currentColor 55%，元素再叠 opacity .75，白底只有 1.91–2.13:1。
// 修法：日间五个碧琪模式、静止态改 90%、不透明；悬停 / 键盘焦点 / 临时会话中、夜间、Metre 不变。
// 浏览器里放真样式表 + 和 laolao-session-tools.js 一样的结构，读计算后的颜色 × 祖先透明度：
//   ① 日间五个模式对白底 ≥ 4.5:1；反例（去掉这条 = main）必须不到 4.5；
//   ② 夜间五个模式和 Metre 日夜：有没有这条，计算结果逐项相同；
//   ③ 悬停、临时会话中仍是强调色、不透明。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const FILES = ['laolao-theme.css', 'laolao-sidebar.css', 'laolao-session-tools.css', 'laolao-sidebar-surface.css', 'laolao-night.css', 'laolao-metre-skin.css', 'laolao-metre-contrast.css'];
const sheets = Object.fromEntries(FILES.map((f) => [f, read(`../ui/injections/${f}`)]));
const tools = sheets['laolao-session-tools.css'];
const RULE = /\s*\/\* B11 学习表：日间「临时」[^*]*\*\/\s*html:not\(\[data-pinkie-night\]\)[^{]*\.pinkie-temp-entry[^{]*\{[^}]*\}/;
const reverted = tools.replace(RULE, '');
const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];

test('B11「临时」：只有一条日间规则、不加强制覆盖、反例确实去掉了它', () => {
  const m = tools.match(RULE);
  assert.ok(m, '找不到日间「临时」规则');
  assert.doesNotMatch(m[0], /!important/);
  assert.match(m[0], /:not\(\[data-laolao-mode="metre"\]\)/);
  assert.match(m[0], /:not\(\[data-pinkie-temp\]\)/);
  assert.match(m[0], /:not\(:hover\):not\(:focus-visible\)/);
  assert.notEqual(reverted, tools);
  assert.match(reverted, /\.pinkie-temp-entry svg \{ width:15px;height:15px \}\n/);
});

const rgb = (s) => {
  const c = s.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/i);
  if (c) return [c[1] * 255, c[2] * 255, c[3] * 255, c[4] == null ? 1 : Number(c[4])];
  const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : Number(m[4])];
  throw new Error('看不懂的颜色：' + s);
};
const lum = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const WHITE = [255, 255, 255];
const onWhite = ({color, opacity}) => { const c = rgb(color), a = c[3] * opacity; return c.slice(0, 3).map((v, i) => v * a + WHITE[i] * (1 - a)); };

const page = (mode, night, toolsCss, temp = false) => `<!doctype html><html data-theme="light" data-laolao-mode="${mode}"${night ? ' data-pinkie-night=""' : ''}${temp ? ' data-pinkie-temp=""' : ''}><head>
${FILES.map((f) => `<style>${f === 'laolao-session-tools.css' ? toolsCss : sheets[f]}</style>`).join('\n')}
<style>body{margin:0;background:#fff}</style></head><body>
<aside class="sidebar"><section id="sidebar" class="sidebar-sessions"><button class="sidebar-new-session" type="button">新会话</button>
<button class="pinkie-temp-entry" type="button" title="开一个临时会话（关掉就删除，不写进记忆）"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor"/></svg><span>临时</span></button></section></aside></body></html>`;

async function measure(p) {
  return p.evaluate(() => {
    const n = document.querySelector('.pinkie-temp-entry');
    let opacity = 1; for (let m = n; m; m = m.parentElement) opacity *= Number(getComputedStyle(m).opacity);
    return {color: getComputedStyle(n).color, opacity: Math.round(opacity * 1000) / 1000};
  });
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
  const p = await b.newPage({viewport: {width: 320, height: 160}});
  try { await fn(p); } finally { await p.close(); }
  return '';
}

test('B11「临时」：日间五个模式对白底 ≥ 4.5:1，换回原写法就不到', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of MODES) {
      await p.setContent(page(mode, false, tools));
      const now = await measure(p);
      const r = ratio(onWhite(now), WHITE);
      t.diagnostic(`${mode} ${now.color} × ${now.opacity} → ${r.toFixed(2)}:1`);
      assert.ok(r >= 4.5, `${mode}「临时」只有 ${r.toFixed(2)}:1`);
      await p.setContent(page(mode, false, reverted));
      const old = ratio(onWhite(await measure(p)), WHITE);
      assert.ok(old < 4.5, `反例没生效：${mode} 原写法也有 ${old.toFixed(2)}:1`);
    }
  });
  if (why) t.skip(why);
});

test('B11「临时」：夜间五个模式和 Metre 日夜，有没有这条计算结果一样', async (t) => {
  const why = await withPage(async (p) => {
    for (const [mode, night] of [...MODES.map((m) => [m, true]), ['metre', false], ['metre', true]]) {
      await p.setContent(page(mode, night, tools));
      const now = await measure(p);
      await p.setContent(page(mode, night, reverted));
      assert.deepEqual(now, await measure(p), `${mode}${night ? ' 夜间' : ' 日间'} 被这次改动影响了`);
    }
  });
  if (why) t.skip(why);
});

test('B11「临时」：悬停和临时会话中仍是强调色、不透明（和原来一样）', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of MODES) {
      await p.setContent(page(mode, false, tools, true));
      const temp = await measure(p);
      await p.setContent(page(mode, false, reverted, true));
      assert.deepEqual(temp, await measure(p), `${mode} 临时会话中的样子变了`);
      await p.setContent(page(mode, false, tools));
      await p.hover('.pinkie-temp-entry');
      const hover = await measure(p);
      await p.setContent(page(mode, false, reverted));
      await p.hover('.pinkie-temp-entry');
      assert.deepEqual(hover, await measure(p), `${mode} 悬停的样子变了`);
      assert.equal(hover.opacity, 1);
    }
  });
  if (why) t.skip(why);
});
