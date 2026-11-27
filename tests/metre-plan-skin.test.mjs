// T3 #10 计划卡（L24）：对话区的工作计划卡（laolao-plan.js，plan_update 的真实清单）在 Metre 下换成 Metre 的配色。
// 不起浏览器：从 laolao-rich.css 读碧琪那一套 --pk-*（html 上的日 / 夜两块），再叠上 laolao-metre-plan.css 定义在 .pk-plan 上的值，
// 用 laolao-metre-skin.css 里 Metre 的日夜色值算出卡片实际用的颜色，量对比度。
// 反例：把 laolao-metre-plan.css 里那两块变量去掉（= 回到修复前），卡片还是 #2f7bff 蓝、半透明面板、绿色「完成」，下面的配色测试要红。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const inj = (name) => fs.readFileSync(path.join(root, 'ui', 'injections', name), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const skin = inj('laolao-metre-skin.css');
const rich = strip(inj('laolao-rich.css'));
const PLAN_FILE = path.join(root, 'ui', 'injections', 'laolao-metre-plan.css');
const planCss = fs.existsSync(PLAN_FILE) ? strip(fs.readFileSync(PLAN_FILE, 'utf8')) : '';

// ── 颜色 ──
const parseColor = (s) => {
  s = s.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) { const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]; return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1}; }
  if (s === 'transparent') return {r: 0, g: 0, b: 0, a: 0};
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; }
  return null;
};
const over = (top, under) => {
  const a = top.a + under.a * (1 - top.a);
  const ch = (k) => (top[k] * top.a + under[k] * under.a * (1 - top.a)) / (a || 1);
  return {r: ch('r'), g: ch('g'), b: ch('b'), a};
};
// color-mix(in srgb, A p%, B)：按 CSS Color 5 用预乘透明度混
const mix = (A, p, B) => {
  const a = A.a * p + B.a * (1 - p);
  const ch = (k) => (A[k] * A.a * p + B[k] * B.a * (1 - p)) / (a || 1);
  return {r: ch('r'), g: ch('g'), b: ch('b'), a};
};
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

// ── Metre 日夜色值：skin.css 里每个变量先出现日间、再出现夜间 ──
const token = (name) => {
  const v = [...skin.matchAll(new RegExp(`--metre-${name}:\\s*(#[0-9A-Fa-f]{6}|rgba\\([^)]+\\))`, 'g'))].map((m) => parseColor(m[1]));
  assert.ok(v.length >= 2, `找不到 --metre-${name} 的日夜两个值`);
  return {day: v[0], night: v[1]};
};
const METRE = Object.fromEntries(['bg', 'text', 'muted', 'line-strong', 'card', 'hover', 'cobalt', 'cobalt-soft'].map((n) => [n, token(n)]));

