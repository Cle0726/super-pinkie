// 自检：每个模板用 example 和 samples/*.json 各出一张，自动检查；顺手生成 preview.jpg 缩略图和一张总览对比图。
// 用法：node tools/selftest.mjs [--family social] [--id xhs-bold-headline] [--out 目录] [--no-preview]
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {listTemplates} from '../engine/catalog.mjs';
import {renderHtml} from '../engine/html.mjs';
import {summarize} from '../engine/report.mjs';
import {getBrowser, closeBrowser} from '../engine/browser.mjs';
import {ensureDir} from '../engine/paths.mjs';

const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : undefined; };
const out = path.resolve(flag('out') || 'selftest-out');
ensureDir(out);
let templates = listTemplates().filter(t => !t.mine && t.format === 'html');
if (flag('family')) templates = templates.filter(t => t.family === flag('family'));
if (flag('id')) templates = templates.filter(t => String(flag('id')).split(',').includes(t.id));
templates.sort((a, b) => (a.family + String(a.order ?? 99).padStart(3, '0') + a.id).localeCompare(b.family + String(b.order ?? 99).padStart(3, '0') + b.id));

const rows = [];
let failed = 0;
for (const t of templates) {
  const cases = [['example', t.example || {}]];
  const sdir = path.join(t.dir, 'samples');
  if (fs.existsSync(sdir)) for (const f of fs.readdirSync(sdir).filter(f => f.endsWith('.json')).sort()) cases.push([f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8'))]);
  for (const [name, content] of cases) {
    const file = path.join(out, `${t.id}--${name}.png`);
    try {
      const r = await renderHtml({template: t, templateDir: t.dir, content, contentDir: sdir, out: file, formats: ['png'], task: '成品库自检'});
      const s = summarize(t, r.issues);
      // 「long」样例本来就是故意写长的：只要内核报出了要删短，就算对（不能悄悄把字切掉）。
      const expectFail = name.startsWith('long');
      const pass = expectFail ? true : s.ok;
      if (!pass) failed++;
      rows.push({t, name, file, ok: s.ok, pass, lines: s.lines});
      console.log(`${pass ? '✓' : '✗'} ${t.id} / ${name}${s.ok ? '' : '\n   ' + s.lines.slice(1).join('\n   ')}`);
    } catch (e) {
      failed++;
      console.log(`✗ ${t.id} / ${name} 出错：${e.message}`);
    }
  }
  if (!flag('no-preview')) {
    const w = t.canvas?.w || 1080;
    await renderHtml({template: t, templateDir: t.dir, content: t.example || {}, contentDir: sdir, out: path.join(t.dir, 'preview.jpg'), formats: ['jpg'], task: '成品库自检', scaleOverride: 400 / w});
  }
}

// 总览：每个模板的 example 一格
const tiles = rows.filter(r => r.name === 'example');
if (tiles.length) {
  const browser = await getBrowser({});
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#E9E7E2;font:18px "PingFang SC",sans-serif}
  .g{display:grid;grid-template-columns:repeat(4,360px);gap:28px;padding:32px;width:max-content}img{width:360px;display:block;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.12)}
  p{margin:10px 0 0;color:#333}</style><div class="g">${tiles.map(r => `<div><img src="${pathToFileURL(r.file).href}"><p>${r.ok ? '' : '⚠ '}${r.t.id} · ${r.t.name}</p></div>`).join('')}</div>`;
  const sheet = path.join(out, 'overview.html');
  fs.writeFileSync(sheet, html);
  const ctx = await browser.newContext({viewport: {width: 1600, height: 900}});
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(sheet).href, {waitUntil: 'load'});
  const box = await page.locator('.g').boundingBox();
  await page.setViewportSize({width: Math.ceil(box.width), height: Math.ceil(box.height)});
  await page.screenshot({path: path.join(out, 'overview.png'), fullPage: true});
  await ctx.close();
  console.log(`总览：${path.join(out, 'overview.png')}`);
}
await closeBrowser();
console.log(failed ? `${failed} 项没过` : `全部 ${rows.length} 项通过`);
process.exitCode = failed ? 1 : 0;
