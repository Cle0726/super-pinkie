#!/usr/bin/env node
// B11 顶栏钱袋星星日间对比度（#96 7230843551 第 1 项）：给 b11-night-svg-audit.mjs 加上日间，量法、页面、report.json 格式完全相同。
// 退出码只看 glyph:stars（日夜都要 ≥ 3）；nib 等其他旧图标日间 < 3 不在本单范围，只打印。
// 用法同 minimal.mjs：node tools/pr-shots/b11-purse-stars-day.mjs --out <目录>（经 .github/workflows/pr-shots.yml 跑，本机不开浏览器）。
import fs from 'node:fs';
import path from 'node:path';

process.env.PINKIE_SVG_THEMES = process.env.PINKIE_SVG_THEMES || 'day,night';
await import('./b11-night-svg-audit.mjs');

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
let bad = 0, seen = 0, other = 0;
for (const r of report) {
  if (r.error) { bad++; console.log(`stars\t${r.name}\tERROR ${r.error}`); continue; }
  const stars = r.rows.filter((x) => x.key === 'glyph' && x.kind === 'stars' && x.best !== null);
  other += r.rows.filter((x) => !(x.key === 'glyph' && x.kind === 'stars') && x.best !== null && x.best < 3).length;
  if (!stars.length) continue;
  seen += stars.length;
  const low = stars.filter((x) => x.best < 3);
  bad += low.length;
  console.log(`stars\t${r.name}\t${Math.min(...stars.map((x) => x.best))}~${Math.max(...stars.map((x) => x.best))}(${stars.length})${low.length ? '\t< 3' : ''}`);
}
console.log(`stars: ${seen} 个星星图标，${bad} 个 < 3 或出错；其他图标 < 3 共 ${other} 个（不在本单范围）`);
process.exitCode = bad || !seen ? 1 : 0;
