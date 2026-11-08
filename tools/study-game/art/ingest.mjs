#!/usr/bin/env node
// 入库：art/study-game/raw/<槽位>.png（review.json 里 verdict=pass 的）→ 裁透明边 → 缩放 → cwebp →
// ui/assets/study-game/<槽位>.webp；形态立绘自动裁出 icon；写 manifest.json（槽位 → 文件、宽高、字节、来源、日期）和 PROVENANCE.json。
// 用法：node ingest.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const ART = process.env.STUDY_GAME_ART || '/Users/Admin/release-superpinkie/art/study-game';
const OUT = path.join(repo, 'ui/assets/study-game');
const force = process.argv.includes('--force');
const MAGICK = ['/Users/Admin/.homebrew/bin/magick', '/opt/homebrew/bin/magick'].find(p => fs.existsSync(p)) || 'magick';
const review = JSON.parse(fs.readFileSync(path.join(ART, 'review.json'), 'utf8'));
const slots = JSON.parse(fs.readFileSync(path.join(here, 'art-slots.json'), 'utf8')).slots;
const manifestFile = path.join(OUT, 'manifest.json');
const provFile = path.join(OUT, 'PROVENANCE.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {version: 1, slots: {}};
const prov = fs.existsSync(provFile) ? JSON.parse(fs.readFileSync(provFile, 'utf8')) : {note: '碧琪是 Pinkie Pie（孩之宝）的同人二创；本目录图片均由用户的 GPT 会员生成（Codex image_gen / chatgpt.com 网页版），提示词见 tools/study-game/art/art-slots.json 与 PROGRESS-B。', items: {}};

// 槽位 → 规格：square = 裁边后补成正方形透明画布；max = 长边上限；q = webp 质量
function specFor(slot) {
  if (/\/portrait$/.test(slot) && slot.startsWith('form/')) return {square: true, max: 1024, q: 88, budget: 300};
  if (slot.startsWith('monster/') || slot === 'boss/babel/portrait') return {square: true, max: slot.startsWith('boss') ? 512 : 1024, q: 88, budget: 300};
  if (slot.startsWith('sticker/')) return {square: true, max: 512, q: 88, budget: 200};
  if (/\/ult$/.test(slot)) return {max: 1536, q: 82, budget: 600, opaque: true};
  if (slot.startsWith('boss/babel/')) return {trim: true, max: 1536, q: 86, budget: 600};
  if (slot.startsWith('world/pretco-b/')) return {max: 2048, q: 86, budget: 600};
  return {max: 2560, q: 82, budget: 600, opaque: true};
}

function run(cmd, args) { return execFileSync(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']}).toString(); }
function dims(file) {
  const [w, h] = run(MAGICK, ['identify', '-format', '%w %h', file]).trim().split(' ').map(Number);
  return {w, h};
}

let done = 0;
const tmp = fs.mkdtempSync(path.join(ART, '.ingest-'));
try {
  for (const s of slots) {
    const r = review[s.slot];
    const raw = path.join(ART, 'raw', `${s.slot}.png`);
    if (r?.verdict !== 'pass' || !fs.existsSync(raw)) continue;
    const dest = path.join(OUT, `${s.slot}.webp`);
    if (!force && fs.existsSync(dest) && manifest.slots[s.slot]?.rawMtime === Math.floor(fs.statSync(raw).mtimeMs)) continue;
    const spec = specFor(s.slot);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    const png = path.join(tmp, 'a.png');
    const args = [raw];
    if (spec.square || spec.trim) args.push('-trim', '+repage');
    if (spec.square) args.push('-background', 'none', '-gravity', 'center', '-extent', '%[fx:max(w,h)*1.04]x%[fx:max(w,h)*1.04]');
    args.push('-resize', `${spec.max}x${spec.max}>`, png);
    run(MAGICK, args);
    let q = spec.q;
    for (;;) {
      run('cwebp', ['-quiet', '-q', String(q), ...(spec.opaque ? [] : ['-alpha_q', '100']), png, '-o', dest]);
      if (fs.statSync(dest).size <= spec.budget * 1024 || q <= 60) break;
      q -= 6;
    }
    const d = dims(dest);
    manifest.slots[s.slot] = {file: `${s.slot}.webp`, w: d.w, h: d.h, bytes: fs.statSync(dest).size, source: r.source || 'chatgpt-web', date: r.at || new Date().toISOString().slice(0, 10), rawMtime: Math.floor(fs.statSync(raw).mtimeMs)};
    prov.items[s.slot] = {source: r.source || 'chatgpt-web', prompt: `art-slots.json · ${s.template}`, reviewed: r.at, note: r.note || ''};
    // 形态图标：从立绘上部裁正方形（头部），256²
    if (/^form\/[^/]+\/portrait$/.test(s.slot)) {
      const icon = s.slot.replace(/portrait$/, 'icon');
      const idest = path.join(OUT, `${icon}.webp`);
      run(MAGICK, [png, '-gravity', 'north', '-crop', '62%x62%+0+2%', '+repage', '-resize', '256x256', path.join(tmp, 'i.png')]);
      run('cwebp', ['-quiet', '-q', '86', '-alpha_q', '100', path.join(tmp, 'i.png'), '-o', idest]);
      manifest.slots[icon] = {file: `${icon}.webp`, w: 256, h: 256, bytes: fs.statSync(idest).size, source: 'derived', from: s.slot, date: new Date().toISOString().slice(0, 10)};
    }
    done += 1;
    console.log(`${s.slot} → ${d.w}x${d.h} ${Math.round(fs.statSync(dest).size / 1024)}KB q${q}`);
  }
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
manifest.updatedAt = new Date().toISOString();
manifest.slots = Object.fromEntries(Object.entries(manifest.slots).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n');
fs.writeFileSync(provFile, JSON.stringify(prov, null, 1) + '\n');
console.log(`ingested ${done}; manifest has ${Object.keys(manifest.slots).length} slots`);
