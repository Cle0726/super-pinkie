import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = readFileSync(path.join(ROOT, 'ui/injections/laolao-learning-stage.css'), 'utf8');
const NIGHT = readFileSync(path.join(ROOT, 'ui/injections/laolao-night.css'), 'utf8');
const MIN = 4.5;

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function lum([r, g, b]) {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function over(layer, alpha, base) {
  return base.map((c, i) => Math.round(layer[i] * alpha + c * (1 - alpha)));
}
function lastMatch(css, re) {
  const all = [...css.matchAll(re)];
  assert.ok(all.length, `未找到规则：${re}`);
  return all.at(-1);
}
function block(css, selectorRe) {
  return lastMatch(css, new RegExp(`(?:^|\\n)${selectorRe}\\s*\\{([^}]*)\\}`, 'g'))[1];
}
function prop(body, name) {
  const m = body.match(new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;!]+)`));
  assert.ok(m, `缺少 ${name}`);
  return m[1].trim();
}

function measure(stage, night) {
  const dayVars = block(stage, '\\.laolao-learning-notes');
  const daySearch = block(stage, '\\.laolao-learning-notes__search');
  const dayPh = rgb(prop(block(stage, '\\.laolao-learning-notes__search::placeholder'), 'color'));
  const dayBgs = [prop(daySearch, 'background'), prop(dayVars, '--notes-paper'), prop(dayVars, '--notes-card')].map(rgb);

  const N = 'html\\[data-pinkie-night\\]:not\\(#_n\\) ';
  const nightVars = block(night, `${N}\\.laolao-learning-notes`);
  const nightSearch = block(night, `${N}\\.laolao-learning-notes__search`);
  const nightPh = rgb(prop(block(night, `${N}\\.laolao-learning-notes__search::placeholder`), 'color'));
  const m = prop(nightSearch, 'background').match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  assert.ok(m, '夜间搜索框底应为 rgba 半透明叠色');
  const layer = [+m[1], +m[2], +m[3]];
  const nightBgs = ['--notes-paper', '--notes-card'].map((v) => over(layer, +m[4], rgb(prop(nightVars, v))));

  return {
    day: Math.min(...dayBgs.map((b) => ratio(dayPh, b))),
    night: Math.min(...nightBgs.map((b) => ratio(nightPh, b))),
  };
}

test('学习台笔记搜索框占位字日夜对比度 ≥4.5（按可能底色取最低）', () => {
  const r = measure(STAGE, NIGHT);
  assert.ok(r.day >= MIN, `日间 placeholder ${r.day.toFixed(2)} < ${MIN}`);
  assert.ok(r.night >= MIN, `夜间 placeholder ${r.night.toFixed(2)} < ${MIN}`);
});

test('反例：贴回旧配色 #979d91 / #7f7a70 必须判不达标', () => {
  const re = /(\.laolao-learning-notes__search::placeholder\s*\{\s*color:\s*)#[0-9a-f]{6}/gi;
  const r = measure(STAGE.replace(re, '$1#979d91'), NIGHT.replace(re, '$1#7f7a70'));
  assert.ok(r.day < MIN, `旧日间色应不达标，实得 ${r.day.toFixed(2)}`);
  assert.ok(r.night < MIN, `旧夜间色应不达标，实得 ${r.night.toFixed(2)}`);
});

const DESK = readFileSync(path.join(ROOT, 'ui/injections/laolao-study-desk.css'), 'utf8');
const INK = readFileSync(path.join(ROOT, 'ui/injections/laolao-study-desk-ink.css'), 'utf8');
const NOTES = readFileSync(path.join(ROOT, 'ui/injections/laolao-study-desk-notes.css'), 'utf8');
const NOTES_JS = readFileSync(path.join(ROOT, 'ui/injections/laolao-study-desk-notes.js'), 'utf8');
const WEBKIT_DEFAULT_PH = '#a9a9a9';
const LIVE_PH = /#pinkie-study-desk(?:\.pk-ink)? \.pinkie-desk-notes \.n-search input::placeholder\s*\{([^}]*)\}/g;

function vars(css, sel) {
  const m = css.match(new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `未找到令牌块：${sel}`);
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}
function resolve(v, t) {
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolve(t[m[1]], t) : v;
}
function measureLive(notesCss, inkCss) {
  const v1d = vars(DESK, '#pinkie-study-desk');
  const v1n = vars(DESK, '#pinkie-study-desk\\[data-theme="night"\\]');
  const pkd = vars(INK, '#pinkie-study-desk\\.pk-ink');
  const pkn = vars(INK, '#pinkie-study-desk\\.pk-ink\\[data-theme="night"\\]');
  const skins = {
    'v1 日': {t: v1d, rules: [notesCss]},
    'v1 夜': {t: {...v1d, ...v1n}, rules: [notesCss]},
    '手账 日': {t: {...v1d, ...pkd}, rules: [notesCss, inkCss]},
    '手账 夜': {t: {...v1d, ...v1n, ...pkd, ...pkn}, rules: [notesCss, inkCss]},
  };
  const out = {};
  for (const [name, {t, rules}] of Object.entries(skins)) {
    const hits = rules.flatMap((css) => [...css.matchAll(LIVE_PH)].map((m) => m[1]));
    const color = hits.length ? resolve(prop(hits.at(-1), 'color'), t) : WEBKIT_DEFAULT_PH;
    out[name] = Math.min(...['--paper', '--paper-2', '--card'].map((b) => ratio(rgb(color), rgb(resolve(t[b], t)))));
  }
  return out;
}

test('现行「搜笔记」框（.n-search input）占位字日夜、v1/手账都 ≥4.5', () => {
  assert.match(NOTES_JS, /el\('label', 'n-search'\), search = el\('input'\)/);
  assert.match(NOTES_JS, /search\.placeholder = '搜笔记'/);
  for (const [k, r] of Object.entries(measureLive(NOTES, INK))) assert.ok(r >= MIN, `${k} 搜笔记 placeholder ${r.toFixed(2)} < ${MIN}`);
  const body = [...NOTES.matchAll(LIVE_PH)].at(-1)[1];
  assert.ok(!body.includes('!important'));
});

test('反例：去掉 .n-search 占位字规则（落回 WebKit 默认 #a9a9a9）必须判日间不达标', () => {
  const r = measureLive(NOTES.replace(LIVE_PH, ''), INK.replace(LIVE_PH, ''));
  assert.ok(r['v1 日'] < MIN && r['手账 日'] < MIN, `默认色日间应不达标，实得 ${JSON.stringify(r)}`);
  assert.ok(r['v1 夜'] >= MIN && r['手账 夜'] >= MIN, '夜间默认色本来达标，量法不应误判');
});

test('夜间占位色仍是单行原地规则，不新增 !important', () => {
  const lines = NIGHT.split('\n').filter((l) => l.includes('.laolao-learning-notes__search::placeholder'));
  assert.equal(lines.length, 1);
  assert.equal((lines[0].match(/!important/g) || []).length, 1);
});
