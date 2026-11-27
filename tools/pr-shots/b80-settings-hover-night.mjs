#!/usr/bin/env node
// B80（设置页其余按钮 / 卡片夜间悬停对比度）的 PR 截图脚本，约定照 tools/pr-shots/minimal.mjs：
// node <脚本> --out <目录>，写 PNG + 追加 <目录>/shots.jsonl，另写 report.json（量到的前景 / 底色 / 对比度）。
// 真页面 settings 场景，1440×900 / 820×1180 × 日 / 夜 × 改后 / 改前。
// 改前：同页停用两份注入样式，换成按 tests/b80-settings-hover-night.test.mjs 反例同一套替换还原的旧写法。
// 每格量：共享键悬停边框、标题、选中态文字；再 window.__pinkiePower.open() 量关闭钮静止 / 悬停文字、重置钮边框，悬停后拍整页。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as H from '../../tests/visual/lib/real-harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (f) => fs.readFileSync(path.join(repoRoot, 'ui/injections', f), 'utf8');

const SU = read('laolao-settings-user.css');
const PS = read('laolao-power-settings.css');
const SU_OLD = SU.replace('--pinkie-settings-hover-border: rgba(255, 154, 196, .75);', '--pinkie-settings-hover-border: rgba(255, 154, 196, .5);')
  .replace('html[data-pinkie-night] #laolao-user-settings .pinkie-user-settings__title,\n', '')
  .replace(/html\[data-pinkie-night\] #laolao-user-settings \.pinkie-user-settings__(?:choice|brand|preset)\.is-selected,\n/g, '');
const PS_OLD = PS.replace(/\/\* B80 夜：[^\n]*\*\/\n(?:[^\n]+\n)+?\n/, '');
if (SU_OLD === SU || PS_OLD === PS) throw new Error('改前替换没有命中，脚本与 CSS 不同步');

const MEASURE = ([sel, kind]) => {
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const lum = (c) => [c.r, c.g, c.b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const paint = (el, under) => {
    const cs = getComputedStyle(el);
    const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter((c) => c.a > 0);
    const solid = stops.filter((c) => c.a >= 1);
    const glow = stops.filter((c) => c.a < 1);
    const bg = parse(cs.backgroundColor);
    const base = solid.length ? solid.map((c) => ({...c})) : (bg && bg.a > 0 ? under.map((g) => over(bg, g)) : under);
    return base.flatMap((g) => [g, ...glow.map((c) => over(c, g))]);
  };
  const el = [...document.querySelectorAll(sel)].find((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (!el) return {sel, kind, missing: true};
  const chain = [];
  for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
  const outside = chain.reduce((acc, n) => paint(n, acc), [{r: 255, g: 255, b: 255, a: 1}]);
  const inside = paint(el, outside);
  const cs = getComputedStyle(el);
  const fgText = kind === 'text' ? cs.color : cs.borderTopColor;
  const fg = parse(fgText);
  if (!fg || fg.a === 0) return {sel, kind, fg: fgText, bg: cs.backgroundColor, ratio: 1};
  const sides = kind === 'text' ? inside : [...outside, ...inside];
  return {sel, kind, text: el.textContent.trim().slice(0, 12), fg: fgText, bg: cs.backgroundColor,
    ratio: +Math.min(...sides.map((g) => ratio(over(fg, g), g))).toFixed(2)};
};

const SHARED = '#laolao-user-settings .pinkie-user-settings__choice:not(.is-selected), #laolao-user-settings .pinkie-user-settings__button, #laolao-user-settings .pinkie-user-settings__text-button';
const TITLE = '#laolao-user-settings .pinkie-user-settings__title';
const SELECTED = '#laolao-user-settings .is-selected';
const CLOSE = '#pinkie-power .pinkie-power__close';
const RESET = '#pinkie-power .pinkie-power__reset';

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const engine = String(H.resolveRealEngine() || 'chromium');
const browser = await H.launchRealBrowser(engine);
const report = [];
const lines = [];

async function swapToOld(page) {
  await page.evaluate(([su, ps]) => {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (/laolao-(?:settings-user|power-settings)\.css/.test(link.getAttribute('href') || '')) link.disabled = true;
    }
    const style = document.createElement('style');
    style.id = 'b80-before';
    style.textContent = su + '\n' + ps;
    document.head.appendChild(style);
  }, [SU_OLD, PS_OLD]);
  await page.waitForTimeout(200);
}

async function hoverMeasure(page, sel, kind) {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return {sel, kind, missing: true};
  await loc.scrollIntoViewIfNeeded();
  await loc.hover();
  await page.waitForTimeout(350);
  return page.evaluate(MEASURE, [sel, kind]);
}

function shot(page, name) {
  const file = name + '.png';
  return page.screenshot({path: path.join(out, file), animations: 'disabled', caret: 'hide'}).then(() => {
    const buf = fs.readFileSync(path.join(out, file));
    return {name, file, os: process.platform, browser: engine, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex')};
  });
}

async function cell(theme, width, height, variant) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'settings', theme, {lockPerfClock: true});
  try {
    await page.setViewportSize({width, height});
    await page.waitForSelector('#laolao-user-settings:not([hidden])', {timeout: 10_000});
    if (variant === 'before') await swapToOld(page);
    await page.mouse.move(1, 1);
    const m = {
      title: await page.evaluate(MEASURE, [TITLE, 'text']),
      selected: await page.evaluate(MEASURE, [SELECTED, 'text']),
      'shared:hover': await hoverMeasure(page, SHARED, 'border'),
    };
    const tag = `b80-${variant}-${theme}-${width}`;
    const s1 = await shot(page, `${tag}-settings-hover`);
    await page.waitForFunction(() => typeof window.__pinkiePower?.open === 'function', {timeout: 10_000});
    await page.evaluate(() => window.__pinkiePower.open());
    await page.waitForSelector('#pinkie-power:not([hidden]) .pinkie-power__close', {timeout: 10_000});
    await page.waitForTimeout(300);
    await page.mouse.move(1, 1);
    m.close = await page.evaluate(MEASURE, [CLOSE, 'text']);
    m.reset = await page.evaluate(MEASURE, [RESET, 'border']);
    m['reset:text'] = await page.evaluate(MEASURE, [RESET, 'text']);
    m['reset:hover'] = await hoverMeasure(page, RESET, 'border');
    m['close:hover'] = await hoverMeasure(page, CLOSE, 'text');
    const s2 = await shot(page, `${tag}-power-close-hover`);
    const ratios = Object.fromEntries(Object.entries(m).map(([k, r]) => [k, r.missing ? null : r.ratio]));
    for (const s of [s1, s2]) lines.push({...s, variant, theme, ratios});
    report.push({variant, theme, width, measures: m, pageErrors});
  } catch (error) {
    report.push({variant, theme, width, error: error.message, pageErrors});
  } finally {
    await context.close();
  }
}

try {
  for (const variant of ['after', 'before']) {
    for (const theme of ['day', 'night']) {
      for (const [width, height] of [[1440, 900], [820, 1180]]) {
        await cell(theme, width, height, variant);
        if (report.at(-1)?.error) { report.at(-1).retried = true; await cell(theme, width, height, variant); }
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  installed.cleanup();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const unique = [...new Map(lines.map((l) => [l.name, l])).values()];
fs.appendFileSync(path.join(out, 'shots.jsonl'), unique.map((l) => JSON.stringify(l) + '\n').join(''));
console.log(`pr-shots: ${unique.length} 张 → ${out}`);
for (const r of report) {
  if (r.error) console.log(`pr-shots: ${r.variant} ${r.theme} ${r.width} 出错：${r.error}`);
  else console.log(`pr-shots: ${r.variant} ${r.theme} ${r.width} ${JSON.stringify(Object.fromEntries(Object.entries(r.measures).map(([k, v]) => [k, v.missing ? null : v.ratio])))}`);
}
