// 设置弹层共享按钮的 hover / 主按钮 / 文字按钮 / 自定义说明在日、夜都 ≥ 4.5:1（12px 小字）。
// 复发点：hover 底曾写死 #fff0f7，夜间字色变成 #f6e5ee 后只剩 1.10:1（#111「看上个月」查出）。
// 夜间两种入口都要覆盖：原生已写 data-theme-mode="dark"；以及只有 laolao-night.js 先打的 data-pinkie-night。
// 反例：hover 底换回 #fff0f7 → 夜间必须 <4.5；暗色块去掉 data-pinkie-night 入口 → 只有夜标记时弹层仍是日间底。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(root, 'ui/injections/laolao-settings-user.css'), 'utf8');
const SHARED = ['choice', 'brand', 'model-button', 'button', 'text-button', 'advanced-link'];

test('静态：共享 hover 和主按钮 / 文字按钮 / 自定义说明不再写死浅色，暗色块认 data-pinkie-night', () => {
  const hover = CSS.match(/[^{}]*__choice:hover[^{}]*\{([^}]*)\}/);
  assert.ok(hover, '找到共享 hover 规则');
  assert.match(hover[1], /background:\s*var\(--pinkie-settings-hover\)/);
  assert.doesNotMatch(hover[1], /#fff0f7/i);
  const dark = CSS.match(/([^{}]*)\{[^}]*--pinkie-settings-ink:\s*#f6e5ee[^}]*\}/);
  assert.ok(dark, '找到暗色变量块');
  assert.match(dark[1], /html\[data-pinkie-night\] #laolao-user-settings/);
  for (const name of ['hover', 'hover-border', 'link', 'primary-bg', 'primary-ink', 'custom-ink']) {
    assert.match(dark[0], new RegExp(`--pinkie-settings-${name}:`), `暗色块给了 --pinkie-settings-${name}`);
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

const page = (css, attrs) => `<!doctype html><html ${attrs}><head><meta charset="utf-8">
<style>${css}</style><style>html #laolao-user-settings [data-k]{transition:none}body{margin:0;background:${/dark|night/.test(attrs) ? '#1e1b20' : '#ffffff'}}
#laolao-user-settings{position:static;padding:16px;background:var(--pinkie-settings-card)}</style></head><body>
<div id="laolao-user-settings"><div class="pinkie-user-settings__row">
${SHARED.map((k) => `<button type="button" class="pinkie-user-settings__${k}" data-k="${k}">${k}</button>`).join('\n')}
<button type="button" class="pinkie-user-settings__button pinkie-user-settings__button--primary" data-k="primary">主按钮</button>
<button type="button" class="pinkie-user-settings__button laolao-recap-open" data-k="recap">看上个月</button>
<p class="pinkie-user-settings__custom" data-k="custom">自定义权限说明</p>
</div></div></body></html>`;

// 逐层叠背景（含 alpha）；渐变按每个色标各算一次，取最差的。
const MEASURE = (k) => {
  const parse = (s) => { const v = (s.match(/[\d.]+/g) || []).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const el = document.querySelector(`[data-k="${k}"]`);
  const layers = [];
  for (let n = el.parentElement; n; n = n.parentElement) layers.push(getComputedStyle(n).backgroundColor);
  const base = layers.reverse().map(parse).reduce((acc, c) => (c.a > 0 ? over(c, acc) : acc), {r: 255, g: 255, b: 255, a: 1});
  const cs = getComputedStyle(el);
  const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse);
  const own = parse(cs.backgroundColor);
  const grounds = stops.length ? stops.map((c) => over(c, base)) : [own.a > 0 ? over(own, base) : base];
  const fg = parse(cs.color);
  const worst = Math.min(...grounds.map((g) => ratio(over(fg, g), g)));
  return {k, color: cs.color, bg: cs.backgroundColor, img: cs.backgroundImage === 'none' ? '' : cs.backgroundImage, ratio: +worst.toFixed(2)};
};

async function measure(browser, css, attrs) {
  const tab = await browser.newPage({viewport: {width: 900, height: 400}});
  try {
    await tab.setContent(page(css, attrs));
    const rows = [];
    for (const k of [...SHARED, 'primary', 'recap']) {
      rows.push({...(await tab.evaluate(MEASURE, k)), state: 'rest'});
      await tab.hover(`[data-k="${k}"]`);
      rows.push({...(await tab.evaluate(MEASURE, k)), state: 'hover'});
      await tab.mouse.move(890, 390);
    }
    rows.push({...(await tab.evaluate(MEASURE, 'custom')), state: 'rest'});
    const hoverVar = await tab.evaluate(() => getComputedStyle(document.getElementById('laolao-user-settings')).getPropertyValue('--pinkie-settings-hover').trim());
    return {rows, hoverVar};
  } finally { await tab.close(); }
}

const THEMES = {
  day: 'data-theme-mode="light"',
  night: 'data-theme-mode="dark" data-pinkie-night=""',
  'night-flag-only': 'data-pinkie-night=""',
};
const worst = (rows) => rows.reduce((a, b) => (b.ratio < a.ratio ? b : a));

test('真浏览器：日 / 夜 / 只有夜标记 × 6 个共享键 + 主按钮 + 看上个月 + 自定义说明，静止和 hover 都 ≥ 4.5:1', {timeout: 60_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    for (const [theme, attrs] of Object.entries(THEMES)) {
      const {rows, hoverVar} = await measure(browser, CSS, attrs);
      t.diagnostic(`${theme} hover 底 ${hoverVar}，最差 ${JSON.stringify(worst(rows))}`);
      assert.equal(hoverVar.toLowerCase(), theme === 'day' ? '#fff0f7' : '#4a2e42', `${theme} 用对了 hover 底`);
      for (const r of rows) assert.ok(r.ratio >= 4.5, `${theme} ${r.k} ${r.state}：${r.ratio}:1（字 ${r.color}，底 ${r.img || r.bg}）`);
    }
  } finally { await browser.close(); }
});

test('真浏览器反例：hover 底写回 #fff0f7 → 夜间 <4.5；暗色块去掉 data-pinkie-night 入口 → 只有夜标记时仍是日间底', {timeout: 60_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    const hardcoded = CSS.replace('background: var(--pinkie-settings-hover);', 'background: #fff0f7;');
    assert.notEqual(hardcoded, CSS, '反例确实改到了 hover 底');
    const night = (await measure(browser, hardcoded, THEMES.night)).rows.filter((r) => r.state === 'hover' && SHARED.includes(r.k));
    t.diagnostic(`写死 #fff0f7 夜间 hover ${JSON.stringify(worst(night))}`);
    for (const r of night) assert.ok(r.ratio < 4.5, `反例下 ${r.k} hover 应 <4.5，实际 ${r.ratio}`);
    const day = (await measure(browser, hardcoded, THEMES.day)).rows;
    assert.ok(day.every((r) => r.ratio >= 4.5), '反例只坏夜间，日间照样过');

    const noFlag = CSS.replace('html[data-pinkie-night] #laolao-user-settings, ', '');
    assert.notEqual(noFlag, CSS, '反例确实去掉了夜标记入口');
    const {hoverVar} = await measure(browser, noFlag, THEMES['night-flag-only']);
    t.diagnostic(`去掉夜标记入口后 hover 底 ${hoverVar}`);
    assert.equal(hoverVar.toLowerCase(), '#fff0f7', '去掉入口后只有夜标记时弹层仍是日间底（夜里一片白）');
  } finally { await browser.close(); }
});
