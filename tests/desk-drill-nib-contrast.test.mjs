// B11 复发防护：背一背顶部进度条的笔尖图标（.pk-drill-nib，laolao-desk-reward.css）是 UI 图标，对所在轨道底色要 ≥3:1。
// mac2 任务 108 真 WebKit 走查读到日间 var(--pink) #E5488F 落在手账轨道 --hair #E6DCD6 上只有 2.75:1；夜间 5.08 达标。
// 这里按真实层叠取色：v1 令牌 laolao-study-desk.css，之后手账皮肤 laolao-study-desk-ink.css 盖掉 --hair / --paper 等。
// 笔尖在 0 进度时整只压在轨道上，轨道外是纸 / 卡片，所以每个可能的实底都量，取最低。
// 反例：把笔尖色贴回 var(--pink)，同一套量法日间必须 <3。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const read = (name) => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const ICON_MIN = 3;

function block(css, selector) {
  const at = css.indexOf(selector + '{');
  assert.ok(at >= 0, `找不到 ${selector}{`);
  return css.slice(at + selector.length + 1, css.indexOf('}', at));
}
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) out[m[1]] = m[2].trim();
  return out;
}
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };

const desk = read('laolao-study-desk.css');
const skin = read('laolao-study-desk-ink.css');
const reward = read('laolao-desk-reward.css');
const THEMES = {
  day: {...tokens(block(desk, '#pinkie-study-desk')), ...tokens(block(skin, '#pinkie-study-desk.pk-ink'))},
  night: {
    ...tokens(block(desk, '#pinkie-study-desk')), ...tokens(block(desk, '#pinkie-study-desk[data-theme="night"]')),
    ...tokens(block(skin, '#pinkie-study-desk.pk-ink')), ...tokens(block(skin, '#pinkie-study-desk.pk-ink[data-theme="night"]')),
  },
};
const V1_HAIR = {day: tokens(block(desk, '#pinkie-study-desk')).hair, night: tokens(block(desk, '#pinkie-study-desk[data-theme="night"]')).hair};

function resolve(value, theme) {
  const m = /^var\(--([\w-]+)\)$/.exec(value.trim());
  const v = m ? THEMES[theme][m[1]] : value.trim();
  assert.match(v || '', /^#[0-9a-fA-F]{6}$/, `${theme}: ${value} 没解析成 #rrggbb（得到 ${v}）`);
  return v;
}
function lowest(color, theme) {
  const t = THEMES[theme];
  const fg = resolve(color, theme);
  const bgs = {hair: t.hair, 'v1 hair': V1_HAIR[theme], paper: t.paper, card: t.card};
  return Object.entries(bgs).map(([k, bg]) => ({k, bg, r: ratio(fg, bg)})).sort((a, b) => a.r - b.r)[0];
}

test('B11 背一背进度笔尖：日夜对轨道 / 纸 / 卡片都 ≥3:1；贴回 var(--pink) 日间必须 <3', () => {
  const rule = block(reward, '#pinkie-study-desk .pk-drill-nib');
  assert.doesNotMatch(rule, /!important/, '笔尖规则不能靠 !important');
  const color = /(?:^|;)color:([^;]+)/.exec(rule)?.[1];
  assert.ok(color, `笔尖规则里没有 color：${rule}`);
  for (const theme of ['day', 'night']) {
    const low = lowest(color, theme);
    assert.ok(low.r >= ICON_MIN, `${theme}: 笔尖 ${color} 在 ${low.k} ${low.bg} 上 ${low.r}:1 < ${ICON_MIN}`);
  }
  const oldDay = lowest('var(--pink)', 'day');
  assert.ok(oldDay.r < ICON_MIN, `反例没生效：var(--pink) 日间最低应 <${ICON_MIN}，得到 ${oldDay.k} ${oldDay.r}`);
  assert.equal(oldDay.r, 2.75, '反例应复现走查读数 2.75（手账 --hair）');
  assert.ok(lowest('var(--pink)', 'night').r >= ICON_MIN, '夜间原色本就达标，量法不应误判');
});
