// B11 走查第 20 项：设置页状态字 `.pinkie-user-settings__status`（默认 / busy）日间对设置卡底色 ≥ 4.5:1。
// 复发点：默认色 #54846e 落卡片底 4.18、busy #947248 落卡片底 4.30，微信块 soft 底上更低（3.84 / 3.96）。
// 修法在 laolao-settings-user.css 原规则上就地换色，不加 !important、不加行；夜间 laolao-night.css 已达标不动。
// 反例：换回旧色，卡片底与 soft 底都必须 <4.5。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(root, 'ui/injections/laolao-settings-user.css'), 'utf8');
const BASE_RULE = /^#laolao-user-settings \.pinkie-user-settings__status \{([^}]*)\}/m;
const stateRule = (s) => new RegExp(`^#laolao-user-settings \\.pinkie-user-settings__status\\[data-state="${s}"\\] \\{([^}]*)\\}`, 'm');
const WHITE = [255, 255, 255];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };

// 日间变量取文件里第一次出现（:16-17 日间块；夜间块在后面）；半透明底按白底合成。
function dayBg(name) {
  const m = CSS.match(new RegExp(`--pinkie-settings-${name}:\\s*(#[0-9a-f]{6}|rgba\\(([^)]*)\\))`, 'i'));
  assert.ok(m, `找到 --pinkie-settings-${name}`);
  if (!m[2]) return hex(m[1]);
  const [r, g, b, a] = m[2].split(',').map(Number);
  return [r, g, b].map((v, i) => v * a + WHITE[i] * (1 - a));
}
const BGS = {white: WHITE, card: dayBg('card'), soft: dayBg('soft'), hover: dayBg('hover')};

function colorOf(re) {
  const m = CSS.match(re);
  assert.ok(m, `找到规则 ${re}`);
  const c = m[1].match(/color:\s*(#[0-9a-f]{6})/i);
  assert.ok(c, `规则里有十六进制 color：${m[0]}`);
  return {rule: m[0], color: c[1]};
}

test('静态：默认 / busy / error 三条状态字规则都在，不用 !important', () => {
  for (const re of [BASE_RULE, stateRule('busy'), stateRule('error')]) {
    assert.doesNotMatch(colorOf(re).rule, /!important/);
  }
});

test('日间：默认、busy、error 状态字对白 / 卡片 / soft / hover 底都 ≥ 4.5', () => {
  for (const [label, re] of [['默认', BASE_RULE], ['busy', stateRule('busy')], ['error', stateRule('error')]]) {
    const {color} = colorOf(re);
    for (const [bg, rgb] of Object.entries(BGS)) {
      const r = ratio(hex(color), rgb);
      assert.ok(r >= 4.5, `${label} ${color} 对 ${bg} 仅 ${r}`);
    }
  }
});

test('反例：换回旧色 #54846e / #947248，卡片底与 soft 底都 <4.5', () => {
  for (const old of ['#54846e', '#947248']) {
    assert.ok(ratio(hex(old), BGS.card) < 4.5, `${old} 对 card ${ratio(hex(old), BGS.card)}`);
    assert.ok(ratio(hex(old), BGS.soft) < 4.5, `${old} 对 soft ${ratio(hex(old), BGS.soft)}`);
  }
});
