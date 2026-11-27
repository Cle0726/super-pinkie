// B15（backlog，uireview #218 记）：工作台差异视图里删除行的底色原来取当前模式的 --accent。
// 碧琪是粉色还算像「删除」，Metre 的 --accent 是钴蓝（日 #2F4BB0 / 夜 #93A5EE），删除行变成灰蓝底、和选区一个颜色，夜里几乎看不出（#218 截图 r5-diff-1440-night）。
// 改成和新增行（固定绿）一样：删除行固定红，日夜各一套。
// 这里从源码里取出真的 applyTheme()，给它四种主题的颜色和一个只记录 defineTheme 的假 monaco，看传给 Monaco 的四个 diff 颜色。
// 反例：把那两行换回原来的 hex(c.accent, …) 再跑一遍，Metre 日夜的删除色是蓝不是红。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui/injections/laolao-workbench.js'), 'utf8');
const slice = (start, end) => { const i = source.indexOf(start); assert.ok(i >= 0, `源码里找不到 ${start}`); const j = source.indexOf(end, i); assert.ok(j > i, `源码里找不到 ${end}`); return source.slice(i, j); };
const helpers = slice('  const hex = (c, a) =>', '  // C.le. 主题：');

// 四种主题：themeColors() 读出来的 elevated / accent（值抄自 laolao-theme.css / laolao-night.css / laolao-metre-skin.css）
const THEMES = {
  'pinkie-day': {elevated: {r: 255, g: 253, b: 253}, accent: {r: 0xe9, g: 0x4f, b: 0x91}},
  'pinkie-night': {elevated: {r: 0x2a, g: 0x20, b: 0x30}, accent: {r: 0xff, g: 0x7f, b: 0xb3}},
  'metre-day': {elevated: {r: 255, g: 255, b: 255}, accent: {r: 0x2f, g: 0x4b, b: 0xb0}},
  'metre-night': {elevated: {r: 0x23, g: 0x23, b: 0x21}, accent: {r: 0x93, g: 0xa5, b: 0xee}},
};

function diffColors(themeName, transform = (s) => s) {
  const t = THEMES[themeName];
  let defined = null;
  const ctx = {
    window: {monaco: {editor: {defineTheme: (_name, def) => { defined = def; }, setTheme() {}}}},
    themeTerminal() {}, setVariable() {}, root: {classList: {toggle() {}}},
    themeColors: null,
  };
  const fn = transform(source.slice(source.indexOf('  function applyCardColors() {'), source.indexOf('\n  }\n', source.indexOf('  function applyTheme() {')) + 4));
  vm.runInNewContext(helpers + `
    function themeColors() {
      const elevated = ${JSON.stringify(t.elevated)}, text = {r: 239, g: 229, b: 234}, accent = ${JSON.stringify(t.accent)}, cle = {r: 98, g: 180, b: 255};
      const dark = luma(elevated) < 0.5;
      const bg = dark ? mix(elevated, {r: 12, g: 8, b: 14}, 0.38) : mix(elevated, {r: 255, g: 255, b: 255}, 0.55);
      return {dark, bg, text, accent, cle, muted: mix(bg, text, 0.48), faint: mix(bg, text, 0.12), line: mix(bg, text, 0.07), widget: mix(bg, {r: 255, g: 255, b: 255}, 0.05)};
    }
    ${fn}
    applyTheme();`, ctx);
  assert.ok(defined, `${themeName}: applyTheme 没调 defineTheme`);
  const c = defined.colors;
  return {removedLine: c['diffEditor.removedLineBackground'], removedText: c['diffEditor.removedTextBackground'], insertedLine: c['diffEditor.insertedLineBackground'], insertedText: c['diffEditor.insertedTextBackground']};
}

// #rrggbbaa → 色相（度）和不透明度
function hueAlpha(h) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h); assert.ok(m, `不是 8 位颜色：${h}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255), a = parseInt(m[4], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {hue: (hue * 60 + 360) % 360, alpha: a, sat: max ? d / max : 0};
}
const isRed = ({hue, sat}) => (hue >= 330 || hue <= 15) && sat >= 0.4;

for (const name of Object.keys(THEMES)) {
  test(`B15 ${name}：删除行 / 删除字的底色是红色，至少和新增的一样显眼`, () => {
    const c = diffColors(name);
    for (const key of ['removedLine', 'removedText']) assert.ok(isRed(hueAlpha(c[key])), `${name} ${key} = ${c[key]} 不是红色（${JSON.stringify(hueAlpha(c[key]))}）`);
    assert.ok(hueAlpha(c.removedLine).alpha >= hueAlpha(c.insertedLine).alpha, `${name}：删除行 ${c.removedLine} 比新增行 ${c.insertedLine} 还淡`);
    assert.ok(hueAlpha(c.removedText).alpha >= hueAlpha(c.insertedText).alpha, `${name}：删除字 ${c.removedText} 比新增字 ${c.insertedText} 还淡`);
  });
}

test('B15 反例：换回原来的 hex(c.accent, …)，Metre 日夜的删除色是蓝不是红', () => {
  let swapped = 0;
  const revert = (s) => s
    .replace(/'diffEditor\.removedTextBackground': c\.dark \? '#[0-9a-f]{8}' : '#[0-9a-f]{8}'/i, () => { swapped++; return "'diffEditor.removedTextBackground': hex(c.accent, 0.22)"; })
    .replace(/'diffEditor\.removedLineBackground': c\.dark \? '#[0-9a-f]{8}' : '#[0-9a-f]{8}'/i, () => { swapped++; return "'diffEditor.removedLineBackground': hex(c.accent, 0.09)"; });
  for (const name of ['metre-day', 'metre-night']) {
    const c = diffColors(name, revert);
    assert.ok(!isRed(hueAlpha(c.removedLine)) && !isRed(hueAlpha(c.removedText)), `反例没生效：${name} 换回 --accent 后删除色仍是红（${c.removedLine} / ${c.removedText}）`);
  }
  assert.equal(swapped, 4, '反例：源码里应正好两处删除色声明（两种 Metre 主题各换一次）');
});
