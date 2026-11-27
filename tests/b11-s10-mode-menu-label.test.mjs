// B11·chat S10：日间模式名（侧栏按钮「唠嗑模式」、菜单行「项目模式」等）在模式菜单玻璃底上要 ≥4.5:1。
// 底色取菜单渐变最深的一档 #fcecf3 并按不透明算（实际 a6 透明度叠在更亮的底上，只会更亮），
// 所以这里过了，真页面只会更好；走查实测改前 4.36 / 4.29。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const theme = read('ui/injections/laolao-theme.css');
const fx = read('ui/injections/laolao-mode-menu-fx.css');

const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];
const GLASS = '#fcecf3';
const DAY = 'html:not([data-pinkie-night]):not([data-theme-mode="dark"]):not([data-laolao-mode="metre"]) :is(.laolao-mode-switcher, .laolao-mode-menu__option)';

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function baseInk(mode) {
  const m = theme.match(new RegExp(`^\\[data-mode="${mode}"\\] \\{ --mode-button-ink: (#[0-9a-f]{6}); \\}`, 'm'));
  assert.ok(m, `laolao-theme.css 里没找到 ${mode} 的 --mode-button-ink`);
  return m[1];
}
function dayInk(css, mode) {
  const m = css.match(new RegExp(`^${esc(DAY)}\\[data-mode="${mode}"\\] \\{ --mode-button-ink: (#[0-9a-f]{6}); \\}`, 'm'));
  return m ? m[1] : baseInk(mode);
}
const failing = (css) => MODES.filter((mode) => ratio(dayInk(css, mode), GLASS) < 4.5);

test('日间每个模式名在菜单玻璃底上 ≥4.5:1', () => {
  for (const mode of MODES) {
    const ink = dayInk(fx, mode), r = ratio(ink, GLASS);
    assert.ok(r >= 4.5, `${mode} ${ink} 对 ${GLASS} 只有 ${r.toFixed(2)}`);
  }
});

test('反例：去掉日间覆盖（main 原样）唠嗑 / 项目 / 思考就不够', () => {
  const stripped = fx.split('\n').filter((line) => !line.startsWith(DAY)).join('\n');
  assert.deepEqual(failing(stripped), ['chat', 'project', 'thinking']);
});

test('覆盖只落在日间、非 Metre，且只改变量不加 !important', () => {
  const lines = fx.split('\n').filter((line) => line.includes('--mode-button-ink'));
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(line.startsWith(DAY), line);
    assert.doesNotMatch(line, /!important/);
  }
});
