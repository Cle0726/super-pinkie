// B11 #261 #6（tools/pr-shots/b11-project-walkthrough.md）：输入框下「未绑定项目文件夹」`#laolao-project-scope`
//   实际 9px（laolao-ui-subtraction.css 的 id 规则），颜色来自 laolao-theme.css 给输入区无类 div 的 --fog-muted（!important，
//   所以 laolao-sidebar.css:19 的 #966b84 根本没生效），日间只有 3.1–3.8:1。
// 修法：laolao-ui-subtraction.css 的 #laolao-project-scope 改 11px + var(--muted-strong)。
// 这里在浏览器里放真样式表（按 laolao-head.fragment.html 的顺序）+ 和 laolao-sidebar.js showScope() 一样的结构，读计算后的字号和颜色：
//   ① 日间五个碧琪模式：字 ≥ 11px，对白底 ≥ 4.5:1；
//   ② 反例：换回 main 原来的规则块，同一套量法必须是 9px 且不到 4.5:1；
//   ③ 夜间五个模式：颜色和 main 逐项相同（夜间由 laolao-night.css 的无类 div 规则管）；
//   ④ Metre 日夜仍然不显示；非项目模式未绑定时仍然不显示（laolao-composer-tray.css:22）；
//   ⑤ 820 截断（uireview 08:11Z）：标签在输入框网格第 9 列（弹性列），id 规则的 max-width: 42% 压过 theme.css 的 100%，
//      820 下只能用这一格的 42%，「未绑定项目文件夹」被截成「未绑定项目…」，右边还空着。改成 100%；
//      这里按 820 / 1440 的第 9 列宽量 scrollWidth ≤ clientWidth，反例（只把 100% 换回 42%）820 下必须截断。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const FILES = ['laolao-composer-tray.css', 'laolao-theme.css', 'laolao-sidebar.css', 'laolao-ui-subtraction.css', 'laolao-night.css', 'laolao-metre-skin.css'];
const sheets = Object.fromEntries(FILES.map((f) => [f, read(`../ui/injections/${f}`).replace(/\r\n/g, '\n')]));
const head = read('../ui/injections/laolao-head.fragment.html');

// 改动只在 #laolao-project-scope 这一块：padding 去掉 !important（没有别的规则设它的 padding），换成同一行写颜色，行数和 !important 数都不变。
const FIXED = '#laolao-project-scope {\n  order: 20;\n  max-width: 100%;\n  margin-left: auto;\n  padding: 0 4px; /* B11 #261 #6';
const MAIN = '#laolao-project-scope {\n  order: 20;\n  max-width: 42%;\n  margin-left: auto;\n  padding: 0 4px !important;\n  font-size: 9px !important;\n}';
const fixed = sheets['laolao-ui-subtraction.css'];
const blockAt = fixed.indexOf(FIXED), blockEnd = blockAt < 0 ? -1 : fixed.indexOf('\n}', blockAt) + 2;
const reverted = blockAt < 0 ? fixed : fixed.slice(0, blockAt) + MAIN + fixed.slice(blockEnd);
// ⑤ 的反例：只把 id 规则的 max-width 换回 42%（18cf659b 的写法）。
const capped = blockAt < 0 ? fixed : fixed.slice(0, blockAt) + fixed.slice(blockAt, blockEnd).replace('max-width: 100%;', 'max-width: 42%;') + fixed.slice(blockEnd);

const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];

