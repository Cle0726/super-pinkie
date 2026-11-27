// B80：设置页其余按钮 / 卡片的夜间悬停对比度。UI 边框 ≥ 3:1，文字 ≥ 4.5:1。
// 复发点 1：共享 hover 边框夜间 rgba(255, 154, 196, .5) 对 hover 底不到 3:1。
//          标题、选中态、警告、开关滑块的夜间规则缺 data-pinkie-night 入口，只有夜标记时退回日间色。
// 复发点 2：进阶调节弹层的夜间块只认 data-pinkie-night 和 data-theme-mode="dark"。
//          关闭钮悬停翻成白底，粉字只剩约 2:1；重置钮边框 .2 透明，对页脚不到 3:1。
//          右栏入口夜间悬停 / 打开态只有日间那圈 #c88aa126 内描边，约 1.3:1。
// 反例：把这几处改回旧写法，夜间必须跌破阈值；日间值保持原样。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, 'ui/injections', f), 'utf8');
const SU = read('laolao-settings-user.css');
const PS = read('laolao-power-settings.css');
const NIGHT = read('laolao-night.css');
const ENTRIES = ['html[data-pinkie-night]', 'html[data-theme-mode="dark"]', 'html[data-theme="dark"]', 'html[data-color-scheme="dark"]'];

const NIGHT_HOVER_BORDER = '--pinkie-settings-hover-border: rgba(255, 154, 196, .75);';
const OLD_NIGHT_HOVER_BORDER = '--pinkie-settings-hover-border: rgba(255, 154, 196, .5);';
const DAY_HOVER_BORDER = '--pinkie-settings-hover-border: rgba(217, 81, 141, .56);';
const B80_BLOCK = /\/\* B80 夜：[^\n]*\*\/\n(?:[^\n]+\n)+?\n/;

const rulesFor = (css, sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].includes(sel));

test('静态：设置弹层夜间 hover 边框加强；标题 / 选中 / 警告 / 开关滑块认全 4 个夜间入口', () => {
  assert.ok(SU.includes(NIGHT_HOVER_BORDER), '夜间共享 hover 边框 .75');
  assert.ok(SU.includes(DAY_HOVER_BORDER), '日间共享 hover 边框原值未动');
  for (const sel of ['__title', '__choice.is-selected', '__warning', '__switch-knob']) {
    const rule = rulesFor(SU, sel).find((m) => m[1].includes('html['));
    assert.ok(rule, `找到 ${sel} 夜间规则`);
    for (const e of ENTRIES) assert.ok(rule[1].includes(`${e} #laolao-user-settings .pinkie-user-settings${sel}`), `${sel} 认 ${e}`);
  }
});

test('静态：进阶调节夜间块每条规则都认 4 个入口；B80 新规则不用 !important', () => {
  const night = PS.slice(PS.indexOf('/* ── 黑夜'), PS.indexOf('/* 右侧工作栏里的入口'));
  const rules = [...night.matchAll(/([^{}]+)\{[^}]*\}/g)].filter((m) => !m[1].includes('#pinkie-power-entry'));
  assert.ok(rules.length >= 14, `夜间块规则数 ${rules.length}`);
  for (const [, sel] of rules) for (const e of ENTRIES) assert.ok(sel.includes(e), `${sel.trim().split('\n')[0]} 缺 ${e}`);
  const block = PS.match(B80_BLOCK);
  assert.ok(block, '找到 B80 夜间块');
  assert.doesNotMatch(block[0], /!important/);
  for (const sel of ['__close {', '__close:hover {', '__reset {', '__reset:hover {', '#pinkie-power-entry:hover {', '[data-pinkie-power-open] #pinkie-power-entry {']) {
    assert.ok(block[0].includes(sel), `B80 块含 ${sel}`);
  }
});

async function launch(t) {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return null; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  try { return await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return null; }
}

const isDark = (attrs) => /dark|night/.test(attrs);
const shell = (css, attrs, body) => `<!doctype html><html ${attrs}><head><meta charset="utf-8">
<style>${css}</style><style>*,*::before,*::after{transition:none!important;animation:none!important}
body{margin:0;background:${isDark(attrs) ? '#1a1320' : '#ffffff'}}</style></head><body>${body}</body></html>`;

