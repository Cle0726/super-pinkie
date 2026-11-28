// B11：非 Metre 归档撤销条「已归档 · 撤销」。
// ① 「撤销」字色原为 var(--accent)，压在 #fffafb 上项目日间只有 3.66:1（13px 小字要 ≥4.5）；
//    改为日间 accent 70% 混正文字色 #44343c，夜间保持原 accent（已 ≥6.3）。
// ② 撤销条原为 bottom:32px，1440 宽落在输入框下方工具栏一行；改为出现时按输入框外壳顶边向上避让。
// Metre 的撤销条皮肤在 laolao-metre-undo.css（#438），这里的规则优先级不高于它，JS 避让也跳过 Metre。
// 反例：换回旧写法（var(--accent) / 不避让），这里必须变红。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const read = (f) => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + f, import.meta.url)), 'utf8');
const BAR = '.pinkie-archive-undo';
const NIGHT = 'html[data-pinkie-night]';

function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let m;
  while ((m = re.exec(text))) {
    const decls = new Map();
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':');
      if (i > 0) decls.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
    out.push({selectors: m[1].split(',').map((s) => s.trim()), decls});
  }
  return out;
}
const declsOf = (rs, sel) => rs.find((r) => r.selectors.includes(sel))?.decls;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => c.map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));

