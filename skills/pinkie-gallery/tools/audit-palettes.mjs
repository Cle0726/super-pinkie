// 配色审计：正文、次要字、强调色上的字，对比度都要够；--fix 时自动把不够的次要字调深 / 调浅。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'design', 'palettes.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const c = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const fix = process.argv.includes('--fix');
let bad = 0;
for (const [id, p] of Object.entries(data.palettes)) {
  const checks = [['ink/bg', p.ink, p.bg, 7], ['ink/surface', p.ink, p.surface, 4.5], ['muted/bg', p.muted, p.bg, 4.6], ['muted/surface', p.muted, p.surface, 4.6], ['accentInk/accent', p.accentInk, p.accent, 4.5]];
  for (const [name, fg, bg, need] of checks) {
    let r = ratio(fg, bg);
    if (r >= need) continue;
    if (fix && name.startsWith('muted')) {
      let t = 0; let m = p.muted;
      while (ratio(m, p.bg) < 4.6 || ratio(m, p.surface) < 4.6) { t += 0.04; m = mix(p.muted, p.ink, t); if (t > 1) break; }
      p.muted = m; r = ratio(m, bg);
      console.log(`${id} muted → ${m}（${r.toFixed(2)}）`);
      continue;
    }
    if (fix && name === 'accentInk/accent') {
      if (!p.dark && ratio(p.ink, p.accent) >= 4.5 && ratio(mix(p.accent, p.ink, 0.16), '#FFFFFF') < 4.5) { p.accentInk = p.ink; console.log(`${id} accentInk → ink ${p.ink}（${ratio(p.ink, p.accent).toFixed(2)}）`); continue; }
      let t = 0, a = p.accent;
      while (ratio(p.accentInk, a) < 4.5 && t < 0.6) { t += 0.02; a = mix(p.accent, p.dark ? '#FFFFFF' : '#000000', t); }
      console.log(`${id} accent ${p.accent} → ${a}（${ratio(p.accentInk, a).toFixed(2)}）`); p.accent = a; continue;
    }
    bad++;
    console.log(`${id} ${name} = ${r.toFixed(2)}（要 ${need}）`);
  }
}
if (fix) fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(bad ? `还有 ${bad} 处不够` : '全部够');
