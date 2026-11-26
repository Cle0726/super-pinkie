#!/usr/bin/env node
// PR 截图工作流（.github/workflows/pr-shots.yml）的最小截图脚本，也是它的验收脚本。
// 约定（所有截图脚本都照这个来）：
//   node <脚本> --out <目录>
//   往 <目录> 写 PNG，并往 <目录>/shots.jsonl 每张图追加一行 JSON：
//   {name, file, os, browser, width, height, bytes, sha256}
// 真浏览器起一个只含 Metre 日夜变量和按键外形的页面，日 / 夜各拍一张。不连网关、不碰用户会话。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {playwright} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});

const css = fs.readFileSync(fileURLToPath(new URL('../../ui/injections/laolao-metre-engine.css', import.meta.url)), 'utf8');
const VARS = `
  html[data-laolao-mode=metre]{--metre-bg:#F7F6F3;--metre-surface:#FFFFFF;--metre-text:#1B1A18;--metre-muted:#77736B;--metre-line:#E4E2DC;--metre-line-strong:#D3D0C8;--metre-hover:#EFEDE8;--metre-cobalt:#2F4BB0;--metre-sans:sans-serif;--metre-serif:serif;--metre-mono:monospace}
  html[data-laolao-mode=metre][data-pinkie-night]{--metre-bg:#151514;--metre-surface:#232321;--metre-text:#ECEAE4;--metre-muted:#918D84;--metre-line:#272725;--metre-line-strong:#393835;--metre-hover:#1F1F1D;--metre-cobalt:#8496E6}
  body{margin:0;padding:24px;background:var(--metre-bg);color:var(--metre-text);font-family:var(--metre-sans)}`;
const page = (night) => `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night' : ''}><head><style>${VARS}</style><style>${css}</style></head><body>
<p>PR 截图工作流 · 最小脚本</p>
<div class="agent-chat__composer-controls" style="display:flex;gap:4px"><button class="pk-eng-chip"><span class="pk-eng-chip__name">Metre</span></button></div>
</body></html>`;

const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';
const browser = await playwright()[engine].launch({headless: true});
const lines = [];
try {
  for (const [name, night] of [['minimal-day', false], ['minimal-night', true]]) {
    const width = 640, height = 240;
    const p = await browser.newPage({viewport: {width, height}});
    await p.setContent(page(night));
    const file = name + '.png';
    const buf = await p.screenshot({path: path.join(out, file)});
    await p.close();
    lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
  }
} finally {
  await browser.close();
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
