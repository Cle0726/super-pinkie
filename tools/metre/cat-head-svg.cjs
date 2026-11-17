#!/usr/bin/env node
// 由像素黑猫的帧数据（ui/injections/laolao-metre-cat-frames.js 的 HEAD）生成模式菜单里的静态猫头
// ui/assets/laolao-mode-metre.svg。帧数据不改，这里只换一种画法；改了帧要重新跑：
//   node tools/metre/cat-head-svg.cjs
const fs = require('fs');
const path = require('path');
const cat = require('../../ui/injections/laolao-metre-cat-frames.js');
const rows = cat.HEAD;
const w = Math.max(...rows.map(r => r.length)), h = rows.length;
const pad = 1, size = Math.max(w, h) + pad * 2;
const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
const rects = [];
rows.forEach((row, y) => [...row].forEach((ch, x) => {
  if (ch === '.') return;
  rects.push(`<rect x="${x + ox}" y="${y + oy}" width="1" height="1" fill="${cat.PALETTE[ch]}"/>`);
}));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 4}" height="${size * 4}" shape-rendering="crispEdges">`
  + `<title>Metre</title>${rects.join('')}</svg>\n`;
const out = path.join(__dirname, '../../ui/assets/laolao-mode-metre.svg');
fs.writeFileSync(out, svg);
console.log(out, rects.length, 'pixels');
