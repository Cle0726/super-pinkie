import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// B11：项目模式「工作程度」chip 在输入框下面那一行，不在白色输入盒里，底是 .card.chat::after 的雾色
// （--fog-deep = accent 26% + 白，项目模式约 205,226,227）。--muted-strong #4c7478 在这层雾上只有 3.8，
// mac2 实测 sidebar-collapsed / model-picker / long-conversation 3.28~4.03。
const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const WHITE = [255, 255, 255];
// mac2 7219007441 真页面像素读到的最暗底色（820 sidebar-collapsed）
const MEASURED = [[213, 224, 222], [203, 207, 209], [217, 230, 227]];

function projectVars() {
  const css = read('ui/injections/laolao-theme.css');
  const body = css.match(/^html\[data-laolao-mode="project"\] \{([^}]*)\}/m)?.[1] || '';
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v]));
}

function projectChipRule() {
  const css = read('ui/injections/laolao-session-tools.css');
  return [...css.matchAll(/(?<=^|\})\s*([^{}\n]*\.pinkie-chip--mode\[data-value="default"\][^{}\n]*)\{([^}]*)\}/gm)]
    .find(([, sel]) => /^html\[data-laolao-mode="project"\]/.test(sel.trim()));
}

test('project work-level chip has its own day colour rule in laolao-session-tools.css', () => {
  const rule = projectChipRule();
  assert.ok(rule, '项目模式默认态「工作程度」应单独上色');
  const [, sel, body] = rule;
  assert.match(sel, /:not\(\[data-pinkie-night\]\)/, '夜间由 night 配色管，不要盖');
  assert.match(sel, /:not\(\[data-theme="dark"\]\)/);
  assert.match(sel, /:not\(\.pinkie-baton\)/);
  assert.match(sel, /:not\(:hover\):not\(:focus-visible\)/, '悬停仍跟 .pinkie-chip:hover');
  assert.match(body, /color:var\(--chat-text,var\(--pt-quiet\)\)/);
  assert.doesNotMatch(body, /!important/);
});

test('project chip text and caret reach 4.5 / 3 on the fog row; the old --muted-strong recipe did not', () => {
  const v = projectVars();
  assert.ok(v['chat-text'] && v['muted-strong'] && v.accent, '项目模式变量缺失');
  const fogDeep = mix(hex(v.accent), WHITE, 0.26);
  for (const [name, bg] of [['white', WHITE], ['fog-deep', fogDeep], ...MEASURED.map((c) => [`measured ${c}`, c])]) {
    const r = ratio(hex(v['chat-text']), bg);
    assert.ok(r >= 4.5, `字 ${name} ${r.toFixed(2)} < 4.5`);
    assert.ok(r >= 3, `箭头 ${name} ${r.toFixed(2)} < 3`);
  }
  const old = ratio(hex(v['muted-strong']), fogDeep);
  assert.ok(old < 4.5, `旧色 ${old.toFixed(2)} 本来就够，测试失去意义`);
  const css = read('ui/injections/laolao-session-tools.css');
  assert.match(css, /:where\(html\[data-laolao-mode="project"\]\) \.pinkie-chip--mode \.pinkie-chip__caret \{ opacity:1 \}/, '项目模式箭头不能再叠 .7');
});
