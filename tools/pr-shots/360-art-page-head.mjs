#!/usr/bin/env node
// #360 作品库页头（.pinkie-art-page）截图，给 PR 截图工作流（.github/workflows/pr-shots.yml）用。
// 约定照 tools/pr-shots/minimal.mjs：node <脚本> --out <目录>，写 PNG + <目录>/shots.jsonl，另写 report.json。
// 真页面（tests/visual/lib/real-harness.mjs）。harness 总会注入 app/windows_bridge_scripts.py 的 BRIDGE_SCRIPT，
// 所以 linux / windows 两个 job 都带 data-pinkie-platform=windows 和真窗口键，report 里照实记下。
// 作品库数据照 tests/project-artifacts-header.test.mjs 接 gwRequest，不碰用户会话。拍：
//   art-head  settings / home-unrestricted × 1440 / 820 × 日夜：作品库页打开、搜索框失焦（静止态边框 + placeholder）
// report 记：.pinkie-art-page__head 实际 padding-right、--pinkie-caption-reserve、标题 / 搜索框 / × / 窗口键 rect 与间距、
// 标题有没有被挤断，以及胶囊 / 搜索框边框和 placeholder 的对比度（按实际绘制底色合成）。
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

const initScript = () => {
  const item = {id: 'a1b2', kind: 'doc', title: '单词表.txt', path: 'C:/work/单词表.txt', mode: 'project', sessionKey: '',
    createdAt: 0, updatedAt: 0, exists: true, size: 2048, version: 3, total: 3,
    versions: [1, 2, 3].map((v) => ({v, ts: 0, size: 2048, runId: '', source: 'tool', snapshot: true}))};
  const answers = {
    'pinkie.artifacts.list': {ok: true, items: [item], cursor: null},
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: 'apple 苹果'},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.list': {ok: true, apps: []},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__art) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__art = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
};

function measure() {
  const parse = (s) => {
    let m = String(s).match(/^rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = String(s).match(/^color\(srgb\s+([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return [0, 0, 0, 0];
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const chain = (node) => { const list = []; for (let n = node; n && n.nodeType === 1; n = n.parentElement) list.push(n); return list; };
  const backdrop = (node, withSelf) => {
    let c = [255, 255, 255, 1];
    for (const n of chain(withSelf ? node : node.parentElement).reverse()) c = over(parse(getComputedStyle(n).backgroundColor), c);
    return c;
  };
  const opacity = (node) => chain(node).reduce((acc, n) => acc * Number(getComputedStyle(n).opacity || 1), 1);
  const ink = (node, color) => { const c = parse(color); c[3] *= opacity(node); return c; };
  const edge = (node) => {
    if (!node) return null;
    const outer = backdrop(node, false);
    const inner = over(parse(getComputedStyle(node).backgroundColor), outer);
    const e = ink(node, getComputedStyle(node).borderTopColor);
    return {ratio: Math.min(ratio(over(e, outer), outer), ratio(over(e, inner), inner)), color: getComputedStyle(node).borderTopColor};
  };
  const rect = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height)};
  };
  const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);

  const head = document.querySelector('.pinkie-art-page__head');
  const title = document.querySelector('.pinkie-art-page__title');
  const search = document.querySelector('.pinkie-art-page .pinkie-art-search');
  const close = document.querySelector('.pinkie-art-page .pinkie-art-close');
  const chip = document.querySelector('.pinkie-art-page .pinkie-art-chip[aria-pressed="false"]');
  const caption = document.getElementById('pinkie-native-window-controls');
  const R = {head: rect(head), title: rect(title), search: rect(search), close: rect(close), caption: rect(caption)};
  let placeholder = null;
  if (search) { const bg = backdrop(search, true); placeholder = ratio(over(ink(search, getComputedStyle(search, '::placeholder').color), bg), bg); }
  const ts = title ? getComputedStyle(title) : null;
  const lineHeight = ts ? (parseFloat(ts.lineHeight) || parseFloat(ts.fontSize) * 1.3) : 0;
  return {
    platform: document.documentElement.getAttribute('data-pinkie-platform'),
    mode: document.documentElement.getAttribute('data-laolao-mode'),
    innerWidth,
    captionReserve: getComputedStyle(document.documentElement).getPropertyValue('--pinkie-caption-reserve').trim() || null,
    headPaddingRight: head ? getComputedStyle(head).paddingRight : null,
    rects: R,
    gaps: R.caption ? {
      titleToCaption: R.title ? R.caption.left - R.title.right : null,
      searchToCaption: R.search ? R.caption.left - R.search.right : null,
      closeToCaption: R.close ? R.caption.left - R.close.right : null,
    } : null,
    overlap: {title: overlaps(R.title, R.caption), search: overlaps(R.search, R.caption), close: overlaps(R.close, R.caption)},
    title: title ? {text: title.textContent, scroll: title.scrollWidth, client: title.clientWidth, oneLine: R.title.height <= lineHeight * 1.5, clipped: title.scrollWidth > title.clientWidth + 0.5} : null,
    contrast: {chipEdge: edge(chip), searchEdge: edge(search), placeholder, searchFocused: document.activeElement === search},
  };
}

const HEIGHT = 800;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const errors = [];

async function cell(scene, theme, width) {
  const where = `${scene}/${theme}/${width}`;
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__art === true, null, {timeout: 15_000});
    await page.waitForFunction((w) => {
      const c = document.getElementById('pinkie-native-window-controls');
      return c && Math.abs(c.getBoundingClientRect().right - w) < 40;
    }, width, {timeout: 10_000});
    await page.evaluate(() => window.PinkieArtifacts.open());
    await page.waitForSelector('.pinkie-art-page .pinkie-art-card__meta', {timeout: 10_000});
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {timeout: 10_000});
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(Math.round(width / 2), HEIGHT - 20);
    await page.waitForTimeout(300);
    const m = await page.evaluate(measure);
    const name = `art-head-${scene}-${width}-${theme}`;
    const file = `${name}.png`;
    const buf = await page.screenshot({path: path.join(out, file)});
    lines.push({name, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
      bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), platform: m.platform});
    report.push({scene, theme, width, ...m, pageErrors});
  } catch (error) {
    errors.push(`${where}: ${error.message.split('\n')[0]}`);
    report.push({scene, theme, width, error: error.message.split('\n')[0]});
  } finally {
    await context.close();
  }
}

try {
  for (const scene of ['settings', 'home-unrestricted']) {
    for (const theme of ['day', 'night']) {
      for (const width of [1440, 820]) await cell(scene, theme, width);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({errors, cells: report}, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}${errors.length ? `，${errors.length} 格出错` : ''}`);
