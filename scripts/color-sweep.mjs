#!/usr/bin/env node
// Off-brand audit for the ported modules. Highlights every pink / rose / magenta /
// purple / plum colour literal per file (per the sweep spec: hue 280–360 or 0–15
// with saturation > 25%; amber 15–25° is never off-brand).
//   node scripts/color-sweep.mjs             # summary + off-brand literals
//   node scripts/color-sweep.mjs --all       # every literal
//   node scripts/color-sweep.mjs --json      # machine readable
//   node scripts/color-sweep.mjs --counts    # "file total offbrand" per line
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'services/cle-studio/static/legacy');
const EXCLUDE = /(vendor|laolao-katex|^laolao-companion\.(js|css)$|^laolao-cle-space\.js$|^laolao-cle-signature\.js$)/;
const KEEP_HUES = [[15, 25]];

export function hueSat(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return {h, s, l};
}

export function isOffBrand(h, s) {
  for (const [a, b] of KEEP_HUES) if (h >= a && h <= b) return false;
  return ((h >= 280 && h <= 360) || (h >= 0 && h <= 15)) && s > 0.25;
}

const RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+%?[\s,]+[\d.]+%?[\s,]+[\d.]+%?[^)]*\)|hsla?\([^)]*\)/g;

function parse(tok) {
  let m;
  if (tok[0] === '#') {
    let hx = tok.slice(1);
    if (hx.length === 3 || hx.length === 4) hx = hx.split('').map(c => c + c).join('');
    if (hx.length !== 6 && hx.length !== 8) return null;
    return hueSat(parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16));
  }
  if ((m = tok.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i))) return hueSat(+m[1], +m[2], +m[3]);
  if ((m = tok.match(/^hsla?\(\s*([\d.-]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i))) {
    return {h: ((+m[1] % 360) + 360) % 360, s: +m[2] / 100, l: +m[3] / 100};
  }
  return null;
}

export function scan(file) {
  const text = fs.readFileSync(file, 'utf8');
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const tok of line.match(RE) || []) {
      const hs = parse(tok);
      if (!hs) continue;
      hits.push({line: i + 1, token: tok, h: Math.round(hs.h), s: Math.round(hs.s * 100), l: Math.round(hs.l * 100), off: isOffBrand(hs.h, hs.s), text: line.trim().slice(0, 160)});
    }
  });
  return {path: file, text, hits};
}

export function files() {
  return fs.readdirSync(dir).filter(f => /\.(js|css)$/.test(f) && !EXCLUDE.test(f)).sort().map(f => path.join(dir, f));
}

export function report() {
  return files().map(f => {
    const r = scan(f);
    const off = r.hits.filter(h => h.off);
    return {file: path.basename(f), total: r.hits.length, offBrand: off.length, hits: off};
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const all = process.argv.includes('--all');
  const lines = report();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(lines, null, 2)); process.exit(0); }
  if (process.argv.includes('--counts')) {
    for (const r of lines) console.log(`${r.file} ${r.total} ${r.offBrand}`);
    process.exit(0);
  }
  for (const r of lines) {
    const show = all ? [...r.hits, ...scan(path.join(dir, r.file)).hits.filter(h => !h.off)] : r.hits;
    if (!show.length) continue;
    console.log(`\n${r.file}  (${r.offBrand} off-brand / ${r.total} colour literals)`);
    for (const h of show) console.log(`  ${String(h.line).padStart(5)}  ${h.token.padEnd(26)} h${String(h.h).padStart(3)} s${String(h.s).padStart(3)} l${String(h.l).padStart(3)}${h.off ? '' : '  (kept band)'}`);
  }
  const tb = lines.reduce((a, r) => a + r.offBrand, 0);
  const tt = lines.reduce((a, r) => a + r.total, 0);
  console.log(`\nTOTAL off-brand: ${tb} / ${tt} colour literals across ${lines.length} files`);
}