// 顶层逗号切分（跳过括号里的逗号）
const splitTop = (s) => { const out = []; let depth = 0, buf = ''; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; } else buf += ch; } if (buf.trim()) out.push(buf.trim()); return out; };
function resolve(expr, theme, vars) {
  expr = expr.trim();
  let m = /^var\(--metre-([a-z-]+)/.exec(expr);
  if (m) { assert.ok(METRE[m[1]], `测试不认识 --metre-${m[1]}`); return METRE[m[1]][theme]; }
  m = /^var\((--pk-[a-z-]+)/.exec(expr);
  if (m) return resolve(vars[m[1]], theme, vars);
  m = /^color-mix\(in srgb,\s*([\s\S]+)\)$/.exec(expr);
  if (m) {
    const [a, b] = splitTop(m[1]);
    const pm = /^(.+?)\s+(\d+(?:\.\d+)?)%$/.exec(a);
    assert.ok(pm, `color-mix 第一项要写百分比：${a}`);
    return mix(resolve(pm[1], theme, vars), Number(pm[2]) / 100, resolve(b, theme, vars));
  }
  const c = parseColor(expr);
  assert.ok(c, `解析不了颜色：${expr}`);
  return c;
}

// 同一个选择器可能出现好几块（laolao-rich.css 的 --pk-solid 在后面另起一块），按出现顺序合并，后面的盖前面的。
const declsOf = (css, selector) => {
  const out = {};
  for (let at = css.indexOf(selector + ' {'); at >= 0; at = css.indexOf(selector + ' {', at + 1)) {
    if (at > 0 && !/[\s}]/.test(css[at - 1])) continue;   // 只认整条选择器，不认别的选择器的尾巴
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    for (const d of body.split(';').map((x) => x.trim()).filter(Boolean)) out[d.slice(0, d.indexOf(':')).trim()] = d.slice(d.indexOf(':') + 1).trim();
  }
  return out;
};
const RICH_DAY = declsOf(rich, 'html:not(#p1):not(#p2):not(#p3)');
const RICH_NIGHT = declsOf(rich, 'html[data-pinkie-night]:not(#p1):not(#p2):not(#p3)');
assert.ok(RICH_DAY['--pk-accent'] && RICH_NIGHT['--pk-accent'], 'laolao-rich.css 的 --pk-* 日夜两块变了，测试要跟着改');

// 卡片上实际生效的 --pk-*：html 上碧琪的值（夜间块盖日间块），再被 .pk-plan 自己的 Metre 值盖掉。
function cardVars(css, theme) {
  const vars = {...RICH_DAY, ...(theme === 'night' ? RICH_NIGHT : {})};
  Object.assign(vars, declsOf(css, 'html[data-laolao-mode="metre"] .pk-plan'));
  if (theme === 'night') Object.assign(vars, declsOf(css, 'html[data-laolao-mode="metre"]:is([data-pinkie-night], [data-theme="dark"]) .pk-plan'));
  return vars;
}

function paletteProblems(css, theme) {
  const v = cardVars(css, theme);
  const c = (name) => resolve(v[name], theme, v);
  const page = METRE.bg[theme];
  const panel = over(c('--pk-panel'), page);
  const label = over(c('--pk-on'), panel);
  const problems = [];
  const need = (what, fg, bg, min) => { const r = ratio(fg, bg); if (r < min) problems.push(`${what} ${hex(fg)} 对 ${hex(bg)} 只有 ${r.toFixed(2)}:1（要 ≥ ${min}）`); };
  if (c('--pk-panel').a < 1) problems.push(`卡片底是半透明的 ${v['--pk-panel']}（Metre 要实底）`);
  if (hex(c('--pk-accent')) !== hex(METRE.cobalt[theme])) problems.push(`强调色 ${hex(c('--pk-accent'))} 不是 Metre 钴蓝 ${hex(METRE.cobalt[theme])}`);
  if (hex(c('--pk-good')) !== hex(METRE.cobalt[theme])) problems.push(`「完成」色 ${hex(c('--pk-good'))} 不是 Metre 钴蓝（不用绿）`);
  need('正文', over(c('--pk-fg'), panel), panel, 4.5);
  need('小字（计数、说明、已完成项）', over(c('--pk-mute'), panel), panel, 4.5);
  need('「计划」标签字', over(c('--pk-accent-ink'), label), label, 4.5);
  need('已完成的实心圆 / 进度格', over(c('--pk-accent'), panel), panel, 3);
  need('未开始的空心圈（.7 透明）', over({...c('--pk-mute'), a: c('--pk-mute').a * 0.7}, panel), panel, 3);
  need('对勾（--pk-solid 画在钴蓝实心圆上）', over(c('--pk-solid'), c('--pk-accent')), c('--pk-accent'), 3);
  // laolao-rich.css：box-shadow: inset 0 0 0 1px var(--pk-faint), var(--pk-shadow) —— 列表里夹 none 整条作废、细边也没了
  if (/\bnone\b/.test(v['--pk-shadow'] || '')) problems.push('--pk-shadow 不能是 none（会让 .pk-plan 的整条 box-shadow 失效，细边跟着没了）');
  return problems;
}

for (const theme of ['day', 'night']) {
  test(`计划卡（${theme === 'day' ? '日间' : '夜间'}）：Metre 下用钴蓝和实底，字和标记对卡片底够对比度`, () => {
    assert.ok(planCss, 'ui/injections/laolao-metre-plan.css 不存在');
    assert.deepEqual(paletteProblems(planCss, theme), []);
  });
}

test('反例：去掉 laolao-metre-plan.css 的两块变量（回到修复前），同一组检查要红', () => {
  for (const theme of ['day', 'night']) {
    const problems = paletteProblems('', theme);
    assert.ok(problems.some((p) => p.includes('强调色')), `${theme}：没查出碧琪的 #2f7bff`);
    assert.ok(problems.some((p) => p.includes('半透明')), `${theme}：没查出半透明面板`);
  }
});

test('只在 Metre 生效：每条规则都以 html[data-laolao-mode="metre"] 开头，没有 !important、没有 @ 规则', () => {
  assert.ok(planCss, 'ui/injections/laolao-metre-plan.css 不存在');
  assert.doesNotMatch(planCss, /!\s*important/i);
  assert.doesNotMatch(planCss, /@/);
  const selectors = [...planCss.matchAll(/([^{}]+)\{/g)].flatMap((m) => splitTop(m[1].trim()));
  assert.ok(selectors.length >= 3, '没读到规则');
  // html[data-laolao-mode="metre"] 后面只许跟 :is(...) / :not(...)（日夜、压权重），再接后代 .pk-plan
  for (const sel of selectors) assert.match(sel, /^html\[data-laolao-mode="metre"\](?::(?:is|not)\([^()]*\))*\s+\.pk-plan(?:__[a-z]+)?$/, `规则没限定在 Metre 的计划卡上：${sel}`);
});

test('登记：头片段在 laolao-plan.js 后面加载（?v=@hash），regions.json 归 metre 区域', () => {
  const head = inj('laolao-head.fragment.html');
  const plan = head.indexOf('<script defer src="/laolao-plan.js?v=@hash"></script>');
  const mine = head.indexOf('<link rel="stylesheet" href="/laolao-metre-plan.css?v=@hash">');
  assert.ok(plan >= 0 && mine > plan, '头片段里 laolao-metre-plan.css 要在 laolao-plan.js 后面，用 ?v=@hash');
  assert.ok(head.indexOf('href="/laolao-rich.css?v=@hash"') < mine, '要在 laolao-rich.css 之后加载');
  const regions = JSON.parse(inj('regions.json'));
  const metre = regions.regions.find((r) => r.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-plan.css'), 'regions.json 的 metre 区域没登记 laolao-metre-plan.css');
});
