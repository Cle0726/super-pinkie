import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'ui/injections/laolao-run-status.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rules() {
  const out = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    for (const sel of splitSelectors(m[1])) out.push({sel: sel.replace(/\s+/g, ' ').trim(), decls});
  }
  return out;
}

function splitSelectors(text) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function prop(selector, name) {
  const hit = rules().filter((r) => r.sel === selector && r.decls[name]);
  assert.ok(hit.length, `${selector} { ${name} } not found in laolao-run-status.css`);
  const value = hit.at(-1).decls[name];
  const hex = value.match(/#[0-9a-f]{6}\b/i);
  assert.ok(hex, `${selector} { ${name}: ${value} } is not a #rrggbb colour`);
  return hex[0];
}

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Opaque stand-ins for the pearl glass the bar sits on (day bar and ask-tone
// gradient ends) and for the chat surfaces behind the pill, day and night.
const DAY_BAR = ['#ffffff', '#fffdfe', '#fff7fb', '#ffe6f0', '#fff0f6'];
const DAY_CHAT = ['#ffffff', '#fffdfe', '#fff7fb', '#fff0f6'];
const NIGHT_CHAT = ['#241b29', '#2a2030', '#140f17'];

function atLeast(fg, bgs, need, label) {
  for (const bg of bgs) {
    const k = ratio(fg, bg);
    assert.ok(k >= need, `${label}: ${fg} on ${bg} = ${k.toFixed(2)}, need ${need}`);
  }
}

test('R1 day .pk-run__meta reaches 4.5:1 on the bar glass, including the ask tone', () => {
  atLeast(prop('.pk-run__meta', 'color'), DAY_BAR, 4.5, '.pk-run__meta');
});

test('R2 white text on the day answer / skip buttons reaches 4.5:1, at rest and on hover', () => {
  for (const act of ['answer', 'skip']) {
    atLeast('#ffffff', [prop(`.pk-run__btn[data-act="${act}"]`, 'background')], 4.5, act);
    atLeast('#ffffff', [prop(`.pk-run__btn[data-act="${act}"]:hover`, 'background')], 4.5, `${act}:hover`);
  }
});

test('night meta and answer / skip keep their 4.5:1', () => {
  const night = 'html[data-pinkie-night]:not(#_n) ';
  const btn = night + '.pk-run__btn:is([data-act="answer"], [data-act="skip"])';
  atLeast(prop(btn, 'color'), [prop(btn, 'background')], 4.5, 'night answer / skip');
  const meta = rules().find((r) => r.sel === night + '.pk-run__meta');
  assert.ok(meta, 'night .pk-run__meta not found');
  atLeast(meta.decls.color.match(/#[0-9a-f]{6}/i)[0], NIGHT_CHAT, 4.5, 'night .pk-run__meta');
});

test('"New messages" pill border reaches 3:1 outside Metre, day and night', () => {
  atLeast(prop('html:not([data-laolao-mode="metre"]) .chat-new-messages:not(:hover)', 'border-color'), DAY_CHAT, 3, 'day .chat-new-messages border');
  atLeast(prop('html[data-pinkie-night]:not(#_n):not([data-laolao-mode="metre"]) .chat-new-messages:not(:hover)', 'border-color'), NIGHT_CHAT, 3, 'night .chat-new-messages border');
});
