// 「帮碧琪变好」弹窗三个按钮（__close / __equal-btn / __btn）夜间 hover：字对底 ≥ 4.5:1，边框对卡片和对键底都 ≥ 3:1。
// 复发点：dark 块 html[...] .x（0,2,1）压过 .x:hover（0,2,0），夜间 hover 边框一直是静止的 rgba(243,153,195,.28)，只有 1.79:1（B24b）。
// 反例：删掉夜间 :hover 变体 → 夜间边框必须 <3；日间 hover 规则原样不动。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(root, 'ui/injections/laolao-feedback.css'), 'utf8');
const JS = fs.readFileSync(path.join(root, 'ui/injections/laolao-feedback.js'), 'utf8');
const BUTTONS = ['__close', '__equal-btn', '__btn'];
const DARK_ENTRIES = ['html[data-theme-mode="dark"]', 'html[data-theme="dark"]', 'html[data-color-scheme="dark"]'];
const DAY_RULES = {
  __close: '.pinkie-feedback-modal__close:hover {\n  border-color: rgba(217, 81, 141, 0.56);\n  background: #fff0f7;\n}',
  '__equal-btn': '.pinkie-feedback-modal__equal-btn:hover {\n  border-color: rgba(217, 81, 141, 0.62);\n  background: #ffe9f3;\n  box-shadow: 0 3px 12px rgba(202, 91, 143, 0.14);\n}',
  __btn: '.pinkie-feedback-modal__btn:hover {\n  border-color: rgba(217, 81, 141, 0.56);\n  background: #fff0f7;\n}',
};
const DAY_BORDER = {__close: 'rgba(217, 81, 141, 0.56)', '__equal-btn': 'rgba(217, 81, 141, 0.62)', __btn: 'rgba(217, 81, 141, 0.56)'};
const NIGHT_RULE = /\n((?:html\[[^\]\n]*\] \.pinkie-feedback-modal__(?:equal-btn|btn|close):hover,?\s*)+)\{[^}]*\}/;

test('静态：日间三条 hover 规则原样；夜间 :hover 变体覆盖 3 种 dark 入口 × 3 个按钮，不用 !important', () => {
  for (const [k, rule] of Object.entries(DAY_RULES)) assert.ok(CSS.includes(rule), `日间 ${k}:hover 原样未动`);
  const m = CSS.match(NIGHT_RULE);
  assert.ok(m, '找到夜间 :hover 变体');
  for (const entry of DARK_ENTRIES) {
    for (const b of BUTTONS) assert.ok(m[1].includes(`${entry} .pinkie-feedback-modal${b}:hover`), `夜间变体含 ${entry} ${b}`);
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

const STUB = `window.__laolaoSidebar = {gwRequest: async (m) => m === 'pinkie.feedback.preview'
  ? {ok: true, count: 0, items: [], sample: {mode: 'chat'}}
  : {ok: true, isRelease: false, asked: true, consent: false, queueCount: 0}};`;

// equal-btn 带 transition，关过渡的选择器（0,2,0）要压过 .pinkie-feedback-modal__equal-btn（0,1,0），否则量到的是过渡中途的值。
const page = (css, attrs) => `<!doctype html><html ${attrs}><head><meta charset="utf-8">
<style>${css}</style><style>.pinkie-feedback-modal-backdrop [class]{transition:none}body{margin:0;min-height:100vh;background:${/dark/.test(attrs) ? '#1e1b20' : '#ffffff'}}</style>
<script>${STUB}</script><script>${JS}</script></head><body></body></html>`;

// 边框分别对外侧（卡片）和内侧（键底叠在卡片上）算，取较差的一侧；字叠在键底上算。
const MEASURE = (sel) => {
  const parse = (s) => { const v = (s.match(/[\d.]+/g) || []).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const el = document.querySelector(sel);
  const layers = [];
  for (let n = el.parentElement; n; n = n.parentElement) layers.push(getComputedStyle(n).backgroundColor);
  const card = layers.reverse().map(parse).reduce((acc, c) => (c.a > 0 ? over(c, acc) : acc), {r: 255, g: 255, b: 255, a: 1});
  const cs = getComputedStyle(el);
  const inner = over(parse(cs.backgroundColor), card);
  const edge = parse(cs.borderTopColor);
  const outside = ratio(over(edge, card), card);
  const inside = ratio(over(edge, inner), inner);
  const r2 = (x) => +x.toFixed(2);
  return {border: cs.borderTopColor, text: r2(ratio(over(parse(cs.color), inner), inner)), outside: r2(outside), inside: r2(inside), edge: r2(Math.min(outside, inside))};
};

const CASES = [
  ['onboarding', 'showOnboardingModal', '__close'],
  ['onboarding', 'showOnboardingModal', '__equal-btn'],
  ['preview', 'openPreview', '__close'],
  ['preview', 'openPreview', '__btn'],
];
const THEMES = {day: 'data-theme-mode="light"', night: 'data-theme-mode="dark" data-pinkie-night=""'};

async function hovered(browser, css, attrs, open, btn) {
  const sel = `.pinkie-feedback-modal${btn}`;
  const tab = await browser.newPage({viewport: {width: 900, height: 700}});
  try {
    await tab.setContent(page(css, attrs));
    await tab.evaluate((fn) => window.__pinkieFeedback[fn](), open);
    await tab.waitForSelector(sel);
    await tab.hover(sel);
    return await tab.evaluate(MEASURE, sel);
  } finally { await tab.close(); }
}

test('真浏览器：夜间两个弹窗三个按钮 hover 字 ≥ 4.5:1、边框 ≥ 3:1；日间 hover 边框仍是原值', {timeout: 90_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    for (const [theme, attrs] of Object.entries(THEMES)) {
      for (const [modal, open, btn] of CASES) {
        const r = await hovered(browser, CSS, attrs, open, btn);
        t.diagnostic(`${theme} ${modal} ${btn}:hover ${JSON.stringify(r)}`);
        if (theme === 'day') { assert.equal(r.border, DAY_BORDER[btn], `日间 ${modal} ${btn} hover 边框没动`); continue; }
        assert.ok(r.text >= 4.5, `${modal} ${btn} 夜间 hover 字对底 ${r.text}`);
        assert.ok(r.edge >= 3, `${modal} ${btn} 夜间 hover 边框 ${r.border}：外 ${r.outside} / 内 ${r.inside}`);
      }
    }
  } finally { await browser.close(); }
});

test('真浏览器反例：删掉夜间 :hover 变体 → 夜间边框 <3:1', {timeout: 90_000}, async (t) => {
  const browser = await launch(t); if (!browser) return;
  try {
    const stripped = CSS.replace(NIGHT_RULE, '\n');
    assert.notEqual(stripped, CSS, '反例确实删掉了夜间变体');
    for (const rule of Object.values(DAY_RULES)) assert.ok(stripped.includes(rule), '反例保留日间规则');
    for (const [modal, open, btn] of CASES) {
      const r = await hovered(browser, stripped, THEMES.night, open, btn);
      t.diagnostic(`删掉夜间变体 ${modal} ${btn} ${JSON.stringify(r)}`);
      assert.ok(r.edge < 3, `反例下 ${modal} ${btn} 应 <3，实际 ${r.edge}`);
    }
  } finally { await browser.close(); }
});
