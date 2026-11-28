// B11·project 走查 #13：工作台编辑器行号 .line-numbers 日夜都很淡（1.22–2.73:1，第 10 行几乎看不见），当前行号 3.75:1。
// 根因：Monaco 主题里行号色写死成 hex(c.muted, 0.7)（muted 本身只是底色到字色的 48%，再叠 70% 不透明），当前行号直接用 --accent，都没对底色校验。
// 改成 reach()：从原来的颜色往字色挪，挪到对底色（当前行号对当前行高亮底）≥4.6:1 为止，日夜各模式都一样处理。
// 这里从源码里取出真的 applyTheme()，给它各模式的颜色和一个只记录 defineTheme 的假 monaco，按传给 Monaco 的颜色算对比度。
// 反例：把那一行换回原来的 hex(c.muted, 0.7) / hex(c.accent) 再跑一遍，日间行号必须掉到 4.5 以下。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui/injections/laolao-workbench.js'), 'utf8');
const slice = (start, end) => { const i = source.indexOf(start); assert.ok(i >= 0, `源码里找不到 ${start}`); const j = source.indexOf(end, i); assert.ok(j > i, `源码里找不到 ${end}`); return source.slice(i, j); };
const helpers = slice('  const hex = (c, a) =>', '  // C.le. 主题：');
const OLD_LINE = "'editorLineNumber.foreground': hex(c.muted, 0.7), 'editorLineNumber.activeForeground': hex(c.accent),";

// themeColors() 读出来的 --bg-elevated / --text / --accent（值抄自 laolao-theme.css / laolao-night.css / laolao-metre-skin.css）
const h = (s) => ({r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16)});
const THEMES = {
  'pinkie-day': ['#fffdfd', '#623247', '#e94f91'],
  'chat-day': ['#fffdfd', '#713550', '#e94f91'],
  'project-day': ['#fffdfd', '#2d666b', '#3f8f92'],
  'thinking-day': ['#fffdfd', '#65427f', '#9164ad'],
  'learning-day': ['#fffdfd', '#4f5688', '#7d76b5'],
  'unrestricted-day': ['#fffdfd', '#7b304e', '#d64f79'],
  'pinkie-night': ['#2a2030', '#efe5ea', '#ff7fb3'],
  'metre-day': ['#ffffff', '#1b1a18', '#2f4bb0'],
  'metre-night': ['#232321', '#eceae4', '#93a5ee'],
};
const DAY = Object.keys(THEMES).filter((n) => n.endsWith('-day'));

function themeOf(name, transform = (s) => s) {
  const [elevated, text, accent] = THEMES[name].map(h);
  let defined = null;
  const ctx = {
    window: {monaco: {editor: {defineTheme: (_name, def) => { defined = def; }, setTheme() {}}}},
    themeTerminal() {}, setVariable() {}, root: {classList: {toggle() {}}},
  };
  const fn = transform(source.slice(source.indexOf('  function applyCardColors() {'), source.indexOf('\n  }\n', source.indexOf('  function applyTheme() {')) + 4));
  vm.runInNewContext(helpers + `
    function themeColors() {
      const elevated = ${JSON.stringify(elevated)}, text = ${JSON.stringify(text)}, accent = ${JSON.stringify(accent)}, cle = {r: 98, g: 180, b: 255};
      const dark = luma(elevated) < 0.5;
      const bg = dark ? mix(elevated, {r: 12, g: 8, b: 14}, 0.38) : mix(elevated, {r: 255, g: 255, b: 255}, 0.55);
      return {dark, bg, text, accent, cle, muted: mix(bg, text, 0.48), faint: mix(bg, text, 0.12), line: mix(bg, text, 0.07), widget: mix(bg, {r: 255, g: 255, b: 255}, 0.05)};
    }
    ${fn}
    applyTheme();`, ctx);
  assert.ok(defined, `${name}: applyTheme 没调 defineTheme`);
  return defined.colors;
}

// #rrggbb[aa] 叠到不透明底上
function solid(hexColor, under) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hexColor); assert.ok(m, `不是颜色：${hexColor}`);
  const a = m[4] == null ? 1 : parseInt(m[4], 16) / 255;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return under ? {r: under.r + (r - under.r) * a, g: under.g + (g - under.g) * a, b: under.b + (b - under.b) * a} : {r, g, b};
}
const lum = (c) => [c.r, c.g, c.b].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function lineNumberContrast(colors) {
  const bg = solid(colors['editor.background']);
  const lineBg = solid(colors['editor.lineHighlightBackground'], bg);
  return {
    number: ratio(solid(colors['editorLineNumber.foreground'], bg), bg),
    active: ratio(solid(colors['editorLineNumber.activeForeground'], lineBg), lineBg),
    text: ratio(solid(colors['editor.foreground'], bg), bg),
  };
}

for (const name of Object.keys(THEMES)) {
  test(`B11 ${name}：行号与当前行号对比度 ≥4.5:1，且行号仍比正文淡`, () => {
    const c = lineNumberContrast(themeOf(name));
    assert.ok(c.number >= 4.5, `${name} 行号 ${c.number.toFixed(2)}:1 < 4.5`);
    assert.ok(c.active >= 4.5, `${name} 当前行号 ${c.active.toFixed(2)}:1 < 4.5`);
    assert.ok(c.number < c.text, `${name} 行号 ${c.number.toFixed(2)} 不比正文 ${c.text.toFixed(2)} 淡，层次没了`);
  });
}

test('B11 反例：换回 hex(c.muted, 0.7) / hex(c.accent)，日间行号全部掉到 4.5 以下，碧琪日间当前行号也不够', () => {
  assert.ok(!source.includes(OLD_LINE), '源码里还是旧写法');
  let swapped = 0;
  const revert = (s) => s.replace(/'editorLineNumber\.foreground': [^\n]*?'editorLineNumber\.activeForeground': hex\(reach\([^\n]*?\)\),/, () => { swapped++; return OLD_LINE; });
  for (const name of DAY) {
    const c = lineNumberContrast(themeOf(name, revert));
    assert.ok(c.number < 4.5, `反例没生效：${name} 旧写法行号仍有 ${c.number.toFixed(2)}:1`);
  }
  assert.ok(lineNumberContrast(themeOf('pinkie-day', revert)).active < 4.5, '反例没生效：碧琪日间旧写法当前行号也够 4.5');
  assert.equal(swapped, DAY.length + 1, '反例：源码里应正好一处行号颜色声明');
});
