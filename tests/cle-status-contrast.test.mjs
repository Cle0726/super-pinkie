import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'ui/injections/laolao-cle-stage.css'), 'utf8');

const DAY_SEL = 'html:not(#p1):not(#p2):not(#p3) {';
const NIGHT_SEL = 'html[data-pinkie-night]:not(#p1):not(#p2):not(#p3) {';
const FAIL_SEL = '.cle-status[data-kind="fail"]:not([data-kind="done"]):not([data-kind="stopped"]) b {';

// main@007aa7a8 before B11·T6: the reverse case these checks must reject.
const MAIN = `
html:not(#p1):not(#p2):not(#p3) {
  --cle-fg: rgba(29, 27, 43, .82);
  --cle-mute: rgba(29, 27, 43, .48);
  --cle-accent: #2f7bff;
  --cle-cmd: rgba(29, 27, 43, .78);
  --cle-sweep: #2f7bff;
  --cle-sweep-verb: rgba(29, 27, 43, .46);
  --cle-sweep-cmd: rgba(29, 27, 43, .5);
}
html[data-pinkie-night]:not(#p1):not(#p2):not(#p3) {
  --cle-fg: rgba(236, 232, 240, .86);
  --cle-mute: rgba(236, 232, 240, .46);
  --cle-accent: #62b4ff;
  --cle-cmd: rgba(214, 228, 255, .9);
  --cle-sweep: #ffffff;
  --cle-sweep-verb: rgba(236, 232, 240, .42);
  --cle-sweep-cmd: rgba(214, 228, 255, .48);
}
html:not(#p1):not(#p2):not(#p3) .pinkie-process[data-cle-run] .cle-status[data-kind="fail"]:not([data-kind="done"]):not([data-kind="stopped"]) b { --cle-sweep: #ff8589; --cle-sweep-base: #e5484d; }
`;

// Day: white, the card's pink wash and the deepest pink panel. Night: splash and the --bg / --panel stacks of laolao-night.css.
const BGS = {
  day: ['#ffffff', '#fff7fb', '#fdeef5'],
  night: ['#140f17', '#241b29', '#2a2030'],
};

const block = (css, sel) => {
  const at = css.indexOf(sel);
  assert.ok(at >= 0, `missing rule ${sel}`);
  return css.slice(at + sel.length, css.indexOf('}', at));
};
const decls = text => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));

const parse = value => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(rgba, `unsupported colour ${value}`);
  const [r, g, b, a = '1'] = rgba[1].split(',').map(s => s.trim());
  return [+r, +g, +b, +a];
};
const resolve = (vars, value) => {
  for (let i = 0; i < 5; i++) {
    const m = /^var\((--[\w-]+)\)$/.exec(value);
    if (!m) return parse(value);
    assert.ok(vars[m[1]], `undefined ${m[1]}`);
    value = vars[m[1]];
  }
  throw new Error(`var loop at ${value}`);
};

const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (fg, bg) => { const x = lum(fg), y = lum(bg); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = ([r, g, b, a], bg) => [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));
const bgRgb = h => parse(h).slice(0, 3);

// Premultiplied gradient interpolation composited over an opaque bg is linear in the composited colours, so sampling those is exact.
const worst = (theme, base, peak = base) => Math.min(...BGS[theme].map(bgRgb).flatMap(bg => {
  const a = over(base, bg), b = over(peak, bg);
  return Array.from({ length: 21 }, (_, k) => ratio(a.map((v, i) => v + (b[i] - v) * k / 20), bg));
}));

const measure = css => {
  const out = [];
  const fail = decls(block(css, FAIL_SEL));
  for (const [theme, sel] of [['day', DAY_SEL], ['night', NIGHT_SEL]]) {
    const vars = theme === 'day' ? decls(block(css, DAY_SEL)) : { ...decls(block(css, DAY_SEL)), ...decls(block(css, NIGHT_SEL)) };
    const c = name => resolve(vars, `var(${name})`);
    const failVars = { ...vars, ...fail };
    out.push(
      [`${theme} b`, worst(theme, c('--cle-fg'))],
      [`${theme} b done/stopped`, worst(theme, c('--cle-mute'))],
      [`${theme} b done (run)`, worst(theme, c('--cle-accent'))],
      [`${theme} b running sweep`, worst(theme, c('--cle-sweep-verb'), c('--cle-sweep'))],
      [`${theme} b fail sweep`, worst(theme, resolve(failVars, fail['--cle-sweep-base']), resolve(failVars, fail['--cle-sweep']))],
      [`${theme} span`, worst(theme, c('--cle-mute'))],
      [`${theme} span > em running sweep`, worst(theme, c('--cle-mute'), c('--cle-sweep'))],
      [`${theme} mono span`, worst(theme, c('--cle-cmd'))],
      [`${theme} mono em running sweep`, worst(theme, c('--cle-sweep-cmd'), c('--cle-sweep'))],
      [`${theme} i`, worst(theme, c('--cle-mute'))],
    );
  }
  return out;
};

const below = css => measure(css).filter(([, r]) => r < 4.5).map(([k, r]) => `${k} ${r.toFixed(2)}`);

test('cle-status title row text reaches 4.5:1 by day and night, sweep included', () => {
  assert.deepEqual(below(CSS), []);
});

test('reverse case: main@007aa7a8 colours are rejected', () => {
  const bad = below(MAIN);
  for (const k of ['day span', 'day i', 'day b running sweep', 'day b done (run)', 'day b fail sweep', 'day mono em running sweep', 'night span', 'night i', 'night b running sweep', 'night mono em running sweep']) {
    assert.ok(bad.some(line => line.startsWith(`${k} `)), `${k} should fail on main, got ${bad.join('; ')}`);
  }
});
