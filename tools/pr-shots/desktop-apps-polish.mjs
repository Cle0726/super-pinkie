#!/usr/bin/env node
// #112 之后的跟进小 PR 截图（.github/workflows/pr-shots.yml 用），约定照 tools/pr-shots/minimal.mjs。
// 4 格（1440 / 820 × 日夜），每格两张：
//   dialog    装到桌面对话框，第一个权限勾选框勾上（看 accent-color）
//   settings  设置「已装的应用」，第一行有新版本：「更新成新版本」是主按钮，说明栏不被挤断
// report.json 记勾选框 accent-color、主按钮字 / 底色、说明栏行数（高 / 行高）。
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
  const apps = [
    {id: 'w0123456789abcde', artifactId: 'a1b2', name: '单词小游戏', version: 2, latest: 3, network: [], files: false},
    {id: 'wfedcba987654321', artifactId: 'c3d4', name: '番茄计时器（专注版）', version: 5, latest: 5, network: ['https://api.weather.example'], files: true},
  ];
  const answers = {
    'pinkie.artifacts.get': {ok: true, item},
    'pinkie.artifacts.read': {ok: true, v: 3, size: 40, mime: 'text/plain', encoding: 'utf8', data: '<h1 style="font:24px system-ui">单词小游戏</h1>'},
    'pinkie.apps.forArtifact': {ok: true, app: null},
    'pinkie.apps.needs': {ok: true, version: 3, network: ['https://api.dictionary.example', 'https://cdn.fonts.example'], files: true},
    'pinkie.apps.list': {ok: true, apps},
  };
  window.pywebview = {api: {pinkieNative: async () => ({ok: true})}};
  const wrap = () => {
    const sidebar = window.__laolaoSidebar;
    if (!sidebar || typeof sidebar.gwRequest !== 'function' || sidebar.gwRequest.__apps) return false;
    const real = sidebar.gwRequest.bind(sidebar);
    const fake = (method, params, timeout) => (method in answers ? Promise.resolve(answers[method]) : real(method, params, timeout));
    fake.__apps = true;
    sidebar.gwRequest = fake;
    return true;
  };
  const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 50);
  window.__appsShotItem = item;
};

const measure = (page, selectors) => page.evaluate(list => list.map(sel => {
  const node = document.querySelector(sel);
  if (!node) return {sel, missing: true};
  const s = getComputedStyle(node), r = node.getBoundingClientRect();
  const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.4;
  return {sel, text: (node.textContent || '').trim().slice(0, 60), color: s.color, background: s.backgroundColor, accent: s.accentColor,
    font: s.fontSize, w: Math.round(r.width), h: Math.round(r.height), lines: Math.round(r.height / lh), checked: node.checked ?? null};
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

async function dialog(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'metre-board', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForFunction(() => window.__laolaoSidebar?.gwRequest?.__apps === true, {timeout: 15_000});
    await page.evaluate(() => window.PinkieArtifacts?.openViewer?.(window.__appsShotItem.id));
    await page.waitForSelector('.pk-apps-install', {timeout: 10_000}).catch(() => {});
    await page.click('.pk-apps-install').catch(error => report.push({theme, width, step: 'click-install', error: error.message}));
    await page.waitForSelector('.pk-apps-dialog__perm input', {timeout: 10_000}).catch(() => {});
    await page.locator('.pk-apps-dialog__perm input').first().check().catch(error => report.push({theme, width, step: 'check', error: error.message}));
    await page.waitForTimeout(250);
    await shot(page, 'dialog', theme, width);
    report.push({theme, width, step: 'dialog', pageErrors, styles: await measure(page, ['.pk-apps-dialog', '.pk-apps-dialog__perm input', '.pk-apps-dialog .laolao-modal__button--primary'])});
  } finally {
    await context.close();
  }
}

async function settings(theme, width) {
  const {context, page, pageErrors} = await H.openRealScenePage(browser, server.origin, 'settings', theme, {initScript});
  try {
    await page.setViewportSize({width, height: HEIGHT});
    await page.waitForSelector('.pk-apps-card .pk-apps-update', {timeout: 10_000}).catch(() => {});
    await page.evaluate(() => document.querySelector('.pk-apps-card')?.scrollIntoView({block: 'center'}));
    await page.waitForTimeout(250);
    await shot(page, 'settings', theme, width);
    report.push({theme, width, step: 'settings', pageErrors, styles: await measure(page, ['.pk-apps-card', '.pk-apps-row .pk-apps-update',
      '.pk-apps-row .pinkie-user-settings__hint', '.pk-apps-row .pinkie-user-settings__row-copy', '.pk-apps-row__actions'])});
  } finally {
    await context.close();
  }
}

try {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 820]) {
      await dialog(theme, width);
      await settings(theme, width);
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
