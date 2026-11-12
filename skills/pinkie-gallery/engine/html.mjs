// HTML 模板出图：填内容 → 套底子 → 等字体 → 自动缩字 → 检查 → 出 PNG / PDF / JPG。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {SKILL_ROOT, homePaths, ensureDir} from './paths.mjs';
import {design, resolveTheme} from './theme.mjs';
import {ensurePackages} from './install.mjs';
import {getBrowser} from './browser.mjs';

const KERNEL = fs.readFileSync(path.join(SKILL_ROOT, 'engine', 'kernel.js'), 'utf8');
const BASE_CSS = fs.readFileSync(path.join(SKILL_ROOT, 'engine', 'base.css'), 'utf8');

function charCount(value) {
  return String(value ?? '').replace(/\*\*/g, '').replace(/\s/g, '').length;
}

// 渲染前的检查：必填、多余、超长、条数、图片在不在。
export function validateContent(template, content, contentDir) {
  const issues = [];
  const slots = template.slots || {};
  const images = {};
  for (const [key, slot] of Object.entries(slots)) {
    const value = content[key];
    const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);
    if (slot.required && empty) issues.push({slot: key, kind: 'missing'});
    if (empty) continue;
    if (slot.type === 'text' && slot.max && charCount(value) > slot.max) issues.push({slot: key, kind: 'too-long', chars: charCount(value), max: slot.max});
    if (slot.type === 'list') {
      const items = Array.isArray(value) ? value : [value];
      if (slot.maxItems && items.length > slot.maxItems) issues.push({slot: key, kind: 'too-many', count: items.length, max: slot.maxItems});
      items.forEach((item, i) => {
        const obj = item && typeof item === 'object' ? item : {text: item};
        for (const [field, spec] of Object.entries(slot.item || {})) {
          const v = obj[field];
          if (spec.type === 'image') collectImage(`${key}[${i + 1}].${field}`, v);
          else if (spec.max && charCount(v) > spec.max) issues.push({slot: `${key}[${i + 1}].${field}`, kind: 'too-long', chars: charCount(v), max: spec.max});
        }
      });
    }
    if (slot.type === 'image') collectImage(key, value);
  }
  function collectImage(slotName, value) {
    if (!value) return;
    const raw = String(value);
    if (/^data:image\//.test(raw)) { images[raw] = raw; return; }
    const file = path.isAbsolute(raw) ? raw : path.resolve(contentDir, raw);
    if (fs.existsSync(file)) images[raw] = pathToFileURL(file).href;
    else issues.push({slot: slotName, kind: 'image-missing', path: file});
  }
  const known = Object.keys(slots);
  for (const key of Object.keys(content)) {
    if (key.startsWith('_') || ['theme', 'palette', 'pair', 'brand'].includes(key)) continue;
    if (!known.includes(key)) issues.push({slot: key, kind: 'unknown', known: known.join('、')});
  }
  return {issues, images};
}

async function fontLinks(fontIds, task) {
  const {fonts} = design();
  const specs = fontIds.map(id => fonts[id]?.pkg).filter(Boolean);
  await ensurePackages([...new Set(specs)], {task});
  const {runtime} = homePaths();
  const links = [];
  for (const id of fontIds) {
    const font = fonts[id];
    if (!font) continue;
    const name = font.pkg.slice(0, font.pkg.lastIndexOf('@'));
    for (const css of font.css) {
      const file = path.join(runtime, 'node_modules', ...name.split('/'), css);
      if (fs.existsSync(file)) links.push(`<link rel="stylesheet" href="${pathToFileURL(file).href}">`);
    }
  }
  return links.join('\n');
}

export function brandContent(template, content, brand) {
  if (!brand) return content;
  const merged = {...content};
  for (const [key, slot] of Object.entries(template.slots || {})) {
    if (merged[key]) continue;
    if (slot.brand === 'name' && brand.name) merged[key] = brand.name;
    if (slot.brand === 'logo' && brand.logo) merged[key] = brand.logo;
    if (slot.brand === 'slogan' && brand.slogan) merged[key] = brand.slogan;
    if (slot.brand === 'contact' && brand.contact) merged[key] = brand.contact;
  }
  return merged;
}

// 渲染一张。返回 {files, issues, fitted, theme}
export async function renderHtml({template, templateDir, content, contentDir, themeOpts = {}, out, formats, task = '', scaleOverride}) {
  const theme = resolveTheme(template, {palette: themeOpts.palette || content.palette, pair: themeOpts.pair || content.pair, brand: themeOpts.brand || content.brand});
  const filled = brandContent(template, content, theme.brand);
  const brandDir = theme.brand?.__dir || contentDir;
  const pre = validateContent(template, filled, contentDir);
  if (theme.brand?.logo) {
    const logo = path.isAbsolute(theme.brand.logo) ? theme.brand.logo : path.resolve(brandDir, theme.brand.logo);
    if (fs.existsSync(logo)) pre.images[theme.brand.logo] = pathToFileURL(logo).href;
  }
  const canvas = template.canvas || {w: 1080, h: 1440};
  const links = await fontLinks(theme.fontIds, task);
  const html = fs.readFileSync(path.join(templateDir, 'template.html'), 'utf8');
  const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<base href="${pathToFileURL(templateDir + path.sep).href}">
${links}
<style>${BASE_CSS}</style>
<style>:root{--canvas-w:${canvas.w}px;--canvas-h:${canvas.h}px}</style>
</head><body>
${html}
<script>${KERNEL}</script>
</body></html>`;
  const {cache} = homePaths();
  const pagesDir = ensureDir(path.join(cache, 'pages'));
  const pageFile = path.join(pagesDir, `${template.id}-${crypto.randomBytes(4).toString('hex')}.html`);
  fs.writeFileSync(pageFile, page, 'utf8');

  const browser = await getBrowser({task});
  const scale = scaleOverride || canvas.scale || 1;
  const context = await browser.newContext({viewport: {width: canvas.w, height: canvas.h}, deviceScaleFactor: scale});
  const tab = await context.newPage();
  const consoleErrors = [];
  tab.on('pageerror', e => consoleErrors.push(String(e.message || e)));
  try {
    await tab.goto(pathToFileURL(pageFile).href, {waitUntil: 'load', timeout: 60000});
    const report = await tab.evaluate(payload => window.__pinkie.run(payload), {
      data: filled, images: pre.images, vars: theme.vars, canvas, check: template.check || {},
    });
    const files = [];
    ensureDir(path.dirname(out));
    const base = out.replace(/\.(png|jpe?g|pdf)$/i, '');
    for (const format of formats) {
      if (format === 'png' || format === 'jpg') {
        const file = `${base}.${format}`;
        await tab.screenshot({path: file, clip: {x: 0, y: 0, width: canvas.w, height: canvas.h}, type: format === 'jpg' ? 'jpeg' : 'png', ...(format === 'jpg' ? {quality: 86} : {})});
        files.push(file);
      } else if (format === 'pdf') {
        const file = `${base}.pdf`;
        const print = template.print || {};
        await tab.emulateMedia({media: 'screen'});
        await tab.pdf({path: file, printBackground: true, width: print.width || `${canvas.w}px`, height: print.height || `${canvas.h}px`, pageRanges: '1', preferCSSPageSize: false});
        files.push(file);
      }
    }
    const issues = [...pre.issues, ...report.issues];
    for (const e of consoleErrors) issues.push({slot: '页面', kind: 'script', message: e});
    return {files, issues, fitted: report.fitted, theme, emptyImages: report.emptyImages};
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(pageFile, {force: true});
  }
}
