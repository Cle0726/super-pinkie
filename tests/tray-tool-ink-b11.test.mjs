// B11 学习表（docs/b11-walkthrough/learning.md）：输入框「工具」按钮（.pinkie-tray-btn）日间字淡，走查量到 3.4:1。
// 原因：laolao-composer-tray.css 里字色是 --fog-muted（= --muted 88%），近白底上只有 3.00–3.70:1。
// 修法：日间五个碧琪模式、静止态改成 --muted 65% + --text-strong；悬停 / 键盘焦点 / 展开、夜间、Metre 不变。
// 同一行表里的「关闭」（.pinkie-external-tier）是走查脚本误读：它用 background-clip:text 画字，
// backgroundColor 就是字的墨色，脚本拿墨色当底色算出 1.04；按像素量日间 ≥ 5.7、夜间读得清，不改。
// 浏览器里放真样式表 + 和 laolao-composer-tray.js 一样的结构，读计算后的颜色 × 祖先透明度：
//   ① 日间五个模式对白底 ≥ 4.5:1；反例（去掉这条 = main）必须不到 4.5；
//   ② 夜间五个模式和 Metre 日夜：有没有这条，计算结果逐项相同；
//   ③ 悬停、展开：和原来逐项相同。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const FILES = ['laolao-theme.css', 'laolao-composer-tray.css', 'laolao-night.css', 'laolao-metre-skin.css', 'laolao-metre-contrast.css'];
const sheets = Object.fromEntries(FILES.map((f) => [f, read(`../ui/injections/${f}`)]));
const tray = sheets['laolao-composer-tray.css'];
const RULE = /\s*\/\* B11 学习表：日间「工具」[^*]*\*\/\s*html:not\(\[data-pinkie-night\]\)[^{]*\.pinkie-tray-btn[^{]*\{[^}]*\}/;
const reverted = tray.replace(RULE, '');
const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];

test('B11「工具」：只有一条日间规则、不加强制覆盖、反例确实去掉了它', () => {
  const m = tray.match(RULE);
  assert.ok(m, '找不到日间「工具」规则');
  assert.doesNotMatch(m[0], /!important/);
  assert.match(m[0], /:not\(\[data-laolao-mode="metre"\]\)/);
  assert.match(m[0], /:not\(:hover\):not\(:focus-visible\):not\(\[aria-expanded="true"\]\)/);
  assert.notEqual(reverted, tray);
  assert.match(reverted, /\.agent-chat__input \.pinkie-tray-btn svg \{ width: 17px; height: 17px; flex: none; \}\n/);
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

const page = (mode, night, trayCss, expanded = false) => `<!doctype html><html data-theme="light" data-laolao-mode="${mode}"${night ? ' data-pinkie-night=""' : ''}><head>
${FILES.map((f) => `<style>${f === 'laolao-composer-tray.css' ? trayCss : sheets[f]}</style>`).join('\n')}
<style>body{margin:0;background:#fff}</style></head><body>
<openclaw-chat-pane><div class="agent-chat__input"><div class="agent-chat__input-actions">
<button class="pinkie-tray-btn" type="button" aria-haspopup="dialog" aria-expanded="${expanded}"><svg viewBox="0 0 20 20"><rect x="3" y="8" width="14" height="9" fill="none" stroke="currentColor"/></svg><span>工具</span></button>
</div></div></openclaw-chat-pane></body></html>`;

async function measure(p) {
  return p.evaluate(() => {
    const n = document.querySelector('.pinkie-tray-btn span');
    let opacity = 1; for (let m = n; m; m = m.parentElement) opacity *= Number(getComputedStyle(m).opacity);
    const b = getComputedStyle(n.parentElement);
    return {color: getComputedStyle(n).color, opacity: Math.round(opacity * 1000) / 1000, background: b.backgroundColor};
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
  await p.emulateMedia({reducedMotion: 'reduce'});
  try { await fn(p); } finally { await p.close(); }
  return '';
}

test('B11「工具」：日间五个模式对白底 ≥ 4.5:1，换回原写法就不到', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of MODES) {
      await p.setContent(page(mode, false, tray));
      const now = await measure(p);
      const r = ratio(onWhite(now), WHITE);
      t.diagnostic(`${mode} ${now.color} × ${now.opacity} → ${r.toFixed(2)}:1`);
      assert.ok(r >= 4.5, `${mode}「工具」只有 ${r.toFixed(2)}:1`);
      await p.setContent(page(mode, false, reverted));
      const old = ratio(onWhite(await measure(p)), WHITE);
      assert.ok(old < 4.5, `反例没生效：${mode} 原写法也有 ${old.toFixed(2)}:1`);
    }
  });
  if (why) t.skip(why);
});

test('B11「工具」：夜间五个模式和 Metre 日夜，有没有这条计算结果一样', async (t) => {
  const why = await withPage(async (p) => {
    for (const [mode, night] of [...MODES.map((m) => [m, true]), ['metre', false], ['metre', true]]) {
      await p.setContent(page(mode, night, tray));
      const now = await measure(p);
      await p.setContent(page(mode, night, reverted));
      assert.deepEqual(now, await measure(p), `${mode}${night ? ' 夜间' : ' 日间'} 被这次改动影响了`);
    }
  });
  if (why) t.skip(why);
});

test('B11「工具」：悬停和展开的样子和原来一样', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of MODES) {
      await p.setContent(page(mode, false, tray, true));
      const open = await measure(p);
      await p.setContent(page(mode, false, reverted, true));
      assert.deepEqual(open, await measure(p), `${mode} 展开时的样子变了`);
      await p.setContent(page(mode, false, tray));
      await p.hover('.pinkie-tray-btn');
      const hover = await measure(p);
      await p.setContent(page(mode, false, reverted));
      await p.hover('.pinkie-tray-btn');
      assert.deepEqual(hover, await measure(p), `${mode} 悬停的样子变了`);
    }
  });
  if (why) t.skip(why);
});
