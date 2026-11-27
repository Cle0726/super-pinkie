#!/usr/bin/env node
// B11·chat S10 改前 / 改后数值：模式菜单里的模式名（侧栏模式按钮 .laolao-mode-switcher 与菜单行 .laolao-mode-menu__option
// 的 .laolao-mode-button__label）。约定同 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面 home-chat（tests/visual/lib/real-harness.mjs）× 日 / 夜 × 1440 / 820，820 先展开侧栏再开菜单；不连真网关、不改基线。
// 「改前」= 在本页临时注入 main 的原色（唠嗑 #b34f7c、项目 #3e8584、思考 #965b98），「改后」= 本分支 CSS 原样。
// 量法：同一视口拍有字 / 藏字两张；ratio = 计算字色对藏字图里该标签框的平均底色，pixels = 两张逐像素比的墨色（分箱取最强、再取最小）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';
import {playwright} from '../study-desk/harness.mjs';
import {wkshotBuffer, wrapWebKitPlaywright} from '../../tests/visual/lib/webkit-screenshot.mjs';
import {decodePng} from '../../tests/visual/lib/png-diff.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const HEIGHT = 800;
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

const LABELS = '.laolao-mode-switcher .laolao-mode-button__label, .laolao-mode-menu__option .laolao-mode-button__label';
// 与 laolao-mode-menu-fx.css 的日间覆盖同一前缀；:not(#s10-none) 只为压过页面里同级规则，产品文件里没有。
const DAY = 'html:not([data-pinkie-night]):not([data-theme-mode="dark"]):not([data-laolao-mode="metre"]) :is(.laolao-mode-switcher, .laolao-mode-menu__option)';
const MAIN_INK = {chat: '#b34f7c', project: '#3e8584', thinking: '#965b98'};
const MAIN_CSS = Object.entries(MAIN_INK).map(([m, c]) => `${DAY}[data-mode="${m}"]:not(#s10-none) { --mode-button-ink: ${c}; }`).join('\n');
// 只在截图时临时注入，不进产品文件；tools/ 下不计 important。
const HIDE = ':is(.laolao-mode-switcher, .laolao-mode-menu__option) .laolao-mode-button__label:not(#s10-none) { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }';

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

function inkRatio(A, B, r, binPx) {
  const cols = [];
  for (let x = r.x; x < r.x + r.w; x++) {
    let best = 1, n = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      const c = contrast(lum(px(A, x, y)), lum(px(B, x, y)));
      if (c > 1.15) n++;
      if (c > best) best = c;
    }
    cols.push(n >= 2 ? best : 0);
  }
  const step = Math.max(2, Math.round(binPx)), bins = [];
  for (let x = 0; x < cols.length; x += step) {
    const inked = cols.slice(x, x + step).filter(Boolean);
    if (inked.length >= Math.max(2, step * 0.4)) bins.push(Math.max(...inked));
  }
  return bins.length ? +Math.min(...bins).toFixed(2) : null;
}
function meanRgb(img, r) {
  const sum = [0, 0, 0];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) px(img, x, y).forEach((v, i) => { sum[i] += v; });
  return sum.map((v) => Math.round(v / (r.w * r.h)));
}

