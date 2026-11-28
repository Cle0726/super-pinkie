// B11：提问卡「其他」输入框占位字 `.laolao-ask__other-input::placeholder` 日夜对比度 ≥ 4.5:1。
// 复发点：#b98ea1 在输入框底上仅约 2.78。夜间没有覆盖提问卡与占位字，卡片是半透明浅色玻璃，叠在深色页面上底色会变暗。
// 修法在 laolao-ask-user.css 原规则就地换色，并写 opacity: 1（Firefox 默认会把占位字调淡）；不加 !important、不加行。
// 反例：换回 #b98ea1，日夜都必须 <4.5。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(root, 'ui/injections/laolao-ask-user.css'), 'utf8');
const PH_RULE = /^\.laolao-ask__other-input::placeholder \{([^}]*)\}/m;
const INPUT_RULE = /^\.laolao-ask__other-input \{([^}]*)\}/m;
const CARD_RULE = /^\.laolao-ask \{([^}]*)\}/m;
// 页面底：日间取白，夜间取纯黑作最不利值（真页面夜间底只会比黑亮）。
const PAGES = {day: [255, 255, 255], night: [0, 0, 0]};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
const rgba = (s) => s.split(',').map(Number);
const over = ([r, g, b, a], bg) => [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));

function block(re) {
  const m = CSS.match(re);
  assert.ok(m, `找到规则 ${re}`);
  return m;
}

// 卡片渐变每个色标、输入框半透明白，依次叠到页面底上；返回输入框可能出现的各个底色（含聚焦白底）。
function inputBgs(page) {
  const card = block(CARD_RULE)[1].match(/background:\s*linear-gradient\(([^;]*)\);/);
  assert.ok(card, '卡片背景是 linear-gradient');
  const stops = [...card[1].matchAll(/rgba\(([^)]*)\)/g)].map((m) => rgba(m[1]));
  assert.ok(stops.length >= 2, '卡片渐变至少两个色标');
  const input = block(INPUT_RULE)[1].match(/background:\s*rgba\(([^)]*)\)/);
  assert.ok(input, '输入框背景是 rgba');
  return [...stops.map((s) => over(rgba(input[1]), over(s, page))), [255, 255, 255]];
}

function placeholderColor() {
  const c = block(PH_RULE)[1].match(/color:\s*(#[0-9a-f]{6})/i);
  assert.ok(c, '占位字规则里有十六进制 color');
  return c[1];
}

test('静态：占位字规则在，不用 !important，opacity 为 1', () => {
  const [rule, body] = block(PH_RULE);
  assert.doesNotMatch(rule, /!important/);
  assert.match(body, /opacity:\s*1\s*;/);
});

test('日夜：占位字对输入框各底色（含聚焦白底）都 ≥ 4.5', () => {
  const fg = hex(placeholderColor());
  for (const [name, page] of Object.entries(PAGES)) {
    for (const bg of inputBgs(page)) {
      const r = ratio(fg, bg);
      assert.ok(r >= 4.5, `${name} 占位字 ${placeholderColor()} 对 ${bg.map(Math.round)} 仅 ${r}`);
    }
  }
});

test('占位字仍比输入正文浅，能和已填内容区分', () => {
  const text = block(INPUT_RULE)[1].match(/color:\s*(#[0-9a-f]{6})/i);
  assert.ok(text, '输入框正文有十六进制 color');
  assert.ok(lum(hex(placeholderColor())) > lum(hex(text[1])), `${placeholderColor()} 应比正文 ${text[1]} 浅`);
});

test('反例：换回 #b98ea1，日夜都 <4.5', () => {
  for (const [name, page] of Object.entries(PAGES)) {
    const worst = Math.min(...inputBgs(page).map((bg) => ratio(hex('#b98ea1'), bg)));
    assert.ok(worst < 4.5, `${name} 旧占位字 ${worst}`);
  }
});