test('B11 #261 #6：样式表顺序和本测试一致，反例确实换回了 main 的写法', () => {
  const at = (f) => head.indexOf(`/${f}?`);
  for (const f of FILES) assert.ok(at(f) >= 0, `head 里没有 ${f}`);
  for (let i = 1; i < FILES.length; i++) assert.ok(at(FILES[i - 1]) < at(FILES[i]), `${FILES[i - 1]} 应在 ${FILES[i]} 前面`);
  assert.ok(blockAt >= 0, '没找到改过的 #laolao-project-scope 块');
  assert.match(fixed.slice(blockAt, blockEnd), /font-size: 11px !important; color: var\(--muted-strong\) !important;\n\}$/);
  assert.notEqual(reverted, fixed);
  assert.ok(fixed.slice(blockAt, blockEnd).includes('max-width: 100%;'), 'id 规则的 max-width 应是 100%');
  assert.notEqual(capped, fixed, '反例没把 max-width 换回 42%');
  assert.ok(reverted.includes('padding: 0 4px !important;\n  font-size: 9px !important;\n}'));
  const count = (s) => [s.split('\n').length, (s.match(/!important/g) || []).length];
  assert.deepEqual(count(fixed), count(reverted), '行数或 !important 数和 main 不一样');
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
const onWhite = ({color, opacity}) => { const c = rgb(color), a = c[3] * opacity; return c.slice(0, 3).map((v, i) => v * a + WHITE[i] * (1 - a)); };

// bound=false →「未绑定项目文件夹」（只有项目模式显示）；bound=true →「当前项目 · 路径」（各模式都显示）。
const page = (mode, night, subtraction, bound) => `<!doctype html><html data-theme="light" data-laolao-mode="${mode}"${night ? ' data-pinkie-night=""' : ''}><head>
${FILES.map((f) => `<style>${f === 'laolao-ui-subtraction.css' ? subtraction : sheets[f]}</style>`).join('\n')}
<style>body{margin:0;background:#fff}</style></head><body>
<div class="agent-chat__input"><div id="laolao-project-scope" role="status" data-error="false" data-bound="${bound}">${bound ? '当前项目 · F:\\proj' : '未绑定项目文件夹'}</div><textarea></textarea></div>
</body></html>`;

async function measure(p) {
  return p.evaluate(() => {
    const n = document.getElementById('laolao-project-scope');
    let opacity = 1; for (let m = n; m; m = m.parentElement) opacity *= Number(getComputedStyle(m).opacity);
    const cs = getComputedStyle(n);
    return {display: cs.display, fontSize: parseFloat(cs.fontSize), color: cs.color, padding: cs.padding, opacity: Math.round(opacity * 1000) / 1000};
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
  const p = await b.newPage({viewport: {width: 640, height: 200}});
  try { await fn(p); } finally { await p.close(); }
  return '';
}

test('B11 #261 #6：日间五个模式字 ≥ 11px、对白底 ≥ 4.5:1；换回 main 的写法就是 9px 且不到 4.5:1', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of MODES) {
      const bound = mode !== 'project';
      await p.setContent(page(mode, false, fixed, bound));
      const got = await measure(p);
      const r = ratio(onWhite(got), WHITE);
      t.diagnostic(`${mode} ${got.fontSize}px ${got.color} × ${got.opacity} → ${r.toFixed(2)}:1`);
      assert.notEqual(got.display, 'none', `${mode} 标签不该被藏`);
      assert.ok(got.fontSize >= 11, `${mode} 只有 ${got.fontSize}px`);
      assert.ok(r >= 4.5, `${mode} 只有 ${r.toFixed(2)}:1`);
      await p.setContent(page(mode, false, reverted, bound));
      const old = await measure(p);
      const ro = ratio(onWhite(old), WHITE);
      t.diagnostic(`${mode} main ${old.fontSize}px ${old.color} → ${ro.toFixed(2)}:1`);
      assert.equal(old.fontSize, 9, `反例没生效：${mode} main 是 ${old.fontSize}px`);
      assert.ok(ro < 4.5, `反例没生效：${mode} main 也有 ${ro.toFixed(2)}:1`);
      assert.equal(got.padding, old.padding, `${mode} padding 和 main 不一样（去掉 !important 后被别的规则改了）`);
    }
  });
  if (why) t.skip(why);
});

test('B11 #261 #6：夜间五个模式颜色和 main 一样', async (t) => {
  const why = await withPage(async (p) => {
    for (const mode of MODES) {
      const bound = mode !== 'project';
      await p.setContent(page(mode, true, fixed, bound));
      const now = await measure(p);
      await p.setContent(page(mode, true, reverted, bound));
      const old = await measure(p);
      t.diagnostic(`${mode} night ${now.color} (main ${old.color})`);
      assert.equal(now.color, old.color, `${mode} 夜间颜色被这次改动影响了`);
      assert.equal(now.opacity, old.opacity);
      assert.equal(now.padding, old.padding, `${mode} 夜间 padding 被这次改动影响了`);
    }
  });
  if (why) t.skip(why);
});

