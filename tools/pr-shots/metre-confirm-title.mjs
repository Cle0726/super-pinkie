#!/usr/bin/env node
// Metre 作品库「从作品库移除」确认框标题字体（协调者 00:56：#202 Metre 820 夜那张标题落到衬线）。
// 约定照 tools/pr-shots/minimal.mjs。1440 / 820 × 日 / 夜，每格：
//   confirm-metre   Metre（metre-board 场景）确认框：标题应跟正文同为 --metre-sans
//   confirm         碧琪项目模式同一个确认框（对照，不该变）
// report.json 记标题 / 正文 font-family、字号、字重、颜色。
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
  const item = {id: 'a1b2', kind: 'html', title: '单词小游戏.html', path: 'C:/work/单词小游戏.html', mode: 'project', sessionKey: '',
    createdAt: 0, updatedAt: 0, exists: true, size: 2048, version: 3, total: 3,
    versions: [1, 2, 3].map(v => ({v, ts: 0, size: 2048, runId: '', source: 'tool', snapshot: true}))};
  const answers = {
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: '<h1 style="font:24px system-ui">单词小游戏</h1>'},
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
  window.__artShotItem = item;
};

const measure = (page, selectors) => page.evaluate(list => list.map(sel => {
  const node = document.querySelector(sel);
  if (!node) return {sel, missing: true};
  const s = getComputedStyle(node), r = node.getBoundingClientRect();
  return {sel, text: (node.textContent || '').trim().slice(0, 40), font: s.fontFamily, size: s.fontSize, weight: s.fontWeight,
    color: s.color, background: s.backgroundColor, mode: document.documentElement.getAttribute('data-laolao-mode'),
    night: document.documentElement.hasAttribute('data-pinkie-night'), w: Math.round(r.width), h: Math.round(r.height)};
}), selectors);

const HEIGHT = 800;
const installed = H.installRealControlUi({repoRoot});
const server = await H.startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot, runDir: installed.runDir});
const browser = await H.launchRealBrowser();
const engine = H.resolveRealEngine();
const report = [];
const lines = [];
const shot = async (page, name, theme, width) => {
  const file = `${name}-${theme}-${width}.png`;
  const buf = await page.screenshot({path: path.join(out, file)});
  lines.push({name: `${name}-${theme}-${width}`, file, os: process.platform, browser: engine || 'chromium', width, height: HEIGHT,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
};

async function confirmRemove(name, scene, theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, scene, theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__art === true, {timeout: 15_000})
      .catch(error => report.push({name, theme, width, step: 'wrap', error: error.message}));
    await page.evaluate(() => window.PinkieArtifacts?.openViewer?.(window.__artShotItem.id));
    await page.locator('button', {hasText: '从作品库移除'}).first().click({timeout: 10_000})
      .catch(error => report.push({name, theme, width, step: 'click-remove', error: error.message}));
    await page.waitForSelector('.pinkie-art-confirm .laolao-modal__title', {timeout: 10_000})
      .catch(error => report.push({name, theme, width, step: 'confirm-open', error: error.message}));
    await page.waitForTimeout(300);
    await shot(page, name, theme, width);
    report.push({name, theme, width, step: 'confirm', pageErrors, styles: await measure(page, ['.pinkie-art-confirm .laolao-modal__title',
      '.pinkie-art-confirm .pinkie-art-confirm__text', '.pinkie-art-confirm .laolao-modal__button--primary'])});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await confirmRemove('confirm-metre', 'metre-board', theme, width);
      await confirmRemove('confirm', 'settings', theme, width);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map(l => JSON.stringify(l) + '\n').join(''));
  await browser.close();
  await server.close();
  installed.cleanup();
}
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
