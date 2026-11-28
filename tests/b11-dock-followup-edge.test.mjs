// B11 thinking.md 外壳表：分屏按钮 `.laolao-mode-dock-trigger` 与运行中追问方式按钮 `button.laolao-followup-mode-btn` 边框 ≥ 3:1。
// 复发点：dock 边框 rgba(205,85,137,.30)、followup 边框 color-mix(--accent 28%, transparent)（queue 48%），
// 走查实测日/夜 1.46 / 1.42 / 1.73。两个按钮的自身底色都是半透明浅色或渐变，撑不起 3:1，只能靠边框。
// 修法：边框 = color-mix(--accent 80%, --text-strong)；日间 --text-strong 是各模式深色，夜间 laolao-night.css 换成 --n-ink-strong。
// 不碰 [data-mode] 的 --mode-button-ink（#446）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME = fs.readFileSync(path.join(root, 'ui/injections/laolao-theme.css'), 'utf8');
const NIGHT = fs.readFileSync(path.join(root, 'ui/injections/laolao-night.css'), 'utf8');
const MODES = ['base', 'chat', 'project', 'thinking', 'learning', 'unrestricted'];
const DAY_BGS = ['#ffffff', '#fffcfd', '#fdf3f7', '#fbeef4', '#f7e6ee'];
const NIGHT_BGS = ['#000000', '#140f17', '#1a1320', '#241b29', '#2a2030', '#30263a'];
const EDGE = 'border: 1px solid color-mix(in srgb, var(--accent) 80%, var(--text-strong))';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));

const block = (css, head) => {
  const at = css.indexOf(`\n${head} {\n`);
  assert.ok(at >= 0, `找到 ${head}`);
  return css.slice(at, css.indexOf('\n}', at + 1));
};
const pick = (css, re) => Object.fromEntries([...(css || '').matchAll(re)].map((m) => [m[1], m[2]]));
const VAR = /(--accent|--text-strong):\s*(#[0-9a-f]{6})/gi;

function dayVars(mode) {
  const base = pick(THEME.match(/^html\[data-theme\] \{([^}]*)\}/m)?.[1], VAR);
  return mode === 'base' ? base : {...base, ...pick(THEME.match(new RegExp(`^html\\[data-laolao-mode="${mode}"\\] \\{([^}]*)\\}`, 'm'))?.[1], VAR)};
}
function nightVars(mode) {
  const strong = NIGHT.match(/--n-ink-strong:\s*(#[0-9a-f]{6})/i)[1];
  const base = NIGHT.match(/--accent:\s*(#[0-9a-f]{6})/i)[1];
  const own = NIGHT.match(new RegExp(`html\\[data-pinkie-night\\]\\[data-laolao-mode="${mode}"\\][^{]*\\{[^}]*--accent:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  return {'--accent': own || base, '--text-strong': strong};
}

const edgeMin = (rgb, bgs) => Math.min(...bgs.map((b) => ratio(rgb, hex(b))));
const fresh = (v) => mix(hex(v['--accent']), hex(v['--text-strong']), 0.8);
const translucent = (rgb, a, bgs) => Math.min(...bgs.map((b) => ratio(mix(rgb, hex(b), a), hex(b))));

test('静态：dock / followup 边框改成 accent×text-strong 80%，queue 不再覆盖回半透明，--mode-button-ink 原样', () => {
  const dock = block(THEME, '.laolao-mode-dock-trigger');
  assert.ok(dock.includes(`${EDGE};`), 'dock 边框');
  assert.doesNotMatch(dock, /!important/);
  const live = block(THEME, 'html:not([data-laolao-plain-composer]) .agent-chat__input:has(.chat-send-btn--stop) button.laolao-followup-mode-btn');
  assert.ok(live.includes(`${EDGE} !important;`), 'followup 边框');
  const queue = block(THEME, 'html:not([data-laolao-plain-composer]) .agent-chat__input button.laolao-followup-mode-btn[data-pinkie-followup-mode="queue"]');
  assert.doesNotMatch(queue, /border/);
  assert.doesNotMatch(THEME, /laolao-followup-mode-btn[^{]*\{[^}]*border[^;}]*transparent/);
  for (const [m, ink] of Object.entries({chat: '#b34f7c', project: '#3e8584', thinking: '#965b98', learning: '#615b9a', unrestricted: '#ad4268'})) {
    assert.ok(THEME.includes(`\n[data-mode="${m}"] { --mode-button-ink: ${ink}; }\n`), `--mode-button-ink ${m} 未动`);
  }
});

test('各模式 × 日 / 夜 × 多种外底：边框 ≥ 3', () => {
  for (const mode of MODES) {
    const d = edgeMin(fresh(dayVars(mode)), DAY_BGS), n = edgeMin(fresh(nightVars(mode)), NIGHT_BGS);
    assert.ok(d >= 3, `${mode} 日 ${d}`);
    assert.ok(n >= 3, `${mode} 夜 ${n}`);
  }
});

test('反例：旧边框（dock .30、followup 28% / queue 48%）日夜都 <3', () => {
  assert.ok(translucent(hex('#cd5589'), 0.30, DAY_BGS) < 3, 'dock 旧边框 日');
  assert.ok(translucent(hex('#cd5589'), 0.30, NIGHT_BGS) < 3, 'dock 旧边框 夜');
  for (const mode of MODES) {
    for (const a of [0.28, 0.48]) {
      assert.ok(translucent(hex(dayVars(mode)['--accent']), a, DAY_BGS) < 3, `${mode} 日 followup ${a}`);
      assert.ok(translucent(hex(nightVars(mode)['--accent']), a, NIGHT_BGS) < 3, `${mode} 夜 followup ${a}`);
    }
  }
});