test('B11 #261 #6：Metre 日夜、非项目模式未绑定时仍然不显示', async (t) => {
  const why = await withPage(async (p) => {
    for (const night of [false, true]) {
      await p.setContent(page('metre', night, fixed, true));
      assert.equal((await measure(p)).display, 'none', `Metre${night ? ' 夜间' : ''} 露出了项目标签`);
    }
    for (const mode of MODES.filter((m) => m !== 'project')) {
      await p.setContent(page(mode, false, fixed, false));
      assert.equal((await measure(p)).display, 'none', `${mode} 未绑定时露出了「未绑定项目文件夹」`);
    }
  });
  if (why) t.skip(why);
});

// ⑤ 820 截断。第 9 列宽 = 输入框宽 − 第 10 列（模型芯片的替身，300px + theme.css 第 2 行元素的 margin 0 1px = 302px）；前 8 列和 11、12 列这里没东西，宽 0。
const gridPage = (night, subtraction, col) => `<!doctype html><html data-theme="light" data-laolao-mode="project"${night ? ' data-pinkie-night=""' : ''}><head>
${FILES.map((f) => `<style>${f === 'laolao-ui-subtraction.css' ? subtraction : sheets[f]}</style>`).join('\n')}
<style>body{margin:0;background:#fff}</style></head><body>
<div class="agent-chat__input" style="width:${col + 302}px"><div id="laolao-project-scope" role="status" data-error="false" data-bound="false">未绑定项目文件夹</div><div class="chat-composer-model-control" style="width:300px;height:28px"></div></div>
</body></html>`;
async function fit(p) {
  return p.evaluate(() => {
    const n = document.getElementById('laolao-project-scope');
    const cols = getComputedStyle(n.parentElement).gridTemplateColumns.split(' ').map(parseFloat);
    return {scroll: n.scrollWidth, client: n.clientWidth, col: cols[8], text: n.textContent};
  });
}

// 列宽是真页面量的（pr-shots 45973849919，tools/pr-shots/424-scope-probe.mjs，linux / windows 一致）：home-project
// 820 第 9 列 198px（.chat-main 736px，不进 ≤680 的 @container 块），42% 时 client 83 < scroll 95 截断；1440 第 9 列 230px。
// 另加一档只比文字多 2px 的（8 是 theme.css 给的 margin-left）。
test('B11 #261 #6：第 9 列放得下时标签不截断（820 / 1440 / 刚好）；反例 max-width 42% 在 820 下截断', async (t) => {
  const why = await withPage(async (p) => {
    await p.setContent(gridPage(false, fixed, 1100));
    const base = await fit(p);
    for (const night of [false, true]) {
      for (const [name, col] of [['820', 198], ['1440', 230], ['刚好', base.scroll + 8 + 2]]) {
        await p.setContent(gridPage(night, fixed, col));
        const got = await fit(p);
        t.diagnostic(`${night ? 'night' : 'day'} ${name} col=${got.col} scroll=${got.scroll} client=${got.client}`);
        assert.ok(Math.abs(got.col - col) <= 1, `${name} 第 9 列是 ${got.col}px，应为 ${col}px（网格没按预期排）`);
        assert.ok(got.scroll <= got.client, `${night ? '夜间' : '日间'} ${name}：「${got.text}」被截断（${got.scroll} > ${got.client}）`);
        if (name !== '820') continue;
        await p.setContent(gridPage(night, capped, col));
        const old = await fit(p);
        t.diagnostic(`${night ? 'night' : 'day'} 820 反例 scroll=${old.scroll} client=${old.client}`);
        assert.ok(old.scroll > old.client, `反例没生效：max-width 42% 在 820 下也没截断（${old.scroll} ≤ ${old.client}）`);
      }
    }
  });
  if (why) t.skip(why);
});
