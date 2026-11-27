// 设置弹层「预设」卡片（__preset）夜间 hover 边框对卡片和对键底都要 ≥ 3:1（非文本）。
// 复发点：hover 边框只有日间那条 rgba(217, 81, 141, .62)，叠在夜卡片上只剩 2.45:1（B24 合后量剩余）。
// 夜间两种入口都要覆盖：原生 data-theme-mode="dark"，以及只有 laolao-night.js 打的 data-pinkie-night。
// 反例：删掉夜间 __preset:hover 变体 → 夜间必须 <3；日间 hover 边框保持原值不动。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(root, 'ui/injections/laolao-settings-user.css'), 'utf8');
const DAY_RULE = '#laolao-user-settings .pinkie-user-settings__preset:hover { border-color: rgba(217, 81, 141, .62); }';
const NIGHT_RULE = /(?:^|\n)((?:html\[[^\n]*\]\s*#laolao-user-settings \.pinkie-user-settings__preset:hover,?\s*)+)\{[^}]*\}[^\n]*/;

test('静态：日间 hover 规则原样保留；夜间 __preset:hover 变体两种入口都在，不用 !important', () => {
  assert.ok(CSS.includes(DAY_RULE), '日间 __preset:hover 原样未动');
  const m = CSS.match(NIGHT_RULE);
  assert.ok(m, '找到夜间 __preset:hover 变体');
  for (const entry of ['html[data-pinkie-night]', 'html[data-theme-mode="dark"]', 'html[data-theme="dark"]', 'html[data-color-scheme="dark"]']) {
    assert.ok(m[1].includes(entry), `夜间变体认 ${entry}`);
  }
  assert.doesNotMatch(m[0], /!important/);
});

async function launch(t) {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return null; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  try { return await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return null; }
}

const page = (css, attrs) => `<!doctype html><html ${attrs}><head><meta charset="utf-8">
<style>${css}</style><style>#laolao-user-settings [data-k]{transition:none}body{margin:0;background:${/dark|night/.test(attrs) ? '#1e1b20' : '#ffffff'}}
#laolao-user-settings{position:static;padding:16px;background:var(--pinkie-settings-card)}</style></head><body>
<div id="laolao-user-settings"><div class="pinkie-user-settings__preset-grid">
<button type="button" class="pinkie-user-settings__preset" data-k="preset"><span class="pinkie-user-settings__preset-title">均衡</span><span class="pinkie-user-settings__preset-detail">预设说明</span></button>
</div></div></body></html>`;

// 边框分别对外侧（卡片）和内侧（键底叠在卡片上）算，取较差的一侧。
const MEASURE = () => {
  const parse = (s) => { const v = (s.match(/[\d.]+/g) || []).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const el = document.querySelector('[data-k="preset"]');
  const layers = [];
  for (let n = el.parentElement; n; n = n.parentElement) layers.push(getComputedStyle(n).backgroundColor);
  const card = layers.reverse().map(parse).reduce((acc, c) => (c.a > 0 ? over(c, acc) : acc), {r: 255, g: 255, b: 255, a: 1});
  const cs = getComputedStyle(el);
  const inner = over(parse(cs.backgroundColor), card);
  const edge = parse(cs.borderTopColor);
  const outside = ratio(over(edge, card), card);
  const inside = ratio(over(edge, inner), inner);
  return {border: cs.borderTopColor, outside: +outside.toFixed(2), inside: +inside.toFixed(2), ratio: +Math.min(outside, inside).toFixed(2)};
};

async function hovered(browser, css, attrs) {
  const tab = await browser.newPage({viewport: {width: 900, height: 300}});
  try {
    await tab.setContent(page(css, attrs));
    await tab.hover('[data-k="preset"]');
    return await tab.evaluate(MEASURE);
  } finally { await tab.close(); }
}

const THEMES = {
  day: 'data-theme-mode="light"',
  night: 'data-theme-mode="dark" data-pinkie-night=""',
  'night-flag-only': 'data-pinkie-night=""',
};
const NIGHTS = ['night', 'night-flag-only'];

test('真浏览器：夜 / 只有夜标记下 __preset:hover 边框对卡片和键底都 ≥ 3:1；日间边框仍是原值', {timeout: 60_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    for (const [theme, attrs] of Object.entries(THEMES)) {
      const r = await hovered(browser, CSS, attrs);
      t.diagnostic(`${theme} preset:hover ${JSON.stringify(r)}`);
      if (theme === 'day') assert.equal(r.border, 'rgba(217, 81, 141, 0.62)', '日间 hover 边框没动');
      else assert.ok(r.ratio >= 3, `${theme} preset:hover 边框 ${r.border}：外 ${r.outside} / 内 ${r.inside}`);
    }
  } finally { await browser.close(); }
});

test('真浏览器反例：删掉夜间 __preset:hover 变体 → 夜间 <3:1', {timeout: 60_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    const stripped = CSS.replace(NIGHT_RULE, '\n');
    assert.notEqual(stripped, CSS, '反例确实删掉了夜间变体');
    assert.ok(stripped.includes(DAY_RULE), '反例保留日间规则');
    for (const theme of NIGHTS) {
      const r = await hovered(browser, stripped, THEMES[theme]);
      t.diagnostic(`删掉夜间变体 ${theme} ${JSON.stringify(r)}`);
      assert.ok(r.ratio < 3, `反例下 ${theme} 应 <3，实际 ${r.ratio}`);
    }
  } finally { await browser.close(); }
});
