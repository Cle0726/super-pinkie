// 设置弹层 6 个共享键（__choice / __brand / __model-button / __button / __text-button / __advanced-link）
// 夜间 hover 边框对外侧（卡片）和对内侧（hover 底）都要 ≥ 3:1（非文本，WCAG 1.4.11）。
// 复发点：#179 给夜间块加了 --pinkie-settings-hover-border: rgba(255, 154, 196, .5)，对卡片 3.10、
// 但对 hover 底 #4a2e42 只有 2.69:1；settings-shared-hover-night.test.mjs 只量字色，没量边框（B24 核销时发现）。
// 纯静态：从 CSS 读夜间变量逐层叠色，不需要浏览器。反例：边框 alpha 写回 .5 → 内侧必须 < 3。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(root, 'ui/injections/laolao-settings-user.css'), 'utf8');

const nightBlock = (css) => {
  const m = css.match(/html\[data-pinkie-night\] #laolao-user-settings,[^{]*\{([^}]*)\}/);
  assert.ok(m, '找到夜间变量块（data-pinkie-night 入口）');
  return m[1];
};
const cssVar = (block, name) => {
  const m = block.match(new RegExp(`--pinkie-settings-${name}:\\s*([^;]+);`));
  assert.ok(m, `夜间块有 --pinkie-settings-${name}`);
  return m[1].trim();
};
const parse = (s) => {
  if (s.startsWith('#')) { const h = s.slice(1); return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1}; }
  const v = (s.match(/[\d.]+/g) || []).map(Number);
  return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1};
};
const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

// 夜间页面底：纯黑和 settings-shared-hover-night 用的 #1e1b20 两种都量，取较差的。
const PAGES = [{r: 0, g: 0, b: 0, a: 1}, parse('#1e1b20')];

const measure = (css) => {
  const block = nightBlock(css);
  const edge = parse(cssVar(block, 'hover-border'));
  const cardLayer = parse(cssVar(block, 'card'));
  const hoverLayer = parse(cssVar(block, 'hover'));
  let outside = Infinity, inside = Infinity;
  for (const page of PAGES) {
    const card = over(cardLayer, page);
    const hover = over(hoverLayer, card);
    outside = Math.min(outside, ratio(over(edge, card), card));
    inside = Math.min(inside, ratio(over(edge, hover), hover));
  }
  return {edge: cssVar(block, 'hover-border'), outside: +outside.toFixed(2), inside: +inside.toFixed(2)};
};

test('共享 :hover 规则用的是 hover-border / hover 变量（量的就是实际生效的那两个值）', () => {
  const rule = CSS.match(/#laolao-user-settings \.pinkie-user-settings__choice:hover,[\s\S]*?\{([^}]*)\}/);
  assert.ok(rule, '找到共享 :hover 规则');
  assert.match(rule[1], /border-color:\s*var\(--pinkie-settings-hover-border\)/);
  assert.match(rule[1], /background:\s*var\(--pinkie-settings-hover\)/);
});

test('夜间共享 hover 边框对卡片、对 hover 底都 ≥ 3:1', () => {
  const r = measure(CSS);
  assert.ok(r.outside >= 3, `对卡片 ${r.outside}:1（${r.edge}）`);
  assert.ok(r.inside >= 3, `对 hover 底 ${r.inside}:1（${r.edge}）`);
});

test('反例：夜间边框 alpha 写回 .5 → 对 hover 底 < 3:1', () => {
  const bad = CSS.replace(/(--pinkie-settings-hover-border:\s*rgba\(255, 154, 196, )\.\d+\)/, '$1.5)');
  assert.notEqual(bad, CSS, '反例确实改到了夜间边框');
  const r = measure(bad);
  assert.ok(r.inside < 3, `反例下对 hover 底应 < 3，实际 ${r.inside}`);
});
