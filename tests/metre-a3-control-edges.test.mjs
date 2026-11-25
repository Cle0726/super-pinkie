// 11-25 ui4 A3 打回 1：定时任务卡（#pinkie-schedules）和原生 /cron 页里按键、输入框的边框，
// 对卡片底要 ≥ 3:1（非文字控件）。原来是 --metre-line-strong：日 1.3–1.54、夜 1.2–1.34。
// 这里从 skin.css 读出 Metre 日夜色值和这两个作用域的边框混色规则，算出实际边框色再量对比度。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'ui', 'injections', 'laolao-metre-skin.css'), 'utf8');

// Metre 的日 / 夜色值：skin.css 里每个变量先出现日间、再出现夜间。
const tokens = (name) => [...css.matchAll(new RegExp(`--metre-${name}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))].map((m) => m[1]);
const pick = (name) => { const v = tokens(name); assert.ok(v.length >= 2, `找不到 --metre-${name} 的日夜两个值`); return {day: v[0], night: v[1]}; };
const T = {muted: pick('muted'), ls: pick('line-strong'), bg: pick('bg'), surface: pick('surface'), card: pick('card')};

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgb(h).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, p) => '#' + rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

// 读这两个作用域的边框色：--pk-a3-edge: color-mix(in srgb, var(--metre-X) N%, var(--metre-Y))，再要求按键 / 输入框用它。
function edge(theme) {
  const def = css.match(/:is\(#pinkie-schedules, openclaw-cron-page\) \{ --pk-a3-edge: color-mix\(in srgb, var\(--metre-([a-z-]+)\) (\d+)%, var\(--metre-([a-z-]+)\)\); \}/);
  if (!def) return T.ls[theme];   // 没有这条混色规则 = 还是 --metre-line-strong 原值
  // summary.btn：原生 /cron 页行尾「•••」(cron-job-menu__trigger) 和筛选下拉 (cron-filter-dropdown__trigger) 是 <summary class="btn">，不是 <button>。
  const use = /:is\(#pinkie-schedules, openclaw-cron-page\) :is\(button, input, select, textarea, summary\.btn\) \{ --metre-line-strong: var\(--pk-a3-edge\); \}/.test(css);
  if (!use) return T.ls[theme];
  const key = (n) => ({'muted': 'muted', 'line-strong': 'ls', 'bg': 'bg', 'surface': 'surface', 'card': 'card'})[n];
  assert.ok(key(def[1]) && key(def[3]), `不认识的变量 ${def[1]} / ${def[3]}`);
  return mix(T[key(def[1])][theme], T[key(def[3])][theme], Number(def[2]) / 100);
}

for (const theme of ['day', 'night']) {
  test(`A3 按键 / 输入框边框（${theme === 'day' ? '日间' : '夜间'}）：对卡片底、输入框底、页面底都 ≥ 3:1`, () => {
    const e = edge(theme);
    for (const bg of ['bg', 'surface', 'card']) {
      const r = ratio(e, T[bg][theme]);
      assert.ok(r >= 3, `边框 ${e} 对 --metre-${bg} ${T[bg][theme]} 只有 ${r.toFixed(2)}:1`);
    }
  });
}

test('A3 边框：只在定时任务卡和原生 /cron 页里换，Metre 前缀，没加 !important', () => {
  const line = css.split(/\r?\n/).find((l) => l.includes('--pk-a3-edge:'));
  assert.ok(line, '要有 --pk-a3-edge 那条规则');
  const rules = line.slice(line.indexOf('html[data-laolao-mode="metre"]:not(#_m1):not(#_m2) :is(#pinkie-schedules'));
  assert.match(rules, /^html\[data-laolao-mode="metre"\]/);
  assert.doesNotMatch(rules.split('/*')[0], /!important/);
});

test('A3 边框：原生 /cron 页「•••」和筛选下拉是 <summary class="btn">，规则要覆盖到', (t) => {
  const dir = process.env.PINKIE_CONTROL_UI_ROOT ? path.join(process.env.PINKIE_CONTROL_UI_ROOT, 'assets') : '';
  const f = dir && fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => /^cron-page-.*\.js$/.test(n)) : '';
  if (!f) { t.skip('没有原生 Control UI（PINKIE_CONTROL_UI_ROOT），只查规则'); }
  else {
    const js = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(js, /<summary\s+class="btn btn--sm cron-job-menu__trigger"/, '「•••」触发键不再是 <summary class="btn">？');
    assert.match(js, /<summary class="btn cron-filter-dropdown__trigger">/, '筛选下拉触发键不再是 <summary class="btn">？');
  }
  assert.match(css, /:is\(button, input, select, textarea, summary\.btn\) \{ --metre-line-strong: var\(--pk-a3-edge\); \}/);
});

test('A3 边框反例：改回 --metre-line-strong 原值就不够 3:1（日夜都不够）', () => {
  for (const theme of ['day', 'night']) assert.ok(ratio(T.ls[theme], T.surface[theme]) < 3, `${theme} 的原值本来就够了？`);
});