const settingsPage = (css, attrs) => shell(css, attrs, `<style>#laolao-user-settings{position:static;padding:16px;background:var(--pinkie-settings-card)}</style>
<div id="laolao-user-settings"><div class="pinkie-user-settings__intro"><h2 class="pinkie-user-settings__title" data-k="title">设置</h2></div>
<div class="pinkie-user-settings__row">
<button type="button" class="pinkie-user-settings__choice" data-k="choice">开</button>
<button type="button" class="pinkie-user-settings__brand" data-k="brand">品牌</button>
<button type="button" class="pinkie-user-settings__model-button" data-k="model-button">模型</button>
<button type="button" class="pinkie-user-settings__button" data-k="button">按钮</button>
<button type="button" class="pinkie-user-settings__choice is-selected" data-k="selected">已选</button>
</div></div>`);

const powerPage = (css, attrs) => shell(css, attrs, `<style>#pinkie-power{position:static!important;display:block!important}</style>
<div id="pinkie-power"><section class="pinkie-power__sheet">
<header class="pinkie-power__hero"><div class="pinkie-power__hero-copy"><h2 class="pinkie-power__title">进阶调节</h2></div>
<button type="button" class="pinkie-power__close" data-k="close">×</button></header>
<footer class="pinkie-power__foot"><div class="pinkie-power__actions"><button type="button" class="pinkie-power__reset" data-k="reset">恢复默认</button></div></footer>
</section></div>
<div class="chat-workbench"><aside class="chat-workspace-rail chat-workspace-rail--collapsed" data-k="rail">
<button type="button" id="pinkie-power-entry" data-k="entry"><span>进阶调节</span></button></aside></div>`);

// 逐层叠背景：每层渐变的不透明色标各算一支，半透明色标（光晕）叠与不叠都算进候选，取最差。
// 文字：字色对自身底；边框 / 内描边：线色分别对外侧（父层）和内侧（自身底）算，取较差。
const MEASURE = ([k, kind]) => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const paint = (el, under) => {
    const cs = getComputedStyle(el);
    const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter((c) => c.a > 0);
    const solid = stops.filter((c) => c.a >= 1);
    const glow = stops.filter((c) => c.a < 1);
    const bg = parse(cs.backgroundColor);
    let out = solid.length ? solid.map((c) => ({...c})) : (bg && bg.a > 0 ? under.map((g) => over(bg, g)) : under);
    return out.flatMap((g) => [g, ...glow.map((c) => over(c, g))]);
  };
  const el = document.querySelector(`[data-k="${k}"]`);
  const chain = [];
  for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
  const outside = chain.reduce((acc, n) => paint(n, acc), [{r: 255, g: 255, b: 255, a: 1}]);
  const inside = paint(el, outside);
  const cs = getComputedStyle(el);
  const fgText = kind === 'text' ? cs.color : kind === 'border' ? cs.borderTopColor : cs.boxShadow;
  const fg = parse(fgText);
  if (!fg || fg.a === 0) return {k, kind, fg: fgText, bg: cs.backgroundColor, ratio: 1};
  const sides = kind === 'text' ? inside : [...outside, ...inside];
  return {k, kind, fg: fgText, bg: cs.backgroundColor, ratio: +Math.min(...sides.map((g) => ratio(over(fg, g), g))).toFixed(2)};
};

async function measure(browser, html, probes) {
  const tab = await browser.newPage({viewport: {width: 900, height: 700}});
  try {
    await tab.setContent(html);
    const rows = {};
    for (const [k, kind, hover] of probes) {
      if (hover) await tab.hover(`[data-k="${k}"]`); else await tab.mouse.move(895, 695);
      rows[`${k}${hover ? ':hover' : ''}${kind === 'text' && k === 'reset' ? ':text' : ''}`] = await tab.evaluate(MEASURE, [k, kind]);
    }
    return rows;
  } finally { await tab.close(); }
}

const THEMES = {
  day: 'data-theme-mode="light"',
  night: 'data-theme-mode="dark" data-pinkie-night=""',
  'night-flag-only': 'data-pinkie-night=""',
  'theme-attr-only': 'data-theme="dark"',
  'color-scheme-only': 'data-color-scheme="dark"',
};
// 右栏夜间底来自 laolao-night.css，它只认 data-pinkie-night。
const RAIL_NIGHTS = ['night', 'night-flag-only'];

const SETTINGS_PROBES = [['choice', 'border', true], ['brand', 'border', true], ['model-button', 'border', true], ['button', 'border', true], ['title', 'text'], ['selected', 'text']];
const POWER_PROBES = [['close', 'text'], ['close', 'text', true], ['reset', 'border'], ['reset', 'border', true], ['reset', 'text']];
const ENTRY_PROBES = [['entry', 'shadow', true]];
const NEED = {text: 4.5, border: 3, shadow: 3};
const brief = (rows) => Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.ratio]));

