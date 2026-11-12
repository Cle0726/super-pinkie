#!/usr/bin/env node
// 碧琪成品库命令行。用法见 SKILL.md，或 node pinkie-make.mjs help。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {homePaths, ensureDir, SKILL_ROOT} from '../engine/paths.mjs';
import {listTemplates, findTemplate, search, FAMILY_LABELS} from '../engine/catalog.mjs';
import {design} from '../engine/theme.mjs';
import {summarize, slotLabel} from '../engine/report.mjs';
import {closeBrowser, getBrowser} from '../engine/browser.mjs';
import {ensurePackages} from '../engine/install.mjs';

const HELP = `碧琪成品库 · pinkie-make
  search "<一句话需求>" [--family 家族] [--limit 8]   找模板（按场景、情绪排好序）
  show <模板id>                                     看这个模板有哪些位置、每个位置放多少字
  example <模板id> [--out content.json]              写一份填好的例子，照着改内容
  make <模板id> <content.json> [--out 文件] [--palette 配色] [--pair 字体] [--brand 品牌] [--format png,pdf] [--task 活]
                                                     出成品并自动检查
  gallery <id,id,…|auto> <content.json> [--palettes a,b,c] [--out 对比图.png]
                                                     同一份内容套几个模板 / 配色，并排出一张让先生挑
  themes                                            看全部配色和字体搭配
  brand set --name 名字 [--palette] [--pair] [--logo 图] [--slogan] [--contact] | brand show 名字 | brand list
  list [--family 家族]                               列出全部模板
  doctor                                            把出图要用的东西一次装好（自动下载，记进下载账本）`;

function parse(argv) {
  const flags = {}, args = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[k] = true; else { flags[k] = next; i++; }
    } else args.push(t);
  }
  return {flags, args};
}

function readContent(file) {
  if (!file) throw new Error('要给一个 content.json（先用 example 命令写一份例子，再照着改）');
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`找不到 ${resolved}`);
  try { return {content: JSON.parse(fs.readFileSync(resolved, 'utf8')), dir: path.dirname(resolved)}; }
  catch (e) { throw new Error(`${resolved} 不是合法的 JSON：${e.message}`); }
}

function line(t) {
  const size = t.canvas ? `${t.canvas.w}×${t.canvas.h}` : '';
  return `${t.id}  ${t.name}  [${FAMILY_LABELS[t.family] || t.family}${size ? ' · ' + size : ''}]${t.summary ? '  ' + t.summary : ''}${t.mine ? '  （先生自己的）' : ''}`;
}

function defaultOut(t, contentDir) {
  const dir = contentDir || process.cwd();
  return path.join(dir, `${t.id}.png`);
}

