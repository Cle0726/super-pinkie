import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS = readFileSync(join(ROOT, 'ui/injections/laolao-deep-think.js'), 'utf8');
const NIGHT = readFileSync(join(ROOT, 'ui/injections/laolao-night.css'), 'utf8');

const NIGHT_SCOPE = ':is(html[data-theme-mode="dark"],html[data-pinkie-night])';
const BTN_STATES = ':is(.laolao-deep-think-btn:hover,.laolao-deep-think-btn[aria-expanded="true"],.laolao-deep-think-btn.is-selected)';

// Night page stacks the composer sits on: splash, --n-surface, the deepest --panel stack.
const BGS = ['#140f17', '#241b29', '#2a2030'];

const styleText = js => {
  const start = js.indexOf('style.id = "laolao-deep-think-style";');
  assert.ok(start > 0, 'deep-think style block missing');
  const open = js.indexOf('style.textContent = `', start) + 'style.textContent = `'.length;
  const close = js.indexOf('`;', open);
  const css = js.slice(open, close);
  assert.ok(!css.includes('${'), 'deep-think style block is no longer a plain string');
  return css;
};

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
const over = ([r, g, b, a], bg) => [r, g, b].map((v, i) => v * a + bg[i] * (1 - a)).concat(1);

const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;!]+?)\\s*(?:!important)?\\s*(?:;|$)`).exec(body);
  return m ? m[1].trim() : null;
};

// Spark stroke is currentColor; inside the composer night.css pins it to the night rest colour.
const nightRestColor = () => {
  const r = rules(NIGHT).find(x => x.sel.startsWith('html[data-pinkie-night]:not(#_n) .agent-chat__input :is(') && x.sel.includes('.laolao-deep-think-btn') && !x.sel.includes(':hover') && decl(x.body, 'color'));
  assert.ok(r, 'night rest colour rule for .laolao-deep-think-btn missing');
  return decl(r.body, 'color');
};

// Hover / open-menu / selected fill and border that win when theme.css's composer !important rules do not apply
// (html[data-laolao-plain-composer], or the button outside .agent-chat__input).
const activeLook = css => {
  const all = rules(css);
  const light = all.find(r => r.sel.replace(/\s+/g, '') === '.laolao-deep-think-btn:hover,.laolao-deep-think-btn[aria-expanded="true"],.laolao-deep-think-btn.is-selected');
  assert.ok(light, 'base active rule for .laolao-deep-think-btn missing');
  const night = all.find(r => r.sel === `${NIGHT_SCOPE} ${BTN_STATES}`);
  const pick = prop => (night && decl(night.body, prop)) || decl(light.body, prop);
  return { night, bg: pick('background'), border: pick('border-color') };
};

const readings = css => {
  const { bg, border } = activeLook(css);
  const fg = parse(nightRestColor());
  const out = [];
  for (const base of BGS) {
    const page = parse(base);
    const fill = over(parse(bg), page);
    const edge = over(parse(border), page);
    out.push([`spark on ${base}`, ratio(over(fg, fill), fill)]);
    out.push([`border vs ${base}`, Math.min(ratio(edge, page), ratio(edge, fill))]);
  }
  return out;
};
const below = css => readings(css).filter(([, r]) => r < 3).map(([k, r]) => `${k} ${r.toFixed(2)}`);

test('night deep-think button keeps spark and border >=3:1 on hover / open menu / selected', () => {
  assert.deepEqual(below(styleText(JS)), []);
});

test('night override is merged into the existing night rule line, scoped to night, without !important', () => {
  const lines = JS.split('\n');
  const idx = lines.findIndex(l => l.includes(`${NIGHT_SCOPE} ${BTN_STATES}{`));
  assert.ok(idx >= 0, 'night active override missing');
  assert.ok(lines[idx].startsWith(`${NIGHT_SCOPE} :is(.laolao-deep-think-menu__head`), 'override must sit on the night menu rule line');
  const { night } = activeLook(styleText(JS));
  assert.ok(!night.body.includes('!important'));
});

test('reverse case: without the night override the light .56 fill leaves spark and border under 3:1', () => {
  const css = styleText(JS);
  const { night } = activeLook(css);
  const stripped = css.replace(`${night.sel}{${night.body}}`, '');
  assert.notEqual(stripped, css);
  const bad = readings(stripped);
  assert.ok(bad.every(([, r]) => r < 3), `main should fail everywhere, got ${bad.map(([k, r]) => `${k} ${r.toFixed(2)}`).join('; ')}`);
  assert.ok(bad.filter(([k]) => k.startsWith('spark')).every(([, r]) => r < 2));
});
