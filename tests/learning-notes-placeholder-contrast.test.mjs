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

test('夜间占位色仍是单行原地规则，不新增 !important', () => {
  const lines = NIGHT.split('\n').filter((l) => l.includes('.laolao-learning-notes__search::placeholder'));
  assert.equal(lines.length, 1);
  assert.equal((lines[0].match(/!important/g) || []).length, 1);
});