test('真浏览器：设置弹层与进阶调节在 4 个夜间入口下悬停 / 选中都达标，日间值不变', {timeout: 90_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    for (const [theme, attrs] of Object.entries(THEMES)) {
      const su = await measure(browser, settingsPage(SU, attrs), SETTINGS_PROBES);
      const ps = await measure(browser, powerPage(PS, attrs), POWER_PROBES);
      t.diagnostic(`${theme} ${JSON.stringify(brief({...su, ...ps}))}`);
      if (theme === 'day') {
        assert.equal(su['choice:hover'].fg, 'rgba(217, 81, 141, 0.56)', '日间共享 hover 边框没动');
        assert.equal(ps['close:hover'].bg, 'rgb(255, 255, 255)', '日间关闭钮悬停仍是白底');
        continue;
      }
      for (const [k, r] of Object.entries({...su, ...ps})) assert.ok(r.ratio >= NEED[r.kind], `${theme} ${k} ${r.kind} ${r.fg}：${r.ratio}`);
    }
    for (const theme of RAIL_NIGHTS) {
      const en = await measure(browser, powerPage(NIGHT + '\n' + PS, THEMES[theme]), ENTRY_PROBES);
      const open = await measure(browser, powerPage(NIGHT + '\n' + PS, THEMES[theme] + ' data-pinkie-power-open=""'), [['entry', 'shadow']]);
      t.diagnostic(`${theme} entry hover ${JSON.stringify(en['entry:hover'])} open ${JSON.stringify(open.entry)}`);
      assert.ok(en['entry:hover'].ratio >= 3, `${theme} 入口悬停内描边 ${en['entry:hover'].fg}：${en['entry:hover'].ratio}`);
      assert.ok(open.entry.ratio >= 3, `${theme} 入口打开态内描边 ${open.entry.fg}：${open.entry.ratio}`);
    }
  } finally { await browser.close(); }
});

test('真浏览器反例：改回旧写法 → 夜间跌破阈值', {timeout: 90_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    const suOld = SU.replace(NIGHT_HOVER_BORDER, OLD_NIGHT_HOVER_BORDER)
      .replace('html[data-pinkie-night] #laolao-user-settings .pinkie-user-settings__title,\n', '')
      .replace(/html\[data-pinkie-night\] #laolao-user-settings \.pinkie-user-settings__(?:choice|brand|preset)\.is-selected,\n/g, '');
    assert.notEqual(suOld, SU);
    const psOld = PS.replace(B80_BLOCK, '');
    assert.notEqual(psOld, PS);
    for (const theme of RAIL_NIGHTS) {
      const su = await measure(browser, settingsPage(suOld, THEMES[theme]), [['choice', 'border', true]]);
      const ps = await measure(browser, powerPage(psOld, THEMES[theme]), [['close', 'text', true], ['reset', 'border']]);
      const en = await measure(browser, powerPage(NIGHT + '\n' + psOld, THEMES[theme]), ENTRY_PROBES);
      t.diagnostic(`反例 ${theme} ${JSON.stringify(brief({...su, ...ps, ...en}))}`);
      assert.ok(su['choice:hover'].ratio < 3, `反例 ${theme} 共享 hover 边框应 <3，实际 ${su['choice:hover'].ratio}`);
      assert.ok(ps['close:hover'].ratio < 4.5, `反例 ${theme} 关闭钮悬停应 <4.5，实际 ${ps['close:hover'].ratio}`);
      assert.ok(ps.reset.ratio < 3, `反例 ${theme} 重置钮边框应 <3，实际 ${ps.reset.ratio}`);
      assert.ok(en['entry:hover'].ratio < 3, `反例 ${theme} 入口悬停应 <3，实际 ${en['entry:hover'].ratio}`);
    }
    const flag = await measure(browser, settingsPage(suOld, THEMES['night-flag-only']), [['title', 'text'], ['selected', 'text']]);
    t.diagnostic(`反例 night-flag-only ${JSON.stringify(brief(flag))}`);
    assert.ok(flag.title.ratio < 4.5, `反例 只有夜标记 标题应 <4.5，实际 ${flag.title.ratio}`);
    assert.ok(flag.selected.ratio < 4.5, `反例 只有夜标记 选中态应 <4.5，实际 ${flag.selected.ratio}`);
    const psTwo = PS.replaceAll('html[data-theme="dark"]', 'html[data-x-theme="dark"]');
    const two = await measure(browser, powerPage(psTwo, THEMES['theme-attr-only']), [['reset', 'border']]);
    assert.ok(two.reset.ratio < 3, `反例 夜间块不认 data-theme 时重置钮边框应 <3，实际 ${two.reset.ratio}`);
  } finally { await browser.close(); }
});
