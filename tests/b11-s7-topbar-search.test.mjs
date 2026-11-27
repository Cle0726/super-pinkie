import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEME = readFileSync(join(ROOT, 'ui/injections/laolao-theme.css'), 'utf8');
const NIGHT = readFileSync(join(ROOT, 'ui/injections/laolao-night.css'), 'utf8');

// The control UI's own .topbar-search border (shown only at width<=1100px): color-mix(in srgb, var(--border) 88%, transparent).
const NATIVE_MIX = 0.88;

// Topbar surfaces the button sits on: day theme.css:217-231/:4968, night night.css:116 over the night page stack.
const DAY_BGS = ['#ffffff', '#fffcfd', '#fdf3f7', '#fbeef4', '#f7e6ee'];
const NIGHT_BGS = ['#000000', '#140f17', '#1a1320', '#241b29', '#2a2030', '#30263a'];

const parse = value => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(rgba, `unsupported colour ${value}`);
  const [r, g, b, a = '1'] = rgba[1].split(',').map(s => s.trim());
  return [+r, +g, +b, +a];
};
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (fg, bg) => { const x = lum(fg), y = lum(bg); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = ([r, g, b, a], bg) => [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));

const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;!]+?)\\s*(?:!important)?\\s*(?:;|$)`).exec(body);
  return m ? m[1].trim() : null;
};
const values = (css, sel, prop) => rules(css).filter(r => sel(r.sel)).map(r => decl(r.body, prop)).filter(Boolean);

const dayMuted = () => {
  const out = values(THEME, s => /^html\[data-(theme|laolao-mode="[a-z]+")\]$/.test(s), '--muted');
  assert.ok(out.length >= 6, `expected root + per-mode day --muted, got ${out}`);
  return out;
};
const nightMuted = () => {
  assert.ok(values(NIGHT, s => s.startsWith('html[data-pinkie-night]'), '--muted').every(v => v === 'var(--n-muted)'), 'night --muted should resolve to --n-muted');
  const out = values(NIGHT, s => s.startsWith('html[data-pinkie-night]'), '--n-muted');
  assert.ok(out.length, 'night --n-muted missing');
  return out;
};
const resolve = (css, v) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v || '');
  if (!m) return v;
  const found = rules(css).map(r => decl(r.body, m[1])).find(Boolean);
  assert.ok(found, `${m[1]} not defined`);
  return resolve(css, found);
};
const border = (css, prefix) => resolve(css, values(css, s => s.startsWith(prefix), '--border')[0]);

const topbarSearchBorder = css => {
  const r = rules(css).find(x => /(^|\s)\.topbar-search$/.test(x.sel) && decl(x.body, 'border-color'));
  return r ? decl(r.body, 'border-color') : null;
};

// Border colour against the topbar surface, for every mode, day and night.
const readings = css => {
  const rule = topbarSearchBorder(css);
  const out = [];
  const add = (theme, fgs, bgs) => { for (const fg of fgs) for (const bg of bgs) { const b = parse(bg); out.push([`${theme} ${fg} on ${bg}`, ratio(over(fg, b), b)]); } };
  if (rule === 'var(--muted)') {
    add('day', dayMuted().map(parse), DAY_BGS);
    add('night', nightMuted().map(parse), NIGHT_BGS);
  } else {
    assert.equal(rule, null, `unexpected .topbar-search border-color ${rule}`);
    const native = v => { const c = parse(v); return [c[0], c[1], c[2], c[3] * NATIVE_MIX]; };
    add('day', [native(border(THEME, 'html[data-theme]'))], DAY_BGS);
    add('night', [native(border(NIGHT, 'html[data-pinkie-night]'))], NIGHT_BGS);
  }
  return out;
};

test('820px topbar search button border keeps >=3:1 on the topbar, day and night, every mode', () => {
  assert.equal(topbarSearchBorder(THEME), 'var(--muted)');
  assert.deepEqual(readings(THEME).filter(([, r]) => r < 3).map(([k, r]) => `${k} ${r.toFixed(2)}`), []);
});

test('reverse case: without the rule the native --border 88% mix sits at ~1.2', () => {
  const line = THEME.split('\n').find(l => /\.topbar-search\s*\{/.test(l));
  assert.ok(line, 'theme.css .topbar-search rule missing');
  const bad = readings(THEME.replace(line, ''));
  assert.ok(bad.length && bad.every(([, r]) => r < 1.3), `native border should fail everywhere, got ${bad.map(([k, r]) => `${k} ${r.toFixed(2)}`).join('; ')}`);
});