async function make(t, content, contentDir, flags) {
  const formats = String(flags.format || (t.outputs || ['png']).join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const out = path.resolve(flags.out || defaultOut(t, contentDir));
  const themeOpts = {palette: flags.palette, pair: flags.pair, brand: flags.brand};
  if (t.format !== 'html') throw new Error(`${t.id} 是 ${t.format} 格式，这一版只会做 HTML 类模板`);
  const {renderHtml} = await import('../engine/html.mjs');
  return renderHtml({template: t, templateDir: t.dir, content, contentDir, themeOpts, out, formats, task: flags.task || t.name});
}

async function cmdMake(args, flags) {
  const t = findTemplate(args[0]);
  const {content, dir} = readContent(args[1]);
  const result = await make(t, content, dir, flags);
  const s = summarize(t, result.issues);
  console.log(`出好了：${result.files.join('、')}`);
  console.log(`配色：${design().palettes[result.theme.paletteId].label}（${result.theme.paletteId}） · 字体：${design().pairs[result.theme.pairId].label}（${result.theme.pairId}）${result.theme.brand ? ` · 品牌：${result.theme.brand.name}` : ''}`);
  const shrunk = Object.entries(result.fitted || {}).filter(([, v]) => v.to < v.from);
  if (shrunk.length) console.log(`自动缩字：${shrunk.map(([k, v]) => `${slotLabel(t, k)} ${v.from}→${v.to}px`).join('，')}`);
  if (result.emptyImages) console.log(`照片位空着 ${result.emptyImages} 处，用同色系图形顶上了（有先生的照片或生成的图就填进 content）。`);
  if (process.env.PINKIE_DEBUG) console.log(JSON.stringify(result.issues, null, 1));
  s.lines.forEach(l => console.log(l));
  console.log('下一步：用 read 打开出好的图亲眼看一遍，再交给先生。');
  return s.ok ? 0 : 2;
}

function cmdShow(args) {
  const t = findTemplate(args[0]);
  console.log(line(t));
  if (t.notFor) console.log(`不适合：${t.notFor}`);
  console.log(`推荐配色：${(t.theme?.palettes || [t.theme?.palette]).filter(Boolean).join('、')}；默认字体：${t.theme?.pair || 'modern'}`);
  console.log('位置：');
  for (const [k, s] of Object.entries(t.slots || {})) {
    const limit = s.type === 'list' ? `最多 ${s.maxItems || '?'} 条` : s.max ? `≤${s.max} 字` : '';
    console.log(`  ${k}（${s.label || k}，${s.type}${s.required ? '，必填' : ''}${limit ? '，' + limit : ''}）${s.hint ? '：' + s.hint : ''}`);
    if (s.type === 'list') for (const [f, fs_] of Object.entries(s.item || {})) console.log(`      .${f}（${fs_.label || f}${fs_.max ? `，≤${fs_.max} 字` : ''}${fs_.type === 'image' ? '，图片路径' : ''}）`);
  }
  console.log('写法：文字里用 **词** 标出要强调的词，用 \\n 换行；图片写本机的文件路径。');
  console.log(`例子：node "${path.join(SKILL_ROOT, 'bin', 'pinkie-make.mjs')}" example ${t.id} --out content.json`);
  return 0;
}

function cmdExample(args, flags) {
  const t = findTemplate(args[0]);
  const text = JSON.stringify(t.example || {}, null, 2) + '\n';
  if (flags.out) { fs.writeFileSync(path.resolve(flags.out), text, 'utf8'); console.log(`写好了：${path.resolve(flags.out)}（照着改内容，再 make）`); }
  else process.stdout.write(text);
  return 0;
}

function cmdSearch(args, flags) {
  const q = args.join(' ');
  const hits = search(q, {family: flags.family, kind: flags.kind, limit: Number(flags.limit || 8)});
  if (flags.json) { console.log(JSON.stringify(hits.map(({dir, ...t}) => ({...t, preview: t.preview ? path.join(dir, t.preview) : ''})), null, 2)); return 0; }
  hits.forEach((t, i) => console.log(`${i + 1}. ${line(t)}${t.preview ? `\n   预览：${path.join(t.dir, t.preview)}` : ''}`));
  console.log('挑一个 → show <id> 看位置 → example <id> --out content.json → 改内容 → make。拿不准就用 gallery 并排出几张让先生挑。');
  return 0;
}

function cmdThemes() {
  const d = design();
  console.log('配色（--palette）：');
  for (const [id, p] of Object.entries(d.palettes)) console.log(`  ${id}  ${p.label}${p.dark ? '（深色）' : ''}  ${p.mood.join('/')} · ${p.scene.join('/')}`);
  console.log('字体搭配（--pair）：');
  for (const [id, p] of Object.entries(d.pairs)) console.log(`  ${id}  ${p.label}  ${p.mood.join('/')}`);
  return 0;
}

function brandFile(name) {
  return path.join(ensureDir(homePaths().brands), `${String(name).replace(/[\\/:*?"<>|]/g, '_')}.json`);
}

function cmdBrand(args, flags) {
  const sub = args[0];
  if (sub === 'list') {
    const dir = homePaths().brands;
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)) : [];
    console.log(names.length ? names.join('\n') : '还没有品牌套装。');
    return 0;
  }
  if (sub === 'show') { console.log(fs.readFileSync(brandFile(args[1]), 'utf8')); return 0; }
  if (sub === 'set') {
    if (!flags.name) throw new Error('brand set 要写 --name');
    const file = brandFile(flags.name);
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const next = {...prev, name: flags.name};
    for (const k of ['palette', 'pair', 'slogan', 'contact']) if (typeof flags[k] === 'string') next[k] = flags[k];
    if (typeof flags.logo === 'string') next.logo = path.resolve(flags.logo);
    if (typeof flags.colors === 'string') next.colors = JSON.parse(flags.colors);
    if (next.palette && !design().palettes[next.palette]) throw new Error(`没有叫「${next.palette}」的配色`);
    if (next.pair && !design().pairs[next.pair]) throw new Error(`没有叫「${next.pair}」的字体搭配`);
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log(`品牌套装「${next.name}」已保存：${file}\n以后 make / gallery 加 --brand "${next.name}" 就会自动套用。`);
    return 0;
  }
  throw new Error('brand 后面写 set / show / list');
}