const snap = (page) => engine === 'webkit' ? wkshotBuffer(page, {settleMs: 150}) : page.screenshot({animations: 'disabled'});
const lines = [];
const save = (name, buf) => {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(out, file), buf);
  lines.push({name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};
async function withStyle(page, css, fn) {
  const tag = await page.addStyleTag({content: css});
  try { await page.waitForTimeout(300); return await fn(); } finally { await tag.evaluate((n) => n.remove()); }
}
const visibleFirst = async (page, selector) => {
  const all = page.locator(selector);
  for (let i = 0, n = await all.count(); i < n; i++) if (await all.nth(i).isVisible()) return all.nth(i);
  return null;
};

// 模式按钮在侧栏里：窄屏侧栏收在视口外，isVisible 仍为真但点不到，所以 820 先展开侧栏再点（同 b11-chat-walkthrough.mjs）。
async function openMenu(page, width) {
  if (width < 1100) {
    const opener = await visibleFirst(page, 'button[aria-label="展开侧边栏"], button[aria-label="打开侧边栏"]');
    if (!opener) throw new Error('没找到展开侧边栏按钮');
    await opener.click({timeout: 10_000});
    await page.waitForTimeout(600);
  }
  const trigger = await visibleFirst(page, 'button.laolao-mode-switcher, .laolao-mode-dock-trigger');
  if (!trigger) throw new Error('没找到模式菜单触发器');
  await trigger.click({timeout: 10_000});
  await page.waitForFunction(() => [...document.querySelectorAll('.laolao-mode-menu')].some((m) => m.getBoundingClientRect().height > 40), null, {timeout: 5_000});
  await page.waitForTimeout(400);
}

// 只量视口里、中心点没被别的元素盖住的标签。
const probes = (page) => page.evaluate((sel) => {
  const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  return [...document.querySelectorAll(sel)].map((el) => {
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const host = el.closest('.laolao-mode-switcher, .laolao-mode-menu__option');
    const hit = b.width > 0 ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
    const shown = b.width > 0 && b.height > 0 && b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight && Boolean(hit && host?.contains(hit));
    return {group: host?.classList.contains('laolao-mode-menu__option') ? 'menu' : 'switcher', mode: host?.dataset.mode || '', text: el.textContent.trim().slice(0, 20), color: rgb(cs.color), fontPx: parseFloat(cs.fontSize), box: {x: b.left, y: b.top, w: b.width, h: b.height}, shown};
  });
}, LABELS);

async function measure(page, theme, width, variant) {
  const list = (await probes(page)).filter((p) => p.shown);
  const withBuf = await snap(page);
  save(`s10-mode-menu-${width}-${theme}-${variant}`, withBuf);
  const withoutBuf = await withStyle(page, HIDE, () => snap(page));
  const A = decodePng(withBuf), B = decodePng(withoutBuf);
  if (A.width !== B.width || A.height !== B.height) throw new Error('shot sizes differ');
  const k = A.width / width;
  return list.map(({box, color, fontPx, shown, ...rest}) => {
    const x = Math.max(0, Math.floor((box.x - 1) * k)), y = Math.max(0, Math.floor((box.y - 1) * k));
    const r = {x, y, w: Math.min(A.width - x, Math.ceil((box.w + 2) * k)), h: Math.min(A.height - y, Math.ceil((box.h + 2) * k))};
    const bg = meanRgb(B, r);
    return {...rest, color: hex(color), bg: hex(bg), ratio: +contrast(lum(color), lum(bg)).toFixed(2), pixels: inkRatio(A, B, r, (fontPx * k) / 2)};
  });
}

const report = {engine, need: 4.5, rows: []};
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = engine === 'webkit'
  ? await wrapWebKitPlaywright(playwright()).webkit.launch({headless: true})
  : await H.launchRealBrowser();
try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      let opened;
      try {
        opened = await H.openRealScenePage(browser, server.origin, 'home-chat', theme, {timezoneId: 'Asia/Shanghai'});
        const {page} = opened;
        await page.setViewportSize({width, height: HEIGHT});
        await page.waitForTimeout(500);
        await openMenu(page, width);
        for (const variant of ['after', 'before']) {
          const labels = variant === 'before'
            ? await withStyle(page, MAIN_CSS, () => measure(page, theme, width, variant))
            : await measure(page, theme, width, variant);
          const ratios = labels.map((l) => l.ratio);
          report.rows.push({theme, width, variant, min: ratios.length ? Math.min(...ratios) : null, labels, pageErrors: opened.pageErrors?.slice(0, 5)});
        }
      } catch (error) {
        report.rows.push({theme, width, error: String(error?.message || error).slice(0, 300)});
      } finally {
        await opened?.context.close();
      }
    }
  }
  const dayAfter = report.rows.filter((r) => r.theme === 'day' && r.variant === 'after' && r.min != null);
  report.dayAfterMin = dayAfter.length ? Math.min(...dayAfter.map((r) => r.min)) : null;
  report.pass = report.dayAfterMin != null && report.dayAfterMin >= report.need && !report.rows.some((r) => r.error);
} catch (error) {
  report.error = String(error?.message || error).slice(0, 300);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}（${engine}）`);
for (const r of report.rows) {
  if (r.error) { console.log(`${r.theme}-${r.width}\tERROR ${r.error}`); continue; }
  console.log(`${r.theme}-${r.width}-${r.variant}\tmin=${r.min}\t${r.labels.map((l) => `${l.group}/${l.mode}=${l.ratio}(${l.color} on ${l.bg}, px ${l.pixels})`).join('  ')}`);
}
console.log(`day-after min=${report.dayAfterMin} pass=${report.pass}`);
if (report.error || report.rows.some((r) => r.error)) { console.log(`ERROR ${report.error || 'see rows'}`); process.exitCode = 1; }
