#!/usr/bin/env node
// B11 全页面走查（Metre）截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）：Metre 会话里有一条带「Sources」来源行的回答，
// 再打开侧栏「筛选」菜单并悬停「上一轮出错」。1440 / 820 × 日 / 夜。不连网关、不碰用户会话。
// 每格拍三张：
//   sources        关掉总谱后的会话（来源行在画面里）
//   sources-row    来源行放大
//   filter         筛选菜单（计数落在悬停行底上）
// report.json / shots.jsonl 另记「Sources」、编号、网站名、筛选计数对所在底的对比度。
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
const HEIGHT = 800;

const N = 'https://nodejs.org/en/blog/release/v22.0.0';
const results = [
  {title: 'Node.js 22 发布说明', url: N, snippet: 'Node.js 22 带来了 require(esm) 实验支持……', siteName: 'nodejs.org'},
  {title: 'V8 12.4 新特性', url: 'https://v8.dev/blog/v8-release-124', snippet: 'Maglev 编译器默认开启……', siteName: 'v8.dev'},
];
const t = (text) => [{type: 'text', text}];
const HISTORY = [
  {role: 'user', content: t('Node 22 有什么新东西？查一下'), timestamp: 1},
  {role: 'assistant', stopReason: 'toolUse', content: [{type: 'toolCall', id: 'ws1', name: 'web_search', arguments: {query: 'Node.js 22'}}], timestamp: 2},
  {role: 'toolResult', toolCallId: 'ws1', toolName: 'web_search', content: t(JSON.stringify({query: 'Node.js 22', results})), timestamp: 3},
  {role: 'assistant', stopReason: 'stop', content: t('Node 22 主要有两点 [1]：\n\n- `require()` 可以加载 ES 模块 [1]\n- V8 升到 12.4 [2]\n\n要我接着看哪一个？'), timestamp: 4},
];
const initScript = new Function(`window.__fakeSeedHistory = ${JSON.stringify(HISTORY)};`);

const measure = (page) => page.evaluate(() => {
  const P = (c) => {
    const srgb = c.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (srgb) return {r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: 1};
    const m = c.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    return {r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1};
  };
  const L = ({r, g, b}) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const bgOf = (e) => {
    const stack = [];
    for (let x = e; x; x = x.parentElement) {
      const c = P(getComputedStyle(x).backgroundColor);
      if (c.a > 0) stack.push(c);
      if (c.a >= 1) break;
    }
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (const c of stack.reverse()) base = over(c, base);
    return base;
  };
  const one = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return {sel, missing: true};
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    const bg = bgOf(e), fg = over({...P(s.color), a: P(s.color).a}, bg);
    const a = L(fg), b = L(bg);
    return {
      sel, text: (e.textContent || '').trim().slice(0, 40),
      color: s.color,
      bg: `rgb(${[bg.r, bg.g, bg.b].map((x) => Math.round(x)).join(',')})`,
      ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    };
  };
  return {
    label: one('.pk-mcite-row__label'),
    n: one('.pk-mcite-chip__n'),
    host: one('.pk-mcite-chip__host'),
    count: (() => { const a = one('.pk-mw-filter-menu__item[data-filter="error"] .pk-mw-filter-menu__count'); return a.missing ? one('.pk-mw-filter-menu__count') : a; })(),
  };
});

const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];

const record = async (page, name, clip) => {
  const file = `${name}.png`;
  const buf = await page.screenshot({path: path.join(out, file), ...(clip ? {clip} : {})});
  lines.push({
    name, file, os: process.platform, browser: engine || 'chromium',
    width: clip ? Math.round(clip.width) : (await page.viewportSize()).width,
    height: clip ? Math.round(clip.height) : HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  });
};

const zoom = async (page, sel, name, pad = 24) => {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (!box) return record(page, name);
  const vp = page.viewportSize();
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const clip = {
    x, y,
    width: Math.min(vp.width - x, box.width + pad * 2),
    height: Math.min(vp.height - y, box.height + pad * 2),
  };
  return record(page, name, clip);
};

async function cell(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {
    initScript,
    timezoneId: 'Asia/Shanghai',
  });
  try {
    await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForTimeout(400);
    const sources = page.locator('.pk-mcite-row').first();
    await sources.waitFor({state: 'visible', timeout: 15_000});
    await sources.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const tag = `${width}-${theme}`;
    await record(page, `sources-${tag}`);
    await zoom(page, '.pk-mcite-row', `sources-row-${tag}`, 28);
    if (width < 1100) {
      const opener = page.locator('button[aria-label="展开侧边栏"], button[aria-label="打开侧边栏"]').first();
      if (await opener.count()) await opener.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    const filter = page.locator('aside.sidebar .pk-metre-nav--filter').first();
    await filter.waitFor({state: 'visible', timeout: 10_000});
    await filter.click();
    await page.waitForSelector('.pk-mw-filter-menu', {timeout: 10_000});
    const hover = page.locator('.pk-mw-filter-menu__item[data-filter="error"]').first();
    if (await hover.count()) await hover.hover();
    else await page.locator('.pk-mw-filter-menu__item').last().hover();
    await page.waitForTimeout(200);
    await zoom(page, '.pk-mw-filter-menu', `filter-${tag}`, 24);
    const m = await measure(page);
    report.push({theme, width, pageErrors: pageErrors.slice(0, 5), contrast: m, ok: Object.values(m).every((x) => x.missing || x.ratio >= 4.5)});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) await cell(theme, width);
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
