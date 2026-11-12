// 设计底子：配色 + 字体搭配 → CSS 变量；品牌套装覆盖其中一部分。
import fs from 'node:fs';
import path from 'node:path';
import {SKILL_ROOT, homePaths} from './paths.mjs';

let cache = null;
export function design() {
  if (cache) return cache;
  const read = name => JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'design', name), 'utf8'));
  const fonts = read('fonts.json');
  cache = {palettes: read('palettes.json').palettes, fonts: fonts.fonts, pairs: fonts.pairs};
  return cache;
}

export function familyStack(ids, kind) {
  const {fonts} = design();
  const names = ids.map(id => fonts[id]?.family).filter(Boolean).map(f => `"${f}"`);
  const fallback = kind === 'serif'
    ? ['"Songti SC"', '"SimSun"', 'serif']
    : ['"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'];
  return [...names, ...fallback].join(', ');
}

export function loadBrand(name) {
  if (!name) return null;
  const file = path.join(homePaths().brands, `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`);
  if (!fs.existsSync(file)) throw new Error(`没有叫「${name}」的品牌套装（先用 pinkie-make brand set 建一个）`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 返回 {vars, fontIds, paletteId, pairId}
export function resolveTheme(template, {palette, pair, brand} = {}) {
  const d = design();
  const brandKit = typeof brand === 'string' ? loadBrand(brand) : brand;
  const paletteId = palette || brandKit?.palette || template.theme?.palette || 'mono';
  const pairId = pair || brandKit?.pair || template.theme?.pair || 'modern';
  const p = {...(d.palettes[paletteId] || d.palettes.mono)};
  if (!d.palettes[paletteId]) throw new Error(`没有叫「${paletteId}」的配色（pinkie-make themes 看全部）`);
  if (brandKit?.colors) Object.assign(p, brandKit.colors);
  const fp = d.pairs[pairId];
  if (!fp) throw new Error(`没有叫「${pairId}」的字体搭配（pinkie-make themes 看全部）`);
  const extra = template.fonts || {};
  const titleIds = extra.title || fp.title;
  const bodyIds = extra.body || fp.body;
  const accentIds = extra.accent || fp.accent;
  const kindOf = ids => (d.fonts[ids[ids.length - 1]]?.kind === 'serif' ? 'serif' : 'sans');
  const vars = {
    '--bg': p.bg, '--surface': p.surface, '--ink': p.ink, '--muted': p.muted,
    '--accent': p.accent, '--accent2': p.accent2, '--accent-ink': p.accentInk, '--line': p.line,
    '--font-title': familyStack(titleIds, kindOf(titleIds)),
    '--font-body': familyStack(bodyIds, kindOf(bodyIds)),
    '--font-accent': familyStack(accentIds, kindOf(accentIds)),
    '--w-title': String(extra.titleWeight || fp.titleWeight || 800),
    '--w-body': String(extra.bodyWeight || fp.bodyWeight || 400),
  };
  const fontIds = [...new Set([...titleIds, ...bodyIds, ...accentIds, ...(extra.also || [])])];
  return {vars, fontIds, paletteId, pairId, dark: !!p.dark, brand: brandKit};
}
