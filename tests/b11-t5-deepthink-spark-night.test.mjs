import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NIGHT = readFileSync(join(ROOT, 'ui/injections/laolao-night.css'), 'utf8');
const THEME = readFileSync(join(ROOT, 'ui/injections/laolao-theme.css'), 'utf8');

// main@e3c9910a before B11·T5: the night hover rule left .laolao-deep-think-btn out, so the spark sat on theme.css's rgba(255,255,255,.66).
const MAIN_HOVER = 'html[data-pinkie-night]:not(#_n) .agent-chat__input :is(.agent-chat__input-btn, .chat-settings-chip):hover { background: rgba(255, 255, 255, .07) !important; color: var(--accent) !important; }';

// Night page stacks the composer sits on: splash, --n-surface, the deepest --panel stack.
const BGS = ['#140f17', '#241b29', '#2a2030'];

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

// The hover rule for the deep-think button in a given stylesheet that sets a background.
const hoverRule = (css, prefix) => rules(css).find(r => r.sel.startsWith(prefix) && /:is\([^)]*\.laolao-deep-think-btn[^)]*\):hover$/.test(r.sel.replace(/\s+/g, ' ')) && decl(r.body, 'background'));

const accents = () => {
  const out = new Set();
  for (const r of rules(NIGHT)) if (r.sel.startsWith('html[data-pinkie-night]')) { const a = decl(r.body, '--accent'); if (a) out.add(a); }
  assert.ok(out.size >= 4, `expected per-mode night accents, got ${[...out]}`);
  return [...out];
};
const restColor = () => {
  const r = rules(NIGHT).find(x => x.sel.startsWith('html[data-pinkie-night]:not(#_n) .agent-chat__input :is(') && x.sel.includes('.laolao-deep-think-btn') && !x.sel.includes(':hover') && decl(x.body, 'color'));
  assert.ok(r, 'night rest colour rule for .laolao-deep-think-btn missing');
  return decl(r.body, 'color');
};

// Spark stroke is currentColor. With no night hover rule the theme.css light hover background wins and the colour stays the night rest colour.
const sparkHover = night => {
  const n = hoverRule(night, 'html[data-pinkie-night]:not(#_n) ');
  const t = hoverRule(THEME, 'html:not([data-laolao-plain-composer]) ');
  assert.ok(t, 'theme.css hover rule for .laolao-deep-think-btn missing');
  const bg = parse(decl((n || t).body, 'background'));
  const fgRaw = n ? decl(n.body, 'color') : restColor();
  const fgs = fgRaw === 'var(--accent)' ? accents() : [fgRaw];
  const out = [];
  for (const fg of fgs) for (const base of BGS) {
    const b = over(bg, parse(base));
    out.push([`${fg} on ${base}`, ratio(over(parse(fg), b), b)]);
  }
  return out;
};
const below = night => sparkHover(night).filter(([, r]) => r < 3).map(([k, r]) => `${k} ${r.toFixed(2)}`);

test('night composer spark button keeps >=3:1 on hover / open menu, every mode accent', () => {
  assert.deepEqual(below(NIGHT), []);
});

test('reverse case: main@e3c9910a night hover rule leaves the spark at ~1.15', () => {
  const line = NIGHT.split('\n').find(l => l.includes('.chat-settings-chip') && l.includes(':hover') && l.includes('.agent-chat__input :is('));
  assert.ok(line, 'night composer hover rule missing');
  const bad = sparkHover(NIGHT.replace(line, MAIN_HOVER));
  assert.ok(bad.every(([, r]) => r < 1.3), `main should fail everywhere, got ${bad.map(([k, r]) => `${k} ${r.toFixed(2)}`).join('; ')}`);
});