// 按写法把 color 值解析成实际颜色；只认本文件会出现的两种写法。
function resolve(value, accent) {
  if (/^var\(--accent,#[0-9a-f]{6}\)$/i.test(value)) return hex(accent);
  const m = /^color-mix\(in srgb,\s*var\(--accent,#[0-9a-f]{6}\)\s+(\d+)%,\s*(#[0-9a-f]{6})\)$/i.exec(value);
  assert.ok(m, `不认识的字色写法：${value}`);
  return mix(hex(accent), hex(m[2]), Number(m[1]) / 100);
}

const accentsIn = (css) => [...new Set([...css.matchAll(/--accent:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase()))];
const DAY_ACCENTS = [...accentsIn(read('laolao-theme.css')), '#d9508d'];
const NIGHT_ACCENTS = accentsIn(read('laolao-night.css'));
// var(--accent,<兜底>) 的兜底色也要过线：没设 --accent 的页面就显示它。
const fallbackOf = (value) => /var\(--accent,(#[0-9a-f]{6})\)/i.exec(value)[1].toLowerCase();

function contrastRows(css) {
  const rs = rules(css);
  const bar = declsOf(rs, BAR), nightBar = declsOf(rs, `${NIGHT} ${BAR}`);
  const btn = declsOf(rs, `${BAR} button`), nightBtn = declsOf(rs, `${NIGHT} ${BAR} button`);
  const dayColor = btn.get('color'), nightColor = nightBtn?.get('color') ?? dayColor;
  return [
    ...DAY_ACCENTS.map((a) => ({theme: 'day', accent: a, ratio: ratio(resolve(dayColor, a), hex(bar.get('background')))})),
    ...[...new Set([...NIGHT_ACCENTS, fallbackOf(nightColor)])].map((a) => ({theme: 'night', accent: a, ratio: ratio(resolve(nightColor, a), hex(nightBar.get('background')))})),
  ];
}

test('undo text is >=4.5:1 on the bar for every non-Metre accent, day and night', () => {
  assert.ok(DAY_ACCENTS.includes('#3f8f92') && DAY_ACCENTS.length >= 6, `日间 accent 读全：${DAY_ACCENTS}`);
  assert.ok(NIGHT_ACCENTS.includes('#5cc6c4') && NIGHT_ACCENTS.length >= 5, `夜间 accent 读全：${NIGHT_ACCENTS}`);
  for (const row of contrastRows(read('laolao-sidebar.css'))) {
    assert.ok(row.ratio >= 4.5, `${row.theme} ${row.accent}「撤销」${row.ratio.toFixed(2)}:1 < 4.5`);
  }
});

test('counterexample: the old color:var(--accent) fails in day', () => {
  const now = read('laolao-sidebar.css');
  const old = now
    .replace(/(\.pinkie-archive-undo button\{[^}]*?color:)color-mix\(in srgb,var\(--accent,#d9508d\) 70%,#44343c\)/, '$1var(--accent,#d9508d)')
    .replace(/html\[data-pinkie-night\] \.pinkie-archive-undo button\{color:var\(--accent,#[0-9a-f]{6}\)\}/i, '');
  assert.notEqual(old, now, '反例确实换回了旧写法');
  const bad = contrastRows(old).filter((r) => r.theme === 'day' && r.ratio < 4.5).map((r) => r.accent);
  assert.ok(bad.includes('#3f8f92'), `项目日间旧写法应 <4.5，实际不过的：${bad}`);
});

test('focus ring stays >=3:1 and no rule outranks the Metre skin (#438)', () => {
  const rs = rules(read('laolao-sidebar.css'));
  const bg = hex(declsOf(rs, BAR).get('background'));
  for (const a of DAY_ACCENTS) assert.ok(ratio(hex(a), bg) >= 3, `日间焦点框 ${a} >=3`);
  for (const r of rs) for (const sel of r.selectors) {
    if (!sel.includes(BAR)) continue;
    const attrs = (sel.match(/\[[^\]]*\]/g) || []).length;
    const classes = (sel.replace(/\[[^\]]*\]/g, '').match(/\.[\w-]+|:[\w-]+/g) || []).length;
    assert.ok(attrs + classes <= 2 && !sel.includes('#'), `${sel} 不得压过 Metre 规则 (0,2,1)`);
    assert.doesNotMatch([...r.decls.values()].join(';'), /!important/, `${sel} 不加 !important`);
  }
});

function runShow({mode, shellTop, innerHeight = 800, src = read('laolao-sidebar.js')}) {
  const start = src.indexOf('  function showArchiveUndo(key) {');
  const body = src.slice(start, src.indexOf('\n  }\n', start) + 4);
  const made = [];
  const el = () => { const e = {style: {}, dataset: {}, setAttribute() {}, append() {}, remove() {}}; made.push(e); return e; };
  const shell = shellTop == null ? null : {getBoundingClientRect: () => ({top: shellTop, height: Math.max(1, innerHeight - shellTop - 10)})};
  const document = {
    documentElement: {dataset: mode ? {laolaoMode: mode} : {}},
    createElement: el,
    body: {append() {}},
    querySelector: (s) => (s === '.agent-chat__composer-shell' ? shell : null),
  };
  vm.runInNewContext(`${body}\nshowArchiveUndo('k');`, {document, innerHeight, setTimeout() {}, patchSession() {}, toast() {}, Math});
  return made.find((e) => e.className === 'pinkie-archive-undo');
}

test('the bar is lifted above the composer shell (toolbar included) outside Metre', () => {
  for (const mode of ['project', 'unrestricted', 'chat', undefined]) {
    assert.equal(runShow({mode, shellTop: 640}).style.bottom, '168px', `${mode}：bottom = 800 - 640 + 8`);
  }
  assert.equal(runShow({mode: 'project', shellTop: 790}).style.bottom, '32px', '不低于原来的 32px');
  assert.equal(runShow({mode: 'project', shellTop: null}).style.bottom, undefined, '没有输入框时保持 CSS 的 32px');
  assert.equal(runShow({mode: 'metre', shellTop: 640}).style.bottom, undefined, 'Metre 不动（#438 另管）');
});

test('counterexample: without the lift the bar keeps bottom:32px over the toolbar', () => {
  const now = read('laolao-sidebar.js');
  const src = now.replace(/const shell=document\.documentElement[^\n]*?'px';/, '');
  assert.notEqual(src, now, '反例确实去掉了避让');
  assert.equal(runShow({mode: 'project', shellTop: 640, src}).style.bottom, undefined);
  assert.match(read('laolao-sidebar.css'), /\.pinkie-archive-undo\{[^}]*bottom:32px/);
});