async function cmdGallery(args, flags) {
  const {content, dir} = readContent(args[1]);
  let ids = String(args[0] || 'auto');
  let templates;
  if (ids === 'auto') {
    const q = flags.query || content._query || Object.values(content).filter(v => typeof v === 'string').join(' ');
    templates = search(q, {family: flags.family, limit: Number(flags.limit || 3)});
  } else templates = ids.split(',').map(id => findTemplate(id.trim()));
  const palettes = typeof flags.palettes === 'string' ? flags.palettes.split(',').map(s => s.trim()) : [null];
  const tmp = ensureDir(path.join(homePaths().cache, `gallery-${Date.now()}`));
  const tiles = [];
  for (const t of templates) {
    for (const palette of palettes) {
      const out = path.join(tmp, `${t.id}${palette ? '-' + palette : ''}.png`);
      const result = await make(t, content, dir, {...flags, palette: palette || flags.palette, out, format: 'png'});
      const s = summarize(t, result.issues);
      tiles.push({t, file: result.files[0], palette: result.theme.paletteId, ok: s.ok, lines: s.lines});
    }
  }
  const sheet = path.resolve(flags.out || path.join(dir, 'gallery.png'));
  await composeSheet(tiles, sheet);
  console.log(`对比图：${sheet}`);
  tiles.forEach((x, i) => {
    console.log(`${i + 1}. ${x.t.id}（${x.t.name}）· 配色 ${x.palette} · ${x.ok ? '检查通过' : '有要改的'}  单张：${x.file}`);
    if (!x.ok) x.lines.slice(1).forEach(l => console.log(`   ${l.trim()}`));
  });
  console.log('把对比图给先生看，问他挑第几个；挑好后用 make 加上同样的 --palette 出正式的。');
  return 0;
}

async function composeSheet(tiles, out) {
  const browser = await getBrowser({});
  const cols = tiles.length <= 3 ? tiles.length : tiles.length === 4 ? 2 : 3;
  const tileW = 560;
  const cells = tiles.map((x, i) => {
    const ratio = (x.t.canvas?.h || 1440) / (x.t.canvas?.w || 1080);
    return `<figure><img src="${pathToFileURL(x.file).href}" style="width:${tileW}px;height:${Math.round(tileW * ratio)}px"><figcaption><b>${i + 1}</b> ${x.t.name} · ${design().palettes[x.palette]?.label || x.palette}${x.ok ? '' : ' · ⚠ 有要改的'}</figcaption></figure>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#EDEBE7;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
    .grid{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:36px;padding:44px;width:max-content}
    figure{margin:0} img{display:block;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.12)}
    figcaption{margin-top:14px;font-size:22px;color:#333} b{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#222;color:#fff;margin-right:8px;font-size:18px}
  </style></head><body><div class="grid">${cells}</div></body></html>`;
  const file = path.join(path.dirname(tiles[0].file), 'sheet.html');
  fs.writeFileSync(file, html, 'utf8');
  const context = await browser.newContext({viewport: {width: 800, height: 600}, deviceScaleFactor: 1});
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href, {waitUntil: 'load'});
  const box = await page.locator('.grid').boundingBox();
  await page.setViewportSize({width: Math.ceil(box.width), height: Math.ceil(box.height)});
  await page.waitForTimeout(50);
  await page.screenshot({path: out, fullPage: true});
  await context.close();
}

async function cmdDoctor() {
  const d = design();
  const pkgs = [...new Set(Object.values(d.fonts).map(f => f.pkg))];
  await ensurePackages(['playwright-core', ...pkgs], {task: '成品库准备'});
  const browser = await getBrowser({task: '成品库准备'});
  console.log(`出图浏览器：${browser.__pinkieSource === 'own' ? '成品库自带的 Chromium' : browser.__pinkieSource}`);
  console.log(`字体：${Object.values(d.fonts).map(f => f.label).join('、')} 都已装好`);
  console.log(`位置：${homePaths().root}`);
  console.log(`模板：${listTemplates().length} 个`);
  return 0;
}

function cmdList(flags) {
  const all = listTemplates().filter(t => !flags.family || t.family === flags.family);
  all.sort((a, b) => (a.family + a.id).localeCompare(b.family + b.id));
  all.forEach(t => console.log(line(t)));
  console.log(`一共 ${all.length} 个。`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const {flags, args} = parse(rest);
  try {
    switch (command) {
      case 'search': return cmdSearch(args, flags);
      case 'show': return cmdShow(args, flags);
      case 'example': return cmdExample(args, flags);
      case 'make': return await cmdMake(args, flags);
      case 'gallery': return await cmdGallery(args, flags);
      case 'themes': return cmdThemes();
      case 'brand': return cmdBrand(args, flags);
      case 'list': return cmdList(flags);
      case 'doctor': return await cmdDoctor();
      default: console.log(HELP); return command && command !== 'help' ? 1 : 0;
    }
  } catch (error) {
    console.error(`出错了：${error.message}`);
    return 1;
  } finally {
    await closeBrowser();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; });
}
